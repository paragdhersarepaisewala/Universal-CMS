import {
  mysqlTable,
  bigint,
  varchar,
  text,
  int,
  timestamp,
  boolean,
  json,
} from 'drizzle-orm/mysql-core';

// 1. Roles
export const roles = mysqlTable('roles', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  isSystem: boolean('is_system').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 2. Permissions
export const permissions = mysqlTable('permissions', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  module: varchar('module', { length: 50 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Role Permissions Join Table
export const rolePermissions = mysqlTable('role_permissions', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  roleId: bigint('role_id', { mode: 'number', unsigned: true }).notNull(),
  permissionId: bigint('permission_id', { mode: 'number', unsigned: true }).notNull(),
});

// 4. Users
export const users = mysqlTable('users', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  roleId: bigint('role_id', { mode: 'number', unsigned: true }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
  twoFactorSecret: varchar('two_factor_secret', { length: 255 }),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 5. Sessions
export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Audit Logs
export const auditLogs = mysqlTable('audit_logs', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: varchar('entity_id', { length: 50 }),
  beforeValues: json('before_values'),
  afterValues: json('after_values'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Settings
export const settings = mysqlTable('settings', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: json('value').notNull(),
  group: varchar('group', { length: 50 }).default('general').notNull(),
  isPublic: boolean('is_public').default(false).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 8. Modules
export const modules = mysqlTable('modules', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  version: varchar('version', { length: 20 }).notNull(),
  isEnabled: boolean('is_enabled').default(false).notNull(),
  isCore: boolean('is_core').default(false).notNull(),
  settings: json('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 9. Theme Tokens
export const themeTokens = mysqlTable('theme_tokens', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: text('value').notNull(),
  tokenType: varchar('token_type', { length: 50 }).default('color').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 10. Pages
export const pages = mysqlTable('pages', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 20 }).default('draft').notNull(), // draft, published, archived, scheduled
  publishedAt: timestamp('published_at'),
  version: int('version').default(1).notNull(),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
  updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 11. Content Blocks
export const contentBlocks = mysqlTable('content_blocks', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  pageId: bigint('page_id', { mode: 'number', unsigned: true }).notNull(),
  blockType: varchar('block_type', { length: 50 }).notNull(),
  data: json('data').notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 12. Menus
export const menus = mysqlTable('menus', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  location: varchar('location', { length: 50 }), // header, footer, mobile
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 13. Menu Items
export const menuItems = mysqlTable('menu_items', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  menuId: bigint('menu_id', { mode: 'number', unsigned: true }).notNull(),
  parentId: bigint('parent_id', { mode: 'number', unsigned: true }),
  label: varchar('label', { length: 100 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  target: varchar('target', { length: 20 }).default('_self').notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 14. Media
export const media = mysqlTable('media', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  filename: varchar('filename', { length: 255 }).notNull(),
  originalName: varchar('original_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number', unsigned: true }).notNull(),
  width: int('width'),
  height: int('height'),
  altText: text('alt_text'),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  publicUrl: varchar('public_url', { length: 500 }).notNull(),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 15. Redirects
export const redirects = mysqlTable('redirects', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  sourcePath: varchar('source_path', { length: 500 }).notNull().unique(),
  targetPath: varchar('target_path', { length: 500 }).notNull(),
  statusCode: int('status_code').default(301).notNull(), // 301, 302
  isActive: boolean('is_active').default(true).notNull(),
  hitCount: bigint('hit_count', { mode: 'number', unsigned: true }).default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 16. SEO Meta
export const seoMeta = mysqlTable('seo_meta', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  entityType: varchar('entity_type', { length: 50 }).notNull(), // page, product, article, global
  entityId: varchar('entity_id', { length: 50 }).notNull(),
  metaTitle: varchar('meta_title', { length: 160 }),
  metaDescription: text('meta_description'),
  canonicalUrl: varchar('canonical_url', { length: 500 }),
  robots: varchar('robots', { length: 50 }).default('index, follow').notNull(),
  ogTitle: varchar('og_title', { length: 160 }),
  ogDescription: text('og_description'),
  ogImageId: bigint('og_image_id', { mode: 'number', unsigned: true }),
  twitterCard: varchar('twitter_card', { length: 50 }).default('summary_large_image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 17. Email Templates
export const emailTemplates = mysqlTable('email_templates', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 150 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  bodyHtml: text('body_html').notNull(),
  bodyText: text('body_text'),
  variablesSchema: json('variables_schema'),
  isActive: boolean('is_active').default(true).notNull(),
  isSystem: boolean('is_system').default(true).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 18. Email Logs
export const emailLogs = mysqlTable('email_logs', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  templateId: bigint('template_id', { mode: 'number', unsigned: true }),
  recipient: varchar('recipient', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).default('queued').notNull(), // queued, sent, failed
  errorMessage: text('error_message'),
  attempts: int('attempts').default(0).notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 19. Background Jobs
export const jobs = mysqlTable('jobs', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  queue: varchar('queue', { length: 50 }).default('default').notNull(),
  jobType: varchar('job_type', { length: 100 }).notNull(),
  payload: json('payload').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, running, completed, failed
  attempts: int('attempts').default(0).notNull(),
  maxAttempts: int('max_attempts').default(3).notNull(),
  lastError: text('last_error'),
  lockedAt: timestamp('locked_at'),
  runAfter: timestamp('run_after').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});
