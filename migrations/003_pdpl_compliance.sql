-- PDPL Compliance: consent tracking + data retention support
-- Run once against production DB.

-- 1. Track consent per conversation
-- consent_given: true once customer agrees, null if never asked
-- consent_at: when they agreed
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consent_given BOOLEAN;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;

-- 2. Index for data retention cleanup (find old conversations efficiently)
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations (updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

-- 3. Index for right-to-deletion (find all data by phone quickly)
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations (phone);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_events_phone ON events (phone);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments (phone);
