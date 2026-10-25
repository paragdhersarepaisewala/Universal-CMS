import { FastifyRequest, FastifyReply } from 'fastify';
import { authService, UserDTO } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserDTO;
  }
}

export function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // Also check session cookie if available
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/session=([^;]+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required. Please provide a valid session token.',
      },
    });
  }

  if (token.startsWith('cms_live_')) {
    const { ApiTokenService } = await import('../api-tokens/service.js');
    const apiToken = await ApiTokenService.validateToken(token);
    if (!apiToken) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'API token is invalid or has expired.',
        },
      });
    }

    request.user = {
      id: apiToken.userId,
      name: `API Token (${apiToken.name})`,
      email: 'api-token@system.local',
      roleId: 2,
      roleName: 'admin',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };
    return;
  }

  const user = await authService.validateSession(token);
  if (!user) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Session has expired or is invalid. Please log in again.',
      },
    });
  }

  request.user = user;
}
