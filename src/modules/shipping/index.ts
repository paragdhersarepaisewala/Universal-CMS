import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';
import { ShippingService } from './service.js';
import { AuditService } from '../../content/audit.js';
import { pool } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';

// Public / Storefront routes
const shippingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /shipping/rates - Calculate available shipping options for cart
  fastify.post(
    '/rates',
    {
      preHandler: [requireModule('shipping')],
      schema: {
        description: 'Calculate available shipping rates and delivery estimates for cart destination',
        tags: ['Shipping'],
        body: Type.Object({
          items: Type.Array(
            Type.Object({
              productId: Type.Optional(Type.Number()),
              productType: Type.Optional(Type.String()),
              quantity: Type.Number({ minimum: 1 }),
              pricePaise: Type.Optional(Type.Number()),
              weightGrams: Type.Optional(Type.Number()),
            })
          ),
          destination: Type.Object({
            country: Type.Optional(Type.String()),
            state: Type.Optional(Type.String()),
            pincode: Type.String({ minLength: 3 }),
          }),
          cod: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                code: Type.String(),
                name: Type.String(),
                carrierName: Type.String(),
                amountPaise: Type.Number(),
                estimatedDaysMin: Type.Number(),
                estimatedDaysMax: Type.Number(),
                partner: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      try {
        const rates = await ShippingService.calculateShipping(body);
        return reply.send({ data: rates });
      } catch (err: any) {
        if (err.statusCode === 422 || err.code === 'SHIPPING_DISABLED') {
          return reply.status(422).send({
            error: {
              code: 'SHIPPING_DISABLED',
              message: err.message || 'Shipping is disabled for physical goods',
            },
          });
        }
        throw err;
      }
    }
  );

  // 2. POST /shipping/serviceability - Check pincode serviceability
  fastify.post(
    '/serviceability',
    {
      preHandler: [requireModule('shipping')],
      schema: {
        description: 'Verify if a postal code is serviceable for physical delivery and COD',
        tags: ['Shipping'],
        body: Type.Object({
          pincode: Type.String({ minLength: 3 }),
          weightGrams: Type.Optional(Type.Number()),
          cod: Type.Optional(Type.Boolean()),
          partner: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            serviceable: Type.Boolean(),
            estimatedDays: Type.Optional(Type.Number()),
            codAvailable: Type.Optional(Type.Boolean()),
            message: Type.Optional(Type.String()),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const res = await ShippingService.checkServiceability(body);
      return reply.send(res);
    }
  );

  // 3. POST /shipping/webhook/:partner - Inbound carrier tracking status webhook
  fastify.post(
    '/webhook/:partner',
    {
      preHandler: [requireModule('shipping')],
      schema: {
        description: 'Receive tracking status update webhook from integrated logistics partners',
        tags: ['Shipping'],
        params: Type.Object({
          partner: Type.String(),
        }),
        body: Type.Record(Type.String(), Type.Any()),
      },
    },
    async (req, reply) => {
      const { partner } = req.params as { partner: string };
      const body = req.body;
      const result = await ShippingService.handleTrackingWebhook(partner, body);
      return reply.send({ received: true, ...result });
    }
  );
};

// Admin shipping routes
export const adminShippingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireModule('shipping'));

  // 1. GET /admin/shipping/settings
  fastify.get(
    '/settings',
    {
      preHandler: [requirePermission('shipping.view')],
      schema: {
        description: 'Get global shipping settings and origin address',
        tags: ['Admin Shipping'],
      },
    },
    async (_req, reply) => {
      const settings = await ShippingService.getSettings();
      return reply.send({ data: settings });
    }
  );

  // 2. PUT /admin/shipping/settings
  fastify.put(
    '/settings',
    {
      preHandler: [requirePermission('shipping.manage')],
      schema: {
        description: 'Update shipping configuration and partner credentials',
        tags: ['Admin Shipping'],
        body: Type.Object({
          originPincode: Type.Optional(Type.String()),
          originCity: Type.Optional(Type.String()),
          originState: Type.Optional(Type.String()),
          originCountry: Type.Optional(Type.String()),
          defaultPartner: Type.Optional(Type.String()),
          activePartners: Type.Optional(Type.Array(Type.String())),
          disabledBehavior: Type.Optional(
            Type.Union([Type.Literal('fallback_flat_rate'), Type.Literal('block_physical')])
          ),
          fallbackRatePaise: Type.Optional(Type.Number()),
          freeShippingThresholdPaise: Type.Optional(Type.Number()),
          shiprocketApiKey: Type.Optional(Type.String()),
          shiprocketApiSecret: Type.Optional(Type.String()),
          delhiveryApiKey: Type.Optional(Type.String()),
          delhiveryClientName: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const before = await ShippingService.getSettings();
      const after = await ShippingService.updateSettings(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.settings.update',
        entityType: 'shipping_settings',
        entityId: '1',
        beforeValues: before,
        afterValues: after,
        ipAddress: req.ip,
      });

      return reply.send({ data: after });
    }
  );

  // 3. GET /admin/shipping/zones
  fastify.get(
    '/zones',
    {
      preHandler: [requirePermission('shipping.view')],
      schema: {
        description: 'List configured shipping zones and rates',
        tags: ['Admin Shipping'],
      },
    },
    async (_req, reply) => {
      const zones = await ShippingService.listZones();
      return reply.send({ data: zones });
    }
  );

  // 4. POST /admin/shipping/zones
  fastify.post(
    '/zones',
    {
      preHandler: [requirePermission('shipping.manage')],
      schema: {
        description: 'Create a new geographical shipping zone',
        tags: ['Admin Shipping'],
        body: Type.Object({
          name: Type.String(),
          countries: Type.Array(Type.String()),
          states: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
          pincodes: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
          priority: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const zoneId = await ShippingService.createZone(body);
      const zone = await ShippingService.getZoneById(zoneId);

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.zones.create',
        entityType: 'shipping_zones',
        entityId: String(zoneId),
        afterValues: zone,
        ipAddress: req.ip,
      });

      return reply.status(201).send({ data: zone });
    }
  );

  // 5. PUT /admin/shipping/zones/:id
  fastify.put(
    '/zones/:id',
    {
      preHandler: [requirePermission('shipping.manage')],
      schema: {
        description: 'Update geographical shipping zone parameters',
        tags: ['Admin Shipping'],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          countries: Type.Optional(Type.Array(Type.String())),
          states: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
          pincodes: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
          priority: Type.Optional(Type.Number()),
          isActive: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const before = await ShippingService.getZoneById(id);
      if (!before) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Shipping zone not found' } });
      }

      const body = req.body as any;
      await ShippingService.updateZone(id, body);
      const after = await ShippingService.getZoneById(id);

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.zones.update',
        entityType: 'shipping_zones',
        entityId: String(id),
        beforeValues: before,
        afterValues: after,
        ipAddress: req.ip,
      });

      return reply.send({ data: after });
    }
  );

  // 6. DELETE /admin/shipping/zones/:id
  fastify.delete(
    '/zones/:id',
    {
      preHandler: [requirePermission('shipping.manage')],
      schema: {
        description: 'Delete shipping zone and associated rate tiers',
        tags: ['Admin Shipping'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const before = await ShippingService.getZoneById(id);
      if (!before) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Shipping zone not found' } });
      }

      await ShippingService.deleteZone(id);

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.zones.delete',
        entityType: 'shipping_zones',
        entityId: String(id),
        beforeValues: before,
        ipAddress: req.ip,
      });

      return reply.send({ success: true });
    }
  );

  // 7. POST /admin/shipping/zones/:id/rates
  fastify.post(
    '/zones/:id/rates',
    {
      preHandler: [requirePermission('shipping.manage')],
      schema: {
        description: 'Add a rate tier to a shipping zone',
        tags: ['Admin Shipping'],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          name: Type.String(),
          rateType: Type.Optional(Type.String()),
          minWeightGrams: Type.Optional(Type.Number()),
          maxWeightGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          minOrderPaise: Type.Optional(Type.Number()),
          maxOrderPaise: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          ratePaise: Type.Number(),
          estimatedDaysMin: Type.Optional(Type.Number()),
          estimatedDaysMax: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as any;
      const rateId = await ShippingService.createZoneRate(id, body);
      const zone = await ShippingService.getZoneById(id);

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.rates.create',
        entityType: 'shipping_zone_rates',
        entityId: String(rateId),
        afterValues: body,
        ipAddress: req.ip,
      });

      return reply.status(201).send({ data: zone });
    }
  );

  // 8. POST /admin/shipping/shipments - Manifest shipment and generate AWB
  fastify.post(
    '/shipments',
    {
      preHandler: [requirePermission('shipping.shipments.manage')],
      schema: {
        description: 'Create shipment with carrier partner, generate AWB tracking number and manifest',
        tags: ['Admin Shipping'],
        body: Type.Object({
          orderId: Type.Number(),
          partner: Type.Optional(Type.String()),
          weightGrams: Type.Optional(Type.Number()),
          carrierName: Type.Optional(Type.String()),
          shippingFeePaise: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const shipment = await ShippingService.createShipment(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.shipments.create',
        entityType: 'shipping_shipments',
        entityId: String(shipment.id),
        afterValues: shipment,
        ipAddress: req.ip,
      });

      return reply.status(201).send({ data: shipment });
    }
  );

  // 9. GET /admin/shipping/shipments - List shipments
  fastify.get(
    '/shipments',
    {
      preHandler: [requirePermission('shipping.view')],
      schema: {
        description: 'List all shipments with status and tracking details',
        tags: ['Admin Shipping'],
        querystring: Type.Object({
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
          status: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const { page = 1, perPage = 20, status } = req.query as {
        page?: number;
        perPage?: number;
        status?: string;
      };

      const whereClauses: string[] = [];
      const values: any[] = [];

      if (status) {
        whereClauses.push('status = ?');
        values.push(status);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const offset = (page - 1) * perPage;

      const [countRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as total FROM shipping_shipments ${whereSql}`,
        values
      );
      const total = Number(countRows[0]?.total || 0);

      values.push(perPage, offset);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM shipping_shipments ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        values
      );

      return reply.send({
        data: rows,
        meta: { total, page, perPage },
      });
    }
  );

  // 10. GET /admin/shipping/shipments/:id - Shipment tracking details
  fastify.get(
    '/shipments/:id',
    {
      preHandler: [requirePermission('shipping.view')],
      schema: {
        description: 'Get live tracking details and history for a shipment',
        tags: ['Admin Shipping'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const tracking = await ShippingService.trackShipment(id);
      return reply.send({ data: tracking });
    }
  );

  // 11. GET /admin/shipping/shipments/:id/label - Shipping label
  fastify.get(
    '/shipments/:id/label',
    {
      preHandler: [requirePermission('shipping.view')],
      schema: {
        description: 'Get URL or PDF of shipping label for packing and dispatch',
        tags: ['Admin Shipping'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM shipping_shipments WHERE id = ?',
        [id]
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
      }

      const s = rows[0];
      return reply.send({
        data: {
          shipmentId: s.id,
          awb: s.awb,
          labelUrl: s.label_url || `/api/v1/admin/shipping/shipments/${s.id}/label`,
          carrierName: s.carrier_name,
        },
      });
    }
  );

  // 12. POST /admin/shipping/shipments/:id/cancel
  fastify.post(
    '/shipments/:id/cancel',
    {
      preHandler: [requirePermission('shipping.shipments.manage')],
      schema: {
        description: 'Cancel a manifested shipment with the carrier partner',
        tags: ['Admin Shipping'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM shipping_shipments WHERE id = ?',
        [id]
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
      }

      const s = rows[0];
      const adapter = ShippingService.getAdapter(s.partner);
      const cancelRes = await adapter.cancelShipment(s.awb);

      await pool.query(
        "UPDATE shipping_shipments SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
        [id]
      );

      await AuditService.log({
        userId: req.user?.id,
        action: 'shipping.shipments.cancel',
        entityType: 'shipping_shipments',
        entityId: String(id),
        afterValues: cancelRes,
        ipAddress: req.ip,
      });

      return reply.send({ ...cancelRes });
    }
  );
};

export const shippingModuleManifest: ModuleManifest = {
  name: 'shipping',
  version: '0.2.0',
  description: 'Shipping zones, weight-based rates, partner carrier adapters (Shiprocket, Delhivery, Manual), and tracking',
  isCore: false,
  permissions: [
    { key: 'shipping.view', description: 'View shipping zones, rates, and shipments' },
    { key: 'shipping.manage', description: 'Manage shipping zones, rates, and carrier settings' },
    { key: 'shipping.shipments.manage', description: 'Create shipments, generate AWBs, and update tracking' },
  ],
  adminNav: [
    {
      id: 'shipping-zones',
      label: 'Shipping Zones',
      route: '/admin/shipping/zones',
      permission: 'shipping.view',
      order: 34,
    },
    {
      id: 'shipping-shipments',
      label: 'Shipments',
      route: '/admin/shipping/shipments',
      permission: 'shipping.view',
      order: 35,
    },
    {
      id: 'shipping-settings',
      label: 'Shipping Settings',
      route: '/admin/shipping/settings',
      permission: 'shipping.manage',
      order: 36,
    },
  ],
  routesPrefix: '/shipping',
  routes: shippingRoutes,
};
