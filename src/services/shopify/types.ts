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

export const AI_QUESTION_BUDGET = 2;

/** Bilingual helper — returns Arabic or English based on lang */
export function msg(ar: string, en: string, lang?: string): string {
  return lang === 'en' ? en : ar;
}
