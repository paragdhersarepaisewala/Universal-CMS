# Universal CMS Core API Documentation

Location: `cms-core/docs/API.md`
Version: 0.1.0
Base URL: `/api/v1`

## 1. Overview and Architecture

Universal CMS Core (`cms-core`) is a headless, client-agnostic content and operational backend designed to run on Node.js 22 LTS in shared hosting environments (such as Hostinger Node.js Web Apps) as well as dedicated servers.

### Core Architecture Characteristics
- Pure Headless API: Emits JSON; zero front-end UI runtime overhead.
- Relational Engine: Powered by MySQL 8.x via Drizzle ORM and `mysql2` with strict connection pooling (`DB_POOL_SIZE=5` default for shared hosting).
- Zero-Scheduler Execution: No in-process persistent daemons or Redis. Background tasks (email processing, webhooks) are enqueued in MySQL `jobs` and executed via scheduled CLI runners (`npm run jobs:process`) or secure webhook endpoints.
- Type-Safe Contracts: Complete TypeBox runtime schema validation on all inputs and responses, automatically producing OpenAPI 3.0 specs.

---

## 2. Global Conventions

### 2.1 Base Path and Versioning
All API routes are grouped under `/api/v1`. Public root assets (`/sitemap.xml`, `/robots.txt`) are mounted at root level. Interactive Swagger UI is hosted at `/api/v1/docs/` and raw OpenAPI schema is located at `/api/v1/openapi.json`.

### 2.2 Standard Success Response Envelope
All successful API responses return JSON wrapped in a standard `data` envelope:

```json
{
  "data": { ... }
}
```

When returning paginated lists, a `meta` block is provided:

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 142,
    "totalPages": 8
  }
}
```

### 2.3 Standard Error Response Envelope
Errors return descriptive JSON accompanied by HTTP status codes:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Field 'email' is required and must be a valid email string"
}
```

Standard Status Codes:
- `200 OK`: Successful read or update.
- `201 Created`: Resource successfully created.
- `400 Bad Request`: Input validation failure.
- `401 Unauthorized`: Missing or invalid session token / API token.
- `403 Forbidden`: Authenticated user lacks required RBAC permission or module is disabled.
- `404 Not Found`: Target entity does not exist.
- `409 Conflict`: Unique constraint violation (e.g., duplicate slug, existing email).
- `429 Too Many Requests`: Rate limit threshold exceeded.
- `500 Internal Server Error`: Unexpected runtime failure.

---

## 3. Authentication and Security

### 3.1 Authentication Mechanisms
1. **User Sessions**:
   - Header: `Authorization: Bearer <session_token>`
   - Generated during login (`POST /api/v1/auth/login`) or signup.
   - Tied to user ID, role, and client user-agent metadata.
2. **API Access Tokens**:
   - Header: `Authorization: Bearer cms_live_<raw_secret>`
   - Created in Admin Settings (`POST /api/v1/admin/tokens`).
   - Scoped to specific capabilities (`read`, `write`, `admin`).
   - Hashes are stored as SHA-256; raw tokens are never exposed again.

### 3.2 Role-Based Access Control (RBAC)
User permissions are verified server-side on every request. Standard roles include:
- `owner`: Superadmin with total system access.
- `admin`: Full operations, configurations, and user management.
- `manager`: Content, store catalog, and order workflow management.
- `editor`: Page content, blog, and media asset management.
- `support`: Read-only access to customer inquiries, orders, and logs.
- `customer`: Public end-user access.

---

## 4. Endpoint Reference

### 4.1 System Health
- `GET /api/v1/health`
  - Public health check reporting status, uptime, database ping, memory usage, and node version.

### 4.2 Authentication & User Accounts
- `POST /api/v1/auth/signup`
  - Register new account with name, email, and password.
- `POST /api/v1/auth/login`
  - Verify credentials. Returns session token or `requires2FA: true`.
- `POST /api/v1/auth/logout`
  - Invalidate active session token.
- `GET /api/v1/auth/me`
  - Return current authenticated user profile, role, and granted permissions.
- `POST /api/v1/auth/forgot-password`
  - Trigger password reset email with secure one-time token.
- `POST /api/v1/auth/reset-password`
  - Consume reset token and establish new password.
- `POST /api/v1/auth/2fa/generate`
  - Generate RFC 6238 TOTP secret and QR provisioning URI.
- `POST /api/v1/auth/2fa/verify`
  - Confirm TOTP verification code to enable 2FA on account.

### 4.3 Public Content & Site Delivery
- `GET /api/v1/theme`
  - Return design tokens (colors, typography, spacing, border radiuses).
- `GET /api/v1/pages/:slug`
  - Fetch published page by slug with structured content blocks.
- `GET /api/v1/menus/:location`
  - Fetch published navigation tree for given location (`header`, `footer`).
- `GET /sitemap.xml`
  - Dynamic XML sitemap listing active pages and canonical URLs.
- `GET /robots.txt`
  - Dynamic robots text with disallow directives and sitemap reference.
- `GET /api/v1/redirects/resolve?path=/old-url`
  - Lookup URL redirect; returns HTTP 301/302 target URL.
- `POST /api/v1/cookies/consent`
  - Log user cookie choices (necessary, analytics, marketing) for compliance.
- `POST /api/v1/email/unsubscribe`
  - Process one-click marketing unsubscribe token.

### 4.4 Admin Operations & Management
Requires `Authorization: Bearer <token>` and administrative permissions.

#### Modules & Navigation
- `GET /api/v1/admin/navigation`
  - Return tailored sidebar navigation based on role permissions and active modules.
- `GET /api/v1/admin/modules`
  - List all core and optional modules with enabled status.
- `PATCH /api/v1/admin/modules/:name`
  - Toggle module on or off (`core.modules.manage`).

#### Roles & Permissions (RBAC)
- `GET /api/v1/admin/roles`
  - List all defined system roles and assigned permissions.
- `GET /api/v1/admin/roles/:id`
  - Fetch details and permission list for single role.
- `PUT /api/v1/admin/roles/:id/permissions`
  - Update permission matrix for a role (`core.roles.manage`).
- `POST /api/v1/admin/users/invite`
  - Send email invitation to staff member with assigned role.

#### Theme & Branding
- `PUT /api/v1/admin/theme`
  - Update theme tokens with automatic cache invalidation (`core.theme.edit`).

#### Pages & Content Blocks
- `GET /api/v1/admin/pages`
  - List all pages with status (`draft`, `published`, `archived`).
- `POST /api/v1/admin/pages`
  - Create new page with slug, title, and block schema.
- `PUT /api/v1/admin/pages/:id`
  - Update page content, schedule publication, or revise blocks.
- `DELETE /api/v1/admin/pages/:id`
  - Remove page from system.

#### Menus & Navigation
- `GET /api/v1/admin/menus`
  - List navigation menus.
- `PUT /api/v1/admin/menus/:id/items`
  - Reorder and update hierarchy of menu items.

#### Media Library
- `GET /api/v1/admin/media`
  - Query uploaded assets with folder, type, and pagination filters.
- `POST /api/v1/admin/media`
  - Register new media upload metadata.

#### SEO & URL Redirects
- `GET /api/v1/admin/seo`
  - Fetch global SEO defaults (meta tags, GA4 ID, Meta Pixel, script injections).
- `PUT /api/v1/admin/seo`
  - Update global SEO configuration.
- `GET /api/v1/admin/redirects`
  - List all 301 and 302 URL redirects.
- `POST /api/v1/admin/redirects`
  - Create new redirect rule.

#### Compliance & Statutory Legal Pages (India)
- `GET /api/v1/admin/legal/drafts/:type`
  - Retrieve statutory draft template (`privacy-policy`, `terms-conditions`, `refund-policy`, `shipping-policy`, `grievance-policy`, `contact-disclaimer`, `cookie-policy`, `statutory-disclosures`). All drafts contain explicit disclaimers that they are drafts and require client review.
- `POST /api/v1/admin/legal/drafts/:type/adopt`
  - Adopt legal draft into a live managed page.

#### Site Settings & Audit Log
- `GET /api/v1/admin/settings`
  - Retrieve system and business settings.
- `PUT /api/v1/admin/settings`
  - Update site settings (`business.name`, `currency`, `timezone`, etc.).
- `GET /api/v1/admin/logs/audit`
  - Query audit trail (who changed what, previous and new values, IP, timestamp).

#### Email Engine
- `GET /api/v1/admin/email/smtp`
  - Fetch SMTP config (password write-only, never returned).
- `PUT /api/v1/admin/email/smtp`
  - Update SMTP credentials; encrypted at rest with AES-256-GCM.
- `POST /api/v1/admin/email/smtp/test`
  - Test live connection and handshake with SMTP server.
- `POST /api/v1/admin/email/test-send`
  - Dispatch test email message to specified recipient.
- `GET /api/v1/admin/email/templates`
  - List all 14 automatic transaction and marketing templates.
- `PUT /api/v1/admin/email/templates/:eventKey`
  - Update subject line, active toggle, and template content.
- `GET /api/v1/admin/email/logs`
  - View delivery logs, attempt count, and error reasons.
- `POST /api/v1/admin/email/logs/:id/resend`
  - Retry failed email delivery.

#### Cache Invalidation
- `GET /api/v1/admin/cache`
  - View active cache driver (`memory` or `file`) and item count.
- `POST /api/v1/admin/cache/purge`
  - Invalidate cache entries by tag or flush entire cache.

#### API Access Tokens
- `GET /api/v1/admin/tokens`
  - List active API access tokens and assigned scopes.
- `POST /api/v1/admin/tokens`
  - Generate new token (`cms_live_...`). Token returned once.
- `DELETE /api/v1/admin/tokens/:id`
  - Revoke API access token.

#### Outbound Webhooks
- `GET /api/v1/admin/webhooks`
  - List registered webhook subscriber endpoints.
- `POST /api/v1/admin/webhooks`
  - Register new webhook subscription with event filters and HMAC secret.
- `POST /api/v1/admin/webhooks/test`
  - Dispatch synthetic test event to verify subscriber delivery.
- `DELETE /api/v1/admin/webhooks/:id`
  - Remove webhook subscription.

#### Forms & Submission Inboxes
- `GET /api/v1/forms/:slug`
  - Public endpoint returning form field definitions and submission rules.
- `POST /api/v1/forms/:slug/submit`
  - Submit form data with honeypot spam protection (`_hp`) and automated notification job dispatch.
- `GET /api/v1/admin/forms`
  - Admin list of all managed forms.
- `POST /api/v1/admin/forms`
  - Create dynamic form with field schemas.
- `GET /api/v1/admin/forms/:id/submissions`
  - View submission inbox for specific form.
- `PATCH /api/v1/admin/forms/submissions/:subId/read`
  - Mark submission as read.

#### Promotional Banners & Announcements
- `GET /api/v1/banners?path=/store`
  - Public endpoint returning active promotional banners, announcement bars, or popups targeted for current route.
- `GET /api/v1/admin/banners`
  - List all banners with start/end schedules and target page routes.
- `POST /api/v1/admin/banners`
  - Create promotional announcement or modal popup.
- `PUT /api/v1/admin/banners/:id`
  - Update banner display rules and content.
- `DELETE /api/v1/admin/banners/:id`
  - Delete promotional banner.

#### Blog Publishing Module
- `GET /api/v1/blog/posts`
  - Public listing of published articles with search, category filtering, and pagination.
- `GET /api/v1/blog/posts/:slug`
  - Public single article detail with content, author, and reading time in minutes.
- `GET /api/v1/blog/categories`
  - List public blog categories.
- `GET /api/v1/blog/tags`
  - List public blog tags.
- `GET /api/v1/blog/rss.xml`
  - Valid RSS 2.0 XML feed of all published articles.
- `GET /api/v1/admin/blog/posts`
  - Admin list of all articles including drafts and scheduled posts.
- `POST /api/v1/admin/blog/posts`
  - Create new blog article with auto-calculated reading time.
- `PUT /api/v1/admin/blog/posts/:id`
  - Update blog article content, status, or featured flag.
- `DELETE /api/v1/admin/blog/posts/:id`
  - Delete blog article.

#### Ecommerce Store & Checkout Module
- `GET /api/v1/store/products`
  - Public product catalog with search, price filtering, and pagination.
- `GET /api/v1/store/products/:slug`
  - Public product details with price, stock, and descriptions.
- `POST /api/v1/store/cart/quote`
  - Calculate cart breakdown (subtotal, coupon discount, 18% standard GST tax, shipping fee, grand total).
- `POST /api/v1/store/checkout`
  - Place order via Razorpay or Cash on Delivery (COD) with customer and shipping details.
- `POST /api/v1/store/checkout/razorpay/verify`
  - Verify Razorpay HMAC-SHA256 signature and mark order captured/processing.
- `GET /api/v1/store/products/:slug/reviews`
  - View approved customer reviews for product.
- `POST /api/v1/store/products/:slug/reviews`
  - Submit product rating (1-5) and review comment for moderation.
- `GET /api/v1/admin/store/products`
  - Admin list of products with inventory stock levels.
- `POST /api/v1/admin/store/products`
  - Create store product.
- `PUT /api/v1/admin/store/products/:id`
  - Update product pricing, description, and stock quantity.
- `GET /api/v1/admin/store/orders`
  - Admin view of customer orders with fulfillment status filters.
- `PUT /api/v1/admin/store/orders/:id/status`
  - Advance order fulfillment status (`pending`, `processing`, `shipped`, `delivered`, `cancelled`).

#### Fundraising & Donations Module
- `GET /api/v1/donations/campaigns`
  - Public list of active fundraising campaigns with goal, raised amount, and progress percentages.
- `GET /api/v1/donations/campaigns/:slug`
  - Public campaign details.
- `POST /api/v1/donations/donate`
  - Contribute donation with anonymous donor privacy option, PAN capture, and automatic Indian 80G tax receipt issuance.
- `GET /api/v1/admin/donations/campaigns`
  - Admin list of all campaigns.
- `POST /api/v1/admin/donations/campaigns`
  - Create fundraising campaign with target financial goal.
- `GET /api/v1/admin/donations/contributions`
  - Admin log of all contributions and 80G tax receipts.

---

## 5. Background Jobs Runner

Background jobs (email queue, webhook dispatch) are processed using the standalone CLI script:

```bash
npm run jobs:process
```

On shared hosting (Hostinger), set up a cron job in hPanel:

```bash
* * * * * cd /home/u123456789/domains/client.com/public_html && /usr/bin/node dist/scripts/process-jobs.js >> logs/cron.log 2>&1
```
