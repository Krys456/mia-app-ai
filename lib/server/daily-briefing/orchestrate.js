/**
 * #321 — Server Daily Briefing orchestration (Calendar + Reminders).
 * Weather is composed on the client via #317 (no GPS auto-prompt).
 */

import { fetchCalendarForBriefing } from './calendar-source.js'
import { fetchRemindersForBriefing } from './reminders-source.js'
import {
  localDateKeyInZone,
  sanitizeBriefingTimeZone,
  tomorrowDateKeyInZone,
} from './timezone.js'

/**
 * @param {{
 *   userId: string
 *   timeZone: string
 *   target?: 'today' | 'tomorrow'
 *   language?: 'it' | 'en'
 *   now?: Date
 *   env?: Record<string, string | undefined>
 * }} input
 */
export async function buildDailyBriefingServerPayload(input) {
  const timeZone = sanitizeBriefingTimeZone(input.timeZone)
  if (!timeZone) {
    return {
      status: 'error',
      failureCode: 'invalid_timezone',
      targetDate: null,
      timezone: null,
      generatedAt: new Date().toISOString(),
      calendar: { status: 'unavailable', items: [] },
      reminders: { status: 'unavailable', overdue: [], today: [] },
    }
  }

  const now = input.now || new Date()
  const target = input.target === 'tomorrow' ? 'tomorrow' : 'today'
  const targetDate =
    target === 'tomorrow' ? tomorrowDateKeyInZone(timeZone, now) : localDateKeyInZone(timeZone, now)

  const [calendar, reminders] = await Promise.all([
    fetchCalendarForBriefing(input.userId, {
      timeZone,
      target,
      now,
      env: input.env,
      listEventsFn: input.listEventsFn,
    }),
    fetchRemindersForBriefing(input.userId, {
      timeZone,
      targetDateKey: targetDate,
      now,
      env: input.env,
      listUpcomingRemindersFn: input.listUpcomingRemindersFn,
    }),
  ])

  const usable = [calendar.status, reminders.status].some(
    (s) => s === 'ok' || s === 'empty',
  )
  const anyError = [calendar.status, reminders.status].some((s) =>
    ['error', 'timeout', 'disconnected', 'disabled', 'unavailable'].includes(s),
  )

  let status = 'ok'
  if (!usable && anyError) status = 'partial_success'
  if (
    (calendar.status === 'ok' || calendar.status === 'empty') &&
    (reminders.status === 'ok' || reminders.status === 'empty')
  ) {
    status = calendar.status === 'empty' && reminders.status === 'empty' ? 'empty' : 'ok'
  } else if (usable && anyError) {
    status = 'partial_success'
  } else if (!usable) {
    status = 'error'
  }

  // Calendar disconnected + reminders ok → partial_success (still useful)
  if (
    (reminders.status === 'ok' || reminders.status === 'empty') &&
    ['disconnected', 'disabled', 'error', 'timeout', 'unavailable'].includes(calendar.status)
  ) {
    status = reminders.status === 'empty' && calendar.status !== 'ok' ? 'partial_success' : 'partial_success'
    if (reminders.status === 'ok') status = 'partial_success'
  }

  return {
    status,
    failureCode: null,
    targetDate,
    target,
    timezone: timeZone,
    timezoneSource: 'client',
    generatedAt: new Date().toISOString(),
    language: input.language === 'en' ? 'en' : 'it',
    calendar,
    reminders,
    // Weather filled client-side
    weather: { status: 'unavailable' },
  }
}
