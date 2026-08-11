/**
 * LAIfe V2 — Writer 2.3.2 SNAPSHOT (frozen)
 *
 * Experimental comparison baseline for Writer 3.0.
 * Do not evolve this file — use lib/server/v2/brain/writer.js instead.
 *
 * Sole V2 module allowed to talk to an LLM (via WriterProvider).
 * Executes Planner plans; does not decide, review, or touch memory.
 *
 * @see WRITER_API_SPEC.md
 */

export const WRITER_VERSION = '2.3.2-writer'

/** @typedef {'stop'|'length'|'cancelled'|'content_filter'|'error'|'unknown'} FinishReason */

/**
 * @typedef {'timeout'|'rate_limit'|'provider_unavailable'|'auth_failed'|'malformed_response'|'empty_response'|'cancelled'|'invalid_request'|'content_filtered'|'unsupported_feature'|'internal'} WriterErrorCode
 */

/**
 * @typedef {object} Usage
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [totalTokens]
 * @property {number} [thinkingTokens]
 * @property {number} [cachedInputTokens]
 */

/**
 * @typedef {object} WriterError
 * @property {WriterErrorCode} code
 * @property {string} message
 * @property {boolean} retryable
 * @property {string} [providerId]
 * @property {string} [model]
 * @property {string} [requestId]
 * @property {string} [cause]
 * @property {number} [httpStatus]
 */

/**
 * @typedef {object} ProviderCapabilities
 * @property {boolean} streaming
 * @property {boolean} jsonMode
 * @property {boolean} structuredOutput
 * @property {boolean} tools
 * @property {boolean} vision
 * @property {boolean} audioInput
 * @property {boolean} audioOutput
 * @property {boolean} reasoning
 * @property {number} [maxContextTokens]
 */

/**
 * @typedef {object} ProviderMessage
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 */

/**
 * @typedef {object} ProviderRequest
 * @property {string} model
 * @property {string} instructions
 * @property {ProviderMessage[]} input
 * @property {boolean} stream
 * @property {number} [maxOutputTokens]
 * @property {number} [temperature]
 * @property {number} [topP]
 * @property {number} [seed]
 * @property {string[]} [stopSequences]
 * @property {'text'|'json'|'structured'} [responseFormat]
 * @property {object} [structuredSchema]
 * @property {AbortSignal} [abortSignal]
 * @property {{ requestId?: string, traceId?: string }} [metadata]
 */

/**
 * @typedef {object} ProviderResponse
 * @property {string} text
 * @property {FinishReason} finishReason
 * @property {Usage} usage
 * @property {string} model
 * @property {string[]} [rawWarnings]
 */

/**
 * @typedef {object} ProviderStreamEvent
 * @property {'delta'|'usage'|'error'|'done'} type
 * @property {string} [textDelta]
 * @property {Usage} [usage]
 * @property {FinishReason} [finishReason]
 * @property {WriterError} [error]
 */

/**
 * @typedef {object} WriterProvider
 * @property {string} id
 * @property {ProviderCapabilities} capabilities
 * @property {(req: ProviderRequest) => Promise<ProviderResponse>} complete
 * @property {(req: ProviderRequest) => AsyncIterable<ProviderStreamEvent>} stream
 */

/**
 * @typedef {object} StreamingChunk
 * @property {'delta'|'usage'|'error'|'done'} type
 * @property {string} [textDelta]
 * @property {Usage} [usage]
 * @property {FinishReason} [finishReason]
 * @property {WriterError} [error]
 * @property {number} [index]
 */

/**
 * @typedef {object} WriterResponse
 * @property {string} text
 * @property {FinishReason} finishReason
 * @property {Usage} usage
 * @property {string} model
 * @property {string} providerId
 * @property {string} [requestId]
 * @property {string[]} [warnings]
 */

/**
 * @typedef {object} WriterConfig
 * @property {Record<string, WriterProvider>} providers
 * @property {string} [defaultProviderId]
 * @property {Record<string, string>} [defaultModelByProvider]
 */

const RETRYABLE_CODES = new Set([
  'timeout',
  'rate_limit',
  'provider_unavailable',
  'malformed_response',
  'empty_response',
])

const NON_RETRYABLE_CODES = new Set([
  'auth_failed',
  'cancelled',
  'invalid_request',
  'content_filtered',
  'unsupported_feature',
  'internal',
])

/**
 * @param {Partial<WriterError> & { code: WriterErrorCode, message: string }} input
 * @returns {WriterError}
 */
export function createWriterError(input) {
  const code = input.code
  const retryable =
    typeof input.retryable === 'boolean'
      ? input.retryable
      : RETRYABLE_CODES.has(code)
  return {
    code,
    message: String(input.message || code),
    retryable,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.cause ? { cause: String(input.cause) } : {}),
    ...(typeof input.httpStatus === 'number' ? { httpStatus: input.httpStatus } : {}),
  }
}

/**
 * @param {unknown} value
 * @returns {value is WriterError}
 */
export function isWriterError(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof /** @type {any} */ (value).code === 'string' &&
      typeof /** @type {any} */ (value).message === 'string' &&
      typeof /** @type {any} */ (value).retryable === 'boolean',
  )
}

/**
 * @param {WriterErrorCode} code
 * @returns {boolean}
 */
export function isRetryableCode(code) {
  if (NON_RETRYABLE_CODES.has(code)) return false
  return RETRYABLE_CODES.has(code)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * Serialize planner writerBrief without reinterpreting decisions.
 * @param {any} plan
 * @returns {string}
 */
export function formatPlanForWriter(plan) {
  if (!plan || typeof plan !== 'object') return ''
  const brief = plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : null
  const constraints = Array.isArray(plan.constraints) ? plan.constraints : []
  const cp = plan.conversationPlan && typeof plan.conversationPlan === 'object' ? plan.conversationPlan : null

  const lines = []
  lines.push('WRITER BRIEF (execute; do not renegotiate)')
  if (typeof plan.objective === 'string' && plan.objective) {
    lines.push(`objective=${plan.objective}`)
  }
  if (brief) {
    lines.push(
      `language=${asString(brief.language)}; tone=${asString(brief.tone)}; depth=${asString(brief.depth)}`,
    )
    lines.push(
      `strategy=${asString(brief.strategy)}; need=${asString(brief.need)}; coda=${asString(brief.coda)}`,
    )
    if (brief.moveSummary) lines.push(`move: ${asString(brief.moveSummary)}`)
    lines.push(
      `memoryHint=${asString(brief.memoryHint)}; teaching=${Boolean(brief.teaching)}; comfort=${Boolean(brief.comfort)}; challenge=${Boolean(brief.challenge)}; continueTopic=${Boolean(brief.continueTopic)}`,
    )
    if (Array.isArray(brief.must) && brief.must.length) {
      lines.push('MUST:')
      for (const m of brief.must) lines.push(`- ${asString(m)}`)
    }
    if (Array.isArray(brief.mustNot) && brief.mustNot.length) {
      lines.push('MUST NOT:')
      for (const m of brief.mustNot) lines.push(`- ${asString(m)}`)
    }
  }
  if (cp) {
    lines.push('CONVERSATION PLAN (structure only):')
    if (cp.opening) {
      lines.push(
        `- opening[${asString(cp.opening.kind)}]: ${asString(cp.opening.purpose)}`,
      )
    }
    if (Array.isArray(cp.development)) {
      for (const beat of cp.development) {
        lines.push(`- development[${asString(beat.kind)}]: ${asString(beat.purpose)}`)
      }
    }
    if (cp.closing) {
      lines.push(
        `- closing[${asString(cp.closing.kind)}]: ${asString(cp.closing.purpose)}`,
      )
    }
    if (cp.lengthBand) lines.push(`lengthBand=${asString(cp.lengthBand)}`)
  }
  if (constraints.length) {
    lines.push('CONSTRAINTS:')
    for (const c of constraints) lines.push(`- ${asString(c)}`)
  }
  return lines.join('\n')
}

/**
 * @param {any} preferences
 * @returns {string}
 */
function formatPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return ''
  const lines = ['USER PREFERENCES (soft; do not override hard constraints):']
  if (preferences.displayName) lines.push(`- displayName: ${asString(preferences.displayName)}`)
  if (preferences.replyLength) lines.push(`- replyLength: ${asString(preferences.replyLength)}`)
  if (typeof preferences.useEmojis === 'boolean') {
    lines.push(`- useEmojis: ${preferences.useEmojis}`)
  }
  if (preferences.customInstructions) {
    lines.push(`- customInstructions: ${asString(preferences.customInstructions)}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

/**
 * @param {any} memoryPack
 * @returns {string}
 */
function formatMemoryPack(memoryPack) {
  if (!memoryPack || typeof memoryPack !== 'object') return ''
  const items = Array.isArray(memoryPack.items) ? memoryPack.items : []
  if (!items.length) return ''
  const lines = ['MEMORY PACK (facts only; do not invent beyond these):']
  for (const item of items.slice(0, 8)) {
    const text = asString(item?.text || item?.content || '')
    if (text) lines.push(`- ${text}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

/** Soft-assistant sentence openers / families (pattern ban, not isolated words). */
const SOFT_OPENER_RES = [
  /^è\s+bello\b/i,
  /^è\s+sempre\s+bello\b/i,
  /^è\s+sempre\s+un\s+piacere\b/i,
  /^è\s+un\s+piacere\b/i,
  /^è\s+importante\b/i,
  /^è\s+comprensibile\b/i,
  /^è\s+sorprendente\b/i,
  /^è\s+interessante\b/i,
  /^è\s+normale\b/i,
  /^capisco\s+perfettamente\b/i,
  /^ti\s+capisco\s+perfettamente\b/i,
  /^le\s+piccole\s+cose\b/i,
  /^qui\s+c['’]?è\s+spazio\b/i,
  /^it['’]?s\s+(nice|important|wonderful|understandable|interesting|great)\b/i,
  /^it['’]?s\s+always\s+(a\s+)?(nice|pleasure|wonderful)\b/i,
  /^there['’]?s\s+something\s+(truly\s+)?(nice|special|beautiful|comforting)\b/i,
  /^the\s+little\s+(things|sparks)\b/i,
  /^there\s+is\s+space\b/i,
  /^spero\s+(che\s+)?(la\s+tua\s+giornata|tu\s+stia)\b/i,
  /^spero\s+anche\s+tu\b/i,
  /^una\s+chiacchierata\s+leggera\b/i,
  /^feeling\s+that\b/i,
  /^what['’]?s\s+on\s+your\s+mind\b/i,
  /^i['’]?m\s+glad\b/i,
  /^i\s+am\s+glad\b/i,
  /^i\s+understand\s+perfectly\b/i,
  /^it['’]?s\s+always\s+nice\b/i,
]

/** Bare minimal user turns that must get a one-line ack. */
const MINIMAL_USER_RES =
  /^(ok|okay|okey|okk|esatto|certo|perfetto|va\s*bene|d['’]?accordo|sure|exactly|right|perfect|alright|all\s*right)[.!…]*$/i

/** Allowed one-line replies for minimal turns (no reflections). */
const MINIMAL_ACK_BY_USER = [
  { re: /^(esatto|exactly|right)[.!…]*$/i, reply: 'Esatto.' },
  { re: /^(perfetto|perfect)[.!…]*$/i, reply: 'Perfetto.' },
  { re: /^(certo|sure)[.!…]*$/i, reply: 'Ci siamo.' },
  { re: /^(ok|okay|okey|okk|va\s*bene|d['’]?accordo|alright|all\s*right)[.!…]*$/i, reply: 'Va bene.' },
]

const ALLOWED_MINIMAL_REPLIES = new Set(['Perfetto.', 'Ci siamo.', 'Esatto.', 'Va bene.'])

/** Closing moral / poster wrap-ups. */
const FINAL_MORAL_RES = [
  /^a\s+volte,?\s+(bastano?|le\s+piccole|un[ao]?\s+semplice|una\s+piccola|i\s+momenti|semplicemente)\b/i,
  /^ogni\s+passo\b/i,
  /^ogni\s+giorno\s+porta\b/i,
  /^ricorda\s+che\b/i,
  /^ricordati\s+che\b/i,
  /^remember\s+that\b/i,
  /^sometimes,?\s+(a\s+simple|the\s+little|it\s+only\s+takes|just\s+a\s+simple)\b/i,
  /\brendere\s+la\s+giornata\s+diversa\b/i,
  /\bportare\s+luce\b/i,
  /\bportare\s+tanta\s+gioia\b/i,
  /\bfare\s+la\s+differenza\b/i,
  /\bmake\s+a\s+(real\s+)?difference\b/i,
  /\bhold\s+a\s+special\s+warmth\b/i,
  /\bsentirsi\s+connessi\.?$/i,
  /\bfeel(?:ing)?\s+connected\.?$/i,
  /\brallegra(?:re|rci|rti)?\.?$/i,
  /^rimani\s+presente\b/i,
  /^sappi\s+che\b/i,
  /\bspazi\s+per\s+trovare\s+conforto\b/i,
  /\bsparks?\s+a\s+little\s+joy\b/i,
  /\bspark\s+of\s+connection\b/i,
  /\bbrighten\s+(our|the)\s+day/i,
  /\bnuova\s+opportunit[aà]\s+di\s+connessione\b/i,
  /\bmomenti\s+di\s+semplicit[aà]\b/i,
  /^every\s+day\s+brings\b/i,
  /\bopportunit(?:y|ies)\s+(?:of|for)\s+connection\b/i,
  /\bshared\s+moment\b/i,
]

/** Soft filler that can appear mid/final sentence. */
const SOFT_FILLER_RES = [
  /\bfare\s+la\s+differenza\b/i,
  /\bportare\s+luce\b/i,
  /\bluce\s+nella\s+giornata\b/i,
  /\bmake\s+a\s+(real\s+)?difference\b/i,
  /\bbring\s+light\b/i,
  /\bquite\s+uplifting\b/i,
  /\bspecial\s+warmth\b/i,
  /\bpossono\s+davvero\b/i,
  /\bpu[oò]\s+davvero\b/i,
  /\bpotersi\s+connettere\b/i,
  /\bsentirsi\s+connessi\b/i,
  /\bmomento\s+di\s+connessione\b/i,
  /\bmomento\s+speciale\b/i,
  /\bbrighten\s+our\s+days\b/i,
  /\bunique\s+beauty\b/i,
  /\bmoment\s+of\s+connection\b/i,
  /\bso\s+comforting\b/i,
  /\bwarmth\s+in\s+sharing\b/i,
  /\bpiccoli\s+momenti\b/i,
  /\billuminare\b/i,
  /\bfeels\s+nice\b/i,
  /\bsomething\s+comforting\b/i,
  /\bsomething\s+wonderful\b/i,
  /\bsimple\s+moments\s+we\s+share\b/i,
  /\bè\s+così\s+bello\b/i,
  /\bit['’]?s\s+so\s+(nice|beautiful|wonderful)\b/i,
]

/** Soft emotional validations (keep at most one, intact). Useless openers are noise. */
const VALIDATION_RES = [
  /^mi\s+dispiace\b/i,
  /^capisco\b/i,
  /^ti\s+capisco\b/i,
  /^sento\s+che\b/i,
  /^i\s+understand\b/i,
  /^i['’]?m\s+sorry\b/i,
  /^i\s+am\s+sorry\b/i,
]

/** Validations that are almost always empty assistant padding — treat as noise. */
const USELESS_VALIDATION_RES = [
  /^è\s+bello\b/i,
  /^è\s+importante\b/i,
  /^è\s+comprensibile\b/i,
  /^è\s+normale\b/i,
  /^è\s+sorprendente\b/i,
  /^capisco\s+perfettamente\b/i,
  /^ti\s+capisco\s+perfettamente\b/i,
  /^i\s+understand\s+perfectly\b/i,
  /^it['’]?s\s+(nice|important|understandable|normal)\b/i,
]

const HELPDESK_RES = [
  /^how\s+can\s+i\s+help\b/i,
  /^come\s+posso\s+aiutarti\b/i,
  /^feel\s+free\s+to\s+ask\b/i,
  /^dimmi\s+pure\b/i,
  /^what['’]?s\s+on\s+your\s+mind\b/i,
]

/** Generic interview invites (soft close). */
const SOFT_INVITE_RES = [
  /^c['’]?è\s+qualche\b/i,
  /^hai\s+qualche\b/i,
  /^hai\s+qualcosa\b/i,
  /^what\s+brings\s+you\b/i,
  /^is\s+there\s+a\s+particular\b/i,
  /^hai\s+notato\b/i,
  /^what\s+thoughts\s+are\s+you\b/i,
  /^what['’]?s\s+on\s+your\s+mind\b/i,
  /^is\s+there\s+something\s+you\b/i,
  /^vuoi\s+(parlarne|condividere)\b/i,
  /\bnon\s+credi\b/i,
  /\bnon\s+trovi\b/i,
  /\bdon['’]?t\s+you\s+think\b/i,
  /\bisn['’]?t\s+there\b/i,
  /\bisn['’]?t\s+it\b/i,
  /^c['’]?è\s+qualcosa\b/i,
]

/**
 * Split reply into sentences without inventing text.
 * @param {string} text
 * @returns {string[]}
 */
export function splitDraftSentences(text) {
  const raw = asString(text).replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const parts = raw.match(/[^.!?…]+(?:[.!?…]+|$)/g)
  if (!parts) return [raw]
  return parts.map((s) => s.trim()).filter(Boolean)
}

/**
 * Lexical concrete / scenery details that must be grounded in conversation,
 * required by the Planner brief, or clearly marked as an example.
 * (Grounding pass — separate from Draft Cleaner.)
 */
const CONCRETE_DETAIL_PATTERN =
  /\b(caffè|caffé|coffee|sole|sun|tramonto|pioggia|rain|vento|wind|strada|street|cucina|kitchen|treno|train|mattina|morning|sera|evening|odore|profumo|smell|suono|silenzio|quiet|tazza|cup|finestra|window|passeggiata|walk|foglie|leaves|autunno|autumn|aria|fresca|tostatura|piatto|tavolo|table|ombra|luce|light|alberi|trees|colori|colors|sfumature|canzone|song|rumore|rumori|noise|noises|parco|park|spiaggia|beach|ufficio|office|camera|stanza|room)\b/gi

/** @type {Record<string, string[]>} */
const CONCRETE_TOKEN_ALIASES = {
  caffè: ['caffè', 'caffé', 'coffee'],
  caffé: ['caffè', 'caffé', 'coffee'],
  coffee: ['caffè', 'caffé', 'coffee'],
  sole: ['sole', 'sun'],
  sun: ['sole', 'sun'],
  pioggia: ['pioggia', 'rain'],
  rain: ['pioggia', 'rain'],
  vento: ['vento', 'wind'],
  wind: ['vento', 'wind'],
  treno: ['treno', 'train'],
  train: ['treno', 'train'],
  mattina: ['mattina', 'morning'],
  morning: ['mattina', 'morning'],
  sera: ['sera', 'evening'],
  evening: ['sera', 'evening'],
  odore: ['odore', 'profumo', 'smell'],
  profumo: ['odore', 'profumo', 'smell'],
  smell: ['odore', 'profumo', 'smell'],
  passeggiata: ['passeggiata', 'walk'],
  walk: ['passeggiata', 'walk'],
  foglie: ['foglie', 'leaves'],
  leaves: ['foglie', 'leaves'],
  autunno: ['autunno', 'autumn'],
  autumn: ['autunno', 'autumn'],
  luce: ['luce', 'light'],
  light: ['luce', 'light'],
  alberi: ['alberi', 'trees'],
  trees: ['alberi', 'trees'],
  colori: ['colori', 'colors'],
  colors: ['colori', 'colors'],
  canzone: ['canzone', 'song'],
  song: ['canzone', 'song'],
  rumore: ['rumore', 'rumori', 'noise', 'noises'],
  rumori: ['rumore', 'rumori', 'noise', 'noises'],
  noise: ['rumore', 'rumori', 'noise', 'noises'],
  noises: ['rumore', 'rumori', 'noise', 'noises'],
  parco: ['parco', 'park'],
  park: ['parco', 'park'],
  spiaggia: ['spiaggia', 'beach'],
  beach: ['spiaggia', 'beach'],
  ufficio: ['ufficio', 'office'],
  office: ['ufficio', 'office'],
  camera: ['camera', 'stanza', 'room'],
  stanza: ['camera', 'stanza', 'room'],
  room: ['camera', 'stanza', 'room'],
  tavolo: ['tavolo', 'table'],
  table: ['tavolo', 'table'],
  tazza: ['tazza', 'cup'],
  cup: ['tazza', 'cup'],
  finestra: ['finestra', 'window'],
  window: ['finestra', 'window'],
  strada: ['strada', 'street'],
  street: ['strada', 'street'],
  cucina: ['cucina', 'kitchen'],
  kitchen: ['cucina', 'kitchen'],
  silenzio: ['silenzio', 'quiet'],
  quiet: ['silenzio', 'quiet'],
}

/**
 * Concrete / sensory particularity (used to detect Firma, not to add removal rules).
 * @param {string} sentence
 * @returns {boolean}
 */
function hasConcreteSignal(sentence) {
  const s = asString(sentence).trim()
  if (!s) return false
  if (/\d/.test(s)) return true
  if (/["«»][^"«»]{2,}["«»]/.test(s)) return true
  CONCRETE_DETAIL_PATTERN.lastIndex = 0
  if (CONCRETE_DETAIL_PATTERN.test(s)) return true
  if (
    /\b(ricordo|sorriso|glance|nod|tostatura|sfumature)\b/i.test(s)
  ) {
    return true
  }
  return false
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractConcreteDetailTokens(text) {
  const s = asString(text)
  /** @type {string[]} */
  const out = []
  const re = new RegExp(CONCRETE_DETAIL_PATTERN.source, 'gi')
  let m = re.exec(s)
  while (m) {
    const tok = asString(m[1]).toLowerCase()
    if (tok && !out.includes(tok)) out.push(tok)
    m = re.exec(s)
  }
  return out
}

/**
 * Conversation + planner + memory text used to ground concrete details.
 * Does not include previousDraft (would launder invented scenery).
 * @param {any} request
 * @returns {string}
 */
export function collectGroundingContext(request) {
  const req = request && typeof request === 'object' ? request : {}
  /** @type {string[]} */
  const parts = []

  const messages = Array.isArray(req.messages) ? req.messages : []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const content = asString(m.content).trim()
    if (content) parts.push(content)
  }

  const plan = req.plan && typeof req.plan === 'object' ? req.plan : null
  if (plan) {
    if (plan.objective) parts.push(asString(plan.objective))
    const brief = plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : null
    if (brief) {
      if (brief.moveSummary) parts.push(asString(brief.moveSummary))
      if (Array.isArray(brief.must)) {
        for (const item of brief.must) parts.push(asString(item))
      }
      if (Array.isArray(brief.mustNot)) {
        for (const item of brief.mustNot) parts.push(asString(item))
      }
      if (brief.need) parts.push(asString(brief.need))
      if (brief.strategy) parts.push(asString(brief.strategy))
    }
    if (Array.isArray(plan.constraints)) {
      for (const c of plan.constraints) parts.push(asString(c))
    }
    const cp = plan.conversationPlan && typeof plan.conversationPlan === 'object' ? plan.conversationPlan : null
    if (cp) {
      if (cp.opening?.purpose) parts.push(asString(cp.opening.purpose))
      if (cp.closing?.purpose) parts.push(asString(cp.closing.purpose))
      if (Array.isArray(cp.development)) {
        for (const beat of cp.development) {
          if (beat?.purpose) parts.push(asString(beat.purpose))
        }
      }
    }
  }

  const mem = req.memoryPack && typeof req.memoryPack === 'object' ? req.memoryPack : null
  if (mem && Array.isArray(mem.items)) {
    for (const item of mem.items) {
      const text = asString(item?.text || item?.content || '')
      if (text) parts.push(text)
    }
  }

  return parts.join('\n').toLowerCase()
}

/**
 * Sentence clearly framed as an example (allowed ungrounded concrete).
 * @param {string} sentence
 * @returns {boolean}
 */
export function isExampleFramedSentence(sentence) {
  const s = asString(sentence).trim()
  if (!s) return false
  if (/\b(ad esempio|per esempio|for example|such as)\b/i.test(s)) return true
  if (/,\s*come\s+/i.test(s)) return true
  if (/\bcome un[ao]?\b/i.test(s)) return true
  if (/\blike a\b/i.test(s)) return true
  if (/\bes\.?\s*:/i.test(s)) return true
  return false
}

/**
 * @param {string} token
 * @param {string} groundingText
 * @returns {boolean}
 */
function tokenGroundedInContext(token, groundingText) {
  const t = asString(token).toLowerCase()
  if (!t || !groundingText) return false
  const aliases = CONCRETE_TOKEN_ALIASES[t] || [t]
  for (const a of aliases) {
    if (!a) continue
    // word-boundary-ish check
    const re = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(groundingText)) return true
  }
  return false
}

/**
 * @typedef {object} GroundingRemoval
 * @property {string} sentence
 * @property {string[]} tokens
 * @property {string} reason
 */

/**
 * @typedef {object} GroundingReport
 * @property {string} original
 * @property {string} text
 * @property {GroundingRemoval[]} removed
 * @property {string[]} kept
 */

/**
 * Writer relevance pass (NOT Draft Cleaner).
 * Drops sentences that introduce concrete scenery/objects not present in the
 * conversation, not required by the Planner text, and not marked as examples.
 * Prefers a simple pertinent reply over a rich disconnected one.
 *
 * @param {string} draft
 * @param {any} [request]
 * @returns {GroundingReport}
 */
export function enforceReplyGroundingDetailed(draft, request = null) {
  const original = asString(draft).replace(/\s+/g, ' ').trim()
  if (!original) {
    return { original: '', text: '', removed: [], kept: [] }
  }

  // Minimal acks are already forced elsewhere; nothing to ground.
  if (request && isMinimalUserTurn(request)) {
    return { original, text: original, removed: [], kept: [original] }
  }

  const grounding = collectGroundingContext(request)
  const sentences = splitDraftSentences(original)
  /** @type {string[]} */
  const kept = []
  /** @type {GroundingRemoval[]} */
  const removed = []

  for (const sentence of sentences) {
    const tokens = extractConcreteDetailTokens(sentence)
    if (!tokens.length) {
      kept.push(sentence)
      continue
    }
    if (isExampleFramedSentence(sentence)) {
      kept.push(sentence)
      continue
    }
    const ungrounded = tokens.filter((tok) => !tokenGroundedInContext(tok, grounding))
    if (!ungrounded.length) {
      kept.push(sentence)
      continue
    }
    // If ANY concrete token is ungrounded, drop the sentence (prefer pertinent).
    removed.push({
      sentence,
      tokens: ungrounded,
      reason: 'ungrounded_concrete_detail',
    })
  }

  let text = kept.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) {
    // Fail-soft: keep the least scenery-heavy original sentence (no invention).
    const fallback =
      sentences.find((s) => extractConcreteDetailTokens(s).length === 0) || sentences[0] || original
    text = fallback
    // If we had to restore a concrete sentence, note it was unavoidable
    if (extractConcreteDetailTokens(text).length) {
      // Strip to a bare greeting/ack if possible
      const bare = text.match(
        /^(ciao|hey|hi|hello|salve|buongiorno|buonasera|ok|va bene|certo|esatto|perfetto)[!.,]*/i,
      )
      if (bare) text = bare[0].replace(/\s+$/, '') + (/[.!?]$/.test(bare[0]) ? '' : '.')
    }
  }

  return { original, text, removed, kept }
}

/**
 * @param {string} draft
 * @param {any} [request]
 * @returns {string}
 */
export function enforceReplyGrounding(draft, request = null) {
  return enforceReplyGroundingDetailed(draft, request).text
}

/**
 * @param {string} text
 * @param {any} [request]
 * @returns {boolean}
 */
export function hasUngroundedConcreteDetails(text, request = null) {
  return enforceReplyGroundingDetailed(text, request).removed.length > 0
}

/** Allowed presence-only lines (no facts, images, morals, questions). */
const PRESENCE_PHRASES = [
  'Ciao! Bentornato.',
  'Ciao! È un piacere rivederti.',
  'Sto bene, grazie.',
  'Ci sono.',
  'Va bene.',
]

const PRESENCE_PHRASE_SET = new Set(PRESENCE_PHRASES.map((p) => p.toLowerCase()))

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isAllowedPresencePhrase(text) {
  const t = asString(text).replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return false
  if (PRESENCE_PHRASE_SET.has(t)) return true
  const core = t.replace(/[.!…]+$/g, '').trim()
  if (!core) return false
  if (PRESENCE_PHRASE_SET.has(core)) return true
  if (PRESENCE_PHRASE_SET.has(`${core}.`)) return true
  if (PRESENCE_PHRASE_SET.has(`${core}!`)) return true
  return false
}

/**
 * Detect greeting-like user turns (for presence recovery).
 * @param {string} userText
 * @returns {boolean}
 */
function isGreetingUserTurn(userText) {
  const t = asString(userText).replace(/\s+/g, ' ').trim()
  return /^(ciao|hey|hi|hello|salve|buongiorno|buonasera)[!.,\s]*$/i.test(t)
}

/**
 * Detect wellbeing-check user turns.
 * @param {string} userText
 * @returns {boolean}
 */
function isWellbeingUserTurn(userText) {
  const t = asString(userText).replace(/\s+/g, ' ').trim()
  return /^(come stai|come va|how are you|how're you|how are things)[?!.\s]*$/i.test(t)
}

/**
 * After grounding removed concrete scenery, is the leftover too bare?
 * Allowed presence phrases are NOT considered too sparse.
 * @param {string} text
 * @returns {boolean}
 */
export function isTooSparseAfterGrounding(text) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (isAllowedPresencePhrase(t)) return false
  if (/^(ciao|hey|hi|hello|salve|buongiorno|buonasera)[!.,\s]*$/i.test(t)) return true
  if (/^sto bene[.!]*$/i.test(t)) return true
  if (/^(ok|okay|va bene|certo|esatto|perfetto|ci sono)[.!]*$/i.test(t)) return true
  const words = t
    .replace(/[.!?…,]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length <= 1) return true
  return false
}

/**
 * Pick a brief presence line — warmth only, no new facts/images/morals/questions.
 * @param {any} request
 * @param {string} sparseText
 * @returns {string}
 */
export function pickPresencePhrase(request, sparseText = '') {
  const user = latestUserMessage(request)
  const sparse = asString(sparseText).replace(/\s+/g, ' ').trim()

  if (isMinimalUserTurn(request)) {
    return pickMinimalAck(user)
  }
  if (isGreetingUserTurn(user) || /^(ciao|hey|hi|hello|salve)\b/i.test(sparse)) {
    // Prefer bentornato; alternate warmth without inventing scenery
    return 'Ciao! Bentornato.'
  }
  if (isWellbeingUserTurn(user) || /^sto bene\b/i.test(sparse)) {
    return 'Sto bene, grazie.'
  }
  if (/^va bene\b/i.test(sparse)) return 'Va bene.'
  return 'Ci sono.'
}

/**
 * @typedef {object} PresenceRecoveryReport
 * @property {string} original
 * @property {string} text
 * @property {boolean} applied
 * @property {string} [reason]
 */

/**
 * Presence Recovery — runs AFTER enforceReplyGrounding.
 * If grounding stripped concrete details and left a bare collapse ("Ciao.", "Sto bene."),
 * replace with a short presence line. No facts, examples, images, morals, or questions.
 *
 * @param {string} groundedText
 * @param {any} [request]
 * @param {{ removedConcrete?: boolean }} [options]
 * @returns {PresenceRecoveryReport}
 */
export function recoverPresenceDetailed(groundedText, request = null, options = {}) {
  const original = asString(groundedText).replace(/\s+/g, ' ').trim()
  const removedConcrete = Boolean(options.removedConcrete)

  // Minimal turns already have dedicated short acks.
  if (request && isMinimalUserTurn(request)) {
    return { original, text: original, applied: false, reason: 'minimal_turn_skip' }
  }

  const noConcreteLeft = extractConcreteDetailTokens(original).length === 0
  const lostAllConcrete = removedConcrete && noConcreteLeft
  if (!lostAllConcrete) {
    return { original, text: original, applied: false, reason: 'concrete_still_present_or_untouched' }
  }
  if (!isTooSparseAfterGrounding(original)) {
    return { original, text: original, applied: false, reason: 'not_sparse' }
  }

  const presence = pickPresencePhrase(request, original)
  return {
    original,
    text: presence,
    applied: presence !== original,
    reason: 'presence_recovery_after_grounding',
  }
}

/**
 * @param {string} groundedText
 * @param {any} [request]
 * @param {{ removedConcrete?: boolean }} [options]
 * @returns {string}
 */
export function recoverPresence(groundedText, request = null, options = {}) {
  return recoverPresenceDetailed(groundedText, request, options).text
}

/**
 * Full Writer post-pass: grounding then presence recovery.
 * Does not modify Draft Cleaner.
 *
 * @param {string} draft
 * @param {any} [request]
 * @returns {{ text: string, grounding: GroundingReport, presence: PresenceRecoveryReport }}
 */
export function finalizeWriterText(draft, request = null) {
  const grounding = enforceReplyGroundingDetailed(draft, request)
  const presence = recoverPresenceDetailed(grounding.text, request, {
    removedConcrete: grounding.removed.length > 0,
  })
  return {
    text: presence.text,
    grounding,
    presence,
  }
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function matchesSoftOpener(sentence) {
  return SOFT_OPENER_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function matchesSoftFiller(sentence) {
  return SOFT_FILLER_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function matchesSoftInvite(sentence) {
  return SOFT_INVITE_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function matchesFinalMoral(sentence) {
  return FINAL_MORAL_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function isValidationSentence(sentence) {
  return VALIDATION_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * Extract a concrete remainder from a soft-wrapped sentence.
 * Never invents words. Used to salvage Firma from soft wrappers.
 * @param {string} sentence
 * @returns {string}
 */
function extractConcreteRemainder(sentence) {
  const original = asString(sentence).trim()
  if (!original) return ''

  let m = original.match(
    /^le\s+piccole\s+cose\b[\s\S]*?(?:,|—|-)\s*(?:come|such as)\s+(.+)$/i,
  )
  if (!m) {
    m = original.match(/^the\s+little\s+things\b[\s\S]*?(?:,|—|-)\s*(?:like|such as)\s+(.+)$/i)
  }
  // Soft moral/wrapper that still lands on a particular "come X"
  if (!m) {
    m = original.match(
      /^a\s+volte\b[\s\S]*?(?:,|—|-)\s*(?:come|such as|like)\s+(.+)$/i,
    )
  }
  // "A volte, una semplice passeggiata…" → keep the concrete clause
  if (!m) {
    m = original.match(
      /^a\s+volte,?\s+(un[ao]?\s+semplice\s+.+)$/i,
    )
  }
  if (!m) {
    m = original.match(
      /^sometimes,?\s+(a\s+simple\s+.+)$/i,
    )
  }
  if (m && m[1]) {
    let rest = m[1].trim()
    rest = rest
      .replace(
        /(?:,|;)\s*(?:che\s+)?(?:possono|può|puo|possono davvero)[\s\S]*$/i,
        '',
      )
      .replace(/(?:,|;)\s*(?:that\s+)?(?:can|could)\s+really[\s\S]*$/i, '')
      .replace(/\s+pu[oò]\s+davvero\b[\s\S]*$/i, '')
      .replace(/\s+possono\s+davvero\b[\s\S]*$/i, '')
      .replace(/,?\s*è\s+così\s+bello[\s\S]*$/i, '')
      .replace(/,?\s*it['’]?s\s+so\s+(nice|beautiful|wonderful)[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!rest) return ''
    if (!/[.!?…]$/.test(rest)) {
      const end = original.match(/[.!?…]+$/)?.[0] || '.'
      rest += end
    }
    rest = rest.charAt(0).toUpperCase() + rest.slice(1)
    return hasConcreteSignal(rest) || hasLivingDetail(rest) ? rest : ''
  }

  return ''
}

/**
 * Living detail that makes a line recognizable (Firma), beyond pure soft texture.
 * Detection-only — does not add removal rules.
 * @param {string} sentence
 * @returns {boolean}
 */
function hasLivingDetail(sentence) {
  const s = asString(sentence).trim()
  if (!s) return false
  if (hasConcreteSignal(s)) return true
  // Particular image / named situation after "come/like"
  if (
    /(?:,|—|-)\s*(?:come|like|such as)\s+[^.?!]{6,}/i.test(s) &&
    !/\b(una conversazione sincera|a sincere conversation|un momento di connessione)\b/i.test(s)
  ) {
    return true
  }
  // First-person situated observation with enough substance
  if (
    /^(posso|vedo|noto|osserv|mi viene|i (can |notice|see|hear))\b/i.test(s) &&
    s.split(/\s+/).length >= 6
  ) {
    return true
  }
  return false
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function isUselessValidation(sentence) {
  return USELESS_VALIDATION_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function matchesHelpdesk(sentence) {
  return HELPDESK_RES.some((re) => re.test(asString(sentence).trim()))
}

/**
 * When spark forbids questions, salvage a concrete observation from an interview line
 * without inventing words — drop the invite prefix and the '?'.
 * @param {string} sentence
 * @returns {string}
 */
function salvageObservationFromQuestion(sentence) {
  let s = asString(sentence).trim()
  if (!s) return ''
  if (!hasConcreteSignal(s) && !hasLivingDetail(s)) return ''
  s = s.replace(/\?\s*$/, '').trim()
  s = s
    .replace(/^hai\s+notato\s+(quanto\s+(siano|è|e)\s+)?/i, '')
    .replace(/^have\s+you\s+noticed\s+(how\s+)?/i, '')
    .replace(/^non\s+trovi\s+(che\s+)?/i, '')
    .replace(/^don['’]?t\s+you\s+think\s+/i, '')
    .replace(/^c['’]?è\s+qualcosa\s+di\s+speciale\s+(nell['’]aria|in\s+aria)\s*[.!]?\s*$/i, '')
    .replace(/^what\s+about\s+/i, '')
    .trim()
  if (!s) return ''
  if (!/[.!?…]$/.test(s)) s += '.'
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return hasConcreteSignal(s) || hasLivingDetail(s) ? s : ''
}

/**
 * Latest user message content from WriterRequest.messages.
 * @param {any} request
 * @returns {string}
 */
export function latestUserMessage(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (!m || typeof m !== 'object') continue
    if (asString(m.role).toLowerCase() !== 'user') continue
    return asString(m.content).trim()
  }
  return ''
}

/**
 * @param {string|any} requestOrText
 * @returns {boolean}
 */
export function isMinimalUserTurn(requestOrText) {
  const text =
    typeof requestOrText === 'string'
      ? requestOrText.trim()
      : latestUserMessage(requestOrText)
  if (!text) return false
  return MINIMAL_USER_RES.test(text.replace(/\s+/g, ' ').trim())
}

/**
 * Map a minimal user turn to an allowed one-line ack.
 * @param {string} userText
 * @returns {string}
 */
export function pickMinimalAck(userText) {
  const t = asString(userText).replace(/\s+/g, ' ').trim()
  for (const row of MINIMAL_ACK_BY_USER) {
    if (row.re.test(t)) return row.reply
  }
  return 'Va bene.'
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isAllowedMinimalReply(text) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  if (ALLOWED_MINIMAL_REPLIES.has(t)) return true
  // tolerate missing final period
  return ALLOWED_MINIMAL_REPLIES.has(`${t}.`)
}

/**
 * Planner coda from WriterRequest.plan (read-only).
 * @param {any} request
 * @returns {string}
 */
function planCoda(request) {
  const brief = request?.plan?.writerBrief
  return asString(brief?.coda).toLowerCase()
}

/**
 * Word count helper.
 * @param {string} sentence
 * @returns {number}
 */
function wordCount(sentence) {
  const t = asString(sentence).replace(/[.!?…]+$/g, '').trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

/**
 * Uneven rhythm: true when 3+ sentences all sit in a medium band.
 * @param {string[]} sentences
 * @returns {boolean}
 */
function hasUniformMediumRhythm(sentences) {
  if (!Array.isArray(sentences) || sentences.length < 3) return false
  const counts = sentences.map(wordCount).filter((n) => n > 0)
  if (counts.length < 3) return false
  return counts.every((n) => n >= 7 && n <= 18)
}

/**
 * Self-check: without the LAIfe logo, would this read as a generic chatbot?
 * Deterministic heuristic — measurement only; rewrite is separate.
 *
 * @param {string} text
 * @param {any} [request]
 * @returns {{ generic: boolean, reasons: string[] }}
 */
export function looksLikeGenericChatbot(text, request = null) {
  const cleaned = asString(text).replace(/\s+/g, ' ').trim()
  /** @type {string[]} */
  const reasons = []
  if (!cleaned) {
    return { generic: true, reasons: ['empty'] }
  }

  // Presence-only recovery lines are intentional warmth, not soft-assistant noise.
  if (isAllowedPresencePhrase(cleaned)) {
    return { generic: false, reasons: [] }
  }

  const sentences = splitDraftSentences(cleaned)
  const minimal = request ? isMinimalUserTurn(request) : false
  const coda = request ? planCoda(request) : ''

  if (minimal) {
    if (!isAllowedMinimalReply(cleaned)) reasons.push('minimal_turn_not_short_ack')
    if (sentences.length > 1) reasons.push('minimal_turn_extra_sentences')
    if (/\?/.test(cleaned)) reasons.push('minimal_turn_has_question')
    if (wordCount(cleaned) > 4) reasons.push('minimal_turn_too_long')
  }

  for (const s of sentences) {
    if (matchesSoftOpener(s) || isUselessValidation(s)) reasons.push('soft_validation_opener')
    if (matchesSoftFiller(s)) reasons.push('soft_filler')
    if (matchesFinalMoral(s)) reasons.push('moral_close')
    if (matchesHelpdesk(s) || matchesSoftInvite(s)) reasons.push('helpdesk_or_invite')
  }

  if (hasUniformMediumRhythm(sentences) && !sentences.some((s) => hasLivingDetail(s))) {
    reasons.push('uniform_assistant_rhythm')
  }

  if (coda === 'spark') {
    const last = sentences[sentences.length - 1] || ''
    if (/\?\s*$/.test(last)) reasons.push('spark_as_question')
    if (sentences.some((s) => matchesFinalMoral(s) || matchesSoftFiller(s))) {
      reasons.push('spark_as_moral')
    }
    // Do NOT demand invented concrete scenery for spark — prefer pertinent replies.
  }

  if (request && hasUngroundedConcreteDetails(cleaned, request)) {
    reasons.push('ungrounded_concrete_detail')
  }

  // Deduplicate reasons while preserving order
  const uniq = []
  for (const r of reasons) {
    if (!uniq.includes(r)) uniq.push(r)
  }

  return { generic: uniq.length > 0, reasons: uniq }
}

/**
 * Rewrite brief used for the one-shot identity self-check rewrite.
 * @param {string[]} reasons
 * @param {any} request
 * @returns {string}
 */
export function buildIdentitySelfCheckBrief(reasons, request) {
  const lines = [
    'IDENTITY SELF-CHECK — rewrite once only.',
    'Without the LAIfe logo, the previous draft still reads like a generic chatbot.',
    'Rewrite as a spontaneous human reply. Do not follow a fixed schema.',
    'Ban useless validations: "È bello…", "È importante…", "È comprensibile…", "Capisco perfettamente…".',
    'Ban morals: "Le piccole cose…", "Ogni passo…", "Fare la differenza…", uplift poster lines.',
    'Do not interview or helpdesk ("What\'s on your mind?", "How can I help?").',
    'GROUNDING: do not invent weather, coffee, walks, noises, places, or objects unless they appear in the conversation, are required by the planner brief, or are clearly marked as an example (ad esempio / come…).',
    'Prefer a simple pertinent reply over a rich disconnected one.',
  ]
  if (isMinimalUserTurn(request)) {
    lines.push(
      'The user only said a minimal ack (ok / esatto / certo / perfetto). Reply with ONE short line only: "Perfetto." / "Ci siamo." / "Esatto." / "Va bene." — no reflections.',
    )
  }
  if (planCoda(request) === 'spark') {
    lines.push(
      'Planner coda is spark: a small human touch of presence — NOT a moral, NOT a question, NOT invented scenery.',
    )
  }
  lines.push('For longer replies, alternate short and long sentences — avoid uniform rhythm.')
  lines.push('Keep facts unchanged. Do not cite modules, plans, or this self-check.')
  if (Array.isArray(reasons) && reasons.length) {
    lines.push(`Flags: ${reasons.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Pure redundant soft texture with no living remainder.
 * Uses existing soft/moral/invite detectors only.
 * @param {string} sentence
 * @returns {boolean}
 */
function isPureNoiseSentence(sentence) {
  const s = asString(sentence).trim()
  if (!s) return true
  if (hasLivingDetail(s) || extractConcreteRemainder(s)) return false
  if (isUselessValidation(s)) return true
  if (matchesHelpdesk(s)) return true
  if (matchesSoftInvite(s)) return true
  if (matchesFinalMoral(s)) return true
  if (matchesSoftOpener(s) && !hasLivingDetail(s)) return true
  if (matchesSoftFiller(s) && !hasLivingDetail(s)) return true
  return false
}

/**
 * Classify one sentence for the Draft Cleaner.
 * @param {string} sentence
 * @returns {'noise'|'content'|'signature'}
 */
export function classifyDraftSentence(sentence) {
  const s = asString(sentence).trim()
  if (!s) return 'noise'

  // 3) Firma — always preserve (check before noise)
  if (hasLivingDetail(s) || Boolean(extractConcreteRemainder(s))) {
    return 'signature'
  }

  // Useless validations / helpdesk are always noise (never "content")
  if (isUselessValidation(s) || matchesHelpdesk(s)) return 'noise'

  // 1) Rumore — generic filler / moral / invite with no living remainder
  if (isPureNoiseSentence(s)) return 'noise'

  // Soft wrappers without living detail are still noise
  if (
    (matchesSoftOpener(s) || matchesSoftFiller(s) || matchesFinalMoral(s) || matchesSoftInvite(s)) &&
    !hasLivingDetail(s)
  ) {
    return 'noise'
  }

  // 2) Contenuto — real information / natural ack / single validation line
  return 'content'
}

/**
 * @typedef {object} DraftCleanerSentenceReport
 * @property {string} text
 * @property {'noise'|'content'|'signature'} category
 * @property {boolean} kept
 * @property {string} reason
 * @property {string} [emitted]
 */

/**
 * @typedef {object} DraftCleanerReport
 * @property {string} original
 * @property {string} text
 * @property {DraftCleanerSentenceReport[]} sentences
 * @property {string[]} preservedSignatures
 * @property {boolean} refusedMinimalCollapse
 */

/**
 * Draft Cleaner — final Writer pass.
 * Removes only redundant noise. Always preserves Firma. Keeps Contenuto.
 * Never adds sentences (except collapsing a minimal turn to an allowed ack).
 * Does not touch Planner content.
 *
 * @param {string} draft
 * @param {any} [request] optional WriterRequest for minimal-turn collapse
 * @returns {string}
 */
export function cleanDraft(draft, request = null) {
  return cleanDraftDetailed(draft, request).text
}

/**
 * Same as cleanDraft, with a decision report (for labs / debugging).
 * @param {string} draft
 * @param {any} [request]
 * @returns {DraftCleanerReport}
 */
export function cleanDraftDetailed(draft, request = null) {
  const original = asString(draft).replace(/\s+/g, ' ').trim()
  if (!original) {
    return {
      original: '',
      text: '',
      sentences: [],
      preservedSignatures: [],
      refusedMinimalCollapse: false,
    }
  }

  // Minimal user turns must stay one short allowed ack — no reflections.
  if (request && isMinimalUserTurn(request)) {
    const ack = pickMinimalAck(latestUserMessage(request))
    return {
      original,
      text: ack,
      sentences: [
        {
          text: original,
          category: 'content',
          kept: true,
          reason: 'minimal user turn → forced short ack',
          emitted: ack,
        },
      ],
      preservedSignatures: [],
      refusedMinimalCollapse: false,
    }
  }

  const sentences = splitDraftSentences(original)
  /** @type {DraftCleanerSentenceReport[]} */
  const reports = []
  /** @type {{ text: string, index: number, category: 'content'|'signature' }[]} */
  const kept = []
  let validationCount = 0
  let refusedMinimalCollapse = false

  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i]
    const category = classifyDraftSentence(sentence)

    if (category === 'signature') {
      const remainder = extractConcreteRemainder(sentence)
      const emitted = remainder || sentence
      kept.push({ text: emitted, index: i, category: 'signature' })
      reports.push({
        text: sentence,
        category: 'signature',
        kept: true,
        reason: remainder
          ? 'preserve signature (salvaged living detail from soft wrapper)'
          : 'preserve signature',
        emitted,
      })
      continue
    }

    if (category === 'content') {
      if (isValidationSentence(sentence)) {
        validationCount += 1
        if (validationCount > 1) {
          reports.push({
            text: sentence,
            category: 'content',
            kept: false,
            reason: 'redundant second validation (keep one)',
          })
          continue
        }
      }
      kept.push({ text: sentence, index: i, category: 'content' })
      reports.push({
        text: sentence,
        category: 'content',
        kept: true,
        reason: 'keep content',
        emitted: sentence,
      })
      continue
    }

    // noise
    reports.push({
      text: sentence,
      category: 'noise',
      kept: false,
      reason: 'remove redundant noise',
    })
  }

  let cleanedList = kept.slice().sort((a, b) => a.index - b.index)

  // If only noise was found, keep the least-bad living line rather than inventing.
  if (!cleanedList.length) {
    const fallback = sentences[0]
    cleanedList = [{ text: fallback, index: 0, category: 'content' }]
    const r = reports.find((x) => x.text === fallback)
    if (r) {
      r.kept = true
      r.reason = 'fallback: avoid empty reply'
      r.emitted = fallback
    }
  }

  // Spark coda: observation only — drop questions / soft invites (never invent a spark).
  const coda = request ? planCoda(request) : ''
  const constraints = Array.isArray(request?.plan?.constraints)
    ? request.plan.constraints.map((c) => asString(c).toLowerCase())
    : []
  const forbidQuestion =
    coda === 'spark' ||
    constraints.some((c) => c.includes('ask_question:no') || c.includes('coda:spark'))

  if (forbidQuestion && cleanedList.length) {
    const filtered = []
    for (const item of cleanedList) {
      const isQ = /\?\s*$/.test(item.text) || matchesSoftInvite(item.text)
      if (!isQ) {
        filtered.push(item)
        continue
      }
      const salvaged = salvageObservationFromQuestion(item.text)
      if (salvaged) {
        filtered.push({ ...item, text: salvaged, category: 'signature' })
        const r = reports.find((x) => x.text === item.text || x.emitted === item.text)
        if (r) {
          r.kept = true
          r.category = 'signature'
          r.reason = 'spark: salvaged observation from question'
          r.emitted = salvaged
        }
        continue
      }
      const r = reports.find((x) => x.text === item.text || x.emitted === item.text)
      if (r) {
        r.kept = false
        r.reason = 'spark/no-question: drop interview close'
      }
    }
    if (filtered.length) cleanedList = filtered
  }

  // Never collapse a living reply to a bare greeting when a Firma exists.
  const signatures = cleanedList.filter((s) => s.category === 'signature')
  const contents = cleanedList.filter((s) => s.category === 'content')
  if (signatures.length && contents.length) {
    const onlyTinyAcks =
      contents.every((c) => c.text.replace(/[.!?…]+$/, '').trim().split(/\s+/).length <= 3) &&
      cleanedList.length === signatures.length + contents.length
    // Keep both — do not strip signatures to minimize
    if (onlyTinyAcks && signatures.length >= 1) {
      refusedMinimalCollapse = true
      for (const r of reports) {
        if (r.category === 'signature' && r.kept) {
          r.reason = `${r.reason}; refused minimal collapse`
        }
      }
    }
  }

  // If we still have signatures, never drop them in a "prefer shorter" pass.
  let texts = cleanedList.map((s) => s.text)

  // Only trim trailing pure noise that somehow remained (should not for signatures)
  while (texts.length >= 2) {
    const last = texts[texts.length - 1]
    if (classifyDraftSentence(last) === 'noise') {
      texts = texts.slice(0, -1)
      continue
    }
    break
  }

  // Light merge only for tiny ack pairs — never merge away a signature line
  if (texts.length === 2) {
    const a = texts[0]
    const b = texts[1]
    const aCat = cleanedList.find((s) => s.text === a)?.category
    const bCat = cleanedList.find((s) => s.text === b)?.category
    const aw = a.replace(/[.!?…]+$/, '').trim().split(/\s+/).length
    const bw = b.replace(/[.!?…]+$/, '').trim().split(/\s+/).length
    if (
      aCat === 'content' &&
      bCat === 'content' &&
      aw <= 3 &&
      bw <= 2 &&
      !/[?]$/.test(a) &&
      !isValidationSentence(a)
    ) {
      const left = a.replace(/[.!?…]+$/, '').trim()
      const right = b.charAt(0).toLowerCase() + b.slice(1)
      const end = b.match(/[.!?…]+$/)?.[0] || a.match(/[.!?…]+$/)?.[0] || '.'
      texts = [`${left}, ${right}`.replace(/\s+/g, ' ')]
      if (!/[.!?…]$/.test(texts[0])) texts[0] += end
    }
  }

  let cleaned = texts.join(' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) cleaned = original
  if (cleaned.length > original.length) cleaned = original

  // Detect refusal to over-cut: cleaned keeps a signature that a minimal pass would drop
  const preservedSignatures = reports
    .filter((r) => r.category === 'signature' && r.kept)
    .map((r) => r.emitted || r.text)

  if (preservedSignatures.length && cleaned.split(/[.!?…]+/).filter(Boolean).length >= 2) {
    refusedMinimalCollapse = true
  }

  return {
    original,
    text: cleaned,
    sentences: reports,
    preservedSignatures,
    refusedMinimalCollapse,
  }
}

/**
 * Assemble provider instructions from WriterRequest. Does not reinterpret plan flags.
 * @param {any} request
 * @returns {string}
 */
export function assembleInstructions(request) {
  const req = request && typeof request === 'object' ? request : {}
  const foundation =
    typeof req.personalityFoundation === 'string'
      ? req.personalityFoundation
      : req.personalityFoundation && typeof req.personalityFoundation === 'object'
        ? asString(req.personalityFoundation.text || req.personalityFoundation.content || '')
        : ''

  const parts = []
  if (foundation.trim()) {
    parts.push(`PERSONALITY FOUNDATION\n${foundation.trim()}`)
  }
  const prefs = formatPreferences(req.preferences)
  if (prefs) parts.push(prefs)

  const planBlock = formatPlanForWriter(req.plan)
  if (planBlock) parts.push(planBlock)

  const mem = formatMemoryPack(req.memoryPack)
  if (mem) parts.push(mem)

  if (req.mode === 'rewrite') {
    parts.push(
      [
        'REWRITE MODE',
        'Apply the rewrite brief once. Do not change facts. Do not renegotiate the plan.',
        `rewriteBrief: ${asString(req.rewriteBrief)}`,
        req.previousDraft
          ? `previousDraft:\n---\n${asString(req.previousDraft)}\n---`
          : 'previousDraft: (not provided)',
      ].join('\n'),
    )
  }

  const coda = planCoda(req)
  const minimal = isMinimalUserTurn(req)

  /** @type {string[]} */
  const voiceRules = [
    'OUTPUT RULES',
    'Write only the final assistant reply. Do not cite modules, plans, scores, or engines.',
    '',
    'SPONTANEITY',
    'Sound like a person in conversation — not a template following opener → validation → insight → question.',
    'Do not make the reply feel schema-driven.',
    '',
    'GROUNDING (hard)',
    'Do not introduce concrete details (weather, coffee, sun, walks, noises, places, objects, sensory scenery)',
    'unless they are already present in the conversation, explicitly required by the planner brief, or clearly marked as an example (ad esempio / per esempio / come…).',
    'Prefer a simple pertinent reply over a rich but disconnected one.',
    '',
    'USELESS VALIDATIONS — skip unless truly needed for real support:',
    '- "È bello…"',
    '- "È importante…"',
    '- "È comprensibile…"',
    '- "Capisco perfettamente…"',
    '- "It\'s nice…"/ "It\'s important…"',
    '',
    'MORALS — never close with poster lines:',
    '- "Le piccole cose…"',
    '- "Ogni passo…"',
    '- "Fare la differenza…"',
    '- uplift / "brighten the day" morals',
    '',
    'RHYTHM',
    'For longer replies, alternate short and long sentences. Avoid three medium sentences in a row.',
  ]

  if (minimal) {
    voiceRules.push(
      '',
      'MINIMAL TURN (hard)',
      'The latest user message is only a short ack (ok / esatto / certo / perfetto or close variant).',
      'Reply with ONE short line only, chosen from:',
      '- "Perfetto."',
      '- "Ci siamo."',
      '- "Esatto."',
      '- "Va bene."',
      'Do not add reflections, questions, sparks, or extra sentences.',
    )
  }

  if (coda === 'spark' && !minimal) {
    voiceRules.push(
      '',
      'SPARK (planner coda)',
      'Add a small human touch of presence — NOT a moral, NOT a question, NOT an interview invite.',
      'Do NOT invent concrete scenery to force a spark. If nothing in the conversation supports a detail, keep the reply simple and pertinent.',
    )
  }

  voiceRules.push(
    '',
    'SELF-CHECK (before you finish)',
    'Ask: if I removed the LAIfe logo, would this still read as a generic chatbot?',
    'If yes, rewrite once in your head — more pertinent, less soft-assistant, no invented scenery.',
  )

  parts.push(voiceRules.join('\n'))

  return parts.filter(Boolean).join('\n\n')
}

/**
 * @param {any} request
 * @returns {ProviderMessage[]}
 */
function toProviderInput(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : []
  /** @type {ProviderMessage[]} */
  const input = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const role = asString(m.role).toLowerCase()
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    const content = asString(m.content)
    if (!content) continue
    input.push({ role: /** @type {ProviderMessage['role']} */ (role), content })
  }
  if (request?.mode === 'rewrite' && request.previousDraft) {
    input.push({
      role: 'user',
      content: `Refine this draft once:\n---\n${asString(request.previousDraft)}\n---`,
    })
  }
  return input
}

/**
 * @param {any} request
 * @param {WriterConfig} config
 * @returns {WriterProvider}
 */
function resolveProvider(request, config) {
  const providers = config.providers || {}
  const ids = Object.keys(providers)
  if (!ids.length) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'No WriterProvider registered',
      retryable: false,
    })
  }
  const wanted = asString(request?.providerId) || config.defaultProviderId || ids[0]
  const provider = providers[wanted]
  if (!provider) {
    throw createWriterError({
      code: 'invalid_request',
      message: `Unknown providerId "${wanted}"`,
      retryable: false,
      providerId: wanted,
    })
  }
  return provider
}

/**
 * @param {any} request
 * @param {WriterProvider} provider
 * @param {WriterConfig} config
 * @returns {string}
 */
function resolveModel(request, provider, config) {
  if (request?.model) return asString(request.model)
  const map = config.defaultModelByProvider || {}
  if (map[provider.id]) return map[provider.id]
  return 'default'
}

/**
 * @param {any} request
 * @param {WriterProvider} provider
 */
function assertCapabilities(request, provider) {
  const caps = provider.capabilities || {
    streaming: false,
    jsonMode: false,
    structuredOutput: false,
    tools: false,
    vision: false,
    audioInput: false,
    audioOutput: false,
    reasoning: false,
  }
  const gen = request?.generation || {}
  const format = gen.responseFormat || 'text'

  if (request?.stream && !caps.streaming) {
    throw createWriterError({
      code: 'unsupported_feature',
      message: `Provider "${provider.id}" does not support streaming`,
      retryable: false,
      providerId: provider.id,
    })
  }
  if (format === 'json' && !caps.jsonMode) {
    throw createWriterError({
      code: 'unsupported_feature',
      message: `Provider "${provider.id}" does not support jsonMode`,
      retryable: false,
      providerId: provider.id,
    })
  }
  if (format === 'structured' && !caps.structuredOutput) {
    throw createWriterError({
      code: 'unsupported_feature',
      message: `Provider "${provider.id}" does not support structuredOutput`,
      retryable: false,
      providerId: provider.id,
    })
  }
}

/**
 * @param {any} request
 */
function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    throw createWriterError({
      code: 'invalid_request',
      message: 'WriterRequest must be an object',
      retryable: false,
    })
  }
  if (!request.plan || typeof request.plan !== 'object') {
    throw createWriterError({
      code: 'invalid_request',
      message: 'WriterRequest.plan is required',
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
  if (!request.decision || typeof request.decision !== 'object') {
    throw createWriterError({
      code: 'invalid_request',
      message: 'WriterRequest.decision is required',
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
  const mode = request.mode || 'draft'
  if (mode !== 'draft' && mode !== 'rewrite') {
    throw createWriterError({
      code: 'invalid_request',
      message: `Invalid mode "${mode}"`,
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
  if (mode === 'rewrite' && !asString(request.rewriteBrief).trim()) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'rewriteBrief is required when mode is "rewrite"',
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
}

/**
 * @param {any} request
 * @param {string} instructions
 * @param {WriterProvider} provider
 * @param {WriterConfig} config
 * @param {boolean} stream
 * @returns {ProviderRequest}
 */
function toProviderRequest(request, instructions, provider, config, stream) {
  const gen = request.generation && typeof request.generation === 'object' ? request.generation : {}
  return {
    model: resolveModel(request, provider, config),
    instructions,
    input: toProviderInput(request),
    stream,
    ...(typeof gen.maxOutputTokens === 'number' ? { maxOutputTokens: gen.maxOutputTokens } : {}),
    ...(typeof gen.temperature === 'number' ? { temperature: gen.temperature } : {}),
    ...(typeof gen.topP === 'number' ? { topP: gen.topP } : {}),
    ...(typeof gen.seed === 'number' ? { seed: gen.seed } : {}),
    ...(Array.isArray(gen.stopSequences) ? { stopSequences: gen.stopSequences } : {}),
    ...(gen.responseFormat ? { responseFormat: gen.responseFormat } : {}),
    ...(gen.structuredSchema ? { structuredSchema: gen.structuredSchema } : {}),
    ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
    metadata: {
      ...(request.metadata?.requestId ? { requestId: request.metadata.requestId } : {}),
      ...(request.metadata?.traceId ? { traceId: request.metadata.traceId } : {}),
    },
  }
}

/**
 * @param {ProviderResponse} raw
 * @param {WriterProvider} provider
 * @param {any} request
 * @returns {WriterResponse}
 */
function toWriterResponse(raw, provider, request) {
  const rawText = asString(raw?.text)
  const cleaned = cleanDraft(rawText, request)
  const finalized = finalizeWriterText(cleaned, request)
  const text = finalized.text
  if (!text.trim()) {
    throw createWriterError({
      code: 'empty_response',
      message: 'Provider returned empty text',
      retryable: true,
      providerId: provider.id,
      model: asString(raw?.model),
      requestId: request?.metadata?.requestId,
    })
  }
  const warnings = Array.isArray(raw.rawWarnings) ? raw.rawWarnings.map(asString) : []
  const normalizedRaw = rawText.trim().replace(/\s+/g, ' ')
  if (cleaned !== normalizedRaw) {
    warnings.push('draft_cleaner_applied')
  }
  if (finalized.grounding.removed.length) {
    warnings.push('ungrounded_concrete_removed')
  }
  if (finalized.presence.applied) {
    warnings.push('presence_recovery_applied')
  }
  return {
    text,
    finishReason: /** @type {FinishReason} */ (raw.finishReason || 'unknown'),
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : {},
    model: asString(raw.model) || 'default',
    providerId: provider.id,
    ...(request?.metadata?.requestId ? { requestId: request.metadata.requestId } : {}),
    ...(warnings.length ? { warnings } : {}),
  }
}

/**
 * Merge usage counters across draft + optional self-check rewrite.
 * @param {Usage} a
 * @param {Usage} b
 * @returns {Usage}
 */
function mergeUsage(a, b) {
  /** @type {Usage} */
  const out = { ...(a && typeof a === 'object' ? a : {}) }
  const src = b && typeof b === 'object' ? b : {}
  for (const key of /** @type {(keyof Usage)[]} */ ([
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'thinkingTokens',
    'cachedInputTokens',
  ])) {
    const av = typeof out[key] === 'number' ? out[key] : 0
    const bv = typeof src[key] === 'number' ? src[key] : 0
    if (av || bv) out[key] = av + bv
  }
  return out
}

/**
 * @param {unknown} err
 * @param {WriterProvider} [provider]
 * @param {any} [request]
 * @returns {WriterError}
 */
function normalizeThrown(err, provider, request) {
  if (isWriterError(err)) {
    return {
      ...err,
      providerId: err.providerId || provider?.id,
      requestId: err.requestId || request?.metadata?.requestId,
    }
  }
  const message = err instanceof Error ? err.message : String(err || 'unknown error')
  const name = err instanceof Error ? err.name : ''
  if (name === 'AbortError' || /aborted|cancelled/i.test(message)) {
    return createWriterError({
      code: 'cancelled',
      message: 'Request cancelled',
      retryable: false,
      providerId: provider?.id,
      requestId: request?.metadata?.requestId,
      cause: message,
    })
  }
  if (/timeout/i.test(message)) {
    return createWriterError({
      code: 'timeout',
      message: 'Provider timeout',
      retryable: true,
      providerId: provider?.id,
      requestId: request?.metadata?.requestId,
      cause: message,
    })
  }
  return createWriterError({
    code: 'internal',
    message: 'Provider call failed',
    retryable: false,
    providerId: provider?.id,
    requestId: request?.metadata?.requestId,
    cause: message,
  })
}

/**
 * Create a Writer facade bound to a provider registry.
 * @param {WriterConfig} config
 */
export function createWriter(config) {
  if (!config || typeof config !== 'object' || !config.providers) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'createWriter requires { providers }',
      retryable: false,
    })
  }

  /** @type {WriterConfig} */
  const cfg = {
    providers: config.providers,
    defaultProviderId: config.defaultProviderId,
    defaultModelByProvider: config.defaultModelByProvider || {},
  }

  /**
   * @param {any} request
   * @returns {Promise<WriterResponse>}
   */
  async function write(request) {
    validateRequest(request)
    const provider = resolveProvider(request, cfg)
    assertCapabilities({ ...request, stream: false }, provider)
    const instructions = assembleInstructions(request)
    const providerReq = toProviderRequest(request, instructions, provider, cfg, false)

    // Cooperative cancel before call
    if (request.abortSignal?.aborted) {
      throw createWriterError({
        code: 'cancelled',
        message: 'Request cancelled',
        retryable: false,
        providerId: provider.id,
        requestId: request.metadata?.requestId,
      })
    }

    let raw
    try {
      raw = await provider.complete(providerReq)
    } catch (err) {
      throw normalizeThrown(err, provider, request)
    }

    if (!raw || typeof raw !== 'object') {
      throw createWriterError({
        code: 'malformed_response',
        message: 'Provider returned non-object response',
        retryable: true,
        providerId: provider.id,
        requestId: request.metadata?.requestId,
      })
    }

    let response = toWriterResponse(raw, provider, request)

    // Identity self-check: if it still reads as a generic chatbot, rewrite ONCE.
    // Skip when the caller already asked for a rewrite (Reviewer path) to avoid
    // stacking rewrites — except minimal turns, which must collapse regardless.
    const check = looksLikeGenericChatbot(response.text, request)
    const alreadyRewrite = request.mode === 'rewrite'
    const shouldIdentityRewrite =
      check.generic && (!alreadyRewrite || isMinimalUserTurn(request))

    if (shouldIdentityRewrite) {
      // Deterministic collapse for minimal turns — no second LLM call needed.
      if (isMinimalUserTurn(request)) {
        const ack = pickMinimalAck(latestUserMessage(request))
        if (ack !== response.text) {
          const warnings = Array.isArray(response.warnings) ? response.warnings.slice() : []
          if (!warnings.includes('identity_self_check_rewrite')) {
            warnings.push('identity_self_check_rewrite')
          }
          if (!warnings.includes('minimal_turn_collapse')) {
            warnings.push('minimal_turn_collapse')
          }
          response = { ...response, text: ack, warnings }
        }
      } else {
        const rewriteRequest = {
          ...request,
          mode: 'rewrite',
          rewriteBrief: buildIdentitySelfCheckBrief(check.reasons, request),
          previousDraft: response.text,
          // Prevent recursive self-check loops if write were re-entered
          metadata: {
            ...(request.metadata && typeof request.metadata === 'object' ? request.metadata : {}),
            identitySelfCheck: true,
          },
        }
        const rewriteInstructions = assembleInstructions(rewriteRequest)
        const rewriteProviderReq = toProviderRequest(
          rewriteRequest,
          rewriteInstructions,
          provider,
          cfg,
          false,
        )

        if (request.abortSignal?.aborted) {
          throw createWriterError({
            code: 'cancelled',
            message: 'Request cancelled',
            retryable: false,
            providerId: provider.id,
            requestId: request.metadata?.requestId,
          })
        }

        let rawRewrite
        try {
          rawRewrite = await provider.complete(rewriteProviderReq)
        } catch (err) {
          throw normalizeThrown(err, provider, request)
        }

        if (!rawRewrite || typeof rawRewrite !== 'object') {
          throw createWriterError({
            code: 'malformed_response',
            message: 'Provider returned non-object response on identity rewrite',
            retryable: true,
            providerId: provider.id,
            requestId: request.metadata?.requestId,
          })
        }

        const rewritten = toWriterResponse(rawRewrite, provider, rewriteRequest)
        const warnings = [
          ...(Array.isArray(response.warnings) ? response.warnings : []),
          ...(Array.isArray(rewritten.warnings) ? rewritten.warnings : []),
          'identity_self_check_rewrite',
        ]
        // unique warnings
        const uniqWarnings = []
        for (const w of warnings) {
          if (!uniqWarnings.includes(w)) uniqWarnings.push(w)
        }
        response = {
          ...rewritten,
          usage: mergeUsage(response.usage, rewritten.usage),
          warnings: uniqWarnings,
        }
      }
    }

    return response
  }

  /**
   * @param {any} request
   * @returns {AsyncIterable<StreamingChunk>}
   */
  async function* writeStream(request) {
    const streamRequest = { ...request, stream: true }
    try {
      validateRequest(streamRequest)
    } catch (err) {
      const error = normalizeThrown(err)
      yield { type: 'error', error, index: 0 }
      return
    }

    let provider
    try {
      provider = resolveProvider(streamRequest, cfg)
      assertCapabilities(streamRequest, provider)
    } catch (err) {
      const error = normalizeThrown(err)
      yield { type: 'error', error, index: 0 }
      return
    }

    const instructions = assembleInstructions(streamRequest)
    const providerReq = toProviderRequest(streamRequest, instructions, provider, cfg, true)

    if (streamRequest.abortSignal?.aborted) {
      yield {
        type: 'error',
        error: createWriterError({
          code: 'cancelled',
          message: 'Request cancelled',
          retryable: false,
          providerId: provider.id,
          requestId: streamRequest.metadata?.requestId,
        }),
        index: 0,
      }
      return
    }

    let index = 0
    try {
      for await (const event of provider.stream(providerReq)) {
        if (!event || typeof event !== 'object') {
          yield {
            type: 'error',
            error: createWriterError({
              code: 'malformed_response',
              message: 'Malformed stream event',
              retryable: true,
              providerId: provider.id,
              requestId: streamRequest.metadata?.requestId,
            }),
            index: index++,
          }
          return
        }
        if (event.type === 'delta') {
          yield {
            type: 'delta',
            textDelta: asString(event.textDelta),
            index: index++,
          }
          continue
        }
        if (event.type === 'usage') {
          yield {
            type: 'usage',
            usage: event.usage || {},
            index: index++,
          }
          continue
        }
        if (event.type === 'error') {
          const error = isWriterError(event.error)
            ? event.error
            : createWriterError({
                code: 'internal',
                message: 'Stream error',
                retryable: false,
                providerId: provider.id,
              })
          yield { type: 'error', error, index: index++ }
          return
        }
        if (event.type === 'done') {
          yield {
            type: 'done',
            finishReason: event.finishReason || 'stop',
            usage: event.usage || {},
            index: index++,
          }
          return
        }
      }
      // Stream ended without done/error
      yield {
        type: 'error',
        error: createWriterError({
          code: 'malformed_response',
          message: 'Stream ended without done event',
          retryable: true,
          providerId: provider.id,
          requestId: streamRequest.metadata?.requestId,
        }),
        index: index++,
      }
    } catch (err) {
      yield {
        type: 'error',
        error: normalizeThrown(err, provider, streamRequest),
        index: index++,
      }
    }
  }

  return {
    version: WRITER_VERSION,
    write,
    writeStream,
    /** @deprecated internal test helper */
    _assembleInstructions: assembleInstructions,
    _formatPlanForWriter: formatPlanForWriter,
    _cleanDraft: cleanDraft,
    _cleanDraftDetailed: cleanDraftDetailed,
    _classifyDraftSentence: classifyDraftSentence,
    _looksLikeGenericChatbot: looksLikeGenericChatbot,
    _pickMinimalAck: pickMinimalAck,
    _enforceReplyGrounding: enforceReplyGrounding,
    _enforceReplyGroundingDetailed: enforceReplyGroundingDetailed,
    _recoverPresence: recoverPresence,
    _finalizeWriterText: finalizeWriterText,
  }
}

/**
 * Collect a writeStream into final text + terminal chunk.
 * @param {AsyncIterable<StreamingChunk>} stream
 * @returns {Promise<{ text: string, terminal: StreamingChunk, chunks: StreamingChunk[] }>}
 */
export async function collectStream(stream) {
  /** @type {StreamingChunk[]} */
  const chunks = []
  let text = ''
  /** @type {StreamingChunk | null} */
  let terminal = null
  for await (const chunk of stream) {
    chunks.push(chunk)
    if (chunk.type === 'delta' && chunk.textDelta) text += chunk.textDelta
    if (chunk.type === 'done' || chunk.type === 'error') terminal = chunk
  }
  if (!terminal) {
    terminal = {
      type: 'error',
      error: createWriterError({
        code: 'malformed_response',
        message: 'No terminal stream event',
        retryable: true,
      }),
    }
  }
  return { text, terminal, chunks }
}
