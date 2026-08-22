/**
 * #357B — Session-only activeReminders + pending proposal (never Memory).
 */

export const REMINDERS_CONTEXT_KEY = 'shinkaido.activeReminders.v1'
export const REMINDERS_CONTEXT_TTL_MS = 30 * 60 * 1000

export const REMINDER_PENDING_KEY = 'shinkaido.pendingReminder.v1'
export const REMINDER_PENDING_TTL_MS = 15 * 60 * 1000

function sanitizeReminder(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : ''
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : ''
  const fireAt = typeof raw.fireAt === 'string' ? raw.fireAt.slice(0, 40) : ''
  if (!id || !title || !fireAt) return null
  return {
    id,
    title,
    fireAt,
    timezone: typeof raw.timezone === 'string' ? raw.timezone.slice(0, 64) : 'UTC',
    status: typeof raw.status === 'string' ? raw.status.slice(0, 24) : 'pending',
    localDateLabel:
      typeof raw.localDateLabel === 'string' ? raw.localDateLabel.slice(0, 32) : undefined,
    localTimeLabel:
      typeof raw.localTimeLabel === 'string' ? raw.localTimeLabel.slice(0, 16) : undefined,
  }
}

export function createRemindersContext(input) {
  if (!input || typeof input !== 'object') return null
  const reminders = Array.isArray(input.reminders)
    ? input.reminders.map(sanitizeReminder).filter(Boolean).slice(0, 20)
    : []
  const now = input.createdAt || Date.now()
  return {
    queryType: String(input.queryType || 'upcoming'),
    fetchedAt: input.fetchedAt || new Date(now).toISOString(),
    reminders,
    focusIndex:
      typeof input.focusIndex === 'number' ? input.focusIndex : reminders.length ? 0 : -1,
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + REMINDERS_CONTEXT_TTL_MS,
  }
}

export function isRemindersContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadRemindersContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(REMINDERS_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isRemindersContextFresh(ctx, nowMs)) {
      storage.removeItem(REMINDERS_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveRemindersContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx) {
      storage.removeItem(REMINDERS_CONTEXT_KEY)
      return
    }
    const built = createRemindersContext(ctx)
    if (!built) {
      storage.removeItem(REMINDERS_CONTEXT_KEY)
      return
    }
    storage.setItem(REMINDERS_CONTEXT_KEY, JSON.stringify(built))
  } catch {
    /* ignore quota */
  }
}

export function clearRemindersContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(REMINDERS_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}

export function focusIndexInContext(ctx, index) {
  if (!ctx || !Array.isArray(ctx.reminders) || !ctx.reminders.length) return ctx
  const i = Math.max(0, Math.min(Number(index) || 0, ctx.reminders.length - 1))
  return { ...ctx, focusIndex: i }
}

export function getFocusedReminder(ctx) {
  if (!ctx || !Array.isArray(ctx.reminders) || !ctx.reminders.length) return null
  const i =
    typeof ctx.focusIndex === 'number' && ctx.focusIndex >= 0 ? ctx.focusIndex : 0
  return ctx.reminders[i] || null
}

export function savePendingReminderProposal(
  proposal,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage || !proposal) return
  try {
    const now = Date.now()
    storage.setItem(
      REMINDER_PENDING_KEY,
      JSON.stringify({
        proposal,
        createdAt: now,
        expiresAt: now + REMINDER_PENDING_TTL_MS,
      }),
    )
  } catch {
    /* ignore */
  }
}

export function loadPendingReminderProposal(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(REMINDER_PENDING_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.proposal || typeof data.expiresAt !== 'number' || data.expiresAt <= nowMs) {
      storage.removeItem(REMINDER_PENDING_KEY)
      return null
    }
    return data.proposal
  } catch {
    return null
  }
}

export function clearPendingReminderProposal(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(REMINDER_PENDING_KEY)
  } catch {
    /* ignore */
  }
}
