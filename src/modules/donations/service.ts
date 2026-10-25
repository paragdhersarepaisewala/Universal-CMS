import { db } from '../../db/index.js';
import { donationCampaigns, donations, jobs } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

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

export class DonationService {
  static async listCampaigns(onlyActive: boolean = true): Promise<(CampaignRecord & { progressPercentage: number })[]> {
    let list = [...inMemoryCampaigns];
    try {
      const rows = await db.select().from(donationCampaigns);
      if (rows.length > 0) {
        list = rows.map(r => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
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

      // Enqueue 80G receipt email
      await db.insert(jobs).values({
        queue: 'email',
        jobType: 'donation_receipt',
        payload: JSON.stringify({
          recipient: donation.donorEmail,
          receiptNumber: donation.receiptNumber,
          amount: (donation.amount / 100).toFixed(2),
          pan: donation.donorPan || 'N/A',
        }),
        status: 'pending',
      });
    } catch {
      // Fallback
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
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch {
      // Fallback
    }

    return campaignId ? inMemoryDonations.filter(d => d.campaignId === campaignId) : inMemoryDonations;
  }
}
