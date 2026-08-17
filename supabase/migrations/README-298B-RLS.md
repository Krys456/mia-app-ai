# #298B — Manual Supabase migration apply (DO NOT auto-run)

Migration file:

`supabase/migrations/20260817210000_rls_owner_policies_298b.sql`

## What this migration does

1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all five tables  
   (idempotent if already enabled in live; required for fresh repo-only rebuilds)
2. Creates 18 owner-scoped `*_own` policies for `authenticated`
3. Does **not** DISABLE or FORCE RLS

## Live prerequisites (already verified)

- RLS ENABLED on `users`, `memories`, `conversations`, `messages`, `settings`
- Zero policies before this migration
- App Memory uses **service role** + JWT ownership (#298A)

## Apply (manual, after PR review)

1. Open Supabase SQL Editor (or `supabase db push` only if intentionally targeting the project).
2. Paste/run **only** the #298B migration SQL.
3. Confirm success with no errors.

## Verify

```sql
-- RLS still enabled
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('users','memories','conversations','messages','settings')
ORDER BY 1;

-- Expected policies (18)
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users','memories','conversations','messages','settings')
ORDER BY tablename, policyname;
```

Expect exactly the `*_own` policies from the migration. No `USING (true)`.

## Functional checks after apply

- Server Memory list/create/update/delete/delete-all still work (service role)
- Chat Memory ON recall/save still works
- Unauthenticated PostgREST cannot read `memories`
- Authenticated user A cannot read B’s rows via PostgREST
- #298A paid APIs still require JWT + rate limit

## Rollback (policies only)

Drop the named `*_own` policies from the migration.  
Do **not** disable RLS (would weaken deny-by-default for anon clients).

## mark_memories_used

Left unchanged: updates by memory id; invoked via service role after owner-scoped search.
