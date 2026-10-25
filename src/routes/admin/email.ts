import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import {
  getSmtpPublicConfig,
  saveSmtpConfig,
  testSmtpConnection,
  type SmtpConfig,
} from '../../email/smtp.js';
import { EmailService } from '../../email/service.js';
import { EmailTemplateService } from '../../email/templates.js';

export const adminEmailRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/email/smtp
  app.get(
    '/smtp',
    {
      preHandler: [authenticate, requirePermission('core.email.settings')],
      schema: {
        description: 'Get current SMTP server configuration (password is omitted)',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              host: Type.String(),
              port: Type.Number(),
              security: Type.String(),
              username: Type.String(),
              password_set: Type.Boolean(),
              from_name: Type.String(),
              from_address: Type.String(),
              reply_to: Type.Optional(Type.String()),
              last_test_at: Type.Union([Type.String(), Type.Null()]),
              last_test_status: Type.Union([Type.String(), Type.Null()]),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (_request, reply) => {
      const config = await getSmtpPublicConfig();
      return reply.send({ data: config });
    }
  );

  // 2. PUT /admin/email/smtp
  app.put(
    '/smtp',
    {
      preHandler: [authenticate, requirePermission('core.email.settings')],
      schema: {
        description: 'Update SMTP server configuration with encrypted credentials',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          host: Type.String({ minLength: 1 }),
          port: Type.Number({ minimum: 1, maximum: 65535 }),
          security: Type.Union([Type.Literal('none'), Type.Literal('ssl'), Type.Literal('starttls')]),
          username: Type.String(),
          password: Type.Optional(Type.String()),
          from_name: Type.String({ minLength: 1 }),
          from_address: Type.String({ format: 'email' }),
          reply_to: Type.Optional(Type.String()),
          version: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              host: Type.String(),
              port: Type.Number(),
              security: Type.String(),
              username: Type.String(),
              password_set: Type.Boolean(),
              from_name: Type.String(),
              from_address: Type.String(),
              reply_to: Type.Optional(Type.String()),
              last_test_at: Type.Union([Type.String(), Type.Null()]),
              last_test_status: Type.Union([Type.String(), Type.Null()]),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as Partial<SmtpConfig> & { version?: number };
      const saved = await saveSmtpConfig(body, body.version);
      return reply.send({ data: saved });
    }
  );

  // 3. POST /admin/email/smtp/test
  app.post(
    '/smtp/test',
    {
      preHandler: [authenticate, requirePermission('core.email.settings')],
      schema: {
        description: 'Test SMTP connection using stored or provided credentials',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        body: Type.Optional(
          Type.Object({
            host: Type.Optional(Type.String()),
            port: Type.Optional(Type.Number()),
            security: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('ssl'), Type.Literal('starttls')])),
            username: Type.Optional(Type.String()),
            password: Type.Optional(Type.String()),
          })
        ),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              message: Type.String(),
            }),
          }),
          400: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = (request.body || {}) as Partial<SmtpConfig>;
      try {
        const result = await testSmtpConnection(body);
        return reply.send({ data: result });
      } catch (err) {
        return reply.status(400).send({
          error: {
            code: 'SMTP_CONNECTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  );

  // 4. POST /admin/email/test-send
  app.post(
    '/test-send',
    {
      preHandler: [authenticate, requirePermission('core.email.settings')],
      schema: {
        description: 'Send a test email to the specified address',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          to: Type.String({ format: 'email' }),
          templateKey: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              message: Type.String(),
              logId: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { to: string; templateKey?: string };
      const result = await EmailService.enqueueEmail({
        to: body.to,
        templateKey: body.templateKey || 'auth.welcome',
        subject: 'Universal CMS Test Email Delivery',
        bodyHtml: '<p>This is a test email sent from the Universal CMS admin panel.</p>',
        category: 'transactional',
      });

      return reply.send({
        data: {
          success: result.queued,
          message: result.message,
          logId: result.logId,
        },
      });
    }
  );

  // 5. GET /admin/email/automation
  app.get(
    '/automation',
    {
      preHandler: [authenticate, requirePermission('core.email.view')],
      schema: {
        description: 'List all automated email event triggers and custom subject lines',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                key: Type.String(),
                name: Type.String(),
                description: Type.String(),
                category: Type.String(),
                isEnabled: Type.Boolean(),
                subject: Type.String(),
                variables: Type.Array(Type.String()),
              })
            ),
          }),
        },
      },
    },
    async (_request, reply) => {
      const list = await EmailService.getAutomationSettings();
      return reply.send({ data: list });
    }
  );

  // 6. PATCH /admin/email/automation/:event
  app.patch(
    '/automation/:event',
    {
      preHandler: [authenticate, requirePermission('core.email.edit')],
      schema: {
        description: 'Toggle an automatic email event on/off or update its default subject',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          event: Type.String(),
        }),
        body: Type.Object({
          isEnabled: Type.Optional(Type.Boolean()),
          subject: Type.Optional(Type.String({ minLength: 1 })),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              key: Type.String(),
              name: Type.String(),
              description: Type.String(),
              category: Type.String(),
              isEnabled: Type.Boolean(),
              subject: Type.String(),
              variables: Type.Array(Type.String()),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { event } = request.params as { event: string };
      const body = request.body as { isEnabled?: boolean; subject?: string };

      const updated = await EmailService.updateAutomationSetting(event, body);
      return reply.send({ data: updated });
    }
  );

  // 7. GET /admin/email/templates
  app.get(
    '/templates',
    {
      preHandler: [authenticate, requirePermission('core.email.view')],
      schema: {
        description: 'List all email templates',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                key: Type.String(),
                name: Type.String(),
                subject: Type.String(),
                bodyHtml: Type.String(),
                bodyText: Type.Union([Type.String(), Type.Null()]),
                isActive: Type.Boolean(),
                isSystem: Type.Boolean(),
                version: Type.Number(),
              })
            ),
          }),
        },
      },
    },
    async (_request, reply) => {
      const templates = await EmailTemplateService.listTemplates();
      return reply.send({ data: templates });
    }
  );

  // 8. GET /admin/email/templates/:id
  app.get(
    '/templates/:id',
    {
      preHandler: [authenticate, requirePermission('core.email.view')],
      schema: {
        description: 'Get an email template by ID',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              key: Type.String(),
              name: Type.String(),
              subject: Type.String(),
              bodyHtml: Type.String(),
              bodyText: Type.Union([Type.String(), Type.Null()]),
              isActive: Type.Boolean(),
              isSystem: Type.Boolean(),
              version: Type.Number(),
            }),
          }),
          404: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const template = await EmailTemplateService.getTemplate(Number(id));
      if (!template) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Email template not found' },
        });
      }
      return reply.send({ data: template });
    }
  );

  // 9. PUT /admin/email/templates/:id
  app.put(
    '/templates/:id',
    {
      preHandler: [authenticate, requirePermission('core.email.edit')],
      schema: {
        description: 'Update email template subject and content',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        body: Type.Object({
          subject: Type.Optional(Type.String({ minLength: 1 })),
          bodyHtml: Type.Optional(Type.String({ minLength: 1 })),
          bodyText: Type.Optional(Type.String()),
          version: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              key: Type.String(),
              name: Type.String(),
              subject: Type.String(),
              bodyHtml: Type.String(),
              bodyText: Type.Union([Type.String(), Type.Null()]),
              isActive: Type.Boolean(),
              isSystem: Type.Boolean(),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const body = request.body as { subject?: string; bodyHtml?: string; bodyText?: string; version?: number };
      const updated = await EmailTemplateService.updateTemplate(Number(id), body);
      return reply.send({ data: updated });
    }
  );

  // 10. POST /admin/email/templates/:id/reset
  app.post(
    '/templates/:id/reset',
    {
      preHandler: [authenticate, requirePermission('core.email.edit')],
      schema: {
        description: 'Reset email template to original default content',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              key: Type.String(),
              name: Type.String(),
              subject: Type.String(),
              bodyHtml: Type.String(),
              bodyText: Type.Union([Type.String(), Type.Null()]),
              isActive: Type.Boolean(),
              isSystem: Type.Boolean(),
              version: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const reset = await EmailTemplateService.resetToDefault(Number(id));
      return reply.send({ data: reset });
    }
  );

  // 11. GET /admin/email/log
  app.get(
    '/log',
    {
      preHandler: [authenticate, requirePermission('core.email.view')],
      schema: {
        description: 'View paginated email dispatch history and status logs',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Number({ minimum: 1 })),
          per_page: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          status: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                templateId: Type.Union([Type.Number(), Type.Null()]),
                recipient: Type.String(),
                subject: Type.String(),
                status: Type.String(),
                errorMessage: Type.Union([Type.String(), Type.Null()]),
                attempts: Type.Number(),
                sentAt: Type.Union([Type.String(), Type.Null()]),
                createdAt: Type.String(),
              })
            ),
            meta: Type.Object({
              page: Type.Number(),
              per_page: Type.Number(),
              total: Type.Number(),
              total_pages: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const query = request.query as { page?: number; per_page?: number; status?: string };
      const logs = await EmailService.listLogs({
        page: query.page,
        perPage: query.per_page,
        status: query.status,
      });

      return reply.send({
        data: logs.data.map(l => ({
          ...l,
          sentAt: l.sentAt ? l.sentAt.toISOString() : null,
          createdAt: l.createdAt.toISOString(),
        })),
        meta: logs.meta,
      });
    }
  );

  // 12. POST /admin/email/log/:id/resend
  app.post(
    '/log/:id/resend',
    {
      preHandler: [authenticate, requirePermission('core.email.edit')],
      schema: {
        description: 'Re-enqueue a failed or previously sent email',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const result = await EmailService.resend(Number(id));
      return reply.send({ data: result });
    }
  );

  // 13. POST /admin/email/queue/process
  app.post(
    '/queue/process',
    {
      preHandler: [authenticate, requirePermission('core.email.settings')],
      schema: {
        description: 'Trigger processing of queued email jobs with backoff',
        tags: ['Admin Email'],
        security: [{ bearerAuth: [] }],
        body: Type.Optional(
          Type.Object({
            batchSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          })
        ),
        response: {
          200: Type.Object({
            data: Type.Object({
              processed: Type.Number(),
              succeeded: Type.Number(),
              failed: Type.Number(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = (request.body || {}) as { batchSize?: number };
      const result = await EmailService.processQueue(body.batchSize || 10);
      return reply.send({ data: result });
    }
  );
};
