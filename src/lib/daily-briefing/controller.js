/**
 * #321 — Apply Daily Briefing (client orchestration).
 */

import {
  createBriefingContext,
  isBriefingContextFresh,
} from './active-context.js'
import { requestDailyBriefingPack } from './api.js'
import { detectDailyBriefingIntent } from './intent.js'
import { buildBriefingUi, renderDailyBriefing, safeTitle } from './render.js'
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

  if (intent.followUp && ctx) {
    return handleFollowUp(intent, ctx, language)
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

  const reply = renderDailyBriefing(model, language)
  const reminderItems = [...(model.reminders.overdue || []), ...(model.reminders.today || [])]
  const briefingContext = createBriefingContext({
    targetDate: model.targetDate,
    timezone: model.timezone,
    sourceStatuses: {
      calendar: model.calendar.status,
      reminders: model.reminders.status,
      weather: model.weather.status,
    },
    calendarItems: model.calendar.items || [],
    reminderItems,
    weatherSnapshot: model.weather.snapshot || null,
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
      sourceTimeouts,
      partialSuccess: model.status === 'partial_success',
      renderMode: 'deterministic',
      failureCode: model.status === 'error' ? 'all_sources_failed' : null,
      responseMode: 'deterministic',
    },
  }
}

function handleFollowUp(intent, ctx, language) {
  const kind = intent.followUpKind
  if (kind === 'first_event') {
    const first = (ctx.calendarItems || [])[0]
    if (!first) {
      return {
        handled: true,
        reply:
          language === 'en'
            ? 'No appointment in the latest briefing.'
            : 'Nessun appuntamento nel briefing recente.',
        briefingContext: ctx,
        diag: {
          dailyBriefingIntent: 'daily-briefing',
          operation: 'follow_up_first_event',
          contextReused: true,
          failureCode: first ? null : 'empty',
        },
      }
    }
    return {
      handled: true,
      reply:
        language === 'en'
          ? `First event: ${safeTitle(first.title)}.`
          : `Primo appuntamento: ${safeTitle(first.title)}.`,
      briefingContext: ctx,
      diag: {
        dailyBriefingIntent: 'daily-briefing',
        operation: 'follow_up_first_event',
        contextReused: true,
        failureCode: null,
      },
    }
  }

  if (kind === 'reminders') {
    const items = ctx.reminderItems || []
    if (!items.length) {
      return {
        handled: true,
        reply:
          language === 'en'
            ? 'No reminders in the latest briefing.'
            : 'Nessun promemoria nel briefing recente.',
        briefingContext: ctx,
        diag: {
          dailyBriefingIntent: 'daily-briefing',
          operation: 'follow_up_reminders',
          contextReused: true,
        },
      }
    }
    const list = items
      .slice(0, 5)
      .map((r) => `• ${safeTitle(r.title)}`)
      .join('\n')
    return {
      handled: true,
      reply: list,
      briefingContext: ctx,
      diag: {
        dailyBriefingIntent: 'daily-briefing',
        operation: 'follow_up_reminders',
        contextReused: true,
      },
    }
  }

  if (kind === 'weather' || kind === 'umbrella') {
    const snap = ctx.weatherSnapshot
    if (!snap) {
      return {
        handled: true,
        reply:
          language === 'en'
            ? 'No weather in the latest briefing. Tell me a city to include it.'
            : 'Nessun meteo nel briefing recente. Indicami una città per includerlo.',
        briefingContext: ctx,
        diag: {
          dailyBriefingIntent: 'daily-briefing',
          operation: 'follow_up_weather',
          contextReused: true,
        },
      }
    }
    if (kind === 'umbrella') {
      const yes = Boolean(snap.umbrellaRecommended || snap.rainLikely)
      return {
        handled: true,
        reply: yes
          ? language === 'en'
            ? 'Yes — rain looks likely; I’d bring an umbrella.'
            : 'Sì — sembra probabile la pioggia; porterei l’ombrello.'
          : language === 'en'
            ? 'No strong rain signal in the briefing weather.'
            : 'Nel meteo del briefing non c’è un segnale forte di pioggia.',
        briefingContext: ctx,
        diag: {
          dailyBriefingIntent: 'daily-briefing',
          operation: 'follow_up_umbrella',
          contextReused: true,
        },
      }
    }
    const place = snap.locationLabel || ''
    const range =
      snap.temperatureMinC != null && snap.temperatureMaxC != null
        ? `${snap.temperatureMinC}–${snap.temperatureMaxC} °C`
        : snap.temperatureC != null
          ? `${snap.temperatureC} °C`
          : ''
    return {
      handled: true,
      reply: `${place ? `${place}: ` : ''}${range}`.trim(),
      briefingContext: ctx,
      diag: {
        dailyBriefingIntent: 'daily-briefing',
        operation: 'follow_up_weather',
        contextReused: true,
      },
    }
  }

  return {
    handled: true,
    reply:
      language === 'en'
        ? 'Ask for a new briefing for an updated summary.'
        : 'Chiedi un nuovo briefing per un riepilogo aggiornato.',
    briefingContext: ctx,
    diag: {
      dailyBriefingIntent: 'daily-briefing',
      operation: 'follow_up',
      contextReused: true,
    },
  }
}
