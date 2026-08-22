# #337B — Gmail Read-Only OAuth + Query MVP (operator notes)

Mirrors the #304A1/#304A2 Calendar pattern with **separate modules**. Nothing
here touches `calendar-*` files, `calendar_connections`, or any Calendar Edge
Function.

**Scope: `gmail.readonly` + `openid email` only.** No send/reply/delete/
archive/labels/drafts. No permanent email body storage — bodies are fetched
on demand and never written to `email_connections`.

## What this ships

| File | Role |
|------|------|
| `supabase/migrations/20260822071500_email_connections_337b.sql` | `email_connections` table (IF NOT EXISTS safe; may already exist from #311) |
| `supabase/functions/_shared/email-token-crypto.ts` | AES-256-GCM encrypt/decrypt (Edge only) |
| `supabase/functions/_shared/email-oauth.ts` | PKCE + signed OAuth state, Gmail scopes, authorize URL |
| `supabase/functions/_shared/email-edge.ts` | CORS, JWT verify, service client, connection shape |
| `supabase/functions/_shared/email-gmail.ts` | Allowlisted Gmail HTTP, query builder, token refresh |
| `supabase/functions/email-oauth-start/index.ts` | Start OAuth (JWT required) |
| `supabase/functions/email-oauth-callback/index.ts` | Google redirect target (`verify_jwt = false`) |
| `supabase/functions/email-connection/index.ts` | GET status / POST disconnect |
| `supabase/functions/email-query/index.ts` | POST-only Gmail read query |

**OUT of #337B:** writing/sending mail, chat wiring, Settings UX, body storage,
Vercel `api/email.ts` (does not exist — Vercel function count stays at 11).

## Secrets (names only — never commit values)

Set identically wherever each function runs:

```
EMAIL_ENABLED=                       # Edge kill switch (default off) — "1"/"true"/"yes"
GOOGLE_OAUTH_CLIENT_ID=              # Edge only — shared Google Cloud OAuth client
GOOGLE_OAUTH_CLIENT_SECRET=          # Edge only — never exposed to browser
SHINKAIDO_EMAIL_ENCRYPTION_KEY=      # Edge only — 32-byte key, base64/base64url or 64-char hex
EMAIL_OAUTH_REDIRECT_URI=            # Edge only — must match Google Cloud authorized redirect
EMAIL_RETURN_URL=                    # Edge only — comma-separated app origin allowlist
SUPABASE_URL=                        # Edge only — project URL (usually auto-injected)
SUPABASE_SERVICE_ROLE_KEY=           # Edge only — service role (never anon key)
```

`SHINKAIDO_EMAIL_ENCRYPTION_KEY` is the **only** runtime encryption/HMAC key
for this feature. The old `EMAIL_TOKEN_ENCRYPTION_KEY` name from the #311
draft is retired — do not set it, and do not reuse
`SHINKAIDO_CALENDAR_ENCRYPTION_KEY` for email tokens.

`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` may be the same
Google Cloud OAuth client already used for Calendar (shared infra secret),
but the two features never share encryption keys or database tables.

## Redirect URI

Register in Google Cloud Console → APIs & Services → Credentials → OAuth
client → Authorized redirect URIs:

```
https://<project-ref>.supabase.co/functions/v1/email-oauth-callback
```

Must exactly match `EMAIL_OAUTH_REDIRECT_URI`.

## Gmail API

Enable **Gmail API** in the same Google Cloud project (APIs & Services →
Library). OAuth consent screen scopes requested:

- `https://www.googleapis.com/auth/gmail.readonly`
- `openid`
- `email`

No other scope is ever requested. `email-oauth.ts` asserts the readonly
scope is present and rejects any write/modify/send/insert scope before
building the authorize URL.

## Deploy (4 Edge Functions)

```bash
supabase functions deploy email-oauth-start
supabase functions deploy email-oauth-callback
supabase functions deploy email-connection
supabase functions deploy email-query
```

Set secrets first (per environment):

```bash
supabase secrets set \
  EMAIL_ENABLED=true \
  GOOGLE_OAUTH_CLIENT_ID=<value> \
  GOOGLE_OAUTH_CLIENT_SECRET=<value> \
  SHINKAIDO_EMAIL_ENCRYPTION_KEY=<value> \
  EMAIL_OAUTH_REDIRECT_URI=<value> \
  EMAIL_RETURN_URL=<value>
```

`email-oauth-callback` has `verify_jwt = false` in `supabase/config.toml`
(Google redirects here without a Supabase user JWT — ownership is enforced
via HMAC-signed OAuth state + a pending nonce bound to `auth.uid()` at
start). `email-oauth-start`, `email-connection`, and `email-query` all keep
platform JWT verification **on**.

## Apply the migration

Review then apply manually — this repo does not auto-run migrations against
a live database:

```bash
supabase db push
```

The migration is `IF NOT EXISTS` throughout, so it is safe to run even if the
table was already created by the earlier #311 draft.

## RLS

`email_connections` has RLS **enabled with zero policies** — deny-by-default
for direct PostgREST (anon/authenticated have no grants either). Only the
service role (used exclusively inside Edge Functions) can read/write. All
ownership checks happen in Edge code via the verified `auth.uid()`.

## Readonly guarantee

Only:

- `GET https://gmail.googleapis.com/gmail/v1/users/me/messages` (list)
- `GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}` (get)
- `POST https://oauth2.googleapis.com/token` (refresh)
- `POST https://oauth2.googleapis.com/revoke` (disconnect, best-effort)

No send/modify/trash/labels/drafts/attachments-upload. `email-gmail.ts`
allowlists exact hosts + paths + methods and rejects everything else.

## Limits

- Max results per query: 25 (server-clamped)
- Body fetch: at most one message per query, capped at 4000 characters
- Sender search: quotes/backslashes stripped before building `from:"..."`;
  raw client `q` is never accepted
