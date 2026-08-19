/**
 * #304A1 — Calendar UI helpers (Node/server-side contracts).
 *
 * Client Settings visibility is always on (see src/lib/calendarUi.ts).
 * CALENDAR_ENABLED remains the authoritative Edge/server activation gate.
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
 * Client Settings visibility — always on (#304A1).
 * VITE_CALENDAR_ENABLED is ignored for hiding; kept arg for API compatibility.
 * @param {Record<string, unknown>} [_env]
 */
export function isCalendarUiEnabled(_env = {}) {
  return true
}
