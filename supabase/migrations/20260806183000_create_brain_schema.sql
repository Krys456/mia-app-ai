-- BrAIn database schema for Supabase PostgreSQL
-- Apply via Supabase SQL editor or: supabase db push / migration run
-- No API or application code depends on this migration yet.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at in sync on row updates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON public.users (created_at DESC);

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memories_category_not_blank CHECK (length(trim(category)) > 0),
  CONSTRAINT memories_title_not_blank CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS memories_user_id_idx ON public.memories (user_id);
CREATE INDEX IF NOT EXISTS memories_category_idx ON public.memories (category);
CREATE INDEX IF NOT EXISTS memories_user_category_idx ON public.memories (user_id, category);
CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON public.memories (updated_at DESC);

DROP TRIGGER IF EXISTS memories_set_updated_at ON public.memories;
CREATE TRIGGER memories_set_updated_at
  BEFORE UPDATE ON public.memories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON public.conversations (user_id);
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON public.conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_user_updated_at_idx
  ON public.conversations (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_role_valid CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT messages_content_not_null CHECK (content IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS messages_user_id_idx ON public.messages (user_id);
CREATE INDEX IF NOT EXISTS messages_conversation_created_at_idx
  ON public.messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);

DROP TRIGGER IF EXISTS messages_set_updated_at ON public.messages;
CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- settings (one logical settings bag per user + key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_key_not_blank CHECK (length(trim(key)) > 0),
  CONSTRAINT settings_user_key_unique UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS settings_user_id_idx ON public.settings (user_id);
CREATE INDEX IF NOT EXISTS settings_key_idx ON public.settings (key);
CREATE INDEX IF NOT EXISTS settings_updated_at_idx ON public.settings (updated_at DESC);

DROP TRIGGER IF EXISTS settings_set_updated_at ON public.settings;
CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
