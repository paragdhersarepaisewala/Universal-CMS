import nodemailer, { type Transporter } from 'nodemailer';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { encryptText, decryptText } from '../utils/encryption.js';

export interface SmtpConfig {
  host: string;
  port: number;
  security: 'none' | 'ssl' | 'starttls';
  username: string;
  password?: string;
  from_name: string;
  from_address: string;
  reply_to?: string;
  last_test_at?: string | null;
  last_test_status?: string | null;
  version?: number;
}

export interface SmtpPublicConfig {
  host: string;
  port: number;
  security: 'none' | 'ssl' | 'starttls';
  username: string;
  password_set: boolean;
  from_name: string;
  from_address: string;
  reply_to?: string;
  last_test_at?: string | null;
  last_test_status?: string | null;
  version: number;
}

const DEFAULT_SMTP_CONFIG: SmtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port: Number(process.env.SMTP_PORT) || 587,
  security: (process.env.SMTP_SECURITY as 'none' | 'ssl' | 'starttls') || 'starttls',
  username: process.env.SMTP_USER || '',
  password: process.env.SMTP_PASSWORD || '',
  from_name: process.env.SMTP_FROM_NAME || 'Universal CMS',
  from_address: process.env.SMTP_FROM_ADDRESS || 'noreply@example.com',
  reply_to: process.env.SMTP_REPLY_TO || '',
  last_test_at: null,
  last_test_status: null,
  version: 1,
};

let cachedInMemoryConfig: SmtpConfig = { ...DEFAULT_SMTP_CONFIG };

export function createSmtpTransporter(config: SmtpConfig): Transporter {
  const isSecure = config.security === 'ssl';
  const requireTLS = config.security === 'starttls';

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: isSecure,
    requireTLS,
    auth: config.username && config.password ? {
      user: config.username,
      pass: config.password,
    } : undefined,
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'smtp_settings'))
      .limit(1);

    if (rows.length > 0 && rows[0].value) {
      const stored = typeof rows[0].value === 'string'
        ? JSON.parse(rows[0].value)
        : rows[0].value as Record<string, unknown>;

      const decryptedPassword = stored.encrypted_password
        ? decryptText(String(stored.encrypted_password))
        : '';

      return {
        host: String(stored.host || DEFAULT_SMTP_CONFIG.host),
        port: Number(stored.port || DEFAULT_SMTP_CONFIG.port),
        security: (stored.security || DEFAULT_SMTP_CONFIG.security) as 'none' | 'ssl' | 'starttls',
        username: String(stored.username || DEFAULT_SMTP_CONFIG.username),
        password: decryptedPassword || String(stored.password || DEFAULT_SMTP_CONFIG.password),
        from_name: String(stored.from_name || DEFAULT_SMTP_CONFIG.from_name),
        from_address: String(stored.from_address || DEFAULT_SMTP_CONFIG.from_address),
        reply_to: stored.reply_to ? String(stored.reply_to) : undefined,
        last_test_at: stored.last_test_at ? String(stored.last_test_at) : null,
        last_test_status: stored.last_test_status ? String(stored.last_test_status) : null,
        version: rows[0].version,
      };
    }
  } catch {
    // Database fallback to memory / env
  }

  return cachedInMemoryConfig;
}

export async function getSmtpPublicConfig(): Promise<SmtpPublicConfig> {
  const cfg = await getSmtpConfig();
  return {
    host: cfg.host,
    port: cfg.port,
    security: cfg.security,
    username: cfg.username,
    password_set: Boolean(cfg.password && cfg.password.length > 0),
    from_name: cfg.from_name,
    from_address: cfg.from_address,
    reply_to: cfg.reply_to,
    last_test_at: cfg.last_test_at,
    last_test_status: cfg.last_test_status,
    version: cfg.version || 1,
  };
}

export async function saveSmtpConfig(newConfig: Partial<SmtpConfig>, expectedVersion?: number): Promise<SmtpPublicConfig> {
  const current = await getSmtpConfig();

  if (expectedVersion !== undefined && current.version !== undefined && expectedVersion !== current.version) {
    const error = new Error('Version conflict: settings have been updated by another administrator.');
    (error as unknown as { statusCode: number; code: string }).statusCode = 409;
    (error as unknown as { statusCode: number; code: string }).code = 'CONFLICT';
    throw error;
  }

  const updatedPassword = newConfig.password && newConfig.password.trim() !== ''
    ? newConfig.password
    : current.password;

  const merged: SmtpConfig = {
    ...current,
    ...newConfig,
    password: updatedPassword,
    version: (current.version || 1) + 1,
  };

  cachedInMemoryConfig = merged;

  try {
    const payloadToStore = {
      host: merged.host,
      port: merged.port,
      security: merged.security,
      username: merged.username,
      encrypted_password: updatedPassword ? encryptText(updatedPassword) : '',
      from_name: merged.from_name,
      from_address: merged.from_address,
      reply_to: merged.reply_to,
      last_test_at: merged.last_test_at,
      last_test_status: merged.last_test_status,
    };

    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'smtp_settings'))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({
          value: JSON.stringify(payloadToStore),
          version: merged.version,
          updatedAt: new Date(),
        })
        .where(eq(settings.key, 'smtp_settings'));
    } else {
      await db.insert(settings).values({
        key: 'smtp_settings',
        value: JSON.stringify(payloadToStore),
        group: 'email',
        isPublic: false,
        version: merged.version,
      });
    }
  } catch {
    // Database write fallback
  }

  return {
    host: merged.host,
    port: merged.port,
    security: merged.security,
    username: merged.username,
    password_set: Boolean(merged.password && merged.password.length > 0),
    from_name: merged.from_name,
    from_address: merged.from_address,
    reply_to: merged.reply_to,
    last_test_at: merged.last_test_at,
    last_test_status: merged.last_test_status,
    version: merged.version || 1,
  };
}

export async function testSmtpConnection(overrideConfig?: Partial<SmtpConfig>): Promise<{ success: boolean; message: string }> {
  const base = await getSmtpConfig();
  const config: SmtpConfig = {
    ...base,
    ...overrideConfig,
    password: overrideConfig?.password && overrideConfig.password.trim() !== '' ? overrideConfig.password : base.password,
  };

  const transporter = createSmtpTransporter(config);
  try {
    await transporter.verify();
    
    // Update last test status
    await saveSmtpConfig({
      last_test_at: new Date().toISOString(),
      last_test_status: 'success',
    });

    return { success: true, message: 'SMTP connection established successfully' };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await saveSmtpConfig({
      last_test_at: new Date().toISOString(),
      last_test_status: `failed: ${errorMessage}`,
    });
    throw new Error(`SMTP connection test failed: ${errorMessage}`);
  }
}
