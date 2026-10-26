import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { pool } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';

export const adminLogsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/logs/system - System health, memory, and runtime observability
  app.get(
    '/system',
    {
      preHandler: [authenticate, requirePermission('core.logs.view')],
      schema: {
        description: 'Get operational system diagnostics, process memory stats, and database runtime metrics',
        tags: ['Admin Logs'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();

      // Recent completed and pending jobs counts
      let jobCounts = { pending: 0, completed: 0, failed: 0 };
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT
            COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed
           FROM jobs`
        );
        if (rows.length > 0) {
          jobCounts = {
            pending: Number(rows[0].pending || 0),
            completed: Number(rows[0].completed || 0),
            failed: Number(rows[0].failed || 0),
          };
        }
      } catch {
        // ignore
      }

      return reply.send({
        data: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          pid: process.pid,
          memoryBytes: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
          },
          cpuUsageMicros: {
            user: cpu.user,
            system: cpu.system,
          },
          jobsSummary: jobCounts,
          environment: process.env.NODE_ENV || 'development',
          timestamp: new Date().toISOString(),
        },
      });
    }
  );

  // 2. GET /admin/logs/errors - Unified error logs retrieval (failed jobs, failed emails)
  app.get(
    '/errors',
    {
      preHandler: [authenticate, requirePermission('core.logs.view')],
      schema: {
        description: 'Retrieve failed background jobs, failed email deliveries, and execution errors',
        tags: ['Admin Logs'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          perPage: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          source: Type.Optional(Type.String()), // 'all', 'jobs', 'email'
        }),
      },
    },
    async (req, reply) => {
      const q = req.query as { page?: number; perPage?: number; source?: string };
      const page = Math.max(1, q.page || 1);
      const perPage = Math.min(100, Math.max(1, q.perPage || 20));
      const source = q.source || 'all';

      const errorRecords: Array<{
        id: string;
        source: 'jobs' | 'email';
        identifier: string;
        errorMessage: string;
        payload: any;
        failedAt: string;
      }> = [];

      // Query failed jobs
      if (source === 'all' || source === 'jobs') {
        try {
          const [jobRows] = await pool.query<RowDataPacket[]>(
            `SELECT id, job_type, error_message, payload, updated_at
             FROM jobs
             WHERE status = 'failed'
             ORDER BY id DESC LIMIT 50`
          );
          for (const r of jobRows) {
            errorRecords.push({
              id: `job-${r.id}`,
              source: 'jobs',
              identifier: r.job_type,
              errorMessage: r.error_message || 'Job execution failed',
              payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
              failedAt: r.updated_at,
            });
          }
        } catch {
          // ignore
        }
      }

      // Query failed emails
      if (source === 'all' || source === 'email') {
        try {
          const [emailRows] = await pool.query<RowDataPacket[]>(
            `SELECT id, recipient, subject, error_message, updated_at
             FROM email_logs
             WHERE status = 'failed'
             ORDER BY id DESC LIMIT 50`
          );
          for (const r of emailRows) {
            errorRecords.push({
              id: `email-${r.id}`,
              source: 'email',
              identifier: `${r.recipient} (${r.subject})`,
              errorMessage: r.error_message || 'Email delivery failed',
              payload: { recipient: r.recipient, subject: r.subject },
              failedAt: r.updated_at,
            });
          }
        } catch {
          // ignore
        }
      }

      // Sort combined errors by failedAt desc
      errorRecords.sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime());

      const total = errorRecords.length;
      const paginated = errorRecords.slice((page - 1) * perPage, page * perPage);

      return reply.send({
        data: paginated,
        meta: {
          total,
          page,
          perPage,
          totalPages: Math.ceil(total / perPage) || 1,
        },
      });
    }
  );
};
