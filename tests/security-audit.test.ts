import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initializeModules, moduleRegistry } from '../src/modules/index.js';
import { StoreService } from '../src/modules/store/service.js';
import { ApiTokenService } from '../src/api-tokens/service.js';
import * as authServiceModule from '../src/auth/service.js';

describe('Security Audit & Gap Analysis Verification', () => {
  let app: FastifyInstance;

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
    initializeModules();
    moduleRegistry.setModuleState('store', true);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Ecommerce Price Tampering Defense (CWE-472)', () => {
    it('overrides client-submitted price with authoritative server catalog price', async () => {
      // Product 1 (Artisan Ceramic Mug) true price is 79900 paise (Rs 799.00)
      // Malicious payload attempts to checkout at price: 10 paise (Rs 0.10)
      const order = await StoreService.createOrder({
        customerEmail: 'tamperer@example.com',
        items: [
          {
            productId: 1,
            title: 'Artisan Ceramic Mug',
            price: 10, // Tampered client price!
            quantity: 1,
          },
        ],
        paymentMethod: 'cod',
        shippingAddress: { address: '123 Safe St', city: 'Mumbai', pincode: '400001' },
      });

      // Subtotal must be authoritative 79900, not 10!
      expect(order.subtotal).toBe(79900);
      expect(order.items![0].price).toBe(79900);
    });

    it('rejects order when requested quantity exceeds available stock', async () => {
      await expect(
        StoreService.createOrder({
          customerEmail: 'overorder@example.com',
          items: [
            {
              productId: 1,
              title: 'Artisan Ceramic Mug',
              price: 79900,
              quantity: 999999, // Exceeds stock
            },
          ],
          paymentMethod: 'cod',
          shippingAddress: { address: '123 Safe St' },
        })
      ).rejects.toThrow(/Insufficient stock/);
    });
  });

  describe('Numeric Code Email Verification (Code Collision Defense)', () => {
    it('rejects 6-digit verification code without email address', async () => {
      await expect(
        authServiceModule.authService.verifyEmail('123456')
      ).rejects.toThrow(/Email address is required when verifying with a numeric 6-digit code/);
    });
  });

  describe('Media Upload Constraints Validation (CWE-434)', () => {
    it('rejects forbidden MIME type with 422 Unprocessable Entity', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/media',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          filename: 'malicious.exe',
          originalName: 'malicious.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 1024,
          publicUrl: '/uploads/malicious.exe',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('not allowed');

      spy.mockRestore();
    });

    it('rejects file exceeding max size limit with 422', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/media',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          filename: 'huge.png',
          originalName: 'huge.png',
          mimeType: 'image/png',
          sizeBytes: 50 * 1024 * 1024, // 50MB > 10MB limit
          publicUrl: '/uploads/huge.png',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('exceeds maximum allowed limit');

      spy.mockRestore();
    });
  });

  describe('Redirect Loop Defense (CWE-601)', () => {
    it('rejects self-referential redirect with 400 Bad Request', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/redirects',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          sourcePath: '/loop-test',
          targetPath: '/loop-test',
          statusCode: 301,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('Self-referential redirect detected');

      spy.mockRestore();
    });
  });

  describe('API Token Bearer Authentication', () => {
    it('allows API tokens with cms_live_ prefix to access protected endpoints', async () => {
      const { token } = await ApiTokenService.createToken({
        name: 'Headless Storefront Integration',
        userId: 1,
        scopes: ['admin', 'content:read'],
      });

      expect(token).toMatch(/^cms_live_/);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.data.siteName).toBeDefined();
    });
  });
});
