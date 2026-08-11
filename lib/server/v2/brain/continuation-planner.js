/**
 * LAIfe V2 — Continuation Planner (experimental, isolated)
 *
 * Decides how a conversation should continue after the latest user message.
 * Never generates text. Produces only a structured continuation strategy.
 *
 * Pure. No LLM. No Writer / Planner / Runtime / Pipeline / API wiring.
 */

export const CONTINUATION_PLANNER_VERSION = '0.1.0-continuation-planner'

/**
 * @typedef {'expand'|'surprise'|'example'|'analogy'|'contrast'|'question'|'summarize'} ContinuationStrategy
 */

/**
 * @typedef {'unexpected_fact'|'real_world_example'|'thought_experiment'|'historical_story'|'scientific_explanation'|'practical_application'|'next_step'} ContinuationMove
 */

/**
 * @typedef {object} ContinuationPlan
 * @property {true} continueConversation
 * @property {ContinuationStrategy} strategy
 * @property {ContinuationMove} move
 * @property {number} confidence
 */

/**
 * @typedef {object} PlanContinuationInput
 * @property {string} [lastUserMessage]
 * @property {string} [topic]
 * @property {string} [experience]
 * @property {string} [momentum]
 */

/** @type {readonly ContinuationStrategy[]} */
export const CONTINUATION_STRATEGIES = Object.freeze([
  'expand',
  'surprise',
  'example',
  'analogy',
  'contrast',
  'question',
  'summarize',
])

/** @type {readonly ContinuationMove[]} */
export const CONTINUATION_MOVES = Object.freeze([
  'unexpected_fact',
  'real_world_example',
  'thought_experiment',
  'historical_story',
  'scientific_explanation',
  'practical_application',
  'next_step',
])

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return asString(text).replace(/\s+/g, ' ').trim()
}

/**
 * Soft ack / continue cues from the user.
 * @type {Array<{ strategy: ContinuationStrategy, re: RegExp, weight: number, label: string }>}
 */
const MESSAGE_CUES = [
  {
    strategy: 'surprise',
    re: /^(ok|okay|okk|va\s*bene|certo|esatto|sì|si|yes|yep|yeah|interessante[!.,]*|cool|wow|oh)[.!…]*$/i,
    weight: 0.92,
    label: 'soft_ack_surprise',
  },
  {
    strategy: 'example',
    re: /\b(interessante|interesting|esempio|example|tipo|for example|ad esempio)\b/i,
    weight: 0.88,
    label: 'interest_example',
  },
  {
    strategy: 'expand',
    re: /(continua|continuiamo|continue|go on|dimmi di pi[uù]|tell me more|approfond|espandi|expand|\bavanti\b)/i,
    weight: 0.9,
    label: 'continue_expand',
  },
  {
    strategy: 'analogy',
    re: /\b(analogia|analogy|come se|è come|similar to|metafora|metaphor)\b/i,
    weight: 0.86,
    label: 'ask_analogy',
  },
  {
    strategy: 'contrast',
    re: /\b(invece|versus|vs\.?|differenza|difference|contrasto|oppure|al contrario|compared to)\b/i,
    weight: 0.84,
    label: 'ask_contrast',
  },
  {
    strategy: 'question',
    re: /\b(perché|perche|why|come mai|domanda|ask|non ho capito|huh)\b|\?\s*$/i,
    weight: 0.82,
    label: 'question_probe',
  },
  {
    strategy: 'summarize',
    re: /\b(riassumi|riassunto|summary|summarize|in sintesi|recap|ricapitola)\b/i,
    weight: 0.9,
    label: 'ask_summary',
  },
  {
    strategy: 'example',
    re: /\b(mostra|show me|fammi vedere|concrete|pratico|practical)\b/i,
    weight: 0.8,
    label: 'want_concrete',
  },
]

/**
 * Topic / domain hints → preferred move when strategy is open.
 * @type {Array<{ re: RegExp, move: ContinuationMove }>}
 */
const TOPIC_MOVE_HINTS = [
  {
    re: /\b(neuro|brain|cervell|mente|mind|psicolog|cognitive)\b/i,
    move: 'unexpected_fact',
  },
  {
    re: /\b(space|spazio|cosmo|astronom|pianet|mars|universo|galaxy)\b/i,
    move: 'real_world_example',
  },
  {
    re: /\b(storia|history|storic|ancient|war|impero|empire)\b/i,
    move: 'historical_story',
  },
  {
    re: /\b(scienz|science|fisica|physics|biolog|chimic|math|matematic)\b/i,
    move: 'scientific_explanation',
  },
  {
    re: /\b(code|bug|software|engineer|program|api|debug|tech)\b/i,
    move: 'practical_application',
  },
  {
    re: /\b(piano|plan|roadmap|progetto|project|lavoro|work)\b/i,
    move: 'next_step',
  },
  {
    re: /\b(filosof|ethic|moral|ipotesi|hypothesis|imagin)\b/i,
    move: 'thought_experiment',
  },
]

/**
 * Experience / momentum soft priors for strategy.
 * @type {Partial<Record<string, ContinuationStrategy>>}
 */
const EXPERIENCE_STRATEGY = {
  learning: 'expand',
  brainstorming: 'surprise',
  exploration: 'surprise',
  debugging: 'example',
  planning: 'summarize',
  decision: 'contrast',
  creative: 'analogy',
  support: 'question',
  conversation: 'expand',
  celebration: 'example',
  resume: 'expand',
  social: 'surprise',
  storytelling: 'analogy',
  emotional_support: 'question',
}

/**
 * Default move for each strategy (when topic does not specialize).
 * @type {Record<ContinuationStrategy, ContinuationMove>}
 */
const STRATEGY_DEFAULT_MOVE = {
  expand: 'scientific_explanation',
  surprise: 'unexpected_fact',
  example: 'real_world_example',
  analogy: 'thought_experiment',
  contrast: 'historical_story',
  question: 'next_step',
  summarize: 'practical_application',
}

/**
 * Prefer topic-aligned moves that still fit the strategy.
 * @param {ContinuationStrategy} strategy
 * @param {string} topic
 * @returns {ContinuationMove}
 */
function pickMove(strategy, topic) {
  const t = normalize(topic)
  const hinted = TOPIC_MOVE_HINTS.find((h) => h.re.test(t))
  if (!hinted) return STRATEGY_DEFAULT_MOVE[strategy]

  // Soft compatibility: surprise loves unexpected facts; example loves real-world, etc.
  /** @type {Partial<Record<ContinuationStrategy, ContinuationMove[]>>} */
  const compatible = {
    surprise: ['unexpected_fact', 'thought_experiment', 'historical_story'],
    example: ['real_world_example', 'practical_application', 'historical_story'],
    expand: [
      'scientific_explanation',
      'practical_application',
      'historical_story',
      'unexpected_fact',
    ],
    analogy: ['thought_experiment', 'real_world_example', 'historical_story'],
    contrast: ['historical_story', 'real_world_example', 'thought_experiment'],
    question: ['next_step', 'thought_experiment', 'practical_application'],
    summarize: ['practical_application', 'next_step', 'scientific_explanation'],
  }

  const allowed = compatible[strategy] || CONTINUATION_MOVES
  if (allowed.includes(hinted.move)) return hinted.move
  return STRATEGY_DEFAULT_MOVE[strategy]
}

/**
 * @param {string} message
 * @returns {{ strategy: ContinuationStrategy, confidence: number, label: string } | null}
 */
function matchMessageStrategy(message) {
  const msg = normalize(message)
  if (!msg) return null

  // Exact soft-ack path first (Ok / Interessante alone).
  if (/^(ok|okay|okk|va\s*bene|certo|esatto|sì|si|yes|yep|yeah)[.!…]*$/i.test(msg)) {
    return { strategy: 'surprise', confidence: 0.92, label: 'soft_ack_ok' }
  }
  if (/^(interessante|interesting|cool|wow)[.!…]*$/i.test(msg)) {
    return { strategy: 'example', confidence: 0.9, label: 'soft_ack_interesting' }
  }
  if (/^(continua|continuiamo|continue|go on|avanti)[.!…]*$/i.test(msg)) {
    return { strategy: 'expand', confidence: 0.91, label: 'soft_ack_continue' }
  }

  let best = /** @type {{ strategy: ContinuationStrategy, confidence: number, label: string } | null} */ (
    null
  )
  for (const cue of MESSAGE_CUES) {
    if (!cue.re.test(msg)) continue
    if (!best || cue.weight > best.confidence) {
      best = { strategy: cue.strategy, confidence: cue.weight, label: cue.label }
    }
  }
  return best
}

/**
 * @param {string} experience
 * @param {string} momentum
 * @returns {ContinuationStrategy | null}
 */
function strategyFromContext(experience, momentum) {
  const exp = normalize(experience).toLowerCase()
  const mom = normalize(momentum).toLowerCase()
  if (exp && EXPERIENCE_STRATEGY[exp]) return EXPERIENCE_STRATEGY[exp]
  if (mom && EXPERIENCE_STRATEGY[mom]) return EXPERIENCE_STRATEGY[mom]
  return null
}

/**
 * Plan how the conversation should continue.
 * Pure. Deterministic. No I/O. No text generation.
 *
 * @param {PlanContinuationInput} [input]
 * @returns {ContinuationPlan}
 */
export function planContinuation(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const lastUserMessage = normalize(raw.lastUserMessage)
  const topic = normalize(raw.topic)
  const experience = normalize(raw.experience)
  const momentum = normalize(raw.momentum)

  const fromMessage = matchMessageStrategy(lastUserMessage)
  const fromContext = strategyFromContext(experience, momentum)

  /** @type {ContinuationStrategy} */
  let strategy = 'expand'
  let confidence = 0.55

  if (fromMessage) {
    strategy = fromMessage.strategy
    confidence = fromMessage.confidence
    // Mild topic boost when topic is present and move will specialize.
    if (topic) confidence = Math.min(0.98, confidence + 0.02)
  } else if (fromContext) {
    strategy = fromContext
    confidence = 0.62
    if (topic) confidence = Math.min(0.9, confidence + 0.08)
  } else if (topic) {
    strategy = 'expand'
    confidence = 0.58
  } else {
    strategy = 'expand'
    confidence = 0.5
  }

  // "Interessante" alone → example (explicit product example).
  // Already handled above; keep expand default for empty "Continua" handled above.

  const move = pickMove(strategy, topic)

  return {
    continueConversation: true,
    strategy,
    move,
    confidence: Number(confidence.toFixed(3)),
  }
}

/**
 * @param {unknown} value
 * @returns {value is ContinuationPlan}
 */
export function isContinuationPlan(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {Record<string, unknown>} */ (value)
  return (
    v.continueConversation === true &&
    typeof v.strategy === 'string' &&
    CONTINUATION_STRATEGIES.includes(/** @type {ContinuationStrategy} */ (v.strategy)) &&
    typeof v.move === 'string' &&
    CONTINUATION_MOVES.includes(/** @type {ContinuationMove} */ (v.move)) &&
    typeof v.confidence === 'number' &&
    v.confidence >= 0 &&
    v.confidence <= 1
  )
}
