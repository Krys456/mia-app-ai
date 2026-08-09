/**
 * LAIfe Conversation Intelligence Engine
 *
 * Long-conversation context management (session-scoped, never persisted to DB).
 * Runs before the Writer on every turn.
 *
 * Goals:
 * - Remember what was already explained (avoid repeats)
 * - Detect topic shifts
 * - Reuse previous conclusions and preserve important decisions
 * - Maintain continuity across very long chats via internal older-context summary
 * - Feel like the same assistant throughout
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
 * @property {string[]} conclusions
 * @property {string} sessionSummary
 * @property {boolean} isLongConversation
 * @property {number} turnCount
 * @property {boolean} topicShift
 * @property {string|null} previousTopic
 * @property {'continue'|'clarify'|'example'|'ack'|'new'|'other'} followUpKind
 * @property {string} continuityDirective
 * @property {'beginner'|'intermediate'|'advanced'|'expert'|null} [knowledgeLevel]
 * @property {string|null} [knowledgeTopic]
 * @property {'high'|'medium'|'low'|null} [knowledgeConfidence]
 */

const FOLLOW_UP_CONTINUE =
  /^(continua|continua\s+pure|vai\s+avanti|prosegui|avanti|go\s+on|continue|keep\s+going)[\s!.]*$/i
const FOLLOW_UP_ACK =
  /^(ok|okay|k|va\s+bene|bene|perfetto|capito|capisco|ho\s+capito|yes|yep|yeah|yup|si|sì|alright|nice|cool|great|awesome|interessante|i\s+see|vedo|ah|oh|got\s+it|makes\s+sense|chiaro|esatto|giusto|sure)[\s!.]*$/i
const FOLLOW_UP_CLARIFY =
  /\b(spiegami\s+meglio|più\s+chiaro|non\s+ho\s+capito|approfondisci|dimmi\s+di\s+più|explain\s+better|more\s+detail|can\s+you\s+clarify)\b/i
const FOLLOW_UP_EXAMPLE =
  /\b(fammi\s+un\s+esempio|un\s+esempio|per\s+esempio|esempio\??|give\s+me\s+an\s+example|example\s+please|show\s+an\s+example)\b/i

/** Recent turns kept in full detail for active thread reasoning. */
const RECENT_WINDOW = 12
/** Older turns are compacted into an internal summary above this length. */
const LONG_CHAT_THRESHOLD = 14
const MAX_EXPLAINED = 8
const MAX_DECISIONS = 6
const MAX_CONCLUSIONS = 5
const MAX_SUMMARY_BEATS = 8

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
 * Deduplicate string list (case-insensitive), preserve order, cap length.
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
 * Extract light "already explained" cues from prior assistant turns.
 * @param {ChatTurn[]} assistantTurns
 * @param {number} [max]
 */
function extractAlreadyExplained(assistantTurns, max = MAX_EXPLAINED) {
  /** @type {string[]} */
  const items = []
  for (const turn of assistantTurns) {
    const content = String(turn.content || '')
    const headings = content.match(/^#{1,3}\s+(.+)$/gm) || []
    for (const h of headings.slice(0, 3)) {
      items.push(h.replace(/^#+\s+/, '').trim())
    }
    // Numbered step titles often mark covered ground
    const steps = content.match(/^\s*\d+[.)]\s+([^\n]{8,80})/gm) || []
    for (const s of steps.slice(0, 2)) {
      items.push(s.replace(/^\s*\d+[.)]\s+/, '').trim())
    }
    const sentence = content
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .find((s) => s.length > 40 && s.length < 160)
    if (sentence) items.push(sentence)
  }
  return uniqCap(items, max)
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
  for (const turn of assistantTurns.slice(-4)) {
    const questions = String(turn.content || '').match(/[^.!?\n]*\?[)^\n]*/g) || []
    for (const q of questions.slice(0, 2)) {
      const cleaned = q.trim()
      if (cleaned.length < 12 || cleaned.length > 140) continue
      const tokens = tokenize(cleaned).slice(0, 4)
      const answered = tokens.length > 0 && tokens.every((t) => laterText.includes(t))
      if (!answered) open.push(cleaned)
    }
  }
  return uniqCap(open, 3)
}

/**
 * Soft decisions / commitments phrased in the dialogue.
 * Preserved across topic shifts when important.
 * @param {ChatTurn[]} turns
 */
function extractDecisions(turns) {
  /** @type {string[]} */
  const decisions = []
  const re =
    /\b(decidiamo|scegliamo|useremo|useriamo|allora\s+facciamo|andiamo\s+con|optiamo\s+per|let'?s\s+go\s+with|we(?:'ll|\s+will)\s+use|ho\s+scelto|scelgo|procediamo\s+con|confermo\s+che|va\s+bene\s+cos[iì]|agreed|we'll\s+go\s+with)\b[^.!\n]{5,120}/gi
  for (const turn of turns) {
    const matches = String(turn.content || '').match(re) || []
    for (const m of matches.slice(0, 2)) {
      decisions.push(m.trim())
    }
  }
  return uniqCap(decisions, MAX_DECISIONS)
}

/**
 * Reusable conclusions / takeaways from earlier turns.
 * @param {ChatTurn[]} turns
 */
function extractConclusions(turns) {
  /** @type {string[]} */
  const conclusions = []
  const re =
    /\b(in\s+sintesi|quindi|conclusione|il\s+punto\s+è|la\s+chiave\s+è|in\s+short|bottom\s+line|so\s+the\s+plan\s+is|riassumendo)\b[,:\s—-][^.!\n]{10,140}/gi
  for (const turn of turns) {
    if (turn.role !== 'assistant' && turn.role !== 'user') continue
    const content = String(turn.content || '')
    const matches = content.match(re) || []
    for (const m of matches.slice(0, 2)) {
      conclusions.push(m.trim())
    }
    // Bold takeaways often mark conclusions
    const bolds = content.match(/\*\*([^*]{12,100})\*\*/g) || []
    if (bolds.length === 1) {
      conclusions.push(bolds[0].replace(/\*\*/g, '').trim())
    }
  }
  return uniqCap(conclusions, MAX_CONCLUSIONS)
}

/**
 * Compact internal summary of older turns for long chats.
 * Never shown to the user — Writer-only.
 * @param {ChatTurn[]} olderTurns
 */
export function buildOlderContextSummary(olderTurns) {
  if (!olderTurns.length) return ''

  const userTopics = olderTurns
    .filter((t) => t.role === 'user')
    .map((t) => summarizeTopic(t.content))
  const topics = uniqCap(userTopics, 5)

  const explained = extractAlreadyExplained(
    olderTurns.filter((t) => t.role === 'assistant'),
    MAX_SUMMARY_BEATS,
  )
  const decisions = extractDecisions(olderTurns)
  const conclusions = extractConclusions(olderTurns)

  const parts = [
    `Chat lunga: ${olderTurns.length} turni precedenti compressi.`,
    topics.length ? `Temi già toccati: ${topics.join(' · ')}.` : '',
    explained.length
      ? `Già spiegato in precedenza (non ripetere): ${explained.slice(0, 5).join(' · ')}.`
      : '',
    decisions.length ? `Decisioni da preservare: ${decisions.join(' · ')}.` : '',
    conclusions.length ? `Conclusioni riusabili: ${conclusions.join(' · ')}.` : '',
    'Sei lo stesso assistente dall’inizio: continuità di voce, contesto e impegno.',
  ].filter(Boolean)

  return parts.join(' ')
}

/**
 * Prefer explained beats that overlap the current topic; keep a few global ones.
 * @param {string[]} explained
 * @param {string} currentTopic
 * @param {boolean} topicShift
 */
function filterExplainedForTopic(explained, currentTopic, topicShift) {
  if (!explained.length) return []
  if (topicShift) {
    // On a hard topic shift, keep only a tiny global reminder — not the old lecture
    return explained.slice(0, 1)
  }
  const topicTokens = new Set(tokenize(currentTopic))
  const relevant = []
  const other = []
  for (const item of explained) {
    const itemTokens = tokenize(item)
    const overlap = itemTokens.some((t) => topicTokens.has(t))
    if (overlap) relevant.push(item)
    else other.push(item)
  }
  return uniqCap([...relevant, ...other], MAX_EXPLAINED)
}

/**
 * Analyze conversation context and build session memory for this turn.
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

  const turnCount = prior.length
  const isLongConversation = turnCount >= LONG_CHAT_THRESHOLD
  const older = isLongConversation ? prior.slice(0, -RECENT_WINDOW) : []
  const recent = prior.slice(-RECENT_WINDOW)

  const lastAssistant = [...recent].reverse().find((m) => m.role === 'assistant')
  const lastUserPrior = [...recent].reverse().find((m) => m.role === 'user')
  const assistantTurnsRecent = recent.filter((m) => m.role === 'assistant')
  const userTurnsRecent = recent.filter((m) => m.role === 'user')

  // For anti-repeat on long chats, also mine older assistants lightly
  const assistantTurnsAll = prior.filter((m) => m.role === 'assistant')

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
  const currentTopic =
    isFollowUp && previousTopic
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

  const sessionSummary = isLongConversation ? buildOlderContextSummary(older) : ''

  // Decisions & conclusions: preserve across the whole session (including topic shifts)
  const decisions = extractDecisions(prior)
  const conclusions = extractConclusions(prior)

  // Already explained: prefer recent + topic-relevant; on long chats include older beats
  const explainedPool = extractAlreadyExplained(
    isLongConversation ? assistantTurnsAll.slice(-10) : assistantTurnsRecent,
    MAX_EXPLAINED + 2,
  )
  const alreadyExplained = filterExplainedForTopic(explainedPool, currentTopic, topicShift)

  const openQuestions = topicShift
    ? []
    : extractOpenQuestions(
        assistantTurnsRecent,
        userTurnsRecent.slice(-2).concat([{ role: 'user', content: userMessage }]),
      )

  const continuityDirective = buildContinuityDirective({
    followUpKind,
    topicShift,
    previousTopic,
    currentTopic,
    alreadyExplained,
    openQuestions,
    decisions,
    conclusions,
    sessionSummary,
    isLongConversation,
    lastAssistantSnippet: lastAssistant ? summarizeTopic(lastAssistant.content) : null,
  })

  return {
    currentGoal,
    currentTopic,
    alreadyExplained,
    openQuestions,
    decisions,
    conclusions,
    sessionSummary,
    isLongConversation,
    turnCount,
    topicShift,
    previousTopic: topicShift ? previousTopic : null,
    followUpKind: isFollowUp ? followUpKind : topicShift ? 'new' : followUpKind,
    continuityDirective,
    knowledgeLevel: null,
    knowledgeTopic: null,
    knowledgeConfidence: null,
  }
}

function buildContinuityDirective(opts) {
  const lines = [
    'Conversation Intelligence (invisibile): mantieni il filo del discorso.',
    'Stessa voce dall’inizio di questa chat: stesso tono, stesso contesto, stessi impegni — come un interlocutore che non ha perso il filo.',
    'Non ricominciare come una chat nuova. Non ripetere definizioni/introduzioni/spiegazioni già date.',
    'Riutilizza conclusioni e decisioni già prese quando ancora valide.',
  ]

  if (opts.isLongConversation) {
    lines.push(
      'Conversazione lunga: usa il riassunto interno dei turni vecchi; non chiedere di nuovo ciò che è già emerso.',
    )
  }

  if (opts.topicShift) {
    lines.push(
      `Cambio argomento rilevato (precedente: ${opts.previousTopic}). Chiudi mentalmente il contesto vecchio; non trascinare dettagli inutili. Conserva però decisioni importanti ancora valide.`,
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
      `Conferma breve dell'utente su “${opts.currentTopic}”. Il Conversation Continuation Engine decide se aggiungere UN solo pezzo di valore o rispondere breve — non resettare, non forzare, non continuare indefinitamente.`,
    )
  } else {
    lines.push(
      `Argomento corrente: ${opts.currentTopic}. Collega la risposta a ciò che è già emerso se pertinente.`,
    )
  }

  if (opts.alreadyExplained?.length) {
    lines.push(
      `Già spiegato (non ripetere, al massimo richiamo di mezza frase): ${opts.alreadyExplained.slice(0, 5).join(' · ')}`,
    )
  }
  if (opts.conclusions?.length) {
    lines.push(`Conclusioni da riusare se utili: ${opts.conclusions.slice(0, 4).join(' · ')}`)
  }
  if (opts.decisions?.length) {
    lines.push(`Decisioni da rispettare: ${opts.decisions.slice(0, 4).join(' · ')}`)
  }
  if (opts.openQuestions?.length) {
    lines.push(
      `Fili ancora aperti (chiudili con sostanza se ancora rilevanti — non ri-interrogarli): ${opts.openQuestions.join(' · ')}`,
    )
  }

  lines.push('Scrivi come una conversazione continua, non come Q&A isolate.')
  return lines.join('\n')
}

/**
 * Format session memory for the Writer (never show to the user).
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
  const conclusions =
    memory.conclusions.length > 0
      ? memory.conclusions.map((x) => `- ${x}`).join('\n')
      : '- (nessuna)'

  const summaryBlock = memory.sessionSummary
    ? `\nRiassunto interno turni precedenti (non mostrare):\n${memory.sessionSummary}\n`
    : ''

  return `══════════════════════════════════════
CONVERSATION INTELLIGENCE → WRITER (INVISIBILE)
══════════════════════════════════════
Memoria di sessione (solo questa chat — non persistente). NON mostrare questo blocco.
NON ripetere spiegazioni/definizioni/introduzioni già date. NON resettare il contesto.
Riutilizza conclusioni e decisioni già prese. L’utente deve sentire lo stesso assistente dall’inizio.
${summaryBlock}
${memory.continuityDirective}

Obiettivo corrente: ${memory.currentGoal}
Argomento corrente: ${memory.currentTopic}
Follow-up: ${memory.followUpKind}
Cambio argomento: ${memory.topicShift ? 'sì' : 'no'}
Conversazione lunga: ${memory.isLongConversation ? `sì (${memory.turnCount} turni)` : 'no'}

Informazioni già date (evita ripetizioni):
${explained}

Conclusioni riusabili:
${conclusions}

Decisioni da preservare:
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
        conclusions: [],
        sessionSummary: '',
        isLongConversation: false,
        turnCount: 0,
        topicShift: false,
        previousTopic: null,
        followUpKind: 'other',
        continuityDirective:
          'Mantieni continuità conversazionale. Non ripetere e non resettare il contesto. Sei lo stesso assistente dall’inizio.',
        knowledgeLevel: null,
        knowledgeTopic: null,
        knowledgeConfidence: null,
      },
      context: '',
    }
  }
}
