-- LAIfe Memory schema (also auto-applied by API on first request)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category);
CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories (updated_at DESC);
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id);
