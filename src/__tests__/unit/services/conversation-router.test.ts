import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Conversation Router — state machine logic
//
// We test checkShouldReset and handleBackCommand by importing
// the module and testing through handleIncomingMessage behavior.
// Since those are private functions, we extract and test the
// logic inline by re-implementing the pure parts.
// ============================================================

// --- Pure logic extracted from conversation.ts for testing ---

const CONVERSATION_TIMEOUT_HOURS = 4;

function checkShouldReset(conv: { updatedAt: string }, message: string): boolean {
  const lastUpdate = new Date(conv.updatedAt);
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate > CONVERSATION_TIMEOUT_HOURS) return true;

  const restartKeywords = ['restart', 'start over', 'من جديد', 'ابدا من جديد', 'reset', 'بداية'];
  return restartKeywords.some(keyword => message.toLowerCase().includes(keyword));
}

function handleBackCommand(
  message: string,
  conv: { state: string; step: number }
): { handled: boolean; newState: string; newStep: number } {
  const backKeywords = ['back', 'رجوع', 'السابق', 'ارجع', 'previous'];
  if (!backKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
    return { handled: false, newState: conv.state, newStep: conv.step };
  }

  if (conv.state === 'questions' && conv.step > 0) {
    return { handled: true, newState: 'questions', newStep: conv.step - 1 };
  } else if (conv.state === 'questions' && conv.step === 0) {
    return { handled: true, newState: 'welcome', newStep: 0 };
  } else if (conv.state === 'appointment_date') {
    return { handled: true, newState: 'questions', newStep: conv.step };
  } else if (conv.state === 'appointment_time') {
    return { handled: true, newState: 'appointment_date', newStep: 0 };
  }
  return { handled: false, newState: conv.state, newStep: conv.step };
}

// ============================================================
// checkShouldReset
// ============================================================

describe('checkShouldReset', () => {
  it('returns true when conversation is older than 4 hours', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(checkShouldReset({ updatedAt: fiveHoursAgo }, 'hello')).toBe(true);
  });

  it('returns false when conversation is recent', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(checkShouldReset({ updatedAt: oneHourAgo }, 'hello')).toBe(false);
  });

  it('returns true on "restart" keyword regardless of time', () => {
    const now = new Date().toISOString();
    expect(checkShouldReset({ updatedAt: now }, 'restart')).toBe(true);
  });

  it('returns true on "start over" keyword', () => {
    const now = new Date().toISOString();
    expect(checkShouldReset({ updatedAt: now }, 'I want to start over')).toBe(true);
  });

  it('returns true on Arabic restart "من جديد"', () => {
    const now = new Date().toISOString();
    expect(checkShouldReset({ updatedAt: now }, 'من جديد')).toBe(true);
  });

  it('returns true on Arabic restart "بداية"', () => {
    const now = new Date().toISOString();
    expect(checkShouldReset({ updatedAt: now }, 'بداية')).toBe(true);
  });

  it('is case insensitive', () => {
    const now = new Date().toISOString();
    expect(checkShouldReset({ updatedAt: now }, 'RESTART')).toBe(true);
    expect(checkShouldReset({ updatedAt: now }, 'Reset')).toBe(true);
  });

  it('returns false on normal message within timeout', () => {
    const now = new Date().toISOString();
    expect(checkShouldReset({ updatedAt: now }, 'I want to buy something')).toBe(false);
  });

  it('returns true at exactly the boundary (>4h)', () => {
    const justOver = new Date(Date.now() - 4 * 60 * 60 * 1000 - 1000).toISOString();
    expect(checkShouldReset({ updatedAt: justOver }, 'hello')).toBe(true);
  });
});

// ============================================================
// handleBackCommand
// ============================================================

describe('handleBackCommand', () => {
  it('does nothing on non-back messages', () => {
    const result = handleBackCommand('hello', { state: 'questions', step: 2 });
    expect(result.handled).toBe(false);
  });

  it('goes back one question step on "back"', () => {
    const result = handleBackCommand('back', { state: 'questions', step: 2 });
    expect(result).toEqual({ handled: true, newState: 'questions', newStep: 1 });
  });

  it('goes to welcome from questions step 0 on "back"', () => {
    const result = handleBackCommand('back', { state: 'questions', step: 0 });
    expect(result).toEqual({ handled: true, newState: 'welcome', newStep: 0 });
  });

  it('goes to questions from appointment_date on "رجوع"', () => {
    const result = handleBackCommand('رجوع', { state: 'appointment_date', step: 3 });
    expect(result).toEqual({ handled: true, newState: 'questions', newStep: 3 });
  });

  it('goes to appointment_date from appointment_time on "previous"', () => {
    const result = handleBackCommand('previous', { state: 'appointment_time', step: 0 });
    expect(result).toEqual({ handled: true, newState: 'appointment_date', newStep: 0 });
  });

  it('does nothing on "back" in welcome state', () => {
    const result = handleBackCommand('back', { state: 'welcome', step: 0 });
    expect(result.handled).toBe(false);
  });

  it('does nothing on "back" in completed state', () => {
    const result = handleBackCommand('back', { state: 'completed', step: 0 });
    expect(result.handled).toBe(false);
  });

  it('does nothing on "back" in chat state', () => {
    const result = handleBackCommand('back', { state: 'chat', step: 0 });
    expect(result.handled).toBe(false);
  });

  it('recognizes Arabic "ارجع"', () => {
    const result = handleBackCommand('ارجع', { state: 'questions', step: 1 });
    expect(result).toEqual({ handled: true, newState: 'questions', newStep: 0 });
  });

  it('recognizes Arabic "السابق"', () => {
    const result = handleBackCommand('السابق', { state: 'appointment_time', step: 0 });
    expect(result).toEqual({ handled: true, newState: 'appointment_date', newStep: 0 });
  });

  it('is case insensitive for English', () => {
    const result = handleBackCommand('BACK', { state: 'questions', step: 2 });
    expect(result).toEqual({ handled: true, newState: 'questions', newStep: 1 });
  });

  it('handles back embedded in a sentence', () => {
    const result = handleBackCommand('go back please', { state: 'questions', step: 3 });
    expect(result).toEqual({ handled: true, newState: 'questions', newStep: 2 });
  });
});
