import { describe, it, expect } from 'vitest';
import { detectHandoverIntent, looksLikeQuestion, scoreLead, getScoreLabel } from '../../../services/knowledge.js';

describe('detectHandoverIntent', () => {
  it('detects Arabic handover phrases', () => {
    expect(detectHandoverIntent('أبي أكلم موظف')).toBe(true);
    expect(detectHandoverIntent('حولني لشخص')).toBe(true);
    expect(detectHandoverIntent('ابغى موظف')).toBe(true);
    expect(detectHandoverIntent('وصلني بموظف')).toBe(true);
  });

  it('detects English handover phrases', () => {
    expect(detectHandoverIntent('I want to talk to someone')).toBe(true);
    expect(detectHandoverIntent('agent please')).toBe(true);
    expect(detectHandoverIntent('real person')).toBe(true);
    expect(detectHandoverIntent('speak to a human')).toBe(true);
  });

  it('returns false for normal messages', () => {
    expect(detectHandoverIntent('مرحبا')).toBe(false);
    expect(detectHandoverIntent('أبي أشتري')).toBe(false);
    expect(detectHandoverIntent('hello')).toBe(false);
    expect(detectHandoverIntent('what is the price?')).toBe(false);
  });
});

describe('looksLikeQuestion', () => {
  it('detects Arabic question marks', () => {
    expect(looksLikeQuestion('كم السعر؟')).toBe(true);
  });

  it('detects English question marks', () => {
    expect(looksLikeQuestion('What is the price?')).toBe(true);
  });

  it('detects strong Arabic question indicators', () => {
    expect(looksLikeQuestion('كم الحجم')).toBe(true);
    expect(looksLikeQuestion('كيف اطلب')).toBe(true);
    expect(looksLikeQuestion('عندكم توصيل')).toBe(true);
    expect(looksLikeQuestion('بكم هذا')).toBe(true);
  });

  it('detects weak indicators only with sufficient length', () => {
    expect(looksLikeQuestion('هل فيه توصيل لجدة')).toBe(true);
    expect(looksLikeQuestion('هل')).toBe(false); // too short
  });

  it('returns false for short non-questions', () => {
    expect(looksLikeQuestion('ok')).toBe(false);
    expect(looksLikeQuestion('نعم')).toBe(false);
    expect(looksLikeQuestion('1')).toBe(false);
  });
});

describe('scoreLead', () => {
  // Scoring: budget=2, appointment=3, interest=2, location=1, timeline=2,
  //          messageCount>5=1, >10=+1, priceInquiry=2, high budget=+2
  // Thresholds: hot>=6, warm>=3, cold<3

  it('scores hot when appointment requested and budget mentioned', () => {
    // appointment=3, budget=2, interest=2 → 7 → hot
    expect(scoreLead({ appointment: true, budget: '500000', interest: 'فيلا' })).toBe('hot');
  });

  it('scores warm with moderate engagement', () => {
    // interest=2, location=1 → 3 → warm
    expect(scoreLead({ interest: 'شقة', location: 'الرياض' })).toBe('warm');
  });

  it('scores cold with minimal data', () => {
    expect(scoreLead({})).toBe('cold');
    expect(scoreLead({ messageCount: 1 })).toBe('cold');
  });

  it('gives extra points for high budget indicators', () => {
    // budget=2, high budget=+2, interest=2 → 6 → hot
    const result = scoreLead({ budget: 'مليون ريال', interest: 'فيلا' });
    expect(result).toBe('hot');
  });

  it('gives points for urgent timeline', () => {
    // timeline=2, interest=2 → 4 → warm
    expect(scoreLead({ timeline: 'الآن', interest: 'شقة' })).toBe('warm');
  });

  it('gives points for high message count', () => {
    // interest=2, messageCount>5=1, >10=+1 → 4 → warm
    expect(scoreLead({ messageCount: 12, interest: 'شقة' })).toBe('warm');
  });

  it('gives points for price inquiry', () => {
    // priceInquiry=2, interest=2 → 4 → warm
    expect(scoreLead({ askedAboutPrice: true, interest: 'أرض' })).toBe('warm');
  });

  it('scores hot with many signals combined', () => {
    // appointment=3, budget=2, interest=2, priceInquiry=2 → 9 → hot
    expect(scoreLead({ appointment: true, budget: '100000', interest: 'شقة', askedAboutPrice: true })).toBe('hot');
  });
});

describe('getScoreLabel', () => {
  it('returns Arabic labels with emojis', () => {
    expect(getScoreLabel('hot')).toBe('🔥 حار');
    expect(getScoreLabel('warm')).toBe('🟡 دافئ');
    expect(getScoreLabel('cold')).toBe('❄️ بارد');
  });
});
