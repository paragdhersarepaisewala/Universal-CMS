import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { RedirectService } from '../../content/redirects.js';
import { AuditService } from '../../content/audit.js';

export const adminRedirectsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/redirects - List redirects
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.redirects.view')],
      schema: {
        description: 'List 301 and 302 URL redirects with hit analytics',
        tags: ['Admin Redirects'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                sourcePath: Type.String(),
                targetPath: Type.String(),
                statusCode: Type.Number(),
                isActive: Type.Boolean(),
                hitCount: Type.Number(),
                createdAt: Type.String(),
                updatedAt: Type.String(),
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
      const result = await RedirectService.listRedirects(q);
      return reply.send({
        data: result.data.map(r => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    }
  );

  // 2. POST /admin/redirects - Create redirect
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.redirects.edit')],
      schema: {
        description: 'Create a new URL redirect',
        tags: ['Admin Redirects'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          sourcePath: Type.String({ minLength: 1 }),
          targetPath: Type.String({ minLength: 1 }),
          statusCode: Type.Optional(Type.Union([Type.Literal(301), Type.Literal(302)])),
          isActive: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              sourcePath: Type.String(),
              targetPath: Type.String(),
              statusCode: Type.Number(),
              isActive: Type.Boolean(),
              hitCount: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { sourcePath: string; targetPath: string; statusCode?: number; isActive?: boolean };
      try {
        const created = await RedirectService.createRedirect(body);

        await AuditService.log({
          userId: req.user?.id,
          action: 'redirect.created',
          entityType: 'redirect',
          entityId: String(created.id),
          afterValues: created,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        return reply.send({ data: created });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Failed to create redirect',
        });
      }
    }
  );

  // 3. PUT /admin/redirects/:id - Update redirect
  app.put(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.redirects.edit')],
      schema: {
        description: 'Update redirect target or status code',
        tags: ['Admin Redirects'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          sourcePath: Type.Optional(Type.String({ minLength: 1 })),
          targetPath: Type.Optional(Type.String({ minLength: 1 })),
          statusCode: Type.Optional(Type.Union([Type.Literal(301), Type.Literal(302)])),
          isActive: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              sourcePath: Type.String(),
              targetPath: Type.String(),
              statusCode: Type.Number(),
              isActive: Type.Boolean(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as { sourcePath?: string; targetPath?: string; statusCode?: number; isActive?: boolean };
      const updated = await RedirectService.updateRedirect(Number(id), body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'redirect.updated',
        entityType: 'redirect',
        entityId: String(id),
        afterValues: updated,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: updated });
    }
  );

  // 4. DELETE /admin/redirects/:id - Delete redirect
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.redirects.edit')],
      schema: {
        description: 'Delete a URL redirect',
        tags: ['Admin Redirects'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        response: {
          200: Type.Object({
            data: Type.Object({ success: Type.Boolean() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      await RedirectService.deleteRedirect(Number(id));

      await AuditService.log({
        userId: req.user?.id,
        action: 'redirect.deleted',
        entityType: 'redirect',
        entityId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: { success: true } });
    }
  );
};
