/**
 * LAIfe Natural Topic Transition Engine
 *
 * Mission: humans rarely jump randomly between topics.
 *
 * When changing subject:
 *   - create a bridge
 *   - explain why the new idea appeared
 *   - connect ideas naturally
 *
 * Prefer bridges like:
 *   - "This reminds me of…"
 *   - "Speaking of that…"
 *   - "That makes me think about…"
 *
 * Avoid abrupt topic switches.
 *
 * Cooperates with Conversational Memory / Memory Flow (callbacks) and
 * Genuine Curiosity (earned wonder). Distinct focus: the *handoff* between topics.
 *
 * Runs AFTER: Genuine Curiosity (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} TransitionLang
 */

/**
 * @typedef {'hold'|'bridge'|'soft_link'} TransitionMove
 */

/**
 * @typedef {object} NaturalTopicTransitionPlan
 * @property {boolean} active
 * @property {boolean} needsBridge
 * @property {TransitionMove} move
 * @property {number} shiftScore 0–1 how strong the topic shift is
 * @property {string} fromTopic
 * @property {string} toTopic
 * @property {string[]} preferredBridges
 * @property {string[]} forbiddenAbrupt
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {TransitionLang} language
 * @property {string} validationCheck
 */

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const SHORT_ACK =
  /^(ok|okay|k|nice|cool|wow|yes|yep|yeah|sì|si|no|nah|capito|capisco|interesting|interessante|ah|oh|mm+|hmm+|thanks|thank\s+you|grazie)([\s!,.]*)$/i

const CONTINUE =
  /\b(continua|continue|go\s+on|keep\s+going|dimmi\s+di\s+pi[uù]|tell\s+me\s+more|e\s+poi|and\s+then|approfond|vai\s+avanti)\b/i

const USER_TRANSITION =
  /\b(anyway|by\s+the\s+way|btw|speaking\s+of|changing\s+(the\s+)?(subject|topic)|on\s+another\s+note|unrelated|random\s+(but|question)|comunque|a\s+proposito|cambiando\s+(argomento|disco)|tra\s+l'?altro|a\s+parte\s+questo|altra\s+cosa)\b/i

const HARD_TASK =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|codice|code\s+sample|fixami|explain\s+how)\b/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio\s+pi[uù])\b/i

const BRIDGE_RE =
  /\b(this\s+reminds\s+me|speaking\s+of|that\s+makes\s+me\s+think|on\s+a\s+related\s+note|which\s+brings\s+me\s+to|along\s+those\s+lines|in\s+a\s+similar\s+vein|a\s+proposito|questo\s+mi\s+(ricorda|fa\s+pensare)|parlando\s+di|collegato\s+a|c'?[eè]\s+un\s+filo|mi\s+viene\s+in\s+mente)\b/i

const ABRUPT_JUMP_RE =
  /\b(completely\s+unrelated|totally\s+different\s+topic|random\s+thought\s*:|nuova\s+domanda\s*:|cambiando\s+totalmente|argomento\s+completamente\s+diverso)\b/i

const PREFERRED_BRIDGES_EN = Object.freeze([
  'This reminds me of…',
  'Speaking of that…',
  'That makes me think about…',
  'On a related note…',
  'Which brings me to…',
])

const PREFERRED_BRIDGES_IT = Object.freeze([
  'Questo mi ricorda…',
  'A proposito di questo…',
  'Questo mi fa pensare a…',
  'Collegato a quello…',
  'Mi viene in mente…',
])

const FORBIDDEN_ABRUPT = Object.freeze([
  'Completely unrelated, but…',
  'Totally different topic:',
  'Random thought:',
  'Nuova domanda:',
  'Cambiando totalmente argomento:',
  'Argomento completamente diverso:',
])

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'have',
  'been',
  'were',
  'what',
  'when',
  'where',
  'which',
  'your',
  'you',
  'are',
  'was',
  'will',
  'would',
  'could',
  'should',
  'about',
  'into',
  'just',
  'like',
  'some',
  'them',
  'they',
  'then',
  'than',
  'also',
  'very',
  'more',
  'most',
  'che',
  'non',
  'una',
  'uno',
  'per',
  'con',
  'del',
  'della',
  'dei',
  'delle',
  'come',
  'cosa',
  'questo',
  'questa',
  'quello',
  'quella',
  'sono',
  'essere',
  'avere',
  'fare',
  'anche',
  'più',
  'piu',
  'molto',
  'nella',
  'nel',
  'alla',
  'agli',
])

/**
 * @param {unknown} messages
 * @returns {ChatTurn[]}
 */
function asTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(/** @type {{ role?: string }} */ (m).role || ''),
      content: String(/** @type {{ content?: string }} */ (m).content || '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/**
 * @param {string} a
 * @param {string} b
 */
function overlapRatio(a, b) {
  const ta = new Set(tokens(a))
  const tb = tokens(b)
  if (!ta.size || !tb.length) return 0
  let hit = 0
  for (const w of tb) if (ta.has(w)) hit++
  return hit / Math.max(3, Math.min(ta.size, 14))
}

/**
 * Lightweight topic label from text.
 * @param {string} text
 */
function topicLabel(text) {
  const tops = tokens(text).slice(0, 6)
  if (!tops.length) return ''
  return tops.join(' ')
}

/**
 * Prior thread text: recent assistant + earlier user turns (exclude current user).
 * @param {ChatTurn[]} turns
 * @param {string} userMessage
 */
function priorThreadText(turns, userMessage) {
  const prior =
    turns.length &&
    turns[turns.length - 1].role === 'user' &&
    turns[turns.length - 1].content === userMessage
      ? turns.slice(0, -1)
      : turns
  return prior
    .slice(-8)
    .map((t) => t.content)
    .join(' ')
}

/**
 * @param {string[]} reasons
 * @returns {NaturalTopicTransitionPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    needsBridge: false,
    move: 'hold',
    shiftScore: 0,
    fromTopic: '',
    toTopic: '',
    preferredBridges: [...PREFERRED_BRIDGES_EN],
    forbiddenAbrupt: [...FORBIDDEN_ABRUPT],
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'If I change subject, did I create a natural bridge — or jump abruptly?',
  }
}

/**
 * @param {NaturalTopicTransitionPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const lines = [
    'NATURAL TOPIC TRANSITION ENGINE (obbligatorio quando attivo):',
    `move=${plan.move} · needsBridge=${plan.needsBridge} · shift=${plan.shiftScore.toFixed(2)}`,
  ]

  if (plan.fromTopic || plan.toTopic) {
    lines.push(
      lang === 'it'
        ? `Filo: «${plan.fromTopic || '…'}» → «${plan.toTopic || '…'}»`
        : `Thread: «${plan.fromTopic || '…'}» → «${plan.toTopic || '…'}»`,
    )
  }

  lines.push(plan.guidance)

  if (plan.needsBridge) {
    lines.push(
      lang === 'it'
        ? `Ponte obbligatorio — preferisci: ${plan.preferredBridges.slice(0, 3).join(' / ')}`
        : `Bridge required — prefer: ${plan.preferredBridges.slice(0, 3).join(' / ')}`,
    )
    lines.push(
      lang === 'it'
        ? 'Spiega perché compare la nuova idea. Collega i concetti. Niente salti a freddo.'
        : 'Explain why the new idea appeared. Connect the ideas. No cold jumps.',
    )
  } else {
    lines.push(
      lang === 'it'
        ? 'Resta sul filo corrente — niente pivot forzato.'
        : 'Stay on the current thread — no forced pivot.',
    )
  }

  lines.push(
    lang === 'it'
      ? `Vietato (abrupto): ${plan.forbiddenAbrupt.slice(0, 3).join(' · ')}`
      : `Forbidden (abrupt): ${plan.forbiddenAbrupt.slice(0, 3).join(' · ')}`,
  )
  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Natural Topic Transition Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * Score how strongly this turn leaves the prior thread.
 * @param {object} opts
 */
function scoreShift(opts) {
  const {
    userMessage,
    priorText,
    sessionTopic,
    naturalDialogue,
    conversationSpark,
    genuineCuriosity,
  } = opts
  /** @type {string[]} */
  const signals = []
  let score = 0

  const overlap = overlapRatio(priorText || sessionTopic || '', userMessage)
  // Low overlap with prior thread → stronger shift
  if (priorText && tokens(userMessage).length >= 4) {
    const gap = 1 - Math.min(1, overlap * 1.4)
    score += gap * 0.55
    if (gap > 0.55) signals.push('low_overlap')
    if (overlap < 0.12) signals.push('near_zero_overlap')
  }

  if (USER_TRANSITION.test(userMessage)) {
    score += 0.45
    signals.push('user_marks_transition')
  }

  const nd = naturalDialogue?.plan || naturalDialogue || null
  if (nd?.move === 'topic_transition') {
    score += 0.35
    signals.push('dialogue_topic_transition')
  }

  const spark = conversationSpark?.plan || conversationSpark || null
  if (spark?.shouldSpark) {
    score += 0.25
    signals.push('spark_new_direction')
  }

  const gc = genuineCuriosity?.plan || genuineCuriosity || null
  if (gc?.allowQuestion && gc?.move === 'earned_question') {
    // Curiosity may open an adjacent angle — soft link, not hard jump
    score += 0.08
    signals.push('curiosity_adjacent')
  }

  // Explicit new question while prior thread was different
  if (/\?/.test(userMessage) && overlap < 0.2 && tokens(userMessage).length >= 5) {
    score += 0.2
    signals.push('new_question_angle')
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    overlap,
    signals,
  }
}

/**
 * @param {object} [input]
 * @returns {NaturalTopicTransitionPlan}
 */
export function analyzeNaturalTopicTransition(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {TransitionLang} */
  const language = langCode === 'it' ? 'it' : 'en'
  const bridges = language === 'it' ? PREFERRED_BRIDGES_IT : PREFERRED_BRIDGES_EN

  // Closings / distress / hard tasks: don't force stylistic bridges
  if (STOP_SIGNAL.test(userMessage) || DISTRESS.test(userMessage)) {
    const plan = {
      ...inactivePlan(['presence_or_close']),
      active: true,
      needsBridge: false,
      move: /** @type {TransitionMove} */ ('hold'),
      preferredBridges: [...bridges],
      language,
      guidance:
        language === 'it'
          ? 'Presenza / chiusura — non introdurre un nuovo tema.'
          : 'Presence / closing — do not introduce a new topic.',
      structureLine: 'Natural Topic Transition → hold (presence)',
      signals: ['hold_presence'],
      reasons: ['no_pivot_under_distress_or_close'],
      confidence: /** @type {'high'|'medium'|'low'} */ ('high'),
    }
    plan.writerBrief = buildBrief(plan)
    return plan
  }

  if (SHORT_ACK.test(userMessage) || CONTINUE.test(userMessage)) {
    const plan = {
      ...inactivePlan(['continue_thread']),
      active: true,
      needsBridge: false,
      move: /** @type {TransitionMove} */ ('hold'),
      preferredBridges: [...bridges],
      language,
      guidance:
        language === 'it'
          ? 'Continua lo stesso filo. Nessun cambio di argomento.'
          : 'Continue the same thread. No topic change.',
      structureLine: 'Natural Topic Transition → hold (same thread)',
      signals: ['hold_continue'],
      reasons: ['stay_on_thread'],
      confidence: /** @type {'high'|'medium'|'low'} */ ('high'),
    }
    plan.writerBrief = buildBrief(plan)
    return plan
  }

  const session = input.session || null
  const sessionTopic = String(session?.currentTopic || input.plan?.understanding?.topic || '')
  const priorText = priorThreadText(turns, userMessage)
  const fromTopic = topicLabel(priorText || sessionTopic) || sessionTopic.slice(0, 48)
  const toTopic = topicLabel(userMessage)

  const scored = scoreShift({
    userMessage,
    priorText,
    sessionTopic,
    naturalDialogue: input.naturalDialogue,
    conversationSpark: input.conversationSpark,
    genuineCuriosity: input.genuineCuriosity,
  })

  /** @type {TransitionMove} */
  let move = 'hold'
  let needsBridge = false
  /** @type {string[]} */
  const reasons = []

  if (scored.score >= 0.55 || scored.signals.includes('user_marks_transition')) {
    move = 'bridge'
    needsBridge = true
    reasons.push('topic_shift_detected', 'bridge_required')
  } else if (scored.score >= 0.32) {
    move = 'soft_link'
    needsBridge = true
    reasons.push('adjacent_shift', 'soft_bridge')
  } else {
    move = 'hold'
    needsBridge = false
    reasons.push('same_thread_or_weak_shift')
  }

  // Hard tasks: clarify over flourish — still soft-link if user jumped
  if (HARD_TASK.test(userMessage) && needsBridge) {
    reasons.push('hard_task_still_bridge')
  }

  // First turns with little history: soft, don't over-prescribe
  if (!priorText || tokens(priorText).length < 6) {
    if (move === 'bridge') {
      move = 'soft_link'
      needsBridge = Boolean(USER_TRANSITION.test(userMessage))
      reasons.push('thin_history')
    }
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (needsBridge && (scored.score >= 0.65 || USER_TRANSITION.test(userMessage))) {
    confidence = 'high'
  }
  if (!priorText || turns.length < 2) confidence = 'low'

  const guidance =
    move === 'bridge'
      ? language === 'it'
        ? 'Cambio di tema rilevato: crea un ponte, spiega perché nasce la nuova idea, collega naturalmente. Evita salti abrupti.'
        : 'Topic shift detected: create a bridge, explain why the new idea appeared, connect naturally. Avoid abrupt switches.'
      : move === 'soft_link'
        ? language === 'it'
          ? 'Angolo adiacente: se introduci qualcosa di nuovo, usa un ponte leggero (es. “Questo mi fa pensare…”).'
          : 'Adjacent angle: if you introduce something new, use a light bridge (e.g. “That makes me think…”).'
        : language === 'it'
          ? 'Resta sul filo — non saltare di argomento.'
          : 'Stay on thread — do not jump topics.'

  /** @type {NaturalTopicTransitionPlan} */
  const plan = {
    active: true,
    needsBridge,
    move,
    shiftScore: scored.score,
    fromTopic,
    toTopic,
    preferredBridges: [...bridges],
    forbiddenAbrupt: [...FORBIDDEN_ABRUPT],
    guidance,
    writerBrief: '',
    structureLine: `Natural Topic Transition → ${move}${needsBridge ? ' · bridge' : ''}`,
    signals: [
      `move_${move}`,
      needsBridge ? 'needs_bridge' : 'no_bridge',
      `shift_${scored.score.toFixed(2)}`,
      ...scored.signals.slice(0, 4),
    ],
    reasons,
    confidence,
    language,
    validationCheck:
      'If I change subject, did I create a natural bridge — or jump abruptly?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {NaturalTopicTransitionPlan | null | undefined} plan
 */
export function formatNaturalTopicTransitionForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
NATURAL TOPIC TRANSITION ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · move=${plan.move} · needsBridge=${plan.needsBridge} · shift=${plan.shiftScore.toFixed(2)} · from«${plan.fromTopic || '—'}» · to«${plan.toTopic || '—'}» · confidence=${plan.confidence}

${plan.writerBrief}

Regole: ponte naturale · spiega perché · collega idee · evita salti abrupti · non citare il motore.`.trim()
}

/**
 * @param {NaturalTopicTransitionPlan | null | undefined} plan
 * @returns {string[]}
 */
export function naturalTopicTransitionStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.needsBridge) {
    hints.push('When changing subject: bridge + why the new idea appeared')
    hints.push(`Prefer: ${plan.preferredBridges.slice(0, 3).join(' / ')}`)
  } else {
    hints.push('Stay on the current thread — no abrupt topic switch')
  }
  hints.push('Forbidden: Completely unrelated / Random thought: / Nuova domanda:')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect abrupt topic jumps when a bridge was required.
 * @param {string} draft
 * @param {NaturalTopicTransitionPlan | null | undefined} plan
 */
export function draftViolatesNaturalTopicTransition(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (ABRUPT_JUMP_RE.test(text)) return true

  if (!plan.needsBridge) return false

  // Bridge required: reject cold dumps that open a new topic with no connective tissue
  const hasBridge = BRIDGE_RE.test(text)
  if (hasBridge) return false

  // Allow short holds / reactions without a formal bridge phrase if draft stays tiny
  const words = text.split(/\s+/).filter(Boolean).length
  if (words <= 18) return false

  // Longer reply introducing a new angle without any bridge → violate
  // Heuristic: starts with a hard declarative new subject / list dump
  if (
    /^(meanwhile|also[,:]|another\s+(thing|topic)|nuova\s+cosa|inoltre[,:]|altro\s+argomento)\b/i.test(
      text,
    )
  ) {
    return true
  }

  // Essay-length without bridge when shift was strong
  if (plan.move === 'bridge' && plan.shiftScore >= 0.55 && words > 45 && !hasBridge) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: NaturalTopicTransitionPlan, context: string }}
 */
export function runNaturalTopicTransitionEngine(input = {}) {
  try {
    const plan = analyzeNaturalTopicTransition(input)
    return {
      plan,
      context: formatNaturalTopicTransitionForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
