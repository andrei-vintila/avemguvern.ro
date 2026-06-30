-- Crowd-sourced joke suggestions (D1).
-- Apply locally:  npx wrangler d1 execute avemguvern-suggestions --local --file=./schema.sql
-- Apply remote:   npx wrangler d1 execute avemguvern-suggestions --remote --file=./schema.sql
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo TEXT,            -- JSON array of party ids, or NULL
  topic TEXT,            -- e.g. 'anticipate', or NULL
  joke TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions (created_at);
