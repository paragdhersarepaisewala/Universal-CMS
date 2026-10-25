import { pool } from '../../db/pool.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { moduleRegistry } from '../registry.js';
import { safeTimingCompare, getPaymentGateway } from './payment-gateway.js';
import { canTransition, isMonotonicRegression, OrderStatus, OrderKind } from './state-machine.js';
import { fulfilmentRegistry } from './fulfilment.js';
import { TaxEngine, QuoteCalculationResult } from './tax.js';
import { InvoiceService } from './invoice.js';
import { ShippingService } from '../shipping/service.js';

export interface ProductRecord {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  sku?: string | null;
  price: number; // In paise (e.g. 79900 = Rs 799.00)
  compareAtPrice?: number | null;
  costPrice?: number | null;
  productType: 'physical' | 'digital';
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  trackStock: boolean;
  allowBackorder: boolean;
  status: 'draft' | 'active' | 'archived';
  isAgeRestricted: boolean;
  featuredImageId?: number | null;
  taxClassId?: number | null;
  hsnCode?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CouponRecord {
  id: number;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  usageCount: number;
  expiresAt?: string | null;
  isActive: boolean;
}

export interface OrderItemInput {
  productId: number;
  variantId?: number;
  productType?: 'physical' | 'digital';
  title?: string;
  sku?: string;
  price?: number;
  quantity: number;
}

export interface OrderRecord {
  id: number;
  orderNumber: string;
  customerId?: number | null;
  customerEmail: string;
  status: OrderStatus;
  orderKind: OrderKind;
  paymentMethod: 'razorpay' | 'cod';
  paymentStatus: 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded';
  paymentId?: string | null;
  invoiceId?: number | null;
  placeOfSupplyState?: string | null;
  buyerGstin?: string | null;
  subtotal: number;
  taxTotal: number;
  shippingTotal: number;
  shippingMethod?: string | null;
  shippingCarrier?: string | null;
  shippingAwb?: string | null;
  trackingNumber?: string | null;
  discountTotal: number;
  codFeePaise?: number;
  codFeeTaxPaise?: number;
  cgstPaise?: number;
  sgstPaise?: number;
  utgstPaise?: number;
  igstPaise?: number;
  cessPaise?: number;
  total: number;
  currency: string;
  shippingAddress?: Record<string, unknown> | null;
  billingAddress?: Record<string, unknown> | null;
  billingState?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  idempotencyPayloadHash?: string | null;
  expiresAt?: string | null;
  guestAccessToken?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items?: any[];
}

export interface ReviewRecord {
  id: number;
  entityType: string;
  entityId: string;
  userId?: number | null;
  authorName: string;
  authorEmail?: string | null;
  rating: number; // 1 - 5
  comment: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface CreateOrderParams {
  customerId?: number | null;
  customerEmail: string;
  paymentMethod: 'razorpay' | 'cod';
  items: OrderItemInput[];
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  billingState?: string;
  buyerGstin?: string;
  couponCode?: string;
  shippingAmount?: number;
  shippingMethod?: string;
  notes?: string;
  idempotencyKey?: string;
  rawPayload?: unknown;
}

export interface VerifyPaymentParams {
  orderId: number;
  razorpayOrderId?: string;
  razorpayPaymentId: string;
  razorpaySignature?: string;
  userId?: number | null;
  userRole?: string | null;
  guestToken?: string | null;
}

export interface RefundLineItemInput {
  orderItemId: number;
  quantity: number;
}

export interface CreateRefundParams {
  orderId: number;
  amountPaise?: number; // Optional if derived from line items
  lineItems?: RefundLineItemInput[];
  reason: string;
  idempotencyKey: string;
  restock?: boolean;
  actorId?: number | null;
}

async function withDeadlockRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isDeadlock =
        err?.errno === 1213 ||
        err?.code === 'ER_LOCK_DEADLOCK' ||
        (typeof err?.message === 'string' && err.message.includes('Deadlock'));
      if (isDeadlock && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Transaction failed after retries');
}

export class StoreService {
  private static getSecret(): string {
    return process.env.APP_SECRET || 'universal_cms_default_secure_secret_key_32chars';
  }

  static generateGuestAccessToken(orderId: number, expiryHours = 72): string {
    const expiresAt = Date.now() + expiryHours * 3600 * 1000;
    const payload = `${orderId}:${expiresAt}`;
    const hmac = createHmac('sha256', this.getSecret()).update(payload).digest('hex');
    return `${payload}:${hmac}`;
  }

  static verifyGuestAccessToken(token: string, targetOrderId: number): boolean {
    if (!token) return false;
    const parts = token.split(':');
    if (parts.length !== 3) return false;
    const [orderIdStr, expiresAtStr, signature] = parts;
    const orderId = Number(orderIdStr);
    const expiresAt = Number(expiresAtStr);

    if (orderId !== targetOrderId) {
      return false; // Token bound to order A fails on order B
    }
    if (Date.now() > expiresAt) {
      return false; // Expired
    }

    const payload = `${orderId}:${expiresAt}`;
    const expected = createHmac('sha256', this.getSecret()).update(payload).digest('hex');
    return safeTimingCompare(expected, signature);
  }

  // 1. List Products
  static async listProducts(filter?: {
    status?: 'draft' | 'active' | 'archived';
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ data: ProductRecord[]; total: number }> {
    const page = Math.max(1, filter?.page || 1);
    const perPage = Math.min(100, Math.max(1, filter?.perPage || 20));
    const offset = (page - 1) * perPage;

    const connection = await pool.getConnection();
    try {
      let query = 'SELECT * FROM products WHERE 1=1';
      const params: any[] = [];

      if (filter?.status) {
        query += ' AND status = ?';
        params.push(filter.status);
      }
      if (filter?.search) {
        query += ' AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)';
        const term = `%${filter.search}%`;
        params.push(term, term, term);
      }

      const countQuery = `SELECT COUNT(*) as cnt FROM (${query}) as sub`;
      const [countRows] = await connection.query<RowDataPacket[]>(countQuery, params);
      const total = Number(countRows[0]?.cnt || 0);

      query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
      params.push(perPage, offset);
      const [rows] = await connection.query<RowDataPacket[]>(query, params);

      const data: ProductRecord[] = rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        slug: r.slug,
        description: r.description,
        sku: r.sku,
        price: Number(r.price),
        compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
        costPrice: r.cost_price ? Number(r.cost_price) : null,
        productType: (r.product_type as 'physical' | 'digital') || 'physical',
        stockQuantity: Number(r.stock_quantity),
        lowStockThreshold: Number(r.low_stock_threshold),
        trackInventory: Boolean(r.track_inventory),
        trackStock: Boolean(r.track_stock),
        allowBackorder: Boolean(r.allow_backorder),
        status: r.status,
        isAgeRestricted: Boolean(r.is_age_restricted),
        featuredImageId: r.featured_image_id ? Number(r.featured_image_id) : null,
        version: Number(r.version || 1),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));

      return { data, total };
    } finally {
      connection.release();
    }
  }

  // 2. Get Product By Slug
  static async getProductBySlug(slug: string): Promise<ProductRecord | null> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM products WHERE slug = ? LIMIT 1',
        [slug]
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: Number(r.id),
        name: r.name,
        slug: r.slug,
        description: r.description,
        sku: r.sku,
        price: Number(r.price),
        compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
        costPrice: r.cost_price ? Number(r.cost_price) : null,
        productType: (r.product_type as 'physical' | 'digital') || 'physical',
        stockQuantity: Number(r.stock_quantity),
        lowStockThreshold: Number(r.low_stock_threshold),
        trackInventory: Boolean(r.track_inventory),
        trackStock: Boolean(r.track_stock),
        allowBackorder: Boolean(r.allow_backorder),
        status: r.status,
        isAgeRestricted: Boolean(r.is_age_restricted),
        featuredImageId: r.featured_image_id ? Number(r.featured_image_id) : null,
        version: Number(r.version || 1),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    } finally {
      connection.release();
    }
  }

  // 3. Create Product
  static async createProduct(data: {
    name: string;
    slug: string;
    description?: string;
    sku?: string;
    price: number;
    compareAtPrice?: number;
    productType?: 'physical' | 'digital';
    stockQuantity?: number;
    lowStockThreshold?: number;
    trackStock?: boolean;
    allowBackorder?: boolean;
    status?: 'draft' | 'active' | 'archived';
  }): Promise<ProductRecord> {
    const connection = await pool.getConnection();
    try {
      const pType = data.productType || 'physical';
      const trackStock = data.trackStock !== undefined ? data.trackStock : pType === 'physical';
      const stock = data.stockQuantity !== undefined ? data.stockQuantity : 0;
      const threshold = data.lowStockThreshold !== undefined ? data.lowStockThreshold : 5;
      const status = data.status || 'draft';

      await connection.query<ResultSetHeader>(
        `INSERT INTO products (
          name, slug, description, sku, price, compare_at_price, product_type,
          stock_quantity, low_stock_threshold, track_inventory, track_stock,
          allow_backorder, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.slug,
          data.description || null,
          data.sku || null,
          data.price,
          data.compareAtPrice || null,
          pType,
          stock,
          threshold,
          trackStock,
          trackStock,
          data.allowBackorder || false,
          status,
        ]
      );

      const prod = await this.getProductBySlug(data.slug);
      return prod!;
    } finally {
      connection.release();
    }
  }

  // 4. Update Product
  static async updateProduct(id: number, data: Partial<ProductRecord>): Promise<ProductRecord | null> {
    const connection = await pool.getConnection();
    try {
      const updates: string[] = [];
      const params: any[] = [];

      if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
      if (data.price !== undefined) { updates.push('price = ?'); params.push(data.price); }
      if (data.stockQuantity !== undefined) { updates.push('stock_quantity = ?'); params.push(data.stockQuantity); }
      if (data.status !== undefined) { updates.push('status = ?'); params.push(data.status); }
      if (data.productType !== undefined) { updates.push('product_type = ?'); params.push(data.productType); }
      if (data.trackStock !== undefined) { updates.push('track_stock = ?'); params.push(data.trackStock); }

      if (updates.length === 0) {
        const [r] = await connection.query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [id]);
        return r.length ? (r[0] as any) : null;
      }

      updates.push('version = version + 1');
      params.push(id);

      await connection.query(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params);
      const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [id]);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: Number(r.id),
        name: r.name,
        slug: r.slug,
        description: r.description,
        sku: r.sku,
        price: Number(r.price),
        compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
        costPrice: r.cost_price ? Number(r.cost_price) : null,
        productType: (r.product_type as 'physical' | 'digital') || 'physical',
        stockQuantity: Number(r.stock_quantity),
        lowStockThreshold: Number(r.low_stock_threshold),
        trackInventory: Boolean(r.track_inventory),
        trackStock: Boolean(r.track_stock),
        allowBackorder: Boolean(r.allow_backorder),
        status: r.status,
        isAgeRestricted: Boolean(r.is_age_restricted),
        featuredImageId: r.featured_image_id ? Number(r.featured_image_id) : null,
        version: Number(r.version || 1),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    } finally {
      connection.release();
    }
  }

  // 5. Coupon validation
  static async validateCoupon(
    code: string,
    subtotal: number,
    connection?: PoolConnection
  ): Promise<{ valid: boolean; discountAmount: number; coupon?: CouponRecord; message?: string }> {
    const conn: PoolConnection = connection || (await pool.getConnection());
    const shouldRelease = !connection;
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM coupons WHERE code = ? AND is_active = TRUE LIMIT 1',
        [code]
      );
      if (rows.length === 0) {
        return { valid: false, discountAmount: 0, message: 'Invalid coupon code' };
      }
      const c = rows[0];
      if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) {
        return { valid: false, discountAmount: 0, message: 'Coupon expired' };
      }
      if (c.usage_limit && Number(c.usage_count) >= Number(c.usage_limit)) {
        return { valid: false, discountAmount: 0, message: 'Coupon usage limit exceeded' };
      }
      if (subtotal < Number(c.min_order_amount)) {
        return { valid: false, discountAmount: 0, message: `Minimum order amount of Rs ${c.min_order_amount / 100} required` };
      }

      let discount = 0;
      if (c.discount_type === 'percentage') {
        discount = Math.round((subtotal * Number(c.discount_value)) / 100);
        if (c.max_discount_amount) {
          discount = Math.min(discount, Number(c.max_discount_amount));
        }
      } else {
        discount = Number(c.discount_value);
      }
      discount = Math.min(discount, subtotal);

      return {
        valid: true,
        discountAmount: discount,
        coupon: {
          id: Number(c.id),
          code: c.code,
          discountType: c.discount_type,
          discountValue: Number(c.discount_value),
          minOrderAmount: Number(c.min_order_amount),
          maxDiscountAmount: c.max_discount_amount ? Number(c.max_discount_amount) : null,
          usageLimit: c.usage_limit ? Number(c.usage_limit) : null,
          usageCount: Number(c.usage_count),
          expiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null,
          isActive: Boolean(c.is_active),
        },
      };
    } finally {
      if (shouldRelease) {
        conn.release();
      }
    }
  }

  // 6. Calculate Totals (server-side single source of truth)
  static calculateTotals(params: {
    items: Array<{ price: number; quantity: number }>;
    shippingAmount?: number;
    couponDiscount?: number;
  }): { subtotal: number; discountTotal: number; shippingTotal: number; taxTotal: number; total: number } {
    const subtotal = params.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const discountTotal = Math.min(params.couponDiscount || 0, subtotal);
    const discountedSubtotal = subtotal - discountTotal;

    // Default 18% GST calculation (integer paise)
    const taxTotal = Math.round((discountedSubtotal * 18) / 100);
    const shippingTotal = params.shippingAmount || 0;
    const total = discountedSubtotal + taxTotal + shippingTotal;

    return { subtotal, discountTotal, shippingTotal, taxTotal, total };
  }

  // 6b. Advanced Cart Quote (Full GST Breakdown & COD Rules)
  static async quoteCart(params: {
    items: Array<{ productId: number; quantity: number; title?: string; price?: number }>;
    couponCode?: string;
    shippingAmount?: number;
    placeOfSupplyState?: string;
    shippingPincode?: string;
    paymentMethod?: string;
  }): Promise<QuoteCalculationResult> {
    const connection = await pool.getConnection();
    try {
      const productIds = params.items.map((i) => i.productId);
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, sku, price, tax_class_id, hsn_code FROM products WHERE id IN (?)',
        [productIds.length > 0 ? productIds : [0]]
      );
      const prodMap = new Map<number, RowDataPacket>();
      rows.forEach((r) => prodMap.set(Number(r.id), r));

      const enrichedItems = params.items.map((it) => {
        const p = prodMap.get(it.productId);
        return {
          productId: it.productId,
          title: p?.name || it.title || 'Product',
          sku: p?.sku || null,
          price: p ? Number(p.price) : it.price || 0,
          quantity: it.quantity,
          taxClassId: p?.tax_class_id ? Number(p.tax_class_id) : null,
          hsnCode: p?.hsn_code || null,
        };
      });

      let couponDiscount = 0;
      if (params.couponCode) {
        const rawSubtotal = enrichedItems.reduce((acc, it) => acc + it.price * it.quantity, 0);
        const check = await this.validateCoupon(params.couponCode, rawSubtotal, connection);
        if (check.valid) {
          couponDiscount = check.discountAmount;
        }
      }

      return await TaxEngine.calculateOrderTaxes({
        items: enrichedItems,
        placeOfSupplyState: params.placeOfSupplyState,
        shippingPincode: params.shippingPincode,
        shippingAmount: params.shippingAmount,
        couponDiscount,
        paymentMethod: params.paymentMethod,
      });
    } finally {
      connection.release();
    }
  }

  // 7. Atomic Checkout Engine (H2.1 Core)
  static async checkout(params: CreateOrderParams): Promise<{ order: OrderRecord; gatewayOrder?: any }> {
    return withDeadlockRetry(async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Idempotency Key Handling
        if (params.idempotencyKey) {
          const payloadString = JSON.stringify(params.rawPayload || params);
          const payloadHash = createHash('sha256').update(payloadString).digest('hex');

          const [existingOrders] = await connection.query<RowDataPacket[]>(
            'SELECT * FROM orders WHERE idempotency_key = ? LIMIT 1 FOR UPDATE',
            [params.idempotencyKey]
          );

          if (existingOrders.length > 0) {
            const existing = existingOrders[0];
            if (existing.idempotency_payload_hash !== payloadHash) {
              await connection.rollback();
              const err = new Error('Idempotency key collision: Same key used with different request payload');
              (err as any).statusCode = 422;
              (err as any).code = 'UNPROCESSABLE_ENTITY';
              throw err;
            }

            // Return cached order
            const [itemRows] = await connection.query<RowDataPacket[]>(
              'SELECT * FROM order_items WHERE order_id = ?',
              [existing.id]
            );
            await connection.commit();
            return {
              order: {
                id: Number(existing.id),
                orderNumber: existing.order_number,
                customerId: existing.customer_id ? Number(existing.customer_id) : null,
                customerEmail: existing.customer_email,
                status: existing.status,
                orderKind: existing.order_kind,
                paymentMethod: existing.payment_method,
                paymentStatus: existing.payment_status,
                paymentId: existing.payment_id,
                subtotal: Number(existing.subtotal),
                taxTotal: Number(existing.tax_total),
                shippingTotal: Number(existing.shipping_total),
                discountTotal: Number(existing.discount_total),
                total: Number(existing.total),
                currency: existing.currency,
                shippingAddress: typeof existing.shipping_address === 'string' ? JSON.parse(existing.shipping_address) : existing.shipping_address,
                billingAddress: typeof existing.billing_address === 'string' ? JSON.parse(existing.billing_address) : existing.billing_address,
                billingState: existing.billing_state,
                notes: existing.notes,
                idempotencyKey: existing.idempotency_key,
                expiresAt: existing.expires_at ? new Date(existing.expires_at).toISOString() : null,
                guestAccessToken: existing.guest_access_token,
                version: Number(existing.version),
                createdAt: new Date(existing.created_at).toISOString(),
                updatedAt: new Date(existing.updated_at).toISOString(),
                items: itemRows.map((it) => ({
                  id: Number(it.id),
                  productId: Number(it.product_id),
                  variantId: it.variant_id ? Number(it.variant_id) : null,
                  productType: it.product_type,
                  fulfilmentStatus: it.fulfilment_status,
                  title: it.title,
                  sku: it.sku,
                  price: Number(it.price),
                  quantity: Number(it.quantity),
                  total: Number(it.total),
                })),
              },
            };
          }
        }

        // 2. Fetch products and calculate server-side totals
        if (!params.items || params.items.length === 0) {
          throw new Error('Order must contain at least one item');
        }

        // Sort items by productId ASC to strictly avoid deadlock cycles
        const sortedItems = [...params.items].sort((a, b) => a.productId - b.productId);
        const productIds = sortedItems.map((i) => i.productId);

        const [productRows] = await connection.query<RowDataPacket[]>(
          `SELECT * FROM products WHERE id IN (?) FOR UPDATE`,
          [productIds]
        );
        const productMap = new Map<number, RowDataPacket>();
        productRows.forEach((p) => productMap.set(Number(p.id), p));

        let hasPhysical = false;
        let hasDigital = false;
        const validatedItems: Array<{
          product: RowDataPacket;
          quantity: number;
          unitPrice: number;
          productType: 'physical' | 'digital';
        }> = [];

        for (const item of sortedItems) {
          const prod = productMap.get(item.productId);
          if (!prod) {
            throw new Error(`Product ID ${item.productId} not found`);
          }
          if (prod.status !== 'active') {
            throw new Error(`Product '${prod.name}' is not available for purchase`);
          }

          const pType = (prod.product_type as 'physical' | 'digital') || 'physical';
          if (pType === 'physical') hasPhysical = true;
          if (pType === 'digital') {
            if (!moduleRegistry.isEnabled('digital-delivery')) {
              const err = new Error('Digital products are disabled because the digital-delivery module is not enabled');
              (err as any).statusCode = 400;
              (err as any).code = 'MODULE_DISABLED';
              throw err;
            }
            hasDigital = true;
          }

          validatedItems.push({
            product: prod,
            quantity: item.quantity,
            unitPrice: Number(prod.price),
            productType: pType,
          });
        }

        // Rule: COD is never available for a cart containing any digital line
        if (hasDigital && params.paymentMethod === 'cod') {
          const err = new Error('Cash on Delivery (COD) is not available for orders containing digital products');
          (err as any).statusCode = 400;
          throw err;
        }

        // Rule: Billing state always required (needed for tax)
        const billingState =
          params.billingState ||
          (params.billingAddress?.state as string) ||
          (params.shippingAddress?.state as string);

        if (!billingState) {
          const err = new Error('Billing state is required for tax calculation');
          (err as any).statusCode = 400;
          throw err;
        }

        // Rule: Shipping address required if physical lines exist
        if (hasPhysical && !params.shippingAddress) {
          const err = new Error('Shipping address is required for physical items');
          (err as any).statusCode = 400;
          throw err;
        }

        const orderKind: OrderKind =
          hasPhysical && hasDigital ? 'mixed' : hasDigital ? 'digital' : 'physical';

        // 3. Atomic Stock Reservation (conditional UPDATE with affectedRows check)
        for (const line of validatedItems) {
          const prod = line.product;
          const handler = fulfilmentRegistry.get(line.productType);
          const needsStock = handler.requiresStock({
            productType: line.productType,
            trackStock: Boolean(prod.track_stock),
          });

          if (needsStock && !prod.allow_backorder) {
            const [updateRes] = await connection.query<ResultSetHeader>(
              `UPDATE products 
               SET stock_quantity = stock_quantity - ? 
               WHERE id = ? AND stock_quantity >= ?`,
              [line.quantity, prod.id, line.quantity]
            );

            if (updateRes.affectedRows === 0) {
              await connection.rollback();
              const err = new Error(`Insufficient stock for product '${prod.name}'`);
              (err as any).statusCode = 409;
              (err as any).code = 'INSUFFICIENT_STOCK';
              throw err;
            }

            // Write stock movement
            await connection.query(
              `INSERT INTO stock_movements (
                product_id, variant_id, quantity, change_type, reason, actor_id
              ) VALUES (?, ?, ?, 'reservation', 'Checkout stock reservation', ?)`,
              [prod.id, null, -line.quantity, params.customerId || null]
            );
          }
        }

        // 4. Atomic Coupon Increment
        let couponDiscount = 0;
        if (params.couponCode) {
          const rawSubtotal = validatedItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
          const check = await this.validateCoupon(params.couponCode, rawSubtotal, connection);
          if (!check.valid || !check.coupon) {
            await connection.rollback();
            const err = new Error(check.message || 'Invalid or expired coupon code');
            (err as any).statusCode = 409;
            throw err;
          }

          couponDiscount = check.discountAmount;

          const [couponRes] = await connection.query<ResultSetHeader>(
            `UPDATE coupons 
             SET usage_count = usage_count + 1 
             WHERE id = ? AND (usage_limit IS NULL OR usage_count < usage_limit)`,
            [check.coupon.id]
          );

          if (couponRes.affectedRows === 0) {
            await connection.rollback();
            const err = new Error('Coupon usage limit reached under concurrent checkout');
            (err as any).statusCode = 409;
            throw err;
          }
        }

        // 5. Compute server totals and tax breakdown using TaxEngine & ShippingService
        const storeSettings = await TaxEngine.getStoreSettings();
        const shippingPincode =
          (params.shippingAddress as any)?.pincode ||
          (params.shippingAddress as any)?.postalCode ||
          null;

        let calculatedShippingAmount = params.shippingAmount;
        let shippingMethodName = params.shippingMethod || null;

        if (hasPhysical) {
          if (!moduleRegistry.isEnabled('shipping')) {
            const shipSettings = await ShippingService.getSettings();
            if (shipSettings.disabledBehavior === 'block_physical') {
              const error = new Error('Shipping is currently disabled for physical goods');
              (error as any).statusCode = 422;
              (error as any).code = 'SHIPPING_DISABLED';
              throw error;
            } else {
              calculatedShippingAmount = calculatedShippingAmount ?? shipSettings.fallbackRatePaise ?? 5000;
              shippingMethodName = shippingMethodName || 'Flat Rate Delivery';
            }
          } else if (params.shippingMethod || params.shippingAmount !== undefined) {
            const shippingRates = await ShippingService.calculateShipping({
              items: validatedItems.map((i) => ({
                productId: Number(i.product.id),
                productType: i.productType,
                quantity: i.quantity,
                pricePaise: i.unitPrice,
                weightGrams: i.product.weight_grams ?? 500,
              })),
              destination: {
                country: (params.shippingAddress as any)?.country || 'IN',
                state: (params.shippingAddress as any)?.state || billingState,
                pincode: shippingPincode || '400001',
              },
              cod: params.paymentMethod === 'cod',
            });

            if (calculatedShippingAmount === undefined) {
              const matchedRate = params.shippingMethod
                ? shippingRates.find(
                    (r) =>
                      r.code === params.shippingMethod ||
                      r.name.toLowerCase() === params.shippingMethod?.toLowerCase()
                  ) || shippingRates[0]
                : shippingRates[0];
              calculatedShippingAmount = matchedRate ? matchedRate.amountPaise : 0;
              if (!shippingMethodName && matchedRate) {
                shippingMethodName = matchedRate.name;
              }
            }
          } else {
            calculatedShippingAmount = 0;
          }
        } else {
          calculatedShippingAmount = 0;
        }

        const quote = await TaxEngine.calculateOrderTaxes({
          items: validatedItems.map((i) => ({
            productId: Number(i.product.id),
            title: i.product.name,
            sku: i.product.sku,
            price: i.unitPrice,
            quantity: i.quantity,
            taxClassId: i.product.tax_class_id ? Number(i.product.tax_class_id) : null,
            hsnCode: i.product.hsn_code || null,
          })),
          placeOfSupplyState: billingState,
          shippingPincode,
          shippingAmount: calculatedShippingAmount,
          couponDiscount,
          paymentMethod: params.paymentMethod,
        });

        // 6. Generate unique order number (concurrency safe)
        const orderNumber = `ORD-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;

        // 7. Calculate status & expiry:
        // COD skips payment expiry; if codRequiresConfirmation is false, COD starts confirmed immediately
        const isCod = params.paymentMethod === 'cod';
        const initialStatus: OrderStatus = isCod
          ? storeSettings.codRequiresConfirmation ? 'pending_payment' : 'confirmed'
          : 'pending_payment';

        const expiryMinutes = Number(process.env.STORE_ORDER_EXPIRY_MINUTES || 30);
        const expiresAt = isCod ? null : new Date(Date.now() + expiryMinutes * 60 * 1000);

        const payloadHash = params.idempotencyKey
          ? createHash('sha256').update(JSON.stringify(params.rawPayload || params)).digest('hex')
          : null;

        // 8. Insert Order Record with full GST breakdown
        const [orderInsert] = await connection.query<ResultSetHeader>(
          `INSERT INTO orders (
            order_number, customer_id, customer_email, status, order_kind,
            payment_method, payment_status, place_of_supply_state, buyer_gstin,
            subtotal, tax_total, shipping_total, shipping_method, discount_total, cod_fee_paise,
            cod_fee_tax_paise, cgst_paise, sgst_paise, utgst_paise, igst_paise,
            cess_paise, total, currency, shipping_address, billing_address,
            billing_state, notes, idempotency_key, idempotency_payload_hash,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderNumber,
            params.customerId || null,
            params.customerEmail,
            initialStatus,
            orderKind,
            params.paymentMethod,
            quote.placeOfSupplyState,
            params.buyerGstin || null,
            quote.subtotal,
            quote.taxTotal,
            quote.shippingTotal,
            shippingMethodName,
            quote.discountTotal,
            quote.codFeePaise,
            quote.codFeeTaxPaise,
            quote.cgstPaise,
            quote.sgstPaise,
            quote.utgstPaise,
            quote.igstPaise,
            quote.cessPaise,
            quote.total,
            params.shippingAddress ? JSON.stringify(params.shippingAddress) : null,
            params.billingAddress ? JSON.stringify(params.billingAddress) : null,
            billingState,
            params.notes || null,
            params.idempotencyKey || null,
            payloadHash,
            expiresAt,
          ]
        );

        const orderId = Number(orderInsert.insertId);

        // Generate and store guest access token
        const guestAccessToken = this.generateGuestAccessToken(orderId);
        await connection.query('UPDATE orders SET guest_access_token = ? WHERE id = ?', [
          guestAccessToken,
          orderId,
        ]);

        // 9. Insert Order Items with GST tax metadata
        for (let idx = 0; idx < validatedItems.length; idx++) {
          const line = validatedItems[idx];
          const lineTax = quote.lines[idx];
          await connection.query(
            `INSERT INTO order_items (
              order_id, product_id, variant_id, product_type, fulfilment_status,
              title, sku, price, quantity, weight_grams, tax_class_id, hsn_code,
              tax_rate_basis_points, taxable_amount_paise, cgst_paise, sgst_paise,
              utgst_paise, igst_paise, cess_paise, total
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderId,
              line.product.id,
              null,
              line.productType,
              line.product.name,
              line.product.sku || null,
              line.unitPrice,
              line.quantity,
              line.product.weight_grams ?? 500,
              lineTax?.taxClassId || null,
              lineTax?.hsnCode || '9900',
              lineTax?.taxRateBasisPoints || 0,
              lineTax?.taxableAmountPaise || line.unitPrice * line.quantity,
              lineTax?.cgstPaise || 0,
              lineTax?.sgstPaise || 0,
              lineTax?.utgstPaise || 0,
              lineTax?.igstPaise || 0,
              lineTax?.cessPaise || 0,
              lineTax?.lineTotalPaise || line.unitPrice * line.quantity,
            ]
          );
        }

        // 10. Record Order Status History
        await connection.query(
          `INSERT INTO order_status_history (
            order_id, from_status, to_status, actor, reason
          ) VALUES (?, 'none', ?, ?, 'Order created via checkout')`,
          [orderId, initialStatus, params.customerId ? `user_${params.customerId}` : 'guest']
        );

        // 11. Create Gateway Order if online payment
        let gatewayOrder: any = null;
        if (params.paymentMethod === 'razorpay') {
          const gateway = getPaymentGateway();
          gatewayOrder = await gateway.createOrder({
            orderNumber,
            amountPaise: quote.total,
            currency: 'INR',
            receipt: orderNumber,
            notes: { orderId: String(orderId) },
          });

          await connection.query(
            `INSERT INTO payments (
              order_id, gateway, gateway_order_id, gateway_payment_id,
              amount_paise, currency, status
            ) VALUES (?, 'razorpay', ?, ?, ?, 'INR', 'pending')`,
            [orderId, gatewayOrder.gatewayOrderId, `pending_${orderNumber}`, quote.total]
          );

          await connection.query('UPDATE orders SET payment_id = ? WHERE id = ?', [
            gatewayOrder.gatewayOrderId,
            orderId,
          ]);
        }

        // 12. If COD and confirmed immediately, generate tax invoice
        let invoiceId: number | null = null;
        if (isCod && initialStatus === 'confirmed') {
          const inv = await InvoiceService.generateInvoice(orderId, connection);
          invoiceId = inv.id;
        }

        await connection.commit();

        const createdOrder: OrderRecord = {
          id: orderId,
          orderNumber,
          customerId: params.customerId || null,
          customerEmail: params.customerEmail,
          status: initialStatus,
          orderKind,
          paymentMethod: params.paymentMethod,
          paymentStatus: 'pending',
          paymentId: gatewayOrder?.gatewayOrderId || null,
          invoiceId,
          placeOfSupplyState: quote.placeOfSupplyState,
          buyerGstin: params.buyerGstin || null,
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          shippingTotal: quote.shippingTotal,
          discountTotal: quote.discountTotal,
          codFeePaise: quote.codFeePaise,
          codFeeTaxPaise: quote.codFeeTaxPaise,
          cgstPaise: quote.cgstPaise,
          sgstPaise: quote.sgstPaise,
          utgstPaise: quote.utgstPaise,
          igstPaise: quote.igstPaise,
          cessPaise: quote.cessPaise,
          total: quote.total,
          currency: 'INR',
          shippingAddress: params.shippingAddress || null,
          billingAddress: params.billingAddress || null,
          billingState,
          notes: params.notes || null,
          idempotencyKey: params.idempotencyKey || null,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          guestAccessToken,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          items: validatedItems.map((i, idx) => ({
            productId: Number(i.product.id),
            title: i.product.name,
            productType: i.productType,
            fulfilmentStatus: 'pending',
            price: i.unitPrice,
            quantity: i.quantity,
            total: quote.lines[idx]?.lineTotalPaise || i.unitPrice * i.quantity,
          })),
        };

        return { order: createdOrder, gatewayOrder };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    });
  }

  // Backwards-compatible alias for checkout returning order directly
  static async createOrder(params: CreateOrderParams): Promise<OrderRecord> {
    const res = await this.checkout({
      billingState: params.billingState || (params.shippingAddress as any)?.state || 'Maharashtra',
      ...params,
    });
    return res.order;
  }

  // 8. Single Confirmation Path (verify-payment, webhook, & late payment)
  static async confirmOrderPayment(
    orderId: number,
    paymentDetails: {
      gatewayPaymentId: string;
      gatewayOrderId?: string;
      amountPaise: number;
      currency: string;
      method?: string;
    },
    actor = 'gateway'
  ): Promise<{ winner: boolean; duplicate?: boolean; order: OrderRecord; latePayment?: 'confirmed' | 'refunded' }> {
    return withDeadlockRetry(async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Check current order with lock
        const [orderRows] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM orders WHERE id = ? FOR UPDATE',
          [orderId]
        );
        if (orderRows.length === 0) {
          await connection.rollback();
          throw new Error(`Order ${orderId} not found`);
        }
        const order = orderRows[0];

        // 1. Race condition / winner check: Conditional update
        const [updateRes] = await connection.query<ResultSetHeader>(
          `UPDATE orders 
           SET status = 'confirmed', payment_status = 'captured', payment_id = ?, updated_at = NOW() 
           WHERE id = ? AND status = 'pending_payment'`,
          [paymentDetails.gatewayPaymentId, orderId]
        );

        if (updateRes.affectedRows === 1) {
          // WINNER!
          // Upsert payments record
          await connection.query(
            `INSERT INTO payments (
              order_id, gateway, gateway_order_id, gateway_payment_id,
              amount_paise, currency, status, method, captured_at
            ) VALUES (?, 'razorpay', ?, ?, ?, ?, 'captured', ?, NOW())
            ON DUPLICATE KEY UPDATE 
              status = 'captured', gateway_payment_id = VALUES(gateway_payment_id), 
              captured_at = NOW(), method = VALUES(method)`,
            [
              orderId,
              paymentDetails.gatewayOrderId || order.payment_id || `order_${orderId}`,
              paymentDetails.gatewayPaymentId,
              paymentDetails.amountPaise,
              paymentDetails.currency,
              paymentDetails.method || 'online',
            ]
          );

          // Record status history
          await connection.query(
            `INSERT INTO order_status_history (
              order_id, from_status, to_status, actor, reason
            ) VALUES (?, 'pending_payment', 'confirmed', ?, 'Payment captured and verified')`,
            [orderId, actor]
          );

          // Handle Digital Fulfilment
          if (order.order_kind === 'digital') {
            const [lineItems] = await connection.query<RowDataPacket[]>(
              'SELECT * FROM order_items WHERE order_id = ?',
              [orderId]
            );
            let allFulfilled = true;
            for (const item of lineItems) {
              const handler = fulfilmentRegistry.get('digital');
              const res = await handler.onPaid(
                { orderId, orderNumber: order.order_number, customerEmail: order.customer_email },
                {
                  id: Number(item.id),
                  orderId,
                  productId: Number(item.product_id),
                  productType: 'digital',
                  title: item.title,
                  price: Number(item.price),
                  quantity: Number(item.quantity),
                  total: Number(item.total),
                },
                connection
              );

              if (res.status === 'fulfilled') {
                await connection.query(
                  "UPDATE order_items SET fulfilment_status = 'fulfilled' WHERE id = ?",
                  [item.id]
                );
              } else {
                allFulfilled = false;
              }
            }

            // Per specification: Digital-only orders transition confirmed -> completed automatically once entitlements are granted
            if (allFulfilled) {
              await connection.query(
                "UPDATE orders SET status = 'completed' WHERE id = ?",
                [orderId]
              );
              await connection.query(
                `INSERT INTO order_status_history (
                  order_id, from_status, to_status, actor, reason
                ) VALUES (?, 'confirmed', 'completed', 'system', 'Digital entitlements fulfilled')`,
                [orderId]
              );
            }
          }

          // Queue transactional jobs (emails, invoice, meta CAPI)
          await connection.query(
            `INSERT INTO jobs (job_type, payload, status) VALUES 
             ('email:order-confirmation', ?, 'pending'),
             ('store:invoice-generate', ?, 'pending')`,
            [
              JSON.stringify({ orderId, orderNumber: order.order_number, email: order.customer_email }),
              JSON.stringify({ orderId, orderNumber: order.order_number }),
            ]
          );

          // Generate formal invoice atomically
          await InvoiceService.generateInvoice(orderId, connection);

          await connection.commit();
          const refreshed = await this.getOrderById(orderId, connection);
          return { winner: true, order: refreshed! };
        }

        // 2. Not winning caller: Check if already confirmed (Duplicate / Idempotent)
        if (order.status === 'confirmed' || order.status === 'completed' || order.status === 'processing') {
          await connection.commit();
          const refreshed = await this.getOrderById(orderId, connection);
          return { winner: false, duplicate: true, order: refreshed! };
        }

        // 3. Late Payment Handling (Payment captured for an order that already expired or cancelled)
        if (order.status === 'cancelled') {
          const [orderItems] = await connection.query<RowDataPacket[]>(
            'SELECT * FROM order_items WHERE order_id = ?',
            [orderId]
          );

          // Check if stock is available to re-reserve
          let stockAvailable = true;
          for (const item of orderItems) {
            const [pRows] = await connection.query<RowDataPacket[]>(
              'SELECT stock_quantity, track_stock, allow_backorder FROM products WHERE id = ? FOR UPDATE',
              [item.product_id]
            );
            if (pRows.length > 0) {
              const p = pRows[0];
              if (p.track_stock && !p.allow_backorder && p.stock_quantity < Number(item.quantity)) {
                stockAvailable = false;
                break;
              }
            }
          }

          if (stockAvailable) {
            // Branch A: Stock available -> re-reserve and confirm
            for (const item of orderItems) {
              await connection.query(
                'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                [item.quantity, item.product_id]
              );
              await connection.query(
                `INSERT INTO stock_movements (
                  product_id, quantity, change_type, reason, reference_id
                ) VALUES (?, ?, 'reservation', 'Late payment stock re-reservation', ?)`,
                [item.product_id, -Number(item.quantity), order.order_number]
              );
            }

            await connection.query(
              `UPDATE orders 
               SET status = 'confirmed', payment_status = 'captured', payment_id = ? 
               WHERE id = ?`,
              [paymentDetails.gatewayPaymentId, orderId]
            );

            await connection.query(
              `INSERT INTO order_status_history (
                order_id, from_status, to_status, actor, reason
              ) VALUES (?, 'cancelled', 'confirmed', ?, 'Late payment received with stock re-reserved')`,
              [orderId, actor]
            );

            // Generate formal invoice
            await InvoiceService.generateInvoice(orderId, connection);

            await connection.commit();
            const refreshed = await this.getOrderById(orderId, connection);
            return { winner: true, latePayment: 'confirmed', order: refreshed! };
          } else {
            // Branch B: Stock unavailable -> payment_received_after_expiry & auto refund
            await connection.query(
              `UPDATE orders 
               SET status = 'payment_received_after_expiry', payment_status = 'captured', payment_id = ? 
               WHERE id = ?`,
              [paymentDetails.gatewayPaymentId, orderId]
            );

            await connection.query(
              `INSERT INTO order_status_history (
                order_id, from_status, to_status, actor, reason
              ) VALUES (?, 'cancelled', 'payment_received_after_expiry', ?, 'Late payment received but stock depleted')`,
              [orderId, actor]
            );

            // Record payment
            const [payRes] = await connection.query<ResultSetHeader>(
              `INSERT INTO payments (
                order_id, gateway, gateway_order_id, gateway_payment_id,
                amount_paise, currency, status, method, captured_at
              ) VALUES (?, 'razorpay', ?, ?, ?, ?, 'captured', ?, NOW())`,
              [
                orderId,
                paymentDetails.gatewayOrderId || order.payment_id || `order_${orderId}`,
                paymentDetails.gatewayPaymentId,
                paymentDetails.amountPaise,
                paymentDetails.currency,
                paymentDetails.method || 'online',
              ]
            );

            // Automatic refund record
            await connection.query(
              `INSERT INTO refunds (
                order_id, payment_id, amount_paise, status, idempotency_key,
                restock, reason
              ) VALUES (?, ?, ?, 'pending', ?, FALSE, 'Automatic refund: stock unavailable for late payment')`,
              [
                orderId,
                payRes.insertId,
                paymentDetails.amountPaise,
                `auto_refund_${paymentDetails.gatewayPaymentId}`,
              ]
            );

            // Queue admin alert
            await connection.query(
              `INSERT INTO jobs (job_type, payload, status) VALUES 
               ('admin:alert-late-payment-sold-out', ?, 'pending')`,
              [JSON.stringify({ orderId, orderNumber: order.order_number, amount: paymentDetails.amountPaise })]
            );

            await connection.commit();
            const refreshed = await this.getOrderById(orderId, connection);
            return { winner: true, latePayment: 'refunded', order: refreshed! };
          }
        }

        await connection.commit();
        const refreshed = await this.getOrderById(orderId, connection);
        return { winner: false, order: refreshed! };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    });
  }

  // 9. Verify Payment Endpoint Logic
  static async verifyPayment(params: VerifyPaymentParams): Promise<{ success: boolean; order: OrderRecord }> {
    const order = await this.getOrderById(params.orderId);
    if (!order) {
      const err = new Error(`Order ${params.orderId} not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    // Ownership check
    const isOwner =
      (params.userId && order.customerId === params.userId) ||
      params.userRole === 'admin' ||
      params.userRole === 'owner';

    if (!isOwner) {
      // Must be valid guest token
      if (!params.guestToken || !this.verifyGuestAccessToken(params.guestToken, params.orderId)) {
        const err = new Error('Forbidden: You do not have permission to verify or access this order');
        (err as any).statusCode = 403;
        throw err;
      }
    }

    const gateway = getPaymentGateway();

    // Check checkout signature with timingSafeEqual if provided
    if (params.razorpaySignature) {
      const orderIdToSign = params.razorpayOrderId || order.paymentId || '';
      const validSig = gateway.verifySignature(orderIdToSign, params.razorpayPaymentId, params.razorpaySignature);
      if (!validSig) {
        const err = new Error('Invalid payment signature');
        (err as any).statusCode = 400;
        throw err;
      }
    }

    // Fetch payment from Razorpay (10 second timeout)
    const payment = await gateway.fetchPayment(params.razorpayPaymentId);

    // Validate amount in integer paise
    if (payment.amount !== order.total) {
      const err = new Error(`Payment amount mismatch: Expected ${order.total} paise, got ${payment.amount} paise`);
      (err as any).statusCode = 400;
      throw err;
    }

    // Validate currency
    if (payment.currency !== order.currency) {
      const err = new Error(`Payment currency mismatch: Expected ${order.currency}, got ${payment.currency}`);
      (err as any).statusCode = 400;
      throw err;
    }

    // Handle payment status
    if (payment.status === 'authorized') {
      // Auto-capture assumption: If authorized but not captured, do NOT confirm. Order stays in pending_payment.
      return { success: false, order };
    }

    if (payment.status !== 'captured') {
      const err = new Error(`Payment is not in captured status (current: ${payment.status})`);
      (err as any).statusCode = 400;
      throw err;
    }

    // Single confirmation path
    const result = await this.confirmOrderPayment(
      order.id,
      {
        gatewayPaymentId: payment.id,
        gatewayOrderId: payment.orderId,
        amountPaise: payment.amount,
        currency: payment.currency,
        method: payment.method,
      },
      'verify_payment'
    );

    return { success: true, order: result.order };
  }

  // 10. Webhook Processor
  static async processRazorpayWebhook(
    rawBody: string | Buffer,
    signature: string,
    secret?: string
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored'; eventId?: string }> {
    const gateway = getPaymentGateway();
    const valid = gateway.verifyWebhookSignature(rawBody, signature, secret);
    if (!valid) {
      const err = new Error('Razorpay webhook signature verification failed');
      (err as any).statusCode = 400;
      throw err;
    }

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const event = JSON.parse(bodyStr);
    const eventId = event.id || event.event_id;
    const eventName = event.event;

    if (!eventId || !eventName) {
      const err = new Error('Malformed webhook event payload');
      (err as any).statusCode = 400;
      throw err;
    }

    const connection = await pool.getConnection();
    try {
      // Store event first (unique event_id) to prevent replay
      try {
        await connection.query(
          `INSERT INTO payment_webhook_events (
            event_id, gateway, event_name, payload, status
          ) VALUES (?, 'razorpay', ?, ?, 'received')`,
          [eventId, eventName, bodyStr]
        );
      } catch (err: any) {
        if (err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY') {
          // Idempotent duplicate: already received
          return { status: 'duplicate', eventId };
        }
        throw err;
      }

      // Process event types
      if (eventName === 'payment.captured' || eventName === 'order.paid') {
        const paymentEntity = event.payload?.payment?.entity;
        if (paymentEntity) {
          const notes = paymentEntity.notes || {};
          let targetOrderId = Number(notes.orderId);

          if (!targetOrderId) {
            // Find by payment_id
            const [oRows] = await connection.query<RowDataPacket[]>(
              'SELECT id FROM orders WHERE payment_id = ? LIMIT 1',
              [paymentEntity.order_id]
            );
            if (oRows.length > 0) {
              targetOrderId = Number(oRows[0].id);
            }
          }

          if (targetOrderId) {
            await this.confirmOrderPayment(
              targetOrderId,
              {
                gatewayPaymentId: paymentEntity.id,
                gatewayOrderId: paymentEntity.order_id,
                amountPaise: Number(paymentEntity.amount),
                currency: paymentEntity.currency,
                method: paymentEntity.method,
              },
              'webhook'
            );
          }
        }
      } else if (eventName === 'payment.failed') {
        const paymentEntity = event.payload?.payment?.entity;
        if (paymentEntity) {
          const notes = paymentEntity.notes || {};
          const targetOrderId = Number(notes.orderId);
          if (targetOrderId) {
            const [oRows] = await connection.query<RowDataPacket[]>(
              'SELECT status FROM orders WHERE id = ?',
              [targetOrderId]
            );
            if (oRows.length > 0) {
              const currentStatus = oRows[0].status as OrderStatus;
              // Monotonic guard: payment.failed after captured must never move order backwards
              if (!isMonotonicRegression(currentStatus, 'payment_failed')) {
                await connection.query(
                  "UPDATE orders SET status = 'payment_failed', payment_status = 'failed' WHERE id = ?",
                  [targetOrderId]
                );
                await connection.query(
                  `INSERT INTO order_status_history (
                    order_id, from_status, to_status, actor, reason
                  ) VALUES (?, ?, 'payment_failed', 'webhook', 'Payment failed webhook received')`,
                  [targetOrderId, currentStatus]
                );

                // Release stock and coupon usage on payment failure
                await this.releaseOrderStockAndCoupons(targetOrderId, connection);
              }
            }
          }
        }
      } else if (eventName === 'refund.processed') {
        const refundEntity = event.payload?.refund?.entity;
        if (refundEntity) {
          await connection.query(
            "UPDATE refunds SET status = 'processed', gateway_refund_id = ? WHERE gateway_refund_id = ? OR id = ?",
            [refundEntity.id, refundEntity.id, Number(refundEntity.notes?.refundId || 0)]
          );
        }
      }

      await connection.query(
        "UPDATE payment_webhook_events SET status = 'processed', processed_at = NOW() WHERE event_id = ?",
        [eventId]
      );

      return { status: 'processed', eventId };
    } finally {
      connection.release();
    }
  }

  // 11. Release reserved stock and coupons (on cancellation, expiry, or payment failure)
  static async releaseOrderStockAndCoupons(orderId: number, connection?: PoolConnection): Promise<void> {
    const conn: PoolConnection = connection || (await pool.getConnection());
    const shouldReleaseConn = !connection;

    try {
      const [orderItems] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM order_items WHERE order_id = ?',
        [orderId]
      );
      const [orderRows] = await conn.query<RowDataPacket[]>(
        'SELECT order_number FROM orders WHERE id = ?',
        [orderId]
      );
      const orderNumber = orderRows[0]?.order_number || `order_${orderId}`;

      for (const item of orderItems) {
        if (item.product_type === 'physical') {
          await conn.query(
            'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
            [item.quantity, item.product_id]
          );
          await conn.query(
            `INSERT INTO stock_movements (
              product_id, quantity, change_type, reason, reference_id
            ) VALUES (?, ?, 'release', 'Order cancelled or expired', ?)`,
            [item.product_id, item.quantity, orderNumber]
          );
        }
      }
    } finally {
      if (shouldReleaseConn) {
        conn.release();
      }
    }
  }

  // 12. Create Refund API (Full or Partial)
  static async createRefund(params: CreateRefundParams): Promise<any> {
    return withDeadlockRetry(async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Idempotency Check
        const [existingRefunds] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM refunds WHERE idempotency_key = ? LIMIT 1',
          [params.idempotencyKey]
        );
        if (existingRefunds.length > 0) {
          await connection.commit();
          return existingRefunds[0];
        }

        // 2. Lock Order
        const [orderRows] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM orders WHERE id = ? FOR UPDATE',
          [params.orderId]
        );
        if (orderRows.length === 0) {
          throw new Error(`Order ${params.orderId} not found`);
        }
        const order = orderRows[0];

        // 3. Captured Payments and Previous Refunds
        const [payRows] = await connection.query<RowDataPacket[]>(
          "SELECT * FROM payments WHERE order_id = ? AND status = 'captured' ORDER BY id DESC LIMIT 1 FOR UPDATE",
          [params.orderId]
        );
        if (payRows.length === 0) {
          const err = new Error('No captured payment found for this order to refund');
          (err as any).statusCode = 422;
          throw err;
        }
        const payment = payRows[0];

        const [sumRows] = await connection.query<RowDataPacket[]>(
          "SELECT COALESCE(SUM(amount_paise), 0) as total_refunded FROM refunds WHERE order_id = ? AND status != 'failed'",
          [params.orderId]
        );
        const alreadyRefunded = Number(sumRows[0]?.total_refunded || 0);
        const capturedAmount = Number(payment.amount_paise);
        const maxRefundable = capturedAmount - alreadyRefunded;

        // 4. Derive refund amount if line items provided
        let refundAmount = params.amountPaise || 0;
        if (params.lineItems && params.lineItems.length > 0) {
          let lineTotal = 0;
          for (const line of params.lineItems) {
            const [itRows] = await connection.query<RowDataPacket[]>(
              'SELECT * FROM order_items WHERE id = ? AND order_id = ?',
              [line.orderItemId, params.orderId]
            );
            if (itRows.length === 0) {
              throw new Error(`Order item ${line.orderItemId} not found on order`);
            }
            const item = itRows[0];
            if (line.quantity > Number(item.quantity)) {
              throw new Error(`Refund quantity cannot exceed ordered quantity for item ${item.title}`);
            }
            lineTotal += Number(item.price) * line.quantity;

            // Restock physical lines if requested
            if (params.restock && item.product_type === 'physical') {
              await connection.query(
                'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
                [line.quantity, item.product_id]
              );
              await connection.query(
                `INSERT INTO stock_movements (
                  product_id, quantity, change_type, reason, reference_id
                ) VALUES (?, ?, 'restock', 'Refund restock', ?)`,
                [item.product_id, line.quantity, order.order_number]
              );
            }

            // Digital lines revoke entitlement
            if (item.product_type === 'digital') {
              const handler = fulfilmentRegistry.get('digital');
              await handler.onRefund(
                { orderId: order.id, orderNumber: order.order_number, customerEmail: order.customer_email },
                item as any,
                line.quantity,
                connection
              );
              await connection.query(
                "UPDATE order_items SET fulfilment_status = 'revoked' WHERE id = ?",
                [item.id]
              );
            }
          }
          if (!params.amountPaise) {
            refundAmount = lineTotal;
          }
        }

        if (refundAmount <= 0) {
          throw new Error('Refund amount must be greater than zero');
        }
        if (refundAmount > maxRefundable) {
          const err = new Error(`Refund amount ${refundAmount} exceeds max refundable amount of ${maxRefundable} paise`);
          (err as any).statusCode = 422;
          throw err;
        }

        // 5. Gateway Refund
        const gateway = getPaymentGateway();
        const gatewayRes = await gateway.refund({
          paymentId: payment.gateway_payment_id,
          amountPaise: refundAmount,
          reason: params.reason,
        });

        // 6. Record Refund
        const [refInsert] = await connection.query<ResultSetHeader>(
          `INSERT INTO refunds (
            order_id, payment_id, amount_paise, status, gateway_refund_id,
            idempotency_key, restock, reason, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            params.orderId,
            payment.id,
            refundAmount,
            gatewayRes.status,
            gatewayRes.gatewayRefundId,
            params.idempotencyKey,
            params.restock || false,
            params.reason,
            params.actorId || null,
          ]
        );

        // 7. Update Order Status
        const newTotalRefunded = alreadyRefunded + refundAmount;
        const newStatus: OrderStatus = newTotalRefunded >= capturedAmount ? 'refunded' : 'partially_refunded';

        await connection.query(
          'UPDATE orders SET status = ?, payment_status = ? WHERE id = ?',
          [newStatus, newStatus, params.orderId]
        );

        await connection.query(
          `INSERT INTO order_status_history (
            order_id, from_status, to_status, actor, reason
          ) VALUES (?, ?, ?, ?, ?)`,
          [params.orderId, order.status, newStatus, `user_${params.actorId || 'admin'}`, params.reason]
        );

        // Generate formal Credit Note if order has an issued invoice
        await InvoiceService.generateCreditNote(
          {
            orderId: params.orderId,
            refundId: Number(refInsert.insertId),
            amountPaise: refundAmount,
            reason: params.reason,
          },
          connection
        );

        await connection.commit();
        return {
          id: refInsert.insertId,
          orderId: params.orderId,
          amountPaise: refundAmount,
          status: gatewayRes.status,
          gatewayRefundId: gatewayRes.gatewayRefundId,
        };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    });
  }

  // 13. State Transition Endpoint Logic
  static async transitionOrderStatus(
    orderId: number,
    targetStatus: OrderStatus,
    actor = 'admin',
    reason?: string
  ): Promise<OrderRecord> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? FOR UPDATE',
        [orderId]
      );
      if (rows.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }
      const order = rows[0];
      const currentStatus = order.status as OrderStatus;
      const orderKind = (order.order_kind || 'physical') as OrderKind;

      const allowed = canTransition(currentStatus, targetStatus, orderKind);
      if (!allowed) {
        await connection.rollback();
        const err = new Error(`Cannot transition order from status '${currentStatus}' to '${targetStatus}' for kind '${orderKind}'`);
        (err as any).statusCode = 409;
        (err as any).code = 'CONFLICT';
        throw err;
      }

      await connection.query(
        'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
        [targetStatus, orderId]
      );

      await connection.query(
        `INSERT INTO order_status_history (
          order_id, from_status, to_status, actor, reason
        ) VALUES (?, ?, ?, ?, ?)`,
        [orderId, currentStatus, targetStatus, actor, reason || `Manual transition to ${targetStatus}`]
      );

      // If transition to cancelled, release stock and coupons
      if (targetStatus === 'cancelled') {
        await this.releaseOrderStockAndCoupons(orderId, connection);
      }

      await connection.commit();
      const updated = await this.getOrderById(orderId, connection);
      return updated!;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // 14. Add Order Note
  static async addOrderNote(
    orderId: number,
    note: string,
    isCustomerVisible = false,
    createdBy?: number | null
  ): Promise<any> {
    const connection = await pool.getConnection();
    try {
      const [res] = await connection.query<ResultSetHeader>(
        `INSERT INTO order_notes (
          order_id, is_customer_visible, note, created_by
        ) VALUES (?, ?, ?, ?)`,
        [orderId, isCustomerVisible, note, createdBy || null]
      );
      return { id: res.insertId, orderId, isCustomerVisible, note, createdBy };
    } finally {
      connection.release();
    }
  }

  // 15. Background Job: Expire Unpaid Orders
  static async expireUnpaidOrders(): Promise<{ expiredCount: number }> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [expired] = await connection.query<RowDataPacket[]>(
        `SELECT id, order_number 
         FROM orders 
         WHERE status = 'pending_payment' 
           AND payment_method != 'cod' 
           AND expires_at IS NOT NULL 
           AND expires_at < NOW() 
         FOR UPDATE`
      );

      let count = 0;
      for (const ord of expired) {
        await connection.query(
          "UPDATE orders SET status = 'cancelled' WHERE id = ?",
          [ord.id]
        );

        await connection.query(
          `INSERT INTO order_status_history (
            order_id, from_status, to_status, actor, reason
          ) VALUES (?, 'pending_payment', 'cancelled', 'system', 'Order expired after online payment timeout')`,
          [ord.id]
        );

        await this.releaseOrderStockAndCoupons(ord.id, connection);
        count++;
      }

      await connection.commit();
      return { expiredCount: count };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // 16. Get Order Details by ID
  static async getOrderById(id: number, connection?: PoolConnection): Promise<OrderRecord | null> {
    const conn: PoolConnection = connection || (await pool.getConnection());
    const shouldRelease = !connection;
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ?',
        [id]
      );
      if (rows.length === 0) return null;
      const r = rows[0];

      const [items] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM order_items WHERE order_id = ?',
        [id]
      );

      return {
        id: Number(r.id),
        orderNumber: r.order_number,
        customerId: r.customer_id ? Number(r.customer_id) : null,
        customerEmail: r.customer_email,
        status: r.status,
        orderKind: r.order_kind,
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        paymentId: r.payment_id,
        invoiceId: r.invoice_id ? Number(r.invoice_id) : null,
        placeOfSupplyState: r.place_of_supply_state || null,
        buyerGstin: r.buyer_gstin || null,
        subtotal: Number(r.subtotal),
        taxTotal: Number(r.tax_total),
        shippingTotal: Number(r.shipping_total),
        shippingMethod: r.shipping_method || null,
        shippingCarrier: r.shipping_carrier || null,
        shippingAwb: r.shipping_awb || null,
        trackingNumber: r.tracking_number || null,
        discountTotal: Number(r.discount_total),
        codFeePaise: Number(r.cod_fee_paise || 0),
        codFeeTaxPaise: Number(r.cod_fee_tax_paise || 0),
        cgstPaise: Number(r.cgst_paise || 0),
        sgstPaise: Number(r.sgst_paise || 0),
        utgstPaise: Number(r.utgst_paise || 0),
        igstPaise: Number(r.igst_paise || 0),
        cessPaise: Number(r.cess_paise || 0),
        total: Number(r.total),
        currency: r.currency,
        shippingAddress: typeof r.shipping_address === 'string' ? JSON.parse(r.shipping_address) : r.shipping_address,
        billingAddress: typeof r.billing_address === 'string' ? JSON.parse(r.billing_address) : r.billing_address,
        billingState: r.billing_state,
        notes: r.notes,
        idempotencyKey: r.idempotency_key,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        guestAccessToken: r.guest_access_token,
        version: Number(r.version || 1),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
        items: items.map((it) => ({
          id: Number(it.id),
          productId: Number(it.product_id),
          variantId: it.variant_id ? Number(it.variant_id) : null,
          productType: it.product_type,
          fulfilmentStatus: it.fulfilment_status,
          title: it.title,
          sku: it.sku,
          price: Number(it.price),
          quantity: Number(it.quantity),
          taxClassId: it.tax_class_id ? Number(it.tax_class_id) : null,
          hsnCode: it.hsn_code || null,
          taxRateBasisPoints: Number(it.tax_rate_basis_points || 0),
          taxableAmountPaise: Number(it.taxable_amount_paise || 0),
          cgstPaise: Number(it.cgst_paise || 0),
          sgstPaise: Number(it.sgst_paise || 0),
          utgstPaise: Number(it.utgst_paise || 0),
          igstPaise: Number(it.igst_paise || 0),
          cessPaise: Number(it.cess_paise || 0),
          total: Number(it.total),
        })),
      };
    } finally {
      if (shouldRelease) {
        conn.release();
      }
    }
  }

  // 16b. Get Order Details by Order Number
  static async getOrderByNumber(orderNumber: string, connection?: PoolConnection): Promise<OrderRecord | null> {
    const conn: PoolConnection = connection || (await pool.getConnection());
    const shouldRelease = !connection;
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT id FROM orders WHERE order_number = ?',
        [orderNumber]
      );
      if (rows.length === 0) return null;
      return this.getOrderById(Number(rows[0].id), conn);
    } finally {
      if (shouldRelease) {
        conn.release();
      }
    }
  }

  // 17. List Orders (Admin)
  static async listOrders(filter?: {
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ data: OrderRecord[]; total: number }> {
    const page = Math.max(1, filter?.page || 1);
    const perPage = Math.min(100, Math.max(1, filter?.perPage || 20));
    const offset = (page - 1) * perPage;

    const connection = await pool.getConnection();
    try {
      let query = 'SELECT * FROM orders WHERE 1=1';
      const params: any[] = [];

      if (filter?.status) {
        query += ' AND status = ?';
        params.push(filter.status);
      }

      const countQuery = `SELECT COUNT(*) as cnt FROM (${query}) as sub`;
      const [countRows] = await connection.query<RowDataPacket[]>(countQuery, params);
      const total = Number(countRows[0]?.cnt || 0);

      query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
      params.push(perPage, offset);
      const [rows] = await connection.query<RowDataPacket[]>(query, params);

      const data: OrderRecord[] = rows.map((r) => ({
        id: Number(r.id),
        orderNumber: r.order_number,
        customerId: r.customer_id ? Number(r.customer_id) : null,
        customerEmail: r.customer_email,
        status: r.status,
        orderKind: r.order_kind,
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        paymentId: r.payment_id,
        subtotal: Number(r.subtotal),
        taxTotal: Number(r.tax_total),
        shippingTotal: Number(r.shipping_total),
        discountTotal: Number(r.discount_total),
        total: Number(r.total),
        currency: r.currency,
        shippingAddress: typeof r.shipping_address === 'string' ? JSON.parse(r.shipping_address) : r.shipping_address,
        billingAddress: typeof r.billing_address === 'string' ? JSON.parse(r.billing_address) : r.billing_address,
        billingState: r.billing_state,
        notes: r.notes,
        idempotencyKey: r.idempotency_key,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        guestAccessToken: r.guest_access_token,
        version: Number(r.version || 1),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));

      return { data, total };
    } finally {
      connection.release();
    }
  }

  // 18. Reviews
  static async listApprovedReviews(entityId: string): Promise<ReviewRecord[]> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM reviews WHERE entity_id = ? AND status = 'approved' ORDER BY id DESC",
        [entityId]
      );
      return rows.map((r) => ({
        id: Number(r.id),
        entityType: r.entity_type,
        entityId: r.entity_id,
        userId: r.user_id ? Number(r.user_id) : null,
        authorName: r.author_name,
        authorEmail: r.author_email,
        rating: Number(r.rating),
        comment: r.comment,
        status: r.status,
        createdAt: new Date(r.created_at).toISOString(),
      }));
    } finally {
      connection.release();
    }
  }

  static async submitReview(data: {
    entityId: string;
    entityType?: string;
    authorName: string;
    authorEmail?: string;
    rating: number;
    comment: string;
    userId?: number | null;
  }): Promise<ReviewRecord> {
    const connection = await pool.getConnection();
    try {
      const [res] = await connection.query<ResultSetHeader>(
        `INSERT INTO reviews (
          entity_id, entity_type, author_name, author_email, rating, comment, user_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          data.entityId,
          data.entityType || 'product',
          data.authorName,
          data.authorEmail || null,
          data.rating,
          data.comment,
          data.userId || null,
        ]
      );

      return {
        id: res.insertId,
        entityType: data.entityType || 'product',
        entityId: data.entityId,
        userId: data.userId || null,
        authorName: data.authorName,
        authorEmail: data.authorEmail || null,
        rating: data.rating,
        comment: data.comment,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
    } finally {
      connection.release();
    }
  }
}
