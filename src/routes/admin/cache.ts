import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { cache } from '../../cache/index.js';

export const adminCacheRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/cache - Cache status
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.cache.manage')],
      schema: {
        description: 'Get current cache status, active driver, and item/tag counts',
        tags: ['Admin Cache'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              driver: Type.String(),
              itemCount: Type.Number(),
              tagsCount: Type.Number(),
            }),
          }),
        },
      },
    },
    async (_request, reply) => {
      const status = await cache.getStatus();
      return reply.send({ data: status });
    }
  );

  // 2. POST /admin/cache/purge - Purge cache by tags, key, or entire flush
  app.post(
    '/purge',
    {
      preHandler: [authenticate, requirePermission('core.cache.manage')],
      schema: {
        description: 'Purge cache items by key, tag-based invalidation, or complete cache flush',
        tags: ['Admin Cache'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          tags: Type.Optional(Type.Array(Type.String())),
          key: Type.Optional(Type.String()),
          all: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              purged: Type.Number(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { tags?: string[]; key?: string; all?: boolean };
      const result = await cache.purge(body);
      return reply.send({ data: result });
    }
  );
};
