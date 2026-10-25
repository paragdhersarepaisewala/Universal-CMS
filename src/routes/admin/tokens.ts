import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { ApiTokenService } from '../../api-tokens/service.js';
import { AuditService } from '../../content/audit.js';

export const adminTokensRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/tokens - List API tokens
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.view')],
      schema: {
        description: 'List active API access tokens and assigned permission scopes',
        tags: ['Admin API Tokens'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.String(),
                name: Type.String(),
                tokenPrefix: Type.String(),
                scopes: Type.Array(Type.String()),
                userId: Type.Number(),
                lastUsedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                createdAt: Type.String(),
                expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              })
            ),
          }),
        },
      },
    },
    async (req, reply) => {
      const tokens = await ApiTokenService.listTokens(req.user?.id);
      return reply.send({ data: tokens });
    }
  );

  // 2. POST /admin/tokens - Create new API token
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Generate a new scoped API access token (raw token returned once)',
        tags: ['Admin API Tokens'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          scopes: Type.Array(Type.String(), { minItems: 1 }),
          expiresAt: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              token: Type.String(),
              id: Type.String(),
              name: Type.String(),
              tokenPrefix: Type.String(),
              scopes: Type.Array(Type.String()),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { name: string; scopes: string[]; expiresAt?: string };
      const { token, record } = await ApiTokenService.createToken({
        name: body.name,
        userId: req.user?.id || 1,
        scopes: body.scopes,
        expiresAt: body.expiresAt,
      });

      await AuditService.log({
        userId: req.user?.id,
        action: 'api_token.created',
        entityType: 'api_token',
        entityId: record.id,
        afterValues: { name: record.name, scopes: record.scopes },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({
        data: {
          token,
          id: record.id,
          name: record.name,
          tokenPrefix: record.tokenPrefix,
          scopes: record.scopes,
        },
      });
    }
  );

  // 3. DELETE /admin/tokens/:id - Revoke token
  app.delete(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Revoke an API access token',
        tags: ['Admin API Tokens'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: {
          200: Type.Object({
            data: Type.Object({ success: Type.Boolean() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await ApiTokenService.revokeToken(id);

      await AuditService.log({
        userId: req.user?.id,
        action: 'api_token.revoked',
        entityType: 'api_token',
        entityId: id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.send({ data: { success: true } });
    }
  );
};
