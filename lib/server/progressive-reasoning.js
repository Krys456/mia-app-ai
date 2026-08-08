/**
 * LAIfe Progressive Reasoning — for difficult questions only.
 *
 * Invisible process (never shown to the user):
 * 1. Identify the core problem
 * 2. Break it into smaller parts
 * 3. Solve each part
 * 4. Recombine them
 * 5. Verify internal consistency
 * 6. Produce the final response
 *
 * Simple questions skip this path entirely (speed).
 * Difficult ones get progressive depth (quality).
 */

/**
 * @typedef {'skip'|'light'|'full'} ProgressiveLevel
 */

/**
 * @typedef {object} ProgressivePlan
 * @property {boolean} enabled
 * @property {ProgressiveLevel} level
 * @property {string} coreProblem
 * @property {string[]} parts
 * @property {string[]} structureHints
 * @property {string} writerBrief
 */

/**
 * Heuristic: should this ask use progressive reasoning?
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {{ complexity?: string, primaryIntent?: string, secondaryRequests?: string[], urgency?: string } | null} [input.understanding]
 * @param {{ complexity?: string } | null} [input.taskPlan]
 * @returns {ProgressiveLevel}
 */
export function decideProgressiveLevel(input) {
  const text = String(input?.userMessage || '').trim()
  const u = input?.understanding || {}
  const taskComplexity = input?.taskPlan?.complexity
  const secondary = u.secondaryRequests || []

  // Always skip: greetings, thanks, pure calc, ultra-short acks
  if (
    u.primaryIntent === 'greeting' ||
    u.primaryIntent === 'thanks' ||
    u.primaryIntent === 'calculation' ||
    text.length < 24
  ) {
    return 'skip'
  }

  if (secondary.includes('wants_brief') && u.complexity !== 'high') {
    return 'skip'
  }

  // Explicit simplicity / speed cues
  if (
    /\b(in\s+sintesi|tl;dr|breve|solo\s+sì\s+o\s+no|one\s+word|quick)\b/i.test(text) &&
    u.complexity !== 'high'
  ) {
    return 'skip'
  }

  const hardIntent =
    u.primaryIntent === 'problem_solving' ||
    u.primaryIntent === 'advice' ||
    u.primaryIntent === 'comparison' ||
    u.primaryIntent === 'how_to' ||
    u.primaryIntent === 'creation'

  const hardSignals =
    u.complexity === 'high' ||
    taskComplexity === 'high' ||
    secondary.includes('wants_depth') ||
    secondary.includes('multi_part') ||
    /\b(architettur|roadmap|trade[\s-]?off|progett|sistema|end[\s-]?to[\s-]?end|passo\s+passo|step\s+by\s+step|analizza|design|migra)\b/i.test(
      text,
    ) ||
    (text.match(/\?/g) || []).length > 1 ||
    text.length > 220

  if (hardSignals) return 'full'

  if (
    hardIntent &&
    (u.complexity === 'medium' || taskComplexity === 'medium' || text.length > 100)
  ) {
    return 'light'
  }

  // Explanations that ask for depth
  if (
    u.primaryIntent === 'explanation' &&
    (u.complexity === 'medium' || u.complexity === 'high' || secondary.includes('wants_depth'))
  ) {
    return u.complexity === 'high' || secondary.includes('wants_depth') ? 'full' : 'light'
  }

  // Default: simple questions stay fast
  return 'skip'
}

/**
 * Extract lightweight sub-parts from the ask (heuristic, no extra model call).
 * @param {string} text
 * @param {string} realGoal
 * @param {{ primaryIntent?: string, secondaryRequests?: string[] } | null} [understanding]
 * @returns {string[]}
 */
export function breakIntoParts(text, realGoal, understanding = null) {
  const t = String(text || '')
  /** @type {string[]} */
  const parts = []

  // Split on explicit multi-asks
  const qMarks = t.split(/\?\s+/).map((s) => s.trim()).filter((s) => s.length > 12)
  if (qMarks.length > 1) {
    for (const q of qMarks.slice(0, 5)) {
      parts.push(q.endsWith('?') ? q : `${q}?`)
    }
  }

  // Conjunction splits
  if (parts.length === 0 && /\be\s+anche\b|\band\s+also\b|\binoltre\b|;/i.test(t)) {
    const chunks = t
      .split(/\be\s+anche\b|\band\s+also\b|\binoltre\b|;/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 16)
    for (const c of chunks.slice(0, 4)) parts.push(c)
  }

  // Intent-shaped default decomposition
  if (parts.length === 0) {
    const intent = understanding?.primaryIntent || ''
    switch (intent) {
      case 'comparison':
      case 'advice':
        parts.push('Chiarire criteri di decisione rilevanti')
        parts.push('Valutare le opzioni principali')
        parts.push('Raccomandazione e trade-off')
        break
      case 'how_to':
      case 'problem_solving':
        parts.push('Definire lo stato attuale / vincoli')
        parts.push('Individuare i passi o la causa')
        parts.push('Soluzione attuabile e controllo')
        break
      case 'creation':
        parts.push('Requisiti del pezzo richiesto')
        parts.push('Bozza / struttura')
        parts.push('Rifinitura utilizzabile')
        break
      case 'explanation':
        parts.push('Idea centrale')
        parts.push('Meccanismo / perché')
        parts.push('Esempio o implicazione pratica')
        break
      default:
        parts.push('Inquadrare il problema centrale')
        parts.push('Affrontare i sotto-punti essenziali')
        parts.push('Sintesi utile all’obiettivo')
    }
  }

  // Always anchor to real goal as last verification frame (not a user-facing part)
  if (realGoal && parts.length < 5) {
    // keep parts as work units only
  }

  return parts.slice(0, 5)
}

/**
 * Core problem one-liner.
 * @param {string} realGoal
 * @param {string} surfaceAsk
 */
export function identifyCoreProblem(realGoal, surfaceAsk) {
  const goal = String(realGoal || '').trim()
  if (goal) return goal
  const surface = String(surfaceAsk || '').trim()
  if (surface.length <= 120) return surface
  return `${surface.slice(0, 117)}…`
}

/**
 * Build progressive reasoning plan (or skip for simple asks).
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {string} [input.realGoal]
 * @param {string} [input.surfaceAsk]
 * @param {{ complexity?: string, primaryIntent?: string, secondaryRequests?: string[], urgency?: string } | null} [input.understanding]
 * @param {{ complexity?: string } | null} [input.taskPlan]
 * @returns {ProgressivePlan}
 */
export function buildProgressivePlan(input) {
  const level = decideProgressiveLevel(input)
  if (level === 'skip') {
    return {
      enabled: false,
      level: 'skip',
      coreProblem: '',
      parts: [],
      structureHints: [],
      writerBrief:
        'Domanda semplice: rispondi in modo diretto e veloce. Niente scomposizione progressiva.',
    }
  }

  const realGoal = String(input?.realGoal || '').trim()
  const surfaceAsk = String(input?.surfaceAsk || input?.userMessage || '').trim()
  const coreProblem = identifyCoreProblem(realGoal, surfaceAsk)
  const parts = breakIntoParts(String(input?.userMessage || ''), realGoal, input?.understanding)

  /** @type {string[]} */
  const structureHints = [
    'Ragionamento progressivo (invisibile): non stampare questi passi',
    `Problema centrale: ${coreProblem}`,
    ...parts.map((p, i) => `Parte ${i + 1}: risolvi — ${p}`),
    'Ricombina le parti in una risposta unica e coerente',
    'Verifica coerenza interna (niente contraddizioni tra parti)',
    'Poi scrivi SOLO la risposta finale all’utente',
  ]

  if (level === 'light') {
    structureHints.splice(
      1,
      0,
      'Livello light: scomponi mentalmente ma tieni la risposta snella',
    )
  } else {
    structureHints.splice(
      1,
      0,
      'Livello full: ragiona a fondo sulle parti prima di concludere',
    )
  }

  const writerBrief = [
    'Progressive Reasoning attivo (invisibile).',
    'Non rispondere di getto: 1) problema centrale 2) parti 3) risolvi 4) ricombina 5) verifica 6) risposta finale.',
    'Non mostrare la scomposizione come checklist all’utente.',
    `Livello: ${level}. Ottimizza qualità senza diventare un muro di testo.`,
    `Problema centrale: ${coreProblem}.`,
  ].join(' ')

  return {
    enabled: true,
    level,
    coreProblem,
    parts,
    structureHints,
    writerBrief,
  }
}

/**
 * Format progressive plan for Writer handoff.
 * @param {ProgressivePlan} plan
 */
export function formatProgressivePlanForWriter(plan) {
  if (!plan || !plan.enabled) return ''

  const parts =
    plan.parts.length > 0
      ? plan.parts.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '1. Affronta i sotto-punti essenziali'

  const hints = plan.structureHints.map((h, i) => `${i + 1}. ${h}`).join('\n')

  return `══════════════════════════════════════
PROGRESSIVE REASONING → WRITER (INVISIBILE)
══════════════════════════════════════
Domanda difficile: ragiona in modo progressivo PRIMA di scrivere.
NON mostrare questo processo. NON elencare le fasi all’utente.
Alla fine invia solo la risposta finale, chiara e utile.

${plan.writerBrief}

Problema centrale:
${plan.coreProblem}

Parti da risolvere:
${parts}

Pipeline interna (segui, non stampare):
${hints}`
}
