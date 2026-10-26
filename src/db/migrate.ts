import { RowDataPacket, ResultSetHeader } from 'mysql2';
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
    }

    // Check 0004_features_expansion
    const [rows4] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0004_features_expansion']
    );

    if (rows4.length === 0) {
      console.log('[Migration] Applying 0004_features_expansion...');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS forms (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          slug VARCHAR(100) NOT NULL UNIQUE,
          description TEXT NULL,
          fields JSON NOT NULL,
          submit_button_text VARCHAR(100) NOT NULL DEFAULT 'Submit',
          success_message TEXT NULL,
          notification_email VARCHAR(255) NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS form_submissions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          form_id BIGINT UNSIGNED NOT NULL,
          data JSON NOT NULL,
          ip_address VARCHAR(45) NULL,
          user_agent TEXT NULL,
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_submissions_form (form_id),
          INDEX idx_submissions_read (is_read)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS banners (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          type VARCHAR(50) NOT NULL DEFAULT 'announcement_bar',
          content TEXT NOT NULL,
          link_url VARCHAR(500) NULL,
          button_text VARCHAR(100) NULL,
          location VARCHAR(50) NOT NULL DEFAULT 'top',
          target_pages JSON NULL,
          start_at TIMESTAMP NULL,
          end_at TIMESTAMP NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS blog_categories (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          slug VARCHAR(100) NOT NULL UNIQUE,
          description TEXT NULL,
          parent_id BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS blog_tags (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          slug VARCHAR(100) NOT NULL UNIQUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS blog_posts (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          excerpt TEXT NULL,
          content TEXT NOT NULL,
          author_id BIGINT UNSIGNED NOT NULL,
          featured_image_id BIGINT UNSIGNED NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          published_at TIMESTAMP NULL,
          reading_time_minutes INT NOT NULL DEFAULT 1,
          is_featured BOOLEAN NOT NULL DEFAULT FALSE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_blog_status (status),
          INDEX idx_blog_author (author_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS products (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          description TEXT NULL,
          sku VARCHAR(100) NULL UNIQUE,
          price INT NOT NULL,
          compare_at_price INT NULL,
          cost_price INT NULL,
          stock_quantity INT NOT NULL DEFAULT 0,
          low_stock_threshold INT NOT NULL DEFAULT 5,
          track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          is_age_restricted BOOLEAN NOT NULL DEFAULT FALSE,
          featured_image_id BIGINT UNSIGNED NULL,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_products_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS product_variants (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          product_id BIGINT UNSIGNED NOT NULL,
          title VARCHAR(150) NOT NULL,
          sku VARCHAR(100) NULL,
          price INT NOT NULL,
          stock_quantity INT NOT NULL DEFAULT 0,
          attributes JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_variants_product (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_number VARCHAR(50) NOT NULL UNIQUE,
          customer_id BIGINT UNSIGNED NULL,
          customer_email VARCHAR(255) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'pending',
          payment_method VARCHAR(50) NOT NULL DEFAULT 'razorpay',
          payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
          payment_id VARCHAR(100) NULL,
          subtotal INT NOT NULL,
          tax_total INT NOT NULL DEFAULT 0,
          shipping_total INT NOT NULL DEFAULT 0,
          discount_total INT NOT NULL DEFAULT 0,
          total INT NOT NULL,
          currency VARCHAR(10) NOT NULL DEFAULT 'INR',
          shipping_address JSON NULL,
          billing_address JSON NULL,
          notes TEXT NULL,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_orders_customer (customer_id),
          INDEX idx_orders_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_items (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          product_id BIGINT UNSIGNED NOT NULL,
          variant_id BIGINT UNSIGNED NULL,
          title VARCHAR(255) NOT NULL,
          sku VARCHAR(100) NULL,
          price INT NOT NULL,
          quantity INT NOT NULL DEFAULT 1,
          total INT NOT NULL,
          INDEX idx_order_items_order (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS coupons (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(50) NOT NULL UNIQUE,
          discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
          discount_value INT NOT NULL,
          min_order_amount INT NOT NULL DEFAULT 0,
          max_discount_amount INT NULL,
          usage_limit INT NULL,
          usage_count INT NOT NULL DEFAULT 0,
          expires_at TIMESTAMP NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_coupons_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL DEFAULT 'product',
          entity_id VARCHAR(50) NOT NULL,
          user_id BIGINT UNSIGNED NULL,
          author_name VARCHAR(150) NOT NULL,
          author_email VARCHAR(255) NULL,
          rating INT NOT NULL,
          comment TEXT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_reviews_entity (entity_type, entity_id),
          INDEX idx_reviews_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS donation_campaigns (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          goal_amount INT NOT NULL,
          raised_amount INT NOT NULL DEFAULT 0,
          description TEXT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS donations (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          campaign_id BIGINT UNSIGNED NOT NULL,
          donor_name VARCHAR(150) NOT NULL,
          donor_email VARCHAR(255) NOT NULL,
          donor_pan VARCHAR(20) NULL,
          amount INT NOT NULL,
          payment_id VARCHAR(100) NULL,
          is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          receipt_number VARCHAR(50) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_donations_campaign (campaign_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0004_features_expansion']
      );

      console.log('[Migration] 0004_features_expansion completed.');
    }

    // Check 0005_store_engine_h2_1
    const [rows5] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0005_store_engine_h2_1']
    );

    if (rows5.length === 0) {
      console.log('[Migration] Applying 0005_store_engine_h2_1...');

      const ensureColumn = async (table: string, column: string, definition: string) => {
        try {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition};`);
        } catch (err: any) {
          if (err?.errno !== 1060 && !err?.message?.includes('Duplicate column')) {
            throw err;
          }
        }
      };

      await ensureColumn('users', 'date_of_birth', 'VARCHAR(20) NULL');
      await ensureColumn('products', 'product_type', "VARCHAR(50) NOT NULL DEFAULT 'physical'");
      await ensureColumn('products', 'track_stock', "BOOLEAN NOT NULL DEFAULT TRUE");
      await ensureColumn('products', 'allow_backorder', "BOOLEAN NOT NULL DEFAULT FALSE");

      await ensureColumn('product_variants', 'product_type', "VARCHAR(50) NOT NULL DEFAULT 'physical'");

      await ensureColumn('orders', 'order_kind', "VARCHAR(30) NOT NULL DEFAULT 'physical'");
      await ensureColumn('orders', 'billing_state', "VARCHAR(100) NULL");
      await ensureColumn('orders', 'idempotency_key', "VARCHAR(255) NULL");
      await ensureColumn('orders', 'idempotency_payload_hash', "VARCHAR(64) NULL");
      await ensureColumn('orders', 'expires_at', "TIMESTAMP NULL");
      await ensureColumn('orders', 'guest_access_token', "VARCHAR(255) NULL");

      await ensureColumn('order_items', 'product_type', "VARCHAR(50) NOT NULL DEFAULT 'physical'");
      await ensureColumn('order_items', 'fulfilment_status', "VARCHAR(50) NOT NULL DEFAULT 'pending'");

      await connection.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
          gateway_order_id VARCHAR(100) NOT NULL,
          gateway_payment_id VARCHAR(100) NOT NULL UNIQUE,
          amount_paise INT NOT NULL,
          currency VARCHAR(10) NOT NULL DEFAULT 'INR',
          status VARCHAR(50) NOT NULL,
          method VARCHAR(50) NULL,
          captured_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_payments_order (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS refunds (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          payment_id BIGINT UNSIGNED NOT NULL,
          amount_paise INT NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          gateway_refund_id VARCHAR(100) NULL,
          idempotency_key VARCHAR(255) NOT NULL UNIQUE,
          restock BOOLEAN NOT NULL DEFAULT FALSE,
          reason TEXT NOT NULL,
          created_by BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_refunds_order (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          product_id BIGINT UNSIGNED NOT NULL,
          variant_id BIGINT UNSIGNED NULL,
          quantity INT NOT NULL,
          change_type VARCHAR(50) NOT NULL,
          reason TEXT NULL,
          reference_id VARCHAR(100) NULL,
          actor_id BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_stock_prod (product_id),
          INDEX idx_stock_ref (reference_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_status_history (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          from_status VARCHAR(50) NOT NULL,
          to_status VARCHAR(50) NOT NULL,
          actor VARCHAR(100) NOT NULL,
          reason TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_osh_order (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_notes (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          is_customer_visible BOOLEAN NOT NULL DEFAULT FALSE,
          note TEXT NOT NULL,
          created_by BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_notes_order (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS payment_webhook_events (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          event_id VARCHAR(100) NOT NULL UNIQUE,
          gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
          event_name VARCHAR(100) NOT NULL,
          payload JSON NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'received',
          processed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_pwe_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0005_store_engine_h2_1']
      );

      console.log('[Migration] 0005_store_engine_h2_1 completed.');
    }

    // Check 0006_tax_invoices_cod_h2_2
    const [rows6] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0006_tax_invoices_cod_h2_2']
    );

    if (rows6.length === 0) {
      console.log('[Migration] Applying 0006_tax_invoices_cod_h2_2...');

      const ensureColumn = async (table: string, column: string, definition: string) => {
        try {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition};`);
        } catch (err: any) {
          if (err?.errno !== 1060 && !err?.message?.includes('Duplicate column')) {
            throw err;
          }
        }
      };

      // 1. Create tables
      await connection.query(`
        CREATE TABLE IF NOT EXISTS tax_classes (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          kind VARCHAR(20) NOT NULL DEFAULT 'goods',
          code_type VARCHAR(10) NOT NULL DEFAULT 'HSN',
          code VARCHAR(20) NOT NULL,
          rate_basis_points INT NOT NULL DEFAULT 1800,
          cess_basis_points INT NOT NULL DEFAULT 0,
          is_exempt BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tax_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS tax_rules (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tax_class_id BIGINT UNSIGNED NOT NULL,
          min_price_paise INT NOT NULL DEFAULT 0,
          max_price_paise INT NULL,
          rate_basis_points INT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tax_rules_class (tax_class_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS states (
          gst_code VARCHAR(2) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          is_union_territory BOOLEAN NOT NULL DEFAULT FALSE,
          uses_utgst BOOLEAN NOT NULL DEFAULT FALSE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS invoice_sequences (
          financial_year VARCHAR(10) PRIMARY KEY,
          last_invoice_number INT NOT NULL DEFAULT 0,
          last_credit_note_number INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS invoices (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          invoice_number VARCHAR(50) NOT NULL UNIQUE,
          financial_year VARCHAR(10) NOT NULL,
          invoice_type VARCHAR(30) NOT NULL DEFAULT 'tax_invoice',
          status VARCHAR(30) NOT NULL DEFAULT 'issued',
          seller_snapshot JSON NOT NULL,
          buyer_snapshot JSON NOT NULL,
          line_items_snapshot JSON NOT NULL,
          tax_summary JSON NOT NULL,
          taxable_amount_paise INT NOT NULL,
          cgst_amount_paise INT NOT NULL DEFAULT 0,
          sgst_amount_paise INT NOT NULL DEFAULT 0,
          utgst_amount_paise INT NOT NULL DEFAULT 0,
          igst_amount_paise INT NOT NULL DEFAULT 0,
          cess_amount_paise INT NOT NULL DEFAULT 0,
          total_tax_paise INT NOT NULL,
          shipping_paise INT NOT NULL DEFAULT 0,
          shipping_tax_paise INT NOT NULL DEFAULT 0,
          total_amount_paise INT NOT NULL,
          issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_invoices_order (order_id),
          INDEX idx_invoices_fy (financial_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS credit_notes (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          invoice_id BIGINT UNSIGNED NOT NULL,
          order_id BIGINT UNSIGNED NOT NULL,
          refund_id BIGINT UNSIGNED NULL,
          credit_note_number VARCHAR(50) NOT NULL UNIQUE,
          financial_year VARCHAR(10) NOT NULL,
          reason TEXT NOT NULL,
          snapshot JSON NOT NULL,
          taxable_amount_paise INT NOT NULL,
          cgst_amount_paise INT NOT NULL DEFAULT 0,
          sgst_amount_paise INT NOT NULL DEFAULT 0,
          utgst_amount_paise INT NOT NULL DEFAULT 0,
          igst_amount_paise INT NOT NULL DEFAULT 0,
          cess_amount_paise INT NOT NULL DEFAULT 0,
          total_tax_paise INT NOT NULL,
          total_amount_paise INT NOT NULL,
          issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_cn_invoice (invoice_id),
          INDEX idx_cn_order (order_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 2. Add columns
      await ensureColumn('products', 'tax_class_id', 'BIGINT UNSIGNED NULL');
      await ensureColumn('products', 'hsn_code', 'VARCHAR(20) NULL');

      await ensureColumn('orders', 'invoice_id', 'BIGINT UNSIGNED NULL');
      await ensureColumn('orders', 'place_of_supply_state', 'VARCHAR(2) NULL');
      await ensureColumn('orders', 'buyer_gstin', 'VARCHAR(15) NULL');
      await ensureColumn('orders', 'cod_fee_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('orders', 'cod_fee_tax_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('orders', 'cgst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('orders', 'sgst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('orders', 'utgst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('orders', 'igst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('orders', 'cess_paise', 'INT NOT NULL DEFAULT 0');

      await ensureColumn('order_items', 'tax_class_id', 'BIGINT UNSIGNED NULL');
      await ensureColumn('order_items', 'hsn_code', 'VARCHAR(20) NULL');
      await ensureColumn('order_items', 'tax_rate_basis_points', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('order_items', 'taxable_amount_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('order_items', 'cgst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('order_items', 'sgst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('order_items', 'utgst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('order_items', 'igst_paise', 'INT NOT NULL DEFAULT 0');
      await ensureColumn('order_items', 'cess_paise', 'INT NOT NULL DEFAULT 0');

      // 3. Seed States & Union Territories
      const indianStates = [
        { code: '01', name: 'Jammu and Kashmir', ut: true, utgst: false },
        { code: '02', name: 'Himachal Pradesh', ut: false, utgst: false },
        { code: '03', name: 'Punjab', ut: false, utgst: false },
        { code: '04', name: 'Chandigarh', ut: true, utgst: true },
        { code: '05', name: 'Uttarakhand', ut: false, utgst: false },
        { code: '06', name: 'Haryana', ut: false, utgst: false },
        { code: '07', name: 'Delhi', ut: true, utgst: false },
        { code: '08', name: 'Rajasthan', ut: false, utgst: false },
        { code: '09', name: 'Uttar Pradesh', ut: false, utgst: false },
        { code: '10', name: 'Bihar', ut: false, utgst: false },
        { code: '11', name: 'Sikkim', ut: false, utgst: false },
        { code: '12', name: 'Arunachal Pradesh', ut: false, utgst: false },
        { code: '13', name: 'Nagaland', ut: false, utgst: false },
        { code: '14', name: 'Manipur', ut: false, utgst: false },
        { code: '15', name: 'Mizoram', ut: false, utgst: false },
        { code: '16', name: 'Tripura', ut: false, utgst: false },
        { code: '17', name: 'Meghalaya', ut: false, utgst: false },
        { code: '18', name: 'Assam', ut: false, utgst: false },
        { code: '19', name: 'West Bengal', ut: false, utgst: false },
        { code: '20', name: 'Jharkhand', ut: false, utgst: false },
        { code: '21', name: 'Odisha', ut: false, utgst: false },
        { code: '22', name: 'Chhattisgarh', ut: false, utgst: false },
        { code: '23', name: 'Madhya Pradesh', ut: false, utgst: false },
        { code: '24', name: 'Gujarat', ut: false, utgst: false },
        { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', ut: true, utgst: true },
        { code: '27', name: 'Maharashtra', ut: false, utgst: false },
        { code: '29', name: 'Karnataka', ut: false, utgst: false },
        { code: '30', name: 'Goa', ut: false, utgst: false },
        { code: '31', name: 'Lakshadweep', ut: true, utgst: true },
        { code: '32', name: 'Kerala', ut: false, utgst: false },
        { code: '33', name: 'Tamil Nadu', ut: false, utgst: false },
        { code: '34', name: 'Puducherry', ut: true, utgst: false },
        { code: '35', name: 'Andaman and Nicobar Islands', ut: true, utgst: true },
        { code: '36', name: 'Telangana', ut: false, utgst: false },
        { code: '37', name: 'Andhra Pradesh', ut: false, utgst: false },
        { code: '38', name: 'Ladakh', ut: true, utgst: true },
        { code: '97', name: 'Other Territory', ut: true, utgst: true },
      ];

      for (const s of indianStates) {
        await connection.query(
          `INSERT INTO states (gst_code, name, is_union_territory, uses_utgst)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), is_union_territory = VALUES(is_union_territory), uses_utgst = VALUES(uses_utgst)`,
          [s.code, s.name, s.ut, s.utgst]
        );
      }

      // 4. Seed Standard Tax Classes
      const standardTaxClasses = [
        { name: 'Standard GST 18%', kind: 'goods', codeType: 'HSN', code: '9900', rate: 1800, exempt: false },
        { name: 'Reduced GST 12%', kind: 'goods', codeType: 'HSN', code: '9901', rate: 1200, exempt: false },
        { name: 'Low GST 5%', kind: 'goods', codeType: 'HSN', code: '9902', rate: 500, exempt: false },
        { name: 'Luxury GST 28%', kind: 'goods', codeType: 'HSN', code: '9903', rate: 2800, exempt: false },
        { name: 'Exempt / Zero Rated', kind: 'goods', codeType: 'HSN', code: '9904', rate: 0, exempt: true },
        { name: 'Services GST 18%', kind: 'service', codeType: 'SAC', code: '9983', rate: 1800, exempt: false },
      ];

      for (const tc of standardTaxClasses) {
        await connection.query(
          `INSERT INTO tax_classes (name, kind, code_type, code, rate_basis_points, is_exempt)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE rate_basis_points = VALUES(rate_basis_points)`,
          [tc.name, tc.kind, tc.codeType, tc.code, tc.rate, tc.exempt]
        );
      }

      // 5. Seed default store settings if not existing
      const defaultStoreSettings = {
        sellerRegistrationType: 'regular',
        sellerGstin: '27AAPFU0939F1ZV',
        sellerLegalName: 'Universal Commerce Private Limited',
        sellerTradeName: 'Universal Store',
        sellerState: '27', // Maharashtra
        priceIncludesTax: false,
        roundingMode: 'per_line',
        shippingTaxMode: 'fixed_service_rate',
        shippingTaxClassId: null,
        codEnabled: true,
        codMinOrderPaise: 10000, // Rs 100
        codMaxOrderPaise: 5000000, // Rs 50,000
        codFeePaise: 5000, // Rs 50
        codBlockedPincodes: ['110000', '999999'],
        codRequiresConfirmation: false,
      };

      await connection.query(
        `INSERT INTO settings (\`key\`, \`value\`, \`group\`, is_public, version)
         VALUES ('store_settings', ?, 'store', true, 1)
         ON DUPLICATE KEY UPDATE version = version + 1`,
        [JSON.stringify(defaultStoreSettings)]
      );

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0006_tax_invoices_cod_h2_2']
      );

      console.log('[Migration] 0006_tax_invoices_cod_h2_2 completed.');
    }

    // Check 0007_shipping_module_h2_3
    const [rows7] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0007_shipping_module_h2_3']
    );

    if (rows7.length === 0) {
      console.log('[Migration] Applying 0007_shipping_module_h2_3...');

      // 1. Shipping Zones
      await connection.query(`
        CREATE TABLE IF NOT EXISTS shipping_zones (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          countries_json JSON NOT NULL,
          states_json JSON NULL,
          pincodes_json JSON NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          priority INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 2. Shipping Zone Rates
      await connection.query(`
        CREATE TABLE IF NOT EXISTS shipping_zone_rates (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          zone_id BIGINT UNSIGNED NOT NULL,
          name VARCHAR(100) NOT NULL,
          rate_type VARCHAR(50) NOT NULL DEFAULT 'weight_based',
          min_weight_grams INT NOT NULL DEFAULT 0,
          max_weight_grams INT NULL,
          min_order_paise BIGINT NOT NULL DEFAULT 0,
          max_order_paise BIGINT NULL,
          rate_paise BIGINT NOT NULL DEFAULT 0,
          estimated_days_min INT NOT NULL DEFAULT 2,
          estimated_days_max INT NOT NULL DEFAULT 5,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_zone_rates_zone (zone_id),
          CONSTRAINT fk_zone_rates_zone FOREIGN KEY (zone_id) REFERENCES shipping_zones (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 3. Shipping Shipments
      await connection.query(`
        CREATE TABLE IF NOT EXISTS shipping_shipments (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          shipment_number VARCHAR(100) NOT NULL UNIQUE,
          partner VARCHAR(50) NOT NULL DEFAULT 'manual',
          partner_shipment_id VARCHAR(100) NULL,
          partner_order_id VARCHAR(100) NULL,
          awb VARCHAR(100) NOT NULL,
          tracking_number VARCHAR(100) NOT NULL,
          carrier_name VARCHAR(100) NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'manifested',
          label_url TEXT NULL,
          weight_grams INT NOT NULL DEFAULT 500,
          length_cm INT NULL,
          width_cm INT NULL,
          height_cm INT NULL,
          is_cod BOOLEAN NOT NULL DEFAULT FALSE,
          cod_amount_paise BIGINT NOT NULL DEFAULT 0,
          shipping_fee_paise BIGINT NOT NULL DEFAULT 0,
          shipped_at TIMESTAMP NULL,
          delivered_at TIMESTAMP NULL,
          tracking_history_json JSON NULL,
          metadata_json JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_shipments_order (order_id),
          INDEX idx_shipments_awb (awb),
          INDEX idx_shipments_tracking (tracking_number),
          INDEX idx_shipments_status (status),
          CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 4. Alter products, product_variants, order_items, orders
      const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
        const [existing] = await connection.query<RowDataPacket[]>(
          `SHOW COLUMNS FROM \`${table}\` LIKE ?`,
          [column]
        );
        if (existing.length === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        }
      };

      await addColumnIfNotExists('products', 'weight_grams', 'INT NOT NULL DEFAULT 500 AFTER stock_quantity');
      await addColumnIfNotExists('products', 'length_cm', 'INT NULL AFTER weight_grams');
      await addColumnIfNotExists('products', 'width_cm', 'INT NULL AFTER length_cm');
      await addColumnIfNotExists('products', 'height_cm', 'INT NULL AFTER width_cm');

      await addColumnIfNotExists('product_variants', 'weight_grams', 'INT NOT NULL DEFAULT 500 AFTER stock_quantity');
      await addColumnIfNotExists('product_variants', 'length_cm', 'INT NULL AFTER weight_grams');
      await addColumnIfNotExists('product_variants', 'width_cm', 'INT NULL AFTER length_cm');
      await addColumnIfNotExists('product_variants', 'height_cm', 'INT NULL AFTER width_cm');

      await addColumnIfNotExists('order_items', 'weight_grams', 'INT NOT NULL DEFAULT 0 AFTER quantity');

      await addColumnIfNotExists('orders', 'shipping_method', 'VARCHAR(100) NULL AFTER shipping_total');
      await addColumnIfNotExists('orders', 'shipping_carrier', 'VARCHAR(100) NULL AFTER shipping_method');
      await addColumnIfNotExists('orders', 'shipping_awb', 'VARCHAR(100) NULL AFTER shipping_carrier');
      await addColumnIfNotExists('orders', 'tracking_number', 'VARCHAR(100) NULL AFTER shipping_awb');

      // 5. Seed default shipping zone & rates
      const [existingZones] = await connection.query<RowDataPacket[]>('SELECT id FROM shipping_zones LIMIT 1');
      if (existingZones.length === 0) {
        const [res] = await connection.query<ResultSetHeader>(
          `INSERT INTO shipping_zones (name, countries_json, states_json, pincodes_json, is_active, priority)
           VALUES ('All India - Standard', ?, NULL, NULL, TRUE, 0)`,
          [JSON.stringify(['IN'])]
        );
        const zoneId = res.insertId;

        await connection.query(
          `INSERT INTO shipping_zone_rates (zone_id, name, rate_type, min_weight_grams, max_weight_grams, min_order_paise, max_order_paise, rate_paise, estimated_days_min, estimated_days_max, is_active)
           VALUES 
           (?, 'Standard Ground Delivery (< 500g)', 'weight_based', 0, 500, 0, NULL, 5000, 3, 7, TRUE),
           (?, 'Standard Ground Delivery (500g - 2kg)', 'weight_based', 501, 2000, 0, NULL, 9000, 3, 7, TRUE),
           (?, 'Heavy Ground Delivery (> 2kg)', 'weight_based', 2001, NULL, 0, NULL, 15000, 4, 10, TRUE)`,
          [zoneId, zoneId, zoneId]
        );
      }

      // 6. Seed default shipping settings
      const defaultShippingSettings = {
        originPincode: '400001',
        originCity: 'Mumbai',
        originState: '27',
        originCountry: 'IN',
        defaultPartner: 'manual',
        activePartners: ['manual', 'fake'],
        disabledBehavior: 'fallback_flat_rate', // 'fallback_flat_rate' | 'block_physical'
        fallbackRatePaise: 5000, // Rs 50
        freeShippingThresholdPaise: 100000, // Rs 1000
        shiprocketApiKey: '',
        shiprocketApiSecret: '',
        delhiveryApiKey: '',
        delhiveryClientName: '',
      };

      await connection.query(
        `INSERT INTO settings (\`key\`, \`value\`, \`group\`, is_public, version)
         VALUES ('shipping_settings', ?, 'shipping', true, 1)
         ON DUPLICATE KEY UPDATE version = version + 1`,
        [JSON.stringify(defaultShippingSettings)]
      );

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0007_shipping_module_h2_3']
      );

      console.log('[Migration] 0007_shipping_module_h2_3 completed.');
    }

    // Check 0008_digital_delivery_h2_3d
    const [rows8] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0008_digital_delivery_h2_3d']
    );

    if (rows8.length === 0) {
      console.log('[Migration] Applying 0008_digital_delivery_h2_3d...');

      // 1. Digital Assets Table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS digital_assets (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          product_id BIGINT UNSIGNED NOT NULL,
          variant_id BIGINT UNSIGNED NULL,
          file_name VARCHAR(255) NOT NULL,
          storage_path VARCHAR(500) NOT NULL,
          file_size_bytes BIGINT NOT NULL DEFAULT 0,
          mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
          download_limit INT NOT NULL DEFAULT 5,
          expires_hours INT NOT NULL DEFAULT 72,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_digital_assets_product (product_id),
          INDEX idx_digital_assets_variant (variant_id),
          CONSTRAINT fk_digital_assets_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 2. License Keys Table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS license_keys (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          product_id BIGINT UNSIGNED NOT NULL,
          variant_id BIGINT UNSIGNED NULL,
          license_key VARCHAR(255) NOT NULL UNIQUE,
          status VARCHAR(50) NOT NULL DEFAULT 'available',
          order_id BIGINT UNSIGNED NULL,
          order_item_id BIGINT UNSIGNED NULL,
          assigned_at TIMESTAMP NULL,
          metadata_json JSON NULL,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_license_product_status (product_id, status),
          INDEX idx_license_order (order_id),
          INDEX idx_license_key (license_key),
          CONSTRAINT fk_license_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 3. Digital Entitlements Table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS digital_entitlements (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          order_item_id BIGINT UNSIGNED NOT NULL,
          customer_id BIGINT UNSIGNED NULL,
          asset_id BIGINT UNSIGNED NULL,
          license_key_id BIGINT UNSIGNED NULL,
          download_token VARCHAR(100) NOT NULL UNIQUE,
          download_count INT NOT NULL DEFAULT 0,
          max_downloads INT NOT NULL DEFAULT 5,
          expires_at TIMESTAMP NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'active',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_entitlements_order (order_id),
          INDEX idx_entitlements_token (download_token),
          INDEX idx_entitlements_customer (customer_id),
          CONSTRAINT fk_entitlements_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
          CONSTRAINT fk_entitlements_item FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0008_digital_delivery_h2_3d']
      );

      console.log('[Migration] 0008_digital_delivery_h2_3d completed.');
    }

    // Check 0009_customer_accounts_h2_4
    const [rows9] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0009_customer_accounts_h2_4']
    );

    if (rows9.length === 0) {
      console.log('[Migration] Applying 0009_customer_accounts_h2_4...');

      const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
        const [existing] = await connection.query<RowDataPacket[]>(
          `SHOW COLUMNS FROM \`${table}\` LIKE ?`,
          [column]
        );
        if (existing.length === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        }
      };

      // 1. Add phone, communication_preferences, customer_segment to users table
      await addColumnIfNotExists('users', 'phone', 'VARCHAR(20) NULL AFTER email');
      await addColumnIfNotExists('users', 'communication_preferences', 'JSON NULL AFTER date_of_birth');
      await addColumnIfNotExists('users', 'customer_segment', "VARCHAR(50) NOT NULL DEFAULT 'standard' AFTER communication_preferences");

      // 2. Customer Delivery Addresses Table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS customer_addresses (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          phone VARCHAR(20) NOT NULL,
          address_line1 VARCHAR(255) NOT NULL,
          address_line2 VARCHAR(255) NULL,
          city VARCHAR(100) NOT NULL,
          state VARCHAR(100) NOT NULL,
          state_code VARCHAR(10) NULL,
          postal_code VARCHAR(20) NOT NULL,
          country VARCHAR(10) NOT NULL DEFAULT 'IN',
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_addr_user (user_id),
          CONSTRAINT fk_addr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 3. Customer Wishlist Table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS customer_wishlist (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          product_id BIGINT UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_product (user_id, product_id),
          INDEX idx_wishlist_user (user_id),
          INDEX idx_wishlist_product (product_id),
          CONSTRAINT fk_wishlist_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          CONSTRAINT fk_wishlist_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 4. Order Return / Refund Requests Table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_return_requests (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL,
          order_item_id BIGINT UNSIGNED NOT NULL,
          customer_id BIGINT UNSIGNED NOT NULL,
          reason TEXT NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'pending',
          admin_notes TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_return_customer (customer_id),
          INDEX idx_return_order (order_id),
          CONSTRAINT fk_return_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
          CONSTRAINT fk_return_item FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE,
          CONSTRAINT fk_return_customer FOREIGN KEY (customer_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 5. Customer Notes Table (Admin Customer Management)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS customer_notes (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          customer_id BIGINT UNSIGNED NOT NULL,
          author_id BIGINT UNSIGNED NOT NULL,
          note TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_notes_customer (customer_id),
          CONSTRAINT fk_notes_customer FOREIGN KEY (customer_id) REFERENCES users (id) ON DELETE CASCADE,
          CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 6. Customer Data Requests Table (DPDP Act Data Export and Deletion)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS customer_data_requests (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          request_type VARCHAR(30) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'pending',
          export_payload JSON NULL,
          requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL,
          INDEX idx_data_req_user (user_id),
          CONSTRAINT fk_data_req_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0009_customer_accounts_h2_4']
      );

      console.log('[Migration] 0009_customer_accounts_h2_4 completed.');
    }

    // Check 0010_stock_movements_h2_6
    const [rows10] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0010_stock_movements_h2_6']
    );

    if (rows10.length === 0) {
      console.log('[Migration] Applying 0010_stock_movements_h2_6...');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          product_id BIGINT UNSIGNED NOT NULL,
          variant_id BIGINT UNSIGNED NULL,
          quantity INT NOT NULL,
          change_type VARCHAR(50) NOT NULL DEFAULT 'adjustment',
          reason TEXT NULL,
          reference_id VARCHAR(100) NULL,
          actor_id BIGINT UNSIGNED NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_sm_product (product_id),
          INDEX idx_sm_variant (variant_id),
          INDEX idx_sm_created (created_at),
          CONSTRAINT fk_sm_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0010_stock_movements_h2_6']
      );

      console.log('[Migration] 0010_stock_movements_h2_6 completed.');
    }

    // Check 0011_recurring_donations_h2_7
    const [rows11] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM _migrations WHERE name = ?',
      ['0011_recurring_donations_h2_7']
    );

    if (rows11.length === 0) {
      console.log('[Migration] Applying 0011_recurring_donations_h2_7...');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS donation_subscriptions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          campaign_id BIGINT UNSIGNED NOT NULL,
          donor_name VARCHAR(150) NOT NULL,
          donor_email VARCHAR(255) NOT NULL,
          donor_pan VARCHAR(20) NULL,
          amount INT NOT NULL,
          frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
          subscription_id VARCHAR(100) NOT NULL UNIQUE,
          plan_id VARCHAR(100) NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'active',
          is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
          started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          next_charge_at TIMESTAMP NULL,
          cancelled_at TIMESTAMP NULL,
          total_charges INT NOT NULL DEFAULT 0,
          total_raised INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_sub_campaign (campaign_id),
          INDEX idx_sub_email (donor_email),
          INDEX idx_sub_status (status),
          CONSTRAINT fk_sub_campaign FOREIGN KEY (campaign_id) REFERENCES donation_campaigns (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS donation_subscription_charges (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          subscription_id BIGINT UNSIGNED NOT NULL,
          donation_id BIGINT UNSIGNED NULL,
          gateway_payment_id VARCHAR(100) NOT NULL UNIQUE,
          amount INT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'captured',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_charge_sub (subscription_id),
          CONSTRAINT fk_charge_sub FOREIGN KEY (subscription_id) REFERENCES donation_subscriptions (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(
        'INSERT INTO _migrations (name) VALUES (?)',
        ['0011_recurring_donations_h2_7']
      );

      console.log('[Migration] 0011_recurring_donations_h2_7 completed.');
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
