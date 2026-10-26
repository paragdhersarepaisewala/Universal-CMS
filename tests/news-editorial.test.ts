import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as authServiceModule from '../src/auth/service.js';
import { initializeModules, moduleRegistry } from '../src/modules/index.js';

describe('News Portal: Author Profiles and Multi-Stage Editorial Workflow', () => {
  let app: FastifyInstance;

  const mockAdminUser = {
    id: 1,
    name: 'Chief Editor',
    email: 'editor@example.com',
    roleId: 2,
    roleName: 'admin',
    isActive: true,
    emailVerifiedAt: new Date().toISOString(),
    twoFactorEnabled: false,
  };

  beforeAll(async () => {
    initializeModules();
    moduleRegistry.setModuleState('blog', true);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Author Profiles API', () => {
    it('GET /api/v1/blog/authors - lists public authors with article counts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/authors',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      const adminAuthor = body.data.find((a: any) => a.slug === 'admin');
      expect(adminAuthor).toBeDefined();
      expect(adminAuthor.name).toBe('Admin');
      expect(typeof adminAuthor.articleCount).toBe('number');
      expect(adminAuthor.designation).toBeDefined();
    });

    it('GET /api/v1/blog/authors/:slug - retrieves single author profile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/authors/admin',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.slug).toBe('admin');
      expect(body.data.name).toBe('Admin');
      expect(body.data.bio).toContain('Universal CMS');
    });

    it('GET /api/v1/blog/authors/:slug - returns 404 for unknown author', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/authors/non-existent-author-slug',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/blog/authors/:slug/posts - lists published articles by author', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/authors/admin/posts?page=1&perPage=5',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.author).toBeDefined();
      expect(body.author.slug).toBe('admin');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta.page).toBe(1);
      expect(body.meta.perPage).toBe(5);
    });

    it('PUT /api/v1/admin/blog/authors/:userId - admin can create or update author profile', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/blog/authors/2',
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          name: 'Jane Doe',
          slug: 'jane-doe',
          bio: 'Investigative technology journalist and financial markets columnist.',
          designation: 'Senior Tech Correspondent',
          avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2',
          socialLinks: {
            twitter: 'https://twitter.com/janedoe',
            linkedin: 'https://linkedin.com/in/janedoe',
          },
          isPublic: true,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const updateBody = JSON.parse(updateRes.body);
      expect(updateBody.data.userId).toBe(2);
      expect(updateBody.data.name).toBe('Jane Doe');
      expect(updateBody.data.slug).toBe('jane-doe');
      expect(updateBody.data.designation).toBe('Senior Tech Correspondent');

      // Verify publicly accessible
      const publicRes = await app.inject({
        method: 'GET',
        url: '/api/v1/blog/authors/jane-doe',
      });
      expect(publicRes.statusCode).toBe(200);
      const publicBody = JSON.parse(publicRes.body);
      expect(publicBody.data.slug).toBe('jane-doe');
      expect(publicBody.data.bio).toContain('Investigative technology journalist');
    });

    it('GET /api/v1/admin/blog/authors - lists all authors for administration', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/blog/authors',
        headers: { authorization: 'Bearer mock-admin-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      const jane = body.data.find((a: any) => a.slug === 'jane-doe');
      expect(jane).toBeDefined();
    });
  });

  describe('Multi-Stage Editorial Workflow State Machine', () => {
    let createdPostId: number;
    const postSlug = `investigative-scoop-${Date.now()}`;

    it('creates an initial article in draft status', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/blog/posts',
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          title: 'Special Investigation: Modern Web Publishing Architecture',
          slug: postSlug,
          excerpt: 'An in-depth investigation into headless CMS decoupling.',
          content: 'Decoupling the presentation layer from the content repository delivers resilience, security, and performance.',
          status: 'draft',
          isFeatured: true,
          isBreaking: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.id).toBeDefined();
      expect(body.data.status).toBe('draft');
      createdPostId = body.data.id;
    });

    it('transitions draft -> in_review (author submits for editorial review)', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          toStatus: 'in_review',
          notes: 'Submitting completed draft for peer editorial review.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.post.status).toBe('in_review');
      expect(body.data.transition.fromStatus).toBe('draft');
      expect(body.data.transition.toStatus).toBe('in_review');
      expect(body.data.transition.notes).toBe('Submitting completed draft for peer editorial review.');
    });

    it('blocks invalid transitions with 400 and returns allowed transitions list', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      // in_review cannot transition directly to published without approved step
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          toStatus: 'published',
          notes: 'Attempting to skip editorial approval step',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_TRANSITION');
      expect(body.error.message).toContain("Cannot transition from 'in_review' to 'published'");
      expect(body.error.message).toContain('changes_requested');
      expect(body.error.message).toContain('approved');
    });

    it('transitions in_review -> changes_requested (editor requests revisions)', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          toStatus: 'changes_requested',
          notes: 'Please add benchmarks and cite real-world metrics for section 2.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.post.status).toBe('changes_requested');
      expect(body.data.transition.notes).toContain('Please add benchmarks');
    });

    it('transitions changes_requested -> in_review (author resubmits updated draft)', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          toStatus: 'in_review',
          notes: 'Added MySQL EXPLAIN benchmarks and latency metrics as requested.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.post.status).toBe('in_review');
    });

    it('transitions in_review -> approved (editor approves for publication)', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          toStatus: 'approved',
          notes: 'Metrics verified. Article approved for scheduled release.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.post.status).toBe('approved');
    });

    it('transitions approved -> published (publishes article to live site)', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        headers: { authorization: 'Bearer mock-admin-token' },
        payload: {
          toStatus: 'published',
          notes: 'Published to public newsfeed.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.post.status).toBe('published');
      expect(body.data.post.publishedAt).toBeDefined();

      // Verify article is now public
      const publicRes = await app.inject({
        method: 'GET',
        url: `/api/v1/blog/posts/${postSlug}`,
      });
      expect(publicRes.statusCode).toBe(200);
      const publicBody = JSON.parse(publicRes.body);
      expect(publicBody.data.title).toContain('Special Investigation');
    });

    it('GET /api/v1/admin/blog/posts/:id/history - retrieves complete editorial audit trail', async () => {
      vi.spyOn(authServiceModule.authService, 'validateSession').mockResolvedValue(mockAdminUser);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/blog/posts/${createdPostId}/history`,
        headers: { authorization: 'Bearer mock-admin-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(5);

      // Verify transitions are logged in descending order
      expect(body.data[0].toStatus).toBe('published');
      expect(body.data[1].toStatus).toBe('approved');
      expect(body.data[2].toStatus).toBe('in_review');
      expect(body.data[3].toStatus).toBe('changes_requested');
      expect(body.data[4].toStatus).toBe('in_review');

      // Verify audit fields
      for (const item of body.data) {
        expect(item.postId).toBe(createdPostId);
        expect(item.actorId).toBe(mockAdminUser.id);
        expect(item.actorName).toBe(mockAdminUser.name);
        expect(item.createdAt).toBeDefined();
        expect(typeof item.notes).toBe('string');
      }
    });

    it('guards editorial transitions and admin routes with authentication', async () => {
      // Transition without token
      const transRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${createdPostId}/transition`,
        payload: { toStatus: 'archived' },
      });
      expect(transRes.statusCode).toBe(401);

      // History without token
      const histRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/blog/posts/${createdPostId}/history`,
      });
      expect(histRes.statusCode).toBe(401);

      // Authors update without token
      const authorRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/blog/authors/1',
        payload: { name: 'Unauthorized', slug: 'unauthorized' },
      });
      expect(authorRes.statusCode).toBe(401);
    });
  });
});
