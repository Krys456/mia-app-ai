/**
 * #336B — Deterministic free windows from timed event intervals.
 * Display window default 08:00–20:00 local. All-day does not block.
 */

import {
  FREE_TIME_WINDOW,
  PART_OF_DAY_HOURS,
  addDaysYmd,
  approxStartOfDayUtc,
} from './range.js'

/**
 * Google all-day membership: start inclusive, end exclusive.
 * @param {{ allDay?: boolean, start?: string, end?: string }} ev
 * @param {string} dayYmd
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
 * Local hour+minute → Date on dayYmd in zone (approx).
 */
export function localTimeOnDayUtc(dayYmd, hour, minute, timeZone) {
  const start = approxStartOfDayUtc(dayYmd, timeZone)
  if (!start) return null
  return new Date(start.getTime() + (hour * 60 + (minute || 0)) * 60000)
}

export function localHourMinute(msOrIso, timeZone) {
  try {
    const d = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(msOrIso)
    if (Number.isNaN(d.getTime())) return null
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { hour, minute }
  } catch {
    return null
  }
}

/**
 * @param {object[]} events
 * @param {{
 *   dayYmd: string
 *   timeZone: string
 *   windowStartHour?: number
 *   windowEndHour?: number
 * }} opts
 */
export function computeFreeWindows(events, opts) {
  const tz = opts.timeZone || 'UTC'
  const dayYmd = opts.dayYmd
  if (!dayYmd) return []
  const winStartH = opts.windowStartHour ?? FREE_TIME_WINDOW.start
  const winEndH = opts.windowEndHour ?? FREE_TIME_WINDOW.end
  const winStart = localTimeOnDayUtc(dayYmd, winStartH, 0, tz)
  const winEnd = localTimeOnDayUtc(dayYmd, winEndH, 0, tz)
  if (!winStart || !winEnd || winEnd <= winStart) return []

  const busy = []
  for (const ev of events || []) {
    if (!ev || ev.allDay) continue
    const s = Date.parse(ev.start)
    const e = Date.parse(ev.end)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
    const from = Math.max(s, winStart.getTime())
    const to = Math.min(e, winEnd.getTime())
    if (to > from) busy.push({ from, to })
  }
  busy.sort((a, b) => a.from - b.from)

  const merged = []
  for (const b of busy) {
    const last = merged[merged.length - 1]
    if (!last || b.from > last.to) merged.push({ ...b })
    else last.to = Math.max(last.to, b.to)
  }

  const free = []
  let cursor = winStart.getTime()
  for (const b of merged) {
    if (b.from > cursor) {
      free.push({
        fromMs: cursor,
        toMs: b.from,
        minutes: Math.round((b.from - cursor) / 60000),
      })
    }
    cursor = Math.max(cursor, b.to)
  }
  if (winEnd.getTime() > cursor) {
    free.push({
      fromMs: cursor,
      toMs: winEnd.getTime(),
      minutes: Math.round((winEnd.getTime() - cursor) / 60000),
    })
  }
  return free.filter((w) => w.minutes >= 15)
}

export function filterEventsForQuery(events, opts) {
  const tz = opts.timeZone || 'UTC'
  const list = Array.isArray(events) ? events.slice() : []
  const out = []
  for (const ev of list) {
    if (!ev) continue
    if (ev.allDay) {
      if (opts.afterHour != null || opts.beforeHour != null || opts.partOfDay) continue
      // Day-scoped list: Google end.date is exclusive.
      if (opts.dayYmd && !allDayEventIncludesYmd(ev, opts.dayYmd)) continue
      out.push(ev)
      continue
    }
    const startMs = Date.parse(ev.start)
    if (!Number.isFinite(startMs)) continue
    const hm = localHourMinute(startMs, tz)
    if (!hm) continue
    const mins = hm.hour * 60 + hm.minute
    if (opts.afterHour != null) {
      const after = opts.afterHour * 60 + (opts.afterMinute || 0)
      if (mins < after) continue
    }
    if (opts.beforeHour != null) {
      const before = opts.beforeHour * 60 + (opts.beforeMinute || 0)
      if (mins >= before) continue
    }
    if (opts.partOfDay) {
      const w = PART_OF_DAY_HOURS[opts.partOfDay]
      if (w && (hm.hour < w.start || hm.hour >= w.end)) continue
    }
    out.push(ev)
  }
  return out
}

export { addDaysYmd }
