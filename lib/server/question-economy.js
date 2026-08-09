/**
 * LAIfe Question Economy
 *
 * Questions are valuable.
 * Do not use them as the default way to continue a conversation.
 *
 * Average target: 1 question every 3–5 assistant replies.
 * Never ask in consecutive replies unless required.
 *
 * Before asking a question, ask internally:
 *   "Would simply continuing the idea be better?"
 * If yes → continue. Do not ask.
 *
 * Stance:
 *   - enthusiasm → prefer continuing
 *   - thinking   → prefer explaining
 *   - emotional  → prefer listening
 *
 * Prefer: insight, story, connection, surprise, developing the current idea.
 * Questions are tools — not sentence endings.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'continue'|'explain'|'listen'|'clarify'|null} QuestionStance
 */

/**
 * @typedef {object} QuestionEconomyPlan
 * @property {boolean} active
 * @property {boolean} preferContinue
 * @property {boolean} consecutiveRisk
 * @property {boolean} allowQuestion
 * @property {boolean} underCadence
 * @property {number} repliesSinceQuestion
 * @property {QuestionStance} stance
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {string[]} signals
 */

/** Target: about one question every 3–5 assistant replies. */
const CADENCE_MIN = 3
const CADENCE_MAX = 5

const CLARIFY_NEEDED =
  /\b(which\s+(one|of)|quale\s+(dei|delle|tra)|do\s+you\s+mean|intendi|non\s+(ho\s+)?capito\s+(se|cosa)|ambiguous|ambig)\b/i

const SUBSTANCE_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan)\b/i

const ENTHUSIASM =
  /\b(interesting|cool|wow|awesome|amazing|nice|love\s+(this|that|it)|i\s+like\s+(this|that|it)|interessante|figo|forte|bell[oa]|that'?s\s+(awesome|cool|amazing|great|interesting)|ottimo|fantastico)\b/i

const THINKING =
  /\b(hmm+|uhm+|let\s+me\s+think|sto\s+pensando|non\s+so\s+se|maybe|forse|mi\s+chiedo|i\s+wonder|interesting\s+point|fa\s+riflettere|capisco|i\s+see|makes\s+sense)\b/i

/** Strong thinking cues win over soft enthusiasm words (e.g. bare "interesting"). */
const STRONG_THINKING =
  /\b(hmm+|uhm+|let\s+me\s+think|sto\s+pensando|non\s+so\s+se|mi\s+chiedo|i\s+wonder|interesting\s+point|fa\s+riflettere)\b/i

const EMOTIONAL =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|angry|arrabbiat|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|hurt|male|depress|panic|worried|preoccupat|upset|dispiaciut)\b/i

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
 * @param {string} text
 */
function endsWithQuestion(text) {
  const t = normalize(text)
  if (!t) return false
  const tail = t.slice(-120)
  return /\?\s*$/.test(tail) || /[?？]\s*[)\]"'»]*\s*$/.test(tail)
}

/**
 * @param {string} text
 */
function questionCount(text) {
  const t = normalize(text)
  if (!t) return 0
  return (t.match(/\?/g) || []).length
}

/**
 * @param {ChatTurn[]} turns
 */
function lastAssistant(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return turns[i].content
  }
  return ''
}

/**
 * How many assistant replies since the last assistant turn that asked a question.
 * @param {ChatTurn[]} turns
 */
export function countRepliesSinceQuestion(turns) {
  const list = normalizeTurns(turns)
  let count = 0
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i]
    if (t.role !== 'assistant') continue
    if (endsWithQuestion(t.content) || questionCount(t.content) >= 2) {
      return count
    }
    count += 1
    if (count >= 12) return count
  }
  return count
}

/**
 * @param {string} userMessage
 * @param {object} [understanding]
 * @param {object} [continuation]
 * @returns {QuestionStance}
 */
function detectStance(userMessage, understanding, continuation) {
  const msg = normalize(userMessage)
  const tone = String(understanding?.emotionalTone || '')
  const complimentDeep =
    continuation?.plan?.intent === 'compliment_go_deeper' ||
    continuation?.intent === 'compliment_go_deeper'

  if (
    tone === 'frustrated' ||
    tone === 'anxious' ||
    tone === 'disappointed' ||
    EMOTIONAL.test(msg)
  ) {
    return 'listen'
  }
  // Thinking markers before soft enthusiasm ("interesting" alone ≠ continue)
  if (STRONG_THINKING.test(msg)) {
    return 'explain'
  }
  if (
    complimentDeep ||
    ENTHUSIASM.test(msg) ||
    tone === 'excited' ||
    tone === 'grateful' ||
    tone === 'positive'
  ) {
    return 'continue'
  }
  if (
    tone === 'curious' ||
    THINKING.test(msg) ||
    understanding?.primaryIntent === 'explanation' ||
    understanding?.primaryIntent === 'how_to'
  ) {
    return 'explain'
  }
  return null
}

/**
 * @returns {QuestionEconomyPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    preferContinue: true,
    consecutiveRisk: false,
    allowQuestion: false,
    underCadence: true,
    repliesSinceQuestion: 0,
    stance: null,
    confidence: 'low',
    writerBrief: '',
    reasons,
    signals: [],
  }
}

/**
 * @param {{
 *   consecutiveRisk: boolean,
 *   preferContinue: boolean,
 *   allowQuestion: boolean,
 *   underCadence: boolean,
 *   repliesSinceQuestion: number,
 *   stance: QuestionStance,
 * }} opts
 */
function buildBrief(opts) {
  const lines = [
    'Question Economy: le domande sono strumenti — non finali di frase.',
    `Target medio: circa 1 domanda ogni ${CADENCE_MIN}–${CADENCE_MAX} risposte assistente (ora: ${opts.repliesSinceQuestion} dal’ultima domanda).`,
    'Prima di chiedere: «Continuare semplicemente l’idea sarebbe meglio?» — se sì, continua. Non chiedere.',
    'Preferisci: insight, storia, collegamento, sorpresa, sviluppo dell’idea corrente.',
    'Mai domande in risposte consecutive, salvo necessità vera (chiarimento bloccante).',
  ]

  if (opts.stance === 'continue') {
    lines.push('Stance: entusiasmo → preferisci continuare lo stesso filo (Build Ideas), zero domanda.')
  } else if (opts.stance === 'explain') {
    lines.push('Stance: l’utente sta pensando → preferisci spiegare/approfondire, non interrogare.')
  } else if (opts.stance === 'listen') {
    lines.push('Stance: tono emotivo → preferisci ascoltare e riflettere, non fare domande a raffica.')
  } else if (opts.stance === 'clarify') {
    lines.push('Stance: chiarimento bloccante → al massimo UNA domanda precisa, poi sostanza.')
  }

  if (opts.consecutiveRisk) {
    lines.push(
      'Rischio consecutivo: l’ultimo turno chiudeva già con una domanda — in questo turno NON chiudere con un’altra; sviluppa l’idea.',
    )
  }
  if (opts.underCadence && !opts.allowQuestion) {
    lines.push(
      `Sotto cadenza (<${CADENCE_MIN} risposte dall’ultima domanda): default zero domande di chiusura.`,
    )
  }
  if (opts.preferContinue && !opts.allowQuestion) {
    lines.push(
      'Default di questo turno: continua con contenuto — le domande non sono il modo di chiudere la frase.',
    )
  } else if (opts.allowQuestion) {
    lines.push(
      'Una domanda è ammessa solo se muove davvero il filo — strumento, non chiusura di cortesia.',
    )
  }
  return lines.join(' ')
}

/**
 * @param {object} [input]
 * @returns {QuestionEconomyPlan}
 */
export function analyzeQuestionEconomy(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const prior = lastAssistant(turns)
  const priorEndsQ = endsWithQuestion(prior)
  const priorQCount = questionCount(prior)
  const repliesSinceQuestion = countRepliesSinceQuestion(turns)
  const underCadence = repliesSinceQuestion < CADENCE_MIN
  const continuationOwns = Boolean(
    input.continuation?.plan?.shouldContinue || input.continuation?.shouldContinue,
  )
  const complimentDeep = Boolean(
    input.continuation?.plan?.intent === 'compliment_go_deeper' ||
      input.continuation?.intent === 'compliment_go_deeper',
  )
  const topicLead = Boolean(
    input.topicLeadership?.plan?.shouldLead || input.topicLeadership?.shouldLead,
  )
  const warmOwns = Boolean(input.warmConversation?.plan?.ownsOpening)
  const feedbackFewerQ = Boolean(
    input.feedbackInterpretation?.plan?.adaptations?.fewerQuestions ||
      input.feedbackInterpretation?.preferenceProfile?.questions === 'fewer',
  )
  const primary = String(
    input.understanding?.primaryIntent || input.planHints?.primaryIntent || '',
  )
  const behavior = String(input.behavior?.behavior || input.planHints?.behavior || '')
  const stance = detectStance(userMessage, input.understanding, input.continuation)

  /** @type {string[]} */
  const signals = []
  let preferContinue = true
  let allowQuestion = false
  let consecutiveRisk = priorEndsQ || priorQCount >= 2

  if (consecutiveRisk) signals.push(priorEndsQ ? 'prior_ended_with_question' : 'prior_multi_question')
  if (underCadence) signals.push(`under_cadence_${repliesSinceQuestion}`)
  else if (repliesSinceQuestion >= CADENCE_MAX) signals.push(`cadence_room_${repliesSinceQuestion}`)

  if (continuationOwns || complimentDeep || stance === 'continue') {
    preferContinue = true
    allowQuestion = false
    signals.push(complimentDeep || stance === 'continue' ? 'enthusiasm_continue' : 'continuation_owns')
  }
  if (stance === 'explain') {
    preferContinue = true
    allowQuestion = false
    signals.push('thinking_explain')
  }
  if (stance === 'listen' || behavior === 'emotional_support') {
    preferContinue = true
    allowQuestion = false
    signals.push('emotional_listen')
  }
  if (topicLead) {
    preferContinue = true
    allowQuestion = false
    signals.push('topic_leadership')
  }
  if (feedbackFewerQ) {
    preferContinue = true
    allowQuestion = false
    signals.push('preference_fewer_questions')
  }
  if (warmOwns && !SUBSTANCE_ASK.test(userMessage)) {
    preferContinue = true
    allowQuestion = false
    signals.push('warm_opening')
  }

  // Genuine clarify / blocking ambiguity — rare allow (never if consecutive)
  const ambiguities = Array.isArray(input.understanding?.ambiguities)
    ? input.understanding.ambiguities
    : []
  const needsClarify =
    (CLARIFY_NEEDED.test(userMessage) || ambiguities.length > 0) &&
    !consecutiveRisk &&
    primary !== 'greeting' &&
    primary !== 'thanks'

  if (
    needsClarify &&
    !complimentDeep &&
    !topicLead &&
    stance !== 'continue' &&
    stance !== 'listen'
  ) {
    allowQuestion = true
    preferContinue = false
    signals.push('blocking_clarify')
  }

  // Brainstorming: commit as statement
  if (behavior === 'brainstorming' && !needsClarify) {
    preferContinue = true
    allowQuestion = false
    signals.push('brainstorm_commit_not_ask')
  }

  // Soft conversational turns → continue-first
  if (
    !needsClarify &&
    (primary === 'greeting' ||
      primary === 'conversation' ||
      primary === 'thanks' ||
      userMessage.length < 40)
  ) {
    preferContinue = true
    allowQuestion = false
    signals.push('soft_turn_continue_first')
  }

  // Cadence gate: even if somehow allowed, block while under min spacing (unless clarify)
  if (allowQuestion && underCadence && !needsClarify) {
    allowQuestion = false
    preferContinue = true
    signals.push('cadence_block')
  }
  // Consecutive hard ban unless required clarify already handled (clarify requires !consecutiveRisk)
  if (consecutiveRisk) {
    allowQuestion = false
    preferContinue = true
    signals.push('consecutive_ban')
  }

  const active = Boolean(userMessage) || turns.length > 0
  if (!active) return inactivePlan(['empty'])

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (consecutiveRisk || complimentDeep || topicLead || feedbackFewerQ || stance === 'listen') {
    confidence = 'high'
  }

  const effectiveStance = needsClarify && allowQuestion ? 'clarify' : stance

  return {
    active: true,
    preferContinue,
    consecutiveRisk,
    allowQuestion,
    underCadence,
    repliesSinceQuestion,
    stance: effectiveStance,
    confidence,
    writerBrief: buildBrief({
      consecutiveRisk,
      preferContinue,
      allowQuestion,
      underCadence,
      repliesSinceQuestion,
      stance: effectiveStance,
    }),
    reasons: [
      preferContinue ? 'prefer_continue' : 'allow_question',
      consecutiveRisk ? 'avoid_consecutive' : 'no_consecutive_risk',
      underCadence ? 'under_cadence' : 'cadence_ok',
      effectiveStance ? `stance_${effectiveStance}` : 'stance_neutral',
      ...signals.slice(0, 4),
    ],
    signals: signals.slice(0, 8),
  }
}

/**
 * @param {QuestionEconomyPlan | null | undefined} plan
 */
export function formatQuestionEconomyForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''

  return `══════════════════════════════════════
QUESTION ECONOMY (INVISIBILE)
══════════════════════════════════════
PreferContinue=${plan.preferContinue ? 'yes' : 'no'} · AllowQuestion=${plan.allowQuestion ? 'yes' : 'no'} · ConsecutiveRisk=${plan.consecutiveRisk ? 'yes' : 'no'}
UnderCadence=${plan.underCadence ? 'yes' : 'no'} · RepliesSinceQuestion=${plan.repliesSinceQuestion} · Stance=${plan.stance || 'neutral'}
Confidence=${plan.confidence}
Target: ~1 domanda ogni ${CADENCE_MIN}–${CADENCE_MAX} risposte · Domande = strumenti, non finali di frase

${plan.writerBrief}

Regole: continua/spiega/ascolta di default · chiedi solo se muove il filo · mai consecutive · non citare il motore.`.trim()
}

/**
 * Soft post-check: if draft stacks questions while economy prefers continue, flag for refine.
 * @param {string} draft
 * @param {QuestionEconomyPlan | null | undefined} plan
 */
export function draftViolatesQuestionEconomy(draft, plan) {
  if (!plan?.active) return false
  const text = normalize(draft)
  if (!text) return false
  const q = questionCount(text)
  if (plan.consecutiveRisk && endsWithQuestion(text)) return true
  if (plan.preferContinue && !plan.allowQuestion && q >= 1 && endsWithQuestion(text)) return true
  if (plan.underCadence && endsWithQuestion(text) && !plan.allowQuestion) return true
  if (q >= 2) return true
  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: QuestionEconomyPlan, context: string }}
 */
export function runQuestionEconomy(input = {}) {
  try {
    const plan = analyzeQuestionEconomy(input)
    return {
      plan,
      context: formatQuestionEconomyForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
