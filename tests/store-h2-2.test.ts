import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { pool } from '../src/db/pool.js';
import { RowDataPacket } from 'mysql2';
import { StoreService } from '../src/modules/store/service.js';
import { TaxEngine, DEFAULT_STORE_SETTINGS } from '../src/modules/store/tax.js';
import { InvoiceService } from '../src/modules/store/invoice.js';
import { authService } from '../src/auth/service.js';

import { moduleRegistry } from '../src/modules/registry.js';
import { storeModuleManifest } from '../src/modules/store/index.js';

describe('Sub-Checkpoint CP-H2.2: GST Taxes, Invoices, Credit Notes & COD Rules', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let customerToken: string;
  let normalProductId: number;

  beforeAll(async () => {
    // Enable store module
    moduleRegistry.registerManifest(storeModuleManifest);
    moduleRegistry.setModuleState('store', true);

    process.env.DB_POOL_SIZE = '5';
    process.env.STORE_ORDER_EXPIRY_MINUTES = '30';
    app = await buildApp();
    await app.ready();

    // Reset store settings to defaults
    await TaxEngine.updateStoreSettings(DEFAULT_STORE_SETTINGS);

    // Clean up test products and users
    const connection = await pool.getConnection();
    try {
      await connection.query('DELETE FROM products WHERE slug LIKE "test-tax-%"');
      await connection.query('DELETE FROM coupons WHERE code LIKE "TAX%"');
      await connection.query('DELETE FROM tax_classes WHERE name LIKE "Custom Test%"');
      await connection.query('DELETE FROM users WHERE email IN ("tax_admin@example.com", "tax_customer@example.com")');
    } finally {
      connection.release();
    }

    // Seed test users
    const adminUser = await authService.signup({
      name: 'Tax Admin',
      email: 'tax_admin@example.com',
      password: 'SecurePassword123!',
    });
    await authService.verifyEmail(adminUser.verificationToken);
    const conn = await pool.getConnection();
    try {
      await conn.query("UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1) WHERE id = ?", [adminUser.user.id]);
    } finally {
      conn.release();
    }
    const adminLogin = await authService.login({ email: 'tax_admin@example.com', password: 'SecurePassword123!' });
    adminToken = adminLogin.token!;

    const custUser = await authService.signup({
      name: 'Tax Customer',
      email: 'tax_customer@example.com',
      password: 'SecurePassword123!',
    });
    await authService.verifyEmail(custUser.verificationToken);
    const custLogin = await authService.login({ email: 'tax_customer@example.com', password: 'SecurePassword123!' });
    customerToken = custLogin.token!;

    // Create a standard test physical product (Rs 1,000.00 = 100000 paise)
    const p = await StoreService.createProduct({
      name: 'Test Taxable Cotton Shirt',
      slug: 'test-tax-cotton-shirt',
      price: 100000, // Rs 1000
      stockQuantity: 100,
      productType: 'physical',
      trackStock: true,
      status: 'active',
    });
    normalProductId = p.id;
  });

  afterAll(async () => {
    // Reset store settings
    await TaxEngine.updateStoreSettings(DEFAULT_STORE_SETTINGS);
    await app.close();
  });

  // 1. Intrastate GST (Maharashtra seller to Maharashtra buyer: 9% CGST + 9% SGST)
  it('1. intrastate GST: splits 18% into 9% CGST and 9% SGST for same-state buyer', async () => {
    const quote = await StoreService.quoteCart({
      items: [{ productId: normalProductId, quantity: 1 }],
      placeOfSupplyState: '27', // Maharashtra
    });

    expect(quote.isInterstate).toBe(false);
    expect(quote.usesUtgst).toBe(false);
    expect(quote.subtotal).toBe(100000); // Rs 1000
    expect(quote.taxableAmount).toBe(100000);
    expect(quote.cgstPaise).toBe(9000); // 9% = Rs 90
    expect(quote.sgstPaise).toBe(9000); // 9% = Rs 90
    expect(quote.utgstPaise).toBe(0);
    expect(quote.igstPaise).toBe(0);
    expect(quote.taxTotal).toBe(18000); // 18% = Rs 180
    expect(quote.total).toBe(118000); // Rs 1180
  });

  // 2. UTGST (Maharashtra seller to Union Territory without legislature: e.g. Chandigarh 04 or Ladakh 38)
  it('2. UTGST: applies CGST + UTGST for union territories without state legislature', async () => {
    // Chandigarh (04) uses UTGST
    const quote = await StoreService.quoteCart({
      items: [{ productId: normalProductId, quantity: 1 }],
      placeOfSupplyState: '04', // Chandigarh
    });

    // Since seller is 27 (MH) and buyer is 04 (Chandigarh), this is interstate, so 100% IGST applies!
    expect(quote.isInterstate).toBe(true);
    expect(quote.igstPaise).toBe(18000);

    // Now test intrastate where seller IS Chandigarh
    await TaxEngine.updateStoreSettings({ sellerState: '04' });

    const intraUtQuote = await StoreService.quoteCart({
      items: [{ productId: normalProductId, quantity: 1 }],
      placeOfSupplyState: '04', // Chandigarh
    });

    expect(intraUtQuote.isInterstate).toBe(false);
    expect(intraUtQuote.usesUtgst).toBe(true);
    expect(intraUtQuote.cgstPaise).toBe(9000); // 9% CGST
    expect(intraUtQuote.utgstPaise).toBe(9000); // 9% UTGST
    expect(intraUtQuote.sgstPaise).toBe(0);
    expect(intraUtQuote.igstPaise).toBe(0);

    // Reset seller state to MH
    await TaxEngine.updateStoreSettings({ sellerState: '27' });
  });

  // 3. Interstate GST (Maharashtra seller to Karnataka 29 or Delhi 07 buyer: 100% IGST)
  it('3. interstate GST: applies 100% IGST when buyer place of supply is outside seller state', async () => {
    const quote = await StoreService.quoteCart({
      items: [{ productId: normalProductId, quantity: 2 }],
      placeOfSupplyState: '29', // Karnataka
    });

    expect(quote.isInterstate).toBe(true);
    expect(quote.subtotal).toBe(200000); // Rs 2000
    expect(quote.cgstPaise).toBe(0);
    expect(quote.sgstPaise).toBe(0);
    expect(quote.utgstPaise).toBe(0);
    expect(quote.igstPaise).toBe(36000); // 18% IGST = Rs 360
    expect(quote.total).toBe(236000); // Rs 2360
  });

  // 4. Composition seller mode: Tax is 0, Bill of Supply issued
  it('4. composition seller: zero tax charged to customer and bill_of_supply issued', async () => {
    await TaxEngine.updateStoreSettings({ sellerRegistrationType: 'composition' });

    const quote = await StoreService.quoteCart({
      items: [{ productId: normalProductId, quantity: 1 }],
      placeOfSupplyState: '27',
    });

    expect(quote.invoiceType).toBe('bill_of_supply');
    expect(quote.taxTotal).toBe(0);
    expect(quote.cgstPaise).toBe(0);
    expect(quote.sgstPaise).toBe(0);
    expect(quote.total).toBe(100000); // Rs 1000 exact

    // Reset
    await TaxEngine.updateStoreSettings({ sellerRegistrationType: 'regular' });
  });

  // 5. Unregistered seller mode: Tax is 0
  it('5. unregistered seller: zero tax charged', async () => {
    await TaxEngine.updateStoreSettings({ sellerRegistrationType: 'unregistered' });

    const quote = await StoreService.quoteCart({
      items: [{ productId: normalProductId, quantity: 1 }],
      placeOfSupplyState: '27',
    });

    expect(quote.invoiceType).toBe('bill_of_supply');
    expect(quote.taxTotal).toBe(0);
    expect(quote.total).toBe(100000);

    // Reset
    await TaxEngine.updateStoreSettings({ sellerRegistrationType: 'regular' });
  });

  // 6. Price includes tax mode: tax calculated backwards from gross price
  it('6. price inclusive tax: extracts taxable base backwards without inflating total', async () => {
    await TaxEngine.updateStoreSettings({ priceIncludesTax: true });

    // Item price 118000 paise (Rs 1,180.00 inclusive of 18% GST)
    const incProd = await StoreService.createProduct({
      name: 'Test Inclusive Item',
      slug: 'test-tax-inclusive-item',
      price: 118000,
      stockQuantity: 10,
      productType: 'physical',
      status: 'active',
    });

    const quote = await StoreService.quoteCart({
      items: [{ productId: incProd.id, quantity: 1 }],
      placeOfSupplyState: '27',
    });

    // 118000 * 10000 / 11800 = 100000 taxable
    expect(quote.taxableAmount).toBe(100000); // Rs 1000
    expect(quote.taxTotal).toBe(18000); // Rs 180
    expect(quote.total).toBe(118000); // Grand total remains Rs 1180!

    // Reset
    await TaxEngine.updateStoreSettings({ priceIncludesTax: false });
  });

  // 7. COD Rules: Blocked pincode rejected
  it('7. COD rule: blocked delivery pincode is rejected with 400', async () => {
    await TaxEngine.updateStoreSettings({
      codEnabled: true,
      codBlockedPincodes: ['999999', '110000'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'cod_block@example.com',
        paymentMethod: 'cod',
        items: [{ productId: normalProductId, quantity: 1 }],
        shippingAddress: {
          addressLine1: 'Blocked Lane',
          city: 'Remote',
          state: 'Maharashtra',
          pincode: '999999',
        },
        billingState: 'Maharashtra',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('COD_PINCODE_BLOCKED');
  });

  // 8. COD Rules: Below min order threshold rejected
  it('8. COD rule: order below minimum threshold is rejected', async () => {
    await TaxEngine.updateStoreSettings({
      codEnabled: true,
      codMinOrderPaise: 200000, // Rs 2,000 min
      codBlockedPincodes: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'cod_min@example.com',
        paymentMethod: 'cod',
        items: [{ productId: normalProductId, quantity: 1 }], // Rs 1,000 < Rs 2,000
        shippingAddress: {
          addressLine1: 'Main Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        billingState: 'Maharashtra',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('COD_MIN_THRESHOLD_NOT_MET');

    // Reset min threshold
    await TaxEngine.updateStoreSettings({ codMinOrderPaise: 10000 });
  });

  // 9. COD Rules: Valid COD order adds fee and creates confirmed order with invoice
  it('9. COD checkout: adds surcharge fee with GST, confirms order and issues invoice', async () => {
    await TaxEngine.updateStoreSettings({
      codEnabled: true,
      codFeePaise: 5000, // Rs 50 fee
      codRequiresConfirmation: false, // Confirms immediately
      codBlockedPincodes: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'cod_success@example.com',
        paymentMethod: 'cod',
        items: [{ productId: normalProductId, quantity: 1 }],
        shippingAddress: {
          addressLine1: 'Marine Drive',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400020',
        },
        billingState: 'Maharashtra',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.paymentMethod).toBe('cod');
    expect(body.data.status).toBe('confirmed');

    // Fetch order from DB to inspect totals
    const order = await StoreService.getOrderByNumber(body.data.orderNumber);
    expect(order).not.toBeNull();
    expect(order!.codFeePaise).toBe(5000);
    expect(order!.codFeeTaxPaise).toBe(900); // 18% of Rs 50 = Rs 9
    expect(order!.invoiceId).toBeDefined();

    // Verify invoice generated automatically
    const invoice = await InvoiceService.getInvoiceByOrderId(order!.id);
    expect(invoice).not.toBeNull();
    expect(invoice!.invoiceNumber).toMatch(/^INV\/2026-27\/\d{4}$/);
    expect(invoice!.status).toBe('issued');
  });

  // 10. Deterministic FY invoice numbering without gaps under sequential orders
  it('10. FY invoice sequencing: produces strictly sequential numbers INV/YYYY-YY/NNNN', async () => {
    const fy = InvoiceService.getFinancialYear(new Date());

    // Generate two invoices through service
    const orderA = await StoreService.createOrder({
      customerEmail: 'inv_a@example.com',
      paymentMethod: 'cod',
      items: [{ productId: normalProductId, quantity: 1 }],
      shippingAddress: { addressLine1: 'A1', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      billingState: 'Maharashtra',
    });

    const orderB = await StoreService.createOrder({
      customerEmail: 'inv_b@example.com',
      paymentMethod: 'cod',
      items: [{ productId: normalProductId, quantity: 1 }],
      shippingAddress: { addressLine1: 'B1', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      billingState: 'Maharashtra',
    });

    const invA = await InvoiceService.generateInvoice(orderA.id);
    const invB = await InvoiceService.generateInvoice(orderB.id);

    const numA = parseInt(invA.invoiceNumber.split('/')[2], 10);
    const numB = parseInt(invB.invoiceNumber.split('/')[2], 10);

    expect(numB).toBe(numA + 1);
    expect(invA.financialYear).toBe(fy);
    expect(invB.financialYear).toBe(fy);
  });

  // 11. Credit note generation on refund of an invoiced order
  it('11. credit note: refund of invoiced order automatically issues CN/YYYY-YY/NNNN', async () => {
    // 1. Create and confirm an order via COD so an invoice is generated
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/checkout',
      payload: {
        customerEmail: 'refund_cn@example.com',
        paymentMethod: 'cod',
        items: [{ productId: normalProductId, quantity: 1 }],
        shippingAddress: { addressLine1: 'C-Street', city: 'Nagpur', state: 'Maharashtra', pincode: '440001' },
        billingState: 'Maharashtra',
      },
    });

    const orderNumber = JSON.parse(orderRes.body).data.orderNumber;
    const order = await StoreService.getOrderByNumber(orderNumber);

    // 2. Insert fake captured payment for COD order to allow refund
    const connection = await pool.getConnection();
    try {
      await connection.query(
        `INSERT INTO payments (order_id, gateway, gateway_order_id, gateway_payment_id, amount_paise, currency, status, captured_at)
         VALUES (?, 'cod', 'cod_ord', ?, ?, 'INR', 'captured', NOW())`,
        [order!.id, `cod_pay_${order!.id}`, order!.total]
      );
    } finally {
      connection.release();
    }

    // 3. Issue refund
    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/store/orders/${order!.id}/refund`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        amountPaise: 50000, // Rs 500 partial refund
        reason: 'Customer requested partial refund',
        idempotencyKey: `cn_refund_key_${order!.id}`,
        restock: false,
      },
    });

    expect(refundRes.statusCode).toBe(201);

    // 4. Check credit note in database
    const [cnRows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM credit_notes WHERE order_id = ?',
      [order!.id]
    );

    expect(cnRows.length).toBe(1);
    const cn = cnRows[0];
    expect(cn.credit_note_number).toMatch(/^CN\/2026-27\/\d{4}$/);
    expect(Number(cn.total_amount_paise)).toBe(50000);
    expect(Number(cn.total_tax_paise)).toBeGreaterThan(0);
  });

  // 12. Customer Invoice JSON and PDF download endpoints with ownership validation
  describe('Customer Invoice Endpoints & PDF Generation', () => {
    let testOrderId: number;
    let testGuestToken: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/store/checkout',
        payload: {
          customerEmail: 'pdf_test@example.com',
          paymentMethod: 'cod',
          items: [{ productId: normalProductId, quantity: 1 }],
          shippingAddress: { addressLine1: 'Hill Road', city: 'Bandra', state: 'Maharashtra', pincode: '400050' },
          billingState: 'Maharashtra',
        },
      });

      const body = JSON.parse(res.body);
      testGuestToken = body.data.guestAccessToken;

      const order = await StoreService.getOrderByNumber(body.data.orderNumber);
      testOrderId = order!.id;
    });

    it('12a. customer invoice JSON returns 403 when accessed without guest token or auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/store/orders/${testOrderId}/invoice`,
      });

      expect(res.statusCode).toBe(403);
    });

    it('12b. customer invoice JSON returns 200 with valid guest token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/store/orders/${testOrderId}/invoice?guestToken=${testGuestToken}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.invoiceNumber).toMatch(/^INV\//);
      expect(body.data.sellerSnapshot.gstin).toBe('27AAPFU0939F1ZV');
    });

    it('12c. customer invoice PDF returns binary application/pdf with valid PDF magic bytes (%PDF-1.)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/store/orders/${testOrderId}/invoice/pdf?guestToken=${testGuestToken}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');

      // Check PDF magic header %PDF-1.
      const rawPayload = res.rawPayload;
      const pdfMagic = rawPayload.subarray(0, 5).toString('ascii');
      expect(pdfMagic).toBe('%PDF-');
    });
  });

  // 13. Admin Tax Classes & States Endpoints
  describe('Admin Tax & States API', () => {
    it('13a. GET /admin/store/states returns all 36 Indian states and UTs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/store/states',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBeGreaterThanOrEqual(36);
      const mh = body.data.find((s: any) => s.gstCode === '27');
      expect(mh.name).toBe('Maharashtra');
    });

    it('13b. unauthorized customer cannot create tax class (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/store/tax-classes',
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          name: 'Custom Test Class',
          code: '1234',
          rateBasisPoints: 1200,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('13c. admin creates and updates tax class (201 / 200)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/store/tax-classes',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Custom Test 14%',
          kind: 'goods',
          codeType: 'HSN',
          code: '8888',
          rateBasisPoints: 1400,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const createdId = JSON.parse(createRes.body).data.id;

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/store/tax-classes/${createdId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          rateBasisPoints: 1500,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).data.rate_basis_points).toBe(1500);
    });

    it('13d. admin updates store tax and COD settings', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/store/settings/tax-cod',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          sellerTradeName: 'Antigravity Superstore',
          codFeePaise: 7500,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.sellerTradeName).toBe('Antigravity Superstore');
      expect(body.data.codFeePaise).toBe(7500);
    });
  });

  // 14. Admin Invoice and Credit Note listing and PDF downloads
  describe('Admin Invoices & Credit Notes Management', () => {
    it('14a. admin lists invoices with pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/store/invoices?page=1&perPage=5',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('14b. admin downloads credit note PDF (%PDF-)', async () => {
      const [cnRows] = await pool.query<RowDataPacket[]>('SELECT id FROM credit_notes LIMIT 1');
      if (cnRows.length > 0) {
        const cnId = cnRows[0].id;
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/store/credit-notes/${cnId}/pdf`,
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      }
    });
  });
});
