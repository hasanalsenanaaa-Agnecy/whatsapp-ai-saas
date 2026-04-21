// ============================================================
// ALERTING SERVICE
//
// Two alert channels:
// 1. Owner alerts — platform-level issues (error spikes, system health)
//    Sent to OWNER_PHONE via WhatsApp.
// 2. Client alerts — per-client service issues (Shopify down, AI failing)
//    Sent to client.agent_phones[0] via their own WhatsApp credentials.
//
// Error spike detection: tracks errors per 5-min window.
// Cooldowns prevent alert floods.
// ============================================================

import { maskPhone } from '../utils/buttons.js';
import { sql } from './database.js';
import type { ClientConfig } from '../types/client.js';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

// ============================================================
// ERROR SPIKE DETECTION
// ============================================================

const ERROR_WINDOW_MS = 5 * 60 * 1000;    // 5-minute window
const ERROR_SPIKE_THRESHOLD = 10;          // 10 errors in window = spike
const errorTimestamps: number[] = [];
let lastSpikeAlertTime = 0;

// Per-client error tracking
const clientErrors = new Map<string, number[]>();
const CLIENT_ERROR_THRESHOLD = 5;          // 5 errors in 5 min = client alert
const clientAlertCooldowns = new Map<string, number>();
const CLIENT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown per client

/**
 * Track an error and check for spikes.
 * Call this from every catch block that matters.
 */
export function trackError(clientId?: string): void {
  const now = Date.now();
  errorTimestamps.push(now);

  // Prune old timestamps
  while (errorTimestamps.length > 0 && errorTimestamps[0]! < now - ERROR_WINDOW_MS) {
    errorTimestamps.shift();
  }

  // Check for system-wide spike
  if (errorTimestamps.length >= ERROR_SPIKE_THRESHOLD && now - lastSpikeAlertTime > ERROR_WINDOW_MS) {
    lastSpikeAlertTime = now;
    sendOwnerAlert(
      'error',
      `Error spike detected: ${errorTimestamps.length} errors in the last 5 minutes`,
      'Check server logs for details. This may indicate a systemic issue.'
    ).catch(() => {});
  }

  // Track per-client errors
  if (clientId) {
    if (!clientErrors.has(clientId)) clientErrors.set(clientId, []);
    const timestamps = clientErrors.get(clientId)!;
    timestamps.push(now);
    // Prune old
    while (timestamps.length > 0 && timestamps[0]! < now - ERROR_WINDOW_MS) {
      timestamps.shift();
    }
  }
}

/**
 * Get current error count in the active window.
 */
export function getErrorCount(): number {
  const cutoff = Date.now() - ERROR_WINDOW_MS;
  while (errorTimestamps.length > 0 && errorTimestamps[0]! < cutoff) {
    errorTimestamps.shift();
  }
  return errorTimestamps.length;
}

// ============================================================
// OWNER ALERTS (platform-level)
// ============================================================

let ownerCooldownUntil = 0;
let suppressedCount = 0;
const OWNER_COOLDOWN_MS = 5 * 60 * 1000;

export async function sendOwnerAlert(
  type: 'error' | 'warning' | 'info',
  message: string,
  details?: string
): Promise<boolean> {
  const ownerPhone = process.env.OWNER_PHONE;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!ownerPhone || !phoneNumberId || !accessToken) {
    console.log('Owner alert not sent — OWNER_PHONE not configured');
    return false;
  }

  const now = Date.now();
  if (type !== 'info' && now < ownerCooldownUntil) {
    suppressedCount++;
    return false;
  }

  const emoji = type === 'error' ? '🔴' : type === 'warning' ? '🟡' : '🟢';
  const timestamp = new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' });

  let body = `${emoji} *Platform Alert*\n\nType: ${type.toUpperCase()}\nTime: ${timestamp}\n\n${message}`;
  if (details) body += `\n\n${details.substring(0, 500)}`;
  if (suppressedCount > 0) body += `\n\n_(${suppressedCount} alerts suppressed since last notification)_`;

  const sent = await sendWhatsApp(phoneNumberId, accessToken, ownerPhone, body);
  if (sent) {
    ownerCooldownUntil = now + OWNER_COOLDOWN_MS;
    suppressedCount = 0;
  }
  return sent;
}

// Backward-compatible aliases
export const sendAlert = sendOwnerAlert;

export async function alertError(error: Error | string, context?: string): Promise<void> {
  trackError();
  const message = context || 'An error occurred';
  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await sendOwnerAlert('error', message, details);
}

// ============================================================
// CLIENT ALERTS (per-tenant service issues)
// ============================================================

/**
 * Alert a specific client when their service has an issue.
 * Uses their own WhatsApp credentials to send to their agent phone.
 * 30-min cooldown per client to prevent floods.
 */
export async function alertClient(
  client: ClientConfig,
  message: string,
  details?: string
): Promise<boolean> {
  const agentPhone = client.agent_phones?.[0];
  if (!agentPhone || !client.access_token || !client.phone_number_id) {
    return false;
  }

  // Check cooldown
  const now = Date.now();
  const lastAlert = clientAlertCooldowns.get(client.id) || 0;
  if (now - lastAlert < CLIENT_COOLDOWN_MS) {
    return false;
  }

  // Check if enough errors accumulated for this client
  const timestamps = clientErrors.get(client.id) || [];
  if (timestamps.length < CLIENT_ERROR_THRESHOLD) {
    return false; // Not enough errors yet — don't bother the client
  }

  const timestamp = new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' });

  let body = `🔔 *تنبيه من النظام / System Alert*\n\nالوقت: ${timestamp}\n\n${message}`;
  if (details) body += `\n\n${details.substring(0, 300)}`;

  const sent = await sendWhatsApp(client.phone_number_id, client.access_token, agentPhone, body);
  if (sent) {
    clientAlertCooldowns.set(client.id, now);
    // Reset error count after alerting
    clientErrors.set(client.id, []);
  }
  return sent;
}

/**
 * Track an error for a specific client and alert if threshold reached.
 * Call from any client-facing error path.
 */
export async function trackClientError(
  client: ClientConfig,
  service: string,
  error: Error | string
): Promise<void> {
  trackError(client.id);

  // Check if we should alert this client
  const timestamps = clientErrors.get(client.id) || [];
  if (timestamps.length >= CLIENT_ERROR_THRESHOLD) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await alertClient(
      client,
      `واجهنا مشكلة في خدمة *${service}*\nWe encountered an issue with *${service}*`,
      `${errorMsg.substring(0, 200)}\n\nفريقنا التقني على علم ويعمل على الحل.\nOur technical team is aware and working on it.`
    );
  }
}

// ============================================================
// PER-CLIENT DAILY SUMMARY
// Sends a summary of yesterday's activity to the client's
// agent_phones[0] using their own WhatsApp credentials.
// ============================================================

export async function sendClientDailySummary(client: ClientConfig): Promise<boolean> {
  const agentPhone = client.agent_phones?.[0];
  if (!agentPhone || !client.access_token || !client.phone_number_id) {
    return false;
  }
  if (!sql) return false;

  try {
    // Yesterday 00:00 → today 00:00 in Riyadh time
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const [messages, checkouts, payments, aiCalls, uniqueCustomers] = await Promise.all([
      sql`SELECT COUNT(*) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'message_in' AND created_at >= ${yesterdayStart.toISOString()} AND created_at < ${todayStart.toISOString()}`,
      sql`SELECT COUNT(*) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'checkout_created' AND created_at >= ${yesterdayStart.toISOString()} AND created_at < ${todayStart.toISOString()}`,
      sql`SELECT COUNT(*) AS count, COALESCE(SUM((data->>'total')::numeric), 0) AS revenue FROM events WHERE client_id = ${client.id} AND event_type = 'payment_verified' AND created_at >= ${yesterdayStart.toISOString()} AND created_at < ${todayStart.toISOString()}`,
      sql`SELECT COUNT(*) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'ai_call' AND created_at >= ${yesterdayStart.toISOString()} AND created_at < ${todayStart.toISOString()}`,
      sql`SELECT COUNT(DISTINCT phone) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'message_in' AND created_at >= ${yesterdayStart.toISOString()} AND created_at < ${todayStart.toISOString()}`,
    ]);

    const msgCount = parseInt(messages[0]?.count || '0');
    const checkoutCount = parseInt(checkouts[0]?.count || '0');
    const paymentCount = parseInt(payments[0]?.count || '0');
    const revenue = parseFloat(payments[0]?.revenue || '0').toFixed(2);
    const aiCount = parseInt(aiCalls[0]?.count || '0');
    const uniqueCount = parseInt(uniqueCustomers[0]?.count || '0');

    const dateLabel = yesterdayStart.toLocaleDateString('ar-SA', {
      timeZone: 'Asia/Riyadh',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const body = [
      `📊 *تقرير ${client.name} اليومي*`,
      `${dateLabel}`,
      ``,
      `👥 عملاء جدد: ${uniqueCount}`,
      `💬 رسائل مستلمة: ${msgCount}`,
      `🛒 طلبات بدأت: ${checkoutCount}`,
      `✅ طلبات مدفوعة: ${paymentCount}`,
      `💰 المبيعات: ${revenue}`,
      `🤖 ردود AI: ${aiCount}`,
    ].join('\n');

    return await sendWhatsApp(client.phone_number_id, client.access_token, agentPhone, body);
  } catch (error) {
    console.error(`❌ Client daily summary error for ${client.id}:`, error);
    return false;
  }
}

export async function sendAllClientDailySummaries(): Promise<{ sent: number; failed: number }> {
  if (!sql) return { sent: 0, failed: 0 };

  try {
    const rows = await sql`SELECT * FROM clients WHERE active = true`;
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      // Minimal parse — we only need the fields sendClientDailySummary uses.
      const client = {
        id: row.id,
        name: row.name || '',
        phone_number_id: row.phone_number_id,
        access_token: row.access_token || '',
        agent_phones: row.agent_phones || [],
      } as ClientConfig;

      const ok = await sendClientDailySummary(client);
      if (ok) sent++;
      else failed++;
    }

    return { sent, failed };
  } catch (error) {
    console.error('❌ sendAllClientDailySummaries error:', error);
    return { sent: 0, failed: 0 };
  }
}

// ============================================================
// PER-CLIENT MONTHLY SUMMARY
// Sends a full performance report of the previous calendar
// month to the client. Run from /cron/monthly-summary on the
// 1st of each month.
// ============================================================

export async function sendClientMonthlySummary(client: ClientConfig): Promise<boolean> {
  const agentPhone = client.agent_phones?.[0];
  if (!agentPhone || !client.access_token || !client.phone_number_id) {
    return false;
  }
  if (!sql) return false;

  try {
    // Previous calendar month: [firstOfLastMonth, firstOfThisMonth)
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [messages, customers, checkouts, payments, aiCalls] = await Promise.all([
      sql`SELECT COUNT(*) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'message_in' AND created_at >= ${lastMonthStart.toISOString()} AND created_at < ${thisMonthStart.toISOString()}`,
      sql`SELECT COUNT(DISTINCT phone) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'message_in' AND created_at >= ${lastMonthStart.toISOString()} AND created_at < ${thisMonthStart.toISOString()}`,
      sql`SELECT COUNT(*) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'checkout_created' AND created_at >= ${lastMonthStart.toISOString()} AND created_at < ${thisMonthStart.toISOString()}`,
      sql`SELECT COUNT(*) AS count, COALESCE(SUM((data->>'total')::numeric), 0) AS revenue FROM events WHERE client_id = ${client.id} AND event_type = 'payment_verified' AND created_at >= ${lastMonthStart.toISOString()} AND created_at < ${thisMonthStart.toISOString()}`,
      sql`SELECT COUNT(*) AS count FROM events WHERE client_id = ${client.id} AND event_type = 'ai_call' AND created_at >= ${lastMonthStart.toISOString()} AND created_at < ${thisMonthStart.toISOString()}`,
    ]);

    const msgCount = parseInt(messages[0]?.count || '0');
    const customerCount = parseInt(customers[0]?.count || '0');
    const checkoutCount = parseInt(checkouts[0]?.count || '0');
    const paymentCount = parseInt(payments[0]?.count || '0');
    const revenue = parseFloat(payments[0]?.revenue || '0');
    const aiCount = parseInt(aiCalls[0]?.count || '0');

    const conversionRate = customerCount > 0 ? ((paymentCount / customerCount) * 100).toFixed(1) : '0.0';
    const avgOrderValue = paymentCount > 0 ? (revenue / paymentCount).toFixed(2) : '0.00';

    const monthLabel = lastMonthStart.toLocaleDateString('ar-SA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: 'long',
    });

    const body = [
      `📈 *التقرير الشهري — ${client.name}*`,
      `${monthLabel}`,
      ``,
      `👥 عملاء فريدون: ${customerCount}`,
      `💬 رسائل مستلمة: ${msgCount}`,
      `🛒 طلبات بدأت: ${checkoutCount}`,
      `✅ طلبات مدفوعة: ${paymentCount}`,
      `💰 إجمالي المبيعات: ${revenue.toFixed(2)}`,
      `📊 متوسط قيمة الطلب: ${avgOrderValue}`,
      `🎯 معدل التحويل: ${conversionRate}%`,
      `🤖 ردود AI: ${aiCount}`,
      ``,
      `للتفاصيل الكاملة، راجع الداش بورد الخاص بك 📱`,
    ].join('\n');

    return await sendWhatsApp(client.phone_number_id, client.access_token, agentPhone, body);
  } catch (error) {
    console.error(`❌ Client monthly summary error for ${client.id}:`, error);
    return false;
  }
}

export async function sendAllClientMonthlySummaries(): Promise<{ sent: number; failed: number }> {
  if (!sql) return { sent: 0, failed: 0 };

  try {
    const rows = await sql`SELECT * FROM clients WHERE active = true`;
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const client = {
        id: row.id,
        name: row.name || '',
        phone_number_id: row.phone_number_id,
        access_token: row.access_token || '',
        agent_phones: row.agent_phones || [],
      } as ClientConfig;

      const ok = await sendClientMonthlySummary(client);
      if (ok) sent++;
      else failed++;
    }

    return { sent, failed };
  } catch (error) {
    console.error('❌ sendAllClientMonthlySummaries error:', error);
    return { sent: 0, failed: 0 };
  }
}

// ============================================================
// PLATFORM-WIDE DAILY SUMMARY (sent to owner)
// ============================================================

export async function sendDailySummary(): Promise<boolean> {
  if (!sql) return false;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Get today's stats
    const [messages, checkouts, payments, errors, aiCalls] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM events WHERE event_type = 'message_in' AND created_at >= ${todayISO}`,
      sql`SELECT COUNT(*) as count FROM events WHERE event_type = 'checkout_created' AND created_at >= ${todayISO}`,
      sql`SELECT COUNT(*) as count, COALESCE(SUM((data->>'total')::numeric), 0) as revenue FROM events WHERE event_type = 'payment_verified' AND created_at >= ${todayISO}`,
      sql`SELECT COUNT(*) as count FROM events WHERE event_type = 'error' AND created_at >= ${todayISO}`,
      sql`SELECT COUNT(*) as count FROM events WHERE event_type = 'ai_call' AND created_at >= ${todayISO}`,
    ]);

    const msgCount = messages[0]?.count || 0;
    const checkoutCount = checkouts[0]?.count || 0;
    const paymentCount = payments[0]?.count || 0;
    const revenue = parseFloat(payments[0]?.revenue || '0').toFixed(2);
    const errorCount = errors[0]?.count || 0;
    const aiCount = aiCalls[0]?.count || 0;

    const summary = [
      `📊 *Daily Summary*`,
      `${new Date().toLocaleDateString('en-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'full' })}`,
      ``,
      `💬 Messages: ${msgCount}`,
      `🛒 Checkouts: ${checkoutCount}`,
      `✅ Payments: ${paymentCount}`,
      `💰 Revenue: ${revenue}`,
      `🤖 AI calls: ${aiCount}`,
      `❌ Errors: ${errorCount}`,
    ].join('\n');

    return await sendOwnerAlert('info', summary);
  } catch (error) {
    console.error('❌ Daily summary error:', error);
    return false;
  }
}

// ============================================================
// HEALTH CHECK DATA
// ============================================================

export async function getHealthStatus(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  dbConnected: boolean;
  errorRate: number;
  details: string;
}> {
  const errorRate = getErrorCount();
  let dbConnected = false;

  if (sql) {
    try {
      await sql`SELECT 1`;
      dbConnected = true;
    } catch { /* DB down */ }
  }

  const status = !dbConnected ? 'unhealthy' : errorRate >= ERROR_SPIKE_THRESHOLD ? 'degraded' : 'healthy';
  const details = !dbConnected
    ? 'Database connection failed'
    : errorRate >= ERROR_SPIKE_THRESHOLD
      ? `Error spike: ${errorRate} errors in last 5 minutes`
      : 'All systems operational';

  return {
    status,
    uptime: process.uptime(),
    dbConnected,
    errorRate,
    details,
  };
}

// ============================================================
// LOW-LEVEL WHATSAPP SEND
// ============================================================

async function sendWhatsApp(phoneNumberId: string, accessToken: string, to: string, body: string): Promise<boolean> {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      })
    });

    if (!response.ok) {
      console.error('Alert send failed:', await response.text());
      return false;
    }

    console.log(`Alert sent to ${maskPhone(to)}`);
    return true;
  } catch (error) {
    console.error('Failed to send alert:', error);
    return false;
  }
}
