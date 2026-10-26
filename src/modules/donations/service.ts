import { db } from '../../db/index.js';
import { pool } from '../../db/pool.js';
import { donationCampaigns, donations, donationSubscriptions, donationSubscriptionCharges } from '../../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { randomBytes, createHmac } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface CampaignRecord {
  id: number;
  title: string;
  slug: string;
  goalAmount: number; // in paise
  raisedAmount: number; // in paise
  description?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DonationRecord {
  id: number;
  campaignId: number;
  donorName: string;
  donorEmail: string;
  donorPan?: string | null;
  amount: number;
  paymentId?: string | null;
  isAnonymous: boolean;
  status: 'pending' | 'completed' | 'failed';
  receiptNumber?: string | null;
  createdAt: string;
}

export interface SubscriptionRecord {
  id: number;
  campaignId: number;
  campaignTitle?: string;
  donorName: string;
  donorEmail: string;
  donorPan?: string | null;
  amount: number; // in paise
  frequency: 'monthly' | 'quarterly' | 'yearly';
  subscriptionId: string;
  planId?: string | null;
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  isAnonymous: boolean;
  startedAt: string;
  nextChargeAt?: string | null;
  cancelledAt?: string | null;
  totalCharges: number;
  totalRaised: number;
  createdAt: string;
  updatedAt: string;
}

const inMemoryCampaigns: CampaignRecord[] = [
  {
    id: 1,
    title: 'Rural Education Initiative 2026',
    slug: 'rural-education-initiative',
    goalAmount: 10000000, // Rs 1,00,000.00
    raisedAmount: 3500000, // Rs 35,000.00
    description: 'Funding digital classroom kits and textbooks for primary schools in rural districts.',
    isActive: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const inMemoryDonations: DonationRecord[] = [];
const inMemorySubscriptions: SubscriptionRecord[] = [];
const inMemoryCharges: Array<{
  id: number;
  subscriptionId: number;
  donationId: number | null;
  gatewayPaymentId: string;
  amount: number;
  status: string;
  createdAt: string;
}> = [];

export class DonationService {
  static async listCampaigns(onlyActive: boolean = true): Promise<(CampaignRecord & { progressPercentage: number })[]> {
    let list = [...inMemoryCampaigns];
    try {
      const rows = await db.select().from(donationCampaigns);
      if (rows.length > 0) {
        list = rows.map(r => ({
          ...r,
          createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt.toISOString ? r.updatedAt.toISOString() : String(r.updatedAt),
        }));
      }
    } catch {
      // Fallback
    }

    if (onlyActive) {
      list = list.filter(c => c.isActive);
    }

    return list.map(c => ({
      ...c,
      progressPercentage: c.goalAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.goalAmount) * 100)) : 0,
    }));
  }

  static async getCampaignBySlug(slug: string): Promise<(CampaignRecord & { progressPercentage: number }) | null> {
    const list = await this.listCampaigns(false);
    return list.find(c => c.slug === slug) || null;
  }

  static async createCampaign(data: {
    title: string;
    slug: string;
    goalAmount: number;
    description?: string;
  }): Promise<CampaignRecord> {
    const camp: CampaignRecord = {
      id: inMemoryCampaigns.length + 1,
      title: data.title,
      slug: data.slug,
      goalAmount: data.goalAmount,
      raisedAmount: 0,
      description: data.description || null,
      isActive: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const [res] = await db.insert(donationCampaigns).values({
        title: camp.title,
        slug: camp.slug,
        goalAmount: camp.goalAmount,
        raisedAmount: 0,
        description: camp.description,
        isActive: true,
        version: 1,
      });
      camp.id = Number(res.insertId);
    } catch {
      // Fallback
    }

    inMemoryCampaigns.push(camp);
    return camp;
  }

  static async recordDonation(data: {
    campaignSlug: string;
    donorName: string;
    donorEmail: string;
    donorPan?: string;
    amount: number; // in paise
    isAnonymous?: boolean;
    paymentId?: string;
  }): Promise<DonationRecord> {
    if (data.amount < 10000) {
      throw new Error('Minimum donation amount is Rs. 100 (10000 paise)');
    }

    const campaign = await this.getCampaignBySlug(data.campaignSlug);
    if (!campaign || !campaign.isActive) {
      throw new Error('Campaign not found or inactive');
    }

    const receiptNumber = `80G-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const donation: DonationRecord = {
      id: inMemoryDonations.length + 1,
      campaignId: campaign.id,
      donorName: data.isAnonymous ? 'Anonymous Donor' : data.donorName,
      donorEmail: data.donorEmail,
      donorPan: data.donorPan || null,
      amount: data.amount,
      paymentId: data.paymentId || `pay_${randomBytes(8).toString('hex')}`,
      isAnonymous: data.isAnonymous || false,
      status: 'completed',
      receiptNumber,
      createdAt: new Date().toISOString(),
    };

    // Increment raised amount
    campaign.raisedAmount += data.amount;

    try {
      const [res] = await db.insert(donations).values({
        campaignId: campaign.id,
        donorName: donation.donorName,
        donorEmail: donation.donorEmail,
        donorPan: donation.donorPan,
        amount: donation.amount,
        paymentId: donation.paymentId,
        isAnonymous: donation.isAnonymous,
        status: donation.status,
        receiptNumber: donation.receiptNumber,
      });
      donation.id = Number(res.insertId);

      await db.update(donationCampaigns).set({
        raisedAmount: campaign.raisedAmount,
      }).where(eq(donationCampaigns.id, campaign.id));
    } catch {
      // Fallback
    }

    // Automated thank-you transactional email dispatch via EmailService
    try {
      const { EmailService } = await import('../../email/service.js');
      await EmailService.enqueueEmail({
        to: donation.donorEmail,
        templateKey: 'donation.receipt',
        context: {
          'donor.name': donation.donorName,
          'donation.amount': (donation.amount / 100).toFixed(2),
          'donation.receipt_number': donation.receiptNumber || 'N/A',
          'donation.tax_exemption_info': donation.donorPan ? `PAN: ${donation.donorPan}` : '80G Tax Exemption Eligible',
          'campaign.title': campaign.title,
        },
      });
    } catch {
      // Non-blocking
    }

    inMemoryDonations.push(donation);
    return donation;
  }

  static async listDonations(campaignId?: number): Promise<DonationRecord[]> {
    try {
      const query = campaignId
        ? db.select().from(donations).where(eq(donations.campaignId, campaignId)).orderBy(desc(donations.createdAt))
        : db.select().from(donations).orderBy(desc(donations.createdAt));
      const rows = await query;
      if (rows.length > 0) {
        return rows.map(r => ({
          ...r,
          status: r.status as DonationRecord['status'],
          createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
        }));
      }
    } catch {
      // Fallback
    }

    return campaignId ? inMemoryDonations.filter(d => d.campaignId === campaignId) : inMemoryDonations;
  }

  static async listCustomerDonations(donorEmail: string): Promise<DonationRecord[]> {
    try {
      const rows = await db
        .select()
        .from(donations)
        .where(eq(donations.donorEmail, donorEmail.toLowerCase()))
        .orderBy(desc(donations.createdAt));
      if (rows.length > 0) {
        return rows.map(r => ({
          ...r,
          status: r.status as DonationRecord['status'],
          createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
        }));
      }
    } catch {
      // Fallback
    }

    return inMemoryDonations.filter(d => d.donorEmail.toLowerCase() === donorEmail.toLowerCase());
  }

  // --- RECURRING DONATIONS VIA RAZORPAY SUBSCRIPTIONS ---

  static calculateNextChargeDate(frequency: 'monthly' | 'quarterly' | 'yearly', fromDate: Date = new Date()): Date {
    const next = new Date(fromDate);
    if (frequency === 'monthly') {
      next.setMonth(next.getMonth() + 1);
    } else if (frequency === 'quarterly') {
      next.setMonth(next.getMonth() + 3);
    } else if (frequency === 'yearly') {
      next.setFullYear(next.getFullYear() + 1);
    }
    return next;
  }

  static async createSubscription(data: {
    campaignSlug: string;
    donorName: string;
    donorEmail: string;
    donorPan?: string;
    amount: number; // in paise
    frequency?: 'monthly' | 'quarterly' | 'yearly';
    isAnonymous?: boolean;
    subscriptionId?: string;
    planId?: string;
    initialPaymentId?: string;
  }): Promise<SubscriptionRecord> {
    if (data.amount < 10000) {
      throw new Error('Minimum recurring donation amount is Rs. 100 (10000 paise)');
    }

    const campaign = await this.getCampaignBySlug(data.campaignSlug);
    if (!campaign || !campaign.isActive) {
      throw new Error('Campaign not found or inactive');
    }

    const frequency = data.frequency || 'monthly';
    const subId = data.subscriptionId || `sub_${randomBytes(8).toString('hex')}`;
    const nextCharge = this.calculateNextChargeDate(frequency);

    const subRecord: SubscriptionRecord = {
      id: inMemorySubscriptions.length + 1,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      donorName: data.isAnonymous ? 'Anonymous Donor' : data.donorName,
      donorEmail: data.donorEmail,
      donorPan: data.donorPan || null,
      amount: data.amount,
      frequency,
      subscriptionId: subId,
      planId: data.planId || `plan_${frequency}_${data.amount}`,
      status: 'active',
      isAnonymous: data.isAnonymous || false,
      startedAt: new Date().toISOString(),
      nextChargeAt: nextCharge.toISOString(),
      cancelledAt: null,
      totalCharges: 0,
      totalRaised: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const [res] = await db.insert(donationSubscriptions).values({
        campaignId: campaign.id,
        donorName: subRecord.donorName,
        donorEmail: subRecord.donorEmail,
        donorPan: subRecord.donorPan,
        amount: subRecord.amount,
        frequency: subRecord.frequency,
        subscriptionId: subRecord.subscriptionId,
        planId: subRecord.planId,
        status: subRecord.status,
        isAnonymous: subRecord.isAnonymous,
        nextChargeAt: nextCharge,
        totalCharges: 0,
        totalRaised: 0,
      });
      subRecord.id = Number(res.insertId);
    } catch {
      // In-memory fallback
    }

    inMemorySubscriptions.push(subRecord);

    // If an initial payment ID was supplied, record first charge immediately
    if (data.initialPaymentId) {
      await this.handleSubscriptionWebhook({
        event: 'subscription.charged',
        payload: {
          subscription: { entity: { id: subId } },
          payment: { entity: { id: data.initialPaymentId, amount: data.amount } },
        },
      });
    }

    return subRecord;
  }

  static async handleSubscriptionWebhook(
    payload: any,
    signature?: string
  ): Promise<{ processed: boolean; duplicate?: boolean; status?: string; donationId?: number; receiptNumber?: string }> {
    // 1. Signature validation if secret configured
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
    if (secret && signature) {
      const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expectedSig = createHmac('sha256', secret).update(bodyString).digest('hex');
      if (expectedSig !== signature) {
        throw new Error('Invalid webhook signature');
      }
    }

    const event = payload.event;
    const subEntity = payload.payload?.subscription?.entity || payload.subscription;
    const paymentEntity = payload.payload?.payment?.entity || payload.payment;
    const subId = subEntity?.id || payload.subscription_id;

    if (!subId) {
      return { processed: false };
    }

    // 2. Fetch subscription
    let subscription: SubscriptionRecord | null = null;
    try {
      const rows = await db.select().from(donationSubscriptions).where(eq(donationSubscriptions.subscriptionId, subId));
      if (rows.length > 0) {
        const r = rows[0];
        subscription = {
          ...r,
          frequency: r.frequency as SubscriptionRecord['frequency'],
          status: r.status as SubscriptionRecord['status'],
          startedAt: r.startedAt.toISOString ? r.startedAt.toISOString() : String(r.startedAt),
          nextChargeAt: r.nextChargeAt ? (r.nextChargeAt.toISOString ? r.nextChargeAt.toISOString() : String(r.nextChargeAt)) : null,
          cancelledAt: r.cancelledAt ? (r.cancelledAt.toISOString ? r.cancelledAt.toISOString() : String(r.cancelledAt)) : null,
          createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt.toISOString ? r.updatedAt.toISOString() : String(r.updatedAt),
        };
      }
    } catch {
      // In-memory fallback
    }

    if (!subscription) {
      subscription = inMemorySubscriptions.find(s => s.subscriptionId === subId) || null;
    }

    if (!subscription) {
      throw new Error(`Subscription with ID ${subId} not found`);
    }

    // 3. Handle Subscription Events
    if (event === 'subscription.charged') {
      const payId = paymentEntity?.id || payload.payment_id || `pay_sub_${randomBytes(6).toString('hex')}`;
      const chargedAmount = Number(paymentEntity?.amount || payload.amount || subscription.amount);

      // Idempotency: Check if gateway_payment_id already exists
      let alreadyCharged = false;
      try {
        const rows = await db
          .select()
          .from(donationSubscriptionCharges)
          .where(eq(donationSubscriptionCharges.gatewayPaymentId, payId));
        alreadyCharged = rows.length > 0;
      } catch {
        alreadyCharged = inMemoryCharges.some(c => c.gatewayPaymentId === payId);
      }

      if (alreadyCharged) {
        return { processed: false, duplicate: true };
      }

      // Record successful donation
      const receiptNumber = `80G-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      let donationId = inMemoryDonations.length + 1;

      try {
        const [donRes] = await db.insert(donations).values({
          campaignId: subscription.campaignId,
          donorName: subscription.donorName,
          donorEmail: subscription.donorEmail,
          donorPan: subscription.donorPan,
          amount: chargedAmount,
          paymentId: payId,
          isAnonymous: subscription.isAnonymous,
          status: 'completed',
          receiptNumber,
        });
        donationId = Number(donRes.insertId);

        // Record charge
        await db.insert(donationSubscriptionCharges).values({
          subscriptionId: subscription.id,
          donationId,
          gatewayPaymentId: payId,
          amount: chargedAmount,
          status: 'captured',
        });

        // Update campaign raised total
        await pool.query(
          'UPDATE donation_campaigns SET raised_amount = raised_amount + ? WHERE id = ?',
          [chargedAmount, subscription.campaignId]
        );

        // Update subscription counters
        const nextCharge = this.calculateNextChargeDate(subscription.frequency);
        await db
          .update(donationSubscriptions)
          .set({
            totalCharges: subscription.totalCharges + 1,
            totalRaised: subscription.totalRaised + chargedAmount,
            nextChargeAt: nextCharge,
            updatedAt: new Date(),
          })
          .where(eq(donationSubscriptions.id, subscription.id));
      } catch {
        // In-memory fallback
        inMemoryCharges.push({
          id: inMemoryCharges.length + 1,
          subscriptionId: subscription.id,
          donationId,
          gatewayPaymentId: payId,
          amount: chargedAmount,
          status: 'captured',
          createdAt: new Date().toISOString(),
        });
      }

      subscription.totalCharges += 1;
      subscription.totalRaised += chargedAmount;

      inMemoryDonations.push({
        id: donationId,
        campaignId: subscription.campaignId,
        donorName: subscription.donorName,
        donorEmail: subscription.donorEmail,
        donorPan: subscription.donorPan,
        amount: chargedAmount,
        paymentId: payId,
        isAnonymous: subscription.isAnonymous,
        status: 'completed',
        receiptNumber,
        createdAt: new Date().toISOString(),
      });

      // Automated thank-you & 80G receipt email dispatch
      try {
        const { EmailService } = await import('../../email/service.js');
        await EmailService.enqueueEmail({
          to: subscription.donorEmail,
          templateKey: 'donation.receipt',
          context: {
            'donor.name': subscription.donorName,
            'donation.amount': (chargedAmount / 100).toFixed(2),
            'donation.receipt_number': receiptNumber,
            'donation.tax_exemption_info': subscription.donorPan ? `PAN: ${subscription.donorPan}` : '80G Tax Exemption Eligible',
            'campaign.title': subscription.campaignTitle || 'Fundraising Campaign',
          },
        });
      } catch {
        // Non-blocking
      }

      return { processed: true, donationId, receiptNumber };
    }

    if (event === 'subscription.cancelled') {
      try {
        await db
          .update(donationSubscriptions)
          .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(donationSubscriptions.id, subscription.id));
      } catch {
        // In-memory fallback
      }
      subscription.status = 'cancelled';
      subscription.cancelledAt = new Date().toISOString();
      return { processed: true, status: 'cancelled' };
    }

    if (event === 'subscription.paused') {
      try {
        await db
          .update(donationSubscriptions)
          .set({ status: 'paused', updatedAt: new Date() })
          .where(eq(donationSubscriptions.id, subscription.id));
      } catch {
        // In-memory fallback
      }
      subscription.status = 'paused';
      return { processed: true, status: 'paused' };
    }

    if (event === 'subscription.resumed') {
      try {
        await db
          .update(donationSubscriptions)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(donationSubscriptions.id, subscription.id));
      } catch {
        // In-memory fallback
      }
      subscription.status = 'active';
      return { processed: true, status: 'active' };
    }

    return { processed: true, status: 'ignored' };
  }

  static async listSubscriptions(filter?: {
    donorEmail?: string;
    campaignId?: number;
    status?: string;
  }): Promise<SubscriptionRecord[]> {
    try {
      let query = db.select().from(donationSubscriptions);
      const conditions: any[] = [];
      if (filter?.donorEmail) {
        conditions.push(eq(donationSubscriptions.donorEmail, filter.donorEmail.toLowerCase()));
      }
      if (filter?.campaignId) {
        conditions.push(eq(donationSubscriptions.campaignId, filter.campaignId));
      }
      if (filter?.status) {
        conditions.push(eq(donationSubscriptions.status, filter.status));
      }

      const rows = conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(desc(donationSubscriptions.createdAt))
        : await query.orderBy(desc(donationSubscriptions.createdAt));

      if (rows.length > 0) {
        return rows.map(r => ({
          ...r,
          frequency: r.frequency as SubscriptionRecord['frequency'],
          status: r.status as SubscriptionRecord['status'],
          startedAt: r.startedAt.toISOString ? r.startedAt.toISOString() : String(r.startedAt),
          nextChargeAt: r.nextChargeAt ? (r.nextChargeAt.toISOString ? r.nextChargeAt.toISOString() : String(r.nextChargeAt)) : null,
          cancelledAt: r.cancelledAt ? (r.cancelledAt.toISOString ? r.cancelledAt.toISOString() : String(r.cancelledAt)) : null,
          createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt.toISOString ? r.updatedAt.toISOString() : String(r.updatedAt),
        }));
      }
    } catch {
      // In-memory fallback
    }

    let filtered = [...inMemorySubscriptions];
    if (filter?.donorEmail) {
      filtered = filtered.filter(s => s.donorEmail.toLowerCase() === filter.donorEmail?.toLowerCase());
    }
    if (filter?.campaignId) {
      filtered = filtered.filter(s => s.campaignId === filter.campaignId);
    }
    if (filter?.status) {
      filtered = filtered.filter(s => s.status === filter.status);
    }
    return filtered;
  }

  static async getSubscriptionById(id: number): Promise<SubscriptionRecord | null> {
    try {
      const rows = await db.select().from(donationSubscriptions).where(eq(donationSubscriptions.id, id));
      if (rows.length > 0) {
        const r = rows[0];
        return {
          ...r,
          frequency: r.frequency as SubscriptionRecord['frequency'],
          status: r.status as SubscriptionRecord['status'],
          startedAt: r.startedAt.toISOString ? r.startedAt.toISOString() : String(r.startedAt),
          nextChargeAt: r.nextChargeAt ? (r.nextChargeAt.toISOString ? r.nextChargeAt.toISOString() : String(r.nextChargeAt)) : null,
          cancelledAt: r.cancelledAt ? (r.cancelledAt.toISOString ? r.cancelledAt.toISOString() : String(r.cancelledAt)) : null,
          createdAt: r.createdAt.toISOString ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt.toISOString ? r.updatedAt.toISOString() : String(r.updatedAt),
        };
      }
    } catch {
      // In-memory fallback
    }
    return inMemorySubscriptions.find(s => s.id === id) || null;
  }

  static async cancelSubscription(id: number, actorEmail?: string, isAdmin: boolean = false): Promise<SubscriptionRecord> {
    const sub = await this.getSubscriptionById(id);
    if (!sub) {
      const err = new Error('Subscription not found');
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    if (!isAdmin && actorEmail && sub.donorEmail.toLowerCase() !== actorEmail.toLowerCase()) {
      const err = new Error('Unauthorized to cancel this subscription');
      (err as any).code = 'FORBIDDEN';
      throw err;
    }

    if (sub.status === 'cancelled') {
      return sub;
    }

    const cancelledAt = new Date();
    try {
      await db
        .update(donationSubscriptions)
        .set({ status: 'cancelled', cancelledAt, updatedAt: new Date() })
        .where(eq(donationSubscriptions.id, id));
    } catch {
      // In-memory fallback
    }

    sub.status = 'cancelled';
    sub.cancelledAt = cancelledAt.toISOString();

    const memSub = inMemorySubscriptions.find(s => s.id === id);
    if (memSub) {
      memSub.status = 'cancelled';
      memSub.cancelledAt = sub.cancelledAt;
    }

    return sub;
  }
}
