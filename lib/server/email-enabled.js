/**
 * #311 — Email feature kill switch (Node/server).
 * Client Settings visibility is always on (see src/lib/emailUi.ts).
 * EMAIL_ENABLED is the authoritative Edge/server activation gate.
 */

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isEmailEnabled(env = process.env) {
  const raw = typeof env.EMAIL_ENABLED === 'string' ? env.EMAIL_ENABLED.trim() : ''
  if (!raw) return false
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes'
}

/**
 * Client Settings visibility — always on (#311).
 * @param {Record<string, unknown>} [_env]
 */
export function isEmailUiEnabled(_env = {}) {
  return true
}
