import type { Migration } from './migrations.js';

export const databaseMigrations: Migration[] = [
  {
    id: '2026-02-01-constraints',
    name: 'Add core data integrity constraints',
    up: async (sql) => {
      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE clients ADD CONSTRAINT chk_clients_id_nonempty CHECK (char_length(id) > 0);
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE leads ADD CONSTRAINT chk_leads_phone_nonempty CHECK (char_length(phone) > 0);
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE conversations ADD CONSTRAINT chk_conversations_phone_nonempty CHECK (char_length(phone) > 0);
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE appointments ADD CONSTRAINT chk_appointments_phone_nonempty CHECK (char_length(phone) > 0);
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_client_phone_unique
        ON leads(client_id, phone)
        WHERE client_id IS NOT NULL AND phone IS NOT NULL;
      `);
    },
    down: async (sql) => {
      await sql.unsafe('ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_id_nonempty');
      await sql.unsafe('ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_phone_nonempty');
      await sql.unsafe('ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_phone_nonempty');
      await sql.unsafe('ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_appointments_phone_nonempty');
      await sql.unsafe('DROP INDEX IF EXISTS idx_leads_client_phone_unique');
    }
  }
  ,
  {
    id: '2026-02-01-auth-reset',
    name: 'Add client auth fields and password reset tokens',
    up: async (sql) => {
      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE clients ADD COLUMN email TEXT;
        EXCEPTION WHEN duplicate_column THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE clients ADD COLUMN password_hash TEXT;
        EXCEPTION WHEN duplicate_column THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        DO $$
        BEGIN
          ALTER TABLE clients ADD CONSTRAINT uq_clients_email UNIQUE (email);
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END $$;
      `);

      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_password_resets_client ON password_resets(client_id)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at)`);
    },
    down: async (sql) => {
      await sql.unsafe('DROP TABLE IF EXISTS password_resets');
      await sql.unsafe('ALTER TABLE clients DROP CONSTRAINT IF EXISTS uq_clients_email');
      await sql.unsafe('ALTER TABLE clients DROP COLUMN IF EXISTS password_hash');
      await sql.unsafe('ALTER TABLE clients DROP COLUMN IF EXISTS email');
    }
  }
  ,
  {
    id: '2026-02-02-ai-feedback',
    name: 'Add AI feedback tracking',
    up: async (sql) => {
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ai_feedback (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
          conversation_id TEXT,
          user_message TEXT,
          ai_response TEXT NOT NULL,
          rating INTEGER NOT NULL,
          comment TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_feedback_client ON ai_feedback(client_id)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_feedback_lead ON ai_feedback(lead_id)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_feedback_created ON ai_feedback(created_at DESC)`);
    },
    down: async (sql) => {
      await sql.unsafe('DROP TABLE IF EXISTS ai_feedback');
    }
  }
  ,
  {
    id: '2026-02-02-automation',
    name: 'Add automation sequences and enrollments',
    up: async (sql) => {
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS automation_sequences (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          steps JSONB NOT NULL DEFAULT '[]',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS automation_enrollments (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          sequence_id TEXT NOT NULL REFERENCES automation_sequences(id) ON DELETE CASCADE,
          current_step INTEGER DEFAULT 0,
          next_run_at TIMESTAMP NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_automation_sequences_client ON automation_sequences(client_id)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_automation_enrollments_client ON automation_enrollments(client_id)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_automation_enrollments_next_run ON automation_enrollments(next_run_at)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_automation_enrollments_status ON automation_enrollments(status)`);
    },
    down: async (sql) => {
      await sql.unsafe('DROP TABLE IF EXISTS automation_enrollments');
      await sql.unsafe('DROP TABLE IF EXISTS automation_sequences');
    }
  }
];
