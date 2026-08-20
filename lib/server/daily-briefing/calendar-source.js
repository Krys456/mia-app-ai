/**
 * #321 — Calendar source wrapper (fail-soft; never invents events).
 * Reuses listEvents — does not repair OAuth.
 */

import { isCalendarEnabled } from '../calendar-enabled.js'
import { isCalendarError } from '../calendar-errors.js'
import { listEvents } from '../calendar-read.js'
import { withTimeout } from './timezone.js'

const CALENDAR_TIMEOUT_MS = 8000

/**
 * @param {string} userId
 * @param {{
 *   timeZone: string
 *   target: 'today' | 'tomorrow'
 *   now?: Date
 *   env?: Record<string, string | undefined>
 * }} opts
 */
export async function fetchCalendarForBriefing(userId, opts) {
  const env = opts.env || process.env
  const listFn = typeof opts.listEventsFn === 'function' ? opts.listEventsFn : listEvents
  if (!isCalendarEnabled(env)) {
    return {
      status: 'disabled',
      items: [],
      fetchedAt: new Date().toISOString(),
    }
  }

  try {
    const result = await withTimeout(CALENDAR_TIMEOUT_MS, () =>
      listFn(userId, {
        range: opts.target === 'tomorrow' ? 'tomorrow' : 'today',
        timeZone: opts.timeZone,
        limit: 20,
        env,
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
        timeZone: e.timeZone || opts.timeZone,
      }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))

    return {
      status: items.length ? 'ok' : 'empty',
      items,
      fetchedAt: new Date().toISOString(),
    }
  } catch (err) {
    if (err && err.code === 'timeout') {
      return { status: 'timeout', items: [], fetchedAt: new Date().toISOString() }
    }
    if (isCalendarError(err)) {
      if (err.code === 'not_connected') {
        return { status: 'disconnected', items: [], fetchedAt: new Date().toISOString() }
      }
      if (err.code === 'calendar_disabled') {
        return { status: 'disabled', items: [], fetchedAt: new Date().toISOString() }
      }
      if (err.code === 'reconnect_required' || err.code === 'google_unauthorized') {
        return { status: 'disconnected', items: [], fetchedAt: new Date().toISOString() }
      }
      return { status: 'error', items: [], fetchedAt: new Date().toISOString() }
    }
    return { status: 'error', items: [], fetchedAt: new Date().toISOString() }
  }
}
