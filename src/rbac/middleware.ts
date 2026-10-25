import { FastifyRequest, FastifyReply } from 'fastify';
import { rbacService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    userPermissions?: string[];
  }
}

export function requirePermission(permission: string | string[]) {
  const requiredList = Array.isArray(permission) ? permission : [permission];

  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
    }

    // Customer role is never permitted on protected admin endpoints
    if (user.roleName === 'customer') {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied: Customer accounts cannot access administrative routes.',
        },
      });
    }

    const permissions = await rbacService.getUserPermissions(user.roleId, user.roleName || '');
    request.userPermissions = permissions;

    // Check wildcard or exact permission
    if (permissions.includes('*')) {
      return;
    }

    const hasAny = requiredList.some((req) => permissions.includes(req));
    if (!hasAny) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Permission denied: requires '${requiredList.join(' or ')}'.`,
        },
      });
    }
  };
}

export function requireRole(allowedRoles: string[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
    }

    if (!allowedRoles.includes(user.roleName || '')) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied: restricted to ${allowedRoles.join(', ')}.`,
        },
      });
    }
  };
}
