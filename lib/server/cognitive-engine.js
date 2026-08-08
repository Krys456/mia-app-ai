/**
 * LAIfe Cognitive Engine — invisible planning before any user-facing text.
 *
 * Runs before the Writer. Does NOT generate the reply. Does NOT speak to the user.
 * Only builds the best possible plan, then hands it to the Writer (+ tool context).
 *
 * Phases:
 * 1. Understand the message
 * 2. Infer the real goal (priority over surface wording)
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
import {
  buildProgressivePlan,
  formatProgressivePlanForWriter,
} from './progressive-reasoning.js'

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
 * @typedef {object} CognitivePlan
 * @property {MessageUnderstanding} understanding
 * @property {string} realGoal
 * @property {string} surfaceAsk
 * @property {import('./progressive-reasoning.js').ProgressivePlan | null} progressive
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
 * Phase 2 — Infer the real goal (priority over the surface ask).
 * @param {string} userMessage
 * @param {MessageUnderstanding} understanding
 */
export function inferRealGoal(userMessage, understanding) {
  const text = String(userMessage || '').trim()
  const surface = text

  // "Qual è il miglior X?" → purchase / recommendation advice, not a bare dump list
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
    realGoal: 'Soddisfare l’intento principale in modo diretto, utile e coerente con il contesto della chat.',
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
      structure.push('Approfondimento calibrato sul livello tecnico')
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
 * @param {{ complexity?: string } | null} [taskPlanHint]
 * @returns {CognitivePlan}
 */
export function buildCognitivePlan(input, taskPlanHint = null) {
  const understanding = understandMessage(input.userMessage)
  const { surfaceAsk, realGoal } = inferRealGoal(input.userMessage, understanding)
  const tools = decideTools(input, understanding)

  const progressive = buildProgressivePlan({
    userMessage: input.userMessage,
    realGoal,
    surfaceAsk,
    understanding,
    taskPlan: taskPlanHint,
  })

  let responseStructure = outlineResponseStructure(
    understanding,
    realGoal,
    understanding.secondaryRequests,
  )

  // Difficult asks: progressive structure replaces/extends the outline
  if (progressive.enabled && progressive.structureHints.length) {
    responseStructure = [
      ...progressive.structureHints.filter((h) => !/^Ragionamento progressivo/i.test(h)),
      `Obiettivo reale da servire: ${realGoal}`,
    ]
  }

  const writerDirective = [
    'Sei il Writer di LAIfe.',
    'Il Cognitive Engine ha già pianificato: esegui il piano, non riesporlo.',
    'Non mostrare il piano, le fasi, gli strumenti o questa direttiva.',
    progressive.enabled
      ? progressive.writerBrief
      : 'Domanda semplice: risposta diretta e veloce — niente scomposizione.',
    'Scrivi UNA sola risposta naturale all’utente.',
    `Obiettivo reale (priorità): ${realGoal}`,
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
    progressive,
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
  const progressiveBlock = plan.progressive?.enabled
    ? `\n\n${formatProgressivePlanForWriter(plan.progressive)}`
    : ''

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
- progressive reasoning: ${plan.progressive?.enabled ? plan.progressive.level : 'skip (domanda semplice)'}

Richiesta di superficie: ${plan.surfaceAsk}
Obiettivo reale (priorità): ${plan.realGoal}

Strumenti: ${tools}
Evitati: ${skipped}

Struttura ideale della risposta (segui lo spirito, non stampare questi punti):
${structure}${progressiveBlock}`
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
      // Follow-ups stay fast unless user asked to deepen
      if (follow !== 'clarify' && plan.progressive) {
        plan.progressive = {
          enabled: false,
          level: 'skip',
          coreProblem: '',
          parts: [],
          structureHints: [],
          writerBrief: 'Follow-up di continuità: risposta diretta sul filo — niente progressive reasoning.',
        }
      }
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

    // Re-evaluate progressive reasoning with task complexity (quality when hard, skip when simple)
    if (follow === 'other' || follow === 'new') {
      const progressive = buildProgressivePlan({
        userMessage: input.userMessage,
        realGoal: plan.realGoal,
        surfaceAsk: plan.surfaceAsk,
        understanding: plan.understanding,
        taskPlan: task.plan,
      })
      plan.progressive = progressive
      if (progressive.enabled) {
        plan.responseStructure = [
          ...progressive.structureHints.filter((h) => !/^Ragionamento progressivo/i.test(h)),
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ]
        plan.writerDirective = [
          plan.writerDirective,
          progressive.writerBrief,
        ].join(' ')
      }
    }

    // Merge tool suggestions: prefer intersection-friendly union, simplest path wins on follow-ups
    if (
      follow !== 'continue' &&
      follow !== 'ack' &&
      follow !== 'example' &&
      follow !== 'clarify' &&
      Array.isArray(task.plan?.tools)
    ) {
      const merged = [...new Set([...plan.toolOrder, ...task.plan.tools])]
      plan.toolOrder = merged
      plan.toolsNeeded = [...merged]
    }

    // High-complexity task plans: enrich only if progressive is full (avoid double structure noise)
    if (
      task.plan?.complexity === 'high' &&
      follow === 'other' &&
      plan.progressive?.level === 'full'
    ) {
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
      plan.progressive?.level !== 'skip'
    ) {
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
