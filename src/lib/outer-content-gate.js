/**
 * #330A3 — CONTENT IS NOT AUTHORIZATION
 *
 * Shared deterministic outer-content gate for local/capability routers.
 * Decides whether the user is directly requesting an action, or discussing /
 * pasting / analyzing content that merely contains capability-like phrases.
 *
 * No LLM, no network, no persistent state, no Core schema.
 */

/** Max chars scanned for framing / document signals (perf on huge pastes). */
const SCAN_LIMIT = 12000

/**
 * Outer frames whose purpose is a capability (body is the operand, not "data to discuss").
 * Example: "Traduci questo:\nHello" / "Calcola questo:\n2+2"
 */
const CAPABILITY_OUTER_FRAME_RE =
  /^(traduci(?:lo|la)?|translate(?:\s+this|\s+that)?|come\s+si\s+dice|how\s+do\s+you\s+say|calcola(?:lo)?|calculate|compute|converti(?:lo)?|convert(?:\s+this)?|quanto\s+fa|what(?:'?s|\s+is)|apri|open|chiama|call|timer|imposta(?:\s+un)?\s+timer|set(?:\s+a)?\s+timer|fammi\s+il\s+briefing|briefing|che\s+tempo|weather|portami|naviga|navigate)\b/i

/**
 * Outer frames that mark the following body as DATA to explain/review/test/discuss.
 * Small closed set — not a synonym blacklist.
 * Prefer "questo/this" objects so "Riassumimi la giornata" / "Summarize my day" stay direct.
 */
const DATA_FRAME_RE =
  /^(spiegami(?:\s+questo|\s+perch[eé]|\s+come|\s+il\s+prompt|\s+il\s+testo)?|spiega(?:mi)?\s+questo|explain(?:\s+this|\s+why|\s+how|\s+the\s+prompt)?|analizza(?:\s+questo)?|analyze(?:\s+this)?|analyse(?:\s+this)?|controlla(?:\s+questo)?|check(?:\s+this)|review(?:\s+this(?:\s+prompt)?)?|riassumi(?:mi)?\s+questo|summarize\s+this|dimmi\s+cosa\s+significa|cosa\s+significa(?:\s+questo)?|what\s+does\s+this\s+mean|ti\s+incollo|i(?:'?m|\s+am)\s+pasting|questo\s+(?:e|è)\s+un\s+(?:prompt|test|esempio)|questo\s+prompt\s+contiene|questo\s+testo\s+contiene|this\s+prompt\s+contains|this\s+text\s+contains|this\s+test\s+contains|the\s+(?:test|documentation|docs?|prompt)\s+(?:contains|says|includes)|nel\s+test(?:\s+(?:c['']?e|uso))?|sto\s+testando|nel\s+codice(?:\s+c['']?e)?|in\s+(?:this\s+)?code|guarda\s+questo|correggi\s+questo|debugga(?:\s+questo)?|debug(?:\s+this)?|fix(?:\s+this)?|documenta|i(?:'?m|\s+am)\s+testing|il\s+prompt\s+contiene)\b/i

const DOC_BODY_MARKER_RE =
  /\b(expected(?:\s+result)?|also\s+test|requirements?|acceptance|test\s+plan|regression|verif(?:y|ica)|matrice|matrix|do\s+not\s+merge|preview\s+manual|implementation\s+task|root\s+cause|blocker|local_exchange|maxrawlength|detectphoneactionintent|openai\s+call)\b/i

const ACTIONISH_LINE_RE =
  /^(chiama|call|apri|open|portami|naviga|navigate|scrivi|manda|invia|text|send|traduci|translate|timer|imposta|set\s+a?\s*timer|fammi\s+il\s+briefing|briefing|che\s+tempo|weather|quanto\s+fa|calcola|calculate|converti|convert|don'?t\s+call|non\s+chiam)/i

/**
 * @param {string} raw
 */
function foldLite(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function nonEmptyLines(raw) {
  return String(raw || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/**
 * @param {string} firstLine
 * @returns {'explain'|'analyze'|'review'|'test'|'summarize'|'debug'|'paste'|'capability'|'none'}
 */
export function classifyOuterFrame(firstLine) {
  const s = foldLite(firstLine).toLowerCase()
  if (!s) return 'none'
  if (CAPABILITY_OUTER_FRAME_RE.test(s)) return 'capability'
  if (!DATA_FRAME_RE.test(s)) return 'none'
  if (/^(spiegami|spiega|explain|analizza|analyze|analyse)/i.test(s)) return 'explain'
  if (/^(review|controlla|check|guarda|correggi|fix)/i.test(s)) return 'review'
  if (/^(riassumi(?:mi)?\s+questo|summarize\s+this)/i.test(s)) return 'summarize'
  if (/^(debugga|debug)/i.test(s)) return 'debug'
  if (/^(ti\s+incollo|i(?:'?m|\s+am)\s+pasting)/i.test(s)) return 'paste'
  if (
    /\b(test|prompt\s+contiene|text\s+contains|documentation|nel\s+codice|in\s+this\s+code|sto\s+testando|i(?:'?m|\s+am)\s+testing)\b/i.test(
      s,
    )
  ) {
    return 'test'
  }
  return 'explain'
}

/**
 * Document / test-matrix shape: body after a short command looks like specs, not a softener.
 * @param {string} raw
 * @param {string[]} lines
 */
export function looksDocumentLike(raw, lines) {
  const list = lines || nonEmptyLines(raw)
  if (list.length < 2) return false

  const scanned = String(raw || '').slice(0, SCAN_LIMIT)
  const body = list.slice(1).join('\n')
  const fullLen = scanned.length

  if (DOC_BODY_MARKER_RE.test(body) || DOC_BODY_MARKER_RE.test(scanned)) return true

  const headingCount = (scanned.match(/^#{1,6}\s+/gm) || []).length
  if (headingCount >= 1 && list.length >= 3) return true

  const actionish = list.filter((l) => ACTIONISH_LINE_RE.test(l)).length
  if (actionish >= 2 && list.length >= 3) return true

  // Long multi-section paste (implementation prompts, QA matrices)
  if (list.length >= 4 && fullLen >= 280) return true
  if (list.length >= 3 && fullLen >= 500) return true

  // First line is imperative but rest is clearly instructional prose
  if (
    ACTIONISH_LINE_RE.test(list[0]) &&
    list.length >= 3 &&
    /\b(expected|should|must|verif|test|example|esempio|requirements?)\b/i.test(body)
  ) {
    return true
  }

  return false
}

/**
 * True when framing marks following content as data to discuss.
 * Capability frames (Traduci questo / Calcola questo) do NOT set this.
 * @param {string} raw
 * @param {string[]} lines
 */
export function hasDataFraming(raw, lines) {
  const list = lines || nonEmptyLines(raw)
  if (!list.length) return false
  const first = list[0]
  const frame = classifyOuterFrame(first)
  if (frame === 'none' || frame === 'capability') return false

  // Framing + body (newline or colon-separated remainder)
  if (list.length >= 2) return true
  if (/:\s*\S/.test(first)) {
    // Single line "Spiegami questo: Call +39…" — body after colon is data
    const afterColon = first.split(/:\s*/).slice(1).join(':').trim()
    if (afterColon.length >= 2) return true
  }
  // Bare instructional frame alone ("Spiegami questo prompt.") — data mode.
  // Do NOT treat "Riassumimi la giornata" / "Summarize my day" as data frames.
  if (
    /^(spiegami(?:\s+questo|\s+il\s+prompt|\s+il\s+testo)?|explain(?:\s+this)?|analizza(?:\s+questo)?|analyze(?:\s+this)?|review(?:\s+this)?|riassumi(?:mi)?\s+questo|summarize\s+this)\b/i.test(
      first,
    )
  ) {
    return true
  }
  return false
}

/**
 * Analyze whether local routers may treat this utterance as a direct capability request.
 *
 * @param {string} raw
 * @returns {{
 *   contentIsData: boolean,
 *   outerSurface: string,
 *   outerFrame: string,
 *   outerContentMode: 'direct'|'data_framed'|'document_like',
 *   localRoutersSuppressed: boolean,
 *   reason: string|null
 * }}
 */
export function analyzeOuterUserRequest(raw) {
  const original = String(raw || '')
  const trimmed = original.trim()
  if (!trimmed) {
    return {
      contentIsData: false,
      outerSurface: '',
      outerFrame: 'none',
      outerContentMode: 'direct',
      localRoutersSuppressed: false,
      reason: 'empty',
    }
  }

  const scan = trimmed.length > SCAN_LIMIT ? trimmed.slice(0, SCAN_LIMIT) : trimmed
  const lines = nonEmptyLines(scan)
  const first = lines[0] || scan
  const outerFrame = classifyOuterFrame(first)

  if (hasDataFraming(scan, lines)) {
    return {
      contentIsData: true,
      outerSurface: first,
      outerFrame,
      outerContentMode: 'data_framed',
      localRoutersSuppressed: true,
      reason: 'data_frame',
    }
  }

  if (looksDocumentLike(scan, lines)) {
    return {
      contentIsData: true,
      outerSurface: first,
      outerFrame: outerFrame === 'capability' ? 'none' : outerFrame,
      outerContentMode: 'document_like',
      localRoutersSuppressed: true,
      reason: 'document_like',
    }
  }

  return {
    contentIsData: false,
    outerSurface: first,
    outerFrame: outerFrame === 'capability' ? 'capability' : 'none',
    outerContentMode: 'direct',
    localRoutersSuppressed: false,
    reason: null,
  }
}

/**
 * Convenience for router detectors.
 * @param {string} raw
 */
export function shouldSuppressLocalRouters(raw) {
  return analyzeOuterUserRequest(raw).localRoutersSuppressed
}
