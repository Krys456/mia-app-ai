/**
 * #330A2 — Outer direct-command proof for Phone Actions.
 *
 * Invariant: Phone Actions execute only from an explicit direct action request
 * in the user's outer utterance. Quoted, negated, explanatory, technical,
 * example, or code content is data — not authorization.
 *
 * Deterministic only. No LLM / network.
 */

import { fold, normalizeTimerText } from './parse.js'
import { stripDiscoursePrefix } from './intent-discourse.js'

/** Imperative / action starters (IT + EN) for outer-clause proof. */
export const DIRECT_ACTION_STARTER_RE =
  /^(chiama|call|apri|aprimi|open|avvia|apriamo|vai\s+su|go\s+to|portami|naviga|indicazioni|directions|navigate|take\s+me|scrivi|manda|invia|text|send|condividi|share|copia|copy|copialo|copiala|fammi\s+scattare|scatta|su\s+whatsapp|on\s+whatsapp|via\s+whatsapp|whatsapp|alza|abbassa|metti|attiva|disattiva|accendi|spegni|imposta|set|turn\s+on|turn\s+off|enable|disable|svegliami|sveglia|wake\s+me)\b/i

/**
 * Surface used for outer-intent matching: discourse-stripped, preferably the
 * first command line — never a buried paragraph in a long paste.
 */
export function getOuterActionSurface(raw) {
  const original = String(raw || '')
  const lines = original
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // Multi-line paste / long doc: only the first non-empty line may authorize.
  let focus = lines.length > 1 ? lines[0] : original
  // Extremely long single-line paste: first sentence only.
  const normalized = normalizeTimerText(focus)
  if (lines.length <= 1 && normalized.length > 220) {
    const sent = normalized.match(/^(.+?[.!?])(?:\s+|$)/)
    if (sent && sent[1].length >= 8) focus = sent[1]
  }

  return stripDiscoursePrefix(focus)
}

export function hasDirectActionStarter(surface) {
  const s = fold(surface)
  if (!s) return false
  return DIRECT_ACTION_STARTER_RE.test(s)
}

/**
 * Explicit negation must beat any action keyword (IT infinitive + imperative, EN).
 */
export function looksNegatedOuter(surface) {
  const t = fold(surface)
  if (!t) return false

  if (
    /^(non|don't|dont|do\s+not|never|mai)\s+/.test(t) ||
    /^(non)\s*(chiama|chiamare|apri|aprire|aprimi|manda|mandare|scrivi|scrivere|invia|inviare|copia|copiare|copialo|portarmi|portare|naviga|navigare|condividi|condividere|aprire|text|call|open|send|copy|share|take)\b/.test(
      t,
    )
  ) {
    return true
  }

  if (
    /^(don't|dont|do\s+not)\s+(call|open|text|send|copy|share|navigate|take|enable|disable|turn)\b/.test(
      t,
    )
  ) {
    return true
  }

  // "Non chiamare…", "Non aprire…" without relying on chiama vs chiamare
  if (
    /^non\s+(chiam|apr|mand|scriv|invi|copi|port|navig|condivid|accend|spegn|attiv|disattiv)/.test(
      t,
    )
  ) {
    return true
  }

  return false
}

/**
 * Technical / explanatory / test / implementation outer framing.
 */
export function looksMetaOrInstructionalOuter(raw, surface) {
  const s = fold(surface)
  const full = fold(raw)
  if (!s) return false

  if (
    /^(implementa|implement|spiega|spiegami|explain|create\s+tests?|scrivi\s+un\s+test|write\s+(a\s+)?tests?|write\s+tests?|nel\s+test|in\s+the\s+test|il\s+comando|the\s+command|the\s+(phrase|text|function|example|app)|testa(?:re)?|test\s+whether|detect|assert|expected|regression|document|documenta|supporto|support\s+for|aggiungi|add\s+support|fix|verifica|verify|audit|diagnose)\b/.test(
      s,
    )
  ) {
    return true
  }

  // "Scrivi un test / articolo / codice …" is authorship, not SMS
  if (
    /^(scrivi|write|manda|send)\s+(un\s+)?(test|tests|articolo|article|codice|code|prompt|documentazione|docs?|suite|example|esempio)\b/.test(
      s,
    )
  ) {
    return true
  }

  // Prose about model/API "call(s)" without a short direct command
  if (
    /\b(openai\s+call|model\s+calls?|llm\s+calls?|extra\s+model\s+calls?|responses\.create|detectphoneactionintent|maxrawlength|local_exchange|whether\s+openai\s+is\s+called|do\s+not\s+make\s+a\s+(real\s+)?openai\s+call|do\s+not\s+add\s+new\s+(llm|model)\s+calls?)\b/.test(
      full,
    ) &&
    !isShortDirectCommand(surface)
  ) {
    return true
  }

  // Heading / markdown task paste
  if (/^#{1,6}\s+/.test(String(surface).trim()) || /^#{1,6}\s+/.test(String(raw).trim())) {
    return true
  }

  return false
}

export function isShortDirectCommand(surface) {
  const n = normalizeTimerText(surface)
  if (n.length === 0 || n.length > 160) return false
  if (n.includes('\n')) return false
  return hasDirectActionStarter(surface)
}

/**
 * Whole-message quote, injection phrases, or action only living inside
 * quotes / inline code / fences / JSON-ish examples.
 */
export function looksQuotedOrCodeData(raw) {
  const t = String(raw || '')
  const trimmed = t.trim()
  if (!trimmed) return false

  // Whole message is a quote
  if (/^["“«].*["”»]\s*$/s.test(trimmed)) return true
  if (/^`[^`]+`\s*$/s.test(trimmed)) return true

  // Classic prompt-injection
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true

  // Entire message is a fenced code block
  if (/^```[\s\S]*```\s*$/m.test(trimmed)) return true

  // Function-call / detector example as the primary content
  if (
    /^\s*(detectPhoneActionIntent|expect|assert\.|it\(|test\()\s*\(/m.test(trimmed) ||
    /detectPhoneActionIntent\s*\(\s*["'`]/.test(t)
  ) {
    // Allow only if there is also a short bare imperative outside code/quotes
    const stripped = stripDataRegions(t)
    const surface = getOuterActionSurface(stripped)
    if (!hasDirectActionStarter(surface) || !isShortDirectCommand(surface)) {
      return true
    }
  }

  return false
}

/** Remove fenced code, inline code, and simple quoted spans for outer checks. */
export function stripDataRegions(raw) {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/["“«][^"”»\n]{0,200}["”»]/g, ' ')
    .replace(/'[^'\n]{0,200}'/g, ' ')
}

/**
 * Gate: may we run Phone Action matchers on this utterance?
 * @returns {{ ok: true, surface: string } | { ok: false, failureCode: string }}
 */
export function evaluateOuterPhoneIntent(raw, opts = {}) {
  const languageHint = opts.languageHint
  void languageHint
  const text = fold(raw)
  if (!text || text.length < 2) {
    return { ok: false, failureCode: 'empty' }
  }

  if (looksQuotedOrCodeData(raw)) {
    return { ok: false, failureCode: 'quoted_or_code' }
  }

  const surface = getOuterActionSurface(raw)

  if (looksNegatedOuter(surface)) {
    return { ok: false, failureCode: 'negation' }
  }

  if (looksMetaOrInstructionalOuter(raw, surface)) {
    return { ok: false, failureCode: 'meta_or_instructional' }
  }

  // WhatsApp sticky follow-up: bare "Su WhatsApp" with active context
  const follow =
    opts.hasMessagingContext &&
    (/^\s*(su\s+whatsapp|on\s+whatsapp|via\s+whatsapp|con\s+whatsapp)\s*[.!]?\s*$/i.test(surface) ||
      /^\s*whatsapp\s*[.!]?\s*$/i.test(surface))

  if (!follow && !hasDirectActionStarter(surface)) {
    return { ok: false, failureCode: 'no_outer_direct_command' }
  }

  return { ok: true, surface, failureCode: null }
}
