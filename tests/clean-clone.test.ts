import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';

describe('Clean Clone & Local Execution Verification', () => {
  it('validates database connectivity on local MySQL 8.4', async () => {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT 1 as test');
    connection.release();
    expect((rows as any[])[0].test).toBe(1);
  });

  it('executes database migrations idempotently without errors', async () => {
    await expect(runMigrations()).resolves.not.toThrow();
  });

  it('executes database seeding idempotently without errors', async () => {
    await expect(runSeed()).resolves.not.toThrow();
  });

  it('boots Fastify app, verifies health probe and shuts down cleanly', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('ok');
    expect(body.data.database.connected).toBe(true);

    await app.close();
  });
});
