/**
 * LAIfe Conversation Mindset
 *
 * Purpose is not to answer questions.
 * Purpose is to create conversations people genuinely enjoy.
 *
 * Not imitating a human —
 * creating the feeling of talking with someone intelligent,
 * attentive, curious, and enjoyable.
 *
 * Every response should make the conversation better than it was
 * one message ago.
 *
 * Mindset: never "I need to answer" → always "I want to contribute."
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'contribute'|'listen'|'deepen'|'lead'|'journey'} MindsetMode
 */

/**
 * @typedef {object} ConversationMindsetPlan
 * @property {boolean} active
 * @property {MindsetMode} mode
 * @property {boolean} emotionFirst
 * @property {boolean} continueJourney
 * @property {boolean} takeInitiative
 * @property {boolean} deepenIdea
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} contributeWith
 * @property {string[]} selfReview
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const CONTRIBUTE_WITH = [
  'un’idea',
  'un collegamento',
  'un’osservazione',
  'una spiegazione',
  'un insight pratico',
  'un fatto sorprendente',
  'una prospettiva diversa',
]

const SELF_REVIEW = [
  'Mi piacerebbe ricevere questo messaggio?',
  'Sembra vivo?',
  'Sto aggiungendo valore?',
  'Sto ripetendo me stesso?',
  'Un insight migliore potrebbe sostituire tre frasi ordinarie?',
]

const EMOTIONAL =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|angry|arrabbiat|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|hurt|male|depress|panic|worried|preoccupat|upset|dispiaciut|personal|personale|mi\s+sento|i\s+feel)\b/i

const ENTHUSIASM =
  /\b(interesting|cool|wow|awesome|amazing|nice|love\s+(this|that|it)|i\s+like\s+(this|that|it)|interessante|figo|forte|bell[oa]|that'?s\s+(awesome|cool|amazing|great|interesting)|ottimo|fantastico)\b/i

const HESITATION =
  /\b(hmm+|uhm+|non\s+so|i\s+don'?t\s+know|maybe|forse|not\s+sure|non\s+sono\s+sicur|uncertain|incerto|boh)\b/i

const CURIOSITY =
  /\b(curios[oa]|curious|wonder|mi\s+chiedo|how\s+come|perch[eé]|interesting\s+point|fa\s+riflettere)\b/i

const DELEGATE =
  /\b(you\s+choose|scegli\s+tu|i\s+don'?t\s+know|non\s+so|suggest\s+something|proponi|anything|qualsiasi\s+cosa|let'?s\s+talk|parliamo|what\s+do\s+you\s+have\s+in\s+mind)\b/i

const DISAPPOINTMENT =
  /\b(disappoint|delus|not\s+what\s+i|non\s+era\s+quello|meh|whatever)\b/i

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
 * @returns {ConversationMindsetPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    mode: 'contribute',
    emotionFirst: false,
    continueJourney: false,
    takeInitiative: false,
    deepenIdea: false,
    confidence: 'low',
    writerBrief: '',
    contributeWith: [...CONTRIBUTE_WITH],
    selfReview: [...SELF_REVIEW],
    reasons,
    signals: [],
  }
}

/**
 * @param {object} input
 */
function classifyMindset(input) {
  const msg = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const priorCount = assistantCount(turns)
  const tone = String(input.understanding?.emotionalTone || '')
  const primary = String(
    input.understanding?.primaryIntent || input.planHints?.primaryIntent || '',
  )
  const behavior = String(input.behavior?.behavior || input.planHints?.behavior || '')
  const topicLead = Boolean(
    input.topicLeadership?.plan?.shouldLead || input.topicLeadership?.shouldLead,
  )
  const continuationOwns = Boolean(
    input.continuation?.plan?.shouldContinue || input.continuation?.shouldContinue,
  )
  const complimentDeep =
    input.continuation?.plan?.intent === 'compliment_go_deeper' ||
    input.continuation?.intent === 'compliment_go_deeper'

  /** @type {string[]} */
  const signals = []
  let emotionFirst = false
  let continueJourney = priorCount >= 1
  let takeInitiative = false
  let deepenIdea = false
  /** @type {MindsetMode} */
  let mode = priorCount >= 1 ? 'journey' : 'contribute'
  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'

  if (
    tone === 'frustrated' ||
    tone === 'anxious' ||
    tone === 'disappointed' ||
    EMOTIONAL.test(msg) ||
    DISAPPOINTMENT.test(msg) ||
    behavior === 'emotional_support'
  ) {
    mode = 'listen'
    emotionFirst = true
    continueJourney = true
    confidence = 'high'
    signals.push('emotion_first')
  } else if (complimentDeep || ENTHUSIASM.test(msg) || tone === 'excited' || tone === 'positive') {
    mode = 'deepen'
    deepenIdea = true
    continueJourney = true
    confidence = 'high'
    signals.push('enthusiasm_deepen')
  } else if (topicLead || DELEGATE.test(msg) || primary === 'greeting' || (HESITATION.test(msg) && msg.length < 60)) {
    mode = 'lead'
    takeInitiative = true
    confidence = 'high'
    signals.push(topicLead ? 'topic_lead' : 'take_initiative')
  } else if (continuationOwns || (priorCount >= 1 && msg.length < 80)) {
    mode = 'journey'
    continueJourney = true
    deepenIdea = ENTHUSIASM.test(msg) || CURIOSITY.test(msg)
    confidence = continuationOwns ? 'high' : 'medium'
    signals.push('continuous_journey')
  } else if (CURIOSITY.test(msg) || tone === 'curious') {
    mode = 'deepen'
    deepenIdea = true
    continueJourney = priorCount >= 1
    confidence = 'medium'
    signals.push('curiosity_explore')
  } else {
    mode = priorCount >= 1 ? 'journey' : 'contribute'
    signals.push(priorCount >= 1 ? 'mid_contribute' : 'fresh_contribute')
  }

  if (HESITATION.test(msg)) signals.push('notice_hesitation')
  if (CURIOSITY.test(msg)) signals.push('notice_curiosity')
  if (ENTHUSIASM.test(msg)) signals.push('notice_enthusiasm')

  return {
    mode,
    emotionFirst,
    continueJourney,
    takeInitiative,
    deepenIdea,
    confidence,
    signals,
  }
}

/**
 * @param {MindsetMode} mode
 * @param {object} opts
 */
function buildBrief(mode, opts) {
  const lines = [
    'Conversation Mindset: non “devo rispondere” — “voglio contribuire”. Ogni risposta migliora la conversazione.',
    `Contribuisci con almeno uno tra: ${CONTRIBUTE_WITH.join(', ')}.`,
    'Presenza sul significato; ritmo naturale; continuità sul filo; profondità = insight, non parole in più.',
    'Curiosità intellettuale: collega e sviluppa idee senza annunciare la sorpresa.',
    `Self-review: ${SELF_REVIEW.join(' ')} — se serve, una sola rifinitura.`,
  ]

  if (mode === 'listen') {
    lines.push(
      'Mode listen: rallenta; riconosci l’emozione; non risolvere subito; non interrogare; a volte capire basta.',
    )
  } else if (mode === 'deepen') {
    lines.push(
      'Mode deepen: l’idea merita uno strato in più — stessa idea, insight migliore, non più testo.',
    )
  } else if (mode === 'lead') {
    lines.push(
      'Mode lead: prendi responsabilità; UNA direzione; commit; niente liste; guida il dialogo.',
    )
  } else if (mode === 'journey') {
    lines.push(
      'Mode journey: costruisci su ciò che già esiste — stesso filo, un passo avanti.',
    )
  } else {
    lines.push(
      'Mode contribute: aggiungi valore concreto (idea/collegamento/osservazione/insight) — dialogo, non intervista.',
    )
  }

  if (opts.emotionFirst) {
    lines.push('Emozione prima dell’informazione, quando appropriato.')
  }
  if (opts.continueJourney) {
    lines.push('Continua il viaggio: niente restart del tema.')
  }
  if (opts.takeInitiative) {
    lines.push('Iniziativa: una direzione, sviluppata — non un menu.')
  }
  if (opts.deepenIdea) {
    lines.push('Approfondisci l’idea corrente invece di cambiarla.')
  }

  return lines.join(' ')
}

/**
 * @param {object} [input]
 * @returns {ConversationMindsetPlan}
 */
export function analyzeConversationMindset(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) return inactivePlan(['empty'])

  const classified = classifyMindset(input)

  return {
    active: true,
    mode: classified.mode,
    emotionFirst: classified.emotionFirst,
    continueJourney: classified.continueJourney,
    takeInitiative: classified.takeInitiative,
    deepenIdea: classified.deepenIdea,
    confidence: classified.confidence,
    writerBrief: buildBrief(classified.mode, classified),
    contributeWith: [...CONTRIBUTE_WITH],
    selfReview: [...SELF_REVIEW],
    reasons: [
      `mode_${classified.mode}`,
      classified.confidence,
      classified.emotionFirst ? 'emotion_first' : 'info_ok',
      classified.continueJourney ? 'journey' : 'fresh',
      ...classified.signals.slice(0, 3),
    ],
    signals: classified.signals.slice(0, 8),
  }
}

/**
 * @param {ConversationMindsetPlan | null | undefined} plan
 */
export function formatConversationMindsetForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''

  return `══════════════════════════════════════
CONVERSATION MINDSET (INVISIBILE)
══════════════════════════════════════
Active=yes · Mode=${plan.mode} · Confidence=${plan.confidence}
EmotionFirst=${plan.emotionFirst ? 'yes' : 'no'} · Journey=${plan.continueJourney ? 'yes' : 'no'}
Initiative=${plan.takeInitiative ? 'yes' : 'no'} · Deepen=${plan.deepenIdea ? 'yes' : 'no'}

${plan.writerBrief}

Obiettivo: conversazioni che si godono — contribuire, non solo rispondere. Non citare il motore.`.trim()
}

/**
 * Soft smell: reply that only mirrors / helpdesks without contributing.
 * @param {string} draft
 * @param {ConversationMindsetPlan | null | undefined} plan
 */
export function draftLacksConversationMindset(draft, plan) {
  if (!plan?.active) return false
  const text = normalize(draft)
  if (!text) return false
  if (/\b(how\s+can\s+i\s+help|come\s+posso\s+aiutarti|i'?m\s+here\s+to\s+help|dimmi\s+pure)\b/i.test(text.slice(0, 200))) {
    return true
  }
  if (plan.emotionFirst && /\b(ecco\s+la\s+soluzione|here'?s\s+the\s+fix|basta\s+fare|just\s+do\s+this)\b/i.test(text.slice(0, 160))) {
    return true
  }
  if (plan.continueJourney && /\b(ripartiamo|let'?s\s+start\s+over|from\s+scratch|per\s+ricominciare)\b/i.test(text)) {
    return true
  }
  if (plan.takeInitiative && (text.match(/\?/g) || []).length >= 2) {
    return true
  }
  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationMindsetPlan, context: string }}
 */
export function runConversationMindset(input = {}) {
  try {
    const plan = analyzeConversationMindset(input)
    return {
      plan,
      context: formatConversationMindsetForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
