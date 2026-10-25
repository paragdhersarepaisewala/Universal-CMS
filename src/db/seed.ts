import { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';
import { config } from '../config/env.js';
import { hashPassword } from '../utils/crypto.js';
import { runMigrations } from './migrate.js';

export async function runSeed(): Promise<void> {
  // Ensure migrations have executed
  await runMigrations();

  const connection = await pool.getConnection();
  try {
    console.log('[Seed] Seeding default roles...');

    const defaultRoles = [
      { name: 'owner', description: 'System owner with unrestricted superadmin privileges' },
      { name: 'admin', description: 'Administrator with full management access' },
      { name: 'manager', description: 'Operations and catalog manager' },
      { name: 'editor', description: 'Content editor for pages, articles, and media' },
      { name: 'support', description: 'Customer support agent with read-only access' },
      { name: 'customer', description: 'Registered storefront client account' },
    ];

    for (const role of defaultRoles) {
      await connection.query(
        `INSERT INTO roles (name, description, is_system)
         VALUES (?, ?, TRUE)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [role.name, role.description]
      );
    }

    console.log('[Seed] Seeding system permissions and matrix...');
    const { SYSTEM_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } = await import('../rbac/definitions.js');

    for (const perm of SYSTEM_PERMISSIONS) {
      await connection.query(
        `INSERT INTO permissions (\`key\`, module, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [perm.key, perm.module, perm.description]
      );
    }

    // Seed role-permission relationships
    const [allRoles] = await connection.query<RowDataPacket[]>('SELECT id, name FROM roles');
    const [allPerms] = await connection.query<RowDataPacket[]>('SELECT id, `key` FROM permissions');

    const permMap = new Map<string, number>();
    for (const p of allPerms) {
      permMap.set(p.key, p.id);
    }

    for (const role of allRoles) {
      const allowedKeys = DEFAULT_ROLE_PERMISSIONS[role.name] || [];
      for (const key of allowedKeys) {
        if (key === '*') continue;
        const permId = permMap.get(key);
        if (permId) {
          await connection.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
            [role.id, permId]
          );
        }
      }
    }

    // Retrieve owner role ID
    const [roleRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM roles WHERE name = ?',
      ['owner']
    );

    if (roleRows.length === 0) {
      throw new Error('Owner role not found after seeding roles.');
    }

    const ownerRoleId = roleRows[0].id;

    // Check if owner user exists
    const [userRows] = await connection.query<RowDataPacket[]>(
      'SELECT id, email FROM users WHERE role_id = ?',
      [ownerRoleId]
    );

    if (userRows.length === 0) {
      console.log(`[Seed] Creating initial owner account (${config.seed.ownerEmail})...`);
      const passwordHash = await hashPassword(config.seed.ownerPassword);

      await connection.query(
        `INSERT INTO users (name, email, password_hash, role_id, is_active, email_verified_at)
         VALUES (?, ?, ?, ?, TRUE, NOW())`,
        [config.seed.ownerName, config.seed.ownerEmail, passwordHash, ownerRoleId]
      );

      console.log('[Seed] Owner account created successfully.');
    } else {
      console.log(`[Seed] Owner account already exists: ${userRows[0].email}`);
    }

    // Seed default email templates
    console.log('[Seed] Seeding default email templates...');
    const { EMAIL_EVENTS } = await import('../email/events.js');
    const { DEFAULT_TEMPLATES } = await import('../email/templates.js');

    for (const [key, def] of Object.entries(EMAIL_EVENTS)) {
      const templateContent = DEFAULT_TEMPLATES[def.defaultTemplateKey] || {
        subject: def.defaultSubject,
        bodyHtml: `<p>${def.name}</p>`,
        bodyText: def.name,
      };

      await connection.query(
        `INSERT INTO email_templates (\`key\`, name, subject, body_html, body_text, variables_schema, is_active, is_system, version)
         VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [
          key,
          def.name,
          templateContent.subject,
          templateContent.bodyHtml,
          templateContent.bodyText,
          JSON.stringify(def.variables),
        ]
      );
    }
    console.log('[Seed] Email templates seeded.');
  } finally {
    connection.release();
  }
}

// Allow direct execution via CLI
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed()
    .then(() => {
      console.log('[Seed] Completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Failed:', err);
      process.exit(1);
    });
}
