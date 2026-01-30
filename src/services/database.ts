import postgres from 'postgres';
import type { UserState, LeadData } from '../types.js';

// ============================================================
// DATABASE CONNECTION
// ============================================================

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ DATABASE_URL not set - using in-memory storage');
}

const sql = connectionString 
  ? postgres(connectionString, { ssl: 'require' })
  : null;

// ============================================================
// INITIALIZE TABLES
// ============================================================

export async function initDatabase(): Promise<boolean> {
  if (!sql) {
    console.warn('⚠️ Database not configured - states will not persist');
    return false;
  }

  try {
    // Create user_states table
    await sql`
      CREATE TABLE IF NOT EXISTS user_states (
        phone VARCHAR(20) PRIMARY KEY,
        step INTEGER DEFAULT 0,
        data JSONB DEFAULT '{}',
        lead_captured BOOLEAN DEFAULT FALSE,
        conversation_history JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create leads table (backup of all leads)
    await sql`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        email VARCHAR(255),
        whatsapp_phone VARCHAR(20),
        property_type VARCHAR(100),
        city VARCHAR(100),
        budget VARCHAR(100),
        bedrooms VARCHAR(50),
        status VARCHAR(50) DEFAULT 'new',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create index for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_user_states_updated 
      ON user_states(updated_at)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_leads_phone 
      ON leads(phone)
    `;

    console.log('✅ Database initialized');
    return true;

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
}

// ============================================================
// USER STATE OPERATIONS
// ============================================================

export async function getUserState(phone: string): Promise<UserState | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      SELECT * FROM user_states WHERE phone = ${phone}
    `;

    if (result.length === 0 || !result[0]) return null;

    const row = result[0];
    return {
      step: row.step ?? 0,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {}),
      leadCaptured: row.lead_captured ?? false,
      conversationHistory: typeof row.conversation_history === 'string' ? JSON.parse(row.conversation_history) : (row.conversation_history ?? []),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
    };

  } catch (error) {
    console.error('❌ Error getting user state:', error);
    return null;
  }
}

export async function saveUserState(phone: string, state: UserState): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`
      INSERT INTO user_states (
        phone, step, data, lead_captured, conversation_history, updated_at
      ) VALUES (
        ${phone},
        ${state.step},
        ${JSON.stringify(state.data)},
        ${state.leadCaptured},
        ${JSON.stringify(state.conversationHistory)},
        NOW()
      )
      ON CONFLICT (phone) DO UPDATE SET
        step = ${state.step},
        data = ${JSON.stringify(state.data)},
        lead_captured = ${state.leadCaptured},
        conversation_history = ${JSON.stringify(state.conversationHistory)},
        updated_at = NOW()
    `;

    return true;

  } catch (error) {
    console.error('❌ Error saving user state:', error);
    return false;
  }
}

export async function deleteUserState(phone: string): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`DELETE FROM user_states WHERE phone = ${phone}`;
    return true;
  } catch (error) {
    console.error('❌ Error deleting user state:', error);
    return false;
  }
}

// ============================================================
// LEAD OPERATIONS
// ============================================================

export async function saveLead(lead: LeadData): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`
      INSERT INTO leads (
        phone, name, email, whatsapp_phone,
        property_type, city, budget, bedrooms
      ) VALUES (
        ${lead.phone},
        ${lead.name},
        ${lead.email},
        ${lead.whatsappPhone},
        ${lead.propertyType},
        ${lead.city},
        ${lead.budget},
        ${lead.bedrooms}
      )
    `;

    console.log(`✅ Lead saved to database: ${lead.name}`);
    return true;

  } catch (error) {
    console.error('❌ Error saving lead:', error);
    return false;
  }
}

export async function getLeads(limit: number = 100): Promise<LeadData[]> {
  if (!sql) return [];

  try {
    const result = await sql`
      SELECT * FROM leads 
      ORDER BY created_at DESC 
      LIMIT ${limit}
    `;

    return result.map(row => ({
      phone: row.phone,
      name: row.name,
      email: row.email,
      whatsappPhone: row.whatsapp_phone,
      propertyType: row.property_type,
      city: row.city,
      budget: row.budget,
      bedrooms: row.bedrooms,
      timestamp: row.created_at
    }));

  } catch (error) {
    console.error('❌ Error getting leads:', error);
    return [];
  }
}

// ============================================================
// CLEANUP OLD STATES
// ============================================================

export async function cleanupOldStates(daysOld: number = 7): Promise<number> {
  if (!sql) return 0;

  try {
    const result = await sql`
      DELETE FROM user_states 
      WHERE updated_at < NOW() - INTERVAL '${daysOld} days'
      AND lead_captured = TRUE
      RETURNING phone
    `;

    if (result.length > 0) {
      console.log(`🧹 Cleaned up ${result.length} old states`);
    }

    return result.length;

  } catch (error) {
    console.error('❌ Error cleaning up states:', error);
    return 0;
  }
}

// ============================================================
// CHECK DATABASE STATUS
// ============================================================

export function isDatabaseAvailable(): boolean {
  return sql !== null;
}
