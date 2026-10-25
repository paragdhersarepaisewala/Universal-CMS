import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { cache, CACHE_TAGS } from '../cache/index.js';

export interface SiteSettings {
  siteName: string;
  siteDescription: string;
  contactEmail: string;
  timezone: string;
  currency: string;
  currencySymbol: string;
  taxRatePercent: number;
  taxLabel: string;
  invoicePrefix: string;
  invoiceNextNumber: number;
  maintenanceMode: boolean;
  version: number;
}

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'Universal CMS Store',
  siteDescription: 'E-Commerce and Content Management System',
  contactEmail: 'admin@example.com',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  currencySymbol: '₹',
  taxRatePercent: 18.0,
  taxLabel: 'GST',
  invoicePrefix: 'INV-2026-',
  invoiceNextNumber: 1001,
  maintenanceMode: false,
  version: 1,
};

let cachedSettings = { ...DEFAULT_SETTINGS };

export class SettingsService {
  static async getSettings(): Promise<SiteSettings> {
    return await cache.getOrSet('settings:general', async () => {
      try {
        const rows = await db.select().from(settings).where(eq(settings.key, 'site_general')).limit(1);
        if (rows.length > 0 && rows[0].value) {
          const stored = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
          return { ...DEFAULT_SETTINGS, ...stored, version: rows[0].version };
        }
      } catch {
        // Fallback
      }
      return cachedSettings;
    }, 3600, [CACHE_TAGS.SETTINGS]);
  }

  static async updateSettings(updates: Partial<SiteSettings>, expectedVersion?: number): Promise<SiteSettings> {
    const current = await this.getSettings();

    if (expectedVersion !== undefined && current.version !== undefined && expectedVersion !== current.version) {
      const error = new Error('Version conflict: settings have been updated by another administrator.');
      (error as unknown as { statusCode: number; code: string }).statusCode = 409;
      (error as unknown as { statusCode: number; code: string }).code = 'CONFLICT';
      throw error;
    }

    const newVersion = (current.version || 1) + 1;
    const merged: SiteSettings = {
      ...current,
      ...updates,
      version: newVersion,
    };

    cachedSettings = merged;

    try {
      const existing = await db.select().from(settings).where(eq(settings.key, 'site_general')).limit(1);
      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(merged), version: newVersion, updatedAt: new Date() })
          .where(eq(settings.key, 'site_general'));
      } else {
        await db.insert(settings).values({
          key: 'site_general',
          value: JSON.stringify(merged),
          group: 'general',
          isPublic: true,
          version: newVersion,
        });
      }
    } catch {
      // Fallback
    }

    await cache.invalidateTags([CACHE_TAGS.SETTINGS]);
    return merged;
  }
}
