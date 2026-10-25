import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.js';

export const v1Routes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(healthRoutes);
};
