import { db } from '../../db/index.js';
import { blogPosts, blogCategories, blogTags, authorProfiles, blogEditorialHistory } from '../../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';

export type BlogPostStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'scheduled' | 'archived';

export interface BlogPostRecord {
  id: number;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  authorId: number;
  authorName?: string;
  featuredImageId?: number | null;
  status: BlogPostStatus;
  publishedAt?: string | null;
  readingTimeMinutes: number;
  isFeatured: boolean;
  isBreaking?: boolean;
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

export interface AuthorProfileRecord {
  id: number;
  userId: number;
  name: string;
  slug: string;
  bio?: string | null;
  designation?: string | null;
  avatarUrl?: string | null;
  socialLinks?: Record<string, string> | null;
  isPublic: boolean;
  articleCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EditorialHistoryRecord {
  id: number;
  postId: number;
  fromStatus: string;
  toStatus: string;
  actorId: number;
  actorName?: string | null;
  notes?: string | null;
  createdAt: string;
}

export const EDITORIAL_STATUS_TRANSITIONS: Record<BlogPostStatus, BlogPostStatus[]> = {
  draft: ['in_review', 'archived'],
  in_review: ['changes_requested', 'approved', 'draft'],
  changes_requested: ['in_review', 'draft'],
  approved: ['published', 'scheduled', 'draft'],
  published: ['archived', 'draft'],
  scheduled: ['published', 'draft'],
  archived: ['draft'],
};

const inMemoryCategories: BlogCategoryRecord[] = [
  { id: 1, name: 'Technology', slug: 'technology', description: 'Tech insights and engineering', createdAt: new Date().toISOString() },
  { id: 2, name: 'Updates', slug: 'updates', description: 'Product releases and announcements', createdAt: new Date().toISOString() },
];

const inMemoryTags: BlogTagRecord[] = [
  { id: 1, name: 'Engineering', slug: 'engineering', createdAt: new Date().toISOString() },
  { id: 2, name: 'CMS', slug: 'cms', createdAt: new Date().toISOString() },
];

const inMemoryAuthors: AuthorProfileRecord[] = [
  {
    id: 1,
    userId: 1,
    name: 'Admin',
    slug: 'admin',
    bio: 'Lead Architect and Editor at Universal CMS',
    designation: 'Editor-in-Chief',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    socialLinks: { twitter: 'https://twitter.com/universalcms', linkedin: 'https://linkedin.com/company/universalcms' },
    isPublic: true,
    articleCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const inMemoryEditorialHistory: EditorialHistoryRecord[] = [];

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
    isBreaking: false,
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
    status?: BlogPostStatus;
    search?: string;
    authorId?: number;
    page?: number;
    perPage?: number;
  }): Promise<{ data: BlogPostRecord[]; total: number }> {
    const page = options?.page || 1;
    const perPage = options?.perPage || 10;

    let items = [...inMemoryPosts];

    if (options?.status) {
      items = items.filter(p => p.status === options.status);
    }

    if (options?.authorId) {
      items = items.filter(p => p.authorId === options.authorId);
    }

    if (options?.search) {
      const q = options.search.toLowerCase();
      items = items.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
    }

    try {
      const rows = await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt));
      if (rows.length > 0) {
        const dbItems = rows.map(r => ({
          ...r,
          status: r.status as BlogPostStatus,
          publishedAt: r.publishedAt?.toISOString() || null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
        const dbSlugs = new Set(dbItems.map(d => d.slug));
        const defaultSeeds = inMemoryPosts.filter(p => !dbSlugs.has(p.slug));
        items = [...dbItems, ...defaultSeeds];

        if (options?.status) {
          items = items.filter(p => p.status === options.status);
        }
        if (options?.authorId) {
          items = items.filter(p => p.authorId === options.authorId);
        }
        if (options?.search) {
          const q = options.search.toLowerCase();
          items = items.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
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
          status: rows[0].status as BlogPostStatus,
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

  static async getPostById(id: number): Promise<BlogPostRecord | null> {
    try {
      const rows = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
      if (rows[0]) {
        return {
          ...rows[0],
          status: rows[0].status as BlogPostStatus,
          publishedAt: rows[0].publishedAt?.toISOString() || null,
          createdAt: rows[0].createdAt.toISOString(),
          updatedAt: rows[0].updatedAt.toISOString(),
        };
      }
    } catch {
      // Fallback
    }
    return inMemoryPosts.find(p => p.id === id) || null;
  }

  static async createPost(data: {
    title: string;
    slug: string;
    excerpt?: string;
    content: string;
    authorId: number;
    authorName?: string;
    featuredImageId?: number;
    status?: BlogPostStatus;
    publishedAt?: string;
    isFeatured?: boolean;
    isBreaking?: boolean;
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
      isBreaking: data.isBreaking || false,
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
    if (!post) {
      const dbPost = await this.getPostById(id);
      if (!dbPost) return null;
      inMemoryPosts.push(dbPost);
    }
    const target = inMemoryPosts.find(p => p.id === id)!;

    if (data.content) {
      data.readingTimeMinutes = this.calculateReadingTime(data.content);
    }
    if (data.status === 'published' && !target.publishedAt) {
      data.publishedAt = new Date().toISOString();
    }

    Object.assign(target, data, { updatedAt: new Date().toISOString(), version: target.version + 1 });

    try {
      const rest = { ...data };
      delete rest.createdAt;
      delete rest.updatedAt;
      await db.update(blogPosts).set({
        ...(rest as Record<string, unknown>),
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
        version: target.version,
      }).where(eq(blogPosts.id, id));
    } catch {
      // Fallback
    }

    return target;
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

  // --- Author Profiles ---
  static async listAuthors(options?: { onlyPublic?: boolean }): Promise<AuthorProfileRecord[]> {
    const onlyPublic = options?.onlyPublic !== false;
    let profiles: AuthorProfileRecord[] = [];

    try {
      const rows = await db.select().from(authorProfiles);
      if (rows.length > 0) {
        profiles = rows.map(r => ({
          id: r.id,
          userId: r.userId,
          name: r.name,
          slug: r.slug,
          bio: r.bio,
          designation: r.designation,
          avatarUrl: r.avatarUrl,
          socialLinks: (r.socialLinks as Record<string, string>) || null,
          isPublic: r.isPublic,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
      }
    } catch {
      // Fallback
    }

    const dbSlugs = new Set(profiles.map(p => p.slug));
    const defaultSeeds = inMemoryAuthors.filter(a => !dbSlugs.has(a.slug));
    profiles = [...profiles, ...defaultSeeds];

    if (onlyPublic) {
      profiles = profiles.filter(p => p.isPublic);
    }

    // Attach published article count
    const { data: publishedPosts } = await this.listPosts({ status: 'published', perPage: 1000 });
    for (const author of profiles) {
      author.articleCount = publishedPosts.filter(p => p.authorId === author.userId).length;
    }

    return profiles;
  }

  static async getAuthorProfile(slugOrUserId: string | number): Promise<AuthorProfileRecord | null> {
    let author: AuthorProfileRecord | null = null;

    try {
      if (typeof slugOrUserId === 'number') {
        const rows = await db.select().from(authorProfiles).where(eq(authorProfiles.userId, slugOrUserId));
        if (rows[0]) {
          author = {
            id: rows[0].id,
            userId: rows[0].userId,
            name: rows[0].name,
            slug: rows[0].slug,
            bio: rows[0].bio,
            designation: rows[0].designation,
            avatarUrl: rows[0].avatarUrl,
            socialLinks: (rows[0].socialLinks as Record<string, string>) || null,
            isPublic: rows[0].isPublic,
            createdAt: rows[0].createdAt.toISOString(),
            updatedAt: rows[0].updatedAt.toISOString(),
          };
        }
      } else {
        const rows = await db.select().from(authorProfiles).where(eq(authorProfiles.slug, slugOrUserId));
        if (rows[0]) {
          author = {
            id: rows[0].id,
            userId: rows[0].userId,
            name: rows[0].name,
            slug: rows[0].slug,
            bio: rows[0].bio,
            designation: rows[0].designation,
            avatarUrl: rows[0].avatarUrl,
            socialLinks: (rows[0].socialLinks as Record<string, string>) || null,
            isPublic: rows[0].isPublic,
            createdAt: rows[0].createdAt.toISOString(),
            updatedAt: rows[0].updatedAt.toISOString(),
          };
        }
      }
    } catch {
      // Fallback
    }

    if (!author) {
      if (typeof slugOrUserId === 'number') {
        author = inMemoryAuthors.find(a => a.userId === slugOrUserId) || null;
      } else {
        author = inMemoryAuthors.find(a => a.slug === slugOrUserId) || null;
      }
    }

    if (author) {
      const { data: publishedPosts } = await this.listPosts({ status: 'published', perPage: 1000 });
      author.articleCount = publishedPosts.filter(p => p.authorId === author!.userId).length;
    }

    return author;
  }

  static async upsertAuthorProfile(userId: number, data: {
    name: string;
    slug: string;
    bio?: string | null;
    designation?: string | null;
    avatarUrl?: string | null;
    socialLinks?: Record<string, string> | null;
    isPublic?: boolean;
  }): Promise<AuthorProfileRecord> {
    const existing = await this.getAuthorProfile(userId);
    const now = new Date().toISOString();

    if (existing) {
      const updated: AuthorProfileRecord = {
        ...existing,
        name: data.name,
        slug: data.slug,
        bio: data.bio ?? existing.bio,
        designation: data.designation ?? existing.designation,
        avatarUrl: data.avatarUrl ?? existing.avatarUrl,
        socialLinks: data.socialLinks ?? existing.socialLinks,
        isPublic: data.isPublic ?? existing.isPublic,
        updatedAt: now,
      };

      try {
        await db.update(authorProfiles).set({
          name: updated.name,
          slug: updated.slug,
          bio: updated.bio,
          designation: updated.designation,
          avatarUrl: updated.avatarUrl,
          socialLinks: updated.socialLinks,
          isPublic: updated.isPublic,
        }).where(eq(authorProfiles.userId, userId));
      } catch {
        // Fallback
      }

      const inMemIdx = inMemoryAuthors.findIndex(a => a.userId === userId);
      if (inMemIdx !== -1) inMemoryAuthors[inMemIdx] = updated;
      return updated;
    }

    const created: AuthorProfileRecord = {
      id: inMemoryAuthors.length + 1,
      userId,
      name: data.name,
      slug: data.slug,
      bio: data.bio || null,
      designation: data.designation || null,
      avatarUrl: data.avatarUrl || null,
      socialLinks: data.socialLinks || null,
      isPublic: data.isPublic ?? true,
      articleCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const [res] = await db.insert(authorProfiles).values({
        userId,
        name: created.name,
        slug: created.slug,
        bio: created.bio,
        designation: created.designation,
        avatarUrl: created.avatarUrl,
        socialLinks: created.socialLinks,
        isPublic: created.isPublic,
      });
      created.id = Number(res.insertId);
    } catch {
      // Fallback
    }

    inMemoryAuthors.push(created);
    return created;
  }

  static async listAuthorPosts(slug: string, options?: { page?: number; perPage?: number }): Promise<{
    author: AuthorProfileRecord;
    data: BlogPostRecord[];
    meta: { total: number; page: number; perPage: number };
  } | null> {
    const author = await this.getAuthorProfile(slug);
    if (!author || (!author.isPublic && options?.perPage !== -1)) {
      return null;
    }

    const page = options?.page || 1;
    const perPage = options?.perPage || 10;

    const { data: posts, total } = await this.listPosts({
      status: 'published',
      authorId: author.userId,
      page,
      perPage,
    });

    return {
      author,
      data: posts,
      meta: { total, page, perPage },
    };
  }

  // --- Multi-stage Editorial Workflow ---
  static async transitionPostStatus(
    postId: number,
    toStatus: BlogPostStatus,
    actor: { id: number; name?: string; role?: string },
    notes?: string,
    scheduledAt?: string
  ): Promise<{
    success: boolean;
    error?: { code: string; message: string };
    post?: BlogPostRecord;
    history?: EditorialHistoryRecord;
  }> {
    const post = await this.getPostById(postId);
    if (!post) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Post with ID ${postId} not found` },
      };
    }

    if (post.status === toStatus) {
      return {
        success: false,
        error: { code: 'NO_CHANGE', message: `Post is already in status '${toStatus}'` },
      };
    }

    const allowed = EDITORIAL_STATUS_TRANSITIONS[post.status] || [];
    if (!allowed.includes(toStatus)) {
      return {
        success: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `Cannot transition from '${post.status}' to '${toStatus}'. Allowed transitions: ${allowed.join(', ') || 'none'}`,
        },
      };
    }

    const updates: Partial<BlogPostRecord> = { status: toStatus };
    if (toStatus === 'published') {
      updates.publishedAt = post.publishedAt || new Date().toISOString();
    } else if (toStatus === 'scheduled') {
      updates.publishedAt = scheduledAt || new Date(Date.now() + 86400000).toISOString();
    }

    const updatedPost = await this.updatePost(postId, updates);
    if (!updatedPost) {
      return {
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update post status' },
      };
    }

    const historyRecord: EditorialHistoryRecord = {
      id: inMemoryEditorialHistory.length + 1,
      postId,
      fromStatus: post.status,
      toStatus,
      actorId: actor.id,
      actorName: actor.name || 'Staff',
      notes: notes || null,
      createdAt: new Date().toISOString(),
    };

    try {
      const [res] = await db.insert(blogEditorialHistory).values({
        postId,
        fromStatus: post.status,
        toStatus,
        actorId: actor.id,
        actorName: actor.name || 'Staff',
        notes: notes || null,
      });
      historyRecord.id = Number(res.insertId);
    } catch {
      // Fallback
    }

    inMemoryEditorialHistory.unshift(historyRecord);

    return {
      success: true,
      post: updatedPost,
      history: historyRecord,
    };
  }

  static async getEditorialHistory(postId: number): Promise<EditorialHistoryRecord[]> {
    try {
      const rows = await db.select().from(blogEditorialHistory)
        .where(eq(blogEditorialHistory.postId, postId))
        .orderBy(desc(blogEditorialHistory.createdAt));

      if (rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          postId: r.postId,
          fromStatus: r.fromStatus,
          toStatus: r.toStatus,
          actorId: r.actorId,
          actorName: r.actorName,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch {
      // Fallback
    }

    return inMemoryEditorialHistory.filter(h => h.postId === postId);
  }

  // --- RSS & Sitemaps ---
  static async generateRssFeed(siteTitle: string = 'Universal CMS Blog', siteUrl: string = 'http://localhost:3000'): Promise<string> {
    const { data: posts } = await this.listPosts({ status: 'published', perPage: 100 });

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

  static async generateNewsSitemap(siteName: string = 'Universal CMS News', siteUrl: string = 'http://localhost:3000'): Promise<string> {
    const { data: posts } = await this.listPosts({ status: 'published', perPage: 100 });

    const itemsXml = posts.map(p => `
    <url>
      <loc>${siteUrl}/blog/${p.slug}</loc>
      <news:news>
        <news:publication>
          <news:name>${siteName}</news:name>
          <news:language>en</news:language>
        </news:publication>
        <news:publication_date>${p.publishedAt ? new Date(p.publishedAt).toISOString() : new Date().toISOString()}</news:publication_date>
        <news:title><![CDATA[${p.title}]]></news:title>
      </news:news>
    </url>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  ${itemsXml}
</urlset>`;
  }

  static async getRelatedPosts(currentSlug: string, limit: number = 3): Promise<BlogPostRecord[]> {
    const { data: posts } = await this.listPosts({ status: 'published' });
    return posts.filter(p => p.slug !== currentSlug).slice(0, limit);
  }
}
