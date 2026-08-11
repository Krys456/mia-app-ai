/**
 * LAIfe V2 — Conversation Reviewer
 *
 * Pure quality evaluation. Does not generate text, call LLMs,
 * mutate memory, or change the plan. Not wired into the pipeline yet.
 *
 * @see WRITER_API_SPEC.md
 * @see V2_DATA_FLOW.md §1.6
 */

export const REVIEWER_VERSION = '2.1.0-reviewer'

/** @typedef {'PASS'|'REWRITE'} ReviewDecision */

/**
 * @typedef {'plannerConstraint'|'directiveCompliance'|'identityConsistency'|'conversationDelight'|'naturalness'|'specificity'|'redundancy'|'emotionalCalibration'} ProblemCategory
 */

/**
 * @typedef {'mustFix'|'improve'} ProblemSeverity
 */

/**
 * @typedef {object} ReviewProblem
 * @property {ProblemCategory} category
 * @property {string} code
 * @property {string} message
 * @property {ProblemSeverity} severity
 * @property {string} [suggestion]
 * @property {string} [metric]
 */

/**
 * @typedef {object} RewriteHints
 * @property {string[]} mustFix
 * @property {string[]} improve
 * @property {string[]} keep
 * @property {number} targetScore
 */

/**
 * @typedef {object} MetricScore
 * @property {number} score  0..1
 * @property {string[]} notes
 * @property {string[]} suggestions
 */

/**
 * @typedef {object} ReviewScorecard
 * @property {number} overall  0..1
 * @property {Record<string, number>} metrics
 * @property {number} threshold
 */

/**
 * @typedef {object} ReviewResult
 * @property {ReviewDecision} decision
 * @property {string} summary
 * @property {ReviewProblem[]} problems
 * @property {RewriteHints} rewriteHints
 * @property {ReviewScorecard} score
 */

/**
 * @typedef {object} ReviewerThresholds
 * @property {number} overallPass
 * @property {number} naturalness
 * @property {number} specificity
 * @property {number} conversationMomentum
 * @property {number} emotionalCalibration
 * @property {number} practicalValue
 * @property {number} redundancy
 * @property {number} clicheDetection
 * @property {number} respectOfPlanner
 * @property {number} responseCompleteness
 * @property {number} directiveCompliance
 * @property {number} conversationDelight
 * @property {number} identityConsistency
 */

/**
 * @typedef {object} ReviewerWeights
 * @property {number} naturalness
 * @property {number} specificity
 * @property {number} conversationMomentum
 * @property {number} emotionalCalibration
 * @property {number} practicalValue
 * @property {number} redundancy
 * @property {number} clicheDetection
 * @property {number} respectOfPlanner
 * @property {number} responseCompleteness
 * @property {number} directiveCompliance
 * @property {number} conversationDelight
 * @property {number} identityConsistency
 */

/**
 * @typedef {object} ReviewerConfig
 * @property {Partial<ReviewerThresholds>} [thresholds]
 * @property {Partial<ReviewerWeights>} [weights]
 * @property {string[]} [extraCliches]
 * @property {string[]} [extraRoboticOpeners]
 */

/**
 * @typedef {object} HardConstraintReport
 * @property {boolean} violated
 * @property {string[]} violations
 * @property {string[]} suggestions
 * @property {string[]} notes
 */

const METRIC_KEYS = [
  'naturalness',
  'specificity',
  'conversationMomentum',
  'emotionalCalibration',
  'practicalValue',
  'redundancy',
  'clicheDetection',
  'respectOfPlanner',
  'responseCompleteness',
  'directiveCompliance',
  'conversationDelight',
  'identityConsistency',
]

/** @type {readonly ProblemCategory[]} */
export const PROBLEM_CATEGORIES = Object.freeze([
  'plannerConstraint',
  'directiveCompliance',
  'identityConsistency',
  'conversationDelight',
  'naturalness',
  'specificity',
  'redundancy',
  'emotionalCalibration',
])

/**
 * Map internal metric keys onto Rewrite Contract problem categories.
 * @type {Record<string, ProblemCategory>}
 */
const METRIC_TO_CATEGORY = {
  naturalness: 'naturalness',
  specificity: 'specificity',
  conversationMomentum: 'conversationDelight',
  emotionalCalibration: 'emotionalCalibration',
  practicalValue: 'specificity',
  redundancy: 'redundancy',
  clicheDetection: 'naturalness',
  respectOfPlanner: 'plannerConstraint',
  responseCompleteness: 'specificity',
  directiveCompliance: 'directiveCompliance',
  conversationDelight: 'conversationDelight',
  identityConsistency: 'identityConsistency',
}

/** Categories that force mustFix severity when below threshold. */
const MUST_FIX_CATEGORIES = new Set([
  'plannerConstraint',
  'directiveCompliance',
  'identityConsistency',
])

/** @type {ReviewerThresholds} */
export const DEFAULT_THRESHOLDS = {
  overallPass: 0.7,
  naturalness: 0.6,
  specificity: 0.52,
  conversationMomentum: 0.55,
  emotionalCalibration: 0.55,
  practicalValue: 0.48,
  redundancy: 0.6,
  clicheDetection: 0.6,
  respectOfPlanner: 0.75,
  responseCompleteness: 0.58,
  directiveCompliance: 0.72,
  conversationDelight: 0.55,
  identityConsistency: 0.65,
}

/** @type {ReviewerWeights} */
export const DEFAULT_WEIGHTS = {
  naturalness: 1.1,
  specificity: 1,
  conversationMomentum: 1,
  emotionalCalibration: 1.1,
  practicalValue: 1,
  redundancy: 1,
  clicheDetection: 1.2,
  respectOfPlanner: 1.6,
  responseCompleteness: 1.1,
  directiveCompliance: 1.7,
  conversationDelight: 1.05,
  identityConsistency: 1.25,
}

const ROBOTIC_OPENERS = [
  /^come posso aiutarti/i,
  /^how can i help/i,
  /^dimmi pure/i,
  /^certo[!.,\s]*$/i,
  /^assolutamente[!.,\s]/i,
  /^great question/i,
  /^ottima domanda/i,
  /^thanks for (sharing|asking)/i,
  /^grazie per aver(mi)? (condiviso|chiesto)/i,
  /^i('m| am) (here|happy) to help/i,
  /^sono qui per aiutarti/i,
  /^feel free to ask/i,
  /^let me know if you/i,
]

const CLICHES = [
  /at the end of the day/i,
  /it('s| is) important to (remember|note)/i,
  /\bimportant to remember\b/i,
  /in today's (fast-paced|busy) world/i,
  /only time will tell/i,
  /needless to say/i,
  /it goes without saying/i,
  /double[- ]edged sword/i,
  /think outside the box/i,
  /low[- ]hanging fruit/i,
  /move the needle/i,
  /synergy/i,
  /nel mondo di oggi/i,
  /è importante ricordare che/i,
  /alla fine della giornata/i,
  /non c'è una risposta giusta o sbagliata/i,
  /ogni viaggio inizia con un passo/i,
]

const GENERIC_FILLERS = [
  /\b(interesting|interessante)\b/gi,
  /\b(great|fantastico|meraviglioso)\b/gi,
  /\b(various factors|diversi fattori)\b/gi,
  /\b(in many ways|in molti modi)\b/gi,
  /\b(generally speaking|in generale)\b/gi,
]

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
 * @param {Partial<ReviewerThresholds>} [partial]
 * @returns {ReviewerThresholds}
 */
export function resolveThresholds(partial = {}) {
  /** @type {ReviewerThresholds} */
  const out = { ...DEFAULT_THRESHOLDS }
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const k = /** @type {keyof ReviewerThresholds} */ (key)
    if (typeof partial[k] === 'number' && Number.isFinite(partial[k])) {
      out[k] = clamp01(/** @type {number} */ (partial[k]))
    }
  }
  return out
}

/**
 * @param {Partial<ReviewerWeights>} [partial]
 * @returns {ReviewerWeights}
 */
export function resolveWeights(partial = {}) {
  /** @type {ReviewerWeights} */
  const out = { ...DEFAULT_WEIGHTS }
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const k = /** @type {keyof ReviewerWeights} */ (key)
    if (typeof partial[k] === 'number' && Number.isFinite(partial[k]) && partial[k] >= 0) {
      out[k] = /** @type {number} */ (partial[k])
    }
  }
  return out
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function sentences(text) {
  return asString(text)
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokens(text) {
  return asString(text)
    .toLowerCase()
    .match(/[a-zàèéìòù0-9']+/gi) || []
}

/**
 * @param {any} plan
 * @returns {any}
 */
function briefOf(plan) {
  return plan && typeof plan === 'object' && plan.writerBrief && typeof plan.writerBrief === 'object'
    ? plan.writerBrief
    : {}
}

/**
 * @param {any} writerRequest
 * @returns {any}
 */
function decisionOf(writerRequest) {
  return writerRequest && typeof writerRequest === 'object' && writerRequest.decision
    ? writerRequest.decision
    : {}
}

/**
 * @param {string} text
 * @param {string[]} [extraOpeners]
 * @returns {MetricScore}
 */
export function scoreNaturalness(text, extraOpeners = []) {
  const t = asString(text).trim()
  const notes = []
  const suggestions = []
  let score = 0.78

  if (!t) {
    return { score: 0, notes: ['empty_text'], suggestions: ['write a complete reply'] }
  }

  const openers = [...ROBOTIC_OPENERS, ...extraOpeners.map((r) => new RegExp(r, 'i'))]
  const first = sentences(t)[0] || t
  if (openers.some((re) => re.test(first))) {
    score -= 0.35
    notes.push('robotic_opener')
    suggestions.push('remove generic opening')
  }

  if (/\b(as an ai|come (intelligenza artificiale|assistente ai)|i'm (just )?an? (language )?model)\b/i.test(t)) {
    score -= 0.25
    notes.push('ai_self_reference')
    suggestions.push('remove AI self-reference')
  }

  if (/^(certo|sure|absolutely|of course)[,!]?\s+/i.test(t) && t.length < 80) {
    score -= 0.15
    notes.push('thin_ack_opening')
    suggestions.push('open with substance instead of filler ack')
  }

  const sents = sentences(t)
  if (sents.length >= 2) {
    const lengths = sents.map((s) => s.length)
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
    const variance =
      lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length
    if (variance < 40 && sents.length >= 3) {
      score -= 0.08
      notes.push('monotone_sentence_length')
      suggestions.push('vary sentence rhythm')
    } else {
      score += 0.04
      notes.push('varied_rhythm')
    }
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @returns {MetricScore}
 */
export function scoreSpecificity(text) {
  const t = asString(text).trim()
  const notes = []
  const suggestions = []
  let score = 0.45

  if (!t) return { score: 0, notes: ['empty_text'], suggestions: ['add concrete content'] }

  const words = tokens(t)
  if (words.length >= 12) score += 0.1
  if (/\d/.test(t)) {
    score += 0.12
    notes.push('has_numbers')
  }
  if (/\b(for example|ad esempio|es\.|e\.g\.|come quando|such as)\b/i.test(t)) {
    score += 0.18
    notes.push('has_example_marker')
  }
  if (/["«»][^"«»]{3,}["«»]/.test(t) || /\b[A-Z][a-z]+[A-Z]/.test(t)) {
    score += 0.08
    notes.push('has_named_or_quoted_detail')
  }

  let fillerHits = 0
  for (const re of GENERIC_FILLERS) {
    const m = t.match(re)
    if (m) fillerHits += m.length
  }
  if (fillerHits >= 2) {
    score -= 0.2
    notes.push('generic_filler')
    suggestions.push('add concrete example')
    suggestions.push('replace vague filler with specifics')
  } else if (fillerHits === 1) {
    score -= 0.08
    notes.push('some_filler')
  }

  if (words.length < 8) {
    score -= 0.15
    notes.push('too_short_for_specificity')
    suggestions.push('add concrete example')
  }

  if (score < 0.5 && !suggestions.includes('add concrete example')) {
    suggestions.push('add concrete example')
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreConversationMomentum(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const notes = []
  const suggestions = []
  let score = 0.7

  if (!t) return { score: 0, notes: ['empty_text'], suggestions: ['continue the thread'] }

  const continueTopic = Boolean(brief.continueTopic || decision.shouldContinueTopic)
  const strategy = asString(brief.strategy || decision.strategy)

  if (continueTopic || strategy === 'continue') {
    if (/^(comunque|anyway|changing (the )?subject|cambiando argomento)\b/i.test(t)) {
      score -= 0.35
      notes.push('abrupt_topic_reset')
      suggestions.push('continue current topic without reset')
    } else {
      score += 0.1
      notes.push('no_abrupt_reset')
    }
  }

  if (strategy === 'close') {
    if (/\?\s*$/.test(t) || (t.match(/\?/g) || []).length > 0) {
      score -= 0.25
      notes.push('reopened_after_close')
      suggestions.push('allow conversation to end cleanly')
    } else {
      score += 0.1
      notes.push('clean_close')
    }
  }

  const questions = (t.match(/\?/g) || []).length
  if (questions >= 3) {
    score -= 0.3
    notes.push('interview_loop')
    suggestions.push('reduce stacked questions')
  } else if (questions === 2) {
    score -= 0.12
    notes.push('two_questions')
    suggestions.push('keep at most one question')
  }

  if (brief.coda === 'none' && questions === 0) {
    score += 0.05
    notes.push('no_forced_question')
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreEmotionalCalibration(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const notes = []
  const suggestions = []
  let score = 0.72

  if (!t) return { score: 0, notes: ['empty_text'], suggestions: ['match emotional tone'] }

  const comfort = Boolean(brief.comfort || decision.shouldComfort)
  const tone = asString(brief.tone || decision.emotionalTone)

  if (comfort) {
    if (/^(ecco la soluzione|here's (the )?fix|you should just|basta che)\b/i.test(t)) {
      score -= 0.4
      notes.push('skipped_emotion_for_fix')
      suggestions.push('acknowledge emotion before advice')
    }
    if (
      /\b(capisco|ti sento|mi dispiace|i hear you|that sounds|è comprensibile|must be hard)\b/i.test(
        t,
      )
    ) {
      score += 0.12
      notes.push('emotion_acknowledged')
    } else {
      score -= 0.25
      notes.push('missing_emotion_ack')
      suggestions.push('acknowledge emotion before advice')
    }
    if (
      /\b(non è niente|just get over it|non esagerare|get over it|move on)\b/i.test(
        t,
      )
    ) {
      score -= 0.6
      notes.push('minimizing')
      suggestions.push('avoid minimizing feelings')
    }
  }

  if (tone === 'playful' && /\b(urgent|critical failure|grave errore)\b/i.test(t)) {
    score -= 0.15
    notes.push('tone_mismatch_playful')
    suggestions.push('calibrate tone to playful brief')
  }
  if (tone === 'supportive' || tone === 'calm') {
    if (/!{3,}/.test(t) || /\b(YOU MUST|DEVI ASSOLUTAMENTE)\b/.test(t)) {
      score -= 0.2
      notes.push('harsh_for_soft_tone')
      suggestions.push('soften intensity to match tone')
    }
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scorePracticalValue(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const notes = []
  const suggestions = []
  let score = 0.5

  if (!t) return { score: 0, notes: ['empty_text'], suggestions: ['add practical substance'] }

  const strategy = asString(brief.strategy || decision.strategy)
  const teaching = Boolean(brief.teaching || decision.shouldTeach)

  if (
    /\b(prossimo passo|next step|prova a|try|puoi|you can|ad esempio|for example|perché|because)\b/i.test(
      t,
    )
  ) {
    score += 0.2
    notes.push('actionable_or_explanatory')
  }

  if (strategy === 'guide' || strategy === 'explain' || teaching) {
    if (tokens(t).length < 20) {
      score -= 0.25
      notes.push('too_thin_for_guide_explain')
      suggestions.push('add concrete example')
      suggestions.push('expand with one practical step')
    } else {
      score += 0.15
      notes.push('adequate_depth_for_task')
    }
  }

  if (strategy === 'support' || strategy === 'connect' || strategy === 'celebrate') {
    // Practical value is softer; presence counts
    if (tokens(t).length >= 6) {
      score += 0.15
      notes.push('presence_value')
    }
  }

  if (/^(ok|okay|fine|certo)\.?$/i.test(t)) {
    score -= 0.4
    notes.push('no_value')
    suggestions.push('add practical substance')
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @returns {MetricScore}
 */
export function scoreRedundancy(text) {
  const t = asString(text).trim()
  const notes = []
  const suggestions = []
  let score = 0.85

  if (!t) return { score: 0, notes: ['empty_text'], suggestions: ['write content once'] }

  const sents = sentences(t).map((s) => s.toLowerCase())
  let dupPairs = 0
  for (let i = 0; i < sents.length; i++) {
    for (let j = i + 1; j < sents.length; j++) {
      const a = new Set(tokens(sents[i]))
      const b = tokens(sents[j])
      if (a.size === 0 || b.length === 0) continue
      const overlap = b.filter((w) => a.has(w)).length / Math.max(a.size, b.length)
      if (overlap >= 0.7 && Math.min(sents[i].length, sents[j].length) > 20) {
        dupPairs += 1
      }
    }
  }
  if (dupPairs >= 2) {
    score -= 0.4
    notes.push('high_sentence_overlap')
    suggestions.push('reduce repetition')
  } else if (dupPairs === 1) {
    score -= 0.2
    notes.push('some_sentence_overlap')
    suggestions.push('reduce repetition')
  }

  const words = tokens(t)
  if (words.length >= 8) {
    const uniq = new Set(words)
    const ratio = uniq.size / words.length
    if (ratio < 0.45) {
      score -= 0.25
      notes.push('low_lexical_diversity')
      suggestions.push('reduce repetition')
    }
  }

  const repeatedPhrase = t.match(/(.{12,40})\s+\1/i)
  if (repeatedPhrase) {
    score -= 0.3
    notes.push('echoed_phrase')
    suggestions.push('reduce repetition')
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @param {string[]} [extraCliches]
 * @returns {MetricScore}
 */
export function scoreClicheDetection(text, extraCliches = []) {
  const t = asString(text).trim()
  const notes = []
  const suggestions = []
  let score = 0.9

  if (!t) return { score: 0.5, notes: ['empty_text'], suggestions: [] }

  const patterns = [
    ...CLICHES,
    ...extraCliches.map((c) => {
      try {
        return new RegExp(c, 'i')
      } catch {
        return null
      }
    }).filter(Boolean),
  ]

  let hits = 0
  for (const re of patterns) {
    if (/** @type {RegExp} */ (re).test(t)) hits += 1
  }

  if (hits >= 2) {
    score -= 0.45
    notes.push('multiple_cliches')
    suggestions.push('remove cliché phrasing')
  } else if (hits === 1) {
    score -= 0.25
    notes.push('cliche_detected')
    suggestions.push('remove cliché phrasing')
  } else {
    notes.push('no_cliche')
  }

  if (/that's a great question|ottima domanda/i.test(t)) {
    score -= 0.2
    notes.push('praise_cliche')
    suggestions.push('remove generic opening')
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreRespectOfPlanner(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const constraints = Array.isArray(plan?.constraints) ? plan.constraints.map(asString) : []
  const notes = []
  const suggestions = []
  let score = 0.85

  if (!t) {
    return {
      score: 0.1,
      notes: ['empty_text'],
      suggestions: ['follow planner structure'],
    }
  }

  const askAllowed =
    brief.coda === 'question' ||
    decision.shouldAskQuestion === true ||
    constraints.includes('ask_question:yes')
  const questions = (t.match(/\?/g) || []).length

  if (!askAllowed && questions > 0) {
    score -= 0.55
    notes.push('forbidden_question')
    suggestions.push('remove closing question')
  } else if (askAllowed && questions === 0 && brief.coda === 'question') {
    score -= 0.2
    notes.push('missing_required_question')
    suggestions.push('end with exactly one question')
  } else if (askAllowed && questions > 1) {
    score -= 0.25
    notes.push('too_many_questions')
    suggestions.push('keep at most one question')
  } else {
    notes.push('question_policy_ok')
  }

  if (brief.comfort || decision.shouldComfort) {
    // Respect comfort-first: heavy challenge language is a violation
    if (/\b(hai torto|you're wrong|that's silly|non ha senso)\b/i.test(t)) {
      score -= 0.35
      notes.push('challenge_against_comfort')
      suggestions.push('remove confrontational challenge')
    }
  }

  if (brief.challenge === false && decision.shouldChallenge === false) {
    if (/\b(hai torto|you're wrong|sfida|I disagree strongly)\b/i.test(t)) {
      score -= 0.2
      notes.push('unsolicited_challenge')
      suggestions.push('remove confrontational challenge')
    }
  }

  const depth = asString(brief.depth || decision.responseDepth)
  const words = tokens(t).length
  if (depth === 'minimal' && words > 60) {
    score -= 0.15
    notes.push('too_long_for_minimal')
    suggestions.push('shorten to match depth band')
  }
  if (depth === 'deep' && words < 25) {
    score -= 0.2
    notes.push('too_short_for_deep')
    suggestions.push('expand to match depth band')
  }

  if (constraints.includes('hard:no_reopen') || asString(brief.strategy) === 'close') {
    if (/\b(anyway|comunque|parliamo di|let's discuss)\b/i.test(t)) {
      score -= 0.3
      notes.push('reopened_agenda')
      suggestions.push('avoid reopening after close')
    }
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreResponseCompleteness(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const notes = []
  const suggestions = []
  let score = 0.55

  if (!t) {
    return { score: 0, notes: ['empty_text'], suggestions: ['complete the reply'] }
  }

  const words = tokens(t).length
  const depth = asString(brief.depth || decision.responseDepth || 'balanced')
  const strategy = asString(brief.strategy || decision.strategy)

  const minWords =
    depth === 'minimal' ? 3 : depth === 'light' ? 8 : depth === 'deep' ? 40 : 16
  if (words >= minWords) {
    score += 0.25
    notes.push('length_ok')
  } else {
    score -= 0.3
    notes.push('incomplete_length')
    suggestions.push('complete the reply')
  }

  if (strategy === 'explain' || strategy === 'guide' || brief.teaching) {
    if (
      /\b(perché|because|ad esempio|for example|passo|step)\b/i.test(t) ||
      words >= 30
    ) {
      score += 0.15
      notes.push('task_substance_present')
    } else {
      score -= 0.2
      notes.push('missing_task_substance')
      suggestions.push('add concrete example')
    }
  }

  if (/…\s*$|\.\.\.\s*$|\[todo\]|TBD/i.test(t)) {
    score -= 0.35
    notes.push('truncated_or_placeholder')
    suggestions.push('complete the reply')
  }

  // Ends mid-thought heuristic: no terminal punctuation and long text
  if (words > 20 && !/[.!?…]"?$/.test(t)) {
    score -= 0.1
    notes.push('weak_termination')
    suggestions.push('finish the final sentence')
  }

  return { score: clamp01(score), notes, suggestions }
}

/**
 * List hard:* constraints from the planner plan.
 * @param {any} plan
 * @returns {string[]}
 */
export function listHardConstraints(plan) {
  const constraints = Array.isArray(plan?.constraints) ? plan.constraints : []
  /** @type {string[]} */
  const out = []
  for (const raw of constraints) {
    const c = asString(raw).trim()
    if (c.startsWith('hard:')) out.push(c)
  }
  return out
}

/**
 * Evaluate Planner hard constraints. Any violation must force REWRITE.
 * @param {string} text
 * @param {any} plan
 * @param {any} [writerRequest]
 * @returns {HardConstraintReport}
 */
export function evaluateHardConstraints(text, plan, writerRequest = {}) {
  const t = asString(text).trim()
  const hard = listHardConstraints(plan)
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  /** @type {string[]} */
  const violations = []
  /** @type {string[]} */
  const suggestions = []
  /** @type {string[]} */
  const notes = []

  if (!hard.length) {
    return { violated: false, violations, suggestions, notes: ['no_hard_constraints'] }
  }

  for (const constraint of hard) {
    if (constraint === 'hard:no_question') {
      const questions = (t.match(/\?/g) || []).length
      if (questions > 0) {
        violations.push('hard:no_question')
        notes.push('hard_no_question_broken')
        suggestions.push('remove closing question')
      } else {
        notes.push('hard_no_question_ok')
      }
      continue
    }

    if (constraint === 'hard:no_reopen') {
      const reopenCue =
        /\b(anyway|comunque|parliamo di|let's discuss|cambiando argomento|another topic)\b/i.test(
          t,
        )
      const strategyClose = asString(brief.strategy || decision.strategy) === 'close'
      const hasQuestion = (t.match(/\?/g) || []).length > 0
      if (reopenCue || (strategyClose && hasQuestion)) {
        violations.push('hard:no_reopen')
        notes.push('hard_no_reopen_broken')
        suggestions.push('avoid reopening after close')
      } else {
        notes.push('hard_no_reopen_ok')
      }
      continue
    }

    if (constraint === 'hard:no_challenge_with_comfort') {
      if (/\b(hai torto|you're wrong|that's silly|non ha senso|I disagree strongly)\b/i.test(t)) {
        violations.push('hard:no_challenge_with_comfort')
        notes.push('hard_no_challenge_with_comfort_broken')
        suggestions.push('remove confrontational challenge')
      } else {
        notes.push('hard_no_challenge_with_comfort_ok')
      }
      continue
    }

    // Unknown hard:* — treat explicit mustNot-style unknowns conservatively only if tagged
    notes.push(`hard_unhandled:${constraint}`)
  }

  return {
    violated: violations.length > 0,
    violations: uniqueSuggestions(violations),
    suggestions: uniqueSuggestions(suggestions),
    notes,
  }
}

/**
 * Compliance with planner directives (must / mustNot / soft constraints).
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreDirectiveCompliance(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const constraints = Array.isArray(plan?.constraints) ? plan.constraints.map(asString) : []
  const mustNot = Array.isArray(brief.mustNot) ? brief.mustNot.map(asString) : []
  const notes = []
  const suggestions = []
  let score = 0.88

  if (!t) {
    return {
      score: 0.05,
      notes: ['empty_text'],
      suggestions: ['follow planner directives'],
    }
  }

  const askForbiddenByMustNot = mustNot.some((m) => /do not ask a question/i.test(m))
  const askAllowed =
    !askForbiddenByMustNot &&
    (brief.coda === 'question' ||
      decision.shouldAskQuestion === true ||
      constraints.includes('ask_question:yes'))
  const questions = (t.match(/\?/g) || []).length

  if ((!askAllowed || constraints.includes('ask_question:no')) && questions > 0) {
    score -= 0.5
    notes.push('directive_forbidden_question')
    suggestions.push('remove closing question')
  }

  if (
    /^(come posso aiutarti|how can i help|dimmi pure)\b/i.test(t) ||
    ROBOTIC_OPENERS.some((re) => re.test(sentences(t)[0] || t))
  ) {
    score -= 0.35
    notes.push('directive_helpdesk_opener')
    suggestions.push('remove generic opening')
  }

  if (constraints.includes('teach:no') && !brief.teaching && !decision.shouldTeach) {
    if (
      /\b(lezione|in conclusione|to summarize|ecco una spiegazione completa)\b/i.test(t) &&
      tokens(t).length > 90
    ) {
      score -= 0.2
      notes.push('unsolicited_lecture')
      suggestions.push('stay conversational; avoid lecture dump')
    }
  }

  if (constraints.includes('comfort:yes') || brief.comfort || decision.shouldComfort) {
    if (/^(ecco la soluzione|here's (the )?fix|just get over it)\b/i.test(t)) {
      score -= 0.3
      notes.push('skipped_comfort_directive')
      suggestions.push('acknowledge emotion before advice')
    }
    if (/\b(non è niente|just get over it|non esagerare|get over it|move on)\b/i.test(t)) {
      score -= 0.35
      notes.push('minimizing_against_comfort')
      suggestions.push('avoid minimizing feelings')
    }
  }

  if (constraints.includes('challenge:no') || brief.challenge === false) {
    if (/\b(hai torto|you're wrong|that's silly)\b/i.test(t)) {
      score -= 0.25
      notes.push('forbidden_challenge')
      suggestions.push('remove confrontational challenge')
    }
  }

  const hard = evaluateHardConstraints(t, plan, writerRequest)
  if (hard.violated) {
    score -= 0.45
    notes.push('hard_constraint_breach')
    for (const v of hard.violations) notes.push(`violated_${v}`)
    suggestions.push(...hard.suggestions)
  } else if (hard.violations.length === 0 && listHardConstraints(plan).length) {
    notes.push('hard_constraints_ok')
    score += 0.05
  }

  // Soft reward: strategy cue present for explain/guide without being robotic
  const strategy = asString(brief.strategy || decision.strategy)
  if ((strategy === 'explain' || strategy === 'guide') && tokens(t).length >= 20) {
    score += 0.04
    notes.push('task_strategy_substance')
  }

  return { score: clamp01(score), notes, suggestions: uniqueSuggestions(suggestions) }
}

/**
 * Human spark / delight — not flat, not interview, not helpdesk.
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreConversationDelight(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const notes = []
  const suggestions = []
  let score = 0.58

  if (!t) {
    return { score: 0, notes: ['empty_text'], suggestions: ['add a human conversational spark'] }
  }

  if (ROBOTIC_OPENERS.some((re) => re.test(sentences(t)[0] || t))) {
    score -= 0.35
    notes.push('delight_killed_by_helpdesk')
    suggestions.push('open with presence instead of helpdesk phrasing')
  }

  const questions = (t.match(/\?/g) || []).length
  if (questions >= 3) {
    score -= 0.35
    notes.push('interview_kills_delight')
    suggestions.push('reduce stacked questions')
  } else if (questions === 2) {
    score -= 0.15
    notes.push('two_questions_flatten_delight')
    suggestions.push('keep at most one question')
  }

  // Sensory / concrete spark
  if (
    /\b(luce|tramonto|caffè|odore|suono|texture|mattina|sera|colore|warm|sunlight|quiet|silenzio)\b/i.test(
      t,
    ) ||
    /\d/.test(t) ||
    /["«»][^"«»]{3,}["«»]/.test(t)
  ) {
    score += 0.18
    notes.push('concrete_spark')
  }

  if (/\b(interessante|interesting|great|fantastico)\b/i.test(t) && tokens(t).length < 18) {
    score -= 0.15
    notes.push('thin_praise_filler')
    suggestions.push('replace vague praise with a concrete observation')
  }

  const strategy = asString(brief.strategy || decision.strategy)
  const coda = asString(brief.coda)
  if (
    (strategy === 'connect' || coda === 'spark' || decision.initiative === 'one_spark') &&
    tokens(t).length >= 10 &&
    questions === 0
  ) {
    score += 0.12
    notes.push('spark_without_interview')
  }

  if (strategy === 'support' || brief.comfort || decision.shouldComfort) {
    if (/\b(capisco|ti sento|mi dispiace|i hear you|that sounds)\b/i.test(t)) {
      score += 0.1
      notes.push('warm_presence')
    }
    if (/\b(non è niente|just get over it|non esagerare|get over it)\b/i.test(t)) {
      score -= 0.3
      notes.push('minimizing_kills_delight')
      suggestions.push('avoid minimizing feelings')
    }
  }

  if (CLICHES.some((re) => re.test(t))) {
    score -= 0.2
    notes.push('cliche_flattens_delight')
    suggestions.push('remove cliché phrasing')
  }

  if (score < 0.55 && !suggestions.length) {
    suggestions.push('add a human conversational spark')
  }

  return { score: clamp01(score), notes, suggestions: uniqueSuggestions(suggestions) }
}

/**
 * Keep LAIfe identity: warm, non-helpdesk, non-corporate, non-AI-disclaimer.
 * @param {string} text
 * @param {any} plan
 * @param {any} writerRequest
 * @returns {MetricScore}
 */
export function scoreIdentityConsistency(text, plan, writerRequest) {
  const t = asString(text).trim()
  const brief = briefOf(plan)
  const decision = decisionOf(writerRequest)
  const foundation = asString(
    typeof writerRequest?.personalityFoundation === 'string'
      ? writerRequest.personalityFoundation
      : writerRequest?.personalityFoundation?.text ||
          writerRequest?.personalityFoundation?.content ||
          '',
  )
  const notes = []
  const suggestions = []
  let score = 0.84

  if (!t) {
    return {
      score: 0.1,
      notes: ['empty_text'],
      suggestions: ['restore LAIfe voice'],
    }
  }

  if (
    /\b(as an ai|come (intelligenza artificiale|assistente ai)|i'm (just )?an? (language )?model|sono (solo )?un('?|a )?ia)\b/i.test(
      t,
    )
  ) {
    score -= 0.4
    notes.push('ai_disclaimer')
    suggestions.push('remove AI self-reference')
  }

  if (ROBOTIC_OPENERS.some((re) => re.test(sentences(t)[0] || t))) {
    score -= 0.35
    notes.push('helpdesk_identity_break')
    suggestions.push('remove generic opening')
  }

  if (
    /\b(dear (sir|madam)|kindly note|please be advised|pursuant to|we regret to inform)\b/i.test(
      t,
    ) ||
    /\b(egregio|cordiali saluti|si prega di|con la presente)\b/i.test(t)
  ) {
    score -= 0.3
    notes.push('formal_corporate_break')
    suggestions.push('sound like LAIfe, not a corporate template')
  }

  if (
    /\b(you('?ve| have) got this|believe in yourself|unlock your potential|hustle harder)\b/i.test(
      t,
    )
  ) {
    score -= 0.2
    notes.push('motivational_poster_break')
    suggestions.push('drop poster-motivation phrasing')
  }

  const tone = asString(brief.tone || decision.emotionalTone)
  if (tone === 'playful' && /\b(urgent|critical failure|grave|serious matter)\b/i.test(t)) {
    score -= 0.15
    notes.push('identity_tone_clash_playful')
    suggestions.push('match playful LAIfe tone')
  }

  if (
    (tone === 'warm' || tone === 'supportive' || /warm|calm|thoughtful/i.test(foundation)) &&
    /\b(just get over it|stop complaining|non esagerare)\b/i.test(t)
  ) {
    score -= 0.25
    notes.push('cold_identity_clash')
    suggestions.push('restore warm LAIfe presence')
  }

  if (
    !notes.includes('ai_disclaimer') &&
    !notes.includes('helpdesk_identity_break') &&
    !notes.includes('formal_corporate_break') &&
    !notes.includes('cold_identity_clash') &&
    !notes.includes('motivational_poster_break')
  ) {
    score += 0.06
    notes.push('identity_stable')
  }

  return { score: clamp01(score), notes, suggestions: uniqueSuggestions(suggestions) }
}

/**
 * @param {Record<string, MetricScore>} metricResults
 * @param {ReviewerWeights} weights
 * @returns {number}
 */
function aggregateOverall(metricResults, weights) {
  let num = 0
  let den = 0
  for (const key of METRIC_KEYS) {
    const w = weights[/** @type {keyof ReviewerWeights} */ (key)] || 0
    const s = metricResults[key]?.score ?? 0
    num += w * s
    den += w
  }
  return den > 0 ? clamp01(num / den) : 0
}

/**
 * @param {string[]} list
 * @returns {string[]}
 */
function uniqueSuggestions(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const s = asString(item).trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * @param {string} metricKey
 * @returns {ProblemCategory}
 */
export function categoryForMetric(metricKey) {
  return METRIC_TO_CATEGORY[metricKey] || 'naturalness'
}

/**
 * @param {ReviewProblem[]} problems
 * @param {number} overall
 * @param {number} threshold
 * @param {HardConstraintReport} hard
 * @param {ReviewDecision} decision
 * @returns {string}
 */
function buildSummary(problems, overall, threshold, hard, decision) {
  if (decision === 'PASS') {
    return `PASS: draft meets quality threshold (overall ${overall.toFixed(2)} ≥ ${threshold.toFixed(2)}).`
  }
  if (hard.violated) {
    return `REWRITE: hard planner constraint violated (${hard.violations.join(', ')}); overall ${overall.toFixed(2)}.`
  }
  const must = problems.filter((p) => p.severity === 'mustFix').length
  const improve = problems.filter((p) => p.severity === 'improve').length
  return `REWRITE: overall ${overall.toFixed(2)} < ${threshold.toFixed(2)} with ${must} mustFix and ${improve} improve problems.`
}

/**
 * @param {Record<string, MetricScore>} metricResults
 * @param {ReviewerThresholds} thresholds
 * @param {HardConstraintReport} hard
 * @returns {ReviewProblem[]}
 */
function buildProblems(metricResults, thresholds, hard) {
  /** @type {ReviewProblem[]} */
  const problems = []

  for (const violation of hard.violations) {
    problems.push({
      category: 'plannerConstraint',
      code: `hard_constraint_violated:${violation}`,
      message: `Hard planner constraint violated: ${violation}`,
      severity: 'mustFix',
      suggestion:
        violation === 'hard:no_question'
          ? 'remove closing question'
          : violation === 'hard:no_reopen'
            ? 'avoid reopening after close'
            : violation === 'hard:no_challenge_with_comfort'
              ? 'remove confrontational challenge'
              : 'satisfy hard planner constraint',
      metric: 'respectOfPlanner',
    })
  }

  for (const key of METRIC_KEYS) {
    const result = metricResults[key]
    const metricThreshold = thresholds[/** @type {keyof ReviewerThresholds} */ (key)]
    if (!result || typeof metricThreshold !== 'number') continue
    if (result.score >= metricThreshold) continue

    const category = categoryForMetric(key)
    const severity =
      MUST_FIX_CATEGORIES.has(category) ||
      result.notes.some((n) =>
        /forbidden|hard_|minimizing|robotic|empty_text|directive_forbidden|ai_disclaimer|helpdesk/.test(
          n,
        ),
      )
        ? 'mustFix'
        : 'improve'

    const topNote = result.notes.find((n) => !/_ok$|_stable$|length_ok|varied_/.test(n)) || 'below_threshold'
    const suggestion = result.suggestions[0] || `improve ${category}`

    problems.push({
      category,
      code: `${key}_below_threshold`,
      message: `${key} ${result.score.toFixed(2)} < ${metricThreshold.toFixed(2)} (${topNote})`,
      severity,
      suggestion,
      metric: key,
    })
  }

  // Deduplicate by code+category
  const seen = new Set()
  /** @type {ReviewProblem[]} */
  const out = []
  for (const p of problems) {
    const id = `${p.category}:${p.code}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(p)
  }
  return out
}

/**
 * @param {ReviewProblem[]} problems
 * @param {Record<string, number>} metrics
 * @param {ReviewerThresholds} thresholds
 * @param {number} overall
 * @param {ReviewDecision} decision
 * @returns {RewriteHints}
 */
function buildRewriteHints(problems, metrics, thresholds, overall, decision) {
  /** @type {string[]} */
  const mustFix = []
  /** @type {string[]} */
  const improve = []
  /** @type {string[]} */
  const keep = []

  for (const p of problems) {
    const hint = p.suggestion || p.message
    if (p.severity === 'mustFix') mustFix.push(hint)
    else improve.push(hint)
  }

  for (const key of METRIC_KEYS) {
    const score = metrics[key]
    const metricThreshold = thresholds[/** @type {keyof ReviewerThresholds} */ (key)]
    if (typeof score !== 'number' || typeof metricThreshold !== 'number') continue
    if (score >= Math.max(metricThreshold, 0.75)) {
      keep.push(`preserve strong ${categoryForMetric(key)} (${key}=${score.toFixed(2)})`)
    }
  }

  if (!keep.length && decision === 'REWRITE') {
    keep.push('preserve factual content and planner objective')
  }

  const targetScore =
    decision === 'PASS'
      ? Number(thresholds.overallPass.toFixed(4))
      : Number(
          Math.min(0.95, Math.max(thresholds.overallPass, overall + 0.1)).toFixed(4),
        )

  return {
    mustFix: uniqueSuggestions(mustFix).slice(0, 10),
    improve: uniqueSuggestions(improve).slice(0, 10),
    keep: uniqueSuggestions(keep).slice(0, 8),
    targetScore,
  }
}

/**
 * @param {unknown} value
 * @returns {value is RewriteHints}
 */
export function isRewriteHints(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return Boolean(
    Array.isArray(v.mustFix) &&
      Array.isArray(v.improve) &&
      Array.isArray(v.keep) &&
      typeof v.targetScore === 'number' &&
      Number.isFinite(v.targetScore),
  )
}

/**
 * Create a configurable Reviewer.
 * @param {ReviewerConfig} [config]
 */
export function createReviewer(config = {}) {
  const thresholds = resolveThresholds(config.thresholds)
  const weights = resolveWeights(config.weights)
  const extraCliches = Array.isArray(config.extraCliches) ? config.extraCliches : []
  const extraRoboticOpeners = Array.isArray(config.extraRoboticOpeners)
    ? config.extraRoboticOpeners
    : []

  /**
   * Evaluate a writer draft against the planner output.
   * Pure. No LLM. No plan mutation. No memory writes. No text generation.
   * Emits Rewrite Contract: decision, summary, problems, rewriteHints.
   *
   * @param {{
   *   writerRequest?: object,
   *   writerResponse?: object,
   *   plan?: object,
   * }} input
   * @returns {ReviewResult}
   */
  function review(input) {
    const safe = input && typeof input === 'object' ? input : {}
    const writerRequest =
      safe.writerRequest && typeof safe.writerRequest === 'object'
        ? safe.writerRequest
        : {}
    const writerResponse =
      safe.writerResponse && typeof safe.writerResponse === 'object'
        ? safe.writerResponse
        : {}
    const plan =
      safe.plan && typeof safe.plan === 'object'
        ? safe.plan
        : writerRequest.plan && typeof writerRequest.plan === 'object'
          ? writerRequest.plan
          : {}

    const text = asString(writerResponse.text)

    /** @type {Record<string, MetricScore>} */
    const metricResults = {
      naturalness: scoreNaturalness(text, extraRoboticOpeners),
      specificity: scoreSpecificity(text),
      conversationMomentum: scoreConversationMomentum(text, plan, writerRequest),
      emotionalCalibration: scoreEmotionalCalibration(text, plan, writerRequest),
      practicalValue: scorePracticalValue(text, plan, writerRequest),
      redundancy: scoreRedundancy(text),
      clicheDetection: scoreClicheDetection(text, extraCliches),
      respectOfPlanner: scoreRespectOfPlanner(text, plan, writerRequest),
      responseCompleteness: scoreResponseCompleteness(text, plan, writerRequest),
      directiveCompliance: scoreDirectiveCompliance(text, plan, writerRequest),
      conversationDelight: scoreConversationDelight(text, plan, writerRequest),
      identityConsistency: scoreIdentityConsistency(text, plan, writerRequest),
    }

    const overall = Number(aggregateOverall(metricResults, weights).toFixed(4))

    /** @type {Record<string, number>} */
    const metrics = {}
    for (const key of METRIC_KEYS) {
      metrics[key] = Number(metricResults[key].score.toFixed(4))
    }

    const hard = evaluateHardConstraints(text, plan, writerRequest)
    let decision = overall < thresholds.overallPass ? 'REWRITE' : 'PASS'
    if (hard.violated) decision = 'REWRITE'

    const problems = buildProblems(metricResults, thresholds, hard)
    // On PASS, surface only soft diagnostics (improve), never mustFix
    const finalProblems =
      decision === 'PASS'
        ? problems.filter((p) => p.severity === 'improve').slice(0, 6)
        : problems.slice(0, 20)

    const rewriteHints = buildRewriteHints(
      decision === 'REWRITE' ? problems : [],
      metrics,
      thresholds,
      overall,
      decision,
    )

    const summary = buildSummary(
      finalProblems,
      overall,
      thresholds.overallPass,
      hard,
      decision,
    )

    return {
      decision,
      summary,
      problems: finalProblems,
      rewriteHints,
      score: {
        overall,
        metrics,
        threshold: thresholds.overallPass,
      },
    }
  }

  return {
    version: REVIEWER_VERSION,
    thresholds: { ...thresholds },
    weights: { ...weights },
    review,
  }
}

/**
 * One-shot review with optional config.
 * @param {{
 *   writerRequest?: object,
 *   writerResponse?: object,
 *   plan?: object,
 * }} input
 * @param {ReviewerConfig} [config]
 * @returns {ReviewResult}
 */
export function reviewConversation(input, config) {
  return createReviewer(config).review(input)
}

/**
 * @param {unknown} value
 * @returns {value is ReviewResult}
 */
export function isReviewResult(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return Boolean(
    (v.decision === 'PASS' || v.decision === 'REWRITE') &&
      typeof v.summary === 'string' &&
      Array.isArray(v.problems) &&
      isRewriteHints(v.rewriteHints) &&
      v.score &&
      typeof v.score.overall === 'number' &&
      v.score.metrics &&
      typeof v.score.metrics === 'object',
  )
}
