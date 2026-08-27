/**
 * #388B — Stripe subscription status → ShinkAIdo subscription status.
 *
 * Entitlement enforcement remains OFF; mapping is for mirror correctness.
 */

/** @typedef {import('./subscriptions.js').SubscriptionStatus} SubscriptionStatus */

/**
 * Map Stripe subscription.status → ShinkAIdo status enum.
 *
 * Entitlement behavior (when enforcement later ON), via evaluateSubscriptionAccess:
 * - active / trialing → paid
 * - past_due / grace → paid until deadline
 * - canceled → paid until current_period_end
 * - expired / revoked → free immediately
 *
 * @param {unknown} stripeStatus
 * @returns {SubscriptionStatus | null}
 */
export function mapStripeSubscriptionStatus(stripeStatus) {
  if (typeof stripeStatus !== 'string') return null
  switch (stripeStatus.trim().toLowerCase()) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
      return 'past_due'
    case 'unpaid':
      // Treat unpaid as past_due so existing grace/paid-until policy applies
      // until Stripe cancels; do not invent a new DB enum.
      return 'past_due'
    case 'canceled':
      return 'canceled'
    case 'incomplete':
      // Incomplete checkout — not entitled; store as expired (no access).
      return 'expired'
    case 'incomplete_expired':
      return 'expired'
    case 'paused':
      // Paused → no access until resumed (map to expired for mirror).
      return 'expired'
    default:
      return null
  }
}

/**
 * Human/docs table for tests and operators.
 */
export const STRIPE_STATUS_MAPPING_TABLE = Object.freeze([
  { stripe: 'trialing', shinkaido: 'active_entitlement_via', status: 'trialing' },
  { stripe: 'active', shinkaido: 'paid', status: 'active' },
  { stripe: 'past_due', shinkaido: 'paid_until_deadline', status: 'past_due' },
  { stripe: 'unpaid', shinkaido: 'paid_until_deadline', status: 'past_due' },
  { stripe: 'canceled', shinkaido: 'paid_until_period_end', status: 'canceled' },
  { stripe: 'incomplete', shinkaido: 'free', status: 'expired' },
  { stripe: 'incomplete_expired', shinkaido: 'free', status: 'expired' },
  { stripe: 'paused', shinkaido: 'free', status: 'expired' },
])
