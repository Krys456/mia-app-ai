/**
 * #304A1 — Google Calendar OAuth + secure connection contracts.
 * Run: node --experimental-strip-types --test lib/server/calendar-304a1.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const migration = read('supabase/migrations/20260819090000_calendar_connections_304a1.sql')
const readme = read('supabase/migrations/README-304A1-CALENDAR.md')
const configToml = read('supabase/config.toml')
const oauthStart = read('supabase/functions/calendar-oauth-start/index.ts')
const oauthCallback = read('supabase/functions/calendar-oauth-callback/index.ts')
const calendarConnection = read('supabase/functions/calendar-connection/index.ts')
const sharedCrypto = read('supabase/functions/_shared/calendar-token-crypto.ts')
const sharedOauth = read('supabase/functions/_shared/calendar-oauth.ts')
const sharedEdge = read('supabase/functions/_shared/calendar-edge.ts')
const privacyCopy = read('src/lib/privacyCopy.ts')
const privacyPage = read('src/pages/PrivacyData.tsx')
const settings = read('src/components/SettingsDrawer.tsx')
const calendarSettings = read('src/components/CalendarIntegrationsSettings.tsx')
const calendarApi = read('src/lib/calendarApi.ts')
const envExample = read('.env.example')
const vercel = JSON.parse(read('vercel.json'))
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const reminders303a = read('supabase/migrations/20260818053000_reminders_303a.sql')
const push303c = read('supabase/migrations/20260818120000_reminders_push_303c.sql')
const reminderEdge = read('supabase/functions/reminder-push-dispatch/index.ts')

const deployed = Object.keys(vercel.functions || {})

function testKeyHex() {
  return 'a'.repeat(64)
}

describe('#304A1 migration + RLS', () => {
  it('creates calendar_connections with required columns and one-per-user', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.calendar_connections/)
    assert.match(migration, /user_id UUID NOT NULL REFERENCES public\.users/)
    assert.match(migration, /provider TEXT NOT NULL DEFAULT 'google'/)
    assert.match(migration, /google_sub TEXT NULL/)
    assert.match(migration, /account_email TEXT NULL/)
    assert.match(migration, /scopes TEXT\[]/)
    assert.match(migration, /access_token_enc TEXT NULL/)
    assert.match(migration, /refresh_token_enc TEXT NULL/)
    assert.match(migration, /token_expires_at TIMESTAMPTZ NULL/)
    assert.match(migration, /status TEXT NOT NULL/)
    assert.match(migration, /selected_calendar_ids JSONB NULL/)
    assert.match(migration, /last_error_code TEXT NULL/)
    assert.match(migration, /oauth_pending_nonce TEXT NULL/)
    assert.match(migration, /disconnected_at TIMESTAMPTZ NULL/)
    assert.match(migration, /calendar_connections_one_google_per_user UNIQUE \(user_id, provider\)/)
    assert.match(migration, /provider = 'google'/)
    assert.match(migration, /'pending'/)
    assert.match(migration, /'connected'/)
    assert.match(migration, /'reconnect_required'/)
    assert.match(migration, /'disconnected'/)
  })

  it('enables RLS with zero client policies and revokes anon/authenticated', () => {
    assert.match(migration, /ALTER TABLE public\.calendar_connections ENABLE ROW LEVEL SECURITY/)
    assert.match(migration, /Intentionally NO CREATE POLICY/)
    assert.doesNotMatch(migration, /^\s*CREATE POLICY/m)
    assert.match(migration, /REVOKE ALL ON TABLE public\.calendar_connections FROM anon/)
    assert.match(migration, /REVOKE ALL ON TABLE public\.calendar_connections FROM authenticated/)
  })
})

describe('#304A1 AES-GCM encryption', () => {
  it('roundtrips and fails closed on tamper / missing key', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-token-crypto.js')).href)
    const key = testKeyHex()
    const enc = await mod.encryptToken('secret-access-token-value', key)
    assert.equal(enc.ok, true)
    assert.match(enc.ciphertext, /^v1\./)
    assert.doesNotMatch(enc.ciphertext, /secret-access-token-value/)

    const dec = await mod.decryptToken(enc.ciphertext, key)
    assert.equal(dec.ok, true)
    assert.equal(dec.plaintext, 'secret-access-token-value')

    const tampered = enc.ciphertext.slice(0, -2) + (enc.ciphertext.endsWith('aa') ? 'bb' : 'aa')
    const bad = await mod.decryptToken(tampered, key)
    assert.equal(bad.ok, false)

    const missing = await mod.encryptToken('x', '')
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'encryption_key_missing')

    const wrongKey = await mod.decryptToken(enc.ciphertext, 'b'.repeat(64))
    assert.equal(wrongKey.ok, false)
  })

  it('redacts token-like log fields', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-token-crypto.js')).href)
    const out = mod.redactTokenFields({
      runId: '1',
      access_token: 'leak',
      refresh_token_enc: 'cipher',
      userId: 'u',
    })
    assert.equal(out.runId, '1')
    assert.equal(out.userId, 'u')
    assert.equal(out.access_token, '[redacted]')
    assert.equal(out.refresh_token_enc, '[redacted]')
  })
})

describe('#304A1 OAuth state + PKCE + scopes', () => {
  it('signs/verifies state; rejects expired and tampered', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-oauth.js')).href)
    const key = testKeyHex()
    const verifier = mod.generateCodeVerifier()
    const challenge = await mod.generateCodeChallenge(verifier)
    assert.equal(typeof challenge, 'string')
    assert.notEqual(challenge, verifier)

    const nonce = mod.generateOAuthNonce()
    const signed = await mod.createSignedOAuthState(
      { userId: '11111111-1111-1111-1111-111111111111', nonce, codeVerifier: verifier },
      key,
    )
    assert.equal(signed.ok, true)

    const ok = await mod.verifySignedOAuthState(signed.state, {}, key)
    assert.equal(ok.ok, true)
    assert.equal(ok.userId, '11111111-1111-1111-1111-111111111111')
    assert.equal(ok.nonce, nonce)
    assert.equal(ok.codeVerifier, verifier)

    const expired = await mod.verifySignedOAuthState(
      signed.state,
      { nowUnix: signed.expiresAtUnix + 1 },
      key,
    )
    assert.equal(expired.ok, false)
    assert.equal(expired.code, 'oauth_state_expired')

    const tampered = signed.state.slice(0, -4) + 'zzzz'
    const bad = await mod.verifySignedOAuthState(tampered, {}, key)
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'oauth_state_tampered')
  })

  it('requests read-only calendar scope and rejects write scopes', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-oauth.js')).href)
    assert.match(mod.GOOGLE_OAUTH_SCOPES, /calendar\.readonly/)
    assert.doesNotMatch(mod.GOOGLE_OAUTH_SCOPES, /auth\/calendar[^.]/)
    assert.doesNotMatch(mod.GOOGLE_OAUTH_SCOPES, /calendar\.events/)

    const ok = mod.assertReadOnlyCalendarScopes(mod.GOOGLE_OAUTH_SCOPES)
    assert.equal(ok.ok, true)

    const write = mod.assertReadOnlyCalendarScopes(
      'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar',
    )
    assert.equal(write.ok, false)
    assert.equal(write.code, 'write_scope_forbidden')

    const authUrl = mod.buildGoogleAuthorizeUrl({
      clientId: 'client',
      redirectUri: 'https://example.supabase.co/functions/v1/calendar-oauth-callback',
      state: 'state',
      codeChallenge: 'challenge',
    })
    assert.equal(authUrl.ok, true)
    assert.match(authUrl.url, /access_type=offline/)
    assert.match(authUrl.url, /prompt=consent/)
    assert.match(authUrl.url, /code_challenge_method=S256/)
    assert.match(authUrl.url, /calendar\.readonly/)
  })

  it('blocks open redirects', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-oauth.js')).href)
    const safe = mod.resolveSafeReturnUrl(
      'https://evil.example/phish',
      'https://app.example.com',
    )
    assert.equal(safe.ok, true)
    assert.match(safe.url, /^https:\/\/app\.example\.com\//)
    assert.doesNotMatch(safe.url, /evil\.example/)
  })
})

describe('#304A1 refresh token + public connection', () => {
  it('preserves existing refresh enc or marks reconnect_required', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-connection.js')).href)
    const withNew = mod.resolveRefreshTokenEnc({
      newRefreshToken: 'r',
      existingRefreshTokenEnc: 'old',
      newRefreshEnc: 'enc-new',
    })
    assert.equal(withNew.status, 'connected')
    assert.equal(withNew.refreshTokenEnc, 'enc-new')

    const preserve = mod.resolveRefreshTokenEnc({
      newRefreshToken: null,
      existingRefreshTokenEnc: 'old-enc',
      newRefreshEnc: null,
    })
    assert.equal(preserve.status, 'connected')
    assert.equal(preserve.refreshTokenEnc, 'old-enc')

    const missing = mod.resolveRefreshTokenEnc({
      newRefreshToken: null,
      existingRefreshTokenEnc: null,
      newRefreshEnc: null,
    })
    assert.equal(missing.status, 'reconnect_required')
    assert.equal(missing.refreshTokenEnc, null)

    const pub = mod.publicCalendarConnection({
      status: 'connected',
      account_email: 'a@b.c',
      access_token_enc: 'SHOULD_NOT_APPEAR',
      refresh_token_enc: 'SHOULD_NOT_APPEAR',
    })
    assert.equal(pub.connected, true)
    assert.equal(pub.readOnly, true)
    assert.equal(pub.accountEmail, 'a@b.c')
    assert.equal('access_token_enc' in pub, false)
    assert.equal('refresh_token_enc' in pub, false)
  })
})

describe('#304A1 feature flags default OFF', () => {
  it('CALENDAR_ENABLED and VITE_CALENDAR_ENABLED default false', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-enabled.js')).href)
    assert.equal(mod.isCalendarEnabled({}), false)
    assert.equal(mod.isCalendarEnabled({ CALENDAR_ENABLED: '' }), false)
    assert.equal(mod.isCalendarEnabled({ CALENDAR_ENABLED: 'true' }), true)
    assert.equal(mod.isCalendarUiEnabled({}), false)
    assert.equal(mod.isCalendarUiEnabled({ VITE_CALENDAR_ENABLED: '1' }), true)
    assert.equal(mod.isCalendarUiEnabled({ VITE_CALENDAR_ENABLED: '0' }), false)
  })
})

describe('#304A1 Edge Function contracts', () => {
  it('oauth start binds JWT user, PKCE, and never exposes client secret', () => {
    assert.match(oauthStart, /verifyUserJwt|auth\.getUser/)
    assert.match(oauthStart, /generateCodeVerifier|code_challenge/)
    assert.match(oauthStart, /createSignedOAuthState/)
    assert.match(oauthStart, /oauth_pending_nonce/)
    assert.match(oauthStart, /GOOGLE_OAUTH_SCOPES|calendar\.readonly/)
    assert.match(oauthStart, /CALENDAR_ENABLED|isCalendarEnabled/)
    assert.match(oauthStart, /secret_relay_forbidden/)
    assert.doesNotMatch(oauthStart, /Deno\.env\.get\(['"]GOOGLE_OAUTH_CLIENT_SECRET['"]\)/)
    assert.doesNotMatch(oauthStart, /localStorage/)
  })

  it('callback validates state/nonce, encrypts before persistence, safe redirect', () => {
    assert.match(oauthCallback, /verifySignedOAuthState/)
    assert.match(oauthCallback, /oauth_pending_nonce/)
    assert.match(oauthCallback, /encryptToken/)
    assert.match(oauthCallback, /access_token_enc/)
    assert.match(oauthCallback, /refresh_token_enc/)
    assert.match(oauthCallback, /resolveRefreshTokenEnc/)
    assert.match(oauthCallback, /resolveSafeReturnUrl/)
    assert.match(oauthCallback, /ownership_mismatch|oauth_nonce_invalid/)
    assert.match(configToml, /\[functions\.calendar-oauth-callback\]/)
    assert.match(configToml, /verify_jwt = false/)
    assert.doesNotMatch(oauthCallback, /console\.(log|info|warn)\([^)]*access_token/)
    assert.doesNotMatch(oauthCallback, /console\.(log|info|warn)\([^)]*refresh_token/)
  })

  it('status/disconnect are owner-scoped and wipe tokens', () => {
    assert.match(calendarConnection, /verifyUserJwt/)
    assert.match(calendarConnection, /user_id_spoof_rejected/)
    assert.match(calendarConnection, /action === 'disconnect'|action !== 'disconnect'/)
    assert.match(calendarConnection, /access_token_enc: null/)
    assert.match(calendarConnection, /refresh_token_enc: null/)
    assert.match(calendarConnection, /status: 'disconnected'/)
    assert.match(calendarConnection, /toPublicConnection/)
    assert.match(calendarConnection, /oauth2\.googleapis\.com\/revoke/)
    assert.doesNotMatch(calendarConnection, /\.from\(['"]reminders['"]\)/)
    assert.doesNotMatch(calendarConnection, /\.from\(['"]memories['"]\)/)
    assert.doesNotMatch(calendarConnection, /\.from\(['"]push_subscriptions['"]\)/)
    assert.doesNotMatch(calendarConnection, /\.from\(['"]users['"]\)\.delete/)
  })

  it('shared modules avoid logging secrets', () => {
    assert.match(sharedCrypto, /AES-GCM/)
    assert.match(sharedOauth, /calendar\.readonly/)
    assert.match(sharedEdge, /redactTokenFields/)
    assert.match(sharedEdge, /logSafe/)
  })
})

describe('#304A1 Settings + privacy + env', () => {
  it('wires Integrations UI and privacy disclosure without overstating', () => {
    assert.match(settings, /CalendarIntegrationsSettings/)
    assert.match(settings, /isCalendarUiEnabled/)
    assert.match(calendarSettings, /Integrazioni/)
    assert.match(calendarSettings, /Google Calendar/)
    assert.match(calendarSettings, /Sola lettura/)
    assert.match(calendarSettings, /non usa ancora il Calendar in chat|non legge ancora/)
    assert.match(calendarApi, /calendar-oauth-start/)
    assert.match(calendarApi, /calendar-connection/)
    assert.doesNotMatch(calendarApi, /localStorage\.setItem\([^)]*token/i)
    assert.doesNotMatch(calendarApi, /access_token|refresh_token/)
    assert.match(privacyCopy, /googleCalendar:/)
    assert.match(privacyCopy, /sola lettura|lettura/i)
    assert.match(privacyCopy, /crittografati|server/i)
    assert.match(privacyCopy, /non sono ancora usati in chat|#304A1/)
    assert.match(privacyPage, /privacy-calendar-title|googleCalendar/)
    assert.match(envExample, /VITE_CALENDAR_ENABLED/)
    assert.match(envExample, /CALENDAR_ENABLED/)
    assert.match(envExample, /GOOGLE_OAUTH_CLIENT_ID/)
    assert.match(envExample, /GOOGLE_OAUTH_CLIENT_SECRET/)
    assert.match(envExample, /CALENDAR_TOKEN_ENCRYPTION_KEY/)
    assert.match(envExample, /CALENDAR_OAUTH_REDIRECT_URI/)
    assert.match(envExample, /CALENDAR_RETURN_URL/)
    assert.match(readme, /Do NOT auto-apply/)
    assert.match(readme, /calendar-oauth-callback/)
  })
})

describe('#304A1 protected contracts + #303 regressions', () => {
  it('keeps 8 Vercel functions and Core invariants', () => {
    assert.equal(deployed.length, 8)
    assert.ok(!deployed.some((f) => f.includes('calendar')))
    assert.ok(!deployed.some((f) => f.includes('cron')))
    assert.ok(deployed.includes('api/chat.ts'))
    assert.ok(deployed.includes('api/reminders/index.ts'))
    assert.equal((chatApi.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chatApi, /maxDuration:\s*120/)
    assert.match(coreParams, /stream:\s*false/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
  })

  it('does not regress reminders / push foundations', () => {
    assert.match(reminders303a, /CREATE TABLE IF NOT EXISTS public\.reminders/)
    assert.match(reminders303a, /Intentionally NO CREATE POLICY/)
    assert.match(push303c, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/)
    assert.match(reminderEdge, /reminder-push-dispatch/)
    assert.match(reminderEdge, /PUSH_ENABLED/)
    assert.doesNotMatch(oauthStart, /from ['"]openai['"]|responses\.create/)
    assert.doesNotMatch(oauthCallback, /from ['"]openai['"]|responses\.create/)
    assert.doesNotMatch(calendarConnection, /from ['"]openai['"]|responses\.create/)
  })

  it('lists expected Edge function directories', () => {
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/calendar-oauth-start/index.ts')), true)
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/calendar-oauth-callback/index.ts')), true)
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/calendar-connection/index.ts')), true)
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/reminder-push-dispatch/index.ts')), true)
  })
})
