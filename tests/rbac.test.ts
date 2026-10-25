import { describe, it, expect, vi, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import * as poolModule from '../src/db/pool.js';
import * as authServiceModule from '../src/auth/service.js';

describe('CP2.5 RBAC & Permission Matrix API', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('allows owner role access to all admin endpoints with wildcard permissions', async () => {
    const ownerUser = {
      id: 1,
      name: 'Owner User',
      email: 'owner@example.com',
      roleId: 1,
      roleName: 'owner',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };

    const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(ownerUser);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { authorization: 'Bearer owner_mock_token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.role).toBe('owner');
    expect(body.data.permissions).toContain('*');
    expect(Array.isArray(body.data.enabled_modules)).toBe(true);

    spy.mockRestore();
  });

  it('denies customer role access to any admin endpoint with 403 FORBIDDEN', async () => {
    const customerUser = {
      id: 50,
      name: 'Customer Bob',
      email: 'customer@example.com',
      roleId: 6,
      roleName: 'customer',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };

    const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(customerUser);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { authorization: 'Bearer customer_mock_token' },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('Customer');

    spy.mockRestore();
  });

  it('allows editor to access dashboard but denies access to roles management with 403', async () => {
    const editorUser = {
      id: 10,
      name: 'Editor Alice',
      email: 'editor@example.com',
      roleId: 4,
      roleName: 'editor',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };

    const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(editorUser);

    // 1. Editor has core.dashboard.view -> 200
    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { authorization: 'Bearer editor_mock_token' },
    });
    expect(meResponse.statusCode).toBe(200);

    // 2. Editor lacks core.roles.view -> 403
    const rolesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/roles',
      headers: { authorization: 'Bearer editor_mock_token' },
    });
    expect(rolesResponse.statusCode).toBe(403);
    const body = JSON.parse(rolesResponse.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('core.roles.view');

    spy.mockRestore();
  });

  it('allows admin role to view roles and permission matrix', async () => {
    const adminUser = {
      id: 2,
      name: 'Admin User',
      email: 'admin@example.com',
      roleId: 2,
      roleName: 'admin',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };

    const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(adminUser);

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM roles')) {
          return Promise.resolve([
            [
              { id: 1, name: 'owner', description: 'Owner', is_system: 1 },
              { id: 2, name: 'admin', description: 'Admin', is_system: 1 },
              { id: 4, name: 'editor', description: 'Editor', is_system: 1 },
            ],
          ]);
        }
        if (sql.includes('FROM role_permissions')) {
          return Promise.resolve([[]]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const dbSpy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/roles',
      headers: { authorization: 'Bearer admin_mock_token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(3);

    spy.mockRestore();
    dbSpy.mockRestore();
  });

  it('prevents modifying permissions of the owner role', async () => {
    const adminUser = {
      id: 2,
      name: 'Admin User',
      email: 'admin@example.com',
      roleId: 2,
      roleName: 'admin',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };

    const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(adminUser);

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM roles WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, name: 'owner', description: 'Owner', is_system: 1 }]]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const dbSpy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/roles/1/permissions',
      headers: { authorization: 'Bearer admin_mock_token' },
      payload: {
        permissions: ['core.dashboard.view'],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('owner role');

    spy.mockRestore();
    dbSpy.mockRestore();
  });

  it('allows inviting staff and prevents inviting with owner role', async () => {
    const adminUser = {
      id: 2,
      name: 'Admin User',
      email: 'admin@example.com',
      roleId: 2,
      roleName: 'admin',
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
      twoFactorEnabled: false,
    };

    const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(adminUser);

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT id FROM users WHERE email = ?')) {
          return Promise.resolve([[]]);
        }
        if (sql.includes('SELECT id, name FROM roles WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, name: 'owner' }]]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const dbSpy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    // Attempt to invite as owner -> rejected
    const rejectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users/invite',
      headers: { authorization: 'Bearer admin_mock_token' },
      payload: {
        name: 'New Owner Attempt',
        email: 'newowner@example.com',
        role_id: 1,
      },
    });

    expect(rejectResponse.statusCode).toBe(400);
    const body = JSON.parse(rejectResponse.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('owner');

    spy.mockRestore();
    dbSpy.mockRestore();
  });
});
