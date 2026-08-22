# #304A1 — Google Calendar OAuth + secure connection foundation (operator runbook)

Migration: `supabase/migrations/20260819090000_calendar_connections_304a1.sql`

**Do NOT auto-apply. Do NOT enable in Production from this PR alone.**

## What this ships

Anonymous Supabase `auth.uid()` remains the ShinkAIdo owner identity.

Google OAuth is a **separate** integration:

Settings → Integrazioni → Collega Google Calendar  
→ Edge `calendar-oauth-start` (JWT)  
→ Google consent (read-only Calendar + openid/email for account display)  
→ Edge `calendar-oauth-callback` (HMAC state + pending nonce)  
→ encrypt tokens (AES-256-GCM)  
→ upsert `calendar_connections` for that `auth.uid()`  
→ return to Settings  

**OUT of #304A1:** Calendar event reading in chat, write scopes, reminders-from-calendar, proactive calendar behavior.

Vercel functions remain **8**. OAuth lives on Supabase Edge Functions.

## Edge Functions

| Function | Auth | Role |
|----------|------|------|
| `calendar-oauth-start` | User JWT (`verify_jwt` default on) | PKCE + signed state + pending nonce |
| `calendar-oauth-callback` | HMAC state (`verify_jwt = false`) | Code exchange + encrypt + upsert |
| `calendar-connection` | User JWT | GET status / POST disconnect |

Existing: `reminder-push-dispatch` (#303C).

## 1) Apply migration (manual)

```bash
# After review — example with supabase CLI linked to the project:
supabase db push
# or apply 20260819090000_calendar_connections_304a1.sql in the SQL editor
```

Confirm:

- table `public.calendar_connections` exists
- RLS enabled
- **zero** client policies
- `REVOKE` from `anon` / `authenticated`

## 2) Edge secrets (manual — do not commit)

```bash
supabase secrets set \
  CALENDAR_ENABLED=false \
  GOOGLE_OAUTH_CLIENT_ID='…' \
  GOOGLE_OAUTH_CLIENT_SECRET='…' \
  SHINKAIDO_CALENDAR_ENCRYPTION_KEY='…' \
  CALENDAR_OAUTH_REDIRECT_URI='https://<project-ref>.supabase.co/functions/v1/calendar-oauth-callback' \
  CALENDAR_RETURN_URL='https://<your-preview-or-prod-app>.vercel.app'
```

`SHINKAIDO_CALENDAR_ENCRYPTION_KEY`: 32 raw bytes as **base64** or **64-char hex**. Generate offline; never commit.
Must be **identical** on Supabase Edge Secrets, Vercel Preview, and later Vercel Production (Node decrypt/refresh).
Old name `CALENDAR_TOKEN_ENCRYPTION_KEY` is retired — do not set it.

Also ensure Edge has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (usually present).

## 3) Deploy Edge Functions (manual)

```bash
supabase functions deploy calendar-oauth-start
supabase functions deploy calendar-oauth-callback
supabase functions deploy calendar-connection
```

`config.toml` sets `verify_jwt = false` **only** for `calendar-oauth-callback` (Google redirect has no user JWT).

## 4) Vercel / client flags (manual)

Settings → Integrazioni → Google Calendar is **always visible** in the client.
`VITE_CALENDAR_ENABLED` is **not** required and is **not** a security boundary.

| Variable | Where | Notes |
|----------|-------|-------|
| `CALENDAR_ENABLED` | Supabase Edge (+ Vercel Node for reads) | Real activation gate; `true` only when ready; default OFF |
| `GOOGLE_OAUTH_*` / `SHINKAIDO_CALENDAR_ENCRYPTION_KEY` | Edge + Vercel Node | Same values both sides; **never** `VITE_*` |

When `CALENDAR_ENABLED` is false, the Settings section still shows and reports “Non disponibile”.

Do not couple to `REMINDERS_ENABLED` / `PUSH_ENABLED`.

## 5) Google Cloud checklist (operator)

- Authorized redirect URI exactly matches `CALENDAR_OAUTH_REDIRECT_URI`
- OAuth consent includes Calendar **read-only**
- Test user added (if app is in Testing)
- Web client ID/secret match Edge secrets

## 6) Acceptance smoke (Preview)

1. Enable flags on Preview + Edge only.
2. Open Settings → Integrazioni → Collega Google Calendar.
3. Complete Google consent.
4. Land back on app with Connected + “Sola lettura” + account email.
5. Confirm no Google tokens in DevTools Application / localStorage.
6. Disconnect → status Disconnected; Memory / reminders / push unchanged.
7. Set `CALENDAR_ENABLED=false` after smoke if desired (UI stays visible as unavailable).

## Security model (summary)

- Ownership = verified anonymous JWT `auth.uid()` (start/status/disconnect)
- Callback ownership = signed state `user_id` + DB pending nonce (no user_id spoof)
- PKCE S256 + `prompt=consent` + `access_type=offline`
- AES-256-GCM versioned ciphertext; fail closed
- RLS ENABLE + zero policies; service-role Edge only
- No open redirects (`CALENDAR_RETURN_URL` allowlist)
- No token logging; client never sees tokens

## Refresh token behavior

- If Google returns a new refresh token → encrypt and store
- If omitted on reconnect → preserve existing `refresh_token_enc` when present
- If none available → `status = reconnect_required`
