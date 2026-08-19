# #311 — Gmail Email Phase 1 (connect + read/search)

## What this is

Production-safe **read-only** Gmail foundation:

- OAuth (`gmail.readonly` + `openid email`)
- Encrypted token storage in `email_connections`
- Server Gmail list/search/get
- Chat intent → Email context pack (ephemeral; not stored)

**Out of scope:** send, reply, forward, delete, archive, mark read/unread, labels, drafts.

## Apply migration (manual)

```bash
# Review SQL, then apply with your usual Supabase workflow.
# Do NOT auto-apply from CI.
```

## Edge secrets / env

| Var | Where | Purpose |
|-----|--------|---------|
| `EMAIL_ENABLED` | Edge + Vercel | Kill switch (default off) |
| `GOOGLE_OAUTH_CLIENT_ID` | Edge + Vercel | Shared OAuth client OK |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Edge + Vercel | Token exchange / refresh |
| `EMAIL_TOKEN_ENCRYPTION_KEY` | Edge + Vercel | AES-GCM + HMAC state (32 bytes) |
| `EMAIL_OAUTH_REDIRECT_URI` | Edge | `…/functions/v1/email-oauth-callback` |
| `EMAIL_RETURN_URL` | Edge | Allowlisted return origin(s), comma-separated |

Deploy:

```bash
supabase functions deploy email-oauth-start
supabase functions deploy email-oauth-callback
supabase functions deploy email-connection
```

`config.toml`: `email-oauth-callback` has `verify_jwt = false` (HMAC state + DB nonce bind ownership).

## Security

- Owner = verified JWT `auth.uid()` (never client-supplied userId)
- Signed OAuth state binds user + PKCE verifier + return origin
- Pending nonce CSRF / replay protection
- Open redirects rejected via allowlist + same-origin check
- Tokens never returned to frontend; never logged
- RLS deny-by-default; service-role only

## Vertical proof

1. Connect Gmail in Settings → Integrazioni
2. Ask: `Ci sono email non lette?`
3. Confirm intent → Gmail API → pack → grounded reply
