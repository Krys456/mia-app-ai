/**
 * #315 — Deterministic Phone Action intent (IT/EN).
 * Only explicit user action requests — not meta/educational talk.
 */

import { fold, extractPhoneNumber, extractEmail, normalizeTimerText } from './parse.js'

export function detectPhoneLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (
    t.match(
      /\b(apri|portami|naviga|indicazioni|chiama|scrivi|condividi|copia|fotocamera|messaggio|mail|posta|sveglia|bluetooth|volume|torcia|wifi|aereo)\b/g,
    ) || []
  ).length
  const en = (
    t.match(
      /\b(open|navigate|directions|call|text|sms|share|copy|camera|email|mail|alarm|bluetooth|volume|flashlight|torch|wifi|airplane)\b/g,
    ) || []
  ).length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

function isMetaTalk(t) {
  if (/\b(cos[' ]?e|what\s+is|what's|che\s+cos[' ]?e|parlami|tell\s+me|come\s+funziona|how\s+(does|do)|scrivi\s+un\s+articolo|write\s+(an\s+)?article)\b/.test(t)) {
    // Only meta if about a service, not an action verb primary
    if (/\b(spotify|youtube|maps|google\s+maps|telefonat|chiamat|sms|whatsapp)\b/.test(t)) {
      // "Apri Spotify" has apri — not meta
      if (/\b(apri|open|portami|naviga|chiama|call|condividi|share|copia|copy)\b/.test(t)) return false
      return true
    }
  }
  if (/\b(parlami\s+di|tell\s+me\s+about|come\s+funziona)\b/.test(t)) return true
  return false
}

/** Quoted / instructional content that must NOT authorize actions. */
export function looksQuotedOrInjected(raw) {
  const t = String(raw || '')
  // Whole message is a quote
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  // Document/web style injection phrases
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function extractNavigateDestination(text) {
  const raw = normalizeTimerText(text)
  const patterns = [
    /\b(?:portami|naviga|indicazioni(?:\s+per)?|directions?(?:\s+to)?|navigate(?:\s+to)?)\s+(?:a|verso|to|towards|per)\s+(.+)$/i,
    /\b(?:portami|naviga)\s+(.+)$/i,
    /\b(?:indicazioni\s+per)\s+(.+)$/i,
  ]
  for (const re of patterns) {
    const m = raw.match(re)
    if (m && m[1]) {
      let dest = m[1].trim().replace(/[.!?]+$/, '')
      // Strip leading articles
      dest = dest.replace(/^(a|ad|al|alla|allo|ai|agli|alle|the|to)\s+/i, '')
      if (dest.length >= 2) return dest.slice(0, 300)
    }
  }
  return null
}

function extractSmsParts(text) {
  const raw = normalizeTimerText(text)
  const phone = extractPhoneNumber(raw)
  if (!phone) return { phone: null, body: '' }

  // "dicendo che..." / "dicendo:" / ": message" / "con messaggio"
  let body = ''
  const bodyMatch =
    raw.match(/:\s*(.+)$/i) ||
    raw.match(/\bdicendo(?:\s+che)?\s+(.+)$/i) ||
    raw.match(/\b(?:con\s+(?:il\s+)?(?:testo|messaggio)|saying|with(?:\s+message)?|message)\s*[:\s]\s*(.+)$/i)
  if (bodyMatch) {
    body = bodyMatch[1].trim()
    // Don't treat the phone fragment as body
    if (body.includes(phone) && body.length < phone.length + 4) body = ''
  }
  return { phone, body }
}

function extractEmailParts(text) {
  const raw = normalizeTimerText(text)
  const email = extractEmail(raw)
  if (!email) return { email: null, subject: '', body: '' }

  let subject = ''
  let body = ''
  const subj =
    raw.match(/\b(?:oggetto|subject)\s*[:\s]\s*([^.,;]+)/i) ||
    raw.match(/\bcon\s+oggetto\s+([^.,;]+)/i)
  if (subj) subject = subj[1].trim()

  const bod =
    raw.match(/\bdicendo(?:\s+che)?\s+(.+)$/i) ||
    raw.match(/\b(?:body|testo|messaggio)\s*[:\s]\s*(.+)$/i) ||
    raw.match(/:\s*(.+)$/i)
  if (bod) {
    body = bod[1].trim()
    if (body.toLowerCase().includes(email)) {
      // likely "mail a x@y.com: rest" — keep rest after email
      const idx = raw.toLowerCase().indexOf(email)
      const after = raw.slice(idx + email.length).replace(/^[\s,:]+/, '')
      if (after.startsWith(':')) body = after.slice(1).trim()
    }
  }
  // Avoid using subject line as body duplicate
  if (subject && body.startsWith(subject)) {
    /* keep */
  }
  return { email, subject, body }
}

/**
 * @returns {{
 *   kind: string,
 *   language: 'it'|'en',
 *   target?: string,
 *   destination?: string,
 *   phone?: string,
 *   email?: string,
 *   subject?: string,
 *   body?: string,
 *   failureCode?: string|null
 * }}
 */
export function detectPhoneActionIntent(raw, opts = {}) {
  const language = detectPhoneLanguage(raw, opts.languageHint || 'it')
  const text = fold(raw)
  if (!text || text.length < 2) {
    return { kind: 'none', language }
  }

  if (looksQuotedOrInjected(raw)) {
    return { kind: 'none', language, failureCode: 'quoted_or_injected' }
  }

  if (isMetaTalk(text)) {
    return { kind: 'none', language, failureCode: 'meta_talk' }
  }

  // --- Native required (honest block) — before open_* so "apri impostazioni bluetooth" etc.
  if (
    /\b(alza|abbassa|metti|attiva|disattiva|accendi|spegni|set|turn\s+on|turn\s+off|enable|disable)\b/.test(
      text,
    ) &&
    /\b(volume|silenzios[oa]|silent|bluetooth|wi-?fi|dati\s+mobili|mobile\s+data|modalita\s+aereo|airplane|torcia|flashlight|torch)\b/.test(
      text,
    )
  ) {
    return { kind: 'native_required', language, target: 'system' }
  }
  if (
    /\b(attiva|disattiva|accendi|enable|disable|turn\s+on|turn\s+off)\b.{0,20}\b(bluetooth|wi-?fi|torcia|flashlight)\b/.test(
      text,
    ) ||
    /^\s*(bluetooth|wi-?fi|airplane\s+mode|modalita\s+aereo)\b/.test(text)
  ) {
    return { kind: 'native_required', language, target: 'system' }
  }
  // Alarm — leave to timer router when it's clearly alarm; still catch if phone runs first
  if (/\b(svegliami|sveglia|set\s+(an?\s+)?alarm|wake\s+me)\b/.test(text) && !/\btimer\b/.test(text)) {
    return { kind: 'native_required', language, target: 'alarm' }
  }

  // --- Open Vision / camera
  if (
    /\b(apri|open|avvia)\b.{0,30}\b(fotocamera|camera|vision(\s+ai)?)\b/.test(text) ||
    /\b(fammi\s+scattare|scatta)\b.{0,20}\b(foto|photo)\b/.test(text) ||
    /\b(open\s+the\s+camera|apri\s+vision)\b/.test(text)
  ) {
    return { kind: 'open_vision', language, target: 'vision' }
  }

  // --- Share
  if (
    /\b(condividi|share)\b/.test(text) &&
    /\b(questa\s+risposta|ultima\s+risposta|last\s+(answer|reply|response)|this\s+(answer|reply|response)|questo|quello|it|that)\b/.test(
      text,
    )
  ) {
    return { kind: 'share', language }
  }
  if (/^\s*(condividilo|condividila|share\s+it|share\s+that)\s*[.!]?\s*$/i.test(normalizeTimerText(raw))) {
    return { kind: 'share', language }
  }
  if (/\b(condividi|share)\b.{0,40}\b(risposta|answer|reply|response)\b/.test(text)) {
    return { kind: 'share', language }
  }

  // --- Copy
  if (
    /\b(copia|copy)\b/.test(text) &&
    /\b(questa\s+risposta|ultima\s+risposta|last\s+(answer|reply|response)|this\s+(answer|reply)|questo|quello|it|that)\b/.test(
      text,
    )
  ) {
    return { kind: 'copy', language }
  }
  if (/^\s*(copialo|copiala|copy\s+it|copy\s+that)\s*[.!]?\s*$/i.test(normalizeTimerText(raw))) {
    return { kind: 'copy', language }
  }
  if (/\b(copia|copy)\b.{0,40}\b(risposta|answer|reply|response)\b/.test(text)) {
    return { kind: 'copy', language }
  }

  // --- Call
  if (/\b(chiama|call)\b/.test(text)) {
    const phone = extractPhoneNumber(raw)
    if (phone) {
      return { kind: 'call', language, phone }
    }
    // Name without number
    if (/\b(chiama|call)\s+[a-zàèéìòù]{2,}/i.test(text) && !/\d{6,}/.test(text)) {
      return { kind: 'call_needs_number', language, failureCode: 'contacts_unavailable' }
    }
  }

  // --- SMS
  if (
    /\b(sms|messaggio\s+di\s+testo|text\s+message)\b/.test(text) ||
    /\b(scrivi\s+(un\s+)?sms|send\s+(an?\s+)?sms|text)\b/.test(text) ||
    /\b(scrivi\s+a)\b/.test(text) && extractPhoneNumber(raw)
  ) {
    // Don't steal email "scrivi una mail"
    if (/\b(mail|email|e-mail|posta)\b/.test(text)) {
      /* fall through to email */
    } else {
      const parts = extractSmsParts(raw)
      if (parts.phone) {
        return { kind: 'sms', language, phone: parts.phone, body: parts.body || '' }
      }
      if (/\b(sms|text)\b/.test(text)) {
        return { kind: 'sms_needs_number', language, failureCode: 'phone_required' }
      }
    }
  }

  // --- Email
  if (/\b(mail|email|e-mail|posta\s+elettronica)\b/.test(text) && /\b(scrivi|write|send|apri)\b/.test(text)) {
    const parts = extractEmailParts(raw)
    if (parts.email) {
      return {
        kind: 'email',
        language,
        email: parts.email,
        subject: parts.subject || '',
        body: parts.body || '',
      }
    }
    return { kind: 'email_needs_address', language, failureCode: 'email_required' }
  }

  // --- Navigate (before open maps — "portami a X")
  if (/\b(portami|naviga|indicazioni|directions|navigate)\b/.test(text)) {
    const dest = extractNavigateDestination(raw)
    if (dest) {
      return { kind: 'navigate', language, destination: dest, target: 'google_maps' }
    }
  }

  // --- Open app
  if (/\b(apri|open|avvia|apriamo)\b/.test(text)) {
    if (/\bspotify\b/.test(text)) {
      return { kind: 'open_app', language, target: 'spotify' }
    }
    if (/\byoutube\b/.test(text)) {
      return { kind: 'open_app', language, target: 'youtube' }
    }
    if (/\b(google\s+maps|maps|mappe)\b/.test(text)) {
      return { kind: 'open_app', language, target: 'google_maps' }
    }
  }

  return { kind: 'none', language }
}
