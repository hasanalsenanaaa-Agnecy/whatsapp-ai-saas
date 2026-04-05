import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../services/ai-conversation.js';

describe('parseAIResponse', () => {
  it('extracts plain text when no tags', () => {
    const result = parseAIResponse('أهلاً وسهلاً! كيف أقدر أساعدك؟');
    expect(result.text).toBe('أهلاً وسهلاً! كيف أقدر أساعدك؟');
    expect(result.data).toEqual({});
    expect(result.buttons).toBeNull();
    expect(result.list).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.handover).toBe(false);
  });

  it('extracts [DATA:key=value] pairs', () => {
    const result = parseAIResponse('تمام يا محمد![DATA:name=محمد] وش تبي تعرف؟');
    expect(result.data).toEqual({ name: 'محمد' });
    expect(result.text).toBe('تمام يا محمد! وش تبي تعرف؟');
  });

  it('extracts multiple [DATA:] tags', () => {
    const result = parseAIResponse('[DATA:name=أحمد][DATA:city=الرياض][DATA:phone=0551234567] تم الحفظ');
    expect(result.data).toEqual({ name: 'أحمد', city: 'الرياض', phone: '0551234567' });
    expect(result.text).toBe('تم الحفظ');
  });

  it('extracts [BUTTONS:body|opt1,opt2,opt3]', () => {
    const result = parseAIResponse('اختر الخدمة المناسبة[BUTTONS:وش تبي؟|عقارات,سيارات,خدمات]');
    expect(result.buttons).toEqual({
      body: 'وش تبي؟',
      options: ['عقارات', 'سيارات', 'خدمات']
    });
    expect(result.text).toBe('اختر الخدمة المناسبة');
  });

  it('limits buttons to max 3', () => {
    const result = parseAIResponse('[BUTTONS:اختر|أ,ب,ج,د,هـ]');
    expect(result.buttons!.options).toHaveLength(3);
    expect(result.buttons!.options).toEqual(['أ', 'ب', 'ج']);
  });

  it('extracts [LIST:body|buttonText|opt1,opt2,...,optN]', () => {
    const result = parseAIResponse('[LIST:اختر المنطقة|اختر|الرياض,جدة,الدمام,مكة,المدينة]');
    expect(result.list).toEqual({
      body: 'اختر المنطقة',
      buttonText: 'اختر',
      options: ['الرياض', 'جدة', 'الدمام', 'مكة', 'المدينة']
    });
  });

  it('limits list to max 10 items', () => {
    const opts = Array.from({ length: 15 }, (_, i) => `خيار${i + 1}`).join(',');
    const result = parseAIResponse(`[LIST:اختر|عرض|${opts}]`);
    expect(result.list!.options).toHaveLength(10);
  });

  it('detects [COMPLETE]', () => {
    const result = parseAIResponse('شكراً لك! تم تسجيل بياناتك بنجاح ✅[COMPLETE]');
    expect(result.complete).toBe(true);
    expect(result.text).toBe('شكراً لك! تم تسجيل بياناتك بنجاح ✅');
  });

  it('detects [HANDOVER]', () => {
    const result = parseAIResponse('تمام بنحولك لأحد فريقنا[HANDOVER]');
    expect(result.handover).toBe(true);
    expect(result.text).toBe('تمام بنحولك لأحد فريقنا');
  });

  it('handles combined tags in one message', () => {
    const raw = 'زين يا محمد![DATA:name=محمد] وش المنطقة؟[BUTTONS:اختر المنطقة|شمال,جنوب,وسط]';
    const result = parseAIResponse(raw);
    expect(result.data).toEqual({ name: 'محمد' });
    expect(result.buttons).toEqual({
      body: 'اختر المنطقة',
      options: ['شمال', 'جنوب', 'وسط']
    });
    expect(result.text).toBe('زين يا محمد! وش المنطقة؟');
    expect(result.complete).toBe(false);
    expect(result.handover).toBe(false);
  });

  it('handles empty string', () => {
    const result = parseAIResponse('');
    expect(result.text).toBe('');
    expect(result.data).toEqual({});
    expect(result.buttons).toBeNull();
    expect(result.list).toBeNull();
  });
});
