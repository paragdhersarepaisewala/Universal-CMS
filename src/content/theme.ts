import { db } from '../db/index.js';
import { themeTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { cache, CACHE_TAGS } from '../cache/index.js';

export interface ThemeTokenItem {
  id: number;
  key: string;
  value: string;
  tokenType: string;
  isActive: boolean;
  version: number;
}

const DEFAULT_THEME_TOKENS: Record<string, { value: string; tokenType: string }> = {
  'color.primary': { value: '#0f172a', tokenType: 'color' },
  'color.primary_hover': { value: '#1e293b', tokenType: 'color' },
  'color.accent': { value: '#2563eb', tokenType: 'color' },
  'color.background': { value: '#ffffff', tokenType: 'color' },
  'color.text': { value: '#0f172a', tokenType: 'color' },
  'color.muted': { value: '#64748b', tokenType: 'color' },
  'font.family_sans': { value: "'Inter', sans-serif", tokenType: 'font' },
  'font.family_heading': { value: "'Inter', sans-serif", tokenType: 'font' },
  'layout.radius': { value: '8px', tokenType: 'spacing' },
  'media.logo_url': { value: '/assets/logo.svg', tokenType: 'media' },
  'media.favicon_url': { value: '/favicon.ico', tokenType: 'media' },
};

const inMemoryTokens: ThemeTokenItem[] = Object.entries(DEFAULT_THEME_TOKENS).map(([key, def], idx) => ({
  id: idx + 1,
  key,
  value: def.value,
  tokenType: def.tokenType,
  isActive: true,
  version: 1,
}));

export class ThemeService {
  static async getAllTokens(): Promise<ThemeTokenItem[]> {
    return await cache.getOrSet('theme:all_tokens', async () => {
      try {
        const rows = await db.select().from(themeTokens);
        if (rows.length > 0) {
          return rows.map((r: typeof themeTokens.$inferSelect) => ({
            id: r.id,
            key: r.key,
            value: r.value,
            tokenType: r.tokenType,
            isActive: r.isActive,
            version: r.version,
          }));
        }
      } catch {
        // In-memory fallback
      }
      return inMemoryTokens;
    }, 3600, [CACHE_TAGS.THEME]);
  }

  static async getPublicTheme(): Promise<Record<string, string>> {
    return await cache.getOrSet('theme:public', async () => {
      const tokens = await this.getAllTokens();
      const result: Record<string, string> = {};
      for (const t of tokens) {
        if (t.isActive) {
          result[t.key] = t.value;
        }
      }
      return result;
    }, 3600, [CACHE_TAGS.THEME]);
  }

  static async updateTokens(updates: Record<string, string>): Promise<ThemeTokenItem[]> {
    for (const [key, value] of Object.entries(updates)) {
      const existing = inMemoryTokens.find(t => t.key === key);
      if (existing) {
        existing.value = value;
        existing.version++;
      } else {
        inMemoryTokens.push({
          id: inMemoryTokens.length + 1,
          key,
          value,
          tokenType: 'custom',
          isActive: true,
          version: 1,
        });
      }

      try {
        const rows = await db.select().from(themeTokens).where(eq(themeTokens.key, key)).limit(1);
        if (rows.length > 0) {
          await db
            .update(themeTokens)
            .set({ value, version: rows[0].version + 1, updatedAt: new Date() })
            .where(eq(themeTokens.key, key));
        } else {
          await db.insert(themeTokens).values({
            key,
            value,
            tokenType: 'custom',
            isActive: true,
            version: 1,
          });
        }
      } catch {
        // Fallback
      }
    }

    // Invalidate theme cache
    await cache.invalidateTags([CACHE_TAGS.THEME]);

    return await this.getAllTokens();
  }
}
