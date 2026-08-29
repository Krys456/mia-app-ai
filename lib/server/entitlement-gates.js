/**
 * #332C — Pure entitlement gate helpers for expensive capability boundaries.
 * #332D — Async load uses verified subscription lookup when enforcement ON.
 * #388C — Shadow mode: lookup + privacy-safe wouldAllow/wouldDeny logs when
 *          ENTITLEMENT_SHADOW_ENABLED is ON; requests still allowed while
 *          enforcement remains OFF. Shadow never authorizes.
 *
 * Keeps `/api/chat` Core text Free while optionally omitting or denying
 * premium tools/capabilities when ENTITLEMENT_ENFORCEMENT_ENABLED is ON.
 */

import {
  canUse,
  isEntitlementEnforcementEnabled,
  isEntitlementShadowEnabled,
  requireEntitlement,
  resolveEntitlements,
  resolveEntitlementsForUser,
  resolveRuntimePlanId,
} from './entitlements.js'
import { logEntitlementShadow } from './entitlement-shadow.js'
import { shortRequestRef } from './request-id.js'

// subscription-lookup is dynamically imported only when enforcement/shadow
// needs a verified plan so Preview (both OFF) paid-route bundles stay light.

/**
 * Sync resolve (no DB). Used when enforcement+shadow OFF or entitlements injected.
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
 * - Enforcement OFF + Shadow OFF → sync Free (no subscription DB query).
 * - Enforcement ON and/or Shadow ON → verified plan lookup.
 * - Lookup error while enforcement ON → lookupError (caller should 503 paid gates).
 * - Lookup error while enforcement OFF (shadow only) → Free + lookupError; still allow.
 *
 * @param {string} userId
 * @param {{
 *   env?: NodeJS.ProcessEnv
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
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

  const env = deps.env ?? process.env
  const enforcementEnabled =
    typeof deps.enforcementEnabled === 'boolean'
      ? deps.enforcementEnabled
      : isEntitlementEnforcementEnabled(env)
  const shadowEnabled =
    typeof deps.shadowEnabled === 'boolean'
      ? deps.shadowEnabled
      : isEntitlementShadowEnabled(env)

  if (!enforcementEnabled && !shadowEnabled) {
    const sync = loadUserEntitlements(userId)
    return { ...sync, lookupError: false, reason: 'enforcement_disabled' }
  }

  // enforcement OR shadow → verified plan lookup (needsVerifiedPlanLookup).
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
    reason: verified.reason || 'verified',
  }
}

/**
 * Emit shadow observation when shadow is ON and the feature was actually requested.
 * Never throws; never changes authorization.
 *
 * @param {{
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   feature: unknown
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId | string
 *   resolution?: string | null
 *   requestId?: string | null
 *   route?: string | null
 *   skip?: boolean
 * }} opts
 */
export function maybeLogEntitlementShadow(opts) {
  if (opts.skip) return null
  const env = opts.env ?? process.env
  const shadowEnabled =
    typeof opts.shadowEnabled === 'boolean'
      ? opts.shadowEnabled
      : isEntitlementShadowEnabled(env)
  if (!shadowEnabled) return null

  const wouldAllow = canUse(opts.entitlements, opts.feature)
  const requestId = typeof opts.requestId === 'string' ? opts.requestId : null
  return logEntitlementShadow({
    feature: opts.feature,
    effectivePlan: opts.planId || 'free',
    wouldAllow,
    resolution: opts.resolution || null,
    requestId,
    ref: requestId ? shortRequestRef(requestId) : null,
    route: opts.route || null,
    env,
  })
}

/**
 * Hard-deny decision for a dedicated expensive route (files/tts/selection search).
 *
 * @param {{
 *   userId: string
 *   entitlement: import('./entitlements.js').EntitlementKey | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 *   requestId?: string | null
 *   route?: string | null
 *   resolveEntitlementsForUser?: typeof resolveEntitlementsForUser
 * }} opts
 */
export function decideRouteEntitlement(opts) {
  const env = opts.env ?? process.env
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(env)
  const shadowEnabled =
    typeof opts.shadowEnabled === 'boolean'
      ? opts.shadowEnabled
      : isEntitlementShadowEnabled(env)

  const loaded = loadUserEntitlements(opts.userId, {
    entitlements: opts.entitlements,
    planId: opts.planId,
    resolveEntitlementsForUser: opts.resolveEntitlementsForUser,
  })

  maybeLogEntitlementShadow({
    shadowEnabled,
    env,
    feature: opts.entitlement,
    entitlements: loaded.entitlements,
    planId: loaded.planId,
    resolution: 'sync',
    requestId: opts.requestId,
    route: opts.route,
  })

  return requireEntitlement({
    entitlements: loaded.entitlements,
    entitlement: opts.entitlement,
    enforcementEnabled,
    env,
  })
}

/**
 * Async route entitlement decision (verified lookup when enforcement or shadow ON).
 *
 * @param {{
 *   userId: string
 *   entitlement: import('./entitlements.js').EntitlementKey | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 *   requestId?: string | null
 *   route?: string | null
 *   resolveVerifiedPlanForUser?: (userId: string) => Promise<{
 *     planId: import('./entitlements.js').PlanId
 *     reason?: string
 *     lookupError?: boolean
 *   }>
 * }} opts
 */
export async function decideRouteEntitlementAsync(opts) {
  const env = opts.env ?? process.env
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(env)
  const shadowEnabled =
    typeof opts.shadowEnabled === 'boolean'
      ? opts.shadowEnabled
      : isEntitlementShadowEnabled(env)

  const loaded = await loadUserEntitlementsAsync(opts.userId, {
    entitlements: opts.entitlements,
    planId: opts.planId,
    enforcementEnabled,
    shadowEnabled,
    env,
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

  if (!loaded.lookupError) {
    maybeLogEntitlementShadow({
      shadowEnabled,
      env,
      feature: opts.entitlement,
      entitlements: loaded.entitlements,
      planId: loaded.planId,
      resolution: loaded.reason,
      requestId: opts.requestId,
      route: opts.route,
    })
  }

  return requireEntitlement({
    entitlements: loaded.entitlements,
    entitlement: opts.entitlement,
    enforcementEnabled,
    env,
  })
}

/**
 * Vision hard gate: only when the turn includes an image attachment.
 * Text-only Core chat is never denied here.
 *
 * @param {{
 *   hasImage: boolean
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   requestId?: string | null
 *   resolution?: string | null
 * }} opts
 */
export function decideVisionEntitlement(opts) {
  if (!opts.hasImage) {
    return /** @type {const} */ ({ allowed: true, reason: 'allowed' })
  }
  maybeLogEntitlementShadow({
    shadowEnabled: opts.shadowEnabled,
    env: opts.env,
    feature: 'vision',
    entitlements: opts.entitlements,
    planId: opts.planId,
    resolution: opts.resolution,
    requestId: opts.requestId,
    route: '/api/chat',
  })
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
 *   planId?: import('./entitlements.js').PlanId | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   requestId?: string | null
 *   resolution?: string | null
 * }} opts
 * @returns {import('./entitlements.js').EntitlementDecision | { allowed: true, reason: 'allowed' }}
 */
export function decideDocumentsEntitlement(opts) {
  if (!opts.hasDocument) {
    return /** @type {const} */ ({ allowed: true, reason: 'allowed' })
  }
  maybeLogEntitlementShadow({
    shadowEnabled: opts.shadowEnabled,
    env: opts.env,
    feature: 'documents',
    entitlements: opts.entitlements,
    planId: opts.planId,
    resolution: opts.resolution,
    requestId: opts.requestId,
    route: '/api/chat',
  })
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
 * - Explicit require / forceWebSearch without entitlement → hard deny (enforcement ON)
 * - Optional model-led tool without entitlement → soft omit (enforcement ON)
 * - Enforcement OFF → unchanged tools (+ shadow log when shadow ON)
 *
 * @param {{
 *   intent: 'require' | 'forbid' | 'optional' | string
 *   forceWebSearch?: boolean
 *   webTools: unknown[]
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   requestId?: string | null
 *   resolution?: string | null
 * }} opts
 * @returns {{
 *   mode: 'allow' | 'omit' | 'deny'
 *   webTools: unknown[]
 *   decision?: import('./entitlements.js').EntitlementDecision
 * }}
 */
export function decideWebSearchTools(opts) {
  const env = opts.env ?? process.env
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(env)

  const force = opts.forceWebSearch === true
  const explicitRequire = opts.intent === 'require' || force
  const entitled = canUse(opts.entitlements, 'webSearch')

  // Shadow only when web search is in play (tools present or explicit require).
  const requesting =
    explicitRequire || (Array.isArray(opts.webTools) && opts.webTools.length > 0)
  if (requesting) {
    maybeLogEntitlementShadow({
      shadowEnabled: opts.shadowEnabled,
      env,
      feature: 'webSearch',
      entitlements: opts.entitlements,
      planId: opts.planId,
      resolution: opts.resolution,
      requestId: opts.requestId,
      route: '/api/chat',
    })
  }

  if (!enforcementEnabled) {
    return { mode: 'allow', webTools: opts.webTools }
  }

  if (entitled) {
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
 * Image generation tool policy (soft omit when unentitled + enforcement ON).
 *
 * @param {{
 *   imageTools: unknown[]
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 *   requestId?: string | null
 *   resolution?: string | null
 * }} opts
 */
export function decideImageGenerationTools(opts) {
  const env = opts.env ?? process.env
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(env)

  if (Array.isArray(opts.imageTools) && opts.imageTools.length > 0) {
    maybeLogEntitlementShadow({
      shadowEnabled: opts.shadowEnabled,
      env,
      feature: 'imageGeneration',
      entitlements: opts.entitlements,
      planId: opts.planId,
      resolution: opts.resolution,
      requestId: opts.requestId,
      route: '/api/chat',
    })
  }

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
