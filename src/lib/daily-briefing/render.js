/**
 * #334B — Deterministic Daily Briefing rendering (IT/EN).
 * Editorial conversational prose from verified priorities. No Core / no model.
 */

import {
  buildBriefingPriorities,
  dayPartInZone,
  presentationItemsForOrdinals,
} from './priority.js'

export function formatEventTime(ev, timeZone, language) {
  if (ev?.allDay) return language === 'en' ? 'all day' : 'tutto il giorno'
  const start = ev?.start
  if (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return language === 'en' ? 'all day' : 'tutto il giorno'
  }
  try {
    const d = new Date(start)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'it-IT', {
      timeZone: timeZone || ev.timeZone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return ''
  }
}

export function formatReminderTime(item, timeZone, language) {
  try {
    const d = new Date(item.fireAt)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'it-IT', {
      timeZone: timeZone || item.timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return ''
  }
}

export function formatWhenMs(ms, timeZone, language) {
  if (ms == null) return ''
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'it-IT', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

/**
 * Sanitize display title — DATA only (strip control chars).
 * @param {string} title
 */
export function safeTitle(title) {
  return String(title || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * @param {'it'|'en'} language
 * @param {'morning'|'afternoon'|'evening'} part
 */
export function greetingForDayPart(language, part) {
  const lang = language === 'en' ? 'en' : 'it'
  if (lang === 'en') {
    if (part === 'afternoon') return 'Good afternoon.'
    if (part === 'evening') return 'Good evening.'
    return 'Good morning.'
  }
  if (part === 'afternoon') return 'Buon pomeriggio.'
  if (part === 'evening') return 'Buonasera.'
  return 'Buongiorno.'
}

function unavailableSources(model) {
  const out = []
  const cal = model.calendar?.status
  const rem = model.reminders?.status
  const wx = model.weather?.status
  if (['disconnected', 'disabled', 'error', 'timeout', 'unavailable'].includes(cal)) {
    out.push('calendar')
  }
  if (['disabled', 'error', 'timeout', 'unavailable'].includes(rem)) {
    out.push('reminders')
  }
  if (['error', 'timeout', 'unavailable'].includes(wx)) {
    out.push('weather')
  }
  return out
}

/**
 * Build reply + presentation items from verified model.
 * @param {object} model
 * @param {'it'|'en'} language
 * @param {{ now?: Date }} [opts]
 * @returns {{ text: string, priorities: object[], presentationItems: object[] }}
 */
export function composeDailyBriefing(model, language = 'it', opts = {}) {
  const lang = language === 'en' ? 'en' : 'it'
  const tz = model.timezone || 'UTC'
  const now = opts.now || new Date()
  const part = dayPartInZone(tz, now)
  const priorities = buildBriefingPriorities(model, { now })
  const presentationItems = presentationItemsForOrdinals(priorities)

  const cal = model.calendar || { status: 'unavailable', items: [] }
  const rem = model.reminders || { status: 'unavailable', overdue: [], today: [] }
  const wx = model.weather || { status: 'unavailable' }

  const lines = []
  lines.push(greetingForDayPart(lang, part))

  const overdue = priorities.filter((p) => p.kind === 'overdue_reminder')
  const nextEv = priorities.find((p) => p.kind === 'next_event')
  const timedRest = priorities.filter((p) => p.kind === 'timed_event')
  const allDay = priorities.filter((p) => p.kind === 'all_day_event')
  const todayRem = priorities.filter((p) => p.kind === 'today_reminder')
  const weatherItem = priorities.find((p) => p.kind === 'weather')
  const quiet = priorities.some((p) => p.kind === 'quiet')

  const timedCount =
    (nextEv ? 1 : 0) + timedRest.length + allDay.length
  const calOk = cal.status === 'ok' || cal.status === 'empty'
  const remOk = rem.status === 'ok' || rem.status === 'empty'

  // Overview line
  const overviewBits = []
  if (overdue.length) {
    overviewBits.push(
      lang === 'en'
        ? `${overdue.length} overdue reminder${overdue.length > 1 ? 's' : ''}`
        : `${overdue.length} promemoria scadut${overdue.length > 1 ? 'i' : 'o'}`,
    )
  }
  if (calOk && timedCount) {
    overviewBits.push(
      lang === 'en'
        ? `${timedCount} event${timedCount > 1 ? 's' : ''} today`
        : `${timedCount} impegn${timedCount > 1 ? 'i' : 'o'} oggi`,
    )
  }
  if (remOk && todayRem.length && !overdue.length) {
    overviewBits.push(
      lang === 'en'
        ? `${todayRem.length} reminder${todayRem.length > 1 ? 's' : ''} today`
        : `${todayRem.length} cos${todayRem.length > 1 ? 'e' : 'a'} da ricordare oggi`,
    )
  }

  if (overviewBits.length) {
    if (lang === 'en') {
      lines.push(`You have ${overviewBits.join(' and ')}.`)
    } else {
      lines.push(`Hai ${overviewBits.join(' e ')}.`)
    }
  } else if (quiet && calOk && remOk) {
    lines.push(
      lang === 'en'
        ? 'Nothing on the calendar or reminders for today.'
        : 'Per il resto, la giornata è libera.',
    )
  }

  // Prossimo
  if (nextEv) {
    const t = formatWhenMs(nextEv.whenMs, tz, lang)
    lines.push('')
    if (lang === 'en') {
      lines.push(
        nextEv.soon
          ? `Next: ${safeTitle(nextEv.title)}${t ? ` at ${t}` : ''} — coming up soon.`
          : `Next: ${safeTitle(nextEv.title)}${t ? ` at ${t}` : ''}.`,
      )
    } else {
      lines.push(
        nextEv.soon
          ? `Prossimo: ${safeTitle(nextEv.title)}${t ? ` alle ${t}` : ''} — tra poco.`
          : `Prossimo: ${safeTitle(nextEv.title)}${t ? ` alle ${t}` : ''}.`,
      )
    }
  }

  // Oggi — remaining timed + all-day (skip duplicating next)
  const later = [...timedRest, ...allDay]
  if (later.length) {
    lines.push('')
    lines.push(lang === 'en' ? 'Later today:' : 'Oggi:')
    for (const it of later.slice(0, 5)) {
      if (it.allDay) {
        lines.push(`• ${safeTitle(it.title)} (${lang === 'en' ? 'all day' : 'tutto il giorno'})`)
      } else {
        const t = formatWhenMs(it.whenMs, tz, lang)
        lines.push(`• ${safeTitle(it.title)}${t ? ` — ${t}` : ''}`)
      }
    }
  } else if (cal.status === 'empty' && !nextEv) {
    // omit redundant if quiet already said
  } else if (['disconnected', 'disabled', 'error', 'timeout', 'unavailable'].includes(cal.status)) {
    // Subtle — only if no calendar content and other sources exist
    if ((remOk && (overdue.length || todayRem.length)) || weatherItem) {
      // one soft line max, not nagging
    }
  }

  // Da ricordare
  if (overdue.length || todayRem.length) {
    lines.push('')
    lines.push(lang === 'en' ? 'To remember:' : 'Da ricordare:')
    for (const it of overdue.slice(0, 4)) {
      const t = formatWhenMs(it.whenMs, tz, lang)
      lines.push(
        lang === 'en'
          ? `• ${safeTitle(it.title)}${t ? ` (${t}, overdue)` : ' (overdue)'}`
          : `• ${safeTitle(it.title)}${t ? ` (${t}, scaduto)` : ' (scaduto)'}`,
      )
    }
    for (const it of todayRem.slice(0, 4)) {
      const t = formatWhenMs(it.whenMs, tz, lang)
      lines.push(`• ${safeTitle(it.title)}${t ? ` — ${t}` : ''}`)
    }
  } else if (['error', 'timeout'].includes(rem.status)) {
    lines.push('')
    lines.push(
      lang === 'en'
        ? 'Reminders aren’t available right now.'
        : 'I promemoria non sono disponibili al momento.',
    )
  }

  // Meteo
  if (weatherItem?.snapshot) {
    const s = weatherItem.snapshot
    const place = s.locationLabel || ''
    const range =
      typeof s.temperatureMinC === 'number' && typeof s.temperatureMaxC === 'number'
        ? `${s.temperatureMinC}–${s.temperatureMaxC} °C`
        : typeof s.temperatureC === 'number'
          ? `${s.temperatureC} °C`
          : ''
    lines.push('')
    if (s.umbrellaRecommended || s.rainLikely) {
      lines.push(
        lang === 'en'
          ? `${place ? `${place}: ` : ''}${range ? `${range}. ` : ''}Rain looks likely later — an umbrella may help.`
          : `${place ? `${place}: ` : ''}${range ? `${range}. ` : ''}Nel pomeriggio potrebbe piovere: potrebbe esserti utile portare un ombrello.`,
      )
    } else if (range) {
      lines.push(
        lang === 'en'
          ? `${place ? `${place}: ` : ''}about ${range} today.`
          : `${place ? `${place}: ` : ''}oggi intorno a ${range}.`,
      )
    }
  } else if (wx.status === 'location_required') {
    // Avoid aggressive prompt every briefing — only when no other content
    if (!overviewBits.length && !nextEv && !overdue.length && !todayRem.length) {
      lines.push('')
      lines.push(
        lang === 'en'
          ? 'I don’t have a weather location yet — say a city next time if you want meteo.'
          : 'Non ho ancora una posizione meteo — indicami una città la prossima volta se vuoi includerlo.',
      )
    }
  }

  // Nothing usable
  const unavail = unavailableSources(model)
  const hasAnyFact =
    overdue.length ||
    nextEv ||
    later.length ||
    todayRem.length ||
    weatherItem ||
    (cal.status === 'empty' && rem.status === 'empty')

  if (!hasAnyFact) {
    lines.push('')
    if (unavail.length >= 2 || (!calOk && !remOk && wx.status !== 'ok')) {
      lines.push(
        lang === 'en'
          ? 'There isn’t enough connected information to build a useful briefing right now.'
          : 'Non ci sono abbastanza informazioni collegate per costruire un briefing utile al momento.',
      )
    } else {
      lines.push(
        lang === 'en'
          ? 'I couldn’t assemble today’s briefing. Try again shortly.'
          : 'Non riesco a comporre il briefing di oggi. Riprova tra poco.',
      )
    }
  }

  // Soft calendar unavailable note (once, subtle)
  if (
    ['disconnected', 'disabled'].includes(cal.status) &&
    (todayRem.length || overdue.length || weatherItem)
  ) {
    // intentionally omit nag — calendar absence already reflected by missing events
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  // Collapse double blanks
  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text, priorities, presentationItems }
}

/**
 * @param {object} model
 * @param {'it'|'en'} language
 * @param {{ now?: Date }} [opts]
 */
export function renderDailyBriefing(model, language = 'it', opts = {}) {
  return composeDailyBriefing(model, language, opts).text
}

/**
 * Compact UI chips — Kami-quiet source status.
 */
export function buildBriefingUi(model, language = 'it') {
  const chips = []
  const cal = model.calendar
  const rem = model.reminders
  const wx = model.weather
  const lang = language === 'en' ? 'en' : 'it'

  if (cal?.status === 'ok' && cal.items?.length) {
    chips.push({
      id: 'calendar',
      label:
        lang === 'en'
          ? `${cal.items.length} event${cal.items.length > 1 ? 's' : ''}`
          : `${cal.items.length} impegn${cal.items.length > 1 ? 'i' : 'o'}`,
    })
  } else if (['disconnected', 'disabled', 'error', 'timeout'].includes(cal?.status)) {
    chips.push({
      id: 'calendar-na',
      label: lang === 'en' ? 'Calendar unavailable' : 'Calendario non disponibile',
      muted: true,
    })
  }

  if (rem?.status === 'ok') {
    const overdue = rem.overdue?.length || 0
    const today = rem.today?.length || 0
    const n = overdue + today
    if (n) {
      chips.push({
        id: 'reminders',
        label:
          lang === 'en'
            ? `${n} reminder${n > 1 ? 's' : ''}${overdue ? ` · ${overdue} overdue` : ''}`
            : `${n} promemoria${overdue ? ` · ${overdue} scadut${overdue > 1 ? 'i' : 'o'}` : ''}`,
      })
    }
  }

  if (wx?.status === 'ok' && typeof wx.snapshot?.temperatureC === 'number') {
    chips.push({ id: 'weather', label: `${wx.snapshot.temperatureC}°` })
  } else if (wx?.status === 'ok' && wx.snapshot?.temperatureMaxC != null) {
    chips.push({ id: 'weather', label: `${wx.snapshot.temperatureMaxC}°` })
  }

  if (!chips.length) return null
  return { kind: 'summary', chips }
}
