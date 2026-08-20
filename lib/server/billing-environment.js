/**
 * #332E3A — Runtime billing environment (sandbox | live).
 *
 * Explicit BILLING_ENVIRONMENT only. Do not derive from NODE_ENV alone.
 * Fail closed on missing/invalid values when billing resolution requires it.
 */

/** @typedef {'sandbox' | 'live'} BillingEnvironment */

export const BILLING_ENVIRONMENT_ENV = 'BILLING_ENVIRONMENT'

export const BILLING_ENVIRONMENTS = Object.freeze(
  /** @type {const} */ (['sandbox', 'live']),
)

/**
 * @param {unknown} value
 * @returns {BillingEnvironment | null}
 */
export function normalizeBillingEnvironment(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return BILLING_ENVIRONMENTS.includes(/** @type {BillingEnvironment} */ (v))
    ? /** @type {BillingEnvironment} */ (v)
    : null
}

/**
 * Parse runtime billing environment from env.
 * Fail closed: missing / invalid → null (callers must not resolve paid across envs).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {BillingEnvironment | null}
 */
export function resolveRuntimeBillingEnvironment(env = process.env) {
  return normalizeBillingEnvironment(env?.[BILLING_ENVIRONMENT_ENV])
}

/**
 * Require a valid runtime billing environment.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true, environment: BillingEnvironment } | { ok: false, code: 'billing_configuration_error', detail: string }}
 */
export function requireRuntimeBillingEnvironment(env = process.env) {
  const environment = resolveRuntimeBillingEnvironment(env)
  if (!environment) {
    return {
      ok: false,
      code: 'billing_configuration_error',
      detail: 'billing_environment_invalid',
    }
  }
  return { ok: true, environment }
}

/**
 * Filter subscription rows to a single billing environment.
 *
 * @param {import('./subscriptions.js').SubscriptionRow[] | null | undefined} rows
 * @param {BillingEnvironment | null | undefined} environment
 * @returns {import('./subscriptions.js').SubscriptionRow[]}
 */
export function filterSubscriptionsByEnvironment(rows, environment) {
  const list = Array.isArray(rows) ? rows : []
  if (!environment) return []
  return list.filter((row) => {
    const env =
      typeof row?.environment === 'string' ? row.environment.trim().toLowerCase() : ''
    return env === environment
  })
}
