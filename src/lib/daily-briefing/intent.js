/**
 * #321 — Deterministic Daily Briefing intent (IT/EN).
 * Does NOT steal "Cosa ho oggi?" (Calendar/agenda).
 */

import { analyzeOuterUserRequest } from '../outer-content-gate.js'

function fold(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectBriefingLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (t.match(/\b(briefing|giornata|stamattina|riassumimi|fammi|buongiorno)\b/g) || []).length
  const en = (t.match(/\b(briefing|morning|daily|summarize|summary|give\s+me)\b/g) || []).length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

export function looksQuotedOrInjectedBriefing(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function isMetaBriefingTalk(t) {
  if (
    /\b(cos[' ]?e\s+(un|una|il|la)\s+briefing|what\s+is\s+(a|an)\s+briefing|come\s+si\s+crea|how\s+(do|to)\s+(create|make)|scrivi\s+un\s+(esempio|briefing)|write\s+(an?\s+)?(example|sample)|parliamo)\b/.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/**
 * Extract optional city for weather from briefing text.
 * @param {string} raw
 */
export function extractBriefingCity(raw) {
  const t = String(raw || '')
  const m =
    t.match(/\b(?:a|in|per)\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'’-]{1,40}(?:\s+[A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'’-]{1,40})?)/) ||
    t.match(/\b(?:in|for)\s+([A-Z][\w'-]{1,40}(?:\s+[A-Z][\w'-]{1,40})?)/)
  if (!m) return null
  const city = m[1].trim()
  // Reject common non-city words
  if (/^(oggi|domani|mattina|giornata|briefing|today|tomorrow|morning|day)$/i.test(city)) return null
  return city.slice(0, 80)
}

/**
 * @returns {{
 *   intent: 'daily-briefing' | 'none'
 *   language: 'it'|'en'
 *   target: 'today'|'tomorrow'
 *   locationText?: string | null
 *   followUp?: boolean
 *   followUpKind?: string
 *   failureCode?: string | null
 * }}
 */
export function detectDailyBriefingIntent(raw, opts = {}) {
  const text = String(raw || '').trim()
  if (!text) return { intent: 'none', language: 'it' }

  const language = detectBriefingLanguage(text, opts.languageHint === 'en' ? 'en' : 'it')

  // #330A3 — CONTENT IS NOT AUTHORIZATION
  const outer = analyzeOuterUserRequest(text)
  if (outer.contentIsData) {
    return { intent: 'none', language, failureCode: 'content_is_data' }
  }

  if (looksQuotedOrInjectedBriefing(text)) {
    return { intent: 'none', language, failureCode: 'quoted_or_injected' }
  }

  const t = fold(text)
  if (isMetaBriefingTalk(t)) {
    return { intent: 'none', language, failureCode: 'meta' }
  }

  // Explicitly preserve "Cosa ho oggi?" for Calendar/agenda — NOT Daily Briefing
  if (
    /^(cosa\s+ho\s+(oggi|domani)\??|what(?:'s|\s+is)\s+on\s+my\s+(schedule|calendar)\s+today\??|what\s+do\s+i\s+have\s+today\??)$/.test(
      t,
    ) ||
    /\b(cosa\s+ho\s+oggi|cosa\s+ho\s+domani)\b/.test(t) &&
      !/\b(briefing|riassum|giornata|stamattina|devo\s+sapere)\b/.test(t)
  ) {
    return { intent: 'none', language, failureCode: 'agenda_not_briefing' }
  }

  // Follow-ups when context present (#334B)
  if (opts.hasBriefingContext) {
    const follow = detectBriefingFollowUp(t)
    if (follow) {
      return {
        intent: 'daily-briefing',
        language,
        target: 'today',
        followUp: true,
        followUpKind: follow.kind,
        ordinal: follow.ordinal ?? null,
        beforeHour: follow.beforeHour ?? null,
      }
    }
  }

  const tomorrow = /\b(domani|tomorrow)\b/.test(t)
  const briefingCue =
    /\b(briefing|riassumimi\s+la\s+giornata|riassumi\s+la\s+giornata|come\s+sara\s+la\s+mia\s+giornata|cosa\s+devo\s+sapere\s+stamattina|morning\s+briefing|daily\s+briefing|summarize\s+my\s+day|what(?:'s|\s+is)\s+my\s+briefing|give\s+me\s+(today'?s\s+)?briefing|fammi\s+il\s+briefing)\b/.test(
      t,
    )

  if (!briefingCue) {
    return { intent: 'none', language }
  }

  return {
    intent: 'daily-briefing',
    language,
    target: tomorrow ? 'tomorrow' : 'today',
    locationText: extractBriefingCity(text),
    followUp: false,
  }
}

/**
 * Deterministic follow-up classification (folded lowercase text).
 * @param {string} t folded text
 * @returns {{ kind: string, ordinal?: number, beforeHour?: number } | null}
 */
export function detectBriefingFollowUp(t) {
  const s = fold(String(t || '').trim())
  if (!s) return null

  // Ordinals — first 3 (IT/EN)
  if (
    /^(approfondisci\s+(il\s+)?(primo|1(°|o)?)(\s+punto)?|il\s+primo(\s+punto)?|primo(\s+punto)?|the\s+first(\s+one|\s+point)?|first(\s+point)?)\??$/.test(
      s,
    ) ||
    /^(qual\s+e\s+il\s+primo\s+(appuntamento|impegno|punto)|what(?:'s|\s+is)\s+(the\s+)?first\s+(appointment|event|point))\??$/.test(
      s,
    )
  ) {
    return { kind: 'ordinal', ordinal: 1 }
  }
  if (
    /^(approfondisci\s+(il\s+)?(secondo|2(°|o)?)(\s+punto)?|il\s+secondo(\s+punto)?\??|secondo(\s+punto)?|the\s+second(\s+one|\s+point)?|second(\s+point)?)\??$/.test(
      s,
    )
  ) {
    return { kind: 'ordinal', ordinal: 2 }
  }
  if (
    /^(approfondisci\s+(il\s+)?(terzo|3(°|o)?)(\s+punto)?|il\s+terzo(\s+punto)?|terzo(\s+punto)?|the\s+third(\s+one|\s+point)?|third(\s+point)?)\??$/.test(
      s,
    )
  ) {
    return { kind: 'ordinal', ordinal: 3 }
  }

  // Before time — "prima delle 14" / "before 14" / "before 2pm"
  const beforeIt = s.match(/\b(?:cosa\s+devo\s+fare\s+)?prima\s+delle?\s+(\d{1,2})(?::(\d{2}))?\b/)
  const beforeEn = s.match(/\b(?:what\s+(?:do\s+i\s+have|should\s+i\s+do)\s+)?before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (beforeIt) {
    let h = Number(beforeIt[1])
    if (h >= 0 && h <= 23) return { kind: 'before_time', beforeHour: h }
  }
  if (beforeEn) {
    let h = Number(beforeEn[1])
    const ap = beforeEn[3]
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h >= 0 && h <= 23) return { kind: 'before_time', beforeHour: h }
  }

  // Next / after
  if (
    /^(qual\s+e\s+il\s+prossimo(\s+impegno)?|quando\s+e\s+il\s+prossimo|il\s+prossimo(\s+impegno)?|prossimo|what(?:'s|\s+is)\s+(the\s+)?next(\s+(appointment|event|one))?|when\s+is\s+(the\s+)?next)\??$/.test(
      s,
    )
  ) {
    return { kind: 'prossimo' }
  }
  if (/^(e\s+dopo\??|dopo\??|cos[' ]?ho\s+dopo\??|and\s+after\??|what(?:'s|\s+is)\s+after\??|after\s+that\??)$/.test(s)) {
    return { kind: 'e_dopo' }
  }

  // Reminders / overdue
  if (
    /^(che\s+promemoria\s+ho|quali\s+promemoria\s+ho|what\s+reminders?\s+(do\s+i\s+have)?)\??$/.test(s)
  ) {
    return { kind: 'reminders' }
  }
  if (
    /^(ho\s+qualcosa\s+di\s+scaduto|qualcosa\s+di\s+scaduto|any(thing)?\s+overdue|what(?:'s|\s+is)\s+overdue)\??$/.test(
      s,
    )
  ) {
    return { kind: 'overdue' }
  }

  // Weather / umbrella
  if (
    /^(e\s+il\s+meteo|che\s+tempo\s+fara|and\s+(the\s+)?weather|what(?:'s|\s+is)\s+the\s+weather)\??$/.test(s)
  ) {
    return { kind: 'weather' }
  }
  if (/\b(devo\s+portare\s+l[' ]?ombrello|mi\s+serve\s+l[' ]?ombrello|do\s+i\s+need\s+(an\s+)?umbrella)\b/.test(s)) {
    return { kind: 'umbrella' }
  }

  // #334C schedule / urgency / density (session follow-ups)
  if (
    /^(quando\s+sono\s+libero|quando\s+ho\s+tempo|when\s+am\s+i\s+free|when\s+do\s+i\s+have\s+time)\??$/.test(s)
  ) {
    return { kind: 'free_windows' }
  }
  if (
    /^(ho\s+impegni\s+sovrappost[oi]|ho\s+due\s+cose\s+alla\s+stessa\s+ora|any\s+overlap|overlapping\s+events)\??$/.test(
      s,
    )
  ) {
    return { kind: 'overlaps' }
  }
  if (
    /^(quanto\s+tempo\s+ho\s+prima\s+del\s+prossimo(\s+impegno)?|how\s+long\s+until\s+(the\s+)?next)\??$/.test(
      s,
    )
  ) {
    return { kind: 'time_until_next' }
  }
  if (
    /^(quanti\s+promemoria\s+ho|how\s+many\s+reminders)\??$/.test(s)
  ) {
    return { kind: 'reminder_count' }
  }
  if (
    /^(qual\s+e\s+la\s+cosa\s+piu\s+urgente|what(?:'s|\s+is)\s+(the\s+)?most\s+urgent)\??$/.test(s)
  ) {
    return { kind: 'most_urgent' }
  }
  if (
    /^(riassumilo\s+piu\s+brevemente|fammi\s+(la\s+)?versione\s+breve|make\s+it\s+shorter)\??$/.test(s)
  ) {
    return { kind: 'render_concise' }
  }
  if (
    /^(fammi\s+(la\s+)?versione\s+dettagliata|make\s+it\s+detailed)\??$/.test(s)
  ) {
    return { kind: 'render_detailed' }
  }
  if (
    /^(nascondi\s+il\s+meteo\s+(dal|nel)\s+briefing|hide\s+the\s+weather\s+(for\s+now)?)\??$/.test(
      s,
    )
  ) {
    return { kind: 'hide_weather_once' }
  }

  return null
}
