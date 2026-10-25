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
