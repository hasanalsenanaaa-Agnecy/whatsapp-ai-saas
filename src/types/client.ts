// ============================================================
// CLIENT CONFIG CONTRACT
// Single typed interface for all tenant configuration.
// Every client is expressible as this object — no more guessing
// at key names or falling through to hardcoded defaults.
// ============================================================

// ── Feature flags ────────────────────────────────────────────

export interface ClientFeatures {
  ai_fallback: boolean;
  lead_scoring: boolean;
  handover_detection: boolean;
  appointment_setting: boolean;
  ai_conversation: boolean;
}

// ── Settings sub-objects ─────────────────────────────────────

export interface ShopifySettings {
  domain: string;
  storefrontToken?: string;
  adminToken?: string;
  webhookSecret?: string;
  webhook_secret?: string;  // legacy snake_case key
}

export interface BookingApiSettings {
  url: string;
  clinicId?: string;
  clinic_id?: string;  // legacy snake_case key
}

export interface AppointmentOverrides {
  timeSlots?: { id: string; label: string; start?: string; end?: string }[];
  daysAhead?: number;
  workDays?: number[];
  reminderMinutesBefore?: number;
}

export interface ClientSettings {
  // Shopify integration — flat keys kept for backward compat
  shopify_domain?: string;
  shopify_token?: string;
  shopify_admin_token?: string;
  shopify_webhook_secret?: string;
  // Nested Shopify (new format)
  shopify?: ShopifySettings;

  // Store settings
  currency?: string;

  // Google Sheets
  googleSheetId?: string;

  // Booking API
  booking_api?: BookingApiSettings;

  // Appointment overrides
  appointment?: AppointmentOverrides;

  // Custom messages
  welcome_message?: string;
  thank_you_message?: string;

  // Per-client AI system prompt (overrides default Gulf Arabic prompt)
  system_prompt?: string;

  // Assistant labels (for product categories)
  assistant_labels?: {
    best?: string;
    cheap?: string;
    type?: string;
  };

  // Monthly usage caps (enforced via usage-limits service)
  usage_caps?: {
    conversations?: number;    // unique customer sessions per calendar month
    ai_messages?: number;      // ai_call events per calendar month
    whatsapp_outbound?: number;// outbound messages per calendar month (not enforced, tracked only)
  };
}

// ── Knowledge base ───────────────────────────────────────────

export interface KnowledgeItem {
  category: string;
  question: string;
  answer: string;
}

// ── Question (lead qualification) ────────────────────────────
// Matches the Question interface in messages.ts

export interface ClientQuestion {
  text: string;
  field: string;
  options: string[];
}

// ── Main client config ───────────────────────────────────────

export interface ClientConfig {
  id: string;
  phone_number_id: string;
  name: string;
  industry: string;
  active: boolean;

  // Auth
  access_token: string;
  verify_token?: string;

  // Typed sub-objects
  features: ClientFeatures;
  settings: ClientSettings;
  knowledge_base: KnowledgeItem[];
  questions: ClientQuestion[];
  agent_phones: string[];
}

// ── Default features ─────────────────────────────────────────

export const DEFAULT_FEATURES: ClientFeatures = {
  ai_fallback: false,
  lead_scoring: false,
  handover_detection: false,
  appointment_setting: false,
  ai_conversation: false,
};
