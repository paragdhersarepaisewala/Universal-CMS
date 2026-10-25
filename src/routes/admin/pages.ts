import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { PageService, type PageMutation } from '../../content/pages.js';
import { AuditService } from '../../content/audit.js';

export const adminPagesRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/pages - List pages
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'List CMS pages with pagination and status filters',
        tags: ['Admin Pages'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          status: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                title: Type.String(),
                slug: Type.String(),
                status: Type.String(),
                publishedAt: Type.Union([Type.String(), Type.Null()]),
                version: Type.Number(),
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
      const q = req.query as { page?: number; per_page?: number; status?: string };
      const result = await PageService.listPages({
        page: q.page,
        perPage: q.per_page,
        status: q.status,
      });

      return reply.send({
        data: result.data.map(p => ({
          ...p,
          publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    }
  );

  // 2. POST /admin/pages - Create page
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Create a new content page',
        tags: ['Admin Pages'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          title: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('published'), Type.Literal('scheduled'), Type.Literal('archived')])),
          blocks: Type.Optional(Type.Array(Type.Any())),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              title: Type.String(),
              slug: Type.String(),
              status: Type.String(),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        title: string;
        slug: string;
        status?: 'draft' | 'published' | 'scheduled' | 'archived';
        blocks?: Array<{ blockType: string; data: Record<string, unknown>; sortOrder: number; isActive: boolean }>;
      };

      const created = await PageService.createPage(body);
      await AuditService.log({
        userId: req.user?.id,
        action: 'page.created',
        entityType: 'page',
        entityId: String(created.id),
        afterValues: created,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: created });
    }
  );

  // 3. GET /admin/pages/:id - Get page with content blocks
  app.get(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'Get page by ID with all structured content blocks',
        tags: ['Admin Pages'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              title: Type.String(),
              slug: Type.String(),
              status: Type.String(),
              version: Type.Number(),
              blocks: Type.Optional(Type.Array(Type.Any())),
            }),
          }),
          404: Type.Object({
            error: Type.Object({ code: Type.String(), message: Type.String() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const page = await PageService.getPageById(Number(id));
      if (!page) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Page not found' },
        });
      }
      return reply.send({ data: page });
    }
  );

  // 4. PUT /admin/pages/:id - Update page & blocks with version conflict handling
  app.put(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Update page content, status, and blocks with version concurrency checking',
        tags: ['Admin Pages'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          title: Type.Optional(Type.String({ minLength: 1 })),
          slug: Type.Optional(Type.String({ minLength: 1 })),
          status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('published'), Type.Literal('scheduled'), Type.Literal('archived')])),
          blocks: Type.Optional(Type.Array(Type.Any())),
          version: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              title: Type.String(),
              slug: Type.String(),
              status: Type.String(),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as PageMutation;
      const updated = await PageService.updatePage(Number(id), body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'page.updated',
        entityType: 'page',
        entityId: String(id),
        afterValues: updated,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: updated });
    }
  );

  // 5. DELETE /admin/pages/:id - Delete page
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.pages.delete')],
      schema: {
        description: 'Delete a page and its associated content blocks',
        tags: ['Admin Pages'],
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
      await PageService.deletePage(Number(id));

      await AuditService.log({
        userId: req.user?.id,
        action: 'page.deleted',
        entityType: 'page',
        entityId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: { success: true } });
    }
  );
};
