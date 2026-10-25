import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { moduleRegistry } from '../src/modules/registry.js';
import { shippingModuleManifest } from '../src/modules/shipping/index.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { ShippingService } from '../src/modules/shipping/service.js';
import { StoreService } from '../src/modules/store/service.js';
import { TaxEngine } from '../src/modules/store/tax.js';
import { authService } from '../src/auth/service.js';
import { RowDataPacket } from 'mysql2';

describe('Shipping Module & Partner Adapters (Sub-checkpoint CP-H2.3)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let customerToken: string;
  let testProductId: number;
  let testOrderId: number;

  beforeAll(async () => {
    await runMigrations();

    moduleRegistry.registerManifest(storeModuleManifest);
    moduleRegistry.registerManifest(shippingModuleManifest);
    moduleRegistry.setModuleState('store', true);
    moduleRegistry.setModuleState('shipping', true);

    app = buildApp();
    await app.ready();

    // Create admin user and customer user
    const adminEmail = `admin_ship_${Date.now()}@example.com`;
    const customerEmail = `cust_ship_${Date.now()}@example.com`;

    const adminUser = await authService.signup({ email: adminEmail, password: 'SecurePassword123!', name: 'Admin Shipper' });
    await authService.verifyEmail(adminUser.verificationToken);

    const conn = await pool.getConnection();
    try {
      await conn.query("UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1) WHERE id = ?", [adminUser.user.id]);
    } finally {
      conn.release();
    }

    const adminLogin = await authService.login({ email: adminEmail, password: 'SecurePassword123!' });
    adminToken = adminLogin.token!;

    const custUser = await authService.signup({ email: customerEmail, password: 'SecurePassword123!', name: 'Customer Shipper' });
    await authService.verifyEmail(custUser.verificationToken);

    const custLogin = await authService.login({ email: customerEmail, password: 'SecurePassword123!' });
    customerToken = custLogin.token!;

    // Reset shipping settings to defaults
    await ShippingService.updateSettings({
      originPincode: '400001',
      originCity: 'Mumbai',
      originState: '27',
      originCountry: 'IN',
      defaultPartner: 'manual',
      activePartners: ['manual', 'fake'],
      disabledBehavior: 'fallback_flat_rate',
      fallbackRatePaise: 5000,
      freeShippingThresholdPaise: 100000, // Rs 1000
    });

    // Create physical product for test orders
    const [prodRes] = await pool.query<any>(
      `INSERT INTO products (name, slug, price, product_type, stock_quantity, weight_grams, status)
       VALUES ('Shippable Widget', 'shippable-widget-${Date.now()}', 40000, 'physical', 100, 750, 'active')`
    );
    testProductId = prodRes.insertId;

    // Create an initial test order
    const checkoutResult = await StoreService.checkout({
      customerEmail: 'test_ship_order@example.com',
      paymentMethod: 'cod',
      items: [{ productId: testProductId, quantity: 1 }],
      billingAddress: {
        line1: '123 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        country: 'IN',
      },
      shippingAddress: {
        name: 'Test Recipient',
        phone: '9876543210',
        line1: '123 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        country: 'IN',
      },
      billingState: '27',
    });
    testOrderId = checkoutResult.order.id;
  });

  afterAll(async () => {
    // Restore modules
    moduleRegistry.setModuleState('shipping', true);
    moduleRegistry.setModuleState('store', true);
    await app.close();
  });

  beforeEach(async () => {
    moduleRegistry.setModuleState('shipping', true);
  });

  // 1. Zone & Rates CRUD
  it('1. Zones CRUD: lists, creates, updates, and deletes shipping zones and rates via admin API', async () => {
    // List zones
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/shipping/zones',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const zones = JSON.parse(listRes.body).data;
    expect(Array.isArray(zones)).toBe(true);

    // Create new zone for Metro cities
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/shipping/zones',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Metro Fast Delivery',
        countries: ['IN'],
        states: ['27', '07', '29'], // MH, DL, KA
        pincodes: ['400*', '110*', '560*'],
        priority: 10,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const newZone = JSON.parse(createRes.body).data;
    expect(newZone.name).toBe('Metro Fast Delivery');
    expect(newZone.priority).toBe(10);

    // Add rate tier to zone
    const rateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/shipping/zones/${newZone.id}/rates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Same Day Metro Express',
        rateType: 'weight_based',
        minWeightGrams: 0,
        maxWeightGrams: 1000,
        ratePaise: 12000, // Rs 120
        estimatedDaysMin: 1,
        estimatedDaysMax: 1,
      },
    });
    expect(rateRes.statusCode).toBe(201);
    const updatedZone = JSON.parse(rateRes.body).data;
    expect(updatedZone.rates.some((r: any) => r.ratePaise === 12000)).toBe(true);

    // Clean up created zone
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/shipping/zones/${newZone.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.statusCode).toBe(200);
  });

  // 2. Zone matching & weight-tier calculation
  it('2. Rate Calculation: evaluates weight tiers and pincode/state zone matching accurately', async () => {
    const rates = await ShippingService.calculateShipping({
      items: [
        {
          productId: testProductId,
          productType: 'physical',
          quantity: 2,
          pricePaise: 40000,
          weightGrams: 750, // 2 * 750 = 1500g (Tier 2: 501g - 2000g)
        },
      ],
      destination: {
        country: 'IN',
        state: '27',
        pincode: '400001',
      },
    });

    expect(Array.isArray(rates)).toBe(true);
    expect(rates.length).toBeGreaterThan(0);

    // Standard Ground Delivery for 1500g is 9000 paise (Rs 90)
    const standardRate = rates.find((r) => r.partner === 'manual');
    expect(standardRate).toBeDefined();
    expect(standardRate?.amountPaise).toBe(9000);
  });

  // 3. Free shipping threshold
  it('3. Free shipping threshold: grants 0 paise shipping when cart total exceeds threshold', async () => {
    await ShippingService.updateSettings({ freeShippingThresholdPaise: 50000 }); // Rs 500

    const rates = await ShippingService.calculateShipping({
      items: [
        {
          productId: testProductId,
          productType: 'physical',
          quantity: 2,
          pricePaise: 30000, // Total 60000 paise > 50000 threshold
          weightGrams: 500,
        },
      ],
      destination: { pincode: '400001' },
    });

    expect(rates.length).toBe(1);
    expect(rates[0].code).toBe('free_shipping');
    expect(rates[0].amountPaise).toBe(0);

    // Reset threshold
    await ShippingService.updateSettings({ freeShippingThresholdPaise: 100000 });
  });

  // 4. Digital orders free shipping
  it('4. Digital orders: returns instant digital delivery with 0 paise and 0 days', async () => {
    const rates = await ShippingService.calculateShipping({
      items: [
        {
          productType: 'digital',
          quantity: 1,
          pricePaise: 19900,
        },
      ],
      destination: { pincode: '400001' },
    });

    expect(rates.length).toBe(1);
    expect(rates[0].code).toBe('digital_delivery');
    expect(rates[0].amountPaise).toBe(0);
    expect(rates[0].estimatedDaysMin).toBe(0);
  });

  // 5. Serviceability endpoint
  it('5. Serviceability check: correctly verifies serviceable and blocked pincodes', async () => {
    // Valid pincode
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/v1/shipping/serviceability',
      payload: {
        pincode: '400001',
        weightGrams: 500,
        cod: true,
      },
    });
    expect(validRes.statusCode).toBe(200);
    expect(JSON.parse(validRes.body).serviceable).toBe(true);

    // Blocked pincode (000000)
    const invalidRes = await app.inject({
      method: 'POST',
      url: '/api/v1/shipping/serviceability',
      payload: {
        pincode: '000000',
        weightGrams: 500,
        cod: true,
      },
    });
    expect(invalidRes.statusCode).toBe(200);
    expect(JSON.parse(invalidRes.body).serviceable).toBe(false);
  });

  // 6. Fake adapter integration
  it('6. Fake Partner Adapter: provides controllable test rates, serviceability, and AWB', async () => {
    const fakeAdapter = ShippingService.getFakeAdapter();
    const serviceCheck = await fakeAdapter.checkServiceability('400001', 500, true);
    expect(serviceCheck.serviceable).toBe(true);

    const blockedCheck = await fakeAdapter.checkServiceability('111111', 500, false);
    expect(blockedCheck.serviceable).toBe(false);

    const rates = await fakeAdapter.calculateRates({
      fromPincode: '400001',
      toPincode: '560001',
      weightGrams: 1000,
      cod: false,
      declaredValuePaise: 20000,
    });
    expect(rates.length).toBe(2); // standard + express
    expect(rates[0].partner).toBe('fake');
  });

  // 7. Shipment creation & order update
  it('7. Shipment manifestation: creates shipment, generates AWB, and updates order tracking info', async () => {
    const createShipmentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/shipping/shipments',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        orderId: testOrderId,
        partner: 'manual',
        weightGrams: 750,
        carrierName: 'Express Cargo',
      },
    });

    expect(createShipmentRes.statusCode).toBe(201);
    const shipment = JSON.parse(createShipmentRes.body).data;
    expect(shipment.awb).toBeDefined();
    expect(shipment.trackingNumber).toBeDefined();
    expect(shipment.carrierName).toBe('Express Cargo');

    // Verify order was updated with tracking info and status processing
    const order = await StoreService.getOrderById(testOrderId);
    expect(order?.status).toBe('processing');
    expect(order?.shippingAwb).toBe(shipment.awb);
    expect(order?.trackingNumber).toBe(shipment.trackingNumber);
    expect(order?.shippingCarrier).toBe('Express Cargo');

    // Verify order items fulfilmentStatus updated to fulfilled
    const [items] = await pool.query<RowDataPacket[]>(
      'SELECT fulfilment_status FROM order_items WHERE order_id = ?',
      [testOrderId]
    );
    expect(items[0].fulfilment_status).toBe('fulfilled');
  });

  // 8. Tracking lookup
  it('8. Live tracking: returns shipment tracking details and history events', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, awb FROM shipping_shipments WHERE order_id = ? LIMIT 1',
      [testOrderId]
    );
    const shipment = rows[0];

    const trackRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/shipping/shipments/${shipment.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(trackRes.statusCode).toBe(200);
    const tracking = JSON.parse(trackRes.body).data;
    expect(tracking.awb).toBe(shipment.awb);
    expect(tracking.status).toBe('manifested');
    expect(Array.isArray(tracking.events)).toBe(true);
  });

  // 9. Shipping label endpoint
  it('9. Shipping label: serves downloadable label URL for warehouse packing', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM shipping_shipments WHERE order_id = ? LIMIT 1',
      [testOrderId]
    );
    const shipmentId = rows[0].id;

    const labelRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/shipping/shipments/${shipmentId}/label`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(labelRes.statusCode).toBe(200);
    const data = JSON.parse(labelRes.body).data;
    expect(data.labelUrl).toBeDefined();
    expect(data.awb).toBeDefined();
  });

  // 10. Carrier tracking webhook: in_transit update
  it('10. Inbound webhook (in_transit): updates shipment status and logs tracking event', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT awb FROM shipping_shipments WHERE order_id = ? LIMIT 1',
      [testOrderId]
    );
    const awb = rows[0].awb;

    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/shipping/webhook/fake',
      payload: {
        awb,
        status: 'in_transit',
        activity: 'Departed Mumbai Central Sorting Hub',
      },
    });

    expect(webhookRes.statusCode).toBe(200);
    expect(JSON.parse(webhookRes.body).processed).toBe(true);

    const [shipmentRows] = await pool.query<RowDataPacket[]>(
      'SELECT status, tracking_history_json FROM shipping_shipments WHERE awb = ?',
      [awb]
    );
    expect(shipmentRows[0].status).toBe('in_transit');

    const rawHistory = shipmentRows[0].tracking_history_json;
    const history = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
    expect(history.some((h: any) => h.activity.includes('Departed Mumbai'))).toBe(true);
  });

  // 11. Carrier tracking webhook: delivered update triggers order completion
  it('11. Inbound webhook (delivered): automatically marks order fulfilled and closes items', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT awb FROM shipping_shipments WHERE order_id = ? LIMIT 1',
      [testOrderId]
    );
    const awb = rows[0].awb;

    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/shipping/webhook/fake',
      payload: {
        awb,
        status: 'delivered',
        activity: 'Delivered to recipient with digital signature',
      },
    });

    expect(webhookRes.statusCode).toBe(200);

    // Verify order transitioned to fulfilled
    const order = await StoreService.getOrderById(testOrderId);
    expect(order?.status).toBe('fulfilled');

    // Verify order_status_history recorded
    const [historyRows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM order_status_history WHERE order_id = ? AND to_status = "fulfilled"',
      [testOrderId]
    );
    expect(historyRows.length).toBeGreaterThan(0);
    expect(historyRows[0].actor).toBe('system_webhook');
  });

  // 12. Disabling shipping module with block_physical behavior
  it('12. Module Disabling: blocks checkout of physical products when disabledBehavior is block_physical', async () => {
    // Set setting to block_physical
    await ShippingService.updateSettings({ disabledBehavior: 'block_physical' });

    // Disable shipping module in registry
    moduleRegistry.setModuleState('shipping', false);

    // Physical order checkout must fail with 422 SHIPPING_DISABLED
    await expect(
      StoreService.checkout({
        customerEmail: 'block_test@example.com',
        paymentMethod: 'cod',
        items: [{ productId: testProductId, quantity: 1 }],
        billingState: '27',
        shippingAddress: { pincode: '400001', state: '27' },
      })
    ).rejects.toThrow(/disabled for physical goods/);
  });

  // 13. Disabling shipping module with fallback_flat_rate behavior
  it('13. Module Disabling: succeeds with fallback flat rate when disabledBehavior is fallback_flat_rate', async () => {
    // Set setting to fallback_flat_rate
    await ShippingService.updateSettings({
      disabledBehavior: 'fallback_flat_rate',
      fallbackRatePaise: 7500, // Rs 75
    });

    // Shipping module is still disabled
    moduleRegistry.setModuleState('shipping', false);

    // Physical checkout should succeed using the fallback flat rate
    const res = await StoreService.checkout({
      customerEmail: 'flat_fallback@example.com',
      paymentMethod: 'cod',
      items: [{ productId: testProductId, quantity: 1 }],
      billingState: '27',
      shippingAddress: { pincode: '400001', state: '27' },
    });

    expect(res.order).toBeDefined();
    expect(res.order.shippingTotal).toBe(7500);

    // Restore module
    moduleRegistry.setModuleState('shipping', true);
  });

  // 14. Data integrity after module toggle
  it('14. Data persistence: shipping zones and shipments stay intact across module disable and enable', async () => {
    // Disable module
    moduleRegistry.setModuleState('shipping', false);

    // Re-enable module
    moduleRegistry.setModuleState('shipping', true);

    const zones = await ShippingService.listZones();
    expect(zones.length).toBeGreaterThan(0);

    const [shipmentRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM shipping_shipments WHERE order_id = ?',
      [testOrderId]
    );
    expect(shipmentRows.length).toBeGreaterThan(0);
  });

  // 15. RBAC enforcement
  it('15. RBAC: non-admin gets 403 on admin shipping routes and disabled module returns 404', async () => {
    // Customer user gets 403 on admin shipping settings
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/shipping/settings',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // Disable shipping module -> returns 404 MODULE_DISABLED on admin route
    moduleRegistry.setModuleState('shipping', false);

    const disabledRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/shipping/settings',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(disabledRes.statusCode).toBe(404);
    expect(JSON.parse(disabledRes.body).error.code).toBe('MODULE_DISABLED');

    // Restore
    moduleRegistry.setModuleState('shipping', true);
  });

  // 16. Shipment cancellation
  it('16. Shipment cancellation: cancels shipment with carrier and updates status in database', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM shipping_shipments WHERE order_id = ? LIMIT 1',
      [testOrderId]
    );
    const shipmentId = rows[0].id;

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/shipping/shipments/${shipmentId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(JSON.parse(cancelRes.body).success).toBe(true);

    const [shipmentRows] = await pool.query<RowDataPacket[]>(
      'SELECT status FROM shipping_shipments WHERE id = ?',
      [shipmentId]
    );
    expect(shipmentRows[0].status).toBe('cancelled');
  });
});
