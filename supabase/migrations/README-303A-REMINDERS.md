# #303A — Reminders migration (DO NOT auto-apply)

Migration file:

`supabase/migrations/20260818053000_reminders_303a.sql`

## Security model

Same as #298B Memory:

- RLS **ENABLED** on `public.reminders`
- **Zero** client policies (deny-by-default PostgREST)
- Browser → `/api/reminders*` → JWT verify → service role → owner-scoped queries

## Manual apply (operator)

1. Review the SQL in the migration file.
2. In Supabase SQL Editor, run the migration contents.
3. Verify:

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'reminders';

SELECT * FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'reminders';
```

Expect: `relrowsecurity = true`, **zero** policy rows.

4. Smoke create/list via the app after Preview deploy with auth.

## Rollback considerations

```sql
DROP TRIGGER IF EXISTS reminders_set_updated_at ON public.reminders;
DROP TABLE IF EXISTS public.reminders;
```

Only after confirming no production dependency on reminder rows.

## Out of #303A

Cron, push, calendar, tasks/goals, RRULE recurrence engine.
