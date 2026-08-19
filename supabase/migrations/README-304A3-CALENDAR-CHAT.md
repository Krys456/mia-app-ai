# #304A3 — Calendar Intelligence in Core Chat (operator notes)

Wires `#304A2` read service into `/api/chat` on Calendar-relevant turns only.

**No migration. No new Vercel/Edge function. One `responses.create`.**

## Vercel secrets (manual)

Same as Edge/Node Calendar stack:

```
CALENDAR_ENABLED=true
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
CALENDAR_TOKEN_ENCRYPTION_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Do not auto-set from CI.

## Real-Google acceptance (manual)

1. Connect Google Calendar in Settings → Integrations.
2. Optionally create a known test event in Google Calendar (manually).
3. Ask: `Cosa ho domani?` — compare with Calendar.
4. Ask: `Sono libero domani pomeriggio?` — compare FreeBusy.
5. Ask an unrelated question — confirm no Calendar fetch is needed for the answer.
6. Disconnect Calendar → ask a Calendar question → reconnect UX.
7. Reconnect.
8. Confirm event text was not stored in Memory.

## Known MVP limitation

Self-contained Calendar questions only. Follow-ups like “E nel pomeriggio?” are not fully resolved without an extra model call (deferred).
