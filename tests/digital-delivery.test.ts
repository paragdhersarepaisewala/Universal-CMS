import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { digitalModuleManifest } from '../src/modules/digital/index.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { StoreService } from '../src/modules/store/service.js';
import { DigitalDeliveryService } from '../src/modules/digital/service.js';
import { authService } from '../src/auth/service.js';
import { setPaymentGateway, FakePaymentGateway } from '../src/modules/store/payment-gateway.js';
import { RowDataPacket } from 'mysql2';

describe('Digital Delivery Module (Sub-checkpoint CP-H2.3D)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let fakeGateway: FakePaymentGateway;
  let digitalProductId: number;
  let digitalProductSlug: string;

  beforeAll(async () => {
    moduleRegistry.registerManifest(storeModuleManifest);
    moduleRegistry.registerManifest(digitalModuleManifest);
    moduleRegistry.setModuleState('store', true);
    moduleRegistry.setModuleState('digital-delivery', true);

    fakeGateway = new FakePaymentGateway();
    setPaymentGateway(fakeGateway);

    app = buildApp();
    await app.ready();

    // Clean up test data
    await pool.query('DELETE FROM digital_entitlements');
    await pool.query('DELETE FROM license_keys');
    await pool.query('DELETE FROM digital_assets');
    const adminEmail = `admin_dig_${Date.now()}@example.com`;
    const adminUser = await authService.signup({
      email: adminEmail,
      password: 'SecurePassword123!',
      name: 'Digital Admin',
    });
    await authService.verifyEmail(adminUser.verificationToken);

    await pool.query(
      "UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1) WHERE id = ?",
      [adminUser.user.id]
    );

    const adminLogin = await authService.login({
      email: adminEmail,
      password: 'SecurePassword123!',
    });
    adminToken = adminLogin.token!;

    // Create test digital product
    digitalProductSlug = `digital-ebook-${Date.now()}`;
    const [prodRes] = await pool.query<any>(
      `INSERT INTO products (name, slug, price, product_type, stock_quantity, track_stock, status)
       VALUES ('Pro Node.js Architecture E-Book', ?, 25000, 'digital', 0, FALSE, 'active')`,
      [digitalProductSlug]
    );
    digitalProductId = prodRes.insertId;
  });

  afterAll(async () => {
    moduleRegistry.setModuleState('digital-delivery', true);
    moduleRegistry.setModuleState('store', true);
    await app.close();
  });

  beforeEach(async () => {
    moduleRegistry.setModuleState('digital-delivery', true);
    moduleRegistry.setModuleState('store', true);
  });

  // 1. Digital Assets CRUD
  it('1. Assets CRUD: creates, lists, and deactivates digital product files', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/digital/assets',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        productId: digitalProductId,
        fileName: 'pro-nodejs-architecture.pdf',
        storagePath: 'F:/storage/digital/pro-nodejs-v1.pdf',
        fileSizeBytes: 15485760, // 15 MB
        mimeType: 'application/pdf',
        downloadLimit: 3,
        expiresHours: 48,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const asset = JSON.parse(createRes.body).data;
    expect(asset.id).toBeDefined();
    expect(asset.fileName).toBe('pro-nodejs-architecture.pdf');
    expect(asset.downloadLimit).toBe(3);
    expect(asset.expiresHours).toBe(48);

    // List assets for product
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/digital/assets?productId=${digitalProductId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.body).data;
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((a: any) => a.fileName === 'pro-nodejs-architecture.pdf')).toBe(true);

    // Deactivate asset
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/digital/assets/${asset.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).success).toBe(true);

    // Re-create active asset for subsequent tests
    await DigitalDeliveryService.createAsset({
      productId: digitalProductId,
      fileName: 'nodejs-handbook-complete.pdf',
      storagePath: 'F:/storage/digital/handbook.pdf',
      fileSizeBytes: 5000000,
      mimeType: 'application/pdf',
      downloadLimit: 3,
      expiresHours: 72,
    });
  });

  // 2. License Key Pool Management
  it('2. License Key Pool: bulk uploads keys, lists keys with pagination, and deduplicates', async () => {
    const keys = [
      `NODE-PRO-${Date.now()}-001`,
      `NODE-PRO-${Date.now()}-002`,
      `NODE-PRO-${Date.now()}-003`,
    ];

    const poolRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/digital/licenses/pool',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        productId: digitalProductId,
        keys,
        metadata: { tier: 'professional', maxActivations: 2 },
      },
    });

    expect(poolRes.statusCode).toBe(201);
    const poolData = JSON.parse(poolRes.body).data;
    expect(poolData.addedCount).toBe(3);
    expect(poolData.duplicateCount).toBe(0);

    // Duplicate upload test
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/digital/licenses/pool',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        productId: digitalProductId,
        keys: [keys[0], `NODE-PRO-${Date.now()}-004`],
      },
    });
    const dupData = JSON.parse(dupRes.body).data;
    expect(dupData.addedCount).toBe(1);
    expect(dupData.duplicateCount).toBe(1);

    // List available keys
    const listKeysRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/digital/licenses?productId=${digitalProductId}&status=available`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listKeysRes.statusCode).toBe(200);
    const keyList = JSON.parse(listKeysRes.body).data;
    expect(keyList.length).toBeGreaterThanOrEqual(4);
  });

  // 3 & 4. Checkout + Payment Confirmation -> Entitlement Issuance & Auto-Completion
  it('3 & 4. Digital Order Lifecycle: checkout, payment capture, entitlement generation & order auto-completion', async () => {
    // 1. Checkout digital product
    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'digital_buyer@example.com',
        paymentMethod: 'razorpay',
        items: [{ productId: digitalProductId, quantity: 1 }],
        billingState: '27',
      },
    });

    expect(checkoutRes.statusCode).toBe(201);
    const orderData = JSON.parse(checkoutRes.body).data;
    const [orderRows] = await pool.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_number = ?', [orderData.orderNumber]);
    const orderId = Number(orderRows[0].id);
    const guestToken = orderData.guestAccessToken;
    const gatewayOrderId = orderData.gatewayOrder.gatewayOrderId;
    const orderTotal = orderData.total;

    // Order initially pending_payment
    expect(orderData.status).toBe('pending_payment');

    // 2. Mock payment in Fake Gateway & verify
    const paymentId = `pay_digital_${Date.now()}`;
    fakeGateway.payments.set(paymentId, {
      id: paymentId,
      orderId: gatewayOrderId,
      amount: orderTotal,
      currency: 'INR',
      status: 'captured',
    });

    const sig = fakeGateway.generateSignature(gatewayOrderId, paymentId);
    const verifyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/store/orders/${orderId}/verify-payment`,
      headers: { 'x-guest-token': guestToken },
      payload: {
        razorpayOrderId: gatewayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: sig,
      },
    });

    expect(verifyRes.statusCode).toBe(200);

    // Order status should automatically transition to completed because all digital entitlements are fulfilled
    const verifiedOrder = await StoreService.getOrderById(orderId);
    expect(verifiedOrder?.status).toBe('completed');

    // Order line item should be marked fulfilled
    const [items] = await pool.query<RowDataPacket[]>(
      'SELECT fulfilment_status FROM order_items WHERE order_id = ?',
      [orderId]
    );
    expect(items[0].fulfilment_status).toBe('fulfilled');

    // Verify entitlements were generated in database
    const entitlements = await DigitalDeliveryService.getOrderEntitlements(orderId);
    expect(entitlements.length).toBe(1);
    const ent = entitlements[0];
    expect(ent.status).toBe('active');
    expect(ent.downloadToken).toBeDefined();
    expect(ent.downloadToken.startsWith('dl_')).toBe(true);
    expect(ent.maxDownloads).toBe(3);
    expect(ent.license?.licenseKey).toBeDefined();
    expect(ent.license?.status).toBe('assigned');
  });

  // 5. Customer Entitlements Access
  it('5. Entitlements Access: allows guest with x-guest-token or customer, rejects unauthorized', async () => {
    // Create and confirm another digital order
    const checkoutResult = await StoreService.checkout({
      customerEmail: 'guest_access_test@example.com',
      paymentMethod: 'razorpay',
      items: [{ productId: digitalProductId, quantity: 1 }],
      billingState: '07', // Delhi
    });
    const orderId = checkoutResult.order.id;
    const guestToken = checkoutResult.order.guestAccessToken!;

    await StoreService.confirmOrderPayment(orderId, {
      gatewayPaymentId: `pay_g_${Date.now()}`,
      amountPaise: checkoutResult.order.total,
      currency: 'INR',
    });

    // Request with valid guest token
    const validRes = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/orders/${orderId}/entitlements`,
      headers: { 'x-guest-token': guestToken },
    });
    expect(validRes.statusCode).toBe(200);
    const validBody = JSON.parse(validRes.body);
    expect(Array.isArray(validBody.data)).toBe(true);
    expect(validBody.data.length).toBe(1);
    expect(validBody.data[0].downloadUrl).toContain('/api/v1/digital/download/dl_');
    expect(validBody.data[0].license?.licenseKey).toBeDefined();

    // Request without guest token -> 403 Forbidden
    const unauthRes = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/orders/${orderId}/entitlements`,
    });
    expect(unauthRes.statusCode).toBe(403);
    expect(JSON.parse(unauthRes.body).error.code).toBe('FORBIDDEN');
  });

  // 6. Tokenized Secure Download Verification & Limit Decrement
  it('6. Tokenized Downloads: decrements download count, rejects when limit exceeded or expired', async () => {
    // Generate an isolated test entitlement with valid order and order_item
    const ordNum6 = `ORD-DUM-6-${Date.now()}`;
    const [dummyOrder] = await pool.query<any>(
      `INSERT INTO orders (order_number, customer_email, payment_method, subtotal, tax_total, shipping_total, total, currency, status)
       VALUES (?, 'dummy6@example.com', 'razorpay', 25000, 0, 0, 25000, 'INR', 'completed')`,
      [ordNum6]
    );
    const dummyOrderId = dummyOrder.insertId;

    const [dummyItem] = await pool.query<any>(
      `INSERT INTO order_items (order_id, product_id, title, price, quantity, total)
       VALUES (?, ?, 'Dummy Digital Item', 25000, 1, 25000)`,
      [dummyOrderId, digitalProductId]
    );
    const dummyItemId = dummyItem.insertId;

    const [assetRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM digital_assets WHERE product_id = ? AND is_active = TRUE LIMIT 1',
      [digitalProductId]
    );
    const testAssetId = Number(assetRows[0].id);
    const token1 = `dl_test_token_${Date.now()}`;

    const [entRes] = await pool.query<any>(
      `INSERT INTO digital_entitlements (
        order_id, order_item_id, asset_id, download_token, download_count, max_downloads, expires_at, status
      ) VALUES (?, ?, ?, ?, 0, 2, DATE_ADD(NOW(), INTERVAL 24 HOUR), 'active')`,
      [dummyOrderId, dummyItemId, testAssetId, token1]
    );

    // Download 1: should succeed (remaining: 1)
    const dl1 = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/download/${token1}`,
    });
    expect(dl1.statusCode).toBe(200);
    expect(dl1.headers['x-remaining-downloads']).toBe('1');

    // Download 2: should succeed (remaining: 0)
    const dl2 = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/download/${token1}`,
    });
    expect(dl2.statusCode).toBe(200);
    expect(dl2.headers['x-remaining-downloads']).toBe('0');

    // Download 3: should be rejected due to limit exceeded
    const dl3 = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/download/${token1}`,
    });
    expect(dl3.statusCode).toBe(403);
    expect(JSON.parse(dl3.body).error.message).toContain('Maximum download limit exceeded');

    // Test Expired Token
    const expiredToken = `dl_expired_token_${Date.now()}`;
    await pool.query(
      `INSERT INTO digital_entitlements (
        order_id, order_item_id, asset_id, download_token, download_count, max_downloads, expires_at, status
      ) VALUES (?, ?, ?, ?, 0, 5, DATE_SUB(NOW(), INTERVAL 1 HOUR), 'active')`,
      [dummyOrderId, dummyItemId, testAssetId, expiredToken]
    );

    const expiredDl = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/download/${expiredToken}`,
    });
    expect(expiredDl.statusCode).toBe(403);
    expect(JSON.parse(expiredDl.body).error.message).toContain('expired');
  });

  // 7. Public License Key Verification
  it('7. License Key Verification: verifies active and assigned keys, rejects invalid/revoked keys', async () => {
    const activeKey = `NODE-VERIFY-${Date.now()}`;
    await pool.query(
      `INSERT INTO license_keys (product_id, license_key, status, assigned_at)
       VALUES (?, ?, 'assigned', NOW())`,
      [digitalProductId, activeKey]
    );

    // Verify valid key
    const validCheck = await app.inject({
      method: 'POST',
      url: '/api/v1/digital/licenses/verify',
      payload: { licenseKey: activeKey },
    });
    expect(validCheck.statusCode).toBe(200);
    const validData = JSON.parse(validCheck.body).data;
    expect(validData.valid).toBe(true);
    expect(validData.productId).toBe(digitalProductId);

    // Verify revoked key
    const revokedKey = `NODE-REVOKED-${Date.now()}`;
    await pool.query(
      `INSERT INTO license_keys (product_id, license_key, status)
       VALUES (?, ?, 'revoked')`,
      [digitalProductId, revokedKey]
    );

    const revokedCheck = await app.inject({
      method: 'POST',
      url: '/api/v1/digital/licenses/verify',
      payload: { licenseKey: revokedKey },
    });
    expect(revokedCheck.statusCode).toBe(400);
    expect(JSON.parse(revokedCheck.body).data.valid).toBe(false);

    // Verify non-existent key
    const nonExistentCheck = await app.inject({
      method: 'POST',
      url: '/api/v1/digital/licenses/verify',
      payload: { licenseKey: 'DOES-NOT-EXIST' },
    });
    expect(nonExistentCheck.statusCode).toBe(400);
    expect(JSON.parse(nonExistentCheck.body).data.valid).toBe(false);
  });

  // 8. Refund Revocation Lifecycle
  it('8. Refund Revocation: issuing refund automatically revokes entitlements and license keys', async () => {
    // 1. Create paid digital order
    const checkout = await StoreService.checkout({
      customerEmail: 'refund_digital@example.com',
      paymentMethod: 'razorpay',
      items: [{ productId: digitalProductId, quantity: 1 }],
      billingState: '27',
    });
    const orderId = checkout.order.id;

    await StoreService.confirmOrderPayment(orderId, {
      gatewayPaymentId: `pay_ref_${Date.now()}`,
      amountPaise: checkout.order.total,
      currency: 'INR',
    });

    // Check entitlements active before refund
    const beforeEnts = await DigitalDeliveryService.getOrderEntitlements(orderId);
    expect(beforeEnts.length).toBe(1);
    expect(beforeEnts[0].status).toBe('active');
    const licenseKey = beforeEnts[0].license?.licenseKey;
    expect(licenseKey).toBeDefined();

    // 2. Issue full refund for the digital order
    const [orderItem] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM order_items WHERE order_id = ?',
      [orderId]
    );
    const orderItemId = Number(orderItem[0].id);

    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/store/orders/${orderId}/refund`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lineItems: [{ orderItemId, quantity: 1 }],
        reason: 'Customer requested refund for digital product',
        idempotencyKey: `idemp_ref_${Date.now()}`,
      },
    });

    expect(refundRes.statusCode).toBe(201);

    // 3. Verify entitlements and license keys were revoked
    const afterEnts = await DigitalDeliveryService.getOrderEntitlements(orderId);
    expect(afterEnts[0].status).toBe('revoked');

    const keyCheck = await DigitalDeliveryService.verifyLicenseKey(licenseKey!);
    expect(keyCheck.valid).toBe(false);
    expect(keyCheck.status).toBe('revoked');

    // Verify download token now returns 403 revoked
    const dlRes = await app.inject({
      method: 'GET',
      url: `/api/v1/digital/download/${afterEnts[0].downloadToken}`,
    });
    expect(dlRes.statusCode).toBe(403);
    expect(JSON.parse(dlRes.body).error.message).toContain('revoked');
  });

  // 9. Admin Manual Entitlement Revocation
  it('9. Admin Revocation: manual revocation of single entitlement via admin API', async () => {
    const ordNum9 = `ORD-DUM-9-${Date.now()}`;
    const [dummyOrder9] = await pool.query<any>(
      `INSERT INTO orders (order_number, customer_email, payment_method, subtotal, tax_total, shipping_total, total, currency, status)
       VALUES (?, 'dummy9@example.com', 'razorpay', 25000, 0, 0, 25000, 'INR', 'completed')`,
      [ordNum9]
    );
    const dummyOrderId9 = dummyOrder9.insertId;

    const [dummyItem9] = await pool.query<any>(
      `INSERT INTO order_items (order_id, product_id, title, price, quantity, total)
       VALUES (?, ?, 'Dummy Digital Item 9', 25000, 1, 25000)`,
      [dummyOrderId9, digitalProductId]
    );
    const dummyItemId9 = dummyItem9.insertId;

    const tokenRevoke = `dl_manual_revoke_${Date.now()}`;
    const [entRes] = await pool.query<any>(
      `INSERT INTO digital_entitlements (
        order_id, order_item_id, download_token, download_count, max_downloads, expires_at, status
      ) VALUES (?, ?, ?, 0, 5, DATE_ADD(NOW(), INTERVAL 24 HOUR), 'active')`,
      [dummyOrderId9, dummyItemId9, tokenRevoke]
    );
    const entId = entRes.insertId;

    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/digital/entitlements/${entId}/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(revokeRes.statusCode).toBe(200);
    expect(JSON.parse(revokeRes.body).success).toBe(true);

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT status FROM digital_entitlements WHERE id = ?',
      [entId]
    );
    expect(rows[0].status).toBe('revoked');
  });

  // 10. Module Disabling Behaviors
  it('10. Module Disabling: toggling digital-delivery off blocks digital product creation, checkout, and routes', async () => {
    // Disable digital-delivery module
    moduleRegistry.setModuleState('digital-delivery', false);

    // 1. Digital product creation blocked
    const createProdRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Blocked Digital Course',
        slug: `blocked-course-${Date.now()}`,
        price: 99900,
        productType: 'digital',
      },
    });
    expect(createProdRes.statusCode).toBe(400);
    expect(JSON.parse(createProdRes.body).error.code).toBe('MODULE_DISABLED');

    // 2. Digital checkout blocked
    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'blocked_digital@example.com',
        paymentMethod: 'razorpay',
        items: [{ productId: digitalProductId, quantity: 1 }],
        billingState: '27',
      },
    });
    expect(checkoutRes.statusCode).toBe(400);
    expect(JSON.parse(checkoutRes.body).error.code).toBe('MODULE_DISABLED');

    // 3. Digital routes return 404 MODULE_DISABLED
    const routeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/digital/download/dl_any_token',
    });
    expect(routeRes.statusCode).toBe(404);
    expect(JSON.parse(routeRes.body).error.code).toBe('MODULE_DISABLED');

    // Re-enable
    moduleRegistry.setModuleState('digital-delivery', true);
  });

  // 11. RBAC Protection
  it('11. RBAC: protects admin digital endpoints from unauthorized users', async () => {
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/digital/assets',
    });
    expect(unauthRes.statusCode).toBe(401);

    const postUnauth = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/digital/licenses/pool',
      payload: { productId: digitalProductId, keys: ['TEST'] },
    });
    expect(postUnauth.statusCode).toBe(401);
  });
});
