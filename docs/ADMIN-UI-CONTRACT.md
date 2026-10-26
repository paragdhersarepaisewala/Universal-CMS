# ADMIN-UI-CONTRACT.md

Location: `cms-core/docs/ADMIN-UI-CONTRACT.md`

```
Contract version:   0.2.6
cms-core version:   0.2.6
Last updated:       2026-10-26
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
| SCR-CORE-PAGES | Pages list | /admin/pages | core.pages.view | in-api |
| SCR-CORE-PAGE-EDIT | Page content editor (blocks) | /admin/pages/:id | core.pages.edit | in-api |
| SCR-CORE-MENUS | Menus and sub-menus | /admin/menus | core.menus.view | in-api |
| SCR-CORE-MEDIA | Media library | /admin/media | core.media.view | in-api |
| SCR-CORE-THEME | Theme settings (colors, fonts, logo, favicon) | /admin/theme | core.theme.edit | in-api |
| SCR-CORE-SEO | Global and per-page SEO | /admin/seo | core.seo.view | in-api |
| SCR-CORE-REDIRECTS | Redirects | /admin/redirects | core.redirects.view | in-api |
| SCR-CORE-USERS | Users list and edit | /admin/users | core.users.view | in-api |
| SCR-CORE-ROLES | Roles and permission matrix | /admin/roles | core.roles.view | in-api |
| SCR-CORE-SETTINGS | Site settings | /admin/settings | core.settings.view | in-api |
| SCR-CORE-SMTP | SMTP setup and test send | /admin/email/smtp | core.email.settings | in-api |
| SCR-CORE-EMAIL-TPL | Email template library | /admin/email/templates | core.email.view | in-api |
| SCR-CORE-EMAIL-EDIT | Email template editor | /admin/email/templates/:id | core.email.edit | in-api |
| SCR-CORE-EMAIL-AUTO | Automatic email switches | /admin/email/automation | core.email.edit | in-api |
| SCR-CORE-EMAIL-LOG | Email log | /admin/email/log | core.email.view | in-api |
| SCR-CORE-LEGAL | Legal pages and business details | /admin/legal | core.legal.edit | in-api |
| SCR-CORE-COOKIES | Cookie consent settings and log | /admin/cookies | core.legal.edit | in-api |
| SCR-CORE-CACHE | Cache purge | /admin/cache | core.cache.manage | in-api |
| SCR-CORE-MODULES | Module toggles | /admin/modules | core.modules.manage | in-api |
| SCR-CORE-AUDIT | Audit log | /admin/logs/audit | core.logs.view | in-api |
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

### SCR-CORE-TOKENS  API Access Tokens Management
```
Admin route:        /admin/tokens
Module:             core
Purpose:            Issue, list, and revoke API access tokens with granular permission scopes.
Permissions:        view = core.settings.view, actions = core.settings.edit

Data loaded
  Endpoint:         GET /api/v1/admin/tokens
  Response fields:  id, name, tokenPrefix, scopes (array of string), userId, lastUsedAt, createdAt, expiresAt

Fields:
  Token name      | name     | text     | yes | Human-readable descriptor (e.g. Zapier Integration)
  Scopes          | scopes   | multiselect | yes | read, write, admin, or resource-specific keys
  Expiration      | expiresAt | datetime | no  | Optional validity deadline

Actions
  Create token    | POST /api/v1/admin/tokens | core.settings.edit | display modal with raw token string (one-time view) | audit tokens.created | none | none
  Revoke token    | DELETE /api/v1/admin/tokens/:id | core.settings.edit | confirm dialog, remove from list | audit tokens.revoked | none | none

Notes shown on screen: The full API token is only visible once upon generation.
Contract tests:     Unauthorized returns 401; non-admin gets 403; tokenHash is never exposed in responses.
```

### SCR-CORE-WEBHOOKS  Outbound Webhook Subscriptions
```
Admin route:        /admin/webhooks
Module:             core
Purpose:            Register webhook endpoints, configure events, and test HMAC-signed delivery.
Permissions:        view = core.settings.view, actions = core.settings.edit

Data loaded
  Endpoint:         GET /api/v1/admin/webhooks
  Response fields:  id, url, events (array of string), secret, isActive, createdAt

Fields:
  Endpoint URL    | url      | url      | yes | Destination HTTPS URL
  Trigger Events  | events   | multiselect | yes | page.published, user.registered, order.created, or * (wildcard)
  Custom Secret   | secret   | text     | no  | Optional custom signing secret; auto-generated if omitted

### 5.16 Store: Products Catalog & Inventory (`STORE-01`)
```
Screen id:          STORE-01
Route in GUI:       /admin/store/products
Module:             store
Permissions:        view = store.products.view, actions = store.products.edit

Data loaded
  Endpoint:         GET /api/v1/admin/store/products
  Query params:     q, status, page, perPage
  Response fields:  id, name, slug, price, compareAtPrice, productType, stockQuantity, status

Fields (Create / Edit):
  Product Name      | name              | text     | yes | Product title
  Slug              | slug              | text     | yes | Unique URL slug
  Product Type      | productType       | select   | yes | physical or digital (digital requires digital-delivery module)
  Price (Paise)     | price             | number   | yes | Price in integer paise
  Compare Price     | compareAtPrice    | number   | no  | Original strike-through price
  SKU               | sku               | text     | no  | Inventory stock keeping unit
  Stock Quantity    | stockQuantity     | number   | no  | Available units (disabled if trackStock is false)
  Track Stock       | trackStock        | boolean  | no  | Track inventory (default true for physical, false for digital)
  Allow Backorder   | allowBackorder    | boolean  | no  | Allow checkout when stock reaches 0
  Status            | status            | select   | yes | draft, active, archived

Actions
  Create Product    | POST /api/v1/admin/store/products | store.products.edit | toast, add to list | audit store.product.created
  Update Product    | PUT /api/v1/admin/store/products/:id | store.products.edit | toast, update list | audit store.product.updated
```

### 5.17 Store: Orders & State Transitions (`STORE-02`)
```
Screen id:          STORE-02
Route in GUI:       /admin/store/orders
Module:             store
Permissions:        view = store.orders.view, actions = store.orders.edit

Data loaded
  Endpoint:         GET /api/v1/admin/store/orders
  Query params:     status, page, perPage
  Response fields:  id, orderNumber, customerEmail, status, total, paymentMethod, paymentStatus, createdAt

Actions
  View Order        | GET /api/v1/admin/store/orders/:id | store.orders.view | opens detail drawer/page
  Transition Status | POST /api/v1/admin/store/orders/:id/transition { status, reason } | store.orders.edit | toast, refreshes timeline | audit store.order.transitioned
  Add Note          | POST /api/v1/admin/store/orders/:id/notes { note, isCustomerVisible } | store.orders.edit | appends note | audit store.order.note_added
```

### 5.18 Store: Order Refunds (`STORE-03`)
```
Screen id:          STORE-03
Route in GUI:       /admin/store/orders/:id/refund
Module:             store
Permissions:        actions = store.orders.refund

Fields:
  Refund Amount     | amountPaise       | number   | no  | Manual refund amount or derived from lines
  Line Items        | lineItems         | array    | no  | orderItemId, quantity
  Reason            | reason            | text     | yes | Explanation for refund
  Idempotency Key   | idempotencyKey    | text     | yes | Unique client-generated key
  Restock Inventory | restock           | boolean  | no  | Restock physical quantities into inventory

Actions
  Issue Refund      | POST /api/v1/admin/store/orders/:id/refund | store.orders.refund | confirms with gateway, records refund | audit store.order.refunded
```

### 5.19 Store: Tax Classes & Indian States (`STORE-04`)
```
Screen id:          STORE-04
Route in GUI:       /admin/store/tax-classes
Module:             store
Permissions:        view = store.products.view, actions = store.tax.manage

Data loaded
  States:           GET /api/v1/admin/store/states
  Tax Classes:      GET /api/v1/admin/store/tax-classes

Fields (Create / Edit):
  Class Name        | name              | text     | yes | Descriptor (e.g. Standard GST 18%)
  Kind              | kind              | select   | yes | goods or service
  Code Type         | codeType          | select   | yes | HSN or SAC
  HSN/SAC Code      | code              | text     | yes | Official tariff classification code
  Rate (Basis Points)| rateBasisPoints  | number   | yes | Rate in bps (1800 = 18.00%, 500 = 5.00%)
  Cess (Basis Points)| cessBasisPoints  | number   | no  | Compensation cess in bps (default: 0)
  Exempt Flag       | isExempt          | boolean  | no  | Zero-rated / exempted from GST

Actions
  Create Class      | POST /api/v1/admin/store/tax-classes | store.tax.manage | saves class | audit tax_class.create
  Update Class      | PUT /api/v1/admin/store/tax-classes/:id | store.tax.manage | updates rate/code | audit tax_class.update
```

### 5.20 Store: Tax & Cash on Delivery Settings (`STORE-05`)
```
Screen id:          STORE-05
Route in GUI:       /admin/store/settings/tax-cod
Module:             store
Permissions:        view = store.tax.manage, actions = store.tax.manage

Data loaded
  Endpoint:         GET /api/v1/admin/store/settings/tax-cod
  Response fields:  sellerRegistrationType, sellerGstin, sellerLegalName, sellerTradeName, sellerState, priceIncludesTax, roundingMode, shippingTaxMode, codEnabled, codMinOrderPaise, codMaxOrderPaise, codFeePaise, codBlockedPincodes, codRequiresConfirmation

Fields:
  Registration Type | sellerRegistrationType | select | yes | regular, composition, or unregistered
  Seller GSTIN      | sellerGstin            | text   | yes | 15-character statutory GST identification number
  Legal Entity Name | sellerLegalName        | text   | yes | Legal name on GST certificate
  Trade Name        | sellerTradeName        | text   | no  | Brand or storefront trade name
  Seller State Code | sellerState            | select | yes | 2-digit official state GST code (e.g. 27 for Maharashtra)
  Price Includes Tax| priceIncludesTax        | boolean| yes | True if displayed prices are tax-inclusive
  Rounding Mode     | roundingMode           | select | yes | per_line or per_invoice
  COD Enabled       | codEnabled             | boolean| yes | Enable or disable Cash on Delivery
  Min COD Order     | codMinOrderPaise       | number | yes | Minimum order total in integer paise for COD
  Max COD Order     | codMaxOrderPaise       | number | yes | Maximum order total in integer paise for COD
  COD Surcharge Fee | codFeePaise            | number | yes | Fixed COD handling fee in integer paise
  Blocked Pincodes  | codBlockedPincodes     | array  | no  | Blocklisted delivery pincodes unserviceable for COD
  Requires Confirm  | codRequiresConfirmation| boolean| yes | Await admin confirmation before order moves to confirmed

Actions
  Save Settings     | PUT /api/v1/admin/store/settings/tax-cod | store.tax.manage | saves settings, invalidates cache | audit store_settings.update
```

### 5.21 Store: GST Tax Invoices & Credit Notes (`STORE-06`)
```
Screen id:          STORE-06
Route in GUI:       /admin/store/invoices
Module:             store
Permissions:        view = store.invoices.view, actions = none (immutable accounting ledgers)

Data loaded
  Invoices:         GET /api/v1/admin/store/invoices (query: financialYear, status, orderId, page, perPage)
  Single Invoice:   GET /api/v1/admin/store/invoices/:id
  Download PDF:     GET /api/v1/admin/store/invoices/:id/pdf
  Credit Notes:     GET /api/v1/admin/store/credit-notes (query: financialYear, page, perPage)
  Single Note:      GET /api/v1/admin/store/credit-notes/:id
  Download Note PDF:GET /api/v1/admin/store/credit-notes/:id/pdf

Customer Endpoints:
  Order Invoice     | GET /api/v1/store/orders/:id/invoice (authenticated customer or guest token)
  Order Invoice PDF | GET /api/v1/store/orders/:id/invoice/pdf (authenticated customer or guest token)
```

### 5.22 Shipping: Zones & Weight-Based Rates (`SHIP-01`)
```
Screen id:          SHIP-01
Route in GUI:       /admin/shipping/zones
Module:             shipping
Permissions:        view = shipping.view, actions = shipping.manage

Data loaded
  List Zones:       GET /api/v1/admin/shipping/zones
  Single Zone:      GET /api/v1/admin/shipping/zones/:id

Actions:
  Create Zone       | POST /api/v1/admin/shipping/zones { name, countries, states, pincodes, priority }
  Update Zone       | PUT /api/v1/admin/shipping/zones/:id { name, countries, states, pincodes, priority, isActive }
  Delete Zone       | DELETE /api/v1/admin/shipping/zones/:id
  Add Rate Tier     | POST /api/v1/admin/shipping/zones/:id/rates { name, rateType, minWeightGrams, maxWeightGrams, minOrderPaise, maxOrderPaise, ratePaise, estimatedDaysMin, estimatedDaysMax }
```

### 5.23 Shipping: Shipments & AWB Manifestation (`SHIP-02`)
```
Screen id:          SHIP-02
Route in GUI:       /admin/shipping/shipments
Module:             shipping
Permissions:        view = shipping.view, actions = shipping.shipments.manage

Data loaded
  List Shipments:   GET /api/v1/admin/shipping/shipments (query: page, perPage, status)
  Tracking Detail:  GET /api/v1/admin/shipping/shipments/:id
  Download Label:   GET /api/v1/admin/shipping/shipments/:id/label

Actions:
  Manifest Shipment | POST /api/v1/admin/shipping/shipments { orderId, partner, weightGrams, carrierName, shippingFeePaise }
  Cancel Waybill    | POST /api/v1/admin/shipping/shipments/:id/cancel
```

### 5.24 Shipping: Carrier Settings & Partner Configuration (`SHIP-03`)
```
Screen id:          SHIP-03
Route in GUI:       /admin/shipping/settings
Module:             shipping
Permissions:        view = shipping.view, actions = shipping.manage

Data loaded
  Settings:         GET /api/v1/admin/shipping/settings

Actions:
  Update Settings   | PUT /api/v1/admin/shipping/settings { originPincode, originCity, originState, originCountry, defaultPartner, activePartners, disabledBehavior, fallbackRatePaise, freeShippingThresholdPaise, shiprocketApiKey, shiprocketApiSecret, delhiveryApiKey, delhiveryClientName }

Customer / Storefront Endpoints:
  Calculate Rates   | POST /api/v1/shipping/rates { items, destination: { country, state, pincode }, cod }
  Serviceability    | POST /api/v1/shipping/serviceability { pincode, weightGrams, cod, partner }
  Tracking Webhook  | POST /api/v1/shipping/webhook/:partner (inbound status update from carrier)
```

### 5.24 Digital Delivery: Assets Management (`DIGITAL-01`)
```
Screen id:          DIGITAL-01
Route in GUI:       /admin/digital/assets
Module:             digital-delivery
Permissions:        view = digital.view, actions = digital.manage

Data loaded
  Endpoint:         GET /api/v1/admin/digital/assets
  Query params:     productId (optional)
  Row fields:       id, productId, variantId, fileName, storagePath, fileSizeBytes, mimeType, downloadLimit, expiresHours, isActive, createdAt

Fields (Upload / Create):
  Product           | productId         | select   | yes | Digital product identifier
  Variant           | variantId         | select   | no  | Specific SKU variant (optional)
  File Name         | fileName          | text     | yes | Customer-facing filename (e.g. guide-v1.pdf)
  Storage Path      | storagePath       | text     | yes | Internal filesystem or S3 key path
  File Size         | fileSizeBytes     | number   | no  | Size in bytes
  MIME Type         | mimeType          | text     | no  | application/pdf, application/zip
  Download Limit    | downloadLimit     | number   | yes | Maximum allowed downloads per token (default: 5)
  Expiry (Hours)    | expiresHours      | number   | yes | Token expiration lifespan in hours (default: 72)

Actions
  Upload Asset      | POST /api/v1/admin/digital/assets | digital.manage | attaches file to digital product | audit digital.assets.create
  Deactivate Asset  | DELETE /api/v1/admin/digital/assets/:id | digital.manage | marks asset inactive | audit digital.assets.delete
```

### 5.25 Digital Delivery: License Key Pools & Entitlements (`DIGITAL-02`)
```
Screen id:          DIGITAL-02
Route in GUI:       /admin/digital/licenses
Module:             digital-delivery
Permissions:        view = digital.view, actions = digital.manage

Data loaded
  Endpoint:         GET /api/v1/admin/digital/licenses
  Query params:     productId, status (available, assigned, revoked), limit, offset
  Row fields:       id, productId, variantId, licenseKey, status, orderId, orderItemId, assignedAt, metadataJson

Fields (Pool Bulk Upload):
  Product           | productId         | select   | yes | Digital product
  Variant           | variantId         | select   | no  | Optional variant
  License Keys      | keys              | textarea | yes | List of unique license keys (one per line)
  Metadata          | metadata          | json     | no  | Custom activation attributes

Actions
  Bulk Upload Keys  | POST /api/v1/admin/digital/licenses/pool | digital.manage | populates license pool | audit digital.licenses.upload
  Revoke Entitlement| POST /api/v1/admin/digital/entitlements/:id/revoke | digital.manage | revokes key and download access | audit digital.entitlements.revoke

Storefront / Customer endpoints:
  Order Entitlements| GET /api/v1/digital/orders/:orderId/entitlements (requires x-guest-token or user auth)
  Secure Download   | GET /api/v1/digital/download/:token (validates expiry & download count, streams content)
  Verify License    | POST /api/v1/digital/licenses/verify { licenseKey }
```

### 5.26 Store: Customer Management & Return Requests (`STORE-07`)
```
Screen id:          STORE-07
Route in GUI:       /admin/store/customers
Module:             store
Permissions:        view = store.customers.view, actions = store.customers.manage

Data loaded
  Customers List:   GET /api/v1/admin/store/customers (query: page, perPage, search, segment)
  Single Customer:  GET /api/v1/admin/store/customers/:id
  CSV Export:       GET /api/v1/admin/store/customers/export
  Return Requests:  GET /api/v1/admin/store/return-requests (query: status)

Customer Row Fields:
  id, name, email, phone, customerSegment, totalOrders, totalSpentPaise, isActive, createdAt

Customer Detail Fields:
  profile:          name, email, phone, dateOfBirth, communicationPreferences, customerSegment, totalOrders, totalSpentPaise
  addresses:        list of saved addresses (with default flag)
  orders:           order history with total, status, and paymentStatus
  wishlist:         saved wishlist products with live price and stock
  returnRequests:   item returns with reasons and statuses
  notes:            internal staff notes with author and timestamp

Actions:
  Update Segment    | PUT /api/v1/admin/store/customers/:id/segment { segment } | store.customers.manage | assigns segment | audit customer.segment.updated
  Add Staff Note    | POST /api/v1/admin/store/customers/:id/notes { note } | store.customers.manage | appends note | audit customer.note.created
  Transition Return | POST /api/v1/admin/store/return-requests/:id/transition { status, adminNotes } | store.customers.manage | updates return status | audit customer.return.transitioned

Storefront / Customer Endpoints:
  Customer Profile  | GET /api/v1/store/customer/profile
  Update Profile    | PUT /api/v1/store/customer/profile { name, phone, dateOfBirth, communicationPreferences }
  Change Password   | POST /api/v1/store/customer/change-password { currentPassword, newPassword }
  Saved Addresses   | GET, POST /api/v1/store/customer/addresses, PUT, DELETE /api/v1/store/customer/addresses/:id, POST /api/v1/store/customer/addresses/:id/default
  Wishlist          | GET /api/v1/store/customer/wishlist, POST /api/v1/store/customer/wishlist { productId }, DELETE /api/v1/store/customer/wishlist/:productId
  Order History     | GET /api/v1/store/customer/orders, GET /api/v1/store/customer/orders/:id
  Reorder           | POST /api/v1/store/customer/orders/:id/reorder (returns validated items ready for checkout)
  Return Request    | POST /api/v1/store/customer/orders/:id/return-request { orderItemId, reason }
  DPDP Data Export  | POST /api/v1/store/customer/export-data (returns full user data payload)
  DPDP Deletion     | POST /api/v1/store/customer/delete-account { passwordConfirm } (anonymizes PII, erases addresses/wishlist/sessions)
```
### 5.27 Dashboard: Statistics & Business Intelligence (`DASH-01`)
```
Screen id:          DASH-01
Route in GUI:       /admin/dashboard
Module:             core
Permissions:        view = core.dashboard.view

Data loaded
  Endpoint:         GET /api/v1/admin/dashboard/stats
  Data fields:
    business:       totalOrders, pendingOrders, totalRevenuePaise, averageOrderValuePaise
    catalog:        totalProducts, lowStockProducts, activeProducts
    customers:      totalCustomers, segmentCounts (standard, vip, wholesale)
    content:        totalPages, totalArticles
    donations:      totalDonationsPaise, totalContributions
    system:         uptimeSeconds, memoryUsageBytes (rss, heapTotal, heapUsed), environment, timestamp
```

### 5.28 Observability: Diagnostics & Error Logs (`LOGS-01`)
```
Screen id:          LOGS-01
Route in GUI:       /admin/logs
Module:             core
Permissions:        view = core.logs.view, actions = core.email.edit

Data loaded
  System Info:      GET /api/v1/admin/logs/system
  System Fields:    uptimeSeconds, nodeVersion, platform, architecture, pid, memoryBytes, cpuUsageMicros, jobsSummary

  Unified Errors:   GET /api/v1/admin/logs/errors (query: page, perPage, source = all|jobs|email)
  Error Row Fields: id, source, identifier, errorMessage, payload, failedAt

  Email Dispatch:   GET /api/v1/admin/email/logs (query: page, per_page, status)
  Email Row Fields: id, templateId, recipient, subject, status, errorMessage, attempts, sentAt, createdAt

Actions:
  Resend Email:     POST /api/v1/admin/email/logs/:id/resend | core.email.edit | re-enqueues failed/sent email
  Process Queue:    POST /api/v1/admin/email/queue/process | core.email.settings | manually drains queued emails
```

### 5.29 SEO: Structured Data JSON-LD Generation (`SEO-02`)
```
Screen id:          SEO-02
Route in GUI:       /admin/seo
Module:             core
Permissions:        view = core.seo.view, actions = core.seo.edit

Storefront / Headless Consumer Endpoints:
  Global Schemas:   GET /api/v1/seo/jsonld/:type (type: organization | website | breadcrumb)
  Entity Schemas:   GET /api/v1/seo/jsonld/:type/:idOrSlug (type: article | product)

Output Format:      application/ld+json Schema.org compliant structured metadata graph
```

### 5.30 Store: Inventory Stock History & Ledger (`STORE-08`)
```
Screen id:          STORE-08
Route in GUI:       /admin/store/inventory
Module:             store
Permissions:        view = store.products.view, actions = store.products.edit

Data loaded
  Endpoint:         GET /api/v1/admin/store/inventory/history
  Query params:     productId, variantId, changeType (restock, adjustment, release, reservation, damaged, bulk_import), page, perPage
  Row fields:       id, productId, productName, productSku, variantId, quantity, changeType, reason, referenceId, actorName, createdAt

Actions:
  Adjust Stock:     POST /api/v1/admin/store/inventory/adjust { productId, variantId, quantityDelta, changeType, reason } | store.products.edit | updates stock and creates ledger record
```

### 5.31 Store: Products Bulk CSV Import & Export (`STORE-09`)
```
Screen id:          STORE-09
Route in GUI:       /admin/store/products
Module:             store
Permissions:        view = store.products.view, actions = store.products.edit

Actions:
  Export CSV:       GET /api/v1/admin/store/products/export | store.products.view | streams products.csv with formula-injection defenses
  Bulk Import CSV:  POST /api/v1/admin/store/products/import { csv } | store.products.edit | parses rows, upserts products by SKU/slug, logs stock movements
```

### 5.32 Marketing: Meta Product Catalog Feeds & Conversions API (`FEED-01`)
```
Screen id:          FEED-01
Module:             store
Permissions:        public storefront feed endpoints

Storefront Endpoints:
  XML Catalog Feed: GET /api/v1/store/products/feed/meta.xml (Meta Business Manager RSS 2.0 schema)
  CSV Catalog Feed: GET /api/v1/store/products/feed/meta.csv (Meta Business Manager CSV format)

Conversions API:
  Server-Side CAPI: MetaCapiService.dispatchEvent({ eventName: 'Purchase'|'InitiateCheckout'|'AddToCart', userData, customData }) with SHA-256 hashed customer PII
```

### 5.33 Fundraising: Recurring Donation Subscriptions & 80G Receipts (`DONATE-01`)
```
Screen id:          DONATE-01
Route in GUI:       /admin/donations/subscriptions
Module:             donations
Permissions:        view = donations.subscriptions.view, actions = donations.subscriptions.manage

Data loaded
  Endpoint:         GET /api/v1/admin/donations/subscriptions
  Query params:     campaignId (optional), status (active, paused, cancelled), donorEmail (optional)
  Row fields:       id, campaignId, campaignTitle, donorName, donorEmail, donorPan, amount, frequency, subscriptionId, planId, status, totalCharges, totalRaised, startedAt, nextChargeAt, cancelledAt

Actions:
  Cancel Sub:       POST /api/v1/admin/donations/subscriptions/:id/cancel | donations.subscriptions.manage | terminates recurring donation subscription | audit donations.subscriptions.cancel

Storefront & Donor endpoints:
  Initiate Sub:     POST /api/v1/donations/subscribe { campaignSlug, donorName, donorEmail, donorPan, amount, frequency: 'monthly'|'quarterly'|'yearly', isAnonymous }
  Webhook Handler:  POST /api/v1/donations/webhook (handles subscription.charged, subscription.paused, subscription.cancelled with HMAC-SHA256 signature verification)
  My Subscriptions: GET /api/v1/donations/my-subscriptions (requires donor auth)
  Donor Cancel Sub: POST /api/v1/donations/subscriptions/:id/cancel (requires donor auth and ownership verification)
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
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.6 Email engine: SMTP AES-256 encrypted settings, test send, 14 automation triggers, templates, queue with retry backoff, marketing unsubscribe (in-api) |
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.7 Cache layer: memory and file drivers, tag-based invalidation, admin cache status and purge endpoints (in-api) |
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.8 Content, theme, and compliance API: pages, blocks, menus, media, SEO, redirects, India legal drafts, consent logs, site settings, and audit logging (in-api) |
| 0.1.0 | 0.1.0 | 2026-10-25 | CP2.9 API Contract: API Tokens, outbound Webhooks HMAC signing, API.md reference, and Gate 2 sign-off (in-api) |
| 0.2.0 | 0.2.0 | 2026-10-25 | H2.1 Store Engine: atomic stock reservation, payments, Razorpay webhooks, state machine, order notes, refunds, digital/physical handlers (in-api) |
| 0.2.1 | 0.2.1 | 2026-10-25 | H2.2 Store Engine: GST tax classes, Indian states/UTs, sequential FY invoices, credit notes, PDF generation, COD rule engine (in-api) |
| 0.2.2 | 0.2.2 | 2026-10-25 | H2.3 Shipping Engine: zones, weight-based rates, partner adapters (Shiprocket, Delhivery, Manual), shipments, AWBs, live tracking, webhooks (in-api) |
| 0.2.3 | 0.2.3 | 2026-10-25 | H2.3D Digital Delivery: digital assets, license key pools, tokenized downloads, order entitlements, revocation on refund (in-api) |
| 0.2.4 | 0.2.4 | 2026-10-25 | H2.4 Customer Accounts: customer profiles, saved addresses, wishlist, order history, return requests, DPDP export & deletion, admin management (in-api) |
| 0.2.5 | 0.2.5 | 2026-10-26 | H2.5 Admin Operations: dashboard statistics, system & error logs, email logs/aliases/automation triggers, Schema.org JSON-LD generation (in-api) |
| 0.2.6 | 0.2.6 | 2026-10-26 | H2.6 Ecommerce Operations: inventory stock history ledger, manual adjustments, bulk CSV product import/export, Meta catalog feeds, abandoned cart job, and Meta CAPI (in-api) |
| 0.2.7 | 0.2.7 | 2026-10-26 | H2.7 Recurring Donations: subscription plans, webhook charged/paused/cancelled events, automated thank-you emails, and 80G tax receipts (in-api) |




