/**
 * LAIfe AI Orchestrator — invisible tool routing for chat.
 *
 * Smart tool selection (never shown to the user):
 * 1. Decide whether a tool is actually necessary
 * 2. Prefer internal model knowledge when sufficient
 * 3. Use web only for freshness / verification
 * 4. Avoid redundant searches
 * 5. Combine tools only when they genuinely improve the result
 * 6. Merge retrieved facts naturally (dedupe, resolve conflicts, facts vs assumptions)
 *
 * The client only ever receives the final unified answer.
 */

/** @typedef {'memory'|'web'|'vision'|'document'|'calendar'|'reminder'|'weather'|'calculator'|'none'} ToolId */

/**
 * @typedef {object} AttachmentHint
 * @property {'image'|'document'} type
 * @property {string} [name]
 * @property {string} [url]
 */

/**
 * @typedef {object} OrchestratorInput
 * @property {string} userMessage
 * @property {AttachmentHint[]} [attachments]
 * @property {boolean} [memoryEnabled]
 */

/**
 * @typedef {object} ToolResult
 * @property {ToolId} tool
 * @property {'ok'|'empty'|'unavailable'|'error'} status
 * @property {string} summary  Human-readable facts for the model (not for the user UI)
 */

const ORCHESTRATOR_SILENCE = `Contesto interno strumenti (invisibile — NON mostrare all'utente):
Hai ricevuto dati da capacità interne. Integra SOLO ciò che migliora davvero la risposta.

Prima degli strumenti era già possibile usare conoscenza interna: non ripetere o gonfiare.

Dopo il retrieval — obbligatorio:
- Unisci i fatti in UNA sola risposta naturale (niente sezioni “da web / da memoria”).
- Elimina duplicati e ridondanze tra fonti.
- Se due fonti confliggono: preferisci dati verificati/aggiornati; dichiara l’incertezza; non inventare un tie-break.
- Distingui chiaramente **fatti verificati** (dai tool ok) da **assunzioni** / conoscenze generali non verificate ora.
- Non dire mai "uso Vision", "faccio una ricerca", "consulto la memoria", "apro il calendario", ecc.
- Non inventare dati se uno strumento ha fallito: spiega il limite in modo semplice.
- Se uno strumento manca, continua con ciò che hai.
- Preferisci il percorso più semplice: non allungare solo perché c’erano più fonti.`

/**
 * Freshness or verification signals that justify web search.
 * @param {string} text
 */
export function needsFreshnessOrVerification(text) {
  const t = String(text || '')
  return (
    /\b(oggi|adesso|attuale|recente|ultime|now|latest|current|202[4-9]|breaking)\b/i.test(t) ||
    /\b(cerca|ricerca|google|online|su\s+internet|verifica|verify|fact[\s-]?check|look\s+up|search)\b/i.test(
      t,
    ) ||
    /\b(ultime\s+notizie|news|prezzo\s+(attual|corrent)|quotazione|current\s+price|who\s+won)\b/i.test(
      t,
    ) ||
    /\b(chi\s+è|cos['']è|what\s+is|who\s+is)\b.{0,60}\b(oggi|adesso|attuale|recente|202[4-9])\b/i.test(
      t,
    )
  )
}

/**
 * Personal recall cues that justify memory tool.
 * @param {string} text
 */
export function needsPersonalMemory(text) {
  const t = String(text || '')
  return (
    /\b(ricord[io]|preferisc[oi]|mi\s+piace|odio|la\s+mia|il\s+mio|i\s+miei|le\s+mie|ho\s+detto|ti\s+avevo|my\s+name|i\s+prefer|remember\s+that)\b/i.test(
      t,
    ) ||
    /\b(come\s+mi\s+chiamo|qual['']è\s+il\s+mio|sai\s+già|dalla\s+memoria)\b/i.test(t)
  )
}

/**
 * Questions answerable from stable internal knowledge (no tool needed).
 * @param {string} text
 */
export function prefersInternalKnowledge(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (needsFreshnessOrVerification(t) || needsPersonalMemory(t)) return false
  // Conceptual / how-to / coding without live data
  if (
    /\b(spiegami|cos['']è|what\s+is|how\s+does|come\s+funziona|perch[eé]|differenza\s+tra|esempio\s+di|write|scrivi|codice|function)\b/i.test(
      t,
    )
  ) {
    return true
  }
  // Short factual without freshness markers
  if (t.length < 80 && t.includes('?') && !/\b(oggi|prezzo|news|meteo)\b/i.test(t)) {
    return true
  }
  return false
}

/**
 * Refine a candidate tool set: necessity, anti-redundancy, prefer internal knowledge.
 *
 * @param {ToolId[]} candidates
 * @param {OrchestratorInput} input
 * @returns {ToolId[]}
 */
export function refineToolSelection(candidates, input) {
  const text = String(input?.userMessage || '').trim()
  let tools = Array.isArray(candidates) ? [...candidates] : []

  if (!text && !(input?.attachments || []).length) return []

  // Greetings / thanks / acks → no tools
  if (
    /^(ciao|hey|hola|hi|hello|salve|buongiorno|buonasera|thanks|grazie|ok|okay|va\s+bene|perfetto|capito)[\s!.?]*$/i.test(
      text,
    )
  ) {
    return []
  }

  const freshness = needsFreshnessOrVerification(text)
  const personal = needsPersonalMemory(text)
  const internalOk = prefersInternalKnowledge(text)

  // Prefer internal knowledge: drop speculative memory/web when not needed
  if (internalOk) {
    tools = tools.filter((t) => t !== 'web' && t !== 'memory')
  }

  // Web only for freshness / verification
  if (tools.includes('web') && !freshness) {
    tools = tools.filter((t) => t !== 'web')
  }

  // Memory only when personal (or soft cue already gated upstream)
  if (tools.includes('memory') && !personal && internalOk) {
    tools = tools.filter((t) => t !== 'memory')
  }

  // Avoid redundant searches: weather covers meteo — drop web only if no separate news/lookup ask
  if (tools.includes('weather') && tools.includes('web')) {
    const alsoNews =
      /\b(news|notiz|cerca|ricerca|verifica|prezzo|quotazione|breaking)\b/i.test(text) &&
      !/\b(solo\s+il\s+meteo|just\s+the\s+weather)\b/i.test(text)
    const weatherDominant =
      /\b(meteo|temperatura|previsioni|weather|forecast|che\s+tempo)\b/i.test(text) && !alsoNews
    if (weatherDominant) {
      tools = tools.filter((t) => t !== 'web')
    }
  }

  // Pure calculator → calculator alone (no memory/web noise)
  if (tools.includes('calculator')) {
    const calcOnly =
      /\b(calcola|calcolo|quanto\s+(fa|è|viene)|compute|calculate)\b/i.test(text) ||
      /(?:^|[^\w])\d+(?:[.,]\d+)?\s*[\+\-\*\/×÷%^]\s*\d/.test(text)
    if (calcOnly && !personal && !freshness) {
      tools = tools.filter((t) => t === 'calculator')
    }
  }

  // Pure weather → weather alone unless personal
  if (tools.includes('weather') && !personal && !freshness) {
    const weatherOnly =
      /\b(meteo|temperatura|previsioni|weather|forecast)\b/i.test(text) ||
      /\bche\s+tempo\b/i.test(text)
    if (weatherOnly) {
      tools = tools.filter((t) => t === 'weather' || t === 'calculator')
    }
  }

  // Don't combine web + memory unless both genuinely needed
  if (tools.includes('web') && tools.includes('memory') && !(freshness && personal)) {
    if (freshness && !personal) tools = tools.filter((t) => t !== 'memory')
    else if (personal && !freshness) tools = tools.filter((t) => t !== 'web')
    else if (!freshness) tools = tools.filter((t) => t !== 'web')
  }

  // Cap accidental tool sprawl: max 3 tools unless attachments force more
  const hasAttach = (input?.attachments || []).some(
    (a) => a?.type === 'image' || a?.type === 'document',
  )
  if (!hasAttach && tools.length > 3) {
    const priority = ['vision', 'document', 'calculator', 'memory', 'web', 'weather', 'calendar', 'reminder']
    tools = priority.filter((id) => tools.includes(/** @type {ToolId} */ (id))).slice(0, 3)
  }

  return tools
}

/**
 * Fast heuristic planner — no extra model round-trip.
 * Returns ordered tool ids (excluding 'none'). Empty → answer with the model alone.
 *
 * @param {OrchestratorInput} input
 * @returns {ToolId[]}
 */
export function planTools(input) {
  const text = String(input?.userMessage || '').trim()
  const attachments = Array.isArray(input?.attachments) ? input.attachments : []
  const memoryEnabled = input?.memoryEnabled !== false

  if (!text && attachments.length === 0) return []

  /** @type {Set<ToolId>} */
  const selected = new Set()

  const hasImage = attachments.some((a) => a?.type === 'image')
  const hasDocument = attachments.some((a) => a?.type === 'document')

  // Attachments force the matching capability.
  if (hasImage) selected.add('vision')
  if (hasDocument) selected.add('document')

  // Explicit vision / document intent without attachment → still select (tool will soft-fail).
  if (
    !hasImage &&
    /\b(analizza|descrivi|guarda|leggi)\b.{0,40}\b(immagin[ei]|foto|screenshot|picture|image|photo)\b|\b(immagin[ei]|foto)\s+(allegat|inviata|qui)\b/i.test(
      text,
    )
  ) {
    selected.add('vision')
  }

  if (
    !hasDocument &&
    /\b(leggi|analizza|estra[ie]|riassumi)\b.{0,40}\b(documento|pdf|file|allegato|doc)\b|\b(documento|pdf)\s+(allegat|inviato|qui)\b/i.test(
      text,
    )
  ) {
    selected.add('document')
  }

  // Calculator — pure computation path (often alone).
  if (
    /\b(calcola|calcolo|quanto\s+(fa|è|viene)|risolv[ie]|compute|calculate)\b/i.test(text) ||
    /(?:^|[^\w])\d+(?:[.,]\d+)?\s*[\+\-\*\/×÷%^]\s*\d/.test(text) ||
    /\b\d+\s*(più|meno|per|diviso|volte)\s*\d+/i.test(text)
  ) {
    selected.add('calculator')
  }

  // Weather
  if (
    /\b(meteo|temperatura|previsioni|piove|nevica|umidità|vento)\b/i.test(text) ||
    /\b(weather|forecast|temperature|rain|snow|humidity)\b/i.test(text) ||
    /\bche\s+tempo\b/i.test(text)
  ) {
    selected.add('weather')
  }

  // Calendar
  if (
    /\b(calendario|appuntament[oi]|riunion[ei]|impegni|agenda|schedule|meeting|disponibilit[àa])\b/i.test(
      text,
    ) ||
    /\b(quando\s+ho|oggi\s+cosa\s+ho|domani\s+cosa\s+ho)\b/i.test(text)
  ) {
    selected.add('calendar')
  }

  // Reminder
  if (
    /\b(promemoria|ricordami|ricorda\s+di|reminder|remind\s+me|svegliami)\b/i.test(text)
  ) {
    selected.add('reminder')
  }

  // Web — only when freshness / verification is required (refined further below).
  if (needsFreshnessOrVerification(text)) {
    selected.add('web')
  }

  // Memory — personal facts only (not every general turn).
  const wantsPersonal = needsPersonalMemory(text)
  if (memoryEnabled && wantsPersonal) {
    selected.add('memory')
  }

  // Priority order for execution / presentation to the model.
  const order = /** @type {ToolId[]} */ ([
    'memory',
    'web',
    'vision',
    'document',
    'calendar',
    'reminder',
    'weather',
    'calculator',
  ])

  const candidates = order.filter((id) => selected.has(id))
  return refineToolSelection(candidates, input)
}

/**
 * Normalize text for near-duplicate detection.
 * @param {string} text
 */
function normalizeFactText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.=+\-]/gu, ' ')
    .trim()
}

/**
 * Remove near-duplicate tool summaries; keep higher-trust tools first.
 * @param {ToolResult[]} results
 * @returns {ToolResult[]}
 */
export function dedupeToolResults(results) {
  if (!Array.isArray(results) || results.length === 0) return []

  const trust = /** @type {ToolId[]} */ ([
    'calculator',
    'vision',
    'document',
    'weather',
    'web',
    'memory',
    'calendar',
    'reminder',
  ])
  const sorted = [...results].sort(
    (a, b) => trust.indexOf(a.tool) - trust.indexOf(b.tool),
  )

  /** @type {ToolResult[]} */
  const kept = []
  const seen = []

  for (const r of sorted) {
    const norm = normalizeFactText(r.summary)
    if (!norm) continue
    const isDup = seen.some((s) => {
      if (s === norm) return true
      if (s.length > 40 && norm.length > 40 && (s.includes(norm.slice(0, 40)) || norm.includes(s.slice(0, 40)))) {
        return true
      }
      return false
    })
    if (isDup) continue
    seen.push(norm)
    kept.push(r)
  }

  return kept
}

/**
 * Label verified vs soft tool outcomes for the Writer.
 * @param {ToolResult} r
 */
function formatToolResultLine(r) {
  if (r.status === 'ok') {
    return `[${r.tool}:verificato]\n${r.summary}`
  }
  if (r.status === 'empty') {
    return `[${r.tool}:vuoto — non inventare; usa conoscenza interna con cautela]\n${r.summary}`
  }
  return `[${r.tool}:${r.status} — non verificato; non inventare il risultato]\n${r.summary}`
}

/**
 * @param {string} expression
 * @returns {{ ok: true, value: number, expression: string } | { ok: false, error: string }}
 */
function safeCalculate(expression) {
  const raw = String(expression || '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.')
    .replace(/\bpiù\b/gi, '+')
    .replace(/\bmeno\b/gi, '-')
    .replace(/\b(per|volte)\b/gi, '*')
    .replace(/\bdiviso\b/gi, '/')

  // Extract the longest plausible arithmetic fragment.
  const match = raw.match(/[\d.]+(?:\s*[\+\-\*\/^%]\s*[\d.]+)+/)
  const expr = match ? match[0].replace(/\s+/g, '') : ''
  if (!expr || !/^[\d+\-*/.^%()]+$/.test(expr)) {
    return { ok: false, error: 'expression_not_found' }
  }

  // Very small recursive-descent / Function sandbox — digits and operators only.
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${expr});`)()
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: 'invalid_result' }
    }
    return { ok: true, value, expression: expr }
  } catch {
    return { ok: false, error: 'eval_failed' }
  }
}

/**
 * Extract a city/place hint for weather queries.
 * @param {string} text
 */
function extractPlace(text) {
  const patterns = [
    /\b(?:meteo|tempo|weather|forecast|temperatura)\s+(?:a|di|per|in|at|for)\s+([A-Za-zÀ-ÿ'’\-\s]{2,40})/i,
    /\ba\s+([A-Za-zÀ-ÿ'’\-]{2,40})\s+(?:che\s+tempo|il\s+meteo)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      return m[1].replace(/[?.!,;:]+$/g, '').trim()
    }
  }
  return ''
}

/**
 * @param {string} query
 */
async function searchWeb(query) {
  const q = query.trim().slice(0, 200)
  if (!q) return { status: /** @type {const} */ ('empty'), text: '' }

  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { status: /** @type {const} */ ('error'), text: '' }

    const data = await res.json()
    const parts = []

    if (typeof data.AbstractText === 'string' && data.AbstractText.trim()) {
      parts.push(data.AbstractText.trim())
    }
    if (typeof data.Answer === 'string' && data.Answer.trim()) {
      parts.push(data.Answer.trim())
    }
    if (typeof data.Definition === 'string' && data.Definition.trim()) {
      parts.push(data.Definition.trim())
    }

    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []
    for (const item of related.slice(0, 4)) {
      if (item && typeof item.Text === 'string' && item.Text.trim()) {
        parts.push(item.Text.trim())
      } else if (item?.Topics && Array.isArray(item.Topics)) {
        for (const sub of item.Topics.slice(0, 2)) {
          if (typeof sub?.Text === 'string' && sub.Text.trim()) {
            parts.push(sub.Text.trim())
          }
        }
      }
    }

    const text = [...new Set(parts)].slice(0, 6).join('\n')
    if (!text) return { status: /** @type {const} */ ('empty'), text: '' }
    return { status: /** @type {const} */ ('ok'), text }
  } catch {
    return { status: /** @type {const} */ ('error'), text: '' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} place
 */
async function fetchWeather(place) {
  const loc = (place || '').trim() || 'Rome'
  const path = encodeURIComponent(loc)
  const url = `https://wttr.in/${path}?format=j1`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LAIfe/1.0' },
    })
    if (!res.ok) return { status: /** @type {const} */ ('error'), text: '' }

    const data = await res.json()
    const current = data?.current_condition?.[0]
    const area = data?.nearest_area?.[0]
    const today = data?.weather?.[0]

    if (!current) return { status: /** @type {const} */ ('empty'), text: '' }

    const areaName =
      area?.areaName?.[0]?.value ||
      area?.region?.[0]?.value ||
      loc

    const desc = current.weatherDesc?.[0]?.value || ''
    const tempC = current.temp_C
    const feels = current.FeelsLikeC
    const humidity = current.humidity
    const wind = current.windspeedKmph

    const lines = [
      `Luogo: ${areaName}`,
      `Condizioni: ${desc}`,
      `Temperatura: ${tempC}°C (percepita ${feels}°C)`,
      `Umidità: ${humidity}%`,
      `Vento: ${wind} km/h`,
    ]

    if (today?.maxtempC && today?.mintempC) {
      lines.push(`Oggi: min ${today.mintempC}°C / max ${today.maxtempC}°C`)
    }

    return { status: /** @type {const} */ ('ok'), text: lines.join('\n') }
  } catch {
    return { status: /** @type {const} */ ('error'), text: '' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} userMessage
 * @returns {Promise<ToolResult>}
 */
async function runMemoryTool(userMessage) {
  try {
    const { searchMemories } = await import('./brain-memory.js')
    const memories = await searchMemories(userMessage, { limit: 3 })

    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        tool: 'memory',
        status: 'empty',
        summary: 'Nessuna memoria pertinente trovata.',
      }
    }

    const lines = memories
      .map((memory) => {
        const title = typeof memory.title === 'string' ? memory.title.trim() : ''
        const content = typeof memory.content === 'string' ? memory.content.trim() : ''
        if (!title && !content) return null
        if (!title) return `- ${content}`
        if (!content) return `- ${title}`
        return `- ${title}: ${content}`
      })
      .filter(Boolean)

    if (lines.length === 0) {
      return {
        tool: 'memory',
        status: 'empty',
        summary: 'Nessuna memoria pertinente trovata.',
      }
    }

    return {
      tool: 'memory',
      status: 'ok',
      summary: `Memorie più rilevanti per questo turno (max ${lines.length}; integra solo se utili; non dire che "ricordi" o "dalla memoria"; non inventare; ignora il resto della vita dell'utente):\n${lines.join('\n')}`,
    }
  } catch {
    return {
      tool: 'memory',
      status: 'error',
      summary: 'Memoria temporaneamente non disponibile. Continua senza.',
    }
  }
}

/**
 * @param {ToolId} tool
 * @param {OrchestratorInput} input
 * @returns {Promise<ToolResult>}
 */
async function executeTool(tool, input) {
  const text = String(input.userMessage || '')

  switch (tool) {
    case 'memory':
      return runMemoryTool(text)

    case 'calculator': {
      const result = safeCalculate(text)
      if (!result.ok) {
        return {
          tool: 'calculator',
          status: 'empty',
          summary: 'Nessuna espressione calcolabile trovata nel messaggio.',
        }
      }
      return {
        tool: 'calculator',
        status: 'ok',
        summary: `Risultato calcolo: ${result.expression} = ${result.value}`,
      }
    }

    case 'weather': {
      const place = extractPlace(text)
      const weather = await fetchWeather(place)
      if (weather.status === 'ok') {
        return { tool: 'weather', status: 'ok', summary: `Meteo attuale:\n${weather.text}` }
      }
      return {
        tool: 'weather',
        status: weather.status === 'empty' ? 'empty' : 'error',
        summary:
          'Meteo non disponibile al momento. Spiega in modo semplice che non hai i dati aggiornati e suggerisci di riprovare.',
      }
    }

    case 'web': {
      const web = await searchWeb(text)
      if (web.status === 'ok') {
        return {
          tool: 'web',
          status: 'ok',
          summary: `Informazioni da ricerca (integra naturalmente, non dire che hai cercato):\n${web.text}`,
        }
      }
      return {
        tool: 'web',
        status: web.status === 'empty' ? 'empty' : 'error',
        summary:
          'Ricerca non ha prodotto risultati affidabili. Rispondi con ciò che sai e, se serve, dì in modo semplice che non hai dati aggiornati.',
      }
    }

    case 'vision': {
      const hasImage = (input.attachments || []).some((a) => a?.type === 'image')
      if (!hasImage) {
        return {
          tool: 'vision',
          status: 'unavailable',
          summary:
            "L'utente sembra voler analizzare un'immagine ma non ce n'è una allegata in questa chat. Chiedi gentilmente di allegarla (o usare Vision), senza gergo tecnico.",
        }
      }
      return {
        tool: 'vision',
        status: 'unavailable',
        summary:
          "Analisi immagini non ancora collegata a questa conversazione. Spiega in modo semplice che al momento non puoi vedere l'immagine qui e suggerisci Vision quando disponibile — senza dire 'uso Vision' come step.",
      }
    }

    case 'document': {
      const hasDoc = (input.attachments || []).some((a) => a?.type === 'document')
      if (!hasDoc) {
        return {
          tool: 'document',
          status: 'unavailable',
          summary:
            "L'utente sembra voler leggere un documento ma non ce n'è uno allegato. Chiedi di allegarlo, in modo naturale.",
        }
      }
      return {
        tool: 'document',
        status: 'unavailable',
        summary:
          'Lettura documenti non ancora disponibile in chat. Spiega il limite in modo semplice, senza errori tecnici.',
      }
    }

    case 'calendar':
      return {
        tool: 'calendar',
        status: 'unavailable',
        summary:
          'Calendario non collegato. Spiega in modo semplice che non hai accesso agli impegni e offri di aiutare a organizzare a parole.',
      }

    case 'reminder':
      return {
        tool: 'reminder',
        status: 'unavailable',
        summary:
          'Promemoria automatici non ancora attivi. Puoi comunque aiutare a formulare il promemoria o suggerire di salvarlo tra le note personali, senza jargon.',
      }

    default:
      return {
        tool: /** @type {ToolId} */ (tool),
        status: 'unavailable',
        summary: 'Strumento non disponibile.',
      }
  }
}

/**
 * Run the full retrieve stage for a planned tool list.
 * Fail-soft: each tool is isolated; failures never throw out of this function.
 *
 * @param {ToolId[]} tools
 * @param {OrchestratorInput} input
 * @returns {Promise<ToolResult[]>}
 */
export async function executeTools(tools, input) {
  const list = Array.isArray(tools) ? tools : []
  if (list.length === 0) return []

  const settled = await Promise.all(
    list.map(async (tool) => {
      try {
        return await executeTool(tool, input)
      } catch {
        return /** @type {ToolResult} */ ({
          tool,
          status: 'error',
          summary: `Strumento ${tool} non disponibile. Continua senza.`,
        })
      }
    }),
  )

  return settled
}

/**
 * Build the invisible context block merged into model instructions.
 * Dedupes overlapping facts and labels verified vs unverified outcomes.
 *
 * @param {ToolResult[]} results
 * @returns {string}
 */
export function buildOrchestratorContext(results) {
  if (!Array.isArray(results) || results.length === 0) return ''

  const deduped = dedupeToolResults(results)
  if (deduped.length === 0) return ''

  const lines = deduped.map(formatToolResultLine)
  const conflictNote =
    deduped.filter((r) => r.status === 'ok').length > 1
      ? '\n\nSe fonti ok discordano: risolvi il conflitto con cautela, dichiara incertezza, non inventare.'
      : ''

  return `${ORCHESTRATOR_SILENCE}${conflictNote}\n\n${lines.join('\n\n')}`
}

/**
 * Full orchestrate step: plan → refine → retrieve → merge context.
 *
 * @param {OrchestratorInput} input
 * @returns {Promise<{ tools: ToolId[], results: ToolResult[], context: string }>}
 */
export async function orchestrate(input) {
  try {
    const planned = planTools(input)
    const results = await executeTools(planned, input)
    const context = buildOrchestratorContext(results)
    return { tools: planned, results, context }
  } catch {
    // Total orchestrator failure → empty context; chat continues with the model alone.
    return { tools: [], results: [], context: '' }
  }
}
