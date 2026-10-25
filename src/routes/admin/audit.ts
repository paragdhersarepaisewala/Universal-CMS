import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { AuditService } from '../../content/audit.js';

export const adminAuditRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /admin/logs/audit - Query audit logs
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.logs.view')],
      schema: {
        description: 'Query administrative mutation audit logs with before/after snapshots and actor IP',
        tags: ['Admin Audit Logs'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          entityType: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                userId: Type.Union([Type.Number(), Type.Null()]),
                action: Type.String(),
                entityType: Type.String(),
                entityId: Type.Union([Type.String(), Type.Null()]),
                beforeValues: Type.Any(),
                afterValues: Type.Any(),
                ipAddress: Type.Union([Type.String(), Type.Null()]),
                userAgent: Type.Union([Type.String(), Type.Null()]),
                createdAt: Type.String(),
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
      const q = req.query as { page?: number; per_page?: number; entityType?: string };
      const logs = await AuditService.listLogs(q);

      return reply.send({
        data: logs.data.map(l => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        })),
        meta: logs.meta,
      });
    }
  );
};
