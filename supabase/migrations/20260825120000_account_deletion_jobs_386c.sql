-- #386C — Account deletion job ledger (repo-only; do NOT auto-apply)
--
-- Orchestration state for idempotent / retryable account erasure.
-- IMPORTANT: NO FK to public.users or auth.users — the job MUST survive
-- public.users deletion so auth.admin.deleteUser can still complete and
-- the job can be marked completed.
--
-- Does NOT implement Stripe. Does NOT delete Google Calendar/Gmail content.

CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Verified auth.uid() at request time. Not a FK (must outlive public.users).
  auth_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Last fully completed orchestrator step name (see lib/server/account-deletion.js).
  last_completed_step TEXT,
  last_error_code TEXT,
  -- Best-effort OAuth revoke diagnostics (never tokens / emails).
  calendar_revoke_status TEXT,
  gmail_revoke_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT account_deletion_jobs_status_valid CHECK (
    status IN ('pending', 'in_progress', 'completed', 'failed')
  ),
  CONSTRAINT account_deletion_jobs_calendar_revoke_valid CHECK (
    calendar_revoke_status IS NULL
    OR calendar_revoke_status IN ('ok', 'failed', 'skipped', 'wiped_local')
  ),
  CONSTRAINT account_deletion_jobs_gmail_revoke_valid CHECK (
    gmail_revoke_status IS NULL
    OR gmail_revoke_status IN ('ok', 'failed', 'skipped', 'wiped_local')
  )
);

COMMENT ON TABLE public.account_deletion_jobs IS
  '#386C: Idempotent account deletion orchestration. auth_user_id is NOT FK — survives public.users CASCADE. Service-role only.';

CREATE INDEX IF NOT EXISTS account_deletion_jobs_auth_user_created_idx
  ON public.account_deletion_jobs (auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_deletion_jobs_status_idx
  ON public.account_deletion_jobs (status)
  WHERE status IN ('pending', 'in_progress', 'failed');

-- At most one non-terminal open job per auth user (completed rows may accumulate).
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_jobs_one_open_per_user
  ON public.account_deletion_jobs (auth_user_id)
  WHERE status IN ('pending', 'in_progress', 'failed');

DROP TRIGGER IF EXISTS account_deletion_jobs_set_updated_at ON public.account_deletion_jobs;
CREATE TRIGGER account_deletion_jobs_set_updated_at
  BEFORE UPDATE ON public.account_deletion_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.account_deletion_jobs FROM anon;
REVOKE ALL ON TABLE public.account_deletion_jobs FROM authenticated;

GRANT ALL ON TABLE public.account_deletion_jobs TO service_role;
