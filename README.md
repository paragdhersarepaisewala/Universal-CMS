# Universal CMS Core (cms-core)

A reusable, headless CMS core REST API built with Node.js 22 LTS, Fastify, Drizzle ORM, and MySQL.

This repository contains backend business logic, migrations, RBAC, REST endpoints under `/api/v1`, and OpenAPI specification generation. It contains zero client-specific code or branding.

## Architecture and Requirements

- Node.js: 22 LTS (Hostinger Web Apps default)
- Database: MySQL with connection pooling (configured via `mysql2`)
- Framework: Fastify (HTTP server, schema validation via TypeBox)
- ORM: Drizzle ORM with migrations
- API Documentation: OpenAPI 3.0 specification generated from code
- Background Jobs: Database-driven via `jobs` table (triggered by external cron, no in-process daemons)
- Cache: In-memory and file drivers (no Redis requirement)

## Local Development Setup

### 1. Prerequisites
- Node.js 22 LTS (or compatible active Node version)
- MySQL 8.x database server

### 2. Installation
```bash
git clone <repo-url> cms-core
cd cms-core
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Configure your local database credentials in `.env`.

### 4. Database Migration and Seeding
Run migrations and create the initial owner account:
```bash
npm run db:migrate
npm run db:seed
```

### 5. Running the Application
Start the development server with live reload:
```bash
npm run dev
```

The server listens on `http://127.0.0.1:3000`.
- Health check: `http://127.0.0.1:3000/api/v1/health`
- Interactive API Docs (Swagger UI): `http://127.0.0.1:3000/api/v1/docs`
- OpenAPI JSON: `http://127.0.0.1:3000/api/v1/openapi.json`

### 6. Code Quality and Testing
```bash
npm run lint
npm run test
npm run build
npm run generate:openapi
```

## Hostinger Deployment Guide (hPanel Web Apps)

Hostinger shared web hosting runs Node.js applications on demand via the **Web Apps** feature.

### Build and Runtime Specifications
- Node.js Version: 22 (LTS)
- Application Type: `fastify`
- Build Script: `build` (compiles TypeScript via `tsc`)
- Output Directory: Leave blank (Fastify deploys root and includes `node_modules` and `dist`)
- Entry File: `dist/server.js` (relative to the root directory)
- Host and Port: The server listens on `0.0.0.0` and binds dynamically to `process.env.PORT`.

### Deployment Steps from GitHub
1. In Hostinger hPanel, navigate to **Websites** > **Web Apps** (Node.js).
2. Connect your Git repository (GitHub) and select the `main` branch.
3. Configure App Settings:
   - Node.js Version: Select `22`
   - Application Type: Select `fastify`
   - Build Script: `build`
   - Entry File: `dist/server.js`
4. Set Environment Variables in hPanel:
   - Navigate to the **Environment variables** section in hPanel.
   - Import your production `.env` settings or input them manually.
   - Set `NODE_ENV=production`, `PORT=3000`, `HOST=0.0.0.0`.
   - Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
   - Set `DB_POOL_SIZE` to `5` (or verify against your plan's limit).
   - Set `APP_SECRET` and `JOB_RUNNER_SECRET`.
5. Trigger Deployment:
   - Hostinger runs `npm install`, executes `npm run build`, and launches `node dist/server.js`.
6. Run Migrations on First Deploy:
   - Execute the migration and seed scripts via SSH:
     ```bash
     node dist/db/migrate.js
     node dist/db/seed.js
     ```

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `production`, `test`) |
| `PORT` | No | `3000` | Port provided by hosting environment |
| `HOST` | No | `0.0.0.0` | Host binding interface (must be `0.0.0.0` on Hostinger) |
| `DB_HOST` | Yes | `127.0.0.1` | MySQL server hostname |
| `DB_PORT` | No | `3306` | MySQL server port |
| `DB_USER` | Yes | `root` | MySQL database username |
| `DB_PASSWORD`| Yes | - | MySQL database password |
| `DB_NAME` | Yes | `cms_core` | MySQL database name |
| `DB_POOL_SIZE`| No | `5` | MySQL pool connection limit. Check hPanel connection limits! |
| `APP_SECRET` | Yes | - | Secret key used for cryptographic signing and session cookies |
| `CACHE_DRIVER`| No | `memory` | Cache backend: `memory` or `file` (no Redis requirement) |
| `CACHE_FILE_DIR`| No | `./.cache` | Directory path when `CACHE_DRIVER=file` |
| `JOB_RUNNER_SECRET`| Yes | - | Shared secret for authenticating cron job executions |
| `SEED_OWNER_EMAIL` | No | `owner@example.com` | Email for initial seed owner user |
| `SEED_OWNER_PASSWORD` | No | `ChangeMe123!` | Initial password for seed owner user |
| `SEED_OWNER_NAME` | No | `System Owner` | Full name for seed owner user |

### MySQL Connection Pool Limit Warning
Shared hosting plans enforce strict concurrent MySQL connection limits (typically between 20 and 50 connections across all processes and web requests). Keep `DB_POOL_SIZE` low (default `5`) to avoid MySQL `Too many connections` errors. Verify your plan limits under **Hosting** > **Resource Usage** in hPanel.

## Background Jobs and Cron Design

Persistent long-running background workers (such as BullMQ, PM2 background daemons, or Celery) cannot run continuously on Hostinger shared Web Apps because processes sleep during inactivity.

### Architecture Decision
1. All asynchronous work (transactional emails, scheduled article publishing, abandoned cart processing) is stored as rows in the MySQL `jobs` table with a `pending` state and a `run_after` timestamp.
2. An external trigger periodically invokes the job runner.
3. In production, configure a Hostinger Cron Job in hPanel:
   - Interval: Every 5 minutes (`*/5 * * * *`)
   - Command:
     ```bash
     curl -s -X POST https://your-domain.com/api/v1/jobs/process -H "Authorization: Bearer YOUR_JOB_RUNNER_SECRET"
     ```
   - Alternatively via CLI command:
     ```bash
     cd /home/u123456789/domains/your-domain.com/public_html && node dist/jobs/runner.js
     ```

## License
Proprietary. Universal CMS core engine.
