import { describe, it, expect, vi } from 'vitest';
import { config } from '../src/config/env.js';
import * as poolModule from '../src/db/pool.js';

describe('Database Connection Pool', () => {
  it('defaults to a small connection pool limit of 5 for Hostinger shared limits', () => {
    expect(config.db.poolSize).toBe(5);
  });

  it('provides checkDatabaseHealth returning structure matching contract', async () => {
    // Mock the connection query to test behavior when DB is connected
    const mockConnection = {
      query: vi.fn().mockResolvedValue([[ { '1': 1 } ]]),
      release: vi.fn(),
    };
    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    const health = await poolModule.checkDatabaseHealth();
    expect(health.connected).toBe(true);
    expect(health.poolLimit).toBe(5);
    expect(mockConnection.query).toHaveBeenCalledWith('SELECT 1');
    expect(mockConnection.release).toHaveBeenCalled();

    spy.mockRestore();
  });

  it('handles database connection failure gracefully without throwing', async () => {
    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockRejectedValue(new Error('ECONNREFUSED'));

    const health = await poolModule.checkDatabaseHealth();
    expect(health.connected).toBe(false);
    expect(health.poolLimit).toBe(5);
    expect(health.error).toContain('ECONNREFUSED');

    spy.mockRestore();
  });
});
