import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { donationModuleManifest } from '../src/modules/donations/index.js';
import { pool } from '../src/db/pool.js';

describe('Donations & 80G Tax Receipts Engine Suite', () => {
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
    moduleRegistry.registerManifest(donationModuleManifest);
    moduleRegistry.setModuleState('donations', true);
    app = buildApp();
    await app.ready();

    await pool.query(
      `INSERT INTO donation_campaigns (id, title, slug, goal_amount, raised_amount, description, is_active)
       VALUES (2, 'Rural Education Initiative 2026', 'rural-education-initiative', 10000000, 3500000, 'Funding digital classroom kits', 1)
       ON DUPLICATE KEY UPDATE raised_amount = 3500000, is_active = 1`
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public Donation Campaigns API', () => {
    it('returns active campaigns with calculated progress percentage at GET /api/v1/donations/campaigns', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/donations/campaigns',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      const campaign = body.data.find((c: any) => c.slug === 'rural-education-initiative');
      expect(campaign).toBeDefined();
      expect(campaign).toHaveProperty('progressPercentage');
      expect(campaign.progressPercentage).toBe(35);
    });

    it('returns single campaign details at GET /api/v1/donations/campaigns/:slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/donations/campaigns/rural-education-initiative',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.slug).toBe('rural-education-initiative');
      expect(body.data.goalAmount).toBe(10000000);
    });

    it('rejects donations below minimum amount (Rs 100)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/donations/donate',
        payload: {
          campaignSlug: 'rural-education-initiative',
          donorName: 'Test Donor',
          donorEmail: 'test@donor.com',
          amount: 5000, // Rs 50 (below Rs 100 limit)
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('10000');
    });

    it('records valid donation and issues 80G tax receipt number', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/donations/donate',
        payload: {
          campaignSlug: 'rural-education-initiative',
          donorName: 'Vikram Seth',
          donorEmail: 'vikram@example.com',
          donorPan: 'ABCDE1234F',
          amount: 500000, // Rs 5,000
          isAnonymous: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.receiptNumber).toMatch(/^80G-\d{4}-[0-9A-F]{6}$/);
      expect(body.data.status).toBe('completed');
    });

    it('records anonymous donation masked as Anonymous Donor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/donations/donate',
        payload: {
          campaignSlug: 'rural-education-initiative',
          donorName: 'Private Individual',
          donorEmail: 'private@example.com',
          amount: 100000, // Rs 1,000
          isAnonymous: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.donorName).toBe('Anonymous Donor');
    });
  });

  describe('Admin Donations API', () => {
    it('allows admin to create campaigns and view contributions', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Create campaign
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/donations/campaigns',
        headers: { authorization: 'Bearer admin_token' },
        payload: {
          title: 'Clean Water Project',
          slug: 'clean-water-project',
          goalAmount: 5000000,
          description: 'Installing solar-powered water filtration units.',
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = JSON.parse(createRes.body);
      expect(createBody.data.slug).toBe('clean-water-project');

      // List contributions
      const contribRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/donations/contributions',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(contribRes.statusCode).toBe(200);
      const contribBody = JSON.parse(contribRes.body);
      expect(contribBody.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Donations Module Guard', () => {
    it('returns 404 MODULE_DISABLED when donations module is toggled off', async () => {
      moduleRegistry.setModuleState('donations', false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/donations/campaigns',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('MODULE_DISABLED');

      // Re-enable
      moduleRegistry.setModuleState('donations', true);
    });
  });
});
