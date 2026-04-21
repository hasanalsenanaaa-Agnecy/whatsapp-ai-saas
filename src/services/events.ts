// ============================================================
// EVENT LOGGING SERVICE
// Fire-and-forget analytics events. Never blocks the bot.
// Never throws — errors are silently logged to console.
// ============================================================

import { sql } from './database.js';

export type EventType =
  | 'message_in'
  | 'message_out'
  | 'conversation_start'
  | 'checkout_created'
  | 'payment_verified'
  | 'ai_call'
  | 'escalation'
  | 'lead_captured'
  | 'data_deletion_request'
  | 'error';

/**
 * Record an analytics event. Fire-and-forget — never awaited by callers,
 * never throws, never blocks the main flow.
 */
export function emitEvent(
  clientId: string,
  eventType: EventType,
  phone?: string,
  data?: Record<string, unknown>
): void {
  // Don't even try if DB isn't initialized
  if (!sql) return;

  sql`
    INSERT INTO events (client_id, event_type, phone, data)
    VALUES (${clientId}, ${eventType}, ${phone || null}, ${JSON.stringify(data || {})})
  `.catch(err => {
    // Swallow errors — analytics must never break the bot
    console.error('Event log error:', err?.message || err);
  });
}
