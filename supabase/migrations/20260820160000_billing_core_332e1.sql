-- #332E1 — Provider-neutral billing core (repo-only; do NOT auto-apply)
--
-- Adds:
--   public.billing_events ledger (idempotency; no raw provider payloads)
--   subscriptions.environment + last_provider_event_at (sandbox/live + staleness)
--   public.apply_billing_event(jsonb) SECURITY DEFINER transaction
--
-- OUT of scope:
--   Stripe / Play / StoreKit, checkout, live webhooks, enforcement ON.

-- ---------------------------------------------------------------------------
-- subscriptions: environment + last-event watermark
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_provider_event_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscriptions_environment_valid'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_environment_valid
      CHECK (environment IN ('sandbox', 'live'));
  END IF;
END $$;

-- Replace provider+subscription unique with provider+environment+subscription
-- so sandbox and live ids cannot collide.
DROP INDEX IF EXISTS public.subscriptions_provider_sub_unique;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_env_sub_unique
  ON public.subscriptions (provider, environment, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_user_env_status_idx
  ON public.subscriptions (user_id, environment, status);

COMMENT ON COLUMN public.subscriptions.environment IS
  '#332E1: sandbox | live — isolates test purchases from production mirrors.';

COMMENT ON COLUMN public.subscriptions.last_provider_event_at IS
  '#332E1: Watermark for rejecting stale provider events (absolute timestamp).';

-- ---------------------------------------------------------------------------
-- billing_events ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  result_code TEXT NULL,
  subscription_id UUID NULL REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  user_id UUID NULL REFERENCES public.users (id) ON DELETE SET NULL,
  plan_id TEXT NULL,
  status TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  CONSTRAINT billing_events_provider_valid CHECK (
    provider IN ('stripe', 'google_play', 'app_store', 'manual')
  ),
  CONSTRAINT billing_events_environment_valid CHECK (
    environment IN ('sandbox', 'live')
  ),
  CONSTRAINT billing_events_processing_status_valid CHECK (
    processing_status IN (
      'received',
      'applied',
      'duplicate',
      'stale',
      'rejected',
      'error'
    )
  ),
  CONSTRAINT billing_events_provider_event_id_not_blank CHECK (
    length(trim(provider_event_id)) > 0
  ),
  CONSTRAINT billing_events_event_type_not_blank CHECK (
    length(trim(event_type)) > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_events_provider_env_event_unique
  ON public.billing_events (provider, environment, provider_event_id);

CREATE INDEX IF NOT EXISTS billing_events_user_created_idx
  ON public.billing_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_events_subscription_idx
  ON public.billing_events (subscription_id)
  WHERE subscription_id IS NOT NULL;

COMMENT ON TABLE public.billing_events IS
  '#332E1: Idempotent provider-event ledger. Service-role only. No raw payloads.';

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_events FROM PUBLIC;
REVOKE ALL ON TABLE public.billing_events FROM anon;
REVOKE ALL ON TABLE public.billing_events FROM authenticated;

GRANT ALL ON TABLE public.billing_events TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic apply (service_role / SECURITY DEFINER)
-- Expects a pre-validated JSON object from server code (plan already mapped).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_billing_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT;
  v_environment TEXT;
  v_provider_event_id TEXT;
  v_event_type TEXT;
  v_event_timestamp TIMESTAMPTZ;
  v_user_id UUID;
  v_provider_customer_id TEXT;
  v_provider_subscription_id TEXT;
  v_product_id TEXT;
  v_plan_id TEXT;
  v_status TEXT;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_grace_until TIMESTAMPTZ;
  v_cancel_at_period_end BOOLEAN;
  v_event_row_id UUID;
  v_existing public.subscriptions%ROWTYPE;
  v_subscription_id UUID;
  v_user_exists BOOLEAN;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'event_required');
  END IF;

  v_provider := lower(nullif(btrim(p_event ->> 'provider'), ''));
  v_environment := lower(nullif(btrim(p_event ->> 'environment'), ''));
  v_provider_event_id := nullif(btrim(p_event ->> 'providerEventId'), '');
  v_event_type := nullif(btrim(p_event ->> 'eventType'), '');
  v_event_timestamp := NULLIF(p_event ->> 'eventTimestamp', '')::timestamptz;
  BEGIN
    v_user_id := NULLIF(btrim(p_event ->> 'userId'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'user_id_invalid');
  END;
  v_provider_customer_id := nullif(btrim(p_event ->> 'providerCustomerId'), '');
  v_provider_subscription_id := nullif(btrim(p_event ->> 'providerSubscriptionId'), '');
  v_product_id := nullif(btrim(p_event ->> 'providerProductId'), '');
  v_plan_id := lower(nullif(btrim(p_event ->> 'planId'), ''));
  v_status := lower(nullif(btrim(p_event ->> 'status'), ''));
  v_period_start := NULLIF(p_event ->> 'currentPeriodStart', '')::timestamptz;
  v_period_end := NULLIF(p_event ->> 'currentPeriodEnd', '')::timestamptz;
  v_grace_until := NULLIF(p_event ->> 'graceUntil', '')::timestamptz;
  v_cancel_at_period_end := COALESCE((p_event ->> 'cancelAtPeriodEnd')::boolean, false);

  IF v_provider IS NULL OR v_provider NOT IN ('stripe', 'google_play', 'app_store', 'manual') THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'provider_invalid');
  END IF;
  IF v_environment IS NULL OR v_environment NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'environment_invalid');
  END IF;
  IF v_provider_event_id IS NULL OR v_event_type IS NULL OR v_event_timestamp IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'event_identity_required');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'user_id_required');
  END IF;
  IF v_provider_subscription_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'provider_subscription_id_required');
  END IF;
  IF v_product_id IS NULL THEN
    RETURN jsonb_build_object('result', 'unknown_product', 'detail', 'product_id_required');
  END IF;
  IF v_plan_id IS NULL OR v_plan_id NOT IN ('base', 'pro') THEN
    RETURN jsonb_build_object('result', 'unknown_product', 'detail', 'plan_unmapped');
  END IF;
  IF v_status IS NULL OR v_status NOT IN (
    'active', 'trialing', 'grace', 'past_due', 'canceled', 'expired', 'revoked'
  ) THEN
    RETURN jsonb_build_object('result', 'invalid_event', 'detail', 'status_invalid');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id = v_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    RETURN jsonb_build_object('result', 'user_not_found', 'detail', 'public_users_missing');
  END IF;

  -- Idempotency: claim the event id first.
  INSERT INTO public.billing_events (
    provider,
    environment,
    provider_event_id,
    event_type,
    event_timestamp,
    processing_status,
    user_id,
    plan_id,
    status
  ) VALUES (
    v_provider,
    v_environment,
    v_provider_event_id,
    v_event_type,
    v_event_timestamp,
    'received',
    v_user_id,
    v_plan_id,
    v_status
  )
  ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_row_id;

  IF v_event_row_id IS NULL THEN
    RETURN jsonb_build_object(
      'result', 'duplicate',
      'detail', 'provider_event_already_seen',
      'provider', v_provider,
      'environment', v_environment,
      'providerEventId', v_provider_event_id
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.subscriptions s
  WHERE s.provider = v_provider
    AND s.environment = v_environment
    AND s.provider_subscription_id = v_provider_subscription_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.last_provider_event_at IS NOT NULL
       AND v_event_timestamp < v_existing.last_provider_event_at THEN
      UPDATE public.billing_events
      SET
        processing_status = 'stale',
        result_code = 'stale',
        subscription_id = v_existing.id,
        processed_at = NOW()
      WHERE id = v_event_row_id;

      RETURN jsonb_build_object(
        'result', 'stale',
        'subscriptionId', v_existing.id,
        'planId', v_existing.plan_id,
        'status', v_existing.status
      );
    END IF;

    -- Same watermark + identical mirror → no_change (still mark applied).
    IF v_existing.last_provider_event_at IS NOT NULL
       AND v_event_timestamp = v_existing.last_provider_event_at
       AND v_existing.plan_id = v_plan_id
       AND v_existing.status = v_status
       AND v_existing.user_id = v_user_id
       AND COALESCE(v_existing.product_id, '') = COALESCE(v_product_id, '')
       AND COALESCE(v_existing.cancel_at_period_end, false) = v_cancel_at_period_end
       AND v_existing.current_period_end IS NOT DISTINCT FROM v_period_end
       AND v_existing.grace_until IS NOT DISTINCT FROM v_grace_until THEN
      UPDATE public.billing_events
      SET
        processing_status = 'applied',
        result_code = 'no_change',
        subscription_id = v_existing.id,
        processed_at = NOW()
      WHERE id = v_event_row_id;

      RETURN jsonb_build_object(
        'result', 'no_change',
        'subscriptionId', v_existing.id,
        'planId', v_existing.plan_id,
        'status', v_existing.status
      );
    END IF;

    -- Ownership: never reassign a provider subscription to another user.
    IF v_existing.user_id <> v_user_id THEN
      UPDATE public.billing_events
      SET
        processing_status = 'rejected',
        result_code = 'user_mismatch',
        subscription_id = v_existing.id,
        processed_at = NOW()
      WHERE id = v_event_row_id;

      RETURN jsonb_build_object(
        'result', 'user_mismatch',
        'subscriptionId', v_existing.id
      );
    END IF;

    UPDATE public.subscriptions
    SET
      provider_customer_id = v_provider_customer_id,
      product_id = v_product_id,
      plan_id = v_plan_id,
      status = v_status,
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      grace_until = v_grace_until,
      cancel_at_period_end = v_cancel_at_period_end,
      last_provider_event_at = v_event_timestamp,
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_subscription_id;
  ELSE
    INSERT INTO public.subscriptions (
      user_id,
      provider,
      environment,
      provider_customer_id,
      provider_subscription_id,
      product_id,
      plan_id,
      status,
      current_period_start,
      current_period_end,
      grace_until,
      cancel_at_period_end,
      last_provider_event_at
    ) VALUES (
      v_user_id,
      v_provider,
      v_environment,
      v_provider_customer_id,
      v_provider_subscription_id,
      v_product_id,
      v_plan_id,
      v_status,
      v_period_start,
      v_period_end,
      v_grace_until,
      v_cancel_at_period_end,
      v_event_timestamp
    )
    RETURNING id INTO v_subscription_id;
  END IF;

  UPDATE public.billing_events
  SET
    processing_status = 'applied',
    result_code = CASE
      WHEN v_status = 'revoked' THEN 'revoked'
      ELSE 'applied'
    END,
    subscription_id = v_subscription_id,
    processed_at = NOW()
  WHERE id = v_event_row_id;

  RETURN jsonb_build_object(
    'result', CASE WHEN v_status = 'revoked' THEN 'revoked' ELSE 'applied' END,
    'subscriptionId', v_subscription_id,
    'planId', v_plan_id,
    'status', v_status,
    'billingEventId', v_event_row_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('result', 'duplicate', 'detail', 'unique_violation');
  WHEN OTHERS THEN
    -- Best-effort: if we claimed an event row, mark error (may be rolled back with txn).
    BEGIN
      IF v_event_row_id IS NOT NULL THEN
        UPDATE public.billing_events
        SET
          processing_status = 'error',
          result_code = 'storage_error',
          processed_at = NOW()
        WHERE id = v_event_row_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN jsonb_build_object(
      'result', 'storage_error',
      'detail', SQLERRM
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_billing_event(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_billing_event(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_billing_event(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_event(jsonb) TO service_role;

COMMENT ON FUNCTION public.apply_billing_event(jsonb) IS
  '#332E1: Atomic billing event claim + subscription upsert. Server/service-role only.';
