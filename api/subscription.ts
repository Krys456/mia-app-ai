/**
 * #332D / #387B / #388B / #388B.1 — Consolidated subscription + Stripe Test Mode.
 *
 * Hobby-safe (still ONE Vercel function):
 * - GET  /api/subscription              → verified plan (+ billing capabilities)
 * - GET  /api/health                    → rewrite → ?probe=public_health
 * - POST /api/subscription              → { action: checkout|portal }
 * - POST /api/stripe/webhook            → rewrite → ?probe=stripe_webhook
 *
 * #388B.1 ROOT CAUSE:
 * This project is Vite + @vercel/node, NOT Next.js Pages. Next.js-only
 * api.bodyParser=false config is ignored here, so application/json is
 * auto-parsed into req.body and the original bytes are discarded.
 * Stripe signs exact bytes → constructEvent fails / raw_body_unavailable.
 *
 * FIX: Web Fetch API handler. `await request.text()` yields exact raw bytes
 * for application/json (and every other content-type). Checkout/portal parse
 * JSON from that same string after the webhook path branches off.
 *
 * ENTITLEMENT_ENFORCEMENT_ENABLED is NOT changed here (must remain OFF).
 */

import { AuthError, requireAuthenticatedUser } from '../lib/server/auth.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import {
  fetchSubscriptionsForUser,
  resolveVerifiedPlanForUser,
} from '../lib/server/subscription-lookup.js'
import { logApiEvent, safeErrorSnippet } from '../lib/server/safe-log.js'
import {
  buildPublicHealthPayload,
  isPublicHealthProbe,
} from '../lib/server/worker-health.js'
import { parseJsonFromRawBody } from '../lib/server/raw-body.js'
import {
  resolveStripePublicCapabilities,
  resolveBillingEnvironment,
} from '../lib/server/stripe-config.js'
import {
  createCheckoutSession,
  createPortalSession,
  findOwnedStripeCustomerId,
} from '../lib/server/stripe-billing.js'
import {
  handleStripeWebhook,
  isStripeWebhookProbe,
} from '../lib/server/stripe-webhook.js'
import { getServiceSupabase } from '../lib/server/supabase.js'
import {
  createWebRequestShim,
  rawBodyFromWebRequest,
  webCorsPreflight,
  webJson,
} from '../lib/server/web-request.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

/**
 * Web Fetch API entry — required for exact Stripe raw body bytes.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default async function handler(request: Request): Promise<Response> {
  const req = createWebRequestShim(request)
  const obs = ensureRequestContext(req)

  if (request.method === 'OPTIONS') {
    return webCorsPreflight(req)
  }

  // #387B public liveness (unauthenticated). Must run before auth / body read.
  if (isPublicHealthProbe(req)) {
    if (request.method !== 'GET') {
      return webJson(
        405,
        { error: 'Method not allowed', code: 'method_not_allowed' },
        req,
        { Allow: 'GET, OPTIONS' },
      )
    }
    const body = buildPublicHealthPayload(process.env)
    logApiEvent({
      route: '/api/health',
      code: 'health_ok',
      ok: true,
      requestId: obs.requestId,
      environment: body.environment,
      buildId: body.buildId,
    })
    return webJson(200, body, req, { 'Cache-Control': 'no-store' })
  }

  // Read body ONCE as exact raw bytes (works for application/json).
  /** @type {Buffer | null} */
  let rawBody: Buffer | null = null
  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
    try {
      rawBody = await rawBodyFromWebRequest(request)
    } catch (error) {
      console.error('[api/subscription] raw body read failed:', safeErrorSnippet(error))
      return webJson(
        400,
        { error: 'Invalid request body', code: 'raw_body_read_failed' },
        req,
      )
    }
  }

  // #388B Stripe webhook (unauthenticated; signature is the auth).
  if (isStripeWebhookProbe(req)) {
    if (request.method !== 'POST') {
      return webJson(
        405,
        { error: 'Method not allowed', code: 'method_not_allowed' },
        req,
        { Allow: 'POST, OPTIONS' },
      )
    }
    return handleWebhookPost(req, rawBody || Buffer.alloc(0), obs.requestId)
  }

  if (request.method === 'POST') {
    return handleBillingActionPost(req, rawBody || Buffer.alloc(0), obs.requestId)
  }

  if (request.method !== 'GET') {
    return webJson(
      405,
      { error: 'Method not allowed', code: 'method_not_allowed' },
      req,
      { Allow: 'GET, POST, OPTIONS' },
    )
  }

  let userId: string
  try {
    const verified = await requireAuthenticatedUser(req)
    userId = verified.userId
  } catch (error) {
    if (error instanceof AuthError) {
      return webJson(
        error.status || 401,
        { error: error.message, code: error.code || 'unauthorized' },
        req,
      )
    }
    throw error
  }

  try {
    const verified = await resolveVerifiedPlanForUser(userId)
    if (verified.lookupError) {
      return webJson(
        503,
        {
          error: 'Subscription service temporarily unavailable. Retry shortly.',
          code: 'subscription_lookup_unavailable',
        },
        req,
      )
    }

    const caps = resolveStripePublicCapabilities(process.env)

    return webJson(
      200,
      {
        planId: verified.publicView.planId,
        status: verified.publicView.status,
        currentPeriodEnd: verified.publicView.currentPeriodEnd,
        cancelAtPeriodEnd: verified.publicView.cancelAtPeriodEnd,
        provider: verified.publicView.provider,
        resolution: verified.publicView.resolution,
        billing: {
          enabled: caps.billingEnabled,
          checkoutEnabled: caps.checkoutEnabled,
          portalEnabled: caps.portalEnabled,
          mode: caps.mode,
        },
      },
      req,
    )
  } catch (error) {
    console.error('[api/subscription] failed:', safeErrorSnippet(error))
    return webJson(
      503,
      {
        error: 'Subscription service temporarily unavailable. Retry shortly.',
        code: 'subscription_lookup_unavailable',
      },
      req,
    )
  }
}

async function handleWebhookPost(
  req: ReturnType<typeof createWebRequestShim>,
  rawBody: Buffer,
  requestId: string,
): Promise<Response> {
  const started = Date.now()
  try {
    const signature =
      typeof req.headers['stripe-signature'] === 'string'
        ? req.headers['stripe-signature']
        : typeof req.headers['Stripe-Signature'] === 'string'
          ? req.headers['Stripe-Signature']
          : ''

    const result = await handleStripeWebhook({
      rawBody,
      signature,
      env: process.env,
    })

    logApiEvent({
      route: '/api/stripe/webhook',
      code: result.code,
      ok: result.ok,
      requestId,
      durationMs: Date.now() - started,
      applyResult: 'applyResult' in result ? result.applyResult : undefined,
      planId: 'planId' in result ? result.planId : undefined,
      status: 'status' in result ? result.status : undefined,
    })

    if (!result.ok) {
      return webJson(
        result.httpStatus || 400,
        { error: 'Webhook rejected', code: result.code },
        req,
      )
    }

    return webJson(200, { received: true, code: result.code }, req)
  } catch (error) {
    console.error('[api/stripe/webhook] failed:', safeErrorSnippet(error), requestId)
    logApiEvent({
      route: '/api/stripe/webhook',
      code: 'webhook_handler_error',
      ok: false,
      requestId,
      durationMs: Date.now() - started,
    })
    return webJson(
      500,
      { error: 'Webhook processing failed', code: 'webhook_handler_error' },
      req,
    )
  }
}

async function handleBillingActionPost(
  req: ReturnType<typeof createWebRequestShim>,
  rawBody: Buffer,
  requestId: string,
): Promise<Response> {
  const started = Date.now()
  let body: Record<string, unknown> = {}
  try {
    body = parseJsonFromRawBody(rawBody)
  } catch {
    return webJson(400, { error: 'Invalid request body', code: 'invalid_json' }, req)
  }

  // Reject client ownership / price spoofing fields.
  if (
    'priceId' in body ||
    'price_id' in body ||
    'stripePriceId' in body ||
    'customerId' in body ||
    'customer_id' in body ||
    'stripeCustomerId' in body ||
    'userId' in body ||
    'user_id' in body
  ) {
    return webJson(
      400,
      { error: 'Disallowed billing field', code: 'billing_field_rejected' },
      req,
    )
  }

  let verified: Awaited<ReturnType<typeof requireAuthenticatedUser>>
  try {
    verified = await requireAuthenticatedUser(req)
  } catch (error) {
    if (error instanceof AuthError) {
      return webJson(
        error.status || 401,
        { error: error.message, code: error.code || 'unauthorized' },
        req,
      )
    }
    throw error
  }

  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  const originHeader =
    (typeof req.headers.origin === 'string' && req.headers.origin.trim()) ||
    (typeof req.headers.Origin === 'string' && req.headers.Origin.trim()) ||
    null

  if (action === 'checkout') {
    try {
      let existingCustomerId: string | null = null
      try {
        const supabase = await getServiceSupabase()
        const { rows } = await fetchSubscriptionsForUser(supabase, verified.userId)
        existingCustomerId = findOwnedStripeCustomerId(
          rows as any,
          resolveBillingEnvironment(process.env),
        )
      } catch {
        existingCustomerId = null
      }

      const result = await createCheckoutSession({
        userId: verified.userId,
        durable: verified.durable === true,
        planId: body.planId,
        email: verified.email,
        existingCustomerId,
        requestOrigin: originHeader,
        env: process.env,
      })

      logApiEvent({
        route: '/api/subscription',
        code: result.ok ? 'stripe_checkout_created' : 'stripe_checkout_failed',
        ok: result.ok,
        requestId,
        durationMs: Date.now() - started,
        planId: result.ok ? result.planId : typeof body.planId === 'string' ? body.planId : undefined,
        errorCode: result.ok ? undefined : result.code,
      })

      if (!result.ok) {
        return webJson(
          result.status || 400,
          {
            error: mapBillingErrorMessage(result.code),
            code: result.code,
          },
          req,
        )
      }

      return webJson(
        200,
        {
          ok: true,
          action: 'checkout',
          url: result.url,
          planId: result.planId,
          code: 'checkout_created',
        },
        req,
      )
    } catch (error) {
      console.error('[api/subscription] checkout failed:', safeErrorSnippet(error), requestId)
      logApiEvent({
        route: '/api/subscription',
        code: 'stripe_checkout_failed',
        ok: false,
        requestId,
        durationMs: Date.now() - started,
      })
      return webJson(
        503,
        { error: 'Checkout unavailable. Retry shortly.', code: 'checkout_failed' },
        req,
      )
    }
  }

  if (action === 'portal') {
    try {
      const supabase = await getServiceSupabase()
      const { rows } = await fetchSubscriptionsForUser(supabase, verified.userId)
      const ownedCustomerId = findOwnedStripeCustomerId(
        rows as any,
        resolveBillingEnvironment(process.env),
      )

      const result = await createPortalSession({
        userId: verified.userId,
        durable: verified.durable === true,
        customerId: body.customerId,
        ownedCustomerId,
        requestOrigin: originHeader,
        env: process.env,
      })

      logApiEvent({
        route: '/api/subscription',
        code: result.ok ? 'stripe_portal_created' : 'stripe_portal_failed',
        ok: result.ok,
        requestId,
        durationMs: Date.now() - started,
        errorCode: result.ok ? undefined : result.code,
      })

      if (!result.ok) {
        return webJson(
          result.status || 400,
          {
            error: mapBillingErrorMessage(result.code),
            code: result.code,
          },
          req,
        )
      }

      return webJson(
        200,
        {
          ok: true,
          action: 'portal',
          url: result.url,
          code: 'portal_created',
        },
        req,
      )
    } catch (error) {
      console.error('[api/subscription] portal failed:', safeErrorSnippet(error), requestId)
      return webJson(
        503,
        { error: 'Billing portal unavailable. Retry shortly.', code: 'portal_failed' },
        req,
      )
    }
  }

  return webJson(
    400,
    { error: 'Unknown billing action', code: 'billing_action_unknown' },
    req,
  )
}

function mapBillingErrorMessage(code: string): string {
  switch (code) {
    case 'not_durable':
      return 'Collega un account permanente prima di acquistare.'
    case 'plan_not_purchasable':
    case 'plan_unknown':
    case 'plan_required':
      return 'Piano non valido per l’acquisto.'
    case 'stripe_billing_disabled':
    case 'stripe_blocked_on_production':
    case 'stripe_live_key_forbidden':
      return 'Pagamenti non disponibili in questo ambiente.'
    case 'no_billing_customer':
      return 'Nessun abbonamento da gestire.'
    case 'customer_id_not_accepted':
      return 'Campo non consentito.'
    case 'stripe_portal_disabled':
      return 'Portale di fatturazione non disponibile.'
    default:
      return 'Operazione di fatturazione non disponibile. Riprova tra poco.'
  }
}
