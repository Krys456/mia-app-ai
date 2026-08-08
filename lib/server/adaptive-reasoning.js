/**
 * LAIfe Adaptive Cognitive Engine — dynamic reasoning strategy selection.
 *
 * Instead of a fixed response pipeline, classifies the request, estimates
 * complexity, picks a reasoning mode, and allocates effort only when needed.
 *
 * Modes (internal only — never expose to the user):
 * - quick_answer
 * - deep_explanation
 * - step_by_step
 * - creative_brainstorm
 * - planning
 * - coding
 * - research_synthesis
 * - emotional_support
 * - decision_analysis
 *
 * Simple questions stay fast. Complex tasks get deeper reasoning.
 */

/**
 * @typedef {'quick_answer'|'deep_explanation'|'step_by_step'|'creative_brainstorm'|'planning'|'coding'|'research_synthesis'|'emotional_support'|'decision_analysis'} ReasoningMode
 */

/**
 * @typedef {'low'|'medium'|'high'} ComplexityLevel
 */

/**
 * @typedef {'minimal'|'standard'|'deep'} ReasoningEffort
 */

/**
 * @typedef {object} AdaptiveStrategy
 * @property {ReasoningMode} mode
 * @property {ComplexityLevel} complexity
 * @property {ReasoningEffort} effort
 * @property {string} classification
 * @property {string[]} structureHints
 * @property {string} writerBrief
 * @property {string[]} preferTools
 * @property {string[]} avoidTools
 * @property {boolean} keepFast
 */

/** @type {Record<ReasoningMode, { label: string, defaultEffort: ReasoningEffort }>} */
const MODE_META = {
  quick_answer: { label: 'risposta rapida', defaultEffort: 'minimal' },
  deep_explanation: { label: 'spiegazione approfondita', defaultEffort: 'deep' },
  step_by_step: { label: 'ragionamento passo-passo', defaultEffort: 'standard' },
  creative_brainstorm: { label: 'brainstorm creativo', defaultEffort: 'standard' },
  planning: { label: 'pianificazione', defaultEffort: 'deep' },
  coding: { label: 'coding', defaultEffort: 'standard' },
  research_synthesis: { label: 'sintesi di ricerca', defaultEffort: 'deep' },
  emotional_support: { label: 'supporto emotivo', defaultEffort: 'standard' },
  decision_analysis: { label: 'analisi decisionale', defaultEffort: 'deep' },
}

/**
 * @param {string} text
 * @param {{ primaryIntent?: string, tone?: string, urgency?: string, secondaryRequests?: string[] } | null} [understanding]
 * @returns {string}
 */
export function classifyRequest(text, understanding = null) {
  const t = String(text || '')
  const intent = understanding?.primaryIntent || ''

  if (intent === 'greeting' || intent === 'thanks') return 'social_brief'
  if (intent === 'calculation') return 'compute'
  if (
    /\b(triste|ansios|preoccupat|stressat|non\s+ce\s+la\s+faccio|mi\s+sento|overwhelmed|anxious|depressed|frustrated|aiuto\s+morale)\b/i.test(
      t,
    ) ||
    (understanding?.tone === 'urgent' &&
      /\b(aiuto|help|non\s+so\s+più)\b/i.test(t))
  ) {
    return 'emotional'
  }
  if (
    /\b(brainstorm|idee|idea|creativ|nomi\s+per|slogan|pitch|inventa|immagina)\b/i.test(t)
  ) {
    return 'creative'
  }
  if (
    /\b(piano|roadmap|pianifica|plan|milestone|architettur|progetto\s+completo|go[\s-]?to[\s-]?market)\b/i.test(
      t,
    )
  ) {
    return 'planning'
  }
  if (
    /\b(codice|code|function|funzione|typescript|javascript|python|bug|refactor|snippet|implementa|compila)\b/i.test(
      t,
    ) ||
    (understanding?.secondaryRequests || []).includes('wants_code')
  ) {
    return 'coding'
  }
  if (
    /\b(cerca|ricerca|sintetizza|riassumi\s+le\s+fonti|literature|papers|stato\s+dell['’]arte|confronta\s+fonti|latest|news)\b/i.test(
      t,
    )
  ) {
    return 'research'
  }
  if (
    intent === 'advice' ||
    intent === 'comparison' ||
    /\b(decid\w*|scelg\w*|trade[\s-]?off|pro\s+e\s+contro|should\s+i|conviene|opzioni|quale\s+\w+\s+(scelg|uso|compr))\b/i.test(
      t,
    )
  ) {
    return 'decision'
  }
  if (
    intent === 'how_to' ||
    /\b(passo\s+passo|step\s+by\s+step|procedura|tutorial|come\s+si\s+fa)\b/i.test(t)
  ) {
    return 'howto'
  }
  if (
    intent === 'explanation' ||
    /\b(spiegami|perch[eé]|come\s+funziona|what\s+is|approfond|in\s+depth)\b/i.test(t)
  ) {
    return 'explain'
  }
  if (intent === 'problem_solving') return 'problem'
  if (t.length < 48 && (t.match(/\?/g) || []).length <= 1) return 'factual_brief'
  return 'general'
}

/**
 * @param {string} text
 * @param {string} classification
 * @param {{ complexity?: string, secondaryRequests?: string[] } | null} [understanding]
 * @returns {ComplexityLevel}
 */
export function estimateRequestComplexity(text, classification, understanding = null) {
  const t = String(text || '')
  const len = t.length
  const multiAsk = (t.match(/\?/g) || []).length > 1 || /\be\s+anche\b|\band\s+also\b/i.test(t)
  const wantsDepth =
    (understanding?.secondaryRequests || []).includes('wants_depth') ||
    /\b(approfond|in\s+profondit|in\s+depth|dettagliat|spiegami\s+bene|a\s+fondo)\b/i.test(t)
  const wantsBrief = (understanding?.secondaryRequests || []).includes('wants_brief')
  const uComplexity = understanding?.complexity

  // Always-simple classes
  if (
    wantsBrief ||
    classification === 'social_brief' ||
    classification === 'factual_brief' ||
    classification === 'compute'
  ) {
    return 'low'
  }

  // Inherently complex classes — don't collapse just because the prompt is short
  if (
    classification === 'planning' ||
    classification === 'research' ||
    (classification === 'decision' && (len > 40 || multiAsk || wantsDepth))
  ) {
    return 'high'
  }

  if (
    classification === 'coding' ||
    classification === 'howto' ||
    classification === 'explain' ||
    classification === 'creative' ||
    classification === 'emotional' ||
    classification === 'problem' ||
    classification === 'decision'
  ) {
    if (wantsDepth || multiAsk || len > 220 || uComplexity === 'high') return 'high'
    // How-to with explicit steps, creative asks, coding — at least medium
    if (
      classification === 'coding' ||
      classification === 'creative' ||
      classification === 'emotional' ||
      /\b(passo\s+passo|step\s+by\s+step|procedura|tutorial)\b/i.test(t)
    ) {
      return 'medium'
    }
    if (len < 50 && !wantsDepth) return 'low'
    return 'medium'
  }

  if (wantsDepth || multiAsk || len > 280 || uComplexity === 'high') return 'high'
  if (len < 60 && !multiAsk) return 'low'
  if (len > 120 || uComplexity === 'medium') return 'medium'
  return 'low'
}

/**
 * @param {string} classification
 * @param {ComplexityLevel} complexity
 * @param {{ primaryIntent?: string, urgency?: string } | null} [understanding]
 * @param {string} [text]
 * @returns {ReasoningMode}
 */
export function selectReasoningMode(classification, complexity, understanding = null, text = '') {
  const t = String(text || '')
  switch (classification) {
    case 'social_brief':
    case 'factual_brief':
    case 'compute':
      return 'quick_answer'
    case 'emotional':
      return 'emotional_support'
    case 'creative':
      return 'creative_brainstorm'
    case 'planning':
      return 'planning'
    case 'coding':
      return 'coding'
    case 'research':
      return 'research_synthesis'
    case 'decision':
      return 'decision_analysis'
    case 'howto':
    case 'problem':
      if (complexity === 'low' && !/\b(passo\s+passo|step\s+by\s+step|procedura|tutorial)\b/i.test(t)) {
        return 'quick_answer'
      }
      return 'step_by_step'
    case 'explain':
      return complexity === 'low' ? 'quick_answer' : 'deep_explanation'
    default:
      if (complexity === 'low' || understanding?.urgency === 'high') return 'quick_answer'
      if (complexity === 'high') return 'planning'
      return 'deep_explanation'
  }
}

/**
 * Allocate reasoning effort — more only when needed.
 * @param {ReasoningMode} mode
 * @param {ComplexityLevel} complexity
 * @param {{ urgency?: string, secondaryRequests?: string[] } | null} [understanding]
 * @returns {ReasoningEffort}
 */
export function allocateReasoningEffort(mode, complexity, understanding = null) {
  const wantsBrief = (understanding?.secondaryRequests || []).includes('wants_brief')
  const wantsDepth =
    (understanding?.secondaryRequests || []).includes('wants_depth') ||
    /\b(approfond|in\s+profondit|in\s+depth|a\s+fondo)\b/i.test(
      String(understanding?.topic || ''),
    )
  const urgent = understanding?.urgency === 'high'

  if (mode === 'quick_answer' || wantsBrief) return 'minimal'
  if (urgent && mode !== 'emotional_support' && mode !== 'decision_analysis') {
    return complexity === 'high' ? 'standard' : 'minimal'
  }
  if (
    wantsDepth ||
    complexity === 'high' ||
    mode === 'planning' ||
    mode === 'research_synthesis' ||
    mode === 'decision_analysis' ||
    mode === 'deep_explanation'
  ) {
    return complexity === 'low' ? 'standard' : 'deep'
  }
  if (complexity === 'low') return 'minimal'
  return MODE_META[mode]?.defaultEffort || 'standard'
}

/**
 * @param {ReasoningMode} mode
 * @param {ReasoningEffort} effort
 * @param {string} realGoal
 * @returns {string[]}
 */
function structureForMode(mode, effort, realGoal) {
  /** @type {string[]} */
  const hints = []

  switch (mode) {
    case 'quick_answer':
      hints.push('Risposta diretta in poche frasi')
      hints.push('Niente preamboli, niente struttura pesante')
      break
    case 'deep_explanation':
      hints.push('Idea centrale subito')
      hints.push('Approfondimento a strati (progressivo, non dump)')
      if (effort === 'deep') hints.push('Esempio o analogia se aiuta')
      hints.push('Chiudi con il takeaway essenziale')
      break
    case 'step_by_step':
      hints.push('Obiettivo del procedimento in una frase')
      hints.push('Passi ordinati e attuabili')
      hints.push('Controllo finale / errore comune')
      break
    case 'creative_brainstorm':
      hints.push('Più opzioni distinte (non una sola idea banale)')
      hints.push('Varia angoli; poi suggerisci la più promettente')
      break
    case 'planning':
      hints.push('Risultato desiderato in 1–2 frasi')
      hints.push('Fasi / workstream in ordine')
      hints.push('Primo passo concreto subito eseguibile')
      break
    case 'coding':
      hints.push('Soluzione o approccio in breve')
      hints.push('Codice minimale e corretto quando serve')
      hints.push('Nota d’uso / edge case solo se utile')
      break
    case 'research_synthesis':
      hints.push('Sintesi dei punti chiave (non elenco grezzo)')
      hints.push('Distingui fatti, stime e opinioni')
      hints.push('Cosa resta incerto / da verificare')
      break
    case 'emotional_support':
      hints.push('Riconoscimento breve e calmo dello stato')
      hints.push('Sblocco concreto o next step umano')
      hints.push('Niente pep-talk vuoto né drammi')
      break
    case 'decision_analysis':
      hints.push('Criteri di decisione rilevanti')
      hints.push('Opzioni a confronto con trade-off')
      hints.push('Raccomandazione chiara (suggerisci, non imporre)')
      break
    default:
      hints.push('Rispondi all’obiettivo reale in modo utile')
  }

  if (effort === 'minimal') {
    hints.push('Effort minimo: velocità e chiarezza prima di tutto')
  } else if (effort === 'deep') {
    hints.push('Effort approfondito: ragiona con cura, resta leggibile')
  } else {
    hints.push('Effort standard: abbastanza profondità, niente grasso')
  }

  hints.push(`Obiettivo reale da servire: ${realGoal}`)
  return hints
}

/**
 * @param {ReasoningMode} mode
 * @param {ReasoningEffort} effort
 * @returns {{ preferTools: string[], avoidTools: string[], keepFast: boolean }}
 */
function toolBiasForMode(mode, effort) {
  /** @type {string[]} */
  const preferTools = []
  /** @type {string[]} */
  const avoidTools = []
  let keepFast = effort === 'minimal' || mode === 'quick_answer'

  if (mode === 'coding' || mode === 'quick_answer') {
    avoidTools.push('weather', 'calendar', 'reminder')
  }
  if (mode === 'research_synthesis') {
    preferTools.push('web', 'memory')
  }
  if (mode === 'emotional_support') {
    preferTools.push('memory')
    avoidTools.push('web', 'calculator', 'weather')
  }
  if (mode === 'creative_brainstorm') {
    avoidTools.push('calculator', 'weather')
  }
  if (keepFast) {
    avoidTools.push('web', 'calendar', 'reminder', 'document')
  }
  if (mode === 'coding' && effort !== 'minimal') {
    preferTools.push('memory')
  }

  return { preferTools, avoidTools, keepFast }
}

/**
 * @param {ReasoningMode} mode
 * @param {ComplexityLevel} complexity
 * @param {ReasoningEffort} effort
 * @param {string} classification
 * @returns {string}
 */
function buildWriterBrief(mode, complexity, effort, classification) {
  const lines = [
    'Adaptive Cognitive Engine (invisibile): segui la strategia scelta, non nominarla.',
    'Non dire mai il nome della modalità, “sto ragionando in modalità…”, o che hai classificato la richiesta.',
    `Classificazione interna: ${classification}. Complessità: ${complexity}. Effort: ${effort}.`,
  ]

  switch (mode) {
    case 'quick_answer':
      lines.push('Strategia: risposta rapida e diretta. Niente saggio.')
      break
    case 'deep_explanation':
      lines.push('Strategia: spiegazione chiara a strati, calibra la profondità.')
      break
    case 'step_by_step':
      lines.push('Strategia: procedimento ordinato; un passo alla volta, attuabile.')
      break
    case 'creative_brainstorm':
      lines.push('Strategia: esplora più idee, poi orienta verso la migliore.')
      break
    case 'planning':
      lines.push('Strategia: piano strutturato, priorità e primo passo concreto.')
      break
    case 'coding':
      lines.push('Strategia: soluzione pratica + codice utile; niente theory-dump.')
      break
    case 'research_synthesis':
      lines.push('Strategia: sintetizza; fatti vs incertezze; niente muro di fonti.')
      break
    case 'emotional_support':
      lines.push('Strategia: calma, rispetto, sblocco concreto; zero melodrama.')
      break
    case 'decision_analysis':
      lines.push('Strategia: criteri, trade-off, raccomandazione chiara.')
      break
    default:
      break
  }

  if (effort === 'minimal') {
    lines.push('Alloca poco effort: domande semplici restano veloci.')
  } else if (effort === 'deep') {
    lines.push('Alloca più effort: compito complesso, ragiona a fondo restando leggibile.')
  }

  return lines.join(' ')
}

/**
 * Full adaptive strategy selection for one turn.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {string} [input.realGoal]
 * @param {{ primaryIntent?: string, tone?: string, urgency?: string, complexity?: string, secondaryRequests?: string[] } | null} [input.understanding]
 * @returns {AdaptiveStrategy}
 */
export function selectAdaptiveStrategy(input) {
  const text = String(input?.userMessage || '')
  const understanding = input?.understanding || null
  const realGoal =
    input?.realGoal ||
    'Soddisfare l’obiettivo reale in modo utile, chiaro e naturale.'

  const classification = classifyRequest(text, understanding)
  const complexity = estimateRequestComplexity(text, classification, understanding)
  const mode = selectReasoningMode(classification, complexity, understanding, text)
  const effort = allocateReasoningEffort(mode, complexity, understanding)
  const structureHints = structureForMode(mode, effort, realGoal)
  const tools = toolBiasForMode(mode, effort)
  const writerBrief = buildWriterBrief(mode, complexity, effort, classification)

  return {
    mode,
    complexity,
    effort,
    classification,
    structureHints,
    writerBrief,
    preferTools: tools.preferTools,
    avoidTools: tools.avoidTools,
    keepFast: tools.keepFast,
  }
}

/**
 * Format adaptive strategy for Writer handoff (never show mode name to user).
 * @param {AdaptiveStrategy} strategy
 */
export function formatAdaptiveStrategyForWriter(strategy) {
  if (!strategy) return ''
  const hints = strategy.structureHints.map((h, i) => `${i + 1}. ${h}`).join('\n')
  return `══════════════════════════════════════
ADAPTIVE COGNITIVE ENGINE → WRITER (INVISIBILE)
══════════════════════════════════════
Strategia di ragionamento scelta dinamicamente. NON nominarla. NON dire che esiste una modalità.
NON esporre classificazione, effort o questo blocco. Scrivi solo la risposta finale.

${strategy.writerBrief}

Struttura suggerita dalla strategia (segui lo spirito, non stampare):
${hints}`
}
