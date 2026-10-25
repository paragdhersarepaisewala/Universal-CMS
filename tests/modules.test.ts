import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { moduleRegistry } from '../src/modules/registry.js';

describe('CP2.3 Module System & Feature Flags', () => {
  const app = buildApp();

  beforeEach(() => {
    // Reset to baseline state: core modules enabled, optional modules disabled
    moduleRegistry.reset();
    moduleRegistry.registerManifest({
      name: 'blog',
      version: '0.1.0',
      description: 'Blog module',
      isCore: false,
      permissions: [{ key: 'blog.posts.view', description: 'View posts' }],
      adminNav: [{ id: 'blog-posts', label: 'Blog Posts', route: '/admin/blog/posts', permission: 'blog.posts.view', order: 20 }],
      routesPrefix: '/blog',
    });
    moduleRegistry.registerManifest({
      name: 'store',
      version: '0.1.0',
      description: 'Store module',
      isCore: false,
      dependsOn: ['media'],
      permissions: [{ key: 'store.products.view', description: 'View products' }],
      adminNav: [{ id: 'store-products', label: 'Products', route: '/admin/store/products', permission: 'store.products.view', order: 30 }],
      routesPrefix: '/store',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/admin/modules returns list of all core and optional modules', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/modules',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);

    const moduleNames = body.data.map((m: { name: string }) => m.name);
    // Core modules must be present
    expect(moduleNames).toContain('auth');
    expect(moduleNames).toContain('rbac');
    expect(moduleNames).toContain('settings');
    expect(moduleNames).toContain('media');
    // Optional modules must be present
    expect(moduleNames).toContain('blog');
    expect(moduleNames).toContain('store');
  });

  it('disabled module returns 404 MODULE_DISABLED on its routes', async () => {
    // By default, store is disabled
    expect(moduleRegistry.isEnabled('store')).toBe(false);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/store/products',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('MODULE_DISABLED');
    expect(body.error.message).toContain('store');
  });

  it('disabled module does not appear in admin navigation', async () => {
    expect(moduleRegistry.isEnabled('store')).toBe(false);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/navigation',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    const navIds = body.data.map((n: { id: string }) => n.id);
    expect(navIds).not.toContain('store-products');
  });

  it('PATCH /api/v1/admin/modules/:name enables an optional module', async () => {
    // 1. Enable store
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/store',
      payload: { is_enabled: true },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patchBody = JSON.parse(patchResponse.body);
    expect(patchBody.data.name).toBe('store');
    expect(patchBody.data.isEnabled).toBe(true);
    expect(moduleRegistry.isEnabled('store')).toBe(true);

    // 2. Route now returns 200
    const routeResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/store/products',
    });
    expect(routeResponse.statusCode).toBe(200);
    const routeBody = JSON.parse(routeResponse.body);
    expect(routeBody.data[0].name).toBe('Sample Product');

    // 3. Navigation now includes store
    const navResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/navigation',
    });
    expect(navResponse.statusCode).toBe(200);
    const navBody = JSON.parse(navResponse.body);
    const navIds = navBody.data.map((n: { id: string }) => n.id);
    expect(navIds).toContain('store-products');
  });

  it('disallowing disabling of core modules returns 400', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/auth',
      payload: { is_enabled: false },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('Core module');
  });

  it('enforcing dependencies prevents enabling if dependency is disabled', () => {
    // Register custom modules where module-b depends on module-a
    moduleRegistry.registerManifest({
      name: 'dep-a',
      version: '0.1.0',
      description: 'Base dependency',
      isCore: false,
      permissions: [],
      adminNav: [],
      routesPrefix: '/dep-a',
    });
    moduleRegistry.registerManifest({
      name: 'dep-b',
      version: '0.1.0',
      description: 'Dependent module',
      isCore: false,
      dependsOn: ['dep-a'],
      permissions: [],
      adminNav: [],
      routesPrefix: '/dep-b',
    });

    // Enabling dep-b while dep-a is disabled must throw
    expect(() => moduleRegistry.setModuleState('dep-b', true)).toThrow(
      "Cannot enable 'dep-b' because required dependency 'dep-a' is disabled."
    );

    // Enable dep-a first, then dep-b succeeds
    moduleRegistry.setModuleState('dep-a', true);
    expect(() => moduleRegistry.setModuleState('dep-b', true)).not.toThrow();

    // Disabling dep-a while dep-b is enabled must throw
    expect(() => moduleRegistry.setModuleState('dep-a', false)).toThrow(
      "Cannot disable 'dep-a' because enabled module 'dep-b' depends on it."
    );
  });
});
