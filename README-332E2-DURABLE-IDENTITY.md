# #332E2 — Durable identity (email link MVP)

No schema migration. No billing. Enforcement remains OFF.

## What shipped

- Server: `isDurableIdentity` / `requireDurableIdentity` / `resolveIdentityStatus`
- Client: Plans Upgrade identity gate + Privacy account panel
- Email **link** via `updateUser({ email })` — preserves `auth.uid()`
- Email **change** (#332E2B) via `updateUser({ email })` on durable accounts — same `auth.uid`
- Email **sign-in** via `signInWithOtp({ shouldCreateUser: false })` — explicit switch, **no merge**
- Google linking code path behind `VITE_AUTH_GOOGLE_LINKING_ENABLED` (default off)
- Apple deferred
- `public.users` email sync via `syncPublicUserProfile` (same id)
- **No new Vercel function**

## #332E2B — Change email

1. Open Privacy → Account (or Plans identity panel after durable).
2. Tap **Cambia email**.
3. Enter the new address → **Invia conferma**.
4. Confirm via Supabase email link(s).
   - Default Supabase **Secure Email Change**: confirm **new** email; often also confirm **current** email.
5. Refresh → masked new email shown; account remains durable; **same auth user id**.
6. Next authenticated chat syncs `public.users.email` for that same id.

Conflict: if the new email belongs to another account → clear error, no merge, session kept.

## Manual Supabase provisioning

### Email (required for MVP)

1. Supabase Dashboard → Authentication → Providers → **Email** enabled.
2. Confirm email templates / Site URL.
3. Authentication → URL Configuration → Redirect URLs include:
   - Production origin
   - Preview origins (`https://*-cristiansolinas9-3530s-projects.vercel.app/**` or specific Preview URL)
4. Enable anonymous users (already required by ShinkAIdo).

### Google (optional later)

1. Authentication → Providers → Google (client id/secret).
2. Enable **Manual Linking** (Auth settings) so `linkIdentity` keeps the same user id.
3. Set `VITE_AUTH_GOOGLE_LINKING_ENABLED=true` on Vercel Preview/Production only after verified.
4. Redirect URLs as above.

### Apple (deferred)

Requires Apple Developer + Services ID + Supabase Apple provider. Defer to native/iOS phase unless web Apple Sign In is provisioned separately.

## Policy reminders

| Action | Effect |
|---|---|
| Link email/Google on current anon | Same `auth.uid` / `public.users.id` |
| Sign into existing account | Switches session; **no** auto-merge of anon data |
| Identity conflict | Error; anon session kept |

## Env

```
# optional
VITE_AUTH_GOOGLE_LINKING_ENABLED=false
```

Keep `ENTITLEMENT_ENFORCEMENT_ENABLED` unset/false.
