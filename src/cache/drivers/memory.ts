import type { CacheDriver, CacheItem } from '../types.js';

export class MemoryCacheDriver implements CacheDriver {
  private entries = new Map<string, CacheItem>();
  private tagIndex = new Map<string, Set<string>>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.entries.get(key);
    if (!item) return null;

    if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
      await this.delete(key);
      return null;
    }

    return item.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number, tags: string[] = []): Promise<void> {
    // Remove old tags if key already existed
    const existing = this.entries.get(key);
    if (existing) {
      for (const t of existing.tags) {
        this.tagIndex.get(t)?.delete(key);
      }
    }

    const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    const item: CacheItem = {
      value,
      expiresAt,
      tags: [...tags],
    };

    this.entries.set(key, item);

    // Index by tags
    for (const tag of tags) {
      let set = this.tagIndex.get(tag);
      if (!set) {
        set = new Set<string>();
        this.tagIndex.set(tag, set);
      }
      set.add(key);
    }
  }

  async delete(key: string): Promise<boolean> {
    const item = this.entries.get(key);
    if (!item) return false;

    for (const tag of item.tags) {
      this.tagIndex.get(tag)?.delete(key);
      if (this.tagIndex.get(tag)?.size === 0) {
        this.tagIndex.delete(tag);
      }
    }

    return this.entries.delete(key);
  }

  async invalidateTags(tags: string[]): Promise<number> {
    let invalidatedCount = 0;
    const keysToDelete = new Set<string>();

    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);
      if (keys) {
        for (const k of keys) {
          keysToDelete.add(k);
        }
      }
    }

    for (const k of keysToDelete) {
      if (await this.delete(k)) {
        invalidatedCount++;
      }
    }

    return invalidatedCount;
  }

  async flush(): Promise<void> {
    this.entries.clear();
    this.tagIndex.clear();
  }

  async getStatus(): Promise<{ driver: string; itemCount: number; tagsCount: number }> {
    return {
      driver: 'memory',
      itemCount: this.entries.size,
      tagsCount: this.tagIndex.size,
    };
  }
}
