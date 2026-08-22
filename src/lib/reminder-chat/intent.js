/**
 * #357B — Deterministic Reminder chat intent (Italian-first). Zero model calls.
 */

import { analyzeOuterUserRequest } from '../outer-content-gate.js'
import { foldReminderText } from './normalize.js'
import { extractReminderTitle, parseReminderDateTime } from './datetime.js'

function isMetaTalk(t) {
  if (/\b(cos[' ]?e|what\s+is|che\s+cos[' ]?e)\b.*\b(promemoria|reminder)\b/.test(t)) return true
  if (/\b(promemoria|reminder)\b.*\b(cos[' ]?e|what\s+is)\b/.test(t)) return true
  return false
}

function isOtherProduct(t) {
  if (/\btimer\b/.test(t) && !/\b(ricordami|promemoria|remind\s+me)\b/.test(t)) return true
  if (/\b(che\s+tempo\s+fa|meteo|weather)\b/.test(t)) return true
  if (/\b(email|gmail|posta)\b/.test(t) && !/\bpromemoria\b/.test(t)) return true
  return false
}

/**
 * @returns {false | { kind: string, index?: number }}
 */
export function detectReminderFollowUp(raw, opts = {}) {
  if (!opts.hasRemindersContext && !opts.hasPendingProposal) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto)[,.]?\s+/i, '')
  const t = foldReminderText(stripped)
  if (!t) return false

  if (opts.hasPendingProposal) {
    if (/^\s*(conferma|confermo|si|sì|yes|ok|okay)\s*[.!]?\s*$/.test(t)) {
      return { kind: 'confirm_pending' }
    }
    if (/^\s*(annulla|no|cancel)\s*[.!]?\s*$/.test(t)) {
      return { kind: 'discard_pending' }
    }
  }

  if (!opts.hasRemindersContext) return false

  if (/^\s*(il\s+)?prim[oa]\s*[.!]?\s*$/.test(t) || /^\s*1\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 0 }
  }
  if (/^\s*(il\s+|la\s+)?second[oa]\s*[.!]?\s*$/.test(t) || /^\s*2\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 1 }
  }
  if (/^\s*(il\s+|la\s+)?terz[oa]\s*[.!]?\s*$/.test(t) || /^\s*3\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 2 }
  }
  if (/^\s*(il\s+|la\s+)?(prossim[oa]|successiv[oa]|quello\s+dopo)\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_next' }
  }

  if (
    /\b(segna(lo|la)?\s+come\s+fatto|segna\s+(il\s+)?prim[oa]\s+come\s+fatto|complet[ao]|mark\s+(it\s+)?(as\s+)?done)\b/.test(
      t,
    )
  ) {
    const idx = /\bsecond/.test(t) ? 1 : /\bterz/.test(t) ? 2 : /\bprim/.test(t) ? 0 : undefined
    return { kind: 'complete', index: idx }
  }

  if (/\b(cancella(lo|la)?|elimina(lo|la)?|annulla(lo|la)?|delete|cancel)\b/.test(t)) {
    const idx = /\bsecond/.test(t) ? 1 : /\bterz/.test(t) ? 2 : /\bprim/.test(t) ? 0 : undefined
    return { kind: 'cancel', index: idx }
  }

  if (/\b(sposta(lo|la)?|riprogramma|reschedule|move\s+it)\b/.test(t)) {
    return { kind: 'reschedule' }
  }

  return false
}

export function detectReminderIntent(raw, opts = {}) {
  const language = opts.languageHint === 'en' ? 'en' : 'it'
  const text = String(raw || '').trim()
  if (!text || text.length > 400) {
    return { intent: 'none', language }
  }

  const gate = analyzeOuterUserRequest(text)
  if (gate?.localRoutersSuppressed) {
    return { intent: 'none', language, failureCode: 'outer_blocked' }
  }

  const t = foldReminderText(text)
  if (isMetaTalk(t) || isOtherProduct(t)) {
    return { intent: 'none', language }
  }

  const follow = detectReminderFollowUp(text, {
    hasRemindersContext: Boolean(opts.hasRemindersContext),
    hasPendingProposal: Boolean(opts.hasPendingProposal),
  })
  if (follow) {
    return {
      intent: 'reminder',
      operation: 'follow_up',
      language,
      followUpKind: follow.kind,
      followUpIndex: follow.index,
    }
  }

  if (
    /\b(che|quali|quanti)\s+promemoria\b/.test(t) ||
    /\blista\s+(dei\s+)?promemoria\b/.test(t) ||
    /\b(what|which|list)\s+(my\s+)?reminders?\b/.test(t) ||
    /\bpromemoria\s+ho\b/.test(t)
  ) {
    const queryType = /\boggi\b|\btoday\b/.test(t)
      ? 'today'
      : /\b(prossim[oa]|next)\b/.test(t)
        ? 'next'
        : 'upcoming'
    return { intent: 'reminder', operation: 'list', language, queryType }
  }
  if (/\b(qual\s+[eè]|what'?s)\s+(il\s+)?prossim[oa]\s+promemoria\b/.test(t)) {
    return { intent: 'reminder', operation: 'list', language, queryType: 'next' }
  }

  if (
    /\b(ricordami|ricorda\s+mi|remind\s+me)\b/.test(t) ||
    /\b(crea|aggiungi|imposta)\s+(un\s+)?promemoria\b/.test(t) ||
    /\b(set|add|create)\s+(a\s+)?reminder\b/.test(t)
  ) {
    if (/\b(ogni\s+|every\s+)/.test(t)) {
      return {
        intent: 'reminder',
        operation: 'create',
        language,
        failureCode: 'unsupported_recurrence',
      }
    }
    const title = extractReminderTitle(text)
    const when = parseReminderDateTime(text, {
      timeZone: opts.timeZone,
      now: opts.now,
    })
    return {
      intent: 'reminder',
      operation: 'create',
      language,
      title: title || undefined,
      whenRaw: text,
      when,
      failureCode: when.ok ? null : when.code,
    }
  }

  if (
    /\b(cancella|elimina|annulla)\s+(il\s+|un\s+)?promemoria\b/.test(t) ||
    /\b(delete|cancel)\s+(the\s+|a\s+)?reminder\b/.test(t)
  ) {
    return {
      intent: 'reminder',
      operation: 'follow_up',
      language,
      followUpKind: 'cancel',
      failureCode: opts.hasRemindersContext ? null : 'not_found',
    }
  }
  if (
    /\b(segna|completa)\b.*\bpromemoria\b/.test(t) ||
    /\bmark\b.*\breminder\b.*\bdone\b/.test(t)
  ) {
    return {
      intent: 'reminder',
      operation: 'follow_up',
      language,
      followUpKind: 'complete',
      failureCode: opts.hasRemindersContext ? null : 'not_found',
    }
  }

  return { intent: 'none', language }
}
