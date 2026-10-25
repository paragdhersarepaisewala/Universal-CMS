import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { ThemeService } from '../../content/theme.js';
import { AuditService } from '../../content/audit.js';

export const adminThemeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/theme - All tokens
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.theme.view')],
      schema: {
        description: 'Get all design theme tokens including private and system tokens',
        tags: ['Admin Theme'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                key: Type.String(),
                value: Type.String(),
                tokenType: Type.String(),
                isActive: Type.Boolean(),
                version: Type.Number(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const tokens = await ThemeService.getAllTokens();
      return reply.send({ data: tokens });
    }
  );

  // 2. PUT /admin/theme - Update tokens
  app.put(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.theme.edit')],
      schema: {
        description: 'Update theme token values with automatic cache invalidation',
        tags: ['Admin Theme'],
        security: [{ bearerAuth: [] }],
        body: Type.Record(Type.String(), Type.String()),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                key: Type.String(),
                value: Type.String(),
                tokenType: Type.String(),
                isActive: Type.Boolean(),
                version: Type.Number(),
              })
            ),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as Record<string, string>;
      const updated = await ThemeService.updateTokens(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'theme.updated',
        entityType: 'theme',
        afterValues: body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: updated });
    }
  );
};
