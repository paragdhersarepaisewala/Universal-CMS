import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';

describe('CP2.8 Content, Theme & Compliance API', () => {
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

  describe('Theme API', () => {
    it('returns public theme design tokens at GET /api/v1/theme', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/theme',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('color.primary');
      expect(body.data).toHaveProperty('font.family_sans');
      expect(body.data).toHaveProperty('layout.radius');
    });

    it('allows admin to update theme tokens and verifies cache invalidation', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/theme',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          'color.primary': '#1d4ed8',
        },
      });

      expect(updateRes.statusCode).toBe(200);

      // Verify public theme immediately reflects the update
      const publicRes = await app.inject({
        method: 'GET',
        url: '/api/v1/theme',
      });
      const publicBody = JSON.parse(publicRes.body);
      expect(publicBody.data['color.primary']).toBe('#1d4ed8');

      spy.mockRestore();
    });
  });

  describe('Pages & Content Blocks API', () => {
    it('creates, publishes, retrieves, and updates content pages', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // 1. Create published page with blocks
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pages',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'About Our Company',
          slug: 'about-us',
          status: 'published',
          blocks: [
            {
              blockType: 'hero',
              data: { heading: 'Leading the Future', text: 'Our mission and vision.' },
              sortOrder: 1,
              isActive: true,
            },
          ],
        },
      });

      expect(createRes.statusCode).toBe(200);
      const pageId = JSON.parse(createRes.body).data.id;
      expect(pageId).toBeGreaterThan(0);

      // 2. Public route GET /api/v1/pages/:slug
      const publicRes = await app.inject({
        method: 'GET',
        url: '/api/v1/pages/about-us',
      });
      expect(publicRes.statusCode).toBe(200);
      const publicBody = JSON.parse(publicRes.body);
      expect(publicBody.data.title).toBe('About Our Company');

      // 3. Update page with optimistic versioning
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/pages/${pageId}`,
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'About Our Company (Updated)',
          version: 1,
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).data.title).toBe('About Our Company (Updated)');

      // 4. Stale version conflict check
      const conflictRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/pages/${pageId}`,
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'Stale Edit',
          version: 1, // Current version is now 2
        },
      });
      expect(conflictRes.statusCode).toBe(409);

      spy.mockRestore();
    });

    it('returns 404 for draft pages requested via public endpoint', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pages',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'Draft Secret Page',
          slug: 'secret-draft',
          status: 'draft',
        },
      });

      const publicRes = await app.inject({
        method: 'GET',
        url: '/api/v1/pages/secret-draft',
      });
      expect(publicRes.statusCode).toBe(404);

      spy.mockRestore();
    });
  });

  describe('Menus API', () => {
    it('retrieves active navigation items by location', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/menus/header',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.location).toBe('header');
      expect(body.data.items.length).toBeGreaterThan(0);
    });

    it('allows admin to manage menus', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/menus',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Mobile Menu',
          slug: 'mobile-menu',
          location: 'mobile',
          items: [
            { label: 'Shop Now', url: '/store', sortOrder: 1 },
          ],
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createdId = JSON.parse(createRes.body).data.id;

      // Verify deletion
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/menus/${createdId}`,
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(deleteRes.statusCode).toBe(200);

      spy.mockRestore();
    });
  });

  describe('Media Library API', () => {
    it('provides upload rules per contract section 2.7', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/media/rules',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('maxSizeBytes');
      expect(body.data.allowedMimeTypes).toContain('image/webp');
      expect(body.data.autoWebpConversion).toBe(true);

      spy.mockRestore();
    });

    it('registers media items and supports deletion', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/media',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          filename: 'product-display.webp',
          originalName: 'product-display.png',
          mimeType: 'image/webp',
          sizeBytes: 85200,
          width: 1200,
          height: 800,
          publicUrl: '/uploads/product-display.webp',
        },
      });

      expect(uploadRes.statusCode).toBe(200);
      const mediaId = JSON.parse(uploadRes.body).data.id;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/media/${mediaId}`,
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(deleteRes.statusCode).toBe(200);

      spy.mockRestore();
    });
  });

  describe('SEO & Sitemap API', () => {
    it('serves dynamic sitemap.xml with urlset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sitemap.xml',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
      expect(res.body).toContain('<urlset');
      expect(res.body).toContain('<loc>');
    });

    it('serves robots.txt crawler protocol', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/robots.txt',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toContain('User-agent:');
      expect(res.body).toContain('Disallow: /admin/');
    });

    it('updates global SEO defaults and entity-level meta', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/seo',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          defaultTitle: 'Premier Store India',
          googleAnalyticsId: 'G-XYZ12345',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.defaultTitle).toBe('Premier Store India');

      spy.mockRestore();
    });
  });

  describe('Redirects API', () => {
    it('creates, resolves, and tracks 301/302 redirects', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/redirects',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          sourcePath: '/catalog/summer',
          targetPath: '/store?season=summer',
          statusCode: 301,
        },
      });

      expect(createRes.statusCode).toBe(200);

      // Resolve via public endpoint
      const resolveRes = await app.inject({
        method: 'GET',
        url: '/api/v1/redirects/resolve?path=/catalog/summer',
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolveBody = JSON.parse(resolveRes.body);
      expect(resolveBody.data.targetPath).toBe('/store?season=summer');
      expect(resolveBody.data.statusCode).toBe(301);

      spy.mockRestore();
    });
  });

  describe('Legal & Statutory Compliance API', () => {
    it('lists 8 statutory India legal draft templates with draft disclaimer', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/legal/templates',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBe(8);
      expect(body.notice).toContain('draft');

      const slugs = body.data.map((t: { slug: string }) => t.slug);
      expect(slugs).toContain('privacy-policy');
      expect(slugs).toContain('terms-and-conditions');
      expect(slugs).toContain('refund-and-cancellation-policy');
      expect(slugs).toContain('shipping-and-delivery-policy');
      expect(slugs).toContain('contact-us');
      expect(slugs).toContain('grievance-redressal');
      expect(slugs).toContain('cookie-policy');
      expect(slugs).toContain('disclaimer');

      spy.mockRestore();
    });

    it('records user cookie consent and lists in admin consent logs', async () => {
      const consentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cookies/consent',
        payload: {
          consentId: 'consent_usr_9988',
          categories: {
            necessary: true,
            analytics: true,
            marketing: false,
            preferences: true,
          },
        },
      });

      expect(consentRes.statusCode).toBe(200);
      expect(JSON.parse(consentRes.body).data.consentId).toBe('consent_usr_9988');

      // Admin verification
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/legal/consents',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.data.length).toBeGreaterThan(0);

      spy.mockRestore();
    });
  });

  describe('Site Settings & Audit Logs API', () => {
    it('updates site settings and audits administrative mutations', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const currentRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: { authorization: 'Bearer admin_token' },
      });
      const current = JSON.parse(currentRes.body).data;

      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          siteName: 'Universal CMS Flagship',
          version: current.version,
        },
      });

      expect(updateRes.statusCode).toBe(200);

      // Verify mutation is recorded in audit logs
      const auditRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/logs/audit',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(auditRes.statusCode).toBe(200);
      const auditBody = JSON.parse(auditRes.body);
      expect(auditBody.data.some((l: { action: string }) => l.action === 'settings.updated')).toBe(true);

      spy.mockRestore();
    });

    it('denies editor role access to site settings modification (403 FORBIDDEN)', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockEditorUser);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings',
        headers: { authorization: 'Bearer editor_token' },
        payload: { siteName: 'Hacked Title' },
      });

      expect(res.statusCode).toBe(403);
      spy.mockRestore();
    });
  });
});
