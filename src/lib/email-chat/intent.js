/**
 * #337B — Deterministic Gmail chat intent (Italian-first, read-only).
 * Only the current user turn authorizes Email. No Core / no model.
 * Mirrors src/lib/calendar-chat/intent.js.
 */

import { analyzeOuterUserRequest } from '../outer-content-gate.js'
import { foldEmailText } from './normalize.js'

const EMAIL_WORD_RE = /\b(emails?|e-mails?|mails?|posta)\b/
const UNREAD_CUE_RE = /\b(nuov[ea]|non\s+lett[ea]|unread)\b/
const IMPORTANT_CUE_RE = /\b(importanti?|important)\b/
const LATEST_CUE_RE = /\b(ultima|ultimo|piu\s+recente|most\s+recent|latest|newest)\b/
const SUMMARY_CUE_RE = /\b(riassum\w*|riassunto|summary|summarize)\b/
const RICEVUTO_QUALCOSA_DA_RE = /\b(ho\s+)?ricevuto\s+qualcosa\s+da\b/
const APRI_APP_RE = /\b(apri|open)\s+(gmail|posta|emails?|e-mails?|mails?)\b/
const DA_SENDER_LOOSE_RE = /\b(?:da|from)\s+[a-z]/i
/** Outbound compose/send — read-only product must refuse honestly, never map to inbox queries. */
const GMAIL_WRITE_RE =
  /\b(?:(?:invia|manda|inoltra)\s+(?:una\s+|un'?\s*)?(?:e-?mails?|mails?|posta)|scrivi\s+(?:una\s+|un'?\s*)?(?:e-?mails?|mails?|posta)|(?:send|write)\s+(?:an?\s+)?(?:e-?mails?|mails?))\b/
const GMAIL_WRITE_EN_RE = /\b(?:send|write)\s+(?:an?\s+)?(?:e-?mails?|mails?)\b/

/**
 * Reply language for Gmail LOCAL_EXCHANGE — current utterance wins over sticky hint.
 * Mirrors detectWeatherLanguage / detectTimerLanguage.
 * @param {string} text
 * @param {'it'|'en'} [fallback]
 * @returns {'it'|'en'}
 */
export function detectEmailLanguage(text, fallback = 'it') {
  const t = foldEmailText(text)
  if (!t) return fallback === 'en' ? 'en' : 'it'

  // Strong write cues (avoid ties on shared "mail"/"email" tokens).
  if (GMAIL_WRITE_EN_RE.test(t)) return 'en'
  if (/\b(?:invia|manda|inoltra|scrivi)\s+(?:una\s+|un'?\s*)?(?:e-?mails?|mails?|posta)\b/.test(t)) {
    return 'it'
  }

  const itHits = (
    t.match(
      /\b(quali|ho|hai|ricevuto|non\s+lett[ea]|nuov[ea]|importanti|oggi|stamattina|riassum\w*|invia|manda|scrivi|ultima|ultimo|posta|che\s+email)\b/g,
    ) || []
  ).length
  const enHits = (
    t.match(
      /\b(any|do\s+i|have|show\s+me|unread|today'?s?|from|send|write|summarize|summary|latest|newest|important|emails?)\b/g,
    ) || []
  ).length

  if (enHits > itHits) return 'en'
  if (itHits > enHits) return 'it'
  return fallback === 'en' ? 'en' : 'it'
}

function detectTimeWindow(t) {
  if (/\b(stamattina|questa\s+mattina)\b/.test(t)) return 'morning'
  if (/\b(oggi|today)\b/.test(t)) return 'today'
  if (/\b(ieri|yesterday)\b/.test(t)) return 'yesterday'
  if (/\b(questa\s+settimana|this\s+week)\b/.test(t)) return 'week'
  if (/\b(mattina|morning)\b/.test(t)) return 'morning'
  if (/\b(pomeriggio|afternoon)\b/.test(t)) return 'afternoon'
  if (/\b(sera|stasera|evening|tonight)\b/.test(t)) return 'evening'
  return null
}

function isMetaOrNonEmail(t) {
  if (APRI_APP_RE.test(t)) return true
  if (
    /\b(cos[' ]?e\s+(la\s+)?posta|what\s+is\s+email|come\s+funziona\s+(la\s+)?posta)\b/.test(t)
  ) {
    return true
  }
  // Explicit briefing — leave to Daily Briefing
  if (
    /\b(fammi\s+(il\s+)?briefing|briefing(\s+giornaliero)?|come\s+sara\s+la\s+mia\s+giornata|daily\s+briefing)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/^(buongiorno|buonasera|ciao|come\s+stai|hello|hi)\??$/.test(t)) return true
  if (/\b(che\s+tempo\s+fa|meteo|weather)\b/.test(t)) return true
  if (/\b(timer|cronometr)\b/.test(t)) return true
  // Calendar-shaped questions without any email keyword stay Calendar's.
  if (
    /\b(cosa\s+ho|che\s+impegn[iy]\s+ho|calendario|agenda|appuntament[oi])\b/.test(t) &&
    !EMAIL_WORD_RE.test(t)
  ) {
    return true
  }
  return false
}

function looksQuotedOrInjected(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

/** Best-effort sender name, preserving original casing (e.g. "Amazon", "Marco"). */
function extractSenderFromRaw(raw) {
  const m = String(raw || '').match(
    /\b(?:da|from)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]{1,40})\b/i,
  )
  if (!m) return null
  const name = m[1].trim()
  if (!name) return null
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Follow-ups — only when activeEmail context is fresh.
 * @param {string} t folded
 */
export function detectEmailFollowUp(t) {
  if (!t) return null

  if (/^(la\s+prima|il\s+primo|prima|first(\s+one)?)\??$/.test(t)) {
    return { kind: 'ordinal', index: 0 }
  }
  if (/^(la\s+seconda|il\s+secondo|seconda|second(\s+one)?)\??$/.test(t)) {
    return { kind: 'ordinal', index: 1 }
  }
  if (/^(la\s+terza|il\s+terzo|terza|third(\s+one)?)\??$/.test(t)) {
    return { kind: 'ordinal', index: 2 }
  }
  if (/^(quella\s+dopo|quello\s+dopo|the\s+next\s+one|next\s+one)\??$/.test(t)) {
    return { kind: 'next_after' }
  }
  if (/^(quella\s+precedente|quello\s+precedente|precedente|previous(\s+one)?)\??$/.test(t)) {
    return { kind: 'previous' }
  }
  if (/^(quando)\??$/.test(t)) {
    return { kind: 'when' }
  }
  if (/^(chi)\??$/.test(t)) {
    return { kind: 'who' }
  }
  if (/^(oggetto|qual\s+e\s+l'?oggetto)\??$/.test(t)) {
    return { kind: 'subject' }
  }
  if (/^((e\s+)?non\s+lett[ae])\??$/.test(t)) {
    return { kind: 'unread_status' }
  }
  if (/^(riassumila|riassumimela|riassumi(\s+questa)?)\??$/.test(t)) {
    return { kind: 'summarize' }
  }
  return null
}

/**
 * @param {string} raw
 * @param {{ languageHint?: 'it'|'en', hasEmailContext?: boolean }} [opts]
 */
export function detectEmailIntent(raw, opts = {}) {
  const hint = opts.languageHint === 'en' ? 'en' : 'it'
  const text = String(raw || '').trim()
  if (!text || text.length > 400) {
    return { intent: 'none', language: hint }
  }

  const language = detectEmailLanguage(text, hint)

  const outer = analyzeOuterUserRequest(text)
  if (outer.localRoutersSuppressed) {
    return { intent: 'none', language, failureCode: 'outer_suppressed' }
  }
  if (looksQuotedOrInjected(text)) {
    return { intent: 'none', language, failureCode: 'quoted' }
  }

  const t = foldEmailText(text)
  if (isMetaOrNonEmail(t)) {
    return { intent: 'none', language }
  }

  const hasEmailContext = Boolean(opts.hasEmailContext)

  if (hasEmailContext) {
    const follow = detectEmailFollowUp(t)
    if (follow) {
      return {
        intent: 'email',
        language,
        operation: 'follow_ups',
        followUp: true,
        followUpKind: follow.kind,
        ordinalIndex: follow.index,
      }
    }
  }

  const ricevutoQualcosaDa = RICEVUTO_QUALCOSA_DA_RE.test(t)
  const hasEmailWord = EMAIL_WORD_RE.test(t)
  const isWrite = GMAIL_WRITE_RE.test(t)

  // #383B — send/write phrases must never become today/sender inbox queries.
  if (isWrite) {
    return {
      intent: 'email',
      language,
      operation: 'write_unsupported',
      queryType: 'write_unsupported',
      followUp: false,
      failureCode: 'gmail_write_unsupported',
    }
  }

  // Ambiguous "Cosa mi ha scritto Marco?" (no email/mail/posta, no strong signal):
  // never claim — let Core clarify (with or without a fresh Email context).
  if (!ricevutoQualcosaDa && !hasEmailWord) {
    return { intent: 'none', language }
  }

  if (ricevutoQualcosaDa || (hasEmailWord && DA_SENDER_LOOSE_RE.test(t))) {
    const sender = extractSenderFromRaw(text)
    if (sender) {
      return {
        intent: 'email',
        language,
        operation: 'sender',
        queryType: 'sender',
        sender,
        followUp: false,
      }
    }
  }

  if (hasEmailWord && UNREAD_CUE_RE.test(t)) {
    return { intent: 'email', language, operation: 'unread', queryType: 'unread', followUp: false }
  }

  // #383B — important inbox (server-built `is:important`), before today fallback.
  if (hasEmailWord && IMPORTANT_CUE_RE.test(t)) {
    return {
      intent: 'email',
      language,
      operation: 'important',
      queryType: 'important',
      followUp: false,
    }
  }

  if (hasEmailWord && LATEST_CUE_RE.test(t)) {
    return { intent: 'email', language, operation: 'latest', queryType: 'latest', followUp: false }
  }

  if (hasEmailWord && SUMMARY_CUE_RE.test(t)) {
    const timeWindow = detectTimeWindow(t) || 'today'
    return {
      intent: 'email',
      language,
      operation: 'summary',
      queryType: 'summary',
      timeWindow,
      followUp: false,
    }
  }

  if (hasEmailWord) {
    const timeWindow = detectTimeWindow(t)
    const isBareToday = !timeWindow || timeWindow === 'today'
    return {
      intent: 'email',
      language,
      operation: isBareToday ? 'today' : 'time_window',
      queryType: isBareToday ? 'today' : 'time_window',
      timeWindow: timeWindow || 'today',
      followUp: false,
    }
  }

  return { intent: 'none', language }
}
