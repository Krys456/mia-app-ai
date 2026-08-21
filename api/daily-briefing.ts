/**
 * #321/#334D1/#336B /api/daily-briefing
 * - POST (default): authenticated Calendar + Reminders pack
 * - POST action morning_schedule_*: schedule CRUD (no new Vercel function)
 * - POST action calendar_query: read-only Calendar chat pack (#336B; no new Vercel function)
 * - GET ?morning_schedule=1: fetch schedule
 *
 * Weather composed client-side via #317 (no silent GPS).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireMemoryApiUser } from '../lib/server/memory-api-auth.js'
import { buildDailyBriefingServerPayload } from '../lib/server/daily-briefing/orchestrate.js'
import { runCalendarQuery } from '../lib/server/daily-briefing/calendar-query.js'
import {
  disableMorningBriefingSchedule,
  getMorningBriefingSchedule,
  morningBriefingScheduleOwnerScope,
  upsertMorningBriefingSchedule,
} from '../lib/server/morning-briefing-schedule.js'
import { sanitizeTimeZone } from '../lib/server/calendar-normalize.js'
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

function queryFlag(req: VercelRequest, key: string): boolean {
  const raw = req.query[key]
  if (raw === '1' || raw === 'true') return true
  if (Array.isArray(raw) && (raw[0] === '1' || raw[0] === 'true')) return true
  return false
}

function isMorningScheduleAction(
  action: unknown,
): action is 'morning_schedule_get' | 'morning_schedule_upsert' | 'morning_schedule_disable' {
  return (
    action === 'morning_schedule_get' ||
    action === 'morning_schedule_upsert' ||
    action === 'morning_schedule_disable'
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)
  const obs = ensureRequestContext(req as any, res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
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

  const scope = morningBriefingScheduleOwnerScope(user.userId)

  // --- #334D1 schedule get ---
  if (req.method === 'GET' && queryFlag(req, 'morning_schedule')) {
    try {
      const schedule = await getMorningBriefingSchedule(scope)
      return sendJson(res, 200, { schedule, requestId: obs.requestId }, req)
    } catch (err) {
      console.warn(
        '[daily-briefing]',
        JSON.stringify({
          route: 'morning-schedule-get',
          requestId: obs.requestId,
          error: safeErrorSnippet(err),
        }),
      )
      return sendJson(
        res,
        500,
        { error: 'schedule_unavailable', code: 'schedule_unavailable', requestId: obs.requestId },
        req,
      )
    }
  }

  if (req.method === 'GET') {
    return sendJson(res, 400, { error: 'Unknown GET', code: 'invalid_query' }, req)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (parseJsonBody(req) as Record<string, unknown>) || {}
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' }, req)
  }

  // Never trust client ownership fields.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user_id: _u, userId: _uc, ...safeBody } = body

  // #336B — read-only Calendar chat query (same function; verified listEvents only).
  if (safeBody.action === 'calendar_query') {
    try {
      const tz = sanitizeTimeZone(safeBody.timeZone) || 'UTC'
      const range =
        typeof safeBody.range === 'string' ? safeBody.range.trim().toLowerCase() : undefined
      const timeMin = typeof safeBody.timeMin === 'string' ? safeBody.timeMin : undefined
      const timeMax = typeof safeBody.timeMax === 'string' ? safeBody.timeMax : undefined
      const limit =
        typeof safeBody.limit === 'number' && Number.isFinite(safeBody.limit)
          ? safeBody.limit
          : 40

      const pack = await runCalendarQuery(user.userId, {
        timeZone: tz,
        range,
        timeMin,
        timeMax,
        limit,
      })

      return sendJson(
        res,
        200,
        {
          ...pack,
          requestId: obs.requestId,
        },
        req,
      )
    } catch (err) {
      console.warn(
        '[daily-briefing]',
        JSON.stringify({
          route: 'calendar-query',
          requestId: obs.requestId,
          error: safeErrorSnippet(err),
        }),
      )
      return sendJson(
        res,
        500,
        {
          status: 'error',
          items: [],
          code: 'calendar_query_failed',
          requestId: obs.requestId,
        },
        req,
      )
    }
  }

  if (isMorningScheduleAction(safeBody.action)) {
    try {
      if (safeBody.action === 'morning_schedule_get') {
        const schedule = await getMorningBriefingSchedule(scope)
        return sendJson(res, 200, { schedule, requestId: obs.requestId }, req)
      }
      if (safeBody.action === 'morning_schedule_disable') {
        const result = await disableMorningBriefingSchedule(scope)
        return sendJson(res, 200, { ...result, requestId: obs.requestId }, req)
      }
      // upsert
      const result = await upsertMorningBriefingSchedule(safeBody, scope)
      if (!result.ok) {
        return sendJson(
          res,
          400,
          {
            error: 'Validation failed',
            code: 'validation_failed',
            errors: 'errors' in result ? result.errors : {},
            requestId: obs.requestId,
          },
          req,
        )
      }
      return sendJson(res, 200, { ...result, requestId: obs.requestId }, req)
    } catch (err) {
      console.warn(
        '[daily-briefing]',
        JSON.stringify({
          route: 'morning-schedule-action',
          requestId: obs.requestId,
          error: safeErrorSnippet(err),
        }),
      )
      return sendJson(
        res,
        500,
        { error: 'schedule_unavailable', code: 'schedule_unavailable', requestId: obs.requestId },
        req,
      )
    }
  }

  const timeZone = typeof safeBody.timeZone === 'string' ? safeBody.timeZone : ''
  const target = safeBody.target === 'tomorrow' ? 'tomorrow' : 'today'
  const language = safeBody.language === 'en' ? 'en' : 'it'

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
