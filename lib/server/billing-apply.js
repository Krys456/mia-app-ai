/**
 * #332E1 — applyBillingEvent: idempotent subscription mirror updates.
 *
 * Production path: SECURITY DEFINER RPC public.apply_billing_event(jsonb)
 * (atomic claim + upsert in one Postgres transaction).
 *
 * Tests: in-memory BillingMemoryStore mirrors the same semantics.
 *
 * NOT callable from client routes. No live provider webhooks in #332E1.
 */

import { getServiceSupabase } from './supabase.js'
import {
  billingApplyLogFields,
  billingEventToRpcPayload,
  buildVerifiedBillingEvent,
} from './billing-event.js'
import { parseSubscriptionInstant } from './subscriptions.js'

/**
 * @typedef {import('./billing-event.js').BillingEventInput} BillingEventInput
 * @typedef {import('./billing-event.js').VerifiedBillingEvent} VerifiedBillingEvent
 * @typedef {import('./billing-event.js').BillingApplyResultCode} BillingApplyResultCode
 * @typedef {import('./subscriptions.js').SubscriptionRow} SubscriptionRow
 */

/**
 * @typedef {{
 *   result: BillingApplyResultCode
 *   detail?: string
 *   subscriptionId?: string | null
 *   planId?: string | null
 *   status?: string | null
 *   billingEventId?: string | null
 *   event?: VerifiedBillingEvent
 * }} BillingApplyResult
 */

/**
 * @typedef {{
 *   events: Map<string, {
 *     id: string
 *     provider: string
 *     environment: string
 *     providerEventId: string
 *     eventType: string
 *     eventTimestamp: string
 *     processingStatus: string
 *     resultCode: string | null
 *     subscriptionId: string | null
 *     userId: string
 *     planId: string | null
 *     status: string | null
 *   }>
 *   subscriptions: Map<string, SubscriptionRow & {
 *     id: string
 *     environment: string
 *     last_provider_event_at: string | null
 *   }>
 *   users: Set<string>
 * }} BillingMemoryStore
 */

/**
 * @param {string} provider
 * @param {string} environment
 * @param {string} providerEventId
 */
function eventKey(provider, environment, providerEventId) {
  return `${provider}::${environment}::${providerEventId}`
}

/**
 * @param {string} provider
 * @param {string} environment
 * @param {string} providerSubscriptionId
 */
function subKey(provider, environment, providerSubscriptionId) {
  return `${provider}::${environment}::${providerSubscriptionId}`
}

/**
 * Deterministic in-memory apply (tests / local fixtures).
 * Mirrors public.apply_billing_event semantics.
 *
 * @param {VerifiedBillingEvent} event
 * @param {BillingMemoryStore} store
 * @returns {BillingApplyResult}
 */
export function applyBillingEventInMemory(event, store) {
  const eKey = eventKey(event.provider, event.environment, event.providerEventId)
  if (store.events.has(eKey)) {
    return {
      result: 'duplicate',
      detail: 'provider_event_already_seen',
      event,
    }
  }

  if (!store.users.has(event.userId)) {
    return { result: 'user_not_found', detail: 'public_users_missing', event }
  }

  const billingEventId = `be_${store.events.size + 1}`
  const sKey = subKey(
    event.provider,
    event.environment,
    event.providerSubscriptionId,
  )
  const existing = store.subscriptions.get(sKey) || null
  const eventTs = parseSubscriptionInstant(event.eventTimestamp)
  if (!eventTs) {
    return { result: 'invalid_event', detail: 'event_timestamp_invalid', event }
  }

  store.events.set(eKey, {
    id: billingEventId,
    provider: event.provider,
    environment: event.environment,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    eventTimestamp: event.eventTimestamp,
    processingStatus: 'received',
    resultCode: null,
    subscriptionId: null,
    userId: event.userId,
    planId: event.planId,
    status: event.status,
  })

  if (existing) {
    const last = parseSubscriptionInstant(existing.last_provider_event_at)
    if (last && eventTs.getTime() < last.getTime()) {
      const row = store.events.get(eKey)
      if (row) {
        row.processingStatus = 'stale'
        row.resultCode = 'stale'
        row.subscriptionId = existing.id
      }
      return {
        result: 'stale',
        subscriptionId: existing.id,
        planId: existing.plan_id,
        status: existing.status,
        billingEventId,
        event,
      }
    }

    if (
      last &&
      eventTs.getTime() === last.getTime() &&
      existing.plan_id === event.planId &&
      existing.status === event.status &&
      existing.user_id === event.userId &&
      (existing.product_id || '') === event.providerProductId &&
      Boolean(existing.cancel_at_period_end) === event.cancelAtPeriodEnd &&
      (existing.current_period_end || null) === event.currentPeriodEnd &&
      (existing.grace_until || null) === event.graceUntil
    ) {
      const row = store.events.get(eKey)
      if (row) {
        row.processingStatus = 'applied'
        row.resultCode = 'no_change'
        row.subscriptionId = existing.id
      }
      return {
        result: 'no_change',
        subscriptionId: existing.id,
        planId: existing.plan_id,
        status: existing.status,
        billingEventId,
        event,
      }
    }

    if (existing.user_id !== event.userId) {
      const row = store.events.get(eKey)
      if (row) {
        row.processingStatus = 'rejected'
        row.resultCode = 'user_mismatch'
        row.subscriptionId = existing.id
      }
      return {
        result: 'user_mismatch',
        subscriptionId: existing.id,
        billingEventId,
        event,
      }
    }

    existing.provider_customer_id = event.providerCustomerId
    existing.product_id = event.providerProductId
    existing.plan_id = event.planId
    existing.status = event.status
    existing.current_period_start = event.currentPeriodStart
    existing.current_period_end = event.currentPeriodEnd
    existing.grace_until = event.graceUntil
    existing.cancel_at_period_end = event.cancelAtPeriodEnd
    existing.last_provider_event_at = event.eventTimestamp
    existing.environment = event.environment

    const row = store.events.get(eKey)
    if (row) {
      row.processingStatus = 'applied'
      row.resultCode = event.status === 'revoked' ? 'revoked' : 'applied'
      row.subscriptionId = existing.id
    }

    return {
      result: event.status === 'revoked' ? 'revoked' : 'applied',
      subscriptionId: existing.id,
      planId: event.planId,
      status: event.status,
      billingEventId,
      event,
    }
  }

  const subscriptionId = `sub_${store.subscriptions.size + 1}`
  store.subscriptions.set(sKey, {
    id: subscriptionId,
    user_id: event.userId,
    provider: event.provider,
    environment: event.environment,
    provider_customer_id: event.providerCustomerId,
    provider_subscription_id: event.providerSubscriptionId,
    product_id: event.providerProductId,
    plan_id: event.planId,
    status: event.status,
    current_period_start: event.currentPeriodStart,
    current_period_end: event.currentPeriodEnd,
    grace_until: event.graceUntil,
    cancel_at_period_end: event.cancelAtPeriodEnd,
    last_provider_event_at: event.eventTimestamp,
  })

  const row = store.events.get(eKey)
  if (row) {
    row.processingStatus = 'applied'
    row.resultCode = event.status === 'revoked' ? 'revoked' : 'applied'
    row.subscriptionId = subscriptionId
  }

  return {
    result: event.status === 'revoked' ? 'revoked' : 'applied',
    subscriptionId,
    planId: event.planId,
    status: event.status,
    billingEventId,
    event,
  }
}

/**
 * @returns {BillingMemoryStore}
 */
export function createBillingMemoryStore() {
  return {
    events: new Map(),
    subscriptions: new Map(),
    users: new Set(),
  }
}

/**
 * @param {BillingMemoryStore} store
 * @param {string} userId
 */
export function memoryStoreAddUser(store, userId) {
  store.users.add(userId)
}

/**
 * @param {BillingMemoryStore} store
 * @param {string} userId
 */
export function memoryStoreSubscriptionsForUser(store, userId) {
  /** @type {SubscriptionRow[]} */
  const rows = []
  for (const row of store.subscriptions.values()) {
    if (row.user_id === userId) rows.push(row)
  }
  return rows
}

/**
 * Apply a verified provider event to the subscription mirror.
 *
 * @param {BillingEventInput | Record<string, unknown>} input
 * @param {{
 *   productMap?: Readonly<Record<string, Readonly<Record<string, string>>>>
 *   allowManual?: boolean
 *   memoryStore?: BillingMemoryStore
 *   supabase?: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown, error: { message?: string } | null }> }
 *   getServiceSupabase?: typeof getServiceSupabase
 *   logger?: { info?: Function, warn?: Function, error?: Function }
 * }} [deps]
 * @returns {Promise<BillingApplyResult>}
 */
export async function applyBillingEvent(input, deps = {}) {
  const built = buildVerifiedBillingEvent(input, {
    productMap: /** @type {any} */ (deps.productMap),
    allowManual: deps.allowManual,
  })
  if (!built.ok) {
    return { result: built.result, detail: built.detail }
  }

  const event = built.event
  const log = deps.logger ?? console

  try {
    /** @type {BillingApplyResult} */
    let outcome
    if (deps.memoryStore) {
      outcome = applyBillingEventInMemory(event, deps.memoryStore)
    } else {
      const getSb = deps.getServiceSupabase ?? getServiceSupabase
      const supabase = deps.supabase ?? (await getSb())
      const { data, error } = await supabase.rpc('apply_billing_event', {
        p_event: billingEventToRpcPayload(event),
      })
      if (error) {
        log.error?.(
          '[billing-apply] rpc_failed',
          JSON.stringify({
            ...billingApplyLogFields(event, 'storage_error'),
            // never log error.message if it might contain secrets — keep short
            code: 'rpc_error',
          }),
        )
        return { result: 'storage_error', detail: 'rpc_failed', event }
      }
      const payload =
        data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : null
      const resultRaw = typeof payload?.result === 'string' ? payload.result : 'storage_error'
      outcome = {
        result: /** @type {BillingApplyResultCode} */ (resultRaw),
        detail: typeof payload?.detail === 'string' ? payload.detail : undefined,
        subscriptionId:
          typeof payload?.subscriptionId === 'string' ? payload.subscriptionId : null,
        planId: typeof payload?.planId === 'string' ? payload.planId : event.planId,
        status: typeof payload?.status === 'string' ? payload.status : event.status,
        billingEventId:
          typeof payload?.billingEventId === 'string' ? payload.billingEventId : null,
        event,
      }
    }

    log.info?.(
      '[billing-apply]',
      JSON.stringify(billingApplyLogFields(event, outcome.result)),
    )
    return outcome
  } catch (err) {
    void err
    log.error?.(
      '[billing-apply] unexpected',
      JSON.stringify(billingApplyLogFields(event, 'storage_error')),
    )
    return { result: 'storage_error', detail: 'unexpected', event }
  }
}
