// ============================================================
// CONVERSATION ROUTER
// Thin state machine router — reads industry/config, delegates to flows.
// ============================================================

import { getConversation, saveConversation, getClientByPhoneNumberId } from './services/database.js';
import { getDefaultMessages, type ClientMessages } from './messages.js';
import { DEFAULT_APPOINTMENT_SETTINGS, type AppointmentSettings } from './services/appointments.js';

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
  detectHandoverIntent,
  isAIConversationAvailable,
  type ConversationState,
  type ClientFeatures
} from './flows/common.js';

const CONVERSATION_TIMEOUT_HOURS = 24;

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

  if (!conv || checkShouldReset(conv, message)) {
    conv = {
      clientId: client.id,
      phone: customerPhone,
      messages: [],
      state: 'welcome',
      step: 0,
      data: { whatsappPhone: customerPhone },
      createdAt: now,
      updatedAt: now
    };
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
      conv.state = backResult.newState as any;
      conv.step = backResult.newStep;
    }
  }

  // ============================================================
  // HANDOVER DETECTION (works in any state when enabled)
  // ============================================================
  if (features.handover_detection && detectHandoverIntent(message)) {
    await handleHandoverRequest(client, conv, message, clientMessages, accessToken);
    await saveConversation(conv);
    return;
  }

  // ============================================================
  // ROUTE TO FLOW
  // ============================================================

  // ECOMMERCE — Shopify Agent mode
  const hasShopifyConfig = client.settings?.shopify_domain || client.settings?.shopify?.domain;
  if (hasShopifyConfig && (conv.state === 'welcome' || conv.state === 'shopify_agent')) {
    conv.state = 'shopify_agent';
    await handleShopifyAgent(client, conv, message, accessToken);
    await saveConversation(conv);
    return;
  }

  // AI CONVERSATION MODE — skips rigid flow entirely
  if (features.ai_conversation && isAIConversationAvailable()) {
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

// ============================================================
// ROUTER HELPERS
// ============================================================

function checkShouldReset(conv: ConversationState, message: string): boolean {
  const lastUpdate = new Date(conv.updatedAt);
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate > CONVERSATION_TIMEOUT_HOURS) return true;

  const restartKeywords = ['restart', 'start over', 'من جديد', 'ابدا من جديد', 'reset', 'بداية'];
  return restartKeywords.some(keyword => message.toLowerCase().includes(keyword));
}

function handleBackCommand(message: string, conv: ConversationState): { handled: boolean; newState: string; newStep: number } {
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
