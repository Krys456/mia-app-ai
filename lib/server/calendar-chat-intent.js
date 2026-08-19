/**
 * #304A3 / #310E — Deterministic Calendar intent detector (IT + EN).
 * High precision over recall. No LLM.
 *
 * Intent matching runs on a *normalized copy* only — never mutates the user message.
 */

/**
 * @typedef {'events'|'availability'|'next'|'connection'|'none'} CalendarChatIntent
 */

const TEMPORAL_IT_EN =
  String.raw`oggi|domani|dopodomani|settimana|mattina|pomeriggio|sera|stasera|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|today|tomorrow|tonight|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday`

/**
 * Canonical Calendar-intent normalization (matching only).
 * - Unicode NFKC
 * - curly apostrophes → '
 * - NBSP / exotic spaces → space
 * - zero-width → space
 * - collapse whitespace + trim
 * - lowercase
 * - expand known Italian contractions (cos'ho → cosa ho, …)
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeCalendarIntentText(text) {
  let s = String(text || '')
    .normalize('NFKC')
    // Apostrophes / quotes → ASCII
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    // Spaces (NBSP, thin, etc.)
    .replace(/[\u00A0\u202F\u2000-\u200A\u2028\u2029]/g, ' ')
    // Zero-width / soft hyphen → space (so cosa​ho → cosa ho)
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  // Italian contractions → spaced forms (avoid \\b after accented letters — JS \\b is ASCII-only)
  s = s
    .replace(/\bcos\s*'\s*ho\b/g, 'cosa ho')
    .replace(/\bcos\s*'\s*[eè](?=\s|$|[^\p{L}])/gu, 'cosa e')
    .replace(/\bc\s*'\s*[eè](?=\s|$|[^\p{L}])/gu, "c'e")

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function safeDiagTextPreview(text, max = 80) {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text)
  const limit = typeof max === 'number' && max > 0 ? Math.floor(max) : 80
  if (raw.length <= limit) return raw
  return `${raw.slice(0, limit)}…`
}

/**
 * Inspect intent without changing detection rules. Safe for Preview diagnostics.
 * @param {unknown} text
 */
export function inspectCalendarChatIntent(text) {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text)
  const normalized = normalizeCalendarIntentText(raw)
  const intent = detectCalendarChatIntent(raw)
  return {
    intent,
    raw,
    normalized,
    rawLen: raw.length,
    normalizedLen: normalized.length,
    rawPreview: safeDiagTextPreview(raw, 80),
    normalizedPreview: safeDiagTextPreview(normalized, 80),
  }
}

/**
 * @param {unknown} text
 * @returns {CalendarChatIntent}
 */
export function detectCalendarChatIntent(text) {
  const lower = normalizeCalendarIntentText(text)
  if (!lower) return 'none'

  if (isFalsePositive(lower)) return 'none'
  if (isReminderCreation(lower)) return 'none'

  if (isConnectionIntent(lower)) return 'connection'
  if (isNextIntent(lower)) return 'next'
  if (isAvailabilityIntent(lower)) return 'availability'
  if (isEventsIntent(lower)) return 'events'

  return 'none'
}

/**
 * @param {string} lower
 */
function hasTemporalCue(lower) {
  return new RegExp(String.raw`\b(?:${TEMPORAL_IT_EN}|questa\s+settimana|this\s+week)\b`).test(
    lower,
  )
}

/**
 * @param {string} lower
 */
function isFalsePositive(lower) {
  if (
    /\bcalendario\s+maya\b/.test(lower) ||
    /\bmayan\s+calendar\b/.test(lower) ||
    /\bcalendario\s+editoriale\b/.test(lower) ||
    /\beditorial\s+calendar\b/.test(lower) ||
    /\bcalendario\s+(react|component|componente)\b/.test(lower) ||
    /\b(react|vue|angular)\s+calendar\b/.test(lower) ||
    /\bcalendar\s+component\b/.test(lower)
  ) {
    return true
  }
  if (
    /\b(cosa\s+e|cos'e|cos'è|what\s+is|what'?s)\s+google\s+calendar\b/.test(lower) ||
    /\bgoogle\s+calendar\s+(cosa\s+e|cos'e|cos'è|what\s+is)\b/.test(lower)
  ) {
    return true
  }
  if (
    /\b(quanti\s+giorni\s+ha|how\s+many\s+days\s+(are\s+)?in|days\s+in)\b/.test(lower) &&
    /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
      lower,
    )
  ) {
    return true
  }
  // Temporal word alone / non-schedule uses of "domani" / "cosa"
  if (
    /\bcosa\s+significa\b/.test(lower) ||
    /\bparliamo\s+di\b/.test(lower) ||
    /\b(scrivi|scrivere|inventa)\s+(una\s+)?storia\b/.test(lower) ||
    /\bstoria\s+ambientat/.test(lower) ||
    /\bcome\s+sar[aà]\s+il\s+tempo\b/.test(lower) ||
    /\b(meteo|weather)\b/.test(lower) ||
    /\bdomani\s+sar[aà]\s+(una\s+)?bella\b/.test(lower) ||
    /\bsar[aà]\s+una\s+bella\s+giornata\b/.test(lower)
  ) {
    return true
  }
  return false
}

/**
 * Reminder creation — must not trigger Calendar fetch.
 * @param {string} lower
 */
function isReminderCreation(lower) {
  return (
    /\bricordami\b/.test(lower) ||
    /\brimindami\b/.test(lower) ||
    /\bremind\s+me\b/.test(lower) ||
    /\bset\s+(a\s+)?reminder\b/.test(lower) ||
    /\bcrea(mi)?\s+(un\s+)?promemoria\b/.test(lower) ||
    /\bpromemoria\s+(per|domani|oggi)\b/.test(lower)
  )
}

/**
 * @param {string} lower
 */
function isConnectionIntent(lower) {
  return (
    /\b(il\s+)?calendario\s+(è|e)\s+collegat/.test(lower) ||
    /\bgoogle\s+calendar\s+(è|e)\s+collegat/.test(lower) ||
    /\b(collega|scollega|disconnetti)\s+(google\s+)?calendario\b/.test(lower) ||
    /\b(collega|scollega|disconnetti)\s+google\s+calendar\b/.test(lower) ||
    /\b(connect|disconnect|unlink)\s+(my\s+)?google\s+calendar\b/.test(lower) ||
    /\bis\s+(my\s+)?(google\s+)?calendar\s+connected\b/.test(lower) ||
    /\bcalendar\s+connected\b/.test(lower)
  )
}

/**
 * @param {string} lower
 */
function isNextIntent(lower) {
  return (
    /\bprossimo\s+(appuntamento|evento|impegno|meeting)\b/.test(lower) ||
    /\b(il\s+)?mio\s+prossimo\s+(appuntamento|evento|impegno)\b/.test(lower) ||
    /\bnext\s+(appointment|event|meeting)\b/.test(lower) ||
    /\bwhat'?s\s+my\s+next\s+(appointment|event|meeting)\b/.test(lower) ||
    /\bwhat\s+is\s+my\s+next\s+(appointment|event|meeting)\b/.test(lower)
  )
}

/**
 * @param {string} lower
 */
function isAvailabilityIntent(lower) {
  if (
    /\b(sono|sei)\s+(libero|libera|disponibile)\b/.test(lower) ||
    /\bam\s+i\s+free\b/.test(lower) ||
    /\bam\s+i\s+available\b/.test(lower) ||
    /\bare\s+you\s+free\b/.test(lower)
  ) {
    return true
  }
  if (
    /\bho\s+qualcosa\s+(dalle|tra|fra|da)\b/.test(lower) ||
    /\bdo\s+i\s+have\s+anything\s+(between|from|at)\b/.test(lower) ||
    /\banything\s+between\b/.test(lower)
  ) {
    return true
  }
  if (/\bfree\s+(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/.test(lower)) {
    return true
  }
  if (/\blibero\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica|domani|oggi)\b/.test(lower)) {
    return true
  }
  return false
}

/**
 * @param {string} lower already normalizeCalendarIntentText()'d
 */
function isEventsIntent(lower) {
  // Strong schedule deixis (works after cos'ho → cosa ho)
  if (
    /\bcosa\s+ho\b/.test(lower) ||
    /\bche\s+cosa\s+ho\b/.test(lower) ||
    /\bche\s+ho\b/.test(lower) ||
    /\bcosa\s+c'e\b/.test(lower) ||
    /\bcosa\s+(devo|posso)\s+fare\b/.test(lower) ||
    /\bche\s+(impegni|appuntamenti|eventi)\b/.test(lower) ||
    /\bquali\s+(impegni|appuntamenti|eventi)\b/.test(lower) ||
    /\bi\s+miei\s+(impegni|appuntamenti|eventi|meeting)\b/.test(lower) ||
    /\b(impegni|appuntamenti|eventi)\s+(di|per|oggi|domani|questa)\b/.test(lower) ||
    /\bwhat\s+do\s+i\s+have\b/.test(lower) ||
    /\bwhat'?s\s+on\s+my\s+calendar\b/.test(lower) ||
    /\bwhat\s+is\s+on\s+my\s+calendar\b/.test(lower) ||
    /\bmy\s+(meetings|appointments|events|schedule)\b/.test(lower) ||
    /\b(meetings|appointments|events)\s+(today|tomorrow|this\s+week|on\s+)/.test(lower)
  ) {
    return true
  }

  if (
    /\b(fammi\s+vedere|mostrami|mostra)\b/.test(lower) &&
    /\b(impegni|appuntamenti|eventi|calendario|cosa\s+ho)\b/.test(lower)
  ) {
    return true
  }

  // "ho impegni/qualcosa/appuntamenti …" + temporal (availability "ho qualcosa dalle" already handled)
  if (
    hasTemporalCue(lower) &&
    /\bho\s+(impegni|appuntamenti|eventi|qualcosa|meeting)\b/.test(lower)
  ) {
    return true
  }

  // "calendario" / "calendar" with personal schedule cues
  if (
    (/\b(mio|mia|my)\s+(calendario|calendar)\b/.test(lower) ||
      /\b(sul|nel|on|in)\s+(mio\s+)?(calendario|calendar)\b/.test(lower)) &&
    hasTemporalCue(lower)
  ) {
    return true
  }
  return false
}
