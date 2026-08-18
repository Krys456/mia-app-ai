-- #303B — Reminder background scheduler foundation (repo-only; do NOT auto-apply)
--
-- Establishes lease/claim schema + atomic claim/release RPCs for a future
-- delivery consumer (#303C Web Push). Live recurring cron must remain OFF
-- until an explicit operator enables it (job presence + DB kill switch).
--
-- CRITICAL INVARIANTS:
--   CLAIMED != DELIVERED
--   Claim does not change status (pending/snoozed stay pending/snoozed).
--   #303A GET ?due=1 must still surface due rows while/after a lease exists.
--   Only #303A user acknowledgement currently marks delivered.
--
-- SECURITY:
--   reminders RLS remains ENABLE with zero client policies.
--   Claim RPCs are SECURITY DEFINER with fixed search_path.
--   EXECUTE revoked from PUBLIC / anon / authenticated.
--   EXECUTE granted to service_role only (postgres/owner for cron docs).
--
-- OUT of this migration: push_subscriptions, VAPID, live cron.schedule,
-- status machine changes, OpenAI, Vercel /api/cron routes.

-- ---------------------------------------------------------------------------
-- 1) Additive worker lease columns (do not alter existing statuses/fields)
-- ---------------------------------------------------------------------------

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS claim_owner TEXT NULL;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ NULL;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.reminders.claim_owner IS
  '#303B lease holder (run id). NULL = unclaimed. CLAIMED != DELIVERED.';
COMMENT ON COLUMN public.reminders.claimed_at IS
  '#303B when the current lease was acquired.';
COMMENT ON COLUMN public.reminders.claim_expires_at IS
  '#303B lease expiry; stale when <= now() and eligible for reclaim.';
COMMENT ON COLUMN public.reminders.next_attempt_at IS
  '#303B retry gate for future delivery consumer; NULL means immediately eligible.';

-- Indexes justified by claim eligibility scans (pending due / snoozed due / stale lease).
CREATE INDEX IF NOT EXISTS reminders_claim_pending_due_idx
  ON public.reminders (fire_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS reminders_claim_snoozed_due_idx
  ON public.reminders (snooze_until ASC)
  WHERE status = 'snoozed' AND snooze_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS reminders_claim_expires_at_idx
  ON public.reminders (claim_expires_at ASC)
  WHERE claim_expires_at IS NOT NULL;

-- Preserve deny-by-default PostgREST posture (idempotent).
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
-- Intentionally NO CREATE POLICY on public.reminders.

-- ---------------------------------------------------------------------------
-- 2) DB-side scheduler kill switch (NOT a Vercel env var)
-- ---------------------------------------------------------------------------
-- pg_cron cannot read Vercel env. Operational switches:
--   A) Job presence/absence (preferred primary switch)
--   B) reminder_scheduler_config.enabled (soft pause without dropping job)
-- Default enabled = false → even a mistakenly scheduled tick is a no-op.

CREATE TABLE IF NOT EXISTS public.reminder_scheduler_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

INSERT INTO public.reminder_scheduler_config (id, enabled, notes)
VALUES (
  1,
  false,
  '#303B default OFF. Set enabled=true only when a real delivery consumer (#303C) exists and Production cron is intentionally activated.'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.reminder_scheduler_config ENABLE ROW LEVEL SECURITY;
-- Intentionally NO CREATE POLICY (deny-by-default PostgREST).

DROP TRIGGER IF EXISTS reminder_scheduler_config_set_updated_at
  ON public.reminder_scheduler_config;
CREATE TRIGGER reminder_scheduler_config_set_updated_at
  BEFORE UPDATE ON public.reminder_scheduler_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Atomic claim RPC — FOR UPDATE SKIP LOCKED
-- ---------------------------------------------------------------------------
-- Does NOT mark delivered. Does NOT touch title/body in return shape beyond
-- omitting them entirely (worker receives ids + scheduling metadata only).

CREATE OR REPLACE FUNCTION public.claim_due_reminders(
  p_claim_owner TEXT,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  status TEXT,
  fire_at TIMESTAMPTZ,
  snooze_until TIMESTAMPTZ,
  timezone TEXT,
  channels TEXT[],
  delivery_attempts INTEGER,
  claim_owner TEXT,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner TEXT;
  v_limit INTEGER;
  v_lease INTEGER;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_owner := NULLIF(BTRIM(p_claim_owner), '');
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'claim_owner_required'
      USING ERRCODE = '22023';
  END IF;

  -- Batch + lease bounds (safe defaults for a future worker).
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 3600);

  RETURN QUERY
  WITH picked AS (
    SELECT r.id
    FROM public.reminders AS r
    WHERE (
        (r.status = 'pending' AND r.fire_at <= v_now)
        OR (
          r.status = 'snoozed'
          AND r.snooze_until IS NOT NULL
          AND r.snooze_until <= v_now
        )
      )
      AND (r.claim_expires_at IS NULL OR r.claim_expires_at <= v_now)
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= v_now)
    ORDER BY COALESCE(r.snooze_until, r.fire_at) ASC, r.id ASC
    FOR UPDATE OF r SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.reminders AS r
    SET
      claim_owner = v_owner,
      claimed_at = v_now,
      claim_expires_at = v_now + make_interval(secs => v_lease)
      -- status intentionally unchanged (CLAIMED != DELIVERED)
    FROM picked AS p
    WHERE r.id = p.id
    RETURNING
      r.id,
      r.user_id,
      r.status,
      r.fire_at,
      r.snooze_until,
      r.timezone,
      r.channels,
      r.delivery_attempts,
      r.claim_owner,
      r.claimed_at,
      r.claim_expires_at,
      r.next_attempt_at
  )
  SELECT
    u.id,
    u.user_id,
    u.status,
    u.fire_at,
    u.snooze_until,
    u.timezone,
    u.channels,
    u.delivery_attempts,
    u.claim_owner,
    u.claimed_at,
    u.claim_expires_at,
    u.next_attempt_at
  FROM updated AS u;
END;
$$;

COMMENT ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) IS
  '#303B atomic due-reminder claim (SKIP LOCKED). Does not mark delivered. Not for anon/authenticated clients.';

-- ---------------------------------------------------------------------------
-- 4) Release / retry lease (foundation for #303C; no Push semantics invented)
-- ---------------------------------------------------------------------------
-- p_outcome:
--   'release' — clear lease only (status untouched)
--   'retry'   — clear lease, optionally bump delivery_attempts, set last_error_code
--               and next_attempt_at for a future consumer
--
-- Owner match OR stale/expired lease may release (deterministic recovery).

CREATE OR REPLACE FUNCTION public.release_reminder_claim(
  p_reminder_id UUID,
  p_claim_owner TEXT,
  p_outcome TEXT DEFAULT 'release',
  p_error_code TEXT DEFAULT NULL,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL,
  p_increment_attempt BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner TEXT;
  v_outcome TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_updated UUID;
BEGIN
  v_owner := NULLIF(BTRIM(p_claim_owner), '');
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'claim_owner_required'
      USING ERRCODE = '22023';
  END IF;

  v_outcome := LOWER(COALESCE(NULLIF(BTRIM(p_outcome), ''), 'release'));
  IF v_outcome NOT IN ('release', 'retry') THEN
    RAISE EXCEPTION 'invalid_claim_outcome'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.reminders AS r
  SET
    claim_owner = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    last_error_code = CASE
      WHEN v_outcome = 'retry' THEN NULLIF(BTRIM(COALESCE(p_error_code, '')), '')
      ELSE r.last_error_code
    END,
    delivery_attempts = CASE
      WHEN v_outcome = 'retry' AND COALESCE(p_increment_attempt, false)
        THEN r.delivery_attempts + 1
      ELSE r.delivery_attempts
    END,
    next_attempt_at = CASE
      WHEN v_outcome = 'retry' THEN p_next_attempt_at
      ELSE r.next_attempt_at
    END
  WHERE r.id = p_reminder_id
    AND (
      r.claim_owner = v_owner
      OR r.claim_expires_at IS NULL
      OR r.claim_expires_at <= v_now
    )
  RETURNING r.id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.release_reminder_claim(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) IS
  '#303B lease release/retry foundation. Never marks delivered. Not for anon/authenticated clients.';

-- ---------------------------------------------------------------------------
-- 5) Cron-facing tick wrapper (kill-switch gated; do NOT schedule live yet)
-- ---------------------------------------------------------------------------
-- Future Supabase Cron should call THIS function, not claim_due_reminders
-- directly, so enabled=false prevents claim churn even if a job exists.

CREATE OR REPLACE FUNCTION public.run_reminder_scheduler_tick(
  p_claim_owner TEXT DEFAULT 'pg_cron',
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  status TEXT,
  fire_at TIMESTAMPTZ,
  snooze_until TIMESTAMPTZ,
  timezone TEXT,
  channels TEXT[],
  delivery_attempts INTEGER,
  claim_owner TEXT,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reminder_scheduler_config AS c
    WHERE c.id = 1 AND c.enabled IS TRUE
  ) THEN
    -- Kill switch OFF: return zero rows (no claim churn).
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.claim_due_reminders(p_claim_owner, p_limit, p_lease_seconds);
END;
$$;

COMMENT ON FUNCTION public.run_reminder_scheduler_tick(TEXT, INTEGER, INTEGER) IS
  '#303B cron tick wrapper. Gated by reminder_scheduler_config.enabled (default false). Do not schedule until #303C.';

-- ---------------------------------------------------------------------------
-- 6) Privileges — claim must not be a client bypass
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.release_reminder_claim(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reminder_claim(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.release_reminder_claim(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_reminder_claim(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.run_reminder_scheduler_tick(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_reminder_scheduler_tick(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.run_reminder_scheduler_tick(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_reminder_scheduler_tick(TEXT, INTEGER, INTEGER) TO service_role;

-- Table grants: no direct client DML. Service role bypasses RLS.
REVOKE ALL ON TABLE public.reminder_scheduler_config FROM PUBLIC;
REVOKE ALL ON TABLE public.reminder_scheduler_config FROM anon;
REVOKE ALL ON TABLE public.reminder_scheduler_config FROM authenticated;

-- ---------------------------------------------------------------------------
-- LIVE CRON: intentionally NOT scheduled in this migration.
-- See supabase/migrations/README-303B-SCHEDULER.md for the future job SQL.
-- ---------------------------------------------------------------------------
