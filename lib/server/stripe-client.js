/**
 * #388B — Stripe SDK factory (server-only).
 */

import Stripe from 'stripe'
import { resolveStripeConfig } from './stripe-config.js'

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {{ stripeFactory?: typeof Stripe }} [deps]
 * @returns {{ ok: true, stripe: import('stripe').default, config: Exclude<ReturnType<typeof resolveStripeConfig>, { ok: false }> } | { ok: false, code: string }}
 */
export function createStripeClient(env = process.env, deps = {}) {
  const config = resolveStripeConfig(env)
  if (!config.ok) return { ok: false, code: config.code }

  const Factory = deps.stripeFactory ?? Stripe
  // #388B.2 — Intentionally NOT pinning an explicit apiVersion. Webhook event
  // payloads arrive serialized at the account/endpoint API version (currently
  // 2026-07-29.dahlia) while SDK retrievals use the SDK's built-in version;
  // stripe-webhook.js normalization (resolveStripeInvoiceSubscriptionId +
  // resolveSubscriptionPeriod) is shape-robust across both legacy top-level and
  // current nested/item field locations, so no pin is required. Pinning to an
  // older version merely to restore old field paths is explicitly avoided.
  const stripe = new Factory(config.secretKey)

  return { ok: true, stripe, config }
}
