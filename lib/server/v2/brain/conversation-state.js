/**
 * LAIfe V2 — Conversation State (Phase 2)
 *
 * First-class stage: WHAT IS CURRENTLY TRUE about the conversation.
 *
 * Owns situation facts only:
 *   activeTopic, activeGoal, conversationMode, conversationPhase,
 *   engagement, previousAssistantMove, pendingProposal, shortReply, continuity
 *
 * Does NOT:
 *   - generate user-facing prose
 *   - choose response strategy / objective / conversational move for Writer
 *   - call an LLM
 *
 * Planner owns WHAT SHOULD HAPPEN NEXT.
 * Writer owns HOW TO SAY IT.
 *
 * Pipeline position: Perception → Conversation State → Mind → Planner → Writer
 *
 * Focus / Resume / Director decision logic may still run inside Planner;
 * this module is the single publisher of activeTopic and related situation facts.
 */

import {
  interpretShortReply,
  hasUnresolvedConversationalProposal,
  inferPendingProposalType,
  splitLatestTurns,
} from './short-reply.js'
import {
  resumeConversation,
  inferCurrentTopic,
  inferProgress,
  inferUnresolvedQuestions,
  normalizeMessages,
} from './conversation-resume.js'
import {
  evaluateConversationFocus,
  evaluateConversationMomentum,
  estimateUserEngagement,
  isEncouragementContinuation,
} from './planner.js'

export const CONVERSATION_STATE_VERSION = '2.0.0-conversation-state'

/**
 * @typedef {'learning'|'debugging'|'planning'|'casual_conversation'|'exploration'|'decision_support'|'task_execution'|'casual_exploration'|null} ActiveGoal
 */

/**
 * @typedef {'social'|'brainstorming'|'learning'|'debugging'|'planning'|'decision'|'storytelling'|'emotional_support'|'exploration'|null} ConversationMode
 */

/**
 * @typedef {'opening'|'exploring'|'deepening'|'executing'|'clarifying'|'recovering'|'closing'|null} ConversationPhase
 */

/**
 * @typedef {'low'|'medium'|'high'|'uncertain'|null} EngagementLevel
 */

/**
 * @typedef {'answer'|'ask_question'|'offer_explanation'|'offer_topic'|'tell_story'|'give_steps'|'clarify'|'acknowledge'|'close'|null} PreviousAssistantMove
 */

/**
 * @typedef {object} PendingProposal
 * @property {string} type
 * @property {string|null} topic
 * @property {string} [source]
 */

/**
 * @typedef {object} ContinuityState
 * @property {boolean} shouldResume
 * @property {string|null} resumeTopic
 * @property {string|null} resumePoint
 */

/**
 * @typedef {object} ConversationState
 * @property {string|null} activeTopic
 * @property {ActiveGoal|string|null} activeGoal
 * @property {ConversationMode|string|null} conversationMode
 * @property {ConversationPhase} conversationPhase
 * @property {EngagementLevel} engagement
 * @property {PreviousAssistantMove} previousAssistantMove
 * @property {PendingProposal|null} pendingProposal
 * @property {{ intent: string|null, confidence: number|null, isShortReply?: boolean, conversationalMove?: string|null }} shortReply
 * @property {ContinuityState} continuity
 * @property {{ unresolved: string[] }} references
 * @property {object} [diagnostics] non-authoritative debug signals (Focus/Resume/Director inputs)
 * @property {string} [version]
 */

const TOPIC_CHANGE_EXPLICIT_RE =
  /\b(parliamo\s+invece\s+(di|dell[aeo'’]?|degli|delle)?|cambiando\s+argomento|un['’]?altra\s+cosa|lasciamo\s+stare|instead\s+let'?s|let'?s\s+talk\s+about|parliamo\s+di)\b/i

const CONTINUATION_REF_RE =
  /^(e\s+quello|e\s+quella|e\s+questo|e\s+questa|il\s+secondo|la\s+seconda|perch[eé]\??|why\??|continua\.?|vai\.?|s[iì]\.?|ok\.?)\b/i

const BOREDOM_RE =
  /\b(mi\s+annoio|annoiato|bored|non\s+so\s+(di\s+)?cosa\s+(fare|parlare)|nothing\s+to\s+do)\b/i

const CLOSING_RE =
  /\b(basta(\s+cos[iì])?|grazie[,.]?\s*(basta|a\s+presto)?|stop(\s+here)?|chiudiamo|nient['’]?altro|ho\s+finito|enough)\b/i

const RESUME_CUE_RE =
  /\b(riprendiamo|riprendere|da\s+dove\s+(?:avevamo|eravamo)\s+lasciato|continuiamo|dove\s+eravamo\s+rimasti|where\s+we\s+left)\b/i

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
 * @param {unknown} messages
 * @returns {Array<{ role: string, content: string }>}
 */
function listMessages(messages) {
  return normalizeMessages(messages).map((m) => ({
    role: asString(m.role).toLowerCase(),
    content: asString(m.content).trim(),
  }))
}

/**
 * Map Director/Focus engagement onto a compact EngagementLevel.
 * @param {string} raw
 * @returns {EngagementLevel}
 */
function normalizeEngagement(raw) {
  const e = asString(raw)
  if (e === 'low') return 'low'
  if (e === 'uncertain') return 'uncertain'
  if (e === 'high' || e === 'maximum') return 'high'
  if (e === 'engaged') return 'medium'
  return 'medium'
}

/**
 * Map former Conversation Momentum kinds → conversationMode.
 * @param {string} kind
 * @returns {ConversationMode}
 */
function momentumKindToMode(kind) {
  const k = asString(kind)
  if (
    k === 'social' ||
    k === 'brainstorming' ||
    k === 'learning' ||
    k === 'debugging' ||
    k === 'planning' ||
    k === 'decision' ||
    k === 'storytelling' ||
    k === 'emotional_support'
  ) {
    return /** @type {ConversationMode} */ (k)
  }
  return 'social'
}

/**
 * Infer user's ongoing conversational goal (not Mind/Planner strategy).
 * @param {string} latestUser
 * @param {object} perception
 * @param {ConversationMode} mode
 * @param {import('./short-reply.js').ShortReplyState} shortReply
 * @returns {ActiveGoal|string|null}
 */
function inferActiveGoal(latestUser, perception, mode, shortReply) {
  const text = asString(latestUser)
  const intent = asString(perception?.intent)

  if (shortReply?.intent === 'stop' || CLOSING_RE.test(text)) return null
  if (BOREDOM_RE.test(text) || intent === 'boredom') return 'casual_exploration'
  if (intent === 'exploration') return 'exploration'
  if (intent === 'learning' || mode === 'learning') return 'learning'
  if (intent === 'problem_solving' || mode === 'debugging') return 'debugging'
  if (mode === 'planning') return 'planning'
  if (mode === 'decision') return 'decision_support'
  if (mode === 'social' || intent === 'small_talk' || intent === 'companionship') {
    return 'casual_conversation'
  }
  if (mode === 'brainstorming') return 'exploration'
  if (intent === 'advice') return 'decision_support'
  return mode === 'storytelling' ? 'casual_conversation' : null
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {import('./short-reply.js').ShortReplyState} shortReply
 * @param {object} perception
 * @param {object} focus
 * @returns {ConversationPhase}
 */
function inferConversationPhase(messages, shortReply, perception, focus) {
  const latestUser = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  })()

  if (shortReply?.intent === 'stop' || CLOSING_RE.test(latestUser)) return 'closing'
  if (shortReply?.intent === 'uncertain') return 'clarifying'
  if (
    shortReply?.intent === 'accept_proposal' ||
    shortReply?.conversationalMove === 'execute_pending_proposal'
  ) {
    return 'executing'
  }
  if (asString(perception?.conversationStage) === 'repair') return 'recovering'

  const userTurns = messages.filter((m) => m.role === 'user').length
  const assistantTurns = messages.filter((m) => m.role === 'assistant').length

  if (userTurns <= 1 && assistantTurns === 0) return 'opening'
  if (focus?.status === 'changed') return 'exploring'
  if (userTurns >= 4 && focus?.status === 'active') return 'deepening'
  if (focus?.status === 'active' || shortReply?.intent === 'continue') return 'deepening'
  if (userTurns <= 2) return 'opening'
  return 'exploring'
}

/**
 * Normalize last assistant act into a small move vocabulary.
 * @param {string} assistantText
 * @param {boolean} hasProposal
 * @param {string|null} proposalType
 * @returns {PreviousAssistantMove}
 */
function inferPreviousAssistantMove(assistantText, hasProposal, proposalType) {
  const t = asString(assistantText).replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/^(ok|okay|va bene|capisco|perfetto|d['’]accordo)\.?$/i.test(t)) return 'acknowledge'
  if (/\?\s*$/.test(t) && hasProposal) {
    if (proposalType === 'explain') return 'offer_explanation'
    if (proposalType === 'tell_curiosity') return 'tell_story'
    if (proposalType === 'explore_topic') return 'offer_topic'
    return 'ask_question'
  }
  if (hasProposal) {
    if (proposalType === 'explain') return 'offer_explanation'
    if (proposalType === 'tell_curiosity') return 'tell_story'
    if (proposalType === 'explore_topic') return 'offer_topic'
    if (proposalType === 'continue_part') return 'give_steps'
    return 'offer_topic'
  }
  if (/\?\s*$/.test(t)) return 'ask_question'
  if (/\b(passo|step|1\.|2\.|procedura)\b/i.test(t)) return 'give_steps'
  if (/\b(raccont|storia|curiosit)/i.test(t)) return 'tell_story'
  if (/\b(spieg|funzion|perch[eé])\b/i.test(t)) return 'answer'
  if (/\b(grazie|a presto|quando vuoi)\b/i.test(t)) return 'close'
  return 'answer'
}

/**
 * Extract a short topic label from an assistant proposal utterance.
 * @param {string} assistantText
 * @returns {string|null}
 */
function topicFromProposalText(assistantText) {
  const t = asString(assistantText).replace(/\s+/g, ' ').trim()
  if (!t) return null
  const m =
    t.match(
      /\b(?:su|sul|sulla|dei|degli|delle|di|about|regarding)\s+([A-ZÁÉÍÓÚÀÈÌÒÙa-záéíóúàèìòù][\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù'’ -]{2,60})/i,
    ) ||
    t.match(
      /\b(?:curiosit[aà]|storia|spiegazione)\s+(?:su|sul|sulla|di|dei)\s+([^.!?]{3,60})/i,
    )
  if (m && m[1]) {
    return m[1].replace(/[.!?].*$/, '').trim().slice(0, 80) || null
  }
  return null
}

/**
 * ONE authoritative active topic from Focus + Resume + prior state + short-reply continuity.
 * @param {{
 *   messages: Array<{ role: string, content: string }>,
 *   focus: { topic?: string|null, status?: string },
 *   resume: { currentTopic?: string|null },
 *   previousState?: ConversationState|null,
 *   shortReply: import('./short-reply.js').ShortReplyState,
 *   latestUser: string,
 * }} args
 * @returns {string|null}
 */
function resolveActiveTopic(args) {
  const { messages, focus, resume, previousState, shortReply, latestUser } = args
  const priorTopic =
    (previousState && previousState.activeTopic) ||
    focus?.topic ||
    resume?.currentTopic ||
    inferCurrentTopic(messages) ||
    null

  // Explicit topic change wins.
  if (focus?.status === 'changed' && TOPIC_CHANGE_EXPLICIT_RE.test(latestUser)) {
    const next =
      focus.topic ||
      inferCurrentTopic([
        ...messages.slice(0, -1),
        { role: 'user', content: latestUser },
      ]) ||
      latestUser
        .replace(TOPIC_CHANGE_EXPLICIT_RE, '')
        .replace(/^[^\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù]+/i, '')
        .trim()
    if (next) return asString(next).slice(0, 80)
  }

  if (focus?.status === 'changed' && focus.topic) {
    return focus.topic
  }

  // Short continuation / pronouns / "ok" / "E quello?" → keep living topic.
  if (
    shortReply?.intent === 'accept_proposal' ||
    shortReply?.intent === 'continue' ||
    shortReply?.intent === 'passive_acknowledgement' ||
    shortReply?.intent === 'uncertain' ||
    isEncouragementContinuation(latestUser) ||
    CONTINUATION_REF_RE.test(latestUser)
  ) {
    return priorTopic || focus?.topic || resume?.currentTopic || null
  }

  if (focus?.status === 'active' && focus.topic) return focus.topic
  return priorTopic
}

/**
 * Build pending proposal from last substantive assistant + short-reply signals.
 * Cleared when executed, declined, stopped, or topic changed.
 * @param {{
 *   shortReply: import('./short-reply.js').ShortReplyState,
 *   activeTopic: string|null,
 *   previousState?: ConversationState|null,
 *   focusStatus?: string,
 * }} args
 * @returns {PendingProposal|null}
 */
function resolvePendingProposal(args) {
  const { shortReply, activeTopic, previousState, focusStatus } = args

  if (shortReply?.intent === 'stop') return null
  if (shortReply?.intent === 'change_topic' || focusStatus === 'changed') return null

  // After accept/continue, the proposal is considered consumed for the next turn's state.
  // For THIS turn Planner still sees it so it can execute — we keep it while intent is accept/continue.
  if (shortReply?.intent === 'passive_acknowledgement') {
    return null
  }

  if (shortReply?.hasPendingProposal && shortReply.pendingProposalType) {
    return {
      type: shortReply.pendingProposalType,
      topic:
        topicFromProposalText(shortReply.previousAssistant) ||
        activeTopic ||
        previousState?.pendingProposal?.topic ||
        null,
      source: 'assistant_offer',
    }
  }

  // Carry prior pending only if still unresolved and not executed last turn.
  if (
    previousState?.pendingProposal &&
    shortReply?.intent !== 'accept_proposal' &&
    shortReply?.intent !== 'continue' &&
    shortReply?.intent !== 'not_short_reply'
  ) {
    // Long substantive reply without acceptance → clear stale proposal.
    if (!shortReply?.isShortReply) return null
  }

  if (
    previousState?.pendingProposal &&
    (shortReply?.intent === 'uncertain' || shortReply?.isShortReply)
  ) {
    return previousState.pendingProposal
  }

  return null
}

/**
 * Continuity facts for resume — never store prose / suggestedResumeSentence as state.
 * @param {{
 *   resume: ReturnType<typeof resumeConversation>,
 *   activeTopic: string|null,
 *   latestUser: string,
 *   shortReply: import('./short-reply.js').ShortReplyState,
 *   messages: Array<{ role: string, content: string }>,
 * }} args
 * @returns {ContinuityState}
 */
function resolveContinuity(args) {
  const { resume, activeTopic, latestUser, shortReply, messages } = args
  const progress = Array.isArray(resume?.progress) ? resume.progress : []
  const lastProgress = progress.length ? progress[progress.length - 1] : null
  const resumeTopic = resume?.currentTopic || activeTopic || null
  const cue =
    RESUME_CUE_RE.test(latestUser) ||
    shortReply?.intent === 'continue' ||
    isEncouragementContinuation(latestUser)

  const hasHistory =
    messages.filter((m) => m.role === 'assistant').length >= 1 &&
    messages.filter((m) => m.role === 'user').length >= 1

  const shouldResume = Boolean(
    hasHistory &&
      resumeTopic &&
      (cue || (progress.length > 0 && shortReply?.intent === 'continue')),
  )

  return {
    shouldResume,
    resumeTopic: shouldResume || resumeTopic ? resumeTopic : null,
    resumePoint: lastProgress || (shouldResume ? resumeTopic : null),
  }
}

/**
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
export function freezeConversationState(state) {
  if (!state || typeof state !== 'object') return state
  const frozen = {
    ...state,
    shortReply: Object.freeze({ ...(state.shortReply || {}) }),
    continuity: Object.freeze({ ...(state.continuity || {}) }),
    references: Object.freeze({
      unresolved: Object.freeze([...(state.references?.unresolved || [])]),
    }),
    pendingProposal: state.pendingProposal
      ? Object.freeze({ ...state.pendingProposal })
      : null,
    diagnostics: state.diagnostics ? Object.freeze({ ...state.diagnostics }) : undefined,
  }
  return Object.freeze(frozen)
}

/**
 * Clear pending proposal after Planner executes or declines it (next-turn helper).
 * @param {ConversationState} state
 * @param {'executed'|'declined'|'replaced'|'moved_on'} [reason]
 * @returns {ConversationState}
 */
export function clearPendingProposal(state, reason = 'executed') {
  void reason
  if (!state || typeof state !== 'object') return state
  return freezeConversationState({
    ...state,
    pendingProposal: null,
    diagnostics: {
      ...(state.diagnostics && typeof state.diagnostics === 'object' ? state.diagnostics : {}),
      pendingProposalCleared: reason,
    },
  })
}

/**
 * Build first-class Conversation State for the current turn.
 * Deterministic. No LLM. No prose generation.
 *
 * @param {{
 *   messages?: Array<{ role?: string, content?: string }>,
 *   perception?: object,
 *   previousState?: ConversationState|null,
 *   shortReplyState?: import('./short-reply.js').ShortReplyState|null,
 *   decision?: object,
 *   freeze?: boolean,
 * }} [input]
 * @returns {ConversationState}
 */
export function buildConversationState(input = {}) {
  const messages = listMessages(input.messages)
  const perception =
    input.perception && typeof input.perception === 'object' ? input.perception : {}
  const previousState =
    input.previousState && typeof input.previousState === 'object'
      ? input.previousState
      : null
  const decision =
    input.decision && typeof input.decision === 'object' ? input.decision : {}

  const turns = splitLatestTurns(messages)
  const latestUser = turns.userText

  // Authoritative short-reply (Phase 1) — do not re-classify elsewhere.
  const shortReplyFull =
    input.shortReplyState && typeof input.shortReplyState === 'object'
      ? input.shortReplyState
      : interpretShortReply({ messages })

  // Resume: useful facts only (topic/goal/progress). Prose sentence is NOT state.
  const resume = resumeConversation({ messages })

  // Focus / mode signals (compat with existing Planner heuristics).
  // Decision is optional — State runs before Mind, so decision may be empty.
  const focus = evaluateConversationFocus(messages, decision, perception)
  const momentum = evaluateConversationMomentum(messages, decision, perception)
  const engagementInfo = estimateUserEngagement(latestUser, focus)

  const conversationMode = momentumKindToMode(momentum.kind)
  // Boredom / open exploration: prefer exploration-shaped mode without choosing curiosity.
  const mode =
    BOREDOM_RE.test(latestUser) || asString(perception.intent) === 'boredom'
      ? /** @type {ConversationMode} */ ('exploration')
      : conversationMode === 'social' && asString(perception.intent) === 'exploration'
        ? /** @type {ConversationMode} */ ('exploration')
        : conversationMode

  const activeTopic = resolveActiveTopic({
    messages,
    focus,
    resume,
    previousState,
    shortReply: shortReplyFull,
    latestUser,
  })

  let pendingProposal = resolvePendingProposal({
    shortReply: shortReplyFull,
    activeTopic,
    previousState,
    focusStatus: focus.status,
  })

  // If this turn executes the proposal, keep it visible for Planner THIS turn,
  // and mark diagnostics so the next build can clear via previousState + executed flag.
  if (
    shortReplyFull.intent === 'accept_proposal' ||
    shortReplyFull.intent === 'continue'
  ) {
    if (!pendingProposal && shortReplyFull.hasPendingProposal) {
      pendingProposal = {
        type: shortReplyFull.pendingProposalType || 'open_offer',
        topic: topicFromProposalText(shortReplyFull.previousAssistant) || activeTopic,
        source: 'assistant_offer',
      }
    }
  }

  const previousAssistantMove = inferPreviousAssistantMove(
    shortReplyFull.previousAssistant || turns.lastSubstantiveAssistant,
    Boolean(pendingProposal) || shortReplyFull.hasPendingProposal,
    pendingProposal?.type || shortReplyFull.pendingProposalType,
  )

  const engagement = normalizeEngagement(engagementInfo.engagement)
  const activeGoal = inferActiveGoal(latestUser, perception, mode, shortReplyFull)
  const conversationPhase = inferConversationPhase(
    messages,
    shortReplyFull,
    perception,
    focus,
  )
  const continuity = resolveContinuity({
    resume,
    activeTopic,
    latestUser,
    shortReply: shortReplyFull,
    messages,
  })

  const unresolved = inferUnresolvedQuestions(messages)

  /** @type {ConversationState} */
  const state = {
    activeTopic,
    activeGoal,
    conversationMode: mode,
    conversationPhase,
    engagement,
    previousAssistantMove,
    pendingProposal,
    shortReply: {
      intent: shortReplyFull.intent || null,
      confidence:
        typeof shortReplyFull.confidence === 'number' ? shortReplyFull.confidence : null,
      isShortReply: Boolean(shortReplyFull.isShortReply),
      conversationalMove: shortReplyFull.conversationalMove || null,
    },
    continuity,
    references: {
      unresolved,
    },
    diagnostics: {
      focusStatus: focus.status,
      focusTopic: focus.topic,
      focusConfidence: focus.confidence,
      momentumKind: momentum.kind,
      momentumConfidence: momentum.confidence,
      resumeConfidence: resume.confidence,
      resumeCurrentGoal: resume.currentGoal,
      resumeProgress: inferProgress(messages),
      engagementRaw: engagementInfo.engagement,
      continuationType: engagementInfo.continuationType,
      hasUnresolvedProposal: hasUnresolvedConversationalProposal(
        shortReplyFull.previousAssistant,
      ),
      proposalType: inferPendingProposalType(shortReplyFull.previousAssistant),
      // Full Phase-1 short-reply record (authoritative; not a second classifier).
      shortReplyFull,
      // Compat mirrors for Planner adapters (not competing authorities)
      focusSignals: focus.signals,
      focusAvoidClarification: focus.avoidClarification,
      version: CONVERSATION_STATE_VERSION,
    },
    version: CONVERSATION_STATE_VERSION,
  }

  const shouldFreeze = input.freeze !== false
  return shouldFreeze ? freezeConversationState(state) : state
}

/**
 * Adapt Conversation State shortReply slice back to ShortReplyState shape for Planner.
 * @param {ConversationState} conversationState
 * @param {Array<{ role?: string, content?: string }>} [messages]
 * @returns {import('./short-reply.js').ShortReplyState}
 */
export function shortReplyStateFromConversationState(conversationState, messages = []) {
  if (conversationState?.diagnostics?.shortReplyFull) {
    return /** @type {any} */ (conversationState.diagnostics.shortReplyFull)
  }
  // Re-read authoritative interpreter (same pure function) — never a second classifier.
  return interpretShortReply({ messages })
}

/**
 * @param {unknown} value
 * @returns {value is ConversationState}
 */
export function isConversationState(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return (
    (v.activeTopic === null || typeof v.activeTopic === 'string') &&
    v.shortReply &&
    typeof v.shortReply === 'object' &&
    v.continuity &&
    typeof v.continuity === 'object' &&
    typeof v.continuity.shouldResume === 'boolean' &&
    v.references &&
    Array.isArray(v.references.unresolved)
  )
}

/**
 * Dev/test invariant checks (warnings only — never throw in production paths).
 * @param {ConversationState} state
 * @param {{ warn?: (msg: string) => void }} [opts]
 * @returns {string[]}
 */
export function assertConversationStateInvariants(state, opts = {}) {
  const warn = opts.warn || ((msg) => console.warn(`[conversation-state] ${msg}`))
  /** @type {string[]} */
  const issues = []
  const push = (msg) => {
    issues.push(msg)
    warn(msg)
  }

  if (!isConversationState(state)) {
    push('Conversation State schema invalid')
    return issues
  }
  if (typeof state.activeTopic === 'string' && /\n{2,}/.test(state.activeTopic)) {
    push('activeTopic looks like multi-paragraph prose')
  }
  if (state.continuity && 'suggestedResumeSentence' in /** @type {any} */ (state.continuity)) {
    push('Conversation State must not store resume prose')
  }
  if (Object.isFrozen && !Object.isFrozen(state)) {
    push('Conversation State should be frozen (immutability)')
  }
  return issues
}
