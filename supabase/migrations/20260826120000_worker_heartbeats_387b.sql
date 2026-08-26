-- #387B — Worker heartbeats (current health state only; no historical event log)
--
-- One row per proactive Production worker.
-- Operational metadata ONLY — never user content, tokens, endpoints, or prompts.
-- Service-role / Edge ownership. Ordinary clients must not mutate rows.
--
-- Apply to Preview first. Production cutover is a separate explicit step.

CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  last_started_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_status TEXT,
  last_duration_ms INTEGER,
  last_run_id TEXT,
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_heartbeats_status_valid CHECK (
    last_status IS NULL
    OR last_status IN ('running', 'success', 'failure', 'disabled')
  ),
  CONSTRAINT worker_heartbeats_duration_nonneg CHECK (
    last_duration_ms IS NULL OR last_duration_ms >= 0
  ),
  CONSTRAINT worker_heartbeats_name_stable CHECK (
    worker_name IN (
      'reminder-push-dispatch',
      'morning-briefing-dispatch'
    )
  )
);

COMMENT ON TABLE public.worker_heartbeats IS
  '#387B: Current worker health only. No user IDs, titles, briefing content, endpoints, tokens, or secrets. Service-role only.';

COMMENT ON COLUMN public.worker_heartbeats.worker_name IS
  'Stable worker identity (not derived from user input).';

COMMENT ON COLUMN public.worker_heartbeats.last_run_id IS
  'Edge runId for correlation with Edge logs (#298C). Not a Vercel requestId.';

COMMENT ON COLUMN public.worker_heartbeats.last_error_code IS
  'SAFE machine-readable code only (no stack traces / payloads).';

DROP TRIGGER IF EXISTS worker_heartbeats_set_updated_at ON public.worker_heartbeats;
CREATE TRIGGER worker_heartbeats_set_updated_at
  BEFORE UPDATE ON public.worker_heartbeats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_heartbeats FROM PUBLIC;
REVOKE ALL ON TABLE public.worker_heartbeats FROM anon;
REVOKE ALL ON TABLE public.worker_heartbeats FROM authenticated;

GRANT ALL ON TABLE public.worker_heartbeats TO service_role;
