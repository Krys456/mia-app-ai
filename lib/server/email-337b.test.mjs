/**
 * #337B — Gmail read-only OAuth + query MVP contracts.
 * Run: node --test lib/server/email-337b.test.mjs
 *
 * This feature ships ONLY under supabase/ (Edge Functions, Deno TS). There is
 * no Node/Vercel mirror, so every contract here is verified as source text
 * (grep-style pattern matching against the actual shipped files), the same
 * approach used by lib/server/calendar-encryption-env-336b.test.mjs and the
 * "(source contract)" checks called out in the task. Plain `.ts` files under
 * supabase/functions/ cannot be `import()`-ed by plain `node --test` (Deno
 * runtime only), so this file never attempts that.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

const migration = read('supabase/migrations/20260822071500_email_connections_337b.sql')
const readme = read('supabase/migrations/README-337B-EMAIL.md')
const configToml = read('supabase/config.toml')
const envExample = read('.env.example')
const vercelJson = JSON.parse(read('vercel.json'))

const sharedCrypto = read('supabase/functions/_shared/email-token-crypto.ts')
const sharedOauth = read('supabase/functions/_shared/email-oauth.ts')
const sharedEdge = read('supabase/functions/_shared/email-edge.ts')
const sharedGmail = read('supabase/functions/_shared/email-gmail.ts')
const oauthStart = read('supabase/functions/email-oauth-start/index.ts')
const oauthCallback = read('supabase/functions/email-oauth-callback/index.ts')
const emailConnection = read('supabase/functions/email-connection/index.ts')
const emailQuery = read('supabase/functions/email-query/index.ts')

const EDGE_RUNTIME_FILES = {
  'supabase/functions/_shared/email-token-crypto.ts': sharedCrypto,
  'supabase/functions/_shared/email-oauth.ts': sharedOauth,
  'supabase/functions/_shared/email-edge.ts': sharedEdge,
  'supabase/functions/_shared/email-gmail.ts': sharedGmail,
  'supabase/functions/email-oauth-start/index.ts': oauthStart,
  'supabase/functions/email-oauth-callback/index.ts': oauthCallback,
  'supabase/functions/email-connection/index.ts': emailConnection,
  'supabase/functions/email-query/index.ts': emailQuery,
}

function gitDiffNames(args) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', ...args], { cwd: root, encoding: 'utf8' })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

describe('#337B write-path guardrails', () => {
  it('does not create api/email.ts and keeps vercel.json at 13 functions', () => {
    assert.equal(exists('api/email.ts'), false)
    const fnCount = Object.keys(vercelJson.functions || {}).length
    assert.equal(fnCount, 13)
    assert.ok(!Object.keys(vercelJson.functions).some((f) => f.includes('email')))
  })

  it('creates exactly the expected Edge/migration/doc files', () => {
    const expected = [
      'supabase/migrations/20260822071500_email_connections_337b.sql',
      'supabase/migrations/README-337B-EMAIL.md',
      'supabase/functions/_shared/email-token-crypto.ts',
      'supabase/functions/_shared/email-oauth.ts',
      'supabase/functions/_shared/email-edge.ts',
      'supabase/functions/_shared/email-gmail.ts',
      'supabase/functions/email-oauth-start/index.ts',
      'supabase/functions/email-oauth-callback/index.ts',
      'supabase/functions/email-connection/index.ts',
      'supabase/functions/email-query/index.ts',
    ]
    for (const rel of expected) {
      assert.equal(exists(rel), true, `missing ${rel}`)
    }
  })

  it('does not touch any calendar-* file (git diff against origin/main)', () => {
    const calendarGlobs = [
      'supabase/functions/calendar-*',
      'supabase/functions/_shared/calendar-*',
      'supabase/migrations/*calendar*',
      'supabase/migrations/*CALENDAR*',
      'src/lib/calendar-chat',
      'src/components/CalendarIntegrationsSettings.tsx',
      'src/lib/calendarApi.ts',
    ]
    const diff = gitDiffNames(['origin/main', '--', ...calendarGlobs])
    if (diff === null) return // git ref unavailable in this sandbox — skip gracefully
    assert.deepEqual(diff, [], `calendar files were modified: ${diff.join(', ')}`)
  })

  it('calendar-chat MVP still exists on disk (not deleted/regressed)', () => {
    assert.equal(exists('src/lib/calendar-chat'), true)
    assert.equal(exists('src/lib/calendar-chat/calendar-chat-336b.test.mjs'), true)
    assert.equal(exists('supabase/functions/calendar-connection/index.ts'), true)
    assert.equal(exists('supabase/functions/calendar-oauth-start/index.ts'), true)
    assert.equal(exists('supabase/functions/calendar-oauth-callback/index.ts'), true)
  })

  it('no email module imports a calendar-* module', () => {
    for (const [rel, src] of Object.entries(EDGE_RUNTIME_FILES)) {
      assert.doesNotMatch(src, /from\s+['"][^'"]*calendar[^'"]*['"]/i, rel)
    }
  })

  it('no email module writes to calendar_connections / calendar-scoped tables', () => {
    for (const [rel, src] of Object.entries(EDGE_RUNTIME_FILES)) {
      assert.doesNotMatch(src, /\.from\(['"]calendar_connections['"]\)/, rel)
    }
  })
})

describe('#337B encryption key: SHINKAIDO_EMAIL_ENCRYPTION_KEY only', () => {
  it('Edge runtime files reference the new key and never the retired name', () => {
    const filesExpectingKey = [
      'supabase/functions/email-oauth-start/index.ts',
      'supabase/functions/email-oauth-callback/index.ts',
      'supabase/functions/email-connection/index.ts',
      'supabase/functions/email-query/index.ts',
    ]
    for (const rel of filesExpectingKey) {
      const src = EDGE_RUNTIME_FILES[rel]
      assert.match(src, /env\('SHINKAIDO_EMAIL_ENCRYPTION_KEY'\)/, rel)
    }
    for (const [rel, src] of Object.entries(EDGE_RUNTIME_FILES)) {
      // The retired name may only appear inside a comment explaining the
      // retirement (mirrors calendar-encryption-env-336b.test.mjs) — never
      // as a live `env(...)` / `Deno.env.get(...)` read.
      assert.doesNotMatch(src, /env\(['"]EMAIL_TOKEN_ENCRYPTION_KEY['"]\)/, rel)
      assert.doesNotMatch(src, /Deno\.env\.get\(['"]EMAIL_TOKEN_ENCRYPTION_KEY['"]\)/, rel)
      if (src.includes('EMAIL_TOKEN_ENCRYPTION_KEY')) {
        assert.match(src, /retired/i, `${rel} must mark the old name retired`)
      }
    }
  })

  it('never reuses the Calendar encryption key for email tokens', () => {
    for (const [rel, src] of Object.entries(EDGE_RUNTIME_FILES)) {
      assert.doesNotMatch(src, /SHINKAIDO_CALENDAR_ENCRYPTION_KEY/, rel)
    }
  })

  it('.env.example documents SHINKAIDO_EMAIL_ENCRYPTION_KEY and retires the old name', () => {
    assert.match(envExample, /SHINKAIDO_EMAIL_ENCRYPTION_KEY/)
    assert.match(envExample, /EMAIL_TOKEN_ENCRYPTION_KEY/)
    assert.match(envExample, /retired/i)
    assert.match(envExample, /EMAIL_ENABLED/)
    assert.match(envExample, /EMAIL_OAUTH_REDIRECT_URI/)
    assert.match(envExample, /EMAIL_RETURN_URL/)
    // Calendar docs must remain present (not removed by this change).
    assert.match(envExample, /CALENDAR_ENABLED/)
    assert.match(envExample, /SHINKAIDO_CALENDAR_ENCRYPTION_KEY/)
  })
})

describe('#337B AES-GCM encryption (source contract)', () => {
  it('implements versioned AES-256-GCM with fail-closed key parsing', () => {
    assert.match(sharedCrypto, /AES-256-GCM/)
    assert.match(sharedCrypto, /const VERSION = 'v1'/)
    assert.match(sharedCrypto, /name: 'AES-GCM'/)
    assert.match(sharedCrypto, /encryption_key_missing/)
    assert.match(sharedCrypto, /encryption_key_invalid_length/)
    assert.match(sharedCrypto, /export function parseEncryptionKey/)
    assert.match(sharedCrypto, /export async function encryptToken/)
    assert.match(sharedCrypto, /export async function decryptToken/)
    assert.match(sharedCrypto, /export function redactTokenFields/)
  })

  it('redacts token-like AND content-like log fields (subject/from/snippet/body)', () => {
    assert.match(sharedCrypto, /subject\|snippet\|body/)
    assert.match(sharedCrypto, /token\|secret\|cipher\|verifier\|refresh/)
  })
})

describe('#337B OAuth state + PKCE + Gmail scopes (source contract)', () => {
  it('signs state with PKCE verifier + optional return origin; verifies HMAC and expiry', () => {
    assert.match(sharedOauth, /export function generateCodeVerifier/)
    assert.match(sharedOauth, /export async function generateCodeChallenge/)
    assert.match(sharedOauth, /export async function createSignedOAuthState/)
    assert.match(sharedOauth, /export async function verifySignedOAuthState/)
    assert.match(sharedOauth, /HMAC-SHA256|name: 'HMAC'/)
    assert.match(sharedOauth, /oauth_state_expired/)
    assert.match(sharedOauth, /oauth_state_tampered/)
    assert.match(sharedOauth, /returnOrigin/)
  })

  it('requests gmail.readonly + openid email only and forbids every write scope', () => {
    assert.match(sharedOauth, /GOOGLE_GMAIL_READONLY_SCOPE = 'https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly'/)
    assert.match(sharedOauth, /GOOGLE_IDENTITY_SCOPES = 'openid email'/)
    assert.match(sharedOauth, /GOOGLE_EMAIL_OAUTH_SCOPES/)

    const writeScopes = [
      'https://www.googleapis.com/auth/gmail',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.insert',
      'https://mail.google.com/',
    ]
    for (const scope of writeScopes) {
      assert.match(sharedOauth, new RegExp(scope.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), scope)
    }
    assert.match(sharedOauth, /export function assertReadOnlyGmailScopes/)
    assert.match(sharedOauth, /missing_readonly_scope/)
    assert.match(sharedOauth, /write_scope_forbidden/)
    assert.match(sharedOauth, /include_granted_scopes', 'false'/)
    assert.match(sharedOauth, /access_type', 'offline'/)
    assert.match(sharedOauth, /code_challenge_method', 'S256'/)
  })

  it('blocks open redirects via an allowlist (no unauthenticated origin passthrough)', () => {
    assert.match(sharedOauth, /export function resolveOAuthCallbackReturnUrl/)
    assert.match(sharedOauth, /export function isAllowedEmailReturnOrigin/)
    assert.match(sharedOauth, /export function parseEmailReturnAllowlist/)
    assert.match(sharedOauth, /return_url_not_configured/)
    assert.match(sharedOauth, /vercel\.app/)
  })
})

describe('#337B migration + RLS', () => {
  it('creates email_connections with required columns (IF NOT EXISTS safe)', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.email_connections/)
    assert.match(migration, /user_id UUID NOT NULL REFERENCES public\.users/)
    assert.match(migration, /provider TEXT NOT NULL DEFAULT 'google'/)
    assert.match(migration, /google_sub TEXT NULL/)
    assert.match(migration, /account_email TEXT NULL/)
    assert.match(migration, /scopes TEXT\[]/)
    assert.match(migration, /access_token_enc TEXT NULL/)
    assert.match(migration, /refresh_token_enc TEXT NULL/)
    assert.match(migration, /token_expires_at TIMESTAMPTZ NULL/)
    assert.match(migration, /status TEXT NOT NULL/)
    assert.match(migration, /last_error_code TEXT NULL/)
    assert.match(migration, /oauth_pending_nonce TEXT NULL/)
    assert.match(migration, /disconnected_at TIMESTAMPTZ NULL/)
    assert.match(migration, /email_connections_one_google_per_user UNIQUE \(user_id, provider\)/)
    assert.match(migration, /CREATE INDEX IF NOT EXISTS/)
    assert.match(migration, /#337B/)
    assert.doesNotMatch(migration, /body_text|snippet_text|email_body/i)
  })

  it('enables RLS with zero client policies and revokes anon/authenticated', () => {
    assert.match(migration, /ALTER TABLE public\.email_connections ENABLE ROW LEVEL SECURITY/)
    assert.match(migration, /Intentionally NO CREATE POLICY/i)
    assert.doesNotMatch(migration, /^\s*CREATE POLICY/m)
    assert.match(migration, /REVOKE ALL ON TABLE public\.email_connections FROM PUBLIC/)
    assert.match(migration, /REVOKE ALL ON TABLE public\.email_connections FROM anon/)
    assert.match(migration, /REVOKE ALL ON TABLE public\.email_connections FROM authenticated/)
  })

  it('ops README documents secrets by name only (never a value) and the 4 deploys', () => {
    assert.match(readme, /SHINKAIDO_EMAIL_ENCRYPTION_KEY/)
    assert.match(readme, /EMAIL_OAUTH_REDIRECT_URI/)
    assert.match(readme, /EMAIL_RETURN_URL/)
    assert.match(readme, /email-oauth-start/)
    assert.match(readme, /email-oauth-callback/)
    assert.match(readme, /email-connection/)
    assert.match(readme, /email-query/)
    assert.match(readme, /gmail\.readonly/)
    // Guard against accidentally committing a real-looking secret value.
    assert.doesNotMatch(readme, /SHINKAIDO_EMAIL_ENCRYPTION_KEY\s*=\s*[A-Za-z0-9+/]{20,}/)
  })
})

describe('#337B config.toml verify_jwt gating', () => {
  it('disables verify_jwt only for email-oauth-callback', () => {
    assert.match(configToml, /\[functions\.email-oauth-callback\]/)
    const section = configToml.slice(configToml.indexOf('[functions.email-oauth-callback]'))
    assert.match(section, /verify_jwt = false/)
    assert.doesNotMatch(configToml, /\[functions\.email-oauth-start\][\s\S]{0,80}verify_jwt = false/)
    assert.doesNotMatch(configToml, /\[functions\.email-connection\][\s\S]{0,80}verify_jwt = false/)
    assert.doesNotMatch(configToml, /\[functions\.email-query\][\s\S]{0,80}verify_jwt = false/)
    // Calendar gating untouched.
    assert.match(configToml, /\[functions\.calendar-oauth-callback\]/)
  })
})

describe('#337B Edge Function contracts (source)', () => {
  it('oauth-start binds JWT user, PKCE, gate + never exposes client secret', () => {
    assert.match(oauthStart, /verifyUserJwt/)
    assert.match(oauthStart, /generateCodeVerifier|code_challenge/)
    assert.match(oauthStart, /createSignedOAuthState/)
    assert.match(oauthStart, /oauth_pending_nonce/)
    assert.match(oauthStart, /GOOGLE_EMAIL_OAUTH_SCOPES|gmail\.readonly/)
    assert.match(oauthStart, /EMAIL_ENABLED|isEmailEnabled/)
    assert.match(oauthStart, /secret_relay_forbidden/)
    assert.doesNotMatch(oauthStart, /Deno\.env\.get\(['"]GOOGLE_OAUTH_CLIENT_SECRET['"]\)/)
  })

  it('oauth-callback validates state/nonce, encrypts before persistence, safe redirect', () => {
    assert.match(oauthCallback, /verifySignedOAuthState/)
    assert.match(oauthCallback, /oauth_pending_nonce/)
    assert.match(oauthCallback, /encryptToken/)
    assert.match(oauthCallback, /access_token_enc/)
    assert.match(oauthCallback, /refresh_token_enc/)
    assert.match(oauthCallback, /resolveRefreshTokenEnc/)
    assert.match(oauthCallback, /resolveOAuthCallbackReturnUrl/)
    assert.match(oauthCallback, /ownership_mismatch|oauth_nonce_invalid/)
    assert.doesNotMatch(oauthCallback, /console\.(log|info|warn)\([^)]*access_token\b/)
    assert.doesNotMatch(oauthCallback, /console\.(log|info|warn)\([^)]*refresh_token\b/)
  })

  it('email-connection status/disconnect are owner-scoped and wipe tokens', () => {
    assert.match(emailConnection, /verifyUserJwt/)
    assert.match(emailConnection, /user_id_spoof_rejected/)
    assert.match(emailConnection, /action !== 'disconnect'/)
    assert.match(emailConnection, /access_token_enc: null/)
    assert.match(emailConnection, /refresh_token_enc: null/)
    assert.match(emailConnection, /status: 'disconnected'/)
    assert.match(emailConnection, /toPublicConnection/)
    assert.match(emailConnection, /revokeGoogleToken/)
    assert.doesNotMatch(emailConnection, /\.from\(['"]reminders['"]\)/)
    assert.doesNotMatch(emailConnection, /\.from\(['"]memories['"]\)/)
    assert.doesNotMatch(emailConnection, /\.from\(['"]users['"]\)\.delete/)
  })

  it('email-query rejects user_id/token spoofing and gates on EMAIL_ENABLED (source contract)', () => {
    assert.match(emailQuery, /req\.method !== 'POST'/)
    assert.match(emailQuery, /isEmailEnabled/)
    assert.match(emailQuery, /email_disabled/)
    assert.match(emailQuery, /body\.user_id \|\| body\.userId/)
    assert.match(emailQuery, /user_id_spoof_rejected/)
    assert.match(emailQuery, /body\.access_token \|\| body\.refresh_token \|\| body\.client_secret/)
    assert.match(emailQuery, /secret_relay_forbidden/)
    assert.match(emailQuery, /verifyUserJwt/)
    assert.match(emailQuery, /action !== 'email_query'/)
    assert.match(emailQuery, /buildSafeGmailQuery/)
    assert.match(emailQuery, /getValidAccessToken/)
    assert.match(emailQuery, /no_sender_match/)
    assert.match(emailQuery, /'timeout'/)
    assert.match(emailQuery, /'reconnect_required'/)
    assert.match(emailQuery, /'disconnected'/)
    assert.doesNotMatch(emailQuery, /console\.(log|info|warn)\([^)]*(subject|snippet|from|body)\b/)
  })

  it('shared modules avoid logging secrets and content', () => {
    assert.match(sharedCrypto, /AES-GCM/)
    assert.match(sharedOauth, /gmail\.readonly/)
    assert.match(sharedEdge, /redactTokenFields/)
    assert.match(sharedEdge, /logSafe/)
    assert.match(sharedGmail, /Never logs subject/)
  })
})

describe('#337B email-gmail.ts allowlist + query builder (source contract)', () => {
  it('allowlists only Gmail list/get GET and oauth token/revoke POST', () => {
    assert.match(sharedGmail, /ALLOWED_HOSTS = new Set\(\['www\.googleapis\.com', 'oauth2\.googleapis\.com', 'gmail\.googleapis\.com'\]\)/)
    assert.match(sharedGmail, /pathname === '\/token' && m === 'POST'/)
    assert.match(sharedGmail, /pathname === '\/revoke' && m === 'POST'/)
    assert.match(sharedGmail, /gmail\\\/v1\\\/users\\\/me\\\/messages/)
    // The allowlist function itself never grants a write/mutate path — only
    // ever check pathname against /token, /revoke, and messages list/get.
    const allowlistFnMatch = sharedGmail.match(
      /function assertAllowedGooglePath[\s\S]*?\n}/,
    )
    assert.ok(allowlistFnMatch, 'assertAllowedGooglePath function not found')
    const allowlistFnSrc = allowlistFnMatch[0]
    assert.doesNotMatch(allowlistFnSrc, /send|modify|trash|drafts|batchModify|labels|insert|watch/i)
  })

  it('supports all required queryType branches', () => {
    for (const branch of [
      "'unread'",
      "'latest'",
      "'summary'",
      "'today'",
      "'time_window'",
      "'sender'",
      "'important'",
      "'body_one'",
    ]) {
      assert.match(sharedGmail, new RegExp(`case ${branch}`), branch)
    }
    assert.match(sharedGmail, /in:inbox is:important/)
  })

  it('sender search escapes quotes/backslashes and never accepts a raw client q', () => {
    assert.match(sharedGmail, /escapeSenderForQuery/)
    assert.match(sharedGmail, /replace\(\/\["\\\\\]\/g, ''\)/)
    assert.match(sharedGmail, /from:"\$\{sender\}"/)
    assert.doesNotMatch(sharedGmail, /input\.q\b/)
  })

  it('computes IANA-timezone day bounds for today/morning/afternoon', () => {
    assert.match(sharedGmail, /computeDayWindowUnix/)
    assert.match(sharedGmail, /Intl\.DateTimeFormat/)
    assert.match(sharedGmail, /'morning'/)
    assert.match(sharedGmail, /'afternoon'/)
    assert.match(sharedGmail, /invalid_time_zone/)
  })

  it('caps plaintext body extraction at 4000 chars and only for one message', () => {
    assert.match(sharedGmail, /BODY_TEXT_MAX_CHARS = 4000/)
    assert.match(sharedGmail, /extractPlainBody/)
    assert.match(sharedGmail, /includeBodyForFirst/)
  })

  it('marks reconnect_required on invalid_grant during token refresh', () => {
    assert.match(sharedGmail, /invalid_grant/)
    assert.match(sharedGmail, /markReconnectRequired/)
  })

  it('normalizeMinimalMessage + parseFromHeader produce the documented shape', () => {
    assert.match(sharedGmail, /export function parseFromHeader/)
    assert.match(sharedGmail, /export function normalizeMinimalMessage/)
    assert.match(sharedGmail, /fromEmail/)
    assert.match(sharedGmail, /receivedAt/)
    assert.match(sharedGmail, /unread: labels\.includes\('UNREAD'\)/)
  })
})
