/**
 * #388G — Shared chat/selection model resolution + advancedModel entitlement.
 *
 * Model choice is server/env authoritative. Request-body model is never trusted.
 * When enforcement is OFF, shadow observes but does not downgrade (preserve behavior).
 * When enforcement is ON, unauthorized advanced models fall back to STANDARD_CHAT_MODEL.
 */

import { isGpt56FamilyModel } from './core-responses-params.js'
import {
  canUse,
  isEntitlementEnforcementEnabled,
  isEntitlementShadowEnabled,
} from './entitlements.js'
import { maybeLogEntitlementShadow } from './entitlement-gates.js'

/** Safe default / Free+Base fallback when advanced model is not entitled. */
export const STANDARD_CHAT_MODEL = 'gpt-4o'

/**
 * Normalize OPENAI_MODEL typo gpt-40 → gpt-4o.
 * @param {unknown} raw
 */
export function normalizeConfiguredChatModel(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\bgpt-40\b/gi, 'gpt-4o')
}

/**
 * Resolve configured model from env (no entitlement).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function resolveConfiguredChatModel(env = process.env) {
  const normalized = normalizeConfiguredChatModel(env?.OPENAI_MODEL)
  return normalized || STANDARD_CHAT_MODEL
}

/**
 * Server-side advanced model classification (explicit family allowlist).
 * @param {unknown} model
 */
export function isAdvancedChatModel(model) {
  const id = String(model || '')
    .trim()
    .toLowerCase()
  if (!id) return false
  // gpt-5.6 family is the current advanced / premium Responses path.
  if (isGpt56FamilyModel(id)) return true
  return false
}

/**
 * Authoritative model for a request: entitlement-aware.
 *
 * @param {{
 *   entitlements: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId | string
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   requestId?: string | null
 *   route?: string | null
 *   resolution?: string | null
 *   claimedModel?: unknown
 * }} opts
 * @returns {{
 *   model: string
 *   configuredModel: string
 *   isAdvanced: boolean
 *   usedFallback: boolean
 *   advancedAllowed: boolean
 * }}
 */
export function resolveEntitledChatModel(opts) {
  const env = opts.env ?? process.env
  const configuredModel = resolveConfiguredChatModel(env)
  const isAdvanced = isAdvancedChatModel(configuredModel)
  const enforcementEnabled =
    typeof opts.enforcementEnabled === 'boolean'
      ? opts.enforcementEnabled
      : isEntitlementEnforcementEnabled(env)
  const shadowEnabled =
    typeof opts.shadowEnabled === 'boolean'
      ? opts.shadowEnabled
      : isEntitlementShadowEnabled(env)

  // Client-supplied model must never affect resolution.
  void opts.claimedModel

  if (!isAdvanced) {
    return {
      model: configuredModel,
      configuredModel,
      isAdvanced: false,
      usedFallback: false,
      advancedAllowed: false,
    }
  }

  const advancedAllowed = canUse(opts.entitlements, 'advancedModel')

  maybeLogEntitlementShadow({
    shadowEnabled,
    env,
    feature: 'advancedModel',
    entitlements: opts.entitlements,
    planId: opts.planId,
    resolution: opts.resolution,
    requestId: opts.requestId,
    route: opts.route || null,
    decisionStage: 'required',
  })

  if (!enforcementEnabled) {
    // Shadow observes; do not silently downgrade while enforcement is OFF.
    return {
      model: configuredModel,
      configuredModel,
      isAdvanced: true,
      usedFallback: false,
      advancedAllowed,
    }
  }

  if (advancedAllowed) {
    return {
      model: configuredModel,
      configuredModel,
      isAdvanced: true,
      usedFallback: false,
      advancedAllowed: true,
    }
  }

  return {
    model: STANDARD_CHAT_MODEL,
    configuredModel,
    isAdvanced: true,
    usedFallback: true,
    advancedAllowed: false,
  }
}
