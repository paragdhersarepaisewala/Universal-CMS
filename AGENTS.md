## SCOPE OVERRIDE FOR THE cms-core REPOSITORY (read first, wins over everything below)

This repository is cms-core only. It is headless and API-only.
- No UI, prototype, theme, storefront or admin GUI is built here. Rules and phases about design, prototypes, Gate 1 and Gate 1b, and Phases 0, 1, 3, 4 and 7 belong to client project repos and do not apply here.
- What applies: Phase 2, the cms-core half of each Phase 5 module (API, migrations, permissions, contract docs), and the backend parts of Phase 6 (tests, query tuning, caching, security).
- Nothing client-specific: no brand names, copy, colors, currency or tax rules hard-coded. All of it comes from settings or seed data.
- Every endpoint, field, permission or side-effect change updates openapi.json and docs/ADMIN-UI-CONTRACT.md in the same commit, with a version bump and a CHANGELOG entry.
- The design skill map does not apply. Use find-skills only for backend and testing needs.




# AGENTS.md - Operating Rules for Every Agent

Read this file, WORKFLOW.md and PROGRESS.md at the start of EVERY session before doing anything.
If an instruction from the user conflicts with this file, follow the user and note it in PROGRESS.md.

## 1. Hard rules (never break)

1. DESIGN FIRST. No framework, backend, database or build tooling is created until Gate 1 (design approval) is passed. Before Gate 1 the only allowed folder is `/prototype` containing plain HTML, CSS and light vanilla JS.
2. CHECKPOINTS ONLY. Work one checkpoint at a time (see WORKFLOW.md). At the end of each checkpoint: update PROGRESS.md, post the checkpoint report, stop. Do not start the next checkpoint until the user says continue. Gates marked GATE require explicit approval.
3. NO EMOJIS anywhere: UI, copy, code comments, commit messages, docs, seed data. Use inline SVG icons.
4. RESPONSIVE BY DESIGN. Mobile layouts are redesigned, not shrunk desktop layouts. Verify at 360, 390, 768, 1024, 1280, 1920 px.
5. AUTH IS NEVER OPTIONAL. Login, signup, forgot password, reset password, email verification and logout exist on every project, for both customers and admin staff.
6. DATABASE IS MySQL (Hostinger compatible). Use migrations. No SQLite or MongoDB in production code paths.
7. NOTHING IS HARD-CODED, AND NO CODE IS EVER NEEDED TO EDIT THE SITE. Every heading, paragraph, button label, image, logo, menu item, footer link, legal page, email template, SEO field, color, font and setting is read from the CMS database and editable from `/admin` through forms, pickers and visual editors. If a client would have to open a code file to change something, that is a bug. Only layout structure and component code live in the codebase.
8. ADMIN LIVES AT `/admin`, role-based access only. Every admin route and every admin API endpoint is protected server-side. Hiding a button in the UI is not protection.
9. SECRETS in `.env` only. Provide `.env.example`. Never commit keys.
10. NO SILENT SKIPS. If an item in CHECKLIST.md cannot be done, mark it `[~]` with a reason in PROGRESS.md. Never delete checklist items.
11. EVIDENCE OVER CLAIMS. "Done" requires proof: test output, screenshot path, Lighthouse report path, or curl output. No proof, not done.
12. ASK BEFORE ADDING dependencies outside the approved stack. Remove unused ones at the end.
13. THE CMS IS A SEPARATE, REUSABLE REPOSITORY. `cms-core` lives in its own git repo and contains zero client-specific design or copy. Agents working inside a client project never edit cms-core files in place. Changes go to the cms-core repo on a branch, with a CHANGELOG entry and a version bump, and the client project then upgrades the pinned version.
14. EVERY FEATURE IS A MODULE WITH A TOGGLE. Store, blog, donations, news, age verification, COD, each shipping adapter, Meta ads, reviews, coupons and so on can be switched on or off from config and from admin without code changes. A disabled module registers no routes, no admin navigation and no scheduled jobs, and its data stays intact.
15. LEGAL AND COMPLIANCE TEXT IS A DRAFT. Legal pages ship as editable starting templates and are marked for review by the client's lawyer before launch. Agents never claim that a site is legally compliant.
16. API FIRST, GUI SECOND. cms-core exposes clear, documented endpoints only. Themed admin screens and storefront screens are built later, from the approved prototype, in the client project.

## 2. Agent roles

| Agent | Owns | Must not |
|---|---|---|
| Project Manager (PM) | Intake, BRIEF.md, FEATURES.md, gap analysis, checkpoint reports, PROGRESS.md, assigning agents | Write production code |
| UI Designer | `/prototype`, DESIGN.md, design tokens, motion design, skeleton and loader designs | Touch backend or framework code |
| Frontend Engineer | Porting the approved prototype to SSR pages, components, state, data fetching | Change the approved visual design without a new Gate 1 |
| Backend/API Engineer | MySQL schema, migrations, auth, RBAC, REST API, webhooks, integrations | Build UI |
| Admin Panel Engineer | `/admin` UI for every module, role matrix, audit log views | Bypass API permission checks |
| QA Engineer | Unit, API, Playwright, accessibility and visual regression tests | Fix feature code silently (report bugs, then fix in a separate commit) |
| Performance and SEO Engineer | Lighthouse, bundle, caching, DB query tuning, SEO and robots, analytics | Introduce new features |
| Security Reviewer | Auth, RBAC, input validation, payment webhook verification, rate limits | |

The PM is the entry point. The user describes the website; the PM fills BRIEF.md, then hands off to the UI Designer.

## 3. Skill map (folders in the user's skills directory)

Load only the skills that match the current task. Read the SKILL.md before using one.

| Skill folder | Used by | Purpose in this workflow |
|---|---|---|
| enhance-prompt | PM, UI Designer | Turn the user's rough site description into a detailed design prompt |
| stitch-loop | UI Designer | Iterative page-by-page prototype generation |
| design-md | UI Designer | Produce DESIGN.md (tokens, type scale, spacing, components) |
| taste-skill, awwwards, emil-design-eng | UI Designer | Visual quality bar, layout taste, interaction polish |
| animate | UI Designer, Frontend | General animation patterns |
| gsap-core, gsap-timeline, gsap-scrolltrigger | UI Designer, Frontend | Scroll-driven and timeline animation |
| gsap-performance | Frontend, Performance | Keep animation off the main thread, avoid layout thrash |
| cinematic-gsap-lenis-motion-system | UI Designer, Frontend | Smooth scroll and cinematic 3D-feel scroll sequences |
| vanta-js | UI Designer | Animated backgrounds for hero sections (lazy-load only) |
| react-components | Frontend | Convert approved designs into components |
| react-bits | Frontend | Prebuilt animated React pieces |
| shadcn-ui | Admin Panel Engineer, Frontend | Admin tables, forms, dialogs, dashboards |
| find-skills | Any agent | Search for a missing skill before improvising |
| jury, gepeto, pinokio | PM to decide | Open each SKILL.md and decide whether it fits; record the decision in PROGRESS.md |
| remotion | Nobody by default | Video generation; ignore unless a project needs video |

Motion budget rule: heavy effects (3D, Vanta, large GSAP timelines) must lazy-load, respect `prefers-reduced-motion`, and be simplified or disabled on small or low-power devices. Motion must never push mobile Lighthouse performance or CLS below the targets in CHECKLIST.md.

## 4. Default technical direction (confirm at Gate 0)

The PM must confirm the Hostinger plan supports Node.js before locking this. If it does not, switch to the PHP fallback.

- Primary: Next.js (App Router, server-side rendering) + TypeScript, MySQL via Prisma or Drizzle, connection pooling, REST API under `/api/v1`, OpenAPI spec generated.
- Fallback if the Hostinger plan has no Node: Laravel (PHP) + MySQL, same API, module and admin requirements.
- Whether cms-core and the storefront deploy as one app or two is decided at Gate 0 and recorded.

### Two repositories

Repo A: `cms-core` (built once, reused on every project, semantic versioning)
- Headless. Contains: database schema and migrations, auth, RBAC, REST API under `/api/v1`, OpenAPI spec, media library, email engine, cache layer, job queue, module and feature-flag system, webhooks, audit log, seed data including legal page templates and default email templates.
- Contains NO themed admin GUI and NO public frontend. An unstyled reference admin may exist behind a dev flag for debugging only.
- Ships documentation that lets any agent build a GUI later: `openapi.json`, `docs/API.md`, and `docs/ADMIN-UI-CONTRACT.md`, a screen-by-screen list of what every admin screen needs (endpoints, fields, validation rules, permissions, empty and error states).
- Has its own tests, CHANGELOG.md, migration notes and README.

Repo B: one repo per client project
- `storefront` (public site, SSR) and `admin-ui` (themed admin at `/admin`), both built from the approved prototype, both talking to cms-core through the API only.
- `site.config` selects which modules are on, theme tokens and hosting values.
- cms-core is consumed as a pinned git dependency, submodule or package. It is never copied into the client repo.
- A new client needs a new Repo B and a config file, not changes to cms-core.

### Module system

- Each module lives in `modules/<name>/` in cms-core with a manifest: name, version, depends_on, permissions, settings schema, admin navigation entries, migrations, routes, scheduled jobs.
- Always-on core modules: auth, rbac, settings, theme, media, pages, menus, seo, email, cache, audit.
- Optional modules: store, blog, donations, news, age-gate, razorpay, cod, shipping adapters (one per partner), meta-ads, reviews, coupons, newsletter, returns.
- Toggle through `config` and through `GET` and `PATCH /api/v1/admin/modules`. Tests must prove a disabled module returns 404 for its routes and appears in no navigation.

### Content model

Pages are built from typed content blocks (hero, text, gallery, product grid, form, etc.) stored as JSON, so the admin can edit text, swap images and reorder sections, and a different frontend can be attached without changing the data model. Theme tokens (colors, fonts, radius, logo) are also stored in the database and exposed at `/api/v1/theme`.

## 5. Code standards

- Mobile-first CSS using design tokens (CSS variables) from DESIGN.md. No magic numbers.
- Semantic HTML, one h1 per page, labelled form fields, visible focus states, WCAG AA contrast.
- Every image has width, height, alt text; hero image uses preload; below-the-fold images are lazy.
- Every list endpoint is paginated. Every input is validated server-side (schema validation) and sanitized.
- Every data-loading view has a skeleton, an empty state and an error state.
- Commits are small, one per checklist item or group, with a plain message and no emojis.

## 6. Checkpoint report format (post at the end of every checkpoint)

```
CHECKPOINT: <id and name>
DONE: <checklist items completed>
EVIDENCE: <paths or command output>
SKIPPED OR BLOCKED: <item, reason>
RISKS OR GAPS FOUND: <anything missing from FEATURES.md>
NEXT CHECKPOINT: <id and name>
WAITING FOR: <continue | approval at GATE n>
```

## 7. Definition of done for the whole project

All items in CHECKLIST.md are `[x]` or `[~]` with an approved reason, the Gate 7 handover pack exists, and the user has run the site locally and on a Hostinger staging domain.
