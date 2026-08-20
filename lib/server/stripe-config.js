/**
 * #332E3A — Lazy Stripe server configuration (TEST MODE for Preview/sandbox).
 *
 * Evaluated only when billing is invoked — Core chat must deploy without Stripe env.
 * Never expose secrets or Price IDs via VITE_*.
 */

import {
  normalizeBillingEnvironment,
  requireRuntimeBillingEnvironment,
} from './billing-environment.js'

/** @typedef {'base' | 'pro'} PaidPlanId */
/** @typedef {import('./billing-environment.js').BillingEnvironment} BillingEnvironment */

/**
 * @typedef {{
 *   environment: BillingEnvironment
 *   secretKey: string
 *   webhookSecret: string
 *   priceBaseMonthly: string
 *   priceProMonthly: string
 *   priceToPlan: Readonly<Record<string, PaidPlanId>>
 *   planToPrice: Readonly<Record<PaidPlanId, string>>
 * }} StripeBillingConfig
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nonEmpty(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v ? v : null
}

/**
 * Detect Stripe key mode from secret key prefix.
 *
 * @param {string} secretKey
 * @returns {'sandbox' | 'live' | null}
 */
export function detectStripeKeyMode(secretKey) {
  if (typeof secretKey !== 'string') return null
  const k = secretKey.trim()
  if (k.startsWith('sk_test_')) return 'sandbox'
  if (k.startsWith('sk_live_')) return 'live'
  // Restricted keys
  if (k.startsWith('rk_test_')) return 'sandbox'
  if (k.startsWith('rk_live_')) return 'live'
  return null
}

/**
 * Load + validate Stripe billing config. Lazy — call only from billing routes.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true, config: StripeBillingConfig } | { ok: false, code: 'billing_configuration_error' | 'billing_unavailable', detail: string }}
 */
export function loadStripeBillingConfig(env = process.env) {
  const envReq = requireRuntimeBillingEnvironment(env)
  if (!envReq.ok) return envReq

  const secretKey = nonEmpty(env.STRIPE_SECRET_KEY)
  const webhookSecret = nonEmpty(env.STRIPE_WEBHOOK_SECRET)
  const priceBaseMonthly = nonEmpty(env.STRIPE_PRICE_BASE_MONTHLY)
  const priceProMonthly = nonEmpty(env.STRIPE_PRICE_PRO_MONTHLY)

  if (!secretKey || !webhookSecret || !priceBaseMonthly || !priceProMonthly) {
    return {
      ok: false,
      code: 'billing_unavailable',
      detail: 'stripe_env_incomplete',
    }
  }

  const keyMode = detectStripeKeyMode(secretKey)
  if (!keyMode) {
    return {
      ok: false,
      code: 'billing_configuration_error',
      detail: 'stripe_key_mode_unknown',
    }
  }
  if (keyMode !== envReq.environment) {
    return {
      ok: false,
      code: 'billing_configuration_error',
      detail: 'stripe_key_environment_mismatch',
    }
  }

  if (priceBaseMonthly === priceProMonthly) {
    return {
      ok: false,
      code: 'billing_configuration_error',
      detail: 'stripe_price_ids_not_distinct',
    }
  }

  /** @type {Readonly<Record<string, PaidPlanId>>} */
  const priceToPlan = Object.freeze({
    [priceBaseMonthly]: 'base',
    [priceProMonthly]: 'pro',
  })

  /** @type {Readonly<Record<PaidPlanId, string>>} */
  const planToPrice = Object.freeze({
    base: priceBaseMonthly,
    pro: priceProMonthly,
  })

  return {
    ok: true,
    config: {
      environment: envReq.environment,
      secretKey,
      webhookSecret,
      priceBaseMonthly,
      priceProMonthly,
      priceToPlan,
      planToPrice,
    },
  }
}

/**
 * Map target plan → Price ID from trusted server config.
 *
 * @param {StripeBillingConfig} config
 * @param {unknown} targetPlan
 * @returns {{ ok: true, planId: PaidPlanId, priceId: string } | { ok: false, code: string, detail?: string }}
 */
export function resolvePriceIdForPlan(config, targetPlan) {
  const plan =
    typeof targetPlan === 'string' ? targetPlan.trim().toLowerCase() : ''
  if (plan !== 'base' && plan !== 'pro') {
    return { ok: false, code: 'unknown_billing_product', detail: 'target_plan_invalid' }
  }
  const priceId = config.planToPrice[plan]
  if (!priceId) {
    return { ok: false, code: 'billing_configuration_error', detail: 'price_missing' }
  }
  return { ok: true, planId: plan, priceId }
}

/**
 * Map Stripe Price ID → planId.
 *
 * @param {StripeBillingConfig} config
 * @param {unknown} priceId
 * @returns {PaidPlanId | null}
 */
export function mapStripePriceToPlanId(config, priceId) {
  if (typeof priceId !== 'string') return null
  const id = priceId.trim()
  if (!id) return null
  return config.priceToPlan[id] || null
}

/**
 * Product map shape for applyBillingEvent / buildVerifiedBillingEvent.
 *
 * @param {StripeBillingConfig} config
 */
export function stripeProductMapFromConfig(config) {
  return Object.freeze({
    stripe: config.priceToPlan,
  })
}

/**
 * Trusted app origin for Checkout success/cancel URLs.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function resolveTrustedAppOrigin(env = process.env) {
  const explicit = nonEmpty(env.BILLING_APP_ORIGIN) || nonEmpty(env.APP_ORIGIN)
  if (explicit) return explicit.replace(/\/$/, '')

  const vercelUrl = nonEmpty(env.VERCEL_URL)
  if (vercelUrl) {
    const normalized = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`
    return normalized.replace(/\/$/, '')
  }

  // Local vercel/vite default
  if (env.NODE_ENV !== 'production') {
    return 'http://localhost:5173'
  }
  return null
}

export { normalizeBillingEnvironment }
