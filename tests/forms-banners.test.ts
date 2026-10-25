import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { pool } from '../src/db/pool.js';

describe('Forms & Banners Engine Suite', () => {
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
    await pool.query("DELETE FROM forms WHERE slug = 'feedback'");
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public Forms API', () => {
    it('returns public form schema at GET /api/v1/forms/:slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/forms/contact',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.slug).toBe('contact');
      expect(body.data.fields).toBeInstanceOf(Array);
      expect(body.data.fields.some((f: { name: string }) => f.name === 'email')).toBe(true);
    });

    it('rejects submissions with missing required fields at POST /api/v1/forms/:slug/submit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/forms/contact/submit',
        payload: {
          name: 'Jane Doe',
          // email is required but omitted
          message: 'Hello there!',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('missing');
    });

    it('successfully accepts valid form submissions', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/forms/contact/submit',
        payload: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          message: 'I would like to inquire about enterprise plans.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('submissionId');
      expect(body.data.message).toBeDefined();
    });

    it('silently drops spam submission containing honeypot _hp without recording', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/forms/contact/submit',
        payload: {
          name: 'Spam Bot',
          email: 'bot@spam.com',
          message: 'Buy cheap items!',
          _hp: 'i-am-a-bot-filling-hidden-field',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.submissionId).toBe(0);
    });
  });

  describe('Admin Forms & Submissions Inbox API', () => {
    it('allows admin to list and create forms', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // List forms
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/forms',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.data.length).toBeGreaterThanOrEqual(1);

      // Create new form
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/forms',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Feedback Form',
          slug: 'feedback',
          description: 'Client product feedback',
          fields: [
            { name: 'rating', label: 'Rating', type: 'number', required: true },
            { name: 'comments', label: 'Comments', type: 'textarea' },
          ],
          notificationEmail: 'support@example.com',
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = JSON.parse(createRes.body);
      expect(createBody.data.slug).toBe('feedback');
    });

    it('allows admin to view submissions inbox and mark read', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const inboxRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/forms/1/submissions',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(inboxRes.statusCode).toBe(200);
      const inboxBody = JSON.parse(inboxRes.body);
      expect(inboxBody.data.length).toBeGreaterThanOrEqual(1);
      const firstSubId = inboxBody.data[0].id;

      const markRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/forms/submissions/${firstSubId}/read`,
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(markRes.statusCode).toBe(200);
    });
  });

  describe('Public & Admin Banners API', () => {
    it('fetches targeted active banners at GET /api/v1/banners', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/banners?path=/store',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('content');
    });

    it('allows admin to manage banner lifecycle', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Create banner
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/banners',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Flash Sale',
          type: 'popup',
          content: 'Midnight 50% Off Sale!',
          buttonText: 'Claim Discount',
          location: 'modal',
          targetPages: ['/sale'],
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = JSON.parse(createRes.body);
      const bannerId = createBody.data.id;

      // Update banner
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/banners/${bannerId}`,
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          name: 'Flash Sale Updated',
          content: 'Midnight 60% Off Sale!',
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const updateBody = JSON.parse(updateRes.body);
      expect(updateBody.data.name).toBe('Flash Sale Updated');

      // Delete banner (requires delete permission)
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockEditorUser);
      const deleteFail = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/banners/${bannerId}`,
        headers: { authorization: 'Bearer editor_token' },
      });
      expect(deleteFail.statusCode).toBe(403);

      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);
      const deleteOk = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/banners/${bannerId}`,
        headers: { authorization: 'Bearer admin_token' },
      });
      expect(deleteOk.statusCode).toBe(200);
    });
  });
});
