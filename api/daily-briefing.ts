/**
 * #321 /api/daily-briefing — authenticated Calendar + Reminders pack.
 * Weather composed client-side via #317 (no silent GPS).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireMemoryApiUser } from '../lib/server/memory-api-auth.js'
import { buildDailyBriefingServerPayload } from '../lib/server/daily-briefing/orchestrate.js'
import {
  applyCors,
  parseJsonBody,
  sendCorsPreflight,
  sendJson,
} from '../lib/server/http.js'
import { consumeRateLimit } from '../lib/server/rate-limit.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 20,
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

  const user = await requireMemoryApiUser(req, res)
  if (!user) return

  const limited = await consumeRateLimit({ userId: user.userId, bucket: 'reminders' })
  if ('unavailable' in limited && limited.unavailable) {
    if (limited.retryAfter > 0) res.setHeader('Retry-After', String(limited.retryAfter))
    return sendJson(
      res,
      503,
      { error: 'Rate limit unavailable', code: 'rate_limit_unavailable', requestId: obs.requestId },
      req,
    )
  }
  if (!limited.success) {
    if (limited.retryAfter > 0) res.setHeader('Retry-After', String(limited.retryAfter))
    return sendJson(
      res,
      429,
      { error: 'rate_limit_exceeded', code: 'rate_limit_exceeded', requestId: obs.requestId },
      req,
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (parseJsonBody(req) as Record<string, unknown>) || {}
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' }, req)
  }

  const timeZone = typeof body.timeZone === 'string' ? body.timeZone : ''
  const target = body.target === 'tomorrow' ? 'tomorrow' : 'today'
  const language = body.language === 'en' ? 'en' : 'it'

  try {
    const payload = await buildDailyBriefingServerPayload({
      userId: user.userId,
      timeZone,
      target,
      language,
    })

    return sendJson(
      res,
      200,
      {
        ...payload,
        requestId: obs.requestId,
      },
      req,
    )
  } catch (err) {
    console.warn(
      '[daily-briefing]',
      JSON.stringify({
        route: 'daily-briefing-action',
        requestId: obs.requestId,
        error: safeErrorSnippet(err),
      }),
    )
    return sendJson(
      res,
      500,
      {
        status: 'error',
        failureCode: 'server_error',
        requestId: obs.requestId,
        calendar: { status: 'error', items: [] },
        reminders: { status: 'error', overdue: [], today: [] },
        weather: { status: 'unavailable' },
      },
      req,
    )
  }
}
