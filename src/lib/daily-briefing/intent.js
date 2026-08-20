/**
 * #321 — Deterministic Daily Briefing intent (IT/EN).
 * Does NOT steal "Cosa ho oggi?" (Calendar/agenda).
 */

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

  // Follow-ups when context present
  if (opts.hasBriefingContext) {
    if (/^(qual\s+e\s+il\s+primo\s+appuntamento|what(?:'s|\s+is)\s+(the\s+)?first\s+(appointment|event))\??$/.test(t)) {
      return { intent: 'daily-briefing', language, target: 'today', followUp: true, followUpKind: 'first_event' }
    }
    if (/^(che\s+promemoria\s+ho|what\s+reminders?\s+(do\s+i\s+have)?)\??$/.test(t)) {
      return { intent: 'daily-briefing', language, target: 'today', followUp: true, followUpKind: 'reminders' }
    }
    if (/^(e\s+il\s+meteo|and\s+(the\s+)?weather)\??$/.test(t)) {
      return { intent: 'daily-briefing', language, target: 'today', followUp: true, followUpKind: 'weather' }
    }
    if (/\b(devo\s+portare\s+l[' ]?ombrello|do\s+i\s+need\s+(an\s+)?umbrella)\b/.test(t)) {
      return { intent: 'daily-briefing', language, target: 'today', followUp: true, followUpKind: 'umbrella' }
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
