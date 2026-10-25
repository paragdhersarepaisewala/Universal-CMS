import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { moduleRegistry } from '../../modules/registry.js';

const ModuleStatusSchema = Type.Object({
  name: Type.String(),
  version: Type.String(),
  description: Type.String(),
  isCore: Type.Boolean(),
  isEnabled: Type.Boolean(),
  dependsOn: Type.Array(Type.String()),
});

const PatchModuleBodySchema = Type.Object({
  is_enabled: Type.Boolean(),
});

export const adminModulesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/v1/admin/modules - List all modules
  fastify.get(
    '/modules',
    {
      schema: {
        description: 'Get all core and optional modules with enabled status',
        tags: ['Admin Modules'],
        response: {
          200: Type.Object({
            data: Type.Array(ModuleStatusSchema),
          }),
        },
      },
    },
    async (_req, reply) => {
      const modules = moduleRegistry.getAllModules();
      return reply.send({ data: modules });
    }
  );

  // PATCH /api/v1/admin/modules/:name - Enable or disable an optional module
  fastify.patch(
    '/modules/:name',
    {
      schema: {
        description: 'Toggle module enabled state',
        tags: ['Admin Modules'],
        params: Type.Object({
          name: Type.String(),
        }),
        body: PatchModuleBodySchema,
        response: {
          200: Type.Object({
            data: ModuleStatusSchema,
          }),
          400: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
          404: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const { is_enabled } = request.body as { is_enabled: boolean };

      const existing = moduleRegistry.getModule(name);
      if (!existing) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Module '${name}' does not exist.`,
          },
        });
      }

      try {
        moduleRegistry.setModuleState(name, is_enabled);
        return reply.send({
          data: {
            name: existing.name,
            version: existing.version,
            description: existing.description,
            isCore: existing.isCore,
            isEnabled: moduleRegistry.isEnabled(name),
            dependsOn: existing.dependsOn || [],
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_FAILED',
            message,
          },
        });
      }
    }
  );

  // GET /api/v1/admin/navigation - Dynamic navigation generated from enabled modules
  fastify.get(
    '/navigation',
    {
      schema: {
        description: 'Get admin navigation menu items for currently enabled modules',
        tags: ['Admin Navigation'],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.String(),
                label: Type.String(),
                route: Type.String(),
                permission: Type.String(),
                order: Type.Optional(Type.Number()),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const navigation = moduleRegistry.getAdminNavigation();
      return reply.send({ data: navigation });
    }
  );
};
