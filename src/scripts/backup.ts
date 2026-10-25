import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db/pool.js';
import type { RowDataPacket } from 'mysql2';

export async function createBackup(outputDir: string = 'backups'): Promise<string> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(outputDir, `backup_${timestamp}.sql`);

  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query<RowDataPacket[]>('SHOW TABLES');
    const tableKey = Object.keys(tables[0] || {})[0];

    const lines: string[] = [
      '-- Universal CMS Database Backup',
      `-- Generated At: ${new Date().toISOString()}`,
      'SET FOREIGN_KEY_CHECKS=0;',
      '',
    ];

    for (const row of tables) {
      const tableName = row[tableKey] as string;
      const [createRes] = await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${tableName}\``);
      const createSql = (createRes[0] as { 'Create Table': string })['Create Table'];

      lines.push(`-- Table: ${tableName}`);
      lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
      lines.push(`${createSql};`);

      const [dataRows] = await connection.query<RowDataPacket[]>(`SELECT * FROM \`${tableName}\``);
      if (dataRows.length > 0) {
        for (const dataRow of dataRows) {
          const cols = Object.keys(dataRow).map(k => `\`${k}\``).join(', ');
          const vals = Object.values(dataRow).map(v => {
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return v;
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
            if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`;
            return `'${String(v).replace(/'/g, "\\'")}'`;
          }).join(', ');
          lines.push(`INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});`);
        }
      }
      lines.push('');
    }

    lines.push('SET FOREIGN_KEY_CHECKS=1;');
    fs.writeFileSync(filename, lines.join('\n'), 'utf8');
    return filename;
  } finally {
    connection.release();
  }
}

// Allow CLI execution
if (process.argv[1]?.endsWith('backup.ts') || process.argv[1]?.endsWith('backup.js')) {
  createBackup()
    .then(file => {
      console.log(`[Backup] Database backup completed: ${file}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[Backup] Backup failed:', err);
      process.exit(1);
    });
}
