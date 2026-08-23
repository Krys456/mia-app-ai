/**
 * #336B — Apply Calendar chat intent (client orchestration).
 * Zero model calls. LOCAL_EXCHANGE path only.
 */

import {
  createCalendarContext,
  isCalendarContextFresh,
} from './active-context.js'
import { computeFreeWindows, filterEventsForQuery, filterEventsForAllDayDayMembership, allDayEventIncludesYmd } from './free-time.js'
import { detectCalendarIntent } from './intent.js'
import { addDaysYmd, localYmdInZone, resolveCalendarQueryBounds } from './range.js'
import {
  failureReply,
  renderCalendarAnswer,
  renderCalendarFollowUp,
} from './render.js'

/**
 * POSIX Etc/GMT±N has inverted signs and is often an OS misconfig.
 * Return null so the server can use the Google Calendar primary timezone.
 * @param {string | null | undefined} tz
 */
export function isUnreliableCalendarTimeZone(tz) {
  return /^Etc\/GMT([+-]\d+)?$/i.test(String(tz || '').trim())
}

/**
 * @param {string | null | undefined} [explicit]
 * @returns {string | null}
 */
export function resolveClientCalendarTimeZone(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) {
    const t = explicit.trim()
    // Explicit unreliable zone → omit (do not silently substitute browser TZ).
    if (isUnreliableCalendarTimeZone(t)) return null
    return t
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    if (tz && !isUnreliableCalendarTimeZone(tz)) return tz
  } catch {
    /* ignore */
  }
  return null
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
 *   hasCalendarContext?: boolean
 *   now?: Date
 *   timeZone?: string
 *   requestFn?: typeof requestCalendarQuery
 * }} input
 */
export async function applyCalendarIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isCalendarContextFresh(input.calendarContext) ? input.calendarContext : null
  // #375S — ChatContext may pass sticky authorization when runtime/storage missed.
  const hasCalendarContext = Boolean(ctx) || Boolean(input.hasCalendarContext)
  const intent = detectCalendarIntent(input.text, {
    languageHint: langHint,
    hasCalendarContext,
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
  // Prefer explicit/reliable IANA; omit Etc/GMT* so server can use Google primary.
  const clientTz = resolveClientCalendarTimeZone(input.timeZone)
  const provisionalTz = clientTz || 'UTC'
  // Follow-ups reuse sticky context timezone when present.
  const timeZone = (ctx && ctx.timezone && !isUnreliableCalendarTimeZone(ctx.timezone)
    ? String(ctx.timezone)
    : null) || provisionalTz

  // --- Follow-ups from verified context ---
  if (intent.followUp && ctx) {
    if (intent.followUpKind === 'repeat_status') {
      const st = ctx.status && ctx.status !== 'ok' && ctx.status !== 'empty' ? ctx.status : null
      const reply = st
        ? failureReply(st, language)
        : language === 'en'
          ? 'Ask about your calendar again if you need a fresh read.'
          : 'Chiedi di nuovo il calendario se ti serve una lettura aggiornata.'
      return {
        handled: true,
        reply,
        calendarContext: ctx,
        calendarUi: buildCalendarUi(st || ctx.status || 'ok'),
        diag: {
          calendarIntent: 'calendar',
          operation: 'follow_up_repeat_status',
          calendarStatus: st || ctx.status || null,
          contextReused: true,
          modelCalls: 0,
          terminatesLocally: true,
        },
      }
    }

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
  // Provisional bounds for the request; reconciled after pack.timeZone (Google primary).
  let bounds = resolveCalendarQueryBounds({
    dayRef: intent.dayRef,
    timeZone: provisionalTz,
    now,
  })

  const requestFn =
    typeof input.requestFn === 'function'
      ? input.requestFn
      : (await import('./api.js')).requestCalendarQuery
  const pack = await requestFn({
    // Omit unreliable browser zones so listEvents can fall back to Google primary TZ.
    ...(clientTz ? { timeZone: clientTz } : {}),
    range: bounds.range,
    timeMin: bounds.timeMin,
    timeMax: bounds.timeMax,
    language,
    limit: 40,
  })

  const packTz =
    typeof pack.timeZone === 'string' && pack.timeZone.trim() && !isUnreliableCalendarTimeZone(pack.timeZone)
      ? pack.timeZone.trim()
      : null
  const queryTimeZone = packTz || clientTz || 'UTC'
  if (queryTimeZone !== provisionalTz) {
    bounds = resolveCalendarQueryBounds({
      dayRef: intent.dayRef,
      timeZone: queryTimeZone,
      now,
    })
  }

  const status = typeof pack.status === 'string' ? pack.status : 'error'
  if (status !== 'ok' && status !== 'empty') {
    const calendarContext = createCalendarContext({
      dateRange: bounds,
      labelDay: bounds.labelDay,
      timezone: queryTimeZone,
      fetchedAt: pack.fetchedAt,
      events: [],
      focusIndex: -1,
      queryType: intent.queryType || 'list',
      status,
      language,
      dayYmd: bounds.dayYmd,
    })
    return {
      handled: true,
      reply: failureReply(status, language),
      calendarContext,
      calendarUi: buildCalendarUi(status),
      diag: {
        calendarIntent: 'calendar',
        operation: 'query',
        calendarStatus: status,
        failureCode: pack.failureCode || pack.code || status,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  let events = Array.isArray(pack.items) ? pack.items : []
  // Exclude cancelled (server should already)
  events = events.filter((e) => e && e.status !== 'cancelled')
  // Defense in depth: Google all-day end.date is exclusive.
  // Only for single-day scopes — never week/next multi-day windows.
  const dayScopedList =
    Boolean(bounds.dayYmd) && bounds.range !== 'week' && bounds.range !== 'next'
  if (dayScopedList) {
    events = filterEventsForAllDayDayMembership(events, bounds.dayYmd)
  }

  if (intent.queryType === 'next') {
    // Keep soonest upcoming
    const nowMs = now.getTime()
    const todayYmd = localYmdInZone(queryTimeZone, now)
    events = events
      .filter((e) => {
        if (e.allDay) return allDayEventIncludesYmd(e, todayYmd)
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
      timeZone: queryTimeZone,
      dayYmd: bounds.dayYmd,
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
    if (!ymd && bounds.range === 'today') ymd = localYmdInZone(queryTimeZone, now)
    if (!ymd && bounds.range === 'tomorrow') ymd = addDaysYmd(localYmdInZone(queryTimeZone, now), 1)
    freeWindows = ymd ? computeFreeWindows(events, { dayYmd: ymd, timeZone: queryTimeZone }) : []
    const reply = renderCalendarAnswer({
      events,
      status: events.length ? 'ok' : 'empty',
      language,
      timeZone: queryTimeZone,
      labelDay: bounds.labelDay,
      queryType: 'free_time',
      freeWindows,
    })
    const calendarContext = createCalendarContext({
      dateRange: bounds,
      labelDay: bounds.labelDay,
      timezone: queryTimeZone,
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
        terminatesLocally: true,
      },
    }
  }

  const effectiveStatus = events.length ? 'ok' : 'empty'
  const reply = renderCalendarAnswer({
    events,
    status: effectiveStatus,
    language,
    timeZone: queryTimeZone,
    labelDay: bounds.labelDay,
    queryType: intent.queryType || 'list',
    afterHour: intent.afterHour,
    partOfDay: intent.partOfDay,
  })

  const calendarContext = createCalendarContext({
    dateRange: bounds,
    labelDay: bounds.labelDay,
    timezone: queryTimeZone,
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
      terminatesLocally: true,
    },
  }
}
