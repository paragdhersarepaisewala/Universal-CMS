# WORKFLOW.md - Phases, Checkpoints and Gates

Order is fixed. A phase cannot start until the previous gate is passed. Inside a phase, each checkpoint (CP) ends with a checkpoint report and a stop.

```
Phase 0 Intake ---- GATE 0 (brief and stack approved)
Phase 1 Design ---- GATE 1 (design approved, or redesign from scratch), then GATE 1b (secondary pages and emails)
Phase 2 CMS core --- GATE 2 (separate cms-core repo, API only)
Phase 3 Frontend --- GATE 3
Phase 4 Admin GUI -- GATE 4
Phase 5 Modules ---- GATE 5
Phase 6 Hardening -- GATE 6
Phase 7 Handover --- GATE 7
```

## Phase 0 - Intake (PM)

- CP0.1 Interview. The PM reads the user's description and fills BRIEF.md: business, site type (ecommerce, donation, news, other), audience, region and currency, languages, brand colors and logo if any, reference sites, pages needed, third-party services, Hostinger plan details, domain.
- CP0.2 Gap analysis. The PM expands FEATURES.md from CHECKLIST.md section 2 and adds everything the site type needs that the user did not mention. Each feature is tagged must, should, or later.
- CP0.3 Stack confirmation. Verify Node support on the Hostinger plan, MySQL limits (connections, database size), cron availability, SMTP availability. Record the decision.
- GATE 0: user approves BRIEF.md, FEATURES.md and the stack.

## Phase 1 - Design prototype (UI Designer)

Allowed: `/prototype` with HTML, CSS, vanilla JS only. No frameworks, no backend, no database.

Required prototype set reviewed at Gate 1:
1. Home page
2. Store page (product listing with filters, sorting, pagination, grid view)
3. Product page (gallery, variants, price, add to cart, reviews, related products)
4. Blog page (blog listing and one single post)
5. Admin panel in the same theme: dashboard, product list, product edit form, page content editor (headings, text, image replacement, menus), email template studio, settings screen, role and permission screen

Every page has separately designed desktop and mobile layouts, a page loader, skeleton states, and scroll-based 3D animation at least on the home page.

- CP1.1 Design direction. Use enhance-prompt, taste-skill, awwwards, emil-design-eng. Produce DESIGN.md (palette, type scale, spacing, radius, shadows, motion rules, component list) and one style-tile page.
- CP1.2 Home page.
- CP1.3 Store page and product page.
- CP1.4 Blog listing and single post.
- CP1.5 Admin panel part 1: shell, role-aware navigation, dashboard, product list and product form.
- CP1.6 Admin panel part 2: page content editor, email template studio, settings, roles and permissions.
- CP1.7 Prototype QA. Playwright screenshots at 360, 768, 1280 and 1920 px saved to `/prototype/screenshots`. Check layout shift, overflow, tap-target size, contrast, reduced-motion behavior. Fix before presenting.
- GATE 1: user opens the prototype and replies APPROVE or REDESIGN.
  - APPROVE: freeze it. Tag the commit `design-approved`. The prototype is now the visual source of truth for the storefront and the admin GUI.
  - REDESIGN: do not patch. Archive to `/prototype-archive/v1`, start again from CP1.1 with the user's feedback and a different direction.
- CP1.8 Secondary pages in the approved theme (only after Gate 1): login, signup, forgot and reset password, verify email screen, age gate screen, cart, checkout, order success, customer account (profile, order history with receipts, saved delivery addresses), legal page template, contact, 404, maintenance page, plus donation or news pages if BRIEF.md says so. Also theme-based email designs in `/prototype/emails` (table-based HTML with inline CSS, tested at mobile and desktop widths): welcome, verify email, password reset, order confirmation, payment receipt, shipped, delivered, cancelled or refunded, invoice, abandoned cart, donation receipt, admin new-order alert.
- GATE 1b: quick approval of CP1.8 output.

## Phase 2 - CMS core (Backend/API, Security) in the separate `cms-core` repo

If cms-core already exists from an earlier project, this phase becomes upgrade and verify: pull the latest version, run its test suite, read the CHANGELOG, build only the modules still missing. Do not rebuild what exists.

No GUI is built in this phase. The output is a clean API plus the contract documents.

- CP2.1 Repository and tooling: separate git repo, semantic versioning, CHANGELOG.md, linting, Vitest or Jest, `.env.example`, README with local run steps, seed script that creates an owner account.
- CP2.2 Core schema and migrations: users, roles, permissions, sessions, audit_logs, settings, modules, theme_tokens, pages, content_blocks, menus, menu_items, media, redirects, seo_meta, email_templates, email_logs, jobs. Connection pool configured.
- CP2.3 Module system and feature flags per AGENTS.md section 4, with tests proving a disabled module exposes nothing.
- CP2.4 Auth: signup, login, logout, forgot and reset password, email verification at registration (link or one-time code, expiry, resend limits), password hashing, rate limiting, lockout, optional 2FA for admin roles, optional date-of-birth capture.
- CP2.5 RBAC: roles (owner, admin, manager, editor, support, customer), permission matrix, middleware on every protected route, tests proving lower roles are denied.
- CP2.6 Email engine: SMTP settings stored encrypted, connection test and test-send endpoints, queue with retry and backoff, template rendering with variables and theme tokens, event registry for automatic emails (welcome, verify email, password reset, order placed, payment received, shipped, delivered, cancelled, refund, invoice and receipt attached, abandoned cart, donation receipt, new-order and low-stock admin alerts), per-event on and off switch and subject editing, email log with status, unsubscribe handling for marketing mail.
- CP2.7 Cache layer: driver interface (memory and file drivers, Redis optional), tag-based invalidation, purge endpoint, cached settings, menus, pages, theme and catalog reads, automatic invalidation when admin edits content.
- CP2.8 Content, theme and compliance API: pages, blocks, menus, media, settings, SEO, redirects, users, logs, `/api/v1/theme`. Seed legal page templates (see CHECKLIST.md section 2, Compliance) as draft pages and default email templates.
- CP2.9 API contract: OpenAPI document, `docs/API.md`, `docs/ADMIN-UI-CONTRACT.md` covering every admin screen from the prototype and every module, API tokens with scopes, webhooks, contract tests.
- GATE 2: API tests, auth tests, RBAC tests and module toggle tests green; contract documents complete.

## Phase 3 - Frontend port (Frontend Engineer) in the client project repo

- CP3.0 Client repo: create it, pin the cms-core version, add `site.config` with the modules enabled for this client, load theme tokens from DESIGN.md into the theme endpoint.
- CP3.1 Layout shell: header, footer, menus, loader, skeleton components, all fed from the API.
- CP3.2 Home page ported pixel-faithful to the prototype, server-side rendered, content from CMS blocks. Playwright visual comparison against prototype screenshots.
- CP3.3 Blog and all other content pages in groups of three or four. Store and product pages are ported in Phase 5 together with the store module.
- CP3.4 Auth and account area: login, signup with email verification, forgot and reset password, profile edit, account layout. Order history, receipts and delivery addresses are wired in CP5.E2.
- CP3.5 Compliance front end: age gate, cookie consent, legal pages rendering, footer legal links, consent records.
- CP3.6 Motion port: GSAP and Lenis sequences, lazy-loaded, reduced-motion fallback, mobile simplification.
- GATE 3: user runs locally, compares with the prototype, approves.

## Phase 4 - Admin GUI at /admin (Admin Panel Engineer) in the client project repo

Built from the approved prototype admin screens, using only `docs/ADMIN-UI-CONTRACT.md` and the API. cms-core is not modified. Every screen has a loading skeleton, an empty state, an error state and a permission-denied state. Every field the client may want to change is a form control, never a code edit.

- CP4.1 Admin shell, login redirect, role-aware navigation built from enabled modules, dashboard.
- CP4.2 Content management: pages, block editor, headings and text, image replacement with crop and alt text, logo and favicon, menus and sub-menus, footer, links, redirects, media library. Theme settings: colors, fonts, button styles, spacing scale, through tokens.
- CP4.3 SEO: global defaults, per-page, per-product and per-post meta title, description, canonical, robots, Open Graph, structured data, sitemap controls, robots.txt editor.
- CP4.4 Users and roles: user list, create and edit, role assignment, permission matrix editor, activity log, login history.
- CP4.5 Email studio: SMTP setup screen with test send and connection status; template library; visual theme-based editor (header, logo, heading, text, image, button, product list, order table, footer, social links) with live desktop and mobile preview, variable picker, send-test, version history and reset to theme default; raw HTML and CSS mode for the owner role only as an optional advanced mode; automation screen to toggle each automatic email, edit subject and delay; email log with resend.
- CP4.6 Compliance: legal pages editor with the India templates, grievance officer and business details form, cookie consent settings, age verification settings (off, date-of-birth gate, confirmation checkbox, per-category or per-product 18+ restriction, minimum age, remember duration, editable message), consent log viewer.
- CP4.7 Settings and operations: site config, tax configuration, invoice numbering and templates, scripts and pixels, maintenance mode, cache purge screen, module toggle screen, backup trigger.
- CP4.8 Logs and receipts: audit log viewer with filters, error log viewer, invoice and receipt list with PDF download.
- CP4.9 No-code audit: run a search for hard-coded visible strings and image paths in the storefront, walk every page and confirm every text, image, link, menu item and color is editable in admin. List and fix exceptions.
- GATE 4: user logs in as each role and confirms access matches the matrix, and edits several things on the live page without touching code.

## Phase 5 - Site-type modules (pick by BRIEF.md)

Each module is built in two parts: the module itself in cms-core (toggleable, API only, with contract docs updated and a version bump) and its screens in the client project repo (storefront pages and admin screens). Modules not named in BRIEF.md stay switched off.

Ecommerce
- CP5.E1 Catalog: categories, products, variants, images, inventory, stock alerts, bulk import and export; store and product pages ported from the approved prototype.
- CP5.E2 Cart, checkout, orders, coupons, and the customer account area: order history with live status, receipts and invoice downloads, saved delivery addresses (add, edit, delete, set default), reorder, return requests.
- CP5.E3 Razorpay: order creation, signature verification, webhook handling with idempotency, refunds, failed payment retry.
- CP5.E4 COD: enable by pincode or order value, COD fee, confirmation flow.
- CP5.E5 Shipping partners: adapter interface plus one adapter per partner, rate lookup, label and AWB generation, tracking updates, serviceability by pincode.
- CP5.E6 Invoices and tax: GST-aware invoices (GSTIN, HSN, place of supply), credit notes, tax rules, order emails.
- CP5.E7 Meta Ads: Pixel and Conversions API events, product catalog feed.

Donation
- CP5.D1 Campaigns, goals, progress, updates, donors, anonymous option.
- CP5.D2 Razorpay one-time and recurring donations, webhook verification, receipts, tax-exemption receipt fields (for example 80G where applicable), donor emails.
- CP5.D3 Reports: donations by campaign and date, donor export, reconciliation.

News portal
- CP5.N1 Articles, categories, tags, authors, featured and breaking, scheduled publishing, drafts and revisions.
- CP5.N2 Editorial roles and approval flow, comments moderation if enabled.
- CP5.N3 RSS, news sitemap, ad slots, related articles, search.

Blog posts are part of the base CMS for all site types.
- GATE 5: user runs a full test purchase, donation or publish flow in Razorpay test mode.

## Phase 6 - Hardening (QA, Performance and SEO, Security)

- CP6.1 Testing: unit tests for business logic, API tests for every endpoint and role, Playwright end-to-end for critical flows, visual regression and layout-shift checks at all breakpoints, accessibility checks.
- CP6.2 Backend performance: query review with EXPLAIN, indexes, N+1 removal, pooling, pagination everywhere, response compression, server-side caching with invalidation, expensive computation caching, request timing logs.
- CP6.3 Frontend performance: bundle analysis, code splitting, remove unused dependencies, font optimization (subset, preload, font-display), image pipeline (lossless WebP, responsive sizes), defer non-critical scripts, remove render-blocking resources, remove duplicate or unnecessary network requests, debounce input handlers, fix unnecessary re-renders, minified assets, memory leak checks (listeners, timers, subscriptions, long-lived server objects).
- CP6.4 SEO: robots.txt, sitemap.xml, canonical tags, structured data, Open Graph, 404 and redirect handling, Google Analytics, Search Console verification slot, Lighthouse SEO audit.
- CP6.5 Security review: OWASP checks, CSRF, XSS, SQL injection, upload validation, rate limits, secure headers, dependency audit.
- CP6.6 Lighthouse and Playwright reports saved under `/reports`, compared with targets in CHECKLIST.md.
- GATE 6: targets met or user-approved exceptions.

## Phase 7 - Gap audit and handover (PM)

- CP7.1 Gap audit: PM walks FEATURES.md and CHECKLIST.md, tests every admin feature by hand as each role, lists anything missing a client would expect.
- CP7.2 Deployment pack: Hostinger deployment steps, environment variable list, cron jobs, backup and restore steps, DNS and SSL notes, rollback plan.
- CP7.3 Client handover: admin user guide, role guide, short video script or screenshots, credentials handover checklist.
- CP7.4 Reuse pass: record what in `cms-core` changed, update its changelog, confirm a new storefront could be attached with only config and design tokens.
- GATE 7: final sign-off.
