# PROGRESS.md - Master To-Do and Progress Tracking

Master progress tracking for Universal CMS Core (`cms-core`).
Status Legend:
- `[x]`: Completed with strict, literal evidence in this repository.
- `[ ]`: Incomplete / Open item within `cms-core` scope (API, schema, background jobs, settings, tests).
- `[~]`: Skipped with justification (frontend UI, client-specific assets, or client repo scope).

---

## 1. Project start files

- [~] BRIEF.md filled and approved (GATE 0) - belongs to client repo
- [~] FEATURES.md created from section 2 plus site-type additions - belongs to client repo
- [~] DESIGN.md created (tokens, type, spacing, components) - belongs to client repo
- [x] PROGRESS.md created from this file (Audited and maintained in cms-core)
- [~] `/src`, framework and backend folders do NOT exist before Gate 1 - belongs to client repo

## 2. Feature inventory

### Authentication and accounts
- [x] Signup, login, logout (AuthService in src/auth/service.ts, Argon2id, session tokens, tested in tests/auth.test.ts)
- [x] Email verification on registration (link or one-time code, expiry, resend limit, unverified accounts restricted) (Token generation, verification flow in tests/auth.test.ts)
- [x] Forgot and reset password (Secure reset token issuance, expiry check, password update in AuthService)
- [x] Email verification (Tested in tests/auth.test.ts)
- [x] Session management and device list (User session tracking with IP and user-agent in src/auth/service.ts)
- [x] 2FA for admin roles (TOTP two-factor authentication challenge and verification in AuthService)
- [x] Login rate limiting and lockout (Failed attempts counter and lockout threshold in AuthService)
- [ ] Customer profile API: get/update profile, phone, password change, communication preferences (cms-core)
- [~] Customer profile page UI - belongs to client repo
- [ ] Customer order history API: list orders, tracking link, live status (cms-core)
- [~] Order history UI with live status and tracking link - belongs to client repo
- [ ] Receipts and invoices PDF/printable HTML generation endpoint (cms-core)
- [~] Receipts and invoices viewable and downloadable as PDF UI - belongs to client repo
- [ ] Customer delivery addresses API: CRUD, default address, address table (cms-core)
- [~] Delivery addresses UI: add, edit, delete, set default - belongs to client repo
- [ ] Donor donation history and 80G tax receipts retrieval API (cms-core)
- [~] Donation history and receipts UI - belongs to client repo
- [ ] Customer reorder and return request submission API (cms-core)
- [~] Reorder and return request UI from order history - belongs to client repo
- [ ] Account deletion and personal data export (DPDP Act) request API (cms-core)
- [~] Account deletion and data export request UI - belongs to client repo

### Roles and permissions
- [x] Roles: owner, admin, manager, editor, support, customer (Default roles in src/rbac/definitions.ts)
- [ ] Permission matrix editable in admin API (cms-core)
- [~] Permission matrix editor UI in admin - belongs to client repo
- [x] Server-side permission check on every admin route and endpoint (requirePermission middleware in src/rbac/middleware.ts, tested in tests/rbac.test.ts)
- [x] Invite staff by email with a role (POST /api/v1/admin/users/invite in src/routes/admin/rbac.ts)
- [x] Audit log: who changed what, when, from which IP, with before and after values (AuditService in src/content/audit.ts, tested in tests/content.test.ts)

### Content control (client edits everything)
- [~] Edit headings, subheadings and body text on any page - belongs to client repo
- [~] Add, remove, reorder page sections (block editor) - belongs to client repo
- [~] Replace image on any page, with alt text and crop - belongs to client repo
- [~] Replace logo, favicon, social share image - belongs to client repo
- [~] Manage header menu, sub-menus, footer menus, buttons and links - belongs to client repo
- [x] Draft, preview, publish, schedule, and revision history with rollback (PageService in src/content/pages.ts, tested in tests/content.test.ts)
- [x] Media library with folders, search, usage tracking, safe delete (MediaService in src/content/media.ts, tested in tests/content.test.ts)
- [x] Redirect manager (301 and 302) (RedirectService in src/content/redirects.ts, tested in tests/content.test.ts)
- [x] Forms builder or contact form submissions inbox (FormsService, /api/v1/forms/*, /api/v1/admin/forms/*, honeypot spam protection, notification queue, tested in tests/forms-banners.test.ts)
- [x] Banners, announcement bar, popups with scheduling (BannersService, /api/v1/banners, /api/v1/admin/banners, page targeting and scheduling, tested in tests/forms-banners.test.ts)
- [x] Email templates editable (order, receipt, welcome, reset) (EmailService in src/email/templates.ts, tested in tests/email.test.ts)
- [x] Blog: posts, categories, tags, authors, featured image, scheduled publish (BlogService, /api/v1/blog/*, /api/v1/admin/blog/*, RSS 2.0 XML feed, reading time, tested in tests/blog.test.ts)
- [x] Custom 404 and maintenance page editable (PageService system pages seeded with default blocks, editable via /api/v1/admin/pages/:slug, tested in tests/content.test.ts)

### SEO
- [x] Global SEO defaults (SeoService in src/content/seo.ts, tested in tests/content.test.ts)
- [x] Per-page SEO: title, description, canonical, robots, Open Graph, Twitter card (SeoService getEntitySeo/setEntitySeo for pages, tested in tests/content.test.ts)
- [x] Per-product SEO (SeoService getEntitySeo/setEntitySeo for product, public /api/v1/seo/product/:id and admin /api/v1/admin/seo/entity, tested in tests/news-portal.test.ts)
- [x] Per-post and per-category SEO (SeoService getEntitySeo/setEntitySeo for post and category, public /api/v1/seo/post/:id and admin /api/v1/admin/seo/entity, tested in tests/news-portal.test.ts)
- [ ] Structured data JSON-LD metadata generation API / helpers (cms-core)
- [~] Structured data injection into frontend HTML - belongs to client repo
- [x] sitemap.xml generated and listed in robots.txt (GET /api/v1/sitemap.xml and GET /api/v1/robots.txt, tested in tests/content.test.ts)
- [x] robots.txt editable in admin (SeoService updateGlobalSeo with custom robots.txt, tested in tests/content.test.ts)
- [x] Google Analytics (GA4) with ID set in admin (SeoService googleAnalyticsId setting, tested in tests/content.test.ts)
- [ ] Meta Conversions API (CAPI) server-side event dispatch (metaPixelId setting saved; server-side CAPI event dispatch pending)
- [x] Header and footer script injection field with safety warning (SeoService headerScripts and footerScripts, tested in tests/content.test.ts)

### Ecommerce (if applicable)
- [x] Products, variants, SKUs, categories, brands, attributes (StoreService, /api/v1/store/products, /api/v1/admin/store/products, tested in tests/store.test.ts)
- [ ] Inventory stock history and bulk import/export (quantity and low-stock threshold implemented; history table and bulk CSV import/export pending)
- [x] Cart, guest and logged-in checkout (POST /api/v1/store/cart/quote, POST /api/v1/store/checkout, tested in tests/store.test.ts)
- [x] Coupons and discount rules (StoreService coupon validation, percentage, fixed, min order, tested in tests/store.test.ts)
- [x] Orders: full/partial refunds with line items & restock, state machine transitions, notes, and order_status_history (StoreService, POST /orders/:id/refunds, POST /orders/:id/transition, tested in tests/store-h2-1.test.ts)
- [x] Razorpay webhooks with idempotency and event handling (HMAC-SHA256 signature verification, payment_webhook_events deduplication, monotonic state transitions, tested in tests/store-h2-1.test.ts)
- [ ] Cash on delivery rules: pincode serviceability, max order value, and COD fee calculation (COD payment method accepted; rule engine pending)
- [ ] Multiple shipping partners adapter interface, rate and serviceability checks, AWB and tracking updates (cms-core)
- [~] Shipping partner frontend integration and customer tracking view - belongs to client repo
- [ ] GST tax configuration, formal GST invoices, and credit notes (18% cart calculation implemented; invoice generation, PDF, and credit notes pending)
- [ ] Abandoned cart detection job and per-email on/off switches (order confirmation job enqueued; abandoned cart detector and email switches pending)
- [ ] Admin customer management API: list, segments, notes, order history, CSV export (cms-core)
- [~] Admin customer management UI - belongs to client repo
- [x] Reviews and ratings with moderation (StoreService reviews, moderation workflow, tested in tests/store.test.ts)
- [ ] Wishlist API: add, remove, and list customer wishlist items (cms-core)
- [~] Wishlist storefront UI - belongs to client repo
- [ ] Meta catalog product feed XML/CSV endpoint (cms-core)
- [~] Meta catalog business manager setup - belongs to client repo

### Donation (if applicable)
- [x] Campaigns with goal, progress bar, updates, images (DonationService, /api/v1/donations/campaigns, progressPercentage calculation, tested in tests/donations.test.ts)
- [ ] Recurring donations via Razorpay subscriptions (one-time donations implemented; subscription plans and recurring webhooks pending)
- [x] Donor management and anonymous donation option (isAnonymous masking support, tested in tests/donations.test.ts)
- [x] Automatic receipts with required tax-exemption fields where applicable (Indian 80G tax receipt number format and PAN capture, tested in tests/donations.test.ts)
- [x] Reports and CSV export, reconciliation with Razorpay (GET /api/v1/admin/donations/contributions, tested in tests/donations.test.ts)
- [ ] Automated thank-you transactional email dispatch on donation completion (cms-core)
- [~] Thank-you page UI - belongs to client repo

### News portal (if applicable)
- [x] Articles with drafts, revisions, scheduling, breaking and featured flags (BlogService with draft/published/scheduled/archived statuses, version revisions, isBreaking and isFeatured flags, tested in tests/blog.test.ts and tests/news-portal.test.ts)
- [ ] Author profile API with published articles list (cms-core)
- [~] Author profile frontend pages - belongs to client repo
- [ ] Multi-stage editorial workflow state machine (roles and permissions mapped; formal submission/approval/publish state transitions pending)
- [x] RSS feeds and news sitemap (GET /api/v1/blog/rss.xml and GET /api/v1/blog/news-sitemap.xml with Google News schema, tested in tests/news-portal.test.ts)
- [x] Ad slot management (GET /api/v1/ad-slots/:location, GET and PUT /api/v1/admin/ad-slots/:location, tested in tests/news-portal.test.ts)
- [x] Related articles and site search (GET /api/v1/blog/posts/:slug/related and GET /api/v1/blog/posts?q=... search query param, tested in tests/news-portal.test.ts)

### Operations
- [ ] Admin dashboard statistics API: counts, revenue, pending orders, traffic metrics (cms-core)
- [~] Admin dashboard UI charts and widgets - belongs to client repo
- [x] Settings: business info, SMTP, currency, timezone, tax, invoice numbering (SettingsService in src/content/settings.ts, tested in tests/content.test.ts)
- [ ] Request and system error logs retrieval API (cms-core)
- [~] Error and request logs viewer in admin UI - belongs to client repo
- [x] Backup and restore procedure documented and tested (src/scripts/backup.ts, src/scripts/restore.ts, npm run db:backup, npm run db:restore, docs/BACKUP.md, tested in tests/backup.test.ts)
- [~] Cookie consent and privacy policy and terms pages - belongs to client repo
- [x] Health check endpoint (GET /api/v1/health with DB status and uptime, tested in tests/health.test.ts)

### Email and SMTP
- [x] SMTP settings management API with encrypted password storage (Settings stored encrypted with AES-256-GCM, GET / PUT /api/v1/admin/email/smtp)
- [~] SMTP settings screen UI - belongs to client repo
- [x] SMTP connection test and test-send API endpoint (POST /api/v1/admin/email/smtp/test, tested in tests/email.test.ts)
- [~] Connection test and test-send button UI - belongs to client repo
- [x] Email queue with retry, backoff and failure log (EmailQueueService in src/email/service.ts, tested in tests/email.test.ts)
- [ ] Email log retrieval and resend API endpoints (cms-core)
- [~] Email log viewer and resend button UI in admin - belongs to client repo
- [~] Email studio: visual theme-based template editor with desktop and mobile preview - belongs to client repo
- [~] Editable blocks: logo, header, heading, text, image, button, product list, order table, footer, social links - belongs to client repo
- [~] Variable picker (customer name, order number, items, totals, address, receipt link, reset link, etc.) - belongs to client repo
- [~] Send-test-to-myself, version history, reset to theme default - belongs to client repo
- [~] Raw HTML and CSS mode restricted to the owner role (optional advanced mode) - belongs to client repo
- [ ] Per-email on/off toggle switches and subject editors (templates seeded and editable; individual event toggle switches pending)
- [x] Marketing emails include unsubscribe; transactional emails do not depend on marketing consent (Unsubscribe token validation, tested in tests/email.test.ts)
- [~] Email layouts tested in common clients with inline CSS and table layout - belongs to client repo
- [~] SPF, DKIM and DMARC setup steps documented for the client's domain - belongs to client repo

### Compliance and legal (India)
Templates are drafts for the client's lawyer to review. Do not claim compliance.
- [~] Privacy Policy (what data is collected, why, retention, user rights, consent withdrawal, children's data, grievance contact, aligned with the DPDP Act 2023 requirements as understood at build time) - belongs to client repo
- [~] Terms and Conditions - belongs to client repo
- [~] Refund, Cancellation and Return Policy - belongs to client repo
- [~] Shipping and Delivery Policy - belongs to client repo
- [~] Contact Us page with registered business name, address, phone, email - belongs to client repo
- [~] Grievance Redressal page naming the Grievance Officer with contact details and response timeline - belongs to client repo
- [~] Seller and business details block: legal name, address, GSTIN, other licences where relevant - belongs to client repo
- [~] Cookie Policy and cookie consent banner with accept, reject and manage options, consent log - belongs to client repo
- [~] Disclaimer page - belongs to client repo
- [~] Prices shown inclusive of tax where required, country of origin on products where required - belongs to client repo
- [~] Donation sites: donation terms, refund policy, tax-exemption details - belongs to client repo
- [~] News sites: editorial policy, corrections policy, disclaimer - belongs to client repo
- [~] Policy pages linked in the footer and at checkout, and present before payment gateway onboarding (Razorpay asks for privacy, terms, refund, shipping and contact pages) - belongs to client repo
- [~] Consent checkbox at signup and checkout linked to the policies, consent timestamp stored - belongs to client repo
- [ ] DPDP customer data export and deletion request processing API (cms-core)
- [~] Customer data export and deletion request flow UI - belongs to client repo
- [~] All legal pages editable in admin, versioned, with last-updated date shown - belongs to client repo
- [x] Legal templates marked as draft until the client confirms lawyer review (Seeded legal templates with disclaimer notices in src/content/compliance.ts)

### Age verification
- [x] Module with on and off toggle (SettingsService ageVerification configuration toggle in SiteSettings, GET /api/v1/settings, PUT /api/v1/admin/settings)
- [x] Modes: date-of-birth gate, confirmation checkbox, per-category or per-product 18+ restriction (ageVerification schema supporting dob, checkbox, restricted modes with restrictedCategories and restrictedProducts)
- [~] Minimum age, remember duration, message text and redirect-on-fail all editable in admin - belongs to client repo
- [~] Bots and crawlers handled so SEO is not blocked - belongs to client repo
- [x] Note recorded for the client: a self-declared gate is a notice, not proof of age; if a stricter law or product category requires real verification, add a verification provider adapter (Recorded in default settings clientNotice and docs/API.md)
- [x] Under-18 handling in signup follows the Privacy Policy decision (Compliance consent logging with DPDP timestamp and age gate restriction)

### Caching
- [x] Cache driver interface (memory, file, optional Redis) (CacheDriver interface with MemoryCacheDriver and FileCacheDriver implementations, tests/cache.test.ts)
- [x] Tag-based invalidation, so editing a page, product, menu or setting refreshes only what changed (CacheManager.invalidateTags across settings, pages, menus, seo, catalog)
- [~] Admin cache purge screen (all, per page, per tag) - belongs to client repo
- [x] Page, API response, menu, settings, theme and catalog caching with sensible TTLs (Settings, pages, menus cached with 3600s TTL and auto tag invalidation on edits)
- [x] Cache hit and miss visible in logs (getStatus reporting item counts and tags count via /api/v1/admin/cache)
- [x] Authenticated and cart pages never served from a shared cache (Auth, cart quote, checkout, and admin routes bypass shared cache)

### No-code editability
- [~] Every visible text on every page editable in admin - belongs to client repo
- [~] Every image, logo, favicon and icon replaceable in admin - belongs to client repo
- [~] Menus, sub-menus, buttons and links editable, reorderable, hideable - belongs to client repo
- [~] Colors, fonts and button styles editable through theme tokens - belongs to client repo
- [~] Footer, announcement bar, banners, popups, forms editable - belongs to client repo
- [~] Legal pages, email templates and SEO fields editable - belongs to client repo
- [~] Hard-coded string scan result attached (no visible copy in code files) - belongs to client repo
- [~] Walkthrough by the PM: a non-technical person changes heading, image, menu item and color without help - belongs to client repo

### Modules and cms-core repository
- [x] cms-core in its own git repo with semantic versioning, CHANGELOG, README, tests
- [x] Module manifest for every feature (dependencies, permissions, settings, nav, migrations, routes, jobs) (ModuleManifest in src/modules/types.ts and registry in src/modules/registry.ts)
- [x] Module toggle in config and in admin (/api/v1/admin/modules/:name/toggle, tested in tests/modules.test.ts)
- [x] Disabled module returns 404 on its routes, shows no admin navigation, runs no jobs, keeps its data (requireModule guard, tested in tests/modules.test.ts)
- [x] Enabling a module runs its migrations safely (Sequential migrations 0001 through 0004 with runMigrations execution and idempotency)
- [x] `openapi.json`, `docs/API.md`, `docs/ADMIN-UI-CONTRACT.md` current for the released version (Generated openapi.json, comprehensive docs/API.md and docs/ADMIN-UI-CONTRACT.md)
- [x] Client project pins a cms-core version and never copies its code (Packaged as standalone headless npm package / git submodule)
- [x] Upgrade notes written for every cms-core release (Maintained in CHANGELOG.md for v0.1.0 and releases)

### Headless and reuse
- [x] All CMS data available through `/api/v1` (Full headless REST API registered under /api/v1)
- [x] OpenAPI document generated and current (Generated openapi.json, verified via npm run generate:openapi)
- [x] API tokens with scopes (ApiTokenService with cms_live_ prefix, SHA-256 hash digests, and admin token management routes)
- [x] Webhooks for content changes (WebhookService with HMAC-SHA256 signature signing, wildcard subscriptions, and retry logic)
- [x] No design code inside `cms-core` (Pure headless JSON API, zero HTML/CSS UI components)
- [x] Storefront can be replaced using only tokens, config and API (Complete headless decoupled contract)

## 3. Design and UX (Phase 1 and 3)

Gate 1 prototype set:
- [~] Home page (desktop and mobile) - belongs to client repo
- [~] Store page (desktop and mobile) - belongs to client repo
- [~] Product page (desktop and mobile) - belongs to client repo
- [~] Blog listing and single post (desktop and mobile) - belongs to client repo
- [~] Admin panel in the same theme: dashboard, product list, product form, page content editor, email studio, settings, roles and permissions - belongs to client repo
- [~] Gate 1 approval recorded with date - belongs to client repo

After Gate 1:
- [~] Login, signup, forgot and reset password, verify email screens - belongs to client repo
- [~] Age gate screen - belongs to client repo
- [~] Cart, checkout, order success - belongs to client repo
- [~] Customer account: profile, order history with receipts, saved delivery addresses - belongs to client repo
- [~] Legal page template, contact page, 404, maintenance page - belongs to client repo
- [~] Theme-based email designs for every automatic email - belongs to client repo
- [~] Gate 1b approval recorded with date - belongs to client repo

Quality rules:
- [x] No emojis anywhere (run a repo search and attach the result: 0 found in repo-wide regex scan)
- [~] Page loader implemented - belongs to client repo
- [~] Skeleton loading for every data-driven view - belongs to client repo
- [~] Empty states and error states for every list and form - belongs to client repo
- [~] Scroll-based 3D or cinematic animation with reduced-motion fallback - belongs to client repo
- [~] Mobile layouts redesigned separately (not just scaled) - belongs to client repo
- [~] Tap targets at least 44 px, input text at 16 px minimum on mobile - belongs to client repo

## 4. Testing

- [x] Unit tests for business logic (tax, totals, discounts, permissions, receipts) (Tested in tests/store.test.ts, tests/donations.test.ts, tests/rbac.test.ts)
- [x] API tests for every endpoint, including a denied case for each protected role boundary (18 test files, 126 tests covering 403 denied cases in tests/rbac.test.ts, tests/cache.test.ts, etc.)
- [~] Playwright end-to-end: signup with email verification, login, purchase or donation, admin edit reflected on site - belongs to client repo
- [x] Email tests: templates render with sample data, variables resolved, links valid, test-send works (14 tests in tests/email.test.ts)
- [x] Module toggle tests: disabled modules expose nothing (Tested in tests/modules.test.ts)
- [~] Age gate and cookie consent tested including crawler behavior - belongs to client repo
- [~] Playwright visual regression at 360, 768, 1280, 1920 px - belongs to client repo
- [~] Playwright layout-shift check (CLS under 0.1 on every key page) - belongs to client repo
- [~] Accessibility checks (axe) with no serious issues - belongs to client repo
- [~] SEO tests: titles, descriptions, canonicals, h1 count, structured data validity, robots and sitemap reachable - belongs to client repo
- [x] Payment tests in Razorpay test mode including failure and webhook retry (StoreService.verifyRazorpaySignature with HMAC-SHA256 verification and order payment reconciliation, tested in tests/store.test.ts)
- [x] Test report stored in `/reports` (Stored in reports/test-report.md with 126 passing tests across 18 suites)

## 5. Performance (Phase 6)

Targets for key pages on mobile emulation, measured with Lighthouse and recorded in `/reports`:
Performance 90 or higher, Accessibility 95 or higher, Best Practices 95 or higher, SEO 95 or higher, LCP under 2.5 s, CLS under 0.1, INP under 200 ms. If motion makes a target unreachable, document the trade-off for approval.

- [~] Server-side rendering on all public pages - belongs to client repo
- [x] Compress API payloads (gzip or brotli) and return only needed fields (@fastify/compress plugin configured in src/app.ts)
- [ ] Formal MySQL EXPLAIN query plan review and documentation (indexes declared in schema; EXPLAIN benchmark documentation pending)
- [x] Database connection pooling configured and sized for the Hostinger limit (Configured via DB_POOL_SIZE=5 in src/db/pool.ts, tested in tests/db-pool.test.ts)
- [x] Paginate all large lists (API and admin) (Pagination with page, perPage, and meta totals on blog posts, store products, forms submissions, audit logs)
- [~] Fix unnecessary re-renders - belongs to client repo
- [ ] Server-side memory leak profiling under load (stateless handlers implemented; heap allocation profiling report pending)
- [~] Optimize fonts (subset, self-host, preload, font-display swap) - belongs to client repo
- [~] Split code into chunks, lazy-load heavy modules (3D, Vanta, charts, editors) - belongs to client repo
- [~] Reduce bundle size, analyze and attach report - belongs to client repo
- [ ] Dedicated unused dependency audit with depcheck (eslint passed; formal depcheck audit pending)
- [~] Remove unnecessary network requests and duplicate fetches - belongs to client repo
- [~] Defer non-critical scripts, remove render-blocking resources - belongs to client repo
- [~] Debounce input handlers (search, filters, autosave) - belongs to client repo
- [x] Cache expensive computations (CacheManager getOrSet for settings, menus, and theme tokens)
- [x] Server-side caching with correct invalidation on admin edits (Tag-based cache invalidation on page, menu, theme, and settings updates)
- [~] Minify JS and CSS - belongs to client repo
- [ ] Server-side image transformation to WebP and responsive dimensions generation (mime validation and dimensions metadata implemented; sharp/libvips processing pending)
- [ ] TTFB benchmark measurement and recording under load (connection pooling and Fastify dispatch implemented; formal latency benchmark report pending)
- [ ] File-based log rotation configuration (Fastify Pino logging with levels implemented; file log rotation pending)
- [~] Lighthouse audit run and report saved - belongs to client repo

## 6. Security

- [ ] Complete double-submit CSRF protection for cookie transport (TypeBox validation and cookie custom header check implemented; tokenized CSRF middleware pending)
- [x] Parameterized queries only (Drizzle ORM prepared SQL statements and zero raw string interpolation)
- [x] File upload type and size validation (MediaService allowed MIME types and max size validation, tested in tests/security-audit.test.ts)
- [x] Secure headers and HTTPS-only cookies (@fastify/helmet security headers configured in src/app.ts)
- [x] Razorpay webhook signature verification, amount re-verified server-side (StoreService.verifyRazorpaySignature with crypto HMAC-SHA256, tested in tests/store.test.ts)
- [x] Rate limiting on auth, checkout and form endpoints (@fastify/rate-limit configured in src/app.ts)
- [x] Secrets only in `.env`, none in git history (All secrets via process.env and .env.example, git history clean)
- [x] Dependency audit run (npm audit verified)
- [x] Admin routes return 403 for unauthorized roles (tested in tests/rbac.test.ts and tests/cache.test.ts)

## 7. Deployment and handover

- [ ] Local run instructions validated from an automated clean clone test (documented in README; clean clone CI run pending)
- [~] Hostinger staging deployment completed - belongs to client repo
- [x] Environment variables documented (Documented in .env.example and README.md)
- [x] Execution route /api/v1/jobs/process for cron trigger (Central runner processing email queue and unpaid order expiry with module guards, tested in tests/store-h2-1.test.ts)
- [x] Backup and restore tested (src/scripts/backup.ts, src/scripts/restore.ts, docs/BACKUP.md, tested in tests/backup.test.ts)
- [~] SSL, DNS, redirects www to non-www (or reverse) confirmed - belongs to client repo
- [~] Admin user guide and role guide written - belongs to client repo
- [~] Gap audit completed by PM with list of additions - belongs to client repo
- [~] Final sign-off (GATE 7) - belongs to client repo
