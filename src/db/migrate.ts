import { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';

export async function runMigrations(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    console.log('[Migration] Starting database migrations...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check 0001_initial_core_tables
    const [rows1] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0001_initial_core_tables']
    );

    if (rows1.length === 0) {
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
          two_factor_secret VARCHAR(255) NULL,
          version INT NOT NULL DEFAULT 1,
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

      console.log('[Migration] 0001_initial_core_tables completed.');
    }

    // Check 0002_core_schema_cp2_2
    const [rows2] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0002_core_schema_cp2_2']
    );

    if (rows2.length === 0) {
      console.log('[Migration] Applying 0002_core_schema_cp2_2...');

      // 5. sessions
      await connection.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR(128) PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          token_hash VARCHAR(255) NOT NULL UNIQUE,
          ip_address VARCHAR(45) NULL,
          user_agent TEXT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_sessions_user (user_id),
          INDEX idx_sessions_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 6. audit_logs
      await connection.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NULL,
          action VARCHAR(100) NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(50) NULL,
          before_values JSON NULL,
          after_values JSON NULL,
          ip_address VARCHAR(45) NULL,
          user_agent TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_audit_user (user_id),
          INDEX idx_audit_entity (entity_type, entity_id),
          INDEX idx_audit_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 7. settings
      await connection.query(`
        CREATE TABLE IF NOT EXISTS settings (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          \`key\` VARCHAR(100) NOT NULL UNIQUE,
          \`value\` JSON NOT NULL,
          \`group\` VARCHAR(50) NOT NULL DEFAULT 'general',
          is_public BOOLEAN NOT NULL DEFAULT FALSE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_settings_group (\`group\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 8. modules
      await connection.query(`
        CREATE TABLE IF NOT EXISTS modules (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL UNIQUE,
          version VARCHAR(20) NOT NULL,
          is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          is_core BOOLEAN NOT NULL DEFAULT FALSE,
          settings JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_modules_enabled (is_enabled)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 9. theme_tokens
      await connection.query(`
        CREATE TABLE IF NOT EXISTS theme_tokens (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          \`key\` VARCHAR(100) NOT NULL UNIQUE,
          \`value\` TEXT NOT NULL,
          token_type VARCHAR(50) NOT NULL DEFAULT 'color',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 10. pages
      await connection.query(`
        CREATE TABLE IF NOT EXISTS pages (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          published_at TIMESTAMP NULL,
          version INT NOT NULL DEFAULT 1,
          created_by BIGINT UNSIGNED NULL,
          updated_by BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_pages_status (status),
          INDEX idx_pages_slug (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 11. content_blocks
      await connection.query(`
        CREATE TABLE IF NOT EXISTS content_blocks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          page_id BIGINT UNSIGNED NOT NULL,
          block_type VARCHAR(50) NOT NULL,
          data JSON NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_blocks_page (page_id, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 12. menus
      await connection.query(`
        CREATE TABLE IF NOT EXISTS menus (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          slug VARCHAR(100) NOT NULL UNIQUE,
          location VARCHAR(50) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 13. menu_items
      await connection.query(`
        CREATE TABLE IF NOT EXISTS menu_items (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          menu_id BIGINT UNSIGNED NOT NULL,
          parent_id BIGINT UNSIGNED NULL,
          label VARCHAR(100) NOT NULL,
          url VARCHAR(500) NOT NULL,
          target VARCHAR(20) NOT NULL DEFAULT '_self',
          sort_order INT NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_menu_items_menu (menu_id, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 14. media
      await connection.query(`
        CREATE TABLE IF NOT EXISTS media (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          size_bytes BIGINT UNSIGNED NOT NULL,
          width INT NULL,
          height INT NULL,
          alt_text TEXT NULL,
          storage_path VARCHAR(500) NOT NULL,
          public_url VARCHAR(500) NOT NULL,
          created_by BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_media_mime (mime_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 15. redirects
      await connection.query(`
        CREATE TABLE IF NOT EXISTS redirects (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          source_path VARCHAR(500) NOT NULL UNIQUE,
          target_path VARCHAR(500) NOT NULL,
          status_code INT NOT NULL DEFAULT 301,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          hit_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_redirects_source (source_path(255))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 16. seo_meta
      await connection.query(`
        CREATE TABLE IF NOT EXISTS seo_meta (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(50) NOT NULL,
          meta_title VARCHAR(160) NULL,
          meta_description TEXT NULL,
          canonical_url VARCHAR(500) NULL,
          robots VARCHAR(50) NOT NULL DEFAULT 'index, follow',
          og_title VARCHAR(160) NULL,
          og_description TEXT NULL,
          og_image_id BIGINT UNSIGNED NULL,
          twitter_card VARCHAR(50) NOT NULL DEFAULT 'summary_large_image',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_seo_entity (entity_type, entity_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 17. email_templates
      await connection.query(`
        CREATE TABLE IF NOT EXISTS email_templates (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          \`key\` VARCHAR(100) NOT NULL UNIQUE,
          name VARCHAR(150) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          body_html MEDIUMTEXT NOT NULL,
          body_text TEXT NULL,
          variables_schema JSON NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_system BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 18. email_logs
      await connection.query(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          template_id BIGINT UNSIGNED NULL,
          recipient VARCHAR(255) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'queued',
          error_message TEXT NULL,
          attempts INT NOT NULL DEFAULT 0,
          sent_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_email_logs_status (status),
          INDEX idx_email_logs_recipient (recipient)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0002_core_schema_cp2_2']
      );

      console.log('[Migration] 0002_core_schema_cp2_2 completed.');
    }

    // Check 0003_auth_tokens
    const [rows3] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0003_auth_tokens']
    );

    if (rows3.length === 0) {
      console.log('[Migration] Applying 0003_auth_tokens...');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS auth_tokens (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          token_type VARCHAR(50) NOT NULL,
          token_hash VARCHAR(255) NOT NULL UNIQUE,
          code VARCHAR(10) NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_auth_tokens_user (user_id),
          INDEX idx_auth_tokens_type (token_type),
          INDEX idx_auth_tokens_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0003_auth_tokens']
      );

      console.log('[Migration] 0003_auth_tokens completed.');
    } else {
      console.log('[Migration] Database is up to date.');
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
