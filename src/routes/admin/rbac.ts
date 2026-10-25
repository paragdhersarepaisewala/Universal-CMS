import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { rbacService } from '../../rbac/service.js';
import { moduleRegistry } from '../../modules/registry.js';

export const adminRbacRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/admin/me - Current admin identity & permissions per contract 2.1
  fastify.get(
    '/me',
    {
      preHandler: [authenticate, requirePermission('core.dashboard.view')],
      schema: {
        description: 'Get authenticated admin user profile, assigned permissions, and active modules',
        tags: ['Admin RBAC'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              email: Type.String(),
              role: Type.String(),
              permissions: Type.Array(Type.String()),
              enabled_modules: Type.Array(Type.String()),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const permissions = await rbacService.getUserPermissions(user.roleId, user.roleName || '');
      const activeModules = moduleRegistry
        .getAllModules()
        .filter((m) => m.isEnabled)
        .map((m) => m.name);

      return reply.send({
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.roleName || 'customer',
          permissions,
          enabled_modules: activeModules,
        },
      });
    }
  );

  // 2. GET /api/v1/admin/roles - List roles with their permissions
  fastify.get(
    '/roles',
    {
      preHandler: [authenticate, requirePermission('core.roles.view')],
      schema: {
        description: 'List system roles and permission assignments',
        tags: ['Admin RBAC'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                description: Type.Union([Type.String(), Type.Null()]),
                isSystem: Type.Boolean(),
                permissions: Type.Array(Type.String()),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const roles = await rbacService.listRolesWithPermissions();
      return reply.send({ data: roles });
    }
  );

  // 3. GET /api/v1/admin/permissions - List all available system permissions
  fastify.get(
    '/permissions',
    {
      preHandler: [authenticate, requirePermission('core.roles.view')],
      schema: {
        description: 'List all available system permissions',
        tags: ['Admin RBAC'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                key: Type.String(),
                module: Type.String(),
                description: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const permissions = rbacService.listAllPermissions();
      return reply.send({ data: permissions });
    }
  );

  // 4. PUT /api/v1/admin/roles/:id/permissions - Update permissions matrix
  fastify.put(
    '/roles/:id/permissions',
    {
      preHandler: [authenticate, requirePermission('core.roles.edit')],
      schema: {
        description: 'Update the permission matrix for a role',
        tags: ['Admin RBAC'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        body: Type.Object({
          permissions: Type.Array(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              description: Type.Union([Type.String(), Type.Null()]),
              isSystem: Type.Boolean(),
              permissions: Type.Array(Type.String()),
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
      const params = request.params as { id: number };
      const body = request.body as { permissions: string[] };

      try {
        const updated = await rbacService.updateRolePermissions(params.id, body.permissions);
        return reply.send({ data: updated });
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string; statusCode?: number };
        const statusCode = error.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: error.code || 'VALIDATION_FAILED',
            message: error.message || 'Failed to update role permissions.',
          },
        });
      }
    }
  );

  // 5. POST /api/v1/admin/users/invite - Invite staff member with a role
  fastify.post(
    '/users/invite',
    {
      preHandler: [authenticate, requirePermission('core.users.edit')],
      schema: {
        description: 'Invite a new staff member with an assigned role',
        tags: ['Admin RBAC'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 2 }),
          email: Type.String({ format: 'email' }),
          role_id: Type.Number(),
        }),
        response: {
          201: Type.Object({
            data: Type.Object({
              user: Type.Object({
                id: Type.Number(),
                name: Type.String(),
                email: Type.String(),
                roleId: Type.Number(),
                roleName: Type.String(),
              }),
              invite_token: Type.String(),
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
      const inviter = request.user!;
      const body = request.body as { name: string; email: string; role_id: number };

      try {
        const result = await rbacService.inviteStaff(inviter.id, {
          name: body.name,
          email: body.email,
          roleId: body.role_id,
        });

        return reply.status(201).send({
          data: {
            user: result.user,
            invite_token: result.inviteToken,
          },
        });
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string; statusCode?: number };
        const statusCode = error.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: error.code || 'VALIDATION_FAILED',
            message: error.message || 'Failed to invite staff member.',
          },
        });
      }
    }
  );
};
