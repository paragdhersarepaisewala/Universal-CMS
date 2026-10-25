import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

export interface ApiTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: string[]; // e.g., ['read', 'write', 'admin', 'content:read', 'orders:manage']
  userId: number;
  lastUsedAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
}

const inMemoryApiTokens: ApiTokenRecord[] = [];

export class ApiTokenService {
  static generateToken(): { token: string; prefix: string; hash: string } {
    const raw = randomBytes(24).toString('hex');
    const token = `cms_live_${raw}`;
    const prefix = token.slice(0, 12);
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, prefix, hash };
  }

  static async createToken(data: {
    name: string;
    userId: number;
    scopes: string[];
    expiresAt?: string;
  }): Promise<{ token: string; record: ApiTokenRecord }> {
    const { token, prefix, hash } = this.generateToken();
    const id = randomBytes(8).toString('hex');

    const record: ApiTokenRecord = {
      id,
      name: data.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes: data.scopes,
      userId: data.userId,
      createdAt: new Date().toISOString(),
      expiresAt: data.expiresAt || null,
    };

    inMemoryApiTokens.push(record);

    try {
      await db.insert(settings).values({
        key: `api_token:${id}`,
        value: JSON.stringify(record),
        group: 'api_tokens',
        isPublic: false,
      });
    } catch {
      // Fallback
    }

    return { token, record };
  }

  static async validateToken(token: string): Promise<ApiTokenRecord | null> {
    const hash = createHash('sha256').update(token).digest('hex');

    for (const rec of inMemoryApiTokens) {
      if (rec.tokenHash === hash) {
        if (rec.expiresAt && new Date(rec.expiresAt) <= new Date()) {
          return null; // Expired
        }
        rec.lastUsedAt = new Date().toISOString();
        return rec;
      }
    }

    try {
      const rows = await db.select().from(settings).where(eq(settings.group, 'api_tokens'));
      for (const r of rows) {
        const rec = (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as ApiTokenRecord;
        if (rec.tokenHash === hash) {
          if (rec.expiresAt && new Date(rec.expiresAt) <= new Date()) {
            return null;
          }
          return rec;
        }
      }
    } catch {
      // Fallback
    }

    return null;
  }

  static async listTokens(userId?: number): Promise<Omit<ApiTokenRecord, 'tokenHash'>[]> {
    const list = userId ? inMemoryApiTokens.filter(t => t.userId === userId) : inMemoryApiTokens;
    return list.map(({ tokenHash: _th, ...rest }) => rest);
  }

  static async revokeToken(tokenId: string): Promise<boolean> {
    const idx = inMemoryApiTokens.findIndex(t => t.id === tokenId);
    if (idx !== -1) {
      inMemoryApiTokens.splice(idx, 1);
    }

    try {
      await db.delete(settings).where(eq(settings.key, `api_token:${tokenId}`));
    } catch {
      // Fallback
    }

    return true;
  }
}
