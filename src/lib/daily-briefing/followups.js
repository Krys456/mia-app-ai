/**
 * #334B — Deterministic briefing follow-up answers from active session context.
 * No model calls. Facts only from verified context items.
 */

import { formatWhenMs, safeTitle } from './render.js'

function langOf(ctx, language) {
  return language === 'en' || ctx?.language === 'en' ? 'en' : 'it'
}

/**
 * @param {object} ctx
 * @returns {object[]}
 */
export function contextPresentation(ctx) {
  if (Array.isArray(ctx?.presentationItems) && ctx.presentationItems.length) {
    return ctx.presentationItems
  }
  // Legacy context: synthesize from calendar + reminders
  const items = []
  for (const ev of ctx?.calendarItems || []) {
    items.push({
      id: `cal-${ev.id}`,
      kind: ev.allDay ? 'all_day_event' : 'timed_event',
      source: 'calendar',
      title: ev.title,
      when: ev.start,
      whenMs: ev.allDay ? null : Date.parse(ev.start) || null,
      raw: ev,
    })
  }
  for (const r of ctx?.reminderItems || []) {
    items.push({
      id: `rem-${r.id}`,
      kind: r.overdue ? 'overdue_reminder' : 'today_reminder',
      source: 'reminders',
      title: r.title,
      when: r.fireAt,
      whenMs: Date.parse(r.fireAt) || null,
      overdue: Boolean(r.overdue),
      raw: r,
    })
  }
  if (ctx?.weatherSnapshot) {
    items.push({
      id: 'wx-day',
      kind: 'weather',
      source: 'weather',
      title: ctx.weatherSnapshot.locationLabel || 'weather',
      snapshot: ctx.weatherSnapshot,
      rainLikely: Boolean(
        ctx.weatherSnapshot.umbrellaRecommended || ctx.weatherSnapshot.rainLikely,
      ),
    })
  }
  return items.map((it, i) => ({ ...it, ordinal: i + 1 }))
}

function describeItem(it, language, timeZone) {
  const lang = language === 'en' ? 'en' : 'it'
  const title = safeTitle(it.title)
  if (it.kind === 'weather' || it.source === 'weather') {
    const s = it.snapshot || {}
    const range =
      s.temperatureMinC != null && s.temperatureMaxC != null
        ? `${s.temperatureMinC}–${s.temperatureMaxC} °C`
        : s.temperatureC != null
          ? `${s.temperatureC} °C`
          : ''
    const rain =
      s.umbrellaRecommended || s.rainLikely
        ? lang === 'en'
          ? ' Rain possible.'
          : ' Possibile pioggia.'
        : ''
    return lang === 'en'
      ? `Weather${s.locationLabel ? ` in ${s.locationLabel}` : ''}: ${range}.${rain}`.trim()
      : `Meteo${s.locationLabel ? ` a ${s.locationLabel}` : ''}: ${range}.${rain}`.trim()
  }
  const t = formatWhenMs(it.whenMs, timeZone, lang)
  if (it.kind === 'overdue_reminder') {
    return lang === 'en'
      ? `Overdue reminder: ${title}${t ? ` (${t})` : ''}.`
      : `Promemoria scaduto: ${title}${t ? ` (${t})` : ''}.`
  }
  if (it.source === 'reminders') {
    return lang === 'en'
      ? `Reminder: ${title}${t ? ` at ${t}` : ''}.`
      : `Promemoria: ${title}${t ? ` alle ${t}` : ''}.`
  }
  if (it.allDay || it.kind === 'all_day_event') {
    return lang === 'en' ? `All day: ${title}.` : `Tutto il giorno: ${title}.`
  }
  return lang === 'en'
    ? `${title}${t ? ` at ${t}` : ''}.`
    : `${title}${t ? ` alle ${t}` : ''}.`
}

function timedPersonal(items) {
  return (items || []).filter(
    (i) =>
      (i.source === 'calendar' || i.source === 'reminders') &&
      i.kind !== 'weather' &&
      i.kind !== 'quiet',
  )
}

/**
 * @param {{ followUpKind: string, beforeHour?: number | null, ordinal?: number | null }} intent
 * @param {object} ctx
 * @param {'it'|'en'} language
 * @param {{ now?: Date }} [opts]
 */
export function answerBriefingFollowUp(intent, ctx, language, opts = {}) {
  const lang = langOf(ctx, language)
  const tz = ctx.timezone || 'UTC'
  const now = opts.now || new Date()
  const nowMs = now.getTime()
  const items = contextPresentation(ctx)
  const kind = intent.followUpKind
  let focusIndex =
    typeof ctx.focusIndex === 'number' && ctx.focusIndex >= 0 ? ctx.focusIndex : -1

  const withFocus = (reply, nextFocus, extra = {}) => ({
    handled: true,
    reply,
    briefingContext: {
      ...ctx,
      focusIndex: nextFocus,
      ...extra,
    },
    diag: {
      dailyBriefingIntent: 'daily-briefing',
      operation: `follow_up_${kind}`,
      contextReused: true,
      failureCode: null,
    },
  })

  if (kind === 'ordinal') {
    const n = intent.ordinal
    if (!n || n < 1) {
      return withFocus(
        lang === 'en'
          ? 'Which point do you mean? Try “the first” or “the second”.'
          : 'Quale punto intendi? Prova con “il primo” o “il secondo”.',
        focusIndex,
        { failureSoft: true },
      )
    }
    const it = items.find((i) => i.ordinal === n) || items[n - 1]
    if (!it || it.kind === 'quiet') {
      return withFocus(
        lang === 'en'
          ? `There isn’t a clear point #${n} in the latest briefing.`
          : `Nel briefing recente non c’è un punto ${n} chiaro.`,
        focusIndex,
      )
    }
    const idx = items.indexOf(it)
    return withFocus(describeItem(it, lang, tz), idx)
  }

  if (kind === 'next_event' || kind === 'first_event' || kind === 'prossimo') {
    const pool = timedPersonal(items).filter((i) => i.source === 'calendar' || i.whenMs != null)
    const upcoming = pool
      .filter((i) => i.whenMs == null || i.whenMs >= nowMs - 5 * 60 * 1000)
      .sort((a, b) => (a.whenMs ?? 0) - (b.whenMs ?? 0))
    const next = upcoming[0] || pool[0]
    if (!next) {
      return withFocus(
        lang === 'en'
          ? 'No upcoming appointment in the latest briefing.'
          : 'Nessun prossimo impegno nel briefing recente.',
        focusIndex,
      )
    }
    const idx = items.indexOf(next)
    return withFocus(
      lang === 'en'
        ? `Next: ${describeItem(next, lang, tz)}`
        : `Prossimo: ${describeItem(next, lang, tz)}`,
      idx >= 0 ? idx : focusIndex,
    )
  }

  if (kind === 'after' || kind === 'e_dopo') {
    const pool = timedPersonal(items).sort((a, b) => (a.whenMs ?? 0) - (b.whenMs ?? 0))
    let startFrom = focusIndex + 1
    if (focusIndex < 0) {
      // after "next" default: first upcoming then the one after
      const upcomingIdx = pool.findIndex((i) => i.whenMs == null || i.whenMs >= nowMs - 5 * 60 * 1000)
      startFrom = upcomingIdx >= 0 ? upcomingIdx + 1 : 1
    } else {
      // find position in pool relative to focused item
      const focused = items[focusIndex]
      const pIdx = pool.findIndex((i) => i.id === focused?.id)
      startFrom = pIdx >= 0 ? pIdx + 1 : focusIndex + 1
    }
    const next = pool[startFrom] || null
    if (!next) {
      return withFocus(
        lang === 'en'
          ? 'Nothing else after that in the latest briefing.'
          : 'Dopo quello non c’è altro nel briefing recente.',
        focusIndex,
      )
    }
    const idx = items.indexOf(next)
    return withFocus(
      lang === 'en' ? `After that: ${describeItem(next, lang, tz)}` : `Dopo: ${describeItem(next, lang, tz)}`,
      idx >= 0 ? idx : focusIndex,
    )
  }

  if (kind === 'before_time') {
    const hour = intent.beforeHour
    if (hour == null || hour < 0 || hour > 23) {
      return withFocus(
        lang === 'en' ? 'Tell me a time, for example before 14:00.' : 'Indicami un orario, ad esempio prima delle 14.',
        focusIndex,
      )
    }
    // Build cutoff as today at hour:00 in zone — approximate via formatting now's date key
    const dateKey = String(ctx.targetDate || '').slice(0, 10)
    let cutoffMs = null
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      // Interpret as local wall time by probing offsets (best-effort without luxon)
      cutoffMs = wallTimeToUtcMs(dateKey, hour, 0, tz)
    }
    if (cutoffMs == null) {
      return withFocus(
        lang === 'en'
          ? 'I couldn’t interpret that time against the briefing day.'
          : 'Non riesco a interpretare quell’orario rispetto al giorno del briefing.',
        focusIndex,
      )
    }
    const hits = timedPersonal(items).filter((i) => {
      if (i.whenMs == null) return false
      return i.whenMs < cutoffMs
    })
    if (!hits.length) {
      return withFocus(
        lang === 'en'
          ? `Nothing scheduled before ${String(hour).padStart(2, '0')}:00 in the latest briefing.`
          : `Niente in programma prima delle ${String(hour).padStart(2, '0')}:00 nel briefing recente.`,
        focusIndex,
      )
    }
    const list = hits
      .slice(0, 8)
      .map((i) => `• ${safeTitle(i.title)}${i.whenMs ? ` — ${formatWhenMs(i.whenMs, tz, lang)}` : ''}`)
      .join('\n')
    return withFocus(
      lang === 'en'
        ? `Before ${String(hour).padStart(2, '0')}:00:\n${list}`
        : `Prima delle ${String(hour).padStart(2, '0')}:00:\n${list}`,
      items.indexOf(hits[0]),
    )
  }

  if (kind === 'reminders') {
    const rems = items.filter((i) => i.source === 'reminders')
    if (!rems.length) {
      return withFocus(
        lang === 'en' ? 'No reminders in the latest briefing.' : 'Nessun promemoria nel briefing recente.',
        focusIndex,
      )
    }
    const list = rems
      .slice(0, 8)
      .map((i) => `• ${safeTitle(i.title)}${i.overdue ? (lang === 'en' ? ' (overdue)' : ' (scaduto)') : ''}`)
      .join('\n')
    return withFocus(list, focusIndex)
  }

  if (kind === 'overdue') {
    const rems = items.filter((i) => i.kind === 'overdue_reminder' || i.overdue)
    if (!rems.length) {
      return withFocus(
        lang === 'en' ? 'Nothing overdue in the latest briefing.' : 'Niente di scaduto nel briefing recente.',
        focusIndex,
      )
    }
    const list = rems.map((i) => `• ${safeTitle(i.title)}`).join('\n')
    return withFocus(list, items.indexOf(rems[0]))
  }

  if (kind === 'weather' || kind === 'umbrella') {
    const snap = ctx.weatherSnapshot || items.find((i) => i.kind === 'weather')?.snapshot
    if (!snap) {
      return withFocus(
        lang === 'en'
          ? 'No weather in the latest briefing.'
          : 'Nessun meteo nel briefing recente.',
        focusIndex,
      )
    }
    if (kind === 'umbrella') {
      const yes = Boolean(snap.umbrellaRecommended || snap.rainLikely)
      return withFocus(
        yes
          ? lang === 'en'
            ? 'Yes — rain looks likely; I’d bring an umbrella.'
            : 'Sì — sembra probabile la pioggia; porterei l’ombrello.'
          : lang === 'en'
            ? 'No strong rain signal in the briefing weather.'
            : 'Nel meteo del briefing non c’è un segnale forte di pioggia.',
        focusIndex,
      )
    }
    const place = snap.locationLabel || ''
    const range =
      snap.temperatureMinC != null && snap.temperatureMaxC != null
        ? `${snap.temperatureMinC}–${snap.temperatureMaxC} °C`
        : snap.temperatureC != null
          ? `${snap.temperatureC} °C`
          : ''
    return withFocus(`${place ? `${place}: ` : ''}${range}`.trim(), focusIndex)
  }

  // #334C
  if (kind === 'free_windows') {
    const fws = ctx.schedule?.freeWindows || []
    if (!fws.length) {
      return withFocus(
        lang === 'en'
          ? 'I don’t see a clear free window in the latest briefing.'
          : 'Non vedo una finestra libera chiara nel briefing recente.',
        focusIndex,
      )
    }
    const parts = fws.slice(0, 3).map((fw) => {
      if (fw.kind === 'all_day') {
        return lang === 'en' ? 'The day looks open on the calendar.' : 'La giornata risulta libera in calendario.'
      }
      if (fw.kind === 'until_first') {
        const t = formatWhenMs(fw.toMs, tz, lang)
        return lang === 'en'
          ? `Free until about ${t} (~${fw.minutes} min).`
          : `Libero fino alle ${t} (circa ${fw.minutes} min).`
      }
      return lang === 'en'
        ? `About ${fw.minutes} free minutes between events.`
        : `Circa ${fw.minutes} minuti liberi tra gli impegni.`
    })
    return withFocus(parts.join('\n'), focusIndex)
  }

  if (kind === 'overlaps') {
    const ov = ctx.schedule?.overlaps || []
    if (!ov.length) {
      return withFocus(
        lang === 'en'
          ? 'No overlapping events in the latest briefing.'
          : 'Nessun impegno sovrapposto nel briefing recente.',
        focusIndex,
      )
    }
    const list = ov
      .slice(0, 4)
      .map(
        (o) =>
          `• ${safeTitle(o.a.title)} ↔ ${safeTitle(o.b.title)}`,
      )
      .join('\n')
    return withFocus(
      lang === 'en' ? `Overlaps:\n${list}` : `Sovrapposizioni:\n${list}`,
      focusIndex,
    )
  }

  if (kind === 'time_until_next') {
    const mins = ctx.schedule?.minutesUntilNext
    const next = ctx.schedule?.next
    if (mins == null || !next) {
      return withFocus(
        lang === 'en'
          ? 'No upcoming timed event in the latest briefing.'
          : 'Nessun prossimo impegno a orario nel briefing recente.',
        focusIndex,
      )
    }
    return withFocus(
      lang === 'en'
        ? `About ${mins} minutes until ${safeTitle(next.title)}.`
        : `Circa ${mins} minuti prima di ${safeTitle(next.title)}.`,
      focusIndex,
    )
  }

  if (kind === 'reminder_count') {
    const rems = items.filter((i) => i.source === 'reminders')
    const n = rems.length
    return withFocus(
      lang === 'en'
        ? n
          ? `You have ${n} reminder${n > 1 ? 's' : ''} in the latest briefing.`
          : 'No reminders in the latest briefing.'
        : n
          ? `Hai ${n} promemoria nel briefing recente.`
          : 'Nessun promemoria nel briefing recente.',
      focusIndex,
    )
  }

  if (kind === 'most_urgent') {
    const first = items.find((i) => i.kind !== 'quiet') || items[0]
    if (!first) {
      return withFocus(
        lang === 'en'
          ? 'Nothing urgent stood out in the latest briefing.'
          : 'Nel briefing recente non emerge nulla di particolarmente urgente.',
        focusIndex,
      )
    }
    return withFocus(
      lang === 'en'
        ? `Most urgent: ${describeItem(first, lang, tz)}`
        : `Più urgente: ${describeItem(first, lang, tz)}`,
      items.indexOf(first),
    )
  }

  return withFocus(
    lang === 'en'
      ? 'Ask for a new briefing for an updated summary.'
      : 'Chiedi un nuovo briefing per un riepilogo aggiornato.',
    focusIndex,
  )
}

/**
 * Best-effort local wall clock → UTC ms for YYYY-MM-DD HH:mm in IANA zone.
 * @param {string} dateKey
 * @param {number} hour
 * @param {number} minute
 * @param {string} timeZone
 */
export function wallTimeToUtcMs(dateKey, hour, minute, timeZone) {
  // Guess UTC candidates around the civil date
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return null
  let best = null
  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const utc = Date.UTC(y, m - 1, d, hour, minute) - offsetMin * 60 * 1000
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const parts = fmt.formatToParts(new Date(utc))
      const get = (t) => parts.find((p) => p.type === t)?.value
      const hy = Number(get('year'))
      const hm = Number(get('month'))
      const hd = Number(get('day'))
      let hh = Number(get('hour'))
      if (hh === 24) hh = 0
      const mi = Number(get('minute'))
      if (hy === y && hm === m && hd === d && hh === hour && mi === minute) {
        best = utc
        break
      }
    } catch {
      /* continue */
    }
  }
  return best
}
