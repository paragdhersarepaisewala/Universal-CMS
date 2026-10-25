import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { MemoryCacheDriver } from '../src/cache/drivers/memory.js';
import { FileCacheDriver } from '../src/cache/drivers/file.js';
import { cache, CACHE_TAGS } from '../src/cache/index.js';

describe('CP2.7 Cache Layer', () => {
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

  const mockEditorUser = {
    id: 4,
    name: 'Editor User',
    email: 'editor@example.com',
    roleId: 4,
    roleName: 'editor',
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

  describe('MemoryCacheDriver', () => {
    it('sets, retrieves, and deletes items', async () => {
      const driver = new MemoryCacheDriver();
      await driver.set('foo', { a: 1 });
      const val = await driver.get<{ a: number }>('foo');
      expect(val).toEqual({ a: 1 });

      const deleted = await driver.delete('foo');
      expect(deleted).toBe(true);
      expect(await driver.get('foo')).toBeNull();
    });

    it('expires items according to TTL', async () => {
      const driver = new MemoryCacheDriver();
      // Set TTL to -1 second (already expired)
      await driver.set('expired_key', 'val', -1);
      expect(await driver.get('expired_key')).toBeNull();
    });

    it('invalidates cache items by tags', async () => {
      const driver = new MemoryCacheDriver();
      await driver.set('page:home', { title: 'Home' }, 3600, ['pages', 'public']);
      await driver.set('page:about', { title: 'About' }, 3600, ['pages', 'public']);
      await driver.set('menu:header', { items: [] }, 3600, ['menus', 'public']);

      // Invalidate only 'pages' tag
      const purged = await driver.invalidateTags(['pages']);
      expect(purged).toBe(2);

      expect(await driver.get('page:home')).toBeNull();
      expect(await driver.get('page:about')).toBeNull();
      expect(await driver.get('menu:header')).not.toBeNull();
    });
  });

  describe('FileCacheDriver', () => {
    const testCacheDir = path.resolve('./.cache_test');

    afterAll(() => {
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true, force: true });
      }
    });

    it('persists and retrieves cached values to filesystem with tag support', async () => {
      const driver = new FileCacheDriver(testCacheDir);
      await driver.set('site:settings', { siteName: 'Test CMS' }, 3600, ['settings']);

      const retrieved = await driver.get<{ siteName: string }>('site:settings');
      expect(retrieved).toEqual({ siteName: 'Test CMS' });

      const status = await driver.getStatus();
      expect(status.driver).toBe('file');
      expect(status.itemCount).toBe(1);

      // Invalidate tags
      const count = await driver.invalidateTags(['settings']);
      expect(count).toBe(1);
      expect(await driver.get('site:settings')).toBeNull();
    });
  });

  describe('CacheManager getOrSet', () => {
    it('only calls factory on cache miss and reuses cached result', async () => {
      let callCount = 0;
      const factory = async () => {
        callCount++;
        return { data: 'computed_result' };
      };

      const res1 = await cache.getOrSet('test_key', factory, 3600, [CACHE_TAGS.SETTINGS]);
      expect(res1).toEqual({ data: 'computed_result' });
      expect(callCount).toBe(1);

      const res2 = await cache.getOrSet('test_key', factory, 3600, [CACHE_TAGS.SETTINGS]);
      expect(res2).toEqual({ data: 'computed_result' });
      expect(callCount).toBe(1); // Not called again!

      // Invalidate tag and verify callCount increments
      await cache.invalidateTags([CACHE_TAGS.SETTINGS]);
      const res3 = await cache.getOrSet('test_key', factory, 3600, [CACHE_TAGS.SETTINGS]);
      expect(res3).toEqual({ data: 'computed_result' });
      expect(callCount).toBe(2);
    });
  });

  describe('Admin Cache HTTP Endpoints', () => {
    it('returns cache status for users with core.cache.manage permission', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cache',
        headers: { authorization: 'Bearer admin_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveProperty('driver');
      expect(body.data).toHaveProperty('itemCount');
      expect(body.data).toHaveProperty('tagsCount');

      spy.mockRestore();
    });

    it('denies editor role access to cache purge (403 FORBIDDEN)', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockEditorUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/cache/purge',
        headers: { authorization: 'Bearer editor_token' },
        payload: { all: true },
      });

      expect(res.statusCode).toBe(403);
      spy.mockRestore();
    });

    it('allows purging by tags, key, or all', async () => {
      const spy = vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // Pre-seed some cache items
      await cache.set('item:1', 'val1', 3600, ['pages']);
      await cache.set('item:2', 'val2', 3600, ['menus']);

      // Purge by tag
      const purgeTagRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/cache/purge',
        headers: { authorization: 'Bearer admin_token' },
        payload: { tags: ['pages'] },
      });
      expect(purgeTagRes.statusCode).toBe(200);
      expect(await cache.get('item:1')).toBeNull();
      expect(await cache.get('item:2')).not.toBeNull();

      // Purge all
      const purgeAllRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/cache/purge',
        headers: { authorization: 'Bearer admin_token' },
        payload: { all: true },
      });
      expect(purgeAllRes.statusCode).toBe(200);
      expect(await cache.get('item:2')).toBeNull();

      spy.mockRestore();
    });
  });
});
