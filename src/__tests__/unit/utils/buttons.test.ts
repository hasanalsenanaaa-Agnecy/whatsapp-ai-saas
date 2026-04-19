import { describe, it, expect } from 'vitest';
import { truncate, smartTitle, maskPhone, normalizeArabicNumbers } from '../../../utils/buttons.js';

describe('truncate', () => {
  it('returns text unchanged when within limit', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });

  it('returns text unchanged when exactly at limit', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });

  it('truncates with ellipsis when over limit', () => {
    expect(truncate('Hello World', 5)).toBe('Hell…');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('handles single character limit', () => {
    expect(truncate('AB', 1)).toBe('…');
  });
});

describe('smartTitle', () => {
  it('extracts weight and variety from date product names', () => {
    const result = smartTitle('Jumbo Premium Royal Khalas Dates, 2kg', 20);
    expect(result).toBe('2kg Jumbo Khalas');
  });

  it('handles weight only', () => {
    expect(smartTitle('Premium Dates 500g', 20)).toBe('500g Premium');
  });

  it('handles variety only', () => {
    expect(smartTitle('Sukkari Dates', 20)).toBe('Sukkari');
  });

  it('falls back to truncate for unrecognized titles', () => {
    expect(smartTitle('Regular Product', 10)).toBe('Regular P…');
  });

  it('extracts extra descriptor after variety (e.g. Al-Madinah)', () => {
    const result = smartTitle('Ajwa Al-Madinah Dates 1kg', 24);
    expect(result).toBe('1kg Ajwa Al-Madinah');
  });

  it('does not include Dates as extra descriptor', () => {
    const result = smartTitle('Khalas Dates 500g', 20);
    expect(result).toBe('500g Khalas');
  });

  it('truncates compact result if still over limit', () => {
    const result = smartTitle('Jumbo Premium Khalas Al-Madinah 2kg', 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('maskPhone', () => {
  it('masks middle digits of a phone number', () => {
    expect(maskPhone('+96512345678')).toBe('+965*****678');
  });

  it('returns *** for short numbers', () => {
    expect(maskPhone('12345')).toBe('***');
  });

  it('returns *** for empty string', () => {
    expect(maskPhone('')).toBe('***');
  });

  it('handles 7-char number (minimum maskable length)', () => {
    expect(maskPhone('1234567')).toBe('1234567');
  });

  it('handles 8-char number', () => {
    expect(maskPhone('12345678')).toBe('1234*678');
  });
});

describe('normalizeArabicNumbers', () => {
  it('converts Arabic numerals to Western digits', () => {
    expect(normalizeArabicNumbers('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('leaves Western digits unchanged', () => {
    expect(normalizeArabicNumbers('0123456789')).toBe('0123456789');
  });

  it('handles mixed text', () => {
    expect(normalizeArabicNumbers('كمية ٣ قطع')).toBe('كمية 3 قطع');
  });

  it('handles empty string', () => {
    expect(normalizeArabicNumbers('')).toBe('');
  });

  it('handles text with no numerals', () => {
    expect(normalizeArabicNumbers('hello world')).toBe('hello world');
  });
});
