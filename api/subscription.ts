/**
 * #332D GET /api/subscription — authenticated read of verified plan state.
 * Presentation only. Never grants API entitlements by itself.
 *
 * #387B — also serves public GET /api/health via vercel rewrite
 * (`/api/health` → `/api/subscription?probe=public_health`) so we stay
 * within the Vercel Hobby 12-function limit (no extra serverless file).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { AuthError, requireAuthenticatedUser } from '../lib/server/auth.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import { resolveVerifiedPlanForUser } from '../lib/server/subscription-lookup.js'
import { logApiEvent, safeErrorSnippet } from '../lib/server/safe-log.js'
import {
  buildPublicHealthPayload,
  isPublicHealthProbe,
} from '../lib/server/worker-health.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
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

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS')
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
