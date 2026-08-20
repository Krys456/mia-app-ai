/**
 * #298A — Paid API guard: verify JWT then durable rate-limit BEFORE OpenAI.
 * #332C — optional entitlement check between auth and rate-limit when a
 * dedicated expensive route passes `entitlement` (tts/files/selection search).
 *
 * Does not trust body.userId / X-LAIfe-User-Id / client planId.
 * Never paywalls Core chat via this guard — chat omits `entitlement`.
 */

import { AuthError, requireAuthenticatedUser } from './auth.js'
import { sendJson } from './http.js'
import { ensureRequestContext } from './request-id.js'
import { consumeRateLimit } from './rate-limit.js'
import { decideRouteEntitlementAsync } from './entitlement-gates.js'

/**
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{
 *   bucket: import('./rate-limit.js').RateLimitBucket
 *   entitlement?: import('./entitlements.js').EntitlementKey | string
 *   requireAuthenticatedUser?: typeof requireAuthenticatedUser
 *   consumeRateLimit?: typeof consumeRateLimit
 *   decideRouteEntitlement?: typeof decideRouteEntitlementAsync
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   enforcementEnabled?: boolean
 *   env?: NodeJS.ProcessEnv
 * }} options
 * @returns {Promise<{ userId: string, isAnonymous: boolean | null } | null>}
 */
export async function requirePaidApiAccess(req, res, options) {
  const authenticate = options.requireAuthenticatedUser ?? requireAuthenticatedUser
  const rateLimit = options.consumeRateLimit ?? consumeRateLimit
  const decideEntitlement = options.decideRouteEntitlement ?? decideRouteEntitlementAsync
  const obs = ensureRequestContext(req, res)

  let verified
  try {
    verified = await authenticate(req)
  } catch (error) {
    if (error instanceof AuthError) {
      console.warn(
        '[paid-api-guard] auth denied',
        JSON.stringify({
          bucket: options.bucket,
          code: error.code,
          requestId: obs.requestId,
        }),
      )
      sendJson(
        res,
        error.status || 401,
        {
          error: error.message,
          code: error.code || 'unauthorized',
        },
        req,
      )
      return null
    }
    throw error
  }

  // #332C/#332D — auth → entitlement (optional; DB only if enforcement ON) → rate-limit.
  if (options.entitlement) {
    const decision = await decideEntitlement({
      userId: verified.userId,
      entitlement: options.entitlement,
      entitlements: options.entitlements,
      enforcementEnabled: options.enforcementEnabled,
      env: options.env,
    })
    if (!decision.allowed) {
      console.warn(
        '[paid-api-guard] entitlement denied',
        JSON.stringify({
          bucket: options.bucket,
          entitlement: options.entitlement,
          reason: decision.reason,
          requestId: obs.requestId,
        }),
      )
      const status = decision.reason === 'lookup_unavailable' ? 503 : 403
      sendJson(res, status, decision.body, req)
      return null
    }
  }

  const limited = await rateLimit({
    userId: verified.userId,
    bucket: options.bucket,
  })

  if ('unavailable' in limited && limited.unavailable) {
    console.error(
      '[paid-api-guard] rate-limit unavailable',
      JSON.stringify({ bucket: options.bucket, requestId: obs.requestId }),
    )
    sendJson(
      res,
      503,
      {
        error: 'Rate limit service unavailable. Retry shortly.',
        code: 'rate_limit_unavailable',
        retryAfter: limited.retryAfter,
      },
      req,
    )
    if (limited.retryAfter > 0) {
      res.setHeader('Retry-After', String(limited.retryAfter))
    }
    return null
  }

  if (!limited.success) {
    console.warn(
      '[paid-api-guard] rate limited',
      JSON.stringify({ bucket: options.bucket, requestId: obs.requestId }),
    )
    if (limited.retryAfter > 0) {
      res.setHeader('Retry-After', String(limited.retryAfter))
    }
    sendJson(
      res,
      429,
      {
        error: 'rate_limit_exceeded',
        code: 'rate_limit_exceeded',
        retryAfter: limited.retryAfter,
      },
      req,
    )
    return null
  }

  return {
    userId: verified.userId,
    isAnonymous: verified.isAnonymous,
  }
}
