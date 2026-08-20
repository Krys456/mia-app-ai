-- #332D — Subscription persistence + verified plan lookup (repo-only; do NOT auto-apply)
--
-- ARCHITECTURE:
--   Server/service-role is the only writer and the only reader for authorization.
--   No Free rows: absence of a valid paid subscription ⇒ planId free.
--   Provider-agnostic: stripe | google_play | app_store | manual (future billing).
--   Client must NEVER insert/update plan_id or status (RLS deny-by-default).
--
-- OUT of this migration / #332D:
--   Stripe / Play / StoreKit checkout, webhooks, purchase restore UI,
--   ENTITLEMENT_ENFORCEMENT_ENABLED activation.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  -- Provider-agnostic source. Not a live billing integration yet.
  provider TEXT NOT NULL,
  provider_customer_id TEXT NULL,
  provider_subscription_id TEXT NULL,
  product_id TEXT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ NULL,
  current_period_end TIMESTAMPTZ NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  grace_until TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_provider_valid CHECK (
    provider IN ('stripe', 'google_play', 'app_store', 'manual')
  ),
  CONSTRAINT subscriptions_plan_id_valid CHECK (
    plan_id IN ('base', 'pro')
  ),
  CONSTRAINT subscriptions_status_valid CHECK (
    status IN (
      'active',
      'trialing',
      'grace',
      'past_due',
      'canceled',
      'expired',
      'revoked'
    )
  ),
  CONSTRAINT subscriptions_provider_ids_not_blank CHECK (
    (provider_customer_id IS NULL OR length(trim(provider_customer_id)) > 0)
    AND (provider_subscription_id IS NULL OR length(trim(provider_subscription_id)) > 0)
    AND (product_id IS NULL OR length(trim(product_id)) > 0)
  )
);

-- Multiple provider rows per user allowed (web + store restore).
-- Provider subscription id unique when present (idempotent webhook upserts later).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_sub_unique
  ON public.subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx
  ON public.subscriptions (user_id, status);

CREATE INDEX IF NOT EXISTS subscriptions_user_period_end_idx
  ON public.subscriptions (user_id, current_period_end);

CREATE INDEX IF NOT EXISTS subscriptions_provider_customer_idx
  ON public.subscriptions (provider, provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

COMMENT ON TABLE public.subscriptions IS
  '#332D: Normalized app-owned subscription state. Service-role only. No Free rows.';

COMMENT ON COLUMN public.subscriptions.plan_id IS
  'Paid plan only: base | pro. Free is absence of a valid paid row.';

COMMENT ON COLUMN public.subscriptions.status IS
  'active | trialing | grace | past_due | canceled | expired | revoked';

COMMENT ON COLUMN public.subscriptions.provider_subscription_id IS
  'Provider purchase/subscription id for idempotent updates / restore. Never a secret.';

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Intentionally NO CREATE POLICY (deny-by-default PostgREST).
-- Service role bypasses RLS for server APIs.

REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.subscriptions FROM anon;
REVOKE ALL ON TABLE public.subscriptions FROM authenticated;

GRANT ALL ON TABLE public.subscriptions TO service_role;
