import crypto from 'crypto';
import { db } from '../../db/index.js';
import { settings } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export interface MetaCapiUserData {
  email?: string;
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string;
  fbp?: string;
}

export interface MetaCapiCustomData {
  currency?: string;
  value?: number; // In main currency unit (e.g. 1299.00 INR)
  contentIds?: string[];
  contentType?: string;
  contents?: Array<{ id: string; quantity: number; itemPrice?: number }>;
  orderId?: string;
}

export interface MetaCapiEvent {
  eventName: 'Purchase' | 'InitiateCheckout' | 'AddToCart' | 'ViewContent';
  eventTime?: number;
  eventId: string;
  eventSourceUrl?: string;
  userData: MetaCapiUserData;
  customData?: MetaCapiCustomData;
  actionSource?: 'website' | 'system_generated';
}

export interface MetaCapiResponse {
  success: boolean;
  eventsReceived?: number;
  dryRun?: boolean;
  fbtraceId?: string;
  error?: string;
}

export class MetaCapiService {
  /**
   * Hashes string according to Meta specifications (lowercase, trimmed, SHA-256)
   */
  public static hashData(input?: string): string | undefined {
    if (!input) return undefined;
    const normalized = input.trim().toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Dispatches server-side event to Meta Conversions API
   */
  public static async dispatchEvent(event: MetaCapiEvent): Promise<MetaCapiResponse> {
    try {
      // 1. Resolve Meta Pixel ID and API token from settings
      let pixelId = process.env.META_PIXEL_ID || '';
      let accessToken = process.env.META_CAPI_ACCESS_TOKEN || '';

      try {
        const rows = await db.select().from(settings).where(eq(settings.key, 'seo_global')).limit(1);
        if (rows.length > 0 && rows[0].value) {
          const val = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
          if (val.metaPixelId) pixelId = val.metaPixelId;
          if (val.metaCapiToken) accessToken = val.metaCapiToken;
        }
      } catch {
        // Fallback to env
      }

      // 2. Prepare payload with normalized and hashed PII
      const payloadData = {
        event_name: event.eventName,
        event_time: event.eventTime || Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl || 'http://localhost:3000',
        action_source: event.actionSource || 'website',
        user_data: {
          em: event.userData.email ? [this.hashData(event.userData.email)] : undefined,
          ph: event.userData.phone ? [this.hashData(event.userData.phone)] : undefined,
          client_ip_address: event.userData.clientIpAddress,
          client_user_agent: event.userData.clientUserAgent,
          fbc: event.userData.fbc,
          fbp: event.userData.fbp,
        },
        custom_data: event.customData
          ? {
              currency: event.customData.currency || 'INR',
              value: event.customData.value,
              content_ids: event.customData.contentIds,
              content_type: event.customData.contentType || 'product',
              contents: event.customData.contents,
              order_id: event.customData.orderId,
            }
          : undefined,
      };

      // 3. Dry-run mode if token/pixel missing (e.g. offline testing or local development)
      if (!pixelId || !accessToken) {
        return {
          success: true,
          eventsReceived: 1,
          dryRun: true,
          fbtraceId: `dry_run_${event.eventId}`,
        };
      }

      // 4. Send HTTP request to Meta Graph API
      const endpoint = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: [payloadData],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: errorText,
        };
      }

      const result = (await response.json()) as { events_received?: number; fbtrace_id?: string };
      return {
        success: true,
        eventsReceived: result.events_received || 1,
        fbtraceId: result.fbtrace_id,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}
