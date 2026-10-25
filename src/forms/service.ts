import { db } from '../db/index.js';
import { forms, formSubmissions, jobs } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export interface FormFieldDefinition {
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea' | 'number' | 'select' | 'checkbox';
  required?: boolean;
  options?: string[]; // for select
}

export interface FormRecord {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  fields: FormFieldDefinition[];
  submitButtonText: string;
  successMessage?: string | null;
  notificationEmail?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionRecord {
  id: number;
  formId: number;
  data: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  isRead: boolean;
  createdAt: string;
}

// In-memory fallback
const inMemoryForms: FormRecord[] = [
  {
    id: 1,
    name: 'Contact Us',
    slug: 'contact',
    description: 'General inquiries and contact form',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true },
      { name: 'email', label: 'Email Address', type: 'email', required: true },
      { name: 'subject', label: 'Subject', type: 'text', required: false },
      { name: 'message', label: 'Your Message', type: 'textarea', required: true },
    ],
    submitButtonText: 'Send Message',
    successMessage: 'Thank you! We have received your message and will respond shortly.',
    notificationEmail: 'admin@example.com',
    isActive: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const inMemorySubmissions: SubmissionRecord[] = [];

export class FormsService {
  static async listForms(): Promise<FormRecord[]> {
    try {
      const rows = await db.select().from(forms);
      if (rows.length > 0) {
        return rows.map(r => ({
          ...r,
          fields: typeof r.fields === 'string' ? JSON.parse(r.fields) : (r.fields as FormFieldDefinition[]),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
      }
    } catch {
      // Fallback
    }
    return inMemoryForms;
  }

  static async getFormBySlug(slug: string): Promise<FormRecord | null> {
    try {
      const rows = await db.select().from(forms).where(eq(forms.slug, slug));
      if (rows[0]) {
        return {
          ...rows[0],
          fields: typeof rows[0].fields === 'string' ? JSON.parse(rows[0].fields) : (rows[0].fields as FormFieldDefinition[]),
          createdAt: rows[0].createdAt.toISOString(),
          updatedAt: rows[0].updatedAt.toISOString(),
        };
      }
    } catch {
      // Fallback
    }
    return inMemoryForms.find(f => f.slug === slug) || null;
  }

  static async getFormById(id: number): Promise<FormRecord | null> {
    try {
      const rows = await db.select().from(forms).where(eq(forms.id, id));
      if (rows[0]) {
        return {
          ...rows[0],
          fields: typeof rows[0].fields === 'string' ? JSON.parse(rows[0].fields) : (rows[0].fields as FormFieldDefinition[]),
          createdAt: rows[0].createdAt.toISOString(),
          updatedAt: rows[0].updatedAt.toISOString(),
        };
      }
    } catch {
      // Fallback
    }
    return inMemoryForms.find(f => f.id === id) || null;
  }

  static async createForm(data: {
    name: string;
    slug: string;
    description?: string;
    fields: FormFieldDefinition[];
    submitButtonText?: string;
    successMessage?: string;
    notificationEmail?: string;
  }): Promise<FormRecord> {
    const existing = await this.getFormBySlug(data.slug);
    if (existing) {
      throw new Error(`Form with slug '${data.slug}' already exists`);
    }

    const newRecord: FormRecord = {
      id: inMemoryForms.length + 1,
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      fields: data.fields,
      submitButtonText: data.submitButtonText || 'Submit',
      successMessage: data.successMessage || 'Form submitted successfully',
      notificationEmail: data.notificationEmail || null,
      isActive: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const [insertRes] = await db.insert(forms).values({
        name: newRecord.name,
        slug: newRecord.slug,
        description: newRecord.description,
        fields: JSON.stringify(newRecord.fields),
        submitButtonText: newRecord.submitButtonText,
        successMessage: newRecord.successMessage,
        notificationEmail: newRecord.notificationEmail,
        isActive: newRecord.isActive,
        version: 1,
      });
      newRecord.id = Number(insertRes.insertId);
    } catch {
      // Fallback
    }

    inMemoryForms.push(newRecord);
    return newRecord;
  }

  static async submitForm(
    slug: string,
    submissionData: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ submissionId: number; message: string }> {
    const form = await this.getFormBySlug(slug);
    if (!form || !form.isActive) {
      throw new Error('Form not found or inactive');
    }

    // Honeypot spam check: if _hp has a value, silently reject or mock success
    if (submissionData._hp) {
      return { submissionId: 0, message: form.successMessage || 'Submission received' };
    }

    // Validate required fields
    for (const field of form.fields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || String(val).trim() === '') {
          throw new Error(`Required field '${field.label || field.name}' is missing`);
        }
      }
    }

    const subId = inMemorySubmissions.length + 1;
    const subRecord: SubmissionRecord = {
      id: subId,
      formId: form.id,
      data: submissionData,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    try {
      const [insertRes] = await db.insert(formSubmissions).values({
        formId: form.id,
        data: JSON.stringify(submissionData),
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        isRead: false,
      });
      subRecord.id = Number(insertRes.insertId);

      // Enqueue email notification job if configured
      if (form.notificationEmail) {
        await db.insert(jobs).values({
          queue: 'email',
          jobType: 'form_submission_notification',
          payload: JSON.stringify({
            formName: form.name,
            recipient: form.notificationEmail,
            submission: submissionData,
          }),
          status: 'pending',
        });
      }
    } catch {
      // Fallback
    }

    inMemorySubmissions.push(subRecord);
    return { submissionId: subRecord.id, message: form.successMessage || 'Form submitted successfully' };
  }

  static async listSubmissions(formId?: number): Promise<SubmissionRecord[]> {
    try {
      const query = formId
        ? db.select().from(formSubmissions).where(eq(formSubmissions.formId, formId)).orderBy(desc(formSubmissions.createdAt))
        : db.select().from(formSubmissions).orderBy(desc(formSubmissions.createdAt));
      const rows = await query;
      if (rows.length > 0) {
        return rows.map(r => ({
          ...r,
          data: typeof r.data === 'string' ? JSON.parse(r.data) : (r.data as Record<string, unknown>),
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch {
      // Fallback
    }

    return formId ? inMemorySubmissions.filter(s => s.formId === formId) : inMemorySubmissions;
  }

  static async markSubmissionRead(id: number): Promise<boolean> {
    const sub = inMemorySubmissions.find(s => s.id === id);
    if (sub) {
      sub.isRead = true;
    }
    try {
      await db.update(formSubmissions).set({ isRead: true }).where(eq(formSubmissions.id, id));
    } catch {
      // Fallback
    }
    return true;
  }
}
