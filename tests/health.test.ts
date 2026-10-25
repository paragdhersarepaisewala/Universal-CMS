import { describe, it, expect, vi, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import * as poolModule from '../src/db/pool.js';

describe('Health and OpenAPI Endpoints', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 with standard response envelope when DB is healthy', async () => {
    const spy = vi.spyOn(poolModule, 'checkDatabaseHealth').mockResolvedValue({
      connected: true,
      poolLimit: 5,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('data');
    expect(body.data.status).toBe('ok');
    expect(body.data.version).toBe('0.1.0');
    expect(body.data.database.connected).toBe(true);
    expect(body.data.database.poolLimit).toBe(5);

    spy.mockRestore();
  });

  it('GET /api/v1/health returns 503 degraded status when DB connection fails', async () => {
    const spy = vi.spyOn(poolModule, 'checkDatabaseHealth').mockResolvedValue({
      connected: false,
      poolLimit: 5,
      error: 'Connection timeout',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);

    expect(body.data.status).toBe('degraded');
    expect(body.data.database.connected).toBe(false);
    expect(body.data.database.error).toBe('Connection timeout');

    spy.mockRestore();
  });

  it('GET /api/v1/openapi.json returns valid OpenAPI 3.0 specification', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const spec = JSON.parse(response.body);

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Universal CMS Core API');
    expect(spec.info.version).toBe('0.1.0');
    expect(spec.servers[0].url).toBe('/api/v1');
    expect(spec.paths).toHaveProperty('/health');
  });
});
