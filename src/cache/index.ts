import { MemoryCacheDriver } from './drivers/memory.js';
import { FileCacheDriver } from './drivers/file.js';
import type { CacheDriver, CachePurgeOptions } from './types.js';

export const CACHE_TAGS = {
  SETTINGS: 'settings',
  MENUS: 'menus',
  PAGES: 'pages',
  THEME: 'theme',
  CATALOG: 'catalog',
  NAVIGATION: 'navigation',
} as const;

export type CacheTag = typeof CACHE_TAGS[keyof typeof CACHE_TAGS];

class CacheManager {
  private driver: CacheDriver;

  constructor() {
    const driverType = process.env.CACHE_DRIVER || (process.env.NODE_ENV === 'production' ? 'file' : 'memory');
    if (driverType === 'file') {
      const dir = process.env.CACHE_FILE_DIR || './.cache';
      this.driver = new FileCacheDriver(dir);
    } else {
      this.driver = new MemoryCacheDriver();
    }
  }

  setDriver(driver: CacheDriver): void {
    this.driver = driver;
  }

  getDriver(): CacheDriver {
    return this.driver;
  }

  async get<T>(key: string): Promise<T | null> {
    return await this.driver.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number, tags: string[] = []): Promise<void> {
    await this.driver.set(key, value, ttlSeconds, tags);
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
    tags: string[] = []
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await factory();
    await this.set(key, fresh, ttlSeconds, tags);
    return fresh;
  }

  async delete(key: string): Promise<boolean> {
    return await this.driver.delete(key);
  }

  async invalidateTags(tags: string[]): Promise<number> {
    if (!tags || tags.length === 0) return 0;
    return await this.driver.invalidateTags(tags);
  }

  async flush(): Promise<void> {
    await this.driver.flush();
  }

  async purge(options: CachePurgeOptions): Promise<{ purged: number; message: string }> {
    if (options.all) {
      await this.flush();
      return { purged: 1, message: 'Entire cache flushed successfully' };
    }

    if (options.key) {
      const deleted = await this.delete(options.key);
      return {
        purged: deleted ? 1 : 0,
        message: deleted ? `Key '${options.key}' purged` : `Key '${options.key}' was not found in cache`,
      };
    }

    if (options.tags && options.tags.length > 0) {
      const count = await this.invalidateTags(options.tags);
      return {
        purged: count,
        message: `Purged cache entries matching tags: ${options.tags.join(', ')}`,
      };
    }

    return { purged: 0, message: 'No purge options specified' };
  }

  async getStatus(): Promise<{ driver: string; itemCount: number; tagsCount: number }> {
    return await this.driver.getStatus();
  }
}

export const cache = new CacheManager();
export * from './types.js';
