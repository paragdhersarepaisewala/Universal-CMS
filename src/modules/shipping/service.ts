import { pool } from '../../db/pool.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { moduleRegistry } from '../registry.js';
import {
  ShippingAdapter,
  ShippingRateOption,
  CreateShipmentResult,
  TrackingResult,
  ShipmentStatus,
  ServiceabilityResult,
} from './adapters/types.js';
import { ManualFlatRateAdapter } from './adapters/manual.js';
import { FakeShippingAdapter } from './adapters/fake.js';
import { ShiprocketAdapter } from './adapters/shiprocket.js';
import { DelhiveryAdapter } from './adapters/delhivery.js';
import { OrderStatus } from '../store/state-machine.js';
import { cache } from '../../cache/index.js';

export interface ShippingSettings {
  originPincode: string;
  originCity: string;
  originState: string;
  originCountry: string;
  defaultPartner: string;
  activePartners: string[];
  disabledBehavior: 'fallback_flat_rate' | 'block_physical';
  fallbackRatePaise: number;
  freeShippingThresholdPaise: number;
  shiprocketApiKey?: string;
  shiprocketApiSecret?: string;
  delhiveryApiKey?: string;
  delhiveryClientName?: string;
}

export class ShippingService {
  private static adapters: Map<string, ShippingAdapter> = new Map();
  private static fakeAdapterInstance = new FakeShippingAdapter();

  static {
    // Register built-in adapters
    this.registerAdapter(new ManualFlatRateAdapter());
    this.registerAdapter(this.fakeAdapterInstance);
    this.registerAdapter(new ShiprocketAdapter());
    this.registerAdapter(new DelhiveryAdapter());
  }

  public static registerAdapter(adapter: ShippingAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  public static getAdapter(name?: string): ShippingAdapter {
    const key = name || 'manual';
    const adapter = this.adapters.get(key);
    if (!adapter) {
      return this.adapters.get('manual') || new ManualFlatRateAdapter();
    }
    return adapter;
  }

  public static getFakeAdapter(): FakeShippingAdapter {
    return this.fakeAdapterInstance;
  }

  // 1. Settings
  public static async getSettings(): Promise<ShippingSettings> {
    return await cache.getOrSet('shipping:settings:general', async () => {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT value FROM settings WHERE `key` = ?',
        ['shipping_settings']
      );

      const defaults: ShippingSettings = {
        originPincode: '400001',
        originCity: 'Mumbai',
        originState: '27',
        originCountry: 'IN',
        defaultPartner: 'manual',
        activePartners: ['manual', 'fake'],
        disabledBehavior: 'fallback_flat_rate',
        fallbackRatePaise: 5000,
        freeShippingThresholdPaise: 100000,
      };

      if (rows.length === 0 || !rows[0].value) {
        return defaults;
      }

      try {
        const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
        return { ...defaults, ...parsed };
      } catch {
        return defaults;
      }
    });
  }

  public static async updateSettings(settings: Partial<ShippingSettings>): Promise<ShippingSettings> {
    await cache.delete('shipping:settings:general');
    const current = await this.getSettings();
    const updated = { ...current, ...settings };

    await pool.query(
      `INSERT INTO settings (\`key\`, \`value\`, \`group\`, is_public, version)
       VALUES ('shipping_settings', ?, 'shipping', true, 1)
       ON DUPLICATE KEY UPDATE \`value\` = ?, version = version + 1`,
      [JSON.stringify(updated), JSON.stringify(updated)]
    );

    await cache.delete('shipping:settings:general');
    return updated;
  }

  // 2. Zones & Rates
  public static async listZones(): Promise<any[]> {
    return await cache.getOrSet('shipping:zones:all', async () => {
      const [zones] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM shipping_zones ORDER BY priority DESC, id ASC'
      );

      const [rates] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM shipping_zone_rates WHERE is_active = TRUE ORDER BY rate_paise ASC'
      );

      return zones.map((z) => ({
        id: z.id,
        name: z.name,
        countries: typeof z.countries_json === 'string' ? JSON.parse(z.countries_json) : z.countries_json,
        states: z.states_json ? (typeof z.states_json === 'string' ? JSON.parse(z.states_json) : z.states_json) : null,
        pincodes: z.pincodes_json ? (typeof z.pincodes_json === 'string' ? JSON.parse(z.pincodes_json) : z.pincodes_json) : null,
        isActive: Boolean(z.is_active),
        priority: z.priority,
        rates: rates
          .filter((r) => r.zone_id === z.id)
          .map((r) => ({
            id: r.id,
            zoneId: r.zone_id,
            name: r.name,
            rateType: r.rate_type,
            minWeightGrams: r.min_weight_grams,
            maxWeightGrams: r.max_weight_grams,
            minOrderPaise: r.min_order_paise,
            maxOrderPaise: r.max_order_paise,
            ratePaise: r.rate_paise,
            estimatedDaysMin: r.estimated_days_min,
            estimatedDaysMax: r.estimated_days_max,
          })),
      }));
    });
  }

  public static async getZoneById(id: number): Promise<any | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM shipping_zones WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    const z = rows[0];

    const [rates] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM shipping_zone_rates WHERE zone_id = ? ORDER BY rate_paise ASC',
      [id]
    );

    return {
      id: z.id,
      name: z.name,
      countries: typeof z.countries_json === 'string' ? JSON.parse(z.countries_json) : z.countries_json,
      states: z.states_json ? (typeof z.states_json === 'string' ? JSON.parse(z.states_json) : z.states_json) : null,
      pincodes: z.pincodes_json ? (typeof z.pincodes_json === 'string' ? JSON.parse(z.pincodes_json) : z.pincodes_json) : null,
      isActive: Boolean(z.is_active),
      priority: z.priority,
      rates: rates.map((r) => ({
        id: r.id,
        zoneId: r.zone_id,
        name: r.name,
        rateType: r.rate_type,
        minWeightGrams: r.min_weight_grams,
        maxWeightGrams: r.max_weight_grams,
        minOrderPaise: r.min_order_paise,
        maxOrderPaise: r.max_order_paise,
        ratePaise: r.rate_paise,
        estimatedDaysMin: r.estimated_days_min,
        estimatedDaysMax: r.estimated_days_max,
        isActive: Boolean(r.is_active),
      })),
    };
  }

  public static async createZone(data: {
    name: string;
    countries: string[];
    states?: string[] | null;
    pincodes?: string[] | null;
    priority?: number;
  }): Promise<number> {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO shipping_zones (name, countries_json, states_json, pincodes_json, priority)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.name,
        JSON.stringify(data.countries || ['IN']),
        data.states ? JSON.stringify(data.states) : null,
        data.pincodes ? JSON.stringify(data.pincodes) : null,
        data.priority || 0,
      ]
    );
    await cache.delete('shipping:zones:all');
    return res.insertId;
  }

  public static async updateZone(
    id: number,
    data: {
      name?: string;
      countries?: string[];
      states?: string[] | null;
      pincodes?: string[] | null;
      priority?: number;
      isActive?: boolean;
    }
  ): Promise<boolean> {
    const sets: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      sets.push('name = ?');
      values.push(data.name);
    }
    if (data.countries !== undefined) {
      sets.push('countries_json = ?');
      values.push(JSON.stringify(data.countries));
    }
    if (data.states !== undefined) {
      sets.push('states_json = ?');
      values.push(data.states ? JSON.stringify(data.states) : null);
    }
    if (data.pincodes !== undefined) {
      sets.push('pincodes_json = ?');
      values.push(data.pincodes ? JSON.stringify(data.pincodes) : null);
    }
    if (data.priority !== undefined) {
      sets.push('priority = ?');
      values.push(data.priority);
    }
    if (data.isActive !== undefined) {
      sets.push('is_active = ?');
      values.push(data.isActive);
    }

    if (sets.length === 0) return true;
    values.push(id);

    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE shipping_zones SET ${sets.join(', ')} WHERE id = ?`,
      values
    );
    await cache.delete('shipping:zones:all');
    return res.affectedRows > 0;
  }

  public static async deleteZone(id: number): Promise<boolean> {
    const [res] = await pool.query<ResultSetHeader>(
      'DELETE FROM shipping_zones WHERE id = ?',
      [id]
    );
    await cache.delete('shipping:zones:all');
    return res.affectedRows > 0;
  }

  public static async createZoneRate(
    zoneId: number,
    data: {
      name: string;
      rateType?: string;
      minWeightGrams?: number;
      maxWeightGrams?: number | null;
      minOrderPaise?: number;
      maxOrderPaise?: number | null;
      ratePaise: number;
      estimatedDaysMin?: number;
      estimatedDaysMax?: number;
    }
  ): Promise<number> {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO shipping_zone_rates 
       (zone_id, name, rate_type, min_weight_grams, max_weight_grams, min_order_paise, max_order_paise, rate_paise, estimated_days_min, estimated_days_max)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        zoneId,
        data.name,
        data.rateType || 'weight_based',
        data.minWeightGrams ?? 0,
        data.maxWeightGrams ?? null,
        data.minOrderPaise ?? 0,
        data.maxOrderPaise ?? null,
        data.ratePaise,
        data.estimatedDaysMin ?? 2,
        data.estimatedDaysMax ?? 5,
      ]
    );
    await cache.delete('shipping:zones:all');
    return res.insertId;
  }

  // 3. Serviceability Check
  public static async checkServiceability(params: {
    pincode: string;
    weightGrams?: number;
    cod?: boolean;
    partner?: string;
  }): Promise<ServiceabilityResult> {
    const isModuleActive = moduleRegistry.isEnabled('shipping');
    if (!isModuleActive) {
      const settings = await this.getSettings();
      if (settings.disabledBehavior === 'block_physical') {
        return { serviceable: false, message: 'Shipping module is disabled' };
      }
      return { serviceable: true, estimatedDays: 5, codAvailable: true };
    }

    const adapter = this.getAdapter(params.partner);
    return adapter.checkServiceability(
      params.pincode,
      params.weightGrams || 500,
      Boolean(params.cod)
    );
  }

  // 4. Rate Calculation Engine
  public static async calculateShipping(cart: {
    items: Array<{
      productId?: number;
      productType?: string;
      quantity: number;
      pricePaise?: number;
      weightGrams?: number;
    }>;
    destination: {
      country?: string;
      state?: string;
      pincode: string;
    };
    cod?: boolean;
  }): Promise<ShippingRateOption[]> {
    const hasPhysical = cart.items.some((i) => (i.productType || 'physical') === 'physical');
    if (!hasPhysical) {
      // Digital only - zero shipping fee
      return [
        {
          code: 'digital_delivery',
          name: 'Instant Digital Delivery',
          carrierName: 'Electronic Delivery',
          amountPaise: 0,
          estimatedDaysMin: 0,
          estimatedDaysMax: 0,
          partner: 'manual',
        },
      ];
    }

    const settings = await this.getSettings();
    const isModuleActive = moduleRegistry.isEnabled('shipping');

    if (!isModuleActive) {
      if (settings.disabledBehavior === 'block_physical') {
        const error = new Error('Shipping is currently disabled for physical goods');
        (error as any).statusCode = 422;
        (error as any).code = 'SHIPPING_DISABLED';
        throw error;
      }
      // Fallback flat rate behavior
      return [
        {
          code: 'fallback_flat_rate',
          name: 'Flat Rate Delivery',
          carrierName: 'Standard Courier',
          amountPaise: settings.fallbackRatePaise || 5000,
          estimatedDaysMin: 3,
          estimatedDaysMax: 7,
          partner: 'manual',
        },
      ];
    }

    // Total weight calculation
    let totalWeightGrams = 0;
    let totalDeclaredValuePaise = 0;
    for (const item of cart.items) {
      const weight = item.weightGrams ?? 500;
      totalWeightGrams += weight * item.quantity;
      totalDeclaredValuePaise += (item.pricePaise || 0) * item.quantity;
    }
    if (totalWeightGrams <= 0) totalWeightGrams = 500;

    // Check free shipping threshold
    if (
      settings.freeShippingThresholdPaise > 0 &&
      totalDeclaredValuePaise >= settings.freeShippingThresholdPaise
    ) {
      return [
        {
          code: 'free_shipping',
          name: 'Free Standard Delivery',
          carrierName: 'Standard Shipping',
          amountPaise: 0,
          estimatedDaysMin: 3,
          estimatedDaysMax: 7,
          partner: 'manual',
        },
      ];
    }

    // Zone Matching
    const destCountry = (cart.destination.country || 'IN').toUpperCase();
    const destState = cart.destination.state || '';
    const destPincode = (cart.destination.pincode || '').trim();

    const zones = await this.listZones();
    let matchedZone: any = null;

    for (const zone of zones) {
      if (!zone.isActive) continue;

      // 1. Country match
      if (Array.isArray(zone.countries) && zone.countries.length > 0) {
        const countryMatch = zone.countries.some(
          (c: string) => c.toUpperCase() === destCountry || c === '*'
        );
        if (!countryMatch) continue;
      }

      // 2. Pincode match (if specified)
      if (Array.isArray(zone.pincodes) && zone.pincodes.length > 0) {
        const pinMatch = zone.pincodes.some((pattern: string) => {
          if (pattern.endsWith('*')) {
            return destPincode.startsWith(pattern.slice(0, -1));
          }
          return pattern === destPincode;
        });
        if (!pinMatch) continue;
      }

      // 3. State match (if specified)
      if (Array.isArray(zone.states) && zone.states.length > 0) {
        const stateMatch = zone.states.some(
          (s: string) => s.toLowerCase() === destState.toLowerCase()
        );
        if (!stateMatch) continue;
      }

      matchedZone = zone;
      break;
    }

    const rateOptions: ShippingRateOption[] = [];

    if (matchedZone && Array.isArray(matchedZone.rates)) {
      for (const rate of matchedZone.rates) {
        // Weight filter
        if (rate.minWeightGrams > totalWeightGrams) continue;
        if (rate.maxWeightGrams !== null && rate.maxWeightGrams < totalWeightGrams) continue;

        // Order value filter
        if (rate.minOrderPaise > totalDeclaredValuePaise) continue;
        if (rate.maxOrderPaise !== null && rate.maxOrderPaise < totalDeclaredValuePaise) continue;

        rateOptions.push({
          code: `rate_${rate.id}`,
          name: rate.name,
          carrierName: 'Ground Transport',
          amountPaise: Number(rate.ratePaise),
          estimatedDaysMin: rate.estimatedDaysMin,
          estimatedDaysMax: rate.estimatedDaysMax,
          partner: 'manual',
        });
      }
    }

    // Call active partner adapters (e.g. fake in test, shiprocket/delhivery in prod)
    for (const partnerName of settings.activePartners || []) {
      if (partnerName === 'manual') continue; // Handled by zone rates
      const adapter = this.adapters.get(partnerName);
      if (adapter) {
        try {
          const partnerRates = await adapter.calculateRates({
            fromPincode: settings.originPincode,
            toPincode: destPincode,
            toCountry: destCountry,
            toState: destState,
            weightGrams: totalWeightGrams,
            cod: Boolean(cart.cod),
            declaredValuePaise: totalDeclaredValuePaise,
          });
          rateOptions.push(...partnerRates);
        } catch {
          // Keep zone rates even if partner throws
        }
      }
    }

    // If no rates matched, provide fallback standard rate
    if (rateOptions.length === 0) {
      rateOptions.push({
        code: 'standard_shipping',
        name: 'Standard Surface Delivery',
        carrierName: 'Standard Shipping',
        amountPaise: settings.fallbackRatePaise || 5000,
        estimatedDaysMin: 3,
        estimatedDaysMax: 7,
        partner: 'manual',
      });
    }

    // Sort by price ascending
    return rateOptions.sort((a, b) => a.amountPaise - b.amountPaise);
  }

  // 5. Create Shipment
  public static async createShipment(params: {
    orderId: number;
    partner?: string;
    weightGrams?: number;
    carrierName?: string;
    shippingFeePaise?: number;
  }): Promise<any> {
    const [orders] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM orders WHERE id = ?',
      [params.orderId]
    );

    if (orders.length === 0) {
      throw new Error('Order not found');
    }

    const order = orders[0];
    const partner = params.partner || 'manual';
    const adapter = this.getAdapter(partner);

    const [items] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM order_items WHERE order_id = ?',
      [params.orderId]
    );

    const [shipmentCountRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as cnt FROM shipping_shipments WHERE order_id = ?',
      [params.orderId]
    );
    const shipmentSeq = (shipmentCountRows[0]?.cnt || 0) + 1;
    const shipmentNumber = `SHP-${order.order_number}-${shipmentSeq}`;

    const shippingAddr =
      typeof order.shipping_address === 'string'
        ? JSON.parse(order.shipping_address)
        : order.shipping_address || {};

    const recipient = {
      name: shippingAddr.name || 'Valued Customer',
      phone: shippingAddr.phone || '9999999999',
      email: order.customer_email,
      addressLine1: shippingAddr.line1 || shippingAddr.address1 || 'Address Line 1',
      addressLine2: shippingAddr.line2 || shippingAddr.address2 || '',
      city: shippingAddr.city || 'Mumbai',
      state: shippingAddr.state || order.place_of_supply_state || '27',
      pincode: shippingAddr.pincode || shippingAddr.postalCode || '400001',
      country: shippingAddr.country || 'IN',
    };

    const isCod = order.payment_method === 'cod';
    const declaredValuePaise = order.total;

    const adapterResult = await adapter.createShipment({
      orderId: order.id,
      orderNumber: order.order_number,
      shipmentNumber,
      recipient,
      weightGrams: params.weightGrams || 500,
      cod: isCod,
      codAmountPaise: isCod ? order.total : 0,
      declaredValuePaise,
      items: items.map((i) => ({
        title: i.title,
        sku: i.sku,
        quantity: i.quantity,
        pricePaise: i.price,
      })),
    });

    const carrierName = params.carrierName || adapterResult.carrierName || 'Standard Logistics';

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO shipping_shipments 
       (order_id, shipment_number, partner, partner_shipment_id, partner_order_id, awb, tracking_number, carrier_name, status, label_url, weight_grams, is_cod, cod_amount_paise, shipping_fee_paise, shipped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manifested', ?, ?, ?, ?, ?, NOW())`,
      [
        order.id,
        shipmentNumber,
        partner,
        adapterResult.partnerShipmentId,
        adapterResult.partnerOrderId || null,
        adapterResult.awb,
        adapterResult.trackingNumber,
        carrierName,
        adapterResult.labelUrl || null,
        params.weightGrams || 500,
        isCod,
        isCod ? order.total : 0,
        params.shippingFeePaise || adapterResult.shippingFeePaise || 0,
      ]
    );

    // Update order with tracking information
    await pool.query(
      `UPDATE orders 
       SET shipping_awb = ?, tracking_number = ?, shipping_carrier = ?, status = 'processing', updated_at = NOW()
       WHERE id = ?`,
      [adapterResult.awb, adapterResult.trackingNumber, carrierName, order.id]
    );

    // Update order items' fulfilment status to processing
    await pool.query(
      `UPDATE order_items 
       SET fulfilment_status = 'fulfilled' 
       WHERE order_id = ? AND product_type = 'physical'`,
      [order.id]
    );

    return {
      id: res.insertId,
      orderId: order.id,
      shipmentNumber,
      partner,
      awb: adapterResult.awb,
      trackingNumber: adapterResult.trackingNumber,
      carrierName,
      status: 'manifested',
      labelUrl: adapterResult.labelUrl,
    };
  }

  // 6. Track Shipment
  public static async trackShipment(identifier: string | number): Promise<TrackingResult> {
    let query = 'SELECT * FROM shipping_shipments WHERE id = ?';
    if (typeof identifier === 'string' && isNaN(Number(identifier))) {
      query = 'SELECT * FROM shipping_shipments WHERE awb = ? OR tracking_number = ? LIMIT 1';
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      query,
      typeof identifier === 'number' || !isNaN(Number(identifier))
        ? [Number(identifier)]
        : [identifier, identifier]
    );

    if (rows.length === 0) {
      throw new Error(`Shipment not found for identifier: ${identifier}`);
    }

    const s = rows[0];
    const adapter = this.getAdapter(s.partner);
    const tracking = await adapter.trackShipment(s.awb);

    // Update status in DB if changed
    if (tracking.status && tracking.status !== s.status) {
      await pool.query(
        'UPDATE shipping_shipments SET status = ?, tracking_history_json = ?, updated_at = NOW() WHERE id = ?',
        [tracking.status, JSON.stringify(tracking.events), s.id]
      );
    }

    return tracking;
  }

  // 7. Webhook Handler
  public static async handleTrackingWebhook(
    partner: string,
    payload: any
  ): Promise<{ processed: boolean; awb?: string; newStatus?: string }> {
    let awb: string | undefined;
    let status: ShipmentStatus = 'in_transit';
    let activity = 'Tracking update';
    let location = '';

    if (partner === 'fake') {
      awb = payload.awb;
      status = payload.status || 'in_transit';
      activity = payload.activity || `Status updated to ${status}`;
    } else if (partner === 'shiprocket') {
      awb = payload.awb;
      const srStatus = (payload.current_status || '').toLowerCase();
      if (srStatus.includes('delivered')) status = 'delivered';
      else if (srStatus.includes('out for delivery')) status = 'out_for_delivery';
      else if (srStatus.includes('rto')) status = 'rto';
      else if (srStatus.includes('cancel')) status = 'cancelled';
      else status = 'in_transit';
      activity = payload.activity || srStatus;
      location = payload.location || '';
    } else if (partner === 'delhivery') {
      awb = payload.Shipment?.Waybill || payload.waybill;
      const dStatus = (payload.Shipment?.Status?.Status || '').toLowerCase();
      if (dStatus.includes('delivered')) status = 'delivered';
      else if (dStatus.includes('out for delivery')) status = 'out_for_delivery';
      else if (dStatus.includes('rto')) status = 'rto';
      else status = 'in_transit';
      activity = payload.Shipment?.Status?.Instructions || dStatus;
    } else {
      awb = payload.awb || payload.tracking_number;
      status = payload.status || 'in_transit';
    }

    if (!awb) {
      return { processed: false };
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM shipping_shipments WHERE awb = ? LIMIT 1',
      [awb]
    );

    if (rows.length === 0) {
      return { processed: false, awb };
    }

    const shipment = rows[0];
    const history: any[] = shipment.tracking_history_json
      ? typeof shipment.tracking_history_json === 'string'
        ? JSON.parse(shipment.tracking_history_json)
        : shipment.tracking_history_json
      : [];

    history.push({
      status,
      activity,
      location,
      timestamp: new Date().toISOString(),
    });

    const isDelivered = status === 'delivered';

    await pool.query(
      `UPDATE shipping_shipments 
       SET status = ?, 
           tracking_history_json = ?, 
           delivered_at = ${isDelivered ? 'NOW()' : 'delivered_at'}, 
           updated_at = NOW() 
       WHERE id = ?`,
      [status, JSON.stringify(history), shipment.id]
    );

    // If shipment is delivered, update order status to fulfilled and order items to fulfilled
    if (isDelivered) {
      await pool.query(
        "UPDATE orders SET status = 'fulfilled', updated_at = NOW() WHERE id = ?",
        [shipment.order_id]
      );

      await pool.query(
        "UPDATE order_items SET fulfilment_status = 'fulfilled' WHERE order_id = ?",
        [shipment.order_id]
      );

      // Write status history
      await pool.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, actor, reason)
         VALUES (?, 'processing', 'fulfilled', 'system_webhook', 'Shipment marked delivered by carrier webhook')`,
        [shipment.order_id]
      );
    }

    return { processed: true, awb, newStatus: status };
  }
}
