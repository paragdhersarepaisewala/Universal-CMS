import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { FormsService, FormFieldDefinition } from '../../forms/service.js';
import { AuditService } from '../../content/audit.js';

export const adminFormsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/forms - List forms
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'List all managed forms and configuration',
        tags: ['Admin Forms'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                slug: Type.String(),
                description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                submitButtonText: Type.String(),
                isActive: Type.Boolean(),
                notificationEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                createdAt: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const list = await FormsService.listForms();
      return reply.send({ data: list });
    }
  );

  // 2. POST /admin/forms - Create form
  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Create a new dynamic form with structured field schemas',
        tags: ['Admin Forms'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          description: Type.Optional(Type.String()),
          fields: Type.Array(
            Type.Object({
              name: Type.String(),
              label: Type.String(),
              type: Type.String(),
              required: Type.Optional(Type.Boolean()),
              options: Type.Optional(Type.Array(Type.String())),
            })
          ),
          submitButtonText: Type.Optional(Type.String()),
          successMessage: Type.Optional(Type.String()),
          notificationEmail: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              slug: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        slug: string;
        description?: string;
        fields: FormFieldDefinition[];
        submitButtonText?: string;
        successMessage?: string;
        notificationEmail?: string;
      };

      try {
        const created = await FormsService.createForm(body);
        await AuditService.log({
          userId: req.user?.id,
          action: 'create',
          entityType: 'form',
          entityId: String(created.id),
          afterValues: created,
        });
        return reply.send({ data: { id: created.id, name: created.name, slug: created.slug } });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Failed to create form',
        });
      }
    }
  );

  // 3. GET /admin/forms/:id/submissions - List submissions for form
  app.get(
    '/:id/submissions',
    {
      preHandler: [authenticate, requirePermission('core.pages.view')],
      schema: {
        description: 'View submission inbox for a specific form',
        tags: ['Admin Forms'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          id: Type.Number(),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                formId: Type.Number(),
                data: Type.Record(Type.String(), Type.Any()),
                isRead: Type.Boolean(),
                createdAt: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const submissions = await FormsService.listSubmissions(id);
      return reply.send({ data: submissions });
    }
  );

  // 4. PATCH /admin/forms/submissions/:subId/read - Mark submission as read
  app.patch(
    '/submissions/:subId/read',
    {
      preHandler: [authenticate, requirePermission('core.pages.edit')],
      schema: {
        description: 'Mark a submission as read in the inbox',
        tags: ['Admin Forms'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({
          subId: Type.Number(),
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { subId } = req.params as { subId: number };
      await FormsService.markSubmissionRead(subId);
      return reply.send({ success: true });
    }
  );
};
