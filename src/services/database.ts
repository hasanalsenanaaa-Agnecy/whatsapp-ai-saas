import postgres from 'postgres';

// ============================================================
// DATABASE SERVICE
// Core database operations + features + appointments
// ============================================================

let sql: ReturnType<typeof postgres>;

// Export sql for other services (knowledge.ts, appointments.ts)
export { sql };

export async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
  sql = postgres(dbUrl, { ssl: 'require' });
  console.log('✅ Database connected');
}

// ============================================================
// CLIENT FUNCTIONS
// ============================================================

export async function getClientByPhoneNumberId(phoneNumberId: string) {
  try {
    const rows = await sql`SELECT * FROM clients WHERE phone_number_id = ${phoneNumberId} AND active = true LIMIT 1`;
    if (!rows[0]) return null;
    
    const client = rows[0];
    // Parse JSONB fields
    return {
      ...client,
      features: parseJSON(client.features, getDefaultFeatures()),
      settings: parseJSON(client.settings, {}),
      knowledge_base: parseJSON(client.knowledge_base, []),
      questions: parseJSON(client.questions, []),
      agent_phones: client.agent_phones || []
    };
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

// Default features (all disabled - Basic tier)
export function getDefaultFeatures() {
  return {
    ai_fallback: false,
    lead_scoring: false,
    handover_detection: false,
    appointment_setting: false,
    ai_conversation: false
  };
}

// ============================================================
// CONVERSATION FUNCTIONS
// ============================================================

function parseJSON(value: any, fallback: any) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

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
    const existing = await sql`SELECT id FROM conversations WHERE client_id = ${conv.clientId} AND phone = ${conv.phone} LIMIT 1`;
    
    if (existing.length > 0) {
      await sql`
        UPDATE conversations SET 
          messages = ${JSON.stringify(conv.messages)},
          state = ${conv.state},
          step = ${conv.step},
          data = ${JSON.stringify(conv.data)},
          updated_at = ${new Date().toISOString()}
        WHERE client_id = ${conv.clientId} AND phone = ${conv.phone}
      `;
    } else {
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
      `;
    }
    return true;
  } catch (error) { console.error('❌ DB error:', error); return false; }
}

// ============================================================
// LEAD FUNCTIONS
// ============================================================

export async function createLead(lead: { clientId: string; phone: string; name: string; email: string; data: Record<string, any>; score: string }) {
  try {
    const existing = await sql`SELECT id FROM leads WHERE client_id = ${lead.clientId} AND phone = ${lead.phone} LIMIT 1`;
    
    if (existing.length > 0) {
      await sql`
        UPDATE leads SET 
          name = ${lead.name},
          data = ${JSON.stringify(lead.data)},
          score = ${lead.score},
          updated_at = ${new Date().toISOString()}
        WHERE client_id = ${lead.clientId} AND phone = ${lead.phone}
      `;
      return existing[0].id;
    } else {
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
        RETURNING id
      `;
      return rows[0]?.id;
    }
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
    await sql`
      UPDATE appointments 
      SET reminder_sent = true 
      WHERE id = ${appointmentId}
    `;
    return true;
  } catch (error) {
    console.error('❌ DB error marking reminder sent:', error);
    return false;
  }
}

export async function updateAppointmentStatus(appointmentId: number, status: string): Promise<boolean> {
  try {
    await sql`
      UPDATE appointments 
      SET status = ${status}
      WHERE id = ${appointmentId}
    `;
    return true;
  } catch (error) {
    console.error('❌ DB error updating appointment status:', error);
    return false;
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

export async function getClientById(clientId: string) {
  try {
    const rows = await sql`SELECT * FROM clients WHERE id = ${clientId} AND active = true LIMIT 1`;
    if (!rows[0]) return null;
    
    const client = rows[0];
    return {
      ...client,
      features: parseJSON(client.features, getDefaultFeatures()),
      settings: parseJSON(client.settings, {}),
      knowledge_base: parseJSON(client.knowledge_base, []),
      questions: parseJSON(client.questions, []),
      agent_phones: client.agent_phones || []
    };
  } catch (error) { console.error('❌ DB error:', error); return null; }
}
