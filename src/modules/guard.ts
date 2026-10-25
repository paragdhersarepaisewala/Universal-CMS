import { FastifyRequest, FastifyReply } from 'fastify';
import { moduleRegistry } from './registry.js';

export function requireModule(moduleName: string) {
  return async function moduleGuard(_request: FastifyRequest, reply: FastifyReply) {
    if (!moduleRegistry.isEnabled(moduleName)) {
      return reply.status(404).send({
        error: {
          code: 'MODULE_DISABLED',
          message: `Module '${moduleName}' is disabled`,
        },
      });
    }
  };
}
