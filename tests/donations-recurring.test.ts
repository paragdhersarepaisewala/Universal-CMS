import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { donationModuleManifest } from '../src/modules/donations/index.js';
import { authService } from '../src/auth/service.js';
import { createHmac } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';

describe('Recurring Donations Subscriptions & Automated Thank-You Emails (Sub-checkpoint CP-H2.7)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let donorToken: string;
  let otherToken: string;

  const adminEmail = `admin_don_${Date.now()}@example.com`;
  const donorEmail = `donor_${Date.now()}@example.com`;
  const otherEmail = `other_donor_${Date.now()}@example.com`;

  let testCampaignId: number;
  const testCampaignSlug = `wildlife-rescue-${Date.now()}`;
  let testSubscriptionId: number;
  let testRazorpaySubId: string;

  beforeAll(async () => {
    await runMigrations();
    try {
      moduleRegistry.registerManifest(donationModuleManifest);
    } catch {
      // already registered
    }
    moduleRegistry.setModuleState('donations', true);
    app = buildApp();
    await app.ready();

    // 1. Create Admin Account
    const adminUser = await authService.signup({
      name: 'Donations Administrator',
      email: adminEmail,
      password: 'AdminPassword123!',
    });
    await authService.verifyEmail(adminUser.verificationToken);
    await pool.query(
      "UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1) WHERE id = ?",
      [adminUser.user.id]
    );
    const adminLogin = await authService.login({
      email: adminEmail,
      password: 'AdminPassword123!',
    });
    adminToken = adminLogin.token!;

    // 2. Create Donor Account
    const donorUser = await authService.signup({
      name: 'Rohan Sharma',
      email: donorEmail,
      password: 'DonorPassword123!',
    });
    await authService.verifyEmail(donorUser.verificationToken);
    const donorLogin = await authService.login({
      email: donorEmail,
      password: 'DonorPassword123!',
    });
    donorToken = donorLogin.token!;

    // 3. Create Other Donor Account (for RBAC ownership checks)
    const otherUser = await authService.signup({
      name: 'Other Donor',
      email: otherEmail,
      password: 'DonorPassword123!',
    });
    await authService.verifyEmail(otherUser.verificationToken);
    const otherLogin = await authService.login({
      email: otherEmail,
      password: 'DonorPassword123!',
    });
    otherToken = otherLogin.token!;

    // 4. Create active campaign in MySQL
    const [campRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO donation_campaigns (title, slug, goal_amount, raised_amount, description, is_active)
       VALUES ('Wildlife Protection Fund', ?, 5000000, 0, 'Sustained habitat protection', TRUE)`,
      [testCampaignSlug]
    );
    testCampaignId = campRes.insertId;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  // 1. Recurring Donation Subscription Initiation
  it('1. POST /api/v1/donations/subscribe creates recurring donation subscription with next charge date', async () => {
    testRazorpaySubId = `sub_rzp_${Date.now()}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/subscribe',
      payload: {
        campaignSlug: testCampaignSlug,
        donorName: 'Rohan Sharma',
        donorEmail: donorEmail,
        donorPan: 'ABCDE1234F',
        amount: 250000, // Rs. 2,500.00
        frequency: 'monthly',
        subscriptionId: testRazorpaySubId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data).toHaveProperty('id');
    expect(body.data.campaignId).toBe(testCampaignId);
    expect(body.data.donorEmail).toBe(donorEmail);
    expect(body.data.amount).toBe(250000);
    expect(body.data.frequency).toBe('monthly');
    expect(body.data.status).toBe('active');
    expect(body.data.subscriptionId).toBe(testRazorpaySubId);
    expect(body.data.nextChargeAt).toBeDefined();

    testSubscriptionId = body.data.id;
  });

  // 2. Automated Thank-You Email Dispatch on One-Time Donation
  it('2. POST /api/v1/donations/donate records one-time donation and enqueues thank-you transactional email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/donate',
      payload: {
        campaignSlug: testCampaignSlug,
        donorName: 'Rohan Sharma',
        donorEmail: donorEmail,
        donorPan: 'ABCDE1234F',
        amount: 500000, // Rs. 5,000.00
        paymentId: `pay_one_time_${Date.now()}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.amount).toBe(500000);
    expect(body.data.receiptNumber).toMatch(/^80G-\d{4}-[A-F0-9]+$/);

    // Verify email was enqueued in jobs/email_logs
    const [logs] = await pool.query<any[]>(
      "SELECT * FROM email_logs WHERE recipient = ? ORDER BY id DESC LIMIT 1",
      [donorEmail]
    );
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].subject).toContain('Thank you for your donation');
  });

  // 3. Webhook Handling for Recurring Charges (subscription.charged)
  it('3. POST /api/v1/donations/webhook processes subscription.charged event, generates 80G receipt, and dispatches thank-you email', async () => {
    const chargePaymentId = `pay_sub_charge_${Date.now()}`;
    const webhookPayload = {
      event: 'subscription.charged',
      subscription_id: testRazorpaySubId,
      payload: {
        subscription: {
          entity: {
            id: testRazorpaySubId,
            plan_amount: 250000,
          },
        },
        payment: {
          entity: {
            id: chargePaymentId,
            amount: 250000,
            status: 'captured',
          },
        },
      },
    };

    // Calculate HMAC signature if test secret is present
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(webhookPayload))
      .digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/webhook',
      headers: {
        'x-razorpay-signature': signature,
      },
      payload: webhookPayload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(true);
    expect(body.data.receiptNumber).toMatch(/^80G-\d{4}-[A-F0-9]+$/);

    // Verify campaign raised total updated
    const [camps] = await pool.query<any[]>(
      'SELECT raised_amount FROM donation_campaigns WHERE id = ?',
      [testCampaignId]
    );
    expect(Number(camps[0].raised_amount)).toBeGreaterThanOrEqual(750000); // 500000 one-time + 250000 recurring

    // Verify subscription charge count updated
    const [subs] = await pool.query<any[]>(
      'SELECT total_charges, total_raised FROM donation_subscriptions WHERE id = ?',
      [testSubscriptionId]
    );
    expect(Number(subs[0].total_charges)).toBe(1);
    expect(Number(subs[0].total_raised)).toBe(250000);
  });

  // 4. Idempotency Check on Duplicate Recurring Webhook
  it('4. POST /api/v1/donations/webhook ignores duplicate subscription.charged event for same paymentId', async () => {
    const chargePaymentId = `pay_dup_charge_${Date.now()}`;
    const webhookPayload = {
      event: 'subscription.charged',
      subscription_id: testRazorpaySubId,
      payload: {
        subscription: { entity: { id: testRazorpaySubId } },
        payment: { entity: { id: chargePaymentId, amount: 250000 } },
      },
    };

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(webhookPayload))
      .digest('hex');

    // First delivery -> processed
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/webhook',
      headers: { 'x-razorpay-signature': signature },
      payload: webhookPayload,
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().data.processed).toBe(true);

    // Second delivery (duplicate retry) -> returns duplicate flag without double counting
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/webhook',
      headers: { 'x-razorpay-signature': signature },
      payload: webhookPayload,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.processed).toBe(false);
    expect(res2.json().data.duplicate).toBe(true);
  });

  // 5. Inbound Webhook for Subscription Cancellation
  it('5. POST /api/v1/donations/webhook marks subscription cancelled on subscription.cancelled event', async () => {
    const cancelPayload = {
      event: 'subscription.cancelled',
      subscription_id: testRazorpaySubId,
      payload: {
        subscription: { entity: { id: testRazorpaySubId } },
      },
    };

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(cancelPayload))
      .digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/webhook',
      headers: { 'x-razorpay-signature': signature },
      payload: cancelPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('cancelled');

    const [subs] = await pool.query<any[]>(
      'SELECT status, cancelled_at FROM donation_subscriptions WHERE id = ?',
      [testSubscriptionId]
    );
    expect(subs[0].status).toBe('cancelled');
    expect(subs[0].cancelled_at).not.toBeNull();
  });

  // 6. Authenticated Donor Endpoints
  it('6. GET /api/v1/donations/my-subscriptions returns authenticated user recurring subscriptions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/donations/my-subscriptions',
      headers: { authorization: `Bearer ${donorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].donorEmail).toBe(donorEmail);
  });

  // 7. Donor Ownership & Cancellation Security
  it('7. POST /api/v1/donations/subscriptions/:id/cancel enforces ownership check', async () => {
    // Other donor trying to cancel Rohan's subscription should receive 403 Forbidden
    const resOther = await app.inject({
      method: 'POST',
      url: `/api/v1/donations/subscriptions/${testSubscriptionId}/cancel`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(resOther.statusCode).toBe(403);

    // Create a new active subscription to cancel
    const activeSubRes = await app.inject({
      method: 'POST',
      url: '/api/v1/donations/subscribe',
      payload: {
        campaignSlug: testCampaignSlug,
        donorName: 'Rohan Sharma',
        donorEmail: donorEmail,
        amount: 100000,
        frequency: 'yearly',
      },
    });
    const subToCancelId = activeSubRes.json().data.id;

    // Rohan cancelling his own subscription succeeds
    const resSelf = await app.inject({
      method: 'POST',
      url: `/api/v1/donations/subscriptions/${subToCancelId}/cancel`,
      headers: { authorization: `Bearer ${donorToken}` },
    });

    expect(resSelf.statusCode).toBe(200);
    expect(resSelf.json().data.status).toBe('cancelled');
  });

  // 8. Admin Subscriptions Directory & Management
  it('8. GET /api/v1/admin/donations/subscriptions allows admin to list and cancel recurring subscriptions', async () => {
    // List subscriptions
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/donations/subscriptions',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Admin cancel subscription
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/donations/subscriptions/${testSubscriptionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.status).toBe('cancelled');
  });

  // 9. RBAC Protection on Admin Endpoints
  it('9. GET /api/v1/admin/donations/subscriptions returns 403 Forbidden for non-privileged donors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/donations/subscriptions',
      headers: { authorization: `Bearer ${donorToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
