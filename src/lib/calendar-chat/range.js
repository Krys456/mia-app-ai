/**
 * #336B — Map Calendar intent day refs → listEvents range / time bounds.
 * Uses IANA timezone; never silent UTC for "today".
 */

import { WEEKDAYS } from './intent.js'

/**
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function localYmdInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

/**
 * Local weekday 0=Sun … 6=Sat in zone.
 */
export function localWeekdayInZone(timeZone, now = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[wd] ?? 0
}

export function addDaysYmd(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return ymd
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  const y = dt.getUTCFullYear()
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/**
 * Approximate start-of-day UTC instant for YMD in zone (noon-walk method).
 * Good enough for Google timeMin/timeMax day windows.
 */
export function approxStartOfDayUtc(ymd, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  // Start from UTC noon guess, walk to find first instant whose local YMD matches
  let guess = Date.UTC(y, mo - 1, d, 12, 0, 0)
  for (let i = 0; i < 48; i++) {
    const probe = new Date(guess - i * 3600000)
    if (localYmdInZone(timeZone, probe) === ymd) {
      // Walk earlier until day changes
      let t = probe.getTime()
      for (let j = 0; j < 36; j++) {
        const earlier = new Date(t - 3600000)
        if (localYmdInZone(timeZone, earlier) !== ymd) {
          // refine by minutes
          let fine = t
          for (let k = 0; k < 60; k++) {
            const e2 = new Date(fine - 60000)
            if (localYmdInZone(timeZone, e2) !== ymd) return new Date(fine)
            fine -= 60000
          }
          return new Date(fine)
        }
        t -= 3600000
      }
      return probe
    }
  }
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0))
}

export function nextWeekdayYmd(targetDow, timeZone, now = new Date()) {
  const today = localYmdInZone(timeZone, now)
  const current = localWeekdayInZone(timeZone, now)
  let delta = (targetDow - current + 7) % 7
  if (delta === 0) delta = 7 // "venerdì" → upcoming Friday (not today unless we want today — use next occurrence including today if same day?)
  // Product: "Ho qualcosa venerdì?" on Friday → today. If already Friday, delta 0 = today.
  delta = (targetDow - current + 7) % 7
  return addDaysYmd(today, delta)
}

/**
 * Canonical part-of-day local hour windows (#336B).
 */
export const PART_OF_DAY_HOURS = {
  morning: { start: 6, end: 12 },
  afternoon: { start: 12, end: 18 },
  evening: { start: 18, end: 24 },
}

export const FREE_TIME_WINDOW = { start: 8, end: 20 }

/**
 * @param {{
 *   dayRef: any
 *   timeZone: string
 *   now?: Date
 * }} input
 * @returns {{ range?: string, timeMin?: string, timeMax?: string, labelDay: string, dayYmd: string | null }}
 */
export function resolveCalendarQueryBounds(input) {
  const tz = input.timeZone || 'UTC'
  const now = input.now instanceof Date ? input.now : new Date()
  const today = localYmdInZone(tz, now)
  const dayRef = input.dayRef

  if (dayRef === 'next') {
    return {
      range: 'next',
      labelDay: 'next',
      dayYmd: null,
    }
  }
  if (dayRef === 'week') {
    return {
      range: 'week',
      labelDay: 'week',
      dayYmd: today,
    }
  }

  let ymd = today
  let labelDay = 'today'
  if (dayRef === 'tomorrow') {
    ymd = addDaysYmd(today, 1)
    labelDay = 'tomorrow'
  } else if (dayRef === 'day_after_tomorrow') {
    ymd = addDaysYmd(today, 2)
    labelDay = 'day_after_tomorrow'
  } else if (dayRef && typeof dayRef === 'object' && dayRef.kind === 'weekday') {
    ymd = nextWeekdayYmd(dayRef.weekday, tz, now)
    labelDay = dayRef.name || 'weekday'
  } else if (dayRef === 'today' || !dayRef) {
    ymd = today
    labelDay = 'today'
  } else if (typeof dayRef === 'string' && WEEKDAYS[dayRef] != null) {
    ymd = nextWeekdayYmd(WEEKDAYS[dayRef], tz, now)
    labelDay = dayRef
  }

  // Prefer named ranges when they match
  if (ymd === today) {
    return { range: 'today', labelDay: 'today', dayYmd: ymd }
  }
  if (ymd === addDaysYmd(today, 1)) {
    return { range: 'tomorrow', labelDay: 'tomorrow', dayYmd: ymd }
  }

  const start = approxStartOfDayUtc(ymd, tz)
  const end = approxStartOfDayUtc(addDaysYmd(ymd, 1), tz)
  if (!start || !end) {
    return { range: 'today', labelDay: 'today', dayYmd: today }
  }
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    labelDay,
    dayYmd: ymd,
  }
}
