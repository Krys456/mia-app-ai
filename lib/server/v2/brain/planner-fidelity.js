/**
 * LAIfe V2 — Planner Fidelity Evaluator (experimental)
 *
 * Pure measurement module. Scores how faithfully a final reply follows
 * the Planner output (strategy, momentum, tone, depth, constraints).
 *
 * - Does not rewrite text
 * - Does not call LLMs
 * - Does not mutate planner / writer / memory
 * - Not wired into Pipeline / Runtime / API / V1
 *
 * Input:
 *   - plannerOutput (PlannerPlan object or summary) — required
 *   - response (final reply text) — required
 *
 * Output:
 *   {
 *     fidelityScore: 0..1,
 *     strategy: 0..1,
 *     momentum: 0..1,
 *     tone: 0..1,
 *     depth: 0..1,
 *     constraints: 0..1,
 *     missedSignals: string[],
 *     reasons: string[],
 *   }
 */

export const PLANNER_FIDELITY_VERSION = '0.1.0-planner-fidelity'

/**
 * @typedef {object} PlannerFidelityEvaluation
 * @property {number} fidelityScore
 * @property {number} strategy
 * @property {number} momentum
 * @property {number} tone
 * @property {number} depth
 * @property {number} constraints
 * @property {string[]} missedSignals
 * @property {string[]} reasons
 */

/**
 * @typedef {object} PlannerFidelityInput
 * @property {object|string|null|undefined} plannerOutput
 * @property {string} response
 */

/**
 * @typedef {object} PlannerFidelityConfig
 * @property {Partial<{ strategy: number, momentum: number, tone: number, depth: number, constraints: number }>} [weights]
 */

const DEFAULT_WEIGHTS = {
  strategy: 0.25,
  momentum: 0.2,
  tone: 0.15,
  depth: 0.15,
  constraints: 0.25,
}

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
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/**
 * @param {number} n
 * @returns {number}
 */
function round3(n) {
  return Math.round(clamp01(n) * 1000) / 1000
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  const raw = asString(text).replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const parts = raw.match(/[^.!?…]+(?:[.!?…]+|$)/g)
  if (!parts) return [raw]
  return parts.map((s) => s.trim()).filter(Boolean)
}

/**
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
  const t = asString(text).replace(/[.!?…,]+/g, ' ').trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

/**
 * Normalize planner output into a flat view used by metrics.
 * @param {unknown} plannerOutput
 * @returns {{
 *   strategy: string,
 *   tone: string,
 *   depth: string,
 *   coda: string,
 *   need: string,
 *   momentum: string,
 *   focusStatus: string,
 *   constraints: string[],
 *   must: string[],
 *   mustNot: string[],
 *   askQuestion: boolean|null,
 *   continueTopic: boolean|null,
 *   comfort: boolean|null,
 *   teaching: boolean|null,
 *   rawSummary: string,
 * }}
 */
export function normalizePlannerOutput(plannerOutput) {
  if (typeof plannerOutput === 'string') {
    const s = plannerOutput.trim()
    return {
      strategy: '',
      tone: '',
      depth: '',
      coda: '',
      need: '',
      momentum: '',
      focusStatus: '',
      constraints: [],
      must: [],
      mustNot: [],
      askQuestion: null,
      continueTopic: null,
      comfort: null,
      teaching: null,
      rawSummary: s,
    }
  }

  const plan = plannerOutput && typeof plannerOutput === 'object' ? /** @type {any} */ (plannerOutput) : {}
  const brief = plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : plan
  const momentumObj =
    plan.conversationMomentum && typeof plan.conversationMomentum === 'object'
      ? plan.conversationMomentum
      : null
  const focusObj =
    plan.conversationFocus && typeof plan.conversationFocus === 'object'
      ? plan.conversationFocus
      : null

  const constraints = Array.isArray(plan.constraints)
    ? plan.constraints.map((c) => asString(c))
    : []
  const must = Array.isArray(brief.must) ? brief.must.map((m) => asString(m)) : []
  const mustNot = Array.isArray(brief.mustNot) ? brief.mustNot.map((m) => asString(m)) : []

  let askQuestion = null
  if (constraints.some((c) => /ask_question:yes/i.test(c))) askQuestion = true
  if (constraints.some((c) => /ask_question:no|hard:no_question/i.test(c))) askQuestion = false
  if (brief.coda === 'question') askQuestion = true

  let continueTopic = typeof brief.continueTopic === 'boolean' ? brief.continueTopic : null
  if (constraints.some((c) => /continue_topic:yes/i.test(c))) continueTopic = true
  if (constraints.some((c) => /continue_topic:no/i.test(c))) continueTopic = false

  let comfort = typeof brief.comfort === 'boolean' ? brief.comfort : null
  if (constraints.some((c) => /comfort:yes/i.test(c))) comfort = true
  if (constraints.some((c) => /comfort:no/i.test(c))) comfort = false

  let teaching = typeof brief.teaching === 'boolean' ? brief.teaching : null
  if (constraints.some((c) => /teach:yes/i.test(c))) teaching = true
  if (constraints.some((c) => /teach:no/i.test(c))) teaching = false

  const momentum =
    asString(momentumObj?.kind) ||
    asString(plan.momentum) ||
    (constraints.find((c) => /conversation_momentum:/.test(c)) || '')
      .replace(/^.*conversation_momentum:/i, '')
      .trim()

  const focusStatus =
    asString(focusObj?.status) ||
    (constraints.find((c) => /conversation_focus:/.test(c)) || '')
      .replace(/^.*conversation_focus:/i, '')
      .trim()

  return {
    strategy: asString(brief.strategy || plan.strategy),
    tone: asString(brief.tone || plan.tone || brief.emotionalTone),
    depth: asString(brief.depth || plan.depth || brief.responseDepth),
    coda: asString(brief.coda),
    need: asString(brief.need || plan.need),
    momentum,
    focusStatus,
    constraints,
    must,
    mustNot,
    askQuestion,
    continueTopic,
    comfort,
    teaching,
    rawSummary: asString(plan.objective || brief.moveSummary || ''),
  }
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasQuestion(response) {
  return /\?/.test(asString(response))
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasHelpdesk(response) {
  return /^(come posso aiutarti|how can i help|dimmi pure|feel free to ask)\b/i.test(
    asString(response).trim(),
  )
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasSoftValidationStack(response) {
  const s = asString(response)
  let n = 0
  if (/^è\s+(bello|importante|comprensibile|normale)\b/im.test(s) || /\bè\s+(bello|importante)\b/i.test(s)) {
    n += 1
  }
  if (/\ble piccole cose\b|\bfare la differenza\b|\bportare luce\b/i.test(s)) n += 1
  return n >= 1
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasSupportPresence(response) {
  return /\b(mi dispiace|capisco|sono qui|ti ascolto|i['’]?m sorry|i understand|i['’]?m here)\b/i.test(
    asString(response),
  )
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasTeachingShape(response) {
  const sentences = splitSentences(response)
  if (sentences.length >= 2) return true
  return /\b(perché|per esempio|ad esempio|in pratica|cioè|because|for example|means that)\b/i.test(
    asString(response),
  )
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasDebugShape(response) {
  return /\b(prova|controlla|errore|bug|log|step|passaggio|check|fix|cause|likely)\b/i.test(
    asString(response),
  )
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasPlanShape(response) {
  return /\b(prima|poi|quindi|step|passo|1\.|2\.|checklist|priorit|roadmap|next)\b/i.test(
    asString(response),
  )
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasDecisionShape(response) {
  return /\b(meglio|consiglio|raccomand|opzione|trade-?off|prefer|versus|vs\b)\b/i.test(
    asString(response),
  )
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function hasStoryShape(response) {
  return /\b(c['’]?era|una volta|storia|raccont|scene|poi improvvisamente)\b/i.test(
    asString(response),
  )
}

/**
 * @param {ReturnType<typeof normalizePlannerOutput>} plan
 * @param {string} response
 * @param {string[]} missed
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreStrategy(plan, response, missed, reasons) {
  const strategy = plan.strategy.toLowerCase()
  if (!strategy) {
    reasons.push('strategy:missing_in_planner')
    return 0.5
  }

  let score = 0.55
  const q = hasQuestion(response)
  const helpdesk = hasHelpdesk(response)
  const words = wordCount(response)

  if (strategy === 'support') {
    if (hasSupportPresence(response)) {
      score += 0.3
      reasons.push('strategy:support_presence')
    } else {
      score -= 0.25
      missed.push('support_presence')
      reasons.push('strategy:missing_support_presence')
    }
    if (q && plan.askQuestion === false) {
      score -= 0.2
      missed.push('no_question_under_support')
    }
  } else if (strategy === 'connect') {
    if (helpdesk) {
      score -= 0.35
      missed.push('avoid_helpdesk')
      reasons.push('strategy:helpdesk_against_connect')
    } else {
      score += 0.2
      reasons.push('strategy:connect_no_helpdesk')
    }
    if (words <= 40) score += 0.1
  } else if (strategy === 'explain' || strategy === 'answer') {
    if (words >= 6) {
      score += 0.2
      reasons.push('strategy:has_substance')
    } else {
      score -= 0.2
      missed.push('informational_substance')
      reasons.push('strategy:thin_substance')
    }
    if (strategy === 'explain' && hasTeachingShape(response)) {
      score += 0.15
      reasons.push('strategy:teaching_shape')
    }
  } else if (strategy === 'guide') {
    if (hasDebugShape(response) || hasPlanShape(response)) {
      score += 0.25
      reasons.push('strategy:actionable_guide')
    } else {
      score -= 0.15
      missed.push('actionable_next_step')
      reasons.push('strategy:missing_actionable_step')
    }
  } else if (strategy === 'continue') {
    if (helpdesk) {
      score -= 0.25
      missed.push('avoid_reset_helpdesk')
    } else {
      score += 0.2
      reasons.push('strategy:continue_no_reset')
    }
  } else if (strategy === 'close') {
    if (q) {
      score -= 0.3
      missed.push('no_reopen_question')
      reasons.push('strategy:close_has_question')
    } else {
      score += 0.25
      reasons.push('strategy:clean_close')
    }
  } else if (strategy === 'explore') {
    if (hasDecisionShape(response) || hasPlanShape(response) || words >= 8) {
      score += 0.2
      reasons.push('strategy:explore_direction')
    }
  } else if (strategy === 'entertain') {
    if (hasStoryShape(response) || /[!…]/.test(response)) {
      score += 0.2
      reasons.push('strategy:playful_texture')
    }
  } else {
    reasons.push(`strategy:neutral_${strategy}`)
    score = 0.6
  }

  return round3(score)
}

/**
 * @param {ReturnType<typeof normalizePlannerOutput>} plan
 * @param {string} response
 * @param {string[]} missed
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreMomentum(plan, response, missed, reasons) {
  const kind = plan.momentum.toLowerCase()
  if (!kind) {
    reasons.push('momentum:not_specified')
    return 0.55
  }

  let score = 0.45
  const hit = (ok, signal) => {
    if (ok) {
      score += 0.35
      reasons.push(`momentum:${signal}`)
    } else {
      score -= 0.2
      missed.push(`momentum_${kind}`)
      reasons.push(`momentum:missed_${kind}`)
    }
  }

  switch (kind) {
    case 'social':
      hit(
        !hasHelpdesk(response) && wordCount(response) <= 50,
        'social_light',
      )
      break
    case 'learning':
      hit(hasTeachingShape(response), 'learning_shape')
      break
    case 'debugging':
      hit(hasDebugShape(response), 'debugging_shape')
      break
    case 'planning':
      hit(hasPlanShape(response), 'planning_shape')
      break
    case 'decision':
      hit(hasDecisionShape(response), 'decision_shape')
      break
    case 'storytelling':
      hit(hasStoryShape(response) || splitSentences(response).length >= 2, 'story_shape')
      break
    case 'emotional_support':
      hit(hasSupportPresence(response), 'support_shape')
      break
    case 'brainstorming':
      hit(
        /\b(idea|opzione|alternativa|oppure|what if|e se|potresti)\b/i.test(response) ||
          splitSentences(response).length >= 2,
        'brainstorm_shape',
      )
      break
    default:
      reasons.push(`momentum:unknown_${kind}`)
      score = 0.5
  }

  return round3(score)
}

/**
 * @param {ReturnType<typeof normalizePlannerOutput>} plan
 * @param {string} response
 * @param {string[]} missed
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreTone(plan, response, missed, reasons) {
  const tone = plan.tone.toLowerCase()
  if (!tone) {
    reasons.push('tone:not_specified')
    return 0.55
  }

  let score = 0.55
  const soft = hasSoftValidationStack(response)
  const support = hasSupportPresence(response)
  const helpdesk = hasHelpdesk(response)

  if (tone === 'warm' || tone === 'friendly' || tone === 'playful') {
    if (helpdesk) {
      score -= 0.25
      missed.push('warm_without_helpdesk')
      reasons.push('tone:helpdesk_vs_warm')
    } else {
      score += 0.2
      reasons.push('tone:warm_ok')
    }
  } else if (tone === 'supportive' || tone === 'gentle') {
    if (support) {
      score += 0.3
      reasons.push('tone:supportive_presence')
    } else {
      score -= 0.2
      missed.push('supportive_presence')
      reasons.push('tone:missing_supportive_presence')
    }
  } else if (tone === 'neutral' || tone === 'direct' || tone === 'calm') {
    if (soft) {
      score -= 0.2
      missed.push('avoid_soft_stack_for_direct_tone')
      reasons.push('tone:soft_stack_vs_direct')
    } else {
      score += 0.2
      reasons.push('tone:direct_ok')
    }
  } else {
    reasons.push(`tone:neutral_${tone}`)
    score = 0.6
  }

  return round3(score)
}

/**
 * @param {ReturnType<typeof normalizePlannerOutput>} plan
 * @param {string} response
 * @param {string[]} missed
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreDepth(plan, response, missed, reasons) {
  const depth = plan.depth.toLowerCase()
  const words = wordCount(response)
  const sentences = splitSentences(response).length
  if (!depth) {
    reasons.push('depth:not_specified')
    return 0.55
  }

  /** @type {Record<string, { min: number, max: number, maxSentences?: number }>} */
  const bands = {
    minimal: { min: 1, max: 12, maxSentences: 2 },
    light: { min: 3, max: 40, maxSentences: 3 },
    balanced: { min: 12, max: 90 },
    deep: { min: 30, max: 220 },
  }
  const band = bands[depth] || bands.balanced
  let score = 0.5

  if (words >= band.min && words <= band.max) {
    score += 0.35
    reasons.push(`depth:within_${depth}_band`)
  } else if (words < band.min) {
    score -= 0.25
    missed.push(`depth_${depth}_too_thin`)
    reasons.push('depth:too_thin')
  } else {
    score -= 0.2
    missed.push(`depth_${depth}_too_long`)
    reasons.push('depth:too_long')
  }

  if (band.maxSentences && sentences > band.maxSentences) {
    score -= 0.15
    missed.push(`depth_${depth}_too_many_sentences`)
    reasons.push('depth:too_many_sentences')
  }

  return round3(score)
}

/**
 * @param {ReturnType<typeof normalizePlannerOutput>} plan
 * @param {string} response
 * @param {string[]} missed
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreConstraints(plan, response, missed, reasons) {
  let score = 0.7
  let checks = 0
  let hits = 0

  const check = (ok, miss, reasonOk, reasonBad) => {
    checks += 1
    if (ok) {
      hits += 1
      if (reasonOk) reasons.push(reasonOk)
    } else {
      missed.push(miss)
      if (reasonBad) reasons.push(reasonBad)
    }
  }

  if (plan.askQuestion === false) {
    check(
      !hasQuestion(response),
      'ask_question:no',
      'constraints:honors_no_question',
      'constraints:question_against_plan',
    )
  } else if (plan.askQuestion === true) {
    check(
      hasQuestion(response),
      'ask_question:yes',
      'constraints:has_required_question',
      'constraints:missing_required_question',
    )
  }

  if (plan.constraints.some((c) => /hard:no_reopen/i.test(c))) {
    check(
      !hasQuestion(response),
      'hard:no_reopen',
      'constraints:no_reopen',
      'constraints:reopened_with_question',
    )
  }

  if (plan.mustNot.some((m) => /helpdesk|how can i help|dimmi pure/i.test(m))) {
    check(
      !hasHelpdesk(response),
      'no_helpdesk',
      'constraints:no_helpdesk',
      'constraints:helpdesk_banned',
    )
  }

  if (plan.comfort === true || plan.must.some((m) => /emotional recognition|validate/i.test(m))) {
    check(
      hasSupportPresence(response),
      'comfort_presence',
      'constraints:comfort_presence',
      'constraints:missing_comfort_presence',
    )
  }

  if (plan.focusStatus === 'active' || plan.constraints.some((c) => /focus:avoid_clarification/i.test(c))) {
    // Clarifying "what are we talking about" style questions are a miss when focus is active.
    const clarifying =
      /\b(di cosa|di che|what (?:are we|do you mean)|intendi|parliamo di cosa)\b/i.test(response) &&
      hasQuestion(response)
    check(
      !clarifying,
      'avoid_useless_clarification',
      'constraints:no_useless_clarification',
      'constraints:useless_clarification',
    )
  }

  if (!checks) {
    reasons.push('constraints:none_checkable')
    return 0.6
  }

  score = hits / checks
  return round3(score)
}

/**
 * Evaluate how faithfully a response follows the planner output.
 * @param {PlannerFidelityInput} input
 * @param {PlannerFidelityConfig} [config]
 * @returns {PlannerFidelityEvaluation}
 */
export function evaluatePlannerFidelity(input, config = {}) {
  const response = asString(input?.response).replace(/\s+/g, ' ').trim()
  const plan = normalizePlannerOutput(input?.plannerOutput)

  /** @type {string[]} */
  const missedSignals = []
  /** @type {string[]} */
  const reasons = []

  if (!response) {
    return {
      fidelityScore: 0,
      strategy: 0,
      momentum: 0,
      tone: 0,
      depth: 0,
      constraints: 0,
      missedSignals: ['empty_response'],
      reasons: ['empty_response'],
    }
  }

  const strategy = scoreStrategy(plan, response, missedSignals, reasons)
  const momentum = scoreMomentum(plan, response, missedSignals, reasons)
  const tone = scoreTone(plan, response, missedSignals, reasons)
  const depth = scoreDepth(plan, response, missedSignals, reasons)
  const constraints = scoreConstraints(plan, response, missedSignals, reasons)

  const weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) }
  const weightSum =
    weights.strategy + weights.momentum + weights.tone + weights.depth + weights.constraints || 1

  const fidelityScore = round3(
    (strategy * weights.strategy +
      momentum * weights.momentum +
      tone * weights.tone +
      depth * weights.depth +
      constraints * weights.constraints) /
      weightSum,
  )

  // unique missed / reasons
  const uniqMissed = []
  for (const m of missedSignals) {
    if (!uniqMissed.includes(m)) uniqMissed.push(m)
  }
  const uniqReasons = []
  for (const r of reasons) {
    if (!uniqReasons.includes(r)) uniqReasons.push(r)
  }

  if (fidelityScore >= 0.75) uniqReasons.push('overall:high_fidelity')
  else if (fidelityScore >= 0.5) uniqReasons.push('overall:mixed_fidelity')
  else uniqReasons.push('overall:low_fidelity')

  return {
    fidelityScore,
    strategy,
    momentum,
    tone,
    depth,
    constraints,
    missedSignals: uniqMissed,
    reasons: uniqReasons,
  }
}

/**
 * @param {PlannerFidelityConfig} [config]
 */
export function createPlannerFidelityEvaluator(config = {}) {
  return {
    version: PLANNER_FIDELITY_VERSION,
    /**
     * @param {PlannerFidelityInput} input
     * @returns {PlannerFidelityEvaluation}
     */
    evaluate(input) {
      return evaluatePlannerFidelity(input, config)
    },
  }
}

/**
 * @param {unknown} value
 * @returns {value is PlannerFidelityEvaluation}
 */
export function isPlannerFidelityEvaluation(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return (
    typeof v.fidelityScore === 'number' &&
    typeof v.strategy === 'number' &&
    typeof v.momentum === 'number' &&
    typeof v.tone === 'number' &&
    typeof v.depth === 'number' &&
    typeof v.constraints === 'number' &&
    Array.isArray(v.missedSignals) &&
    Array.isArray(v.reasons)
  )
}
