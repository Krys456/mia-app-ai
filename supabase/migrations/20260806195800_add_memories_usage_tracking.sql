-- BrAIn memory usage tracking
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS memories_last_used_at_idx
  ON public.memories (last_used_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS memories_usage_count_idx
  ON public.memories (usage_count DESC);

-- Atomically bump usage for a set of memory ids (search hits).
CREATE OR REPLACE FUNCTION public.mark_memories_used(memory_ids uuid[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.memories
  SET
    usage_count = usage_count + 1,
    last_used_at = NOW()
  WHERE id = ANY (memory_ids);
$$;
