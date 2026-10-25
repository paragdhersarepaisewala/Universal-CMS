import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { WebhookService } from '../../webhooks/service.js';
import { AuditService } from '../../content/audit.js';

export const adminWebhooksRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/webhooks - List webhooks
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.view')],
      schema: {
        description: 'List active outbound webhook subscriptions',
        tags: ['Admin Webhooks'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.String(),
                url: Type.String(),
                events: Type.Array(Type.String()),
                secret: Type.String(),
                isActive: Type.Boolean(),
                createdAt: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const list = await WebhookService.listWebhooks();
      return reply.send({ data: list });
    }
  );

  // 2. POST /admin/webhooks - Register webhook
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Subscribe to system event webhooks with HMAC secret generation',
        tags: ['Admin Webhooks'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          url: Type.String({ minLength: 1 }),
          events: Type.Array(Type.String(), { minItems: 1 }),
          secret: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.String(),
              url: Type.String(),
              events: Type.Array(Type.String()),
              secret: Type.String(),
              isActive: Type.Boolean(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { url: string; events: string[]; secret?: string };
      const sub = await WebhookService.registerWebhook(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'webhook.registered',
        entityType: 'webhook',
        entityId: sub.id,
        afterValues: { url: sub.url, events: sub.events },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: sub });
    }
  );

  // 3. DELETE /admin/webhooks/:id - Delete webhook
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Remove an outbound webhook subscription',
        tags: ['Admin Webhooks'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: {
          200: Type.Object({
            data: Type.Object({ success: Type.Boolean() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await WebhookService.deleteWebhook(id);

      await AuditService.log({
        userId: req.user?.id,
        action: 'webhook.deleted',
        entityType: 'webhook',
        entityId: id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: { success: true } });
    }
  );

  // 4. POST /admin/webhooks/test - Test dispatch
  app.post(
    '/test',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Trigger a simulated event dispatch to verify webhook subscribers',
        tags: ['Admin Webhooks'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          event: Type.String({ minLength: 1 }),
          payload: Type.Optional(Type.Any()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              dispatchedCount: Type.Number(),
              subscribers: Type.Array(Type.String()),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { event: string; payload?: Record<string, unknown> };
      const result = await WebhookService.dispatchEvent(body.event, body.payload || { test: true });
      return reply.send({ data: result });
    }
  );
};
