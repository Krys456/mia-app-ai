/**
 * #304A1 — Deno shared: PKCE + signed OAuth state.
 * Mirrors lib/server/calendar-oauth.js — keep algorithms in sync.
 */

import { parseEncryptionKey } from './calendar-token-crypto.ts'

export const GOOGLE_CALENDAR_READONLY_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly'
export const GOOGLE_IDENTITY_SCOPES = 'openid email'
export const GOOGLE_OAUTH_SCOPES = `${GOOGLE_CALENDAR_READONLY_SCOPE} ${GOOGLE_IDENTITY_SCOPES}`
export const FORBIDDEN_GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.owned',
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
  input: { userId: string; nonce: string; codeVerifier: string; expiresAtUnix?: number },
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

  const payload = { u: userId, n: nonce, e: exp, v: codeVerifier }
  const body = toB64Url(utf8(JSON.stringify(payload)))
  const sigBuf = await crypto.subtle.sign('HMAC', imported.key, utf8(body))
  const sig = toB64Url(new Uint8Array(sigBuf))
  return { ok: true as const, state: `${body}.${sig}`, expiresAtUnix: exp }
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

  let payload: { u?: string; n?: string; e?: number; v?: string }
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(body)))
  } catch {
    return { ok: false as const, code: 'oauth_state_invalid' }
  }

  const userId = typeof payload?.u === 'string' ? payload.u.trim() : ''
  const nonce = typeof payload?.n === 'string' ? payload.n.trim() : ''
  const codeVerifier = typeof payload?.v === 'string' ? payload.v.trim() : ''
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
  }
}

export function assertReadOnlyCalendarScopes(scopeString: string) {
  const scopes = String(scopeString || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE)) {
    return { ok: false as const, code: 'missing_readonly_scope' }
  }
  for (const bad of FORBIDDEN_GOOGLE_CALENDAR_SCOPES) {
    if (scopes.includes(bad)) return { ok: false as const, code: 'write_scope_forbidden' }
  }
  return { ok: true as const, scopes }
}

/**
 * Parse CALENDAR_RETURN_URL into distinct origins.
 * Supports comma- or newline-separated lists (Preview + Production).
 * Never concatenates — each entry is validated alone via URL().
 * Entries with a second http(s) scheme, commas in the hostname, or
 * non-http(s) protocols are dropped.
 */
export function parseCalendarReturnAllowlist(raw: string | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(raw || '').split(/[\n,]+/)) {
    const entry = part.trim().replace(/\/+$/, '')
    if (!entry) continue
    // Reject glued multi-URL paste (e.g. https://a.comhttps://b.com)
    const scheme = entry.match(/^https?:\/\//i)
    if (!scheme) continue
    if (/https?:\/\//i.test(entry.slice(scheme[0].length))) continue
    let parsed: URL
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

function isMalformedMultiUrl(raw: string): boolean {
  const s = String(raw || '')
  return /,https?:\/\//i.test(s) || /https?:\/\/[^/\s]+,https?/i.test(s)
}

/**
 * Safe post-OAuth return URL — always ONE absolute http(s) URL.
 * Canonical base is the first allowlisted origin from CALENDAR_RETURN_URL.
 * Candidates must share an allowlisted origin; otherwise fall back to canonical.
 */
export function resolveSafeReturnUrl(candidate: string | null | undefined, allowedBase: string) {
  const allowlist = parseCalendarReturnAllowlist(allowedBase)
  if (allowlist.length === 0) {
    // Distinguish empty/garbage vs a single insecure protocol when raw looks like one URL
    const raw = typeof allowedBase === 'string' ? allowedBase.trim() : ''
    if (raw && /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw.split(/[\n,]/)[0] || '')) {
      return { ok: false as const, code: 'return_url_insecure' }
    }
    return { ok: false as const, code: 'return_url_not_configured' }
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(allowlist[0])
  } catch {
    return { ok: false as const, code: 'return_url_not_configured' }
  }

  const fallback = `${baseUrl.origin}/?calendar=connected`
  if (!candidate || typeof candidate !== 'string') {
    return { ok: true as const, url: fallback }
  }

  const trimmed = candidate.trim()
  if (!trimmed || isMalformedMultiUrl(trimmed) || trimmed.includes('\n')) {
    return { ok: true as const, url: fallback }
  }

  let next: URL
  try {
    next = new URL(trimmed, baseUrl.origin)
  } catch {
    return { ok: true as const, url: fallback }
  }
  if (next.hostname.includes(',') || next.hostname.includes('\n')) {
    return { ok: true as const, url: fallback }
  }
  if (next.protocol !== 'https:' && next.hostname !== 'localhost' && next.hostname !== '127.0.0.1') {
    return { ok: true as const, url: fallback }
  }
  if (!allowlist.includes(next.origin) || !next.pathname.startsWith('/')) {
    return { ok: true as const, url: fallback }
  }
  return { ok: true as const, url: next.toString() }
}

/**
 * #358B TEMPORARY — safe redirect diagnostics only (no secrets / tokens / raw env).
 * Remove after live OAuth return URL is confirmed clean.
 */
export function describeReturnRedirectDiag(
  allowedBase: string,
  finalUrl: string | null | undefined,
) {
  const allowlist = parseCalendarReturnAllowlist(allowedBase)
  const selectedOrigin = allowlist[0] ?? null
  let finalOrigin: string | null = null
  let pathname: string | null = null
  const safeQueryKeys: string[] = []
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

export function buildGoogleAuthorizeUrl(p: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scopes?: string
}) {
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
  return { ok: true as const, url: url.toString(), scopes: scopeCheck.scopes }
}
