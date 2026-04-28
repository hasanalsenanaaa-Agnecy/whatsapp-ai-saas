import postgres from 'postgres';
import { DEFAULT_FEATURES, type ClientConfig, type ClientFeatures, type ClientSettings, type KnowledgeItem, type ClientQuestion } from '../types/client.js';
import { decryptSettings } from '../utils/crypto.js';

export type { ClientConfig } from '../types/client.js';

// ============================================================
// DATABASE SERVICE
// Core database operations + features + appointments
// ============================================================

let sql: ReturnType<typeof postgres>;

export { sql };

export async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
  sql = postgres(dbUrl, {
    ssl: 'require',
    max: 10,           // connection pool size
    idle_timeout: 30,  // close idle connections after 30s
    connect_timeout: 10 // fail fast if DB unreachable
  });
  // Verify connection at startup rather than on first query
  await sql`SELECT 1`;
  console.log('✅ Database connected');
}

// ============================================================
// HELPERS
// ============================================================

function parseJSON(value: any, fallback: any) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function getDefaultFeatures(): ClientFeatures {
  return { ...DEFAULT_FEATURES };
}

// Single place that maps a raw DB client row → typed client object.
// All three client lookup functions use this.
function parseClientRow(row: any): ClientConfig {
  return {
    id: row.id,
    phone_number_id: row.phone_number_id,
    name: row.name || '',
    industry: row.industry || 'generic',
    active: row.active ?? true,
    access_token: row.access_token || '',
    verify_token: row.verify_token,
    features: parseJSON(row.features, getDefaultFeatures()) as ClientFeatures,
    settings: decryptSettings(parseJSON(row.settings, {})) as ClientSettings,
    knowledge_base: parseJSON(row.knowledge_base, []) as KnowledgeItem[],
    questions: parseJSON(row.questions, []) as ClientQuestion[],
    agent_phones: row.agent_phones || [],
  };
}

// ============================================================
// CLIENT FUNCTIONS
// ============================================================

export async function getClientByPhoneNumberId(phoneNumberId: string): Promise<ClientConfig | null> {
  try {
    const rows = await sql`SELECT * FROM clients WHERE phone_number_id = ${phoneNumberId} AND active = true LIMIT 1`;
    return rows[0] ? parseClientRow(rows[0]) : null;
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

export async function getClientByShopifyDomain(domain: string): Promise<ClientConfig | null> {
  try {
    const rows = await sql`
      SELECT * FROM clients
      WHERE active = true
        AND (
          settings->>'shopify_domain' = ${domain}
          OR settings->'shopify'->>'domain' = ${domain}
        )
      LIMIT 1
    `;
    return rows[0] ? parseClientRow(rows[0]) : null;
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

export async function getClientById(clientId: string): Promise<ClientConfig | null> {
  try {
    const rows = await sql`SELECT * FROM clients WHERE id = ${clientId} AND active = true LIMIT 1`;
    return rows[0] ? parseClientRow(rows[0]) : null;
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

// ============================================================
// CONVERSATION FUNCTIONS
// ============================================================

export async function getConversation(clientId: string, phone: string) {
  try {
    const rows = await sql`SELECT * FROM conversations WHERE client_id = ${clientId} AND phone = ${phone} LIMIT 1`;
    if (!rows[0]) return null;
    return {
      clientId: rows[0].client_id,
      phone: rows[0].phone,
      messages: parseJSON(rows[0].messages, []),
      state: rows[0].state,
      step: rows[0].step || 0,
      data: parseJSON(rows[0].data, {}),
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at
    };
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

export async function saveConversation(conv: any) {
  try {
    const consentGiven = conv.data?._consentGiven || false;
    const consentAt = conv.data?._consentAt || null;
    // Upsert — eliminates the check-then-insert race condition
    await sql`
      INSERT INTO conversations (client_id, phone, messages, state, step, data, created_at, updated_at, consent_given, consent_at)
      VALUES (
        ${conv.clientId},
        ${conv.phone},
        ${JSON.stringify(conv.messages)},
        ${conv.state},
        ${conv.step},
        ${JSON.stringify(conv.data)},
        ${conv.createdAt || new Date().toISOString()},
        ${new Date().toISOString()},
        ${consentGiven},
        ${consentAt}
      )
      ON CONFLICT (client_id, phone) DO UPDATE SET
        messages     = EXCLUDED.messages,
        state        = EXCLUDED.state,
        step         = EXCLUDED.step,
        data         = EXCLUDED.data,
        updated_at   = EXCLUDED.updated_at,
        consent_given = COALESCE(EXCLUDED.consent_given, conversations.consent_given),
        consent_at    = COALESCE(EXCLUDED.consent_at, conversations.consent_at)
    `;
    return true;
  } catch (error) { console.error('❌ DB error:', error); return false; }
}

// ============================================================
// LEAD FUNCTIONS
// ============================================================

export async function createLead(lead: { clientId: string; phone: string; name: string; email: string; data: Record<string, any>; score: string }) {
  try {
    // Upsert — eliminates the check-then-insert race condition
    const rows = await sql`
      INSERT INTO leads (client_id, phone, name, email, data, score, created_at)
      VALUES (
        ${lead.clientId},
        ${lead.phone},
        ${lead.name},
        ${lead.email || ''},
        ${JSON.stringify(lead.data)},
        ${lead.score || 'new'},
        ${new Date().toISOString()}
      )
      ON CONFLICT (client_id, phone) DO UPDATE SET
        name       = EXCLUDED.name,
        data       = EXCLUDED.data,
        score      = EXCLUDED.score,
        updated_at = ${new Date().toISOString()}
      RETURNING id
    `;
    return rows[0]?.id || null;
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

// ============================================================
// APPOINTMENT FUNCTIONS
// ============================================================

export interface AppointmentRecord {
  id?: number;
  clientId: string;
  leadId?: number;
  phone: string;
  name: string;
  appointmentDate: string;
  appointmentTime?: string;
  timeSlot: string;
  timeLabel: string;
  appointmentType?: string;
  status: string;
  reminderSent: boolean;
  reminderAt?: Date;
  notes?: string;
}

export async function createAppointment(appointment: AppointmentRecord): Promise<number | null> {
  try {
    const rows = await sql`
      INSERT INTO appointments (
        client_id, lead_id, phone, name,
        appointment_date, appointment_time, time_slot, time_label,
        appointment_type, status, reminder_sent, reminder_at, notes, created_at
      ) VALUES (
        ${appointment.clientId},
        ${appointment.leadId || null},
        ${appointment.phone},
        ${appointment.name},
        ${appointment.appointmentDate},
        ${appointment.appointmentTime || null},
        ${appointment.timeSlot},
        ${appointment.timeLabel},
        ${appointment.appointmentType || null},
        ${appointment.status || 'pending'},
        ${appointment.reminderSent || false},
        ${appointment.reminderAt || null},
        ${appointment.notes || null},
        ${new Date().toISOString()}
      )
      RETURNING id
    `;
    return rows[0]?.id || null;
  } catch (error) {
    console.error('❌ DB error creating appointment:', error);
    return null;
  }
}

export async function getPendingReminders(): Promise<any[]> {
  try {
    const now = new Date().toISOString();
    const rows = await sql`
      SELECT
        a.*,
        c.phone_number_id,
        c.access_token,
        c.name as client_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      WHERE
        a.reminder_sent = false
        AND a.status = 'pending'
        AND a.reminder_at <= ${now}
        AND a.reminder_at IS NOT NULL
      ORDER BY a.reminder_at ASC
      LIMIT 50
    `;
    return rows;
  } catch (error) {
    console.error('❌ DB error getting reminders:', error);
    return [];
  }
}

export async function markReminderSent(appointmentId: number): Promise<boolean> {
  try {
    await sql`UPDATE appointments SET reminder_sent = true WHERE id = ${appointmentId}`;
    return true;
  } catch (error) {
    console.error('❌ DB error marking reminder sent:', error);
    return false;
  }
}

// ============================================================
// PDPL — RIGHT TO DELETION
// Deletes all personal data for a given phone number.
// ============================================================

export async function deleteCustomerData(phone: string): Promise<{
  conversations: number;
  leads: number;
  events: number;
  appointments: number;
}> {
  const result = { conversations: 0, leads: 0, events: 0, appointments: 0 };

  try {
    const convRows = await sql`DELETE FROM conversations WHERE phone = ${phone} RETURNING client_id`;
    result.conversations = convRows.length;
  } catch (error) { console.error('❌ Deletion error (conversations):', error); }

  try {
    const leadRows = await sql`DELETE FROM leads WHERE phone = ${phone} RETURNING id`;
    result.leads = leadRows.length;
  } catch (error) { console.error('❌ Deletion error (leads):', error); }

  try {
    const eventRows = await sql`DELETE FROM events WHERE phone = ${phone} RETURNING id`;
    result.events = eventRows.length;
  } catch (error) { console.error('❌ Deletion error (events):', error); }

  try {
    const apptRows = await sql`DELETE FROM appointments WHERE phone = ${phone} RETURNING id`;
    result.appointments = apptRows.length;
  } catch (error) { console.error('❌ Deletion error (appointments):', error); }

  console.log(`🗑️ PDPL deletion for ${phone}: ${JSON.stringify(result)}`);
  return result;
}

// ============================================================
// DASHBOARD — Auth, conversations, clients, alerts
// ============================================================

/**
 * Validate a dashboard key. Returns role + client info.
 * Owner: key matches ANALYTICS_KEY env var.
 * Client: key matches a client's dashboard_key column.
 */
export async function validateDashboardKey(key: string): Promise<{
  role: 'owner' | 'client';
  clientId?: string;
  clientName?: string;
} | null> {
  if (!key) return null;

  // Check owner key first
  if (key === process.env.ANALYTICS_KEY) {
    return { role: 'owner' };
  }

  // Check client dashboard keys
  try {
    const rows = await sql`
      SELECT id, name FROM clients
      WHERE dashboard_key = ${key} AND active = true
      LIMIT 1
    `;
    if (rows[0]) {
      return { role: 'client', clientId: rows[0].id, clientName: rows[0].name };
    }
  } catch (error) {
    console.error('❌ Dashboard auth error:', error);
  }

  return null;
}

/**
 * List conversations with pagination, filtering, and phone masking.
 */
export async function listConversations(opts: {
  clientId?: string;
  state?: string;
  page?: number;
  limit?: number;
}): Promise<{ conversations: any[]; total: number }> {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 20, 50);
  const offset = (page - 1) * limit;

  try {
    // Build conditions
    const conditions: any[] = [];
    if (opts.clientId) conditions.push(sql`c.client_id = ${opts.clientId}`);
    if (opts.state) conditions.push(sql`c.state = ${opts.state}`);

    const where = conditions.length > 0
      ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : sql``;

    const [rows, countRows] = await Promise.all([
      sql`
        SELECT
          c.client_id,
          cl.name AS client_name,
          c.phone,
          c.state,
          c.step,
          c.updated_at,
          c.created_at,
          jsonb_array_length(COALESCE(c.messages, '[]'::jsonb)) AS message_count,
          c.messages->-1->>'content' AS last_message
        FROM conversations c
        JOIN clients cl ON cl.id = c.client_id
        ${where}
        ORDER BY c.updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*) AS total
        FROM conversations c
        ${where}
      `,
    ]);

    return {
      conversations: rows.map(r => ({
        client_id: r.client_id,
        client_name: r.client_name,
        phone: r.phone,
        state: r.state,
        step: r.step,
        updated_at: r.updated_at,
        created_at: r.created_at,
        message_count: parseInt(r.message_count) || 0,
        last_message: r.last_message || null,
      })),
      total: parseInt(countRows[0]?.total) || 0,
    };
  } catch (error) {
    console.error('❌ listConversations error:', error);
    return { conversations: [], total: 0 };
  }
}

/**
 * Get full conversation detail (messages) for a specific phone + client.
 */
export async function getConversationDetail(clientId: string, phone: string): Promise<any | null> {
  try {
    const rows = await sql`
      SELECT
        c.*,
        cl.name AS client_name
      FROM conversations c
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.client_id = ${clientId} AND c.phone = ${phone}
      LIMIT 1
    `;
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      client_id: r.client_id,
      client_name: r.client_name,
      phone: r.phone,
      state: r.state,
      step: r.step,
      messages: parseJSON(r.messages, []),
      data: parseJSON(r.data, {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  } catch (error) {
    console.error('❌ getConversationDetail error:', error);
    return null;
  }
}

/**
 * List all active clients with summary stats (owner only).
 */
export async function listClients(): Promise<any[]> {
  try {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    const monthStart = thisMonth.toISOString();

    const rows = await sql`
      SELECT
        c.id,
        c.name,
        c.industry,
        c.active,
        c.phone_number_id,
        (SELECT COUNT(*) FROM events e WHERE e.client_id = c.id AND e.event_type = 'message_in' AND e.created_at >= ${monthStart}) AS monthly_messages,
        (SELECT COALESCE(SUM((e.data->>'total')::numeric), 0) FROM events e WHERE e.client_id = c.id AND e.event_type = 'payment_verified' AND e.created_at >= ${monthStart}) AS monthly_revenue
      FROM clients c
      WHERE c.active = true
      ORDER BY c.name
    `;

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      industry: r.industry,
      active: r.active,
      phone_number_id: r.phone_number_id,
      monthly_messages: parseInt(r.monthly_messages) || 0,
      monthly_revenue: parseFloat(r.monthly_revenue) || 0,
    }));
  } catch (error) {
    console.error('❌ listClients error:', error);
    return [];
  }
}

/**
 * Get recent error events for alert history.
 */
export async function listAlerts(opts: {
  clientId?: string;
  limit?: number;
}): Promise<any[]> {
  const limit = Math.min(opts.limit || 50, 100);

  try {
    const rows = opts.clientId
      ? await sql`
          SELECT e.id, e.client_id, c.name AS client_name, e.event_type, e.phone, e.data, e.created_at
          FROM events e
          JOIN clients c ON c.id = e.client_id
          WHERE e.event_type = 'error' AND e.client_id = ${opts.clientId}
          ORDER BY e.created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT e.id, e.client_id, c.name AS client_name, e.event_type, e.phone, e.data, e.created_at
          FROM events e
          JOIN clients c ON c.id = e.client_id
          WHERE e.event_type = 'error'
          ORDER BY e.created_at DESC
          LIMIT ${limit}
        `;

    return rows.map(r => ({
      id: r.id,
      client_id: r.client_id,
      client_name: r.client_name,
      event_type: r.event_type,
      data: parseJSON(r.data, {}),
      created_at: r.created_at,
    }));
  } catch (error) {
    console.error('❌ listAlerts error:', error);
    return [];
  }
}
