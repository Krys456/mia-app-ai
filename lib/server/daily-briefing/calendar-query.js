/**
 * #336B — Server calendar_query pack (reuses listEvents; no new Vercel function).
 * Fail-soft. Never invents events. Never logs titles.
 */

import { isCalendarEnabled } from '../calendar-enabled.js'
import { isCalendarError } from '../calendar-errors.js'
import { listEvents } from '../calendar-read.js'
import { sanitizeTimeZone } from '../calendar-normalize.js'
import { withTimeout } from './timezone.js'

const CALENDAR_QUERY_TIMEOUT_MS = 8000

/**
 * @param {string} userId
 * @param {{
 *   timeZone?: string
 *   range?: string
 *   timeMin?: string
 *   timeMax?: string
 *   limit?: number
 *   now?: Date
 *   env?: Record<string, string | undefined>
 *   listEventsFn?: Function
 * }} opts
 */
export async function runCalendarQuery(userId, opts = {}) {
  const env = opts.env || process.env
  const listFn = typeof opts.listEventsFn === 'function' ? opts.listEventsFn : listEvents
  const fetchedAt = new Date().toISOString()

  if (!isCalendarEnabled(env)) {
    return {
      status: 'disabled',
      items: [],
      fetchedAt,
      timeZone: null,
    }
  }

  const tz = sanitizeTimeZone(opts.timeZone) || 'UTC'
  const limit = Math.min(40, Math.max(1, Number(opts.limit) || 40))

  try {
    const result = await withTimeout(CALENDAR_QUERY_TIMEOUT_MS, () =>
      listFn(userId, {
        range: opts.timeMin || opts.timeMax ? undefined : opts.range || 'today',
        timeMin: opts.timeMin,
        timeMax: opts.timeMax,
        timeZone: tz,
        limit,
        env,
        now: opts.now,
      }),
    )

    const raw = Array.isArray(result?.events) ? result.events : []
    const items = raw
      .filter((e) => e && e.status !== 'cancelled')
      .map((e) => ({
        id: String(e.id || '').slice(0, 120),
        title: String(e.title || '').slice(0, 120),
        start: e.start,
        end: e.end,
        allDay: Boolean(e.allDay),
        status: e.status || 'confirmed',
        timeZone: e.timeZone || tz,
      }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))

    return {
      status: items.length ? 'ok' : 'empty',
      items,
      fetchedAt,
      timeZone: tz,
      range: opts.range || null,
    }
  } catch (err) {
    if (err && err.code === 'timeout') {
      return { status: 'timeout', items: [], fetchedAt, timeZone: tz }
    }
    if (isCalendarError(err)) {
      if (err.code === 'not_connected') {
        return { status: 'disconnected', items: [], fetchedAt, timeZone: tz }
      }
      if (err.code === 'calendar_disabled') {
        return { status: 'disabled', items: [], fetchedAt, timeZone: tz }
      }
      if (err.code === 'reconnect_required' || err.code === 'google_unauthorized') {
        return { status: 'reconnect_required', items: [], fetchedAt, timeZone: tz }
      }
      return { status: 'error', items: [], fetchedAt, timeZone: tz }
    }
    return { status: 'error', items: [], fetchedAt, timeZone: tz }
  }
}
