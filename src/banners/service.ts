import { db } from '../db/index.js';
import { banners } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface BannerRecord {
  id: number;
  name: string;
  type: 'announcement_bar' | 'popup' | 'toast';
  content: string;
  linkUrl?: string | null;
  buttonText?: string | null;
  location: string;
  targetPages: string[]; // ["*"] or ["/store"]
  startAt?: string | null;
  endAt?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const inMemoryBanners: BannerRecord[] = [
  {
    id: 1,
    name: 'Festive Season Free Shipping',
    type: 'announcement_bar',
    content: 'Free pan-India shipping on all orders above Rs. 999. Use code FREESHIP at checkout!',
    linkUrl: '/store',
    buttonText: 'Shop Now',
    location: 'top',
    targetPages: ['*'],
    isActive: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export class BannersService {
  static async listBanners(onlyActive: boolean = false): Promise<BannerRecord[]> {
    try {
      const rows = await db.select().from(banners);
      if (rows.length > 0) {
        const list = rows.map(r => ({
          ...r,
          type: r.type as 'announcement_bar' | 'popup' | 'toast',
          targetPages: typeof r.targetPages === 'string' ? JSON.parse(r.targetPages) : (r.targetPages as string[] || ['*']),
          startAt: r.startAt?.toISOString() || null,
          endAt: r.endAt?.toISOString() || null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
        return onlyActive ? list.filter(b => b.isActive) : list;
      }
    } catch {
      // Fallback
    }

    return onlyActive ? inMemoryBanners.filter(b => b.isActive) : inMemoryBanners;
  }

  static async getActiveBannersForRoute(path: string): Promise<BannerRecord[]> {
    const all = await this.listBanners(true);
    const now = new Date();

    return all.filter(banner => {
      if (banner.startAt && new Date(banner.startAt) > now) return false;
      if (banner.endAt && new Date(banner.endAt) < now) return false;
      if (banner.targetPages.includes('*')) return true;
      return banner.targetPages.some(pattern => path.startsWith(pattern));
    });
  }

  static async createBanner(data: {
    name: string;
    type?: 'announcement_bar' | 'popup' | 'toast';
    content: string;
    linkUrl?: string;
    buttonText?: string;
    location?: string;
    targetPages?: string[];
    startAt?: string;
    endAt?: string;
  }): Promise<BannerRecord> {
    const newRecord: BannerRecord = {
      id: inMemoryBanners.length + 1,
      name: data.name,
      type: data.type || 'announcement_bar',
      content: data.content,
      linkUrl: data.linkUrl || null,
      buttonText: data.buttonText || null,
      location: data.location || 'top',
      targetPages: data.targetPages || ['*'],
      startAt: data.startAt || null,
      endAt: data.endAt || null,
      isActive: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const [insertRes] = await db.insert(banners).values({
        name: newRecord.name,
        type: newRecord.type,
        content: newRecord.content,
        linkUrl: newRecord.linkUrl,
        buttonText: newRecord.buttonText,
        location: newRecord.location,
        targetPages: JSON.stringify(newRecord.targetPages),
        startAt: newRecord.startAt ? new Date(newRecord.startAt) : null,
        endAt: newRecord.endAt ? new Date(newRecord.endAt) : null,
        isActive: true,
        version: 1,
      });
      newRecord.id = Number(insertRes.insertId);
    } catch {
      // Fallback
    }

    inMemoryBanners.push(newRecord);
    return newRecord;
  }

  static async updateBanner(id: number, data: Partial<BannerRecord>): Promise<BannerRecord | null> {
    const banner = inMemoryBanners.find(b => b.id === id);
    if (!banner) return null;

    Object.assign(banner, data, { updatedAt: new Date().toISOString(), version: banner.version + 1 });

    try {
      const rest = { ...data };
      delete rest.createdAt;
      delete rest.updatedAt;
      await db.update(banners).set({
        ...(rest as Record<string, unknown>),
        targetPages: data.targetPages ? JSON.stringify(data.targetPages) : undefined,
        startAt: data.startAt ? new Date(data.startAt) : undefined,
        endAt: data.endAt ? new Date(data.endAt) : undefined,
        version: banner.version,
      }).where(eq(banners.id, id));
    } catch {
      // Fallback
    }

    return banner;
  }

  static async deleteBanner(id: number): Promise<boolean> {
    const idx = inMemoryBanners.findIndex(b => b.id === id);
    if (idx !== -1) inMemoryBanners.splice(idx, 1);

    try {
      await db.delete(banners).where(eq(banners.id, id));
    } catch {
      // Fallback
    }

    return true;
  }
}
