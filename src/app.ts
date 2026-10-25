import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
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
    ...opts,
  });

  // Enable CORS
  app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Configure OpenAPI Swagger generation
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

  // Swagger UI documentation endpoint
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

  // Register /api/v1 routes
  app.register(v1Routes, { prefix: '/api/v1' });

  return app;
}
