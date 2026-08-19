/**
 * #304A1 — PKCE + signed OAuth state (server / Edge only).
 *
 * State format: base64url(JSON).base64url(HMAC-SHA256)
 * Payload: { u: user_id, n: nonce, e: exp_unix, v: code_verifier, o?: return_origin }
 *
 * Optional `o` binds the initiating app origin (Preview/Production) so the callback
 * returns to the SAME origin/session. `o` is HMAC-protected and allowlisted —
 * never an open redirect.
 *
 * HMAC key material derived from CALENDAR_TOKEN_ENCRYPTION_KEY (or explicit override).
 * NEVER log state payload, verifier, or HMAC key.
 */

import { parseEncryptionKey } from './calendar-token-crypto.js'

/** Approved Google Calendar read-only scope (no write). */
export const GOOGLE_CALENDAR_READONLY_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly'

/** Identity scopes for account_email / google_sub display only — not Calendar write. */
export const GOOGLE_IDENTITY_SCOPES = 'openid email'

/** Combined OAuth scope string used by calendar-oauth-start. */
export const GOOGLE_OAUTH_SCOPES = `${GOOGLE_CALENDAR_READONLY_SCOPE} ${GOOGLE_IDENTITY_SCOPES}`

/** Write / dangerous Calendar scopes that must never be requested in #304A1. */
export const FORBIDDEN_GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.owned',
]

export const OAUTH_STATE_TTL_SECONDS = 10 * 60

/**
 * @param {Uint8Array} bytes
 */
function toB64Url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/**
 * @param {string} s
 */
function fromB64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const raw = b64 + pad
  if (typeof atob === 'function') {
    const bin = atob(raw)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(raw, 'base64'))
}

/**
 * @param {string} str
 */
function utf8(str) {
  return new TextEncoder().encode(str)
}

/**
 * @returns {string}
 */
export function generateCodeVerifier() {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return toB64Url(bytes)
}

/**
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function generateCodeChallenge(verifier) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8(verifier))
  return toB64Url(new Uint8Array(digest))
}

/**
 * @returns {string}
 */
export function generateOAuthNonce() {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return toB64Url(bytes)
}

/**
 * @param {string | null | undefined} keyEnv
 */
async function importHmacKey(keyEnv) {
  const parsed = parseEncryptionKey(keyEnv)
  if (!parsed.ok) return parsed
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    parsed.key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  return { ok: true, key }
}

/**
 * @param {{
 *   userId: string
 *   nonce: string
 *   codeVerifier: string
 *   expiresAtUnix?: number
 *   returnOrigin?: string | null
 *   correlationId?: string | null
 * }} input
 * @param {string | null | undefined} [keyEnv]
 */
export async function createSignedOAuthState(input, keyEnv = undefined) {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  const nonce = typeof input.nonce === 'string' ? input.nonce.trim() : ''
  const codeVerifier = typeof input.codeVerifier === 'string' ? input.codeVerifier.trim() : ''
  if (!userId || !nonce || !codeVerifier) {
    return { ok: false, code: 'oauth_state_input_invalid' }
  }

  const envKey =
    keyEnv !== undefined
      ? keyEnv
      : typeof process !== 'undefined'
        ? process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
        : ''
  const imported = await importHmacKey(envKey)
  if (!imported.ok) return imported

  const exp =
    typeof input.expiresAtUnix === 'number' && Number.isFinite(input.expiresAtUnix)
      ? Math.floor(input.expiresAtUnix)
      : Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS

  /** @type {Record<string, string | number>} */
  const payload = { u: userId, n: nonce, e: exp, v: codeVerifier }
  const returnOrigin = normalizeReturnOrigin(input.returnOrigin)
  if (returnOrigin) payload.o = returnOrigin
  const correlationId =
    typeof input.correlationId === 'string' ? input.correlationId.trim().slice(0, 64) : ''
  if (correlationId) payload.c = correlationId

  const body = toB64Url(utf8(JSON.stringify(payload)))
  const sigBuf = await globalThis.crypto.subtle.sign('HMAC', imported.key, utf8(body))
  const sig = toB64Url(new Uint8Array(sigBuf))
  return {
    ok: true,
    state: `${body}.${sig}`,
    expiresAtUnix: exp,
    returnOrigin: returnOrigin || null,
    correlationId: correlationId || null,
  }
}

/**
 * @param {string} state
 * @param {{ nowUnix?: number, expectedUserId?: string, expectedNonce?: string }} [opts]
 * @param {string | null | undefined} [keyEnv]
 */
export async function verifySignedOAuthState(state, opts = {}, keyEnv = undefined) {
  if (typeof state !== 'string' || !state.includes('.')) {
    return { ok: false, code: 'oauth_state_invalid' }
  }
  const idx = state.lastIndexOf('.')
  const body = state.slice(0, idx)
  const sig = state.slice(idx + 1)
  if (!body || !sig) return { ok: false, code: 'oauth_state_invalid' }

  const envKey =
    keyEnv !== undefined
      ? keyEnv
      : typeof process !== 'undefined'
        ? process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
        : ''
  const imported = await importHmacKey(envKey)
  if (!imported.ok) return imported

  let valid = false
  try {
    valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      imported.key,
      fromB64Url(sig),
      utf8(body),
    )
  } catch {
    return { ok: false, code: 'oauth_state_tampered' }
  }
  if (!valid) return { ok: false, code: 'oauth_state_tampered' }

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(body)))
  } catch {
    return { ok: false, code: 'oauth_state_invalid' }
  }

  const userId = typeof payload?.u === 'string' ? payload.u.trim() : ''
  const nonce = typeof payload?.n === 'string' ? payload.n.trim() : ''
  const codeVerifier = typeof payload?.v === 'string' ? payload.v.trim() : ''
  const exp = typeof payload?.e === 'number' ? payload.e : NaN
  if (!userId || !nonce || !codeVerifier || !Number.isFinite(exp)) {
    return { ok: false, code: 'oauth_state_invalid' }
  }

  const now =
    typeof opts.nowUnix === 'number' && Number.isFinite(opts.nowUnix)
      ? opts.nowUnix
      : Math.floor(Date.now() / 1000)
  if (exp < now) return { ok: false, code: 'oauth_state_expired' }

  if (opts.expectedUserId && opts.expectedUserId !== userId) {
    return { ok: false, code: 'oauth_state_user_mismatch' }
  }
  if (opts.expectedNonce && opts.expectedNonce !== nonce) {
    return { ok: false, code: 'oauth_state_nonce_mismatch' }
  }

  const returnOrigin = normalizeReturnOrigin(payload?.o)
  const correlationId =
    typeof payload?.c === 'string' && payload.c.trim() ? payload.c.trim().slice(0, 64) : null

  return {
    ok: true,
    userId,
    nonce,
    codeVerifier,
    expiresAtUnix: exp,
    returnOrigin,
    correlationId,
  }
}

/**
 * Assert scopes are read-only Calendar + identity only.
 * @param {string} scopeString
 */
export function assertReadOnlyCalendarScopes(scopeString) {
  const scopes = String(scopeString || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE)) {
    return { ok: false, code: 'missing_readonly_scope' }
  }
  for (const bad of FORBIDDEN_GOOGLE_CALENDAR_SCOPES) {
    if (scopes.includes(bad)) return { ok: false, code: 'write_scope_forbidden' }
  }
  return { ok: true, scopes }
}

/**
 * Normalize a candidate to `https://host` / localhost origin, or null.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeReturnOrigin(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.username || url.password) return null
    if (url.protocol === 'https:') return url.origin
    if (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    ) {
      return url.origin
    }
    return null
  } catch {
    return null
  }
}

/**
 * Parse CALENDAR_RETURN_URL (single origin or comma-separated list).
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
export function parseAllowedReturnBases(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => normalizeReturnOrigin(s.trim()))
    .filter((s) => typeof s === 'string' && s.length > 0)
}

/**
 * Allowlist for OAuth return origins (no open redirects).
 * Permits: configured CALENDAR_RETURN_URL base(s), production host,
 * and this project's Vercel Preview / deployment hosts.
 *
 * @param {unknown} originCandidate
 * @param {string | null | undefined} allowedBase  CALENDAR_RETURN_URL
 * @returns {boolean}
 */
export function isAllowedCalendarReturnOrigin(originCandidate, allowedBase) {
  const origin = normalizeReturnOrigin(originCandidate)
  if (!origin) return false

  let host
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }

  for (const base of parseAllowedReturnBases(allowedBase)) {
    if (base === origin) return true
  }

  // Canonical Production host for this app.
  if (host === 'mia-app-ai.vercel.app') return true

  // Local Vite / Node.
  if (host === 'localhost' || host === '127.0.0.1') return true

  // Vercel Preview + unique deployment hosts for this team/project only.
  // Requires suffix `.vercel.app` (blocks evil.vercel.app.attacker.com).
  if (
    host.endsWith('-cristiansolinas9-3530s-projects.vercel.app') &&
    host.startsWith('mia-app')
  ) {
    return true
  }

  return false
}

/**
 * Resolve callback return URL: prefer HMAC-signed initiating origin when allowlisted.
 * Falls back to CALENDAR_RETURN_URL (first configured base).
 *
 * @param {{
 *   signedReturnOrigin?: string | null
 *   allowedBase: string
 *   pathQuery?: string
 * }} input
 */
export function resolveOAuthCallbackReturnUrl(input) {
  const allowedBase = input.allowedBase
  const bases = parseAllowedReturnBases(allowedBase)
  const fallbackBase = bases[0] || ''

  const signed = normalizeReturnOrigin(input.signedReturnOrigin)
  if (signed) {
    if (!isAllowedCalendarReturnOrigin(signed, allowedBase)) {
      return { ok: false, code: 'return_origin_rejected' }
    }
    const flag = typeof input.pathQuery === 'string' ? input.pathQuery : 'calendar=connected'
    return { ok: true, url: `${signed}/?${flag}`, origin: signed }
  }

  if (!fallbackBase) return { ok: false, code: 'return_url_not_configured' }
  const safe = resolveSafeReturnUrl(null, fallbackBase)
  if (!safe.ok) return safe
  return { ...safe, origin: fallbackBase }
}

/**
 * Safe return URL allowlist check — no open redirects.
 * @param {string} candidate
 * @param {string} allowedBase  e.g. https://app.example.com (or comma-separated)
 */
export function resolveSafeReturnUrl(candidate, allowedBase) {
  const bases = parseAllowedReturnBases(allowedBase)
  const base = bases[0] || (typeof allowedBase === 'string' ? allowedBase.trim().replace(/\/+$/, '') : '')
  if (!base) return { ok: false, code: 'return_url_not_configured' }

  let baseUrl
  try {
    baseUrl = new URL(base)
  } catch {
    return { ok: false, code: 'return_url_not_configured' }
  }
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '127.0.0.1') {
    return { ok: false, code: 'return_url_insecure' }
  }

  // Default: Settings deep-link via query flag (SPA has no router paths for settings).
  const fallback = `${baseUrl.origin}/?calendar=connected`

  if (!candidate || typeof candidate !== 'string') {
    return { ok: true, url: fallback }
  }

  let next
  try {
    next = new URL(candidate, baseUrl.origin)
  } catch {
    return { ok: true, url: fallback }
  }

  // Candidate may be another allowlisted origin (signed return path).
  if (next.origin !== baseUrl.origin) {
    if (isAllowedCalendarReturnOrigin(next.origin, allowedBase)) {
      if (!next.pathname.startsWith('/')) return { ok: true, url: fallback }
      return { ok: true, url: `${next.origin}${next.pathname}${next.search}${next.hash}` }
    }
    return { ok: true, url: fallback }
  }
  // Only allow same-origin relative paths under /
  if (!next.pathname.startsWith('/')) {
    return { ok: true, url: fallback }
  }
  return { ok: true, url: next.toString() }
}

/**
 * Build Google authorize URL.
 * @param {{ clientId: string, redirectUri: string, state: string, codeChallenge: string, scopes?: string }} p
 */
export function buildGoogleAuthorizeUrl(p) {
  const scopes = p.scopes || GOOGLE_OAUTH_SCOPES
  const scopeCheck = assertReadOnlyCalendarScopes(scopes)
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
  url.searchParams.set('include_granted_scopes', 'false')
  return { ok: true, url: url.toString(), scopes: scopeCheck.scopes }
}
