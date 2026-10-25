export interface FulfilmentLineItem {
  id?: number;
  orderId: number;
  productId: number;
  variantId?: number | null;
  productType: 'physical' | 'digital';
  fulfilmentStatus?: 'not_required' | 'pending' | 'fulfilled' | 'revoked' | 'returned';
  title: string;
  sku?: string | null;
  price: number;
  quantity: number;
  total: number;
}

export interface FulfilmentContext {
  orderId: number;
  orderNumber: string;
  customerEmail: string;
}

export interface FulfilmentResult {
  status: 'fulfilled' | 'pending' | 'failed';
  details?: Record<string, unknown>;
}

export interface FulfilmentHandler {
  requiresShipping(item: { productType: string }): boolean;
  requiresStock(item: { productType: string; trackStock?: boolean }): boolean;
  onPaid(context: FulfilmentContext, lineItem: FulfilmentLineItem, tx?: any): Promise<FulfilmentResult>;
  onRefund(context: FulfilmentContext, lineItem: FulfilmentLineItem, quantity: number, tx?: any): Promise<void>;
  onCancel(context: FulfilmentContext, lineItem: FulfilmentLineItem, tx?: any): Promise<void>;
}

export class PhysicalFulfilmentHandler implements FulfilmentHandler {
  requiresShipping(_item: { productType: string }): boolean {
    return true;
  }

  requiresStock(item: { productType: string; trackStock?: boolean }): boolean {
    return item.trackStock !== false;
  }

  async onPaid(_context: FulfilmentContext, _lineItem: FulfilmentLineItem, _tx?: any): Promise<FulfilmentResult> {
    // Physical items await shipping and warehouse dispatch
    return { status: 'pending' };
  }

  async onRefund(_context: FulfilmentContext, _lineItem: FulfilmentLineItem, _quantity: number, _tx?: any): Promise<void> {
    // Physical refund handled via stock movements if restocked
  }

  async onCancel(_context: FulfilmentContext, _lineItem: FulfilmentLineItem, _tx?: any): Promise<void> {
    // Physical cancel handled via stock movement reversal
  }
}

export class DigitalFulfilmentHandler implements FulfilmentHandler {
  // Stub handler before H2.3D module: onPaid does nothing and returns 'pending'
  requiresShipping(_item: { productType: string }): boolean {
    return false;
  }

  requiresStock(item: { productType: string; trackStock?: boolean }): boolean {
    return item.trackStock === true;
  }

  async onPaid(_context: FulfilmentContext, _lineItem: FulfilmentLineItem, _tx?: any): Promise<FulfilmentResult> {
    // Per specification: Digital orders before H2.3D stay in confirmed with line fulfilment_status pending
    return { status: 'pending' };
  }

  async onRefund(_context: FulfilmentContext, _lineItem: FulfilmentLineItem, _quantity: number, _tx?: any): Promise<void> {
    // Revocation stub
  }

  async onCancel(_context: FulfilmentContext, _lineItem: FulfilmentLineItem, _tx?: any): Promise<void> {
    // Cancellation stub
  }
}

class FulfilmentRegistry {
  private handlers: Map<string, FulfilmentHandler> = new Map();

  constructor() {
    this.handlers.set('physical', new PhysicalFulfilmentHandler());
    this.handlers.set('digital', new DigitalFulfilmentHandler());
  }

  register(productType: string, handler: FulfilmentHandler): void {
    this.handlers.set(productType, handler);
  }

  get(productType: string): FulfilmentHandler {
    const handler = this.handlers.get(productType);
    if (!handler) {
      // Default to physical
      return this.handlers.get('physical')!;
    }
    return handler;
  }
}

export const fulfilmentRegistry = new FulfilmentRegistry();
