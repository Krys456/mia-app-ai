/**
 * #321 — Reminders source for Daily Briefing (today + overdue).
 */

import { isRemindersEnabled } from '../reminders-enabled.js'
import { listUpcomingReminders, reminderOwnerScope } from '../reminders.js'
import {
  dateKeyOfInstant,
  localDateKeyInZone,
  withTimeout,
} from './timezone.js'

const REMINDER_TIMEOUT_MS = 6000

/**
 * @param {string} userId
 * @param {{
 *   timeZone: string
 *   targetDateKey: string
 *   now?: Date
 *   env?: Record<string, string | undefined>
 * }} opts
 */
export async function fetchRemindersForBriefing(userId, opts) {
  const env = opts.env || process.env
  const listFn =
    typeof opts.listUpcomingRemindersFn === 'function'
      ? opts.listUpcomingRemindersFn
      : listUpcomingReminders
  if (!isRemindersEnabled(env)) {
    return {
      status: 'disabled',
      overdue: [],
      today: [],
      fetchedAt: new Date().toISOString(),
    }
  }

  const now = opts.now || new Date()
  const briefingTz = opts.timeZone
  const targetKey = opts.targetDateKey

  try {
    const upcoming = await withTimeout(REMINDER_TIMEOUT_MS, () =>
      listFn(reminderOwnerScope(userId), { limit: 50 }),
    )

    /** @type {Array<{ id: string, title: string, fireAt: string, timezone: string, overdue: boolean }>} */
    const overdue = []
    /** @type {Array<{ id: string, title: string, fireAt: string, timezone: string, overdue: boolean }>} */
    const today = []

    for (const r of upcoming || []) {
      if (!r || (r.status !== 'pending' && r.status !== 'snoozed')) continue
      const fireAt = r.fireAt
      const remTz = r.timezone || briefingTz
      const fireMs = new Date(fireAt).getTime()
      if (!Number.isFinite(fireMs)) continue

      const item = {
        id: String(r.id || '').slice(0, 80),
        title: String(r.title || '').slice(0, 120),
        fireAt: String(fireAt),
        timezone: String(remTz).slice(0, 64),
        overdue: false,
      }

      const isOverdue = fireMs < now.getTime()
      const fireDateKey = dateKeyOfInstant(fireAt, briefingTz)

      if (isOverdue) {
        // Overdue only for "today" briefing (or still show if fire was before target day start)
        if (opts.targetDateKey === localDateKeyInZone(briefingTz, now) || fireDateKey === targetKey) {
          item.overdue = true
          overdue.push(item)
        }
        continue
      }

      if (fireDateKey === targetKey) {
        today.push(item)
      }
    }

    overdue.sort((a, b) => String(a.fireAt).localeCompare(String(b.fireAt)))
    today.sort((a, b) => String(a.fireAt).localeCompare(String(b.fireAt)))

    const hasAny = overdue.length + today.length > 0
    return {
      status: hasAny ? 'ok' : 'empty',
      overdue,
      today,
      fetchedAt: new Date().toISOString(),
    }
  } catch (err) {
    if (err && err.code === 'timeout') {
      return {
        status: 'timeout',
        overdue: [],
        today: [],
        fetchedAt: new Date().toISOString(),
      }
    }
    return {
      status: 'error',
      overdue: [],
      today: [],
      fetchedAt: new Date().toISOString(),
    }
  }
}
