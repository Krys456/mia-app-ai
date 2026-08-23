/**
 * #336B — Deterministic Calendar chat intent (Italian-first).
 * Only the current user turn authorizes Calendar. No Core / no model.
 */

import { analyzeOuterUserRequest } from '../outer-content-gate.js'
import { foldCalendarText } from './normalize.js'

const WEEKDAYS = {
  lunedi: 1,
  monday: 1,
  martedi: 2,
  tuesday: 2,
  mercoledi: 3,
  wednesday: 3,
  giovedi: 4,
  thursday: 4,
  venerdi: 5,
  friday: 5,
  sabato: 6,
  saturday: 6,
  domenica: 0,
  sunday: 0,
}

function parseClockHour(t) {
  // "dopo le 15", "dopo le 15:30", "after 3pm", "prima delle 14"
  const m24 = t.match(/\b(?:dopo|prima|after|before)\s+(?:le|delle|alle|the)?\s*(\d{1,2})(?::(\d{2}))?\b/)
  if (m24) {
    const h = Number(m24[1])
    const min = m24[2] != null ? Number(m24[2]) : 0
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min }
  }
  const mAmpm = t.match(/\b(?:dopo|prima|after|before)\s+(?:le|delle|alle|the)?\s*(\d{1,2})\s*(am|pm)\b/)
  if (mAmpm) {
    let h = Number(mAmpm[1]) % 12
    if (mAmpm[2] === 'pm') h += 12
    return { hour: h, minute: 0 }
  }
  return null
}

function detectDayRef(t) {
  if (/\b(oggi|today)\b/.test(t)) return 'today'
  if (/\b(domani|tomorrow)\b/.test(t)) return 'tomorrow'
  if (/\b(dopodomani|day\s+after\s+tomorrow)\b/.test(t)) return 'day_after_tomorrow'
  if (/\b(questa\s+settimana|this\s+week)\b/.test(t)) return 'week'
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) return { kind: 'weekday', weekday: dow, name }
  }
  return null
}

function detectPartOfDay(t) {
  if (/\b(mattina|stamattina|morning)\b/.test(t)) return 'morning'
  if (/\b(pomeriggio|afternoon)\b/.test(t)) return 'afternoon'
  if (/\b(sera|stasera|evening|tonight)\b/.test(t)) return 'evening'
  return null
}

function isMetaOrNonCalendar(t) {
  if (/\b(cos[' ]?e\s+(il\s+)?calendario|what\s+is\s+(a\s+)?calendar|come\s+funziona\s+(il\s+)?calendario)\b/.test(t)) {
    return true
  }
  if (/\b(scrivi\s+(una\s+)?storia|write\s+(a\s+)?story)\b/.test(t) && /\b(calendario|appuntament)\b/.test(t)) {
    return true
  }
  // Explicit briefing — leave to Daily Briefing
  if (
    /\b(fammi\s+(il\s+)?briefing|briefing(\s+giornaliero)?|come\s+sara\s+la\s+mia\s+giornata|riassumimi\s+la\s+giornata|daily\s+briefing)\b/.test(
      t,
    )
  ) {
    return true
  }
  // Weather / timer / pure greeting
  if (/^(buongiorno|buonasera|ciao|come\s+stai|hello|hi)\??$/.test(t)) return true
  if (/\b(che\s+tempo\s+fa|meteo|weather)\b/.test(t) && !/\b(impegn|appuntament|calendario|agenda)\b/.test(t)) {
    return true
  }
  if (/\b(timer|cronometr)\b/.test(t)) return true
  return false
}

function looksQuotedOrInjected(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

/**
 * Day-shift ellipsis follow-ups — only when activeCalendar context is fresh.
 * "E domani?" / "And tomorrow?" → fresh Calendar query for that day (never Core).
 * Requires a recognizable day/weekday cue; rejects unrelated "E OAuth?" etc.
 * @param {string} t folded
 * @returns {null | string | { kind: 'weekday', weekday: number, name: string }}
 */
export function detectDayShiftFollowUp(t) {
  if (!t || t.length > 72) return null
  // Stronger unrelated tokens — do not steal from other domains.
  if (
    /\b(oauth|email|gmail|meteo|weather|timer|spotify|youtube|maps|wifi|bluetooth|password|codice|code|vision|foto|photo)\b/.test(
      t,
    )
  ) {
    return null
  }

  const day = detectDayRef(t)
  if (!day) return null

  // Short ellipsis / contrastive / "about" / "per <day>" shapes only.
  const dayShiftShape =
    /^(e|and)\s+/.test(t) ||
    /^(what|how)\s+about\s+/.test(t) ||
    /^per\s+/.test(t) ||
    /\binvece\b/.test(t) ||
    /\binstead\b/.test(t) ||
    /^(oggi|domani|dopodomani|today|tomorrow|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\??$/.test(
      t,
    )

  if (!dayShiftShape) return null

  // Strip connectors + day tokens; leftover must be negligible (avoid "e oauth domani").
  const stripped = t
    .replace(
      /\b(e|and|what|how|about|per|invece|instead|oggi|domani|dopodomani|today|tomorrow|day\s+after\s+tomorrow|questa\s+settimana|this\s+week|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g,
      ' ',
    )
    .replace(/[?!.\s]+/g, ' ')
    .trim()
  if (stripped.length > 12) return null

  return day
}

/**
 * Follow-ups — only when activeCalendar context is fresh.
 * @param {string} t folded
 */
export function detectCalendarFollowUp(t) {
  if (!t) return null

  // After a Calendar answer/failure, keep meta questions local (never Core).
  if (
    /^(e\s+)?(perche|perche\?|why|why\?)$/.test(t) ||
    /\b(perche\s+(non\s+)?(riesci|puoi|hai)|why\s+(can'?t|cannot|don'?t)|non\s+hai\s+accesso|non\s+riesci\s+a\s+leggere|accesso\s+(al\s+)?calendario)\b/.test(
      t,
    )
  ) {
    return { kind: 'repeat_status' }
  }

  // Day-shift ellipsis → handled in detectCalendarIntent as a fresh day query.
  const dayShift = detectDayShiftFollowUp(t)
  if (dayShift) {
    return { kind: 'day_shift', dayRef: dayShift }
  }

  if (/^(e\s+dopo|dopo|and\s+after|what(?:'s|\s+is)\s+next|il\s+prossimo|prossimo|qual\s+e\s+il\s+prossimo(\s+impegno)?)\??$/.test(t)) {
    return { kind: 'next_after' }
  }
  if (/^(il\s+primo|la\s+prima|primo|first(\s+one)?)\??$/.test(t)) {
    return { kind: 'ordinal', index: 0 }
  }
  if (/^(il\s+secondo|la\s+seconda|secondo|second(\s+one)?)\??$/.test(t)) {
    return { kind: 'ordinal', index: 1 }
  }
  if (/^(il\s+terzo|la\s+terza|terzo|third(\s+one)?)\??$/.test(t)) {
    return { kind: 'ordinal', index: 2 }
  }
  if (/^(quanto\s+manca|how\s+long\s+until|quanto\s+tempo\s+manca)\??$/.test(t)) {
    return { kind: 'time_until' }
  }
  if (/^(quando\s+sono\s+libero|quando\s+sono\s+libera|when\s+am\s+i\s+free)\??$/.test(t)) {
    return { kind: 'free_time' }
  }

  const clock = parseClockHour(t)
  if (clock && /^(prima|dopo|before|after)\b/.test(t) && t.length < 48) {
    return {
      kind: /^(prima|before)\b/.test(t) ? 'before_time' : 'after_time',
      hour: clock.hour,
      minute: clock.minute,
    }
  }
  return null
}

/**
 * @param {string} raw
 * @param {{ languageHint?: 'it'|'en', hasCalendarContext?: boolean }} [opts]
 */
export function detectCalendarIntent(raw, opts = {}) {
  const language = opts.languageHint === 'en' ? 'en' : 'it'
  const text = String(raw || '').trim()
  if (!text || text.length > 400) {
    return { intent: 'none', language }
  }

  const outer = analyzeOuterUserRequest(text)
  if (outer.localRoutersSuppressed) {
    return { intent: 'none', language, failureCode: 'outer_suppressed' }
  }
  if (looksQuotedOrInjected(text)) {
    return { intent: 'none', language, failureCode: 'quoted' }
  }

  const t = foldCalendarText(text)
  if (isMetaOrNonCalendar(t)) {
    return { intent: 'none', language }
  }

  if (opts.hasCalendarContext) {
    const follow = detectCalendarFollowUp(t)
    if (follow) {
      // Day-shift ellipsis: fresh Calendar query for the named day (not context reuse).
      if (follow.kind === 'day_shift') {
        return {
          intent: 'calendar',
          language,
          queryType: 'list',
          dayRef: follow.dayRef || 'today',
          followUp: false,
          dayShiftFollowUp: true,
        }
      }
      return {
        intent: 'calendar',
        language,
        followUp: true,
        followUpKind: follow.kind,
        ordinalIndex: follow.index,
        hour: follow.hour,
        minute: follow.minute,
      }
    }
  }

  // Free-time questions
  if (
    /\b(quando\s+sono\s+liber[oa]|when\s+am\s+i\s+free|slot\s+liber[oi]|ore\s+liber[eo])\b/.test(t)
  ) {
    const day = detectDayRef(t) || 'tomorrow'
    return {
      intent: 'calendar',
      language,
      queryType: 'free_time',
      dayRef: day,
      followUp: false,
    }
  }

  // Next event
  if (
    /\b(qual\s+e\s+il\s+mio\s+prossimo\s+impegno|il\s+mio\s+prossimo\s+impegno|prossimo\s+impegno|what(?:'s|\s+is)\s+my\s+next\s+(appointment|event|meeting)|my\s+next\s+(appointment|event))\b/.test(
      t,
    ) ||
    /^(qual\s+e\s+il\s+prossimo\s+impegno)\??$/.test(t)
  ) {
    return {
      intent: 'calendar',
      language,
      queryType: 'next',
      dayRef: 'next',
      followUp: false,
    }
  }

  const agendaCue =
    /\b(cosa\s+ho|che\s+impegn[iy]\s+ho|ho\s+qualcosa|ho\s+impegn|impegn[iy]\s+(di|nel|nella|nello|oggi|domani)|agenda\s+di|cosa\s+c'?e|che\s+cosa\s+ho|what\s+do\s+i\s+have|what(?:'s|\s+is)\s+on\s+my\s+(calendar|schedule)|any\s+(meetings?|appointments?))\b/.test(
      t,
    ) ||
    /^(impegn[iy]\s+(di\s+)?(oggi|domani)|agenda\s+(di\s+)?(oggi|domani))\??$/.test(t)

  const calendarNoun = /\b(calendario|agenda|appuntament[oi]|riunion[ei]|impegn[iy])\b/.test(t)

  if (!agendaCue && !calendarNoun) {
    // Weekday-only "ho qualcosa venerdì?" already has agendaCue via ho qualcosa
    return { intent: 'none', language }
  }

  // Require schedule-ish framing for calendarNoun alone
  if (!agendaCue && calendarNoun) {
    if (!/\b(oggi|domani|dopodomani|questa\s+settimana|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|today|tomorrow|monday|friday)\b/.test(t)) {
      return { intent: 'none', language }
    }
  }

  const day = detectDayRef(t) || 'today'
  const part = detectPartOfDay(t)
  const clock = parseClockHour(t)
  const after = clock && /\b(dopo|after)\b/.test(t) ? clock : null
  const before = clock && /\b(prima|before)\b/.test(t) ? clock : null

  let queryType = 'list'
  if (after) queryType = 'after_time'
  else if (before) queryType = 'before_time'
  else if (part) queryType = 'part_of_day'

  return {
    intent: 'calendar',
    language,
    queryType,
    dayRef: day,
    partOfDay: part,
    afterHour: after ? after.hour : null,
    afterMinute: after ? after.minute : 0,
    beforeHour: before ? before.hour : null,
    beforeMinute: before ? before.minute : 0,
    followUp: false,
  }
}

export { WEEKDAYS }
