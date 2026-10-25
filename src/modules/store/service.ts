import { db } from '../../db/index.js';
import { products, orders, reviews, jobs } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { createHmac, randomBytes } from 'node:crypto';

export interface ProductRecord {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  sku?: string | null;
  price: number; // In paise / cents (e.g. 9900 = Rs 99)
  compareAtPrice?: number | null;
  costPrice?: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  status: 'draft' | 'active' | 'archived';
  isAgeRestricted: boolean;
  featuredImageId?: number | null;
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
  title: string;
  sku?: string;
  price: number;
  quantity: number;
}

export interface OrderRecord {
  id: number;
  orderNumber: string;
  customerId?: number | null;
  customerEmail: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  paymentMethod: 'razorpay' | 'cod';
  paymentStatus: 'pending' | 'captured' | 'failed' | 'refunded';
  paymentId?: string | null;
  subtotal: number;
  taxTotal: number;
  shippingTotal: number;
  discountTotal: number;
  total: number;
  currency: string;
  shippingAddress?: Record<string, unknown> | null;
  billingAddress?: Record<string, unknown> | null;
  notes?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items?: OrderItemInput[];
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

// In-memory fallbacks
const inMemoryProducts: ProductRecord[] = [
  {
    id: 1,
    name: 'Artisan Ceramic Mug',
    slug: 'artisan-ceramic-mug',
    description: 'Handcrafted stoneware ceramic mug with minimalist glaze finish.',
    sku: 'MUG-CRM-01',
    price: 79900, // Rs 799.00
    compareAtPrice: 99900,
    costPrice: 35000,
    stockQuantity: 45,
    lowStockThreshold: 5,
    trackInventory: true,
    status: 'active',
    isAgeRestricted: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'Organic Cotton Tote Bag',
    slug: 'organic-cotton-tote-bag',
    description: 'Durable heavyweight canvas tote bag with reinforced handles.',
    sku: 'TOTE-ORG-02',
    price: 49900, // Rs 499.00
    stockQuantity: 120,
    lowStockThreshold: 10,
    trackInventory: true,
    status: 'active',
    isAgeRestricted: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const inMemoryCoupons: CouponRecord[] = [
  {
    id: 1,
    code: 'WELCOME10',
    discountType: 'percentage',
    discountValue: 10, // 10%
    minOrderAmount: 50000, // Min Rs 500
    maxDiscountAmount: 20000, // Max Rs 200 off
    usageCount: 0,
    isActive: true,
  },
  {
    id: 2,
    code: 'FLAT100',
    discountType: 'fixed',
    discountValue: 10000, // Rs 100 off
    minOrderAmount: 99900,
    usageCount: 0,
    isActive: true,
  },
];

const inMemoryOrders: OrderRecord[] = [];
const inMemoryReviews: ReviewRecord[] = [];

export class StoreService {
  // --- Products ---
  static async listProducts(options?: {
    status?: 'draft' | 'active' | 'archived';
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ data: ProductRecord[]; total: number }> {
    const page = options?.page || 1;
    const perPage = options?.perPage || 10;
    let list = [...inMemoryProducts];

    if (options?.status) {
      list = list.filter(p => p.status === options.status);
    }
    if (options?.search) {
      const q = options.search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
    }

    try {
      const query = db.select().from(products).orderBy(desc(products.createdAt));
      const rows = await query;
      if (rows.length > 0) {
        list = rows.map(r => ({
          ...r,
          status: r.status as ProductRecord['status'],
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
        if (options?.status) {
          list = list.filter(p => p.status === options.status);
        }
      }
    } catch {
      // Fallback
    }

    const total = list.length;
    const paginated = list.slice((page - 1) * perPage, page * perPage);
    return { data: paginated, total };
  }

  static async getProductBySlug(slug: string): Promise<ProductRecord | null> {
    try {
      const rows = await db.select().from(products).where(eq(products.slug, slug));
      if (rows[0]) {
        return {
          ...rows[0],
          status: rows[0].status as ProductRecord['status'],
          createdAt: rows[0].createdAt.toISOString(),
          updatedAt: rows[0].updatedAt.toISOString(),
        };
      }
    } catch {
      // Fallback
    }
    return inMemoryProducts.find(p => p.slug === slug) || null;
  }

  static async getProductById(id: number): Promise<ProductRecord | null> {
    try {
      const rows = await db.select().from(products).where(eq(products.id, id));
      if (rows[0]) {
        return {
          ...rows[0],
          status: rows[0].status as ProductRecord['status'],
          createdAt: rows[0].createdAt.toISOString(),
          updatedAt: rows[0].updatedAt.toISOString(),
        };
      }
    } catch {
      // Fallback
    }
    return inMemoryProducts.find(p => p.id === id) || null;
  }

  static async createProduct(data: {
    name: string;
    slug: string;
    description?: string;
    sku?: string;
    price: number;
    compareAtPrice?: number;
    costPrice?: number;
    stockQuantity?: number;
    lowStockThreshold?: number;
    trackInventory?: boolean;
    status?: 'draft' | 'active' | 'archived';
    isAgeRestricted?: boolean;
    featuredImageId?: number;
  }): Promise<ProductRecord> {
    const prod: ProductRecord = {
      id: inMemoryProducts.length + 1,
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      sku: data.sku || null,
      price: data.price,
      compareAtPrice: data.compareAtPrice || null,
      costPrice: data.costPrice || null,
      stockQuantity: data.stockQuantity || 0,
      lowStockThreshold: data.lowStockThreshold || 5,
      trackInventory: data.trackInventory ?? true,
      status: data.status || 'draft',
      isAgeRestricted: data.isAgeRestricted || false,
      featuredImageId: data.featuredImageId || null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const [res] = await db.insert(products).values({
        name: prod.name,
        slug: prod.slug,
        description: prod.description,
        sku: prod.sku,
        price: prod.price,
        compareAtPrice: prod.compareAtPrice,
        costPrice: prod.costPrice,
        stockQuantity: prod.stockQuantity,
        lowStockThreshold: prod.lowStockThreshold,
        trackInventory: prod.trackInventory,
        status: prod.status,
        isAgeRestricted: prod.isAgeRestricted,
        featuredImageId: prod.featuredImageId,
        version: prod.version,
      });
      prod.id = Number(res.insertId);
    } catch {
      // Fallback
    }

    inMemoryProducts.push(prod);
    return prod;
  }

  static async updateProduct(id: number, data: Partial<ProductRecord>): Promise<ProductRecord | null> {
    const prod = inMemoryProducts.find(p => p.id === id);
    if (!prod) return null;

    Object.assign(prod, data, { updatedAt: new Date().toISOString(), version: prod.version + 1 });

    try {
      const rest = { ...data };
      delete rest.createdAt;
      delete rest.updatedAt;
      await db.update(products).set({ ...(rest as Record<string, unknown>), version: prod.version }).where(eq(products.id, id));
    } catch {
      // Fallback
    }

    return prod;
  }

  static async deleteProduct(id: number): Promise<boolean> {
    const idx = inMemoryProducts.findIndex(p => p.id === id);
    if (idx !== -1) inMemoryProducts.splice(idx, 1);
    try {
      await db.delete(products).where(eq(products.id, id));
    } catch {
      // Fallback
    }
    return true;
  }

  // --- Coupons ---
  static async validateCoupon(code: string, subtotal: number): Promise<{ valid: boolean; discountAmount: number; message?: string }> {
    const coupon = inMemoryCoupons.find(c => c.code.toUpperCase() === code.toUpperCase() && c.isActive);
    if (!coupon) {
      return { valid: false, discountAmount: 0, message: 'Invalid or inactive coupon code' };
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return { valid: false, discountAmount: 0, message: 'Coupon code has expired' };
    }
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return { valid: false, discountAmount: 0, message: 'Coupon usage limit reached' };
    }
    if (subtotal < coupon.minOrderAmount) {
      return {
        valid: false,
        discountAmount: 0,
        message: `Order subtotal must be at least ${(coupon.minOrderAmount / 100).toFixed(2)} to use this coupon`,
      };
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = Math.round((subtotal * coupon.discountValue) / 100);
      if (coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount) {
        discount = coupon.maxDiscountAmount;
      }
    } else {
      discount = coupon.discountValue;
    }

    return { valid: true, discountAmount: Math.min(discount, subtotal) };
  }

  // --- Orders & Checkout ---
  static calculateTotals(params: {
    items: OrderItemInput[];
    couponDiscount?: number;
    taxRatePercent?: number; // Standard GST e.g. 18%
    freeShippingThreshold?: number; // e.g. Rs 999 (99900 paise)
    flatShippingFee?: number; // e.g. Rs 99 (9900 paise)
  }): { subtotal: number; discountTotal: number; taxTotal: number; shippingTotal: number; total: number } {
    const subtotal = params.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountTotal = params.couponDiscount || 0;
    const taxableAmount = Math.max(0, subtotal - discountTotal);

    const taxRate = params.taxRatePercent !== undefined ? params.taxRatePercent : 18;
    const taxTotal = Math.round((taxableAmount * taxRate) / 100);

    const threshold = params.freeShippingThreshold || 99900;
    const fee = params.flatShippingFee !== undefined ? params.flatShippingFee : 9900;
    const shippingTotal = taxableAmount >= threshold ? 0 : fee;

    const total = taxableAmount + taxTotal + shippingTotal;
    return { subtotal, discountTotal, taxTotal, shippingTotal, total };
  }

  static async createOrder(data: {
    customerEmail: string;
    items: OrderItemInput[];
    paymentMethod: 'razorpay' | 'cod';
    shippingAddress: Record<string, unknown>;
    billingAddress?: Record<string, unknown>;
    couponCode?: string;
    notes?: string;
  }): Promise<OrderRecord> {
    if (!data.items || data.items.length === 0) {
      throw new Error('Order items cannot be empty');
    }

    const verifiedItems: OrderItemInput[] = [];
    for (const item of data.items) {
      const product = await this.getProductById(item.productId);
      if (!product || product.status !== 'active') {
        throw new Error(`Product with ID ${item.productId} is unavailable`);
      }
      if (product.trackInventory && product.stockQuantity < item.quantity) {
        throw new Error(`Insufficient stock for product '${product.name}' (available: ${product.stockQuantity})`);
      }
      verifiedItems.push({
        ...item,
        price: product.price, // Server enforces authoritative catalog price!
        title: product.name,
      });
    }

    let couponDiscount = 0;
    if (data.couponCode) {
      const subtotalCheck = verifiedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const validation = await this.validateCoupon(data.couponCode, subtotalCheck);
      if (validation.valid) {
        couponDiscount = validation.discountAmount;
      }
    }

    const { subtotal, discountTotal, taxTotal, shippingTotal, total } = this.calculateTotals({
      items: verifiedItems,
      couponDiscount,
    });

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${randomBytes(2).toString('hex').toUpperCase()}`;

    const order: OrderRecord = {
      id: inMemoryOrders.length + 1,
      orderNumber,
      customerEmail: data.customerEmail,
      status: 'pending',
      paymentMethod: data.paymentMethod,
      paymentStatus: data.paymentMethod === 'cod' ? 'pending' : 'pending',
      subtotal,
      taxTotal,
      shippingTotal,
      discountTotal,
      total,
      currency: 'INR',
      shippingAddress: data.shippingAddress,
      billingAddress: data.billingAddress || data.shippingAddress,
      notes: data.notes || null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: verifiedItems,
    };

    // Deduct inventory
    for (const item of verifiedItems) {
      const product = inMemoryProducts.find(p => p.id === item.productId);
      if (product && product.trackInventory) {
        product.stockQuantity = Math.max(0, product.stockQuantity - item.quantity);
        if (product.stockQuantity <= product.lowStockThreshold) {
          try {
            await db.insert(jobs).values({
              queue: 'email',
              jobType: 'admin_low_stock',
              payload: JSON.stringify({
                productId: product.id,
                productName: product.name,
                remainingStock: product.stockQuantity,
                threshold: product.lowStockThreshold,
              }),
              status: 'pending',
            });
          } catch {
            // Fallback
          }
        }
      }
    }

    try {
      const [res] = await db.insert(orders).values({
        orderNumber: order.orderNumber,
        customerEmail: order.customerEmail,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        subtotal: order.subtotal,
        taxTotal: order.taxTotal,
        shippingTotal: order.shippingTotal,
        discountTotal: order.discountTotal,
        total: order.total,
        currency: order.currency,
        shippingAddress: JSON.stringify(order.shippingAddress),
        billingAddress: JSON.stringify(order.billingAddress),
        notes: order.notes,
        version: 1,
      });
      order.id = Number(res.insertId);

      // Enqueue order confirmation email job
      await db.insert(jobs).values({
        queue: 'email',
        jobType: 'order_placed',
        payload: JSON.stringify({
          orderNumber: order.orderNumber,
          recipient: order.customerEmail,
          total: (order.total / 100).toFixed(2),
        }),
        status: 'pending',
      });
    } catch {
      // Fallback
    }

    inMemoryOrders.push(order);
    return order;
  }

  static verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
    const generated = createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return generated === signature;
  }

  static async markOrderPaid(orderNumber: string, paymentId: string): Promise<OrderRecord | null> {
    const order = inMemoryOrders.find(o => o.orderNumber === orderNumber);
    if (!order) return null;

    order.paymentStatus = 'captured';
    order.status = 'processing';
    order.paymentId = paymentId;
    order.updatedAt = new Date().toISOString();

    try {
      await db.update(orders).set({
        paymentStatus: 'captured',
        status: 'processing',
        paymentId,
      }).where(eq(orders.orderNumber, orderNumber));
    } catch {
      // Fallback
    }

    return order;
  }

  static async updateOrderStatus(orderId: number, status: OrderRecord['status']): Promise<OrderRecord | null> {
    const order = inMemoryOrders.find(o => o.id === orderId);
    if (!order) return null;

    order.status = status;
    order.updatedAt = new Date().toISOString();

    try {
      await db.update(orders).set({ status }).where(eq(orders.id, orderId));
    } catch {
      // Fallback
    }

    return order;
  }

  static async listOrders(options?: { status?: string; page?: number; perPage?: number }): Promise<{ data: OrderRecord[]; total: number }> {
    const page = options?.page || 1;
    const perPage = options?.perPage || 10;
    let list = [...inMemoryOrders];

    if (options?.status) {
      list = list.filter(o => o.status === options.status);
    }

    try {
      const query = db.select().from(orders).orderBy(desc(orders.createdAt));
      const rows = await query;
      if (rows.length > 0) {
        list = rows.map(r => ({
          ...r,
          status: r.status as OrderRecord['status'],
          paymentMethod: r.paymentMethod as 'razorpay' | 'cod',
          paymentStatus: r.paymentStatus as 'pending' | 'captured' | 'failed' | 'refunded',
          shippingAddress: typeof r.shippingAddress === 'string' ? JSON.parse(r.shippingAddress) : (r.shippingAddress as Record<string, unknown>),
          billingAddress: typeof r.billingAddress === 'string' ? JSON.parse(r.billingAddress) : (r.billingAddress as Record<string, unknown>),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
      }
    } catch {
      // Fallback
    }

    const total = list.length;
    return { data: list.slice((page - 1) * perPage, page * perPage), total };
  }

  // --- Reviews & Moderation ---
  static async submitReview(data: {
    entityType?: string;
    entityId: string;
    authorName: string;
    authorEmail?: string;
    rating: number;
    comment: string;
  }): Promise<ReviewRecord> {
    if (data.rating < 1 || data.rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const rev: ReviewRecord = {
      id: inMemoryReviews.length + 1,
      entityType: data.entityType || 'product',
      entityId: data.entityId,
      authorName: data.authorName,
      authorEmail: data.authorEmail || null,
      rating: data.rating,
      comment: data.comment,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    try {
      const [res] = await db.insert(reviews).values({
        entityType: rev.entityType,
        entityId: rev.entityId,
        authorName: rev.authorName,
        authorEmail: rev.authorEmail,
        rating: rev.rating,
        comment: rev.comment,
        status: rev.status,
      });
      rev.id = Number(res.insertId);
    } catch {
      // Fallback
    }

    inMemoryReviews.push(rev);
    return rev;
  }

  static async listApprovedReviews(entityId: string): Promise<ReviewRecord[]> {
    return inMemoryReviews.filter(r => r.entityId === entityId && r.status === 'approved');
  }

  static async moderateReview(id: number, status: 'approved' | 'rejected'): Promise<boolean> {
    const rev = inMemoryReviews.find(r => r.id === id);
    if (rev) rev.status = status;
    try {
      await db.update(reviews).set({ status }).where(eq(reviews.id, id));
    } catch {
      // Fallback
    }
    return true;
  }
}
