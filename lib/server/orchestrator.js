/**
 * LAIfe AI Orchestrator — invisible tool routing for chat.
 *
 * Pipeline (never shown to the user):
 * 1. Understand message
 * 2. Identify needed tools
 * 3. Retrieve information (fail-soft)
 * 4. Merge into one context block for a single model reply
 *
 * The client only ever receives the final unified answer.
 */

import { prioritizeToolResults } from './info-prioritization.js'

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
Hai già ricevuto dati da capacità interne. Integra ciò che è utile in UNA sola risposta naturale.
Priorità (alta → bassa): richiesta diretta → correttezza → chat corrente → memorie → conoscenza esterna → stile.
Regole assolute:
- Non dire mai "uso Vision", "faccio una ricerca", "consulto la memoria", "apro il calendario", ecc.
- Non mostrare risultati separati per strumento.
- Non inventare dati se lo strumento ha fallito: spiega il limite in modo semplice, senza errori tecnici.
- Se uno strumento non è disponibile, continua con ciò che hai.
- Preferisci il percorso più semplice: non allungare la risposta solo perché c'erano più fonti.
- Mai sacrificare la correttezza per lo stile. Mai overload di dettagli inutili.`

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

  // Web — freshness / lookup beyond memory.
  if (
    /\b(cerca|ricerca|google|online|su\s+internet|ultime\s+notizie|news|prezzo\s+(attual|corrent)|quotazione)\b/i.test(
      text,
    ) ||
    /\b(search|look\s+up|who\s+won|latest|current\s+price|breaking)\b/i.test(text) ||
    /\b(chi\s+è|cos['']è|what\s+is|who\s+is)\b.{0,60}\b(oggi|adesso|attuale|recente|202[4-9])\b/i.test(
      text,
    )
  ) {
    selected.add('web')
  }

  // Memory — personal facts / preferences / recall.
  const wantsPersonal =
    /\b(ricord[io]|preferisc[oi]|mi\s+piace|odio|la\s+mia|il\s+mio|i\s+miei|le\s+mie|ho\s+detto|ti\s+avevo|my\s+name|i\s+prefer|remember\s+that)\b/i.test(
      text,
    ) ||
    /\b(come\s+mi\s+chiamo|qual['']è\s+il\s+mio|sai\s+già|dalla\s+memoria)\b/i.test(text)

  if (memoryEnabled && (wantsPersonal || selected.size === 0)) {
    // Prefer memory when personal; also soft-try memory on general turns
    // so personalization can help — cheap and fail-soft.
    // Skip memory for pure calculator-only or pure weather-only with no personal cue.
    const onlyCalc = selected.size === 1 && selected.has('calculator')
    const onlyWeather = selected.size === 1 && selected.has('weather')
    if (wantsPersonal || (!onlyCalc && !onlyWeather)) {
      selected.add('memory')
    }
  }

  // Pure greetings / thanks → no tools (model alone).
  if (
    selected.size === 1 &&
    selected.has('memory') &&
    /^(ciao|hey|hola|hi|hello|salve|buongiorno|buonasera|thanks|grazie|ok|okay|va\s+bene)[\s!.?]*$/i.test(
      text,
    )
  ) {
    return []
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

  return order.filter((id) => selected.has(id))
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
 *
 * @param {ToolResult[]} results
 * @returns {string}
 */
export function buildOrchestratorContext(results) {
  if (!Array.isArray(results) || results.length === 0) return ''

  const ordered = prioritizeToolResults(results)
  const lines = ordered.map((r) => {
    const tag = r.status === 'ok' ? 'ok' : r.status
    return `[${r.tool}:${tag}]\n${r.summary}`
  })

  return `${ORCHESTRATOR_SILENCE}\n\n${lines.join('\n\n')}`
}

/**
 * Full orchestrate step: plan → retrieve → context string.
 *
 * @param {OrchestratorInput} input
 * @returns {Promise<{ tools: ToolId[], results: ToolResult[], context: string }>}
 */
export async function orchestrate(input) {
  try {
    const tools = planTools(input)

    // Priority refinement: if memory returned useful data and web was speculative,
    // we still allow both — fusion happens in the model. Speed: skip web if
    // message is purely personal recall with no freshness cues.
    let planned = tools
    const text = String(input?.userMessage || '')
    const freshness =
      /\b(oggi|adesso|attuale|recente|ultime|now|latest|current|202[4-9])\b/i.test(text) ||
      /\b(cerca|ricerca|news|prezzo)\b/i.test(text)

    if (planned.includes('memory') && planned.includes('web') && !freshness) {
      // Prefer memory-only when no clear need for live data.
      planned = planned.filter((t) => t !== 'web')
    }

    const results = await executeTools(planned, input)
    const context = buildOrchestratorContext(results)
    return { tools: planned, results, context }
  } catch {
    // Total orchestrator failure → empty context; chat continues with the model alone.
    return { tools: [], results: [], context: '' }
  }
}
