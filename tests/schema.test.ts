import { describe, it, expect, vi } from 'vitest';
import * as schema from '../src/db/schema.js';
import { runMigrations } from '../src/db/migrate.js';
import * as poolModule from '../src/db/pool.js';

describe('CP2.2 Core Schema & Migrations', () => {
  it('exports all 19 core database tables required by WORKFLOW.md CP2.2', () => {
    const requiredTables = [
      'users',
      'roles',
      'permissions',
      'rolePermissions',
      'sessions',
      'auditLogs',
      'settings',
      'modules',
      'themeTokens',
      'pages',
      'contentBlocks',
      'menus',
      'menuItems',
      'media',
      'redirects',
      'seoMeta',
      'emailTemplates',
      'emailLogs',
      'jobs',
    ];

    for (const tableName of requiredTables) {
      expect(schema).toHaveProperty(tableName);
      const table = (schema as Record<string, unknown>)[tableName];
      expect(table).toBeDefined();
    }
  });

  it('includes optimistic concurrency version columns on editable core tables', () => {
    // Per ADMIN-UI-CONTRACT.md section 2.4: editable records require version column
    expect(schema.users).toHaveProperty('version');
    expect(schema.settings).toHaveProperty('version');
    expect(schema.pages).toHaveProperty('version');
    expect(schema.themeTokens).toHaveProperty('version');
    expect(schema.emailTemplates).toHaveProperty('version');
  });

  it('executes runMigrations successfully through both migration batches', async () => {
    const executedQueries: string[] = [];

    const mockConnection = {
      query: vi.fn().mockImplementation((sql: string, _params?: unknown[]) => {
        executedQueries.push(sql);
        // If checking _migrations table, return empty to simulate unapplied migrations
        if (sql.includes('SELECT id FROM _migrations')) {
          return Promise.resolve([[]]);
        }
        return Promise.resolve([[]]);
      }),
      release: vi.fn(),
    };

    const spy = vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as poolModule.pool.PoolConnection
    );

    await runMigrations();

    expect(mockConnection.query).toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();

    // Verify DDL executed for core tables
    const joinedQueries = executedQueries.join('\n');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS _migrations');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS roles');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS permissions');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS sessions');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS settings');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS modules');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS theme_tokens');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS pages');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS content_blocks');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS menus');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS menu_items');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS media');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS redirects');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS seo_meta');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS email_templates');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS email_logs');
    expect(joinedQueries).toContain('CREATE TABLE IF NOT EXISTS jobs');

    spy.mockRestore();
  });
});
