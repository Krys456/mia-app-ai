/**
 * #388B — Stripe Checkout / Customer / Portal / cancel helpers (server-only).
 *
 * Provider adapter boundary: Stripe-specific. Entitlements stay generic.
 */

import { createStripeClient } from './stripe-client.js'
import {
  STRIPE_PLAN_METADATA_KEY,
  STRIPE_USER_METADATA_KEY,
  mapInternalPlanToStripePriceId,
  resolveAppOrigin,
  resolveStripeConfig,
} from './stripe-config.js'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * Find owned Stripe customer id from subscriptions rows (never from client).
 *
 * @param {Array<Record<string, unknown>> | null | undefined} rows
 * @param {'sandbox' | 'live'} environment
 * @returns {string | null}
 */
export function findOwnedStripeCustomerId(rows, environment) {
  if (!Array.isArray(rows)) return null
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (String(row.provider || '').toLowerCase() !== 'stripe') continue
    if (environment && row.environment && row.environment !== environment) continue
    const cid = asNonEmptyString(row.provider_customer_id)
    if (cid) return cid
  }
  return null
}

/**
 * Active-ish Stripe subscription ids for CRITICAL cancel-on-delete.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} rows
 * @param {'sandbox' | 'live'} environment
 * @returns {string[]}
 */
export function findCancelableStripeSubscriptionIds(rows, environment) {
  if (!Array.isArray(rows)) return []
  const ended = new Set(['canceled', 'expired', 'revoked'])
  /** @type {string[]} */
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (String(row.provider || '').toLowerCase() !== 'stripe') continue
    if (environment && row.environment && row.environment !== environment) continue
    const status = String(row.status || '').toLowerCase()
    if (ended.has(status)) continue
    const sid = asNonEmptyString(row.provider_subscription_id)
    if (sid) out.push(sid)
  }
  return out
}

/**
 * Create or reuse Stripe Customer owned by ShinkAIdo uid.
 *
 * @param {{
 *   userId: string
 *   email?: string | null
 *   existingCustomerId?: string | null
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 *   config?: Exclude<ReturnType<typeof resolveStripeConfig>, { ok: false }>
 * }} opts
 */
export async function ensureStripeCustomer(opts) {
  const env = opts.env ?? process.env
  const userId = asNonEmptyString(opts.userId)
  if (!userId) return { ok: false, code: 'user_id_required' }

  let stripe = opts.stripe
  let config = opts.config
  if (!stripe || !config) {
    const client = createStripeClient(env)
    if (!client.ok) return { ok: false, code: client.code }
    stripe = client.stripe
    config = client.config
  }

  const existing = asNonEmptyString(opts.existingCustomerId)
  if (existing) {
    try {
      const customer = await stripe.customers.retrieve(existing)
      if (customer && !('deleted' in customer && customer.deleted)) {
        const metaUid = asNonEmptyString(customer.metadata?.[STRIPE_USER_METADATA_KEY])
        if (metaUid && metaUid !== userId) {
          return { ok: false, code: 'stripe_customer_user_mismatch' }
        }
        return { ok: true, customerId: customer.id, reused: true }
      }
    } catch {
      // Fall through to create a new customer.
    }
  }

  const createParams = {
    metadata: {
      [STRIPE_USER_METADATA_KEY]: userId,
    },
  }
  // Prefer not storing email unless present (durable identity); Stripe may use it for receipts.
  const email = asNonEmptyString(opts.email)
  if (email) createParams.email = email

  const customer = await stripe.customers.create(createParams)
  return { ok: true, customerId: customer.id, reused: false }
}

/**
 * Create Stripe Checkout Session (mode=subscription). Client sends planId only.
 *
 * @param {{
 *   userId: string
 *   durable: boolean
 *   planId: unknown
 *   email?: string | null
 *   existingCustomerId?: string | null
 *   requestOrigin?: string | null
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 * }} opts
 */
export async function createCheckoutSession(opts) {
  const env = opts.env ?? process.env
  if (opts.durable !== true) {
    return { ok: false, code: 'not_durable', status: 403 }
  }

  const planMap = mapInternalPlanToStripePriceId(opts.planId, env)
  if (!planMap.ok) {
    return { ok: false, code: planMap.code, status: 400 }
  }

  const client = opts.stripe
    ? { ok: true, stripe: opts.stripe, config: resolveStripeConfig(env) }
    : createStripeClient(env)
  if (!client.ok || !client.config || !client.config.ok) {
    return {
      ok: false,
      code: !client.ok ? client.code : 'stripe_config_invalid',
      status: 503,
    }
  }

  const origin = resolveAppOrigin(env, opts.requestOrigin)
  if (!origin) {
    return { ok: false, code: 'return_url_unresolved', status: 503 }
  }

  const customerResult = await ensureStripeCustomer({
    userId: opts.userId,
    email: opts.email,
    existingCustomerId: opts.existingCustomerId,
    env,
    stripe: client.stripe,
    config: client.config,
  })
  if (!customerResult.ok) {
    return { ok: false, code: customerResult.code, status: 503 }
  }

  const successUrl = `${origin}/?plans=1&checkout=success&plan=${encodeURIComponent(planMap.planId)}`
  const cancelUrl = `${origin}/?plans=1&checkout=cancel`

  const session = await client.stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerResult.customerId,
    client_reference_id: opts.userId,
    line_items: [{ price: planMap.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      [STRIPE_USER_METADATA_KEY]: opts.userId,
      [STRIPE_PLAN_METADATA_KEY]: planMap.planId,
    },
    subscription_data: {
      metadata: {
        [STRIPE_USER_METADATA_KEY]: opts.userId,
        [STRIPE_PLAN_METADATA_KEY]: planMap.planId,
      },
    },
    allow_promotion_codes: false,
  })

  if (!session.url) {
    return { ok: false, code: 'checkout_url_missing', status: 503 }
  }

  return {
    ok: true,
    url: session.url,
    sessionId: session.id,
    planId: planMap.planId,
    customerId: customerResult.customerId,
  }
}

/**
 * Create Stripe Customer Portal session for owned customer only.
 *
 * @param {{
 *   userId: string
 *   durable: boolean
 *   customerId?: unknown
 *   ownedCustomerId: string | null
 *   requestOrigin?: string | null
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 * }} opts
 */
export async function createPortalSession(opts) {
  const env = opts.env ?? process.env
  if (opts.durable !== true) {
    return { ok: false, code: 'not_durable', status: 403 }
  }

  // Reject any client-supplied customer id (even if it matches).
  if (opts.customerId != null && String(opts.customerId).trim() !== '') {
    return { ok: false, code: 'customer_id_not_accepted', status: 400 }
  }

  const cfg = resolveStripeConfig(env)
  if (!cfg.ok) return { ok: false, code: cfg.code, status: 503 }
  if (!cfg.portalEnabled) return { ok: false, code: 'stripe_portal_disabled', status: 404 }

  const owned = asNonEmptyString(opts.ownedCustomerId)
  if (!owned) {
    return { ok: false, code: 'no_billing_customer', status: 404 }
  }

  const client = opts.stripe
    ? { ok: true, stripe: opts.stripe }
    : createStripeClient(env)
  if (!client.ok) return { ok: false, code: client.code, status: 503 }

  const origin = resolveAppOrigin(env, opts.requestOrigin)
  if (!origin) return { ok: false, code: 'return_url_unresolved', status: 503 }

  const session = await client.stripe.billingPortal.sessions.create({
    customer: owned,
    return_url: `${origin}/?plans=1&portal=return`,
  })

  if (!session.url) {
    return { ok: false, code: 'portal_url_missing', status: 503 }
  }

  return { ok: true, url: session.url, customerId: owned }
}

/**
 * CRITICAL: cancel Stripe subscriptions before local account erase.
 *
 * @param {{
 *   subscriptionIds: string[]
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 * }} opts
 * @returns {Promise<{
 *   ok: boolean
 *   code: string
 *   canceledIds: string[]
 *   failedIds: string[]
 * }>}
 */
export async function cancelStripeSubscriptionsForDeletion(opts) {
  const ids = Array.isArray(opts.subscriptionIds)
    ? [...new Set(opts.subscriptionIds.map(asNonEmptyString).filter(Boolean))]
    : []

  if (ids.length === 0) {
    return { ok: true, code: 'no_stripe_subscriptions', canceledIds: [], failedIds: [] }
  }

  const env = opts.env ?? process.env
  const client = opts.stripe
    ? { ok: true, stripe: opts.stripe }
    : createStripeClient(env)

  // If billing is not configured but rows claim Stripe ids, fail closed —
  // we must not erase while future charges remain possible.
  if (!client.ok) {
    return {
      ok: false,
      code: 'stripe_cancel_config_unavailable',
      canceledIds: [],
      failedIds: ids,
    }
  }

  /** @type {string[]} */
  const canceledIds = []
  /** @type {string[]} */
  const failedIds = []

  for (const subscriptionId of ids) {
    try {
      const sub = await client.stripe.subscriptions.retrieve(subscriptionId)
      if (!sub || sub.status === 'canceled') {
        canceledIds.push(subscriptionId)
        continue
      }
      await client.stripe.subscriptions.cancel(subscriptionId, {
        invoice_now: false,
        prorate: false,
      })
      canceledIds.push(subscriptionId)
    } catch (err) {
      const msg = err && typeof err === 'object' && typeof err.message === 'string' ? err.message : ''
      // Already gone / missing → treat as canceled for deletion progress.
      if (/no such subscription|resource_missing/i.test(msg)) {
        canceledIds.push(subscriptionId)
        continue
      }
      failedIds.push(subscriptionId)
    }
  }

  if (failedIds.length > 0) {
    return {
      ok: false,
      code: 'stripe_cancel_failed',
      canceledIds,
      failedIds,
    }
  }

  return {
    ok: true,
    code: 'stripe_cancel_succeeded',
    canceledIds,
    failedIds: [],
  }
}
