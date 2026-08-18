/**
 * #303A — Owner-scoped reminder persistence (service role).
 *
 * Never logs title/body. Ownership always requires explicit userId scope.
 */

import { getServiceSupabase } from './supabase.js'
import { ensureAuthUserRow } from './brain-memory.js'
import {
  REMINDER_FIELD_LIMITS,
  REMINDER_SOURCES,
  REMINDER_STATUSES,
  canTransitionReminderStatus,
} from './reminder-field-limits.js'
import { isValidIanaTimeZone, parseFireAt, validateFireAtBounds } from './reminder-time.js'

const SELECT_COLS =
  'id, user_id, title, body, fire_at, timezone, status, source, source_ref, snooze_until, channels, delivery_attempts, last_error_code, created_at, updated_at, delivered_at, completed_at, cancelled_at'

/**
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
function requireOwnerUserId(scope) {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim() : ''
  if (!userId || scope?.requireExplicitUserId !== true) {
    throw new Error('Explicit reminder owner scope is required')
  }
  return userId
}

/**
 * @param {Record<string, unknown>} row
 */
function mapReminder(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? ''),
    body: row.body == null ? null : String(row.body),
    fireAt: String(row.fire_at),
    timezone: String(row.timezone ?? ''),
    status: String(row.status),
    source: String(row.source),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    snoozeUntil: row.snooze_until == null ? null : String(row.snooze_until),
    channels: Array.isArray(row.channels) ? row.channels.map(String) : ['in_app'],
    deliveryAttempts: Number(row.delivery_attempts) || 0,
    lastErrorCode: row.last_error_code == null ? null : String(row.last_error_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deliveredAt: row.delivered_at == null ? null : String(row.delivered_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
  }
}

/**
 * @param {unknown} body
 * @param {string} [fallback]
 */
function optionalTrimmedString(body, fallback = undefined) {
  if (body == null || body === '') return fallback === undefined ? null : fallback
  if (typeof body !== 'string') return undefined
  return body.trim()
}

/**
 * Validate create payload (body.user_id is ignored by callers).
 * @param {Record<string, unknown>} input
 * @param {Date} [now]
 * @returns {
 *   | { ok: true, data: {
 *       title: string,
 *       body: string | null,
 *       fireAt: Date,
 *       timezone: string,
 *       source: string,
 *       sourceRef: string | null,
 *       channels: string[],
 *     } }
 *   | { ok: false, errors: Record<string, string> }
 * }
 */
export function validateReminderCreateInput(input, now = new Date()) {
  /** @type {Record<string, string>} */
  const errors = {}

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (typeof input.title !== 'string' || !title) {
    errors.title = 'title is required'
  } else if (title.length > REMINDER_FIELD_LIMITS.title) {
    errors.title = `title must be at most ${REMINDER_FIELD_LIMITS.title} characters`
  }

  let body = null
  if (input.body != null && input.body !== '') {
    if (typeof input.body !== 'string') {
      errors.body = 'body must be a string'
    } else {
      body = input.body.trim()
      if (body.length > REMINDER_FIELD_LIMITS.body) {
        errors.body = `body must be at most ${REMINDER_FIELD_LIMITS.body} characters`
      }
    }
  }

  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : ''
  if (!timezone) {
    errors.timezone = 'timezone is required'
  } else if (!isValidIanaTimeZone(timezone)) {
    errors.timezone = 'timezone must be a valid IANA time zone'
  }

  const fireAt = parseFireAt(input.fire_at ?? input.fireAt)
  if (!fireAt) {
    errors.fire_at = 'fire_at must be a valid ISO datetime'
  } else {
    const bounds = validateFireAtBounds(fireAt, now)
    if (!bounds.ok) {
      errors.fire_at = bounds.code === 'reminder_in_past' ? 'reminder_in_past' : 'reminder_too_far'
    }
  }

  let source = 'user'
  if (input.source != null) {
    if (typeof input.source !== 'string' || !REMINDER_SOURCES.includes(/** @type {any} */ (input.source.trim()))) {
      errors.source = 'source is invalid'
    } else {
      source = input.source.trim()
    }
  }

  let sourceRef = null
  if (input.source_ref != null || input.sourceRef != null) {
    const raw = optionalTrimmedString(input.source_ref ?? input.sourceRef)
    if (raw === undefined) {
      errors.source_ref = 'source_ref must be a string'
    } else if (raw && raw.length > REMINDER_FIELD_LIMITS.sourceRef) {
      errors.source_ref = `source_ref must be at most ${REMINDER_FIELD_LIMITS.sourceRef} characters`
    } else {
      sourceRef = raw
    }
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      title,
      body,
      fireAt: /** @type {Date} */ (fireAt),
      timezone,
      source,
      sourceRef,
      channels: ['in_app'],
    },
  }
}

/**
 * Allowlisted update fields only.
 * @param {Record<string, unknown>} input
 * @param {{ status: string }} current
 * @param {Date} [now]
 * @returns {
 *   | { ok: true, data: Record<string, unknown> }
 *   | { ok: false, errors: Record<string, string> }
 * }
 */
export function validateReminderUpdateInput(input, current, now = new Date()) {
  /** @type {Record<string, string>} */
  const errors = {}
  /** @type {Record<string, unknown>} */
  const patch = {}

  if ('title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      errors.title = 'title is required'
    } else if (input.title.trim().length > REMINDER_FIELD_LIMITS.title) {
      errors.title = `title must be at most ${REMINDER_FIELD_LIMITS.title} characters`
    } else {
      patch.title = input.title.trim()
    }
  }

  if ('body' in input) {
    if (input.body == null || input.body === '') {
      patch.body = null
    } else if (typeof input.body !== 'string') {
      errors.body = 'body must be a string'
    } else if (input.body.trim().length > REMINDER_FIELD_LIMITS.body) {
      errors.body = `body must be at most ${REMINDER_FIELD_LIMITS.body} characters`
    } else {
      patch.body = input.body.trim()
    }
  }

  if ('timezone' in input) {
    const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : ''
    if (!timezone || !isValidIanaTimeZone(timezone)) {
      errors.timezone = 'timezone must be a valid IANA time zone'
    } else {
      patch.timezone = timezone
    }
  }

  if ('fire_at' in input || 'fireAt' in input) {
    const fireAt = parseFireAt(input.fire_at ?? input.fireAt)
    if (!fireAt) {
      errors.fire_at = 'fire_at must be a valid ISO datetime'
    } else {
      const bounds = validateFireAtBounds(fireAt, now)
      if (!bounds.ok && current.status === 'pending') {
        errors.fire_at = bounds.code === 'reminder_in_past' ? 'reminder_in_past' : 'reminder_too_far'
      } else {
        patch.fire_at = fireAt.toISOString()
      }
    }
  }

  if ('status' in input) {
    const status = typeof input.status === 'string' ? input.status.trim() : ''
    if (!REMINDER_STATUSES.includes(/** @type {any} */ (status))) {
      errors.status = 'status is invalid'
    } else if (!canTransitionReminderStatus(current.status, status)) {
      errors.status = 'status_transition_invalid'
    } else {
      patch.status = status
      if (status === 'delivered') patch.delivered_at = now.toISOString()
      if (status === 'completed') patch.completed_at = now.toISOString()
      if (status === 'cancelled') patch.cancelled_at = now.toISOString()
      if (status === 'pending') {
        patch.snooze_until = null
      }
    }
  }

  if ('snooze_until' in input || 'snoozeUntil' in input) {
    const raw = input.snooze_until ?? input.snoozeUntil
    if (raw == null || raw === '') {
      patch.snooze_until = null
    } else {
      const snooze = parseFireAt(raw)
      if (!snooze) {
        errors.snooze_until = 'snooze_until must be a valid ISO datetime'
      } else {
        patch.snooze_until = snooze.toISOString()
        if (!('status' in patch)) patch.status = 'snoozed'
      }
    }
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, errors: { _: 'no_updatable_fields' } }
  }
  return { ok: true, data: patch }
}

/**
 * @param {Record<string, unknown>} createData
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function createReminder(createData, scope) {
  const userId = requireOwnerUserId(scope)
  const supabase = await getServiceSupabase()
  await ensureAuthUserRow(supabase, userId)

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      title: createData.title,
      body: createData.body,
      fire_at: createData.fireAt.toISOString(),
      timezone: createData.timezone,
      status: 'pending',
      source: createData.source,
      source_ref: createData.sourceRef,
      channels: createData.channels ?? ['in_app'],
    })
    .select(SELECT_COLS)
    .single()

  if (error) {
    throw new Error(`reminder_create_failed:${error.code || 'unknown'}`)
  }
  return mapReminder(data)
}

/**
 * Upcoming active reminders (pending/snoozed), soonest first.
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 * @param {{ limit?: number }} [opts]
 */
export async function listUpcomingReminders(scope, opts = {}) {
  const userId = requireOwnerUserId(scope)
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 100)
  const supabase = await getServiceSupabase()

  const { data, error } = await supabase
    .from('reminders')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .in('status', ['pending', 'snoozed'])
    .order('fire_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`reminder_list_failed:${error.code || 'unknown'}`)
  }
  return (data || []).map(mapReminder)
}

/**
 * Due for in-app delivery: pending with fire_at <= now, or snoozed with snooze_until <= now.
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 * @param {{ now?: Date, limit?: number }} [opts]
 */
export async function listDueReminders(scope, opts = {}) {
  const userId = requireOwnerUserId(scope)
  const nowIso = (opts.now || new Date()).toISOString()
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50)
  const supabase = await getServiceSupabase()

  const { data: pending, error: pendingError } = await supabase
    .from('reminders')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lte('fire_at', nowIso)
    .order('fire_at', { ascending: true })
    .limit(limit)

  if (pendingError) {
    throw new Error(`reminder_due_failed:${pendingError.code || 'unknown'}`)
  }

  const { data: snoozed, error: snoozedError } = await supabase
    .from('reminders')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('status', 'snoozed')
    .lte('snooze_until', nowIso)
    .order('snooze_until', { ascending: true })
    .limit(limit)

  if (snoozedError) {
    throw new Error(`reminder_due_failed:${snoozedError.code || 'unknown'}`)
  }

  const merged = [...(pending || []), ...(snoozed || [])]
    .map(mapReminder)
    .sort((a, b) => String(a.fireAt).localeCompare(String(b.fireAt)))
    .slice(0, limit)

  return merged
}

/**
 * @param {string} id
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function getReminderById(id, scope) {
  const userId = requireOwnerUserId(scope)
  const reminderId = typeof id === 'string' ? id.trim() : ''
  if (!reminderId) return null
  const supabase = await getServiceSupabase()

  const { data, error } = await supabase
    .from('reminders')
    .select(SELECT_COLS)
    .eq('id', reminderId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`reminder_get_failed:${error.code || 'unknown'}`)
  }
  return data ? mapReminder(data) : null
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function updateReminder(id, patch, scope) {
  const userId = requireOwnerUserId(scope)
  const reminderId = typeof id === 'string' ? id.trim() : ''
  if (!reminderId) return null
  const supabase = await getServiceSupabase()

  /** @type {Record<string, unknown>} */
  const updateRow = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) updateRow[key] = value
  }

  // Increment delivery attempts when marking delivered.
  if (patch.status === 'delivered') {
    const current = await getReminderById(reminderId, scope)
    if (!current) return null
    updateRow.delivery_attempts = (current.deliveryAttempts || 0) + 1
  }

  const { data, error } = await supabase
    .from('reminders')
    .update(updateRow)
    .eq('id', reminderId)
    .eq('user_id', userId)
    .select(SELECT_COLS)
    .maybeSingle()

  if (error) {
    throw new Error(`reminder_update_failed:${error.code || 'unknown'}`)
  }
  return data ? mapReminder(data) : null
}

/**
 * Soft-cancel (preferred) — sets status=cancelled.
 * @param {string} id
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function cancelReminder(id, scope) {
  const current = await getReminderById(id, scope)
  if (!current) return null
  if (current.status === 'cancelled') return current
  if (!canTransitionReminderStatus(current.status, 'cancelled')) {
    const err = new Error('status_transition_invalid')
    err.code = 'status_transition_invalid'
    throw err
  }
  return updateReminder(
    id,
    {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    },
    scope,
  )
}

/**
 * Hard delete (owner-scoped). Prefer cancel for auditability; delete allowed for cleanup.
 * @param {string} id
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function deleteReminder(id, scope) {
  const userId = requireOwnerUserId(scope)
  const reminderId = typeof id === 'string' ? id.trim() : ''
  if (!reminderId) return false
  const supabase = await getServiceSupabase()

  const { data, error } = await supabase
    .from('reminders')
    .delete()
    .eq('id', reminderId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`reminder_delete_failed:${error.code || 'unknown'}`)
  }
  return Boolean(data?.id)
}

export function reminderOwnerScope(userId) {
  return {
    userId,
    requireExplicitUserId: true,
  }
}
