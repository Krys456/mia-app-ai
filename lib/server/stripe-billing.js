/**
 * #332E3A — Stripe Checkout + webhook adapter (server-only).
 *
 * Ends at normalized BillingEvent → applyBillingEvent (#332E1).
 * No parallel Stripe persistence. No client grants.
 */

import Stripe from 'stripe'
import { requireDurableIdentity } from './durable-identity.js'
import { applyBillingEvent } from './billing-apply.js'
import {
  loadStripeBillingConfig,
  mapStripePriceToPlanId,
  resolvePriceIdForPlan,
  resolveTrustedAppOrigin,
  stripeProductMapFromConfig,
} from './stripe-config.js'
import { resolveVerifiedPlanForUser } from './subscription-lookup.js'
import { filterSubscriptionsByEnvironment } from './billing-environment.js'
import { getServiceSupabase } from './supabase.js'

/** Stripe API version pinned to the installed SDK default (stripe@22.5.0). */
export const STRIPE_API_VERSION = /** @type {const} */ ('2026-07-29.dahlia')

/** @typedef {import('./stripe-config.js').StripeBillingConfig} StripeBillingConfig */
/** @typedef {import('./subscriptions.js').SubscriptionStatus} SubscriptionStatus */

export const STRIPE_HANDLED_EVENTS = Object.freeze([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

/**
 * @param {StripeBillingConfig} config
 * @returns {Stripe}
 */
export function createStripeClient(config) {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  })
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getStripeBillingRuntime(env = process.env) {
  const loaded = loadStripeBillingConfig(env)
  if (!loaded.ok) return loaded
  return {
    ok: true,
    config: loaded.config,
    stripe: createStripeClient(loaded.config),
    productMap: stripeProductMapFromConfig(loaded.config),
  }
}

/**
 * Find reusable Stripe customer id for user in current environment.
 *
 * @param {string} userId
 * @param {import('./billing-environment.js').BillingEnvironment} environment
 * @param {{
 *   fetchSubscriptionsForUser?: typeof import('./subscription-lookup.js').fetchSubscriptionsForUser
 *   getServiceSupabase?: typeof getServiceSupabase
 * }} [deps]
 */
export async function findStripeCustomerIdForUser(userId, environment, deps = {}) {
  const getSb = deps.getServiceSupabase ?? getServiceSupabase
  const supabase = await getSb()
  const fetch =
    deps.fetchSubscriptionsForUser ??
    (await import('./subscription-lookup.js')).fetchSubscriptionsForUser
  const { rows, error } = await fetch(supabase, userId, { environment })
  if (error) return { customerId: null, error }
  const scoped = filterSubscriptionsByEnvironment(rows, environment)
  for (const row of scoped) {
    if (row.provider === 'stripe' && typeof row.provider_customer_id === 'string') {
      const id = row.provider_customer_id.trim()
      if (id) return { customerId: id, error: null }
    }
  }
  return { customerId: null, error: null }
}

/**
 * Existing-subscription policy before Checkout.
 *
 * @param {{ planId: string, status: string, lookupError?: boolean }} verified
 * @param {'base' | 'pro'} targetPlan
 */
export function evaluateCheckoutEligibility(verified, targetPlan) {
  if (verified.lookupError) {
    return {
      ok: false,
      status: 503,
      code: 'subscription_lookup_unavailable',
      error: 'Subscription service temporarily unavailable. Retry shortly.',
    }
  }

  const current = verified.planId
  const status = typeof verified.status === 'string' ? verified.status : 'none'

  if (status === 'past_due' || status === 'grace') {
    return {
      ok: false,
      status: 409,
      code: 'billing_management_required',
      error: 'Gestisci il pagamento del piano esistente prima di un nuovo acquisto.',
    }
  }

  if (current === 'free') {
    return { ok: true }
  }

  if (current === targetPlan) {
    return {
      ok: false,
      status: 409,
      code: 'subscription_already_active',
      error: 'Questo piano è già attivo.',
    }
  }

  // Base→Pro / Pro→Base / paid→other: Portal in #332E3B
  return {
    ok: false,
    status: 409,
    code: 'billing_management_required',
    error: 'La gestione del piano sarà disponibile a breve.',
  }
}

/**
 * Create Stripe Checkout Session for durable user.
 *
 * @param {{
 *   user: import('./durable-identity.js').AuthUserLike
 *   userId: string
 *   targetPlan: unknown
 *   env?: NodeJS.ProcessEnv
 *   stripeRuntime?: ReturnType<typeof getStripeBillingRuntime>
 *   resolveVerifiedPlanForUser?: typeof resolveVerifiedPlanForUser
 *   findStripeCustomerIdForUser?: typeof findStripeCustomerIdForUser
 * }} args
 */
export async function createCheckoutSessionForUser(args) {
  const env = args.env ?? process.env
  const durable = requireDurableIdentity(args.user)
  if (!durable.ok) {
    return {
      ok: false,
      status: durable.code === 'not_authenticated' ? 401 : 403,
      code: 'durable_identity_required',
      error: 'durable_identity_required',
    }
  }

  const runtime = args.stripeRuntime ?? getStripeBillingRuntime(env)
  if (!runtime.ok) {
    return {
      ok: false,
      status: runtime.code === 'billing_unavailable' ? 503 : 503,
      code: runtime.code,
      error:
        runtime.code === 'billing_unavailable'
          ? 'Billing temporarily unavailable.'
          : 'Billing configuration error.',
      detail: runtime.detail,
    }
  }

  const price = resolvePriceIdForPlan(runtime.config, args.targetPlan)
  if (!price.ok) {
    return {
      ok: false,
      status: 400,
      code: price.code,
      error: 'Invalid billing product.',
      detail: price.detail,
    }
  }

  const resolve = args.resolveVerifiedPlanForUser ?? resolveVerifiedPlanForUser
  const verified = await resolve(args.userId, {
    env,
    billingEnvironment: runtime.config.environment,
  })

  const eligibility = evaluateCheckoutEligibility(verified, price.planId)
  if (!eligibility.ok) {
    return {
      ok: false,
      status: eligibility.status,
      code: eligibility.code,
      error: eligibility.error,
    }
  }

  const origin = resolveTrustedAppOrigin(env)
  if (!origin) {
    return {
      ok: false,
      status: 503,
      code: 'billing_configuration_error',
      error: 'Billing configuration error.',
      detail: 'app_origin_missing',
    }
  }

  const findCustomer = args.findStripeCustomerIdForUser ?? findStripeCustomerIdForUser
  const customerLookup = await findCustomer(args.userId, runtime.config.environment)
  if (customerLookup.error) {
    return {
      ok: false,
      status: 503,
      code: 'subscription_lookup_unavailable',
      error: 'Subscription service temporarily unavailable. Retry shortly.',
    }
  }

  const metadata = {
    shinkaido_user_id: args.userId,
    target_plan: price.planId,
    billing_environment: runtime.config.environment,
  }

  try {
    /** @type {Stripe.Checkout.SessionCreateParams} */
    const params = {
      mode: 'subscription',
      client_reference_id: args.userId,
      line_items: [{ price: price.priceId, quantity: 1 }],
      success_url: `${origin}/?plans=1&checkout=success`,
      cancel_url: `${origin}/?plans=1&checkout=canceled`,
      metadata,
      subscription_data: {
        metadata,
      },
    }

    if (customerLookup.customerId) {
      params.customer = customerLookup.customerId
    } else {
      params.customer_creation = 'always'
    }

    const session = await runtime.stripe.checkout.sessions.create(params)
    if (!session.url) {
      return {
        ok: false,
        status: 502,
        code: 'checkout_creation_failed',
        error: 'Unable to start checkout. Retry shortly.',
      }
    }

    return {
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      targetPlan: price.planId,
    }
  } catch (err) {
    void err
    return {
      ok: false,
      status: 502,
      code: 'checkout_creation_failed',
      error: 'Unable to start checkout. Retry shortly.',
    }
  }
}

/**
 * Map Stripe subscription.status → ShinkAIdo status (conservative).
 *
 * @param {string | null | undefined} stripeStatus
 * @param {{ cancelAtPeriodEnd?: boolean, periodEndMs?: number | null, nowMs?: number }} [opts]
 * @returns {SubscriptionStatus | null} null = do not grant / skip apply
 */
export function mapStripeSubscriptionStatus(stripeStatus, opts = {}) {
  const status = typeof stripeStatus === 'string' ? stripeStatus.trim().toLowerCase() : ''
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now()
  const periodEndMs =
    typeof opts.periodEndMs === 'number' && Number.isFinite(opts.periodEndMs)
      ? opts.periodEndMs
      : null

  if (status === 'trialing') return 'trialing'
  if (status === 'active') return 'active'
  if (status === 'past_due') return 'past_due'
  if (status === 'unpaid') return 'past_due'
  if (status === 'canceled') {
    if (periodEndMs != null && periodEndMs > nowMs) return 'canceled'
    return 'expired'
  }
  if (status === 'incomplete') return null
  if (status === 'incomplete_expired') return 'expired'
  if (status === 'paused') return null
  return null
}

/**
 * @param {Stripe.Subscription} subscription
 * @returns {string | null}
 */
export function extractSubscriptionPriceId(subscription) {
  const item = subscription.items?.data?.[0]
  const price = item?.price
  if (price && typeof price === 'object' && typeof price.id === 'string') return price.id
  if (typeof item?.price === 'string') return item.price
  return null
}

/**
 * Stripe API 2026+ stores period on subscription items (not subscription root).
 *
 * @param {Stripe.Subscription} subscription
 * @returns {{ start: number | null, end: number | null }}
 */
export function extractSubscriptionPeriodUnix(subscription) {
  const item = subscription.items?.data?.[0]
  const start =
    typeof item?.current_period_start === 'number'
      ? item.current_period_start
      : typeof /** @type {{ current_period_start?: number }} */ (subscription).current_period_start ===
          'number'
        ? /** @type {{ current_period_start: number }} */ (subscription).current_period_start
        : null
  const end =
    typeof item?.current_period_end === 'number'
      ? item.current_period_end
      : typeof /** @type {{ current_period_end?: number }} */ (subscription).current_period_end ===
          'number'
        ? /** @type {{ current_period_end: number }} */ (subscription).current_period_end
        : null
  return { start, end }
}

/**
 * @param {number | null | undefined} unix
 * @returns {string | null}
 */
function unixToIso(unix) {
  if (typeof unix !== 'number' || !Number.isFinite(unix)) return null
  return new Date(unix * 1000).toISOString()
}

/**
 * Resolve ShinkAIdo user id from Stripe objects.
 *
 * @param {...({
 *   metadata?: Stripe.Metadata | null
 *   client_reference_id?: string | null
 * } | null | undefined)} sources
 * @returns {string | null}
 */
export function extractShinkaidoUserId(...sources) {
  for (const source of sources) {
    if (!source) continue
    const meta = source.metadata
    if (meta && typeof meta.shinkaido_user_id === 'string') {
      const id = meta.shinkaido_user_id.trim()
      if (id) return id
    }
    if (typeof source.client_reference_id === 'string') {
      const id = source.client_reference_id.trim()
      if (id) return id
    }
  }
  return null
}

/**
 * @param {Stripe.Invoice} invoice
 * @returns {string | null}
 */
export function extractInvoiceSubscriptionId(invoice) {
  const direct = /** @type {{ subscription?: string | { id?: string } | null }} */ (invoice)
    .subscription
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (direct && typeof direct === 'object' && typeof direct.id === 'string') return direct.id

  const parent = /** @type {{ parent?: { subscription_details?: { subscription?: string } } }} */ (
    invoice
  ).parent
  const fromParent = parent?.subscription_details?.subscription
  if (typeof fromParent === 'string' && fromParent.trim()) return fromParent.trim()
  return null
}

/**
 * Build BillingEventInput from a Stripe Subscription (+ event envelope).
 *
 * @param {{
 *   event: Stripe.Event
 *   subscription: Stripe.Subscription
 *   config: StripeBillingConfig
 *   userId: string
 * }} args
 */
export function billingEventFromStripeSubscription(args) {
  const { event, subscription, config, userId } = args
  const priceId = extractSubscriptionPriceId(subscription)
  if (!priceId || !mapStripePriceToPlanId(config, priceId)) {
    return { ok: false, result: 'unknown_product', detail: 'price_unmapped' }
  }

  const period = extractSubscriptionPeriodUnix(subscription)
  const periodEndMs = period.end != null ? period.end * 1000 : null
  const mapped = mapStripeSubscriptionStatus(subscription.status, {
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    periodEndMs,
    nowMs: Date.now(),
  })
  if (!mapped) {
    return { ok: false, result: 'invalid_event', detail: 'status_non_granting' }
  }

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer && typeof subscription.customer === 'object'
        ? subscription.customer.id
        : null

  return {
    ok: true,
    input: {
      provider: 'stripe',
      providerEventId: event.id,
      eventType: event.type,
      eventTimestamp: new Date(event.created * 1000).toISOString(),
      environment: config.environment,
      userId,
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.id,
      providerProductId: priceId,
      status: mapped,
      currentPeriodStart: unixToIso(period.start),
      currentPeriodEnd: unixToIso(period.end),
      graceUntil: null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    },
  }
}

/**
 * Verify webhook signature and apply billing event.
 *
 * @param {{
 *   rawBody: Buffer | string
 *   signature: string
 *   env?: NodeJS.ProcessEnv
 *   stripeRuntime?: ReturnType<typeof getStripeBillingRuntime>
 *   applyBillingEvent?: typeof applyBillingEvent
 *   retrieveSubscription?: (id: string) => Promise<Stripe.Subscription>
 * }} args
 */
export async function handleStripeWebhook(args) {
  const env = args.env ?? process.env
  const runtime = args.stripeRuntime ?? getStripeBillingRuntime(env)
  if (!runtime.ok) {
    return {
      httpStatus: 503,
      body: { error: 'Billing unavailable', code: runtime.code },
      retryable: true,
    }
  }

  let event
  try {
    event = runtime.stripe.webhooks.constructEvent(
      args.rawBody,
      args.signature,
      runtime.config.webhookSecret,
    )
  } catch {
    return {
      httpStatus: 400,
      body: { error: 'Invalid signature', code: 'invalid_stripe_signature' },
      retryable: false,
    }
  }

  if (!STRIPE_HANDLED_EVENTS.includes(event.type)) {
    return {
      httpStatus: 200,
      body: { received: true, ignored: true, type: event.type },
      retryable: false,
    }
  }

  try {
    const apply = args.applyBillingEvent ?? applyBillingEvent
    const productMap = runtime.productMap

    /** @type {string | null} */
    let subscriptionId = null
    /** @type {string | null} */
    let userId = null

    if (event.type === 'checkout.session.completed') {
      const session = /** @type {Stripe.Checkout.Session} */ (event.data.object)
      userId = extractShinkaidoUserId(session)
      const subRef = session.subscription
      subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id || null
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = /** @type {Stripe.Subscription} */ (event.data.object)
      subscriptionId = sub.id
      userId = extractShinkaidoUserId(sub)
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = /** @type {Stripe.Invoice} */ (event.data.object)
      subscriptionId = extractInvoiceSubscriptionId(invoice)
      userId = extractShinkaidoUserId(invoice)
    }

    if (!subscriptionId) {
      return {
        httpStatus: 200,
        body: { received: true, ignored: true, reason: 'no_subscription' },
        retryable: false,
      }
    }

    const retrieve =
      args.retrieveSubscription ??
      ((id) =>
        runtime.stripe.subscriptions.retrieve(id, {
          expand: ['items.data.price'],
        }))

    const subscription = await retrieve(subscriptionId)
    if (!userId) {
      userId = extractShinkaidoUserId(subscription)
    }

    if (!userId) {
      return {
        httpStatus: 200,
        body: { received: true, ignored: true, reason: 'missing_user_id' },
        retryable: false,
      }
    }

    const built = billingEventFromStripeSubscription({
      event,
      subscription,
      config: runtime.config,
      userId,
    })

    if (!built.ok) {
      // Non-granting / unknown product: acknowledge to avoid infinite Stripe retries
      // when status is incomplete/paused; unknown product also ack (logged via apply path).
      if (built.result === 'unknown_product') {
        const outcome = await apply(
          {
            provider: 'stripe',
            providerEventId: event.id,
            eventType: event.type,
            eventTimestamp: new Date(event.created * 1000).toISOString(),
            environment: runtime.config.environment,
            userId,
            providerSubscriptionId: subscription.id,
            providerProductId: extractSubscriptionPriceId(subscription) || 'unknown',
            status: 'expired',
          },
          { productMap },
        )
        // apply will return unknown_product when price unmapped — still 200
        void outcome
        return {
          httpStatus: 200,
          body: { received: true, result: 'unknown_product' },
          retryable: false,
        }
      }
      return {
        httpStatus: 200,
        body: { received: true, ignored: true, reason: built.detail },
        retryable: false,
      }
    }

    const outcome = await apply(built.input, { productMap })
    const result = outcome.result

    if (result === 'storage_error') {
      return {
        httpStatus: 500,
        body: { error: 'storage_error', code: 'storage_error' },
        retryable: true,
      }
    }

    // duplicate / stale / applied / no_change / user_mismatch / user_not_found → 2xx
    // (Stripe should not retry forever for ownership issues; log only)
    return {
      httpStatus: 200,
      body: {
        received: true,
        result,
        planId: outcome.planId || null,
        status: outcome.status || null,
      },
      retryable: false,
    }
  } catch (err) {
    void err
    return {
      httpStatus: 500,
      body: { error: 'webhook_processing_failed', code: 'webhook_processing_failed' },
      retryable: true,
    }
  }
}

/**
 * Read raw request body for Stripe signature verification.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {Promise<Buffer>}
 */
export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8')

  // bodyParser disabled — consume stream
  const chunks = []
  for await (const chunk of /** @type {AsyncIterable<Buffer | string>} */ (req)) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  if (chunks.length > 0) return Buffer.concat(chunks)

  // Already-parsed object (misconfigured) — cannot verify signatures safely
  if (req.body && typeof req.body === 'object') {
    throw new Error('raw_body_unavailable')
  }
  return Buffer.alloc(0)
}
