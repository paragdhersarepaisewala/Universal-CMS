import fs from 'node:fs';
import { pool } from '../db/pool.js';

export async function restoreBackup(filepath: string): Promise<boolean> {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Backup file '${filepath}' does not exist.`);
  }

  const content = fs.readFileSync(filepath, 'utf8');
  const statements = content
    .split(';\n')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.query(statement);
      }
    }
    await connection.query('SET FOREIGN_KEY_CHECKS=1');
    return true;
  } finally {
    connection.release();
  }
}

// Allow CLI execution
if (process.argv[1]?.endsWith('restore.ts') || process.argv[1]?.endsWith('restore.js')) {
  const targetFile = process.argv[2];
  if (!targetFile) {
    console.error('[Restore] Please provide backup file path. Example: npm run db:restore backups/backup.sql');
    process.exit(1);
  }

  restoreBackup(targetFile)
    .then(() => {
      console.log(`[Restore] Successfully restored database from: ${targetFile}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[Restore] Database restore failed:', err);
      process.exit(1);
    });
}
