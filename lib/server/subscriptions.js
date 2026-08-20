/**
 * #332D — Provider-agnostic subscription model + effective plan policy (pure).
 *
 * No Stripe/Play/StoreKit SDKs. No Free rows — absence ⇒ free.
 * Server authorization must use resolveEffectivePlanFromSubscriptions /
 * resolveVerifiedPlanForUser — never client planId.
 */

import { normalizePlanId } from './entitlements.js'

/** @typedef {'free' | 'base' | 'pro'} PlanId */
/** @typedef {'stripe' | 'google_play' | 'app_store' | 'manual'} SubscriptionProvider */
/** @typedef {'active' | 'trialing' | 'grace' | 'past_due' | 'canceled' | 'expired' | 'revoked'} SubscriptionStatus */

/**
 * @typedef {{
 *   id?: string
 *   user_id?: string
 *   provider?: string
 *   environment?: string
 *   provider_customer_id?: string | null
 *   provider_subscription_id?: string | null
 *   product_id?: string | null
 *   plan_id?: string
 *   status?: string
 *   current_period_start?: string | Date | null
 *   current_period_end?: string | Date | null
 *   cancel_at_period_end?: boolean
 *   grace_until?: string | Date | null
 *   last_provider_event_at?: string | Date | null
 * }} SubscriptionRow
 */

/**
 * @typedef {(
 *   | 'free_no_subscription'
 *   | 'paid_active'
 *   | 'paid_trialing'
 *   | 'paid_grace'
 *   | 'paid_canceled_until_period_end'
 *   | 'expired'
 *   | 'revoked'
 *   | 'fallback_unknown'
 *   | 'lookup_error'
 * )} PlanResolutionReason
 */

export const SUBSCRIPTION_PROVIDERS = Object.freeze(
  /** @type {const} */ (['stripe', 'google_play', 'app_store', 'manual']),
)

export const SUBSCRIPTION_STATUSES = Object.freeze(
  /** @type {const} */ ([
    'active',
    'trialing',
    'grace',
    'past_due',
    'canceled',
    'expired',
    'revoked',
  ]),
)

/** Paid plans only — Free is not stored. */
export const PAID_PLAN_IDS = Object.freeze(/** @type {const} */ (['base', 'pro']))

const PLAN_RANK = Object.freeze({ free: 0, base: 1, pro: 2 })

/**
 * Future provider product → plan mapping (pure). Empty until billing SKUs exist.
 * Do not scatter SKUs in UI.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, PlanId>>>>}
 */
export const PROVIDER_PRODUCT_PLAN_MAP = Object.freeze({
  stripe: Object.freeze({}),
  google_play: Object.freeze({}),
  app_store: Object.freeze({}),
  manual: Object.freeze({}),
})

/**
 * @param {unknown} provider
 * @param {unknown} productId
 * @returns {PlanId | null}
 */
export function mapProviderProductToPlanId(provider, productId) {
  if (typeof provider !== 'string' || typeof productId !== 'string') return null
  const p = provider.trim().toLowerCase()
  const sku = productId.trim()
  if (!p || !sku) return null
  const table = PROVIDER_PRODUCT_PLAN_MAP[p]
  if (!table) return null
  const plan = table[sku]
  return normalizePlanId(plan)
}

/**
 * @param {unknown} planId
 * @returns {number}
 */
export function planRank(planId) {
  const id = normalizePlanId(planId) || 'free'
  return PLAN_RANK[id] ?? 0
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseSubscriptionInstant(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/**
 * Whether a row currently grants its paid plan access.
 *
 * Policy:
 * - active / trialing → paid
 * - grace → paid while grace_until (else current_period_end) is in the future
 * - past_due → paid while current_period_end (else grace_until) is in the future
 * - canceled → paid until current_period_end (if future); else free
 * - expired / revoked → free immediately
 * - unknown status / invalid plan → not granting
 *
 * @param {SubscriptionRow | null | undefined} row
 * @param {Date} [now]
 * @returns {{ grants: boolean, reason: PlanResolutionReason, planId: PlanId }}
 */
export function evaluateSubscriptionAccess(row, now = new Date()) {
  if (!row || typeof row !== 'object') {
    return { grants: false, reason: 'free_no_subscription', planId: 'free' }
  }

  const planId = normalizePlanId(row.plan_id)
  if (!planId || planId === 'free' || !PAID_PLAN_IDS.includes(/** @type {'base'|'pro'} */ (planId))) {
    return { grants: false, reason: 'fallback_unknown', planId: 'free' }
  }

  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : ''
  const periodEnd = parseSubscriptionInstant(row.current_period_end)
  const graceUntil = parseSubscriptionInstant(row.grace_until)
  const nowMs = now.getTime()

  if (status === 'revoked') {
    return { grants: false, reason: 'revoked', planId: 'free' }
  }
  if (status === 'expired') {
    return { grants: false, reason: 'expired', planId: 'free' }
  }

  if (status === 'active') {
    return { grants: true, reason: 'paid_active', planId }
  }
  if (status === 'trialing') {
    return { grants: true, reason: 'paid_trialing', planId }
  }

  if (status === 'grace') {
    const until = graceUntil || periodEnd
    if (until && until.getTime() > nowMs) {
      return { grants: true, reason: 'paid_grace', planId }
    }
    return { grants: false, reason: 'expired', planId: 'free' }
  }

  if (status === 'past_due') {
    const until = periodEnd || graceUntil
    if (until && until.getTime() > nowMs) {
      return { grants: true, reason: 'paid_grace', planId }
    }
    return { grants: false, reason: 'expired', planId: 'free' }
  }

  if (status === 'canceled') {
    if (periodEnd && periodEnd.getTime() > nowMs) {
      return { grants: true, reason: 'paid_canceled_until_period_end', planId }
    }
    return { grants: false, reason: 'expired', planId: 'free' }
  }

  return { grants: false, reason: 'fallback_unknown', planId: 'free' }
}

/**
 * Deterministic effective plan across multiple provider rows.
 * Highest granting paid tier wins (pro > base). No grant ⇒ free.
 *
 * @param {SubscriptionRow[] | null | undefined} rows
 * @param {Date} [now]
 * @returns {{
 *   planId: PlanId
 *   reason: PlanResolutionReason
 *   status: SubscriptionStatus | 'none'
 *   sourceRow: SubscriptionRow | null
 *   cancelAtPeriodEnd: boolean
 *   currentPeriodEnd: string | null
 *   provider: string | null
 * }}
 */
export function resolveEffectivePlanFromSubscriptions(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) {
    return {
      planId: 'free',
      reason: 'free_no_subscription',
      status: 'none',
      sourceRow: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      provider: null,
    }
  }

  /** @type {{ planId: PlanId, reason: PlanResolutionReason, row: SubscriptionRow } | null} */
  let best = null
  /** @type {PlanResolutionReason} */
  let lastNegative = 'free_no_subscription'

  for (const row of list) {
    const evaluated = evaluateSubscriptionAccess(row, now)
    if (!evaluated.grants) {
      lastNegative = evaluated.reason
      continue
    }
    if (!best || planRank(evaluated.planId) > planRank(best.planId)) {
      best = { planId: evaluated.planId, reason: evaluated.reason, row }
    }
  }

  if (!best) {
    return {
      planId: 'free',
      reason: lastNegative,
      status: 'none',
      sourceRow: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      provider: null,
    }
  }

  const periodEnd = parseSubscriptionInstant(best.row.current_period_end)
  const statusRaw =
    typeof best.row.status === 'string' ? best.row.status.trim().toLowerCase() : ''
  /** @type {SubscriptionStatus | 'none'} */
  const status = SUBSCRIPTION_STATUSES.includes(/** @type {SubscriptionStatus} */ (statusRaw))
    ? /** @type {SubscriptionStatus} */ (statusRaw)
    : 'none'

  return {
    planId: best.planId,
    reason: best.reason,
    status,
    sourceRow: best.row,
    cancelAtPeriodEnd: best.row.cancel_at_period_end === true,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    provider: typeof best.row.provider === 'string' ? best.row.provider : null,
  }
}

/**
 * Safe public DTO for GET /api/subscription (no secrets / tokens).
 *
 * @param {ReturnType<typeof resolveEffectivePlanFromSubscriptions>} effective
 */
export function toPublicSubscriptionView(effective) {
  return {
    planId: effective.planId,
    status: effective.planId === 'free' ? 'none' : effective.status,
    currentPeriodEnd: effective.currentPeriodEnd,
    cancelAtPeriodEnd: effective.cancelAtPeriodEnd,
    provider: effective.provider,
    resolution: effective.reason,
  }
}
