# #332E1 — Provider-neutral billing core (manual apply)

Repo-only. **Do NOT auto-apply** from CI.

## What it adds

- `public.billing_events` ledger (idempotency; **no** raw provider payloads)
- `subscriptions.environment` (`sandbox` | `live`, default `live`)
- `subscriptions.last_provider_event_at` (stale-event watermark)
- Unique key: `(provider, environment, provider_subscription_id)`
- `public.apply_billing_event(jsonb)` SECURITY DEFINER (atomic claim + upsert)
- RLS: deny-by-default for anon/authenticated; service_role only

## Apply (operator)

1. Open Supabase SQL Editor (Preview and Production separately).
2. Paste and run `supabase/migrations/20260820160000_billing_core_332e1.sql`.
3. Confirm tables/columns/function exist.
4. Confirm RLS ON and no permissive policies on `billing_events`.

## Env

No new env vars.

Keep `ENTITLEMENT_ENFORCEMENT_ENABLED` **unset/false**.

## Server contract

1. Future adapters: **verify** provider signature/receipt/API → **normalize** → `applyBillingEvent`.
2. `planId` is always derived from `mapProviderProductToPlanId` (never trusted from client/provider raw).
3. No public HTTP route calls `applyBillingEvent` in #332E1 (no webhooks yet).
4. Prefer one future consolidated webhook route (Hobby ≤12 serverless functions).

## Retention

`billing_events` may need archival later. Out of scope for #332E1.

## Rollback (manual, pre-billing only)

```sql
DROP FUNCTION IF EXISTS public.apply_billing_event(jsonb);
DROP TABLE IF EXISTS public.billing_events;
-- Optional: drop added columns only if unused
-- ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS last_provider_event_at;
-- ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS environment;
```
