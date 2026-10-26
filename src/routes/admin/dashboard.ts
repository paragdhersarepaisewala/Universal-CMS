import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { DashboardService } from '../../modules/dashboard/service.js';

export const adminDashboardRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /admin/dashboard/stats
  app.get(
    '/stats',
    {
      preHandler: [authenticate, requirePermission('core.dashboard.view')],
      schema: {
        description: 'Get consolidated administrative business, catalog, customer, and system metrics',
        tags: ['Admin Dashboard'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const stats = await DashboardService.getStats();
      return reply.send({ data: stats });
    }
  );
};
