import { db } from '../db/index.js';
import { media, contentBlocks } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export interface MediaItem {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  publicUrl: string;
  createdAt: Date;
}

export interface MediaUploadRules {
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  autoWebpConversion: boolean;
  maxWidth: number;
  maxHeight: number;
}

export const DEFAULT_MEDIA_RULES: MediaUploadRules = {
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'image/gif',
    'application/pdf',
  ],
  autoWebpConversion: true,
  maxWidth: 3840,
  maxHeight: 2160,
};

let inMemoryMedia: MediaItem[] = [
  {
    id: 1,
    filename: 'hero-banner.webp',
    originalName: 'hero-banner.png',
    mimeType: 'image/webp',
    sizeBytes: 154200,
    width: 1920,
    height: 1080,
    altText: 'Hero promotional banner',
    publicUrl: '/uploads/hero-banner.webp',
    createdAt: new Date(),
  },
];
let mediaIdCounter = 2;

export class MediaService {
  static getUploadRules(): MediaUploadRules {
    return DEFAULT_MEDIA_RULES;
  }

  static async listMedia(params: { page?: number; perPage?: number; mimeType?: string }): Promise<{
    data: MediaItem[];
    meta: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 20));

    try {
      const rows = await db
        .select()
        .from(media)
        .orderBy(desc(media.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

      if (rows.length > 0) {
        return {
          data: rows.map((r: typeof media.$inferSelect) => ({
            id: r.id,
            filename: r.filename,
            originalName: r.originalName,
            mimeType: r.mimeType,
            sizeBytes: r.sizeBytes,
            width: r.width,
            height: r.height,
            altText: r.altText,
            publicUrl: r.publicUrl,
            createdAt: r.createdAt,
          })),
          meta: {
            page,
            per_page: perPage,
            total: rows.length,
            total_pages: Math.ceil(rows.length / perPage) || 1,
          },
        };
      }
    } catch {
      // Fallback
    }

    const filtered = params.mimeType
      ? inMemoryMedia.filter(m => m.mimeType.startsWith(params.mimeType || ''))
      : inMemoryMedia;

    return {
      data: filtered.slice((page - 1) * perPage, page * perPage),
      meta: {
        page,
        per_page: perPage,
        total: filtered.length,
        total_pages: Math.ceil(filtered.length / perPage) || 1,
      },
    };
  }

  static async registerMedia(item: {
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
    altText?: string;
    publicUrl: string;
  }): Promise<MediaItem> {
    const rules = this.getUploadRules();
    if (!rules.allowedMimeTypes.includes(item.mimeType.toLowerCase())) {
      throw new Error(`MIME type '${item.mimeType}' is not allowed. Allowed types: ${rules.allowedMimeTypes.join(', ')}`);
    }
    if (item.sizeBytes > rules.maxSizeBytes) {
      throw new Error(`File size ${item.sizeBytes} bytes exceeds maximum allowed limit of ${rules.maxSizeBytes} bytes`);
    }

    const created: MediaItem = {
      id: mediaIdCounter++,
      filename: item.filename,
      originalName: item.originalName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      width: item.width || null,
      height: item.height || null,
      altText: item.altText || null,
      publicUrl: item.publicUrl,
      createdAt: new Date(),
    };

    inMemoryMedia.unshift(created);

    try {
      await db.insert(media).values({
        filename: item.filename,
        originalName: item.originalName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        width: item.width,
        height: item.height,
        altText: item.altText,
        storagePath: `/uploads/${item.filename}`,
        publicUrl: item.publicUrl,
      });
    } catch {
      // Fallback
    }

    return created;
  }

  static async checkUsage(mediaId: number): Promise<{ inUse: boolean; count: number }> {
    try {
      // Search for mediaId in content_blocks data JSON
      const rows = await db.select().from(contentBlocks);
      let count = 0;
      for (const r of rows) {
        const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        if (text.includes(`"mediaId":${mediaId}`) || text.includes(`"imageId":${mediaId}`)) {
          count++;
        }
      }
      return { inUse: count > 0, count };
    } catch {
      return { inUse: false, count: 0 };
    }
  }

  static async deleteMedia(id: number): Promise<boolean> {
    const usage = await this.checkUsage(id);
    if (usage.inUse) {
      throw new Error(`Cannot delete media file: it is currently referenced in ${usage.count} content section(s).`);
    }

    inMemoryMedia = inMemoryMedia.filter(m => m.id !== id);

    try {
      await db.delete(media).where(eq(media.id, id));
    } catch {
      // Fallback
    }

    return true;
  }
}
