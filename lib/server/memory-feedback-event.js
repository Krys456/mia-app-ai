/**
 * Public Memory feedback event for chat UI (#281).
 * Maps pipeline write outcomes → user-visible created|updated|removed.
 * Prefer the user-visible operation over lowest-level DB counters.
 */

/** @typedef {'created' | 'updated' | 'removed'} MemoryFeedbackType */

/**
 * @typedef {{ type: MemoryFeedbackType, displayText?: string }} MemoryFeedbackEvent
 */

const DISPLAY_TEXT_MAX = 72

/**
 * @param {unknown} raw
 * @returns {string}
 */
function cleanCandidate(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 */
function looksInternal(text) {
  if (!text) return true
  if (text.length > DISPLAY_TEXT_MAX) return true
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
    return true
  }
  if (
    /\b(preferences|identity|projects|settings|habits|events|profession|interest)\.[a-z0-9_.-]+/i.test(
      text,
    )
  ) {
    return true
  }
  if (
    /\b(fact[_-]?key|confidence|importance|usage[_-]?count|user[_-]?id|memory[_-]?id|tags?|status)\b/i.test(
      text,
    )
  ) {
    return true
  }
  if (/[{}\[\]|]/.test(text) || /:\s*(true|false|null|\d+(\.\d+)?)\s*$/i.test(text)) {
    return true
  }
  return false
}

/**
 * @param {string} content
 */
function valueFromCanonicalGloss(content) {
  const m = content.match(/^[^:]{2,48}:\s*(.+)$/)
  if (!m) return ''
  return cleanCandidate(m[1]).replace(/[.。]+$/, '')
}

/**
 * @param {unknown} memory
 * @returns {string | undefined}
 */
export function safeMemoryDisplayText(memory) {
  if (!memory || typeof memory !== 'object') return undefined

  const row = /** @type {Record<string, unknown>} */ (memory)
  const title = cleanCandidate(row.title)
  const content = cleanCandidate(row.content)

  /** @type {string[]} */
  const candidates = []

  if (content) {
    const fromGloss = valueFromCanonicalGloss(content)
    if (fromGloss) candidates.push(fromGloss)
    if (content.length <= DISPLAY_TEXT_MAX && !content.includes(':')) {
      candidates.push(content.replace(/[.。]+$/, ''))
    }
  }

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
 * User-visible Memory feedback from runMemoryPipeline result.
 *
 * Semantics (not raw DB ops):
 * - update / replace_set / revoke+create successor → updated
 * - pure create(s) → created
 * - pure revoke → removed
 * - skip / no-op → null
 *
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

  const hasUpdated = updated > 0 || r.updated === true
  const hasReplaced = replaced > 0 || r.replaced === true
  const hasCreated = created > 0
  const hasRevoked = revoked > 0 || r.revoked === true

  /** @type {MemoryFeedbackType | null} */
  let type = null

  // User-visible correction / replacement always wins over raw create counters.
  if (hasUpdated || hasReplaced || (hasCreated && hasRevoked)) {
    type = 'updated'
  } else if (hasCreated) {
    type = 'created'
  } else if (hasRevoked) {
    type = 'removed'
  } else {
    return null
  }

  // Never claim created when stats prove zero writes.
  if (type === 'created' && stats && created === 0) {
    return null
  }

  const displayText = safeMemoryDisplayText(r.memory)
  /** @type {MemoryFeedbackEvent} */
  const event = { type }
  if (displayText) event.displayText = displayText
  return event
}
