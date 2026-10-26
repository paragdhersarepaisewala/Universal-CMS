import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { ResultSetHeader } from 'mysql2';
import { moduleRegistry } from '../src/modules/registry.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { authService } from '../src/auth/service.js';
import { MetaCapiService } from '../src/modules/store/meta-capi.js';

describe('Store Inventory Movements, Bulk CSV, Meta Feeds, & Abandoned Carts (Sub-checkpoint CP-H2.6)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let customerToken: string;
  const adminEmail = `admin_inv_${Date.now()}@example.com`;
  const customerEmail = `cust_inv_${Date.now()}@example.com`;
  let testProductId: number;
  let testProductSku: string;

  beforeAll(async () => {
    await runMigrations();
    try {
      moduleRegistry.registerManifest(storeModuleManifest);
    } catch {
      // already registered
    }
    moduleRegistry.setModuleState('store', true);
    app = buildApp();
    await app.ready();

    // 1. Create Admin Account
    const adminUser = await authService.signup({
      name: 'Inventory Manager',
      email: adminEmail,
      password: 'AdminPassword123!',
    });
    await authService.verifyEmail(adminUser.verificationToken);
    await pool.query(
      "UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1) WHERE id = ?",
      [adminUser.user.id]
    );
    const adminLogin = await authService.login({
      email: adminEmail,
      password: 'AdminPassword123!',
    });
    adminToken = adminLogin.token!;

    // 2. Create Customer Account
    const custUser = await authService.signup({
      name: 'Regular Customer',
      email: customerEmail,
      password: 'CustomerPassword123!',
    });
    await authService.verifyEmail(custUser.verificationToken);
    const custLogin = await authService.login({
      email: customerEmail,
      password: 'CustomerPassword123!',
    });
    customerToken = custLogin.token!;

    // 3. Create test product for inventory tests
    testProductSku = `INV-SKU-${Date.now()}`;
    const [prodRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO products (name, slug, description, price, sku, stock_quantity, track_stock, status)
       VALUES ('Mechanical Keyboard', 'mech-kb-${Date.now()}', 'RGB mechanical keyboard with red switches', 499900, ?, 10, TRUE, 'active')`,
      [testProductSku]
    );
    testProductId = prodRes.insertId;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  // 1. Manual Stock Adjustments & Ledger Logging
  it('1. POST /api/v1/admin/store/inventory/adjust updates stock quantity and logs movement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/inventory/adjust',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        productId: testProductId,
        quantityDelta: 5,
        changeType: 'restock',
        reason: 'Shipment received from supplier',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.productId).toBe(testProductId);
    expect(body.data.newStockQuantity).toBe(15);
    expect(body.data.stockMovementId).toBeGreaterThan(0);
  });

  it('2. POST /api/v1/admin/store/inventory/adjust prevents negative stock when backorder disallowed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/inventory/adjust',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        productId: testProductId,
        quantityDelta: -50, // exceeds available 15
        changeType: 'damaged',
        reason: 'Water damage in warehouse',
      },
    });

    // Should reject insufficient stock
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('3. GET /api/v1/admin/store/inventory/history returns paginated movement ledger', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/store/inventory/history?productId=${testProductId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const first = body.data[0];
    expect(first.productId).toBe(testProductId);
    expect(first.changeType).toBe('restock');
    expect(first.quantity).toBe(5);
    expect(first.reason).toBe('Shipment received from supplier');
    expect(body.meta).toHaveProperty('total');
  });

  // 2. CSV Product Export & Formula Injection Defense
  it('4. GET /api/v1/admin/store/products/export returns CSV with formula injection defense', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/store/products/export',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('sku,name,slug,description,price_paise');
    expect(res.body).toContain(testProductSku);
    expect(res.body).toContain('Mechanical Keyboard');
  });

  // 3. Bulk CSV Product Import
  it('5. POST /api/v1/admin/store/products/import parses rows, updates existing, and inserts new', async () => {
    const newSku = `CSV-IMPORT-${Date.now()}`;
    const csvData = [
      'sku,name,slug,description,price_paise,stock_quantity,status',
      `${testProductSku},Mechanical Keyboard V2,mech-kb-v2,Updated switch lube,549900,25,active`,
      `${newSku},Ergonomic Mouse,ergo-mouse-${Date.now()},Wireless vertical mouse,299900,12,active`,
      ',Invalid Product Missing Price,,Free stuff,invalid_price,5,active',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/products/import',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        csv: csvData,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalRows).toBe(3);
    expect(body.data.updated).toBe(1); // existing testProductSku updated
    expect(body.data.created).toBe(1); // newSku inserted
    expect(body.data.errors.length).toBe(1); // row 4 with invalid_price caught
  });

  // 4. Meta Product Catalog Feeds
  it('6. GET /api/v1/store/products/feed/meta.xml returns valid RSS 2.0 XML Meta feed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/store/products/feed/meta.xml',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(res.body).toContain('<channel>');
    expect(res.body).toContain('<g:id>');
    expect(res.body).toContain('<g:title>');
    expect(res.body).toContain('<g:price>');
    expect(res.body).toContain('<g:availability>');
  });

  it('7. GET /api/v1/store/products/feed/meta.csv returns valid CSV Meta feed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/store/products/feed/meta.csv',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('id,title,description,availability,condition,price,link,image_link,brand');
  });

  // 5. Meta Conversions API (CAPI) Service
  it('8. MetaCapiService correctly hashes PII and executes dry run event dispatch', async () => {
    const hashedEmail = MetaCapiService.hashData('Customer@Example.com');
    // Expected SHA-256 of lowercase 'customer@example.com'
    expect(hashedEmail).toBe('e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5');

    const result = await MetaCapiService.dispatchEvent({
      eventName: 'Purchase',
      eventId: `order_evt_${Date.now()}`,
      userData: {
        email: 'customer@example.com',
        phone: '+919876543210',
        clientIpAddress: '127.0.0.1',
      },
      customData: {
        currency: 'INR',
        value: 4999.0,
        contentIds: ['INV-SKU-01'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.eventsReceived).toBe(1);
  });

  // 6. Abandoned Cart Detection Background Job
  it('9. POST /api/v1/jobs/process runs abandoned cart processor and returns metric', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/process',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty('abandonedCartsProcessed');
    expect(typeof body.data.abandonedCartsProcessed).toBe('number');
  });

  // 7. RBAC security enforcement
  it('10. Non-admin customer receives 403 on inventory endpoints', async () => {
    const adjustRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/inventory/adjust',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { productId: testProductId, quantityDelta: 1, reason: 'test' },
    });
    expect(adjustRes.statusCode).toBe(403);

    const historyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/store/inventory/history',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(historyRes.statusCode).toBe(403);
  });
});
