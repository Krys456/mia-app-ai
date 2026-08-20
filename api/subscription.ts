/**
 * #332D GET /api/subscription — authenticated read of verified plan state.
 * Presentation only. Never grants API entitlements by itself.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { AuthError, requireAuthenticatedUser } from '../lib/server/auth.js'
import { resolveVerifiedPlanForUser } from '../lib/server/subscription-lookup.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
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
