/**
 * #332D / #332E3A — Server verified plan lookup (service-role Supabase).
 *
 * Used by /api/subscription and (when enforcement ON) entitlement loading.
 * Enforcement OFF ⇒ hot paths must not call this (see loadUserEntitlementsAsync).
 *
 * #332E3A: resolution is scoped to BILLING_ENVIRONMENT (sandbox|live).
 * Sandbox rows must never grant live plan state (and vice versa).
 *
 * Intentionally does NOT import brain-memory (keeps paid route bundles small).
 * Authenticated users without a public.users row simply resolve Free (no rows).
 */

import { getServiceSupabase } from './supabase.js'
import {
  filterSubscriptionsByEnvironment,
  requireRuntimeBillingEnvironment,
  resolveRuntimeBillingEnvironment,
} from './billing-environment.js'
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
 *   billingEnvironment?: import('./billing-environment.js').BillingEnvironment
 *   publicView: ReturnType<typeof toPublicSubscriptionView>
 * }} VerifiedPlanResult
 */

/**
 * Fetch subscription rows for a user (service role). Does not trust client filters.
 * When `environment` is provided, filters at query time (and again in memory).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {{ environment?: import('./billing-environment.js').BillingEnvironment | null }} [opts]
 * @returns {Promise<{ rows: import('./subscriptions.js').SubscriptionRow[], error: Error | null }>}
 */
export async function fetchSubscriptionsForUser(supabase, userId, opts = {}) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) {
    return { rows: [], error: new Error('missing_user_id') }
  }

  let query = supabase
    .from('subscriptions')
    .select(
      'id, user_id, provider, environment, provider_customer_id, provider_subscription_id, product_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, grace_until, last_provider_event_at, created_at, updated_at',
    )
    .eq('user_id', id)

  if (opts.environment) {
    query = query.eq('environment', opts.environment)
  }

  const { data, error } = await query

  if (error) {
    return { rows: [], error: new Error(error.message || 'subscription_lookup_failed') }
  }

  const rows = Array.isArray(data) ? data : []
  if (opts.environment) {
    return {
      rows: filterSubscriptionsByEnvironment(rows, opts.environment),
      error: null,
    }
  }
  return { rows, error: null }
}

/**
 * Authoritative verified plan for a user in the runtime billing environment.
 *
 * Failure policy:
 * - invalid/missing BILLING_ENVIRONMENT → lookupError (fail closed)
 * - no rows → Free
 * - DB error → lookupError=true, planId free (caller decides 503 vs Free for UX)
 *
 * @param {string} userId
 * @param {{
 *   supabase?: import('@supabase/supabase-js').SupabaseClient
 *   now?: Date
 *   env?: NodeJS.ProcessEnv
 *   billingEnvironment?: import('./billing-environment.js').BillingEnvironment | null
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
    const environment =
      deps.billingEnvironment !== undefined
        ? deps.billingEnvironment
        : resolveRuntimeBillingEnvironment(deps.env ?? process.env)

    if (!environment) {
      const required = requireRuntimeBillingEnvironment(deps.env ?? process.env)
      void required
      const result = emptyFree('lookup_error')
      return { ...result, lookupError: true }
    }

    const getSb = deps.getServiceSupabase ?? getServiceSupabase
    const supabase = deps.supabase ?? (await getSb())

    const fetch = deps.fetchSubscriptionsForUser ?? fetchSubscriptionsForUser
    const { rows, error } = await fetch(supabase, userId, { environment })
    if (error) {
      const result = emptyFree('lookup_error')
      return { ...result, lookupError: true }
    }

    const scoped = filterSubscriptionsByEnvironment(rows, environment)
    const effective = resolveEffectivePlanFromSubscriptions(scoped, now)
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
      billingEnvironment: environment,
    }
  } catch (err) {
    void err
    const result = emptyFree('lookup_error')
    return { ...result, lookupError: true }
  }
}
