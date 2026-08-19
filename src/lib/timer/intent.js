/**
 * #314 — Deterministic timer / alarm intent (IT/EN).
 */

import { formatDurationLabel, normalizeTimerText, parseTimerDurationMs } from './duration.js'

function fold(s) {
  return normalizeTimerText(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function detectTimerLanguage(text, fallback = 'it') {
  const t = fold(text)
  const itHits = (
    t.match(
      /\b(timer|minuti|minuto|secondi|secondo|ora|ore|fermalo|ferma|annulla|manca|aggiungi|svegliami|ricordami|imposta|avvia|metti|quanto)\b/g,
    ) || []
  ).length
  const enHits = (
    t.match(
      /\b(timer|minutes?|seconds?|hours?|stop|cancel|left|remaining|add|wake|remind|set|start|how\s+much)\b/g,
    ) || []
  ).length
  if (/\b(set|start|stop|cancel|remaining|how much time)\b/.test(t) && enHits >= itHits) {
    return 'en'
  }
  if (
    /\b(fermalo|ferma|annulla|manca|aggiungi|imposta|avvia|metti|svegliami|ricordami)\b/.test(t)
  ) {
    return 'it'
  }
  if (enHits > itHits) return 'en'
  if (itHits > enHits) return 'it'
  return fallback
}

export function isNonActionTimerTalk(text) {
  const t = fold(text)
  if (
    /\b(cos[' ]?e|what\s+is|what's|che\s+cos[' ]?e)\b.*\btimer\b/.test(t) ||
    /\btimer\b.*\b(cos[' ]?e|what\s+is)\b/.test(t)
  ) {
    return true
  }
  if (
    /\b(scriv[ia]|write|crea|create|costruisc|build|develop)\b.*\b(app|applicazione|application)?\s*timer\b/.test(
      t,
    ) ||
    /\btimer\b.*\b(app|applicazione)\b/.test(t)
  ) {
    return true
  }
  if (
    /\b(quanto\s+dura\s+normalmente|how\s+long\s+(does|is)\s+(a\s+)?timer|parlami\s+del\s+timer|tell\s+me\s+about\s+(the\s+)?timer|pomodoro)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(storia|history|etimolog|meaning|significato)\b.*\btimer\b/.test(t)) return true
  return false
}

export function isReminderNotTimer(text) {
  const t = fold(text)
  return /\b(ricordami|ricorda\s+di|promemoria|remind\s+me|reminder)\b/.test(t)
}

export function isAlarmNotTimer(text) {
  const t = fold(text)
  if (
    /\b(svegliami|sveglia|wake\s+me(\s+up)?|set\s+(an?\s+)?alarm|alarm\s+at|allarme)\b/.test(t)
  ) {
    if (/\btimer\b/.test(t) && /\b(di|for|da)\s+\d/.test(t)) return false
    return true
  }
  return false
}

function looksStartTimer(text) {
  const t = fold(text)
  if (isNonActionTimerTalk(t)) return false
  if (isReminderNotTimer(t)) return false
  if (isAlarmNotTimer(t)) return false

  if (
    /\b(imposta|avvia|metti|mettimi|crea|set|start|begin)\b.{0,40}\btimer\b/.test(t) ||
    /\btimer\b.{0,40}\b(di|da|per|for|of)\b/.test(t) ||
    /\btimer\s+\d/.test(t) ||
    /\b(conto\s+alla\s+rovescia|countdown)\b/.test(t)
  ) {
    return true
  }
  if (/^\s*timer\b/.test(t) && parseTimerDurationMs(t) != null) return true
  return false
}

function looksStatus(text, hasActive) {
  const t = fold(text)
  if (/\b(quanto\s+manca\s+alla\s+fine\s+del\s+film|how\s+long\s+(is|until)\s+the\s+movie)\b/.test(t)) {
    return false
  }
  if (
    /\b(quanto\s+manca(\s+al\s+timer)?|how\s+much\s+time\s+(is\s+)?left|time\s+left(\s+on\s+the\s+timer)?|remaining\s+(time|on\s+the\s+timer)?)\b/.test(
      t,
    )
  ) {
    if (
      /^\s*quanto\s+manca\??\s*$/i.test(t) ||
      /^\s*how\s+much(\s+time)?(\s+is\s+left)?\??\s*$/i.test(t)
    ) {
      return hasActive
    }
    if (/\btimer\b/.test(t) || hasActive) return true
  }
  return false
}

function looksCancel(text, hasActive) {
  const t = fold(text)
  if (
    /\b(ferma\s+il\s+timer|annulla\s+il\s+timer|stop\s+the\s+timer|cancel\s+the\s+timer|kill\s+the\s+timer)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (
    hasActive &&
    (/^\s*(fermalo|annullalo|stop|cancel)\s*[.!]?\s*$/i.test(t) ||
      /^\s*(ferma|annulla)\s*[.!]?\s*$/i.test(t))
  ) {
    return true
  }
  return false
}

function looksAdd(text, hasActive) {
  if (!hasActive) return { ok: false }
  const t = fold(text)
  if (
    !/\b(aggiungi|add|aggiungine|estendi|extend)\b/.test(t) &&
    !/\b(\+|piu|more)\s*\d/.test(t)
  ) {
    return { ok: false }
  }
  if (
    /\b(sale|zucchero|ingredient|calendar|promemoria|reminder)\b/.test(t) &&
    !/\b(minut|second|hour|ora)\b/.test(t)
  ) {
    return { ok: false }
  }
  const ms = parseTimerDurationMs(t)
  if (ms == null) return { ok: false }
  return { ok: true, addMs: ms }
}

function looksConfirmReplace(text) {
  const n = normalizeTimerText(text)
  const t = fold(text)
  return (
    /^\s*(si|sì|yes|ok|okay|va\s+bene|sostituisci|replace|sure)\s*[.!]?\s*$/i.test(n) ||
    /\b(sostituisci|replace\s+(it|the\s+timer)|yes\s+replace)\b/.test(t)
  )
}

function looksDeclineReplace(text) {
  const n = normalizeTimerText(text)
  return /^\s*(no|nope|lascia|keep|annulla)\s*[.!]?\s*$/i.test(n)
}

export function detectTimerIntent(raw, opts = {}) {
  const language = detectTimerLanguage(raw, opts.languageHint || 'it')
  const text = fold(raw)
  if (!text) {
    return { kind: 'none', language, failureCode: null }
  }

  if (opts.hasPendingReplace) {
    if (looksConfirmReplace(raw)) {
      return { kind: 'confirm_replace', language }
    }
    if (looksDeclineReplace(raw)) {
      return { kind: 'decline_replace', language }
    }
  }

  if (isAlarmNotTimer(text)) {
    return { kind: 'alarm_honest', language }
  }

  if (isReminderNotTimer(text) && !/\btimer\b/.test(text)) {
    return { kind: 'none', language }
  }

  if (isNonActionTimerTalk(text)) {
    return { kind: 'none', language }
  }

  const hasActive = Boolean(opts.hasActiveTimer)

  if (looksStatus(text, hasActive)) {
    return { kind: 'status', language }
  }
  if (looksCancel(text, hasActive)) {
    return { kind: 'cancel', language }
  }
  const add = looksAdd(text, hasActive)
  if (add.ok && add.addMs) {
    return { kind: 'add', language, addMs: add.addMs }
  }

  if (looksStartTimer(text)) {
    const durationMs = parseTimerDurationMs(text)
    if (durationMs == null) {
      return {
        kind: 'start',
        language,
        needsDuration: true,
        failureCode: 'duration_unparsed',
      }
    }
    return { kind: 'start', language, durationMs, failureCode: null }
  }

  return { kind: 'none', language }
}

export { formatDurationLabel }
