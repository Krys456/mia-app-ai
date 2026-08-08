/**
 * LAIfe Cognitive Engine — Response Planning (invisible) before every answer.
 *
 * Pipeline (never shown to the user):
 * 1. Understand the user's real intent
 * 2. Detect emotional tone
 * 3. Retrieve relevant memories
 * 4. Decide whether web search is needed
 * 5. Identify possible ambiguities
 * 6. Build a response plan (advisors propose)
 * 7. Cognitive Coordinator ranks / dedupes / resolves → final behaviors
 * 8. Hand off to the Writer → generate the final answer
 *
 * Engines are advisors. The Cognitive Coordinator is the final decision maker.
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
import { runDynamicBehaviorModel } from './dynamic-behavior.js'
import {
  runKnowledgeLevelEstimator,
  toLegacyTechnicalLevel,
} from './knowledge-level-estimator.js'
import { runLifeIntelligenceEngine } from './life-intelligence.js'
import { runNaturalLanguageAutomationBuilder } from './nl-automation-builder.js'
import { runUniversalDeviceManager } from './device-manager/index.js'
import { runIntellectualHonesty } from './intellectual-honesty.js'
import { runFeedbackInterpretation } from './feedback-interpretation.js'
import { runWarmConversation } from './warm-conversation.js'
import { runConversationalPresence } from './conversational-presence.js'
import { runQuestionEconomy } from './question-economy.js'
import { runConversationMindset } from './conversation-mindset.js'
import {
  collectAdvisorSuggestions,
  runCognitiveCoordinator,
  applyCoordination,
  formatCoordinatorForWriter,
} from './cognitive-coordinator.js'

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
 * @property {boolean} memoryRetrieved
 * @property {object} [progressive]
 * @property {object} [adaptive]
 * @property {object} [expertTeacher]
 */

function detectLanguage(text) {
  const itHits =
    (text.match(/\b(che|come|sono|perché|perche|qual|voglio|mio|mia|non|con|una|degli|degli)\b/gi) || [])
      .length
  const enHits =
    (text.match(/\b(the|what|how|why|should|would|my|is|are|with|this|that|please)\b/gi) || [])
      .length
  if (itHits === 0 && enHits === 0) return 'auto'
  return itHits >= enHits ? 'it' : 'en'
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
export function buildCognitivePlan(input, session = null) {
  const understanding = understandMessage(input.userMessage)

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

  // Expert Teacher Mode owns educational structure when active.
  if (expertTeacher.plan?.enabled && expertTeacher.plan.structureHints?.length) {
    responseStructure = [
      ...expertTeacher.plan.structureHints,
      'Prosa da ottimo insegnante: progressiva, umana — non enciclopedia',
      `Obiettivo reale da servire: ${realGoal}`,
    ]
  } else if (progressive.enabled && progressive.structureHints?.length) {
    responseStructure = [
      ...progressive.structureHints.filter((h) => !/^Ragionamento progressivo/i.test(h)),
      `Obiettivo reale da servire: ${realGoal}`,
    ]
  } else if (adaptive?.structureHints?.length) {
    responseStructure = [
      ...adaptive.structureHints,
      `Obiettivo reale da servire: ${realGoal}`,
    ]
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
    'Rispondi all’obiettivo sottostante, non solo alla domanda letterale.',
    expertTeacher.plan?.enabled
      ? expertTeacher.plan.writerBrief
      : progressive.enabled
        ? progressive.writerBrief
        : adaptive?.writerBrief || 'Domanda semplice: risposta diretta e veloce.',
    'Scrivi UNA sola risposta naturale all’utente.',
    goalBits,
    `Intento primario: ${understanding.primaryIntent}`,
    `Tono emotivo: ${understanding.emotionalTone}`,
    `Livello tecnico: ${understanding.technicalLevel}; urgenza: ${understanding.urgency}; complessità: ${understanding.complexity}; registro: ${understanding.tone}`,
    ambiguityStrategy,
    understanding.language !== 'auto'
      ? `Lingua della risposta: ${understanding.language === 'it' ? 'italiano' : 'inglese'} (segui l'utente se diverge).`
      : 'Lingua: adatta a quella dell’utente.',
  ].join(' ')

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
COGNITIVE ENGINE → COORDINATOR → WRITER (INVISIBILE)
══════════════════════════════════════
Questo blocco è un piano interno già coordinato. NON generarlo come testo. NON citare Cognitive Engine, Coordinator né planning.
I motori sono advisor; il Cognitive Coordinator ha già risolto i conflitti. Esegui solo i comportamenti accettati.
NON rispondere con checklist o analisi. Scrivi solo la risposta finale all’utente.

${plan.writerDirective}
${coordinationBlock ? `\n${coordinationBlock}\n` : ''}

Pipeline interna completata (non mostrare):
1. Intento reale compreso
2. Tono emotivo rilevato
3. Memorie: ${plan.memoryRetrieved ? 'recuperate se pertinenti' : 'non richieste / non disponibili'}
4. Web search: ${plan.webDecision?.needed ? 'sì' : 'no'} — ${plan.webDecision?.reason || 'n/d'}
5. Ambiguità valutate
6. Piano di risposta costruito
7. → Genera ora la risposta finale

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

    const session = {
      currentTopic: conversation.memory?.currentTopic,
      followUpKind: conversation.memory?.followUpKind,
      alreadyExplained: conversation.memory?.alreadyExplained,
      topicShift: conversation.memory?.topicShift,
      knowledgeLevel: conversation.memory?.knowledgeLevel,
      knowledgeTopic: conversation.memory?.knowledgeTopic,
    }

    const plan = buildCognitivePlan(input, session)
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

    // Feedback Interpretation: meta-feedback → update Conversation Preference Profile + adapt.
    const feedbackInterpretation = runFeedbackInterpretation({
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
      conversationalPresence,
      questionEconomy,
      conversationMindset,
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
      conversationalPresence,
      questionEconomy,
      conversationMindset,
      userMessage: input.userMessage,
      session: conversation.memory,
      conversation,
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

    const writerBlock = formatPlanForWriter(plan)
    const coordinatorContext = formatCoordinatorForWriter(coordination)
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
    const conversationalPresenceContext = conversationalPresence.context || ''
    const questionEconomyContext = questionEconomy.context || ''
    const conversationMindsetContext = conversationMindset.context || ''
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
    // Advisor contexts are diagnostic; Coordinator + Writer block carry the decision.
    const context = [
      coordinatorContext,
      feedbackContext,
      conversationMindsetContext,
      warmConversationContext,
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
      conversationalPresenceContext,
      conversationalPresence: conversationalPresence.plan,
      questionEconomyContext,
      questionEconomy: questionEconomy.plan,
      conversationMindsetContext,
      conversationMindset: conversationMindset.plan,
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
      conversationalPresenceContext: '',
      conversationalPresence: null,
      questionEconomyContext: '',
      questionEconomy: null,
      conversationMindsetContext: '',
      conversationMindset: null,
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
