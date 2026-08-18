/**
 * #303A — Next-open / in-app due-reminder delivery helpers.
 *
 * Contract: a pending reminder with fire_at <= now must surface once when the
 * authenticated user next opens ShinkAIdo — including after a full tab close.
 * Never mark delivered on fetch alone.
 */

import type { Reminder } from './reminderTypes'

export type DueAuthResolution = { authorization: string | null }

export type DuePollDeps = {
  ensureAuth: () => Promise<DueAuthResolution>
  listDue: () => Promise<Reminder[]>
}

export type DuePollResult = {
  reminders: Reminder[]
  /** True when no Bearer could be obtained after bootstrap attempts. */
  authUnavailable: boolean
}

function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 401
  )
}

/**
 * Await auth, then fetch due reminders. On 401, re-bootstrap once and retry.
 * Does not mutate reminder status (no delivered mark).
 */
export async function pollDueRemindersAfterAuth(deps: DuePollDeps): Promise<DuePollResult> {
  const firstAuth = await deps.ensureAuth()
  if (!firstAuth.authorization) {
    const retryAuth = await deps.ensureAuth()
    if (!retryAuth.authorization) {
      return { reminders: [], authUnavailable: true }
    }
  }

  try {
    const reminders = await deps.listDue()
    return { reminders, authUnavailable: false }
  } catch (error) {
    if (!isUnauthorized(error)) throw error
    const again = await deps.ensureAuth()
    if (!again.authorization) {
      return { reminders: [], authUnavailable: true }
    }
    const reminders = await deps.listDue()
    return { reminders, authUnavailable: false }
  }
}

/**
 * Merge server due rows into the local queue without duplicates.
 * Skips ids already being acknowledged (delivering).
 */
export function mergeDueIntoQueue(
  prev: Reminder[],
  due: Reminder[],
  deliveringIds: ReadonlySet<string>,
): Reminder[] {
  const seen = new Set(prev.map((r) => r.id))
  const merged = [...prev]
  for (const item of due) {
    if (!item?.id) continue
    if (seen.has(item.id) || deliveringIds.has(item.id)) continue
    merged.push(item)
    seen.add(item.id)
  }
  return merged
}

/** Contract helper — fetch must never imply delivered. */
export function shouldMarkDeliveredOnFetch(): boolean {
  return false
}

/**
 * Client must not drop past-due pending rows (missed / next-open).
 * Server already filters status + fire_at; this guards accidental UI filters.
 *
 * #303B: background claim/lease metadata must not hide a due reminder.
 * CLAIMED != DELIVERED — only user acknowledgement marks delivered.
 */
export function isEligibleForNextOpenSurface(reminder: Reminder, nowMs = Date.now()): boolean {
  if (reminder.status !== 'pending' && reminder.status !== 'snoozed') return false
  if (reminder.status === 'snoozed') {
    if (!reminder.snoozeUntil) return false
    return new Date(reminder.snoozeUntil).getTime() <= nowMs
  }
  return new Date(reminder.fireAt).getTime() <= nowMs
}
