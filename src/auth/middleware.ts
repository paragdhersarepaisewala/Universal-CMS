import { FastifyRequest, FastifyReply } from 'fastify';
import { authService, UserDTO } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserDTO;
  }
}

export interface ExtractedToken {
  token: string;
  source: 'bearer' | 'cookie';
}

export function extractToken(request: FastifyRequest): ExtractedToken | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.substring(7).trim(), source: 'bearer' };
  }

  // Also check session cookie if available
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/session=([^;]+)/);
    if (match && match[1]) {
      return { token: match[1].trim(), source: 'cookie' };
    }
  }

  return null;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const extracted = extractToken(request);
  if (!extracted) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required. Please provide a valid session token.',
      },
    });
  }

  const { token, source } = extracted;

  // CSRF Defense for cookie-based transport on state-changing HTTP methods
  if (source === 'cookie' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method.toUpperCase())) {
    const { CsrfService } = await import('./csrf.js');
    const cookieCsrf = CsrfService.extractCookieToken(request);
    const headerCsrf = CsrfService.extractHeaderToken(request);

    // If double-submit token is supplied in header, verify cryptographically against cookie
    if (cookieCsrf && headerCsrf) {
      if (!CsrfService.verifyToken(headerCsrf, cookieCsrf)) {
        return reply.status(403).send({
          error: {
            code: 'CSRF_TOKEN_MISMATCH',
            message: 'Cross-Site Request Forgery protection: Invalid CSRF token.',
          },
        });
      }
    } else {
      const customHeader = request.headers['x-requested-with'] || request.headers['x-csrf-token'] || request.headers['x-cms-client'];
      const origin = request.headers['origin'];
      const host = request.headers['host'];

      const isSameOrigin = origin && host && origin.includes(host);
      if (!customHeader && !isSameOrigin) {
        return reply.status(403).send({
          error: {
            code: 'CSRF_VALIDATION_FAILED',
            message: 'Cross-Site Request Forgery protection: State-changing requests using cookie authentication must include custom header (X-Requested-With or X-CSRF-Token).',
          },
        });
      }
    }
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
