/**
 * #304A2 — Calendar text sanitization + range/event bounds.
 *
 * Event/calendar text is DATA, never instructions.
 */

import { CalendarError } from './calendar-errors.js'

export const CALENDAR_MAX_TITLE_CHARS = 120
export const CALENDAR_MAX_SUMMARY_CHARS = 120
export const CALENDAR_MAX_EVENTS = 40
export const CALENDAR_MAX_CALENDARS_LISTED = 20
export const CALENDAR_MAX_CALENDARS_QUERIED = 5
export const CALENDAR_MAX_RANGE_DAYS = 31

/** Control chars + common bidi overrides. */
const STRIP_CHARS_RE =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/g

/**
 * @param {unknown} value
 * @param {number} maxChars
 * @returns {string}
 */
export function sanitizeCalendarText(value, maxChars) {
  if (typeof value !== 'string') return ''
  let text = value.normalize('NFC')
  text = text.replace(STRIP_CHARS_RE, '')
  text = text.replace(/\s+/g, ' ').trim()
  const limit = Math.max(1, Math.floor(maxChars))
  if (text.length > limit) text = text.slice(0, limit).trim()
  return text
}

/**
 * @param {unknown} value
 */
export function sanitizeEventTitle(value) {
  return sanitizeCalendarText(value, CALENDAR_MAX_TITLE_CHARS) || '(untitled)'
}

/**
 * @param {unknown} value
 */
export function sanitizeCalendarSummary(value) {
  return sanitizeCalendarText(value, CALENDAR_MAX_SUMMARY_CHARS) || '(calendar)'
}

/**
 * Validate IANA-ish timezone string loosely (reject injection / control chars).
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeTimeZone(value) {
  if (typeof value !== 'string') return null
  const tz = value.normalize('NFC').replace(STRIP_CHARS_RE, '').trim()
  if (!tz || tz.length > 64) return null
  if (!/^[A-Za-z0-9_+\-\/]+$/.test(tz)) return null
  try {
    // Throws RangeError for invalid zones in modern Node.
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/**
 * Parse YYYY-MM-DD as UTC noon anchor for ordering (all-day).
 * @param {string} ymd
 */
export function parseAllDayDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, mo, d, ymd: `${m[1]}-${m[2]}-${m[3]}` }
}

/**
 * @param {Date} date
 * @param {string} timeZone
 * @returns {{ y: number, mo: number, d: number, ymd: string }}
 */
export function zonedYmd(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  const y = get('year')
  const mo = get('month')
  const d = get('day')
  return { y: Number(y), mo: Number(mo), d: Number(d), ymd: `${y}-${mo}-${d}` }
}

/**
 * Start of local calendar day in `timeZone` as UTC Date (best-effort via iterative offset).
 * @param {string} ymd
 * @param {string} timeZone
 * @returns {Date}
 */
export function startOfZonedDayUtc(ymd, timeZone) {
  const parsed = parseAllDayDate(ymd)
  if (!parsed) throw new Error('invalid_ymd')
  // Approximate: construct UTC noon then adjust by zone offset at that instant.
  let guess = Date.UTC(parsed.y, parsed.mo - 1, parsed.d, 12, 0, 0)
  for (let i = 0; i < 3; i += 1) {
    const asZoned = zonedYmd(new Date(guess), timeZone)
    const desired = Date.UTC(parsed.y, parsed.mo - 1, parsed.d, 0, 0, 0)
    const actual = Date.UTC(asZoned.y, asZoned.mo - 1, asZoned.d, 0, 0, 0)
    const deltaDays = (desired - actual) / 86400000
    guess += deltaDays * 86400000
  }
  // Refine to local midnight: subtract hours/minutes in zone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (let i = 0; i < 4; i += 1) {
    const parts = fmt.formatToParts(new Date(guess))
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0)
    const mi = Number(parts.find((p) => p.type === 'minute')?.value || 0)
    const s = Number(parts.find((p) => p.type === 'second')?.value || 0)
    const ms = ((h * 60 + mi) * 60 + s) * 1000
    if (ms === 0) break
    guess -= ms
  }
  return new Date(guess)
}

/**
 * Add calendar days to YYYY-MM-DD (UTC date arithmetic).
 * @param {string} ymd
 * @param {number} days
 */
export function addDaysYmd(ymd, days) {
  const p = parseAllDayDate(ymd)
  if (!p) return null
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + days))
  const y = dt.getUTCFullYear()
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/**
 * Resolve supported named ranges into UTC ISO bounds.
 * @param {{
 *   range?: 'today'|'tomorrow'|'week'|'next'|string
 *   timeMin?: string
 *   timeMax?: string
 *   timeZone: string
 *   now?: Date
 * }} input
 * @returns {{ timeMin: string, timeMax: string, timeZone: string }}
 */
export function resolveEventRange(input) {
  const tz = sanitizeTimeZone(input.timeZone) || 'UTC'
  const now = input.now instanceof Date ? input.now : new Date()

  if (input.timeMin || input.timeMax) {
    const min = input.timeMin ? Date.parse(input.timeMin) : NaN
    const max = input.timeMax ? Date.parse(input.timeMax) : NaN
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new CalendarError('invalid_range', 'invalid_range')
    }
    const days = (max - min) / 86400000
    if (days > CALENDAR_MAX_RANGE_DAYS + 0.001) {
      throw new CalendarError('range_too_large', 'range_too_large')
    }
    return {
      timeMin: new Date(min).toISOString(),
      timeMax: new Date(max).toISOString(),
      timeZone: tz,
    }
  }

  const named = typeof input.range === 'string' ? input.range.trim().toLowerCase() : 'today'
  const today = zonedYmd(now, tz).ymd

  if (named === 'today') {
    const start = startOfZonedDayUtc(today, tz)
    const endYmd = addDaysYmd(today, 1)
    const end = startOfZonedDayUtc(endYmd, tz)
    return { timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: tz }
  }
  if (named === 'tomorrow') {
    const tmr = addDaysYmd(today, 1)
    const start = startOfZonedDayUtc(tmr, tz)
    const end = startOfZonedDayUtc(addDaysYmd(tmr, 1), tz)
    return { timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: tz }
  }
  if (named === 'week') {
    const start = startOfZonedDayUtc(today, tz)
    const end = startOfZonedDayUtc(addDaysYmd(today, 7), tz)
    return { timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: tz }
  }
  if (named === 'next') {
    // Next event search window: from now through +7 days (still within 31-day max).
    const end = startOfZonedDayUtc(addDaysYmd(today, 7), tz)
    return { timeMin: now.toISOString(), timeMax: end.toISOString(), timeZone: tz }
  }

  throw new CalendarError('invalid_range', 'invalid_range')
}

/**
 * Normalize a Google event resource into the #304A2 shape (or null if skip).
 * @param {Record<string, unknown>} raw
 * @param {string} calendarId
 */
export function normalizeGoogleEvent(raw, calendarId) {
  if (!raw || typeof raw !== 'object') return null
  const status = typeof raw.status === 'string' ? raw.status : 'confirmed'
  if (status === 'cancelled') return null

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null

  const startObj = raw.start && typeof raw.start === 'object' ? raw.start : null
  const endObj = raw.end && typeof raw.end === 'object' ? raw.end : null
  if (!startObj || !endObj) return null

  const startDate = typeof startObj.date === 'string' ? startObj.date : null
  const endDate = typeof endObj.date === 'string' ? endObj.date : null
  const startDateTime = typeof startObj.dateTime === 'string' ? startObj.dateTime : null
  const endDateTime = typeof endObj.dateTime === 'string' ? endObj.dateTime : null

  let allDay = false
  let start
  let end
  let timeZone = null

  if (startDate && endDate) {
    allDay = true
    const s = parseAllDayDate(startDate)
    const e = parseAllDayDate(endDate)
    if (!s || !e) return null
    start = s.ymd
    end = e.ymd
  } else if (startDateTime && endDateTime) {
    const sMs = Date.parse(startDateTime)
    const eMs = Date.parse(endDateTime)
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) return null
    start = new Date(sMs).toISOString()
    end = new Date(eMs).toISOString()
    timeZone =
      sanitizeTimeZone(startObj.timeZone) ||
      sanitizeTimeZone(endObj.timeZone) ||
      null
  } else {
    return null
  }

  return {
    id,
    calendarId: String(calendarId || ''),
    title: sanitizeEventTitle(raw.summary),
    start,
    end,
    allDay,
    status,
    timeZone,
  }
}

/**
 * Google all-day membership: start.date inclusive, end.date exclusive.
 * Include iff startDate <= D < endDate.
 * @param {{ allDay?: boolean, start?: string, end?: string }} ev
 * @param {string} dayYmd YYYY-MM-DD
 */
export function allDayEventIncludesYmd(ev, dayYmd) {
  const d = typeof dayYmd === 'string' ? dayYmd.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  if (!ev || !ev.allDay) return false
  const start = typeof ev.start === 'string' ? ev.start.trim() : ''
  const end = typeof ev.end === 'string' ? ev.end.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false
  return start <= d && d < end
}

/**
 * Keep timed events as-is; drop all-day events that do not include dayYmd.
 * When dayYmd is missing, return the list unchanged.
 * @param {Array<{ allDay?: boolean, start?: string, end?: string }>} events
 * @param {string | null | undefined} dayYmd
 */
export function filterEventsForAllDayDayMembership(events, dayYmd) {
  const list = Array.isArray(events) ? events : []
  const d = typeof dayYmd === 'string' ? dayYmd.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return list
  return list.filter((ev) => {
    if (!ev) return false
    if (!ev.allDay) return true
    return allDayEventIncludesYmd(ev, d)
  })
}

/**
 * Local YMD for a day-scoped list window (today/tomorrow, or a single local day
 * expressed via timeMin/timeMax). Multi-day windows (week/next) return null.
 * @param {{
 *   range?: string
 *   timeZone: string
 *   now?: Date
 *   timeMin?: string
 *   timeMax?: string
 * }} input
 * @returns {string | null}
 */
export function resolveDayScopedYmd(input) {
  const tz = sanitizeTimeZone(input.timeZone) || 'UTC'
  const now = input.now instanceof Date ? input.now : new Date()
  const named = typeof input.range === 'string' ? input.range.trim().toLowerCase() : ''
  const today = zonedYmd(now, tz).ymd
  if (named === 'today') return today
  if (named === 'tomorrow') return addDaysYmd(today, 1)
  if (named === 'week' || named === 'next') return null

  // Weekday / day-after-tomorrow: single local day via explicit bounds.
  if (input.timeMin && input.timeMax) {
    const min = Date.parse(input.timeMin)
    const max = Date.parse(input.timeMax)
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      const startYmd = zonedYmd(new Date(min), tz).ymd
      const endYmd = zonedYmd(new Date(max), tz).ymd
      if (endYmd === addDaysYmd(startYmd, 1)) return startYmd
    }
  }
  return null
}

/**
 * Sort key ms for normalized event.
 * @param {{ start: string, allDay: boolean }} ev
 * @param {string} fallbackTz
 */
export function eventSortKeyMs(ev, fallbackTz) {
  if (ev.allDay) {
    try {
      return startOfZonedDayUtc(ev.start, fallbackTz || 'UTC').getTime()
    } catch {
      const p = parseAllDayDate(ev.start)
      return p ? Date.UTC(p.y, p.mo - 1, p.d) : 0
    }
  }
  const ms = Date.parse(ev.start)
  return Number.isFinite(ms) ? ms : 0
}
