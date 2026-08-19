-- #304A1 — Google Calendar OAuth connection foundation (repo-only; do NOT auto-apply)
--
-- ARCHITECTURE:
--   Anonymous Supabase auth.uid() remains the ShinkAIdo owner identity.
--   Google OAuth is a SEPARATE integration; tokens never replace anon ownership.
--   browser → Edge (JWT verify) → service-role upsert on calendar_connections
--
-- RLS: ENABLE with zero policies (deny-by-default for direct PostgREST).
-- Service role bypasses RLS; Edge Functions are the ownership boundary.
--
-- OUT of this migration / #304A1:
--   Calendar event reading, chat Calendar Q&A, write scopes, reminders-from-calendar,
--   proactive calendar behavior.

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  google_sub TEXT NULL,
  account_email TEXT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  access_token_enc TEXT NULL,
  refresh_token_enc TEXT NULL,
  token_expires_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  selected_calendar_ids JSONB NULL,
  last_error_code TEXT NULL,
  last_used_at TIMESTAMPTZ NULL,
  -- Pending OAuth (start → callback). Cleared after successful connect or expiry.
  oauth_pending_nonce TEXT NULL,
  oauth_pending_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ NULL,
  CONSTRAINT calendar_connections_provider_google_only CHECK (provider = 'google'),
  CONSTRAINT calendar_connections_status_valid CHECK (
    status IN (
      'pending',
      'connected',
      'error',
      'reconnect_required',
      'revoked',
      'disconnected'
    )
  ),
  CONSTRAINT calendar_connections_one_google_per_user UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS calendar_connections_user_status_idx
  ON public.calendar_connections (user_id, status);

CREATE INDEX IF NOT EXISTS calendar_connections_google_sub_idx
  ON public.calendar_connections (google_sub)
  WHERE google_sub IS NOT NULL;

COMMENT ON TABLE public.calendar_connections IS
  '#304A1: Google Calendar OAuth connection metadata + encrypted tokens. Owner = anonymous auth.uid(). Service-role / Edge only.';

COMMENT ON COLUMN public.calendar_connections.access_token_enc IS
  '#304A1: AES-256-GCM ciphertext (versioned). Never plaintext. Never client-readable.';

COMMENT ON COLUMN public.calendar_connections.refresh_token_enc IS
  '#304A1: AES-256-GCM ciphertext (versioned). Never plaintext. Never client-readable.';

COMMENT ON COLUMN public.calendar_connections.status IS
  'pending | connected | error | reconnect_required | revoked | disconnected';

DROP TRIGGER IF EXISTS calendar_connections_set_updated_at ON public.calendar_connections;
CREATE TRIGGER calendar_connections_set_updated_at
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

-- Intentionally NO CREATE POLICY (deny-by-default PostgREST).

REVOKE ALL ON TABLE public.calendar_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.calendar_connections FROM anon;
REVOKE ALL ON TABLE public.calendar_connections FROM authenticated;

-- See supabase/migrations/README-304A1-CALENDAR.md
