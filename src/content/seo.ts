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

  static async generateJsonLd(options: {
    type: 'organization' | 'website' | 'article' | 'product' | 'breadcrumb';
    idOrSlug?: string;
    baseUrl?: string;
    breadcrumbs?: Array<{ name: string; url: string }>;
  }): Promise<Record<string, unknown> | null> {
    const baseUrl = (options.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    const { SettingsService } = await import('./settings.js');
    const settings = await SettingsService.getSettings();

    switch (options.type) {
      case 'organization': {
        return {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: settings.siteName,
          description: settings.siteDescription,
          url: baseUrl,
          email: settings.contactEmail,
        };
      }

      case 'website': {
        return {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: settings.siteName,
          url: baseUrl,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${baseUrl}/search?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        };
      }

      case 'article': {
        if (!options.idOrSlug) {
          return {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: settings.siteName,
            publisher: {
              '@type': 'Organization',
              name: settings.siteName,
              url: baseUrl,
            },
          };
        }

        const isNumeric = /^\d+$/.test(options.idOrSlug);
        const { blogPosts } = await import('../db/schema.js');
        const rows = await db
          .select()
          .from(blogPosts)
          .where(isNumeric ? eq(blogPosts.id, Number(options.idOrSlug)) : eq(blogPosts.slug, options.idOrSlug))
          .limit(1);

        if (rows.length === 0) return null;
        const post = rows[0];

        return {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: post.title,
          description: post.excerpt || undefined,
          datePublished: (post.publishedAt || post.createdAt).toISOString(),
          dateModified: (post.updatedAt || post.createdAt).toISOString(),
          mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': `${baseUrl}/blog/${post.slug}`,
          },
          publisher: {
            '@type': 'Organization',
            name: settings.siteName,
            url: baseUrl,
          },
        };
      }

      case 'product': {
        if (!options.idOrSlug) {
          return {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: settings.siteName,
          };
        }

        const isNumeric = /^\d+$/.test(options.idOrSlug);
        const { products } = await import('../db/schema.js');
        const rows = await db
          .select()
          .from(products)
          .where(isNumeric ? eq(products.id, Number(options.idOrSlug)) : eq(products.slug, options.idOrSlug))
          .limit(1);

        if (rows.length === 0) return null;
        const prod = rows[0];

        return {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: prod.name,
          description: prod.description || undefined,
          sku: prod.sku || undefined,
          offers: {
            '@type': 'Offer',
            price: (prod.price / 100).toFixed(2),
            priceCurrency: settings.currency || 'INR',
            availability: prod.stockQuantity > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${baseUrl}/store/products/${prod.slug}`,
          },
        };
      }

      case 'breadcrumb': {
        const items = options.breadcrumbs || [
          { name: 'Home', url: '/' },
          { name: options.idOrSlug || 'Page', url: `/${options.idOrSlug || ''}` },
        ];

        return {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: item.url.startsWith('http') ? item.url : `${baseUrl}${item.url.startsWith('/') ? '' : '/'}${item.url}`,
          })),
        };
      }

      default:
        return null;
    }
  }
}
