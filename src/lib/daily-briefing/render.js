/**
 * #321 — Deterministic Daily Briefing rendering (IT/EN). No Core required.
 */

function formatEventTime(ev, timeZone, language) {
  if (ev.allDay) return language === 'en' ? 'all day' : 'tutto il giorno'
  const start = ev.start
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

function formatReminderTime(item, timeZone, language) {
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
 * @param {object} model
 * @param {'it'|'en'} language
 */
export function renderDailyBriefing(model, language = 'it') {
  const lang = language === 'en' ? 'en' : 'it'
  const lines = []
  lines.push(lang === 'en' ? 'Good morning ☀️' : 'Buongiorno ☀️')
  lines.push('')

  const cal = model.calendar || { status: 'unavailable', items: [] }
  const rem = model.reminders || { status: 'unavailable', overdue: [], today: [] }
  const wx = model.weather || { status: 'unavailable' }
  const tz = model.timezone || 'UTC'

  // Priority: overdue reminders first
  if (rem.status === 'ok' && Array.isArray(rem.overdue) && rem.overdue.length) {
    const n = rem.overdue.length
    if (lang === 'en') {
      lines.push(
        `⏰ You have ${n} overdue reminder${n > 1 ? 's' : ''}${
          rem.today?.length ? ` and ${rem.today.length} due today` : ''
        }.`,
      )
      const first = rem.overdue[0]
      lines.push(`   • ${safeTitle(first.title)} (${formatReminderTime(first, tz, lang)})`)
    } else {
      lines.push(
        `⏰ Hai ${n} promemoria scadut${n > 1 ? 'i' : 'o'}${
          rem.today?.length ? ` e ${rem.today.length} per oggi` : ''
        }.`,
      )
      const first = rem.overdue[0]
      lines.push(`   • ${safeTitle(first.title)} (${formatReminderTime(first, tz, lang)})`)
    }
    lines.push('')
  } else if (rem.status === 'ok' && rem.today?.length) {
    const n = rem.today.length
    const first = rem.today[0]
    const t = formatReminderTime(first, tz, lang)
    if (lang === 'en') {
      lines.push(`⏰ You have ${n} reminder${n > 1 ? 's' : ''} today. Next: ${safeTitle(first.title)} at ${t}.`)
    } else {
      lines.push(
        `⏰ Hai ${n} promemoria per oggi. Il prossimo: ${safeTitle(first.title)} alle ${t}.`,
      )
    }
    lines.push('')
  } else if (rem.status === 'empty') {
    // compact — skip verbose empty if other sources speak
  } else if (rem.status === 'disabled' || rem.status === 'unavailable') {
    // omit
  } else if (['error', 'timeout'].includes(rem.status)) {
    lines.push(lang === 'en' ? '⏰ Reminders unavailable right now.' : '⏰ Promemoria non disponibili al momento.')
    lines.push('')
  }

  // Calendar
  if (cal.status === 'ok' && cal.items?.length) {
    const n = cal.items.length
    const first = cal.items[0]
    const t = formatEventTime(first, tz, lang)
    if (lang === 'en') {
      lines.push(
        `📅 You have ${n} event${n > 1 ? 's' : ''} today. First: ${safeTitle(first.title)} at ${t}.`,
      )
    } else {
      lines.push(
        `📅 Oggi hai ${n} appuntament${n > 1 ? 'i' : 'o'}. Il primo: ${safeTitle(first.title)} alle ${t}.`,
      )
    }
    lines.push('')
  } else if (cal.status === 'empty') {
    if (lang === 'en') lines.push('📅 No events today.')
    else lines.push('📅 Nessun appuntamento oggi.')
    lines.push('')
  } else if (['disconnected', 'disabled'].includes(cal.status)) {
    if (lang === 'en') lines.push('📅 Calendar unavailable.')
    else lines.push('📅 Calendario non disponibile in questo momento.')
    lines.push('')
  } else if (['error', 'timeout', 'unavailable'].includes(cal.status)) {
    if (lang === 'en') lines.push('📅 Calendar unavailable right now.')
    else lines.push('📅 Calendario non disponibile in questo momento.')
    lines.push('')
  }

  // Weather
  if (wx.status === 'ok' && wx.snapshot) {
    const s = wx.snapshot
    const place = s.locationLabel || ''
    const range =
      typeof s.temperatureMinC === 'number' && typeof s.temperatureMaxC === 'number'
        ? `${s.temperatureMinC}–${s.temperatureMaxC} °C`
        : typeof s.temperatureC === 'number'
          ? `${s.temperatureC} °C`
          : ''
    let rainBit = ''
    if (s.umbrellaRecommended || s.rainLikely) {
      rainBit =
        lang === 'en'
          ? ' Rain possible — I’d bring an umbrella.'
          : ' Possibile pioggia — porterei l’ombrello.'
    }
    let windBit = ''
    if (typeof s.windSpeedKmh === 'number') {
      windBit =
        lang === 'en' ? ` Wind around ${s.windSpeedKmh} km/h.` : ` Vento intorno ai ${s.windSpeedKmh} km/h.`
    }
    if (lang === 'en') {
      lines.push(`🌤 ${place ? `${place}: ` : ''}${range}.${rainBit}${windBit}`.trim())
    } else {
      lines.push(`🌤 ${place ? `${place}: ` : ''}${range}.${rainBit}${windBit}`.trim())
    }
    lines.push('')
  } else if (wx.status === 'location_required') {
    if (lang === 'en') {
      lines.push('🌤 Weather: tell me a city (or use Weather location) to include it next time.')
    } else {
      lines.push('🌤 Meteo: indicami una città (o usa la posizione meteo) per aggiungerlo al briefing.')
    }
    lines.push('')
  }

  // Empty all
  const calUseful = cal.status === 'ok' || cal.status === 'empty'
  const remUseful = rem.status === 'ok' || rem.status === 'empty'
  const wxUseful = wx.status === 'ok'
  if (!calUseful && !remUseful && !wxUseful) {
    if (cal.status === 'empty' && rem.status === 'empty' && wx.status === 'location_required') {
      // already have weather tip
    } else if (cal.status === 'empty' && rem.status === 'empty') {
      if (lang === 'en') {
        lines.push('No appointments or reminders for today.')
      } else {
        lines.push('Nessun appuntamento o promemoria per oggi.')
      }
    } else {
      if (lang === 'en') {
        lines.push('I couldn’t build a full briefing right now. Try again shortly.')
      } else {
        lines.push('Non riesco a costruire il briefing in questo momento. Riprova tra poco.')
      }
    }
  }

  // Trim trailing blanks
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/**
 * Compact UI chips model.
 */
export function buildBriefingUi(model, language = 'it') {
  const chips = []
  const cal = model.calendar
  const rem = model.reminders
  const wx = model.weather
  if (cal?.status === 'ok' && cal.items?.length) {
    chips.push({
      id: 'calendar',
      label:
        language === 'en'
          ? `📅 ${cal.items.length} event${cal.items.length > 1 ? 's' : ''}`
          : `📅 ${cal.items.length} appuntament${cal.items.length > 1 ? 'i' : 'o'}`,
    })
  }
  if (rem?.status === 'ok') {
    const n = (rem.overdue?.length || 0) + (rem.today?.length || 0)
    if (n) {
      chips.push({
        id: 'reminders',
        label: language === 'en' ? `⏰ ${n} reminder${n > 1 ? 's' : ''}` : `⏰ ${n} promemoria`,
      })
    }
  }
  if (wx?.status === 'ok' && typeof wx.snapshot?.temperatureC === 'number') {
    chips.push({ id: 'weather', label: `🌤 ${wx.snapshot.temperatureC}°C` })
  } else if (wx?.status === 'ok' && wx.snapshot?.temperatureMaxC != null) {
    chips.push({ id: 'weather', label: `🌤 ${wx.snapshot.temperatureMaxC}°C` })
  }
  if (!chips.length) return null
  return { kind: 'summary', chips }
}
