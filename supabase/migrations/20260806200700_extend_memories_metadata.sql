-- Extend memories with tags, source, status, and confidence
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'automatic';

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memories_source_not_blank'
      AND conrelid = 'public.memories'::regclass
  ) THEN
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_source_not_blank
      CHECK (length(trim(source)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memories_status_not_blank'
      AND conrelid = 'public.memories'::regclass
  ) THEN
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_status_not_blank
      CHECK (length(trim(status)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memories_confidence_range'
      AND conrelid = 'public.memories'::regclass
  ) THEN
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_confidence_range
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memories_tags_gin_idx ON public.memories USING GIN (tags);
CREATE INDEX IF NOT EXISTS memories_source_idx ON public.memories (source);
CREATE INDEX IF NOT EXISTS memories_status_idx ON public.memories (status);
