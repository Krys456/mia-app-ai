/**
 * #388B — Stripe webhook verify → normalize → applyBillingEvent.
 *
 * Never trusts client state. Never logs raw payloads / secrets / PII.
 */

import { applyBillingEvent } from './billing-apply.js'
import { createStripeClient } from './stripe-client.js'
import {
  STRIPE_USER_METADATA_KEY,
  buildStripeProductPlanMap,
  mapStripePriceIdToPlanId,
  resolveStripeConfig,
} from './stripe-config.js'
import { mapStripeSubscriptionStatus } from './stripe-status.js'

/** MVP event types that drive the subscription mirror. */
export const STRIPE_WEBHOOK_MVP_TYPES = Object.freeze([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
])

/**
 * @param {unknown} value
 * @returns {string}
 */
function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * @param {number | null | undefined} unix
 * @returns {string | null}
 */
function unixToIso(unix) {
  if (typeof unix !== 'number' || !Number.isFinite(unix) || unix <= 0) return null
  return new Date(unix * 1000).toISOString()
}

/**
 * Extract price id from a Stripe Subscription object.
 * @param {Record<string, unknown>} subscription
 * @returns {string | null}
 */
export function extractSubscriptionPriceId(subscription) {
  const items = subscription?.items
  const data = items && typeof items === 'object' ? /** @type {any} */ (items).data : null
  if (!Array.isArray(data) || data.length === 0) return null
  const first = data[0]
  const price = first?.price
  if (typeof price === 'string' && price.trim()) return price.trim()
  if (price && typeof price === 'object' && typeof price.id === 'string') return price.id.trim()
  return null
}

/**
 * Resolve ShinkAIdo user id from Stripe objects (metadata / client_reference_id).
 * @param {Record<string, unknown>} obj
 * @returns {string | null}
 */
export function extractShinkaidoUserId(obj) {
  if (!obj || typeof obj !== 'object') return null
  const meta = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : null
  const fromMeta = meta ? asNonEmptyString(meta[STRIPE_USER_METADATA_KEY]) : ''
  if (fromMeta) return fromMeta
  const fromRef = asNonEmptyString(obj.client_reference_id)
  if (fromRef) return fromRef
  return null
}

/**
 * Build BillingEventInput from a Stripe Subscription (+ optional overrides).
 *
 * @param {{
 *   subscription: Record<string, unknown>
 *   eventId: string
 *   eventType: string
 *   eventCreated: number
 *   environment: 'sandbox' | 'live'
 *   userId?: string | null
 *   statusOverride?: string | null
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 * }} opts
 */
export function normalizeStripeSubscriptionEvent(opts) {
  const sub = opts.subscription
  if (!sub || typeof sub !== 'object') {
    return { ok: false, code: 'subscription_missing' }
  }

  const userId =
    asNonEmptyString(opts.userId) || extractShinkaidoUserId(sub) || null
  if (!userId) {
    return { ok: false, code: 'user_id_unresolved' }
  }

  const priceId = extractSubscriptionPriceId(sub)
  if (!priceId) {
    return { ok: false, code: 'price_id_missing' }
  }

  const planId = mapStripePriceIdToPlanId(priceId, opts.env ?? process.env)
  if (!planId) {
    return { ok: false, code: 'unknown_price', priceId }
  }

  const stripeStatus = opts.statusOverride || asNonEmptyString(sub.status)
  const status = mapStripeSubscriptionStatus(stripeStatus)
  if (!status) {
    return { ok: false, code: 'status_unmapped', stripeStatus }
  }

  const providerSubscriptionId = asNonEmptyString(sub.id)
  if (!providerSubscriptionId) {
    return { ok: false, code: 'subscription_id_missing' }
  }

  const customerRaw = sub.customer
  const providerCustomerId =
    typeof customerRaw === 'string'
      ? customerRaw
      : customerRaw && typeof customerRaw === 'object'
        ? asNonEmptyString(/** @type {any} */ (customerRaw).id)
        : null

  return {
    ok: true,
    planId,
    input: {
      provider: 'stripe',
      providerEventId: opts.eventId,
      eventType: opts.eventType,
      eventTimestamp: unixToIso(opts.eventCreated) || new Date().toISOString(),
      environment: opts.environment,
      userId,
      providerCustomerId,
      providerSubscriptionId,
      providerProductId: priceId,
      status,
      currentPeriodStart: unixToIso(/** @type {any} */ (sub).current_period_start),
      currentPeriodEnd: unixToIso(/** @type {any} */ (sub).current_period_end),
      graceUntil: null,
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    },
  }
}

/**
 * Verify Stripe-Signature against raw body.
 *
 * @param {{
 *   rawBody: Buffer | string
 *   signature: string | null | undefined
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 *   webhookSecret?: string
 * }} opts
 */
export function verifyStripeWebhook(opts) {
  const env = opts.env ?? process.env
  const signature = asNonEmptyString(opts.signature)
  if (!signature) {
    return { ok: false, code: 'stripe_signature_missing', status: 400 }
  }

  const cfg = resolveStripeConfig(env)
  const secret = asNonEmptyString(opts.webhookSecret) || (cfg.ok ? cfg.webhookSecret : '')
  if (!secret) {
    return { ok: false, code: 'stripe_webhook_secret_missing', status: 503 }
  }

  let stripe = opts.stripe
  if (!stripe) {
    const client = createStripeClient(env)
    if (!client.ok) return { ok: false, code: client.code, status: 503 }
    stripe = client.stripe
  }

  try {
    const event = stripe.webhooks.constructEvent(opts.rawBody, signature, secret)
    return {
      ok: true,
      event,
      environment: cfg.ok ? cfg.billingEnvironment : 'sandbox',
    }
  } catch {
    return { ok: false, code: 'stripe_webhook_invalid_signature', status: 400 }
  }
}

/**
 * Process a verified Stripe event into applyBillingEvent.
 *
 * @param {{
 *   event: { id: string, type: string, created: number, data: { object: any } }
 *   environment: 'sandbox' | 'live'
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 *   applyBillingEventFn?: typeof applyBillingEvent
 *   productMap?: Readonly<Record<string, Readonly<Record<string, string>>>>
 *   logger?: { info?: Function, warn?: Function, error?: Function }
 * }} opts
 */
export async function processStripeWebhookEvent(opts) {
  const env = opts.env ?? process.env
  const event = opts.event
  const type = asNonEmptyString(event?.type)
  const eventId = asNonEmptyString(event?.id)
  if (!type || !eventId) {
    return { ok: false, code: 'invalid_event', httpStatus: 400 }
  }

  if (!STRIPE_WEBHOOK_MVP_TYPES.includes(/** @type {any} */ (type))) {
    return {
      ok: true,
      code: 'event_ignored',
      httpStatus: 200,
      ignored: true,
      eventType: type,
    }
  }

  const applyFn = opts.applyBillingEventFn ?? applyBillingEvent
  const productMap = opts.productMap ?? buildStripeProductPlanMap(env)
  const log = opts.logger ?? console

  /** @type {Record<string, unknown> | null} */
  let subscription = null
  /** @type {string | null} */
  let userIdHint = null
  /** @type {string | null} */
  let statusOverride = null

  if (type.startsWith('customer.subscription.')) {
    subscription = event.data?.object || null
    if (type === 'customer.subscription.deleted' && subscription) {
      statusOverride = 'canceled'
    }
  } else if (type === 'checkout.session.completed') {
    const session = event.data?.object || {}
    userIdHint = extractShinkaidoUserId(session)
    const subField = session.subscription
    const subId =
      typeof subField === 'string'
        ? subField
        : subField && typeof subField === 'object'
          ? asNonEmptyString(subField.id)
          : ''
    if (!subId) {
      // Payment mode or incomplete — ignore for subscription mirror.
      return { ok: true, code: 'checkout_without_subscription', httpStatus: 200, ignored: true }
    }
    if (opts.stripe) {
      try {
        subscription = /** @type {any} */ (await opts.stripe.subscriptions.retrieve(subId))
      } catch {
        return { ok: false, code: 'subscription_retrieve_failed', httpStatus: 500, retryable: true }
      }
    } else {
      return { ok: false, code: 'stripe_client_required', httpStatus: 500, retryable: true }
    }
    // Ensure metadata carries user id from session if subscription lacks it.
    if (subscription && userIdHint) {
      const meta = { ...(subscription.metadata || {}) }
      if (!meta[STRIPE_USER_METADATA_KEY]) {
        subscription = {
          ...subscription,
          metadata: { ...meta, [STRIPE_USER_METADATA_KEY]: userIdHint },
        }
      }
    }
  } else if (type === 'invoice.payment_failed') {
    const invoice = event.data?.object || {}
    const subField = invoice.subscription
    const subId =
      typeof subField === 'string'
        ? subField
        : subField && typeof subField === 'object'
          ? asNonEmptyString(subField.id)
          : ''
    if (!subId) {
      return { ok: true, code: 'invoice_without_subscription', httpStatus: 200, ignored: true }
    }
    if (!opts.stripe) {
      return { ok: false, code: 'stripe_client_required', httpStatus: 500, retryable: true }
    }
    try {
      subscription = /** @type {any} */ (await opts.stripe.subscriptions.retrieve(subId))
    } catch {
      return { ok: false, code: 'subscription_retrieve_failed', httpStatus: 500, retryable: true }
    }
    statusOverride = 'past_due'
  }

  if (!subscription) {
    return { ok: true, code: 'event_ignored', httpStatus: 200, ignored: true }
  }

  const normalized = normalizeStripeSubscriptionEvent({
    subscription,
    eventId,
    eventType: type,
    eventCreated: typeof event.created === 'number' ? event.created : Math.floor(Date.now() / 1000),
    environment: opts.environment,
    userId: userIdHint,
    statusOverride,
    env,
  })

  if (!normalized.ok) {
    if (normalized.code === 'unknown_price') {
      log.warn?.(
        '[stripe-webhook]',
        JSON.stringify({
          code: 'unknown_price',
          eventType: type,
          eventId,
          // never log the raw price id in production logs if considered sensitive —
          // Price IDs are not secrets but keep short.
        }),
      )
      // Ack to Stripe (do not retry forever); do not grant paid plan.
      return { ok: true, code: 'unknown_price', httpStatus: 200, applied: false }
    }
    if (normalized.code === 'user_id_unresolved') {
      // Cannot map ownership — fail so Stripe retries after metadata fix / retrieve.
      return { ok: false, code: 'user_id_unresolved', httpStatus: 500, retryable: true }
    }
    return { ok: false, code: normalized.code, httpStatus: 400 }
  }

  const result = await applyFn(normalized.input, {
    productMap,
    allowManual: false,
    logger: log,
  })

  if (result.result === 'duplicate' || result.result === 'stale' || result.result === 'no_change') {
    return {
      ok: true,
      code: result.result === 'duplicate' ? 'stripe_webhook_duplicate' : result.result,
      httpStatus: 200,
      applyResult: result.result,
      planId: result.planId || normalized.planId,
      status: result.status || normalized.input.status,
    }
  }

  if (
    result.result === 'applied' ||
    result.result === 'revoked'
  ) {
    return {
      ok: true,
      code: 'billing_event_applied',
      httpStatus: 200,
      applyResult: result.result,
      planId: result.planId || normalized.planId,
      status: result.status || normalized.input.status,
    }
  }

  // storage_error / user_not_found / etc. → retry
  log.error?.(
    '[stripe-webhook]',
    JSON.stringify({
      code: 'billing_event_failed',
      applyResult: result.result,
      eventType: type,
      eventId,
    }),
  )

  return {
    ok: false,
    code: 'billing_event_failed',
    httpStatus: 500,
    retryable: true,
    applyResult: result.result,
  }
}

/**
 * Full webhook entry: verify + process.
 *
 * @param {{
 *   rawBody: Buffer | string
 *   signature: string | null | undefined
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   stripe?: import('stripe').default
 *   applyBillingEventFn?: typeof applyBillingEvent
 *   productMap?: Readonly<Record<string, Readonly<Record<string, string>>>>
 *   logger?: { info?: Function, warn?: Function, error?: Function }
 * }} opts
 */
export async function handleStripeWebhook(opts) {
  const verified = verifyStripeWebhook({
    rawBody: opts.rawBody,
    signature: opts.signature,
    env: opts.env,
    stripe: opts.stripe,
  })
  if (!verified.ok) {
    return {
      ok: false,
      code: verified.code,
      httpStatus: verified.status || 400,
    }
  }

  let stripe = opts.stripe
  if (!stripe) {
    const client = createStripeClient(opts.env ?? process.env)
    if (client.ok) stripe = client.stripe
  }

  return processStripeWebhookEvent({
    event: verified.event,
    environment: verified.environment,
    env: opts.env,
    stripe,
    applyBillingEventFn: opts.applyBillingEventFn,
    productMap: opts.productMap,
    logger: opts.logger,
  })
}

/**
 * Detect Stripe webhook probe (rewrite or query).
 * @param {{ url?: string, query?: Record<string, unknown> } | null | undefined} req
 */
export function isStripeWebhookProbe(req) {
  try {
    const q = req?.query
    const probe = q && (q.probe ?? q['probe'])
    if (probe === 'stripe_webhook' || (Array.isArray(probe) && probe[0] === 'stripe_webhook')) {
      return true
    }
  } catch {
    /* soft */
  }
  const raw = typeof req?.url === 'string' ? req.url : ''
  if (!raw) return false
  try {
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw.split('?')[0]
    return (
      path === '/api/stripe/webhook' ||
      path === '/api/billing/webhook' ||
      path.endsWith('/stripe/webhook')
    )
  } catch {
    return false
  }
}
