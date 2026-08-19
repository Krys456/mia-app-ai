/**
 * #303C — Server kill switch for Web Push delivery / subscription APIs.
 *
 * Independent of REMINDERS_ENABLED and reminder_scheduler_config.enabled.
 */

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isPushEnabled(env = process.env) {
  const raw = typeof env.PUSH_ENABLED === 'string' ? env.PUSH_ENABLED.trim() : ''
  if (!raw) return false
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes'
}

/**
 * Client may expose a soft UI gate; server remains authoritative for delivery.
 * @param {Record<string, unknown>} [env]
 */
export function isPushUiEnabled(env = {}) {
  const raw =
    typeof env.VITE_PUSH_ENABLED === 'string'
      ? env.VITE_PUSH_ENABLED.trim()
      : typeof process !== 'undefined' && typeof process.env?.VITE_PUSH_ENABLED === 'string'
        ? process.env.VITE_PUSH_ENABLED.trim()
        : ''
  if (raw === '0' || raw.toLowerCase() === 'false') return false
  // Default: UI available when public VAPID key is configured (still needs permission).
  const vapid =
    typeof env.VITE_VAPID_PUBLIC_KEY === 'string'
      ? env.VITE_VAPID_PUBLIC_KEY.trim()
      : typeof process !== 'undefined' && typeof process.env?.VITE_VAPID_PUBLIC_KEY === 'string'
        ? process.env.VITE_VAPID_PUBLIC_KEY.trim()
        : ''
  return Boolean(vapid)
}
