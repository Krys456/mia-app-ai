/**
 * #304A1 — Calendar integration feature gates.
 *
 * Independent of REMINDERS_ENABLED / PUSH_ENABLED.
 * Default OFF until operator enables.
 */

/**
 * Edge / server kill switch. Default false when unset.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isCalendarEnabled(env = process.env) {
  const raw = typeof env.CALENDAR_ENABLED === 'string' ? env.CALENDAR_ENABLED.trim() : ''
  if (!raw) return false
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes'
}

/**
 * Client UI gate. Default false when unset (safe until operator config is ready).
 * @param {Record<string, unknown>} [env]
 */
export function isCalendarUiEnabled(env = {}) {
  const raw =
    typeof env.VITE_CALENDAR_ENABLED === 'string'
      ? env.VITE_CALENDAR_ENABLED.trim()
      : typeof process !== 'undefined' && typeof process.env?.VITE_CALENDAR_ENABLED === 'string'
        ? process.env.VITE_CALENDAR_ENABLED.trim()
        : ''
  if (!raw) return false
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes'
}
