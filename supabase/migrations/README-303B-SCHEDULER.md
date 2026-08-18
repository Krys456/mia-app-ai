# #303B — Reminder scheduler foundation (DO NOT auto-apply / DO NOT enable cron)

Migration file:

`supabase/migrations/20260818100000_reminders_scheduler_303b.sql`

## Purpose

Server-side **lease/claim foundation** for a future delivery consumer (#303C Web Push).

This PR ships schema + RPCs + interfaces + tests + documentation.

**Live automatic recurring execution must remain OFF** until explicitly enabled for #303C (or another real delivery consumer). Claiming due rows with no delivery adapter creates meaningless lease churn.

## Schema change summary

Additive columns on `public.reminders`:

| Column | Type | Notes |
|--------|------|--------|
| `claim_owner` | `TEXT NULL` | Lease holder / run id |
| `claimed_at` | `TIMESTAMPTZ NULL` | Lease acquired at |
| `claim_expires_at` | `TIMESTAMPTZ NULL` | Active when `> now()`; stale when `<= now()` |
| `next_attempt_at` | `TIMESTAMPTZ NULL` | Retry gate; NULL = immediately eligible |

Also creates `public.reminder_scheduler_config` (singleton `id=1`, `enabled boolean DEFAULT false`).

**Unchanged:** statuses, RLS ENABLE, zero client policies on `reminders`, #303A semantics, `delivery_attempts` / `last_error_code` columns (reuse for #303C).

## Indexes

- `reminders_claim_pending_due_idx` — `(fire_at)` WHERE `status = 'pending'`
- `reminders_claim_snoozed_due_idx` — `(snooze_until)` WHERE `status = 'snoozed' AND snooze_until IS NOT NULL`
- `reminders_claim_expires_at_idx` — `(claim_expires_at)` WHERE `claim_expires_at IS NOT NULL`

## RPC architecture

### `claim_due_reminders(p_claim_owner, p_limit, p_lease_seconds)`

- `SECURITY DEFINER` + `SET search_path = public`
- `SELECT … FOR UPDATE SKIP LOCKED` then assign lease fields
- Eligibility: due pending (`fire_at <= now()`), due snoozed (`snooze_until <= now()`), no terminal status, no active lease, `next_attempt_at` null or due
- Time source: PostgreSQL `now()` (no timezone conversion in worker)
- **Does not change `status`** — CLAIMED ≠ DELIVERED
- Returns: id, user_id, status, fire_at, snooze_until, timezone, channels, delivery_attempts, claim_*, next_attempt_at (**no title/body**)

### `release_reminder_claim(...)`

- Clears lease fields
- `outcome='retry'`: optional `delivery_attempts++`, `last_error_code`, `next_attempt_at`
- Allows matching owner **or** stale/expired lease

### `run_reminder_scheduler_tick(...)`

- Cron-facing wrapper
- Returns **zero rows** unless `reminder_scheduler_config.enabled = true`
- Default enabled = **false**

## Function privileges

For each of the three functions:

- `REVOKE ALL … FROM PUBLIC`
- `REVOKE ALL … FROM anon`
- `REVOKE ALL … FROM authenticated`
- `GRANT EXECUTE … TO service_role`

Ordinary browser JWT / PostgREST clients **must not** claim global reminder work.

Who may execute:

- **service_role** (server APIs / future delivery worker via service role)
- **postgres / supabase_admin** (owner; for future Production `pg_cron` only)

## CLAIMED ≠ DELIVERED

| Event | Status change? |
|-------|----------------|
| Scheduler tick | No |
| Row becomes due | No |
| RPC returns row | No |
| Lease acquired | No |
| User acknowledges in-app (#303A) | Yes → `delivered` |

`GET /api/reminders?due=1` **ignores** lease columns and continues to surface due pending/snoozed rows.

## Cancellation / edit races (predictable behavior)

| Race | Behavior |
|------|----------|
| Cancel before claim | Not eligible (cancelled) |
| Cancel while lease exists | Owner API clears lease fields; cancelled excluded from claim and due |
| Edit `fire_at` to future while leased | No longer due → excluded from claim and `?due=1` until due again; stale lease reclaimable after expiry |
| Complete while leased | Lease cleared; completed excluded |
| Snooze to future while leased | Status `snoozed` + future `snooze_until` → excluded from claim/due until snooze due |

Terminal/cancelled reminders are never actionable merely because of stale worker metadata.

## Kill switch (NOT a Vercel env)

`pg_cron` **cannot** read Vercel environment variables. Do **not** invent `REMINDER_SCHEDULER_ENABLED` as a misleading DB/Vercel flag contract.

Operational switches:

1. **Primary:** job presence/absence — do not `cron.schedule` until #303C
2. **Soft pause:** `UPDATE reminder_scheduler_config SET enabled = false WHERE id = 1`

## Future Supabase Cron design (DO NOT ENABLE IN #303B)

Intended cadence: every **30 seconds** (personal reminders; not Vercel Hobby daily cron).

Exact future SQL (Production Supabase project only):

```sql
-- ONLY after #303C delivery consumer exists AND operator approval.
UPDATE public.reminder_scheduler_config
SET enabled = true, notes = 'enabled for #303C production push worker'
WHERE id = 1;

SELECT cron.schedule(
  'reminders-claim-tick',
  '30 seconds',
  $$SELECT id FROM public.run_reminder_scheduler_tick('pg_cron-prod', 25, 120);$$
);
```

Pause / remove:

```sql
UPDATE public.reminder_scheduler_config SET enabled = false WHERE id = 1;
-- and/or:
SELECT cron.unschedule('reminders-claim-tick');
-- or: SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reminders-claim-tick';
```

Verify runs:

```sql
SELECT * FROM cron.job WHERE jobname = 'reminders-claim-tick';
SELECT * FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'reminders-claim-tick')
ORDER BY start_time DESC
LIMIT 20;
```

### Preview / Production isolation

- Prefer the cron job existing **only** in the Production Supabase project.
- If Preview and Production share one Supabase project: there must be **exactly one** scheduler job — never schedule from Preview deploys.
- Do not model Vercel env vars inside `pg_cron`.

## No new Vercel function

Deployed function count must remain **8**. Do not add `/api/cron/reminders`. Do not re-enable `api/memory-test` deploy.

## Manual apply (operator — only after explicit approval)

1. Review `20260818100000_reminders_scheduler_303b.sql`.
2. In Supabase SQL Editor (target project), run the migration contents.
3. **Do not** run `cron.schedule` yet.
4. Verification SQL — see below.
5. Confirm `reminder_scheduler_config.enabled = false`.

## Verification SQL

```sql
-- Lease columns present
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reminders'
  AND column_name IN ('claim_owner', 'claimed_at', 'claim_expires_at', 'next_attempt_at')
ORDER BY column_name;

-- RLS still on; zero policies on reminders
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('reminders', 'reminder_scheduler_config');

SELECT * FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('reminders', 'reminder_scheduler_config');

-- Kill switch default OFF
SELECT id, enabled FROM public.reminder_scheduler_config WHERE id = 1;

-- Privilege posture (anon/authenticated must not execute)
SELECT p.proname, r.rolname AS grantee, has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN ('claim_due_reminders', 'release_reminder_claim', 'run_reminder_scheduler_tick')
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY p.proname, r.rolname;

-- Tick is idle while disabled
SELECT * FROM public.run_reminder_scheduler_tick('verify-off', 5, 60);

-- No cron job yet
SELECT * FROM cron.job WHERE jobname = 'reminders-claim-tick';
```

## Rollback considerations

```sql
DROP FUNCTION IF EXISTS public.run_reminder_scheduler_tick(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.release_reminder_claim(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN);
DROP FUNCTION IF EXISTS public.claim_due_reminders(TEXT, INTEGER, INTEGER);
DROP TRIGGER IF EXISTS reminder_scheduler_config_set_updated_at ON public.reminder_scheduler_config;
DROP TABLE IF EXISTS public.reminder_scheduler_config;
DROP INDEX IF EXISTS reminders_claim_pending_due_idx;
DROP INDEX IF EXISTS reminders_claim_snoozed_due_idx;
DROP INDEX IF EXISTS reminders_claim_expires_at_idx;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS claim_owner;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS claimed_at;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS claim_expires_at;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS next_attempt_at;
```

Only after confirming no Production dependency on claim metadata. Prefer leaving columns if rows already use leases.

## #303C contract (boundary only)

```
due reminder
  → atomic claim (claim_due_reminders)
  → delivery consumer receives claimed reminder (no title required from RPC; fetch content server-side if needed)
  → Web Push adapter (#303C)
  → delivery result persisted
  → lease released/updated (release_reminder_claim)
```

**OUT of #303B:** service worker, Push API, `push_subscriptions`, VAPID, notification permissions, `web-push` package, live cron.

## OpenAI cost

Explicit reminder scheduling / due detection / claim: **LLM COST = $0** (no OpenAI dependency).
