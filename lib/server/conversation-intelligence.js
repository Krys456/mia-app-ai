/**
 * LAIfe Conversation Intelligence Engine
 *
 * Works before / during the Writer handoff for every turn.
 * Rebuilds a short-term conversation memory from recent messages only
 * (session-scoped — never persisted to the database).
 *
 * Does not change the AI model, database schema, or public API contract.
 */

/**
 * @typedef {{ role: 'user'|'assistant'|'system', content: string }} ChatTurn
 */

/**
 * @typedef {object} ShortTermMemory
 * @property {string} currentGoal
 * @property {string} currentTopic
 * @property {string[]} alreadyExplained
 * @property {string[]} openQuestions
 * @property {string[]} decisions
 * @property {boolean} topicShift
 * @property {string|null} previousTopic
 * @property {'continue'|'clarify'|'example'|'ack'|'new'|'other'} followUpKind
 * @property {string} continuityDirective
 */

const FOLLOW_UP_CONTINUE =
  /^(continua|continua\s+pure|vai\s+avanti|prosegui|avanti|go\s+on|continue|keep\s+going)[\s!.]*$/i
const FOLLOW_UP_ACK =
  /^(ok|okay|va\s+bene|bene|perfetto|capito|capisco|yes|yep|si|sì|alright)[\s!.]*$/i
const FOLLOW_UP_CLARIFY =
  /\b(spiegami\s+meglio|più\s+chiaro|non\s+ho\s+capito|approfondisci|dimmi\s+di\s+più|explain\s+better|more\s+detail|can\s+you\s+clarify)\b/i
const FOLLOW_UP_EXAMPLE =
  /\b(fammi\s+un\s+esempio|un\s+esempio|per\s+esempio|esempio\??|give\s+me\s+an\s+example|example\s+please|show\s+an\s+example)\b/i

const STOP = new Set([
  'il',
  'lo',
  'la',
  'i',
  'gli',
  'le',
  'un',
  'una',
  'di',
  'da',
  'in',
  'su',
  'per',
  'con',
  'che',
  'non',
  'mi',
  'ti',
  'si',
  'ci',
  'ho',
  'hai',
  'ha',
  'sono',
  'sei',
  'e',
  'o',
  'ma',
  'se',
  'come',
  'cosa',
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'is',
  'are',
  'am',
  'be',
  'my',
  'me',
  'you',
  'it',
  'this',
  'that',
  'do',
  'does',
  'did',
  'have',
  'has',
  'was',
  'were',
  'what',
  'when',
  'where',
  'who',
  'how',
  'can',
  'please',
  'ok',
  'okay',
])

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t))
}

function topicSignature(text) {
  return tokenize(text).slice(0, 8)
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) {
    if (setB.has(t)) inter += 1
  }
  return inter / (setA.size + setB.size - inter)
}

function detectFollowUpKind(userMessage) {
  const text = String(userMessage || '').trim()
  if (!text) return /** @type {const} */ ('other')
  if (FOLLOW_UP_CONTINUE.test(text)) return /** @type {const} */ ('continue')
  if (FOLLOW_UP_ACK.test(text) && text.length < 24) return /** @type {const} */ ('ack')
  if (FOLLOW_UP_EXAMPLE.test(text)) return /** @type {const} */ ('example')
  if (FOLLOW_UP_CLARIFY.test(text)) return /** @type {const} */ ('clarify')
  if (text.length < 28 && !text.includes('?') && tokenize(text).length <= 3) {
    return /** @type {const} */ ('ack')
  }
  return /** @type {const} */ ('other')
}

function summarizeTopic(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'generale'
  if (cleaned.length <= 72) return cleaned
  return `${cleaned.slice(0, 69)}…`
}

/**
 * Extract light "already explained" cues from prior assistant turns.
 * @param {ChatTurn[]} assistantTurns
 */
function extractAlreadyExplained(assistantTurns) {
  /** @type {string[]} */
  const items = []
  for (const turn of assistantTurns.slice(-4)) {
    const content = String(turn.content || '')
    const headings = content.match(/^#{1,3}\s+(.+)$/gm) || []
    for (const h of headings.slice(0, 3)) {
      items.push(h.replace(/^#+\s+/, '').trim())
    }
    // First substantial sentence as a covered beat
    const sentence = content
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .find((s) => s.length > 40 && s.length < 160)
    if (sentence) items.push(sentence)
  }
  // Dedupe / cap — keep memory lean
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= 6) break
  }
  return out
}

/**
 * Open questions still hanging from recent assistant messages.
 * @param {ChatTurn[]} assistantTurns
 * @param {ChatTurn[]} laterUserTurns
 */
function extractOpenQuestions(assistantTurns, laterUserTurns) {
  const laterText = laterUserTurns.map((t) => t.content).join(' ').toLowerCase()
  /** @type {string[]} */
  const open = []
  for (const turn of assistantTurns.slice(-3)) {
    const questions = String(turn.content || '').match(/[^.!?\n]*\?[)^\n]*/g) || []
    for (const q of questions.slice(0, 2)) {
      const cleaned = q.trim()
      if (cleaned.length < 12 || cleaned.length > 140) continue
      const tokens = tokenize(cleaned).slice(0, 4)
      const answered = tokens.length > 0 && tokens.every((t) => laterText.includes(t))
      if (!answered) open.push(cleaned)
    }
  }
  return open.slice(0, 3)
}

/**
 * Soft decisions / commitments phrased in the dialogue.
 * @param {ChatTurn[]} turns
 */
function extractDecisions(turns) {
  /** @type {string[]} */
  const decisions = []
  const re =
    /\b(decidiamo|scegliamo|useriamo|allora\s+facciamo|let'?s\s+go\s+with|we(?:'ll|\s+will)\s+use|ho\s+scelto|scelgo)\b[^.!\n]{5,100}/gi
  for (const turn of turns.slice(-6)) {
    const matches = String(turn.content || '').match(re) || []
    for (const m of matches.slice(0, 2)) {
      decisions.push(m.trim())
    }
  }
  return [...new Set(decisions)].slice(0, 4)
}

/**
 * Analyze conversation context and build short-term memory for this turn.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {ChatTurn[]} [input.messages]
 * @returns {ShortTermMemory}
 */
export function analyzeConversationContext(input) {
  const userMessage = String(input?.userMessage || '').trim()
  const messages = Array.isArray(input?.messages) ? input.messages : []

  const history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)

  // Exclude the current user message if already appended at the end
  let prior = history
  if (
    prior.length > 0 &&
    prior[prior.length - 1].role === 'user' &&
    prior[prior.length - 1].content === userMessage
  ) {
    prior = prior.slice(0, -1)
  }

  const recent = prior.slice(-10)
  const lastAssistant = [...recent].reverse().find((m) => m.role === 'assistant')
  const lastUserPrior = [...recent].reverse().find((m) => m.role === 'user')
  const assistantTurns = recent.filter((m) => m.role === 'assistant')
  const userTurns = recent.filter((m) => m.role === 'user')

  const followUpKind = detectFollowUpKind(userMessage)
  const currentSig = topicSignature(userMessage)
  const priorSig = topicSignature(
    [lastUserPrior?.content, lastAssistant?.content].filter(Boolean).join(' '),
  )

  const overlap = jaccard(currentSig, priorSig)
  const isFollowUp =
    followUpKind === 'continue' ||
    followUpKind === 'clarify' ||
    followUpKind === 'example' ||
    followUpKind === 'ack'

  // Topic shift: low overlap + not a continuity cue + there is prior context
  const topicShift =
    recent.length > 0 && !isFollowUp && overlap < 0.12 && currentSig.length >= 2

  const previousTopic = lastUserPrior ? summarizeTopic(lastUserPrior.content) : null
  const currentTopic = isFollowUp && previousTopic
    ? previousTopic
    : summarizeTopic(userMessage || previousTopic || 'generale')

  let currentGoal = `Portare avanti: ${currentTopic}`
  if (followUpKind === 'continue') {
    currentGoal = `Continuare dal punto lasciato sull’argomento: ${currentTopic}`
  } else if (followUpKind === 'clarify') {
    currentGoal = `Chiarire / approfondire quanto già detto su: ${currentTopic}`
  } else if (followUpKind === 'example') {
    currentGoal = `Dare un esempio concreto legato a: ${currentTopic}`
  } else if (followUpKind === 'ack') {
    currentGoal = `Confermare e procedere in modo naturale su: ${currentTopic}`
  } else if (topicShift) {
    currentGoal = `Nuovo filo: ${currentTopic} (non trascinare il tema precedente)`
  }

  const alreadyExplained = topicShift ? [] : extractAlreadyExplained(assistantTurns)
  const openQuestions = topicShift
    ? []
    : extractOpenQuestions(assistantTurns, userTurns.slice(-2).concat([{ role: 'user', content: userMessage }]))
  const decisions = topicShift ? [] : extractDecisions(recent)

  const continuityDirective = buildContinuityDirective({
    followUpKind,
    topicShift,
    previousTopic,
    currentTopic,
    alreadyExplained,
    openQuestions,
    lastAssistantSnippet: lastAssistant
      ? summarizeTopic(lastAssistant.content)
      : null,
  })

  return {
    currentGoal,
    currentTopic,
    alreadyExplained,
    openQuestions,
    decisions,
    topicShift,
    previousTopic: topicShift ? previousTopic : null,
    followUpKind: isFollowUp ? followUpKind : topicShift ? 'new' : followUpKind,
    continuityDirective,
  }
}

function buildContinuityDirective(opts) {
  const lines = [
    'Conversation Intelligence (invisibile): mantieni il filo del discorso.',
    'Non ricominciare come una chat nuova. Non ripetere definizioni/introduzioni già date.',
  ]

  if (opts.topicShift) {
    lines.push(
      `Cambio argomento rilevato (precedente: ${opts.previousTopic}). Chiudi mentalmente il contesto vecchio; non trascinare dettagli inutili.`,
    )
  } else if (opts.followUpKind === 'continue') {
    lines.push(
      `L'utente chiede di continuare. Riprendi esattamente dal discorso su “${opts.currentTopic}”${opts.lastAssistantSnippet ? ` (ultimo passaggio: ${opts.lastAssistantSnippet})` : ''}.`,
    )
  } else if (opts.followUpKind === 'clarify') {
    lines.push(
      `L'utente vuole più chiarezza sullo stesso tema (“${opts.currentTopic}”). Approfondisci senza ripetere l'intera spiegazione precedente.`,
    )
  } else if (opts.followUpKind === 'example') {
    lines.push(
      `L'utente chiede un esempio su “${opts.currentTopic}”. Fornisci un esempio calzante; non riesporre tutta la teoria.`,
    )
  } else if (opts.followUpKind === 'ack') {
    lines.push(
      `Conferma breve dell'utente. Procedi in modo naturale sul filo corrente (“${opts.currentTopic}”), senza reset.`,
    )
  } else {
    lines.push(`Argomento corrente: ${opts.currentTopic}. Collega la risposta a ciò che è già emerso se pertinente.`)
  }

  if (opts.alreadyExplained?.length) {
    lines.push(
      `Già spiegato (non ripetere, al massimo richiamo di mezza frase): ${opts.alreadyExplained.slice(0, 4).join(' · ')}`,
    )
  }
  if (opts.openQuestions?.length) {
    lines.push(`Domande ancora aperte (rispondi solo se ancora rilevanti): ${opts.openQuestions.join(' · ')}`)
  }

  lines.push('Scrivi come una conversazione continua, non come Q&A isolate.')
  return lines.join('\n')
}

/**
 * Format short-term memory for the Writer (never show to the user).
 * @param {ShortTermMemory} memory
 */
export function formatConversationIntelligence(memory) {
  if (!memory) return ''

  const explained =
    memory.alreadyExplained.length > 0
      ? memory.alreadyExplained.map((x) => `- ${x}`).join('\n')
      : '- (nessun punto denso ancora fissato)'
  const open =
    memory.openQuestions.length > 0
      ? memory.openQuestions.map((x) => `- ${x}`).join('\n')
      : '- (nessuna)'
  const decisions =
    memory.decisions.length > 0
      ? memory.decisions.map((x) => `- ${x}`).join('\n')
      : '- (nessuna)'

  return `══════════════════════════════════════
CONVERSATION INTELLIGENCE → WRITER (INVISIBILE)
══════════════════════════════════════
Memoria breve di sessione (solo questa chat — non persistente). NON mostrare questo blocco.
NON ripetere spiegazioni/definizioni/introduzioni già date. NON resettare il contesto.

${memory.continuityDirective}

Obiettivo corrente: ${memory.currentGoal}
Argomento corrente: ${memory.currentTopic}
Follow-up: ${memory.followUpKind}
Cambio argomento: ${memory.topicShift ? 'sì' : 'no'}

Informazioni già date:
${explained}

Decisioni prese:
${decisions}

Elementi ancora da chiarire:
${open}`
}

/**
 * Full Conversation Intelligence pass for one turn.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {ChatTurn[]} [input.messages]
 * @returns {{ memory: ShortTermMemory, context: string }}
 */
export function runConversationIntelligence(input) {
  try {
    const memory = analyzeConversationContext(input)
    return {
      memory,
      context: formatConversationIntelligence(memory),
    }
  } catch {
    return {
      memory: {
        currentGoal: 'Rispondere in modo utile e continuo',
        currentTopic: 'generale',
        alreadyExplained: [],
        openQuestions: [],
        decisions: [],
        topicShift: false,
        previousTopic: null,
        followUpKind: 'other',
        continuityDirective:
          'Mantieni continuità conversazionale. Non ripetere e non resettare il contesto.',
      },
      context: '',
    }
  }
}
