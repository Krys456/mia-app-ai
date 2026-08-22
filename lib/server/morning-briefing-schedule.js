/**
 * #334D1 — Morning briefing schedule CRUD + due-window helpers.
 * Server-authoritative; no generated briefing content.
 */

import { getServiceSupabase } from './supabase.js'
import { ensureAuthUserRow } from './brain-memory.js'
import { isValidIanaTimeZone } from './reminder-time.js'

export const MORNING_BRIEFING_DEFAULT_TIME = '08:00'
export const MORNING_BRIEFING_DEFAULT_DAYS = Object.freeze([1, 2, 3, 4, 5])
export const MORNING_BRIEFING_DUE_WINDOW_MINUTES = 10

/**
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
function requireOwnerUserId(scope) {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim() : ''
  if (!userId || scope?.requireExplicitUserId !== true) {
    throw new Error('Explicit morning briefing schedule owner scope is required')
  }
  return userId
}

/**
 * @param {string} userId
 */
export function morningBriefingScheduleOwnerScope(userId) {
  return { userId: String(userId || '').trim(), requireExplicitUserId: true }
}

/**
 * @param {unknown} raw
 * @returns {string | null} HH:mm
 */
export function normalizeLocalTimeHhMm(raw) {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  const m = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * @param {unknown} raw
 * @returns {number[] | null} ISO weekdays 1–7 unique sorted
 */
export function normalizeDaysOfWeek(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const n = typeof item === 'number' ? item : Number(item)
    if (!Number.isInteger(n) || n < 1 || n > 7) return null
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  if (!out.length) return null
  out.sort((a, b) => a - b)
  return out
}

/**
 * Local HH:mm + ISO weekday + YYYY-MM-DD in IANA zone.
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function localWallClockParts(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type) => parts.find((p) => p.type === type)?.value
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute'))
  const y = get('year')
  const m = get('month')
  const d = get('day')
  const localDate = `${y}-${m}-${d}`
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const isoWeekday = map[wd] || null

  return {
    localDate,
    hhmm,
    minutes: hour * 60 + minute,
    isoWeekday,
  }
}

/**
 * Deterministic due check (mirrors SQL window semantics).
 * @param {{
 *   enabled: boolean
 *   localTime: string
 *   daysOfWeek: number[]
 *   timezone: string
 *   lastDeliveredLocalDate?: string | null
 * }} schedule
 * @param {{ now?: Date, windowMinutes?: number }} [opts]
 */
export function isMorningBriefingDue(schedule, opts = {}) {
  if (!schedule?.enabled) return { due: false, reason: 'disabled' }
  const tz = typeof schedule.timezone === 'string' ? schedule.timezone.trim() : ''
  if (!tz || !isValidIanaTimeZone(tz)) return { due: false, reason: 'bad_timezone' }
  const localTime = normalizeLocalTimeHhMm(schedule.localTime)
  if (!localTime) return { due: false, reason: 'bad_time' }
  const days = normalizeDaysOfWeek(schedule.daysOfWeek)
  if (!days) return { due: false, reason: 'bad_days' }

  const now = opts.now instanceof Date ? opts.now : new Date()
  const windowMinutes =
    typeof opts.windowMinutes === 'number' && opts.windowMinutes > 0
      ? Math.min(opts.windowMinutes, 30)
      : MORNING_BRIEFING_DUE_WINDOW_MINUTES

  const wall = localWallClockParts(tz, now)
  if (!wall.isoWeekday || !days.includes(wall.isoWeekday)) {
    return { due: false, reason: 'wrong_weekday', localDate: wall.localDate, hhmm: wall.hhmm }
  }
  if (
    schedule.lastDeliveredLocalDate &&
    String(schedule.lastDeliveredLocalDate).slice(0, 10) === wall.localDate
  ) {
    return { due: false, reason: 'already_delivered', localDate: wall.localDate, hhmm: wall.hhmm }
  }

  const [sh, sm] = localTime.split(':').map(Number)
  const schedMins = sh * 60 + sm
  if (wall.minutes < schedMins) {
    return { due: false, reason: 'before_window', localDate: wall.localDate, hhmm: wall.hhmm }
  }
  if (wall.minutes >= schedMins + windowMinutes) {
    return { due: false, reason: 'after_window', localDate: wall.localDate, hhmm: wall.hhmm }
  }
  return {
    due: true,
    reason: 'due',
    localDate: wall.localDate,
    hhmm: wall.hhmm,
    isoWeekday: wall.isoWeekday,
  }
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapMorningBriefingSchedulePublic(row) {
  if (!row) return null
  return {
    enabled: row.enabled === true,
    localTime: String(row.local_time || MORNING_BRIEFING_DEFAULT_TIME),
    daysOfWeek: Array.isArray(row.days_of_week)
      ? row.days_of_week.map((n) => Number(n)).filter((n) => n >= 1 && n <= 7)
      : [...MORNING_BRIEFING_DEFAULT_DAYS],
    timezone: String(row.timezone || 'UTC'),
    lastDeliveredLocalDate:
      row.last_delivered_local_date == null
        ? null
        : String(row.last_delivered_local_date).slice(0, 10),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
    createdAt: row.created_at == null ? null : String(row.created_at),
  }
}

/**
 * @param {Record<string, unknown>} input
 */
export function validateMorningBriefingScheduleInput(input) {
  /** @type {Record<string, string>} */
  const errors = {}
  const enabled = input.enabled === true

  const localTime = normalizeLocalTimeHhMm(input.localTime ?? input.local_time)
  if (!localTime) errors.localTime = 'localTime must be HH:mm (24h)'

  const days = normalizeDaysOfWeek(input.daysOfWeek ?? input.days_of_week)
  if (!days) errors.daysOfWeek = 'daysOfWeek must be a non-empty array of ISO weekdays 1–7'

  const timezoneRaw =
    typeof input.timezone === 'string'
      ? input.timezone.trim()
      : typeof input.timeZone === 'string'
        ? input.timeZone.trim()
        : ''
  if (!timezoneRaw || !isValidIanaTimeZone(timezoneRaw)) {
    errors.timezone = 'timezone must be a valid IANA time zone'
  }

  if (Object.keys(errors).length) return { ok: false, errors }

  return {
    ok: true,
    data: {
      enabled,
      localTime,
      daysOfWeek: days,
      timezone: timezoneRaw,
    },
  }
}

/**
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
/**
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 * @param {{ getServiceSupabase?: typeof getServiceSupabase }} [deps]
 */
export async function getMorningBriefingSchedule(scope, deps = {}) {
  const userId = requireOwnerUserId(scope)
  const getSb = deps.getServiceSupabase ?? getServiceSupabase
  const supabase = await getSb()
  const { data, error } = await supabase
    .from('morning_briefing_schedules')
    .select(
      'user_id, enabled, local_time, days_of_week, timezone, last_delivered_local_date, created_at, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    return {
      enabled: false,
      localTime: MORNING_BRIEFING_DEFAULT_TIME,
      daysOfWeek: [...MORNING_BRIEFING_DEFAULT_DAYS],
      timezone: 'UTC',
      lastDeliveredLocalDate: null,
      updatedAt: null,
      createdAt: null,
      exists: false,
    }
  }
  return { ...mapMorningBriefingSchedulePublic(data), exists: true }
}

/**
 * Upsert schedule for owner. Ignores body user_id.
 * @param {Record<string, unknown>} input
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
/**
 * @param {Record<string, unknown>} input
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 * @param {{ getServiceSupabase?: typeof getServiceSupabase, ensureAuthUserRow?: typeof ensureAuthUserRow }} [deps]
 */
export async function upsertMorningBriefingSchedule(input, scope, deps = {}) {
  const userId = requireOwnerUserId(scope)
  const validated = validateMorningBriefingScheduleInput(input)
  if (validated.ok === false) return validated

  const getSb = deps.getServiceSupabase ?? getServiceSupabase
  const ensureRow = deps.ensureAuthUserRow ?? ensureAuthUserRow
  const supabase = await getSb()
  await ensureRow(supabase, userId)
  const row = {
    user_id: userId,
    enabled: validated.data.enabled,
    local_time: validated.data.localTime,
    days_of_week: validated.data.daysOfWeek,
    timezone: validated.data.timezone,
  }

  const { data, error } = await supabase
    .from('morning_briefing_schedules')
    .upsert(row, { onConflict: 'user_id' })
    .select(
      'user_id, enabled, local_time, days_of_week, timezone, last_delivered_local_date, created_at, updated_at',
    )
    .single()

  if (error) throw error
  return { ok: true, schedule: { ...mapMorningBriefingSchedulePublic(data), exists: true } }
}

/**
 * Disable schedule (keeps row / prefs for re-enable).
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
/**
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 * @param {{ getServiceSupabase?: typeof getServiceSupabase }} [deps]
 */
export async function disableMorningBriefingSchedule(scope, deps = {}) {
  const userId = requireOwnerUserId(scope)
  const getSb = deps.getServiceSupabase ?? getServiceSupabase
  const supabase = await getSb()
  const existing = await getMorningBriefingSchedule(scope, deps)
  if (!existing.exists) {
    return { ok: true, schedule: { ...existing, enabled: false } }
  }

  const { data, error } = await supabase
    .from('morning_briefing_schedules')
    .update({ enabled: false })
    .eq('user_id', userId)
    .select(
      'user_id, enabled, local_time, days_of_week, timezone, last_delivered_local_date, created_at, updated_at',
    )
    .single()

  if (error) throw error
  return { ok: true, schedule: { ...mapMorningBriefingSchedulePublic(data), exists: true } }
}
