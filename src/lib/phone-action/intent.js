/**
 * #315 / #315A — Deterministic Phone Action intent (IT/EN).
 * Only explicit user action requests — not meta/educational talk.
 */

import { fold, extractPhoneNumber, extractEmail, normalizeTimerText } from './parse.js'

export function detectPhoneLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (
    t.match(
      /\b(apri|aprimi|portami|naviga|indicazioni|chiama|scrivi|manda|invia|condividi|copia|fotocamera|messaggio|mail|posta|gmail|sveglia|bluetooth|volume|torcia|wifi|aereo|allora)\b/g,
    ) || []
  ).length
  const en = (
    t.match(
      /\b(open|navigate|directions|call|text|sms|share|copy|camera|email|mail|gmail|alarm|bluetooth|volume|flashlight|torch|wifi|airplane)\b/g,
    ) || []
  ).length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

function isMetaTalk(t) {
  if (
    /\b(cos[' ]?e|what\s+is|what's|che\s+cos[' ]?e|parlami|tell\s+me|come\s+funziona|how\s+(does|do)|scrivi\s+un\s+articolo|write\s+(an\s+)?article)\b/.test(
      t,
    )
  ) {
    if (/\b(spotify|youtube|maps|google\s+maps|gmail|telefonat|chiamat|sms|whatsapp)\b/.test(t)) {
      if (/\b(apri|aprimi|open|portami|naviga|chiama|call|condividi|share|copia|copy|vai\s+su|go\s+to)\b/.test(t)) {
        return false
      }
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

/** Strip leading discourse markers so "Ok, allora copia…" still matches. */
export function stripDiscoursePrefix(raw) {
  let s = normalizeTimerText(raw)
  // Allow missing space after comma: "Ok,allora"
  s = s.replace(/,\s*/g, ', ')
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(
      /^(ok|okay|va bene|bene|allora|quindi|perfetto|certo|right|well|so|then)[,.]?\s+/i,
      '',
    )
    if (next === s) break
    s = next
  }
  return s
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
      dest = dest.replace(/^(a|ad|al|alla|allo|ai|agli|alle|the|to)\s+/i, '')
      if (dest.length >= 2) return dest.slice(0, 300)
    }
  }
  return null
}

/**
 * Extract SMS phone + body from natural phrases including:
 * Scrivi "Ciao Krys" a +39 3761165503
 */
export function extractSmsParts(text) {
  const raw = normalizeTimerText(text)
  const phone = extractPhoneNumber(raw)
  if (!phone) return { phone: null, body: '' }

  let body = ''

  // Quoted body before "a <phone>": Scrivi "Ciao Krys" a +39…
  const quoted =
    raw.match(
      /\b(?:scrivi|manda|invia|text|send)\s+[«"“']([^"”»']+)[»"”']\s+(?:a|to)\s+/i,
    ) || raw.match(/[«"“']([^"”»']+)[»"”']\s+(?:a|to)\s+\+/i)
  if (quoted) {
    body = quoted[1].trim()
  }

  // Scrivi Ciao Krys a +39… (unquoted body between verb and a/+phone)
  if (!body) {
    const unquoted = raw.match(
      /\b(?:scrivi|manda|invia)\s+(.+?)\s+(?:a|al|alla)\s+\+?\d/i,
    )
    if (unquoted) {
      let mid = unquoted[1].trim()
      // Drop leading sms / messaggio markers
      mid = mid
        .replace(/^(un\s+)?(sms|messaggio|messaggio\s+di\s+testo)\s+/i, '')
        .replace(/^["«“']+|["»”']+$/g, '')
        .trim()
      // Avoid treating "un SMS" alone as body
      if (mid && !/^(un\s+)?(sms|messaggio)$/i.test(mid)) {
        body = mid
      }
    }
  }

  // ": message" / dicendo / con scritto
  if (!body) {
    const bodyMatch =
      raw.match(/:\s*(.+)$/i) ||
      raw.match(/\bdicendo(?:\s+che)?\s+(.+)$/i) ||
      raw.match(/\bcon\s+scritto\s+(.+)$/i) ||
      raw.match(
        /\b(?:con\s+(?:il\s+)?(?:testo|messaggio)|saying|with(?:\s+message)?|message)\s*[:\s]\s*(.+)$/i,
      )
    if (bodyMatch) {
      body = bodyMatch[1].trim()
    }
  }

  // Don't treat the phone fragment as body
  if (body) {
    const phoneDigits = phone.replace(/\D/g, '')
    if (body.replace(/\D/g, '').includes(phoneDigits) && body.length < phone.length + 6) {
      body = ''
    }
    body = body.replace(/^["«“']+|["»”']+$/g, '').trim()
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
      const idx = raw.toLowerCase().indexOf(email)
      const after = raw.slice(idx + email.length).replace(/^[\s,:]+/, '')
      if (after.startsWith(':')) body = after.slice(1).trim()
    }
  }
  return { email, subject, body }
}

function looksCopyIntent(raw) {
  const stripped = stripDiscoursePrefix(raw)
  const t = fold(stripped)
  if (!/\b(copia|copy|copialo|copiala)\b/.test(t)) return false

  // Short pronouns / imperatives after discourse strip
  if (/^\s*(copialo|copiala|copy\s+it|copy\s+that)\s*[.!]?\s*$/i.test(stripped)) {
    return true
  }

  // Explicit previous/last message or reply
  if (
    /\b(copia|copy)\b.{0,60}\b(messaggio|risposta|answer|reply|response|message)\b/.test(t) ||
    /\b(copia|copy)\b.{0,40}\b(precedente|precedent|ultimo|ultima|last|previous|quello|questa|questo|that|this)\b/.test(
      t,
    ) ||
    /\b(copia|copy)\b.{0,50}\b(che\s+hai\s+appena\s+scritto|what\s+you\s+just\s+wrote|hai\s+appena\s+scritto)\b/.test(
      t,
    )
  ) {
    return true
  }

  return false
}

function looksSmsIntent(raw, text) {
  const phone = extractPhoneNumber(raw)
  if (!phone) {
    // Explicit SMS without number → needs number (caller handles)
    if (/\b(sms|manda\s+un\s+sms|scrivi\s+(un\s+)?sms|send\s+(an?\s+)?sms|text\s+message)\b/.test(text)) {
      return 'needs_number'
    }
    return false
  }

  // Never steal email compose
  if (/\b(mail|email|e-mail|posta\s+elettronica)\b/.test(text) && !/\bsms\b/.test(text)) {
    return false
  }

  // Classic markers
  if (
    /\b(sms|messaggio\s+di\s+testo|text\s+message)\b/.test(text) ||
    /\b(scrivi\s+(un\s+)?sms|send\s+(an?\s+)?sms|manda\s+un\s+sms|invia\s+un\s+(sms|messaggio))\b/.test(
      text,
    ) ||
    /\b(manda|invia)\b.{0,20}\b(messaggio|sms|text)\b/.test(text)
  ) {
    return 'sms'
  }

  // Scrivi "…" a +39… / Scrivi Ciao a +39… / Scrivi a +39…
  if (/\b(scrivi|manda|invia|text|send)\b/.test(text) && /\b(a|to|al|alla)\b/.test(text)) {
    // Negative: writing articles / essays without SMS intent
    if (/\b(articolo|article|saggio|essay|storia|story|libro|book)\b/.test(text)) {
      return false
    }
    return 'sms'
  }

  return false
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

  // --- Native required
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
  if (/\b(svegliami|sveglia|set\s+(an?\s+)?alarm|wake\s+me)\b/.test(text) && !/\btimer\b/.test(text)) {
    return { kind: 'native_required', language, target: 'alarm' }
  }

  // Phone Notes — no reliable web handoff (future native)
  if (
    /\b(apri|open)\b.{0,30}\b(note|notes|app\s+note)\b/.test(text) &&
    /\b(telefono|phone|ios|android|sistema)\b/.test(text)
  ) {
    return { kind: 'native_required', language, target: 'notes' }
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
  if (
    /^\s*(condividilo|condividila|share\s+it|share\s+that)\s*[.!]?\s*$/i.test(
      stripDiscoursePrefix(raw),
    )
  ) {
    return { kind: 'share', language }
  }
  if (/\b(condividi|share)\b.{0,40}\b(risposta|answer|reply|response)\b/.test(text)) {
    return { kind: 'share', language }
  }

  // --- Copy (#315A conversational variants)
  if (looksCopyIntent(raw)) {
    return { kind: 'copy', language }
  }

  // --- Call
  if (/\b(chiama|call)\b/.test(text)) {
    const phone = extractPhoneNumber(raw)
    if (phone) {
      return { kind: 'call', language, phone }
    }
    if (/\b(chiama|call)\s+[a-zàèéìòù]{2,}/i.test(text) && !/\d{6,}/.test(text)) {
      return { kind: 'call_needs_number', language, failureCode: 'contacts_unavailable' }
    }
  }

  // --- SMS (#315A natural phrasing)
  const smsKind = looksSmsIntent(raw, text)
  if (smsKind === 'needs_number') {
    return { kind: 'sms_needs_number', language, failureCode: 'phone_required' }
  }
  if (smsKind === 'sms') {
    const parts = extractSmsParts(raw)
    if (parts.phone) {
      return { kind: 'sms', language, phone: parts.phone, body: parts.body || '' }
    }
  }

  // --- Email compose (mailto) — not "Apri Gmail"
  if (
    /\b(mail|email|e-mail|posta\s+elettronica)\b/.test(text) &&
    /\b(scrivi|write|send)\b/.test(text) &&
    !/\bgmail\b/.test(text)
  ) {
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

  // --- Navigate
  if (/\b(portami|naviga|indicazioni|directions|navigate)\b/.test(text)) {
    const dest = extractNavigateDestination(raw)
    if (dest) {
      return { kind: 'navigate', language, destination: dest, target: 'google_maps' }
    }
  }

  // --- Open app / site (HTTPS handoff)
  if (/\b(apri|aprimi|open|avvia|apriamo|vai\s+su|go\s+to)\b/.test(text)) {
    if (/\bspotify\b/.test(text)) {
      return { kind: 'open_app', language, target: 'spotify' }
    }
    if (/\byoutube\b/.test(text)) {
      return { kind: 'open_app', language, target: 'youtube' }
    }
    if (/\b(google\s+maps|maps|mappe)\b/.test(text)) {
      return { kind: 'open_app', language, target: 'google_maps' }
    }
    if (/\bgmail\b/.test(text)) {
      return { kind: 'open_app', language, target: 'gmail' }
    }
  }

  return { kind: 'none', language }
}
