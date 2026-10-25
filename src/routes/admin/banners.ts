import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { BannersService, BannerRecord } from '../../banners/service.js';
import { AuditService } from '../../content/audit.js';

export const adminBannersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/banners - List all banners
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'List all banners, announcement bars, and popups',
        tags: ['Admin Banners'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                type: Type.String(),
                content: Type.String(),
                linkUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                buttonText: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                location: Type.String(),
                targetPages: Type.Array(Type.String()),
                isActive: Type.Boolean(),
                createdAt: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const list = await BannersService.listBanners();
      return reply.send({ data: list });
    }
  );

  // 2. POST /admin/banners - Create banner
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Create a new promotional banner or announcement bar',
        tags: ['Admin Banners'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          type: Type.Optional(Type.String()),
          content: Type.String({ minLength: 1 }),
          linkUrl: Type.Optional(Type.String()),
          buttonText: Type.Optional(Type.String()),
          location: Type.Optional(Type.String()),
          targetPages: Type.Optional(Type.Array(Type.String())),
          startAt: Type.Optional(Type.String()),
          endAt: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              isActive: Type.Boolean(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        type?: 'announcement_bar' | 'popup' | 'toast';
        content: string;
        linkUrl?: string;
        buttonText?: string;
        location?: string;
        targetPages?: string[];
        startAt?: string;
        endAt?: string;
      };

      const banner = await BannersService.createBanner(body);
      await AuditService.log({
        userId: req.user?.id,
        action: 'create',
        entityType: 'banner',
        entityId: String(banner.id),
        afterValues: banner,
      });

      return reply.send({ data: { id: banner.id, name: banner.name, isActive: banner.isActive } });
    }
  );

  // 3. PUT /admin/banners/:id - Update banner
  app.put(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Update banner settings and display scheduling',
        tags: ['Admin Banners'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          content: Type.Optional(Type.String()),
          linkUrl: Type.Optional(Type.String()),
          buttonText: Type.Optional(Type.String()),
          location: Type.Optional(Type.String()),
          targetPages: Type.Optional(Type.Array(Type.String())),
          isActive: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              isActive: Type.Boolean(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as Partial<BannerRecord>;

      const updated = await BannersService.updateBanner(id, body);
      if (!updated) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Banner not found' });
      }

      await AuditService.log({
        userId: req.user?.id,
        action: 'update',
        entityType: 'banner',
        entityId: String(id),
        afterValues: updated,
      });

      return reply.send({ data: { id: updated.id, name: updated.name, isActive: updated.isActive } });
    }
  );

  // 4. DELETE /admin/banners/:id - Delete banner
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.pages.delete')],
      schema: {
        description: 'Delete banner',
        tags: ['Admin Banners'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      await BannersService.deleteBanner(id);
      await AuditService.log({
        userId: req.user?.id,
        action: 'delete',
        entityType: 'banner',
        entityId: String(id),
      });
      return reply.send({ success: true });
    }
  );
};
