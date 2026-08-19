/**
 * #311 — Allowlisted Google HTTP client (Gmail read + OAuth token refresh).
 *
 * Allowed hosts: www.googleapis.com, oauth2.googleapis.com, gmail.googleapis.com
 * Allowed Gmail ops: GET users/me/messages, GET users/me/messages/{id}
 * Forbidden: send, modify, trash, labels mutate, drafts, insert.
 */

import { EmailError, emailErrorFromHttpStatus } from './email-errors.js'

export const GOOGLE_HTTP_TIMEOUT_MS = 9000
export const GOOGLE_HTTP_MAX_RETRIES = 1
export const GOOGLE_HTTP_RETRY_AFTER_CAP_MS = 5000

const ALLOWED_HOSTS = new Set([
  'www.googleapis.com',
  'oauth2.googleapis.com',
  'gmail.googleapis.com',
])

/**
 * @param {string} url
 */
export function assertAllowedGoogleUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new EmailError('google_unavailable', 'google_unavailable')
  }
  if (parsed.protocol !== 'https:') {
    throw new EmailError('google_unavailable', 'google_unavailable')
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new EmailError('google_unavailable', 'google_unavailable')
  }
  return parsed
}

/**
 * @param {string} path
 * @param {string} method
 */
function assertReadOnlyGmailPath(path, method) {
  const m = method.toUpperCase()
  // Token refresh / revoke
  if (path === '/token' || path === '/revoke') return
  // Gmail profile (optional)
  if (/^\/gmail\/v1\/users\/me\/profile\/?$/.test(path) && m === 'GET') return
  // List messages
  if (/^\/gmail\/v1\/users\/me\/messages\/?$/.test(path) && m === 'GET') return
  // Get message
  if (/^\/gmail\/v1\/users\/me\/messages\/[^/]+\/?$/.test(path) && m === 'GET') return
  // Deny everything else (send, modify, trash, labels, drafts, attachments upload, …)
  throw new EmailError('google_forbidden', 'google_forbidden')
}

/**
 * @param {Headers | Record<string, string> | undefined} headers
 */
function readRetryAfterMs(headers) {
  if (!headers) return 0
  const raw =
    typeof headers.get === 'function'
      ? headers.get('retry-after')
      : headers['retry-after'] || headers['Retry-After']
  if (!raw) return 0
  const asNum = Number(raw)
  if (Number.isFinite(asNum) && asNum >= 0) {
    return Math.min(asNum * 1000, GOOGLE_HTTP_RETRY_AFTER_CAP_MS)
  }
  const when = Date.parse(raw)
  if (Number.isFinite(when)) {
    return Math.min(Math.max(0, when - Date.now()), GOOGLE_HTTP_RETRY_AFTER_CAP_MS)
  }
  return 0
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {{
 *   url: string
 *   method?: string
 *   headers?: Record<string, string>
 *   body?: string | null
 *   timeoutMs?: number
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function googleFetchJson(opts) {
  const parsed = assertAllowedGoogleUrl(opts.url)
  const method = (opts.method || 'GET').toUpperCase()
  if (!['GET', 'POST'].includes(method)) {
    throw new EmailError('google_forbidden', 'google_forbidden')
  }
  assertReadOnlyGmailPath(parsed.pathname, method)

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new EmailError('google_unavailable', 'google_unavailable')
  }

  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : GOOGLE_HTTP_TIMEOUT_MS

  let attempt = 0
  /** @type {EmailError | null} */
  let lastErr = null

  while (attempt <= GOOGLE_HTTP_MAX_RETRIES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(parsed.toString(), {
        method,
        headers: opts.headers || {},
        body: opts.body != null ? opts.body : undefined,
        signal: controller.signal,
      })
      clearTimeout(timer)
      const status = res.status
      if (status === 429 || (status >= 500 && status < 600)) {
        lastErr = emailErrorFromHttpStatus(status)
        if (attempt < GOOGLE_HTTP_MAX_RETRIES) {
          const wait = readRetryAfterMs(res.headers) || 400 * (attempt + 1)
          await sleep(wait)
          attempt += 1
          continue
        }
        throw lastErr
      }
      if (status === 401 || status === 403) {
        throw emailErrorFromHttpStatus(status)
      }
      if (!res.ok) {
        throw emailErrorFromHttpStatus(status)
      }
      let json = null
      const text = await res.text()
      if (text && text.trim()) {
        try {
          json = JSON.parse(text)
        } catch {
          throw new EmailError('malformed_google_response', 'malformed_google_response')
        }
      }
      return { status, json, headers: res.headers }
    } catch (err) {
      clearTimeout(timer)
      if (err && err.name === 'EmailError') throw err
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        throw new EmailError('google_timeout', 'google_timeout', { retryable: true })
      }
      lastErr = new EmailError('google_unavailable', 'google_unavailable', { retryable: true })
      if (attempt < GOOGLE_HTTP_MAX_RETRIES) {
        attempt += 1
        await sleep(300 * attempt)
        continue
      }
      throw lastErr
    }
  }
  throw lastErr || new EmailError('google_unavailable', 'google_unavailable')
}

/**
 * @param {{
 *   accessToken: string
 *   q?: string
 *   maxResults?: number
 *   pageToken?: string
 *   labelIds?: string[]
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function gmailMessagesList(opts) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  const max =
    typeof opts.maxResults === 'number' && opts.maxResults > 0
      ? Math.min(Math.floor(opts.maxResults), 25)
      : 10
  url.searchParams.set('maxResults', String(max))
  if (opts.q) url.searchParams.set('q', String(opts.q).slice(0, 500))
  if (opts.pageToken) url.searchParams.set('pageToken', String(opts.pageToken).slice(0, 200))
  if (Array.isArray(opts.labelIds)) {
    for (const id of opts.labelIds.slice(0, 5)) {
      if (typeof id === 'string' && id.trim()) url.searchParams.append('labelIds', id.trim())
    }
  }
  return googleFetchJson({
    url: url.toString(),
    method: 'GET',
    headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
    fetchImpl: opts.fetchImpl,
  })
}

/**
 * @param {{
 *   accessToken: string
 *   messageId: string
 *   format?: 'full' | 'metadata' | 'minimal'
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function gmailMessagesGet(opts) {
  const id = encodeURIComponent(String(opts.messageId || '').trim())
  if (!id) throw new EmailError('invalid_query', 'invalid_query')
  const format = opts.format === 'metadata' || opts.format === 'minimal' ? opts.format : 'full'
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`)
  url.searchParams.set('format', format)
  if (format === 'metadata') {
    url.searchParams.append('metadataHeaders', 'From')
    url.searchParams.append('metadataHeaders', 'To')
    url.searchParams.append('metadataHeaders', 'Subject')
    url.searchParams.append('metadataHeaders', 'Date')
  }
  return googleFetchJson({
    url: url.toString(),
    method: 'GET',
    headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
    fetchImpl: opts.fetchImpl,
  })
}

/**
 * @param {{
 *   clientId: string
 *   clientSecret: string
 *   refreshToken: string
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function googleRefreshAccessToken(opts) {
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
    fetchImpl: opts.fetchImpl,
  })
}
