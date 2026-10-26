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

## [0.2.2] - 2026-10-25T21:25:00+05:30

### Added
- Sub-checkpoint CP-H2.3 (Shipping & Delivery Module, Partner Adapters, Rates, Zones, AWB Generation, and Live Tracking):
  - Database schema additions via migration `0007_shipping_module_h2_3`:
    - Tables: `shipping_zones`, `shipping_zone_rates`, `shipping_shipments`.
    - Columns added: `weight_grams`, `length_cm`, `width_cm`, `height_cm` on `products` and `product_variants`; `weight_grams` on `order_items`; `shipping_method`, `shipping_carrier`, `shipping_awb`, `tracking_number` on `orders`.
    - Seeded default shipping zone "All India - Standard" with 3 weight-tiered rates and default `shipping_settings` in `settings` table.
  - Partner adapter interface (`ShippingAdapter`) in `src/modules/shipping/adapters/types.ts`:
    - `calculateRates`: computes available rates by weight and order volume.
    - `checkServiceability`: verifies destination pincode, max weight, and COD availability.
    - `createShipment`: manifests shipment and generates carrier AWB & tracking number.
    - `trackShipment`: queries current tracking status and milestone history.
    - `cancelShipment`: voids carrier shipment and manifests cancellation.
    - `getLabel`: generates downloadable shipping and packing slip URLs.
  - Carrier adapter implementations:
    - `ManualFlatRateAdapter`: built-in carrier using configured geographical zone rate tiers.
    - `FakeShippingAdapter`: deterministic offline testing adapter with controllable rate tiers and unserviceable pincodes.
    - `ShiprocketAdapter`: production-ready adapter integrating with Shiprocket REST APIs for rate estimates, custom orders, and AWB assignment.
    - `DelhiveryAdapter`: production-ready adapter integrating with Delhivery Express API surface.
  - Geographical shipping zone engine (`src/modules/shipping/service.ts`) with country, state, and pincode prefix/wildcard pattern matching (`400*`, `110*`).
  - Free shipping cart threshold support (`freeShippingThresholdPaise`), granting 0 paise delivery fee when cart total exceeds threshold.
  - Module disable behaviors: supports configurable `block_physical` (rejects physical product checkout with 422 error) and `fallback_flat_rate` (applies fixed flat rate fee) when `shipping` module is toggled off in `moduleRegistry`.
  - Inbound carrier tracking webhook (`POST /api/v1/shipping/webhook/:partner`): updates shipment milestones, transitions order status to `delivered` and `fulfilled`, and updates line-item `fulfilment_status` to `fulfilled`.
  - Storefront shipping endpoints:
    - `POST /api/v1/shipping/rates`: returns available delivery options and rates for cart items.
    - `POST /api/v1/shipping/serviceability`: checks destination pincode serviceability and COD eligibility.
    - `POST /api/v1/shipping/webhook/:partner`: inbound tracking status updates from carriers.
  - Admin shipping endpoints:
    - `GET /api/v1/admin/shipping/settings`, `PUT /api/v1/admin/shipping/settings`.
    - `GET /api/v1/admin/shipping/zones`, `POST /api/v1/admin/shipping/zones`, `PUT /api/v1/admin/shipping/zones/:id`, `DELETE /api/v1/admin/shipping/zones/:id`.
    - `POST /api/v1/admin/shipping/zones/:id/rates`.
    - `GET /api/v1/admin/shipping/shipments`, `POST /api/v1/admin/shipping/shipments`, `GET /api/v1/admin/shipping/shipments/:id`.
    - `GET /api/v1/admin/shipping/shipments/:id/label`, `POST /api/v1/admin/shipping/shipments/:id/cancel`.
  - RBAC permissions registered: `shipping.view`, `shipping.manage`, `shipping.shipments.manage`.
  - Admin UI contract specs `SHIP-01`, `SHIP-02`, and `SHIP-03` documented in `docs/ADMIN-UI-CONTRACT.md` (contract version bumped to `0.2.2`).
  - Integration test suite in `tests/shipping.test.ts` (16 tests covering zones, rates, serviceability, partner adapters, manifest generation, tracking webhooks, fulfillment transitions, module disable behaviors, and RBAC).

## [0.2.3] - 2026-10-25T21:45:00+05:30

### Added
- Sub-checkpoint CP-H2.3D (Digital Delivery Module: Downloads, License Key Pools, Tokenized Expiration, Download Limits, Entitlements, Auto-Completion, and Refund Revocation):
  - Database schema additions via migration `0008_digital_delivery_h2_3d`:
    - Tables: `digital_assets`, `license_keys`, `digital_entitlements`.
    - Secure indices on `product_id`, `license_key`, `download_token`, `status`, and foreign key cascades to `orders` and `order_items`.
  - Digital Delivery Engine (`src/modules/digital/service.ts`):
    - Cryptographically random download token generation (`dl_<64 hex chars>`).
    - Expiration timestamps (`expires_at`) and download counters (`download_count`, `max_downloads`).
    - Atomic license key reservation and assignment using `SELECT ... FOR UPDATE` row locks.
    - Public license verification engine with format validation, active status check, and tamper resistance.
    - Automatic digital order completion: digital line items are fulfilled on payment confirmation and order status automatically advances to `completed` if all items are digital.
    - Entitlement and license key revocation lifecycle triggered on order refunds via `StoreService.refundOrder`.
  - Storefront and Customer Endpoints:
    - `GET /api/v1/digital/orders/:orderId/entitlements`: customer/guest entitlement retrieval with verified session/guest token.
    - `GET /api/v1/digital/download/:token`: secure tokenized download endpoint streaming assets and enforcing quota/expiry limits.
    - `POST /api/v1/digital/licenses/verify`: public license key verification endpoint.
  - Admin Endpoints:
    - `GET /api/v1/admin/digital/assets`, `POST /api/v1/admin/digital/assets`, `DELETE /api/v1/admin/digital/assets/:id`.
    - `GET /api/v1/admin/digital/licenses`, `POST /api/v1/admin/digital/licenses/pool`.
    - `POST /api/v1/admin/digital/entitlements/:id/revoke`.
  - Module Disabling Behavior:
    - Rejects digital product creation and checkout with 422 error when `digital-delivery` module is disabled.
    - Disables public download and verification routes when module is inactive.
  - RBAC Permissions: `digital.view` and `digital.manage`.
  - Admin UI Contract specs `DIGITAL-01` and `DIGITAL-02` documented in `docs/ADMIN-UI-CONTRACT.md` (contract version `0.2.3`).
  - Integration test suite in `tests/digital-delivery.test.ts` (10 real MySQL tests covering asset creation, license pool loading, digital checkout, entitlement issuance, auto-completion, download quota limits, expiration, public verification, refund revocation, admin manual revocation, and module disablement).

## [0.2.4] - 2026-10-25T22:15:00+05:30

### Added
- Sub-checkpoint CP-H2.4 (Customer Accounts, Profiles, Addresses, Wishlist, Order History, Reorder, Return Requests, DPDP Compliance, and Admin Management):
  - Database schema additions via migration `0009_customer_accounts_h2_4`:
    - Columns added: `phone`, `communication_preferences` (JSON), and `customer_segment` on `users` table.
    - Tables: `customer_addresses`, `customer_wishlist`, `order_return_requests`, `customer_notes`, `customer_data_requests`.
    - Cascade foreign keys to `users`, `orders`, and `products`.
  - Customer Service Engine (`src/modules/store/customer-service.ts`):
    - Profile management: profile retrieval and update, phone, DOB, JSON communication preferences, and spend/order metric aggregation.
    - Password security: `changePassword` verifying current password with Argon2id and invalidating all active sessions on change.
    - Delivery addresses: full CRUD with atomic default address flag toggling across user addresses.
    - Wishlist management: idempotent product saving, removal, and listing joined against live catalog availability and pricing.
    - Order history: paginated order retrieval matching customer ID and email, shipment tracking URLs, invoice numbers, line items, and digital download links.
    - Reorder engine: `prepareReorder` validating current catalog availability, stock levels, and generating checkout-ready payloads.
    - Return request lifecycle: customer submission on delivered/completed physical orders (`submitReturnRequest`), exclusion of digital products, duplicate prevention, and admin approval/rejection state transitions (`adminTransitionReturnRequest`).
    - DPDP Act Compliance: personal data export compiling complete profile, addresses, orders, return requests, reviews, and wishlist; password-verified account deletion anonymizing user record, wiping addresses, wishlist, and active sessions.
    - Donor donation history: `GET /api/v1/donations/my-donations` returning donor contributions, PAN details, and 80G tax exemption receipts.
    - Admin customer directory: paginated customer list with spend metrics, search filter, segment assignment (`standard`, `vip`, `wholesale`, `at_risk`), internal staff notes, and CSV streaming export.
  - Storefront & Customer Endpoints (`src/modules/store/customer-routes.ts`):
    - `GET /api/v1/store/customer/profile`, `PUT /api/v1/store/customer/profile`
    - `POST /api/v1/store/customer/change-password`
    - `GET`, `POST /api/v1/store/customer/addresses`, `PUT`, `DELETE /api/v1/store/customer/addresses/:id`, `POST /api/v1/store/customer/addresses/:id/default`
    - `GET`, `POST /api/v1/store/customer/wishlist`, `DELETE /api/v1/store/customer/wishlist/:productId`
    - `GET /api/v1/store/customer/orders`, `GET /api/v1/store/customer/orders/:id`
    - `POST /api/v1/store/customer/orders/:id/reorder`
    - `POST /api/v1/store/customer/orders/:id/return-request`, `GET /api/v1/store/customer/return-requests`
    - `POST /api/v1/store/customer/export-data`, `POST /api/v1/store/customer/delete-account`
    - `GET /api/v1/donations/my-donations`
  - Admin Endpoints (`src/modules/store/customer-routes.ts`):
    - `GET /api/v1/admin/store/customers`, `GET /api/v1/admin/store/customers/export`, `GET /api/v1/admin/store/customers/:id`
    - `PUT /api/v1/admin/store/customers/:id/segment`, `POST /api/v1/admin/store/customers/:id/notes`
    - `GET /api/v1/admin/store/return-requests`, `POST /api/v1/admin/store/return-requests/:id/transition`
  - RBAC Permissions: `store.customers.view` and `store.customers.manage`.
  - Admin UI Contract spec `STORE-07` documented in `docs/ADMIN-UI-CONTRACT.md` (contract version `0.2.4`).
  - Integration test suite in `tests/customer-accounts.test.ts` (12 real MySQL tests covering profile updates, password change, address CRUD, default toggles, wishlist, order history, reorder validation, return requests, DPDP export, DPDP deletion, admin directory, CSV export, and RBAC security).

## [0.2.5] - 2026-10-26T10:45:00+05:30

### Added
- Sub-checkpoint CP-H2.5 (Admin Operations, Observability & Structured Data JSON-LD):
  - Dashboard Service & API (`src/modules/dashboard/service.ts`, `src/routes/admin/dashboard.ts`):
    - `GET /api/v1/admin/dashboard/stats`: consolidated administrative metrics computing total orders, revenue in paise, pending orders, average order value, product counts, low-stock threshold count, customer segment breakdown (standard, vip, wholesale), content pages and articles count, donation totals, and runtime memory/uptime. Guarded by `core.dashboard.view`.
  - System Observability & Error Logs API (`src/routes/admin/logs.ts`):
    - `GET /api/v1/admin/logs/system`: process memory statistics (rss, heapTotal, heapUsed, external), cpu usage microseconds, node and architecture environment, database connection pool, and background job counts (pending, completed, failed). Guarded by `core.logs.view`.
    - `GET /api/v1/admin/logs/errors`: unified error logs across failed background jobs and failed email dispatches with pagination and source filtering (`all`, `jobs`, `email`). Guarded by `core.logs.view`.
  - Email Logs & Automation Triggers (`src/routes/admin/email.ts`):
    - Plural route aliases `GET /api/v1/admin/email/logs` and `POST /api/v1/admin/email/logs/:id/resend`.
    - Automated event email configuration `GET /api/v1/admin/email/automation` and `PATCH /api/v1/admin/email/automation/:event` enabling/disabling automated notifications and updating default subject lines.
  - Schema.org JSON-LD Generation Engine (`src/content/seo.ts`, `src/routes/content.ts`):
    - `generateJsonLd` supporting Schema.org Organization, WebSite (with SearchAction), NewsArticle, Product (price formatted in Rupees from stored paise, in-stock/out-of-stock availability schema), and BreadcrumbList graphs.
    - Public REST endpoints `GET /api/v1/seo/jsonld/:type` and `GET /api/v1/seo/jsonld/:type/:idOrSlug` with `application/ld+json` MIME header.
  - Admin UI Contract specs `DASH-01`, `LOGS-01`, and `SEO-02` documented in `docs/ADMIN-UI-CONTRACT.md` (contract version `0.2.5`).
  - Integration test suite in `tests/dashboard-logs-seo.test.ts` (11 real MySQL tests covering dashboard stats, system logs, error logs, email logs, automation triggers, and JSON-LD schema generation for Organization, WebSite, Product, Article, and BreadcrumbList).



