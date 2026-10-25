import { pool } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { cache, CACHE_TAGS } from '../../cache/index.js';

export interface StoreSettings {
  sellerRegistrationType: 'regular' | 'composition' | 'unregistered';
  sellerGstin: string;
  sellerLegalName: string;
  sellerTradeName: string;
  sellerState: string; // 2-digit GST code, e.g. '27'
  priceIncludesTax: boolean;
  roundingMode: 'per_line' | 'per_invoice';
  shippingTaxMode: 'product_proportional' | 'highest_product_rate' | 'fixed_service_rate';
  shippingTaxClassId?: number | null;
  codEnabled: boolean;
  codMinOrderPaise: number;
  codMaxOrderPaise: number;
  codFeePaise: number;
  codBlockedPincodes: string[];
  codRequiresConfirmation: boolean;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  sellerRegistrationType: 'regular',
  sellerGstin: '27AAPFU0939F1ZV',
  sellerLegalName: 'Universal Commerce Private Limited',
  sellerTradeName: 'Universal Store',
  sellerState: '27', // Maharashtra
  priceIncludesTax: false,
  roundingMode: 'per_line',
  shippingTaxMode: 'fixed_service_rate',
  shippingTaxClassId: null,
  codEnabled: true,
  codMinOrderPaise: 10000, // Rs 100
  codMaxOrderPaise: 5000000, // Rs 50,000
  codFeePaise: 5000, // Rs 50
  codBlockedPincodes: ['110000', '999999'],
  codRequiresConfirmation: false,
};

export interface TaxClassRecord {
  id: number;
  name: string;
  kind: 'goods' | 'service';
  codeType: 'HSN' | 'SAC';
  code: string;
  rateBasisPoints: number; // 1800 = 18%
  cessBasisPoints: number;
  isExempt: boolean;
}

export interface StateRecord {
  gstCode: string;
  name: string;
  isUnionTerritory: boolean;
  usesUtgst: boolean;
}

export interface CalculatedLineTax {
  productId: number;
  variantId?: number | null;
  title: string;
  sku?: string | null;
  hsnCode: string;
  taxClassId: number;
  taxRateBasisPoints: number;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
  taxableAmountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalTaxPaise: number;
  lineTotalPaise: number;
}

export interface QuoteCalculationResult {
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  taxTotal: number;
  shippingTotal: number;
  shippingTaxPaise: number;
  codFeePaise: number;
  codFeeTaxPaise: number;
  total: number;
  placeOfSupplyState: string;
  isInterstate: boolean;
  usesUtgst: boolean;
  invoiceType: 'tax_invoice' | 'bill_of_supply';
  lines: CalculatedLineTax[];
}

export class TaxEngine {
  static async getStoreSettings(): Promise<StoreSettings> {
    return await cache.getOrSet('store:settings:general', async () => {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>(
          "SELECT value FROM settings WHERE `key` = 'store_settings' LIMIT 1"
        );
        if (rows.length > 0 && rows[0].value) {
          const val = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
          return { ...DEFAULT_STORE_SETTINGS, ...val };
        }
        return DEFAULT_STORE_SETTINGS;
      } finally {
        connection.release();
      }
    }, 3600, [CACHE_TAGS.SETTINGS]);
  }

  static async updateStoreSettings(updates: Partial<StoreSettings>): Promise<StoreSettings> {
    const current = await this.getStoreSettings();
    const merged: StoreSettings = { ...current, ...updates };

    const connection = await pool.getConnection();
    try {
      await connection.query(
        `INSERT INTO settings (\`key\`, \`value\`, \`group\`, is_public, version)
         VALUES ('store_settings', ?, 'store', true, 1)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), version = version + 1`,
        [JSON.stringify(merged)]
      );
    } finally {
      connection.release();
    }

    await cache.invalidateTags([CACHE_TAGS.SETTINGS]);
    return merged;
  }

  static async getAllStates(): Promise<StateRecord[]> {
    return await cache.getOrSet('store:states:all', async () => {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT gst_code, name, is_union_territory, uses_utgst FROM states ORDER BY gst_code ASC'
        );
        return rows.map((r) => ({
          gstCode: r.gst_code,
          name: r.name,
          isUnionTerritory: Boolean(r.is_union_territory),
          usesUtgst: Boolean(r.uses_utgst),
        }));
      } finally {
        connection.release();
      }
    }, 86400, [CACHE_TAGS.SETTINGS]);
  }

  static async getAllTaxClasses(): Promise<TaxClassRecord[]> {
    return await cache.getOrSet('store:tax_classes:all', async () => {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM tax_classes ORDER BY rate_basis_points ASC'
        );
        return rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          kind: r.kind,
          codeType: r.code_type,
          code: r.code,
          rateBasisPoints: Number(r.rate_basis_points),
          cessBasisPoints: Number(r.cess_basis_points || 0),
          isExempt: Boolean(r.is_exempt),
        }));
      } finally {
        connection.release();
      }
    }, 3600, [CACHE_TAGS.SETTINGS]);
  }

  static async resolveState(stateInput?: string | null): Promise<StateRecord> {
    const allStates = await this.getAllStates();
    if (!stateInput) {
      // Default to Maharashtra (27)
      return allStates.find((s) => s.gstCode === '27') || {
        gstCode: '27',
        name: 'Maharashtra',
        isUnionTerritory: false,
        usesUtgst: false,
      };
    }

    const trimmed = stateInput.trim();
    // Direct code match
    const byCode = allStates.find((s) => s.gstCode === trimmed);
    if (byCode) return byCode;

    // Case-insensitive name match
    const lower = trimmed.toLowerCase();
    const byName = allStates.find((s) => s.name.toLowerCase() === lower);
    if (byName) return byName;

    // Fallback default
    return allStates.find((s) => s.gstCode === '27') || {
      gstCode: '27',
      name: 'Maharashtra',
      isUnionTerritory: false,
      usesUtgst: false,
    };
  }

  static async calculateOrderTaxes(params: {
    items: Array<{
      productId: number;
      variantId?: number | null;
      title: string;
      sku?: string | null;
      price: number;
      quantity: number;
      taxClassId?: number | null;
      hsnCode?: string | null;
    }>;
    placeOfSupplyState?: string | null;
    shippingPincode?: string | null;
    shippingAmount?: number;
    couponDiscount?: number;
    paymentMethod?: string;
  }): Promise<QuoteCalculationResult> {
    const settings = await this.getStoreSettings();
    const taxClasses = await this.getAllTaxClasses();
    const defaultTaxClass = taxClasses.find((t) => t.rateBasisPoints === 1800) || taxClasses[0] || {
      id: 1,
      name: 'Standard GST 18%',
      kind: 'goods',
      codeType: 'HSN',
      code: '9900',
      rateBasisPoints: 1800,
      cessBasisPoints: 0,
      isExempt: false,
    };

    const buyerState = await this.resolveState(params.placeOfSupplyState);
    const sellerStateCode = settings.sellerState || '27';
    const isInterstate = buyerState.gstCode !== sellerStateCode;
    const usesUtgst = !isInterstate && buyerState.usesUtgst;

    const isUnregistered = settings.sellerRegistrationType === 'unregistered';
    const isComposition = settings.sellerRegistrationType === 'composition';
    const isTaxApplicable = !isUnregistered && !isComposition;
    const invoiceType: 'tax_invoice' | 'bill_of_supply' = isComposition || isUnregistered ? 'bill_of_supply' : 'tax_invoice';

    const subtotal = params.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const discountTotal = Math.min(params.couponDiscount || 0, subtotal);
    const discountedSubtotal = subtotal - discountTotal;

    // Line items calculation
    const lines: CalculatedLineTax[] = [];
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalUtgst = 0;
    let totalIgst = 0;
    let totalCess = 0;

    for (const item of params.items) {
      const tc = item.taxClassId ? taxClasses.find((t) => t.id === item.taxClassId) || defaultTaxClass : defaultTaxClass;
      const effectiveRateBps = isTaxApplicable && !tc.isExempt ? tc.rateBasisPoints : 0;
      const cessBps = isTaxApplicable && !tc.isExempt ? tc.cessBasisPoints : 0;

      const lineSubtotal = item.price * item.quantity;
      let taxableAmount = lineSubtotal;
      let taxAmount = 0;

      if (effectiveRateBps > 0) {
        if (settings.priceIncludesTax) {
          taxableAmount = Math.round((lineSubtotal * 10000) / (10000 + effectiveRateBps));
          taxAmount = lineSubtotal - taxableAmount;
        } else {
          taxableAmount = lineSubtotal;
          taxAmount = Math.round((taxableAmount * effectiveRateBps) / 10000);
        }
      }

      let cgst = 0;
      let sgst = 0;
      let utgst = 0;
      let igst = 0;
      const cess = cessBps > 0 ? Math.round((taxableAmount * cessBps) / 10000) : 0;

      if (effectiveRateBps > 0) {
        if (isInterstate) {
          igst = taxAmount;
        } else {
          // Half for CGST, half for SGST/UTGST
          cgst = Math.floor(taxAmount / 2);
          const remainder = taxAmount - cgst;
          if (usesUtgst) {
            utgst = remainder;
          } else {
            sgst = remainder;
          }
        }
      }

      const lineTaxTotal = cgst + sgst + utgst + igst + cess;
      const lineTotal = settings.priceIncludesTax ? lineSubtotal : taxableAmount + lineTaxTotal;

      totalTaxable += taxableAmount;
      totalCgst += cgst;
      totalSgst += sgst;
      totalUtgst += utgst;
      totalIgst += igst;
      totalCess += cess;

      lines.push({
        productId: item.productId,
        variantId: item.variantId || null,
        title: item.title,
        sku: item.sku || null,
        hsnCode: item.hsnCode || tc.code,
        taxClassId: tc.id,
        taxRateBasisPoints: effectiveRateBps,
        unitPrice: item.price,
        quantity: item.quantity,
        lineSubtotal,
        taxableAmountPaise: taxableAmount,
        cgstPaise: cgst,
        sgstPaise: sgst,
        utgstPaise: utgst,
        igstPaise: igst,
        cessPaise: cess,
        totalTaxPaise: lineTaxTotal,
        lineTotalPaise: lineTotal,
      });
    }

    // Shipping tax
    const shippingTotal = params.shippingAmount || 0;
    let shippingTaxPaise = 0;
    if (shippingTotal > 0 && isTaxApplicable) {
      // Services standard 18% GST (SAC 9983)
      const shippingRateBps = 1800;
      shippingTaxPaise = Math.round((shippingTotal * shippingRateBps) / 10000);
      if (isInterstate) {
        totalIgst += shippingTaxPaise;
      } else if (usesUtgst) {
        const half = Math.floor(shippingTaxPaise / 2);
        totalCgst += half;
        totalUtgst += shippingTaxPaise - half;
      } else {
        const half = Math.floor(shippingTaxPaise / 2);
        totalCgst += half;
        totalSgst += shippingTaxPaise - half;
      }
    }

    // COD Rules & Fee
    let codFeePaise = 0;
    let codFeeTaxPaise = 0;
    if (params.paymentMethod === 'cod') {
      if (!settings.codEnabled) {
        const err = new Error('Cash on Delivery (COD) is currently disabled');
        (err as any).statusCode = 400;
        (err as any).code = 'COD_DISABLED';
        throw err;
      }

      if (params.shippingPincode && settings.codBlockedPincodes?.includes(params.shippingPincode.trim())) {
        const err = new Error(`Cash on Delivery is not available for pincode ${params.shippingPincode}`);
        (err as any).statusCode = 400;
        (err as any).code = 'COD_PINCODE_BLOCKED';
        throw err;
      }

      if (discountedSubtotal < settings.codMinOrderPaise) {
        const err = new Error(`Order subtotal of Rs ${discountedSubtotal / 100} is below the minimum COD threshold of Rs ${settings.codMinOrderPaise / 100}`);
        (err as any).statusCode = 400;
        (err as any).code = 'COD_MIN_THRESHOLD_NOT_MET';
        throw err;
      }

      if (discountedSubtotal > settings.codMaxOrderPaise) {
        const err = new Error(`Order subtotal of Rs ${discountedSubtotal / 100} exceeds the maximum COD threshold of Rs ${settings.codMaxOrderPaise / 100}`);
        (err as any).statusCode = 400;
        (err as any).code = 'COD_MAX_THRESHOLD_EXCEEDED';
        throw err;
      }

      codFeePaise = settings.codFeePaise || 0;
      if (codFeePaise > 0 && isTaxApplicable) {
        codFeeTaxPaise = Math.round((codFeePaise * 1800) / 10000);
        if (isInterstate) {
          totalIgst += codFeeTaxPaise;
        } else if (usesUtgst) {
          const half = Math.floor(codFeeTaxPaise / 2);
          totalCgst += half;
          totalUtgst += codFeeTaxPaise - half;
        } else {
          const half = Math.floor(codFeeTaxPaise / 2);
          totalCgst += half;
          totalSgst += codFeeTaxPaise - half;
        }
      }
    }

    const totalTax = totalCgst + totalSgst + totalUtgst + totalIgst + totalCess;
    const finalTotal = discountedSubtotal + (settings.priceIncludesTax ? 0 : totalTax) + shippingTotal + shippingTaxPaise + codFeePaise + codFeeTaxPaise;

    return {
      subtotal,
      discountTotal,
      taxableAmount: totalTaxable,
      cgstPaise: totalCgst,
      sgstPaise: totalSgst,
      utgstPaise: totalUtgst,
      igstPaise: totalIgst,
      cessPaise: totalCess,
      taxTotal: totalTax,
      shippingTotal,
      shippingTaxPaise,
      codFeePaise,
      codFeeTaxPaise,
      total: finalTotal,
      placeOfSupplyState: buyerState.gstCode,
      isInterstate,
      usesUtgst,
      invoiceType,
      lines,
    };
  }
}
