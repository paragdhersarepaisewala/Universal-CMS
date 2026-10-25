import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { desc } from 'drizzle-orm';

export interface AuditLogEntry {
  userId?: number;
  action: string;
  entityType: string;
  entityId?: string;
  beforeValues?: unknown;
  afterValues?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogItem {
  id: number;
  userId: number | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeValues: unknown;
  afterValues: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const inMemoryAuditLogs: AuditLogItem[] = [];
let auditIdCounter = 1;

export class AuditService {
  static async log(entry: AuditLogEntry): Promise<void> {
    const item: AuditLogItem = {
      id: auditIdCounter++,
      userId: entry.userId || null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId || null,
      beforeValues: entry.beforeValues || null,
      afterValues: entry.afterValues || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      createdAt: new Date(),
    };

    inMemoryAuditLogs.unshift(item);

    try {
      await db.insert(auditLogs).values({
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        beforeValues: entry.beforeValues ? JSON.stringify(entry.beforeValues) : null,
        afterValues: entry.afterValues ? JSON.stringify(entry.afterValues) : null,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      });
    } catch {
      // In-memory fallback
    }
  }

  static async listLogs(params: { page?: number; perPage?: number; entityType?: string }): Promise<{
    data: AuditLogItem[];
    meta: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 20));

    try {
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

      return {
        data: rows.map((r: typeof auditLogs.$inferSelect) => ({
          id: r.id,
          userId: r.userId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          beforeValues: r.beforeValues,
          afterValues: r.afterValues,
          ipAddress: r.ipAddress,
          userAgent: r.userAgent,
          createdAt: r.createdAt,
        })),
        meta: {
          page,
          per_page: perPage,
          total: rows.length,
          total_pages: Math.ceil(rows.length / perPage) || 1,
        },
      };
    } catch {
      const filtered = params.entityType
        ? inMemoryAuditLogs.filter(l => l.entityType === params.entityType)
        : inMemoryAuditLogs;

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
  }
}
