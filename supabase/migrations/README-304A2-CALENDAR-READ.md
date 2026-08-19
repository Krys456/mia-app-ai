# #304A2 — Google Calendar Read Service (operator notes)

**No migration.** Reuses `calendar_connections` from #304A1.

**No new Vercel API route. No new Edge Function.**

## What this ships

Reusable Node libraries under `lib/server/`:

| Module | Role |
|--------|------|
| `calendar-read.js` | `listCalendars` / `listEvents` / `freeBusy` |
| `calendar-token-refresh.js` | Owner-scoped access-token refresh |
| `calendar-google-http.js` | Allowlisted Google HTTP (read + FreeBusy + token) |
| `calendar-normalize.js` | Text sanitize, ranges, event normalize |
| `calendar-errors.js` | Typed `CalendarError` safe codes |

**OUT of #304A2:** wiring into `/api/chat` (#304A3), Calendar writes, Settings multi-select UX.

Vercel functions remain **8**.

## Environment (Node / future Vercel)

Same secrets as Edge (do not auto-set from this PR):

```
CALENDAR_ENABLED=false
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
CALENDAR_TOKEN_ENCRYPTION_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Operator smoke (local only)

```bash
export CALENDAR_ENABLED=true
export CALENDAR_SMOKE_USER_ID='<owner auth.uid()>'
# plus GOOGLE_OAUTH_*, CALENDAR_TOKEN_ENCRYPTION_KEY, SUPABASE_*
node scripts/calendar-read-smoke.mjs
```

Prints counts / truncated calendar names only. Never tokens or raw Google JSON.

## Limits

- Max calendars listed: 20
- Max calendars queried: 5
- Max events: 40
- Max range: 31 days
- Title / summary: 120 chars (sanitized)

## Readonly guarantee

Only:

- `GET .../calendarList`
- `GET .../calendars/{id}/events`
- `POST .../freeBusy` (query-only)
- `POST https://oauth2.googleapis.com/token` (refresh)

No event insert/update/patch/delete, RSVP, or ACL mutations.
