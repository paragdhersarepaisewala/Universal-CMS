import {
  ShippingAdapter,
  ServiceabilityResult,
  RateCalculationParams,
  ShippingRateOption,
  CreateShipmentParams,
  CreateShipmentResult,
  TrackingResult,
  ShipmentStatus,
} from './types.js';

export interface ShiprocketConfig {
  email?: string;
  password?: string;
  apiToken?: string;
}

export class ShiprocketAdapter implements ShippingAdapter {
  public readonly name = 'shiprocket';
  private apiToken?: string;
  private tokenExpiry?: number;
  private readonly baseUrl = 'https://apiv2.shiprocket.in/v1/external';

  constructor(private config: ShiprocketConfig = {}) {
    this.apiToken = config.apiToken;
  }

  private async getAuthToken(): Promise<string> {
    if (this.apiToken && (!this.tokenExpiry || Date.now() < this.tokenExpiry)) {
      return this.apiToken;
    }

    if (!this.config.email || !this.config.password) {
      throw new Error('Shiprocket email and password credentials required');
    }

    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`Shiprocket auth failed with status ${res.status}`);
    }

    const data = (await res.json()) as { token: string };
    this.apiToken = data.token;
    this.tokenExpiry = Date.now() + 23 * 3600 * 1000; // 23h validity
    return this.apiToken;
  }

  public async checkServiceability(
    pincode: string,
    weightGrams: number,
    cod: boolean
  ): Promise<ServiceabilityResult> {
    try {
      const token = await this.getAuthToken();
      const weightKg = (weightGrams / 1000).toFixed(2);
      const url = `${this.baseUrl}/courier/serviceability?delivery_postcode=${pincode}&weight=${weightKg}&cod=${cod ? 1 : 0}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        return { serviceable: false, message: 'Courier serviceability check failed' };
      }

      const data = (await res.json()) as {
        status: number;
        data?: { available_courier_companies?: Array<{ etd: string; cod: number }> };
      };

      const couriers = data.data?.available_courier_companies || [];
      if (couriers.length === 0) {
        return { serviceable: false, message: 'No couriers serviceable for this pincode' };
      }

      return {
        serviceable: true,
        estimatedDays: 3,
        codAvailable: couriers.some((c) => c.cod === 1),
      };
    } catch (err: any) {
      return { serviceable: false, message: err.message };
    }
  }

  public async calculateRates(params: RateCalculationParams): Promise<ShippingRateOption[]> {
    try {
      const token = await this.getAuthToken();
      const weightKg = (params.weightGrams / 1000).toFixed(2);
      const url = `${this.baseUrl}/courier/serviceability?pickup_postcode=${params.fromPincode}&delivery_postcode=${params.toPincode}&weight=${weightKg}&cod=${params.cod ? 1 : 0}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return [];

      const data = (await res.json()) as {
        data?: {
          available_courier_companies?: Array<{
            courier_company_id: number;
            courier_name: string;
            rate: number;
            etd: string;
            etd_hours?: number;
          }>;
        };
      };

      const couriers = data.data?.available_courier_companies || [];
      return couriers.slice(0, 3).map((c) => {
        const days = c.etd_hours ? Math.ceil(c.etd_hours / 24) : 4;
        return {
          code: `sr_${c.courier_company_id}`,
          name: `${c.courier_name} via Shiprocket`,
          carrierName: c.courier_name,
          amountPaise: Math.round(c.rate * 100),
          estimatedDaysMin: Math.max(1, days - 1),
          estimatedDaysMax: days + 2,
          partner: 'shiprocket',
        };
      });
    } catch {
      return [];
    }
  }

  public async createShipment(params: CreateShipmentParams): Promise<CreateShipmentResult> {
    const token = await this.getAuthToken();
    const payload = {
      order_id: params.orderNumber,
      order_date: new Date().toISOString().split('T')[0],
      pickup_location: 'Primary',
      billing_customer_name: params.recipient.name,
      billing_last_name: '',
      billing_address: params.recipient.addressLine1,
      billing_address_2: params.recipient.addressLine2 || '',
      billing_city: params.recipient.city,
      billing_pincode: params.recipient.pincode,
      billing_state: params.recipient.state,
      billing_country: params.recipient.country,
      billing_email: params.recipient.email || 'customer@example.com',
      billing_phone: params.recipient.phone,
      shipping_is_billing: true,
      order_items: params.items.map((i) => ({
        name: i.title,
        sku: i.sku || 'SKU-DEFAULT',
        units: i.quantity,
        selling_price: Math.round(i.pricePaise / 100),
      })),
      payment_method: params.cod ? 'COD' : 'Prepaid',
      sub_total: Math.round(params.declaredValuePaise / 100),
      length: params.lengthCm || 10,
      breadth: params.widthCm || 10,
      height: params.heightCm || 10,
      weight: (params.weightGrams / 1000).toFixed(2),
    };

    const res = await fetch(`${this.baseUrl}/orders/create/adhoc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Shiprocket shipment creation failed: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      order_id: number;
      shipment_id: number;
      awb_code?: string;
    };

    const awb = data.awb_code || `SR-AWB-${data.shipment_id}`;
    return {
      partner: 'shiprocket',
      partnerShipmentId: String(data.shipment_id),
      partnerOrderId: String(data.order_id),
      awb,
      trackingNumber: awb,
      carrierName: 'Shiprocket Logistics',
      labelUrl: `${this.baseUrl}/generate/label?shipment_id=${data.shipment_id}`,
      shippingFeePaise: 6000,
    };
  }

  public async trackShipment(awb: string): Promise<TrackingResult> {
    const token = await this.getAuthToken();
    const res = await fetch(`${this.baseUrl}/courier/track/awb/${awb}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return {
        awb,
        trackingNumber: awb,
        status: 'in_transit',
        events: [],
      };
    }

    const data = (await res.json()) as {
      tracking_data?: {
        track_status?: number;
        shipment_track?: Array<{ current_status: string }>;
        shipment_track_activities?: Array<{ activity: string; date: string; location: string }>;
      };
    };

    const rawStatus = data.tracking_data?.shipment_track?.[0]?.current_status?.toLowerCase() || '';
    let status: ShipmentStatus = 'in_transit';
    if (rawStatus.includes('delivered')) status = 'delivered';
    else if (rawStatus.includes('out for delivery')) status = 'out_for_delivery';
    else if (rawStatus.includes('cancel')) status = 'cancelled';
    else if (rawStatus.includes('rto')) status = 'rto';
    else if (rawStatus.includes('pickup') || rawStatus.includes('manifest')) status = 'manifested';

    const events = (data.tracking_data?.shipment_track_activities || []).map((a) => ({
      status,
      activity: a.activity,
      location: a.location,
      timestamp: a.date,
    }));

    return {
      awb,
      trackingNumber: awb,
      status,
      events,
    };
  }

  public async cancelShipment(awb: string): Promise<{ success: boolean; message?: string }> {
    const token = await this.getAuthToken();
    const res = await fetch(`${this.baseUrl}/orders/cancel/shipment/awbs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ awbs: [awb] }),
    });

    return {
      success: res.ok,
      message: res.ok ? 'Shipment cancelled with Shiprocket' : 'Failed to cancel with Shiprocket',
    };
  }
}
