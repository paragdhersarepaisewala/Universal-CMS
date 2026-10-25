import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../../db/pool.js';
import PDFDocument from 'pdfkit';
import { TaxEngine, StoreSettings } from './tax.js';

export interface InvoiceRecord {
  id: number;
  orderId: number;
  invoiceNumber: string;
  financialYear: string;
  invoiceType: 'tax_invoice' | 'bill_of_supply';
  status: 'issued' | 'cancelled';
  sellerSnapshot: any;
  buyerSnapshot: any;
  lineItemsSnapshot: any;
  taxSummary: any;
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  utgstAmountPaise: number;
  igstAmountPaise: number;
  cessAmountPaise: number;
  totalTaxPaise: number;
  shippingPaise: number;
  shippingTaxPaise: number;
  totalAmountPaise: number;
  issuedAt: string;
  createdAt: string;
}

export interface CreditNoteRecord {
  id: number;
  invoiceId: number;
  orderId: number;
  refundId?: number | null;
  creditNoteNumber: string;
  financialYear: string;
  reason: string;
  snapshot: any;
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  utgstAmountPaise: number;
  igstAmountPaise: number;
  cessAmountPaise: number;
  totalTaxPaise: number;
  totalAmountPaise: number;
  issuedAt: string;
  createdAt: string;
}

export class InvoiceService {
  /**
   * Deterministically calculate Indian Financial Year (starts April 1, ends March 31).
   * E.g. Oct 2026 -> '2026-27', Feb 2027 -> '2026-27'.
   */
  static getFinancialYear(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed: 0 = Jan, 3 = April
    let startYear: number;
    let endYear: number;

    if (month >= 3) {
      // April to December
      startYear = year;
      endYear = year + 1;
    } else {
      // January to March
      startYear = year - 1;
      endYear = year;
    }

    const shortEndYear = String(endYear).slice(-2);
    return `${startYear}-${shortEndYear}`;
  }

  /**
   * Generate next sequential invoice number atomically within active transaction.
   */
  static async getNextInvoiceNumber(connection: PoolConnection, fy: string): Promise<string> {
    await connection.query(
      `INSERT INTO invoice_sequences (financial_year, last_invoice_number, last_credit_note_number)
       VALUES (?, 0, 0)
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [fy]
    );

    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT last_invoice_number FROM invoice_sequences WHERE financial_year = ? FOR UPDATE',
      [fy]
    );

    const nextSeq = (Number(rows[0]?.last_invoice_number) || 0) + 1;
    await connection.query(
      'UPDATE invoice_sequences SET last_invoice_number = ? WHERE financial_year = ?',
      [nextSeq, fy]
    );

    return `INV/${fy}/${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Generate next sequential credit note number atomically within active transaction.
   */
  static async getNextCreditNoteNumber(connection: PoolConnection, fy: string): Promise<string> {
    await connection.query(
      `INSERT INTO invoice_sequences (financial_year, last_invoice_number, last_credit_note_number)
       VALUES (?, 0, 0)
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [fy]
    );

    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT last_credit_note_number FROM invoice_sequences WHERE financial_year = ? FOR UPDATE',
      [fy]
    );

    const nextSeq = (Number(rows[0]?.last_credit_note_number) || 0) + 1;
    await connection.query(
      'UPDATE invoice_sequences SET last_credit_note_number = ? WHERE financial_year = ?',
      [nextSeq, fy]
    );

    return `CN/${fy}/${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Generate formal invoice for paid order.
   */
  static async generateInvoice(
    orderId: number,
    connection?: PoolConnection
  ): Promise<InvoiceRecord> {
    const conn: PoolConnection = connection || (await pool.getConnection());
    const shouldRelease = !connection;

    try {
      if (!connection) await conn.beginTransaction();

      // Check if invoice already exists
      const [existing] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM invoices WHERE order_id = ? LIMIT 1',
        [orderId]
      );
      if (existing.length > 0) {
        if (!connection) await conn.commit();
        return this.mapInvoiceRecord(existing[0]);
      }

      // Fetch order and items
      const [orderRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? FOR UPDATE',
        [orderId]
      );
      if (orderRows.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }
      const order = orderRows[0];

      const [itemRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM order_items WHERE order_id = ?',
        [orderId]
      );

      const settings: StoreSettings = await TaxEngine.getStoreSettings();
      const fy = this.getFinancialYear(new Date(order.created_at || Date.now()));
      const invoiceNumber = await this.getNextInvoiceNumber(conn, fy);

      const isUnregistered = settings.sellerRegistrationType === 'unregistered';
      const isComposition = settings.sellerRegistrationType === 'composition';
      const invoiceType: 'tax_invoice' | 'bill_of_supply' = isComposition || isUnregistered ? 'bill_of_supply' : 'tax_invoice';

      const sellerSnapshot = {
        legalName: settings.sellerLegalName,
        tradeName: settings.sellerTradeName,
        gstin: settings.sellerGstin,
        stateCode: settings.sellerState,
        registrationType: settings.sellerRegistrationType,
      };

      const shippingAddress = typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address;
      const billingAddress = typeof order.billing_address === 'string' ? JSON.parse(order.billing_address) : order.billing_address;

      const buyerSnapshot = {
        email: order.customer_email,
        gstin: order.buyer_gstin || null,
        placeOfSupplyState: order.place_of_supply_state || '27',
        shippingAddress: shippingAddress || null,
        billingAddress: billingAddress || null,
      };

      const lineItemsSnapshot = itemRows.map((it) => ({
        id: Number(it.id),
        productId: Number(it.product_id),
        title: it.title,
        sku: it.sku,
        hsnCode: it.hsn_code || '9900',
        unitPrice: Number(it.price),
        quantity: Number(it.quantity),
        taxableAmountPaise: Number(it.taxable_amount_paise || it.total),
        taxRateBasisPoints: Number(it.tax_rate_basis_points || 0),
        cgstPaise: Number(it.cgst_paise || 0),
        sgstPaise: Number(it.sgst_paise || 0),
        utgstPaise: Number(it.utgst_paise || 0),
        igstPaise: Number(it.igst_paise || 0),
        cessPaise: Number(it.cess_paise || 0),
        totalPaise: Number(it.total),
      }));

      const taxSummary = {
        taxableAmountPaise: Number(order.subtotal) - Number(order.discount_total),
        cgstAmountPaise: Number(order.cgst_paise || 0),
        sgstAmountPaise: Number(order.sgst_paise || 0),
        utgstAmountPaise: Number(order.utgst_paise || 0),
        igstAmountPaise: Number(order.igst_paise || 0),
        cessAmountPaise: Number(order.cess_paise || 0),
        shippingPaise: Number(order.shipping_total || 0),
        codFeePaise: Number(order.cod_fee_paise || 0),
        codFeeTaxPaise: Number(order.cod_fee_tax_paise || 0),
      };

      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO invoices (
          order_id, invoice_number, financial_year, invoice_type, status,
          seller_snapshot, buyer_snapshot, line_items_snapshot, tax_summary,
          taxable_amount_paise, cgst_amount_paise, sgst_amount_paise,
          utgst_amount_paise, igst_amount_paise, cess_amount_paise,
          total_tax_paise, shipping_paise, shipping_tax_paise, total_amount_paise
        ) VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          orderId,
          invoiceNumber,
          fy,
          invoiceType,
          JSON.stringify(sellerSnapshot),
          JSON.stringify(buyerSnapshot),
          JSON.stringify(lineItemsSnapshot),
          JSON.stringify(taxSummary),
          taxSummary.taxableAmountPaise,
          taxSummary.cgstAmountPaise,
          taxSummary.sgstAmountPaise,
          taxSummary.utgstAmountPaise,
          taxSummary.igstAmountPaise,
          taxSummary.cessAmountPaise,
          Number(order.tax_total || 0),
          Number(order.shipping_total || 0),
          Number(order.total),
        ]
      );

      const invoiceId = res.insertId;
      await conn.query('UPDATE orders SET invoice_id = ? WHERE id = ?', [invoiceId, orderId]);

      if (!connection) await conn.commit();

      const [invRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM invoices WHERE id = ?',
        [invoiceId]
      );
      return this.mapInvoiceRecord(invRows[0]);
    } catch (err) {
      if (!connection) await conn.rollback();
      throw err;
    } finally {
      if (shouldRelease) conn.release();
    }
  }

  /**
   * Generate formal credit note for refund.
   */
  static async generateCreditNote(
    params: {
      orderId: number;
      refundId?: number | null;
      amountPaise: number;
      reason: string;
    },
    connection?: PoolConnection
  ): Promise<CreditNoteRecord | null> {
    const conn: PoolConnection = connection || (await pool.getConnection());
    const shouldRelease = !connection;

    try {
      if (!connection) await conn.beginTransaction();

      // Check if order has an invoice
      const [invRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM invoices WHERE order_id = ? LIMIT 1',
        [params.orderId]
      );
      if (invRows.length === 0) {
        // No invoice issued yet; no credit note needed
        if (!connection) await conn.commit();
        return null;
      }
      const invoice = invRows[0];

      const fy = this.getFinancialYear(new Date());
      const creditNoteNumber = await this.getNextCreditNoteNumber(conn, fy);

      // Proportional tax attribution
      const invTotal = Number(invoice.total_amount_paise) || 1;
      const ratio = params.amountPaise / invTotal;

      const taxablePaise = Math.round(Number(invoice.taxable_amount_paise) * ratio);
      const cgstPaise = Math.round(Number(invoice.cgst_amount_paise) * ratio);
      const sgstPaise = Math.round(Number(invoice.sgst_amount_paise) * ratio);
      const utgstPaise = Math.round(Number(invoice.utgst_amount_paise) * ratio);
      const igstPaise = Math.round(Number(invoice.igst_amount_paise) * ratio);
      const cessPaise = Math.round(Number(invoice.cess_amount_paise) * ratio);
      const totalTaxPaise = cgstPaise + sgstPaise + utgstPaise + igstPaise + cessPaise;

      const snapshot = {
        invoiceNumber: invoice.invoice_number,
        refundAmountPaise: params.amountPaise,
        ratio,
        reason: params.reason,
      };

      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO credit_notes (
          invoice_id, order_id, refund_id, credit_note_number, financial_year,
          reason, snapshot, taxable_amount_paise, cgst_amount_paise,
          sgst_amount_paise, utgst_amount_paise, igst_amount_paise,
          cess_amount_paise, total_tax_paise, total_amount_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice.id,
          params.orderId,
          params.refundId || null,
          creditNoteNumber,
          fy,
          params.reason,
          JSON.stringify(snapshot),
          taxablePaise,
          cgstPaise,
          sgstPaise,
          utgstPaise,
          igstPaise,
          cessPaise,
          totalTaxPaise,
          params.amountPaise,
        ]
      );

      if (!connection) await conn.commit();

      const [cnRows] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM credit_notes WHERE id = ?',
        [res.insertId]
      );
      return this.mapCreditNoteRecord(cnRows[0]);
    } catch (err) {
      if (!connection) await conn.rollback();
      throw err;
    } finally {
      if (shouldRelease) conn.release();
    }
  }

  static async getInvoiceById(id: number): Promise<InvoiceRecord | null> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM invoices WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? this.mapInvoiceRecord(rows[0]) : null;
    } finally {
      connection.release();
    }
  }

  static async getInvoiceByOrderId(orderId: number): Promise<InvoiceRecord | null> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM invoices WHERE order_id = ?',
        [orderId]
      );
      return rows.length > 0 ? this.mapInvoiceRecord(rows[0]) : null;
    } finally {
      connection.release();
    }
  }

  static async getCreditNoteById(id: number): Promise<CreditNoteRecord | null> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM credit_notes WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? this.mapCreditNoteRecord(rows[0]) : null;
    } finally {
      connection.release();
    }
  }

  /**
   * Render professional PDF for invoice.
   */
  static async renderInvoicePdf(invoice: InvoiceRecord): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const seller = invoice.sellerSnapshot || {};
      const buyer = invoice.buyerSnapshot || {};
      const items = Array.isArray(invoice.lineItemsSnapshot) ? invoice.lineItemsSnapshot : [];

      const docTitle = invoice.invoiceType === 'bill_of_supply' ? 'BILL OF SUPPLY' : 'TAX INVOICE';

      // Header
      doc.fontSize(18).text(seller.legalName || 'Universal Commerce', { align: 'left' });
      doc.fontSize(10).text(seller.tradeName ? `Trade Name: ${seller.tradeName}` : '', { align: 'left' });
      doc.text(`GSTIN: ${seller.gstin || 'N/A'}`);
      doc.text(`State Code: ${seller.stateCode || '27'}`);

      doc.moveUp(4);
      doc.fontSize(16).text(docTitle, { align: 'right' });
      doc.fontSize(10).text(`Invoice No: ${invoice.invoiceNumber}`, { align: 'right' });
      doc.text(`Date: ${new Date(invoice.issuedAt).toLocaleDateString('en-IN')}`, { align: 'right' });
      doc.text(`FY: ${invoice.financialYear}`, { align: 'right' });

      doc.moveDown(2);
      doc.strokeColor('#cccccc').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(1);

      // Bill To & Place of Supply
      const buyerY = doc.y;
      doc.fontSize(11).font('Helvetica-Bold').text('Bill To (Buyer):', 40, buyerY);
      doc.fontSize(9).font('Helvetica');
      doc.text(`Email: ${buyer.email || 'N/A'}`);
      if (buyer.gstin) doc.text(`GSTIN: ${buyer.gstin}`);
      doc.text(`Place of Supply: State Code ${buyer.placeOfSupplyState || '27'}`);

      doc.moveDown(1.5);
      const tableTop = doc.y;

      // Table Header
      doc.font('Helvetica-Bold');
      doc.text('Item Description', 40, tableTop);
      doc.text('HSN/SAC', 220, tableTop);
      doc.text('Qty', 290, tableTop, { width: 30, align: 'right' });
      doc.text('Rate', 330, tableTop, { width: 50, align: 'right' });
      doc.text('Taxable', 390, tableTop, { width: 60, align: 'right' });
      doc.text('Tax Rate', 460, tableTop, { width: 40, align: 'right' });
      doc.text('Total', 510, tableTop, { width: 45, align: 'right' });

      doc.strokeColor('#aaaaaa').lineWidth(0.5).moveTo(40, tableTop + 14).lineTo(555, tableTop + 14).stroke();

      // Table Rows
      let currentY = tableTop + 20;
      doc.font('Helvetica');

      for (const it of items) {
        doc.text(it.title || 'Item', 40, currentY, { width: 175 });
        doc.text(it.hsnCode || '9900', 220, currentY);
        doc.text(String(it.quantity || 1), 290, currentY, { width: 30, align: 'right' });
        doc.text(`Rs ${(it.unitPrice / 100).toFixed(2)}`, 330, currentY, { width: 50, align: 'right' });
        doc.text(`Rs ${(it.taxableAmountPaise / 100).toFixed(2)}`, 390, currentY, { width: 60, align: 'right' });
        doc.text(`${(it.taxRateBasisPoints / 100).toFixed(1)}%`, 460, currentY, { width: 40, align: 'right' });
        doc.text(`Rs ${(it.totalPaise / 100).toFixed(2)}`, 510, currentY, { width: 45, align: 'right' });
        currentY += 18;
      }

      doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(40, currentY).lineTo(555, currentY).stroke();
      currentY += 10;

      // Totals & Tax Breakdown
      doc.font('Helvetica-Bold');
      doc.text('Tax Summary & Totals', 300, currentY);
      doc.font('Helvetica');
      currentY += 14;

      doc.text('Taxable Subtotal:', 300, currentY);
      doc.text(`Rs ${(invoice.taxableAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
      currentY += 14;

      if (invoice.cgstAmountPaise > 0) {
        doc.text('CGST:', 300, currentY);
        doc.text(`Rs ${(invoice.cgstAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 14;
      }
      if (invoice.sgstAmountPaise > 0) {
        doc.text('SGST:', 300, currentY);
        doc.text(`Rs ${(invoice.sgstAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 14;
      }
      if (invoice.utgstAmountPaise > 0) {
        doc.text('UTGST:', 300, currentY);
        doc.text(`Rs ${(invoice.utgstAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 14;
      }
      if (invoice.igstAmountPaise > 0) {
        doc.text('IGST:', 300, currentY);
        doc.text(`Rs ${(invoice.igstAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 14;
      }
      if (invoice.cessAmountPaise > 0) {
        doc.text('CESS:', 300, currentY);
        doc.text(`Rs ${(invoice.cessAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 14;
      }

      if (invoice.shippingPaise > 0) {
        doc.text('Shipping:', 300, currentY);
        doc.text(`Rs ${(invoice.shippingPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 14;
      }

      doc.strokeColor('#000000').lineWidth(1).moveTo(300, currentY).lineTo(555, currentY).stroke();
      currentY += 6;

      doc.font('Helvetica-Bold').fontSize(11);
      doc.text('Grand Total:', 300, currentY);
      doc.text(`Rs ${(invoice.totalAmountPaise / 100).toFixed(2)}`, 480, currentY, { align: 'right' });

      // Footer
      doc.fontSize(8).font('Helvetica').text(
        'This is a computer generated invoice and requires no physical signature.',
        40,
        780,
        { align: 'center', width: 515 }
      );

      doc.end();
    });
  }

  /**
   * Render professional PDF for credit note.
   */
  static async renderCreditNotePdf(cn: CreditNoteRecord): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      doc.fontSize(18).text('CREDIT NOTE', { align: 'center' });
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold');
      doc.text(`Credit Note No: ${cn.creditNoteNumber}`);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Date: ${new Date(cn.issuedAt).toLocaleDateString('en-IN')}`);
      doc.text(`Financial Year: ${cn.financialYear}`);
      doc.text(`Reason: ${cn.reason}`);

      doc.moveDown(1.5);
      doc.strokeColor('#cccccc').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(1);

      doc.text('Taxable Refund:', 40);
      doc.text(`Rs ${(cn.taxableAmountPaise / 100).toFixed(2)}`, 300, doc.y - 12);

      if (cn.cgstAmountPaise > 0) {
        doc.text('CGST Refunded:', 40);
        doc.text(`Rs ${(cn.cgstAmountPaise / 100).toFixed(2)}`, 300, doc.y - 12);
      }
      if (cn.sgstAmountPaise > 0) {
        doc.text('SGST Refunded:', 40);
        doc.text(`Rs ${(cn.sgstAmountPaise / 100).toFixed(2)}`, 300, doc.y - 12);
      }
      if (cn.utgstAmountPaise > 0) {
        doc.text('UTGST Refunded:', 40);
        doc.text(`Rs ${(cn.utgstAmountPaise / 100).toFixed(2)}`, 300, doc.y - 12);
      }
      if (cn.igstAmountPaise > 0) {
        doc.text('IGST Refunded:', 40);
        doc.text(`Rs ${(cn.igstAmountPaise / 100).toFixed(2)}`, 300, doc.y - 12);
      }
      if (cn.cessAmountPaise > 0) {
        doc.text('Cess Refunded:', 40);
        doc.text(`Rs ${(cn.cessAmountPaise / 100).toFixed(2)}`, 300, doc.y - 12);
      }

      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('Total Refund Amount:', 40);
      doc.text(`Rs ${(cn.totalAmountPaise / 100).toFixed(2)}`, 300, doc.y - 14);

      doc.fontSize(8).font('Helvetica').text(
        'This is a computer generated document and requires no physical signature.',
        40,
        780,
        { align: 'center', width: 515 }
      );

      doc.end();
    });
  }

  private static mapInvoiceRecord(r: RowDataPacket): InvoiceRecord {
    return {
      id: Number(r.id),
      orderId: Number(r.order_id),
      invoiceNumber: r.invoice_number,
      financialYear: r.financial_year,
      invoiceType: r.invoice_type,
      status: r.status,
      sellerSnapshot: typeof r.seller_snapshot === 'string' ? JSON.parse(r.seller_snapshot) : r.seller_snapshot,
      buyerSnapshot: typeof r.buyer_snapshot === 'string' ? JSON.parse(r.buyer_snapshot) : r.buyer_snapshot,
      lineItemsSnapshot: typeof r.line_items_snapshot === 'string' ? JSON.parse(r.line_items_snapshot) : r.line_items_snapshot,
      taxSummary: typeof r.tax_summary === 'string' ? JSON.parse(r.tax_summary) : r.tax_summary,
      taxableAmountPaise: Number(r.taxable_amount_paise),
      cgstAmountPaise: Number(r.cgst_amount_paise || 0),
      sgstAmountPaise: Number(r.sgst_amount_paise || 0),
      utgstAmountPaise: Number(r.utgst_amount_paise || 0),
      igstAmountPaise: Number(r.igst_amount_paise || 0),
      cessAmountPaise: Number(r.cess_amount_paise || 0),
      totalTaxPaise: Number(r.total_tax_paise),
      shippingPaise: Number(r.shipping_paise || 0),
      shippingTaxPaise: Number(r.shipping_tax_paise || 0),
      totalAmountPaise: Number(r.total_amount_paise),
      issuedAt: new Date(r.issued_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private static mapCreditNoteRecord(r: RowDataPacket): CreditNoteRecord {
    return {
      id: Number(r.id),
      invoiceId: Number(r.invoice_id),
      orderId: Number(r.order_id),
      refundId: r.refund_id ? Number(r.refund_id) : null,
      creditNoteNumber: r.credit_note_number,
      financialYear: r.financial_year,
      reason: r.reason,
      snapshot: typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot,
      taxableAmountPaise: Number(r.taxable_amount_paise),
      cgstAmountPaise: Number(r.cgst_amount_paise || 0),
      sgstAmountPaise: Number(r.sgst_amount_paise || 0),
      utgstAmountPaise: Number(r.utgst_amount_paise || 0),
      igstAmountPaise: Number(r.igst_amount_paise || 0),
      cessAmountPaise: Number(r.cess_amount_paise || 0),
      totalTaxPaise: Number(r.total_tax_paise),
      totalAmountPaise: Number(r.total_amount_paise),
      issuedAt: new Date(r.issued_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
