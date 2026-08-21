/**
 * #334B — Deterministic Daily Briefing rendering (IT/EN).
 * Editorial conversational prose from verified priorities. No Core / no model.
 */

import {
  buildBriefingPriorities,
  dayPartInZone,
  presentationItemsForOrdinals,
} from './priority.js'
import { analyzeSchedule } from './schedule.js'

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
 * @param {{ now?: Date, length?: 'concise'|'balanced'|'detailed', schedule?: object|null }} [opts]
 * @returns {{ text: string, priorities: object[], presentationItems: object[], schedule: object|null }}
 */
export function composeDailyBriefing(model, language = 'it', opts = {}) {
  const lang = language === 'en' ? 'en' : 'it'
  const length =
    opts.length === 'concise' || opts.length === 'detailed' ? opts.length : 'balanced'
  const tz = model.timezone || 'UTC'
  const now = opts.now || new Date()
  const part = dayPartInZone(tz, now)
  const schedule =
    opts.schedule ||
    analyzeSchedule(model.calendar?.items || [], { now, timeZone: tz })
  const priorities = buildBriefingPriorities(model, { now, schedule })
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

  const timedCount = (nextEv ? 1 : 0) + timedRest.length + allDay.length
  const calOk = cal.status === 'ok' || cal.status === 'empty'
  const remOk = rem.status === 'ok' || rem.status === 'empty'
  const remHidden = Boolean(rem.hiddenByPref)
  const calHidden = Boolean(cal.hiddenByPref)
  const wxHidden = Boolean(wx.hiddenByPref)

  // Overview
  const overviewBits = []
  if (overdue.length) {
    overviewBits.push(
      lang === 'en'
        ? `${overdue.length} overdue reminder${overdue.length > 1 ? 's' : ''}`
        : `${overdue.length} promemoria scadut${overdue.length > 1 ? 'i' : 'o'}`,
    )
  }
  if (calOk && !calHidden && timedCount) {
    overviewBits.push(
      lang === 'en'
        ? `${timedCount} event${timedCount > 1 ? 's' : ''} today`
        : `${timedCount} impegn${timedCount > 1 ? 'i' : 'o'} oggi`,
    )
  }
  if (remOk && !remHidden && todayRem.length && !overdue.length) {
    overviewBits.push(
      lang === 'en'
        ? `${todayRem.length} reminder${todayRem.length > 1 ? 's' : ''} today`
        : `${todayRem.length} cos${todayRem.length > 1 ? 'e' : 'a'} da ricordare oggi`,
    )
  }

  if (overviewBits.length) {
    lines.push(lang === 'en' ? `You have ${overviewBits.join(' and ')}.` : `Hai ${overviewBits.join(' e ')}.`)
  } else if (quiet && calOk && remOk) {
    lines.push(
      lang === 'en'
        ? 'For now the day looks free.'
        : 'Per ora la giornata è libera.',
    )
  }

  // Concise: next + critical overdue + actionable weather only
  if (length === 'concise') {
    if (overdue[0]) {
      lines.push(
        lang === 'en'
          ? `Urgent: ${safeTitle(overdue[0].title)} (overdue).`
          : `Urgente: ${safeTitle(overdue[0].title)} (scaduto).`,
      )
    }
    if (nextEv) {
      const t = formatWhenMs(nextEv.whenMs, tz, lang)
      lines.push(
        lang === 'en'
          ? `Next: ${safeTitle(nextEv.title)}${t ? ` at ${t}` : ''}.`
          : `Prossimo: ${safeTitle(nextEv.title)}${t ? ` alle ${t}` : ''}.`,
      )
    }
    if (weatherItem?.snapshot && (weatherItem.rainLikely || weatherItem.snapshot.umbrellaRecommended)) {
      const place = weatherItem.snapshot.locationLabel || ''
      lines.push(
        lang === 'en'
          ? `${place ? `${place}: ` : ''}rain looks likely — bring an umbrella.`
          : `${place ? `${place}: ` : ''}possibile pioggia — porta un ombrello.`,
      )
    } else if (quiet && weatherItem?.snapshot) {
      const s = weatherItem.snapshot
      const place = s.locationLabel || ''
      const range =
        s.temperatureMinC != null && s.temperatureMaxC != null
          ? `${s.temperatureMinC}–${s.temperatureMaxC} °C`
          : ''
      if (range) {
        lines.push(
          lang === 'en'
            ? `${place ? `In ${place}, ` : ''}about ${range} today.`
            : `${place ? `A ${place} ` : ''}sono previsti circa ${range}.`,
        )
      }
    } else if (quiet && !overdue[0] && !nextEv) {
      // Keep concise quiet days short but not greeting-only.
      if (!overviewBits.length) {
        lines.push(
          lang === 'en'
            ? 'For now the day looks free.'
            : 'Per ora la giornata è libera.',
        )
      }
    } else if (!overdue[0] && !nextEv && !weatherItem) {
      const unavail = unavailableSources(model)
      if (unavail.length >= 2 || (!calOk && !remOk && wx.status !== 'ok')) {
        lines.push(
          lang === 'en'
            ? 'There isn’t enough connected information to build a useful briefing right now.'
            : 'Non ci sono abbastanza informazioni collegate per costruire un briefing utile al momento.',
        )
      }
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    return { text, priorities, presentationItems, schedule }
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

  // Schedule intelligence (balanced + detailed)
  if (schedule?.overlaps?.length) {
    lines.push('')
    lines.push(
      lang === 'en'
        ? 'Note: some events overlap on the calendar.'
        : 'Nota: hai impegni sovrapposti nel calendario.',
    )
  } else if (schedule?.backToBack?.length) {
    lines.push('')
    lines.push(
      lang === 'en'
        ? 'You have two nearly consecutive events.'
        : 'Hai due impegni quasi consecutivi.',
    )
  }

  if (length === 'detailed' && schedule?.freeWindows?.length) {
    const fw = schedule.freeWindows[0]
    if (fw?.kind === 'until_first' && fw.minutes != null) {
      const t = formatWhenMs(fw.toMs, tz, lang)
      lines.push('')
      lines.push(
        lang === 'en'
          ? `You’re free until about ${t} (~${fw.minutes} min).`
          : `Hai la mattina libera fino alle ${t} (circa ${fw.minutes} min).`,
      )
    } else if (fw?.kind === 'between' && fw.minutes != null) {
      lines.push('')
      lines.push(
        lang === 'en'
          ? `Between events you have about ${fw.minutes} free minutes.`
          : `Tra i due impegni hai circa ${fw.minutes} minuti liberi.`,
      )
    }
  }

  // Oggi — remaining
  const laterLimit = length === 'detailed' ? 8 : 5
  const later = [...timedRest, ...allDay]
  if (later.length) {
    lines.push('')
    lines.push(lang === 'en' ? 'Later today:' : 'Oggi:')
    for (const it of later.slice(0, laterLimit)) {
      if (it.allDay) {
        lines.push(`• ${safeTitle(it.title)} (${lang === 'en' ? 'all day' : 'tutto il giorno'})`)
      } else {
        const t = formatWhenMs(it.whenMs, tz, lang)
        lines.push(`• ${safeTitle(it.title)}${t ? ` — ${t}` : ''}`)
      }
    }
  }

  // Reminders — avoid duplicating overdue in overview + list carefully
  if (overdue.length || todayRem.length) {
    lines.push('')
    lines.push(lang === 'en' ? 'To remember:' : 'Da ricordare:')
    const remLimit = length === 'detailed' ? 6 : 4
    for (const it of overdue.slice(0, remLimit)) {
      const t = formatWhenMs(it.whenMs, tz, lang)
      lines.push(
        lang === 'en'
          ? `• ${safeTitle(it.title)}${t ? ` (${t}, overdue)` : ' (overdue)'}`
          : `• ${safeTitle(it.title)}${t ? ` (${t}, scaduto)` : ' (scaduto)'}`,
      )
    }
    const room = Math.max(0, remLimit - Math.min(overdue.length, remLimit))
    for (const it of todayRem.slice(0, room)) {
      const t = formatWhenMs(it.whenMs, tz, lang)
      lines.push(`• ${safeTitle(it.title)}${t ? ` — ${t}` : ''}`)
    }
  } else if (['error', 'timeout'].includes(rem.status) && !remHidden) {
    lines.push('')
    lines.push(
      lang === 'en'
        ? 'Reminders aren’t available right now.'
        : 'I promemoria non sono disponibili al momento.',
    )
  }

  // Meteo
  if (weatherItem?.snapshot && !wxHidden) {
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
      if (quiet) {
        lines.push(
          lang === 'en'
            ? `${place ? `In ${place}, ` : ''}about ${range} today.`
            : `${place ? `A ${place} ` : ''}sono previsti circa ${range}.`,
        )
      } else {
        lines.push(
          lang === 'en'
            ? `${place ? `${place}: ` : ''}about ${range} today.`
            : `${place ? `${place}: ` : ''}oggi intorno a ${range}.`,
        )
      }
    }
  }

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

  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, priorities, presentationItems, schedule }
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
