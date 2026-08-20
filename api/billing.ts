/**
 * #332E3A — Consolidated billing route (Hobby function budget).
 *
 * POST + Stripe-Signature → webhook (raw body, verify, applyBillingEvent)
 * POST + Authorization → authenticated actions (create_checkout)
 *
 * Lazy Stripe config: Core chat still deploys without Stripe env vars.
 * Enforcement remains OFF. TEST MODE / sandbox only for Preview.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, parseJsonBody, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { AuthError, requireAuthenticatedUser } from '../lib/server/auth.js'
import { requireDurableIdentity } from '../lib/server/durable-identity.js'
import {
  createCheckoutSessionForUser,
  handleStripeWebhook,
  readRawBody,
} from '../lib/server/stripe-billing.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
  // Required for Stripe signature verification (raw body).
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

async function parseActionBody(
  req: VercelRequest,
  rawBody: Buffer,
): Promise<Record<string, unknown>> {
  if (rawBody.length > 0) {
    const text = rawBody.toString('utf8').trim()
    if (!text) return {}
    return JSON.parse(text) as Record<string, unknown>
  }
  // Fallback if platform already parsed (should not happen with bodyParser:false)
  try {
    return parseJsonBody(req) as Record<string, unknown>
  } catch {
    return {}
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Webhooks are server-to-server — still apply CORS for browser actions.
  const signature = readHeader(req.headers, 'stripe-signature')
  const isWebhook = Boolean(signature) && req.method === 'POST'

  if (!isWebhook) {
    applyCors(res, req)
  }

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method_not_allowed' }, req)
  }

  // —— Stripe webhook ——
  if (isWebhook) {
    let rawBody: Buffer
    try {
      rawBody = await readRawBody(req)
    } catch (error) {
      console.error('[api/billing] raw_body_failed', safeErrorSnippet(error))
      return sendJson(
        res,
        400,
        { error: 'Invalid webhook body', code: 'invalid_stripe_signature' },
        req,
      )
    }

    const result = await handleStripeWebhook({
      rawBody,
      signature,
    })

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(result.httpStatus).json(result.body)
  }

  // —— Authenticated billing actions ——
  let rawBody: Buffer
  try {
    rawBody = await readRawBody(req)
  } catch (error) {
    console.error('[api/billing] action_body_failed', safeErrorSnippet(error))
    return sendJson(res, 400, { error: 'Invalid request body', code: 'invalid_request' }, req)
  }

  let body: Record<string, unknown>
  try {
    body = await parseActionBody(req, rawBody)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_request' }, req)
  }

  let verified
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

  const durable = requireDurableIdentity(verified.user)
  if (!durable.ok) {
    return sendJson(
      res,
      403,
      { error: 'durable_identity_required', code: 'durable_identity_required' },
      req,
    )
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''

  if (action === 'create_checkout') {
    // Ignore any client-supplied priceId / plan claims other than targetPlan.
    void body.priceId
    void body.stripePriceId
    void body.planId

    const result = await createCheckoutSessionForUser({
      user: verified.user,
      userId: verified.userId,
      targetPlan: body.targetPlan,
    })

    if (!result.ok) {
      return sendJson(
        res,
        result.status ?? 503,
        {
          error: result.error,
          code: result.code,
        },
        req,
      )
    }

    return sendJson(
      res,
      200,
      {
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
        targetPlan: result.targetPlan,
      },
      req,
    )
  }

  return sendJson(
    res,
    400,
    { error: 'Unknown billing action', code: 'invalid_request' },
    req,
  )
}
