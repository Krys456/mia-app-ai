/**
 * #317 — Deterministic daypart / relative-date windows in LOCATION timezone.
 * Always interpret relative dates in the weather location timezone (not Vercel UTC).
 */

/** Local-hour ranges (locale-independent). Inclusive start, exclusive end except night wrap. */
export const DAYPART_HOURS = Object.freeze({
  morning: { start: 6, end: 12 },
  afternoon: { start: 12, end: 18 },
  evening: { start: 18, end: 23 },
  night: { start: 23, end: 6 },
})

/**
 * @param {string} timeZone IANA tz
 * @param {Date|number} [now]
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, weekday: number, isoDate: string }}
 */
export function localPartsInZone(timeZone, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = wdMap[parts.weekday] ?? 0
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { year, month, day, hour, minute, weekday, isoDate }
}

/**
 * Add calendar days to an ISO date string (YYYY-MM-DD) without UTC shift tricks.
 * @param {string} isoDate
 * @param {number} days
 */
export function addIsoDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + days))
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`
}

/**
 * Resolve Saturday/Sunday for weekend requests in location timezone.
 * If currently Sat/Sun → current weekend; else → next Sat/Sun.
 * @param {string} timeZone
 * @param {Date|number} [now]
 * @returns {{ saturday: string, sunday: string }}
 */
export function resolveWeekendDates(timeZone, now = new Date()) {
  const local = localPartsInZone(timeZone, now)
  const wd = local.weekday
  if (wd === 6) {
    return { saturday: local.isoDate, sunday: addIsoDays(local.isoDate, 1) }
  }
  if (wd === 0) {
    return { saturday: addIsoDays(local.isoDate, -1), sunday: local.isoDate }
  }
  const daysUntilSat = 6 - wd
  const saturday = addIsoDays(local.isoDate, daysUntilSat)
  return { saturday, sunday: addIsoDays(saturday, 1) }
}

/**
 * @param {'morning'|'afternoon'|'evening'|'night'|string|null} daypart
 * @param {string} isoDate
 * @returns {{ startIso: string, endIso: string } | null}
 */
export function daypartWindow(daypart, isoDate) {
  const range = DAYPART_HOURS[daypart]
  if (!range || !isoDate) return null
  if (daypart === 'night') {
    return {
      startIso: `${isoDate}T23:00`,
      endIso: `${addIsoDays(isoDate, 1)}T06:00`,
    }
  }
  return {
    startIso: `${isoDate}T${String(range.start).padStart(2, '0')}:00`,
    endIso: `${isoDate}T${String(range.end).padStart(2, '0')}:00`,
  }
}

/**
 * Map timeHint + operation into a concrete local window.
 * @param {{
 *   timeHint?: string | null
 *   operation?: string
 *   timeZone: string
 *   now?: Date|number
 * }} input
 */
export function resolveTimeWindow(input) {
  const tz = input.timeZone || 'UTC'
  const now = input.now ?? Date.now()
  const local = localPartsInZone(tz, now)
  const hint = String(input.timeHint || '').toLowerCase()
  const op = String(input.operation || '')

  let targetDate = local.isoDate
  let daypart = null
  let specificHour = null
  let kind = 'now'

  if (hint === 'tomorrow' || op === 'tomorrow') {
    targetDate = addIsoDays(local.isoDate, 1)
    kind = 'tomorrow'
  } else if (hint === 'day_after_tomorrow') {
    targetDate = addIsoDays(local.isoDate, 2)
    kind = 'day_after_tomorrow'
  } else if (hint === 'today' || op === 'today') {
    kind = 'today'
  } else if (hint === 'weekend' || op === 'weekend') {
    const w = resolveWeekendDates(tz, now)
    return {
      kind: 'weekend',
      timeZone: tz,
      localNow: local,
      dates: [w.saturday, w.sunday],
      startIso: `${w.saturday}T00:00`,
      endIso: `${addIsoDays(w.sunday, 1)}T00:00`,
      daypart: null,
      specificHour: null,
    }
  } else if (/^next_(\d+)_days$/.test(hint)) {
    const n = Number(RegExp.$1)
    const dates = []
    for (let i = 0; i < Math.min(n, 7); i += 1) dates.push(addIsoDays(local.isoDate, i))
    return {
      kind: 'next_n_days',
      timeZone: tz,
      localNow: local,
      dates,
      startIso: `${dates[0]}T00:00`,
      endIso: `${addIsoDays(dates[dates.length - 1], 1)}T00:00`,
      daypart: null,
      specificHour: null,
      days: n,
    }
  } else if (/^hour_(\d{1,2})$/.test(hint)) {
    specificHour = Math.min(23, Math.max(0, Number(RegExp.$1)))
    kind = 'hour'
    // If hour already passed today, still use today for "alle 18" unless said tomorrow
  }

  if (hint === 'morning' || hint === 'afternoon' || hint === 'evening' || hint === 'night' || hint === 'tonight') {
    daypart = hint === 'tonight' ? 'evening' : hint
    kind = daypart
  }

  if (op === 'hourly' && specificHour == null && !daypart) {
    kind = 'today'
  }

  if (daypart) {
    const win = daypartWindow(daypart, targetDate)
    return {
      kind,
      timeZone: tz,
      localNow: local,
      dates: [targetDate],
      startIso: win?.startIso || `${targetDate}T00:00`,
      endIso: win?.endIso || `${addIsoDays(targetDate, 1)}T00:00`,
      daypart,
      specificHour: null,
    }
  }

  if (specificHour != null) {
    const hh = String(specificHour).padStart(2, '0')
    return {
      kind: 'hour',
      timeZone: tz,
      localNow: local,
      dates: [targetDate],
      startIso: `${targetDate}T${hh}:00`,
      endIso: `${targetDate}T${hh}:59`,
      daypart: null,
      specificHour,
    }
  }

  if (kind === 'now' || op === 'current') {
    return {
      kind: 'now',
      timeZone: tz,
      localNow: local,
      dates: [local.isoDate],
      startIso: `${local.isoDate}T${String(local.hour).padStart(2, '0')}:00`,
      endIso: `${local.isoDate}T${String(Math.min(23, local.hour + 1)).padStart(2, '0')}:00`,
      daypart: null,
      specificHour: local.hour,
    }
  }

  // today / tomorrow full day
  return {
    kind,
    timeZone: tz,
    localNow: local,
    dates: [targetDate],
    startIso: `${targetDate}T00:00`,
    endIso: `${addIsoDays(targetDate, 1)}T00:00`,
    daypart: null,
    specificHour: null,
  }
}

/**
 * Filter hourly rows whose `time` (ISO-like local, no Z) falls in [startIso, endIso).
 * @param {Array<{ time: string }>} hourly
 * @param {{ startIso: string, endIso: string }} window
 */
export function filterHourlyInWindow(hourly, window) {
  const list = Array.isArray(hourly) ? hourly : []
  const start = window?.startIso || ''
  const end = window?.endIso || ''
  return list.filter((h) => {
    const t = String(h.time || '').slice(0, 16)
    if (!t) return false
    return t >= start.slice(0, 16) && t < end.slice(0, 16)
  })
}

/**
 * Pick hourly record closest to target hour on date.
 * @param {Array<{ time: string }>} hourly
 * @param {string} isoDate
 * @param {number} hour
 */
export function pickClosestHourly(hourly, isoDate, hour) {
  const list = Array.isArray(hourly) ? hourly : []
  const dayRows = list.filter((h) => String(h.time || '').startsWith(isoDate))
  if (!dayRows.length) return null
  let best = null
  let bestDiff = Infinity
  for (const row of dayRows) {
    const hh = Number(String(row.time).slice(11, 13))
    if (!Number.isFinite(hh)) continue
    const diff = Math.abs(hh - hour)
    if (diff < bestDiff) {
      bestDiff = diff
      best = row
    }
  }
  return best
}
