import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { SeoService, type GlobalSeoSettings, type SeoMetadata } from '../../content/seo.js';
import { AuditService } from '../../content/audit.js';

export const adminSeoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/seo - Global SEO settings
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.seo.view')],
      schema: {
        description: 'Get global SEO configuration, tracking IDs, and robots.txt content',
        tags: ['Admin SEO'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              defaultTitle: Type.String(),
              titleTemplate: Type.String(),
              defaultDescription: Type.String(),
              defaultRobots: Type.String(),
              googleAnalyticsId: Type.Optional(Type.String()),
              metaPixelId: Type.Optional(Type.String()),
              headerScripts: Type.Optional(Type.String()),
              footerScripts: Type.Optional(Type.String()),
              robotsTxt: Type.String(),
            }),
          }),
        },
      },
    },
    async (_req, reply) => {
      const globalSeo = await SeoService.getGlobalSeo();
      return reply.send({ data: globalSeo });
    }
  );

  // 2. PUT /admin/seo - Update global SEO settings
  app.put(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.seo.edit')],
      schema: {
        description: 'Update global SEO meta defaults, tracking scripts, and robots.txt',
        tags: ['Admin SEO'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          defaultTitle: Type.Optional(Type.String()),
          titleTemplate: Type.Optional(Type.String()),
          defaultDescription: Type.Optional(Type.String()),
          defaultRobots: Type.Optional(Type.String()),
          googleAnalyticsId: Type.Optional(Type.String()),
          metaPixelId: Type.Optional(Type.String()),
          headerScripts: Type.Optional(Type.String()),
          footerScripts: Type.Optional(Type.String()),
          robotsTxt: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              defaultTitle: Type.String(),
              titleTemplate: Type.String(),
              defaultDescription: Type.String(),
              defaultRobots: Type.String(),
              googleAnalyticsId: Type.Optional(Type.String()),
              metaPixelId: Type.Optional(Type.String()),
              headerScripts: Type.Optional(Type.String()),
              footerScripts: Type.Optional(Type.String()),
              robotsTxt: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as Partial<GlobalSeoSettings>;
      const updated = await SeoService.updateGlobalSeo(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'seo.updated',
        entityType: 'seo',
        afterValues: updated,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: updated });
    }
  );

  // 3. GET /admin/seo/entity - Get entity SEO
  app.get(
    '/entity',
    {
      preHandler: [authenticate, requirePermission('core.seo.view')],
      schema: {
        description: 'Get SEO metadata for a specific entity (page, product, or post)',
        tags: ['Admin SEO'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          entityType: Type.String(),
          entityId: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              metaTitle: Type.Optional(Type.String()),
              metaDescription: Type.Optional(Type.String()),
              canonicalUrl: Type.Optional(Type.String()),
              robots: Type.Optional(Type.String()),
              ogTitle: Type.Optional(Type.String()),
              ogDescription: Type.Optional(Type.String()),
              ogImageId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
              twitterCard: Type.Optional(Type.String()),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const q = req.query as { entityType: string; entityId: string };
      const metadata = await SeoService.getEntitySeo(q.entityType, q.entityId);
      return reply.send({ data: metadata });
    }
  );

  // 4. PUT /admin/seo/entity - Update entity SEO
  app.put(
    '/entity',
    {
      preHandler: [authenticate, requirePermission('core.seo.edit')],
      schema: {
        description: 'Set SEO metadata for a specific entity',
        tags: ['Admin SEO'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          entityType: Type.String(),
          entityId: Type.String(),
          metaTitle: Type.Optional(Type.String()),
          metaDescription: Type.Optional(Type.String()),
          canonicalUrl: Type.Optional(Type.String()),
          robots: Type.Optional(Type.String()),
          ogTitle: Type.Optional(Type.String()),
          ogDescription: Type.Optional(Type.String()),
          ogImageId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          twitterCard: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              metaTitle: Type.Optional(Type.String()),
              metaDescription: Type.Optional(Type.String()),
              canonicalUrl: Type.Optional(Type.String()),
              robots: Type.Optional(Type.String()),
              ogTitle: Type.Optional(Type.String()),
              ogDescription: Type.Optional(Type.String()),
              ogImageId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
              twitterCard: Type.Optional(Type.String()),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { entityType: string; entityId: string } & SeoMetadata;
      const result = await SeoService.setEntitySeo(body.entityType, body.entityId, body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'seo.entity_updated',
        entityType: body.entityType,
        entityId: body.entityId,
        afterValues: result,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: result });
    }
  );
};
