/**
 * #303A — Reminders feature gate (server).
 *
 * Default: enabled unless REMINDERS_ENABLED=0.
 * Client UI uses VITE_REMINDERS_ENABLED with the same kill-switch semantics.
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isRemindersEnabled(env = process.env) {
  const raw = typeof env.REMINDERS_ENABLED === 'string' ? env.REMINDERS_ENABLED.trim() : ''
  if (raw === '0') return false
  return true
}
