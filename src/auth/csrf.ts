import crypto from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export class CsrfService {
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  static verifyToken(headerToken: string | undefined, cookieToken: string | undefined): boolean {
    if (!headerToken || !cookieToken) {
      return false;
    }

    if (headerToken.length !== cookieToken.length) {
      return false;
    }

    try {
      const a = Buffer.from(headerToken, 'utf-8');
      const b = Buffer.from(cookieToken, 'utf-8');
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  static extractCookieToken(request: FastifyRequest): string | null {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1].trim()) : null;
  }

  static extractHeaderToken(request: FastifyRequest): string | null {
    const header = request.headers['x-csrf-token'];
    if (typeof header === 'string' && header.trim()) {
      return header.trim();
    }
    return null;
  }
}

export function csrfProtectionMiddleware(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  // Safe HTTP read-only methods bypass CSRF check
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return done();
  }

  // If using Bearer token auth, CSRF is not applicable per RFC standards
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return done();
  }

  // If request uses cookie session authentication, enforce Double Submit Cookie
  const cookieHeader = request.headers.cookie;
  const hasSessionCookie = cookieHeader && cookieHeader.includes('session=');

  if (hasSessionCookie) {
    const cookieToken = CsrfService.extractCookieToken(request);
    const headerToken = CsrfService.extractHeaderToken(request);

    if (!cookieToken || !headerToken || !CsrfService.verifyToken(headerToken, cookieToken)) {
      reply.status(403).send({
        error: {
          code: 'CSRF_TOKEN_MISMATCH',
          message: 'Cross-Site Request Forgery validation failed: Missing or mismatched CSRF token in X-CSRF-Token header.',
        },
      });
      return;
    }
  }

  return done();
}
