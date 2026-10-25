import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { createHmac } from 'node:crypto';

import { pool } from '../src/db/pool.js';
import { FakePaymentGateway, setPaymentGateway } from '../src/modules/store/payment-gateway.js';

describe('Ecommerce Store & Checkout Engine Suite', () => {
  let app: FastifyInstance;
  let fakeGateway: FakePaymentGateway;

  const mockAdminUser = {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
    roleId: 2,
    roleName: 'admin',
    isActive: true,
    emailVerifiedAt: new Date().toISOString(),
    twoFactorEnabled: false,
  };

  beforeAll(async () => {
    moduleRegistry.registerManifest(storeModuleManifest);
    moduleRegistry.setModuleState('store', true);
    fakeGateway = new FakePaymentGateway();
    setPaymentGateway(fakeGateway);

    // Clean up past run test records
    await pool.query('DELETE FROM products WHERE slug = "handwoven-linen-scarf"');

    // Seed test product and coupon
    await pool.query(
      `INSERT INTO products (id, name, slug, price, stock_quantity, track_stock, status)
       VALUES (1, 'Artisan Ceramic Mug', 'artisan-ceramic-mug', 79900, 50, 1, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), stock_quantity = 50, status = 'active'`
    );
    await pool.query(
      `INSERT INTO coupons (code, discount_type, discount_value, max_discount_amount, is_active)
       VALUES ('WELCOME10', 'percentage', 10, 20000, 1)
       ON DUPLICATE KEY UPDATE discount_type = VALUES(discount_type), discount_value = VALUES(discount_value), is_active = 1`
    );

    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public Catalog & Cart API', () => {
    it('returns active product catalog at GET /api/v1/store/products', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/store/products',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('price');
    });

    it('returns product details at GET /api/v1/store/products/:slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/store/products/artisan-ceramic-mug',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.slug).toBe('artisan-ceramic-mug');
      expect(body.data.price).toBe(79900);
    });

    it('calculates totals with tax and coupon at POST /api/v1/store/cart/quote', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/cart/quote',
        payload: {
          items: [
            { productId: 1, title: 'Artisan Ceramic Mug', price: 79900, quantity: 2 }, // 159800
          ],
          couponCode: 'WELCOME10', // 10% capped at Rs 200 (20000)
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.subtotal).toBe(159800);
      expect(body.data.discountTotal).toBe(15980);
      expect(body.data.taxTotal).toBeGreaterThan(0);
      expect(body.data.total).toBeGreaterThan(body.data.subtotal - body.data.discountTotal);
    });
  });

  describe('Checkout & Razorpay Verification', () => {
    let createdOrderNumber: string;

    it('places an order via POST /api/v1/store/checkout', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'customer@example.com',
          paymentMethod: 'razorpay',
          items: [
            { productId: 1, title: 'Artisan Ceramic Mug', price: 79900, quantity: 1 },
          ],
          shippingAddress: {
            fullName: 'Rahul Sharma',
            addressLine1: 'Flat 402, Sunshine Apts',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
          billingState: 'Karnataka',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('orderNumber');
      expect(body.data.orderNumber).toMatch(/^ORD-/);
      expect(body.data.status).toMatch(/pending/);
      createdOrderNumber = body.data.orderNumber;
    });

    it('verifies razorpay signature and captures order at POST /api/v1/store/checkout/razorpay/verify', async () => {
      const secret = fakeGateway.secret;
      const rzpOrderId = 'order_EK5VbJu35W4y91';
      const rzpPaymentId = 'pay_29QQoUBcxrhErq';
      const sig = createHmac('sha256', secret).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout/razorpay/verify',
        payload: {
          orderNumber: createdOrderNumber,
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: rzpPaymentId,
          razorpaySignature: sig,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.success).toBe(true);
      expect(body.data.order.paymentStatus).toBe('captured');
    });

    it('rejects invalid razorpay signature', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout/razorpay/verify',
        payload: {
          orderNumber: createdOrderNumber,
          razorpayOrderId: 'order_123',
          razorpayPaymentId: 'pay_123',
          razorpaySignature: 'invalid_signature_hash',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('failed');
    });
  });

  describe('Customer Reviews API', () => {
    it('submits a review for a product', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/products/artisan-ceramic-mug/reviews',
        payload: {
          authorName: 'Ananya Roy',
          authorEmail: 'ananya@example.com',
          rating: 5,
          comment: 'Excellent craftsmanship and fast delivery!',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.status).toBe('pending');
    });
  });

  describe('Admin Store Operations API', () => {
    it('allows admin to manage products and orders', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Create product
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/store/products',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Handwoven Linen Scarf',
          slug: 'handwoven-linen-scarf',
          description: '100% pure linen handwoven scarf in natural indigo dye.',
          sku: 'SCARF-LIN-03',
          price: 129900,
          stockQuantity: 25,
          status: 'active',
        },
      });

      expect([200, 201]).toContain(createRes.statusCode);
      const createBody = JSON.parse(createRes.body);
      const prodId = createBody.data.id;

      // Update product inventory
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/store/products/${prodId}`,
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          stockQuantity: 30,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const updateBody = JSON.parse(updateRes.body);
      expect(updateBody.data.stockQuantity).toBe(30);

      // List orders
      const ordersRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/store/orders',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(ordersRes.statusCode).toBe(200);
      const ordersBody = JSON.parse(ordersRes.body);
      expect(ordersBody.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Store Module Guard', () => {
    it('returns 404 MODULE_DISABLED when store module is toggled off', async () => {
      moduleRegistry.setModuleState('store', false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/store/products',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('MODULE_DISABLED');

      // Re-enable
      moduleRegistry.setModuleState('store', true);
    });
  });
});
