# #303C — Web Push Notifications (operator runbook)

**DO NOT auto-apply migrations. DO NOT enable cron. DO NOT set Production secrets from CI.**

Migration: `supabase/migrations/20260818120000_reminders_push_303c.sql`

Edge Function: `supabase/functions/reminder-push-dispatch`

Web Push library: **`jsr:@negrel/webpush@0.3`** (Deno/Web Crypto). Node `web-push` is not used on Edge.

---

## Architecture

```
confirmed reminder → due → claim_due_reminders (#303B/#303C)
  → Edge reminder-push-dispatch
  → Web Push (VAPID)
  → Service Worker /sw.js
  → OS notification
  → click → focus/open ShinkAIdo ?reminder=<id>
  → #303A DueReminderHost ack (delivered_at)
```

Semantics: **CLAIMED ≠ PUSH SENT (`push_sent_at`) ≠ DELIVERED (`delivered_at`)**.

Vercel functions remain **8**. Subscription CRUD is on existing `/api/reminders` via `action`.

---

## 1) Apply DB migration (manual)

1. Review `20260818120000_reminders_push_303c.sql`.
2. Run in Supabase SQL Editor (target project).
3. Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='reminders' AND column_name='push_sent_at';

SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='push_subscriptions';

SELECT * FROM pg_policies WHERE tablename='push_subscriptions';

SELECT id, enabled FROM public.reminder_scheduler_config WHERE id=1;
-- expect enabled=false

SELECT * FROM cron.job WHERE jobname LIKE 'reminders%';
-- expect no production job yet
```

---

## 2) Generate VAPID keys (manual — do not commit)

`@negrel/webpush` expects **JWK** keypairs (not npm `web-push` base64 strings).

```bash
deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts
# Save JSON output securely as vapid.json
```

Export the **browser public application server key** (URL-safe base64):

```bash
deno eval '
import * as webpush from "jsr:@negrel/webpush@0.3";
const keys = await webpush.importVapidKeys(JSON.parse(await Deno.readTextFile("./vapid.json")));
console.log(await webpush.exportApplicationServerKey(keys));
'
```

Set:

| Name | Where | Value |
|------|--------|--------|
| `VITE_VAPID_PUBLIC_KEY` | Vercel (Preview/Prod) | exported application server key |
| `VAPID_KEYS_JSON` | Supabase Edge secrets | full `vapid.json` contents |
| `VAPID_SUBJECT` | Edge secrets | `mailto:you@domain` |
| `PUSH_ENABLED` | Edge secrets | `false` until activation |
| `REMINDER_PUSH_WORKER_SECRET` | Edge secrets + cron header | long random secret |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Edge (often auto) | service role |
| `REMINDER_PUSH_ALLOW_ENV` | Edge optional | `production` to block non-prod |
| `VITE_PUSH_ENABLED` | Vercel optional | `0` to hide UI |

Prefer **separate VAPID keypairs** for Preview vs Production if the Supabase project is shared.

---

## 3) Deploy Edge Function (manual)

```bash
supabase functions deploy reminder-push-dispatch --project-ref <ref>
supabase secrets set \
  VAPID_KEYS_JSON="$(cat vapid.json)" \
  VAPID_SUBJECT='mailto:you@domain' \
  PUSH_ENABLED='false' \
  REMINDER_PUSH_WORKER_SECRET='<long-random>' \
  --project-ref <ref>
```

---

## 4) Subscription smoke (Push delivery still OFF)

1. Set `VITE_VAPID_PUBLIC_KEY` on a Preview deploy.
2. Open app → create reminder → **Attiva notifiche** (or Settings → Notifiche).
3. Confirm row in `push_subscriptions` for your `user_id` (service role SQL).
4. Confirm `PUSH_ENABLED=false` → worker returns `skipped: push_disabled`.

---

## 5) Manual worker smoke (still no cron)

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/reminder-push-dispatch" \
  -H "Authorization: Bearer $REMINDER_PUSH_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"manual_smoke"}'
```

With `PUSH_ENABLED=true` and a due reminder + active subscription, expect a notification.
`manual_smoke` bypasses `reminder_scheduler_config.enabled` but **not** `PUSH_ENABLED` / auth / VAPID.

---

## 6) Production cron (1 minute) — ONLY after approval

Cron must invoke the **Edge worker**, not SQL-only claim tick.

```sql
-- Store secrets in Vault (recommended) then:
select cron.schedule(
  'reminders-push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/reminder-push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_push_worker_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Then:

```sql
UPDATE public.reminder_scheduler_config
SET enabled = true,
    notes = 'enabled for #303C production push worker'
WHERE id = 1;
```

**Preview must never create this job** if it shares the Production Supabase project.

---

## 7) Android acceptance

1. Android Chrome → ShinkAIdo  
2. Confirm reminder → Attiva notifiche → grant  
3. Reminder 3–5 minutes ahead  
4. Close tab; lock phone (do not force-stop Chrome)  
5. Wait past fire_at + ≤1 minute  
6. Notification: **ShinkAIdo** / reminder title  
7. Tap → app opens with due sheet  
8. Ack → no spam  
9. Disable push → next-open still works  

---

## Rollback

```sql
UPDATE public.reminder_scheduler_config SET enabled = false WHERE id = 1;
SELECT cron.unschedule('reminders-push-dispatch');
```

```bash
supabase secrets set PUSH_ENABLED='false' --project-ref <ref>
```

Optional: `UPDATE push_subscriptions SET disabled_at = now() WHERE disabled_at IS NULL;`

Reminders and #303A next-open remain.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| No permission prompt | Must click Attiva; never cold-launch |
| iOS no push | Home Screen app required (16.4+) |
| Subscribe works, no OS notification | `PUSH_ENABLED`, cron, `enabled`, battery/OEM |
| Repeated pushes | `push_sent_at` set? claim SQL excludes it |
| 401 worker | `REMINDER_PUSH_WORKER_SECRET` |
| 503 misconfigured | `VAPID_KEYS_JSON` JWK from negrel generator |

---

## iOS note

Not a beta blocker. Document Home Screen requirement; do not claim Safari-tab Push.
