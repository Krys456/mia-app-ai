/**
 * LAIfe Hierarchical Information Prioritization
 *
 * When multiple information sources are available, decide what deserves
 * attention first. Invisible to the user — Writer-only guidance.
 *
 * Priority (highest → lowest):
 * 1. Direct user request
 * 2. Safety and correctness
 * 3. Current conversation
 * 4. Relevant long-term memories
 * 5. External knowledge
 * 6. Style improvements
 *
 * Never sacrifice correctness for style.
 * Never overload responses with unnecessary details.
 */

/** @typedef {import('./orchestrator.js').ToolResult} ToolResult */
/** @typedef {import('./orchestrator.js').ToolId} ToolId */

export const INFO_PRIORITY_LEVELS = /** @type {const} */ ([
  {
    rank: 1,
    id: 'direct_request',
    label: 'Richiesta diretta dell’utente',
    rule: 'Rispondi prima e soprattutto a ciò che l’utente ha chiesto ora.',
  },
  {
    rank: 2,
    id: 'safety_correctness',
    label: 'Sicurezza e correttezza',
    rule: 'Fatti corretti, limiti dichiarati, niente invenzioni. La correttezza batte sempre lo stile.',
  },
  {
    rank: 3,
    id: 'current_conversation',
    label: 'Conversazione corrente',
    rule: 'Usa il filo della chat (obiettivi, decisioni, già spiegato) prima di fonti esterne.',
  },
  {
    rank: 4,
    id: 'long_term_memory',
    label: 'Memorie a lungo termine pertinenti',
    rule: 'Integra solo memorie rilevanti; ignora il resto. Non sorprendere.',
  },
  {
    rank: 5,
    id: 'external_knowledge',
    label: 'Conoscenza esterna',
    rule: 'Web / strumenti esterni solo se servono alla richiesta; non diluire la risposta.',
  },
  {
    rank: 6,
    id: 'style',
    label: 'Miglioramenti di stile',
    rule: 'Ritmo, tono, eleganza: solo dopo che contenuto e correttezza sono a posto. Mai a spese della verità.',
  },
])

/**
 * Tool → priority tier (lower rank = higher priority when presenting to Writer).
 * @type {Record<string, number>}
 */
const TOOL_PRIORITY_RANK = {
  // Attachments / direct ask about media
  vision: 1,
  document: 1,
  // Correctness aids
  calculator: 2,
  // Long-term memory
  memory: 4,
  // External / ambient
  web: 5,
  weather: 5,
  calendar: 5,
  reminder: 5,
}

/**
 * Sort tool results by hierarchical priority (stable within same rank).
 * @param {ToolResult[]} results
 * @returns {ToolResult[]}
 */
export function prioritizeToolResults(results) {
  if (!Array.isArray(results) || results.length === 0) return []
  return [...results].sort((a, b) => {
    const ra = TOOL_PRIORITY_RANK[a.tool] ?? 5
    const rb = TOOL_PRIORITY_RANK[b.tool] ?? 5
    if (ra !== rb) return ra - rb
    // Prefer ok over empty/error when same tier
    const statusScore = (s) => (s === 'ok' ? 0 : s === 'empty' ? 1 : 2)
    return statusScore(a.status) - statusScore(b.status)
  })
}

/**
 * Drop low-value external noise when the direct ask is already covered
 * and keepFast / no freshness — soft filter, fail-soft.
 *
 * @param {ToolResult[]} results
 * @param {{ keepExternal?: boolean }} [opts]
 * @returns {ToolResult[]}
 */
export function filterToolResultsByPriority(results, opts = {}) {
  const ordered = prioritizeToolResults(results)
  if (opts.keepExternal !== false) return ordered

  // When external knowledge is deprioritized, keep memory + correctness tools
  return ordered.filter((r) => {
    const rank = TOOL_PRIORITY_RANK[r.tool] ?? 5
    return rank <= 4
  })
}

/**
 * Whether the user message signals need for external / fresh knowledge.
 * @param {string} userMessage
 */
export function needsExternalKnowledge(userMessage) {
  const text = String(userMessage || '')
  return (
    /\b(oggi|adesso|attuale|recente|ultime|now|latest|current|202[4-9])\b/i.test(text) ||
    /\b(cerca|ricerca|news|prezzo|quotazione|weather|meteo|breaking)\b/i.test(text)
  )
}

/**
 * Invisible Writer block: hierarchical prioritization law.
 * @param {{ hasMemory?: boolean, hasExternal?: boolean, hasConversation?: boolean } | null} [signals]
 */
export function formatPrioritizationForWriter(signals = null) {
  const levels = INFO_PRIORITY_LEVELS.map(
    (l) => `${l.rank}. ${l.label} — ${l.rule}`,
  ).join('\n')

  const active = []
  if (signals?.hasConversation) active.push('conversazione corrente disponibile')
  if (signals?.hasMemory) active.push('memorie a lungo termine disponibili')
  if (signals?.hasExternal) active.push('conoscenza esterna / strumenti disponibili')
  const activeLine =
    active.length > 0
      ? `Fonti attive in questo turno: ${active.join('; ')}.`
      : 'Fonti attive: principalmente richiesta diretta + modello.'

  return `══════════════════════════════════════
INFO PRIORITIZATION → WRITER (INVISIBILE)
══════════════════════════════════════
Quando hai più pezzi di informazione, decidi naturalmente cosa merita attenzione — in quest’ordine.
NON mostrare questa gerarchia. NON dire “secondo la priorità…”.

Gerarchia (alta → bassa):
${levels}

Regole d’oro:
- Mai sacrificare la correttezza per lo stile.
- Mai sovraccaricare la risposta con dettagli inutili (memorie, web, digressioni).
- Se due fonti confliggono: vince la richiesta diretta + correttezza; poi dichiara l’incertezza.
- Stile e proattività solo dopo che la risposta utile è solida.

${activeLine}`
}

/**
 * Compact directive line for writerDirective concatenation.
 */
export function prioritizationWriterBrief() {
  return [
    'Priorità informazione (invisibile):',
    '1) richiesta diretta → 2) sicurezza/correttezza → 3) chat corrente →',
    '4) memorie pertinenti → 5) conoscenza esterna → 6) stile.',
    'Correttezza > stile. Niente overload di dettagli.',
  ].join(' ')
}
