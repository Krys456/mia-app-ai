/**
 * #388C — Privacy-safe entitlement shadow observability.
 *
 * Shadow mode evaluates what enforcement WOULD do, then ALWAYS allows
 * when enforcement is OFF. This module never authorizes or denies.
 *
 * Allowed log fields only — no user content, emails, Stripe IDs, tokens.
 */

import { logApiEvent } from './safe-log.js'
import { resolvePublicEnvironment } from './worker-health.js'
import { normalizeEntitlementKey, normalizePlanId } from './entitlements.js'

export const ENTITLEMENT_SHADOW_ALLOW_CODE = 'entitlement_shadow_allow'
export const ENTITLEMENT_SHADOW_DENY_CODE = 'entitlement_shadow_deny'

/** @type {ReadonlySet<string>} */
const ALLOWED_SHADOW_KEYS = new Set([
  'code',
  'feature',
  'effectivePlan',
  'wouldAllow',
  'wouldDeny',
  'resolution',
  'requestId',
  'ref',
  'buildId',
  'environment',
  'route',
])

/**
 * Build a privacy-safe shadow payload (strict allowlist).
 *
 * @param {{
 *   feature: unknown
 *   effectivePlan?: unknown
 *   wouldAllow: boolean
 *   resolution?: string | null
 *   requestId?: string | null
 *   ref?: string | null
 *   route?: string | null
 *   environment?: string | null
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 * }} input
 */
export function buildEntitlementShadowPayload(input) {
  const feature = normalizeEntitlementKey(input.feature) || 'unknown'
  const plan = normalizePlanId(input.effectivePlan) || 'free'
  const wouldAllow = input.wouldAllow === true
  const code = wouldAllow ? ENTITLEMENT_SHADOW_ALLOW_CODE : ENTITLEMENT_SHADOW_DENY_CODE
  const environment =
    (typeof input.environment === 'string' && input.environment.trim()) ||
    resolvePublicEnvironment(input.env ?? process.env)

  /** @type {Record<string, unknown>} */
  const payload = {
    code,
    feature,
    effectivePlan: plan,
    wouldAllow,
    wouldDeny: !wouldAllow,
    environment,
  }

  if (typeof input.resolution === 'string' && input.resolution.trim()) {
    payload.resolution = input.resolution.trim().slice(0, 64)
  }
  if (typeof input.requestId === 'string' && input.requestId.trim()) {
    payload.requestId = input.requestId.trim().slice(0, 80)
  }
  if (typeof input.ref === 'string' && input.ref.trim()) {
    payload.ref = input.ref.trim().slice(0, 16)
  }
  if (typeof input.route === 'string' && input.route.trim()) {
    payload.route = input.route.trim().slice(0, 80)
  }

  // Strip anything outside the allowlist (defense in depth).
  for (const key of Object.keys(payload)) {
    if (!ALLOWED_SHADOW_KEYS.has(key)) delete payload[key]
  }
  return payload
}

/**
 * Emit a structured shadow observation. Never throws.
 *
 * @param {Parameters<typeof buildEntitlementShadowPayload>[0]} input
 */
export function logEntitlementShadow(input) {
  try {
    const payload = buildEntitlementShadowPayload(input)
    logApiEvent(payload)
    return payload
  } catch {
    return null
  }
}

/**
 * True if a candidate log object contains forbidden sensitive keys/patterns.
 * Used by tests; not a runtime gate.
 *
 * @param {Record<string, unknown>} payload
 */
export function shadowPayloadHasSensitiveKeys(payload) {
  const forbidden = [
    'prompt',
    'content',
    'email',
    'authorization',
    'token',
    'stripe',
    'customer',
    'subscription',
    'userId',
    'user_id',
    'password',
    'secret',
    'document',
    'filename',
    'location',
    'latitude',
    'longitude',
    'reminder',
    'calendar',
    'gmail',
  ]
  const keys = Object.keys(payload || {}).map((k) => k.toLowerCase())
  return keys.some((k) => forbidden.some((f) => k === f || k.includes(f)))
}
