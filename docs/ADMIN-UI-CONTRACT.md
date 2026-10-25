# ADMIN-UI-CONTRACT.md

Location: `cms-core/docs/ADMIN-UI-CONTRACT.md`

```
Contract version:   0.1.0
cms-core version:   0.1.0
Last updated:       2026-10-25
```

## 0. What this file is

This file describes, screen by screen, everything an admin GUI needs from cms-core: which endpoints a screen calls, which fields it shows, how fields are validated, which permission gates what, what each button does, and which states the screen must handle.

It is the only thing a GUI agent needs to read to build the admin. The GUI agent does not read cms-core source code.

`openapi.json` is the machine-readable list of endpoints and types. This file adds the UI-level meaning that OpenAPI cannot express: screens, labels, grouping, permissions, actions, states, side effects.

## 1. Rules

For cms-core agents
1. Any change to an admin endpoint, field, permission or side effect must update this file in the same commit, bump the contract version, and add a line to section 8.
2. Every screen listed here must have contract tests that call its endpoints with an allowed role and a denied role.
3. A module's screens appear in this file under that module. If the module is disabled its screens, routes and navigation entries must not exist.
4. Do not put visual design, colors or layout in this file. It describes data and behavior only.

For GUI agents
1. Build only what is listed here. If a screen needs something not listed, stop and request a contract change in the cms-core repo. Do not guess endpoint names or fields.
2. Every screen implements the four standard states in section 2.5.
3. Build navigation from `GET /api/v1/admin/navigation`, which returns only the items the current role may see for the modules currently enabled.
4. Show or hide controls using the permission list from `GET /api/v1/admin/me`, and still expect the server to return 403.

## 2. Conventions used by every screen

### 2.1 Base and auth
- Base path: `/api/v1`. Admin endpoints live under `/api/v1/admin`.
- Auth: session cookie (httpOnly) or `Authorization: Bearer <token>` for API tokens.
- Current user and permissions: `GET /api/v1/admin/me` returns `{ id, name, email, role, permissions: ["store.products.view", ...], enabled_modules: ["store", ...] }`.

### 2.2 Response envelope
Success: `{ "data": <object or array>, "meta": { ... } }`
Error: `{ "error": { "code": "VALIDATION_FAILED", "message": "Human readable", "fields": { "price": "Must be 0 or more" } } }`
Standard error codes: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (422), `CONFLICT` (409), `RATE_LIMITED` (429), `MODULE_DISABLED` (404), `SERVER_ERROR` (500).

### 2.3 Lists
Query parameters: `page` (default 1), `per_page` (default 20, max 100), `sort` (for example `-created_at`), `q` (search text), plus screen-specific filters.
`meta`: `{ "page": 1, "per_page": 20, "total": 134, "total_pages": 7 }`
Bulk actions: `POST <resource>/bulk` with `{ "action": "delete" | "publish" | ..., "ids": [..] }`.

### 2.4 Editing safety
- Every editable record returns `updated_at` and `version`. The save request sends back the `version` it loaded. A mismatch returns `CONFLICT` and the GUI must offer reload or review.
- Destructive actions (delete, refund, role change) require a confirmation dialog in the GUI.
- Every write by an admin is recorded in the audit log with actor, action, record, before and after values.

### 2.5 Standard screen states (all screens)
1. Loading: skeleton shaped like the final content.
2. Empty: explanation plus the primary action to create the first record.
3. Error: message from `error.message`, a retry button, and a field-level display when `error.fields` is present.
4. Forbidden: shown when the role lacks the screen's view permission or the API returns 403.

### 2.6 Field types
`text`, `textarea`, `richtext`, `number`, `money` (integer minor units, currency from settings), `boolean`, `select`, `multiselect`, `date`, `datetime`, `image` (media id), `gallery` (list of media ids), `url`, `email`, `slug`, `json-blocks` (content blocks), `color`, `password` (write-only).

### 2.7 File uploads
1. `POST /api/v1/admin/media` multipart, returns `{ id, url, width, height, alt, mime, size }`.
2. Forms store the media `id`, never a raw URL.
3. Allowed types, max size and WebP conversion are returned by `GET /api/v1/admin/media/rules`.

## 3. Screen specification template

Copy this block for every screen.

```
### SCR-<MODULE>-<NAME>  <Screen title>
Admin route:        /admin/...
Module:             <module name, or core>
Purpose:            one sentence
Permissions:        view = <perm>; actions = <perm list>

Data loaded
  Endpoint:         METHOD /api/v1/admin/...
  Params:           ...
  Response fields:  name (type) - meaning

List screens only
  Columns:          label | field | sortable | notes
  Filters:          name | type | values
  Row actions:      label | endpoint | permission | confirm?
  Bulk actions:     ...

Form screens only
  Fields:           label | api field | type | required | validation | default | help text
  Groups/tabs:      order and grouping of fields

Actions
  Button | endpoint | permission | success behavior | audit event | cache tags purged | emails triggered

Edge cases:         conflicts, large data, dependent fields
Module toggle:      what disappears if the module is off
Contract tests:     list of tests that must exist
```

## 4. Screen index

Status values: `planned`, `in-api`, `documented`, `built`.

### Core (always on)
| ID | Screen | Route | View permission | Status |
|---|---|---|---|---|
| SCR-CORE-LOGIN | Admin login | /admin/login | public | in-api |
| SCR-CORE-DASH | Dashboard | /admin | core.dashboard.view | in-api |
| SCR-CORE-PAGES | Pages list | /admin/pages | core.pages.view | planned |
| SCR-CORE-PAGE-EDIT | Page content editor (blocks) | /admin/pages/:id | core.pages.edit | planned |
| SCR-CORE-MENUS | Menus and sub-menus | /admin/menus | core.menus.view | planned |
| SCR-CORE-MEDIA | Media library | /admin/media | core.media.view | planned |
| SCR-CORE-THEME | Theme settings (colors, fonts, logo, favicon) | /admin/theme | core.theme.edit | planned |
| SCR-CORE-SEO | Global and per-page SEO | /admin/seo | core.seo.view | planned |
| SCR-CORE-REDIRECTS | Redirects | /admin/redirects | core.redirects.view | planned |
| SCR-CORE-USERS | Users list and edit | /admin/users | core.users.view | planned |
| SCR-CORE-ROLES | Roles and permission matrix | /admin/roles | core.roles.view | in-api |
| SCR-CORE-SETTINGS | Site settings | /admin/settings | core.settings.view | planned |
| SCR-CORE-SMTP | SMTP setup and test send | /admin/email/smtp | core.email.settings | planned |
| SCR-CORE-EMAIL-TPL | Email template library | /admin/email/templates | core.email.view | planned |
| SCR-CORE-EMAIL-EDIT | Email template editor | /admin/email/templates/:id | core.email.edit | planned |
| SCR-CORE-EMAIL-AUTO | Automatic email switches | /admin/email/automation | core.email.edit | planned |
| SCR-CORE-EMAIL-LOG | Email log | /admin/email/log | core.email.view | planned |
| SCR-CORE-LEGAL | Legal pages and business details | /admin/legal | core.legal.edit | planned |
| SCR-CORE-COOKIES | Cookie consent settings and log | /admin/cookies | core.legal.edit | planned |
| SCR-CORE-CACHE | Cache purge | /admin/cache | core.cache.manage | planned |
| SCR-CORE-MODULES | Module toggles | /admin/modules | core.modules.manage | in-api |
| SCR-CORE-AUDIT | Audit log | /admin/logs/audit | core.logs.view | planned |
| SCR-CORE-ERRORS | Error and request logs | /admin/logs/errors | core.logs.view | planned |
| SCR-CORE-BACKUP | Backups | /admin/backup | core.backup.manage | planned |

### Module: blog
| ID | Screen | Route | View permission | Status |
|---|---|---|---|---|
| SCR-BLOG-POSTS | Posts list | /admin/blog/posts | blog.posts.view | planned |
| SCR-BLOG-POST-EDIT | Post editor | /admin/blog/posts/:id | blog.posts.edit | planned |
| SCR-BLOG-TAXONOMY | Categories, tags, authors | /admin/blog/taxonomy | blog.taxonomy.view | planned |

### Module: store
| ID | Screen | Route | View permission | Status |
|---|---|---|---|---|
| SCR-STORE-PRODUCTS | Products list | /admin/store/products | store.products.view | documented below |
| SCR-STORE-PRODUCT-EDIT | Product form | /admin/store/products/:id | store.products.edit | documented below |
| SCR-STORE-CATEGORIES | Categories | /admin/store/categories | store.categories.view | planned |
| SCR-STORE-INVENTORY | Inventory and stock history | /admin/store/inventory | store.inventory.view | planned |
| SCR-STORE-ORDERS | Orders list | /admin/store/orders | store.orders.view | planned |
| SCR-STORE-ORDER-VIEW | Order detail, fulfilment, refund | /admin/store/orders/:id | store.orders.view | planned |
| SCR-STORE-CUSTOMERS | Customers | /admin/store/customers | store.customers.view | planned |
| SCR-STORE-INVOICES | Invoices and receipts | /admin/store/invoices | store.invoices.view | planned |
| SCR-STORE-TAX | Tax configuration | /admin/store/tax | store.tax.edit | planned |
| SCR-STORE-COUPONS | Coupons | /admin/store/coupons | store.coupons.view | planned |
| SCR-STORE-PAYMENTS | Razorpay and COD settings | /admin/store/payments | store.payments.edit | planned |
| SCR-STORE-SHIPPING | Shipping partners and rules | /admin/store/shipping | store.shipping.edit | planned |
| SCR-STORE-REVIEWS | Review moderation | /admin/store/reviews | store.reviews.view | planned |
| SCR-STORE-META | Meta Pixel and catalog feed | /admin/store/meta | store.meta.edit | planned |

### Module: age-gate
| ID | Screen | Route | View permission | Status |
|---|---|---|---|---|
| SCR-AGE-SETTINGS | Age verification settings | /admin/age-gate | agegate.settings.edit | planned |

### Module: donations and news
Add screens here when the module is built, using the same template.

## 5. Worked examples

### SCR-STORE-PRODUCTS  Products list
```
Admin route:        /admin/store/products
Module:             store
Purpose:            Find, filter and bulk-manage products.
Permissions:        view = store.products.view; actions = store.products.edit, store.products.delete

Data loaded
  Endpoint:         GET /api/v1/admin/store/products
  Params:           page, per_page, sort, q, status, category_id, stock_state
  Response fields:  id (int), name (text), sku (text), price (money), stock (int),
                    status (draft|active|archived), thumbnail (media), updated_at (datetime)

Columns:            Image | thumbnail | no | -
                    Name | name | yes | links to edit screen
                    SKU | sku | yes | -
                    Price | price | yes | formatted with store currency
                    Stock | stock | yes | red badge when at or below low-stock threshold
                    Status | status | yes | badge
                    Updated | updated_at | yes | relative time
Filters:            status (select: all, draft, active, archived)
                    category_id (select from GET /api/v1/admin/store/categories)
                    stock_state (select: all, in_stock, low, out)
Row actions:        Edit | route to SCR-STORE-PRODUCT-EDIT | store.products.edit | no
                    Duplicate | POST /api/v1/admin/store/products/:id/duplicate | store.products.edit | no
                    Archive | PATCH /api/v1/admin/store/products/:id { status: "archived" } | store.products.edit | yes
                    Delete | DELETE /api/v1/admin/store/products/:id | store.products.delete | yes
Bulk actions:       publish, archive, delete, set category, adjust price by percent
Page actions:       New product | route to SCR-STORE-PRODUCT-EDIT with id "new"
                    Import CSV | POST /api/v1/admin/store/products/import
                    Export CSV | GET /api/v1/admin/store/products/export (same filters)

Edge cases:         Products with orders cannot be hard-deleted; API returns CONFLICT with message, GUI offers Archive.
                    Large catalogs: server pagination only, never load all rows.
Module toggle:      Navigation entry, route and API return nothing when store is disabled.
Contract tests:     list with each filter; sort by each sortable column; denied role gets 403;
                    delete product with orders returns CONFLICT; disabled module returns MODULE_DISABLED.
```

### SCR-STORE-PRODUCT-EDIT  Product form
```
Admin route:        /admin/store/products/:id
Module:             store
Purpose:            Create or edit a product, including its SEO.
Permissions:        view = store.products.view; actions = store.products.edit

Data loaded
  Endpoint:         GET /api/v1/admin/store/products/:id   (id "new" loads defaults from GET .../products/defaults)
  Response fields:  all fields below plus id, version, updated_at

Groups:             General | Pricing and tax | Inventory | Images | Variants | Shipping | SEO
Fields:
  Name              | name             | text      | yes | 2-160 chars
  Slug              | slug             | slug      | yes | unique, lowercase, auto from name until edited
  Description       | description      | richtext  | no  | sanitized server-side
  Short description | short_description| textarea  | no  | max 300
  Category          | category_ids     | multiselect | yes | at least one
  Status            | status           | select    | yes | draft, active, archived
  Price             | price            | money     | yes | 0 or more
  Compare-at price  | compare_price    | money     | no  | greater than price when set
  Tax class         | tax_class_id     | select    | yes | from tax configuration; shows HSN code
  SKU               | sku              | text      | yes | unique
  Stock             | stock            | number    | yes | integer, 0 or more; disabled when "track stock" is off
  Track stock       | track_stock      | boolean   | no  | default true
  Low-stock alert   | low_stock_at     | number    | no  | default from settings
  Age restricted    | age_restricted   | boolean   | no  | shown only when age-gate module is enabled
  Images            | image_ids        | gallery   | yes | first image is the primary; each requires alt text
  Variants          | variants[]       | list      | no  | option name, value, sku, price override, stock
  Weight and size   | weight_g, length_mm, width_mm, height_mm | number | needed when shipping module is on | used for shipping rates
  Country of origin | origin_country   | select    | no  | shown on product page when required
  SEO title         | seo.title        | text      | no  | max 60, live counter
  SEO description   | seo.description  | textarea  | no  | max 160, live counter
  SEO canonical     | seo.canonical    | url       | no  | -
  SEO robots        | seo.robots       | select    | no  | index/noindex, follow/nofollow
  Social image      | seo.og_image_id  | image     | no  | -

Actions
  Save draft        | PUT /api/v1/admin/store/products/:id (status draft) | store.products.edit | stay on screen, toast | audit product.updated | tags: product:{id}, catalog | none
  Publish           | PUT ... (status active) | store.products.edit | stay on screen, show view-on-site link | audit product.published | tags: product:{id}, catalog, sitemap | none
  Delete            | DELETE ... | store.products.delete | confirm, return to list | audit product.deleted | tags: product:{id}, catalog | none

Edge cases:         Version conflict on save -> show reload prompt with diff summary.
                    Unsaved changes -> confirm before leaving.
                    Slug change on a published product -> offer to create a 301 redirect (POST /api/v1/admin/redirects).
Module toggle:      Age restricted field hidden when age-gate is off; shipping fields hidden when no shipping adapter is enabled.
Contract tests:     create with only required fields; each validation rule fails with field-level error;
                    duplicate slug and sku rejected; stale version rejected; role without edit permission gets 403.
```

### SCR-CORE-SMTP  SMTP setup and test send
```
Admin route:        /admin/email/smtp
Module:             core (email)
Purpose:            Configure outgoing mail and prove it works.
Permissions:        view and actions = core.email.settings

Data loaded
  Endpoint:         GET /api/v1/admin/email/smtp
  Response fields:  host, port, security (none|ssl|starttls), username, password_set (boolean, never the password),
                    from_name, from_address, reply_to, last_test_at, last_test_status, version

Fields:
  Host            | host         | text     | yes | hostname
  Port            | port         | number   | yes | 1-65535; suggests 465 for ssl and 587 for starttls
  Security        | security     | select   | yes | none, ssl, starttls
  Username        | username     | text     | yes | -
  Password        | password     | password | on first save | write-only; blank means unchanged
  From name       | from_name    | text     | yes | -
  From address    | from_address | email    | yes | should match the sending domain
  Reply-to        | reply_to     | email    | no  | -

Actions
  Save            | PUT /api/v1/admin/email/smtp | core.email.settings | toast | audit email.smtp.updated | none | none
  Test connection | POST /api/v1/admin/email/smtp/test | core.email.settings | shows pass or the exact server error | audit email.smtp.tested | none | none
  Send test email | POST /api/v1/admin/email/test-send { to } | core.email.settings | shows queued, then delivered or failed with reason | audit email.test.sent | none | test template

Notes shown on screen: SPF, DKIM and DMARC records are needed for reliable delivery; link to the setup guide in the handover pack.
Contract tests:     password never returned by GET; blank password keeps the stored one; bad credentials return a readable error;
                    role without permission gets 403.
```

## 6. Completion checklist for cms-core agents

- [ ] Every screen in section 4 has a full spec block, not just an index row
- [ ] Every endpoint referenced exists in `openapi.json`
- [ ] Every permission referenced exists in the permission seed
- [ ] Every screen has contract tests for allowed role, denied role and disabled module
- [ ] Contract version and cms-core version match the release tag
- [ ] Section 8 has an entry for every change since the last release

## 7. Completion checklist for GUI agents

- [ ] Every screen built from its spec, with the four standard states
- [ ] Navigation comes from the navigation endpoint
- [ ] Controls hidden by permission and 403 handled gracefully
- [ ] No endpoint or field used that is not in this file
- [ ] Version conflict, unsaved-changes and confirmation dialogs implemented
- [ ] Uploads go through the media endpoint and forms store media ids

## 8. Contract change log

| Contract version | cms-core version | Date | Change |
|---|---|---|---|
| 0.1.0 | 0.1.0 | 2026-10-25 | Initial skeleton and CP2.1 core setup |
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.3 Module toggles API and navigation endpoint (in-api) |
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.4 Auth API: signup, login, lockout, 2FA, password resets (in-api) |
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.5 RBAC: roles list, permission matrix update, staff invite, requirePermission/requireRole guards (in-api) |
