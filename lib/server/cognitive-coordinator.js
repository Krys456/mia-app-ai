/**
 * LAIfe Cognitive Coordinator
 *
 * Final decision maker before the Writer generates the response.
 * Every cognitive engine is an advisor; the Coordinator ranks, dedupes,
 * resolves conflicts, and limits influence so only the most useful
 * behaviors shape the answer.
 *
 * Never let multiple engines compete for the same part of the response.
 * Optimize for coherence, clarity, and conversational quality.
 *
 * Invisible to the user. Fail-soft.
 */

import { runInsightDiscoveryStage } from './insight-discovery.js'
import { runHumanConversationSimulator } from './human-conversation-simulator.js'
import { runThoughtfulnessEngine } from './thoughtfulness-engine.js'
import { runDeepThinkingEngine } from './deep-thinking-engine.js'
import { runPresenceEngine } from './presence-engine.js'
import { runWisdomEngine } from './wisdom-engine.js'
import { runConversationTaste } from './conversation-taste.js'
import { runConversationMemoryFlow } from './conversation-memory-flow.js'
import { runSelfReflectionEngine } from './self-reflection-engine.js'
import { runConversationConstitution } from './conversation-constitution.js'
import { runConversationOwnershipProtocol } from './conversation-ownership.js'
import { runWorthReadingProtocol } from './worth-reading-protocol.js'
import { runLanguageAwareness } from './language-awareness.js'
import { runSocialConversationEngine } from './social-conversation-engine.js'
import { runConversationSparkEngine } from './conversation-spark-engine.js'
import { runNaturalDialogueEngine } from './natural-dialogue-engine.js'
import { runConversationalPragmaticsEngine } from './conversational-pragmatics-engine.js'

/**
 * @typedef {'memory'|'curiosity'|'continuation'|'next_ask'|'teacher'|'personality'|'knowledge_level'|'welcome'|'life_intelligence'|'automation_builder'|'device_manager'|'topic_leadership'|'conversation_spark'|'natural_dialogue'|'conversational_pragmatics'|'information_value'|'intellectual_initiative'|'surprise'|'intellectual_honesty'|'feedback_interpretation'|'warm_conversation'|'conversational_presence'|'question_economy'|'conversation_mindset'|'planning'|'tool_selection'|'progressive_reasoning'|'adaptive'|'voice'|'momentum'|'action'|'multi_step'|'conversation_intelligence'|'reflection'|'core_plan'|'self_reflection'|'conversation_constitution'|'conversation_ownership'|'worth_reading'|'language_awareness'|'social_conversation'|'thoughtfulness'} AdvisorId
 */

/**
 * Exclusive response slots — at most one primary winner per slot
 * (style may merge a small capped set).
 *
 * @typedef {'opening'|'structure'|'coda'|'style'|'tools'|'goal'|'memory_policy'|'directive'} ResponseSlot
 */

/**
 * @typedef {object} AdvisorSuggestion
 * @property {string} id
 * @property {AdvisorId} advisor
 * @property {ResponseSlot} slot
 * @property {string} [text]
 * @property {string[]} [structure]
 * @property {string[]} [tools]
 * @property {string} [goal]
 * @property {boolean} [skipMemory]
 * @property {boolean} [webOff]
 * @property {number} [confidence] 0–1
 * @property {number} [baseValue] 0–10
 * @property {string[]} [reasons]
 * @property {boolean} [active]
 * @property {string} [fingerprint] for dedupe
 */

/**
 * @typedef {object} CoordinationDecision
 * @property {AdvisorSuggestion[]} collected
 * @property {AdvisorSuggestion[]} ranked
 * @property {AdvisorSuggestion[]} accepted
 * @property {AdvisorSuggestion[]} rejected
 * @property {Record<string, AdvisorSuggestion | null>} winnersBySlot
 * @property {string[]} styleBriefs
 * @property {string[]} directiveBriefs
 * @property {string[]} responseStructure
 * @property {string[]} toolOrder
 * @property {string[]} toolsSkipped
 * @property {string | null} realGoal
 * @property {boolean} skipMemory
 * @property {boolean} webOff
 * @property {string} writerDirective
 * @property {string} coordinatorBrief
 * @property {string[]} reasons
 * @property {{ found: boolean, kind?: string, seed?: string, score?: number } | null} [insightDiscovery]
 * @property {{ active: boolean, seeking?: string, move?: string, questionNecessary?: boolean, emotionFirst?: boolean, buildMomentum?: boolean, optimizeEnjoyment?: boolean, lengthBias?: string } | null} [conversationIntent]
 */

/** Max advisor briefs allowed into the Writer directive (besides base). */
const MAX_DIRECTIVE_BRIEFS = 4

/** Max style briefs (voice + personality/behavior). */
const MAX_STYLE_BRIEFS = 2

/** Max structure steps passed to Writer. */
const MAX_STRUCTURE_STEPS = 6

/** Max coda lines (always ≤1 after conflict resolution). */
const MAX_CODA = 1

/**
 * Base value by advisor when competing for influence.
 * Higher = more likely to win exclusive slots when confidence is equal.
 * @type {Record<AdvisorId, number>}
 */
const ADVISOR_BASE_VALUE = {
  reflection: 3,
  conversation_intelligence: 6,
  voice: 9,
  continuation: 9,
  personality: 7,
  knowledge_level: 7.5,
  intellectual_honesty: 8.35,
  feedback_interpretation: 9.15,
  warm_conversation: 8.05,
  conversational_presence: 8.15,
  question_economy: 8.4,
  conversation_mindset: 8.55,
  conversation_delight: 8.65,
  social_conversation: 9.56,
  conversation_intent: 9.55,
  conversation_constitution: 9.7,
  conversation_ownership: 9.73,
  worth_reading: 9.72,
  language_awareness: 9.6,
  conversation_leadership: 9.5,
  thoughtfulness: 9.48,
  deep_thinking: 9.47,
  presence: 9.46,
  wisdom: 9.45,
  conversation_taste: 9.44,
  conversation_memory_flow: 9.42,
  self_reflection: 9.4,
  welcome: 9.2,
  life_intelligence: 7.8,
  automation_builder: 9.3,
  device_manager: 8.2,
  topic_leadership: 9.45,
  conversation_spark: 9.46,
  natural_dialogue: 9.57,
  conversational_pragmatics: 9.58,
  information_value: 6.5,
  teacher: 8,
  progressive_reasoning: 7,
  adaptive: 5,
  planning: 7,
  multi_step: 9.5,
  action: 9,
  next_ask: 5.5,
  curiosity: 5,
  momentum: 5,
  intellectual_initiative: 5.35,
  surprise: 5.25,
  tool_selection: 6,
  memory: 6,
  core_plan: 4,
}

/**
 * Slot priority when assembling the final response (lower = earlier / stronger).
 * @type {Record<ResponseSlot, number>}
 */
const SLOT_PRIORITY = {
  goal: 1,
  opening: 2,
  structure: 3,
  tools: 4,
  memory_policy: 5,
  directive: 6,
  style: 7,
  coda: 8,
}

/**
 * Normalize confidence labels or numbers to 0–1.
 * @param {unknown} c
 */
function conf01(c) {
  if (typeof c === 'number' && Number.isFinite(c)) {
    return Math.max(0, Math.min(1, c > 1 ? c / 10 : c))
  }
  if (c === 'high') return 0.9
  if (c === 'medium') return 0.65
  if (c === 'low') return 0.35
  return 0.5
}

/**
 * @param {string} text
 */
function fingerprintText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .slice(0, 160)
}

/**
 * Create a suggestion object.
 * @param {Partial<AdvisorSuggestion> & { advisor: AdvisorId, slot: ResponseSlot }} raw
 * @returns {AdvisorSuggestion}
 */
export function makeSuggestion(raw) {
  const text = raw.text || ''
  const structure = Array.isArray(raw.structure) ? raw.structure.filter(Boolean) : undefined
  const fp =
    raw.fingerprint ||
    fingerprintText(
      [raw.advisor, raw.slot, text, (structure || []).join('|')].filter(Boolean).join('::'),
    )
  return {
    id: raw.id || `${raw.advisor}:${raw.slot}:${fp.slice(0, 24)}`,
    advisor: raw.advisor,
    slot: raw.slot,
    text: text || undefined,
    structure,
    tools: raw.tools,
    goal: raw.goal,
    skipMemory: raw.skipMemory,
    webOff: raw.webOff,
    confidence: conf01(raw.confidence),
    baseValue:
      typeof raw.baseValue === 'number'
        ? raw.baseValue
        : ADVISOR_BASE_VALUE[raw.advisor] ?? 4,
    reasons: raw.reasons || [],
    active: raw.active !== false,
    fingerprint: fp,
  }
}

/**
 * Value score used for ranking.
 * @param {AdvisorSuggestion} s
 */
export function scoreSuggestion(s) {
  const slotBoost = 10 - (SLOT_PRIORITY[s.slot] ?? 6)
  return (s.baseValue || 0) * (0.45 + 0.55 * (s.confidence || 0.5)) + slotBoost * 0.15
}

/**
 * Rank suggestions highest-value first.
 * @param {AdvisorSuggestion[]} suggestions
 */
export function rankSuggestions(suggestions) {
  return [...suggestions]
    .filter((s) => s && s.active !== false)
    .map((s) => ({ ...s, _score: scoreSuggestion(s) }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score
      return (SLOT_PRIORITY[a.slot] ?? 9) - (SLOT_PRIORITY[b.slot] ?? 9)
    })
}

/**
 * Remove near-duplicate suggestions (same slot + similar fingerprint / text).
 * @param {AdvisorSuggestion[]} ranked
 */
export function dedupeSuggestions(ranked) {
  /** @type {AdvisorSuggestion[]} */
  const out = []
  const seen = new Set()
  for (const s of ranked) {
    const key = `${s.slot}::${s.fingerprint}`
    const textKey = s.text ? `${s.slot}::${fingerprintText(s.text).slice(0, 80)}` : ''
    if (seen.has(key) || (textKey && seen.has(textKey))) continue
    // Soft near-dup: same advisor+slot keeps highest only (already ranked)
    const advisorSlot = `${s.advisor}::${s.slot}`
    if (seen.has(advisorSlot)) continue
    seen.add(key)
    if (textKey) seen.add(textKey)
    seen.add(advisorSlot)
    out.push(s)
  }
  return out
}

/**
 * Hard suppressions based on conversational state.
 * @param {object} state
 */
function buildSuppressions(state) {
  /** @type {Set<string>} */
  const suppressAdvisors = new Set()
  /** @type {Set<ResponseSlot>} */
  const suppressSlots = new Set()

  const cont = state.continuation
  const voice = state.voice
  const shortStop = Boolean(cont?.isShortMessage && !cont?.shouldContinue)
  const shortContinue = Boolean(cont?.isShortMessage && cont?.shouldContinue)
  const voiceBusy = Boolean(
    voice?.active && (voice.interruptKind !== 'none' || voice.incompleteUtterance),
  )
  const multiActive = Boolean(state.multiStep?.active)
  const actionBusy = Boolean(state.action?.actionRequired)
  const automationBusy = Boolean(
    state.automation?.active &&
      state.automation.phase !== 'idle' &&
      state.automation.phase !== 'cancelled',
  )
  const topicLead = Boolean(state.topicLeadership?.shouldLead)
  const sparkOwns = Boolean(state.conversationSpark?.shouldSpark)
  const feedbackOwns = Boolean(state.feedbackInterpretation?.active)
  const warmOwns = Boolean(
    state.warmConversation?.active &&
      state.warmConversation?.ownsOpening &&
      !state.warmConversation?.softStyleOnly,
  )
  const socialOwns = Boolean(
    state.socialConversation?.active &&
      (state.socialConversation?.isSocial || state.socialConversation?.mode === 'social'),
  )
  const dialogueReactionOwns = Boolean(
    state.naturalDialogue?.active && state.naturalDialogue?.reactionOnly,
  )
  const questionEconomyTight = Boolean(
    state.questionEconomy?.active &&
      (state.questionEconomy?.consecutiveRisk ||
        (state.questionEconomy?.preferContinue && !state.questionEconomy?.allowQuestion)),
  )

  if (shortStop) {
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (questionEconomyTight && state.questionEconomy?.consecutiveRisk) {
    // Last turn already asked — don't stack another interrogative coda
    suppressAdvisors.add('next_ask')
  }
  if (feedbackOwns) {
    // Meta-feedback owns style adaptation this turn — no competing coda noise
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressAdvisors.add('welcome')
    suppressAdvisors.add('warm_conversation')
    suppressSlots.add('coda')
  }
  if (warmOwns) {
    // Pure warm greeting / casual start — no transactional coda noise
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (socialOwns) {
    // Pure social contact — no helpdesk coda / tip stacking
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (dialogueReactionOwns) {
    // Pure dialogue reaction beat — no tip/coda stacking
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressAdvisors.add('momentum')
    suppressSlots.add('coda')
  }
  if (topicLead) {
    // Topic Leadership owns the turn — one theme, no competing coda / tips / welcome opening
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressAdvisors.add('welcome')
    suppressSlots.add('coda')
  }
  if (sparkOwns) {
    // Spark owns the opening beat — no tip/coda stacking that dilutes the spark
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (voiceBusy) {
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (multiActive) {
    // Multi-step owns structure; teacher/progressive structure yield
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
  }
  if (actionBusy && !multiActive) {
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('life_intelligence')
  }
  if (automationBusy) {
    // Automation builder owns the turn — explain draft, no competing tips
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (shortContinue) {
    // Continuation owns the beat — no competing coda engines
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }

  return {
    suppressAdvisors,
    suppressSlots,
    shortStop,
    shortContinue,
    topicLead,
    voiceBusy,
    multiActive,
    actionBusy,
    automationBusy,
  }
}

/**
 * Resolve conflicts: one winner per exclusive slot; coda engines never share.
 * @param {AdvisorSuggestion[]} deduped
 * @param {object} state
 */
export function resolveConflicts(deduped, state = {}) {
  const { suppressAdvisors, suppressSlots, multiActive, actionBusy, voiceBusy, shortStop } =
    buildSuppressions(state)

  /** @type {AdvisorSuggestion[]} */
  const accepted = []
  /** @type {AdvisorSuggestion[]} */
  const rejected = []
  /** @type {Record<string, AdvisorSuggestion | null>} */
  const winnersBySlot = {
    opening: null,
    structure: null,
    coda: null,
    style: null,
    tools: null,
    goal: null,
    memory_policy: null,
    directive: null,
  }

  /** @type {AdvisorSuggestion[]} */
  const styleAccepted = []
  /** @type {AdvisorSuggestion[]} */
  const directiveAccepted = []

  for (const s of deduped) {
    if (suppressAdvisors.has(s.advisor) && (s.slot === 'coda' || s.slot === 'structure')) {
      // Allow style/directive from suppressed advisors only if not coda/structure
      if (s.slot === 'coda' || (s.slot === 'structure' && (multiActive || actionBusy || voiceBusy || shortStop))) {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'suppressed_by_coordinator'] })
        continue
      }
    }
    if (suppressSlots.has(s.slot)) {
      rejected.push({ ...s, reasons: [...(s.reasons || []), 'slot_suppressed'] })
      continue
    }

    // Structure: exclusive — prefer multi_step > action > voice > continuation > teacher > personality > progressive > planning > adaptive > core
    if (s.slot === 'structure' || s.slot === 'opening') {
      const slot = s.slot
      if (!winnersBySlot[slot]) {
        winnersBySlot[slot] = s
        accepted.push(s)
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), `lost_${slot}_to_${winnersBySlot[slot]?.advisor}`] })
      }
      continue
    }

    // Coda: exclusive — curiosity / momentum / intellectual_initiative / surprise / next_ask bridge — only ONE
    if (s.slot === 'coda') {
      if (!winnersBySlot.coda && accepted.filter((a) => a.slot === 'coda').length < MAX_CODA) {
        winnersBySlot.coda = s
        accepted.push(s)
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'lost_coda_slot'] })
      }
      continue
    }

    // Style: merge up to MAX_STYLE_BRIEFS (voice preferred first via ranking)
    if (s.slot === 'style') {
      if (styleAccepted.length < MAX_STYLE_BRIEFS) {
        styleAccepted.push(s)
        accepted.push(s)
        if (!winnersBySlot.style) winnersBySlot.style = s
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'style_budget'] })
      }
      continue
    }

    // Directive briefs: capped
    if (s.slot === 'directive') {
      if (directiveAccepted.length < MAX_DIRECTIVE_BRIEFS) {
        directiveAccepted.push(s)
        accepted.push(s)
        if (!winnersBySlot.directive) winnersBySlot.directive = s
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'directive_budget'] })
      }
      continue
    }

    // tools / goal / memory_policy: exclusive winner (highest ranked)
    if (s.slot === 'tools' || s.slot === 'goal' || s.slot === 'memory_policy') {
      if (!winnersBySlot[s.slot]) {
        winnersBySlot[s.slot] = s
        accepted.push(s)
      } else if (s.slot === 'tools') {
        // Merge tool lists from secondary tool advisors into winner later via apply
        // Accept as supplemental if same policy direction
        accepted.push(s)
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), `lost_${s.slot}`] })
      }
      continue
    }

    accepted.push(s)
  }

  return { accepted, rejected, winnersBySlot, styleAccepted, directiveAccepted }
}

/**
 * Collect advisor suggestions from engine outputs.
 * Engines propose; they do not decide.
 *
 * @param {object} input
 * @returns {AdvisorSuggestion[]}
 */
export function collectAdvisorSuggestions(input) {
  const {
    plan,
    baseStructure,
    reflection,
    conversation,
    voice,
    welcome,
    continuation,
    behavior,
    knowledge,
    expertTeacher,
    task,
    nextAsk,
    curiosity,
    momentum,
    intellectualInitiative,
    surprise,
    honesty,
    feedbackInterpretation,
    warmConversation,
    conversationSpark,
    naturalDialogue,
    conversationalPragmatics,
    conversationalPresence,
    questionEconomy,
    conversationMindset,
    conversationDelight,
    socialConversation,
    conversationIntent,
    conversationLeadership,
    thoughtfulness,
    deepThinking,
    presence,
    wisdom,
    conversationTaste,
    conversationMemoryFlow,
    selfReflection,
    conversationConstitution,
    conversationOwnership,
    worthReading,
    languageAwareness,
    multiStep,
    actionEngine,
    life,
    automationBuilder,
    deviceManager,
    topicLeadership,
    follow,
  } = input

  /** @type {AdvisorSuggestion[]} */
  const out = []

  // --- Language Awareness (foundational — reply language correctness) ---
  if (languageAwareness?.plan?.active && languageAwareness.plan.writerBrief) {
    const la = languageAwareness.plan
    out.push(
      makeSuggestion({
        advisor: 'language_awareness',
        slot: 'directive',
        text: la.writerBrief,
        confidence: la.confidence === 'high' ? 0.97 : la.confidence === 'medium' ? 0.85 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.language_awareness,
        reasons: ['reply_language', ...(la.signals || []).slice(0, 2)],
      }),
    )
    if (la.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'language_awareness',
          slot: 'structure',
          structure: [
            la.structureLine,
            `Reply entirely in ${la.replyLanguage === 'it' ? 'italiano' : la.replyLanguage === 'en' ? 'English' : 'user language'}`,
            la.metaRequest
              ? 'Meta language request: adapt immediately, no philosophy'
              : 'Maintain conversation language; never explain languages unless asked',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: la.writerBrief,
          confidence: 0.92,
          baseValue: ADVISOR_BASE_VALUE.language_awareness + 0.05,
          reasons: ['language_awareness_structure'],
        }),
      )
    }
  }

  // --- Conversation Constitution (GLOBAL IMMUTABLE LAW — highest Writer priority) ---
  if (conversationConstitution?.plan?.active && conversationConstitution.plan.writerBrief) {
    const cc = conversationConstitution.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_constitution',
        slot: 'directive',
        text: cc.writerBrief,
        confidence: 0.99,
        baseValue: ADVISOR_BASE_VALUE.conversation_constitution,
        reasons: ['immutable_law', ...(cc.signals || []).slice(0, 2)],
      }),
    )
    if (cc.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_constitution',
          slot: 'structure',
          structure: [
            cc.structureLine,
            'Worth reading · respect attention · no customer support',
            'Observations > questions · reward curiosity · respect emotions',
            'Momentum · elegance · honesty · leave better',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: cc.writerBrief,
          confidence: 0.95,
          baseValue: ADVISOR_BASE_VALUE.conversation_constitution + 0.05,
          reasons: ['conversation_constitution_structure'],
        }),
      )
    }
  }

  // --- Conversation Ownership Protocol (after Constitution / HCS; before Worth Reading) ---
  if (conversationOwnership?.plan?.active && conversationOwnership.plan.writerBrief) {
    const co = conversationOwnership.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_ownership',
        slot: 'directive',
        text: co.writerBrief,
        confidence: 0.98,
        baseValue: ADVISOR_BASE_VALUE.conversation_ownership,
        reasons: ['partner_attivo', ...(co.signals || []).slice(0, 2)],
      }),
    )
    if (co.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_ownership',
          slot: 'structure',
          structure: [
            co.structureLine,
            'Partner attivo · non assistente passivo',
            'Turni corti/vago → LEAD con contributo reale',
            'Niente ack/Q generiche · non inventare fatti',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: co.writerBrief,
          confidence: 0.94,
          baseValue: ADVISOR_BASE_VALUE.conversation_ownership + 0.05,
          reasons: ['conversation_ownership_structure'],
        }),
      )
    }
  }

  // --- Worth Reading Protocol (FINAL Writer craft — after Ownership / HCS) ---
  if (worthReading?.plan?.active && worthReading.plan.writerBrief) {
    const wr = worthReading.plan
    out.push(
      makeSuggestion({
        advisor: 'worth_reading',
        slot: 'directive',
        text: wr.writerBrief,
        confidence: 0.98,
        baseValue: ADVISOR_BASE_VALUE.worth_reading,
        reasons: ['pre_writer_craft', ...(wr.signals || []).slice(0, 2)],
      }),
    )
    if (wr.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'worth_reading',
          slot: 'structure',
          structure: [
            wr.structureLine,
            'Never waste a turn · never abandon · contribution > interrogation',
            'Momentum · no clichés · natural rhythm · delight when apt',
            'Human Conversation Test · Worth Reading Test · Final Quality Gate',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: wr.writerBrief,
          confidence: 0.94,
          baseValue: ADVISOR_BASE_VALUE.worth_reading + 0.05,
          reasons: ['worth_reading_structure'],
        }),
      )
    }
  }

  // --- Social Conversation Engine (PRE-INTENT: SOCIAL vs INFORMATIONAL) ---
  if (socialConversation?.plan?.active && socialConversation.plan.writerBrief) {
    const sc = socialConversation.plan
    out.push(
      makeSuggestion({
        advisor: 'social_conversation',
        slot: 'directive',
        text: sc.writerBrief,
        confidence: sc.confidence === 'high' ? 0.96 : sc.confidence === 'medium' ? 0.88 : 0.72,
        baseValue: ADVISOR_BASE_VALUE.social_conversation,
        reasons: [
          `mode_${sc.mode}`,
          sc.socialIntent ? `social_${sc.socialIntent}` : 'social',
          sc.isSocial ? 'is_social' : 'mixed_or_soft',
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'social_conversation',
        slot: 'style',
        text: sc.writerBrief,
        confidence: sc.confidence === 'high' ? 0.93 : 0.8,
        baseValue: ADVISOR_BASE_VALUE.social_conversation - 0.05,
        reasons: [`social_style_${sc.mode}`, ...(sc.signals || []).slice(0, 3)],
      }),
    )
    if (sc.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'social_conversation',
          slot: 'structure',
          structure: [
            sc.structureLine,
            sc.isSocial
              ? 'Contatto umano: connessione > informazione; niente sportello'
              : 'Misto: cenno caldo, poi sostanza senza helpdesk',
            sc.forceNoQuestion
              ? 'Niente domanda obbligata — a volte basta una frase calda'
              : 'Domanda solo se nasce naturale',
            sc.avoidTopicChange
              ? 'Non cambiare argomento di botto; non forzare “What about you?”'
              : 'Resta sul filo umano',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: sc.writerBrief,
          confidence: 0.91,
          baseValue: ADVISOR_BASE_VALUE.social_conversation - 0.1,
          reasons: ['social_conversation_structure'],
        }),
      )
    }
  }

  // --- Natural Dialogue Engine (conversational moves · reaction-first) ---
  if (naturalDialogue?.plan?.active && naturalDialogue.plan.writerBrief) {
    const nd = naturalDialogue.plan
    out.push(
      makeSuggestion({
        advisor: 'natural_dialogue',
        slot: 'directive',
        text: nd.writerBrief,
        confidence: nd.confidence === 'high' ? 0.96 : nd.confidence === 'medium' ? 0.88 : 0.74,
        baseValue: ADVISOR_BASE_VALUE.natural_dialogue,
        reasons: [`move_${nd.move}`, nd.reactionOnly ? 'reaction_only' : 'reaction_first'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'natural_dialogue',
        slot: 'style',
        text: nd.writerBrief,
        confidence: nd.confidence === 'high' ? 0.94 : 0.82,
        baseValue: ADVISOR_BASE_VALUE.natural_dialogue - 0.05,
        reasons: [`energy_${nd.matchEnergy}`, ...(nd.signals || []).slice(0, 2)],
      }),
    )
    if (nd.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'natural_dialogue',
          slot: 'structure',
          structure: [
            nd.structureLine,
            'Reaction → Connection → Conversation → Information',
            nd.reactionOnly
              ? 'Basta una reazione genuina — niente lezione/domanda'
              : 'Apri con reazione umana; info solo se serve dopo',
            `Suggested beat: «${nd.reaction}»`,
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: nd.writerBrief,
          confidence: 0.92,
          baseValue: ADVISOR_BASE_VALUE.natural_dialogue - 0.08,
          reasons: ['natural_dialogue_structure'],
        }),
      )
    }
    if (nd.reactionOnly) {
      out.push(
        makeSuggestion({
          advisor: 'natural_dialogue',
          slot: 'opening',
          structure: [
            `Natural Dialogue opening: «${nd.reaction}»`,
            'Mosse conversazionali — non dump di informazione',
            'Vietato: “I’m glad you found that amusing.” / “Let’s explore this topic.”',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: nd.writerBrief,
          confidence: 0.93,
          baseValue: ADVISOR_BASE_VALUE.natural_dialogue,
          reasons: [`open_${nd.move}`, 'reaction_only'],
        }),
      )
    }
  }

  // --- Conversational Pragmatics (intended meaning > literal · pre-WriterDirectives) ---
  if (conversationalPragmatics?.plan?.active && conversationalPragmatics.plan.writerBrief) {
    const cp = conversationalPragmatics.plan
    out.push(
      makeSuggestion({
        advisor: 'conversational_pragmatics',
        slot: 'directive',
        text: cp.writerBrief,
        confidence: cp.confidence === 'high' ? 0.97 : cp.confidence === 'medium' ? 0.9 : 0.76,
        baseValue: ADVISOR_BASE_VALUE.conversational_pragmatics,
        reasons: [
          `force_${cp.force}`,
          cp.playful ? 'playful_intent' : 'subtext',
          ...(cp.signals || []).slice(0, 2),
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversational_pragmatics',
        slot: 'style',
        text: `Conversational Pragmatics: intended > literal (${cp.force}). ${
          cp.playful
            ? 'Playful: react, smile if fit, ack the joke — no defense, no overanalysis.'
            : 'Acknowledge subtext naturally.'
        }`,
        confidence: cp.confidence === 'high' ? 0.95 : 0.84,
        baseValue: ADVISOR_BASE_VALUE.conversational_pragmatics - 0.04,
        reasons: [`pragmatics_${cp.force}`],
      }),
    )
    if (cp.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversational_pragmatics',
          slot: 'structure',
          structure: [
            cp.structureLine,
            `Literal: ${cp.literalReading}`,
            `Intended: ${cp.intendedMeaning}`,
            cp.reactionOnly
              ? `Reaction-only OK: «${cp.reaction}»`
              : `Open with: «${cp.reaction}»`,
            'Vietato: difendersi · spiegarsi · overanalizzare · prendere tutto alla lettera',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: cp.writerBrief,
          confidence: 0.94,
          baseValue: ADVISOR_BASE_VALUE.conversational_pragmatics - 0.06,
          reasons: ['pragmatics_structure'],
        }),
      )
    }
    if (cp.playful && cp.reaction) {
      out.push(
        makeSuggestion({
          advisor: 'conversational_pragmatics',
          slot: 'opening',
          structure: [
            `Pragmatics opening: «${cp.reaction}»`,
            'Sottotesto playful — non lezione letterale',
            'Vietato: “Hai ragione, tornare sullo stesso argomento…”',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: cp.writerBrief,
          confidence: 0.95,
          baseValue: ADVISOR_BASE_VALUE.conversational_pragmatics,
          reasons: [`open_${cp.force}`, 'playful'],
        }),
      )
    }
  }

  // --- Conversation Intent (PRE-PLAN: why behind the words — guides entire response) ---
  if (conversationIntent?.plan?.active && conversationIntent.plan.writerBrief) {
    const ci = conversationIntent.plan
    const inf = ci.inference || {}
    out.push(
      makeSuggestion({
        advisor: 'conversation_intent',
        slot: 'directive',
        text: ci.writerBrief,
        confidence: inf.confidence === 'high' ? 0.95 : inf.confidence === 'medium' ? 0.88 : 0.72,
        baseValue: ADVISOR_BASE_VALUE.conversation_intent,
        reasons: [`intent_${inf.conversationalIntent || 'unknown'}`, `expects_${inf.expects || 'mixed'}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_intent',
        slot: 'style',
        text: ci.writerBrief,
        confidence: inf.confidence === 'high' ? 0.92 : 0.8,
        baseValue: ADVISOR_BASE_VALUE.conversation_intent - 0.1,
        reasons: [`emo_${inf.emotionalIntent || 'neutral'}`, ...(ci.reasons || []).slice(0, 3)],
      }),
    )
    if (ci.structureLine && !conversationConstitution?.plan?.structureLine && !conversationLeadership?.plan?.structureLine && !thoughtfulness?.plan?.structureLine && !deepThinking?.plan?.structureLine && !presence?.plan?.structureLine && !wisdom?.plan?.structureLine && !conversationTaste?.plan?.structureLine && !conversationMemoryFlow?.plan?.structureLine && !selfReflection?.plan?.structureLine && !socialConversation?.plan?.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intent',
          slot: 'structure',
          structure: [
            ci.structureLine,
            'Rispondi all’intenzione dietro le parole — non solo al letterale',
            'Osservazioni > domande; continua se vivo; niente interviste',
            inf.opennessToContinue === 'closed'
              ? 'Openness chiusa: battito breve, zero domande'
              : inf.expects === 'presence'
                ? 'Expects presenza: riconosci prima di risolvere'
                : `Expects=${inf.expects || 'mixed'}`,
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: ci.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.conversation_intent - 0.15,
          reasons: ['conversation_intent_structure'],
        }),
      )
    }
  }

  // --- Conversation Leadership (after Intent: which move guides this turn) ---
  if (conversationLeadership?.plan?.active && conversationLeadership.plan.writerBrief) {
    const cl = conversationLeadership.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_leadership',
        slot: 'directive',
        text: cl.writerBrief,
        confidence: cl.confidence === 'high' ? 0.94 : cl.confidence === 'medium' ? 0.85 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.conversation_leadership,
        reasons: [`lead_${cl.move}`, cl.preserveMomentum ? 'preserve_momentum' : 'no_force'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_leadership',
        slot: 'style',
        text: cl.writerBrief,
        confidence: cl.confidence === 'high' ? 0.9 : 0.78,
        baseValue: ADVISOR_BASE_VALUE.conversation_leadership - 0.05,
        reasons: [`move_${cl.move}`, ...(cl.signals || []).slice(0, 3)],
      }),
    )
    if (cl.structureLine) {
      const leadStructure = [
        cl.structureLine,
        'Partner che guida: non attendere istruzioni, non chiedere permesso',
        cl.allowQuestion
          ? 'Domanda solo se migliora davvero il dialogo'
          : 'Niente domande di routine / intervista',
        cl.preserveMomentum
          ? 'Preserva momentum — niente “Let me know… / If you want…”'
          : 'Mossa secca di valore',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
      // Opening wins early for direction/close/momentum; always also claim structure.
      if (
        cl.move === 'choose_direction' ||
        cl.move === 'close_warmly' ||
        cl.preserveMomentum
      ) {
        out.push(
          makeSuggestion({
            advisor: 'conversation_leadership',
            slot: 'opening',
            structure: leadStructure,
            text: cl.writerBrief,
            confidence: 0.93,
            baseValue: ADVISOR_BASE_VALUE.conversation_leadership + 0.2,
            reasons: [`lead_opening_${cl.move}`],
          }),
        )
      }
      out.push(
        makeSuggestion({
          advisor: 'conversation_leadership',
          slot: 'structure',
          structure: leadStructure,
          text: cl.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.conversation_leadership + 0.15,
          reasons: ['conversation_leadership_structure'],
        }),
      )
    }
  }

  // --- Thoughtfulness Engine (after Leadership, before Deep Thinking: best conversational contribution) ---
  if (thoughtfulness?.plan?.active && thoughtfulness.plan.writerBrief) {
    const th = thoughtfulness.plan
    out.push(
      makeSuggestion({
        advisor: 'thoughtfulness',
        slot: 'directive',
        text: th.writerBrief,
        confidence: th.confidence === 'high' ? 0.93 : th.confidence === 'medium' ? 0.84 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.thoughtfulness,
        reasons: [`contrib_${th.contribution}`, th.avoidEncyclopedia ? 'anti_encyclopedia' : 'summary_ok'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'thoughtfulness',
        slot: 'style',
        text: th.writerBrief,
        confidence: th.confidence === 'high' ? 0.9 : 0.76,
        baseValue: ADVISOR_BASE_VALUE.thoughtfulness - 0.05,
        reasons: [`kind_${th.contribution}`, ...(th.signals || []).slice(0, 3)],
      }),
    )
    if (th.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'thoughtfulness',
          slot: 'structure',
          structure: [
            th.structureLine,
            'Non la prima risposta corretta — il contributo a maggior valore conversazionale',
            'Memorabile > generico · significativo > esaustivo · elegante > lungo',
            th.avoidEncyclopedia
              ? 'Evita sunti da enciclopedia salvo richiesta esplicita'
              : 'Overview ok se richiesto',
            th.contribution === 'none'
              ? 'Thoughtfulness = trattenersi (presenza/sostanza secca)'
              : `Porta ${th.contribution} come cuore del contributo, non add-on in coda`,
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: th.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.thoughtfulness + 0.12,
          reasons: ['thoughtfulness_structure'],
        }),
      )
    }
  }

  // --- Deep Thinking Engine (after Thoughtfulness, before Writer: explore directions) ---
  if (deepThinking?.plan?.active && deepThinking.plan.writerBrief) {
    const dt = deepThinking.plan
    out.push(
      makeSuggestion({
        advisor: 'deep_thinking',
        slot: 'directive',
        text: dt.writerBrief,
        confidence: dt.confidence === 'high' ? 0.93 : dt.confidence === 'medium' ? 0.84 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.deep_thinking,
        reasons: [`dir_${dt.direction}`, dt.passesHumanCheck ? 'human_ok' : 'human_refine'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'deep_thinking',
        slot: 'style',
        text: dt.writerBrief,
        confidence: dt.confidence === 'high' ? 0.9 : 0.76,
        baseValue: ADVISOR_BASE_VALUE.deep_thinking - 0.05,
        reasons: [`kind_${dt.direction}`, ...(dt.signals || []).slice(0, 3)],
      }),
    )
    if (dt.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'deep_thinking',
          slot: 'structure',
          structure: [
            dt.structureLine,
            'Non la prima risposta corretta — esplora direzioni, scegli valore conversazionale',
            'Would a thoughtful human say this? Se no, raffina',
            'Preferisci osservazioni / spiegazioni eleganti / confronti / esempi / storie / insight',
            'Evita filler, enciclopedia, domande inutili, transizioni robotiche',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: dt.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.deep_thinking + 0.12,
          reasons: ['deep_thinking_structure'],
        }),
      )
    }
  }

  // --- Presence Engine (after Deep Thinking: organic aliveness / style / ending) ---
  if (presence?.plan?.active && presence.plan.writerBrief) {
    const pr = presence.plan
    out.push(
      makeSuggestion({
        advisor: 'presence',
        slot: 'directive',
        text: pr.writerBrief,
        confidence: pr.confidence === 'high' ? 0.93 : pr.confidence === 'medium' ? 0.84 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.presence,
        reasons: [`need_${pr.need}`, `style_${pr.style}`, `end_${pr.ending}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'presence',
        slot: 'style',
        text: pr.writerBrief,
        confidence: pr.confidence === 'high' ? 0.91 : 0.78,
        baseValue: ADVISOR_BASE_VALUE.presence - 0.04,
        reasons: [`presence_${pr.style}`, ...(pr.signals || []).slice(0, 3)],
      }),
    )
    if (pr.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'presence',
          slot: 'structure',
          structure: [
            pr.structureLine,
            'Conversazione viva, non macchina Q&A',
            pr.avoidQuestionEnding
              ? 'Chiudi con osservazione/immagine/riflessione/frase memorabile — non domanda'
              : 'Domanda solo se migliora davvero il filo',
            pr.preferBrevity ? 'Brevità/silenzio > informazione extra' : 'Presenza organica',
            '«Does this feel like spending time with someone interesting?»',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: pr.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.presence + 0.12,
          reasons: ['presence_structure'],
        }),
      )
    }
  }

  // --- Wisdom Engine (after Presence: useful / appropriate / meaningful) ---
  if (wisdom?.plan?.active && wisdom.plan.writerBrief) {
    const w = wisdom.plan
    out.push(
      makeSuggestion({
        advisor: 'wisdom',
        slot: 'directive',
        text: w.writerBrief,
        confidence: w.confidence === 'high' ? 0.93 : w.confidence === 'medium' ? 0.84 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.wisdom,
        reasons: [`stance_${w.stance}`, `info_${w.checks?.informationAmount || 'right'}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'wisdom',
        slot: 'style',
        text: w.writerBrief,
        confidence: w.confidence === 'high' ? 0.9 : 0.76,
        baseValue: ADVISOR_BASE_VALUE.wisdom - 0.04,
        reasons: [`wisdom_${w.stance}`, ...(w.signals || []).slice(0, 3)],
      }),
    )
    if (w.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'wisdom',
          slot: 'structure',
          structure: [
            w.structureLine,
            'Saggezza > verbosità — utile, appropriato, significativo per questa chat',
            w.checks?.informationAmount === 'too_much'
              ? 'Taglia informazione non essenziale'
              : 'Solo pezzi ad alto leva',
            w.checks?.preferSimpler
              ? 'Spiega nel modo più semplice onesto'
              : 'Profondità senza sfoggio',
            'Valore a 5 minuti > immediatezza verbosa · mentore, non motivational poster',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: w.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.wisdom + 0.12,
          reasons: ['wisdom_structure'],
        }),
      )
    }
  }

  // --- Conversation Taste (after Wisdom: beautiful / enjoyable to read) ---
  if (conversationTaste?.plan?.active && conversationTaste.plan.writerBrief) {
    const ct = conversationTaste.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_taste',
        slot: 'directive',
        text: ct.writerBrief,
        confidence: ct.confidence === 'high' ? 0.93 : ct.confidence === 'medium' ? 0.84 : 0.7,
        baseValue: ADVISOR_BASE_VALUE.conversation_taste,
        reasons: [`stance_${ct.stance}`, ct.checks?.repetitive ? 'break_rep' : 'keep_fresh'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_taste',
        slot: 'style',
        text: ct.writerBrief,
        confidence: ct.confidence === 'high' ? 0.91 : 0.78,
        baseValue: ADVISOR_BASE_VALUE.conversation_taste - 0.03,
        reasons: [`taste_${ct.stance}`, ...(ct.signals || []).slice(0, 3)],
      }),
    )
    if (ct.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_taste',
          slot: 'structure',
          structure: [
            ct.structureLine,
            'Piacevole da leggere — non solo informativo',
            ct.checks?.repetitive
              ? 'Spezza aperture / ack / domande / chiusure ripetitive'
              : 'Mantieni varietà di ritmo e phrasing',
            'Ritmo · transizioni eleganti · pause naturali · frase memorabile',
            'Interesting? Elegant? Alive? Thoughtful?',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: ct.writerBrief,
          confidence: 0.9,
          baseValue: ADVISOR_BASE_VALUE.conversation_taste + 0.12,
          reasons: ['conversation_taste_structure'],
        }),
      )
    }
  }

  // --- Conversation Memory Flow (spontaneous weave — never dump) ---
  if (conversationMemoryFlow?.plan?.active && conversationMemoryFlow.plan.writerBrief) {
    const mf = conversationMemoryFlow.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_memory_flow',
        slot: 'directive',
        text: mf.writerBrief,
        confidence: mf.confidence === 'high' ? 0.92 : mf.confidence === 'medium' ? 0.82 : 0.65,
        baseValue: ADVISOR_BASE_VALUE.conversation_memory_flow + (mf.shouldWeave ? 0.15 : -0.2),
        reasons: [`move_${mf.move}`, mf.shouldWeave ? 'weave' : 'silence'],
      }),
    )
    if (mf.shouldWeave && mf.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_memory_flow',
          slot: 'style',
          text: mf.writerBrief,
          confidence: 0.85,
          baseValue: ADVISOR_BASE_VALUE.conversation_memory_flow,
          reasons: [`kind_${mf.chosen?.kind || 'thread'}`, ...(mf.signals || []).slice(0, 2)],
        }),
      )
      out.push(
        makeSuggestion({
          advisor: 'conversation_memory_flow',
          slot: 'structure',
          structure: [
            mf.structureLine,
            mf.chosen ? `Tessi «${mf.chosen.thread.slice(0, 56)}» in modo spontaneo` : 'Tessitura soft',
            'Un solo ponte naturale — mai dump di memorie',
            'Mai “As you said three weeks ago…” / log meccanici',
            'Feel: paying attention, not retrieving records',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: mf.writerBrief,
          confidence: 0.88,
          baseValue: ADVISOR_BASE_VALUE.conversation_memory_flow + 0.1,
          reasons: ['conversation_memory_flow_structure'],
        }),
      )
    }
  }

  // --- Self Reflection Engine (silent quality checklist — max one refine) ---
  if (selfReflection?.plan?.active && selfReflection.plan.writerBrief) {
    const sr = selfReflection.plan
    out.push(
      makeSuggestion({
        advisor: 'self_reflection',
        slot: 'directive',
        text: sr.writerBrief,
        confidence: sr.confidence === 'high' ? 0.9 : sr.confidence === 'medium' ? 0.8 : 0.65,
        baseValue: ADVISOR_BASE_VALUE.self_reflection,
        reasons: ['self_reflection_checklist', ...(sr.signals || []).slice(0, 2)],
      }),
    )
    if (sr.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'self_reflection',
          slot: 'structure',
          structure: [
            sr.structureLine,
            'Qualità conversazionale > lunghezza',
            'Max 1 refine se un check è “no” — mai loop',
            'Non esporre il processo di riflessione',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: sr.writerBrief,
          confidence: 0.88,
          baseValue: ADVISOR_BASE_VALUE.self_reflection + 0.08,
          reasons: ['self_reflection_structure'],
        }),
      )
    }
  }

  // --- Information Value Estimator (prefer few high-value pieces) ---
  if (plan?.infoValue?.writerBrief && Array.isArray(plan.infoValue.kept) && plan.infoValue.kept.length > 0) {
    const iv = plan.infoValue
    out.push(
      makeSuggestion({
        advisor: 'information_value',
        slot: 'directive',
        text: iv.writerBrief,
        confidence: 0.75,
        baseValue: ADVISOR_BASE_VALUE.information_value,
        reasons: [`info_value_kept_${iv.kept.length}`, ...(iv.reasons || []).slice(0, 2)],
      }),
    )
    // Soft structure nudge: only high-value pieces in the body
    out.push(
      makeSuggestion({
        advisor: 'information_value',
        slot: 'structure',
        structure: [
          `Includi solo pezzi ad alto valore: ${iv.kept.map((c) => c.kind).join(', ')}`,
          'Scarta padding / ripetizioni / chiusure generiche — preferisci poche idee forti',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: iv.writerBrief,
        confidence: 0.7,
        baseValue: ADVISOR_BASE_VALUE.information_value,
        reasons: ['info_value_structure'],
      }),
    )
  }

  // --- Topic Leadership Engine (Never Give Control Back) ---
  if (topicLeadership?.plan?.shouldLead && topicLeadership.plan.chosen && topicLeadership.plan.writerBrief) {
    const tl = topicLeadership.plan
    const pick = tl.chosen
    // Opening: prefer Conversation Spark when active (human spark > topic menu tone).
    if (!(conversationSpark?.plan?.shouldSpark && conversationSpark.plan.writerBrief)) {
      out.push(
        makeSuggestion({
          advisor: 'topic_leadership',
          slot: 'opening',
          structure: [
            `Never Give Control Back: UNA direzione «${pick.title}» — commit e sviluppa`,
            `Perché (breve): ${pick.why}`,
            `Insight + sviluppo — niente domande di scelta, niente liste`,
            'Vietato: far riscegliere; “di cosa vuoi parlare?”; “preferisci…?”; opzioni A/B/C',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: tl.writerBrief,
          confidence: tl.confidence === 'high' ? 0.93 : 0.82,
          baseValue: ADVISOR_BASE_VALUE.topic_leadership,
          reasons: [`topic_${pick.id}`, 'never_give_control_back', ...(tl.reasons || []).slice(0, 2)],
        }),
      )
    }
    out.push(
      makeSuggestion({
        advisor: 'topic_leadership',
        slot: 'directive',
        text: tl.writerBrief,
        confidence: tl.confidence === 'high' ? 0.93 : 0.82,
        baseValue: ADVISOR_BASE_VALUE.topic_leadership,
        reasons: ['topic_leadership_brief', 'never_give_control_back'],
      }),
    )
  }

  // --- Conversation Spark Engine (natural initiative — never AI looking for a topic) ---
  if (conversationSpark?.plan?.shouldSpark && conversationSpark.plan.writerBrief) {
    const sp = conversationSpark.plan
    const spark = sp.chosen
    out.push(
      makeSuggestion({
        advisor: 'conversation_spark',
        slot: 'opening',
        structure: [
          sp.structureLine || `Conversation Spark → ${sp.category}: «${sp.opener}»`,
          'Apri come persona curiosamente viva — non come AI in cerca di un tema',
          'Condividi UNA scintilla; crea conversazione, non chiederla',
          'Vietato: Let’s discuss / What would you like to talk about / Choose a topic / Have you encountered any interesting topics',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: sp.writerBrief,
        confidence: sp.confidence === 'high' ? 0.94 : 0.84,
        baseValue: ADVISOR_BASE_VALUE.conversation_spark,
        reasons: [
          `spark_${spark?.id || 'x'}`,
          `cat_${sp.category}`,
          `trigger_${sp.trigger}`,
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_spark',
        slot: 'directive',
        text: sp.writerBrief,
        confidence: sp.confidence === 'high' ? 0.93 : 0.82,
        baseValue: ADVISOR_BASE_VALUE.conversation_spark,
        reasons: ['conversation_spark_brief', `trigger_${sp.trigger}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_spark',
        slot: 'style',
        text: sp.writerBrief,
        confidence: 0.88,
        baseValue: ADVISOR_BASE_VALUE.conversation_spark - 0.05,
        reasons: ['spark_style', ...(sp.signals || []).slice(0, 2)],
      }),
    )
  }

  // --- Universal Device Manager (capability-first device control) ---
  if (deviceManager?.plan?.active && deviceManager.plan.topMatch && deviceManager.plan.writerBrief) {
    const dm = deviceManager.plan
    const match = dm.topMatch
    out.push(
      makeSuggestion({
        advisor: 'device_manager',
        slot: 'directive',
        text: dm.writerBrief,
        confidence: match.score >= 0.75 ? 0.85 : 0.65,
        baseValue: ADVISOR_BASE_VALUE.device_manager + Math.min(1, (match.score - 0.58) * 2),
        reasons: [`device_${match.device.type}`, `cap_${match.capability}`],
      }),
    )
    if (dm.shouldAct) {
      out.push(
        makeSuggestion({
          advisor: 'device_manager',
          slot: 'structure',
          structure: [
            `Dispositivo: ${match.device.name} (tipo ${match.device.type})`,
            `Capability: ${match.capability} — ${match.actionSummary}`,
            dm.stats.connected > 0
              ? 'Esegui tramite adapter se connesso; verifica esito'
              : 'Adapter non connesso: spiega il limite, non fingere successo',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: dm.writerBrief,
          confidence: match.score,
          baseValue: ADVISOR_BASE_VALUE.device_manager,
          reasons: ['device_structure'],
        }),
      )
    }
  }

  // --- Natural Language Automation Builder (owns structure when drafting/confirming) ---
  if (automationBuilder?.plan?.active && automationBuilder.plan.writerBrief) {
    const ab = automationBuilder.plan
    out.push(
      makeSuggestion({
        advisor: 'automation_builder',
        slot: 'structure',
        structure: [
          ...(ab.structureHints || []),
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: ab.writerBrief,
        confidence: ab.confidence || 0.85,
        baseValue: ADVISOR_BASE_VALUE.automation_builder,
        reasons: [`automation_${ab.phase}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'automation_builder',
        slot: 'directive',
        text: ab.writerBrief,
        confidence: ab.confidence || 0.85,
        baseValue: ADVISOR_BASE_VALUE.automation_builder,
        reasons: ['automation_brief'],
      }),
    )
  }

  // --- Knowledge Level Estimator (terminology / depth / pacing) ---
  if (knowledge?.plan?.active && knowledge.plan.writerBrief) {
    out.push(
      makeSuggestion({
        advisor: 'knowledge_level',
        slot: 'directive',
        text: knowledge.plan.writerBrief,
        confidence: knowledge.plan.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.knowledge_level,
        reasons: [
          `level_${knowledge.plan.level}`,
          ...(knowledge.plan.reasons || []).slice(0, 3),
        ],
      }),
    )
    if (knowledge.plan.adjustments) {
      const adj = knowledge.plan.adjustments
      out.push(
        makeSuggestion({
          advisor: 'knowledge_level',
          slot: 'style',
          text: `Calibra sul livello ${knowledge.plan.level}: terminology=${adj.terminology}, examples=${adj.examples}, depth=${adj.depth}, pacing=${adj.pacing}. Evita oversimplifying e overwhelm.`,
          confidence: knowledge.plan.confidence || 0.7,
          baseValue: ADVISOR_BASE_VALUE.knowledge_level,
          reasons: ['knowledge_adjustments'],
        }),
      )
    }
  }

  // --- Intellectual Honesty (epistemic ceiling — style + directive) ---
  if (honesty?.plan?.active && honesty.plan.writerBrief) {
    const h = honesty.plan
    out.push(
      makeSuggestion({
        advisor: 'intellectual_honesty',
        slot: 'directive',
        text: h.writerBrief,
        confidence: h.confidence || 0.75,
        baseValue:
          ADVISOR_BASE_VALUE.intellectual_honesty +
          (h.toolEvidence === 'strong' ? 0.3 : h.toolEvidence === 'none' ? 0.15 : 0),
        reasons: [
          `ceiling_${h.ceiling}`,
          `stance_${h.dominantStance}`,
          ...(h.reasons || []).slice(0, 3),
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'intellectual_honesty',
        slot: 'style',
        text: `Onestà intellettuale: ceiling=${h.ceiling}. Allinea certezza all’evidenza; mai speculazione come fatto; dichiara l’incertezza in modo naturale.`,
        structure: [
          `Epistemic ceiling: ${h.ceiling} (non superare)`,
          `Stance dominante: ${h.dominantStance}`,
          'Classifica ogni claim: fatto / evidenza forte / inferenza / speculazione / opinione',
        ],
        confidence: h.confidence || 0.75,
        baseValue: ADVISOR_BASE_VALUE.intellectual_honesty,
        reasons: ['honesty_style_ladder'],
      }),
    )
  } else if (honesty?.plan?.writerBrief && !honesty.plan.active) {
    out.push(
      makeSuggestion({
        advisor: 'intellectual_honesty',
        slot: 'directive',
        text: honesty.plan.writerBrief,
        confidence: 0.4,
        baseValue: 3,
        reasons: ['honesty_social_skip'],
      }),
    )
  }

  // --- Adaptive Self-Awareness (meta-feedback about the assistant) ---
  if (feedbackInterpretation?.plan?.active && feedbackInterpretation.plan.writerBrief) {
    const fb = feedbackInterpretation.plan
    out.push(
      makeSuggestion({
        advisor: 'feedback_interpretation',
        slot: 'directive',
        text: fb.writerBrief,
        confidence: fb.confidence || 0.8,
        baseValue:
          ADVISOR_BASE_VALUE.feedback_interpretation +
          (fb.confidence === 'high' ? 0.25 : 0),
        reasons: [
          `feedback_${fb.kind}`,
          'pause_topic',
          ...(fb.signals || []).slice(0, 3),
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'feedback_interpretation',
        slot: 'style',
        text: `Adaptive Self-Awareness: adatta subito (${fb.kind}). NON continuare il topic precedente; ack naturale + breve riflessione; niente tono difensivo; non menzionare il Conversation Preference Profile.`,
        structure: fb.structureLine
          ? [
              fb.structureLine,
              'Ack + reflect + adapt — stop. Non riprendere il topic.',
              'Tono: leggero e sicuro, mai scuse lunghe o “I understand. [topic]…”',
            ]
          : undefined,
        confidence: fb.confidence || 0.8,
        baseValue: ADVISOR_BASE_VALUE.feedback_interpretation,
        reasons: ['self_awareness_adapt'],
      }),
    )
    // Structure ownership even when continueTopic is false — keep the reply on feedback only.
    if (fb.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'feedback_interpretation',
          slot: 'structure',
          structure: [
            fb.structureLine,
            '1) Ack naturale  2) Breve riflessione  3) Impegno di adattamento — fine',
            'Vietato: riprendere il topic; difendersi; scusarsi a lungo; menzionare il profilo',
            `Obiettivo reale da servire: riconoscere il feedback e adattarsi`,
          ],
          text: fb.writerBrief,
          confidence: fb.confidence || 0.8,
          baseValue: ADVISOR_BASE_VALUE.feedback_interpretation,
          reasons: [`self_awareness_structure_${fb.kind}`],
        }),
      )
    }
  } else if (
    feedbackInterpretation?.plan?.profileActive &&
    feedbackInterpretation.plan.writerBrief
  ) {
    // Sticky Conversation Preference Profile — soft style only, no turn ownership.
    out.push(
      makeSuggestion({
        advisor: 'feedback_interpretation',
        slot: 'style',
        text: feedbackInterpretation.plan.writerBrief,
        confidence: 0.55,
        baseValue: 6.2,
        reasons: ['preference_profile_sticky'],
      }),
    )
  }

  // --- Warm Conversation (enjoy chat; anti-transactional) ---
  if (warmConversation?.plan?.active && warmConversation.plan.writerBrief) {
    const wc = warmConversation.plan
    const welcomeOwns = Boolean(welcome?.plan?.active)
    const continuationOwnsOpening = Boolean(
      continuation?.plan?.isShortMessage && continuation?.plan?.shouldContinue,
    )

    out.push(
      makeSuggestion({
        advisor: 'warm_conversation',
        slot: 'style',
        text: wc.writerBrief,
        confidence: wc.confidence === 'high' ? 0.9 : wc.confidence === 'medium' ? 0.78 : 0.62,
        baseValue:
          ADVISOR_BASE_VALUE.warm_conversation +
          (wc.confidence === 'high' ? 0.2 : 0) +
          (wc.trigger === 'greeting' || wc.trigger === 'casual_start' ? 0.15 : 0),
        reasons: [`warm_${wc.trigger}`, ...(wc.signals || []).slice(0, 3)],
      }),
    )

    out.push(
      makeSuggestion({
        advisor: 'warm_conversation',
        slot: 'directive',
        text: wc.writerBrief,
        confidence: wc.confidence === 'high' ? 0.88 : 0.75,
        baseValue: ADVISOR_BASE_VALUE.warm_conversation,
        reasons: ['warm_conversation_brief'],
      }),
    )

    if (wc.ownsOpening && !wc.softStyleOnly && !welcomeOwns && !continuationOwnsOpening) {
      out.push(
        makeSuggestion({
          advisor: 'warm_conversation',
          slot: 'opening',
          structure: [
            wc.structureLine || 'Warm Conversation: partner — calore + idea, non helpdesk',
            'Vietato: aperture da sportello (Dimmi pure / Come posso aiutarti / Hai domande / Fammi sapere).',
            'Preferisci: osservazioni, idee, curiosità, storie, insight, fatti sorprendenti, collegamenti',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: wc.writerBrief,
          confidence: wc.confidence === 'high' ? 0.88 : 0.75,
          baseValue: ADVISOR_BASE_VALUE.warm_conversation,
          reasons: [`warm_opening_${wc.trigger}`],
        }),
      )
    } else if (wc.structureLine && !welcomeOwns) {
      out.push(
        makeSuggestion({
          advisor: 'warm_conversation',
          slot: 'structure',
          structure: [
            wc.structureLine,
            'Transizioni naturali; tono di chi pensa volentieri insieme',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: wc.writerBrief,
          confidence: 0.7,
          baseValue: ADVISOR_BASE_VALUE.warm_conversation - 0.4,
          reasons: [`warm_structure_${wc.trigger}`],
        }),
      )
    }
  }

  // --- Conversation Mindset (contribute; enjoyable evolving dialogue) ---
  if (conversationMindset?.plan?.active && conversationMindset.plan.writerBrief) {
    const cm = conversationMindset.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_mindset',
        slot: 'style',
        text: cm.writerBrief,
        confidence: cm.confidence === 'high' ? 0.9 : cm.confidence === 'medium' ? 0.78 : 0.62,
        baseValue:
          ADVISOR_BASE_VALUE.conversation_mindset +
          (cm.confidence === 'high' ? 0.15 : 0) +
          (cm.emotionFirst || cm.deepenIdea ? 0.1 : 0),
        reasons: [`mindset_${cm.mode}`, ...(cm.signals || []).slice(0, 3)],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_mindset',
        slot: 'directive',
        text: cm.writerBrief,
        confidence: cm.confidence === 'high' ? 0.88 : 0.75,
        baseValue: ADVISOR_BASE_VALUE.conversation_mindset,
        reasons: ['conversation_mindset_brief'],
      }),
    )
    const modeLine =
      cm.mode === 'listen'
        ? 'Mindset listen: emozione prima — riconosci, non risolvere/interrogare subito'
        : cm.mode === 'deepen'
          ? 'Mindset deepen: uno strato di insight sulla stessa idea — non più parole'
          : cm.mode === 'lead'
            ? 'Mindset lead: UNA direzione, commit, sviluppa — niente liste'
            : cm.mode === 'journey'
              ? 'Mindset journey: continua il viaggio — contribuisci sul filo esistente'
              : 'Mindset contribute: aggiungi idea/collegamento/osservazione/insight'
    out.push(
      makeSuggestion({
        advisor: 'conversation_mindset',
        slot: 'structure',
        structure: [
          modeLine,
          'Ogni risposta rende la conversazione migliore di un messaggio fa',
          cm.emotionFirst
            ? 'Presenza: rispondi all’emozione prima dell’informazione'
            : 'Curiosità sulle idee: sviluppa, collega, esplora',
          'Self-review: vivo? valore? un insight al posto di tre frasi?',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: cm.writerBrief,
        confidence: 0.74,
        baseValue: ADVISOR_BASE_VALUE.conversation_mindset - 0.2,
        reasons: [`mindset_structure_${cm.mode}`],
      }),
    )
  }

  // --- Conversation Delight (enjoyable to read; create conversation, not flat answers) ---
  if (conversationDelight?.plan?.active && conversationDelight.plan.writerBrief) {
    const cd = conversationDelight.plan
    out.push(
      makeSuggestion({
        advisor: 'conversation_delight',
        slot: 'style',
        text: cd.writerBrief,
        confidence: cd.confidence === 'high' ? 0.9 : cd.confidence === 'medium' ? 0.78 : 0.62,
        baseValue:
          ADVISOR_BASE_VALUE.conversation_delight +
          (cd.confidence === 'high' ? 0.15 : 0) +
          (cd.favorSurprise || cd.favorSmile ? 0.1 : 0),
        reasons: [`delight_${cd.confidence}`, ...(cd.signals || []).slice(0, 3)],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversation_delight',
        slot: 'directive',
        text: cd.writerBrief,
        confidence: cd.confidence === 'high' ? 0.88 : 0.75,
        baseValue: ADVISOR_BASE_VALUE.conversation_delight,
        reasons: ['conversation_delight_brief'],
      }),
    )
    if (cd.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_delight',
          slot: 'structure',
          structure: [
            cd.structureLine,
            'Piacevole da leggere > corretto ma piatto',
            cd.softToneOnly
              ? 'Calore quieto — niente wit forzato'
              : 'Osservazione/insight prima delle domande; una piccola sorpresa se calza',
            'Vietato: “Let me know…”, “If you have any questions…”, “Feel free…”, chiusure helpdesk',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: cd.writerBrief,
          confidence: 0.72,
          baseValue: ADVISOR_BASE_VALUE.conversation_delight - 0.2,
          reasons: ['delight_structure'],
        }),
      )
    }
  }

  // --- Conversational Presence (feel present; engage meaning; no restart/interview default) ---
  if (conversationalPresence?.plan?.active && conversationalPresence.plan.writerBrief) {
    const cp = conversationalPresence.plan
    out.push(
      makeSuggestion({
        advisor: 'conversational_presence',
        slot: 'style',
        text: cp.writerBrief,
        confidence: cp.confidence === 'high' ? 0.88 : cp.confidence === 'medium' ? 0.76 : 0.6,
        baseValue:
          ADVISOR_BASE_VALUE.conversational_presence +
          (cp.confidence === 'high' ? 0.15 : 0) +
          (cp.restartRisk || cp.interviewRisk ? 0.1 : 0),
        reasons: [`presence_${cp.mode}`, ...(cp.signals || []).slice(0, 3)],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversational_presence',
        slot: 'directive',
        text: cp.writerBrief,
        confidence: cp.confidence === 'high' ? 0.86 : 0.74,
        baseValue: ADVISOR_BASE_VALUE.conversational_presence,
        reasons: ['conversational_presence_brief'],
      }),
    )
    if (cp.restartRisk || cp.interviewRisk || cp.preferSharedThought) {
      const modeLine =
        cp.mode === 'listen'
          ? 'Presence listen: riconoscimento emotivo + presenza — niente intervista'
          : cp.mode === 'react'
            ? 'Presence react: reagisci, poi sviluppa lo stesso filo'
            : cp.mode === 'shared_thread'
              ? 'Presence shared_thread: continua il pensiero condiviso — non ripartire'
              : cp.mode === 'substance'
                ? 'Presence substance: servi la richiesta con presenza, senza frasi da sportello'
                : 'Presence engage: osservazione o idea viva — non helpdesk'
      out.push(
        makeSuggestion({
          advisor: 'conversational_presence',
          slot: 'structure',
          structure: [
            modeLine,
            cp.preferReaction
              ? 'Includi una reazione/osservazione genuina (non formula)'
              : 'Ragionamento condiviso o transizione ponderata',
            cp.interviewRisk
              ? 'Domande solo se utili al filo — mai perché sono facili'
              : 'Evita frasi generiche da assistente',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: cp.writerBrief,
          confidence: 0.72,
          baseValue: ADVISOR_BASE_VALUE.conversational_presence - 0.25,
          reasons: [`presence_structure_${cp.mode}`],
        }),
      )
    }
  }

  // --- Question Economy (continue-first; scarce questions) ---
  if (questionEconomy?.plan?.active && questionEconomy.plan.writerBrief) {
    const qe = questionEconomy.plan
    out.push(
      makeSuggestion({
        advisor: 'question_economy',
        slot: 'style',
        text: qe.writerBrief,
        confidence: qe.confidence === 'high' ? 0.9 : 0.78,
        baseValue:
          ADVISOR_BASE_VALUE.question_economy +
          (qe.consecutiveRisk ? 0.35 : 0) +
          (qe.preferContinue && !qe.allowQuestion ? 0.2 : 0),
        reasons: ['question_economy', ...(qe.signals || []).slice(0, 3)],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'question_economy',
        slot: 'directive',
        text: qe.writerBrief,
        confidence: qe.confidence === 'high' ? 0.88 : 0.75,
        baseValue: ADVISOR_BASE_VALUE.question_economy,
        reasons: ['question_economy_brief'],
      }),
    )
    if (qe.preferContinue && !qe.allowQuestion) {
      const stanceLine =
        qe.stance === 'explain'
          ? 'Stance: l’utente sta pensando → spiega/approfondisci, non interrogare'
          : qe.stance === 'listen'
            ? 'Stance: tono emotivo → ascolta e rifletti, non fare domande'
            : qe.stance === 'continue'
              ? 'Stance: entusiasmo → continua lo stesso filo (Build Ideas), zero domanda'
              : 'Domande = strumenti, non finali di frase — default zero domande di chiusura'
      out.push(
        makeSuggestion({
          advisor: 'question_economy',
          slot: 'structure',
          structure: [
            'Question Economy: continua l’idea — insight/storia/collegamento/sorpresa',
            `Cadenza: ~1 domanda ogni 3–5 risposte (ora: ${qe.repliesSinceQuestion ?? 0} dall’ultima)`,
            stanceLine,
            qe.consecutiveRisk
              ? 'L’ultimo turno chiudeva con una domanda — NON chiudere con un’altra'
              : qe.underCadence
                ? 'Sotto cadenza: default zero domande di chiusura'
                : 'Chiedi solo se muove davvero il filo; altrimenti zero domande',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: qe.writerBrief,
          confidence: 0.8,
          baseValue: ADVISOR_BASE_VALUE.question_economy,
          reasons: ['question_economy_continue_first'],
        }),
      )
    }
  }

  // --- Welcome Experience Engine (opening ownership when active) ---
  if (
    welcome?.plan?.active &&
    welcome.plan.writerBrief &&
    !topicLeadership?.plan?.shouldLead
  ) {
    const strategy = welcome.plan.strategy || 'warm_only'
    /** @type {string[]} */
    let structure = []
    if (welcome.plan.mode === 'warm_handoff' || strategy === 'warm_handoff') {
      structure = [
        `Warm handoff breve (seed): ${welcome.plan.greetingSeed}`,
        'Poi servi subito la richiesta dell’utente',
        'Niente digressioni da progetto se distrae',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else if (strategy === 'warm_only') {
      structure = [
        `Saluto caldo unico (seed): ${welcome.plan.greetingSeed}`,
        'Partner di conversazione: se il filo è vuoto, apri con osservazione/idea/curiosità/insight — non un’intervista',
        'Vietato: aperture da sportello (Dimmi pure / Come posso aiutarti / Hai domande / Fammi sapere).',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else {
      structure = [
        `Apertura (${strategy}) seed: ${welcome.plan.greetingSeed}`,
        welcome.plan.memory
          ? `Al massimo UN contesto: ${welcome.plan.memory.kind} «${welcome.plan.memory.label}»`
          : 'Niente lista memorie',
        welcome.plan.nextStep
          ? `Un solo next step proposto da te: ${welcome.plan.nextStep}`
          : 'Se manca un filo: porta UNA idea — non chiedere la priorità',
        'Partner di conversazione — varietà, niente script da interview',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    }
    out.push(
      makeSuggestion({
        advisor: 'welcome',
        slot: 'opening',
        structure,
        text: welcome.plan.writerBrief,
        confidence: 0.92,
        baseValue: ADVISOR_BASE_VALUE.welcome,
        reasons: [`welcome_${strategy}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'welcome',
        slot: 'directive',
        text: welcome.plan.writerBrief,
        confidence: 0.92,
        reasons: ['welcome_brief'],
      }),
    )
  }

  // --- Life Intelligence Engine (multi-source proactive tip — coda, high bar) ---
  if (life?.plan?.shouldSuggest && life.plan.chosen && life.plan.writerBrief) {
    const rec = life.plan.chosen
    out.push(
      makeSuggestion({
        advisor: 'life_intelligence',
        slot: 'coda',
        text: life.plan.writerBrief,
        structure: [
          `Dopo la risposta: UNA raccomandazione di vita concisa (${rec.kind}) — ${rec.title}`,
        ],
        confidence: life.plan.confidence || 0.7,
        baseValue:
          ADVISOR_BASE_VALUE.life_intelligence +
          Math.min(1.5, (rec.valueScore - 6.4) * 0.4) +
          (rec.urgency === 'high' ? 0.6 : 0),
        reasons: [`life_${rec.id}`, `sources_${rec.sources.join('+')}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'life_intelligence',
        slot: 'directive',
        text: life.plan.writerBrief,
        confidence: life.plan.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.life_intelligence,
        reasons: ['life_brief'],
      }),
    )
  }

  // --- Core / progressive / adaptive / teacher (from base plan) ---
  if (plan?.progressive?.enabled && plan.progressive.structureHints?.length) {
    out.push(
      makeSuggestion({
        advisor: 'progressive_reasoning',
        slot: 'structure',
        structure: [
          ...plan.progressive.structureHints.filter((h) => !/^Ragionamento progressivo/i.test(h)),
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: plan.progressive.writerBrief || '',
        confidence: plan.progressive.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.progressive_reasoning,
        reasons: ['progressive_plan'],
      }),
    )
    if (plan.progressive.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'progressive_reasoning',
          slot: 'directive',
          text: plan.progressive.writerBrief,
          confidence: 0.7,
          reasons: ['progressive_brief'],
        }),
      )
    }
  }

  if (plan?.adaptive?.structureHints?.length && !plan?.progressive?.enabled) {
    out.push(
      makeSuggestion({
        advisor: 'adaptive',
        slot: 'structure',
        structure: [
          ...plan.adaptive.structureHints,
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: plan.adaptive.writerBrief || '',
        confidence: 0.6,
        reasons: ['adaptive_structure'],
      }),
    )
  }

  if (expertTeacher?.plan?.enabled && expertTeacher.plan.structureHints?.length) {
    out.push(
      makeSuggestion({
        advisor: 'teacher',
        slot: 'structure',
        structure: [
          ...expertTeacher.plan.structureHints,
          'Prosa da ottimo insegnante: progressiva, umana — non enciclopedia',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: expertTeacher.plan.writerBrief || '',
        confidence: expertTeacher.plan.confidence || 0.8,
        baseValue: ADVISOR_BASE_VALUE.teacher + 0.5,
        reasons: ['expert_teacher'],
      }),
    )
    if (expertTeacher.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'teacher',
          slot: 'directive',
          text: expertTeacher.plan.writerBrief,
          confidence: 0.8,
          reasons: ['teacher_brief'],
        }),
      )
    }
  }

  // Fallback core structure if nothing else owns it
  if (baseStructure?.length) {
    out.push(
      makeSuggestion({
        advisor: 'core_plan',
        slot: 'structure',
        structure: baseStructure,
        confidence: 0.4,
        baseValue: 3,
        reasons: ['base_outline'],
      }),
    )
  }

  // --- Personality / Dynamic Behavior ---
  if (behavior?.plan?.active) {
    if (behavior.plan.shortReply && !behavior.plan.shouldContinue) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'opening',
          structure: [
            'Risposta brevissima e naturale',
            'Non forzare la conversazione',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: behavior.plan.writerBrief || '',
          confidence: behavior.plan.confidence || 0.85,
          baseValue: 9,
          reasons: ['behavior_short_stop'],
        }),
      )
    } else if (behavior.plan.responseHints?.length) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'structure',
          structure: [
            ...behavior.plan.responseHints.slice(0, 4),
            `Behavior: ${behavior.plan.behavior}`,
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: behavior.plan.writerBrief || '',
          confidence: behavior.plan.confidence || 0.75,
          reasons: [`behavior_${behavior.plan.behavior}`],
        }),
      )
    }
    if (behavior.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'directive',
          text: behavior.plan.writerBrief,
          confidence: behavior.plan.confidence || 0.75,
          reasons: ['behavior_brief'],
        }),
      )
    }
    if (behavior.plan.styleBrief) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'style',
          text: behavior.plan.styleBrief,
          confidence: 0.7,
          reasons: ['behavior_style'],
        }),
      )
    }
    if (behavior.plan.memoryHelpful === false) {
      out.push(
        makeSuggestion({
          advisor: 'memory',
          slot: 'memory_policy',
          skipMemory: true,
          text: 'Skip memory retrieval — would not improve this turn.',
          confidence: 0.8,
          reasons: ['memory_not_helpful'],
        }),
      )
    }
  }

  // --- Voice ---
  if (voice?.plan?.active) {
    if (voice.plan.interruptKind === 'hard' || voice.plan.interruptKind === 'soft') {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'opening',
          structure: [
            'Ack brevissimo (una frase corta)',
            voice.plan.shouldResumeTopic
              ? `Riprendi «${voice.plan.resumeTopic}» senza rifare tutto`
              : 'Ascolta / segui la nuova direzione dell’utente',
            'Niente monologo — modalità voce',
          ],
          text: voice.plan.writerBrief || '',
          confidence: 0.95,
          baseValue: 10,
          reasons: [`voice_interrupt_${voice.plan.interruptKind}`],
        }),
      )
    } else if (voice.plan.incompleteUtterance) {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'opening',
          structure: [
            'Una frase su cosa hai capito finora',
            'Invito breve a completare OPPURE prosecuzione tentativa leggera',
            'Frasi corte, pause naturali',
          ],
          text: voice.plan.writerBrief || '',
          confidence: 0.9,
          baseValue: 9.5,
          reasons: ['voice_incomplete'],
        }),
      )
    } else if (voice.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'directive',
          text: voice.plan.writerBrief,
          confidence: 0.75,
          reasons: ['voice_brief'],
        }),
      )
    }
    if (voice.plan.spokenStyleBrief) {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'style',
          text: voice.plan.spokenStyleBrief,
          confidence: 0.95,
          baseValue: 9.5,
          reasons: ['voice_spoken_style'],
        }),
      )
    }
  }

  // --- Continuation ---
  if (continuation?.plan?.isShortMessage) {
    if (continuation.plan.shouldContinue) {
      const nextLayer = expertTeacher?.plan?.enabled
        ? expertTeacher.plan.layersThisTurn?.[0]
        : null
      out.push(
        makeSuggestion({
          advisor: 'continuation',
          slot: 'opening',
          structure:
            continuation.plan.intent === 'compliment_go_deeper'
              ? [
                  'BUILD IDEAS, DON\'T RESET — stessa idea, uno strato più a fondo',
                  'Ack caldo in mezza frase max (o nessuno) — NON solo “grazie”; NON ripartire da zero',
                  `Sviluppa il filo (${continuation.plan.continuationStyle || 'advanced'}) — NON fare subito un’altra domanda`,
                  'Entusiasmo = permesso di approfondire lo stesso treno di pensiero',
                  `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
                ]
              : [
                  'Ack naturale in mezza frase (opzionale) — senza “Perfetto!” ripetitivo',
                  nextLayer
                    ? `Prossimo layer didattico: ${nextLayer.label} — ${nextLayer.writerHint}`
                    : `Una sola aggiunta di valore (${continuation.plan.continuationStyle || continuation.plan.additionKind || 'utile'}) sul filo corrente`,
                  'Chiudi senza forzare; non trasformarlo in un corso infinito',
                  `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
                ],
          text: continuation.plan.writerBrief || '',
          confidence: continuation.plan.confidence || 0.85,
          baseValue: continuation.plan.intent === 'compliment_go_deeper' ? 9.4 : 9.2,
          reasons:
            continuation.plan.intent === 'compliment_go_deeper'
              ? ['continuation_compliment_deeper', 'build_ideas_dont_reset']
              : ['continuation_continue'],
        }),
      )
      if (conversation?.memory?.currentGoal) {
        out.push(
          makeSuggestion({
            advisor: 'continuation',
            slot: 'goal',
            goal: `Continuare l’apprendimento su: ${conversation.memory.currentTopic}`,
            confidence: 0.8,
            reasons: ['continuation_goal'],
          }),
        )
      }
    } else {
      out.push(
        makeSuggestion({
          advisor: 'continuation',
          slot: 'opening',
          structure: [
            'Risposta breve e umana all’ack / chiusura',
            'Niente mini-lezione, niente reset, niente domanda forzata',
            `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
          ],
          text: continuation.plan.writerBrief || '',
          confidence: continuation.plan.confidence || 0.9,
          baseValue: 9.5,
          reasons: ['continuation_stop'],
        }),
      )
    }
    if (continuation.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'continuation',
          slot: 'directive',
          text: continuation.plan.writerBrief,
          confidence: continuation.plan.confidence || 0.85,
          reasons: ['continuation_brief'],
        }),
      )
    }
    out.push(
      makeSuggestion({
        advisor: 'tool_selection',
        slot: 'tools',
        tools: (plan.toolOrder || []).filter((t) => t === 'memory'),
        webOff: true,
        confidence: 0.9,
        reasons: ['short_message_tools'],
      }),
    )
  }

  // --- Conversation intelligence / follow-ups ---
  if (
    follow === 'continue' ||
    follow === 'ack' ||
    follow === 'example' ||
    follow === 'clarify'
  ) {
    if (!continuation?.plan?.isShortMessage) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'structure',
          structure: [
            follow === 'example'
              ? 'Apri con un esempio concreto sul filo corrente'
              : follow === 'clarify'
                ? 'Apri chiarendo il punto già toccato, senza rifare tutta la lezione'
                : 'Riprendi dal punto lasciato, senza reset — non trattare il messaggio come isolato',
            'Aggiungi solo ciò che manca rispetto a quanto già detto',
            'Chiudi in modo naturale e continuo',
            `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
          ],
          confidence: 0.8,
          baseValue: 8,
          reasons: [`follow_${follow}`],
        }),
      )
    }
    if (conversation?.memory?.continuityDirective) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'directive',
          text: conversation.memory.continuityDirective,
          confidence: 0.8,
          reasons: ['continuity_directive'],
        }),
      )
    }
    if (conversation?.memory?.currentGoal) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'goal',
          goal: conversation.memory.currentGoal,
          confidence: 0.75,
          reasons: ['follow_goal'],
        }),
      )
    }
    out.push(
      makeSuggestion({
        advisor: 'tool_selection',
        slot: 'tools',
        tools: (plan.toolOrder || []).filter((t) => t === 'memory'),
        webOff: true,
        confidence: 0.85,
        reasons: ['followup_memory_only'],
      }),
    )
  } else if (conversation?.memory?.topicShift && conversation.memory.continuityDirective) {
    out.push(
      makeSuggestion({
        advisor: 'conversation_intelligence',
        slot: 'directive',
        text: conversation.memory.continuityDirective,
        confidence: 0.7,
        reasons: ['topic_shift'],
      }),
    )
    if (conversation.memory.currentGoal) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'goal',
          goal: conversation.memory.currentGoal,
          confidence: 0.7,
          reasons: ['topic_shift_goal'],
        }),
      )
    }
  }

  // --- Planning (task planner) ---
  if (task?.plan?.complexity === 'high' && follow === 'other') {
    out.push(
      makeSuggestion({
        advisor: 'planning',
        slot: 'structure',
        structure: [
          `Problema centrale: ${plan.progressive?.coreProblem || plan.realGoal}`,
          ...(task.plan.workstreams || []).slice(0, 5).map((w, i) => `Parte ${i + 1}: ${w}`),
          'Ricombina in una risposta unica',
          'Verifica coerenza interna',
          'Scrivi solo la risposta finale',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: task.plan.writerBrief || '',
        confidence: 0.8,
        baseValue: 8,
        reasons: ['task_high_complexity'],
      }),
    )
  } else if (
    task?.plan?.complexity === 'medium' &&
    follow === 'other' &&
    plan.adaptive?.effort !== 'minimal' &&
    task.plan.writerBrief
  ) {
    out.push(
      makeSuggestion({
        advisor: 'planning',
        slot: 'directive',
        text: task.plan.writerBrief,
        confidence: 0.65,
        reasons: ['task_medium'],
      }),
    )
  }

  if (
    follow !== 'continue' &&
    follow !== 'ack' &&
    follow !== 'example' &&
    follow !== 'clarify' &&
    Array.isArray(task?.plan?.tools) &&
    task.plan.tools.length
  ) {
    const merged = [...new Set([...(plan.toolOrder || []), ...task.plan.tools])]
    out.push(
      makeSuggestion({
        advisor: 'planning',
        slot: 'tools',
        tools: plan.webDecision?.needed ? merged : merged.filter((t) => t !== 'web'),
        confidence: 0.7,
        reasons: ['task_tools'],
      }),
    )
  }

  // --- Next-ask (shapes body — not a competing coda when curiosity/momentum win) ---
  if (nextAsk?.plan?.active && nextAsk.plan.prediction && !continuation?.plan?.isShortMessage) {
    out.push(
      makeSuggestion({
        advisor: 'next_ask',
        slot: 'directive',
        text: nextAsk.plan.shapeBrief || nextAsk.plan.writerBrief || '',
        confidence: nextAsk.plan.confidence || 0.6,
        baseValue: ADVISOR_BASE_VALUE.next_ask,
        reasons: [`next_ask_${nextAsk.plan.prediction.kind}`],
      }),
    )
    // Soft structure hint (lower value than exclusive structure owners)
    out.push(
      makeSuggestion({
        advisor: 'next_ask',
        slot: 'coda',
        text: `Mentre rispondi: prepara un ponte naturale verso la curiosità probabile (${nextAsk.plan.prediction.kind}) — senza menzionarla`,
        structure: [
          `Mentre rispondi: prepara un ponte naturale verso la curiosità probabile (${nextAsk.plan.prediction.kind}) — senza menzionarla`,
        ],
        confidence: conf01(nextAsk.plan.confidence) * 0.85,
        baseValue: 4.5,
        reasons: ['next_ask_bridge'],
      }),
    )
  }

  // --- Intellectual Initiative (high-bar coda: one valuable insight or silence) ---
  if (
    intellectualInitiative?.plan?.shouldAdd &&
    intellectualInitiative.plan.chosen &&
    !continuation?.plan?.isShortMessage
  ) {
    const insight = intellectualInitiative.plan.chosen
    out.push(
      makeSuggestion({
        advisor: 'intellectual_initiative',
        slot: 'coda',
        text: intellectualInitiative.plan.writerBrief || '',
        structure: [
          `Prima di chiudere: UNA sola aggiunta ad alto valore (${insight.kind}) — forma naturale, 1–3 frasi, mai filler né template fissi`,
        ],
        confidence: intellectualInitiative.plan.confidence || 0.7,
        baseValue:
          ADVISOR_BASE_VALUE.intellectual_initiative +
          Math.min(1.2, Math.max(0, (insight.score - 3.45) * 1.1)),
        reasons: [`initiative_${insight.kind}`],
      }),
    )
  } else if (
    intellectualInitiative?.plan?.writerBrief &&
    !intellectualInitiative.plan.shouldAdd &&
    !continuation?.plan?.isShortMessage
  ) {
    out.push(
      makeSuggestion({
        advisor: 'intellectual_initiative',
        slot: 'directive',
        text: intellectualInitiative.plan.writerBrief,
        confidence: 0.35,
        baseValue: 2.8,
        reasons: ['initiative_silence_guard'],
      }),
    )
  }

  // --- Surprise Without Confusion (coda: one clear unexpected learning beat) ---
  if (
    surprise?.plan?.shouldSurprise &&
    surprise.plan.chosen &&
    !continuation?.plan?.isShortMessage
  ) {
    const idea = surprise.plan.chosen
    out.push(
      makeSuggestion({
        advisor: 'surprise',
        slot: 'coda',
        text: surprise.plan.writerBrief || '',
        structure: [
          `Dopo il punto chiave: UNA sorpresa chiara (${idea.kind}) che aumenta curiosità e comprensione — facile da seguire, zero hype/trivia`,
        ],
        confidence: surprise.plan.confidence || 0.7,
        baseValue:
          ADVISOR_BASE_VALUE.surprise + Math.min(1.0, Math.max(0, (idea.score - 3.5) * 1.0)),
        reasons: [`surprise_${idea.kind}`],
      }),
    )
  } else if (
    surprise?.plan?.writerBrief &&
    !surprise.plan.shouldSurprise &&
    !continuation?.plan?.isShortMessage
  ) {
    out.push(
      makeSuggestion({
        advisor: 'surprise',
        slot: 'directive',
        text: surprise.plan.writerBrief,
        confidence: 0.35,
        baseValue: 2.6,
        reasons: ['surprise_silence_guard'],
      }),
    )
  }

  // --- Curiosity (coda) ---
  if (curiosity?.plan?.shouldExtend && curiosity.plan.chosen && !continuation?.plan?.isShortMessage) {
    out.push(
      makeSuggestion({
        advisor: 'curiosity',
        slot: 'coda',
        text: curiosity.plan.writerBrief || '',
        structure: [
          `Dopo la risposta: estendi naturalmente con UNA idea curiosità (${curiosity.plan.chosen.kind}) — mai “Anything else?”`,
        ],
        confidence: curiosity.plan.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.curiosity + (curiosity.plan.chosen.score || 0) * 0.3,
        reasons: [`curiosity_${curiosity.plan.chosen.kind}`],
      }),
    )
  } else if (
    curiosity?.plan?.writerBrief &&
    !continuation?.plan?.isShortMessage &&
    !voice?.plan?.active
  ) {
    out.push(
      makeSuggestion({
        advisor: 'curiosity',
        slot: 'directive',
        text: curiosity.plan.writerBrief,
        confidence: 0.4,
        baseValue: 3,
        reasons: ['curiosity_soft_closer_guard'],
      }),
    )
  }

  // --- Momentum (coda competitor) ---
  if (
    !continuation?.plan?.isShortMessage &&
    momentum?.plan?.writerBrief &&
    !(voice?.plan?.active && (voice.plan.interruptKind !== 'none' || voice.plan.incompleteUtterance))
  ) {
    if (momentum.plan.shouldContinue) {
      out.push(
        makeSuggestion({
          advisor: 'momentum',
          slot: 'coda',
          text: momentum.plan.writerBrief,
          structure: [
            voice?.plan?.active
              ? `Prima di chiudere: al massimo UNA coda parlata brevissima (${momentum.plan.continuationKind})`
              : `Prima di chiudere: UNA continuazione concisa di qualità (${momentum.plan.continuationKind}) — non allungare a vuoto`,
          ],
          confidence: momentum.plan.confidence || 0.65,
          baseValue: ADVISOR_BASE_VALUE.momentum + (momentum.plan.shouldContinue ? 0.8 : 0),
          reasons: [`momentum_${momentum.plan.continuationKind}`],
        }),
      )
    } else {
      out.push(
        makeSuggestion({
          advisor: 'momentum',
          slot: 'directive',
          text: momentum.plan.writerBrief,
          confidence: momentum.plan.confidence || 0.6,
          baseValue: 4,
          reasons: ['momentum_natural_end'],
        }),
      )
    }
  }

  // --- Multi-step / Action ---
  if (multiStep?.plan?.active && multiStep.plan.writerBrief) {
    out.push(
      makeSuggestion({
        advisor: 'multi_step',
        slot: 'structure',
        structure: [
          'Apri con cosa stai preparando / l’obiettivo in una frase',
          'Riassumi i passi utili in ordine naturale (senza jargon da planner)',
          'Se qualcosa non è riuscito o manca un connettore: dillo in una frase e continua',
          multiStep.results?.some((r) => r.status === 'blocked')
            ? 'Chiedi UNA conferma chiara solo per i passi in attesa'
            : 'Chiudi con il prossimo passo concreto per l’utente',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: multiStep.plan.writerBrief,
        confidence: 0.95,
        baseValue: 9.8,
        reasons: ['multi_step_active'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'multi_step',
        slot: 'directive',
        text: multiStep.plan.writerBrief,
        confidence: 0.95,
        reasons: ['multi_step_brief'],
      }),
    )
  } else if (actionEngine?.plan?.actionRequired && actionEngine.plan.writerBrief) {
    /** @type {string[]} */
    let structure = []
    if (actionEngine.plan.phase === 'awaiting_confirmation') {
      structure = [
        'Riassumi l’azione proposta in una frase chiara',
        'Chiedi conferma breve (sì/no) — non eseguire ancora',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else {
      structure = [
        'Spiega l’esito dell’azione in modo naturale (senza jargon)',
        actionEngine.plan.phase === 'unavailable'
          ? 'Offri un’alternativa utile finché l’integrazione non è collegata'
          : 'Conferma cosa è successo / cosa non è stato fatto',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    }
    out.push(
      makeSuggestion({
        advisor: 'action',
        slot: 'structure',
        structure,
        text: actionEngine.plan.writerBrief,
        confidence: 0.92,
        baseValue: 9.4,
        reasons: [`action_${actionEngine.plan.phase}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'action',
        slot: 'directive',
        text: actionEngine.plan.writerBrief,
        confidence: 0.92,
        reasons: ['action_brief'],
      }),
    )
  }

  // --- Reflection (soft directive) ---
  if (reflection?.signals?.directive) {
    out.push(
      makeSuggestion({
        advisor: 'reflection',
        slot: 'directive',
        text: reflection.signals.directive,
        confidence: 0.45,
        baseValue: 3,
        reasons: ['reflection_learn'],
      }),
    )
  }

  // --- Default tool selection from plan ---
  if (Array.isArray(plan?.toolOrder)) {
    out.push(
      makeSuggestion({
        advisor: 'tool_selection',
        slot: 'tools',
        tools: [...plan.toolOrder],
        confidence: 0.5,
        baseValue: 4,
        reasons: ['core_tools'],
      }),
    )
  }

  return out.filter((s) => s.active !== false)
}

/**
 * Assemble writer directive + structure from accepted suggestions.
 * @param {object} input
 * @returns {CoordinationDecision}
 */
export function runCognitiveCoordinator(input) {
  const plan = input.plan
  const collected = Array.isArray(input.suggestions)
    ? input.suggestions
    : collectAdvisorSuggestions(input)

  const ranked = rankSuggestions(collected)
  const deduped = dedupeSuggestions(ranked)
  const { accepted, rejected, winnersBySlot, styleAccepted, directiveAccepted } =
    resolveConflicts(deduped, {
      continuation: input.continuation?.plan || input.continuation || null,
      voice: input.voice?.plan || input.voice || null,
      multiStep: input.multiStep?.plan || input.multiStep || null,
      action: input.actionEngine?.plan || input.action || null,
      automation: input.automationBuilder?.plan || input.automation || null,
      topicLeadership: input.topicLeadership?.plan || input.topicLeadership || null,
      feedbackInterpretation:
        input.feedbackInterpretation?.plan || input.feedbackInterpretation || null,
      warmConversation: input.warmConversation?.plan || input.warmConversation || null,
      conversationSpark: input.conversationSpark?.plan || input.conversationSpark || null,
      socialConversation: input.socialConversation?.plan || input.socialConversation || null,
      naturalDialogue: input.naturalDialogue?.plan || input.naturalDialogue || null,
      conversationalPragmatics:
        input.conversationalPragmatics?.plan || input.conversationalPragmatics || null,
      questionEconomy: input.questionEconomy?.plan || input.questionEconomy || null,
    })

  // Structure: opening wins over structure when both present (short/voice turns)
  const opening = winnersBySlot.opening
  const structureWinner = opening || winnersBySlot.structure
  /** @type {string[]} */
  let responseStructure = structureWinner?.structure
    ? [...structureWinner.structure]
    : [...(input.baseStructure || plan?.responseStructure || [])]

  // Attach at most one coda line
  const coda = winnersBySlot.coda
  if (coda?.structure?.length) {
    for (const line of coda.structure.slice(0, MAX_CODA)) {
      if (!responseStructure.includes(line)) responseStructure.push(line)
    }
  } else if (coda?.text && !responseStructure.some((l) => /curiosità|prima di chiudere|ponte naturale/i.test(l))) {
    responseStructure.push(coda.text)
  }

  responseStructure = responseStructure.filter(Boolean).slice(0, MAX_STRUCTURE_STEPS)

  // Tools
  const toolSuggestions = accepted.filter((s) => s.slot === 'tools' && Array.isArray(s.tools))
  let toolOrder = plan?.toolOrder ? [...plan.toolOrder] : []
  let webOff = false
  if (toolSuggestions.length) {
    // Highest-ranked tool suggestion wins as base; merge uniques from others with same webOff
    const primary = toolSuggestions[0]
    toolOrder = [...(primary.tools || [])]
    webOff = Boolean(primary.webOff)
    for (const ts of toolSuggestions.slice(1)) {
      if (ts.webOff) webOff = true
      for (const t of ts.tools || []) {
        if (!toolOrder.includes(t)) toolOrder.push(t)
      }
    }
  }
  if (webOff) toolOrder = toolOrder.filter((t) => t !== 'web')

  const skipMemory = Boolean(winnersBySlot.memory_policy?.skipMemory)
  if (skipMemory) toolOrder = toolOrder.filter((t) => t !== 'memory')

  const ALL = ['memory', 'web', 'vision', 'document', 'calculator', 'weather', 'calendar', 'reminder']
  const toolsSkipped = ALL.filter((t) => !toolOrder.includes(t))

  const realGoal = winnersBySlot.goal?.goal || plan?.realGoal || null

  // --- Conversation Constitution (GLOBAL IMMUTABLE — always on before Writer) ---
  let conversationConstitutionPlan =
    input.conversationConstitution?.plan || input.conversationConstitution || null
  if (conversationConstitutionPlan?.plan && !conversationConstitutionPlan?.writerBrief) {
    conversationConstitutionPlan = conversationConstitutionPlan.plan
  }
  if (!conversationConstitutionPlan?.active || !conversationConstitutionPlan?.writerBrief) {
    try {
      const rerun = runConversationConstitution({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
      })
      if (rerun?.plan?.active) conversationConstitutionPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (conversationConstitutionPlan?.active && conversationConstitutionPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Conversation Constitution →/i.test(l) || /Constitution/i.test(l),
      )
    ) {
      responseStructure = [
        conversationConstitutionPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Insight Discovery stage (inside Coordinator, before final Writer handoff) ---
  // ONE unexpected but highly relevant connection — or silence. Never invent / force.
  const insightDiscovery = runInsightDiscoveryStage({
    plan,
    userMessage: input.userMessage || plan?.userMessage || '',
    session: input.session || input.conversation?.memory || null,
    continuation: input.continuation?.plan || input.continuation || null,
    voice: input.voice?.plan || input.voice || null,
    multiStep: input.multiStep?.plan || input.multiStep || null,
    action: input.actionEngine?.plan || input.action || null,
    automation: input.automationBuilder?.plan || input.automation || null,
    topicLeadership: input.topicLeadership?.plan || input.topicLeadership || null,
    codaAdvisor: coda?.advisor || null,
    realGoal,
  })

  if (insightDiscovery.found && insightDiscovery.structureLine) {
    if (!responseStructure.some((l) => /insight discovery|connessione inattesa/i.test(l))) {
      responseStructure.push(insightDiscovery.structureLine)
      responseStructure = responseStructure.filter(Boolean).slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Thoughtfulness Engine (last-mile after Leadership, before Deep Thinking) ---
  let thoughtfulnessPlan = input.thoughtfulness?.plan || input.thoughtfulness || null
  if (thoughtfulnessPlan?.plan && !thoughtfulnessPlan?.writerBrief) {
    thoughtfulnessPlan = thoughtfulnessPlan.plan
  }
  if (!thoughtfulnessPlan?.active || !thoughtfulnessPlan?.writerBrief) {
    try {
      const rerun = runThoughtfulnessEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        conversationIntent: input.conversationIntent,
        conversationLeadership: input.conversationLeadership,
        session: input.session || input.conversation?.memory || null,
        understanding: plan?.understanding || null,
      })
      if (rerun?.plan?.active) thoughtfulnessPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (thoughtfulnessPlan?.active && thoughtfulnessPlan.structureLine) {
    if (!responseStructure.some((l) => /thoughtfulness/i.test(l))) {
      responseStructure = [
        thoughtfulnessPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Deep Thinking Engine (last-mile before Writer: explore directions, pick best) ---
  let deepThinkingPlan = input.deepThinking?.plan || input.deepThinking || null
  if (deepThinkingPlan?.plan && !deepThinkingPlan?.writerBrief) {
    deepThinkingPlan = deepThinkingPlan.plan
  }
  if (!deepThinkingPlan?.active || !deepThinkingPlan?.writerBrief) {
    try {
      const rerun = runDeepThinkingEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        conversationIntent: input.conversationIntent,
        conversationLeadership: input.conversationLeadership,
        thoughtfulness: thoughtfulnessPlan ? { plan: thoughtfulnessPlan } : input.thoughtfulness,
        session: input.session || input.conversation?.memory || null,
        understanding: plan?.understanding || null,
      })
      if (rerun?.plan?.active) deepThinkingPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (deepThinkingPlan?.active && deepThinkingPlan.structureLine) {
    if (!responseStructure.some((l) => /deep thinking/i.test(l))) {
      responseStructure = [
        deepThinkingPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Presence Engine (last-mile after Deep Thinking, before Writer) ---
  let presencePlan = input.presence?.plan || input.presence || null
  if (presencePlan?.plan && !presencePlan?.writerBrief) {
    presencePlan = presencePlan.plan
  }
  if (!presencePlan?.active || !presencePlan?.writerBrief) {
    try {
      const rerun = runPresenceEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        conversationIntent: input.conversationIntent,
        conversationLeadership: input.conversationLeadership,
        deepThinking: deepThinkingPlan ? { plan: deepThinkingPlan } : input.deepThinking,
        thoughtfulness: thoughtfulnessPlan ? { plan: thoughtfulnessPlan } : input.thoughtfulness,
        session: input.session || input.conversation?.memory || null,
      })
      if (rerun?.plan?.active) presencePlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (presencePlan?.active && presencePlan.structureLine) {
    if (!responseStructure.some((l) => /^Presence →/i.test(l) || /Presence Engine/i.test(l))) {
      responseStructure = [
        presencePlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Wisdom Engine (last-mile after Presence, before Writer) ---
  let wisdomPlan = input.wisdom?.plan || input.wisdom || null
  if (wisdomPlan?.plan && !wisdomPlan?.writerBrief) {
    wisdomPlan = wisdomPlan.plan
  }
  if (!wisdomPlan?.active || !wisdomPlan?.writerBrief) {
    try {
      const rerun = runWisdomEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        conversationIntent: input.conversationIntent,
        conversationLeadership: input.conversationLeadership,
        deepThinking: deepThinkingPlan ? { plan: deepThinkingPlan } : input.deepThinking,
        presence: presencePlan ? { plan: presencePlan } : input.presence,
        thoughtfulness: thoughtfulnessPlan ? { plan: thoughtfulnessPlan } : input.thoughtfulness,
        session: input.session || input.conversation?.memory || null,
      })
      if (rerun?.plan?.active) wisdomPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (wisdomPlan?.active && wisdomPlan.structureLine) {
    if (!responseStructure.some((l) => /^Wisdom →/i.test(l) || /Wisdom Engine/i.test(l))) {
      responseStructure = [
        wisdomPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Conversation Taste (last-mile after Wisdom, before Writer) ---
  let conversationTastePlan = input.conversationTaste?.plan || input.conversationTaste || null
  if (conversationTastePlan?.plan && !conversationTastePlan?.writerBrief) {
    conversationTastePlan = conversationTastePlan.plan
  }
  if (!conversationTastePlan?.active || !conversationTastePlan?.writerBrief) {
    try {
      const rerun = runConversationTaste({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        presence: presencePlan ? { plan: presencePlan } : input.presence,
        wisdom: wisdomPlan ? { plan: wisdomPlan } : input.wisdom,
        deepThinking: deepThinkingPlan ? { plan: deepThinkingPlan } : input.deepThinking,
        session: input.session || input.conversation?.memory || null,
      })
      if (rerun?.plan?.active) conversationTastePlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (conversationTastePlan?.active && conversationTastePlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Conversation Taste →/i.test(l) || /Conversation Taste/i.test(l),
      )
    ) {
      responseStructure = [
        conversationTastePlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Conversation Memory Flow (last-mile: spontaneous weave, never dump) ---
  let conversationMemoryFlowPlan =
    input.conversationMemoryFlow?.plan || input.conversationMemoryFlow || null
  if (conversationMemoryFlowPlan?.plan && !conversationMemoryFlowPlan?.writerBrief) {
    conversationMemoryFlowPlan = conversationMemoryFlowPlan.plan
  }
  if (!conversationMemoryFlowPlan?.active || !conversationMemoryFlowPlan?.writerBrief) {
    try {
      const rerun = runConversationMemoryFlow({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        conversationMemoryMap:
          input.conversationMemoryMap || input.conversation?.memory?.conversationMemoryMap || null,
        session: input.session || input.conversation?.memory || null,
        presence: presencePlan ? { plan: presencePlan } : input.presence,
        wisdom: wisdomPlan ? { plan: wisdomPlan } : input.wisdom,
      })
      if (rerun?.plan?.active) conversationMemoryFlowPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (conversationMemoryFlowPlan?.active && conversationMemoryFlowPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Conversation Memory Flow →/i.test(l) || /Memory Flow/i.test(l),
      )
    ) {
      responseStructure = [
        conversationMemoryFlowPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Self Reflection Engine (last-mile after Memory Flow: silent quality checklist) ---
  let selfReflectionPlan = input.selfReflection?.plan || input.selfReflection || null
  if (selfReflectionPlan?.plan && !selfReflectionPlan?.writerBrief) {
    selfReflectionPlan = selfReflectionPlan.plan
  }
  if (!selfReflectionPlan?.active || !selfReflectionPlan?.writerBrief) {
    try {
      const rerun = runSelfReflectionEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        presence: presencePlan ? { plan: presencePlan } : input.presence,
        wisdom: wisdomPlan ? { plan: wisdomPlan } : input.wisdom,
        conversationTaste: conversationTastePlan
          ? { plan: conversationTastePlan }
          : input.conversationTaste,
        conversationMemoryFlow: conversationMemoryFlowPlan
          ? { plan: conversationMemoryFlowPlan }
          : input.conversationMemoryFlow,
      })
      if (rerun?.plan?.active) selfReflectionPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (selfReflectionPlan?.active && selfReflectionPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Self Reflection →/i.test(l) || /Self Reflection/i.test(l),
      )
    ) {
      responseStructure = [
        selfReflectionPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Human Conversation Simulator (before Ownership / Worth Reading / Writer) ---
  // Does NOT generate text — emits ConversationIntent for the Writer to follow.
  const humanConversation = runHumanConversationSimulator({
    userMessage: input.userMessage || plan?.userMessage || '',
    messages: input.conversation?.messages || input.messages || [],
    understanding: plan?.understanding,
    behavior: input.behavior?.plan || input.behavior || null,
    continuation: input.continuation?.plan || input.continuation || null,
    questionEconomy: input.questionEconomy?.plan || input.questionEconomy || null,
    planHints: {
      primaryIntent: plan?.understanding?.primaryIntent,
      behavior: input.behavior?.plan?.behavior || input.behavior?.behavior,
    },
  })

  if (humanConversation.active && humanConversation.structureLine) {
    // Keep intent near the top of structure so Writer sees the move first
    if (!responseStructure.some((l) => /human conversation simulator/i.test(l))) {
      responseStructure = [
        humanConversation.structureLine,
        ...responseStructure,
      ].filter(Boolean).slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Conversation Ownership Protocol (after HCS; before Worth Reading) ---
  let conversationOwnershipPlan =
    input.conversationOwnership?.plan || input.conversationOwnership || null
  if (conversationOwnershipPlan?.plan && !conversationOwnershipPlan?.writerBrief) {
    conversationOwnershipPlan = conversationOwnershipPlan.plan
  }
  if (!conversationOwnershipPlan?.active || !conversationOwnershipPlan?.writerBrief) {
    try {
      const rerun = runConversationOwnershipProtocol({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
      })
      if (rerun?.plan?.active) conversationOwnershipPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (conversationOwnershipPlan?.active && conversationOwnershipPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Conversation Ownership →/i.test(l) || /Conversation Ownership/i.test(l),
      )
    ) {
      responseStructure = [
        conversationOwnershipPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Worth Reading Protocol (LAST craft before Writer — after Ownership / HCS) ---
  let worthReadingPlan = input.worthReading?.plan || input.worthReading || null
  if (worthReadingPlan?.plan && !worthReadingPlan?.writerBrief) {
    worthReadingPlan = worthReadingPlan.plan
  }
  if (!worthReadingPlan?.active || !worthReadingPlan?.writerBrief) {
    try {
      const rerun = runWorthReadingProtocol({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        conversationConstitution: conversationConstitutionPlan
          ? { plan: conversationConstitutionPlan }
          : input.conversationConstitution,
        selfReflection: selfReflectionPlan
          ? { plan: selfReflectionPlan }
          : input.selfReflection,
        conversationOwnership: conversationOwnershipPlan
          ? { plan: conversationOwnershipPlan }
          : input.conversationOwnership,
      })
      if (rerun?.plan?.active) worthReadingPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (worthReadingPlan?.active && worthReadingPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Worth Reading Protocol →/i.test(l) || /Worth Reading/i.test(l),
      )
    ) {
      responseStructure = [
        worthReadingPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Language Awareness (foundational reply-language layer) ---
  let languageAwarenessPlan =
    input.languageAwareness?.plan || input.languageAwareness || null
  if (languageAwarenessPlan?.plan && !languageAwarenessPlan?.writerBrief) {
    languageAwarenessPlan = languageAwarenessPlan.plan
  }
  if (!languageAwarenessPlan?.active || !languageAwarenessPlan?.writerBrief) {
    try {
      const rerun = runLanguageAwareness({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        session: input.session || input.conversation?.memory || null,
      })
      if (rerun?.plan?.active) languageAwarenessPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (
    languageAwarenessPlan?.active &&
    (languageAwarenessPlan.replyLanguage === 'it' ||
      languageAwarenessPlan.replyLanguage === 'en') &&
    plan?.understanding
  ) {
    plan.understanding = {
      ...plan.understanding,
      language: languageAwarenessPlan.replyLanguage,
    }
  }

  if (languageAwarenessPlan?.active && languageAwarenessPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Language Awareness/i.test(l) || /reply in (it|en)/i.test(l),
      )
    ) {
      responseStructure = [
        languageAwarenessPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Social Conversation Engine (last-mile: SOCIAL contact before Intent guidance) ---
  let socialConversationPlan =
    input.socialConversation?.plan || input.socialConversation || null
  if (socialConversationPlan?.plan && !socialConversationPlan?.writerBrief) {
    socialConversationPlan = socialConversationPlan.plan
  }
  if (!socialConversationPlan?.active || !socialConversationPlan?.writerBrief) {
    try {
      const rerun = runSocialConversationEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        session: input.session || input.conversation?.memory || null,
      })
      if (rerun?.plan?.active) socialConversationPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (socialConversationPlan?.active && socialConversationPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Social Conversation Engine →/i.test(l) || /Social Conversation/i.test(l),
      )
    ) {
      responseStructure = [
        socialConversationPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Conversation Spark (last-mile: natural initiative opening) ---
  let conversationSparkPlan =
    input.conversationSpark?.plan || input.conversationSpark || null
  if (conversationSparkPlan?.plan && !conversationSparkPlan?.writerBrief) {
    conversationSparkPlan = conversationSparkPlan.plan
  }
  if (!conversationSparkPlan?.shouldSpark || !conversationSparkPlan?.writerBrief) {
    try {
      const rerun = runConversationSparkEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        session: input.session || input.conversation?.memory || null,
        topicLeadership: input.topicLeadership,
        conversationOwnership: input.conversationOwnership,
        warmConversation: input.warmConversation,
        welcome: input.welcome,
        socialConversation: input.socialConversation,
        conversationLeadership: input.conversationLeadership,
        languageAwareness: input.languageAwareness,
      })
      if (rerun?.plan?.shouldSpark) conversationSparkPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (conversationSparkPlan?.shouldSpark && conversationSparkPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Conversation Spark →/i.test(l) || /Conversation Spark/i.test(l),
      )
    ) {
      responseStructure = [
        conversationSparkPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Natural Dialogue (last-mile: conversational moves before WriterDirectives) ---
  let naturalDialoguePlan =
    input.naturalDialogue?.plan || input.naturalDialogue || null
  if (naturalDialoguePlan?.plan && !naturalDialoguePlan?.writerBrief) {
    naturalDialoguePlan = naturalDialoguePlan.plan
  }
  if (!naturalDialoguePlan?.active || !naturalDialoguePlan?.writerBrief) {
    try {
      const rerun = runNaturalDialogueEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        session: input.session || input.conversation?.memory || null,
        languageAwareness: input.languageAwareness,
        socialConversation: input.socialConversation,
        conversationIntent: input.conversationIntent,
        conversationLeadership: input.conversationLeadership,
        behavior: input.behavior,
        conversationMode: input.behavior?.plan?.behavior || input.behavior?.behavior || null,
        plan,
      })
      if (rerun?.plan?.active) naturalDialoguePlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (naturalDialoguePlan?.active && naturalDialoguePlan.structureLine) {
    if (
      !responseStructure.some(
        (l) => /^Natural Dialogue →/i.test(l) || /Natural Dialogue/i.test(l),
      )
    ) {
      responseStructure = [
        naturalDialoguePlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  // --- Conversational Pragmatics (last-mile: intended > literal before WriterDirectives) ---
  let conversationalPragmaticsPlan =
    input.conversationalPragmatics?.plan || input.conversationalPragmatics || null
  if (conversationalPragmaticsPlan?.plan && !conversationalPragmaticsPlan?.writerBrief) {
    conversationalPragmaticsPlan = conversationalPragmaticsPlan.plan
  }
  if (!conversationalPragmaticsPlan?.active || !conversationalPragmaticsPlan?.writerBrief) {
    try {
      const rerun = runConversationalPragmaticsEngine({
        userMessage: input.userMessage || plan?.userMessage || '',
        messages: input.conversation?.messages || input.messages || [],
        session: input.session || input.conversation?.memory || null,
        languageAwareness: input.languageAwareness,
        socialConversation: input.socialConversation,
        conversationIntent: input.conversationIntent,
        naturalDialogue: naturalDialoguePlan,
        plan,
      })
      if (rerun?.plan?.active) conversationalPragmaticsPlan = rerun.plan
    } catch {
      /* fail-soft */
    }
  }

  if (conversationalPragmaticsPlan?.active && conversationalPragmaticsPlan.structureLine) {
    if (
      !responseStructure.some(
        (l) =>
          /^Conversational Pragmatics →/i.test(l) || /Conversational Pragmatics/i.test(l),
      )
    ) {
      responseStructure = [
        conversationalPragmaticsPlan.structureLine,
        ...responseStructure,
      ]
        .filter(Boolean)
        .slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  const styleBriefs = styleAccepted.map((s) => s.text).filter(Boolean)
  /** @type {string[]} */
  const directiveBriefs = directiveAccepted.map((s) => s.text).filter(Boolean)
  // Prefer pragmatics brief when active (beats literal feedback tone)
  if (conversationalPragmaticsPlan?.active && conversationalPragmaticsPlan.writerBrief) {
    directiveBriefs.unshift(conversationalPragmaticsPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  if (insightDiscovery.found && insightDiscovery.writerBrief) {
    directiveBriefs.unshift(insightDiscovery.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Thoughtfulness last-mile — craft contribution before Deep Thinking
  if (thoughtfulnessPlan?.active && thoughtfulnessPlan.writerBrief) {
    directiveBriefs.unshift(thoughtfulnessPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Deep Thinking last-mile — chosen direction
  if (deepThinkingPlan?.active && deepThinkingPlan.writerBrief) {
    directiveBriefs.unshift(deepThinkingPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Presence last-mile — organic style/ending
  if (presencePlan?.active && presencePlan.writerBrief) {
    directiveBriefs.unshift(presencePlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Wisdom last-mile — after Presence
  if (wisdomPlan?.active && wisdomPlan.writerBrief) {
    directiveBriefs.unshift(wisdomPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Conversation Taste last-mile — after Wisdom
  if (conversationTastePlan?.active && conversationTastePlan.writerBrief) {
    directiveBriefs.unshift(conversationTastePlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Conversation Memory Flow last-mile — after Taste, before Self Reflection / HCS
  if (conversationMemoryFlowPlan?.active && conversationMemoryFlowPlan.writerBrief) {
    directiveBriefs.unshift(conversationMemoryFlowPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Self Reflection last-mile — after Memory Flow, before HCS
  if (selfReflectionPlan?.active && selfReflectionPlan.writerBrief) {
    directiveBriefs.unshift(selfReflectionPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Conversation intent is last-mile guidance — prepend so Writer prioritizes it
  if (humanConversation.active && humanConversation.writerBrief) {
    directiveBriefs.unshift(humanConversation.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Conversation Constitution — IMMUTABLE LAW; also baked into baseDirective
  if (conversationConstitutionPlan?.active && conversationConstitutionPlan.writerBrief) {
    directiveBriefs.unshift(conversationConstitutionPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Conversation Ownership — after HCS / Constitution; before Worth Reading (high priority)
  if (conversationOwnershipPlan?.active && conversationOwnershipPlan.writerBrief) {
    directiveBriefs.unshift(conversationOwnershipPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Worth Reading Protocol — LAST craft unshift before Language (constitution/ownership stay in baseDirective)
  if (worthReadingPlan?.active && worthReadingPlan.writerBrief) {
    directiveBriefs.unshift(worthReadingPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Language Awareness — foundational; early in briefs (unshift last → near top)
  if (languageAwarenessPlan?.active && languageAwarenessPlan.writerBrief) {
    directiveBriefs.unshift(languageAwarenessPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Social Conversation — when SOCIAL, prioritize connection over info (before Intent)
  if (socialConversationPlan?.active && socialConversationPlan.writerBrief) {
    directiveBriefs.unshift(socialConversationPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Conversation Spark — natural initiative opening (never AI looking for a topic)
  if (conversationSparkPlan?.shouldSpark && conversationSparkPlan.writerBrief) {
    directiveBriefs.unshift(conversationSparkPlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }
  // Natural Dialogue — reaction-first conversational moves
  if (naturalDialoguePlan?.active && naturalDialoguePlan.writerBrief) {
    directiveBriefs.unshift(naturalDialoguePlan.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }

  // Base writer directive stripped of advisor briefs that buildCognitivePlan may have embedded —
  // keep the core Writer identity lines only, then add coordinated briefs.
  const baseDirective = buildBaseWriterDirective(
    plan,
    realGoal,
    conversationConstitutionPlan,
    conversationOwnershipPlan,
    worthReadingPlan,
    languageAwarenessPlan,
  )

  const writerDirective = [
    baseDirective,
    ...directiveBriefs,
    ...styleBriefs,
    'Cognitive Coordinator: esegui SOLO i comportamenti accettati; non mescolare motori in conflitto.',
  ]
    .filter(Boolean)
    .join(' ')

  const reasons = [
    `collected=${collected.length}`,
    `accepted=${accepted.length}`,
    `rejected=${rejected.length}`,
    structureWinner ? `structure=${structureWinner.advisor}` : 'structure=base',
    coda ? `coda=${coda.advisor}` : 'coda=none',
    insightDiscovery.found ? `insight=${insightDiscovery.insight?.kind}` : 'insight=none',
    conversationConstitutionPlan?.active
      ? 'constitution=immutable/10'
      : 'constitution=none',
    conversationOwnershipPlan?.active
      ? `conversation_ownership=${conversationOwnershipPlan.stance}${conversationOwnershipPlan.takeLead ? '/lead' : ''}`
      : 'conversation_ownership=none',
    worthReadingPlan?.active
      ? `worth_reading=${worthReadingPlan.stance}${worthReadingPlan.mustCarry ? '/carry' : ''}`
      : 'worth_reading=none',
    languageAwarenessPlan?.active
      ? `language_awareness=${languageAwarenessPlan.replyLanguage}${languageAwarenessPlan.switched ? '/switch' : '/hold'}${languageAwarenessPlan.metaRequest ? '/meta' : ''}`
      : 'language_awareness=none',
    socialConversationPlan?.active
      ? `social_conversation=${socialConversationPlan.mode}/${socialConversationPlan.socialIntent || 'social'}${socialConversationPlan.isSocial ? '/social' : ''}`
      : 'social_conversation=none',
    conversationSparkPlan?.shouldSpark
      ? `conversation_spark=${conversationSparkPlan.category}/${conversationSparkPlan.chosen?.id || 'x'}/${conversationSparkPlan.trigger}`
      : 'conversation_spark=none',
    naturalDialoguePlan?.active
      ? `natural_dialogue=${naturalDialoguePlan.move}${naturalDialoguePlan.reactionOnly ? '/reaction_only' : '/reaction_first'}`
      : 'natural_dialogue=none',
    thoughtfulnessPlan?.active
      ? `thoughtfulness=${thoughtfulnessPlan.contribution}`
      : 'thoughtfulness=none',
    deepThinkingPlan?.active
      ? `deep_thinking=${deepThinkingPlan.direction}`
      : 'deep_thinking=none',
    presencePlan?.active
      ? `presence=${presencePlan.need}/${presencePlan.style}/${presencePlan.ending}`
      : 'presence=none',
    wisdomPlan?.active
      ? `wisdom=${wisdomPlan.stance}`
      : 'wisdom=none',
    conversationTastePlan?.active
      ? `taste=${conversationTastePlan.stance}${conversationTastePlan.checks?.repetitive ? '/rep' : ''}`
      : 'taste=none',
    conversationMemoryFlowPlan?.active
      ? `memory_flow=${conversationMemoryFlowPlan.move}${conversationMemoryFlowPlan.shouldWeave ? '/weave' : '/silence'}`
      : 'memory_flow=none',
    selfReflectionPlan?.active
      ? 'self_reflection=checklist_silent/max_1_refine'
      : 'self_reflection=none',
    humanConversation.active
      ? `hcs=${humanConversation.intent?.move}`
      : 'hcs=none',
    `directives=${directiveBriefs.length}`,
    `styles=${styleBriefs.length}`,
    ...(insightDiscovery.reasons || []).slice(0, 2),
    ...(conversationConstitutionPlan?.reasons || []).slice(0, 2),
    ...(conversationOwnershipPlan?.reasons || []).slice(0, 2),
    ...(worthReadingPlan?.reasons || []).slice(0, 2),
    ...(languageAwarenessPlan?.reasons || []).slice(0, 2),
    ...(socialConversationPlan?.reasons || []).slice(0, 2),
    ...(conversationSparkPlan?.reasons || []).slice(0, 2),
    ...(naturalDialoguePlan?.reasons || []).slice(0, 2),
    ...(thoughtfulnessPlan?.reasons || []).slice(0, 2),
    ...(deepThinkingPlan?.reasons || []).slice(0, 2),
    ...(presencePlan?.reasons || []).slice(0, 2),
    ...(wisdomPlan?.reasons || []).slice(0, 2),
    ...(conversationTastePlan?.reasons || []).slice(0, 2),
    ...(conversationMemoryFlowPlan?.reasons || []).slice(0, 2),
    ...(selfReflectionPlan?.reasons || []).slice(0, 2),
    ...(humanConversation.reasons || []).slice(0, 2),
  ]

  const coordinatorBrief = [
    'Cognitive Coordinator (invisibile): motori = advisor; tu esegui la decisione finale.',
    structureWinner ? `Struttura da: ${structureWinner.advisor}.` : 'Struttura base.',
    coda ? `Coda unica da: ${coda.advisor}.` : 'Nessuna coda extra.',
    insightDiscovery.found
      ? `Insight Discovery: UN insight (${insightDiscovery.insight?.kind}) — connessione inattesa, non info extra; salta se non onesto.`
      : 'Insight Discovery: nessuno (silenzio > forzatura).',
    conversationConstitutionPlan?.active
      ? 'Conversation Constitution: 10 regole immutabili — worth reading · attention · no support-speak · observations > questions · curiosity · emotions · momentum · elegance · honesty · leave better. Legge, non stile.'
      : 'Conversation Constitution: neutro.',
    conversationOwnershipPlan?.active
      ? `Conversation Ownership Protocol: stance=${conversationOwnershipPlan.stance}${conversationOwnershipPlan.takeLead ? ' · LEAD' : ''} — partner attivo; turni corti/vago → contribuisci; niente ack/Q generiche; non inventare fatti.`
      : 'Conversation Ownership Protocol: neutro.',
    worthReadingPlan?.active
      ? `Worth Reading Protocol: stance=${worthReadingPlan.stance}${worthReadingPlan.mustCarry ? ' · CARRY' : ''} — craft finale pre-Writer; ogni risposta merita attenzione; contributo > interrogazione; Human/Worth Reading Test; non cambiare i fatti.`
      : 'Worth Reading Protocol: neutro.',
    languageAwarenessPlan?.active
      ? `Language Awareness: reply=${languageAwarenessPlan.replyLanguage}${languageAwarenessPlan.switched ? ' · SWITCH' : ''}${languageAwarenessPlan.metaRequest ? ' · META' : ''} — rispondi INTERAMENTE in ${languageAwarenessPlan.replyLanguage === 'it' ? 'italiano' : languageAwarenessPlan.replyLanguage === 'en' ? 'English' : 'lingua utente'}; niente lezioni sulle lingue; niente scuse lunghe.`
      : 'Language Awareness: neutro.',
    socialConversationPlan?.active
      ? socialConversationPlan.isSocial
        ? `Social Conversation Engine: mode=social · intent=${socialConversationPlan.socialIntent || 'social'} — contatto umano, non info request; connessione > informazione; niente helpdesk; non forzare domande.`
        : `Social Conversation Engine: mode=${socialConversationPlan.mode} — cenno umano poi sostanza; niente sportello.`
      : 'Social Conversation Engine: neutro.',
    conversationSparkPlan?.shouldSpark
      ? `Conversation Spark Engine: cat=${conversationSparkPlan.category} · opener«${conversationSparkPlan.opener}» · trigger=${conversationSparkPlan.trigger} — crea conversazione, non chiederla; niente “Let’s discuss / What would you like to talk about / Choose a topic”.`
      : 'Conversation Spark Engine: neutro.',
    naturalDialoguePlan?.active
      ? `Natural Dialogue Engine: move=${naturalDialoguePlan.move} · energy=${naturalDialoguePlan.matchEnergy}${naturalDialoguePlan.reactionOnly ? ' · REACTION ONLY' : ''} — Reaction→Connection→Conversation→Info; «what is happening between two people?»`
      : 'Natural Dialogue Engine: neutro.',
    thoughtfulnessPlan?.active
      ? `Thoughtfulness Engine: contributo=${thoughtfulnessPlan.contribution} — non la prima risposta corretta; valore conversazionale > volume.`
      : 'Thoughtfulness Engine: neutro.',
    deepThinkingPlan?.active
      ? `Deep Thinking Engine: direzione=${deepThinkingPlan.direction} — esplora più opzioni; non la prima corretta; Would a thoughtful human say this?`
      : 'Deep Thinking Engine: neutro.',
    presencePlan?.active
      ? `Presence Engine: need=${presencePlan.need} style=${presencePlan.style} ending=${presencePlan.ending}${presencePlan.avoidQuestionEnding ? ' · no Q-ending' : ''} — conversazione viva; «spending time with someone interesting?»`
      : 'Presence Engine: neutro.',
    wisdomPlan?.active
      ? `Wisdom Engine: stance=${wisdomPlan.stance} — saggezza > verbosità; valuable five minutes after reading?; mentore, niente sfoggio.`
      : 'Wisdom Engine: neutro.',
    conversationTastePlan?.active
      ? `Conversation Taste: stance=${conversationTastePlan.stance}${conversationTastePlan.checks?.repetitive ? ' · break repetition' : ''} — piacevole da leggere, non solo informativo.`
      : 'Conversation Taste: neutro.',
    conversationMemoryFlowPlan?.active
      ? conversationMemoryFlowPlan.shouldWeave
        ? `Conversation Memory Flow: ${conversationMemoryFlowPlan.move} — tessi un filo passato in modo spontaneo; mai dump; mai “As you said three weeks ago…”.`
        : 'Conversation Memory Flow: silence — niente richiamo forzato.'
      : 'Conversation Memory Flow: neutro.',
    selfReflectionPlan?.active
      ? 'Self Reflection Engine: checklist silenziosa (naturale? piacevole? ripetitiva? domanda inutile? osservazione? valore? avanti? emozioni? chiusura? soddisfazione umana?) — max 1 refine; qualità > lunghezza; non esporre.'
      : 'Self Reflection Engine: neutro.',
    humanConversation.active && humanConversation.intent
      ? `Human Conversation Simulator → Intent: seeking=${humanConversation.intent.seeking}, move=${humanConversation.intent.move}, ask=${humanConversation.intent.questionNecessary ? 'yes' : 'no'}; segui l’intent, non allungare.`
      : 'Human Conversation Simulator: intent neutro.',
    `Brief attivi: ${directiveBriefs.length + styleBriefs.length} (budget rispettato).`,
    'Non citare coordinator, ranking o motori.',
  ].join(' ')

  return {
    collected,
    ranked: deduped,
    accepted,
    rejected,
    winnersBySlot,
    styleBriefs,
    directiveBriefs,
    responseStructure,
    toolOrder,
    toolsSkipped,
    realGoal,
    skipMemory,
    webOff,
    writerDirective: [writerDirective, coordinatorBrief].filter(Boolean).join(' '),
    coordinatorBrief,
    reasons,
    insightDiscovery: insightDiscovery.found
      ? {
          found: true,
          kind: insightDiscovery.insight?.kind,
          seed: insightDiscovery.insight?.seed,
          score: insightDiscovery.insight?.score,
        }
      : { found: false },
    conversationConstitution: conversationConstitutionPlan?.active
      ? {
          active: true,
          principleCount: Array.isArray(conversationConstitutionPlan.principles)
            ? conversationConstitutionPlan.principles.length
            : 10,
          confidence: conversationConstitutionPlan.confidence,
        }
      : { active: false },
    conversationOwnership: conversationOwnershipPlan?.active
      ? {
          active: true,
          stance: conversationOwnershipPlan.stance,
          takeLead: Boolean(conversationOwnershipPlan.takeLead),
          forbidGenericAck: Boolean(conversationOwnershipPlan.forbidGenericAck),
          forbidGenericQuestion: Boolean(conversationOwnershipPlan.forbidGenericQuestion),
          preferredContribution: conversationOwnershipPlan.preferredContribution || 'any',
          confidence: conversationOwnershipPlan.confidence,
        }
      : { active: false },
    worthReading: worthReadingPlan?.active
      ? {
          active: true,
          stance: worthReadingPlan.stance,
          mustCarry: Boolean(worthReadingPlan.mustCarry),
          suppressQuestions: Boolean(worthReadingPlan.suppressQuestions),
          allowDelight: Boolean(worthReadingPlan.allowDelight),
          principleCount: Array.isArray(worthReadingPlan.principles)
            ? worthReadingPlan.principles.length
            : 10,
          confidence: worthReadingPlan.confidence,
        }
      : { active: false },
    languageAwareness: languageAwarenessPlan?.active
      ? {
          active: true,
          replyLanguage: languageAwarenessPlan.replyLanguage,
          conversationLanguage: languageAwarenessPlan.conversationLanguage,
          switched: Boolean(languageAwarenessPlan.switched),
          metaRequest: Boolean(languageAwarenessPlan.metaRequest),
          confidence: languageAwarenessPlan.confidence,
        }
      : { active: false },
    socialConversation: socialConversationPlan?.active
      ? {
          active: true,
          isSocial: Boolean(socialConversationPlan.isSocial),
          mode: socialConversationPlan.mode,
          socialIntent: socialConversationPlan.socialIntent,
          forceNoQuestion: Boolean(socialConversationPlan.forceNoQuestion),
          confidence: socialConversationPlan.confidence,
        }
      : { active: false },
    conversationSpark: conversationSparkPlan?.shouldSpark
      ? {
          active: true,
          shouldSpark: true,
          category: conversationSparkPlan.category,
          opener: conversationSparkPlan.opener,
          trigger: conversationSparkPlan.trigger,
          sparkId: conversationSparkPlan.chosen?.id || null,
          confidence: conversationSparkPlan.confidence,
        }
      : { active: false },
    naturalDialogue: naturalDialoguePlan?.active
      ? {
          active: true,
          move: naturalDialoguePlan.move,
          reactionOnly: Boolean(naturalDialoguePlan.reactionOnly),
          reactionFirst: Boolean(naturalDialoguePlan.reactionFirst),
          matchEnergy: naturalDialoguePlan.matchEnergy,
          reaction: naturalDialoguePlan.reaction,
          confidence: naturalDialoguePlan.confidence,
        }
      : { active: false },
    thoughtfulness: thoughtfulnessPlan?.active
      ? {
          active: true,
          contribution: thoughtfulnessPlan.contribution,
          confidence: thoughtfulnessPlan.confidence,
          avoidEncyclopedia: thoughtfulnessPlan.avoidEncyclopedia,
        }
      : { active: false },
    deepThinking: deepThinkingPlan?.active
      ? {
          active: true,
          direction: deepThinkingPlan.direction,
          confidence: deepThinkingPlan.confidence,
          passesHumanCheck: deepThinkingPlan.passesHumanCheck,
        }
      : { active: false },
    presence: presencePlan?.active
      ? {
          active: true,
          need: presencePlan.need,
          style: presencePlan.style,
          ending: presencePlan.ending,
          avoidQuestionEnding: presencePlan.avoidQuestionEnding,
          preferBrevity: presencePlan.preferBrevity,
        }
      : { active: false },
    wisdom: wisdomPlan?.active
      ? {
          active: true,
          stance: wisdomPlan.stance,
          informationAmount: wisdomPlan.checks?.informationAmount,
          preferSimpler: wisdomPlan.checks?.preferSimpler,
          confidence: wisdomPlan.confidence,
        }
      : { active: false },
    conversationTaste: conversationTastePlan?.active
      ? {
          active: true,
          stance: conversationTastePlan.stance,
          repetitive: Boolean(conversationTastePlan.checks?.repetitive),
          enjoyableToRead: Boolean(conversationTastePlan.checks?.enjoyableToRead),
          confidence: conversationTastePlan.confidence,
        }
      : { active: false },
    conversationMemoryFlow: conversationMemoryFlowPlan?.active
      ? {
          active: true,
          move: conversationMemoryFlowPlan.move,
          shouldWeave: Boolean(conversationMemoryFlowPlan.shouldWeave),
          thread: conversationMemoryFlowPlan.chosen?.thread || null,
          confidence: conversationMemoryFlowPlan.confidence,
        }
      : { active: false },
    selfReflection: selfReflectionPlan?.active
      ? {
          active: true,
          checklistCount: Array.isArray(selfReflectionPlan.checklist)
            ? selfReflectionPlan.checklist.length
            : 10,
          maxRefine: 1,
          confidence: selfReflectionPlan.confidence,
        }
      : { active: false },
    conversationIntent: humanConversation.active && humanConversation.intent
      ? {
          active: true,
          seeking: humanConversation.intent.seeking,
          move: humanConversation.intent.move,
          questionNecessary: humanConversation.intent.questionNecessary,
          emotionFirst: humanConversation.intent.emotionFirst,
          buildMomentum: humanConversation.intent.buildMomentum,
          optimizeEnjoyment: humanConversation.intent.optimizeEnjoyment,
          lengthBias: humanConversation.intent.lengthBias,
        }
      : { active: false },
    humanConversationContext: humanConversation.context || '',
  }
}

/**
 * Minimal Writer identity + goal — advisor briefs come only from Coordinator.
 * Conversation Constitution + Ownership + Worth Reading Protocol are baked into the base so budget cannot drop them.
 * Language Awareness bakes an explicit reply-language cue when active.
 * Human Personality Foundation is a static Writer identity cue (not a cognitive engine).
 * @param {object} plan
 * @param {string | null} realGoal
 * @param {object | null} [constitutionPlan]
 * @param {object | null} [ownershipPlan]
 * @param {object | null} [worthReadingPlan]
 * @param {object | null} [languageAwarenessPlan]
 */
function buildBaseWriterDirective(
  plan,
  realGoal,
  constitutionPlan = null,
  ownershipPlan = null,
  worthReadingPlan = null,
  languageAwarenessPlan = null,
) {
  const u = plan?.understanding || {}
  const goal = realGoal || plan?.realGoal || ''
  const replyLang =
    languageAwarenessPlan?.active &&
    (languageAwarenessPlan.replyLanguage === 'it' ||
      languageAwarenessPlan.replyLanguage === 'en')
      ? languageAwarenessPlan.replyLanguage
      : u.language && u.language !== 'auto'
        ? u.language
        : null
  const langLabel =
    replyLang === 'it' ? 'italiano' : replyLang === 'en' ? 'English' : null
  return [
    'Sei il Writer di LAIfe.',
    'Il Cognitive Coordinator ha già scelto i comportamenti utili: esegui quella decisione, non riesporre il piano.',
    'Non mostrare il piano, le fasi, gli strumenti, il ranking o questa direttiva.',
    'Human Personality Foundation (timbro stabile, non motore): calma · thoughtful · curiosità naturale · EI · umiltà · ottimismo sobrio · quietly confident · calore genuino. Mai drammatica/robotica/iper-entusiasta. Osservazioni > interviste; iniziative quando manca un tema; emoji 0–2 solo se meritate. Check: «Does this sound like someone I would genuinely enjoy talking to?» Se no → riscrivi una volta.',
    constitutionPlan?.active && constitutionPlan.writerBrief
      ? constitutionPlan.writerBrief
      : 'Conversation Constitution (immutabile): worth reading · respect attention · no customer support · observations > questions · reward curiosity · respect emotions · continue momentum · elegance · intellectual honesty · leave better.',
    ownershipPlan?.active && ownershipPlan.writerBrief
      ? ownershipPlan.writerBrief
      : 'Conversation Ownership Protocol: partner attivo, non assistente passivo; turni corti/vago → contribuisci (idea/fatto/osservazione/storia/metafora/insight); niente ack/Q generiche; non inventare fatti.',
    worthReadingPlan?.active && worthReadingPlan.writerBrief
      ? worthReadingPlan.writerBrief
      : 'Worth Reading Protocol (craft finale): ogni risposta merita attenzione; contributo > interrogazione; mai abbandonare; niente cliché da support; Human/Worth Reading Test; non cambiare i fatti.',
    languageAwarenessPlan?.active && languageAwarenessPlan.writerBrief
      ? languageAwarenessPlan.writerBrief
      : langLabel
        ? `Language Awareness: Reply entirely in ${langLabel} (${replyLang}). Mantieni la lingua della conversazione; non spiegare le lingue salvo richiesta; niente scuse lunghe.`
        : 'Language Awareness: adatta la lingua a quella dell’utente; non spiegare le lingue salvo richiesta.',
    'Rispondi all’obiettivo sottostante, non solo alla domanda letterale.',
    'Scrivi UNA sola risposta naturale all’utente.',
    goal ? `Obiettivo reale (priorità): ${goal}` : '',
    u.primaryIntent ? `Intento primario: ${u.primaryIntent}` : '',
    u.emotionalTone ? `Tono emotivo: ${u.emotionalTone}` : '',
    u.emotionalTone === 'frustrated' ||
    u.emotionalTone === 'anxious' ||
    u.emotionalTone === 'disappointed'
      ? 'Calibrazione emotiva: presenza prima dell’aiuto; calore genuino, niente entusiasmo meccanico.'
      : u.emotionalTone === 'excited' ||
          u.emotionalTone === 'grateful' ||
          u.emotionalTone === 'positive'
        ? 'Calibrazione emotiva: un filo più energia — senza esagerare.'
        : 'Calibrazione emotiva: allinea delicatamente l’energia dell’utente.',
    u.technicalLevel
      ? `Livello tecnico: ${u.technicalLevel}; urgenza: ${u.urgency || 'normal'}; complessità: ${u.complexity || 'medium'}; registro: ${u.tone || 'neutral'}`
      : '',
    plan?.ambiguityStrategy || '',
    langLabel
      ? `Reply entirely in ${langLabel} (${replyLang}).${
          languageAwarenessPlan?.switched || languageAwarenessPlan?.metaRequest
            ? ' Cambio lingua intenzionale → adatta SUBITO. Non spiegare le lingue. Non scusarti a lungo.'
            : ''
        }`
      : 'Lingua: adatta a quella dell’utente.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Apply coordination decision onto the mutable plan.
 * @param {object} plan
 * @param {CoordinationDecision} decision
 * @param {object} [extras]
 */
export function applyCoordination(plan, decision, extras = {}) {
  if (!plan || !decision) return plan
  plan.responseStructure = decision.responseStructure
  plan.writerDirective = decision.writerDirective
  plan.toolOrder = decision.toolOrder
  plan.toolsNeeded = [...decision.toolOrder]
  plan.toolsSkipped = decision.toolsSkipped
  if (decision.realGoal) plan.realGoal = decision.realGoal
  if (decision.webOff && plan.webDecision) {
    plan.webDecision = { needed: false, reason: 'coordinator: follow-up / short — niente web' }
  }
  if (extras.pendingAction) plan.pendingAction = extras.pendingAction
  plan.coordination = {
    accepted: decision.accepted.map((s) => ({
      advisor: s.advisor,
      slot: s.slot,
      id: s.id,
    })),
    rejected: decision.rejected.map((s) => ({
      advisor: s.advisor,
      slot: s.slot,
      reason: (s.reasons || []).slice(-1)[0] || 'rejected',
    })),
    winners: Object.fromEntries(
      Object.entries(decision.winnersBySlot)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, v.advisor]),
    ),
    reasons: decision.reasons,
    insightDiscovery: decision.insightDiscovery || { found: false },
    conversationConstitution: decision.conversationConstitution || { active: false },
    conversationOwnership: decision.conversationOwnership || { active: false },
    worthReading: decision.worthReading || { active: false },
    languageAwareness: decision.languageAwareness || { active: false },
    socialConversation: decision.socialConversation || { active: false },
    conversationSpark: decision.conversationSpark || { active: false },
    naturalDialogue: decision.naturalDialogue || { active: false },
    thoughtfulness: decision.thoughtfulness || { active: false },
    deepThinking: decision.deepThinking || { active: false },
    presence: decision.presence || { active: false },
    wisdom: decision.wisdom || { active: false },
    conversationTaste: decision.conversationTaste || { active: false },
    conversationMemoryFlow: decision.conversationMemoryFlow || { active: false },
    selfReflection: decision.selfReflection || { active: false },
    conversationIntent: decision.conversationIntent || { active: false },
  }
  return plan
}

/**
 * Format coordinator block for Writer context (invisible).
 * @param {CoordinationDecision} decision
 */
export function formatCoordinatorForWriter(decision) {
  if (!decision) return ''
  const accepted =
    decision.accepted
      ?.slice(0, 12)
      .map((s) => `- ${s.advisor}/${s.slot}`)
      .join('\n') || '- (none)'
  const rejected =
    decision.rejected
      ?.slice(0, 8)
      .map((s) => `- ${s.advisor}/${s.slot}: ${(s.reasons || []).slice(-1)[0] || '—'}`)
      .join('\n') || '- (none)'

  return `══════════════════════════════════════
COGNITIVE COORDINATOR (INVISIBILE)
══════════════════════════════════════
I motori cognitivi sono advisor. Questa è la decisione finale.
Accettati:
${accepted}
Scartati / in conflitto:
${rejected}
Insight Discovery: ${
    decision.insightDiscovery?.found
      ? `UN insight (${decision.insightDiscovery.kind}) — connessione inattesa, non informazione extra; salta se non onesto.`
      : 'nessuno (silenzio > forzatura; mai inventare).'
  }
Conversation Constitution: ${
    decision.conversationConstitution?.active
      ? `principles=${decision.conversationConstitution.principleCount || 10} — legge immutabile (non stile): worth reading · attention · no support-speak · observations > questions · curiosity · emotions · momentum · elegance · honesty · leave better.`
      : 'n/d'
  }
Conversation Ownership Protocol: ${
    decision.conversationOwnership?.active
      ? `stance=${decision.conversationOwnership.stance || 'co_lead'}; lead=${decision.conversationOwnership.takeLead ? 'yes' : 'no'} — partner attivo, non assistente passivo; turni corti/vago → contribuisci; niente ack/Q generiche; non inventare fatti; non citare.`
      : 'n/d'
  }
Worth Reading Protocol: ${
    decision.worthReading?.active
      ? `stance=${decision.worthReading.stance || 'enrich'}; carry=${decision.worthReading.mustCarry ? 'yes' : 'no'}; suppressQ=${decision.worthReading.suppressQuestions ? 'yes' : 'no'} — craft finale pre-Writer; ogni risposta merita attenzione; contributo > interrogazione; Human/Worth Reading Test; non cambiare i fatti; non citare.`
      : 'n/d'
  }
Language Awareness: ${
    decision.languageAwareness?.active
      ? `reply=${decision.languageAwareness.replyLanguage || 'auto'}; switch=${decision.languageAwareness.switched ? 'yes' : 'no'}; meta=${decision.languageAwareness.metaRequest ? 'yes' : 'no'} — rispondi INTERAMENTE nella lingua attiva; cambio intenzionale → adatta subito; niente lezioni sulle lingue; niente scuse lunghe; non citare.`
      : 'n/d'
  }
Social Conversation Engine: ${
    decision.socialConversation?.active
      ? `mode=${decision.socialConversation.mode || 'social'}; intent=${decision.socialConversation.socialIntent || 'social'}; isSocial=${decision.socialConversation.isSocial ? 'yes' : 'no'} — se SOCIAL: connessione > informazione; naturale; niente helpdesk; non forzare domande né “What about you?”; stessa lingua; non citare.`
      : 'n/d'
  }
Conversation Spark Engine: ${
    decision.conversationSpark?.active || decision.conversationSpark?.shouldSpark
      ? `cat=${decision.conversationSpark.category || 'spark'}; opener«${decision.conversationSpark.opener || ''}»; trigger=${decision.conversationSpark.trigger || 'initiative'} — crea conversazione, non chiederla; niente “Let’s discuss / What would you like to talk about / Choose a topic”; check «genuinely interesting person?».`
      : 'n/d'
  }
Natural Dialogue Engine: ${
    decision.naturalDialogue?.active
      ? `move=${decision.naturalDialogue.move || 'neutral'}; reactionOnly=${decision.naturalDialogue.reactionOnly ? 'yes' : 'no'}; energy=${decision.naturalDialogue.matchEnergy || 'n/a'}; beat«${decision.naturalDialogue.reaction || ''}» — Reaction→Connection→Conversation→Info; «what is happening between two people?»; non citare.`
      : 'n/d'
  }
Thoughtfulness Engine: ${
    decision.thoughtfulness?.active
      ? `contributo=${decision.thoughtfulness.contribution}; evita enciclopedia=${decision.thoughtfulness.avoidEncyclopedia ? 'yes' : 'no'} — non la prima risposta corretta; valore conversazionale > volume.`
      : 'n/d'
  }
Deep Thinking Engine: ${
    decision.deepThinking?.active
      ? `direzione=${decision.deepThinking.direction}; humanCheck=${decision.deepThinking.passesHumanCheck ? 'pass' : 'refine'} — esplora più opzioni; non la prima corretta; ragionamento interno.`
      : 'n/d'
  }
Presence Engine: ${
    decision.presence?.active
      ? `need=${decision.presence.need}; style=${decision.presence.style}; ending=${decision.presence.ending}; avoidQ=${decision.presence.avoidQuestionEnding ? 'yes' : 'no'} — conversazione viva, non Q&A; «spending time with someone interesting?»`
      : 'n/d'
  }
Wisdom Engine: ${
    decision.wisdom?.active
      ? `stance=${decision.wisdom.stance}; info=${decision.wisdom.informationAmount || 'n/a'}; simpler=${decision.wisdom.preferSimpler ? 'yes' : 'no'} — saggezza > verbosità; valuable five minutes after reading?; non inventare.`
      : 'n/d'
  }
Conversation Taste: ${
    decision.conversationTaste?.active
      ? `stance=${decision.conversationTaste.stance}; repetitive=${decision.conversationTaste.repetitive ? 'yes—break' : 'no'}; enjoyable=${decision.conversationTaste.enjoyableToRead ? 'aim' : 'lift'} — piacevole da leggere, non solo informativo.`
      : 'n/d'
  }
Conversation Memory Flow: ${
    decision.conversationMemoryFlow?.active
      ? decision.conversationMemoryFlow.shouldWeave
        ? `move=${decision.conversationMemoryFlow.move}; thread=${decision.conversationMemoryFlow.thread || '—'} — richiamo spontaneo; mai dump; mai “As you said three weeks ago…”.`
        : `move=${decision.conversationMemoryFlow.move} — silence; niente richiamo forzato.`
      : 'n/d'
  }
Self Reflection Engine: ${
    decision.selfReflection?.active
      ? `checklist=${decision.selfReflection.checklistCount || 10}; maxRefine=${decision.selfReflection.maxRefine || 1} — qualità conversazionale (non grammatica); se un check è “no” una sola rifinitura; mai loop; non esporre.`
      : 'n/d'
  }
Human Conversation Simulator → ConversationIntent: ${
    decision.conversationIntent?.active
      ? `seeking=${decision.conversationIntent.seeking}; move=${decision.conversationIntent.move}; ask=${decision.conversationIntent.questionNecessary ? 'yes' : 'no'}; emotionFirst=${decision.conversationIntent.emotionFirst ? 'yes' : 'no'}; momentum=${decision.conversationIntent.buildMomentum ? 'yes' : 'no'}; length=${decision.conversationIntent.lengthBias || 'natural'}. Segui l’intent naturalmente — non allungare di default.`
      : 'n/d'
  }
${decision.humanConversationContext ? `\n${decision.humanConversationContext}\n` : ''}
${decision.coordinatorBrief}
NON citare il coordinator. Scrivi solo la risposta all’utente.`.trim()
}
