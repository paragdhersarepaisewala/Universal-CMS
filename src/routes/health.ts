import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { checkDatabaseHealth } from '../db/pool.js';

const HealthResponseSchema = Type.Object({
  data: Type.Object({
    status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
    version: Type.String(),
    uptimeSeconds: Type.Number(),
    timestamp: Type.String(),
    environment: Type.String(),
    database: Type.Object({
      connected: Type.Boolean(),
      poolLimit: Type.Number(),
      error: Type.Optional(Type.String()),
    }),
  }),
});

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    '/health',
    {
      schema: {
        description: 'System health check and database connectivity status',
        tags: ['System'],
        response: {
          200: HealthResponseSchema,
          503: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const dbHealth = await checkDatabaseHealth();
      const status = dbHealth.connected ? 'ok' : 'degraded';

      const payload = {
        data: {
          status,
          version: '0.1.0',
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development',
          database: dbHealth,
        },
      };

      if (!dbHealth.connected) {
        return reply.status(503).send(payload);
      }

      return reply.status(200).send(payload);
    }
  );
};
