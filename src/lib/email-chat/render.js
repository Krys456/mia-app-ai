/**
 * #337B — Deterministic Gmail chat renderer (Italian-first, read-only).
 * Extractive only — never invents subjects, senders, times, or content.
 * Zero model calls.
 */

export function safeText(v, max = 200) {
  return (
    String(v || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max) || ''
  )
}

export function formatReceivedTime(iso, timeZone, language = 'it') {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'it-IT', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return ''
  }
}

function windowPhrase(timeWindow, language) {
  const it = {
    today: 'oggi',
    morning: 'stamattina',
    yesterday: 'ieri',
    week: 'questa settimana',
    afternoon: 'nel pomeriggio',
    evening: 'stasera',
  }
  const en = {
    today: 'today',
    morning: 'this morning',
    yesterday: 'yesterday',
    week: 'this week',
    afternoon: 'this afternoon',
    evening: 'this evening',
  }
  const table = language === 'en' ? en : it
  return table[timeWindow] || (language === 'en' ? 'recently' : 'di recente')
}

export function bulletLine(msg, timeZone, language = 'it') {
  const time = formatReceivedTime(msg?.receivedAt, timeZone, language)
  const from = safeText(
    msg?.from || msg?.fromEmail || (language === 'en' ? 'Unknown sender' : 'Mittente sconosciuto'),
    60,
  )
  const subject = safeText(msg?.subject, 100) || (language === 'en' ? '(no subject)' : '(senza oggetto)')
  const unreadTag = msg?.unread ? (language === 'en' ? ' [unread]' : ' [non letta]') : ''
  return time ? `• ${time} — ${from} — ${subject}${unreadTag}` : `• ${from} — ${subject}${unreadTag}`
}

/**
 * @param {string} status
 * @param {'it'|'en'} [language]
 */
export function failureReply(status, language = 'it') {
  const it = {
    disabled: 'Email non è attiva in questo ambiente.',
    disconnected: 'Collega Gmail in Impostazioni per vedere le tue email.',
    auth_required: 'Collega Gmail in Impostazioni per vedere le tue email.',
    reconnect_required: 'Ricollega Gmail: l’accesso è scaduto.',
    timeout: 'Gmail sta impiegando troppo a rispondere. Riprova tra poco.',
    error: 'Non riesco a leggere Gmail in questo momento.',
    empty: 'Non risultano email per questa ricerca.',
    no_sender_match: 'Non trovo email recenti da quel mittente.',
  }
  const en = {
    disabled: 'Gmail is not enabled in this environment.',
    disconnected: 'Connect Gmail in Settings to read your email.',
    auth_required: 'Connect Gmail in Settings to read your email.',
    reconnect_required: 'Reconnect Gmail: access has expired.',
    timeout: 'Gmail is taking too long to respond. Try again shortly.',
    error: 'I can’t read Gmail right now.',
    empty: 'No matching emails found.',
    no_sender_match: 'I couldn’t find any email from that sender.',
  }
  const table = language === 'en' ? en : it
  return table[status] || table.error
}

/**
 * #383B — Honest read-only refusal for send/write/compose asks.
 * @param {'it'|'en'} [language]
 */
export function renderGmailWriteUnsupported(language = 'it') {
  if (language === 'en') {
    return 'I can read your Gmail inbox, but I can’t send or write emails yet.'
  }
  return 'Posso leggere la tua casella Gmail, ma non posso ancora inviare o scrivere email.'
}

/**
 * @param {object[]} messages
 * @param {string} queryType
 * @param {{ language?: 'it'|'en', timeZone?: string, timeWindow?: string, sender?: string }} [opts]
 */
export function renderEmailList(messages, queryType, opts = {}) {
  const language = opts.language === 'en' ? 'en' : 'it'
  const tz = opts.timeZone || 'UTC'
  const list = Array.isArray(messages) ? messages : []
  const windowLabel = windowPhrase(opts.timeWindow || 'today', language)
  const sender = opts.sender || null

  if (!list.length) {
    if (queryType === 'sender' && sender) {
      return language === 'en' ? `I couldn’t find any email from ${sender}.` : `Non ho trovato email da ${sender}.`
    }
    if (queryType === 'unread') {
      return language === 'en' ? 'No unread emails.' : 'Non risultano email non lette.'
    }
    if (queryType === 'important') {
      return language === 'en' ? 'No important emails.' : 'Non risultano email importanti.'
    }
    if (queryType === 'latest') {
      return language === 'en' ? 'No emails found.' : 'Non risultano email.'
    }
    return language === 'en' ? `No emails ${windowLabel}.` : `Non risultano email ${windowLabel}.`
  }

  if (queryType === 'latest') {
    return language === 'en'
      ? `Your latest email:\n${bulletLine(list[0], tz, language)}`
      : `La tua ultima email:\n${bulletLine(list[0], tz, language)}`
  }

  if (queryType === 'sender' && list.length === 1 && sender) {
    return language === 'en'
      ? `You have 1 email from ${sender}:\n${bulletLine(list[0], tz, language)}`
      : `Hai 1 email da ${sender}:\n${bulletLine(list[0], tz, language)}`
  }

  const lines = list.map((m) => bulletLine(m, tz, language))

  if (queryType === 'sender' && sender) {
    return language === 'en'
      ? `You have ${list.length} emails from ${sender}:\n${lines.join('\n')}`
      : `Hai ${list.length} email da ${sender}:\n${lines.join('\n')}`
  }
  if (queryType === 'unread') {
    return language === 'en'
      ? `You have ${list.length} unread emails:\n${lines.join('\n')}`
      : `Hai ${list.length} email non lette:\n${lines.join('\n')}`
  }
  if (queryType === 'important') {
    return language === 'en'
      ? `You have ${list.length} important emails:\n${lines.join('\n')}`
      : `Hai ${list.length} email importanti:\n${lines.join('\n')}`
  }

  return language === 'en'
    ? `You have ${list.length} emails ${windowLabel}:\n${lines.join('\n')}`
    : `Hai ${list.length} email ${windowLabel}:\n${lines.join('\n')}`
}

/**
 * Extractive summary — bullets of subject/from/time (+ short excerpt of
 * body/snippet when present). Never invents content beyond the pack fields.
 * @param {object[]} messages
 * @param {{ language?: 'it'|'en', timeZone?: string, timeWindow?: string }} [opts]
 */
export function extractiveSummary(messages, opts = {}) {
  const language = opts.language === 'en' ? 'en' : 'it'
  const tz = opts.timeZone || 'UTC'
  const list = Array.isArray(messages) ? messages : []
  const windowLabel = windowPhrase(opts.timeWindow || 'today', language)

  if (!list.length) {
    return language === 'en'
      ? `No emails ${windowLabel} to summarize.`
      : `Non risultano email ${windowLabel} da riassumere.`
  }

  const lines = list.map((m) => {
    const time = formatReceivedTime(m?.receivedAt, tz, language)
    const from = safeText(
      m?.from || m?.fromEmail || (language === 'en' ? 'Unknown sender' : 'Mittente sconosciuto'),
      60,
    )
    const subject = safeText(m?.subject, 100) || (language === 'en' ? '(no subject)' : '(senza oggetto)')
    const excerpt = safeText(m?.bodyText || m?.snippet, 140)
    const prefix = time ? `• ${time} — ${from} — ${subject}` : `• ${from} — ${subject}`
    return excerpt ? `${prefix}: ${excerpt}` : prefix
  })

  const head =
    language === 'en'
      ? `Summary of your emails ${windowLabel} (${list.length}):`
      : `Riassunto delle tue email ${windowLabel} (${list.length}):`
  return `${head}\n${lines.join('\n')}`
}

/**
 * Follow-up answers from active context. Never re-fetches on its own — the
 * controller decides when a network call is warranted (e.g. "riassumila").
 * @param {string} kind
 * @param {object} ctx
 * @param {{ ordinalIndex?: number, message?: object }} [opts]
 */
export function renderFollowUp(kind, ctx, opts = {}) {
  const language = ctx?.language === 'en' ? 'en' : 'it'
  const tz = ctx?.timezone || 'UTC'
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : []
  const at = (idx) => (idx != null && idx >= 0 && idx < messages.length ? messages[idx] : null)

  if (kind === 'ordinal') {
    const m = at(opts.ordinalIndex)
    if (!m) {
      return language === 'en'
        ? 'I don’t have that email in the recent answer.'
        : 'Non ho quell’email nella risposta recente.'
    }
    return bulletLine(m, tz, language)
  }

  if (kind === 'next_after') {
    const focus = typeof ctx?.focusIndex === 'number' ? ctx.focusIndex : -1
    const m = at(focus >= 0 ? focus + 1 : 0)
    if (!m) {
      return language === 'en'
        ? 'There are no further emails in that list.'
        : 'Non ci sono altre email in quell’elenco.'
    }
    return bulletLine(m, tz, language)
  }

  if (kind === 'previous') {
    const focus = typeof ctx?.focusIndex === 'number' ? ctx.focusIndex : 0
    const m = at(focus - 1)
    if (!m) {
      return language === 'en'
        ? 'There is no previous email in that list.'
        : 'Non c’è un’email precedente in quell’elenco.'
    }
    return bulletLine(m, tz, language)
  }

  const focusIdx = typeof ctx?.focusIndex === 'number' && ctx.focusIndex >= 0 ? ctx.focusIndex : 0
  const focused = at(focusIdx)

  if (kind === 'when') {
    if (!focused) {
      return language === 'en'
        ? 'I don’t have an email in context for that.'
        : 'Non ho un’email in memoria per quella domanda.'
    }
    const time = formatReceivedTime(focused.receivedAt, tz, language)
    if (!time) {
      return language === 'en'
        ? 'I don’t have a reliable time for that email.'
        : 'Non ho un orario attendibile per quell’email.'
    }
    return language === 'en' ? `It arrived at ${time}.` : `È arrivata alle ${time}.`
  }

  if (kind === 'who') {
    if (!focused) {
      return language === 'en'
        ? 'I don’t have an email in context for that.'
        : 'Non ho un’email in memoria per quella domanda.'
    }
    const from = safeText(focused.from || focused.fromEmail, 80)
    if (!from) {
      return language === 'en' ? 'I don’t have a sender for that email.' : 'Non ho un mittente per quell’email.'
    }
    return language === 'en' ? `It’s from ${from}.` : `È di ${from}.`
  }

  if (kind === 'subject') {
    if (!focused) {
      return language === 'en'
        ? 'I don’t have an email in context for that.'
        : 'Non ho un’email in memoria per quella domanda.'
    }
    const subject = safeText(focused.subject, 140)
    return subject || (language === 'en' ? '(no subject)' : '(senza oggetto)')
  }

  if (kind === 'unread_status') {
    if (!focused) {
      return language === 'en'
        ? 'I don’t have an email in context for that.'
        : 'Non ho un’email in memoria per quella domanda.'
    }
    return focused.unread
      ? language === 'en'
        ? 'Yes, it’s still unread.'
        : 'Sì, è ancora non letta.'
      : language === 'en'
        ? 'No, it has already been read.'
        : 'No, è già stata letta.'
  }

  if (kind === 'summarize') {
    const target = opts.message || focused
    if (!target) {
      return language === 'en'
        ? 'I don’t have an email in context for that.'
        : 'Non ho un’email in memoria per quella domanda.'
    }
    return extractiveSummary([target], { language, timeZone: tz })
  }

  return language === 'en'
    ? 'I’m not sure which email detail you mean.'
    : 'Non ho capito a quale dettaglio dell’email ti riferisci.'
}
