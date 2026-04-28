// ============================================================
// CONVERSATION ROUTER
// Thin state machine router — reads industry/config, delegates to flows.
// ============================================================

import { getConversation, saveConversation, getClientByPhoneNumberId } from './services/database.js';
import { emitEvent } from './services/events.js';
import { withClientContext } from './services/whatsapp.js';
import { getDefaultMessages, type ClientMessages } from './messages.js';
import { DEFAULT_APPOINTMENT_SETTINGS, type AppointmentSettings } from './services/appointments.js';
import {
  isShopifyClient,
  isAIConversationMode,
  shouldHandover,
  shouldReset,
  handleBackCommand,
} from './conversation.guards.js';

// Flow handlers
import { handleShopifyAgent } from './flows/ecommerce.js';
import {
  handleWelcome,
  handleQuestions,
  handleAppointmentDate,
  handleAppointmentTime,
  handleChat,
  handleAIConversation,
  handleHandoverRequest,
  type ClientFeatures
} from './flows/common.js';

// ============================================================
// PER-CUSTOMER ASYNC LOCK
// Two WhatsApp webhooks landing within ~100ms for the same
// customer can both read+write the same conversation row; the
// later write silently overrides the earlier, and cart items
// can be lost. Chain turns through a per-key promise so the
// second webhook waits for the first to finish persisting.
// In-memory is fine for this deployment (single Fastify process).
// ============================================================

const turnLocks = new Map<string, Promise<void>>();

async function runSerialized(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = turnLocks.get(key) || Promise.resolve();
  const current = prev.then(fn, fn);
  turnLocks.set(key, current);
  try {
    await current;
  } finally {
    // Only clear if we're still the tail — otherwise a later caller
    // chained onto us and owns the slot.
    if (turnLocks.get(key) === current) turnLocks.delete(key);
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleIncomingMessage(
  phoneNumberId: string,
  customerPhone: string,
  message: string,
  accessToken: string
): Promise<void> {
  const client = await getClientByPhoneNumberId(phoneNumberId);
  if (!client) {
    console.error(`❌ No client found for: ${phoneNumberId}`);
    return;
  }

  const lockKey = `${client.id}:${customerPhone}`;
  return withClientContext(client.id, () =>
    runSerialized(lockKey, () => handleTurn(client, customerPhone, message, accessToken))
  );
}

async function handleTurn(
  client: any,
  customerPhone: string,
  message: string,
  accessToken: string
): Promise<void> {
  const features: ClientFeatures = {
    ai_fallback: client.features?.ai_fallback || false,
    lead_scoring: client.features?.lead_scoring || false,
    handover_detection: client.features?.handover_detection || false,
    appointment_setting: client.features?.appointment_setting || false,
    ai_conversation: client.features?.ai_conversation || false
  };

  const appointmentSettings: AppointmentSettings = {
    ...DEFAULT_APPOINTMENT_SETTINGS,
    ...client.settings?.appointment
  };

  const defaults = getDefaultMessages(client.industry);
  const clientMessages: ClientMessages = {
    ...defaults,
    questions: client.questions?.length > 0 ? client.questions : defaults.questions
  };

  let conv = await getConversation(client.id, customerPhone);
  const now = new Date().toISOString();

  if (!conv || shouldReset(conv, message)) {
    // Preserve low-cost / customer-affecting flags across resets so a
    // returning customer isn't re-asked for language and consent every time
    // they type "restart" or timeout. PDPL consent is long-lived; re-asking
    // is user-hostile and unnecessary. `name` + `_orderHistory` are
    // webhook-captured facts about who this customer is — losing them on
    // timeout is why "يا {name}" reprompts almost never fire in practice.
    const preserved = conv?.data ? {
      _lang: (conv.data as any)._lang,
      _langAsked: (conv.data as any)._langAsked,
      _consentGiven: (conv.data as any)._consentGiven,
      _consentAsked: (conv.data as any)._consentAsked,
      _consentAt: (conv.data as any)._consentAt,
      name: (conv.data as any).name,
      _orderHistory: (conv.data as any)._orderHistory,
    } : {};
    conv = {
      clientId: client.id,
      phone: customerPhone,
      messages: [],
      state: 'welcome',
      step: 0,
      data: { whatsappPhone: customerPhone, ...preserved },
      createdAt: now,
      updatedAt: now
    };
    // Quota counter: one "conversation" = one 4h session per customer.
    // Emitted here so the monthly counter matches the contract definition.
    emitEvent(client.id, 'conversation_start', customerPhone);
  }

  conv.updatedAt = now;
  conv.messages.push({ role: 'user', content: message });
  // Cap history to prevent unbounded DB blob growth
  if (conv.messages.length > 100) {
    conv.messages = conv.messages.slice(-100);
  }

  // Back command (only during active flow)
  if (conv.state !== 'completed' && conv.state !== 'chat') {
    const backResult = handleBackCommand(message, conv);
    if (backResult.handled) {
      conv.state = backResult.newState;
      conv.step = backResult.newStep;
    }
  }

  // ============================================================
  // HANDOVER DETECTION (works in any state when enabled)
  // ============================================================
  if (shouldHandover(features, message)) {
    await handleHandoverRequest(client, conv, message, clientMessages, accessToken);
    emitEvent(client.id, 'escalation', customerPhone, { reason: 'handover_detected' });
    await saveConversation(conv);
    return;
  }

  // ============================================================
  // ROUTE TO FLOW
  // ============================================================

  // ECOMMERCE — Shopify Agent mode
  if (isShopifyClient(client) && (conv.state === 'welcome' || conv.state === 'shopify_agent')) {
    conv.state = 'shopify_agent';
    await handleShopifyAgent(client, conv, message, accessToken);
    await saveConversation(conv);
    return;
  }

  // AI CONVERSATION MODE — skips rigid flow entirely
  if (isAIConversationMode(features)) {
    if (conv.state === 'welcome' || conv.state === 'ai_conversation') {
      conv.state = 'ai_conversation';
      await handleAIConversation(client, conv, message, features, accessToken);
      await saveConversation(conv);
      return;
    }
    if (conv.state === 'completed' || conv.state === 'chat') {
      await saveConversation(conv);
      return;
    }
  }

  // STANDARD FLOW
  switch (conv.state) {
    case 'welcome':
      await handleWelcome(client, conv, message, clientMessages, features, accessToken);
      break;
    case 'questions':
      await handleQuestions(client, conv, message, clientMessages, features, appointmentSettings, accessToken);
      break;
    case 'appointment_date':
      await handleAppointmentDate(client, conv, message, clientMessages, appointmentSettings, accessToken);
      break;
    case 'appointment_time':
      await handleAppointmentTime(client, conv, message, clientMessages, appointmentSettings, accessToken, features);
      break;
    case 'ai_conversation':
      await handleAIConversation(client, conv, message, features, accessToken);
      break;
    case 'completed':
      conv.state = 'chat';
      await handleChat(client, conv, message, clientMessages, features, accessToken);
      break;
    case 'chat':
      await handleChat(client, conv, message, clientMessages, features, accessToken);
      break;
  }

  await saveConversation(conv);
}
