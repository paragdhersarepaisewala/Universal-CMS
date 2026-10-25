# Universal CMS Core (cms-core)

A reusable, headless CMS core REST API engine built with Node.js 22 LTS, Fastify, Drizzle ORM, and MySQL.

This repository contains backend business logic, migrations, RBAC, REST endpoints under `/api/v1`, and OpenAPI specification generation. It contains zero client-specific code or branding.

## Architecture and Requirements

- Node.js: 22 LTS (Hostinger Web Apps default)
- Database: MySQL 8.x with connection pooling (`mysql2`)
- Framework: Fastify 4.x (HTTP server, TypeBox schema validation)
- ORM: Drizzle ORM with structured migrations
- API Documentation: OpenAPI 3.0 specification generated from code
- Background Jobs: Database-driven via `jobs` table (triggered by external cron, no in-process daemons)
- Cache: Multi-process file driver default in production, in-memory for testing

## Deploy Model (Thin Client Repository)

Do not fork or copy code from `cms-core` into client projects. The production deployment model uses a thin client backend repository that pins a specific `cms-core` release:

1. Create a client backend repository (e.g., `client-api`).
2. Pin `cms-core` as a git submodule or private npm dependency:
   ```json
   {
     "dependencies": {
       "@universal-cms/core": "github:universal-cms/cms-core#v0.1.0"
     }
   }
   ```
3. The client repository provides only `.env` configuration, client-specific migrations, and module toggles.

## Local Development Setup

### 1. Prerequisites
- Node.js 22 LTS
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
Configure your database credentials in `.env`.

### 4. Database Migration and Seeding
Execute the single explicit migration command followed by initial seeding:
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
- Interactive API Docs (Swagger UI): `http://127.0.0.1:3000/api/v1/docs` (active in development)
- OpenAPI JSON: `http://127.0.0.1:3000/api/v1/openapi.json`

### 6. Code Quality and Testing
```bash
npm run lint
npm run test
npm run build
npm run generate:openapi
```

## Hostinger Deployment Guide (hPanel Web Apps)

Hostinger shared web hosting runs Node.js applications on demand via the **Web Apps** feature powered by CloudLinux and Phusion Passenger.

### Critical Hostinger Configuration Rules

1. **Do NOT configure PORT or HOST in hPanel Environment Variables**:
   Passenger assigns ports and internal reverse-proxy sockets dynamically and injects `process.env.PORT` automatically. Setting `PORT` or `HOST` manually in environment variables can cause Passenger socket binding conflicts and 503 Bad Gateway errors. Fastify binds dynamically to `process.env.PORT || 3000` and `0.0.0.0`.
2. **Reverse Proxy & Trust Proxy**:
   Fastify has `trustProxy` enabled by default to properly resolve client IP addresses through Hostinger Nginx and Passenger reverse proxies.
3. **Application Type Selection**:
   In the Hostinger hPanel Web Apps creation modal, select **Node.js** (or Custom/Standard). There is no proprietary Fastify option.
4. **Native Build Tools**:
   Hostinger shared hosting environments do not provide C++ compiler toolchains (`gcc`, `g++`, `make`, `python3`). Precompiled native binaries (e.g. `@node-rs/argon2` or prebuilt `argon2`) are utilized to avoid build failures during `npm install`.
5. **API Documentation Protection in Production**:
   Swagger UI (`/api/v1/docs`) and `/api/v1/openapi.json` are automatically disabled in production (`NODE_ENV=production`) returning 404 to prevent schema exposure. To enable docs in staging, set `ENABLE_SWAGGER=true`.

### Deployment Steps from GitHub

1. In Hostinger hPanel, navigate to **Websites** > **Web Apps** (Node.js).
2. Connect your Git repository and select the target branch.
3. Configure App Settings:
   - Node.js Version: `22`
   - Application Type: `Node.js`
   - Build Script: `build` (runs `tsc`)
   - Entry File: `dist/server.js`
4. Set Environment Variables in hPanel:
   - `NODE_ENV=production`
   - `DB_HOST=127.0.0.1` (or your Hostinger MySQL hostname)
   - `DB_USER=u123456789_cms`
   - `DB_PASSWORD=your_secure_password`
   - `DB_NAME=u123456789_cms`
   - `DB_POOL_SIZE=5` (strict connection limit for Hostinger plans)
   - `APP_SECRET=your_high_entropy_secret_at_least_32_chars`
   - `JOB_RUNNER_SECRET=your_cron_runner_secret`
   - `SEED_OWNER_EMAIL=admin@your-domain.com`
   - `SEED_OWNER_PASSWORD=your_strong_admin_password_min_12_chars`
   - Note: Do NOT add `PORT` or `HOST`.
5. Deploy and Migrate:
   - Click **Deploy**. Hostinger runs `npm install`, executes `npm run build`, and starts the app.
   - Run the explicit migration step via SSH terminal:
     ```bash
     node dist/db/migrate.js
     node dist/db/seed.js
     ```

## Background Jobs and Cron Configuration

Hostinger shared hosting puts inactive Node.js processes into sleep mode. Persistent background daemons (such as BullMQ, PM2 worker clusters, or Redis listeners) cannot run reliably.

All background tasks (emails, webhooks, scheduled posts) are stored in the MySQL `jobs` table with a `pending` status.

### Production Cron Configuration in hPanel

Configure a Cron Job in hPanel (**Advanced** > **Cron Jobs**):
- Interval: Every 5 minutes (`*/5 * * * *`)
- Preferred Web Trigger:
  ```bash
  curl -s -X POST https://your-domain.com/api/v1/jobs/process -H "Authorization: Bearer YOUR_JOB_RUNNER_SECRET"
  ```
- Alternatively via CLI using absolute paths:
  ```bash
  /usr/bin/node /home/u123456789/domains/your-domain.com/public_html/dist/scripts/jobs-runner.js
  ```

## Authentication & Transport Security

`cms-core` implements a decoupled headless authentication model:
- **Primary Transport (Bearer Token)**:
  `Authorization: Bearer <session_or_api_token>`
  Bearer authentication is immune to Cross-Site Request Forgery (CSRF) because browsers never attach Bearer headers automatically on cross-origin requests.
- **Secondary Transport (Session Cookie)**:
  Cookies (`session=<token>`) are supported for browser-based same-origin applications. When cookies are used, all mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) require custom header verification (`X-Requested-With` or `X-CSRF-Token`) to prevent CSRF attacks.

## Cache Strategy

Multi-process Hostinger environments (Passenger workers) must share cache state:
- Default Driver in Production: `file` (stores serialized cache items and tag indexes on shared disk in `./.cache`).
- In-Memory Driver: `memory` (used for test suites).
- Tag-based invalidation allows atomic purging of related routes (e.g., `pages`, `menus`, `settings`, `theme`) upon administrative edits.

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `production`, `test`) |
| `DB_HOST` | Yes | `127.0.0.1` | MySQL server hostname |
| `DB_PORT` | No | `3306` | MySQL server port |
| `DB_USER` | Yes | `root` | MySQL database username |
| `DB_PASSWORD` | Yes | - | MySQL database password |
| `DB_NAME` | Yes | `cms_core` | MySQL database name |
| `DB_POOL_SIZE` | No | `5` | MySQL pool limit (keep at 5 on Hostinger) |
| `APP_SECRET` | Yes | - | High-entropy secret for token hashing and AES-256-GCM encryption |
| `CACHE_DRIVER` | No | `file` (prod) | Cache backend (`file` in prod, `memory` in test) |
| `CACHE_FILE_DIR` | No | `./.cache` | Cache directory when `CACHE_DRIVER=file` |
| `JOB_RUNNER_SECRET` | Yes | - | Secret for authenticating cron job executions |
| `ENABLE_SWAGGER` | No | `false` | Set to `true` to enable Swagger UI in production |
| `TRUST_PROXY` | No | `true` | Fastify trustProxy setting for reverse proxies |
| `SEED_OWNER_EMAIL` | No | `owner@example.com` | Email for initial seed owner |
| `SEED_OWNER_PASSWORD` | No | - | Password for initial owner (required min 12 chars in prod) |
| `SEED_OWNER_NAME` | No | `System Owner` | Full name for seed owner |

## License
Proprietary. Universal CMS core engine.
