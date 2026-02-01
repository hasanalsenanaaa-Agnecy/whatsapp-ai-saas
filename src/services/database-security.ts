import { sql } from './database.js';

/**
 * Initialize Phase 1 security tables
 */
export async function initSecurityTables(): Promise<boolean> {
  if (!sql) {
    console.warn('⚠️ Database not configured');
    return false;
  }

  try {
    console.log('🔄 Initializing security tables...');

    // API Keys table
    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP,
        expires_at TIMESTAMP
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_client ON api_keys(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = true`;

    // Audit logs table
    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        changes JSONB,
        ip_address TEXT,
        user_agent TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_client ON audit_logs(client_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`;

    // Rate limit tracker
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limit_tracker (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        request_count INTEGER DEFAULT 1,
        window_start TIMESTAMP DEFAULT NOW(),
        window_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limit_client ON rate_limit_tracker(client_id)`;

    console.log('✅ Security tables initialized');
    return true;
  } catch (error) {
    console.error('❌ Error initializing security tables:', error);
    return false;
  }
}
