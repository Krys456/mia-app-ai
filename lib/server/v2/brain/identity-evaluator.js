/**
 * LAIfe V2 — Identity Evaluator (experimental)
 *
 * Pure measurement module. Scores how much a final reply feels like LAIfe
 * rather than a generic assistant.
 *
 * - Does not rewrite text
 * - Does not call LLMs
 * - Does not mutate planner / writer / memory
 * - Not wired into Pipeline / Runtime / API / V1
 *
 * Input:
 *   - response (final reply text) — required
 *   - plannerSummary (string | object) — required for coherence
 *   - writerSummary (string | object) — optional
 *
 * Output:
 *   {
 *     identityScore: 0..1,   // overall LAIfe-likeness (higher = more LAIfe)
 *     genericity: 0..1,      // higher = more generic assistant
 *     signature: 0..1,       // higher = recognizable living detail / voice
 *     memorability: 0..1,    // higher = more memorable turn
 *     coherence: 0..1,       // higher = aligns with planner summary
 *     reasons: string[],
 *     suggestions: string[],
 *   }
 */

export const IDENTITY_EVALUATOR_VERSION = '0.1.0-identity-evaluator'

/**
 * @typedef {object} IdentityEvaluation
 * @property {number} identityScore
 * @property {number} genericity
 * @property {number} signature
 * @property {number} memorability
 * @property {number} coherence
 * @property {string[]} reasons
 * @property {string[]} suggestions
 */

/**
 * @typedef {object} IdentityEvaluatorInput
 * @property {string} response
 * @property {string|object|null|undefined} [plannerSummary]
 * @property {string|object|null|undefined} [writerSummary]
 */

/**
 * @typedef {object} IdentityEvaluatorConfig
 * @property {Partial<{ genericity: number, signature: number, memorability: number, coherence: number }>} [weights]
 */

const DEFAULT_WEIGHTS = {
  /** Weight on (1 - genericity) inside identityScore */
  antiGenericity: 0.3,
  signature: 0.3,
  memorability: 0.2,
  coherence: 0.2,
}

/** Soft-assistant / generic texture (measurement only — does not rewrite). */
const GENERIC_OPENERS = [
  /^come posso aiutarti/i,
  /^how can i help/i,
  /^dimmi pure/i,
  /^è\s+bello\b/i,
  /^è\s+sempre\s+bello\b/i,
  /^è\s+un\s+piacere\b/i,
  /^è\s+importante\b/i,
  /^è\s+comprensibile\b/i,
  /^è\s+sorprendente\b/i,
  /^it['’]?s\s+(nice|important|wonderful|great|lovely)\b/i,
  /^i['’]?m\s+(glad|happy)\s+to\b/i,
  /^sono\s+qui\s+per\b/i,
  /^i['’]?m\s+here\s+(for|to)\b/i,
]

const GENERIC_FILLERS = [
  /\ble piccole cose\b/i,
  /\bfare la differenza\b/i,
  /\bportare luce\b/i,
  /\bqui c['’]?è spazio\b/i,
  /\bmake a (real )?difference\b/i,
  /\bbring light\b/i,
  /\bat the end of the day\b/i,
  /\bit['’]?s important to (remember|note)\b/i,
  /\bin today's (fast-paced|busy) world\b/i,
  /\brighten our days?\b/i,
  /\bspecial warmth\b/i,
  /\bmoment of connection\b/i,
  /\bmomento di connessione\b/i,
]

const HELP_DESK = [
  /\bhow can i (help|assist)\b/i,
  /\blet me know if you\b/i,
  /\bfeel free to ask\b/i,
  /\bdimmi pure\b/i,
  /\bcome posso aiutarti\b/i,
]

const CONCRETE_SIGNAL =
  /\b(caffè|caffé|sole|tramonto|pioggia|vento|strada|cucina|treno|mattina|sera|odore|profumo|suono|silenzio|tazza|finestra|ricordo|canzone|sorriso|coffee|sun|rain|train|morning|evening|smell|quiet|song|glance|nod)\b/i

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
function round4(n) {
  return Number(clamp01(n).toFixed(4))
}

/**
 * Normalize planner/writer summary into a flat text bag + light fields.
 * @param {unknown} summary
 * @returns {{ text: string, strategy: string, coda: string, tone: string, need: string, objective: string }}
 */
export function normalizeSummary(summary) {
  if (summary == null) {
    return { text: '', strategy: '', coda: '', tone: '', need: '', objective: '' }
  }
  if (typeof summary === 'string') {
    return {
      text: summary.trim(),
      strategy: '',
      coda: '',
      tone: '',
      need: '',
      objective: '',
    }
  }
  if (typeof summary !== 'object') {
    return {
      text: asString(summary),
      strategy: '',
      coda: '',
      tone: '',
      need: '',
      objective: '',
    }
  }

  const obj = /** @type {Record<string, unknown>} */ (summary)
  const brief =
    obj.writerBrief && typeof obj.writerBrief === 'object'
      ? /** @type {Record<string, unknown>} */ (obj.writerBrief)
      : obj

  const strategy = asString(brief.strategy || obj.strategy || '')
  const coda = asString(brief.coda || obj.coda || '')
  const tone = asString(brief.tone || obj.tone || obj.emotionalTone || '')
  const need = asString(brief.need || obj.need || '')
  const objective = asString(obj.objective || brief.moveSummary || '')

  const parts = [
    objective,
    strategy && `strategy=${strategy}`,
    need && `need=${need}`,
    coda && `coda=${coda}`,
    tone && `tone=${tone}`,
    Array.isArray(obj.constraints) ? obj.constraints.map(asString).join(' ') : '',
    Array.isArray(brief.must) ? brief.must.map(asString).join(' ') : '',
    Array.isArray(brief.mustNot) ? brief.mustNot.map(asString).join(' ') : '',
    asString(obj.summary || obj.text || ''),
  ].filter(Boolean)

  return {
    text: parts.join(' ').trim(),
    strategy: strategy.toLowerCase(),
    coda: coda.toLowerCase(),
    tone: tone.toLowerCase(),
    need: need.toLowerCase(),
    objective: objective.toLowerCase(),
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function sentences(text) {
  const raw = asString(text).replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const parts = raw.match(/[^.!?…]+(?:[.!?…]+|$)/g)
  if (!parts) return [raw]
  return parts.map((s) => s.trim()).filter(Boolean)
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokens(text) {
  return asString(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2)
}

/**
 * Genericity: 1 = generic assistant, 0 = not generic.
 * @param {string} response
 * @returns {{ score: number, notes: string[], suggestions: string[] }}
 */
export function scoreGenericity(response) {
  const text = asString(response).trim()
  const notes = []
  const suggestions = []
  if (!text) {
    return { score: 1, notes: ['empty_response'], suggestions: ['write a present reply'] }
  }

  let score = 0.28
  const first = sentences(text)[0] || text
  if (GENERIC_OPENERS.some((re) => re.test(first))) {
    score += 0.22
    notes.push('generic_opener')
    suggestions.push('open with presence instead of soft-assistant phrasing')
  }
  if (HELP_DESK.some((re) => re.test(text))) {
    score += 0.2
    notes.push('helpdesk_texture')
    suggestions.push('drop helpdesk framing')
  }

  let fillerHits = 0
  for (const re of GENERIC_FILLERS) {
    if (re.test(text)) fillerHits += 1
  }
  if (fillerHits >= 2) {
    score += 0.22
    notes.push('multiple_generic_fillers')
    suggestions.push('replace generic fillers with one concrete observation')
  } else if (fillerHits === 1) {
    score += 0.12
    notes.push('generic_filler')
    suggestions.push('trim poster/filler phrasing')
  }

  // Flat 3–4 medium sentences of soft uplift without concreteness
  const sents = sentences(text)
  if (sents.length >= 3 && !CONCRETE_SIGNAL.test(text) && fillerHits >= 1) {
    score += 0.1
    notes.push('soft_uplift_stack')
  }

  // Short natural ack is not generic by itself
  if (sents.length === 1 && tokens(text).length <= 5 && !HELP_DESK.some((re) => re.test(text))) {
    score -= 0.12
    notes.push('brief_natural_ack')
  }

  return {
    score: clamp01(score),
    notes,
    suggestions: [...new Set(suggestions)],
  }
}

/**
 * Signature: recognizable living detail / voice mark.
 * @param {string} response
 * @returns {{ score: number, notes: string[], suggestions: string[] }}
 */
export function scoreSignature(response) {
  const text = asString(response).trim()
  const notes = []
  const suggestions = []
  if (!text) {
    return { score: 0, notes: ['empty_response'], suggestions: ['add a living detail'] }
  }

  let score = 0.2
  if (CONCRETE_SIGNAL.test(text)) {
    score += 0.35
    notes.push('concrete_signal')
  }
  if (/(?:,|—|-)\s*(?:come|like|such as)\s+[^.?!]{6,}/i.test(text)) {
    score += 0.15
    notes.push('particular_image_clause')
  }
  if (
    /^(posso|vedo|noto|osserv|mi viene|i (can |notice|see|hear))\b/im.test(text) &&
    tokens(text).length >= 6
  ) {
    score += 0.15
    notes.push('situated_first_person')
  }
  if (/\d/.test(text) || /["«»][^"«»]{2,}["«»]/.test(text)) {
    score += 0.1
    notes.push('named_or_numeric_detail')
  }

  // Contrast / edge keeps voice from being flat-positive
  if (/\b(ma|però|invece|though|but|while|mentre)\b/i.test(text)) {
    score += 0.08
    notes.push('contrast_edge')
  }

  if (score < 0.45) {
    suggestions.push('keep one concrete image or situated observation as signature')
  }

  return {
    score: clamp01(score),
    notes,
    suggestions: [...new Set(suggestions)],
  }
}

/**
 * Memorability: would this turn stick after the chat scrolls away?
 * @param {string} response
 * @returns {{ score: number, notes: string[], suggestions: string[] }}
 */
export function scoreMemorability(response) {
  const text = asString(response).trim()
  const notes = []
  const suggestions = []
  if (!text) {
    return { score: 0, notes: ['empty_response'], suggestions: ['make the turn specific'] }
  }

  let score = 0.25
  const sents = sentences(text)
  const words = tokens(text).length

  if (CONCRETE_SIGNAL.test(text)) {
    score += 0.25
    notes.push('memorable_concrete')
  }
  if (sents.length === 1 || sents.length === 2) {
    score += 0.12
    notes.push('compact_shape')
  } else if (sents.length >= 4) {
    score -= 0.1
    notes.push('diffuse_shape')
    suggestions.push('one clear idea is more memorable than a soft stack')
  }

  // Uneven rhythm (short + longer) vs flat medium sentences
  if (sents.length >= 2) {
    const lengths = sents.map((s) => s.length)
    const max = Math.max(...lengths)
    const min = Math.min(...lengths)
    if (max >= min * 1.6) {
      score += 0.1
      notes.push('uneven_rhythm')
    }
  }

  if (words >= 8 && words <= 40) {
    score += 0.08
    notes.push('digestible_length')
  } else if (words > 70) {
    score -= 0.08
    notes.push('overlong')
  }

  if (GENERIC_FILLERS.some((re) => re.test(text))) {
    score -= 0.12
    notes.push('filler_reduces_memory')
  }

  if (score < 0.45) {
    suggestions.push('leave one image or contrast the reader can recall')
  }

  return {
    score: clamp01(score),
    notes,
    suggestions: [...new Set(suggestions)],
  }
}

/**
 * Coherence with planner summary (strategy / coda / tone / constraints signals).
 * @param {string} response
 * @param {ReturnType<typeof normalizeSummary>} planner
 * @param {ReturnType<typeof normalizeSummary>} [writer]
 * @returns {{ score: number, notes: string[], suggestions: string[] }}
 */
export function scoreCoherence(response, planner, writer) {
  const text = asString(response).trim()
  const notes = []
  const suggestions = []
  if (!text) {
    return { score: 0, notes: ['empty_response'], suggestions: ['align reply to planner move'] }
  }

  const plan = planner || normalizeSummary(null)
  const write = writer || normalizeSummary(null)
  const hasPlan = Boolean(plan.text || plan.strategy || plan.coda || plan.objective)

  if (!hasPlan) {
    notes.push('no_planner_summary')
    return {
      score: 0.55,
      notes,
      suggestions: ['provide plannerSummary for a sharper coherence read'],
    }
  }

  let score = 0.55
  const questions = (text.match(/\?/g) || []).length
  const askForbidden =
    /\bask_question:no\b/i.test(plan.text) ||
    /\bhard:no_question\b/i.test(plan.text) ||
    /\bdo not ask a question\b/i.test(plan.text) ||
    plan.coda === 'none' ||
    plan.coda === 'spark'
  const askExpected =
    /\bask_question:yes\b/i.test(plan.text) || plan.coda === 'question'

  if (askForbidden && questions > 0) {
    score -= 0.28
    notes.push('question_against_plan')
    suggestions.push('remove closing question to match planner coda/constraints')
  } else if (askForbidden && questions === 0) {
    score += 0.12
    notes.push('honors_no_question')
  }

  if (askExpected && questions === 0) {
    score -= 0.15
    notes.push('missing_planned_question')
    suggestions.push('include the planned question if coda requires it')
  } else if (askExpected && questions === 1) {
    score += 0.1
    notes.push('planned_question_present')
  }

  if (plan.strategy === 'support' || plan.need.includes('emotional')) {
    if (/\b(mi dispiace|capisco|sento che|i('m| am) sorry|i understand)\b/i.test(text)) {
      score += 0.08
      notes.push('support_presence')
    }
  }

  if (plan.strategy === 'connect' || plan.coda === 'spark') {
    if (CONCRETE_SIGNAL.test(text) || /(?:,|—|-)\s*(?:come|like)\s+/i.test(text)) {
      score += 0.08
      notes.push('connect_spark_texture')
    }
  }

  if (plan.tone === 'warm' || plan.tone === 'supportive') {
    // Warm ≠ poster positivity: penalize uplift stack without presence
    if (GENERIC_FILLERS.some((re) => re.test(text)) && !CONCRETE_SIGNAL.test(text)) {
      score -= 0.1
      notes.push('warm_collapsed_to_positivity')
      suggestions.push('keep warm as presence/calm, not motivational poster')
    }
  }

  // Optional writer summary: if it claims spark/no-question, cross-check lightly
  if (write.coda === 'spark' && questions > 0) {
    score -= 0.08
    notes.push('writer_summary_spark_vs_question')
  }

  return {
    score: clamp01(score),
    notes,
    suggestions: [...new Set(suggestions)],
  }
}

/**
 * Combine metric parts into final IdentityEvaluation.
 * @param {IdentityEvaluatorInput} input
 * @param {IdentityEvaluatorConfig} [config]
 * @returns {IdentityEvaluation}
 */
export function evaluateIdentity(input, config = {}) {
  const response = asString(input?.response).trim()
  const planner = normalizeSummary(input?.plannerSummary)
  const writer = normalizeSummary(input?.writerSummary)

  const weights = {
    ...DEFAULT_WEIGHTS,
    ...(config.weights || {}),
  }

  const genericity = scoreGenericity(response)
  const signature = scoreSignature(response)
  const memorability = scoreMemorability(response)
  const coherence = scoreCoherence(response, planner, writer)

  const identityScore = clamp01(
    weights.antiGenericity * (1 - genericity.score) +
      weights.signature * signature.score +
      weights.memorability * memorability.score +
      weights.coherence * coherence.score,
  )

  /** @type {string[]} */
  const reasons = []
  /** @type {string[]} */
  const suggestions = []

  const pushNotes = (prefix, metric) => {
    for (const n of metric.notes) reasons.push(`${prefix}:${n}`)
    for (const s of metric.suggestions) suggestions.push(s)
  }
  pushNotes('genericity', genericity)
  pushNotes('signature', signature)
  pushNotes('memorability', memorability)
  pushNotes('coherence', coherence)

  if (identityScore >= 0.72) {
    reasons.push('overall:feels_like_laife')
  } else if (identityScore <= 0.4) {
    reasons.push('overall:generic_assistant_risk')
    suggestions.push('preserve one living signature and cut soft-assistant filler')
  } else {
    reasons.push('overall:mixed_identity')
  }

  return {
    identityScore: round4(identityScore),
    genericity: round4(genericity.score),
    signature: round4(signature.score),
    memorability: round4(memorability.score),
    coherence: round4(coherence.score),
    reasons: [...new Set(reasons)],
    suggestions: [...new Set(suggestions)],
  }
}

/**
 * Factory (mirrors Reviewer style; pure, no wiring).
 * @param {IdentityEvaluatorConfig} [config]
 */
export function createIdentityEvaluator(config = {}) {
  return {
    version: IDENTITY_EVALUATOR_VERSION,
    /**
     * @param {IdentityEvaluatorInput} input
     * @returns {IdentityEvaluation}
     */
    evaluate(input) {
      return evaluateIdentity(input, config)
    },
  }
}

/**
 * @param {unknown} value
 * @returns {value is IdentityEvaluation}
 */
export function isIdentityEvaluation(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {Record<string, unknown>} */ (value)
  const nums = ['identityScore', 'genericity', 'signature', 'memorability', 'coherence']
  for (const key of nums) {
    if (typeof v[key] !== 'number' || !Number.isFinite(/** @type {number} */ (v[key]))) {
      return false
    }
  }
  return Array.isArray(v.reasons) && Array.isArray(v.suggestions)
}
