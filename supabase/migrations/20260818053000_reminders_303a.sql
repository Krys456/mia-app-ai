-- #303A — Reminders foundation (repo-only; do NOT auto-apply to live)
--
-- ARCHITECTURE (same as #298B Memory):
--   browser → authenticated API → JWT verify → owner-scoped service-role queries
--
-- RLS: ENABLE with zero policies (deny-by-default for direct PostgREST).
-- Service role bypasses RLS; application APIs are the ownership boundary.
--
-- OUT of this migration: recurrence engine, cron leases, push, calendar.

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  fire_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'user',
  source_ref TEXT,
  snooze_until TIMESTAMPTZ,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT reminders_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT reminders_timezone_not_blank CHECK (length(trim(timezone)) > 0),
  CONSTRAINT reminders_status_valid CHECK (
    status IN ('pending', 'delivered', 'completed', 'cancelled', 'snoozed')
  ),
  CONSTRAINT reminders_source_valid CHECK (
    source IN ('user', 'conversation', 'calendar', 'ai_suggestion')
  ),
  CONSTRAINT reminders_delivery_attempts_nonneg CHECK (delivery_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS reminders_user_fire_at_idx
  ON public.reminders (user_id, fire_at);

CREATE INDEX IF NOT EXISTS reminders_user_status_fire_at_idx
  ON public.reminders (user_id, status, fire_at);

DROP TRIGGER IF EXISTS reminders_set_updated_at ON public.reminders;
CREATE TRIGGER reminders_set_updated_at
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

-- Intentionally NO CREATE POLICY (deny-by-default PostgREST).
