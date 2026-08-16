/**
 * BrAIn intelligent memory — logic only (no schema / model changes).
 *
 * Saves only durable, long-term useful facts.
 * Auto-categorizes. Upserts instead of duplicating.
 * Retrieves only memories that actually match the turn.
 */

import { getServiceSupabase } from './supabase.js'
import {
  getReplaceSetProjectDiagnostics,
  isReplaceSetTraceEnabled,
  logReplaceSetTrace,
  logReplaceSetTraceError,
  snapshotMemoryRows,
} from './memory-replace-set-trace.js'

/** Legacy shared fallback user for chat pipeline (Phase 1A.4 will replace). */
export const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'

const NO_SAVE = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
  items: [],
}

const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

/** Canonical intelligent categories (stored as free-text; no DB enum). */
export const INTELLIGENT_CATEGORIES = [
  'identity',
  'preferences',
  'projects',
  'goals',
  'relationships',
  'skills',
  'habits',
  'events',
  'settings',
]

/** Legacy category names still accepted for upsert matching. */
const CATEGORY_ALIASES = {
  identity: ['identity'],
  preferences: ['preferences', 'tastes', 'hobbies'],
  projects: ['projects'],
  goals: ['goals'],
  relationships: ['relationships'],
  skills: ['skills', 'profession'],
  habits: ['habits', 'hobbies'],
  events: ['events', 'important'],
  settings: ['settings'],
}

/** Minimum token-overlap score (0–1) to treat two memories as the same fact. */
const DEDUPE_OVERLAP = 0.5

/** Chat retrieval: require real relevance — never dump the whole store. */
const MIN_RELEVANCE_SCORE = 6
const DEFAULT_SEARCH_LIMIT = 3
const MAX_SEARCH_LIMIT = 6
const MAX_PER_CATEGORY = 2

/** Category priority when the topic matches (preferences & goals rank high). */
const CATEGORY_PRIORITY = {
  preferences: 1.35,
  settings: 1.3,
  goals: 1.4,
  projects: 1.25,
  identity: 1.15,
  skills: 1.1,
  habits: 1.05,
  relationships: 1.05,
  events: 1.0,
  tastes: 1.3,
  profession: 1.1,
  hobbies: 1.05,
  important: 1.0,
}

/**
 * Lightweight semantic neighborhoods (IT/EN) for topic-aware retrieval
 * beyond exact keyword overlap.
 */
const SEMANTIC_TOPICS = [
  {
    id: 'identity',
    categories: ['identity'],
    cues: ['nome', 'chiamo', 'abito', 'vivo', 'età', 'name', 'live', 'from', 'identity'],
    related: ['name', 'nome', 'location', 'identity'],
  },
  {
    id: 'preferences',
    categories: ['preferences', 'settings', 'tastes'],
    cues: [
      'prefer',
      'piace',
      'tema',
      'style',
      'stile',
      'dark',
      'scuro',
      'rispost',
      'dettagli',
      'concis',
      'emoji',
      'like',
      'favorite',
    ],
    related: ['prefer', 'preference', 'likes', 'theme', 'settings', 'style'],
  },
  {
    id: 'projects',
    categories: ['projects'],
    cues: [
      'progetto',
      'progetti',
      'project',
      'projects',
      'app',
      'svilupp',
      'build',
      'laife',
      'mvp',
      'repo',
      'feature',
      'deploy',
    ],
    related: ['project', 'progetto', 'progetti', 'app', 'mvp', 'build', 'develop'],
  },
  {
    id: 'goals',
    categories: ['goals'],
    cues: ['obiettiv', 'goal', 'scopo', 'voglio riuscire', 'ambizione', 'milestone'],
    related: ['goal', 'obiettivo', 'scopo', 'ambition'],
  },
  {
    id: 'skills',
    categories: ['skills', 'profession'],
    cues: [
      'lavoro',
      'studio',
      'ingegner',
      'skill',
      'competenz',
      'job',
      'profession',
      'coding',
      'program',
    ],
    related: ['skills', 'profession', 'studies', 'job', 'work'],
  },
  {
    id: 'habits',
    categories: ['habits', 'hobbies'],
    cues: ['uso', 'utilizzo', 'linux', 'macos', 'windows', 'routine', 'hobby', 'abitudin'],
    related: ['uses', 'habits', 'tools', 'hobby', 'linux'],
  },
  {
    id: 'relationships',
    categories: ['relationships'],
    cues: ['moglie', 'marito', 'partner', 'amico', 'amica', 'famiglia', 'family', 'relazion'],
    related: ['relationship', 'partner', 'family', 'friend'],
  },
  {
    id: 'events',
    categories: ['events', 'important'],
    cues: ['matrimonio', 'compleanno', 'laurea', 'esame', 'colloquio', 'wedding', 'birthday'],
    related: ['event', 'wedding', 'birthday', 'interview'],
  },
]

export async function ensureDefaultUserId(supabase) {
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', DEFAULT_API_USER_EMAIL)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up default user: ${lookupError.message}`)
  }

  if (existing?.id) {
    return String(existing.id)
  }

  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      email: DEFAULT_API_USER_EMAIL,
      display_name: DEFAULT_API_USER_NAME,
    })
    .select('id')
    .single()

  if (createError || !created?.id) {
    throw new Error(
      `Failed to create default user: ${createError?.message ?? 'unknown error'}`,
    )
  }

  return String(created.id)
}

/**
 * Ensure public.users has a row whose id equals the verified auth.uid().
 * memories.user_id FKs public.users(id), so auth ownership requires this bridge.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} authUserId
 * @returns {Promise<string>}
 */
export async function ensureAuthUserRow(supabase, authUserId) {
  const id = typeof authUserId === 'string' ? authUserId.trim() : ''
  if (!id) {
    throw new Error('Explicit auth user id is required')
  }

  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up auth user row: ${lookupError.message}`)
  }
  if (existing?.id) {
    return String(existing.id)
  }

  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      id,
      email: `auth:${id}@laife.local`,
      display_name: 'LAIfe user',
    })
    .select('id')
    .single()

  if (createError) {
    // Race: another request inserted the same id — re-read.
    const { data: raced, error: raceError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (raced?.id) return String(raced.id)
    throw new Error(
      `Failed to create auth user row: ${createError.message}${
        raceError ? ` / ${raceError.message}` : ''
      }`,
    )
  }

  if (!created?.id) {
    throw new Error('Failed to create auth user row: unknown error')
  }

  return String(created.id)
}

/**
 * Resolve user_id for memory operations.
 * When requireExplicitUserId is true (Memory CRUD API), never fall back to brain-api@local.
 *
 * @param {{ userId?: string, requireExplicitUserId?: boolean }} options
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<string>}
 */
export async function resolveMemoryUserId(options, supabase) {
  const explicit = typeof options?.userId === 'string' ? options.userId.trim() : ''
  if (options?.requireExplicitUserId) {
    if (!explicit) {
      throw new Error('Explicit userId is required for authenticated memory operations')
    }
    return explicit
  }
  if (explicit) return explicit
  return ensureDefaultUserId(supabase)
}

function tokenize(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

/** Tokens too common to count as retrieval hits on their own. */
const STOPWORDS = new Set([
  'il',
  'lo',
  'la',
  'i',
  'gli',
  'le',
  'un',
  'una',
  'di',
  'da',
  'in',
  'su',
  'per',
  'con',
  'che',
  'non',
  'mi',
  'ti',
  'si',
  'ci',
  'vi',
  'ho',
  'hai',
  'ha',
  'sono',
  'sei',
  'è',
  'e',
  'o',
  'ma',
  'se',
  'come',
  'cosa',
  'quando',
  'dove',
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'am',
  'be',
  'my',
  'me',
  'you',
  'your',
  'i',
  'it',
  'this',
  'that',
  'do',
  'does',
  'did',
  'have',
  'has',
  'was',
  'were',
  'what',
  'when',
  'where',
  'who',
  'how',
  'can',
  'could',
  'would',
  'should',
  'please',
  'grazie',
  'ciao',
  'ok',
  'okay',
])

function meaningfulTokens(query) {
  return tokenize(query).filter((t) => !STOPWORDS.has(t) && t.length > 2)
}

/**
 * Detect the user's current topic + retrieval intent (beyond bare keywords).
 * @param {string} query
 */
export function detectMemoryTopic(query) {
  const q = String(query || '').toLowerCase()
  const tokens = meaningfulTokens(q)
  /** @type {string[]} */
  const topicIds = []
  /** @type {string[]} */
  const categories = []
  /** @type {string[]} */
  const related = []

  for (const topic of SEMANTIC_TOPICS) {
    const hit = topic.cues.some((cue) => q.includes(cue) || tokens.some((t) => t.includes(cue) || cue.includes(t)))
    if (hit) {
      topicIds.push(topic.id)
      categories.push(...topic.categories)
      related.push(...topic.related)
    }
  }

  const wantsObsolete =
    /\b(prima|vecchio|obsolete|obsolet|archivio|anni\s+fa|used\s+to|remember\s+when|ti\s+ricordi\s+quando|quando\s+ancora)\b/i.test(
      q,
    )

  const wantsPersonalRecall =
    /\b(ricord|mi\s+chiamo|il\s+mio|la\s+mia|preferisc|obiettiv|progetto|my\s+|i\s+prefer|remember)\b/i.test(
      q,
    )

  return {
    topicIds: [...new Set(topicIds)],
    categories: [...new Set(categories)],
    relatedTokens: [...new Set(related)],
    queryTokens: tokens,
    wantsObsolete,
    wantsPersonalRecall,
  }
}

/**
 * Expand query with semantic topic neighbors so related memories surface
 * even without exact keyword overlap.
 */
function expandRetrievalTokens(query) {
  const detected = detectMemoryTopic(query)
  return [...new Set([...detected.queryTokens, ...detected.relatedTokens])]
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function mapMemoryRow(row) {
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : []
  return {
    id: String(row.id),
    category: String(row.category ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    importance:
      typeof row.importance === 'number' && Number.isFinite(row.importance)
        ? row.importance
        : 0,
    usageCount:
      typeof row.usage_count === 'number' && Number.isFinite(row.usage_count)
        ? row.usage_count
        : 0,
    lastUsedAt: row.last_used_at
      ? new Date(String(row.last_used_at)).toISOString()
      : null,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined,
    status: String(row.status || 'active').toLowerCase(),
    tags,
    factKey: readFactKeyFromTags(tags),
  }
}

function daysSince(iso) {
  if (!iso) return 365
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return 365
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24))
}

function isObsoleteStatus(status) {
  const s = String(status || 'active').toLowerCase()
  return s === 'obsolete' || s === 'archived' || s === 'inactive' || s === 'deleted'
}

function decision(category, title, content, importance, meta = {}) {
  const factKey =
    typeof meta.factKey === 'string' && meta.factKey.trim() ? meta.factKey.trim() : null
  const baseTags = Array.isArray(meta.tags) ? meta.tags.map(String) : []
  const tags = mergeTagsWithFactKey(baseTags, factKey)

  return {
    save: true,
    category,
    title,
    content,
    importance,
    source: meta.source || 'automatic',
    confidence:
      typeof meta.confidence === 'number' && Number.isFinite(meta.confidence)
        ? meta.confidence
        : meta.source === 'explicit'
          ? 0.95
          : 0.8,
    factKey,
    tags,
  }
}

/** Tag prefix for Extraction V2 PR3 stable fact identity (no schema migration). */
export const FACT_KEY_TAG_PREFIX = 'fact_key:'

/**
 * @param {string | null | undefined} factKey
 * @returns {string | null}
 */
export function encodeFactKeyTag(factKey) {
  const key = typeof factKey === 'string' ? factKey.trim() : ''
  if (!key) return null
  return `${FACT_KEY_TAG_PREFIX}${key}`
}

/**
 * @param {unknown} tags
 * @returns {string | null}
 */
export function readFactKeyFromTags(tags) {
  if (!Array.isArray(tags)) return null
  for (const raw of tags) {
    const tag = String(raw || '')
    if (tag.startsWith(FACT_KEY_TAG_PREFIX)) {
      const key = tag.slice(FACT_KEY_TAG_PREFIX.length).trim()
      if (key) return key
    }
  }
  return null
}

/**
 * Collapse same-turn candidates so each single-valued fact_key is written at most once.
 * Keeps the last occurrence (newest statement in the turn wins). Multi-valued keys untouched.
 *
 * @param {any[]} items
 * @returns {any[]}
 */
export function collapseItemsBySingleValuedFactKey(items) {
  const list = Array.isArray(items) ? items : []
  /** @type {Map<string, number>} */
  const lastIndexByKey = new Map()
  list.forEach((item, index) => {
    const key =
      (typeof item?.factKey === 'string' && item.factKey.trim()) ||
      readFactKeyFromTags(item?.tags) ||
      deriveFactKey(item || {}, {}) ||
      null
    if (key && isSingleValuedFactKey(key)) {
      lastIndexByKey.set(key, index)
    }
  })

  if (lastIndexByKey.size === 0) return list

  const drop = new Set()
  list.forEach((item, index) => {
    const key =
      (typeof item?.factKey === 'string' && item.factKey.trim()) ||
      readFactKeyFromTags(item?.tags) ||
      deriveFactKey(item || {}, {}) ||
      null
    if (!key || !isSingleValuedFactKey(key)) return
    if (lastIndexByKey.get(key) !== index) drop.add(index)
  })

  if (drop.size === 0) return list
  return list.filter((_, index) => !drop.has(index))
}

/**
 * @param {unknown} existingTags
 * @param {string | null | undefined} factKey
 * @returns {string[]}
 */
export function mergeTagsWithFactKey(existingTags, factKey) {
  const tags = (Array.isArray(existingTags) ? existingTags : [])
    .map(String)
    .filter((tag) => tag && !tag.startsWith(FACT_KEY_TAG_PREFIX))
  const encoded = encodeFactKeyTag(factKey)
  if (encoded) tags.push(encoded)
  return [...new Set(tags)]
}

/**
 * @param {string} value
 * @returns {string}
 */
export function slugifyFactKeyPart(value) {
  const slug = normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return slug || 'item'
}

const PET_SPECIES_KEY = {
  cane: 'dog',
  cagna: 'dog',
  cagnolino: 'dog',
  dog: 'dog',
  puppy: 'dog',
  gatto: 'cat',
  micetto: 'cat',
  micia: 'cat',
  cat: 'cat',
  kitten: 'cat',
}

/** Normalize favorite subjects so IT/EN collide on the same logical slot. */
const FAVORITE_SUBJECT_KEY = {
  colore: 'color',
  colori: 'color',
  color: 'color',
  colors: 'color',
  colour: 'color',
  colours: 'color',
  animale: 'animal',
  animali: 'animal',
  animal: 'animal',
  animals: 'animal',
  anime: 'anime',
  personaggio: 'character',
  personaggi: 'character',
  character: 'character',
  characters: 'character',
  gioco: 'game',
  giochi: 'game',
  game: 'game',
  games: 'game',
  serie: 'series',
  series: 'series',
  film: 'film',
  films: 'film',
  movie: 'movie',
  movies: 'movie',
  libro: 'book',
  libri: 'book',
  book: 'book',
  books: 'book',
  cibo: 'food',
  food: 'food',
  musica: 'music',
  music: 'music',
  artista: 'artist',
  artisti: 'artist',
  artist: 'artist',
  artists: 'artist',
  tema: 'theme',
  theme: 'theme',
}

/**
 * @param {string} subject
 * @returns {string}
 */
export function normalizeFavoriteSubjectKey(subject) {
  const slug = slugifyFactKeyPart(subject)
  return FAVORITE_SUBJECT_KEY[slug] || slug
}

/**
 * Build a TYPE B cofavorite fact_key.
 * @param {string} subject
 * @param {string} value
 * @returns {string}
 */
export function buildCofavoriteFactKey(subject, value) {
  const subj = normalizeFavoriteSubjectKey(subject)
  const val = slugifyFactKeyPart(value)
  return `preferences.cofavorite.${subj}.${val || 'item'}`
}

/** Interrogative placeholders that must never become favorite/cofavorite values. */
const FAVORITE_INTERROGATIVE_VALUE_SLUGS = new Set([
  'chi',
  'quale',
  'quali',
  'qual',
  'cosa',
  'che',
  'che_cosa',
  'checosa',
  'who',
  'what',
  'which',
])

/**
 * True when a captured favorite/cofavorite value is only an interrogative placeholder.
 * Belt-and-suspenders for reversed extractors — not the primary question guard.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isInterrogativeFavoriteValue(value) {
  const raw = cleanCapture(value)
  if (!raw) return false
  const slug = slugifyFactKeyPart(raw)
  if (FAVORITE_INTERROGATIVE_VALUE_SLUGS.has(slug)) return true
  const first = slugifyFactKeyPart(raw.split(/\s+/)[0] || '')
  return FAVORITE_INTERROGATIVE_VALUE_SLUGS.has(first)
}

/**
 * Sentence-level guard: favorite/preference *questions* must not extract as declarations.
 * Scoped to the favorite/cofavorite family (requires preferit/favorite cue).
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isFavoritePreferenceQuestion(message) {
  const text = String(message || '').trim()
  if (!text) return false
  // preferiti/preferito share stem "preferit" — do not require \b after the stem.
  if (!/\b(?:preferit\w*|favorite|favourite)\b/i.test(text)) return false

  // Explicit question mark on a preference utterance.
  if (/[?？]\s*$/u.test(text)) return true

  // WH-led preference queries (even if punctuation was stripped).
  if (
    /^(?:quali|quale|qual|chi|cosa|che\s+cosa|what|who|which)\b/i.test(text) &&
    /\b(?:mio|mia|miei|mie|my)\b/i.test(text)
  ) {
    return true
  }

  return false
}

/**
 * True when favorite/cofavorite revocation must not run (question / meta / hedge / third-party).
 * Favor false negatives over accidental revocation.
 * @param {string} message
 * @returns {boolean}
 */
export function shouldSkipFavoriteRevocation(message) {
  const text = String(message || '').trim()
  if (!text) return true

  // Hard stop: terminal interrogative.
  if (/[?？]\s*$/u.test(text)) return true
  if (isFavoritePreferenceQuestion(text)) return true

  // Meta-negation / denial
  if (/\bnon\s+ho\s+detto\b/i.test(text)) return true
  if (/\b(?:[eè]\s+falso|it'?s\s+false|it\s+is\s+false)\b/i.test(text)) return true
  if (/\bi\s+did(?:\s+not|n'?t)\s+say\b/i.test(text)) return true

  // Hypothetical
  if (/\bse\s+[\s\S]{0,120}\b(?:non\s+)?fos\w*/i.test(text) && /\bpreferit/i.test(text)) {
    return true
  }
  if (
    /\bif\s+[\s\S]{0,120}\b(?:were|was|weren'?t|wasn'?t)\b/i.test(text) &&
    /\bfavorite\b/i.test(text)
  ) {
    return true
  }

  // Hedges — precision over recall
  if (
    /^(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text) ||
    (/\b(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text) &&
      /\b(?:non\s+[eè]|no\s+longer|isn'?t|is\s+not|aren'?t)\b/i.test(text))
  ) {
    return true
  }

  // Third-party favorite framing (suo/his/… or "preferito di mio fratello")
  if (/\b(?:suo|sua|loro)\s+(?:\w+\s+){0,3}preferit/i.test(text)) return true
  if (/\b(?:his|her|their)\s+favorite\b/i.test(text)) return true
  if (/\bpreferit[oaie]\s+di\s+(?:mio|mia|my)\s+\w+/i.test(text)) return true
  if (/\bfavorite\s+\w*\s+of\s+(?:my|mio)\s+\w+/i.test(text)) return true

  return false
}

/**
 * Deterministic favorite / cofavorite revoke candidates (IT + EN).
 * Cofavorite shapes are tried before singular so "uno dei miei" does not collapse to singular.
 * @param {string} message
 * @returns {Array<{ targetType: 'favorite' | 'cofavorite', subject: string, value: string, factKey: string }>}
 */
export function extractFavoriteRevokeCandidates(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipFavoriteRevocation(user)) return []

  /** @type {Array<{ targetType: 'favorite' | 'cofavorite', subject: string, value: string, factKey: string }>} */
  const out = []

  const pushCandidate = (targetType, subjectRaw, valueRaw) => {
    const subject = normalizeFavoriteSubjectKey(subjectRaw)
    const value = cleanFavoritePreferenceValue(valueRaw)
    if (subject.length < 2 || value.length < 2) return
    if (isInterrogativeFavoriteValue(value)) return
    if (/^(tema|theme|item)$/i.test(subject)) return
    if (/^(un|una|il|la|lo|gli|le|a|an|the|my|mio|mia)$/i.test(subject)) return
    const factKey =
      targetType === 'cofavorite'
        ? buildCofavoriteFactKey(subject, value)
        : `preferences.favorite.${subject}`
    if (out.some((c) => c.factKey === factKey && c.targetType === targetType)) return
    out.push({ targetType, subject, value, factKey })
  }

  // —— TYPE B cofavorite revocation (IT) ——
  let m =
    user.match(
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+non\s+[eè]\s+(?:pi[uù]\s+)?(?:un[oa]\s+(?:dei|degli|delle)\s+|tra\s+(?:i|gli|le)\s+)mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[iea]\b/i,
    ) ||
    user.match(
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+no\s+longer\s+one\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
    ) ||
    user.match(
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+isn'?t\s+one\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})(?:\s+anymore)?\b/i,
    ) ||
    user.match(
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+not\s+one\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
    )
  if (m?.[1] && m?.[2]) {
    pushCandidate('cofavorite', m[2], m[1])
    return out
  }

  // —— TYPE A singular revocation (IT value-first / EN value-first) ——
  m =
    user.match(
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+non\s+[eè]\s+(?:pi[uù]\s+)?(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
    ) ||
    user.match(
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+no\s+longer\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
    ) ||
    user.match(
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+isn'?t\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})(?:\s+anymore)?\b/i,
    ) ||
    user.match(
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+not\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
    )
  if (m?.[1] && m?.[2]) {
    pushCandidate('favorite', m[2], m[1])
    return out
  }

  // —— TYPE A singular revocation (forward: "Il mio X preferito non è [più] Y") ——
  m =
    user.match(
      /(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s+non\s+[eè]\s+(?:pi[uù]\s+)?([^,.!?\n]{2,60})/i,
    ) ||
    user.match(
      /\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+is\s+no\s+longer\s+([^,.!?\n]{2,60})/i,
    ) ||
    user.match(/\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+is\s+not\s+([^,.!?\n]{2,60})/i)
  if (m?.[1] && m?.[2]) {
    pushCandidate('favorite', m[1], m[2])
    return out
  }

  return out
}

/**
 * Strip high-confidence replacement cue tokens from a captured list fragment.
 * Prevents solo_itachi / now_itachi / kakashi_adesso style fact_keys.
 * @param {string} raw
 * @returns {string}
 */
export function stripCofavoriteReplacementCueTokens(raw) {
  let text = cleanCapture(raw)
  text = text
    .replace(/^(?:adesso|ora|solo|soltanto|now|only)\s+/gi, '')
    .replace(/\s+(?:adesso|ora|now)\s*$/gi, '')
  return cleanCapture(text)
}

/**
 * Clean one cofavorite replace_set value (articles + cue tokens).
 * @param {string} raw
 * @returns {string}
 */
export function cleanCofavoriteReplaceSetValue(raw) {
  let v = cleanFavoritePreferenceValue(raw)
  v = v
    .replace(/^(?:adesso|ora|solo|soltanto|now|only)\s+/i, '')
    .replace(/\s+(?:adesso|ora|now)$/i, '')
  return cleanFavoritePreferenceValue(v)
}

/**
 * True when cofavorite replace_set must not run.
 * @param {string} message
 * @returns {boolean}
 */
export function shouldSkipFavoriteSetReplacement(message) {
  const text = String(message || '').trim()
  if (!text) return true
  if (/[?？]\s*$/u.test(text)) return true
  if (isFavoritePreferenceQuestion(text)) return true

  if (/\bnon\s+ho\s+detto\b/i.test(text)) return true
  if (/\b(?:[eè]\s+falso|it'?s\s+false|it\s+is\s+false)\b/i.test(text)) return true
  if (/\bi\s+did(?:\s+not|n'?t)\s+say\b/i.test(text)) return true

  if (/\bse\s+[\s\S]{0,120}\bfos\w*/i.test(text) && /\bpreferit/i.test(text)) return true
  if (
    /\bif\s+[\s\S]{0,120}\b(?:were|was|weren'?t|wasn'?t)\b/i.test(text) &&
    /\bfavorite\b/i.test(text)
  ) {
    return true
  }

  // Any hedge — precision over destructive set mutation
  if (/\b(?:forse|potrebbe|potrebbero|maybe|perhaps|possibly)\b/i.test(text)) return true

  if (/\b(?:suo|sua|loro)\b/i.test(text) && /\bpreferit/i.test(text)) return true
  if (/\b(?:his|her|their)\s+favorite\b/i.test(text)) return true
  if (/\bpreferit[oaie]\s+di\s+(?:mio|mia|my)\b/i.test(text)) return true
  if (/\bfavorite\s+\w+\s+of\s+(?:my|mio)\b/i.test(text)) return true
  if (/\bdi\s+mio\s+(?:fratello|sorella|amico|amica)\b/i.test(text)) return true
  if (/\b(?:brother|sister|friend)'?s\s+favorite\b/i.test(text)) return true

  return false
}

/**
 * Same-turn incompatible ops → skip replace_set (no destructive partial interpretation).
 * @param {string} message
 * @returns {boolean}
 */
export function hasIncompatibleMixedFavoriteOps(message) {
  const text = String(message || '').trim()
  if (!text) return false
  if (extractFavoriteRevokeCandidates(text).length > 0) return true
  if (
    /\b(?:ma|but)\b/i.test(text) &&
    /\b(?:mi\s+piace|non\s+mi\s+piace|i\s+like|i\s+don'?t\s+like|i\s+love|i\s+hate)\b/i.test(text)
  ) {
    return true
  }
  return false
}

/**
 * High-confidence cofavorite replace_set candidate, or overflow sentinel.
 * Bare plurals without adesso/ora/solo/now/only are NOT returned (stay additive).
 *
 * @param {string} message
 * @returns {{
 *   overflow?: boolean,
 *   targetType?: 'cofavorite',
 *   subject?: string,
 *   values?: string[],
 *   factKeys?: string[],
 * } | null}
 */
export function extractCofavoriteReplaceSetCandidate(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipFavoriteSetReplacement(user)) return null
  if (hasIncompatibleMixedFavoriteOps(user)) return null

  /** @type {Array<[RegExp, number, number]>} */
  const patterns = [
    // IT: Adesso/Ora i miei X preferiti sono [solo|soltanto] …
    [
      /^(?:adesso|ora)\s+i\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+sono\s+(?:(?:solo|soltanto)\s+)?([^.!?\n]{3,160})/i,
      1,
      2,
    ],
    // IT: i miei X preferiti adesso/ora sono …
    [
      /\bi\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+(?:adesso|ora)\s+sono\s+([^.!?\n]{3,160})/i,
      1,
      2,
    ],
    // IT: i miei X preferiti sono solo/soltanto …
    [
      /\bi\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+sono\s+(?:solo|soltanto)\s+([^.!?\n]{3,160})/i,
      1,
      2,
    ],
    // EN: Now my favorite X are [only] …
    [/^now\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+are\s+(?:only\s+)?([^.!?\n]{3,160})/i, 1, 2],
    // EN: my favorite X are now …
    [/\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+are\s+now\s+([^.!?\n]{3,160})/i, 1, 2],
    // EN: my favorite X now are …
    [/\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+now\s+are\s+([^.!?\n]{3,160})/i, 1, 2],
    // EN: my favorite X are only …
    [/\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+are\s+only\s+([^.!?\n]{3,160})/i, 1, 2],
  ]

  let subjectRaw = null
  let listRaw = null
  for (const [re, subjectIdx, listIdx] of patterns) {
    const m = user.match(re)
    if (m?.[subjectIdx] && m?.[listIdx]) {
      subjectRaw = m[subjectIdx]
      listRaw = m[listIdx]
      break
    }
  }
  if (!subjectRaw || !listRaw) return null

  const cleanedList = stripCofavoriteReplacementCueTokens(listRaw)
  const apparentCount = countFavoriteListApparentItems(cleanedList)
  if (apparentCount > 3) {
    return { overflow: true, subject: normalizeFavoriteSubjectKey(subjectRaw) }
  }
  const apparent = splitFavoriteList(cleanedList, { uncapped: true })
  if (apparent.length === 0) return null

  const subject = normalizeFavoriteSubjectKey(subjectRaw)
  if (
    subject.length < 2 ||
    /^(tema|theme|item|un|una|il|la|lo|gli|le|a|an|the|my|mio|mia)$/i.test(subject)
  ) {
    return null
  }

  /** @type {string[]} */
  const values = []
  /** @type {string[]} */
  const factKeys = []
  for (const part of apparent) {
    const value = cleanCofavoriteReplaceSetValue(part)
    if (value.length < 2) continue
    if (isInterrogativeFavoriteValue(value)) continue
    if (/^(?:adesso|ora|solo|soltanto|now|only)$/i.test(value)) continue
    const factKey = buildCofavoriteFactKey(subject, value)
    if (factKeys.includes(factKey)) continue
    values.push(value)
    factKeys.push(factKey)
  }
  if (values.length === 0) return null

  return {
    overflow: false,
    targetType: 'cofavorite',
    subject,
    values,
    factKeys,
  }
}

/**
 * Opposite polarity fact_key for like ↔ dislike (same value slug).
 * @param {string | null | undefined} factKey
 * @returns {string | null}
 */
export function oppositePreferencePolarityFactKey(factKey) {
  const key = typeof factKey === 'string' ? factKey.trim() : ''
  if (!key) return null
  const like = key.match(/^preferences\.like\.(.+)$/i)
  if (like?.[1]) return `preferences.dislike.${like[1]}`
  const dislike = key.match(/^preferences\.dislike\.(.+)$/i)
  if (dislike?.[1]) return `preferences.like.${dislike[1]}`
  return null
}

/**
 * True when the utterance ends as an interrogative (ASCII / fullwidth ?).
 * Terminal "?" alone is sufficient to block automatic like/dislike mutation.
 * @param {string} message
 * @returns {boolean}
 */
export function isTerminalInterrogativeUtterance(message) {
  const text = String(message || '').trim()
  if (!text) return false
  return /[?？]\s*$/u.test(text)
}

/**
 * True when the utterance asks about likes/dislikes (must not mutate polarity).
 * @param {string} message
 * @returns {boolean}
 */
export function isPreferencePolarityQuestion(message) {
  const text = String(message || '').trim()
  if (!text) return false

  // Hard rule: trailing "?" ⇒ interrogative (no polarity-cue required).
  if (isTerminalInterrogativeUtterance(text)) return true

  const hasPolarityCue =
    /\b(?:piace|piacciono|like|likes|dislike|dislikes|hate|hates|preferisco|prefer|odio|detesto)\b/i.test(
      text,
    )
  if (!hasPolarityCue) return false

  // Defense in depth: polarity cue + any question mark in the utterance.
  if (/[?？]/u.test(text)) return true

  if (
    /^(?:do\s+i|don'?t\s+i|do\s+not\s+i)\s+(?:like|dislike|hate)\b/i.test(text) ||
    /^what\s+do\s+i\s+(?:like|dislike|hate)\b/i.test(text) ||
    /^(?:mi\s+piace|non\s+mi\s+piace)\b/i.test(text)
  ) {
    // WH / yes-no without punctuation — only when clearly interrogative framing.
    if (/^(?:do\s+i|don'?t\s+i|do\s+not\s+i|what\s+do\s+i)\b/i.test(text)) return true
  }

  return false
}

/**
 * Skip like/dislike extraction for interrogatives, third-party, meta, hypotheticals.
 * Narrow deterministic guards — not a general NLU theorem prover.
 * Must run before any like/dislike candidate can persist or conflict-resolve.
 * @param {string} message
 * @returns {boolean}
 */
export function shouldSkipPreferencePolarityExtraction(message) {
  const text = String(message || '').trim()
  if (!text) return true
  // Sentence-level hard stop: terminal interrogative ≠ durable preference assertion.
  if (isTerminalInterrogativeUtterance(text)) return true
  if (isPreferencePolarityQuestion(text)) return true

  // Meta-negation / denial of the proposition
  if (/\bnon\s+ho\s+detto\b/i.test(text)) return true
  if (/\b(?:[eè]\s+falso|it'?s\s+false|it\s+is\s+false)\b/i.test(text)) return true
  if (/\bnon\s+significa\b/i.test(text)) return true
  if (/\bi\s+did(?:\s+not|n'?t)\s+say\b/i.test(text)) return true

  // Hypothetical
  if (/\bse\s+[\s\S]{0,80}\bnon\s+mi\s+piac/i.test(text)) return true
  if (/\bif\s+[\s\S]{0,80}\b(?:didn'?t|did\s+not)\s+like\b/i.test(text)) return true

  // Third-party / generic others (not "non mi piace")
  if (/\ba\s+qualcuno\s+non\s+piace\b/i.test(text)) return true
  if (/\bchi\s+non\s+(?:ama|piace)\b/i.test(text)) return true
  if (
    /\b(?:amico|amica|fratello|sorella|madre|padre|marito|moglie|partner|amico|friend|brother|sister|mom|dad)\b/i.test(
      text,
    ) &&
    /\b(?:non\s+(?:ama|guarda|piace)|doesn'?t|don'?t)\b/i.test(text) &&
    !/\bnon\s+mi\s+piace\b/i.test(text)
  ) {
    return true
  }

  return false
}

/**
 * Strip leading "più/anymore" noise from a captured preference value.
 * @param {string} value
 * @returns {string}
 */
export function normalizePreferencePolarityValue(value) {
  let v = cleanCapture(value)
  v = v
    .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
    .replace(/^pi[uù]\s+/i, '')
    .replace(/\s+pi[uù]$/i, '')
    .replace(/\s+anymore$/i, '')
    .replace(/\s+any\s+more$/i, '')
    .trim()
  return cleanCapture(v)
}

/**
 * Capture dislike object from a self-scoped negative preference utterance.
 * Handles "più/anymore/no longer" without storing "più" as the value.
 * @param {string} message
 * @returns {string | null}
 */
export function extractDislikePreferenceValue(message) {
  const user = String(message || '').trim()
  if (!user) return null
  // Every like/dislike path must refuse interrogatives before producing a candidate.
  if (shouldSkipPreferencePolarityExtraction(user)) return null

  // X non mi piace più.  (do not use \b after "più" — ù is not a JS \w char)
  let m = user.match(
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+non\s+mi\s+piace\s+pi[uù](?=\s|$|[.!?…,;:])/i,
  )
  if (m?.[1]) return normalizePreferencePolarityValue(m[1])

  // Non mi piace più X.
  m = user.match(/\bnon\s+mi\s+piace\s+pi[uù]\s+([^,.!?\n]{2,90})/i)
  if (m?.[1]) return normalizePreferencePolarityValue(m[1])

  // Non mi piace X. / odio / detesto — require word end so "piacesse" does not match.
  m = user.match(/\b(?:non\s+mi\s+piace|odio|detesto)\b\s+([^,.!?\n]{2,90})/i)
  if (m?.[1]) {
    const value = normalizePreferencePolarityValue(m[1])
    // Reject bare "più" leftovers from failed reversed parses.
    if (/^pi[uù]$/i.test(value)) return null
    return value
  }

  // I no longer like X.
  m = user.match(/\bi\s+no\s+longer\s+(?:like|love)\s+([^,.!?\n]{2,90})/i)
  if (m?.[1]) return normalizePreferencePolarityValue(m[1])

  // I don't like X anymore.
  m = user.match(
    /\bi\s+(?:don'?t|do\s+not)\s+like\s+([^,.!?\n]{2,90}?)\s+(?:anymore|any\s+more)\b/i,
  )
  if (m?.[1]) return normalizePreferencePolarityValue(m[1])

  // I don't like / hate / dislike X.
  m = user.match(/\bi\s+(?:don'?t\s+like|do\s+not\s+like|hate|dislike)\s+([^,.!?\n]{2,90})/i)
  if (m?.[1]) return normalizePreferencePolarityValue(m[1])

  return null
}

/**
 * Capture like object from a self-scoped positive preference utterance.
 * @param {string} message
 * @returns {string | null}
 */
export function extractLikePreferenceValue(message) {
  const user = String(message || '').trim()
  if (!user) return null
  // Every like/dislike path must refuse interrogatives before producing a candidate.
  if (shouldSkipPreferencePolarityExtraction(user)) return null
  // If a clear dislike shape is present, do not also treat as like.
  if (extractDislikePreferenceValue(user)) return null

  // I like X now / I like X anymore-style trailing time cue.
  let m = user.match(/\bi\s+like\s+([^,.!?\n]{2,90}?)\s+now\b/i)
  if (m?.[1]) return normalizePreferencePolarityValue(m[1])

  m =
    user.match(/(?:preferisco)\s+([^,.!?\n]{3,90})/i) ||
    user.match(/(?:(?:adesso|ora)\s+)?(?<!non\s)mi\s+piace(?:\s+molto)?\s+([^,.!?\n]{3,90})/i) ||
    user.match(/\bi\s+changed\s+my\s+mind[,:]?\s*i\s+like\s+([^,.!?\n]{3,90})/i) ||
    user.match(/\bi\s+(?:prefer|like|love)\s+([^,.!?\n]{3,90})/i)

  if (!m?.[1]) return null
  return normalizePreferencePolarityValue(m[1])
}

/**
 * Conservative favorite-list splitter (comma / Italian e / English and).
 * Does not split on ordinary spaces (preserves "Dragon Ball", "One Piece").
 * Caps at maxItems (default 3 = same-turn durable fact cap).
 *
 * @param {string} raw
 * @param {{ maxItems?: number }} [options]
 * @returns {string[]}
 */
export function splitFavoriteList(raw, options = {}) {
  const uncapped = options.uncapped === true
  const maxItems = uncapped
    ? Number.POSITIVE_INFINITY
    : Math.min(Math.max(options.maxItems ?? 3, 1), 3)
  let text = cleanCapture(raw)
  if (!text) return []

  text = text
    .replace(/\s*,\s*and\s+/gi, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .replace(/\s*,\s*e\s+/gi, ', ')
    .replace(/\s+e\s+/gi, ', ')

  const parts = text
    .split(/\s*,\s*/)
    .map((part) =>
      cleanCapture(part)
        .replace(/^[\s«»"'“”]+|[\s«»"'“”]+$/g, '')
        .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
        .trim(),
    )
    .filter((part) => part.length >= 2 && !/^(e|and|o|or)$/i.test(part))

  return uncapped ? parts : parts.slice(0, maxItems)
}

/**
 * Apparent list length without the durable max-3 cap (overflow detection for replace_set).
 * Counts structural list items (comma / e / and) without the length>=2 durable filter,
 * so "A, B, C e D" still counts as 4 and blocks destructive truncate.
 * @param {string} raw
 * @returns {number}
 */
export function countFavoriteListApparentItems(raw) {
  let text = cleanCapture(raw)
  if (!text) return 0
  text = text
    .replace(/\s*,\s*and\s+/gi, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .replace(/\s*,\s*e\s+/gi, ', ')
    .replace(/\s+e\s+/gi, ', ')
  return text
    .split(/\s*,\s*/)
    .map((part) => cleanCapture(part).replace(/^[\s«»"'“”]+|[\s«»"'“”]+$/g, '').trim())
    .filter((part) => part.length >= 1 && !/^(e|and|o|or)$/i.test(part)).length
}

/**
 * Singular favorite fact_keys that map to the same normalized subject
 * (includes legacy IT/EN surface keys for migration within PR3).
 *
 * @param {string} subject
 * @returns {string[]}
 */
export function singularFavoriteFactKeysForSubject(subject) {
  const norm = normalizeFavoriteSubjectKey(subject)
  const keys = [`preferences.favorite.${norm}`]
  for (const [surface, normalized] of Object.entries(FAVORITE_SUBJECT_KEY)) {
    if (normalized === norm) keys.push(`preferences.favorite.${surface}`)
  }
  return [...new Set(keys)]
}

/**
 * Same article-stripping / capture clean used by favorite writers and revoke matching.
 * @param {string} value
 * @returns {string}
 */
export function cleanFavoritePreferenceValue(value) {
  let v = cleanCapture(value)
  v = v.replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
  return cleanCapture(v)
}

/**
 * Extract the value slug from a singular favorite content gloss.
 * Reused by singular favorite revocation for exact stored-value matching.
 * @param {string} content
 * @returns {string}
 */
export function favoriteValueSlugFromContent(content) {
  const text = String(content || '')
  const afterColon = text.match(/:\s*(.+?)(?:\.|$)/)
  const raw = cleanFavoritePreferenceValue(afterColon?.[1] || text)
  return slugifyFactKeyPart(raw)
}

/**
 * Single-valued fact_key slots must keep exactly one active/current row.
 * Multi-valued keys (interests, generic likes, projects-by-value) are excluded.
 *
 * @param {string | null | undefined} factKey
 * @returns {boolean}
 */
export function isSingleValuedFactKey(factKey) {
  const key = typeof factKey === 'string' ? factKey.trim() : ''
  if (!key) return false
  if (key.startsWith('preferences.favorite.')) return true
  if (key === 'identity.name' || key === 'identity.location') return true
  if (key === 'settings.reply_style' || key === 'settings.theme' || key === 'settings.preferred') {
    return true
  }
  if (/^relationships\.pet\.[^.]+\.name$/.test(key)) return true
  if (key === 'projects.primary') return true
  if (key === 'skills.profession') return true
  return false
}

/** High-confidence color vocabulary for legacy favorite-color predecessors (IT/EN). */
const FAVORITE_COLOR_VALUES = new Set([
  'blu',
  'blue',
  'azzurro',
  'celeste',
  'cyan',
  'turchese',
  'turquoise',
  'rosso',
  'red',
  'scarlatto',
  'bordeaux',
  'verde',
  'green',
  'giallo',
  'yellow',
  'arancione',
  'orange',
  'viola',
  'purple',
  'violet',
  'lilla',
  'magenta',
  'rosa',
  'pink',
  'nero',
  'black',
  'bianco',
  'white',
  'grigio',
  'gray',
  'grey',
  'marrone',
  'brown',
  'beige',
  'oro',
  'gold',
  'argento',
  'silver',
  'indaco',
  'indigo',
  'teal',
])

/** High-confidence animal vocabulary for legacy favorite-animal predecessors (IT/EN). */
const FAVORITE_ANIMAL_VALUES = new Set([
  'cane',
  'dog',
  'cagna',
  'puppy',
  'gatto',
  'cat',
  'micetto',
  'micia',
  'kitten',
  'lupo',
  'wolf',
  'cavallo',
  'horse',
  'leone',
  'lion',
  'tigre',
  'tiger',
  'orso',
  'bear',
  'volpe',
  'fox',
  'coniglio',
  'rabbit',
  'uccello',
  'bird',
  'pesce',
  'fish',
  'serpente',
  'snake',
  'delfino',
  'dolphin',
  'elefante',
  'elephant',
  'gufo',
  'owl',
  'panda',
  'koala',
  'pinguino',
  'penguin',
  'drago',
  'dragon',
])

/**
 * @param {string} value
 * @returns {string}
 */
function stripLeadingArticles(value) {
  return normalizeText(value).replace(
    /^(?:il|la|lo|gli|le|l|un|una|uno|a|an|the|my|mio|mia)\s+/,
    '',
  )
}

/** ASCII or curly apostrophe in "User's" / historical extractor text. */
const USER_POSSESSIVE_RE = String.raw`user[''\u2019]?s`

/**
 * @param {string} content
 * @returns {string | null}
 */
function extractLegacyPreferenceValue(content) {
  const text = String(content || '')
  const favorite = text.match(
    new RegExp(`${USER_POSSESSIVE_RE}\\s+favorite(?:\\s+[^:]+)?:\\s*(.+?)(?:\\.|$)`, 'i'),
  )
  const prefers = text.match(/likes\s*\/\s*prefers:\s*(.+?)(?:\.|$)/i)
  const raw = favorite?.[1] || prefers?.[1]
  if (!raw) return null
  return String(raw)
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s.!?]+$/g, '')
    .replace(/^(?:di\s+pi[uù]\s+)/i, '')
    .trim()
}

/**
 * @param {string} value
 * @param {Set<string>} vocab
 * @returns {boolean}
 */
function valueMatchesVocab(value, vocab) {
  const stripped = stripLeadingArticles(value)
  if (!stripped) return false
  const slug = slugifyFactKeyPart(stripped)
  if (vocab.has(slug)) return true
  for (const token of tokenize(stripped)) {
    if (vocab.has(token)) return true
  }
  return false
}

/**
 * Reverse map normalized subject → surface forms that appear in legacy content.
 * @param {string} subjectKey
 * @returns {string[]}
 */
function favoriteSubjectSurfaceForms(subjectKey) {
  const key = normalizeFavoriteSubjectKey(subjectKey)
  const forms = [key]
  for (const [surface, normalized] of Object.entries(FAVORITE_SUBJECT_KEY)) {
    if (normalized === key) forms.push(surface)
  }
  return [...new Set(forms)]
}

/**
 * High-confidence check: does this untagged active row represent the same
 * logical single-valued slot as factKey? Conservative — never merges generic
 * preferences / multi-valued interests.
 *
 * @param {any} row
 * @param {string | null | undefined} factKey
 * @returns {boolean}
 */
export function isLegacyPredecessorForFactKey(row, factKey) {
  if (!row || !isSingleValuedFactKey(factKey)) return false

  const status = String(row.status || row.Status || 'active').toLowerCase()
  if (status === 'obsolete' || status === 'archived' || status === 'deleted' || status === 'inactive') {
    return false
  }

  const existingKey = readFactKeyFromTags(row.tags || row.Tags || [])
  // Already keyed to this or another slot — not a legacy predecessor.
  if (existingKey) return false

  const title = String(row.title || row.Title || '').trim()
  const content = String(row.content || row.Content || '')
  const category = String(row.category || row.Category || '')
    .trim()
    .toLowerCase()

  if (factKey === 'preferences.favorite.color') {
    return isLegacyFavoriteColorPredecessor(title, content, category)
  }
  if (factKey === 'preferences.favorite.animal') {
    return isLegacyFavoriteAnimalPredecessor(title, content, category)
  }

  const favoriteMatch = String(factKey).match(/^preferences\.favorite\.(.+)$/)
  if (favoriteMatch?.[1]) {
    return isLegacyFavoriteSubjectPredecessor(title, content, category, favoriteMatch[1])
  }

  return isLegacyNonFavoriteSingleValuedPredecessor(row, factKey)
}

/**
 * @param {string} title
 * @param {string} content
 * @param {string} category
 * @returns {boolean}
 */
function isLegacyFavoriteColorPredecessor(title, content, category) {
  if (category && !['preferences', 'tastes', 'hobbies'].includes(category)) return false

  const favoriteColorSubject = new RegExp(
    `${USER_POSSESSIVE_RE}\\s+favorite\\s+(?:colore|color|colour)\\s*:`,
    'i',
  )
  // Structured subject forms (PR2+): User's favorite colore/color: …
  if (favoriteColorSubject.test(content)) return true

  const bareFavorite = new RegExp(`${USER_POSSESSIVE_RE}\\s+favorite\\s*:`, 'i')
  // Bare favorite/value forms — title may be Favorite or historical variants.
  if (bareFavorite.test(content) && !favoriteColorSubject.test(content)) {
    // Exclude other explicit subjects (anime, game, …); only bare "favorite:" slot.
    const hasOtherSubject = new RegExp(
      `${USER_POSSESSIVE_RE}\\s+favorite\\s+(?!colore|color|colour)[^:]+:`,
      'i',
    )
    if (!hasOtherSubject.test(content)) {
      const value = extractLegacyPreferenceValue(content)
      if (value && valueMatchesVocab(value, FAVORITE_COLOR_VALUES)) return true
    }
  }

  // Historical Preference rows that clearly name a color value only.
  if (/^preference$/i.test(String(title || '').trim()) && /likes\s*\/\s*prefers\s*:/i.test(content)) {
    const value = extractLegacyPreferenceValue(content)
    return Boolean(value && valueMatchesVocab(value, FAVORITE_COLOR_VALUES))
  }

  return false
}

/**
 * @param {string} title
 * @param {string} content
 * @param {string} category
 * @returns {boolean}
 */
function isLegacyFavoriteAnimalPredecessor(title, content, category) {
  if (category && !['preferences', 'tastes', 'hobbies'].includes(category)) return false

  const favoriteAnimalSubject = new RegExp(
    `${USER_POSSESSIVE_RE}\\s+favorite\\s+(?:animale|animal)\\s*:`,
    'i',
  )
  if (favoriteAnimalSubject.test(content)) return true

  const bareFavorite = new RegExp(`${USER_POSSESSIVE_RE}\\s+favorite\\s*:`, 'i')
  if (bareFavorite.test(content)) {
    const hasOtherSubject = new RegExp(
      `${USER_POSSESSIVE_RE}\\s+favorite\\s+(?!animale|animal)[^:]+:`,
      'i',
    )
    if (!hasOtherSubject.test(content)) {
      const value = extractLegacyPreferenceValue(content)
      if (value && valueMatchesVocab(value, FAVORITE_ANIMAL_VALUES)) return true
    }
  }

  if (/^preference$/i.test(String(title || '').trim()) && /likes\s*\/\s*prefers\s*:/i.test(content)) {
    const value = extractLegacyPreferenceValue(content)
    return Boolean(value && valueMatchesVocab(value, FAVORITE_ANIMAL_VALUES))
  }

  return false
}

/**
 * Subject-scoped favorite legacy forms (e.g. preferences.favorite.food).
 * Requires an explicit subject in content — never consolidates bare Preference.
 *
 * @param {string} title
 * @param {string} content
 * @param {string} category
 * @param {string} subjectKey
 * @returns {boolean}
 */
function isLegacyFavoriteSubjectPredecessor(title, content, category, subjectKey) {
  if (category && !['preferences', 'tastes', 'hobbies'].includes(category)) return false
  const forms = favoriteSubjectSurfaceForms(subjectKey)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  if (!forms) return false
  const subjectRe = new RegExp(`${USER_POSSESSIVE_RE}\\s+favorite\\s+(?:${forms})\\s*:`, 'i')
  if (subjectRe.test(content)) return true
  // Bare Favorite without subject is only safe for color/animal (handled above).
  return false
}

/**
 * Conservative legacy matchers for non-favorite single-valued slots.
 * Only exact historical extractor shapes — never preferred-name → identity.name.
 *
 * @param {any} row
 * @param {string} factKey
 * @returns {boolean}
 */
function isLegacyNonFavoriteSingleValuedPredecessor(row, factKey) {
  const title = String(row.title || row.Title || '').trim()
  const content = String(row.content || row.Content || '')
  const category = String(row.category || row.Category || '')
    .trim()
    .toLowerCase()

  if (factKey === 'identity.name') {
    if (category && category !== 'identity') return false
    return (
      /^name$/i.test(title) ||
      new RegExp(`${USER_POSSESSIVE_RE}\\s+name\\s+is\\b`, 'i').test(content)
    )
  }

  if (factKey === 'identity.location') {
    if (category && category !== 'identity') return false
    return (
      /^location$/i.test(title) ||
      /\blives\s+in\b|\bis\s+from\b/i.test(content)
    )
  }

  if (factKey === 'settings.reply_style') {
    if (category && category !== 'settings') return false
    return /reply\s+preference/i.test(title) || /detailed\s+replies|concise\s+replies|rispost/i.test(content)
  }

  if (factKey === 'settings.theme') {
    if (category && category !== 'settings') return false
    return /theme/i.test(title) || /\b(tema|theme|dark|light|scuro|chiaro)\b/i.test(content)
  }

  if (/^relationships\.pet\.[^.]+\.name$/.test(factKey)) {
    if (category && category !== 'relationships') return false
    return /^pet$/i.test(title) || /\bis\s+named\b/i.test(content)
  }

  if (factKey === 'projects.primary') {
    if (category && category !== 'projects') return false
    return /\bprimary\b/i.test(title) || /\bprimary\s+project\b|\bprogetto\s+principale\b/i.test(content)
  }

  if (factKey === 'skills.profession') {
    if (category && !['skills', 'profession'].includes(category)) return false
    return /^profession$/i.test(title) || /\bprofession\b|\brole:/i.test(content)
  }

  return false
}

/**
 * Active rows that conflict with a single-valued fact_key write:
 * same key duplicates, or high-confidence untagged legacy predecessors.
 *
 * @param {any} row
 * @param {string | null | undefined} factKey
 * @param {string | null | undefined} keepId
 * @returns {boolean}
 */
export function isConflictingActiveSlotRow(row, factKey, keepId) {
  if (!row || !isSingleValuedFactKey(factKey)) return false
  if (keepId != null && String(row.id) === String(keepId)) return false

  const status = String(row.status || row.Status || 'active').toLowerCase()
  if (status === 'obsolete' || status === 'archived' || status === 'deleted' || status === 'inactive') {
    return false
  }

  const existingKey = readFactKeyFromTags(row.tags || row.Tags || [])
  if (existingKey === factKey) return true
  return isLegacyPredecessorForFactKey(row, factKey)
}

/**
 * Pick the best legacy predecessor to migrate in-place (newest, then overlap).
 *
 * @param {any[]} rows
 * @param {string | null | undefined} factKey
 * @param {string} [content]
 * @returns {any | null}
 */
export function selectLegacyPredecessorTarget(rows, factKey, content = '') {
  if (!isSingleValuedFactKey(factKey)) return null
  const legacy = (Array.isArray(rows) ? rows : []).filter((row) =>
    isLegacyPredecessorForFactKey(row, factKey),
  )
  if (legacy.length === 0) return null

  const contentNorm = normalizeText(content)
  let best = null
  let bestOverlap = -1
  let bestUpdated = -1
  for (const row of legacy) {
    const overlap = contentNorm
      ? tokenOverlapScore(contentNorm, normalizeText(row.content))
      : 0
    const updated = Date.parse(row.updated_at || row.updatedAt || 0) || 0
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && updated > bestUpdated) ||
      (best == null && overlap === bestOverlap && updated === bestUpdated)
    ) {
      best = row
      bestOverlap = overlap
      bestUpdated = updated
    }
  }
  return best
}

/**
 * Derive a stable fact_key from an extracted candidate.
 * Single-valued slots (favorites, name, pet name, reply style) collide across updates.
 * Multi-valued collections (interests, projects, skills) are scoped by value slug.
 *
 * @param {{ category?: string, title?: string, content?: string, factKey?: string | null }} fact
 * @param {{ userMessage?: string }} [context]
 * @returns {string | null}
 */
export function deriveFactKey(fact, context = {}) {
  if (typeof fact?.factKey === 'string' && fact.factKey.trim()) {
    return fact.factKey.trim()
  }

  const category = String(fact?.category || '')
    .trim()
    .toLowerCase()
  const title = String(fact?.title || '').trim()
  const content = String(fact?.content || '').trim()
  const userMessage = String(context.userMessage || '')

  if (category === 'identity') {
    if (/^name$/i.test(title) || /user'?s name is/i.test(content)) return 'identity.name'
    if (/^location$/i.test(title) || /lives in|is from/i.test(content)) return 'identity.location'
  }

  if (category === 'settings') {
    if (/reply preference/i.test(title) || /detailed replies|concise replies|rispost/i.test(content)) {
      return 'settings.reply_style'
    }
    if (/theme/i.test(title) || /theme|tema|dark|light|scuro|chiaro/i.test(content)) {
      return 'settings.theme'
    }
    if (/preferred setting/i.test(title)) return 'settings.preferred'
  }

  if (category === 'preferences' || category === 'tastes') {
    if (/^co-?favorite$/i.test(title) || /\bcofavorite\b/i.test(String(fact?.factKey || ''))) {
      const subjectMatch = content.match(/user'?s favorite\s+([^:]+):\s*(.+?)(?:\.|$)/i)
      if (subjectMatch?.[1] && subjectMatch?.[2]) {
        return buildCofavoriteFactKey(subjectMatch[1], subjectMatch[2])
      }
    }
    const favoriteSubject = content.match(/user'?s favorite\s+([^:]+):/i)
    if (favoriteSubject?.[1] || /^favorite$/i.test(title)) {
      const subject = normalizeFavoriteSubjectKey(favoriteSubject?.[1] || 'item')
      return `preferences.favorite.${subject}`
    }
    if (/^dislike$/i.test(title) || /dislikes:/i.test(content)) {
      const value = content.replace(/^.*dislikes:\s*/i, '')
      return `preferences.dislike.${slugifyFactKeyPart(value)}`
    }
    if (/^interest$/i.test(title) || /interested in:/i.test(content)) {
      const value = content.replace(/^.*interested in:\s*/i, '')
      return `preferences.interest.${slugifyFactKeyPart(value)}`
    }
    if (/^preference$/i.test(title) || /likes\s*\/\s*prefers:/i.test(content)) {
      const value = content.replace(/^.*likes\s*\/\s*prefers:\s*/i, '')
      // Preferred display name must NOT collide with legal identity.name
      if (/farmi\s+chiamare|call\s+me|chiamarmi/i.test(value) || /farmi\s+chiamare|call\s+me/i.test(userMessage)) {
        return `preferences.preferred_name.${slugifyFactKeyPart(value)}`
      }
      return `preferences.like.${slugifyFactKeyPart(value)}`
    }
  }

  if (category === 'relationships') {
    if (/^pet$/i.test(title) || /is named /i.test(content)) {
      const speciesMatch = content.match(/user'?s\s+(\w+)\s+is named/i)
      const speciesRaw = speciesMatch?.[1] || 'pet'
      const species = PET_SPECIES_KEY[speciesRaw.toLowerCase()] || slugifyFactKeyPart(speciesRaw)
      return `relationships.pet.${species}.name`
    }
    const roleMatch = content.match(/relationship:\s*([^\s—-]+)/i)
    if (roleMatch?.[1]) {
      return `relationships.${slugifyFactKeyPart(roleMatch[1])}`
    }
  }

  if (category === 'projects') {
    if (
      /\bprogetto\s+principale\b|\bmain\s+project\b|\bprimary\s+project\b/i.test(userMessage) ||
      /\bprimary\b/i.test(title)
    ) {
      return 'projects.primary'
    }
    const value = content.replace(/^.*project:\s*/i, '')
    return `projects.${slugifyFactKeyPart(value)}`
  }

  if (category === 'goals') {
    if (/learning goal/i.test(title) || /wants to learn:/i.test(content)) {
      const value = content.replace(/^.*wants to learn:\s*/i, '')
      return `goals.learning.${slugifyFactKeyPart(value)}`
    }
    const value = content.replace(/^.*goal:\s*/i, '')
    return `goals.${slugifyFactKeyPart(value)}`
  }

  if (category === 'skills' || category === 'profession') {
    if (/^learning$/i.test(title) || /is learning:/i.test(content)) {
      const value = content.replace(/^.*is learning:\s*/i, '')
      return `skills.learning.${slugifyFactKeyPart(value)}`
    }
    if (/^studies$/i.test(title) || /studies:/i.test(content)) {
      const value = content.replace(/^.*studies:\s*/i, '')
      return `skills.studies.${slugifyFactKeyPart(value)}`
    }
    if (/^profession$/i.test(title) || /profession|role:/i.test(content)) {
      return 'skills.profession'
    }
  }

  if (category === 'habits' || category === 'hobbies') {
    if (/hobby/i.test(title)) {
      const value = content.replace(/^.*hobby:\s*/i, '')
      return `habits.hobby.${slugifyFactKeyPart(value)}`
    }
    const value = content.replace(/^.*uses:\s*/i, '')
    return `habits.tools.${slugifyFactKeyPart(value)}`
  }

  if (category === 'events' || category === 'important') {
    return `events.${slugifyFactKeyPart(title || content)}`
  }

  return null
}

/**
 * Lightweight update cues — improve conflict handling without new NLP.
 * @param {string} text
 * @returns {boolean}
 */
export function hasMemoryUpdateCue(text) {
  return /\b(?:ora|adesso|in\s+realt[aà]|actually|now)\b/i.test(String(text || ''))
}

function cleanCapture(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s.!?]+$/g, '')
    .trim()
}

/**
 * Pre-save safety gate (Extraction V2 PR1).
 * Blocks secrets, credentials, and crisis content from becoming durable memory.
 * Explicit "remember" intent must never bypass this.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsUnsafeMemoryMaterial(text) {
  const t = String(text || '')
  if (!t.trim()) return false

  // API keys / provider secrets
  if (/\bsk-[a-zA-Z0-9_-]{8,}\b/.test(t)) return true
  if (/\bsk-proj-[a-zA-Z0-9_-]{8,}\b/.test(t)) return true
  if (/\b(?:api[_-]?key|secret[_-]?key)\b/i.test(t) && /[a-zA-Z0-9_-]{12,}/.test(t)) {
    return true
  }

  // Passwords
  if (
    /\b(?:password|passwd|pwd|passphrase)\b\s*[:=]\s*\S+/i.test(t) ||
    /\b(?:password|passwd|pwd|la\s+mia\s+password|my\s+password)\b.{0,24}\b(?:is|è|=|:)\b/i.test(
      t,
    )
  ) {
    return true
  }

  // Access / bearer / refresh tokens + JWTs
  if (/\bBearer\s+[A-Za-z0-9._\-+/=]{12,}/i.test(t)) return true
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(t)) return true
  if (/\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token)\b/i.test(t)) {
    return true
  }

  // Private keys
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(t)) return true

  // Connection strings
  if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\//i.test(t)) {
    return true
  }
  if (/\bServer\s*=\s*[^;]+;[\s\S]{0,80}Password\s*=/i.test(t)) return true

  // Card / banking credentials
  if (
    /\b(?:carta\s+di\s+credito|credit\s+card|debit\s+card|cvv|cvc|iban|pan|routing\s+number)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/.test(t) && /\biban\b/i.test(t)) return true

  // OTP / verification codes
  if (
    /\b(?:otp|one[- ]time\s+pass(?:word|code)?|codice\s+di\s+verifica|verification\s+code|2fa\s+code|auth(?:entication)?\s+code)\b/i.test(
      t,
    )
  ) {
    return true
  }

  // Clearly sensitive government / identity numbers when labeled
  if (
    /\b(?:codice\s+fiscale|social\s+security(?:\s+number)?|\bssn\b|numero\s+di\s+passaporto|passport\s+number)\b/i.test(
      t,
    )
  ) {
    return true
  }

  // Acute distress / crisis — must not become durable profile facts
  if (
    /\b(?:suicid(?:io|al|e)?|autolesion\w*|self[- ]?harm|kill\s+myself|end\s+my\s+life|voglio\s+morire|non\s+voglio\s+pi[uù]\s+vivere|mi\s+(?:voglio\s+)?uccidere|want\s+to\s+die|hurt\s+myself)\b/i.test(
      t,
    )
  ) {
    return true
  }

  return false
}

/**
 * Strip explicit memory-intent wrappers so inner propositions use normal rule families.
 * @param {string} message
 * @returns {{ inner: string, explicitIntent: boolean }}
 */
export function stripExplicitMemoryIntent(message) {
  const raw = String(message || '').trim()
  if (!raw) return { inner: '', explicitIntent: false }

  const patterns = [
    /^remember\s+this\s+for\s+later\s*:?\s*/i,
    /^ricordati\s+per\s+dopo\s*:?\s*/i,
    /^ricordati\s+che\s+/i,
    /^non\s+dimenticare(?:\s+che)?\s+/i,
    /^don['\u2019]?t\s+forget(?:\s+that)?\s+/i,
    /^do\s+not\s+forget(?:\s+that)?\s+/i,
    /^please\s+remember(?:\s+that)?\s*:?\s*/i,
    /^remember\s+that\s+/i,
    /^ricorda\s+che\s+/i,
  ]

  for (const pattern of patterns) {
    if (pattern.test(raw)) {
      const inner = raw.replace(pattern, '').trim()
      return { inner: inner || raw, explicitIntent: true }
    }
  }

  return { inner: raw, explicitIntent: false }
}

/**
 * Ephemeral gate. With explicit intent, allow slightly weaker durability cues
 * (skip momentary / short-question filters) but still reject empty chatter.
 * @param {string} userMessage
 * @param {{ explicitIntent?: boolean }} [options]
 */
export function isEphemeralNoise(userMessage, options = {}) {
  const text = String(userMessage || '').trim()
  const explicitIntent = options.explicitIntent === true
  if (!text) return true
  if (text.length < (explicitIntent ? 4 : 6)) return true

  // Pure greetings / thanks / fillers
  if (
    /^(ciao|hey|hi|hello|hola|salve|buongiorno|buonasera|ok|okay|va\s+bene|perfetto|grazie|thanks|thank\s+you|thx)[\s!.?]*$/i.test(
      text,
    )
  ) {
    return true
  }

  // Time / weather / calc / momentary lookups — never durable
  if (
    /\b(che\s+ore\s+sono|what\s+time\s+is\s+it|ora\s+attuale)\b/i.test(text) ||
    /\b(che\s+tempo\s+fa|meteo|weather|forecast|piove)\b/i.test(text) ||
    /\b(calcola|quanto\s+fa|calculate)\b/i.test(text) ||
    /(?:^|[^\w])\d+\s*[\+\-\*\/×÷]\s*\d/.test(text)
  ) {
    return true
  }

  if (explicitIntent) {
    // Explicit remember: allow borderline durability; still not pure greetings/lookups.
    return false
  }

  const durableCue =
    /\b(mi\s+chiamo|il\s+mio\s+nome|sono\s+(?:un|una)|preferisco|preferit\w*|favorite|mi\s+piace|non\s+mi\s+piace|odio|amo|adoro|appassionat\w*|hobby|lavoro|studio|imparando|imparare|obiettivo|progetto|sto\s+(?:sviluppando|creando|lavorando)|ricorda|sempre|mai|uso|utilizzo|abito|vivo|cane|gatto|my\s+name|i\s+am|i'm|i\s+prefer|i\s+like|i\s+love|i\s+hate|i\s+work|i\s+study|i\s+use|learning|studying|my\s+goal|my\s+favorite|my\s+dog|my\s+cat|remember\s+that|always|never|developing|building|working\s+on)\b/i.test(
      text,
    )

  // Momentary chatter without durable language
  const momentary =
    /\b(oggi|stasera|domani|ieri|adesso|tra\s+poco|tra\s+un'?ora|this\s+morning|tonight|tomorrow|yesterday|right\s+now|fra\s+poco)\b/i.test(
      text,
    )
  if (momentary && !durableCue) return true

  // Short question-only / temporary questions
  if (text.endsWith('?') && text.length < 56 && !durableCue) return true

  // Generic help requests without personal facts
  if (
    /^(aiutami|help\s+me|come\s+si\s+fa|how\s+(?:do|can)\s+i)\b/i.test(text) &&
    !durableCue
  ) {
    return true
  }

  return false
}

/**
 * Extract all durable facts from a user turn (IT + EN).
 * Auto-classifies into intelligent categories — never asks the user.
 * @returns {Array<{category:string,title:string,content:string,importance:number,source?:string,confidence?:number}>}
 */
export function extractDurableFacts(userMessage) {
  const raw = String(userMessage || '').trim()
  if (!raw) return []

  // Safety gate — before intent normalization and before any rule match.
  if (containsUnsafeMemoryMaterial(raw)) return []

  const { inner, explicitIntent } = stripExplicitMemoryIntent(raw)
  const user = String(inner || '').trim()
  if (!user) return []
  if (containsUnsafeMemoryMaterial(user)) return []
  if (isEphemeralNoise(user, { explicitIntent })) return []

  const factMeta = {
    source: explicitIntent ? 'explicit' : 'automatic',
    confidence: explicitIntent ? 0.95 : 0.8,
  }

  /** @type {Array<{category:string,title:string,content:string,importance:number,source?:string,confidence?:number,factKey?:string|null,tags?:string[]}>} */
  const facts = []

  const push = (category, title, content, importance, extra = {}) => {
    const cleaned = cleanCapture(content)
    if (!cleaned || cleaned.length < 4) return
    if (containsUnsafeMemoryMaterial(cleaned)) return
    const factKey =
      extra.factKey ||
      deriveFactKey(
        { category, title, content: cleaned, factKey: extra.factKey },
        { userMessage: user },
      )
    facts.push(
      decision(category, title, cleaned, importance, {
        ...factMeta,
        factKey,
      }),
    )
  }

  // —— Identità ——
  const namePatterns = [
    /(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè])\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'-]{1,40})/i,
    /(?:my\s+name\s+is|i(?:'m|\s+am)\s+called)\s+([A-Za-z][\w'-]{1,40})/i,
  ]
  for (const pattern of namePatterns) {
    const match = user.match(pattern)
    const name = match?.[1]?.trim()
    if (name && !/^(un|una|il|la|lo|gli|le|a|an|the|not|non|di|da)$/i.test(name)) {
      push('identity', 'Name', `User's name is ${name}.`, 9, { factKey: 'identity.name' })
      break
    }
  }

  const location =
    user.match(
      /(?:abito\s+(?:a|in)|vivo\s+(?:a|in)|sono\s+di)\s+([A-ZÀ-ÖØ-Ý][^,.!?\n]{1,40})/i,
    ) ||
    user.match(/(?:i\s+live\s+in|i(?:'m|\s+am)\s+from)\s+([A-Z][^,.!?\n]{1,40})/i)
  if (location?.[1]) {
    push(
      'identity',
      'Location',
      `User lives in / is from: ${cleanCapture(location[1])}.`,
      7,
      { factKey: 'identity.location' },
    )
  }

  // —— Preferenze (like ↔ dislike polarity) ——
  // Interrogative / third-party / meta / hypothetical → no polarity writes.
  const skipPolarity = shouldSkipPreferencePolarityExtraction(user)

  let dislikeMatched = false
  if (!skipPolarity) {
    const dislikeValue = extractDislikePreferenceValue(user)
    if (dislikeValue && dislikeValue.length >= 2) {
      dislikeMatched = true
      push('preferences', 'Dislike', `User dislikes: ${dislikeValue}.`, 6, {
        factKey: `preferences.dislike.${slugifyFactKeyPart(dislikeValue)}`,
      })
    }
  }

  /** Reject momentary deixis: "Adoro questa risposta!", "I love this!" */
  const isMomentaryInterestObject = (value) =>
    /^(?:quest[oa]|questo|questa|quello|quella|this|that|it|la\s+risposta|questa\s+risposta|this\s+(?:reply|answer|message|one)|that\s+(?:reply|answer|one))\b/i.test(
      String(value || '').trim(),
    )

  let preferenceMatched = dislikeMatched
  if (!skipPolarity && !dislikeMatched) {
    const likeValue = extractLikePreferenceValue(user)
    // Also allow "Ho cambiato idea, mi piace X" via extractLike; fallback preferisco.
    if (likeValue && likeValue.length >= 2 && !isMomentaryInterestObject(likeValue)) {
      if (
        /\b(rispost[ea]|dettagliat|concis|brevi|lungh|emoji|tono|stile|markdown)\b/i.test(
          likeValue,
        )
      ) {
        push('settings', 'Reply preference', `User prefers: ${likeValue}.`, 8, {
          factKey: 'settings.reply_style',
        })
      } else {
        preferenceMatched = true
        push('preferences', 'Preference', `User likes / prefers: ${likeValue}.`, 6, {
          factKey: `preferences.like.${slugifyFactKeyPart(likeValue)}`,
        })
      }
    }
  }

  // —— Favorites / co-favorites (TYPE A singular + TYPE B multi) ——
  // Order: revoke extract → interrogative/negation gate → partitive → plural → singular.
  // Partitive must run before singular so "One of my favorite characters is X"
  // cannot become preferences.favorite.characters.
  // Note: do not use \b after "è" — JS \w excludes accented letters.
  const favoriteIsQuestion = isFavoritePreferenceQuestion(user)
  const skipFavoriteRevoke = shouldSkipFavoriteRevocation(user)
  let favoriteRevokeMatched = false
  if (!skipFavoriteRevoke) {
    for (const rev of extractFavoriteRevokeCandidates(user)) {
      const title = rev.targetType === 'cofavorite' ? 'Revoke co-favorite' : 'Revoke favorite'
      const content = `Revoke ${rev.targetType} ${rev.subject}: ${rev.value}.`
      const item = decision('preferences', title, content, 8, {
        ...factMeta,
        factKey: rev.factKey,
      })
      facts.push({
        ...item,
        operation: 'revoke',
        targetType: rev.targetType,
        subject: rev.subject,
        value: rev.value,
      })
      favoriteRevokeMatched = true
    }
  }

  // High-confidence cofavorite set replacement (before additive plural asserts).
  let replaceSetMatched = false
  let replaceSetOverflowBlocked = false
  if (!favoriteIsQuestion && !shouldSkipFavoriteSetReplacement(user)) {
    const rep = extractCofavoriteReplaceSetCandidate(user)
    if (rep?.overflow) {
      replaceSetOverflowBlocked = true
    } else if (rep?.values?.length && rep.factKeys?.length) {
      const content = `Replace cofavorite set ${rep.subject}: ${rep.values.join(', ')}.`
      const item = decision('preferences', 'Replace co-favorite set', content, 8, {
        ...factMeta,
        factKey: rep.factKeys[0] || null,
      })
      facts.push({
        ...item,
        operation: 'replace_set',
        targetType: 'cofavorite',
        subject: rep.subject,
        values: rep.values,
        factKeys: rep.factKeys,
      })
      replaceSetMatched = true
    }
  }

  const favoriteLanguageNegated =
    favoriteRevokeMatched ||
    (/\bnon\s+(?:è|e)\s+/i.test(user) && /\b(?:preferit|favorite)/i.test(user)) ||
    (/\bis\s+not\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
    (/\bare\s+not\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
    (/\bnon\s+sono\b/i.test(user) && /\bpreferit/i.test(user)) ||
    // Close EN false-write: "is no longer" / "isn't" / "aren't" must not assert favorites.
    (/\bno\s+longer\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
    (/\bisn'?t\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
    (/\baren'?t\b/i.test(user) && /\bfavorite\b/i.test(user))

  let favoriteMatched = false
  let cofavoriteMatched = replaceSetMatched

  const pushCofavorite = (subjectRaw, valueRaw) => {
    const subjectKey = normalizeFavoriteSubjectKey(subjectRaw)
    const subjectSurface = cleanCapture(subjectRaw).toLowerCase() || subjectKey
    // Tight open-set filler strip (anche/also) — not exhaustive replacement cues.
    const value = cleanFavoritePreferenceValue(
      String(valueRaw || '').replace(/^(?:anche|also)\s+/i, ''),
    )
    if (subjectKey.length < 2 || value.length < 2) return false
    if (isInterrogativeFavoriteValue(value)) return false
    if (/^(tema|theme)$/i.test(subjectKey)) return false
    const factKey = buildCofavoriteFactKey(subjectKey, value)
    if (
      facts.some(
        (f) =>
          f.factKey === factKey &&
          f.operation !== 'revoke' &&
          f.operation !== 'replace_set',
      )
    ) {
      return true
    }
    push(
      'preferences',
      'Co-favorite',
      `User's favorite ${subjectSurface}: ${value}.`,
      6,
      { factKey },
    )
    return true
  }

  const pushSingularFavorite = (subjectRaw, valueRaw) => {
    const subjectKey = normalizeFavoriteSubjectKey(subjectRaw)
    const subjectSurface = cleanCapture(subjectRaw).toLowerCase() || subjectKey
    const value = cleanFavoritePreferenceValue(valueRaw)
    const subjectOk =
      subjectKey.length >= 2 &&
      !/^(un|una|il|la|lo|gli|le|a|an|the|my|mio|mia|item)$/i.test(subjectKey)
    if (!subjectOk || value.length < 2) return false
    if (isInterrogativeFavoriteValue(value)) return false
    if (/^(tema|theme)$/i.test(subjectKey) || /\b(scuro|chiaro|dark|light)\b/i.test(value)) {
      push(
        'settings',
        'Theme preference',
        `User prefers theme / UI: ${value}.`,
        7,
        { factKey: 'settings.theme' },
      )
      return true
    }
    push(
      'preferences',
      'Favorite',
      `User's favorite ${subjectSurface}: ${value}.`,
      6,
      { factKey: `preferences.favorite.${subjectKey}` },
    )
    return true
  }

  // Additive path: skip when replace_set matched, overflow blocked, set-replacement
  // guards (hedge/meta/third-party/question), or same-turn mixed ops.
  if (
    !favoriteLanguageNegated &&
    !favoriteIsQuestion &&
    !replaceSetMatched &&
    !replaceSetOverflowBlocked &&
    !shouldSkipFavoriteSetReplacement(user) &&
    !hasIncompatibleMixedFavoriteOps(user)
  ) {
    // —— TYPE B partitive / one-of (before singular) ——
    const partitiveForward =
      user.match(
        /\bun[oa]\s+dei\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+[eè]\s+([^,.!?\n]{2,80})/i,
      ) ||
      user.match(
        /\bone\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+is\s+([^,.!?\n]{2,80})/i,
      )
    const partitiveReversed =
      !partitiveForward &&
      (user.match(
        /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+[eè]\s+un[oa]\s+dei\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\b/i,
      ) ||
        user.match(
          /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+one\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
        ))

    if (partitiveForward?.[1] && partitiveForward?.[2]) {
      if (pushCofavorite(partitiveForward[1], partitiveForward[2])) {
        cofavoriteMatched = true
        preferenceMatched = true
      }
    } else if (partitiveReversed?.[1] && partitiveReversed?.[2]) {
      if (pushCofavorite(partitiveReversed[2], partitiveReversed[1])) {
        cofavoriteMatched = true
        preferenceMatched = true
      }
    }

    // —— TYPE B plural lists ——
    if (!cofavoriteMatched) {
      const pluralForward =
        user.match(
          /\bi\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+(?:sono|includono)\s+([^.!?\n]{3,120})/i,
        ) ||
        user.match(
          /\btra\s+i\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+(?:ci\s+sono|ho)\s+([^.!?\n]{3,120})/i,
        ) ||
        user.match(
          /\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+are\s+([^.!?\n]{3,120})/i,
        )
      const pluralReversed =
        !pluralForward &&
        (user.match(
          /\b([^.!?\n]{3,120}?)\s+sono\s+i\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\b/i,
        ) ||
          user.match(
            /\b([^.!?\n]{3,120}?)\s+are\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
          ))

      let subjectRaw = null
      let listRaw = null
      if (pluralForward?.[1] && pluralForward?.[2]) {
        subjectRaw = pluralForward[1]
        listRaw = pluralForward[2]
      } else if (pluralReversed?.[1] && pluralReversed?.[2]) {
        listRaw = pluralReversed[1]
        subjectRaw = pluralReversed[2]
      }

      if (subjectRaw && listRaw) {
        const values = splitFavoriteList(listRaw, { maxItems: 3 })
        let any = false
        for (const value of values) {
          if (pushCofavorite(subjectRaw, value)) any = true
        }
        if (any) {
          cofavoriteMatched = true
          preferenceMatched = true
        }
      }
    }

    // —— TYPE A singular (forward + reversed); skip if partitive/plural already matched ——
    if (!cofavoriteMatched) {
      const favoriteForward =
        user.match(
          /(?:(?:il|la)\s+mi[oa]\s+)([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s+[eè]\s+([^,.!?\n]{2,60})/i,
        ) ||
        user.match(
          /(?:my\s+favorite\s+)([A-Za-z][\w'-]{1,40})\s+is\s+([^,.!?\n]{2,60})/i,
        )

      const favoriteReversed =
        !favoriteForward &&
        (user.match(
          /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+[eè]\s+(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
        ) ||
          user.match(
            /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
          ))

      if (favoriteForward?.[1] && favoriteForward?.[2]) {
        if (pushSingularFavorite(favoriteForward[1], favoriteForward[2])) {
          favoriteMatched = true
          preferenceMatched = true
        }
      } else if (favoriteReversed?.[1] && favoriteReversed?.[2]) {
        if (pushSingularFavorite(favoriteReversed[2], favoriteReversed[1])) {
          favoriteMatched = true
          preferenceMatched = true
        }
      }
    }
  }

  if (/\b(tema\s+scuro|dark\s+mode|dark\s+theme|tema\s+chiaro|light\s+mode)\b/i.test(user)) {
    push(
      'settings',
      'Theme preference',
      /\b(scuro|dark)\b/i.test(user)
        ? 'User prefers dark theme.'
        : 'User prefers light theme.',
      7,
      { factKey: 'settings.theme' },
    )
  }

  // Strong durable interests (Adoro / Amo / appassionato / really into).
  // Skip when a structured favorite, cofavorite, or like already covered the turn.
  if (!favoriteMatched && !cofavoriteMatched && !dislikeMatched) {
    const interest =
      user.match(/(?:^|[.!?]\s*)(?:adoro|amo)\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:sono\s+appassionat[oa]\s+di)\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:i(?:'m|\s+am)\s+really\s+into)\s+([^,.!?\n]{2,60})/i)
    if (interest?.[1]) {
      const value = cleanCapture(interest[1])
      if (value.length >= 2 && !isMomentaryInterestObject(value)) {
        // Avoid duplicate near-identical preference if like already matched same object.
        const already =
          preferenceMatched &&
          facts.some(
            (f) =>
              f.category === 'preferences' &&
              normalizeText(f.content).includes(normalizeText(value).slice(0, 24)),
          )
        if (!already) {
          preferenceMatched = true
          push('preferences', 'Interest', `User is interested in: ${value}.`, 6)
        }
      }
    }
  }

  // —— Primary project (explicit main/primary only; before generic projects) ——
  // Requires explicit primary/main language — never inferred from "sto lavorando su X".
  let projectMatched = false
  const primaryProjectPatterns = [
    // IT: Il mio progetto principale è / si chiama X
    /(?:(?:il|la)\s+mi[oa]\s+progetto\s+principale\s+(?:[eè]|si\s+chiama)\s+)([^,.!?\n]{2,90})/i,
    // IT: Il progetto principale (su cui sto lavorando) è X
    /(?:il\s+progetto\s+principale(?:\s+su\s+cui\s+sto\s+lavorando)?\s+[eè]\s+)([^,.!?\n]{2,90})/i,
    // IT: X è il mio progetto principale / X è il progetto principale…
    /^([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,80}?)\s+[eè]\s+(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\b/i,
    // EN: My main/primary project is / is called X
    /(?:my\s+(?:main|primary)\s+project\s+(?:is(?:\s+called)?)\s+)([^,.!?\n]{2,90})/i,
    // EN: The main project I'm working on is X
    /(?:the\s+main\s+project\s+i(?:'m|\s+am)\s+working\s+on\s+is\s+)([^,.!?\n]{2,90})/i,
    // EN: X is my main/primary project
    /^([A-Za-z0-9][^,.!?\n]{0,80}?)\s+is\s+my\s+(?:main|primary)\s+project\b/i,
  ]
  for (const pattern of primaryProjectPatterns) {
    const match = user.match(pattern)
    if (!match?.[1]) continue
    const value = cleanCapture(match[1])
    // Reject only bare deixis/articles as the entire value — keep phrases like
    // "il mio nuovo sito" / "un'app per gestire il fotovoltaico".
    if (
      value.length < 2 ||
      /^(questo|quello|this|that|it|il|la|lo|un|una|a|an|the)$/i.test(value)
    ) {
      continue
    }
    // Reject bare activity verbs mistaken as project names
    if (/^(sto|stiamo|working|allen|studi|impar|perdere|cercando)\b/i.test(value)) continue
    projectMatched = true
    push('projects', 'Primary project', `User's primary project: ${value}.`, 8, {
      factKey: 'projects.primary',
    })
    break
  }

  // —— Progetti generici (before habits so "lavoro su X" is not also a habit) ——
  // Do not promote these to projects.primary — requires explicit primary/main language above.
  const project =
    user.match(
      /(?:sto\s+(?:sviluppando|creando|costruendo|lavorando\s+(?:su|a))\s+|lavoro\s+su\s+|il\s+mio\s+progetto\s+[eè]\s+)([^,.!?\n]{2,90})/i,
    ) ||
    user.match(
      /(?:i(?:'m|\s+am)\s+(?:developing|building|creating|working\s+on)|my\s+project\s+is)\s+([^,.!?\n]{2,90})/i,
    )
  if (!projectMatched && project?.[1]) {
    const value = cleanCapture(project[1])
    if (value.length >= 2 && !/^(questo|quello|this|that|it)\b/i.test(value)) {
      // Guard: never treat as primary from generic phrasing alone
      if (/\bprogetto\s+principale\b|\bmain\s+project\b|\bprimary\s+project\b/i.test(user)) {
        // Should have been caught by primary patterns; if not, still map to primary.
        projectMatched = true
        push('projects', 'Primary project', `User's primary project: ${value}.`, 8, {
          factKey: 'projects.primary',
        })
      } else {
        projectMatched = true
        push('projects', 'Project', `User's project: ${value}.`, 7, {
          factKey: `projects.${slugifyFactKeyPart(value)}`,
        })
      }
    }
  }

  // —— Learning in progress → skills; desired learning → goals ——
  const learningNow =
    user.match(/(?:sto\s+imparando)\s+([^,.!?\n]{2,70})/i) ||
    user.match(/(?:i(?:'m|\s+am)\s+learning)\s+([^,.!?\n]{2,70})/i)
  let learningMatched = false
  if (learningNow?.[1]) {
    learningMatched = true
    push('skills', 'Learning', `User is learning: ${cleanCapture(learningNow[1])}.`, 7)
  }

  const wantLearn =
    user.match(/(?:voglio|vorrei)\s+imparare(?:\s+a)?\s+([^,.!?\n]{2,70})/i) ||
    user.match(
      /(?:i\s+want\s+to\s+learn(?:\s+how\s+to|\s+to)?|i(?:'d|\s+would)\s+like\s+to\s+learn(?:\s+how\s+to|\s+to)?)\s+([^,.!?\n]{2,70})/i,
    )
  if (wantLearn?.[1]) {
    push('goals', 'Learning goal', `User wants to learn: ${cleanCapture(wantLearn[1])}.`, 7)
  }

  // —— Obiettivi ——
  const goal =
    user.match(
      /(?:il\s+mio\s+obiettivo\s+[eè]|il\s+mio\s+scopo\s+[eè]|voglio\s+(?:riuscire\s+a|raggiungere)\s+)([^,.!?\n]{3,90})/i,
    ) ||
    user.match(
      /(?:my\s+goal\s+is|i(?:'m|\s+am)\s+trying\s+to)\s+([^,.!?\n]{3,90})/i,
    )
  if (goal?.[1]) {
    const value = cleanCapture(goal[1])
    // Avoid double-counting "voglio imparare" already stored as learning goal.
    if (value.length >= 5 && !/^imparare\b/i.test(value)) {
      push('goals', 'Goal', `User's goal: ${value}.`, 7)
    }
  }

  // —— Pets (narrow) ——
  const pet =
    user.match(
      /(?:il\s+mio|la\s+mia)\s+(cane|gatto|cagna|cagnolino|micetto|micia)\s+si\s+chiama\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'-]{1,40})/i,
    ) ||
    user.match(
      /(?:my\s+(dog|cat|puppy|kitten)(?:'s)?\s+name\s+is\s+)([A-Za-z][\w'-]{1,40})/i,
    ) ||
    user.match(
      /(?:i\s+have\s+a\s+(dog|cat|puppy|kitten)\s+named\s+)([A-Za-z][\w'-]{1,40})/i,
    )
  if (pet) {
    const species = cleanCapture(pet[1])
    const name = cleanCapture(pet[2])
    if (name) {
      const speciesKey =
        PET_SPECIES_KEY[species.toLowerCase()] || slugifyFactKeyPart(species)
      push(
        'relationships',
        'Pet',
        `User's ${species.toLowerCase()} is named ${name}.`,
        7,
        { factKey: `relationships.pet.${speciesKey}.name` },
      )
    }
  }

  // —— Relazioni ——
  const relationship =
    user.match(
      /(?:mio|mia|il\s+mio|la\s+mia)\s+(marito|moglie|fidanzat[oa]|partner|fratello|sorella|madre|padre|figlio|figlia|amico|amica)\s+(?:si\s+chiama\s+|è\s+|e\s+)?([^,.!?\n]{2,60})?/i,
    ) ||
    user.match(
      /my\s+(husband|wife|boyfriend|girlfriend|partner|brother|sister|mom|dad|son|daughter|friend)\s+(?:is\s+|called\s+)?([^,.!?\n]{2,60})?/i,
    )
  if (relationship) {
    const role = cleanCapture(relationship[1])
    const detail = cleanCapture(relationship[2] || '')
    const content = detail
      ? `Important relationship: ${role} — ${detail}.`
      : `User mentioned an important relationship: ${role}.`
    push('relationships', 'Relationship', content, 7)
  }

  // —— Competenze (studio / lavoro / stack) ——
  const profession =
    user.match(
      /(?:lavoro\s+come|faccio\s+il|faccio\s+la|sono\s+(?:un|una)\s+)([^,.!?\n]{2,70})/i,
    ) ||
    user.match(
      /(?:i\s+work\s+as|my\s+job\s+is|i(?:'m|\s+am)\s+a(?:n)?\s+)([^,.!?\n]{2,70})/i,
    )
  if (profession?.[1]) {
    const value = cleanCapture(profession[1])
    if (!/^(persona|uomo|donna|guy|person|student|studente)\b/i.test(value) || /stud/i.test(value)) {
      push('skills', 'Profession', `User's profession / role: ${value}.`, 8)
    }
  }

  const study =
    user.match(/(?:studio|sto\s+studiando)\s+([^,.!?\n]{2,70})/i) ||
    user.match(/(?:i\s+study|i(?:'m|\s+am)\s+studying)\s+([^,.!?\n]{2,70})/i)
  if (study?.[1] && !learningMatched) {
    push('skills', 'Studies', `User studies: ${cleanCapture(study[1])}.`, 7)
  }

  // —— Abitudini / strumenti ——
  // Note: "lavoro su" / "working on" intentionally omitted — those are projects.
  const uses =
    user.match(/(?:uso|utilizzo|lavoro\s+con)\s+([^,.!?\n]{2,70})/i) ||
    user.match(/(?:i\s+use|i(?:'m|\s+am)\s+using|i\s+work\s+with)\s+([^,.!?\n]{2,70})/i)
  if (uses?.[1] && !projectMatched) {
    const value = cleanCapture(uses[1])
    // Skip ephemeral "uso questo bottone" style short deixis
    if (value.length >= 3 && !/^(questo|quello|this|that|it)\b/i.test(value)) {
      push('habits', 'Tools & habits', `User uses: ${value}.`, 6)
    }
  }

  const hobby =
    user.match(
      /(?:il\s+mio\s+hobby\s+[eè]|nei?\s+tempo\s+libero\s+(?:mi\s+piace\s+|faccio\s+)?|mi\s+diverto\s+(?:a\s+)?)([^,.!?\n]{3,80})/i,
    ) ||
    user.match(
      /(?:my\s+hobby\s+is|in\s+my\s+free\s+time\s+i\s+(?:like\s+to\s+|enjoy\s+)?|i\s+enjoy)\s+([^,.!?\n]{3,80})/i,
    )
  if (hobby?.[1]) {
    push('habits', 'Hobby', `User's hobby: ${cleanCapture(hobby[1])}.`, 6)
  }

  // —— Eventi importanti ——
  const event =
    user.match(
      /(?:il\s+(?:\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)\s+|il\s+\d{1,2}\s+\w+\s+)([^,.!?\n]{5,80})/i,
    ) ||
    user.match(
      /(?:il\s+mio\s+(?:matrimonio|compleanno|laurea|esame|colloquio)|my\s+(?:wedding|birthday|graduation|interview))\s+([^,.!?\n]{0,80})/i,
    )
  if (event) {
    const detail = cleanCapture(event[0])
    if (detail.length >= 8) {
      push('events', 'Important event', `Important event: ${detail}.`, 7)
    }
  }

  // —— Impostazioni personali / istruzioni durevoli ——
  // Explicit "ricorda che / remember that" wrappers are stripped above so the
  // inner proposition uses normal families. Keep assistant-directed settings only.
  const setting =
    user.match(/(?:preferisco\s+che\s+tu|voglio\s+che\s+tu)\s+([^,.!?\n]{5,120})/i) ||
    user.match(/(?:please\s+always|i\s+want\s+you\s+to)\s+([^,.!?\n]{5,120})/i)
  if (setting?.[1]) {
    push('settings', 'Preferred setting', `User prefers: ${cleanCapture(setting[1])}.`, 7)
  }

  if (/\b(risposte\s+dettagliat|risposte\s+concis|risposte\s+brevi|detailed\s+replies|concise\s+replies)\b/i.test(user)) {
    if (/\b(dettagliat|detailed)\b/i.test(user)) {
      push('settings', 'Reply preference', 'User prefers detailed replies.', 8, {
        factKey: 'settings.reply_style',
      })
    } else {
      push('settings', 'Reply preference', 'User prefers concise replies.', 8, {
        factKey: 'settings.reply_style',
      })
    }
  }

  // Deduplicate identical captures within the same turn
  const seen = new Set()
  const unique = []
  for (const fact of facts) {
    const key = `${fact.category}|${normalizeText(fact.title)}|${normalizeText(fact.content)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(fact)
  }

  // Soft same-turn collapse: drop lower-importance near-duplicate contents
  const collapsed = []
  for (const fact of unique.sort((a, b) => b.importance - a.importance)) {
    const norm = normalizeText(fact.content)
    const nearDup = collapsed.some((kept) => {
      const keptOp = String(kept.operation || '').toLowerCase()
      const factOp = String(fact.operation || '').toLowerCase()
      // Never collapse control ops into positive writes (or vice versa).
      if (keptOp === 'revoke' || factOp === 'revoke' || keptOp === 'replace_set' || factOp === 'replace_set') {
        if (keptOp === 'replace_set' && factOp === 'replace_set') {
          return kept.subject && fact.subject && kept.subject === fact.subject
        }
        return (
          keptOp === factOp &&
          kept.factKey &&
          fact.factKey &&
          kept.factKey === fact.factKey
        )
      }
      // Distinct fact_keys are never near-duplicates (cofavorite Itachi ≠ Sasuke).
      if (kept.factKey && fact.factKey && kept.factKey !== fact.factKey) return false
      if (kept.category !== fact.category) return false
      const other = normalizeText(kept.content)
      if (other === norm) return true
      if (other.includes(norm) || norm.includes(other)) return true
      return tokenOverlapScore(other, norm) >= 0.7
    })
    if (nearDup) continue
    collapsed.push(fact)
  }

  // Keep memory lean: at most 3 facts per turn, highest importance first
  return collapsed.slice(0, 3)
}

/**
 * Rule-based extractor for durable user facts (IT + EN).
 * Returns a single primary decision (+ `items` for multi-fact turns).
 */
export function analyzeConversation(userMessage, assistantMessage) {
  void assistantMessage
  const items = extractDurableFacts(userMessage)
  if (items.length === 0) return { ...NO_SAVE }

  const primary = items[0]
  return {
    save: true,
    category: primary.category,
    title: primary.title,
    content: primary.content,
    importance: primary.importance,
    source: primary.source || 'automatic',
    confidence: primary.confidence,
    factKey: primary.factKey || null,
    tags: primary.tags || [],
    items,
  }
}

export async function saveMemory(input, deps = {}) {
  const supabase = deps.supabase ?? (await getServiceSupabase())
  const userId = await resolveMemoryUserId(
    {
      userId: input.userId,
      requireExplicitUserId: input.requireExplicitUserId === true,
    },
    supabase,
  )

  const { data, error: insertError } = await supabase
    .from('memories')
    .insert({
      user_id: userId,
      category: input.category,
      title: input.title,
      content: input.content,
      importance: input.importance ?? 1,
      tags: mergeTagsWithFactKey(
        input.tags,
        input.factKey || deriveFactKey(input, { userMessage: input.userMessage || '' }),
      ),
      source: (input.source && String(input.source).trim()) || 'automatic',
      status: (input.status && String(input.status).trim()) || 'active',
      confidence:
        typeof input.confidence === 'number' && Number.isFinite(input.confidence)
          ? input.confidence
          : 1.0,
    })
    .select(MEMORY_SELECT)
    .single()

  if (insertError) {
    throw new Error(`Failed to insert into public.memories: ${insertError.message}`)
  }

  return mapMemoryRow(data)
}

function categoryMatchers(category) {
  const key = String(category || '').toLowerCase()
  return CATEGORY_ALIASES[key] || [key]
}

function tokenOverlapScore(a, b) {
  const aTokens = new Set(tokenize(a))
  const bTokens = tokenize(b)
  if (aTokens.size === 0 || bTokens.length === 0) return 0
  let overlap = 0
  for (const token of bTokens) {
    if (aTokens.has(token)) overlap += 1
  }
  return overlap / Math.max(aTokens.size, bTokens.length)
}

/**
 * Choose an upsert target among already-fetched rows for one user.
 * Precedence: fact_key → legacy single-valued predecessors → same title → content overlap.
 *
 * @param {any[]} rows
 * @param {{ factKey?: string | null, category?: string, title?: string, content?: string }} input
 * @returns {any | null}
 */
export function selectUpsertTarget(rows, input = {}) {
  const list = Array.isArray(rows) ? rows : []
  const factKey =
    typeof input.factKey === 'string' && input.factKey.trim()
      ? input.factKey.trim()
      : null

  if (factKey) {
    const byKey = list.find((row) => {
      const status = String(row.status || row.Status || 'active').toLowerCase()
      if (status === 'obsolete' || status === 'archived' || status === 'deleted') {
        return false
      }
      const tags = row.tags || row.Tags || []
      return readFactKeyFromTags(tags) === factKey
    })
    if (byKey) return byKey

    // High-confidence untagged legacy predecessors for single-valued slots
    // (e.g. Favorite "User's favorite: il blu" → preferences.favorite.color).
    const legacyHit = selectLegacyPredecessorTarget(list, factKey, input.content || '')
    if (legacyHit) return legacyHit

    // Value-scoped multi keys must never paraphrase-merge onto a different key
    // (e.g. cofavorite Itachi must not update cofavorite Sasuke).
    if (/^preferences\.(cofavorite|like|interest|dislike)\./i.test(factKey)) {
      return null
    }

    // fact_key present but no row yet — do not collapse distinct slots that share
    // generic titles (Interest, Project, Favorite). Only near-paraphrase overlap.
    const contentNorm = normalizeText(input.content)
    let best = null
    let bestScore = 0
    for (const row of list) {
      const score = tokenOverlapScore(contentNorm, normalizeText(row.content))
      if (score > bestScore) {
        bestScore = score
        best = row
      }
    }
    return bestScore >= Math.max(DEDUPE_OVERLAP, 0.75) ? best : null
  }

  const titleNorm = normalizeText(input.title)
  const contentNorm = normalizeText(input.content)
  const sameTitle = list.find((row) => normalizeText(row.title) === titleNorm)
  if (sameTitle) return sameTitle

  let best = null
  let bestScore = 0
  for (const row of list) {
    const score = tokenOverlapScore(contentNorm, normalizeText(row.content))
    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }

  return bestScore >= DEDUPE_OVERLAP ? best : null
}

async function findUpsertTarget(supabase, userId, category, title, content, factKey) {
  // Prefer indexed tag contains when a fact_key is present.
  if (factKey) {
    const tag = encodeFactKeyTag(factKey)
    if (tag) {
      const keyed = await supabase
        .from('memories')
        .select(MEMORY_SELECT)
        .eq('user_id', userId)
        .contains('tags', [tag])
        .neq('status', 'obsolete')
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(50)

      if (!keyed.error && Array.isArray(keyed.data) && keyed.data.length > 0) {
        const hit = selectUpsertTarget(keyed.data, { factKey, category, title, content })
        if (hit) return hit
      }
    }
  }

  const peers = await loadSameUserCategoryPeers(supabase, userId, category, factKey)
  if (peers.error) {
    throw new Error(`Failed to look up memories for dedupe: ${peers.error}`)
  }

  return selectUpsertTarget(peers.rows, { factKey, category, title, content })
}

/**
 * Load same-user category peers for conflict detection.
 * Includes fact_key-tagged rows even if category drifted.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {string} category
 * @param {string | null} [factKey]
 * @returns {Promise<{ rows: any[], error: string | null }>}
 */
async function loadSameUserCategoryPeers(supabase, userId, category, factKey = null) {
  const aliases = categoryMatchers(category)
  const byId = new Map()

  const primary = await supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .in('category', aliases)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (primary.error) {
    return { rows: [], error: primary.error.message || String(primary.error) }
  }

  for (const row of primary.data || []) {
    if (row?.id != null) byId.set(String(row.id), row)
  }

  const tag = encodeFactKeyTag(factKey)
  if (tag) {
    const keyed = await supabase
      .from('memories')
      .select(MEMORY_SELECT)
      .eq('user_id', userId)
      .contains('tags', [tag])
      .order('updated_at', { ascending: false })
      .limit(50)

    if (!keyed.error && Array.isArray(keyed.data)) {
      for (const row of keyed.data) {
        if (row?.id != null) byId.set(String(row.id), row)
      }
    }
  }

  return { rows: [...byId.values()], error: null }
}

function isActiveMemoryStatus(status) {
  const s = String(status || 'active').toLowerCase()
  return s !== 'obsolete' && s !== 'archived' && s !== 'deleted' && s !== 'inactive'
}

function sortRowsByUpdatedAtDesc(rows) {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a.updated_at || a.updatedAt || 0) || 0
    const bt = Date.parse(b.updated_at || b.updatedAt || 0) || 0
    return bt - at
  })
}

/**
 * List ALL active rows for (user_id, exact fact_key).
 * Uses tag contains plus JS filter fallback so lookup never silently sees only one of many.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {string} factKey
 * @param {string} [category]
 * @returns {Promise<{ rows: any[], error: string | null }>}
 */
export async function listActiveRowsForFactKey(supabase, userId, factKey, category = 'preferences') {
  const byId = new Map()
  const tag = encodeFactKeyTag(factKey)

  if (tag) {
    const keyed = await supabase
      .from('memories')
      .select(MEMORY_SELECT)
      .eq('user_id', userId)
      .contains('tags', [tag])
      .order('updated_at', { ascending: false })
      .limit(50)

    if (!keyed.error && Array.isArray(keyed.data)) {
      for (const row of keyed.data) {
        if (!row?.id) continue
        if (!isActiveMemoryStatus(row.status)) continue
        // Trust contains hit for this exact tag; JS parse is a secondary check.
        const parsed = readFactKeyFromTags(row.tags)
        if (parsed == null || parsed === factKey) {
          byId.set(String(row.id), row)
        }
      }
    }
  }

  const peers = await loadSameUserCategoryPeers(supabase, userId, category, factKey)
  if (peers.error && byId.size === 0) {
    return { rows: [], error: peers.error }
  }

  for (const row of peers.rows) {
    if (!row?.id) continue
    if (!isActiveMemoryStatus(row.status)) continue
    if (readFactKeyFromTags(row.tags) === factKey) {
      byId.set(String(row.id), row)
    }
  }

  return {
    rows: sortRowsByUpdatedAtDesc([...byId.values()]),
    error: null,
  }
}

/**
 * Mark rows obsolete with verified SELECT representation.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {any[]} rows
 * @param {string} factKey
 * @returns {Promise<{ ok: boolean, obsoletedIds: string[], failedIds: string[], error: string | null }>}
 */
async function obsoleteRowsById(supabase, userId, rows, factKey) {
  const obsoletedIds = []
  const failedIds = []
  /** @type {string[]} */
  const errors = []
  const now = new Date().toISOString()

  for (const row of rows) {
    const { data, error: updateError } = await supabase
      .from('memories')
      .update({
        status: 'obsolete',
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('user_id', userId)
      .select('id, status')

    if (updateError) {
      failedIds.push(String(row.id))
      errors.push(updateError.message || String(updateError))
      console.warn(
        `[brain-memory] failed to obsolete slot peer ${row.id} for ${factKey}:`,
        (updateError.message || String(updateError)).slice(0, 180),
      )
      continue
    }

    const updated = Array.isArray(data) ? data : data ? [data] : []
    const confirmed = updated.some(
      (item) =>
        String(item.id) === String(row.id) &&
        String(item.status || '').toLowerCase() === 'obsolete',
    )

    if (!confirmed) {
      failedIds.push(String(row.id))
      errors.push(`zero-row obsolete update for ${row.id}`)
      console.warn(
        `[brain-memory] zero-row obsolete update for ${row.id} (fact_key=${factKey})`,
      )
      continue
    }

    obsoletedIds.push(String(row.id))
  }

  return {
    ok: failedIds.length === 0,
    obsoletedIds,
    failedIds,
    error: errors.length > 0 ? errors.join('; ') : null,
  }
}

/**
 * When asserting like.X or dislike.X, obsolete the opposite polarity for the
 * same owner + value slug. Does not touch favorites, cofavorites, or interests.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {string | null | undefined} factKey
 * @returns {Promise<{ obsoletedIds: string[] }>}
 */
export async function obsoleteOppositePreferencePolarity(supabase, userId, factKey) {
  const opposite = oppositePreferencePolarityFactKey(factKey)
  if (!opposite) return { obsoletedIds: [] }

  const listed = await listActiveRowsForFactKey(supabase, userId, opposite, 'preferences')
  if (listed.error || !listed.rows?.length) {
    return { obsoletedIds: [] }
  }

  const result = await markMemoriesObsolete(
    supabase,
    userId,
    listed.rows,
    `polarity_opposite:${opposite}`,
  )
  return { obsoletedIds: result.obsoletedIds || [] }
}

/**
 * When a cofavorite is written and an active singular favorite for the same
 * subject has the same value, obsolete that singular subject-slot row.
 * Owner-scoped only. Does not touch likes/interests/other subjects.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {string} cofavoriteFactKey
 * @returns {Promise<{ obsoletedIds: string[] }>}
 */
export async function obsoleteSingularFavoriteCoveredByCofavorite(
  supabase,
  userId,
  cofavoriteFactKey,
) {
  const key = String(cofavoriteFactKey || '').trim()
  const match = key.match(/^preferences\.cofavorite\.([^.]+)\.([^.]+)$/i)
  if (!match) return { obsoletedIds: [] }

  const subject = normalizeFavoriteSubjectKey(match[1])
  const valueSlug = slugifyFactKeyPart(match[2])
  if (!subject || !valueSlug) return { obsoletedIds: [] }

  /** @type {any[]} */
  const toObsolete = []
  for (const singularKey of singularFavoriteFactKeysForSubject(subject)) {
    const listed = await listActiveRowsForFactKey(supabase, userId, singularKey, 'preferences')
    if (listed.error) continue
    for (const row of listed.rows || []) {
      const rowSlug = favoriteValueSlugFromContent(row.content || row.Content || '')
      if (rowSlug && rowSlug === valueSlug) toObsolete.push(row)
    }
  }

  if (toObsolete.length === 0) return { obsoletedIds: [] }
  const result = await markMemoriesObsolete(
    supabase,
    userId,
    toObsolete,
    `cofavorite_supersedes_singular:${subject}`,
  )
  return { obsoletedIds: result.obsoletedIds || [] }
}

/**
 * Apply a structured favorite/cofavorite revoke item.
 * - Singular: exact subject key(s) + stored value slug must match stated value.
 * - Cofavorite: exact value-scoped fact_key.
 * Duplicate policy: if multiple exact matches are active, obsolete ALL of them
 * (deterministic; never pick an arbitrary single row).
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {{ operation?: string, targetType?: string, subject?: string, value?: string, factKey?: string | null }} item
 * @returns {Promise<{ action: 'revoked' | 'not_found' | 'skipped', obsoletedIds: string[], factKey: string | null }>}
 */
export async function applyFavoriteRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  const targetType = String(item.targetType || '').toLowerCase()
  const subject = normalizeFavoriteSubjectKey(item.subject || '')
  const value = cleanFavoritePreferenceValue(item.value || '')
  const statedSlug = slugifyFactKeyPart(value)
  if (!subject || !statedSlug) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  /** @type {any[]} */
  let matches = []
  /** @type {string | null} */
  let factKey = typeof item.factKey === 'string' && item.factKey.trim() ? item.factKey.trim() : null

  if (targetType === 'cofavorite') {
    factKey = factKey || buildCofavoriteFactKey(subject, value)
    const listed = await listActiveRowsForFactKey(supabase, uid, factKey, 'preferences')
    if (listed.error) {
      console.warn(
        `[brain-memory] favorite revoke lookup failed for ${factKey}:`,
        String(listed.error).slice(0, 180),
      )
      return { action: 'skipped', obsoletedIds: [], factKey }
    }
    matches = listed.rows || []
  } else if (targetType === 'favorite') {
    factKey = factKey || `preferences.favorite.${subject}`
    const keys = singularFavoriteFactKeysForSubject(subject)
    const byId = new Map()
    for (const key of keys) {
      const listed = await listActiveRowsForFactKey(supabase, uid, key, 'preferences')
      if (listed.error) continue
      for (const row of listed.rows || []) {
        const storedSlug = favoriteValueSlugFromContent(row.content || row.Content || '')
        if (storedSlug && storedSlug === statedSlug) {
          byId.set(String(row.id), row)
        }
      }
    }
    matches = [...byId.values()]
  } else {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }

  // Deterministic ordering; obsolete every exact match (never pick one arbitrarily).
  matches.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (matches.length > 1) {
    console.warn(
      `[brain-memory] favorite revoke: ${matches.length} exact active matches for ${factKey}; obsoleting all`,
    )
  }

  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `favorite_revoke:${factKey || subject}`,
  )
  return {
    action: (result.obsoletedIds || []).length > 0 ? 'revoked' : 'not_found',
    obsoletedIds: result.obsoletedIds || [],
    factKey,
  }
}

/**
 * List active cofavorite rows for one normalized subject (owner-scoped).
 * Parses fact_key tags in JS — never bulk-updates by prefix alone.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {string} subject
 * @returns {Promise<{ rows: any[], error: string | null }>}
 */
export async function listActiveCofavoritesForSubject(supabase, userId, subject) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  const norm = normalizeFavoriteSubjectKey(subject)
  if (!uid || !norm) {
    return { rows: [], error: 'userId and subject required' }
  }

  const peers = await loadSameUserCategoryPeers(supabase, uid, 'preferences')
  if (peers.error) return { rows: [], error: peers.error }

  const prefix = `preferences.cofavorite.${norm}.`
  const rows = (peers.rows || []).filter((row) => {
    if (!isActiveMemoryStatus(row.status)) return false
    // Owner already scoped by loadSameUserCategoryPeers; verify only when column present.
    const rowUid = row.user_id ?? row.userId
    if (rowUid != null && String(rowUid) !== uid) return false
    const key = readFactKeyFromTags(row.tags)
    return typeof key === 'string' && key.startsWith(prefix)
  })

  return { rows, error: null }
}

/**
 * Apply high-confidence cofavorite replace_set.
 * Order A: upsert incoming values first; only then obsolete absent peers.
 * Duplicate absent rows: obsolete ALL exact matches.
 * Singular policy B: obsolete singular favorite if its value slug ∉ incoming set.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {{
 *   operation?: string,
 *   subject?: string,
 *   values?: string[],
 *   factKeys?: string[],
 *   userMessage?: string,
 *   source?: string,
 *   confidence?: number,
 * }} item
 * @returns {Promise<{
 *   action: string,
 *   obsoletedIds: string[],
 *   failedIds?: string[],
 *   error?: string | null,
 *   incomingKeys?: string[],
 * }>}
 */
export async function applyCofavoriteSetReplacement(supabase, userId, item) {
  const traceOn = isReplaceSetTraceEnabled()
  /** @type {Record<string, unknown>} */
  const trace = {
    enabled: traceOn,
    project: traceOn ? getReplaceSetProjectDiagnostics() : null,
    userId: null,
    subject: null,
    incomingValues: [],
    incomingFactKeys: [],
    before: [],
    keep: [],
    add: [],
    obsoleteTargets: [],
    upserts: [],
    afterIncoming: [],
    obsoleteAttempts: [],
    afterObsolete: [],
    activeSubjectRows: [],
    obsoleteSubjectRows: [],
    activeCount: 0,
    obsoleteCount: 0,
    status: null,
    addedIds: [],
    keptIds: [],
    obsoletedIds: [],
    failedUpserts: [],
    failedObsoletes: [],
    partialMutation: false,
    cleanupOk: null,
    kakashiExistsAfterIncoming: null,
  }

  const finish = (result) => {
    if (traceOn) {
      trace.status = result.action
      trace.obsoletedIds = result.obsoletedIds || []
      trace.partialMutation =
        result.action === 'partial_obsolete' ||
        result.action === 'failed_upsert' ||
        result.action === 'failed_list' ||
        (Array.isArray(result.failedIds) && result.failedIds.length > 0)
      trace.cleanupOk =
        result.action === 'replaced' &&
        (!Array.isArray(result.failedIds) || result.failedIds.length === 0)
      logReplaceSetTrace('final', {
        userId: trace.userId,
        subject: trace.subject,
        status: trace.status,
        keep: trace.keep,
        add: trace.add,
        obsoleteTargets: trace.obsoleteTargets,
        upserts: trace.upserts,
        obsoleteAttempts: trace.obsoleteAttempts,
        kakashiExistsAfterIncoming: trace.kakashiExistsAfterIncoming,
        activeSubjectRows: trace.activeSubjectRows,
        obsoleteSubjectRows: trace.obsoleteSubjectRows,
        activeCount: trace.activeCount,
        obsoleteCount: trace.obsoleteCount,
        addedIds: trace.addedIds,
        keptIds: trace.keptIds,
        obsoletedIds: trace.obsoletedIds,
        failedUpserts: trace.failedUpserts,
        failedObsoletes: trace.failedObsoletes,
        partialMutation: trace.partialMutation,
        cleanupOk: trace.cleanupOk,
        project: trace.project,
        error: result.error || null,
      })
    }
    return traceOn ? { ...result, trace } : result
  }

  const snapshotSubject = async () => {
    const listed = await listActiveCofavoritesForSubject(supabase, uid, subject)
    // Wide owner+subject read for FINAL: also need obsolete rows — load peers and filter family.
    const peers = await loadSameUserCategoryPeers(supabase, uid, 'preferences')
    const prefix = `preferences.cofavorite.${subject}.`
    const family = (peers.rows || []).filter((row) => {
      const key = readFactKeyFromTags(row.tags)
      return typeof key === 'string' && key.startsWith(prefix)
    })
    const active = family.filter((row) => isActiveMemoryStatus(row.status))
    const obsolete = family.filter((row) => !isActiveMemoryStatus(row.status))
    return {
      listedError: listed.error,
      activeRows: listed.rows || [],
      activeSnap: snapshotMemoryRows(listed.rows || [], readFactKeyFromTags),
      familyActiveSnap: snapshotMemoryRows(active, readFactKeyFromTags),
      familyObsoleteSnap: snapshotMemoryRows(obsolete, readFactKeyFromTags),
      peersError: peers.error,
    }
  }

  const uid = typeof userId === 'string' ? userId.trim() : ''
  trace.userId = uid ? `${uid.slice(0, 8)}…` : null
  if (!uid) {
    return finish({ action: 'skipped', obsoletedIds: [], error: 'userId required' })
  }
  if (String(item?.operation || '').toLowerCase() !== 'replace_set') {
    return finish({ action: 'skipped', obsoletedIds: [] })
  }
  if (shouldSkipFavoriteSetReplacement(item.userMessage || '')) {
    return finish({ action: 'skipped', obsoletedIds: [] })
  }

  const subject = normalizeFavoriteSubjectKey(item.subject || '')
  const rawValues = Array.isArray(item.values) ? item.values : []
  trace.subject = subject || null
  if (!subject || rawValues.length === 0) {
    return finish({ action: 'skipped', obsoletedIds: [] })
  }

  /** @type {string[]} */
  const values = []
  /** @type {string[]} */
  const incomingKeys = []
  for (const raw of rawValues) {
    const value = cleanCofavoriteReplaceSetValue(raw)
    if (value.length < 2) continue
    const factKey = buildCofavoriteFactKey(subject, value)
    if (incomingKeys.includes(factKey)) continue
    values.push(value)
    incomingKeys.push(factKey)
  }
  trace.incomingValues = [...values]
  trace.incomingFactKeys = [...incomingKeys]
  if (values.length === 0) {
    return finish({ action: 'skipped', obsoletedIds: [] })
  }

  const incomingSet = new Set(incomingKeys)

  // BEFORE snapshot (trace-only; listing also used for KEEP/ADD/OBSOLETE plan)
  let beforeActive = []
  if (traceOn) {
    try {
      const before = await snapshotSubject()
      beforeActive = before.activeRows
      trace.before = before.activeSnap
      const beforeKeys = new Set(
        before.activeSnap.map((r) => r.factKey).filter(Boolean),
      )
      trace.keep = incomingKeys.filter((k) => beforeKeys.has(k))
      trace.add = incomingKeys.filter((k) => !beforeKeys.has(k))
      trace.obsoleteTargets = before.activeSnap
        .filter((r) => r.factKey && !incomingSet.has(r.factKey))
        .map((r) => ({ id: r.id, factKey: r.factKey, content: r.content }))
      logReplaceSetTrace('before', {
        userId: trace.userId,
        subject,
        incomingValues: values,
        incomingFactKeys: incomingKeys,
        before: trace.before,
        keep: trace.keep,
        add: trace.add,
        obsoleteTargets: trace.obsoleteTargets,
        project: trace.project,
      })
    } catch (error) {
      logReplaceSetTraceError({
        stage: 'before_snapshot',
        message: error instanceof Error ? error.message : String(error),
        operation: 'replace_set',
        subject,
      })
    }
  } else {
    void beforeActive
  }

  // —— Phase 1: upsert incoming (Order A) ——
  // Idempotent skip (existing identical row) is success; throw / null memory skip is failure.
  for (const value of values) {
    const factKey = buildCofavoriteFactKey(subject, value)
    try {
      const upserted = await upsertMemory(
        {
          category: 'preferences',
          title: 'Co-favorite',
          content: `User's favorite ${subject}: ${value}.`,
          importance: 6,
          factKey,
          userId: uid,
          requireExplicitUserId: true,
          userMessage: item.userMessage || '',
          source: item.source === 'explicit' ? 'explicit' : 'automatic',
          // Policy B owns singular interaction for replace_set — do not cover-obsolete mid-upsert.
          skipCofavoriteSingularCover: true,
          confidence:
            typeof item.confidence === 'number' && Number.isFinite(item.confidence)
              ? item.confidence
              : 0.8,
        },
        { supabase },
      )
      const action = String(upserted?.action || '')
      const rowId =
        upserted?.memory?.id != null ? String(upserted.memory.id) : null
      if (action === 'created' || action === 'updated' || action === 'skipped') {
        if (action === 'skipped' && !upserted?.memory) {
          const err = `upsert skipped without memory for ${factKey}`
          if (traceOn) {
            trace.upserts.push({
              value,
              factKey,
              action: 'failed',
              rowId: null,
              error: err,
            })
            trace.failedUpserts.push({ value, factKey, error: err })
            logReplaceSetTrace('upsert_failed', { value, factKey, error: err })
          }
          return finish({
            action: 'failed_upsert',
            obsoletedIds: [],
            error: err,
            incomingKeys,
          })
        }
        if (traceOn) {
          const traceAction =
            action === 'skipped' ? 'existing' : action === 'created' ? 'created' : 'updated'
          trace.upserts.push({
            value,
            factKey,
            action: traceAction,
            rowId,
            error: null,
          })
          if (traceAction === 'created' && rowId) trace.addedIds.push(rowId)
          if (traceAction === 'existing' && rowId) trace.keptIds.push(rowId)
          logReplaceSetTrace('upsert', {
            value,
            factKey,
            action: traceAction,
            rowId,
          })
        }
      } else {
        const err = `unexpected upsert action ${action || 'empty'} for ${factKey}`
        if (traceOn) {
          trace.upserts.push({
            value,
            factKey,
            action: 'failed',
            rowId: null,
            error: err,
          })
          trace.failedUpserts.push({ value, factKey, error: err })
          logReplaceSetTrace('upsert_failed', { value, factKey, error: err })
        }
        return finish({
          action: 'failed_upsert',
          obsoletedIds: [],
          error: err,
          incomingKeys,
        })
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      if (traceOn) {
        trace.upserts.push({
          value,
          factKey,
          action: 'failed',
          rowId: null,
          error: err,
        })
        trace.failedUpserts.push({ value, factKey, error: err })
        logReplaceSetTraceError({
          stage: 'upsert',
          message: err,
          operation: 'replace_set',
          subject,
        })
      }
      return finish({
        action: 'failed_upsert',
        obsoletedIds: [],
        error: err,
        incomingKeys,
      })
    }
  }

  if (traceOn) {
    try {
      const mid = await snapshotSubject()
      trace.afterIncoming = mid.activeSnap
      trace.kakashiExistsAfterIncoming = mid.activeSnap.some(
        (r) => r.factKey === 'preferences.cofavorite.character.kakashi',
      )
      logReplaceSetTrace('after_incoming', {
        userId: trace.userId,
        subject,
        afterIncoming: trace.afterIncoming,
        kakashiExistsAfterIncoming: trace.kakashiExistsAfterIncoming,
      })
    } catch (error) {
      logReplaceSetTraceError({
        stage: 'after_incoming_snapshot',
        message: error instanceof Error ? error.message : String(error),
        operation: 'replace_set',
        subject,
      })
    }
  }

  // —— Phase 2: obsolete absent subject peers (only after successful upserts) ——
  const listed = await listActiveCofavoritesForSubject(supabase, uid, subject)
  if (listed.error) {
    if (traceOn) {
      logReplaceSetTraceError({
        stage: 'list_before_obsolete',
        message: listed.error,
        operation: 'replace_set',
        subject,
      })
    }
    return finish({
      action: 'failed_list',
      obsoletedIds: [],
      error: listed.error,
      incomingKeys,
    })
  }

  const absent = (listed.rows || []).filter((row) => {
    const key = readFactKeyFromTags(row.tags)
    return typeof key === 'string' && !incomingSet.has(key)
  })
  absent.sort((a, b) => String(a.id).localeCompare(String(b.id)))

  /** @type {string[]} */
  let obsoletedIds = []
  if (absent.length > 0) {
    if (absent.length > 1) {
      console.warn(
        `[brain-memory] replace_set: ${absent.length} absent active rows for cofavorite.${subject}; obsoleting all exact matches`,
      )
    }
    try {
      const result = await markMemoriesObsolete(
        supabase,
        uid,
        absent,
        `replace_set:${subject}`,
      )
      obsoletedIds = result.obsoletedIds || []
      if (traceOn) {
        const okSet = new Set((result.obsoletedIds || []).map(String))
        const failSet = new Set((result.failedIds || []).map(String))
        for (const row of absent) {
          const id = String(row.id)
          const factKey = readFactKeyFromTags(row.tags)
          const content = String(row.content || '').slice(0, 240)
          let success = okSet.has(id)
          let zeroRow = false
          let error = null
          if (failSet.has(id)) {
            success = false
            zeroRow = true
            error = result.error || 'obsolete_failed'
            trace.failedObsoletes.push({ id, factKey, error })
          }
          trace.obsoleteAttempts.push({
            id,
            factKey,
            content,
            success,
            returnedStatus: success ? 'obsolete' : null,
            error,
            zeroRowUpdate: zeroRow,
          })
          logReplaceSetTrace('obsolete_row', {
            id,
            factKey,
            content,
            success,
            zeroRowUpdate: zeroRow,
            error,
          })
        }
      }
      if (Array.isArray(result.failedIds) && result.failedIds.length > 0) {
        if (traceOn) {
          const after = await snapshotSubject()
          trace.afterObsolete = after.activeSnap
          trace.activeSubjectRows = after.familyActiveSnap
          trace.obsoleteSubjectRows = after.familyObsoleteSnap
          trace.activeCount = after.familyActiveSnap.length
          trace.obsoleteCount = after.familyObsoleteSnap.length
        }
        return finish({
          action: 'partial_obsolete',
          obsoletedIds,
          failedIds: result.failedIds,
          error: result.error || 'obsolete_failed',
          incomingKeys,
        })
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      if (traceOn) {
        logReplaceSetTraceError({
          stage: 'obsolete',
          message: err,
          operation: 'replace_set',
          subject,
        })
        for (const row of absent) {
          trace.obsoleteAttempts.push({
            id: String(row.id),
            factKey: readFactKeyFromTags(row.tags),
            content: String(row.content || '').slice(0, 240),
            success: false,
            returnedStatus: null,
            error: err,
            zeroRowUpdate: false,
          })
          trace.failedObsoletes.push({
            id: String(row.id),
            factKey: readFactKeyFromTags(row.tags),
            error: err,
          })
        }
      }
      return finish({
        action: 'partial_obsolete',
        obsoletedIds,
        error: err,
        incomingKeys,
      })
    }
  }

  // —— Singular policy B ——
  for (const singularKey of singularFavoriteFactKeysForSubject(subject)) {
    const listedSingular = await listActiveRowsForFactKey(
      supabase,
      uid,
      singularKey,
      'preferences',
    )
    if (listedSingular.error) continue
    /** @type {any[]} */
    const toObsoleteSingular = []
    for (const row of listedSingular.rows || []) {
      const slug = favoriteValueSlugFromContent(row.content || row.Content || '')
      if (!slug) continue
      const inIncoming = [...incomingSet].some((key) => key.endsWith(`.${slug}`))
      if (!inIncoming) toObsoleteSingular.push(row)
    }
    if (toObsoleteSingular.length > 0) {
      const singularResult = await markMemoriesObsolete(
        supabase,
        uid,
        toObsoleteSingular,
        `replace_set_singular:${subject}`,
      )
      obsoletedIds = obsoletedIds.concat(singularResult.obsoletedIds || [])
    }
  }

  if (traceOn) {
    try {
      const finalSnap = await snapshotSubject()
      trace.afterObsolete = finalSnap.activeSnap
      trace.activeSubjectRows = finalSnap.familyActiveSnap
      trace.obsoleteSubjectRows = finalSnap.familyObsoleteSnap
      trace.activeCount = finalSnap.familyActiveSnap.length
      trace.obsoleteCount = finalSnap.familyObsoleteSnap.length
      logReplaceSetTrace('after_obsolete_final', {
        userId: trace.userId,
        subject,
        activeSubjectRows: trace.activeSubjectRows,
        obsoleteSubjectRows: trace.obsoleteSubjectRows,
        activeCount: trace.activeCount,
        obsoleteCount: trace.obsoleteCount,
      })
    } catch (error) {
      logReplaceSetTraceError({
        stage: 'final_snapshot',
        message: error instanceof Error ? error.message : String(error),
        operation: 'replace_set',
        subject,
      })
    }
  }

  return finish({
    action: 'replaced',
    obsoletedIds,
    incomingKeys,
    error: null,
  })
}

/**
 * Owner-scoped soft-forget: mark rows obsolete (not hard-delete).
 * Always scopes mutations with user_id — never cross-user.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {any[]} rows
 * @param {string} [reasonTag]
 */
export async function markMemoriesObsolete(supabase, userId, rows, reasonTag = 'user_forget') {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { ok: false, obsoletedIds: [], failedIds: [], error: 'userId required' }
  }
  const list = Array.isArray(rows) ? rows.filter((row) => row?.id) : []
  if (list.length === 0) {
    return { ok: true, obsoletedIds: [], failedIds: [], error: null }
  }
  return obsoleteRowsById(supabase, uid, list, reasonTag)
}

/**
 * List active memories for a verified owner (no default-user fallback).
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ rows: any[], error: string | null }>}
 */
export async function listActiveMemoriesForOwner(supabase, userId, options = {}) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { rows: [], error: 'userId required' }
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 200)
  const { data, error } = await supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', uid)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { rows: [], error: error.message || String(error) }
  }

  const rows = (data ?? [])
    .map(mapMemoryRow)
    .filter((row) => isActiveMemoryStatus(row.status))
  return { rows, error: null }
}

/**
 * After a single-valued fact_key write:
 * 1) obsolete every other ACTIVE row with the exact same fact_key
 * 2) obsolete high-confidence untagged legacy predecessors
 * 3) re-query and require active keyed count === 1
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {string} category
 * @param {string} factKey
 * @param {string} keepId
 */
export async function obsoleteConflictingSlotRows(supabase, userId, category, factKey, keepId) {
  const empty = {
    ok: true,
    predecessorsFound: 0,
    obsoletedIds: [],
    failedIds: [],
    error: null,
    factKey,
    canonicalId: keepId || null,
    activeCountAfter: null,
    cleanupOk: true,
  }

  if (!isSingleValuedFactKey(factKey) || !keepId) return empty

  const keyed = await listActiveRowsForFactKey(supabase, userId, factKey, category)
  if (keyed.error) {
    console.warn(
      `[brain-memory] keyed peer lookup failed for ${factKey}:`,
      keyed.error.slice(0, 180),
    )
    return {
      ...empty,
      ok: false,
      cleanupOk: false,
      error: keyed.error,
    }
  }

  const peers = await loadSameUserCategoryPeers(supabase, userId, category, factKey)
  if (peers.error) {
    console.warn(
      `[brain-memory] slot peer lookup failed for ${factKey}:`,
      peers.error.slice(0, 180),
    )
    return {
      ...empty,
      ok: false,
      cleanupOk: false,
      error: peers.error,
    }
  }

  /** @type {Map<string, any>} */
  const toObsolete = new Map()

  for (const row of keyed.rows) {
    if (String(row.id) === String(keepId)) continue
    toObsolete.set(String(row.id), row)
  }

  for (const row of peers.rows) {
    if (!isConflictingActiveSlotRow(row, factKey, keepId)) continue
    toObsolete.set(String(row.id), row)
  }

  const conflicts = [...toObsolete.values()]
  const obsoleteResult =
    conflicts.length > 0
      ? await obsoleteRowsById(supabase, userId, conflicts, factKey)
      : { ok: true, obsoletedIds: [], failedIds: [], error: null }

  const verify = await listActiveRowsForFactKey(supabase, userId, factKey, category)
  const activeCountAfter = verify.error ? null : verify.rows.length
  const invariantOk = activeCountAfter === 1 && verify.rows.some((r) => String(r.id) === String(keepId))
  const cleanupOk = obsoleteResult.ok && invariantOk && !verify.error

  if (!cleanupOk) {
    console.warn(
      `[brain-memory] single-valued invariant failed for ${factKey}: activeCountAfter=${activeCountAfter} keepId=${keepId}`,
    )
  }

  return {
    ok: cleanupOk,
    predecessorsFound: conflicts.length,
    obsoletedIds: obsoleteResult.obsoletedIds,
    failedIds: obsoleteResult.failedIds,
    error:
      obsoleteResult.error ||
      verify.error ||
      (!invariantOk ? `active keyed count ${activeCountAfter} !== 1` : null),
    factKey,
    canonicalId: String(keepId),
    activeCountAfter,
    cleanupOk,
  }
}

/**
 * Insert or update an existing memory to avoid duplicates.
 * Single-valued fact_keys enforce (user_id, fact_key) → at most one active row.
 *
 * Returns { action, memory?, slotCleanup? }
 *
 * @param {any} input
 * @param {{ supabase?: any }} [deps]
 */
export async function upsertMemory(input, deps = {}) {
  const supabase = deps.supabase ?? (await getServiceSupabase())
  const userId = await resolveMemoryUserId(
    {
      userId: input.userId,
      requireExplicitUserId: input.requireExplicitUserId === true,
    },
    supabase,
  )

  const factKey =
    (typeof input.factKey === 'string' && input.factKey.trim()) ||
    deriveFactKey(input, { userMessage: input.userMessage || '' }) ||
    readFactKeyFromTags(input.tags) ||
    null

  const tags = mergeTagsWithFactKey(input.tags, factKey)

  const polarityKey =
    factKey &&
    (/^preferences\.like\./i.test(factKey) || /^preferences\.dislike\./i.test(factKey))
      ? factKey
      : null

  // Belt-and-suspenders: interrogative user utterances must never assert/revoke polarity.
  // Runs before find/upsert and before obsoleteOppositePreferencePolarity.
  if (polarityKey && shouldSkipPreferencePolarityExtraction(input.userMessage || '')) {
    return { action: 'skipped', memory: null, slotCleanup: null }
  }

  // —— Single-valued path: list ALL keyed actives, pick canonical, obsolete rest ——
  if (factKey && isSingleValuedFactKey(factKey)) {
    return upsertSingleValuedMemory(supabase, userId, input, factKey, tags)
  }

  const existing = await findUpsertTarget(
    supabase,
    userId,
    input.category,
    input.title,
    input.content,
    factKey,
  )

  if (existing) {
    if (normalizeText(existing.content) === normalizeText(input.content)) {
      if (
        factKey &&
        factKey.startsWith('preferences.cofavorite.') &&
        input.skipCofavoriteSingularCover !== true
      ) {
        await obsoleteSingularFavoriteCoveredByCofavorite(supabase, userId, factKey)
      }
      // Historical contradiction repair: same-polarity re-assert still clears opposite.
      if (polarityKey) {
        await obsoleteOppositePreferencePolarity(supabase, userId, polarityKey)
      }
      return { action: 'skipped', memory: mapMemoryRow(existing), slotCleanup: null }
    }

    const { data, error } = await supabase
      .from('memories')
      .update({
        category: input.category,
        title: input.title,
        content: input.content,
        importance: input.importance ?? existing.importance ?? 1,
        source: (input.source && String(input.source).trim()) || existing.source || 'automatic',
        status: (input.status && String(input.status).trim()) || 'active',
        tags: mergeTagsWithFactKey(existing.tags, factKey),
        ...(typeof input.confidence === 'number' && Number.isFinite(input.confidence)
          ? { confidence: input.confidence }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select(MEMORY_SELECT)
      .single()

    if (error) {
      throw new Error(`Failed to update public.memories: ${error.message}`)
    }

    const memory = mapMemoryRow(data)
    if (
      factKey &&
      factKey.startsWith('preferences.cofavorite.') &&
      input.skipCofavoriteSingularCover !== true
    ) {
      await obsoleteSingularFavoriteCoveredByCofavorite(supabase, userId, factKey)
    }
    if (polarityKey) {
      await obsoleteOppositePreferencePolarity(supabase, userId, polarityKey)
    }
    return { action: 'updated', memory, slotCleanup: null }
  }

  const memory = await saveMemory(
    {
      ...input,
      tags,
      factKey,
      userId,
      requireExplicitUserId: input.requireExplicitUserId === true,
    },
    { supabase },
  )

  if (
    factKey &&
    factKey.startsWith('preferences.cofavorite.') &&
    input.skipCofavoriteSingularCover !== true
  ) {
    await obsoleteSingularFavoriteCoveredByCofavorite(supabase, userId, factKey)
  }
  if (polarityKey) {
    await obsoleteOppositePreferencePolarity(supabase, userId, polarityKey)
  }

  return { action: 'created', memory, slotCleanup: null }
}

/**
 * @param {any} supabase
 * @param {string} userId
 * @param {any} input
 * @param {string} factKey
 * @param {string[]} tags
 */
async function upsertSingleValuedMemory(supabase, userId, input, factKey, tags) {
  const keyed = await listActiveRowsForFactKey(supabase, userId, factKey, input.category)
  if (keyed.error) {
    throw new Error(`Failed to list active rows for fact_key ${factKey}: ${keyed.error}`)
  }

  let existing = keyed.rows[0] || null

  if (!existing) {
    const peers = await loadSameUserCategoryPeers(supabase, userId, input.category, factKey)
    if (peers.error) {
      throw new Error(`Failed to look up legacy peers for ${factKey}: ${peers.error}`)
    }
    existing = selectLegacyPredecessorTarget(peers.rows, factKey, input.content || '')
  }

  /** @type {any} */
  let memory
  /** @type {'created' | 'updated' | 'skipped'} */
  let action

  if (existing) {
    if (normalizeText(existing.content) === normalizeText(input.content)) {
      const existingKey = readFactKeyFromTags(existing.tags)
      memory = mapMemoryRow(existing)
      if (existingKey !== factKey || String(existing.status || '').toLowerCase() !== 'active') {
        const patchedTags = mergeTagsWithFactKey(existing.tags, factKey)
        const { data, error } = await supabase
          .from('memories')
          .update({
            tags: patchedTags,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select(MEMORY_SELECT)
          .single()
        if (error) {
          throw new Error(`Failed to patch fact_key on memory: ${error.message}`)
        }
        memory = mapMemoryRow(data)
      }
      action = 'skipped'
    } else {
      const { data, error } = await supabase
        .from('memories')
        .update({
          category: input.category,
          title: input.title,
          content: input.content,
          importance: input.importance ?? existing.importance ?? 1,
          source: (input.source && String(input.source).trim()) || existing.source || 'automatic',
          status: 'active',
          tags: mergeTagsWithFactKey(existing.tags, factKey),
          ...(typeof input.confidence === 'number' && Number.isFinite(input.confidence)
            ? { confidence: input.confidence }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select(MEMORY_SELECT)
        .single()

      if (error) {
        throw new Error(`Failed to update public.memories: ${error.message}`)
      }

      memory = mapMemoryRow(data)
      action = 'updated'
    }
  } else {
    memory = await saveMemory(
      {
        ...input,
        tags,
        factKey,
        userId,
        requireExplicitUserId: input.requireExplicitUserId === true,
      },
      { supabase },
    )
    action = 'created'
  }

  const slotCleanup = await obsoleteConflictingSlotRows(
    supabase,
    userId,
    input.category || memory.category,
    factKey,
    memory.id,
  )

  return { action, memory, slotCleanup }
}

export async function listMemories(options = {}) {
  const supabase = await getServiceSupabase()
  const userId = await resolveMemoryUserId(options, supabase)

  let request = supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (options.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(`Failed to list public.memories: ${error.message}`)
  }

  let rows = (data ?? []).map(mapMemoryRow)

  const q = typeof options.q === 'string' ? options.q.trim().toLowerCase() : ''
  if (q) {
    rows = rows.filter((row) => {
      const haystack = `${row.title} ${row.content} ${row.category}`.toLowerCase()
      return haystack.includes(q)
    })
  }

  return rows
}

export async function getMemoryById(id, options = {}) {
  const supabase = await getServiceSupabase()
  const userId = await resolveMemoryUserId(options, supabase)

  const { data, error } = await supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load memory: ${error.message}`)
  }

  return data ? mapMemoryRow(data) : null
}

export async function updateMemory(id, input, options = {}) {
  const supabase = await getServiceSupabase()
  const userId = await resolveMemoryUserId(options, supabase)

  const patch = {
    updated_at: new Date().toISOString(),
  }
  if (typeof input.category === 'string') patch.category = input.category
  if (typeof input.title === 'string') patch.title = input.title
  if (typeof input.content === 'string') patch.content = input.content
  if (typeof input.importance === 'number' && Number.isFinite(input.importance)) {
    patch.importance = input.importance
  }

  const { data, error } = await supabase
    .from('memories')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select(MEMORY_SELECT)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to update memory: ${error.message}`)
  }

  return data ? mapMemoryRow(data) : null
}

export async function deleteMemory(id, options = {}) {
  const supabase = await getServiceSupabase()
  const userId = await resolveMemoryUserId(options, supabase)

  const { data, error } = await supabase
    .from('memories')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to delete memory: ${error.message}`)
  }

  return Boolean(data?.id)
}

export async function deleteAllMemories(options = {}) {
  const supabase = options.supabase ?? (await getServiceSupabase())
  const userId = await resolveMemoryUserId(options, supabase)

  const { data, error } = await supabase
    .from('memories')
    .delete()
    .eq('user_id', userId)
    .select('id')

  if (error) {
    throw new Error(`Failed to delete all memories: ${error.message}`)
  }

  return Array.isArray(data) ? data.length : 0
}

async function recordMemoryUsage(supabase, memoryIds) {
  if (!memoryIds.length) return

  try {
    const { error } = await supabase.rpc('mark_memories_used', {
      memory_ids: memoryIds,
    })

    if (error) {
      const now = new Date().toISOString()
      await Promise.all(
        memoryIds.map(async (id) => {
          const { data } = await supabase
            .from('memories')
            .select('usage_count')
            .eq('id', id)
            .maybeSingle()

          const current =
            typeof data?.usage_count === 'number' && Number.isFinite(data.usage_count)
              ? data.usage_count
              : 0

          await supabase
            .from('memories')
            .update({
              usage_count: current + 1,
              last_used_at: now,
            })
            .eq('id', id)
        }),
      )
    }
  } catch {
    // Usage tracking must not change search behavior.
  }
}

/**
 * Score a memory against the current query + detected topic.
 * Ranking blends semantic relatedness, importance, recency, and category priority.
 * Exported for tests / orchestrator tuning.
 */
export function scoreMemoryRelevance(row, query, topicHint) {
  const topic = topicHint || detectMemoryTopic(query)
  const tokens = [...new Set([...topic.queryTokens, ...topic.relatedTokens])]
  const haystack = `${row.title} ${row.content} ${row.category} ${(row.tags || []).join(' ')}`.toLowerCase()
  const titleLower = String(row.title || '').toLowerCase()
  const category = String(row.category || '').toLowerCase()

  let score = 0
  let hits = 0
  let semanticHits = 0

  for (const token of topic.queryTokens) {
    if (haystack.includes(token)) {
      hits += 1
      score += 6
      if (titleLower.includes(token)) score += 5
    }
  }

  for (const token of topic.relatedTokens) {
    if (haystack.includes(token)) {
      semanticHits += 1
      score += 3.5
      if (titleLower.includes(token)) score += 2
    }
  }

  // Topic / category affinity (semantic relatedness beyond keywords)
  if (topic.categories.includes(category)) {
    score += 7
    semanticHits += 1
  } else {
    for (const cat of topic.categories) {
      const aliases = CATEGORY_ALIASES[cat] || [cat]
      if (aliases.includes(category)) {
        score += 6
        semanticHits += 1
        break
      }
    }
  }

  const matched = hits + semanticHits > 0 || (topic.wantsPersonalRecall && topic.categories.includes(category))

  if (!matched) {
    return { score: 0, hits: 0, semanticHits: 0, matched: false }
  }

  // Importance (stored 0–10-ish)
  const importance = Number(row.importance) || 0
  score += Math.min(10, importance) * 1.1

  // Prefer preferences & long-term goals when on-topic
  const catBoost = CATEGORY_PRIORITY[category] || 1
  if (topic.categories.length === 0 || topic.categories.includes(category) || catBoost >= 1.3) {
    score *= catBoost
  } else {
    score *= Math.min(1.1, catBoost)
  }

  // Recency: updated / last used
  const recencyDays = Math.min(
    daysSince(row.updatedAt),
    daysSince(row.lastUsedAt),
    daysSince(row.createdAt),
  )
  if (recencyDays <= 7) score += 5
  else if (recencyDays <= 30) score += 3
  else if (recencyDays <= 90) score += 1.5
  else if (recencyDays > 365) score -= 2

  // Light usage signal
  const usage = Number(row.usageCount) || 0
  if (usage > 0) score += Math.min(3, usage * 0.25)

  // Soft-penalize obsolete even if explicitly allowed
  if (isObsoleteStatus(row.status)) {
    score *= 0.55
  }

  return {
    score,
    hits,
    semanticHits,
    matched: score >= MIN_RELEVANCE_SCORE || hits >= 1,
  }
}

/**
 * Keep prompt lean: diversify categories and hard-cap results.
 * Default maxPerCategory stays MAX_PER_CATEGORY (2). Core Recall may pass a
 * higher cap via searchMemories({ maxPerCategory }) — Specific Forget does not
 * use this path.
 *
 * @param {Array<{ row: any, score: number }>} scored
 * @param {number} limit
 * @param {number} [maxPerCategory]
 */
export function selectTopMemories(scored, limit, maxPerCategory = MAX_PER_CATEGORY) {
  const categoryCap = Math.min(
    Math.max(Number(maxPerCategory) || MAX_PER_CATEGORY, 1),
    Math.max(limit, 1),
  )
  const sorted = [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      (b.row.importance || 0) - (a.row.importance || 0) ||
      daysSince(a.row.updatedAt) - daysSince(b.row.updatedAt),
  )

  /** @type {typeof sorted} */
  const picked = []
  /** @type {Record<string, number>} */
  const perCategory = {}

  for (const item of sorted) {
    const cat = String(item.row.category || 'other').toLowerCase()
    const count = perCategory[cat] || 0
    if (count >= categoryCap) continue
    picked.push(item)
    perCategory[cat] = count + 1
    if (picked.length >= limit) break
  }

  return picked.map((item) => item.row)
}

/**
 * Retrieve only memories that are actually relevant to this turn.
 * Pipeline: detect topic → semantic match → rank → inject top-N only.
 * Never returns the whole store as a fallback.
 *
 * Ownership: pass `requireExplicitUserId: true` (Core Recall V1) to forbid
 * the legacy brain-api@local fallback — missing userId then throws.
 */
export async function searchMemories(query, options = {}) {
  if (options.requireExplicitUserId === true) {
    const explicit = typeof options.userId === 'string' ? options.userId.trim() : ''
    if (!explicit) {
      throw new Error('Explicit userId is required for authenticated memory operations')
    }
  }

  const supabase = await getServiceSupabase()
  const userId = await resolveMemoryUserId(
    {
      userId: options.userId,
      requireExplicitUserId: options.requireExplicitUserId === true,
    },
    supabase,
  )
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)
  const topic = detectMemoryTopic(query)

  let request = supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .order('importance', { ascending: false })
    .limit(160)

  if (options.category) {
    request = request.eq('category', options.category)
  }

  // Prefer active rows in SQL when possible; still filter client-side for safety
  if (!topic.wantsObsolete && options.includeObsolete !== true) {
    request = request.neq('status', 'obsolete').neq('status', 'archived')
  }

  const { data, error } = await request
  if (error) {
    // Older rows / missing status filter — retry without status predicates
    const fallback = await supabase
      .from('memories')
      .select(MEMORY_SELECT)
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .limit(160)
    if (fallback.error) throw new Error(error.message)
    return rankAndSelectMemories(fallback.data ?? [], query, topic, limit, options, supabase)
  }

  return rankAndSelectMemories(data ?? [], query, topic, limit, options, supabase)
}

/**
 * @param {any[]} rawRows
 * @param {string} query
 * @param {ReturnType<typeof detectMemoryTopic>} topic
 * @param {number} limit
 * @param {Record<string, unknown>} options
 * @param {any} supabase
 */
async function rankAndSelectMemories(rawRows, query, topic, limit, options, supabase) {
  let rows = rawRows.map(mapMemoryRow)
  if (rows.length === 0) return []

  const allowObsolete = topic.wantsObsolete || options.includeObsolete === true
  if (!allowObsolete) {
    rows = rows.filter((row) => !isObsoleteStatus(row.status))
  }

  // No meaningful query tokens and no topic → do not dump memories
  if (topic.queryTokens.length === 0 && topic.topicIds.length === 0) {
    return []
  }

  const scored = rows
    .map((row) => {
      const relevance = scoreMemoryRelevance(row, query, topic)
      return { row, ...relevance }
    })
    .filter((item) => item.matched && item.score >= MIN_RELEVANCE_SCORE)

  if (scored.length === 0) {
    return []
  }

  const maxPerCategory =
    typeof options.maxPerCategory === 'number' && Number.isFinite(options.maxPerCategory)
      ? options.maxPerCategory
      : MAX_PER_CATEGORY
  const results = selectTopMemories(scored, limit, maxPerCategory)

  if (results.length > 0) {
    await recordMemoryUsage(
      supabase,
      results.map((item) => item.id),
    )
  }

  return results
}

export async function runMemoryPipeline(input) {
  if (input.memoryEnabled === false) {
    return {
      saved: false,
      updated: false,
      skipped: true,
      reason: 'memory_disabled',
      decision: { ...NO_SAVE },
    }
  }

  const requireExplicitUserId = input.requireExplicitUserId === true
  const explicitUserId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (requireExplicitUserId && !explicitUserId) {
    throw new Error('Explicit userId is required for authenticated memory pipeline')
  }

  const decisionResult = analyzeConversation(input.userMessage, input.assistantMessage)

  if (!decisionResult.save) {
    return { saved: false, updated: false, skipped: false, decision: decisionResult }
  }

  // Belt-and-suspenders: drop like/dislike items when the utterance is interrogative
  // (or otherwise polarity-skip), before any upsert / conflict resolution.
  const skipPolarity = shouldSkipPreferencePolarityExtraction(input.userMessage || '')
  const isPolarityItem = (item) => {
    const key = typeof item?.factKey === 'string' ? item.factKey : ''
    return /^preferences\.(?:like|dislike)\./i.test(key)
  }

  // Belt-and-suspenders: never persist unsafe material even if a rule matched.
  if (
    containsUnsafeMemoryMaterial(input.userMessage) ||
    containsUnsafeMemoryMaterial(decisionResult.content)
  ) {
    return {
      saved: false,
      updated: false,
      skipped: true,
      reason: 'unsafe_content',
      decision: { ...NO_SAVE },
    }
  }

  const rawItems =
    Array.isArray(decisionResult.items) && decisionResult.items.length > 0
      ? decisionResult.items
      : [
          {
            category: decisionResult.category,
            title: decisionResult.title,
            content: decisionResult.content,
            importance: decisionResult.importance,
            source: decisionResult.source,
            confidence: decisionResult.confidence,
            factKey: decisionResult.factKey,
            tags: decisionResult.tags,
          },
        ]

  const filteredItems = skipPolarity ? rawItems.filter((item) => !isPolarityItem(item)) : rawItems

  // Belt-and-suspenders: never revoke / replace_set from interrogative / unsafe turns.
  const skipFavoriteRevoke = shouldSkipFavoriteRevocation(input.userMessage || '')
  const skipFavoriteReplace = shouldSkipFavoriteSetReplacement(input.userMessage || '')
  let guardedItems = filteredItems
  if (skipFavoriteRevoke) {
    guardedItems = guardedItems.filter(
      (item) => String(item?.operation || '').toLowerCase() !== 'revoke',
    )
  }
  if (skipFavoriteReplace) {
    guardedItems = guardedItems.filter(
      (item) => String(item?.operation || '').toLowerCase() !== 'replace_set',
    )
  }

  if (guardedItems.length === 0) {
    return {
      saved: false,
      updated: false,
      skipped: false,
      decision: { ...NO_SAVE },
    }
  }

  // One write max per single-valued fact_key in the same turn (sequential, no races).
  // Revoke / replace_set keep their own operation and are not collapsed into upserts.
  const upsertCandidates = guardedItems.filter((item) => {
    const op = String(item?.operation || '').toLowerCase()
    return op !== 'revoke' && op !== 'replace_set'
  })
  const revokeCandidates = guardedItems.filter(
    (item) => String(item?.operation || '').toLowerCase() === 'revoke',
  )
  const replaceSetCandidates = guardedItems.filter(
    (item) => String(item?.operation || '').toLowerCase() === 'replace_set',
  )
  const items = collapseItemsBySingleValuedFactKey(upsertCandidates)

  let created = 0
  let updated = 0
  let skipped = 0
  let revoked = 0
  let replaced = 0
  let lastMemory = null
  /** @type {any[]} */
  const slotCleanups = []
  /** @type {any[]} */
  const revokeResults = []
  /** @type {any[]} */
  const replaceSetResults = []

  const upsertDeps = input.supabase ? { supabase: input.supabase } : {}

  // Resolve owner once when revokes / replace_set need it.
  let controlUserId = explicitUserId
  let controlSupabase = input.supabase || null
  if (revokeCandidates.length > 0 || replaceSetCandidates.length > 0) {
    controlSupabase = input.supabase ?? (await getServiceSupabase())
    controlUserId = await resolveMemoryUserId(
      {
        userId: explicitUserId || input.userId,
        requireExplicitUserId: requireExplicitUserId,
      },
      controlSupabase,
    )
  }

  for (const item of revokeCandidates) {
    if (shouldSkipFavoriteRevocation(input.userMessage || '')) {
      skipped += 1
      continue
    }
    const result = await applyFavoriteRevocation(controlSupabase, controlUserId, item)
    revokeResults.push(result)
    if (result.action === 'revoked') revoked += 1
    else skipped += 1
  }

  for (const item of replaceSetCandidates) {
    if (shouldSkipFavoriteSetReplacement(input.userMessage || '')) {
      skipped += 1
      continue
    }
    const result = await applyCofavoriteSetReplacement(controlSupabase, controlUserId, {
      ...item,
      userMessage: input.userMessage || '',
    })
    replaceSetResults.push(result)
    if (result.action === 'replaced' || result.action === 'partial_obsolete') {
      replaced += 1
      // Incoming upserts may have created/updated rows; treat as saved.
      if (result.action === 'replaced') {
        // no-op marker — stats.replaced tracks success
      }
    } else {
      skipped += 1
    }
  }

  for (const item of items) {
    if (
      containsUnsafeMemoryMaterial(item.content) ||
      containsUnsafeMemoryMaterial(`${item.title || ''} ${item.content || ''}`)
    ) {
      skipped += 1
      continue
    }

    const result = await upsertMemory(
      {
        category: item.category,
        title: item.title,
        content: item.content,
        importance: item.importance,
        factKey: item.factKey || null,
        tags: item.tags || [],
        userMessage: input.userMessage,
        source: item.source === 'explicit' ? 'explicit' : 'automatic',
        confidence:
          typeof item.confidence === 'number' && Number.isFinite(item.confidence)
            ? item.confidence
            : item.source === 'explicit'
              ? 0.95
              : 0.8,
        ...(explicitUserId ? { userId: explicitUserId } : {}),
        ...(requireExplicitUserId ? { requireExplicitUserId: true } : {}),
      },
      upsertDeps,
    )
    if (result.action === 'created') created += 1
    else if (result.action === 'updated') updated += 1
    else skipped += 1
    lastMemory = result.memory || lastMemory
    if (result.slotCleanup) slotCleanups.push(result.slotCleanup)
  }

  return {
    saved: created + updated > 0 || revoked > 0 || replaced > 0,
    updated: updated > 0,
    revoked: revoked > 0,
    replaced: replaced > 0,
    skipped: created + updated + revoked + replaced === 0 && skipped > 0,
    decision: decisionResult,
    memory: lastMemory,
    stats: { created, updated, skipped, revoked, replaced },
    slotCleanups,
    revokeResults,
    replaceSetResults,
  }
}
