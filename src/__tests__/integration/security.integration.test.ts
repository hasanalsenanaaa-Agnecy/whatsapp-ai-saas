import { describe, it, expect, beforeAll } from 'vitest';
import { initializeEncryption, encrypt, decrypt } from '../../database/encryption';
import { sanitizeInput, sanitizeEmail, sanitizePhoneNumber } from '../../security/input-sanitizer';

describe('Security Integration', () => {
  beforeAll(() => {
    initializeEncryption();
  });

  it('should sanitize user inputs before encryption', () => {
    const maliciousInput = '<script>alert("xss")</script>';
    const sanitized = sanitizeInput(maliciousInput);
    const encrypted = encrypt(sanitized);
    const decrypted = decrypt(encrypted);

    expect(decrypted).not.toContain('<script>');
  });

  it('should validate and encrypt email addresses', () => {
    const validEmail = 'user@example.com';
    const sanitized = sanitizeEmail(validEmail);
    const encrypted = encrypt(sanitized);

    expect(sanitized).toBe(validEmail.toLowerCase());
    expect(decrypt(encrypted)).toBe(validEmail.toLowerCase());
  });

  it('should validate and encrypt phone numbers', () => {
    const validPhone = '+966501234567';
    const sanitized = sanitizePhoneNumber(validPhone);
    const encrypted = encrypt(sanitized);

    expect(sanitized).toBe(validPhone);
    expect(decrypt(encrypted)).toBe(validPhone);
  });

  it('should reject invalid inputs', () => {
    expect(() => sanitizeEmail('invalid-email')).toThrow();
    expect(() => sanitizePhoneNumber('123')).toThrow();
  });
});
