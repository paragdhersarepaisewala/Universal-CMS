import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.js';
import { authRoutes } from './auth.js';
import { adminModulesRoutes } from './admin/modules.js';
import { blogModuleManifest } from '../modules/blog/index.js';
import { storeModuleManifest } from '../modules/store/index.js';

export const v1Routes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // System health
  await fastify.register(healthRoutes);

  // Authentication & accounts
  await fastify.register(authRoutes, { prefix: '/auth' });

  // Admin routes
  await fastify.register(adminModulesRoutes, { prefix: '/admin' });

  // Optional module routes
  if (blogModuleManifest.routes) {
    await fastify.register(blogModuleManifest.routes, { prefix: blogModuleManifest.routesPrefix });
  }

  if (storeModuleManifest.routes) {
    await fastify.register(storeModuleManifest.routes, { prefix: storeModuleManifest.routesPrefix });
  }
};
