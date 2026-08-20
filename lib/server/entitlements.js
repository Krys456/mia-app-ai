/**
 * #332B — ShinkAIdo Entitlements Foundation (server-authoritative).
 *
 * Plans (free|base|pro) are product tiers.
 * Entitlements are capability grants derived from a plan.
 *
 * Business logic must ask canUse(entitlement) — never scatter
 * `if (plan === 'pro')` across routes.
 *
 * Runtime (#332B, no subscription DB yet):
 *   every verified user resolves to Free.
 * Client-claimed planId / localStorage / headers are ignored.
 *
 * This module does NOT call billing providers, Supabase subscription
 * tables, or LLMs. Resolution is pure and O(1).
 *
 * Activation of per-route enforcement is a later phase — helpers here
 * are ready to wire; #332B does not paywall Core chat or change behavior.
 */

import { sendJson } from './http.js'

/** @typedef {'free' | 'base' | 'pro'} PlanId */

/**
 * Stable entitlement keys (authorization). Not UI copy.
 * Local near-zero-cost tools (calculator, unit conversion, energy math,
 * timer, phone handoffs) intentionally have no keys — they stay Free.
 *
 * @typedef {(
 *   | 'coreChat'
 *   | 'basicMemory'
 *   | 'advancedMemory'
 *   | 'webSearch'
 *   | 'documents'
 *   | 'voice'
 *   | 'gmail'
 *   | 'calendar'
 *   | 'vision'
 *   | 'advancedModel'
 *   | 'imageGeneration'
 * )} EntitlementKey
 */

/**
 * Boolean grant today; optional limit/window reserved for future metering
 * without rewriting the shape.
 *
 * @typedef {{
 *   enabled: boolean
 *   limit?: number | null
 *   window?: 'day' | 'month' | null
 * }} EntitlementGrant
 */

/** @typedef {Readonly<Record<EntitlementKey, EntitlementGrant>>} EntitlementSet */

export const PLAN_IDS = Object.freeze(/** @type {const} */ (['free', 'base', 'pro']))

export const ENTITLEMENT_KEYS = Object.freeze(
  /** @type {const} */ ([
    'coreChat',
    'basicMemory',
    'advancedMemory',
    'webSearch',
    'documents',
    'voice',
    'gmail',
    'calendar',
    'vision',
    'advancedModel',
    'imageGeneration',
  ]),
)

/** @type {ReadonlySet<string>} */
const PLAN_ID_SET = new Set(PLAN_IDS)

/** @type {ReadonlySet<string>} */
const ENTITLEMENT_KEY_SET = new Set(ENTITLEMENT_KEYS)

/**
 * @param {unknown} planId
 * @returns {PlanId | null}
 */
export function normalizePlanId(planId) {
  if (typeof planId !== 'string') return null
  const id = planId.trim().toLowerCase()
  return PLAN_ID_SET.has(id) ? /** @type {PlanId} */ (id) : null
}

/**
 * @param {unknown} key
 * @returns {EntitlementKey | null}
 */
export function normalizeEntitlementKey(key) {
  if (typeof key !== 'string') return null
  const k = key.trim()
  return ENTITLEMENT_KEY_SET.has(k) ? /** @type {EntitlementKey} */ (k) : null
}

/**
 * @param {boolean} enabled
 * @param {{ limit?: number | null, window?: 'day' | 'month' | null }} [usage]
 * @returns {EntitlementGrant}
 */
function grant(enabled, usage) {
  if (!enabled) {
    return Object.freeze({ enabled: false, limit: null, window: null })
  }
  return Object.freeze({
    enabled: true,
    limit: usage?.limit ?? null,
    window: usage?.window ?? null,
  })
}

/**
 * Exact Free / Base / Pro entitlement matrix (#332 product direction).
 * Limits are null until a metering phase — shape is future-ready.
 *
 * @type {Readonly<Record<PlanId, EntitlementSet>>}
 */
export const ENTITLEMENT_MATRIX = Object.freeze({
  free: Object.freeze({
    coreChat: grant(true),
    basicMemory: grant(true),
    advancedMemory: grant(false),
    webSearch: grant(false),
    documents: grant(false),
    voice: grant(false),
    gmail: grant(false),
    calendar: grant(false),
    vision: grant(false),
    advancedModel: grant(false),
    imageGeneration: grant(false),
  }),
  base: Object.freeze({
    coreChat: grant(true),
    basicMemory: grant(true),
    advancedMemory: grant(true),
    webSearch: grant(true),
    documents: grant(true),
    voice: grant(true),
    gmail: grant(true),
    calendar: grant(true),
    vision: grant(false),
    advancedModel: grant(false),
    imageGeneration: grant(false),
  }),
  pro: Object.freeze({
    coreChat: grant(true),
    basicMemory: grant(true),
    advancedMemory: grant(true),
    webSearch: grant(true),
    documents: grant(true),
    voice: grant(true),
    gmail: grant(true),
    calendar: grant(true),
    // Usage windows reserved for later fair-use / budgets (null = unlimited for now).
    vision: grant(true, { limit: null, window: 'month' }),
    advancedModel: grant(true),
    imageGeneration: grant(true, { limit: null, window: 'month' }),
  }),
})

/**
 * Minimum plan that grants an entitlement (for entitlement_required responses).
 * @type {Readonly<Record<EntitlementKey, PlanId>>}
 */
export const REQUIRED_PLAN_BY_ENTITLEMENT = Object.freeze({
  coreChat: 'free',
  basicMemory: 'free',
  advancedMemory: 'base',
  webSearch: 'base',
  documents: 'base',
  voice: 'base',
  gmail: 'base',
  calendar: 'base',
  vision: 'pro',
  advancedModel: 'pro',
  imageGeneration: 'pro',
})

/**
 * Pure plan → entitlement set.
 * Unknown / invalid plan fails closed to an empty deny-all set (not Free),
 * so callers must not treat invalid input as Free accidentally when testing
 * explicit plans. Runtime user resolution always uses Free via
 * resolveRuntimePlanId().
 *
 * @param {unknown} planId
 * @returns {EntitlementSet}
 */
export function resolveEntitlements(planId) {
  const normalized = normalizePlanId(planId)
  if (!normalized) {
    return denyAllEntitlements()
  }
  return ENTITLEMENT_MATRIX[normalized]
}

/**
 * @returns {EntitlementSet}
 */
export function denyAllEntitlements() {
  /** @type {Record<string, EntitlementGrant>} */
  const out = {}
  for (const key of ENTITLEMENT_KEYS) {
    out[key] = grant(false)
  }
  return Object.freeze(/** @type {EntitlementSet} */ (out))
}

/**
 * @param {EntitlementSet} entitlements
 * @param {unknown} entitlementKey
 * @returns {boolean}
 */
export function canUse(entitlements, entitlementKey) {
  const key = normalizeEntitlementKey(entitlementKey)
  if (!key) return false
  const value = entitlements[key]
  return Boolean(value && value.enabled === true)
}

/**
 * @param {unknown} entitlementKey
 * @returns {PlanId | null}
 */
export function requiredPlanForEntitlement(entitlementKey) {
  const key = normalizeEntitlementKey(entitlementKey)
  if (!key) return null
  return REQUIRED_PLAN_BY_ENTITLEMENT[key] ?? null
}

/**
 * #332B runtime: no verified subscription → always Free.
 * Ignores claimedPlanId, headers, query, client state.
 *
 * Later phases may accept `{ verifiedPlanId, subscriptionStatus }` from a
 * server-side subscription lookup (never from the client).
 *
 * @param {{
 *   verifiedPlanId?: unknown
 *   subscriptionStatus?: unknown
 *   claimedPlanId?: unknown
 * }} [input]
 * @returns {PlanId}
 */
export function resolveRuntimePlanId(input = {}) {
  // Intentionally ignore claimedPlanId — client is not authoritative.
  void input.claimedPlanId

  // No subscription verification path yet. Do not honor verifiedPlanId until
  // a billing phase supplies a trusted server lookup.
  void input.verifiedPlanId
  void input.subscriptionStatus

  return 'free'
}

/**
 * Resolve entitlements for a runtime user identity.
 * userId is accepted for future subscription lookup; unused in #332B.
 *
 * @param {string | null | undefined} _userId
 * @param {{ claimedPlanId?: unknown, verifiedPlanId?: unknown }} [opts]
 * @returns {{ planId: PlanId, entitlements: EntitlementSet }}
 */
export function resolveEntitlementsForUser(_userId, opts = {}) {
  const planId = resolveRuntimePlanId(opts)
  return {
    planId,
    entitlements: resolveEntitlements(planId),
  }
}

/**
 * Standardized API denial body (no billing-provider details).
 *
 * @param {{ entitlement: unknown, requiredPlan?: unknown }} input
 * @returns {{
 *   error: string
 *   code: 'entitlement_required'
 *   entitlement: string
 *   requiredPlan?: PlanId
 * }}
 */
export function buildEntitlementRequiredBody(input) {
  const entitlement = normalizeEntitlementKey(input.entitlement)
  const requiredFromInput = normalizePlanId(input.requiredPlan)
  const requiredPlan =
    requiredFromInput || (entitlement ? requiredPlanForEntitlement(entitlement) : null)

  /** @type {{ error: string, code: 'entitlement_required', entitlement: string, requiredPlan?: PlanId }} */
  const body = {
    error: 'entitlement_required',
    code: 'entitlement_required',
    entitlement: entitlement || String(input.entitlement || 'unknown'),
  }
  if (requiredPlan) body.requiredPlan = requiredPlan
  return body
}

/**
 * Send 403 entitlement_required. Does not throw.
 *
 * @param {import('@vercel/node').VercelResponse} res
 * @param {import('@vercel/node').VercelRequest | undefined} req
 * @param {{ entitlement: unknown, requiredPlan?: unknown }} input
 */
export function sendEntitlementRequired(res, req, input) {
  sendJson(res, 403, buildEntitlementRequiredBody(input), req)
}

/**
 * Convenience: deny when entitlement is missing. Returns true if denied (response sent).
 * Ready for later route wiring — not activated on Core chat in #332B.
 *
 * @param {import('@vercel/node').VercelResponse} res
 * @param {import('@vercel/node').VercelRequest | undefined} req
 * @param {EntitlementSet} entitlements
 * @param {unknown} entitlementKey
 * @returns {boolean}
 */
export function denyUnlessEntitled(res, req, entitlements, entitlementKey) {
  if (canUse(entitlements, entitlementKey)) return false
  sendEntitlementRequired(res, req, { entitlement: entitlementKey })
  return true
}
