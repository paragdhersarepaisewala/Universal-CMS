import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { ComplianceService, type BusinessComplianceDetails } from '../../content/compliance.js';
import { AuditService } from '../../content/audit.js';

export const adminLegalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/legal/templates - List India legal draft templates
  app.get(
    '/templates',
    {
      preHandler: [authenticate, requirePermission('core.legal.view')],
      schema: {
        description: 'List statutory legal policy draft templates (India DPDP Act aligned drafts)',
        tags: ['Admin Legal'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                slug: Type.String(),
                title: Type.String(),
                summary: Type.String(),
                defaultContent: Type.String(),
              })
            ),
            notice: Type.String(),
          }),
        },
      },
    },
    async (_req, reply) => {
      const templates = ComplianceService.getLegalTemplates();
      return reply.send({
        data: templates,
        notice: ComplianceService.getDraftNotice(),
      });
    }
  );

  // 2. POST /admin/legal/seed - Seed draft legal pages
  app.post(
    '/seed',
    {
      preHandler: [authenticate, requirePermission('core.legal.edit')],
      schema: {
        description: 'Seed standard India legal policy draft pages into the pages table',
        tags: ['Admin Legal'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              seededCount: Type.Number(),
              notice: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const count = await ComplianceService.seedLegalPages();

      await AuditService.log({
        userId: req.user?.id,
        action: 'legal.seeded',
        entityType: 'legal',
        afterValues: { seededCount: count },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({
        data: {
          seededCount: count,
          notice: ComplianceService.getDraftNotice(),
        },
      });
    }
  );

  // 3. GET /admin/legal/business - Get business compliance details
  app.get(
    '/business',
    {
      preHandler: [authenticate, requirePermission('core.legal.view')],
      schema: {
        description: 'Get registered business entity, GSTIN, and statutory Grievance Officer details',
        tags: ['Admin Legal'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              businessLegalName: Type.String(),
              tradingName: Type.String(),
              registeredAddress: Type.String(),
              contactEmail: Type.String(),
              contactPhone: Type.String(),
              gstin: Type.Optional(Type.String()),
              pan: Type.Optional(Type.String()),
              cin: Type.Optional(Type.String()),
              grievanceOfficerName: Type.String(),
              grievanceOfficerEmail: Type.String(),
              grievanceOfficerPhone: Type.String(),
              grievanceOfficerAddress: Type.String(),
              grievanceResponseTimeline: Type.String(),
            }),
          }),
        },
      },
    },
    async (_req, reply) => {
      const details = await ComplianceService.getBusinessDetails();
      return reply.send({ data: details });
    }
  );

  // 4. PUT /admin/legal/business - Update business compliance details
  app.put(
    '/business',
    {
      preHandler: [authenticate, requirePermission('core.legal.edit')],
      schema: {
        description: 'Update business entity disclosures and Grievance Officer information',
        tags: ['Admin Legal'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          businessLegalName: Type.Optional(Type.String()),
          tradingName: Type.Optional(Type.String()),
          registeredAddress: Type.Optional(Type.String()),
          contactEmail: Type.Optional(Type.String()),
          contactPhone: Type.Optional(Type.String()),
          gstin: Type.Optional(Type.String()),
          grievanceOfficerName: Type.Optional(Type.String()),
          grievanceOfficerEmail: Type.Optional(Type.String()),
          grievanceOfficerPhone: Type.Optional(Type.String()),
          grievanceOfficerAddress: Type.Optional(Type.String()),
          grievanceResponseTimeline: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              businessLegalName: Type.String(),
              tradingName: Type.String(),
              registeredAddress: Type.String(),
              contactEmail: Type.String(),
              contactPhone: Type.String(),
              gstin: Type.Optional(Type.String()),
              grievanceOfficerName: Type.String(),
              grievanceOfficerEmail: Type.String(),
              grievanceOfficerPhone: Type.String(),
              grievanceOfficerAddress: Type.String(),
              grievanceResponseTimeline: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as Partial<BusinessComplianceDetails>;
      const updated = await ComplianceService.updateBusinessDetails(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'compliance.business_updated',
        entityType: 'compliance',
        afterValues: updated,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: updated });
    }
  );

  // 5. GET /admin/legal/consents - Cookie consent log viewer
  app.get(
    '/consents',
    {
      preHandler: [authenticate, requirePermission('core.legal.view')],
      schema: {
        description: 'View cookie consent acceptance and preference logs',
        tags: ['Admin Legal'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                consentId: Type.String(),
                ipAddress: Type.String(),
                userAgent: Type.Optional(Type.String()),
                categories: Type.Object({
                  necessary: Type.Boolean(),
                  analytics: Type.Boolean(),
                  marketing: Type.Boolean(),
                  preferences: Type.Boolean(),
                }),
                consentedAt: Type.String(),
              })
            ),
            meta: Type.Object({
              page: Type.Number(),
              per_page: Type.Number(),
              total: Type.Number(),
              total_pages: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const q = req.query as { page?: number; per_page?: number };
      const result = await ComplianceService.listConsentLogs(q);
      return reply.send(result);
    }
  );
};
