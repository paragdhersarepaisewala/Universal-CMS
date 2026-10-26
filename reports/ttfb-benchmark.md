# TTFB (Time-To-First-Byte) Latency Benchmark Report

Generated: 2026-10-26T07:19:24.345Z
Runtime: Node.js 22 LTS / Fastify 4.28
Database Pool: MySQL 8.4 (pool size: 5)
Total Requests: 1000
Total Execution Time: 0.44 seconds
Throughput: **2256 req/sec**

## Overall Latency Metrics

| Metric | Latency (ms) | Target SLA | Compliance |
|---|---|---|---|
| **Minimum** | 0.15 ms | < 50 ms | PASS |
| **Average** | 0.44 ms | < 100 ms | PASS |
| **p50 (Median)** | 0.41 ms | < 50 ms | PASS |
| **p95** | 0.84 ms | < 150 ms | PASS |
| **p99** | 1.10 ms | < 250 ms | PASS |
| **Maximum** | 3.94 ms | < 500 ms | PASS |

## Endpoint-by-Endpoint Breakdown

| Endpoint | Label | Requests | Avg (ms) | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|
| `/api/v1/health` | System Health Check | 167 | 0.27 ms | 0.24 ms | 0.47 ms |
| `/api/v1/blog/posts` | Blog Posts List | 167 | 0.45 ms | 0.42 ms | 0.67 ms |
| `/api/v1/blog/authors` | Author Directory | 167 | 0.63 ms | 0.57 ms | 0.99 ms |
| `/api/v1/seo/jsonld/organization` | SEO Schema.org JSON-LD | 167 | 0.26 ms | 0.24 ms | 0.38 ms |
| `/api/v1/store/products` | Store Products Catalog | 166 | 0.64 ms | 0.56 ms | 1.03 ms |
| `/api/v1/donations/campaigns` | Donation Campaigns | 166 | 0.40 ms | 0.38 ms | 0.64 ms |
