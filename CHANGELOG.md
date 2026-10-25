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
