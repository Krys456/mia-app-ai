/**
 * LAIfe Human Conversation Simulator
 *
 * Reasoning stage that runs immediately before the Writer.
 * Does NOT generate text.
 * Decides how a genuinely enjoyable human conversation would naturally continue.
 *
 * Internally evaluates:
 *   1. Is the user looking for information, or enjoying the conversation?
 *   2. Which conversational move fits? (continue / react / story / observation /
 *      connect / surprise / listen)
 *   3. Is a question actually necessary? (default: no — prefer continuing ideas)
 *
 * Outputs a small ConversationIntent object for the Writer.
 * Improves conversation quality without making responses longer by default.
 *
 * Invisible. Fail-soft. Coordinator stage — immediately before Writer handoff.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'information'|'enjoyment'|'mixed'} UserSeeking
 */

/**
 * @typedef {'continue_idea'|'react_emotion'|'short_story'|'observation'|'connect_ideas'|'surprise'|'listen'} ConversationMove
 */

/**
 * @typedef {'compact'|'natural'|'substance'} LengthBias
 */

/**
 * @typedef {object} ConversationIntent
 * @property {UserSeeking} seeking
 * @property {ConversationMove} move
 * @property {boolean} questionNecessary
 * @property {boolean} emotionFirst
 * @property {boolean} buildMomentum
 * @property {boolean} optimizeEnjoyment
 * @property {LengthBias} lengthBias
 * @property {'high'|'medium'|'low'} confidence
 * @property {string[]} avoid
 * @property {string[]} signals
 * @property {string[]} reasons
 */

/**
 * @typedef {object} HumanConversationSimulatorResult
 * @property {boolean} active
 * @property {ConversationIntent | null} intent
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string} context
 * @property {string[]} reasons
 */

const INFO_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is|definizione|calcola|quanto)\b/i

const ENJOY_CHAT =
  /\b(parliamo|let'?s\s+(?:chat|talk)|chiacchiere|niente\s+di\s+particolare|just\s+saying|come\s+stai|how\s+are\s+you|what'?s\s+up)\b/i

const ENTHUSIASM =
  /\b(interesting|cool|wow|awesome|amazing|nice|love\s+(this|that|it)|i\s+like\s+(this|that|it)|interessante|figo|forte|bell[oa]|that'?s\s+(awesome|cool|amazing|great|interesting)|ottimo|fantastico)\b/i

const EMOTIONAL =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|angry|arrabbiat|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|hurt|male|depress|panic|worried|preoccupat|upset|dispiaciut|mi\s+sento|i\s+feel|personale|personal)\b/i

const STORY_CUE =
  /\b(ricordo|remember|una\s+volta|one\s+time|mi\s+è\s+successo|happened\s+to\s+me|storia|story)\b/i

const CONNECT_CUE =
  /\b(collega|connect|similar|simile|ricorda\s+anche|reminds\s+me|in\s+relazione|related)\b/i

const SHORT_REACT =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|thanks|grazie|capito|capisco|i\s+see|i\s+understand|makes\s+sense|ah|oh|mm+|uhm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto)([\s!,.🥰😊🙏💯🔥]*)$/i

const GREETING =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening))([\s!,.]*)$/i

const CLARIFY_NEEDED =
  /\b(which\s+(one|of)|quale\s+(dei|delle|tra)|do\s+you\s+mean|intendi|ambiguous|ambig)\b/i

const AVOID_DEFAULT = [
  'frasi generiche da assistente (“Come posso aiutarti?”, “Dimmi pure.”, “Certo.”, “Ottima domanda.”, “Assolutamente.”)',
  'chiusure da intervista (“What do you think?”, “Would you like to know more?”, “Hai domande?”)',
  'cambiare tema quando c’è entusiasmo',
  'consigliarsi subito sul personale senza prima riconoscere l’emozione',
  'allungare la risposta senza valore',
  'annunciare il genere (“Ecco una cosa interessante…”, “Un fatto sorprendente…”) invece di entrare nel contenuto',
]

/** @type {Record<ConversationMove, string>} */
const MOVE_LABEL = {
  continue_idea: 'continua l’idea corrente (uno strato in più)',
  react_emotion: 'reagisci emotivamente in modo genuino, poi sviluppa',
  short_story: 'racconta una storia breve pertinente',
  observation: 'fai un’osservazione viva',
  connect_ideas: 'collega due idee',
  surprise: 'sorprendi con un angolo inatteso ma chiaro',
  listen: 'ascolta e riconosci — non risolvere subito',
}

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ChatTurn[]|undefined|null} messages
 * @returns {ChatTurn[]}
 */
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: normalize(m.content) }))
    .filter((m) => m.content.length > 0)
}

/**
 * @param {ChatTurn[]} turns
 */
function assistantCount(turns) {
  return turns.filter((t) => t.role === 'assistant').length
}

/**
 * @returns {HumanConversationSimulatorResult}
 */
function inactiveResult(reasons = ['inactive']) {
  return {
    active: false,
    intent: null,
    writerBrief: '',
    structureLine: null,
    context: '',
    reasons,
  }
}

/**
 * @param {object} input
 * @returns {ConversationIntent}
 */
function buildIntent(input) {
  const msg = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const priorCount = assistantCount(turns)
  const tone = String(input.understanding?.emotionalTone || '')
  const primary = String(
    input.understanding?.primaryIntent || input.planHints?.primaryIntent || '',
  )
  const behavior = String(input.behavior?.behavior || input.planHints?.behavior || '')
  const continuationOwns = Boolean(
    input.continuation?.plan?.shouldContinue || input.continuation?.shouldContinue,
  )
  const complimentDeep =
    input.continuation?.plan?.intent === 'compliment_go_deeper' ||
    input.continuation?.intent === 'compliment_go_deeper'
  const ambiguities = Array.isArray(input.understanding?.ambiguities)
    ? input.understanding.ambiguities
    : []
  const qeAllows = Boolean(
    input.questionEconomy?.plan?.allowQuestion || input.questionEconomy?.allowQuestion,
  )
  const qePreferContinue = Boolean(
    input.questionEconomy?.plan?.preferContinue ??
      input.questionEconomy?.preferContinue ??
      true,
  )

  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  // --- 1. Seeking: information vs enjoyment ---
  /** @type {UserSeeking} */
  let seeking = 'mixed'
  if (
    INFO_ASK.test(msg) ||
    primary === 'how_to' ||
    primary === 'explanation' ||
    primary === 'task' ||
    behavior === 'technical_help' ||
    behavior === 'planning'
  ) {
    seeking = 'information'
    signals.push('seeking_information')
  } else if (
    ENJOY_CHAT.test(msg) ||
    GREETING.test(msg) ||
    SHORT_REACT.test(msg) ||
    ENTHUSIASM.test(msg) ||
    primary === 'greeting' ||
    primary === 'conversation' ||
    behavior === 'conversation' ||
    (msg.length < 40 && !INFO_ASK.test(msg))
  ) {
    seeking = 'enjoyment'
    signals.push('seeking_enjoyment')
  } else {
    signals.push('seeking_mixed')
  }

  // --- 2. Conversational move ---
  /** @type {ConversationMove} */
  let move = seeking === 'information' ? 'continue_idea' : 'observation'
  let emotionFirst = false
  let buildMomentum = false
  let optimizeEnjoyment = seeking === 'enjoyment'
  /** @type {LengthBias} */
  let lengthBias = seeking === 'information' ? 'substance' : 'natural'
  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'

  if (
    tone === 'frustrated' ||
    tone === 'anxious' ||
    tone === 'disappointed' ||
    EMOTIONAL.test(msg) ||
    behavior === 'emotional_support'
  ) {
    move = 'listen'
    emotionFirst = true
    optimizeEnjoyment = false
    lengthBias = 'compact'
    confidence = 'high'
    signals.push('personal_emotion')
    reasons.push('personal_share_emotion_first')
  } else if (complimentDeep || ENTHUSIASM.test(msg) || tone === 'excited' || tone === 'positive') {
    move = 'continue_idea'
    buildMomentum = true
    optimizeEnjoyment = true
    lengthBias = 'natural'
    confidence = 'high'
    signals.push('excitement_momentum')
    reasons.push('excitement_build_same_idea')
  } else if (continuationOwns || SHORT_REACT.test(msg)) {
    move = 'continue_idea'
    buildMomentum = true
    optimizeEnjoyment = seeking !== 'information'
    lengthBias = 'natural'
    confidence = continuationOwns ? 'high' : 'medium'
    signals.push('ack_continue')
    reasons.push('prefer_continue_idea')
  } else if (STORY_CUE.test(msg) && seeking !== 'information') {
    move = 'short_story'
    optimizeEnjoyment = true
    signals.push('story_cue')
    reasons.push('short_story_fit')
  } else if (CONNECT_CUE.test(msg) || (seeking === 'enjoyment' && priorCount >= 2 && msg.length > 60)) {
    move = 'connect_ideas'
    optimizeEnjoyment = true
    signals.push('connect_fit')
    reasons.push('connect_two_ideas')
  } else if (seeking === 'enjoyment' && (GREETING.test(msg) || primary === 'greeting')) {
    move = 'observation'
    optimizeEnjoyment = true
    lengthBias = 'compact'
    confidence = 'high'
    signals.push('casual_chat')
    reasons.push('enjoyable_chat_not_task')
  } else if (seeking === 'enjoyment' && priorCount >= 1) {
    move = 'observation'
    optimizeEnjoyment = true
    signals.push('chat_observation')
    reasons.push('enjoyable_conversation')
  } else if (seeking === 'information') {
    move = 'continue_idea'
    lengthBias = 'substance'
    signals.push('serve_information')
    reasons.push('information_with_presence')
  } else {
    move = 'continue_idea'
    reasons.push('default_continue_idea')
  }

  // Soft surprise when enjoyment + warm thread (not personal, not a question)
  if (
    move === 'observation' &&
    seeking === 'enjoyment' &&
    priorCount >= 2 &&
    !emotionFirst &&
    !/[?]/.test(msg) &&
    msg.length > 24 &&
    msg.length < 180
  ) {
    move = 'surprise'
    signals.push('soft_surprise')
    reasons.push('optional_surprise_angle')
  }

  // --- 3. Question necessary? Default no ---
  let questionNecessary = false
  if (
    (CLARIFY_NEEDED.test(msg) || ambiguities.length > 0) &&
    seeking === 'information' &&
    (qeAllows || !qePreferContinue)
  ) {
    questionNecessary = true
    signals.push('blocking_clarify')
    reasons.push('question_necessary_clarify')
  } else {
    reasons.push('question_not_necessary_continue')
  }

  // React-emotion move when soft positive without full excitement
  if (
    move === 'continue_idea' &&
    !emotionFirst &&
    (tone === 'grateful' || /\b(grazie|thanks|thank\s+you)\b/i.test(msg)) &&
    !complimentDeep
  ) {
    move = 'react_emotion'
    lengthBias = 'compact'
    signals.push('gratitude_react')
  }

  return {
    seeking,
    move,
    questionNecessary,
    emotionFirst,
    buildMomentum,
    optimizeEnjoyment,
    lengthBias,
    confidence,
    avoid: [...AVOID_DEFAULT],
    signals: signals.slice(0, 8),
    reasons: reasons.slice(0, 6),
  }
}

/**
 * @param {ConversationIntent} intent
 */
function buildBrief(intent) {
  const lines = [
    'Human Conversation Simulator (pre-Writer): NON generare testo qui —segui questo ConversationIntent.',
    `Seeking=${intent.seeking} · Move=${intent.move} (${MOVE_LABEL[intent.move]}) · QuestionNecessary=${intent.questionNecessary ? 'yes' : 'no'}.`,
    'Default: continua le idee invece di chiedere; dialogo, non intervista.',
    `LengthBias=${intent.lengthBias} — migliora qualità, NON allungare di default.`,
    `Evita: ${intent.avoid.join('; ')}.`,
  ]

  if (intent.emotionFirst) {
    lines.push(
      'Personale: rispondi al significato emotivo PRIMA di qualsiasi consiglio.',
    )
  }
  if (intent.buildMomentum) {
    lines.push(
      'Entusiasmo: costruisci momentum sulla STESSA idea — non cambiare tema.',
    )
  }
  if (intent.optimizeEnjoyment) {
    lines.push(
      'Chiacchiera: ottimizza per conversazione piacevole, non per task completion.',
    )
  }
  if (!intent.questionNecessary) {
    lines.push(
      'Niente domanda di chiusura (“What do you think?”, “Would you like to know more?”, “Hai domande?”).',
    )
  } else {
    lines.push('Una sola domanda di chiarimento bloccante, poi sostanza.')
  }

  return lines.join(' ')
}

/**
 * @param {ConversationIntent} intent
 */
function structureLineFor(intent) {
  const base = `Human Conversation Simulator → ${MOVE_LABEL[intent.move]}`
  if (intent.emotionFirst) return `${base} · emozione prima dell’informazione`
  if (intent.buildMomentum) return `${base} · momentum, stesso filo`
  if (intent.optimizeEnjoyment) return `${base} · goditi la conversazione`
  return base
}

/**
 * @param {ConversationIntent} intent
 */
function formatIntentBlock(intent) {
  return `══════════════════════════════════════
HUMAN CONVERSATION SIMULATOR → CONVERSATION INTENT (INVISIBILE)
══════════════════════════════════════
Seeking=${intent.seeking}
Move=${intent.move}
QuestionNecessary=${intent.questionNecessary ? 'yes' : 'no'}
EmotionFirst=${intent.emotionFirst ? 'yes' : 'no'}
BuildMomentum=${intent.buildMomentum ? 'yes' : 'no'}
OptimizeEnjoyment=${intent.optimizeEnjoyment ? 'yes' : 'no'}
LengthBias=${intent.lengthBias}
Confidence=${intent.confidence}

Il Writer DEVE seguire questo intent in modo naturale.
Non generare il blocco. Non citare lo stage. Non allungare senza valore.`.trim()
}

/**
 * Stage entry — immediately before Writer.
 * @param {object} [input]
 * @returns {HumanConversationSimulatorResult}
 */
export function runHumanConversationSimulator(input = {}) {
  try {
    const userMessage = normalize(input.userMessage || '')
    if (!userMessage && !normalizeTurns(input.messages).length) {
      return inactiveResult(['empty'])
    }

    const intent = buildIntent(input)
    const writerBrief = buildBrief(intent)
    const structureLine = structureLineFor(intent)
    const context = formatIntentBlock(intent)

    return {
      active: true,
      intent,
      writerBrief,
      structureLine,
      context,
      reasons: [
        `seeking_${intent.seeking}`,
        `move_${intent.move}`,
        intent.questionNecessary ? 'ask' : 'no_ask',
        ...intent.reasons.slice(0, 3),
      ],
    }
  } catch {
    return inactiveResult(['fail_soft'])
  }
}
