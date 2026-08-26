/**
 * #332D / #387B / #388B — Consolidated subscription + Stripe Test Mode surface.
 *
 * Hobby-safe (still ONE Vercel function):
 * - GET  /api/subscription              → verified plan (+ billing capabilities)
 * - GET  /api/health                    → rewrite → ?probe=public_health
 * - POST /api/subscription              → { action: checkout|portal }
 * - POST /api/stripe/webhook            → rewrite → ?probe=stripe_webhook
 *
 * bodyParser disabled so Stripe webhook signature uses exact raw bytes.
 * Checkout/portal JSON is parsed from the same raw body.
 *
 * ENTITLEMENT_ENFORCEMENT_ENABLED is NOT changed here (must remain OFF).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { AuthError, requireAuthenticatedUser } from '../lib/server/auth.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import { resolveVerifiedPlanForUser } from '../lib/server/subscription-lookup.js'
import { fetchSubscriptionsForUser } from '../lib/server/subscription-lookup.js'
import { logApiEvent, safeErrorSnippet } from '../lib/server/safe-log.js'
import {
  buildPublicHealthPayload,
  isPublicHealthProbe,
} from '../lib/server/worker-health.js'
import { parseJsonFromRawBody, readRawBody } from '../lib/server/raw-body.js'
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

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
  api: {
    bodyParser: false,
  },
}

function readHeader(
  headers: VercelRequest['headers'] | undefined,
  name: string,
): string {
  if (!headers) return ''
  const target = name.toLowerCase()
  for (const [key, raw] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
    return ''
  }
  return ''
}

function requestOrigin(req: VercelRequest): string | null {
  const origin = readHeader(req.headers, 'origin').trim()
  return origin || null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)
  const obs = ensureRequestContext(req as any, res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  // #387B public liveness (unauthenticated). Must run before auth.
  if (isPublicHealthProbe(req)) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS')
      return sendJson(
        res,
        405,
        { error: 'Method not allowed', code: 'method_not_allowed' },
        req,
      )
    }
    res.setHeader('Cache-Control', 'no-store')
    const body = buildPublicHealthPayload(process.env)
    logApiEvent({
      route: '/api/health',
      code: 'health_ok',
      ok: true,
      requestId: obs.requestId,
      environment: body.environment,
      buildId: body.buildId,
    })
    return sendJson(res, 200, body, req)
  }

  // #388B Stripe webhook (unauthenticated; signature is the auth).
  if (isStripeWebhookProbe(req)) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      return sendJson(
        res,
        405,
        { error: 'Method not allowed', code: 'method_not_allowed' },
        req,
      )
    }
    return handleWebhookPost(req, res, obs.requestId)
  }

  if (req.method === 'POST') {
    return handleBillingActionPost(req, res, obs.requestId)
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method_not_allowed' }, req)
  }

  let userId: string
  try {
    const verified = await requireAuthenticatedUser(req)
    userId = verified.userId
  } catch (error) {
    if (error instanceof AuthError) {
      return sendJson(
        res,
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
      return sendJson(
        res,
        503,
        {
          error: 'Subscription service temporarily unavailable. Retry shortly.',
          code: 'subscription_lookup_unavailable',
        },
        req,
      )
    }

    const caps = resolveStripePublicCapabilities(process.env)

    return sendJson(
      res,
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
    return sendJson(
      res,
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
  req: VercelRequest,
  res: VercelResponse,
  requestId: string,
) {
  const started = Date.now()
  try {
    const rawBody = await readRawBody(req as any)
    const signature = readHeader(req.headers, 'stripe-signature')
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
      return sendJson(
        res,
        result.httpStatus || 400,
        { error: 'Webhook rejected', code: result.code },
        req,
      )
    }

    return sendJson(
      res,
      200,
      { received: true, code: result.code },
      req,
    )
  } catch (error) {
    console.error('[api/stripe/webhook] failed:', safeErrorSnippet(error), requestId)
    logApiEvent({
      route: '/api/stripe/webhook',
      code: 'webhook_handler_error',
      ok: false,
      requestId,
      durationMs: Date.now() - started,
    })
    return sendJson(
      res,
      500,
      { error: 'Webhook processing failed', code: 'webhook_handler_error' },
      req,
    )
  }
}

async function handleBillingActionPost(
  req: VercelRequest,
  res: VercelResponse,
  requestId: string,
) {
  const started = Date.now()
  let body: Record<string, unknown> = {}
  try {
    const raw = await readRawBody(req as any)
    body = parseJsonFromRawBody(raw)
  } catch (error) {
    const code =
      error && typeof error === 'object' && (error as any).code === 'raw_body_unavailable'
        ? 'raw_body_unavailable'
        : 'invalid_json'
    return sendJson(res, 400, { error: 'Invalid request body', code }, req)
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
    return sendJson(
      res,
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
      return sendJson(
        res,
        error.status || 401,
        { error: error.message, code: error.code || 'unauthorized' },
        req,
      )
    }
    throw error
  }

  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  const origin = requestOrigin(req)

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
        requestOrigin: origin,
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
        const status = result.status || 400
        return sendJson(
          res,
          status,
          {
            error: mapBillingErrorMessage(result.code),
            code: result.code,
          },
          req,
        )
      }

      return sendJson(
        res,
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
      return sendJson(
        res,
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
        requestOrigin: origin,
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
        return sendJson(
          res,
          result.status || 400,
          {
            error: mapBillingErrorMessage(result.code),
            code: result.code,
          },
          req,
        )
      }

      return sendJson(
        res,
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
      return sendJson(
        res,
        503,
        { error: 'Billing portal unavailable. Retry shortly.', code: 'portal_failed' },
        req,
      )
    }
  }

  return sendJson(
    res,
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
