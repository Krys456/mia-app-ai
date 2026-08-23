/**
 * #357B / #380C — Deterministic Italian (and light EN) reminder date/time parser.
 * Authority: validated fireAt UTC + reliable IANA timezone. No model timestamps.
 * #380C: never interpret absolute wall-clock using Etc/GMT*.
 */

import { foldReminderText } from './normalize.js'
import { isReliableReminderTimeZone, resolveReminderSchedulingTimeZone } from './timezone.js'

const PAST_GRACE_MS = 30_000
const MAX_FUTURE_MS = 1000 * 60 * 60 * 24 * 731

const WEEKDAYS = [
  { re: /\bdomenica\b|\bsunday\b/, i: 0 },
  { re: /\blunedi\b|\bmonday\b/, i: 1 },
  { re: /\bmartedi\b|\btuesday\b/, i: 2 },
  { re: /\bmercoledi\b|\bwednesday\b/, i: 3 },
  { re: /\bgiovedi\b|\bthursday\b/, i: 4 },
  { re: /\bvenerdi\b|\bfriday\b/, i: 5 },
  { re: /\bsabato\b|\bsaturday\b/, i: 6 },
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

function getTzParts(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
    const map = {}
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== 'literal') map[p.type] = p.value
    }
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    }
  } catch {
    return null
  }
}

/** Naive local Y-M-D H:M in IANA zone → UTC ISO (DST-aware iterative). */
export function zonedLocalToUtcIso(localIsoWithoutOffset, timeZone) {
  const m = String(localIsoWithoutOffset || '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  )
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6] || '0')
  try {
    let utc = Date.UTC(year, month - 1, day, hour, minute, second)
    for (let i = 0; i < 3; i += 1) {
      const parts = getTzParts(new Date(utc), timeZone)
      if (!parts) return null
      const asUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      )
      const desired = Date.UTC(year, month - 1, day, hour, minute, second)
      const delta = desired - asUtc
      utc += delta
      if (delta === 0) break
    }
    return new Date(utc).toISOString()
  } catch {
    return null
  }
}

function addCalendarDays(y, m, d, delta) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() }
}

function parseClock(t) {
  // alle 9 / alle 9:30 / alle 21 / at 9 / 9:30
  let m = t.match(/\b(?:alle|at)\s+(\d{1,2})(?::(\d{2}))?\b/)
  if (!m) m = t.match(/\b(\d{1,2}):(\d{2})\b/)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] != null ? Number(m[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (minute < 0 || minute > 59) return null
  if (hour < 0 || hour > 23) return null
  // Italian spoken "alle nove" often means 09:00; keep 0-23 as given.
  return { hour, minute }
}

function parseRelative(t) {
  let m = t.match(/\btra\s+(\d{1,3})\s+minut[oi]\b/)
  if (m) return { ms: Number(m[1]) * 60_000 }
  m = t.match(/\bin\s+(\d{1,3})\s+minutes?\b/)
  if (m) return { ms: Number(m[1]) * 60_000 }
  m = t.match(/\btra\s+(mezz.?ora|mezza\s+ora)\b/)
  if (m) return { ms: 30 * 60_000 }
  m = t.match(/\btra\s+(\d{1,2})\s+or[ea]\b/)
  if (m) return { ms: Number(m[1]) * 3_600_000 }
  m = t.match(/\bin\s+(\d{1,2})\s+hours?\b/)
  if (m) return { ms: Number(m[1]) * 3_600_000 }
  return null
}

function weekdayIndex(t) {
  for (const w of WEEKDAYS) {
    if (w.re.test(t)) return w.i
  }
  return null
}

function nextWeekdayDate(parts, targetDow, nextWeek) {
  const jsDow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  let delta = (targetDow - jsDow + 7) % 7
  if (delta === 0) delta = nextWeek ? 7 : 0
  else if (nextWeek && delta < 7) {
    /* keep delta */
  }
  if (!nextWeek && delta === 0) {
    // same weekday today — caller decides via clock
  }
  return addCalendarDays(parts.year, parts.month, parts.day, delta === 0 && nextWeek ? 7 : delta)
}

/**
 * @returns {{
 *   ok: true,
 *   fireAtUtc: string,
 *   timezone: string,
 *   localDate: string,
 *   localTime: string,
 *   localDisplay: string,
 * } | {
 *   ok: false,
 *   code: 'ambiguous_time' | 'invalid_time' | 'past_time' | 'too_far' | 'unsupported_recurrence' | 'unreliable_timezone',
 * }}
 */
export function parseReminderDateTime(raw, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const t = foldReminderText(raw)

  if (/\b(ogni\s+(giorno|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)|every\s+(day|monday|week))\b/.test(t)) {
    return { ok: false, code: 'unsupported_recurrence' }
  }

  const relative = parseRelative(t)
  if (relative) {
    // Duration-based: fireAt does not depend on wall-clock zone.
    // Prefer a reliable zone for labels/metadata; else UTC (honest for elapsed time).
    const resolved = resolveReminderSchedulingTimeZone(opts.timeZone)
    const timeZone =
      resolved.ok && isReliableReminderTimeZone(resolved.timeZone)
        ? resolved.timeZone
        : 'UTC'
    const fire = new Date(now.getTime() + relative.ms)
    const parts = getTzParts(fire, timeZone)
    if (!parts) return { ok: false, code: 'invalid_time' }
    const localDate = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
    const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`
    return finalize(fire.toISOString(), timeZone, localDate, localTime, now)
  }

  // Absolute wall-clock: require a reliable IANA zone (no Etc/GMT*, no invented default).
  const resolved = resolveReminderSchedulingTimeZone(opts.timeZone)
  if (!resolved.ok) {
    return { ok: false, code: resolved.code === 'missing_timezone' ? 'invalid_time' : 'unreliable_timezone' }
  }
  const timeZone = resolved.timeZone

  // Evening without clock → clarify (no canonical stasera time in product).
  if (/\b(stasera|questa\s+sera|tonight|this\s+evening)\b/.test(t) && !parseClock(t)) {
    return { ok: false, code: 'ambiguous_time' }
  }

  const clock = parseClock(t)
  const nowParts = getTzParts(now, timeZone)
  if (!nowParts) return { ok: false, code: 'invalid_time' }

  let targetDate = null

  if (/\bdopodomani\b|\bday\s+after\s+tomorrow\b/.test(t)) {
    targetDate = addCalendarDays(nowParts.year, nowParts.month, nowParts.day, 2)
  } else if (/\bdomani\b|\btomorrow\b/.test(t)) {
    targetDate = addCalendarDays(nowParts.year, nowParts.month, nowParts.day, 1)
  } else if (/\boggi\b|\btoday\b/.test(t)) {
    targetDate = { year: nowParts.year, month: nowParts.month, day: nowParts.day }
  } else {
    const wd = weekdayIndex(t)
    if (wd != null) {
      const nextWeek = /\bprossim[oa]\b|\bnext\b/.test(t)
      targetDate = nextWeekdayDate(nowParts, wd, nextWeek)
      // If same weekday and clock already passed, roll to next week.
      if (!nextWeek && clock) {
        const sameDay =
          targetDate.year === nowParts.year &&
          targetDate.month === nowParts.month &&
          targetDate.day === nowParts.day
        if (sameDay) {
          const mins = nowParts.hour * 60 + nowParts.minute
          const want = clock.hour * 60 + clock.minute
          if (want <= mins) {
            targetDate = addCalendarDays(targetDate.year, targetDate.month, targetDate.day, 7)
          }
        }
      }
    }
  }

  // "alle 9" alone → nearest future occurrence (today if upcoming, else tomorrow).
  if (!targetDate && clock) {
    const todayMins = nowParts.hour * 60 + nowParts.minute
    const want = clock.hour * 60 + clock.minute
    if (want > todayMins + 0) {
      targetDate = { year: nowParts.year, month: nowParts.month, day: nowParts.day }
    } else {
      targetDate = addCalendarDays(nowParts.year, nowParts.month, nowParts.day, 1)
    }
  }

  if (!targetDate && !clock) {
    return { ok: false, code: 'ambiguous_time' }
  }
  if (targetDate && !clock) {
    return { ok: false, code: 'ambiguous_time' }
  }

  const localDate = `${targetDate.year}-${pad2(targetDate.month)}-${pad2(targetDate.day)}`
  const localTime = `${pad2(clock.hour)}:${pad2(clock.minute)}`
  const fireAtUtc = zonedLocalToUtcIso(`${localDate}T${localTime}:00`, timeZone)
  if (!fireAtUtc) return { ok: false, code: 'invalid_time' }
  return finalize(fireAtUtc, timeZone, localDate, localTime, now)
}

function finalize(fireAtUtc, timeZone, localDate, localTime, now) {
  const t = new Date(fireAtUtc).getTime()
  if (Number.isNaN(t)) return { ok: false, code: 'invalid_time' }
  if (t < now.getTime() - PAST_GRACE_MS) {
    return { ok: false, code: 'past_time' }
  }
  if (t > now.getTime() + MAX_FUTURE_MS) {
    return { ok: false, code: 'too_far' }
  }
  return {
    ok: true,
    fireAtUtc,
    timezone: timeZone,
    localDate,
    localTime,
    localDisplay: `${localDate} · ${localTime}`,
  }
}

/**
 * Extract reminder title from create phrases.
 * "Ricordami domani alle 9 di chiamare Marco" → "chiamare Marco"
 */
export function extractReminderTitle(raw) {
  const original = String(raw || '').trim()
  if (!original) return ''
  let s = original
    .replace(/^(ok|okay|va bene|allora|perfetto)[,.]?\s+/i, '')
    .trim()

  s = s.replace(
    /^(ricordami|ricorda\s+mi|remind\s+me|promemoria(?:\s+per)?)\s+/i,
    '',
  )

  // Strip leading when-clause greedily until "di "|"to "|end
  const di = s.match(
    /^(?:tra\s+[^,]+|domani|dopodomani|oggi|stasera|questa\s+sera|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|prossim[oa]\s+\w+|alle\s+\d{1,2}(?::\d{2})?|at\s+\d{1,2}(?::\d{2})?|\d{1,2}:\d{2}|in\s+\d+\s+\w+)(?:\s+(?:alle\s+\d{1,2}(?::\d{2})?|at\s+\d{1,2}(?::\d{2})?|\d{1,2}:\d{2}|prossim[oa]|di|to))*\s+/i,
  )
  // Prefer "di <title>" / "to <title>"
  const mDi = s.match(/\bdi\s+(.+)$/i) || s.match(/\bto\s+(.+)$/i)
  if (mDi && mDi[1]) {
    return cleanTitle(mDi[1])
  }

  // Fallback: remove known time tokens
  let rest = foldReminderText(s)
  rest = s
    .replace(/\b(tra\s+\d+\s+minut[oi]|tra\s+\d+\s+or[ea]|tra\s+mezz.?ora|in\s+\d+\s+minutes?|in\s+\d+\s+hours?)\b/gi, '')
    .replace(/\b(dopodomani|domani|oggi|stasera|questa\s+sera|tomorrow|today|tonight)\b/gi, '')
    .replace(/\b(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday|prossim[oa]|next)\b/gi, '')
    .replace(/\b(alle|at)\s+\d{1,2}(?::\d{2})?\b/gi, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleanTitle(rest)
}

function cleanTitle(s) {
  return String(s || '')
    .replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}
