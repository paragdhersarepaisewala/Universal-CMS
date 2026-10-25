import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { DigitalDeliveryService } from './service.js';
import { requireModule } from '../guard.js';
import { requirePermission } from '../../rbac/middleware.js';
import { authenticate } from '../../auth/middleware.js';
import { AuditService } from '../../content/audit.js';
import { ModuleManifest } from '../types.js';
import { pool } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { existsSync, createReadStream } from 'fs';

export const digitalRoutes: FastifyPluginAsync = async (fastify) => {
  // Storefront endpoints (guarded by digital-delivery module status)
  fastify.addHook('preHandler', requireModule('digital-delivery'));

  // 1. GET /digital/orders/:orderId/entitlements - Public or customer retrieval of digital goods
  fastify.get(
    '/orders/:orderId/entitlements',
    {
      schema: {
        description: 'Retrieve digital delivery entitlements (downloads, license keys) for an order',
        tags: ['Digital Delivery'],
        params: Type.Object({ orderId: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { orderId } = req.params as { orderId: number };

      // Verify order access: must provide matching x-guest-token or be order owner
      const [orderRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, customer_id, guest_access_token, status FROM orders WHERE id = ? LIMIT 1',
        [orderId]
      );

      if (orderRows.length === 0) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }

      const order = orderRows[0];
      const guestToken = req.headers['x-guest-token'] as string;
      const isGuestMatch = guestToken && guestToken === order.guest_access_token;
      const isCustomerMatch = (req as any).user && (req as any).user.id === order.customer_id;

      if (!isGuestMatch && !isCustomerMatch) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Access denied: valid guest token or authentication required' },
        });
      }

      const entitlements = await DigitalDeliveryService.getOrderEntitlements(orderId);
      return reply.send({
        data: entitlements.map((e) => ({
          ...e,
          downloadUrl: e.asset ? `/api/v1/digital/download/${e.downloadToken}` : null,
        })),
      });
    }
  );

  // 2. GET /digital/download/:token - Stream or tokenized download verification
  fastify.get(
    '/download/:token',
    {
      schema: {
        description: 'Verify and download digital file by unique entitlement download token',
        tags: ['Digital Delivery'],
        params: Type.Object({ token: Type.String() }),
      },
    },
    async (req, reply) => {
      const { token } = req.params as { token: string };

      const check = await DigitalDeliveryService.processDownload(token);
      if (!check.allowed || !check.asset) {
        return reply.status(403).send({
          error: { code: 'DOWNLOAD_FORBIDDEN', message: check.reason || 'Download not allowed' },
        });
      }

      const asset = check.asset;
      reply.header('Content-Disposition', `attachment; filename="${asset.fileName}"`);
      reply.header('Content-Type', asset.mimeType || 'application/octet-stream');
      reply.header('X-Remaining-Downloads', String(check.remainingDownloads ?? 0));

      // If file exists on local storage, stream it; otherwise output placeholder buffer
      if (existsSync(asset.storagePath)) {
        return reply.send(createReadStream(asset.storagePath));
      } else {
        // Return file contents buffer (allows testing offline virtual paths)
        const contentBuffer = Buffer.from(`Digital Asset Content: ${asset.fileName}\nStorage: ${asset.storagePath}`);
        return reply.send(contentBuffer);
      }
    }
  );

  // 3. POST /digital/licenses/verify - Machine / app license verification
  fastify.post(
    '/licenses/verify',
    {
      schema: {
        description: 'Verify license key validity and status for desktop or client apps',
        tags: ['Digital Delivery'],
        body: Type.Object({
          licenseKey: Type.String({ minLength: 1 }),
        }),
      },
    },
    async (req, reply) => {
      const { licenseKey } = req.body as { licenseKey: string };
      const res = await DigitalDeliveryService.verifyLicenseKey(licenseKey);
      if (!res.valid) {
        return reply.status(400).send({ data: res });
      }
      return reply.send({ data: res });
    }
  );
};

export const adminDigitalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireModule('digital-delivery'));

  // 1. GET /admin/digital/assets - List digital product files
  fastify.get(
    '/assets',
    {
      preHandler: [requirePermission('digital.view')],
      schema: {
        description: 'List downloadable digital assets',
        tags: ['Admin Digital Delivery'],
        querystring: Type.Object({
          productId: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const query = req.query as { productId?: number };
      const assets = await DigitalDeliveryService.listAssets(query.productId);
      return reply.send({ data: assets });
    }
  );

  // 2. POST /admin/digital/assets - Attach digital asset to product
  fastify.post(
    '/assets',
    {
      preHandler: [requirePermission('digital.manage')],
      schema: {
        description: 'Create and attach downloadable asset to digital product',
        tags: ['Admin Digital Delivery'],
        body: Type.Object({
          productId: Type.Number(),
          variantId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          fileName: Type.String({ minLength: 1 }),
          storagePath: Type.String({ minLength: 1 }),
          fileSizeBytes: Type.Optional(Type.Number()),
          mimeType: Type.Optional(Type.String()),
          downloadLimit: Type.Optional(Type.Number()),
          expiresHours: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const asset = await DigitalDeliveryService.createAsset(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'digital.assets.create',
        entityType: 'digital_assets',
        entityId: String(asset.id),
        afterValues: asset,
        ipAddress: req.ip,
      });

      return reply.status(201).send({ data: asset });
    }
  );

  // 3. DELETE /admin/digital/assets/:id
  fastify.delete(
    '/assets/:id',
    {
      preHandler: [requirePermission('digital.manage')],
      schema: {
        description: 'Deactivate digital product asset',
        tags: ['Admin Digital Delivery'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const before = await DigitalDeliveryService.getAssetById(id);
      if (!before) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Digital asset not found' } });
      }

      await DigitalDeliveryService.deleteAsset(id);

      await AuditService.log({
        userId: req.user?.id,
        action: 'digital.assets.delete',
        entityType: 'digital_assets',
        entityId: String(id),
        beforeValues: before,
        ipAddress: req.ip,
      });

      return reply.send({ success: true });
    }
  );

  // 4. GET /admin/digital/licenses - List license keys
  fastify.get(
    '/licenses',
    {
      preHandler: [requirePermission('digital.view')],
      schema: {
        description: 'List license key pool entries and assignments',
        tags: ['Admin Digital Delivery'],
        querystring: Type.Object({
          productId: Type.Optional(Type.Number()),
          status: Type.Optional(Type.Union([Type.Literal('available'), Type.Literal('assigned'), Type.Literal('revoked')])),
          limit: Type.Optional(Type.Number()),
          offset: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const query = req.query as any;
      const result = await DigitalDeliveryService.listKeys(query);
      return reply.send({ data: result.keys, total: result.total });
    }
  );

  // 5. POST /admin/digital/licenses/pool - Bulk upload license keys
  fastify.post(
    '/licenses/pool',
    {
      preHandler: [requirePermission('digital.manage')],
      schema: {
        description: 'Bulk upload license keys into product pool',
        tags: ['Admin Digital Delivery'],
        body: Type.Object({
          productId: Type.Number(),
          variantId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          keys: Type.Array(Type.String({ minLength: 1 })),
          metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const res = await DigitalDeliveryService.addKeysToPool(body);

      await AuditService.log({
        userId: req.user?.id,
        action: 'digital.licenses.upload',
        entityType: 'license_keys',
        entityId: String(body.productId),
        afterValues: { addedCount: res.addedCount, duplicateCount: res.duplicateCount },
        ipAddress: req.ip,
      });

      return reply.status(201).send({ data: res });
    }
  );

  // 6. POST /admin/digital/entitlements/:id/revoke - Revoke specific entitlement
  fastify.post(
    '/entitlements/:id/revoke',
    {
      preHandler: [requirePermission('digital.manage')],
      schema: {
        description: 'Revoke single digital entitlement download token and license key',
        tags: ['Admin Digital Delivery'],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };

      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM digital_entitlements WHERE id = ? LIMIT 1',
        [id]
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Entitlement not found' } });
      }

      const ent = rows[0];
      await pool.query(
        "UPDATE digital_entitlements SET status = 'revoked', updated_at = NOW() WHERE id = ?",
        [id]
      );
      if (ent.license_key_id) {
        await pool.query(
          "UPDATE license_keys SET status = 'revoked', updated_at = NOW() WHERE id = ?",
          [ent.license_key_id]
        );
      }

      await AuditService.log({
        userId: req.user?.id,
        action: 'digital.entitlements.revoke',
        entityType: 'digital_entitlements',
        entityId: String(id),
        beforeValues: ent,
        ipAddress: req.ip,
      });

      return reply.send({ success: true });
    }
  );
};

export const digitalModuleManifest: ModuleManifest = {
  name: 'digital-delivery',
  version: '0.1.0',
  description: 'Digital delivery of downloadable assets, tokenized link expiration, and license key pools',
  isCore: false,
  permissions: [
    { key: 'digital.view', description: 'View digital assets, entitlements, and license keys' },
    { key: 'digital.manage', description: 'Manage digital product files, license pools, and revoke entitlements' },
  ],
  adminNav: [
    {
      id: 'digital-assets',
      label: 'Digital Assets',
      route: '/admin/digital/assets',
      permission: 'digital.view',
      order: 36,
    },
    {
      id: 'digital-licenses',
      label: 'License Keys',
      route: '/admin/digital/licenses',
      permission: 'digital.view',
      order: 37,
    },
  ],
  routesPrefix: '/digital',
  routes: digitalRoutes,
};
