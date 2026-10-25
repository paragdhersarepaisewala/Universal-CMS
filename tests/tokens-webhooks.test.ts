import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { ApiTokenService } from '../src/api-tokens/service.js';
import { WebhookService } from '../src/webhooks/service.js';

describe('CP2.9 API Tokens & Webhooks Suite', () => {
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

  const mockEditorUser = {
    id: 4,
    name: 'Editor User',
    email: 'editor@example.com',
    roleId: 4,
    roleName: 'editor',
    isActive: true,
    emailVerifiedAt: new Date().toISOString(),
    twoFactorEnabled: false,
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ApiTokenService unit logic', () => {
    it('generates token format starting with cms_live_', () => {
      const { token, prefix, hash } = ApiTokenService.generateToken();
      expect(token).toMatch(/^cms_live_[0-9a-f]{48}$/);
      expect(prefix).toBe(token.slice(0, 12));
      expect(hash).toHaveLength(64);
    });

    it('creates and validates a token', async () => {
      const { token, record } = await ApiTokenService.createToken({
        name: 'Zapier Integration',
        userId: 1,
        scopes: ['read', 'write'],
      });

      expect(record.name).toBe('Zapier Integration');
      expect(record.scopes).toEqual(['read', 'write']);

      const validated = await ApiTokenService.validateToken(token);
      expect(validated).not.toBeNull();
      expect(validated?.id).toBe(record.id);

      const invalid = await ApiTokenService.validateToken('invalid_token_xyz');
      expect(invalid).toBeNull();
    });

    it('rejects expired tokens', async () => {
      const expiredDate = new Date(Date.now() - 3600000).toISOString();
      const { token } = await ApiTokenService.createToken({
        name: 'Expired Test',
        userId: 1,
        scopes: ['read'],
        expiresAt: expiredDate,
      });

      const validated = await ApiTokenService.validateToken(token);
      expect(validated).toBeNull();
    });

    it('lists tokens without revealing tokenHash', async () => {
      const list = await ApiTokenService.listTokens();
      expect(Array.isArray(list)).toBe(true);
      for (const item of list) {
        expect(item).not.toHaveProperty('tokenHash');
      }
    });
  });

  describe('WebhookService unit logic', () => {
    it('computes valid HMAC SHA-256 payload signature', () => {
      const secret = 'whsec_test_secret_123';
      const payload = JSON.stringify({ event: 'order.created', total: 5000 });
      const sig1 = WebhookService.signPayload(payload, secret);
      const sig2 = WebhookService.signPayload(payload, secret);
      expect(sig1).toHaveLength(64);
      expect(sig1).toBe(sig2);
    });

    it('registers, lists, dispatches, and deletes webhooks', async () => {
      const sub = await WebhookService.registerWebhook({
        url: 'https://example.com/webhook/test',
        events: ['page.published', 'user.registered'],
      });

      expect(sub.id).toBeDefined();
      expect(sub.secret).toMatch(/^whsec_/);
      expect(sub.events).toContain('page.published');

      const list = await WebhookService.listWebhooks();
      expect(list.some(w => w.id === sub.id)).toBe(true);

      const dispatchResult = await WebhookService.dispatchEvent('page.published', {
        pageId: 10,
        slug: 'about-us',
      });
      expect(dispatchResult.dispatchedCount).toBeGreaterThanOrEqual(1);
      expect(dispatchResult.subscribers).toContain('https://example.com/webhook/test');

      const deleted = await WebhookService.deleteWebhook(sub.id);
      expect(deleted).toBe(true);
    });
  });

  describe('Admin API Tokens Endpoints', () => {
    it('rejects unauthenticated requests to GET /api/v1/admin/tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/tokens',
      });
      expect(res.statusCode).toBe(401);
    });

    it('allows admin to list and create API tokens', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Create token
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/tokens',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Mobile App Client',
          scopes: ['read', 'write'],
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = JSON.parse(createRes.body);
      expect(createBody.data).toHaveProperty('token');
      expect(createBody.data).toHaveProperty('id');
      expect(createBody.data.token).toMatch(/^cms_live_/);

      const tokenId = createBody.data.id;

      // List tokens
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/tokens',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.data.some((t: { id: string }) => t.id === tokenId)).toBe(true);

      // Revoke token
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tokens/${tokenId}`,
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(delRes.statusCode).toBe(200);
    });
  });

  describe('Admin Webhooks Endpoints', () => {
    it('rejects unauthorized users from registering webhooks', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockEditorUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/webhooks',
        headers: { authorization: 'Bearer editor_token' },
        payload: {
          url: 'https://webhook.site/test',
          events: ['*'],
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows admin to register, test, and delete webhooks', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Register webhook
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/webhooks',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          url: 'https://api.partner.com/events',
          events: ['order.created', 'order.paid'],
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = JSON.parse(createRes.body);
      expect(createBody.data.url).toBe('https://api.partner.com/events');
      const webhookId = createBody.data.id;

      // Test webhook dispatch
      const testRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/webhooks/test',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          event: 'order.created',
          payload: { orderId: 101, amount: 2500 },
        },
      });

      expect(testRes.statusCode).toBe(200);
      const testBody = JSON.parse(testRes.body);
      expect(testBody.data.dispatchedCount).toBeGreaterThanOrEqual(1);

      // Delete webhook
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/webhooks/${webhookId}`,
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(delRes.statusCode).toBe(200);
    });
  });
});
