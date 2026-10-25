import { db } from '../db/index.js';
import { pages, contentBlocks } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { cache, CACHE_TAGS } from '../cache/index.js';

export interface ContentBlockItem {
  id?: number;
  blockType: string;
  data: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
}

export interface PageItem {
  id: number;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  publishedAt: Date | null;
  version: number;
  blocks?: ContentBlockItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PageMutation {
  title?: string;
  slug?: string;
  status?: 'draft' | 'published' | 'scheduled' | 'archived';
  blocks?: ContentBlockItem[];
  version?: number;
}

let inMemoryPages: PageItem[] = [];
let pageIdCounter = 1;

export class PageService {
  static async listPages(params: { status?: string; page?: number; perPage?: number }): Promise<{
    data: PageItem[];
    meta: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 20));

    try {
      const rows = await db
        .select()
        .from(pages)
        .orderBy(desc(pages.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

      if (rows.length > 0) {
        return {
          data: rows.map((r: typeof pages.$inferSelect) => ({
            id: r.id,
            title: r.title,
            slug: r.slug,
            status: r.status as 'draft' | 'published' | 'scheduled' | 'archived',
            publishedAt: r.publishedAt,
            version: r.version,
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
      // In-memory fallback
    }

    const filtered = params.status
      ? inMemoryPages.filter(p => p.status === params.status)
      : inMemoryPages;

    return {
      data: filtered.slice((page - 1) * perPage, page * perPage),
      meta: {
        page,
        per_page: perPage,
        total: filtered.length,
        total_pages: Math.ceil(filtered.length / perPage) || 1,
      },
    };
  }

  static async getPageById(id: number): Promise<PageItem | null> {
    try {
      const rows = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
      if (rows.length > 0) {
        const r = rows[0];
        const blockRows = await db
          .select()
          .from(contentBlocks)
          .where(eq(contentBlocks.pageId, id))
          .orderBy(contentBlocks.sortOrder);

        return {
          id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status as 'draft' | 'published' | 'scheduled' | 'archived',
          publishedAt: r.publishedAt,
          version: r.version,
          blocks: blockRows.map((b: typeof contentBlocks.$inferSelect) => ({
            id: b.id,
            blockType: b.blockType,
            data: typeof b.data === 'string' ? JSON.parse(b.data) : (b.data as Record<string, unknown>),
            sortOrder: b.sortOrder,
            isActive: b.isActive,
          })),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }
    } catch {
      // In-memory fallback
    }

    const found = inMemoryPages.find(p => p.id === id);
    return found ? { ...found } : null;
  }

  static async getPageBySlug(slug: string): Promise<PageItem | null> {
    return await cache.getOrSet(`page:slug:${slug}`, async () => {
      try {
        const rows = await db.select().from(pages).where(eq(pages.slug, slug)).limit(1);
        if (rows.length > 0) {
          return await this.getPageById(rows[0].id);
        }
      } catch {
        // Fallback
      }

      const found = inMemoryPages.find(p => p.slug === slug);
      return found ? { ...found } : null;
    }, 3600, [CACHE_TAGS.PAGES]);
  }

  static async createPage(data: {
    title: string;
    slug: string;
    status?: 'draft' | 'published' | 'scheduled' | 'archived';
    blocks?: ContentBlockItem[];
  }): Promise<PageItem> {
    const status = data.status || 'draft';
    const publishedAt = status === 'published' ? new Date() : null;
    const pageId = pageIdCounter++;

    const newPage: PageItem = {
      id: pageId,
      title: data.title,
      slug: data.slug,
      status,
      publishedAt,
      version: 1,
      blocks: data.blocks || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    inMemoryPages.push(newPage);

    try {
      await db.insert(pages).values({
        title: data.title,
        slug: data.slug,
        status,
        publishedAt,
        version: 1,
      });

      if (data.blocks && data.blocks.length > 0) {
        for (const block of data.blocks) {
          await db.insert(contentBlocks).values({
            pageId,
            blockType: block.blockType,
            data: JSON.stringify(block.data),
            sortOrder: block.sortOrder,
            isActive: block.isActive,
          });
        }
      }
    } catch {
      // Fallback
    }

    await cache.invalidateTags([CACHE_TAGS.PAGES, CACHE_TAGS.NAVIGATION]);
    return newPage;
  }

  static async updatePage(id: number, updates: PageMutation): Promise<PageItem> {
    const existing = await this.getPageById(id);
    if (!existing) {
      throw new Error('Page not found');
    }

    if (updates.version !== undefined && updates.version !== existing.version) {
      const error = new Error('Version conflict: page has been updated by another administrator.');
      (error as unknown as { statusCode: number; code: string }).statusCode = 409;
      (error as unknown as { statusCode: number; code: string }).code = 'CONFLICT';
      throw error;
    }

    const newVersion = existing.version + 1;
    const newStatus = updates.status || existing.status;
    const publishedAt = newStatus === 'published' && !existing.publishedAt ? new Date() : existing.publishedAt;

    const merged: PageItem = {
      ...existing,
      title: updates.title || existing.title,
      slug: updates.slug || existing.slug,
      status: newStatus,
      publishedAt,
      version: newVersion,
      blocks: updates.blocks !== undefined ? updates.blocks : existing.blocks,
      updatedAt: new Date(),
    };

    const idx = inMemoryPages.findIndex(p => p.id === id);
    if (idx !== -1) {
      inMemoryPages[idx] = merged;
    }

    try {
      await db
        .update(pages)
        .set({
          title: merged.title,
          slug: merged.slug,
          status: merged.status,
          publishedAt: merged.publishedAt,
          version: newVersion,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, id));

      if (updates.blocks !== undefined) {
        await db.delete(contentBlocks).where(eq(contentBlocks.pageId, id));
        for (const b of updates.blocks) {
          await db.insert(contentBlocks).values({
            pageId: id,
            blockType: b.blockType,
            data: JSON.stringify(b.data),
            sortOrder: b.sortOrder,
            isActive: b.isActive,
          });
        }
      }
    } catch {
      // Fallback
    }

    await cache.invalidateTags([CACHE_TAGS.PAGES, CACHE_TAGS.NAVIGATION]);
    return merged;
  }

  static async deletePage(id: number): Promise<boolean> {
    inMemoryPages = inMemoryPages.filter(p => p.id !== id);

    try {
      await db.delete(contentBlocks).where(eq(contentBlocks.pageId, id));
      await db.delete(pages).where(eq(pages.id, id));
    } catch {
      // Fallback
    }

    await cache.invalidateTags([CACHE_TAGS.PAGES, CACHE_TAGS.NAVIGATION]);
    return true;
  }
}
