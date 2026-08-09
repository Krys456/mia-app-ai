/**
 * LAIfe Universal Task Planner
 *
 * Runs before the Writer. Invisible. Does not generate user text.
 * Does not reply. Does not save memory.
 *
 * Only job: understand how to solve the user's problem and hand a plan to the Writer.
 *
 * Steps:
 * 1. Comprehend desired outcome
 * 2. Decompose the problem
 * 3. Estimate complexity
 * 4. Choose tools
 * 5. Build internal plan (never show)
 * 6. Pass plan to Writer
 */

import { planTools } from './orchestrator.js'

/** @typedef {import('./orchestrator.js').ToolId} ToolId */
/** @typedef {import('./orchestrator.js').AttachmentHint} AttachmentHint */

/**
 * @typedef {object} TaskPlannerInput
 * @property {string} userMessage
 * @property {AttachmentHint[]} [attachments]
 * @property {boolean} [memoryEnabled]
 * @property {string} [conversationGoal]
 * @property {string} [cognitiveRealGoal]
 */

/**
 * @typedef {object} TaskPlan
 * @property {string} desiredOutcome
 * @property {string} realWant
 * @property {string[]} workstreams
 * @property {'simple'|'medium'|'high'} complexity
 * @property {ToolId[]} tools
 * @property {string[]} executionOrder
 * @property {string} writerBrief
 * @property {string} problemKind
 */

/**
 * @param {string} text
 */
function detectProblemKind(text) {
  const t = String(text || '')
  if (
    /\b(crea|creare|sviluppa|sviluppare|build|costruisc|app|applicazione|saas|prodotto|mvp)\b/i.test(
      t,
    )
  ) {
    return 'build_product'
  }
  if (/\b(impara|imparare|studia|corso|tutorial|spiegami|learn|teach)\b/i.test(t)) {
    return 'learn'
  }
  if (/\b(bug|errore|non\s+funziona|fix|debug|rotto|broken|crash)\b/i.test(t)) {
    return 'troubleshoot'
  }
  if (/\b(scrivi|redigi|bozza|email|post|articolo|copy|write|draft)\b/i.test(t)) {
    return 'write'
  }
  if (
    /\b(miglior|consigli|scegli|decid|conviene|vs|confronta|best|should\s+i|buy)\b/i.test(t)
  ) {
    return 'decide'
  }
  if (/\b(organizza|piano|pianifica|agenda|priorit|roadmap|plan)\b/i.test(t)) {
    return 'organize'
  }
  if (/\b(calcola|quanto|calculate|math)\b/i.test(t)) {
    return 'compute'
  }
  if (/\b(meteo|weather|temperatura)\b/i.test(t)) {
    return 'lookup'
  }
  if (/\b(ricerca|cerca|notizie|search|latest)\b/i.test(t)) {
    return 'research'
  }
  if (t.length < 40 && /^(ciao|ok|grazie|continua|hey|hi)\b/i.test(t.trim())) {
    return 'chat'
  }
  return 'general'
}

/**
 * Step 1 — What they really want / desired end result.
 * @param {string} userMessage
 * @param {string} problemKind
 * @param {string} [cognitiveRealGoal]
 * @param {string} [conversationGoal]
 */
function comprehendOutcome(userMessage, problemKind, cognitiveRealGoal, conversationGoal) {
  const text = String(userMessage || '').trim()
  const seeded = cognitiveRealGoal || conversationGoal || ''

  /** @type {Record<string, { realWant: string, desiredOutcome: string }>} */
  const presets = {
    build_product: {
      realWant: 'Avere un percorso concreto per realizzare il prodotto (non solo un’idea vaga).',
      desiredOutcome: 'Un piano d’azione chiaro: cosa fare prima, dopo, e con quali pezzi.',
    },
    learn: {
      realWant: 'Capire e saper usare il concetto/abilità, al giusto livello.',
      desiredOutcome: 'Spiegazione ordinata + passi o esempi per consolidare.',
    },
    troubleshoot: {
      realWant: 'Sbloccare il problema e tornare operativi.',
      desiredOutcome: 'Diagnosi probabile + azioni di fix in ordine.',
    },
    write: {
      realWant: 'Ottenere un testo pronto (o quasi) da usare.',
      desiredOutcome: 'Bozza utilizzabile + breve guida d’uso se serve.',
    },
    decide: {
      realWant: 'Scegliere con criteri, non ricevere una lista scarica.',
      desiredOutcome: 'Raccomandazione chiara con trade-off.',
    },
    organize: {
      realWant: 'Mettere ordine e priorità.',
      desiredOutcome: 'Struttura / piano prioritizzato immediatamente applicabile.',
    },
    compute: {
      realWant: 'Il risultato corretto, in modo chiaro.',
      desiredOutcome: 'Risultato in evidenza.',
    },
    lookup: {
      realWant: 'Un’informazione aggiornata e utile.',
      desiredOutcome: 'Dato essenziale + contesto minimo.',
    },
    research: {
      realWant: 'Orientarsi su fatti/fonti rilevanti.',
      desiredOutcome: 'Sintesi affidabile + punti chiave.',
    },
    chat: {
      realWant: 'Continuare la conversazione in modo naturale.',
      desiredOutcome: 'Risposta breve e umana.',
    },
    general: {
      realWant: seeded || 'Ottenere aiuto utile sull’intento espresso.',
      desiredOutcome: seeded || `Risolvere: ${text.slice(0, 120) || 'la richiesta'}`,
    },
  }

  const base = presets[problemKind] || presets.general
  if (seeded && problemKind !== 'chat') {
    return {
      realWant: seeded,
      desiredOutcome: base.desiredOutcome,
    }
  }
  return base
}

/**
 * Step 2 — Decompose automatically.
 * @param {string} problemKind
 * @param {string} userMessage
 */
function decompose(problemKind, userMessage) {
  const t = String(userMessage || '')

  if (problemKind === 'build_product') {
    const streams = [
      'obiettivo / utenti',
      'progettazione (scope MVP)',
      'UI',
      'backend',
      'database',
      'memoria / personalizzazione',
      'integrazioni AI',
      'test',
      'deploy',
      'pubblicazione',
    ]
    // Trim streams not implied — keep lean but complete for "app AI"
    if (!/\b(ai|llm|openai|modello|chat)\b/i.test(t)) {
      return streams.filter((s) => s !== 'integrazioni AI' && s !== 'memoria / personalizzazione')
    }
    return streams
  }

  if (problemKind === 'learn') {
    return [
      'livello attuale',
      'concetto centrale',
      'esempio pratico',
      'esercizio / next step',
      'errori comuni',
    ]
  }

  if (problemKind === 'troubleshoot') {
    return [
      'sintomo',
      'ipotesi principali',
      'verifiche rapide',
      'fix',
      'prevenzione',
    ]
  }

  if (problemKind === 'write') {
    return ['obiettivo del testo', 'struttura', 'bozza', 'tono', 'revisione breve']
  }

  if (problemKind === 'decide') {
    return ['criteri', 'opzioni rilevanti', 'trade-off', 'raccomandazione', 'next step']
  }

  if (problemKind === 'organize') {
    return ['obiettivo', 'elenco pezzi', 'priorità', 'sequenza', 'primo passo oggi']
  }

  if (problemKind === 'compute') {
    return ['espressione', 'calcolo', 'risultato']
  }

  if (problemKind === 'lookup' || problemKind === 'research') {
    return ['dato richiesto', 'contesto minimo', 'limiti / incertezza']
  }

  if (problemKind === 'chat') {
    return ['risposta naturale']
  }

  // General: light decomposition from cues
  const parts = ['risposta all’obiettivo principale']
  if (/\be\s+anche\b|\band\s+also\b|inoltre/i.test(t)) parts.push('richieste secondarie')
  if (/\besemp/i.test(t)) parts.push('esempio')
  if (/\bpassi|step|guida/i.test(t)) parts.push('passi ordinati')
  parts.push('chiusura utile')
  return parts
}

/**
 * Step 3 — Complexity.
 * @param {string} problemKind
 * @param {string[]} workstreams
 * @param {string} userMessage
 */
function estimateComplexity(problemKind, workstreams, userMessage) {
  const t = String(userMessage || '')
  const len = t.length
  if (problemKind === 'chat' || problemKind === 'compute' || problemKind === 'lookup') {
    return /** @type {const} */ ('simple')
  }
  if (problemKind === 'build_product' || workstreams.length >= 7 || len > 400) {
    return /** @type {const} */ ('high')
  }
  if (
    problemKind === 'troubleshoot' ||
    problemKind === 'organize' ||
    problemKind === 'decide' ||
    workstreams.length >= 4 ||
    len > 160
  ) {
    return /** @type {const} */ ('medium')
  }
  return /** @type {const} */ ('simple')
}

/**
 * Step 4 — Tools (prefer simplest path; reuse orchestrator heuristics).
 * @param {TaskPlannerInput} input
 * @param {string} problemKind
 * @param {'simple'|'medium'|'high'} complexity
 */
function chooseTools(input, problemKind, complexity) {
  let tools = planTools({
    userMessage: input.userMessage,
    attachments: input.attachments,
    memoryEnabled: input.memoryEnabled,
  })

  if (problemKind === 'chat') {
    tools = []
  }

  // High-complexity product plans rarely need weather/calc noise
  if (problemKind === 'build_product') {
    tools = tools.filter((t) => t === 'memory' || t === 'web')
  }

  if (complexity === 'simple' && problemKind !== 'lookup' && problemKind !== 'compute') {
    tools = tools.filter((t) => t === 'memory')
  }

  return tools
}

/**
 * Step 5 — Internal execution order for the Writer (not user-facing checklist dump).
 * @param {string[]} workstreams
 * @param {'simple'|'medium'|'high'} complexity
 * @param {string} problemKind
 */
function buildExecutionOrder(workstreams, complexity, problemKind) {
  if (problemKind === 'chat') {
    return ['Rispondi in modo naturale e breve']
  }

  if (complexity === 'high') {
    return [
      'Apri con il risultato/direzione d’insieme (1–2 frasi)',
      'Poi sviluppa i workstream in ordine di priorità (MVP prima)',
      'Per ogni pezzo: cosa fare + perché in breve',
      'Chiudi con il primo passo concreto',
    ]
  }

  if (complexity === 'medium') {
    return [
      'Rispondi all’obiettivo reale subito',
      `Copri i pezzi chiave: ${workstreams.slice(0, 5).join(' → ')}`,
      'Evita muri: sezioni o elenchi solo se aiutano',
      'Un next step chiaro',
    ]
  }

  return [
    'Vai dritto al punto',
    workstreams.length > 1 ? `Tocca: ${workstreams.join(', ')}` : 'Copri l’unico pezzo necessario',
    'Niente preamboli',
  ]
}

/**
 * Build the full task plan (Steps 1–5). No I/O. No memory writes.
 * @param {TaskPlannerInput} input
 * @returns {TaskPlan}
 */
export function buildTaskPlan(input) {
  const text = String(input?.userMessage || '').trim()
  const problemKind = detectProblemKind(text)
  const { realWant, desiredOutcome } = comprehendOutcome(
    text,
    problemKind,
    input?.cognitiveRealGoal,
    input?.conversationGoal,
  )
  const workstreams = decompose(problemKind, text)
  const complexity = estimateComplexity(problemKind, workstreams, text)
  const tools = chooseTools(input || { userMessage: text }, problemKind, complexity)
  const executionOrder = buildExecutionOrder(workstreams, complexity, problemKind)

  const writerBrief = [
    'Sei il Writer. Il Universal Task Planner ha già scomposto il problema.',
    'Non mostrare il piano, le checklist interne o i workstream come “fasi del planner”.',
    `L’utente vuole davvero: ${realWant}`,
    `Risultato finale desiderato: ${desiredOutcome}`,
    `Complessità: ${complexity}. Organizza la risposta di conseguenza (semplice → diretta; alta → strutturata ma leggibile).`,
    'Ogni sezione deve far avanzare la soluzione — zero filler.',
  ].join(' ')

  return {
    desiredOutcome,
    realWant,
    workstreams,
    complexity,
    tools,
    executionOrder,
    writerBrief,
    problemKind,
  }
}

/**
 * Step 6 — Format for Writer (invisible).
 * @param {TaskPlan} plan
 */
export function formatTaskPlanForWriter(plan) {
  if (!plan) return ''

  const streams = plan.workstreams.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const order = plan.executionOrder.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const tools = plan.tools.length ? plan.tools.join(' → ') : 'nessuno (solo ragionamento)'

  return `══════════════════════════════════════
UNIVERSAL TASK PLANNER → WRITER (INVISIBILE)
══════════════════════════════════════
Questo è un piano interno per risolvere il problema. NON generarlo come testo.
NON elencare “Step del planner”. Scrivi solo la risposta finale già organizzata.

${plan.writerBrief}

Problema (kind): ${plan.problemKind}
Cosa vuole davvero: ${plan.realWant}
Risultato finale desiderato: ${plan.desiredOutcome}
Complessità: ${plan.complexity}
Strumenti suggeriti: ${tools}

Scomposizione interna (usala per strutturare, non stamparla tal quale):
${streams}

Ordine di esecuzione della risposta:
${order}`
}

/**
 * Full Task Planner run for one turn.
 * @param {TaskPlannerInput} input
 * @returns {{ plan: TaskPlan, context: string }}
 */
export function runTaskPlanner(input) {
  try {
    const plan = buildTaskPlan(input)
    return {
      plan,
      context: formatTaskPlanForWriter(plan),
    }
  } catch {
    return {
      plan: {
        desiredOutcome: 'Risposta utile',
        realWant: 'Aiuto sulla richiesta',
        workstreams: ['risposta'],
        complexity: 'simple',
        tools: [],
        executionOrder: ['Rispondi in modo chiaro'],
        writerBrief: 'Risolvi la richiesta in modo diretto e utile.',
        problemKind: 'general',
      },
      context: '',
    }
  }
}
