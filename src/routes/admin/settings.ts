import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { SettingsService, type SiteSettings } from '../../content/settings.js';
import { AuditService } from '../../content/audit.js';

export const adminSettingsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/settings - Get site settings
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.view')],
      schema: {
        description: 'Get general site settings, tax rate, currency, and invoice numbering',
        tags: ['Admin Settings'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              siteName: Type.String(),
              siteDescription: Type.String(),
              contactEmail: Type.String(),
              timezone: Type.String(),
              currency: Type.String(),
              currencySymbol: Type.String(),
              taxRatePercent: Type.Number(),
              taxLabel: Type.String(),
              invoicePrefix: Type.String(),
              invoiceNextNumber: Type.Number(),
              maintenanceMode: Type.Boolean(),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (_req, reply) => {
      const data = await SettingsService.getSettings();
      return reply.send({ data });
    }
  );

  // 2. PUT /admin/settings - Update site settings
  app.put(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Update site settings with optimistic concurrency versioning',
        tags: ['Admin Settings'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          siteName: Type.Optional(Type.String({ minLength: 1 })),
          siteDescription: Type.Optional(Type.String()),
          contactEmail: Type.Optional(Type.String({ format: 'email' })),
          timezone: Type.Optional(Type.String()),
          currency: Type.Optional(Type.String()),
          currencySymbol: Type.Optional(Type.String()),
          taxRatePercent: Type.Optional(Type.Number()),
          taxLabel: Type.Optional(Type.String()),
          invoicePrefix: Type.Optional(Type.String()),
          invoiceNextNumber: Type.Optional(Type.Number()),
          maintenanceMode: Type.Optional(Type.Boolean()),
          version: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              siteName: Type.String(),
              siteDescription: Type.String(),
              contactEmail: Type.String(),
              timezone: Type.String(),
              currency: Type.String(),
              currencySymbol: Type.String(),
              taxRatePercent: Type.Number(),
              taxLabel: Type.String(),
              invoicePrefix: Type.String(),
              invoiceNextNumber: Type.Number(),
              maintenanceMode: Type.Boolean(),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as Partial<SiteSettings> & { version?: number };
      const updated = await SettingsService.updateSettings(body, body.version);

      await AuditService.log({
        userId: req.user?.id,
        action: 'settings.updated',
        entityType: 'settings',
        afterValues: updated,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: updated });
    }
  );
};
