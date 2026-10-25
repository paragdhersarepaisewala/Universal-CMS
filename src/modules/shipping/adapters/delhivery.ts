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

export interface DelhiveryConfig {
  apiKey?: string;
  clientName?: string;
  isStaging?: boolean;
}

export class DelhiveryAdapter implements ShippingAdapter {
  public readonly name = 'delhivery';
  private readonly apiKey: string;
  private readonly clientName: string;
  private readonly baseUrl: string;

  constructor(config: DelhiveryConfig = {}) {
    this.apiKey = config.apiKey || '';
    this.clientName = config.clientName || '';
    this.baseUrl = config.isStaging
      ? 'https://staging-express.delhivery.com'
      : 'https://track.delhivery.com';
  }

  public async checkServiceability(
    pincode: string,
    _weightGrams: number,
    cod: boolean
  ): Promise<ServiceabilityResult> {
    try {
      if (!this.apiKey) {
        return { serviceable: false, message: 'Delhivery API key not configured' };
      }

      const url = `${this.baseUrl}/c/api/pin-codes/json/?filter_codes=${pincode}`;
      const res = await fetch(url, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });

      if (!res.ok) {
        return { serviceable: false, message: 'Delhivery serviceability check failed' };
      }

      const data = (await res.json()) as {
        delivery_codes?: Array<{
          postal_code: {
            pin: number;
            pre_paid: string;
            cod: string;
            is_oda: string;
          };
        }>;
      };

      const match = data.delivery_codes?.[0]?.postal_code;
      if (!match) {
        return { serviceable: false, message: 'Pincode not serviceable by Delhivery' };
      }

      const codAvailable = match.cod === 'Y';
      if (cod && !codAvailable) {
        return { serviceable: false, codAvailable: false, message: 'COD not available for pincode' };
      }

      return {
        serviceable: true,
        estimatedDays: 3,
        codAvailable,
      };
    } catch (err: any) {
      return { serviceable: false, message: err.message };
    }
  }

  public async calculateRates(params: RateCalculationParams): Promise<ShippingRateOption[]> {
    try {
      if (!this.apiKey) return [];

      const url = `${this.baseUrl}/api/kinko/v1/invoice/charges/.json?md=S&ss=Delivered&d_pin=${params.toPincode}&o_pin=${params.fromPincode}&cgm=${params.weightGrams}&pt=${params.cod ? 'COD' : 'Pre-paid'}`;
      const res = await fetch(url, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });

      if (!res.ok) return [];

      const data = (await res.json()) as Array<{ total_amount: number }>;
      const charge = data[0]?.total_amount;
      if (!charge) return [];

      return [
        {
          code: 'delhivery_surface',
          name: 'Delhivery Surface Express',
          carrierName: 'Delhivery',
          amountPaise: Math.round(charge * 100),
          estimatedDaysMin: 3,
          estimatedDaysMax: 5,
          partner: 'delhivery',
        },
      ];
    } catch {
      return [];
    }
  }

  public async createShipment(params: CreateShipmentParams): Promise<CreateShipmentResult> {
    if (!this.apiKey) {
      throw new Error('Delhivery API key not configured');
    }

    const payload = {
      format: 'json',
      data: JSON.stringify({
        shipments: [
          {
            name: params.recipient.name,
            add: `${params.recipient.addressLine1} ${params.recipient.addressLine2 || ''}`,
            pin: params.recipient.pincode,
            city: params.recipient.city,
            state: params.recipient.state,
            country: params.recipient.country,
            phone: params.recipient.phone,
            order: params.orderNumber,
            payment_mode: params.cod ? 'COD' : 'Pre-paid',
            products_desc: params.items.map((i) => i.title).join(', '),
            cod_amount: params.cod ? String(Math.round((params.codAmountPaise || 0) / 100)) : '0',
            order_date: new Date().toISOString(),
            total_amount: Math.round(params.declaredValuePaise / 100),
            weight: params.weightGrams,
            client: this.clientName,
          },
        ],
        pickup_location: {
          name: 'Primary Warehouse',
        },
      }),
    };

    const res = await fetch(`${this.baseUrl}/api/cmu/create.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Token ${this.apiKey}`,
      },
      body: new URLSearchParams(payload as any).toString(),
    });

    if (!res.ok) {
      throw new Error(`Delhivery creation failed: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      packages?: Array<{
        waybill: string;
        refnum: string;
        status: string;
      }>;
    };

    const pkg = data.packages?.[0];
    const awb = pkg?.waybill || `DEL-${params.shipmentNumber}`;

    return {
      partner: 'delhivery',
      partnerShipmentId: awb,
      partnerOrderId: params.orderNumber,
      awb,
      trackingNumber: awb,
      carrierName: 'Delhivery Logistics',
      labelUrl: `${this.baseUrl}/api/p/packing_slip?wbns=${awb}`,
      shippingFeePaise: 6500,
    };
  }

  public async trackShipment(awb: string): Promise<TrackingResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/packages/json/?waybill=${awb}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    if (!res.ok) {
      return { awb, trackingNumber: awb, status: 'in_transit', events: [] };
    }

    const data = (await res.json()) as {
      ShipmentData?: Array<{
        Shipment?: {
          Status?: { Status: string; StatusDateTime: string; Instructions: string };
          Scans?: Array<{ ScanDetail?: { Scan: string; ScanDateTime: string; ScannedLocation: string } }>;
        };
      }>;
    };

    const shipment = data.ShipmentData?.[0]?.Shipment;
    const rawStatus = (shipment?.Status?.Status || '').toLowerCase();
    let status: ShipmentStatus = 'in_transit';
    if (rawStatus.includes('delivered')) status = 'delivered';
    else if (rawStatus.includes('out for delivery')) status = 'out_for_delivery';
    else if (rawStatus.includes('rto')) status = 'rto';
    else if (rawStatus.includes('manifest')) status = 'manifested';

    const events = (shipment?.Scans || []).map((s) => ({
      status,
      activity: s.ScanDetail?.Scan || 'Scanned',
      location: s.ScanDetail?.ScannedLocation,
      timestamp: s.ScanDetail?.ScanDateTime || new Date().toISOString(),
    }));

    return {
      awb,
      trackingNumber: awb,
      status,
      carrierName: 'Delhivery',
      events,
    };
  }

  public async cancelShipment(awb: string): Promise<{ success: boolean; message?: string }> {
    const res = await fetch(`${this.baseUrl}/api/p/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.apiKey}`,
      },
      body: JSON.stringify({ waybill: awb, cancellation: 'true' }),
    });

    return {
      success: res.ok,
      message: res.ok ? 'Delhivery waybill cancelled' : 'Failed to cancel Delhivery waybill',
    };
  }
}
