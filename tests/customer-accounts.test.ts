import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { moduleRegistry } from '../src/modules/registry.js';
import { storeModuleManifest } from '../src/modules/store/index.js';
import { shippingModuleManifest } from '../src/modules/shipping/index.js';
import { donationModuleManifest } from '../src/modules/donations/index.js';

import { authService } from '../src/auth/service.js';

describe('Customer Accounts & Profiles (Sub-checkpoint CP-H2.4)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let customerToken: string;
  let customerId: number;
  const customerEmail = `cust_${Date.now()}@example.com`;
  const adminEmail = `admin_cust_${Date.now()}@example.com`;
  let testProductId: number;
  let testOrderId: number;
  let testOrderItemId: number;

  beforeAll(async () => {
    await runMigrations();
    try {
      moduleRegistry.registerManifest(storeModuleManifest);
      moduleRegistry.registerManifest(shippingModuleManifest);
      moduleRegistry.registerManifest(donationModuleManifest);
    } catch {
      // already registered
    }
    moduleRegistry.setModuleState('store', true);
    moduleRegistry.setModuleState('shipping', true);
    moduleRegistry.setModuleState('donations', true);
    app = buildApp();
    await app.ready();

    // 1. Create Admin Account
    const adminUser = await authService.signup({
      name: 'Admin User',
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
      name: 'John Doe',
      email: customerEmail,
      password: 'CustomerPassword123!',
    });
    await authService.verifyEmail(custUser.verificationToken);
    const custLogin = await authService.login({
      email: customerEmail,
      password: 'CustomerPassword123!',
    });
    customerToken = custLogin.token!;
    customerId = custUser.user.id;

    // 3. Create active test product
    const [prodRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO products (name, slug, price, stock_quantity, track_stock, status)
       VALUES ('Customer Test Mug', 'cust-test-mug-${Date.now()}', 45000, 20, TRUE, 'active')`
    );
    testProductId = prodRes.insertId;

    // 4. Create an eligible order for customer
    const [ordRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO orders (
        order_number, customer_id, customer_email, payment_method, payment_status,
        subtotal, tax_total, shipping_total, total, currency, status,
        shipping_carrier, tracking_number
      ) VALUES (?, ?, ?, 'razorpay', 'captured', 45000, 0, 0, 45000, 'INR', 'delivered', 'Delhivery', 'TRK-CUST-123')`,
      [`ORD-CUST-${Date.now()}`, customerId, customerEmail]
    );
    testOrderId = ordRes.insertId;

    const [itemRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO order_items (
        order_id, product_id, title, price, quantity, total, product_type, fulfilment_status
      ) VALUES (?, ?, 'Customer Test Mug', 45000, 1, 45000, 'physical', 'fulfilled')`,
      [testOrderId, testProductId]
    );
    testOrderItemId = itemRes.insertId;
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. Profile Retrieval & Updates
  it('1. Customer Profile: retrieves profile, updates phone, DOB, preferences, and computes metrics', async () => {
    // GET Profile
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/profile',
      headers: { authorization: `Bearer ${customerToken}` },
    });

    expect(getRes.statusCode).toBe(200);
    const body = JSON.parse(getRes.body).data;
    expect(body.email).toBe(customerEmail);
    expect(body.totalOrders).toBe(1);
    expect(body.totalSpentPaise).toBe(45000);

    // PUT Update Profile
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/store/customer/profile',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        phone: '+919876543210',
        dateOfBirth: '1995-05-15',
        communicationPreferences: {
          emailMarketing: false,
          smsOrderUpdates: true,
          whatsappUpdates: true,
        },
      },
    });

    expect(putRes.statusCode).toBe(200);
    const updated = JSON.parse(putRes.body).data;
    expect(updated.phone).toBe('+919876543210');
    expect(updated.dateOfBirth).toBe('1995-05-15');
    expect(updated.communicationPreferences.emailMarketing).toBe(false);
    expect(updated.communicationPreferences.whatsappUpdates).toBe(true);
  });

  // 2. Change Password & Session Invalidation
  it('2. Change Password: verifies current password, updates hash, and requires new password on subsequent login', async () => {
    // Attempt with incorrect current password -> 400
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/change-password',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        currentPassword: 'WrongPassword123!',
        newPassword: 'BrandNewPassword456!',
      },
    });
    expect(failRes.statusCode).toBe(400);

    // Successful password change
    const changeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/change-password',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        currentPassword: 'CustomerPassword123!',
        newPassword: 'BrandNewPassword456!',
      },
    });
    expect(changeRes.statusCode).toBe(200);
    expect(JSON.parse(changeRes.body).success).toBe(true);

    // Previous session token should now be invalidated
    const oldSessionRes = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/profile',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(oldSessionRes.statusCode).toBe(401);

    // Log in with new password
    const newLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: customerEmail, password: 'BrandNewPassword456!' },
    });
    expect(newLoginRes.statusCode).toBe(200);
    customerToken = JSON.parse(newLoginRes.body).data.token;
  });

  // 3. Saved Addresses CRUD & Default Toggle
  it('3. Delivery Addresses: CRUD and default address flag toggling', async () => {
    // 1. Add Address 1 (becomes default automatically)
    const add1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/addresses',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        fullName: 'John Doe',
        phone: '+919876543210',
        addressLine1: 'Flat 402, Sunshine Towers',
        city: 'Mumbai',
        state: 'Maharashtra',
        stateCode: '27',
        postalCode: '400001',
        country: 'IN',
      },
    });

    expect(add1Res.statusCode).toBe(201);
    const addr1 = JSON.parse(add1Res.body).data;
    expect(addr1.isDefault).toBe(true);
    const addr1Id = addr1.id;

    // 2. Add Address 2 as default
    const add2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/addresses',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        fullName: 'John Doe (Office)',
        phone: '+919876543210',
        addressLine1: 'Unit 12, Tech Park',
        city: 'Pune',
        state: 'Maharashtra',
        stateCode: '27',
        postalCode: '411001',
        country: 'IN',
        isDefault: true,
      },
    });
    expect(add2Res.statusCode).toBe(201);
    const addr2 = JSON.parse(add2Res.body).data;
    expect(addr2.isDefault).toBe(true);
    const addr2Id = addr2.id;

    // Address 1 should have been unset as default
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/addresses',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const addresses = JSON.parse(listRes.body).data;
    expect(addresses.length).toBe(2);
    expect(addresses[0].id).toBe(addr2Id);
    expect(addresses[0].isDefault).toBe(true);
    expect(addresses[1].id).toBe(addr1Id);
    expect(addresses[1].isDefault).toBe(false);

    // 3. Set Address 1 back as default
    const setDefRes = await app.inject({
      method: 'POST',
      url: `/api/v1/store/customer/addresses/${addr1Id}/default`,
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(setDefRes.statusCode).toBe(200);
    expect(JSON.parse(setDefRes.body).data.isDefault).toBe(true);

    // 4. Delete Address 2
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/store/customer/addresses/${addr2Id}`,
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).success).toBe(true);
  });

  // 4. Wishlist Management
  it('4. Wishlist: add product, list with active status and price, remove product', async () => {
    // Add to wishlist
    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/wishlist',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { productId: testProductId },
    });
    expect(addRes.statusCode).toBe(201);
    expect(JSON.parse(addRes.body).wishlistCount).toBe(1);

    // List wishlist
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/wishlist',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.body).data;
    expect(list.length).toBe(1);
    expect(list[0].productId).toBe(testProductId);
    expect(list[0].productName).toBe('Customer Test Mug');
    expect(list[0].price).toBe(45000);

    // Remove from wishlist
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/store/customer/wishlist/${testProductId}`,
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).wishlistCount).toBe(0);
  });

  // 5. Order History & Tracking
  it('5. Order History: lists customer orders and provides tracking details', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/orders',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const order = body.data[0];
    expect(order.trackingNumber).toBe('TRK-CUST-123');
    expect(order.trackingUrl).toContain('TRK-CUST-123');

    // Single order detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/store/customer/orders/${testOrderId}`,
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = JSON.parse(detailRes.body).data;
    expect(detail.id).toBe(testOrderId);
    expect(detail.items.length).toBe(1);
    expect(detail.items[0].productId).toBe(testProductId);
  });

  // 6. Reorder Preparation
  it('6. Reorder Preparation: validates active stock and formats line items for new checkout', async () => {
    const reorderRes = await app.inject({
      method: 'POST',
      url: `/api/v1/store/customer/orders/${testOrderId}/reorder`,
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(reorderRes.statusCode).toBe(200);
    const reorderData = JSON.parse(reorderRes.body).data;
    expect(reorderData.canReorder).toBe(true);
    expect(reorderData.items.length).toBe(1);
    expect(reorderData.items[0].productId).toBe(testProductId);
    expect(reorderData.items[0].available).toBe(true);
  });

  // 7 & 8. Return Requests (Customer Submit + Admin Review Transition)
  it('7 & 8. Return Requests: customer submits request on delivered order, admin reviews and approves', async () => {
    // 1. Submit return request
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/store/customer/orders/${testOrderId}/return-request`,
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        orderItemId: testOrderItemId,
        reason: 'Received damaged during transit',
      },
    });
    expect(submitRes.statusCode).toBe(201);
    const returnReq = JSON.parse(submitRes.body).data;
    expect(returnReq.status).toBe('pending');
    expect(returnReq.reason).toContain('Received damaged');
    const returnReqId = returnReq.id;

    // 2. Customer lists return requests
    const custReqs = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/return-requests',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(custReqs.statusCode).toBe(200);
    expect(JSON.parse(custReqs.body).data.length).toBeGreaterThanOrEqual(1);

    // 3. Admin views return requests
    const adminReqs = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/store/return-requests',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminReqs.statusCode).toBe(200);
    const adminList = JSON.parse(adminReqs.body).data;
    expect(adminList.some((r: any) => r.id === returnReqId)).toBe(true);

    // 4. Admin approves return request
    const transRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/store/return-requests/${returnReqId}/transition`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        status: 'approved',
        adminNotes: 'Approved for replacement pickup via Delhivery reverse logistics',
      },
    });
    expect(transRes.statusCode).toBe(200);
    expect(JSON.parse(transRes.body).data.status).toBe('approved');
    expect(JSON.parse(transRes.body).data.adminNotes).toContain('Approved for replacement');
  });

  // 9. DPDP Data Export
  it('9. DPDP Compliance: exports full customer personal data payload', async () => {
    const exportRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/export-data',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(exportRes.statusCode).toBe(200);
    const data = JSON.parse(exportRes.body).data;
    expect(data.profile.email).toBe(customerEmail);
    expect(Array.isArray(data.addresses)).toBe(true);
    expect(Array.isArray(data.orders)).toBe(true);
    expect(data.exportDate).toBeDefined();

    // Verify row was stored in customer_data_requests
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM customer_data_requests WHERE user_id = ? AND request_type = 'export'",
      [customerId]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  // 10. Admin Customer Directory & Staff Notes
  it('10. Admin Customers: list, segment assignment, staff internal notes, and CSV export', async () => {
    // 1. Admin list customers
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/store/customers?search=${encodeURIComponent(customerEmail)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].id).toBe(customerId);
    expect(listBody.data[0].totalSpentPaise).toBe(45000);

    // 2. Update customer segment to VIP
    const segRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/store/customers/${customerId}/segment`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { segment: 'vip' },
    });
    expect(segRes.statusCode).toBe(200);
    expect(JSON.parse(segRes.body).customerSegment).toBe('vip');

    // 3. Add staff internal note
    const noteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/store/customers/${customerId}/notes`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { note: 'High value client with frequent corporate mug orders' },
    });
    expect(noteRes.statusCode).toBe(201);
    expect(JSON.parse(noteRes.body).data.note).toContain('High value client');

    // 4. Admin inspect single customer
    const getCustRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/store/customers/${customerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getCustRes.statusCode).toBe(200);
    const custDetail = JSON.parse(getCustRes.body).data;
    expect(custDetail.profile.customerSegment).toBe('vip');
    expect(custDetail.notes.length).toBeGreaterThanOrEqual(1);

    // 5. Admin CSV export
    const csvRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/store/customers/export',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.body).toContain('Customer ID,Name,Email,Phone,Segment');
    expect(csvRes.body).toContain(customerEmail);
  });

  // 11. DPDP Account Deletion
  it('11. DPDP Account Deletion: verifies password, erases personal data, anonymizes user record', async () => {
    // Attempt with incorrect password -> 400
    const failDel = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/delete-account',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { passwordConfirm: 'IncorrectPassword!' },
    });
    expect(failDel.statusCode).toBe(400);

    // Successful deletion with correct password
    const delRes = await app.inject({
      method: 'POST',
      url: '/api/v1/store/customer/delete-account',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { passwordConfirm: 'BrandNewPassword456!' },
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).success).toBe(true);

    // Verify user record is anonymized and inactive
    const [userRows] = await pool.query<RowDataPacket[]>(
      'SELECT name, email, phone, is_active FROM users WHERE id = ?',
      [customerId]
    );
    expect(userRows[0].name).toBe('Anonymized Customer');
    expect(userRows[0].email).toContain('anonymized_');
    expect(userRows[0].phone).toBeNull();
    expect(Boolean(userRows[0].is_active)).toBe(false);

    // Verify saved addresses were erased
    const [addrRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM customer_addresses WHERE user_id = ?',
      [customerId]
    );
    expect(addrRows.length).toBe(0);

    // Subsequent requests with token should now be rejected as unauthenticated
    const profileAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/profile',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(profileAfter.statusCode).toBe(401);
  });

  // 12. RBAC Route Protection
  it('12. Authorization & RBAC: rejects unauthenticated requests and restricts admin customer routes to authorized staff', async () => {
    // Unauthenticated profile request -> 401
    const unauth = await app.inject({
      method: 'GET',
      url: '/api/v1/store/customer/profile',
    });
    expect(unauth.statusCode).toBe(401);

    // Customer role accessing admin customer endpoints -> 403
    const tempEmail = `temp_cust_${Date.now()}@example.com`;
    const tempCust = await authService.signup({
      name: 'Temp Customer',
      email: tempEmail,
      password: 'Password123!',
    });
    await authService.verifyEmail(tempCust.verificationToken);
    const tempLogin = await authService.login({
      email: tempEmail,
      password: 'Password123!',
    });
    const tempCustToken = tempLogin.token!;

    const forbiddenAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/store/customers',
      headers: { authorization: `Bearer ${tempCustToken}` },
    });
    expect(forbiddenAdmin.statusCode).toBe(403);
    expect(JSON.parse(forbiddenAdmin.body).error.code).toBe('FORBIDDEN');
  });

  // 13. Donor Donation History and 80G Tax Receipts
  it('13. Donor History: retrieves customer donation records with 80G tax receipt number', async () => {
    moduleRegistry.setModuleState('donations', true);

    const donorEmail = `donor_${Date.now()}@example.com`;
    const donorUser = await authService.signup({
      name: 'Generous Donor',
      email: donorEmail,
      password: 'DonorPassword123!',
    });
    await authService.verifyEmail(donorUser.verificationToken);
    const donorLogin = await authService.login({
      email: donorEmail,
      password: 'DonorPassword123!',
    });
    const donorToken = donorLogin.token!;

    // Make a donation with 80G PAN
    await app.inject({
      method: 'POST',
      url: '/api/v1/donations/donate',
      payload: {
        campaignSlug: 'rural-education-initiative',
        donorName: 'Generous Donor',
        donorEmail: donorEmail,
        donorPan: 'ABCDE1234F',
        amount: 250000, // Rs 2,500.00
      },
    });

    const myDonationsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/donations/my-donations',
      headers: { authorization: `Bearer ${donorToken}` },
    });

    expect(myDonationsRes.statusCode).toBe(200);
    const donationsData = JSON.parse(myDonationsRes.body).data;
    expect(donationsData.length).toBeGreaterThanOrEqual(1);
    expect(donationsData[0].donorPan).toBe('ABCDE1234F');
    expect(donationsData[0].receiptNumber).toBeDefined();
    expect(donationsData[0].receiptNumber.startsWith('80G-')).toBe(true);
  });
});
