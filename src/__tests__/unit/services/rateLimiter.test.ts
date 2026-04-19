import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, isConversationExpired } from '../../../services/rateLimiter.js';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first message from a new phone', () => {
    expect(checkRateLimit('+96500000001')).toBe(true);
  });

  it('allows up to 10 messages per minute', () => {
    const phone = '+96500000002';
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(phone)).toBe(true);
    }
  });

  it('blocks the 11th message within a minute', () => {
    const phone = '+96500000003';
    for (let i = 0; i < 10; i++) {
      checkRateLimit(phone);
    }
    expect(checkRateLimit(phone)).toBe(false);
  });

  it('resets after one minute', () => {
    const phone = '+96500000004';
    for (let i = 0; i < 10; i++) {
      checkRateLimit(phone);
    }
    expect(checkRateLimit(phone)).toBe(false);

    // Advance 61 seconds
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit(phone)).toBe(true);
  });
});

describe('isConversationExpired', () => {
  it('returns false for recent conversations', () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    expect(isConversationExpired(fiveMinutesAgo)).toBe(false);
  });

  it('returns true after default 24 hours', () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    expect(isConversationExpired(twentyFiveHoursAgo)).toBe(true);
  });

  it('respects custom hour limit', () => {
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    expect(isConversationExpired(threeHoursAgo, 4)).toBe(false);
    expect(isConversationExpired(threeHoursAgo, 2)).toBe(true);
  });
});
