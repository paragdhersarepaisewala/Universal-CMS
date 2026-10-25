import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import * as poolModule from '../src/db/pool.js';
import { hashPassword } from '../src/utils/crypto.js';
import { authRateLimiter } from '../src/auth/rate-limiter.js';
import { generateTotpCode } from '../src/utils/totp.js';

describe('CP2.4 Authentication & Accounts API', () => {
  const app = buildApp();

  beforeEach(() => {
    authRateLimiter.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/auth/signup registers a new user with verification required', async () => {
    const mockUsers: Array<{ id: number; email: string }> = [];
    const mockTokens: Array<{ userId: number }> = [];

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id FROM users WHERE email = ?')) {
          return Promise.resolve([[]]);
        }
        if (sql.includes("SELECT id FROM roles WHERE name = 'customer'")) {
          return Promise.resolve([[{ id: 6 }]]);
        }
        if (sql.includes('INSERT INTO users')) {
          const emailVal = Array.isArray(params) ? String(params[1]) : '';
          mockUsers.push({ id: 101, email: emailVal });
          return Promise.resolve([{ insertId: 101 }]);
        }
        if (sql.includes('INSERT INTO auth_tokens')) {
          mockTokens.push({ userId: 101 });
          return Promise.resolve([{ insertId: 201 }]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'SuperSecretPassword123!',
        date_of_birth: '1995-05-15',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.data.user.email).toBe('jane@example.com');
    expect(body.data.user.dateOfBirth).toBe('1995-05-15');
    expect(body.data.verification_required).toBe(true);
    expect(body.data.verification_token).toBeDefined();
    expect(body.data.verification_code).toHaveLength(6);

    spy.mockRestore();
  });

  it('POST /api/v1/auth/signup rejects duplicate email with 409 CONFLICT', async () => {
    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT id FROM users WHERE email = ?')) {
          return Promise.resolve([[{ id: 99 }]]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'Jane Doe',
        email: 'existing@example.com',
        password: 'SuperSecretPassword123!',
      },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('CONFLICT');

    spy.mockRestore();
  });

  it('POST /api/v1/auth/verify-email activates user account', async () => {
    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT t.id, t.user_id, t.expires_at')) {
          return Promise.resolve([
            [
              {
                id: 1,
                user_id: 101,
                expires_at: new Date(Date.now() + 60000).toISOString(),
                email: 'test@example.com',
              },
            ],
          ]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: {
        code: '123456',
        email: 'test@example.com',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.verified).toBe(true);

    spy.mockRestore();
  });

  it('POST /api/v1/auth/login enforces account lockout after 5 failed attempts', async () => {
    const validHash = await hashPassword('CorrectPassword123!');

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM users u')) {
          return Promise.resolve([
            [
              {
                id: 10,
                name: 'Test User',
                email: 'target@example.com',
                password_hash: validHash,
                role_id: 6,
                is_active: 1,
                email_verified_at: new Date().toISOString(),
                two_factor_enabled: 0,
                role_name: 'customer',
              },
            ],
          ]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    // Perform 4 failed attempts -> 401
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'target@example.com', password: 'WrongPassword' },
      });
      expect(res.statusCode).toBe(401);
    }

    // 5th failed attempt -> 429 lockout triggered
    const res5 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'target@example.com', password: 'WrongPassword' },
    });
    expect(res5.statusCode).toBe(429);
    const body5 = JSON.parse(res5.body);
    expect(body5.error.code).toBe('RATE_LIMITED');
    expect(body5.error.message).toContain('locked');

    // 6th attempt even with correct password is blocked while locked
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'target@example.com', password: 'CorrectPassword123!' },
    });
    expect(res6.statusCode).toBe(429);

    spy.mockRestore();
  });

  it('POST /api/v1/auth/login successfully logs in and returns session token', async () => {
    const validHash = await hashPassword('CorrectPassword123!');

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM users u')) {
          return Promise.resolve([
            [
              {
                id: 20,
                name: 'Verified User',
                email: 'verified@example.com',
                password_hash: validHash,
                role_id: 6,
                is_active: 1,
                email_verified_at: new Date().toISOString(),
                two_factor_enabled: 0,
                role_name: 'customer',
              },
            ],
          ]);
        }
        if (sql.includes('INSERT INTO sessions')) {
          return Promise.resolve([{ insertId: 1 }]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'verified@example.com',
        password: 'CorrectPassword123!',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.token).toBeDefined();
    expect(body.data.user.email).toBe('verified@example.com');
    expect(body.data.user.roleName).toBe('customer');

    spy.mockRestore();
  });

  it('POST /api/v1/auth/login requests 2FA code when two_factor_enabled is active', async () => {
    const validHash = await hashPassword('AdminPassword123!');
    const secret = 'JBSWY3DPEHPK3PXP';

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM users u')) {
          return Promise.resolve([
            [
              {
                id: 1,
                name: 'Admin User',
                email: 'admin@example.com',
                password_hash: validHash,
                role_id: 1,
                is_active: 1,
                email_verified_at: new Date().toISOString(),
                two_factor_enabled: 1,
                two_factor_secret: secret,
                role_name: 'owner',
              },
            ],
          ]);
        }
        if (sql.includes('INSERT INTO auth_tokens')) {
          return Promise.resolve([{ insertId: 1 }]);
        }
        if (sql.includes('INSERT INTO sessions')) {
          return Promise.resolve([{ insertId: 1 }]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    // 1. Without 2FA code -> returns requires_2fa
    const resNo2fa = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.com', password: 'AdminPassword123!' },
    });

    expect(resNo2fa.statusCode).toBe(200);
    const bodyNo2fa = JSON.parse(resNo2fa.body);
    expect(bodyNo2fa.data.requires_2fa).toBe(true);
    expect(bodyNo2fa.data.temp_token).toBeDefined();

    // 2. With valid 2FA TOTP code -> returns session token
    const validTotp = generateTotpCode(secret);
    const resWith2fa = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@example.com',
        password: 'AdminPassword123!',
        two_factor_code: validTotp,
      },
    });

    expect(resWith2fa.statusCode).toBe(200);
    const bodyWith2fa = JSON.parse(resWith2fa.body);
    expect(bodyWith2fa.data.token).toBeDefined();

    spy.mockRestore();
  });

  it('GET /api/v1/auth/me returns authenticated user session', async () => {
    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM sessions s')) {
          return Promise.resolve([
            [
              {
                id: 1,
                name: 'Current User',
                email: 'current@example.com',
                role_id: 1,
                is_active: 1,
                email_verified_at: new Date().toISOString(),
                two_factor_enabled: 0,
                role_name: 'owner',
                expires_at: new Date(Date.now() + 100000).toISOString(),
              },
            ],
          ]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: 'Bearer valid_mock_session_token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.email).toBe('current@example.com');
    expect(body.data.roleName).toBe('owner');

    spy.mockRestore();
  });
});
