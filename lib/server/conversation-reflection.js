/**
 * LAIfe Conversation Reflection — internal learning after dialogue.
 *
 * After a completed turn/conversation, evaluates:
 * - which responses worked well
 * - which required clarification
 * - which user preferences became apparent
 * - which recurring mistakes should be avoided
 *
 * Produces learning signals for future turns.
 * Does NOT modify factual long-term memories (brain-memory).
 * Never shown to the user.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {object} LearningSignals
 * @property {string[]} workedWell
 * @property {string[]} neededClarification
 * @property {string[]} apparentPreferences
 * @property {string[]} mistakesToAvoid
 * @property {string} directive
 * @property {number} turnCount
 * @property {number} createdAt
 */

const CLARIFY =
  /\b(spiegami\s+meglio|più\s+chiaro|non\s+ho\s+capito|non\s+chiaro|approfondisci|dimmi\s+di\s+più|explain\s+better|more\s+detail|can\s+you\s+clarify|troppo\s+vago|non\s+è\s+quello\s+che)\b/i

const WORKED =
  /\b(perfetto|ottimo|grazie|thanks|thank\s+you|esatto|così\s+va\s+bene|great|perfect|awesome|risolto|funziona)\b/i

const TOO_LONG =
  /\b(troppo\s+lungo|più\s+breve|in\s+sintesi|tl;dr|shorten|too\s+long|concis)\b/i

const WANT_DETAIL =
  /\b(più\s+dettagli|approfond|in\s+depth|spiegami\s+meglio|dettagliat)\b/i

const WANT_LIST =
  /\b(in\s+lista|elenco|step\s+by\s+step|bullet|numerami)\b/i

const WANT_CODE =
  /\b(codice|code|snippet|esempio\s+di\s+codice|mostra\s+il\s+codice)\b/i

const FORMAL =
  /\b(per\s+favore|gentile|cordiali|la\s+prego|could\s+you\s+please)\b/i

const CASUAL =
  /\b(ciao|hey|bro|raga|lol|ahah|😅)\b/i

/**
 * @param {ChatTurn[]} messages
 * @returns {ChatTurn[]}
 */
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
}

/**
 * Pair user→assistant exchanges from a transcript.
 * @param {ChatTurn[]} turns
 */
function pairExchanges(turns) {
  /** @type {{ user: string, assistant: string|null }[]} */
  const pairs = []
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role !== 'user') continue
    const next = turns[i + 1]
    pairs.push({
      user: turns[i].content,
      assistant: next?.role === 'assistant' ? next.content : null,
    })
  }
  return pairs
}

/**
 * @param {string[]} items
 * @param {number} max
 */
function uniqCap(items, max) {
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  for (const item of items) {
    const cleaned = String(item || '').replace(/\s+/g, ' ').trim()
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
    if (out.length >= max) break
  }
  return out
}

/**
 * Reflect on a conversation transcript and produce learning signals.
 * Safe to call after each completed assistant turn or when a chat ends.
 *
 * @param {object} input
 * @param {ChatTurn[]} input.messages
 * @param {string} [input.latestAssistant]
 * @returns {LearningSignals}
 */
export function reflectOnConversation(input) {
  let turns = normalizeTurns(input?.messages || [])
  const latest = String(input?.latestAssistant || '').trim()
  if (latest) {
    const last = turns[turns.length - 1]
    if (!last || last.role !== 'assistant' || last.content !== latest) {
      turns = [...turns, { role: 'assistant', content: latest }]
    }
  }

  /** @type {string[]} */
  const workedWell = []
  /** @type {string[]} */
  const neededClarification = []
  /** @type {string[]} */
  const apparentPreferences = []
  /** @type {string[]} */
  const mistakesToAvoid = []

  const pairs = pairExchanges(turns)

  for (let i = 0; i < pairs.length; i++) {
    const { user, assistant } = pairs[i]
    const nextUser = pairs[i + 1]?.user || ''

    if (assistant && WORKED.test(nextUser)) {
      workedWell.push('L’utente ha confermato positivamente dopo la risposta — mantieni chiarezza e concretezza simili.')
    }

    if (CLARIFY.test(user) || CLARIFY.test(nextUser)) {
      neededClarification.push('È servito un chiarimento — la risposta precedente era incompleta o troppo densa.')
      mistakesToAvoid.push('Evitare spiegazioni vaghe o saltare passaggi: anticipa un esempio breve quando il tema è tecnico.')
    }

    if (TOO_LONG.test(user) || TOO_LONG.test(nextUser)) {
      apparentPreferences.push('Preferenza: risposte più concise.')
      mistakesToAvoid.push('Non scrivere muri di testo; vai al punto prima, poi offri dettaglio solo se chiesto.')
    }

    if (WANT_DETAIL.test(user)) {
      apparentPreferences.push('Preferenza: più profondità / dettaglio quando richiesto.')
      if (i > 0) {
        neededClarification.push('L’utente ha chiesto più dettaglio — la prima passata era troppo sintetica per lui.')
      }
    }

    if (WANT_LIST.test(user)) {
      apparentPreferences.push('Preferenza: struttura a elenco / step quando utile.')
    }

    if (WANT_CODE.test(user)) {
      apparentPreferences.push('Preferenza: esempi in codice quando il dominio lo consente.')
    }

    if (FORMAL.test(user)) {
      apparentPreferences.push('Registro: leggermente più formale.')
    } else if (CASUAL.test(user)) {
      apparentPreferences.push('Registro: informale / amichevole.')
    }

    // User repeated similar ask after an answer → prior reply missed the mark
    if (assistant && nextUser && nextUser.length > 20) {
      const aTokens = new Set(
        assistant
          .toLowerCase()
          .split(/[^a-z0-9àèéìòù]+/i)
          .filter((t) => t.length > 3)
          .slice(0, 20),
      )
      const uTokens = nextUser
        .toLowerCase()
        .split(/[^a-z0-9àèéìòù]+/i)
        .filter((t) => t.length > 3)
      const overlap = uTokens.filter((t) => aTokens.has(t)).length
      if (
        overlap >= 3 &&
        !WORKED.test(nextUser) &&
        (CLARIFY.test(nextUser) || nextUser.includes('?'))
      ) {
        mistakesToAvoid.push('Non ripetere la stessa spiegazione: riformula e punta al dubbio specifico.')
      }
    }
  }

  // Whole-session preference skew
  const allUser = pairs.map((p) => p.user).join('\n')
  if (pairs.length >= 2 && !TOO_LONG.test(allUser) && pairs.every((p) => (p.user?.length || 0) < 80)) {
    apparentPreferences.push('Preferenza di ritmo: scambi brevi e frequenti.')
  }
  if (pairs.some((p) => (p.assistant?.length || 0) > 1200) && TOO_LONG.test(allUser)) {
    workedWell.push('') // noop placeholder filtered later
    mistakesToAvoid.push('Calibrare la lunghezza: le risposte lunghe non sono state apprezzate in questa chat.')
  }

  // Positive closure
  const lastUser = [...turns].reverse().find((t) => t.role === 'user')
  if (lastUser && WORKED.test(lastUser.content) && lastUser.content.length < 60) {
    workedWell.push('Chiusura positiva della conversazione — lo stile recente ha funzionato.')
  }

  const signals = {
    workedWell: uniqCap(workedWell.filter(Boolean), 4),
    neededClarification: uniqCap(neededClarification, 4),
    apparentPreferences: uniqCap(apparentPreferences, 5),
    mistakesToAvoid: uniqCap(mistakesToAvoid, 5),
    directive: '',
    turnCount: pairs.length,
    createdAt: Date.now(),
  }

  signals.directive = buildLearningDirective(signals)
  return signals
}

/**
 * @param {LearningSignals} signals
 */
function buildLearningDirective(signals) {
  const lines = [
    'Conversation Reflection (invisibile): usa questi learning signal per calibrare il tono e la struttura.',
    'NON citarli. NON dire che stai riflettendo. NON salvarli come memorie fattuali.',
  ]

  if (signals.workedWell.length) {
    lines.push(`Cosa ha funzionato: ${signals.workedWell.join(' · ')}`)
  }
  if (signals.neededClarification.length) {
    lines.push(`Dove è servito chiarire: ${signals.neededClarification.join(' · ')}`)
  }
  if (signals.apparentPreferences.length) {
    lines.push(`Preferenze emerse: ${signals.apparentPreferences.join(' · ')}`)
  }
  if (signals.mistakesToAvoid.length) {
    lines.push(`Errori da non ripetere: ${signals.mistakesToAvoid.join(' · ')}`)
  }

  if (
    !signals.workedWell.length &&
    !signals.neededClarification.length &&
    !signals.apparentPreferences.length &&
    !signals.mistakesToAvoid.length
  ) {
    lines.push('Pochi segnali ancora: resta utile, chiaro e calibrato sul messaggio corrente.')
  }

  return lines.join('\n')
}

/**
 * Merge prior stored signals with a fresh reflection (preferences/mistakes accumulate).
 * @param {LearningSignals | null | undefined} prior
 * @param {LearningSignals} next
 * @returns {LearningSignals}
 */
export function mergeLearningSignals(prior, next) {
  if (!prior) return next
  const merged = {
    workedWell: uniqCap([...(prior.workedWell || []), ...(next.workedWell || [])], 5),
    neededClarification: uniqCap(
      [...(prior.neededClarification || []), ...(next.neededClarification || [])],
      5,
    ),
    apparentPreferences: uniqCap(
      [...(prior.apparentPreferences || []), ...(next.apparentPreferences || [])],
      6,
    ),
    mistakesToAvoid: uniqCap([...(prior.mistakesToAvoid || []), ...(next.mistakesToAvoid || [])], 6),
    directive: '',
    turnCount: Math.max(prior.turnCount || 0, next.turnCount || 0),
    createdAt: next.createdAt || Date.now(),
  }
  merged.directive = buildLearningDirective(merged)
  return merged
}

/**
 * Format learning signals for Writer / Cognitive Engine (invisible).
 * @param {LearningSignals | null | undefined} signals
 */
export function formatLearningSignalsForWriter(signals) {
  if (!signals) return ''
  const hasAny =
    (signals.workedWell?.length || 0) +
      (signals.neededClarification?.length || 0) +
      (signals.apparentPreferences?.length || 0) +
      (signals.mistakesToAvoid?.length || 0) >
    0
  if (!hasAny && !signals.directive) return ''

  const section = (title, items) =>
    items?.length
      ? `${title}:\n${items.map((x) => `- ${x}`).join('\n')}`
      : `${title}:\n- (nessuno)`

  return `══════════════════════════════════════
CONVERSATION REFLECTION → LEARNING SIGNALS (INVISIBILE)
══════════════════════════════════════
Riflessione interna post-conversazione / post-turno. NON mostrare all’utente.
NON modificare memorie fattuali. Usa solo per calibrare stile, chiarezza e struttura.

${signals.directive}

${section('Risposte che hanno funzionato', signals.workedWell)}

${section('Dove è servito un chiarimento', signals.neededClarification)}

${section('Preferenze utente emerse', signals.apparentPreferences)}

${section('Errori ricorrenti da evitare', signals.mistakesToAvoid)}`
}

/**
 * Full reflection pass for one completed transcript.
 * @param {object} input
 * @param {ChatTurn[]} input.messages
 * @param {string} [input.latestAssistant]
 * @param {LearningSignals | null} [input.priorSignals]
 * @returns {{ signals: LearningSignals, context: string }}
 */
export function runConversationReflection(input) {
  try {
    const fresh = reflectOnConversation({
      messages: input?.messages,
      latestAssistant: input?.latestAssistant,
    })
    const signals = mergeLearningSignals(input?.priorSignals || null, fresh)
    return {
      signals,
      context: formatLearningSignalsForWriter(signals),
    }
  } catch {
    return {
      signals: {
        workedWell: [],
        neededClarification: [],
        apparentPreferences: [],
        mistakesToAvoid: [],
        directive:
          'Mantieni utilità e chiarezza. Nessun learning signal disponibile in questo turno.',
        turnCount: 0,
        createdAt: Date.now(),
      },
      context: '',
    }
  }
}
