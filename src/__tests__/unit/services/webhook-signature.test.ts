import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// ============================================================
// WhatsApp Webhook Signature Verification
//
// Copied from index.ts — security-critical, must be validated.
// ============================================================

function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

describe('verifyWebhookSignature (WhatsApp)', () => {
  const secret = 'whatsapp-app-secret';

  function sign(body: string, key: string): string {
    return 'sha256=' + crypto.createHmac('sha256', key).update(body).digest('hex');
  }

  it('returns true for valid signature', () => {
    const body = '{"entry":[]}';
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = '{"entry":[]}';
    const sig = sign(body, secret);
    expect(verifyWebhookSignature('{"entry":[1]}', sig, secret)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{"entry":[]}';
    const sig = sign(body, 'wrong-secret');
    expect(verifyWebhookSignature(body, sig, secret)).toBe(false);
  });

  it('returns false for empty signature', () => {
    expect(verifyWebhookSignature('body', '', secret)).toBe(false);
  });

  it('returns false for empty secret', () => {
    expect(verifyWebhookSignature('body', 'sha256=abc', '')).toBe(false);
  });

  it('returns false for mismatched length', () => {
    expect(verifyWebhookSignature('body', 'sha256=short', secret)).toBe(false);
  });

  it('handles unicode message body', () => {
    const body = '{"text":"مرحبا"}';
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('signature includes sha256= prefix', () => {
    const body = 'test';
    const sig = sign(body, secret);
    expect(sig.startsWith('sha256=')).toBe(true);
  });
});
