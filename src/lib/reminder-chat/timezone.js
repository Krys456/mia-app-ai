/**
 * #380C — Reminder timezone reliability (Reminder-only; not Calendar).
 *
 * POSIX Etc/GMT±N has inverted signs and often reflects OS misconfig.
 * Never use it as authoritative wall-clock zone for absolute reminders.
 */

/**
 * @param {string | null | undefined} tz
 * @returns {boolean}
 */
export function isUnreliableReminderTimeZone(tz) {
  return /^Etc\/GMT([+-]\d+)?$/i.test(String(tz || '').trim())
}

/**
 * Valid IANA zone that is safe for Reminder wall-clock interpretation.
 * @param {string | null | undefined} tz
 * @returns {boolean}
 */
export function isReliableReminderTimeZone(tz) {
  const t = typeof tz === 'string' ? tz.trim() : ''
  if (!t || isUnreliableReminderTimeZone(t)) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: t }).format(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * Read browser zone without trusting Etc/GMT*.
 * @returns {string | null}
 */
export function readBrowserReminderTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    if (tz && isReliableReminderTimeZone(tz)) return tz
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Resolve scheduling timezone for Reminder create/parse.
 *
 * - Prefer explicit reliable IANA when provided.
 * - Else browser IANA when reliable.
 * - No product default (never invent Europe/Rome).
 * - No Calendar / Google primary coupling.
 *
 * @param {string | null | undefined} [explicit]
 * @returns {{ ok: true, timeZone: string } | { ok: false, code: 'unreliable_timezone' | 'missing_timezone' }}
 */
export function resolveReminderSchedulingTimeZone(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) {
    const t = explicit.trim()
    if (isUnreliableReminderTimeZone(t)) {
      return { ok: false, code: 'unreliable_timezone' }
    }
    if (!isReliableReminderTimeZone(t)) {
      return { ok: false, code: 'missing_timezone' }
    }
    return { ok: true, timeZone: t }
  }
  const browser = readBrowserReminderTimeZone()
  if (browser) return { ok: true, timeZone: browser }
  // Browser missing or Etc/GMT* — no trusted Reminder-owned fallback exists.
  return { ok: false, code: 'unreliable_timezone' }
}
