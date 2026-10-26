# Test Execution Report

Date: 2026-10-26
Test Framework: Vitest 2.1.9
Runtime: Node.js 22 LTS
Target: cms-core Headless API Engine
Status: PASS (257 passed, 0 failed)

## Summary

- Total Test Suites: 27
- Total Tests: 257
- Passed: 257
- Failed: 0
- Skipped: 0
- Code Coverage Target: Met (>90% on core business logic, schema, rbac, store, digital, shipping, accounts, observability, feeds, recurring donations, author profiles, editorial workflow, and auth)

## Test Suites Breakdown

1. tests/db-pool.test.ts (3 passed)
   - Connection pool sizing for Hostinger shared limits (default pool size 5)
   - Health check ping execution
   - Clean connection release on query completion

2. tests/backup.test.ts (3 passed)
   - Schema and table data extraction via db:backup
   - Database restore parsing and batch execution
   - Automated error recovery on connection drop

3. tests/crypto.test.ts (2 passed)
   - Password hashing and constant-time verification with Argon2id
   - Token entropy and SHA-256 hash digests

4. tests/schema.test.ts (3 passed)
   - Drizzle schema validation across all tables
   - Sequential migration execution (0001 through 0004)
   - Foreign key integrity and constraint declarations

5. tests/modules.test.ts (6 passed)
   - Core vs optional module categorization
   - Module manifest registration and status endpoints
   - 404 MODULE_DISABLED enforcement for deactivated modules
   - Dependency hierarchy enforcement (cannot enable store without media)

6. tests/cache.test.ts (8 passed)
   - MemoryCacheDriver set, get, TTL expiry, and tag invalidation
   - FileCacheDriver persistence to disk and status reporting
   - CacheManager getOrSet atomic factory execution
   - Admin cache purge routes (/api/v1/admin/cache/purge) with RBAC permissions

7. tests/news-portal.test.ts (6 passed)
   - Public ad slot retrieval by location (/api/v1/ad-slots/:location)
   - Admin ad slot creation, updating, and HTML snippet validation
   - Google News compliant XML sitemap generation (/api/v1/blog/news-sitemap.xml)
   - Related articles resolution (/api/v1/blog/posts/:slug/related)
   - Headless entity SEO resolution (/api/v1/seo/:entityType/:entityId)

8. tests/rbac.test.ts (6 passed)
   - Role-based access control middleware (requirePermission)
   - Wildcard permission expansion for owner role
   - 403 Forbidden enforcement on role boundary violations
   - Role-filtered admin navigation bar resolution

9. tests/health.test.ts (3 passed)
   - GET /api/v1/health status 200 standard response envelope
   - Database connection status and pool metrics
   - System uptime and timestamp accuracy

10. tests/tokens-webhooks.test.ts (10 passed)
    - API Token generation with cms_live_ prefix and SHA-256 hash storage
    - Scope authorization for headless API consumers
    - Webhook registration, event filtering, and secret token signing
    - HMAC-SHA256 signature header generation and wildcard event matching

11. tests/blog.test.ts (6 passed)
    - Blog post draft, published, and scheduled lifecycles
    - Version history and revision increments
    - Reading time calculation based on word count
    - Public RSS 2.0 XML feed generation (/api/v1/blog/rss.xml)

12. tests/donations.test.ts (7 passed)
    - Campaign goal tracking and percentage calculation
    - Donation processing with anonymous masking support
    - Indian 80G tax receipt number generation (80G-YYYY-XXXXXX)
    - PAN number format validation and receipts record keeping

13. tests/store.test.ts (9 passed)
    - Product catalog filtering by category, brand, and search
    - Inventory level deduction and low-stock detection
    - Cart calculation with Indian GST 18% tax and shipping rules
    - Coupon validation (percentage, fixed, minimum order values)
    - Razorpay payment signature verification (HMAC-SHA256)
    - Customer review submission and admin moderation

14. tests/forms-banners.test.ts (8 passed)
    - Honeypot spam field detection (_hp) rejecting spam bots
    - Form submission validation against dynamic JSON schema
    - Admin submissions inbox with IP and user-agent logging
    - Banner targeting by route path and scheduling date range

15. tests/email.test.ts (14 passed)
    - Welcome, verification, password reset, order, and receipt email templates
    - Variable substitution engine with fallback defaults
    - Unsubscribe token generation and public one-click unsubscribe
    - Transactional vs marketing email separation

16. tests/content.test.ts (18 passed)
    - Public theme design tokens (/api/v1/theme)
    - Page publication status and revision rollback
    - Seeding of customizable 404 and maintenance system pages
    - Dynamic XML sitemap generation (/api/v1/sitemap.xml)
    - Public robots.txt retrieval with crawl instructions
    - 301 and 302 URL redirect resolution
    - DPDP Act compliant cookie consent storage

17. tests/auth.test.ts (7 passed)
    - User registration with email verification requirement
    - Password login, session issuance, and device logging
    - Rate limiting and failed attempt lockout
    - TOTP two-factor authentication (2FA) verification for admin roles
    - Secure session revocation and logout

18. tests/security-audit.test.ts (7 passed)
    - Defense against client-side price tampering (CWE-472)
    - Stock quantity and inventory limit enforcement
    - Numeric 6-digit verification code user binding
    - File upload MIME type and maximum size constraints (CWE-434)
    - Prevention of self-referential redirect loops (CWE-601)
    - Scoped Bearer API token authorization (cms_live_)

19. tests/store-h2-1.test.ts (28 passed)
    - Atomic stock reservation and decrement during checkout
    - Razorpay payment capture and webhook idempotency
    - State machine transitions (pending_payment, confirmed, processing, shipped, delivered, cancelled)
    - Full and partial refunds with inventory restock
    - Order internal staff notes and status change audit ledger
    - Background job for expired unpaid order stock release

20. tests/store-h2-2.test.ts (20 passed)
    - Indian GST 36 states and union territories calculation
    - CGST, SGST, UTGST, IGST, and GST Compensation CESS splitting
    - Indian Financial Year sequential invoice and credit note issuance
    - PDFKit streaming generation for tax invoices and credit notes
    - Cash on Delivery (COD) serviceability, max order limits, and fee calculation

21. tests/shipping.test.ts (16 passed)
    - Tiered weight shipping zones and destination matching
    - Multi-carrier adapter interface (Manual, Fake, Shiprocket, Delhivery)
    - Rate calculation, free shipping thresholds, and serviceability checks
    - Waybill (AWB) generation, shipment manifestation, and cancellation
    - Inbound status tracking webhooks with auto-fulfillment on delivery

22. tests/digital-delivery.test.ts (10 passed)
    - Digital asset management and file attachment
    - License key pooling with atomic reservation via SELECT FOR UPDATE
    - Tokenized secure downloads with expiry and max download limit
    - Customer order entitlements retrieval and public license validation
    - Automatic license key and download revocation on order refund

23. tests/customer-accounts.test.ts (12 passed)
    - Customer profile retrieval, contact updates, and communication preferences
    - Password change with Argon2id re-hashing and session invalidation
    - Saved addresses CRUD with single default address constraint
    - Wishlist management and order history inspection
    - Reorder stock verification and return request submission
    - DPDP Act personal data export and account erasure

24. tests/dashboard-logs-seo.test.ts (11 passed)
    - Administrative consolidated dashboard metrics (revenue, orders, catalog, segments, content, system)
    - System runtime diagnostics, memory statistics, and process uptime
    - Unified error logs across background jobs and email delivery
    - Email dispatch log inspection and message re-enqueueing
    - Automated email event triggers toggling and custom subject editing
    - Schema.org JSON-LD structured data generation for Organization, WebSite, NewsArticle, Product, and BreadcrumbList

25. tests/store-inventory-feeds.test.ts (10 passed)
    - Atomic manual stock adjustments with backorder zero-floor protection
    - Inventory movement history ledger with product and staff user joins
    - Product CSV export with spreadsheet formula injection defense
    - Bulk product CSV import with RFC 4180 parsing, upsert logic, and stock delta tracking
    - Meta Business Manager product catalog feed generation in RSS 2.0 XML and CSV formats
    - Meta Conversions API (CAPI) SHA-256 PII hashing and server-side event dispatching
    - Abandoned cart recovery job scanning pending orders and queueing emails
    - Administrative RBAC permissions and 403 Forbidden enforcement on inventory endpoints

26. tests/donations-recurring.test.ts (9 passed)
    - Recurring donation subscription initiation with monthly/quarterly/yearly frequencies
    - Automated thank-you and 80G tax receipt email dispatch via EmailService
    - Inbound subscription.charged webhook reconciliation with HMAC-SHA256 signature verification
    - Idempotent charge deduplication on gateway_payment_id
    - Subscription status transitions on subscription.paused and subscription.cancelled
    - Authenticated donor recurring subscription listing and self-cancellation
    - Admin recurring subscriptions directory and manual cancellation
    - Strict RBAC ownership and 403 Forbidden enforcement on subscription operations

27. tests/news-editorial.test.ts (15 passed)
    - Public authors directory resolution with published article counts (/api/v1/blog/authors)
    - Single public author profile lookup by slug (/api/v1/blog/authors/:slug)
    - Paginated author published articles listing (/api/v1/blog/authors/:slug/posts)
    - Admin author profiles directory and metadata upsert (/api/v1/admin/blog/authors/:userId)
    - Multi-stage editorial workflow state machine (draft -> in_review -> changes_requested -> in_review -> approved -> published)
    - Prevention of invalid state skips with HTTP 400 and allowable transition hints
    - Reviewer notes logging and transition audit trail (/api/v1/admin/blog/posts/:id/history)
    - Authentication and RBAC boundary enforcement on editorial transitions and author management



