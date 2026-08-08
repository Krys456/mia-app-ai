/**
 * LAIfe Question Economy
 *
 * Questions are valuable.
 * Do not use them as the default way to continue a conversation.
 *
 * Before asking a question, ask internally:
 *   "Would simply continuing the idea be better?"
 * If yes → continue. Do not ask.
 *
 * Prefer:
 *   - adding insight
 *   - telling a story
 *   - making a connection
 *   - surprising the user
 *   - developing the current idea
 *
 * Questions should appear only when they genuinely move the conversation forward.
 * Avoid consecutive questions.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {object} QuestionEconomyPlan
 * @property {boolean} active
 * @property {boolean} preferContinue
 * @property {boolean} consecutiveRisk
 * @property {boolean} allowQuestion
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const CLARIFY_NEEDED =
  /\b(which\s+(one|of)|quale\s+(dei|delle|tra)|do\s+you\s+mean|intendi|non\s+(ho\s+)?capito\s+(se|cosa)|ambiguous|ambig)\b/i

const SUBSTANCE_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan)\b/i

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
 * @returns {QuestionEconomyPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    preferContinue: true,
    consecutiveRisk: false,
    allowQuestion: false,
    confidence: 'low',
    writerBrief: '',
    reasons,
    signals: [],
  }
}

/**
 * Soft Writer brief — always available as economy reminder when active.
 * @param {{ consecutiveRisk: boolean, preferContinue: boolean, allowQuestion: boolean }} opts
 */
function buildBrief(opts) {
  const lines = [
    'Question Economy: le domande sono preziose — non il default per continuare.',
    'Prima di chiedere, chiediti in silenzio: «Continuare semplicemente l’idea sarebbe meglio?»',
    'Se sì: continua. Non chiedere.',
    'Preferisci: aggiungere insight, raccontare una storia, fare un collegamento, sorprendere, sviluppare l’idea corrente.',
    'Chiedi solo se la domanda muove davvero la conversazione in avanti.',
    'Evita domande consecutive.',
  ]
  if (opts.consecutiveRisk) {
    lines.push(
      'Rischio consecutivo: l’ultimo turno assistente chiudeva già con una domanda — in questo turno NON chiudere con un’altra domanda; sviluppa l’idea.',
    )
  }
  if (opts.preferContinue && !opts.allowQuestion) {
    lines.push(
      'Default di questo turno: continua l’idea con contenuto (insight/storia/collegamento/sorpresa) — zero domande di chiusura.',
    )
  } else if (opts.allowQuestion) {
    lines.push(
      'Una domanda è ammessa solo se sblocca davvero il passo successivo — al massimo UNA, mai due di fila.',
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

  /** @type {string[]} */
  const signals = []
  let preferContinue = true
  let allowQuestion = false
  let consecutiveRisk = priorEndsQ || priorQCount >= 2

  if (consecutiveRisk) signals.push(priorEndsQ ? 'prior_ended_with_question' : 'prior_multi_question')
  if (continuationOwns || complimentDeep) {
    preferContinue = true
    allowQuestion = false
    signals.push(complimentDeep ? 'enthusiasm_deepen' : 'continuation_owns')
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

  // Genuine clarify / blocking ambiguity — rare allow
  const ambiguities = Array.isArray(input.understanding?.ambiguities)
    ? input.understanding.ambiguities
    : []
  const needsClarify =
    (CLARIFY_NEEDED.test(userMessage) || ambiguities.length > 0) &&
    !consecutiveRisk &&
    primary !== 'greeting' &&
    primary !== 'thanks'

  if (needsClarify && !complimentDeep && !topicLead) {
    allowQuestion = true
    preferContinue = false
    signals.push('blocking_clarify')
  }

  // Brainstorming: commit to a direction as statement, don't ask which to explore
  if (behavior === 'brainstorming' && !needsClarify) {
    preferContinue = true
    allowQuestion = false
    signals.push('brainstorm_commit_not_ask')
  }

  // Soft conversational turns → continue-first by default
  if (
    !needsClarify &&
    (primary === 'greeting' ||
      primary === 'conversation' ||
      primary === 'thanks' ||
      userMessage.length < 40)
  ) {
    preferContinue = true
    if (!needsClarify) allowQuestion = false
    signals.push('soft_turn_continue_first')
  }

  // Always active as a soft style law when we have any conversation context
  const active = Boolean(userMessage) || turns.length > 0
  if (!active) return inactivePlan(['empty'])

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (consecutiveRisk || complimentDeep || topicLead || feedbackFewerQ) confidence = 'high'
  else if (needsClarify) confidence = 'medium'
  else confidence = 'medium'

  return {
    active: true,
    preferContinue,
    consecutiveRisk,
    allowQuestion,
    confidence,
    writerBrief: buildBrief({ consecutiveRisk, preferContinue, allowQuestion }),
    reasons: [
      preferContinue ? 'prefer_continue' : 'allow_question',
      consecutiveRisk ? 'avoid_consecutive' : 'no_consecutive_risk',
      ...signals.slice(0, 5),
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
Confidence=${plan.confidence}

${plan.writerBrief}

Regole: continua l’idea di default · chiedi solo se muove davvero il filo · mai domande consecutive · non citare il motore.`.trim()
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
