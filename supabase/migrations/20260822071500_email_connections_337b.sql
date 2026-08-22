-- #337B — Gmail read-only OAuth connection (repo-only; do NOT auto-apply)
--
-- ARCHITECTURE:
--   Authenticated Supabase auth.uid() remains the ShinkAIdo owner identity.
--   Google OAuth is a SEPARATE integration; tokens never replace ShinkAIdo ownership.
--   browser → Edge (JWT verify) → service-role upsert on email_connections
--
-- RLS: ENABLE with zero policies (deny-by-default for direct PostgREST).
-- Service role bypasses RLS; Edge Functions are the ownership boundary.
--
-- Phase 1 is READ-ONLY (gmail.readonly + openid email). No send/reply/delete/
-- archive/labels/drafts. No permanent email body storage in this table.
--
-- NOTE: This table may already exist from the earlier #311 draft. Every
-- statement below is written IF NOT EXISTS / idempotent so this migration is
-- safe to apply whether or not #311 already created the table.

CREATE TABLE IF NOT EXISTS public.email_connections (
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
  last_error_code TEXT NULL,
  last_used_at TIMESTAMPTZ NULL,
  -- Pending OAuth (start → callback). Cleared after successful connect or expiry.
  oauth_pending_nonce TEXT NULL,
  oauth_pending_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ NULL,
  CONSTRAINT email_connections_provider_google_only CHECK (provider = 'google'),
  CONSTRAINT email_connections_status_valid CHECK (
    status IN (
      'pending',
      'connected',
      'error',
      'reconnect_required',
      'revoked',
      'disconnected'
    )
  ),
  CONSTRAINT email_connections_one_google_per_user UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS email_connections_user_status_idx
  ON public.email_connections (user_id, status);

CREATE INDEX IF NOT EXISTS email_connections_google_sub_idx
  ON public.email_connections (google_sub)
  WHERE google_sub IS NOT NULL;

COMMENT ON TABLE public.email_connections IS
  '#337B: Google Gmail OAuth connection metadata + encrypted tokens. Owner = auth.uid(). Service-role / Edge only. READ-ONLY. No email body storage.';

COMMENT ON COLUMN public.email_connections.access_token_enc IS
  '#337B: AES-256-GCM ciphertext (versioned). Never plaintext. Never client-readable.';

COMMENT ON COLUMN public.email_connections.refresh_token_enc IS
  '#337B: AES-256-GCM ciphertext (versioned). Never plaintext. Never client-readable.';

COMMENT ON COLUMN public.email_connections.status IS
  'pending | connected | error | reconnect_required | revoked | disconnected';

DROP TRIGGER IF EXISTS email_connections_set_updated_at ON public.email_connections;
CREATE TRIGGER email_connections_set_updated_at
  BEFORE UPDATE ON public.email_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_connections ENABLE ROW LEVEL SECURITY;

-- Intentionally NO CREATE POLICY (deny-by-default PostgREST). Zero policies.

REVOKE ALL ON TABLE public.email_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.email_connections FROM anon;
REVOKE ALL ON TABLE public.email_connections FROM authenticated;

-- See supabase/migrations/README-337B-EMAIL.md
