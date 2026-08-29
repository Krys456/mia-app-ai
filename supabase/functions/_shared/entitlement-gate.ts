/**
 * #388D — Deno entitlement gate for Calendar / Gmail Edge Functions.
 *
 * Mirrors Node #388C precedence without importing Node modules:
 * - Product flag checked by caller first (CALENDAR_ENABLED / EMAIL_ENABLED)
 * - ENTITLEMENT_ENFORCEMENT_ENABLED / ENTITLEMENT_SHADOW_ENABLED from Deno.env
 * - Verified plan from subscriptions table (service role)
 * - Shadow logs privacy-safe fields only; never blocks when enforcement OFF
 *
 * OAuth callbacks must NOT call this gate (no JWT mid-redirect).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type EntitlementFeature = 'calendar' | 'gmail'
export type PlanId = 'free' | 'base' | 'pro'

const MATRIX: Record<PlanId, Record<EntitlementFeature, boolean>> = {
  free: { calendar: false, gmail: false },
  base: { calendar: true, gmail: true },
  pro: { calendar: true, gmail: true },
}

function env(name: string): string {
  return (Deno.env.get(name) || '').trim()
}

function isTruthyFlag(raw: string): boolean {
  const v = raw.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function isEntitlementEnforcementEnabled(): boolean {
  return isTruthyFlag(env('ENTITLEMENT_ENFORCEMENT_ENABLED'))
}

export function isEntitlementShadowEnabled(): boolean {
  return isTruthyFlag(env('ENTITLEMENT_SHADOW_ENABLED'))
}

function normalizePlanId(raw: unknown): PlanId {
  if (typeof raw !== 'string') return 'free'
  const v = raw.trim().toLowerCase()
  if (v === 'base' || v === 'pro' || v === 'free') return v
  return 'free'
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Compact mirror of evaluateSubscriptionAccess (Node subscriptions.js).
 */
function evaluateRow(
  row: {
    plan_id?: string | null
    status?: string | null
    current_period_end?: string | null
    grace_until?: string | null
  },
  now: Date,
): { grants: boolean; planId: PlanId; reason: string } {
  const planId = normalizePlanId(row.plan_id)
  if (planId === 'free') {
    return { grants: false, planId: 'free', reason: 'free_no_subscription' }
  }
  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : ''
  const periodEnd = parseInstant(row.current_period_end)
  const graceUntil = parseInstant(row.grace_until)
  const nowMs = now.getTime()

  if (status === 'revoked') return { grants: false, planId: 'free', reason: 'revoked' }
  if (status === 'expired') return { grants: false, planId: 'free', reason: 'expired' }
  if (status === 'active') return { grants: true, planId, reason: 'paid_active' }
  if (status === 'trialing') return { grants: true, planId, reason: 'paid_trialing' }
  if (status === 'grace') {
    const until = graceUntil || periodEnd
    if (until && until.getTime() > nowMs) return { grants: true, planId, reason: 'paid_grace' }
    return { grants: false, planId: 'free', reason: 'expired' }
  }
  if (status === 'past_due') {
    const until = periodEnd || graceUntil
    if (until && until.getTime() > nowMs) return { grants: true, planId, reason: 'paid_grace' }
    return { grants: false, planId: 'free', reason: 'expired' }
  }
  if (status === 'canceled') {
    if (periodEnd && periodEnd.getTime() > nowMs) {
      return { grants: true, planId, reason: 'paid_canceled_until_period_end' }
    }
    return { grants: false, planId: 'free', reason: 'expired' }
  }
  return { grants: false, planId: 'free', reason: 'fallback_unknown' }
}

const PLAN_RANK: Record<PlanId, number> = { free: 0, base: 1, pro: 2 }

async function resolveVerifiedPlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ planId: PlanId; reason: string; lookupError: boolean }> {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('plan_id, status, current_period_end, grace_until')
      .eq('user_id', userId)
    if (error) {
      return { planId: 'free', reason: 'lookup_error', lookupError: true }
    }
    const rows = Array.isArray(data) ? data : []
    const now = new Date()
    let best: { planId: PlanId; reason: string } = {
      planId: 'free',
      reason: 'free_no_subscription',
    }
    for (const row of rows) {
      const evaled = evaluateRow(row, now)
      if (!evaled.grants) continue
      if (PLAN_RANK[evaled.planId] > PLAN_RANK[best.planId]) {
        best = { planId: evaled.planId, reason: evaled.reason }
      }
    }
    return { ...best, lookupError: false }
  } catch {
    return { planId: 'free', reason: 'lookup_error', lookupError: true }
  }
}

function canUse(planId: PlanId, feature: EntitlementFeature): boolean {
  return MATRIX[planId]?.[feature] === true
}

/**
 * Privacy-safe shadow log (allowlisted fields only).
 */
export function logEntitlementShadowEdge(fields: {
  feature: EntitlementFeature
  effectivePlan: PlanId
  wouldAllow: boolean
  resolution?: string
  requestId?: string
  route?: string
  environment?: string
}) {
  const wouldAllow = fields.wouldAllow === true
  const payload: Record<string, unknown> = {
    code: wouldAllow ? 'entitlement_shadow_allow' : 'entitlement_shadow_deny',
    feature: fields.feature,
    effectivePlan: fields.effectivePlan,
    wouldAllow,
    wouldDeny: !wouldAllow,
    environment: fields.environment || env('VERCEL_ENV') || env('ENVIRONMENT') || 'unknown',
  }
  if (fields.resolution) payload.resolution = String(fields.resolution).slice(0, 64)
  if (fields.requestId) {
    payload.requestId = String(fields.requestId).slice(0, 80)
    payload.ref = String(fields.requestId).slice(0, 8)
  }
  if (fields.route) payload.route = String(fields.route).slice(0, 80)
  console.log(JSON.stringify(payload))
}

export type EdgeEntitlementDecision =
  | { allowed: true; reason: string; planId: PlanId }
  | {
      allowed: false
      reason: 'entitlement_required' | 'lookup_unavailable'
      planId: PlanId
      body: { error: string; code: string; entitlement: string; requiredPlan?: PlanId }
    }

/**
 * Authoritative Edge entitlement decision for calendar|gmail.
 * Caller must already enforce product flag + JWT auth.
 */
export async function decideEdgeEntitlement(opts: {
  supabase: SupabaseClient
  userId: string
  feature: EntitlementFeature
  requestId?: string
  route?: string
}): Promise<EdgeEntitlementDecision> {
  const enforcement = isEntitlementEnforcementEnabled()
  const shadow = isEntitlementShadowEnabled()

  if (!enforcement && !shadow) {
    return { allowed: true, reason: 'enforcement_disabled', planId: 'free' }
  }

  const verified = await resolveVerifiedPlan(opts.supabase, opts.userId)
  if (verified.lookupError && enforcement) {
    return {
      allowed: false,
      reason: 'lookup_unavailable',
      planId: 'free',
      body: {
        error: 'Subscription service temporarily unavailable. Retry shortly.',
        code: 'subscription_lookup_unavailable',
        entitlement: opts.feature,
      },
    }
  }

  const planId = verified.lookupError ? 'free' : verified.planId
  const wouldAllow = canUse(planId, opts.feature)

  if (shadow && !verified.lookupError) {
    logEntitlementShadowEdge({
      feature: opts.feature,
      effectivePlan: planId,
      wouldAllow,
      resolution: verified.reason,
      requestId: opts.requestId,
      route: opts.route,
    })
  }

  if (!enforcement) {
    return { allowed: true, reason: 'enforcement_disabled', planId }
  }

  if (wouldAllow) {
    return { allowed: true, reason: 'allowed', planId }
  }

  return {
    allowed: false,
    reason: 'entitlement_required',
    planId,
    body: {
      error: 'entitlement_required',
      code: 'entitlement_required',
      entitlement: opts.feature,
      requiredPlan: 'base',
    },
  }
}
