import { buildApp } from '../app.js';
import { moduleRegistry } from '../modules/registry.js';
import { storeModuleManifest } from '../modules/store/index.js';
import { StoreService } from '../modules/store/service.js';
import { RazorpayGateway, setPaymentGateway } from '../modules/store/payment-gateway.js';
import { pool } from '../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { createHmac } from 'node:crypto';

async function runLiveRazorpayPurchaseTest() {
  console.log('--- Starting Live Razorpay Purchase & Webhook Confirmation Test ---');

  const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_TmDAJO73xaD3oW';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || 'PWYpKAlD7KdRqr7RrkKpSZ27';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'live_test_webhook_secret_h2_1';

  // 1. Configure RazorpayGateway with real test keys
  const liveGateway = new RazorpayGateway(keyId, keySecret, webhookSecret);
  setPaymentGateway(liveGateway);

  // 2. Enable store module & initialize app
  moduleRegistry.registerManifest(storeModuleManifest);
  moduleRegistry.setModuleState('store', true);
  const app = buildApp();
  await app.ready();

  // 3. Ensure test product exists
  const prodSlug = `live-rzp-test-${Date.now()}`;
  const prod = await StoreService.createProduct({
    name: 'Real Razorpay Test Item',
    slug: prodSlug,
    price: 10000, // Rs 100.00
    stockQuantity: 10,
    status: 'active',
  });
  console.log(`[1] Created test product: ${prod.name} (id: ${prod.id}, price: 10000 paise)`);

  // 4. Perform checkout via POST /api/v1/store/checkout
  console.log('[2] Initiating checkout (calling live Razorpay API https://api.razorpay.com/v1/orders)...');
  const checkoutRes = await app.inject({
    method: 'POST',
    url: '/api/v1/store/checkout',
    payload: {
      customerEmail: 'live_buyer@example.com',
      paymentMethod: 'razorpay',
      items: [{ productId: prod.id, quantity: 1 }],
      shippingAddress: {
        addressLine1: 'MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      billingState: 'Karnataka',
    },
  });

  if (checkoutRes.statusCode !== 201) {
    throw new Error(`Checkout failed with status ${checkoutRes.statusCode}: ${checkoutRes.body}`);
  }

  const checkoutData = JSON.parse(checkoutRes.body).data;
  const orderNumber = checkoutData.orderNumber;
  const gatewayOrderId = checkoutData.gatewayOrder.gatewayOrderId;
  console.log(`[3] Order created successfully: ${orderNumber}`);
  console.log(`[3] Real Razorpay Order ID created on Razorpay API: ${gatewayOrderId}`);
  console.log(`[3] Total amount with tax: ${checkoutData.total} paise (Rs ${checkoutData.total / 100})`);

  // Verify initial status in MySQL
  const [orderRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM orders WHERE order_number = ?',
    [orderNumber]
  );
  const order = orderRows[0];
  console.log(`[4] Order status in MySQL before payment: ${order.status} (payment_status: ${order.payment_status})`);
  if (order.status !== 'pending_payment') {
    throw new Error(`Expected pending_payment, found: ${order.status}`);
  }

  // 5. Scenario: Customer pays, but browser is KILLED before redirect/verify!
  console.log('[5] Simulating browser kill: POST /orders/:id/verify-payment was NEVER called by the client.');

  // 6. Razorpay fires payment.captured webhook to server
  const livePaymentId = `pay_${Date.now()}`;
  const webhookEventPayload = {
    id: `evt_live_${Date.now()}`,
    entity: 'event',
    account_id: 'acc_live_test',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: livePaymentId,
          entity: 'payment',
          amount: checkoutData.total,
          currency: 'INR',
          status: 'captured',
          order_id: gatewayOrderId,
          method: 'upi',
          captured: true,
          notes: {
            orderId: String(order.id),
          },
        },
      },
    },
  };

  const rawWebhookBody = JSON.stringify(webhookEventPayload);
  const signature = createHmac('sha256', webhookSecret).update(rawWebhookBody).digest('hex');

  console.log('[6] Razorpay sends payment.captured webhook directly to /api/v1/store/webhooks/razorpay...');
  const webhookRes = await app.inject({
    method: 'POST',
    url: '/api/v1/store/webhooks/razorpay',
    headers: {
      'x-razorpay-signature': signature,
      'content-type': 'application/json',
    },
    payload: rawWebhookBody,
  });

  console.log(`[7] Webhook response HTTP status: ${webhookRes.statusCode}`);
  const webhookBody = JSON.parse(webhookRes.body);
  console.log('[7] Webhook response body:', webhookBody);

  if (webhookRes.statusCode !== 200 || webhookBody.data.status !== 'processed') {
    throw new Error(`Webhook processing failed: ${webhookRes.body}`);
  }

  // 7. Check MySQL database: Order must now be confirmed!
  const [confirmedRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM orders WHERE id = ?',
    [order.id]
  );
  const confirmedOrder = confirmedRows[0];
  console.log(`[8] Order status in MySQL after webhook: ${confirmedOrder.status} (payment_status: ${confirmedOrder.payment_status})`);

  if (confirmedOrder.status !== 'confirmed' || confirmedOrder.payment_status !== 'captured') {
    throw new Error(`Order failed to confirm via webhook! Status: ${confirmedOrder.status}`);
  }

  // 8. Check payments table
  const [paymentRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM payments WHERE order_id = ?',
    [order.id]
  );
  console.log(`[9] Payments table records: ${paymentRows.length}`);
  console.log(`[9] Payment record: ID=${paymentRows[0].id}, GatewayPaymentID=${paymentRows[0].gateway_payment_id}, Status=${paymentRows[0].status}, Amount=${paymentRows[0].amount_paise}`);

  // 9. Check order_status_history table
  const [historyRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC',
    [order.id]
  );
  console.log('[10] Order Status History trail:');
  historyRows.forEach((h: any, i: number) => {
    console.log(`    ${i + 1}. [${h.from_status} -> ${h.to_status}] actor: ${h.actor}, reason: "${h.reason}"`);
  });

  console.log('--- Live Razorpay Purchase & Webhook Confirmation Test: PASSED ---');
  await app.close();
  process.exit(0);
}

runLiveRazorpayPurchaseTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
