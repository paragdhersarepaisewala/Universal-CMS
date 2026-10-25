import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import { createBackup } from '../src/scripts/backup.js';
import { restoreBackup } from '../src/scripts/restore.js';
import * as poolModule from '../src/db/pool.js';

describe('Database Backup and Restore Suite', () => {
  const testBackupDir = 'backups_test';
  let generatedBackupFile: string;

  const mockConnection = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SHOW TABLES')) {
        return Promise.resolve([[{ Tables_in_cms: 'users' }, { Tables_in_cms: 'pages' }]]);
      }
      if (sql.includes('SHOW CREATE TABLE')) {
        return Promise.resolve([[{ 'Create Table': 'CREATE TABLE `users` (`id` int)' }]]);
      }
      if (sql.includes('SELECT * FROM')) {
        return Promise.resolve([[{ id: 1, name: 'Admin', email: 'admin@example.com' }]]);
      }
      return Promise.resolve([[]]);
    }),
    release: vi.fn(),
  };

  afterAll(() => {
    if (fs.existsSync(testBackupDir)) {
      fs.rmSync(testBackupDir, { recursive: true, force: true });
    }
  });

  it('generates a valid SQL database backup file', async () => {
    vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as Awaited<ReturnType<typeof poolModule.pool.getConnection>>
    );

    generatedBackupFile = await createBackup(testBackupDir);

    expect(fs.existsSync(generatedBackupFile)).toBe(true);
    const content = fs.readFileSync(generatedBackupFile, 'utf8');
    expect(content).toContain('-- Universal CMS Database Backup');
    expect(content).toContain('SET FOREIGN_KEY_CHECKS=0;');
    expect(content).toContain('CREATE TABLE `users`');
    expect(content).toContain('INSERT INTO `users`');
  });

  it('validates restore from the generated backup file', async () => {
    vi.spyOn(poolModule.pool, 'getConnection').mockResolvedValue(
      mockConnection as unknown as Awaited<ReturnType<typeof poolModule.pool.getConnection>>
    );

    expect(generatedBackupFile).toBeDefined();
    const success = await restoreBackup(generatedBackupFile);
    expect(success).toBe(true);
    expect(mockConnection.query).toHaveBeenCalledWith('SET FOREIGN_KEY_CHECKS=0');
    expect(mockConnection.query).toHaveBeenCalledWith('SET FOREIGN_KEY_CHECKS=1');
  });

  it('throws an error if attempting to restore a non-existent backup file', async () => {
    await expect(restoreBackup('non_existent_file.sql')).rejects.toThrow('does not exist');
  });
});
