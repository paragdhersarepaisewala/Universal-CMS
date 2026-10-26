import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { MediaService } from '../src/content/media.js';
import { CsrfService } from '../src/auth/csrf.js';
import sharp from 'sharp';

describe('Media Transformation & CSRF Double-Submit Protection', () => {
  let app: FastifyInstance;

  const mockAdminUser = {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
    roleId: 2,
    roleName: 'admin',
    isActive: true,
    emailVerifiedAt: new Date().toISOString(),
    twoFactorEnabled: false,
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Server-Side WebP & Responsive Dimensions Generation (Sharp)', () => {
    it('transforms a JPEG/PNG buffer into WebP with responsive variants and dimensions', async () => {
      // Create a test 1000x800 sample SVG and convert to PNG buffer
      const svgBuffer = Buffer.from(
        `<svg width="1000" height="800" xmlns="http://www.w3.org/2000/svg">
          <rect width="1000" height="800" fill="#3b82f6" />
          <text x="500" y="400" font-size="50" text-anchor="middle" fill="#ffffff">Universal CMS</text>
        </svg>`
      );
      const pngBuffer = await sharp(svgBuffer).png().toBuffer();

      const result = await MediaService.transformImageToWebp(pngBuffer, { quality: 85 });

      expect(result.format).toBe('webp');
      expect(result.width).toBe(1000);
      expect(result.height).toBe(800);
      expect(result.aspectRatio).toBe('1000:800');
      expect(result.mimeType).toBe('image/webp');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.variants).toBeDefined();
      expect(result.variants?.thumb.width).toBe(300);
      expect(result.variants?.medium.width).toBe(800);
    });

    it('POST /api/v1/admin/media/transform - transforms image via admin endpoint', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const testBuffer = await sharp({
        create: {
          width: 600,
          height: 400,
          channels: 4,
          background: { r: 16, g: 185, b: 129, alpha: 1 },
        },
      }).png().toBuffer();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/media/transform',
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          imageBase64: testBuffer.toString('base64'),
          quality: 90,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.format).toBe('webp');
      expect(body.data.width).toBe(600);
      expect(body.data.height).toBe(400);
      expect(body.data.webpBase64).toBeDefined();
      expect(body.data.variants.thumb).toBeDefined();
    });
  });

  describe('Double-Submit CSRF Protection', () => {
    it('GET /api/v1/auth/csrf-token issues random CSRF token and sets cookie', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/csrf-token',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.csrfToken).toBeDefined();
      expect(typeof body.data.csrfToken).toBe('string');
      expect(body.data.csrfToken.length).toBe(64); // 32 bytes hex
      expect(res.headers['set-cookie']).toContain('csrf_token=');
    });

    it('blocks state-changing cookie requests with mismatched CSRF token', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const token1 = CsrfService.generateToken();
      const token2 = CsrfService.generateToken();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/banners',
        headers: {
          cookie: `session=mock_cookie_session; csrf_token=${token1}`,
          'x-csrf-token': token2, // Mismatched token
        },
        payload: {
          name: 'Promo Banner',
          content: 'Sale 20%',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('allows state-changing cookie requests when CSRF token matches', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const validToken = CsrfService.generateToken();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/banners',
        headers: {
          cookie: `session=mock_cookie_session; csrf_token=${validToken}`,
          'x-csrf-token': validToken, // Matching token
        },
        payload: {
          name: 'Promo Banner',
          content: 'Sale 20%',
        },
      });

      // Status should be 200 or successful execution
      expect(res.statusCode).toBe(200);
    });
  });
});
