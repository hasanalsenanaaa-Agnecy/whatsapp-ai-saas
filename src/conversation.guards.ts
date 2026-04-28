// ============================================================
// CONVERSATION ROUTER GUARDS
//
// Pure predicates used by conversation.ts to decide which flow
// owns the next turn. Each guard is a single named function so
// routing decisions read declaratively at the call site and
// each branch can be unit-tested in isolation.
// ============================================================

import { detectHandoverIntent, isAIConversationAvailable, type ConversationState, type ClientFeatures } from './flows/common.js';
import type { ClientConfig } from './types/client.js';
import type { ConvStateName } from './types/conversation.js';

const CONVERSATION_TIMEOUT_HOURS = 4;
const RESTART_KEYWORDS = ['restart', 'start over', 'من جديد', 'ابدا من جديد', 'reset', 'بداية'];
const BACK_KEYWORDS = ['back', 'رجوع', 'السابق', 'ارجع', 'previous'];

// ============================================================
// CLIENT-LEVEL GUARDS
// ============================================================

export function isShopifyClient(client: ClientConfig): boolean {
  return !!(client.settings?.shopify_domain || client.settings?.shopify?.domain);
}

export function isAIConversationMode(features: ClientFeatures): boolean {
  return !!features.ai_conversation && isAIConversationAvailable();
}

export function shouldHandover(features: ClientFeatures, message: string): boolean {
  return !!features.handover_detection && detectHandoverIntent(message);
}

// ============================================================
// CONVERSATION-LEVEL GUARDS
// ============================================================

export function shouldReset(conv: ConversationState, message: string): boolean {
  if (RESTART_KEYWORDS.some(kw => message.toLowerCase().includes(kw))) return true;

  const lastUpdate = new Date(conv.updatedAt);
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);

  // Extended window when the customer has unfinished business: a populated cart
  // or a pending payment. Wiping after 4h loses their cart + language + consent.
  const hasCart = Array.isArray((conv.data as any)?._cart) && (conv.data as any)._cart.length > 0;
  const shopifyState = (conv.data as any)?._shopifyState;
  const inPaymentFlow = shopifyState === 'awaiting_payment' || shopifyState === 'order_complete';
  const effectiveTimeout = (hasCart || inPaymentFlow) ? 48 : CONVERSATION_TIMEOUT_HOURS;

  return hoursSinceUpdate > effectiveTimeout;
}

export interface BackResult {
  handled: boolean;
  newState: ConvStateName;
  newStep: number;
}

export function handleBackCommand(message: string, conv: ConversationState): BackResult {
  if (!BACK_KEYWORDS.some(kw => message.toLowerCase().includes(kw))) {
    return { handled: false, newState: conv.state, newStep: conv.step };
  }

  if (conv.state === 'questions' && conv.step > 0) {
    return { handled: true, newState: 'questions', newStep: conv.step - 1 };
  }
  if (conv.state === 'questions' && conv.step === 0) {
    return { handled: true, newState: 'welcome', newStep: 0 };
  }
  if (conv.state === 'appointment_date') {
    return { handled: true, newState: 'questions', newStep: conv.step };
  }
  if (conv.state === 'appointment_time') {
    return { handled: true, newState: 'appointment_date', newStep: 0 };
  }
  return { handled: false, newState: conv.state, newStep: conv.step };
}
