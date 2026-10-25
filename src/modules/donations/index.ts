import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';
import { DonationService } from './service.js';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';

const donationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /donations/campaigns - Public list active campaigns
  fastify.get(
    '/campaigns',
    {
      preHandler: [requireModule('donations')],
      schema: {
        description: 'List active fundraising and donation campaigns with progress bar metrics',
        tags: ['Donations'],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                title: Type.String(),
                slug: Type.String(),
                goalAmount: Type.Number(),
                raisedAmount: Type.Number(),
                progressPercentage: Type.Number(),
                description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const list = await DonationService.listCampaigns(true);
      return reply.send({ data: list });
    }
  );

  // 2. GET /donations/campaigns/:slug - Public single campaign
  fastify.get(
    '/campaigns/:slug',
    {
      preHandler: [requireModule('donations')],
      schema: {
        description: 'Get campaign details and progress metrics',
        tags: ['Donations'],
        params: Type.Object({ slug: Type.String() }),
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const camp = await DonationService.getCampaignBySlug(slug);
      if (!camp) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
      }
      return reply.send({ data: camp });
    }
  );

  // 3. POST /donations/donate - Make a donation (with optional 80G tax receipt request)
  fastify.post(
    '/donate',
    {
      preHandler: [requireModule('donations')],
      schema: {
        description: 'Contribute a donation to a campaign with optional PAN for Indian 80G tax exemption',
        tags: ['Donations'],
        body: Type.Object({
          campaignSlug: Type.String(),
          donorName: Type.String({ minLength: 1 }),
          donorEmail: Type.String({ format: 'email' }),
          donorPan: Type.Optional(Type.String()),
          amount: Type.Number({ minimum: 10000 }), // Min Rs 100
          isAnonymous: Type.Optional(Type.Boolean()),
          paymentId: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              donorName: Type.String(),
              amount: Type.Number(),
              receiptNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              status: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<typeof DonationService.recordDonation>[0];
      try {
        const donation = await DonationService.recordDonation(body);
        return reply.send({
          data: {
            id: donation.id,
            donorName: donation.donorName,
            amount: donation.amount,
            receiptNumber: donation.receiptNumber,
            status: donation.status,
          },
        });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Donation failed',
        });
      }
    }
  );

  // 4. GET /donations/my-donations - Authenticated donor history and 80G tax receipts
  fastify.get(
    '/my-donations',
    {
      preHandler: [requireModule('donations'), authenticate],
      schema: {
        description: 'Get authenticated donor donation history and 80G tax exemption receipts',
        tags: ['Donations'],
      },
    },
    async (req, reply) => {
      const user = (req as any).user;
      const history = await DonationService.listCustomerDonations(user.email);
      return reply.send({ data: history });
    }
  );
};

export const adminDonationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Admin list campaigns
  fastify.get(
    '/campaigns',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'Admin list all donation campaigns',
        tags: ['Admin Donations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const list = await DonationService.listCampaigns(false);
      return reply.send({ data: list });
    }
  );

  // Admin create campaign
  fastify.post(
    '/campaigns',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Create a new fundraising campaign',
        tags: ['Admin Donations'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          title: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          goalAmount: Type.Number({ minimum: 100000 }),
          description: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<typeof DonationService.createCampaign>[0];
      const camp = await DonationService.createCampaign(body);
      return reply.send({ data: camp });
    }
  );

  // Admin list contributions
  fastify.get(
    '/contributions',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'View all donation contributions and 80G tax receipts',
        tags: ['Admin Donations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const list = await DonationService.listDonations();
      return reply.send({ data: list });
    }
  );
};

export const donationModuleManifest: ModuleManifest = {
  name: 'donations',
  version: '0.1.0',
  description: 'Fundraising campaigns, Razorpay donations, and 80G tax receipts',
  isCore: false,
  permissions: [
    { key: 'donations.campaigns.view', description: 'View donation campaigns' },
    { key: 'donations.campaigns.edit', description: 'Create and edit donation campaigns' },
  ],
  adminNav: [
    {
      id: 'donation-campaigns',
      label: 'Donation Campaigns',
      route: '/admin/donations/campaigns',
      permission: 'donations.campaigns.view',
      order: 40,
    },
  ],
  routesPrefix: '/donations',
  routes: donationRoutes,
};
