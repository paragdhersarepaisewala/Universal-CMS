import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ThemeService } from '../content/theme.js';
import { PageService } from '../content/pages.js';
import { MenuService } from '../content/menus.js';
import { SeoService } from '../content/seo.js';
import { RedirectService } from '../content/redirects.js';
import { ComplianceService } from '../content/compliance.js';

export const publicContentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /theme - Public design tokens
  app.get(
    '/theme',
    {
      schema: {
        description: 'Get public theme styling tokens (colors, typography, logo, radius)',
        tags: ['Content'],
        response: {
          200: Type.Object({
            data: Type.Record(Type.String(), Type.String()),
          }),
        },
      },
    },
    async (_req, reply) => {
      const tokens = await ThemeService.getPublicTheme();
      return reply.send({ data: tokens });
    }
  );

  // 2. GET /pages/:slug - Published page by slug
  app.get(
    '/pages/:slug',
    {
      schema: {
        description: 'Get a published page and its structured content blocks by slug',
        tags: ['Content'],
        params: Type.Object({
          slug: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              title: Type.String(),
              slug: Type.String(),
              status: Type.String(),
              publishedAt: Type.Union([Type.String(), Type.Null()]),
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
      const { slug } = req.params as { slug: string };
      const page = await PageService.getPageBySlug(slug);
      if (!page || page.status !== 'published') {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Page '${slug}' was not found or is not published.` },
        });
      }

      return reply.send({
        data: {
          ...page,
          publishedAt: page.publishedAt ? page.publishedAt.toISOString() : null,
        },
      });
    }
  );

  // 3. GET /menus/:location - Menus by location (header, footer, etc.)
  app.get(
    '/menus/:location',
    {
      schema: {
        description: 'Get active menu items by location identifier',
        tags: ['Content'],
        params: Type.Object({
          location: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              slug: Type.String(),
              location: Type.Union([Type.String(), Type.Null()]),
              items: Type.Array(
                Type.Object({
                  id: Type.Optional(Type.Number()),
                  parentId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
                  label: Type.String(),
                  url: Type.String(),
                  target: Type.Optional(Type.String()),
                  sortOrder: Type.Number(),
                  isActive: Type.Optional(Type.Boolean()),
                })
              ),
            }),
          }),
          404: Type.Object({
            error: Type.Object({ code: Type.String(), message: Type.String() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { location } = req.params as { location: string };
      const menu = await MenuService.getMenuByLocation(location);
      if (!menu) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Menu for location '${location}' not found.` },
        });
      }

      return reply.send({ data: menu });
    }
  );

  // 4. GET /sitemap.xml - Dynamic XML sitemap
  app.get(
    '/sitemap.xml',
    {
      schema: {
        description: 'Dynamic search engine sitemap in XML format',
        tags: ['Content'],
      },
    },
    async (_req, reply) => {
      const xml = await SeoService.generateSitemapXml();
      reply.header('content-type', 'application/xml; charset=utf-8');
      return reply.send(xml);
    }
  );

  // 5. GET /robots.txt - Search engine robots instructions
  app.get(
    '/robots.txt',
    {
      schema: {
        description: 'Robots crawler exclusion protocol instructions',
        tags: ['Content'],
      },
    },
    async (_req, reply) => {
      const robots = await SeoService.getRobotsTxt();
      reply.header('content-type', 'text/plain; charset=utf-8');
      return reply.send(robots);
    }
  );

  // 6. GET /redirects/resolve - Resolve URL redirect
  app.get(
    '/redirects/resolve',
    {
      schema: {
        description: 'Resolve incoming URL path against 301 and 302 redirects',
        tags: ['Content'],
        querystring: Type.Object({
          path: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              targetPath: Type.String(),
              statusCode: Type.Number(),
            }),
          }),
          404: Type.Object({
            error: Type.Object({ code: Type.String(), message: Type.String() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { path } = req.query as { path: string };
      const redirect = await RedirectService.resolve(path);
      if (!redirect) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'No active redirect found for specified path.' },
        });
      }
      return reply.send({
        data: {
          targetPath: redirect.targetPath,
          statusCode: redirect.statusCode,
        },
      });
    }
  );

  // 7. POST /cookies/consent - Record cookie consent
  app.post(
    '/cookies/consent',
    {
      schema: {
        description: 'Store user cookie preferences and consent timestamp',
        tags: ['Content'],
        body: Type.Object({
          consentId: Type.String(),
          categories: Type.Object({
            necessary: Type.Boolean(),
            analytics: Type.Boolean(),
            marketing: Type.Boolean(),
            preferences: Type.Boolean(),
          }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              consentId: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        consentId: string;
        categories: { necessary: boolean; analytics: boolean; marketing: boolean; preferences: boolean };
      };
      const result = await ComplianceService.recordConsent({
        consentId: body.consentId,
        ipAddress: req.ip || '127.0.0.1',
        userAgent: req.headers['user-agent'],
        categories: body.categories,
      });

      return reply.send({ data: result });
    }
  );
};
