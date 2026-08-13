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
import {
  BOREDOM_RE,
  TOPIC_CHANGE_RE,
  CORRECTION_RE,
  STOP_CUE_RE,
  isConversationSignals,
} from './conversation-signals.js'

export const CONVERSATION_STATE_VERSION = '3.2.0-conversation-state'

/** Max idle user turns an open proposal may survive without acceptance. */
export const PENDING_PROPOSAL_MAX_IDLE_TURNS = 2

/**
 * Normalize first phrase for rolling opener history (QA; not Memory).
 * @param {string} text
 * @returns {string}
 */
function normalizeAssistantOpener(text) {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return ''
  const first = raw.split(/(?<=[.!?…])\s+/)[0] || raw
  return first
    .slice(0, 80)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @returns {string}
 */
function stockOpenerKeyFromText(text) {
  const opener = normalizeAssistantOpener(text)
  if (!opener) return ''
  const m = opener.match(
    /^(capisco( perfettamente)?|certamente|assolutamente|perfetto|va bene|ottima domanda|great question|of course|absolutely|certainly|sure|certo)\b/,
  )
  return m ? m[1].replace(/\s+/g, ' ') : ''
}

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
 * @typedef {'answer'|'ask_question'|'offer_explanation'|'offer_topic'|'tell_story'|'give_steps'|'clarify'|'acknowledge'|'close'|string|null} PreviousAssistantMove
 */

/**
 * @typedef {'open'|'accepted'|'executing'|'completed'|'declined'|'superseded'|'expired'} PendingProposalStatus
 */

/**
 * @typedef {object} PendingProposal
 * @property {string} type
 * @property {string|null} topic
 * @property {PendingProposalStatus} [status]
 * @property {string} [source]
 * @property {number} [idleTurns] consecutive turns without accept/continue
 * @property {number} [openedTurn] opaque turn counter when opened
 */

/**
 * Compact previous assistant move record (Phase 3).
 * @typedef {object} PreviousAssistantMoveRecord
 * @property {string|null} type
 * @property {string|null} [topic]
 * @property {boolean} [hadOpenProposal]
 * @property {string|null} [conversationalMove]
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
 * @property {PreviousAssistantMove|PreviousAssistantMoveRecord|null} previousAssistantMove
 * @property {PendingProposal|null} pendingProposal
 * @property {{ intent: string|null, confidence: number|null, isShortReply?: boolean, conversationalMove?: string|null }} shortReply
 * @property {ContinuityState} continuity
 * @property {{ unresolved: string[] }} references
 * @property {number} [turnCount] persisted turn counter for expiry
 * @property {import('./adaptive-response-profile.js').AdaptiveResponseProfile} [responseProfile] last adaptive HOW profile (soft stabilizer)
 * @property {string[]} [recentOpeners] rolling normalized assistant openers (QA only; not Memory)
 * @property {object} [diagnostics] non-authoritative debug signals (not persisted)
 * @property {string} [version]
 */

const CONTINUATION_REF_RE =
  /^(e\s+quello|e\s+quella|e\s+questo|e\s+questa|il\s+secondo|la\s+seconda|perch[eé]\??|why\??|continua\.?|vai\.?|s[iì]\.?|ok\.?)\b/i

const RESUME_CUE_RE =
  /\b(riprendiamo|riprendere|da\s+dove\s+(?:avevamo|eravamo)\s+lasciato|continuiamo|dove\s+eravamo\s+rimasti|where\s+we\s+left)\b/i

const TASK_EXECUTION_RE =
  /\b(scrivimi\s+una\s+funzione|write\s+(me\s+)?a\s+function|quanto\s+fa|calcola|implementa|debug(ga)?\s+quest|sort(a|are)?\s+un\s+array|javascript|typescript|python\s+code)\b/i

const DECLINE_CUE_RE =
  /^(no|nope|nah|no\s+grazie|preferisco\s+di\s+no|non\s+ora|not\s+now|no\s+thanks)[.!…]*$/i

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
 * @param {import('./conversation-signals.js').ConversationSignals|null} [turnSignals]
 * @returns {ActiveGoal|string|null}
 */
function inferActiveGoal(latestUser, perception, mode, shortReply, turnSignals = null) {
  const text = asString(latestUser)
  const intent = asString(perception?.intent)
  const bored =
    (turnSignals && turnSignals.affect.boredom >= 0.55) ||
    BOREDOM_RE.test(text) ||
    intent === 'boredom'
  const stop =
    shortReply?.intent === 'stop' ||
    (turnSignals && turnSignals.interaction.stopCue) ||
    STOP_CUE_RE.test(text)

  if (stop) return null
  if (bored) return 'casual_exploration'
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
 * @param {import('./conversation-signals.js').ConversationSignals|null} [turnSignals]
 * @returns {ConversationPhase}
 */
function inferConversationPhase(messages, shortReply, perception, focus, turnSignals = null) {
  const latestUser = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  })()

  if (
    shortReply?.intent === 'stop' ||
    (turnSignals && turnSignals.interaction.stopCue) ||
    STOP_CUE_RE.test(latestUser)
  ) {
    return 'closing'
  }
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
  if (focus?.status === 'changed' || (turnSignals && turnSignals.interaction.topicChangeCue)) {
    return 'exploring'
  }
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
 * ONE authoritative active topic from prior State + Focus signals + Resume.
 * Prefers previousState when still valid (incremental evolution).
 * @param {{
 *   messages: Array<{ role: string, content: string }>,
 *   focus: { topic?: string|null, status?: string },
 *   resume: { currentTopic?: string|null },
 *   previousState?: ConversationState|null,
 *   shortReply: import('./short-reply.js').ShortReplyState,
 *   latestUser: string,
 *   perception?: object,
 * }} args
 * @returns {string|null}
 */
function resolveActiveTopic(args) {
  const {
    messages,
    focus,
    resume,
    previousState,
    shortReply,
    latestUser,
    conversationSignals,
  } = args
  const priorTopic =
    (previousState && previousState.activeTopic) ||
    focus?.topic ||
    resume?.currentTopic ||
    inferCurrentTopic(messages) ||
    null

  const topicChange =
    (conversationSignals && conversationSignals.interaction.topicChangeCue) ||
    TOPIC_CHANGE_RE.test(latestUser)
  const correction =
    (conversationSignals && conversationSignals.interaction.correctionCue) ||
    CORRECTION_RE.test(latestUser)

  // New-task / code-math requests: do not drag prior casual topic.
  if (TASK_EXECUTION_RE.test(latestUser)) {
    return (
      inferCurrentTopic([{ role: 'user', content: latestUser }]) ||
      focus?.topic ||
      null
    )
  }

  // Correction: surface cue only — do NOT resolve the referent (Phase 7).
  if (correction) {
    return focus?.topic || inferCurrentTopic(messages) || priorTopic
  }

  // Explicit topic change wins.
  if ((focus?.status === 'changed' || topicChange) && topicChange) {
    const next =
      focus.topic ||
      inferCurrentTopic([
        ...messages.slice(0, -1),
        { role: 'user', content: latestUser },
      ]) ||
      latestUser
        .replace(TOPIC_CHANGE_RE, '')
        .replace(/^[^\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù]+/i, '')
        .trim()
    if (next) return asString(next).slice(0, 80)
  }

  if (focus?.status === 'changed' && focus.topic) {
    return focus.topic
  }

  // Short continuation / pronouns / "ok" / "E quello?" → keep living prior topic.
  if (
    shortReply?.intent === 'accept_proposal' ||
    shortReply?.intent === 'continue' ||
    shortReply?.intent === 'passive_acknowledgement' ||
    shortReply?.intent === 'uncertain' ||
    shortReply?.intent === 'decline_proposal' ||
    isEncouragementContinuation(latestUser) ||
    CONTINUATION_REF_RE.test(latestUser)
  ) {
    // Closing: keep topic label for diagnostics but Planner will not reopen.
    return priorTopic || focus?.topic || resume?.currentTopic || null
  }

  // Incremental: when prior state is valid and Focus says active, keep prior topic.
  if (previousState?.activeTopic && focus?.status === 'active') {
    return previousState.activeTopic
  }

  if (focus?.status === 'active' && focus.topic) {
    // Prefer previousState topic when Focus rediscovers a noisier label.
    if (
      previousState?.activeTopic &&
      asString(focus.topic).toLowerCase().includes(
        asString(previousState.activeTopic).toLowerCase().split(/\s+/)[0] || '___',
      )
    ) {
      return previousState.activeTopic
    }
    return focus.topic
  }

  return priorTopic
}

/**
 * Build pending proposal with explicit lifecycle status.
 * @param {{
 *   shortReply: import('./short-reply.js').ShortReplyState,
 *   activeTopic: string|null,
 *   previousState?: ConversationState|null,
 *   focusStatus?: string,
 *   latestUser?: string,
 *   turnCount?: number,
 * }} args
 * @returns {PendingProposal|null}
 */
function resolvePendingProposal(args) {
  const { shortReply, activeTopic, previousState, focusStatus, latestUser, turnCount } = args
  const prior = previousState?.pendingProposal || null
  const priorStatus = prior?.status || (prior ? 'open' : null)

  if (shortReply?.intent === 'stop') return null
  if (shortReply?.intent === 'decline_proposal' || DECLINE_CUE_RE.test(asString(latestUser))) {
    return null
  }
  if (shortReply?.intent === 'change_topic' || focusStatus === 'changed') return null
  if (TASK_EXECUTION_RE.test(asString(latestUser))) return null

  // Passive acknowledgement with no live proposal text → clear.
  if (shortReply?.intent === 'passive_acknowledgement' && !shortReply?.hasPendingProposal) {
    return null
  }

  // Expiry: stale open proposals must not survive forever.
  if (prior && (priorStatus === 'open' || priorStatus === 'accepted')) {
    const idle = Math.max(0, Number(prior.idleTurns) || 0)
    if (idle >= PENDING_PROPOSAL_MAX_IDLE_TURNS && !shortReply?.hasPendingProposal) {
      return null
    }
    // "ok" several unrelated turns later without a live assistant proposal → expire.
    if (
      (shortReply?.intent === 'accept_proposal' || shortReply?.intent === 'continue') &&
      !shortReply?.hasPendingProposal &&
      idle >= 1
    ) {
      return null
    }
  }

  // Accept/continue with a live proposal → accepted (Planner executes this turn).
  if (
    (shortReply?.intent === 'accept_proposal' || shortReply?.intent === 'continue') &&
    (shortReply?.hasPendingProposal || (prior && priorStatus === 'open'))
  ) {
    return {
      type:
        shortReply.pendingProposalType ||
        prior?.type ||
        'open_offer',
      topic:
        topicFromProposalText(shortReply.previousAssistant) ||
        prior?.topic ||
        activeTopic ||
        null,
      status: 'accepted',
      source: prior?.source || 'assistant_offer',
      idleTurns: 0,
      openedTurn: prior?.openedTurn ?? turnCount ?? 0,
    }
  }

  if (shortReply?.hasPendingProposal && shortReply.pendingProposalType) {
    return {
      type: shortReply.pendingProposalType,
      topic:
        topicFromProposalText(shortReply.previousAssistant) ||
        activeTopic ||
        prior?.topic ||
        null,
      status: 'open',
      source: 'assistant_offer',
      idleTurns: 0,
      openedTurn: turnCount ?? 0,
    }
  }

  // Carry prior open proposal, bump idle when user did not accept.
  if (prior && (priorStatus === 'open' || priorStatus === 'accepted')) {
    if (!shortReply?.isShortReply && shortReply?.intent === 'not_short_reply') {
      return null
    }
    if (shortReply?.intent === 'uncertain' || shortReply?.isShortReply) {
      const nextIdle = (Number(prior.idleTurns) || 0) + 1
      if (nextIdle > PENDING_PROPOSAL_MAX_IDLE_TURNS) return null
      return {
        ...prior,
        status: 'open',
        idleTurns: nextIdle,
      }
    }
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
  const prevMove =
    state.previousAssistantMove && typeof state.previousAssistantMove === 'object'
      ? Object.freeze({ ...state.previousAssistantMove })
      : state.previousAssistantMove
  const frozen = {
    ...state,
    previousAssistantMove: prevMove,
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
 *   conversationSignals?: import('./conversation-signals.js').ConversationSignals|null,
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
  const turnSignals = isConversationSignals(input.conversationSignals)
    ? input.conversationSignals
    : null

  const turns = splitLatestTurns(messages)
  const latestUser = turns.userText
  const turnCount =
    typeof previousState?.turnCount === 'number'
      ? previousState.turnCount + 1
      : Math.max(1, messages.filter((m) => m.role === 'user').length)

  // Authoritative short-reply (Phase 1) — do not re-classify elsewhere.
  const shortReplyFull =
    input.shortReplyState && typeof input.shortReplyState === 'object'
      ? input.shortReplyState
      : interpretShortReply({ messages })

  // Resume: useful facts only (topic/goal/progress). Prose sentence is NOT state.
  const resume = resumeConversation({ messages })

  // Focus / mode signals — STATE-LIKE inputs only.
  // Decision is optional — State runs before Mind, so decision may be empty.
  // Focus must NOT publish a competing activeTopic; State owns that field.
  const focus = evaluateConversationFocus(messages, decision, perception)
  const momentum = evaluateConversationMomentum(messages, decision, perception)
  const engagementInfo = estimateUserEngagement(latestUser, focus)

  const boredomHigh =
    (turnSignals && turnSignals.affect.boredom >= 0.55) ||
    BOREDOM_RE.test(latestUser) ||
    asString(perception.intent) === 'boredom'
  const topicChangeCue =
    (turnSignals && turnSignals.interaction.topicChangeCue) ||
    TOPIC_CHANGE_RE.test(latestUser)

  const conversationMode = momentumKindToMode(momentum.kind)
  let mode = boredomHigh
    ? /** @type {ConversationMode} */ ('exploration')
    : conversationMode === 'social' && asString(perception.intent) === 'exploration'
      ? /** @type {ConversationMode} */ ('exploration')
      : conversationMode

  if (TASK_EXECUTION_RE.test(latestUser)) {
    mode = /** @type {ConversationMode} */ ('debugging')
  }

  // Prefer previous conversationMode when still deepening the same thread.
  if (
    previousState?.conversationMode &&
    focus.status === 'active' &&
    !TASK_EXECUTION_RE.test(latestUser) &&
    !topicChangeCue &&
    !boredomHigh
  ) {
    mode = /** @type {ConversationMode} */ (previousState.conversationMode)
  }

  const activeTopic = resolveActiveTopic({
    messages,
    focus,
    resume,
    previousState,
    shortReply: shortReplyFull,
    latestUser,
    perception,
    conversationSignals: turnSignals,
  })

  let pendingProposal = resolvePendingProposal({
    shortReply: shortReplyFull,
    activeTopic,
    previousState,
    focusStatus: focus.status,
    latestUser,
    turnCount,
  })

  if (
    shortReplyFull.intent === 'accept_proposal' ||
    shortReplyFull.intent === 'continue'
  ) {
    if (!pendingProposal && shortReplyFull.hasPendingProposal) {
      pendingProposal = {
        type: shortReplyFull.pendingProposalType || 'open_offer',
        topic: topicFromProposalText(shortReplyFull.previousAssistant) || activeTopic,
        status: 'accepted',
        source: 'assistant_offer',
        idleTurns: 0,
        openedTurn: turnCount,
      }
    }
  }

  // Prefer persisted previousAssistantMove when available (set after prior Writer success).
  const previousAssistantMove =
    previousState?.previousAssistantMove &&
    typeof previousState.previousAssistantMove === 'object'
      ? previousState.previousAssistantMove
      : inferPreviousAssistantMove(
          shortReplyFull.previousAssistant || turns.lastSubstantiveAssistant,
          Boolean(pendingProposal) || shortReplyFull.hasPendingProposal,
          pendingProposal?.type || shortReplyFull.pendingProposalType,
        )

  const engagement = normalizeEngagement(engagementInfo.engagement)
  let activeGoal = inferActiveGoal(latestUser, perception, mode, shortReplyFull, turnSignals)
  if (TASK_EXECUTION_RE.test(latestUser)) activeGoal = 'task_execution'

  let conversationPhase = inferConversationPhase(
    messages,
    shortReplyFull,
    perception,
    focus,
    turnSignals,
  )
  // Incremental deepen when prior topic preserved.
  if (
    previousState?.activeTopic &&
    activeTopic === previousState.activeTopic &&
    conversationPhase !== 'closing' &&
    (previousState.conversationPhase === 'exploring' ||
      previousState.conversationPhase === 'deepening' ||
      previousState.conversationPhase === 'executing')
  ) {
    if (shortReplyFull.intent === 'accept_proposal') conversationPhase = 'executing'
    else if (turnCount >= 2) conversationPhase = 'deepening'
  }
  if (previousState?.conversationPhase === 'closing' && shortReplyFull.intent === 'passive_acknowledgement') {
    conversationPhase = 'closing'
  }

  let continuity = resolveContinuity({
    resume,
    activeTopic,
    latestUser,
    shortReply: shortReplyFull,
    messages,
  })
  if (conversationPhase === 'closing' || shortReplyFull.intent === 'stop') {
    continuity = {
      shouldResume: false,
      resumeTopic: null,
      resumePoint: null,
    }
    pendingProposal = null
  }

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
    turnCount,
    responseProfile:
      previousState?.responseProfile && typeof previousState.responseProfile === 'object'
        ? previousState.responseProfile
        : null,
    recentOpeners: Array.isArray(previousState?.recentOpeners)
      ? previousState.recentOpeners
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
    diagnostics: {
      focusStatus: focus.status,
      focusTopic: focus.topic,
      focusConfidence: focus.confidence,
      /** @deprecated use conversationMode — Momentum kind is a compat mirror */
      momentumKind: momentum.kind,
      conversationMode: mode,
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
      shortReplyFull,
      focusSignals: focus.signals,
      focusAvoidClarification: focus.avoidClarification,
      /** Focus topic is diagnostic only — not an authority */
      focusIsNotTopicAuthority: true,
      signalsSummary: turnSignals
        ? {
            boredom: turnSignals.affect.boredom >= 0.55,
            wantsBrief: turnSignals.style.wantsBrief,
            topicChangeCue: turnSignals.interaction.topicChangeCue,
            correctionCue: turnSignals.interaction.correctionCue,
          }
        : null,
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

/**
 * Sanitize State for client/session echo persistence (no diagnostics / reasoning).
 * Conversation State = short-lived working memory — NOT durable Memory V2.
 *
 * @param {ConversationState|null|undefined} state
 * @returns {object|null}
 */
export function serializePersistedConversationState(state) {
  if (!state || typeof state !== 'object') return null
  const pending = state.pendingProposal
  const prev = state.previousAssistantMove
  return {
    version: CONVERSATION_STATE_VERSION,
    turnCount: typeof state.turnCount === 'number' ? state.turnCount : 0,
    activeTopic: state.activeTopic ?? null,
    activeGoal: state.activeGoal ?? null,
    conversationMode: state.conversationMode ?? null,
    conversationPhase: state.conversationPhase ?? null,
    engagement: state.engagement ?? null,
    previousAssistantMove:
      prev && typeof prev === 'object'
        ? {
            type: prev.type ?? null,
            topic: prev.topic ?? null,
            hadOpenProposal: Boolean(prev.hadOpenProposal),
            conversationalMove: prev.conversationalMove ?? null,
          }
        : typeof prev === 'string'
          ? { type: prev, topic: state.activeTopic ?? null, hadOpenProposal: false }
          : null,
    pendingProposal: pending
      ? {
          type: pending.type,
          topic: pending.topic ?? null,
          status: pending.status || 'open',
          source: pending.source || 'assistant_offer',
          idleTurns: Number(pending.idleTurns) || 0,
          openedTurn: Number(pending.openedTurn) || 0,
        }
      : null,
    shortReply: {
      intent: state.shortReply?.intent ?? null,
      confidence:
        typeof state.shortReply?.confidence === 'number' ? state.shortReply.confidence : null,
    },
    continuity: {
      shouldResume: Boolean(state.continuity?.shouldResume),
      resumeTopic: state.continuity?.resumeTopic ?? null,
      resumePoint: state.continuity?.resumePoint ?? null,
    },
    references: {
      unresolved: Array.isArray(state.references?.unresolved)
        ? state.references.unresolved.slice(0, 8)
        : [],
    },
    responseProfile:
      state.responseProfile && typeof state.responseProfile === 'object'
        ? {
            tone: { ...state.responseProfile.tone },
            depth: state.responseProfile.depth,
            verbosity: state.responseProfile.verbosity,
            energy: state.responseProfile.energy,
            emojiPolicy: state.responseProfile.emojiPolicy,
            version: state.responseProfile.version,
          }
        : null,
    recentOpeners: Array.isArray(state.recentOpeners)
      ? state.recentOpeners.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5)
      : [],
  }
}

/**
 * Hydrate a previously persisted State echo (fail-soft).
 * @param {unknown} raw
 * @returns {ConversationState|null}
 */
export function hydrateConversationState(raw) {
  if (!raw || typeof raw !== 'object') return null
  const v = /** @type {any} */ (raw)
  if (v.activeTopic !== null && v.activeTopic !== undefined && typeof v.activeTopic !== 'string') {
    return null
  }
  /** @type {ConversationState} */
  const state = {
    activeTopic: v.activeTopic ?? null,
    activeGoal: v.activeGoal ?? null,
    conversationMode: v.conversationMode ?? null,
    conversationPhase: v.conversationPhase ?? null,
    engagement: v.engagement ?? null,
    previousAssistantMove: v.previousAssistantMove ?? null,
    pendingProposal: v.pendingProposal ?? null,
    shortReply:
      v.shortReply && typeof v.shortReply === 'object'
        ? {
            intent: v.shortReply.intent ?? null,
            confidence:
              typeof v.shortReply.confidence === 'number' ? v.shortReply.confidence : null,
          }
        : { intent: null, confidence: null },
    continuity:
      v.continuity && typeof v.continuity === 'object'
        ? {
            shouldResume: Boolean(v.continuity.shouldResume),
            resumeTopic: v.continuity.resumeTopic ?? null,
            resumePoint: v.continuity.resumePoint ?? null,
          }
        : { shouldResume: false, resumeTopic: null, resumePoint: null },
    references: {
      unresolved: Array.isArray(v.references?.unresolved) ? v.references.unresolved : [],
    },
    turnCount: typeof v.turnCount === 'number' ? v.turnCount : 0,
    responseProfile:
      v.responseProfile && typeof v.responseProfile === 'object' ? v.responseProfile : null,
    recentOpeners: Array.isArray(v.recentOpeners)
      ? v.recentOpeners.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5)
      : [],
    version: asString(v.version) || CONVERSATION_STATE_VERSION,
  }
  return freezeConversationState(state)
}

/**
 * Map Planner conversationalMove → compact previousAssistantMove type.
 * @param {string|null|undefined} move
 * @param {string|null|undefined} [pendingType]
 * @returns {string}
 */
export function conversationalMoveToAssistantMoveType(move, pendingType) {
  const m = asString(move)
  if (m === 'execute_pending_proposal') {
    if (pendingType === 'tell_curiosity') return 'tell_story'
    if (pendingType === 'explain') return 'offer_explanation'
    if (pendingType === 'explore_topic') return 'offer_topic'
    return 'answer'
  }
  if (m === 'continue_topic') return 'answer'
  if (m === 'passive_acknowledgement') return 'acknowledge'
  if (m === 'stop' || m === 'decline_proposal') return 'close'
  if (m === 'clarify_uncertain') return 'clarify'
  if (m === 'change_topic') return 'offer_topic'
  return 'answer'
}

/**
 * Post-Writer state transition — only call when Writer successfully delivered.
 * Publishes the next persisted Conversation State for the following turn.
 *
 * Runtime/state-transition layer is the only publisher of next State.
 * Planner/Writer must not call this to mutate the pre-Writer input State.
 *
 * @param {{
 *   preState: ConversationState,
 *   plan?: object|null,
 *   responseText?: string,
 *   writerSucceeded?: boolean,
 * }} input
 * @returns {ConversationState}
 */
export function transitionConversationState(input = /** @type {any} */ ({})) {
  const pre = input.preState && typeof input.preState === 'object' ? input.preState : null
  if (!pre) {
    return freezeConversationState({
      activeTopic: null,
      activeGoal: null,
      conversationMode: null,
      conversationPhase: null,
      engagement: null,
      previousAssistantMove: null,
      pendingProposal: null,
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
      turnCount: 0,
      version: CONVERSATION_STATE_VERSION,
    })
  }

  // Failure: do not claim completion — return prior persisted shape without executing transition.
  if (input.writerSucceeded === false) {
    return freezeConversationState({
      ...serializePersistedConversationState(pre),
      // Keep accepted proposal open so the next turn can retry.
      pendingProposal: pre.pendingProposal
        ? {
            ...pre.pendingProposal,
            status:
              pre.pendingProposal.status === 'accepted' ||
              pre.pendingProposal.status === 'executing'
                ? 'open'
                : pre.pendingProposal.status || 'open',
          }
        : null,
      diagnostics: {
        transitionSkipped: 'writer_failed',
      },
    })
  }

  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {}
  const brief = plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : {}
  const move = asString(brief.conversationalMove || plan.objective || '')
  const topic = brief.activeTopic || pre.activeTopic || null
  const pendingType =
    brief.pendingProposalAction || pre.pendingProposal?.type || null
  const responseProfile =
    (brief.responseProfile && typeof brief.responseProfile === 'object'
      ? brief.responseProfile
      : null) ||
    (plan.responseProfile && typeof plan.responseProfile === 'object'
      ? plan.responseProfile
      : null) ||
    pre.responseProfile ||
    null

  let pendingProposal = pre.pendingProposal
  if (
    move === 'execute_pending_proposal' ||
    move === 'continue_topic' ||
    pre.pendingProposal?.status === 'accepted' ||
    pre.pendingProposal?.status === 'executing'
  ) {
    // Successfully delivered → clear proposal.
    pendingProposal = null
  } else if (move === 'decline_proposal' || move === 'stop' || move === 'change_topic') {
    pendingProposal = null
  } else if (pre.conversationPhase === 'closing' || move === 'passive_acknowledgement') {
    // Keep null if already cleared; otherwise leave open proposals only if still open.
    if (pre.pendingProposal?.status === 'accepted') pendingProposal = null
  }

  // If Writer just offered a new proposal in the delivered text, detect for next turn.
  // (Surface detection only — next buildConversationState will confirm.)
  const responseText = asString(input.responseText)
  if (
    !pendingProposal &&
    responseText &&
    hasUnresolvedConversationalProposal(responseText)
  ) {
    pendingProposal = {
      type: inferPendingProposalType(responseText) || 'open_offer',
      topic: topicFromProposalText(responseText) || topic,
      status: 'open',
      source: 'assistant_offer',
      idleTurns: 0,
      openedTurn: (pre.turnCount || 0) + 1,
    }
  }

  let conversationPhase = pre.conversationPhase
  if (move === 'stop') conversationPhase = 'closing'
  else if (move === 'execute_pending_proposal' || move === 'continue_topic') {
    conversationPhase = 'deepening'
  } else if (pre.conversationPhase === 'executing') {
    conversationPhase = 'deepening'
  }

  const previousAssistantMove = {
    type: conversationalMoveToAssistantMoveType(move, pendingType),
    topic,
    hadOpenProposal: Boolean(pre.pendingProposal),
    conversationalMove: move || null,
  }

  let continuity = { ...pre.continuity }
  if (conversationPhase === 'closing') {
    continuity = { shouldResume: false, resumeTopic: null, resumePoint: null }
  }

  // Rolling opener history for Contract Evaluator (QA only — not Memory).
  const priorOpeners = Array.isArray(pre.recentOpeners)
    ? pre.recentOpeners.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const openerKey =
    stockOpenerKeyFromText(responseText) || normalizeAssistantOpener(responseText).slice(0, 48)
  const recentOpeners = openerKey
    ? [...priorOpeners.filter((o) => o !== openerKey), openerKey].slice(-5)
    : priorOpeners.slice(-5)

  /** @type {ConversationState} */
  const next = {
    activeTopic: topic,
    activeGoal: pre.activeGoal,
    conversationMode: pre.conversationMode,
    conversationPhase,
    engagement: pre.engagement,
    previousAssistantMove,
    pendingProposal,
    shortReply: {
      intent: pre.shortReply?.intent ?? null,
      confidence:
        typeof pre.shortReply?.confidence === 'number' ? pre.shortReply.confidence : null,
    },
    continuity,
    references: {
      unresolved: Array.isArray(pre.references?.unresolved)
        ? [...pre.references.unresolved]
        : [],
    },
    turnCount: pre.turnCount || 0,
    responseProfile: responseProfile
      ? {
          tone: { ...responseProfile.tone },
          depth: responseProfile.depth,
          verbosity: responseProfile.verbosity,
          energy: responseProfile.energy,
          emojiPolicy: responseProfile.emojiPolicy,
          version: responseProfile.version,
        }
      : null,
    recentOpeners,
    version: CONVERSATION_STATE_VERSION,
  }

  return freezeConversationState(next)
}

/**
 * Mark proposal executing (Planner decided to run it) — still pre-Writer.
 * Does not clear the proposal; transitionConversationState clears after success.
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
export function markPendingProposalExecuting(state) {
  if (!state?.pendingProposal) return state
  return freezeConversationState({
    ...state,
    pendingProposal: {
      ...state.pendingProposal,
      status: 'executing',
    },
    conversationPhase: 'executing',
  })
}
