# #334D1 — Proactive Morning Briefing (operator runbook)

**DO NOT auto-apply migrations. DO NOT enable production cron from CI.**
**DO NOT set Production secrets from this PR.**

Migration: `supabase/migrations/20260821120000_morning_briefing_334d1.sql`  
Edge Function: `supabase/functions/morning-briefing-dispatch`  
Vercel functions: **unchanged (11)**. Schedule CRUD is on existing `/api/daily-briefing`.

Semantics: schedule metadata only. Notification body is privacy-safe. Briefing content is generated fresh on tap (`?briefing=morning` → existing #334C path).

---

## A) Supabase migration (manual)

1. Review `20260821120000_morning_briefing_334d1.sql`.
2. Run in Supabase SQL Editor (target project).
3. Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='morning_briefing_schedules';

SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='morning_briefing_schedules';

SELECT * FROM pg_policies WHERE tablename='morning_briefing_schedules';
-- expect none (deny-by-default)

SELECT proname FROM pg_proc
WHERE proname IN (
  'claim_due_morning_briefings',
  'finalize_morning_briefing_delivery',
  'clear_morning_briefing_delivery_claim'
);
```

Rollback sketch (manual):

```sql
DROP FUNCTION IF EXISTS public.claim_due_morning_briefings(TIMESTAMPTZ, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.finalize_morning_briefing_delivery(UUID, DATE, TEXT);
DROP FUNCTION IF EXISTS public.clear_morning_briefing_delivery_claim(UUID, TEXT);
DROP TABLE IF EXISTS public.morning_briefing_schedules;
```

---

## B) Edge secrets required

| Name | Where | Notes |
|------|--------|--------|
| `SUPABASE_URL` | Edge | Existing |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge | Existing |
| `VAPID_KEYS_JSON` | Edge | Same as #303C |
| `VAPID_SUBJECT` | Edge | `mailto:…` |
| `PUSH_ENABLED` | Edge | Must be `true` for live push |
| `MORNING_BRIEFING_DISPATCH_ENABLED` | Edge | **Separate** kill switch; default unset = off |
| `MORNING_BRIEFING_WORKER_SECRET` | Edge | Preferred worker auth (or reuse `REMINDER_PUSH_WORKER_SECRET`) |

Client still needs `VITE_VAPID_PUBLIC_KEY` (existing).

---

## C) Edge Function deployment (manual)

```bash
supabase functions deploy morning-briefing-dispatch --project-ref <ref>
```

`verify_jwt = false` is intentional (M2M secret auth inside the function). Fail-closed without secrets / flags.

---

## D) pg_cron setup (manual — recommend every 5 minutes)

Example (adapt secret + project URL):

```sql
SELECT cron.schedule(
  'morning-briefing-dispatch-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/morning-briefing-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <MORNING_BRIEFING_WORKER_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Due window in SQL/Edge: **10 minutes** after scheduled local HH:mm. Cadence **5 minutes** is recommended so each user’s minute is covered without long delay.

Do **not** enable until migration + Edge + secrets + PUSH flags are ready.

---

## E) PUSH_ENABLED / dispatcher configuration

1. Ensure #303C push path already works (subscriptions + VAPID).
2. Set `PUSH_ENABLED=true` on Edge (if not already for reminders).
3. Set `MORNING_BRIEFING_DISPATCH_ENABLED=true` only when ready to send morning pushes.
4. Leave unset/false to keep code deployed but inert.

---

## F) Test push (manual smoke)

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/morning-briefing-dispatch" \
  -H "Authorization: Bearer <MORNING_BRIEFING_WORKER_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"manual_smoke","now":"<ISO-UTC matching a test user local window>"}'
```

`manual_smoke` bypasses `MORNING_BRIEFING_DISPATCH_ENABLED` / `PUSH_ENABLED` gates for controlled testing — still requires valid worker secret + VAPID. Prefer a Preview/staging project.

UI checks (no ops required):

- Settings → Briefing quotidiano → Briefing mattutino
- Toggle / time / days
- Washi + Sumi + mobile
- Open `/?briefing=morning` → fresh Briefing via existing #334C path

---

## G) Rollback / disable

1. Set `MORNING_BRIEFING_DISPATCH_ENABLED=false` (immediate stop).
2. Unschedule cron job (`cron.unschedule('morning-briefing-dispatch-5m')`).
3. Optionally disable user schedules via product UI or SQL `UPDATE morning_briefing_schedules SET enabled=false`.
4. Do **not** drop `push_subscriptions` (shared with reminders).

---

## Known MVP limitations

- No `onlyWhenImportant` (#334D2).
- Manual briefing earlier the same morning does **not** suppress the scheduled push.
- Travel/timezone change: next save from Settings syncs device IANA zone; once-per-local-date idempotency still holds.
- iOS: Home Screen PWA only.
