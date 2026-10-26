import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CreateGatewayOrderParams {
  orderNumber: string;
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface GatewayOrderResult {
  gatewayOrderId: string;
  amount: number;
  currency: string;
  status: string;
}

export interface GatewayPaymentDetails {
  id: string;
  orderId: string;
  amount: number; // In paise
  currency: string;
  status: 'authorized' | 'captured' | 'failed' | 'refunded';
  method?: string;
}

export interface CreateGatewayRefundParams {
  paymentId: string;
  amountPaise: number;
  reason?: string;
  notes?: Record<string, string>;
}

export interface GatewayRefundResult {
  gatewayRefundId: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

export interface PaymentGateway {
  createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult>;
  fetchPayment(paymentId: string): Promise<GatewayPaymentDetails>;
  verifySignature(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret?: string): boolean;
  refund(params: CreateGatewayRefundParams): Promise<GatewayRefundResult>;
}

export function safeTimingCompare(expected: string, actual: string): boolean {
  const expBuf = Buffer.from(expected, 'utf8');
  const actBuf = Buffer.from(actual, 'utf8');
  if (expBuf.length !== actBuf.length) {
    return false;
  }
  return timingSafeEqual(expBuf, actBuf);
}

export class RazorpayGateway implements PaymentGateway {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private baseUrl = 'https://api.razorpay.com/v1';

  constructor(keyId?: string, keySecret?: string, webhookSecret?: string) {
    this.keyId = keyId || process.env.RAZORPAY_KEY_ID || '';
    this.keySecret = keySecret || process.env.RAZORPAY_KEY_SECRET || '';
    this.webhookSecret = webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
  }

  private getAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
  }

  async createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay createOrder failed with HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as { id: string; amount: number; currency: string; status: string };
    return {
      gatewayOrderId: data.id,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
    };
  }

  async fetchPayment(paymentId: string): Promise<GatewayPaymentDetails> {
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay fetchPayment failed with HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      id: string;
      order_id: string;
      amount: number;
      currency: string;
      status: 'authorized' | 'captured' | 'failed' | 'refunded';
      method?: string;
    };

    return {
      id: data.id,
      orderId: data.order_id,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      method: data.method,
    };
  }

  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const payload = `${orderId}|${paymentId}`;
    const expected = createHmac('sha256', this.keySecret).update(payload).digest('hex');
    return safeTimingCompare(expected, signature);
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret?: string): boolean {
    const key = secret || this.webhookSecret;
    if (!key) return false;
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = createHmac('sha256', key).update(bodyStr).digest('hex');
    return safeTimingCompare(expected, signature);
  }

  async refund(params: CreateGatewayRefundParams): Promise<GatewayRefundResult> {
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(params.paymentId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        notes: params.notes,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay refund failed with HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as { id: string; amount: number; status: string };
    return {
      gatewayRefundId: data.id,
      amount: data.amount,
      status: data.status === 'processed' ? 'processed' : 'pending',
    };
  }
}

export class FakePaymentGateway implements PaymentGateway {
  public orders: Map<string, GatewayOrderResult> = new Map();
  public payments: Map<string, GatewayPaymentDetails> = new Map();
  public refunds: Map<string, GatewayRefundResult> = new Map();
  public secret = 'fake_secret_key_12345';
  public webhookSecret = 'fake_webhook_secret_67890';

  async createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult> {
    const gatewayOrderId = `order_${Math.random().toString(36).substring(2, 10)}`;
    const result: GatewayOrderResult = {
      gatewayOrderId,
      amount: params.amountPaise,
      currency: params.currency,
      status: 'created',
    };
    this.orders.set(gatewayOrderId, result);
    return result;
  }

  async fetchPayment(paymentId: string): Promise<GatewayPaymentDetails> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      // If paymentId contains encoded amount (e.g., pay_amt12345_xxx)
      const amtMatch = paymentId.match(/amt(\d+)/);
      const autoAmount = amtMatch ? parseInt(amtMatch[1], 10) : 0;
      return {
        id: paymentId,
        orderId: 'order_test',
        amount: autoAmount,
        currency: 'INR',
        status: 'captured',
        method: 'card',
      };
    }
    return payment;
  }

  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const payload = `${orderId}|${paymentId}`;
    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');
    return safeTimingCompare(expected, signature);
  }

  generateSignature(orderId: string, paymentId: string): string {
    const payload = `${orderId}|${paymentId}`;
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret?: string): boolean {
    const key = secret || this.webhookSecret;
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = createHmac('sha256', key).update(bodyStr).digest('hex');
    return safeTimingCompare(expected, signature);
  }

  generateWebhookSignature(rawBody: string | Buffer, secret?: string): string {
    const key = secret || this.webhookSecret;
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    return createHmac('sha256', key).update(bodyStr).digest('hex');
  }

  async refund(params: CreateGatewayRefundParams): Promise<GatewayRefundResult> {
    const refundId = `rfnd_${Math.random().toString(36).substring(2, 10)}`;
    const result: GatewayRefundResult = {
      gatewayRefundId: refundId,
      amount: params.amountPaise,
      status: 'processed',
    };
    this.refunds.set(refundId, result);
    return result;
  }
}

let activeGateway: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  if (activeGateway) {
    return activeGateway;
  }
  if (process.env.PAYMENT_GATEWAY === 'fake' || process.env.NODE_ENV === 'test') {
    activeGateway = new FakePaymentGateway();
    return activeGateway;
  }
  activeGateway = new RazorpayGateway();
  return activeGateway;
}

export function setPaymentGateway(gateway: PaymentGateway | null): void {
  activeGateway = gateway;
}
