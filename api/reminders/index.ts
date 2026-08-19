import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireMemoryApiUser } from '../../lib/server/memory-api-auth.js'
import {
  createReminder,
  listDueReminders,
  listUpcomingReminders,
  reminderOwnerScope,
  validateReminderCreateInput,
} from '../../lib/server/reminders.js'
import {
  listPushSubscriptions,
  pushSubscriptionOwnerScope,
  unsubscribePushSubscription,
  upsertPushSubscription,
  validatePushSubscribeInput,
} from '../../lib/server/push-subscriptions.js'
import { isRemindersEnabled } from '../../lib/server/reminders-enabled.js'
import { isPushEnabled } from '../../lib/server/push-enabled.js'
import {
  applyCors,
  parseJsonBody,
  sendCorsPreflight,
  sendJson,
} from '../../lib/server/http.js'
import { consumeRateLimit } from '../../lib/server/rate-limit.js'
import { safeErrorSnippet } from '../../lib/server/safe-log.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

const SAFE_REMINDER_ERROR = 'Impossibile gestire i promemoria in questo momento. Riprova tra poco.'
const SAFE_PUSH_ERROR = 'Impossibile gestire le notifiche in questo momento. Riprova tra poco.'

async function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  userId: string,
  bucket: 'reminders' | 'push_subscriptions',
): Promise<boolean> {
  const limited = await consumeRateLimit({ userId, bucket })
  if ('unavailable' in limited && limited.unavailable) {
    if (limited.retryAfter > 0) {
      res.setHeader('Retry-After', String(limited.retryAfter))
    }
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
    return false
  }
  if (!limited.success) {
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
    return false
  }
  return true
}

function queryFlag(req: VercelRequest, key: string): boolean {
  const raw = req.query[key]
  if (raw === '1' || raw === 'true') return true
  if (Array.isArray(raw) && (raw[0] === '1' || raw[0] === 'true')) return true
  return false
}

function isPushAction(action: unknown): action is 'push_subscribe' | 'push_unsubscribe' {
  return action === 'push_subscribe' || action === 'push_unsubscribe'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res, req)

    if (req.method === 'OPTIONS') {
      return sendCorsPreflight(res, req)
    }

    if (!isRemindersEnabled()) {
      return sendJson(res, 404, { error: 'Reminders unavailable', code: 'reminders_disabled' }, req)
    }

    const owner = await requireMemoryApiUser(req, res)
    if (!owner) {
      return undefined
    }

    // --- Push subscription ops on existing reminders function (no 9th Vercel fn) ---
    if (req.method === 'GET' && queryFlag(req, 'push_subscription')) {
      if (!(await enforceRateLimit(req, res, owner.userId, 'push_subscriptions'))) {
        return undefined
      }
      const subscriptions = await listPushSubscriptions(pushSubscriptionOwnerScope(owner.userId))
      return sendJson(
        res,
        200,
        {
          pushEnabled: isPushEnabled(),
          subscriptions,
        },
        req,
      )
    }

    if (req.method === 'POST') {
      let body: Record<string, unknown>
      try {
        body = parseJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_json' }, req)
      }

      // Body user_id / userId must never become ownership.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { user_id: _ignoredUserId, userId: _ignoredUserIdCamel, ...safeBody } = body

      if (isPushAction(safeBody.action)) {
        if (!(await enforceRateLimit(req, res, owner.userId, 'push_subscriptions'))) {
          return undefined
        }

        const pushScope = pushSubscriptionOwnerScope(owner.userId)

        if (safeBody.action === 'push_subscribe') {
          // Subscription persist allowed even when PUSH_ENABLED is false so Preview
          // can smoke-test storage; delivery worker remains fail-closed separately.
          const validated = validatePushSubscribeInput(safeBody)
          if (validated.ok === false) {
            return sendJson(
              res,
              400,
              {
                error: 'Validation failed',
                code: 'validation_failed',
                errors: validated.errors,
              },
              req,
            )
          }
          const subscription = await upsertPushSubscription(validated.data, pushScope)
          return sendJson(res, 200, { ok: true, subscription }, req)
        }

        // push_unsubscribe
        const endpoint =
          typeof safeBody.endpoint === 'string' ? safeBody.endpoint.trim() : ''
        if (!endpoint) {
          return sendJson(
            res,
            400,
            { error: 'endpoint is required', code: 'validation_failed' },
            req,
          )
        }
        const hardDelete = safeBody.hard === true || safeBody.hardDelete === true
        const result = await unsubscribePushSubscription(endpoint, pushScope, {
          hardDelete,
        })
        return sendJson(res, 200, result, req)
      }

      if (!(await enforceRateLimit(req, res, owner.userId, 'reminders'))) {
        return undefined
      }

      const scope = reminderOwnerScope(owner.userId)
      const validated = validateReminderCreateInput(safeBody)
      if (validated.ok === false) {
        return sendJson(
          res,
          400,
          {
            error: 'Validation failed',
            code: 'validation_failed',
            errors: validated.errors,
          },
          req,
        )
      }

      const reminder = await createReminder(validated.data, scope)
      return sendJson(res, 201, { reminder }, req)
    }

    if (!(await enforceRateLimit(req, res, owner.userId, 'reminders'))) {
      return undefined
    }

    const scope = reminderOwnerScope(owner.userId)

    if (req.method === 'GET') {
      if (queryFlag(req, 'due')) {
        const reminders = await listDueReminders(scope)
        return sendJson(res, 200, { reminders }, req)
      }
      const reminders = await listUpcomingReminders(scope)
      return sendJson(res, 200, { reminders }, req)
    }

    return sendJson(res, 405, { error: 'Method not allowed' }, req)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown'
    const isPush = msg.startsWith('push_')
    console.warn('[api/reminders]', safeErrorSnippet(msg))
    return sendJson(
      res,
      500,
      {
        error: isPush ? SAFE_PUSH_ERROR : SAFE_REMINDER_ERROR,
        code: isPush ? 'push_error' : 'reminder_error',
      },
      req,
    )
  }
}
