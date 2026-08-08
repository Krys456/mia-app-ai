/**
 * LAIfe Cognitive Engine — Response Planning (invisible) before every answer.
 *
 * Pipeline (never shown to the user):
 * 1. Understand the user's real intent
 * 2. Detect emotional tone
 * 3. Retrieve relevant memories
 * 4. Decide whether web search is needed
 * 5. Identify possible ambiguities
 * 6. Build a response plan
 * 7. Hand off to the Writer → generate the final answer
 *
 * Phases:
 * 1. Understand the message
 * 2. Infer the underlying / real goal (priority over surface wording)
 * 3. Detect whether tools are needed
 * 4. Decide which tools, order, and what to skip
 * 5. Outline the ideal response structure (plan only — not the text)
 * 6. Pass the plan to the Writer (never show it to the user)
 */

import {
  planTools,
  executeTools,
  buildOrchestratorContext,
  refineToolSelection,
  needsFreshnessOrVerification,
} from './orchestrator.js'
import { runConversationIntelligence } from './conversation-intelligence.js'
import { runTaskPlanner } from './task-planner.js'
import { runConversationReflection } from './conversation-reflection.js'
import { runConversationContinuation } from './conversation-continuation.js'
import {
  buildProgressivePlan,
  formatProgressivePlanForWriter,
} from './progressive-reasoning.js'
import {
  selectAdaptiveStrategy,
  formatAdaptiveStrategyForWriter,
} from './adaptive-reasoning.js'
import { formatPrioritizationForWriter } from './info-prioritization.js'

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
 */

/**
 * @typedef {'neutral'|'frustrated'|'anxious'|'confused'|'excited'|'grateful'|'curious'|'urgent'|'disappointed'|'positive'} EmotionalTone
 */

/**
 * @typedef {object} MessageUnderstanding
 * @property {string} primaryIntent
 * @property {string[]} secondaryRequests
 * @property {string} topic
 * @property {'beginner'|'intermediate'|'expert'} technicalLevel
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
  if (
    /\b(api|sdk|kubernetes|docker|typescript|postgres|oauth|latency|throughput|regex|async|await|ci\/cd|graphql)\b/i.test(
      text,
    )
  ) {
    return /** @type {const} */ ('expert')
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

  let responseStructure = outlineResponseStructure(
    understanding,
    realGoal,
    understanding.secondaryRequests,
    ambiguities,
  )

  if (progressive.enabled && progressive.structureHints?.length) {
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
    progressive.enabled
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
  const priorityBlock = formatPrioritizationForWriter()

  return `══════════════════════════════════════
COGNITIVE ENGINE → RESPONSE PLANNING → WRITER (INVISIBILE)
══════════════════════════════════════
Questo blocco è un piano interno. NON generarlo come testo. NON citare il Cognitive Engine né il planning.
NON rispondere con checklist o analisi. Scrivi solo la risposta finale all’utente (fase 7).

${plan.writerDirective}

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
- livello tecnico: ${u.technicalLevel}
- lingua: ${u.language}
- registro: ${u.tone}
- tono emotivo: ${u.emotionalTone}
- urgenza: ${u.urgency}
- complessità (messaggio): ${u.complexity}
- strategia: ${plan.adaptive ? `${plan.adaptive.mode} / effort ${plan.adaptive.effort}` : '—'} (NON esporre all’utente)

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

${priorityBlock}`.trim()
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
 *   learningSignals: import('./conversation-reflection.js').LearningSignals,
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

    // Short-message continuation: infer intent; maybe add ONE valuable beat.
    const continuation = runConversationContinuation({
      userMessage: input.userMessage,
      messages: input.messages,
      session: conversation.memory,
    })

    const session = {
      currentTopic: conversation.memory?.currentTopic,
      followUpKind: conversation.memory?.followUpKind,
    }

    const plan = buildCognitivePlan(input, session)
    const follow = conversation.memory.followUpKind

    if (
      follow === 'continue' ||
      follow === 'ack' ||
      follow === 'example' ||
      follow === 'clarify'
    ) {
      plan.toolOrder = plan.toolOrder.filter((t) => t === 'memory')
      plan.toolsNeeded = [...plan.toolOrder]
      plan.toolsSkipped = ALL_TOOLS.filter((t) => !plan.toolOrder.includes(t))
      plan.webDecision = { needed: false, reason: 'follow-up di continuità: niente web' }
      plan.realGoal = conversation.memory.currentGoal
      // Follow-ups stay fast unless user asked to deepen
      if (plan.adaptive && follow !== 'clarify') {
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

      if (continuation.plan?.isShortMessage) {
        // Conversation Continuation Engine overrides generic ack structure.
        if (continuation.plan.shouldContinue) {
          plan.responseStructure = [
            'Ack naturale in mezza frase (opzionale) — senza “Perfetto!” ripetitivo',
            `Una sola aggiunta di valore (${continuation.plan.additionKind || 'utile'}) sul filo corrente`,
            'Chiudi senza forzare una domanda; non trasformarlo in un corso infinito',
            `Obiettivo reale da servire: ${conversation.memory.currentGoal}`,
          ]
          plan.realGoal = `Continuare l’apprendimento su: ${conversation.memory.currentTopic}`
        } else {
          plan.responseStructure = [
            'Risposta breve e umana all’ack / chiusura',
            'Niente mini-lezione, niente reset, niente domanda forzata',
            `Obiettivo reale da servire: ${conversation.memory.currentGoal}`,
          ]
        }
        plan.writerDirective = [
          plan.writerDirective,
          conversation.memory.continuityDirective,
          continuation.plan.writerBrief,
        ]
          .filter(Boolean)
          .join(' ')
      } else {
        plan.responseStructure = [
          follow === 'example'
            ? 'Apri con un esempio concreto sul filo corrente'
            : follow === 'clarify'
              ? 'Apri chiarendo il punto già toccato, senza rifare tutta la lezione'
              : 'Riprendi dal punto lasciato, senza reset — non trattare il messaggio come isolato',
          'Aggiungi solo ciò che manca rispetto a quanto già detto',
          'Chiudi in modo naturale e continuo',
          `Obiettivo reale da servire: ${conversation.memory.currentGoal}`,
        ]
        plan.writerDirective = [
          plan.writerDirective,
          conversation.memory.continuityDirective,
        ].join(' ')
      }
    } else if (conversation.memory.topicShift) {
      plan.realGoal = conversation.memory.currentGoal
      plan.writerDirective = [
        plan.writerDirective,
        conversation.memory.continuityDirective,
      ].join(' ')
    } else if (continuation.plan?.isShortMessage) {
      // Short message not already classified as follow-up — still apply continuation plan.
      plan.toolOrder = plan.toolOrder.filter((t) => t === 'memory')
      plan.toolsNeeded = [...plan.toolOrder]
      plan.toolsSkipped = ALL_TOOLS.filter((t) => !plan.toolOrder.includes(t))
      if (continuation.plan.shouldContinue) {
        plan.responseStructure = [
          'Continua il filo con UNA sola aggiunta di valore',
          `Tipo di aggiunta: ${continuation.plan.additionKind || 'utile'}`,
          'Niente reset, niente lezione infinita',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ]
      } else {
        plan.responseStructure = [
          'Risposta breve e naturale',
          'Non forzare la conversazione',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ]
      }
      plan.writerDirective = [plan.writerDirective, continuation.plan.writerBrief]
        .filter(Boolean)
        .join(' ')
    }

    const task = runTaskPlanner({
      userMessage: input.userMessage,
      attachments: input.attachments,
      memoryEnabled: input.memoryEnabled,
      conversationGoal: conversation.memory.currentGoal,
      cognitiveRealGoal: plan.realGoal,
    })

    if (
      follow !== 'continue' &&
      follow !== 'ack' &&
      follow !== 'example' &&
      follow !== 'clarify' &&
      Array.isArray(task.plan?.tools)
    ) {
      const merged = [...new Set([...plan.toolOrder, ...task.plan.tools])]
      plan.toolOrder = plan.webDecision.needed
        ? merged
        : merged.filter((t) => t !== 'web')
      plan.toolsNeeded = [...plan.toolOrder]
      plan.toolsSkipped = ALL_TOOLS.filter((t) => !plan.toolOrder.includes(t))
    }

    if (task.plan?.complexity === 'high' && follow === 'other') {
      plan.responseStructure = [
        `Problema centrale: ${plan.progressive.coreProblem || plan.realGoal}`,
        ...task.plan.workstreams.slice(0, 5).map((w, i) => `Parte ${i + 1}: ${w}`),
        'Ricombina in una risposta unica',
        'Verifica coerenza interna',
        'Scrivi solo la risposta finale',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else if (
      task.plan?.complexity === 'medium' &&
      follow === 'other' &&
      plan.adaptive?.effort !== 'minimal'
    ) {
      plan.writerDirective = [plan.writerDirective, task.plan.writerBrief].join(' ')
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

    const writerBlock = formatPlanForWriter(plan)
    const conversationContext = conversation.context || ''
    const taskPlanContext = task.context || ''
    const reflectionContext = reflection.context || ''
    const continuationContext = continuation.context || ''
    const context = [
      conversationContext,
      taskPlanContext,
      writerBlock,
      toolContext,
      reflectionContext,
      continuationContext,
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
      learningSignals: reflection.signals,
      continuation: continuation.plan,
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
      learningSignals: emptySignals,
      continuation: null,
      context: '',
    }
  }
}
