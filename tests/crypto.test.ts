import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/crypto.js';

describe('Crypto Utilities', () => {
  it('hashes passwords with salt and verifies successfully', async () => {
    const raw = 'SecureSecretPassword123!';
    const hash = await hashPassword(raw);

    expect(hash).toContain(':');
    const isValid = await verifyPassword(raw, hash);
    expect(isValid).toBe(true);
  });

  it('rejects incorrect passwords', async () => {
    const raw = 'CorrectPassword';
    const hash = await hashPassword(raw);

    const isInvalid = await verifyPassword('WrongPassword', hash);
    expect(isInvalid).toBe(false);
  });
});
