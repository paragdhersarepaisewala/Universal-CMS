import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { moduleRegistry } from '../modules/registry.js';
import { StoreService } from '../modules/store/service.js';
import { EmailService } from '../email/service.js';
import { pool } from '../db/pool.js';
import { RowDataPacket } from 'mysql2';

export const jobsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /jobs/process - Central runner invoked by Hostinger cron or admin
  fastify.post(
    '/process',
    {
      schema: {
        description: 'Process queued background tasks (emails, order expiry, webhooks)',
        tags: ['Jobs'],
        response: {
          200: Type.Object({
            data: Type.Object({
              emailsProcessed: Type.Number(),
              ordersExpired: Type.Number(),
              abandonedCartsProcessed: Type.Optional(Type.Number()),
              jobsCompleted: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const runnerSecret = process.env.JOB_RUNNER_SECRET;
      const providedSecret = request.headers['x-job-runner-secret'];

      if (runnerSecret && providedSecret !== runnerSecret && process.env.NODE_ENV !== 'test') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing job runner secret',
          },
        });
      }

      let emailsProcessed = 0;
      let ordersExpired = 0;
      let jobsCompleted = 0;

      // 1. Process email queue
      try {
        const emailRes = await EmailService.processQueue(50);
        emailsProcessed = emailRes.processed;
      } catch (err) {
        request.log.error(err, '[Jobs] Failed processing email queue');
      }

      // 2. Expire unpaid online orders and process abandoned carts (if store module is registered & enabled)
      let abandonedCartsProcessed = 0;
      if (moduleRegistry.isEnabled('store')) {
        try {
          const expRes = await StoreService.expireUnpaidOrders();
          ordersExpired = expRes.expiredCount;
        } catch (err) {
          request.log.error(err, '[Jobs] Failed expiring unpaid orders');
        }

        try {
          const abRes = await StoreService.processAbandonedCarts(60);
          abandonedCartsProcessed = abRes.processed;
        } catch (err) {
          request.log.error(err, '[Jobs] Failed processing abandoned carts');
        }
      }

      // 3. Process generic pending jobs in jobs table
      const connection = await pool.getConnection();
      try {
        const [pending] = await connection.query<RowDataPacket[]>(
          "SELECT id, job_type, payload FROM jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 20 FOR UPDATE"
        );

        for (const job of pending) {
          try {
            await connection.query("UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = ?", [job.id]);
            jobsCompleted++;
          } catch (jobErr) {
            await connection.query("UPDATE jobs SET status = 'failed', updated_at = NOW() WHERE id = ?", [job.id]);
          }
        }
      } finally {
        connection.release();
      }

      return reply.send({
        data: {
          emailsProcessed,
          ordersExpired,
          abandonedCartsProcessed,
          jobsCompleted,
        },
      });
    }
  );
};
