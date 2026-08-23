/**
 * #324 — Conversation State MVP (Core only).
 * #369B — Thread decision evidence + confidence calibration (deterministic).
 * #370B — Playful/banter beats, soft closers, soft STOP, topic-return cues.
 *
 * Cheap deterministic turn-level signals injected as a compact appendix into the
 * SAME OpenAI request. No second LLM, no Cognitive/V1/V2, no Memory persistence.
 *
 * Soft presentation guidance — never overrides safety, truth, or capabilities.
 */

import {
  deriveThreadDecisionEvidence,
  formatThreadEvidenceAppendixLines,
  looksLikeEvidenceHedge,
} from './thread-decision-evidence.js'

export const CONVERSATION_STATE_BUILD = '370b-1'
/** #326 style-variety build tag (session-only fingerprints + STYLE_AVOID). */
export const STYLE_VARIETY_BUILD = '326-1'
/** #327 momentum policy build (NRP section; no new schema field). */
export const CONVERSATION_MOMENTUM_BUILD = '327-1'
/** #328 Continuity Intelligence cue/build tag (no new schema field). */
export const CONTINUITY_INTELLIGENCE_BUILD = '328-1'

/** Soft cap for appendix size (chars). Target ~200–400 tokens ≈ ≤1600 chars; #369B evidence block may add ~350. */
export const CONVERSATION_STATE_APPENDIX_MAX_CHARS = 2100

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
 *   threadEvidence?: import('./thread-decision-evidence.js').ThreadDecisionEvidence | null
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
  lines.push(
    'Soft-avoid default filler openings (Certo/Capisco/Perfetto/Va bene/Assolutamente) when acknowledgement=false or they already appear in recent_acks/openings.',
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

  const stopDecline =
    looksLikeStopDecline(userMessage) || looksLikeSoftStopClose(userMessage)
  const continueCue = looksLikeContinueCue(userMessage)
  const completionCue =
    (looksLikeCompletionCue(userMessage) || looksLikeSoftDiscourseParticle(userMessage)) &&
    !continueCue &&
    !looksLikeSoftStopClose(userMessage)
  // Soft stop already folded into stopDecline; discourse particles use completion-like close.
  const decisionSignal = looksLikeBinaryChoice(userMessage) || looksLikeDecisionAsk(userMessage)
  const ordinalFollowUp = looksLikeOrdinalFollowUp(userMessage)
  const ellipsisFollowUp = looksLikeEllipsisFollowUp(userMessage)
  const dimensionContinuation = /^(?:e\s+(?:su|per)\s+\S|and\s+(?:on|for)\s+\S)/i.test(
    userMessage,
  )
  const topicReturnCue = looksLikeTopicReturnCue(userMessage)
  const shortFollowUp =
    isShortFollowUp(userMessage) ||
    continueCue ||
    ordinalFollowUp ||
    ellipsisFollowUp ||
    topicReturnCue
  const priorMode = inferPriorModeFromHistory(recent)
  const isCorrection = looksLikeCorrection(userMessage)
  const isTechnicalContext = looksTechnicalContext(recent, input.workingState)
  const priorOfferedAlternatives = priorAssistantOfferedSelectableAlternatives(recent)
  const playfulBanter = looksLikePlayfulBanterBeat(userMessage, {
    priorMode,
    recentMessages: recent,
  })
  const harmDistress = looksLikeHarmDistressCue(userMessage)

  let conversationMode = inferConversationMode(userMessage, {
    shortFollowUp,
    priorMode,
    isCorrection,
    isTechnicalContext,
    workingState: input.workingState || null,
    stopDecline,
    continueCue,
    priorOfferedAlternatives,
    playfulBanter,
    topicReturnCue,
    harmDistress,
  })

  let responsePurpose = inferResponsePurpose(userMessage, conversationMode, {
    isCorrection,
    shortFollowUp,
    continueCue: continueCue || ordinalFollowUp || dimensionContinuation || topicReturnCue,
    stopDecline,
    completionCue,
    playfulBanter,
    topicReturnCue,
  })

  let emotionalTone = inferEmotionalTone(userMessage, conversationMode, {
    playfulBanter,
    harmDistress,
  })
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
    completionCue,
  })
  let acknowledgementNeeded = inferAcknowledgementNeeded(
    userMessage,
    conversationMode,
    responsePurpose,
    { isCorrection, emotionalTone, stopDecline },
  )
  /** @type {import('./thread-decision-evidence.js').ThreadDecisionEvidence | null} */
  let threadEvidence = null
  /** @type {ConfidenceLevel} */
  let confidence = 'medium'

  // Explicit overrides always win for style axes.
  if (overrides.desiredDepth) desiredDepth = overrides.desiredDepth
  if (overrides.emojiLevel) emojiLevel = overrides.emojiLevel
  if (overrides.structurePreference) structurePreference = overrides.structurePreference
  if (overrides.forceTeaching) {
    conversationMode = 'teaching'
    if (
      responsePurpose === 'answer' ||
      responsePurpose === 'react' ||
      (responsePurpose === 'continue' && !shortFollowUp)
    ) {
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
    if (
      responsePurpose === 'answer' ||
      responsePurpose === 'react' ||
      (responsePurpose === 'continue' && !shortFollowUp)
    ) {
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

  // Soft completion / micro understanding beat: close cleanly (#330/#367B).
  // Soft discourse particles ("Vabbè", "Boh", "Daje") use this path (#370B).
  if (completionCue && !stopDecline) {
    conversationMode =
      conversationMode === 'celebration' || conversationMode === 'emotional_support'
        ? conversationMode
        : 'casual'
    responsePurpose = 'react'
    initiativeLevel = 'low'
    questionNeeded = false
    // Whole reply may be the beat — avoid Capisco/Certo preamble stacking.
    acknowledgementNeeded = false
    desiredDepth = 'short'
    if (!overrides.structurePreference) structurePreference = 'prose'
  }

  // #370B — playful/banter beats: keep conversational job (never default explain).
  if (playfulBanter && !stopDecline && !completionCue && !harmDistress) {
    conversationMode = 'casual'
    responsePurpose = 'react'
    initiativeLevel = 'low'
    questionNeeded = false
    acknowledgementNeeded = false
    desiredDepth = 'short'
    emotionalTone = 'playful'
    if (!overrides.structurePreference) structurePreference = 'prose'
  }

  // #370B — explicit topic return: continue recoverable prior thread.
  if (topicReturnCue && !stopDecline && !completionCue && !playfulBanter) {
    const substantivePrior =
      priorMode &&
      [
        'teaching',
        'informational',
        'debugging',
        'decision_support',
        'problem_solving',
        'brainstorming',
      ].includes(priorMode)
        ? priorMode
        : null
    conversationMode = substantivePrior || priorMode || 'informational'
    responsePurpose = 'continue'
    if (!overrides.desiredDepth && desiredDepth === 'short') desiredDepth = 'medium'
    questionNeeded = false
    if (initiativeLevel === 'low') initiativeLevel = 'normal'
  }

  // Harm / injury with laugh emoji: never playful (#370B).
  if (harmDistress) {
    emotionalTone = 'serious'
    if (conversationMode === 'casual' || conversationMode === 'celebration') {
      conversationMode = 'emotional_support'
      responsePurpose = 'comfort'
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
      topicReturnCue ||
      overrides.forceTeaching ||
      Boolean(overrides.desiredDepth))

  // #369B — user-only thread decision evidence after final mode/purpose settle.
  const decisionTurn =
    conversationMode === 'decision_support' ||
    responsePurpose === 'recommend' ||
    decisionSignal ||
    (priorModeInherited && priorMode === 'decision_support')
  if (decisionTurn) {
    threadEvidence = deriveThreadDecisionEvidence({
      userMessage,
      recentMessages: input.recentMessages || recent,
    })
  }
  confidence = inferConfidence(conversationMode, responsePurpose, userMessage, {
    threadEvidence,
  })

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
    continueCueDetected: continueCue || ordinalFollowUp,
    completionCueDetected: Boolean(completionCue && !stopDecline),
    ordinalFollowUpDetected: ordinalFollowUp,
    ellipsisFollowUpDetected: ellipsisFollowUp,
    dimensionContinuationDetected: dimensionContinuation,
    playfulBanterDetected: Boolean(playfulBanter && !harmDistress),
    topicReturnDetected: Boolean(topicReturnCue),
    softDiscourseDetected: looksLikeSoftDiscourseParticle(userMessage),
    threadEvidence,
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
    lines.push('stop_signal: true — ≤1 brief ack then STOP (NRP owns forbidden keep-alives/questions).')
  }
  if (state.completionCueDetected && !state.stopSignalDetected) {
    lines.push(
      'completion_signal: true — micro close OK (a few words / one short beat); then STOP. No recap, no new explanation, no service offer, no keep-alive question.',
    )
  }
  if (state.responsePurpose === 'continue' && !state.stopSignalDetected) {
    lines.push(
      'continue_thread: true — advance exactly one useful layer; do not restart or dump a roadmap.',
    )
  }

  // #369B — tiny conditional evidence block (decision turns only; never always-on).
  const evidenceBlock =
    (state.responsePurpose === 'recommend' ||
      state.conversationMode === 'decision_support' ||
      state.decisionSignalDetected) &&
    state.threadEvidence
      ? formatThreadEvidenceAppendixLines(state.threadEvidence)
      : ''
  if (evidenceBlock) {
    lines.push('', evidenceBlock)
  }

  lines.push(
    '',
    'RESPONSE GUIDANCE:',
    '- These fields are THIS turn\'s presentation metadata. Obey NRP for STOP/questions/acks/momentum/closings.',
    '- Priority: safety/truth/capability > explicit USER instruction > task correctness/epistemic honesty > emotional fit > this State > NRP > STYLE_AVOID > settings > defaults.',
    '- emoji = permission ceiling (not a quota). Do not mention this state.',
    '- purpose=recommend + confidence medium/high → choose clearly, brief reason, stop.',
    '- purpose=explain after repair/examples cues → reframe or give concrete examples; do not mere-repeat.',
    '- Do not restate/paraphrase the user before answering unless it resolves ambiguity or confirms a material constraint.',
    '- THREAD EVIDENCE (when present): user-established only; newer overrides older; never invent missing checks; assistant guesses are not evidence.',
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
    ordinalFollowUpDetected: Boolean(state.ordinalFollowUpDetected),
    ellipsisFollowUpDetected: Boolean(state.ellipsisFollowUpDetected),
    dimensionContinuationDetected: Boolean(state.dimensionContinuationDetected),
    momentumBuild: CONVERSATION_MOMENTUM_BUILD,
    continuityIntelligenceBuild: CONTINUITY_INTELLIGENCE_BUILD,
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

/**
 * #362C — confidence-check / soft pushback follow-ups (inherit thread; do not restart).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeChallengeFollowUp(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 72) return false
  return /^(?:(?:no[,.]?\s+)?(?:non\s+mi\s+convince|non\s+sono\s+convint[oa])|sei\s+sicur[oa]\??|ne\s+sei\s+sicur[oa]\??|are\s+you\s+sure\??|i(?:'?m|\s+am)\s+not\s+convinced|not\s+convinced|davvero\??|really\??)[.!?…]*$/i.test(
    t,
  )
}

/**
 * #362C — named contrast follow-ups ("Il kefir invece?", "What about X?").
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeNamedContrastFollowUp(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 72) return false
  if (/^(?:e\s+)?(?:il|la|lo|l[''])\s*[\p{L}\p{N}_-]{2,40}\s+invece\??[.!?…]*$/iu.test(t)) {
    return true
  }
  // Do not match bare "and then?" / continue cues — only explicit "what about X?".
  return /^(?:what\s+about|and\s+what\s+about)\s+[\p{L}\p{N}_-]{2,40}\??[.!?…]*$/iu.test(t)
}

/** @param {string} text */
function isShortFollowUp(text) {
  if (looksLikeContinueCue(text)) return true
  if (looksLikeOrdinalFollowUp(text)) return true
  if (looksLikeEllipsisFollowUp(text)) return true
  if (looksLikeChallengeFollowUp(text)) return true
  if (looksLikeNamedContrastFollowUp(text)) return true
  const t = normalizeText(String(text || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 56) return false
  return /^(ok|okay|ok\.|va\s*bene|s[iì]|si+|no|nope|esatto|certo|perfetto|grazie|thanks|thank\s*you|perch[eé]\??|come\??|quanto\??|quello|quella|l['']altro|l['']altra|il\s*primo|il\s*secondo|il\s*terzo|la\s*prima|la\s*seconda|la\s*terza|l['']ultimo|l['']ultima|quello\s+prima|quella\s+prima|e\s+il\s+secondo\??|e\s+la\s+prima\??|mm+|ahm+|ah+|ahah+|lol|haha+|yep|yeah|yes|that\s*one|the\s*other|the\s+first|the\s+second|the\s+third|the\s+last(?:\s+one)?)[.!?…]*$/i.test(
    t,
  )
}

/**
 * Ordinal / previous-option follow-ups (#328).
 * @param {string} message
 */
export function looksLikeOrdinalFollowUp(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 72) return false
  return /^(?:e\s+)?(?:il\s+primo|la\s+prima|il\s+secondo|la\s+seconda|il\s+terzo|la\s+terza|il\s+quarto|la\s+quarta|l['']ultimo|l['']ultima|quello\s+prima|quella\s+prima|the\s+first(?:\s+one)?|the\s+second(?:\s+one)?|the\s+third(?:\s+one)?|the\s+fourth(?:\s+one)?|the\s+last(?:\s+one)?|the\s+previous(?:\s+one)?)(?:\s+mi\s+piace)?[.!?…]*$/i.test(
    t,
  )
}

/**
 * Elliptical / depth / dimension follow-ups (#328) — classification only.
 * @param {string} message
 */
export function looksLikeEllipsisFollowUp(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 72) return false
  if (
    /^(perch[eé]\??|come\??|quanto\??|e\s+invece\??|why\??|how\??|how\s+much\??)[.!?…]*$/i.test(t)
  ) {
    return true
  }
  if (
    /^(?:e\s+(?:su|per)\s+\S{2,40}|and\s+(?:on|for)\s+\S{2,40}|e\s+domani\??)\??[.!]*$/i.test(t)
  ) {
    return true
  }
  // Depth/simplify deepeners only when they ARE the turn (no new topic noun after).
  // Avoid trapping "Spiegami bene OAuth" as a short follow-up.
  if (
    /^(?:spiega(?:melo|lo|mi)?\s+(?:meglio|semplice|bene)|pi[uù]\s+semplice|pi[uù]\s+dettagliat\w*|ora\s+(?:pi[uù]\s+)?dettagliat\w*|approfondisci|explain\s+(?:it\s+)?(?:better|more\s+simply)|more\s+detail)[.!?…]*$/i.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/**
 * Explicit continue / deepen cues (#327/#328).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeContinueCue(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 80) return false
  if (
    /^(continua(?:\s+pure)?|continuiamo|vai(?:\s+avanti)?|avanti|e\s*poi\??|poi\??|ancora\??|dimmi\s+altro|approfondisci|prosegui|go(?:\s+on)?|continue|keep\s+going|and\s+then\??|more|tell\s+me\s+more|next)[.!?…]*$/i.test(
      t,
    )
  ) {
    return true
  }
  // Continue-with-reference (#328)
  return /^(?:continua\s+(?:da\s+(?:quella|quello|l[iì])|dalla\s+(?:prima|seconda|terza|quarta)|dal\s+(?:primo|secondo|terzo|quarto))|vai\s+avanti\s+da\s+l[iì]|riparti\s+da\s+quella|approfondisci\s+quello|sviluppa\s+la\s+(?:prima|seconda|terza)|dimmi\s+di\s+pi[uù]\s+sulla\s+(?:prima|seconda|terza)|continue\s+from\s+(?:that|there)|go\s+on\s+from\s+that|expand\s+on\s+the\s+(?:first|second|third)(?:\s+one)?|tell\s+me\s+more\s+about\s+the\s+(?:first|second|third)(?:\s+one)?)[.!?…]*$/i.test(
    t,
  )
}

/**
 * Hard conversational stop / decline (#327/#328).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeStopDecline(message) {
  const t = normalizeText(message)
  if (!t || t.length > 120) return false
  // Bare no/nope = soft decline of current direction (not a general negation mid-sentence).
  if (/^(no|nope)[.!]*$/i.test(t)) return true
  // Multi-clause stop/pivot (#328)
  if (
    /(?:^|[.!,;]\s*)(?:lascia(?:mo)?\s+stare|basta(?:\s+con\s+(?:questo|cos[iì]))?|forget\s+it|never\s+mind|drop\s+it)\b[\s,.;:!]*(?:let'?s\s+talk\s+about\s+)?(?:parliamo\s+(?:d['']altro|di\s+altro)|cambiamo\s+argomento|passiamo\s+oltre|let'?s\s+(?:talk|move)\s+on|change\s+topic|something\s+else)\b/i.test(
      t,
    )
  ) {
    return true
  }
  // "basta così" / "ok così" are soft completion — handled by looksLikeCompletionCue.
  return /^(?:(?:ok\s+)?basta(?:\s+con\s+(?:questo|cos[iì]))?|lascia(?:mo)?\s+stare|niente(?:\s+altro)?|non\s+importa|non\s+mi\s+interessa(?:\s+pi[uù])?|cambiamo\s+argomento|parliamo\s+d['']altro|chiudiamola\s+qui|passiamo\s+oltre|stop|never\s+mind|leave\s+it|forget\s+it|let'?s\s+move\s+on|change\s+topic|enough|drop\s+it|that'?s\s+enough)[.!]*$/i.test(
    t,
  )
}

/**
 * Completion / understanding / soft-close cues (#330, expanded #367B/#369B micro-beats).
 * Conservative: standalone acknowledgements only — "Ok ma…", "Fatto però…" do NOT match.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeCompletionCue(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 56) return false

  // Soft completion / "enough for now"
  if (
    /^(?:fatto|risolto|funziona|done|ok\s+cos[iì]|basta\s+cos[iì]|va\s+bene\s+cos[iì]|vabb[eè]\s+cos[iì]|cos[iì]\s+va\s+bene|ci\s+siamo|all\s+good|that'?s\s+it|that'?s\s+enough(?:\s+for\s+now)?)[.!…]*$/i.test(
      t,
    )
  ) {
    return true
  }

  // Standalone ack / understanding beats (micro reply + STOP)
  if (
    /^(?:ok|okay|capito|chiaro|perfetto|got\s+it|understood)[.!…]*$/i.test(t) ||
    /^(?:ho\s+capito|i\s+get\s+it|i\s+understand)[.!…]*$/i.test(t)
  ) {
    return true
  }

  // #369B — compound understanding closes ("Aaahhh, allora ho capito", "Ok, ora è chiaro").
  // Require end-anchored forms so "Ho capito, ma perché?" / "Ok, ora è chiaro, ma…" stay open.
  if (
    /^(?:a{1,8}h{1,6}|oh{1,6})[,.]?\s*(?:(?:ora|adesso|allora)\s+)?(?:ho\s+)?capito[.!…]*$/i.test(
      t,
    ) ||
    /^(?:ah+|ahh+|ahhh+|oh+)[,.]?\s*(?:(?:ora|adesso|allora)\s+)?(?:ho\s+)?capito[.!…]*$/i.test(
      t,
    ) ||
    /^(?:ok|okay)[,.]?\s*(?:ora|adesso)\s+(?:[eè]\s+)?chiaro[.!…]*$/i.test(t) ||
    /^(?:ora|adesso)\s+(?:[eè]\s+)?chiaro[.!…]*$/i.test(t) ||
    /^(?:ah+|ahh+|ahhh+|oh+)[,.]?\s*capito[.!…]*$/i.test(t)
  ) {
    return true
  }

  return false
}

/**
 * #370B — laugh / amusement cues (emoji or textual).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeLaughCue(message) {
  const raw = String(message || '')
  if (/[😂🤣]/u.test(raw)) return true
  const t = normalizeText(raw.replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t) return false
  return /\b(?:a?haha+|ahah+|hehe+|lol|lmao|rofl)\b/i.test(t)
}

/**
 * #370B — harm / injury / distress that must never become playful banter.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeHarmDistressCue(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t) return false
  return /\b(?:mi\s+sono\s+fatto\s+male|mi\s+sono\s+fatta\s+male|mi\s+fa\s+male|mi\s+sono\s+rotto|mi\s+sono\s+rotta|dolore\s+forte|sangue|ospedale|ferit[oa]|ho\s+paura|i(?:'?m|\s+am)\s+hurt|hurt\s+myself|in\s+(?:a\s+lot\s+of\s+)?pain|bleeding|broke\s+my\s+\w+)\b/i.test(
    t,
  )
}

/**
 * #370B — real substantive questions (must not be swallowed as banter).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeSubstantiveQuestion(message) {
  const raw = String(message || '')
  const t = normalizeText(raw.replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t) return false
  const stripped = t.replace(/\?+/g, '').trim()
  if (!/\?/.test(raw) && !/^(?:perch[eé]|why|come|how|cosa|what|quando|when)\b/i.test(stripped)) {
    return false
  }
  if (
    /\b(?:perch[eé]|why|come\s+(?:funziona|mai|si|se)|how\s+(?:does|do|is|are|can)|cosa\s+(?:[eè]|sono)|what\s+(?:is|are|does)|quando|when|dove|where|quale|which)\b/i.test(
      stripped,
    ) &&
    stripped.length >= 10
  ) {
    return true
  }
  // Longer interrogatives with content (not "eh?" / "serio?").
  return Boolean(/\?/.test(raw) && stripped.length >= 18)
}

/**
 * #370B — soft Italian/EN discourse particles (not decision picks).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeSoftDiscourseParticle(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 28) return false
  return /^(?:vabb[eè]|va\s*beh|va\s*be'|boh|daje|mah|interessante|ok\s+dai|okay\s+dai|va\s+be['']?)[.!…]*$/i.test(
    t,
  )
}

/**
 * #370B — soft STOP / natural end (standalone only; pivots excluded).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeSoftStopClose(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 64) return false
  // Still open: "Va bene così, ma perché?" / contrast clauses.
  if (/,?\s*(?:ma|per[oò]|perch[eé]|and|but|however)\b/i.test(t)) return false
  // Pivot: "Lasciamo perdere OAuth e parliamo di Calendar"
  if (
    /\be\s+parliamo\b|\bparliamo\s+di\b|\band\s+(?:let'?s\s+)?(?:talk|speak)\b|\bcambiamo\b|\bswitch\s+to\b/i.test(
      t,
    )
  ) {
    return false
  }
  // If there is a topic noun after "lasciamo perdere", treat as pivot — not full STOP.
  if (/^lasciamo\s+perdere\s+\S+/i.test(t)) return false
  return /^(?:lasciamo\s+perdere|vabb[eè][,.]?\s+lasciamo\s+stare|va\s+bene\s+cos[iì]|vabb[eè]\s+cos[iì]|basta\s+cos[iì]|ok\s+cos[iì]|va\s+bene\s+cos[iì]\s*$|leave\s+it|never\s+mind)[.!…]*$/i.test(
    t,
  )
}

/**
 * #370B — explicit return to an earlier thread topic.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeTopicReturnCue(message) {
  const t = normalizeText(String(message || '').replace(/\p{Extended_Pictographic}/gu, ' '))
  if (!t || t.length > 120) return false
  return /^(?:torniamo\s+(?:a|su|sul|sulla|allo|alla)\s+|riprendiamo\s+(?:il\s+discorso\s+(?:di\s+prima|precedente)|da\s+dove\s+eravamo|da\s+prima)|comunque[,.]?\s+(?:su(?:l|lla)?\s+|a\s+proposito\s+(?:di\s+)?|per\s+)|e\s+per\s+quella\s+cosa\s+(?:di\s+prima|di\s+prima\??)|torniamo\s+a\s+quello\s+di\s+prima|let'?s\s+(?:go\s+back\s+to|return\s+to|pick\s+up)\s+|back\s+to\s+|anyway[,.]?\s+(?:about\s+|on\s+)?)/i.test(
    t,
  )
}

/**
 * #370B — last assistant turn offered A/B / ordinal / explicit choice options.
 * @param {ConversationStateMessage[]} recent
 * @returns {boolean}
 */
export function priorAssistantOfferedSelectableAlternatives(recent) {
  const list = Array.isArray(recent) ? recent : []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (!m || m.role !== 'assistant') continue
    const c = normalizeText(String(m.content || ''))
    if (!c) continue
    if (
      /\b(?:preferisci|scegli|which\s+(?:one|do\s+you\s+prefer)|do\s+you\s+(?:prefer|want)|opzione\s*[ab]|option\s*[ab])\b/i.test(
        c,
      )
    ) {
      return true
    }
    if (
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,24})\s+(?:o|or|vs\.?|versus)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,24})\b/i.test(
        c,
      )
    ) {
      return true
    }
    if (
      /(?:^|\n)\s*(?:[-*•]|\d+[.)]|[A-Da-d][.)])\s+\S+/m.test(String(m.content || '')) &&
      /\b(?:opzion|option|scegl|prefer|which|quale)\b/i.test(c)
    ) {
      return true
    }
    // Only inspect the latest assistant turn.
    break
  }
  return false
}

/**
 * Recent celebration / laugh / teasing context for banter continuity (#370B).
 * @param {ConversationStateMessage[]} recent
 * @returns {boolean}
 */
export function looksLikeRecentPlayfulContext(recent) {
  const slice = (Array.isArray(recent) ? recent : []).slice(-8)
  for (const m of slice) {
    const raw = String(m?.content || '')
    if (/[😂🤣]/u.test(raw)) return true
    if (
      /\b(?:finalmente\s+funziona|era\s+ora|ce\s+l['']abbiamo\s+fatta|we\s+did\s+it|it\s+works|only\s+took|tentativ|grandeee?|ahah+|hahah*|velocissimo\s+proprio)\b/i.test(
        raw,
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * #370B — playful / banter beat (not every 😂; never substantive Q / harm / serious).
 * @param {string} message
 * @param {{ priorMode?: ConversationMode | null, recentMessages?: ConversationStateMessage[] }} [ctx]
 * @returns {boolean}
 */
export function looksLikePlayfulBanterBeat(message, ctx = {}) {
  const raw = String(message || '')
  if (!raw.trim()) return false
  if (looksLikeHarmDistressCue(raw)) return false
  if (looksLikeSeriousCue(raw)) return false
  if (looksLikeSubstantiveQuestion(raw)) return false
  if (looksLikeDecisionAsk(raw) || looksLikeBinaryChoice(raw)) return false
  if (looksLikeRepairCue(raw) || looksLikeExamplesRequest(raw)) return false
  if (looksLikeStopDecline(raw) || looksLikeSoftStopClose(raw)) return false
  if (looksLikeTopicReturnCue(raw)) return false
  if (looksLikeSoftDiscourseParticle(raw)) return false

  const hasLaugh = looksLikeLaughCue(raw)
  const t = normalizeText(raw.replace(/\p{Extended_Pictographic}/gu, ' '))
  if (t.length > 160) return false

  const priorMode = ctx.priorMode || null
  const priorPlayful =
    priorMode === 'celebration' ||
    priorMode === 'casual' ||
    looksLikeRecentPlayfulContext(ctx.recentMessages || [])

  // Emoji-only laugh burst
  if (
    hasLaugh &&
    /^[\s\p{Extended_Pictographic}]+$/u.test(raw) &&
    raw.replace(/\s+/g, '').length <= 12
  ) {
    return true
  }

  const ironicTease =
    /\b(?:solo\s+\d+\s+tentativ|only\s+took\s+\d+|ci\s+ha\s+messo\s+solo|velocissimo\s+proprio|sicuramente\s+si\s+rompe|non\s+dirmi\s+che|fantastico[,.]?\s+solo|era\s+ora|te\s+l['']avevo\s+detto|oddio|davvero\s+adesso)\b/i.test(
      t,
    ) ||
    /\b(?:sure(?:ly)?\s+(?:it\s+)?(?:will\s+)?break|don'?t\s+tell\s+me\s+(?:it|that))\b/i.test(t)

  if (hasLaugh && ironicTease) return true
  if (ironicTease && priorPlayful && t.length <= 140) return true
  if (hasLaugh && priorPlayful && t.length <= 100) return true

  // Short amused reactions ("Era ora 😂", "Oddio 😂") even without long prior scan.
  if (
    hasLaugh &&
    t.length <= 36 &&
    /^(?:era\s+ora|oddio|davvero|te\s+l['']avevo\s+detto|finalmente|geniale|brav[oa]|nice|wow)\b/i.test(
      t,
    )
  ) {
    return true
  }

  return false
}

/**
 * Narrow social greeting / wellbeing beat where ONE reciprocal question may be earned (#330).
 * Do NOT broaden to ordinary casual chat.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeSimpleSocialGreeting(message) {
  const t = normalizeText(message)
  if (!t || t.length > 36) return false
  return /^(?:ciao|hey|hi|hello|salve|yo)(?:\s+[^\s?]{1,12})?[.!]*$|^(?:come\s+stai|come\s+va|che\s+fai|come\s+andiamo|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up)[?!.,]*$/i.test(
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

/**
 * #362B — repair / re-explain cues (not mere short casual).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeRepairCue(message) {
  const t = normalizeText(message)
  if (!t || t.length > 120) return false
  return /\b(?:non\s+ho\s+capito|non\s+capisco|non\s+ci\s+capisco|spiegamelo\s+meglio|me\s+lo\s+rispieghi|rileggi(?:melo)?|pi[uù]\s+semplice|pi[uù]\s+chiaro|che\s+significa(?:\s+questo)?|non\s+mi\s+[eè]\s+chiaro|non\s+ho\s+seguito|i\s+don'?t\s+understand|i\s+don'?t\s+get\s+it|explain\s+(?:it\s+)?(?:again|better|more\s+simply)|say\s+that\s+differently|what\s+does\s+that\s+mean)\b/i.test(
    t,
  )
}

/**
 * #362B — explicit examples request.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeExamplesRequest(message) {
  const t = normalizeText(message)
  if (!t || t.length > 120) return false
  return /\b(?:fammi\s+(?:degli?\s+|un\s+|qualche\s+)?esempi|un\s+esempio|ad\s+esempio\??|per\s+esempio\??|tipo\??|esempi\s+pratici|give\s+me\s+(?:an?\s+|some\s+)?examples?|for\s+example\??|e\.g\.?\??)\b/i.test(
    t,
  )
}

/**
 * #362B — go/no-go / merge / “should I” decision asks (beyond binary A vs B).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeDecisionAsk(message) {
  const t = normalizeText(message)
  if (!t || t.length > 180) return false
  if (looksLikeBinaryChoice(t)) return true
  // Avoid trailing/leading \b after accented stems (JS \b is ASCII-only).
  return /(?:^|\b)(?:faccio\s+merge|do\s+i\s+merge|should\s+i\s+merge|posso\s+mergiare|conviene(?:\s+(?:farlo|procedere))?|lo\s+faccio|la\s+faccio|[eè]\s+pronto|is\s+it\s+ready|should\s+i|do\s+i\s+(?:ship|merge|deploy|go)|secondo\s+te\s+(?:conviene|procedo|lo\s+faccio)|would\s+you\s+(?:merge|ship|go))(?![a-z0-9_])/i.test(
    t,
  )
}

/**
 * #362B — playful challenge / “tell me the truth” with banter energy.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikePlayfulChallenge(message) {
  const t = normalizeText(message)
  if (!t || t.length > 160) return false
  // No trailing \b after accented verità — JS \b is ASCII-only and fails on à.
  if (/(?:^|\b)(?:dimmi\s+la\s+verit[aà]|tell\s+me\s+the\s+truth)(?![a-z0-9_])/i.test(t)) return true
  const hasLaugh =
    /\p{Extended_Pictographic}/u.test(String(message || '')) ||
    /\b(?:ahah+|haha+|lol|lmao)\b/i.test(t)
  if (
    /\b(?:fa\s+schifo|una\s+cazzata|cagata|[eè]\s+una\s+stupidaggine|is\s+(?:this\s+)?(?:shit|trash|dumb|stupid))\b/i.test(
      t,
    )
  ) {
    return hasLaugh || /\?/.test(t) || /\bsecondo\s+te\b/i.test(t)
  }
  return false
}

/**
 * #362B — exploration / “tell me something interesting” / boredom.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeExplorationAsk(message) {
  const t = normalizeText(message)
  if (!t || t.length > 120) return false
  return /\b(?:dimmi\s+qualcosa\s+di\s+interessante|parliamo\s+di\s+qualcosa|raccontami\s+qualcosa|sorprendimi|mi\s+annoio|che\s+noia|i'?m\s+bored|tell\s+me\s+something\s+interesting|let'?s\s+talk\s+about\s+something|surprise\s+me)\b/i.test(
    t,
  )
}

/**
 * #362B — explicit seriousness cue.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeSeriousCue(message) {
  const t = normalizeText(message)
  if (!t || t.length > 80) return false
  return /^(?:sono\s+serio|parlo\s+serio|seria(?:mente)?|i'?m\s+serious|seriously|no\s+joke)[.!]*$/i.test(
    t,
  )
}

/**
 * #362B — frustrated broken/bug vent (may lack explicit tech nouns).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeFrustratedFailure(message) {
  const t = normalizeText(message)
  if (!t || t.length > 160) return false
  const broken =
    /\b(?:non\s+funziona(?:\s+ancora)?|still\s+(?:broken|doesn'?t\s+work|failing)|ancora\s+niente|stesso\s+errore|keeps\s+failing)\b/i.test(
      t,
    )
  const vent =
    /\b(?:che\s+palle|che\s+nervi|di\s+nuovo|ancora|damn|shit|cavolo|odio|frustrat)\b/i.test(t) ||
    /!{2,}/.test(t)
  return broken && vent
}

/** @param {string} text */
function looksLikeCorrection(text) {
  const t = normalizeText(text)
  if (!t) return false
  return /\b(?:no[,:]?\s+intendevo|non\s+hai\s+capito|non\s+[eè]\s+quello|non\s+quello|quello\s+prima|dicevo\s+l['']altro|mi\s+sono\s+spiegat[oa]\s+male|volevo\s+dire|[eè]\s+sbagliato|hai\s+sbagliato|non\s+era\s+quello|I\s+meant\s+the\s+other|that'?s\s+not\s+what\s+I\s+meant|you\s+misunderstood|wrong(?:\s+one)?)\b/i.test(
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
 * Soft cues that a recent user turn established a merge / ship decision thread (#369B).
 * Used for priorMode inheritance — not for inventing check results.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeMergeDecisionThreadCue(message) {
  const t = normalizeText(message)
  if (!t || t.length > 220) return false
  if (looksLikeDecisionAsk(t)) return true
  if (
    /\b(?:faccio\s+merge|do\s+i\s+merge|should\s+i\s+merge|posso\s+mergiare|safe\s+to\s+merge|pronto\s+al\s+merge|merge\??\s*$)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(?:la\s+)?pr\s+(?:[eè]\s+)?pronta\b/i.test(t) ||
    /\bpr\s+is\s+ready\b/i.test(t) ||
    /\bpull\s+request\s+(?:is\s+)?ready\b/i.test(t)
  ) {
    return true
  }
  if (
    /\bci\s+(?:[eè]\s+|is\s+)?(?:verde|green|ross[ao]|red|ok)\b/i.test(t) ||
    /\bci\s+(?:verde|green|ross[ao]|red)\b/i.test(t) ||
    /\b(?:tutti\s+i\s+)?tests?\s+(?:sono\s+|are\s+)?(?:verdi|green|passati|passed|ross[iao]|red|fail)/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\bpreview\s+(?:ready|pronta|fallisce|failed|failing|rossa|ok)\b/i.test(t) ||
    /\bdeploy(?:ment)?\s+(?:ready|failed|fallit)/i.test(t)
  ) {
    return true
  }
  if (
    /\b(?:nessun(?:o)?\s+conflitt[oi]|no\s+(?:merge\s+)?conflicts?|senza\s+conflitt[oi]|merge\s+conflicts?)\b/i.test(
      t,
    )
  ) {
    return true
  }
  return false
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
    // Clear topic pivot: a fresh "what is X?" / Cos'è… beats lingering merge threads (#369B).
    if (
      /^(?:cos[''][eè]\s+|che\s+cos[''][eè]\s+|what\s+is\s+|spiega(?:mi)?\s+)/i.test(c) ||
      /\b(?:parliamo\s+di\s+altro|cambiamo\s+argomento|let'?s\s+talk\s+about\s+something\s+else)\b/i.test(
        c,
      )
    ) {
      if (
        /\b(cos[''][eè]\s+|che\s+cos[''][eè]|what\s+is\s+|spiega|spiegami|eli5|insegn|teach\s+me|come\s+funziona)\b/i.test(
          c,
        )
      ) {
        return 'teaching'
      }
      return 'casual'
    }
    if (looksLikeBinaryChoice(c) || looksLikeDecisionAsk(c) || looksLikeMergeDecisionThreadCue(c)) {
      return 'decision_support'
    }
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
      /\b(pubblicare|quanto\s+costa|how\s+much\s+(?:does|to)|deploy|android|ios|iphone)\b/i.test(c)
    ) {
      return 'problem_solving'
    }
    if (
      /\b(finalmente\s+funziona|ce\s+l['']abbiamo\s+fatta|we\s+did\s+it|it\s+works)\b/i.test(c)
    ) {
      return 'celebration'
    }
    if (
      /\b(?:safe\s+to\s+merge|pronto\s+al\s+merge|ci\s+green|ci\s+verde|tests?\s+pass|preview\s+ready|preview\s+pronta)\b/i.test(
        c,
      )
    ) {
      return 'decision_support'
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
  if (
    looksLikeBinaryChoice(blob) ||
    looksLikeDecisionAsk(blob) ||
    looksLikeMergeDecisionThreadCue(blob) ||
    /\b(quale\s+scegl|meglio\s+tra|sceglieresti|faccio\s+merge|should\s+i\s+merge)\b/i.test(blob)
  ) {
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
 *   continueCue?: boolean
 *   priorOfferedAlternatives?: boolean
 *   playfulBanter?: boolean
 *   topicReturnCue?: boolean
 *   harmDistress?: boolean
 * }} ctx
 * @returns {ConversationMode}
 */
function inferConversationMode(userMessage, ctx) {
  const t = userMessage
  if (!t) return 'casual'

  if (ctx.stopDecline) return 'casual'

  if (ctx.harmDistress) return 'emotional_support'

  // #370B — soft discourse particles never stick to decision_support.
  if (looksLikeSoftDiscourseParticle(t)) return 'casual'

  // #370B — banter beats stay casual (before informational fallback).
  if (ctx.playfulBanter) return 'casual'

  if (ctx.isCorrection) {
    if (ctx.isTechnicalContext || ctx.priorMode === 'debugging') return 'debugging'
    if (ctx.priorMode) return ctx.priorMode
    return 'casual'
  }

  // #370B — topic return inherits prior substantive mode when available.
  if (ctx.topicReturnCue) {
    if (
      ctx.priorMode &&
      [
        'teaching',
        'informational',
        'debugging',
        'decision_support',
        'problem_solving',
        'brainstorming',
      ].includes(ctx.priorMode)
    ) {
      return ctx.priorMode
    }
    return ctx.priorMode || 'informational'
  }

  if (ctx.shortFollowUp) {
    if (ctx.priorMode) return ctx.priorMode
    if (ctx.isTechnicalContext) return 'debugging'
    if (/^(ahah+|haha+|lol|ahm+)/i.test(t)) return 'casual'
    // #362C — named contrast without priorMode still stays topical, not a fresh greeting.
    if (looksLikeNamedContrastFollowUp(t)) return 'informational'
    if (looksLikeChallengeFollowUp(t) && looksLikeDecisionAsk(t) === false) {
      return ctx.isTechnicalContext ? 'debugging' : 'casual'
    }
    if (looksLikeContinueCue(t) || ctx.continueCue) {
      return ctx.priorMode || (ctx.isTechnicalContext ? 'debugging' : 'casual')
    }
    return 'casual'
  }

  // Short pick keeps decision thread ONLY when prior assistant offered alternatives (#370B).
  if (
    ctx.priorMode === 'decision_support' &&
    ctx.priorOfferedAlternatives &&
    t.length <= 48 &&
    !looksLikeSoftDiscourseParticle(t) &&
    (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,40}\.?$/i.test(t) ||
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

  // #362B — frustrated failure vents → debugging (even without tech nouns).
  if (looksLikeFrustratedFailure(t)) {
    return 'debugging'
  }

  // #362B — repair / examples before short-casual length traps.
  if (looksLikeRepairCue(t) || looksLikeExamplesRequest(t)) {
    return 'teaching'
  }

  // #362B — playful challenge stays conversational (not sterile informational).
  if (looksLikePlayfulChallenge(t)) {
    return 'casual'
  }

  // #362B — exploration / boredom → brainstorming (one strong direction).
  if (looksLikeExplorationAsk(t)) {
    return 'brainstorming'
  }

  // #362B — go/no-go decisions (merge?, should I?).
  if (looksLikeDecisionAsk(t)) {
    return 'decision_support'
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
    /\b(spiega(?:mi|melo|lo)?|insegnami|approfondisci|fammi\s+capire|teach\s+me|explain|eli5|passo\s+passo\s+da\s+zero|walk\s+me\s+through|come\s+se\s+non\s+sapessi)\b/i.test(
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

  // Casual greetings / banter (boredom handled earlier as exploration/brainstorm).
  if (
    /^(ciao|hey|hi|hello|salve|yo|come\s+va\??|che\s+fai\??|come\s+stai\??|what'?s\s+up\??|how\s+are\s+you\??)[.!]*$/i.test(
      t,
    ) ||
    /^(ahah+|haha+|lol|eheh+)[.!]*$/i.test(t) ||
    looksLikeSeriousCue(t)
  ) {
    return 'casual'
  }

  // #362B — do not trap repair/examples/teach asks in the ≤24 casual bucket (handled above).
  if (
    t.length <= 24 &&
    !/[?]/.test(t) &&
    !/\b(spiega|explain|come|how|why|perch|esempi|example|capito|capisco|approfondisci|insegn)\b/i.test(
      t,
    )
  ) {
    return 'casual'
  }

  if (
    t.length <= 60 &&
    /\?$/.test(t) &&
    !looksLikeBinaryChoice(t) &&
    !looksLikeDecisionAsk(t) &&
    !looksLikePlayfulChallenge(t) &&
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
 *   playfulBanter?: boolean
 *   topicReturnCue?: boolean
 * }} ctx
 * @returns {ResponsePurpose}
 */
function inferResponsePurpose(userMessage, mode, ctx) {
  if (ctx.stopDecline) return 'react'
  if (ctx.isCorrection) return 'continue'
  if (ctx.playfulBanter) return 'react'
  if (ctx.topicReturnCue) return 'continue'
  if (ctx.continueCue || (ctx.shortFollowUp && looksLikeContinueCue(userMessage))) {
    return 'continue'
  }
  if (ctx.completionCue) return 'react'
  if (ctx.shortFollowUp) {
    if (/^(continua|continuiamo|vai|avanti|e\s*poi|go|continue|next)/i.test(userMessage)) {
      return 'continue'
    }
    if (/^(perch|why|come\??|how\??)/i.test(userMessage)) return 'explain'
    // #362C — confidence/pushback: reaffirm or adjust; do not discard the thread.
    if (looksLikeChallengeFollowUp(userMessage)) {
      if (mode === 'decision_support' || mode === 'teaching' || mode === 'informational') {
        return 'explain'
      }
      return 'continue'
    }
    if (looksLikeNamedContrastFollowUp(userMessage)) {
      if (mode === 'informational' || mode === 'teaching' || mode === 'quick_answer') {
        return 'explain'
      }
      return 'continue'
    }
    if (/^(ahah|haha|lol|ok|s[iì]|esatto|yep|yeah)/i.test(userMessage)) return 'react'
    return 'continue'
  }

  // Short pick after a decision → continue the recommendation thread.
  // Do not trap fresh go/no-go asks ("Faccio merge?") as continue.
  // #370B — soft discourse particles are handled via completionCue above.
  if (
    mode === 'decision_support' &&
    userMessage.length <= 48 &&
    !looksLikeBinaryChoice(userMessage) &&
    !looksLikeDecisionAsk(userMessage) &&
    !looksLikeSoftDiscourseParticle(userMessage)
  ) {
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
    if (looksLikePlayfulChallenge(userMessage)) return 'recommend'
    if (looksLikeExplorationAsk(userMessage) || /\bmi\s+annoio\b/i.test(userMessage)) {
      return 'brainstorm'
    }
    return 'react'
  }
  if (mode === 'emotional_support') return 'comfort'
  if (mode === 'brainstorming') return 'brainstorm'
  if (mode === 'decision_support') return 'recommend'
  if (mode === 'teaching' || mode === 'informational') {
    if (looksLikeRepairCue(userMessage) || looksLikeExamplesRequest(userMessage)) return 'explain'
    return 'explain'
  }
  if (mode === 'debugging' || mode === 'problem_solving') return 'continue'
  if (mode === 'quick_answer') return 'answer'
  if (/\b(chiaris|clarify|intendi|you\s+mean)\b/i.test(userMessage)) return 'clarify'
  return 'answer'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{ playfulBanter?: boolean, harmDistress?: boolean }} [opts]
 * @returns {EmotionalTone}
 */
function inferEmotionalTone(userMessage, mode, opts = {}) {
  const t = userMessage
  if (opts.harmDistress || looksLikeHarmDistressCue(t)) return 'serious'
  if (looksLikeSeriousCue(t)) return 'serious'
  if (mode === 'emotional_support') return 'serious'
  if (mode === 'celebration') return 'celebratory'
  if (opts.playfulBanter) return 'playful'
  if (looksLikePlayfulChallenge(t)) return 'playful'

  // Frustration before laugh-as-playful ("Che palle 😂").
  if (
    looksLikeFrustratedFailure(t) ||
    /\b(che\s+palle|non\s+funziona|still\s+broken|frustrat|odio|damn|shit|cavolo)\b/i.test(t)
  ) {
    return 'frustrated'
  }

  if (
    /!{2,}/.test(t) ||
    /\b(wow+|finalmente|figata|fantastico|amazing|awesome|yay+)\b/i.test(t)
  ) {
    return mode === 'celebration' ? 'celebratory' : 'excited'
  }

  // #370B — laugh cues → playful when not harm/serious/substantive-question-only.
  if (looksLikeLaughCue(t) && !looksLikeSubstantiveQuestion(t)) {
    return 'playful'
  }
  if (/^(ahah+|haha+|lol|eheh+)/i.test(t) || /\b(ahah+|haha+|lol)\b/i.test(t)) {
    return 'playful'
  }

  if (/\b(seria(?:mente)?|serious(?:ly)?|importante|urgent|grave)\b/i.test(t)) {
    return 'serious'
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
  // #362B — repair/examples: reframe or concrete samples, not encyclopedic dumps.
  if (looksLikeRepairCue(userMessage) || looksLikeExamplesRequest(userMessage)) {
    depth = 'medium'
  }
  if (
    /\b(?:spiegami\s+bene|in\s+dettaglio|approfondisci|pi[uù]\s+in\s+profondit[aà]|thoroughly|in\s+depth|walk\s+me\s+through)\b/i.test(
      userMessage,
    )
  ) {
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

  // #362B — seriousness / frustration before informational defaults.
  if (tone === 'serious') return 'none'
  if (tone === 'frustrated') return 'none'
  if (mode === 'emotional_support') return 'none'

  if (mode === 'celebration' || tone === 'celebratory' || tone === 'excited') {
    return 'expressive'
  }
  if (tone === 'playful' || mode === 'casual' || mode === 'brainstorming') return 'moderate'
  if (mode === 'debugging') return 'light'
  if (mode === 'informational' || mode === 'quick_answer' || mode === 'teaching') return 'light'
  if (mode === 'decision_support') return 'light'
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
  if (ctx.completionCue) return false
  if (ctx.isCorrection) return false
  // Narrow #330 social reciprocal: one earned question on a simple greeting beat only.
  if (
    looksLikeSimpleSocialGreeting(userMessage) &&
    (mode === 'casual' || purpose === 'react') &&
    !ctx.stopDecline
  ) {
    return true
  }
  if (purpose === 'react') return false
  if (mode === 'celebration' || mode === 'quick_answer') return false
  if (mode === 'informational' || mode === 'teaching') return false
  if (mode === 'debugging' && !/\b(non\s+so|manca|missing|which|quale\s+file)\b/i.test(userMessage)) {
    return false
  }
  if (mode === 'brainstorming') return false
  // Decision: go/no-go asks recommend+stop; binary without options may still need input.
  if (mode === 'decision_support' || purpose === 'recommend') {
    if (looksLikeDecisionAsk(userMessage) && !looksLikeBinaryChoice(userMessage)) {
      return false
    }
    if (looksLikeChallengeFollowUp(userMessage)) return false
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
  if (looksLikeExamplesRequest(userMessage)) return 'structured'
  if (
    /\b(lista|elenca|elenco|table|tabella|confronta|compare|bullet|punti\s+elenco|fammi\s+una\s+lista|passaggi|steps?\b|checklist)\b/i.test(
      userMessage,
    )
  ) {
    return 'structured'
  }
  // Debugging / multi-step procedures benefit from scanning (#367B keeps this).
  if (mode === 'debugging') return 'structured'
  // Ordinary informational / teaching / decision / brainstorm → prose-first (#367B).
  // light_structure only when problem_solving needs a light scaffold.
  if (mode === 'problem_solving') return 'light_structure'
  return 'prose'
}

/**
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {string} userMessage
 * @param {{ threadEvidence?: import('./thread-decision-evidence.js').ThreadDecisionEvidence | null }} [opts]
 * @returns {ConfidenceLevel}
 */
function inferConfidence(mode, purpose, userMessage, opts = {}) {
  const evidence = opts.threadEvidence || null

  if (purpose === 'recommend' || mode === 'decision_support') {
    // #369B — hedges / incomplete evidence beat length heuristics.
    if (evidence?.hedged || looksLikeEvidenceHedge(userMessage)) {
      return 'low'
    }
    if (evidence?.blocking) {
      // High confidence in a wait/no recommendation when blockers are established.
      return 'high'
    }
    if (evidence?.completeGo) {
      return 'high'
    }
    if (looksLikeBinaryChoice(userMessage)) return 'high'
    if (/\b(due|two|a\s+o\s+b|questi\s+due|these\s+two|nome[s]?)\b/i.test(userMessage)) {
      return 'high'
    }
    // Partial user evidence → medium (name gaps; never invent).
    if (evidence?.hasAny) return 'medium'
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
