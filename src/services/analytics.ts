// ============================================================
// ANALYTICS SERVICE
// Revenue attribution, conversion metrics, and usage stats
// powered by the events table.
// ============================================================

import { sql } from './database.js';

// ── Types ────────────────────────────────────────────────────

export interface RevenueRow {
  client_id: string;
  client_name: string;
  period: string;           // e.g. "2026-04"
  total_revenue: number;
  currency: string;
  order_count: number;
  unique_customers: number;
}

export interface ConversionFunnel {
  client_id: string;
  period: string;
  messages_in: number;
  checkouts_created: number;
  payments_verified: number;
  conversion_rate: number;  // payments / messages_in as percentage
}

export interface ClientUsageSummary {
  client_id: string;
  client_name: string;
  period: string;
  messages_in: number;
  ai_calls: number;
  escalations: number;
  checkouts: number;
  payments: number;
}

// ── Revenue attribution ──────────────────────────────────────

/**
 * Revenue per client per month.
 * Reads from payment_verified events which store { total, currency }.
 */
export async function getRevenueByClient(
  clientId?: string,
  months = 3
): Promise<RevenueRow[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const rows = clientId
    ? await sql`
        SELECT
          e.client_id,
          c.name AS client_name,
          TO_CHAR(e.created_at, 'YYYY-MM') AS period,
          SUM((e.data->>'total')::numeric) AS total_revenue,
          COALESCE(e.data->>'currency', 'KWD') AS currency,
          COUNT(*) AS order_count,
          COUNT(DISTINCT e.phone) AS unique_customers
        FROM events e
        JOIN clients c ON c.id = e.client_id
        WHERE e.event_type = 'payment_verified'
          AND e.client_id = ${clientId}
          AND e.created_at >= ${since.toISOString()}
        GROUP BY e.client_id, c.name, period, currency
        ORDER BY period DESC
      `
    : await sql`
        SELECT
          e.client_id,
          c.name AS client_name,
          TO_CHAR(e.created_at, 'YYYY-MM') AS period,
          SUM((e.data->>'total')::numeric) AS total_revenue,
          COALESCE(e.data->>'currency', 'KWD') AS currency,
          COUNT(*) AS order_count,
          COUNT(DISTINCT e.phone) AS unique_customers
        FROM events e
        JOIN clients c ON c.id = e.client_id
        WHERE e.event_type = 'payment_verified'
          AND e.created_at >= ${since.toISOString()}
        GROUP BY e.client_id, c.name, period, currency
        ORDER BY period DESC
      `;

  return rows.map(r => ({
    client_id: r.client_id,
    client_name: r.client_name,
    period: r.period,
    total_revenue: parseFloat(r.total_revenue) || 0,
    currency: r.currency,
    order_count: parseInt(r.order_count) || 0,
    unique_customers: parseInt(r.unique_customers) || 0,
  }));
}

// ── Conversion funnel ────────────────────────────────────────

/**
 * Messages → Checkouts → Payments per client per month.
 * Shows where customers drop off.
 */
export async function getConversionFunnel(
  clientId: string,
  months = 3
): Promise<ConversionFunnel[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const rows = await sql`
    SELECT
      client_id,
      TO_CHAR(created_at, 'YYYY-MM') AS period,
      COUNT(*) FILTER (WHERE event_type = 'message_in') AS messages_in,
      COUNT(*) FILTER (WHERE event_type = 'checkout_created') AS checkouts_created,
      COUNT(*) FILTER (WHERE event_type = 'payment_verified') AS payments_verified
    FROM events
    WHERE client_id = ${clientId}
      AND created_at >= ${since.toISOString()}
    GROUP BY client_id, period
    ORDER BY period DESC
  `;

  return rows.map(r => {
    const msgs = parseInt(r.messages_in) || 0;
    const payments = parseInt(r.payments_verified) || 0;
    return {
      client_id: r.client_id,
      period: r.period,
      messages_in: msgs,
      checkouts_created: parseInt(r.checkouts_created) || 0,
      payments_verified: payments,
      conversion_rate: msgs > 0 ? Math.round((payments / msgs) * 10000) / 100 : 0,
    };
  });
}

// ── Usage summary ────────────────────────────────────────────

/**
 * All-in-one usage stats per client per month.
 * Useful for a dashboard or monthly report.
 */
export async function getUsageSummary(
  clientId?: string,
  months = 3
): Promise<ClientUsageSummary[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const rows = clientId
    ? await sql`
        SELECT
          e.client_id,
          c.name AS client_name,
          TO_CHAR(e.created_at, 'YYYY-MM') AS period,
          COUNT(*) FILTER (WHERE e.event_type = 'message_in') AS messages_in,
          COUNT(*) FILTER (WHERE e.event_type = 'ai_call') AS ai_calls,
          COUNT(*) FILTER (WHERE e.event_type = 'escalation') AS escalations,
          COUNT(*) FILTER (WHERE e.event_type = 'checkout_created') AS checkouts,
          COUNT(*) FILTER (WHERE e.event_type = 'payment_verified') AS payments
        FROM events e
        JOIN clients c ON c.id = e.client_id
        WHERE e.client_id = ${clientId}
          AND e.created_at >= ${since.toISOString()}
        GROUP BY e.client_id, c.name, period
        ORDER BY period DESC
      `
    : await sql`
        SELECT
          e.client_id,
          c.name AS client_name,
          TO_CHAR(e.created_at, 'YYYY-MM') AS period,
          COUNT(*) FILTER (WHERE e.event_type = 'message_in') AS messages_in,
          COUNT(*) FILTER (WHERE e.event_type = 'ai_call') AS ai_calls,
          COUNT(*) FILTER (WHERE e.event_type = 'escalation') AS escalations,
          COUNT(*) FILTER (WHERE e.event_type = 'checkout_created') AS checkouts,
          COUNT(*) FILTER (WHERE e.event_type = 'payment_verified') AS payments
        FROM events e
        JOIN clients c ON c.id = e.client_id
        WHERE e.created_at >= ${since.toISOString()}
        GROUP BY e.client_id, c.name, period
        ORDER BY period DESC
      `;

  return rows.map(r => ({
    client_id: r.client_id,
    client_name: r.client_name,
    period: r.period,
    messages_in: parseInt(r.messages_in) || 0,
    ai_calls: parseInt(r.ai_calls) || 0,
    escalations: parseInt(r.escalations) || 0,
    checkouts: parseInt(r.checkouts) || 0,
    payments: parseInt(r.payments) || 0,
  }));
}
