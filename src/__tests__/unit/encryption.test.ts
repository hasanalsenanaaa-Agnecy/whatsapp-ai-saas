import { describe, it, expect, beforeAll } from 'vitest';
import {
  initializeEncryption,
  encrypt,
  decrypt,
  hashData,
  verifyHashedData,
  generateSecureToken
} from '../../database/encryption';

describe('Encryption Utilities', () => {
  beforeAll(() => {
    initializeEncryption();
  });

  it('should encrypt and decrypt data', () => {
    const original = 'sensitive-data-123';
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':');

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('should produce different ciphertexts for same plaintext', () => {
    const plaintext = 'test';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it('should hash and verify data', () => {
    const original = 'password123';
    const hash = hashData(original);

    expect(hash).not.toBe(original);
    expect(verifyHashedData(original, hash)).toBe(true);
    expect(verifyHashedData('wrong-password', hash)).toBe(false);
  });

  it('should generate secure tokens', () => {
    const token1 = generateSecureToken(32);
    const token2 = generateSecureToken(32);

    expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it('should handle long data', () => {
    const longData = 'x'.repeat(10000);
    const encrypted = encrypt(longData);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(longData);
  });
});
