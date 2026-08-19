-- #303C — Web Push subscriptions + push_sent_at (repo-only; do NOT auto-apply)
--
-- Additive only. Does NOT enable cron. Does NOT set reminder_scheduler_config.enabled.
-- CLAIMED != PUSH SENT != DELIVERED
-- delivered_at remains user acknowledgement (#303A).
--
-- Updates claim_due_reminders so successfully pushed rows (push_sent_at set)
-- are not re-claimed every minute. Retryable failures leave push_sent_at NULL
-- and use next_attempt_at (#303B).

-- ---------------------------------------------------------------------------
-- 1) Reminder push bookkeeping (does not change delivered_at semantics)
-- ---------------------------------------------------------------------------

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.reminders.push_sent_at IS
  '#303C: first successful Web Push accept for this due cycle. NULL = never successfully pushed. NOT user acknowledgement (see delivered_at).';

-- ---------------------------------------------------------------------------
-- 2) push_subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  last_error_code TEXT,
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_not_blank CHECK (length(trim(endpoint)) > 0),
  CONSTRAINT push_subscriptions_p256dh_not_blank CHECK (length(trim(p256dh)) > 0),
  CONSTRAINT push_subscriptions_auth_not_blank CHECK (length(trim(auth)) > 0)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_active_idx
  ON public.push_subscriptions (user_id)
  WHERE disabled_at IS NULL;

DROP TRIGGER IF EXISTS push_subscriptions_set_updated_at ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Intentionally NO CREATE POLICY (deny-by-default PostgREST).

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.push_subscriptions FROM anon;
REVOKE ALL ON TABLE public.push_subscriptions FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3) claim_due_reminders — exclude already-pushed rows (prevent minute spam)
-- ---------------------------------------------------------------------------

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
      -- #303C: successful push already sent → do not re-claim every tick
      AND r.push_sent_at IS NULL
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
  '#303B/#303C atomic due-reminder claim (SKIP LOCKED). Excludes push_sent_at IS NOT NULL. Does not mark delivered.';

-- Privileges re-asserted (idempotent with #303B posture).
REVOKE ALL ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_reminders(TEXT, INTEGER, INTEGER) TO service_role;

-- LIVE CRON: intentionally NOT scheduled in this migration.
-- See supabase/migrations/README-303C-PUSH.md
