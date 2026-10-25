import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db/pool.js';
import { SYSTEM_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, SystemPermission } from './definitions.js';
import { generateSecureToken, hashToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/crypto.js';
import { AuthError } from '../auth/service.js';

export interface RoleWithPermissions {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export class RbacService {
  // 1. Get User Permissions
  public async getUserPermissions(roleId: number, roleName: string): Promise<string[]> {
    if (roleName === 'owner') {
      return ['*'];
    }

    try {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT p.\`key\`
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = ?`,
          [roleId]
        );

        if (rows.length > 0) {
          return rows.map((r) => r.key);
        }
      } finally {
        connection.release();
      }
    } catch {
      // Fallback to defaults if db connection is unavailable or unseeded
    }

    return DEFAULT_ROLE_PERMISSIONS[roleName] || [];
  }

  // 2. Check Permission
  public hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    if (userPermissions.includes('*')) {
      return true;
    }
    return userPermissions.includes(requiredPermission);
  }

  // 3. List All Available Permissions
  public listAllPermissions(): SystemPermission[] {
    return SYSTEM_PERMISSIONS;
  }

  // 4. List Roles with Permissions
  public async listRolesWithPermissions(): Promise<RoleWithPermissions[]> {
    const connection = await pool.getConnection();
    try {
      const [roles] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, description, is_system FROM roles ORDER BY id ASC'
      );

      const result: RoleWithPermissions[] = [];
      for (const role of roles) {
        const permissions = await this.getUserPermissions(role.id, role.name);
        result.push({
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: Boolean(role.is_system),
          permissions,
        });
      }

      return result;
    } finally {
      connection.release();
    }
  }

  // 5. Update Role Permissions
  public async updateRolePermissions(roleId: number, permissionKeys: string[]): Promise<RoleWithPermissions> {
    const connection = await pool.getConnection();
    try {
      const [roleRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, description, is_system FROM roles WHERE id = ?',
        [roleId]
      );

      if (roleRows.length === 0) {
        throw new AuthError(`Role with ID ${roleId} not found.`, 'NOT_FOUND', 404);
      }

      const role = roleRows[0];

      if (role.name === 'owner') {
        throw new AuthError('Cannot modify the permissions of the owner role.', 'VALIDATION_FAILED', 400);
      }

      if (role.name === 'customer') {
        throw new AuthError('Customer role cannot be assigned admin permissions.', 'VALIDATION_FAILED', 400);
      }

      // Find permission IDs for keys
      let permissionIds: number[] = [];
      if (permissionKeys.length > 0) {
        const [permRows] = await connection.query<RowDataPacket[]>(
          `SELECT id, \`key\` FROM permissions WHERE \`key\` IN (?)`,
          [permissionKeys]
        );
        permissionIds = permRows.map((r) => r.id);
      }

      // Clear existing and replace
      await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

      for (const permId of permissionIds) {
        await connection.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
          [roleId, permId]
        );
      }

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: Boolean(role.is_system),
        permissions: permissionKeys,
      };
    } finally {
      connection.release();
    }
  }

  // 6. Invite Staff User
  public async inviteStaff(
    _inviterId: number,
    data: { name: string; email: string; roleId: number }
  ): Promise<{ user: { id: number; name: string; email: string; roleId: number; roleName: string }; inviteToken: string }> {
    const connection = await pool.getConnection();
    try {
      // Check existing email
      const [existing] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [data.email.toLowerCase()]
      );

      if (existing.length > 0) {
        throw new AuthError('A user with this email address already exists.', 'CONFLICT', 409);
      }

      // Check role
      const [roleRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name FROM roles WHERE id = ?',
        [data.roleId]
      );

      if (roleRows.length === 0) {
        throw new AuthError('Specified role does not exist.', 'NOT_FOUND', 404);
      }

      const role = roleRows[0];
      if (role.name === 'owner') {
        throw new AuthError('Cannot invite users as the owner role.', 'VALIDATION_FAILED', 400);
      }

      // Generate random initial password and invite token
      const tempPassword = generateSecureToken(16);
      const passwordHash = await hashPassword(tempPassword);

      const [insertResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO users (name, email, password_hash, role_id, is_active, email_verified_at)
         VALUES (?, ?, ?, ?, FALSE, NULL)`,
        [data.name, data.email.toLowerCase(), passwordHash, role.id]
      );

      const userId = insertResult.insertId;

      const inviteToken = generateSecureToken(32);
      const tokenHash = hashToken(inviteToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await connection.query(
        `INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at)
         VALUES (?, 'staff_invite', ?, ?)`,
        [userId, tokenHash, expiresAt]
      );

      return {
        user: {
          id: userId,
          name: data.name,
          email: data.email.toLowerCase(),
          roleId: role.id,
          roleName: role.name,
        },
        inviteToken,
      };
    } finally {
      connection.release();
    }
  }
}

export const rbacService = new RbacService();
