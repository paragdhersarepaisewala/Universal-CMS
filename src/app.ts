import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { v1Routes } from './routes/v1.js';
import { initializeModules } from './modules/index.js';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  initializeModules();

  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
    // Trust Hostinger reverse proxy (Passenger / Nginx) to retrieve real client IP
    trustProxy: process.env.TRUST_PROXY !== 'false',
    ...opts,
  });

  // Security headers
  app.register(helmet, {
    contentSecurityPolicy: false, // Swagger UI requires inline scripts/styles
  });

  // Enable CORS
  app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Payload compression (gzip, deflate)
  app.register(compress, {
    global: true,
  });

  // Rate limiting (100 req/min default, high limit for tests)
  app.register(rateLimit, {
    max: process.env.NODE_ENV === 'test' ? 10000 : 100,
    timeWindow: '1 minute',
  });

  // Raw body capture for webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const str = body.toString('utf8');
      (req as any).rawBody = str;
      const json = str ? JSON.parse(str) : {};
      done(null, json);
    } catch (err: any) {
      done(err, undefined);
    }
  });

  // Configure OpenAPI Swagger specification generator
  app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Universal CMS Core API',
        description: 'Reusable headless CMS REST API specification',
        version: '0.1.0',
      },
      servers: [
        {
          url: '/api/v1',
          description: 'Current environment API v1 base',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  const isSwaggerEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';

  if (isSwaggerEnabled) {
    // Swagger UI documentation endpoint (disabled in production unless ENABLE_SWAGGER=true)
    app.register(swaggerUi, {
      routePrefix: '/api/v1/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
      staticCSP: false,
    });

    // Ensure /api/v1/docs redirects to /api/v1/docs/ with trailing slash so relative static assets load properly
    app.addHook('onRequest', async (req, reply) => {
      if (req.url === '/api/v1/docs') {
        return reply.redirect(301, '/api/v1/docs/');
      }
    });

    // Export openapi.json route directly
    app.get('/api/v1/openapi.json', { schema: { hide: true } }, async (_req, reply) => {
      return reply.send(app.swagger());
    });
  } else {
    // Return 404 in production when swagger docs are disabled
    app.get('/api/v1/docs', async (_req, reply) => {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'API documentation is disabled in production' } });
    });
    app.get('/api/v1/docs/*', async (_req, reply) => {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'API documentation is disabled in production' } });
    });
    app.get('/api/v1/openapi.json', async (_req, reply) => {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'API documentation is disabled in production' } });
    });
  }

  // Register /api/v1 routes
  app.register(v1Routes, { prefix: '/api/v1' });

  return app;
}
