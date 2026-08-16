/**
 * Memory Recall V1 — ephemeral context pack for the live single-shot Core.
 *
 * Soft-fail: never throws into chat. Requires verified auth.uid() — never
 * brain-api@local. Does not edit the compact companion system prompt.
 *
 * Memory 2.1 PR1: durable-memory provenance + empty-durable signal for
 * personal memory probes (ephemeral appendix only).
 *
 * Memory 2.1 Semantic Recall: deterministic query-intent + Recall-only
 * fact_key-aware reranking (does not modify Specific Forget scoring).
 */

import {
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  searchMemories,
  slugifyFactKeyPart,
} from './brain-memory.js'

/** Prefer high-value conversational categories for Recall V1. */
export const RECALL_PREFERRED_CATEGORIES = new Set([
  'identity',
  'preferences',
  'projects',
  'goals',
  'relationships',
  'skills',
  // legacy aliases still present in some rows
  'tastes',
  'profession',
])

export const RECALL_MAX_MEMORIES = 3
/** Candidate pool fetched before semantic rerank (still capped by search max). */
export const RECALL_CANDIDATE_LIMIT = 6
/**
 * Recall-only category cap for the *candidate pool* (not the final pack).
 * Must be ≥ 3 so three cofavorites survive when a like/interest also scores;
 * final pack is still trimmed to RECALL_MAX_MEMORIES after rerank.
 * Shared default MAX_PER_CATEGORY=2 is unchanged for non-Recall callers.
 */
export const RECALL_MAX_PER_CATEGORY = 6
export const RECALL_MAX_PACK_CHARS = 600
export const RECALL_MAX_LINE_CHARS = 160

export const EMPTY_DURABLE_MEMORY_RESULT_LINE =
  'DURABLE MEMORY RESULT: no relevant persisted Memory 2.0 fact was found for this question.'

/** Tiny WH tokens absorbed by intent parsing — not used as subjects. */
export const RECALL_INTERROGATIVE_TOKENS = new Set([
  'chi',
  'cosa',
  'quale',
  'quali',
  'qual',
  'who',
  'what',
  'which',
])

/**
 * @typedef {{
 *   domain: 'preferences'|'projects'|'identity'|'relationships'|'skills'|'goals'|'habits'|null,
 *   subtype: 'favorite'|'cofavorite'|'like'|'dislike'|'interest'|'project_primary'|'project_list'|null,
 *   subject: string|null,
 *   plurality: 'single'|'plural'|null,
 *   polarity: 'positive'|'negative'|null,
 * }} MemoryQueryIntent
 */

/**
 * @returns {MemoryQueryIntent}
 */
function emptyIntent() {
  return {
    domain: null,
    subtype: null,
    subject: null,
    plurality: null,
    polarity: null,
  }
}

/**
 * Deterministic Recall query intent (IT/EN). Narrow — only confirmed bugs.
 *
 * @param {string} message
 * @returns {MemoryQueryIntent}
 */
export function detectMemoryQueryIntent(message) {
  const raw = normalizeMemoryProbeText(message)
  if (!raw) return emptyIntent()

  /** @type {MemoryQueryIntent} */
  const intent = emptyIntent()

  // —— Negative preferences ——
  if (
    /\b(?:cosa|che\s+cosa)\s+non\s+mi\s+piace\b/i.test(raw) ||
    /\bnon\s+mi\s+piace\b/i.test(raw) ||
    /\b(?:what\s+(?:don'?t|do\s+not)\s+i\s+like|what\s+do\s+i\s+dislike|what\s+do\s+i\s+hate)\b/i.test(
      raw,
    ) ||
    /\bi\s+don'?t\s+like\b|\bi\s+dislike\b|\bi\s+hate\b/i.test(raw)
  ) {
    intent.domain = 'preferences'
    intent.subtype = 'dislike'
    intent.polarity = 'negative'
    return intent
  }

  // —— Project primary ——
  if (
    /\bprogetto\s+principale\b/i.test(raw) ||
    /\b(?:main|primary)\s+project\b/i.test(raw)
  ) {
    intent.domain = 'projects'
    intent.subtype = 'project_primary'
    intent.plurality = 'single'
    return intent
  }

  // —— Project list (incl. Italian plural progetti) ——
  if (
    /\b(?:miei|mie)\s+progetti\b/i.test(raw) ||
    /\bquali\s+progetti\b/i.test(raw) ||
    /\bprogetti\s+ho\b/i.test(raw) ||
    /\b(?:my\s+)?projects\b/i.test(raw) ||
    /\bwhat\s+are\s+my\s+projects\b/i.test(raw)
  ) {
    intent.domain = 'projects'
    intent.subtype = 'project_list'
    intent.plurality = 'plural'
    return intent
  }

  // —— Plural favorites / cofavorites ——
  const pluralIt =
    raw.match(
      /\b(?:quali|chi)\s+(?:sono\s+)?(?:i|le)\s+mi(?:ei|e)\s+([a-zàèéìòù][\wàèéìòù'-]{1,40})\s+preferit[iea]+\b/i,
    ) ||
    raw.match(
      /\bi\s+mi(?:ei|e)\s+([a-zàèéìòù][\wàèéìòù'-]{1,40})\s+preferit[iea]+\b/i,
    ) ||
    raw.match(
      /\bti\s+ricordi\s+quali\s+(?:sono\s+)?(?:i|le)\s+mi(?:ei|e)\s+([a-zàèéìòù][\wàèéìòù'-]{1,40})\s+preferit[iea]+\b/i,
    )
  const pluralEn =
    raw.match(/\b(?:what|who)\s+are\s+my\s+favorite\s+([a-z][\w'-]{1,40})\b/i) ||
    raw.match(/\bmy\s+favorite\s+([a-z][\w'-]{1,40})\b/i)

  if (pluralIt || (pluralEn && /\b(?:are|characters|colors|colours|animals|games|books|films|movies|series|artists)\b/i.test(raw))) {
    const subjectRaw = (pluralIt?.[1] || pluralEn?.[1] || '').trim()
    // "my favorite characters" — pluralEn may capture "characters"
    const subject = subjectRaw ? normalizeFavoriteSubjectKey(subjectRaw) : null
    // Guard: singular EN "what is my favorite X" handled below
    if (!/\bwhat\s+is\s+my\s+favorite\b/i.test(raw) && !/\bwho\s+is\s+my\s+favorite\b/i.test(raw)) {
      intent.domain = 'preferences'
      intent.subtype = 'cofavorite'
      intent.plurality = 'plural'
      intent.polarity = 'positive'
      intent.subject = subject
      return intent
    }
  }

  // Explicit EN plural favorites
  if (/\b(?:what|who)\s+are\s+my\s+favorite\b/i.test(raw)) {
    const m = raw.match(/\bfavorite\s+([a-z][\w'-]{1,40})\b/i)
    intent.domain = 'preferences'
    intent.subtype = 'cofavorite'
    intent.plurality = 'plural'
    intent.polarity = 'positive'
    intent.subject = m?.[1] ? normalizeFavoriteSubjectKey(m[1]) : null
    return intent
  }

  // —— Singular favorites ——
  const singularIt = raw.match(
    /\b(?:qual(?:e|'?\s*[eè]|'?è)?|chi)\s+(?:[eè]\s+)?(?:il|la)\s+mi(?:o|a)\s+([a-zàèéìòù][\wàèéìòù'-]{1,40})\s+preferit[oa]\b/i,
  )
  const singularEn =
    raw.match(/\b(?:what|who)\s+is\s+my\s+favorite\s+([a-z][\w'-]{1,40})\b/i) ||
    raw.match(/\bmy\s+favorite\s+([a-z][\w'-]{1,40})\b/i)

  if (singularIt || (singularEn && /\b(?:is|who\s+is|what\s+is)\b/i.test(raw))) {
    const subjectRaw = (singularIt?.[1] || singularEn?.[1] || '').trim()
    if (subjectRaw) {
      intent.domain = 'preferences'
      intent.subtype = 'favorite'
      intent.plurality = 'single'
      intent.polarity = 'positive'
      intent.subject = normalizeFavoriteSubjectKey(subjectRaw)
      return intent
    }
  }

  // —— Interest (before broad like — must not map to like) ——
  if (
    /^(?:cosa|che\s+cosa)\s+mi\s+interessa\b/i.test(raw) ||
    /\bquali\s+(?:sono\s+)?(?:i\s+)?mi(?:ei|e)\s+interessi\b/i.test(raw) ||
    /\b(?:ti\s+)?ricord(?:i|are)?\s+cosa\s+mi\s+interessa\b/i.test(raw) ||
    /\b(?:ti\s+)?ricord(?:i|are)?\s+quali\s+(?:sono\s+)?(?:i\s+)?mi(?:ei|e)\s+interessi\b/i.test(
      raw,
    ) ||
    /\bwhat\s+am\s+i\s+interested\s+in\b/i.test(raw) ||
    /\bwhat\s+are\s+my\s+interests\b/i.test(raw) ||
    /\b(?:do\s+you\s+)?remember\s+what\s+i(?:'m|\s+am)\s+interested\s+in\b/i.test(raw) ||
    /\b(?:do\s+you\s+)?remember\s+my\s+interests\b/i.test(raw)
  ) {
    intent.domain = 'preferences'
    intent.subtype = 'interest'
    intent.polarity = 'positive'
    intent.plurality = null
    return intent
  }

  // —— Broad positive preferences ——
  if (
    /^(?:cosa|che\s+cosa)\s+mi\s+piace\b/i.test(raw) ||
    /\bquali\s+cose\s+mi\s+piacciono\b/i.test(raw) ||
    /\bcosa\s+adoro\b/i.test(raw) ||
    /\bwhat\s+do\s+i\s+like\b/i.test(raw) ||
    /\bwhat\s+are\s+my\s+favorites?\b/i.test(raw) ||
    /\bquali\s+sono\s+i\s+miei\s+preferiti\b/i.test(raw)
  ) {
    intent.domain = 'preferences'
    intent.subtype = 'like'
    intent.polarity = 'positive'
    intent.plurality = null
    return intent
  }

  // Soft domain hints (no subtype) — identity / projects / preferences cues
  if (/\b(?:progetto|progetti|project|projects)\b/i.test(raw)) {
    intent.domain = 'projects'
  } else if (/\b(?:preferit|favorite|favourite|piace|like|interess)\b/i.test(raw)) {
    intent.domain = 'preferences'
    intent.polarity = 'positive'
  } else if (/\b(?:nome|name|chiamo)\b/i.test(raw)) {
    intent.domain = 'identity'
  }

  return intent
}

/**
 * @param {any} row
 * @returns {string|null}
 */
function rowFactKey(row) {
  if (typeof row?.factKey === 'string' && row.factKey.trim()) return row.factKey.trim()
  return readFactKeyFromTags(row?.tags)
}

/**
 * @param {string|null} factKey
 * @param {string} prefix
 */
function factKeyStarts(factKey, prefix) {
  return typeof factKey === 'string' && factKey.startsWith(prefix)
}

/**
 * Legacy / content inference for favorite subject (no fact_key).
 * @param {any} row
 * @param {string} subject
 */
function legacyFavoriteSubjectHit(row, subject) {
  const hay = `${row?.title || ''} ${row?.content || ''}`.toLowerCase()
  if (!hay) return false
  const subj = String(subject || '').toLowerCase()
  if (!subj) return false
  // Content glosses: "User's favorite anime:" / "User's favorite colore:"
  if (new RegExp(`\\bfavorite\\s+${subj}\\b`, 'i').test(hay)) return true
  // Italian surface still in gloss after #253
  const surfaces = {
    character: ['personaggio', 'personaggi', 'character', 'characters'],
    color: ['colore', 'colori', 'color', 'colors', 'colour'],
    animal: ['animale', 'animali', 'animal', 'animals'],
    anime: ['anime'],
    game: ['gioco', 'giochi', 'game', 'games'],
    film: ['film', 'movie', 'movies'],
    book: ['libro', 'libri', 'book', 'books'],
    series: ['serie', 'series'],
    artist: ['artista', 'artisti', 'artist', 'artists'],
    music: ['musica', 'music'],
  }
  const alts = surfaces[subj] || [subj]
  if (/\bfavorite\b|\bpreferit/i.test(hay) && alts.some((a) => hay.includes(a))) return true
  return false
}

/**
 * Semantic priority tier for Recall rerank (lower = better).
 * T1 exact subtype+subject · T2 legacy strong · T3 broader same-domain · T4 weak/noise
 *
 * @param {any} row
 * @param {MemoryQueryIntent} intent
 * @returns {number}
 */
export function semanticRecallTier(row, intent) {
  if (!intent || (!intent.domain && !intent.subtype && !intent.polarity)) {
    return 50
  }

  const factKey = rowFactKey(row)
  const category = String(row?.category || '')
    .trim()
    .toLowerCase()
  const hay = `${row?.title || ''} ${row?.content || ''}`.toLowerCase()
  const subject = intent.subject

  // —— Dislike / negative ——
  if (intent.subtype === 'dislike' || intent.polarity === 'negative') {
    if (factKeyStarts(factKey, 'preferences.dislike.')) return 1
    if (/\bdislikes?\b/i.test(hay) || /\bnon\s+mi\s+piace\b/i.test(hay)) return 2
    if (
      factKeyStarts(factKey, 'preferences.like.') ||
      factKeyStarts(factKey, 'preferences.interest.') ||
      factKeyStarts(factKey, 'preferences.favorite.') ||
      factKeyStarts(factKey, 'preferences.cofavorite.')
    ) {
      return 90
    }
    if (category === 'preferences') return 40
    return 80
  }

  // —— Project primary ——
  if (intent.subtype === 'project_primary') {
    if (factKey === 'projects.primary') return 1
    if (
      !factKey &&
      (/\bprimary\s+project\b/i.test(hay) || /\bprogetto\s+principale\b/i.test(hay) || /\bprimary\b/i.test(String(row?.title || '')))
    ) {
      return 2
    }
    if (factKeyStarts(factKey, 'projects.') || category === 'projects') return 30
    return 80
  }

  // —— Project list ——
  if (intent.subtype === 'project_list') {
    if (factKey === 'projects.primary') return 5
    if (factKeyStarts(factKey, 'projects.') || category === 'projects') return 1
    return 80
  }

  // —— Singular favorite ——
  if (intent.subtype === 'favorite') {
    if (subject && factKey === `preferences.favorite.${subject}`) return 1
    if (subject && !factKey && legacyFavoriteSubjectHit(row, subject)) return 2
    if (subject && factKeyStarts(factKey, `preferences.cofavorite.${subject}.`)) return 35
    if (
      factKeyStarts(factKey, 'preferences.like.') ||
      factKeyStarts(factKey, 'preferences.interest.')
    ) {
      return 70
    }
    if (factKeyStarts(factKey, 'preferences.dislike.')) return 90
    if (factKeyStarts(factKey, 'preferences.favorite.')) return 40
    if (category === 'preferences' || category === 'tastes') return 45
    return 80
  }

  // —— Plural cofavorite ——
  if (intent.subtype === 'cofavorite') {
    if (subject && factKeyStarts(factKey, `preferences.cofavorite.${subject}.`)) return 1
    if (subject && !factKey && legacyFavoriteSubjectHit(row, subject) && /\bfavorite\b|\bpreferit/i.test(hay)) {
      return 2
    }
    if (subject && factKey === `preferences.favorite.${subject}`) return 35
    if (
      factKeyStarts(factKey, 'preferences.like.') ||
      factKeyStarts(factKey, 'preferences.interest.')
    ) {
      return 70
    }
    if (factKeyStarts(factKey, 'preferences.dislike.')) return 90
    if (factKeyStarts(factKey, 'preferences.cofavorite.')) return 25
    if (category === 'preferences' || category === 'tastes') return 45
    return 80
  }

  // —— Interest ——
  if (intent.subtype === 'interest') {
    if (factKeyStarts(factKey, 'preferences.interest.')) return 1
    if (!factKey && /\binterested\s+in\b/i.test(hay)) return 2
    if (factKeyStarts(factKey, 'preferences.dislike.')) return 90
    if (
      factKeyStarts(factKey, 'preferences.like.') ||
      factKeyStarts(factKey, 'preferences.favorite.') ||
      factKeyStarts(factKey, 'preferences.cofavorite.')
    ) {
      return 70
    }
    if (category === 'preferences' || category === 'tastes') return 45
    return 80
  }

  // —— Broad positive like ——
  if (intent.subtype === 'like' && intent.polarity === 'positive') {
    if (factKeyStarts(factKey, 'preferences.dislike.')) return 90
    if (/\bdislikes?\b/i.test(hay)) return 85
    if (
      factKeyStarts(factKey, 'preferences.like.') ||
      factKeyStarts(factKey, 'preferences.interest.') ||
      factKeyStarts(factKey, 'preferences.favorite.') ||
      factKeyStarts(factKey, 'preferences.cofavorite.')
    ) {
      return 10
    }
    if (category === 'preferences' || category === 'tastes') return 20
    return 60
  }

  // Soft domain-only
  if (intent.domain === 'projects' && (factKeyStarts(factKey, 'projects.') || category === 'projects')) {
    return 20
  }
  if (
    intent.domain === 'preferences' &&
    (category === 'preferences' || category === 'tastes' || factKeyStarts(factKey, 'preferences.'))
  ) {
    if (intent.polarity === 'positive' && factKeyStarts(factKey, 'preferences.dislike.')) return 90
    return 30
  }

  return 50
}

/**
 * Recall-only semantic rerank. Does not call or mutate scoreMemoryRelevance.
 *
 * @param {any[]} memories
 * @param {string} query
 * @param {{ limit?: number, intent?: MemoryQueryIntent }} [options]
 * @returns {any[]}
 */
export function rerankMemoriesForRecall(memories, query, options = {}) {
  const limit = Math.min(
    Math.max(options.limit ?? RECALL_MAX_MEMORIES, 1),
    RECALL_MAX_MEMORIES,
  )
  const list = Array.isArray(memories) ? memories.filter(Boolean) : []
  if (list.length === 0) return []

  const intent = options.intent || detectMemoryQueryIntent(query)
  const ranked = list.map((row, index) => ({
    row,
    tier: semanticRecallTier(row, intent),
    index,
    importance: Number(row?.importance) || 0,
  }))

  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.importance - a.importance ||
      a.index - b.index,
  )

  return ranked.slice(0, limit).map((item) => item.row)
}

/**
 * @param {string} text
 */
export function normalizeMemoryProbeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/[.!?…,;:]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Narrow personal-memory probe (specific "what do you remember about MY X?").
 * Not Memory Overview ("about me"), not ordinary factual questions, not forget.
 *
 * @param {string} message
 */
export function isPersonalMemoryProbe(message) {
  const raw = normalizeMemoryProbeText(message)
  if (!raw) return false

  if (
    /\b(?:dimentica|dimenticati|cancella|elimina|forget|delete|clear)\b/i.test(raw) ||
    /\bnon\s+ricord(?:are|arti)\s+pi[uù]\b/i.test(raw)
  ) {
    return false
  }

  // Memory Overview inventory ("di me" / "about me") — separate path.
  if (
    /\b(?:su\s+di\s+me|di\s+me|about\s+me)\b/i.test(raw) &&
    /\b(?:ricordi|sai|conosci|remember|know)\b/i.test(raw)
  ) {
    return false
  }

  // Italian: ti ricordi / ricordi + personal possessive question
  if (
    /\b(?:ti\s+)?ricord(?:i|are)?\b/i.test(raw) &&
    /\b(?:mio|mia|miei|mie)\b/i.test(raw) &&
    /\b(?:qual|quale|quali|cosa|che\s+cosa)\b/i.test(raw)
  ) {
    return true
  }

  // Italian: ti ricordi cosa ti ho detto su…
  if (/\b(?:ti\s+)?ricord(?:i|are)?\s+cosa\s+ti\s+ho\s+detto\b/i.test(raw)) {
    return true
  }

  // Italian: cosa ti ho detto su/di… (personal topic probe)
  if (/\bcosa\s+ti\s+ho\s+detto\s+(?:su|di|del|della|dei|delle|sul|sulla)\b/i.test(raw)) {
    return true
  }

  // Italian: cosa ti ricordi del mio…
  if (
    /\bcosa\s+ti\s+ricordi\s+(?:del|della|dei|delle|sul|sulla|su|di)\s+(?:mio|mia|miei|mie)\b/i.test(
      raw,
    )
  ) {
    return true
  }

  // Italian: qual è il mio… / quali sono i miei… (also qual'è)
  if (
    /\bqual(?:e|'?\s*[eè]|'?è)?\s+(?:[eè]\s+)?(?:il|la)\s+mi(?:o|a)\b/i.test(raw) ||
    /\bquali\s+(?:sono\s+)?(?:i|le)\s+mi(?:ei|e)\b/i.test(raw)
  ) {
    return true
  }

  // Italian: chi è il mio… / chi sono i miei…
  if (
    /\bchi\s+(?:[eè]\s+)?(?:il|la)\s+mi(?:o|a)\b/i.test(raw) ||
    /\bchi\s+(?:sono\s+)?(?:i|le)\s+mi(?:ei|e)\b/i.test(raw)
  ) {
    return true
  }

  // Italian: cosa mi piace
  if (/^cosa\s+mi\s+piace\b/i.test(raw)) {
    return true
  }

  // Italian / EN: self-scoped interest probes (not "compound interest")
  if (
    /^(?:cosa|che\s+cosa)\s+mi\s+interessa\b/i.test(raw) ||
    /\bquali\s+(?:sono\s+)?(?:i\s+)?mi(?:ei|e)\s+interessi\b/i.test(raw) ||
    /\b(?:ti\s+)?ricord(?:i|are)?\s+cosa\s+mi\s+interessa\b/i.test(raw) ||
    /\b(?:ti\s+)?ricord(?:i|are)?\s+quali\s+(?:sono\s+)?(?:i\s+)?mi(?:ei|e)\s+interessi\b/i.test(
      raw,
    ) ||
    /\bwhat\s+am\s+i\s+interested\s+in\b/i.test(raw) ||
    /\bwhat\s+are\s+my\s+interests\b/i.test(raw) ||
    /\b(?:do\s+you\s+)?remember\s+what\s+i(?:'m|\s+am)\s+interested\s+in\b/i.test(raw) ||
    /\b(?:do\s+you\s+)?remember\s+my\s+interests\b/i.test(raw)
  ) {
    return true
  }

  // English: do you remember my… / what do you remember about my…
  if (
    /\b(?:do\s+you\s+)?remember\s+(?:my|what\s+my)\b/i.test(raw) ||
    /\bwhat\s+do\s+you\s+remember\s+about\s+my\b/i.test(raw) ||
    /\btell\s+me\s+what\s+you\s+remember\s+about\s+my\b/i.test(raw)
  ) {
    return true
  }

  // English: what is/are my…
  if (/\bwhat\s+(?:is|are)\s+my\b/i.test(raw)) {
    return true
  }

  // English: who is/are my…
  if (/\bwho\s+(?:is|are)\s+my\b/i.test(raw)) {
    return true
  }

  return false
}

/**
 * UI-only settings are not useful conversational recall.
 * @param {string} content
 * @returns {boolean}
 */
export function isUiOnlySettingsContent(content) {
  const text = String(content || '')
  return /\b(theme|tema|dark\s+mode|light\s+mode|tema\s+scuro|tema\s+chiaro|scuro|chiaro|emoji|markdown|rispost[ea]\s+(brevi|concis|dettagliat)|detailed\s+replies|concise\s+replies|reply\s+preference)\b/i.test(
    text,
  )
}

/**
 * @param {{ category?: string, content?: string, status?: string } | null | undefined} row
 * @returns {boolean}
 */
export function isRecallEligibleMemory(row) {
  if (!row || typeof row !== 'object') return false
  const status = String(row.status || 'active').toLowerCase()
  if (status === 'obsolete' || status === 'archived' || status === 'inactive' || status === 'deleted') {
    return false
  }

  const category = String(row.category || '')
    .trim()
    .toLowerCase()
  const content = String(row.content || '').trim()
  if (!content) return false

  if (RECALL_PREFERRED_CATEGORIES.has(category)) return true

  if (category === 'settings') {
    return !isUiOnlySettingsContent(content)
  }

  return false
}

/**
 * Provenance rules shared by non-empty durable packs and empty-probe signals.
 * Ephemeral Core appendix only — never shown as user-facing copy.
 *
 * Single coherent Recall-truthfulness block (#251 provenance + relation
 * preservation). Do not stack a separate appendix for the same concern.
 */
export function durableMemoryProvenanceRules() {
  return [
    'Provenance (ephemeral — do not mention these labels to the user):',
    '- DURABLE MEMORY 2.0 = only the persisted facts listed in this appendix (if any).',
    '- CURRENT THREAD = messages in this conversation; separate from durable memory.',
    '- Inference = your reasoning; not durable memory.',
    '- Never present thread-only or inferred information as a durable remembered Memory 2.0 fact.',
    '- You may refer to something said earlier in THIS conversation as current-thread context, but do not claim it is saved/remembered/persisted unless it appears as a durable fact below.',
    '- Do not say or imply "I remember", "I saved", or "your main/favorite X is…" as durable memory unless grounded in a durable fact listed here.',
    '- Preserve each durable fact\'s semantic relation exactly (like, dislike, favorite, cofavorite, interest, identity, project, etc.).',
    '- Do not convert favorite→like, like→favorite, interest→like/favorite, like→interest, favorite→interest, or dislike→like. A favorite or like fact does not authorize claiming a separate INTEREST or LIKE memory exists.',
    '- If the user\'s question is broader than the available subtype, answer using the exact subtype wording from the fact (e.g. "your favorite anime is…", "you are interested in…", "you like…"), not a different remembered relation.',
    '- Do not mention retrieval, databases, packs, or storage mechanics.',
  ].join('\n')
}

/**
 * Empty durable-memory appendix for personal probes with zero Recall hits.
 * @returns {string}
 */
export function formatEmptyDurableMemorySignal() {
  return [
    'DURABLE LAIFE MEMORY 2.0',
    '',
    EMPTY_DURABLE_MEMORY_RESULT_LINE,
    '',
    durableMemoryProvenanceRules(),
    '- For this question, answer truthfully: there is no relevant persisted Memory 2.0 fact.',
    '- If the current thread mentioned something related, you may note that as current-thread context only — never as durable memory.',
  ].join('\n')
}

/**
 * Build the ephemeral durable-memory appendix (category + content only).
 * Returns '' when there is nothing useful / within budget.
 *
 * @param {Array<{ category?: string, content?: string, status?: string }>} memories
 * @param {{ maxMemories?: number, maxPackChars?: number, maxLineChars?: number }} [limits]
 * @returns {string}
 */
export function formatCoreMemoryPack(memories, limits = {}) {
  const maxMemories = Math.min(
    Math.max(limits.maxMemories ?? RECALL_MAX_MEMORIES, 1),
    RECALL_MAX_MEMORIES,
  )
  const maxPackChars = limits.maxPackChars ?? RECALL_MAX_PACK_CHARS
  const maxLineChars = limits.maxLineChars ?? RECALL_MAX_LINE_CHARS

  const eligible = (Array.isArray(memories) ? memories : [])
    .filter(isRecallEligibleMemory)
    .slice(0, maxMemories)

  if (eligible.length === 0) return ''

  const header = [
    'DURABLE LAIFE MEMORY 2.0',
    '',
    'The following facts are persistently stored LAIfe Memory 2.0 facts for this user.',
    'Treat ONLY these facts as durable persisted memory for this answer.',
    '- Use a durable fact when it helps answer the current message; do not dump the list.',
    '- Current chat history is separate from this durable pack.',
    '- Do not invent durable facts beyond this pack.',
    '- If the user explicitly corrects a fact in the current user message, prefer that correction for this turn — still do not invent other durable memories from the thread.',
    '',
    durableMemoryProvenanceRules(),
    '',
    'Persisted durable facts:',
  ].join('\n')

  const lines = []
  let factChars = 0

  for (const row of eligible) {
    const category = String(row.category || '')
      .trim()
      .toLowerCase()
      .slice(0, 32)
    let content = String(row.content || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!content) continue

    const prefix = `- [${category}] `
    const room = Math.min(maxLineChars, maxPackChars - factChars) - prefix.length
    if (room < 12) break

    if (content.length > room) {
      content = `${content.slice(0, Math.max(0, room - 1)).trim()}…`
    }

    const line = `${prefix}${content}`
    if (factChars + line.length > maxPackChars && lines.length > 0) break
    lines.push(line)
    factChars += line.length + 1
  }

  if (lines.length === 0) return ''
  return `${header}\n${lines.join('\n')}`
}

/**
 * Soft-load a Core memory pack for the verified owner.
 * Never falls back to brain-api@local.
 *
 * When Memory is ON, owner is verified, the turn is a personal memory probe,
 * and Recall returns zero rows → append empty-durable signal (not silent '').
 *
 * @param {{
 *   userMessage: string
 *   ownerUserId: string | null | undefined
 *   memoryEnabled?: boolean
 *   searchMemories?: typeof searchMemories
 * }} input
 * @returns {Promise<string>}
 */
export async function loadCoreMemoryPack(input) {
  if (input?.memoryEnabled === false) return ''

  const ownerUserId =
    typeof input?.ownerUserId === 'string' ? input.ownerUserId.trim() : ''
  const userMessage = typeof input?.userMessage === 'string' ? input.userMessage.trim() : ''
  if (!ownerUserId || !userMessage) return ''

  const probe = isPersonalMemoryProbe(userMessage)

  try {
    const search = input.searchMemories ?? searchMemories
    const intent = detectMemoryQueryIntent(userMessage)
    const memories = await search(userMessage, {
      userId: ownerUserId,
      requireExplicitUserId: true,
      // Wider candidate pool for semantic rerank; final pack still max 3.
      limit: RECALL_CANDIDATE_LIMIT,
      maxPerCategory: RECALL_MAX_PER_CATEGORY,
      includeObsolete: false,
    })

    if (Array.isArray(memories) && memories.length > 0) {
      // #264: drop preference-family rows on generic non-probe opinion turns
      // unless the utterance has concrete same-turn entity/value overlap.
      const guarded = applyNonProbePreferenceRecallGuard(memories, userMessage, {
        isProbe: probe,
      })
      const ranked = rerankMemoriesForRecall(guarded, userMessage, {
        limit: RECALL_MAX_MEMORIES,
        intent,
      })
      const pack = formatCoreMemoryPack(ranked)
      if (pack) return pack
    }

    if (probe) return formatEmptyDurableMemorySignal()
    return ''
  } catch (error) {
    console.warn(
      '[core-memory-recall] skip recall:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
    // Soft-fail: for personal probes still prefer an empty-durable signal over silence,
    // so Core does not invent durable memory from the thread alone.
    if (probe) return formatEmptyDurableMemorySignal()
    return ''
  }
}

/**
 * Append pack to already-assembled Core instructions (does not edit base prompt).
 * @param {string} instructions
 * @param {string} memoryPack
 * @returns {string}
 */
export function appendMemoryPackToInstructions(instructions, memoryPack) {
  const base = String(instructions || '')
  const pack = String(memoryPack || '').trim()
  if (!pack) return base
  if (!base) return pack
  return `${base}\n\n${pack}`
}

/** Preference-family fact_key prefixes (#264 guard scope). */
const PREFERENCE_FAMILY_PREFIXES = [
  'preferences.like.',
  'preferences.dislike.',
  'preferences.interest.',
  'preferences.favorite.',
  'preferences.cofavorite.',
]

/** Function / opinion words that must not count as concrete entities. */
const NONPROBE_STOP_TOKENS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'about',
  'from',
  'my',
  'me',
  'you',
  'your',
  'i',
  'we',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'do',
  'does',
  'did',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'am',
  'so',
  'much',
  'very',
  'why',
  'how',
  'what',
  'who',
  'which',
  'when',
  'where',
  'think',
  'thought',
  'secondo',
  'te',
  'tu',
  'mi',
  'ti',
  'ci',
  'si',
  'lo',
  'la',
  'il',
  'le',
  'gli',
  'un',
  'una',
  'uno',
  'di',
  'da',
  'del',
  'della',
  'dei',
  'delle',
  'per',
  'con',
  'su',
  'che',
  'chi',
  'cosa',
  'come',
  'dove',
  'quando',
  'perche',
  'perché',
  'cosi',
  'così',
  'tanto',
  'molto',
  'piu',
  'più',
  'parlando',
  'speaking',
  'talking',
  'regarding',
  'circa',
  'secondo',
  'like',
  'likes',
  'liked',
  'love',
  'loves',
  'piace',
  'prefer',
  'preferito',
  'preferita',
  'preferiti',
  'preferite',
  'favorite',
  'favourite',
  'interest',
  'interests',
  'interested',
  'interessa',
  'interessano',
  'interessi',
  'dislike',
  'dislikes',
  'hate',
  'hates',
  'user',
  'users',
  's',
])

/**
 * @param {unknown} row
 * @returns {string}
 */
function recallRowFactKey(row) {
  if (typeof row?.factKey === 'string' && row.factKey.trim()) return row.factKey.trim()
  return readFactKeyFromTags(row?.tags) || ''
}

/**
 * True when the row is a preference-family durable fact (#264 scope).
 * @param {unknown} row
 */
export function isPreferenceFamilyMemory(row) {
  const key = recallRowFactKey(row)
  if (key && PREFERENCE_FAMILY_PREFIXES.some((p) => key.startsWith(p))) return true

  // Legacy / missing fact_key: preferences|tastes category + preference gloss cues.
  const category = String(row?.category || '')
    .trim()
    .toLowerCase()
  if (category !== 'preferences' && category !== 'tastes') return false
  const hay = `${row?.title || ''} ${row?.content || ''}`.toLowerCase()
  return /\b(favorite|favourite|likes?|dislikes?|interested|interest|preferit|piace|cofavorite)\b/i.test(
    hay,
  )
}

/**
 * Generic / pronoun-like preference opinion wording (non-probe).
 * @param {string} query
 */
export function isGenericPreferenceOpinionQuery(query) {
  const raw = normalizeMemoryProbeText(query)
  if (!raw) return false

  // Explicit inventory / subject probes are handled by isPersonalMemoryProbe —
  // keep a belt-and-suspenders false here for "cosa mi piace"-shaped inventory.
  if (
    /^(?:cosa|che\s+cosa)\s+mi\s+piace\b/i.test(raw) ||
    /^(?:cosa|che\s+cosa)\s+mi\s+interessa\b/i.test(raw) ||
    /\bwhat\s+(?:do\s+i\s+like|am\s+i\s+interested\s+in)\b/i.test(raw) ||
    /\b(?:qual|what)\s+.+\b(?:preferit|favorite|favourite)\b/i.test(raw)
  ) {
    return false
  }

  if (
    /\b(?:perch[eé]|why)\b[\s\S]{0,40}\b(?:mi\s+piace|i\s+like|like\s+it)\b/i.test(raw) ||
    /\b(?:mi\s+piace|i\s+like\s+it|like\s+it)\b/i.test(raw) ||
    /\b(?:perch[eé]|why)\b[\s\S]{0,40}\b(?:mi\s+interessa|i(?:'m|\s+am)\s+interested)\b/i.test(
      raw,
    ) ||
    /\bmi\s+interessa\s+(?:cos[iì]\s+)?tanto\b/i.test(raw) ||
    /\bwhy\s+do\s+(?:you\s+think\s+)?i\s+like\b/i.test(raw) ||
    /\bwhy\s+do\s+you\s+think\s+i(?:'m|\s+am)\s+interested\b/i.test(raw)
  ) {
    return true
  }

  return false
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeConcreteParts(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .split(/[\s_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !NONPROBE_STOP_TOKENS.has(t) && !/^\d+$/.test(t))
}

/**
 * Concrete entity/value tokens from the user utterance (same-turn).
 * @param {string} query
 * @returns {Set<string>}
 */
export function extractQueryEntityTokens(query) {
  const parts = tokenizeConcreteParts(query)
  /** @type {Set<string>} */
  const out = new Set()
  for (const p of parts) {
    out.add(p)
    const slug = slugifyFactKeyPart(p)
    if (slug && slug !== 'item') out.add(slug)
  }
  // Bigrams (dragon ball, one piece, …)
  for (let i = 0; i < parts.length - 1; i += 1) {
    const bi = `${parts[i]}_${parts[i + 1]}`
    out.add(bi)
    out.add(`${parts[i]}${parts[i + 1]}`)
  }
  return out
}

/**
 * Concrete entity/value tokens from a memory row (content / title / tags / fact_key).
 * @param {unknown} row
 * @returns {Set<string>}
 */
export function extractMemoryEntityTokens(row) {
  /** @type {Set<string>} */
  const out = new Set()
  const addText = (text) => {
    for (const t of tokenizeConcreteParts(text)) {
      out.add(t)
      const slug = slugifyFactKeyPart(t)
      if (slug && slug !== 'item') out.add(slug)
    }
  }

  addText(String(row?.title || ''))
  const content = String(row?.content || '')
  addText(content)
  // Value after gloss colon: "User's favorite anime: Naruto."
  const afterColon = content.match(/:\s*(.+?)(?:\.|$)/)
  if (afterColon?.[1]) addText(afterColon[1])

  const tags = Array.isArray(row?.tags) ? row.tags : []
  for (const tag of tags) addText(String(tag || '').replace(/^fk:/i, ''))

  const key = recallRowFactKey(row)
  if (key) {
    const parts = key.split('.').filter(Boolean)
    // Drop structural prefixes; keep subject/value segments.
    const skip = new Set(['preferences', 'like', 'dislike', 'interest', 'favorite', 'cofavorite'])
    for (const part of parts) {
      if (skip.has(part)) continue
      addText(part)
    }
  }

  // Bigrams from content tokens for multi-word values
  const contentParts = tokenizeConcreteParts(content)
  for (let i = 0; i < contentParts.length - 1; i += 1) {
    out.add(`${contentParts[i]}_${contentParts[i + 1]}`)
    out.add(`${contentParts[i]}${contentParts[i + 1]}`)
  }

  return out
}

/**
 * True when the query shares a concrete entity/value token with the memory.
 * @param {string} query
 * @param {unknown} row
 */
export function hasConcretePreferenceEntityOverlap(query, row) {
  const qTokens = extractQueryEntityTokens(query)
  if (qTokens.size === 0) return false
  const mTokens = extractMemoryEntityTokens(row)
  for (const t of qTokens) {
    if (mTokens.has(t)) return true
  }
  // Substring fallback for compact values (naruto in both)
  const qRaw = normalizeMemoryProbeText(query)
  for (const t of mTokens) {
    if (t.length >= 4 && qRaw.includes(t.replace(/_/g, ' '))) return true
    if (t.length >= 4 && qRaw.includes(t.replace(/_/g, ''))) return true
  }
  return false
}

/**
 * #264 — suppress preference-family rows on generic non-probe opinion turns
 * unless the same-turn utterance concretely overlaps the memory value/entity.
 *
 * @param {string} query
 * @param {unknown} memory
 * @param {{ isProbe?: boolean }} [options]
 * @returns {boolean} true → exclude from pack
 */
export function shouldSuppressPreferenceMemoryOnNonProbe(query, memory, options = {}) {
  if (options.isProbe === true) return false
  if (isPersonalMemoryProbe(query)) return false
  if (!isPreferenceFamilyMemory(memory)) return false
  if (!isGenericPreferenceOpinionQuery(query)) return false
  if (hasConcretePreferenceEntityOverlap(query, memory)) return false
  return true
}

/**
 * Filter search candidates with the #264 non-probe preference guard.
 * Ranking / max-3 unchanged — applied after this filter.
 *
 * @param {any[]} memories
 * @param {string} query
 * @param {{ isProbe?: boolean }} [options]
 * @returns {any[]}
 */
export function applyNonProbePreferenceRecallGuard(memories, query, options = {}) {
  const list = Array.isArray(memories) ? memories : []
  const isProbe = options.isProbe === true || isPersonalMemoryProbe(query)
  if (isProbe) return list
  return list.filter((row) => !shouldSuppressPreferenceMemoryOnNonProbe(query, row, { isProbe: false }))
}
