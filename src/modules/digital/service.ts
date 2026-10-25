import { pool } from '../../db/pool.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomBytes, createHash } from 'crypto';
import { cache } from '../../cache/index.js';
import { PoolConnection } from 'mysql2/promise';

export interface DigitalAssetRecord {
  id: number;
  productId: number;
  variantId: number | null;
  fileName: string;
  storagePath: string;
  fileSizeBytes: number;
  mimeType: string;
  downloadLimit: number;
  expiresHours: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseKeyRecord {
  id: number;
  productId: number;
  variantId: number | null;
  licenseKey: string;
  status: 'available' | 'assigned' | 'revoked';
  orderId: number | null;
  orderItemId: number | null;
  assignedAt: string | null;
  metadataJson: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DigitalEntitlementRecord {
  id: number;
  orderId: number;
  orderItemId: number;
  customerId: number | null;
  assetId: number | null;
  licenseKeyId: number | null;
  downloadToken: string;
  downloadCount: number;
  maxDownloads: number;
  expiresAt: string | null;
  status: 'active' | 'revoked' | 'expired';
  asset?: {
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  } | null;
  license?: {
    licenseKey: string;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export class DigitalDeliveryService {
  // 1. Digital Assets CRUD
  static async createAsset(data: {
    productId: number;
    variantId?: number | null;
    fileName: string;
    storagePath: string;
    fileSizeBytes?: number;
    mimeType?: string;
    downloadLimit?: number;
    expiresHours?: number;
  }): Promise<DigitalAssetRecord> {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO digital_assets (
        product_id, variant_id, file_name, storage_path, file_size_bytes, mime_type, download_limit, expires_hours, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        data.productId,
        data.variantId || null,
        data.fileName,
        data.storagePath,
        data.fileSizeBytes || 0,
        data.mimeType || 'application/octet-stream',
        data.downloadLimit ?? 5,
        data.expiresHours ?? 72,
      ]
    );

    const asset = await this.getAssetById(res.insertId);
    if (!asset) throw new Error('Failed to retrieve created digital asset');
    return asset;
  }

  static async getAssetById(id: number): Promise<DigitalAssetRecord | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM digital_assets WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      productId: Number(r.product_id),
      variantId: r.variant_id ? Number(r.variant_id) : null,
      fileName: r.file_name,
      storagePath: r.storage_path,
      fileSizeBytes: Number(r.file_size_bytes),
      mimeType: r.mime_type,
      downloadLimit: Number(r.download_limit),
      expiresHours: Number(r.expires_hours),
      isActive: Boolean(r.is_active),
      version: Number(r.version),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  static async listAssets(productId?: number): Promise<DigitalAssetRecord[]> {
    let sql = 'SELECT * FROM digital_assets WHERE is_active = TRUE';
    const params: any[] = [];
    if (productId) {
      sql += ' AND product_id = ?';
      params.push(productId);
    }
    sql += ' ORDER BY id DESC';

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      productId: Number(r.product_id),
      variantId: r.variant_id ? Number(r.variant_id) : null,
      fileName: r.file_name,
      storagePath: r.storage_path,
      fileSizeBytes: Number(r.file_size_bytes),
      mimeType: r.mime_type,
      downloadLimit: Number(r.download_limit),
      expiresHours: Number(r.expires_hours),
      isActive: Boolean(r.is_active),
      version: Number(r.version),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  static async deleteAsset(id: number): Promise<boolean> {
    const [res] = await pool.query<ResultSetHeader>(
      'UPDATE digital_assets SET is_active = FALSE WHERE id = ?',
      [id]
    );
    return res.affectedRows > 0;
  }

  // 2. License Keys Pool
  static async addKeysToPool(data: {
    productId: number;
    variantId?: number | null;
    keys: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ addedCount: number; duplicateCount: number }> {
    let addedCount = 0;
    let duplicateCount = 0;

    for (const key of data.keys) {
      const trimmed = key.trim();
      if (!trimmed) continue;
      try {
        await pool.query(
          `INSERT INTO license_keys (product_id, variant_id, license_key, status, metadata_json)
           VALUES (?, ?, ?, 'available', ?)`,
          [
            data.productId,
            data.variantId || null,
            trimmed,
            data.metadata ? JSON.stringify(data.metadata) : null,
          ]
        );
        addedCount++;
      } catch (err: any) {
        if (err.code === 'ER_DUP_ENTRY') {
          duplicateCount++;
        } else {
          throw err;
        }
      }
    }

    return { addedCount, duplicateCount };
  }

  static async listKeys(params: {
    productId?: number;
    status?: 'available' | 'assigned' | 'revoked';
    limit?: number;
    offset?: number;
  }): Promise<{ keys: LicenseKeyRecord[]; total: number }> {
    let sql = 'SELECT * FROM license_keys WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM license_keys WHERE 1=1';
    const queryParams: any[] = [];

    if (params.productId) {
      sql += ' AND product_id = ?';
      countSql += ' AND product_id = ?';
      queryParams.push(params.productId);
    }
    if (params.status) {
      sql += ' AND status = ?';
      countSql += ' AND status = ?';
      queryParams.push(params.status);
    }

    const [countRows] = await pool.query<RowDataPacket[]>(countSql, queryParams);
    const total = Number(countRows[0]?.total || 0);

    const limit = params.limit || 50;
    const offset = params.offset || 0;
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const [rows] = await pool.query<RowDataPacket[]>(sql, queryParams);
    const keys: LicenseKeyRecord[] = rows.map((r) => ({
      id: Number(r.id),
      productId: Number(r.product_id),
      variantId: r.variant_id ? Number(r.variant_id) : null,
      licenseKey: r.license_key,
      status: r.status,
      orderId: r.order_id ? Number(r.order_id) : null,
      orderItemId: r.order_item_id ? Number(r.order_item_id) : null,
      assignedAt: r.assigned_at ? new Date(r.assigned_at).toISOString() : null,
      metadataJson: typeof r.metadata_json === 'string' ? JSON.parse(r.metadata_json) : r.metadata_json,
      version: Number(r.version),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));

    return { keys, total };
  }

  static async verifyLicenseKey(licenseKey: string): Promise<{
    valid: boolean;
    status?: string;
    productId?: number;
    assignedAt?: string | null;
    message?: string;
  }> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM license_keys WHERE license_key = ? LIMIT 1',
      [licenseKey.trim()]
    );

    if (rows.length === 0) {
      return { valid: false, message: 'License key not found' };
    }

    const key = rows[0];
    if (key.status === 'revoked') {
      return { valid: false, status: 'revoked', message: 'License key has been revoked' };
    }

    if (key.status === 'available') {
      return { valid: false, status: 'available', message: 'License key is unassigned' };
    }

    return {
      valid: true,
      status: key.status,
      productId: Number(key.product_id),
      assignedAt: key.assigned_at ? new Date(key.assigned_at).toISOString() : null,
      message: 'License key is active and valid',
    };
  }

  // 3. Entitlement Issuance on Paid
  static async issueEntitlementsForOrder(
    orderId: number,
    connection?: PoolConnection
  ): Promise<DigitalEntitlementRecord[]> {
    const conn = connection || (await pool.getConnection());
    const shouldRelease = !connection;

    try {
      // 1. Fetch order and digital items
      const [orderRows] = await conn.query<RowDataPacket[]>(
        'SELECT id, customer_id FROM orders WHERE id = ? LIMIT 1',
        [orderId]
      );
      if (orderRows.length === 0) throw new Error(`Order ${orderId} not found`);
      const order = orderRows[0];
      const customerId = order.customer_id ? Number(order.customer_id) : null;

      const [items] = await conn.query<RowDataPacket[]>(
        `SELECT oi.*, p.product_type 
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ? AND p.product_type = 'digital'`,
        [orderId]
      );

      const generatedEntitlements: DigitalEntitlementRecord[] = [];

      for (const item of items) {
        const orderItemId = Number(item.id);
        const productId = Number(item.product_id);
        const variantId = item.variant_id ? Number(item.variant_id) : null;
        const quantity = Number(item.quantity);

        // Find associated digital asset(s)
        const [assetRows] = await conn.query<RowDataPacket[]>(
          `SELECT * FROM digital_assets 
           WHERE product_id = ? AND is_active = TRUE 
           AND (variant_id IS NULL OR variant_id = ?) 
           LIMIT 1`,
          [productId, variantId]
        );
        const asset = assetRows[0] || null;

        // Process entitlements per quantity unit
        for (let q = 0; q < quantity; q++) {
          // Check if license key pooling is configured for this product
          let licenseKeyId: number | null = null;
          const [availableKeys] = await conn.query<RowDataPacket[]>(
            `SELECT id FROM license_keys 
             WHERE product_id = ? AND status = 'available' 
             AND (variant_id IS NULL OR variant_id = ?) 
             LIMIT 1 FOR UPDATE`,
            [productId, variantId]
          );

          if (availableKeys.length > 0) {
            licenseKeyId = Number(availableKeys[0].id);
            await conn.query(
              `UPDATE license_keys 
               SET status = 'assigned', order_id = ?, order_item_id = ?, assigned_at = NOW() 
               WHERE id = ?`,
              [orderId, orderItemId, licenseKeyId]
            );
          }

          // Generate secure, cryptographically random download token
          const downloadToken = `dl_${randomBytes(24).toString('hex')}`;
          const maxDownloads = asset ? Number(asset.download_limit) : 5;
          const expiresHours = asset ? Number(asset.expires_hours) : 72;
          const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000);

          const [entRes] = await conn.query<ResultSetHeader>(
            `INSERT INTO digital_entitlements (
              order_id, order_item_id, customer_id, asset_id, license_key_id, 
              download_token, download_count, max_downloads, expires_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'active')`,
            [
              orderId,
              orderItemId,
              customerId,
              asset ? Number(asset.id) : null,
              licenseKeyId,
              downloadToken,
              maxDownloads,
              expiresAt,
            ]
          );

          generatedEntitlements.push({
            id: entRes.insertId,
            orderId,
            orderItemId,
            customerId,
            assetId: asset ? Number(asset.id) : null,
            licenseKeyId,
            downloadToken,
            downloadCount: 0,
            maxDownloads,
            expiresAt: expiresAt.toISOString(),
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        // Update item line fulfillment status
        await conn.query(
          "UPDATE order_items SET fulfilment_status = 'fulfilled' WHERE id = ?",
          [orderItemId]
        );
      }

      return generatedEntitlements;
    } finally {
      if (shouldRelease) conn.release();
    }
  }

  // 4. Revocation on Refund
  static async revokeEntitlementsForOrder(
    orderId: number,
    orderItemId?: number,
    connection?: PoolConnection
  ): Promise<number> {
    const conn = connection || (await pool.getConnection());
    const shouldRelease = !connection;

    try {
      let entSql = "UPDATE digital_entitlements SET status = 'revoked', updated_at = NOW() WHERE order_id = ?";
      const entParams: any[] = [orderId];
      if (orderItemId) {
        entSql += ' AND order_item_id = ?';
        entParams.push(orderItemId);
      }

      const [entRes] = await conn.query<ResultSetHeader>(entSql, entParams);

      // Revoke any assigned license keys
      let keySql = "UPDATE license_keys SET status = 'revoked', updated_at = NOW() WHERE order_id = ?";
      const keyParams: any[] = [orderId];
      if (orderItemId) {
        keySql += ' AND order_item_id = ?';
        keyParams.push(orderItemId);
      }

      await conn.query(keySql, keyParams);

      // Update line items fulfilment_status to revoked
      let itemSql = "UPDATE order_items SET fulfilment_status = 'revoked' WHERE order_id = ?";
      const itemParams: any[] = [orderId];
      if (orderItemId) {
        itemSql += ' AND id = ?';
        itemParams.push(orderItemId);
      }
      await conn.query(itemSql, itemParams);

      return entRes.affectedRows;
    } finally {
      if (shouldRelease) conn.release();
    }
  }

  // 5. Customer Access & Secure Download
  static async getOrderEntitlements(orderId: number): Promise<DigitalEntitlementRecord[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        de.*,
        da.file_name as asset_file_name,
        da.file_size_bytes as asset_size,
        da.mime_type as asset_mime,
        lk.license_key as license_key_plain,
        lk.status as license_status
       FROM digital_entitlements de
       LEFT JOIN digital_assets da ON de.asset_id = da.id
       LEFT JOIN license_keys lk ON de.license_key_id = lk.id
       WHERE de.order_id = ?
       ORDER BY de.id ASC`,
      [orderId]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      orderId: Number(r.order_id),
      orderItemId: Number(r.order_item_id),
      customerId: r.customer_id ? Number(r.customer_id) : null,
      assetId: r.asset_id ? Number(r.asset_id) : null,
      licenseKeyId: r.license_key_id ? Number(r.license_key_id) : null,
      downloadToken: r.download_token,
      downloadCount: Number(r.download_count),
      maxDownloads: Number(r.max_downloads),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      status: r.status,
      asset: r.asset_file_name
        ? {
            fileName: r.asset_file_name,
            fileSizeBytes: Number(r.asset_size),
            mimeType: r.asset_mime,
          }
        : null,
      license: r.license_key_plain
        ? {
            licenseKey: r.license_key_plain,
            status: r.license_status,
          }
        : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  static async processDownload(downloadToken: string): Promise<{
    allowed: boolean;
    reason?: string;
    asset?: DigitalAssetRecord;
    remainingDownloads?: number;
  }> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM digital_entitlements WHERE download_token = ? LIMIT 1 FOR UPDATE',
        [downloadToken]
      );

      if (rows.length === 0) {
        await connection.rollback();
        return { allowed: false, reason: 'Invalid or expired download token' };
      }

      const ent = rows[0];

      if (ent.status === 'revoked') {
        await connection.rollback();
        return { allowed: false, reason: 'This entitlement has been revoked' };
      }

      if (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
        await connection.query(
          "UPDATE digital_entitlements SET status = 'expired' WHERE id = ?",
          [ent.id]
        );
        await connection.commit();
        return { allowed: false, reason: 'Download link has expired' };
      }

      if (Number(ent.download_count) >= Number(ent.max_downloads)) {
        await connection.rollback();
        return { allowed: false, reason: 'Maximum download limit exceeded' };
      }

      // Increment download count atomically
      await connection.query(
        'UPDATE digital_entitlements SET download_count = download_count + 1, updated_at = NOW() WHERE id = ?',
        [ent.id]
      );

      let asset: DigitalAssetRecord | undefined;
      if (ent.asset_id) {
        const [assetRows] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM digital_assets WHERE id = ? LIMIT 1',
          [ent.asset_id]
        );
        if (assetRows.length > 0) {
          const a = assetRows[0];
          asset = {
            id: Number(a.id),
            productId: Number(a.product_id),
            variantId: a.variant_id ? Number(a.variant_id) : null,
            fileName: a.file_name,
            storagePath: a.storage_path,
            fileSizeBytes: Number(a.file_size_bytes),
            mimeType: a.mime_type,
            downloadLimit: Number(a.download_limit),
            expiresHours: Number(a.expires_hours),
            isActive: Boolean(a.is_active),
            version: Number(a.version),
            createdAt: new Date(a.created_at).toISOString(),
            updatedAt: new Date(a.updated_at).toISOString(),
          };
        }
      }

      await connection.commit();

      const remaining = Number(ent.max_downloads) - (Number(ent.download_count) + 1);
      return {
        allowed: true,
        asset,
        remainingDownloads: Math.max(0, remaining),
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}
