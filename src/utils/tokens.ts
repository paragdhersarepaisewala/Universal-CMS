import { randomBytes, createHash } from 'node:crypto';

export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateNumericCode(digits = 6): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % Math.pow(10, digits);
  return num.toString().padStart(digits, '0');
}
