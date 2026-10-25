import { db } from '../db/index.js';
import { emailTemplates } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { EMAIL_EVENTS } from './events.js';

export interface EmailTemplateItem {
  id: number;
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  variablesSchema: unknown;
  isActive: boolean;
  isSystem: boolean;
  version: number;
}

export const DEFAULT_TEMPLATES: Record<string, { subject: string; bodyHtml: string; bodyText: string }> = {
  auth_welcome: {
    subject: 'Welcome to {{ site.name }}',
    bodyHtml: `<h2>Welcome, {{ user.name }}!</h2><p>Thank you for joining {{ site.name }}. We're excited to have you with us.</p><p><a href="{{ site.url }}" style="display: inline-block; padding: 10px 20px; background-color: #0052cc; color: #ffffff; text-decoration: none; border-radius: 4px;">Visit Site</a></p>`,
    bodyText: `Welcome, {{ user.name }}! Thank you for joining {{ site.name }}. Visit us at {{ site.url }}.`,
  },
  auth_verify_email: {
    subject: 'Verify your email address for {{ site.name }}',
    bodyHtml: `<h2>Email Verification</h2><p>Hi {{ user.name }},</p><p>Your verification code is: <strong style="font-size: 20px; letter-spacing: 2px;">{{ verification.code }}</strong></p><p>Or verify by clicking the link below:</p><p><a href="{{ verification.url }}" style="display: inline-block; padding: 10px 20px; background-color: #0052cc; color: #ffffff; text-decoration: none; border-radius: 4px;">Verify Email</a></p><p>This link expires in {{ verification.expires_in }}.</p>`,
    bodyText: `Hi {{ user.name }}, Your verification code is {{ verification.code }}. Or verify at {{ verification.url }}. Expires in {{ verification.expires_in }}.`,
  },
  auth_password_reset: {
    subject: 'Reset your password for {{ site.name }}',
    bodyHtml: `<h2>Password Reset Request</h2><p>Hi {{ user.name }},</p><p>We received a request to reset your password. Click the link below to set a new password:</p><p><a href="{{ reset.url }}" style="display: inline-block; padding: 10px 20px; background-color: #0052cc; color: #ffffff; text-decoration: none; border-radius: 4px;">Reset Password</a></p><p>This link expires in {{ reset.expires_in }}. If you did not make this request, please ignore this email.</p>`,
    bodyText: `Hi {{ user.name }}, Reset your password at {{ reset.url }}. Expires in {{ reset.expires_in }}.`,
  },
  order_placed: {
    subject: 'Order Confirmation #{{ order.number }}',
    bodyHtml: `<h2>Order Confirmed!</h2><p>Hi {{ user.name }}, thank you for your order #{{ order.number }}.</p><p>Total: <strong>{{ order.total }}</strong></p><p><a href="{{ order.view_url }}">View your order online</a></p>`,
    bodyText: `Hi {{ user.name }}, your order #{{ order.number }} for {{ order.total }} has been confirmed. View online: {{ order.view_url }}`,
  },
  order_payment_received: {
    subject: 'Payment Received for Order #{{ order.number }}',
    bodyHtml: `<h2>Payment Received</h2><p>Payment of {{ order.total }} for Order #{{ order.number }} has been processed successfully via {{ payment.method }}.</p>`,
    bodyText: `Payment of {{ order.total }} for Order #{{ order.number }} was received via {{ payment.method }}.`,
  },
  order_shipped: {
    subject: 'Your order #{{ order.number }} has been shipped!',
    bodyHtml: `<h2>Order on its way!</h2><p>Your order #{{ order.number }} has been handed over to {{ shipping.carrier }}. Tracking number: <strong>{{ shipping.tracking_number }}</strong>.</p><p><a href="{{ shipping.tracking_url }}">Track shipment</a></p>`,
    bodyText: `Order #{{ order.number }} shipped via {{ shipping.carrier }}. Tracking: {{ shipping.tracking_number }} at {{ shipping.tracking_url }}.`,
  },
  order_delivered: {
    subject: 'Delivered: Order #{{ order.number }}',
    bodyHtml: `<h2>Order Delivered</h2><p>Your order #{{ order.number }} was delivered on {{ delivery.date }}. We hope you love your purchase!</p>`,
    bodyText: `Your order #{{ order.number }} was delivered on {{ delivery.date }}.`,
  },
  order_cancelled: {
    subject: 'Order Cancellation #{{ order.number }}',
    bodyHtml: `<h2>Order Cancelled</h2><p>Your order #{{ order.number }} has been cancelled. Reason: {{ cancellation.reason }}.</p>`,
    bodyText: `Order #{{ order.number }} has been cancelled. Reason: {{ cancellation.reason }}.`,
  },
  order_refund: {
    subject: 'Refund Issued for Order #{{ order.number }}',
    bodyHtml: `<h2>Refund Processed</h2><p>A refund of {{ refund.amount }} has been issued to your {{ refund.method }} for order #{{ order.number }}.</p>`,
    bodyText: `A refund of {{ refund.amount }} was issued for order #{{ order.number }}.`,
  },
  order_invoice: {
    subject: 'Invoice #{{ invoice.number }} for Order #{{ order.number }}',
    bodyHtml: `<h2>Tax Invoice #{{ invoice.number }}</h2><p>Please find attached the official invoice for Order #{{ order.number }} (Total: {{ order.total }}).</p><p><a href="{{ invoice.download_url }}">Download Invoice PDF</a></p>`,
    bodyText: `Invoice #{{ invoice.number }} for Order #{{ order.number }}. Download at {{ invoice.download_url }}`,
  },
  cart_abandoned: {
    subject: 'Did you leave something behind?',
    bodyHtml: `<h2>Still thinking about it?</h2><p>Hi {{ user.name }}, we noticed you left items in your cart. Complete your order today before stock runs out!</p><p><a href="{{ cart.checkout_url }}" style="display: inline-block; padding: 10px 20px; background-color: #0052cc; color: #ffffff; text-decoration: none; border-radius: 4px;">Return to Checkout</a></p>`,
    bodyText: `Hi {{ user.name }}, you left items in your cart. Return to checkout: {{ cart.checkout_url }}`,
  },
  donation_receipt: {
    subject: 'Thank you for your donation to {{ site.name }}',
    bodyHtml: `<h2>Donation Receipt #{{ donation.receipt_number }}</h2><p>Dear {{ donor.name }}, thank you for your generous contribution of {{ donation.amount }}.</p><p>Tax Exemption Details: {{ donation.tax_exemption_info }}</p>`,
    bodyText: `Donation Receipt #{{ donation.receipt_number }}. Thank you {{ donor.name }} for your donation of {{ donation.amount }}. {{ donation.tax_exemption_info }}`,
  },
  admin_new_order: {
    subject: 'Alert: New Order #{{ order.number }} received ({{ order.total }})',
    bodyHtml: `<h2>New Order Alert</h2><p>A new order #{{ order.number }} has been placed by {{ customer.name }}. Items: {{ order.items_count }}. Total: {{ order.total }}.</p><p><a href="{{ admin.order_url }}">Open in Admin</a></p>`,
    bodyText: `New Order Alert: Order #{{ order.number }} by {{ customer.name }} ({{ order.total }}). Manage: {{ admin.order_url }}`,
  },
  admin_low_stock: {
    subject: 'Alert: Low stock for {{ product.title }}',
    bodyHtml: `<h2>Low Stock Warning</h2><p>Product {{ product.title }} (SKU: {{ product.sku }}) has dropped to {{ product.stock_quantity }} units in stock.</p><p><a href="{{ admin.product_url }}">Update Inventory</a></p>`,
    bodyText: `Low Stock Warning: {{ product.title }} ({{ product.sku }}) at {{ product.stock_quantity }} units. Manage: {{ admin.product_url }}`,
  },
};

const inMemoryTemplates: EmailTemplateItem[] = Object.entries(EMAIL_EVENTS).map(([key, def], idx) => {
  const defaultContent = DEFAULT_TEMPLATES[def.defaultTemplateKey] || {
    subject: def.defaultSubject,
    bodyHtml: `<p>${def.name}</p>`,
    bodyText: def.name,
  };
  return {
    id: idx + 1,
    key,
    name: def.name,
    subject: defaultContent.subject,
    bodyHtml: defaultContent.bodyHtml,
    bodyText: defaultContent.bodyText,
    variablesSchema: def.variables,
    isActive: true,
    isSystem: true,
    version: 1,
  };
});

export class EmailTemplateService {
  static async listTemplates(): Promise<EmailTemplateItem[]> {
    try {
      const rows = await db.select().from(emailTemplates);
      if (rows.length > 0) {
        return rows.map((r: typeof emailTemplates.$inferSelect) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          subject: r.subject,
          bodyHtml: r.bodyHtml,
          bodyText: r.bodyText,
          variablesSchema: r.variablesSchema,
          isActive: r.isActive,
          isSystem: r.isSystem,
          version: r.version,
        }));
      }
    } catch {
      // Fallback to in-memory
    }
    return inMemoryTemplates;
  }

  static async getTemplate(idOrKey: number | string): Promise<EmailTemplateItem | null> {
    try {
      const condition = typeof idOrKey === 'number'
        ? eq(emailTemplates.id, idOrKey)
        : eq(emailTemplates.key, idOrKey);

      const rows = await db.select().from(emailTemplates).where(condition).limit(1);
      if (rows.length > 0) {
        const r = rows[0];
        return {
          id: r.id,
          key: r.key,
          name: r.name,
          subject: r.subject,
          bodyHtml: r.bodyHtml,
          bodyText: r.bodyText,
          variablesSchema: r.variablesSchema,
          isActive: r.isActive,
          isSystem: r.isSystem,
          version: r.version,
        };
      }
    } catch {
      // Fallback to in-memory
    }

    const found = inMemoryTemplates.find(t =>
      typeof idOrKey === 'number' ? t.id === idOrKey : t.key === idOrKey
    );
    return found || null;
  }

  static async updateTemplate(
    id: number,
    updates: { subject?: string; bodyHtml?: string; bodyText?: string; version?: number }
  ): Promise<EmailTemplateItem> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      throw new Error('Template not found');
    }

    if (updates.version !== undefined && updates.version !== existing.version) {
      const error = new Error('Version conflict: template has been updated by another administrator.');
      (error as unknown as { statusCode: number; code: string }).statusCode = 409;
      (error as unknown as { statusCode: number; code: string }).code = 'CONFLICT';
      throw error;
    }

    const newVersion = existing.version + 1;
    const merged: EmailTemplateItem = {
      ...existing,
      subject: updates.subject || existing.subject,
      bodyHtml: updates.bodyHtml || existing.bodyHtml,
      bodyText: updates.bodyText !== undefined ? updates.bodyText : existing.bodyText,
      version: newVersion,
    };

    try {
      await db
        .update(emailTemplates)
        .set({
          subject: merged.subject,
          bodyHtml: merged.bodyHtml,
          bodyText: merged.bodyText,
          version: newVersion,
          updatedAt: new Date(),
        })
        .where(eq(emailTemplates.id, id));
    } catch {
      // In-memory update
    }

    const idx = inMemoryTemplates.findIndex(t => t.id === id);
    if (idx !== -1) {
      inMemoryTemplates[idx] = merged;
    }

    return merged;
  }

  static async resetToDefault(id: number): Promise<EmailTemplateItem> {
    const current = await this.getTemplate(id);
    if (!current) throw new Error('Template not found');

    const def = EMAIL_EVENTS[current.key];
    const defaultContent = def ? DEFAULT_TEMPLATES[def.defaultTemplateKey] : null;

    if (!defaultContent) throw new Error('No default template available for this event');

    return await this.updateTemplate(id, {
      subject: defaultContent.subject,
      bodyHtml: defaultContent.bodyHtml,
      bodyText: defaultContent.bodyText,
    });
  }
}
