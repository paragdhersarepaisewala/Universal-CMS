import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.js';
import { authRoutes } from './auth.js';
import { adminModulesRoutes } from './admin/modules.js';
import { adminRbacRoutes } from './admin/rbac.js';
import { adminEmailRoutes } from './admin/email.js';
import { publicEmailRoutes } from './email.js';
import { blogModuleManifest } from '../modules/blog/index.js';
import { storeModuleManifest } from '../modules/store/index.js';

export const v1Routes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // System health
  await fastify.register(healthRoutes);

  // Authentication & accounts
  await fastify.register(authRoutes, { prefix: '/auth' });

  // Email public endpoints (unsubscribe)
  await fastify.register(publicEmailRoutes, { prefix: '/email' });

  // Admin routes
  await fastify.register(adminModulesRoutes, { prefix: '/admin' });
  await fastify.register(adminRbacRoutes, { prefix: '/admin' });
  await fastify.register(adminEmailRoutes, { prefix: '/admin/email' });

  // Optional module routes
  if (blogModuleManifest.routes) {
    await fastify.register(blogModuleManifest.routes, { prefix: blogModuleManifest.routesPrefix });
  }

  if (storeModuleManifest.routes) {
    await fastify.register(storeModuleManifest.routes, { prefix: storeModuleManifest.routesPrefix });
  }
};
