import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';

const storeRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    '/products',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'List store products',
        tags: ['Store'],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                price: Type.Number(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      return reply.send({
        data: [
          { id: 1, name: 'Sample Product', price: 9900 },
        ],
      });
    }
  );
};

export const storeModuleManifest: ModuleManifest = {
  name: 'store',
  version: '0.1.0',
  description: 'Ecommerce catalog, inventory, cart, checkout, and orders',
  isCore: false,
  dependsOn: ['media'],
  permissions: [
    { key: 'store.products.view', description: 'View store products' },
    { key: 'store.products.edit', description: 'Create and edit store products' },
  ],
  adminNav: [
    {
      id: 'store-products',
      label: 'Products',
      route: '/admin/store/products',
      permission: 'store.products.view',
      order: 30,
    },
  ],
  routesPrefix: '/store',
  routes: storeRoutes,
};
