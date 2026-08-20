/**
 * #332C — Pure entitlement gate helpers for expensive capability boundaries.
 *
 * Keeps `/api/chat` Core text Free while optionally omitting or denying
 * premium tools/capabilities when ENTITLEMENT_ENFORCEMENT_ENABLED is ON.
 */

import {
  canUse,
  isEntitlementEnforcementEnabled,
  requireEntitlement,
  resolveEntitlementsForUser,
} from './entitlements.js'

/**
 * Resolve entitlements for a verified userId.
 * Tests may inject resolveEntitlementsForUser / entitlements via deps.
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
