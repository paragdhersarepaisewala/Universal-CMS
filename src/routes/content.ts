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

  // 9. GET /forms/:slug - Get public form schema
  app.get(
    '/forms/:slug',
    {
      schema: {
        description: 'Get public form structure and fields schema by slug',
        tags: ['Content'],
        params: Type.Object({
          slug: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              slug: Type.String(),
              description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              fields: Type.Array(Type.Any()),
              submitButtonText: Type.String(),
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
      const form = await (await import('../forms/service.js')).FormsService.getFormBySlug(slug);
      if (!form || !form.isActive) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Form '${slug}' not found or inactive` },
        });
      }
      return reply.send({
        data: {
          id: form.id,
          name: form.name,
          slug: form.slug,
          description: form.description,
          fields: form.fields,
          submitButtonText: form.submitButtonText,
        },
      });
    }
  );

  // 10. POST /forms/:slug/submit - Submit form
  app.post(
    '/forms/:slug/submit',
    {
      schema: {
        description: 'Submit form data with honeypot spam protection',
        tags: ['Content'],
        params: Type.Object({
          slug: Type.String(),
        }),
        body: Type.Record(Type.String(), Type.Any()),
        response: {
          200: Type.Object({
            data: Type.Object({
              submissionId: Type.Number(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = req.body as Record<string, unknown>;

      try {
        const result = await (await import('../forms/service.js')).FormsService.submitForm(
          slug,
          body,
          req.ip,
          req.headers['user-agent']
        );
        return reply.send({ data: result });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Submission failed',
        });
      }
    }
  );

  // 11. GET /banners - Get active banners for current path
  app.get(
    '/banners',
    {
      schema: {
        description: 'Get active promotional banners and announcement bars targeted for current route',
        tags: ['Content'],
        querystring: Type.Object({
          path: Type.Optional(Type.String()),
        }),
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
              })
            ),
          }),
        },
      },
    },
    async (req, reply) => {
      const { path = '/' } = req.query as { path?: string };
      const list = await (await import('../banners/service.js')).BannersService.getActiveBannersForRoute(path);
      return reply.send({ data: list });
    }
  );

  // 12. GET /seo/:entityType/:entityId - Public entity SEO metadata
  app.get(
    '/seo/:entityType/:entityId',
    {
      schema: {
        description: 'Get SEO metadata for a page, product, post, or category',
        tags: ['Content'],
        params: Type.Object({
          entityType: Type.String(),
          entityId: Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const { entityType, entityId } = req.params as { entityType: string; entityId: string };
      const metadata = await SeoService.getEntitySeo(entityType, entityId);
      return reply.send({ data: metadata });
    }
  );

  // 13. GET /settings - Public general site settings & age gate config
  app.get(
    '/settings',
    {
      schema: {
        description: 'Get public site settings and age verification configuration',
        tags: ['Content'],
      },
    },
    async (_req, reply) => {
      const { SettingsService } = await import('../content/settings.js');
      const settings = await SettingsService.getSettings();
      return reply.send({
        data: {
          siteName: settings.siteName,
          siteDescription: settings.siteDescription,
          timezone: settings.timezone,
          currency: settings.currency,
          currencySymbol: settings.currencySymbol,
          maintenanceMode: settings.maintenanceMode,
          ageVerification: settings.ageVerification,
        },
      });
    }
  );
};

