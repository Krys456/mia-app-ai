/**
 * #332D — Server verified plan lookup (service-role Supabase).
 *
 * Used by /api/subscription and (when enforcement ON) entitlement loading.
 * Enforcement OFF ⇒ hot paths must not call this (see loadUserEntitlementsAsync).
 */

import { getServiceSupabase } from './supabase.js'
import { ensureAuthUserRow } from './brain-memory.js'
import {
  resolveEffectivePlanFromSubscriptions,
  toPublicSubscriptionView,
} from './subscriptions.js'
import { normalizePlanId, resolveEntitlements } from './entitlements.js'

/**
 * @typedef {{
 *   planId: import('./entitlements.js').PlanId
 *   reason: import('./subscriptions.js').PlanResolutionReason
 *   status: string
 *   currentPeriodEnd: string | null
 *   cancelAtPeriodEnd: boolean
 *   provider: string | null
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   lookupError?: boolean
 *   publicView: ReturnType<typeof toPublicSubscriptionView>
 * }} VerifiedPlanResult
 */

/**
 * Fetch subscription rows for a user (service role). Does not trust client filters.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{ rows: import('./subscriptions.js').SubscriptionRow[], error: Error | null }>}
 */
export async function fetchSubscriptionsForUser(supabase, userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) {
    return { rows: [], error: new Error('missing_user_id') }
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'id, user_id, provider, provider_customer_id, provider_subscription_id, product_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, grace_until, created_at, updated_at',
    )
    .eq('user_id', id)

  if (error) {
    return { rows: [], error: new Error(error.message || 'subscription_lookup_failed') }
  }

  return { rows: Array.isArray(data) ? data : [], error: null }
}

/**
 * Authoritative verified plan for a user.
 *
 * Failure policy:
 * - no rows → Free
 * - DB error → lookupError=true, planId free (caller decides 503 vs Free for UX)
 *
 * @param {string} userId
 * @param {{
 *   supabase?: import('@supabase/supabase-js').SupabaseClient
 *   now?: Date
 *   ensureUserRow?: boolean
 *   ensureAuthUserRow?: typeof ensureAuthUserRow
 *   fetchSubscriptionsForUser?: typeof fetchSubscriptionsForUser
 *   getServiceSupabase?: typeof getServiceSupabase
 * }} [deps]
 * @returns {Promise<VerifiedPlanResult>}
 */
export async function resolveVerifiedPlanForUser(userId, deps = {}) {
  const now = deps.now instanceof Date ? deps.now : new Date()
  const emptyFree = (reason = /** @type {const} */ ('free_no_subscription')) => {
    const planId = /** @type {const} */ ('free')
    const effective = resolveEffectivePlanFromSubscriptions([], now)
    effective.reason = reason
    return {
      planId,
      reason,
      status: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      provider: null,
      entitlements: resolveEntitlements(planId),
      publicView: toPublicSubscriptionView(effective),
    }
  }

  try {
    const getSb = deps.getServiceSupabase ?? getServiceSupabase
    const supabase = deps.supabase ?? (await getSb())
    if (deps.ensureUserRow !== false) {
      const ensure = deps.ensureAuthUserRow ?? ensureAuthUserRow
      await ensure(supabase, userId)
    }

    const fetch = deps.fetchSubscriptionsForUser ?? fetchSubscriptionsForUser
    const { rows, error } = await fetch(supabase, userId)
    if (error) {
      const result = emptyFree('lookup_error')
      return { ...result, lookupError: true }
    }

    const effective = resolveEffectivePlanFromSubscriptions(rows, now)
    const planId = normalizePlanId(effective.planId) || 'free'
    return {
      planId,
      reason: effective.reason,
      status: effective.status,
      currentPeriodEnd: effective.currentPeriodEnd,
      cancelAtPeriodEnd: effective.cancelAtPeriodEnd,
      provider: effective.provider,
      entitlements: resolveEntitlements(planId),
      publicView: toPublicSubscriptionView(effective),
    }
  } catch (err) {
    void err
    const result = emptyFree('lookup_error')
    return { ...result, lookupError: true }
  }
}
