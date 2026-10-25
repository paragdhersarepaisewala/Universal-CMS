import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { db } from '../../db/index.js';
import { settings } from '../../db/schema.js';

export interface AdSlotRecord {
  location: string;
  name: string;
  codeHtml: string;
  isActive: boolean;
  updatedAt: string;
}

const inMemoryAdSlots: Record<string, AdSlotRecord> = {
  header_banner: {
    location: 'header_banner',
    name: 'Top Header Ad',
    codeHtml: '<!-- Ad: Header 728x90 -->',
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  sidebar: {
    location: 'sidebar',
    name: 'Sidebar Ad Slot',
    codeHtml: '<!-- Ad: Sidebar 300x250 -->',
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
};

export const adminAdSlotsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. GET /admin/ad-slots - List all ad slots
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('core.settings.view')],
      schema: {
        description: 'List configured ad slots and script tags',
        tags: ['Admin Ad Slots'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      return reply.send({ data: Object.values(inMemoryAdSlots) });
    }
  );

  // 2. PUT /admin/ad-slots/:location - Update ad slot
  app.put(
    '/:location',
    {
      preHandler: [authenticate, requirePermission('core.settings.edit')],
      schema: {
        description: 'Update ad slot code or toggle status',
        tags: ['Admin Ad Slots'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ location: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          codeHtml: Type.String(),
          isActive: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { location } = req.params as { location: string };
      const body = req.body as { name?: string; codeHtml: string; isActive?: boolean };

      const existing = inMemoryAdSlots[location] || {
        location,
        name: body.name || location,
        codeHtml: body.codeHtml,
        isActive: body.isActive ?? true,
        updatedAt: new Date().toISOString(),
      };

      existing.name = body.name || existing.name;
      existing.codeHtml = body.codeHtml;
      if (body.isActive !== undefined) existing.isActive = body.isActive;
      existing.updatedAt = new Date().toISOString();
      inMemoryAdSlots[location] = existing;

      try {
        await db.insert(settings).values({
          key: `ad_slot:${location}`,
          value: JSON.stringify(existing),
          group: 'ad_slots',
          isPublic: true,
        });
      } catch {
        // Fallback
      }

      return reply.send({ data: existing });
    }
  );
};

export const publicAdSlotsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Public GET /ad-slots/:location
  app.get(
    '/:location',
    {
      schema: {
        description: 'Get active ad slot code for rendering',
        tags: ['Ad Slots'],
        params: Type.Object({ location: Type.String() }),
      },
    },
    async (req, reply) => {
      const { location } = req.params as { location: string };
      const slot = inMemoryAdSlots[location];
      if (!slot || !slot.isActive) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ad slot not found or inactive' } });
      }
      return reply.send({ data: slot });
    }
  );
};
