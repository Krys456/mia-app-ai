/**
 * #304A1 — Deno shared: PKCE + signed OAuth state.
 * Mirrors lib/server/calendar-oauth.js — keep algorithms in sync.
 *
 * State payload: { u, n, e, v, o? } where o is the initiating return origin.
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

export function normalizeReturnOrigin(raw: unknown): string | null {
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

export function parseAllowedReturnBases(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => normalizeReturnOrigin(s.trim()))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
}

export function isAllowedCalendarReturnOrigin(
  originCandidate: unknown,
  allowedBase: string | null | undefined,
): boolean {
  const origin = normalizeReturnOrigin(originCandidate)
  if (!origin) return false

  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }

  for (const base of parseAllowedReturnBases(allowedBase)) {
    if (base === origin) return true
  }

  if (host === 'mia-app-ai.vercel.app') return true
  if (host === 'localhost' || host === '127.0.0.1') return true

  if (
    host.endsWith('-cristiansolinas9-3530s-projects.vercel.app') &&
    host.startsWith('mia-app')
  ) {
    return true
  }

  return false
}

export async function createSignedOAuthState(
  input: {
    userId: string
    nonce: string
    codeVerifier: string
    expiresAtUnix?: number
    returnOrigin?: string | null
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

  const payload: Record<string, string | number> = { u: userId, n: nonce, e: exp, v: codeVerifier }
  const returnOrigin = normalizeReturnOrigin(input.returnOrigin)
  if (returnOrigin) payload.o = returnOrigin

  const body = toB64Url(utf8(JSON.stringify(payload)))
  const sigBuf = await crypto.subtle.sign('HMAC', imported.key, utf8(body))
  const sig = toB64Url(new Uint8Array(sigBuf))
  return {
    ok: true as const,
    state: `${body}.${sig}`,
    expiresAtUnix: exp,
    returnOrigin: returnOrigin || null,
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
    returnOrigin: normalizeReturnOrigin(payload?.o),
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

export function resolveSafeReturnUrl(candidate: string | null | undefined, allowedBase: string) {
  const bases = parseAllowedReturnBases(allowedBase)
  const base =
    bases[0] || (typeof allowedBase === 'string' ? allowedBase.trim().replace(/\/+$/, '') : '')
  if (!base) return { ok: false as const, code: 'return_url_not_configured' }

  let baseUrl: URL
  try {
    baseUrl = new URL(base)
  } catch {
    return { ok: false as const, code: 'return_url_not_configured' }
  }
  if (
    baseUrl.protocol !== 'https:' &&
    baseUrl.hostname !== 'localhost' &&
    baseUrl.hostname !== '127.0.0.1'
  ) {
    return { ok: false as const, code: 'return_url_insecure' }
  }

  const fallback = `${baseUrl.origin}/?calendar=connected`
  if (!candidate || typeof candidate !== 'string') {
    return { ok: true as const, url: fallback }
  }

  let next: URL
  try {
    next = new URL(candidate, baseUrl.origin)
  } catch {
    return { ok: true as const, url: fallback }
  }
  if (next.origin !== baseUrl.origin) {
    if (isAllowedCalendarReturnOrigin(next.origin, allowedBase)) {
      if (!next.pathname.startsWith('/')) return { ok: true as const, url: fallback }
      return {
        ok: true as const,
        url: `${next.origin}${next.pathname}${next.search}${next.hash}`,
      }
    }
    return { ok: true as const, url: fallback }
  }
  if (!next.pathname.startsWith('/')) {
    return { ok: true as const, url: fallback }
  }
  return { ok: true as const, url: next.toString() }
}

export function resolveOAuthCallbackReturnUrl(input: {
  signedReturnOrigin?: string | null
  allowedBase: string
  pathQuery?: string
}) {
  const allowedBase = input.allowedBase
  const bases = parseAllowedReturnBases(allowedBase)
  const fallbackBase = bases[0] || ''

  const signed = normalizeReturnOrigin(input.signedReturnOrigin)
  if (signed) {
    if (!isAllowedCalendarReturnOrigin(signed, allowedBase)) {
      return { ok: false as const, code: 'return_origin_rejected' }
    }
    const flag = typeof input.pathQuery === 'string' ? input.pathQuery : 'calendar=connected'
    return { ok: true as const, url: `${signed}/?${flag}`, origin: signed }
  }

  if (!fallbackBase) return { ok: false as const, code: 'return_url_not_configured' }
  const safe = resolveSafeReturnUrl(null, fallbackBase)
  if (!safe.ok) return safe
  return { ...safe, origin: fallbackBase }
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
