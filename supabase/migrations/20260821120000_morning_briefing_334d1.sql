-- #334D1 — Morning briefing schedule metadata (repo-only; do NOT auto-apply)
--
-- Additive. Does NOT enable pg_cron. Does NOT set PUSH_ENABLED.
-- Does NOT store generated briefing / calendar / reminder / weather content.
-- One active schedule row per user (user_id PK).
--
-- Rollback sketch (manual):
--   DROP FUNCTION IF EXISTS public.claim_due_morning_briefings(TIMESTAMPTZ, INTEGER, INTEGER, TEXT);
--   DROP FUNCTION IF EXISTS public.clear_morning_briefing_delivery_claim(UUID, DATE);
--   DROP TABLE IF EXISTS public.morning_briefing_schedules;

-- ---------------------------------------------------------------------------
-- 1) morning_briefing_schedules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.morning_briefing_schedules (
  user_id UUID PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Local wall-clock HH:mm (24h). Interpreted in `timezone` (IANA), not fixed UTC.
  local_time TEXT NOT NULL DEFAULT '08:00',
  -- ISO weekday numbers: 1=Monday … 7=Sunday (ISO-8601).
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::SMALLINT[],
  timezone TEXT NOT NULL DEFAULT 'UTC',
  -- Idempotency: YYYY-MM-DD in the schedule timezone when a push was successfully claimed/sent.
  last_delivered_local_date DATE NULL,
  -- Short lease while a worker is sending (CLAIMED ≠ delivered until commit).
  dispatch_claim_owner TEXT NULL,
  dispatch_claim_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT morning_briefing_local_time_hhmm CHECK (local_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT morning_briefing_timezone_not_blank CHECK (length(trim(timezone)) > 0),
  CONSTRAINT morning_briefing_days_nonempty CHECK (cardinality(days_of_week) >= 1),
  CONSTRAINT morning_briefing_days_valid CHECK (
    days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
  )
);

COMMENT ON TABLE public.morning_briefing_schedules IS
  '#334D1: user-owned proactive morning briefing schedule (metadata only).';
COMMENT ON COLUMN public.morning_briefing_schedules.local_time IS
  '#334D1: wall-clock HH:mm in schedule.timezone (DST-safe; not stored as UTC offset).';
COMMENT ON COLUMN public.morning_briefing_schedules.last_delivered_local_date IS
  '#334D1: local calendar date of last successful morning push claim. NULL = never delivered.';

CREATE INDEX IF NOT EXISTS morning_briefing_schedules_enabled_idx
  ON public.morning_briefing_schedules (enabled)
  WHERE enabled = TRUE;

DROP TRIGGER IF EXISTS morning_briefing_schedules_set_updated_at
  ON public.morning_briefing_schedules;
CREATE TRIGGER morning_briefing_schedules_set_updated_at
  BEFORE UPDATE ON public.morning_briefing_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.morning_briefing_schedules ENABLE ROW LEVEL SECURITY;
-- Intentionally NO CREATE POLICY (deny-by-default PostgREST).
-- Access via authenticated Vercel APIs (service role) + Edge worker (service role).

REVOKE ALL ON TABLE public.morning_briefing_schedules FROM PUBLIC;
REVOKE ALL ON TABLE public.morning_briefing_schedules FROM anon;
REVOKE ALL ON TABLE public.morning_briefing_schedules FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2) claim_due_morning_briefings — atomic once-per-local-date lease
-- ---------------------------------------------------------------------------
-- Finds enabled schedules whose local wall-clock is within
-- [local_time, local_time + p_window_minutes), weekday matches, and
-- last_delivered_local_date is not today (local). Sets a short claim lease.
-- Worker must clear claim OR finalize last_delivered_local_date.

CREATE OR REPLACE FUNCTION public.claim_due_morning_briefings(
  p_now TIMESTAMPTZ DEFAULT NOW(),
  p_window_minutes INTEGER DEFAULT 10,
  p_limit INTEGER DEFAULT 50,
  p_claim_owner TEXT DEFAULT 'morning-briefing-dispatch'
)
RETURNS TABLE (
  user_id UUID,
  local_time TEXT,
  days_of_week SMALLINT[],
  timezone TEXT,
  local_date DATE,
  local_hhmm TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner TEXT;
  v_limit INTEGER;
  v_window INTEGER;
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
BEGIN
  v_owner := NULLIF(BTRIM(p_claim_owner), '');
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'claim_owner_required' USING ERRCODE = '22023';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_window := LEAST(GREATEST(COALESCE(p_window_minutes, 10), 1), 30);

  RETURN QUERY
  WITH picked AS (
    SELECT s.user_id
    FROM public.morning_briefing_schedules AS s
    WHERE s.enabled = TRUE
      AND (s.dispatch_claim_expires_at IS NULL OR s.dispatch_claim_expires_at <= v_now)
      AND (
        s.last_delivered_local_date IS NULL
        OR s.last_delivered_local_date
          IS DISTINCT FROM ((v_now AT TIME ZONE s.timezone)::date)
      )
      AND EXTRACT(ISODOW FROM (v_now AT TIME ZONE s.timezone))::SMALLINT
        = ANY (s.days_of_week)
      AND (
        (SPLIT_PART(to_char(v_now AT TIME ZONE s.timezone, 'HH24:MI'), ':', 1)::INT * 60)
        + SPLIT_PART(to_char(v_now AT TIME ZONE s.timezone, 'HH24:MI'), ':', 2)::INT
      ) >= (
        (SPLIT_PART(s.local_time, ':', 1)::INT * 60)
        + SPLIT_PART(s.local_time, ':', 2)::INT
      )
      AND (
        (SPLIT_PART(to_char(v_now AT TIME ZONE s.timezone, 'HH24:MI'), ':', 1)::INT * 60)
        + SPLIT_PART(to_char(v_now AT TIME ZONE s.timezone, 'HH24:MI'), ':', 2)::INT
      ) < (
        (SPLIT_PART(s.local_time, ':', 1)::INT * 60)
        + SPLIT_PART(s.local_time, ':', 2)::INT
        + v_window
      )
    ORDER BY s.user_id ASC
    FOR UPDATE OF s SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.morning_briefing_schedules AS s
    SET
      dispatch_claim_owner = v_owner,
      dispatch_claim_expires_at = v_now + INTERVAL '2 minutes'
    FROM picked AS p
    WHERE s.user_id = p.user_id
    RETURNING
      s.user_id,
      s.local_time,
      s.days_of_week,
      s.timezone,
      ((v_now AT TIME ZONE s.timezone)::date) AS loc_date,
      to_char(v_now AT TIME ZONE s.timezone, 'HH24:MI') AS loc_hhmm
  )
  SELECT
    u.user_id,
    u.local_time,
    u.days_of_week,
    u.timezone,
    u.loc_date,
    u.loc_hhmm
  FROM updated AS u;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_morning_briefings(TIMESTAMPTZ, INTEGER, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_morning_briefings(TIMESTAMPTZ, INTEGER, INTEGER, TEXT)
  FROM anon;
REVOKE ALL ON FUNCTION public.claim_due_morning_briefings(TIMESTAMPTZ, INTEGER, INTEGER, TEXT)
  FROM authenticated;

-- Finalize successful delivery for a claimed local date.
CREATE OR REPLACE FUNCTION public.finalize_morning_briefing_delivery(
  p_user_id UUID,
  p_local_date DATE,
  p_claim_owner TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR p_local_date IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.morning_briefing_schedules
  SET
    last_delivered_local_date = p_local_date,
    dispatch_claim_owner = NULL,
    dispatch_claim_expires_at = NULL
  WHERE user_id = p_user_id
    AND dispatch_claim_owner IS NOT DISTINCT FROM NULLIF(BTRIM(p_claim_owner), '')
  ;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_morning_briefing_delivery(UUID, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_morning_briefing_delivery(UUID, DATE, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_morning_briefing_delivery(UUID, DATE, TEXT) FROM authenticated;

-- Release claim without marking delivered (no push endpoints / all failures).
CREATE OR REPLACE FUNCTION public.clear_morning_briefing_delivery_claim(
  p_user_id UUID,
  p_claim_owner TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  UPDATE public.morning_briefing_schedules
  SET
    dispatch_claim_owner = NULL,
    dispatch_claim_expires_at = NULL
  WHERE user_id = p_user_id
    AND dispatch_claim_owner IS NOT DISTINCT FROM NULLIF(BTRIM(p_claim_owner), '')
  ;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_morning_briefing_delivery_claim(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_morning_briefing_delivery_claim(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.clear_morning_briefing_delivery_claim(UUID, TEXT) FROM authenticated;
