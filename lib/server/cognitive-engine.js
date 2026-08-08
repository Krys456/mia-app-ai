/**
 * LAIfe Cognitive Engine — invisible planning before any user-facing text.
 *
 * Runs before the Writer. Does NOT generate the reply. Does NOT speak to the user.
 * Only builds the best possible plan, then hands it to the Writer (+ tool context).
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
 * @typedef {object} MessageUnderstanding
 * @property {string} primaryIntent
 * @property {string[]} secondaryRequests
 * @property {string} topic
 * @property {'beginner'|'intermediate'|'expert'} technicalLevel
 * @property {string} language
 * @property {'casual'|'neutral'|'formal'|'urgent'} tone
 * @property {'low'|'medium'|'high'} urgency
 * @property {'low'|'medium'|'high'} complexity
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
 * @property {string[]} responseStructure
 * @property {string} writerDirective
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

function detectUrgency(text, tone) {
  if (tone === 'urgent') return /** @type {const} */ ('high')
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
 * Phase 1 — Understand the message (no user-facing text).
 * @param {string} userMessage
 * @returns {MessageUnderstanding}
 */
export function understandMessage(userMessage) {
  const text = String(userMessage || '').trim()
  const tone = detectTone(text)
  return {
    primaryIntent: detectPrimaryIntent(text),
    secondaryRequests: detectSecondaryRequests(text),
    topic: detectTopic(text),
    technicalLevel: detectTechnicalLevel(text),
    language: detectLanguage(text),
    tone,
    urgency: detectUrgency(text, tone),
    complexity: detectComplexity(text),
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
    re: /\b(universit[àa]|studentes[sa]|lezioni|tesi|esame|school|college|campus|prendere\s+appunti)\b/i,
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
  return /\b(miglior[ei]?|best|consigli[oa]mi|dovrei|should\s+i|which|quale|compr[oa]|buy|scegli[ea]r)\b/i.test(
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
  let confidence = /** @type {'high'|'medium'|'low'} */ ('low')
  if (top && top.score >= 2 && (!second || top.score > second.score)) confidence = 'high'
  else if (top && (top.score >= 2 || (second && top.score === second.score))) confidence = 'medium'
  else if (top) confidence = 'medium'
  else confidence = 'low'

  /** @type {string[]} */
  const assumptions = []
  let primary = top ? top.label : null

  // Purchase / "best X" without clear criteria
  if (
    /\b(miglior[ei]?|best|consigli[oa]mi|which\s+.+\s+should\s+i\s+buy|che\s+.+\s+compro|quale\s+.+\s+compr)\b/i.test(
      text,
    )
  ) {
    if (confidence === 'high' && top) {
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions: [],
        realGoal: `Aiutare a scegliere orientando la raccomandazione su “${top.label}” (evidenza nel messaggio/contesto). Non scaricare una lista generica.`,
      }
    }
    if (confidence === 'medium' && top) {
      assumptions.push(
        `Obiettivo più probabile: ${top.label}${second ? ` (anche possibile: ${second.label})` : ''}.`,
      )
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions,
        realGoal: `Aiutare a scegliere con raccomandazione utile centrata su “${top.label}”, dichiarando brevemente l’assunzione se non era esplicita.`,
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
    if (confidence === 'high' && top) {
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions: [],
        realGoal: `Consigliare / confrontare in funzione di “${top.label}”, con trade-off chiari — non rispondere solo alla formulazione di superficie.`,
      }
    }
    if (top) {
      assumptions.push(`Orientamento inferito: ${top.label} (confidenza ${confidence}).`)
      return {
        surfaceAsk: surface,
        candidates,
        primary,
        confidence,
        assumptions,
        realGoal: `Consigliare una direzione chiara centrata sull’obiettivo inferito “${top.label}”, dichiarando l’assunzione se la confidenza non è alta.`,
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
 * Phases 3–4 — Tool need + order / skips.
 * @param {CognitiveInput} input
 * @param {MessageUnderstanding} understanding
 */
export function decideTools(input, understanding) {
  const planned = planTools({
    userMessage: input.userMessage,
    attachments: input.attachments,
    memoryEnabled: input.memoryEnabled,
  })

  let toolOrder = [...planned]
  const text = String(input.userMessage || '')

  // Prefer simplest path: skip web when memory can cover personal recall without freshness
  const freshness =
    /\b(oggi|adesso|attuale|recente|ultime|now|latest|current|202[4-9])\b/i.test(text) ||
    /\b(cerca|ricerca|news|prezzo)\b/i.test(text)

  if (toolOrder.includes('memory') && toolOrder.includes('web') && !freshness) {
    toolOrder = toolOrder.filter((t) => t !== 'web')
  }

  // High urgency → avoid slow/optional tools that don't unlock the answer
  if (understanding.urgency === 'high') {
    toolOrder = toolOrder.filter((t) => t !== 'calendar' && t !== 'reminder')
  }

  // Pure greetings / thanks → no tools
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
 * Phase 5 — Ideal response structure (plan only, not prose).
 * @param {MessageUnderstanding} understanding
 * @param {string} realGoal
 * @param {string[]} secondary
 */
export function outlineResponseStructure(understanding, realGoal, secondary) {
  /** @type {string[]} */
  const structure = []

  if (understanding.urgency === 'high' || understanding.primaryIntent === 'problem_solving') {
    structure.push('Apri con la soluzione / next step concreto')
  } else {
    structure.push('Apri rispondendo all’obiettivo reale (non parafrasare la domanda)')
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

  if (secondary.includes('wants_list') && !structure.some((s) => /Passi|elenco|lista/i.test(s))) {
    structure.push('Usa elenco solo se migliora la leggibilità')
  }

  if (understanding.complexity === 'low' || secondary.includes('wants_brief')) {
    structure.push('Mantieni sintesi: niente preamboli')
  } else if (secondary.includes('wants_depth')) {
    structure.push('Approfondisci con ordine, senza muri di testo')
  }

  structure.push('Chiudi in modo naturale e variato (niente template fisso)')
  structure.push(`Obiettivo reale da servire: ${realGoal}`)

  return structure
}

/**
 * Build the full cognitive plan (Phases 1–5). No tool I/O yet.
 * @param {CognitiveInput} input
 * @returns {CognitivePlan}
 */
export function buildCognitivePlan(input) {
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
  const tools = decideTools(input, understanding)
  const responseStructure = outlineResponseStructure(
    understanding,
    realGoal,
    understanding.secondaryRequests,
  )

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
    'Scrivi UNA sola risposta naturale all’utente.',
    goalBits,
    `Intento primario: ${understanding.primaryIntent}`,
    `Livello tecnico: ${understanding.technicalLevel}; urgenza: ${understanding.urgency}; complessità: ${understanding.complexity}; tono: ${understanding.tone}`,
    understanding.language !== 'auto'
      ? `Lingua della risposta: ${understanding.language === 'it' ? 'italiano' : 'inglese'} (segui l’utente se diverge).`
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
    responseStructure,
    writerDirective,
  }
}

/**
 * Phase 6 — Format plan for the Writer (invisible block).
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

  return `══════════════════════════════════════
COGNITIVE ENGINE → WRITER (INVISIBILE)
══════════════════════════════════════
Questo blocco è un piano interno. NON generarlo come testo. NON citare il Cognitive Engine.
NON rispondere con checklist o analisi. Scrivi solo la risposta finale all’utente.

${plan.writerDirective}

Comprensione:
- intento: ${u.primaryIntent}
- secondarie: ${u.secondaryRequests.join(', ') || '—'}
- argomento: ${u.topic}
- livello tecnico: ${u.technicalLevel}
- lingua: ${u.language}
- tono: ${u.tone}
- urgenza: ${u.urgency}
- complessità: ${u.complexity}

Richiesta di superficie: ${plan.surfaceAsk}
Obiettivo reale (priorità): ${plan.realGoal}
Confidenza obiettivo: ${plan.goalConfidence || 'medium'}

Obiettivi sottostanti candidati:
${goals}

Assunzioni (dichiarale in 1 frase se confidenza low/medium; non fingere certezza):
${assumptions}

Strumenti: ${tools}
Evitati: ${skipped}

Struttura ideale della risposta (segui lo spirito, non stampare questi punti):
${structure}`
}

/**
 * Full Cognitive Engine run:
 * Conversation Intelligence → Universal Task Planner → cognitive plan → tools → Writer.
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

    const plan = buildCognitivePlan(input)
    const follow = conversation.memory.followUpKind

    // Continuity cues: keep the thread, avoid tool spam, elevate conversation goal
    if (
      follow === 'continue' ||
      follow === 'ack' ||
      follow === 'example' ||
      follow === 'clarify'
    ) {
      plan.toolOrder = plan.toolOrder.filter((t) => t === 'memory')
      plan.toolsNeeded = [...plan.toolOrder]
      const all = ['memory', 'web', 'vision', 'document', 'calendar', 'reminder', 'weather', 'calculator']
      plan.toolsSkipped = all.filter((t) => !plan.toolOrder.includes(t))
      plan.realGoal = conversation.memory.currentGoal
      plan.responseStructure = [
        follow === 'example'
          ? 'Apri con un esempio concreto sul filo corrente'
          : follow === 'clarify'
            ? 'Apri chiarendo il punto già toccato, senza rifare tutta la lezione'
            : 'Riprendi dal punto lasciato, senza reset',
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

    // Universal Task Planner — how to solve the problem (no user text, no memory writes)
    const task = runTaskPlanner({
      userMessage: input.userMessage,
      attachments: input.attachments,
      memoryEnabled: input.memoryEnabled,
      conversationGoal: conversation.memory.currentGoal,
      cognitiveRealGoal: plan.realGoal,
    })

    // Merge tool suggestions: prefer intersection-friendly union, simplest path wins on follow-ups
    if (
      follow !== 'continue' &&
      follow !== 'ack' &&
      follow !== 'example' &&
      follow !== 'clarify' &&
      Array.isArray(task.plan?.tools)
    ) {
      const merged = [...new Set([...plan.toolOrder, ...task.plan.tools])]
      // Keep cognitive order first, then any extras from task planner
      plan.toolOrder = merged
      plan.toolsNeeded = [...merged]
    }

    // High-complexity task plans: enrich response structure for the Writer
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

    let toolContext = ''
    if (plan.toolOrder.length > 0) {
      try {
        const results = await executeTools(plan.toolOrder, {
          userMessage: input.userMessage,
          attachments: input.attachments,
          memoryEnabled: input.memoryEnabled,
        })
        toolContext = buildOrchestratorContext(results)
      } catch {
        toolContext = ''
      }
    }

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
