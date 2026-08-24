/**
 * #303A — Reminder field limits and constants (no OpenAI).
 */

export const REMINDER_FIELD_LIMITS = {
  title: 200,
  body: 2000,
  timezone: 64,
  source: 32,
  sourceRef: 128,
  /** Max scheduling horizon from now (ms). ~2 years. */
  maxFutureMs: 1000 * 60 * 60 * 24 * 731,
  /** Reject fire_at more than this far in the past (ms). */
  pastGraceMs: 30_000,
}

/** @typedef {'pending' | 'delivered' | 'completed' | 'cancelled' | 'snoozed'} ReminderStatus */
/** @typedef {'user' | 'conversation' | 'calendar' | 'ai_suggestion'} ReminderSource */

export const REMINDER_STATUSES = /** @type {const} */ ([
  'pending',
  'delivered',
  'completed',
  'cancelled',
  'snoozed',
])

export const REMINDER_SOURCES = /** @type {const} */ ([
  'user',
  'conversation',
  'calendar',
  'ai_suggestion',
])

/**
 * Allowed status transitions for #303A (no cron claim state).
 * @type {Record<string, string[]>}
 */
export const REMINDER_STATUS_TRANSITIONS = {
  pending: ['delivered', 'completed', 'cancelled', 'snoozed'],
  snoozed: ['pending', 'delivered', 'cancelled'],
  delivered: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransitionReminderStatus(from, to) {
  const allowed = REMINDER_STATUS_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

/**
 * #380E — Duplicate delivery ack is a no-op success (not a transition).
 * Only `delivered` → `delivered` is treated as idempotent acknowledgement.
 * Other same-status writes are not auto-allowed.
 * @param {string} status
 * @returns {boolean}
 */
export function isIdempotentReminderStatusAck(status) {
  return status === 'delivered'
}
