/**
 * #321/#334B — Apply Daily Briefing (client orchestration).
 * Zero model calls. LOCAL_EXCHANGE path only.
 */

import {
  createBriefingContext,
  isBriefingContextFresh,
} from './active-context.js'
import { requestDailyBriefingPack } from './api.js'
import { detectDailyBriefingIntent } from './intent.js'
import { answerBriefingFollowUp } from './followups.js'
import { buildBriefingUi, composeDailyBriefing } from './render.js'
import { resolveBriefingWeather } from './weather-source.js'

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   briefingContext?: object | null
 *   weatherContext?: object | null
 *   now?: Date
 * }} input
 */
export async function applyDailyBriefingIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isBriefingContextFresh(input.briefingContext) ? input.briefingContext : null
  const intent = detectDailyBriefingIntent(input.text, {
    languageHint: langHint,
    hasBriefingContext: Boolean(ctx),
  })

  if (intent.intent !== 'daily-briefing') {
    return {
      handled: false,
      reply: null,
      diag: { dailyBriefingIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || langHint
  const now = input.now instanceof Date ? input.now : new Date()

  if (intent.followUp && ctx) {
    return answerBriefingFollowUp(intent, ctx, language, { now })
  }

  // Follow-up detected but context stale/missing
  if (intent.followUp && !ctx) {
    return {
      handled: true,
      reply:
        language === 'en'
          ? 'Ask for a briefing first, then I can go deeper on a point.'
          : 'Chiedi prima un briefing, poi posso approfondire un punto.',
      diag: {
        dailyBriefingIntent: 'daily-briefing',
        operation: 'follow_up_no_context',
        failureCode: 'no_context',
      },
    }
  }

  const timeZone = browserTimeZone()
  const pack = await requestDailyBriefingPack({
    timeZone,
    target: intent.target || 'today',
    language,
  })

  const weather = await resolveBriefingWeather({
    language,
    locationText: intent.locationText || null,
    weatherContext: input.weatherContext || null,
    timeZone,
  })

  const model = {
    status: pack.status || 'partial_success',
    targetDate: pack.targetDate,
    timezone: pack.timezone || timeZone,
    timezoneSource: 'client',
    generatedAt: pack.generatedAt || new Date().toISOString(),
    calendar: pack.calendar || { status: 'unavailable', items: [] },
    reminders: pack.reminders || { status: 'unavailable', overdue: [], today: [] },
    weather,
  }

  // Recompute overall status with weather
  const statuses = [model.calendar.status, model.reminders.status, model.weather.status]
  const anyOk =
    statuses.includes('ok') ||
    statuses.includes('empty') ||
    model.weather.status === 'location_required'
  const anyHardFail = statuses.some((s) =>
    ['error', 'timeout', 'disconnected', 'disabled', 'unavailable'].includes(s),
  )
  if (anyOk && anyHardFail) model.status = 'partial_success'
  else if (
    (model.calendar.status === 'ok' || model.calendar.status === 'empty') &&
    (model.reminders.status === 'ok' || model.reminders.status === 'empty') &&
    (model.weather.status === 'ok' || model.weather.status === 'location_required')
  ) {
    model.status =
      model.calendar.status === 'empty' &&
      model.reminders.status === 'empty' &&
      model.weather.status !== 'ok'
        ? 'partial_success'
        : 'ok'
  } else if (!anyOk) {
    model.status = 'error'
  }

  const composed = composeDailyBriefing(model, language, { now })
  const reply = composed.text
  const reminderItems = [
    ...(model.reminders.overdue || []).map((r) => ({ ...r, overdue: true })),
    ...(model.reminders.today || []).map((r) => ({ ...r, overdue: false })),
  ]
  const unavailableSources = []
  if (['disconnected', 'disabled', 'error', 'timeout', 'unavailable'].includes(model.calendar.status)) {
    unavailableSources.push('calendar')
  }
  if (['disabled', 'error', 'timeout', 'unavailable'].includes(model.reminders.status)) {
    unavailableSources.push('reminders')
  }
  if (['error', 'timeout', 'unavailable'].includes(model.weather.status)) {
    unavailableSources.push('weather')
  }

  const briefingContext = createBriefingContext({
    targetDate: model.targetDate,
    timezone: model.timezone,
    sourceStatuses: {
      calendar: model.calendar.status,
      reminders: model.reminders.status,
      weather: model.weather.status,
    },
    unavailableSources,
    calendarItems: model.calendar.items || [],
    reminderItems,
    weatherSnapshot: model.weather.snapshot || null,
    presentationItems: composed.presentationItems,
    priorities: composed.priorities,
    focusIndex: -1,
    displayText: reply,
    language,
    generatedAt: model.generatedAt,
  })

  const sourceTimeouts =
    model.calendar.status === 'timeout' || model.reminders.status === 'timeout'

  return {
    handled: true,
    reply,
    status: model.status,
    briefingContext,
    briefingUi: buildBriefingUi(model, language),
    model,
    diag: {
      dailyBriefingIntent: 'daily-briefing',
      operation: 'briefing',
      targetDate: model.targetDate,
      timezoneSource: 'client',
      calendarStatus: model.calendar.status,
      calendarItemCount: Array.isArray(model.calendar.items) ? model.calendar.items.length : 0,
      reminderStatus: model.reminders.status,
      reminderCount: reminderItems.length,
      weatherStatus: model.weather.status,
      priorityCount: composed.priorities.length,
      sourceTimeouts,
      partialSuccess: model.status === 'partial_success',
      renderMode: 'deterministic',
      failureCode: model.status === 'error' ? 'all_sources_failed' : null,
      responseMode: 'deterministic',
      modelCalls: 0,
    },
  }
}
