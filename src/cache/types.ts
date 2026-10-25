export interface CacheItem<T = unknown> {
  value: T;
  expiresAt: number | null; // null means no expiration
  tags: string[];
}

export interface CacheDriver {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number, tags?: string[]): Promise<void>;
  delete(key: string): Promise<boolean>;
  invalidateTags(tags: string[]): Promise<number>;
  flush(): Promise<void>;
  getStatus(): Promise<{ driver: string; itemCount: number; tagsCount: number }>;
}

export interface CachePurgeOptions {
  tags?: string[];
  key?: string;
  all?: boolean;
}
