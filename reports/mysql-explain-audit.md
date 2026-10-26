# MySQL 8.4 EXPLAIN Query Plan Audit & Index Optimization Report

Generated: 2026-10-26T07:16:25.747Z
Database Engine: MySQL 8.4 (InnoDB, utf8mb4_unicode_ci)
Host: localhost:3306 (Configured for Hostinger Web Apps Node.js environment)

## Executive Summary

All core entity lookups, customer partition queries, and index traversals utilize indexed B-Tree keys (`const`, `eq_ref`, or `ref`). Zero unindexed full table scans exist for targeted operational records.

## Detailed Query Plans

### Product Lookup by Slug

**Query:** `SELECT * FROM products WHERE slug = "sample-product"`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | null | NULL | `null` | NULL | **NULL** | NULL | NULL | null | 100% | no matching row in const table |

**Assessment:** ACCEPTABLE / COMPOSITE CANDIDATE

### Product Filter by Status & Created Date

**Query:** `SELECT * FROM products WHERE status = "published" ORDER BY created_at DESC LIMIT 20`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | products | NULL | `ref` | idx_products_status | **idx_products_status** | 82 | const | 1 | 100% | Using filesort |

**Assessment:** OPTIMAL (Index Hit)

### Order Lookup by Order Number

**Query:** `SELECT * FROM orders WHERE order_number = "ORD-2026-0001"`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | null | NULL | `null` | NULL | **NULL** | NULL | NULL | null | 100% | no matching row in const table |

**Assessment:** ACCEPTABLE / COMPOSITE CANDIDATE

### Customer Order History by Customer ID

**Query:** `SELECT * FROM orders WHERE customer_id = 1 ORDER BY created_at DESC`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | orders | NULL | `ref` | idx_orders_customer | **idx_orders_customer** | 9 | const | 1 | 100% | Using filesort |

**Assessment:** OPTIMAL (Index Hit)

### Stock Movement Ledger by Product & Reference

**Query:** `SELECT * FROM stock_movements WHERE product_id = 1 AND change_type = "sale" ORDER BY created_at DESC`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | stock_movements | NULL | `ref` | idx_stock_prod | **idx_stock_prod** | 8 | const | 2 | 10% | Using where; Using filesort |

**Assessment:** OPTIMAL (Index Hit)

### Blog Post Lookup by Slug

**Query:** `SELECT * FROM blog_posts WHERE slug = "welcome-to-universal-cms"`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | null | NULL | `null` | NULL | **NULL** | NULL | NULL | null | 100% | no matching row in const table |

**Assessment:** ACCEPTABLE / COMPOSITE CANDIDATE

### Blog Author Published Articles Index

**Query:** `SELECT * FROM blog_posts WHERE author_id = 1 AND status = "published" ORDER BY created_at DESC`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | blog_posts | NULL | `ref` | idx_blog_status,idx_blog_author | **idx_blog_author** | 8 | const | 4 | 100% | Using where; Using filesort |

**Assessment:** OPTIMAL (Index Hit)

### Author Profile Lookup by Slug

**Query:** `SELECT * FROM author_profiles WHERE slug = "admin"`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | null | NULL | `null` | NULL | **NULL** | NULL | NULL | null | 100% | no matching row in const table |

**Assessment:** ACCEPTABLE / COMPOSITE CANDIDATE

### Editorial History by Post ID

**Query:** `SELECT * FROM blog_editorial_history WHERE post_id = 1 ORDER BY created_at DESC`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | blog_editorial_history | NULL | `ref` | idx_editorial_post | **idx_editorial_post** | 8 | const | 1 | 100% | Using filesort |

**Assessment:** OPTIMAL (Index Hit)

### Recurring Donation Subscriptions by Customer

**Query:** `SELECT * FROM donation_subscriptions WHERE subscription_id = "sub_mock_123"`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | null | NULL | `null` | NULL | **NULL** | NULL | NULL | null | 100% | no matching row in const table |

**Assessment:** ACCEPTABLE / COMPOSITE CANDIDATE

### Digital Entitlement Download Token Verification

**Query:** `SELECT * FROM digital_entitlements WHERE download_token = "dl_sample_token"`

| id | select_type | table | partitions | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | null | NULL | `null` | NULL | **NULL** | NULL | NULL | null | 100% | no matching row in const table |

**Assessment:** ACCEPTABLE / COMPOSITE CANDIDATE

