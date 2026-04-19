import { describe, it, expect } from 'vitest';
import { detectPostCompletionIntent } from '../../../flows/common.js';

describe('detectPostCompletionIntent', () => {
  it('detects cancellation intent (Arabic)', () => {
    const result = detectPostCompletionIntent('أبي الغاء الطلب');
    expect(result.type).toBe('cancel');
    expect(result.confidence).toBe('high');
    expect(result.forwardToAgent).toBe(true);
  });

  it('detects cancellation intent (English)', () => {
    const result = detectPostCompletionIntent('I want to cancel');
    expect(result.type).toBe('cancel');
  });

  it('detects reschedule intent', () => {
    const result = detectPostCompletionIntent('أبي تغيير موعد');
    expect(result.type).toBe('reschedule');
    expect(result.forwardToAgent).toBe(true);
  });

  it('detects status update intent (Arabic)', () => {
    const result = detectPostCompletionIntent('وين طلبي');
    expect(result.type).toBe('status_update');
  });

  it('detects status update intent (English)', () => {
    const result = detectPostCompletionIntent('can I get a tracking update');
    expect(result.type).toBe('status_update');
  });

  it('detects complaint intent', () => {
    const result = detectPostCompletionIntent('عندي مشكلة بالطلب');
    expect(result.type).toBe('complaint');
    expect(result.forwardToAgent).toBe(true);
  });

  it('detects talk-to-agent intent', () => {
    const result = detectPostCompletionIntent('أبي أكلم موظف');
    expect(result.type).toBe('talk_to_agent');
  });

  it('returns general for unmatched messages', () => {
    const result = detectPostCompletionIntent('شكرا');
    expect(result.type).toBe('general');
    expect(result.confidence).toBe('medium');
    expect(result.forwardToAgent).toBe(false);
  });

  it('returns general for greetings', () => {
    const result = detectPostCompletionIntent('مرحبا');
    expect(result.type).toBe('general');
  });

  it('is case-insensitive', () => {
    expect(detectPostCompletionIntent('CANCEL').type).toBe('cancel');
    expect(detectPostCompletionIntent('Cancel My Order').type).toBe('cancel');
  });
});
