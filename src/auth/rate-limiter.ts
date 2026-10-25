interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

interface ResendRecord {
  count: number;
  lastSentAt: number;
  windowStartAt: number;
}

export class AuthRateLimiter {
  private static instance: AuthRateLimiter;
  private loginAttempts: Map<string, AttemptRecord> = new Map();
  private resendRecords: Map<string, ResendRecord> = new Map();

  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  private readonly RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds between resends
  private readonly MAX_RESENDS_PER_WINDOW = 3;
  private readonly RESEND_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  public static getInstance(): AuthRateLimiter {
    if (!AuthRateLimiter.instance) {
      AuthRateLimiter.instance = new AuthRateLimiter();
    }
    return AuthRateLimiter.instance;
  }

  // --- Login Rate Limiting & Lockout ---

  public isLocked(key: string): { locked: boolean; remainingSeconds: number } {
    const record = this.loginAttempts.get(key.toLowerCase());
    if (!record || !record.lockedUntil) {
      return { locked: false, remainingSeconds: 0 };
    }

    const now = Date.now();
    if (now < record.lockedUntil) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return { locked: true, remainingSeconds };
    }

    // Lock expired, reset
    this.loginAttempts.delete(key.toLowerCase());
    return { locked: false, remainingSeconds: 0 };
  }

  public recordFailedLogin(key: string): { locked: boolean; remainingAttempts: number; lockoutSeconds: number } {
    const k = key.toLowerCase();
    const now = Date.now();
    let record = this.loginAttempts.get(k);

    if (!record || now - record.firstAttemptAt > this.LOGIN_WINDOW_MS) {
      record = { count: 1, firstAttemptAt: now, lockedUntil: null };
      this.loginAttempts.set(k, record);
      return { locked: false, remainingAttempts: this.MAX_LOGIN_ATTEMPTS - 1, lockoutSeconds: 0 };
    }

    record.count += 1;

    if (record.count >= this.MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = now + this.LOCKOUT_DURATION_MS;
      return { locked: true, remainingAttempts: 0, lockoutSeconds: Math.ceil(this.LOCKOUT_DURATION_MS / 1000) };
    }

    return {
      locked: false,
      remainingAttempts: this.MAX_LOGIN_ATTEMPTS - record.count,
      lockoutSeconds: 0,
    };
  }

  public resetLoginAttempts(key: string): void {
    this.loginAttempts.delete(key.toLowerCase());
  }

  // --- Email Verification Resend Limits ---

  public canResendVerification(email: string): { allowed: boolean; reason?: string; waitSeconds?: number } {
    const key = email.toLowerCase();
    const now = Date.now();
    const record = this.resendRecords.get(key);

    if (!record || now - record.windowStartAt > this.RESEND_WINDOW_MS) {
      return { allowed: true };
    }

    // Check cooldown
    const elapsedSinceLast = now - record.lastSentAt;
    if (elapsedSinceLast < this.RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((this.RESEND_COOLDOWN_MS - elapsedSinceLast) / 1000);
      return {
        allowed: false,
        reason: `Please wait ${waitSeconds} seconds before requesting another code.`,
        waitSeconds,
      };
    }

    // Check max resends per window
    if (record.count >= this.MAX_RESENDS_PER_WINDOW) {
      const waitSeconds = Math.ceil((this.RESEND_WINDOW_MS - (now - record.windowStartAt)) / 1000);
      return {
        allowed: false,
        reason: `Maximum verification email requests reached. Please try again in ${Math.ceil(waitSeconds / 60)} minutes.`,
        waitSeconds,
      };
    }

    return { allowed: true };
  }

  public recordResend(email: string): void {
    const key = email.toLowerCase();
    const now = Date.now();
    const record = this.resendRecords.get(key);

    if (!record || now - record.windowStartAt > this.RESEND_WINDOW_MS) {
      this.resendRecords.set(key, { count: 1, lastSentAt: now, windowStartAt: now });
    } else {
      record.count += 1;
      record.lastSentAt = now;
    }
  }

  public clear(): void {
    this.loginAttempts.clear();
    this.resendRecords.clear();
  }
}

export const authRateLimiter = AuthRateLimiter.getInstance();
