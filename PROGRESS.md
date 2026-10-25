# PROGRESS.md - Master To-Do and Progress Tracking

Copied from CHECKLIST.md. Mark `[x]` only with evidence. Mark `[~]` for skipped items with a reason. Never delete lines.

## 1. Project start files

- [~] BRIEF.md filled and approved (GATE 0) - belongs to client repo
- [~] FEATURES.md created from section 2 plus site-type additions - belongs to client repo
- [~] DESIGN.md created (tokens, type, spacing, components) - belongs to client repo
- [x] PROGRESS.md created from this file
- [~] `/src`, framework and backend folders do NOT exist before Gate 1 - belongs to client repo

## 2. Feature inventory (PM adds missing items for the site type)

### Authentication and accounts
- [ ] Signup, login, logout
- [ ] Email verification on registration (link or one-time code, expiry, resend limit, unverified accounts restricted)
- [ ] Forgot and reset password
- [ ] Email verification
- [ ] Session management and device list
- [ ] 2FA for admin roles
- [ ] Login rate limiting and lockout
- [~] Customer profile page: name, email, phone, password change, communication preferences - belongs to client repo
- [~] Order history with live status and tracking link - belongs to client repo
- [~] Receipts and invoices viewable and downloadable as PDF - belongs to client repo
- [~] Delivery addresses: add, edit, delete, set default, used at checkout - belongs to client repo
- [~] Donation history and receipts (donation sites) - belongs to client repo
- [~] Reorder and return request from order history - belongs to client repo
- [~] Account deletion and data export request - belongs to client repo

### Roles and permissions
- [x] Roles: owner, admin, manager, editor, support, customer
- [~] Permission matrix editable in admin - belongs to client repo
- [ ] Server-side permission check on every admin route and endpoint
- [ ] Invite staff by email with a role
- [ ] Audit log: who changed what, when, from which IP, with before and after values

### Content control (client edits everything)
- [~] Edit headings, subheadings and body text on any page - belongs to client repo
- [~] Add, remove, reorder page sections (block editor) - belongs to client repo
- [~] Replace image on any page, with alt text and crop - belongs to client repo
- [~] Replace logo, favicon, social share image - belongs to client repo
- [~] Manage header menu, sub-menus, footer menus, buttons and links - belongs to client repo
- [ ] Draft, preview, publish, schedule, and revision history with rollback
- [ ] Media library with folders, search, usage tracking, safe delete
- [ ] Redirect manager (301 and 302)
- [ ] Forms builder or contact form submissions inbox
- [ ] Banners, announcement bar, popups with scheduling
- [ ] Email templates editable (order, receipt, welcome, reset)
- [ ] Blog: posts, categories, tags, authors, featured image, scheduled publish
- [ ] Custom 404 and maintenance page editable

### SEO
- [ ] Global SEO defaults
- [ ] Per-page SEO: title, description, canonical, robots, Open Graph, Twitter card
- [ ] Per-product SEO
- [ ] Per-post and per-category SEO
- [~] Structured data (Organization, Product, Article, BreadcrumbList, Donation or Event where relevant) - belongs to client repo
- [ ] sitemap.xml generated and listed in robots.txt
- [ ] robots.txt editable in admin
- [ ] Google Analytics (GA4) with ID set in admin
- [ ] Meta Pixel and Conversions API with ID set in admin
- [ ] Header and footer script injection field with safety warning

### Ecommerce (if applicable)
- [ ] Products, variants, SKUs, categories, brands, attributes
- [ ] Inventory with low-stock alerts, stock history, bulk import and export
- [ ] Cart, guest and logged-in checkout
- [ ] Coupons and discount rules
- [ ] Orders: status flow, notes, partial fulfilment, cancellations, returns, refunds
- [ ] Razorpay with signature verification and webhooks (idempotent)
- [ ] Cash on delivery with rules (pincode, order value, fee)
- [ ] Multiple shipping partners via adapter interface, rate and serviceability checks, AWB and tracking
- [ ] GST tax configuration and GST invoices, credit notes
- [ ] Order and shipping emails, abandoned cart emails
- [ ] Customer management: list, segments, notes, order history, export
- [ ] Reviews and ratings with moderation
- [ ] Wishlist
- [ ] Meta catalog feed

### Donation (if applicable)
- [ ] Campaigns with goal, progress bar, updates, images
- [ ] One-time and recurring donations via Razorpay
- [ ] Donor management and anonymous donation option
- [ ] Automatic receipts with required tax-exemption fields where applicable
- [ ] Reports and CSV export, reconciliation with Razorpay
- [~] Thank-you page and email - belongs to client repo (page UI belongs to client repo; transactional email engine in cms-core)

### News portal (if applicable)
- [ ] Articles with drafts, revisions, scheduling, breaking and featured flags
- [~] Categories, tags, authors with profile pages - belongs to client repo (author profile pages UI belong to client repo; API in cms-core)
- [ ] Editorial workflow (writer, editor, publisher)
- [ ] RSS feeds and news sitemap
- [ ] Ad slot management
- [ ] Related articles and site search

### Operations
- [~] Dashboard with key numbers - belongs to client repo
- [ ] Settings: business info, SMTP, currency, timezone, tax, invoice numbering
- [~] Error and request logs viewable in admin - belongs to client repo
- [ ] Backup and restore procedure documented and tested
- [~] Cookie consent and privacy policy and terms pages - belongs to client repo
- [x] Health check endpoint

### Email and SMTP
- [~] SMTP settings screen (host, port, security, username, password stored encrypted, from name, from address, reply-to) - belongs to client repo
- [~] Connection test and test-send button with clear error messages - belongs to client repo
- [ ] Email queue with retry, backoff and failure log
- [~] Email log in admin: recipient, event, status, time, resend - belongs to client repo
- [~] Email studio: visual theme-based template editor with desktop and mobile preview - belongs to client repo
- [~] Editable blocks: logo, header, heading, text, image, button, product list, order table, footer, social links - belongs to client repo
- [~] Variable picker (customer name, order number, items, totals, address, receipt link, reset link, etc.) - belongs to client repo
- [~] Send-test-to-myself, version history, reset to theme default - belongs to client repo
- [~] Raw HTML and CSS mode restricted to the owner role (optional advanced mode) - belongs to client repo
- [ ] Automatic emails each with an on and off switch and editable subject: welcome, verify email, password reset, order placed, payment received, shipped, delivered, cancelled, refund, invoice, abandoned cart, donation receipt, admin new order, admin low stock
- [ ] Marketing emails include unsubscribe; transactional emails do not depend on marketing consent
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
- [~] Consent checkbox at signup and checkout linked to the policies, consent timestamp stored - belongs to client repo (frontend checkbox UI belongs to client repo; timestamp persistence in cms-core)
- [~] Data export and deletion request flow for customers - belongs to client repo
- [~] All legal pages editable in admin, versioned, with last-updated date shown - belongs to client repo
- [ ] Legal templates marked as draft until the client confirms lawyer review

### Age verification
- [ ] Module with on and off toggle
- [ ] Modes: date-of-birth gate, confirmation checkbox, per-category or per-product 18+ restriction
- [~] Minimum age, remember duration, message text and redirect-on-fail all editable in admin - belongs to client repo
- [~] Bots and crawlers handled so SEO is not blocked - belongs to client repo
- [ ] Note recorded for the client: a self-declared gate is a notice, not proof of age; if a stricter law or product category requires real verification, add a verification provider adapter
- [ ] Under-18 handling in signup follows the Privacy Policy decision

### Caching
- [ ] Cache driver interface (memory, file, optional Redis)
- [ ] Tag-based invalidation, so editing a page, product, menu or setting refreshes only what changed
- [~] Admin cache purge screen (all, per page, per tag) - belongs to client repo
- [ ] Page, API response, menu, settings, theme and catalog caching with sensible TTLs
- [ ] Cache hit and miss visible in logs
- [ ] Authenticated and cart pages never served from a shared cache

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
- [ ] Module manifest for every feature (dependencies, permissions, settings, nav, migrations, routes, jobs)
- [ ] Module toggle in config and in admin
- [ ] Disabled module returns 404 on its routes, shows no admin navigation, runs no jobs, keeps its data
- [ ] Enabling a module runs its migrations safely
- [ ] `openapi.json`, `docs/API.md`, `docs/ADMIN-UI-CONTRACT.md` current for the released version
- [ ] Client project pins a cms-core version and never copies its code
- [ ] Upgrade notes written for every cms-core release

### Headless and reuse
- [ ] All CMS data available through `/api/v1`
- [x] OpenAPI document generated and current
- [ ] API tokens with scopes
- [ ] Webhooks for content changes
- [ ] No design code inside `cms-core`
- [ ] Storefront can be replaced using only tokens, config and API

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
- [ ] No emojis anywhere (run a repo search and attach the result)
- [~] Page loader implemented - belongs to client repo
- [~] Skeleton loading for every data-driven view - belongs to client repo
- [~] Empty states and error states for every list and form - belongs to client repo
- [~] Scroll-based 3D or cinematic animation with reduced-motion fallback - belongs to client repo
- [~] Mobile layouts redesigned separately (not just scaled) - belongs to client repo
- [~] Tap targets at least 44 px, input text at 16 px minimum on mobile - belongs to client repo

## 4. Testing

- [ ] Unit tests for business logic (tax, totals, discounts, permissions, receipts)
- [ ] API tests for every endpoint, including a denied case for each protected role boundary
- [~] Playwright end-to-end: signup with email verification, login, purchase or donation, admin edit reflected on site - belongs to client repo
- [ ] Email tests: templates render with sample data, variables resolved, links valid, test-send works
- [ ] Module toggle tests: disabled modules expose nothing
- [~] Age gate and cookie consent tested including crawler behavior - belongs to client repo
- [~] Playwright visual regression at 360, 768, 1280, 1920 px - belongs to client repo
- [~] Playwright layout-shift check (CLS under 0.1 on every key page) - belongs to client repo
- [~] Accessibility checks (axe) with no serious issues - belongs to client repo
- [~] SEO tests: titles, descriptions, canonicals, h1 count, structured data validity, robots and sitemap reachable - belongs to client repo
- [ ] Payment tests in Razorpay test mode including failure and webhook retry
- [ ] Test report stored in `/reports`

## 5. Performance (Phase 6)

Targets for key pages on mobile emulation, measured with Lighthouse and recorded in `/reports`:
Performance 90 or higher, Accessibility 95 or higher, Best Practices 95 or higher, SEO 95 or higher, LCP under 2.5 s, CLS under 0.1, INP under 200 ms. If motion makes a target unreachable, document the trade-off for approval.

- [~] Server-side rendering on all public pages - belongs to client repo
- [ ] Compress API payloads (gzip or brotli) and return only needed fields
- [ ] Optimize database queries (EXPLAIN reviewed, indexes added, N+1 removed)
- [x] Database connection pooling configured and sized for the Hostinger limit
- [ ] Paginate all large lists (API and admin)
- [~] Fix unnecessary re-renders - belongs to client repo
- [ ] Fix memory leaks (listeners, timers, subscriptions, GSAP and Lenis cleanup, server-side)
- [~] Optimize fonts (subset, self-host, preload, font-display swap) - belongs to client repo
- [~] Split code into chunks, lazy-load heavy modules (3D, Vanta, charts, editors) - belongs to client repo
- [~] Reduce bundle size, analyze and attach report - belongs to client repo
- [ ] Remove unused dependencies
- [~] Remove unnecessary network requests and duplicate fetches - belongs to client repo
- [~] Defer non-critical scripts, remove render-blocking resources - belongs to client repo
- [~] Debounce input handlers (search, filters, autosave) - belongs to client repo
- [ ] Cache expensive computations
- [ ] Server-side caching with correct invalidation on admin edits
- [~] Minify JS and CSS - belongs to client repo
- [ ] Images converted to lossless WebP with responsive sizes and dimensions set
- [ ] Faster server response (TTFB measured and recorded)
- [ ] Server-side logging with levels and rotation
- [~] Lighthouse audit run and report saved - belongs to client repo

## 6. Security

- [ ] Input validation on every endpoint, output escaping, CSRF protection
- [ ] Parameterized queries only
- [ ] File upload type and size validation
- [ ] Secure headers and HTTPS-only cookies
- [ ] Razorpay webhook signature verification, amount re-verified server-side
- [ ] Rate limiting on auth, checkout and form endpoints
- [ ] Secrets only in `.env`, none in git history
- [ ] Dependency audit run
- [ ] Admin routes return 403 for unauthorized roles (tested)

## 7. Deployment and handover

- [ ] Local run instructions tested from a clean clone
- [~] Hostinger staging deployment completed - belongs to client repo
- [x] Environment variables documented
- [ ] Cron jobs documented (scheduled posts, abandoned carts, backups)
- [ ] Backup and restore tested
- [~] SSL, DNS, redirects www to non-www (or reverse) confirmed - belongs to client repo
- [~] Admin user guide and role guide written - belongs to client repo
- [~] Gap audit completed by PM with list of additions - belongs to client repo
- [~] Final sign-off (GATE 7) - belongs to client repo
