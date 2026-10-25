import { db } from '../db/index.js';
import { settings, pages, contentBlocks } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface LegalTemplateDefinition {
  slug: string;
  title: string;
  summary: string;
  defaultContent: string;
}

export interface BusinessComplianceDetails {
  businessLegalName: string;
  tradingName: string;
  registeredAddress: string;
  contactEmail: string;
  contactPhone: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  grievanceOfficerName: string;
  grievanceOfficerEmail: string;
  grievanceOfficerPhone: string;
  grievanceOfficerAddress: string;
  grievanceResponseTimeline: string; // e.g., 'Within 24 to 48 hours, resolved within 15 days'
}

export interface CookieConsentLog {
  consentId: string;
  ipAddress: string;
  userAgent?: string;
  categories: {
    necessary: boolean;
    analytics: boolean;
    marketing: boolean;
    preferences: boolean;
  };
  consentedAt: string;
}

export const LEGAL_DRAFT_NOTICE = 'NOTICE: This legal page template is a draft generated for initial setup. It must be reviewed and approved by the business legal counsel before production use. Universal CMS does not provide legal advice and makes no warranties regarding compliance.';

export const INDIA_LEGAL_TEMPLATES: LegalTemplateDefinition[] = [
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    summary: 'Data collection, processing purposes, retention, user rights under the Digital Personal Data Protection Act 2023 (DPDP Act).',
    defaultContent: `<h2>1. Introduction</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>We respect your privacy and are committed to protecting your personal data in accordance with the Digital Personal Data Protection Act, 2023 (DPDP Act) and applicable Indian laws.</p><h2>2. Personal Data We Collect</h2><p>We may collect identity data (name, date of birth), contact data (email, phone, delivery address), transaction data, and technical browsing data.</p><h2>3. Purpose and Legal Basis</h2><p>Data is processed solely for order fulfillment, account administration, regulatory compliance, and with your explicit consent.</p><h2>4. Data Retention and Security</h2><p>Your personal data is retained only as long as necessary for the fulfillment of purposes or legal compliance, secured with industry-standard encryption.</p><h2>5. Your Rights as a Data Principal</h2><p>You have the right to access, correct, update, and request erasure of your personal data, as well as the right to withdraw consent.</p><h2>6. Grievance Redressal</h2><p>For any privacy grievances, contact our designated Grievance Officer detailed on our Grievance Redressal page.</p>`,
  },
  {
    slug: 'terms-and-conditions',
    title: 'Terms and Conditions',
    summary: 'Terms of service, website usage agreement, governing law, and dispute jurisdiction.',
    defaultContent: `<h2>1. Agreement to Terms</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>By accessing or purchasing from our platform, you agree to be bound by these Terms and Conditions governed by the laws of India.</p><h2>2. Eligibility and Account Security</h2><p>You must be at least 18 years of age or possess legal parental consent. You are responsible for maintaining the confidentiality of your account credentials.</p><h2>3. Pricing and GST</h2><p>All prices displayed are in Indian Rupees (INR) and inclusive of applicable Goods and Services Tax (GST) unless explicitly stated otherwise.</p><h2>4. Intellectual Property</h2><p>All trademarks, graphics, and content on this website are the intellectual property of the business.</p><h2>5. Dispute Resolution and Jurisdiction</h2><p>Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts located in our registered city of operation in India.</p>`,
  },
  {
    slug: 'refund-and-cancellation-policy',
    title: 'Refund and Cancellation Policy',
    summary: 'Cancellation timelines, eligibility for return, refund processing channels, and Razorpay timelines.',
    defaultContent: `<h2>1. Order Cancellation</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>Orders can be cancelled before they are processed or handed over to our shipping partner. Once dispatched, cancellations are subject to our return process.</p><h2>2. Returns and Replacements</h2><p>Products eligible for return must be reported within 7 days of delivery in unused, original packaging with invoice attached.</p><h2>3. Refund Processing</h2><p>Approved refunds are processed to the original payment source (via Razorpay or bank transfer) within 5 to 7 business days.</p>`,
  },
  {
    slug: 'shipping-and-delivery-policy',
    title: 'Shipping and Delivery Policy',
    summary: 'Shipping serviceability across Indian pincodes, delivery timelines, tracking, and COD rules.',
    defaultContent: `<h2>1. Serviceable Locations</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>We ship across serviceable pincodes in India through verified courier partners.</p><h2>2. Dispatch and Delivery Timelines</h2><p>Orders are dispatched within 24 to 48 hours. Standard delivery timeline ranges from 3 to 7 business days depending on delivery location.</p><h2>3. Tracking</h2><p>Tracking numbers (AWB) are sent via email and SMS upon shipment handover.</p>`,
  },
  {
    slug: 'contact-us',
    title: 'Contact Us',
    summary: 'Mandatory business disclosure: legal entity name, address, phone, email, and GSTIN.',
    defaultContent: `<h2>Registered Business Information</h2><p>${LEGAL_DRAFT_NOTICE}</p><p><strong>Legal Name:</strong> {{ business.legal_name }}</p><p><strong>Registered Address:</strong> {{ business.address }}</p><p><strong>Email:</strong> {{ business.contact_email }}</p><p><strong>Phone:</strong> {{ business.contact_phone }}</p><p><strong>GSTIN:</strong> {{ business.gstin }}</p>`,
  },
  {
    slug: 'grievance-redressal',
    title: 'Grievance Redressal',
    summary: 'Statutory compliance naming the Grievance Officer with complete contact coordinates and resolution timeline.',
    defaultContent: `<h2>Grievance Redressal Mechanism</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>In accordance with the Information Technology Act, 2000, and the Consumer Protection (E-Commerce) Rules, 2020, our appointed Grievance Officer coordinates are:</p><p><strong>Name:</strong> {{ grievance.officer_name }}</p><p><strong>Designation:</strong> Grievance Officer</p><p><strong>Email:</strong> {{ grievance.officer_email }}</p><p><strong>Phone:</strong> {{ grievance.officer_phone }}</p><p><strong>Postal Address:</strong> {{ grievance.officer_address }}</p><p><strong>Response Timeline:</strong> Acknowledgement within 48 hours; resolution within 15 days of grievance receipt.</p>`,
  },
  {
    slug: 'cookie-policy',
    title: 'Cookie Policy',
    summary: 'Types of cookies used, consent controls, and how to manage cookie preferences.',
    defaultContent: `<h2>Cookie Policy and Consent</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>We use essential cookies to operate secure user sessions and optional analytics and marketing cookies with your explicit consent.</p><p>You can adjust or revoke your cookie choices at any time using our cookie settings banner.</p>`,
  },
  {
    slug: 'disclaimer',
    title: 'Disclaimer',
    summary: 'General website information disclaimer and limitation of liability.',
    defaultContent: `<h2>General Disclaimer</h2><p>${LEGAL_DRAFT_NOTICE}</p><p>Information provided on this site is for general informational purposes. All warranties, express or implied, are disclaimed to the maximum extent permitted by Indian law.</p>`,
  },
];

const DEFAULT_BUSINESS_DETAILS: BusinessComplianceDetails = {
  businessLegalName: 'Acme Technologies Private Limited',
  tradingName: 'Acme Commerce',
  registeredAddress: 'Plot 42, Tech Park, Bangalore, Karnataka - 560001, India',
  contactEmail: 'support@example.com',
  contactPhone: '+91 80 1234 5678',
  gstin: '29ABCDE1234F1Z5',
  grievanceOfficerName: 'Rohan Sharma',
  grievanceOfficerEmail: 'grievance@example.com',
  grievanceOfficerPhone: '+91 80 1234 5679',
  grievanceOfficerAddress: 'Plot 42, Tech Park, Bangalore, Karnataka - 560001, India',
  grievanceResponseTimeline: 'Acknowledgement within 48 hours; resolution within 15 working days',
};

let cachedBusinessDetails = { ...DEFAULT_BUSINESS_DETAILS };
const inMemoryConsentLogs: CookieConsentLog[] = [];

export class ComplianceService {
  static getDraftNotice(): string {
    return LEGAL_DRAFT_NOTICE;
  }

  static getLegalTemplates(): LegalTemplateDefinition[] {
    return INDIA_LEGAL_TEMPLATES;
  }

  static async seedLegalPages(): Promise<number> {
    let count = 0;
    for (const tpl of INDIA_LEGAL_TEMPLATES) {
      try {
        const rows = await db.select().from(pages).where(eq(pages.slug, tpl.slug)).limit(1);
        if (rows.length === 0) {
          const insertRes = await db.insert(pages).values({
            title: tpl.title,
            slug: tpl.slug,
            status: 'draft',
            version: 1,
          });
          const insertId = (insertRes as unknown as [{ insertId: number }])[0]?.insertId;
          if (insertId) {
            await db.insert(contentBlocks).values({
              pageId: Number(insertId),
              blockType: 'rich_text',
              data: JSON.stringify({ html: tpl.defaultContent }),
              sortOrder: 1,
              isActive: true,
            });
          }
          count++;
        }
      } catch {
        // Fallback
      }
    }
    return count;
  }

  static async getBusinessDetails(): Promise<BusinessComplianceDetails> {
    try {
      const rows = await db.select().from(settings).where(eq(settings.key, 'compliance_business')).limit(1);
      if (rows.length > 0 && rows[0].value) {
        const stored = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
        return { ...DEFAULT_BUSINESS_DETAILS, ...stored };
      }
    } catch {
      // Fallback
    }
    return cachedBusinessDetails;
  }

  static async updateBusinessDetails(updates: Partial<BusinessComplianceDetails>): Promise<BusinessComplianceDetails> {
    cachedBusinessDetails = { ...cachedBusinessDetails, ...updates };

    try {
      const existing = await db.select().from(settings).where(eq(settings.key, 'compliance_business')).limit(1);
      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(cachedBusinessDetails), updatedAt: new Date() })
          .where(eq(settings.key, 'compliance_business'));
      } else {
        await db.insert(settings).values({
          key: 'compliance_business',
          value: JSON.stringify(cachedBusinessDetails),
          group: 'compliance',
          isPublic: true,
        });
      }
    } catch {
      // Fallback
    }

    return cachedBusinessDetails;
  }

  static async recordConsent(data: {
    consentId: string;
    ipAddress: string;
    userAgent?: string;
    categories: { necessary: boolean; analytics: boolean; marketing: boolean; preferences: boolean };
  }): Promise<{ success: boolean; consentId: string }> {
    const entry: CookieConsentLog = {
      consentId: data.consentId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      categories: data.categories,
      consentedAt: new Date().toISOString(),
    };

    inMemoryConsentLogs.unshift(entry);

    try {
      await db.insert(settings).values({
        key: `consent:${data.consentId}`,
        value: JSON.stringify(entry),
        group: 'consent_logs',
        isPublic: false,
      });
    } catch {
      // Fallback
    }

    return { success: true, consentId: data.consentId };
  }

  static async listConsentLogs(params: { page?: number; perPage?: number }): Promise<{
    data: CookieConsentLog[];
    meta: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 20));

    return {
      data: inMemoryConsentLogs.slice((page - 1) * perPage, page * perPage),
      meta: {
        page,
        per_page: perPage,
        total: inMemoryConsentLogs.length,
        total_pages: Math.ceil(inMemoryConsentLogs.length / perPage) || 1,
      },
    };
  }
}
