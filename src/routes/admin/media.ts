import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { MediaService } from '../../content/media.js';
import { AuditService } from '../../content/audit.js';

export const adminMediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/media - List media
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.media.view')],
      schema: {
        description: 'List media items with pagination and mime filters',
        tags: ['Admin Media'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          mimeType: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                filename: Type.String(),
                originalName: Type.String(),
                mimeType: Type.String(),
                sizeBytes: Type.Number(),
                width: Type.Union([Type.Number(), Type.Null()]),
                height: Type.Union([Type.Number(), Type.Null()]),
                altText: Type.Union([Type.String(), Type.Null()]),
                publicUrl: Type.String(),
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
      const q = req.query as { page?: number; per_page?: number; mimeType?: string };
      const result = await MediaService.listMedia(q);
      return reply.send({
        data: result.data.map(m => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
        meta: result.meta,
      });
    }
  );

  // 2. GET /admin/media/rules - Upload rules per contract 2.7
  app.get(
    '/rules',
    {
      preHandler: [authenticate, requirePermission('core.media.view')],
      schema: {
        description: 'Get allowed media mime types, size constraints, and dimensions',
        tags: ['Admin Media'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              maxSizeBytes: Type.Number(),
              allowedMimeTypes: Type.Array(Type.String()),
              autoWebpConversion: Type.Boolean(),
              maxWidth: Type.Number(),
              maxHeight: Type.Number(),
            }),
          }),
        },
      },
    },
    async (_req, reply) => {
      const rules = MediaService.getUploadRules();
      return reply.send({ data: rules });
    }
  );

  // 3. POST /admin/media - Register uploaded media item
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.media.upload')],
      schema: {
        description: 'Register uploaded media asset metadata',
        tags: ['Admin Media'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          filename: Type.String({ minLength: 1 }),
          originalName: Type.String({ minLength: 1 }),
          mimeType: Type.String({ minLength: 1 }),
          sizeBytes: Type.Number({ minimum: 1 }),
          width: Type.Optional(Type.Number()),
          height: Type.Optional(Type.Number()),
          altText: Type.Optional(Type.String()),
          publicUrl: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              filename: Type.String(),
              originalName: Type.String(),
              mimeType: Type.String(),
              sizeBytes: Type.Number(),
              width: Type.Union([Type.Number(), Type.Null()]),
              height: Type.Union([Type.Number(), Type.Null()]),
              altText: Type.Union([Type.String(), Type.Null()]),
              publicUrl: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        filename: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        width?: number;
        height?: number;
        altText?: string;
        publicUrl: string;
      };

      try {
        const created = await MediaService.registerMedia(body);
        await AuditService.log({
          userId: req.user?.id,
          action: 'media.uploaded',
          entityType: 'media',
          entityId: String(created.id),
          afterValues: created,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        return reply.send({ data: created });
      } catch (err: unknown) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: err instanceof Error ? err.message : 'Media validation failed',
        });
      }
    }
  );

  // 4. DELETE /admin/media/:id - Safe deletion
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.media.delete')],
      schema: {
        description: 'Delete media item with reference usage verification',
        tags: ['Admin Media'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        response: {
          200: Type.Object({
            data: Type.Object({ success: Type.Boolean() }),
          }),
          400: Type.Object({
            error: Type.Object({ code: Type.String(), message: Type.String() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      try {
        await MediaService.deleteMedia(Number(id));
        await AuditService.log({
          userId: req.user?.id,
          action: 'media.deleted',
          entityType: 'media',
          entityId: String(id),
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
        return reply.send({ data: { success: true } });
      } catch (err) {
        return reply.status(400).send({
          error: {
            code: 'MEDIA_IN_USE',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  );
};
