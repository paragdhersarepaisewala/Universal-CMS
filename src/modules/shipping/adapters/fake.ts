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

export class FakeShippingAdapter implements ShippingAdapter {
  public readonly name = 'fake';
  public unserviceablePincodes: Set<string> = new Set(['000000', '111111']);
  public mockShipments: Map<string, CreateShipmentResult> = new Map();
  public mockStatus: Map<string, ShipmentStatus> = new Map();

  public async checkServiceability(
    pincode: string,
    _weightGrams: number,
    cod: boolean
  ): Promise<ServiceabilityResult> {
    if (this.unserviceablePincodes.has(pincode)) {
      return {
        serviceable: false,
        message: 'Destination pincode is not serviceable by Fake Express',
      };
    }
    return {
      serviceable: true,
      estimatedDays: 2,
      codAvailable: !cod || pincode !== '888888', // test pincode for cod failure
    };
  }

  public async calculateRates(params: RateCalculationParams): Promise<ShippingRateOption[]> {
    if (this.unserviceablePincodes.has(params.toPincode)) {
      return [];
    }

    const baseStandard = 4500; // Rs 45
    const baseExpress = 8500; // Rs 85
    const weightSurcharge = Math.max(0, Math.ceil((params.weightGrams - 500) / 500) * 2000);

    return [
      {
        code: 'fake_standard',
        name: 'Fake Standard Delivery',
        carrierName: 'Fake Courier Surface',
        amountPaise: baseStandard + weightSurcharge,
        estimatedDaysMin: 3,
        estimatedDaysMax: 5,
        partner: 'fake',
      },
      {
        code: 'fake_express',
        name: 'Fake Express Air Delivery',
        carrierName: 'Fake Courier Air',
        amountPaise: baseExpress + weightSurcharge * 2,
        estimatedDaysMin: 1,
        estimatedDaysMax: 2,
        partner: 'fake',
      },
    ];
  }

  public async createShipment(params: CreateShipmentParams): Promise<CreateShipmentResult> {
    const awb = `FAKE-AWB-${params.orderNumber}`;
    const trackingNumber = `FAKE-TRK-${params.shipmentNumber}`;

    const result: CreateShipmentResult = {
      partner: 'fake',
      partnerShipmentId: `FS-${params.shipmentNumber}`,
      partnerOrderId: `FO-${params.orderNumber}`,
      awb,
      trackingNumber,
      carrierName: 'Fake Courier Express',
      labelUrl: `https://fake-shipping.example.com/labels/${awb}.pdf`,
      shippingFeePaise: 4500,
    };

    this.mockShipments.set(awb, result);
    this.mockStatus.set(awb, 'manifested');

    return result;
  }

  public async trackShipment(awb: string): Promise<TrackingResult> {
    const status = this.mockStatus.get(awb) || 'manifested';
    return {
      awb,
      trackingNumber: `FAKE-TRK-${awb}`,
      status,
      carrierName: 'Fake Courier Express',
      estimatedDeliveryDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      events: [
        {
          status,
          activity: `Package state: ${status}`,
          location: 'Fake Hub, Mumbai',
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  public setMockStatus(awb: string, status: ShipmentStatus): void {
    this.mockStatus.set(awb, status);
  }

  public async cancelShipment(awb: string): Promise<{ success: boolean; message?: string }> {
    this.mockStatus.set(awb, 'cancelled');
    return { success: true, message: `Fake shipment ${awb} cancelled successfully` };
  }
}
