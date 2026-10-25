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
