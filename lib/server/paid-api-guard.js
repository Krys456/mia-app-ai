/**
 * #298A — Paid API guard: verify JWT then durable rate-limit BEFORE OpenAI.
 *
 * Does not trust body.userId / X-LAIfe-User-Id.
 */

import { AuthError, requireAuthenticatedUser } from './auth.js'
import { sendJson } from './http.js'
import { ensureRequestContext } from './request-id.js'
import { consumeRateLimit } from './rate-limit.js'

/**
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{
 *   bucket: import('./rate-limit.js').RateLimitBucket
 *   requireAuthenticatedUser?: typeof requireAuthenticatedUser
 *   consumeRateLimit?: typeof consumeRateLimit
 * }} options
 * @returns {Promise<{ userId: string, isAnonymous: boolean | null } | null>}
 */
export async function requirePaidApiAccess(req, res, options) {
  const authenticate = options.requireAuthenticatedUser ?? requireAuthenticatedUser
  const rateLimit = options.consumeRateLimit ?? consumeRateLimit
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
