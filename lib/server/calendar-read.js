/**
 * #304A2 — Reusable Google Calendar READ service (Node / server only).
 *
 * Public API:
 *   listCalendars(userId, opts?)
 *   listEvents(userId, opts?)
 *   freeBusy(userId, opts?)
 *
 * NOT wired into /api/chat (that is #304A3).
 * Never exposes Google tokens. Never logs titles/bodies/tokens.
 */

import { isCalendarEnabled } from './calendar-enabled.js'
import { CalendarError, isCalendarError } from './calendar-errors.js'
import {
  googleCalendarList,
  googleEventsList,
  googleFreeBusy,
} from './calendar-google-http.js'
import {
  CALENDAR_MAX_CALENDARS_LISTED,
  CALENDAR_MAX_CALENDARS_QUERIED,
  CALENDAR_MAX_EVENTS,
  eventSortKeyMs,
  normalizeGoogleEvent,
  filterEventsForAllDayDayMembership,
  resolveDayScopedYmd,
  resolveEventRange,
  sanitizeCalendarSummary,
  sanitizeTimeZone,
} from './calendar-normalize.js'
import { getValidGoogleAccessToken } from './calendar-token-refresh.js'
import { logApiEvent } from './safe-log.js'

/**
 * @param {unknown} userId
 */
function requireOwnerUserId(userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) throw new CalendarError('owner_required', 'owner_required')
  return id
}

/**
 * @param {Record<string, unknown>} fields
 */
function logCalendarSafe(fields) {
  logApiEvent({
    route: 'calendar-read',
    ...fields,
  })
}

/**
 * Resolve which calendar IDs to query.
 * @param {{
 *   calendars: Array<{ id: string, primary: boolean, selected: boolean }>
 *   selectedCalendarIds: unknown
 *   overrideIds?: string[] | null
 * }} input
 */
export function resolveSelectedCalendarIds(input) {
  const accessible = new Map((input.calendars || []).map((c) => [c.id, c]))
  if (Array.isArray(input.overrideIds) && input.overrideIds.length > 0) {
    const ids = []
    for (const raw of input.overrideIds) {
      const id = typeof raw === 'string' ? raw.trim() : ''
      if (!id || !accessible.has(id)) continue
      if (!ids.includes(id)) ids.push(id)
      if (ids.length >= CALENDAR_MAX_CALENDARS_QUERIED) break
    }
    return ids
  }

  let selected = null
  if (Array.isArray(input.selectedCalendarIds)) {
    selected = input.selectedCalendarIds
  } else if (typeof input.selectedCalendarIds === 'string') {
    try {
      const parsed = JSON.parse(input.selectedCalendarIds)
      if (Array.isArray(parsed)) selected = parsed
    } catch {
      selected = null
    }
  }

  if (Array.isArray(selected) && selected.length > 0) {
    const ids = []
    for (const raw of selected) {
      const id = typeof raw === 'string' ? raw.trim() : ''
      if (!id || !accessible.has(id)) continue
      if (!ids.includes(id)) ids.push(id)
      if (ids.length >= CALENDAR_MAX_CALENDARS_QUERIED) break
    }
    return ids
  }

  const primary = (input.calendars || []).find((c) => c.primary)
  if (primary?.id) return [primary.id]
  const first = (input.calendars || [])[0]
  return first?.id ? [first.id] : []
}

/**
 * @param {any} json
 */
function normalizeCalendarListResponse(json, selectedCalendarIds) {
  const items = Array.isArray(json?.items) ? json.items : []
  /** @type {Array<{ id: string, summary: string, primary: boolean, selected: boolean, timeZone: string | null }>} */
  const calendars = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) continue
    calendars.push({
      id,
      summary: sanitizeCalendarSummary(item.summary),
      primary: Boolean(item.primary),
      selected: false,
      timeZone: sanitizeTimeZone(item.timeZone),
    })
    if (calendars.length >= CALENDAR_MAX_CALENDARS_LISTED) break
  }

  const selectedIds = new Set(
    resolveSelectedCalendarIds({
      calendars,
      selectedCalendarIds,
    }),
  )
  for (const c of calendars) {
    c.selected = selectedIds.has(c.id)
  }
  return calendars
}

/**
 * @param {string} userId
 * @param {{
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 *   requestId?: string
 * }} [opts]
 */
export async function listCalendars(userId, opts = {}) {
  const started = Date.now()
  const owner = requireOwnerUserId(userId)
  try {
    if (!isCalendarEnabled(opts.env || process.env)) {
      throw new CalendarError('calendar_disabled', 'calendar_disabled')
    }
    const token = await getValidGoogleAccessToken({
      userId: owner,
      supabase: opts.supabase,
      fetchImpl: opts.fetchImpl,
      now: opts.now,
      env: opts.env,
    })

    const res = await googleCalendarList({
      accessToken: token.accessToken,
      fetchImpl: opts.fetchImpl,
    })
    const calendars = normalizeCalendarListResponse(
      res.json,
      token.connection?.selected_calendar_ids,
    )
    logCalendarSafe({
      requestId: opts.requestId,
      operation: 'listCalendars',
      calendarCount: calendars.length,
      durationMs: Date.now() - started,
      ok: true,
    })
    return { calendars }
  } catch (e) {
    const code = isCalendarError(e) ? e.code : 'google_unavailable'
    logCalendarSafe({
      requestId: opts.requestId,
      operation: 'listCalendars',
      durationMs: Date.now() - started,
      ok: false,
      code,
    })
    if (isCalendarError(e)) throw e
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
}

/**
 * @param {string} userId
 * @param {{
 *   range?: 'today'|'tomorrow'|'week'|'next'|string
 *   timeMin?: string
 *   timeMax?: string
 *   calendarIds?: string[]
 *   timeZone?: string
 *   limit?: number
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 *   requestId?: string
 * }} [opts]
 */
export async function listEvents(userId, opts = {}) {
  const started = Date.now()
  const owner = requireOwnerUserId(userId)
  try {
    if (!isCalendarEnabled(opts.env || process.env)) {
      throw new CalendarError('calendar_disabled', 'calendar_disabled')
    }

    // Fail fast on explicit invalid/oversized ranges before network.
    if (opts.timeMin || opts.timeMax) {
      resolveEventRange({
        timeMin: opts.timeMin,
        timeMax: opts.timeMax,
        timeZone: sanitizeTimeZone(opts.timeZone) || 'UTC',
        now: opts.now,
      })
    }

    const token = await getValidGoogleAccessToken({
      userId: owner,
      supabase: opts.supabase,
      fetchImpl: opts.fetchImpl,
      now: opts.now,
      env: opts.env,
    })

    const listed = await googleCalendarList({
      accessToken: token.accessToken,
      fetchImpl: opts.fetchImpl,
    })
    const calendars = normalizeCalendarListResponse(
      listed.json,
      token.connection?.selected_calendar_ids,
    )

    const primaryTz =
      calendars.find((c) => c.primary)?.timeZone ||
      calendars.find((c) => c.selected)?.timeZone ||
      'UTC'
    const tz = sanitizeTimeZone(opts.timeZone) || primaryTz || 'UTC'

    const bounds = resolveEventRange({
      range: opts.range,
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      timeZone: tz,
      now: opts.now,
    })

    const calendarIds = resolveSelectedCalendarIds({
      calendars,
      selectedCalendarIds: token.connection?.selected_calendar_ids,
      overrideIds: opts.calendarIds,
    })

    const limit = Math.min(
      Math.max(1, typeof opts.limit === 'number' ? Math.floor(opts.limit) : CALENDAR_MAX_EVENTS),
      CALENDAR_MAX_EVENTS,
    )

    /** @type {Array<ReturnType<typeof normalizeGoogleEvent>>} */
    const merged = []
    for (const calendarId of calendarIds) {
      try {
        const res = await googleEventsList({
          accessToken: token.accessToken,
          calendarId,
          timeMin: bounds.timeMin,
          timeMax: bounds.timeMax,
          maxResults: Math.min(100, limit + 10),
          fetchImpl: opts.fetchImpl,
        })
        const items = Array.isArray(res.json?.items) ? res.json.items : []
        for (const item of items) {
          const norm = normalizeGoogleEvent(item, calendarId)
          if (norm) merged.push(norm)
        }
      } catch (e) {
        // Skip inaccessible / malformed calendars; bubble rate-limit / timeout / auth.
        if (isCalendarError(e)) {
          if (
            e.code === 'google_forbidden' ||
            e.code === 'malformed_google_response'
          ) {
            continue
          }
          if (
            e.code === 'google_rate_limited' ||
            e.code === 'google_timeout' ||
            e.code === 'google_unauthorized' ||
            e.code === 'reconnect_required'
          ) {
            throw e
          }
        }
        continue
      }
    }

    merged.sort(
      (a, b) =>
        eventSortKeyMs(a, bounds.timeZone) - eventSortKeyMs(b, bounds.timeZone),
    )

    // Google all-day end.date is exclusive — drop all-day events that do not
    // include the requested local day (day-scoped lists only).
    const dayYmd = resolveDayScopedYmd({
      range: opts.range,
      timeZone: bounds.timeZone,
      now: opts.now,
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
    })
    const membershipFiltered = filterEventsForAllDayDayMembership(merged, dayYmd)

    let events = membershipFiltered.slice(0, limit)
    if (opts.range === 'next') {
      events = events.slice(0, 1)
    }

    logCalendarSafe({
      requestId: opts.requestId,
      operation: 'listEvents',
      eventCount: events.length,
      calendarCount: calendarIds.length,
      durationMs: Date.now() - started,
      ok: true,
    })
    return {
      events,
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
      timeZone: bounds.timeZone,
    }
  } catch (e) {
    const code = isCalendarError(e) ? e.code : 'google_unavailable'
    logCalendarSafe({
      requestId: opts.requestId,
      operation: 'listEvents',
      durationMs: Date.now() - started,
      ok: false,
      code,
    })
    if (isCalendarError(e)) throw e
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
}

/**
 * @param {string} userId
 * @param {{
 *   timeMin: string
 *   timeMax: string
 *   calendarIds?: string[]
 *   timeZone?: string
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 *   requestId?: string
 * }} opts
 */
export async function freeBusy(userId, opts) {
  const started = Date.now()
  const owner = requireOwnerUserId(userId)
  try {
    if (!isCalendarEnabled(opts.env || process.env)) {
      throw new CalendarError('calendar_disabled', 'calendar_disabled')
    }
    if (!opts || typeof opts.timeMin !== 'string' || typeof opts.timeMax !== 'string') {
      throw new CalendarError('invalid_range', 'invalid_range')
    }

    // Fail fast before network.
    resolveEventRange({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      timeZone: sanitizeTimeZone(opts.timeZone) || 'UTC',
      now: opts.now,
    })

    const token = await getValidGoogleAccessToken({
      userId: owner,
      supabase: opts.supabase,
      fetchImpl: opts.fetchImpl,
      now: opts.now,
      env: opts.env,
    })

    const listed = await googleCalendarList({
      accessToken: token.accessToken,
      fetchImpl: opts.fetchImpl,
    })
    const calendars = normalizeCalendarListResponse(
      listed.json,
      token.connection?.selected_calendar_ids,
    )
    const primaryTz =
      calendars.find((c) => c.primary)?.timeZone ||
      calendars.find((c) => c.selected)?.timeZone ||
      'UTC'
    const tz = sanitizeTimeZone(opts.timeZone) || primaryTz || 'UTC'

    const bounds = resolveEventRange({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      timeZone: tz,
      now: opts.now,
    })

    const calendarIds = resolveSelectedCalendarIds({
      calendars,
      selectedCalendarIds: token.connection?.selected_calendar_ids,
      overrideIds: opts.calendarIds,
    })

    if (calendarIds.length === 0) {
      logCalendarSafe({
        requestId: opts.requestId,
        operation: 'freeBusy',
        calendarCount: 0,
        durationMs: Date.now() - started,
        ok: true,
      })
      return { timeMin: bounds.timeMin, timeMax: bounds.timeMax, calendars: [] }
    }

    const res = await googleFreeBusy({
      accessToken: token.accessToken,
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
      calendarIds,
      fetchImpl: opts.fetchImpl,
    })

    const rawCals =
      res.json && typeof res.json.calendars === 'object' && res.json.calendars
        ? res.json.calendars
        : {}

    /** @type {Array<{ calendarId: string, busy: Array<{ start: string, end: string }> }>} */
    const out = []
    for (const calendarId of calendarIds) {
      const entry = rawCals[calendarId]
      const busyRaw = Array.isArray(entry?.busy) ? entry.busy : []
      const busy = []
      for (const b of busyRaw) {
        if (!b || typeof b !== 'object') continue
        const start = typeof b.start === 'string' ? b.start : ''
        const end = typeof b.end === 'string' ? b.end : ''
        if (!start || !end) continue
        const sMs = Date.parse(start)
        const eMs = Date.parse(end)
        if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) continue
        busy.push({ start: new Date(sMs).toISOString(), end: new Date(eMs).toISOString() })
      }
      out.push({ calendarId, busy })
    }

    logCalendarSafe({
      requestId: opts.requestId,
      operation: 'freeBusy',
      calendarCount: out.length,
      durationMs: Date.now() - started,
      ok: true,
    })
    return {
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
      calendars: out,
    }
  } catch (e) {
    const code = isCalendarError(e) ? e.code : 'google_unavailable'
    logCalendarSafe({
      requestId: opts.requestId,
      operation: 'freeBusy',
      durationMs: Date.now() - started,
      ok: false,
      code,
    })
    if (isCalendarError(e)) throw e
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
}
