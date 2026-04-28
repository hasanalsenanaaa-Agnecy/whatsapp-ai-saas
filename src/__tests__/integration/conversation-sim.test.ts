// ============================================================
// CONVERSATION SIMULATOR — INTEGRATION HARNESS (20 scripts)
//
// Drives handleIncomingMessage end-to-end with scripted multi-turn
// conversations. Captures bot output via SIM_MODE=1, asserts state
// transitions and message content. Catches state-machine bugs that
// unit tests miss (cart loss on timeout, language drop on reset,
// concurrent webhook races, etc.).
//
// External systems (DB, Sheets, events, booking) are mocked with
// in-memory stores so tests run without infrastructure.
// ============================================================

// SIM_MODE must be set BEFORE importing whatsapp.js — that module
// reads the flag at top level when SIM_ENABLED is initialized.
process.env.SIM_MODE = '1';

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory stores (reset per test) ──────────────────────────
const conversations = new Map<string, any>();
let fakeClient: any = null;
const events: { type: string; phone: string; meta?: any }[] = [];

// AI mocking — flippable per test, captures all calls
let aiAvailableFlag = true;
const aiCalls: { fn: string; message: string }[] = [];

vi.mock('../../services/database.js', () => ({
  getClientByPhoneNumberId: vi.fn(async () => fakeClient),
  getConversation: vi.fn(async (clientId: string, phone: string) =>
    conversations.get(`${clientId}:${phone}`) || null),
  saveConversation: vi.fn(async (conv: any) => {
    conversations.set(`${conv.clientId}:${conv.phone}`, conv);
  }),
  createLead: vi.fn(async () => 1),
  createAppointment: vi.fn(async () => 1),
  initDatabase: vi.fn(async () => {}),
}));

vi.mock('../../services/googleSheets.js', () => ({
  saveLeadToSheet: vi.fn(async () => true),
}));

vi.mock('../../services/events.js', () => ({
  emitEvent: vi.fn((_clientId: string, type: string, phone: string, meta?: any) => {
    events.push({ type, phone, meta });
  }),
}));

vi.mock('../../services/bookingWebhook.js', () => ({
  pushToBookingAPI: vi.fn(async () => ({ ok: true, bookingId: 'mock' })),
}));

// Keep all real exports of knowledge.js (detectHandoverIntent, looksLikeQuestion,
// scoreLead) so unrelated scripts behave normally. Override only the two
// AI-dependent ones so we can drive tests deterministically without a real key.
vi.mock('../../services/knowledge.js', async () => {
  const actual: any = await vi.importActual('../../services/knowledge.js');
  return {
    ...actual,
    isAIAvailable: vi.fn(() => aiAvailableFlag),
    generateKnowledgeResponse: vi.fn(async (
      _name: string,
      _kb: any[],
      _data: any,
      _history: any[],
      message: string,
    ) => {
      aiCalls.push({ fn: 'generateKnowledgeResponse', message });
      return {
        answer: `[AI_REPLY] ${message}`,
        confident: true,
        suggestHandover: false,
        durationMs: 50,
        tokensUsed: 100,
      };
    }),
  };
});

const { handleIncomingMessage } = await import('../../conversation.js');
const { drainSimMessages } = await import('../../services/whatsapp.js');

// ── Harness ────────────────────────────────────────────────────

interface Turn {
  send: string;
  expect?: {
    state?: string;
    step?: number;
    contains?: string[];
    notContains?: string[];
    minReplies?: number;
    eventTypes?: string[];
    noDuplicateReplies?: boolean;
    aiCalled?: boolean;
    aiNotCalled?: boolean;
  };
}

async function runScript(client: any, phone: string, turns: Turn[]) {
  fakeClient = client;
  conversations.clear();
  events.length = 0;
  aiCalls.length = 0;
  aiAvailableFlag = true;
  drainSimMessages();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const eventsBefore = events.length;
    await handleIncomingMessage(
      client.phone_number_id,
      phone,
      turn.send,
      'SIM_TOKEN'
    );
    const replies = drainSimMessages();
    const allText = replies.map(r => r.body || '').join('\n');
    const conv = conversations.get(`${client.id}:${phone}`);
    const turnEvents = events.slice(eventsBefore).map(e => e.type);

    const ctx = `Turn ${i + 1} ('${turn.send}')`;
    if (turn.expect?.contains) {
      for (const s of turn.expect.contains) {
        expect(allText, `${ctx}: expected reply to contain '${s}'\nactual:\n${allText}`).toContain(s);
      }
    }
    if (turn.expect?.notContains) {
      for (const s of turn.expect.notContains) {
        expect(allText, `${ctx}: reply should NOT contain '${s}'\nactual:\n${allText}`).not.toContain(s);
      }
    }
    if (turn.expect?.state !== undefined) {
      expect(conv?.state, `${ctx}: state mismatch`).toBe(turn.expect.state);
    }
    if (turn.expect?.step !== undefined) {
      expect(conv?.step, `${ctx}: step mismatch`).toBe(turn.expect.step);
    }
    if (turn.expect?.minReplies !== undefined) {
      expect(replies.length, `${ctx}: too few replies`).toBeGreaterThanOrEqual(turn.expect.minReplies);
    }
    if (turn.expect?.eventTypes) {
      for (const t of turn.expect.eventTypes) {
        expect(turnEvents, `${ctx}: expected event '${t}'`).toContain(t);
      }
    }
    if (turn.expect?.noDuplicateReplies) {
      const bodies = replies.map(r => r.body || '').filter(Boolean);
      const unique = new Set(bodies);
      expect(unique.size, `${ctx}: bot sent duplicate replies in one turn:\n${bodies.join('\n---\n')}`).toBe(bodies.length);
    }
    if (turn.expect?.aiCalled) {
      const aiCallsThisTurn = aiCalls.filter(c => c.message === turn.send);
      expect(aiCallsThisTurn.length, `${ctx}: AI should have been called`).toBeGreaterThan(0);
    }
    if (turn.expect?.aiNotCalled) {
      const aiCallsThisTurn = aiCalls.filter(c => c.message === turn.send);
      expect(aiCallsThisTurn.length, `${ctx}: AI should NOT have been called`).toBe(0);
    }
  }
}

// Direct seeder for tests that need to start mid-flow (e.g. appointment states)
// without walking through every preceding turn.
function seedConversation(client: any, phone: string, partial: any) {
  fakeClient = client;
  const conv = {
    clientId: client.id,
    phone,
    messages: [],
    state: 'welcome',
    step: 0,
    data: { whatsappPhone: phone, welcomeSent: true, name: 'فاطمة' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
  conv.data = { whatsappPhone: phone, welcomeSent: true, name: 'فاطمة', ...(partial.data || {}) };
  conversations.set(`${client.id}:${phone}`, conv);
  return conv;
}

function makeRealEstateClient(overrides: any = {}) {
  return {
    id: 'sim-test-1',
    phone_number_id: 'pn_sim_1',
    access_token: 'SIM_TOKEN',
    industry: 'real_estate',
    name: 'Test Realty',
    features: {},
    settings: {},
    questions: [],
    agent_phones: [],
    ...overrides,
  };
}

// ============================================================
// 1–4: WELCOME STATE
// ============================================================

describe('welcome state', () => {
  it('SCRIPT 1: greets with business name on first message', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000001', [
      { send: 'مرحبا', expect: { state: 'welcome', contains: ['Test Realty'], minReplies: 1 } },
    ]);
  });

  it('SCRIPT 2: captures name on second message and advances to questions', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000002', [
      { send: 'hi' },
      { send: 'أحمد', expect: { state: 'questions', step: 0 } },
    ]);
  });

  it('SCRIPT 3: rejects pure numeric input as name', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000003', [
      { send: 'hi' },
      { send: '12345', expect: { state: 'welcome', contains: ['اسمك'] } },
    ]);
  });

  it('SCRIPT 4: rejects single-character input as name', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000004', [
      { send: 'hi' },
      { send: 'أ', expect: { state: 'welcome', contains: ['اسمك'] } },
    ]);
  });
});

// ============================================================
// 5–7: QUESTIONS STATE + STEP PROGRESSION
// ============================================================

describe('questions state', () => {
  it('SCRIPT 5: shows first question text after name capture', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000005', [
      { send: 'hi' },
      { send: 'سعد', expect: { state: 'questions', step: 0, contains: ['كيف أقدر أساعدك'] } },
    ]);
  });

  it('SCRIPT 6: advances to question 2 after answering question 1', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000006', [
      { send: 'hi' },
      { send: 'سعد' },
      { send: 'أبي أشتري عقار', expect: { state: 'questions', step: 1 } },
    ]);
  });

  it('SCRIPT 7: progresses through three questions', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000007', [
      { send: 'hi' },
      { send: 'سعد' },
      { send: 'أبي أشتري عقار', expect: { step: 1 } },
      { send: 'شقة', expect: { step: 2 } },
      { send: 'الدمام', expect: { step: 3 } },
    ]);
  });
});

// ============================================================
// 8–10: BACK COMMAND
// ============================================================

describe('back command', () => {
  it('SCRIPT 8: "back" from question step 1 returns to step 0', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000008', [
      { send: 'hi' },
      { send: 'سعد' },
      { send: 'أبي أشتري عقار', expect: { step: 1 } },
      { send: 'back', expect: { state: 'questions', step: 0 } },
    ]);
  });

  it('SCRIPT 9: "back" from step 0 returns to welcome and preserves captured name', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000009', [
      { send: 'hi' },
      { send: 'سعد', expect: { state: 'questions', step: 0 } },
      { send: 'رجوع', expect: { state: 'welcome', step: 0, contains: ['تم الرجوع'] } },
    ]);
    const conv = conversations.get(`${client.id}:966500000009`);
    expect(conv?.data?.name, 'name should survive back navigation').toBe('سعد');
  });

  it('SCRIPT 10: a normal message in questions does NOT trigger back navigation', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000010', [
      { send: 'hi' },
      { send: 'سعد' },
      { send: 'أبي أشتري عقار', expect: { step: 1 } },
      // free-text reply that's not a "back" keyword: should stay in questions
      { send: 'مرحبا', expect: { state: 'questions' } },
    ]);
  });
});

// ============================================================
// 11–14: RESTART KEYWORDS (English + Arabic)
// ============================================================

describe('restart keywords', () => {
  it('SCRIPT 11: "restart" English resets state', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000011', [
      { send: 'hi' },
      { send: 'سعد', expect: { state: 'questions' } },
      { send: 'restart', expect: { state: 'welcome', contains: ['Test Realty'] } },
    ]);
  });

  it('SCRIPT 12: "start over" English resets state', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000012', [
      { send: 'hi' },
      { send: 'سعد', expect: { state: 'questions' } },
      { send: 'I want to start over', expect: { state: 'welcome' } },
    ]);
  });

  it('SCRIPT 13: Arabic "بداية" resets state', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000013', [
      { send: 'hi' },
      { send: 'سعد', expect: { state: 'questions' } },
      { send: 'بداية', expect: { state: 'welcome' } },
    ]);
  });

  it('SCRIPT 14: Arabic "من جديد" resets state', async () => {
    const client = makeRealEstateClient();
    await runScript(client, '966500000014', [
      { send: 'hi' },
      { send: 'سعد', expect: { state: 'questions' } },
      { send: 'من جديد', expect: { state: 'welcome' } },
    ]);
  });
});

// ============================================================
// 15–17: PRESERVATION ACROSS RESET (the bug class that this
// test file's preservation logic at conversation.ts:114 was
// written to prevent — verify each preserved key actually sticks)
// ============================================================

describe('preservation across reset', () => {
  it('SCRIPT 15: timeout (4h) reset preserves customer name', async () => {
    const client = makeRealEstateClient();
    const phone = '966500000015';

    await runScript(client, phone, [
      { send: 'hi' },
      { send: 'فاطمة', expect: { state: 'questions' } },
    ]);

    // Force stale updatedAt to trigger timeout reset on next turn
    const conv = conversations.get(`${client.id}:${phone}`);
    expect(conv?.data?.name).toBe('فاطمة');
    conv.updatedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    conversations.set(`${client.id}:${phone}`, conv);

    drainSimMessages();
    await handleIncomingMessage(client.phone_number_id, phone, 'hello again', 'SIM_TOKEN');
    const reset = conversations.get(`${client.id}:${phone}`);
    expect(reset?.state).toBe('welcome');
    expect(reset?.data?.name, 'name should survive timeout reset').toBe('فاطمة');
  });

  it('SCRIPT 16: "restart" keyword preserves _consentGiven flag', async () => {
    const client = makeRealEstateClient();
    const phone = '966500000016';
    fakeClient = client;
    conversations.clear();

    await handleIncomingMessage(client.phone_number_id, phone, 'hi', 'SIM_TOKEN');
    const conv = conversations.get(`${client.id}:${phone}`);
    conv.data._consentGiven = true;
    conv.data._consentAt = new Date().toISOString();
    conversations.set(`${client.id}:${phone}`, conv);

    drainSimMessages();
    await handleIncomingMessage(client.phone_number_id, phone, 'restart', 'SIM_TOKEN');
    const reset = conversations.get(`${client.id}:${phone}`);
    expect(reset?.state).toBe('welcome');
    expect(reset?.data?._consentGiven, 'consent flag should survive restart').toBe(true);
    expect(reset?.data?._consentAt, 'consent timestamp should survive restart').toBeTruthy();
  });

  it('SCRIPT 17: "restart" keyword preserves _lang flag', async () => {
    const client = makeRealEstateClient();
    const phone = '966500000017';
    fakeClient = client;
    conversations.clear();

    await handleIncomingMessage(client.phone_number_id, phone, 'hi', 'SIM_TOKEN');
    const conv = conversations.get(`${client.id}:${phone}`);
    conv.data._lang = 'en';
    conv.data._langAsked = true;
    conversations.set(`${client.id}:${phone}`, conv);

    drainSimMessages();
    await handleIncomingMessage(client.phone_number_id, phone, 'restart', 'SIM_TOKEN');
    const reset = conversations.get(`${client.id}:${phone}`);
    expect(reset?.data?._lang, 'language should survive restart').toBe('en');
    expect(reset?.data?._langAsked, 'language-asked flag should survive restart').toBe(true);
  });
});

// ============================================================
// 18–19: HANDOVER DETECTION (feature flag both directions)
// ============================================================

describe('handover detection', () => {
  it('SCRIPT 18: with handover_detection ON, "موظف" emits escalation event', async () => {
    const client = makeRealEstateClient({ features: { handover_detection: true } });
    const phone = '966500000018';
    fakeClient = client;
    conversations.clear();
    events.length = 0;
    drainSimMessages();

    await handleIncomingMessage(client.phone_number_id, phone, 'hi', 'SIM_TOKEN');
    drainSimMessages();
    await handleIncomingMessage(client.phone_number_id, phone, 'أبي أكلم موظف', 'SIM_TOKEN');

    const escalations = events.filter(e => e.type === 'escalation');
    expect(escalations.length, 'should emit escalation event').toBeGreaterThan(0);
  });

  it('SCRIPT 19: with handover_detection OFF, "موظف" does NOT escalate', async () => {
    const client = makeRealEstateClient({ features: { handover_detection: false } });
    const phone = '966500000019';
    fakeClient = client;
    conversations.clear();
    events.length = 0;
    drainSimMessages();

    await handleIncomingMessage(client.phone_number_id, phone, 'hi', 'SIM_TOKEN');
    drainSimMessages();
    await handleIncomingMessage(client.phone_number_id, phone, 'أبي أكلم موظف', 'SIM_TOKEN');

    const escalations = events.filter(e => e.type === 'escalation');
    expect(escalations.length, 'should NOT emit escalation when feature off').toBe(0);
  });
});

// ============================================================
// 20: CONCURRENCY + CONVERSATION_START EVENT
// ============================================================

describe('concurrency and event emission', () => {
  it('SCRIPT 20: serializes 5 parallel messages with no lost writes; emits 1 conversation_start', async () => {
    const client = makeRealEstateClient();
    const phone = '966500000020';
    fakeClient = client;
    conversations.clear();
    events.length = 0;
    drainSimMessages();

    await Promise.all([
      handleIncomingMessage(client.phone_number_id, phone, 'msg1', 'SIM_TOKEN'),
      handleIncomingMessage(client.phone_number_id, phone, 'msg2', 'SIM_TOKEN'),
      handleIncomingMessage(client.phone_number_id, phone, 'msg3', 'SIM_TOKEN'),
      handleIncomingMessage(client.phone_number_id, phone, 'msg4', 'SIM_TOKEN'),
      handleIncomingMessage(client.phone_number_id, phone, 'msg5', 'SIM_TOKEN'),
    ]);

    const conv = conversations.get(`${client.id}:${phone}`);
    const userMsgs = conv.messages.filter((m: any) => m.role === 'user').map((m: any) => m.content);
    expect(userMsgs, 'all 5 user messages should be recorded').toEqual(['msg1', 'msg2', 'msg3', 'msg4', 'msg5']);

    const starts = events.filter(e => e.type === 'conversation_start');
    expect(starts.length, 'should emit exactly one conversation_start for the new conversation').toBe(1);
  });
});

// ============================================================
// 21–28: AI INJECTION AT EACH STAGE
// Mock generateKnowledgeResponse so we can verify the AI is
// invoked with the right input + the bot doesn't repeat itself.
// ============================================================

describe('AI fallback injected mid-flow', () => {
  it('SCRIPT 21: AI fires in WELCOME when customer asks instead of giving name', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true } });
    await runScript(client, '966500000021', [
      { send: 'hi' },
      {
        send: 'كم سعر العقارات؟',
        expect: {
          state: 'welcome',
          aiCalled: true,
          contains: ['[AI_REPLY]'],
          noDuplicateReplies: true,
        },
      },
    ]);
  });

  it('SCRIPT 22: AI fires in QUESTIONS when customer asks unrelated question; step does not advance', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true } });
    await runScript(client, '966500000022', [
      { send: 'hi' },
      { send: 'سعد' },
      { send: 'أبي أشتري عقار', expect: { step: 1 } },
      {
        send: 'كم متوسط أسعار الشقق في الدمام؟',
        expect: {
          state: 'questions',
          step: 1,
          aiCalled: true,
          contains: ['[AI_REPLY]'],
          noDuplicateReplies: true,
        },
      },
    ]);
  });

  it('SCRIPT 23: appointment_date routes off-topic questions to AI then re-prompts picker', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true, appointment_setting: true } });
    const phone = '966500000023';
    seedConversation(client, phone, { state: 'appointment_date' });
    drainSimMessages();
    aiCalls.length = 0;

    await handleIncomingMessage(client.phone_number_id, phone, 'كم سعر الموعد؟', 'SIM_TOKEN');
    const replies = drainSimMessages();
    const conv = conversations.get(`${client.id}:${phone}`);
    const allText = replies.map(r => r.body || '').join('\n');

    expect(aiCalls.length, 'AI fallback fires for off-topic question while picking date').toBeGreaterThan(0);
    expect(allText, 'customer sees AI answer').toContain('[AI_REPLY]');
    expect(allText, 'date picker re-rendered after AI reply').toContain('متى يناسبك');
    expect(replies.length, 'two replies: AI answer + picker re-prompt').toBeGreaterThanOrEqual(2);
    expect(conv?.state, 'state stays in appointment_date').toBe('appointment_date');
  });

  it('SCRIPT 24: appointment_time routes off-topic questions to AI then re-prompts picker', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true, appointment_setting: true } });
    const phone = '966500000024';
    seedConversation(client, phone, {
      state: 'appointment_time',
      data: {
        whatsappPhone: phone,
        welcomeSent: true,
        name: 'فاطمة',
        appointmentDate: '2026-05-01',
        appointmentDateLabel: 'الجمعة',
      },
    });
    drainSimMessages();
    aiCalls.length = 0;

    await handleIncomingMessage(client.phone_number_id, phone, 'وش أفضل وقت؟', 'SIM_TOKEN');
    const replies = drainSimMessages();
    const conv = conversations.get(`${client.id}:${phone}`);
    const allText = replies.map(r => r.body || '').join('\n');

    expect(aiCalls.length, 'AI fallback fires for off-topic question while picking time').toBeGreaterThan(0);
    expect(allText).toContain('[AI_REPLY]');
    expect(allText, 'time picker re-rendered after AI reply').toContain('أي وقت');
    expect(replies.length, 'two replies: AI answer + picker re-prompt').toBeGreaterThanOrEqual(2);
    expect(conv?.state).toBe('appointment_time');
  });

  it('SCRIPT 25: AI fires in CHAT (post-completion) for general questions', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true } });
    const phone = '966500000025';
    seedConversation(client, phone, { state: 'completed' });
    drainSimMessages();
    aiCalls.length = 0;

    await handleIncomingMessage(client.phone_number_id, phone, 'وش عندكم منتجات جديدة؟', 'SIM_TOKEN');
    const replies = drainSimMessages();
    const conv = conversations.get(`${client.id}:${phone}`);
    const allText = replies.map(r => r.body || '').join('\n');

    expect(conv?.state, 'completed transitions to chat on first turn').toBe('chat');
    expect(aiCalls.length, 'AI should answer general post-completion questions').toBeGreaterThan(0);
    expect(allText).toContain('[AI_REPLY]');
  });

  it('SCRIPT 26: graceful fallback when AI is unavailable mid-conversation', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true } });
    const phone = '966500000026';
    fakeClient = client;
    conversations.clear();

    await handleIncomingMessage(client.phone_number_id, phone, 'hi', 'SIM_TOKEN');
    drainSimMessages();
    aiCalls.length = 0;
    aiAvailableFlag = false;

    await handleIncomingMessage(client.phone_number_id, phone, 'كم السعر؟', 'SIM_TOKEN');
    const replies = drainSimMessages();
    const allText = replies.map(r => r.body || '').join('\n');

    expect(aiCalls.length, 'no AI call when unavailable').toBe(0);
    expect(allText, 'shows graceful apology message').toContain('عذراً');
  });

  it('SCRIPT 27: AI budget exceeded — limit message after 25 prior calls', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true } });
    const phone = '966500000027';
    fakeClient = client;
    conversations.clear();
    aiAvailableFlag = true;

    await handleIncomingMessage(client.phone_number_id, phone, 'hi', 'SIM_TOKEN');
    const conv = conversations.get(`${client.id}:${phone}`);
    conv.data._aiCallCount = 25;
    conversations.set(`${client.id}:${phone}`, conv);

    drainSimMessages();
    aiCalls.length = 0;

    await handleIncomingMessage(client.phone_number_id, phone, 'كم السعر؟', 'SIM_TOKEN');
    const replies = drainSimMessages();
    const allText = replies.map(r => r.body || '').join('\n');

    expect(aiCalls.length, 'AI not called past budget').toBe(0);
    expect(allText, 'shows daily-limit message').toContain('تجاوزت');
  });

  it('SCRIPT 28: AI welcome turn produces no verbatim duplicate replies', async () => {
    const client = makeRealEstateClient({ features: { ai_fallback: true } });
    await runScript(client, '966500000028', [
      { send: 'hi' },
      {
        send: 'كم سعر العقارات؟',
        expect: { aiCalled: true, noDuplicateReplies: true, minReplies: 1 },
      },
    ]);
  });
});
