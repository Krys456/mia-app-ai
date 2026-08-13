/**
 * LAIfe V2 — Mind
 *
 * Pure decision module (Director). Chooses what to do this turn.
 * Never writes text, never calls models, never mutates memory.
 * Not wired into the chat pipeline yet.
 *
 * @see MIND_SPEC.md
 * @see LAIFE_V2_ARCHITECTURE.md §4
 */

export const MIND_VERSION = '2.1.0-mind'

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
 * @property {object} [reasoning]
 */

/**
 * @typedef {object} ConversationMemory
 * @property {string[]} [topics]
 * @property {string[]} [openQuestions]
 * @property {string|null} [currentTopic]
 * @property {string[]} [explained]
 * @property {number} [turnCount]
 * @property {'short_ack'|'engaged'|'resistant'|'delegating'|null} [lastUserStance]
 * @property {string|null} [unresolvedGoal]
 */

/**
 * @typedef {object} SessionState
 * @property {boolean} [memoryEnabled]
 * @property {boolean} [isVoice]
 * @property {number} [questionStreak]
 * @property {number} [initiativeStreak]
 * @property {boolean} [userAskedToLead]
 * @property {boolean} [closingSignal]
 * @property {'concise'|'balanced'|'detailed'|null} [preferenceBias]
 */

/**
 * @typedef {'connection'|'information'|'explanation'|'help_unblocking'|'emotional_care'|'celebration_share'|'direction'|'continuation'|'feedback_ack'|'closure'|'unclear'} MindNeed
 */

/**
 * @typedef {'connect'|'continue'|'answer'|'explain'|'guide'|'support'|'celebrate'|'recover'|'close'|'entertain'|'explore'} MindStrategy
 */

/**
 * @typedef {'none'|'one_insight'|'one_spark'|'one_direction'} MindInitiative
 */

/**
 * @typedef {'neutral'|'warm'|'calm'|'playful'|'serious'|'supportive'|'encouraging'|'curious'} MindEmotionalTone
 */

/**
 * @typedef {'minimal'|'light'|'balanced'|'deep'} MindResponseDepth
 */

/**
 * @typedef {object} MindDecision
 * @property {MindNeed} need
 * @property {string} goal
 * @property {MindStrategy} strategy
 * @property {MindInitiative} initiative
 * @property {MindEmotionalTone} emotionalTone
 * @property {MindResponseDepth} responseDepth
 * @property {boolean} shouldUseMemory
 * @property {boolean} shouldContinueTopic
 * @property {boolean} shouldAskQuestion
 * @property {boolean} shouldTeach
 * @property {boolean} shouldComfort
 * @property {boolean} shouldChallenge
 * @property {number} confidence
 */

/**
 * @typedef {object} MindInput
 * @property {PerceptionResult} [perception]
 * @property {ConversationMemory} [conversationMemory]
 * @property {SessionState} [sessionState]
 * @property {import('./conversation-state.js').ConversationState} [conversationState] Phase 2 situation facts
 */

/** @type {MindNeed[]} */
const NEEDS = [
  'connection',
  'information',
  'explanation',
  'help_unblocking',
  'emotional_care',
  'celebration_share',
  'direction',
  'continuation',
  'feedback_ack',
  'closure',
  'unclear',
]

/** @type {MindStrategy[]} */
const STRATEGIES = [
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
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((v) => asString(v).trim()).filter(Boolean)
}

/**
 * @param {MindInput} [input]
 */
function normalize(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const p =
    raw.perception && typeof raw.perception === 'object' ? raw.perception : {}
  const m =
    raw.conversationMemory && typeof raw.conversationMemory === 'object'
      ? raw.conversationMemory
      : {}
  const s =
    raw.sessionState && typeof raw.sessionState === 'object'
      ? raw.sessionState
      : {}
  const cs =
    raw.conversationState && typeof raw.conversationState === 'object'
      ? raw.conversationState
      : null

  const preferenceBias = asString(s.preferenceBias)
  const stance = asString(m.lastUserStance)

  // Prefer Conversation State facts over Memory Map echoes when present.
  const stateTopic = cs && typeof cs.activeTopic === 'string' ? cs.activeTopic : null
  const closingFromState =
    Boolean(cs && cs.conversationPhase === 'closing') ||
    Boolean(cs && cs.shortReply && cs.shortReply.intent === 'stop')

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
    memory: {
      topics: asStringArray(m.topics),
      openQuestions: asStringArray(m.openQuestions),
      currentTopic: stateTopic || asString(m.currentTopic) || null,
      explained: asStringArray(m.explained),
      turnCount: Math.max(0, Math.floor(asNumber(m.turnCount, 0))),
      lastUserStance:
        stance === 'short_ack' ||
        stance === 'engaged' ||
        stance === 'resistant' ||
        stance === 'delegating'
          ? stance
          : null,
      unresolvedGoal: asString(m.unresolvedGoal) || null,
    },
    session: {
      memoryEnabled: s.memoryEnabled !== false,
      isVoice: asBool(s.isVoice, false),
      questionStreak: Math.max(0, Math.floor(asNumber(s.questionStreak, 0))),
      initiativeStreak: Math.max(0, Math.floor(asNumber(s.initiativeStreak, 0))),
      userAskedToLead: asBool(s.userAskedToLead, false),
      closingSignal: asBool(s.closingSignal, false) || closingFromState,
      preferenceBias:
        preferenceBias === 'concise' ||
        preferenceBias === 'balanced' ||
        preferenceBias === 'detailed'
          ? preferenceBias
          : null,
    },
    conversationState: cs,
  }
}

/**
 * @param {string} userNeed
 * @param {string} intent
 * @param {string} socialIntent
 * @param {string} stage
 * @param {{ closingSignal: boolean }} session
 * @returns {MindNeed}
 */
function decideNeed(userNeed, intent, socialIntent, stage, session) {
  if (session.closingSignal || socialIntent === 'farewell' || stage === 'closing') {
    return 'closure'
  }
  if (intent === 'feedback_on_assistant' || stage === 'repair') {
    return 'feedback_ack'
  }
  if (intent === 'emotional_support') return 'emotional_care'
  if (intent === 'celebration') return 'celebration_share'
  if (intent === 'problem_solving') return 'help_unblocking'
  if (intent === 'learning') return 'explanation'
  if (intent === 'continuation') return 'continuation'
  if (intent === 'greeting' || intent === 'small_talk' || intent === 'companionship') {
    return 'connection'
  }
  if (intent === 'advice' || intent === 'boredom' || intent === 'exploration') {
    return 'direction'
  }
  if (
    intent === 'curiosity' ||
    intent === 'news' ||
    intent === 'meta_language' ||
    intent === 'project_update' ||
    intent === 'life_update'
  ) {
    return 'information'
  }

  if (NEEDS.includes(/** @type {MindNeed} */ (userNeed))) {
    return /** @type {MindNeed} */ (userNeed)
  }
  return 'unclear'
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindNeed} need
 * @returns {MindStrategy}
 */
function decideStrategy(ctx, need) {
  const { perception: p, memory, session, conversationState: cs } = ctx
  const { intent, socialIntent, conversationStage } = p

  if (need === 'closure' || socialIntent === 'farewell' || session.closingSignal) {
    return 'close'
  }
  if (need === 'feedback_ack' || conversationStage === 'repair') {
    return 'recover'
  }
  if (need === 'emotional_care') return 'support'
  if (need === 'celebration_share') return 'celebrate'
  if (need === 'explanation' || intent === 'learning') return 'explain'
  if (need === 'help_unblocking' || intent === 'problem_solving') return 'guide'
  if (intent === 'entertainment') return 'entertain'
  // Conversation State goals/mode: explore when user wants casual exploration (boredom).
  if (
    intent === 'exploration' ||
    intent === 'boredom' ||
    cs?.activeGoal === 'casual_exploration' ||
    cs?.activeGoal === 'exploration' ||
    (cs?.conversationMode === 'exploration' && !cs?.activeTopic) ||
    (session.userAskedToLead && !memory.currentTopic)
  ) {
    return 'explore'
  }
  if (
    need === 'continuation' ||
    intent === 'continuation' ||
    cs?.shortReply?.intent === 'continue' ||
    cs?.shortReply?.intent === 'accept_proposal' ||
    cs?.continuity?.shouldResume ||
    (memory.lastUserStance === 'short_ack' && memory.currentTopic)
  ) {
    return 'continue'
  }
  if (
    need === 'connection' ||
    intent === 'greeting' ||
    socialIntent === 'greeting' ||
    socialIntent === 'how_are_you' ||
    conversationStage === 'opening'
  ) {
    // Opening with a concrete informational intent should answer, not only connect
    if (
      conversationStage === 'opening' &&
      (intent === 'learning' ||
        intent === 'problem_solving' ||
        intent === 'advice' ||
        intent === 'news')
    ) {
      if (intent === 'learning') return 'explain'
      if (intent === 'problem_solving') return 'guide'
      return 'answer'
    }
    if (intent === 'greeting' || socialIntent === 'greeting' || need === 'connection') {
      return 'connect'
    }
  }
  if (need === 'direction') return 'guide'
  if (need === 'information') return 'answer'
  return 'answer'
}

/**
 * @param {string} emotionalState
 * @param {MindStrategy} strategy
 * @param {string} socialIntent
 * @returns {MindEmotionalTone}
 */
function decideTone(emotionalState, strategy, socialIntent) {
  if (strategy === 'support') return 'supportive'
  if (strategy === 'celebrate') return 'encouraging'
  if (strategy === 'recover') return 'calm'
  if (strategy === 'close') return 'warm'
  if (strategy === 'explore' || strategy === 'continue') {
    if (emotionalState === 'playful' || socialIntent === 'laughter') return 'playful'
    if (emotionalState === 'curious') return 'curious'
    return 'warm'
  }
  if (strategy === 'connect') {
    if (emotionalState === 'playful') return 'playful'
    return 'warm'
  }
  if (strategy === 'explain' || strategy === 'guide' || strategy === 'answer') {
    if (emotionalState === 'frustrated' || emotionalState === 'urgent') return 'serious'
    if (emotionalState === 'curious') return 'curious'
    return 'calm'
  }
  if (emotionalState === 'excited' || emotionalState === 'happy') return 'encouraging'
  if (emotionalState === 'playful') return 'playful'
  if (emotionalState === 'anxious' || emotionalState === 'sad') return 'supportive'
  return 'neutral'
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @returns {MindResponseDepth}
 */
function decideDepth(ctx, strategy, need) {
  const { perception: p, session } = ctx

  if (session.isVoice) return 'light'
  if (session.preferenceBias === 'concise') return 'light'
  if (session.preferenceBias === 'detailed') {
    if (strategy === 'explain' || strategy === 'guide') return 'deep'
    return 'balanced'
  }

  if (strategy === 'close' || strategy === 'connect' || need === 'closure') {
    return p.socialIntent === 'greeting' ? 'light' : 'minimal'
  }
  if (strategy === 'support' || strategy === 'recover') return 'light'
  if (strategy === 'celebrate' || strategy === 'entertain') return 'light'
  if (strategy === 'continue') {
    return p.conversationStage === 'deepening' ? 'deep' : 'balanced'
  }

  if (strategy === 'explain' || strategy === 'guide') {
    if (p.knowledgeLevel === 'expert' || p.knowledgeLevel === 'advanced') return 'deep'
    if (p.knowledgeLevel === 'beginner') return 'balanced'
    if (p.emotionalState === 'confused') return 'balanced'
    return 'balanced'
  }

  if (p.conversationStage === 'deepening') return 'deep'
  return 'balanced'
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @returns {boolean}
 */
function decideUseMemory(ctx, strategy, need) {
  const { memory, session, perception: p } = ctx
  if (!session.memoryEnabled) return false
  if (strategy === 'close' || strategy === 'recover') return false
  if (need === 'feedback_ack' || need === 'closure') return false
  if (strategy === 'connect' && !memory.currentTopic && memory.topics.length === 0) {
    return false
  }

  if (memory.currentTopic || memory.unresolvedGoal) return true
  if (memory.topics.length > 0 && (strategy === 'continue' || strategy === 'guide')) {
    return true
  }
  if (
    p.intent === 'project_update' ||
    p.intent === 'life_update' ||
    p.intent === 'problem_solving' ||
    p.intent === 'advice'
  ) {
    return true
  }
  if (strategy === 'support' && memory.topics.length > 0) return true
  return false
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @returns {boolean}
 */
function decideContinueTopic(ctx, strategy, need) {
  const { memory, perception: p, session, conversationState: cs } = ctx

  if (need === 'closure' || strategy === 'close') return false
  if (cs?.conversationPhase === 'closing' || cs?.shortReply?.intent === 'stop') return false
  if (strategy === 'recover') return false
  if (strategy === 'connect' && p.conversationStage === 'opening' && !memory.currentTopic) {
    return false
  }
  if (session.userAskedToLead && !memory.currentTopic) return false

  // Consume Conversation State facts — do not re-derive topic.
  if (cs?.activeTopic) {
    if (
      cs.shortReply?.intent === 'accept_proposal' ||
      cs.shortReply?.intent === 'continue' ||
      cs.shortReply?.intent === 'uncertain' ||
      cs.continuity?.shouldResume ||
      strategy === 'continue' ||
      cs.conversationPhase === 'deepening' ||
      cs.conversationPhase === 'executing'
    ) {
      return true
    }
    if (strategy !== 'explore' && strategy !== 'connect') return true
  }

  if (strategy === 'continue') return true
  if (p.intent === 'continuation') return true
  if (memory.lastUserStance === 'short_ack' && memory.currentTopic) return true
  if (memory.currentTopic && strategy !== 'explore' && strategy !== 'connect') {
    return true
  }
  if (
    memory.unresolvedGoal &&
    (strategy === 'guide' || strategy === 'explain' || strategy === 'answer')
  ) {
    return true
  }
  return false
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @param {boolean} shouldComfort
 * @returns {boolean}
 */
function decideAskQuestion(ctx, strategy, need, shouldComfort) {
  const { session, memory, perception: p } = ctx

  // Hard economy
  if (session.questionStreak >= 2) return false
  if (strategy === 'close' || need === 'closure') return false
  if (p.socialIntent === 'farewell' || p.socialIntent === 'thanks') return false
  if (strategy === 'recover' || need === 'feedback_ack') return false

  // Comfort-first: usually no question
  if (shouldComfort || strategy === 'support') return false

  // Continuation / celebrate / entertain: prefer contribution over interrogation
  if (strategy === 'continue' || strategy === 'celebrate' || strategy === 'entertain') {
    return false
  }

  // Connect / greeting: almost never interview
  if (strategy === 'connect') return false

  // Delegating user: don't bounce the choice back
  if (session.userAskedToLead || memory.lastUserStance === 'delegating') return false

  // Clarify only when blocked and unclear
  if (need === 'unclear' && p.confidence < 0.45) return true

  // Guide/explain: rare clarifying question if confused beginner and no open Q overload
  if (
    (strategy === 'guide' || strategy === 'explain') &&
    p.emotionalState === 'confused' &&
    memory.openQuestions.length === 0 &&
    session.questionStreak === 0
  ) {
    return true
  }

  // Explore with direction already chosen → no question
  if (strategy === 'explore') return false

  return false
}

/**
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @param {string} intent
 * @returns {boolean}
 */
function decideTeach(strategy, need, intent) {
  if (strategy === 'explain') return true
  if (need === 'explanation') return true
  if (intent === 'learning') return true
  return false
}

/**
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @param {string} emotionalState
 * @returns {boolean}
 */
function decideComfort(strategy, need, emotionalState) {
  if (strategy === 'support' || need === 'emotional_care') return true
  if (
    emotionalState === 'sad' ||
    emotionalState === 'anxious' ||
    emotionalState === 'angry'
  ) {
    return true
  }
  return false
}

/**
 * Challenge = respectful push / reframing. Never with strong comfort.
 *
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindStrategy} strategy
 * @param {boolean} shouldComfort
 * @returns {boolean}
 */
function decideChallenge(ctx, strategy, shouldComfort) {
  if (shouldComfort) return false
  if (strategy === 'support' || strategy === 'recover' || strategy === 'close') return false
  if (strategy === 'celebrate' || strategy === 'connect') return false

  const { perception: p, memory, session } = ctx
  if (p.emotionalState === 'frustrated' || p.emotionalState === 'angry') return false
  if (memory.lastUserStance === 'resistant') return false
  if (session.userAskedToLead) return false

  if (strategy === 'guide' && memory.lastUserStance === 'engaged') return true
  if (strategy === 'explore' && p.intent === 'advice') return true
  if (
    strategy === 'answer' &&
    p.intent === 'reflection' &&
    p.conversationStage === 'deepening'
  ) {
    return true
  }
  return false
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @param {boolean} shouldAskQuestion
 * @returns {MindInitiative}
 */
function decideInitiative(ctx, strategy, need, shouldAskQuestion) {
  const { session, memory, perception: p } = ctx

  if (strategy === 'close' || need === 'closure') return 'none'
  if (strategy === 'recover' || need === 'feedback_ack') return 'none'
  if (strategy === 'support') return 'none'
  if (session.initiativeStreak >= 2) return 'none'
  if (shouldAskQuestion) return 'none' // question already occupies the coda slot

  if (session.userAskedToLead || memory.lastUserStance === 'delegating') {
    return 'one_direction'
  }
  if (strategy === 'explore' || need === 'direction' || p.intent === 'boredom') {
    return 'one_direction'
  }
  if (strategy === 'connect' && p.conversationStage === 'opening') {
    return 'one_spark'
  }
  if (strategy === 'continue' && memory.currentTopic) {
    return 'one_insight'
  }
  if (strategy === 'celebrate') return 'none'
  if (strategy === 'explain' || strategy === 'guide') {
    // One optional insight after teaching/guiding if engaged
    if (memory.lastUserStance === 'engaged' && session.initiativeStreak === 0) {
      return 'one_insight'
    }
    return 'none'
  }
  if (strategy === 'entertain') return 'one_spark'
  return 'none'
}

/**
 * @param {MindStrategy} strategy
 * @param {MindNeed} need
 * @param {MindInitiative} initiative
 * @param {boolean} shouldContinueTopic
 * @returns {string}
 */
function buildGoal(strategy, need, initiative, shouldContinueTopic) {
  const parts = [strategy, `need_${need}`]
  if (shouldContinueTopic) parts.push('continue_topic')
  if (initiative !== 'none') parts.push(initiative)
  return parts.join('__')
}

/**
 * @param {ReturnType<typeof normalize>} ctx
 * @param {MindDecision} decision
 * @returns {number}
 */
function decideConfidence(ctx, decision) {
  let c = 0.4 + ctx.perception.confidence * 0.45

  // Clear social / support / farewell patterns → higher decision confidence
  if (
    decision.strategy === 'support' ||
    decision.strategy === 'close' ||
    decision.strategy === 'recover' ||
    decision.strategy === 'connect'
  ) {
    c += 0.12
  }

  if (ctx.perception.intent === 'unclear' || decision.need === 'unclear') {
    c -= 0.15
  }
  if (ctx.session.userAskedToLead && decision.initiative === 'one_direction') {
    c += 0.08
  }
  if (decision.shouldComfort && decision.shouldChallenge) {
    // should be impossible; penalize if invariant broken
    c -= 0.3
  }

  return Number(Math.max(0.15, Math.min(0.98, c)).toFixed(3))
}

/**
 * Apply hard invariants after drafting flags.
 * @param {MindDecision} d
 * @returns {MindDecision}
 */
function enforceInvariants(d) {
  const out = { ...d }

  if (out.shouldComfort) out.shouldChallenge = false
  if (out.strategy === 'close') {
    out.shouldAskQuestion = false
    out.initiative = 'none'
    out.shouldContinueTopic = false
  }
  if (out.strategy === 'support') {
    out.shouldAskQuestion = false
    out.shouldChallenge = false
  }
  if (out.shouldAskQuestion && out.initiative !== 'none') {
    // Single coda slot: question wins over initiative
    out.initiative = 'none'
  }
  if (!STRATEGIES.includes(out.strategy)) out.strategy = 'answer'
  if (!NEEDS.includes(out.need)) out.need = 'unclear'

  out.goal = buildGoal(
    out.strategy,
    out.need,
    out.initiative,
    out.shouldContinueTopic,
  )

  return out
}

/**
 * Decide what to do this turn. Pure. No I/O. No text generation.
 *
 * @param {MindInput} [input]
 * @returns {MindDecision}
 */
export function think(input = {}) {
  const ctx = normalize(input)
  const { perception: p } = ctx

  const need = decideNeed(
    p.userNeed,
    p.intent,
    p.socialIntent,
    p.conversationStage,
    ctx.session,
  )
  const strategy = decideStrategy(ctx, need)
  const shouldComfort = decideComfort(strategy, need, p.emotionalState)
  const shouldTeach = decideTeach(strategy, need, p.intent)
  const shouldAskQuestion = decideAskQuestion(ctx, strategy, need, shouldComfort)
  const shouldChallenge = decideChallenge(ctx, strategy, shouldComfort)
  const shouldUseMemory = decideUseMemory(ctx, strategy, need)
  const shouldContinueTopic = decideContinueTopic(ctx, strategy, need)
  const initiative = decideInitiative(ctx, strategy, need, shouldAskQuestion)
  const emotionalTone = decideTone(p.emotionalState, strategy, p.socialIntent)
  const responseDepth = decideDepth(ctx, strategy, need)
  const goal = buildGoal(strategy, need, initiative, shouldContinueTopic)

  /** @type {MindDecision} */
  let decision = {
    need,
    goal,
    strategy,
    initiative,
    emotionalTone,
    responseDepth,
    shouldUseMemory,
    shouldContinueTopic,
    shouldAskQuestion,
    shouldTeach,
    shouldComfort,
    shouldChallenge,
    confidence: 0.5,
  }

  decision = enforceInvariants(decision)
  decision.confidence = decideConfidence(ctx, decision)

  return decision
}

/**
 * @param {unknown} value
 * @returns {value is MindDecision}
 */
export function isMindDecision(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {Record<string, unknown>} */ (value)
  return (
    typeof v.need === 'string' &&
    typeof v.goal === 'string' &&
    typeof v.strategy === 'string' &&
    typeof v.initiative === 'string' &&
    typeof v.emotionalTone === 'string' &&
    typeof v.responseDepth === 'string' &&
    typeof v.shouldUseMemory === 'boolean' &&
    typeof v.shouldContinueTopic === 'boolean' &&
    typeof v.shouldAskQuestion === 'boolean' &&
    typeof v.shouldTeach === 'boolean' &&
    typeof v.shouldComfort === 'boolean' &&
    typeof v.shouldChallenge === 'boolean' &&
    typeof v.confidence === 'number'
  )
}
