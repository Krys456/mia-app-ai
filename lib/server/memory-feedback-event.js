/**
 * Public Memory feedback event for chat UI (#281).
 * Maps pipeline write outcomes → user-visible created|updated|removed.
 * Prefer the user-visible operation over lowest-level DB counters.
 *
 * Created vs updated (favorite/cofavorite):
 * - Adding a new cofavorite member (new row) → created
 * - Replacing a single-valued favorite / replace_set / revoke+create → updated
 * - Revoking a member or slot → removed
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
 * Strip additive framing so display glosses stay canonical (viola, not "Anche il viola").
 * @param {string} value
 */
export function stripAdditiveFraming(value) {
  return cleanCandidate(value)
    .replace(
      /^(?:anche|also|pure|troppo|too|oltre(?:\s+a)?|besides|in\s+addition(?:\s+to)?|uno\s+dei\s+miei|one\s+of\s+my)\s+/iu,
      '',
    )
    .replace(/^(?:il|lo|la|l'|i|gli|le|un|una|uno|the|a|an)\s+/iu, '')
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
  return stripAdditiveFraming(cleanCandidate(m[1]).replace(/[.。]+$/, ''))
}

/**
 * English subject gloss for favorite/cofavorite (client localizes).
 * @param {string} subject
 */
function favoriteSubjectLabel(subject) {
  const s = String(subject || '').toLowerCase()
  const map = {
    color: 'Favorite color',
    colour: 'Favorite color',
    food: 'Favorite food',
    character: 'Favorite character',
    anime: 'Favorite anime',
    sport: 'Favorite sport',
    sports: 'Favorite sport',
    film: 'Favorite film',
    movie: 'Favorite movie',
    book: 'Favorite book',
    team: 'Favorite team',
    animal: 'Favorite animal',
    game: 'Favorite game',
    music: 'Favorite music',
    artist: 'Favorite artist',
  }
  return map[s] || `Favorite ${s}`
}

/**
 * @param {unknown} tags
 * @returns {string}
 */
function factKeyFromMemory(memory) {
  if (!memory || typeof memory !== 'object') return ''
  const row = /** @type {Record<string, unknown>} */ (memory)
  if (typeof row.factKey === 'string' && row.factKey.trim()) return row.factKey.trim()
  if (typeof row.fact_key === 'string' && row.fact_key.trim()) return row.fact_key.trim()
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : []
  for (const tag of tags) {
    const m = String(tag).match(/^fact_key:(.+)$/i)
    if (m?.[1]) return m[1].trim()
  }
  return ''
}

/**
 * Build a short user-facing gloss from durable memory content.
 * Prefer normalized favorite/cofavorite values — never raw additive fragments.
 *
 * @param {unknown} memory
 * @returns {string | undefined}
 */
export function safeMemoryDisplayText(memory) {
  if (!memory || typeof memory !== 'object') return undefined

  const row = /** @type {Record<string, unknown>} */ (memory)
  const title = cleanCandidate(row.title)
  const content = cleanCandidate(row.content)
  const factKey = factKeyFromMemory(row)

  const cofavoriteMatch = factKey.match(/^preferences\.cofavorite\.([^.]+)\.(.+)$/i)
  if (cofavoriteMatch) {
    const subject = cofavoriteMatch[1]
    const value = stripAdditiveFraming(cofavoriteMatch[2].replace(/_/g, ' '))
    if (value.length >= 2 && !looksInternal(value)) {
      const text = `${favoriteSubjectLabel(subject)}: ${value}`
      return text.length > DISPLAY_TEXT_MAX ? `${text.slice(0, DISPLAY_TEXT_MAX - 1)}…` : text
    }
  }

  const favoriteMatch = factKey.match(/^preferences\.favorite\.(.+)$/i)
  if (favoriteMatch) {
    const subject = favoriteMatch[1]
    const fromContent = valueFromCanonicalGloss(content)
    const value = fromContent || stripAdditiveFraming(content.replace(/^favorite\s+[^=]+=\s*/i, ''))
    if (value.length >= 2 && !looksInternal(value) && !/^(anche|also|pure)\b/i.test(value)) {
      const text = `${favoriteSubjectLabel(subject)}: ${value}`
      return text.length > DISPLAY_TEXT_MAX ? `${text.slice(0, DISPLAY_TEXT_MAX - 1)}…` : text
    }
  }

  if (
    factKey === 'work.primary_project' ||
    factKey === 'projects.primary' ||
    /^primary[_ ]project\s*=/i.test(content) ||
    /^user'?s\s+primary\s+project:/i.test(content)
  ) {
    const value =
      valueFromCanonicalGloss(content) ||
      cleanCandidate(content.replace(/^primary[_ ]project\s*=\s*/i, '')).replace(/[.。]+$/, '')
    if (value.length >= 2 && !looksInternal(value)) {
      const text = `Primary project: ${value}`
      return text.length > DISPLAY_TEXT_MAX ? `${text.slice(0, DISPLAY_TEXT_MAX - 1)}…` : text
    }
  }

  // Content shaped like "User's favorite color: viola"
  const favoriteContent = content.match(
    /^user'?s\s+favorite\s+([a-z][\w-]{1,40})\s*:\s*(.+)$/i,
  )
  if (favoriteContent) {
    const value = stripAdditiveFraming(favoriteContent[2].replace(/[.。]+$/, ''))
    if (value.length >= 2 && !/^(anche|also|pure)\b/i.test(value)) {
      const text = `${favoriteSubjectLabel(favoriteContent[1])}: ${value}`
      return text.length > DISPLAY_TEXT_MAX ? `${text.slice(0, DISPLAY_TEXT_MAX - 1)}…` : text
    }
  }

  /** @type {string[]} */
  const candidates = []

  if (content) {
    // Reject raw additive capture fragments ("Anche il viola") — they are not
    // durable glosses. Structured favorite/cofavorite paths above already ran.
    if (/^(anche|also|pure|oltre)\b/i.test(content)) {
      return undefined
    }
    const fromGloss = valueFromCanonicalGloss(content)
    if (fromGloss && !/^(anche|also|pure)\b/i.test(fromGloss)) candidates.push(fromGloss)
    if (content.length <= DISPLAY_TEXT_MAX && !content.includes(':')) {
      const plain = stripAdditiveFraming(content.replace(/[.。]+$/, ''))
      if (plain && !/^(anche|also|pure)\b/i.test(plain)) candidates.push(plain)
    }
  }

  if (title && title.length <= 40 && !/^[a-z0-9_.-]+$/i.test(title)) {
    candidates.push(title)
  }

  for (const c of candidates) {
    const text = cleanCandidate(c)
    if (!text || looksInternal(text)) continue
    if (text.length < 2) continue
    if (/^(anche|also|pure)\b/i.test(text)) continue
    return text.length > DISPLAY_TEXT_MAX ? `${text.slice(0, DISPLAY_TEXT_MAX - 1)}…` : text
  }

  return undefined
}

/**
 * User-visible Memory feedback from runMemoryPipeline result.
 *
 * Semantics (not raw DB ops):
 * - update / replace_set / revoke+create successor → updated
 * - pure create(s) → created (includes adding a new cofavorite member)
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
