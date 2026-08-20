/**
 * #324 — Conversation State MVP (Core only).
 *
 * Cheap deterministic turn-level signals injected as a compact appendix into the
 * SAME OpenAI request. No second LLM, no Cognitive/V1/V2, no Memory persistence.
 *
 * Soft presentation guidance — never overrides safety, truth, or capabilities.
 */

export const CONVERSATION_STATE_BUILD = '327-1'
/** #326 style-variety build tag (session-only fingerprints + STYLE_AVOID). */
export const STYLE_VARIETY_BUILD = '326-1'
/** #327 momentum policy build (NRP section; no new schema field). */
export const CONVERSATION_MOMENTUM_BUILD = '327-1'

/** Soft cap for appendix size (chars). Target ~200–400 tokens ≈ ≤1600 chars. */
export const CONVERSATION_STATE_APPENDIX_MAX_CHARS = 1600

/** Soft cap for RECENT STYLE — SOFT AVOID block (#326). */
export const STYLE_AVOID_APPENDIX_MAX_CHARS = 600

/** Bounded recent history for heuristics (user+assistant turns). */
export const CONVERSATION_STATE_RECENT_TURNS = 8

/** @type {Readonly<{ openings: number, acknowledgements: number, firstPhrases: number, endings: number, emojis: number, structures: number }>} */
export const SESSION_STYLE_CAPS = Object.freeze({
  openings: 4,
  acknowledgements: 4,
  firstPhrases: 4,
  endings: 4,
  emojis: 8,
  structures: 3,
})

/** @typedef {'casual'|'informational'|'teaching'|'problem_solving'|'debugging'|'brainstorming'|'decision_support'|'celebration'|'emotional_support'|'quick_answer'} ConversationMode */
/** @typedef {'answer'|'explain'|'react'|'clarify'|'recommend'|'brainstorm'|'comfort'|'continue'} ResponsePurpose */
/** @typedef {'short'|'medium'|'detailed'} DesiredDepth */
/** @typedef {'neutral'|'excited'|'frustrated'|'playful'|'serious'|'curious'|'celebratory'} EmotionalTone */
/** @typedef {'none'|'light'|'moderate'|'expressive'} EmojiLevel */
/** @typedef {'low'|'normal'|'high'} InitiativeLevel */
/** @typedef {'prose'|'light_structure'|'structured'} StructurePreference */
/** @typedef {'low'|'medium'|'high'} ConfidenceLevel */

/**
 * @typedef {{
 *   conversationMode: ConversationMode
 *   responsePurpose: ResponsePurpose
 *   desiredDepth: DesiredDepth
 *   emotionalTone: EmotionalTone
 *   emojiLevel: EmojiLevel
 *   initiativeLevel: InitiativeLevel
 *   questionNeeded: boolean
 *   acknowledgementNeeded: boolean
 *   structurePreference: StructurePreference
 *   confidence: ConfidenceLevel
 *   explicitOverrides: string[]
 *   recentTurnCount: number
 * }} ConversationState
 */

/**
 * Session-only style fingerprints (#326). Never Memory / Supabase.
 *
 * @typedef {{
 *   lastResponseLengthBucket: 'short'|'medium'|'long'|null
 *   lastEndingWasQuestion: boolean|null
 *   recentOpeningTypes: string[]
 *   recentAcknowledgementTypes: string[]
 *   recentFirstPhrases: string[]
 *   recentEndingTypes: string[]
 *   recentEmojis: string[]
 *   recentStructureTypes: string[]
 * }} SessionStyleState
 */

/**
 * @typedef {{
 *   role?: string
 *   content?: string
 * }} ConversationStateMessage
 */

/**
 * @typedef {{
 *   userMessage?: string
 *   recentMessages?: ConversationStateMessage[]
 *   settings?: {
 *     replyLength?: string|null
 *     useEmojis?: boolean|null
 *   }
 *   workingState?: { activeTask?: string, decisions?: string[], constraints?: string[] } | null
 *   sessionStyle?: SessionStyleState | null
 * }} ComputeConversationStateInput
 */

export function createEmptySessionStyleState() {
  return {
    lastResponseLengthBucket: null,
    lastEndingWasQuestion: null,
    recentOpeningTypes: [],
    recentAcknowledgementTypes: [],
    recentFirstPhrases: [],
    recentEndingTypes: [],
    recentEmojis: [],
    recentStructureTypes: [],
  }
}

/**
 * Sanitize client-provided sessionStyle (caps + type coercion). Never trusts oversized arrays.
 * @param {unknown} raw
 * @returns {SessionStyleState}
 */
export function sanitizeSessionStyleState(raw) {
  const empty = createEmptySessionStyleState()
  if (!raw || typeof raw !== 'object') return empty
  const o = /** @type {Record<string, unknown>} */ (raw)

  const bucket = o.lastResponseLengthBucket
  const lastResponseLengthBucket =
    bucket === 'short' || bucket === 'medium' || bucket === 'long' ? bucket : null

  let lastEndingWasQuestion = null
  if (typeof o.lastEndingWasQuestion === 'boolean') {
    lastEndingWasQuestion = o.lastEndingWasQuestion
  }

  return {
    lastResponseLengthBucket,
    lastEndingWasQuestion,
    recentOpeningTypes: sanitizeStringList(o.recentOpeningTypes, SESSION_STYLE_CAPS.openings, 32),
    recentAcknowledgementTypes: sanitizeStringList(
      o.recentAcknowledgementTypes,
      SESSION_STYLE_CAPS.acknowledgements,
      24,
    ),
    recentFirstPhrases: sanitizeStringList(
      o.recentFirstPhrases,
      SESSION_STYLE_CAPS.firstPhrases,
      48,
    ),
    recentEndingTypes: sanitizeStringList(o.recentEndingTypes, SESSION_STYLE_CAPS.endings, 24),
    recentEmojis: sanitizeStringList(o.recentEmojis, SESSION_STYLE_CAPS.emojis, 8),
    recentStructureTypes: sanitizeStringList(
      o.recentStructureTypes,
      SESSION_STYLE_CAPS.structures,
      16,
    ),
  }
}

/**
 * Normalized first-phrase fingerprint (first 4–6 words). No embeddings.
 * @param {string} text
 * @returns {string}
 */
export function normalizeFirstPhraseFingerprint(text) {
  let t = String(text || '')
  // Drop leading emoji / pictographs
  t = t.replace(/^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\s)+/u, '')
  t = t
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[*_`#>[\]()"'«»„“”]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  const words = t.split(' ').filter(Boolean).slice(0, 6)
  return words.slice(0, Math.min(6, Math.max(4, words.length))).join(' ').slice(0, 48)
}

/**
 * @param {string} text
 * @returns {'clean_stop'|'question'|'service_offer'|'recommendation'|'next_step'|'reaction'}
 */
export function classifyEndingType(text) {
  const raw = String(text || '').trim()
  if (!raw) return 'clean_stop'
  const tail = raw.slice(-220)
  if (
    /\b(?:vuoi\s+che|se\s+vuoi\s+posso|posso\s+anche|would\s+you\s+like|want\s+me\s+to|i\s+can\s+also)\b/i.test(
      tail,
    )
  ) {
    return 'service_offer'
  }
  if (/\?\s*$/.test(raw)) return 'question'
  if (
    /\b(?:ti\s+consiglio|io\s+sceglierei|sceglierei|consiglio|i\s+(?:would\s+)?(?:recommend|choose|pick)|go\s+with)\b/i.test(
      tail,
    )
  ) {
    return 'recommendation'
  }
  if (
    /\b(?:prossimo\s+passo|next\s+step|prova\s+a|try\s+to|inizia\s+da|start\s+by|poi\s+fai)\b/i.test(
      tail,
    )
  ) {
    return 'next_step'
  }
  if (
    raw.length < 80 &&
    (/^\p{Extended_Pictographic}/u.test(raw) ||
      /\b(?:grande|yes+|yess+|finalmente|ce\s+l['']abbiamo|ottimo|fantastico)\b/i.test(raw))
  ) {
    return 'reaction'
  }
  return 'clean_stop'
}

/**
 * @param {string} text
 * @returns {'prose'|'list'|'headings'|'mixed'}
 */
export function classifyStructureType(text) {
  const raw = String(text || '')
  const hasList = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S/.test(raw)
  const hasHeadings = /(?:^|\n)\s{0,3}#{1,3}\s+\S/.test(raw) || /(?:^|\n)\*\*[^*]{2,40}\*\*\s*\n/.test(raw)
  if (hasList && hasHeadings) return 'mixed'
  if (hasList) return 'list'
  if (hasHeadings) return 'headings'
  return 'prose'
}

/**
 * Collect fingerprints from a successful Core assistant reply (#326).
 * @param {string} assistantText
 * @param {SessionStyleState | null | undefined} [prev]
 * @returns {SessionStyleState}
 */
export function collectSessionStyleFingerprints(assistantText, prev) {
  const base = sanitizeSessionStyleState(prev)
  const text = String(assistantText || '').trim()
  if (!text) return base

  const len = text.length
  const lastResponseLengthBucket = len < 120 ? 'short' : len < 600 ? 'medium' : 'long'
  const lastEndingWasQuestion = /\?\s*$/.test(text)

  const firstLine = text.split(/\n/)[0] || text
  const opening = classifyOpeningType(firstLine)
  const ack = classifyAcknowledgementType(firstLine)
  const firstPhrase = normalizeFirstPhraseFingerprint(firstLine)
  const ending = classifyEndingType(text)
  const structure = classifyStructureType(text)
  const emojis = extractEmojis(text).slice(0, 4)

  return {
    lastResponseLengthBucket,
    lastEndingWasQuestion,
    recentOpeningTypes: pushCap(base.recentOpeningTypes, opening, SESSION_STYLE_CAPS.openings),
    recentAcknowledgementTypes: ack
      ? pushCap(base.recentAcknowledgementTypes, ack, SESSION_STYLE_CAPS.acknowledgements)
      : base.recentAcknowledgementTypes.slice(-SESSION_STYLE_CAPS.acknowledgements),
    recentFirstPhrases: firstPhrase
      ? pushCap(base.recentFirstPhrases, firstPhrase, SESSION_STYLE_CAPS.firstPhrases)
      : base.recentFirstPhrases.slice(-SESSION_STYLE_CAPS.firstPhrases),
    recentEndingTypes: pushCap(base.recentEndingTypes, ending, SESSION_STYLE_CAPS.endings),
    recentEmojis: mergeRecentEmojis(base.recentEmojis, emojis, SESSION_STYLE_CAPS.emojis),
    recentStructureTypes: pushCap(
      base.recentStructureTypes,
      structure,
      SESSION_STYLE_CAPS.structures,
    ),
  }
}

/**
 * Drop the last Core fingerprint contribution (regenerate replace semantics).
 * Emoji rollback is approximate (up to 3 trailing codepoints).
 * @param {SessionStyleState | null | undefined} prev
 * @returns {SessionStyleState}
 */
export function rollbackLastSessionStyleFingerprint(prev) {
  const base = sanitizeSessionStyleState(prev)
  const endings = base.recentEndingTypes.slice(0, -1)
  return {
    lastResponseLengthBucket: null,
    lastEndingWasQuestion: endings.length ? endings[endings.length - 1] === 'question' : null,
    recentOpeningTypes: base.recentOpeningTypes.slice(0, -1),
    recentAcknowledgementTypes: base.recentAcknowledgementTypes.slice(0, -1),
    recentFirstPhrases: base.recentFirstPhrases.slice(0, -1),
    recentEndingTypes: endings,
    recentEmojis: base.recentEmojis.slice(0, Math.max(0, base.recentEmojis.length - 3)),
    recentStructureTypes: base.recentStructureTypes.slice(0, -1),
  }
}

/**
 * Compact RECENT STYLE — SOFT AVOID block for Core instructions.
 * @param {SessionStyleState | null | undefined} sessionStyle
 * @param {ConversationState | null | undefined} [state]
 * @returns {string}
 */
export function buildStyleAvoidAppendix(sessionStyle, state = null) {
  const style = sanitizeSessionStyleState(sessionStyle)
  const hasAny =
    style.recentOpeningTypes.length > 0 ||
    style.recentAcknowledgementTypes.length > 0 ||
    style.recentFirstPhrases.length > 0 ||
    style.recentEndingTypes.length > 0 ||
    style.recentEmojis.length > 0 ||
    style.recentStructureTypes.length > 0 ||
    style.lastResponseLengthBucket != null

  if (!hasAny) return ''

  const lines = ['RECENT STYLE — SOFT AVOID', '']

  if (style.recentFirstPhrases.length) {
    lines.push(`recent_openings: ${style.recentFirstPhrases.slice(-3).join(' | ')}`)
  }
  if (style.recentOpeningTypes.length) {
    lines.push(`opening_types: ${uniqTail(style.recentOpeningTypes, 3).join(', ')}`)
  }
  if (style.recentAcknowledgementTypes.length) {
    lines.push(`recent_acks: ${uniqTail(style.recentAcknowledgementTypes, 3).join(', ')}`)
  }
  if (style.recentEmojis.length) {
    lines.push(`recent_emojis: ${uniqTail(style.recentEmojis, 4).join(' ')}`)
  }
  if (style.recentEndingTypes.length) {
    lines.push(`recent_endings: ${uniqTail(style.recentEndingTypes, 3).join(', ')}`)
  }
  if (style.recentStructureTypes.length) {
    lines.push(`recent_structure: ${uniqTail(style.recentStructureTypes, 2).join(', ')}`)
  }
  if (style.lastResponseLengthBucket) {
    lines.push(`last_length: ${style.lastResponseLengthBucket}`)
  }

  const questionNeeded = state && state.questionNeeded === true
  const recentQuestions =
    style.lastEndingWasQuestion === true ||
    style.recentEndingTypes.filter((e) => e === 'question').length >= 1

  lines.push('')
  lines.push(
    'GUIDANCE: Soft-avoid repeating these when an equally natural alternative exists. Never force novelty. Emotion, explicit user instruction, desiredDepth, and structurePreference win. Repetition OK when clearest.',
  )
  if (!questionNeeded && recentQuestions) {
    lines.push(
      'Stronger: recent replies ended with questions and question_needed=false — avoid another trailing/reciprocal question unless clarification is required.',
    )
  }

  let out = lines.join('\n')
  if (out.length > STYLE_AVOID_APPENDIX_MAX_CHARS) {
    out = out.slice(0, STYLE_AVOID_APPENDIX_MAX_CHARS - 1).trimEnd()
  }
  return out
}

/**
 * @param {SessionStyleState | null | undefined} sessionStyle
 * @param {{ styleAvoidChars?: number|null, sessionStyleReceived?: boolean }} [opts]
 */
export function buildStyleVarietyDiagPayload(sessionStyle, opts = {}) {
  const style = sanitizeSessionStyleState(sessionStyle)
  return {
    diagBuild: STYLE_VARIETY_BUILD,
    route: 'style-variety',
    phase: 'style-variety',
    timestamp: new Date().toISOString(),
    sessionStyleReceived: opts.sessionStyleReceived === true,
    recentOpeningCount: style.recentOpeningTypes.length,
    recentAckCount: style.recentAcknowledgementTypes.length,
    recentFirstPhraseCount: style.recentFirstPhrases.length,
    recentEndingCount: style.recentEndingTypes.length,
    recentEmojiCount: style.recentEmojis.length,
    recentStructureCount: style.recentStructureTypes.length,
    lastLengthBucket: style.lastResponseLengthBucket,
    lastEndingWasQuestion: style.lastEndingWasQuestion,
    styleAvoidChars: typeof opts.styleAvoidChars === 'number' ? opts.styleAvoidChars : null,
    responseSource: 'core',
  }
}

/**
 * @param {ComputeConversationStateInput} input
 * @returns {ConversationState}
 */
export function computeConversationState(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {}
  const recent = selectRecentMessages(input.recentMessages || [], CONVERSATION_STATE_RECENT_TURNS)
  const latestFromRecent = [...recent].reverse().find((m) => m.role === 'user')
  const rawUser =
    typeof input.userMessage === 'string' && input.userMessage.trim()
      ? input.userMessage
      : typeof latestFromRecent?.content === 'string'
        ? latestFromRecent.content
        : ''
  const userMessage = normalizeText(rawUser)
  const overrides = detectExplicitOverrides(userMessage)

  const stopDecline = looksLikeStopDecline(userMessage)
  const continueCue = looksLikeContinueCue(userMessage)
  const completionCue = looksLikeCompletionCue(userMessage) && !continueCue
  const decisionSignal = looksLikeBinaryChoice(userMessage)
  const shortFollowUp = isShortFollowUp(userMessage) || continueCue
  const priorMode = inferPriorModeFromHistory(recent)
  const isCorrection = looksLikeCorrection(userMessage)
  const isTechnicalContext = looksTechnicalContext(recent, input.workingState)

  let conversationMode = inferConversationMode(userMessage, {
    shortFollowUp,
    priorMode,
    isCorrection,
    isTechnicalContext,
    workingState: input.workingState || null,
    stopDecline,
    continueCue,
  })

  let responsePurpose = inferResponsePurpose(userMessage, conversationMode, {
    isCorrection,
    shortFollowUp,
    continueCue,
    stopDecline,
    completionCue,
  })

  let emotionalTone = inferEmotionalTone(userMessage, conversationMode)
  let desiredDepth = inferDesiredDepth(userMessage, conversationMode, settings, overrides)
  let emojiLevel = inferEmojiLevel(conversationMode, emotionalTone, settings, overrides)
  let initiativeLevel = inferInitiativeLevel(conversationMode, responsePurpose, {
    stopDecline,
    emotionalTone,
  })
  let structurePreference = inferStructurePreference(
    userMessage,
    conversationMode,
    overrides,
  )
  let questionNeeded = inferQuestionNeeded(userMessage, conversationMode, responsePurpose, {
    isCorrection,
    overrides,
    stopDecline,
  })
  let acknowledgementNeeded = inferAcknowledgementNeeded(
    userMessage,
    conversationMode,
    responsePurpose,
    { isCorrection, emotionalTone, stopDecline },
  )
  let confidence = inferConfidence(conversationMode, responsePurpose, userMessage)

  // Explicit overrides always win for style axes.
  if (overrides.desiredDepth) desiredDepth = overrides.desiredDepth
  if (overrides.emojiLevel) emojiLevel = overrides.emojiLevel
  if (overrides.structurePreference) structurePreference = overrides.structurePreference
  if (overrides.forceTeaching) {
    conversationMode = 'teaching'
    if (responsePurpose === 'answer' || responsePurpose === 'react') {
      responsePurpose = 'explain'
    }
  }
  // Depth/simplify on an active teaching thread → keep teaching (#327).
  if (
    !stopDecline &&
    (priorMode === 'teaching' || priorMode === 'informational') &&
    (overrides.desiredDepth ||
      overrides.forceTeaching ||
      /\b(spiega(?:melo|lo|mi)?|dettagliat\w*|semplice|eli5|in\s+detail|keep\s+it\s+simple)\b/i.test(
        userMessage,
      ))
  ) {
    conversationMode = 'teaching'
    if (responsePurpose === 'answer' || responsePurpose === 'react') {
      responsePurpose = 'explain'
    }
  }
  if (overrides.forceShort) {
    desiredDepth = 'short'
    if (structurePreference === 'structured' && !overrides.structurePreference) {
      structurePreference = 'prose'
    }
  }

  // Correction bias (after mode infer, before return).
  if (isCorrection) {
    responsePurpose = 'continue'
    acknowledgementNeeded = true
    if (!overrides.desiredDepth) {
      desiredDepth = desiredDepth === 'detailed' ? 'medium' : 'short'
    }
    if (!overrides.forceInteractive) questionNeeded = false
  }

  // Explicit stop / decline: acknowledge briefly if natural and STOP (#327).
  if (stopDecline) {
    conversationMode = conversationMode === 'emotional_support' ? conversationMode : 'casual'
    responsePurpose = 'react'
    initiativeLevel = 'low'
    questionNeeded = false
    acknowledgementNeeded = true
    desiredDepth = 'short'
    if (!overrides.structurePreference) structurePreference = 'prose'
  }

  // Soft completion: do not invent another workflow.
  if (completionCue && !stopDecline) {
    if (initiativeLevel === 'high') initiativeLevel = 'normal'
    questionNeeded = false
    if (!overrides.desiredDepth && desiredDepth === 'detailed') desiredDepth = 'medium'
    if (responsePurpose === 'brainstorm' || responsePurpose === 'clarify') {
      responsePurpose = 'react'
    }
  }

  // Active-thread short follow-ups keep at least normal initiative.
  if (
    !stopDecline &&
    shortFollowUp &&
    priorMode &&
    conversationMode === priorMode &&
    ['brainstorming', 'debugging', 'teaching', 'decision_support'].includes(conversationMode)
  ) {
    if (initiativeLevel === 'low') initiativeLevel = 'normal'
  }

  // Celebration / frustration pacing.
  if (emotionalTone === 'celebratory' || conversationMode === 'celebration') {
    if (initiativeLevel === 'high') initiativeLevel = 'normal'
    questionNeeded = false
  }
  if (emotionalTone === 'frustrated' && conversationMode === 'debugging') {
    acknowledgementNeeded = true
    if (initiativeLevel === 'high') initiativeLevel = 'normal'
  }

  const priorModeInherited =
    Boolean(priorMode) &&
    conversationMode === priorMode &&
    !stopDecline &&
    (shortFollowUp ||
      continueCue ||
      overrides.forceTeaching ||
      Boolean(overrides.desiredDepth))

  return {
    conversationMode,
    responsePurpose,
    desiredDepth,
    emotionalTone,
    emojiLevel,
    initiativeLevel,
    questionNeeded,
    acknowledgementNeeded,
    structurePreference,
    confidence,
    explicitOverrides: overrides.labels,
    recentTurnCount: recent.length,
    // Ephemeral diagnostics only — not printed in CONVERSATION STATE appendix.
    shortFollowUpDetected: shortFollowUp,
    stopSignalDetected: stopDecline,
    decisionSignalDetected: decisionSignal || conversationMode === 'decision_support',
    priorModeInherited,
    continueCueDetected: continueCue,
    completionCueDetected: Boolean(completionCue && !stopDecline),
  }
}

/**
 * Compact appendix for Core instructions (~200–400 tokens).
 *
 * @param {ConversationState} state
 * @returns {string}
 */
export function buildConversationStateAppendix(state) {
  if (!state || typeof state !== 'object') return ''

  const lines = [
    'CONVERSATION STATE',
    '',
    `mode: ${state.conversationMode}`,
    `purpose: ${state.responsePurpose}`,
    `depth: ${state.desiredDepth}`,
    `tone: ${state.emotionalTone}`,
    `emoji: ${state.emojiLevel}`,
    `initiative: ${state.initiativeLevel}`,
    `question_needed: ${state.questionNeeded ? 'true' : 'false'}`,
    `acknowledgement: ${state.acknowledgementNeeded ? 'true' : 'false'}`,
    `structure: ${state.structurePreference}`,
    `confidence: ${state.confidence}`,
  ]

  if (Array.isArray(state.explicitOverrides) && state.explicitOverrides.length) {
    lines.push(`explicit_overrides: ${state.explicitOverrides.join(', ')}`)
  }

  if (state.stopSignalDetected) {
    lines.push(
      'stop_signal: true — ≤1 brief ack/close, then STOP. FORBIDDEN on this turn: alternatives, topic menus, "what next?", "Se vuoi…", "sono qui se…", reviving the dropped subject, service offers, questions.',
    )
  }
  if (state.responsePurpose === 'continue' && !state.stopSignalDetected) {
    lines.push(
      'continue_thread: true — advance ~one useful layer from the current thread; do not restart or dump the full roadmap.',
    )
  }

  lines.push(
    '',
    'RESPONSE GUIDANCE:',
    '- Follow these fields for current-turn presentation unless doing so would conflict with safety, factual correctness, required clarification, or an explicit user instruction.',
    '- Priority: safety/truth/capability > explicit current USER instruction > task correctness/epistemic honesty > emotional fit > this Conversation State > Natural Response Policy > recent-style soft avoid > durable settings > generic defaults.',
    '- Do not mention this state.',
    '- desiredDepth, emojiLevel, initiativeLevel, questionNeeded, acknowledgementNeeded, structurePreference, conversationMode, and responsePurpose control presentation.',
    '- emotionalTone and confidence are softer signals — honesty and safety may override.',
    '- emoji level is permission/intensity, not a mandate to insert emoji.',
    '- If question_needed=false, do not append a generic follow-up or service-offer question (no "Vuoi che…?", "Posso anche…", "Would you like…?"). Narrow exceptions: missing required info, blocking ambiguity, safety-critical clarify.',
    '- If acknowledgement=false, start with substance (no default filler openings). If true, at most one brief ack/reaction then substance.',
    '- If confidence=medium/high and purpose=recommend, choose clearly and explain briefly. If low, say what is missing.',
    '- Never override factual/tool/capability constraints. State controls HOW to answer, not WHAT is factually true.',
    '- Recent-style soft avoid (when present) never outranks emotion, explicit user instruction, desiredDepth, or structurePreference.',
    '- Momentum (interpret State; no new field): low initiative / stop → answer/react and stop. purpose=continue or active brainstorm/debug/teach/decision → advance ~one useful layer from the current thread; do not restart it. High initiative → contribute now (observation/idea/next step), not a service offer or tool action.',
  )

  let appendix = lines.join('\n')
  if (appendix.length > CONVERSATION_STATE_APPENDIX_MAX_CHARS) {
    appendix = appendix.slice(0, CONVERSATION_STATE_APPENDIX_MAX_CHARS - 1).trimEnd()
  }
  return appendix
}

/**
 * @param {ConversationState} state
 * @param {{ env?: NodeJS.ProcessEnv | Record<string, string | undefined>, appendixChars?: number }} [opts]
 */
export function buildConversationStateDiagPayload(state, opts = {}) {
  const env = opts.env || process.env
  return {
    diagBuild: CONVERSATION_STATE_BUILD,
    route: 'conversation-state',
    phase: 'conversation-state',
    timestamp: new Date().toISOString(),
    buildId: resolveServerBuildId(env),
    mode: state.conversationMode,
    purpose: state.responsePurpose,
    depth: state.desiredDepth,
    emotionalTone: state.emotionalTone,
    emojiLevel: state.emojiLevel,
    initiativeLevel: state.initiativeLevel,
    questionNeeded: state.questionNeeded,
    acknowledgementNeeded: state.acknowledgementNeeded,
    structurePreference: state.structurePreference,
    confidence: state.confidence,
    explicitOverrides: Array.isArray(state.explicitOverrides)
      ? state.explicitOverrides.slice(0, 12)
      : [],
    recentTurnCount: state.recentTurnCount,
    shortFollowUpDetected: Boolean(state.shortFollowUpDetected),
    stopSignalDetected: Boolean(state.stopSignalDetected),
    decisionSignalDetected: Boolean(state.decisionSignalDetected),
    priorModeInherited: Boolean(state.priorModeInherited),
    continueCueDetected: Boolean(state.continueCueDetected),
    completionCueDetected: Boolean(state.completionCueDetected),
    momentumBuild: CONVERSATION_MOMENTUM_BUILD,
    appendixChars:
      typeof opts.appendixChars === 'number' ? opts.appendixChars : null,
  }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isConversationStateDiagEnvAllowed(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (v === 'preview' || v === 'development') return true
  if (
    env.CONVERSATION_STATE_DIAG === '1' ||
    env.CONVERSATION_STATE_DIAG === 'true'
  ) {
    return true
  }
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any, url?: string }} req
 * @param {Record<string, unknown>} [body]
 */
export function isConversationStateDiagRequested(req, body) {
  try {
    const h = req?.headers || {}
    const header =
      h['x-shinkaido-conversation-state-diag'] ||
      h['X-Shinkaido-Conversation-State-Diag']
    if (header === '1' || header === 'true') return true
  } catch {
    /* soft */
  }
  try {
    const url = typeof req?.url === 'string' ? req.url : ''
    if (
      /[?&]conversation_state_diag=1(?:&|$)/i.test(url) ||
      /[?&]conversation_state_diag=true(?:&|$)/i.test(url)
    ) {
      return true
    }
  } catch {
    /* soft */
  }
  if (
    body &&
    (body.conversationStateDiag === true ||
      body.conversationStateDiag === 1 ||
      body.conversationStateDiag === '1')
  ) {
    return true
  }
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any, url?: string }} req
 * @param {Record<string, unknown>} [body]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isConversationStateDiagEnabled(req, body, env = process.env) {
  return (
    isConversationStateDiagEnvAllowed(env) &&
    isConversationStateDiagRequested(req, body)
  )
}

// —— internals ——

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
function resolveServerBuildId(env) {
  const sha =
    typeof env.VERCEL_GIT_COMMIT_SHA === 'string'
      ? env.VERCEL_GIT_COMMIT_SHA.trim()
      : ''
  if (sha) return sha.slice(0, 7)
  if (typeof env.VITE_BUILD_ID === 'string' && env.VITE_BUILD_ID.trim()) {
    return env.VITE_BUILD_ID.trim()
  }
  return 'dev'
}

/** @param {string} text */
function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ConversationStateMessage[]} messages
 * @param {number} maxTurns
 */
function selectRecentMessages(messages, maxTurns) {
  const list = Array.isArray(messages) ? messages : []
  const cleaned = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    }))
  if (cleaned.length <= maxTurns) return cleaned
  return cleaned.slice(-maxTurns)
}

/** @param {string} text */
function isShortFollowUp(text) {
  if (looksLikeContinueCue(text)) return true
  const t = normalizeText(String(text || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 48) return false
  return /^(ok|okay|ok\.|va\s*bene|s[iì]|si+|no|nope|esatto|certo|perfetto|grazie|thanks|thank\s*you|perch[eé]\??|come\??|quello|quella|l['']altro|l['']altra|il\s*primo|il\s*secondo|la\s*prima|la\s*seconda|mm+|ahm+|ah+|ahah+|lol|haha+|yep|yeah|yes|that\s*one|the\s*other)[.!?…]*$/i.test(
    t,
  )
}

/**
 * Explicit continue / deepen cues (#327).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeContinueCue(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 48) return false
  return /^(continua(?:\s+pure)?|continuiamo|vai(?:\s+avanti)?|avanti|e\s*poi\??|poi\??|ancora\??|dimmi\s+altro|approfondisci|prosegui|go(?:\s+on)?|continue|keep\s+going|and\s+then\??|more|tell\s+me\s+more|next)[.!?…]*$/i.test(
    t,
  )
}

/**
 * Hard conversational stop / decline (#327).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeStopDecline(message) {
  const t = normalizeText(message)
  if (!t || t.length > 72) return false
  // Bare no/nope = soft decline of current direction (not a general negation mid-sentence).
  if (/^(no|nope)[.!]*$/i.test(t)) return true
  // "basta così" is completion, not hard stop — handled by looksLikeCompletionCue.
  return /^(basta(?:\s+con\s+(?:questo|cos[iì]))?|lascia(?:mo)?\s+stare|niente(?:\s+altro)?|non\s+importa|non\s+mi\s+interessa|cambiamo\s+argomento|parliamo\s+d['']altro|chiudiamola\s+qui|passiamo\s+oltre|stop|never\s+mind|leave\s+it|forget\s+it|let'?s\s+move\s+on|change\s+topic|enough|drop\s+it|that'?s\s+enough)[.!]*$/i.test(
    t,
  )
}

/**
 * Lightweight completion cue (conservative).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeCompletionCue(message) {
  const t = normalizeText(message)
  if (!t || t.length > 40) return false
  // Conservative: bare "funziona" only — celebration phrases handled separately.
  return /^(fatto|risolto|funziona|ok\s+cos[iì]|basta\s+cos[iì]|ci\s+siamo|done|all\s+good|that'?s\s+it)[.!]*$/i.test(
    t,
  )
}

/**
 * Binary / comparative choice → decision_support (#327).
 * Avoids bare boolean/logic operator noise.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeBinaryChoice(message) {
  const t = normalizeText(message)
  if (!t || t.length > 140) return false
  if (/^(true|false|yes|no|s[iì]|0|1)\s+(?:o|or)\s+(true|false|yes|no|s[iì]|0|1)\b/i.test(t)) {
    return false
  }
  if (/\b(?:and\/or|&&|\|\||[+\-*\/=]=)\b/.test(t)) return false
  if (
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,40})\s+(?:o|or|vs\.?|versus)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,40})\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(?:quale\s+(?:dei\s+due|scegl|prefer)|qual\s+[eè]\s+meglio|meglio\s+\S.{0,40}\s+o\s+|which\s+(?:one|should)|what\s+would\s+you\s+(?:choose|pick)|which\s+would\s+you\s+choose|sceglieresti)\b/i.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/** @param {string} text */
function looksLikeCorrection(text) {
  const t = normalizeText(text)
  if (!t) return false
  return /\b(?:no[,:]?\s+intendevo|non\s+hai\s+capito|non\s+[eè]\s+quello|dicevo\s+l['']altro|[eè]\s+sbagliato|hai\s+sbagliato|non\s+era\s+quello|I\s+meant\s+the\s+other|that'?s\s+not\s+what\s+I\s+meant|you\s+misunderstood|wrong(?:\s+one)?)\b/i.test(
    t,
  )
}

/**
 * @param {ConversationStateMessage[]} recent
 * @param {{ activeTask?: string } | null | undefined} workingState
 */
function looksTechnicalContext(recent, workingState) {
  if (workingState && workingState.activeTask) return true
  const blob = recent
    .slice(-6)
    .map((m) => m.content || '')
    .join('\n')
    .toLowerCase()
  return /\b(api|http|401|403|500|error|errore|bug|stack\s*trace|exception|undefined|null\s*pointer|typescript|javascript|python|docker|sql|oauth|endpoint|server|client|compile|runtime|log[s]?|debug|deploy|jwt|cors)\b/i.test(
    blob,
  )
}

/**
 * @param {ConversationStateMessage[]} recent
 * @returns {ConversationMode | null}
 */
function inferPriorModeFromHistory(recent) {
  const slice = recent.slice(-8)
  const blob = slice.map((m) => m.content || '').join('\n')
  // Prefer latest user substantive cues (scan newest first).
  for (let i = slice.length - 1; i >= 0; i--) {
    const m = slice[i]
    if (!m || m.role !== 'user') continue
    const c = normalizeText(m.content || '')
    if (!c || looksLikeContinueCue(c) || looksLikeStopDecline(c) || isShortFollowUp(c)) continue
    if (looksLikeBinaryChoice(c)) return 'decision_support'
    if (
      /\b(401|403|500|stack|exception|non\s+funziona|still\s+broken|stesso\s+errore|ancora\s+niente|bug|debug|api\s+restituisce)\b/i.test(
        c,
      )
    ) {
      return 'debugging'
    }
    if (
      /\b(idea|brainstorm|creare\s+(?:una?\s+|un['']?)?(?:nuova?\s+)?app|vorrei\s+creare|dammi\s+(?:qualche\s+)?idee?|give\s+me\s+(?:some\s+)?ideas)\b/i.test(
        c,
      )
    ) {
      return 'brainstorming'
    }
    if (
      /\b(cos[''][eè]\s+|che\s+cos[''][eè]|what\s+is\s+|spiega|spiegami|eli5|insegn|teach\s+me|come\s+funziona)\b/i.test(
        c,
      )
    ) {
      return 'teaching'
    }
    if (
      /\b(finalmente\s+funziona|ce\s+l['']abbiamo\s+fatta|we\s+did\s+it|it\s+works)\b/i.test(c)
    ) {
      return 'celebration'
    }
  }

  if (
    /\b(api|401|errore|error|bug|stack|exception|non\s+funziona|stesso\s+errore|debug)\b/i.test(blob)
  ) {
    return 'debugging'
  }
  if (
    /\b(idea|brainstorm|creare\s+(?:una?\s+|un['']?)?(?:nuova?\s+)?app|vorrei\s+creare|dammi\s+(?:qualche\s+)?idee?)\b/i.test(
      blob,
    )
  ) {
    return 'brainstorming'
  }
  if (/\b(spiega|spiegami|come\s+funziona|cos[''][eè]|what\s+is|lesson|insegn|eli5)\b/i.test(blob)) {
    return 'teaching'
  }
  if (looksLikeBinaryChoice(blob) || /\b(quale\s+scegl|meglio\s+tra|sceglieresti)\b/i.test(blob)) {
    return 'decision_support'
  }
  return null
}

/**
 * @param {string} userMessage
 * @param {{
 *   shortFollowUp: boolean
 *   priorMode: ConversationMode | null
 *   isCorrection: boolean
 *   isTechnicalContext: boolean
 *   workingState: { activeTask?: string } | null
 *   stopDecline?: boolean
 * }} ctx
 * @returns {ConversationMode}
 */
function inferConversationMode(userMessage, ctx) {
  const t = userMessage
  if (!t) return 'casual'

  if (ctx.stopDecline) return 'casual'

  if (ctx.isCorrection) {
    if (ctx.isTechnicalContext || ctx.priorMode === 'debugging') return 'debugging'
    if (ctx.priorMode) return ctx.priorMode
    return 'casual'
  }

  if (ctx.shortFollowUp) {
    if (ctx.priorMode) return ctx.priorMode
    if (ctx.isTechnicalContext) return 'debugging'
    if (/^(ahah+|haha+|lol|ahm+)/i.test(t)) return 'casual'
    if (looksLikeContinueCue(t) || ctx.continueCue) {
      return ctx.priorMode || (ctx.isTechnicalContext ? 'debugging' : 'casual')
    }
    return 'casual'
  }

  // Short pick / preference keeps an active decision or brainstorm thread (#327).
  if (
    ctx.priorMode === 'decision_support' &&
    t.length <= 48 &&
    (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{1,40}\.?$/i.test(t) ||
      /^(quella|quello|la\s+prima|la\s+seconda|il\s+primo|il\s+secondo|ok|va\s*bene)\.?$/i.test(t))
  ) {
    return 'decision_support'
  }
  if (
    ctx.priorMode === 'brainstorming' &&
    t.length <= 72 &&
    /\b(mi\s+piace|mi\s+piacciono|preferisco|scegliamo|andiamo\s+con|i\s+like|let'?s\s+go\s+with)\b/i.test(
      t,
    )
  ) {
    return 'brainstorming'
  }

  // Celebration before frustration when success language dominates.
  if (
    /\b(finalmente\s+funziona|ce\s+l['']abbiamo\s+fatta|we\s+did\s+it|it\s+works|madonna\s+che\s+figata|che\s+figata|yay+|woo+t?)\b/i.test(
      t,
    ) ||
    (/!{2,}/.test(t) &&
      /\b(funziona|works|fatto|done|riuscit|succeeded|figata|grande)\b/i.test(t))
  ) {
    return 'celebration'
  }

  // Debugging beats emotional_support for technical frustration.
  if (
    /\b(401|403|500|stack\s*trace|exception|typescript\s+error|compile\s+error|this\s+code|questo\s+codice|api\s+restituisce|endpoint|bug)\b/i.test(
      t,
    ) ||
    (ctx.isTechnicalContext &&
      /\b(non\s+funziona|still\s+broken|che\s+palle|di\s+nuovo|ancora|stesso\s+errore)\b/i.test(t))
  ) {
    return 'debugging'
  }

  if (
    /\b(non\s+funziona(?:\s+ancora)?|still\s+doesn'?t\s+work|errore|error|bug|debug|fixi|logs)\b/i.test(
      t,
    ) &&
    (ctx.isTechnicalContext ||
      /\b(api|codice|code|app|server|client|build|deploy)\b/i.test(t))
  ) {
    return 'debugging'
  }

  // Emotional support — conservative.
  if (
    /\b(mi\s+sento\s+(?:gi[uù]|male|solo|sola|perso|persa)|sono\s+gi[uù]|non\s+ce\s+la\s+faccio|ho\s+bisogno\s+di\s+parlare|i\s+feel\s+(?:sad|alone|lost|overwhelmed)|i'?m\s+(?:sad|depressed|lonely))\b/i.test(
      t,
    )
  ) {
    return 'emotional_support'
  }

  // #327 — binary/comparative choice before short-question quick_answer.
  if (looksLikeBinaryChoice(t)) {
    return 'decision_support'
  }

  if (
    /\b(quale\s+(?:dei\s+due|scegl|prefer)|qual\s+[eè]\s+meglio|which\s+(?:one|should)|what\s+would\s+you\s+(?:choose|pick)|sceglieresti)\b/i.test(
      t,
    )
  ) {
    return 'decision_support'
  }

  if (
    /\b(dammi\s+(?:qualche\s+)?idee?|che\s+idee\s+hai|brainstorm|vorrei\s+creare|let'?s\s+brainstorm|give\s+me\s+(?:some\s+)?ideas|idee\s+per)\b/i.test(
      t,
    )
  ) {
    return 'brainstorming'
  }

  if (
    /\b(spiegamelo\s+come\s+se|come\s+se\s+non\s+sapessi|fammi\s+capire\s+bene|teach\s+me|explain\s+(?:it\s+)?(?:like|as\s+if)|eli5|passo\s+passo\s+da\s+zero)\b/i.test(
      t,
    )
  ) {
    return 'teaching'
  }

  if (
    /\b(come\s+(?:posso|possiamo)\s+risolv|how\s+(?:can|do)\s+i\s+(?:fix|solve|resolve)|risolvere\s+questo\s+problema)\b/i.test(
      t,
    )
  ) {
    return 'problem_solving'
  }

  if (
    /\b(cos[''][eè]\s+|che\s+cos[''][eè]\s+|what\s+is\s+|what'?s\s+|define\s+|definizione\s+di)\b/i.test(
      t,
    )
  ) {
    return 'informational'
  }

  if (/\b(perch[eé]\s+(?:questa|questo|l['']|la\s+|il\s+)|why\s+(?:does|is|do)\b)/i.test(t)) {
    if (/\b(api|401|403|500|error|errore|bug|codice|code)\b/i.test(t) || ctx.isTechnicalContext) {
      return 'debugging'
    }
    return 'informational'
  }

  // Casual greetings / boredom / banter
  if (
    /^(ciao|hey|hi|hello|salve|yo|come\s+va\??|che\s+fai\??|come\s+stai\??|what'?s\s+up\??|how\s+are\s+you\??)[.!]*$/i.test(
      t,
    ) ||
    /\b(mi\s+annoio|i'?m\s+bored|che\s+noia)\b/i.test(t) ||
    /^(ahah+|haha+|lol|eheh+)[.!]*$/i.test(t)
  ) {
    return 'casual'
  }

  if (t.length <= 24 && !/[?]/.test(t) && !/\b(spiega|explain|come|how|why|perch)/i.test(t)) {
    return 'casual'
  }

  if (
    t.length <= 60 &&
    /\?$/.test(t) &&
    !looksLikeBinaryChoice(t) &&
    !/\b(spiega|explain|dettagl|confronta|compare)\b/i.test(t)
  ) {
    return 'quick_answer'
  }

  if (ctx.workingState?.activeTask) return 'problem_solving'

  return 'informational'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{
 *   isCorrection: boolean
 *   shortFollowUp: boolean
 *   continueCue?: boolean
 *   stopDecline?: boolean
 *   completionCue?: boolean
 * }} ctx
 * @returns {ResponsePurpose}
 */
function inferResponsePurpose(userMessage, mode, ctx) {
  if (ctx.stopDecline) return 'react'
  if (ctx.isCorrection) return 'continue'
  if (ctx.continueCue || (ctx.shortFollowUp && looksLikeContinueCue(userMessage))) {
    return 'continue'
  }
  if (ctx.completionCue) return 'react'
  if (ctx.shortFollowUp) {
    if (/^(continua|continuiamo|vai|avanti|e\s*poi|go|continue|next)/i.test(userMessage)) {
      return 'continue'
    }
    if (/^(perch|why|come\??|how\??)/i.test(userMessage)) return 'explain'
    if (/^(ahah|haha|lol|ok|s[iì]|esatto|yep|yeah)/i.test(userMessage)) return 'react'
    return 'continue'
  }

  // Short pick after a decision → continue the recommendation thread.
  if (mode === 'decision_support' && userMessage.length <= 48 && !looksLikeBinaryChoice(userMessage)) {
    return 'continue'
  }
  if (
    mode === 'brainstorming' &&
    /\b(mi\s+piace|mi\s+piacciono|preferisco|i\s+like)\b/i.test(userMessage)
  ) {
    return 'continue'
  }

  if (mode === 'celebration' || mode === 'casual') {
    if (/^(ciao|hey|hi|hello|come\s+va)/i.test(userMessage)) return 'react'
    if (/\bmi\s+annoio\b/i.test(userMessage)) return 'brainstorm'
    return 'react'
  }
  if (mode === 'emotional_support') return 'comfort'
  if (mode === 'brainstorming') return 'brainstorm'
  if (mode === 'decision_support') return 'recommend'
  if (mode === 'teaching' || mode === 'informational') return 'explain'
  if (mode === 'debugging' || mode === 'problem_solving') return 'continue'
  if (mode === 'quick_answer') return 'answer'
  if (/\b(chiaris|clarify|intendi|you\s+mean)\b/i.test(userMessage)) return 'clarify'
  return 'answer'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @returns {EmotionalTone}
 */
function inferEmotionalTone(userMessage, mode) {
  const t = userMessage
  if (mode === 'celebration') return 'celebratory'
  if (
    /!{2,}/.test(t) ||
    /\b(wow+|finalmente|figata|fantastico|amazing|awesome|yay+)\b/i.test(t)
  ) {
    return mode === 'celebration' ? 'celebratory' : 'excited'
  }
  if (
    /\b(che\s+palle|non\s+funziona|still\s+broken|frustrat|odio|damn|shit|cavolo)\b/i.test(t)
  ) {
    return 'frustrated'
  }
  if (/^(ahah+|haha+|lol|eheh+)/i.test(t) || /\b(ahah+|haha+|lol)\b/i.test(t)) {
    return 'playful'
  }
  if (
    /\b(seria(?:mente)?|serious(?:ly)?|importante|urgent|grave)\b/i.test(t) ||
    mode === 'emotional_support'
  ) {
    return mode === 'emotional_support' ? 'serious' : 'serious'
  }
  if (
    /\b(chiss[aà]|mi\s+chiedo|i\s+wonder|curious|curios[oa]?)\b/i.test(t) ||
    mode === 'brainstorming' ||
    mode === 'teaching'
  ) {
    if (mode === 'brainstorming' || mode === 'teaching') return 'curious'
  }
  return 'neutral'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{ replyLength?: string|null }} settings
 * @param {{ desiredDepth?: DesiredDepth|null, forceShort?: boolean }} overrides
 * @returns {DesiredDepth}
 */
function inferDesiredDepth(userMessage, mode, settings, overrides) {
  if (overrides.desiredDepth) return overrides.desiredDepth
  if (overrides.forceShort) return 'short'

  /** @type {DesiredDepth} */
  let depth = 'medium'
  switch (mode) {
    case 'casual':
    case 'celebration':
    case 'quick_answer':
      depth = 'short'
      break
    case 'teaching':
      depth = 'detailed'
      break
    case 'debugging':
    case 'problem_solving':
    case 'brainstorming':
    case 'decision_support':
    case 'informational':
      depth = 'medium'
      break
    case 'emotional_support':
      depth = 'medium'
      break
    default:
      depth = 'medium'
  }

  if (userMessage.length > 280 && depth === 'short') depth = 'medium'
  if (userMessage.length > 500 && (mode === 'debugging' || mode === 'teaching')) {
    depth = 'detailed'
  }

  // Soft preference from settings — never beats explicit override (already applied).
  const pref =
    typeof settings.replyLength === 'string'
      ? settings.replyLength.trim().toLowerCase()
      : ''
  if (pref === 'concise' && depth === 'detailed') depth = 'medium'
  if (pref === 'concise' && mode === 'casual') depth = 'short'
  if (pref === 'detailed' && depth === 'short' && mode !== 'casual' && mode !== 'celebration') {
    depth = 'medium'
  }
  if (pref === 'detailed' && (mode === 'teaching' || mode === 'informational')) {
    depth = 'detailed'
  }

  return depth
}

/**
 * @param {ConversationMode} mode
 * @param {EmotionalTone} tone
 * @param {{ useEmojis?: boolean|null }} settings
 * @param {{ emojiLevel?: EmojiLevel|null }} overrides
 * @returns {EmojiLevel}
 */
function inferEmojiLevel(mode, tone, settings, overrides) {
  if (overrides.emojiLevel) return overrides.emojiLevel
  if (settings.useEmojis === false) return 'none'

  if (mode === 'debugging' || mode === 'emotional_support') return 'light'
  if (mode === 'informational' || mode === 'quick_answer' || mode === 'teaching') return 'light'
  if (tone === 'serious') return 'none'
  if (tone === 'frustrated') return 'none'
  if (mode === 'celebration' || tone === 'celebratory' || tone === 'excited') {
    return 'expressive'
  }
  if (mode === 'casual' || mode === 'brainstorming') return 'moderate'
  if (settings.useEmojis === true && (mode === 'casual' || mode === 'celebration')) {
    return mode === 'celebration' ? 'expressive' : 'moderate'
  }
  return 'light'
}

/**
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {{ stopDecline?: boolean, emotionalTone?: EmotionalTone }} [ctx]
 * @returns {InitiativeLevel}
 */
function inferInitiativeLevel(mode, purpose, ctx = {}) {
  if (ctx.stopDecline) return 'low'
  if (mode === 'quick_answer' || mode === 'informational') return 'low'
  if (mode === 'brainstorming' || purpose === 'brainstorm') return 'high'
  if (mode === 'decision_support') return 'normal'
  if (mode === 'celebration') return 'low'
  if (mode === 'debugging' || mode === 'teaching' || mode === 'problem_solving') return 'normal'
  if (mode === 'casual' && purpose === 'brainstorm') return 'high'
  if (purpose === 'continue') return 'normal'
  return 'normal'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {{ isCorrection: boolean, overrides: { forceInteractive?: boolean } }} ctx
 */
function inferQuestionNeeded(userMessage, mode, purpose, ctx) {
  if (ctx.overrides.forceInteractive) return true
  if (ctx.stopDecline) return false
  if (ctx.isCorrection) return false
  if (purpose === 'react') return false
  if (mode === 'celebration' || mode === 'quick_answer') return false
  if (mode === 'informational' || mode === 'teaching') return false
  if (mode === 'debugging' && !/\b(non\s+so|manca|missing|which|quale\s+file)\b/i.test(userMessage)) {
    return false
  }
  if (mode === 'brainstorming') return false
  // Decision with named options present → answer; without options → ask.
  if (mode === 'decision_support' || purpose === 'recommend') {
    const hasOptions =
      /\b(o|or|vs\.?|versus|tra|between)\b/i.test(userMessage) &&
      (/\b\w+\s+(?:o|or|vs\.?)\s+\w+\b/i.test(userMessage) ||
        /\b(?:opzione|option|nome|name)s?\b/i.test(userMessage))
    // "Quale dei due nomi" without listing them → need input
    if (/\b(?:dei\s+due|two|questi|these)\b/i.test(userMessage) && userMessage.length < 80) {
      return true
    }
    return !hasOptions
  }
  if (
    /\b(aiutami\s+a\s+scegliere\s+ma\s+non\s+so|non\s+so\s+ancora|dipende|opzioni\??\s*$)/i.test(
      userMessage,
    )
  ) {
    return true
  }
  return false
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {{ isCorrection: boolean, emotionalTone: EmotionalTone }} ctx
 */
function inferAcknowledgementNeeded(userMessage, mode, purpose, ctx) {
  if (ctx.stopDecline) return false
  if (ctx.isCorrection) return true
  if (mode === 'celebration') return true
  if (ctx.emotionalTone === 'frustrated' || ctx.emotionalTone === 'excited') return true
  if (mode === 'emotional_support' || purpose === 'comfort') return true
  if (mode === 'informational' || mode === 'quick_answer' || mode === 'teaching') return false
  if (purpose === 'explain' || purpose === 'answer') return false
  if (mode === 'casual' && purpose === 'react') return false
  return false
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{ structurePreference?: StructurePreference|null }} overrides
 * @returns {StructurePreference}
 */
function inferStructurePreference(userMessage, mode, overrides) {
  if (overrides.structurePreference) return overrides.structurePreference
  if (
    /\b(lista|elenca|elenco|table|tabella|confronta|compare|bullet|punti\s+elenco|fammi\s+una\s+lista)\b/i.test(
      userMessage,
    )
  ) {
    return 'structured'
  }
  if (mode === 'debugging') return 'structured'
  if (
    mode === 'brainstorming' ||
    mode === 'decision_support' ||
    mode === 'problem_solving' ||
    mode === 'teaching'
  ) {
    return 'light_structure'
  }
  if (mode === 'informational') return 'light_structure'
  return 'prose'
}

/**
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {string} userMessage
 * @returns {ConfidenceLevel}
 */
function inferConfidence(mode, purpose, userMessage) {
  if (purpose === 'recommend' || mode === 'decision_support') {
    if (looksLikeBinaryChoice(userMessage)) return 'high'
    if (
      /\b(due|two|a\s+o\s+b|questi\s+due|these\s+two|nome[s]?)\b/i.test(userMessage) ||
      userMessage.length > 40
    ) {
      return 'high'
    }
    return 'medium'
  }
  if (mode === 'quick_answer' || mode === 'informational') return 'high'
  if (mode === 'debugging' && /\b(forse|maybe|non\s+so)\b/i.test(userMessage)) return 'low'
  if (mode === 'brainstorming') return 'medium'
  return 'medium'
}

/**
 * @param {string} userMessage
 */
function detectExplicitOverrides(userMessage) {
  const t = userMessage
  /** @type {{
   *   labels: string[]
   *   desiredDepth: DesiredDepth | null
   *   emojiLevel: EmojiLevel | null
   *   structurePreference: StructurePreference | null
   *   forceTeaching: boolean
   *   forceShort: boolean
   *   forceInteractive: boolean
   * }} */
  const out = {
    labels: [],
    desiredDepth: null,
    emojiLevel: null,
    structurePreference: null,
    forceTeaching: false,
    forceShort: false,
    forceInteractive: false,
  }

  if (
    /\b(rispondi\s+brevemente|in\s+una\s+frase|solo\s+la\s+risposta|vai\s+dritto\s+al\s+punto|be\s+brief|in\s+one\s+sentence|short\s+answer)\b/i.test(
      t,
    )
  ) {
    out.desiredDepth = 'short'
    out.forceShort = true
    out.labels.push('depth:short')
  }
  if (
    /\b(nel\s+dettaglio|in\s+modo\s+molto\s+approfondito|approfondisci|spiega(?:melo|lo|mi)?\s+(?:bene|dettagliat\w*)|dettagliatamente|in\s+detail|very\s+detailed|thorough(?:ly)?)\b/i.test(
      t,
    )
  ) {
    out.desiredDepth = 'detailed'
    out.labels.push('depth:detailed')
  }
  if (
    /\b(fammi\s+una\s+risposta\s+semplice|in\s+modo\s+semplice|keep\s+it\s+simple|spiega(?:melo|lo|mi)?\s+semplice)\b/i.test(
      t,
    )
  ) {
    if (!out.desiredDepth) out.desiredDepth = 'medium'
    out.forceTeaching = true
    out.labels.push('simple_explain')
  }
  if (
    /\b(spiegamelo\s+come\s+se\s+non\s+sapessi|come\s+se\s+non\s+sapessi\s+nulla|explain\s+like\s+i(?:'?m|\s+am)\s+five|eli5)\b/i.test(
      t,
    )
  ) {
    out.forceTeaching = true
    if (!out.desiredDepth) out.desiredDepth = 'detailed'
    out.labels.push('teaching')
  }
  if (
    /\b(non\s+usare\s+emoji|senza\s+emoji|no\s+emoji|without\s+emoji)\b/i.test(t)
  ) {
    out.emojiLevel = 'none'
    out.labels.push('emoji:none')
  }
  if (
    /\b(usa\s+qualche\s+emoji|con\s+emoji|use\s+(?:some\s+)?emoji)\b/i.test(t)
  ) {
    out.emojiLevel = 'moderate'
    out.labels.push('emoji:moderate')
  }
  if (
    /\b(fammi\s+una\s+lista|in\s+lista|elenco\s+puntato|as\s+a\s+list|bullet\s+points|tabella|table)\b/i.test(
      t,
    )
  ) {
    out.structurePreference = 'structured'
    out.labels.push('structure:structured')
  }
  if (
    /\b(fammi\s+domande|chiedimi|ask\s+me\s+questions|interview\s+me)\b/i.test(t)
  ) {
    out.forceInteractive = true
    out.labels.push('interactive')
  }

  return out
}

/** @param {string} firstLine */
function classifyOpeningType(firstLine) {
  const t = normalizeText(firstLine).slice(0, 80).toLowerCase()
  if (/^(certo|assolutamente|esatto|perfetto|ok|okay)\b/.test(t)) return 'filler_ack'
  if (/^(capisco|capito|ah,?\s*s[iì]|ah\b)/.test(t)) return 'understanding'
  if (/^(ottima\s+domanda|great\s+question)\b/.test(t)) return 'praise'
  if (/^(finalmente|grande|yes+|yess+|ce\s+l['']abbiamo|fantastico)\b/.test(t)) return 'reaction'
  if (/^\p{Extended_Pictographic}/u.test(firstLine)) return 'emoji_lead'
  if (t.length < 40) return 'direct'
  return 'substantive'
}

/** @param {string} firstLine */
function classifyAcknowledgementType(firstLine) {
  const t = normalizeText(firstLine).slice(0, 60).toLowerCase()
  if (/^(certo|assolutamente)\b/.test(t)) return 'certo'
  if (/^(esatto|exactly)\b/.test(t)) return 'esatto'
  if (/^(capisco|capito|i\s+see)\b/.test(t)) return 'capisco'
  if (/^(perfetto|ok|okay|va\s*bene)\b/.test(t)) return 'ok'
  if (/^(ah|oh)\b/.test(t)) return 'ah'
  if (/^(finalmente|grande|yes+)/.test(t)) return 'reaction'
  if (/^(interessante|interesting)\b/.test(t)) return 'interessante'
  if (/^(ahah|haha|lol)/.test(t)) return 'laugh'
  return null
}

/** @param {string} text */
function extractEmojis(text) {
  const matches = String(text || '').match(/\p{Extended_Pictographic}/gu)
  return matches ? [...new Set(matches)] : []
}

/**
 * @param {string[]} list
 * @param {string} item
 * @param {number} max
 */
function pushCap(list, item, max) {
  const next = [...(Array.isArray(list) ? list : []), item].filter(Boolean)
  return next.slice(-max)
}

/**
 * @param {string[]} prev
 * @param {string[]} next
 * @param {number} max
 */
function mergeRecentEmojis(prev, next, max) {
  return [...(Array.isArray(prev) ? prev : []), ...(Array.isArray(next) ? next : [])].slice(
    -max,
  )
}

/**
 * @param {unknown} value
 * @param {number} maxItems
 * @param {number} maxLen
 * @returns {string[]}
 */
function sanitizeStringList(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return []
  /** @type {string[]} */
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const cleaned = item.replace(/\s+/g, ' ').trim().slice(0, maxLen)
    if (!cleaned) continue
    out.push(cleaned)
    if (out.length >= maxItems) break
  }
  return out.slice(-maxItems)
}

/**
 * @param {string[]} list
 * @param {number} n
 */
function uniqTail(list, n) {
  const tail = (Array.isArray(list) ? list : []).slice(-Math.max(n * 2, n))
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  for (let i = tail.length - 1; i >= 0; i--) {
    const v = tail[i]
    if (seen.has(v)) continue
    seen.add(v)
    out.unshift(v)
    if (out.length >= n) break
  }
  return out
}
