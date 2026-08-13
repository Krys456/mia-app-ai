-- Chat persistence extensions for conversations / messages
-- Safe additive migration — existing tables remain valid.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS browser_user_id TEXT,
  ADD COLUMN IF NOT EXISTS engine TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS conversations_browser_user_id_idx
  ON public.conversations (browser_user_id);

CREATE INDEX IF NOT EXISTS conversations_browser_updated_at_idx
  ON public.conversations (browser_user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_client_id_uidx
  ON public.messages (conversation_id, client_id)
  WHERE client_id IS NOT NULL;
