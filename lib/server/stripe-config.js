/**
 * #388B — Stripe Test Mode configuration (server-only).
 *
 * Never import from Vite/browser code. Secrets and Price IDs stay server-side.
 * Production is hard-blocked during #388B (no live billing).
 */

/** @typedef {'base' | 'pro'} PaidPlanId */

export const STRIPE_SECRET_KEY_ENV = 'STRIPE_SECRET_KEY'
export const STRIPE_WEBHOOK_SECRET_ENV = 'STRIPE_WEBHOOK_SECRET'
export const STRIPE_PRICE_BASE_ENV = 'STRIPE_PRICE_BASE_MONTHLY'
export const STRIPE_PRICE_PRO_ENV = 'STRIPE_PRICE_PRO_MONTHLY'
export const STRIPE_BILLING_ENABLED_ENV = 'STRIPE_BILLING_ENABLED'
export const STRIPE_PORTAL_ENABLED_ENV = 'STRIPE_PORTAL_ENABLED'
export const BILLING_ENVIRONMENT_ENV = 'BILLING_ENVIRONMENT'

export const STRIPE_USER_METADATA_KEY = 'shinkaido_user_id'
export const STRIPE_PLAN_METADATA_KEY = 'shinkaido_plan_id'

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTruthyFlag(value) {
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveVercelEnv(env = process.env) {
  const raw = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV.trim().toLowerCase() : ''
  if (raw === 'production' || raw === 'preview' || raw === 'development') return raw
  return 'development'
}

/**
 * #388B hard block: never enable Stripe billing on Vercel production.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isStripeBillingDeployAllowed(env = process.env) {
  return resolveVercelEnv(env) !== 'production'
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
function readNonEmpty(env, key) {
  const raw = env[key]
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

/**
 * Billing mirror environment for apply_billing_event.
 * Test Mode secrets → sandbox. Live keys → live (not used in #388B).
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {'sandbox' | 'live'}
 */
export function resolveBillingEnvironment(env = process.env) {
  const explicit = readNonEmpty(env, BILLING_ENVIRONMENT_ENV).toLowerCase()
  if (explicit === 'sandbox' || explicit === 'live') return explicit

  const secret = readNonEmpty(env, STRIPE_SECRET_KEY_ENV)
  if (secret.startsWith('sk_live_')) return 'live'
  return 'sandbox'
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{
 *   ok: true
 *   secretKey: string
 *   webhookSecret: string
 *   priceBaseMonthly: string
 *   priceProMonthly: string
 *   billingEnvironment: 'sandbox' | 'live'
 *   portalEnabled: boolean
 * } | {
 *   ok: false
 *   code: string
 *   detail?: string
 * }}
 */
export function resolveStripeConfig(env = process.env) {
  if (!isStripeBillingDeployAllowed(env)) {
    return { ok: false, code: 'stripe_blocked_on_production' }
  }

  if (!isTruthyFlag(env[STRIPE_BILLING_ENABLED_ENV])) {
    return { ok: false, code: 'stripe_billing_disabled' }
  }

  const secretKey = readNonEmpty(env, STRIPE_SECRET_KEY_ENV)
  const webhookSecret = readNonEmpty(env, STRIPE_WEBHOOK_SECRET_ENV)
  const priceBaseMonthly = readNonEmpty(env, STRIPE_PRICE_BASE_ENV)
  const priceProMonthly = readNonEmpty(env, STRIPE_PRICE_PRO_ENV)

  if (!secretKey) return { ok: false, code: 'stripe_secret_missing' }
  if (secretKey.startsWith('sk_live_')) {
    // #388B Test Mode only — refuse live secrets even on Preview.
    return { ok: false, code: 'stripe_live_key_forbidden' }
  }
  if (!secretKey.startsWith('sk_test_')) {
    return { ok: false, code: 'stripe_secret_invalid' }
  }
  if (!webhookSecret) return { ok: false, code: 'stripe_webhook_secret_missing' }
  if (!priceBaseMonthly) return { ok: false, code: 'stripe_price_base_missing' }
  if (!priceProMonthly) return { ok: false, code: 'stripe_price_pro_missing' }
  if (priceBaseMonthly === priceProMonthly) {
    return { ok: false, code: 'stripe_price_ids_collision' }
  }

  const portalFlag = env[STRIPE_PORTAL_ENABLED_ENV]
  const portalEnabled =
    portalFlag == null || String(portalFlag).trim() === ''
      ? true
      : isTruthyFlag(portalFlag)

  return {
    ok: true,
    secretKey,
    webhookSecret,
    priceBaseMonthly,
    priceProMonthly,
    billingEnvironment: resolveBillingEnvironment(env),
    portalEnabled,
  }
}

/**
 * Public capability flags for Plans UI (no secrets).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function resolveStripePublicCapabilities(env = process.env) {
  const cfg = resolveStripeConfig(env)
  return {
    billingEnabled: cfg.ok === true,
    checkoutEnabled: cfg.ok === true,
    portalEnabled: cfg.ok === true && cfg.portalEnabled === true,
    mode: cfg.ok ? 'test' : 'disabled',
    billingEnvironment: cfg.ok ? cfg.billingEnvironment : null,
  }
}

/**
 * Internal plan → Stripe Price ID allowlist. Never accepts client Price IDs.
 *
 * @param {unknown} planId
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ ok: true, planId: PaidPlanId, priceId: string } | { ok: false, code: string }}
 */
export function mapInternalPlanToStripePriceId(planId, env = process.env) {
  const cfg = resolveStripeConfig(env)
  if (!cfg.ok) return { ok: false, code: cfg.code }

  if (planId === 'free') return { ok: false, code: 'plan_not_purchasable' }
  if (planId !== 'base' && planId !== 'pro') {
    return { ok: false, code: typeof planId === 'string' && planId.trim() ? 'plan_unknown' : 'plan_required' }
  }

  const priceId = planId === 'base' ? cfg.priceBaseMonthly : cfg.priceProMonthly
  return { ok: true, planId, priceId }
}

/**
 * Stripe Price ID → internal paid plan (authoritative allowlist).
 *
 * @param {unknown} priceId
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {'base' | 'pro' | null}
 */
export function mapStripePriceIdToPlanId(priceId, env = process.env) {
  if (typeof priceId !== 'string' || !priceId.trim()) return null
  const cfg = resolveStripeConfig(env)
  if (!cfg.ok) {
    // Allow mapping when only prices are present (webhook tests inject productMap separately).
    const base = readNonEmpty(env, STRIPE_PRICE_BASE_ENV)
    const pro = readNonEmpty(env, STRIPE_PRICE_PRO_ENV)
    if (base && priceId.trim() === base) return 'base'
    if (pro && priceId.trim() === pro) return 'pro'
    return null
  }
  const id = priceId.trim()
  if (id === cfg.priceBaseMonthly) return 'base'
  if (id === cfg.priceProMonthly) return 'pro'
  return null
}

/**
 * Build productMap for applyBillingEvent from env Price IDs.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export function buildStripeProductPlanMap(env = process.env) {
  const base = readNonEmpty(env, STRIPE_PRICE_BASE_ENV)
  const pro = readNonEmpty(env, STRIPE_PRICE_PRO_ENV)
  /** @type {Record<string, string>} */
  const stripe = {}
  if (base) stripe[base] = 'base'
  if (pro) stripe[pro] = 'pro'
  return Object.freeze({
    stripe: Object.freeze(stripe),
    google_play: Object.freeze({}),
    app_store: Object.freeze({}),
    manual: Object.freeze({}),
  })
}

/**
 * Safe app origin for Checkout/Portal return URLs.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string | null | undefined} [requestOrigin]
 */
export function resolveAppOrigin(env = process.env, requestOrigin = null) {
  const configured =
    (typeof env.STRIPE_RETURN_URL === 'string' && env.STRIPE_RETURN_URL.trim()) ||
    (typeof env.APP_ORIGIN === 'string' && env.APP_ORIGIN.trim()) ||
    ''
  if (configured) return configured.replace(/\/+$/, '')

  if (typeof requestOrigin === 'string' && requestOrigin.trim()) {
    // Only allow known project hosts (same policy as CORS).
    const origin = requestOrigin.trim().replace(/\/+$/, '')
    if (
      /^https:\/\/mia-app-ai(?:[\w.-]*)?\.vercel\.app$/i.test(origin) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ) {
      return origin
    }
  }

  const vercelUrl = typeof env.VERCEL_URL === 'string' ? env.VERCEL_URL.trim() : ''
  if (vercelUrl) {
    return (vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`).replace(
      /\/+$/,
      '',
    )
  }
  return ''
}
