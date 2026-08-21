/**
 * #336B — Deterministic Calendar chat renderer (Italian-first).
 * Verified facts only. Zero model calls.
 */

import { localHourMinute } from './free-time.js'

export function safeTitle(title) {
  return String(title || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '(senza titolo)'
}

export function formatEventTime(ev, timeZone, language = 'it') {
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

export function formatMs(ms, timeZone, language = 'it') {
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

function dayPhrase(labelDay, language) {
  const it = {
    today: 'oggi',
    tomorrow: 'domani',
    day_after_tomorrow: 'dopodomani',
    week: 'questa settimana',
    next: 'in programma',
    lunedi: 'lunedì',
    martedi: 'martedì',
    mercoledi: 'mercoledì',
    giovedi: 'giovedì',
    venerdi: 'venerdì',
    sabato: 'sabato',
    domenica: 'domenica',
    weekday: 'quel giorno',
  }
  const en = {
    today: 'today',
    tomorrow: 'tomorrow',
    day_after_tomorrow: 'the day after tomorrow',
    week: 'this week',
    next: 'upcoming',
  }
  if (language === 'en') return en[labelDay] || labelDay || 'that day'
  return it[labelDay] || labelDay || 'quel giorno'
}

export function failureReply(status, language = 'it') {
  const it = {
    disabled: 'Il calendario non è attivo in questo ambiente.',
    disconnected: 'Collega Google Calendar in Impostazioni per vedere i tuoi impegni.',
    reconnect_required: 'Ricollega Google Calendar: l’accesso è scaduto.',
    timeout: 'Il calendario sta impiegando troppo a rispondere. Riprova tra poco.',
    error: 'Non riesco a leggere il calendario in questo momento.',
    auth_required: 'Collega Google Calendar in Impostazioni per vedere i tuoi impegni.',
  }
  const en = {
    disabled: 'Calendar is not enabled in this environment.',
    disconnected: 'Connect Google Calendar in Settings to see your events.',
    reconnect_required: 'Reconnect Google Calendar: access has expired.',
    timeout: 'Calendar is taking too long to respond. Try again shortly.',
    error: 'I can’t read the calendar right now.',
    auth_required: 'Connect Google Calendar in Settings to see your events.',
  }
  const table = language === 'en' ? en : it
  return table[status] || table.error
}

/**
 * @param {{
 *   events: object[]
 *   status: string
 *   language?: 'it'|'en'
 *   timeZone: string
 *   labelDay: string
 *   queryType: string
 *   afterHour?: number|null
 *   partOfDay?: string|null
 *   freeWindows?: { fromMs: number, toMs: number, minutes: number }[]
 * }} input
 */
export function renderCalendarAnswer(input) {
  const language = input.language === 'en' ? 'en' : 'it'
  const tz = input.timeZone || 'UTC'
  const status = input.status

  if (status && status !== 'ok' && status !== 'empty') {
    return failureReply(status, language)
  }

  const day = dayPhrase(input.labelDay, language)
  const events = Array.isArray(input.events) ? input.events : []

  if (input.queryType === 'free_time') {
    const windows = input.freeWindows || []
    if (!windows.length) {
      return language === 'en'
        ? `No free windows between 08:00 and 20:00 ${day}.`
        : `${day.charAt(0).toUpperCase() + day.slice(1)} non risultano finestre libere tra le 08:00 e le 20:00.`
    }
    const parts = windows.map((w) => {
      const a = formatMs(w.fromMs, tz, language)
      const b = formatMs(w.toMs, tz, language)
      return language === 'en' ? `from ${a} to ${b}` : `dalle ${a} alle ${b}`
    })
    if (language === 'en') {
      return `You are free ${day} ${parts.join(', and ')}.`
    }
    return `${day.charAt(0).toUpperCase() + day.slice(1)} sei libero ${parts.join(' e ')}.`
  }

  if (!events.length || status === 'empty') {
    if (input.queryType === 'after_time' && input.afterHour != null) {
      return language === 'en'
        ? `No events after ${String(input.afterHour).padStart(2, '0')}:00 ${day}.`
        : `Dopo le ${String(input.afterHour).padStart(2, '0')} ${day} non risultano impegni.`
    }
    if (input.queryType === 'part_of_day' && input.partOfDay === 'afternoon') {
      return language === 'en'
        ? `No afternoon events ${day}.`
        : `${day.charAt(0).toUpperCase() + day.slice(1)} non risultano impegni nel pomeriggio.`
    }
    if (input.queryType === 'next') {
      return language === 'en'
        ? 'No upcoming events in the next few days.'
        : 'Non risultano impegni in programma nei prossimi giorni.'
    }
    return language === 'en'
      ? `No events on your calendar ${day}.`
      : `${day.charAt(0).toUpperCase() + day.slice(1)} non risultano impegni nel calendario.`
  }

  if (input.queryType === 'next' || events.length === 1) {
    const ev = events[0]
    const time = formatEventTime(ev, tz, language)
    const title = safeTitle(ev.title)
    if (language === 'en') {
      if (ev.allDay) return `Your next event is ${day} (all day): ${title}.`
      return `Your next event is ${day} at ${time}: ${title}.`
    }
    if (input.queryType === 'next') {
      if (ev.allDay) return `Il tuo prossimo impegno è ${day} (tutto il giorno): ${title}.`
      return `Il tuo prossimo impegno è ${day} alle ${time}: ${title}.`
    }
    if (ev.allDay) return `${day.charAt(0).toUpperCase() + day.slice(1)} hai un impegno (tutto il giorno): ${title}.`
    return `${day.charAt(0).toUpperCase() + day.slice(1)} hai un impegno alle ${time}: ${title}.`
  }

  const lines = events.map((ev) => {
    const time = formatEventTime(ev, tz, language)
    const title = safeTitle(ev.title)
    if (language === 'en') return `• ${time} — ${title}`
    return `• ${time} — ${title}`
  })

  if (input.queryType === 'after_time' && input.afterHour != null) {
    const hh = String(input.afterHour).padStart(2, '0')
    if (language === 'en') {
      return `After ${hh}:00 you have ${events.length} events:\n${lines.join('\n')}`
    }
    return `Dopo le ${hh} hai ${events.length} impegni:\n${lines.join('\n')}`
  }

  if (language === 'en') {
    return `${day.charAt(0).toUpperCase() + day.slice(1)} you have ${events.length} events:\n${lines.join('\n')}`
  }
  return `${day.charAt(0).toUpperCase() + day.slice(1)} hai ${events.length} impegni:\n${lines.join('\n')}`
}

/**
 * Follow-up answers from active context.
 */
export function renderCalendarFollowUp(kind, ctx, opts = {}) {
  const language = ctx.language === 'en' ? 'en' : 'it'
  const tz = ctx.timezone || 'UTC'
  const events = Array.isArray(ctx.events) ? ctx.events : []
  const now = opts.now instanceof Date ? opts.now : new Date()

  if (kind === 'ordinal') {
    const idx = opts.ordinalIndex
    if (idx == null || idx < 0 || idx >= events.length) {
      return language === 'en'
        ? 'I don’t have that event in the recent calendar answer.'
        : 'Non ho quell’impegno nella risposta recente del calendario.'
    }
    const ev = events[idx]
    const time = formatEventTime(ev, tz, language)
    const title = safeTitle(ev.title)
    const labels = language === 'en' ? ['first', 'second', 'third'] : ['primo', 'secondo', 'terzo']
    const label = labels[idx] || String(idx + 1)
    if (language === 'en') return `The ${label} is at ${time}: ${title}.`
    return `Il ${label} è alle ${time}: ${title}.`
  }

  if (kind === 'next_after') {
    const focus = typeof ctx.focusIndex === 'number' ? ctx.focusIndex : -1
    const nextIdx = focus >= 0 ? focus + 1 : 0
    if (nextIdx >= events.length) {
      return language === 'en'
        ? 'There are no further events in that list.'
        : 'Non ci sono altri impegni in quell’elenco.'
    }
    const ev = events[nextIdx]
    const time = formatEventTime(ev, tz, language)
    const title = safeTitle(ev.title)
    if (language === 'en') return `Next: ${time} — ${title}.`
    return `Dopo: ${time} — ${title}.`
  }

  if (kind === 'time_until') {
    const focus = typeof ctx.focusIndex === 'number' && ctx.focusIndex >= 0 ? ctx.focusIndex : 0
    const ev = events[focus]
    if (!ev || ev.allDay) {
      return language === 'en'
        ? 'I can’t measure time until an all-day or missing event.'
        : 'Non riesco a calcolare quanto manca per un impegno assente o tutto il giorno.'
    }
    const startMs = Date.parse(ev.start)
    if (!Number.isFinite(startMs)) {
      return failureReply('error', language)
    }
    const mins = Math.round((startMs - now.getTime()) / 60000)
    const title = safeTitle(ev.title)
    if (mins <= 0) {
      return language === 'en'
        ? `${title} has already started or is starting now.`
        : `${title} è già iniziato o sta iniziando ora.`
    }
    if (mins < 60) {
      return language === 'en'
        ? `${mins} minutes until ${title}.`
        : `Mancano ${mins} minuti a ${title}.`
    }
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (language === 'en') {
      return m ? `About ${h}h ${m}m until ${title}.` : `About ${h}h until ${title}.`
    }
    return m ? `Mancano circa ${h}h ${m}m a ${title}.` : `Mancano circa ${h}h a ${title}.`
  }

  if (kind === 'free_time') {
    return renderCalendarAnswer({
      events,
      status: 'ok',
      language,
      timeZone: tz,
      labelDay: ctx.labelDay || 'today',
      queryType: 'free_time',
      freeWindows: opts.freeWindows || [],
    })
  }

  if (kind === 'after_time' || kind === 'before_time') {
    const filtered = opts.filteredEvents || []
    return renderCalendarAnswer({
      events: filtered,
      status: filtered.length ? 'ok' : 'empty',
      language,
      timeZone: tz,
      labelDay: ctx.labelDay || 'today',
      queryType: kind === 'after_time' ? 'after_time' : 'list',
      afterHour: opts.hour,
    })
  }

  return language === 'en'
    ? 'I’m not sure which calendar detail you mean.'
    : 'Non ho capito a quale dettaglio del calendario ti riferisci.'
}

export { localHourMinute }
