// ============================================================
// DATA RETENTION — PDPL Compliance
//
// Strategy: ANONYMIZE, don't delete.
// - Events: strip phone → keep forever (business analytics)
// - Conversations: strip phone + PII from data → keep message
//   patterns for software improvement
// - Leads: delete (pure PII, no business value once old)
// - Appointments: delete (pure PII)
//
// Called via cron (e.g. daily via QStash).
// ============================================================

import { sql } from '../services/database.js';

// Personal data retention: 24 months of inactivity
// After this, PII is stripped but business data is kept.
const RETENTION_MONTHS = 24;

interface RetentionResult {
  eventsAnonymized: number;
  conversationsAnonymized: number;
  deletionRequestsProcessed: number;
  leadsDeleted: number;
  appointmentsDeleted: number;
  errors: string[];
}

/**
 * Anonymize or delete personal data older than the retention period.
 * Keeps business-valuable data (analytics, conversation patterns).
 */
export async function processDataRetention(): Promise<RetentionResult> {
  const result: RetentionResult = {
    eventsAnonymized: 0,
    conversationsAnonymized: 0,
    deletionRequestsProcessed: 0,
    leadsDeleted: 0,
    appointmentsDeleted: 0,
    errors: [],
  };

  if (!sql) return result;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  const cutoffISO = cutoff.toISOString();

  console.log(`🗑️ Data retention: processing data older than ${cutoffISO}`);

  // 1. EVENTS — anonymize phone, keep everything else (revenue, funnels, AI cost)
  try {
    const rows = await sql`
      UPDATE events
      SET phone = 'anon'
      WHERE phone IS NOT NULL
        AND phone != 'anon'
        AND created_at < ${cutoffISO}
      RETURNING id
    `;
    result.eventsAnonymized = rows.length;
  } catch (error) {
    result.errors.push(`events: ${error}`);
    console.error('🗑️ Retention error (events):', error);
  }

  // 1b. EXPLICIT DELETION REQUESTS — customer asked to be forgotten via
  //     WhatsApp. PDPL requires honoring within 30 days; we process on the
  //     next cron run. Anonymize conversation + matching leads/appointments.
  try {
    const requested = await sql`
      SELECT client_id, phone
      FROM conversations
      WHERE data->>'_deletionRequestedAt' IS NOT NULL
        AND phone NOT LIKE 'anon-%'
    `;
    for (const row of requested) {
      const clientId = (row as any).client_id;
      const phone = (row as any).phone;
      await sql`
        UPDATE conversations
        SET
          phone = 'anon-' || LEFT(MD5(phone), 8),
          messages = '[]'::jsonb,
          data = jsonb_build_object('_anonymizedAt', ${new Date().toISOString()}, '_reason', 'customer_request')
        WHERE client_id = ${clientId} AND phone = ${phone}
      `;
      await sql`UPDATE events SET phone = 'anon' WHERE client_id = ${clientId} AND phone = ${phone}`;
      await sql`DELETE FROM leads WHERE client_id = ${clientId} AND phone = ${phone}`;
      await sql`DELETE FROM appointments WHERE client_id = ${clientId} AND phone = ${phone}`;
      result.deletionRequestsProcessed++;
    }
  } catch (error) {
    result.errors.push(`deletion_requests: ${error}`);
    console.error('🗑️ Retention error (deletion requests):', error);
  }

  // 2. CONVERSATIONS — anonymize phone + strip PII from data blob
  //    Keep: message count, state transitions, cart patterns, product interactions
  //    Remove: phone, name, checkout URLs, payment details
  try {
    const rows = await sql`
      UPDATE conversations
      SET
        phone = 'anon-' || LEFT(MD5(phone), 8),
        messages = '[]'::jsonb,
        data = jsonb_strip_nulls(jsonb_build_object(
          '_lang', data->>'_lang',
          '_intent', data->>'_intent',
          '_shopifyState', data->>'_shopifyState',
          '_consentGiven', data->>'_consentGiven',
          '_anonymizedAt', ${new Date().toISOString()}
        ))
      WHERE updated_at < ${cutoffISO}
        AND phone NOT LIKE 'anon-%'
      RETURNING client_id
    `;
    result.conversationsAnonymized = rows.length;
  } catch (error) {
    result.errors.push(`conversations: ${error}`);
    console.error('🗑️ Retention error (conversations):', error);
  }

  // 3. LEADS — delete (pure PII: name, email, phone, form answers)
  try {
    const rows = await sql`
      DELETE FROM leads
      WHERE created_at < ${cutoffISO}
      RETURNING id
    `;
    result.leadsDeleted = rows.length;
  } catch (error) {
    result.errors.push(`leads: ${error}`);
    console.error('🗑️ Retention error (leads):', error);
  }

  // 4. APPOINTMENTS — delete (PII: name, phone, date details)
  try {
    const rows = await sql`
      DELETE FROM appointments
      WHERE created_at < ${cutoffISO}
      RETURNING id
    `;
    result.appointmentsDeleted = rows.length;
  } catch (error) {
    result.errors.push(`appointments: ${error}`);
    console.error('🗑️ Retention error (appointments):', error);
  }

  console.log(`🗑️ Retention complete: ${result.eventsAnonymized} events anonymized, ${result.conversationsAnonymized} conversations anonymized, ${result.deletionRequestsProcessed} deletion requests processed, ${result.leadsDeleted} leads deleted, ${result.appointmentsDeleted} appointments deleted`);

  return result;
}

/**
 * HTTP handler for data retention cron endpoint.
 * Add route: fastify.post('/cron/data-retention', handleDataRetentionCron)
 */
export async function handleDataRetentionCron(request: any, reply: any): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== cronSecret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }

  try {
    const result = await processDataRetention();
    reply.send({ success: true, ...result });
  } catch (error) {
    console.error('❌ Data retention cron error:', error);
    reply.status(500).send({ success: false, error: String(error) });
  }
}
