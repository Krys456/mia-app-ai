/**
 * #304A3 — Deterministic temporal parsing for Calendar chat (no LLM).
 */

import {
  CALENDAR_MAX_RANGE_DAYS,
  addDaysYmd,
  resolveEventRange,
  sanitizeTimeZone,
  startOfZonedDayUtc,
  zonedYmd,
} from './calendar-normalize.js'
import { CalendarError } from './calendar-errors.js'

export const CALENDAR_CHAT_NEXT_HORIZON_DAYS = 7

const WEEKDAY_IT = {
  domenica: 0,
  lunedi: 1,
  lunedì: 1,
  martedi: 2,
  martedì: 2,
  mercoledi: 3,
  mercoledì: 3,
  giovedi: 4,
  giovedì: 4,
  venerdi: 5,
  venerdì: 5,
  sabato: 6,
}

const WEEKDAY_EN = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/**
 * @typedef {{
 *   timeMin: string
 *   timeMax: string
 *   timeZone: string
 *   label: string
 *   namedRange?: 'today'|'tomorrow'|'week'|'next'|null
 * }} CalendarChatTimeBounds
 */

/**
 * @param {{
 *   text: unknown
 *   intent: 'events'|'availability'|'next'|'connection'|'none'
 *   timeZone?: unknown
 *   now?: Date
 * }} opts
 * @returns {CalendarChatTimeBounds}
 */
export function resolveCalendarChatTimeBounds(opts) {
  const tz = sanitizeTimeZone(opts.timeZone) || 'UTC'
  const now = opts.now instanceof Date ? opts.now : new Date()
  const text = String(opts.text || '').replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()

  if (opts.intent === 'next') {
    const bounds = resolveEventRange({ range: 'next', timeZone: tz, now })
    return { ...bounds, label: 'next_7_days', namedRange: 'next' }
  }

  const dayPart = detectDayPart(lower)
  const explicitHours = parseExplicitHours(lower)
  let dayAnchor = resolveDayAnchor(lower, tz, now)
  if ((explicitHours || dayPart) && !dayAnchor) {
    dayAnchor = { ymd: zonedYmd(now, tz).ymd, label: 'today', namedRange: 'today' }
  }

  if (explicitHours && dayAnchor) {
    const start = zonedWallClockToUtc(dayAnchor.ymd, explicitHours.startH, explicitHours.startM, tz)
    const end = zonedWallClockToUtc(dayAnchor.ymd, explicitHours.endH, explicitHours.endM, tz)
    assertWithinMaxDays(start, end)
    return {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: tz,
      label: `${dayAnchor.label}_${explicitHours.startH}-${explicitHours.endH}`,
      namedRange: null,
    }
  }

  if (dayPart && dayAnchor) {
    const window = dayPartWindow(dayPart)
    const start = zonedWallClockToUtc(dayAnchor.ymd, window.startH, 0, tz)
    const end = zonedWallClockToUtc(dayAnchor.ymd, window.endH, 0, tz)
    assertWithinMaxDays(start, end)
    return {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: tz,
      label: `${dayAnchor.label}_${dayPart}`,
      namedRange: null,
    }
  }

  if (dayAnchor?.namedRange) {
    const bounds = resolveEventRange({ range: dayAnchor.namedRange, timeZone: tz, now })
    return { ...bounds, label: dayAnchor.label, namedRange: dayAnchor.namedRange }
  }

  if (dayAnchor) {
    const start = startOfZonedDayUtc(dayAnchor.ymd, tz)
    const end = startOfZonedDayUtc(addDaysYmd(dayAnchor.ymd, 1), tz)
    assertWithinMaxDays(start, end)
    return {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: tz,
      label: dayAnchor.label,
      namedRange: null,
    }
  }

  // Default: today (full day) for events/availability without explicit day.
  const bounds = resolveEventRange({ range: 'today', timeZone: tz, now })
  return { ...bounds, label: 'today', namedRange: 'today' }
}

/**
 * @param {string} lower
 * @returns {'morning'|'afternoon'|'evening'|null}
 */
function detectDayPart(lower) {
  if (/\b(stasera|questa\s+sera|tonight|this\s+evening)\b/.test(lower)) return 'evening'
  if (/\b(mattina|morning)\b/.test(lower)) return 'morning'
  if (/\b(pomeriggio|afternoon)\b/.test(lower)) return 'afternoon'
  if (/\b(sera|evening)\b/.test(lower)) return 'evening'
  return null
}

/**
 * @param {'morning'|'afternoon'|'evening'} part
 */
function dayPartWindow(part) {
  if (part === 'morning') return { startH: 6, endH: 12 }
  if (part === 'afternoon') return { startH: 12, endH: 18 }
  return { startH: 18, endH: 23 }
}

/**
 * @param {string} lower
 * @returns {{ startH: number, startM: number, endH: number, endM: number } | null}
 */
function parseExplicitHours(lower) {
  // Italian: dalle 15 alle 18 / dalle 15:30 alle 18:00
  let m = lower.match(
    /\bdalle\s+(\d{1,2})(?::(\d{2}))?\s+alle\s+(\d{1,2})(?::(\d{2}))?\b/,
  )
  if (m) {
    return {
      startH: clampHour(Number(m[1])),
      startM: m[2] != null ? clampMin(Number(m[2])) : 0,
      endH: clampHour(Number(m[3])),
      endM: m[4] != null ? clampMin(Number(m[4])) : 0,
    }
  }
  // English: between 3 and 6 / between 3:00 and 6:30 / from 15 to 18
  m = lower.match(
    /\b(?:between|from)\s+(\d{1,2})(?::(\d{2}))?\s+(?:and|to)\s+(\d{1,2})(?::(\d{2}))?\b/,
  )
  if (m) {
    return {
      startH: clampHour(Number(m[1])),
      startM: m[2] != null ? clampMin(Number(m[2])) : 0,
      endH: clampHour(Number(m[3])),
      endM: m[4] != null ? clampMin(Number(m[4])) : 0,
    }
  }
  return null
}

/**
 * @param {string} lower
 * @param {string} tz
 * @param {Date} now
 * @returns {{ ymd: string, label: string, namedRange?: 'today'|'tomorrow'|'week'|null } | null}
 */
function resolveDayAnchor(lower, tz, now) {
  if (/\bquesta\s+settimana\b/.test(lower) || /\bthis\s+week\b/.test(lower)) {
    const today = zonedYmd(now, tz).ymd
    return { ymd: today, label: 'this_week', namedRange: 'week' }
  }
  if (/\bdopodomani\b/.test(lower) || /\bday\s+after\s+tomorrow\b/.test(lower)) {
    const today = zonedYmd(now, tz).ymd
    const ymd = addDaysYmd(today, 2)
    return { ymd, label: 'day_after_tomorrow', namedRange: null }
  }
  if (/\bdomani\b/.test(lower) || /\btomorrow\b/.test(lower)) {
    const today = zonedYmd(now, tz).ymd
    return { ymd: addDaysYmd(today, 1), label: 'tomorrow', namedRange: 'tomorrow' }
  }
  if (/\boggi\b/.test(lower) || /\btoday\b/.test(lower)) {
    return { ymd: zonedYmd(now, tz).ymd, label: 'today', namedRange: 'today' }
  }

  const weekday = matchWeekday(lower)
  if (weekday != null) {
    const ymd = nextWeekdayYmd(now, tz, weekday)
    return { ymd, label: `weekday_${weekday}`, namedRange: null }
  }

  return null
}

/**
 * @param {string} lower
 * @returns {number | null}
 */
function matchWeekday(lower) {
  for (const [name, idx] of Object.entries(WEEKDAY_IT)) {
    if (lower.includes(name)) return idx
  }
  for (const [name, idx] of Object.entries(WEEKDAY_EN)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return idx
  }
  return null
}

/**
 * Next occurrence of weekday in local TZ (today if still that weekday).
 * @param {Date} now
 * @param {string} tz
 * @param {number} targetDow
 */
function nextWeekdayYmd(now, tz, targetDow) {
  const today = zonedYmd(now, tz)
  const todayDow = zonedWeekday(now, tz)
  let delta = (targetDow - todayDow + 7) % 7
  return addDaysYmd(today.ymd, delta)
}

/**
 * @param {Date} date
 * @param {string} tz
 */
function zonedWeekday(date, tz) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[wd] ?? 0
}

/**
 * Approximate local wall-clock → UTC using #304A2 day-start + hour offset.
 * @param {string} ymd
 * @param {number} hour
 * @param {number} minute
 * @param {string} tz
 */
function zonedWallClockToUtc(ymd, hour, minute, tz) {
  const start = startOfZonedDayUtc(ymd, tz)
  return new Date(start.getTime() + (hour * 60 + minute) * 60_000)
}

/**
 * @param {Date} start
 * @param {Date} end
 */
function assertWithinMaxDays(start, end) {
  if (!(end > start)) throw new CalendarError('invalid_range', 'invalid_range')
  const days = (end.getTime() - start.getTime()) / 86400000
  if (days > CALENDAR_MAX_RANGE_DAYS + 0.001) {
    throw new CalendarError('range_too_large', 'range_too_large')
  }
}

function clampHour(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(23, Math.floor(n)))
}

function clampMin(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(59, Math.floor(n)))
}
