# #387C — Production-safe worker health alerting

## Architecture

```
worker_heartbeats  →  #387B evaluator  →  worker-health-alert-check
                                              ↓
                                      worker_alert_states (dedupe)
                                              ↓
                                      OPS_ALERT_WEBHOOK_URL (optional)
```

Independent checker: if Reminder/Morning stop entirely, they cannot self-alert.

## Alertable states

| Health   | Alert?                                      |
|----------|---------------------------------------------|
| stale    | YES (open incident, one alert)              |
| failed   | YES (same)                                  |
| healthy  | recovery alert only if incident was open    |
| disabled | never                                       |
| unknown  | only after 30m continuous unknown (grace)   |

MVP: **no repeat alerts** while incident stays open. One open + one recovery.

## Checker

Edge: `supabase/functions/worker-health-alert-check`  
Cadence (separate cron, not Reminder/Morning): `*/5 * * * *`  
Conceptual cron name: `worker-health-alert-check`

Auth: `WORKER_HEALTH_ALERT_SECRET` (fallback `REMINDER_PUSH_WORKER_SECRET`)  
Kill switch: `WORKER_HEALTH_ALERT_ENABLED=true`

## Alert sink

Smallest dependency: generic HTTPS webhook.

Secret: `OPS_ALERT_WEBHOOK_URL`

- Unset → durable incident state still updates; delivery status `noop`
- Must NOT use user Gmail OAuth or user push subscriptions
- Never hard-code URLs/emails in repo

Payload is operational metadata only (see `buildOpsAlertPayload`).

## Preview apply

```bash
supabase link --project-ref zqoqvspjccsrwrmoxweb
supabase db query --linked -f supabase/migrations/20260826140000_worker_alert_states_387c.sql
supabase functions deploy worker-health-alert-check --project-ref zqoqvspjccsrwrmoxweb
```

Preview secrets (example):

```bash
supabase secrets set \
  WORKER_HEALTH_ALERT_ENABLED='true' \
  WORKER_HEALTH_ALERT_SECRET='<preview-only>' \
  --project-ref zqoqvspjccsrwrmoxweb
# optional:
# OPS_ALERT_WEBHOOK_URL='https://...'
```

Do **not** create Preview/Production cron for the checker in #387C agent task for Production.
Preview may use manual invoke for QA.

## Production cutover (later — do not run in #387C)

1. Merge
2. Apply only `20260826140000_worker_alert_states_387c.sql` to Production
3. Set `WORKER_HEALTH_ALERT_ENABLED`, `WORKER_HEALTH_ALERT_SECRET`, optional `OPS_ALERT_WEBHOOK_URL`
4. Deploy **only** `worker-health-alert-check`
5. Create **separate** cron `worker-health-alert-check` `*/5 * * * *`
6. Observe healthy noop runs
7. Never intentionally stop Production Reminder/Morning to test alerts

## Residual limitation

If the checker itself stops and no external monitor watches it, no alert is sent.
`/api/health` remains an independent public liveness signal.
Do not build recursive self-alerting.

## Out of scope

Sentry, OTEL, analytics, admin UI, widening `/api/health`, changing Reminder/Morning crons.
