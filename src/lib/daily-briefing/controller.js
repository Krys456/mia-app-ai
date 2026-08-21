/**
 * #321/#334C — Apply Daily Briefing (client orchestration).
 * Zero model calls. LOCAL_EXCHANGE path only.
 */

import {
  createBriefingContext,
  isBriefingContextFresh,
} from './active-context.js'
import { requestDailyBriefingPack } from './api.js'
import { detectDailyBriefingIntent } from './intent.js'
import { answerBriefingFollowUp } from './followups.js'
import {
  applyBriefingPresentationPrefs,
  normalizeBriefingSettings,
} from './preferences.js'
import { buildBriefingUi, composeDailyBriefing } from './render.js'
import { analyzeSchedule } from './schedule.js'
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
 *   briefingPrefs?: object | null
 *   oneShotLength?: 'concise'|'balanced'|'detailed'|null
 *   oneShotHideWeather?: boolean
 * }} input
 */
export async function applyDailyBriefingIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isBriefingContextFresh(input.briefingContext) ? input.briefingContext : null
  const prefs = normalizeBriefingSettings(input.briefingPrefs || {})
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
    // One-shot re-render density / weather from follow-up kinds
    if (
      intent.followUpKind === 'render_concise' ||
      intent.followUpKind === 'render_detailed' ||
      intent.followUpKind === 'hide_weather_once'
    ) {
      const length =
        intent.followUpKind === 'render_concise'
          ? 'concise'
          : intent.followUpKind === 'render_detailed'
            ? 'detailed'
            : ctx.renderLength || 'balanced'
      let model = ctx.lastModel
      if (!model) {
        return {
          handled: true,
          reply:
            language === 'en'
              ? 'Ask for a briefing first.'
              : 'Chiedi prima un briefing.',
          briefingContext: ctx,
          diag: { operation: 'follow_up_render', failureCode: 'no_model' },
        }
      }
      if (intent.followUpKind === 'hide_weather_once') {
        model = applyBriefingPresentationPrefs(model, {
          ...normalizeBriefingSettings({}),
          calendarEnabled: true,
          remindersEnabled: true,
          weatherEnabled: false,
        })
      }
      const composed = composeDailyBriefing(model, language, {
        now,
        length,
        schedule: ctx.schedule || null,
      })
      return {
        handled: true,
        reply: composed.text,
        briefingContext: {
          ...ctx,
          displayText: composed.text,
          renderLength: length,
        },
        briefingUi: buildBriefingUi(model, language),
        diag: {
          dailyBriefingIntent: 'daily-briefing',
          operation: 'follow_up_render',
          contextReused: true,
          renderLength: length,
          oneShotHideWeather: intent.followUpKind === 'hide_weather_once',
          modelCalls: 0,
        },
      }
    }
    return answerBriefingFollowUp(intent, ctx, language, { now })
  }

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

  const weatherEnabled = prefs.weatherEnabled && !input.oneShotHideWeather
  const weather = await resolveBriefingWeather({
    language,
    locationText: intent.locationText || null,
    weatherContext: input.weatherContext || null,
    timeZone,
    preferredWeatherCity: prefs.preferredWeatherCity,
    weatherEnabled,
  })

  let model = {
    status: pack.status || 'partial_success',
    targetDate: pack.targetDate,
    timezone: pack.timezone || timeZone,
    timezoneSource: 'client',
    generatedAt: pack.generatedAt || new Date().toISOString(),
    calendar: pack.calendar || { status: 'unavailable', items: [] },
    reminders: pack.reminders || { status: 'unavailable', overdue: [], today: [] },
    weather,
  }

  model = applyBriefingPresentationPrefs(model, {
    ...prefs,
    weatherEnabled,
  })

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
    (model.weather.status === 'ok' ||
      model.weather.status === 'location_required' ||
      model.weather.hiddenByPref)
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

  const schedule = analyzeSchedule(model.calendar.items || [], { now, timeZone })
  const length = input.oneShotLength || prefs.length || 'balanced'
  const composed = composeDailyBriefing(model, language, { now, length, schedule })
  const reply = composed.text
  const reminderItems = [
    ...(model.reminders.overdue || []).map((r) => ({ ...r, overdue: true })),
    ...(model.reminders.today || []).map((r) => ({ ...r, overdue: false })),
  ]

  const briefingContext = createBriefingContext({
    targetDate: model.targetDate,
    timezone: model.timezone,
    sourceStatuses: {
      calendar: model.calendar.status,
      reminders: model.reminders.status,
      weather: model.weather.status,
    },
    unavailableSources: [],
    calendarItems: model.calendar.items || [],
    reminderItems,
    weatherSnapshot: model.weather.snapshot || null,
    presentationItems: composed.presentationItems,
    priorities: composed.priorities,
    schedule,
    lastModel: model,
    renderLength: length,
    focusIndex: -1,
    displayText: reply,
    language,
    generatedAt: model.generatedAt,
  })

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
      weatherCitySource: weather.citySource || null,
      renderLength: length,
      overlapCount: schedule.overlaps.length,
      freeWindowCount: schedule.freeWindows.length,
      priorityCount: composed.priorities.length,
      partialSuccess: model.status === 'partial_success',
      renderMode: 'deterministic',
      failureCode: model.status === 'error' ? 'all_sources_failed' : null,
      responseMode: 'deterministic',
      modelCalls: 0,
    },
  }
}
