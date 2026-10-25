import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';

const blogRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    '/posts',
    {
      preHandler: [requireModule('blog')],
      schema: {
        description: 'List blog posts',
        tags: ['Blog'],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                title: Type.String(),
                slug: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      return reply.send({
        data: [
          { id: 1, title: 'Welcome to Universal CMS', slug: 'welcome-to-universal-cms' },
        ],
      });
    }
  );
};

export const blogModuleManifest: ModuleManifest = {
  name: 'blog',
  version: '0.1.0',
  description: 'Articles, categories, tags, and authors',
  isCore: false,
  permissions: [
    { key: 'blog.posts.view', description: 'View blog posts' },
    { key: 'blog.posts.edit', description: 'Create and edit blog posts' },
  ],
  adminNav: [
    {
      id: 'blog-posts',
      label: 'Blog Posts',
      route: '/admin/blog/posts',
      permission: 'blog.posts.view',
      order: 20,
    },
  ],
  routesPrefix: '/blog',
  routes: blogRoutes,
};
