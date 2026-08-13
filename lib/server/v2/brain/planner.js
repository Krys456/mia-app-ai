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

import {
  DEFAULT_RUNTIME_PROFILE,
  resolveRuntimeProfile,
} from './runtime-profile.js'
import {
  interpretShortReply,
  moveRequiresMinimalAck,
} from './short-reply.js'
import {
  buildConversationState,
  shortReplyStateFromConversationState,
} from './conversation-state.js'
import {
  constrainAdaptiveResponseProfile,
  buildAdaptiveResponseProfile,
  mapAdaptiveDepthToMind,
  formatAdaptiveResponseProfileForWriter,
} from './adaptive-response-profile.js'

export const PLANNER_VERSION = '2.8.0-planner'

/**
 * Exploration-only principle directives (research/conversation-intelligence).
 * Applied when useExplorationPrinciples=true and experience=exploration.
 * @type {readonly string[]}
 */
export const EXPLORATION_PRINCIPLES_DIRECTIVES = Object.freeze([
  'apri con un fatto sorprendente, una domanda, o un\'osservazione inattesa',
  'preferisci una sola idea sorprendente a molte idee generiche',
  'offri una direzione inattesa, non un catalogo di argomenti',
  'evita di aprire con "Possiamo parlare di..."',
  'evita elenchi generici di temi',
  'usa un thought experiment o un fatto inatteso per aprire angoli nuovi',
  'prendi iniziativa alta: proponi una direzione invece di un menu',
  'tieni profondità corta ed energia alta; massimizza curiosità e novità',
])

/**
 * Learning-only principle directives (Experiment 002).
 * Applied when useLearningPrinciples=true and experience=learning.
 * Concept → Why → Example progression.
 * @type {readonly string[]}
 */
export const LEARNING_PRINCIPLES_DIRECTIVES = Object.freeze([
  'start by answering the user\'s question directly',
  'explain the core concept in simple language',
  'explain why it matters',
  'give one concrete real-world example',
  'only then ask a follow-up question if it genuinely helps',
  'avoid long introductions',
  'avoid definitions without examples',
  'avoid multiple examples',
  'avoid asking questions before answering',
])

/**
 * Planning-only principle directives (Experiment 003).
 * Applied when usePlanningPrinciples=true and experience=planning.
 * Lead with an actionable plan instead of explanation.
 * @type {readonly string[]}
 */
export const PLANNING_PRINCIPLES_DIRECTIVES = Object.freeze([
  'start with the first concrete action',
  'if multiple actions are needed, order them logically',
  'keep the first action immediately executable',
  'explain only what is necessary',
  'end after the plan unless clarification is essential',
  'avoid long introductions',
  'avoid generic motivation',
  'avoid repeating the user\'s goal',
  'avoid large option lists without recommendation',
])

/** Minimum Conversation Resume confidence required before Planner may use it. */
export const RESUME_MIN_CONFIDENCE = 0.75

/** Resume cues are only eligible in early conversation turns (user turns). */
export const RESUME_MAX_EARLY_USER_TURNS = 3

/** Minimum confidence to reshape development from Conversation Experience. */
export const EXPERIENCE_MIN_CONFIDENCE = 0.5

/**
 * Supported conversational experiences (Planner chooses one per turn).
 * @typedef {'conversation'|'learning'|'brainstorming'|'debugging'|'planning'|'decision'|'exploration'|'creative'|'support'|'celebration'|'resume'} ConversationExperienceKind
 */

/** @type {readonly ConversationExperienceKind[]} */
export const CONVERSATION_EXPERIENCES = Object.freeze([
  'conversation',
  'learning',
  'brainstorming',
  'debugging',
  'planning',
  'decision',
  'exploration',
  'creative',
  'support',
  'celebration',
  'resume',
])

/**
 * @typedef {object} ConversationExperience
 * @property {ConversationExperienceKind} experience
 * @property {number} confidence
 * @property {string} reason
 */

/**
 * Experience guidance for development (not a Writer rule set).
 * @typedef {object} ExperienceGuidance
 * @property {ConversationExperienceKind} experience
 * @property {string[]} directives
 */

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
 * @property {string|null} [resumeSentence] opaque cue for Writer only (full resume never passed)
 * @property {import('./short-reply.js').ConversationalMove} [conversationalMove] immutable WHAT for Writer
 * @property {boolean} [shouldContinue] Planner continue/stop contract
 * @property {boolean} [shouldAskQuestion] Planner ask/no-ask contract (immutable for Writer)
 * @property {string|null} [activeTopic] living topic Writer must keep
 * @property {string|null} [pendingProposalAction] what to execute when move is execute/continue
 * @property {boolean} [forceMinimalAck] Writer may collapse to short ack ONLY when true
 * @property {import('./short-reply.js').ShortReplyIntent} [shortReplyIntent]
 * @property {import('./adaptive-response-profile.js').AdaptiveResponseProfile} [responseProfile] Phase 4 adaptive HOW profile
 */

/**
 * Temporary Phase-1 short-reply interpretation attached to the plan (not full Conversation State).
 * @typedef {import('./short-reply.js').ShortReplyState} ShortReplyState
 */

/**
 * @typedef {object} ConversationResumeUsage
 * @property {boolean} used
 * @property {number} confidence
 * @property {string} reason
 * @property {string|null} resumeSentence
 */

/**
 * @typedef {object} PlannerPlan
 * @property {string} objective
 * @property {ConversationPlan} conversationPlan
 * @property {WriterBrief} writerBrief
 * @property {string[]} constraints
 * @property {number} confidence
 * @property {ConversationFocus} conversationFocus Focus assessment (compat; topic authority is conversationState.activeTopic)
 * @property {ConversationMomentum} conversationMomentum Compat mirror of conversationMode (not a second topic authority)
 * @property {ConversationResumeUsage} conversationResume
 * @property {ConversationExperience} conversationExperience
 * @property {ExperienceGuidance} experienceGuidance
 * @property {import('./conversation-state.js').ConversationState} conversationState First-class situation facts (Phase 2)
 * @property {DirectorState} directorState Conversation Director decisions (WHAT next — not situation facts)
 * @property {ShortReplyState} [shortReplyState] authoritative short-reply interpretation (Phase 1; also on conversationState.shortReply)
 * @property {import('./adaptive-response-profile.js').AdaptiveResponseProfile} [responseProfile] Phase 4 adaptive HOW profile
 */

/**
 * Conversation Director move categories (one per assistant turn).
 * @typedef {'surprise'|'teach'|'deepen'|'challenge'|'comfort'|'motivate'|'brainstorm'|'summarize'} DirectorObjective
 */

/**
 * Estimated user engagement for the latest turn.
 * @typedef {'low'|'uncertain'|'engaged'|'high'|'maximum'} UserEngagement
 */

/**
 * How the latest user turn continues the dialogue.
 * @typedef {'encouragement'|'curiosity_question'|'explicit_continue'|'topic_change'|'substantive'|'opening'|'uncertain_signal'} ContinuationType
 */

/**
 * Conversation Director decisions — strategy flags only (not situation facts).
 * Situation facts live on Conversation State (Phase 2).
 * @typedef {object} DirectorState
 * @property {string|null} activeTopic mirrored from Conversation State for directive text
 * @property {DirectorObjective} objective
 * @property {number} curiosityLevel 0..1
 * @property {UserEngagement} userEngagement
 * @property {ContinuationType} continuationType
 * @property {string} expectedNextReaction
 * @property {boolean} shouldLeadConversation
 * @property {boolean} shouldAskQuestion
 * @property {boolean} shouldExplain
 * @property {boolean} shouldSurprise
 * @property {boolean} shouldChangeTopic
 * @property {string[]} signals
 */

/** @typedef {DirectorState} ConversationState @deprecated Use DirectorState; situation facts are import('./conversation-state.js').ConversationState */

/**
 * @typedef {'active'|'changed'|'ambiguous'|'none'} ConversationFocusStatus
 */

/**
 * Living topic assessment from the current chat history only (no durable memory).
 * @typedef {object} ConversationFocus
 * @property {string|null} topic
 * @property {ConversationFocusStatus} status
 * @property {number} confidence
 * @property {string[]} signals
 * @property {boolean} avoidClarification
 */

/**
 * @typedef {'social'|'brainstorming'|'learning'|'debugging'|'planning'|'decision'|'storytelling'|'emotional_support'} ConversationMomentumKind
 */

/**
 * Conversational momentum / mode inferred from current chat history only.
 * @typedef {object} ConversationMomentum
 * @property {ConversationMomentumKind} kind
 * @property {number} confidence
 * @property {string[]} signals
 * @property {Partial<Record<ConversationMomentumKind, number>>} scores
 */

/**
 * @typedef {object} ChatMessage
 * @property {string} [role]
 * @property {string} [content]
 */

/**
 * @typedef {object} PlannerInput
 * @property {PerceptionResult} [perception]
 * @property {MindDecision} [decision]
 * @property {ChatMessage[]} [messages] current chat history only (no permanent memory)
 * @property {import('./conversation-state.js').ConversationState} [conversationState] Phase 2 situation facts (primary conversational context)
 * @property {object} [conversationResume] output of Conversation Resume Engine (optional compat)
 * @property {boolean} [useConversationExperience] when false, keep prior development path (lab A/B)
 * @property {boolean} [useExplorationPrinciples] when true, inject research exploration principles into exploration guidance only
 * @property {boolean} [useLearningPrinciples] when true, inject Concept→Why→Example learning principles into learning guidance only
 * @property {boolean} [usePlanningPrinciples] when true, inject actionable-plan planning principles into planning guidance only
 * @property {string|import('./runtime-profile.js').RuntimeProfileFlags} [runtimeProfile] named profile or flag object (default: production)
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

/** @type {ConversationMomentumKind[]} */
const MOMENTUM_KINDS = [
  'social',
  'brainstorming',
  'learning',
  'debugging',
  'planning',
  'decision',
  'storytelling',
  'emotional_support',
]

const MOMENTUM_KIND_SET = new Set(MOMENTUM_KINDS)

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

  /** @type {ChatMessage[]} */
  const messages = []
  if (Array.isArray(raw.messages)) {
    for (const m of raw.messages) {
      if (!m || typeof m !== 'object') continue
      const role = asString(m.role).toLowerCase()
      const content = asString(m.content).trim()
      if (!content) continue
      if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
      messages.push({ role, content })
    }
  }

  const conversationResume =
    raw.conversationResume && typeof raw.conversationResume === 'object'
      ? raw.conversationResume
      : null

  const conversationState =
    raw.conversationState && typeof raw.conversationState === 'object'
      ? raw.conversationState
      : null

  const profile = resolveRuntimeProfile(
    raw.runtimeProfile != null ? raw.runtimeProfile : DEFAULT_RUNTIME_PROFILE,
  )

  /**
   * Explicit boolean flags override the profile; otherwise profile values apply.
   * @param {unknown} rawFlag
   * @param {boolean} profileFlag
   */
  const principleFlag = (rawFlag, profileFlag) =>
    typeof rawFlag === 'boolean' ? rawFlag : profileFlag === true

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
    messages,
    conversationResume,
    conversationState,
    useConversationExperience: raw.useConversationExperience !== false,
    useExplorationPrinciples: principleFlag(
      raw.useExplorationPrinciples,
      profile.useExplorationPrinciples,
    ),
    useLearningPrinciples: principleFlag(
      raw.useLearningPrinciples,
      profile.useLearningPrinciples,
    ),
    usePlanningPrinciples: principleFlag(
      raw.usePlanningPrinciples,
      profile.usePlanningPrinciples,
    ),
    runtimeProfileName: profile.name || DEFAULT_RUNTIME_PROFILE,
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

const FOCUS_STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'di', 'a', 'da', 'in', 'con', 'su', 'per',
  'tra', 'fra', 'the', 'and', 'or', 'to', 'of', 'is', 'are', 'am', 'be', 'was', 'were', 'a', 'an',
  'che', 'chi', 'cosa', 'non', 'mi', 'ti', 'ci', 'vi', 'si', 'ho', 'hai', 'ha', 'hanno', 'sono',
  'sei', 'siamo', 'come', 'what', 'how', 'why', 'when', 'where', 'which', 'this', 'that', 'with',
  'from', 'your', 'you', 'me', 'my', 'our', 'we', 'they', 'them', 'ciao', 'hey', 'hello', 'ok',
  'okay', 'yes', 'no', 'si', 'sì', 'nope', 'just', 'very', 'really', 'anche', 'poi', 'già',
  'qui', 'qua', 'li', 'là', 'del', 'della', 'dei', 'delle', 'degli', 'nel', 'nella', 'nei',
  'nelle', 'al', 'alla', 'ai', 'alle', 'dal', 'dalla', 'dai', 'dalle', 'please', 'grazie',
  'thanks', 'thank', 'perché', 'perche', 'because', 'about', 'into', 'over', 'under',
])

/**
 * Short encouragement / ack turns: keep the living topic and continue it.
 * Whole-utterance match (optional light punctuation / emoji).
 */
const MINIMAL_CONTINUATION_RE =
  /^(ok|okay|okey|okk|esatto|certo|perfetto|va\s*bene|d['’]?accordo|sure|exactly|right|perfect|alright|all\s*right|sì|si|yes|yep|yeah|yup|mh+|mhm+|mm+|uhm+|uh-huh|hmm+|aha|ah+|oh+|vai|vai\s*pure|dimmi|dimmi\s*di\s*più|continua|continuiamo|interessante|interessantissimo|go\s*on|go\s*ahead|tell\s*me\s*more|keep\s*going|proceed|cool|nice|great|bene|ottimo|bravo|davvero|vero|giusto)[.!…?]*$/i

/**
 * Explicit Conversation Cues for focus (signals only — do not replace semantic overlap).
 * @type {readonly string[]}
 */
export const CONTINUATION_CUES = Object.freeze([
  'continuiamo',
  'continua',
  'riprendiamo',
  'riparti',
  'proseguiamo',
  'andiamo avanti',
  'dove eravamo rimasti',
  'come dicevamo',
  'torniamo a',
  'vai avanti',
  'vai',
  'dimmi',
  'interessante',
  'keep going',
  'tell me more',
  'go on',
])

/**
 * Exported for tests — short encouragement utterances that must preserve topic.
 * @type {readonly string[]}
 */
export const ENCOURAGEMENT_CONTINUATION_EXAMPLES = Object.freeze([
  'ok',
  'mh',
  'continua',
  'vai',
  'interessante',
  'sì',
  'dimmi',
])

/**
 * @type {readonly string[]}
 */
export const TOPIC_CHANGE_CUES = Object.freeze([
  'cambiando argomento',
  "un'altra cosa",
  'a proposito',
  'invece',
  'lasciamo stare',
  'parliamo di',
  'tornando ad altro',
  'ho un\'altra domanda',
])

/** Soft legacy continuation phrases (secondary signals). */
const SOFT_CONTINUATION_CUE_RE =
  /\b(e poi|quindi|allora|comunque|ne (?:parlavamo|parlavo|parliamo)|questo|quello|questa|quella|ci sono ancora|ancora su|regarding that|about that|as I (?:was|said)|and then)\b/i

const GREETING_RE =
  /^(ciao|hey|hi|hello|salve|buongiorno|buonasera)[!.,\s]*$/i

/**
 * @param {string} cue
 * @returns {RegExp}
 */
function cueToRegExp(cue) {
  const escaped = asString(cue)
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
    .replace(/'/g, "['’]")
  // Phrase boundary: avoid matching inside longer tokens when cue is a single word.
  if (!/\s/.test(cue) && !/'/.test(cue)) {
    return new RegExp(`(?:^|[^a-z0-9àèéìòù])${escaped}(?=$|[^a-z0-9àèéìòù])`, 'i')
  }
  return new RegExp(escaped, 'i')
}

/**
 * @param {string} text
 * @param {readonly string[]} cues
 * @returns {string[]}
 */
export function matchConversationCues(text, cues) {
  const raw = asString(text)
  if (!raw.trim()) return []
  /** @type {string[]} */
  const hits = []
  for (const cue of cues) {
    if (cueToRegExp(cue).test(raw)) hits.push(cue)
  }
  return hits
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function focusTokens(text) {
  const raw = asString(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const parts = raw.match(/[a-z0-9]{3,}/g) || []
  /** @type {string[]} */
  const out = []
  for (const p of parts) {
    if (FOCUS_STOPWORDS.has(p)) continue
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function tokenOverlapRatio(a, b) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let hit = 0
  for (const t of a) {
    if (setB.has(t)) hit += 1
  }
  return hit / Math.min(a.length, b.length)
}

/**
 * @param {ChatMessage[]} messages
 * @returns {{ latestUser: string, priorUser: string, priorAssistant: string, priorBlob: string }}
 */
function splitHistoryForFocus(messages) {
  /** @type {ChatMessage[]} */
  const list = Array.isArray(messages) ? messages : []
  let latestUser = ''
  let latestUserIdx = -1
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role === 'user') {
      latestUser = asString(list[i].content).trim()
      latestUserIdx = i
      break
    }
  }

  /** @type {string[]} */
  const priorUserParts = []
  /** @type {string[]} */
  const priorAssistantParts = []
  for (let i = 0; i < list.length; i += 1) {
    if (i === latestUserIdx) continue
    const content = asString(list[i].content).trim()
    if (!content) continue
    if (list[i].role === 'user') priorUserParts.push(content)
    if (list[i].role === 'assistant') priorAssistantParts.push(content)
  }

  const priorUser = priorUserParts.slice(-2).join(' ')
  const priorAssistant = priorAssistantParts.slice(-2).join(' ')
  const priorBlob = [priorUser, priorAssistant].filter(Boolean).join('\n')

  return { latestUser, priorUser, priorAssistant, priorBlob }
}

/**
 * @param {string} priorBlob
 * @param {string[]} priorTokens
 * @returns {string|null}
 */
function labelTopic(priorBlob, priorTokens) {
  if (priorTokens.length) {
    return priorTokens.slice(0, 6).join(' ')
  }
  const compact = asString(priorBlob).replace(/\s+/g, ' ').trim()
  if (!compact) return null
  return compact.length > 64 ? `${compact.slice(0, 63)}…` : compact
}

/**
 * Normalize a short user turn for encouragement matching.
 * @param {string} text
 * @returns {string}
 */
function normalizeEncouragementUtterance(text) {
  return asString(text)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when the latest user turn is a short encouragement to continue the thread.
 * @param {string} latestUser
 * @returns {boolean}
 */
export function isEncouragementContinuation(latestUser) {
  const normalized = normalizeEncouragementUtterance(latestUser)
  if (!normalized) return false
  if (MINIMAL_CONTINUATION_RE.test(normalized)) return true
  // Ultra-short interjections with no content tokens (e.g. "mh", "mhh", "…")
  const tokens = focusTokens(normalized)
  if (tokens.length === 0 && normalized.length > 0 && normalized.length <= 12) {
    if (/^[mh.!?…\s]+$/i.test(normalized)) return true
    if (/^[.!?…]+$/.test(normalized)) return true
  }
  return false
}

/**
 * Prefer the last substantive assistant turn as the living topic source
 * so empty acks like "Va bene." do not erase the active thread.
 *
 * @param {ChatMessage[]} messages
 * @returns {{ topic: string|null, source: string }}
 */
function livingTopicFromHistory(messages) {
  /** @type {ChatMessage[]} */
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (asString(list[i].role).toLowerCase() !== 'assistant') continue
    const content = asString(list[i].content).trim()
    if (!content) continue
    if (MINIMAL_CONTINUATION_RE.test(normalizeEncouragementUtterance(content))) continue
    if (content.length < 12 && focusTokens(content).length === 0) continue
    const tokens = focusTokens(content)
    const topic = labelTopic(content, tokens)
    if (topic) return { topic, source: 'last_substantive_assistant' }
  }

  const { priorUser, priorBlob } = splitHistoryForFocus(messages)
  const priorTokens = focusTokens(priorBlob)
  return {
    topic: labelTopic(priorBlob || priorUser, priorTokens),
    source: 'prior_blob',
  }
}

/**
 * Conversation-facing objective for Writer (never a bare Mind machine goal alone
 * when the topic is still living).
 *
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ConversationFocus} focus
 * @param {ConversationMomentum} momentum
 * @param {ChatMessage[]} messages
 * @returns {string}
 */
export function buildConversationObjective(decision, focus, momentum, messages = []) {
  const encouragement =
    focus?.signals?.some((s) =>
      /minimal_ack_continuation|encouragement_continuation|continuation_cue:|soft_continuation_cue|preserve_momentum/.test(
        s,
      ),
    ) || false

  const active = focus?.status === 'active'
  const kind = momentum?.kind

  if (active && encouragement) {
    if (kind === 'learning') return 'Deepen the previous explanation.'
    if (kind === 'storytelling') return 'Continue the previous narrative beat.'
    if (kind === 'brainstorming') return 'Expand the previous idea with one fresh angle.'
    if (kind === 'social') return 'Connect to the previous assistant sentence.'
    // Default for scientific / exploratory threads after "ok" / "mh" / "continua"
    return 'Deepen the previous explanation.'
  }

  if (active) {
    if (decision.shouldTeach || kind === 'learning') {
      return 'Create curiosity before explaining.'
    }
    if (decision.initiative === 'one_insight' || decision.initiative === 'one_spark') {
      return 'Introduce an unexpected scientific fact.'
    }
    if (decision.strategy === 'continue' || decision.shouldContinueTopic) {
      return 'Connect to the previous assistant sentence.'
    }
    return 'Deepen the previous explanation.'
  }

  if (focus?.status === 'changed') {
    return decision.goal || `${decision.strategy}__need_${decision.need}`
  }

  if (focus?.status === 'none' && Array.isArray(messages) && messages.length === 0) {
    return decision.goal || `${decision.strategy}__need_${decision.need}`
  }

  // Ambiguous / none with history: still prefer a conversation move over isolated facts
  if (decision.shouldTeach) return 'Create curiosity before explaining.'
  if (decision.initiative === 'one_insight' || decision.initiative === 'one_spark') {
    return 'Introduce an unexpected scientific fact.'
  }
  return decision.goal || `${decision.strategy}__need_${decision.need}`
}

/** @type {readonly DirectorObjective[]} */
export const DIRECTOR_OBJECTIVES = Object.freeze([
  'surprise',
  'teach',
  'deepen',
  'challenge',
  'comfort',
  'motivate',
  'brainstorm',
  'summarize',
])

const WHY_QUESTION_RE =
  /^(perch[eé]\??|why\??|come mai\??|how come\??)\s*$/i
const CURIOSITY_QUESTION_RE =
  /\b(perch[eé]|why|come|how|what if|e se|davvero\?|really\?)\b/i
const EXPLICIT_CONTINUE_RE =
  /^(continua|continuiamo|continue|vai|vai avanti|go on|keep going|tell me more|dimmi|dimmi di più)[.!…]*$/i
const INTERESTING_RE =
  /^(interessante|interessantissimo|interesting|cool|nice|fascinating)[.!…]*$/i

/**
 * @param {string} latestUser
 * @param {ConversationFocus} focus
 * @returns {{ engagement: UserEngagement, continuationType: ContinuationType, curiosityLevel: number, signals: string[] }}
 */
export function estimateUserEngagement(latestUser, focus) {
  const text = asString(latestUser).replace(/\s+/g, ' ').trim()
  /** @type {string[]} */
  const signals = []

  if (!text) {
    return {
      engagement: 'low',
      continuationType: 'opening',
      curiosityLevel: 0.2,
      signals: ['empty_latest'],
    }
  }

  if (EXPLICIT_CONTINUE_RE.test(text) || /^(continua|keep going|go on)\b/i.test(text)) {
    signals.push('explicit_continue')
    return {
      engagement: 'maximum',
      continuationType: 'explicit_continue',
      curiosityLevel: 0.92,
      signals,
    }
  }

  if (WHY_QUESTION_RE.test(text) || (/^\S{1,40}\?$/.test(text) && CURIOSITY_QUESTION_RE.test(text))) {
    signals.push('curiosity_question')
    return {
      engagement: 'high',
      continuationType: 'curiosity_question',
      curiosityLevel: 0.95,
      signals,
    }
  }

  if (INTERESTING_RE.test(text)) {
    signals.push('interesting_ack')
    return {
      engagement: 'engaged',
      continuationType: 'encouragement',
      curiosityLevel: 0.78,
      signals,
    }
  }

  if (/^(ok|okay|okey|okk|sì|si|yes|yep|yeah|certo|perfetto|va bene)[.!…]*$/i.test(text)) {
    signals.push('ok_engaged')
    return {
      engagement: 'engaged',
      continuationType: 'encouragement',
      curiosityLevel: 0.7,
      signals,
    }
  }

  if (/^(mh+|mhm+|mm+|hmm+|uhm+)[.!…]*$/i.test(text) || isEncouragementContinuation(text) && /^m/i.test(text)) {
    signals.push('uncertain_ack')
    return {
      engagement: 'uncertain',
      continuationType: 'uncertain_signal',
      curiosityLevel: 0.55,
      signals,
    }
  }

  if (isEncouragementContinuation(text)) {
    signals.push('encouragement')
    return {
      engagement: 'engaged',
      continuationType: 'encouragement',
      curiosityLevel: 0.72,
      signals,
    }
  }

  if (focus?.status === 'changed' || matchConversationCues(text, TOPIC_CHANGE_CUES).length) {
    signals.push('topic_change_signal')
    return {
      engagement: 'engaged',
      continuationType: 'topic_change',
      curiosityLevel: 0.6,
      signals,
    }
  }

  if (focus?.status === 'none') {
    return {
      engagement: 'engaged',
      continuationType: 'opening',
      curiosityLevel: 0.5,
      signals: ['opening'],
    }
  }

  signals.push('substantive')
  return {
    engagement: 'engaged',
    continuationType: 'substantive',
    curiosityLevel: Math.min(0.85, 0.45 + Math.min(text.length, 120) / 200),
    signals,
  }
}

/**
 * Medium+ engagement must never change topic.
 * @param {UserEngagement} engagement
 * @returns {boolean}
 */
export function isEngagementMediumOrHigher(engagement) {
  return (
    engagement === 'uncertain' ||
    engagement === 'engaged' ||
    engagement === 'high' ||
    engagement === 'maximum'
  )
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ConversationFocus} focus
 * @param {ConversationMomentum} momentum
 * @param {ContinuationType} continuationType
 * @param {UserEngagement} engagement
 * @returns {DirectorObjective}
 */
export function chooseDirectorObjective(decision, focus, momentum, continuationType, engagement) {
  if (decision.shouldComfort) return 'comfort'
  if (decision.shouldChallenge) return 'challenge'
  if (decision.strategy === 'celebrate') return 'motivate'
  if (decision.strategy === 'close') return 'summarize'
  if (momentum?.kind === 'brainstorming' || decision.strategy === 'explore') return 'brainstorm'
  if (momentum?.kind === 'learning' || decision.shouldTeach || decision.strategy === 'explain') {
    if (continuationType === 'encouragement' || continuationType === 'explicit_continue') {
      return 'deepen'
    }
    return 'teach'
  }
  if (
    continuationType === 'encouragement' ||
    continuationType === 'uncertain_signal' ||
    continuationType === 'explicit_continue'
  ) {
    return engagement === 'uncertain' ? 'deepen' : 'deepen'
  }
  if (decision.initiative === 'one_insight' || decision.initiative === 'one_spark') return 'surprise'
  if (decision.strategy === 'support') return 'comfort'
  if (focus?.status === 'none' || continuationType === 'opening') return 'surprise'
  if (decision.strategy === 'continue') return 'deepen'
  return 'teach'
}

/**
 * Map director objective → Writer-facing conversation objective string.
 * @param {DirectorObjective} objective
 * @param {DirectorState} state
 * @returns {string}
 */
export function directorObjectiveToPlanObjective(objective, state) {
  switch (objective) {
    case 'surprise':
      return state.shouldSurprise
        ? 'Open with an unexpected fact.'
        : 'Introduce an unexpected scientific fact.'
    case 'teach':
      return 'Create curiosity before explaining.'
    case 'deepen':
      return 'Deepen the previous explanation.'
    case 'challenge':
      return 'Challenge the current idea respectfully.'
    case 'comfort':
      return 'Comfort and stay with the user.'
    case 'motivate':
      return 'Motivate with one concrete next spark.'
    case 'brainstorm':
      return 'Brainstorm one fresh angle on the active topic.'
    case 'summarize':
      return 'Summarize the thread and leave a clean close.'
    default:
      return 'Connect to the previous assistant sentence.'
  }
}

/**
 * One-turn-ahead reaction the next assistant message should create.
 * @param {DirectorObjective} objective
 * @param {UserEngagement} engagement
 * @param {ContinuationType} continuationType
 * @returns {string}
 */
export function estimateExpectedNextReaction(objective, engagement, continuationType) {
  if (continuationType === 'curiosity_question' || engagement === 'high') {
    return 'User asks another question.'
  }
  if (engagement === 'maximum' || continuationType === 'explicit_continue') {
    return 'User stays on topic and asks to go further.'
  }
  if (engagement === 'uncertain') {
    return 'User becomes curious.'
  }
  switch (objective) {
    case 'surprise':
      return 'User becomes curious.'
    case 'teach':
      return 'User asks another question.'
    case 'deepen':
      return 'User becomes curious.'
    case 'challenge':
      return 'User pushes back or refines their view.'
    case 'comfort':
      return 'User feels understood and continues.'
    case 'motivate':
      return 'User takes a small next step.'
    case 'brainstorm':
      return 'User picks or builds on an idea.'
    case 'summarize':
      return 'User closes or switches cleanly.'
    default:
      return 'User becomes curious.'
  }
}

/**
 * Conversation Director — produces directorState decisions before Writer brief.
 * Pure. Does not write text. Does not call models.
 *
 * Situation facts (activeTopic, engagement level, mode, pending proposal) come from
 * Conversation State when provided. Director only chooses WHAT to do next.
 *
 * @param {{
 *   messages?: ChatMessage[],
 *   decision?: ReturnType<typeof normalize>['decision'],
 *   perception?: ReturnType<typeof normalize>['perception'],
 *   conversationFocus?: ConversationFocus,
 *   conversationMomentum?: ConversationMomentum,
 *   conversationState?: import('./conversation-state.js').ConversationState|null,
 * }} [input]
 * @returns {DirectorState}
 */
export function directConversation(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : []
  const decision = input.decision || /** @type {any} */ ({})
  const perception = input.perception || /** @type {any} */ ({})
  const situation =
    input.conversationState && typeof input.conversationState === 'object'
      ? input.conversationState
      : null
  const focus =
    input.conversationFocus ||
    evaluateConversationFocus(messages, decision, perception)
  const momentum =
    input.conversationMomentum ||
    evaluateConversationMomentum(messages, decision, perception)

  const { latestUser } = splitHistoryForFocus(messages)
  const engagementInfo = estimateUserEngagement(latestUser, focus)
  // Prefer Conversation State engagement when present (mapped back to Director vocabulary).
  if (situation?.engagement) {
    const map = {
      low: 'low',
      uncertain: 'uncertain',
      medium: 'engaged',
      high: 'high',
    }
    const mapped = map[/** @type {string} */ (situation.engagement)]
    if (mapped) engagementInfo.engagement = /** @type {UserEngagement} */ (mapped)
  }
  if (situation?.diagnostics?.continuationType) {
    engagementInfo.continuationType = /** @type {ContinuationType} */ (
      situation.diagnostics.continuationType
    )
  }
  const mediumOrHigher = isEngagementMediumOrHigher(engagementInfo.engagement)

  // Rule: medium/high engagement → NEVER change topic.
  let shouldChangeTopic =
    focus.status === 'changed' && engagementInfo.continuationType === 'topic_change'
  if (mediumOrHigher && engagementInfo.continuationType !== 'topic_change') {
    shouldChangeTopic = false
  }
  if (mediumOrHigher && focus.status === 'changed' && engagementInfo.continuationType !== 'topic_change') {
    shouldChangeTopic = false
  }
  // Explicit topic-change cues with low engagement only
  if (
    engagementInfo.continuationType === 'topic_change' &&
    engagementInfo.engagement === 'low'
  ) {
    shouldChangeTopic = true
  }
  if (engagementInfo.continuationType === 'topic_change' && !mediumOrHigher) {
    shouldChangeTopic = true
  }
  // Medium+ always blocks topic change even if focus said changed (unless explicit change cue + user clearly switched with substance)
  if (mediumOrHigher && engagementInfo.continuationType !== 'topic_change') {
    shouldChangeTopic = false
  }
  if (mediumOrHigher && engagementInfo.continuationType === 'topic_change' && focusTokens(latestUser).length < 2) {
    // Soft change cue without substance while engaged → keep topic
    shouldChangeTopic = false
  }
  // Conversation State phase/topic-change authority
  if (situation?.conversationPhase === 'closing') {
    shouldChangeTopic = false
  }
  if (situation?.shortReply?.intent === 'change_topic') {
    shouldChangeTopic = true
  }
  if (
    situation?.shortReply?.intent === 'accept_proposal' ||
    situation?.shortReply?.intent === 'continue' ||
    situation?.shortReply?.intent === 'uncertain'
  ) {
    shouldChangeTopic = false
  }

  const objective = chooseDirectorObjective(
    decision,
    focus,
    momentum,
    engagementInfo.continuationType,
    engagementInfo.engagement,
  )

  const shouldSurprise =
    objective === 'surprise' ||
    (focus.status === 'none' && !decision.shouldComfort) ||
    (decision.initiative === 'one_spark' && engagementInfo.engagement !== 'uncertain')

  const shouldExplain =
    objective === 'teach' ||
    objective === 'deepen' ||
    decision.shouldTeach ||
    decision.strategy === 'explain'

  const shouldAskQuestion =
    !mediumOrHigher &&
    decision.shouldAskQuestion === true &&
    engagementInfo.continuationType !== 'explicit_continue' &&
    engagementInfo.continuationType !== 'encouragement'

  const shouldLeadConversation =
    mediumOrHigher ||
    engagementInfo.continuationType === 'explicit_continue' ||
    engagementInfo.continuationType === 'encouragement' ||
    engagementInfo.continuationType === 'uncertain_signal' ||
    decision.strategy === 'continue' ||
    decision.strategy === 'explore'

  // Topic authority: Conversation State when present.
  const authoritativeTopic = situation?.activeTopic
    ? situation.activeTopic
    : shouldChangeTopic
      ? focusTokens(latestUser).slice(0, 6).join(' ') || focus.topic
      : focus.topic

  /** @type {DirectorState} */
  const state = {
    activeTopic: authoritativeTopic,
    objective,
    curiosityLevel: Number(engagementInfo.curiosityLevel.toFixed(3)),
    userEngagement: engagementInfo.engagement,
    continuationType: engagementInfo.continuationType,
    expectedNextReaction: estimateExpectedNextReaction(
      objective,
      engagementInfo.engagement,
      engagementInfo.continuationType,
    ),
    shouldLeadConversation,
    shouldAskQuestion,
    shouldExplain,
    shouldSurprise,
    shouldChangeTopic,
    signals: [
      ...engagementInfo.signals,
      `focus=${focus.status}`,
      `conversationMode=${situation?.conversationMode || momentum.kind}`,
      mediumOrHigher ? 'engagement_medium_plus_lock_topic' : 'engagement_low_flexible',
      situation ? 'topic_from_conversation_state' : 'topic_from_focus_compat',
    ],
  }

  return state
}

/**
 * Apply Conversation Director decisions onto Writer must/mustNot.
 * @param {string[]} must
 * @param {string[]} mustNot
 * @param {DirectorState} state
 */
function applyDirectorDirectives(must, mustNot, state) {
  if (!state || typeof state !== 'object') return

  must.push(`Conversation Director objective: ${state.objective}.`)
  must.push(`Expected next user reaction: ${state.expectedNextReaction}`)

  if (state.activeTopic && !state.shouldChangeTopic) {
    must.push(`Active topic stays: "${state.activeTopic}".`)
    mustNot.push('Do not change topic; user engagement is still on this thread.')
  }

  if (state.shouldLeadConversation) {
    must.push('Lead the conversation: advance the thread; do not wait with empty acknowledgements.')
    mustNot.push('Do not reply with bare acknowledgements like "Va bene." / "Ok." alone.')
  }

  if (state.shouldSurprise) {
    must.push('Increase curiosity: open with an unexpected fact or angle, not a menu of topics.')
    mustNot.push('Do not open with "Let\'s talk about…" / "Parliamo di…" as empty framing.')
  }

  if (state.shouldExplain) {
    must.push('Explain by deepening the active topic; connect to the previous assistant sentence.')
  }

  if (!state.shouldAskQuestion) {
    mustNot.push('Do not ask a question this turn; keep developing the thread.')
  }

  if (!state.shouldChangeTopic) {
    mustNot.push('Do not generate a disconnected continuation unrelated to the previous turn.')
  }

  if (state.userEngagement === 'uncertain') {
    must.push('User signal is uncertain (e.g. "mh"): reassure by deepening the same topic with one clear, curious beat.')
  }

  if (state.userEngagement === 'maximum' || state.continuationType === 'explicit_continue') {
    must.push('User asked to continue: go deeper immediately; no restart.')
  }

  if (
    state.continuationType === 'encouragement' ||
    state.continuationType === 'explicit_continue' ||
    state.continuationType === 'uncertain_signal'
  ) {
    must.push(
      'Short user reply accepts the previous proposal: execute it now (introduce the fact, start the explanation, tell the story).',
    )
    mustNot.push(
      'Do not answer with dead-end acknowledgements ("Va bene.", "Ok.", "Capisco.", "Perfetto.", "D\'accordo.") when a proposal is still open.',
    )
  }
}

/**
 * Apply authoritative short-reply contract onto Writer must/mustNot.
 * Planner owns the move; Writer only renders it.
 *
 * @param {string[]} must
 * @param {string[]} mustNot
 * @param {import('./short-reply.js').ShortReplyState} shortReply
 * @param {string|null} activeTopic
 */
function applyShortReplyDirectives(must, mustNot, shortReply, activeTopic) {
  if (!shortReply || typeof shortReply !== 'object') return
  const move = shortReply.conversationalMove
  must.push(`Conversational move (immutable): ${move}.`)
  must.push(`Short-reply intent (authoritative): ${shortReply.intent}.`)

  if (move === 'execute_pending_proposal' || move === 'continue_topic') {
    must.push(
      'Execute the pending conversational action now: introduce / explain / continue the proposed subject.',
    )
    if (shortReply.pendingProposalType) {
      must.push(`Pending proposal action: ${shortReply.pendingProposalType}.`)
    }
    if (activeTopic) must.push(`Keep active topic: "${activeTopic}".`)
    if (shortReply.previousAssistant) {
      must.push(
        `Prior assistant proposal to fulfill:\n"""${String(shortReply.previousAssistant).slice(0, 400)}"""`,
      )
    }
    mustNot.push(
      'Do not reply with only "Va bene.", "Ok.", "Capisco.", "Perfetto.", or "D\'accordo."',
    )
    mustNot.push('Do not ask a question; execute the move.')
  } else if (move === 'passive_acknowledgement') {
    must.push('Passive acknowledgement: one short natural ack is enough.')
    mustNot.push('Do not start a new topic or continue explaining.')
  } else if (move === 'stop') {
    must.push('User wants to stop or close: reply briefly and warmly.')
    mustNot.push('Do not continue the previous explanation or start a new topic.')
    mustNot.push('Do not ask a question.')
  } else if (move === 'clarify_uncertain') {
    must.push(
      'User signal is uncertain (e.g. "mh"): stay on the same topic with one clear, curious beat — do not execute an unrelated action.',
    )
    if (activeTopic) must.push(`Stay on active topic: "${activeTopic}".`)
    mustNot.push('Do not jump to a disconnected fact.')
  } else if (move === 'change_topic') {
    must.push('User asked to change topic: acknowledge and open a fresh direction.')
  } else if (move === 'decline_proposal') {
    must.push('User declined the pending proposal: acknowledge briefly and do not execute it.')
    mustNot.push('Do not execute the declined proposal or start explaining it.')
    mustNot.push('Do not ask a question about the declined offer.')
  }
}

/**
 * Evaluate living-topic / continuation signals from current chat history.
 * Pure. No durable memory. No LLM.
 *
 * Phase 3: STATE-LIKE outputs (topic continuity, continuation cues) are consumed by
 * Conversation State as diagnostics only. Conversation State alone publishes activeTopic.
 * This helper must not be treated as a competing topic authority.
 *
 * Remaining PLANNING use in Planner: avoidClarification / status for coda suppression.
 *
 * @param {ChatMessage[]} [messages]
 * @param {ReturnType<typeof normalize>['decision']} [decision]
 * @param {ReturnType<typeof normalize>['perception']} [perception]
 * @returns {ConversationFocus}
 */
export function evaluateConversationFocus(messages = [], decision = /** @type {any} */ ({}), perception = /** @type {any} */ ({})) {
  const { latestUser, priorUser, priorBlob } = splitHistoryForFocus(messages)
  const priorTokens = focusTokens(priorBlob)
  const latestTokens = focusTokens(latestUser)
  const living = livingTopicFromHistory(messages)
  const topic = living.topic || labelTopic(priorBlob || priorUser, priorTokens)
  /** @type {string[]} */
  const signals = []

  if (!priorTokens.length && !asString(priorBlob).trim()) {
    return {
      topic: latestTokens.length ? latestTokens.slice(0, 6).join(' ') : null,
      status: 'none',
      confidence: 0.55,
      signals: ['no_prior_history'],
      avoidClarification: false,
    }
  }

  const overlap = tokenOverlapRatio(latestTokens, priorTokens)
  const encouragement = isEncouragementContinuation(latestUser)
  const continuationHits = matchConversationCues(latestUser, CONTINUATION_CUES)
  const topicChangeHits = matchConversationCues(latestUser, TOPIC_CHANGE_CUES)
  const softContinuation = SOFT_CONTINUATION_CUE_RE.test(latestUser)
  const greetingNow = GREETING_RE.test(latestUser.replace(/\s+/g, ' ').trim())
  const priorWasGreetingOnly =
    Boolean(priorUser) &&
    GREETING_RE.test(priorUser.split('\n').pop()?.replace(/\s+/g, ' ').trim() || '')

  // Never lose the active topic on short encouragements ("ok", "mh", "vai", …).
  if (encouragement) {
    signals.push(
      'minimal_ack_continuation',
      'encouragement_continuation',
      `topic_source=${living.source}`,
      `overlap=${overlap.toFixed(2)}`,
    )
    if (continuationHits.length) {
      signals.push(`continuation_cue:${continuationHits.join(',')}`, 'preserve_momentum')
    }
    return {
      topic,
      status: 'active',
      confidence: 0.94,
      signals,
      avoidClarification: true,
    }
  }

  // CONTINUATION_CUES: keep prior topic + momentum thread; never re-clarify.
  if (continuationHits.length) {
    signals.push(
      `continuation_cue:${continuationHits.join(',')}`,
      'preserve_momentum',
      `topic_source=${living.source}`,
      `overlap=${overlap.toFixed(2)}`,
    )
    return {
      topic,
      status: 'active',
      confidence: 0.92,
      signals,
      avoidClarification: true,
    }
  }

  if (softContinuation) {
    signals.push('soft_continuation_cue', `overlap=${overlap.toFixed(2)}`)
    return {
      topic,
      status: 'active',
      confidence: 0.86,
      signals,
      avoidClarification: true,
    }
  }

  if (decision.shouldContinueTopic && overlap >= 0.12) {
    signals.push('mind_continue_topic', `overlap=${overlap.toFixed(2)}`)
    return {
      topic,
      status: 'active',
      confidence: 0.84,
      signals,
      avoidClarification: true,
    }
  }

  if (overlap >= 0.28) {
    signals.push('token_overlap_strong', `overlap=${overlap.toFixed(2)}`)
    // TOPIC_CHANGE_CUES are signals only: same-topic lexicon wins — do not force changed.
    if (topicChangeHits.length) {
      signals.push(`topic_change_cue_soft:${topicChangeHits.join(',')}`, 'same_topic_overrides_change_cue')
    }
    return {
      topic,
      status: 'active',
      confidence: Math.min(0.92, 0.7 + overlap * 0.3),
      signals,
      avoidClarification: true,
    }
  }

  // TOPIC_CHANGE_CUES: raise probability of "changed" when lexicon also diverges.
  if (topicChangeHits.length) {
    signals.push(`topic_change_cue:${topicChangeHits.join(',')}`, `overlap=${overlap.toFixed(2)}`)
    if (overlap < 0.28 && (latestTokens.length >= 1 || latestUser.trim().length >= 8)) {
      return {
        topic: latestTokens.slice(0, 6).join(' ') || topic,
        status: 'changed',
        confidence: overlap < 0.12 ? 0.88 : 0.8,
        signals,
        avoidClarification: false,
      }
    }
    // Cue alone with almost no substance → lean changed lightly, still a signal not a hard semantic replace.
    if (latestTokens.length <= 1 && overlap < 0.12) {
      return {
        topic: latestTokens.slice(0, 6).join(' ') || topic,
        status: 'changed',
        confidence: 0.76,
        signals: [...signals, 'topic_change_cue_sparse'],
        avoidClarification: false,
      }
    }
  }

  if (greetingNow && priorTokens.length >= 2 && !priorWasGreetingOnly) {
    signals.push('greeting_after_substance', `overlap=${overlap.toFixed(2)}`)
    return {
      topic,
      status: 'changed',
      confidence: 0.78,
      signals,
      avoidClarification: false,
    }
  }

  if (latestTokens.length >= 2 && overlap < 0.12) {
    signals.push('distinct_lexicon', `overlap=${overlap.toFixed(2)}`)
    return {
      topic: latestTokens.slice(0, 6).join(' ') || topic,
      status: 'changed',
      confidence: 0.8,
      signals,
      avoidClarification: false,
    }
  }

  if (
    latestTokens.length <= 1 ||
    (asString(perception.intent) === 'unclear' && overlap < 0.2) ||
    (asString(latestUser).trim().length > 0 && latestTokens.length === 0)
  ) {
    // Token-less interjections with an established prior topic → keep the thread.
    // Contentful short doubt ("Boh.") stays ambiguous so Planner may clarify.
    if (topic && priorTokens.length >= 1 && latestTokens.length === 0) {
      signals.push(
        'weak_latest_keep_active_topic',
        `topic_source=${living.source}`,
        `overlap=${overlap.toFixed(2)}`,
      )
      return {
        topic,
        status: 'active',
        confidence: 0.8,
        signals,
        avoidClarification: true,
      }
    }
    signals.push('weak_or_unclear_latest', `overlap=${overlap.toFixed(2)}`)
    return {
      topic,
      status: 'ambiguous',
      confidence: 0.62,
      signals,
      avoidClarification: false,
    }
  }

  if (decision.shouldContinueTopic) {
    signals.push('mind_continue_soft', `overlap=${overlap.toFixed(2)}`)
    return {
      topic,
      status: 'active',
      confidence: 0.7,
      signals,
      avoidClarification: true,
    }
  }

  signals.push('default_ambiguous', `overlap=${overlap.toFixed(2)}`)
  return {
    topic,
    status: 'ambiguous',
    confidence: 0.58,
    signals,
    avoidClarification: false,
  }
}

/**
 * Keyword / cue weights for momentum inference (current chat history only).
 * @type {Record<ConversationMomentumKind, RegExp[]>}
 */
const MOMENTUM_CUES = {
  social: [
    /\b(ciao|hey|hello|salve|come stai|come va|chiacchiere|chiacchier|hang out|what's up|how are you)\b/i,
    /\b(piacere|rivederti|bentornato|giornata|weekend)\b/i,
  ],
  brainstorming: [
    /\b(brainstorm|brainstorming|idee|alternativa|opzioni|what if|e se|proviamo|invent|creative|lancio idee|spunti)\b/i,
    /\b(possibilit[aà]|hypothes|ipotesi)\b/i,
  ],
  learning: [
    /\b(impar|apprend|spiega|explain|how does|come funziona|tutorial|lezione|studiare|teach|capire|learn)\b/i,
    /\b(concetto|teoria|definizione|esempio|knowledge|fotosintesi)\b/i,
  ],
  debugging: [
    /\b(bug|errore|error|exception|stack|crash|non funziona|doesn't work|fix|debug|traceback|failing)\b/i,
    /\b(riproduc|reproduce|log|null pointer|undefined|typeerror|segfault)\b/i,
  ],
  planning: [
    /\b(piano|plan|roadmap|organizz|schedule|timeline|milestone|step|passi|agenda|planning)\b/i,
    /\b(programmare|calendario|fase|checklist|priorit)\b/i,
  ],
  decision: [
    /\b(decid|scel|meglio|oppure|vs\b|versus|should i| conviene|trade-?off|opzione a|opzione b)\b/i,
    /\b(consiglio|raccomand|which one|che faccio|dilemma)\b/i,
  ],
  storytelling: [
    /\b(storia|raccont|story|narrative|una volta|c'era|once upon|aneddoto|plot|fiction)\b/i,
    /\b(personaggio|chapter|capitolo|favola|mito)\b/i,
  ],
  emotional_support: [
    /\b(triste|ansios|ansia|paura|mi sento|depress|alone|lonely|piango|male|soffr|upset|overwhelmed)\b/i,
    /\b(supporto|comfort|non ce la faccio|aiutami a stare|emotional|heartbroken)\b/i,
  ],
}

/**
 * Soft prior from Mind strategy / perception (history still wins).
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ReturnType<typeof normalize>['perception']} perception
 * @returns {Partial<Record<ConversationMomentumKind, number>>}
 */
function momentumPriorsFromDecision(decision, perception) {
  /** @type {Partial<Record<ConversationMomentumKind, number>>} */
  const scores = {}
  const bump = (/** @type {ConversationMomentumKind} */ kind, n) => {
    scores[kind] = (scores[kind] || 0) + n
  }

  if (decision.shouldComfort || decision.strategy === 'support') bump('emotional_support', 0.35)
  if (decision.shouldTeach || decision.strategy === 'explain') bump('learning', 0.3)
  if (decision.strategy === 'guide') {
    bump('debugging', 0.15)
    bump('planning', 0.15)
  }
  if (decision.strategy === 'explore') bump('brainstorming', 0.25)
  if (decision.strategy === 'connect') bump('social', 0.25)
  if (decision.strategy === 'entertain') bump('storytelling', 0.3)
  if (decision.strategy === 'answer' && perception.intent === 'question') bump('learning', 0.1)
  if (perception.emotionalState === 'distressed' || perception.emotionalState === 'sad') {
    bump('emotional_support', 0.25)
  }
  if (perception.userNeed === 'emotional_care') bump('emotional_support', 0.2)
  if (perception.userNeed === 'learning') bump('learning', 0.2)

  return scores
}

/**
 * Infer conversational mode signals from current chat history.
 * Pure. No durable memory. No LLM.
 *
 * Phase 3: authoritative field is Conversation State `conversationMode`.
 * This return value (`kind`) is a deprecated compat mirror of conversationMode
 * (historically named "Momentum"). Do NOT treat as a second mode authority.
 * Do NOT port V1 Conversation Momentum.
 *
 * @param {ChatMessage[]} [messages]
 * @param {ReturnType<typeof normalize>['decision']} [decision]
 * @param {ReturnType<typeof normalize>['perception']} [perception]
 * @returns {ConversationMomentum}
 */
export function evaluateConversationMomentum(
  messages = [],
  decision = /** @type {any} */ ({}),
  perception = /** @type {any} */ ({}),
) {
  const list = Array.isArray(messages) ? messages : []
  // Prefer recent turns; still history-only (no permanent memory).
  const recent = list.slice(-8)
  const blob = recent
    .map((m) => asString(m?.content))
    .filter(Boolean)
    .join('\n')

  /** @type {Partial<Record<ConversationMomentumKind, number>>} */
  const scores = {}
  /** @type {string[]} */
  const signals = []

  for (const kind of MOMENTUM_KINDS) {
    scores[kind] = 0
    const cues = MOMENTUM_CUES[kind] || []
    for (const re of cues) {
      if (re.test(blob)) {
        scores[kind] = (scores[kind] || 0) + 1
        signals.push(`cue:${kind}`)
      }
    }
  }

  const priors = momentumPriorsFromDecision(decision, perception)
  for (const kind of MOMENTUM_KINDS) {
    if (priors[kind]) {
      scores[kind] = (scores[kind] || 0) + /** @type {number} */ (priors[kind])
      signals.push(`prior:${kind}`)
    }
  }

  // Empty / thin history → mild social default unless comfort/teach priors dominate
  if (!blob.trim()) {
    signals.push('no_history_default')
    const kind =
      (priors.emotional_support || 0) >= 0.3
        ? 'emotional_support'
        : (priors.learning || 0) >= 0.3
          ? 'learning'
          : 'social'
    return {
      kind,
      confidence: 0.45,
      signals,
      scores,
    }
  }

  let best = /** @type {ConversationMomentumKind} */ ('social')
  let bestScore = -1
  // Prefer more task-shaped modes on ties (learning/debugging over brainstorming/social).
  const tieBreak = /** @type {ConversationMomentumKind[]} */ ([
    'debugging',
    'learning',
    'planning',
    'decision',
    'emotional_support',
    'storytelling',
    'brainstorming',
    'social',
  ])
  for (const kind of tieBreak) {
    const s = scores[kind] || 0
    if (s > bestScore) {
      bestScore = s
      best = kind
    }
  }

  if (bestScore <= 0) {
    signals.push('flat_scores_default_social')
    return { kind: 'social', confidence: 0.4, signals, scores }
  }

  const confidence = Number(Math.max(0.45, Math.min(0.95, 0.5 + bestScore * 0.12)).toFixed(3))
  // unique signals
  const uniq = []
  for (const s of signals) {
    if (!uniq.includes(s)) uniq.push(s)
  }

  return {
    kind: best,
    confidence,
    signals: uniq.slice(0, 12),
    scores,
  }
}

// ── Conversation Experience (internal Planner module) ───────────────────────

/** @type {Record<ConversationExperienceKind, RegExp[]>} */
const EXPERIENCE_CUES = {
  conversation: [
    /^(ciao|hey|hi|hello|salve|buongiorno|buonasera)[!.,\s]*$/i,
    /\b(come stai|come va|chiacchiere|che fai|what's up|how are you)\b/i,
  ],
  exploration: [
    /\b(di cosa (possiamo |si può )?parlare|di che (possiamo )?parlare|parliamo|esplora|esploriamo|cosa (possiamo|potremmo) (fare|dire|toccare))\b/i,
    /\b(what (can|should) we (talk|chat) about|let'?s talk|open (the )?floor)\b/i,
  ],
  debugging: [
    /\b(bug|errore|error|crash|exception|stack\s*trace|typeerror|non funziona|debug|debugging|fix)\b/i,
    /\b(ho un bug|c'?è un bug|broken|failing test)\b/i,
  ],
  brainstorming: [
    /\b(idea|idee|brainstorm|brainstorming|proposte|migliorare|vorrei un['']?idea|nuove (idee|direzioni)|inventiamo)\b/i,
    /\b(vorrei migliorare|come (potremmo|possiamo) migliorare)\b/i,
  ],
  decision: [
    /\b(non so (quale|cosa) (scegliere|decidere)|non so decidere|cosa scelgo|quale (scelgo|conviene)|indeciso|oppure)\b/i,
    /\b(help me (choose|decide)|should i|trade-?off)\b/i,
  ],
  learning: [
    /\b(spiegami|spiega|insegnami|come funziona|cosa (è|significa)|perché|perche|teach|explain)\b/i,
    /\b(non (ho )?capito|fammi capire|tutorial)\b/i,
    /\b(what (is|are|does)|what's)\b/i,
  ],
  planning: [
    /\b(piano|pianificare|pianifichiamo|roadmap|prioritizz|prossimo passo|prossimi passi|agenda|milestone)\b/i,
    /\b(cosa facciamo (oggi|adesso|ora)|organizziamo|plan (for|the|my|our)|create a (work )?plan|work plan)\b/i,
    /\b(what should i do|help me (organize|prioritise|prioritize|plan)|where to start|next step|organize my|prioritize|study today|sequence the work)\b/i,
    /\b(aiutami a (prioritizzare|organizzare|pianificare)|organiz(z)?iamo|dammi un piano|cosa (faccio|fare) (adesso|ora)|sequenz)\b/i,
    /\b(i have (one hour|an hour)|how should i study|help me prioritize|organize my day)\b/i,
    /\b(what should i do now|first (concrete )?action|study plan|organize (these )?tasks|build a (study |work )?plan)\b/i,
  ],
  creative: [
    /\b(inventa|crea|creativo|creativa|storia|poesia|metafora|scrivi (una|un)|imagin[ae]|draft a)\b/i,
  ],
  support: [
    /\b(sono triste|sono stanco|ho paura|mi sento (perso|male|giù)|non ce la faccio|aiuto|comfort|mi sento)\b/i,
    /\b(i('m| am) (sad|tired|scared|lost|overwhelmed))\b/i,
  ],
  celebration: [
    /\b(ce l['']ho fatta|evviva|successo|fatto[!]|yay|we did it|complimenti|ho finito)\b/i,
  ],
  resume: [
    /\b(riprendiamo|riprendere|continuiamo|dove eravamo|da dove (avevamo|eravamo) lasciato|pick up where|back to (it|this))\b/i,
  ],
}

/**
 * Soft priors from Mind / Perception (never override a strong cue).
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ReturnType<typeof normalize>['perception']} perception
 * @returns {Partial<Record<ConversationExperienceKind, number>>}
 */
function experiencePriorsFromDecision(decision, perception) {
  /** @type {Partial<Record<ConversationExperienceKind, number>>} */
  const priors = {}
  if (decision.shouldComfort || decision.strategy === 'support') priors.support = 0.45
  if (decision.shouldTeach || decision.strategy === 'explain') priors.learning = 0.4
  if (decision.strategy === 'explore') priors.exploration = 0.35
  if (decision.strategy === 'celebrate') priors.celebration = 0.5
  if (decision.strategy === 'guide') priors.debugging = 0.25
  if (decision.strategy === 'connect') priors.conversation = 0.3
  if (decision.strategy === 'continue') priors.resume = 0.2
  if (decision.shouldContinueTopic) priors.resume = (priors.resume || 0) + 0.15
  const intent = asString(perception.intent).toLowerCase()
  const social = asString(perception.socialIntent).toLowerCase()
  if (intent === 'greeting' || social === 'greeting') priors.conversation = (priors.conversation || 0) + 0.4
  if (intent === 'question' && decision.shouldTeach) priors.learning = (priors.learning || 0) + 0.2
  return priors
}

/**
 * Build experienceGuidance directives for a chosen experience.
 * @param {ConversationExperienceKind} experience
 * @param {{ useExplorationPrinciples?: boolean, useLearningPrinciples?: boolean, usePlanningPrinciples?: boolean }} [options]
 * @returns {ExperienceGuidance}
 */
export function buildExperienceGuidance(experience, options = {}) {
  /** @type {Record<ConversationExperienceKind, string[]>} */
  const map = {
    conversation: [
      'resta presente e naturale',
      'risposta corta',
      'niente procedura',
      'apri uno spazio senza interrogare',
    ],
    exploration: [
      'proponi varie direzioni',
      'includi una proposta inattesa',
      'evita elenco generico',
      'crea curiosità',
    ],
    brainstorming: [
      'genera molte idee',
      'poche spiegazioni',
      'privilegia varietà',
      'non chiudere troppo presto su una sola strada',
    ],
    learning: [
      'parti dal concetto',
      'spiega',
      'esempio',
      'applicazione',
    ],
    debugging: [
      'identifica il problema',
      'ipotesi',
      'prossimo test',
      'fallback',
    ],
    planning: [
      'chiarisci l\'obiettivo',
      'ordina i passi',
      'segna una priorità',
      'tieni il piano actionable',
    ],
    decision: [
      'inquadra le opzioni',
      'evidenzia il tradeoff',
      'dai una raccomandazione leggera',
      'non scaricare tutta la scelta sull\'utente',
    ],
    creative: [
      'offri materiale concreto',
      'tono evocativo ma chiaro',
      'una direzione creativa, non un menu',
      'evita meta-discorso sulla creatività',
    ],
    support: [
      'valida il sentire',
      'presenza stabile',
      'niente lezione',
      'un passo piccolo solo se serve',
    ],
    celebration: [
      'condividi l\'energia',
      'specifica cosa è andato bene',
      'niente lode generica',
      'non riaprire problemi',
    ],
    resume: [
      'riprendi il filo senza riassumere tutto',
      'ancora al contesto vivo',
      'avanza di un passo',
      'evita chiarimenti inutili sul topic',
    ],
  }
  const kind = CONVERSATION_EXPERIENCES.includes(experience) ? experience : 'conversation'
  const useExplorationPrinciples = options?.useExplorationPrinciples === true
  const useLearningPrinciples = options?.useLearningPrinciples === true
  const usePlanningPrinciples = options?.usePlanningPrinciples === true

  // Experiment 001: exploration principles only — never touch other experiences.
  if (kind === 'exploration' && useExplorationPrinciples) {
    return {
      experience: kind,
      directives: EXPLORATION_PRINCIPLES_DIRECTIVES.slice(),
    }
  }

  // Experiment 002: learning principles only — Concept → Why → Example.
  if (kind === 'learning' && useLearningPrinciples) {
    return {
      experience: kind,
      directives: LEARNING_PRINCIPLES_DIRECTIVES.slice(),
    }
  }

  // Experiment 003: planning principles only — lead with actionable plan.
  if (kind === 'planning' && usePlanningPrinciples) {
    return {
      experience: kind,
      directives: PLANNING_PRINCIPLES_DIRECTIVES.slice(),
    }
  }

  return {
    experience: kind,
    directives: (map[kind] || map.conversation).slice(),
  }
}

/**
 * Choose a conversational experience for this turn.
 * Pure. History-only. No LLM.
 *
 * @param {ChatMessage[]} [messages]
 * @param {ReturnType<typeof normalize>['decision']} [decision]
 * @param {ReturnType<typeof normalize>['perception']} [perception]
 * @returns {ConversationExperience}
 */
export function evaluateConversationExperience(
  messages = [],
  decision = /** @type {any} */ ({}),
  perception = /** @type {any} */ ({}),
) {
  const latest = latestUserText(Array.isArray(messages) ? messages : [])
  const normalized = latest.replace(/\s+/g, ' ').trim()
  /** @type {Partial<Record<ConversationExperienceKind, number>>} */
  const scores = {}
  /** @type {string[]} */
  const reasons = []

  // Minimal ack turns stay conversational — do not inherit resume/planning from Mind priors alone.
  if (normalized && MINIMAL_CONTINUATION_RE.test(normalized)) {
    return {
      experience: 'conversation',
      confidence: 0.72,
      reason: 'minimal_ack_conversation',
    }
  }

  for (const kind of CONVERSATION_EXPERIENCES) {
    scores[kind] = 0
    for (const re of EXPERIENCE_CUES[kind] || []) {
      if (normalized && re.test(normalized)) {
        scores[kind] = (scores[kind] || 0) + 1.2
        reasons.push(`cue:${kind}`)
      }
    }
  }

  const priors = experiencePriorsFromDecision(decision, perception)
  for (const kind of CONVERSATION_EXPERIENCES) {
    if (priors[kind]) {
      scores[kind] = (scores[kind] || 0) + /** @type {number} */ (priors[kind])
      reasons.push(`prior:${kind}`)
    }
  }

  // Specific experiences win ties over generic conversation.
  const tieBreak = /** @type {ConversationExperienceKind[]} */ ([
    'debugging',
    'decision',
    'learning',
    'brainstorming',
    'planning',
    'creative',
    'support',
    'celebration',
    'resume',
    'exploration',
    'conversation',
  ])

  let best = /** @type {ConversationExperienceKind} */ ('conversation')
  let bestScore = -1
  for (const kind of tieBreak) {
    const s = scores[kind] || 0
    if (s > bestScore) {
      bestScore = s
      best = kind
    }
  }

  if (!normalized) {
    return {
      experience: bestScore > 0 ? best : 'conversation',
      confidence: 0.4,
      reason: 'empty_user_default',
    }
  }

  if (bestScore <= 0) {
    return {
      experience: 'conversation',
      confidence: 0.42,
      reason: 'no_cues_default_conversation',
    }
  }

  const uniq = []
  for (const r of reasons) {
    if (!uniq.includes(r)) uniq.push(r)
  }
  const confidence = Number(Math.max(0.5, Math.min(0.96, 0.52 + bestScore * 0.14)).toFixed(3))
  return {
    experience: best,
    confidence,
    reason: uniq.slice(0, 6).join(',') || `selected:${best}`,
  }
}

/**
 * Development beats shaped by Conversation Experience guidance.
 * @param {ConversationExperienceKind} experience
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {number} maxBeats
 * @returns {PlanPhase[]}
 */
function buildDevelopmentByExperience(experience, decision, maxBeats) {
  /** @type {PlanPhase[]} */
  const beats = []
  const depth = decision.responseDepth
  const push = (beatKind, purpose) => {
    if (beats.length >= maxBeats) return
    beats.push(phase('development', beatKind, purpose))
  }

  switch (experience) {
    case 'exploration':
      push('propose_directions', 'Proponi varie direzioni utili, non un elenco generico.')
      push('unexpected_proposal', 'Includi una proposta inattesa che crei curiosità.')
      if (depth === 'deep') {
        push('curiosity_hook', 'Chiudi lo sviluppo con un gancio di curiosità, non con un quiz.')
      }
      break
    case 'brainstorming':
      push('many_ideas', 'Genera più idee con poche spiegazioni; privilegia varietà.')
      if (depth !== 'minimal') {
        push('variety_over_depth', 'Aggiungi angoli diversi invece di approfondire una sola idea.')
      }
      break
    case 'learning':
      push('concept_first', 'Parti dal concetto in linguaggio semplice.')
      push('explain_layer', 'Spiega il perché o il come al livello successivo.')
      if (depth === 'balanced' || depth === 'deep') {
        push('example_then_apply', 'Dai un esempio e una mini applicazione pratica.')
      }
      break
    case 'debugging':
      push('identify_problem', 'Identifica il problema o il punto di fallimento.')
      push('hypothesis', 'Offri una ipotesi plausibile.')
      push('next_test', 'Proponi il prossimo test o passo di verifica.')
      if (depth === 'balanced' || depth === 'deep') {
        push('fallback', 'Aggiungi un fallback se il primo test non conferma.')
      }
      break
    case 'planning':
      push('frame_goal', 'Chiarisci l\'obiettivo in una riga.')
      push('ordered_steps', 'Ordina i prossimi passi in sequenza actionable.')
      if (depth !== 'minimal') {
        push('priority_marker', 'Segna una priorità o un checkpoint.')
      }
      break
    case 'decision':
      push('options_frame', 'Inquadra le opzioni reali in gioco.')
      push('tradeoff', 'Evidenzia il tradeoff centrale.')
      if (depth !== 'minimal') {
        push('lean_recommendation', 'Dai una raccomandazione leggera senza scaricare tutta la scelta.')
      }
      break
    case 'creative':
      push('creative_material', 'Offri materiale creativo concreto (immagine, bozza, metafora).')
      if (depth !== 'minimal') {
        push('one_creative_direction', 'Sviluppa una direzione creativa, non un menu di stili.')
      }
      break
    case 'support':
      push('validate_feeling', 'Valida il sentire senza minimizzare.')
      if (depth !== 'minimal') {
        push('steady_presence', 'Offri presenza stabile; niente lezione.')
      }
      break
    case 'celebration':
      push('share_energy', 'Condividi l\'energia del momento con specificità.')
      push('name_the_win', 'Nomina cosa è andato bene; evita lode generica.')
      break
    case 'resume':
      push('pick_up_thread', 'Riprendi il filo senza riassumere tutta la storia.')
      push('advance_one_step', 'Avanza di un passo concreto sul contesto vivo.')
      break
    case 'conversation':
    default:
      push('natural_presence', 'Resta presente e naturale; risposta corta, niente procedura.')
      if (depth !== 'minimal') {
        push('open_space', 'Apri uno spazio conversazionale senza interrogare.')
      }
      break
  }

  return beats.slice(0, maxBeats)
}

/**
 * @param {string[]} must
 * @param {ConversationExperience} experience
 * @param {ExperienceGuidance} guidance
 */
function applyExperienceDirectives(must, experience, guidance) {
  if (!experience || !guidance) return
  must.push(
    `Shape this turn as conversationExperience="${experience.experience}" (confidence=${Number(experience.confidence).toFixed(2)}).`,
  )
  for (const directive of guidance.directives || []) {
    const d = asString(directive).trim()
    if (d) must.push(`Experience guidance: ${d}.`)
  }
}

/**
 * When focus is active, suppress useless clarification questions in packaging.
 * Does not invent a new Mind strategy — only avoids re-identifying an active topic.
 *
 * @param {WriterCoda} coda
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ConversationFocus} focus
 * @returns {{ coda: WriterCoda, suppressedClarification: boolean }}
 */
function resolveCodaWithFocus(coda, decision, focus) {
  if (!focus?.avoidClarification || focus.status !== 'active') {
    return { coda, suppressedClarification: false }
  }
  if (coda !== 'question') {
    return { coda, suppressedClarification: false }
  }
  // Keep a question only for guide/explore when Mind explicitly needs one and topic is not a minimal continuation.
  // For continue/connect/support-style continuity, drop clarification coda.
  const continuityStrategy =
    decision.strategy === 'continue' ||
    decision.strategy === 'connect' ||
    decision.shouldContinueTopic === true
  if (!continuityStrategy && decision.strategy !== 'support') {
    return { coda, suppressedClarification: false }
  }

  let next = /** @type {WriterCoda} */ ('none')
  if (decision.initiative === 'one_insight') next = 'insight'
  else if (decision.initiative === 'one_spark') next = 'spark'
  else if (decision.initiative === 'one_direction') next = 'direction'

  return { coda: next, suppressedClarification: true }
}

/**
 * @param {string[]} must
 * @param {string[]} mustNot
 * @param {ConversationFocus} focus
 * @param {boolean} suppressedClarification
 */
function applyFocusDirectives(must, mustNot, focus, suppressedClarification) {
  if (focus.status === 'active') {
    if (focus.topic) {
      must.push(`Stay on the living conversation focus: "${focus.topic}".`)
    } else {
      must.push('Stay on the living conversation focus; do not reset the thread.')
    }
    must.push('Connect this turn to the previous assistant sentence; develop the same thread.')
    mustNot.push(
      'Do not ask clarifying questions that re-identify the topic; it is still active.',
    )
    mustNot.push('Do not interview the user about what we were already discussing.')
    mustNot.push(
      'Do not generate an isolated fact disconnected from the previous turn.',
    )
    mustNot.push('Do not jump to a new subject without an explicit user topic change.')
    if (
      focus.signals.some((s) =>
        /encouragement_continuation|minimal_ack_continuation|continuation_cue:/.test(s),
      )
    ) {
      must.push(
        'User gave a short encouragement (ok / mh / continua / vai / interessante / …): continue and deepen the current topic.',
      )
    }
    if (suppressedClarification) {
      must.push('Topic is active — skip useless clarification; continue usefully without a clarifying question.')
      mustNot.push('Do not ask a clarifying question in this turn.')
    }
  } else if (focus.status === 'changed') {
    must.push('Topic has changed; follow the new focus without forcing the previous one.')
    mustNot.push('Do not drag back a closed or abandoned prior topic.')
  } else if (focus.status === 'ambiguous') {
    must.push(
      'Conversation focus is ambiguous; one short clarification is allowed only if it unblocks the thread.',
    )
    mustNot.push(
      'Do not generate an isolated fact disconnected from the previous turn.',
    )
  }
}

/**
 * @param {string[]} must
 * @param {ConversationMomentum} momentum
 */
function applyMomentumDirectives(must, momentum) {
  if (!momentum || !MOMENTUM_KIND_SET.has(momentum.kind)) return
  must.push(
    `Shape development for conversationMomentum="${momentum.kind}" (confidence=${Number(momentum.confidence).toFixed(2)}).`,
  )
  switch (momentum.kind) {
    case 'social':
      must.push('Keep development light and relational; prefer presence over procedure.')
      break
    case 'brainstorming':
      must.push('Develop by expanding options/angles; avoid premature single-path lock-in.')
      break
    case 'learning':
      must.push('Develop as progressive teaching: idea → why → example.')
      break
    case 'debugging':
      must.push('Develop as diagnose → next fix step → optional fallback.')
      break
    case 'planning':
      must.push('Develop as goal → ordered steps → checkpoint.')
      break
    case 'decision':
      must.push('Develop as options → tradeoff → one lean recommendation.')
      break
    case 'storytelling':
      must.push('Develop with narrative beats; no moral poster close.')
      break
    case 'emotional_support':
      must.push('Develop with validation and steady presence before advice.')
      break
    default:
      break
  }
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
 * Development beats shaped by conversational momentum.
 * @param {ConversationMomentumKind} kind
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ReturnType<typeof normalize>['perception']} perception
 * @param {number} maxBeats
 * @returns {PlanPhase[]}
 */
function buildDevelopmentByMomentum(kind, decision, perception, maxBeats) {
  /** @type {PlanPhase[]} */
  const beats = []
  const depth = decision.responseDepth
  const push = (beatKind, purpose) => {
    if (beats.length >= maxBeats) return
    beats.push(phase('development', beatKind, purpose))
  }

  switch (kind) {
    case 'social':
      push(
        'presence_contribution',
        'Contribute warm presence and one light conversational offer; no interview loop.',
      )
      if (depth !== 'minimal') {
        push(
          'rapport_beat',
          'Add a short human rapport beat that stays pertinent to the living topic.',
        )
      }
      break
    case 'brainstorming':
      push('ideate', 'Offer one fresh angle or option that expands the idea space.')
      if (depth !== 'minimal') {
        push(
          'diverge_or_combine',
          'Add a second complementary idea or a useful combination; avoid a long menu.',
        )
      }
      if (depth === 'deep') {
        push('select_seed', 'Optionally mark which seed looks most promising without forcing a choice quiz.')
      }
      break
    case 'learning':
      push('core_idea', 'State the core idea in plain language first.')
      push('why_it_matters', 'Explain why it matters or how it works at the next layer.')
      if (depth === 'balanced' || depth === 'deep') {
        push(
          'example',
          `Give one concrete example calibrated to knowledgeLevel="${perception.knowledgeLevel || 'unknown'}".`,
        )
      }
      if (depth === 'deep') {
        push('common_pitfall', 'Mention one common pitfall or nuance; do not dump an encyclopedia.')
      }
      break
    case 'debugging':
      push('diagnose_light', 'Identify the likely blocker or failure point in one tight beat.')
      push('next_step', 'Give one clear diagnostic or fix step the user can take.')
      if (depth === 'balanced' || depth === 'deep') {
        push('fallback', 'Provide one fallback if the first step fails.')
      }
      break
    case 'planning':
      push('frame_goal', 'Restate the planning goal in one clear line.')
      push('sequenced_steps', 'Lay out a short ordered sequence of next steps.')
      if (depth === 'balanced' || depth === 'deep') {
        push('checkpoint', 'Add one checkpoint or priority so the plan stays actionable.')
      }
      break
    case 'decision':
      push('options_frame', 'Frame the decision with the real options in play (compact).')
      push('tradeoff', 'Surface the key tradeoff without burying the user in noise.')
      if (depth !== 'minimal') {
        push('recommend_one', 'Recommend one lean preference and why; do not outsource the whole choice.')
      }
      break
    case 'storytelling':
      push('narrative_hook', 'Open or continue with a story-shaped beat (scene, thread, or anecdote).')
      if (depth !== 'minimal') {
        push('narrative_advance', 'Advance the narrative one step with concrete texture, not a moral.')
      }
      break
    case 'emotional_support':
      push('validate', 'Validate the feeling without minimizing or diagnosing.')
      if (depth !== 'minimal') {
        push(
          'steady_presence',
          'Offer steady presence or one gentle grounding observation; no lecture.',
        )
      }
      break
    default:
      push('direct_substance', 'Deliver the main substance of the reply.')
      break
  }

  return beats.slice(0, maxBeats)
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ReturnType<typeof normalize>['perception']} perception
 * @param {ConversationMomentum} [momentum]
 * @param {ConversationExperience|null} [experience]
 * @returns {PlanPhase[]}
 */
function buildDevelopment(decision, perception, momentum = null, experience = null) {
  const depth = decision.responseDepth
  const maxBeats = depth === 'minimal' ? 1 : depth === 'light' ? 2 : depth === 'deep' ? 4 : 3

  // Hard structural strategies keep their own development shape.
  const forceStrategy =
    decision.strategy === 'close' ||
    decision.strategy === 'recover' ||
    decision.strategy === 'celebrate'

  // Conversation Experience prefers shaping development when confident enough.
  if (
    !forceStrategy &&
    experience &&
    CONVERSATION_EXPERIENCES.includes(experience.experience) &&
    experience.confidence >= EXPERIENCE_MIN_CONFIDENCE
  ) {
    const expBeats = buildDevelopmentByExperience(experience.experience, decision, maxBeats)
    if (expBeats.length) return expBeats
  }

  if (
    !forceStrategy &&
    momentum &&
    MOMENTUM_KIND_SET.has(momentum.kind) &&
    momentum.confidence >= 0.5
  ) {
    const momBeats = buildDevelopmentByMomentum(momentum.kind, decision, perception, maxBeats)
    if (momBeats.length) return momBeats
  }

  /** @type {PlanPhase[]} */
  const beats = []
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
    push(
      'simple_language',
      'Keep terminology accessible for a beginner without being condescending.',
    )
  }

  if (perception.knowledgeLevel === 'beginner' && decision.shouldTeach && beats.length < maxBeats) {
    if (!beats.some((b) => b.kind === 'simple_language')) {
      push(
        'simple_language',
        'Keep language simple and progressive for a beginner.',
      )
    }
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
  if (perception.intent === 'boredom' || decision.strategy === 'explore') {
    must.push(
      'User needs initiative: briefly acknowledge, then introduce ONE concrete interesting subject and give enough detail to spark curiosity.',
    )
    must.push('Carry conversational momentum yourself; do not make the user choose what happens next.')
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
  if (decision.strategy === 'explore') {
    mustNot.push(
      'Do not offer a generic topic menu ("scienza, storia o tecnologia — di cosa vuoi parlare?").',
    )
    mustNot.push('Do not answer boredom with only "Capisco." / "Va bene." / "Come posso aiutarti?".')
  }

  return mustNot
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {ConversationFocus} [focus]
 * @param {boolean} [suppressedClarification]
 * @returns {string[]}
 */
function buildConstraints(
  decision,
  focus = null,
  suppressedClarification = false,
  momentum = null,
  resumeUsage = null,
  experience = null,
) {
  /** @type {string[]} */
  const c = [`strategy:${decision.strategy}`, `need:${decision.need}`]

  const askQuestion = suppressedClarification ? false : decision.shouldAskQuestion
  c.push(askQuestion ? 'ask_question:yes' : 'ask_question:no')
  c.push(decision.shouldTeach ? 'teach:yes' : 'teach:no')
  c.push(decision.shouldComfort ? 'comfort:yes' : 'comfort:no')
  c.push(decision.shouldChallenge ? 'challenge:yes' : 'challenge:no')
  c.push(decision.shouldContinueTopic ? 'continue_topic:yes' : 'continue_topic:no')
  c.push(decision.shouldUseMemory ? 'use_memory:yes' : 'use_memory:no')
  c.push(`initiative:${decision.initiative}`)
  c.push(`depth:${decision.responseDepth}`)
  c.push(`tone:${decision.emotionalTone}`)

  if (focus && focus.status) {
    c.push(`conversation_focus:${focus.status}`)
    if (focus.avoidClarification) c.push('focus:avoid_clarification')
  }
  if (momentum && momentum.kind) {
    c.push(`conversation_momentum:${momentum.kind}`)
  }
  if (experience && experience.experience) {
    c.push(`conversation_experience:${experience.experience}`)
  }
  if (resumeUsage && resumeUsage.used) {
    c.push('conversation_resume:yes')
  } else {
    c.push('conversation_resume:no')
  }

  if (decision.shouldComfort) c.push('hard:no_challenge_with_comfort')
  if (!askQuestion) c.push('hard:no_question')
  if (decision.strategy === 'close') c.push('hard:no_reopen')
  if (suppressedClarification) c.push('hard:no_useless_clarification')

  return c
}

/** Soft continue / resume cues — not a real topic change. */
const RESUME_CONTINUE_CUE =
  /\b(riprendiamo|riprendere|ripresa|continuiamo|continuità|da dove (?:avevamo|eravamo) lasciato|where we left|pick up where|back to (?:it|this)|torniamo (?:su|a))\b/i

/**
 * @param {ChatMessage[]} messages
 * @returns {string}
 */
function latestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (asString(messages[i]?.role).toLowerCase() === 'user') {
      return asString(messages[i]?.content).trim()
    }
  }
  return ''
}

/**
 * @param {string} text
 * @param {number} [maxSentences]
 * @returns {string}
 */
function limitToTwoSentences(text, maxSentences = 2) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [t]
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxSentences))
    .join(' ')
    .trim()
}

/**
 * Decide whether Planner may expose a resume cue to Writer.
 * Never forced. Never dumps durable memory. Max 2 sentences.
 *
 * Continuity facts (shouldResume / resumeTopic / resumePoint) live on Conversation State.
 * This helper only decides whether to expose an optional Writer cue sentence from the
 * compat Resume engine — it is not a competing topic authority.
 *
 * @param {object} [input]
 * @param {object|null} [input.conversationResume]
 * @param {ConversationFocus|null} [input.conversationFocus]
 * @param {ChatMessage[]} [input.messages]
 * @param {import('./conversation-state.js').ConversationState|null} [input.conversationState]
 * @returns {ConversationResumeUsage}
 */
export function decideConversationResumeUsage(input = {}) {
  const resume =
    input.conversationResume && typeof input.conversationResume === 'object'
      ? input.conversationResume
      : null
  const focus =
    input.conversationFocus && typeof input.conversationFocus === 'object'
      ? input.conversationFocus
      : null
  const situation =
    input.conversationState && typeof input.conversationState === 'object'
      ? input.conversationState
      : null
  const messages = Array.isArray(input.messages) ? input.messages : []

  const confidenceRaw = resume && typeof resume.confidence === 'number' ? resume.confidence : 0
  const confidence = Math.max(0, Math.min(1, confidenceRaw))
  const rawSentence = resume ? asString(resume.suggestedResumeSentence).trim() : ''
  const latest = latestUserText(messages)

  /** @type {(reason: string) => ConversationResumeUsage} */
  const deny = (reason) => ({
    used: false,
    confidence,
    reason,
    resumeSentence: null,
  })

  if (!resume || !rawSentence) return deny('missing_resume')
  if (/Non c['’]è ancora una conversazione/i.test(rawSentence)) return deny('empty_conversation')
  if (confidence < RESUME_MIN_CONFIDENCE) return deny('low_confidence')

  const userTurns = messages.filter((m) => asString(m.role).toLowerCase() === 'user').length
  if (userTurns > RESUME_MAX_EARLY_USER_TURNS) return deny('not_early_turn')

  const assistantTurns = messages.filter((m) => asString(m.role).toLowerCase() === 'assistant').length
  if (assistantTurns < 1 || messages.length < 2) return deny('insufficient_history')

  // Real topic switch → ignore resume. Soft "riprendiamo / continuiamo" cues are not switches.
  if (focus && focus.status === 'changed' && !RESUME_CONTINUE_CUE.test(latest)) {
    return deny('topic_changed')
  }
  if (situation?.conversationPhase === 'closing') return deny('closing_phase')

  const resumeSentence = limitToTwoSentences(rawSentence, 2)
  if (!resumeSentence) return deny('empty_sentence')

  return {
    used: true,
    confidence,
    reason: situation?.continuity?.shouldResume ? 'eligible_from_state' : 'eligible',
    resumeSentence,
  }
}

/**
 * Writer receives only resumeSentence (opaque string), never the full Resume object.
 * Soft / optional — never forced; never dump memory lists.
 *
 * @param {string[]} must
 * @param {string[]} mustNot
 * @param {ConversationResumeUsage} usage
 */
function applyResumeDirectives(must, mustNot, usage) {
  if (!usage?.used || !usage.resumeSentence) return
  must.push(
    `Optional soft continuity cue (resumeSentence; at most 2 sentences; never forced; do not list user memory): ${usage.resumeSentence}`,
  )
  mustNot.push('Do not dump or list the user\'s full memory or past facts.')
  mustNot.push('Do not force a resume opener if the current turn does not need it.')
}

/**
 * @param {ReturnType<typeof normalize>['decision']} decision
 * @param {WriterCoda} coda
 * @param {ConversationMomentum} [momentum]
 * @returns {string}
 */
function buildMoveSummary(decision, coda, momentum = null, experience = null) {
  return [
    `strategy=${decision.strategy}`,
    `need=${decision.need}`,
    `coda=${coda}`,
    experience?.experience ? `experience=${experience.experience}` : null,
    momentum?.kind ? `momentum=${momentum.kind}` : null,
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
 * Build a concrete plan from Perception + Mind Decision (+ Conversation State).
 * Pure. No I/O. No new Mind decisions.
 *
 * Conversation State is the primary authority for:
 *   activeTopic, shortReply, pendingProposal, conversationMode, engagement, continuity
 * Focus / Momentum / Resume helpers remain as compat adapters; they must not
 * override Conversation State topic authority.
 *
 * Planner remains the authority for:
 *   objective, conversationalMove, writerBrief, must/mustNot, coda, depth
 *
 * @param {PlannerInput} [input]
 * @returns {PlannerPlan}
 */
export function plan(input = {}) {
  const ctx = normalize(input)
  const {
    perception,
    decision,
    messages,
    conversationResume,
    useConversationExperience,
    useExplorationPrinciples,
    useLearningPrinciples,
    usePlanningPrinciples,
  } = ctx

  // Phase 2: first-class Conversation State (build if pipeline did not pass one).
  // Never mutate the input situation object — clone for local planning mirrors only.
  const situation =
    ctx.conversationState && typeof ctx.conversationState === 'object'
      ? ctx.conversationState
      : buildConversationState({
          messages,
          perception,
          decision,
        })
  if (Object.isFrozen && !Object.isFrozen(situation) && process.env.NODE_ENV !== 'production') {
    console.warn('[planner] conversationState input should be frozen; Planner must not mutate it')
  }

  // Phase 1 short-reply: prefer Conversation State (same interpreter; no second classifier).
  // Clone so Planner never mutates the frozen State / shortReplyFull record.
  const shortReplyBase =
    situation?.diagnostics?.shortReplyFull ||
    shortReplyStateFromConversationState(situation, messages) ||
    interpretShortReply({ messages })
  /** @type {import('./short-reply.js').ShortReplyState} */
  let shortReplyState = { ...shortReplyBase }

  // Focus / Momentum: compat diagnostics. Topic authority is situation.activeTopic.
  const conversationFocus = evaluateConversationFocus(messages, decision, perception)
  if (situation.activeTopic && conversationFocus.status !== 'changed') {
    conversationFocus.topic = situation.activeTopic
    if (
      shortReplyState.intent === 'accept_proposal' ||
      shortReplyState.intent === 'continue' ||
      shortReplyState.intent === 'uncertain' ||
      shortReplyState.intent === 'passive_acknowledgement'
    ) {
      conversationFocus.status = 'active'
      conversationFocus.avoidClarification = true
    }
  }
  if (situation.activeTopic && conversationFocus.status === 'changed') {
    // State already resolved the new topic — keep Focus aligned, not competing.
    conversationFocus.topic = situation.activeTopic
  }

  const conversationMomentum = evaluateConversationMomentum(messages, decision, perception)
  // conversationMode (State) is authoritative; conversationMomentum is a deprecated compat mirror.
  if (situation.conversationMode) {
    conversationMomentum.kind = /** @type {ConversationMomentumKind} */ (
      situation.conversationMode === 'exploration'
        ? 'brainstorming'
        : situation.conversationMode
    )
    if (!conversationMomentum.signals.includes('deprecated_alias_of_conversationMode')) {
      conversationMomentum.signals = [
        ...conversationMomentum.signals,
        'deprecated_alias_of_conversationMode',
      ]
    }
  }

  // Stale proposal: if State cleared pending but short-reply still says accept from surface
  // without a live proposal, force passive — State ownership wins.
  if (
    (shortReplyState.intent === 'accept_proposal' || shortReplyState.intent === 'continue') &&
    !situation.pendingProposal &&
    !shortReplyState.hasPendingProposal
  ) {
    shortReplyState.intent = 'passive_acknowledgement'
    shortReplyState.conversationalMove = 'passive_acknowledgement'
    shortReplyState.reason = 'stale_proposal_expired_by_state'
  }

  // Conversation Director — decisions only; seeds topic from Conversation State.
  const directorState = directConversation({
    messages,
    decision,
    perception,
    conversationFocus,
    conversationMomentum,
    conversationState: situation,
  })

  // Short-reply accept/continue locks topic onto the living thread (Planner decision flags).
  if (
    shortReplyState.intent === 'accept_proposal' ||
    shortReplyState.intent === 'continue' ||
    shortReplyState.intent === 'uncertain'
  ) {
    directorState.shouldChangeTopic = false
    directorState.shouldLeadConversation = true
    directorState.shouldAskQuestion = false
    if (shortReplyState.intent === 'uncertain') {
      directorState.shouldExplain = true
    } else {
      directorState.shouldExplain = true
      directorState.shouldLeadConversation = true
    }
  }
  if (shortReplyState.intent === 'stop') {
    directorState.shouldAskQuestion = false
    directorState.shouldLeadConversation = false
  }
  if (shortReplyState.intent === 'passive_acknowledgement') {
    directorState.shouldAskQuestion = false
    directorState.shouldLeadConversation = false
  }
  if (shortReplyState.intent === 'decline_proposal') {
    directorState.shouldAskQuestion = false
    directorState.shouldLeadConversation = false
    directorState.shouldChangeTopic = false
  }

  // Align Focus mirror with authoritative topic (Focus is not a competing authority).
  if (
    !directorState.shouldChangeTopic &&
    situation.activeTopic &&
    conversationFocus.status !== 'none'
  ) {
    conversationFocus.status = 'active'
    conversationFocus.topic = situation.activeTopic
    conversationFocus.avoidClarification = true
    if (!conversationFocus.signals.includes('conversation_state_topic_lock')) {
      conversationFocus.signals = [
        ...conversationFocus.signals,
        'conversation_state_topic_lock',
      ]
    }
  }
  directorState.activeTopic = situation.activeTopic || directorState.activeTopic

  const conversationResumeUsage = decideConversationResumeUsage({
    conversationResume,
    conversationFocus,
    messages,
    conversationState: situation,
  })

  /** @type {ConversationExperience} */
  let conversationExperience
  /** @type {ExperienceGuidance} */
  let experienceGuidance
  if (useConversationExperience) {
    conversationExperience = evaluateConversationExperience(messages, decision, perception)
    experienceGuidance = buildExperienceGuidance(conversationExperience.experience, {
      useExplorationPrinciples,
      useLearningPrinciples,
      usePlanningPrinciples,
    })
  } else {
    conversationExperience = {
      experience: 'conversation',
      confidence: 0,
      reason: 'experience_disabled',
    }
    experienceGuidance = { experience: 'conversation', directives: [] }
  }

  // Keep Mind ask-flag for focus-based suppression, then let Director + short-reply veto questions.
  const baseCoda = resolveCoda(decision)
  let { coda, suppressedClarification } = resolveCodaWithFocus(
    baseCoda,
    decision,
    conversationFocus,
  )
  const shortReplyBlocksQuestion =
    shortReplyState.intent === 'accept_proposal' ||
    shortReplyState.intent === 'continue' ||
    shortReplyState.intent === 'passive_acknowledgement' ||
    shortReplyState.intent === 'stop' ||
    shortReplyState.intent === 'uncertain' ||
    shortReplyState.intent === 'decline_proposal'
  if ((!directorState.shouldAskQuestion || shortReplyBlocksQuestion) && coda === 'question') {
    let next = /** @type {WriterCoda} */ ('none')
    if (
      shortReplyState.intent === 'accept_proposal' ||
      shortReplyState.intent === 'continue'
    ) {
      next = decision.initiative === 'one_direction' ? 'direction' : 'insight'
    } else if (decision.initiative === 'one_insight') next = 'insight'
    else if (decision.initiative === 'one_spark') next = 'spark'
    else if (decision.initiative === 'one_direction') next = 'direction'
    if (shortReplyState.intent === 'passive_acknowledgement' || shortReplyState.intent === 'stop') {
      next = 'none'
    }
    if (shortReplyState.intent === 'decline_proposal') next = 'none'
    coda = next
    suppressedClarification = true
  }

  const shouldAskQuestion =
    Boolean(directorState.shouldAskQuestion && decision.shouldAskQuestion) &&
    !shortReplyBlocksQuestion &&
    situation.conversationPhase !== 'closing'

  const decisionForConstraints = {
    ...decision,
    shouldAskQuestion,
  }

  const opening = buildOpening(decision)
  const development = buildDevelopment(
    decision,
    perception,
    conversationMomentum,
    useConversationExperience ? conversationExperience : null,
  )
  const closing = closingFromCoda(coda)

  /** @type {ConversationPlan} */
  const conversationPlan = {
    opening,
    development,
    closing,
    lengthBand: /** @type {ConversationPlan['lengthBand']} */ (decision.responseDepth),
    beatCount: 1 + development.length + 1,
  }

  const must = buildMust(decision, perception, coda)
  const mustNot = buildMustNot(decision, coda)
  applyFocusDirectives(must, mustNot, conversationFocus, suppressedClarification)
  applyMomentumDirectives(must, conversationMomentum)
  if (useConversationExperience) {
    applyExperienceDirectives(must, conversationExperience, experienceGuidance)
  }
  applyResumeDirectives(must, mustNot, conversationResumeUsage)
  applyDirectorDirectives(must, mustNot, directorState)
  applyShortReplyDirectives(
    must,
    mustNot,
    shortReplyState,
    situation.activeTopic || directorState.activeTopic,
  )

  const conversationalMove = shortReplyState.conversationalMove
  const shouldContinue =
    conversationalMove === 'execute_pending_proposal' ||
    conversationalMove === 'continue_topic' ||
    conversationalMove === 'clarify_uncertain' ||
    (!directorState.shouldChangeTopic &&
      (decision.shouldContinueTopic ||
        conversationFocus.status === 'active' ||
        situation.continuity?.shouldResume ||
        isEngagementMediumOrHigher(directorState.userEngagement)))
  const forceMinimalAck =
    moveRequiresMinimalAck(conversationalMove) || conversationalMove === 'decline_proposal'
  const pendingProposalAction =
    conversationalMove === 'execute_pending_proposal' || conversationalMove === 'continue_topic'
      ? situation.pendingProposal?.type || shortReplyState.pendingProposalType
      : null
  // Single topic authority.
  const activeTopic = situation.activeTopic || directorState.activeTopic || null

  // Phase 4: constrain Mind adaptive profile for the task (HOW only).
  const mindProfile =
    decision.responseProfile && typeof decision.responseProfile === 'object'
      ? decision.responseProfile
      : buildAdaptiveResponseProfile({
          perception,
          conversationState: situation,
          mindDepth: decision.responseDepth,
          mindTone: decision.emotionalTone,
          strategy: decision.strategy,
        })
  const responseProfile = constrainAdaptiveResponseProfile(mindProfile, {
    strategy: decision.strategy,
    conversationalMove,
    conversationMode: situation.conversationMode || '',
    activeGoal: situation.activeGoal || '',
    forceMinimalAck,
  })

  // Align Writer depth band with constrained adaptive profile unless force-minimal.
  let writerDepth =
    forceMinimalAck ||
    conversationalMove === 'stop' ||
    conversationalMove === 'decline_proposal'
      ? 'minimal'
      : mapAdaptiveDepthToMind(responseProfile.depth)

  const profileMust = formatAdaptiveResponseProfileForWriter(responseProfile)
  if (profileMust) {
    must.push(profileMust)
  }
  mustNot.push(
    'Do not open with mechanical stock phrases: "Capisco.", "Certamente.", "Va bene.", "Perfetto.", "Assolutamente."',
  )
  if (!shouldAskQuestion) {
    mustNot.push(
      'Adaptive style must NOT add a follow-up question; shouldAskQuestion=false is absolute.',
    )
  }

  /** @type {WriterBrief} */
  const writerBrief = {
    language: perception.language,
    tone: decision.emotionalTone,
    depth: writerDepth,
    strategy:
      conversationalMove === 'stop' || conversationalMove === 'decline_proposal'
        ? 'close'
        : conversationalMove === 'execute_pending_proposal' ||
            conversationalMove === 'continue_topic'
          ? 'continue'
          : decision.strategy,
    need: decision.need,
    moveSummary: buildMoveSummary(
      decision,
      coda,
      conversationMomentum,
      useConversationExperience ? conversationExperience : null,
    ),
    must,
    mustNot,
    coda: shouldAskQuestion ? coda : coda === 'question' ? 'none' : coda,
    memoryHint: memoryHint(decision),
    teaching: decision.shouldTeach || directorState.shouldExplain,
    comfort: decision.shouldComfort,
    challenge: decision.shouldComfort ? false : decision.shouldChallenge,
    continueTopic: shouldContinue && conversationalMove !== 'stop',
    resumeSentence: conversationResumeUsage.used ? conversationResumeUsage.resumeSentence : null,
    conversationalMove,
    shouldContinue: shouldContinue && conversationalMove !== 'stop',
    shouldAskQuestion,
    activeTopic,
    pendingProposalAction,
    forceMinimalAck,
    shortReplyIntent: shortReplyState.intent,
    responseProfile,
  }

  const constraints = buildConstraints(
    decisionForConstraints,
    conversationFocus,
    suppressedClarification,
    conversationMomentum,
    conversationResumeUsage,
    useConversationExperience ? conversationExperience : null,
  )
  constraints.push(`director_objective:${directorState.objective}`)
  constraints.push(`user_engagement:${directorState.userEngagement}`)
  constraints.push(`conversation_mode:${situation.conversationMode || conversationMomentum.kind}`)
  constraints.push(`conversation_phase:${situation.conversationPhase || 'unknown'}`)
  constraints.push(`conversational_move:${conversationalMove}`)
  constraints.push(`short_reply_intent:${shortReplyState.intent}`)
  if (!directorState.shouldChangeTopic) constraints.push('director_lock_topic:yes')
  if (directorState.shouldLeadConversation) constraints.push('director_lead:yes')
  if (forceMinimalAck) constraints.push('force_minimal_ack:yes')
  if (!shouldAskQuestion) constraints.push('hard:no_question')
  if (situation.pendingProposal) {
    constraints.push(`pending_proposal:${situation.pendingProposal.type}`)
  }
  if (responseProfile) {
    constraints.push(`response_depth:${responseProfile.depth}`)
    constraints.push(`response_verbosity:${responseProfile.verbosity}`)
    constraints.push(`response_energy:${responseProfile.energy}`)
  }

  let objective = directorObjectiveToPlanObjective(directorState.objective, directorState)
  if (conversationalMove === 'execute_pending_proposal') {
    objective = 'execute_pending_proposal'
  } else if (conversationalMove === 'continue_topic') {
    objective = 'continue_topic'
  } else if (conversationalMove === 'passive_acknowledgement') {
    objective = 'passive_acknowledgement'
  } else if (conversationalMove === 'stop') {
    objective = 'stop'
  } else if (conversationalMove === 'clarify_uncertain') {
    objective = 'clarify_uncertain'
  } else if (conversationalMove === 'decline_proposal') {
    objective = 'decline_proposal'
  }

  return {
    objective,
    conversationPlan,
    writerBrief,
    constraints,
    confidence: computeConfidence(ctx),
    conversationFocus,
    conversationMomentum,
    conversationResume: conversationResumeUsage,
    conversationExperience,
    experienceGuidance,
    conversationState: situation,
    directorState,
    shortReplyState,
    responseProfile,
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
  const isFullPlan =
    planOrBrief &&
    typeof planOrBrief === 'object' &&
    'writerBrief' in /** @type {object} */ (planOrBrief)
  const brief = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).writerBrief
    : /** @type {WriterBrief} */ (planOrBrief)
  const focus = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).conversationFocus
    : null
  const momentum = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).conversationMomentum
    : null
  const resumeUsage = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).conversationResume
    : null
  const experience = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).conversationExperience
    : null
  const experienceGuidance = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).experienceGuidance
    : null
  const directorState = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).directorState
    : null
  const situation = isFullPlan
    ? /** @type {PlannerPlan} */ (planOrBrief).conversationState
    : null

  if (!brief || typeof brief !== 'object') return ''

  const lines = [
    'WRITER BRIEF (execute; do not renegotiate)',
    `language=${brief.language}; tone=${brief.tone}; depth=${brief.depth}`,
    `strategy=${brief.strategy}; need=${brief.need}; coda=${brief.coda}`,
    `move: ${brief.moveSummary}`,
    `memoryHint=${brief.memoryHint}; teaching=${brief.teaching}; comfort=${brief.comfort}; challenge=${brief.challenge}; continueTopic=${brief.continueTopic}`,
  ]
  if (brief.conversationalMove) {
    lines.push(
      `conversationalContract: move=${brief.conversationalMove}; shouldContinue=${Boolean(brief.shouldContinue)}; shouldAskQuestion=${Boolean(brief.shouldAskQuestion)}; activeTopic=${brief.activeTopic || '(none)'}; pendingProposalAction=${brief.pendingProposalAction || '(none)'}; forceMinimalAck=${Boolean(brief.forceMinimalAck)}; shortReplyIntent=${brief.shortReplyIntent || ''}`,
    )
  }
  if (brief.responseProfile && typeof brief.responseProfile === 'object') {
    const rp = brief.responseProfile
    lines.push(
      `responseProfile: depth=${rp.depth}; verbosity=${rp.verbosity}; energy=${rp.energy}; emoji=${rp.emojiPolicy}`,
    )
  }
  if (situation && typeof situation === 'object') {
    lines.push(
      `conversationState: topic=${situation.activeTopic || '(none)'}; mode=${situation.conversationMode || '(none)'}; phase=${situation.conversationPhase || '(none)'}; engagement=${situation.engagement || '(none)'}; pending=${situation.pendingProposal?.type || '(none)'}`,
    )
  }
  if (directorState && typeof directorState === 'object') {
    lines.push(
      `conversationDirector: objective=${directorState.objective}; engagement=${directorState.userEngagement}; topic=${directorState.activeTopic || '(none)'}; lead=${Boolean(directorState.shouldLeadConversation)}; changeTopic=${Boolean(directorState.shouldChangeTopic)}; expectedReaction=${directorState.expectedNextReaction || ''}`,
    )
  }
  if (focus && typeof focus === 'object') {
    lines.push(
      `conversationFocus: status=${focus.status}; topic=${focus.topic || '(none)'}; avoidClarification=${Boolean(focus.avoidClarification)}`,
    )
  }
  if (momentum && typeof momentum === 'object') {
    lines.push(
      `conversationMomentum: kind=${momentum.kind}; confidence=${Number(momentum.confidence).toFixed(2)}`,
    )
  }
  if (experience && typeof experience === 'object') {
    lines.push(
      `conversationExperience: experience=${experience.experience}; confidence=${Number(experience.confidence || 0).toFixed(2)}; reason=${experience.reason || ''}`,
    )
  }
  if (experienceGuidance && typeof experienceGuidance === 'object') {
    const dirs = Array.isArray(experienceGuidance.directives)
      ? experienceGuidance.directives.join(' | ')
      : ''
    lines.push(`experienceGuidance: ${dirs}`)
  }
  if (resumeUsage && typeof resumeUsage === 'object') {
    lines.push(
      `conversationResume: used=${Boolean(resumeUsage.used)}; reason=${resumeUsage.reason || ''}; confidence=${Number(resumeUsage.confidence || 0).toFixed(2)}`,
    )
    if (resumeUsage.used && resumeUsage.resumeSentence) {
      lines.push(`resumeSentence: ${resumeUsage.resumeSentence}`)
    }
  }
  lines.push('MUST:', ...((brief.must || []).map((m) => `- ${m}`)))
  lines.push('MUST NOT:', ...((brief.mustNot || []).map((m) => `- ${m}`)))
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
  const focus = v.conversationFocus
  const momentum = v.conversationMomentum
  const resume = v.conversationResume
  const experience = v.conversationExperience
  const guidance = v.experienceGuidance
  const situation = v.conversationState
  const director = v.directorState
  return (
    typeof v.objective === 'string' &&
    cp != null &&
    typeof cp === 'object' &&
    wb != null &&
    typeof wb === 'object' &&
    Array.isArray(v.constraints) &&
    typeof v.confidence === 'number' &&
    focus != null &&
    typeof focus === 'object' &&
    typeof /** @type {any} */ (focus).status === 'string' &&
    momentum != null &&
    typeof momentum === 'object' &&
    typeof /** @type {any} */ (momentum).kind === 'string' &&
    resume != null &&
    typeof resume === 'object' &&
    typeof /** @type {any} */ (resume).used === 'boolean' &&
    experience != null &&
    typeof experience === 'object' &&
    typeof /** @type {any} */ (experience).experience === 'string' &&
    typeof /** @type {any} */ (experience).confidence === 'number' &&
    typeof /** @type {any} */ (experience).reason === 'string' &&
    guidance != null &&
    typeof guidance === 'object' &&
    Array.isArray(/** @type {any} */ (guidance).directives) &&
    situation != null &&
    typeof situation === 'object' &&
    (/** @type {any} */ (situation).activeTopic === null ||
      typeof /** @type {any} */ (situation).activeTopic === 'string') &&
    /** @type {any} */ (situation).shortReply != null &&
    director != null &&
    typeof director === 'object' &&
    typeof /** @type {any} */ (director).objective === 'string' &&
    typeof /** @type {any} */ (director).userEngagement === 'string' &&
    typeof /** @type {any} */ (director).continuationType === 'string' &&
    typeof /** @type {any} */ (director).expectedNextReaction === 'string' &&
    typeof /** @type {any} */ (director).shouldChangeTopic === 'boolean'
  )
}
