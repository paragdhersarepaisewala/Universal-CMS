import {
  ShippingAdapter,
  ServiceabilityResult,
  RateCalculationParams,
  ShippingRateOption,
  CreateShipmentParams,
  CreateShipmentResult,
  TrackingResult,
} from './types.js';

export class ManualFlatRateAdapter implements ShippingAdapter {
  public readonly name = 'manual';

  public async checkServiceability(
    pincode: string,
    _weightGrams: number,
    _cod: boolean
  ): Promise<ServiceabilityResult> {
    if (!pincode || pincode.length < 6 || pincode === '000000' || pincode === '999999') {
      return {
        serviceable: false,
        message: 'Pincode not serviceable by manual carrier',
      };
    }
    return {
      serviceable: true,
      estimatedDays: 4,
      codAvailable: true,
    };
  }

  public async calculateRates(params: RateCalculationParams): Promise<ShippingRateOption[]> {
    // 5000 paise base, + 4000 paise if > 1kg
    let amount = 5000;
    if (params.weightGrams > 1000) {
      amount += Math.ceil((params.weightGrams - 1000) / 1000) * 4000;
    }

    return [
      {
        code: 'manual_standard',
        name: 'Standard Surface Courier',
        carrierName: 'Merchant Fleet / Local Courier',
        amountPaise: amount,
        estimatedDaysMin: 3,
        estimatedDaysMax: 6,
        partner: 'manual',
      },
    ];
  }

  public async createShipment(params: CreateShipmentParams): Promise<CreateShipmentResult> {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const tracking = `MANUAL-${params.shipmentNumber}-${randomSuffix}`;
    const awb = `AWB-${params.shipmentNumber}`;

    return {
      partner: 'manual',
      partnerShipmentId: `MSHIP-${params.shipmentNumber}`,
      partnerOrderId: `MORD-${params.orderNumber}`,
      awb,
      trackingNumber: tracking,
      carrierName: 'Local Courier Fleet',
      labelUrl: `/api/v1/admin/shipping/shipments/${params.orderId}/label`,
      shippingFeePaise: 5000,
    };
  }

  public async trackShipment(awb: string): Promise<TrackingResult> {
    return {
      awb,
      trackingNumber: awb,
      status: 'manifested',
      carrierName: 'Local Courier Fleet',
      events: [
        {
          status: 'manifested',
          activity: 'Shipment created and ready for carrier pickup',
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  public async cancelShipment(awb: string): Promise<{ success: boolean; message?: string }> {
    return {
      success: true,
      message: `Manual shipment ${awb} cancelled`,
    };
  }
}
