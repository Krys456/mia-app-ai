/**
 * #332B — ShinkAIdo Entitlements Foundation (server-authoritative).
 * #332C — Enforcement helpers + rollout flag (OFF by default).
 *
 * Plans (free|base|pro) are product tiers.
 * Entitlements are capability grants derived from a plan.
 *
 * Business logic must ask canUse(entitlement) — never scatter
 * `if (plan === 'pro')` across routes.
 *
 * Runtime (#332B/#332C, no subscription DB yet):
 *   every verified user resolves to Free.
 * Client-claimed planId / localStorage / headers are ignored.
 *
 * Enforcement rollout (#332C):
 *   ENTITLEMENT_ENFORCEMENT_ENABLED must be explicitly true|1.
 *   Missing / empty / false / 0 / garbage → OFF (compatibility mode).
 *   When OFF, requireEntitlement allows all checks (current product behavior).
 *
 * Shadow mode (#388C):
 *   ENTITLEMENT_SHADOW_ENABLED must be explicitly true|1 (default OFF).
 *   When enforcement OFF + shadow ON: evaluate matrix, emit privacy-safe
 *   shadow allow/deny, STILL ALLOW the request. Shadow never authorizes.
 *   When enforcement ON: enforcement remains authoritative; shadow cannot
 *   weaken a denial.
 *
 * This module does NOT call billing providers, Supabase subscription
 * tables, or LLMs. Resolution is pure and O(1).
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

/**
 * @typedef {{
 *   allowed: true
 *   reason: 'allowed' | 'enforcement_disabled'
 * } | {
 *   allowed: false
 *   reason: 'entitlement_required'
 *   body: {
 *     error: string
 *     code: 'entitlement_required'
 *     entitlement: string
 *     requiredPlan?: PlanId
 *   }
 * }} EntitlementDecision
 */

/** Env key for #332C rollout. Client cannot set this. */
export const ENTITLEMENT_ENFORCEMENT_ENV = 'ENTITLEMENT_ENFORCEMENT_ENABLED'

/** Env key for #388C shadow observation. Client cannot set this. */
export const ENTITLEMENT_SHADOW_ENV = 'ENTITLEMENT_SHADOW_ENABLED'

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
 * Server-side rollout gate. OFF by default.
 * Only explicit `true` or `1` (case-insensitive, trimmed) enables enforcement.
 * Client cannot enable this.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isEntitlementEnforcementEnabled(env = process.env) {
  const raw = env?.[ENTITLEMENT_ENFORCEMENT_ENV]
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1'
}

/**
 * #388C shadow observation gate. OFF by default.
 * Only explicit `true` or `1` enables shadow evaluation/logging.
 * Client cannot enable this. Shadow never denies requests.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isEntitlementShadowEnabled(env = process.env) {
  const raw = env?.[ENTITLEMENT_SHADOW_ENV]
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1'
}

/**
 * True when verified plan lookup is required (enforcement and/or shadow).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function needsVerifiedPlanLookup(env = process.env) {
  return isEntitlementEnforcementEnabled(env) || isEntitlementShadowEnabled(env)
}

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
 * Unknown / invalid plan fails closed to an empty deny-all set (not Free).
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
 * #332B/#332D runtime plan id.
 *
 * - Ignores claimedPlanId (client never authoritative).
 * - Honors verifiedPlanId ONLY when supplied by trusted server lookup
 *   (resolveVerifiedPlanForUser) — never from request body/headers.
 *
 * @param {{
 *   verifiedPlanId?: unknown
 *   subscriptionStatus?: unknown
 *   claimedPlanId?: unknown
 * }} [input]
 * @returns {PlanId}
 */
export function resolveRuntimePlanId(input = {}) {
  // Client claims are ignored.
  void input.claimedPlanId
  void input.subscriptionStatus

  const verified = normalizePlanId(input.verifiedPlanId)
  if (verified) return verified
  return 'free'
}

/**
 * Resolve entitlements for a runtime user identity (sync).
 * Without verifiedPlanId this remains Free (no DB). Prefer
 * loadUserEntitlementsAsync when enforcement is ON.
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
 * Central #332C enforcement decision (pure). Does not send HTTP.
 *
 * @param {{
 *   entitlements: EntitlementSet
 *   entitlement: unknown
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} opts
 * @returns {EntitlementDecision}
 */
export function requireEntitlement(opts) {
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(opts.env ?? process.env)

  if (!enforcementEnabled) {
    return { allowed: true, reason: 'enforcement_disabled' }
  }

  if (canUse(opts.entitlements, opts.entitlement)) {
    return { allowed: true, reason: 'allowed' }
  }

  return {
    allowed: false,
    reason: 'entitlement_required',
    body: buildEntitlementRequiredBody({ entitlement: opts.entitlement }),
  }
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
 * Apply requireEntitlement and send 403 when denied.
 * Returns true if response was sent (denied).
 *
 * Preferred #332C signature:
 *   denyUnlessEntitled(res, req, { entitlements, entitlement, enforcementEnabled?, env? })
 *
 * Legacy #332B signature (hard deny for tests):
 *   denyUnlessEntitled(res, req, entitlements, entitlementKey)
 *
 * @param {import('@vercel/node').VercelResponse} res
 * @param {import('@vercel/node').VercelRequest | undefined} req
 * @param {EntitlementSet | {
 *   entitlements: EntitlementSet
 *   entitlement: unknown
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} optsOrEntitlements
 * @param {unknown} [legacyKey]
 * @returns {boolean}
 */
export function denyUnlessEntitled(res, req, optsOrEntitlements, legacyKey) {
  /** @type {{ entitlements: EntitlementSet, entitlement: unknown, enforcementEnabled?: boolean, env?: NodeJS.ProcessEnv }} */
  let opts
  if (
    optsOrEntitlements &&
    typeof optsOrEntitlements === 'object' &&
    'entitlements' in optsOrEntitlements &&
    'entitlement' in optsOrEntitlements
  ) {
    opts = optsOrEntitlements
  } else {
    opts = {
      entitlements: /** @type {EntitlementSet} */ (optsOrEntitlements),
      entitlement: legacyKey,
      // Legacy callers expect hard deny when entitlement missing.
      enforcementEnabled: true,
    }
  }

  const decision = requireEntitlement(opts)
  if (decision.allowed) return false
  sendJson(res, 403, decision.body, req)
  return true
}
