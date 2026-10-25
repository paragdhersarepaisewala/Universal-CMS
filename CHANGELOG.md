# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.1.0] - 2026-10-25

### Added
- Initial project tooling, semantic versioning setup, and configuration.
- Node.js 22 LTS runtime alignment with Hostinger Web Apps specifications.
- Fastify server architecture with TypeScript compilation targeting dist/server.js.
- MySQL2 connection pooling with configurable pool size (default: 5) tailored for shared hosting environments.
- Drizzle ORM schema structure and migration runner.
- Seed command for bootstrapping system roles, permissions, and default owner account.
- Automated OpenAPI 3.0 specification generation from Fastify TypeBox schemas.
- Health check endpoint under /api/v1/health reporting process uptime, environment, and database pool status.
- Background job processing architecture documented (MySQL jobs table with cron-driven runner, avoiding in-process persistent daemons).
- GitHub Actions CI workflow using Node.js 22.
- Complete core MySQL schema (19 tables): users, roles, permissions, role_permissions, sessions, audit_logs, settings, modules, theme_tokens, pages, content_blocks, menus, menu_items, media, redirects, seo_meta, email_templates, email_logs, jobs.
- Added optimistic concurrency version columns to editable entities.
- Migration runner updated with 0002_core_schema_cp2_2 executing all DDL definitions with foreign indexes and utf8mb4 collation.
- Module system and feature flags: ModuleRegistry managing core (always-on) and optional modules with dependency graph validation.
- Route guard hook (requireModule) enforcing 404 MODULE_DISABLED when disabled.
- Dynamic admin navigation endpoint (/api/v1/admin/navigation) filtering items by enabled modules.
- Admin module management endpoints: GET /api/v1/admin/modules and PATCH /api/v1/admin/modules/:name to toggle module states.
- Unit and contract test suite proving disabled modules return 404, disappear from navigation, and core modules cannot be disabled.
- Authentication & Accounts engine under /api/v1/auth:
  - Signup with email verification token/code generation and optional date-of-birth capture.
  - Email verification endpoint with expiration and resend rate-limiting (cooldown & window limits).
  - Login endpoint with password hashing, email verification requirement, and account lockout (temporary lock after 5 consecutive failed attempts).
  - RFC 6238 TOTP two-factor authentication (2FA) setup and verification for privileged accounts.
  - Session management in MySQL sessions table with token hashing, IP and user-agent tracking.
  - Logout endpoint with session revocation.
  - Forgot password and reset password flow with token invalidation and active session clearing.
  - Authenticated session inspection endpoint (/api/v1/auth/me).
- Role-Based Access Control (RBAC) & Permission Matrix (CP2.5):
  - Predefined 6 system roles: owner, admin, manager, editor, support, customer.
  - Granular permissions definitions matrix across system domains (users, roles, content, modules, media, settings, email).
  - RBAC service with fallback defaults, role permission persistence, and staff invitation engine.
  - Fastify route guards: `requirePermission` and `requireRole` returning 403 FORBIDDEN when unauthorized.
  - Admin RBAC endpoints: `GET /api/v1/admin/me`, `GET /api/v1/admin/roles`, `GET /api/v1/admin/permissions`, `PUT /api/v1/admin/roles/:id/permissions`, and `POST /api/v1/admin/users/invite`.
  - Comprehensive contract test suite proving authorization enforcement, permission updates, and 403 status codes.
- Email Engine & Background Queue (CP2.6):
  - SMTP configuration stored encrypted at rest using AES-256-GCM (`src/utils/encryption.ts`).
  - Passwords write-only with optimistic concurrency versioning; `GET /api/v1/admin/email/smtp` masks passwords (`password_set: boolean`).
  - Connection test endpoint (`POST /api/v1/admin/email/smtp/test`) and test-send endpoint (`POST /api/v1/admin/email/test-send`).
  - Background email queue runner (`src/scripts/process-jobs.ts` and `POST /api/v1/admin/email/queue/process`) with exponential backoff retry and failure logging, compatible with Hostinger hPanel cron.
  - Responsive table-based HTML layout wrapper with theme styling tokens and variable interpolation (`{{ dot.notation }}`).
  - Registry of 14 automatic email events across transactional and marketing categories with customizable subjects and on/off switches.
  - Token-based unsubscribe flow (`/api/v1/email/unsubscribe`) and consent verification for marketing emails; transactional emails bypass marketing restrictions.
  - Email templates library (`/api/v1/admin/email/templates`) with versioned editing and reset to system default.
  - Paginated email logs (`/api/v1/admin/email/log`) and manual resend capability.
- Multi-Driver Cache Layer & Tag Invalidation (CP2.7):
  - Pluggable `CacheDriver` architecture with in-memory (`MemoryCacheDriver`) and persistent filesystem (`FileCacheDriver`) drivers for shared web hosting without Redis.
  - Standardized tag invalidation (`settings`, `menus`, `pages`, `theme`, `catalog`, `navigation`) with reverse tag indexing.
  - Unified `CacheManager` with `getOrSet`, atomic purge, and TTL lifecycle management.
  - Admin cache management endpoints under `/api/v1/admin/cache`:
    - `GET /api/v1/admin/cache`: Inspects active driver, total cached items, and registered tags.
    - `POST /api/v1/admin/cache/purge`: Supports selective tag invalidation, single key purging, and complete cache flush.
  - Route guard `requirePermission('core.cache.manage')` enforcing administrative authorization.
- Content, Theme & Compliance API (CP2.8):
  - Theme styling tokens management with public dictionary endpoint (`GET /api/v1/theme`) and cache invalidation.
  - Full pages and structured content block engine supporting drafts, publishing, slug lookups, and optimistic versioning.
  - Hierarchical menu navigation engine with location-based retrieval (`GET /api/v1/menus/:location`) and item tree mutations.
  - Media library service providing upload rules (`GET /api/v1/admin/media/rules`), metadata tracking, and reference verification for safe deletion.
  - Search engine optimization (SEO) suite generating dynamic XML sitemaps (`/sitemap.xml`), robots crawler protocol (`/robots.txt`), and global/entity metadata.
  - URL redirect manager supporting 301 and 302 redirects with path resolution and hit analytics.
  - Statutory India compliance framework seeding 8 legal policy draft templates (DPDP Act aligned drafts, Grievance Officer details, business disclosures) with explicit legal draft notices.
  - User cookie consent logging endpoint (`POST /api/v1/cookies/consent`) and administrative consent audit viewer.
  - General site settings API with tax, timezone, currency, invoice sequence numbers, and version conflict checks.
  - Comprehensive administrative audit trail logging actor user ID, action, entity, before/after snapshots, and IP addresses.
- API Contract, API Tokens, Webhooks & Gate 2 (CP2.9):
  - API Token Service (`src/api-tokens/service.ts`) with `cms_live_` prefixed cryptographic token generation, SHA-256 storage, and granular permission scopes (`read`, `write`, `admin`).
  - Admin API token endpoints (`/api/v1/admin/tokens`) allowing tokens to be listed, generated, and revoked with audit logging.
  - Outbound Webhooks Service (`src/webhooks/service.ts`) with HMAC SHA-256 signature calculation, event filtering, wildcard subscription support, and job dispatching.
  - Admin webhook endpoints (`/api/v1/admin/webhooks`) for subscription registration, testing, and lifecycle management.
  - Complete API documentation reference guide (`docs/API.md`) detailing authentication, error envelopes, pagination, and all endpoint categories.
- Forms & Submissions Engine:
  - Dynamic forms management (`FormsService`, `/api/v1/forms/*`, `/api/v1/admin/forms/*`) with TypeBox validation, honeypot spam filtering, submission inbox, read receipts, and notification email queue.
- Promotional Banners & Announcements Engine:
  - Banners service (`BannersService`, `/api/v1/banners`, `/api/v1/admin/banners`) with announcement bars, popups, toasts, route targeting, and date scheduling.
- Blog Publishing Engine:
  - Blog module (`BlogService`, `/api/v1/blog/*`, `/api/v1/admin/blog/*`) with articles, categories, tags, auto-computed reading times, draft/scheduled/published statuses, and RSS 2.0 XML feed.
- Ecommerce Catalog & Checkout Engine:
  - Store module (`StoreService`, `/api/v1/store/*`, `/api/v1/admin/store/*`) with product inventory, cart calculation with 18% GST and shipping rules, coupon discount validation (fixed and percentage), order placement, Razorpay HMAC signature verification, cash-on-delivery support, order status workflows, and product reviews with moderation.
- Fundraising & Donations Engine:
  - Donations module (`DonationService`, `/api/v1/donations/*`, `/api/v1/admin/donations/*`) with campaign progress metrics, one-time contributions via Razorpay, anonymous donor privacy masking, and automatic Indian 80G tax receipt issuance.

## [0.2.0] - 2026-10-25T18:30:00+05:30

### Added
- Sub-checkpoint CP-H2.1 (Payments, Orders, Stock Concurrency, Refunds, and Razorpay Webhook Infrastructure):
  - Database schema additions via migration `0005_store_payments_refunds_h2_1`: `payments`, `refunds`, `order_status_history`, `stock_movements`, `payment_webhook_events`.
  - Atomic stock reservation using MySQL conditional updates (`WHERE stock >= qty`) with variant ID sorting to prevent deadlocks and overselling.
  - Pluggable `FulfilmentHandler` registry architecture decoupling physical shipping and digital delivery handlers from core store logic.
  - Monotonic order state machine (`pending` -> `confirmed` -> `processing` -> `fulfilled` / `cancelled` / `refunded` / `partially_refunded`) with transition logging to `order_status_history`.
  - Full and partial refund engine with restock restoration options and automatic status updates (`refunded` vs `partially_refunded`).
  - Webhook processing with HMAC-SHA256 signature verification, event deduplication, and late payment reconciliation.
  - Idempotency key tracking on checkout and refunds.
  - Store contract spec `STORE-01`, `STORE-02`, and `STORE-03` in `docs/ADMIN-UI-CONTRACT.md`.
  - Test suite in `tests/store-h2-1.test.ts` (28 integration tests passing against real MySQL).

## [0.2.1] - 2026-10-25T20:38:00+05:30

### Added
- Sub-checkpoint CP-H2.2 (GST Calculation Engine, Invoicing, Credit Notes, PDF Generation, and COD Rules):
  - Database schema additions via migration `0006_tax_invoices_cod_h2_2`: `tax_classes`, `tax_rules`, `states`, `invoice_sequences`, `invoices`, `credit_notes`.
  - Seeded all 36 Indian states and union territories with 2-digit GST codes and UTGST designations (Chandigarh, Lakshadweep, Ladakh, DNH&DD, Andaman & Nicobar).
  - Dynamic tax engine (`src/modules/store/tax.ts`) supporting regular/composition/unregistered tax regimes, inclusive/exclusive pricing, intrastate CGST/SGST/UTGST splitting, interstate IGST calculation, and CESS.
  - COD rule engine validating pincode serviceability blocklist, min/max order limits, and COD surcharge calculation with 18% service tax.
  - Sequential Indian Financial Year invoice and credit note generation (`INV/YYYY-YY/NNNN`, `CN/YYYY-YY/NNNN`) using `SELECT FOR UPDATE` atomic counters.
  - Automated invoice generation upon payment capture and credit note generation upon refund issuance.
  - Pure JavaScript PDF rendering engine using PDFKit (`src/modules/store/invoice.ts`) generating signed invoices and credit notes.
  - Store endpoints: `POST /api/v1/store/cart/quote`, `GET /api/v1/store/orders/:id/invoice`, `GET /api/v1/store/orders/:id/invoice/pdf`.
  - Admin store endpoints: `GET /api/v1/admin/store/states`, `GET/POST/PUT /api/v1/admin/store/tax-classes`, `GET/PUT /api/v1/admin/store/settings/tax-cod`, `GET /api/v1/admin/store/invoices`, `GET /api/v1/admin/store/invoices/:id`, `GET /api/v1/admin/store/invoices/:id/pdf`, `GET /api/v1/admin/store/credit-notes`, `GET /api/v1/admin/store/credit-notes/:id`, `GET /api/v1/admin/store/credit-notes/:id/pdf`.
  - RBAC permissions: `store.tax.manage` and `store.invoices.view`.
  - Admin UI contract specs `STORE-04`, `STORE-05`, `STORE-06` documented in `docs/ADMIN-UI-CONTRACT.md`.
  - Integration test suite in `tests/store-h2-2.test.ts` (20 integration tests passing against real MySQL).



