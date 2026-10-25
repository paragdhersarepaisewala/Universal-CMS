import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';

import { initializeModules, moduleRegistry } from '../src/modules/index.js';

describe('News Portal, Ad Slots and SEO Enhancements', () => {
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
    moduleRegistry.setModuleState('blog', true);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Ad Slot Management', () => {
    it('serves active public ad slot', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ad-slots/header_banner',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.location).toBe('header_banner');
      expect(body.data.codeHtml).toContain('Header 728x90');
    });

    it('returns 404 for unknown ad slot', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ad-slots/non_existent_slot',
      });

      expect(res.statusCode).toBe(404);
    });

    it('allows admin to list and update ad slots', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ad-slots',
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(Array.isArray(listBody.data)).toBe(true);

      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/ad-slots/header_banner',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Top Header Ad Updated',
          codeHtml: '<div>Special Sponsor Ad</div>',
          isActive: true,
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updateBody = JSON.parse(updateRes.body);
      expect(updateBody.data.codeHtml).toBe('<div>Special Sponsor Ad</div>');

      spy.mockRestore();
    });
  });

  describe('Blog News Portal Features', () => {
    it('serves Google News compatible XML sitemap', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/news-sitemap.xml',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
      expect(res.body).toContain('<news:publication>');
      expect(res.body).toContain('<news:title>');
    });

    it('serves related posts for an article', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/posts/welcome-to-universal-cms/related',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('SEO Entity Resolution', () => {
    it('resolves SEO metadata for an entity', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/seo/product/sample-product-sku',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.data.metaTitle).toBeDefined();
    });
  });
});
