import { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';

export async function runMigrations(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    console.log('[Migration] Starting database migration...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Migration 0001_initial_core_tables
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0001_initial_core_tables']
    );

    if (rows.length === 0) {
      console.log('[Migration] Applying 0001_initial_core_tables...');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS roles (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL UNIQUE,
          description TEXT NULL,
          is_system BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS permissions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          \`key\` VARCHAR(100) NOT NULL UNIQUE,
          module VARCHAR(50) NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS role_permissions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          role_id BIGINT UNSIGNED NOT NULL,
          permission_id BIGINT UNSIGNED NOT NULL,
          UNIQUE KEY uk_role_perm (role_id, permission_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role_id BIGINT UNSIGNED NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          email_verified_at TIMESTAMP NULL,
          two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_users_role (role_id),
          INDEX idx_users_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          queue VARCHAR(50) NOT NULL DEFAULT 'default',
          job_type VARCHAR(100) NOT NULL,
          payload JSON NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          attempts INT NOT NULL DEFAULT 0,
          max_attempts INT NOT NULL DEFAULT 3,
          last_error TEXT NULL,
          locked_at TIMESTAMP NULL,
          run_after TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_jobs_status_run (status, run_after)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0001_initial_core_tables']
      );

      console.log('[Migration] 0001_initial_core_tables applied successfully.');
    } else {
      console.log('[Migration] Database is already up to date.');
    }
  } finally {
    connection.release();
  }
}

// Allow direct execution via CLI
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => {
      console.log('[Migration] Completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Failed:', err);
      process.exit(1);
    });
}
