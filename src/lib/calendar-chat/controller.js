/**
 * #336B — Apply Calendar chat intent (client orchestration).
 * Zero model calls. LOCAL_EXCHANGE path only.
 */

import {
  createCalendarContext,
  isCalendarContextFresh,
} from './active-context.js'
import { computeFreeWindows, filterEventsForQuery } from './free-time.js'
import { detectCalendarIntent } from './intent.js'
import { addDaysYmd, localYmdInZone, resolveCalendarQueryBounds } from './range.js'
import {
  failureReply,
  renderCalendarAnswer,
  renderCalendarFollowUp,
} from './render.js'

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function buildCalendarUi(status) {
  if (status === 'disconnected' || status === 'reconnect_required' || status === 'auth_required') {
    return {
      kind: 'status',
      chip: status === 'reconnect_required' ? 'Ricollega Calendar' : 'Calendar',
      actions: [{ id: 'open_settings', label: 'Apri Impostazioni' }],
    }
  }
  if (status === 'ok' || status === 'empty') {
    return {
      kind: 'status',
      chip: 'Calendar',
      actions: [],
    }
  }
  return {
    kind: 'status',
    chip: 'Calendar',
    actions: [],
  }
}

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   calendarContext?: object | null
 *   now?: Date
 *   timeZone?: string
 *   requestFn?: typeof requestCalendarQuery
 * }} input
 */
export async function applyCalendarIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isCalendarContextFresh(input.calendarContext) ? input.calendarContext : null
  const intent = detectCalendarIntent(input.text, {
    languageHint: langHint,
    hasCalendarContext: Boolean(ctx),
  })

  if (intent.intent !== 'calendar') {
    return {
      handled: false,
      reply: null,
      diag: { calendarIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || langHint
  const now = input.now instanceof Date ? input.now : new Date()
  const timeZone = input.timeZone || browserTimeZone()

  // --- Follow-ups from verified context ---
  if (intent.followUp && ctx) {
    if (intent.followUpKind === 'free_time') {
      const dayYmd = ctx.dayYmd
      const freeWindows = dayYmd
        ? computeFreeWindows(ctx.events, { dayYmd, timeZone: ctx.timezone || timeZone })
        : []
      const reply = renderCalendarFollowUp('free_time', ctx, { freeWindows, now })
      return {
        handled: true,
        reply,
        calendarContext: ctx,
        calendarUi: buildCalendarUi(ctx.status || 'ok'),
        diag: {
          calendarIntent: 'calendar',
          operation: 'follow_up_free_time',
          contextReused: true,
          modelCalls: 0,
        },
      }
    }

    if (intent.followUpKind === 'after_time' || intent.followUpKind === 'before_time') {
      const filtered = filterEventsForQuery(ctx.events, {
        timeZone: ctx.timezone || timeZone,
        afterHour: intent.followUpKind === 'after_time' ? intent.hour : null,
        afterMinute: intent.minute || 0,
        beforeHour: intent.followUpKind === 'before_time' ? intent.hour : null,
        beforeMinute: intent.minute || 0,
      })
      const reply = renderCalendarFollowUp(intent.followUpKind, ctx, {
        filteredEvents: filtered,
        hour: intent.hour,
        now,
      })
      const nextCtx = createCalendarContext({
        ...ctx,
        events: filtered,
        focusIndex: filtered.length ? 0 : -1,
        queryType: intent.followUpKind,
        createdAt: Date.now(),
      })
      return {
        handled: true,
        reply,
        calendarContext: nextCtx,
        calendarUi: buildCalendarUi('ok'),
        diag: {
          calendarIntent: 'calendar',
          operation: 'follow_up_time_filter',
          contextReused: true,
          modelCalls: 0,
        },
      }
    }

    const reply = renderCalendarFollowUp(intent.followUpKind, ctx, {
      ordinalIndex: intent.ordinalIndex,
      now,
    })
    let nextCtx = ctx
    if (intent.followUpKind === 'ordinal' && intent.ordinalIndex != null) {
      nextCtx = { ...ctx, focusIndex: intent.ordinalIndex }
    } else if (intent.followUpKind === 'next_after') {
      const focus = typeof ctx.focusIndex === 'number' ? ctx.focusIndex : -1
      const nextIdx = focus >= 0 ? focus + 1 : 0
      if (nextIdx < (ctx.events || []).length) {
        nextCtx = { ...ctx, focusIndex: nextIdx }
      }
    }
    return {
      handled: true,
      reply,
      calendarContext: nextCtx,
      calendarUi: buildCalendarUi(ctx.status || 'ok'),
      diag: {
        calendarIntent: 'calendar',
        operation: 'follow_up',
        followUpKind: intent.followUpKind,
        contextReused: true,
        modelCalls: 0,
      },
    }
  }

  if (intent.followUp && !ctx) {
    return {
      handled: true,
      reply:
        language === 'en'
          ? 'Ask about your calendar first, then I can go deeper.'
          : 'Chiedi prima il calendario, poi posso approfondire.',
      diag: {
        calendarIntent: 'calendar',
        operation: 'follow_up_no_context',
        failureCode: 'no_context',
        modelCalls: 0,
      },
    }
  }

  // --- Fresh query ---
  const bounds = resolveCalendarQueryBounds({
    dayRef: intent.dayRef,
    timeZone,
    now,
  })

  const requestFn =
    typeof input.requestFn === 'function'
      ? input.requestFn
      : (await import('./api.js')).requestCalendarQuery
  const pack = await requestFn({
    timeZone,
    range: bounds.range,
    timeMin: bounds.timeMin,
    timeMax: bounds.timeMax,
    language,
    limit: 40,
  })

  const status = typeof pack.status === 'string' ? pack.status : 'error'
  if (status !== 'ok' && status !== 'empty') {
    return {
      handled: true,
      reply: failureReply(status, language),
      calendarUi: buildCalendarUi(status),
      diag: {
        calendarIntent: 'calendar',
        operation: 'query',
        calendarStatus: status,
        failureCode: pack.failureCode || status,
        modelCalls: 0,
      },
    }
  }

  let events = Array.isArray(pack.items) ? pack.items : []
  // Exclude cancelled (server should already)
  events = events.filter((e) => e && e.status !== 'cancelled')

  if (intent.queryType === 'next') {
    // Keep soonest upcoming
    const nowMs = now.getTime()
    events = events
      .filter((e) => {
        if (e.allDay) return true
        const s = Date.parse(e.start)
        return Number.isFinite(s) && s >= nowMs - 5 * 60000
      })
      .slice(0, 1)
  } else if (
    intent.queryType === 'after_time' ||
    intent.queryType === 'before_time' ||
    intent.queryType === 'part_of_day'
  ) {
    events = filterEventsForQuery(events, {
      timeZone,
      afterHour: intent.afterHour,
      afterMinute: intent.afterMinute,
      beforeHour: intent.beforeHour,
      beforeMinute: intent.beforeMinute,
      partOfDay: intent.partOfDay,
    })
  }

  let freeWindows = []
  if (intent.queryType === 'free_time') {
    let ymd = bounds.dayYmd
    if (!ymd && bounds.range === 'today') ymd = localYmdInZone(timeZone, now)
    if (!ymd && bounds.range === 'tomorrow') ymd = addDaysYmd(localYmdInZone(timeZone, now), 1)
    freeWindows = ymd ? computeFreeWindows(events, { dayYmd: ymd, timeZone }) : []
    const reply = renderCalendarAnswer({
      events,
      status: events.length ? 'ok' : 'empty',
      language,
      timeZone,
      labelDay: bounds.labelDay,
      queryType: 'free_time',
      freeWindows,
    })
    const calendarContext = createCalendarContext({
      dateRange: bounds,
      labelDay: bounds.labelDay,
      timezone: timeZone,
      fetchedAt: pack.fetchedAt,
      events,
      focusIndex: 0,
      queryType: 'free_time',
      status: 'ok',
      language,
      dayYmd: ymd,
    })
    return {
      handled: true,
      reply,
      calendarContext,
      calendarUi: buildCalendarUi('ok'),
      diag: {
        calendarIntent: 'calendar',
        operation: 'free_time',
        calendarStatus: 'ok',
        eventCount: events.length,
        modelCalls: 0,
      },
    }
  }

  const effectiveStatus = events.length ? 'ok' : 'empty'
  const reply = renderCalendarAnswer({
    events,
    status: effectiveStatus,
    language,
    timeZone,
    labelDay: bounds.labelDay,
    queryType: intent.queryType || 'list',
    afterHour: intent.afterHour,
    partOfDay: intent.partOfDay,
  })

  const calendarContext = createCalendarContext({
    dateRange: bounds,
    labelDay: bounds.labelDay,
    timezone: timeZone,
    fetchedAt: pack.fetchedAt,
    events,
    focusIndex: events.length ? 0 : -1,
    queryType: intent.queryType || 'list',
    status: effectiveStatus,
    language,
    dayYmd: bounds.dayYmd,
  })

  return {
    handled: true,
    reply,
    calendarContext,
    calendarUi: buildCalendarUi(effectiveStatus),
    diag: {
      calendarIntent: 'calendar',
      operation: 'query',
      calendarStatus: effectiveStatus,
      queryType: intent.queryType,
      eventCount: events.length,
      modelCalls: 0,
    },
  }
}
