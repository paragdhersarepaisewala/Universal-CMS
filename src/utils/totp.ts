import { createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(byteLength = 20): string {
  const bytes = randomBytes(byteLength);
  let bits = '';
  let secret = '';

  for (let i = 0; i < bytes.length; i++) {
    const val = bytes[i];
    bits += val.toString(2).padStart(8, '0');
  }

  for (let i = 0; i + 5 <= bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5);
    const index = parseInt(chunk, 2);
    secret += BASE32_ALPHABET[index];
  }

  return secret;
}

function base32ToBuffer(base32: string): Buffer {
  let bits = '';
  for (let i = 0; i < base32.length; i++) {
    const char = base32[i].toUpperCase();
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const chunk = bits.slice(i, i + 8);
    bytes.push(parseInt(chunk, 2));
  }

  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, timestampMs = Date.now()): string {
  const timeStep = Math.floor(timestampMs / 1000 / 30);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(timeStep));

  const key = base32ToBuffer(secret);
  const hmac = createHmac('sha1', key).update(timeBuffer).digest();

  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binaryCode % 1000000;
  return otp.toString().padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  if (!code || code.length !== 6) {
    return false;
  }

  const now = Date.now();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const checkTime = now + errorWindow * 30 * 1000;
    const generated = generateTotpCode(secret, checkTime);
    if (generated === code) {
      return true;
    }
  }

  return false;
}
