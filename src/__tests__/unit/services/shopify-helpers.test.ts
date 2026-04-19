import { describe, it, expect } from 'vitest';
import {
  phoneToCountryCode,
  isQuestionMessage,
  matchProduct,
  matchVariant,
  tryAnswerProductQuestion,
  getTopProductsByQuery,
  smartVariantTitle,
  formatOrderStatus
} from '../../../services/shopify/helpers.js';
import type { ShopifyProduct } from '../../../services/shopify.js';
import type { ShopifyAdminOrder } from '../../../services/shopify/types.js';

// ============================================================
// TEST DATA
// ============================================================

const mockProducts: ShopifyProduct[] = [
  {
    id: 'gid://1',
    title: 'تمر خلاص 500g',
    description: 'تمر خلاص فاخر',
    priceMin: '5.000',
    priceMax: '5.000',
    imageUrl: 'https://example.com/khalas.jpg',
    variants: [{ id: 'v1', title: '500g', price: '5.000', available: true, compareAtPrice: null }],
    tags: ['best-seller'],
    compareAtPriceMin: null
  },
  {
    id: 'gid://2',
    title: 'تمر سكري 1kg',
    description: 'تمر سكري ممتاز',
    priceMin: '8.000',
    priceMax: '8.000',
    imageUrl: 'https://example.com/sukkari.jpg',
    variants: [{ id: 'v2', title: '1kg', price: '8.000', available: true, compareAtPrice: null }],
    tags: ['new'],
    compareAtPriceMin: null
  },
  {
    id: 'gid://3',
    title: 'تمر عجوة المدينة 250g',
    description: 'تمر عجوة فاخر',
    priceMin: '12.000',
    priceMax: '12.000',
    imageUrl: null,
    variants: [{ id: 'v3', title: '250g', price: '12.000', available: true, compareAtPrice: null }],
    tags: ['gift', 'premium'],
    compareAtPriceMin: '15.000'
  }
];

const mockVariants = [
  { id: 'v1', title: '500g', price: '5.000', available: true, compareAtPrice: null },
  { id: 'v2', title: '1kg', price: '8.000', available: true, compareAtPrice: null },
  { id: 'v3', title: '250g', price: '12.000', available: true, compareAtPrice: null }
];

// ============================================================
// phoneToCountryCode
// ============================================================

describe('phoneToCountryCode', () => {
  it('maps Kuwait prefix', () => {
    expect(phoneToCountryCode('+96512345678')).toBe('KW');
  });

  it('maps Saudi prefix', () => {
    expect(phoneToCountryCode('+966501234567')).toBe('SA');
  });

  it('maps UAE prefix', () => {
    expect(phoneToCountryCode('+971501234567')).toBe('AE');
  });

  it('returns undefined for unknown prefix', () => {
    expect(phoneToCountryCode('+8612345678')).toBeUndefined();
  });

  it('matches longest prefix first (+1 vs +44)', () => {
    expect(phoneToCountryCode('+12025551234')).toBe('US');
    expect(phoneToCountryCode('+442071234567')).toBe('GB');
  });
});

// ============================================================
// isQuestionMessage
// ============================================================

describe('isQuestionMessage', () => {
  it('detects Arabic question mark', () => {
    expect(isQuestionMessage('كم السعر؟')).toBe(true);
  });

  it('detects English question mark', () => {
    expect(isQuestionMessage('What is the price?')).toBe(true);
  });

  it('detects Arabic question starters', () => {
    expect(isQuestionMessage('وش الفرق بينهم')).toBe(true);
    expect(isQuestionMessage('كيف اطلب')).toBe(true);
    expect(isQuestionMessage('كم السعر')).toBe(true);
    expect(isQuestionMessage('بكم هذا')).toBe(true);
  });

  it('detects English question starters', () => {
    expect(isQuestionMessage('what is the best')).toBe(true);
    expect(isQuestionMessage('how much')).toBe(true);
    expect(isQuestionMessage('which one is cheapest')).toBe(true);
  });

  it('returns false for non-questions', () => {
    expect(isQuestionMessage('1')).toBe(false);
    expect(isQuestionMessage('نعم')).toBe(false);
    expect(isQuestionMessage('ok')).toBe(false);
  });
});

// ============================================================
// matchProduct
// ============================================================

describe('matchProduct', () => {
  it('matches by pick_N button ID', () => {
    expect(matchProduct('pick_0', mockProducts)?.id).toBe('gid://1');
    expect(matchProduct('pick_2', mockProducts)?.id).toBe('gid://3');
  });

  it('returns null for out-of-range pick_N', () => {
    expect(matchProduct('pick_10', mockProducts)).toBeNull();
  });

  it('matches by number (1-indexed)', () => {
    expect(matchProduct('1', mockProducts)?.id).toBe('gid://1');
    expect(matchProduct('3', mockProducts)?.id).toBe('gid://3');
  });

  it('matches by Arabic number', () => {
    expect(matchProduct('٢', mockProducts)?.id).toBe('gid://2');
  });

  it('matches by partial title', () => {
    expect(matchProduct('خلاص', mockProducts)?.id).toBe('gid://1');
    expect(matchProduct('سكري', mockProducts)?.id).toBe('gid://2');
  });

  it('matches by keyword in title', () => {
    expect(matchProduct('عجوة', mockProducts)?.id).toBe('gid://3');
  });

  it('returns null for no match', () => {
    expect(matchProduct('بيتزا', mockProducts)).toBeNull();
  });
});

// ============================================================
// matchVariant
// ============================================================

describe('matchVariant', () => {
  it('matches by var_N button ID', () => {
    expect(matchVariant('var_0', mockVariants)?.id).toBe('v1');
    expect(matchVariant('var_2', mockVariants)?.id).toBe('v3');
  });

  it('matches by title', () => {
    expect(matchVariant('1kg', mockVariants)?.id).toBe('v2');
    expect(matchVariant('500g', mockVariants)?.id).toBe('v1');
  });

  it('returns null for no match', () => {
    expect(matchVariant('2kg', mockVariants)).toBeNull();
  });
});

// ============================================================
// tryAnswerProductQuestion
// ============================================================

describe('tryAnswerProductQuestion', () => {
  it('returns first product for "best" queries', () => {
    expect(tryAnswerProductQuestion('الأفضل', mockProducts)?.id).toBe('gid://1');
    expect(tryAnswerProductQuestion('best', mockProducts)?.id).toBe('gid://1');
  });

  it('returns cheapest product for "cheapest" queries', () => {
    expect(tryAnswerProductQuestion('الأرخص', mockProducts)?.id).toBe('gid://1');
    expect(tryAnswerProductQuestion('cheap', mockProducts)?.id).toBe('gid://1');
  });

  it('returns gift-tagged product for "gift" queries', () => {
    expect(tryAnswerProductQuestion('هدية', mockProducts)?.id).toBe('gid://3');
    expect(tryAnswerProductQuestion('gift', mockProducts)?.id).toBe('gid://3');
  });

  it('returns on-sale product for "sale" queries', () => {
    expect(tryAnswerProductQuestion('عرض', mockProducts)?.id).toBe('gid://3');
  });

  it('returns new product for "new" queries', () => {
    expect(tryAnswerProductQuestion('جديد', mockProducts)?.id).toBe('gid://2');
  });

  it('returns null for unrecognized queries', () => {
    expect(tryAnswerProductQuestion('مرحبا', mockProducts)).toBeNull();
  });

  it('returns null for empty products', () => {
    expect(tryAnswerProductQuestion('best', [])).toBeNull();
  });
});

// ============================================================
// getTopProductsByQuery
// ============================================================

describe('getTopProductsByQuery', () => {
  it('returns top N products for "best" queries', () => {
    const result = getTopProductsByQuery('الأفضل', mockProducts, 2);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('gid://1');
  });

  it('returns cheapest N products sorted by price', () => {
    const result = getTopProductsByQuery('الأرخص', mockProducts, 2);
    expect(result).toHaveLength(2);
    expect(parseFloat(result[0]!.priceMin)).toBeLessThanOrEqual(parseFloat(result[1]!.priceMin));
  });

  it('returns empty array for unmatched queries', () => {
    expect(getTopProductsByQuery('مرحبا', mockProducts)).toEqual([]);
  });

  it('returns empty array for empty products', () => {
    expect(getTopProductsByQuery('best', [])).toEqual([]);
  });
});

// ============================================================
// smartVariantTitle
// ============================================================

describe('smartVariantTitle', () => {
  it('shows price only for Default Title', () => {
    const result = smartVariantTitle('Default Title', '5.000', 'KWD', 20);
    expect(result).not.toContain('Default');
  });

  it('combines variant name and price', () => {
    const result = smartVariantTitle('500g', '5.000', 'KWD', 20);
    expect(result).toContain('500g');
  });

  it('truncates when combined exceeds max', () => {
    const result = smartVariantTitle('Very Long Variant Name Here', '999.999', 'KWD', 15);
    expect(result.length).toBeLessThanOrEqual(15);
  });
});

// ============================================================
// formatOrderStatus
// ============================================================

describe('formatOrderStatus', () => {
  const mockOrder: ShopifyAdminOrder = {
    order_number: 1042,
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    line_items: [
      { title: 'تمر خلاص 500g', quantity: 2 },
      { title: 'تمر سكري 1kg', quantity: 1 }
    ],
    fulfillments: [
      { tracking_url: 'https://track.example.com/123' }
    ]
  };

  it('formats Arabic order status', () => {
    const result = formatOrderStatus(mockOrder, 'ar');
    expect(result).toContain('#1042');
    expect(result).toContain('مدفوع ✅');
    expect(result).toContain('تم الشحن 🚚');
    expect(result).toContain('تمر خلاص');
    expect(result).toContain('track.example.com');
  });

  it('formats English order status', () => {
    const result = formatOrderStatus(mockOrder, 'en');
    expect(result).toContain('#1042');
    expect(result).toContain('Paid ✅');
    expect(result).toContain('Shipped 🚚');
  });

  it('handles pending/unfulfilled orders', () => {
    const pendingOrder: ShopifyAdminOrder = {
      order_number: 1043,
      financial_status: 'pending',
      fulfillment_status: null,
      line_items: [{ title: 'Product', quantity: 1 }],
      fulfillments: []
    };
    const result = formatOrderStatus(pendingOrder, 'ar');
    expect(result).toContain('بانتظار الدفع ⏳');
    expect(result).toContain('قيد التجهيز 🏭');
  });
});
