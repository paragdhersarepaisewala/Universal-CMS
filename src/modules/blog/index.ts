import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';
import { BlogService, BlogPostStatus } from './service.js';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';

const blogRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /blog/posts - Public list published posts
  fastify.get(
    '/posts',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'List published blog posts with pagination and search',
        tags: ['Blog'],
        querystring: Type.Object({
          q: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                title: Type.String(),
                slug: Type.String(),
                excerpt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                readingTimeMinutes: Type.Number(),
                isFeatured: Type.Boolean(),
                isBreaking: Type.Optional(Type.Boolean()),
                publishedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              })
            ),
            meta: Type.Object({
              total: Type.Number(),
              page: Type.Number(),
              perPage: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { q, page = 1, perPage = 10 } = req.query as { q?: string; page?: number; perPage?: number };
      const { data, total } = await BlogService.listPosts({ status: 'published', search: q, page, perPage });
      return reply.send({ data, meta: { total, page, perPage } });
    }
  );

  // 2. GET /blog/posts/:slug - Public single post
  fastify.get(
    '/posts/:slug',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'Get single published blog post by slug',
        tags: ['Blog'],
        params: Type.Object({
          slug: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              title: Type.String(),
              slug: Type.String(),
              excerpt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              content: Type.String(),
              authorName: Type.Optional(Type.String()),
              readingTimeMinutes: Type.Number(),
              isFeatured: Type.Boolean(),
              isBreaking: Type.Optional(Type.Boolean()),
              publishedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            }),
          }),
          404: Type.Object({
            error: Type.Object({ code: Type.String(), message: Type.String() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const post = await BlogService.getPostBySlug(slug);
      if (!post || post.status !== 'published') {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Post '${slug}' not found` },
        });
      }
      return reply.send({ data: post });
    }
  );

  // 3. GET /blog/categories - Public categories
  fastify.get(
    '/categories',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'List blog categories',
        tags: ['Blog'],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                slug: Type.String(),
                description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const cats = await BlogService.listCategories();
      return reply.send({ data: cats });
    }
  );

  // 4. GET /blog/tags - Public tags
  fastify.get(
    '/tags',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'List blog tags',
        tags: ['Blog'],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                slug: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const tags = await BlogService.listTags();
      return reply.send({ data: tags });
    }
  );

  // 5. GET /blog/rss.xml - RSS 2.0 Feed
  fastify.get(
    '/rss.xml',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'RSS 2.0 feed of published articles',
        tags: ['Blog'],
      },
    },
    async (_req, reply) => {
      const xml = await BlogService.generateRssFeed();
      return reply.header('Content-Type', 'application/xml; charset=utf-8').send(xml);
    }
  );

  // 6. GET /blog/news-sitemap.xml - Google News XML sitemap
  fastify.get(
    '/news-sitemap.xml',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'Google News compatible XML sitemap of recent articles',
        tags: ['Blog'],
      },
    },
    async (_req, reply) => {
      const xml = await BlogService.generateNewsSitemap();
      return reply.header('Content-Type', 'application/xml; charset=utf-8').send(xml);
    }
  );

  // 7. GET /blog/posts/:slug/related - Related articles
  fastify.get(
    '/posts/:slug/related',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'Get related articles for a given article',
        tags: ['Blog'],
        params: Type.Object({ slug: Type.String() }),
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const related = await BlogService.getRelatedPosts(slug);
      return reply.send({ data: related });
    }
  );

  // 8. GET /blog/authors - Public authors directory
  fastify.get(
    '/authors',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'List public author profiles with article counts',
        tags: ['Blog'],
      },
    },
    async (_req, reply) => {
      const authors = await BlogService.listAuthors({ onlyPublic: true });
      return reply.send({ data: authors });
    }
  );

  // 9. GET /blog/authors/:slug - Public single author profile
  fastify.get(
    '/authors/:slug',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'Get public author profile by slug',
        tags: ['Blog'],
        params: Type.Object({ slug: Type.String() }),
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const author = await BlogService.getAuthorProfile(slug);
      if (!author || !author.isPublic) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Author '${slug}' not found` },
        });
      }
      return reply.send({ data: author });
    }
  );

  // 10. GET /blog/authors/:slug/posts - Public author published articles
  fastify.get(
    '/authors/:slug/posts',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'Get published articles written by a specific author',
        tags: ['Blog'],
        params: Type.Object({ slug: Type.String() }),
        querystring: Type.Object({
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const { page = 1, perPage = 10 } = req.query as { page?: number; perPage?: number };
      const result = await BlogService.listAuthorPosts(slug, { page, perPage });
      if (!result) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Author '${slug}' not found` },
        });
      }
      return reply.send(result);
    }
  );
};

export const adminBlogRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Admin list posts
  fastify.get(
    '/posts',
    {
      preHandler: [authenticate, requirePermission(['blog.posts.view', 'core.pages.view'])],
      schema: {
        description: 'Admin list all blog posts including drafts and scheduled',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          status: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { status, page = 1, perPage = 20 } = req.query as { status?: string; page?: number; perPage?: number };
      const res = await BlogService.listPosts({
        status: status as BlogPostStatus,
        page,
        perPage,
      });
      return reply.send({ data: res.data, meta: { total: res.total, page, perPage } });
    }
  );

  // Admin create post
  fastify.post(
    '/posts',
    {
      preHandler: [authenticate, requirePermission(['blog.posts.edit', 'core.pages.edit'])],
      schema: {
        description: 'Create a new blog article',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          title: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          excerpt: Type.Optional(Type.String()),
          content: Type.String({ minLength: 1 }),
          status: Type.Optional(Type.String()),
          isFeatured: Type.Optional(Type.Boolean()),
          isBreaking: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as {
        title: string;
        slug: string;
        excerpt?: string;
        content: string;
        status?: BlogPostStatus;
        isFeatured?: boolean;
        isBreaking?: boolean;
      };

      const post = await BlogService.createPost({
        ...body,
        authorId: req.user?.id || 1,
        authorName: req.user?.name || 'Admin',
      });
      return reply.send({ data: post });
    }
  );

  // Admin update post
  fastify.put(
    '/posts/:id',
    {
      preHandler: [authenticate, requirePermission(['blog.posts.edit', 'core.pages.edit'])],
      schema: {
        description: 'Update blog article',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          title: Type.Optional(Type.String()),
          content: Type.Optional(Type.String()),
          status: Type.Optional(Type.String()),
          isFeatured: Type.Optional(Type.Boolean()),
          isBreaking: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as Partial<Parameters<typeof BlogService.updatePost>[1]>;
      const updated = await BlogService.updatePost(id, body);
      if (!updated) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Post not found' } });
      }
      return reply.send({ data: updated });
    }
  );

  // Admin delete post
  fastify.delete(
    '/posts/:id',
    {
      preHandler: [authenticate, requirePermission(['blog.posts.edit', 'core.pages.edit'])],
      schema: {
        description: 'Delete blog article',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      await BlogService.deletePost(id);
      return reply.send({ success: true });
    }
  );

  // Admin editorial status transition
  fastify.post(
    '/posts/:id/transition',
    {
      preHandler: [authenticate, requirePermission(['blog.editorial.review', 'blog.posts.edit', 'core.pages.edit'])],
      schema: {
        description: 'Transition an article through the editorial state machine',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          toStatus: Type.String(),
          notes: Type.Optional(Type.String()),
          scheduledAt: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { toStatus, notes, scheduledAt } = req.body as {
        toStatus: BlogPostStatus;
        notes?: string;
        scheduledAt?: string;
      };

      const result = await BlogService.transitionPostStatus(
        id,
        toStatus,
        {
          id: req.user?.id || 1,
          name: req.user?.name || 'Staff',
          role: req.user?.roleName || 'admin',
        },
        notes,
        scheduledAt
      );

      if (!result.success) {
        const statusCode = result.error?.code === 'NOT_FOUND' ? 404 : 400;
        return reply.status(statusCode).send({ error: result.error });
      }

      return reply.send({
        success: true,
        data: {
          post: result.post,
          transition: result.history,
        },
      });
    }
  );

  // Admin get article editorial audit history
  fastify.get(
    '/posts/:id/history',
    {
      preHandler: [authenticate, requirePermission(['blog.posts.view', 'core.pages.view'])],
      schema: {
        description: 'Get editorial review history and reviewer notes for an article',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const history = await BlogService.getEditorialHistory(id);
      return reply.send({ data: history });
    }
  );

  // Admin list all authors
  fastify.get(
    '/authors',
    {
      preHandler: [authenticate, requirePermission(['blog.authors.view', 'blog.posts.view', 'core.pages.view'])],
      schema: {
        description: 'List all author profiles for administration',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const authors = await BlogService.listAuthors({ onlyPublic: false });
      return reply.send({ data: authors });
    }
  );

  // Admin update or create author profile
  fastify.put(
    '/authors/:userId',
    {
      preHandler: [authenticate, requirePermission(['blog.authors.manage', 'blog.posts.edit', 'core.pages.edit'])],
      schema: {
        description: 'Create or update author profile metadata',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ userId: Type.Number() }),
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          bio: Type.Optional(Type.String()),
          designation: Type.Optional(Type.String()),
          avatarUrl: Type.Optional(Type.String()),
          socialLinks: Type.Optional(Type.Record(Type.String(), Type.String())),
          isPublic: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { userId } = req.params as { userId: number };
      const body = req.body as {
        name: string;
        slug: string;
        bio?: string;
        designation?: string;
        avatarUrl?: string;
        socialLinks?: Record<string, string>;
        isPublic?: boolean;
      };

      const updated = await BlogService.upsertAuthorProfile(userId, body);
      return reply.send({ data: updated });
    }
  );

  // Admin create category
  fastify.post(
    '/categories',
    {
      preHandler: [authenticate, requirePermission(['blog.taxonomy.view', 'core.pages.edit'])],
      schema: {
        description: 'Create blog category',
        tags: ['Admin Blog'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          description: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as { name: string; slug: string; description?: string };
      const cat = await BlogService.createCategory(body);
      return reply.send({ data: cat });
    }
  );
};

export const blogModuleManifest: ModuleManifest = {
  name: 'blog',
  version: '0.1.0',
  description: 'Articles, categories, tags, authors, and RSS feed',
  isCore: false,
  permissions: [
    { key: 'blog.posts.view', description: 'View blog posts' },
    { key: 'blog.posts.edit', description: 'Create and edit blog posts' },
    { key: 'blog.posts.publish', description: 'Publish or schedule approved articles' },
    { key: 'blog.editorial.review', description: 'Review, request changes, or approve articles in editorial workflow' },
    { key: 'blog.authors.view', description: 'View author directory' },
    { key: 'blog.authors.manage', description: 'Manage author profiles and bios' },
    { key: 'blog.taxonomy.view', description: 'View blog categories and tags' },
  ],
  adminNav: [
    {
      id: 'blog-posts',
      label: 'Blog Posts',
      route: '/admin/blog/posts',
      permission: 'blog.posts.view',
      order: 20,
    },
    {
      id: 'blog-authors',
      label: 'Authors',
      route: '/admin/blog/authors',
      permission: 'blog.authors.view',
      order: 21,
    },
    {
      id: 'blog-categories',
      label: 'Categories',
      route: '/admin/blog/categories',
      permission: 'blog.taxonomy.view',
      order: 22,
    },
  ],
  routesPrefix: '/blog',
  routes: blogRoutes,
};
