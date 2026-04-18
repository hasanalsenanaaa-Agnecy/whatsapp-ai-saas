-- Migration 002: Events table for analytics and business intelligence
-- Run once against your Neon PostgreSQL database.
--
-- WHY: The bot currently has zero analytics. This table records key
-- events (messages, checkouts, payments, AI calls, escalations) so
-- you can answer "how many messages did ARAB handle this week" and
-- "how much revenue went through the bot this month."
--
-- HOW TO RUN:
--   psql $DATABASE_URL -f migrations/002_events_table.sql
-- or paste into Neon's SQL editor.

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL    PRIMARY KEY,
  client_id  TEXT         NOT NULL,
  event_type TEXT         NOT NULL,
  phone      TEXT,
  data       JSONB        DEFAULT '{}',
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Query patterns: "events for client X in date range" and "events by type in date range"
CREATE INDEX idx_events_client_date ON events (client_id, created_at);
CREATE INDEX idx_events_type_date   ON events (event_type, created_at);
