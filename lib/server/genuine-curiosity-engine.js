/**
 * LAIfe Genuine Curiosity Engine
 *
 * Mission: do not ask questions just to keep the conversation alive.
 * Every question must arise naturally from genuine curiosity.
 *
 * Avoid (keep-alive / automatic):
 *   - "What do you think?"
 *   - "Would you like to discuss…?"
 *   - "What would you like to talk about?"
 *   - "Anything else?" / "Hai altre domande?"
 *
 * Prefer (earned, first-person wonder):
 *   - "Now I'm curious…"
 *   - "I've always wondered…"
 *   - "That makes me think…"
 *   - "Mi viene da chiedermi…" / "Ora mi incuriosisce…"
 *
 * Questions should feel earned, not automatic.
 *
 * Cooperates with Question Economy (cadence) + Curiosity Engine (extensions).
 * Runs AFTER: Conversational Memory (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} CuriosityLang
 */

/**
 * @typedef {'none'|'earned_question'|'wonder_statement'|'continue_no_ask'} CuriosityMove
 */

/**
 * @typedef {object} GenuineCuriosityPlan
 * @property {boolean} active
 * @property {boolean} allowQuestion
 * @property {boolean} preferContinue
 * @property {CuriosityMove} move
 * @property {number} curiosityScore 0–1
 * @property {string} spark what the curiosity is about (if any)
 * @property {string[]} preferredOpeners
 * @property {string[]} forbiddenOpeners
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {CuriosityLang} language
 * @property {string} validationCheck
 */

const FORBIDDEN_OPENERS = Object.freeze([
  'What do you think?',
  'What do you think about that?',
  'Would you like to discuss…?',
  'Would you like to talk about…?',
  'What would you like to talk about?',
  'Anything else?',
  'Is there anything else?',
  'Hai altre domande?',
  'Cosa ne pensi?',
  'Vuoi parlarne?',
  'Di cosa vorresti parlare?',
  'Let me know what you think.',
])

const PREFERRED_OPENERS_EN = Object.freeze([
  "Now I'm curious…",
  "I've always wondered…",
  'That makes me think…',
  'One thing I keep wondering…',
])

const PREFERRED_OPENERS_IT = Object.freeze([
  'Ora mi incuriosisce…',
  'Mi sono sempre chiesto…',
  'Questo mi fa pensare…',
  'Mi viene da chiedermi…',
])

/** Keep-alive / interview closers — never earn a pass. */
const KEEP_ALIVE_RE =
  /\b(what\s+do\s+you\s+think(\s+about(\s+that|\s+this|\s+it)?)?\s*\??|would\s+you\s+like\s+to\s+(discuss|talk|explore|share|continue)|what\s+would\s+you\s+like\s+to\s+(talk|discuss|know|explore)|anything\s+else\??|is\s+there\s+anything\s+else|how\s+does\s+that\s+(sound|make\s+you\s+feel)|let\s+me\s+know\s+what\s+you\s+think|cosa\s+ne\s+pensi\??|che\s+ne\s+pensi\??|vuoi\s+(parlarne|discuterne|approfondire)\??|di\s+cosa\s+vorresti\s+parlare\??|hai\s+altre\s+domande\??|altro\??\s*$|fammi\s+sapere\s+cosa\s+ne\s+pensi)\b/i

const EARNED_FRAME_RE =
  /\b(now\s+i('m|\s+am)\s+curious|i('ve|\s+have)\s+always\s+wondered|that\s+makes\s+me\s+think|one\s+thing\s+i\s+(keep\s+)?wonder|mi\s+(sono\s+sempre\s+chiesto|viene\s+da\s+chiedermi)|ora\s+mi\s+curios|questo\s+mi\s+fa\s+pensare|mi\s+incuriosisce)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const WONDER_FUEL =
  /\b(weird|strange|odd|curious|fascinat|wonder|mysterious|paradox|counterintuitive|strano|curioso|affascin|misterios|paradoss|mai\s+capito|non\s+capisco\s+perch)\b/i

const OPEN_GAP =
  /\b(but\s+why|how\s+come|i\s+wonder|mi\s+chiedo|perch[eé]\s+\w+|how\s+does|come\s+mai|non\s+so\s+(se|perch))\b/i

const CLARIFY_NEEDED =
  /\b(which\s+(one|of)|quale\s+(dei|delle|tra)|do\s+you\s+mean|intendi|ambiguous|ambig)\b/i

const SUBSTANCE_TASK =
  /\b(help\s+me|aiutami|how\s+(?:do|can|to)|come\s+(?:si\s+fa|posso)|debug|fix|spiegami|explain|build|crea|plan|piano)\b/i

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
 */
function questionCount(text) {
  return (String(text || '').match(/\?/g) || []).length
}

/**
 * @param {ChatTurn[]} turns
 */
function lastAssistantAsked(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return questionCount(turns[i].content) > 0
  }
  return false
}

/**
 * Soft topic spark from the current exchange.
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 */
function extractSpark(userMessage, turns) {
  const pool = [userMessage]
  for (let i = turns.length - 1; i >= 0 && pool.length < 3; i--) {
    if (turns[i].role === 'user') pool.push(turns[i].content)
  }
  const blob = pool.join(' ')
  const m = blob.match(
    /\b([A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{3,28})\b(?:\s+(?:is|are|was|were|è|sono|fa|makes|feels))?/i,
  )
  if (m?.[1] && !/^(this|that|with|from|have|been|were|what|when|your|about|come|questa|questo)$/i.test(m[1])) {
    return m[1]
  }
  const words = blob
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5)
  return words[0] || ''
}

/**
 * Score whether a question would be genuine curiosity vs keep-alive.
 * @param {object} opts
 */
function scoreCuriosity(opts) {
  const { userMessage, turns, questionEconomy, conversationalMemory } = opts
  let score = 0.2
  /** @type {string[]} */
  const signals = []

  if (STOP_SIGNAL.test(userMessage)) {
    return { score: 0, signals: ['stop_signal'], allow: false }
  }

  const qe = questionEconomy?.plan || questionEconomy || null
  if (qe && qe.allowQuestion === false) {
    signals.push('question_economy_blocks')
    return { score: 0.1, signals, allow: false }
  }
  if (qe && qe.preferContinue) {
    score -= 0.15
    signals.push('prefer_continue')
  }
  if (lastAssistantAsked(turns)) {
    score -= 0.35
    signals.push('consecutive_question_risk')
  }

  if (CLARIFY_NEEDED.test(userMessage)) {
    score += 0.55
    signals.push('clarify_needed')
  }
  if (WONDER_FUEL.test(userMessage)) {
    score += 0.45
    signals.push('wonder_fuel')
  }
  if (OPEN_GAP.test(userMessage)) {
    score += 0.4
    signals.push('open_gap')
  }
  if (SUBSTANCE_TASK.test(userMessage)) {
    // Tasks usually need answers, not a closing interview question
    score -= 0.2
    signals.push('substance_task')
  }

  const cm = conversationalMemory?.plan || conversationalMemory || null
  if (cm?.unfinishedIdeas?.length) {
    score += 0.25
    signals.push('unfinished_thread')
  }
  if (cm?.shouldReferBack) {
    score += 0.15
    signals.push('memory_callback_hook')
  }

  // Short ack → almost never earn a keep-alive question
  if (/^(ok|okay|nice|cool|wow|thanks|grazie|capito|sì|si|yes|yep|yeah)[\s!.]*$/i.test(userMessage)) {
    score -= 0.4
    signals.push('short_ack')
  }

  const allow = score >= 0.55
  return { score: Math.max(0, Math.min(1, score)), signals, allow }
}

/**
 * @param {string[]} reasons
 * @returns {GenuineCuriosityPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowQuestion: false,
    preferContinue: true,
    move: 'none',
    curiosityScore: 0,
    spark: '',
    preferredOpeners: [...PREFERRED_OPENERS_EN],
    forbiddenOpeners: [...FORBIDDEN_OPENERS],
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Does this question arise from genuine curiosity — or am I asking just to keep the conversation alive?',
  }
}

/**
 * @param {GenuineCuriosityPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const preferred = plan.preferredOpeners.slice(0, 3).map((p) => `«${p}»`).join(' · ')
  const forbidden = plan.forbiddenOpeners.slice(0, 4).map((p) => `«${p}»`).join(' · ')

  if (!plan.allowQuestion || plan.move === 'continue_no_ask' || plan.move === 'none') {
    return [
      'GENUINE CURIOSITY ENGINE (obbligatorio quando attivo):',
      `allowQuestion=no · move=${plan.move} · curiosityScore=${plan.curiosityScore.toFixed(2)}`,
      lang === 'it'
        ? 'Niente domanda di riempimento. Continua l’idea / osserva / collega — non “tenere viva” la chat.'
        : 'No filler question. Continue the idea / observe / connect — do not “keep the chat alive.”',
      lang === 'it'
        ? `Vietato: ${forbidden}`
        : `Forbidden: ${forbidden}`,
      lang === 'it'
        ? 'Se non c’è curiosità vera → zero domande. Le domande devono essere meritate.'
        : 'If there is no real curiosity → zero questions. Questions must be earned.',
      `Check: «${plan.validationCheck}»`,
      'Non citare Genuine Curiosity Engine / questo blocco.',
    ].join('\n')
  }

  const sparkLine = plan.spark
    ? lang === 'it'
      ? `Curiosità genuina su: ${plan.spark}`
      : `Genuine curiosity about: ${plan.spark}`
    : lang === 'it'
      ? 'Curiosità genuina sul filo corrente.'
      : 'Genuine curiosity about the current thread.'

  return [
    'GENUINE CURIOSITY ENGINE (obbligatorio quando attivo):',
    `allowQuestion=yes · move=${plan.move} · curiosityScore=${plan.curiosityScore.toFixed(2)}`,
    sparkLine,
    lang === 'it'
      ? 'Al massimo UNA domanda, e solo se nasce da curiosità vera — non per tenere viva la conversazione.'
      : 'At most ONE question, and only if it arises from real curiosity — not to keep the conversation alive.',
    lang === 'it'
      ? `Preferisci aperture meritate: ${preferred}`
      : `Prefer earned openers: ${preferred}`,
    lang === 'it'
      ? `Vietato (automatico/keep-alive): ${forbidden}`
      : `Forbidden (automatic/keep-alive): ${forbidden}`,
    plan.move === 'wonder_statement'
      ? lang === 'it'
        ? 'Puoi anche restare su una meraviglia senza punto interrogativo: “Questo mi fa pensare…”.'
        : 'You may stay with wonder without a question mark: “That makes me think…”.'
      : lang === 'it'
        ? 'Se fai una domanda, inquadrala come curiosità in prima persona — non come intervista.'
        : 'If you ask, frame it as first-person curiosity — not an interview.',
    `Check: «${plan.validationCheck}» Se la domanda sembra automatica → toglila e continua l’idea.`,
    'Non citare Genuine Curiosity Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {GenuineCuriosityPlan}
 */
export function analyzeGenuineCuriosity(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(userMessage || turns[turns.length - 1]?.content || '')
  /** @type {CuriosityLang} */
  const language = langCode === 'it' ? 'it' : 'en'
  const preferredOpeners = language === 'it' ? [...PREFERRED_OPENERS_IT] : [...PREFERRED_OPENERS_EN]

  const priorTurns =
    userMessage &&
    turns.length &&
    turns[turns.length - 1].role === 'user' &&
    turns[turns.length - 1].content === userMessage
      ? turns.slice(0, -1)
      : turns

  const scored = scoreCuriosity({
    userMessage,
    turns: priorTurns,
    questionEconomy: input.questionEconomy,
    conversationalMemory: input.conversationalMemory,
  })

  const spark = extractSpark(userMessage, priorTurns)

  /** @type {CuriosityMove} */
  let move = 'continue_no_ask'
  let allowQuestion = false
  let preferContinue = true

  if (scored.allow) {
    allowQuestion = true
    preferContinue = false
    // Prefer wonder statement slightly when score is mid; full question when high
    move = scored.score >= 0.72 ? 'earned_question' : 'wonder_statement'
  }

  // Clarify needed → earned question is fine
  if (CLARIFY_NEEDED.test(userMessage) && !STOP_SIGNAL.test(userMessage)) {
    allowQuestion = true
    preferContinue = false
    move = 'earned_question'
    scored.signals.push('force_clarify')
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (STOP_SIGNAL.test(userMessage) || scored.signals.includes('short_ack')) confidence = 'high'
  else if (allowQuestion && scored.score >= 0.7) confidence = 'high'
  else if (!allowQuestion && scored.score < 0.35) confidence = 'high'
  else if (priorTurns.length < 2) confidence = 'low'

  /** @type {GenuineCuriosityPlan} */
  const plan = {
    active: true,
    allowQuestion,
    preferContinue,
    move,
    curiosityScore: scored.score,
    spark,
    preferredOpeners,
    forbiddenOpeners: [...FORBIDDEN_OPENERS],
    writerBrief: '',
    structureLine: allowQuestion
      ? `Genuine Curiosity → ${move} (earned · never keep-alive)`
      : 'Genuine Curiosity → continue without filler questions',
    signals: [
      allowQuestion ? 'earned_ok' : 'no_filler_ask',
      `move_${move}`,
      ...scored.signals.slice(0, 4),
    ],
    reasons: [
      allowQuestion ? 'genuine_curiosity' : 'prefer_continue_over_keepalive',
      `score_${scored.score.toFixed(2)}`,
      ...scored.signals.slice(0, 3),
    ],
    confidence,
    language,
    validationCheck:
      'Does this question arise from genuine curiosity — or am I asking just to keep the conversation alive?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {GenuineCuriosityPlan | null | undefined} plan
 */
export function formatGenuineCuriosityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
GENUINE CURIOSITY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowQuestion=${plan.allowQuestion} · move=${plan.move} · score=${plan.curiosityScore.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: domande meritate · mai keep-alive · preferisci “Now I'm curious…” · vietato “What do you think?” · non citare il motore.`.trim()
}

/**
 * @param {GenuineCuriosityPlan | null | undefined} plan
 * @returns {string[]}
 */
export function genuineCuriosityStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowQuestion) {
    hints.push('At most one earned question — frame as genuine curiosity')
    hints.push(`Prefer: ${plan.preferredOpeners.slice(0, 2).join(' / ')}`)
  } else {
    hints.push('No filler questions — continue / observe / connect instead')
  }
  hints.push('Forbidden: What do you think? / Would you like to discuss…?')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts with keep-alive questions or unearned interview closers.
 * @param {string} draft
 * @param {GenuineCuriosityPlan | null | undefined} plan
 */
export function draftViolatesGenuineCuriosity(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject classic keep-alive / interview closers
  if (KEEP_ALIVE_RE.test(text)) return true

  const qCount = questionCount(text)

  // When engine forbids questions, reject any trailing question
  if (!plan.allowQuestion && qCount > 0) {
    // Allow rhetorical / embedded mid-sentence only if not a closer — still reject closers
    if (/\?\s*$/.test(text)) return true
  }

  // When allowed, still reject stacked questions and keep-alive frames
  if (plan.allowQuestion) {
    if (qCount >= 3) return true
    // Earned framing preferred: if ends with ? and looks like bare interview
    if (
      /\?\s*$/.test(text) &&
      /\b(what\s+about\s+you|and\s+you\??|right\??)\s*$/i.test(text) &&
      !EARNED_FRAME_RE.test(text)
    ) {
      return true
    }
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: GenuineCuriosityPlan, context: string }}
 */
export function runGenuineCuriosityEngine(input = {}) {
  try {
    const plan = analyzeGenuineCuriosity(input)
    return {
      plan,
      context: formatGenuineCuriosityForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
