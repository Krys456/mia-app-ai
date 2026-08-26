-- #387C — Worker alert incident state (dedupe / open-close)
--
-- One row per proactive worker. Operational metadata ONLY.
-- Service-role / Edge ownership. Ordinary clients must not mutate rows.
--
-- Apply to Preview first. Production cutover is a separate explicit step.
-- Does NOT modify worker_heartbeats or existing Reminder/Morning cron jobs.

CREATE TABLE IF NOT EXISTS public.worker_alert_states (
  worker_name TEXT PRIMARY KEY,
  current_health TEXT,
  incident_open BOOLEAN NOT NULL DEFAULT FALSE,
  incident_started_at TIMESTAMPTZ,
  last_alerted_at TIMESTAMPTZ,
  last_recovered_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  last_run_id TEXT,
  -- Delivery bookkeeping (retry without duplicate open incidents)
  last_delivery_status TEXT,
  last_delivery_error_code TEXT,
  pending_alert_kind TEXT,
  -- First time we observed continuous "unknown" while expected to run
  unknown_since TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_alert_states_name_stable CHECK (
    worker_name IN (
      'reminder-push-dispatch',
      'morning-briefing-dispatch'
    )
  ),
  CONSTRAINT worker_alert_states_health_valid CHECK (
    current_health IS NULL
    OR current_health IN ('healthy', 'stale', 'failed', 'disabled', 'unknown')
  ),
  CONSTRAINT worker_alert_states_delivery_valid CHECK (
    last_delivery_status IS NULL
    OR last_delivery_status IN ('sent', 'failed', 'skipped', 'noop')
  ),
  CONSTRAINT worker_alert_states_pending_valid CHECK (
    pending_alert_kind IS NULL
    OR pending_alert_kind IN ('open', 'recovery')
  )
);

COMMENT ON TABLE public.worker_alert_states IS
  '#387C: Worker alert incident dedupe state. No user IDs, content, endpoints, tokens, or secrets. Service-role only.';

COMMENT ON COLUMN public.worker_alert_states.pending_alert_kind IS
  'open|recovery pending when sink delivery failed; retry without opening a duplicate incident.';

DROP TRIGGER IF EXISTS worker_alert_states_set_updated_at ON public.worker_alert_states;
CREATE TRIGGER worker_alert_states_set_updated_at
  BEFORE UPDATE ON public.worker_alert_states
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.worker_alert_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_alert_states FROM PUBLIC;
REVOKE ALL ON TABLE public.worker_alert_states FROM anon;
REVOKE ALL ON TABLE public.worker_alert_states FROM authenticated;

GRANT ALL ON TABLE public.worker_alert_states TO service_role;
