import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../../db/pool.js';
import { hashPassword, verifyPassword } from '../../utils/crypto.js';
import { DigitalDeliveryService } from '../digital/service.js';

export interface CustomerProfileDTO {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  communicationPreferences: {
    emailMarketing: boolean;
    smsOrderUpdates: boolean;
    whatsappUpdates: boolean;
  };
  customerSegment: string;
  totalOrders: number;
  totalSpentPaise: number;
  createdAt: string;
}

export interface CustomerAddressDTO {
  id: number;
  userId: number;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  stateCode: string | null;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WishlistItemDTO {
  id: number;
  productId: number;
  productName: string;
  slug: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  addedAt: string;
}

export interface ReturnRequestDTO {
  id: number;
  orderId: number;
  orderNumber: string;
  orderItemId: number;
  itemTitle: string;
  customerId: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export class CustomerService {
  // 1. Profile Management
  public static async getProfile(userId: number): Promise<CustomerProfileDTO> {
    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, email, phone, date_of_birth, communication_preferences, customer_segment, created_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error('Customer account not found');
    }

    const u = userRows[0];

    // Compute order stats
    const [statsRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total_orders,
              COALESCE(SUM(CASE WHEN payment_status = 'captured' THEN total ELSE 0 END), 0) as total_spent
       FROM orders WHERE customer_id = ? OR customer_email = ?`,
      [userId, u.email]
    );

    const stats = statsRows[0] || { total_orders: 0, total_spent: 0 };

    let commPrefs = {
      emailMarketing: true,
      smsOrderUpdates: true,
      whatsappUpdates: false,
    };
    if (u.communication_preferences) {
      try {
        const parsed = typeof u.communication_preferences === 'string'
          ? JSON.parse(u.communication_preferences)
          : u.communication_preferences;
        commPrefs = { ...commPrefs, ...parsed };
      } catch {
        // use default
      }
    }

    return {
      id: Number(u.id),
      name: u.name,
      email: u.email,
      phone: u.phone || null,
      dateOfBirth: u.date_of_birth || null,
      communicationPreferences: commPrefs,
      customerSegment: u.customer_segment || 'standard',
      totalOrders: Number(stats.total_orders || 0),
      totalSpentPaise: Number(stats.total_spent || 0),
      createdAt: u.created_at,
    };
  }

  public static async updateProfile(
    userId: number,
    data: {
      name?: string;
      phone?: string;
      dateOfBirth?: string;
      communicationPreferences?: {
        emailMarketing?: boolean;
        smsOrderUpdates?: boolean;
        whatsappUpdates?: boolean;
      };
    }
  ): Promise<CustomerProfileDTO> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name.trim());
    }
    if (data.phone !== undefined) {
      fields.push('phone = ?');
      values.push(data.phone.trim());
    }
    if (data.dateOfBirth !== undefined) {
      fields.push('date_of_birth = ?');
      values.push(data.dateOfBirth);
    }
    if (data.communicationPreferences !== undefined) {
      fields.push('communication_preferences = ?');
      values.push(JSON.stringify(data.communicationPreferences));
    }

    if (fields.length > 0) {
      values.push(userId);
      await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    return this.getProfile(userId);
  }

  public static async changePassword(
    userId: number,
    currentPass: string,
    newPass: string
  ): Promise<{ success: boolean }> {
    const [userRows] = await pool.query<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error('User not found');
    }

    const isValid = await verifyPassword(currentPass, userRows[0].password_hash);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    if (newPass.length < 8) {
      throw new Error('New password must be at least 8 characters long');
    }

    const newHash = await hashPassword(newPass);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    // Invalidate sessions
    await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);

    return { success: true };
  }

  // 2. Saved Addresses
  public static async listAddresses(userId: number): Promise<CustomerAddressDTO[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, user_id, full_name, phone, address_line1, address_line2, city, state, state_code,
              postal_code, country, is_default, created_at, updated_at
       FROM customer_addresses
       WHERE user_id = ?
       ORDER BY is_default DESC, id DESC`,
      [userId]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
      fullName: r.full_name,
      phone: r.phone,
      addressLine1: r.address_line1,
      addressLine2: r.address_line2 || null,
      city: r.city,
      state: r.state,
      stateCode: r.state_code || null,
      postalCode: r.postal_code,
      country: r.country,
      isDefault: Boolean(r.is_default),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public static async addAddress(
    userId: number,
    data: {
      fullName: string;
      phone: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      state: string;
      stateCode?: string;
      postalCode: string;
      country?: string;
      isDefault?: boolean;
    }
  ): Promise<CustomerAddressDTO> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Check if user has existing addresses
      const [existing] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM customer_addresses WHERE user_id = ?',
        [userId]
      );

      const shouldBeDefault = existing.length === 0 || Boolean(data.isDefault);

      if (shouldBeDefault) {
        await connection.query('UPDATE customer_addresses SET is_default = FALSE WHERE user_id = ?', [
          userId,
        ]);
      }

      const [res] = await connection.query<ResultSetHeader>(
        `INSERT INTO customer_addresses (
          user_id, full_name, phone, address_line1, address_line2, city, state, state_code,
          postal_code, country, is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          data.fullName.trim(),
          data.phone.trim(),
          data.addressLine1.trim(),
          data.addressLine2?.trim() || null,
          data.city.trim(),
          data.state.trim(),
          data.stateCode?.trim() || null,
          data.postalCode.trim(),
          data.country?.trim() || 'IN',
          shouldBeDefault,
        ]
      );

      await connection.commit();

      const [created] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM customer_addresses WHERE id = ?',
        [res.insertId]
      );
      const r = created[0];
      return {
        id: Number(r.id),
        userId: Number(r.user_id),
        fullName: r.full_name,
        phone: r.phone,
        addressLine1: r.address_line1,
        addressLine2: r.address_line2 || null,
        city: r.city,
        state: r.state,
        stateCode: r.state_code || null,
        postalCode: r.postal_code,
        country: r.country,
        isDefault: Boolean(r.is_default),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  public static async updateAddress(
    userId: number,
    addressId: number,
    data: {
      fullName?: string;
      phone?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      stateCode?: string;
      postalCode?: string;
      country?: string;
      isDefault?: boolean;
    }
  ): Promise<CustomerAddressDTO> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existing] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM customer_addresses WHERE id = ? AND user_id = ?',
        [addressId, userId]
      );

      if (existing.length === 0) {
        throw new Error('Address not found or unauthorized');
      }

      if (data.isDefault) {
        await connection.query('UPDATE customer_addresses SET is_default = FALSE WHERE user_id = ?', [
          userId,
        ]);
      }

      const fields: string[] = [];
      const values: any[] = [];

      if (data.fullName !== undefined) {
        fields.push('full_name = ?');
        values.push(data.fullName.trim());
      }
      if (data.phone !== undefined) {
        fields.push('phone = ?');
        values.push(data.phone.trim());
      }
      if (data.addressLine1 !== undefined) {
        fields.push('address_line1 = ?');
        values.push(data.addressLine1.trim());
      }
      if (data.addressLine2 !== undefined) {
        fields.push('address_line2 = ?');
        values.push(data.addressLine2.trim());
      }
      if (data.city !== undefined) {
        fields.push('city = ?');
        values.push(data.city.trim());
      }
      if (data.state !== undefined) {
        fields.push('state = ?');
        values.push(data.state.trim());
      }
      if (data.stateCode !== undefined) {
        fields.push('state_code = ?');
        values.push(data.stateCode.trim());
      }
      if (data.postalCode !== undefined) {
        fields.push('postal_code = ?');
        values.push(data.postalCode.trim());
      }
      if (data.country !== undefined) {
        fields.push('country = ?');
        values.push(data.country.trim());
      }
      if (data.isDefault !== undefined) {
        fields.push('is_default = ?');
        values.push(data.isDefault);
      }

      if (fields.length > 0) {
        values.push(addressId);
        await connection.query(`UPDATE customer_addresses SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      await connection.commit();

      const [updated] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM customer_addresses WHERE id = ?',
        [addressId]
      );
      const r = updated[0];
      return {
        id: Number(r.id),
        userId: Number(r.user_id),
        fullName: r.full_name,
        phone: r.phone,
        addressLine1: r.address_line1,
        addressLine2: r.address_line2 || null,
        city: r.city,
        state: r.state,
        stateCode: r.state_code || null,
        postalCode: r.postal_code,
        country: r.country,
        isDefault: Boolean(r.is_default),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  public static async deleteAddress(userId: number, addressId: number): Promise<{ success: boolean }> {
    const [res] = await pool.query<ResultSetHeader>(
      'DELETE FROM customer_addresses WHERE id = ? AND user_id = ?',
      [addressId, userId]
    );
    if (res.affectedRows === 0) {
      throw new Error('Address not found or unauthorized');
    }
    return { success: true };
  }

  public static async setDefaultAddress(
    userId: number,
    addressId: number
  ): Promise<CustomerAddressDTO> {
    return this.updateAddress(userId, addressId, { isDefault: true });
  }

  // 3. Wishlist Management
  public static async listWishlist(userId: number): Promise<WishlistItemDTO[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT w.id, w.product_id, w.created_at as added_at,
              p.name as product_name, p.slug, p.price, p.stock_quantity, (p.status = 'active') as is_active
       FROM customer_wishlist w
       JOIN products p ON w.product_id = p.id
       WHERE w.user_id = ?
       ORDER BY w.id DESC`,
      [userId]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      productId: Number(r.product_id),
      productName: r.product_name,
      slug: r.slug,
      price: Number(r.price),
      stockQuantity: Number(r.stock_quantity),
      isActive: Boolean(r.is_active),
      addedAt: r.added_at,
    }));
  }

  public static async addToWishlist(
    userId: number,
    productId: number
  ): Promise<{ success: boolean; wishlistCount: number }> {
    const [prod] = await pool.query<RowDataPacket[]>(
      'SELECT id, status FROM products WHERE id = ?',
      [productId]
    );
    if (prod.length === 0 || prod[0].status !== 'active') {
      throw new Error('Product not found or inactive');
    }

    await pool.query(
      `INSERT INTO customer_wishlist (user_id, product_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [userId, productId]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM customer_wishlist WHERE user_id = ?',
      [userId]
    );

    return { success: true, wishlistCount: Number(countRows[0].total) };
  }

  public static async removeFromWishlist(
    userId: number,
    productId: number
  ): Promise<{ success: boolean; wishlistCount: number }> {
    await pool.query('DELETE FROM customer_wishlist WHERE user_id = ? AND product_id = ?', [
      userId,
      productId,
    ]);

    const [countRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM customer_wishlist WHERE user_id = ?',
      [userId]
    );

    return { success: true, wishlistCount: Number(countRows[0].total) };
  }

  // 4. Order History & Reorder
  public static async listCustomerOrders(
    userId: number,
    userEmail: string,
    params: { page?: number; perPage?: number; status?: string }
  ): Promise<{ orders: any[]; total: number; page: number; perPage: number }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 10));
    const offset = (page - 1) * perPage;

    let whereClause = '(customer_id = ? OR customer_email = ?)';
    const values: any[] = [userId, userEmail];

    if (params.status) {
      whereClause += ' AND status = ?';
      values.push(params.status);
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM orders WHERE ${whereClause}`,
      values
    );
    const total = Number(countRows[0].total);

    const [orders] = await pool.query<RowDataPacket[]>(
      `SELECT id, order_number, status, order_kind, payment_status, payment_method,
              subtotal, tax_total, shipping_total, discount_total, total, currency,
              shipping_carrier, shipping_awb, tracking_number, created_at
       FROM orders
       WHERE ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...values, perPage, offset]
    );

    return {
      orders: orders.map((o) => ({
        id: Number(o.id),
        orderNumber: o.order_number,
        status: o.status,
        orderKind: o.order_kind,
        paymentStatus: o.payment_status,
        paymentMethod: o.payment_method,
        subtotal: Number(o.subtotal),
        taxTotal: Number(o.tax_total),
        shippingTotal: Number(o.shipping_total),
        discountTotal: Number(o.discount_total),
        total: Number(o.total),
        currency: o.currency,
        shippingCarrier: o.shipping_carrier || null,
        shippingAwb: o.shipping_awb || null,
        trackingNumber: o.tracking_number || null,
        trackingUrl: o.tracking_number
          ? `/api/v1/shipping/track/${o.tracking_number}`
          : null,
        createdAt: o.created_at,
      })),
      total,
      page,
      perPage,
    };
  }

  public static async getCustomerOrder(
    userId: number,
    userEmail: string,
    orderId: number
  ): Promise<any> {
    const [orderRows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR customer_email = ?)`,
      [orderId, userId, userEmail]
    );

    if (orderRows.length === 0) {
      throw new Error('Order not found or unauthorized');
    }

    const order = orderRows[0];

    // Fetch line items
    const [items] = await pool.query<RowDataPacket[]>(
      `SELECT id, product_id, variant_id, product_type, fulfilment_status, title, sku, price, quantity, total
       FROM order_items WHERE order_id = ?`,
      [orderId]
    );

    // Fetch entitlements if digital
    let entitlements: any[] = [];
    if (order.order_kind === 'digital' || order.order_kind === 'mixed') {
      try {
        entitlements = await DigitalDeliveryService.getOrderEntitlements(orderId);
      } catch {
        // ignore if digital module disabled
      }
    }

    // Invoice details
    let invoiceNumber: string | null = null;
    if (order.invoice_id) {
      const [inv] = await pool.query<RowDataPacket[]>(
        'SELECT invoice_number FROM invoices WHERE id = ?',
        [order.invoice_id]
      );
      if (inv.length > 0) invoiceNumber = inv[0].invoice_number;
    }

    return {
      id: Number(order.id),
      orderNumber: order.order_number,
      status: order.status,
      orderKind: order.order_kind,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.tax_total),
      shippingTotal: Number(order.shipping_total),
      discountTotal: Number(order.discount_total),
      total: Number(order.total),
      currency: order.currency,
      shippingAddress: typeof order.shipping_address === 'string'
        ? JSON.parse(order.shipping_address)
        : order.shipping_address,
      billingAddress: typeof order.billing_address === 'string'
        ? JSON.parse(order.billing_address)
        : order.billing_address,
      shippingCarrier: order.shipping_carrier || null,
      shippingAwb: order.shipping_awb || null,
      trackingNumber: order.tracking_number || null,
      trackingUrl: order.tracking_number
        ? `/api/v1/shipping/track/${order.tracking_number}`
        : null,
      invoiceNumber,
      invoicePdfUrl: invoiceNumber ? `/api/v1/store/orders/${order.id}/invoice/pdf` : null,
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
        total: Number(it.total),
      })),
      digitalEntitlements: entitlements,
      createdAt: order.created_at,
    };
  }

  public static async prepareReorder(
    userId: number,
    userEmail: string,
    orderId: number
  ): Promise<{ items: any[]; canReorder: boolean }> {
    const [orderRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM orders WHERE id = ? AND (customer_id = ? OR customer_email = ?)`,
      [orderId, userId, userEmail]
    );

    if (orderRows.length === 0) {
      throw new Error('Order not found or unauthorized');
    }

    const [items] = await pool.query<RowDataPacket[]>(
      `SELECT oi.product_id, oi.variant_id, oi.quantity, oi.title, oi.price,
              (p.status = 'active') as is_active, p.stock_quantity, p.track_stock, p.price as current_price
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const reorderItems = items.map((it) => {
      let available = Boolean(it.is_active);
      let reason: string | undefined;

      if (!it.is_active) {
        available = false;
        reason = 'Product is no longer active';
      } else if (it.track_stock && it.stock_quantity < it.quantity) {
        available = false;
        reason = `Insufficient stock (available: ${it.stock_quantity})`;
      }

      return {
        productId: Number(it.product_id),
        variantId: it.variant_id ? Number(it.variant_id) : null,
        title: it.title,
        quantity: Number(it.quantity),
        price: Number(it.current_price),
        available,
        reason,
      };
    });

    const canReorder = reorderItems.length > 0 && reorderItems.every((i) => i.available);

    return { items: reorderItems, canReorder };
  }

  // 5. Customer Return Requests
  public static async submitReturnRequest(
    userId: number,
    userEmail: string,
    data: { orderId: number; orderItemId: number; reason: string }
  ): Promise<ReturnRequestDTO> {
    const [orderRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, order_number, status FROM orders WHERE id = ? AND (customer_id = ? OR customer_email = ?)`,
      [data.orderId, userId, userEmail]
    );

    if (orderRows.length === 0) {
      throw new Error('Order not found or unauthorized');
    }

    const order = orderRows[0];
    const eligibleStatuses = ['completed', 'delivered', 'fulfilled'];
    if (!eligibleStatuses.includes(order.status)) {
      throw new Error(`Return requests can only be placed on delivered or completed orders (current status: ${order.status})`);
    }

    const [itemRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, product_type FROM order_items WHERE id = ? AND order_id = ?`,
      [data.orderItemId, data.orderId]
    );

    if (itemRows.length === 0) {
      throw new Error('Order item not found in specified order');
    }

    if (itemRows[0].product_type === 'digital') {
      throw new Error('Digital products are non-returnable; please contact support for refund inquiries');
    }

    // Check if duplicate request exists
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM order_return_requests WHERE order_item_id = ? AND status IN ('pending', 'approved')`,
      [data.orderItemId]
    );

    if (existing.length > 0) {
      throw new Error('An active return request already exists for this line item');
    }

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO order_return_requests (order_id, order_item_id, customer_id, reason, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [data.orderId, data.orderItemId, userId, data.reason.trim()]
    );

    return {
      id: Number(res.insertId),
      orderId: data.orderId,
      orderNumber: order.order_number,
      orderItemId: data.orderItemId,
      itemTitle: itemRows[0].title,
      customerId: userId,
      reason: data.reason.trim(),
      status: 'pending',
      adminNotes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public static async listCustomerReturnRequests(userId: number): Promise<ReturnRequestDTO[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.order_id, r.order_item_id, r.customer_id, r.reason, r.status, r.admin_notes,
              r.created_at, r.updated_at, o.order_number, oi.title as item_title
       FROM order_return_requests r
       JOIN orders o ON r.order_id = o.id
       JOIN order_items oi ON r.order_item_id = oi.id
       WHERE r.customer_id = ?
       ORDER BY r.id DESC`,
      [userId]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      orderId: Number(r.order_id),
      orderNumber: r.order_number,
      orderItemId: Number(r.order_item_id),
      itemTitle: r.item_title,
      customerId: Number(r.customer_id),
      reason: r.reason,
      status: r.status,
      adminNotes: r.admin_notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // 6. DPDP Act Compliance (Export & Delete)
  public static async exportPersonalData(userId: number): Promise<any> {
    const profile = await this.getProfile(userId);
    const addresses = await this.listAddresses(userId);
    const wishlist = await this.listWishlist(userId);
    const returnRequests = await this.listCustomerReturnRequests(userId);

    const [orders] = await pool.query<RowDataPacket[]>(
      `SELECT id, order_number, status, payment_status, total, currency, created_at
       FROM orders WHERE customer_id = ? OR customer_email = ?`,
      [userId, profile.email]
    );

    const [reviews] = await pool.query<RowDataPacket[]>(
      `SELECT id, entity_id, rating, comment, created_at FROM reviews WHERE user_id = ?`,
      [userId]
    );

    const exportPayload = {
      exportDate: new Date().toISOString(),
      profile,
      addresses,
      orders,
      returnRequests,
      wishlist,
      reviews,
    };

    await pool.query(
      `INSERT INTO customer_data_requests (user_id, request_type, status, export_payload, completed_at)
       VALUES (?, 'export', 'completed', ?, NOW())`,
      [userId, JSON.stringify(exportPayload)]
    );

    return exportPayload;
  }

  public static async deleteAccount(
    userId: number,
    passwordConfirm: string
  ): Promise<{ success: boolean; message: string }> {
    const [userRows] = await pool.query<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error('User not found');
    }

    const isValid = await verifyPassword(passwordConfirm, userRows[0].password_hash);
    if (!isValid) {
      throw new Error('Invalid password confirmation');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Anonymize user record
      const anonEmail = `anonymized_${userId}_${Date.now()}@deleted.local`;
      await connection.query(
        `UPDATE users
         SET name = 'Anonymized Customer',
             email = ?,
             phone = NULL,
             date_of_birth = NULL,
             communication_preferences = NULL,
             is_active = FALSE
         WHERE id = ?`,
        [anonEmail, userId]
      );

      // Clean personal data tables
      await connection.query('DELETE FROM customer_addresses WHERE user_id = ?', [userId]);
      await connection.query('DELETE FROM customer_wishlist WHERE user_id = ?', [userId]);
      await connection.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await connection.query('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);

      // Record DPDP request
      await connection.query(
        `INSERT INTO customer_data_requests (user_id, request_type, status, completed_at)
         VALUES (?, 'delete', 'completed', NOW())`,
        [userId]
      );

      await connection.commit();
      return { success: true, message: 'Account anonymized and personal data erased under DPDP rules.' };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // 7. Admin Customer Management
  public static async adminListCustomers(params: {
    page?: number;
    perPage?: number;
    search?: string;
    segment?: string;
  }): Promise<{ customers: any[]; total: number; page: number; perPage: number }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 10));
    const offset = (page - 1) * perPage;

    let whereSql = `WHERE (r.name = 'customer' OR o.id IS NOT NULL)`;
    const values: any[] = [];

    if (params.search) {
      whereSql += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
      const term = `%${params.search}%`;
      values.push(term, term, term);
    }

    if (params.segment) {
      whereSql += ` AND u.customer_segment = ?`;
      values.push(params.segment);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.phone, u.customer_segment, u.created_at, u.is_active,
              COUNT(DISTINCT o.id) as total_orders,
              COALESCE(SUM(CASE WHEN o.payment_status = 'captured' THEN o.total ELSE 0 END), 0) as total_spent_paise
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN orders o ON (o.customer_id = u.id OR o.customer_email = u.email)
       ${whereSql}
       GROUP BY u.id
       ORDER BY total_spent_paise DESC, u.id DESC
       LIMIT ? OFFSET ?`,
      [...values, perPage, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT u.id) as total
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN orders o ON (o.customer_id = u.id OR o.customer_email = u.email)
       ${whereSql}`,
      values
    );

    const total = Number(countRows[0]?.total || 0);

    return {
      customers: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        email: r.email,
        phone: r.phone || null,
        customerSegment: r.customer_segment || 'standard',
        totalOrders: Number(r.total_orders || 0),
        totalSpentPaise: Number(r.total_spent_paise || 0),
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
      })),
      total,
      page,
      perPage,
    };
  }

  public static async adminGetCustomer(customerId: number): Promise<any> {
    const profile = await this.getProfile(customerId);
    const addresses = await this.listAddresses(customerId);
    const wishlist = await this.listWishlist(customerId);
    const returnRequests = await this.listCustomerReturnRequests(customerId);

    const [orders] = await pool.query<RowDataPacket[]>(
      `SELECT id, order_number, status, payment_status, total, currency, created_at
       FROM orders WHERE customer_id = ? OR customer_email = ?
       ORDER BY id DESC`,
      [customerId, profile.email]
    );

    const [notes] = await pool.query<RowDataPacket[]>(
      `SELECT cn.id, cn.note, cn.created_at, u.name as author_name
       FROM customer_notes cn
       JOIN users u ON cn.author_id = u.id
       WHERE cn.customer_id = ?
       ORDER BY cn.id DESC`,
      [customerId]
    );

    return {
      profile,
      addresses,
      orders: orders.map((o) => ({
        id: Number(o.id),
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        total: Number(o.total),
        currency: o.currency,
        createdAt: o.created_at,
      })),
      wishlist,
      returnRequests,
      notes: notes.map((n) => ({
        id: Number(n.id),
        note: n.note,
        authorName: n.author_name,
        createdAt: n.created_at,
      })),
    };
  }

  public static async adminUpdateSegment(
    customerId: number,
    segment: string
  ): Promise<{ success: boolean; customerSegment: string }> {
    const validSegments = ['standard', 'vip', 'wholesale', 'at_risk'];
    if (!validSegments.includes(segment)) {
      throw new Error(`Invalid customer segment. Must be one of: ${validSegments.join(', ')}`);
    }

    const [res] = await pool.query<ResultSetHeader>(
      'UPDATE users SET customer_segment = ? WHERE id = ?',
      [segment, customerId]
    );

    if (res.affectedRows === 0) {
      throw new Error('Customer not found');
    }

    return { success: true, customerSegment: segment };
  }

  public static async adminAddNote(
    customerId: number,
    authorId: number,
    note: string
  ): Promise<{ id: number; note: string; createdAt: string }> {
    const [res] = await pool.query<ResultSetHeader>(
      'INSERT INTO customer_notes (customer_id, author_id, note) VALUES (?, ?, ?)',
      [customerId, authorId, note.trim()]
    );

    return {
      id: Number(res.insertId),
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };
  }

  public static async adminExportCustomersCsv(): Promise<string> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.phone, u.customer_segment, u.created_at,
              COUNT(DISTINCT o.id) as total_orders,
              COALESCE(SUM(CASE WHEN o.payment_status = 'captured' THEN o.total ELSE 0 END), 0) as total_spent_paise
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN orders o ON (o.customer_id = u.id OR o.customer_email = u.email)
       WHERE (r.name = 'customer' OR o.id IS NOT NULL)
       GROUP BY u.id
       ORDER BY total_spent_paise DESC, u.id DESC`
    );

    const headers = [
      'Customer ID',
      'Name',
      'Email',
      'Phone',
      'Segment',
      'Total Orders',
      'Total Spent (Paise)',
      'Registered At',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvLines = [headers.join(',')];
    for (const r of rows) {
      csvLines.push(
        [
          r.id,
          escapeCsv(r.name),
          escapeCsv(r.email),
          escapeCsv(r.phone),
          escapeCsv(r.customer_segment),
          r.total_orders,
          r.total_spent_paise,
          escapeCsv(r.created_at),
        ].join(',')
      );
    }

    return csvLines.join('\n');
  }

  public static async adminListReturnRequests(params: {
    status?: string;
  }): Promise<ReturnRequestDTO[]> {
    let whereSql = '';
    const values: any[] = [];

    if (params.status) {
      whereSql = 'WHERE r.status = ?';
      values.push(params.status);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.order_id, r.order_item_id, r.customer_id, r.reason, r.status, r.admin_notes,
              r.created_at, r.updated_at, o.order_number, oi.title as item_title
       FROM order_return_requests r
       JOIN orders o ON r.order_id = o.id
       JOIN order_items oi ON r.order_item_id = oi.id
       ${whereSql}
       ORDER BY r.id DESC`,
      values
    );

    return rows.map((r) => ({
      id: Number(r.id),
      orderId: Number(r.order_id),
      orderNumber: r.order_number,
      orderItemId: Number(r.order_item_id),
      itemTitle: r.item_title,
      customerId: Number(r.customer_id),
      reason: r.reason,
      status: r.status,
      adminNotes: r.admin_notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public static async adminTransitionReturnRequest(
    requestId: number,
    status: 'approved' | 'rejected' | 'completed',
    adminNotes?: string
  ): Promise<ReturnRequestDTO> {
    const validStatuses = ['approved', 'rejected', 'completed'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE order_return_requests
       SET status = ?, admin_notes = COALESCE(?, admin_notes)
       WHERE id = ?`,
      [status, adminNotes || null, requestId]
    );

    if (res.affectedRows === 0) {
      throw new Error('Return request not found');
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.order_id, r.order_item_id, r.customer_id, r.reason, r.status, r.admin_notes,
              r.created_at, r.updated_at, o.order_number, oi.title as item_title
       FROM order_return_requests r
       JOIN orders o ON r.order_id = o.id
       JOIN order_items oi ON r.order_item_id = oi.id
       WHERE r.id = ?`,
      [requestId]
    );

    const r = rows[0];
    return {
      id: Number(r.id),
      orderId: Number(r.order_id),
      orderNumber: r.order_number,
      orderItemId: Number(r.order_item_id),
      itemTitle: r.item_title,
      customerId: Number(r.customer_id),
      reason: r.reason,
      status: r.status,
      adminNotes: r.admin_notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
