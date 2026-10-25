import { db } from '../db/index.js';
import { seoMeta, pages, settings } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { cache } from '../cache/index.js';

export interface SeoMetadata {
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  robots?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageId?: number | null;
  twitterCard?: string;
}

export interface GlobalSeoSettings {
  defaultTitle: string;
  titleTemplate: string;
  defaultDescription: string;
  defaultRobots: string;
  googleAnalyticsId?: string;
  metaPixelId?: string;
  headerScripts?: string;
  footerScripts?: string;
  robotsTxt: string;
}

const DEFAULT_GLOBAL_SEO: GlobalSeoSettings = {
  defaultTitle: 'Universal CMS',
  titleTemplate: '%s | Universal CMS',
  defaultDescription: 'Modern headless CMS built for performance, security, and high reliability.',
  defaultRobots: 'index, follow',
  robotsTxt: `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: http://localhost:3000/api/v1/sitemap.xml`,
};

let cachedGlobalSeo = { ...DEFAULT_GLOBAL_SEO };

export class SeoService {
  static async getGlobalSeo(): Promise<GlobalSeoSettings> {
    try {
      const rows = await db.select().from(settings).where(eq(settings.key, 'seo_global')).limit(1);
      if (rows.length > 0 && rows[0].value) {
        const stored = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
        return { ...DEFAULT_GLOBAL_SEO, ...stored };
      }
    } catch {
      // Fallback
    }
    return cachedGlobalSeo;
  }

  static async updateGlobalSeo(updates: Partial<GlobalSeoSettings>): Promise<GlobalSeoSettings> {
    cachedGlobalSeo = { ...cachedGlobalSeo, ...updates };

    try {
      const existing = await db.select().from(settings).where(eq(settings.key, 'seo_global')).limit(1);
      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(cachedGlobalSeo), updatedAt: new Date() })
          .where(eq(settings.key, 'seo_global'));
      } else {
        await db.insert(settings).values({
          key: 'seo_global',
          value: JSON.stringify(cachedGlobalSeo),
          group: 'seo',
          isPublic: true,
        });
      }
    } catch {
      // Fallback
    }

    await cache.invalidateTags(['seo', 'pages']);
    return cachedGlobalSeo;
  }

  static async getEntitySeo(entityType: string, entityId: string): Promise<SeoMetadata> {
    try {
      const rows = await db
        .select()
        .from(seoMeta)
        .where(and(eq(seoMeta.entityType, entityType), eq(seoMeta.entityId, entityId)))
        .limit(1);

      if (rows.length > 0) {
        const r = rows[0];
        return {
          metaTitle: r.metaTitle || undefined,
          metaDescription: r.metaDescription || undefined,
          canonicalUrl: r.canonicalUrl || undefined,
          robots: r.robots,
          ogTitle: r.ogTitle || undefined,
          ogDescription: r.ogDescription || undefined,
          ogImageId: r.ogImageId,
          twitterCard: r.twitterCard || undefined,
        };
      }
    } catch {
      // Fallback
    }

    const globalSeo = await this.getGlobalSeo();
    return {
      metaTitle: globalSeo.defaultTitle,
      metaDescription: globalSeo.defaultDescription,
      robots: globalSeo.defaultRobots,
    };
  }

  static async setEntitySeo(entityType: string, entityId: string, data: SeoMetadata): Promise<SeoMetadata> {
    try {
      const existing = await db
        .select()
        .from(seoMeta)
        .where(and(eq(seoMeta.entityType, entityType), eq(seoMeta.entityId, entityId)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(seoMeta)
          .set({
            metaTitle: data.metaTitle,
            metaDescription: data.metaDescription,
            canonicalUrl: data.canonicalUrl,
            robots: data.robots || 'index, follow',
            ogTitle: data.ogTitle,
            ogDescription: data.ogDescription,
            ogImageId: data.ogImageId,
            twitterCard: data.twitterCard || 'summary_large_image',
            updatedAt: new Date(),
          })
          .where(and(eq(seoMeta.entityType, entityType), eq(seoMeta.entityId, entityId)));
      } else {
        await db.insert(seoMeta).values({
          entityType,
          entityId,
          metaTitle: data.metaTitle,
          metaDescription: data.metaDescription,
          canonicalUrl: data.canonicalUrl,
          robots: data.robots || 'index, follow',
          ogTitle: data.ogTitle,
          ogDescription: data.ogDescription,
          ogImageId: data.ogImageId,
          twitterCard: data.twitterCard || 'summary_large_image',
        });
      }
    } catch {
      // Fallback
    }

    await cache.invalidateTags(['seo', 'pages']);
    return data;
  }

  static async generateSitemapXml(baseUrl = 'http://localhost:3000'): Promise<string> {
    const urls: Array<{ loc: string; lastmod: string; changefreq: string; priority: string }> = [
      { loc: `${baseUrl}/`, lastmod: new Date().toISOString().split('T')[0], changefreq: 'daily', priority: '1.0' },
    ];

    try {
      const publishedPages = await db.select().from(pages).where(eq(pages.status, 'published'));
      for (const p of publishedPages) {
        urls.push({
          loc: `${baseUrl}/${p.slug}`,
          lastmod: (p.updatedAt || p.createdAt).toISOString().split('T')[0],
          changefreq: 'weekly',
          priority: '0.8',
        });
      }
    } catch {
      // Fallback
    }

    const xmlItems = urls
      .map(
        u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlItems}
</urlset>`;
  }

  static async getRobotsTxt(): Promise<string> {
    const globalSeo = await this.getGlobalSeo();
    return globalSeo.robotsTxt;
  }
}
