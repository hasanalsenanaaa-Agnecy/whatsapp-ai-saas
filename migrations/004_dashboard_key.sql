-- Dashboard access: per-client dashboard key for authenticated portal access.
-- Each client gets a unique 32-char random key.
-- Owner uses ANALYTICS_KEY env var instead.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS dashboard_key VARCHAR(64) UNIQUE;
