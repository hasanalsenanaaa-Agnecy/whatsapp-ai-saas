// ============================================================
// SHOPIFY AGENT — Shared types, constants, bilingual helper
// ============================================================

export interface ShopifyAgentConfig {
  domain: string;              // e.g. "hsespd-dv.myshopify.com"
  storefrontToken?: string;    // optional — tokenless works
  storeName: string;           // e.g. "ARAB | عرب"
  ownerPhone?: string;         // owner gets receipts
  currency?: string;           // auto-detected from products
}

export interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: string;
  step: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  productTitle: string;
  productId: string;
  variantId: string;
  variantTitle: string;
  price: string;
  quantity: number;
}

export interface ShopifyAdminOrder {
  order_number: number;
  financial_status: string;
  fulfillment_status: string | null;
  order_status_url?: string;
  line_items: { title: string; quantity: number }[];
  fulfillments: {
    tracking_number?: string;
    tracking_url?: string;
    shipment_status?: string;
  }[];
}

// Budget per 4h session. Counter lives on conv.data._aiAnswerCount and resets
// when the conversation timeout fires (see conversation.ts checkShouldReset).
// Target: 6 × 1,500 conversations/mo ≈ 9,000 AI messages, well under the 25k cap.
export const AI_QUESTION_BUDGET = 6;

/** Bilingual helper — returns Arabic or English based on lang */
export function msg(ar: string, en: string, lang?: string): string {
  return lang === 'en' ? en : ar;
}

/**
 * Strip WhatsApp markdown characters (* _ ~ `) from user-supplied strings
 * before wrapping them in bold/italic/etc. Without this, a store name like
 * "ARAB*" embedded inside `*${storeName}*` breaks formatting on the rest of
 * the message. Safe to call on any text; preserves all other characters.
 */
export function wa(s: string | undefined): string {
  return (s || '').replace(/[*_~`]/g, '');
}
