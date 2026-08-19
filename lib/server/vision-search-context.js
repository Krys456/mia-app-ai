/**
 * #312 — Bounded Vision context for visual Search (no second image analysis).
 * Derives only from existing chat messages (captions + assistant text).
 * Never includes image bytes / data URLs.
 */

/**
 * @typedef {{
 *   type: 'vision_context'
 *   summary: string
 *   entities: string[]
 *   visibleText: string
 *   confidence: 'high' | 'medium' | 'low' | 'unknown'
 *   sourceTurnId: string | null
 *   userCaption: string
 *   assistantReply: string
 *   uncertain: boolean
 * }} VisionSearchContext
 */

/**
 * @param {unknown} text
 */
export function normalizeVisionSearchText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {unknown} msg
 */
function messageHasImage(msg) {
  if (!msg || typeof msg !== 'object') return false
  const atts = /** @type {{ attachments?: unknown }} */ (msg).attachments
  if (!Array.isArray(atts)) return false
  return atts.some((a) => a && typeof a === 'object' && a.type === 'image')
}

/**
 * Heuristic uncertainty from Vision assistant prose.
 * @param {string} text
 */
export function detectVisionUncertainty(text) {
  const t = normalizeVisionSearchText(text).toLowerCase()
  if (!t) return { uncertain: true, confidence: /** @type {'unknown'} */ ('unknown') }
  if (
    /\b(non\s+(ne\s+)?sono\s+sicur|non\s+sono\s+cert|potrebbe\s+essere|sembra\s+(essere\s+)?|probabilmente|non\s+riesco\s+a\s+(identificar|capire)|incerto|non\s+chiaro)\b/.test(
      t,
    ) ||
    /\b(might\s+be|could\s+be|looks\s+like|appears\s+to\s+be|probably|not\s+sure|uncertain|i'?m\s+not\s+certain|possibly)\b/.test(
      t,
    )
  ) {
    return { uncertain: true, confidence: /** @type {'low'} */ ('low') }
  }
  if (/\b(sembra|appare|likely|seems)\b/.test(t)) {
    return { uncertain: true, confidence: /** @type {'medium'} */ ('medium') }
  }
  return { uncertain: false, confidence: /** @type {'high'} */ ('high') }
}

/**
 * Extract short entity-like phrases (brands/models/landmarks) from text — conservative.
 * @param {string} text
 * @returns {string[]}
 */
export function extractVisionEntities(text) {
  const raw = normalizeVisionSearchText(text)
  if (!raw) return []
  /** @type {string[]} */
  const out = []
  // Capitalized multi-token / model codes (ASCII-ish)
  const modelRe = /\b([A-Z][A-Za-z0-9]*(?:[- ][A-Z0-9][A-Za-z0-9]*){0,4})\b/g
  let m
  while ((m = modelRe.exec(raw)) && out.length < 6) {
    const v = m[1].trim()
    if (v.length < 3 || v.length > 48) continue
    // Skip common sentence starters
    if (/^(The|This|That|It|A|An|I|Sono|Questo|Questa|Sembra|Probabilmente|Vedo|Vedo|See|Looks)$/i.test(v)) continue
    if (!out.includes(v)) out.push(v)
  }
  // Italian/English quoted candidates
  const quoted = raw.match(/[«"']([^«"']{3,48})[»"']/g)
  if (quoted) {
    for (const q of quoted.slice(0, 3)) {
      const inner = q.replace(/^[«"']|[»"']$/g, '').trim()
      if (inner && !out.includes(inner)) out.push(inner)
    }
  }
  return out.slice(0, 6)
}

/**
 * Visible text hints (OCR-like mentions in Vision reply / caption).
 * @param {string} text
 */
export function extractVisibleTextHint(text) {
  const t = normalizeVisionSearchText(text)
  if (!t) return ''
  const m =
    t.match(/(?:testo|scritta|label|legge|leggevo|reads?|says?|visible text)[:\s]+[«"']?([^«"'.\n]{3,80})/i) ||
    t.match(/\b(modello|model|brand|marca)\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9\- ]{1,40})/i)
  if (!m) return ''
  return (m[2] || m[1] || '').trim().slice(0, 80)
}

/**
 * Find the most recent Vision turn: user message with image (+ following assistant).
 * Scans newest-first. Does not reuse unrelated older turns when a newer text-only
 * conversation has moved on beyond the image history window — caller should pass
 * the same history Core uses.
 *
 * @param {Array<{ role?: string, content?: string, id?: string, attachments?: unknown }> | null | undefined} messages
 * @returns {VisionSearchContext | null}
 */
/** Max distance (message count) from thread end for a Vision turn to stay "recent". */
export const VISION_SEARCH_CONTEXT_WINDOW = 12

export function selectLatestVisionSearchContext(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null

  let imageUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role === 'user' && messageHasImage(msg)) {
      imageUserIdx = i
      break
    }
  }
  if (imageUserIdx < 0) return null
  // Do not reuse a stale Vision turn buried under a long unrelated text thread.
  if (messages.length - 1 - imageUserIdx > VISION_SEARCH_CONTEXT_WINDOW) return null

  const userMsg = messages[imageUserIdx]
  const userCaption =
    typeof userMsg.content === 'string' ? normalizeVisionSearchText(userMsg.content) : ''

  let assistantReply = ''
  let sourceTurnId = typeof userMsg.id === 'string' ? userMsg.id : null
  for (let j = imageUserIdx + 1; j < messages.length; j += 1) {
    const msg = messages[j]
    if (msg?.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
      assistantReply = normalizeVisionSearchText(msg.content)
      if (typeof msg.id === 'string') sourceTurnId = msg.id
      break
    }
    // Stop if another user turn intervenes without an assistant reply
    if (msg?.role === 'user') break
  }

  const basis = assistantReply || userCaption
  if (!basis) return null

  const { uncertain, confidence } = detectVisionUncertainty(assistantReply || userCaption)
  const entities = extractVisionEntities(basis)
  const visibleText = extractVisibleTextHint(basis)

  const summary =
    assistantReply.length > 280
      ? `${assistantReply.slice(0, 279)}…`
      : assistantReply || userCaption.slice(0, 280)

  return {
    type: /** @type {'vision_context'} */ ('vision_context'),
    summary,
    entities,
    visibleText,
    confidence,
    sourceTurnId,
    userCaption: userCaption.slice(0, 200),
    assistantReply: assistantReply.slice(0, 600),
    uncertain,
  }
}

/**
 * True when history still has a usable Vision image turn.
 * @param {unknown} messages
 */
export function hasRecentVisionContext(messages) {
  return Boolean(selectLatestVisionSearchContext(/** @type {any} */ (messages)))
}
