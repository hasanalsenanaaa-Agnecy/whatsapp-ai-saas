-- Migration 001: Add UNIQUE constraints required for upsert operations
-- Run once against your Neon PostgreSQL database.
--
-- WHY: database.ts uses ON CONFLICT (client_id, phone) in saveConversation()
-- and createLead(). PostgreSQL requires an explicit UNIQUE constraint (or
-- unique index) on those columns for the ON CONFLICT clause to work.
-- Without these constraints every upsert will throw:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- HOW TO RUN:
--   psql $DATABASE_URL -f migrations/001_unique_constraints.sql
-- or paste into Neon's SQL editor.

-- conversations: one row per (client, phone)
ALTER TABLE conversations
  ADD CONSTRAINT conversations_client_id_phone_unique
  UNIQUE (client_id, phone);

-- leads: one row per (client, phone)
ALTER TABLE leads
  ADD CONSTRAINT leads_client_id_phone_unique
  UNIQUE (client_id, phone);
