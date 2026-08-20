/**
 * #332C — Pure entitlement gate helpers for expensive capability boundaries.
 * #332D — Async load uses verified subscription lookup only when enforcement ON.
 *
 * Keeps `/api/chat` Core text Free while optionally omitting or denying
 * premium tools/capabilities when ENTITLEMENT_ENFORCEMENT_ENABLED is ON.
 */

import {
  canUse,
  isEntitlementEnforcementEnabled,
  requireEntitlement,
  resolveEntitlements,
  resolveEntitlementsForUser,
  resolveRuntimePlanId,
} from './entitlements.js'

// subscription-lookup is dynamically imported only when enforcement is ON
// so Preview (enforcement OFF) paid-route bundles do not pull Supabase.

/**
 * Sync resolve (no DB). Used when enforcement OFF or entitlements injected.
 *
 * @param {string} userId
 * @param {{
 *   resolveEntitlementsForUser?: typeof resolveEntitlementsForUser
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 * }} [deps]
 */
export function loadUserEntitlements(userId, deps = {}) {
  if (deps.entitlements) {
    return {
      planId: deps.planId || 'free',
      entitlements: deps.entitlements,
    }
  }
  const resolve = deps.resolveEntitlementsForUser ?? resolveEntitlementsForUser
  return resolve(userId)
}

/**
 * Request-local entitlement load.
 * - Enforcement OFF → sync Free (no subscription DB query).
 * - Enforcement ON → one verified plan lookup; reuse entitlements for all gates.
 * - Lookup error while enforcement ON → lookupError (caller should 503 paid gates).
 *
 * @param {string} userId
 * @param {{
 *   env?: NodeJS.ProcessEnv
 *   enforcementEnabled?: boolean
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 *   resolveVerifiedPlanForUser?: (userId: string) => Promise<{
 *     planId: import('./entitlements.js').PlanId
 *     reason?: string
 *     lookupError?: boolean
 *   }>
 * }} [deps]
 */
export async function loadUserEntitlementsAsync(userId, deps = {}) {
  if (deps.entitlements) {
    return {
      planId: deps.planId || 'free',
      entitlements: deps.entitlements,
      lookupError: false,
      reason: 'injected',
    }
  }

  const enforcementEnabled =
    typeof deps.enforcementEnabled === 'boolean'
      ? deps.enforcementEnabled
      : isEntitlementEnforcementEnabled(deps.env ?? process.env)

  if (!enforcementEnabled) {
    const sync = loadUserEntitlements(userId)
    return { ...sync, lookupError: false, reason: 'enforcement_disabled' }
  }

  const resolve =
    deps.resolveVerifiedPlanForUser ??
    (await import('./subscription-lookup.js')).resolveVerifiedPlanForUser
  const verified = await resolve(userId)
  if (verified.lookupError) {
    return {
      planId: 'free',
      entitlements: resolveEntitlements('free'),
      lookupError: true,
      reason: 'lookup_error',
    }
  }

  const planId = resolveRuntimePlanId({ verifiedPlanId: verified.planId })
  return {
    planId,
    entitlements: resolveEntitlements(planId),
    lookupError: false,
    reason: verified.reason,
  }
}

/**
 * Hard-deny decision for a dedicated expensive route (files/tts/selection search).
 *
 * @param {{
 *   userId: string
 *   entitlement: import('./entitlements.js').EntitlementKey | string
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   resolveEntitlementsForUser?: typeof resolveEntitlementsForUser
 * }} opts
 */
export function decideRouteEntitlement(opts) {
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(opts.env ?? process.env)

  const { entitlements } = loadUserEntitlements(opts.userId, {
    entitlements: opts.entitlements,
    resolveEntitlementsForUser: opts.resolveEntitlementsForUser,
  })

  return requireEntitlement({
    entitlements,
    entitlement: opts.entitlement,
    enforcementEnabled,
    env: opts.env,
  })
}

/**
 * Async route entitlement decision (uses verified lookup when enforcement ON).
 *
 * @param {{
 *   userId: string
 *   entitlement: import('./entitlements.js').EntitlementKey | string
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   resolveVerifiedPlanForUser?: (userId: string) => Promise<{
 *     planId: import('./entitlements.js').PlanId
 *     reason?: string
 *     lookupError?: boolean
 *   }>
 * }} opts
 */
export async function decideRouteEntitlementAsync(opts) {
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(opts.env ?? process.env)

  const loaded = await loadUserEntitlementsAsync(opts.userId, {
    entitlements: opts.entitlements,
    enforcementEnabled,
    env: opts.env,
    resolveVerifiedPlanForUser: opts.resolveVerifiedPlanForUser,
  })

  if (loaded.lookupError && enforcementEnabled) {
    return {
      allowed: false,
      reason: /** @type {const} */ ('lookup_unavailable'),
      body: {
        error: 'Subscription service temporarily unavailable. Retry shortly.',
        code: 'subscription_lookup_unavailable',
      },
    }
  }

  return requireEntitlement({
    entitlements: loaded.entitlements,
    entitlement: opts.entitlement,
    enforcementEnabled,
    env: opts.env,
  })
}

/**
 * Vision hard gate: only when the turn includes an image attachment.
 * Text-only Core chat is never denied here.
 *
 * @param {{
 *   hasImage: boolean
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} opts
 */
export function decideVisionEntitlement(opts) {
  if (!opts.hasImage) {
    return /** @type {const} */ ({ allowed: true, reason: 'allowed' })
  }
  return requireEntitlement({
    entitlements: opts.entitlements,
    entitlement: 'vision',
    enforcementEnabled: opts.enforcementEnabled,
    env: opts.env,
  })
}

/**
 * Documents hard gate for chat turns that attach or reuse a file.
 *
 * @param {{
 *   hasDocument: boolean
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} opts
 * @returns {import('./entitlements.js').EntitlementDecision | { allowed: true, reason: 'allowed' }}
 */
export function decideDocumentsEntitlement(opts) {
  if (!opts.hasDocument) {
    return /** @type {const} */ ({ allowed: true, reason: 'allowed' })
  }
  return requireEntitlement({
    entitlements: opts.entitlements,
    entitlement: 'documents',
    enforcementEnabled: opts.enforcementEnabled,
    env: opts.env,
  })
}

/**
 * Web search policy for Core chat hosted tools.
 *
 * - Explicit require / forceWebSearch without entitlement → hard deny
 * - Optional model-led tool without entitlement → soft omit (chat continues)
 * - Enforcement OFF → unchanged tools
 *
 * @param {{
 *   intent: 'require' | 'forbid' | 'optional' | string
 *   forceWebSearch?: boolean
 *   webTools: unknown[]
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} opts
 * @returns {{
 *   mode: 'allow' | 'omit' | 'deny'
 *   webTools: unknown[]
 *   decision?: import('./entitlements.js').EntitlementDecision
 * }}
 */
export function decideWebSearchTools(opts) {
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(opts.env ?? process.env)

  const force = opts.forceWebSearch === true
  const explicitRequire = opts.intent === 'require' || force

  if (!enforcementEnabled) {
    return { mode: 'allow', webTools: opts.webTools }
  }

  if (canUse(opts.entitlements, 'webSearch')) {
    return { mode: 'allow', webTools: opts.webTools }
  }

  if (explicitRequire) {
    const decision = requireEntitlement({
      entitlements: opts.entitlements,
      entitlement: 'webSearch',
      enforcementEnabled: true,
    })
    return { mode: 'deny', webTools: [], decision }
  }

  // Optional hosted tool — omit so Free Core chat is not Base-only.
  return { mode: 'omit', webTools: [] }
}

/**
 * Image generation tool policy (soft omit when unentitled).
 *
 * @param {{
 *   imageTools: unknown[]
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} opts
 */
export function decideImageGenerationTools(opts) {
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(opts.env ?? process.env)

  if (!enforcementEnabled || canUse(opts.entitlements, 'imageGeneration')) {
    return { mode: /** @type {const} */ ('allow'), imageTools: opts.imageTools }
  }
  return { mode: /** @type {const} */ ('omit'), imageTools: [] }
}

/**
 * Client-claimed plan fields must never affect server entitlement resolution.
 * Pure security helper for tests / documentation.
 *
 * @param {Record<string, unknown> | null | undefined} body
 * @param {Record<string, unknown> | null | undefined} headers
 * @param {Record<string, unknown> | null | undefined} query
 */
export function extractClientPlanClaims(body, headers, query) {
  return {
    bodyPlanId: body?.planId ?? body?.currentPlanId ?? null,
    headerPlan: headers?.['x-plan'] ?? headers?.['X-Plan'] ?? null,
    queryPlan: query?.plan ?? null,
  }
}
