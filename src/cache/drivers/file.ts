import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheDriver, CacheItem } from '../types.js';

export class FileCacheDriver implements CacheDriver {
  private cacheDir: string;
  private tagsIndexPath: string;

  constructor(dirPath = './.cache') {
    this.cacheDir = path.resolve(dirPath);
    this.tagsIndexPath = path.join(this.cacheDir, 'tags_index.json');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getKeyHash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private getFilePath(key: string): string {
    const hash = this.getKeyHash(key);
    return path.join(this.cacheDir, `${hash}.json`);
  }

  private loadTagsIndex(): Record<string, string[]> {
    try {
      if (fs.existsSync(this.tagsIndexPath)) {
        const raw = fs.readFileSync(this.tagsIndexPath, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // Return empty if corrupted or missing
    }
    return {};
  }

  private saveTagsIndex(index: Record<string, string[]>): void {
    try {
      fs.writeFileSync(this.tagsIndexPath, JSON.stringify(index), 'utf8');
    } catch {
      // Ignore write errors
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const item = JSON.parse(raw) as CacheItem<T>;

      if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
        await this.delete(key);
        return null;
      }

      return item.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number, tags: string[] = []): Promise<void> {
    this.ensureDirectory();
    const filePath = this.getFilePath(key);
    const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;

    const item: CacheItem<T> = {
      value,
      expiresAt,
      tags: [...tags],
    };

    fs.writeFileSync(filePath, JSON.stringify(item), 'utf8');

    // Update tags index
    if (tags.length > 0) {
      const index = this.loadTagsIndex();
      for (const tag of tags) {
        if (!index[tag]) {
          index[tag] = [];
        }
        if (!index[tag].includes(key)) {
          index[tag].push(key);
        }
      }
      this.saveTagsIndex(index);
    }
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    let deleted = false;

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        deleted = true;
      } catch {
        deleted = false;
      }
    }

    // Clean from tags index
    const index = this.loadTagsIndex();
    let modified = false;
    for (const tag of Object.keys(index)) {
      const filtered = index[tag].filter(k => k !== key);
      if (filtered.length !== index[tag].length) {
        index[tag] = filtered;
        modified = true;
      }
      if (index[tag].length === 0) {
        delete index[tag];
        modified = true;
      }
    }

    if (modified) {
      this.saveTagsIndex(index);
    }

    return deleted;
  }

  async invalidateTags(tags: string[]): Promise<number> {
    const index = this.loadTagsIndex();
    const keysToDelete = new Set<string>();

    for (const tag of tags) {
      const keys = index[tag] || [];
      for (const k of keys) {
        keysToDelete.add(k);
      }
    }

    let count = 0;
    for (const k of keysToDelete) {
      if (await this.delete(k)) {
        count++;
      }
    }

    return count;
  }

  async flush(): Promise<void> {
    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            fs.unlinkSync(path.join(this.cacheDir, file));
          } catch {
            // Ignore individual delete failures
          }
        }
      }
    }
  }

  async getStatus(): Promise<{ driver: string; itemCount: number; tagsCount: number }> {
    let itemCount = 0;
    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      itemCount = files.filter(f => f.endsWith('.json') && f !== 'tags_index.json').length;
    }

    const index = this.loadTagsIndex();
    return {
      driver: 'file',
      itemCount,
      tagsCount: Object.keys(index).length,
    };
  }
}
