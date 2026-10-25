import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { renderTemplate, wrapInEmailLayout } from '../src/email/renderer.js';
import { encryptText, decryptText } from '../src/utils/encryption.js';
import { EmailService } from '../src/email/service.js';
import { EMAIL_EVENTS } from '../src/email/events.js';

describe('CP2.6 Email Engine', () => {
  let app: FastifyInstance;

  const mockAdminUser = {
    id: 2,
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

  describe('Template Renderer', () => {
    it('renders variables with dot notation and safely handles missing paths', () => {
      const template = 'Hello {{ user.name }}, your order #{{ order.id }} is {{ order.status }}. Missing: {{ missing.field }}';
      const rendered = renderTemplate(template, {
        user: { name: 'Vikram' },
        order: { id: 'ORD-987', status: 'shipped' },
      });

      expect(rendered).toBe('Hello Vikram, your order #ORD-987 is shipped. Missing: ');
    });

    it('wraps HTML body in responsive email layout', () => {
      const html = wrapInEmailLayout('<p>Thank you for your purchase.</p>', {
        siteName: 'Acme Store',
        primaryColor: '#ff5500',
        unsubscribeUrl: 'https://example.com/unsub',
      });

      expect(html).toContain('Acme Store');
      expect(html).toContain('#ff5500');
      expect(html).toContain('Thank you for your purchase.');
      expect(html).toContain('https://example.com/unsub');
    });
  });

  describe('AES-256-GCM Sensitive Configuration Encryption', () => {
    it('encrypts and decrypts passwords securely', () => {
      const secret = 'super-secret-smtp-password-1234';
      const encrypted = encryptText(secret);

      expect(encrypted).not.toBe(secret);
      expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

      const decrypted = decryptText(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('rejects invalid ciphertext formats', () => {
      expect(() => decryptText('not-a-valid-encrypted-string')).toThrow();
    });
  });

  describe('Event Registry and Automation', () => {
    it('registers all 14 automatic email events', () => {
      const eventKeys = Object.keys(EMAIL_EVENTS);
      expect(eventKeys).toHaveLength(14);
      expect(eventKeys).toContain('auth.welcome');
      expect(eventKeys).toContain('auth.verify_email');
      expect(eventKeys).toContain('auth.password_reset');
      expect(eventKeys).toContain('order.placed');
      expect(eventKeys).toContain('order.payment_received');
      expect(eventKeys).toContain('order.shipped');
      expect(eventKeys).toContain('order.delivered');
      expect(eventKeys).toContain('order.cancelled');
      expect(eventKeys).toContain('order.refund');
      expect(eventKeys).toContain('order.invoice');
      expect(eventKeys).toContain('cart.abandoned');
      expect(eventKeys).toContain('donation.receipt');
      expect(eventKeys).toContain('admin.new_order');
      expect(eventKeys).toContain('admin.low_stock');
    });

    it('allows updating event toggles and subjects', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/email/automation/order.placed',
        headers: {
          authorization: 'Bearer admin_token',
        },
        payload: {
          isEnabled: true,
          subject: 'Custom Subject: Your Order #{{ order.number }} is Confirmed',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.key).toBe('order.placed');
      expect(body.data.subject).toBe('Custom Subject: Your Order #{{ order.number }} is Confirmed');

      spy.mockRestore();
    });
  });

  describe('Admin SMTP and Test Send Endpoints', () => {
    it('retrieves SMTP settings with password masked', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/email/smtp',
        headers: {
          authorization: 'Bearer admin_token',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('host');
      expect(body.data).toHaveProperty('password_set');
      expect(body.data).not.toHaveProperty('password');

      spy.mockRestore();
    });

    it('denies editor role from viewing or updating SMTP settings (403)', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockEditorUser);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/email/smtp',
        headers: {
          authorization: 'Bearer editor_token',
        },
      });

      expect(res.statusCode).toBe(403);
      spy.mockRestore();
    });

    it('updates SMTP configuration with optimistic concurrency versioning', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const currentRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/email/smtp',
        headers: {
          authorization: 'Bearer admin_token',
        },
      });
      const current = JSON.parse(currentRes.body).data;

      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/email/smtp',
        headers: {
          authorization: 'Bearer admin_token',
        },
        payload: {
          host: 'smtp.sendgrid.net',
          port: 587,
          security: 'starttls',
          username: 'apikey',
          password: 'SG.new-secret-key',
          from_name: 'Store Support',
          from_address: 'support@example.com',
          version: current.version,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const updated = JSON.parse(updateRes.body).data;
      expect(updated.host).toBe('smtp.sendgrid.net');
      expect(updated.password_set).toBe(true);
      expect(updated.version).toBe(current.version + 1);

      spy.mockRestore();
    });

    it('enqueues test email delivery', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/email/test-send',
        headers: {
          authorization: 'Bearer admin_token',
        },
        payload: {
          to: 'client-test@example.com',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.success).toBe(true);
      expect(body.data.logId).toBeGreaterThan(0);

      spy.mockRestore();
    });
  });

  describe('Unsubscribe & Marketing Consent', () => {
    it('handles unsubscribe via secure token', async () => {
      const email = 'marketing-customer@example.com';
      const token = EmailService.generateUnsubscribeToken(email);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/email/unsubscribe',
        payload: { email, token },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.success).toBe(true);

      // Verify that further marketing sends are blocked
      const enqueueResult = await EmailService.enqueueEmail({
        to: email,
        templateKey: 'cart.abandoned',
        category: 'marketing',
      });

      expect(enqueueResult.queued).toBe(false);
      expect(enqueueResult.message).toContain('unsubscribed');
    });

    it('rejects invalid unsubscribe token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/email/unsubscribe',
        payload: { email: 'user@example.com', token: 'fake-invalid-token' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Email Logs and Queue Processing', () => {
    it('lists logs and supports manual resend', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const testSendRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/email/test-send',
        headers: {
          authorization: 'Bearer admin_token',
        },
        payload: { to: 'log-check@example.com' },
      });
      const logId = JSON.parse(testSendRes.body).data.logId;

      const logListRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/email/log',
        headers: {
          authorization: 'Bearer admin_token',
        },
      });

      expect(logListRes.statusCode).toBe(200);
      const logBody = JSON.parse(logListRes.body);
      expect(logBody.data.length).toBeGreaterThan(0);

      // Resend test
      const resendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/email/log/${logId}/resend`,
        headers: {
          authorization: 'Bearer admin_token',
        },
      });

      expect(resendRes.statusCode).toBe(200);
      expect(JSON.parse(resendRes.body).data.success).toBe(true);

      spy.mockRestore();
    });

    it('processes email queue via admin endpoint', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/email/queue/process',
        headers: {
          authorization: 'Bearer admin_token',
        },
        payload: { batchSize: 5 },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('processed');
      expect(body.data).toHaveProperty('succeeded');

      spy.mockRestore();
    });
  });
});
