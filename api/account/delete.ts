/**
 * POST /api/account/delete — #386C account deletion + full user-data erasure.
 *
 * - JWT required; user id derived only from verified auth
 * - Rejects client-supplied user_id / userId
 * - Service-role used only server-side
 * - Idempotent / retryable via account_deletion_jobs
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { AuthError, requireAuthenticatedUser } from '../../lib/server/auth.js'
import {
  rejectClientTargetUserId,
  runAccountDeletion,
} from '../../lib/server/account-deletion.js'
import { isAccountDeletionEnabled } from '../../lib/server/account-deletion-enabled.js'
import {
  applyCors,
  parseJsonBody,
  sendCorsPreflight,
  sendJson,
} from '../../lib/server/http.js'
import { ensureRequestContext } from '../../lib/server/request-id.js'
import { consumeRateLimit } from '../../lib/server/rate-limit.js'
import { safeErrorSnippet } from '../../lib/server/safe-log.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)
  const obs = ensureRequestContext(req as any, res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method_not_allowed' }, req)
  }

  if (!isAccountDeletionEnabled()) {
    return sendJson(
      res,
      404,
      { error: 'Account deletion unavailable', code: 'account_deletion_disabled' },
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
    console.error('[api/account/delete] auth error', safeErrorSnippet(error), obs.requestId)
    return sendJson(res, 401, { error: 'unauthorized', code: 'unauthorized' }, req)
  }

  const limited = await consumeRateLimit({
    userId: verified.userId,
    bucket: 'account_delete',
  })
  if ('unavailable' in limited && limited.unavailable) {
    return sendJson(
      res,
      503,
      {
        error: 'Rate limit service unavailable. Retry shortly.',
        code: 'rate_limit_unavailable',
        retryAfter: limited.retryAfter,
      },
      req,
    )
  }
  if (!limited.success) {
    if (limited.retryAfter > 0) {
      res.setHeader('Retry-After', String(limited.retryAfter))
    }
    return sendJson(
      res,
      429,
      {
        error: 'Too many deletion attempts. Retry later.',
        code: 'rate_limit_exceeded',
        retryAfter: limited.retryAfter,
      },
      req,
    )
  }

  let body: Record<string, unknown> = {}
  try {
    const parsed = parseJsonBody(req)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    return sendJson(res, 400, { error: 'invalid_json', code: 'invalid_json' }, req)
  }

  const url = new URL(req.url || '/', 'http://localhost')
  const spoof = rejectClientTargetUserId(body, url.searchParams)
  if (spoof.rejected) {
    return sendJson(
      res,
      400,
      { error: 'user_id_not_accepted', code: spoof.code },
      req,
    )
  }

  // Confirmation token is client UX only; server trusts authenticated intent.
  // Still require an explicit confirm flag to reduce accidental calls.
  const confirm = body.confirm
  if (confirm !== true && confirm !== 'ELIMINA' && confirm !== 'DELETE') {
    return sendJson(
      res,
      400,
      {
        error: 'Explicit confirmation required',
        code: 'confirmation_required',
      },
      req,
    )
  }

  console.info(
    '[api/account/delete] start',
    JSON.stringify({ requestId: obs.requestId, job: 'account_deletion' }),
  )

  const result = await runAccountDeletion({
    userId: verified.userId,
    accessToken: verified.accessToken,
  })

  if (!result.ok) {
    const status = typeof result.status === 'number' ? result.status : 500
    console.warn(
      '[api/account/delete] incomplete',
      JSON.stringify({
        requestId: obs.requestId,
        code: result.code,
        detailCode: 'detailCode' in result ? result.detailCode : undefined,
        retryable: 'retryable' in result ? result.retryable : false,
      }),
    )
    return sendJson(
      res,
      status,
      {
        error:
          result.code === 'account_deletion_disabled'
            ? 'Account deletion unavailable'
            : 'Eliminazione non completata. Puoi riprovare.',
        code: result.code,
        retryable: 'retryable' in result ? Boolean(result.retryable) : status >= 500,
        jobId: 'jobId' in result ? result.jobId : undefined,
      },
      req,
    )
  }

  console.info(
    '[api/account/delete] ok',
    JSON.stringify({
      requestId: obs.requestId,
      code: result.code,
      alreadyCompleted: result.alreadyCompleted,
    }),
  )

  return sendJson(
    res,
    200,
    {
      ok: true,
      code: result.code,
      alreadyCompleted: Boolean(result.alreadyCompleted),
      jobId: result.jobId,
    },
    req,
  )
}
