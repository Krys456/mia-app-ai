/**
 * #386C — Account deletion kill switch.
 * Default ON. Set ACCOUNT_DELETION_ENABLED=0 to disable API.
 * Client UI: VITE_ACCOUNT_DELETION_ENABLED=0 hides the control.
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isAccountDeletionEnabled(env = process.env) {
  const raw =
    typeof env.ACCOUNT_DELETION_ENABLED === 'string'
      ? env.ACCOUNT_DELETION_ENABLED.trim()
      : ''
  if (!raw) return true
  const lower = raw.toLowerCase()
  return !(lower === '0' || lower === 'false' || lower === 'off' || lower === 'no')
}
