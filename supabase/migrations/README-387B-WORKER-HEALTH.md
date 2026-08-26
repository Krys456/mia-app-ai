# #387B — Public-beta health + worker heartbeats

## What this adds

1. `public.worker_heartbeats` — one row per proactive worker (current state only)
2. Edge instrumentation on:
   - `reminder-push-dispatch`
   - `morning-briefing-dispatch`
3. Server-side health evaluator (`lib/server/worker-health.js`) for future alerting
4. Public `GET /api/health` — minimal liveness (`ok`, `status`, `buildId`, `environment`)

## Privacy

Heartbeat rows must never store:

- user IDs, emails, reminder titles, briefing content
- Calendar / Gmail data, push endpoints, auth headers, tokens
- prompts / responses / secrets

## Preview apply (only)

```bash
supabase link --project-ref zqoqvspjccsrwrmoxweb
supabase db query --linked -f supabase/migrations/20260826120000_worker_heartbeats_387b.sql
# or: apply the single migration file via SQL editor / db push for Preview only
```

Do **not** apply to Production (`scrvnhwlkorgxbmmsrmv`) in the same task as implementation.

## Preview Edge deploy (only)

```bash
supabase functions deploy reminder-push-dispatch --project-ref zqoqvspjccsrwrmoxweb
supabase functions deploy morning-briefing-dispatch --project-ref zqoqvspjccsrwrmoxweb
```

## Freshness thresholds (evaluator)

| Worker | Cron cadence | Stale after |
|--------|--------------|-------------|
| `reminder-push-dispatch` | ~1 min | 5 minutes |
| `morning-briefing-dispatch` | ~5 min | 15 minutes |

## Health states

`healthy` | `stale` | `failed` | `disabled` | `unknown`

Kill switches (server-side semantic only):

- Reminder: `PUSH_ENABLED` (and Edge `scheduler_disabled` / `push_disabled` → heartbeat `disabled`)
- Morning: `MORNING_BRIEFING_DISPATCH_ENABLED` and/or `PUSH_ENABLED`

## Production cutover (later — do not run in #387B)

1. Merge PR
2. Apply **only** `20260826120000_worker_heartbeats_387b.sql` to Production
3. Deploy updated Edge workers to Production
4. Wait for cron ticks; verify heartbeat rows
5. Verify `/api/health`
6. Verify reminder / morning delivery unaffected
7. Build alerting on the internal evaluator afterward

## Out of scope

Sentry, OpenTelemetry, product analytics, admin dashboard, Slack/email/webhook alerts.
