/**
 * #304A2 — Allowlisted Google HTTP client (Calendar read + OAuth token refresh).
 *
 * Allowed hosts:
 *   - www.googleapis.com
 *   - oauth2.googleapis.com
 *
 * Allowed Calendar operations:
 *   GET  /calendar/v3/users/me/calendarList
 *   GET  /calendar/v3/calendars/{id}/events
 *   POST /calendar/v3/freeBusy   (query-only)
 *
 * No event create/update/delete, RSVP, or ACL mutations.
 */

import {
  CalendarError,
  calendarErrorFromHttpStatus,
} from './calendar-errors.js'

export const GOOGLE_HTTP_TIMEOUT_MS = 9000
export const GOOGLE_HTTP_MAX_RETRIES = 1
export const GOOGLE_HTTP_RETRY_AFTER_CAP_MS = 5000

const ALLOWED_HOSTS = new Set(['www.googleapis.com', 'oauth2.googleapis.com'])

/**
 * @param {string} url
 */
export function assertAllowedGoogleUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
  if (parsed.protocol !== 'https:') {
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
  return parsed
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

/**
 * @param {number} ms
 */
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
    throw new CalendarError('google_forbidden', 'google_forbidden')
  }

  // Hard-deny write-shaped Calendar paths even if somehow constructed.
  const path = parsed.pathname
  if (/\/calendar\/v3\/calendars\/[^/]+\/events(\/|$)/.test(path) && method !== 'GET') {
    throw new CalendarError('google_forbidden', 'google_forbidden')
  }
  if (/\/calendar\/v3\/calendars\/?$/.test(path) && method === 'POST') {
    throw new CalendarError('google_forbidden', 'google_forbidden')
  }
  if (path.includes('/acl') || path.includes('/import')) {
    throw new CalendarError('google_forbidden', 'google_forbidden')
  }

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }

  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : GOOGLE_HTTP_TIMEOUT_MS

  let attempt = 0
  /** @type {CalendarError | null} */
  let lastErr = null

  while (attempt <= GOOGLE_HTTP_MAX_RETRIES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(opts.url, {
        method,
        headers: opts.headers || {},
        body: opts.body ?? undefined,
        signal: controller.signal,
      })

      if (res.ok) {
        let json
        try {
          json = await res.json()
        } catch {
          throw new CalendarError('malformed_google_response', 'malformed_google_response')
        }
        return { ok: true, status: res.status, json }
      }

      const err = calendarErrorFromHttpStatus(res.status)
      if (!err.retryable || attempt >= GOOGLE_HTTP_MAX_RETRIES) {
        throw err
      }
      lastErr = err
      const wait = readRetryAfterMs(res.headers) || 250
      await sleep(wait)
      } catch (e) {
      if (e instanceof CalendarError) {
        if (!e.retryable || attempt >= GOOGLE_HTTP_MAX_RETRIES) throw e
        lastErr = e
        await sleep(250)
      } else if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
        const err = new CalendarError('google_timeout', 'google_timeout', {
          retryable: true,
          status: 408,
        })
        if (attempt >= GOOGLE_HTTP_MAX_RETRIES) throw err
        lastErr = err
        await sleep(250)
      } else {
        const err = new CalendarError('google_unavailable', 'google_unavailable', {
          retryable: true,
        })
        if (attempt >= GOOGLE_HTTP_MAX_RETRIES) throw err
        lastErr = err
        await sleep(250)
      }
    } finally {
      clearTimeout(timer)
    }
    attempt += 1
  }

  throw lastErr || new CalendarError('google_unavailable', 'google_unavailable')
}

/**
 * @param {{ accessToken: string, pageToken?: string, fetchImpl?: typeof fetch }} opts
 */
export async function googleCalendarList(opts) {
  const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
  url.searchParams.set('maxResults', '250')
  if (opts.pageToken) url.searchParams.set('pageToken', opts.pageToken)
  return googleFetchJson({
    url: url.toString(),
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: 'application/json',
    },
    fetchImpl: opts.fetchImpl,
  })
}

/**
 * @param {{
 *   accessToken: string
 *   calendarId: string
 *   timeMin: string
 *   timeMax: string
 *   pageToken?: string
 *   maxResults?: number
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function googleEventsList(opts) {
  const calId = encodeURIComponent(opts.calendarId)
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('timeMin', opts.timeMin)
  url.searchParams.set('timeMax', opts.timeMax)
  url.searchParams.set('maxResults', String(Math.min(opts.maxResults || 50, 100)))
  if (opts.pageToken) url.searchParams.set('pageToken', opts.pageToken)
  return googleFetchJson({
    url: url.toString(),
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: 'application/json',
    },
    fetchImpl: opts.fetchImpl,
  })
}

/**
 * Query-only FreeBusy.
 * @param {{
 *   accessToken: string
 *   timeMin: string
 *   timeMax: string
 *   calendarIds: string[]
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function googleFreeBusy(opts) {
  const body = JSON.stringify({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    items: (opts.calendarIds || []).map((id) => ({ id })),
  })
  return googleFetchJson({
    url: 'https://www.googleapis.com/calendar/v3/freeBusy',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body,
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
  try {
    return await googleFetchJson({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      fetchImpl: opts.fetchImpl,
    })
  } catch (e) {
    // Google invalid_grant typically returns HTTP 400 — map to unauthorized for reconnect.
    if (
      e instanceof CalendarError &&
      (e.status === 400 || e.status === 401 || e.code === 'google_unauthorized')
    ) {
      throw new CalendarError('google_unauthorized', 'google_unauthorized', {
        status: e.status || 401,
        retryable: false,
      })
    }
    throw e
  }
}
