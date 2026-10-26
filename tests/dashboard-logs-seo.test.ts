import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { ResultSetHeader } from 'mysql2';
import { moduleRegistry } from '../src/modules/registry.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { blogModuleManifest } from '../src/modules/blog/index.js';
import { authService } from '../src/auth/service.js';

describe('Admin Operations, Observability & Structured Data JSON-LD (Sub-checkpoint CP-H2.5)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let customerToken: string;
  const adminEmail = `admin_ops_${Date.now()}@example.com`;
  const customerEmail = `cust_ops_${Date.now()}@example.com`;
  let testProductId: number;
  let testProductSlug: string;
  let testPostId: number;
  let testPostSlug: string;

  beforeAll(async () => {
    await runMigrations();
    try {
      moduleRegistry.registerManifest(storeModuleManifest);
      moduleRegistry.registerManifest(blogModuleManifest);
    } catch {
      // already registered
    }
    moduleRegistry.setModuleState('store', true);
    moduleRegistry.setModuleState('blog', true);
    app = buildApp();
    await app.ready();

    // 1. Create Admin Account
    const adminUser = await authService.signup({
      name: 'Operations Admin',
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
      name: 'Normal Customer',
      email: customerEmail,
      password: 'CustomerPassword123!',
    });
    await authService.verifyEmail(custUser.verificationToken);
    const custLogin = await authService.login({
      email: customerEmail,
      password: 'CustomerPassword123!',
    });
    customerToken = custLogin.token!;

    // 3. Create test product for JSON-LD and metrics
    testProductSlug = `ops-product-${Date.now()}`;
    const testSku = `OPS-HD-${Date.now()}`;
    const [prodRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO products (name, slug, description, price, sku, stock_quantity, track_stock, status)
       VALUES ('Ops Headset Pro', ?, 'High quality active noise cancelling headset', 1299900, ?, 15, TRUE, 'active')`,
      [testProductSlug, testSku]
    );
    testProductId = prodRes.insertId;

    // 4. Create test blog post for JSON-LD and metrics
    testPostSlug = `ops-article-${Date.now()}`;
    const [postRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO blog_posts (title, slug, excerpt, content, author_id, status, reading_time_minutes)
       VALUES ('Future of Observability', ?, 'Summary of modern tracing', 'Full observability content here...', ?, 'published', 4)`,
      [testPostSlug, adminUser.user.id]
    );
    testPostId = postRes.insertId;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  // 1. Dashboard Statistics
  it('1. GET /api/v1/admin/dashboard/stats rejects unauthorized and non-admin requests', async () => {
    const unauth = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/stats',
    });
    expect(unauth.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/stats',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('2. GET /api/v1/admin/dashboard/stats returns consolidated metrics for authorized admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/stats',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();

    // Business metrics
    expect(body.data.business).toHaveProperty('totalOrders');
    expect(body.data.business).toHaveProperty('totalRevenuePaise');
    expect(body.data.business).toHaveProperty('pendingOrders');
    expect(body.data.business).toHaveProperty('averageOrderValuePaise');
    expect(typeof body.data.business.totalRevenuePaise).toBe('number');

    // Catalog metrics
    expect(body.data.catalog).toHaveProperty('totalProducts');
    expect(body.data.catalog.totalProducts).toBeGreaterThanOrEqual(1);
    expect(body.data.catalog).toHaveProperty('lowStockProducts');

    // Customer metrics
    expect(body.data.customers).toHaveProperty('totalCustomers');
    expect(body.data.customers).toHaveProperty('segments');
    expect(body.data.customers.segments).toHaveProperty('standard');

    // Content metrics
    expect(body.data.content).toHaveProperty('totalArticles');
    expect(body.data.content.totalArticles).toBeGreaterThanOrEqual(1);

    // System metrics
    expect(body.data.system).toHaveProperty('uptimeSeconds');
    expect(body.data.system).toHaveProperty('memoryUsageBytes');
    expect(body.data.system.memoryUsageBytes).toHaveProperty('heapUsed');
  });

  // 2. System and Error Logs
  it('3. GET /api/v1/admin/logs/system returns process runtime diagnostics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/logs/system',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty('uptimeSeconds');
    expect(body.data).toHaveProperty('nodeVersion');
    expect(body.data).toHaveProperty('memoryBytes');
    expect(body.data).toHaveProperty('jobsSummary');
    expect(body.data.jobsSummary).toHaveProperty('pending');
  });

  it('4. GET /api/v1/admin/logs/errors retrieves unified error logs with pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/logs/errors?page=1&perPage=10',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toBeDefined();
    expect(body.meta.page).toBe(1);
    expect(body.meta.perPage).toBe(10);
  });

  // 3. Email Logs & Automation Triggers
  it('5. GET /api/v1/admin/email/logs returns paginated dispatch history (and alias works)', async () => {
    const resSingular = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email/log',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(resSingular.statusCode).toBe(200);

    const resPlural = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email/logs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(resPlural.statusCode).toBe(200);
    const body = resPlural.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toBeDefined();
  });

  it('6. GET /api/v1/admin/email/automation lists events and PATCH updates toggle/subject', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email/automation',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json().data;
    expect(list.length).toBeGreaterThan(0);
    const firstEvent = list[0];

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/email/automation/${firstEvent.key}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        isEnabled: true,
        subject: 'Updated Notification Subject',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.subject).toBe('Updated Notification Subject');
  });

  // 4. Schema.org JSON-LD Structured Data
  it('7. GET /api/v1/seo/jsonld/organization returns valid Schema.org Organization', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/jsonld/organization',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/ld+json');
    const data = res.json();
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('Organization');
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('url');
  });

  it('8. GET /api/v1/seo/jsonld/website returns valid Schema.org WebSite with SearchAction', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/jsonld/website',
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('WebSite');
    expect(data.potentialAction).toBeDefined();
    expect(data.potentialAction['@type']).toBe('SearchAction');
  });

  it('9. GET /api/v1/seo/jsonld/product/:idOrSlug returns valid Schema.org Product with price in Rupees', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/seo/jsonld/product/${testProductSlug}`,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('Product');
    expect(data.name).toBe('Ops Headset Pro');
    expect(data.offers).toBeDefined();
    expect(data.offers['@type']).toBe('Offer');
    // 1299900 paise = 12999.00 INR
    expect(data.offers.price).toBe('12999.00');
    expect(data.offers.priceCurrency).toBe('INR');
    expect(data.offers.availability).toBe('https://schema.org/InStock');
  });

  it('10. GET /api/v1/seo/jsonld/article/:idOrSlug returns valid Schema.org NewsArticle', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/seo/jsonld/article/${testPostSlug}`,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('NewsArticle');
    expect(data.headline).toBe('Future of Observability');
    expect(data.description).toBe('Summary of modern tracing');
    expect(data.publisher).toBeDefined();
  });

  it('11. GET /api/v1/seo/jsonld/breadcrumb returns valid Schema.org BreadcrumbList', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/jsonld/breadcrumb?idOrSlug=products',
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement).toBeInstanceOf(Array);
    expect(data.itemListElement.length).toBeGreaterThanOrEqual(2);
    expect(data.itemListElement[0].name).toBe('Home');
    expect(data.itemListElement[1].name).toBe('products');
  });
});
