import postgres from 'postgres';
import { DEFAULT_FEATURES, type ClientConfig, type ClientFeatures, type ClientSettings, type KnowledgeItem, type ClientQuestion } from '../types/client.js';

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

export function getDefaultFeatures(): ClientFeatures {
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
    settings: parseJSON(row.settings, {}) as ClientSettings,
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
    // Upsert — eliminates the check-then-insert race condition
    await sql`
      INSERT INTO conversations (client_id, phone, messages, state, step, data, created_at, updated_at)
      VALUES (
        ${conv.clientId},
        ${conv.phone},
        ${JSON.stringify(conv.messages)},
        ${conv.state},
        ${conv.step},
        ${JSON.stringify(conv.data)},
        ${conv.createdAt || new Date().toISOString()},
        ${new Date().toISOString()}
      )
      ON CONFLICT (client_id, phone) DO UPDATE SET
        messages   = EXCLUDED.messages,
        state      = EXCLUDED.state,
        step       = EXCLUDED.step,
        data       = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at
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

export async function updateAppointmentStatus(appointmentId: number, status: string): Promise<boolean> {
  try {
    await sql`UPDATE appointments SET status = ${status} WHERE id = ${appointmentId}`;
    return true;
  } catch (error) {
    console.error('❌ DB error updating appointment status:', error);
    return false;
  }
}
