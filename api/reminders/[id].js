import { requireMemoryApiUser } from '../../lib/server/memory-api-auth.js'
import {
  cancelReminder,
  deleteReminder,
  getReminderById,
  reminderOwnerScope,
  updateReminder,
  validateReminderUpdateInput,
} from '../../lib/server/reminders.js'
import { isRemindersEnabled } from '../../lib/server/reminders-enabled.js'
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

async function enforceReminderRateLimit(req, res, userId) {
  const limited = await consumeRateLimit({ userId, bucket: 'reminders' })
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

function getId(req) {
  const raw = req.query.id
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  return ''
}

function querySoftCancel(req) {
  const raw = req.query.cancel
  if (raw === '1' || raw === 'true') return true
  if (Array.isArray(raw) && (raw[0] === '1' || raw[0] === 'true')) return true
  const hard = req.query.hard
  if (hard === '1' || hard === 'true') return false
  if (Array.isArray(hard) && (hard[0] === '1' || hard[0] === 'true')) return false
  return true
}

export default async function handler(req, res) {
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

    if (!(await enforceReminderRateLimit(req, res, owner.userId))) {
      return undefined
    }

    const scope = reminderOwnerScope(owner.userId)
    const id = getId(req)
    if (!id || id.length > 128) {
      return sendJson(res, 400, { error: 'Reminder id is required', code: 'invalid_id' }, req)
    }

    if (req.method === 'GET') {
      const reminder = await getReminderById(id, scope)
      if (!reminder) {
        return sendJson(res, 404, { error: 'Reminder not found', code: 'not_found' }, req)
      }
      return sendJson(res, 200, { reminder }, req)
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      let body
      try {
        body = parseJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_json' }, req)
      }

      const { user_id: _u, userId: _uc, id: _id, ...safeBody } = body

      const current = await getReminderById(id, scope)
      if (!current) {
        return sendJson(res, 404, { error: 'Reminder not found', code: 'not_found' }, req)
      }

      const validated = validateReminderUpdateInput(safeBody, { status: current.status })
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

      const reminder = await updateReminder(id, validated.data, scope)
      if (!reminder) {
        return sendJson(res, 404, { error: 'Reminder not found', code: 'not_found' }, req)
      }
      return sendJson(res, 200, { reminder }, req)
    }

    if (req.method === 'DELETE') {
      const soft = querySoftCancel(req)
      if (soft) {
        try {
          const reminder = await cancelReminder(id, scope)
          if (!reminder) {
            return sendJson(res, 404, { error: 'Reminder not found', code: 'not_found' }, req)
          }
          return sendJson(res, 200, { reminder }, req)
        } catch (error) {
          if (error instanceof Error && error.message === 'status_transition_invalid') {
            return sendJson(
              res,
              400,
              { error: 'Validation failed', code: 'status_transition_invalid' },
              req,
            )
          }
          throw error
        }
      }

      const deleted = await deleteReminder(id, scope)
      if (!deleted) {
        return sendJson(res, 404, { error: 'Reminder not found', code: 'not_found' }, req)
      }
      return sendJson(res, 200, { deleted: true }, req)
    }

    return sendJson(res, 405, { error: 'Method not allowed' }, req)
  } catch (error) {
    console.warn(
      '[api/reminders/:id]',
      safeErrorSnippet(error instanceof Error ? error.message : 'unknown'),
    )
    return sendJson(
      res,
      500,
      { error: SAFE_REMINDER_ERROR, code: 'reminder_error' },
      req,
    )
  }
}
