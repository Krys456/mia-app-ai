# #386C — Account deletion jobs (repo-only; do NOT auto-apply)

## What
`public.account_deletion_jobs` — idempotent / retryable deletion orchestration ledger.

## Critical design
- `auth_user_id` is **NOT** a FK to `public.users` or `auth.users`
- Job rows survive `DELETE FROM public.users` so `auth.admin.deleteUser` can finish and mark `completed`

## Apply (manual)
1. Review SQL
2. Apply in Supabase SQL editor (Preview first)
3. Confirm RLS ON, no policies, grants service_role only

## Related
- API: `POST /api/account/delete`
- Orchestrator: `lib/server/account-deletion.js`
- Kill switch: `ACCOUNT_DELETION_ENABLED=0` / `VITE_ACCOUNT_DELETION_ENABLED=0`

## Safety
Never run destructive deletion against the owner Production account during QA.
