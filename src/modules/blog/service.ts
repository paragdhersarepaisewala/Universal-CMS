import { db } from '../../db/index.js';
import { blogPosts, blogCategories, blogTags } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export interface BlogPostRecord {
  id: number;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  authorId: number;
  authorName?: string;
  featuredImageId?: number | null;
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  publishedAt?: string | null;
  readingTimeMinutes: number;
  isFeatured: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlogCategoryRecord {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  parentId?: number | null;
  createdAt: string;
}

export interface BlogTagRecord {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
}

const inMemoryCategories: BlogCategoryRecord[] = [
  { id: 1, name: 'Technology', slug: 'technology', description: 'Tech insights and engineering', createdAt: new Date().toISOString() },
  { id: 2, name: 'Updates', slug: 'updates', description: 'Product releases and announcements', createdAt: new Date().toISOString() },
];

const inMemoryTags: BlogTagRecord[] = [
  { id: 1, name: 'Engineering', slug: 'engineering', createdAt: new Date().toISOString() },
  { id: 2, name: 'CMS', slug: 'cms', createdAt: new Date().toISOString() },
];

const inMemoryPosts: BlogPostRecord[] = [
  {
    id: 1,
    title: 'Welcome to Universal CMS',
    slug: 'welcome-to-universal-cms',
    excerpt: 'Getting started with your modern headless content management system.',
    content: 'Universal CMS is designed from the ground up for high-performance publishing with zero bloat and complete client control.',
    authorId: 1,
    authorName: 'Admin',
    status: 'published',
    publishedAt: new Date().toISOString(),
    readingTimeMinutes: 1,
    isFeatured: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export class BlogService {
  static calculateReadingTime(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  // --- Categories & Tags ---
  static async listCategories(): Promise<BlogCategoryRecord[]> {
    try {
      const rows = await db.select().from(blogCategories);
      if (rows.length > 0) {
        return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }));
      }
    } catch {
      // Fallback
    }
    return inMemoryCategories;
  }

  static async createCategory(data: { name: string; slug: string; description?: string; parentId?: number }): Promise<BlogCategoryRecord> {
    const cat: BlogCategoryRecord = {
      id: inMemoryCategories.length + 1,
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      parentId: data.parentId || null,
      createdAt: new Date().toISOString(),
    };
    try {
      const [res] = await db.insert(blogCategories).values({
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        parentId: cat.parentId,
      });
      cat.id = Number(res.insertId);
    } catch {
      // Fallback
    }
    inMemoryCategories.push(cat);
    return cat;
  }

  static async listTags(): Promise<BlogTagRecord[]> {
    try {
      const rows = await db.select().from(blogTags);
      if (rows.length > 0) {
        return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }));
      }
    } catch {
      // Fallback
    }
    return inMemoryTags;
  }

  static async createTag(data: { name: string; slug: string }): Promise<BlogTagRecord> {
    const tag: BlogTagRecord = {
      id: inMemoryTags.length + 1,
      name: data.name,
      slug: data.slug,
      createdAt: new Date().toISOString(),
    };
    try {
      const [res] = await db.insert(blogTags).values({
        name: tag.name,
        slug: tag.slug,
      });
      tag.id = Number(res.insertId);
    } catch {
      // Fallback
    }
    inMemoryTags.push(tag);
    return tag;
  }

  // --- Posts ---
  static async listPosts(options?: {
    status?: 'draft' | 'published' | 'scheduled' | 'archived';
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ data: BlogPostRecord[]; total: number }> {
    const page = options?.page || 1;
    const perPage = options?.perPage || 10;

    let items = [...inMemoryPosts];

    if (options?.status) {
      items = items.filter(p => p.status === options.status);
    }

    if (options?.search) {
      const q = options.search.toLowerCase();
      items = items.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
    }

    try {
      const query = db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt));
      const rows = await query;
      if (rows.length > 0) {
        items = rows.map(r => ({
          ...r,
          status: r.status as BlogPostRecord['status'],
          publishedAt: r.publishedAt?.toISOString() || null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
        if (options?.status) {
          items = items.filter(p => p.status === options.status);
        }
      }
    } catch {
      // Fallback
    }

    const total = items.length;
    const paginated = items.slice((page - 1) * perPage, page * perPage);

    return { data: paginated, total };
  }

  static async getPostBySlug(slug: string): Promise<BlogPostRecord | null> {
    try {
      const rows = await db.select().from(blogPosts).where(eq(blogPosts.slug, slug));
      if (rows[0]) {
        return {
          ...rows[0],
          status: rows[0].status as BlogPostRecord['status'],
          publishedAt: rows[0].publishedAt?.toISOString() || null,
          createdAt: rows[0].createdAt.toISOString(),
          updatedAt: rows[0].updatedAt.toISOString(),
        };
      }
    } catch {
      // Fallback
    }
    return inMemoryPosts.find(p => p.slug === slug) || null;
  }

  static async createPost(data: {
    title: string;
    slug: string;
    excerpt?: string;
    content: string;
    authorId: number;
    authorName?: string;
    featuredImageId?: number;
    status?: 'draft' | 'published' | 'scheduled' | 'archived';
    publishedAt?: string;
    isFeatured?: boolean;
  }): Promise<BlogPostRecord> {
    const readingTime = this.calculateReadingTime(data.content);
    const status = data.status || 'draft';
    const publishedAt = status === 'published' ? (data.publishedAt || new Date().toISOString()) : (data.publishedAt || null);

    const post: BlogPostRecord = {
      id: inMemoryPosts.length + 1,
      title: data.title,
      slug: data.slug,
      excerpt: data.excerpt || null,
      content: data.content,
      authorId: data.authorId,
      authorName: data.authorName || 'Author',
      featuredImageId: data.featuredImageId || null,
      status,
      publishedAt,
      readingTimeMinutes: readingTime,
      isFeatured: data.isFeatured || false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const [res] = await db.insert(blogPosts).values({
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        authorId: post.authorId,
        featuredImageId: post.featuredImageId,
        status: post.status,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        readingTimeMinutes: post.readingTimeMinutes,
        isFeatured: post.isFeatured,
        version: 1,
      });
      post.id = Number(res.insertId);
    } catch {
      // Fallback
    }

    inMemoryPosts.push(post);
    return post;
  }

  static async updatePost(id: number, data: Partial<BlogPostRecord>): Promise<BlogPostRecord | null> {
    const post = inMemoryPosts.find(p => p.id === id);
    if (!post) return null;

    if (data.content) {
      data.readingTimeMinutes = this.calculateReadingTime(data.content);
    }
    if (data.status === 'published' && !post.publishedAt) {
      data.publishedAt = new Date().toISOString();
    }

    Object.assign(post, data, { updatedAt: new Date().toISOString(), version: post.version + 1 });

    try {
      const rest = { ...data };
      delete rest.createdAt;
      delete rest.updatedAt;
      await db.update(blogPosts).set({
        ...(rest as Record<string, unknown>),
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
        version: post.version,
      }).where(eq(blogPosts.id, id));
    } catch {
      // Fallback
    }

    return post;
  }

  static async deletePost(id: number): Promise<boolean> {
    const idx = inMemoryPosts.findIndex(p => p.id === id);
    if (idx !== -1) inMemoryPosts.splice(idx, 1);
    try {
      await db.delete(blogPosts).where(eq(blogPosts.id, id));
    } catch {
      // Fallback
    }
    return true;
  }

  static async generateRssFeed(siteTitle: string = 'Universal CMS Blog', siteUrl: string = 'http://localhost:3000'): Promise<string> {
    const { data: posts } = await this.listPosts({ status: 'published' });

    const itemsXml = posts.map(p => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${siteUrl}/blog/${p.slug}</link>
      <guid>${siteUrl}/blog/${p.slug}</guid>
      <pubDate>${p.publishedAt ? new Date(p.publishedAt).toUTCString() : new Date().toUTCString()}</pubDate>
      <description><![CDATA[${p.excerpt || p.content.slice(0, 200)}]]></description>
    </item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${siteTitle}</title>
    <link>${siteUrl}/blog</link>
    <description>Latest articles and publications</description>
    <language>en-us</language>
    ${itemsXml}
  </channel>
</rss>`;
  }
}
