# #298B — Manual Supabase RLS enablement (DO NOT auto-run)

Migration file:

`supabase/migrations/20260817210000_rls_owner_policies_298b.sql`

## Security model (closed beta)

| Layer | Behavior |
|-------|----------|
| **RLS** | Enabled on `users`, `memories`, `conversations`, `messages`, `settings` |
| **Client policies** | **None** intentionally — no `anon` / `authenticated` / `public` policies |
| **Direct PostgREST** | **Deny by default** for normal clients (no policy ⇒ no access when RLS is on) |
| **Ownership boundary** | ShinkAIdo **application APIs** (`/api/memories*`, `/api/chat`, …) |
| **Server DB access** | **Service role** after verified JWT → canonical `auth.uid()` owner scope |

The browser does **not** query these public tables directly.

```
browser
  → authenticated ShinkAIdo API
  → server verifies Supabase JWT
  → canonical auth user ID
  → service-role Supabase client
  → owner-scoped server query
```

Service role bypasses RLS. That is expected and required for current Memory.

`conversations` / `messages` / `settings` remain **unused** by the app and are intentionally inaccessible via direct PostgREST.

## What this migration does

1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all five tables  
   (idempotent if already enabled in live; required for fresh repo-only rebuilds)
2. Does **not** CREATE POLICY  
3. Does **not** DROP POLICY (does not touch unknown/operator policies)  
4. Does **not** DISABLE or FORCE RLS  

## What was intentionally not shipped

Earlier #298B drafts proposed 18 authenticated `*_own` owner policies.  
They are **not** included because:

- the product does not use direct browser/PostgREST table access
- policies would expand the DB attack surface without product benefit
- e.g. a `messages` insert policy on `user_id = auth.uid()` alone could allow
  referencing another user’s `conversation_id` via FK

**Future** direct client database access requires a **separate, security-reviewed** migration.

### Future messages policy note (not implemented)

Any future direct-client policy on `messages` must verify **both**:

- `message.user_id = auth.uid()`
- referenced `conversation_id` belongs to `auth.uid()`

## Live prerequisites (already verified)

- RLS ENABLED on all five tables  
- Zero policies before this migration (deny-by-default)  
- App Memory uses **service role** + JWT ownership (#298A)

## Apply (manual, after PR review)

1. Open Supabase SQL Editor.  
2. Paste/run **only** this migration SQL.  
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

-- Expect zero (or only operator-managed) policies — this migration creates none
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users','memories','conversations','messages','settings')
ORDER BY tablename, policyname;
```

## Functional checks after apply

- Server Memory list/create/update/delete/delete-all still work (service role)
- Chat Memory ON recall/save still works
- Unauthenticated / authenticated PostgREST cannot read user-data tables
- #298A paid APIs still require JWT + rate limit
- Memory Manage UI still uses `/api/memories` (not direct Supabase)

## Rollback

This migration only enables RLS. Do **not** disable RLS to “roll back”  
(would weaken deny-by-default for anon clients if the table is exposed).

## mark_memories_used

Left unchanged: updates by memory id; invoked via service role after owner-scoped search.
