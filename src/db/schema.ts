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
  phone: varchar('phone', { length: 20 }),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  roleId: bigint('role_id', { mode: 'number', unsigned: true }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
  twoFactorSecret: varchar('two_factor_secret', { length: 255 }),
  dateOfBirth: varchar('date_of_birth', { length: 20 }),
  communicationPreferences: json('communication_preferences'),
  customerSegment: varchar('customer_segment', { length: 50 }).default('standard').notNull(),
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

// Auth Tokens (email verification, password resets)
export const authTokens = mysqlTable('auth_tokens', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  tokenType: varchar('token_type', { length: 50 }).notNull(), // email_verify, password_reset
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  code: varchar('code', { length: 10 }),
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

// 20. Forms & Submissions
export const forms = mysqlTable('forms', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 150 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  fields: json('fields').notNull(), // Array<{ name, label, type, required, options }>
  submitButtonText: varchar('submit_button_text', { length: 100 }).default('Submit').notNull(),
  successMessage: text('success_message'),
  notificationEmail: varchar('notification_email', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const formSubmissions = mysqlTable('form_submissions', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  formId: bigint('form_id', { mode: 'number', unsigned: true }).notNull(),
  data: json('data').notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 21. Banners & Announcements
export const banners = mysqlTable('banners', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 150 }).notNull(),
  type: varchar('type', { length: 50 }).default('announcement_bar').notNull(), // announcement_bar, popup, toast
  content: text('content').notNull(),
  linkUrl: varchar('link_url', { length: 500 }),
  buttonText: varchar('button_text', { length: 100 }),
  location: varchar('location', { length: 50 }).default('top').notNull(),
  targetPages: json('target_pages'), // e.g. ["*"] or ["/store", "/about"]
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  isActive: boolean('is_active').default(true).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 22. Blog (Posts, Categories, Tags)
export const blogCategories = mysqlTable('blog_categories', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 150 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  parentId: bigint('parent_id', { mode: 'number', unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const blogTags = mysqlTable('blog_tags', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const blogPosts = mysqlTable('blog_posts', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  excerpt: text('excerpt'),
  content: text('content').notNull(),
  authorId: bigint('author_id', { mode: 'number', unsigned: true }).notNull(),
  featuredImageId: bigint('featured_image_id', { mode: 'number', unsigned: true }),
  status: varchar('status', { length: 20 }).default('draft').notNull(), // draft, published, scheduled, archived
  publishedAt: timestamp('published_at'),
  readingTimeMinutes: int('reading_time_minutes').default(1).notNull(),
  isFeatured: boolean('is_featured').default(false).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 23. Ecommerce Store (Products, Variants, Orders, Items, Coupons)
export const products = mysqlTable('products', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  description: text('description'),
  sku: varchar('sku', { length: 100 }).unique(),
  price: int('price').notNull(), // Smallest currency unit (paisa / cents)
  compareAtPrice: int('compare_at_price'),
  costPrice: int('cost_price'),
  productType: varchar('product_type', { length: 50 }).default('physical').notNull(), // physical, digital
  stockQuantity: int('stock_quantity').default(0).notNull(),
  weightGrams: int('weight_grams').default(500).notNull(),
  lengthCm: int('length_cm'),
  widthCm: int('width_cm'),
  heightCm: int('height_cm'),
  lowStockThreshold: int('low_stock_threshold').default(5).notNull(),
  trackInventory: boolean('track_inventory').default(true).notNull(),
  trackStock: boolean('track_stock').default(true).notNull(),
  allowBackorder: boolean('allow_backorder').default(false).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(), // draft, active, archived
  isAgeRestricted: boolean('is_age_restricted').default(false).notNull(),
  featuredImageId: bigint('featured_image_id', { mode: 'number', unsigned: true }),
  taxClassId: bigint('tax_class_id', { mode: 'number', unsigned: true }),
  hsnCode: varchar('hsn_code', { length: 20 }),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const productVariants = mysqlTable('product_variants', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  productType: varchar('product_type', { length: 50 }).default('physical').notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  sku: varchar('sku', { length: 100 }),
  price: int('price').notNull(),
  stockQuantity: int('stock_quantity').default(0).notNull(),
  weightGrams: int('weight_grams').default(500).notNull(),
  lengthCm: int('length_cm'),
  widthCm: int('width_cm'),
  heightCm: int('height_cm'),
  attributes: json('attributes'), // e.g. { size: "L", color: "Black" }
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orders = mysqlTable('orders', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderNumber: varchar('order_number', { length: 50 }).notNull().unique(),
  customerId: bigint('customer_id', { mode: 'number', unsigned: true }),
  customerEmail: varchar('customer_email', { length: 255 }).notNull(),
  status: varchar('status', { length: 35 }).default('pending_payment').notNull(),
  orderKind: varchar('order_kind', { length: 30 }).default('physical').notNull(), // physical, digital, mixed
  paymentMethod: varchar('payment_method', { length: 50 }).default('razorpay').notNull(), // razorpay, cod
  paymentStatus: varchar('payment_status', { length: 30 }).default('pending').notNull(), // pending, authorized, captured, failed, refunded
  paymentId: varchar('payment_id', { length: 100 }),
  invoiceId: bigint('invoice_id', { mode: 'number', unsigned: true }),
  placeOfSupplyState: varchar('place_of_supply_state', { length: 2 }),
  buyerGstin: varchar('buyer_gstin', { length: 15 }),
  subtotal: int('subtotal').notNull(),
  taxTotal: int('tax_total').default(0).notNull(),
  shippingTotal: int('shipping_total').default(0).notNull(),
  shippingMethod: varchar('shipping_method', { length: 100 }),
  shippingCarrier: varchar('shipping_carrier', { length: 100 }),
  shippingAwb: varchar('shipping_awb', { length: 100 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  discountTotal: int('discount_total').default(0).notNull(),
  codFeePaise: int('cod_fee_paise').default(0).notNull(),
  codFeeTaxPaise: int('cod_fee_tax_paise').default(0).notNull(),
  cgstPaise: int('cgst_paise').default(0).notNull(),
  sgstPaise: int('sgst_paise').default(0).notNull(),
  utgstPaise: int('utgst_paise').default(0).notNull(),
  igstPaise: int('igst_paise').default(0).notNull(),
  cessPaise: int('cess_paise').default(0).notNull(),
  total: int('total').notNull(),
  currency: varchar('currency', { length: 10 }).default('INR').notNull(),
  shippingAddress: json('shipping_address'),
  billingAddress: json('billing_address'),
  billingState: varchar('billing_state', { length: 100 }),
  notes: text('notes'),
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  idempotencyPayloadHash: varchar('idempotency_payload_hash', { length: 64 }),
  expiresAt: timestamp('expires_at'),
  guestAccessToken: varchar('guest_access_token', { length: 255 }),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const orderItems = mysqlTable('order_items', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  variantId: bigint('variant_id', { mode: 'number', unsigned: true }),
  productType: varchar('product_type', { length: 50 }).default('physical').notNull(),
  fulfilmentStatus: varchar('fulfilment_status', { length: 50 }).default('pending').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 100 }),
  price: int('price').notNull(),
  quantity: int('quantity').default(1).notNull(),
  weightGrams: int('weight_grams').default(0).notNull(),
  taxClassId: bigint('tax_class_id', { mode: 'number', unsigned: true }),
  hsnCode: varchar('hsn_code', { length: 20 }),
  taxRateBasisPoints: int('tax_rate_basis_points').default(0).notNull(),
  taxableAmountPaise: int('taxable_amount_paise').default(0).notNull(),
  cgstPaise: int('cgst_paise').default(0).notNull(),
  sgstPaise: int('sgst_paise').default(0).notNull(),
  utgstPaise: int('utgst_paise').default(0).notNull(),
  igstPaise: int('igst_paise').default(0).notNull(),
  cessPaise: int('cess_paise').default(0).notNull(),
  total: int('total').notNull(),
});

export const coupons = mysqlTable('coupons', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  discountType: varchar('discount_type', { length: 20 }).default('percentage').notNull(), // percentage, fixed
  discountValue: int('discount_value').notNull(), // 10 = 10% or 1000 = Rs 10
  minOrderAmount: int('min_order_amount').default(0).notNull(),
  maxDiscountAmount: int('max_discount_amount'),
  usageLimit: int('usage_limit'),
  usageCount: int('usage_count').default(0).notNull(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = mysqlTable('payments', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  gateway: varchar('gateway', { length: 50 }).default('razorpay').notNull(),
  gatewayOrderId: varchar('gateway_order_id', { length: 100 }).notNull(),
  gatewayPaymentId: varchar('gateway_payment_id', { length: 100 }).notNull().unique(),
  amountPaise: int('amount_paise').notNull(),
  currency: varchar('currency', { length: 10 }).default('INR').notNull(),
  status: varchar('status', { length: 50 }).notNull(), // pending, authorized, captured, failed, refunded
  method: varchar('method', { length: 50 }),
  capturedAt: timestamp('captured_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const refunds = mysqlTable('refunds', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  paymentId: bigint('payment_id', { mode: 'number', unsigned: true }).notNull(),
  amountPaise: int('amount_paise').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, processed, failed
  gatewayRefundId: varchar('gateway_refund_id', { length: 100 }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  restock: boolean('restock').default(false).notNull(),
  reason: text('reason').notNull(),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const stockMovements = mysqlTable('stock_movements', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  variantId: bigint('variant_id', { mode: 'number', unsigned: true }),
  quantity: int('quantity').notNull(), // negative for reservation/sale, positive for restock/release
  changeType: varchar('change_type', { length: 50 }).notNull(), // reservation, release, sale, restock, adjustment
  reason: text('reason'),
  referenceId: varchar('reference_id', { length: 100 }), // order number or refund id
  actorId: bigint('actor_id', { mode: 'number', unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orderStatusHistory = mysqlTable('order_status_history', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  fromStatus: varchar('from_status', { length: 50 }).notNull(),
  toStatus: varchar('to_status', { length: 50 }).notNull(),
  actor: varchar('actor', { length: 100 }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orderNotes = mysqlTable('order_notes', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  isCustomerVisible: boolean('is_customer_visible').default(false).notNull(),
  note: text('note').notNull(),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const paymentWebhookEvents = mysqlTable('payment_webhook_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  eventId: varchar('event_id', { length: 100 }).notNull().unique(),
  gateway: varchar('gateway', { length: 50 }).default('razorpay').notNull(),
  eventName: varchar('event_name', { length: 100 }).notNull(),
  payload: json('payload').notNull(),
  status: varchar('status', { length: 50 }).default('received').notNull(), // received, processed, failed, ignored
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 23b. GST Tax Classes, Rules & States
export const taxClasses = mysqlTable('tax_classes', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 100 }).notNull(),
  kind: varchar('kind', { length: 20 }).default('goods').notNull(), // goods, service
  codeType: varchar('code_type', { length: 10 }).default('HSN').notNull(), // HSN, SAC
  code: varchar('code', { length: 20 }).notNull(),
  rateBasisPoints: int('rate_basis_points').default(1800).notNull(), // 1800 = 18.00%
  cessBasisPoints: int('cess_basis_points').default(0).notNull(),
  isExempt: boolean('is_exempt').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const taxRules = mysqlTable('tax_rules', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  taxClassId: bigint('tax_class_id', { mode: 'number', unsigned: true }).notNull(),
  minPricePaise: int('min_price_paise').default(0).notNull(),
  maxPricePaise: int('max_price_paise'), // null means infinity
  rateBasisPoints: int('rate_basis_points').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const states = mysqlTable('states', {
  gstCode: varchar('gst_code', { length: 2 }).primaryKey(), // '27', '29', etc.
  name: varchar('100', { length: 100 }).notNull(),
  isUnionTerritory: boolean('is_union_territory').default(false).notNull(),
  usesUtgst: boolean('uses_utgst').default(false).notNull(),
});

export const invoiceSequences = mysqlTable('invoice_sequences', {
  financialYear: varchar('financial_year', { length: 10 }).primaryKey(), // '2026-27'
  lastInvoiceNumber: int('last_invoice_number').default(0).notNull(),
  lastCreditNoteNumber: int('last_credit_note_number').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const invoices = mysqlTable('invoices', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull().unique(), // 'INV/2026-27/0001'
  financialYear: varchar('financial_year', { length: 10 }).notNull(),
  invoiceType: varchar('invoice_type', { length: 30 }).default('tax_invoice').notNull(), // tax_invoice, bill_of_supply
  status: varchar('status', { length: 30 }).default('issued').notNull(), // issued, cancelled
  sellerSnapshot: json('seller_snapshot').notNull(),
  buyerSnapshot: json('buyer_snapshot').notNull(),
  lineItemsSnapshot: json('line_items_snapshot').notNull(),
  taxSummary: json('tax_summary').notNull(),
  taxableAmountPaise: int('taxable_amount_paise').notNull(),
  cgstAmountPaise: int('cgst_amount_paise').default(0).notNull(),
  sgstAmountPaise: int('sgst_amount_paise').default(0).notNull(),
  utgstAmountPaise: int('utgst_amount_paise').default(0).notNull(),
  igstAmountPaise: int('igst_amount_paise').default(0).notNull(),
  cessAmountPaise: int('cess_amount_paise').default(0).notNull(),
  totalTaxPaise: int('total_tax_paise').notNull(),
  shippingPaise: int('shipping_paise').default(0).notNull(),
  shippingTaxPaise: int('shipping_tax_paise').default(0).notNull(),
  totalAmountPaise: int('total_amount_paise').notNull(),
  issuedAt: timestamp('issued_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const creditNotes = mysqlTable('credit_notes', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  invoiceId: bigint('invoice_id', { mode: 'number', unsigned: true }).notNull(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  refundId: bigint('refund_id', { mode: 'number', unsigned: true }),
  creditNoteNumber: varchar('credit_note_number', { length: 50 }).notNull().unique(), // 'CN/2026-27/0001'
  financialYear: varchar('financial_year', { length: 10 }).notNull(),
  reason: text('reason').notNull(),
  snapshot: json('snapshot').notNull(),
  taxableAmountPaise: int('taxable_amount_paise').notNull(),
  cgstAmountPaise: int('cgst_amount_paise').default(0).notNull(),
  sgstAmountPaise: int('sgst_amount_paise').default(0).notNull(),
  utgstAmountPaise: int('utgst_amount_paise').default(0).notNull(),
  igstAmountPaise: int('igst_amount_paise').default(0).notNull(),
  cessAmountPaise: int('cess_amount_paise').default(0).notNull(),
  totalTaxPaise: int('total_tax_paise').notNull(),
  totalAmountPaise: int('total_amount_paise').notNull(),
  issuedAt: timestamp('issued_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 24. Reviews & Ratings
export const reviews = mysqlTable('reviews', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  entityType: varchar('entity_type', { length: 50 }).default('product').notNull(), // product, site
  entityId: varchar('entity_id', { length: 50 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }),
  authorName: varchar('author_name', { length: 150 }).notNull(),
  authorEmail: varchar('author_email', { length: 255 }),
  rating: int('rating').notNull(), // 1 - 5
  comment: text('comment').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, approved, rejected
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 25. Donation Campaigns & Contributions
export const donationCampaigns = mysqlTable('donation_campaigns', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  goalAmount: int('goal_amount').notNull(),
  raisedAmount: int('raised_amount').default(0).notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const donations = mysqlTable('donations', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  campaignId: bigint('campaign_id', { mode: 'number', unsigned: true }).notNull(),
  donorName: varchar('donor_name', { length: 150 }).notNull(),
  donorEmail: varchar('donor_email', { length: 255 }).notNull(),
  donorPan: varchar('donor_pan', { length: 20 }), // For Indian 80G tax receipt
  amount: int('amount').notNull(),
  paymentId: varchar('payment_id', { length: 100 }),
  isAnonymous: boolean('is_anonymous').default(false).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, completed, failed
  receiptNumber: varchar('receipt_number', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 26. Shipping (Zones, Rates, Shipments)
export const shippingZones = mysqlTable('shipping_zones', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 100 }).notNull(),
  countriesJson: json('countries_json').notNull(),
  statesJson: json('states_json'),
  pincodesJson: json('pincodes_json'),
  isActive: boolean('is_active').default(true).notNull(),
  priority: int('priority').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const shippingZoneRates = mysqlTable('shipping_zone_rates', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  zoneId: bigint('zone_id', { mode: 'number', unsigned: true }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  rateType: varchar('rate_type', { length: 50 }).default('weight_based').notNull(), // flat, weight_based, price_tiered
  minWeightGrams: int('min_weight_grams').default(0).notNull(),
  maxWeightGrams: int('max_weight_grams'),
  minOrderPaise: bigint('min_order_paise', { mode: 'number' }).default(0).notNull(),
  maxOrderPaise: bigint('max_order_paise', { mode: 'number' }),
  ratePaise: bigint('rate_paise', { mode: 'number' }).default(0).notNull(),
  estimatedDaysMin: int('estimated_days_min').default(2).notNull(),
  estimatedDaysMax: int('estimated_days_max').default(5).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const shippingShipments = mysqlTable('shipping_shipments', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  shipmentNumber: varchar('shipment_number', { length: 100 }).notNull().unique(),
  partner: varchar('partner', { length: 50 }).default('manual').notNull(), // manual, shiprocket, delhivery, fake
  partnerShipmentId: varchar('partner_shipment_id', { length: 100 }),
  partnerOrderId: varchar('partner_order_id', { length: 100 }),
  awb: varchar('awb', { length: 100 }).notNull(),
  trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
  carrierName: varchar('carrier_name', { length: 100 }),
  status: varchar('status', { length: 50 }).default('manifested').notNull(), // manifested, picked_up, in_transit, out_for_delivery, delivered, rto, cancelled
  labelUrl: text('label_url'),
  weightGrams: int('weight_grams').default(500).notNull(),
  lengthCm: int('length_cm'),
  widthCm: int('width_cm'),
  heightCm: int('height_cm'),
  isCod: boolean('is_cod').default(false).notNull(),
  codAmountPaise: bigint('cod_amount_paise', { mode: 'number' }).default(0).notNull(),
  shippingFeePaise: bigint('shipping_fee_paise', { mode: 'number' }).default(0).notNull(),
  shippedAt: timestamp('shipped_at'),
  deliveredAt: timestamp('delivered_at'),
  trackingHistoryJson: json('tracking_history_json'),
  metadataJson: json('metadata_json'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// 28. Digital Delivery Module (CP-H2.3D)
export const digitalAssets = mysqlTable('digital_assets', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  variantId: bigint('variant_id', { mode: 'number', unsigned: true }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).default(0).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).default('application/octet-stream').notNull(),
  downloadLimit: int('download_limit').default(5).notNull(),
  expiresHours: int('expires_hours').default(72).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const licenseKeys = mysqlTable('license_keys', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  variantId: bigint('variant_id', { mode: 'number', unsigned: true }),
  licenseKey: varchar('license_key', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 50 }).default('available').notNull(), // available, assigned, revoked
  orderId: bigint('order_id', { mode: 'number', unsigned: true }),
  orderItemId: bigint('order_item_id', { mode: 'number', unsigned: true }),
  assignedAt: timestamp('assigned_at'),
  metadataJson: json('metadata_json'),
  version: int('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

export const digitalEntitlements = mysqlTable('digital_entitlements', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  orderItemId: bigint('order_item_id', { mode: 'number', unsigned: true }).notNull(),
  customerId: bigint('customer_id', { mode: 'number', unsigned: true }),
  assetId: bigint('asset_id', { mode: 'number', unsigned: true }),
  licenseKeyId: bigint('license_key_id', { mode: 'number', unsigned: true }),
  downloadToken: varchar('download_token', { length: 100 }).notNull().unique(),
  downloadCount: int('download_count').default(0).notNull(),
  maxDownloads: int('max_downloads').default(5).notNull(),
  expiresAt: timestamp('expires_at'),
  status: varchar('status', { length: 50 }).default('active').notNull(), // active, revoked, expired
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// Customer Delivery Addresses
export const customerAddresses = mysqlTable('customer_addresses', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  addressLine1: varchar('address_line1', { length: 255 }).notNull(),
  addressLine2: varchar('address_line2', { length: 255 }),
  city: varchar('city', { length: 100 }).notNull(),
  state: varchar('state', { length: 100 }).notNull(),
  stateCode: varchar('state_code', { length: 10 }),
  postalCode: varchar('postal_code', { length: 20 }).notNull(),
  country: varchar('country', { length: 10 }).default('IN').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// Customer Wishlist
export const customerWishlist = mysqlTable('customer_wishlist', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Order Return / Refund Requests
export const orderReturnRequests = mysqlTable('order_return_requests', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  orderItemId: bigint('order_item_id', { mode: 'number', unsigned: true }).notNull(),
  customerId: bigint('customer_id', { mode: 'number', unsigned: true }).notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(), // pending, approved, rejected, completed
  adminNotes: text('admin_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// Customer Notes (Admin Staff Internal Notes)
export const customerNotes = mysqlTable('customer_notes', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  customerId: bigint('customer_id', { mode: 'number', unsigned: true }).notNull(),
  authorId: bigint('author_id', { mode: 'number', unsigned: true }).notNull(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Customer DPDP Data Requests (Export & Deletion)
export const customerDataRequests = mysqlTable('customer_data_requests', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  requestType: varchar('request_type', { length: 30 }).notNull(), // export, delete
  status: varchar('status', { length: 30 }).default('pending').notNull(), // pending, completed, rejected
  exportPayload: json('export_payload'),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});




