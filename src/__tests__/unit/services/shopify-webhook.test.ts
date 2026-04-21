import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// ============================================================
// Shopify Webhook — pure functions
//
// normalisePhone and verifyShopifyHmac are private in the module.
// We re-implement them here for testing since the logic is
// security-critical and must be validated.
// ============================================================

// --- Copied from shopify-webhook.ts for testing ---

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) return digits.substring(2);
  if (digits.startsWith('0') && digits.length <= 10) return digits.substring(1);
  return digits;
}

function verifyShopifyHmac(rawBody: string, hmacHeader: string, secret: string): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ============================================================
// normalisePhone
// ============================================================

describe('normalisePhone', () => {
  it('returns null for undefined', () => {
    expect(normalisePhone(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalisePhone('')).toBeNull();
  });

  it('returns null for non-digit string', () => {
    expect(normalisePhone('abc')).toBeNull();
  });

  it('strips leading + from international format', () => {
    expect(normalisePhone('+96512345678')).toBe('96512345678');
  });

  it('handles spaces and dashes', () => {
    expect(normalisePhone('+965 1234-5678')).toBe('96512345678');
  });

  it('handles parentheses', () => {
    expect(normalisePhone('(+965) 12345678')).toBe('96512345678');
  });

  it('strips leading 00 dialing prefix', () => {
    expect(normalisePhone('009651234567')).toBe('9651234567');
  });

  it('strips leading 0 for short local numbers (<=10 digits)', () => {
    expect(normalisePhone('0512345678')).toBe('512345678');
  });

  it('does NOT strip leading 0 for long numbers (>10 digits)', () => {
    expect(normalisePhone('096512345678')).toBe('096512345678');
  });

  it('handles Saudi mobile with country code', () => {
    expect(normalisePhone('+966501234567')).toBe('966501234567');
  });

  it('handles Kuwait number', () => {
    expect(normalisePhone('+96551234567')).toBe('96551234567');
  });

  it('preserves plain digit string', () => {
    expect(normalisePhone('96512345678')).toBe('96512345678');
  });
});

// ============================================================
// verifyShopifyHmac
// ============================================================

describe('verifyShopifyHmac', () => {
  const secret = 'test-secret-123';

  function generateHmac(body: string, key: string): string {
    return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');
  }

  it('returns true for valid HMAC', () => {
    const body = '{"order_number": 1001}';
    const hmac = generateHmac(body, secret);
    expect(verifyShopifyHmac(body, hmac, secret)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = '{"order_number": 1001}';
    const hmac = generateHmac(body, secret);
    expect(verifyShopifyHmac('{"order_number": 9999}', hmac, secret)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{"order_number": 1001}';
    const hmac = generateHmac(body, secret);
    expect(verifyShopifyHmac(body, hmac, 'wrong-secret')).toBe(false);
  });

  it('returns false for empty HMAC', () => {
    expect(verifyShopifyHmac('body', '', secret)).toBe(false);
  });

  it('returns false for malformed HMAC (different length)', () => {
    expect(verifyShopifyHmac('body', 'short', secret)).toBe(false);
  });

  it('handles empty body', () => {
    const hmac = generateHmac('', secret);
    expect(verifyShopifyHmac('', hmac, secret)).toBe(true);
  });

  it('handles unicode body', () => {
    const body = '{"name": "تمر خلاص"}';
    const hmac = generateHmac(body, secret);
    expect(verifyShopifyHmac(body, hmac, secret)).toBe(true);
  });
});
