import { db } from '../db/index.js';
import { settings, jobs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes } from 'node:crypto';

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[]; // e.g. ['order.created', 'order.paid', 'user.registered', 'page.published']
  secret: string;
  isActive: boolean;
  createdAt: string;
}

const inMemoryWebhooks: WebhookSubscription[] = [];

export class WebhookService {
  static signPayload(payloadString: string, secret: string): string {
    return createHmac('sha256', secret).update(payloadString).digest('hex');
  }

  static async registerWebhook(data: {
    url: string;
    events: string[];
    secret?: string;
  }): Promise<WebhookSubscription> {
    const id = randomBytes(8).toString('hex');
    const secret = data.secret || `whsec_${randomBytes(20).toString('hex')}`;

    const sub: WebhookSubscription = {
      id,
      url: data.url,
      events: data.events,
      secret,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    inMemoryWebhooks.push(sub);

    try {
      await db.insert(settings).values({
        key: `webhook:${id}`,
        value: JSON.stringify(sub),
        group: 'webhooks',
        isPublic: false,
      });
    } catch {
      // Fallback
    }

    return sub;
  }

  static async listWebhooks(): Promise<WebhookSubscription[]> {
    return inMemoryWebhooks;
  }

  static async deleteWebhook(id: string): Promise<boolean> {
    const idx = inMemoryWebhooks.findIndex(w => w.id === id);
    if (idx !== -1) {
      inMemoryWebhooks.splice(idx, 1);
    }

    try {
      await db.delete(settings).where(eq(settings.key, `webhook:${id}`));
    } catch {
      // Fallback
    }

    return true;
  }

  static async dispatchEvent(event: string, payload: Record<string, unknown>): Promise<{
    dispatchedCount: number;
    subscribers: string[];
  }> {
    const subs = inMemoryWebhooks.filter(w => w.isActive && (w.events.includes(event) || w.events.includes('*')));
    const subscribers: string[] = [];

    const payloadString = JSON.stringify({
      id: `evt_${randomBytes(12).toString('hex')}`,
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    for (const sub of subs) {
      subscribers.push(sub.url);
      const signature = this.signPayload(payloadString, sub.secret);

      try {
        // Enqueue background webhook delivery job
        await db.insert(jobs).values({
          queue: 'webhooks',
          jobType: 'webhook_send',
          payload: JSON.stringify({
            url: sub.url,
            body: payloadString,
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Event': event,
              'X-Webhook-Signature': `sha256=${signature}`,
            },
          }),
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
        });
      } catch {
        // Fallback
      }
    }

    return { dispatchedCount: subs.length, subscribers };
  }
}
