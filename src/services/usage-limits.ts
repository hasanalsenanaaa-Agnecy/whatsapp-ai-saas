// ============================================================
// MONTHLY USAGE LIMITS
//
// Tracks conversations + AI messages per client per calendar
// month against configured caps. Sends a single 80% warning
// per month to client.agent_phones[0], and logs overages so
// they can be billed.
//
// Usage count sources (events table):
//   - conversations = count of conversation_start events this month
//     (a "conversation" = one 4h session per customer, per the contract)
//   - ai_messages   = count of ai_call events this month
//   - whatsapp_outbound = count of message_out events this month
//
// Cap source: client.settings.usage_caps (falls back to
// DEFAULT_CAPS below).
//
// Called from the webhook handler on every inbound message.
// Cheap: one SQL query, cached in memory for 5 min per client.
// ============================================================

import { sql } from './database.js';
import { sendWhatsAppMessage } from './whatsapp.js';
import type { ClientConfig } from '../types/client.js';

// Contract-default caps (Arab Dates tier). Override per-client
// via settings.usage_caps.
export const DEFAULT_CAPS = {
  conversations: 1500,
  ai_messages: 25000,
  whatsapp_outbound: 5000,
};

// Overage pricing (SAR, pre-VAT) — matches the contract.
const OVERAGE_PRICING = {
  per_500_conversations: 50,
  per_5000_ai_messages: 75,
};

const WARN_THRESHOLD = 0.8; // 80%

// ============================================================
// USAGE READ (with 5-min memory cache to avoid hammering DB)
// ============================================================

interface UsageSnapshot {
  conversations: number;
  ai_messages: number;
  whatsapp_outbound: number;
  fetched_at: number;
}

const usageCache = new Map<string, UsageSnapshot>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getMonthlyUsage(clientId: string): Promise<UsageSnapshot> {
  const cached = usageCache.get(clientId);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return cached;
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartISO = monthStart.toISOString();

  try {
    const [conv, ai, out] = await Promise.all([
      sql`
        SELECT COUNT(*) AS count
        FROM events
        WHERE client_id = ${clientId}
          AND event_type = 'conversation_start'
          AND created_at >= ${monthStartISO}
      `,
      sql`
        SELECT COUNT(*) AS count
        FROM events
        WHERE client_id = ${clientId}
          AND event_type = 'ai_call'
          AND created_at >= ${monthStartISO}
      `,
      sql`
        SELECT COUNT(*) AS count
        FROM events
        WHERE client_id = ${clientId}
          AND event_type = 'message_out'
          AND created_at >= ${monthStartISO}
      `,
    ]);

    const snapshot: UsageSnapshot = {
      conversations: parseInt(conv[0]?.count || '0'),
      ai_messages: parseInt(ai[0]?.count || '0'),
      whatsapp_outbound: parseInt(out[0]?.count || '0'),
      fetched_at: Date.now(),
    };
    usageCache.set(clientId, snapshot);
    return snapshot;
  } catch (error) {
    console.error('❌ getMonthlyUsage error:', error);
    return { conversations: 0, ai_messages: 0, whatsapp_outbound: 0, fetched_at: Date.now() };
  }
}

// ============================================================
// CAPS
// ============================================================

export function getCapsForClient(client: ClientConfig): typeof DEFAULT_CAPS {
  return {
    conversations: client.settings?.usage_caps?.conversations ?? DEFAULT_CAPS.conversations,
    ai_messages: client.settings?.usage_caps?.ai_messages ?? DEFAULT_CAPS.ai_messages,
    whatsapp_outbound: client.settings?.usage_caps?.whatsapp_outbound ?? DEFAULT_CAPS.whatsapp_outbound,
  };
}

// ============================================================
// OVERAGE CALC (for billing)
// ============================================================

export function calculateOverageCharges(
  usage: UsageSnapshot,
  caps: typeof DEFAULT_CAPS
): { conversations_overage: number; ai_overage: number; total_sar: number } {
  const convOver = Math.max(0, usage.conversations - caps.conversations);
  const aiOver = Math.max(0, usage.ai_messages - caps.ai_messages);

  // Round up to the next 500 / 5000 block, per contract
  const convBlocks = Math.ceil(convOver / 500);
  const aiBlocks = Math.ceil(aiOver / 5000);

  const total =
    convBlocks * OVERAGE_PRICING.per_500_conversations +
    aiBlocks * OVERAGE_PRICING.per_5000_ai_messages;

  return {
    conversations_overage: convOver,
    ai_overage: aiOver,
    total_sar: total,
  };
}

// ============================================================
// 80% WARNING — sent once per client per calendar month
// ============================================================

async function hasWarnedThisMonth(clientId: string, metric: string): Promise<boolean> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  try {
    const rows = await sql`
      SELECT 1 FROM events
      WHERE client_id = ${clientId}
        AND event_type = 'usage_warning'
        AND data->>'metric' = ${metric}
        AND created_at >= ${monthStart.toISOString()}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markWarned(clientId: string, metric: string, usage: number, cap: number): Promise<void> {
  try {
    await sql`
      INSERT INTO events (client_id, event_type, phone, data, created_at)
      VALUES (
        ${clientId},
        'usage_warning',
        '',
        ${JSON.stringify({ metric, usage, cap, threshold: WARN_THRESHOLD })},
        NOW()
      )
    `;
  } catch (error) {
    console.error('❌ markWarned error:', error);
  }
}

async function logOverage(clientId: string, metric: string, usage: number, cap: number): Promise<void> {
  try {
    await sql`
      INSERT INTO events (client_id, event_type, phone, data, created_at)
      VALUES (
        ${clientId},
        'usage_overage',
        '',
        ${JSON.stringify({ metric, usage, cap, overage: usage - cap })},
        NOW()
      )
    `;
  } catch (error) {
    console.error('❌ logOverage error:', error);
  }
}

// ============================================================
// CHECK CAPS — call from webhook after saving each inbound msg
// ============================================================

/**
 * Returns true if usage is still within caps, false if any cap is exceeded.
 * Side effects:
 *   - Sends 80% warning to client's agent_phones[0] (once per month per metric)
 *   - Logs usage_overage event when a cap is crossed (once per month per metric)
 * Never blocks traffic — the bot keeps working even over-cap. This is a
 * business/billing signal, not a hard gate.
 */
export async function checkUsageCaps(client: ClientConfig): Promise<{
  withinCaps: boolean;
  usage: UsageSnapshot;
  caps: typeof DEFAULT_CAPS;
}> {
  const usage = await getMonthlyUsage(client.id);
  const caps = getCapsForClient(client);

  const convRatio = caps.conversations > 0 ? usage.conversations / caps.conversations : 0;
  const aiRatio = caps.ai_messages > 0 ? usage.ai_messages / caps.ai_messages : 0;

  const agentPhone = client.agent_phones?.[0];

  // 80% warnings
  if (agentPhone && client.access_token && client.phone_number_id) {
    if (convRatio >= WARN_THRESHOLD && convRatio < 1 && !(await hasWarnedThisMonth(client.id, 'conversations'))) {
      await sendWarning(client, agentPhone, 'conversations', usage.conversations, caps.conversations);
      await markWarned(client.id, 'conversations', usage.conversations, caps.conversations);
    }
    if (aiRatio >= WARN_THRESHOLD && aiRatio < 1 && !(await hasWarnedThisMonth(client.id, 'ai_messages'))) {
      await sendWarning(client, agentPhone, 'ai_messages', usage.ai_messages, caps.ai_messages);
      await markWarned(client.id, 'ai_messages', usage.ai_messages, caps.ai_messages);
    }
  }

  // Overage logs
  if (usage.conversations > caps.conversations && !(await hasWarnedThisMonth(client.id, 'conversations_overage'))) {
    await logOverage(client.id, 'conversations', usage.conversations, caps.conversations);
    await markWarned(client.id, 'conversations_overage', usage.conversations, caps.conversations);
  }
  if (usage.ai_messages > caps.ai_messages && !(await hasWarnedThisMonth(client.id, 'ai_messages_overage'))) {
    await logOverage(client.id, 'ai_messages', usage.ai_messages, caps.ai_messages);
    await markWarned(client.id, 'ai_messages_overage', usage.ai_messages, caps.ai_messages);
  }

  return {
    withinCaps: usage.conversations <= caps.conversations && usage.ai_messages <= caps.ai_messages,
    usage,
    caps,
  };
}

async function sendWarning(
  client: ClientConfig,
  agentPhone: string,
  metric: 'conversations' | 'ai_messages',
  usage: number,
  cap: number
): Promise<void> {
  const label = metric === 'conversations' ? 'المحادثات' : 'رسائل الذكاء الاصطناعي';
  const percent = Math.round((usage / cap) * 100);
  const body = [
    `🟡 *تنبيه استخدام — ${client.name}*`,
    ``,
    `بلغت ${label} هذا الشهر: *${usage.toLocaleString('ar-SA')}* من أصل *${cap.toLocaleString('ar-SA')}* (${percent}%)`,
    ``,
    `ستستمر الخدمة بدون انقطاع، وأي تجاوز يُحتسب في فاتورة الشهر القادم وفق العقد.`,
  ].join('\n');

  try {
    await sendWhatsAppMessage(agentPhone, body, client.access_token, client.phone_number_id);
  } catch (error) {
    console.error('❌ sendWarning error:', error);
  }
}
