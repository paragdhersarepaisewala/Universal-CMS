import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { blogModuleManifest } from '../src/modules/blog/index.js';

describe('Blog Module Engine Suite', () => {
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
    moduleRegistry.registerManifest(blogModuleManifest);
    moduleRegistry.setModuleState('blog', true);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public Blog API', () => {
    it('returns published posts at GET /api/v1/blog/posts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/posts',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.meta).toHaveProperty('total');
    });

    it('returns single post details at GET /api/v1/blog/posts/:slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/posts/welcome-to-universal-cms',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.slug).toBe('welcome-to-universal-cms');
      expect(body.data.readingTimeMinutes).toBeGreaterThanOrEqual(1);
      expect(body.data).toHaveProperty('content');
    });

    it('returns categories and tags', async () => {
      const catRes = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/categories',
      });
      expect(catRes.statusCode).toBe(200);
      const catBody = JSON.parse(catRes.body);
      expect(catBody.data.length).toBeGreaterThanOrEqual(1);

      const tagRes = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/tags',
      });
      expect(tagRes.statusCode).toBe(200);
      const tagBody = JSON.parse(tagRes.body);
      expect(tagBody.data.length).toBeGreaterThanOrEqual(1);
    });

    it('returns valid RSS 2.0 XML feed at GET /api/v1/blog/rss.xml', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/rss.xml',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
      expect(res.body).toContain('<rss version="2.0">');
      expect(res.body).toContain('<channel>');
      expect(res.body).toContain('welcome-to-universal-cms');
    });
  });

  describe('Admin Blog API', () => {
    it('allows admin to create, update, and delete blog articles', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Create post
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/blog/posts',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'Scaling Headless CMS on Shared Hosting',
          slug: 'scaling-headless-cms-shared-hosting',
          excerpt: 'How to architect node apps for efficiency.',
          content: 'Detailed deep dive into connection pooling, memory caching, and async job queues without persistent background daemons.',
          status: 'published',
          isFeatured: true,
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = JSON.parse(createRes.body);
      expect(createBody.data.slug).toBe('scaling-headless-cms-shared-hosting');
      expect(createBody.data.readingTimeMinutes).toBe(1);
      const postId = createBody.data.id;

      // Update post
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/blog/posts/${postId}`,
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'Scaling Headless CMS on Shared Hosting (Updated)',
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const updateBody = JSON.parse(updateRes.body);
      expect(updateBody.data.title).toContain('(Updated)');

      // Delete post
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/blog/posts/${postId}`,
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(delRes.statusCode).toBe(200);
    });
  });

  describe('Blog Module Guard', () => {
    it('returns 404 MODULE_DISABLED when blog module is toggled off', async () => {
      moduleRegistry.setModuleState('blog', false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/posts',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('MODULE_DISABLED');

      // Re-enable for subsequent tests
      moduleRegistry.setModuleState('blog', true);
    });
  });
});
