export type ShipmentStatus =
  | 'manifested'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'rto'
  | 'cancelled';

export interface ServiceabilityResult {
  serviceable: boolean;
  estimatedDays?: number;
  codAvailable?: boolean;
  message?: string;
}

export interface ShippingRateOption {
  code: string;
  name: string;
  carrierName: string;
  amountPaise: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  partner: string;
}

export interface RateCalculationParams {
  fromPincode: string;
  toPincode: string;
  toCountry?: string;
  toState?: string;
  weightGrams: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  cod: boolean;
  declaredValuePaise: number;
}

export interface RecipientAddress {
  name: string;
  phone: string;
  email?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface CreateShipmentParams {
  orderId: number;
  orderNumber: string;
  shipmentNumber: string;
  recipient: RecipientAddress;
  weightGrams: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  cod: boolean;
  codAmountPaise?: number;
  declaredValuePaise: number;
  items: Array<{
    title: string;
    sku?: string;
    quantity: number;
    pricePaise: number;
  }>;
}

export interface CreateShipmentResult {
  partner: string;
  partnerShipmentId: string;
  partnerOrderId?: string;
  awb: string;
  trackingNumber: string;
  carrierName: string;
  labelUrl?: string;
  shippingFeePaise: number;
}

export interface TrackingEvent {
  status: ShipmentStatus;
  activity: string;
  location?: string;
  timestamp: string;
}

export interface TrackingResult {
  awb: string;
  trackingNumber: string;
  status: ShipmentStatus;
  carrierName?: string;
  estimatedDeliveryDate?: string;
  events: TrackingEvent[];
}

export interface ShippingAdapter {
  readonly name: string;
  checkServiceability(pincode: string, weightGrams: number, cod: boolean): Promise<ServiceabilityResult>;
  calculateRates(params: RateCalculationParams): Promise<ShippingRateOption[]>;
  createShipment(params: CreateShipmentParams): Promise<CreateShipmentResult>;
  trackShipment(awb: string): Promise<TrackingResult>;
  cancelShipment(awb: string): Promise<{ success: boolean; message?: string }>;
}
