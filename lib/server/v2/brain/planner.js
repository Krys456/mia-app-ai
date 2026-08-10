/**
 * LAIfe V2 — Planner
 *
 * Pure planning module. Turns a Mind Decision (+ Perception context)
 * into a concrete response structure and writer brief.
 *
 * Does not decide, does not analyze user text, does not call models,
 * does not write the final answer, does not mutate memory.
 * Not wired into the chat pipeline yet.
 *
 * @see PLANNER_SPEC.md
 * @see LAIFE_V2_ARCHITECTURE.md §2.2.4
 */

export const PLANNER_VERSION = '2.0.0-planner'

/**
 * @typedef {object} PerceptionResult
 * @property {string} [language]
 * @property {string} [intent]
 * @property {string} [socialIntent]
 * @property {string} [emotionalState]
 * @property {string} [conversationStage]
 * @property {string} [knowledgeLevel]
 * @property {string} [userNeed]
 * @property {number} [confidence]
 */

/**
 * @typedef {object} MindDecision
 * @property {string} [need]
 * @property {string} [goal]
 * @property {string} [strategy]
 * @property {string} [initiative]
 * @property {string} [emotionalTone]
 * @property {string} [responseDepth]
 * @property {boolean} [shouldUseMemory]
 * @property {boolean} [shouldContinueTopic]
 * @property {boolean} [shouldAskQuestion]
 * @property {boolean} [shouldTeach]
 * @property {boolean} [shouldComfort]
 * @property {boolean} [shouldChallenge]
 * @property {number} [confidence]
 */

/**
 * @typedef {object} PlanPhase
 * @property {'opening'|'development'|'closing'} role
 * @property {string} kind
 * @property {string} purpose
 */

/**
 * @typedef {object} ConversationPlan
 * @property {PlanPhase} opening
 * @property {PlanPhase[]} development
 * @property {PlanPhase} closing
 * @property {'minimal'|'light'|'balanced'|'deep'} lengthBand
 * @property {number} beatCount
 */

/**
 * @typedef {'none'|'question'|'insight'|'spark'|'direction'} WriterCoda
 */

/**
 * @typedef {object} WriterBrief
 * @property {string} language
 * @property {string} tone
 * @property {string} depth
 * @property {string} strategy
 * @property {string} need
 * @property {string} moveSummary
 * @property {string[]} must
 * @property {string[]} mustNot
 * @property {WriterCoda} coda
 * @property {'omit'|'weave_soft'|'allowed'} memoryHint
 * @property {boolean} teaching
 * @property {boolean} comfort
 * @property {boolean} challenge
 * @property {boolean} continueTopic
 */

/**
 * @typedef {object} PlannerPlan
 * @property {string} objective
 * @property {ConversationPlan} conversationPlan
 * @property {WriterBrief} writerBrief
 * @property {string[]} constraints
 * @property {number} confidence
 */

/**
 * @typedef {object} PlannerInput
 * @property {PerceptionResult} [perception]
 * @property {MindDecision} [decision]
 */

const STRATEGIES = new Set([
  'connect',
  'continue',
  'answer',
  'explain',
  'guide',
  'support',
  'celebrate',
  'recover',
  'close',
  'entertain',
  'explore',
])

const DEPTHS = new Set(['minimal', 'light', 'balanced', 'deep'])
const INITIATIVES = new Set(['none', 'one_insight', 'one_spark', 'one_direction'])

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
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function asNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  return fallback
}

/**
 * @param {PlannerInput} [input]
 */
function normalize(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const p =
    raw.perception && typeof raw.perception === 'object' ? raw.perception : {}
  const d = raw.decision && typeof raw.decision === 'object' ? raw.decision : {}

  const strategyRaw = asString(d.strategy)
  const depthRaw = asString(d.responseDepth)
  const initiativeRaw = asString(d.initiative)

  return {
    perception: {
      language: asString(p.language) || 'unknown',
      intent: asString(p.intent) || 'unclear',
      socialIntent: asString(p.socialIntent) || 'none',
      emotionalState: asString(p.emotionalState) || 'neutral',
      conversationStage: asString(p.conversationStage) || 'opening',
      knowledgeLevel: asString(p.knowledgeLevel) || 'unknown',
      userNeed: asString(p.userNeed) || 'unclear',
      confidence: Math.max(0, Math.min(1, asNumber(p.confidence, 0.4))),
    },
    decision: {
      need: asString(d.need) || 'unclear',
      goal: asString(d.goal) || 'answer__need_unclear',
      strategy: STRATEGIES.has(strategyRaw) ? strategyRaw : 'answer',
      initiative: INITIATIVES.has(initiativeRaw) ? initiativeRaw : 'none',
      emotionalTone: asString(d.emotionalTone) || 'neutral',
      responseDepth: DEPTHS.has(depthRaw) ? depthRaw : 'balanced',
      shouldUseMemory: asBool(d.shouldUseMemory, false),
      shouldContinueTopic: asBool(d.shouldContinueTopic, false),
      shouldAskQuestion: asBool(d.shouldAskQuestion, false),
      shouldTeach: asBool(d.shouldTeach, false),
      shouldComfort: asBool(d.shouldComfort, false),
      shouldChallenge: asBool(d.shouldChallenge, false),
      confidence: Math.max(0, Math.min(1, asNumber(d.confidence, 0.5))),
    },
  }
}

/**
 * @param {string} role
 * @param {string} kind
 * @param {string} purpose
 * @returns {PlanPhase}
 */
function phase(role, kind, purpose) {
  return {
    role: /** @type {PlanPhase['role']} */ (role),
    kind,
    purpose,
  }
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @returns {WriterCoda}
 */
function resolveCoda(decision) {
  // Packaging invariant already enforced by Mind: close has no coda initiative.
  if (decision.strategy === 'close') return 'none'
  // Decision authority: question occupies coda exclusively
  if (decision.shouldAskQuestion) return 'question'
  if (decision.initiative === 'one_insight') return 'insight'
  if (decision.initiative === 'one_spark') return 'spark'
  if (decision.initiative === 'one_direction') return 'direction'
  return 'none'
}

/**
 * @param {WriterCoda} coda
 * @returns {PlanPhase}
 */
function closingFromCoda(coda) {
  switch (coda) {
    case 'question':
      return phase(
        'closing',
        'one_question',
        'Close with exactly one useful clarifying or deepening question; no second question.',
      )
    case 'insight':
      return phase(
        'closing',
        'one_insight',
        'Close with one compact insight that advances the same thread; no question.',
      )
    case 'spark':
      return phase(
        'closing',
        'one_spark',
        'Close or land with one human spark (observation/curiosity seed); do not interview.',
      )
    case 'direction':
      return phase(
        'closing',
        'one_direction',
        'Commit to one concrete direction and begin it; do not offer a menu of choices.',
      )
    default:
      return phase(
        'closing',
        'none_stop',
        'End naturally without a forced question or extra coda.',
      )
  }
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @returns {PlanPhase}
 */
function buildOpening(decision) {
  const { strategy, shouldComfort, shouldContinueTopic, shouldTeach } = decision

  if (strategy === 'close') {
    return phase(
      'opening',
      'warm_farewell',
      'Acknowledge closure warmly without reopening a topic.',
    )
  }
  if (strategy === 'recover') {
    return phase(
      'opening',
      'ack_feedback',
      'Acknowledge the feedback briefly and calmly before adjusting.',
    )
  }
  if (shouldComfort || strategy === 'support') {
    return phase(
      'opening',
      'emotion_first',
      'Recognize the emotional state first; do not jump into advice or explanation.',
    )
  }
  if (strategy === 'celebrate') {
    return phase(
      'opening',
      'share_joy',
      'Meet the celebration energy before adding any extra content.',
    )
  }
  if (strategy === 'connect') {
    return phase(
      'opening',
      'warm_presence',
      'Open with warm presence and conversational initiative; avoid helpdesk phrasing.',
    )
  }
  if (shouldContinueTopic || strategy === 'continue') {
    return phase(
      'opening',
      'continue_thread',
      'Continue the current thread without resetting or summarizing from scratch.',
    )
  }
  if (shouldTeach || strategy === 'explain') {
    return phase(
      'opening',
      'teach_hook',
      'Open with the core idea to be taught; keep it progressive, not encyclopedic.',
    )
  }
  if (strategy === 'guide') {
    return phase(
      'opening',
      'problem_frame',
      'Frame the blocking problem clearly, then move toward an actionable next step.',
    )
  }
  if (strategy === 'explore') {
    return phase(
      'opening',
      'commit_direction',
      'Open by committing to one direction instead of asking the user to choose.',
    )
  }
  if (strategy === 'entertain') {
    return phase(
      'opening',
      'playful_hook',
      'Open with a playful or story-like hook aligned to entertainment.',
    )
  }
  return phase(
    'opening',
    'direct_answer',
    'Open by answering the need directly without robotic acknowledgements.',
  )
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ReturnType<typeof normalize>['perception']} perception
 * @returns {PlanPhase[]}
 */
function buildDevelopment(decision, perception) {
  /** @type {PlanPhase[]} */
  const beats = []
  const depth = decision.responseDepth
  const maxBeats = depth === 'minimal' ? 1 : depth === 'light' ? 2 : depth === 'deep' ? 4 : 3

  const push = (kind, purpose) => {
    if (beats.length >= maxBeats) return
    beats.push(phase('development', kind, purpose))
  }

  switch (decision.strategy) {
    case 'close':
      push('closure_line', 'One short farewell / completion beat; no new agenda.')
      break
    case 'recover':
      push(
        'adjust_behavior',
        'State the concrete adjustment for this reply (less robotic / fewer questions / etc.).',
      )
      push('resume_light', 'Offer a light continuation only if it does not reopen conflict.')
      break
    case 'support':
      push('validate', 'Validate the feeling without minimizing or diagnosing.')
      if (depth !== 'minimal') {
        push(
          'steady_presence',
          'Offer steady presence or one gentle grounding observation; no lecture.',
        )
      }
      break
    case 'celebrate':
      push('amplify', 'Amplify what went well with specificity; avoid generic praise.')
      break
    case 'connect':
      push(
        'presence_contribution',
        'Contribute one pleasant conversational offer (observation / seed), not an interview.',
      )
      break
    case 'continue':
      push(
        'advance_thread',
        'Advance the same idea one meaningful layer deeper.',
      )
      if (depth === 'balanced' || depth === 'deep') {
        push(
          'connective_tissue',
          'Add one connection, example, or implication that keeps momentum.',
        )
      }
      if (depth === 'deep') {
        push(
          'memorable_edge',
          'Optionally add a reflective edge without changing topic.',
        )
      }
      break
    case 'explain':
      push('core_idea', 'State the core idea in plain language first.')
      push('why_it_matters', 'Explain why it matters or how it works at the next layer.')
      if (depth === 'balanced' || depth === 'deep') {
        push(
          'example',
          'Give one concrete example calibrated to knowledge level.',
        )
      }
      if (depth === 'deep') {
        push(
          'common_pitfall',
          'Mention one common pitfall or nuance; do not dump an encyclopedia.',
        )
      }
      break
    case 'guide':
      push('diagnose_light', 'Identify the likely blocker in one tight beat.')
      push('next_step', 'Give one clear next step the user can take.')
      if (depth === 'balanced' || depth === 'deep') {
        push(
          'fallback',
          'Provide one fallback if the first step fails.',
        )
      }
      if (depth === 'deep' && decision.shouldChallenge) {
        push(
          'respectful_reframe',
          'Offer one respectful reframe/challenge that helps thinking; no aggression.',
        )
      }
      break
    case 'explore':
      push('chosen_direction', 'Name the single chosen direction explicitly.')
      push('first_development', 'Develop that direction immediately with substance.')
      if (depth === 'deep') {
        push('branch_hint', 'Hint one adjacent path without forcing a choice menu.')
      }
      break
    case 'entertain':
      push('story_or_bit', 'Deliver the entertaining bit / mini-story / fun angle.')
      break
    case 'answer':
    default:
      push('direct_substance', 'Deliver the main informational substance.')
      if (depth === 'balanced' || depth === 'deep') {
        push('clarify_or_context', 'Add brief clarifying context if it raises usefulness.')
      }
      if (depth === 'deep') {
        push('implication', 'Add one implication or practical takeaway.')
      }
      break
  }

  // Teaching overlay (only if Mind asked) — insert as early development if missing
  if (decision.shouldTeach && !beats.some((b) => b.kind === 'core_idea')) {
    beats.unshift(
      phase(
        'development',
        'progressive_teach',
        'Teach progressively (idea → why → example); do not dump everything at once.',
      ),
    )
    while (beats.length > maxBeats) beats.pop()
  }

  // Challenge beat if strategy didn't already include it and Mind allowed it
  if (
    decision.shouldChallenge &&
    !decision.shouldComfort &&
    !beats.some((b) => b.kind === 'respectful_reframe') &&
    decision.strategy !== 'support' &&
    decision.strategy !== 'close' &&
    decision.strategy !== 'recover'
  ) {
    push(
      'respectful_reframe',
      'Include one respectful challenge/reframe aligned to the goal.',
    )
  }

  // Knowledge level is context for purpose labels only — not a new decision
  if (
    decision.shouldTeach &&
    perception.knowledgeLevel === 'beginner' &&
    beats.some((b) => b.kind === 'example' || b.kind === 'progressive_teach')
  ) {
    // annotate via an extra light beat only if room
    push(
      'simple_language',
      'Keep terminology accessible for a beginner without being condescending.',
    )
  }

  if (beats.length === 0) {
    beats.push(
      phase('development', 'direct_substance', 'Deliver the main substance of the turn.'),
    )
  }

  return beats.slice(0, maxBeats)
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ReturnType<typeof normalize>['perception']} perception
 * @param {WriterCoda} coda
 * @returns {string[]}
 */
function buildMust(decision, perception, coda) {
  /** @type {string[]} */
  const must = []

  must.push(`Follow strategy="${decision.strategy}" and need="${decision.need}".`)
  must.push(`Use emotional tone="${decision.emotionalTone}".`)
  must.push(`Target response depth="${decision.responseDepth}".`)
  must.push(`Write in language="${perception.language}" (sticky unless meta-language turn).`)

  if (decision.shouldContinueTopic) {
    must.push('Continue the current topic; do not reset the conversation.')
  }
  if (decision.shouldComfort) {
    must.push('Prioritize emotional recognition before help or information.')
  }
  if (decision.shouldTeach) {
    must.push('Teach progressively; prefer one clear layer over an encyclopedia dump.')
  }
  if (decision.shouldChallenge) {
    must.push('Include at most one respectful challenge/reframe.')
  }
  if (decision.shouldUseMemory) {
    must.push('If memory facts are provided upstream, weave at most one soft callback.')
  }
  if (coda === 'question') {
    must.push('End with exactly one question that moves the thread; no stacked questions.')
  }
  if (coda === 'insight') {
    must.push('End with one insight; do not end with a question.')
  }
  if (coda === 'spark') {
    must.push('Land with one spark of initiative; do not ask the user to pick a topic.')
  }
  if (coda === 'direction') {
    must.push('Commit to one direction and start it; do not outsource the choice.')
  }
  if (coda === 'none') {
    must.push('Do not force a closing question.')
  }
  if (perception.knowledgeLevel && perception.knowledgeLevel !== 'unknown') {
    must.push(`Calibrate complexity to knowledgeLevel="${perception.knowledgeLevel}".`)
  }
  if (decision.strategy === 'recover') {
    must.push('Acknowledge feedback and adapt immediately without defensiveness.')
  }
  if (decision.strategy === 'close') {
    must.push('Allow the conversation to end cleanly.')
  }

  return must
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {WriterCoda} coda
 * @returns {string[]}
 */
function buildMustNot(decision, coda) {
  /** @type {string[]} */
  const mustNot = [
    'Do not mention engines, plans, scores, or internal modules.',
    'Do not invent memories or tool results.',
    'Do not use helpdesk openers like "How can I help?" / "Dimmi pure." unless truly necessary.',
  ]

  if (!decision.shouldAskQuestion || coda !== 'question') {
    mustNot.push('Do not ask a question.')
  }
  if (coda === 'question') {
    mustNot.push('Do not ask more than one question.')
  }
  if (!decision.shouldTeach) {
    mustNot.push('Do not switch into unsolicited lecture/teaching mode.')
  }
  if (!decision.shouldChallenge) {
    mustNot.push('Do not challenge or push back aggressively.')
  }
  if (decision.shouldComfort) {
    mustNot.push('Do not minimize feelings or rush to fix.')
    mustNot.push('Do not challenge the user in this turn.')
  }
  if (!decision.shouldUseMemory) {
    mustNot.push('Do not force personal-memory callbacks.')
  }
  if (!decision.shouldContinueTopic) {
    mustNot.push('Do not pretend a prior topic must continue if none was selected.')
  }
  if (decision.strategy === 'connect' || decision.strategy === 'celebrate') {
    mustNot.push('Do not open an interview loop.')
  }
  if (decision.strategy === 'close') {
    mustNot.push('Do not reopen a new agenda after farewell.')
  }
  if (decision.initiative === 'none' && !decision.shouldAskQuestion) {
    mustNot.push('Do not add an extra initiative coda.')
  }

  return mustNot
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @returns {string[]}
 */
function buildConstraints(decision) {
  /** @type {string[]} */
  const c = [`strategy:${decision.strategy}`, `need:${decision.need}`]

  c.push(decision.shouldAskQuestion ? 'ask_question:yes' : 'ask_question:no')
  c.push(decision.shouldTeach ? 'teach:yes' : 'teach:no')
  c.push(decision.shouldComfort ? 'comfort:yes' : 'comfort:no')
  c.push(decision.shouldChallenge ? 'challenge:yes' : 'challenge:no')
  c.push(decision.shouldContinueTopic ? 'continue_topic:yes' : 'continue_topic:no')
  c.push(decision.shouldUseMemory ? 'use_memory:yes' : 'use_memory:no')
  c.push(`initiative:${decision.initiative}`)
  c.push(`depth:${decision.responseDepth}`)
  c.push(`tone:${decision.emotionalTone}`)

  if (decision.shouldComfort) c.push('hard:no_challenge_with_comfort')
  if (!decision.shouldAskQuestion) c.push('hard:no_question')
  if (decision.strategy === 'close') c.push('hard:no_reopen')

  return c
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {WriterCoda} coda
 * @returns {string}
 */
function buildMoveSummary(decision, coda) {
  return [
    `strategy=${decision.strategy}`,
    `need=${decision.need}`,
    `coda=${coda}`,
    decision.shouldContinueTopic ? 'continue_topic' : 'topic_flexible',
    decision.shouldTeach ? 'teach' : null,
    decision.shouldComfort ? 'comfort' : null,
    decision.shouldChallenge ? 'challenge' : null,
  ]
    .filter(Boolean)
    .join(' | ')
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @returns {'omit'|'weave_soft'|'allowed'}
 */
function memoryHint(decision) {
  if (!decision.shouldUseMemory) return 'omit'
  if (decision.shouldContinueTopic || decision.strategy === 'continue') return 'weave_soft'
  return 'allowed'
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @returns {number}
 */
function computeConfidence(ctx) {
  let c = 0.35 + ctx.decision.confidence * 0.55
  if (!ctx.decision.goal) c -= 0.05
  if (!STRATEGIES.has(ctx.decision.strategy)) c -= 0.1
  // Reward consistency of known invariants already on the decision
  if (ctx.decision.shouldComfort && ctx.decision.shouldChallenge) c -= 0.25
  if (ctx.decision.shouldAskQuestion && ctx.decision.initiative !== 'none') {
    // Planner will collapse coda to question; slight confidence note only
    c -= 0.02
  }
  c += Math.min(0.08, ctx.perception.confidence * 0.08)
  return Number(Math.max(0.15, Math.min(0.98, c)).toFixed(3))
}

/**
 * Build a concrete plan from Perception + Mind Decision.
 * Pure. No I/O. No new decisions.
 *
 * @param {PlannerInput} [input]
 * @returns {PlannerPlan}
 */
export function plan(input = {}) {
  const ctx = normalize(input)
  const { perception, decision } = ctx
  const coda = resolveCoda(decision)

  const opening = buildOpening(decision)
  const development = buildDevelopment(decision, perception)
  const closing = closingFromCoda(coda)

  /** @type {ConversationPlan} */
  const conversationPlan = {
    opening,
    development,
    closing,
    lengthBand: /** @type {ConversationPlan['lengthBand']} */ (decision.responseDepth),
    beatCount: 1 + development.length + 1,
  }

  /** @type {WriterBrief} */
  const writerBrief = {
    language: perception.language,
    tone: decision.emotionalTone,
    depth: decision.responseDepth,
    strategy: decision.strategy,
    need: decision.need,
    moveSummary: buildMoveSummary(decision, coda),
    must: buildMust(decision, perception, coda),
    mustNot: buildMustNot(decision, coda),
    coda,
    memoryHint: memoryHint(decision),
    teaching: decision.shouldTeach,
    comfort: decision.shouldComfort,
    challenge: decision.shouldComfort ? false : decision.shouldChallenge,
    continueTopic: decision.shouldContinueTopic,
  }

  const constraints = buildConstraints(decision)

  // objective prefers Mind goal; always machine-oriented
  const objective = decision.goal || `${decision.strategy}__need_${decision.need}`

  return {
    objective,
    conversationPlan,
    writerBrief,
    constraints,
    confidence: computeConfidence(ctx),
  }
}

/**
 * Flatten writerBrief into a single instructions string (helper for future Writer).
 * Pure. Does not call models.
 *
 * @param {PlannerPlan|WriterBrief} planOrBrief
 * @returns {string}
 */
export function formatWriterBrief(planOrBrief) {
  const brief =
    planOrBrief &&
    typeof planOrBrief === 'object' &&
    'writerBrief' in /** @type {object} */ (planOrBrief)
      ? /** @type {PlannerPlan} */ (planOrBrief).writerBrief
      : /** @type {WriterBrief} */ (planOrBrief)

  if (!brief || typeof brief !== 'object') return ''

  const lines = [
    'WRITER BRIEF (execute; do not renegotiate)',
    `language=${brief.language}; tone=${brief.tone}; depth=${brief.depth}`,
    `strategy=${brief.strategy}; need=${brief.need}; coda=${brief.coda}`,
    `move: ${brief.moveSummary}`,
    `memoryHint=${brief.memoryHint}; teaching=${brief.teaching}; comfort=${brief.comfort}; challenge=${brief.challenge}; continueTopic=${brief.continueTopic}`,
    'MUST:',
    ...((brief.must || []).map((m) => `- ${m}`)),
    'MUST NOT:',
    ...((brief.mustNot || []).map((m) => `- ${m}`)),
  ]
  return lines.join('\n')
}

/**
 * @param {unknown} value
 * @returns {value is PlannerPlan}
 */
export function isPlannerPlan(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {Record<string, unknown>} */ (value)
  const cp = v.conversationPlan
  const wb = v.writerBrief
  return (
    typeof v.objective === 'string' &&
    cp != null &&
    typeof cp === 'object' &&
    wb != null &&
    typeof wb === 'object' &&
    Array.isArray(v.constraints) &&
    typeof v.confidence === 'number'
  )
}
