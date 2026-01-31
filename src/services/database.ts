import postgres from 'postgres';
import type { UserState, LeadData } from '../types.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ DATABASE_URL not set - using in-memory storage');
}

const sql = connectionString 
  ? postgres(connectionString, { ssl: 'require' })
  : null;

// ============================================================
// INITIALIZE TABLES (Multi-tenant)
// ============================================================

export async function initDatabase(): Promise<boolean> {
  if (!sql) {
    console.warn('⚠️ Database not configured');
    return false;
  }

  try {
    // Clients table (your customers)
    await sql`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT NOT NULL,
        phone_number_id TEXT UNIQUE,
        access_token TEXT,
        verify_token TEXT,
        agent_phones TEXT[] DEFAULT '{}',
        settings JSONB DEFAULT '{}',
        knowledge_base JSONB DEFAULT '[]',
        questions JSONB DEFAULT '[]',
        messages JSONB DEFAULT '{}',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Leads table
    await sql`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        client_id TEXT REFERENCES clients(id),
        phone TEXT NOT NULL,
        name TEXT,
        email TEXT,
        data JSONB DEFAULT '{}',
        score TEXT DEFAULT 'warm',
        status TEXT DEFAULT 'new',
        source TEXT DEFAULT 'whatsapp',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Conversations table
    await sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        client_id TEXT REFERENCES clients(id),
        lead_id INTEGER REFERENCES leads(id),
        phone TEXT NOT NULL,
        messages JSONB DEFAULT '[]',
        state TEXT DEFAULT 'welcome',
        step INTEGER DEFAULT 0,
        data JSONB DEFAULT '{}',
        lead_captured BOOLEAN DEFAULT false,
        handover_requested BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Appointments table
    await sql`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        client_id TEXT REFERENCES clients(id),
        lead_id INTEGER REFERENCES leads(id),
        phone TEXT NOT NULL,
        appointment_date DATE,
        appointment_time TIME,
        appointment_type TEXT,
        status TEXT DEFAULT 'pending',
        notes TEXT,
        reminder_sent BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_clients_phone_number_id ON clients(phone_number_id)`;

    console.log('✅ Database initialized (multi-tenant)');
    return true;

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
}

// ============================================================
// CLIENT OPERATIONS
// ============================================================

export async function getClientByPhoneNumberId(phoneNumberId: string): Promise<any | null> {
  if (!sql) return null;
  
  try {
    const result = await sql`
      SELECT * FROM clients WHERE phone_number_id = ${phoneNumberId} AND active = true
    `;
    return result[0] || null;
  } catch (error) {
    console.error('❌ Error getting client:', error);
    return null;
  }
}

export async function getClientById(clientId: string): Promise<any | null> {
  if (!sql) return null;
  
  try {
    const result = await sql`
      SELECT * FROM clients WHERE id = ${clientId}
    `;
    return result[0] || null;
  } catch (error) {
    console.error('❌ Error getting client:', error);
    return null;
  }
}

export async function createClient(client: {
  id: string;
  name: string;
  industry: string;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  agentPhones: string[];
  settings?: any;
  questions?: any[];
  messages?: any;
  knowledgeBase?: any[];
}): Promise<boolean> {
  if (!sql) return false;
  
  try {
    await sql`
      INSERT INTO clients (
        id, name, industry, phone_number_id, access_token, verify_token,
        agent_phones, settings, questions, messages, knowledge_base
      ) VALUES (
        ${client.id},
        ${client.name},
        ${client.industry},
        ${client.phoneNumberId},
        ${client.accessToken},
        ${client.verifyToken},
        ${client.agentPhones},
        ${JSON.stringify(client.settings || {})},
        ${JSON.stringify(client.questions || [])},
        ${JSON.stringify(client.messages || {})},
        ${JSON.stringify(client.knowledgeBase || [])}
      )
    `;
    return true;
  } catch (error) {
    console.error('❌ Error creating client:', error);
    return false;
  }
}

export async function updateClient(clientId: string, updates: any): Promise<boolean> {
  if (!sql) return false;
  
  try {
    const setClauses: string[] = [];
    const values: any[] = [];
    
    if (updates.name) {
      await sql`UPDATE clients SET name = ${updates.name} WHERE id = ${clientId}`;
    }
    if (updates.settings) {
      await sql`UPDATE clients SET settings = ${JSON.stringify(updates.settings)} WHERE id = ${clientId}`;
    }
    if (updates.knowledgeBase) {
      await sql`UPDATE clients SET knowledge_base = ${JSON.stringify(updates.knowledgeBase)} WHERE id = ${clientId}`;
    }
    if (updates.questions) {
      await sql`UPDATE clients SET questions = ${JSON.stringify(updates.questions)} WHERE id = ${clientId}`;
    }
    if (updates.messages) {
      await sql`UPDATE clients SET messages = ${JSON.stringify(updates.messages)} WHERE id = ${clientId}`;
    }
    if (updates.agentPhones) {
      await sql`UPDATE clients SET agent_phones = ${updates.agentPhones} WHERE id = ${clientId}`;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error updating client:', error);
    return false;
  }
}

// ============================================================
// CONVERSATION OPERATIONS
// ============================================================

export async function getConversation(clientId: string, phone: string): Promise<any | null> {
  if (!sql) return null;
  
  try {
    const result = await sql`
      SELECT * FROM conversations 
      WHERE client_id = ${clientId} AND phone = ${phone}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    
    if (!result[0]) return null;
    
    const row = result[0];
    return {
      id: row.id,
      clientId: row.client_id,
      leadId: row.lead_id,
      phone: row.phone,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      state: row.state,
      step: row.step,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      leadCaptured: row.lead_captured,
      handoverRequested: row.handover_requested,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    console.error('❌ Error getting conversation:', error);
    return null;
  }
}

export async function saveConversation(conv: {
  clientId: string;
  phone: string;
  messages: any[];
  state: string;
  step: number;
  data: any;
  leadCaptured: boolean;
  handoverRequested: boolean;
  leadId?: number;
}): Promise<boolean> {
  if (!sql) return false;
  
  try {
    await sql`
      INSERT INTO conversations (
        client_id, phone, messages, state, step, data, lead_captured, handover_requested, lead_id, updated_at
      ) VALUES (
        ${conv.clientId},
        ${conv.phone},
        ${JSON.stringify(conv.messages)},
        ${conv.state},
        ${conv.step},
        ${JSON.stringify(conv.data)},
        ${conv.leadCaptured},
        ${conv.handoverRequested},
        ${conv.leadId || null},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        messages = ${JSON.stringify(conv.messages)},
        state = ${conv.state},
        step = ${conv.step},
        data = ${JSON.stringify(conv.data)},
        lead_captured = ${conv.leadCaptured},
        handover_requested = ${conv.handoverRequested},
        lead_id = ${conv.leadId || null},
        updated_at = NOW()
    `;
    return true;
  } catch (error) {
    console.error('❌ Error saving conversation:', error);
    return false;
  }
}

export async function updateConversation(clientId: string, phone: string, updates: any): Promise<boolean> {
  if (!sql) return false;
  
  try {
    await sql`
      UPDATE conversations SET
        messages = COALESCE(${updates.messages ? JSON.stringify(updates.messages) : null}, messages),
        state = COALESCE(${updates.state || null}, state),
        step = COALESCE(${updates.step ?? null}, step),
        data = COALESCE(${updates.data ? JSON.stringify(updates.data) : null}, data),
        lead_captured = COALESCE(${updates.leadCaptured ?? null}, lead_captured),
        handover_requested = COALESCE(${updates.handoverRequested ?? null}, handover_requested),
        lead_id = COALESCE(${updates.leadId || null}, lead_id),
        updated_at = NOW()
      WHERE client_id = ${clientId} AND phone = ${phone}
    `;
    return true;
  } catch (error) {
    console.error('❌ Error updating conversation:', error);
    return false;
  }
}

// ============================================================
// LEAD OPERATIONS
// ============================================================

export async function createLead(lead: {
  clientId: string;
  phone: string;
  name: string;
  email?: string;
  data: any;
  score?: string;
}): Promise<number | null> {
  if (!sql) return null;
  
  try {
    const result = await sql`
      INSERT INTO leads (client_id, phone, name, email, data, score)
      VALUES (
        ${lead.clientId},
        ${lead.phone},
        ${lead.name},
        ${lead.email || null},
        ${JSON.stringify(lead.data)},
        ${lead.score || 'warm'}
      )
      RETURNING id
    `;
    return result[0]?.id || null;
  } catch (error) {
    console.error('❌ Error creating lead:', error);
    return null;
  }
}

export async function getLeads(clientId: string, limit: number = 100): Promise<any[]> {
  if (!sql) return [];
  
  try {
    const result = await sql`
      SELECT * FROM leads 
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC 
      LIMIT ${limit}
    `;
    
    return result.map(row => ({
      id: row.id,
      phone: row.phone,
      name: row.name,
      email: row.email,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      score: row.score,
      status: row.status,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('❌ Error getting leads:', error);
    return [];
  }
}

export async function updateLeadStatus(leadId: number, status: string, notes?: string): Promise<boolean> {
  if (!sql) return false;
  
  try {
    await sql`
      UPDATE leads SET 
        status = ${status},
        notes = COALESCE(${notes || null}, notes),
        updated_at = NOW()
      WHERE id = ${leadId}
    `;
    return true;
  } catch (error) {
    console.error('❌ Error updating lead:', error);
    return false;
  }
}

// ============================================================
// APPOINTMENT OPERATIONS
// ============================================================

export async function createAppointment(apt: {
  clientId: string;
  leadId: number;
  phone: string;
  date: string;
  time: string;
  type: string;
  notes?: string;
}): Promise<number | null> {
  if (!sql) return null;
  
  try {
    const result = await sql`
      INSERT INTO appointments (
        client_id, lead_id, phone, appointment_date, appointment_time, appointment_type, notes
      ) VALUES (
        ${apt.clientId},
        ${apt.leadId},
        ${apt.phone},
        ${apt.date},
        ${apt.time},
        ${apt.type},
        ${apt.notes || null}
      )
      RETURNING id
    `;
    return result[0]?.id || null;
  } catch (error) {
    console.error('❌ Error creating appointment:', error);
    return null;
  }
}

export async function getAppointments(clientId: string, status?: string): Promise<any[]> {
  if (!sql) return [];
  
  try {
    const result = status
      ? await sql`SELECT * FROM appointments WHERE client_id = ${clientId} AND status = ${status} ORDER BY appointment_date, appointment_time`
      : await sql`SELECT * FROM appointments WHERE client_id = ${clientId} ORDER BY appointment_date, appointment_time`;
    
    return result;
  } catch (error) {
    console.error('❌ Error getting appointments:', error);
    return [];
  }
}

// ============================================================
// ANALYTICS
// ============================================================

export async function getClientStats(clientId: string): Promise<any> {
  if (!sql) return {};
  
  try {
    const totalLeads = await sql`SELECT COUNT(*) as count FROM leads WHERE client_id = ${clientId}`;
    const todayLeads = await sql`SELECT COUNT(*) as count FROM leads WHERE client_id = ${clientId} AND created_at >= CURRENT_DATE`;
    const weekLeads = await sql`SELECT COUNT(*) as count FROM leads WHERE client_id = ${clientId} AND created_at >= CURRENT_DATE - INTERVAL '7 days'`;
    const hotLeads = await sql`SELECT COUNT(*) as count FROM leads WHERE client_id = ${clientId} AND score = 'hot'`;
    const convertedLeads = await sql`SELECT COUNT(*) as count FROM leads WHERE client_id = ${clientId} AND status = 'converted'`;
    const pendingAppointments = await sql`SELECT COUNT(*) as count FROM appointments WHERE client_id = ${clientId} AND status = 'pending'`;
    
    const leadsByStatus = await sql`
      SELECT status, COUNT(*) as count 
      FROM leads WHERE client_id = ${clientId}
      GROUP BY status
    `;
    
    const leadsByScore = await sql`
      SELECT score, COUNT(*) as count 
      FROM leads WHERE client_id = ${clientId}
      GROUP BY score
    `;
    
    return {
      totalLeads: parseInt(totalLeads[0]?.count || '0'),
      todayLeads: parseInt(todayLeads[0]?.count || '0'),
      weekLeads: parseInt(weekLeads[0]?.count || '0'),
      hotLeads: parseInt(hotLeads[0]?.count || '0'),
      convertedLeads: parseInt(convertedLeads[0]?.count || '0'),
      pendingAppointments: parseInt(pendingAppointments[0]?.count || '0'),
      conversionRate: totalLeads[0]?.count > 0 
        ? Math.round((parseInt(convertedLeads[0]?.count || '0') / parseInt(totalLeads[0]?.count)) * 100)
        : 0,
      leadsByStatus: leadsByStatus.reduce((acc: any, row: any) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
      leadsByScore: leadsByScore.reduce((acc: any, row: any) => {
        acc[row.score] = parseInt(row.count);
        return acc;
      }, {})
    };
  } catch (error) {
    console.error('❌ Error getting stats:', error);
    return {};
  }
}

export function isDatabaseAvailable(): boolean {
  return sql !== null;
}

export { sql };
