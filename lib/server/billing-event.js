/**
 * #332E1 — Provider-neutral billing event model (server-only).
 *
 * Trust boundary:
 * - Future ProviderAdapters MUST verify signatures/receipts/server API
 *   BEFORE calling normalize → applyBillingEvent.
 * - applyBillingEvent trusts only that the caller is server code after verify.
 * - TypeScript/JSDoc is documentation, not a security boundary.
 * - Client APIs must NEVER call applyBillingEvent.
 *
 * planId on a BillingEvent is ALWAYS derived via mapProviderProductToPlanId —
 * never trusted from raw provider input or the client.
 */

import { normalizePlanId } from './entitlements.js'
import {
  PAID_PLAN_IDS,
  SUBSCRIPTION_PROVIDERS,
  SUBSCRIPTION_STATUSES,
  mapProviderProductToPlanId as mapProductFromCatalog,
  parseSubscriptionInstant,
} from './subscriptions.js'

/** @typedef {'stripe' | 'google_play' | 'app_store' | 'manual'} BillingProvider */
/** @typedef {'sandbox' | 'live'} BillingEnvironment */
/** @typedef {'free' | 'base' | 'pro'} PlanId */
/** @typedef {import('./subscriptions.js').SubscriptionStatus} SubscriptionStatus */

/**
 * Input after provider verify+normalize, BEFORE plan mapping.
 * Must NOT carry a trusted planId from the provider.
 *
 * @typedef {{
 *   provider: BillingProvider | string
 *   providerEventId: string
 *   eventType: string
 *   eventTimestamp: string | Date
 *   environment: BillingEnvironment | string
 *   userId: string
 *   providerCustomerId?: string | null
 *   providerSubscriptionId: string
 *   providerProductId: string
 *   status: SubscriptionStatus | string
 *   currentPeriodStart?: string | Date | null
 *   currentPeriodEnd?: string | Date | null
 *   graceUntil?: string | Date | null
 *   cancelAtPeriodEnd?: boolean
 * }} BillingEventInput
 */

/**
 * Server-derived event ready for persistence.
 *
 * @typedef {BillingEventInput & {
 *   planId: 'base' | 'pro'
 *   environment: BillingEnvironment
 *   provider: BillingProvider
 *   status: SubscriptionStatus
 *   eventTimestamp: string
 *   currentPeriodStart: string | null
 *   currentPeriodEnd: string | null
 *   graceUntil: string | null
 *   cancelAtPeriodEnd: boolean
 *   providerCustomerId: string | null
 * }} VerifiedBillingEvent
 */

/**
 * @typedef {(
 *   | 'applied'
 *   | 'duplicate'
 *   | 'stale'
 *   | 'unknown_product'
 *   | 'invalid_event'
 *   | 'user_not_found'
 *   | 'user_mismatch'
 *   | 'no_change'
 *   | 'revoked'
 *   | 'storage_error'
 * )} BillingApplyResultCode
 */

export const BILLING_ENVIRONMENTS = Object.freeze(
  /** @type {const} */ (['sandbox', 'live']),
)

/** Providers accepted by the live event pipeline (manual requires allowManual). */
export const BILLING_PIPELINE_PROVIDERS = Object.freeze(
  /** @type {const} */ (['stripe', 'google_play', 'app_store']),
)

/**
 * Future adapter contract (no implementations in #332E1).
 *
 * @typedef {{
 *   verify: (raw: unknown, ctx?: Record<string, unknown>) => Promise<
 *     | { ok: true, verified: unknown }
 *     | { ok: false, error: string }
 *   >
 *   normalize: (verified: unknown, ctx?: Record<string, unknown>) => BillingEventInput
 * }} BillingProviderAdapter
 */

/**
 * @param {unknown} value
 * @returns {BillingEnvironment | null}
 */
export function normalizeBillingEnvironment(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return BILLING_ENVIRONMENTS.includes(/** @type {BillingEnvironment} */ (v))
    ? /** @type {BillingEnvironment} */ (v)
    : null
}

/**
 * @param {unknown} value
 * @returns {BillingProvider | null}
 */
export function normalizeBillingProvider(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return SUBSCRIPTION_PROVIDERS.includes(/** @type {BillingProvider} */ (v))
    ? /** @type {BillingProvider} */ (v)
    : null
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nonEmptyString(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v ? v : null
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toIsoOrNull(value) {
  if (value == null || value === '') return null
  const d = parseSubscriptionInstant(value)
  return d ? d.toISOString() : null
}

/**
 * Map provider product → plan. Ignores any caller-supplied planId.
 *
 * @param {unknown} provider
 * @param {unknown} productId
 * @param {{
 *   productMap?: Readonly<Record<string, Readonly<Record<string, PlanId>>>>
 *   environment?: unknown
 * }} [opts]
 * @returns {'base' | 'pro' | null}
 */
export function mapProviderProductToPlanId(provider, productId, opts = {}) {
  void opts.environment // reserved for env-specific SKUs later
  const mapped = opts.productMap
    ? mapWithCustomMap(provider, productId, opts.productMap)
    : mapProductFromCatalog(provider, productId)
  if (mapped === 'base' || mapped === 'pro') return mapped
  return null
}

/**
 * @param {unknown} provider
 * @param {unknown} productId
 * @param {Readonly<Record<string, Readonly<Record<string, PlanId>>>>} productMap
 */
function mapWithCustomMap(provider, productId, productMap) {
  if (typeof provider !== 'string' || typeof productId !== 'string') return null
  const p = provider.trim().toLowerCase()
  const sku = productId.trim()
  if (!p || !sku) return null
  const table = productMap[p]
  if (!table) return null
  return normalizePlanId(table[sku])
}

/**
 * Validate + derive planId. Rejects trusted-looking planId from input.
 *
 * @param {BillingEventInput | Record<string, unknown>} input
 * @param {{
 *   productMap?: Readonly<Record<string, Readonly<Record<string, PlanId>>>>
 *   allowManual?: boolean
 * }} [opts]
 * @returns {{
 *   ok: true, event: VerifiedBillingEvent
 * } | {
 *   ok: false, result: BillingApplyResultCode, detail?: string
 * }}
 */
export function buildVerifiedBillingEvent(input, opts = {}) {
  if (!input || typeof input !== 'object') {
    return { ok: false, result: 'invalid_event', detail: 'event_required' }
  }

  const provider = normalizeBillingProvider(input.provider)
  if (!provider) {
    return { ok: false, result: 'invalid_event', detail: 'provider_invalid' }
  }
  if (provider === 'manual' && opts.allowManual !== true) {
    return { ok: false, result: 'invalid_event', detail: 'manual_not_allowed' }
  }
  if (
    provider !== 'manual' &&
    !BILLING_PIPELINE_PROVIDERS.includes(/** @type {'stripe'|'google_play'|'app_store'} */ (provider))
  ) {
    return { ok: false, result: 'invalid_event', detail: 'provider_invalid' }
  }

  const environment = normalizeBillingEnvironment(input.environment)
  if (!environment) {
    return { ok: false, result: 'invalid_event', detail: 'environment_invalid' }
  }

  const providerEventId = nonEmptyString(input.providerEventId)
  const eventType = nonEmptyString(input.eventType)
  const eventTimestamp = toIsoOrNull(input.eventTimestamp)
  const userId = nonEmptyString(input.userId)
  const providerSubscriptionId = nonEmptyString(input.providerSubscriptionId)
  const providerProductId = nonEmptyString(input.providerProductId)

  if (!providerEventId || !eventType || !eventTimestamp) {
    return { ok: false, result: 'invalid_event', detail: 'event_identity_required' }
  }
  if (!userId) {
    return { ok: false, result: 'invalid_event', detail: 'user_id_required' }
  }
  if (!providerSubscriptionId) {
    return { ok: false, result: 'invalid_event', detail: 'provider_subscription_id_required' }
  }
  if (!providerProductId) {
    return { ok: false, result: 'unknown_product', detail: 'product_id_required' }
  }

  const statusRaw = nonEmptyString(input.status)?.toLowerCase() ?? ''
  if (!SUBSCRIPTION_STATUSES.includes(/** @type {SubscriptionStatus} */ (statusRaw))) {
    return { ok: false, result: 'invalid_event', detail: 'status_invalid' }
  }

  // Ignore any input.planId — derive only from product map.
  void /** @type {Record<string, unknown>} */ (input).planId
  const planId = mapProviderProductToPlanId(provider, providerProductId, {
    productMap: opts.productMap,
    environment,
  })
  if (!planId || !PAID_PLAN_IDS.includes(planId)) {
    return { ok: false, result: 'unknown_product', detail: 'plan_unmapped' }
  }

  /** @type {VerifiedBillingEvent} */
  const event = {
    provider,
    providerEventId,
    eventType,
    eventTimestamp,
    environment,
    userId,
    providerCustomerId: nonEmptyString(input.providerCustomerId),
    providerSubscriptionId,
    providerProductId,
    planId,
    status: /** @type {SubscriptionStatus} */ (statusRaw),
    currentPeriodStart: toIsoOrNull(input.currentPeriodStart),
    currentPeriodEnd: toIsoOrNull(input.currentPeriodEnd),
    graceUntil: toIsoOrNull(input.graceUntil),
    cancelAtPeriodEnd: input.cancelAtPeriodEnd === true,
  }

  return { ok: true, event }
}

/**
 * JSON payload for apply_billing_event RPC / persistence.
 *
 * @param {VerifiedBillingEvent} event
 */
export function billingEventToRpcPayload(event) {
  return {
    provider: event.provider,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    eventTimestamp: event.eventTimestamp,
    environment: event.environment,
    userId: event.userId,
    providerCustomerId: event.providerCustomerId,
    providerSubscriptionId: event.providerSubscriptionId,
    providerProductId: event.providerProductId,
    planId: event.planId,
    status: event.status,
    currentPeriodStart: event.currentPeriodStart,
    currentPeriodEnd: event.currentPeriodEnd,
    graceUntil: event.graceUntil,
    cancelAtPeriodEnd: event.cancelAtPeriodEnd,
  }
}

/**
 * Safe log fields only.
 *
 * @param {VerifiedBillingEvent} event
 * @param {BillingApplyResultCode} result
 */
export function billingApplyLogFields(event, result) {
  return {
    provider: event.provider,
    environment: event.environment,
    eventType: event.eventType,
    processingResult: result,
    planId: event.planId,
    status: event.status,
  }
}
