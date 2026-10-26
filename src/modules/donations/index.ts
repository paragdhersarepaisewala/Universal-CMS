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

  // 3. POST /donations/donate - Make a one-time donation
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

  // 4. POST /donations/subscribe - Create recurring donation subscription
  fastify.post(
    '/subscribe',
    {
      preHandler: [requireModule('donations')],
      schema: {
        description: 'Initiate a recurring donation subscription (monthly, quarterly, yearly)',
        tags: ['Donations'],
        body: Type.Object({
          campaignSlug: Type.String(),
          donorName: Type.String({ minLength: 1 }),
          donorEmail: Type.String({ format: 'email' }),
          donorPan: Type.Optional(Type.String()),
          amount: Type.Number({ minimum: 10000 }),
          frequency: Type.Optional(
            Type.Union([Type.Literal('monthly'), Type.Literal('quarterly'), Type.Literal('yearly')])
          ),
          isAnonymous: Type.Optional(Type.Boolean()),
          subscriptionId: Type.Optional(Type.String()),
          initialPaymentId: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<typeof DonationService.createSubscription>[0];
      try {
        const sub = await DonationService.createSubscription(body);
        return reply.status(201).send({ data: sub });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Subscription failed',
        });
      }
    }
  );

  // 5. POST /donations/webhook - Inbound Razorpay subscription events webhook
  fastify.post(
    '/webhook',
    {
      preHandler: [requireModule('donations')],
      schema: {
        description: 'Inbound Razorpay recurring subscription webhook handler (subscription.charged, etc.)',
        tags: ['Donations'],
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-razorpay-signature'] as string | undefined;
      try {
        const result = await DonationService.handleSubscriptionWebhook(req.body, signature);
        return reply.send({ success: true, data: result });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Webhook processing failed',
        });
      }
    }
  );

  // 6. GET /donations/my-donations - Authenticated donor one-time donation history and 80G receipts
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

  // 7. GET /donations/my-subscriptions - Authenticated donor recurring donation subscriptions
  fastify.get(
    '/my-subscriptions',
    {
      preHandler: [requireModule('donations'), authenticate],
      schema: {
        description: 'Get authenticated donor active and past recurring donation subscriptions',
        tags: ['Donations'],
      },
    },
    async (req, reply) => {
      const user = (req as any).user;
      const subs = await DonationService.listSubscriptions({ donorEmail: user.email });
      return reply.send({ data: subs });
    }
  );

  // 8. POST /donations/subscriptions/:id/cancel - Authenticated donor cancel subscription
  fastify.post(
    '/subscriptions/:id/cancel',
    {
      preHandler: [requireModule('donations'), authenticate],
      schema: {
        description: 'Cancel an active recurring donation subscription',
        tags: ['Donations'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const user = (req as any).user;
      try {
        const cancelled = await DonationService.cancelSubscription(id, user.email, false);
        return reply.send({ data: cancelled });
      } catch (err: any) {
        const status = err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
        return reply.status(status).send({ error: { code: err.code || 'CANCEL_FAILED', message: err.message } });
      }
    }
  );
};

export const adminDonationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Admin list campaigns
  fastify.get(
    '/campaigns',
    {
      preHandler: [authenticate, requirePermission(['donations.campaigns.view', 'core.pages.view'])],
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
      preHandler: [authenticate, requirePermission(['donations.campaigns.edit', 'core.pages.edit'])],
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
      preHandler: [authenticate, requirePermission(['donations.campaigns.view', 'core.pages.view'])],
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

  // Admin list subscriptions
  fastify.get(
    '/subscriptions',
    {
      preHandler: [authenticate, requirePermission(['donations.subscriptions.view', 'donations.campaigns.view', 'core.pages.view'])],
      schema: {
        description: 'View all recurring donation subscriptions across campaigns',
        tags: ['Admin Donations'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          campaignId: Type.Optional(Type.Number()),
          status: Type.Optional(Type.String()),
          donorEmail: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const query = req.query as { campaignId?: number; status?: string; donorEmail?: string };
      const subs = await DonationService.listSubscriptions(query);
      return reply.send({ data: subs });
    }
  );

  // Admin cancel subscription
  fastify.post(
    '/subscriptions/:id/cancel',
    {
      preHandler: [authenticate, requirePermission(['donations.subscriptions.manage', 'donations.campaigns.edit', 'core.pages.edit'])],
      schema: {
        description: 'Admin manually cancel a recurring donation subscription',
        tags: ['Admin Donations'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      try {
        const cancelled = await DonationService.cancelSubscription(id, undefined, true);
        return reply.send({ data: cancelled });
      } catch (err: any) {
        const status = err.code === 'NOT_FOUND' ? 404 : 400;
        return reply.status(status).send({ error: { code: err.code || 'CANCEL_FAILED', message: err.message } });
      }
    }
  );
};

export const donationModuleManifest: ModuleManifest = {
  name: 'donations',
  version: '0.2.0',
  description: 'Fundraising campaigns, Razorpay one-time and recurring donations, 80G tax receipts, and transactional thank-you emails',
  isCore: false,
  permissions: [
    { key: 'donations.campaigns.view', description: 'View donation campaigns and contributions' },
    { key: 'donations.campaigns.edit', description: 'Create and edit donation campaigns' },
    { key: 'donations.subscriptions.view', description: 'View recurring donation subscriptions' },
    { key: 'donations.subscriptions.manage', description: 'Manage and cancel recurring donation subscriptions' },
  ],
  adminNav: [
    {
      id: 'donation-campaigns',
      label: 'Donation Campaigns',
      route: '/admin/donations/campaigns',
      permission: 'donations.campaigns.view',
      order: 40,
    },
    {
      id: 'donation-subscriptions',
      label: 'Recurring Donations',
      route: '/admin/donations/subscriptions',
      permission: 'donations.subscriptions.view',
      order: 41,
    },
  ],
  routesPrefix: '/donations',
  routes: donationRoutes,
};
