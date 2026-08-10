/**
 * LAIfe Cognitive Engine — Response Planning (invisible) before every answer.
 *
 * Pipeline (never shown to the user):
 * 0. Social Conversation Engine — SOCIAL vs INFORMATIONAL (before Intent)
 * 0a. Conversation Intent — why the user wrote (guides all later planning)
 * 0b. Conversation Leadership — how to guide the turn (continue / insight / story / …)
 * 0c. Thoughtfulness Engine — best conversational contribution (not first correct answer)
 * 0d. Deep Thinking → Presence → Wisdom → Taste → Memory Flow → Self Reflection → Constitution
 * 1. Understand the user's real intent
 * 2. Detect emotional tone
 * 3. Retrieve relevant memories
 * 4. Decide whether web search is needed
 * 5. Identify possible ambiguities
 * 6. Build a response plan (advisors propose)
 * 7. Cognitive Coordinator ranks / dedupes / resolves → final behaviors
 * 8. Directive Authority → immutable WriterDirectives (mandatory, not suggestions)
 * 8a. Natural Dialogue Engine — conversational moves + reaction-first rhythm (pre-directives)
 * 8a2. Conversational Pragmatics Engine — intended meaning > literal (pre-directives)
 * 8b. Conversation Spark Engine — natural initiative openings (not AI topic-hunting)
 * 9. Hand off to the Writer → generate the final answer
 *
 * Engines are advisors. The Cognitive Coordinator is the final decision maker.
 * Directive Authority freezes Coordinator + stage decisions into WriterDirectives.
 * Never let multiple engines compete for the same part of the response.
 */

import {
  planTools,
  executeTools,
  buildOrchestratorContext,
  refineToolSelection,
  needsFreshnessOrVerification,
} from './orchestrator.js'
import { runConversationIntelligence } from './conversation-intelligence.js'
import { runConversationMemoryMap, applyMemoryMapToSession } from './conversation-memory-map.js'
import { runTaskPlanner } from './task-planner.js'
import { runMultiStepTaskPlanner } from './multi-step-task-planner.js'
import { runConversationReflection } from './conversation-reflection.js'
import { runConversationContinuation } from './conversation-continuation.js'
import { runCuriosityEngine } from './curiosity-engine.js'
import { runNextAskPrediction } from './next-ask-prediction.js'
import { runConversationMomentum } from './conversation-momentum.js'
import { runIntellectualInitiativeEngine } from './intellectual-initiative.js'
import { runSurpriseWithoutConfusion } from './surprise-without-confusion.js'
import {
  buildProgressivePlan,
  formatProgressivePlanForWriter,
} from './progressive-reasoning.js'
import {
  selectAdaptiveStrategy,
  formatAdaptiveStrategyForWriter,
} from './adaptive-reasoning.js'
import { formatPrioritizationForWriter } from './info-prioritization.js'
import { runInformationValueEstimator } from './information-value-estimator.js'
import { runExpertTeacher } from './expert-teacher.js'
import { runUniversalActionEngine } from './action-engine/index.js'
import { runPluginArchitecture } from './plugins/index.js'
import { runVoiceConversationEngine } from './voice-conversation.js'
import { runWelcomeEngine } from './welcome-engine.js'
import { runTopicLeadershipEngine } from './topic-leadership.js'
import {
  runConversationSparkEngine,
  conversationSparkStructureHints,
} from './conversation-spark-engine.js'
import {
  runNaturalDialogueEngine,
  naturalDialogueStructureHints,
} from './natural-dialogue-engine.js'
import {
  runConversationalPragmaticsEngine,
  conversationalPragmaticsStructureHints,
} from './conversational-pragmatics-engine.js'
import {
  runNarrativeConversationEngine,
  narrativeConversationStructureHints,
} from './narrative-conversation-engine.js'
import {
  runEmotionalMomentumEngine,
  emotionalMomentumStructureHints,
} from './emotional-momentum-engine.js'
import {
  runPersonalityConsistencyEngine,
  personalityConsistencyStructureHints,
} from './personality-consistency-engine.js'
import {
  runPersonalVoiceEngine,
  personalVoiceStructureHints,
} from './personal-voice-engine.js'
import {
  runHumanImperfectionEngine,
  humanImperfectionStructureHints,
} from './human-imperfection-engine.js'
import {
  runConversationalMemoryEngine,
  conversationalMemoryStructureHints,
} from './conversational-memory-engine.js'
import {
  runGenuineCuriosityEngine,
  genuineCuriosityStructureHints,
} from './genuine-curiosity-engine.js'
import {
  runDeepListeningEngine,
  deepListeningStructureHints,
} from './deep-listening-engine.js'
import {
  runConversationPaceEngine,
  conversationPaceStructureHints,
} from './conversation-pace-engine.js'
import {
  runNaturalTopicTransitionEngine,
  naturalTopicTransitionStructureHints,
} from './natural-topic-transition-engine.js'
import {
  runAuthenticAgreementEngine,
  authenticAgreementStructureHints,
} from './authentic-agreement-engine.js'
import {
  runConversationRecoveryEngine,
  conversationRecoveryStructureHints,
} from './conversation-recovery-engine.js'
import {
  runInternalMonologueEngine,
  internalMonologueStructureHints,
} from './internal-monologue-engine.js'
import {
  runMicroObservationEngine,
  microObservationStructureHints,
} from './micro-observation-engine.js'
import {
  runHumanConversationScoreGate,
  humanConversationScoreStructureHints,
} from './human-conversation-score.js'
import {
  runEmotionalResonanceEngine,
  emotionalResonanceStructureHints,
} from './emotional-resonance-engine.js'
import {
  runWonderEngine,
  wonderStructureHints,
} from './wonder-engine.js'
import {
  runSharedDiscoveryEngine,
  sharedDiscoveryStructureHints,
} from './shared-discovery-engine.js'
import {
  runConversationChemistryEngine,
  conversationChemistryStructureHints,
} from './conversation-chemistry-engine.js'
import {
  runIntelligentSilenceEngine,
  intelligentSilenceStructureHints,
} from './intelligent-silence-engine.js'
import {
  runStorytellingEngine,
  storytellingStructureHints,
} from './storytelling-engine.js'
import {
  runEmotionalContinuityEngine,
  emotionalContinuityStructureHints,
} from './emotional-continuity-engine.js'
import {
  runHumanTimingEngine,
  humanTimingStructureHints,
} from './human-timing-engine.js'
import {
  runConversationalCreativityEngine,
  conversationalCreativityStructureHints,
} from './conversational-creativity-engine.js'
import {
  runAuthenticOpinionsEngine,
  authenticOpinionsStructureHints,
} from './authentic-opinions-engine.js'
import {
  runConversationOpportunityEngine,
  conversationOpportunityStructureHints,
  deriveEmotionalState,
} from './conversation-opportunity-engine.js'
import {
  runConversationPlannerEngine,
  conversationPlannerStructureHints,
} from './conversation-planner-engine.js'
import {
  runConversationOpeningEngine,
  conversationOpeningStructureHints,
} from './conversation-opening-engine.js'
import {
  runOpeningIntelligenceEngine,
  openingIntelligenceStructureHints,
} from './opening-intelligence-engine.js'
import {
  runSmallTalkIntelligenceEngine,
  smallTalkIntelligenceStructureHints,
} from './small-talk-intelligence-engine.js'
import { runDynamicBehaviorModel } from './dynamic-behavior.js'
import {
  runKnowledgeLevelEstimator,
  toLegacyTechnicalLevel,
} from './knowledge-level-estimator.js'
import { runLifeIntelligenceEngine } from './life-intelligence.js'
import { runNaturalLanguageAutomationBuilder } from './nl-automation-builder.js'
import { runUniversalDeviceManager } from './device-manager/index.js'
import { runIntellectualHonesty } from './intellectual-honesty.js'
import { runAdaptiveSelfAwareness } from './adaptive-self-awareness.js'
import { runWarmConversation } from './warm-conversation.js'
import { runConversationalPresence } from './conversational-presence.js'
import { runQuestionEconomy } from './question-economy.js'
import { runConversationMindset } from './conversation-mindset.js'
import { runConversationDelight } from './conversation-delight.js'
import {
  runSocialConversationEngine,
  socialConversationStructureHints,
} from './social-conversation-engine.js'
import {
  runConversationIntent,
  conversationIntentStructureHints,
  emotionalIntentToTone,
} from './conversation-intent.js'
import {
  runConversationLeadership,
  conversationLeadershipStructureHints,
} from './conversation-leadership.js'
import {
  runThinkBeforeSpeaking,
  thinkBeforeSpeakingStructureHints,
} from './think-before-speaking.js'
import {
  runConversationDirector,
  conversationDirectorStructureHints,
} from './conversation-director.js'
import {
  runThoughtfulnessEngine,
  thoughtfulnessStructureHints,
} from './thoughtfulness-engine.js'
import {
  runDeepThinkingEngine,
  deepThinkingStructureHints,
} from './deep-thinking-engine.js'
import {
  runDeepThinkingWriter,
  deepThinkingWriterStructureHints,
} from './deep-thinking-writer.js'
import {
  runReasoningExpansionEngine,
  reasoningExpansionStructureHints,
} from './reasoning-expansion-engine.js'
import {
  runPresenceEngine,
  presenceStructureHints,
} from './presence-engine.js'
import {
  runResponseModeEngine,
  responseModeStructureHints,
} from './response-mode-engine.js'
import {
  runHumanConversationCorpus,
  humanConversationCorpusStructureHints,
} from './human-conversation-corpus.js'
import {
  runWisdomEngine,
  wisdomStructureHints,
} from './wisdom-engine.js'
import {
  runConversationTaste,
  conversationTasteStructureHints,
} from './conversation-taste.js'
import {
  runConversationMemoryFlow,
  conversationMemoryFlowStructureHints,
} from './conversation-memory-flow.js'
import {
  runSelfReflectionEngine,
  selfReflectionStructureHints,
} from './self-reflection-engine.js'
import {
  runConversationConstitution,
  conversationConstitutionStructureHints,
} from './conversation-constitution.js'
import {
  runHumanImpactConstitution,
  humanImpactConstitutionStructureHints,
} from './human-impact-constitution.js'
import {
  runProjectSoul,
  projectSoulStructureHints,
} from './project-soul.js'
import {
  runLaifeManifesto,
  laifeManifestoStructureHints,
} from './laife-manifesto.js'
import {
  runConversationOwnershipProtocol,
  conversationOwnershipStructureHints,
} from './conversation-ownership.js'
import {
  runWorthReadingProtocol,
  worthReadingStructureHints,
} from './worth-reading-protocol.js'
import {
  runLanguageAwareness,
  languageAwarenessStructureHints,
  persistConversationLanguage,
  detectDominantLanguage,
} from './language-awareness.js'
import {
  collectAdvisorSuggestions,
  runCognitiveCoordinator,
  applyCoordination,
  formatCoordinatorForWriter,
} from './cognitive-coordinator.js'
import {
  runDirectiveAuthority,
  formatWriterDirectivesForWriter,
} from './directive-authority.js'

/** @typedef {import('./orchestrator.js').ToolId} ToolId */
/** @typedef {import('./orchestrator.js').AttachmentHint} AttachmentHint */

const ALL_TOOLS = /** @type {ToolId[]} */ ([
  'memory',
  'web',
  'vision',
  'document',
  'calendar',
  'reminder',
  'weather',
  'calculator',
])

/**
 * @typedef {object} CognitiveInput
 * @property {string} userMessage
 * @property {AttachmentHint[]} [attachments]
 * @property {boolean} [memoryEnabled]
 * @property {Array<{ role: string, content: string }>} [messages]
 * @property {string} [priorUserMessage]
 * @property {string} [priorAssistantMessage]
 * @property {import('./conversation-reflection.js').LearningSignals | null} [priorLearningSignals]
 * @property {object | null} [pendingAction]  Stashed Universal Action awaiting confirmation
 * @property {string[]} [grantedPermissions]  OAuth / user-granted action scopes
 * @property {'text'|'voice'|string} [modality]  Conversation modality (voice → spoken style)
 * @property {boolean} [voice]  Shortcut for modality=voice
 * @property {object | null} [voiceSession]  Session-scoped voice interrupt/resume state
 * @property {object | null} [welcomeSession] Used greeting ids / welcome count
 * @property {string} [displayName]  User name for natural welcome
 * @property {string} [userId]
 * @property {string} [personalityBias]  Soft style bias from client settings (not a fixed persona)
 * @property {string} [personality]  Alias of personalityBias
 * @property {object | null} [lifeContext]  Optional multi-source life signals for Life Intelligence
 * @property {object | null} [pendingAutomation]  NL Automation Builder draft awaiting confirm/edit
 * @property {object | null} [conversationMemoryMap]  Prior Conversation Memory Map (client echo)
 * @property {object | null} [conversationPreferenceProfile]  Prior Conversation Preference Profile (client echo)
 */

/**
 * @typedef {'neutral'|'frustrated'|'anxious'|'confused'|'excited'|'grateful'|'curious'|'urgent'|'disappointed'|'positive'} EmotionalTone
 */

/**
 * @typedef {object} MessageUnderstanding
 * @property {string} primaryIntent
 * @property {string[]} secondaryRequests
 * @property {string} topic
 * @property {'beginner'|'intermediate'|'advanced'|'expert'} technicalLevel
 * @property {string} language
 * @property {'casual'|'neutral'|'formal'|'urgent'} tone
 * @property {EmotionalTone} emotionalTone
 * @property {'low'|'medium'|'high'} urgency
 * @property {'low'|'medium'|'high'} complexity
 * @property {string[]} ambiguities
 */

/**
 * @typedef {object} WebDecision
 * @property {boolean} needed
 * @property {string} reason
 */

/**
 * @typedef {object} InferredGoal
 * @property {string} id
 * @property {string} label
 * @property {number} score
 * @property {string[]} evidence
 */

/**
 * @typedef {object} GoalInference
 * @property {InferredGoal[]} candidates
 * @property {string|null} primary
 * @property {'high'|'medium'|'low'} confidence
 * @property {string[]} assumptions
 * @property {string} realGoal
 * @property {string} surfaceAsk
 */

/**
 * @typedef {object} CognitivePlan
 * @property {MessageUnderstanding} understanding
 * @property {string} realGoal
 * @property {string} surfaceAsk
 * @property {InferredGoal[]} inferredGoals
 * @property {'high'|'medium'|'low'} goalConfidence
 * @property {string[]} goalAssumptions
 * @property {ToolId[]} toolsNeeded
 * @property {ToolId[]} toolOrder
 * @property {ToolId[]} toolsSkipped
 * @property {WebDecision} webDecision
 * @property {string[]} ambiguities
 * @property {string} ambiguityStrategy
 * @property {string[]} responseStructure
 * @property {string} writerDirective
 * @property {import('./directive-authority.js').WriterDirectives | null} [writerDirectives]
 * @property {boolean} memoryRetrieved
 * @property {object} [progressive]
 * @property {object} [adaptive]
 * @property {object} [expertTeacher]
 */

function detectLanguage(text) {
  try {
    return detectDominantLanguage(text)
  } catch {
    const itHits =
      (text.match(/\b(che|come|sono|perché|perche|qual|voglio|mio|mia|non|con|una|degli|degli)\b/gi) || [])
        .length
    const enHits =
      (text.match(/\b(the|what|how|why|should|would|my|is|are|with|this|that|please)\b/gi) || [])
        .length
    if (itHits === 0 && enHits === 0) return 'auto'
    return itHits >= enHits ? 'it' : 'en'
  }
}

function detectTone(text) {
  if (/\b(urgente|subito|adesso|asap|immediately|urgent|help|aiuto|bloccato|broken)\b/i.test(text)) {
    return /** @type {const} */ ('urgent')
  }
  if (/\b(gentile|cordiali|la\s+prego|vorrei\s+chiederle|dear|please\s+kindly|could\s+you\s+please)\b/i.test(text)) {
    return /** @type {const} */ ('formal')
  }
  if (/\b(ciao|hey|lol|ahah|😅|😂|bro|raga)\b/i.test(text)) {
    return /** @type {const} */ ('casual')
  }
  return /** @type {const} */ ('neutral')
}

/**
 * Step 2 — Emotional tone (richer than register).
 * @param {string} text
 * @returns {EmotionalTone}
 */
export function detectEmotionalTone(text) {
  const t = String(text || '')
  if (
    /\b(arrabbiat[oa]|furios[oa]|insofferent|odioso|stupid[oa]|inutile|wtf|angry|pissed|furious)\b/i.test(
      t,
    ) ||
    /(!{2,}|\bMAI\b|\bNO\b.*!)/.test(t)
  ) {
    return 'frustrated'
  }
  if (
    /\b(ansios[oa]|preoccupat[oa]|ho\s+paura|mi\s+spaventa|worried|anxious|nervous|stressat[oa])\b/i.test(
      t,
    )
  ) {
    return 'anxious'
  }
  if (
    /\b(non\s+(?:ho\s+)?capito|sono\s+confus[oa]|non\s+mi\s+è\s+chiaro|confused|unclear|lost)\b/i.test(
      t,
    ) ||
    /\?\s*\?/.test(t)
  ) {
    return 'confused'
  }
  if (/\b(delus[oa]|sconfortat|triste|disappointed|upset|down)\b/i.test(t)) {
    return 'disappointed'
  }
  if (
    /\b(fantastico|geniale|evviva|yay|excited|amazing|super\s+contento|entusiast)\b/i.test(t) ||
    /🎉|🚀|✨/.test(t)
  ) {
    return 'excited'
  }
  if (/\b(grazie|thanks|thank\s+you|grateful|riconoscent)\b/i.test(t)) {
    return 'grateful'
  }
  if (/\b(curioso|mi\s+chiedevo|interesting|interessante|wonder|vorrei\s+sapere)\b/i.test(t)) {
    return 'curious'
  }
  if (/\b(urgente|subito|asap|bloccato|help|aiuto|critical)\b/i.test(t)) {
    return 'urgent'
  }
  if (/\b(bene|ottimo|perfetto|great|awesome|felice|contento)\b/i.test(t)) {
    return 'positive'
  }
  return 'neutral'
}

function detectUrgency(text, tone, emotionalTone) {
  if (tone === 'urgent' || emotionalTone === 'urgent' || emotionalTone === 'frustrated') {
    return /** @type {const} */ ('high')
  }
  if (/\b(prima\s+possibile|entro\s+oggi|deadline|scade|critical)\b/i.test(text)) {
    return /** @type {const} */ ('high')
  }
  if (/\b(quando\s+puoi|no\s+rush|quando\s+hai\s+tempo)\b/i.test(text)) {
    return /** @type {const} */ ('low')
  }
  return /** @type {const} */ ('medium')
}

function detectTechnicalLevel(text) {
  // Lightweight per-message heuristic; Knowledge Level Estimator refines continuously per topic.
  if (
    /\b(api|sdk|kubernetes|docker|typescript|postgres|oauth|latency|throughput|regex|async|await|ci\/cd|graphql|trade[\s-]?off|under\s+the\s+hood)\b/i.test(
      text,
    )
  ) {
    if (
      /\b(latency|throughput|idempoten|consensus|sharding|paxos|raft|cqrs|zero[\s-]?copy)\b/i.test(
        text,
      )
    ) {
      return /** @type {const} */ ('expert')
    }
    return /** @type {const} */ ('advanced')
  }
  if (
    /\b(codice|code|funzione|function|database|server|framework|git|deploy|bug|errore|error)\b/i.test(
      text,
    )
  ) {
    return /** @type {const} */ ('intermediate')
  }
  return /** @type {const} */ ('beginner')
}

function detectComplexity(text) {
  const len = text.length
  const clauses = (text.match(/[,:;]/g) || []).length
  const multiAsk = (text.match(/\?/g) || []).length > 1 || /\be\s+anche\b|\band\s+also\b/i.test(text)
  if (len > 280 || clauses > 6 || multiAsk) return /** @type {const} */ ('high')
  if (len > 100 || clauses > 2) return /** @type {const} */ ('medium')
  return /** @type {const} */ ('low')
}

function detectPrimaryIntent(text) {
  if (/\b(ciao|hey|hello|salve|buongiorno|buonasera)\b/i.test(text) && text.length < 40) {
    return 'greeting'
  }
  if (/\b(grazie|thanks|thank\s+you)\b/i.test(text) && text.length < 40) {
    return 'thanks'
  }
  if (/\b(confronta|vs|differenza|meglio\s+tra|compare|difference\s+between)\b/i.test(text)) {
    return 'comparison'
  }
  if (/\b(come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|spiegami\s+come|tutorial|guida)\b/i.test(text)) {
    return 'how_to'
  }
  if (/\b(perch[eé]|why|come\s+mai|spiegami|cos['']è|what\s+is|what\s+does)\b/i.test(text)) {
    return 'explanation'
  }
  if (/\b(consigli[oa]?|consigliami|mi\s+consigli|raccomand|suggerisc|miglior[ei]?|best|should\s+i| conviene)\b/i.test(text)) {
    return 'advice'
  }
  if (/\b(risolv|fix|debug|non\s+funziona|broken|error|errore|bug)\b/i.test(text)) {
    return 'problem_solving'
  }
  if (/\b(scrivi|genera|crea|draft|write|generate)\b/i.test(text)) {
    return 'creation'
  }
  if (/\b(calcola|quanto\s+fa|calculate)\b/i.test(text)) {
    return 'calculation'
  }
  if (text.includes('?')) return 'question'
  return 'conversation'
}

function detectSecondaryRequests(text) {
  /** @type {string[]} */
  const secondary = []
  if (/\besemp[iì]o|example|tipo\s+così\b/i.test(text)) secondary.push('wants_examples')
  if (/\bin\s+lista|step\s+by\s+step|elenco|bullet\b/i.test(text)) secondary.push('wants_list')
  if (/\bcodice|code\s+sample|snippet\b/i.test(text)) secondary.push('wants_code')
  if (/\bbreve|in\s+sintesi|tl;dr|short\b/i.test(text)) secondary.push('wants_brief')
  if (
    /\b(dettagliat|approfond|in\s+depth|explain\s+fully|in\s+profondit|a\s+fondo)\b/i.test(text)
  ) {
    secondary.push('wants_depth')
  }
  if (/\be\s+anche\b|\band\s+also\b|\binoltre\b/i.test(text)) secondary.push('multi_part')
  return secondary
}

function detectTopic(text) {
  const cleaned = text
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= 80) return cleaned
  return `${cleaned.slice(0, 77)}…`
}

/**
 * Step 5 — Identify possible ambiguities (plan only; never dump to user).
 * @param {string} userMessage
 * @param {MessageUnderstanding} understanding
 * @param {{ currentTopic?: string, followUpKind?: string } | null} [session]
 * @returns {string[]}
 */
export function detectAmbiguities(userMessage, understanding, session = null) {
  const text = String(userMessage || '').trim()
  /** @type {string[]} */
  const ambiguities = []

  if (
    /\b(questo|quello|questa|quella|ciò|it|this|that|these|those)\b/i.test(text) &&
    text.length < 120 &&
    !(session?.followUpKind === 'continue' || session?.followUpKind === 'ack')
  ) {
    ambiguities.push('riferimento vago (questo/quello/it) — risolvi dal filo di conversazione se possibile')
  }

  if (
    /\b(miglior[ei]?|best|ideale|ottim[oa])\b/i.test(text) &&
    !/\b(budget|prezzo|perché|perche|per\s+me|uso\s+(lavoro|gaming|studio|ufficio)|for\s+(work|gaming|school))\b/i.test(
      text,
    )
  ) {
    ambiguities.push('criterio di “migliore” non specificato — usa assunzioni ragionevoli e dichiarale in modo leggero')
  }

  if (
    understanding.primaryIntent === 'how_to' &&
    text.length < 50 &&
    !/\b(con|usando|in|su|via)\b/i.test(text)
  ) {
    ambiguities.push('contesto operativo scarso — procedi con lo scenario più comune e segnala l’assunzione')
  }

  if ((text.match(/\?/g) || []).length > 1) {
    ambiguities.push('più domande nello stesso messaggio — rispondi in ordine di priorità senza perdere il filo')
  }

  if (
    /\b(o|oppure|or)\b/i.test(text) &&
    /\?/.test(text) &&
    understanding.primaryIntent !== 'comparison'
  ) {
    ambiguities.push('scelta binaria poco definita — aiuta a decidere con criteri, non solo “dipende”')
  }

  if (
    session?.followUpKind === 'other' &&
    session?.currentTopic &&
    text.length < 40 &&
    !/\b(ciao|grazie|ok)\b/i.test(text)
  ) {
    ambiguities.push('messaggio breve: potrebbe riferirsi al tema corrente o a uno nuovo — preferisci continuità se plausibile')
  }

  return ambiguities
}

/**
 * Ambiguity strategy for the Writer.
 * @param {string[]} ambiguities
 * @param {EmotionalTone} emotionalTone
 */
export function buildAmbiguityStrategy(ambiguities, emotionalTone) {
  if (!ambiguities.length) {
    return 'Nessuna ambiguità rilevante: rispondi in modo diretto e utile.'
  }
  if (emotionalTone === 'confused' || emotionalTone === 'anxious') {
    return 'Ambiguità presenti: scegli l’interpretazione più utile e dichiara l’assunzione in una frase. Chiedi chiarimento solo se davvero bloccante (max 1 domanda).'
  }
  return 'Ambiguità presenti: procedi con l’interpretazione più probabile dal contesto; non interrogare l’utente. Una sola domanda solo se senza di essa non puoi essere utile.'
}

/**
 * Step 1+2 — Understand message + emotional tone (no user-facing text).
 * @param {string} userMessage
 * @returns {MessageUnderstanding}
 */
export function understandMessage(userMessage) {
  const text = String(userMessage || '').trim()
  const tone = detectTone(text)
  const emotionalTone = detectEmotionalTone(text)
  return {
    primaryIntent: detectPrimaryIntent(text),
    secondaryRequests: detectSecondaryRequests(text),
    topic: detectTopic(text),
    technicalLevel: detectTechnicalLevel(text),
    language: detectLanguage(text),
    tone,
    emotionalTone,
    urgency: detectUrgency(text, tone, emotionalTone),
    complexity: detectComplexity(text),
    ambiguities: [],
  }
}

/**
 * Heuristic signals for possible underlying goals (purchase / advice / comparison).
 * Evidence may come from the current message or recent conversation context.
 * @type {{ id: string, label: string, re: RegExp }[]}
 */
const UNDERLYING_GOAL_SIGNALS = [
  {
    id: 'portability',
    label: 'portabilità / leggerezza',
    re: /\b(portatil[ei]|legger[oa]|ultralegger|viagg|travel|commute|zaino|da\s+portare|thin\s+and\s+light|portable)\b/i,
  },
  {
    id: 'gaming',
    label: 'gaming / prestazioni grafiche',
    re: /\b(gaming|gioch[io]|fps|rtx|gpu|scheda\s+video|ray\s*tracing|valorant|fortnite)\b/i,
  },
  {
    id: 'battery',
    label: 'autonomia batteria',
    re: /\b(batteria|autonomia|battery|all[\s-]?day|tutto\s+il\s+giorno|caricabatterie)\b/i,
  },
  {
    id: 'programming',
    label: 'programmazione / sviluppo',
    re: /\b(programmazion[ei]|coding|developer|svilupp|codice|ide|compil|docker|linux|dev\s*work)\b/i,
  },
  {
    id: 'university',
    label: 'università / studio',
    re: /\b(universit(?:y|à|a)|studentes[sa]|lezioni|tesi|esame|school|college|campus|prendere\s+appunti)\b/i,
  },
  {
    id: 'budget',
    label: 'budget / rapporto qualità-prezzo',
    re: /\b(budget|economico|low[\s-]?cost|sotto\s+\d+|€\s*\d+|euro|prezzo|cheap|affordable|risparm)\b/i,
  },
  {
    id: 'performance',
    label: 'prestazioni / velocità',
    re: /\b(prestazion|potent[ei]|veloce|performance|fast|workstation|rendering|pesant[ei])\b/i,
  },
  {
    id: 'creative',
    label: 'creatività / editing',
    re: /\b(video\s*edit|photoshop|illustrator|premiere|davinci|design|foto|montaggio|creativ)\b/i,
  },
  {
    id: 'business',
    label: 'lavoro / ufficio',
    re: /\b(lavoro|ufficio|office|meeting|teams|excel|produttivit|business|aziend)\b/i,
  },
  {
    id: 'beginner_simplicity',
    label: 'semplicità / facilità d’uso',
    re: /\b(semplic[ei]|facile|principiant|non\s+tecnico|per\s+mia\s+madre|plug\s*and\s*play)\b/i,
  },
]

/**
 * Score underlying goal candidates from text + optional prior context.
 * @param {string} userMessage
 * @param {string} [contextText]
 * @returns {InferredGoal[]}
 */
export function scoreUnderlyingGoals(userMessage, contextText = '') {
  const text = `${String(userMessage || '')}\n${String(contextText || '')}`
  /** @type {InferredGoal[]} */
  const scored = []
  for (const signal of UNDERLYING_GOAL_SIGNALS) {
    const match = text.match(signal.re)
    if (!match) continue
    const inCurrent = signal.re.test(userMessage)
    scored.push({
      id: signal.id,
      label: signal.label,
      score: inCurrent ? 2 : 1,
      evidence: [match[0]],
    })
  }
  return scored.sort((a, b) => b.score - a.score)
}

/**
 * Whether the ask is a choice / recommendation that benefits from goal inference.
 * @param {string} text
 * @param {MessageUnderstanding} understanding
 */
function isGoalSensitiveAsk(text, understanding) {
  if (
    understanding.primaryIntent === 'advice' ||
    understanding.primaryIntent === 'comparison'
  ) {
    return true
  }
  return /\b(miglior[ei]?|best|consigli[oa]?|consigliami|mi\s+consigli|dovrei|should\s+i|which|quale|compr[oa]|buy|scegli[ea]r)\b/i.test(
    text,
  )
}

/**
 * Phase 2 — Infer the underlying / real goal (priority over the surface ask).
 * Tailors advice toward inferred objectives; when confidence is low, records assumptions.
 *
 * @param {string} userMessage
 * @param {MessageUnderstanding} understanding
 * @param {{ contextText?: string } | null} [opts]
 * @returns {GoalInference}
 */
export function inferRealGoal(userMessage, understanding, opts = null) {
  const text = String(userMessage || '').trim()
  const surface = text
  const contextText = String(opts?.contextText || '')
  const candidates = isGoalSensitiveAsk(text, understanding)
    ? scoreUnderlyingGoals(text, contextText)
    : []

  const top = candidates[0] || null
  const second = candidates[1] || null
  const tied =
    top &&
    candidates.filter((c) => c.score === top.score).map((c) => c.label)

  let confidence = /** @type {'high'|'medium'|'low'} */ ('low')
  if (top && top.score >= 2 && (!second || top.score > second.score)) confidence = 'high'
  else if (top && top.score >= 2 && second && top.score === second.score) confidence = 'medium'
  else if (top) confidence = 'medium'
  else confidence = 'low'

  /** @type {string[]} */
  const assumptions = []
  let primary =
    tied && tied.length > 1 ? tied.slice(0, 3).join(' + ') : top ? top.label : null

  const focusLabel = primary || (top ? top.label : null)

  // Purchase / "best X" without clear criteria
  if (
    /\b(miglior[ei]?|best|consigli[oa]?|consigliami|mi\s+consigli|which\s+.+\s+should\s+i\s+buy|che\s+.+\s+compro|quale\s+.+\s+compr|dovrei\s+compr)\b/i.test(
      text,
    )
  ) {
    if (confidence === 'high' && focusLabel) {
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions: [],
        realGoal: `Aiutare a scegliere orientando la raccomandazione su “${focusLabel}” (evidenza nel messaggio/contesto). Non scaricare una lista generica.`,
      }
    }
    if (confidence === 'medium' && focusLabel) {
      assumptions.push(
        `Obiettivo più probabile: ${focusLabel}${second && top && second.score < top.score ? ` (anche possibile: ${second.label})` : ''}.`,
      )
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions,
        realGoal: `Aiutare a scegliere con raccomandazione utile centrata su “${focusLabel}”, dichiarando brevemente l’assunzione se non era esplicita.`,
      }
    }
    // Low confidence — classic "Which laptop should I buy?"
    assumptions.push(
      'Obiettivo non esplicitato: possibili criteri nascosti (es. portabilità, gaming, batteria, programmazione, università, budget).',
    )
    assumptions.push(
      'Assunzione di lavoro: uso generale bilanciato, salvo indizi contrari nel contesto.',
    )
    return {
      surfaceAsk: surface,
      candidates,
      primary: null,
      confidence: 'low',
      assumptions,
      realGoal:
        'Inferire l’obiettivo sottostante e rispondere a quello — non solo alla domanda letterale. Dare una raccomandazione utile dichiarando in 1 frase le assunzioni (uso/budget/priorità). Evitare liste generiche senza criteri.',
    }
  }

  if (understanding.primaryIntent === 'problem_solving') {
    return {
      surfaceAsk: surface,
      candidates,
      primary,
      confidence: candidates.length ? confidence : 'medium',
      assumptions,
      realGoal: 'Sbloccare l’utente: diagnosi rapida + azione concreta verso l’obiettivo reale, poi dettagli se servono.',
    }
  }

  if (understanding.primaryIntent === 'how_to') {
    return {
      surfaceAsk: surface,
      candidates,
      primary,
      confidence: candidates.length ? confidence : 'medium',
      assumptions,
      realGoal: 'Far ottenere il risultato pratico desiderato (obiettivo sottostante), passo dopo passo, al livello tecnico giusto.',
    }
  }

  if (understanding.primaryIntent === 'advice' || understanding.primaryIntent === 'comparison') {
    if (confidence === 'high' && focusLabel) {
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions: [],
        realGoal: `Consigliare / confrontare in funzione di “${focusLabel}”, con trade-off chiari — non rispondere solo alla formulazione di superficie.`,
      }
    }
    if (focusLabel) {
      assumptions.push(`Orientamento inferito: ${focusLabel} (confidenza ${confidence}).`)
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions,
        realGoal: `Consigliare una direzione chiara centrata sull’obiettivo inferito “${focusLabel}”, dichiarando l’assunzione se la confidenza non è alta.`,
      }
    }
    assumptions.push('Criteri di scelta non chiari: dichiarare assunzioni brevi e dare comunque una direzione utile.')
    return {
      surfaceAsk: surface,
      candidates,
      primary: null,
      confidence: 'low',
      assumptions,
      realGoal:
        'Inferire l’obiettivo sottostante; consigliare con criteri e trade-off, dichiarando assunzioni se la confidenza è bassa — non solo elencare opzioni.',
    }
  }

  if (understanding.primaryIntent === 'explanation') {
    return {
      surfaceAsk: surface,
      candidates,
      primary,
      confidence: 'medium',
      assumptions,
      realGoal: 'Far capire il concetto in modo naturale, calibrato sul livello tecnico e sull’uso reale che interessa all’utente.',
    }
  }

  if (understanding.primaryIntent === 'creation') {
    return {
      surfaceAsk: surface,
      candidates,
      primary,
      confidence: 'medium',
      assumptions,
      realGoal: 'Produrre il pezzo richiesto in forma subito utilizzabile per lo scopo reale dell’utente.',
    }
  }

  if (understanding.primaryIntent === 'calculation') {
    return {
      surfaceAsk: surface,
      candidates,
      primary: null,
      confidence: 'high',
      assumptions: [],
      realGoal: 'Dare il risultato corretto in modo chiaro (e breve).',
    }
  }

  if (understanding.primaryIntent === 'greeting' || understanding.primaryIntent === 'thanks') {
    return {
      surfaceAsk: surface,
      candidates: [],
      primary: null,
      confidence: 'high',
      assumptions: [],
      realGoal: 'Rispondere in modo naturale e breve, senza sovrastrutturare.',
    }
  }

  return {
    surfaceAsk: surface,
    candidates,
    primary,
    confidence: candidates.length ? confidence : 'medium',
    assumptions,
    realGoal:
      'Soddisfare l’obiettivo sottostante (non solo la domanda letterale), in modo diretto, utile e coerente con il contesto della chat.',
  }
}

/**
 * Step 4 — Decide whether web search is needed.
 * @param {string} userMessage
 * @param {MessageUnderstanding} understanding
 * @param {ToolId[]} plannedTools
 * @returns {WebDecision}
 */
export function decideWebSearch(userMessage, understanding, plannedTools) {
  const text = String(userMessage || '')
  const planned = Array.isArray(plannedTools) && plannedTools.includes('web')

  const freshness =
    /\b(oggi|adesso|attuale|recente|ultime|now|latest|current|202[4-9])\b/i.test(text) ||
    /\b(cerca|ricerca|news|prezzo|quotazione|breaking)\b/i.test(text)

  if (
    understanding.primaryIntent === 'greeting' ||
    understanding.primaryIntent === 'thanks'
  ) {
    return { needed: false, reason: 'saluto/ringraziamento: nessuna ricerca' }
  }

  if (planned && freshness) {
    return { needed: true, reason: 'richiesta di informazione aggiornata / lookup esplicito' }
  }

  if (planned && !freshness) {
    return {
      needed: false,
      reason: 'web previsto ma senza freschezza: preferisci memoria/modello (percorso più semplice)',
    }
  }

  if (freshness && understanding.primaryIntent === 'question') {
    return { needed: true, reason: 'domanda con segnale di attualità' }
  }

  return { needed: false, reason: 'nessun segnale di ricerca web necessario' }
}

/**
 * Tool need + order / skips (supports steps 3–4).
 * @param {CognitiveInput} input
 * @param {MessageUnderstanding} understanding
 * @param {WebDecision} webDecision
 */
export function decideTools(input, understanding, webDecision) {
  const planned = planTools({
    userMessage: input.userMessage,
    attachments: input.attachments,
    memoryEnabled: input.memoryEnabled,
  })

  let toolOrder = [...planned]
  const text = String(input.userMessage || '')

  if (webDecision?.needed === false) {
    toolOrder = toolOrder.filter((t) => t !== 'web')
  } else if (webDecision?.needed === true && !toolOrder.includes('web')) {
    const memIdx = toolOrder.indexOf('memory')
    if (memIdx >= 0) toolOrder.splice(memIdx + 1, 0, 'web')
    else toolOrder.unshift('web')
  }

  const freshness =
    /\b(oggi|adesso|attuale|recente|ultime|now|latest|current|202[4-9])\b/i.test(text) ||
    /\b(cerca|ricerca|news|prezzo)\b/i.test(text)

  if (toolOrder.includes('memory') && toolOrder.includes('web') && !freshness) {
    toolOrder = toolOrder.filter((t) => t !== 'web')
  }

  if (understanding.urgency === 'high') {
    toolOrder = toolOrder.filter((t) => t !== 'calendar' && t !== 'reminder')
    if (!needsFreshnessOrVerification(input.userMessage)) {
      toolOrder = toolOrder.filter((t) => t !== 'web')
    }
  }

  if (
    understanding.primaryIntent === 'greeting' ||
    understanding.primaryIntent === 'thanks'
  ) {
    toolOrder = []
  }

  // Explanations / how-tos without freshness → prefer model knowledge
  if (
    (understanding.primaryIntent === 'explanation' ||
      understanding.primaryIntent === 'how_to' ||
      understanding.primaryIntent === 'creation') &&
    !needsFreshnessOrVerification(input.userMessage)
  ) {
    toolOrder = toolOrder.filter((t) => t !== 'web')
  }

  const toolsSkipped = ALL_TOOLS.filter((t) => !toolOrder.includes(t))

  return {
    toolsNeeded: [...toolOrder],
    toolOrder,
    toolsSkipped,
  }
}

/**
 * Step 6 — Ideal response structure (plan only, not prose).
 * @param {MessageUnderstanding} understanding
 * @param {string} realGoal
 * @param {string[]} secondary
 * @param {string[]} ambiguities
 */
export function outlineResponseStructure(understanding, realGoal, secondary, ambiguities = []) {
  /** @type {string[]} */
  const structure = []

  if (
    understanding.emotionalTone === 'frustrated' ||
    understanding.emotionalTone === 'anxious' ||
    understanding.emotionalTone === 'disappointed'
  ) {
    structure.push('Apri con riconoscimento breve dello stato + sblocco concreto (niente pep-talk)')
  } else if (understanding.emotionalTone === 'excited' || understanding.emotionalTone === 'grateful') {
    structure.push('Apri con calore naturale, poi vai al contenuto utile')
  } else if (understanding.urgency === 'high' || understanding.primaryIntent === 'problem_solving') {
    structure.push('Apri con la soluzione / next step concreto')
  } else {
    structure.push('Apri rispondendo all’obiettivo reale (non parafrasare la domanda; non reagire solo all’ultimo messaggio)')
  }

  switch (understanding.primaryIntent) {
    case 'advice':
    case 'comparison':
      structure.push('Rispondi all’obiettivo sottostante (non solo alla domanda letterale)')
      structure.push('Criteri di scelta rilevanti (inferiti o dichiarati)')
      structure.push('Raccomandazione chiara (o top 1–2 opzioni con perché)')
      structure.push('Trade-off / cosa evitare')
      structure.push('Se confidenza bassa: 1 frase di assunzione — mai fingere certezza sui criteri')
      break
    case 'how_to':
      structure.push('Passi ordinati e attuabili verso il risultato reale desiderato')
      if (secondary.includes('wants_code')) structure.push('Esempio di codice minimale')
      structure.push('Controllo finale / errore comune')
      break
    case 'explanation':
      structure.push('Idea centrale in una frase (legata all’uso reale dell’utente)')
      structure.push('Approfondimento calibrato sul livello tecnico')
      if (secondary.includes('wants_examples')) structure.push('Esempio calzante')
      break
    case 'creation':
      structure.push('Consegna del pezzo richiesto per lo scopo reale')
      structure.push('Breve nota d’uso solo se serve')
      break
    case 'calculation':
      structure.push('Risultato in evidenza')
      structure.push('Espressione / passaggio solo se utile')
      break
    case 'greeting':
    case 'thanks':
      structure.push('Risposta breve e umana')
      break
    default:
      structure.push('Sviluppo essenziale dell’obiettivo sottostante')
      if (secondary.includes('multi_part')) structure.push('Copri le richieste secondarie senza disperderti')
      break
  }

  if (ambiguities.length > 0) {
    structure.push('Gestisci ambiguità: assunzione più utile dal contesto; max 1 chiarimento se bloccante')
  }

  if (secondary.includes('wants_list') && !structure.some((s) => /Passi|elenco|lista/i.test(s))) {
    structure.push('Usa elenco solo se migliora la leggibilità')
  }

  if (understanding.complexity === 'low' || secondary.includes('wants_brief')) {
    structure.push('Mantieni sintesi: niente preamboli')
  } else if (secondary.includes('wants_depth')) {
    structure.push('Approfondisci con ordine, senza muri di testo')
  }

  structure.push('Ottimizza: utilità, chiarezza, conversazione naturale')
  structure.push('Chiudi in modo naturale e variato (niente template fisso)')
  structure.push(`Obiettivo reale da servire: ${realGoal}`)

  return structure
}

/**
 * Build the full cognitive / response plan (Steps 1–6; tools may refine later).
 * @param {CognitiveInput} input
 * @param {{ currentTopic?: string, followUpKind?: string } | null} [session]
 * @returns {CognitivePlan}
 */
/**
 * Build the full CognitivePlan for this turn.
 * @param {CognitiveInput} input
 * @param {object | null} [session]
 * @param {import('./social-conversation-engine.js').SocialConversationPlan | null} [socialConversationPlan]
 * @param {import('./conversation-intent.js').ConversationIntentPlan | null} [conversationIntentPlan]
 * @param {import('./conversation-leadership.js').ConversationLeadershipPlan | null} [conversationLeadershipPlan]
 * @param {import('./think-before-speaking.js').ThinkBeforeSpeakingPlan | null} [thinkBeforeSpeakingPlan]
 * @param {import('./conversation-director.js').ConversationDirectorPlan | null} [conversationDirectorPlan]
 * @param {import('./thoughtfulness-engine.js').ThoughtfulnessPlan | null} [thoughtfulnessPlan]
 * @param {import('./deep-thinking-engine.js').DeepThinkingPlan | null} [deepThinkingPlan]
 * @param {import('./deep-thinking-writer.js').DeepThinkingWriterPlan | null} [deepThinkingWriterPlan]
 * @param {import('./reasoning-expansion-engine.js').ReasoningExpansionPlan | null} [reasoningExpansionPlan]
 * @param {import('./presence-engine.js').PresencePlan | null} [presencePlan]
 * @param {import('./response-mode-engine.js').ResponseModePlan | null} [responseModePlan]
 * @param {import('./human-conversation-corpus.js').HumanConversationCorpusPlan | null} [humanConversationCorpusPlan]
 * @param {import('./wisdom-engine.js').WisdomPlan | null} [wisdomPlan]
 * @param {import('./conversation-taste.js').ConversationTastePlan | null} [conversationTastePlan]
 * @param {import('./conversation-memory-flow.js').ConversationMemoryFlowPlan | null} [conversationMemoryFlowPlan]
 * @param {import('./self-reflection-engine.js').SelfReflectionPlan | null} [selfReflectionPlan]
 * @param {import('./conversation-constitution.js').ConversationConstitutionPlan | null} [conversationConstitutionPlan]
 * @param {import('./human-impact-constitution.js').HumanImpactConstitutionPlan | null} [humanImpactConstitutionPlan]
 * @param {import('./project-soul.js').ProjectSoulPlan | null} [projectSoulPlan]
 * @param {import('./laife-manifesto.js').LaifeManifestoPlan | null} [laifeManifestoPlan]
 * @param {import('./conversation-ownership.js').ConversationOwnershipPlan | null} [conversationOwnershipPlan]
 * @param {import('./worth-reading-protocol.js').WorthReadingPlan | null} [worthReadingPlan]
 * @param {import('./language-awareness.js').LanguageAwarenessPlan | null} [languageAwarenessPlan]
 * @param {import('./conversation-opportunity-engine.js').ConversationOpportunityPlan | null} [conversationOpportunityPlan]
 * @param {import('./conversation-planner-engine.js').ConversationPlannerPlan | null} [conversationPlannerPlan]
 * @param {import('./conversation-opening-engine.js').ConversationOpeningPlan | null} [conversationOpeningPlan]
 * @param {import('./opening-intelligence-engine.js').OpeningIntelligencePlan | null} [openingIntelligencePlan]
 * @param {import('./small-talk-intelligence-engine.js').SmallTalkIntelligencePlan | null} [smallTalkIntelligencePlan]
 * @returns {CognitivePlan}
 */
export function buildCognitivePlan(
  input,
  session = null,
  socialConversationPlan = null,
  conversationIntentPlan = null,
  conversationLeadershipPlan = null,
  thinkBeforeSpeakingPlan = null,
  conversationDirectorPlan = null,
  thoughtfulnessPlan = null,
  deepThinkingPlan = null,
  deepThinkingWriterPlan = null,
  reasoningExpansionPlan = null,
  presencePlan = null,
  responseModePlan = null,
  humanConversationCorpusPlan = null,
  wisdomPlan = null,
  conversationTastePlan = null,
  conversationMemoryFlowPlan = null,
  selfReflectionPlan = null,
  conversationConstitutionPlan = null,
  humanImpactConstitutionPlan = null,
  projectSoulPlan = null,
  laifeManifestoPlan = null,
  conversationOwnershipPlan = null,
  worthReadingPlan = null,
  languageAwarenessPlan = null,
  conversationOpportunityPlan = null,
  conversationPlannerPlan = null,
  conversationOpeningPlan = null,
  openingIntelligencePlan = null,
  smallTalkIntelligencePlan = null,
) {
  const understanding = understandMessage(input.userMessage)

  // Language Awareness overrides understanding.language when active.
  if (
    languageAwarenessPlan?.active &&
    (languageAwarenessPlan.replyLanguage === 'it' ||
      languageAwarenessPlan.replyLanguage === 'en')
  ) {
    understanding.language = languageAwarenessPlan.replyLanguage
  }

  // Conversation Intent (pre-plan) may refine emotional tone from why-behind-words.
  if (conversationIntentPlan?.active && conversationIntentPlan.inference) {
    const mapped = emotionalIntentToTone(conversationIntentPlan.inference.emotionalIntent)
    if (
      mapped !== 'neutral' ||
      conversationIntentPlan.inference.emotionalIntent !== 'neutral'
    ) {
      understanding.emotionalTone = /** @type {EmotionalTone} */ (mapped)
    }
  }

  // Light prior context for goal inference (recent user turns)
  const priorUserBits = Array.isArray(input.messages)
    ? input.messages
        .filter((m) => m?.role === 'user' && typeof m.content === 'string')
        .slice(-4)
        .map((m) => m.content)
        .join('\n')
    : [input.priorUserMessage].filter(Boolean).join('\n')

  const goal = inferRealGoal(input.userMessage, understanding, {
    contextText: priorUserBits,
  })
  const { surfaceAsk, realGoal } = goal

  const ambiguities = detectAmbiguities(input.userMessage, understanding, session)
  const ambiguityStrategy = buildAmbiguityStrategy(
    ambiguities,
    understanding.emotionalTone,
  )

  const planned = planTools({
    userMessage: input.userMessage,
    attachments: input.attachments,
    memoryEnabled: input.memoryEnabled,
  })
  const webDecision = decideWebSearch(input.userMessage, understanding, planned)
  let tools = decideTools(input, understanding, webDecision)
  const refined = refineToolSelection(tools.toolOrder, {
    userMessage: input.userMessage,
    attachments: input.attachments,
    memoryEnabled: input.memoryEnabled,
  })
  tools = {
    toolsNeeded: [...refined],
    toolOrder: [...refined],
    toolsSkipped: ALL_TOOLS.filter((t) => !refined.includes(t)),
  }

  const adaptive = selectAdaptiveStrategy({
    userMessage: input.userMessage,
    understanding,
    realGoal,
    attachments: input.attachments,
  })

  const progressive = buildProgressivePlan({
    userMessage: input.userMessage,
    realGoal,
    surfaceAsk,
    understanding,
    taskPlan: null,
  })

  const expertTeacher = runExpertTeacher({
    userMessage: input.userMessage,
    messages: input.messages,
    understanding: {
      primaryIntent: understanding.primaryIntent,
      secondaryRequests: understanding.secondaryRequests,
      technicalLevel: understanding.technicalLevel,
      complexity: understanding.complexity,
      topic: understanding.topic,
    },
    session,
    planHints: {
      keepFast: Boolean(adaptive?.keepFast) || adaptive?.effort === 'minimal',
    },
  })

  let responseStructure = outlineResponseStructure(
    understanding,
    realGoal,
    understanding.secondaryRequests,
    ambiguities,
  )

  // Social → … → Presence → Response Mode → Human Conversation Corpus → Wisdom → Taste.
  const socialStructure = socialConversationStructureHints(socialConversationPlan)
  const intentStructure = conversationIntentStructureHints(conversationIntentPlan)
  const leadershipStructure = conversationLeadershipStructureHints(conversationLeadershipPlan)
  const thinkBeforeSpeakingStructure = thinkBeforeSpeakingStructureHints(
    thinkBeforeSpeakingPlan,
  )
  const conversationDirectorStructure = conversationDirectorStructureHints(
    conversationDirectorPlan,
  )
  const thoughtfulnessStructure = thoughtfulnessStructureHints(thoughtfulnessPlan)
  const deepThinkingStructure = deepThinkingStructureHints(deepThinkingPlan)
  const deepThinkingWriterStructure = deepThinkingWriterStructureHints(deepThinkingWriterPlan)
  const reasoningExpansionStructure = reasoningExpansionStructureHints(reasoningExpansionPlan)
  const presenceStructure = presenceStructureHints(presencePlan)
  const responseModeStructure = responseModeStructureHints(responseModePlan)
  const humanConversationCorpusStructure = humanConversationCorpusStructureHints(
    humanConversationCorpusPlan,
  )
  const wisdomStructure = wisdomStructureHints(wisdomPlan)
  const tasteStructure = conversationTasteStructureHints(conversationTastePlan)
  const memoryFlowStructure = conversationMemoryFlowStructureHints(conversationMemoryFlowPlan)
  const selfReflectionStructure = selfReflectionStructureHints(selfReflectionPlan)
  const constitutionStructure = conversationConstitutionStructureHints(
    conversationConstitutionPlan,
  )
  const humanImpactStructure = humanImpactConstitutionStructureHints(
    humanImpactConstitutionPlan,
  )
  const soulStructure = projectSoulStructureHints(projectSoulPlan)
  const manifestoStructure = laifeManifestoStructureHints(laifeManifestoPlan)
  const ownershipStructure = conversationOwnershipStructureHints(
    conversationOwnershipPlan,
  )
  const worthReadingStructure = worthReadingStructureHints(worthReadingPlan)
  const languageStructure = languageAwarenessStructureHints(languageAwarenessPlan)
  const opportunityStructure = conversationOpportunityStructureHints(conversationOpportunityPlan)
  const plannerStructure = conversationPlannerStructureHints(conversationPlannerPlan)
  const openingStructure = conversationOpeningStructureHints(conversationOpeningPlan)
  const openingIntelStructure = openingIntelligenceStructureHints(openingIntelligencePlan)
  const smallTalkStructure = smallTalkIntelligenceStructureHints(smallTalkIntelligencePlan)
  const prePlanStructure = [
    ...languageStructure,
    ...opportunityStructure,
    ...plannerStructure,
    ...openingStructure,
    ...openingIntelStructure,
    ...smallTalkStructure,
    ...constitutionStructure,
    ...humanImpactStructure,
    ...soulStructure,
    ...manifestoStructure,
    ...ownershipStructure,
    ...worthReadingStructure,
    ...socialStructure,
    ...intentStructure,
    ...leadershipStructure,
    ...thinkBeforeSpeakingStructure,
    ...conversationDirectorStructure,
    ...thoughtfulnessStructure,
    ...deepThinkingStructure,
    ...deepThinkingWriterStructure,
    ...reasoningExpansionStructure,
    ...presenceStructure,
    ...responseModeStructure,
    ...humanConversationCorpusStructure,
    ...wisdomStructure,
    ...tasteStructure,
    ...memoryFlowStructure,
    ...selfReflectionStructure,
  ]
  if (prePlanStructure.length) {
    responseStructure = [
      ...prePlanStructure,
      ...responseStructure.filter(
        (line) => !prePlanStructure.some((h) => h === line),
      ),
    ]
  }

  // Expert Teacher Mode owns educational structure when active.
  // Keep pre-plan craft lines (up to 16).
  if (expertTeacher.plan?.enabled && expertTeacher.plan.structureHints?.length) {
    responseStructure = [
      ...prePlanStructure.slice(0, 16),
      ...expertTeacher.plan.structureHints,
      'Prosa da ottimo insegnante: progressiva, umana — non enciclopedia',
      `Obiettivo reale da servire: ${realGoal}`,
    ]
  } else if (progressive.enabled && progressive.structureHints?.length) {
    responseStructure = [
      ...prePlanStructure.slice(0, 16),
      ...progressive.structureHints.filter((h) => !/^Ragionamento progressivo/i.test(h)),
      `Obiettivo reale da servire: ${realGoal}`,
    ]
  } else if (adaptive?.structureHints?.length) {
    responseStructure = [
      ...prePlanStructure.slice(0, 16),
      ...adaptive.structureHints,
      `Obiettivo reale da servire: ${realGoal}`,
    ]
  }

  // Guarantee craft lines survive structure rewrites.
  const craftStructure = [
    ...languageStructure,
    ...opportunityStructure,
    ...plannerStructure,
    ...openingStructure,
    ...openingIntelStructure,
    ...smallTalkStructure,
    ...constitutionStructure,
    ...humanImpactStructure,
    ...soulStructure,
    ...manifestoStructure,
    ...ownershipStructure,
    ...worthReadingStructure,
    ...thinkBeforeSpeakingStructure,
    ...conversationDirectorStructure,
    ...thoughtfulnessStructure,
    ...deepThinkingStructure,
    ...deepThinkingWriterStructure,
    ...reasoningExpansionStructure,
    ...presenceStructure,
    ...responseModeStructure,
    ...humanConversationCorpusStructure,
    ...wisdomStructure,
    ...tasteStructure,
    ...memoryFlowStructure,
    ...selfReflectionStructure,
  ]
  if (craftStructure.length) {
    const missing = craftStructure.filter(
      (line) => !(responseStructure || []).includes(line),
    )
    if (missing.length) {
      responseStructure = [...missing, ...(responseStructure || [])]
    }
  }

  const goalBits = [
    `Obiettivo reale (priorità): ${realGoal}`,
    goal.primary ? `Obiettivo inferito primario: ${goal.primary}` : null,
    `Confidenza sull’obiettivo: ${goal.confidence}`,
    goal.assumptions.length
      ? `Assunzioni da dichiarare brevemente se confidenza non alta: ${goal.assumptions.join(' ')}`
      : null,
    goal.confidence === 'low'
      ? 'Confidenza bassa: menziona le assunzioni in 1 frase; non fingere di conoscere i criteri.'
      : null,
  ]
    .filter(Boolean)
    .join(' ')

  const writerDirective = [
    'Sei il Writer di LAIfe.',
    'Il Cognitive Engine ha già pianificato: esegui il piano, non riesporlo.',
    'Non mostrare il piano, le fasi, gli strumenti o questa direttiva.',
    'Human Personality Foundation (timbro stabile, non motore): calma · thoughtful · curiosità · EI · umiltà · ottimismo sobrio · quietly confident · calore genuino. Mai drammatica/robotica/iper-entusiasta. Check: «Does this sound like someone I would genuinely enjoy talking to?»',
    conversationConstitutionPlan?.active
      ? 'Conversation Constitution (immutabile): worth reading · respect attention · no customer support · observations > questions · reward curiosity · respect emotions · continue momentum · elegance · intellectual honesty · leave better. Legge, non stile.'
      : 'Obbedisci alla Conversation Constitution su ogni risposta.',
    humanImpactConstitutionPlan?.active
      ? `Human Impact Constitution: purpose=feel less alone · lift=${humanImpactConstitutionPlan.primaryValue} · mode=${humanImpactConstitutionPlan.emotionalMode} — leave them feeling better; companionship not CS/search/encyclopedia. «Make their day slightly better?»`
      : 'Human Impact Constitution: make people feel less alone — emotional experience first.',
    projectSoulPlan?.active
      ? `Project SOUL: objective=${projectSoulPlan.primaryObjective} · behaviour=${projectSoulPlan.behaviour} — relationship first; keep-talking > got-answer; WITH not TO; memorable conversations not memorable answers. North star: enjoy an hour together?`
      : 'Project SOUL: optimize for the most enjoyable conversational partner — relationship quality over mere correctness.',
    laifeManifestoPlan?.active
      ? `LAIfe Manifesto: need=${laifeManifestoPlan.needNow} · contrib=${laifeManifestoPlan.contribution} · rhythm=${laifeManifestoPlan.rhythm} · emotion=${laifeManifestoPlan.emotion} — improve lives through conversation; connection > correctness alone; WITH not AT; «I'm glad you're here.»`
      : 'LAIfe Manifesto: leave them a little better; create conversations; curiosity · kindness · intelligence · humanity.',
    conversationOwnershipPlan?.active
      ? `Conversation Ownership Protocol: stance=${conversationOwnershipPlan.stance}${conversationOwnershipPlan.takeLead ? ' · LEAD' : ''} — partner attivo, non assistente passivo; turni corti/vago → contribuisci (idea/fatto/osservazione/storia/metafora/insight); niente ack/Q generiche; non inventare fatti.`
      : 'Conversation Ownership: non aspettare che l’utente renda interessante la chat — contribuisci.',
    worthReadingPlan?.active
      ? `Worth Reading Protocol (craft finale pre-Writer): stance=${worthReadingPlan.stance}${worthReadingPlan.mustCarry ? ' · CARRY' : ''} — ogni risposta merita attenzione; contributo > interrogazione; niente cliché da support; Human/Worth Reading Test; non cambiare i fatti.`
      : 'Worth Reading: ogni risposta deve meritare l’attenzione — craft finale prima del Writer.',
    languageAwarenessPlan?.active
      ? `Language Awareness: reply=${languageAwarenessPlan.replyLanguage}${languageAwarenessPlan.switched ? ' · SWITCH now' : ' · maintain'}${languageAwarenessPlan.metaRequest ? ' · META' : ''} — rispondi INTERAMENTE in ${languageAwarenessPlan.replyLanguage === 'it' ? 'italiano' : languageAwarenessPlan.replyLanguage === 'en' ? 'English' : 'lingua utente'}; niente lezioni sulle lingue; niente scuse lunghe.`
      : null,
    conversationOpportunityPlan?.active
      ? `Conversation Opportunity: allowed=${conversationOpportunityPlan.initiativeAllowed} · type=${conversationOpportunityPlan.initiativeType} · conf=${conversationOpportunityPlan.confidence}/100 — ${conversationOpportunityPlan.reason} Check: would a good friend introduce a new topic right now?`
      : null,
    conversationPlannerPlan?.active
      ? `Conversation Planner: strategy=${conversationPlannerPlan.plan.strategy} · depth=${conversationPlannerPlan.plan.depth} · topic=${conversationPlannerPlan.plan.topicAction} · feel=${conversationPlannerPlan.plan.emotion} · goal«${conversationPlannerPlan.plan.goal}» — plan for next 5 minutes; Writer MUST follow.`
      : 'Conversation Planner: pianifica prima di scrivere (goal · strategy · emotion · depth · topicAction).',
    conversationOpeningPlan?.active && conversationOpeningPlan.shouldOpen
      ? `Conversation Opening Engine (Useful): value=${conversationOpeningPlan.valueKind || 'x'} · cat=${conversationOpeningPlan.category} · fatto concreto + gancio curiosità — niente filosofia vuota.`
      : conversationOpeningPlan?.forceSkipUserQuestion
        ? 'Conversation Opening: domanda reale → rispondi naturale, niente opener forzato.'
        : conversationOpeningPlan?.trigger === 'no_value'
          ? 'Conversation Opening: nessun valore utile/interessante/sorprendente/pratico → non aprire.'
          : null,
    openingIntelligencePlan?.active && openingIntelligencePlan.shouldOpen
      ? `Opening Intelligence: objective=${openingIntelligencePlan.objective} · cat=${openingIntelligencePlan.category} — prima impressione crea valore; 2–6 frasi; gancio naturale; mai greeting nudo.`
      : openingIntelligencePlan?.forceSkipUserQuestion
        ? 'Opening Intelligence: domanda reale → niente opener forzato.'
        : null,
    smallTalkIntelligencePlan?.active && smallTalkIntelligencePlan.isSmallTalk
      ? `Small Talk Intelligence: move=${smallTalkIntelligencePlan.move} · temp=${smallTalkIntelligencePlan.temperature} · rhythm=${smallTalkIntelligencePlan.rhythm} — doorway to relationship; answer then opportunity; no forced And you?.`
      : smallTalkIntelligencePlan?.forceSkipTask
        ? 'Small Talk Intelligence: task reale → sostanza, niente teatro da greeting.'
        : null,
    socialConversationPlan?.active && socialConversationPlan.isSocial
      ? `Social Conversation Engine: mode=social · intent=${socialConversationPlan.socialIntent || 'social'} — contatto umano, NON richiesta info; connessione > informazione; naturale, rilassato; niente helpdesk; non forzare domande né “What about you?”.`
      : socialConversationPlan?.active && socialConversationPlan.mode === 'mixed'
        ? `Social Conversation Engine: mode=mixed — cenno caldo poi sostanza; niente tono da sportello.`
        : null,
    conversationIntentPlan?.active && conversationIntentPlan.inference?.whySummary
      ? `Conversation Intent (perché ha scritto): ${conversationIntentPlan.inference.whySummary} — rispondi all’intenzione, non solo al letterale.`
      : 'Rispondi all’obiettivo sottostante, non solo alla domanda letterale.',
    conversationLeadershipPlan?.active && conversationLeadershipPlan.move
      ? `Conversation Leadership: mossa=${conversationLeadershipPlan.move}${conversationLeadershipPlan.preserveMomentum ? ' · preserva momentum' : ''} — guida con fiducia, niente permessi né interviste.`
      : 'Preferisci osservazioni alle domande; continua se il filo è vivo; niente interviste.',
    thinkBeforeSpeakingPlan?.active
      ? `Think Before Speaking: path=${thinkBeforeSpeakingPlan.path} · emotion=${thinkBeforeSpeakingPlan.hidden?.emotionalStates?.[0] || 'n/a'} — never first thought; ≥3 candidates; understand>answer; conversation>explanation. «Did I understand or only answer?»`
      : 'Think Before Speaking: pause · reflect · never the first automatic answer.',
    conversationDirectorPlan?.active
      ? `Conversation Director: move=${conversationDirectorPlan.move} · rhythm=${conversationDirectorPlan.rhythm}${conversationDirectorPlan.noTopicMode ? ' · no-topic' : ''} — dirige conversazione, non genera informazione; curiosità → partecipazione → ascolto; engagement emotivo > densità informativa.`
      : 'Conversation Director: dirigi una bella conversazione — non dump di informazione.',
    thoughtfulnessPlan?.active && thoughtfulnessPlan.contribution
      ? `Thoughtfulness Engine: contributo=${thoughtfulnessPlan.contribution} — non la prima risposta corretta; massimizza valore conversazionale (memorabile > generico · elegante > enciclopedico).`
      : 'Prima di scrivere: cerca il contributo a maggior valore — non la prima risposta corretta.',
    deepThinkingPlan?.active && deepThinkingPlan.direction
      ? `Deep Thinking Engine: direzione=${deepThinkingPlan.direction} — esplora più opzioni; scegli valore conversazionale massimo; Would a thoughtful human say this?`
      : 'Prima di scrivere: esplora più direzioni; non la prima risposta corretta.',
    deepThinkingWriterPlan?.active && deepThinkingWriterPlan.requireLayers
      ? `Deep Thinking Writer: depth≥${deepThinkingWriterPlan.minDepth} · layers Reaction→Idea→Explanation→Example→Reflection · ≥2 of [${(deepThinkingWriterPlan.requiredElements || []).join(', ')}] — mai la prima risposta accettabile; niente filler.`
      : deepThinkingWriterPlan?.active
        ? `Deep Thinking Writer: depth≈${deepThinkingWriterPlan.depthScore}/5 — profondità proporzionata; evita filler vuoto.`
        : 'Deep Thinking Writer: sviluppa oltre la prima riga accettabile quando il tema lo consente.',
    reasoningExpansionPlan?.active && reasoningExpansionPlan.requireExpansion
      ? `Reasoning Expansion: expand «${reasoningExpansionPlan.topicAnchor}» · tree Reaction→Core→Why→Example→Implication — explored ≠ mentioned; no subject change for length.`
      : reasoningExpansionPlan?.active
        ? `Reasoning Expansion: proportionate on «${reasoningExpansionPlan.topicAnchor}» — stay on topic.`
        : 'Reasoning Expansion: espandi idee sul tema corrente; non allungare cambiando argomento.',
    presencePlan?.active
      ? `Presence Engine: need=${presencePlan.need} style=${presencePlan.style} ending=${presencePlan.ending}${presencePlan.avoidQuestionEnding ? ' · no question ending' : ''} — conversazione viva, non Q&A; «Does this feel like spending time with someone interesting?»`
      : 'Presenza viva: varia stile; evita chiusure sempre a domanda.',
    responseModePlan?.active
      ? `Response Mode: HOW=${responseModePlan.mode}${responseModePlan.preferBrevity ? ' · brief' : ''} — scegli il modo, non solo il contenuto; varia i modi; niente Explanation a catena; la conversazione respira.`
      : 'Response Mode: prima di scrivere scegli HOW (reaction/observation/reflection/…); non ripetere lo stesso modo.',
    humanConversationCorpusPlan?.active
      ? `Human Conversation Corpus: spoken=${humanConversationCorpusPlan.preferSpoken ? 'yes' : 'task'} · ctx=${humanConversationCorpusPlan.context}${humanConversationCorpusPlan.greetingOnly ? ' · GREETING' : ''} — parla, non pubblicare; essay≤${humanConversationCorpusPlan.essayThreshold}; interazione > esposizione.`
      : 'Human Conversation Corpus: ottimizza per dialogo parlato, non saggio/articolo/TED/Wikipedia.',
    wisdomPlan?.active
      ? `Wisdom Engine: stance=${wisdomPlan.stance} — saggezza > verbosità; «valuable five minutes after reading?»; mentore semplice, niente sfoggio.`
      : 'Saggezza: utile, appropriato, significativo — non solo corretto.',
    conversationTastePlan?.active
      ? `Conversation Taste: stance=${conversationTastePlan.stance}${conversationTastePlan.checks?.repetitive ? ' · BREAK repetition' : ''} — piacevole da leggere, non solo informativo; ritmo, varietà, phrasing memorabile.`
      : 'Taste: interesting, elegant, alive, enjoyable to read.',
    conversationMemoryFlowPlan?.active && conversationMemoryFlowPlan.shouldWeave
      ? `Conversation Memory Flow: ${conversationMemoryFlowPlan.move} — tessi «${conversationMemoryFlowPlan.chosen?.thread || ''}» in modo spontaneo; mai dump; mai “As you said three weeks ago…”.`
      : 'Memory Flow: silenzio se non spontaneo — niente dump di memorie.',
    selfReflectionPlan?.active
      ? 'Self Reflection Engine: checklist silenziosa (naturale? piacevole? ripetitiva? domanda inutile? osservazione? valore? avanti? emozioni? chiusura? soddisfazione umana?) — max 1 refine; qualità > lunghezza.'
      : 'Self Reflection: una review silenziosa prima dell’invio.',
    expertTeacher.plan?.enabled
      ? expertTeacher.plan.writerBrief
      : progressive.enabled
        ? progressive.writerBrief
        : adaptive?.writerBrief || 'Domanda semplice: risposta diretta e veloce.',
    'Scrivi UNA sola risposta naturale all’utente.',
    goalBits,
    `Intento primario: ${understanding.primaryIntent}`,
    `Tono emotivo: ${understanding.emotionalTone}`,
    conversationIntentPlan?.inference
      ? `Expects=${conversationIntentPlan.inference.expects}; Openness=${conversationIntentPlan.inference.opennessToContinue}`
      : null,
    socialConversationPlan?.active
      ? `SocialMode=${socialConversationPlan.mode}; SocialIntent=${socialConversationPlan.socialIntent || '—'}; IsSocial=${socialConversationPlan.isSocial ? 'yes' : 'no'}`
      : null,
    conversationLeadershipPlan?.active
      ? `LeadershipMove=${conversationLeadershipPlan.move}; Momentum=${conversationLeadershipPlan.hasMomentum ? 'yes' : 'no'}; AllowQuestion=${conversationLeadershipPlan.allowQuestion ? 'yes' : 'no'}`
      : null,
    thinkBeforeSpeakingPlan?.active
      ? `ThinkBeforeSpeaking=path_${thinkBeforeSpeakingPlan.path}; RejectInstant=yes`
      : null,
    conversationDirectorPlan?.active
      ? `ConversationDirector=move_${conversationDirectorPlan.move}; rhythm=${conversationDirectorPlan.rhythm}; compress=${conversationDirectorPlan.compressInformation ? 'yes' : 'no'}`
      : null,
    thoughtfulnessPlan?.active
      ? `ThoughtfulnessContribution=${thoughtfulnessPlan.contribution}; AvoidEncyclopedia=${thoughtfulnessPlan.avoidEncyclopedia ? 'yes' : 'no'}`
      : null,
    deepThinkingPlan?.active
      ? `DeepThinkingDirection=${deepThinkingPlan.direction}; HumanCheck=${deepThinkingPlan.passesHumanCheck ? 'pass' : 'refine'}`
      : null,
    deepThinkingWriterPlan?.active
      ? `DeepThinkingWriter=depth_${deepThinkingWriterPlan.depthScore}/5; Layers=${deepThinkingWriterPlan.requireLayers ? 'yes' : 'proportionate'}; Min=${deepThinkingWriterPlan.minDepth}`
      : null,
    reasoningExpansionPlan?.active
      ? `ReasoningExpansion=${reasoningExpansionPlan.requireExpansion ? 'expand' : 'proportionate'}; Topic=${reasoningExpansionPlan.topicAnchor}`
      : null,
    presencePlan?.active
      ? `PresenceNeed=${presencePlan.need}; Style=${presencePlan.style}; Ending=${presencePlan.ending}; AvoidQ=${presencePlan.avoidQuestionEnding ? 'yes' : 'no'}`
      : null,
    responseModePlan?.active
      ? `ResponseMode=${responseModePlan.mode}; Brief=${responseModePlan.preferBrevity ? 'yes' : 'no'}; Cue=${responseModePlan.cueMatch || 'none'}`
      : null,
    humanConversationCorpusPlan?.active
      ? `HumanConversationCorpus=spoken_${humanConversationCorpusPlan.preferSpoken ? 'yes' : 'no'}; Ctx=${humanConversationCorpusPlan.context}; Greeting=${humanConversationCorpusPlan.greetingOnly ? 'yes' : 'no'}`
      : null,
    wisdomPlan?.active
      ? `WisdomStance=${wisdomPlan.stance}; Info=${wisdomPlan.checks?.informationAmount}; Simpler=${wisdomPlan.checks?.preferSimpler ? 'yes' : 'no'}`
      : null,
    conversationTastePlan?.active
      ? `TasteStance=${conversationTastePlan.stance}; Repetitive=${conversationTastePlan.checks?.repetitive ? 'yes' : 'no'}; Alive=${conversationTastePlan.checks?.alive ? 'yes' : 'no'}`
      : null,
    conversationMemoryFlowPlan?.active
      ? `MemoryFlow=${conversationMemoryFlowPlan.move}; Weave=${conversationMemoryFlowPlan.shouldWeave ? 'yes' : 'no'}`
      : null,
    selfReflectionPlan?.active ? 'SelfReflection=checklist_silent; MaxRefine=1' : null,
    conversationConstitutionPlan?.active
      ? 'ConversationConstitution=immutable; Principles=10'
      : null,
    humanImpactConstitutionPlan?.active
      ? `HumanImpact=lift_${humanImpactConstitutionPlan.primaryValue}; Mode=${humanImpactConstitutionPlan.emotionalMode}`
      : null,
    projectSoulPlan?.active
      ? `ProjectSOUL=obj_${projectSoulPlan.primaryObjective}; Beh=${projectSoulPlan.behaviour}; KeepTalking`
      : null,
    laifeManifestoPlan?.active
      ? `LAIfeManifesto=need_${laifeManifestoPlan.needNow}; Contrib=${laifeManifestoPlan.contribution}; Rhythm=${laifeManifestoPlan.rhythm}`
      : null,
    conversationOwnershipPlan?.active
      ? `ConversationOwnership=partner_attivo; Stance=${conversationOwnershipPlan.stance}; Lead=${conversationOwnershipPlan.takeLead ? 'yes' : 'no'}`
      : null,
    worthReadingPlan?.active
      ? `WorthReading=pre_writer_craft; Stance=${worthReadingPlan.stance}; Carry=${worthReadingPlan.mustCarry ? 'yes' : 'no'}`
      : null,
    languageAwarenessPlan?.active
      ? `LanguageAwareness=reply_${languageAwarenessPlan.replyLanguage}; Switch=${languageAwarenessPlan.switched ? 'yes' : 'no'}; Meta=${languageAwarenessPlan.metaRequest ? 'yes' : 'no'}`
      : null,
    `Livello tecnico: ${understanding.technicalLevel}; urgenza: ${understanding.urgency}; complessità: ${understanding.complexity}; registro: ${understanding.tone}`,
    ambiguityStrategy,
    languageAwarenessPlan?.active &&
      (languageAwarenessPlan.replyLanguage === 'it' ||
        languageAwarenessPlan.replyLanguage === 'en')
      ? `Reply entirely in ${languageAwarenessPlan.replyLanguage === 'it' ? 'italiano' : 'English'} (${languageAwarenessPlan.replyLanguage}).${languageAwarenessPlan.switched || languageAwarenessPlan.metaRequest ? ' Cambio lingua intenzionale → adatta SUBITO. Non spiegare le lingue. Non scusarti a lungo.' : ' Mantieni la lingua della conversazione.'}`
      : understanding.language !== 'auto'
        ? `Lingua della risposta: ${understanding.language === 'it' ? 'italiano' : 'inglese'} (segui l'utente se diverge).`
        : 'Lingua: adatta a quella dell’utente.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    understanding,
    realGoal,
    surfaceAsk,
    inferredGoals: goal.candidates,
    goalConfidence: goal.confidence,
    goalAssumptions: goal.assumptions,
    toolsNeeded: tools.toolsNeeded,
    toolOrder: tools.toolOrder,
    toolsSkipped: tools.toolsSkipped,
    webDecision,
    ambiguities,
    ambiguityStrategy,
    responseStructure,
    writerDirective,
    memoryRetrieved: false,
    progressive,
    adaptive,
    expertTeacher: expertTeacher.plan,
  }
}

/**
 * Format Response Planning block for the Writer (invisible).
 * @param {CognitivePlan} plan
 */
export function formatPlanForWriter(plan) {
  const u = plan.understanding
  const structure = plan.responseStructure.map((step, i) => `${i + 1}. ${step}`).join('\n')
  const tools =
    plan.toolOrder.length > 0 ? plan.toolOrder.join(' → ') : 'nessuno (solo modello)'
  const skipped =
    plan.toolsSkipped.length > 0 ? plan.toolsSkipped.join(', ') : '—'
  const goals =
    plan.inferredGoals?.length > 0
      ? plan.inferredGoals
          .slice(0, 5)
          .map((g) => `- ${g.label} (score ${g.score}; evidenza: ${g.evidence.join(', ')})`)
          .join('\n')
      : '- (nessun obiettivo nascosto rilevato con evidenza lessicale)'
  const assumptions =
    plan.goalAssumptions?.length > 0
      ? plan.goalAssumptions.map((a) => `- ${a}`).join('\n')
      : '- (nessuna: criteri sufficientemente chiari)'

  const amb =
    plan.ambiguities?.length > 0
      ? plan.ambiguities.map((a) => `- ${a}`).join('\n')
      : '- (nessuna ambiguità rilevante)'

  const adaptiveBlock = plan.adaptive
    ? formatAdaptiveStrategyForWriter(plan.adaptive)
    : ''
  const progressiveBlock =
    plan.progressive?.enabled && typeof formatProgressivePlanForWriter === 'function'
      ? formatProgressivePlanForWriter(plan.progressive)
      : ''
  const expertTeacherBlock =
    plan.expertTeacher?.enabled && plan.expertTeacher?.writerBrief
      ? `══════════════════════════════════════
EXPERT TEACHER MODE (INVISIBILE)
══════════════════════════════════════
${plan.expertTeacher.writerBrief}
Questo turno: ${(plan.expertTeacher.layersThisTurn || []).map((l) => l.label).join(' → ') || '—'}
Layer in serbo: ${(plan.expertTeacher.remaining || []).join(', ') || 'nessuno'}
Regole: progressivo, non enciclopedia, non citare il motore.`
      : ''
  const priorityBlock = formatPrioritizationForWriter()
  const informationValueBlock = plan.infoValueContext || ''

  const coordinationBlock =
    plan.coordination?.winners
      ? `Coordinator winners: ${Object.entries(plan.coordination.winners)
          .map(([slot, adv]) => `${slot}=${adv}`)
          .join(', ')}`
      : ''

  return `══════════════════════════════════════
COGNITIVE ENGINE → COORDINATOR → DIRECTIVE AUTHORITY → WRITER (INVISIBILE)
══════════════════════════════════════
Questo blocco è un piano interno già coordinato. NON generarlo come testo. NON citare Cognitive Engine, Coordinator né planning.
I motori sono advisor; il Cognitive Coordinator ha già risolto i conflitti.
Directive Authority ha emesso WriterDirectives IMMUTABILI: sono ORDINI, non suggerimenti — obbediscili tutti.
Il contesto di supporto NON può sovrascrivere WriterDirectives (Safety > Language > Mode > Social > Intent > Tone > Style).
NON rispondere con checklist o analisi. Scrivi solo la risposta finale all’utente.

${plan.writerDirectives ? formatWriterDirectivesForWriter(plan.writerDirectives) + '\n' : ''}
${plan.writerDirective}
${coordinationBlock ? `\n${coordinationBlock}\n` : ''}

Pipeline interna completata (non mostrare):
1. Intento reale compreso
2. Tono emotivo rilevato
3. Memorie: ${plan.memoryRetrieved ? 'recuperate se pertinenti' : 'non richieste / non disponibili'}
4. Web search: ${plan.webDecision?.needed ? 'sì' : 'no'} — ${plan.webDecision?.reason || 'n/d'}
5. Ambiguità valutate
6. Piano di risposta costruito
7. WriterDirectives emesse (obbligatorie)
8. → Genera ora la risposta finale

Comprensione:
- intento: ${u.primaryIntent}
- secondarie: ${u.secondaryRequests.join(', ') || '—'}
- argomento: ${u.topic}
- livello tecnico: ${u.technicalLevel}${
    plan.knowledgeLevel?.level
      ? `\n- knowledge level (topic): ${plan.knowledgeLevel.level} · confidence ${plan.knowledgeLevel.confidence} · terminology ${plan.knowledgeLevel.adjustments?.terminology} · depth ${plan.knowledgeLevel.adjustments?.depth} · pacing ${plan.knowledgeLevel.adjustments?.pacing}`
      : ''
  }
- lingua: ${u.language}
- registro: ${u.tone}
- tono emotivo: ${u.emotionalTone}
- urgenza: ${u.urgency}
- complessità (messaggio): ${u.complexity}
- strategia: ${plan.adaptive ? `${plan.adaptive.mode} / effort ${plan.adaptive.effort}` : '—'} (NON esporre all’utente)
- expert teacher: ${plan.expertTeacher?.enabled ? `on (${plan.expertTeacher.mode})` : 'off'}
- writerDirectives: ${
    plan.writerDirectives
      ? `lang=${plan.writerDirectives.language} mode=${plan.writerDirectives.mode} social=${plan.writerDirectives.social} lead=${plan.writerDirectives.leadConversation} askQ=${plan.writerDirectives.askQuestion}`
      : 'n/d'
  }

Richiesta di superficie: ${plan.surfaceAsk}
Obiettivo reale (priorità): ${plan.realGoal}
Confidenza obiettivo: ${plan.goalConfidence || 'medium'}

Obiettivi sottostanti candidati:
${goals}

Assunzioni (dichiarale in 1 frase se confidenza low/medium; non fingere certezza):
${assumptions}

Ambiguità:
${amb}
Strategia ambiguità: ${plan.ambiguityStrategy}

Strumenti: ${tools}
Evitati: ${skipped}

Struttura ideale della risposta (segui lo spirito, non stampare questi punti):
${structure}

${adaptiveBlock}

${progressiveBlock}

${expertTeacherBlock}

${priorityBlock}

${informationValueBlock}`.trim()
}

/**
 * Full Response Planning run:
 * Conversation Intelligence → Steps 1–6 → tools → Writer handoff (step 7).
 * Fail-soft: never throws to the caller for planning/tool failures.
 *
 * @param {CognitiveInput} input
 * @returns {Promise<{
 *   plan: CognitivePlan,
 *   writerBlock: string,
 *   writerDirectives?: import('./directive-authority.js').WriterDirectives | null,
 *   directiveAuthorityContext?: string,
 *   directiveDebugReport?: string,
 *   naturalDialogue?: object | null,
 *   naturalDialogueContext?: string,
 *   conversationalPragmatics?: object | null,
 *   conversationalPragmaticsContext?: string,
   *   narrativeConversation?: object | null,
   *   narrativeConversationContext?: string,
   *   emotionalMomentum?: object | null,
   *   emotionalMomentumContext?: string,
 *   personalityConsistency?: object | null,
 *   personalityConsistencyContext?: string,
 *   personalVoice?: object | null,
 *   personalVoiceContext?: string,
 *   humanImperfection?: object | null,
 *   humanImperfectionContext?: string,
   *   conversationalMemory?: object | null,
   *   conversationalMemoryContext?: string,
   *   genuineCuriosity?: object | null,
   *   genuineCuriosityContext?: string,
   *   deepListening?: object | null,
   *   deepListeningContext?: string,
   *   conversationPace?: object | null,
   *   conversationPaceContext?: string,
   *   naturalTopicTransition?: object | null,
   *   naturalTopicTransitionContext?: string,
   *   authenticAgreement?: object | null,
   *   authenticAgreementContext?: string,
   *   conversationRecovery?: object | null,
   *   conversationRecoveryContext?: string,
   *   internalMonologue?: object | null,
   *   internalMonologueContext?: string,
   *   microObservation?: object | null,
   *   microObservationContext?: string,
   *   humanConversationScore?: object | null,
   *   humanConversationScoreContext?: string,
   *   emotionalResonance?: object | null,
   *   emotionalResonanceContext?: string,
   *   wonder?: object | null,
   *   wonderContext?: string,
   *   sharedDiscovery?: object | null,
   *   sharedDiscoveryContext?: string,
   *   conversationChemistry?: object | null,
   *   conversationChemistryContext?: string,
   *   intelligentSilence?: object | null,
   *   intelligentSilenceContext?: string,
   *   storytelling?: object | null,
   *   storytellingContext?: string,
   *   emotionalContinuity?: object | null,
   *   emotionalContinuityContext?: string,
   *   humanTiming?: object | null,
   *   humanTimingContext?: string,
   *   conversationalCreativity?: object | null,
   *   conversationalCreativityContext?: string,
   *   authenticOpinions?: object | null,
   *   authenticOpinionsContext?: string,
 *   conversationOpportunity?: object | null,
 *   conversationOpportunityContext?: string,
 *   conversationPlanner?: object | null,
 *   conversationPlannerContext?: string,
 *   conversationOpening?: object | null,
 *   conversationOpeningContext?: string,
 *   openingIntelligence?: object | null,
 *   openingIntelligenceContext?: string,
 *   smallTalkIntelligence?: object | null,
 *   smallTalkIntelligenceContext?: string,
   *   toolContext: string,
 *   conversationContext: string,
 *   taskPlanContext: string,
 *   reflectionContext: string,
 *   continuationContext?: string,
 *   curiosityContext?: string,
 *   nextAskContext?: string,
 *   momentumContext?: string,
 *   intellectualInitiativeContext?: string,
 *   surpriseContext?: string,
 *   honestyContext?: string,
 *   pluginContext?: string,
 *   actionContext?: string,
 *   multiStepContext?: string,
 *   voiceContext?: string,
 *   learningSignals: import('./conversation-reflection.js').LearningSignals,
 *   continuation?: object | null,
 *   curiosity?: object | null,
 *   nextAsk?: object | null,
 *   momentum?: object | null,
 *   intellectualInitiative?: object | null,
 *   surprise?: object | null,
 *   honesty?: object | null,
 *   feedbackInterpretation?: object | null,
 *   warmConversation?: object | null,
 *   warmConversationContext?: string,
 *   conversationSpark?: object | null,
 *   conversationSparkContext?: string,
 *   conversationalPresence?: object | null,
 *   conversationalPresenceContext?: string,
 *   questionEconomy?: object | null,
 *   questionEconomyContext?: string,
 *   conversationMindset?: object | null,
 *   conversationMindsetContext?: string,
 *   conversationDelight?: object | null,
 *   conversationDelightContext?: string,
 *   socialConversation?: object | null,
 *   socialConversationContext?: string,
 *   conversationIntentPlan?: object | null,
 *   conversationIntentContext?: string,
 *   conversationLeadership?: object | null,
 *   conversationLeadershipContext?: string,
 *   thinkBeforeSpeaking?: object | null,
 *   thinkBeforeSpeakingContext?: string,
 *   conversationDirector?: object | null,
 *   conversationDirectorContext?: string,
 *   thoughtfulness?: object | null,
 *   thoughtfulnessContext?: string,
 *   deepThinking?: object | null,
 *   deepThinkingContext?: string,
 *   deepThinkingWriter?: object | null,
 *   deepThinkingWriterContext?: string,
 *   reasoningExpansion?: object | null,
 *   reasoningExpansionContext?: string,
 *   presence?: object | null,
 *   presenceContext?: string,
 *   responseMode?: object | null,
 *   responseModeContext?: string,
 *   humanConversationCorpus?: object | null,
 *   humanConversationCorpusContext?: string,
 *   wisdom?: object | null,
 *   wisdomContext?: string,
 *   conversationTaste?: object | null,
 *   conversationTasteContext?: string,
 *   conversationMemoryFlow?: object | null,
 *   conversationMemoryFlowContext?: string,
 *   selfReflection?: object | null,
 *   selfReflectionContext?: string,
 *   conversationConstitution?: object | null,
 *   conversationConstitutionContext?: string,
 *   humanImpactConstitution?: object | null,
 *   humanImpactConstitutionContext?: string,
 *   projectSoul?: object | null,
 *   projectSoulContext?: string,
 *   laifeManifesto?: object | null,
 *   laifeManifestoContext?: string,
 *   conversationOwnership?: object | null,
 *   conversationOwnershipContext?: string,
 *   worthReading?: object | null,
 *   worthReadingContext?: string,
 *   languageAwareness?: object | null,
 *   languageAwarenessContext?: string,
 *   plugins?: object[],
 *   action?: object | null,
 *   multiStep?: object | null,
 *   voice?: object | null,
 *   voiceSession?: object | null,
 *   behavior?: object | null,
 *   behaviorContext?: string,
 *   welcome?: object | null,
 *   welcomeSession?: object | null,
 *   welcomeContext?: string,
 *   conversationMemoryMap?: object | null,
 *   memoryMapContext?: string,
 *   conversationPreferenceProfile?: object | null,
 *   topicLeadership?: object | null,
 *   topicLeadershipContext?: string,
 *   knowledge?: object | null,
 *   knowledgeLevel?: string | null,
 *   life?: object | null,
 *   lifeIntelligenceContext?: string,
 *   automation?: object | null,
 *   automationContext?: string,
 *   pendingAutomation?: object | null,
 *   deviceManager?: object | null,
 *   deviceManagerContext?: string,
 *   coordination?: object | null,
 *   coordinatorContext?: string,
 *   context: string,
 * }>}
 */
export async function runCognitiveEngine(input) {
  try {
    // Internal reflection on prior completed turns — never writes factual memory.
    const reflection = runConversationReflection({
      messages: input.messages || [],
      priorSignals: input.priorLearningSignals || null,
    })

    const conversation = runConversationIntelligence({
      userMessage: input.userMessage,
      messages: input.messages,
    })

    // Conversation Memory Map: evolve structured map beyond raw message history.
    const memoryMapRun = runConversationMemoryMap({
      userMessage: input.userMessage,
      messages: input.messages,
      priorMap: input.conversationMemoryMap || null,
      shortTerm: conversation.memory,
    })
    applyMemoryMapToSession(conversation.memory, memoryMapRun.map)

    // Welcome Experience Engine: new conversation → first/returning/pause-resume openings.
    const welcome = await runWelcomeEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      welcomeSession: input.welcomeSession || null,
      learningSignals: input.priorLearningSignals || null,
      displayName: input.displayName,
      userId: input.userId,
      memoryEnabled: input.memoryEnabled !== false,
    })

    // Voice Conversation Engine: spoken-natural style, interrupts, resume, incomplete utterances.
    const voice = runVoiceConversationEngine({
      userMessage: input.userMessage,
      modality: input.modality,
      voice: input.voice,
      voiceSession: input.voiceSession || null,
      currentTopic: conversation.memory?.currentTopic,
      currentGoal: conversation.memory?.currentGoal,
      alreadyExplained: conversation.memory?.alreadyExplained,
      previousTopic: conversation.memory?.previousTopic,
      topicShift: conversation.memory?.topicShift,
    })

    // Short-message continuation: infer intent; maybe add ONE valuable beat.
    const continuation = runConversationContinuation({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
    })

    // Topic Leadership: user explicitly delegates topic choice → one confident theme.
    const topicLeadership = runTopicLeadershipEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      continuation: continuation.plan,
    })

    // Social Conversation Engine (BEFORE Intent): SOCIAL vs INFORMATIONAL.
    const socialConversation = runSocialConversationEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
    })

    // Conversation Intent (PRE-PLAN): why the user wrote — guides entire response generation.
    const conversationIntent = runConversationIntent({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      socialConversation,
    })

    // Conversation Leadership (after Intent, before plan): how to guide this turn.
    const conversationLeadership = runConversationLeadership({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      topicLeadership,
      session: conversation.memory,
    })

    // Language Awareness (foundational layer): detect / sticky / intentional switch.
    const languageAwareness = runLanguageAwareness({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
    })

    // Emotional State (from Conversation Intent + early tone cues) — feeds Opportunity.
    const emotionalState = deriveEmotionalState({
      userMessage: input.userMessage,
      conversationIntent,
      understanding: null,
    })

    // Conversation Opportunity Engine (AFTER Intent + Emotional State, BEFORE Planner/Writer):
    // Should I say something? — initiative must earn its place.
    const conversationOpportunity = runConversationOpportunityEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationIntent,
      languageAwareness,
      emotionalState,
    })

    // Conversation Planner Engine (AFTER Opportunity, BEFORE Writer): decide what the chat should achieve.
    const conversationPlanner = runConversationPlannerEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationIntent,
      languageAwareness,
      conversationOpportunity,
      emotionalState,
    })

    // Conversation Opening Engine (AFTER Intent + Language + Opportunity + Planner, BEFORE Writer).
    const conversationOpening = runConversationOpeningEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationIntent,
      languageAwareness,
      conversationOpportunity,
      conversationMemoryMap: input.conversationMemoryMap || null,
      conversationPreferenceProfile: input.conversationPreferenceProfile || null,
    })

    // Opening Intelligence Engine (AFTER Conversation Opening): first impression must create value.
    const openingIntelligence = runOpeningIntelligenceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationIntent,
      languageAwareness,
      conversationOpening,
      conversationMemoryMap: input.conversationMemoryMap || null,
    })

    // Small Talk Intelligence (AFTER Opening Intelligence): greetings as doorway to relationship.
    const smallTalkIntelligence = runSmallTalkIntelligenceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationIntent,
      languageAwareness,
      socialConversation,
      openingIntelligence,
      conversationMemoryMap: input.conversationMemoryMap || null,
    })

    // Think Before Speaking Framework (after Intent/Leadership, before Thoughtfulness): silent reasoning.
    const thinkBeforeSpeaking = runThinkBeforeSpeaking({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      session: conversation.memory,
      understanding: null,
      languageAwareness,
    })

    // Conversation Director (after Think Before Speaking, before Thoughtfulness): direct conversation, not information.
    const conversationDirector = runConversationDirector({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      thinkBeforeSpeaking,
      session: conversation.memory,
      languageAwareness,
    })

    // Thoughtfulness Engine (after Leadership, before Deep Thinking): best conversational contribution.
    const thoughtfulness = runThoughtfulnessEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      session: conversation.memory,
      understanding: null,
    })

    // Deep Thinking Engine (after Thoughtfulness, before Writer): explore directions, pick best.
    const deepThinking = runDeepThinkingEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      thoughtfulness,
      session: conversation.memory,
      understanding: null,
    })

    // Deep Thinking Writer (after Deep Thinking, before Presence/Writer): layered depth structure.
    const deepThinkingWriter = runDeepThinkingWriter({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      deepThinking,
      session: conversation.memory,
      understanding: null,
      languageAwareness,
      conversationOpportunity,
    })

    // Reasoning Expansion (after Deep Thinking Writer): expand current idea, no subject-change padding.
    const reasoningExpansion = runReasoningExpansionEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      deepThinking,
      deepThinkingWriter,
      session: conversation.memory,
      understanding: null,
      languageAwareness,
    })

    // Presence Engine (after Reasoning Expansion, before Writer): organic aliveness / style / ending.
    const presence = runPresenceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      deepThinking,
      thoughtfulness,
      session: conversation.memory,
    })
    if (presence.plan?.style && conversation.memory) {
      const prev = Array.isArray(conversation.memory.recentPresenceStyles)
        ? conversation.memory.recentPresenceStyles
        : []
      conversation.memory.recentPresenceStyles = [...prev, presence.plan.style].slice(-6)
    }

    // Response Mode Engine (after Presence): choose HOW to respond; vary modes so conversation breathes.
    const responseMode = runResponseModeEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      deepThinking,
      presence,
      session: conversation.memory,
      languageAwareness,
    })
    if (responseMode.plan?.mode && conversation.memory) {
      const prevModes = Array.isArray(conversation.memory.recentResponseModes)
        ? conversation.memory.recentResponseModes
        : []
      conversation.memory.recentResponseModes = [...prevModes, responseMode.plan.mode].slice(-8)
    }

    // Human Conversation Corpus (after Response Mode): spoken dialogue bias vs essay/published voice.
    const humanConversationCorpus = runHumanConversationCorpus({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      responseMode,
      session: conversation.memory,
      languageAwareness,
    })

    // Wisdom Engine (after Human Conversation Corpus, before Writer): useful / appropriate / meaningful.
    const wisdom = runWisdomEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationIntent,
      conversationLeadership,
      deepThinking,
      presence,
      thoughtfulness,
      session: conversation.memory,
    })

    // Conversation Taste (after Wisdom, before Writer): beautiful / enjoyable to read.
    const conversationTaste = runConversationTaste({
      userMessage: input.userMessage,
      messages: input.messages,
      presence,
      wisdom,
      deepThinking,
      thoughtfulness,
      session: conversation.memory,
    })

    // Conversation Memory Flow (after Taste / Memory Map): spontaneous weave, never dump.
    const conversationMemoryFlow = runConversationMemoryFlow({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationMemoryMap: memoryMapRun.map,
      session: conversation.memory,
      presence,
      wisdom,
    })

    // Self Reflection Engine (after Memory Flow): silent quality checklist before Writer.
    const selfReflection = runSelfReflectionEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      presence,
      wisdom,
      conversationTaste,
      conversationMemoryFlow,
    })

    // Human Impact Constitution (fundamental purpose: feel less alone).
    const humanImpactConstitution = runHumanImpactConstitution({
      userMessage: input.userMessage,
      messages: input.messages,
      languageAwareness,
    })

    // Project SOUL — Social Operating Understanding Layer (north star: enjoyable partner).
    const projectSoul = runProjectSoul({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationIntent,
      languageAwareness,
      conversationPlanner,
      emotionalState,
    })

    // LAIfe Manifesto — founding identity (improve lives through conversation).
    const laifeManifesto = runLaifeManifesto({
      userMessage: input.userMessage,
      messages: input.messages,
      languageAwareness,
    })

    // Conversation Constitution (global immutable law for every Writer response).
    const conversationConstitution = runConversationConstitution({
      userMessage: input.userMessage,
      messages: input.messages,
    })

    // Conversation Ownership Protocol (after Constitution / HCS cues; before Worth Reading).
    const conversationOwnership = runConversationOwnershipProtocol({
      userMessage: input.userMessage,
      messages: input.messages,
    })

    // Worth Reading Protocol (LAST craft before Writer — after Ownership / before Coordinator+HCS).
    const worthReading = runWorthReadingProtocol({
      userMessage: input.userMessage,
      messages: input.messages,
      conversationConstitution,
      selfReflection,
      conversationOwnership,
    })

    const session = {
      currentTopic: conversation.memory?.currentTopic,
      followUpKind: conversation.memory?.followUpKind,
      alreadyExplained: conversation.memory?.alreadyExplained,
      topicShift: conversation.memory?.topicShift,
      knowledgeLevel: conversation.memory?.knowledgeLevel,
      knowledgeTopic: conversation.memory?.knowledgeTopic,
      recentPresenceStyles: conversation.memory?.recentPresenceStyles,
      recentResponseModes: conversation.memory?.recentResponseModes,
      currentGoal: conversation.memory?.currentGoal,
    }

    const plan = buildCognitivePlan(
      input,
      session,
      socialConversation.plan,
      conversationIntent.plan,
      conversationLeadership.plan,
      thinkBeforeSpeaking.plan,
      conversationDirector.plan,
      thoughtfulness.plan,
      deepThinking.plan,
      deepThinkingWriter.plan,
      reasoningExpansion.plan,
      presence.plan,
      responseMode.plan,
      humanConversationCorpus.plan,
      wisdom.plan,
      conversationTaste.plan,
      conversationMemoryFlow.plan,
      selfReflection.plan,
      conversationConstitution.plan,
      humanImpactConstitution.plan,
      projectSoul.plan,
      laifeManifesto.plan,
      conversationOwnership.plan,
      worthReading.plan,
      languageAwareness.plan,
      conversationOpportunity.plan,
      conversationPlanner.plan,
      conversationOpening.plan,
      openingIntelligence.plan,
      smallTalkIntelligence.plan,
    )

    // Language Awareness → sticky session language + override understanding.language.
    if (
      languageAwareness.plan?.active &&
      (languageAwareness.plan.replyLanguage === 'it' ||
        languageAwareness.plan.replyLanguage === 'en')
    ) {
      plan.understanding = {
        ...plan.understanding,
        language: languageAwareness.plan.replyLanguage,
      }
    }
    persistConversationLanguage(conversation.memory, languageAwareness.plan)

    const follow = conversation.memory.followUpKind

    // Knowledge Level Estimator: continuous per-topic estimate (advisor → Coordinator applies brief).
    const knowledge = runKnowledgeLevelEstimator({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      priorLevel: input.priorKnowledgeLevel || conversation.memory?.knowledgeLevel || null,
      understanding: plan.understanding,
    })

    if (knowledge.plan?.level) {
      plan.understanding = {
        ...plan.understanding,
        technicalLevel: knowledge.plan.level,
      }
      plan.knowledgeLevel = knowledge.plan
      // Keep legacy 3-value consumers coherent when they only know beginner/intermediate/expert
      plan.legacyTechnicalLevel = toLegacyTechnicalLevel(knowledge.plan.level)
      // Persist on short-term memory for continuous re-estimation next turn
      conversation.memory.knowledgeLevel = knowledge.plan.level
      conversation.memory.knowledgeTopic = knowledge.plan.topic
      conversation.memory.knowledgeConfidence = knowledge.plan.confidence
    }

    // Information Value Estimator: score candidate pieces; keep few high-value ideas.
    const informationValue = runInformationValueEstimator({
      userMessage: input.userMessage,
      plan,
      session: conversation.memory,
    })
    plan.infoValue = informationValue.plan
    plan.infoValueContext = informationValue.context || ''

    // Snapshot base structure before advisors propose (Coordinator decides later).
    const baseStructure = [...(plan.responseStructure || [])]

    // --- Advisors propose (no independent Writer mutations) ---

    // Dynamic Behavior Model: select conversation behavior for this turn (not a fixed persona).
    const behavior = runDynamicBehaviorModel({
      userMessage: input.userMessage,
      understanding: {
        ...(plan.understanding || {}),
        realGoal: plan.realGoal,
      },
      session: conversation.memory,
      continuation: continuation.plan,
      personalityBias: input.personalityBias || input.personality || null,
    })

    // Re-evaluate Expert Teacher with full session (continue / clarify / example).
    const expertTeacher = runExpertTeacher({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      session: conversation.memory,
      planHints: {
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
      },
    })
    if (expertTeacher.plan) {
      plan.expertTeacher = expertTeacher.plan
    }

    // Follow-ups stay fast unless user asked to deepen (effort hint only — tools/structure via Coordinator).
    if (
      (follow === 'continue' ||
        follow === 'ack' ||
        follow === 'example' ||
        follow === 'clarify') &&
      plan.adaptive &&
      follow !== 'clarify'
    ) {
      plan.adaptive = {
        ...plan.adaptive,
        mode: follow === 'example' ? plan.adaptive.mode : 'quick_answer',
        effort: 'minimal',
        keepFast: true,
        writerBrief: [
          plan.adaptive.writerBrief,
          'Follow-up di continuità: resta sul filo, effort minimo, non resettare.',
        ].join(' '),
      }
    }

    const task = runTaskPlanner({
      userMessage: input.userMessage,
      attachments: input.attachments,
      memoryEnabled: input.memoryEnabled,
      conversationGoal: conversation.memory.currentGoal,
      cognitiveRealGoal: plan.realGoal,
    })

    // Next-ask prediction: estimate likely follow-up; shape the CURRENT answer toward it.
    const nextAsk = runNextAskPrediction({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      continuation: continuation.plan,
      learningSignals: reflection.signals,
      planHints: {
        technicalLevel: plan.understanding?.technicalLevel || 'intermediate',
        complexity: plan.understanding?.complexity || 'medium',
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
        knowledgeLevel: plan.knowledgeLevel?.level || plan.understanding?.technicalLevel,
      },
    })

    // Curiosity Engine: after the answer, pick ONE natural next-interest beat (or silence).
    const curiosity = runCuriosityEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      continuation: continuation.plan,
      nextAskPrediction: nextAsk.plan?.prediction || null,
      planHints: {
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
        teachingLikely:
          plan.understanding?.primaryIntent === 'explanation' ||
          plan.understanding?.primaryIntent === 'how_to' ||
          plan.understanding?.primaryIntent === 'question' ||
          /spieg|explain|how\s+|come\s+|perch/i.test(input.userMessage || ''),
      },
    })

    // Conversation Momentum: before finishing, keep flow — one valuable beat or natural end.
    const momentum = runConversationMomentum({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      continuation: continuation.plan,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        topic: plan.understanding?.topic || conversation.memory?.currentTopic,
        complexity: plan.understanding?.complexity,
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
        teachingLikely:
          plan.understanding?.primaryIntent === 'explanation' ||
          plan.understanding?.primaryIntent === 'how_to' ||
          /spieg|explain|how\s+|come\s+|perch/i.test(input.userMessage || ''),
      },
    })

    // Intellectual Initiative: one high-value insight before closing — or silence.
    const intellectualInitiative = runIntellectualInitiativeEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      continuation: continuation.plan,
      topicLeadership: topicLeadership.plan,
      planHints: {
        topic: plan.understanding?.topic || conversation.memory?.currentTopic,
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
        teachingLikely:
          plan.understanding?.primaryIntent === 'explanation' ||
          plan.understanding?.primaryIntent === 'how_to' ||
          plan.understanding?.primaryIntent === 'question' ||
          /spieg|explain|how\s+|come\s+|perch/i.test(input.userMessage || ''),
      },
    })

    // Surprise Without Confusion: one unexpected idea that supports learning — or silence.
    const surprise = runSurpriseWithoutConfusion({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      continuation: continuation.plan,
      topicLeadership: topicLeadership.plan,
      planHints: {
        topic: plan.understanding?.topic || conversation.memory?.currentTopic,
        primaryIntent: plan.understanding?.primaryIntent,
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
        teachingLikely:
          plan.understanding?.primaryIntent === 'explanation' ||
          plan.understanding?.primaryIntent === 'how_to' ||
          plan.understanding?.primaryIntent === 'question' ||
          /spieg|explain|how\s+|come\s+|perch/i.test(input.userMessage || ''),
      },
    })

    // Plugin Architecture: discover relevant plugins for reasoning (isolated from conversation core).
    const pluginArchitecture = runPluginArchitecture({
      userMessage: input.userMessage,
    })

    // Life Intelligence (pre-tools): connect lifeContext + conversation signals → high-value tips only.
    let life = runLifeIntelligenceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      lifeContext: input.lifeContext || null,
      session: conversation.memory,
      continuation: continuation.plan,
      planHints: {
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
      },
    })

    // Natural Language Automation Builder: describe → draft (triggers/conditions/actions) → explain → confirm.
    const automationBuilder = runNaturalLanguageAutomationBuilder({
      userMessage: input.userMessage,
      messages: input.messages,
      pendingAutomation: input.pendingAutomation || null,
    })

    // Universal Device Manager: capability-first device inventory + intent matches (adapter plugins).
    const deviceManager = await runUniversalDeviceManager({
      userMessage: input.userMessage,
      execute: false,
    })

    // Multi-Step Task Planner: when several actions are needed, plan → execute in order → recover.
    const multiStep = await runMultiStepTaskPlanner({
      userMessage: input.userMessage,
      grantedPermissions: input.grantedPermissions || [],
      pendingAction: input.pendingAction || null,
    })

    // Universal Action Engine: single real-world actions (skip when multi-step owns the turn).
    const actionEngine = multiStep.plan?.active
      ? {
          plan: {
            actionRequired: false,
            phase: 'idle',
            writerBrief: '',
            pendingActionPayload: multiStep.pendingAction || null,
          },
          context: '',
        }
      : await runUniversalActionEngine({
          userMessage: input.userMessage,
          messages: input.messages,
          pendingAction: input.pendingAction || null,
          grantedPermissions: input.grantedPermissions || [],
        })

    // Intellectual Honesty: epistemic ceiling before claims (pre-tools; refreshed after tools).
    let honesty = runIntellectualHonesty({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
      },
      toolResults: [],
    })

    // Adaptive Self-Awareness: assistant feedback → ack + reflect + adapt (no topic continuation).
    const feedbackInterpretation = runAdaptiveSelfAwareness({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversationPreferenceProfile: input.conversationPreferenceProfile || null,
      planHints: {
        topic: plan.understanding?.topic || conversation.memory?.currentTopic,
      },
    })

    // Warm Conversation: enjoy chat — greetings/casual starts feel human, not transactional.
    const warmConversation = runWarmConversation({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      session: conversation.memory,
      behavior: behavior.plan,
      welcome,
      continuation,
      topicLeadership,
      feedbackInterpretation,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        topic: plan.understanding?.topic || conversation.memory?.currentTopic,
        behavior: behavior.plan?.behavior,
      },
    })

    // Conversation Spark: when leading, open like a curious person — never AI topic-hunting.
    const conversationSpark = runConversationSparkEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      topicLeadership,
      conversationOwnership,
      warmConversation,
      welcome,
      socialConversation,
      conversationLeadership,
      languageAwareness,
      conversationOpportunity,
      writerDirectives: null,
    })
    if (conversationSpark.plan?.shouldSpark && conversationSpark.plan.structureLine) {
      const sparkHints = conversationSparkStructureHints(conversationSpark.plan)
      if (sparkHints.length) {
        plan.responseStructure = [
          ...sparkHints,
          ...(plan.responseStructure || []).filter(
            (line) => !sparkHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Natural Dialogue Engine (AFTER language/social/intent/mode; BEFORE WriterDirectives):
    // classify conversational move; react before explaining.
    const naturalDialogue = runNaturalDialogueEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      socialConversation,
      conversationIntent,
      conversationLeadership,
      behavior,
      conversationMode: behavior.plan?.behavior || null,
      plan,
    })
    if (naturalDialogue.plan?.active) {
      const ndHints = naturalDialogueStructureHints(naturalDialogue.plan)
      if (ndHints.length) {
        plan.responseStructure = [
          ...ndHints,
          ...(plan.responseStructure || []).filter(
            (line) => !ndHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Conversational Pragmatics (AFTER Natural Dialogue; BEFORE WriterDirectives):
    // intended meaning > literal wording (teasing, irony, banter, …).
    const conversationalPragmatics = runConversationalPragmaticsEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      socialConversation,
      conversationIntent,
      naturalDialogue,
      plan,
    })
    if (conversationalPragmatics.plan?.active) {
      const cpHints = conversationalPragmaticsStructureHints(conversationalPragmatics.plan)
      if (cpHints.length) {
        plan.responseStructure = [
          ...cpHints,
          ...(plan.responseStructure || []).filter(
            (line) => !cpHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Narrative Conversation (AFTER Pragmatics; BEFORE WriterDirectives):
    // "Continua." / "Wow" → next paragraph of the same story, not Wikipedia.
    const narrativeConversation = runNarrativeConversationEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      naturalDialogue,
      conversationalPragmatics,
      plan,
    })
    if (narrativeConversation.plan?.active) {
      const nvHints = narrativeConversationStructureHints(narrativeConversation.plan)
      if (nvHints.length) {
        plan.responseStructure = [
          ...nvHints,
          ...(plan.responseStructure || []).filter(
            (line) => !nvHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Emotional Momentum (AFTER Narrative; BEFORE WriterDirectives):
    // Track trajectory across turns — preserve climate until the user shifts it.
    const emotionalMomentum = runEmotionalMomentumEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      naturalDialogue,
      conversationalPragmatics,
      narrativeConversation,
      plan,
    })
    if (emotionalMomentum.plan?.active) {
      const emHints = emotionalMomentumStructureHints(emotionalMomentum.plan)
      if (emHints.length) {
        plan.responseStructure = [
          ...emHints,
          ...(plan.responseStructure || []).filter(
            (line) => !emHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Personality Consistency (AFTER Emotional Momentum; BEFORE WriterDirectives):
    // Stable identity across the conversation — never robotic/formal/lecturer/therapist.
    const personalityConsistency = runPersonalityConsistencyEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      plan,
    })
    if (personalityConsistency.plan?.active) {
      const pcHints = personalityConsistencyStructureHints(personalityConsistency.plan)
      if (pcHints.length) {
        plan.responseStructure = [
          ...pcHints,
          ...(plan.responseStructure || []).filter(
            (line) => !pcHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Personal Voice (AFTER Personality Consistency): recognizable how LAIfe speaks.
    const personalVoice = runPersonalVoiceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      personalityConsistency,
      plan,
    })
    if (personalVoice.plan?.active) {
      const pvHints = personalVoiceStructureHints(personalVoice.plan)
      if (pvHints.length) {
        plan.responseStructure = [
          ...pvHints,
          ...(plan.responseStructure || []).filter(
            (line) => !pvHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Human Imperfection (AFTER Personality Consistency; BEFORE WriterDirectives):
    // Occasional light texture — never overuse; naturality, not imitation.
    const humanImperfection = runHumanImperfectionEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      personalityConsistency,
      plan,
    })
    if (humanImperfection.plan?.active) {
      const hiHints = humanImperfectionStructureHints(humanImperfection.plan)
      if (hiHints.length) {
        plan.responseStructure = [
          ...hiHints,
          ...(plan.responseStructure || []).filter(
            (line) => !hiHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Conversational Memory (AFTER Human Imperfection; BEFORE WriterDirectives):
    // Remember THIS conversation — themes, jokes, opinions, comparisons, emotions; refer back; avoid re-explaining.
    const conversationalMemory = runConversationalMemoryEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      conversationMemoryMap: memoryMapRun.map,
      emotionalMomentum,
      personalityConsistency,
      humanImperfection,
      plan,
    })
    if (conversationalMemory.plan?.active) {
      const cmHints = conversationalMemoryStructureHints(conversationalMemory.plan)
      if (cmHints.length) {
        plan.responseStructure = [
          ...cmHints,
          ...(plan.responseStructure || []).filter(
            (line) => !cmHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Conversational Presence: feel present — engage meaning, shared thought, not restart/interview.
    const conversationalPresence = runConversationalPresence({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      behavior: behavior.plan,
      continuation,
      warmConversation,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        behavior: behavior.plan?.behavior,
      },
    })

    // Question Economy: continue-first; ask only when it genuinely moves the thread.
    const questionEconomy = runQuestionEconomy({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      behavior: behavior.plan,
      continuation,
      topicLeadership,
      warmConversation,
      feedbackInterpretation,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        behavior: behavior.plan?.behavior,
      },
    })

    // Genuine Curiosity (AFTER Question Economy; BEFORE WriterDirectives):
    // Questions must be earned from real curiosity — never keep-alive fillers.
    const genuineCuriosity = runGenuineCuriosityEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      questionEconomy,
      conversationalMemory,
      emotionalMomentum,
      plan,
    })
    if (genuineCuriosity.plan?.active) {
      const gcHints = genuineCuriosityStructureHints(genuineCuriosity.plan)
      if (gcHints.length) {
        plan.responseStructure = [
          ...gcHints,
          ...(plan.responseStructure || []).filter(
            (line) => !gcHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Deep Listening (AFTER Genuine Curiosity; BEFORE WriterDirectives):
    // Identify what the user is really saying — facts/emotions/intentions/hidden meaning — then respond.
    const deepListening = runDeepListeningEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      conversationIntent,
      emotionalMomentum,
      warmConversation,
      conversationalPresence,
      genuineCuriosity,
      plan,
    })
    if (deepListening.plan?.active) {
      const dlHints = deepListeningStructureHints(deepListening.plan)
      if (dlHints.length) {
        plan.responseStructure = [
          ...dlHints,
          ...(plan.responseStructure || []).filter(
            (line) => !dlHints.some((h) => h === line),
          ),
        ]
      }
    }

    // Conversation Pace (AFTER Deep Listening; BEFORE WriterDirectives):
    // Vary speed/shape — short, reaction, reflective, story — rhythm should feel alive.
    const conversationPace = runConversationPaceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      behavior,
      genuineCuriosity,
      voice: Boolean(input.voice) || input.modality === 'voice',
      planHints: {
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
      },
      plan,
    })
    if (conversationPace.plan?.active) {
      const cpHints = conversationPaceStructureHints(conversationPace.plan)
      if (cpHints.length) {
        plan.responseStructure = [
          ...cpHints,
          ...(plan.responseStructure || []).filter(
            (line) => !cpHints.some((h) => h === line),
          ),
        ]
      }
    }


    // Natural Topic Transition (AFTER Conversation Pace; BEFORE WriterDirectives):
    const naturalTopicTransition = runNaturalTopicTransitionEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      conversationPace,
      plan,
    })
    if (naturalTopicTransition.plan?.active) {
      const __hints = naturalTopicTransitionStructureHints(naturalTopicTransition.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Authentic Agreement (soft advisor; BEFORE WriterDirectives):
    const authenticAgreement = runAuthenticAgreementEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      naturalTopicTransition,
      plan,
    })
    if (authenticAgreement.plan?.active) {
      const __hints = authenticAgreementStructureHints(authenticAgreement.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Conversation Recovery (soft advisor; BEFORE WriterDirectives):
    const conversationRecovery = runConversationRecoveryEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      authenticAgreement,
      plan,
    })
    if (conversationRecovery.plan?.active) {
      const __hints = conversationRecoveryStructureHints(conversationRecovery.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Internal Monologue (soft advisor; BEFORE WriterDirectives):
    const internalMonologue = runInternalMonologueEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      conversationRecovery,
      plan,
    })
    if (internalMonologue.plan?.active) {
      const __hints = internalMonologueStructureHints(internalMonologue.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Micro Observation (soft advisor; BEFORE WriterDirectives):
    const microObservation = runMicroObservationEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      internalMonologue,
      plan,
    })
    if (microObservation.plan?.active) {
      const __hints = microObservationStructureHints(microObservation.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Human Conversation Score (soft advisor; BEFORE WriterDirectives):
    const humanConversationScore = runHumanConversationScoreGate({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      microObservation,
      plan,
    })
    if (humanConversationScore.plan?.active) {
      const __hints = humanConversationScoreStructureHints(humanConversationScore.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Emotional Resonance (soft advisor; BEFORE WriterDirectives):
    const emotionalResonance = runEmotionalResonanceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      humanConversationScore,
      plan,
    })
    if (emotionalResonance.plan?.active) {
      const __hints = emotionalResonanceStructureHints(emotionalResonance.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Wonder (soft advisor; BEFORE WriterDirectives):
    const wonder = runWonderEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      emotionalResonance,
      plan,
    })
    if (wonder.plan?.active) {
      const __hints = wonderStructureHints(wonder.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Shared Discovery (soft advisor; BEFORE WriterDirectives):
    const sharedDiscovery = runSharedDiscoveryEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      wonder,
      plan,
    })
    if (sharedDiscovery.plan?.active) {
      const __hints = sharedDiscoveryStructureHints(sharedDiscovery.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Conversation Chemistry (soft advisor; BEFORE WriterDirectives):
    const conversationChemistry = runConversationChemistryEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      sharedDiscovery,
      plan,
    })
    if (conversationChemistry.plan?.active) {
      const __hints = conversationChemistryStructureHints(conversationChemistry.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Intelligent Silence (soft advisor; BEFORE WriterDirectives):
    const intelligentSilence = runIntelligentSilenceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      conversationChemistry,
      plan,
    })
    if (intelligentSilence.plan?.active) {
      const __hints = intelligentSilenceStructureHints(intelligentSilence.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Storytelling (soft advisor; BEFORE WriterDirectives):
    const storytelling = runStorytellingEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      intelligentSilence,
      plan,
    })
    if (storytelling.plan?.active) {
      const __hints = storytellingStructureHints(storytelling.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Emotional Continuity (soft advisor; BEFORE WriterDirectives):
    const emotionalContinuity = runEmotionalContinuityEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      storytelling,
      plan,
    })
    if (emotionalContinuity.plan?.active) {
      const __hints = emotionalContinuityStructureHints(emotionalContinuity.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Human Timing (soft advisor; BEFORE WriterDirectives):
    const humanTiming = runHumanTimingEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      emotionalContinuity,
      plan,
    })
    if (humanTiming.plan?.active) {
      const __hints = humanTimingStructureHints(humanTiming.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Conversational Creativity (soft advisor; BEFORE WriterDirectives):
    const conversationalCreativity = runConversationalCreativityEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      humanTiming,
      plan,
    })
    if (conversationalCreativity.plan?.active) {
      const __hints = conversationalCreativityStructureHints(conversationalCreativity.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }


    // Authentic Opinions (soft advisor; BEFORE WriterDirectives):
    const authenticOpinions = runAuthenticOpinionsEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      languageAwareness,
      emotionalMomentum,
      genuineCuriosity,
      conversationalCreativity,
      plan,
    })
    if (authenticOpinions.plan?.active) {
      const __hints = authenticOpinionsStructureHints(authenticOpinions.plan)
      if (__hints.length) {
        plan.responseStructure = [
          ...__hints,
          ...(plan.responseStructure || []).filter(
            (line) => !__hints.some((h) => h === line),
          ),
        ]
      }
    }

    // Conversation Mindset: contribute, don't merely answer — enjoyable evolving dialogue.
    const conversationMindset = runConversationMindset({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      behavior: behavior.plan,
      continuation,
      topicLeadership,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        behavior: behavior.plan?.behavior,
      },
    })

    // Conversation Delight: enjoyable to read — surprise, smile, lingering thought; not flat answers.
    const conversationDelight = runConversationDelight({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      behavior: behavior.plan,
      continuation,
      warmConversation,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        behavior: behavior.plan?.behavior,
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
        topic: plan.understanding?.topic || conversation.memory?.currentTopic,
        expects: conversationIntent.plan?.inference?.expects,
        opennessToContinue: conversationIntent.plan?.inference?.opennessToContinue,
      },
    })

    // Cognitive Coordinator: advisors propose → rank → dedupe → resolve → limit → apply.
    const suggestions = collectAdvisorSuggestions({
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
      narrativeConversation,
      emotionalMomentum,
      personalityConsistency,
      personalVoice,
      humanImperfection,
      conversationalMemory,
      conversationalPresence,
      questionEconomy,
      genuineCuriosity,
      deepListening,
      conversationPace,
      naturalTopicTransition,
      authenticAgreement,
      conversationRecovery,
      internalMonologue,
      microObservation,
      humanConversationScore,
      emotionalResonance,
      wonder,
      sharedDiscovery,
      conversationChemistry,
      intelligentSilence,
      storytelling,
      emotionalContinuity,
      humanTiming,
      conversationalCreativity,
      authenticOpinions,
      conversationOpportunity,
      conversationPlanner,
      conversationOpening,
      openingIntelligence,
      smallTalkIntelligence,
      conversationMindset,
      conversationDelight,
      socialConversation,
      conversationIntent,
      conversationLeadership,
      thinkBeforeSpeaking,
      conversationDirector,
      thoughtfulness,
      deepThinking,
      deepThinkingWriter,
      reasoningExpansion,
      presence,
      responseMode,
      humanConversationCorpus,
      wisdom,
      conversationTaste,
      conversationMemoryFlow,
      selfReflection,
      conversationConstitution,
      humanImpactConstitution,
      projectSoul,
      laifeManifesto,
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
    })

    const coordination = runCognitiveCoordinator({
      plan,
      baseStructure,
      suggestions,
      continuation,
      voice,
      multiStep,
      actionEngine,
      automationBuilder,
      topicLeadership,
      feedbackInterpretation,
      warmConversation,
      conversationSpark,
      naturalDialogue,
      conversationalPragmatics,
      narrativeConversation,
      emotionalMomentum,
      personalityConsistency,
      personalVoice,
      humanImperfection,
      conversationalMemory,
      conversationalPresence,
      questionEconomy,
      genuineCuriosity,
      deepListening,
      conversationPace,
      naturalTopicTransition,
      authenticAgreement,
      conversationRecovery,
      internalMonologue,
      microObservation,
      humanConversationScore,
      emotionalResonance,
      wonder,
      sharedDiscovery,
      conversationChemistry,
      intelligentSilence,
      storytelling,
      emotionalContinuity,
      humanTiming,
      conversationalCreativity,
      authenticOpinions,
      conversationOpportunity,
      conversationPlanner,
      conversationOpening,
      openingIntelligence,
      smallTalkIntelligence,
      conversationMindset,
      conversationDelight,
      socialConversation,
      conversationIntent,
      conversationLeadership,
      thinkBeforeSpeaking,
      conversationDirector,
      thoughtfulness,
      deepThinking,
      deepThinkingWriter,
      reasoningExpansion,
      presence,
      responseMode,
      humanConversationCorpus,
      wisdom,
      conversationTaste,
      conversationMemoryFlow,
      selfReflection,
      conversationConstitution,
      humanImpactConstitution,
      projectSoul,
      laifeManifesto,
      conversationOwnership,
      worthReading,
      languageAwareness,
      behavior,
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
      conversation,
      conversationMemoryMap: memoryMapRun.map,
    })

    applyCoordination(plan, coordination, {
      pendingAction:
        multiStep.pendingAction ||
        actionEngine.plan?.pendingActionPayload ||
        null,
    })

    if (automationBuilder.plan?.pendingAutomationPayload) {
      plan.pendingAutomation = automationBuilder.plan.pendingAutomationPayload
    } else if (automationBuilder.plan?.phase === 'enabled' || automationBuilder.plan?.phase === 'cancelled') {
      plan.pendingAutomation = null
    }

    // Step 3 — memories first, then remaining tools
    /** @type {import('./orchestrator.js').ToolResult[]} */
    let toolResults = []
    const order = [...plan.toolOrder]
    const memoryFirst = order.includes('memory')
    const rest = order.filter((t) => t !== 'memory')

    if (memoryFirst) {
      try {
        const mem = await executeTools(['memory'], {
          userMessage: input.userMessage,
          attachments: input.attachments,
          memoryEnabled: input.memoryEnabled,
        })
        toolResults = toolResults.concat(mem)
        plan.memoryRetrieved = mem.some((r) => r.status === 'ok' || r.status === 'empty')
      } catch {
        plan.memoryRetrieved = false
      }
    }

    if (rest.length > 0) {
      try {
        const more = await executeTools(rest, {
          userMessage: input.userMessage,
          attachments: input.attachments,
          memoryEnabled: input.memoryEnabled,
        })
        toolResults = toolResults.concat(more)
      } catch {
        // fail-soft
      }
    }

    const toolContext =
      toolResults.length > 0 ? buildOrchestratorContext(toolResults) : ''

    // Re-run Life Intelligence with tool facts (e.g. weather) — still silence unless high value.
    life = runLifeIntelligenceEngine({
      userMessage: input.userMessage,
      messages: input.messages,
      lifeContext: input.lifeContext || null,
      toolResults,
      session: conversation.memory,
      continuation: continuation.plan,
      planHints: {
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
        emotionalTone: plan.understanding?.emotionalTone || 'neutral',
      },
    })

    // Refresh Intellectual Honesty with tool evidence — confidence must match evidence.
    honesty = runIntellectualHonesty({
      userMessage: input.userMessage,
      messages: input.messages,
      understanding: plan.understanding,
      planHints: {
        primaryIntent: plan.understanding?.primaryIntent,
        keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
      },
      toolResults,
    })
    if (honesty.plan?.active && honesty.plan.writerBrief) {
      plan.writerDirective = [plan.writerDirective, honesty.plan.writerBrief]
        .filter(Boolean)
        .join(' ')
      if (!(plan.responseStructure || []).some((s) => /intellectual honesty|epistemic/i.test(s))) {
        plan.responseStructure = [
          ...(plan.responseStructure || []).slice(0, 6),
          `Epistemic ceiling: ${honesty.plan.ceiling} (mai sopra; confidenza = evidenza)`,
        ]
      }
    }

    // If tools unlocked a stronger life tip and no coda was coordinated, soft-apply one beat.
    if (
      life.plan?.shouldSuggest &&
      life.plan.chosen &&
      life.plan.writerBrief &&
      !plan.coordination?.winners?.coda &&
      !continuation.plan?.isShortMessage
    ) {
      const line = `Life tip (una sola, concisa): ${life.plan.chosen.recommendation}`
      if (!(plan.responseStructure || []).some((s) => /life tip|life intelligence/i.test(s))) {
        plan.responseStructure = [...(plan.responseStructure || []).slice(0, 5), line]
      }
      plan.writerDirective = [plan.writerDirective, life.plan.writerBrief]
        .filter(Boolean)
        .join(' ')
      if (plan.coordination) {
        plan.coordination.winners = {
          ...(plan.coordination.winners || {}),
          coda: 'life_intelligence',
        }
      }
    }

    // Directive Authority: freeze pipeline decisions into immutable WriterDirectives.
    // Writer must obey these — they are NOT suggestions.
    // Natural Dialogue + Conversational Pragmatics already ran (pre-directives).
    const directiveAuthority = runDirectiveAuthority({
      userMessage: input.userMessage,
      messages: input.messages,
      plan,
      coordination,
      session: conversation.memory,
      languageAwareness,
      socialConversation,
      conversationIntent,
      conversationLeadership,
      presence,
      conversationOwnership,
      worthReading,
      questionEconomy,
      warmConversation,
      welcome,
      topicLeadership,
      behavior,
      naturalDialogue,
      conversationalPragmatics,
      modality: input.modality,
      voice: input.voice,
      debugDirectives: input.debugDirectives === true,
      debug: input.debug === true,
    })
    plan.writerDirectives = directiveAuthority.directives
    // Reaction-only dialogue / playful pragmatics beats: soft overlay on writerBrief.
    if (
      ((naturalDialogue.plan?.active && naturalDialogue.plan.reactionOnly) ||
        (conversationalPragmatics.plan?.active && conversationalPragmatics.plan.reactionOnly)) &&
      plan.writerDirectives
    ) {
      try {
        // Soft overlay via writerBrief — frozen object stays authoritative language/mode.
        plan.writerDirective = [
          conversationalPragmatics.plan?.active
            ? conversationalPragmatics.plan.writerBrief
            : '',
          naturalDialogue.plan?.active ? naturalDialogue.plan.writerBrief : '',
          `Pre-directive overlay: askQuestion=false · reactionOnly · length=short.`,
          directiveAuthority.directives.writerBrief,
          conversationSpark.plan?.shouldSpark ? conversationSpark.plan.writerBrief : '',
          plan.writerDirective,
        ]
          .filter(Boolean)
          .join(' ')
      } catch {
        plan.writerDirective = [
          directiveAuthority.directives.writerBrief,
          plan.writerDirective,
        ]
          .filter(Boolean)
          .join(' ')
      }
    } else {
      plan.writerDirective = [
        directiveAuthority.directives.writerBrief,
        conversationalPragmatics.plan?.active
          ? conversationalPragmatics.plan.writerBrief
          : '',
        narrativeConversation.plan?.active
          ? narrativeConversation.plan.writerBrief
          : '',
        naturalDialogue.plan?.active ? naturalDialogue.plan.writerBrief : '',
        conversationSpark.plan?.shouldSpark ? conversationSpark.plan.writerBrief : '',
        plan.writerDirective,
      ]
        .filter(Boolean)
        .join(' ')
    }

    const writerBlock = formatPlanForWriter(plan)
    const coordinatorContext = formatCoordinatorForWriter(coordination)
    const directiveAuthorityContext = directiveAuthority.context || ''
    const conversationContext = conversation.context || ''
    const memoryMapContext = memoryMapRun.context || ''
    const taskPlanContext = task.context || ''
    const reflectionContext = reflection.context || ''
    const continuationContext = continuation.context || ''
    const nextAskContext = nextAsk.context || ''
    const curiosityContext = curiosity.context || ''
    const momentumContext = momentum.context || ''
    const intellectualInitiativeContext = intellectualInitiative.context || ''
    const surpriseContext = surprise.context || ''
    const honestyContext = honesty.context || ''
    const feedbackContext = feedbackInterpretation.context || ''
    const warmConversationContext = warmConversation.context || ''
    const conversationSparkContext = conversationSpark.context || ''
    const naturalDialogueContext = naturalDialogue.context || ''
    const conversationalPragmaticsContext = conversationalPragmatics.context || ''
    const narrativeConversationContext = narrativeConversation.context || ''
    const emotionalMomentumContext = emotionalMomentum.context || ''
    const personalityConsistencyContext = personalityConsistency.context || ''
    const personalVoiceContext = personalVoice.context || ''
    const humanImperfectionContext = humanImperfection.context || ''
    const conversationalMemoryContext = conversationalMemory.context || ''
    const genuineCuriosityContext = genuineCuriosity.context || ''
    const deepListeningContext = deepListening.context || ''
    const conversationPaceContext = conversationPace.context || ''
    const naturalTopicTransitionContext = naturalTopicTransition.context || ''
    const authenticAgreementContext = authenticAgreement.context || ''
    const conversationRecoveryContext = conversationRecovery.context || ''
    const internalMonologueContext = internalMonologue.context || ''
    const microObservationContext = microObservation.context || ''
    const humanConversationScoreContext = humanConversationScore.context || ''
    const emotionalResonanceContext = emotionalResonance.context || ''
    const wonderContext = wonder.context || ''
    const sharedDiscoveryContext = sharedDiscovery.context || ''
    const conversationChemistryContext = conversationChemistry.context || ''
    const intelligentSilenceContext = intelligentSilence.context || ''
    const storytellingContext = storytelling.context || ''
    const emotionalContinuityContext = emotionalContinuity.context || ''
    const humanTimingContext = humanTiming.context || ''
    const conversationalCreativityContext = conversationalCreativity.context || ''
    const authenticOpinionsContext = authenticOpinions.context || ''
    const conversationOpportunityContext = conversationOpportunity.context || ''
    const conversationPlannerContext = conversationPlanner.context || ''
    const conversationOpeningContext = conversationOpening.context || ''
    const openingIntelligenceContext = openingIntelligence.context || ''
    const smallTalkIntelligenceContext = smallTalkIntelligence.context || ''
    const conversationalPresenceContext = conversationalPresence.context || ''
    const questionEconomyContext = questionEconomy.context || ''
    const conversationMindsetContext = conversationMindset.context || ''
    const conversationDelightContext = conversationDelight.context || ''
    const socialConversationContext = socialConversation.context || ''
    const conversationIntentContext = conversationIntent.context || ''
    const conversationLeadershipContext = conversationLeadership.context || ''
    const thinkBeforeSpeakingContext = thinkBeforeSpeaking.context || ''
    const conversationDirectorContext = conversationDirector.context || ''
    const thoughtfulnessContext = thoughtfulness.context || ''
    const deepThinkingContext = deepThinking.context || ''
    const deepThinkingWriterContext = deepThinkingWriter.context || ''
    const reasoningExpansionContext = reasoningExpansion.context || ''
    const presenceContext = presence.context || ''
    const responseModeContext = responseMode.context || ''
    const humanConversationCorpusContext = humanConversationCorpus.context || ''
    const wisdomContext = wisdom.context || ''
    const conversationTasteContext = conversationTaste.context || ''
    const conversationMemoryFlowContext = conversationMemoryFlow.context || ''
    const selfReflectionContext = selfReflection.context || ''
    const conversationConstitutionContext = conversationConstitution.context || ''
    const humanImpactConstitutionContext = humanImpactConstitution.context || ''
    const projectSoulContext = projectSoul.context || ''
    const laifeManifestoContext = laifeManifesto.context || ''
    const conversationOwnershipContext = conversationOwnership.context || ''
    const worthReadingContext = worthReading.context || ''
    const languageAwarenessContext = languageAwareness.context || ''
    const actionContext = actionEngine.context || ''
    const pluginContext = pluginArchitecture.context || ''
    const multiStepContext = multiStep.context || ''
    const voiceContext = voice.context || ''
    const behaviorContext = behavior.context || ''
    const knowledgeContext = knowledge.context || ''
    const welcomeContext = welcome.context || ''
    const lifeContextBlock = life.context || ''
    const automationContext = automationBuilder.context || ''
    const deviceManagerContext = deviceManager.context || ''
    const topicLeadershipContext = topicLeadership.context || ''
    // Advisor contexts are diagnostic; WriterDirectives are the sole authority surface.
    // Supporting blocks MUST NOT override WriterDirectives.
    const context = [
      directiveAuthorityContext,
      deepListeningContext,
      conversationPaceContext,
      naturalTopicTransitionContext,
      authenticAgreementContext,
      conversationRecoveryContext,
      internalMonologueContext,
      microObservationContext,
      humanConversationScoreContext,
      emotionalResonanceContext,
      wonderContext,
      sharedDiscoveryContext,
      conversationChemistryContext,
      intelligentSilenceContext,
      storytellingContext,
      emotionalContinuityContext,
      humanTimingContext,
      conversationalCreativityContext,
      authenticOpinionsContext,
      conversationOpportunityContext,
      conversationPlannerContext,
      genuineCuriosityContext,
      conversationalMemoryContext,
      humanImperfectionContext,
      personalVoiceContext,
      personalityConsistencyContext,
      emotionalMomentumContext,
      narrativeConversationContext,
      conversationalPragmaticsContext,
      naturalDialogueContext,
      coordinatorContext,
      languageAwarenessContext,
      conversationConstitutionContext,
      humanImpactConstitutionContext,
      projectSoulContext,
      laifeManifestoContext,
      conversationOwnershipContext,
      worthReadingContext,
      socialConversationContext,
      conversationIntentContext,
      conversationLeadershipContext,
      thinkBeforeSpeakingContext,
      conversationDirectorContext,
      thoughtfulnessContext,
      deepThinkingContext,
      deepThinkingWriterContext,
      reasoningExpansionContext,
      presenceContext,
      responseModeContext,
      humanConversationCorpusContext,
      wisdomContext,
      conversationTasteContext,
      conversationMemoryFlowContext,
      selfReflectionContext,
      feedbackContext,
      conversationDelightContext,
      conversationMindsetContext,
      warmConversationContext,
      conversationSparkContext,
      conversationOpeningContext,
      openingIntelligenceContext,
      smallTalkIntelligenceContext,
      conversationalPresenceContext,
      questionEconomyContext,
      welcomeContext,
      topicLeadershipContext,
      knowledgeContext,
      honestyContext,
      lifeContextBlock,
      automationContext,
      deviceManagerContext,
      writerBlock,
      behaviorContext,
      memoryMapContext,
      conversationContext,
      taskPlanContext,
      toolContext,
      reflectionContext,
      continuationContext,
      nextAskContext,
      curiosityContext,
      momentumContext,
      intellectualInitiativeContext,
      surpriseContext,
      pluginContext,
      actionContext,
      multiStepContext,
      voiceContext,
    ]
      .filter(Boolean)
      .join('\n\n')

    return {
      plan,
      writerBlock,
      writerDirectives: directiveAuthority.directives,
      directiveAuthorityContext,
      directiveDebugReport: directiveAuthority.debugReport,
      naturalDialogueContext,
      naturalDialogue: naturalDialogue.plan,
      conversationalPragmaticsContext,
      conversationalPragmatics: conversationalPragmatics.plan,
      narrativeConversationContext,
      narrativeConversation: narrativeConversation.plan,
      emotionalMomentumContext,
      emotionalMomentum: emotionalMomentum.plan,
      personalityConsistencyContext,
      personalityConsistency: personalityConsistency.plan,
      personalVoiceContext,
      personalVoice: personalVoice.plan,
      humanImperfectionContext,
      humanImperfection: humanImperfection.plan,
      conversationalMemoryContext,
      conversationalMemory: conversationalMemory.plan,
      genuineCuriosityContext,
      genuineCuriosity: genuineCuriosity.plan,
      deepListeningContext,
      deepListening: deepListening.plan,
      conversationPaceContext,
      conversationPace: conversationPace.plan,
      naturalTopicTransitionContext,
      naturalTopicTransition: naturalTopicTransition.plan,
      authenticAgreementContext,
      authenticAgreement: authenticAgreement.plan,
      conversationRecoveryContext,
      conversationRecovery: conversationRecovery.plan,
      internalMonologueContext,
      internalMonologue: internalMonologue.plan,
      microObservationContext,
      microObservation: microObservation.plan,
      humanConversationScoreContext,
      humanConversationScore: humanConversationScore.plan,
      emotionalResonanceContext,
      emotionalResonance: emotionalResonance.plan,
      wonderContext,
      wonder: wonder.plan,
      sharedDiscoveryContext,
      sharedDiscovery: sharedDiscovery.plan,
      conversationChemistryContext,
      conversationChemistry: conversationChemistry.plan,
      intelligentSilenceContext,
      intelligentSilence: intelligentSilence.plan,
      storytellingContext,
      storytelling: storytelling.plan,
      emotionalContinuityContext,
      emotionalContinuity: emotionalContinuity.plan,
      humanTimingContext,
      humanTiming: humanTiming.plan,
      conversationalCreativityContext,
      conversationalCreativity: conversationalCreativity.plan,
      authenticOpinionsContext,
      authenticOpinions: authenticOpinions.plan,
      conversationOpportunityContext,
      conversationOpportunity: conversationOpportunity.plan,
      conversationPlannerContext,
      conversationPlanner: conversationPlanner.plan,
      conversationOpeningContext,
      conversationOpening: conversationOpening.plan,
      openingIntelligenceContext,
      openingIntelligence: openingIntelligence.plan,
      smallTalkIntelligenceContext,
      smallTalkIntelligence: smallTalkIntelligence.plan,
      toolContext,
      conversationContext,
      taskPlanContext,
      reflectionContext,
      continuationContext,
      nextAskContext,
      curiosityContext,
      momentumContext,
      intellectualInitiativeContext,
      surpriseContext,
      honestyContext,
      honesty: honesty.plan,
      feedbackContext,
      feedbackInterpretation: feedbackInterpretation.plan,
      warmConversationContext,
      warmConversation: warmConversation.plan,
      conversationSparkContext,
      conversationSpark: conversationSpark.plan,
      conversationalPresenceContext,
      conversationalPresence: conversationalPresence.plan,
      questionEconomyContext,
      questionEconomy: questionEconomy.plan,
      conversationMindsetContext,
      conversationMindset: conversationMindset.plan,
      conversationDelightContext,
      conversationDelight: conversationDelight.plan,
      socialConversationContext,
      socialConversation: socialConversation.plan,
      conversationIntentContext,
      conversationIntentPlan: conversationIntent.plan,
      conversationLeadershipContext,
      conversationLeadership: conversationLeadership.plan,
      thinkBeforeSpeakingContext,
      thinkBeforeSpeaking: thinkBeforeSpeaking.plan,
      conversationDirectorContext,
      conversationDirector: conversationDirector.plan,
      thoughtfulnessContext,
      thoughtfulness: thoughtfulness.plan,
      deepThinkingContext,
      deepThinking: deepThinking.plan,
      deepThinkingWriterContext,
      deepThinkingWriter: deepThinkingWriter.plan,
      reasoningExpansionContext,
      reasoningExpansion: reasoningExpansion.plan,
      presenceContext,
      presence: presence.plan,
      responseModeContext,
      responseMode: responseMode.plan,
      humanConversationCorpusContext,
      humanConversationCorpus: humanConversationCorpus.plan,
      wisdomContext,
      wisdom: wisdom.plan,
      conversationTasteContext,
      conversationTaste: conversationTaste.plan,
      conversationMemoryFlowContext,
      conversationMemoryFlow: conversationMemoryFlow.plan,
      selfReflectionContext,
      selfReflection: selfReflection.plan,
      conversationConstitutionContext,
      conversationConstitution: conversationConstitution.plan,
      humanImpactConstitutionContext,
      humanImpactConstitution: humanImpactConstitution.plan,
      projectSoulContext,
      projectSoul: projectSoul.plan,
      laifeManifestoContext,
      laifeManifesto: laifeManifesto.plan,
      conversationOwnershipContext,
      conversationOwnership: conversationOwnership.plan,
      worthReadingContext,
      worthReading: worthReading.plan,
      languageAwarenessContext,
      languageAwareness: languageAwareness.plan,
      pluginContext,
      actionContext,
      multiStepContext,
      voiceContext,
      behaviorContext,
      knowledgeContext,
      knowledge: knowledge.plan,
      knowledgeLevel: knowledge.plan?.level || null,
      coordinatorContext,
      coordination,
      welcomeContext,
      topicLeadershipContext,
      topicLeadership: topicLeadership.plan,
      lifeIntelligenceContext: lifeContextBlock,
      life: life.plan,
      automationContext,
      automation: automationBuilder.plan,
      pendingAutomation: plan.pendingAutomation || null,
      deviceManagerContext,
      deviceManager: deviceManager.plan,
      learningSignals: reflection.signals,
      continuation: continuation.plan,
      nextAsk: nextAsk.plan,
      curiosity: curiosity.plan,
      momentum: momentum.plan,
      intellectualInitiative: intellectualInitiative.plan,
      surprise: surprise.plan,
      plugins: pluginArchitecture.suggestions,
      action: actionEngine.plan,
      multiStep: {
        plan: multiStep.plan,
        results: multiStep.results,
        stoppedEarly: multiStep.stoppedEarly,
      },
      voice: voice.plan,
      voiceSession: voice.plan?.session || null,
      behavior: behavior.plan,
      welcome: welcome.plan,
      welcomeSession: welcome.welcomeSession || welcome.plan?.session || null,
      conversationMemoryMap: memoryMapRun.map,
      memoryMapContext,
      conversationPreferenceProfile: feedbackInterpretation.preferenceProfile || null,
      context,
    }
  } catch {
    const emptyPlan = buildCognitivePlan({
      userMessage: input?.userMessage || '',
      attachments: [],
      memoryEnabled: false,
    })
    const emptySignals = {
      workedWell: [],
      neededClarification: [],
      apparentPreferences: [],
      mistakesToAvoid: [],
      directive: '',
      turnCount: 0,
      createdAt: Date.now(),
    }
    return {
      plan: emptyPlan,
      writerBlock: '',
      writerDirectives: null,
      directiveAuthorityContext: '',
      directiveDebugReport: '',
      toolContext: '',
      conversationContext: '',
      taskPlanContext: '',
      reflectionContext: '',
      continuationContext: '',
      nextAskContext: '',
      curiosityContext: '',
      momentumContext: '',
      intellectualInitiativeContext: '',
      surpriseContext: '',
      honestyContext: '',
      honesty: null,
      feedbackContext: '',
      feedbackInterpretation: null,
      warmConversationContext: '',
      warmConversation: null,
      naturalDialogueContext: '',
      naturalDialogue: null,
      conversationalPragmaticsContext: '',
      conversationalPragmatics: null,
      narrativeConversationContext: '',
      narrativeConversation: null,
      emotionalMomentumContext: '',
      emotionalMomentum: null,
      personalityConsistencyContext: '',
      personalityConsistency: null,
      personalVoiceContext: '',
      personalVoice: null,
      humanImperfectionContext: '',
      humanImperfection: null,
      conversationalMemoryContext: '',
      conversationalMemory: null,
      genuineCuriosityContext: '',
      genuineCuriosity: null,
      deepListeningContext: '',
      deepListening: null,
      conversationPaceContext: '',
      conversationPace: null,
      naturalTopicTransitionContext: '',
      naturalTopicTransition: null,
      authenticAgreementContext: '',
      authenticAgreement: null,
      conversationRecoveryContext: '',
      conversationRecovery: null,
      internalMonologueContext: '',
      internalMonologue: null,
      microObservationContext: '',
      microObservation: null,
      humanConversationScoreContext: '',
      humanConversationScore: null,
      emotionalResonanceContext: '',
      emotionalResonance: null,
      wonderContext: '',
      wonder: null,
      sharedDiscoveryContext: '',
      sharedDiscovery: null,
      conversationChemistryContext: '',
      conversationChemistry: null,
      intelligentSilenceContext: '',
      intelligentSilence: null,
      storytellingContext: '',
      storytelling: null,
      emotionalContinuityContext: '',
      emotionalContinuity: null,
      humanTimingContext: '',
      humanTiming: null,
      conversationalCreativityContext: '',
      conversationalCreativity: null,
      authenticOpinionsContext: '',
      authenticOpinions: null,
      conversationOpportunityContext: '',
      conversationOpportunity: null,
      conversationPlannerContext: '',
      conversationPlanner: null,
      conversationOpeningContext: '',
      conversationOpening: null,
      openingIntelligenceContext: '',
      openingIntelligence: null,
      smallTalkIntelligenceContext: '',
      smallTalkIntelligence: null,
      conversationSparkContext: '',
      conversationSpark: null,
      conversationalPresenceContext: '',
      conversationalPresence: null,
      questionEconomyContext: '',
      questionEconomy: null,
      conversationMindsetContext: '',
      conversationMindset: null,
      conversationDelightContext: '',
      conversationDelight: null,
      socialConversationContext: '',
      socialConversation: null,
      conversationIntentContext: '',
      conversationIntentPlan: null,
      conversationLeadershipContext: '',
      conversationLeadership: null,
      thinkBeforeSpeakingContext: '',
      thinkBeforeSpeaking: null,
      conversationDirectorContext: '',
      conversationDirector: null,
      thoughtfulnessContext: '',
      thoughtfulness: null,
      deepThinkingContext: '',
      deepThinking: null,
      deepThinkingWriterContext: '',
      deepThinkingWriter: null,
      reasoningExpansionContext: '',
      reasoningExpansion: null,
      presenceContext: '',
      presence: null,
      responseModeContext: '',
      responseMode: null,
      humanConversationCorpusContext: '',
      humanConversationCorpus: null,
      wisdomContext: '',
      wisdom: null,
      conversationTasteContext: '',
      conversationTaste: null,
      conversationMemoryFlowContext: '',
      conversationMemoryFlow: null,
      selfReflectionContext: '',
      selfReflection: null,
      conversationConstitutionContext: '',
      conversationConstitution: null,
      humanImpactConstitutionContext: '',
      humanImpactConstitution: null,
      projectSoulContext: '',
      projectSoul: null,
      laifeManifestoContext: '',
      laifeManifesto: null,
      conversationOwnershipContext: '',
      conversationOwnership: null,
      worthReadingContext: '',
      worthReading: null,
      languageAwarenessContext: '',
      languageAwareness: null,
      pluginContext: '',
      actionContext: '',
      multiStepContext: '',
      voiceContext: '',
      behaviorContext: '',
      knowledgeContext: '',
      knowledge: null,
      knowledgeLevel: null,
      coordinatorContext: '',
      coordination: null,
      welcomeContext: '',
      topicLeadershipContext: '',
      topicLeadership: null,
      lifeIntelligenceContext: '',
      life: null,
      automationContext: '',
      automation: null,
      pendingAutomation: null,
      deviceManagerContext: '',
      deviceManager: null,
      learningSignals: emptySignals,
      continuation: null,
      nextAsk: null,
      curiosity: null,
      momentum: null,
      intellectualInitiative: null,
      surprise: null,
      plugins: [],
      action: null,
      multiStep: null,
      voice: null,
      voiceSession: null,
      behavior: null,
      welcome: null,
      welcomeSession: null,
      conversationMemoryMap: null,
      memoryMapContext: '',
      conversationPreferenceProfile: null,
      context: '',
    }
  }
}
