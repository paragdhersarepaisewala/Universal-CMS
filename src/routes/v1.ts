import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.js';
import { authRoutes } from './auth.js';
import { publicEmailRoutes } from './email.js';
import { publicContentRoutes } from './content.js';
import { adminModulesRoutes } from './admin/modules.js';
import { adminRbacRoutes } from './admin/rbac.js';
import { adminEmailRoutes } from './admin/email.js';
import { adminCacheRoutes } from './admin/cache.js';
import { adminPagesRoutes } from './admin/pages.js';
import { adminMenusRoutes } from './admin/menus.js';
import { adminThemeRoutes } from './admin/theme.js';
import { adminMediaRoutes } from './admin/media.js';
import { adminSeoRoutes } from './admin/seo.js';
import { adminRedirectsRoutes } from './admin/redirects.js';
import { adminLegalRoutes } from './admin/legal.js';
import { adminSettingsRoutes } from './admin/settings.js';
import { adminAuditRoutes } from './admin/audit.js';
import { adminTokensRoutes } from './admin/tokens.js';
import { adminWebhooksRoutes } from './admin/webhooks.js';
import { adminFormsRoutes } from './admin/forms.js';
import { adminBannersRoutes } from './admin/banners.js';
import { publicAdSlotsRoutes, adminAdSlotsRoutes } from './admin/ad-slots.js';
import { jobsRoutes } from './jobs.js';
import { blogModuleManifest } from '../modules/blog/index.js';
import { storeModuleManifest } from '../modules/store/index.js';

export const v1Routes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // System health
  await fastify.register(healthRoutes);

  // Authentication & accounts
  await fastify.register(authRoutes, { prefix: '/auth' });

  // Public email endpoints (unsubscribe)
  await fastify.register(publicEmailRoutes, { prefix: '/email' });

  // Background jobs runner (cron trigger)
  await fastify.register(jobsRoutes, { prefix: '/jobs' });

  // Public content endpoints (theme, pages, menus, sitemap, robots, redirects, cookie consent, forms, banners)
  await fastify.register(publicContentRoutes);

  // Admin routes
  await fastify.register(adminModulesRoutes, { prefix: '/admin' });
  await fastify.register(adminRbacRoutes, { prefix: '/admin' });
  await fastify.register(adminEmailRoutes, { prefix: '/admin/email' });
  await fastify.register(adminCacheRoutes, { prefix: '/admin/cache' });
  await fastify.register(adminPagesRoutes, { prefix: '/admin/pages' });
  await fastify.register(adminMenusRoutes, { prefix: '/admin/menus' });
  await fastify.register(adminThemeRoutes, { prefix: '/admin/theme' });
  await fastify.register(adminMediaRoutes, { prefix: '/admin/media' });
  await fastify.register(adminSeoRoutes, { prefix: '/admin/seo' });
  await fastify.register(adminRedirectsRoutes, { prefix: '/admin/redirects' });
  await fastify.register(adminLegalRoutes, { prefix: '/admin/legal' });
  await fastify.register(adminSettingsRoutes, { prefix: '/admin/settings' });
  await fastify.register(adminAuditRoutes, { prefix: '/admin/logs/audit' });
  await fastify.register(adminTokensRoutes, { prefix: '/admin/tokens' });
  await fastify.register(adminWebhooksRoutes, { prefix: '/admin/webhooks' });
  await fastify.register(adminFormsRoutes, { prefix: '/admin/forms' });
  await fastify.register(adminBannersRoutes, { prefix: '/admin/banners' });
  await fastify.register(adminAdSlotsRoutes, { prefix: '/admin/ad-slots' });

  // Public ad slots
  await fastify.register(publicAdSlotsRoutes, { prefix: '/ad-slots' });

  // Optional module routes
  if (blogModuleManifest.routes) {
    await fastify.register(blogModuleManifest.routes, { prefix: blogModuleManifest.routesPrefix });
    const { adminBlogRoutes } = await import('../modules/blog/index.js');
    await fastify.register(adminBlogRoutes, { prefix: '/admin/blog' });
  }

  if (storeModuleManifest.routes) {
    await fastify.register(storeModuleManifest.routes, { prefix: storeModuleManifest.routesPrefix });
    const { adminStoreRoutes } = await import('../modules/store/index.js');
    await fastify.register(adminStoreRoutes, { prefix: '/admin/store' });
  }

  const { donationModuleManifest, adminDonationRoutes } = await import('../modules/donations/index.js');
  if (donationModuleManifest.routes) {
    await fastify.register(donationModuleManifest.routes, { prefix: donationModuleManifest.routesPrefix });
    await fastify.register(adminDonationRoutes, { prefix: '/admin/donations' });
  }
};

