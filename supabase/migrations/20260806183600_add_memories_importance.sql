-- Add importance to memories for BrAIn Memory API inserts
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS importance INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memories_importance_range'
      AND conrelid = 'public.memories'::regclass
  ) THEN
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_importance_range
      CHECK (importance >= 1 AND importance <= 10);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memories_importance_idx ON public.memories (importance DESC);
