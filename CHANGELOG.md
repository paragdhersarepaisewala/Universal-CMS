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
- Vitest test suite and ESLint linting pipeline.
- GitHub Actions CI workflow using Node.js 22.
