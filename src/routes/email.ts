import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { EmailService } from '../email/service.js';

export const publicEmailRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /email/unsubscribe
  app.get(
    '/unsubscribe',
    {
      schema: {
        description: 'Unsubscribe from marketing email communications via secure token link',
        tags: ['Email'],
        querystring: Type.Object({
          email: Type.String({ format: 'email' }),
          token: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              message: Type.String(),
            }),
          }),
          400: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, token } = request.query as { email: string; token: string };
      try {
        const result = await EmailService.unsubscribe(email, token);
        return reply.send({ data: result });
      } catch (err) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TOKEN',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  );

  // POST /email/unsubscribe
  app.post(
    '/unsubscribe',
    {
      schema: {
        description: 'Unsubscribe from marketing communications via POST',
        tags: ['Email'],
        body: Type.Object({
          email: Type.String({ format: 'email' }),
          token: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              message: Type.String(),
            }),
          }),
          400: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, token } = request.body as { email: string; token: string };
      try {
        const result = await EmailService.unsubscribe(email, token);
        return reply.send({ data: result });
      } catch (err) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TOKEN',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  );
};
