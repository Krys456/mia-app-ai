# #332D — Subscriptions migration (manual apply)

Repo-only. **Do NOT auto-apply** from CI or this agent.

## What it adds

- Table `public.subscriptions` (paid Base/Pro state only; Free = no valid row)
- Indexes for user lookup + provider idempotency
- RLS enabled with **zero policies** (deny-by-default for anon/authenticated)
- `service_role` GRANT only

## Apply (operator)

1. Open Supabase SQL Editor for the target project (Preview vs Production separately).
2. Paste and run `supabase/migrations/20260820143000_subscriptions_332d.sql`.
3. Confirm: `\d public.subscriptions` / Table Editor shows the table.
4. Confirm RLS is ON and no permissive policies exist for anon/authenticated.

## Env

No new env vars for #332D.

Keep `ENTITLEMENT_ENFORCEMENT_ENABLED` **unset/false** in Preview and Production.

## Vercel Hobby function budget

Vite `api/` routes map 1:1 to serverless functions. Hobby allows **12** per deployment.
`.vercelignore` excludes `api/*.test.mjs` probes so `GET /api/subscription` fits under the ceiling.

## Rollback (manual)

```sql
DROP TABLE IF EXISTS public.subscriptions;
```

Only if no production paid rows exist yet (expected pre-billing).
