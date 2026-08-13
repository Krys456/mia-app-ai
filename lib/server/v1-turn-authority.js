/**
 * V1 turn-level authority helpers (NOT a cognitive engine).
 *
 * Resolves Planner → WriterDirectives precedence and presence-gate applicability.
 * Observational + authority only — does not invent new conversational modules.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

const GREETING_RE =
  /^(ciao|hey|hi|hello|ehi|salve|buongiorno|buonasera|good\s+(morning|afternoon|evening)|yo)([\s!,.🥰😊🙏]*)$/i

const HOW_ARE_YOU_RE =
  /^(come\s+stai|come\s+va|come\s+te\s+la\s+passi|tutto\s+bene\??|how\s+are\s+you|how'?s\s+it\s+going|how\s+do\s+you\s+do)([\s?!.🥰😊]*)$/i

const ACK_RE =
  /^(ok+|okay|va\s+bene|certo|d['’]?accordo|capito|got\s+it|sure|fine|bene|volentieri|grazie|thanks|thank\s+you|perfetto|ottimo)([\s!.🥰😊]*)$/i

/** Rejection of current assistant-proposed direction (not general apathy). */
export const CONVERSATIONAL_REJECTION_RE =
  /^(non\s+mi\s+interessa|non\s+mi\s+piace|lasciamo\s+stare|lascia\s+stare|basta\s+(cos[iì]|cosi)|non\s+ora|non\s+di\s+questo|cambia\s+argomento|not\s+interested|i\s+don'?t\s+care(\s+about\s+that)?|i'?m\s+not\s+interested|let'?s\s+drop\s+(it|this)|never\s+mind\s+(that|this)|skip\s+(that|it))([\s!.]*)$/i

const ASSISTANT_FILLER_TOPIC_RE =
  /\b(stimolante|scambiare\s+idee|interesting\s+to\s+(chat|talk)|lovely\s+to\s+(chat|talk)|nice\s+to\s+(chat|talk)|piacere\s+(parlare|chiacchierare)|connessione|connection|conversazione\s+viva|living\s+conversation)\b/i

const EXPLICIT_TOPIC_RE =
  /^(parliamo\s+(di|dei|delle|del|della|degli)\s+|let'?s\s+talk\s+about\s+|parlare\s+(di|dei|delle|del)\s+|vorrei\s+parlare\s+(di|dei|delle|del)\s+)/i

/**
 * @param {unknown} messages
 * @returns {ChatTurn[]}
 */
export function asTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(/** @type {{ role?: string }} */ (m).role || ''),
      content: String(/** @type {{ content?: string }} */ (m).content || '').trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @param {string} msg
 */
export function isPureGreeting(msg) {
  return GREETING_RE.test(String(msg || '').trim())
}

/**
 * @param {string} msg
 */
export function isHowAreYou(msg) {
  return HOW_ARE_YOU_RE.test(String(msg || '').trim())
}

/**
 * @param {string} msg
 */
export function isSocialAck(msg) {
  return ACK_RE.test(String(msg || '').trim())
}

/**
 * True when user rejects the assistant's currently proposed direction.
 * Requires recent assistant turn when context-dependent phrases are used.
 * @param {string} userMessage
 * @param {unknown} [messages]
 */
export function detectConversationalRejection(userMessage, messages) {
  const msg = String(userMessage || '').trim()
  if (!msg) {
    return { rejected: false, confidence: 'low', reason: 'empty' }
  }
  if (!CONVERSATIONAL_REJECTION_RE.test(msg)) {
    return { rejected: false, confidence: 'low', reason: 'no_match' }
  }
  const turns = asTurns(messages)
  const hasAssistant = turns.some((t) => t.role === 'assistant')
  // Standalone rejection phrases always count when they match; stronger with prior assistant.
  return {
    rejected: true,
    confidence: hasAssistant ? 'high' : 'medium',
    reason: hasAssistant ? 'reject_assistant_direction' : 'reject_direction_standalone',
    priorAssistantPresent: hasAssistant,
  }
}

/**
 * Normalize Conversation Planner plan object from various wrappers.
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function normalizePlannerPlan(raw) {
  if (!raw || typeof raw !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  if (r.plan && typeof r.plan === 'object') {
    return /** @type {Record<string, unknown>} */ (r.plan)
  }
  if (
    'initiative' in r ||
    'topicAction' in r ||
    'responseMode' in r ||
    'strategy' in r
  ) {
    return r
  }
  return null
}

/**
 * Presence / wait / no-initiative restraint turn (Planner authority).
 * @param {unknown} plannerOrPlan
 */
export function isPresenceRestraintTurn(plannerOrPlan) {
  const plan = normalizePlannerPlan(plannerOrPlan)
  if (!plan) return false
  const initiative = plan.initiative === false || plan.initiative === 'false'
  const topicWait = plan.topicAction === 'wait'
  const mode = String(plan.responseMode || '')
  const presenceMode = mode === 'presence' || mode === 'listening' || mode === 'companionship'
  const depth = typeof plan.depth === 'number' ? plan.depth : 99
  const strategy = String(plan.strategy || '')
  const softStrategy = strategy === 'friendly' || strategy === 'simply_listen'
  return (
    (initiative && (topicWait || presenceMode || softStrategy)) ||
    (topicWait && depth <= 2) ||
    (presenceMode && initiative && depth <= 2)
  )
}

/**
 * Gates that should not upgrade a valid presence/greeting draft into initiative.
 * @param {unknown} plannerOrPlan
 * @param {{ primaryIntent?: string, socialIntent?: string } | null} [ctx]
 */
export function gateApplicabilityForTurn(plannerOrPlan, ctx = null) {
  const presence = isPresenceRestraintTurn(plannerOrPlan)
  const intent = String(ctx?.primaryIntent || '')
  const social = String(ctx?.socialIntent || '')
  const socialPresence =
    intent === 'greeting' ||
    intent === 'thanks' ||
    intent === 'rejection' ||
    social === 'greeting' ||
    social === 'how_are_you' ||
    social === 'thanks' ||
    social === 'farewell'

  /** @type {string[]} */
  const skipped = []
  /** @type {string[]} */
  const active = []

  const maybeSkip = (id, shouldSkip) => {
    if (shouldSkip) skipped.push(id)
    else active.push(id)
  }

  const skipSubstance =
    presence || socialPresence || (plannerOrPlan && normalizePlannerPlan(plannerOrPlan)?.lookingFor === 'companionship' && isPresenceRestraintTurn(plannerOrPlan))

  maybeSkip('deep_thinking_writer', Boolean(skipSubstance))
  maybeSkip('reasoning_expansion', Boolean(skipSubstance))
  maybeSkip('conversation_opening_useful', Boolean(skipSubstance))
  maybeSkip('opening_intelligence', Boolean(skipSubstance))
  maybeSkip('small_talk_intelligence', Boolean(skipSubstance))
  maybeSkip('conversation_ownership', Boolean(skipSubstance))
  maybeSkip('worth_reading', Boolean(skipSubstance))
  maybeSkip('cognitive_authority', Boolean(skipSubstance))
  maybeSkip('conversation_quality_gift', Boolean(skipSubstance))

  // Always keep language / askQuestion / planner-alignment style checks conceptually active
  active.push('directive_ask_question')
  active.push('conversation_planner')

  return {
    presenceRestraint: Boolean(skipSubstance),
    skipped,
    active,
  }
}

/**
 * @param {string} id
 * @param {{ skipped: string[] }} applicability
 */
export function isGateSkipped(id, applicability) {
  return Array.isArray(applicability?.skipped) && applicability.skipped.includes(id)
}

/**
 * Apply Planner precedence onto lead / initiative / continueTopic / askQuestion.
 * Returns override metadata for observability — does not mutate inputs.
 *
 * @param {object} input
 * @param {{ leadConversation: boolean, reason: string, source: string }} lead
 * @param {{ initiative: string, reason: string, source: string }} initiative
 * @param {{ continueCurrentTopic: boolean, reason: string, source: string }} topicHold
 * @param {{ askQuestion: boolean, reason: string, source: string }} ask
 */
export function applyPlannerAuthority(input, lead, initiative, topicHold, ask) {
  const plan = normalizePlannerPlan(
    input.conversationPlanner || input.conversationPlannerPlan || input.planner,
  )
  /** @type {string[]} */
  const overridesApplied = []

  let nextLead = { ...lead }
  let nextInit = { ...initiative }
  let nextTopic = { ...topicHold }
  let nextAsk = { ...ask }

  if (plan) {
    const plannerInitiativeFalse = plan.initiative === false
    const topicWait = plan.topicAction === 'wait'
    const presenceMode =
      plan.responseMode === 'presence' ||
      plan.responseMode === 'listening' ||
      plan.strategy === 'friendly' ||
      plan.strategy === 'simply_listen'

    if (plannerInitiativeFalse || topicWait || (presenceMode && plan.depth <= 2 && plannerInitiativeFalse !== false && plan.initiative !== true)) {
      if (plannerInitiativeFalse || topicWait) {
        if (nextLead.leadConversation) {
          nextLead = {
            leadConversation: false,
            source: 'conversation_planner',
            reason: topicWait ? 'planner_topic_wait' : 'planner_initiative_false',
          }
          overridesApplied.push('leadConversation←planner')
        }
        if (nextInit.initiative === 'high' || nextInit.initiative === 'medium') {
          nextInit = {
            initiative: 'low',
            source: 'conversation_planner',
            reason: 'planner_initiative_false',
          }
          overridesApplied.push('initiative←planner_low')
        }
      }
      if (topicWait && nextTopic.continueCurrentTopic) {
        nextTopic = {
          continueCurrentTopic: false,
          source: 'conversation_planner',
          reason: 'planner_topic_wait',
        }
        overridesApplied.push('continueCurrentTopic←planner_wait')
      }
    }

    // Strong askQuestion=false from planner-aligned social / presence
    if (
      (plannerInitiativeFalse || topicWait || presenceMode) &&
      nextAsk.askQuestion === true
    ) {
      nextAsk = {
        askQuestion: false,
        source: 'conversation_planner',
        reason: 'planner_presence_no_question',
      }
      overridesApplied.push('askQuestion←planner_false')
    }
  }

  // Rejection of assistant direction → never lead / high initiative
  const rejection = detectConversationalRejection(input.userMessage, input.messages)
  if (rejection.rejected) {
    if (nextLead.leadConversation) {
      nextLead = {
        leadConversation: false,
        source: 'conversation_intent',
        reason: 'user_rejected_direction',
      }
      overridesApplied.push('leadConversation←rejection')
    }
    nextInit = {
      initiative: 'low',
      source: 'conversation_intent',
      reason: 'user_rejected_direction',
    }
    overridesApplied.push('initiative←rejection_low')
    if (nextAsk.askQuestion) {
      nextAsk = {
        askQuestion: false,
        source: 'conversation_intent',
        reason: 'rejection_no_question',
      }
      overridesApplied.push('askQuestion←rejection')
    }
    nextTopic = {
      continueCurrentTopic: false,
      source: 'conversation_intent',
      reason: 'rejection_drop_direction',
    }
    overridesApplied.push('continueCurrentTopic←rejection')
  }

  return {
    lead: nextLead,
    initiative: nextInit,
    topicHold: nextTopic,
    ask: nextAsk,
    authorityResolution: {
      plannerInitiative: plan ? Boolean(plan.initiative) : null,
      plannerTopicAction: plan?.topicAction ?? null,
      plannerResponseMode: plan?.responseMode ?? null,
      plannerAskQuestion: null, // planner does not emit askQ; final below
      finalInitiative: nextInit.initiative,
      finalLeadConversation: nextLead.leadConversation,
      finalAskQuestion: nextAsk.askQuestion,
      finalContinueCurrentTopic: nextTopic.continueCurrentTopic,
      overridesApplied,
      rejection: rejection.rejected
        ? { confidence: rejection.confidence, reason: rejection.reason }
        : null,
    },
  }
}

/**
 * Detect conversational follow-up questions that violate askQuestion=false.
 * Allows short rhetorical / self-directed patterns; blocks invite-to-user questions.
 * @param {string} draft
 */
export function draftHasUnauthorizedConversationalQuestion(draft) {
  const text = String(draft || '').trim()
  if (!text) return false
  if (!/[?？]/.test(text)) return false

  // Pure greeting / ack without user-invite is fine even with ? in rare cases
  if (GREETING_RE.test(text) || ACK_RE.test(text) || HOW_ARE_YOU_RE.test(text)) {
    return /[?？]/.test(text) && /\b(vuoi|volessi|would\s+you|do\s+you|what\s+about|come\s+stai|and\s+you)\b/i.test(text)
  }

  // User-invite / follow-up patterns
  if (
    /\b(vuoi\s+(scoprire|sapere|parlare|provare|che|sentire)|volessi|would\s+you\s+like|do\s+you\s+(want|think)|what\s+(do\s+you|about)|cosa\s+(hai|ne\s+pensi|ti\s+interessa)|di\s+cosa\s+vuoi|come\s+posso\s+aiutarti|and\s+you\??|e\s+tu\??)\b/i.test(
      text,
    )
  ) {
    return true
  }

  // Trailing question invite
  if (/[?？]\s*$/.test(text) && text.length > 40) return true

  return false
}

/**
 * Soft strip unauthorized conversational questions when askQuestion=false.
 * @param {string} draft
 */
export function stripUnauthorizedQuestions(draft) {
  let text = String(draft || '').trim()
  if (!text) return text

  const parts = text.split(/(?<=[.!…])\s+/)
  if (parts.length >= 2) {
    const kept = parts.filter((p, i) => {
      if (i === parts.length - 1 && /[?？]/.test(p)) return false
      if (draftHasUnauthorizedConversationalQuestion(p) && /[?？]/.test(p)) return false
      return true
    })
    if (kept.length) text = kept.join(' ').trim()
  } else if (draftHasUnauthorizedConversationalQuestion(text)) {
    // Single-sentence unauthorized question → drop to empty so caller can keep original draft
    // Prefer trimming trailing invite clause after last period if any
    const beforeQ = text.replace(/\s*[^.!?…]*[?？][^.]*$/, '').trim()
    if (beforeQ.length >= 8) text = beforeQ
  }
  return text
}

/**
 * Assistant relational filler must not become topicHint.
 * @param {string} hint
 */
export function isAssistantFillerTopic(hint) {
  const h = String(hint || '').trim()
  if (!h) return true
  if (h.split(/\s+/).length <= 2 && !EXPLICIT_TOPIC_RE.test(h)) {
    // very short non-explicit hints are weak
  }
  return ASSISTANT_FILLER_TOPIC_RE.test(h)
}

/**
 * Prefer explicit user topic selection.
 * @param {string} userMessage
 * @returns {string | null}
 */
export function extractExplicitUserTopic(userMessage) {
  const msg = String(userMessage || '').trim()
  const m = msg.match(
    /^(?:parliamo\s+(?:di|dei|delle|del|della|degli)|let'?s\s+talk\s+about|vorrei\s+parlare\s+(?:di|dei|delle|del))\s+(.+)$/i,
  )
  if (!m) return null
  return m[1].replace(/[?.!]+$/, '').trim().slice(0, 120) || null
}

/**
 * Build topic hint preferring user over assistant filler.
 * @param {{ lastU?: string, lastA?: string, userMessage?: string }} args
 */
export function resolveTopicHint(args) {
  const userMessage = String(args.userMessage || '').trim()
  const lastU = String(args.lastU || '').trim()
  const lastA = String(args.lastA || '').trim()

  const explicit = extractExplicitUserTopic(userMessage) || extractExplicitUserTopic(lastU)
  if (explicit) {
    return {
      topicHint: explicit,
      owner: /** @type {const} */ ('user'),
      reason: 'explicit_user_topic',
    }
  }

  const clean = (s) =>
    s
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 6)
      .join(' ')

  const fromUser = clean(userMessage || lastU)
  if (fromUser && !isPureGreeting(userMessage) && !isHowAreYou(userMessage) && !isSocialAck(userMessage)) {
    return { topicHint: fromUser, owner: /** @type {const} */ ('user'), reason: 'user_words' }
  }

  const fromAssistant = clean(lastA)
  if (fromAssistant && !isAssistantFillerTopic(lastA) && !isAssistantFillerTopic(fromAssistant)) {
    return {
      topicHint: fromAssistant,
      owner: /** @type {const} */ ('assistant'),
      reason: 'assistant_substantive',
    }
  }

  return { topicHint: null, owner: /** @type {const} */ ('shared'), reason: 'no_authoritative_topic' }
}

/**
 * Append WriterDirectives constraints into refine instructions.
 * @param {string} instructions
 * @param {Record<string, unknown> | null | undefined} directives
 */
export function appendDirectiveRefineConstraints(instructions, directives) {
  if (!directives || typeof directives !== 'object') return String(instructions || '')
  const askQ = directives.askQuestion === true
  const lead = directives.leadConversation === true
  const initiative = String(directives.initiative || 'low')
  const mode = String(directives.mode || '')
  const continueTopic = directives.continueCurrentTopic === true
  const block = [
    'WRITERDIRECTIVES CONSTRAINTS (mandatory during refine — do not violate):',
    `askQuestion=${askQ} — if false, do NOT add a conversational follow-up question to the user (no “Vuoi…?”, “Cosa hai in mente…?”, “And you?”).`,
    `leadConversation=${lead} · initiative=${initiative} — if lead=false or initiative=low, do NOT invent a new intellectual topic or spark.`,
    `continueCurrentTopic=${continueTopic} · mode=${mode || '—'}`,
    'If the draft already fulfills a presence/greeting/social check-in, prefer minimal edits — do not “upgrade” into more impressive content.',
  ].join('\n')
  return `${String(instructions || '').trim()}\n${block}`
}
