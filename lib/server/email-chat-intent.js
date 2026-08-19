/**
 * #311 — Deterministic Email intent detector / router (IT + EN).
 * High precision over recall. No LLM. No Calendar coupling.
 */

/**
 * @typedef {'recent'|'unread'|'search'|'from_sender'|'today'|'summarize'|'important'|'none'} EmailOperation
 */

/**
 * @typedef {{
 *   intent: 'email' | 'none'
 *   operation: EmailOperation
 *   query: string | null
 *   sender: string | null
 *   timeframe: 'today' | 'recent' | null
 * }} EmailRoute
 */

/**
 * @param {unknown} text
 */
export function normalizeEmailIntentText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .replace(/[\u00A0\u202F\u2000-\u200A\u2028\u2029]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * @param {string} lower
 */
function isFalsePositive(lower) {
  // Physical mail / postal
  if (
    /\b(posta\s+prioritaria|posta\s+raccomandata|ufficio\s+postale|buca\s+delle\s+lettere)\b/.test(
      lower,
    )
  ) {
    return true
  }
  if (/\b(snail\s+mail|postal\s+service|post\s+office|mailbox\s+key)\b/.test(lower)) return true
  // Chain / marketing / product "email" mentions without inbox ask
  if (/\b(template\s+email|email\s+marketing|newsletter\s+tool|smtp|imap\s+server)\b/.test(lower)) {
    return true
  }
  // Chat / SMS "messaggi" without email cue
  if (
    /\b(whatsapp|telegram|sms|messaggi\s+di\s+testo|text\s+message)\b/.test(lower) &&
    !/\b(email|e-mail|mail|inbox|posta|gmail)\b/.test(lower)
  ) {
    return true
  }
  // Armor / chainmail fantasy
  if (/\b(chain\s*mail|chainmail|maglia\s+di\s+maglia)\b/.test(lower)) return true
  // "post" as social post
  if (/\b(instagram|tiktok|linkedin)\b/.test(lower) && /\bpost(s)?\b/.test(lower)) return true
  // Calendar / schedule (leave to Calendar)
  if (
    /\b(calendario|calendar|appuntament[oi]|evento|eventi|riunione|meeting)\b/.test(lower) &&
    !/\b(email|e-mail|mail|inbox|posta|gmail)\b/.test(lower)
  ) {
    return true
  }
  return false
}

/**
 * @param {string} lower
 */
function hasEmailCue(lower) {
  return /\b(emails?|e-mails?|e mails?|mails?|inbox|posta|gmail|casella)\b/.test(lower)
}

/**
 * High-precision Italian/English inbox asks that omit the word "email".
 * @param {string} lower
 */
function hasImplicitInboxAsk(lower) {
  if (/\bcosa\s+mi\s+(?:[eè]|e'|e)\s+arrivat/.test(lower)) return true
  if (/\b(?:ho\s+)?ricevut[oa]\s+(?:qualcosa|qualche|una|un)\b/.test(lower)) return true
  if (/\bci\s+sono\s+.+\s+non\s+lette\b/.test(lower)) return true
  if (/\bany\s+unread\b/.test(lower)) return true
  if (/\bcheck\s+(?:my\s+)?inbox\b/.test(lower)) return true
  if (/\bwhat(?:'?s|\s+is)\s+in\s+my\s+inbox\b/.test(lower)) return true
  return false
}

/**
 * Extract sender after "da/from/di" patterns.
 * @param {string} lower
 * @param {string} raw
 */
function extractSender(lower, raw) {
  const patterns = [
    /\b(?:da|from|di)\s+([a-z0-9._%+\-àèéìòù@ ]{2,40})/i,
    /\bmail\s+di\s+([a-z0-9._%+\-àèéìòù ]{2,40})/i,
    /\bemails?\s+from\s+([a-z0-9._%+\-@ ]{2,40})/i,
  ]
  for (const re of patterns) {
    const m = raw.match(re) || lower.match(re)
    if (m && m[1]) {
      let s = m[1].trim().replace(/[?!.]+$/, '').trim()
      // cut trailing junk words
      s = s.replace(/\b(oggi|ieri|questa|settimana|unread|non|lette)\b.*$/i, '').trim()
      if (s.length >= 2 && s.length <= 60) return s
    }
  }
  return null
}

/**
 * Extract free-text search after "su/about/cerca".
 * @param {string} raw
 * @param {string} lower
 */
function extractSearchQuery(raw, lower) {
  const patterns = [
    /\bcerca(?:\s+le)?\s+(?:email|e-mail|mail|mails)(?:\s+su|\s+about|\s+per)?\s+(.+)$/i,
    /\bfind\s+(?:emails?|mail)\s+(?:about|on|for|with)\s+(.+)$/i,
    /\bsearch\s+(?:my\s+)?(?:emails?|inbox)\s+(?:for\s+)?(.+)$/i,
    /\bemails?\s+su\s+(.+)$/i,
  ]
  for (const re of patterns) {
    const m = raw.match(re) || lower.match(re)
    if (m && m[1]) {
      const q = m[1].trim().replace(/[?!.]+$/, '').trim()
      if (q.length >= 2 && q.length <= 120) return q
    }
  }
  return null
}

/**
 * @param {unknown} text
 * @returns {EmailRoute}
 */
export function routeEmailChatIntent(text) {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text)
  const lower = normalizeEmailIntentText(raw)
  if (!lower) {
    return { intent: 'none', operation: 'none', query: null, sender: null, timeframe: null }
  }
  if (isFalsePositive(lower)) {
    return { intent: 'none', operation: 'none', query: null, sender: null, timeframe: null }
  }
  if (!hasEmailCue(lower) && !hasImplicitInboxAsk(lower)) {
    return { intent: 'none', operation: 'none', query: null, sender: null, timeframe: null }
  }

  // Important
  if (
    /\b(importanti?|important|prioritar)\b/.test(lower) &&
    hasEmailCue(lower)
  ) {
    return {
      intent: 'email',
      operation: 'important',
      query: null,
      sender: null,
      timeframe: 'recent',
    }
  }

  // Unread
  if (
    /\b(non\s+lette|non\s+lett[ae]|non\s+lette\?|unread|not\s+read)\b/.test(lower) ||
    /\bci\s+sono\s+email\s+non\s+lette\b/.test(lower) ||
    /\bany\s+unread\b/.test(lower)
  ) {
    return {
      intent: 'email',
      operation: 'unread',
      query: null,
      sender: null,
      timeframe: null,
    }
  }

  // From sender
  const sender = extractSender(lower, raw)
  if (
    sender &&
    (/\b(da|from|ricevut[oa]|received|arriv)\b/.test(lower) ||
      /\bmail\s+di\b/.test(lower) ||
      /\bemails?\s+from\b/.test(lower))
  ) {
    return {
      intent: 'email',
      operation: 'from_sender',
      query: null,
      sender,
      timeframe: null,
    }
  }

  // Search
  const searchQ = extractSearchQuery(raw, lower)
  if (searchQ || /\b(cerca|search|find)\b/.test(lower)) {
    return {
      intent: 'email',
      operation: 'search',
      query: searchQ || null,
      sender: null,
      timeframe: null,
    }
  }

  // Summarize (before today — "summarize today's emails")
  if (
    /\b(riassum[ie]|riassumimi|summary|summarize|summarise|recap)\b/.test(lower) &&
    (hasEmailCue(lower) || hasImplicitInboxAsk(lower))
  ) {
    const tf = /\b(oggi|today)\b/.test(lower) ? 'today' : 'recent'
    return {
      intent: 'email',
      operation: 'summarize',
      query: null,
      sender: null,
      timeframe: tf,
    }
  }

  // Today
  if (
    /\b(oggi|today)\b/.test(lower) &&
    (hasEmailCue(lower) || hasImplicitInboxAsk(lower) || /\barrivat/.test(lower))
  ) {
    return {
      intent: 'email',
      operation: 'today',
      query: null,
      sender: null,
      timeframe: 'today',
    }
  }

  // Check inbox / recent
  if (
    /\b(controlla\s+(?:la\s+)?posta|check\s+(?:my\s+)?(?:inbox|mail|email)|mostrami\s+le\s+ultime|ultime\s+email|recent\s+emails?|what(?:'?s|\s+is)\s+in\s+my\s+inbox)\b/.test(
      lower,
    ) ||
    /\bcosa\s+mi\s+(?:[eè]|e')\s+arrivat[oa]\b/.test(lower) ||
    /\bwhat\s+emails?\s+did\s+i\s+get\b/.test(lower) ||
    /\bho\s+(?:delle\s+)?email\b/.test(lower)
  ) {
    return {
      intent: 'email',
      operation: 'recent',
      query: null,
      sender: null,
      timeframe: 'recent',
    }
  }

  // Generic email ask with cue
  if (hasEmailCue(lower) && /\b(ho|ci\s+sono|any|do\s+i\s+have|mostra|show|lista|list)\b/.test(lower)) {
    return {
      intent: 'email',
      operation: 'recent',
      query: null,
      sender: null,
      timeframe: 'recent',
    }
  }

  return { intent: 'none', operation: 'none', query: null, sender: null, timeframe: null }
}

/**
 * Backward-compatible boolean detector.
 * @param {unknown} text
 */
export function detectEmailChatIntent(text) {
  const routed = routeEmailChatIntent(text)
  return routed.intent === 'email' ? routed.operation : 'none'
}
