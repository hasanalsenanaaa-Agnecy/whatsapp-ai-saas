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
        email TEXT UNIQUE,
        password_hash TEXT,
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
  email?: string;
  passwordHash?: string;
  phoneNumberId: string | null;
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
        id, name, industry, email, password_hash, phone_number_id, access_token, verify_token,
        agent_phones, settings, questions, messages, knowledge_base
      ) VALUES (
        ${client.id},
        ${client.name},
        ${client.industry},
        ${client.email || null},
        ${client.passwordHash || null},
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

export async function getLeadById(clientId: string, leadId: number): Promise<any | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      SELECT * FROM leads WHERE id = ${leadId} AND client_id = ${clientId}
    `;
    return result[0] || null;
  } catch (error) {
    console.error('❌ Error getting lead by id:', error);
    return null;
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

export async function updateLead(leadId: number, updates: {
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
  score?: string;
  notes?: string;
  data?: any;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`
      UPDATE leads SET
        name = COALESCE(${updates.name || null}, name),
        phone = COALESCE(${updates.phone || null}, phone),
        email = COALESCE(${updates.email || null}, email),
        status = COALESCE(${updates.status || null}, status),
        score = COALESCE(${updates.score || null}, score),
        notes = COALESCE(${updates.notes || null}, notes),
        data = COALESCE(${updates.data ? JSON.stringify(updates.data) : null}, data),
        updated_at = NOW()
      WHERE id = ${leadId}
    `;
    return true;
  } catch (error) {
    console.error('❌ Error updating lead:', error);
    return false;
  }
}

export async function deleteLead(leadId: number): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`DELETE FROM leads WHERE id = ${leadId}`;
    return true;
  } catch (error) {
    console.error('❌ Error deleting lead:', error);
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

export type AnalyticsUploadRecord = {
  id: string;
  clientId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  rowCount: number | null;
  columns: any[];
  sampleRows: any[];
  summary: any;
  storageKey: string | null;
  error: string | null;
  suggestions: any | null;
  dataType: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function createAnalyticsUpload(input: {
  clientId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status?: string;
  rowCount?: number | null;
  columns?: any[];
  sampleRows?: any[];
  summary?: any;
  storageKey?: string | null;
  error?: string | null;
  suggestions?: any | null;
  dataType?: string | null;
  notes?: string | null;
}): Promise<string | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      INSERT INTO analytics_uploads (
        client_id,
        filename,
        mime_type,
        size_bytes,
        status,
        row_count,
        columns,
        sample_rows,
        summary,
        storage_key,
        error,
        suggestions,
        data_type,
        notes
      ) VALUES (
        ${input.clientId},
        ${input.filename},
        ${input.mimeType},
        ${input.sizeBytes},
        ${input.status || 'uploaded'},
        ${input.rowCount ?? null},
        ${JSON.stringify(input.columns || [])},
        ${JSON.stringify(input.sampleRows || [])},
        ${JSON.stringify(input.summary || {})},
        ${input.storageKey || null},
        ${input.error || null},
        ${JSON.stringify(input.suggestions || null)},
        ${input.dataType || null},
        ${input.notes || null}
      )
      RETURNING id
    `;

    return result[0]?.id || null;
  } catch (error) {
    console.error('❌ Error creating analytics upload:', error);
    return null;
  }
}

export async function updateAnalyticsUpload(uploadId: string, updates: {
  status?: string;
  rowCount?: number | null;
  columns?: any[];
  sampleRows?: any[];
  summary?: any;
  storageKey?: string | null;
  error?: string | null;
  suggestions?: any | null;
  dataType?: string | null;
  notes?: string | null;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    if (updates.status !== undefined) {
      await sql`UPDATE analytics_uploads SET status = ${updates.status} WHERE id = ${uploadId}`;
    }
    if (updates.rowCount !== undefined) {
      await sql`UPDATE analytics_uploads SET row_count = ${updates.rowCount} WHERE id = ${uploadId}`;
    }
    if (updates.columns !== undefined) {
      await sql`UPDATE analytics_uploads SET columns = ${JSON.stringify(updates.columns)} WHERE id = ${uploadId}`;
    }
    if (updates.sampleRows !== undefined) {
      await sql`UPDATE analytics_uploads SET sample_rows = ${JSON.stringify(updates.sampleRows)} WHERE id = ${uploadId}`;
    }
    if (updates.summary !== undefined) {
      await sql`UPDATE analytics_uploads SET summary = ${JSON.stringify(updates.summary)} WHERE id = ${uploadId}`;
    }
    if (updates.storageKey !== undefined) {
      await sql`UPDATE analytics_uploads SET storage_key = ${updates.storageKey} WHERE id = ${uploadId}`;
    }
    if (updates.error !== undefined) {
      await sql`UPDATE analytics_uploads SET error = ${updates.error} WHERE id = ${uploadId}`;
    }
    if (updates.suggestions !== undefined) {
      await sql`UPDATE analytics_uploads SET suggestions = ${JSON.stringify(updates.suggestions)} WHERE id = ${uploadId}`;
    }
    if (updates.dataType !== undefined) {
      await sql`UPDATE analytics_uploads SET data_type = ${updates.dataType} WHERE id = ${uploadId}`;
    }
    if (updates.notes !== undefined) {
      await sql`UPDATE analytics_uploads SET notes = ${updates.notes} WHERE id = ${uploadId}`;
    }

    await sql`UPDATE analytics_uploads SET updated_at = NOW() WHERE id = ${uploadId}`;
    return true;
  } catch (error) {
    console.error('❌ Error updating analytics upload:', error);
    return false;
  }
}

export async function listAnalyticsUploads(clientId: string): Promise<AnalyticsUploadRecord[]> {
  if (!sql) return [];

  try {
    const result = await sql`
      SELECT * FROM analytics_uploads
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return result.map((row: any) => ({
      id: row.id,
      clientId: row.client_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      status: row.status,
      rowCount: row.row_count,
      columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
      sampleRows: typeof row.sample_rows === 'string' ? JSON.parse(row.sample_rows) : row.sample_rows,
      summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary,
      storageKey: row.storage_key,
      error: row.error,
      suggestions: typeof row.suggestions === 'string' ? JSON.parse(row.suggestions) : row.suggestions,
      dataType: row.data_type,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('❌ Error listing analytics uploads:', error);
    return [];
  }
}

export async function getAnalyticsUpload(clientId: string, uploadId: string): Promise<AnalyticsUploadRecord | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      SELECT * FROM analytics_uploads
      WHERE client_id = ${clientId} AND id = ${uploadId}
      LIMIT 1
    `;

    const row = result[0];
    if (!row) return null;

    return {
      id: row.id,
      clientId: row.client_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      status: row.status,
      rowCount: row.row_count,
      columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
      sampleRows: typeof row.sample_rows === 'string' ? JSON.parse(row.sample_rows) : row.sample_rows,
      summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary,
      storageKey: row.storage_key,
      error: row.error,
      suggestions: typeof row.suggestions === 'string' ? JSON.parse(row.suggestions) : row.suggestions,
      dataType: row.data_type,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    console.error('❌ Error getting analytics upload:', error);
    return null;
  }
}

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

export async function getLeadAnalytics(clientId: string): Promise<any> {
  if (!sql) return {};

  try {
    const counts = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'new')::int as new_count,
        COUNT(*) FILTER (WHERE status = 'contacted')::int as contacted_count,
        COUNT(*) FILTER (WHERE status = 'converted')::int as converted_count,
        COUNT(*) FILTER (WHERE status = 'lost')::int as lost_count,
        COUNT(*) FILTER (WHERE score = 'hot')::int as hot_count,
        COUNT(*) FILTER (WHERE score = 'warm')::int as warm_count,
        COUNT(*) FILTER (WHERE score = 'cold')::int as cold_count
      FROM leads
      WHERE client_id = ${clientId}
    `;

    const pendingAppointments = await sql`
      SELECT COUNT(*)::int as count
      FROM appointments
      WHERE client_id = ${clientId} AND status = 'pending'
    `;

    const row = counts[0] || {
      total: 0,
      new_count: 0,
      contacted_count: 0,
      converted_count: 0,
      lost_count: 0,
      hot_count: 0,
      warm_count: 0,
      cold_count: 0
    };

    const conversionRate = row.total > 0 ? Math.round((row.converted_count / row.total) * 100) : 0;

    return {
      totalLeads: row.total,
      conversionRate,
      pendingAppointments: parseInt(pendingAppointments[0]?.count || '0'),
      statusBreakdown: {
        new: row.new_count,
        contacted: row.contacted_count,
        converted: row.converted_count,
        lost: row.lost_count
      },
      scoreBreakdown: {
        hot: row.hot_count,
        warm: row.warm_count,
        cold: row.cold_count
      }
    };
  } catch (error) {
    console.error('❌ Error getting analytics:', error);
    return {};
  }
}

export async function getAdvancedAnalytics(clientId: string): Promise<any> {
  if (!sql) return {};

  try {
    const sources = await sql`
      SELECT source, COUNT(*)::int as count
      FROM leads
      WHERE client_id = ${clientId}
      GROUP BY source
      ORDER BY count DESC
    `;

    const funnelCounts = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'new')::int as new_count,
        COUNT(*) FILTER (WHERE status = 'contacted')::int as contacted_count,
        COUNT(*) FILTER (WHERE status = 'converted')::int as converted_count,
        COUNT(*) FILTER (WHERE status = 'lost')::int as lost_count
      FROM leads
      WHERE client_id = ${clientId}
    `;

    const feedback = await sql`
      SELECT
        COUNT(*)::int as total,
        COALESCE(AVG(rating), 0)::numeric(10,2) as avg_rating,
        COUNT(*) FILTER (WHERE rating >= 4)::int as positive,
        COUNT(*) FILTER (WHERE rating = 3)::int as neutral,
        COUNT(*) FILTER (WHERE rating <= 2)::int as negative
      FROM ai_feedback
      WHERE client_id = ${clientId}
    `;

    const feedbackLeads = await sql`
      SELECT COUNT(DISTINCT lead_id)::int as count
      FROM ai_feedback
      WHERE client_id = ${clientId} AND lead_id IS NOT NULL
    `;

    const funnelRow = funnelCounts[0] || {
      total: 0,
      new_count: 0,
      contacted_count: 0,
      converted_count: 0,
      lost_count: 0
    };

    const feedbackRow = feedback[0] || {
      total: 0,
      avg_rating: 0,
      positive: 0,
      neutral: 0,
      negative: 0
    };

    const positiveRate = feedbackRow.total > 0
      ? Math.round((feedbackRow.positive / feedbackRow.total) * 100)
      : 0;

    return {
      attribution: sources.map((row: any) => ({
        source: row.source || 'unknown',
        count: row.count
      })),
      funnel: {
        total: funnelRow.total,
        new: funnelRow.new_count,
        contacted: funnelRow.contacted_count,
        converted: funnelRow.converted_count,
        lost: funnelRow.lost_count
      },
      aiImpact: {
        feedbackCount: feedbackRow.total,
        avgRating: Number(feedbackRow.avg_rating || 0),
        positiveRate,
        positive: feedbackRow.positive,
        neutral: feedbackRow.neutral,
        negative: feedbackRow.negative,
        leadsWithFeedback: feedbackLeads[0]?.count || 0
      }
    };
  } catch (error) {
    console.error('❌ Error getting advanced analytics:', error);
    return {};
  }
}

export async function getClientByEmail(email: string): Promise<any | null> {
  if (!sql) return null;

  try {
    const result = await sql`SELECT * FROM clients WHERE email = ${email}`;
    return result[0] || null;
  } catch (error) {
    console.error('❌ Error getting client by email:', error);
    return null;
  }
}

export async function setClientPassword(clientId: string, passwordHash: string): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`UPDATE clients SET password_hash = ${passwordHash} WHERE id = ${clientId}`;
    return true;
  } catch (error) {
    console.error('❌ Error updating client password:', error);
    return false;
  }
}

export async function createPasswordResetToken(clientId: string, tokenHash: string, expiresAt: Date): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`
      INSERT INTO password_resets (client_id, token_hash, expires_at)
      VALUES (${clientId}, ${tokenHash}, ${expiresAt})
    `;
    return true;
  } catch (error) {
    console.error('❌ Error creating password reset token:', error);
    return false;
  }
}

export async function consumePasswordResetToken(tokenHash: string): Promise<{ clientId: string } | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      SELECT id, client_id as clientId FROM password_resets
      WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > NOW()
      LIMIT 1
    `;

    if (!result[0]) return null;

    await sql`UPDATE password_resets SET used_at = NOW() WHERE id = ${result[0].id}`;

    return { clientId: result[0].clientId };
  } catch (error) {
    console.error('❌ Error consuming password reset token:', error);
    return null;
  }
}

export async function createAIFeedback(input: {
  clientId: string;
  leadId?: number;
  conversationId?: string;
  userMessage?: string;
  aiResponse: string;
  rating: number;
  comment?: string;
}): Promise<string | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      INSERT INTO ai_feedback (
        client_id,
        lead_id,
        conversation_id,
        user_message,
        ai_response,
        rating,
        comment
      ) VALUES (
        ${input.clientId},
        ${input.leadId || null},
        ${input.conversationId || null},
        ${input.userMessage || null},
        ${input.aiResponse},
        ${input.rating},
        ${input.comment || null}
      )
      RETURNING id
    `;

    return result[0]?.id || null;
  } catch (error) {
    console.error('❌ Error creating AI feedback:', error);
    return null;
  }
}

export async function listAIFeedback(clientId: string, limit: number = 50): Promise<any[]> {
  if (!sql) return [];

  try {
    const rows = await sql`
      SELECT id, lead_id, conversation_id, user_message, ai_response, rating, comment, created_at
      FROM ai_feedback
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row: any) => ({
      id: row.id,
      leadId: row.lead_id,
      conversationId: row.conversation_id,
      userMessage: row.user_message,
      aiResponse: row.ai_response,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('❌ Error listing AI feedback:', error);
    return [];
  }
}

// ============================================================
// AUTOMATION OPERATIONS
// ============================================================

export async function createAutomationSequence(input: {
  clientId: string;
  name: string;
  steps: any[];
  isActive?: boolean;
}): Promise<string | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      INSERT INTO automation_sequences (client_id, name, steps, is_active)
      VALUES (${input.clientId}, ${input.name}, ${JSON.stringify(input.steps)}, ${input.isActive ?? true})
      RETURNING id
    `;
    return result[0]?.id || null;
  } catch (error) {
    console.error('❌ Error creating automation sequence:', error);
    return null;
  }
}

export async function listAutomationSequences(clientId: string): Promise<any[]> {
  if (!sql) return [];

  try {
    const rows = await sql`
      SELECT * FROM automation_sequences WHERE client_id = ${clientId} ORDER BY created_at DESC
    `;
    return rows.map((row: any) => ({
      id: row.id,
      clientId: row.client_id,
      name: row.name,
      steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps,
      isActive: row.is_active,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('❌ Error listing automation sequences:', error);
    return [];
  }
}

export async function updateAutomationSequence(sequenceId: string, updates: {
  name?: string;
  steps?: any[];
  isActive?: boolean;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    if (updates.name !== undefined) {
      await sql`UPDATE automation_sequences SET name = ${updates.name} WHERE id = ${sequenceId}`;
    }
    if (updates.steps !== undefined) {
      await sql`UPDATE automation_sequences SET steps = ${JSON.stringify(updates.steps)} WHERE id = ${sequenceId}`;
    }
    if (updates.isActive !== undefined) {
      await sql`UPDATE automation_sequences SET is_active = ${updates.isActive} WHERE id = ${sequenceId}`;
    }
    return true;
  } catch (error) {
    console.error('❌ Error updating automation sequence:', error);
    return false;
  }
}

export async function deleteAutomationSequence(sequenceId: string): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`DELETE FROM automation_sequences WHERE id = ${sequenceId}`;
    return true;
  } catch (error) {
    console.error('❌ Error deleting automation sequence:', error);
    return false;
  }
}

export async function enrollLeadInSequence(input: {
  clientId: string;
  leadId: number;
  sequenceId: string;
  nextRunAt: Date;
}): Promise<string | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      INSERT INTO automation_enrollments (client_id, lead_id, sequence_id, next_run_at)
      VALUES (${input.clientId}, ${input.leadId}, ${input.sequenceId}, ${input.nextRunAt})
      RETURNING id
    `;
    return result[0]?.id || null;
  } catch (error) {
    console.error('❌ Error enrolling lead in sequence:', error);
    return null;
  }
}

export async function listAutomationEnrollments(clientId: string, limit: number = 50): Promise<any[]> {
  if (!sql) return [];

  try {
    const rows = await sql`
      SELECT * FROM automation_enrollments
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row: any) => ({
      id: row.id,
      clientId: row.client_id,
      leadId: row.lead_id,
      sequenceId: row.sequence_id,
      currentStep: row.current_step,
      nextRunAt: row.next_run_at,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('❌ Error listing automation enrollments:', error);
    return [];
  }
}

export async function listDueEnrollments(clientId: string, limit: number = 25): Promise<any[]> {
  if (!sql) return [];

  try {
    return await sql`
      SELECT * FROM automation_enrollments
      WHERE client_id = ${clientId}
        AND status = 'active'
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT ${limit}
    `;
  } catch (error) {
    console.error('❌ Error listing due enrollments:', error);
    return [];
  }
}

export async function updateEnrollmentProgress(input: {
  enrollmentId: string;
  currentStep: number;
  nextRunAt?: Date | null;
  status?: string;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`
      UPDATE automation_enrollments
      SET current_step = ${input.currentStep},
          next_run_at = ${input.nextRunAt || null},
          status = ${input.status || 'active'},
          updated_at = NOW()
      WHERE id = ${input.enrollmentId}
    `;
    return true;
  } catch (error) {
    console.error('❌ Error updating enrollment progress:', error);
    return false;
  }
}

export function isDatabaseAvailable(): boolean {
  return sql !== null;
}

export { sql };
