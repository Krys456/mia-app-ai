/**
 * #337B — Deno shared: allowlisted Gmail HTTP + read-only query helpers.
 *
 * Allowed hosts: www.googleapis.com, oauth2.googleapis.com, gmail.googleapis.com
 * Allowed ops:
 *   GET  gmail/v1/users/me/messages           (list)
 *   GET  gmail/v1/users/me/messages/{id}      (get)
 *   POST oauth2.googleapis.com/token          (refresh)
 *   POST oauth2.googleapis.com/revoke         (disconnect, best-effort)
 * Everything else (send, modify, trash, labels, drafts, attachments upload,
 * batchModify, watch, …) is rejected before any network call is made.
 *
 * Uses SHINKAIDO_EMAIL_ENCRYPTION_KEY (via caller-supplied encKey) for token
 * decrypt/encrypt. Never logs subject / from / snippet / body / tokens.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { decryptToken, encryptToken } from './email-token-crypto.ts'
import { resolveRefreshTokenEnc } from './email-edge.ts'

const ALLOWED_HOSTS = new Set(['www.googleapis.com', 'oauth2.googleapis.com', 'gmail.googleapis.com'])
const DEFAULT_TIMEOUT_MS = 9000
const BODY_TEXT_MAX_CHARS = 4000
const SNIPPET_MAX_CHARS = 280
const MAX_RESULTS_CAP = 25
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

// ---------------------------------------------------------------------------
// Allowlisted HTTP
// ---------------------------------------------------------------------------

function assertAllowedGooglePath(pathname: string, method: string): boolean {
  const m = method.toUpperCase()
  if (pathname === '/token' && m === 'POST') return true
  if (pathname === '/revoke' && m === 'POST') return true
  if (/^\/gmail\/v1\/users\/me\/messages\/?$/.test(pathname) && m === 'GET') return true
  if (/^\/gmail\/v1\/users\/me\/messages\/[^/]+\/?$/.test(pathname) && m === 'GET') return true
  return false
}

export type GoogleFetchResult = { status: number; json: unknown }

export async function googleFetchJson(opts: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}): Promise<GoogleFetchResult> {
  let parsed: URL
  try {
    parsed = new URL(opts.url)
  } catch {
    throw new Error('google_forbidden')
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('google_forbidden')
  }
  const method = (opts.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    throw new Error('google_forbidden')
  }
  if (!assertAllowedGooglePath(parsed.pathname, method)) {
    throw new Error('google_forbidden')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(parsed.toString(), {
      method,
      headers: opts.headers || {},
      body: opts.body,
      signal: controller.signal,
    })
    const text = await res.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

async function gmailMessagesList(opts: {
  accessToken: string
  q: string
  maxResults: number
}): Promise<{ ok: true; ids: Array<{ id: string; threadId: string }> } | { ok: false; code: string }> {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  url.searchParams.set('maxResults', String(Math.min(Math.max(1, Math.floor(opts.maxResults)), MAX_RESULTS_CAP)))
  url.searchParams.set('q', String(opts.q || '').slice(0, 500))
  try {
    const res = await googleFetchJson({
      url: url.toString(),
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'google_unauthorized' }
    if (res.status === 429) return { ok: false, code: 'google_rate_limited' }
    if (res.status >= 500) return { ok: false, code: 'google_unavailable' }
    if (res.status !== 200) return { ok: false, code: 'google_unavailable' }
    const body = res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : {}
    const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : []
    const ids = messages
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id : '',
        threadId: typeof m.threadId === 'string' ? m.threadId : '',
      }))
      .filter((m) => m.id)
    return { ok: true, ids }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, code: 'google_timeout' }
    return { ok: false, code: 'google_unavailable' }
  }
}

async function gmailMessagesGet(opts: {
  accessToken: string
  messageId: string
  full: boolean
}): Promise<{ ok: true; raw: unknown } | { ok: false; code: string }> {
  const id = encodeURIComponent(String(opts.messageId || '').trim())
  if (!id) return { ok: false, code: 'invalid_query' }
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`)
  url.searchParams.set('format', opts.full ? 'full' : 'metadata')
  if (!opts.full) {
    url.searchParams.append('metadataHeaders', 'From')
    url.searchParams.append('metadataHeaders', 'Subject')
    url.searchParams.append('metadataHeaders', 'Date')
  }
  try {
    const res = await googleFetchJson({
      url: url.toString(),
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'google_unauthorized' }
    if (res.status === 429) return { ok: false, code: 'google_rate_limited' }
    if (res.status >= 500) return { ok: false, code: 'google_unavailable' }
    if (res.status !== 200) return { ok: false, code: 'google_unavailable' }
    return { ok: true, raw: res.json }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, code: 'google_timeout' }
    return { ok: false, code: 'google_unavailable' }
  }
}

async function googleRefreshAccessToken(opts: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<GoogleFetchResult> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  })
  return googleFetchJson({
    url: 'https://oauth2.googleapis.com/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
}

// ---------------------------------------------------------------------------
// Message normalization (never returns raw Gmail payloads to callers)
// ---------------------------------------------------------------------------

export type MinimalMessage = {
  id: string
  threadId: string
  from: string
  fromEmail: string | null
  subject: string
  snippet: string
  receivedAt: string | null
  unread: boolean
  bodyText?: string
}

type GmailHeader = { name?: string; value?: string }

function headerValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return ''
  const want = name.toLowerCase()
  for (const h of headers as GmailHeader[]) {
    if (!h || typeof h !== 'object') continue
    const n = typeof h.name === 'string' ? h.name.toLowerCase() : ''
    if (n === want && typeof h.value === 'string') return h.value.trim()
  }
  return ''
}

function clip(text: string, max: number): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

/** Parse a Gmail "From" header into a display name + bare email address. */
export function parseFromHeader(raw: string): { name: string; email: string | null } {
  const value = String(raw || '').trim()
  if (!value) return { name: '', email: null }
  const match = value.match(/^(.*?)<([^<>]+)>\s*$/)
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '')
    const email = match[2].trim()
    return { name: name || email, email }
  }
  if (/^[^\s<>]+@[^\s<>]+$/.test(value)) {
    return { name: value, email: value }
  }
  return { name: value, email: null }
}

function parseDateHeaderToIso(dateHeader: string, internalDate: unknown): string | null {
  if (dateHeader) {
    const ms = Date.parse(dateHeader)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
  }
  if (typeof internalDate === 'string' && internalDate) {
    const ms = Number(internalDate)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
  }
  return null
}

/** Normalize a Gmail messages.get payload into the small internal shape. Never leaks raw payloads. */
export function normalizeMinimalMessage(raw: unknown): MinimalMessage {
  const msg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const payload =
    msg.payload && typeof msg.payload === 'object' ? (msg.payload as Record<string, unknown>) : {}
  const headers = Array.isArray(payload.headers) ? payload.headers : []
  const fromRaw = headerValue(headers, 'From')
  const { name: fromName, email: fromEmail } = parseFromHeader(fromRaw)
  const subject = headerValue(headers, 'Subject') || '(no subject)'
  const dateHeader = headerValue(headers, 'Date')
  const labels = Array.isArray(msg.labelIds) ? (msg.labelIds as unknown[]).map(String) : []
  const snippet = clip(typeof msg.snippet === 'string' ? msg.snippet : '', SNIPPET_MAX_CHARS)

  return {
    id: typeof msg.id === 'string' ? msg.id : '',
    threadId: typeof msg.threadId === 'string' ? msg.threadId : '',
    from: fromName || fromRaw,
    fromEmail,
    subject,
    snippet,
    receivedAt: parseDateHeaderToIso(dateHeader, msg.internalDate),
    unread: labels.includes('UNREAD'),
  }
}

function decodeBase64Url(data: string): string {
  const raw = String(data || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4))
  try {
    const bin = atob(raw + pad)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function decodeHtmlEntities(s: string): string {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
}

function htmlToPlainText(html: string): string {
  let s = String(html || '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeHtmlEntities(s)
  s = s.replace(/\u00a0/g, ' ')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]{2,}/g, ' ').trim()
  return s
}

function extractBodiesFromPart(part: unknown): { plain: string; html: string } {
  let plain = ''
  let html = ''
  if (!part || typeof part !== 'object') return { plain, html }
  const p = part as Record<string, unknown>
  const mime = typeof p.mimeType === 'string' ? p.mimeType.toLowerCase() : ''
  const body = p.body && typeof p.body === 'object' ? (p.body as Record<string, unknown>) : null
  const data = body && typeof body.data === 'string' ? body.data : ''

  if (mime === 'text/plain' && data) {
    plain = decodeBase64Url(data)
  } else if (mime === 'text/html' && data) {
    html = decodeBase64Url(data)
  }

  if (Array.isArray(p.parts)) {
    for (const child of p.parts) {
      const nested = extractBodiesFromPart(child)
      if (!plain && nested.plain) plain = nested.plain
      if (!html && nested.html) html = nested.html
      if (plain && html) break
    }
  }
  return { plain, html }
}

/** Extract a capped plaintext body from a full-format Gmail message. Only call for ONE message. */
export function extractPlainBody(raw: unknown): string {
  const msg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {}
  const bodies = extractBodiesFromPart(payload)
  let bodyText = bodies.plain || ''
  if (!bodyText && bodies.html) bodyText = htmlToPlainText(bodies.html)
  return clip(bodyText, BODY_TEXT_MAX_CHARS)
}

// ---------------------------------------------------------------------------
// IANA-timezone day bounds (for today / morning / afternoon queries)
// ---------------------------------------------------------------------------

function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const hour = map.hour === '24' ? 0 : Number(map.hour)
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function localMidnightUtcMs(now: Date, timeZone: string): number {
  const zp = getZonedParts(now, timeZone)
  const offsetMs = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, zp.minute, zp.second) - now.getTime()
  const localMidnightAsUtc = Date.UTC(zp.year, zp.month - 1, zp.day, 0, 0, 0)
  return localMidnightAsUtc - offsetMs
}

export type DayWindowResult =
  | { ok: true; afterUnix: number; beforeUnix: number }
  | { ok: false; code: string }

/** Compute UTC unix-second after:/before: bounds for a local day window in an IANA timeZone. */
export function computeDayWindowUnix(
  timeZone: string,
  window: string,
  now: Date = new Date(),
): DayWindowResult {
  const tz = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'UTC'
  try {
    // Throws for invalid IANA identifiers.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    return { ok: false, code: 'invalid_time_zone' }
  }

  const midnightMs = localMidnightUtcMs(now, tz)
  const dayMs = 24 * 60 * 60 * 1000
  const halfDayMs = 12 * 60 * 60 * 1000

  let afterMs = midnightMs
  let beforeMs = midnightMs + dayMs
  if (window === 'morning') {
    afterMs = midnightMs
    beforeMs = midnightMs + halfDayMs
  } else if (window === 'afternoon') {
    afterMs = midnightMs + halfDayMs
    beforeMs = midnightMs + dayMs
  }

  return {
    ok: true,
    afterUnix: Math.floor(afterMs / 1000),
    beforeUnix: Math.floor(beforeMs / 1000),
  }
}

// ---------------------------------------------------------------------------
// Safe query builder — the ONLY way to turn client input into a Gmail `q`
// ---------------------------------------------------------------------------

export type GmailQueryType =
  | 'today'
  | 'unread'
  | 'latest'
  | 'sender'
  | 'time_window'
  | 'summary'
  | 'body_one'

export type GmailQueryInput = {
  queryType: string
  sender?: string
  timeWindow?: string
  timeZone?: string
  messageId?: string
  includeBody?: boolean
  maxResults?: number
}

export type BuiltGmailQuery =
  | { ok: true; mode: 'list'; q: string; maxResults: number }
  | { ok: true; mode: 'single'; messageId: string }
  | { ok: false; code: string }

function clampMaxResults(n: unknown, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : fallback
  return Math.min(Math.max(1, v), MAX_RESULTS_CAP)
}

/** Strip quotes/backslashes/newlines from free-text sender input before embedding in a Gmail query. */
function escapeSenderForQuery(raw: string): string {
  return String(raw || '')
    .replace(/["\\]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * Build a safe Gmail search query from a structured, validated request.
 * Never accepts a raw client-supplied `q` string — every branch composes
 * the query from fixed operators + sanitized values only.
 */
export function buildSafeGmailQuery(input: GmailQueryInput): BuiltGmailQuery {
  const queryType = typeof input.queryType === 'string' ? input.queryType.trim() : ''
  const timeZone = typeof input.timeZone === 'string' && input.timeZone.trim() ? input.timeZone.trim() : 'UTC'

  switch (queryType) {
    case 'unread':
      return { ok: true, mode: 'list', q: 'in:inbox is:unread', maxResults: clampMaxResults(input.maxResults, 10) }

    case 'latest':
      return { ok: true, mode: 'list', q: 'in:inbox', maxResults: clampMaxResults(input.maxResults, 5) }

    case 'summary':
      return { ok: true, mode: 'list', q: 'in:inbox', maxResults: clampMaxResults(input.maxResults, 15) }

    case 'today': {
      const bounds = computeDayWindowUnix(timeZone, 'today')
      if (!bounds.ok) return bounds
      return {
        ok: true,
        mode: 'list',
        q: `in:inbox after:${bounds.afterUnix} before:${bounds.beforeUnix}`,
        maxResults: clampMaxResults(input.maxResults, 20),
      }
    }

    case 'time_window': {
      const window = typeof input.timeWindow === 'string' && input.timeWindow.trim() ? input.timeWindow.trim() : 'today'
      const bounds = computeDayWindowUnix(timeZone, window)
      if (!bounds.ok) return bounds
      return {
        ok: true,
        mode: 'list',
        q: `in:inbox after:${bounds.afterUnix} before:${bounds.beforeUnix}`,
        maxResults: clampMaxResults(input.maxResults, 20),
      }
    }

    case 'sender': {
      const sender = escapeSenderForQuery(input.sender || '')
      if (!sender) return { ok: false, code: 'sender_required' }
      return { ok: true, mode: 'list', q: `from:"${sender}"`, maxResults: clampMaxResults(input.maxResults, 10) }
    }

    case 'body_one': {
      const messageId = typeof input.messageId === 'string' ? input.messageId.trim() : ''
      if (!messageId) return { ok: false, code: 'message_id_required' }
      return { ok: true, mode: 'single', messageId }
    }

    default:
      return { ok: false, code: 'unknown_query_type' }
  }
}

// ---------------------------------------------------------------------------
// Owner-scoped access-token resolution (decrypt / refresh / reconnect)
// ---------------------------------------------------------------------------

export type AccessTokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; code: 'disconnected' | 'reconnect_required' | 'error' }

async function markReconnectRequired(supabase: SupabaseClient, userId: string, code: string) {
  try {
    await supabase
      .from('email_connections')
      .update({
        status: 'reconnect_required',
        last_error_code: code,
        access_token_enc: null,
        token_expires_at: null,
      })
      .eq('user_id', userId)
      .eq('provider', 'google')
  } catch {
    /* soft — reconnect_required is still returned to caller */
  }
}

/** Load, decrypt, and (if needed) refresh the caller's Gmail access token. Fails closed. */
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string,
  opts: { encKey: string; clientId: string; clientSecret: string; now?: Date },
): Promise<AccessTokenResult> {
  const now = opts.now instanceof Date ? opts.now : new Date()

  const { data: row, error } = await supabase
    .from('email_connections')
    .select('id, status, access_token_enc, refresh_token_enc, token_expires_at')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle()

  if (error) return { ok: false, code: 'error' }
  if (!row) return { ok: false, code: 'disconnected' }
  if (row.status === 'reconnect_required') return { ok: false, code: 'reconnect_required' }
  if (row.status !== 'connected') return { ok: false, code: 'disconnected' }

  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : NaN
  const stillValid =
    typeof row.access_token_enc === 'string' &&
    row.access_token_enc &&
    Number.isFinite(expiresAt) &&
    expiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > now.getTime()

  if (stillValid) {
    const dec = await decryptToken(row.access_token_enc as string, opts.encKey)
    if (!dec.ok) return { ok: false, code: 'error' }
    return { ok: true, accessToken: dec.plaintext, refreshed: false }
  }

  if (typeof row.refresh_token_enc !== 'string' || !row.refresh_token_enc) {
    await markReconnectRequired(supabase, userId, 'refresh_token_missing')
    return { ok: false, code: 'reconnect_required' }
  }

  const refreshDec = await decryptToken(row.refresh_token_enc, opts.encKey)
  if (!refreshDec.ok) return { ok: false, code: 'error' }

  let refreshRes: GoogleFetchResult
  try {
    refreshRes = await googleRefreshAccessToken({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      refreshToken: refreshDec.plaintext,
    })
  } catch {
    return { ok: false, code: 'error' }
  }

  const body = refreshRes.json && typeof refreshRes.json === 'object' ? (refreshRes.json as Record<string, unknown>) : {}
  const errorCode = typeof body.error === 'string' ? body.error : ''
  if (refreshRes.status !== 200 || errorCode) {
    if (errorCode === 'invalid_grant') {
      await markReconnectRequired(supabase, userId, 'invalid_grant')
      return { ok: false, code: 'reconnect_required' }
    }
    return { ok: false, code: 'error' }
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  if (!accessToken) {
    await markReconnectRequired(supabase, userId, 'refresh_failed')
    return { ok: false, code: 'reconnect_required' }
  }

  const encAccess = await encryptToken(accessToken, opts.encKey)
  if (!encAccess.ok) return { ok: false, code: 'error' }

  const newRefresh = typeof body.refresh_token === 'string' ? body.refresh_token : null
  let newRefreshEnc: string | null = null
  if (newRefresh) {
    const encR = await encryptToken(newRefresh, opts.encKey)
    if (!encR.ok) return { ok: false, code: 'error' }
    newRefreshEnc = encR.ciphertext
  }

  const resolved = resolveRefreshTokenEnc({
    newRefreshToken: newRefresh,
    existingRefreshTokenEnc: row.refresh_token_enc,
    newRefreshEnc,
  })

  const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) ? body.expires_in : 3600
  const tokenExpiresAt = new Date(now.getTime() + Math.max(60, expiresIn) * 1000).toISOString()

  const { error: updateError } = await supabase
    .from('email_connections')
    .update({
      access_token_enc: encAccess.ciphertext,
      refresh_token_enc: resolved.refreshTokenEnc,
      token_expires_at: tokenExpiresAt,
      status: resolved.status,
      last_error_code: resolved.status === 'connected' ? null : 'refresh_token_missing',
      last_used_at: now.toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'google')

  if (updateError) return { ok: false, code: 'error' }
  if (resolved.status !== 'connected') return { ok: false, code: 'reconnect_required' }

  return { ok: true, accessToken, refreshed: true }
}

// ---------------------------------------------------------------------------
// List + hydrate
// ---------------------------------------------------------------------------

export type FetchListResult =
  | { ok: true; messages: MinimalMessage[] }
  | { ok: false; code: string }

/**
 * Run a built list query end-to-end: list message ids, then hydrate metadata
 * for each (and, at most, a full body for ONE message when requested).
 */
export async function fetchMessageList(opts: {
  accessToken: string
  q: string
  maxResults: number
  includeBodyForFirst?: boolean
}): Promise<FetchListResult> {
  const listRes = await gmailMessagesList({ accessToken: opts.accessToken, q: opts.q, maxResults: opts.maxResults })
  if (!listRes.ok) return listRes

  const messages: MinimalMessage[] = []
  for (let i = 0; i < listRes.ids.length; i += 1) {
    const wantsBody = Boolean(opts.includeBodyForFirst) && i === 0
    const getRes = await gmailMessagesGet({
      accessToken: opts.accessToken,
      messageId: listRes.ids[i].id,
      full: wantsBody,
    })
    if (!getRes.ok) {
      if (getRes.code === 'google_unauthorized') return getRes
      continue
    }
    const normalized = normalizeMinimalMessage(getRes.raw)
    if (wantsBody) normalized.bodyText = extractPlainBody(getRes.raw)
    messages.push(normalized)
  }
  return { ok: true, messages }
}

export type FetchSingleResult =
  | { ok: true; message: MinimalMessage }
  | { ok: false; code: string }

/** Fetch exactly one message with full body (queryType: body_one). */
export async function fetchSingleMessage(opts: {
  accessToken: string
  messageId: string
}): Promise<FetchSingleResult> {
  const getRes = await gmailMessagesGet({ accessToken: opts.accessToken, messageId: opts.messageId, full: true })
  if (!getRes.ok) return getRes
  const normalized = normalizeMinimalMessage(getRes.raw)
  normalized.bodyText = extractPlainBody(getRes.raw)
  return { ok: true, message: normalized }
}

/** Best-effort Google token revoke. Never throws. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await googleFetchJson({
      url: 'https://oauth2.googleapis.com/revoke',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch {
    /* best-effort */
  }
}
