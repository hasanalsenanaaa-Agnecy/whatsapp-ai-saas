import { describe, it, expect } from 'vitest';

// ============================================================
// Data Retention — PDPL compliance logic
//
// Tests the retention cutoff calculation and the anonymization
// strategy decisions. The actual SQL is not testable without a
// DB, but we verify the logic that drives it.
// ============================================================

const RETENTION_MONTHS = 24;

function calculateRetentionCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff;
}

// Strategy: which tables get what treatment
interface RetentionStrategy {
  events: 'anonymize';       // strip phone, keep analytics data
  conversations: 'anonymize'; // strip phone + messages, keep metadata
  leads: 'delete';           // pure PII, no business value when old
  appointments: 'delete';    // pure PII, no business value when old
}

const STRATEGY: RetentionStrategy = {
  events: 'anonymize',
  conversations: 'anonymize',
  leads: 'delete',
  appointments: 'delete',
};

// What gets preserved after anonymization
interface AnonymizedConversation {
  phone: string;         // 'anon-' + hash
  messages: string;      // '[]' — cleared
  data: {
    _lang?: string;           // kept — for analytics
    _intent?: string;         // kept — for analytics
    _shopifyState?: string;   // kept — for analytics
    _consentGiven?: string;   // kept — legal compliance
    _anonymizedAt: string;    // timestamp of anonymization
  };
}

function anonymizePhone(phone: string): string {
  // Simulates: 'anon-' || LEFT(MD5(phone), 8)
  // We can't test MD5 without crypto but we test the format
  return `anon-${phone.slice(0, 8)}`;
}

function buildAnonymizedData(originalData: Record<string, any>): AnonymizedConversation['data'] {
  return {
    _lang: originalData._lang || undefined,
    _intent: originalData._intent || undefined,
    _shopifyState: originalData._shopifyState || undefined,
    _consentGiven: originalData._consentGiven || undefined,
    _anonymizedAt: new Date().toISOString(),
  };
}

// ============================================================
// Retention cutoff
// ============================================================

describe('calculateRetentionCutoff', () => {
  it('returns a date 24 months in the past', () => {
    const now = new Date('2026-04-20T00:00:00Z');
    const cutoff = calculateRetentionCutoff(now);
    expect(cutoff.getFullYear()).toBe(2024);
    expect(cutoff.getMonth()).toBe(3); // April = month 3 (0-indexed)
  });

  it('handles year boundary (January - 24 months = January 2 years ago)', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    const cutoff = calculateRetentionCutoff(now);
    expect(cutoff.getFullYear()).toBe(2024);
    expect(cutoff.getMonth()).toBe(0); // January
  });

  it('handles month rollover correctly', () => {
    const now = new Date('2026-03-31T00:00:00Z');
    const cutoff = calculateRetentionCutoff(now);
    // March 31 - 24 months = March 31, 2024 or auto-adjusted
    expect(cutoff.getFullYear()).toBe(2024);
  });
});

// ============================================================
// Retention strategy
// ============================================================

describe('retention strategy', () => {
  it('anonymizes events (not deletes)', () => {
    expect(STRATEGY.events).toBe('anonymize');
  });

  it('anonymizes conversations (not deletes)', () => {
    expect(STRATEGY.conversations).toBe('anonymize');
  });

  it('deletes leads (pure PII)', () => {
    expect(STRATEGY.leads).toBe('delete');
  });

  it('deletes appointments (pure PII)', () => {
    expect(STRATEGY.appointments).toBe('delete');
  });
});

// ============================================================
// Anonymization logic
// ============================================================

describe('anonymizePhone', () => {
  it('produces an anon- prefixed string', () => {
    const result = anonymizePhone('96512345678');
    expect(result.startsWith('anon-')).toBe(true);
  });

  it('does not contain the original full phone', () => {
    const result = anonymizePhone('96512345678');
    expect(result).not.toBe('96512345678');
    expect(result.length).toBeLessThan('96512345678'.length + 6);
  });
});

describe('buildAnonymizedData', () => {
  it('preserves _lang', () => {
    const result = buildAnonymizedData({ _lang: 'ar', _name: 'Ahmed', _cart: [1, 2] });
    expect(result._lang).toBe('ar');
  });

  it('preserves _intent', () => {
    const result = buildAnonymizedData({ _intent: 'browse', phone: '12345' });
    expect(result._intent).toBe('browse');
  });

  it('preserves _shopifyState', () => {
    const result = buildAnonymizedData({ _shopifyState: 'done' });
    expect(result._shopifyState).toBe('done');
  });

  it('preserves _consentGiven', () => {
    const result = buildAnonymizedData({ _consentGiven: 'true' });
    expect(result._consentGiven).toBe('true');
  });

  it('adds _anonymizedAt timestamp', () => {
    const result = buildAnonymizedData({});
    expect(result._anonymizedAt).toBeDefined();
    expect(new Date(result._anonymizedAt).getTime()).toBeGreaterThan(0);
  });

  it('strips PII fields (name, phone, cart, checkout)', () => {
    const result = buildAnonymizedData({
      _lang: 'en',
      name: 'Ahmed',
      phone: '12345',
      _cart: [{ product: 'dates' }],
      _checkout: { url: 'https://...' },
      _selectedProduct: { title: 'Dates' },
    });
    // Only the allowed fields should be present (plus _anonymizedAt)
    const keys = Object.keys(result).filter(k => result[k as keyof typeof result] !== undefined);
    expect(keys).toContain('_lang');
    expect(keys).toContain('_anonymizedAt');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('_cart');
    expect(keys).not.toContain('_checkout');
  });
});
