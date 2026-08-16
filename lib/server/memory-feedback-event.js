/**
 * Public Memory feedback event for chat UI (#281).
 * Maps pipeline write stats → calm client toast payload.
 * Never expose ids, fact_key, confidence, importance, tags, or status internals.
 */

/** @typedef {'created' | 'updated' | 'removed'} MemoryFeedbackType */

/**
 * @typedef {{ type: MemoryFeedbackType, displayText?: string }} MemoryFeedbackEvent
 */

const DISPLAY_TEXT_MAX = 72

/**
 * Strip internal / unsafe fragments from a candidate gloss.
 * @param {unknown} raw
 * @returns {string}
 */
function cleanCandidate(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when text looks like internal Memory metadata rather than a user gloss.
 * @param {string} text
 */
function looksInternal(text) {
  if (!text) return true
  if (text.length > DISPLAY_TEXT_MAX) return true
  // UUIDs / ids
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
    return true
  }
  // fact_key-like dotted paths
  if (
    /\b(preferences|identity|projects|settings|habits|events|profession|interest)\.[a-z0-9_.-]+/i.test(
      text,
    )
  ) {
    return true
  }
  // Explicit internal field names
  if (
    /\b(fact[_-]?key|confidence|importance|usage[_-]?count|user[_-]?id|memory[_-]?id|tags?|status)\b/i.test(
      text,
    )
  ) {
    return true
  }
  // JSON / DB-ish dumps
  if (/[{}\[\]|]/.test(text) || /:\s*(true|false|null|\d+(\.\d+)?)\s*$/i.test(text)) {
    return true
  }
  return false
}

/**
 * Prefer a short value after a canonical "Label: value." gloss.
 * @param {string} content
 */
function valueFromCanonicalGloss(content) {
  const m = content.match(/^[^:]{2,48}:\s*(.+)$/)
  if (!m) return ''
  return cleanCandidate(m[1]).replace(/[.。]+$/, '')
}

/**
 * Safe optional detail for the toast. Omit when ambiguous.
 * @param {unknown} memory
 * @returns {string | undefined}
 */
export function safeMemoryDisplayText(memory) {
  if (!memory || typeof memory !== 'object') return undefined

  const row = /** @type {Record<string, unknown>} */ (memory)
  // Never read id / factKey / tags / confidence / importance into the gloss path.
  const title = cleanCandidate(row.title)
  const content = cleanCandidate(row.content)

  /** @type {string[]} */
  const candidates = []

  if (content) {
    const fromGloss = valueFromCanonicalGloss(content)
    if (fromGloss) candidates.push(fromGloss)
    // Short plain content without metadata labels
    if (content.length <= DISPLAY_TEXT_MAX && !content.includes(':')) {
      candidates.push(content.replace(/[.。]+$/, ''))
    }
  }

  // Short human title (e.g. "Primary project") — only if content value missing
  if (title && title.length <= 40 && !/^[a-z0-9_.-]+$/i.test(title)) {
    candidates.push(title)
  }

  for (const c of candidates) {
    const text = cleanCandidate(c)
    if (!text || looksInternal(text)) continue
    if (text.length < 2) continue
    return text.length > DISPLAY_TEXT_MAX ? `${text.slice(0, DISPLAY_TEXT_MAX - 1)}…` : text
  }

  return undefined
}

/**
 * Map runMemoryPipeline result → public memoryEvent.
 * @param {unknown} result
 * @returns {MemoryFeedbackEvent | null}
 */
export function mapMemoryPipelineToFeedbackEvent(result) {
  if (!result || typeof result !== 'object') return null

  const r = /** @type {Record<string, unknown>} */ (result)
  const stats =
    r.stats && typeof r.stats === 'object'
      ? /** @type {Record<string, unknown>} */ (r.stats)
      : null

  const created = Number(stats?.created) || 0
  const updated = Number(stats?.updated) || 0
  const revoked = Number(stats?.revoked) || 0
  const replaced = Number(stats?.replaced) || 0

  // Prefer explicit stats; fall back to coarse flags if stats absent.
  const hasUpdated = updated > 0 || r.updated === true
  const hasReplaced = replaced > 0 || r.replaced === true
  const hasCreated = created > 0
  const hasRevoked = revoked > 0 || r.revoked === true

  /** @type {MemoryFeedbackType | null} */
  let type = null

  if (hasUpdated || hasReplaced) {
    // Corrections, successor updates, replace_set, mixed create+update → updated
    type = 'updated'
  } else if (hasCreated && !hasRevoked) {
    type = 'created'
  } else if (hasCreated && hasRevoked) {
    // Mixed create + revoke without an update row — calm "updated" rather than mislabel "saved"
    type = 'updated'
  } else if (hasRevoked) {
    type = 'removed'
  } else {
    return null
  }

  // Never claim created when nothing was written (legacy saved included revoke/replace).
  if (type === 'created' && created === 0 && stats) {
    return null
  }

  const displayText = safeMemoryDisplayText(r.memory)
  /** @type {MemoryFeedbackEvent} */
  const event = { type }
  if (displayText) event.displayText = displayText
  return event
}
