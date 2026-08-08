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
 * Optimizes for usefulness, clarity, and natural conversation.
 * Never reacts only to the last message: uses session continuity + plan.
 */

import {
  planTools,
  executeTools,
  buildOrchestratorContext,
} from './orchestrator.js'
import { runConversationIntelligence } from './conversation-intelligence.js'
import { runTaskPlanner } from './task-planner.js'

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
 * @typedef {object} CognitivePlan
 * @property {MessageUnderstanding} understanding
 * @property {string} realGoal
 * @property {string} surfaceAsk
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
  if (/\b(consigli[oa]|raccomand|suggerisc|miglior[ei]?|best|should\s+i| conviene)\b/i.test(text)) {
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
  if (/\bdettagliat|approfond|in\s+depth|explain\s+fully\b/i.test(text)) secondary.push('wants_depth')
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
 * Step 1b — Infer the real goal (priority over the surface ask).
 * @param {string} userMessage
 * @param {MessageUnderstanding} understanding
 */
export function inferRealGoal(userMessage, understanding) {
  const text = String(userMessage || '').trim()
  const surface = text

  if (
    /\b(miglior[ei]?|best|consigli[oa]mi|which\s+.+\s+should\s+i\s+buy|che\s+.+\s+compro)\b/i.test(
      text,
    )
  ) {
    return {
      surfaceAsk: surface,
      realGoal:
        'Aiutare a scegliere con criteri e raccomandazione utile (non scaricare una lista generica senza contesto).',
    }
  }

  if (understanding.primaryIntent === 'problem_solving') {
    return {
      surfaceAsk: surface,
      realGoal: 'Sbloccare l’utente: diagnosi rapida + azione concreta, poi dettagli se servono.',
    }
  }

  if (understanding.primaryIntent === 'how_to') {
    return {
      surfaceAsk: surface,
      realGoal: 'Far ottenere il risultato pratico passo dopo passo, al livello tecnico giusto.',
    }
  }

  if (understanding.primaryIntent === 'advice') {
    return {
      surfaceAsk: surface,
      realGoal: 'Consigliare una direzione chiara con trade-off, non solo informazioni sparse.',
    }
  }

  if (understanding.primaryIntent === 'comparison') {
    return {
      surfaceAsk: surface,
      realGoal: 'Aiutare a decidere tra opzioni con criteri rilevanti per l’utente.',
    }
  }

  if (understanding.primaryIntent === 'explanation') {
    return {
      surfaceAsk: surface,
      realGoal: 'Far capire il concetto in modo naturale, calibrato sul livello tecnico.',
    }
  }

  if (understanding.primaryIntent === 'creation') {
    return {
      surfaceAsk: surface,
      realGoal: 'Produrre il pezzo richiesto in forma subito utilizzabile.',
    }
  }

  if (understanding.primaryIntent === 'calculation') {
    return {
      surfaceAsk: surface,
      realGoal: 'Dare il risultato corretto in modo chiaro (e breve).',
    }
  }

  if (understanding.primaryIntent === 'greeting' || understanding.primaryIntent === 'thanks') {
    return {
      surfaceAsk: surface,
      realGoal: 'Rispondere in modo naturale e breve, senza sovrastrutturare.',
    }
  }

  return {
    surfaceAsk: surface,
    realGoal:
      'Soddisfare l’intento reale in modo diretto e utile, tenendo conto del filo della conversazione — non reagire solo all’ultimo messaggio in isolamento.',
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
  }

  if (
    understanding.primaryIntent === 'greeting' ||
    understanding.primaryIntent === 'thanks'
  ) {
    toolOrder = []
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
      structure.push('Criteri di scelta rilevanti')
      structure.push('Raccomandazione chiara (o top 1–2 opzioni con perché)')
      structure.push('Trade-off / cosa evitare')
      break
    case 'how_to':
      structure.push('Passi ordinati e attuabili')
      if (secondary.includes('wants_code')) structure.push('Esempio di codice minimale')
      structure.push('Controllo finale / errore comune')
      break
    case 'explanation':
      structure.push('Idea centrale in una frase')
      structure.push('Approfondimento calibrato sul livello tecnico (progressivo, non dump)')
      if (secondary.includes('wants_examples')) structure.push('Esempio calzante')
      break
    case 'creation':
      structure.push('Consegna del pezzo richiesto')
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
      structure.push('Sviluppo essenziale dell’intento principale')
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
  const { surfaceAsk, realGoal } = inferRealGoal(input.userMessage, understanding)

  const preliminaryTools = planTools({
    userMessage: input.userMessage,
    attachments: input.attachments,
    memoryEnabled: input.memoryEnabled,
  })
  const webDecision = decideWebSearch(input.userMessage, understanding, preliminaryTools)
  const tools = decideTools(input, understanding, webDecision)

  const ambiguities = detectAmbiguities(input.userMessage, understanding, session)
  understanding.ambiguities = ambiguities
  const ambiguityStrategy = buildAmbiguityStrategy(ambiguities, understanding.emotionalTone)

  const responseStructure = outlineResponseStructure(
    understanding,
    realGoal,
    understanding.secondaryRequests,
    ambiguities,
  )

  const writerDirective = [
    'Sei il Writer di LAIfe (fase 7: risposta finale).',
    'Il Response Planning interno è già completo: esegui il piano, non riesporlo.',
    'Non mostrare il piano, le fasi, gli strumenti, le ambiguità o questa direttiva.',
    'Non dire “ho capito che…”, “secondo il piano…”, “prima analizzo…”.',
    'Scrivi UNA sola risposta naturale, utile e chiara.',
    'Non reagire solo all’ultimo messaggio: tieni il filo della conversazione.',
    `Obiettivo reale (priorità): ${realGoal}`,
    `Intento primario: ${understanding.primaryIntent}`,
    `Tono emotivo: ${understanding.emotionalTone}`,
    `Livello tecnico: ${understanding.technicalLevel}; urgenza: ${understanding.urgency}; complessità: ${understanding.complexity}; registro: ${understanding.tone}`,
    ambiguityStrategy,
    understanding.language !== 'auto'
      ? `Lingua della risposta: ${understanding.language === 'it' ? 'italiano' : 'inglese'} (segui l’utente se diverge).`
      : 'Lingua: adatta a quella dell’utente.',
  ].join(' ')

  return {
    understanding,
    realGoal,
    surfaceAsk,
    toolsNeeded: tools.toolsNeeded,
    toolOrder: tools.toolOrder,
    toolsSkipped: tools.toolsSkipped,
    webDecision,
    ambiguities,
    ambiguityStrategy,
    responseStructure,
    writerDirective,
    memoryRetrieved: false,
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
  const amb =
    plan.ambiguities.length > 0
      ? plan.ambiguities.map((a) => `- ${a}`).join('\n')
      : '- nessuna rilevante'

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
4. Web search: ${plan.webDecision.needed ? 'sì' : 'no'} — ${plan.webDecision.reason}
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
- complessità: ${u.complexity}

Richiesta di superficie: ${plan.surfaceAsk}
Obiettivo reale (priorità): ${plan.realGoal}

Ambiguità:
${amb}
Strategia ambiguità: ${plan.ambiguityStrategy}

Strumenti: ${tools}
Evitati: ${skipped}

Struttura ideale della risposta (segui lo spirito, non stampare questi punti):
${structure}`
}

/**
 * Full Response Planning run:
 * Conversation Intelligence → Steps 1–6 → tools → Writer handoff (step 7).
 * Fail-soft: never throws to the caller for planning/tool failures.
 *
 * @param {CognitiveInput} input
 * @returns {Promise<{ plan: CognitivePlan, writerBlock: string, toolContext: string, conversationContext: string, taskPlanContext: string, context: string }>}
 */
export async function runCognitiveEngine(input) {
  try {
    const conversation = runConversationIntelligence({
      userMessage: input.userMessage,
      messages: input.messages,
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
    } else if (conversation.memory.topicShift) {
      plan.realGoal = conversation.memory.currentGoal
      plan.writerDirective = [
        plan.writerDirective,
        conversation.memory.continuityDirective,
      ].join(' ')
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
        'Apri con la direzione d’insieme (risultato desiderato in 1–2 frasi)',
        ...task.plan.workstreams.slice(0, 6).map((w) => `Copri: ${w}`),
        'Chiudi con il primo passo concreto',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else if (task.plan?.complexity === 'medium' && follow === 'other') {
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
    const context = [conversationContext, taskPlanContext, writerBlock, toolContext]
      .filter(Boolean)
      .join('\n\n')

    return {
      plan,
      writerBlock,
      toolContext,
      conversationContext,
      taskPlanContext,
      context,
    }
  } catch {
    const emptyPlan = buildCognitivePlan({
      userMessage: input?.userMessage || '',
      attachments: [],
      memoryEnabled: false,
    })
    return {
      plan: emptyPlan,
      writerBlock: '',
      toolContext: '',
      conversationContext: '',
      taskPlanContext: '',
      context: '',
    }
  }
}
