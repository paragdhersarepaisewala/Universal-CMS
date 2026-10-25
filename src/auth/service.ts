import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { generateSecureToken, hashToken, generateNumericCode } from '../utils/tokens.js';
import { generateTotpSecret, verifyTotpCode } from '../utils/totp.js';
import { authRateLimiter } from './rate-limiter.js';

export class AuthError extends Error {
  public code: string;
  public statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface UserDTO {
  id: number;
  name: string;
  email: string;
  roleId: number;
  roleName?: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  dateOfBirth?: string | null;
}

export class AuthService {
  // 1. Signup
  public async signup(data: {
    name: string;
    email: string;
    password: string;
    dateOfBirth?: string;
  }): Promise<{ user: UserDTO; verificationToken: string; verificationCode: string }> {
    const connection = await pool.getConnection();
    try {
      // Check existing email
      const [existing] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [data.email.toLowerCase()]
      );

      if (existing.length > 0) {
        throw new AuthError('An account with this email address already exists.', 'CONFLICT', 409);
      }

      // Find customer role ID
      const [roleRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM roles WHERE name = 'customer'"
      );
      const customerRoleId = roleRows.length > 0 ? roleRows[0].id : 6;

      const passwordHash = await hashPassword(data.password);
      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO users (name, email, password_hash, role_id, is_active, email_verified_at, date_of_birth)
         VALUES (?, ?, ?, ?, FALSE, NULL, ?)`,
        [data.name, data.email.toLowerCase(), passwordHash, customerRoleId, data.dateOfBirth || null]
      );

      const userId = result.insertId;

      // Generate verification token and 6-digit code (valid 24h)
      const verificationToken = generateSecureToken(32);
      const verificationCode = generateNumericCode(6);
      const tokenHash = hashToken(verificationToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await connection.query(
        `INSERT INTO auth_tokens (user_id, token_type, token_hash, code, expires_at)
         VALUES (?, 'email_verify', ?, ?, ?)`,
        [userId, tokenHash, verificationCode, expiresAt]
      );

      const user: UserDTO = {
        id: userId,
        name: data.name,
        email: data.email.toLowerCase(),
        roleId: customerRoleId,
        roleName: 'customer',
        isActive: false,
        emailVerifiedAt: null,
        twoFactorEnabled: false,
        dateOfBirth: data.dateOfBirth || null,
      };

      return { user, verificationToken, verificationCode };
    } finally {
      connection.release();
    }
  }

  // 2. Email verification
  public async verifyEmail(tokenOrCode: string, email?: string): Promise<{ verified: boolean; userId: number }> {
    const isNumericCode = /^\d{6}$/.test(tokenOrCode.trim());
    if (isNumericCode && !email) {
      throw new AuthError('Email address is required when verifying with a numeric 6-digit code.', 'VALIDATION_FAILED', 422);
    }

    const connection = await pool.getConnection();
    try {
      let query: string;
      const params: unknown[] = [];

      if (isNumericCode) {
        query = `
          SELECT t.id, t.user_id, t.expires_at, u.email
          FROM auth_tokens t
          JOIN users u ON u.id = t.user_id
          WHERE t.token_type = 'email_verify' AND t.code = ? AND u.email = ?
        `;
        params.push(tokenOrCode.trim(), email!.toLowerCase());
      } else {
        const hashed = hashToken(tokenOrCode.trim());
        query = `
          SELECT t.id, t.user_id, t.expires_at, u.email
          FROM auth_tokens t
          JOIN users u ON u.id = t.user_id
          WHERE t.token_type = 'email_verify' AND t.token_hash = ?
        `;
        params.push(hashed);
        if (email) {
          query += ' AND u.email = ?';
          params.push(email.toLowerCase());
        }
      }

      const [rows] = await connection.query<RowDataPacket[]>(query, params);

      if (rows.length === 0) {
        throw new AuthError('Invalid verification token or code.', 'VALIDATION_FAILED', 422);
      }

      const record = rows[0];
      if (new Date() > new Date(record.expires_at)) {
        throw new AuthError('Verification code has expired. Please request a new one.', 'EXPIRED', 422);
      }

      // Activate user
      await connection.query(
        'UPDATE users SET is_active = TRUE, email_verified_at = NOW() WHERE id = ?',
        [record.user_id]
      );

      // Invalidate used token
      await connection.query('DELETE FROM auth_tokens WHERE id = ?', [record.id]);

      return { verified: true, userId: record.user_id };
    } finally {
      connection.release();
    }
  }

  // 3. Resend email verification
  public async resendVerification(email: string): Promise<{ message: string; verificationToken: string; verificationCode: string }> {
    const rateCheck = authRateLimiter.canResendVerification(email);
    if (!rateCheck.allowed) {
      throw new AuthError(rateCheck.reason || 'Too many resend attempts.', 'RATE_LIMITED', 429);
    }

    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, email_verified_at FROM users WHERE email = ?',
        [email.toLowerCase()]
      );

      if (rows.length === 0) {
        return {
          message: 'If that email address exists and is unverified, a new code has been sent.',
          verificationToken: '',
          verificationCode: '',
        };
      }

      const user = rows[0];
      if (user.email_verified_at) {
        return {
          message: 'Account is already verified. You can log in.',
          verificationToken: '',
          verificationCode: '',
        };
      }

      // Invalidate previous tokens
      await connection.query(
        "DELETE FROM auth_tokens WHERE user_id = ? AND token_type = 'email_verify'",
        [user.id]
      );

      const verificationToken = generateSecureToken(32);
      const verificationCode = generateNumericCode(6);
      const tokenHash = hashToken(verificationToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await connection.query(
        `INSERT INTO auth_tokens (user_id, token_type, token_hash, code, expires_at)
         VALUES (?, 'email_verify', ?, ?, ?)`,
        [user.id, tokenHash, verificationCode, expiresAt]
      );

      authRateLimiter.recordResend(email);

      return {
        message: 'A fresh verification email and code has been sent.',
        verificationToken,
        verificationCode,
      };
    } finally {
      connection.release();
    }
  }

  // 4. Login
  public async login(data: {
    email: string;
    password: string;
    twoFactorCode?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    user?: UserDTO;
    token?: string;
    expiresAt?: string;
    requires2fa?: boolean;
    tempToken?: string;
  }> {
    const emailKey = data.email.toLowerCase();

    // Check account lockout
    const lockStatus = authRateLimiter.isLocked(emailKey);
    if (lockStatus.locked) {
      throw new AuthError(
        `Account temporarily locked due to too many failed attempts. Try again in ${lockStatus.remainingSeconds} seconds.`,
        'RATE_LIMITED',
        429
      );
    }

    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, u.password_hash, u.role_id, u.is_active,
                u.email_verified_at, u.two_factor_enabled, u.two_factor_secret,
                r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.email = ?`,
        [emailKey]
      );

      if (rows.length === 0) {
        authRateLimiter.recordFailedLogin(emailKey);
        throw new AuthError('Invalid email or password.', 'UNAUTHENTICATED', 401);
      }

      const user = rows[0];
      const passwordMatch = await verifyPassword(data.password, user.password_hash);

      if (!passwordMatch) {
        const attempt = authRateLimiter.recordFailedLogin(emailKey);
        throw new AuthError(
          attempt.locked
            ? `Too many failed attempts. Account locked for ${attempt.lockoutSeconds} seconds.`
            : 'Invalid email or password.',
          attempt.locked ? 'RATE_LIMITED' : 'UNAUTHENTICATED',
          attempt.locked ? 429 : 401
        );
      }

      // Check email verification
      if (!user.email_verified_at) {
        throw new AuthError(
          'Email address is not verified. Please verify your email before logging in.',
          'EMAIL_NOT_VERIFIED',
          403
        );
      }

      // 2FA Verification check
      if (user.two_factor_enabled) {
        if (!data.twoFactorCode) {
          // Issue temporary challenge token
          const tempToken = generateSecureToken(32);
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min
          await connection.query(
            `INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at)
             VALUES (?, '2fa_temp', ?, ?)`,
            [user.id, hashToken(tempToken), expiresAt]
          );

          return {
            requires2fa: true,
            tempToken,
          };
        }

        const valid2fa = verifyTotpCode(user.two_factor_secret, data.twoFactorCode);
        if (!valid2fa) {
          throw new AuthError('Invalid two-factor authentication code.', 'UNAUTHENTICATED', 401);
        }
      }

      // Login successful: reset rate limiter
      authRateLimiter.resetLoginAttempts(emailKey);

      // Create session (valid 30 days)
      const sessionToken = generateSecureToken(32);
      const tokenHash = hashToken(sessionToken);
      const sessionId = generateSecureToken(16);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await connection.query(
        `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, user.id, tokenHash, data.ipAddress || null, data.userAgent || null, expiresAt]
      );

      const userDto: UserDTO = {
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: user.role_id,
        roleName: user.role_name,
        isActive: Boolean(user.is_active),
        emailVerifiedAt: user.email_verified_at,
        twoFactorEnabled: Boolean(user.two_factor_enabled),
      };

      return {
        user: userDto,
        token: sessionToken,
        expiresAt: expiresAt.toISOString(),
      };
    } finally {
      connection.release();
    }
  }

  // 5. Logout
  public async logout(sessionToken: string): Promise<boolean> {
    const connection = await pool.getConnection();
    try {
      const tokenHash = hashToken(sessionToken);
      await connection.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
      return true;
    } finally {
      connection.release();
    }
  }

  // 6. Forgot Password
  public async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [email.toLowerCase()]
      );

      if (rows.length === 0) {
        return {
          message: 'If an account with that email exists, a password reset link has been sent.',
        };
      }

      const userId = rows[0].id;

      // Invalidate existing password reset tokens
      await connection.query(
        "DELETE FROM auth_tokens WHERE user_id = ? AND token_type = 'password_reset'",
        [userId]
      );

      const resetToken = generateSecureToken(32);
      const tokenHash = hashToken(resetToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await connection.query(
        `INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at)
         VALUES (?, 'password_reset', ?, ?)`,
        [userId, tokenHash, expiresAt]
      );

      return {
        message: 'If an account with that email exists, a password reset link has been sent.',
        resetToken,
      };
    } finally {
      connection.release();
    }
  }

  // 7. Reset Password
  public async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const connection = await pool.getConnection();
    try {
      const tokenHash = hashToken(token);

      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT id, user_id, expires_at FROM auth_tokens WHERE token_type = 'password_reset' AND token_hash = ?",
        [tokenHash]
      );

      if (rows.length === 0) {
        throw new AuthError('Invalid or expired password reset token.', 'VALIDATION_FAILED', 422);
      }

      const tokenRecord = rows[0];
      if (new Date() > new Date(tokenRecord.expires_at)) {
        throw new AuthError('Password reset token has expired. Please request a new one.', 'EXPIRED', 422);
      }

      const passwordHash = await hashPassword(newPassword);

      // Update password
      await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [
        passwordHash,
        tokenRecord.user_id,
      ]);

      // Delete token
      await connection.query('DELETE FROM auth_tokens WHERE id = ?', [tokenRecord.id]);

      // Invalidate all active sessions for this user for security
      await connection.query('DELETE FROM sessions WHERE user_id = ?', [tokenRecord.user_id]);

      return true;
    } finally {
      connection.release();
    }
  }

  // 8. 2FA Setup
  public async setup2FA(userId: number): Promise<{ secret: string; otpAuthUri: string }> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT email FROM users WHERE id = ?',
        [userId]
      );

      if (rows.length === 0) {
        throw new AuthError('User not found.', 'NOT_FOUND', 404);
      }

      const email = rows[0].email;
      const secret = generateTotpSecret(20);

      // Store secret on user (not yet activated)
      await connection.query('UPDATE users SET two_factor_secret = ? WHERE id = ?', [secret, userId]);

      const issuer = 'Universal CMS';
      const otpAuthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

      return { secret, otpAuthUri };
    } finally {
      connection.release();
    }
  }

  // 9. 2FA Enable
  public async enable2FA(userId: number, code: string): Promise<boolean> {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT two_factor_secret FROM users WHERE id = ?',
        [userId]
      );

      if (rows.length === 0 || !rows[0].two_factor_secret) {
        throw new AuthError('2FA has not been initiated for this account.', 'VALIDATION_FAILED', 422);
      }

      const secret = rows[0].two_factor_secret;
      const isValid = verifyTotpCode(secret, code);

      if (!isValid) {
        throw new AuthError('Invalid verification code.', 'VALIDATION_FAILED', 422);
      }

      await connection.query('UPDATE users SET two_factor_enabled = TRUE WHERE id = ?', [userId]);
      return true;
    } finally {
      connection.release();
    }
  }

  // 10. Validate Session
  public async validateSession(sessionToken: string): Promise<UserDTO | null> {
    if (!sessionToken) return null;

    const connection = await pool.getConnection();
    try {
      const tokenHash = hashToken(sessionToken);

      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, u.role_id, u.is_active, u.email_verified_at,
                u.two_factor_enabled, u.date_of_birth, r.name AS role_name,
                s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
         WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = TRUE`,
        [tokenHash]
      );

      if (rows.length === 0) {
        return null;
      }

      const user = rows[0];
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: user.role_id,
        roleName: user.role_name,
        isActive: Boolean(user.is_active),
        emailVerifiedAt: user.email_verified_at,
        twoFactorEnabled: Boolean(user.two_factor_enabled),
        dateOfBirth: user.date_of_birth,
      };
    } finally {
      connection.release();
    }
  }
}

export const authService = new AuthService();
