/**
 * LAIfe V2 — Adaptive Response Profile (Phase 4 + Phase 6)
 *
 * Derives HOW LAIfe should communicate this turn from Perception,
 * Conversation State, Conversation Signals, and soft preference modes.
 *
 * Mind owns primary inference.
 * Planner may constrain (never change WHAT).
 * Writer consumes the final profile — does not re-infer conflicting values.
 *
 * Shared turn cues come from Conversation Signals (not duplicated regex).
 *
 * Deterministic. No LLM. No Memory V2. No personality learning.
 */

import {
  deriveConversationSignals,
  isConversationSignals,
  WHAT_IS_RE,
} from './conversation-signals.js'

export const ADAPTIVE_RESPONSE_PROFILE_VERSION = '1.1.0-adaptive-response'

/**
 * @typedef {object} ToneDimensions
 * @property {number} warmth 0..1
 * @property {number} formality 0..1
 * @property {number} humor 0..1
 * @property {number} directness 0..1
 * @property {number} technicality 0..1
 */

/**
 * @typedef {'short'|'normal'|'detailed'|'expert'} AdaptiveDepth
 */

/**
 * @typedef {'minimal'|'short'|'medium'|'long'} AdaptiveVerbosity
 */

/**
 * @typedef {'low'|'medium'|'high'} AdaptiveEnergy
 */

/**
 * @typedef {'none'|'rare'|'occasional'} EmojiPolicy
 */

/**
 * @typedef {object} AdaptiveResponseProfile
 * @property {ToneDimensions} tone
 * @property {AdaptiveDepth} depth
 * @property {AdaptiveVerbosity} verbosity
 * @property {AdaptiveEnergy} energy
 * @property {EmojiPolicy} emojiPolicy
 * @property {string[]} [signals] diagnostic inference signals (not user-facing)
 * @property {string} [version]
 */

/**
 * Soft static modes from client personalization (bias only).
 * @typedef {object} AdaptivePreferences
 * @property {string} [personalityBias] automatic|friendly|professional|teacher|analytical|motivational
 * @property {string} [personality] alias of personalityBias
 * @property {'concise'|'balanced'|'detailed'|string} [replyLength]
 * @property {boolean} [useEmojis]
 * @property {string} [customInstructions]
 * @property {string} [displayName]
 */

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
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
export function clamp01(n, min = 0, max = 1) {
  const x = Number(n)
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
}

/**
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(clamp01(n) * 100) / 100
}

/**
 * @param {ToneDimensions} tone
 * @returns {ToneDimensions}
 */
function normalizeTone(tone) {
  return {
    warmth: round2(tone.warmth),
    formality: round2(tone.formality),
    humor: round2(tone.humor),
    directness: round2(tone.directness),
    technicality: round2(tone.technicality),
  }
}

/**
 * Map legacy Mind depth → adaptive depth.
 * @param {string} depth
 * @returns {AdaptiveDepth}
 */
export function mapMindDepthToAdaptive(depth) {
  const d = asString(depth)
  if (d === 'minimal' || d === 'light') return 'short'
  if (d === 'deep') return 'detailed'
  return 'normal'
}

/**
 * Map adaptive depth → Writer/Mind depth band (compat).
 * @param {AdaptiveDepth} depth
 * @returns {'minimal'|'light'|'balanced'|'deep'}
 */
export function mapAdaptiveDepthToMind(depth) {
  if (depth === 'short') return 'light'
  if (depth === 'detailed') return 'deep'
  if (depth === 'expert') return 'deep'
  return 'balanced'
}

/**
 * Soft baselines from static user modes.
 * @param {AdaptivePreferences} prefs
 * @returns {{ tone: Partial<ToneDimensions>, depthBias: number, verbosityCap: AdaptiveVerbosity|null, verbosityFloor: AdaptiveVerbosity|null, signals: string[] }}
 */
export function modeBaselines(prefs = {}) {
  const bias = asString(prefs.personalityBias || prefs.personality || 'automatic').toLowerCase()
  const length = asString(prefs.replyLength || 'balanced').toLowerCase()
  /** @type {string[]} */
  const signals = []
  /** @type {Partial<ToneDimensions>} */
  const tone = {}
  let depthBias = 0
  /** @type {AdaptiveVerbosity|null} */
  let verbosityCap = null
  /** @type {AdaptiveVerbosity|null} */
  let verbosityFloor = null

  if (bias === 'friendly') {
    tone.warmth = 0.2
    tone.formality = -0.1
    signals.push('mode:friendly')
  } else if (bias === 'professional') {
    tone.formality = 0.25
    tone.humor = -0.2
    tone.warmth = -0.05
    signals.push('mode:professional')
  } else if (bias === 'teacher') {
    tone.technicality = 0.1
    tone.directness = 0.05
    depthBias += 0.15
    signals.push('mode:teacher')
  } else if (bias === 'analytical') {
    tone.directness = 0.15
    tone.technicality = 0.1
    tone.humor = -0.1
    signals.push('mode:analytical')
  } else if (bias === 'motivational') {
    tone.warmth = 0.1
    signals.push('mode:motivational')
  }

  if (length === 'concise' || length === 'short') {
    verbosityCap = 'short'
    signals.push('mode:replyLength=concise')
  } else if (length === 'detailed') {
    verbosityFloor = 'medium'
    depthBias += 0.2
    signals.push('mode:replyLength=detailed')
  }

  return { tone, depthBias, verbosityCap, verbosityFloor, signals }
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} [weight] how much prior pulls (0..1)
 */
function stabilize(a, b, weight = 0.35) {
  if (!Number.isFinite(b)) return a
  return a * (1 - weight) + b * weight
}

/**
 * Rank verbosity for min/max ops.
 * @param {AdaptiveVerbosity} v
 * @returns {number}
 */
function verbosityRank(v) {
  if (v === 'minimal') return 0
  if (v === 'short') return 1
  if (v === 'medium') return 2
  return 3
}

/**
 * @param {AdaptiveVerbosity} a
 * @param {AdaptiveVerbosity} b
 * @returns {AdaptiveVerbosity}
 */
function minVerbosity(a, b) {
  return verbosityRank(a) <= verbosityRank(b) ? a : b
}

/**
 * @param {AdaptiveVerbosity} a
 * @param {AdaptiveVerbosity} b
 * @returns {AdaptiveVerbosity}
 */
function maxVerbosity(a, b) {
  return verbosityRank(a) >= verbosityRank(b) ? a : b
}

/**
 * Build adaptive response profile for this turn.
 *
 * @param {{
 *   perception?: object,
 *   conversationState?: object|null,
 *   conversationSignals?: import('./conversation-signals.js').ConversationSignals|null,
 *   userMessage?: string,
 *   preferences?: AdaptivePreferences|null,
 *   previousProfile?: AdaptiveResponseProfile|null,
 *   mindDepth?: string,
 *   mindTone?: string,
 *   strategy?: string,
 * }} [input]
 * @returns {AdaptiveResponseProfile}
 */
export function buildAdaptiveResponseProfile(input = {}) {
  const perception =
    input.perception && typeof input.perception === 'object' ? input.perception : {}
  const state =
    input.conversationState && typeof input.conversationState === 'object'
      ? input.conversationState
      : null
  const prefs =
    input.preferences && typeof input.preferences === 'object' ? input.preferences : {}
  const previous =
    input.previousProfile && typeof input.previousProfile === 'object'
      ? input.previousProfile
      : state?.responseProfile && typeof state.responseProfile === 'object'
        ? state.responseProfile
        : null

  const userText = asString(input.userMessage).replace(/\s+/g, ' ').trim()
  const mode = asString(state?.conversationMode || '')
  const phase = asString(state?.conversationPhase || '')
  const engagement = asString(state?.engagement || '')
  const goal = asString(state?.activeGoal || '')
  const intent = asString(perception.intent || '')
  const emotional = asString(perception.emotionalState || '')
  const knowledge = asString(perception.knowledgeLevel || '')
  const strategy = asString(input.strategy || '')

  // Phase 6: consume shared Conversation Signals (derive fail-soft if absent).
  const turnSignals = isConversationSignals(input.conversationSignals)
    ? input.conversationSignals
    : deriveConversationSignals({
        userMessage: userText,
        perception,
        preferences: prefs,
        previousConversationState: state,
        freeze: true,
      })

  /** @type {string[]} */
  const signals = []

  // Defaults
  let warmth = 0.45
  let formality = 0.35
  let humor = 0.15
  let directness = 0.5
  let technicality = 0.35
  /** @type {AdaptiveDepth} */
  let depth = mapMindDepthToAdaptive(input.mindDepth || 'balanced')
  /** @type {AdaptiveVerbosity} */
  let verbosity = 'medium'
  /** @type {AdaptiveEnergy} */
  let energy = 'medium'

  // Conversation State / goal / mode
  if (goal === 'casual_exploration' || intent === 'boredom' || turnSignals.affect.boredom >= 0.55) {
    warmth = 0.75
    formality = 0.15
    energy = 'high'
    depth = 'short'
    verbosity = 'medium'
    humor = 0.35
    signals.push('state:casual_exploration')
  }

  if (mode === 'social' || intent === 'small_talk' || intent === 'companionship') {
    warmth = Math.max(warmth, 0.65)
    formality = Math.min(formality, 0.25)
    signals.push('mode:social')
  }

  if (mode === 'learning' || goal === 'learning' || intent === 'learning' || strategy === 'explain') {
    technicality = Math.max(technicality, 0.55)
    directness = Math.max(directness, 0.55)
    depth = depth === 'short' ? 'normal' : depth
    signals.push('mode:learning')
  }

  if (mode === 'debugging' || goal === 'debugging' || intent === 'problem_solving' || strategy === 'guide') {
    directness = Math.max(directness, 0.75)
    humor = Math.min(humor, 0.1)
    formality = Math.max(formality, 0.4)
    verbosity = verbosityRank(verbosity) > 2 ? 'medium' : verbosity
    signals.push('mode:debugging')
  }

  if (goal === 'task_execution' || mode === 'planning') {
    directness = Math.max(directness, 0.7)
    warmth = Math.min(warmth, 0.4)
    humor = Math.min(humor, 0.08)
    signals.push('goal:task')
  }

  if (engagement === 'high' || turnSignals.engagement.activeFollowUp) {
    energy = energy === 'low' ? 'medium' : 'high'
    signals.push('engagement:high')
  } else if (engagement === 'low') {
    if (turnSignals.affect.boredom < 0.55 && intent !== 'boredom') {
      energy = 'low'
      signals.push('engagement:low')
    }
  }

  if (phase === 'deepening' || phase === 'executing') {
    if (depth === 'short') depth = 'normal'
    signals.push('phase:deepening')
  }

  if (phase === 'closing' || turnSignals.interaction.stopCue) {
    verbosity = 'minimal'
    energy = 'low'
    warmth = Math.max(warmth, 0.5)
    signals.push('phase:closing')
  }

  // Knowledge / beginner vs expert (style cues from Signals)
  if (knowledge === 'beginner' || turnSignals.style.wantsSimple) {
    technicality = Math.min(technicality, 0.25)
    depth = depth === 'expert' ? 'normal' : depth === 'detailed' ? 'normal' : depth
    signals.push('cue:simple')
  }
  if (knowledge === 'expert' || knowledge === 'advanced') {
    technicality = Math.max(technicality, 0.7)
    if (depth === 'short' || depth === 'normal') depth = 'detailed'
    signals.push('knowledge:expert')
  }

  // What-is questions → normal depth (task-specific pattern retained)
  if (WHAT_IS_RE.test(userText) && userText.length < 80) {
    depth = 'normal'
    technicality = Math.min(Math.max(technicality, 0.35), 0.55)
    verbosity = 'short'
    signals.push('cue:what_is')
  }

  // Expert / technical style cue
  if (turnSignals.style.wantsTechnical) {
    technicality = Math.max(technicality, 0.85)
    depth = 'expert'
    directness = Math.max(directness, 0.7)
    humor = Math.min(humor, 0.1)
    signals.push('cue:expert_technical')
  }

  // Explicit length overrides (always win over modes)
  if (turnSignals.style.wantsBrief) {
    verbosity = 'minimal'
    if (!turnSignals.style.wantsDetailed) {
      if (WHAT_IS_RE.test(userText)) depth = 'normal'
    }
    signals.push('cue:explicit_short')
  }
  if (turnSignals.style.wantsDetailed) {
    depth = depth === 'expert' ? 'expert' : 'detailed'
    verbosity = verbosityRank(verbosity) < 2 ? 'medium' : 'long'
    signals.push('cue:explicit_detailed')
  }

  // Excitement / calm / casual from Signals
  if (
    turnSignals.affect.excitement >= 0.45 ||
    turnSignals.affect.playfulness >= 0.45 ||
    emotional === 'playful' ||
    emotional === 'excited'
  ) {
    formality = Math.min(formality, 0.2)
    energy = 'high'
    humor = Math.max(humor, 0.45)
    warmth = Math.max(warmth, 0.6)
    signals.push('cue:excitement')
  }
  if (turnSignals.style.wantsCalm) {
    energy = 'low'
    humor = Math.min(humor, 0.15)
    signals.push('cue:calm')
  }
  if (turnSignals.style.wantsCasual) {
    formality = Math.min(formality, 0.2)
    warmth = Math.max(warmth, 0.6)
    signals.push('cue:casual')
  }

  // Professional context
  if (turnSignals.style.wantsProfessional) {
    formality = Math.max(formality, 0.7)
    humor = Math.min(humor, 0.05)
    warmth = Math.min(warmth, 0.45)
    signals.push('cue:professional')
  }

  // Serious / distressed
  if (
    turnSignals.affect.seriousness >= 0.45 ||
    turnSignals.affect.frustration >= 0.55 ||
    emotional === 'sad' ||
    emotional === 'anxious' ||
    emotional === 'frustrated' ||
    intent === 'emotional_support'
  ) {
    humor = 0
    warmth = Math.max(warmth, 0.7)
    energy = 'low'
    formality = Math.min(formality, 0.4)
    signals.push('cue:sensitive')
  }

  // Factual / direct questions
  if (
    intent === 'curiosity' ||
    (turnSignals.interaction.explicitQuestion && turnSignals.affect.excitement < 0.45)
  ) {
    directness = Math.max(directness, 0.6)
    signals.push('cue:question')
  }

  // Apply soft mode baselines (do not override explicit cues)
  const baselines = modeBaselines(prefs)
  signals.push(...baselines.signals)
  if (baselines.tone.warmth) warmth = clamp01(warmth + baselines.tone.warmth)
  if (baselines.tone.formality) formality = clamp01(formality + baselines.tone.formality)
  if (baselines.tone.humor) humor = clamp01(humor + baselines.tone.humor)
  if (baselines.tone.directness) directness = clamp01(directness + baselines.tone.directness)
  if (baselines.tone.technicality) {
    technicality = clamp01(technicality + baselines.tone.technicality)
  }
  if (baselines.depthBias > 0 && depth === 'short') depth = 'normal'
  if (baselines.depthBias > 0.15 && depth === 'normal' && !turnSignals.style.wantsBrief) {
    depth = 'detailed'
  }

  // Explicit short overrides mode detailed floor
  if (turnSignals.style.wantsBrief) {
    verbosity = 'minimal'
  } else {
    if (baselines.verbosityCap) verbosity = minVerbosity(verbosity, baselines.verbosityCap)
    if (baselines.verbosityFloor) verbosity = maxVerbosity(verbosity, baselines.verbosityFloor)
  }

  // Soft stabilize from previous profile (unless hard cue turn)
  const hardShift =
    turnSignals.style.wantsBrief ||
    turnSignals.style.wantsDetailed ||
    turnSignals.style.wantsTechnical ||
    turnSignals.style.wantsProfessional ||
    turnSignals.style.wantsSimple ||
    turnSignals.affect.excitement >= 0.45
  if (previous?.tone && !hardShift) {
    warmth = stabilize(warmth, previous.tone.warmth, 0.3)
    formality = stabilize(formality, previous.tone.formality, 0.3)
    humor = stabilize(humor, previous.tone.humor, 0.25)
    directness = stabilize(directness, previous.tone.directness, 0.25)
    technicality = stabilize(technicality, previous.tone.technicality, 0.25)
    signals.push('stabilize:previous_profile')
  } else if (hardShift) {
    signals.push('override:hard_cue_no_stabilize')
  }

  // Emoji policy
  /** @type {EmojiPolicy} */
  let emojiPolicy = 'rare'
  const useEmojis = prefs.useEmojis !== false
  if (turnSignals.style.allowsEmojis === false || !useEmojis) {
    emojiPolicy = 'none'
    signals.push('emoji:disabled')
  } else if (
    turnSignals.style.wantsProfessional ||
    formality >= 0.65 ||
    technicality >= 0.75
  ) {
    emojiPolicy = 'none'
  } else if (
    turnSignals.affect.seriousness >= 0.45 ||
    emotional === 'sad' ||
    emotional === 'anxious' ||
    intent === 'emotional_support'
  ) {
    emojiPolicy = 'none'
  } else if (turnSignals.style.allowsEmojis === true) {
    emojiPolicy = 'occasional'
  } else if (
    energy === 'high' &&
    formality < 0.35 &&
    (mode === 'social' || turnSignals.affect.excitement >= 0.45)
  ) {
    emojiPolicy = 'occasional'
  } else {
    emojiPolicy = 'rare'
  }

  // Passive / stop → minimal
  if (
    state?.shortReply?.intent === 'passive_acknowledgement' ||
    state?.shortReply?.intent === 'stop' ||
    state?.shortReply?.intent === 'decline_proposal'
  ) {
    verbosity = 'minimal'
    depth = 'short'
    signals.push('short_reply:minimal')
  }

  return {
    tone: normalizeTone({ warmth, formality, humor, directness, technicality }),
    depth,
    verbosity,
    energy,
    emojiPolicy,
    signals: signals.slice(0, 16),
    version: ADAPTIVE_RESPONSE_PROFILE_VERSION,
  }
}

/**
 * Planner constraints on an adaptive profile (task-shaped caps).
 * Does not change conversationalMove / objective.
 *
 * @param {AdaptiveResponseProfile} profile
 * @param {{
 *   strategy?: string,
 *   conversationalMove?: string,
 *   conversationMode?: string,
 *   activeGoal?: string,
 *   forceMinimalAck?: boolean,
 * }} [ctx]
 * @returns {AdaptiveResponseProfile}
 */
export function constrainAdaptiveResponseProfile(profile, ctx = {}) {
  if (!profile || typeof profile !== 'object') {
    return buildAdaptiveResponseProfile({})
  }
  const tone = { ...profile.tone }
  let depth = profile.depth
  let verbosity = profile.verbosity
  let energy = profile.energy
  let emojiPolicy = profile.emojiPolicy
  /** @type {string[]} */
  const signals = [...(profile.signals || []), 'planner_constrain']

  const strategy = asString(ctx.strategy)
  const move = asString(ctx.conversationalMove)
  const mode = asString(ctx.conversationMode)
  const goal = asString(ctx.activeGoal)

  if (strategy === 'guide' || mode === 'debugging' || goal === 'debugging') {
    tone.directness = Math.max(tone.directness, 0.65)
    tone.humor = Math.min(tone.humor, 0.15)
    if (verbosityRank(verbosity) > 2) verbosity = 'medium'
    signals.push('constrain:debugging')
  }

  if (strategy === 'explore' || goal === 'casual_exploration' || mode === 'social') {
    tone.warmth = Math.max(tone.warmth, 0.55)
    if (energy === 'low') energy = 'medium'
    signals.push('constrain:explore')
  }

  if (ctx.forceMinimalAck || move === 'passive_acknowledgement' || move === 'stop') {
    verbosity = 'minimal'
    depth = 'short'
    emojiPolicy = 'none'
    signals.push('constrain:minimal_move')
  }

  if (move === 'execute_pending_proposal' || move === 'continue_topic') {
    // Keep enough room to deliver content
    if (verbosity === 'minimal') verbosity = 'short'
    signals.push('constrain:execute_continue')
  }

  return {
    tone: normalizeTone(tone),
    depth,
    verbosity,
    energy,
    emojiPolicy,
    signals: signals.slice(0, 20),
    version: ADAPTIVE_RESPONSE_PROFILE_VERSION,
  }
}

/**
 * Format profile into Writer instruction block (influence generation, no fixed phrases).
 * @param {AdaptiveResponseProfile|null|undefined} profile
 * @returns {string}
 */
export function formatAdaptiveResponseProfileForWriter(profile) {
  if (!profile || typeof profile !== 'object' || !profile.tone) return ''
  const t = profile.tone
  const lines = [
    'ADAPTIVE RESPONSE PROFILE (HOW — do not change WHAT / conversationalMove / shouldAskQuestion):',
    `tone: warmth=${t.warmth}; formality=${t.formality}; humor=${t.humor}; directness=${t.directness}; technicality=${t.technicality}`,
    `depth=${profile.depth}; verbosity=${profile.verbosity}; energy=${profile.energy}; emojiPolicy=${profile.emojiPolicy}`,
    '',
    'Interpretation (guidelines, not templates):',
  ]

  if (t.warmth >= 0.6) {
    lines.push('- Warmth high: natural, human phrasing; never stock empathy openers.')
  } else if (t.warmth <= 0.35) {
    lines.push('- Warmth low: stay clear and matter-of-fact; skip cozy padding.')
  }

  if (t.formality >= 0.6) {
    lines.push('- Formality high: precise, composed wording; avoid slang and playful asides.')
  } else if (t.formality <= 0.3) {
    lines.push('- Formality low: conversational register is fine.')
  }

  if (t.humor >= 0.4) {
    lines.push('- Humor allowed: subtle only; never force a joke.')
  } else {
    lines.push('- Humor low/off: do not joke.')
  }

  if (t.directness >= 0.65) {
    lines.push('- Directness high: answer first; no preamble.')
  }

  if (t.technicality >= 0.7) {
    lines.push('- Technicality high: use precise terms; less simplification.')
  } else if (t.technicality <= 0.3) {
    lines.push('- Technicality low: prefer plain language.')
  }

  if (profile.depth === 'expert' || profile.depth === 'detailed') {
    lines.push(`- Depth ${profile.depth}: cover the substance the user asked for.`)
  } else if (profile.depth === 'short') {
    lines.push('- Depth short: one clear idea; do not lecture.')
  }

  if (profile.verbosity === 'minimal' || profile.verbosity === 'short') {
    lines.push(`- Verbosity ${profile.verbosity}: compact; no unnecessary padding.`)
  } else if (profile.verbosity === 'long') {
    lines.push('- Verbosity long: room to develop, still coherent.')
  }

  if (profile.energy === 'high') {
    lines.push('- Energy high: lively rhythm; not exaggerated; not spammy.')
  } else if (profile.energy === 'low') {
    lines.push('- Energy low: calm pacing; fewer embellishments.')
  }

  if (profile.emojiPolicy === 'none') {
    lines.push('- Emoji: none.')
  } else if (profile.emojiPolicy === 'occasional') {
    lines.push('- Emoji: at most one, only if it feels natural; never required.')
  } else {
    lines.push('- Emoji: rare; usually none.')
  }

  lines.push(
    '',
    'ANTI-TEMPLATE: Do not open with stock phrases like "Capisco.", "Certamente.", "Va bene.", "Perfetto.", "Assolutamente." when used mechanically.',
    'Never invent a follow-up question unless shouldAskQuestion=true on the Planner contract.',
  )

  return lines.join('\n')
}

/**
 * Sanitize profile for persistence / debug (no signals required).
 * @param {AdaptiveResponseProfile|null|undefined} profile
 * @returns {object|null}
 */
export function serializeAdaptiveResponseProfile(profile) {
  if (!profile || typeof profile !== 'object' || !profile.tone) return null
  return {
    tone: normalizeTone(profile.tone),
    depth: profile.depth,
    verbosity: profile.verbosity,
    energy: profile.energy,
    emojiPolicy: profile.emojiPolicy,
    version: ADAPTIVE_RESPONSE_PROFILE_VERSION,
  }
}

/**
 * @param {unknown} value
 * @returns {value is AdaptiveResponseProfile}
 */
export function isAdaptiveResponseProfile(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return (
    v.tone &&
    typeof v.tone === 'object' &&
    typeof v.tone.warmth === 'number' &&
    typeof v.depth === 'string' &&
    typeof v.verbosity === 'string' &&
    typeof v.energy === 'string'
  )
}
