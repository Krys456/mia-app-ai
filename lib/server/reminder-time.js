/**
 * #303A — Reminder timezone + fire_at validation helpers.
 */

import { REMINDER_FIELD_LIMITS } from './reminder-field-limits.js'

/**
 * @param {string} timezone
 * @returns {boolean}
 */
export function isValidIanaTimeZone(timezone) {
  const tz = typeof timezone === 'string' ? timezone.trim() : ''
  if (!tz || tz.length > REMINDER_FIELD_LIMITS.timezone) return false
  try {
    // Throws RangeError for invalid IANA zones in modern Node/Intl.
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * Parse fire_at ISO / Date into a UTC Date.
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseFireAt(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * @param {Date} fireAt
 * @param {Date} [now]
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function validateFireAtBounds(fireAt, now = new Date()) {
  const t = fireAt.getTime()
  const n = now.getTime()
  if (t < n - REMINDER_FIELD_LIMITS.pastGraceMs) {
    return { ok: false, code: 'reminder_in_past' }
  }
  if (t > n + REMINDER_FIELD_LIMITS.maxFutureMs) {
    return { ok: false, code: 'reminder_too_far' }
  }
  return { ok: true }
}
