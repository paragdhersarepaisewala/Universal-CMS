import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { MenuService, type MenuItemData } from '../../content/menus.js';
import { AuditService } from '../../content/audit.js';

export const adminMenusRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/menus - List menus
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.menus.view')],
      schema: {
        description: 'List all navigation menus and their hierarchical items',
        tags: ['Admin Menus'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                slug: Type.String(),
                location: Type.Union([Type.String(), Type.Null()]),
                items: Type.Array(Type.Any()),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const list = await MenuService.listMenus();
      return reply.send({ data: list });
    }
  );

  // 2. POST /admin/menus - Save menu
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.menus.edit')],
      schema: {
        description: 'Create or update a navigation menu and its item tree',
        tags: ['Admin Menus'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          id: Type.Optional(Type.Number()),
          name: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          location: Type.Optional(Type.String()),
          items: Type.Optional(Type.Array(Type.Any())),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              slug: Type.String(),
              location: Type.Union([Type.String(), Type.Null()]),
              items: Type.Array(Type.Any()),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        id?: number;
        name: string;
        slug: string;
        location?: string;
        items?: MenuItemData[];
      };
      const saved = await MenuService.saveMenu(body);

      await AuditService.log({
        userId: req.user?.id,
        action: body.id ? 'menu.updated' : 'menu.created',
        entityType: 'menu',
        entityId: String(saved.id),
        afterValues: saved,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: saved });
    }
  );

  // 3. DELETE /admin/menus/:id - Delete menu
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.menus.edit')],
      schema: {
        description: 'Delete a navigation menu',
        tags: ['Admin Menus'],
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
      await MenuService.deleteMenu(Number(id));

      await AuditService.log({
        userId: req.user?.id,
        action: 'menu.deleted',
        entityType: 'menu',
        entityId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: { success: true } });
    }
  );
};
