/**
 * #304A1 — PKCE + signed OAuth state (server / Edge only).
 *
 * State format: base64url(JSON).base64url(HMAC-SHA256)
 * Payload: { u: user_id, n: nonce, e: exp_unix, v: code_verifier }
 *
 * HMAC key material derived from SHINKAIDO_CALENDAR_ENCRYPTION_KEY (or explicit override).
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
 * @param {{ userId: string, nonce: string, codeVerifier: string, expiresAtUnix?: number }} input
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
        ? process.env.SHINKAIDO_CALENDAR_ENCRYPTION_KEY
        : ''
  const imported = await importHmacKey(envKey)
  if (!imported.ok) return imported

  const exp =
    typeof input.expiresAtUnix === 'number' && Number.isFinite(input.expiresAtUnix)
      ? Math.floor(input.expiresAtUnix)
      : Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS

  const payload = { u: userId, n: nonce, e: exp, v: codeVerifier }
  const body = toB64Url(utf8(JSON.stringify(payload)))
  const sigBuf = await globalThis.crypto.subtle.sign('HMAC', imported.key, utf8(body))
  const sig = toB64Url(new Uint8Array(sigBuf))
  return { ok: true, state: `${body}.${sig}`, expiresAtUnix: exp }
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
        ? process.env.SHINKAIDO_CALENDAR_ENCRYPTION_KEY
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

  return {
    ok: true,
    userId,
    nonce,
    codeVerifier,
    expiresAtUnix: exp,
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
 * Parse CALENDAR_RETURN_URL into distinct origins.
 * Supports comma- or newline-separated lists. Never concatenates entries.
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
export function parseCalendarReturnAllowlist(raw) {
  const seen = new Set()
  const out = []
  for (const part of String(raw || '').split(/[\n,]+/)) {
    const entry = part.trim().replace(/\/+$/, '')
    if (!entry) continue
    const scheme = entry.match(/^https?:\/\//i)
    if (!scheme) continue
    if (/https?:\/\//i.test(entry.slice(scheme[0].length))) continue
    let parsed
    try {
      parsed = new URL(entry)
    } catch {
      continue
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      continue
    }
    if (parsed.hostname.includes(',') || parsed.hostname.includes('\n')) continue
    const origin = parsed.origin
    if (seen.has(origin)) continue
    seen.add(origin)
    out.push(origin)
  }
  return out
}

function isMalformedMultiUrl(raw) {
  const s = String(raw || '')
  return /,https?:\/\//i.test(s) || /https?:\/\/[^/\s]+,https?/i.test(s)
}

/**
 * Safe return URL allowlist check — no open redirects.
 * Always returns ONE absolute http(s) URL; never a comma-joined hostname.
 * Canonical base = first allowlisted origin from CALENDAR_RETURN_URL.
 * @param {string | null | undefined} candidate
 * @param {string} allowedBase  e.g. https://app.example.com or comma-separated list
 */
export function resolveSafeReturnUrl(candidate, allowedBase) {
  const allowlist = parseCalendarReturnAllowlist(allowedBase)
  if (allowlist.length === 0) {
    const raw = typeof allowedBase === 'string' ? allowedBase.trim() : ''
    if (raw && /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw.split(/[\n,]/)[0] || '')) {
      return { ok: false, code: 'return_url_insecure' }
    }
    return { ok: false, code: 'return_url_not_configured' }
  }

  let baseUrl
  try {
    baseUrl = new URL(allowlist[0])
  } catch {
    return { ok: false, code: 'return_url_not_configured' }
  }

  // Default: Settings deep-link via query flag (SPA has no router paths for settings).
  const fallback = `${baseUrl.origin}/?calendar=connected`

  if (!candidate || typeof candidate !== 'string') {
    return { ok: true, url: fallback }
  }

  const trimmed = candidate.trim()
  if (!trimmed || isMalformedMultiUrl(trimmed) || trimmed.includes('\n')) {
    return { ok: true, url: fallback }
  }

  let next
  try {
    next = new URL(trimmed, baseUrl.origin)
  } catch {
    return { ok: true, url: fallback }
  }

  if (next.hostname.includes(',') || next.hostname.includes('\n')) {
    return { ok: true, url: fallback }
  }
  if (next.protocol !== 'https:' && next.hostname !== 'localhost' && next.hostname !== '127.0.0.1') {
    return { ok: true, url: fallback }
  }
  if (!allowlist.includes(next.origin) || !next.pathname.startsWith('/')) {
    return { ok: true, url: fallback }
  }
  return { ok: true, url: next.toString() }
}

/**
 * Build Google authorize URL.
 * @param {{ clientId: string, redirectUri: string, state: string, codeChallenge: string, scopes?: string }} p
 */

/**
 * #358B TEMPORARY — safe redirect diagnostics (no secrets / raw env).
 */
export function describeReturnRedirectDiag(allowedBase, finalUrl) {
  const allowlist = parseCalendarReturnAllowlist(allowedBase)
  const selectedOrigin = allowlist[0] ?? null
  let finalOrigin = null
  let pathname = null
  const safeQueryKeys = []
  const final = typeof finalUrl === 'string' ? finalUrl : ''
  if (final) {
    try {
      const u = new URL(final)
      finalOrigin = u.origin
      pathname = u.pathname
      for (const key of u.searchParams.keys()) {
        if (key === 'calendar' || key === 'code') safeQueryKeys.push(key)
      }
    } catch {
      /* keep nulls */
    }
  }
  return {
    diag: '358b_return_redirect',
    sourceEnvName: 'CALENDAR_RETURN_URL',
    candidateCount: allowlist.length,
    candidateOrigins: allowlist.slice(),
    selectedOrigin,
    finalOrigin,
    pathname,
    safeQueryKeys,
    containsComma: Boolean(final && (final.includes(',') || (finalOrigin || '').includes(','))),
    containsCommaHttp: /,http/i.test(final),
    containsCommaHttps: /,https/i.test(final),
  }
}

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
