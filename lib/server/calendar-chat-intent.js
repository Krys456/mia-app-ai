/**
 * #304A3 — Deterministic Calendar intent detector (IT + EN).
 * High precision over recall. No LLM.
 */

/**
 * @typedef {'events'|'availability'|'next'|'connection'|'none'} CalendarChatIntent
 */

/**
 * @param {unknown} text
 * @returns {CalendarChatIntent}
 */
export function detectCalendarChatIntent(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return 'none'
  const lower = raw.toLowerCase()

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
    /\b(cos['’]?è|cos['’]?e|what\s+is|what'?s)\s+google\s+calendar\b/.test(lower) ||
    /\bgoogle\s+calendar\s+(cos['’]?è|cos['’]?e|what\s+is)\b/.test(lower)
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
 * @param {string} lower
 */
function isEventsIntent(lower) {
  // Strong schedule deixis
  if (
    /\bcosa\s+ho\b/.test(lower) ||
    /\bche\s+(impegni|appuntamenti|eventi)\b/.test(lower) ||
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
  // "calendario" / "calendar" with personal schedule cues
  if (
    (/\b(mio|mia|my)\s+(calendario|calendar)\b/.test(lower) ||
      /\b(sul|nel|on|in)\s+(mio\s+)?(calendario|calendar)\b/.test(lower)) &&
    /\b(oggi|domani|settimana|today|tomorrow|week|venerdì|venerdi|friday|lunedì|monday)\b/.test(
      lower,
    )
  ) {
    return true
  }
  return false
}
