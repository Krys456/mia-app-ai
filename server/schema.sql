-- LAIfe Memory schema (auto-applied by API on first request as well)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category);
CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories (updated_at DESC);
