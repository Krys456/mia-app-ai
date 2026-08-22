/**
 * #337B — Deno shared: PKCE + signed OAuth state for Gmail read-only.
 * Mirrors supabase/functions/_shared/calendar-oauth.ts — keep algorithms in
 * sync, but this module is intentionally SEPARATE (different scopes,
 * different table, different return-url allowlist var).
 *
 * State format: base64url(JSON).base64url(HMAC-SHA256)
 * Payload: { u: user_id, n: nonce, e: exp_unix, v: code_verifier, o?: return_origin }
 *
 * HMAC key: SHINKAIDO_EMAIL_ENCRYPTION_KEY (passed in by caller as keyEnv).
 * NEVER log state payload, verifier, or HMAC key.
 */

import { parseEncryptionKey } from './email-token-crypto.ts'

/** Approved Gmail read-only scope (no modify/send). */
export const GOOGLE_GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/** Identity scopes for account_email / google_sub display only. */
export const GOOGLE_IDENTITY_SCOPES = 'openid email'

/** Combined OAuth scope string used by email-oauth-start. */
export const GOOGLE_EMAIL_OAUTH_SCOPES = `${GOOGLE_GMAIL_READONLY_SCOPE} ${GOOGLE_IDENTITY_SCOPES}`

/** Write / dangerous Gmail scopes that must never be requested. */
export const FORBIDDEN_GOOGLE_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://mail.google.com/',
]

export const OAUTH_STATE_TTL_SECONDS = 10 * 60

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function utf8(str: string) {
  return new TextEncoder().encode(str)
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toB64Url(bytes)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(verifier))
  return toB64Url(new Uint8Array(digest))
}

export function generateOAuthNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toB64Url(bytes)
}

async function importHmacKey(keyEnv: string | null | undefined) {
  const parsed = parseEncryptionKey(keyEnv)
  if (!parsed.ok) return parsed
  const key = await crypto.subtle.importKey(
    'raw',
    parsed.key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  return { ok: true as const, key }
}

export async function createSignedOAuthState(
  input: {
    userId: string
    nonce: string
    codeVerifier: string
    returnOrigin?: string | null
    expiresAtUnix?: number
  },
  keyEnv: string | null | undefined,
) {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  const nonce = typeof input.nonce === 'string' ? input.nonce.trim() : ''
  const codeVerifier = typeof input.codeVerifier === 'string' ? input.codeVerifier.trim() : ''
  if (!userId || !nonce || !codeVerifier) {
    return { ok: false as const, code: 'oauth_state_input_invalid' }
  }
  const imported = await importHmacKey(keyEnv)
  if (!imported.ok) return imported

  const exp =
    typeof input.expiresAtUnix === 'number' && Number.isFinite(input.expiresAtUnix)
      ? Math.floor(input.expiresAtUnix)
      : Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS

  const payload: Record<string, unknown> = { u: userId, n: nonce, e: exp, v: codeVerifier }
  const origin =
    typeof input.returnOrigin === 'string' ? input.returnOrigin.trim().replace(/\/+$/, '') : ''
  if (origin) {
    try {
      const u = new URL(origin)
      if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        payload.o = u.origin
      }
    } catch {
      /* omit invalid origin */
    }
  }

  const body = toB64Url(utf8(JSON.stringify(payload)))
  const sigBuf = await crypto.subtle.sign('HMAC', imported.key, utf8(body))
  const sig = toB64Url(new Uint8Array(sigBuf))
  return {
    ok: true as const,
    state: `${body}.${sig}`,
    expiresAtUnix: exp,
    returnOrigin: typeof payload.o === 'string' ? payload.o : null,
  }
}

export async function verifySignedOAuthState(
  state: string,
  opts: { nowUnix?: number; expectedUserId?: string; expectedNonce?: string } = {},
  keyEnv: string | null | undefined = undefined,
) {
  if (typeof state !== 'string' || !state.includes('.')) {
    return { ok: false as const, code: 'oauth_state_invalid' }
  }
  const idx = state.lastIndexOf('.')
  const body = state.slice(0, idx)
  const sig = state.slice(idx + 1)
  if (!body || !sig) return { ok: false as const, code: 'oauth_state_invalid' }

  const imported = await importHmacKey(keyEnv)
  if (!imported.ok) return imported

  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', imported.key, fromB64Url(sig), utf8(body))
  } catch {
    return { ok: false as const, code: 'oauth_state_tampered' }
  }
  if (!valid) return { ok: false as const, code: 'oauth_state_tampered' }

  let payload: { u?: string; n?: string; e?: number; v?: string; o?: string }
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(body)))
  } catch {
    return { ok: false as const, code: 'oauth_state_invalid' }
  }

  const userId = typeof payload?.u === 'string' ? payload.u.trim() : ''
  const nonce = typeof payload?.n === 'string' ? payload.n.trim() : ''
  const codeVerifier = typeof payload?.v === 'string' ? payload.v.trim() : ''
  const returnOrigin = typeof payload?.o === 'string' ? payload.o.trim() : null
  const exp = typeof payload?.e === 'number' ? payload.e : NaN
  if (!userId || !nonce || !codeVerifier || !Number.isFinite(exp)) {
    return { ok: false as const, code: 'oauth_state_invalid' }
  }

  const now =
    typeof opts.nowUnix === 'number' && Number.isFinite(opts.nowUnix)
      ? opts.nowUnix
      : Math.floor(Date.now() / 1000)
  if (exp < now) return { ok: false as const, code: 'oauth_state_expired' }

  if (opts.expectedUserId && opts.expectedUserId !== userId) {
    return { ok: false as const, code: 'oauth_state_user_mismatch' }
  }
  if (opts.expectedNonce && opts.expectedNonce !== nonce) {
    return { ok: false as const, code: 'oauth_state_nonce_mismatch' }
  }

  return {
    ok: true as const,
    userId,
    nonce,
    codeVerifier,
    expiresAtUnix: exp,
    returnOrigin,
  }
}

/** Reject scope grants that omit gmail.readonly or include any forbidden write scope. */
export function assertReadOnlyGmailScopes(scopeString: string) {
  const scopes = String(scopeString || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!scopes.includes(GOOGLE_GMAIL_READONLY_SCOPE)) {
    return { ok: false as const, code: 'missing_readonly_scope' }
  }
  for (const bad of FORBIDDEN_GOOGLE_GMAIL_SCOPES) {
    if (scopes.includes(bad)) return { ok: false as const, code: 'write_scope_forbidden' }
  }
  return { ok: true as const, scopes }
}

/** Parse comma-separated EMAIL_RETURN_URL allowlist into origins. */
export function parseEmailReturnAllowlist(raw: string): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

/** True if origin is allowlisted (exact) or a Preview vercel.app host. */
export function isAllowedEmailReturnOrigin(origin: string, allowlist: string[]): boolean {
  const o = String(origin || '').trim().replace(/\/+$/, '')
  if (!o) return false
  let parsed: URL
  try {
    parsed = new URL(o)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return false
  }
  if (allowlist.includes(parsed.origin)) return true
  if (/\.vercel\.app$/i.test(parsed.hostname)) return true
  return false
}

/**
 * Resolve post-OAuth redirect. Prefers the HMAC-bound returnOrigin when
 * allowlisted, else falls back to the first allowlisted origin. Never
 * redirects to an unauthenticated / unlisted origin (no open redirects).
 */
export function resolveOAuthCallbackReturnUrl(opts: {
  returnOrigin?: string | null
  allowedBases: string
  flag?: string
}) {
  const allowlist = parseEmailReturnAllowlist(opts.allowedBases)
  const flag = typeof opts.flag === 'string' && opts.flag ? opts.flag : 'connected'
  const bound =
    typeof opts.returnOrigin === 'string' ? opts.returnOrigin.trim().replace(/\/+$/, '') : ''

  if (bound && isAllowedEmailReturnOrigin(bound, allowlist)) {
    try {
      const u = new URL(bound)
      u.pathname = '/'
      u.search = ''
      u.hash = ''
      u.searchParams.set('email', flag)
      return { ok: true as const, url: u.toString(), origin: u.origin }
    } catch {
      /* fall through */
    }
  }

  const fallbackOrigin = allowlist[0]
  if (!fallbackOrigin) return { ok: false as const, code: 'return_url_not_configured' }
  try {
    const u = new URL(fallbackOrigin)
    u.pathname = '/'
    u.search = ''
    u.hash = ''
    u.searchParams.set('email', flag)
    return { ok: true as const, url: u.toString(), origin: u.origin }
  } catch {
    return { ok: false as const, code: 'return_url_not_configured' }
  }
}

export function buildGoogleAuthorizeUrl(p: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scopes?: string
}) {
  const scopes = p.scopes || GOOGLE_EMAIL_OAUTH_SCOPES
  const scopeCheck = assertReadOnlyGmailScopes(scopes)
  if (!scopeCheck.ok) return scopeCheck

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', p.clientId)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes)
  url.searchParams.set('state', p.state)
  url.searchParams.set('code_challenge', p.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  // #337B — never silently escalate scopes granted in a prior consent.
  url.searchParams.set('include_granted_scopes', 'false')
  return { ok: true as const, url: url.toString(), scopes: scopeCheck.scopes }
}
