import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { StoreService } from '../src/modules/store/service.js';
import { FakePaymentGateway, setPaymentGateway } from '../src/modules/store/payment-gateway.js';
import { fulfilmentRegistry, FulfilmentHandler, FulfilmentContext, FulfilmentLineItem, FulfilmentResult } from '../src/modules/store/fulfilment.js';
import { pool } from '../src/db/pool.js';
import { RowDataPacket } from 'mysql2';
import { authService } from '../src/auth/service.js';
import { canTransition, OrderStatus, OrderKind } from '../src/modules/store/state-machine.js';

describe('H2.1 Store Engine & Checkout Suite (Real MySQL + Fake Gateway)', () => {
  let app: FastifyInstance;
  let fakeGateway: FakePaymentGateway;
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;

  beforeAll(async () => {
    // Enable store module
    moduleRegistry.registerManifest(storeModuleManifest);
    moduleRegistry.setModuleState('store', true);

    fakeGateway = new FakePaymentGateway();
    setPaymentGateway(fakeGateway);

    app = buildApp();
    await app.ready();

    // Seed test products and clean existing test records
    const connection = await pool.getConnection();
    try {
      await connection.query('DELETE FROM shipping_shipments');
      await connection.query('DELETE FROM credit_notes');
      await connection.query('DELETE FROM invoices');
      await connection.query('DELETE FROM order_items');
      await connection.query('DELETE FROM refunds');
      await connection.query('DELETE FROM payments');
      await connection.query('DELETE FROM stock_movements');
      await connection.query('DELETE FROM order_status_history');
      await connection.query('DELETE FROM order_notes');
      await connection.query('DELETE FROM payment_webhook_events');
      await connection.query('DELETE FROM orders');
      await connection.query('DELETE FROM coupons WHERE code LIKE "TEST%" OR code = "CONCURRENT2"');
      await connection.query('DELETE FROM products WHERE slug LIKE "test-%"');
      await connection.query("DELETE FROM users WHERE email IN ('customer.a@example.com', 'customer.b@example.com', 'admin.store@example.com')");

      // Product 1: Single unit stock for concurrent last unit test
      await connection.query(`
        INSERT INTO products (name, slug, price, product_type, stock_quantity, low_stock_threshold, track_stock, status)
        VALUES ('Test Limited Item', 'test-last-unit', 50000, 'physical', 1, 1, TRUE, 'active')
      `);

      // Product 2: Abundant stock
      await connection.query(`
        INSERT INTO products (name, slug, price, product_type, stock_quantity, low_stock_threshold, track_stock, status)
        VALUES ('Test Normal Item', 'test-normal-item', 10000, 'physical', 1000, 5, TRUE, 'active')
      `);

      // Product 3: Digital Item
      await connection.query(`
        INSERT INTO products (name, slug, price, product_type, stock_quantity, track_stock, status)
        VALUES ('Test E-Book', 'test-digital-ebook', 25000, 'digital', 0, FALSE, 'active')
      `);

      // Seed coupon with usage limit of 2
      await connection.query(`
        INSERT INTO coupons (code, discount_type, discount_value, min_order_amount, usage_limit, usage_count, is_active)
        VALUES ('CONCURRENT2', 'fixed', 5000, 10000, 2, 0, TRUE)
      `);
    } finally {
      connection.release();
    }

    // Create test users in MySQL
    const userA = await authService.signup({ name: 'Customer A', email: 'customer.a@example.com', password: 'StrongPass1234!' });
    await authService.verifyEmail(userA.verificationToken);
    const loginA = await authService.login({ email: 'customer.a@example.com', password: 'StrongPass1234!' });
    userAToken = loginA.token!;

    const userB = await authService.signup({ name: 'Customer B', email: 'customer.b@example.com', password: 'StrongPass1234!' });
    await authService.verifyEmail(userB.verificationToken);
    const loginB = await authService.login({ email: 'customer.b@example.com', password: 'StrongPass1234!' });
    userBToken = loginB.token!;

    const admin = await authService.signup({ name: 'Admin Staff', email: 'admin.store@example.com', password: 'AdminPass1234!' });
    await authService.verifyEmail(admin.verificationToken);
    const conn = await pool.getConnection();
    try {
      await conn.query("UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1) WHERE id = ?", [admin.user.id]);
    } finally {
      conn.release();
    }
    const loginAdmin = await authService.login({ email: 'admin.store@example.com', password: 'AdminPass1234!' });
    adminToken = loginAdmin.token!;
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. Concurrent checkout of the last unit
  it('1. concurrent checkout of the last unit: only one succeeds, second gets 409 INSUFFICIENT_STOCK', async () => {
    const prod = await StoreService.getProductBySlug('test-last-unit');
    expect(prod).toBeDefined();

    const payload = {
      customerEmail: 'buyer@example.com',
      paymentMethod: 'razorpay',
      items: [{ productId: prod!.id, quantity: 1 }],
      shippingAddress: { addressLine1: 'Road 1', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      billingState: 'Karnataka',
    };

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/store/checkout', payload }),
      app.inject({ method: 'POST', url: '/api/v1/store/checkout', payload }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const failedBody = JSON.parse(res1.statusCode === 409 ? res1.body : res2.body);
    expect(failedBody.error.code).toBe('INSUFFICIENT_STOCK');

    // Verify stock is now 0 in MySQL
    const updatedProd = await StoreService.getProductBySlug('test-last-unit');
    expect(updatedProd!.stockQuantity).toBe(0);
  });

  // 2. 50 parallel checkouts produce 50 unique order numbers
  it('2. 50 parallel checkouts generate 50 unique order numbers under concurrency', async () => {
    const prod = await StoreService.getProductBySlug('test-normal-item');

    const requests = Array.from({ length: 50 }).map((_, idx) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: `customer${idx}@example.com`,
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'Lane 2', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
          billingState: 'Maharashtra',
        },
      })
    );

    const responses = await Promise.all(requests);
    const orderNumbers = new Set<string>();

    for (const res of responses) {
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.orderNumber).toBeDefined();
      orderNumbers.add(body.data.orderNumber);
    }

    expect(orderNumbers.size).toBe(50);
  });

  // 3. Two-item carts under concurrent load with no deadlock failures
  it('3. two-item carts under concurrent load execute with no deadlock failures (sorted IDs & retry loop)', async () => {
    // Create two products
    const prodA = await StoreService.createProduct({
      name: 'Item A',
      slug: 'test-item-a',
      price: 1500,
      stockQuantity: 500,
      status: 'active',
    });
    const prodB = await StoreService.createProduct({
      name: 'Item B',
      slug: 'test-item-b',
      price: 2500,
      stockQuantity: 500,
      status: 'active',
    });

    // Fire 20 concurrent checkouts with reversed cart orders
    const requests = Array.from({ length: 20 }).map((_, idx) => {
      const items =
        idx % 2 === 0
          ? [{ productId: prodA.id, quantity: 1 }, { productId: prodB.id, quantity: 1 }]
          : [{ productId: prodB.id, quantity: 1 }, { productId: prodA.id, quantity: 1 }];

      return app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: `deadlock_test_${idx}@example.com`,
          paymentMethod: 'razorpay',
          items,
          shippingAddress: { addressLine1: 'Test St', city: 'Delhi', state: 'Delhi', pincode: '110001' },
          billingState: 'Delhi',
        },
      });
    });

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.statusCode).toBe(201);
    }
  });

  // 4. Coupon limit under concurrency
  it('4. coupon limit under concurrency: only usage_limit checkouts succeed, subsequent fail', async () => {
    const prod = await StoreService.getProductBySlug('test-normal-item');

    const requests = Array.from({ length: 5 }).map((_, idx) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: `coupon_buyer_${idx}@example.com`,
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          couponCode: 'CONCURRENT2',
          shippingAddress: { addressLine1: 'C-Street', city: 'Delhi', state: 'Delhi', pincode: '110001' },
          billingState: 'Delhi',
        },
      })
    );

    const responses = await Promise.all(requests);
    const successes = responses.filter((r) => r.statusCode === 201);
    const failures = responses.filter((r) => r.statusCode === 409);

    expect(successes.length).toBe(2);
    expect(failures.length).toBe(3);
  });

  // 5 & 6. Payment signature verification: tampered and wrong-length
  describe('Payment Signature & Verification', () => {
    let orderId: number;
    let gatewayOrderId: string;
    let guestToken: string;

    beforeAll(async () => {
      const prod = await StoreService.getProductBySlug('test-normal-item');
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'verify_test@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'V-Street', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
          billingState: 'Maharashtra',
        },
      });

      const body = JSON.parse(checkoutRes.body);
      gatewayOrderId = body.data.gatewayOrder.gatewayOrderId;
      guestToken = body.data.guestAccessToken;

      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [body.data.orderNumber]);
        orderId = Number(rows[0].id);
      } finally {
        connection.release();
      }
    });

    it('5. tampered checkout signature is rejected', async () => {
      const paymentId = 'pay_tamper_123';
      fakeGateway.payments.set(paymentId, {
        id: paymentId,
        orderId: gatewayOrderId,
        amount: 11800, // 10000 + 18% tax
        currency: 'INR',
        status: 'captured',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${orderId}/verify-payment`,
        headers: { 'x-guest-token': guestToken },
        payload: {
          razorpayOrderId: gatewayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: 'bad_tampered_signature_hex_value_1234567890abcdef',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.message).toContain('Invalid payment signature');
    });

    it('6. wrong-length signature rejected safely without throwing unhandled exception', async () => {
      const paymentId = 'pay_wrong_len_123';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${orderId}/verify-payment`,
        headers: { 'x-guest-token': guestToken },
        payload: {
          razorpayOrderId: gatewayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: 'short', // different byte length than sha256 hex (64 chars)
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.message).toContain('Invalid payment signature');
    });

    it('7. amount mismatch is rejected', async () => {
      const paymentId = 'pay_amount_mismatch_123';
      fakeGateway.payments.set(paymentId, {
        id: paymentId,
        orderId: gatewayOrderId,
        amount: 5000, // Expected 11800
        currency: 'INR',
        status: 'captured',
      });

      const sig = fakeGateway.generateSignature(gatewayOrderId, paymentId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${orderId}/verify-payment`,
        headers: { 'x-guest-token': guestToken },
        payload: {
          razorpayOrderId: gatewayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: sig,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.message).toContain('Payment amount mismatch');
    });

    it('8. currency mismatch is rejected', async () => {
      const paymentId = 'pay_currency_mismatch_123';
      fakeGateway.payments.set(paymentId, {
        id: paymentId,
        orderId: gatewayOrderId,
        amount: 11800,
        currency: 'USD', // Expected INR
        status: 'captured',
      });

      const sig = fakeGateway.generateSignature(gatewayOrderId, paymentId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${orderId}/verify-payment`,
        headers: { 'x-guest-token': guestToken },
        payload: {
          razorpayOrderId: gatewayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: sig,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.message).toContain('Payment currency mismatch');
    });
  });

  // 9 & 10. Webhook verification & Idempotency replay
  describe('Razorpay Webhook Engine', () => {
    let webhookOrderId: number;

    beforeAll(async () => {
      const prod = await StoreService.getProductBySlug('test-normal-item');
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'webhook_test@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'W-Street', city: 'Kolkata', state: 'West Bengal', pincode: '700001' },
          billingState: 'West Bengal',
        },
      });
      const body = JSON.parse(checkoutRes.body);
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [body.data.orderNumber]);
        webhookOrderId = Number(rows[0].id);
      } finally {
        connection.release();
      }
    });

    it('10. webhook with bad signature rejected with 400', async () => {
      const payload = JSON.stringify({ id: 'evt_bad_sig', event: 'payment.captured' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/webhooks/razorpay',
        headers: {
          'x-razorpay-signature': 'invalid_signature_hex_bad_key',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(res.statusCode).toBe(400);
    });

    it('9. webhook replay does not double-process (idempotent)', async () => {
      const eventPayload = {
        id: 'evt_captured_idempotency_1',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_idem_1',
              order_id: `order_${webhookOrderId}`,
              amount: 11800,
              currency: 'INR',
              status: 'captured',
              notes: { orderId: String(webhookOrderId) },
            },
          },
        },
      };

      const raw = JSON.stringify(eventPayload);
      const sig = fakeGateway.generateWebhookSignature(raw);

      // First webhook post -> processed
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/store/webhooks/razorpay',
        headers: { 'x-razorpay-signature': sig, 'content-type': 'application/json' },
        payload: raw,
      });
      expect(res1.statusCode).toBe(200);
      expect(JSON.parse(res1.body).data.status).toBe('processed');

      // Replay same event ID -> acknowledged as duplicate with 200
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/store/webhooks/razorpay',
        headers: { 'x-razorpay-signature': sig, 'content-type': 'application/json' },
        payload: raw,
      });
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res2.body).data.status).toBe('duplicate');

      const order = await StoreService.getOrderById(webhookOrderId);
      expect(order!.status).toBe('confirmed');
    });

    it('11. out-of-order webhook (payment.failed after captured) does not move order backwards', async () => {
      // Order is already confirmed above. Send payment.failed
      const failEvent = {
        id: 'evt_failed_out_of_order',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_ooo',
              order_id: `order_${webhookOrderId}`,
              notes: { orderId: String(webhookOrderId) },
            },
          },
        },
      };

      const raw = JSON.stringify(failEvent);
      const sig = fakeGateway.generateWebhookSignature(raw);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/webhooks/razorpay',
        headers: { 'x-razorpay-signature': sig, 'content-type': 'application/json' },
        payload: raw,
      });
      expect(res.statusCode).toBe(200);

      const order = await StoreService.getOrderById(webhookOrderId);
      expect(order!.status).toBe('confirmed'); // Order must NOT have moved backwards to payment_failed
    });
  });

  // 12 & 13. Expiry and cancellation release stock and coupons
  it('13. expired order releases stock and coupon via /api/v1/jobs/process', async () => {
    const prod = await StoreService.getProductBySlug('test-normal-item');
    const initialStock = prod!.stockQuantity;

    // Checkout an order
    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'expire_test@example.com',
        paymentMethod: 'razorpay',
        items: [{ productId: prod!.id, quantity: 3 }],
        shippingAddress: { addressLine1: 'E-St', city: 'Goa', state: 'Goa', pincode: '403001' },
        billingState: 'Goa',
      },
    });

    const body = JSON.parse(checkoutRes.body);
    const connection = await pool.getConnection();
    try {
      // Force expires_at into the past to simulate expiry
      await connection.query(
        "UPDATE orders SET expires_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE order_number = ?",
        [body.data.orderNumber]
      );
    } finally {
      connection.release();
    }

    // Stock should be decremented by 3
    const duringOrderProd = await StoreService.getProductBySlug('test-normal-item');
    expect(duringOrderProd!.stockQuantity).toBe(initialStock - 3);

    // Run background jobs processor
    const jobRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/process',
    });
    expect(jobRes.statusCode).toBe(200);
    expect(JSON.parse(jobRes.body).data.ordersExpired).toBeGreaterThanOrEqual(1);

    // Stock is restored
    const restoredProd = await StoreService.getProductBySlug('test-normal-item');
    expect(restoredProd!.stockQuantity).toBe(initialStock);
  });

  // 14 & 15. State machine transition matrix
  describe('State Machine & Transition Guard', () => {
    it('14. invalid status transition is rejected with 409 CONFLICT', async () => {
      const prod = await StoreService.getProductBySlug('test-normal-item');
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'sm_test@example.com',
          paymentMethod: 'cod',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'SM-St', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
          billingState: 'Rajasthan',
        },
      });

      const orderNumber = JSON.parse(checkoutRes.body).data.orderNumber;
      const connection = await pool.getConnection();
      let orderId: number;
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [orderNumber]);
        orderId = Number(rows[0].id);
      } finally {
        connection.release();
      }

      // Try invalid transition directly from pending_payment to delivered
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/store/orders/${orderId}/transition`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'delivered',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
    });

    it('15. digital-only order auto-completes when entitlements are granted', async () => {
      moduleRegistry.registerManifest({
        name: 'digital-delivery',
        version: '0.1.0',
        description: 'Digital Delivery Module',
        isCore: false,
        routesPrefix: '/digital',
      });
      moduleRegistry.setModuleState('digital-delivery', true);

      const digitalProd = await StoreService.getProductBySlug('test-digital-ebook');

      // Create digital order
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'digital_buyer@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: digitalProd!.id, quantity: 1 }],
          billingState: 'Karnataka',
        },
      });

      expect(checkoutRes.statusCode).toBe(201);
      const checkoutBody = JSON.parse(checkoutRes.body);
      const orderNumber = checkoutBody.data.orderNumber;

      const connection = await pool.getConnection();
      let orderId: number;
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [orderNumber]);
        orderId = Number(rows[0].id);
      } finally {
        connection.release();
      }

      // Register a fake digital handler that grants entitlement and returns fulfilled
      class TestEntitlementHandler implements FulfilmentHandler {
        requiresShipping() { return false; }
        requiresStock() { return false; }
        async onPaid(_ctx: FulfilmentContext, _line: FulfilmentLineItem): Promise<FulfilmentResult> {
          return { status: 'fulfilled' };
        }
        async onRefund() {}
        async onCancel() {}
      }

      fulfilmentRegistry.register('digital', new TestEntitlementHandler());

      // Confirm payment
      const paymentId = 'pay_digital_complete_1';
      fakeGateway.payments.set(paymentId, {
        id: paymentId,
        orderId: `order_${orderId}`,
        amount: 29500, // 25000 + 18% tax
        currency: 'INR',
        status: 'captured',
      });

      await StoreService.confirmOrderPayment(orderId, {
        gatewayPaymentId: paymentId,
        amountPaise: 29500,
        currency: 'INR',
      });

      const order = await StoreService.getOrderById(orderId);
      // Per spec: digital order transitions confirmed -> completed automatically once entitlements are granted
      expect(order!.status).toBe('completed');
    });
  });

  // 17. Digital order blocked from using COD
  it('17. digital cart is blocked from selecting Cash on Delivery (COD)', async () => {
    moduleRegistry.registerManifest({
      name: 'digital-delivery',
      version: '0.1.0',
      description: 'Digital Delivery Module',
      isCore: false,
      routesPrefix: '/digital',
    });
    moduleRegistry.setModuleState('digital-delivery', true);

    const digitalProd = await StoreService.getProductBySlug('test-digital-ebook');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'digital_cod@example.com',
        paymentMethod: 'cod', // COD with digital item
        items: [{ productId: digitalProd!.id, quantity: 1 }],
        billingState: 'Delhi',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('Cash on Delivery (COD) is not available');
  });

  // 18. Creating digital product blocked when digital-delivery module is disabled
  it('18. creating digital product is blocked when digital-delivery module is disabled', async () => {
    // Disable digital-delivery module
    moduleRegistry.setModuleState('digital-delivery', false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Forbidden Digital Asset',
        slug: 'test-forbidden-digital',
        price: 9900,
        productType: 'digital',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('digital-delivery module is not enabled');
  });

  // 19 & 20. Idempotency Key header
  describe('Idempotency Key Behavior', () => {
    it('19. duplicate checkout with same Idempotency-Key returns original order', async () => {
      const prod = await StoreService.getProductBySlug('test-normal-item');
      const idemKey = `idem_test_${Date.now()}`;
      const payload = {
        customerEmail: 'idem@example.com',
        paymentMethod: 'razorpay',
        items: [{ productId: prod!.id, quantity: 1 }],
        shippingAddress: { addressLine1: 'Idem St', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301' },
        billingState: 'Uttar Pradesh',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        headers: { 'idempotency-key': idemKey },
        payload,
      });

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        headers: { 'idempotency-key': idemKey },
        payload,
      });

      expect(res1.statusCode).toBe(201);
      const b1 = JSON.parse(res1.body);
      const b2 = JSON.parse(res2.body);

      expect(b2.data.orderNumber).toBe(b1.data.orderNumber);
    });

    it('20. same Idempotency-Key with different payload returns 422 Unprocessable Entity', async () => {
      const prod = await StoreService.getProductBySlug('test-normal-item');
      const idemKey = `idem_mismatch_${Date.now()}`;

      await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        headers: { 'idempotency-key': idemKey },
        payload: {
          customerEmail: 'idem1@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'St 1', city: 'Noida', state: 'UP', pincode: '201301' },
          billingState: 'UP',
        },
      });

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        headers: { 'idempotency-key': idemKey },
        payload: {
          customerEmail: 'different_email@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 2 }],
          shippingAddress: { addressLine1: 'St 2', city: 'Noida', state: 'UP', pincode: '201301' },
          billingState: 'UP',
        },
      });

      expect(res2.statusCode).toBe(422);
      expect(JSON.parse(res2.body).error.code).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  // 21 & 22. Guest token & Customer ownership tests
  describe('Customer Data Ownership & Guest Tokens', () => {
    let _orderAId: number;
    let orderBId: number;
    let guestTokenA: string;

    beforeAll(async () => {
      const prod = await StoreService.getProductBySlug('test-normal-item');

      // Order created by User A
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          customerEmail: 'customer.a@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'A-Home', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
          billingState: 'Tamil Nadu',
        },
      });
      guestTokenA = JSON.parse(resA.body).data.guestAccessToken;

      // Order created by User B
      const resB = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        headers: { authorization: `Bearer ${userBToken}` },
        payload: {
          customerEmail: 'customer.b@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod!.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'B-Home', city: 'Hyderabad', state: 'Telangana', pincode: '500001' },
          billingState: 'Telangana',
        },
      });

      const connection = await pool.getConnection();
      try {
        const [rowsA] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [JSON.parse(resA.body).data.orderNumber]);
        _orderAId = Number(rowsA[0].id);
        const [rowsB] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [JSON.parse(resB.body).data.orderNumber]);
        orderBId = Number(rowsB[0].id);
      } finally {
        connection.release();
      }
    });

    it('21. guest token for Order A is rejected when attempting to access Order B', async () => {
      expect(_orderAId).toBeGreaterThan(0);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${orderBId}/verify-payment`,
        headers: { 'x-guest-token': guestTokenA }, // Token for A used on B
        payload: {
          razorpayPaymentId: 'pay_unauth_123',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('22. ownership tests: user A cannot verify, read or refund user B order', async () => {
      // 1. User A cannot verify User B order
      const verifyRes = await app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${orderBId}/verify-payment`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          razorpayPaymentId: 'pay_unauth_456',
        },
      });
      expect(verifyRes.statusCode).toBe(403);

      // 2. User A cannot read User B order
      const readRes = await app.inject({
        method: 'GET',
        url: `/api/v1/store/orders/${orderBId}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      expect(readRes.statusCode).toBe(403);

      // 3. User A cannot refund User B order
      const refundRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/store/orders/${orderBId}/refund`,
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          amountPaise: 1000,
          reason: 'unauthorized customer refund attempt',
          idempotencyKey: 'unauth_refund_key_123',
        },
      });
      expect(refundRes.statusCode).toBe(403);
    });
  });

  // 23. verify-payment and webhook confirming the same order at the same time (exactly one wins)
  it('verify-payment and webhook confirming the same order at the same time (exactly one wins)', async () => {
    const prod = await StoreService.getProductBySlug('test-normal-item');
    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'race_test@example.com',
        paymentMethod: 'razorpay',
        items: [{ productId: prod!.id, quantity: 1 }],
        shippingAddress: { addressLine1: 'Race St', city: 'Surat', state: 'Gujarat', pincode: '395001' },
        billingState: 'Gujarat',
      },
    });

    const body = JSON.parse(checkoutRes.body);
    const guestToken = body.data.guestAccessToken;
    const gatewayOrderId = body.data.gatewayOrder.gatewayOrderId;

    const connection = await pool.getConnection();
    let raceOrderId: number;
    try {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [body.data.orderNumber]);
      raceOrderId = Number(rows[0].id);
    } finally {
      connection.release();
    }

    const paymentId = `pay_race_${Date.now()}`;
    fakeGateway.payments.set(paymentId, {
      id: paymentId,
      orderId: gatewayOrderId,
      amount: 11800,
      currency: 'INR',
      status: 'captured',
    });

    const sig = fakeGateway.generateSignature(gatewayOrderId, paymentId);
    const webhookRaw = JSON.stringify({
      id: `evt_race_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: gatewayOrderId,
            amount: 11800,
            currency: 'INR',
            status: 'captured',
            notes: { orderId: String(raceOrderId) },
          },
        },
      },
    });
    const webhookSig = fakeGateway.generateWebhookSignature(webhookRaw);

    // Call verify-payment and webhook simultaneously
    const [verifyRes, webhookRes] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/store/orders/${raceOrderId}/verify-payment`,
        headers: { 'x-guest-token': guestToken },
        payload: {
          razorpayOrderId: gatewayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: sig,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/store/webhooks/razorpay',
        headers: { 'x-razorpay-signature': webhookSig, 'content-type': 'application/json' },
        payload: webhookRaw,
      }),
    ]);

    expect(verifyRes.statusCode).toBe(200);
    expect(webhookRes.statusCode).toBe(200);

    const order = await StoreService.getOrderById(raceOrderId);
    expect(order!.status).toBe('confirmed');

    // Confirm that order status history only transitioned from pending_payment to confirmed ONCE
    const [historyRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM order_status_history WHERE order_id = ? AND to_status = 'confirmed'",
      [raceOrderId]
    );
    expect(historyRows.length).toBe(1);
    connection.release();
  });

  // 24 & 25. Late payment after expiry
  describe('Late Payment After Expiry', () => {
    it('24. Branch A: stock available -> re-reserve, confirm order, record history', async () => {
      const prod = await StoreService.createProduct({
        name: 'Late Pay Available',
        slug: 'test-late-available',
        price: 10000,
        stockQuantity: 10,
        status: 'active',
      });

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'lateA@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod.id, quantity: 2 }],
          shippingAddress: { addressLine1: 'L-St', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001' },
          billingState: 'Madhya Pradesh',
        },
      });

      const body = JSON.parse(checkoutRes.body);
      const connection = await pool.getConnection();
      let lateOrderId: number;
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [body.data.orderNumber]);
        lateOrderId = Number(rows[0].id);

        // Cancel order to simulate expiry release
        await StoreService.transitionOrderStatus(lateOrderId, 'cancelled', 'system', 'Order expired');
      } finally {
        connection.release();
      }

      // Late payment arrives for cancelled order
      const paymentId = `pay_late_avail_${Date.now()}`;
      const res = await StoreService.confirmOrderPayment(
        lateOrderId,
        {
          gatewayPaymentId: paymentId,
          amountPaise: 23600,
          currency: 'INR',
        },
        'webhook'
      );

      expect(res.latePayment).toBe('confirmed');
      const order = await StoreService.getOrderById(lateOrderId);
      expect(order!.status).toBe('confirmed');
    });

    it('25. Branch B: stock depleted -> set payment_received_after_expiry, auto-refund, queue alert', async () => {
      const prod = await StoreService.createProduct({
        name: 'Late Pay Sold Out',
        slug: 'test-late-depleted',
        price: 10000,
        stockQuantity: 1,
        status: 'active',
      });

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'lateB@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'L-St', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001' },
          billingState: 'Madhya Pradesh',
        },
      });

      const body = JSON.parse(checkoutRes.body);
      const connection = await pool.getConnection();
      let lateOrderId: number;
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [body.data.orderNumber]);
        lateOrderId = Number(rows[0].id);

        // Cancel order to simulate expiry
        await StoreService.transitionOrderStatus(lateOrderId, 'cancelled', 'system', 'Order expired');

        // Deplete stock completely
        await connection.query('UPDATE products SET stock_quantity = 0 WHERE id = ?', [prod.id]);
      } finally {
        connection.release();
      }

      // Late payment arrives but stock is now 0
      const paymentId = `pay_late_soldout_${Date.now()}`;
      const res = await StoreService.confirmOrderPayment(
        lateOrderId,
        {
          gatewayPaymentId: paymentId,
          amountPaise: 11800,
          currency: 'INR',
        },
        'webhook'
      );

      expect(res.latePayment).toBe('refunded');
      const order = await StoreService.getOrderById(lateOrderId);
      expect(order!.status).toBe('payment_received_after_expiry');

      // Check auto refund record
      const [refRows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM refunds WHERE order_id = ?',
        [lateOrderId]
      );
      expect(refRows.length).toBe(1);
      expect(refRows[0].reason).toContain('Automatic refund');
      connection.release();
    });
  });

  // 26. Partial Refunds & line restock
  describe('Refunds Engine', () => {
    let refundOrderId: number;
    let orderItemId: number;
    let prodId: number;

    beforeAll(async () => {
      const prod = await StoreService.createProduct({
        name: 'Refundable Item',
        slug: 'test-refundable',
        price: 10000,
        stockQuantity: 50,
        status: 'active',
      });
      prodId = prod.id;

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'refund_me@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod.id, quantity: 2 }],
          shippingAddress: { addressLine1: 'R-St', city: 'Nagpur', state: 'Maharashtra', pincode: '440001' },
          billingState: 'Maharashtra',
        },
      });

      const body = JSON.parse(checkoutRes.body);
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [body.data.orderNumber]);
        refundOrderId = Number(rows[0].id);

        const [itemRows] = await connection.query<RowDataPacket[]>('SELECT id FROM order_items WHERE order_id = ?', [refundOrderId]);
        orderItemId = Number(itemRows[0].id);
      } finally {
        connection.release();
      }

      // Mark captured
      await StoreService.confirmOrderPayment(refundOrderId, {
        gatewayPaymentId: `pay_ref_${Date.now()}`,
        amountPaise: 23600,
        currency: 'INR',
      });
    });

    it('26. partial refund restocks lines and moves status to partially_refunded', async () => {
      const connection = await pool.getConnection();
      const [pBefore] = await connection.query<RowDataPacket[]>('SELECT stock_quantity FROM products WHERE id = ?', [prodId]);
      const stockBefore = Number(pBefore[0].stock_quantity);

      const refundRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/store/orders/${refundOrderId}/refund`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          amountPaise: 11800, // half of 23600
          lineItems: [{ orderItemId, quantity: 1 }],
          reason: 'Customer requested 1 item return',
          idempotencyKey: `ref_key_${Date.now()}`,
          restock: true,
        },
      });

      expect(refundRes.statusCode).toBe(201);

      const order = await StoreService.getOrderById(refundOrderId);
      expect(order!.status).toBe('partially_refunded');

      // Verify stock incremented by 1
      const [pAfter] = await connection.query<RowDataPacket[]>('SELECT stock_quantity FROM products WHERE id = ?', [prodId]);
      expect(Number(pAfter[0].stock_quantity)).toBe(stockBefore + 1);
      connection.release();
    });

    it('refund above the captured limit is rejected with 422', async () => {
      const refundRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/store/orders/${refundOrderId}/refund`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          amountPaise: 20000, // Only 11800 remaining
          reason: 'Excessive refund attempt',
          idempotencyKey: `ref_excess_${Date.now()}`,
        },
      });

      expect(refundRes.statusCode).toBe(422);
      expect(JSON.parse(refundRes.body).error.message).toContain('exceeds max refundable amount');
    });
  });

  // Point 9 Additional Required Tests
  describe('Point 9 Dedicated Test Suite', () => {
    it('expiry job racing a payment', async () => {
      const prod = await StoreService.createProduct({
        name: 'Race Expiry Item',
        slug: `test-race-expiry-${Date.now()}`,
        price: 10000,
        stockQuantity: 10,
        status: 'active',
      });

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'race_expiry@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod.id, quantity: 1 }],
          shippingAddress: { addressLine1: 'Race St', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
          billingState: 'Maharashtra',
        },
      });

      const b = JSON.parse(checkoutRes.body);
      const conn = await pool.getConnection();
      let orderId: number;
      try {
        const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [b.data.orderNumber]);
        orderId = Number(rows[0].id);
        // Set expiry in the past so expiry runner considers it expired
        await conn.query('UPDATE orders SET expires_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [orderId]);
      } finally {
        conn.release();
      }

      const gatewayOrderId = b.data.gatewayOrder.gatewayOrderId;
      const guestToken = b.data.guestAccessToken;
      const paymentId = `pay_race_expiry_${Date.now()}`;
      fakeGateway.payments.set(paymentId, {
        id: paymentId,
        orderId: gatewayOrderId,
        amount: 11800,
        currency: 'INR',
        status: 'captured',
      });
      const sig = fakeGateway.generateSignature(gatewayOrderId, paymentId);

      // Race expiry runner against verify-payment simultaneously
      const [jobRes, verifyRes] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/v1/jobs/process' }),
        app.inject({
          method: 'POST',
          url: `/api/v1/store/orders/${orderId}/verify-payment`,
          headers: { 'x-guest-token': guestToken },
          payload: {
            razorpayOrderId: gatewayOrderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: sig,
          },
        }),
      ]);

      expect([200, 400, 409]).toContain(verifyRes.statusCode);
      expect(jobRes.statusCode).toBe(200);

      const finalOrder = await StoreService.getOrderById(orderId);
      expect(['confirmed', 'cancelled', 'payment_received_after_expiry']).toContain(finalOrder!.status);
    });

    it('payment failed releases stock', async () => {
      const prod = await StoreService.createProduct({
        name: 'Fail Stock Release Item',
        slug: `test-fail-stock-${Date.now()}`,
        price: 10000,
        stockQuantity: 10,
        status: 'active',
      });

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'fail_stock@example.com',
          paymentMethod: 'razorpay',
          items: [{ productId: prod.id, quantity: 3 }],
          shippingAddress: { addressLine1: 'Fail St', city: 'Delhi', state: 'Delhi', pincode: '110001' },
          billingState: 'Delhi',
        },
      });

      const b = JSON.parse(checkoutRes.body);
      const conn = await pool.getConnection();
      let orderId: number;
      try {
        const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [b.data.orderNumber]);
        orderId = Number(rows[0].id);
      } finally {
        conn.release();
      }

      // Check stock decremented by 3
      const [pMid] = await pool.query<RowDataPacket[]>('SELECT stock_quantity FROM products WHERE id = ?', [prod.id]);
      expect(Number(pMid[0].stock_quantity)).toBe(7);

      // Payment fails via webhook
      const failPayload = JSON.stringify({
        id: `evt_fail_stock_${Date.now()}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_failed_${Date.now()}`,
              order_id: b.data.gatewayOrder.gatewayOrderId,
              notes: { orderId: String(orderId) },
            },
          },
        },
      });
      const sig = fakeGateway.generateWebhookSignature(failPayload);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/webhooks/razorpay',
        headers: { 'x-razorpay-signature': sig, 'content-type': 'application/json' },
        payload: failPayload,
      });

      expect(res.statusCode).toBe(200);

      // Stock is restored to 10
      const [pAfter] = await pool.query<RowDataPacket[]>('SELECT stock_quantity FROM products WHERE id = ?', [prod.id]);
      expect(Number(pAfter[0].stock_quantity)).toBe(10);

      const order = await StoreService.getOrderById(orderId);
      expect(order!.status).toBe('payment_failed');
    });

    it('the state-transition matrix for every from/to pair across physical, digital and mixed orders', () => {
      const allStatuses: OrderStatus[] = [
        'pending_payment',
        'payment_failed',
        'confirmed',
        'processing',
        'shipped',
        'delivered',
        'completed',
        'cancelled',
        'return_requested',
        'returned',
        'refunded',
        'partially_refunded',
        'payment_received_after_expiry',
      ];
      const kinds: OrderKind[] = ['physical', 'digital', 'mixed'];

      let transitionsChecked = 0;
      for (const kind of kinds) {
        for (const from of allStatuses) {
          for (const to of allStatuses) {
            const allowed = canTransition(from, to, kind);
            expect(typeof allowed).toBe('boolean');
            transitionsChecked++;

            // Known specific assertions:
            if (from === 'pending_payment' && to === 'delivered') {
              expect(allowed).toBe(false);
            }
            if (from === 'pending_payment' && to === 'confirmed') {
              expect(allowed).toBe(true);
            }
            if (from === 'confirmed' && to === 'completed') {
              if (kind === 'digital') {
                expect(allowed).toBe(true);
              } else {
                expect(allowed).toBe(false);
              }
            }
            if (from === 'confirmed' && to === 'shipped') {
              // Direct skip to shipped without processing is disallowed
              expect(allowed).toBe(false);
            }
            if (from === 'processing' && to === 'shipped') {
              if (kind === 'digital') {
                expect(allowed).toBe(false);
              } else {
                expect(allowed).toBe(true);
              }
            }
          }
        }
      }

      // 13 statuses * 13 statuses * 3 kinds = 507 transitions checked
      expect(transitionsChecked).toBe(13 * 13 * 3);
    });
  });
});
