import { db } from '../db/index.js';
import { redirects } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { cache } from '../cache/index.js';

export interface RedirectItem {
  id: number;
  sourcePath: string;
  targetPath: string;
  statusCode: number;
  isActive: boolean;
  hitCount: number;
  createdAt: Date;
  updatedAt: Date;
}

let inMemoryRedirects: RedirectItem[] = [
  {
    id: 1,
    sourcePath: '/old-about-us',
    targetPath: '/about',
    statusCode: 301,
    isActive: true,
    hitCount: 12,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
let redirectIdCounter = 2;

export class RedirectService {
  static async listRedirects(params: { page?: number; perPage?: number }): Promise<{
    data: RedirectItem[];
    meta: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 20));

    try {
      const rows = await db
        .select()
        .from(redirects)
        .orderBy(desc(redirects.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

      if (rows.length > 0) {
        return {
          data: rows.map((r: typeof redirects.$inferSelect) => ({
            id: r.id,
            sourcePath: r.sourcePath,
            targetPath: r.targetPath,
            statusCode: r.statusCode,
            isActive: r.isActive,
            hitCount: r.hitCount,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
          meta: {
            page,
            per_page: perPage,
            total: rows.length,
            total_pages: Math.ceil(rows.length / perPage) || 1,
          },
        };
      }
    } catch {
      // Fallback
    }

    return {
      data: inMemoryRedirects.slice((page - 1) * perPage, page * perPage),
      meta: {
        page,
        per_page: perPage,
        total: inMemoryRedirects.length,
        total_pages: Math.ceil(inMemoryRedirects.length / perPage) || 1,
      },
    };
  }

  static async resolve(pathStr: string): Promise<RedirectItem | null> {
    const normalized = pathStr.startsWith('/') ? pathStr : `/${pathStr}`;

    try {
      const rows = await db
        .select()
        .from(redirects)
        .where(eq(redirects.sourcePath, normalized))
        .limit(1);

      if (rows.length > 0 && rows[0].isActive) {
        const r = rows[0];
        // Increment hit count asynchronously
        db.update(redirects)
          .set({ hitCount: r.hitCount + 1 })
          .where(eq(redirects.id, r.id))
          .catch(() => {});

        return {
          id: r.id,
          sourcePath: r.sourcePath,
          targetPath: r.targetPath,
          statusCode: r.statusCode,
          isActive: r.isActive,
          hitCount: r.hitCount + 1,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }
    } catch {
      // Fallback
    }

    const found = inMemoryRedirects.find(r => r.sourcePath === normalized && r.isActive);
    if (found) {
      found.hitCount++;
      return { ...found };
    }

    return null;
  }

  static async createRedirect(data: {
    sourcePath: string;
    targetPath: string;
    statusCode?: number;
    isActive?: boolean;
  }): Promise<RedirectItem> {
    const source = data.sourcePath.startsWith('/') ? data.sourcePath : `/${data.sourcePath}`;
    const target = data.targetPath;
    if (source.toLowerCase() === target.toLowerCase()) {
      throw new Error('Self-referential redirect detected: source path and target path cannot be identical.');
    }

    const created: RedirectItem = {
      id: redirectIdCounter++,
      sourcePath: source,
      targetPath: target,
      statusCode: data.statusCode || 301,
      isActive: data.isActive !== undefined ? data.isActive : true,
      hitCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    inMemoryRedirects.unshift(created);

    try {
      await db.insert(redirects).values({
        sourcePath: created.sourcePath,
        targetPath: created.targetPath,
        statusCode: created.statusCode,
        isActive: created.isActive,
        hitCount: 0,
      });
    } catch {
      // Fallback
    }

    await cache.invalidateTags(['redirects']);
    return created;
  }

  static async updateRedirect(
    id: number,
    data: { sourcePath?: string; targetPath?: string; statusCode?: number; isActive?: boolean }
  ): Promise<RedirectItem> {
    const idx = inMemoryRedirects.findIndex(r => r.id === id);
    if (idx === -1) {
      throw new Error('Redirect not found');
    }

    const updated: RedirectItem = {
      ...inMemoryRedirects[idx],
      ...data,
      updatedAt: new Date(),
    };
    inMemoryRedirects[idx] = updated;

    try {
      await db
        .update(redirects)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(redirects.id, id));
    } catch {
      // Fallback
    }

    await cache.invalidateTags(['redirects']);
    return updated;
  }

  static async deleteRedirect(id: number): Promise<boolean> {
    inMemoryRedirects = inMemoryRedirects.filter(r => r.id !== id);
    try {
      await db.delete(redirects).where(eq(redirects.id, id));
    } catch {
      // Fallback
    }
    await cache.invalidateTags(['redirects']);
    return true;
  }
}
