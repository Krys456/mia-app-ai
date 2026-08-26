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
  // Use SDK default API version (pinned by stripe package major).
  const stripe = new Factory(config.secretKey)

  return { ok: true, stripe, config }
}
