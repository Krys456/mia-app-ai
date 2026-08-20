/**
 * BrAIn intelligent memory — logic only (no schema / model changes).
 *
 * Saves only durable, long-term useful facts.
 * Auto-categorizes. Upserts instead of duplicating.
 * Retrieves only memories that actually match the turn.
 */

import { getServiceSupabase } from './supabase.js'

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
      // Interest stems (self-scoped probes; avoid bare EN "interest" → compound interest)
      'interessa',
      'interessi',
      'interessato',
      'interessata',
      'interested',
      'interests',
    ],
    related: [
      'prefer',
      'preference',
      'likes',
      'theme',
      'settings',
      'style',
      'interested',
      'interests',
      'interessa',
      'interessi',
      'interface',
      'interfaccia',
      'animation',
      'animazioni',
      'concise',
      'brief',
      'debug',
    ],
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
      'shop',
      'etsy',
      'negozio',
      'chiama',
      'called',
      'named',
      'cursor',
      'vscode',
      'editor',
      'strumento',
      'tool',
      'domotica',
      'smart home',
      'interfaccia',
      'interface',
      'ui',
      'templatenestkrys',
    ],
    related: [
      'project',
      'progetto',
      'progetti',
      'app',
      'mvp',
      'build',
      'develop',
      'shop',
      'etsy',
      'name',
      'nome',
      'called',
      'tool',
      'editor',
      'cursor',
      'vscode',
      'ide',
      'strumento',
      'interface',
      'ui',
      'interfaccia',
      'smooth',
      'fluide',
      'minimal',
      'minimale',
      'smart-home',
      'domotica',
      'home automation',
      'platform',
      'piattaforma',
      'store',
      'negozio',
    ],
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
  cibi: 'food',
  food: 'food',
  foods: 'food',
  sport: 'sport',
  sports: 'sport',
  musica: 'music',
  music: 'music',
  artista: 'artist',
  artisti: 'artist',
  artist: 'artist',
  artists: 'artist',
  tema: 'theme',
  theme: 'theme',
}

/** English gloss label for favorite/cofavorite content (Recall-friendly). */
const FAVORITE_SUBJECT_GLOSS = {
  color: 'color',
  animal: 'animal',
  anime: 'anime',
  character: 'character',
  game: 'game',
  series: 'series',
  film: 'film',
  movie: 'movie',
  book: 'book',
  food: 'food',
  sport: 'sport',
  music: 'music',
  artist: 'artist',
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
  if (hasMetaNegationCue(text)) return true
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
  // Also emit a cofavorite candidate for the same subject+value so
  // "X non è più il mio Y preferito" can revoke preferences.cofavorite.Y.X
  // when the durable row was stored as a multi-favorite member (not singular).
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
    pushCandidate('cofavorite', m[2], m[1])
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
    pushCandidate('cofavorite', m[1], m[2])
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
  if (hasMetaNegationCue(text)) return true
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
  // Same-turn preference ops alongside set replacement (incl. still/ancora forms).
  if (
    /\b(?:ma|but)\b/i.test(text) &&
    /\b(?:mi\s+piace|non\s+mi\s+piace|ancora\s+mi\s+piace|mi\s+piace\s+ancora|i\s+(?:still\s+)?like|i\s+like\b[\s\S]{0,40}\bstill\b|i\s+don'?t\s+like|i\s+love|i\s+hate)\b/i.test(
      text,
    )
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
 * Unicode-safe meta-negation / "it's false" cues.
 * Do NOT use JS `\b` immediately before accented letters (È/è): `\b` is ASCII-word only
 * and fails to match "^È falso" / " È falso".
 * @param {string} message
 * @returns {boolean}
 */
export function hasMetaNegationCue(message) {
  const text = String(message || '').trim()
  if (!text) return false
  // Left edge: start, whitespace, or common punctuation — never `\b` before È/è.
  const left = String.raw`(?:^|[\s,;:.'"“”‘’(\[{«])`
  if (new RegExp(`${left}[EeÈè]\\s+falso\\b`, 'u').test(text)) return true
  if (new RegExp(`${left}non\\s+[EeÈè]\\s+vero\\b`, 'iu').test(text)) return true
  if (/\bit'?s\s+false\b/i.test(text)) return true
  if (/\bit\s+is\s+false\b/i.test(text)) return true
  if (/\bit\s+isn'?t\s+true\b/i.test(text)) return true
  if (/\bit\s+is\s+not\s+true\b/i.test(text)) return true
  return false
}

/**
 * Reject lifecycle / filler tokens that must never become identity.name values.
 * Defense in depth — primary fix is revoke parsing + interrogative guards.
 * @param {string} value
 * @returns {boolean}
 */
export function isRejectedIdentityNameToken(value) {
  const v = cleanCapture(value)
  if (!v) return true
  return /^(?:pi[uù]|piu|ancora|anymore|again|no|not|non|longer|still|il|lo|la|un|una|a|an|the)$/i.test(
    v,
  )
}

/**
 * Normalize a personal name for exact revoke matching (case/accent-insensitive, no fuzzy).
 * @param {string} value
 * @returns {string}
 */
export function normalizeIdentityNameForMatch(value) {
  const cleaned = cleanCapture(value)
  if (!cleaned) return ''
  const slug = slugifyFactKeyPart(cleaned)
  return slug === 'item' && !/^[a-z0-9]/i.test(cleaned) ? '' : slug
}

/**
 * Parse stored identity.name content ("User's name is Marco.").
 * @param {string} content
 * @returns {string | null}
 */
export function identityNameValueFromContent(content) {
  const text = String(content || '')
  const m = text.match(/\buser'?s\s+name\s+is\s+([^.!?\n,;]+)/i)
  if (!m?.[1]) return null
  const name = cleanCapture(m[1])
  return name || null
}

/**
 * True when the utterance asks about the user's name / go-by (must not mutate identity.name).
 * Terminal `?` alone is sufficient via isTerminalInterrogativeUtterance.
 * @param {string} message
 * @returns {boolean}
 */
export function isIdentityNameQuestion(message) {
  const text = String(message || '').trim()
  if (!text) return false
  if (isTerminalInterrogativeUtterance(text)) return true
  if (/[?？]/u.test(text) && /\b(?:mi\s+chiamo|my\s+name|go\s+by|il\s+mio\s+nome)\b/i.test(text)) {
    return true
  }
  if (
    /^(?:come\s+mi\s+chiamo|qual\s+[eè]\s+il\s+mio\s+nome|what(?:'s|\s+is)\s+my\s+name)\b/i.test(
      text,
    )
  ) {
    return true
  }
  if (/^(?:is\s+my\s+name|do\s+i\s+(?:still\s+)?go\s+by|don'?t\s+i\s+go\s+by)\b/i.test(text)) {
    return true
  }
  return false
}

/**
 * Skip identity.name assert/revoke for interrogatives, meta, hyp, hedge, third-party.
 * @param {string} message
 * @returns {boolean}
 */
export function shouldSkipIdentityNameMutation(message) {
  const text = String(message || '').trim()
  if (!text) return true
  if (isTerminalInterrogativeUtterance(text)) return true
  if (isIdentityNameQuestion(text)) return true

  // Meta-negation / denial of the proposition
  if (/\bnon\s+ho\s+detto\b/i.test(text)) return true
  if (hasMetaNegationCue(text)) return true
  if (/\bi\s+did(?:\s+not|n'?t)\s+say\b/i.test(text)) return true

  // Hypothetical
  if (/\bse\s+mi\s+chiamass/i.test(text)) return true
  if (/\bif\s+my\s+name\s+were\b/i.test(text)) return true
  if (/\bif\s+i\s+(?:were|was)\s+called\b/i.test(text)) return true

  // Hedges — precision over destructive revoke
  if (/^(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text)) return true
  if (
    /\b(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text) &&
    /\b(?:non\s+mi\s+chiamo|don'?t\s+go\s+by|do\s+not\s+go\s+by|no\s+longer|name\s+isn'?t|name\s+is\s+no\s+longer)\b/i.test(
      text,
    )
  ) {
    return true
  }

  // Third-party: relationship role + their name — never first-person identity.name
  if (
    /\b(?:amico|amica|fratello|sorella|madre|padre|marito|moglie|partner|figlio|figlia|friend|brother|sister|mom|dad|husband|wife|son|daughter)\b/i.test(
      text,
    ) &&
    /\b(?:si\s+chiama|non\s+si\s+chiama|go\s+by|is\s+called|called|name\s+is)\b/i.test(text) &&
    !/\b(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè]|my\s+name\s+is|i\s+(?:don'?t|do\s+not)\s+go\s+by|i\s+no\s+longer\s+go\s+by)\b/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * High-confidence first-person identity.name revocation candidate.
 * False negatives preferred over destructive revoke.
 * @param {string} message
 * @returns {{ operation: 'revoke', category: 'identity', targetType: 'name', factKey: 'identity.name', value: string } | null}
 */
export function extractIdentityNameRevokeCandidate(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipIdentityNameMutation(user)) return null

  /** @type {RegExp[]} */
  const patterns = [
    // IT: Non mi chiamo più Marco.
    /\bnon\s+mi\s+chiamo\s+pi[uù]\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'-]{1,40})/i,
    // IT: Non mi chiamo Marco. (not "più" as the name token)
    /\bnon\s+mi\s+chiamo\s+(?!pi[uù]\b)([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'-]{1,40})/i,
    // EN: I don't / do not go by Marco anymore.
    /\bi\s+(?:don'?t|do\s+not)\s+go\s+by\s+([A-Za-z][\w'-]{1,40})\s+(?:anymore|any\s+more)\b/i,
    // EN: I no longer go by Marco.
    /\bi\s+no\s+longer\s+go\s+by\s+([A-Za-z][\w'-]{1,40})/i,
    // EN: My name is no longer Marco.
    /\bmy\s+name\s+is\s+no\s+longer\s+([A-Za-z][\w'-]{1,40})/i,
    // EN: My name isn't Marco anymore.
    /\bmy\s+name\s+isn'?t\s+([A-Za-z][\w'-]{1,40})\s+(?:anymore|any\s+more)\b/i,
  ]

  for (const pattern of patterns) {
    const match = user.match(pattern)
    const raw = match?.[1]?.trim()
    if (!raw || isRejectedIdentityNameToken(raw)) continue
    const value = cleanCapture(raw)
    if (!value || normalizeIdentityNameForMatch(value) === '') continue
    return {
      operation: 'revoke',
      category: 'identity',
      targetType: 'name',
      factKey: 'identity.name',
      value,
    }
  }
  return null
}

/**
 * Shared safety gate for interest / profession / primary-project lifecycle mutations.
 * Questions, meta, hedges, hypotheticals, and third-party framing must not mutate.
 * @param {string} message
 * @returns {boolean}
 */
export function shouldSkipLifecycleMutation(message) {
  const text = String(message || '').trim()
  if (!text) return true
  if (isTerminalInterrogativeUtterance(text)) return true

  if (/\bnon\s+ho\s+detto\b/i.test(text)) return true
  if (hasMetaNegationCue(text)) return true
  if (/\bi\s+did(?:\s+not|n'?t)\s+say\b/i.test(text)) return true

  // Hypothetical
  if (/\bse\s+(?:non\s+)?(?:fossi|fossimo|fossi\s+pi[uù])/i.test(text)) return true
  if (/\bif\s+i\s+(?:were|was|weren'?t|wasn'?t)\b/i.test(text)) return true

  // Hedges — including "Maybe I'm really into …" (interest assert must not fire)
  if (/^(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text)) return true
  if (
    /\b(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text) &&
    /\b(?:non\s+(?:mi\s+)?interess|no\s+longer|adoro|amo|really\s+into|interested\s+in|programmat|profession|progetto\s+principale|main\s+project|primary\s+project|lavoro|job|work\s+as)\b/i.test(
      text,
    )
  ) {
    return true
  }

  // Third-party: relationship role without clear first-person lifecycle frame
  if (
    /\b(?:amico|amica|fratello|sorella|madre|padre|marito|moglie|partner|figlio|figlia|friend|brother|sister|mom|dad|husband|wife|son|daughter)\b/i.test(
      text,
    ) &&
    /\b(?:interess|adoro|amo|programmat|lavor|job|project|progetto|profession|designer|working)\b/i.test(
      text,
    ) &&
    !/\b(?:non\s+mi\s+interessa|mi\s+interessa|non\s+adoro|non\s+amo|adoro|amo|non\s+sono|sono\s+(?:un|una)|non\s+faccio|faccio\s+(?:il|la)|non\s+lavoro|lavoro\s+come|i(?:'m|\s+am)\s+|i\s+(?:don'?t|do\s+not|no\s+longer)\s+work|my\s+(?:main|primary)\s+project|il\s+mi[oa]\s+progetto\s+principale|my\s+job)\b/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * Canonical entity cleaning for NEW interest/profession/primary lifecycle values.
 * Strips leading articles (incl. IT l') and lifecycle filler — does not migrate old keys.
 * @param {string} value
 * @returns {string}
 */
export function normalizeLifecycleEntityValue(value) {
  let v = cleanCapture(value)
  if (!v) return ''
  v = v
    .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
    .replace(/^l['\u2019']/i, '')
    .replace(/^(?:no\s+longer|non\s+pi[uù]|pi[uù])\s+/i, '')
    .replace(/\s+(?:no\s+longer|anymore|any\s+more|non\s+pi[uù]|pi[uù])$/i, '')
    .replace(/^(?:adesso|ora|now|anzi|actually|in\s+realt[aà])\s+/i, '')
    .replace(/\s+(?:adesso|ora|now)$/i, '')
    .trim()
  v = cleanCapture(v)
  if (!v) return ''
  if (/^(?:no\s+longer|non\s+pi[uù]|pi[uù]|anymore|item|adesso|ora|now)$/i.test(v)) {
    return ''
  }
  return v
}

/**
 * @param {string} value
 * @returns {string}
 */
export function lifecycleEntitySlug(value) {
  const cleaned = normalizeLifecycleEntityValue(value)
  if (!cleaned) return ''
  const slug = slugifyFactKeyPart(cleaned)
  return slug === 'item' && !/^[a-z0-9]/i.test(cleaned) ? '' : slug
}

/**
 * True when a capture looks like a lifecycle/malformed positive value.
 * @param {string} value
 * @returns {boolean}
 */
export function isLifecycleMalformedValue(value) {
  const v = cleanCapture(value)
  if (!v) return true
  return /^(?:no\s+longer|non\s+pi[uù]|pi[uù])\b/i.test(v) || /\bno\s+longer\b/i.test(v)
}

/**
 * Parse profession from canonical gloss: "User's profession / role: programmer."
 * @param {string} content
 * @returns {string | null}
 */
export function professionValueFromContent(content) {
  const text = String(content || '')
  const m =
    text.match(/\bprofession\s*\/\s*role:\s*([^.!?\n,;]+)/i) ||
    text.match(/\brole:\s*([^.!?\n,;]+)/i)
  if (!m?.[1]) return null
  const value = normalizeLifecycleEntityValue(m[1])
  return value || null
}

/**
 * Parse primary project from canonical gloss: "User's primary project: LAIfe."
 * @param {string} content
 * @returns {string | null}
 */
export function primaryProjectValueFromContent(content) {
  const text = String(content || '')
  const m = text.match(/\bprimary\s+project:\s*([^.!?\n,;]+)/i)
  if (!m?.[1]) return null
  const value = normalizeLifecycleEntityValue(m[1])
  return value || null
}

/**
 * Parse interest object from "User is interested in: Naruto."
 * @param {string} content
 * @returns {string | null}
 */
export function interestValueFromContent(content) {
  const text = String(content || '')
  const m = text.match(/\binterested\s+in:\s*([^.!?\n,;]+)/i)
  if (!m?.[1]) return null
  const value = normalizeLifecycleEntityValue(m[1])
  return value || null
}

/**
 * @param {string} message
 * @returns {{ operation: 'revoke', category: 'projects', targetType: 'primary_project', factKey: 'projects.primary', value: string } | null}
 */
export function extractPrimaryProjectRevokeCandidate(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipLifecycleMutation(user)) return null

  /** @type {RegExp[]} */
  const patterns = [
    // EN forward
    /\bmy\s+(?:main|primary)\s+project\s+is\s+no\s+longer\s+([^,.!?\n]{2,90})/i,
    /\bthe\s+main\s+project\s+i(?:'m|\s+am)\s+working\s+on\s+is\s+no\s+longer\s+([^,.!?\n]{2,90})/i,
    // EN reversed
    /\b([A-Za-z0-9][^,.!?\n]{0,80}?)\s+is\s+no\s+longer\s+my\s+(?:main|primary)\s+project\b/i,
    // IT forward
    /\b(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\s+non\s+[eè]\s+pi[uù]\s+([^,.!?\n]{2,90})/i,
    // IT reversed
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,80}?)\s+non\s+[eè]\s+pi[uù]\s+(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\b/i,
  ]

  for (const pattern of patterns) {
    const match = user.match(pattern)
    const raw = match?.[1]?.trim()
    if (!raw) continue
    const value = normalizeLifecycleEntityValue(raw)
    if (!value || value.length < 2 || isLifecycleMalformedValue(value)) continue
    if (/^(?:questo|quello|this|that|it|il|la|lo|un|una|a|an|the)$/i.test(value)) continue
    return {
      operation: 'revoke',
      category: 'projects',
      targetType: 'primary_project',
      factKey: 'projects.primary',
      value,
    }
  }
  return null
}

/**
 * @param {string} message
 * @returns {{ operation: 'revoke', category: 'skills', targetType: 'profession', factKey: 'skills.profession', value: string } | null}
 */
export function extractProfessionRevokeCandidate(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipLifecycleMutation(user)) return null

  /** @type {RegExp[]} */
  const patterns = [
    /\bnon\s+sono\s+pi[uù]\s+(?:un|una)\s+([^,.!?\n]{2,70})/i,
    /\bnon\s+sono\s+(?:un|una)\s+([^,.!?\n]{2,70})/i,
    /\bnon\s+faccio\s+pi[uù]\s+(?:il|la)\s+([^,.!?\n]{2,70})/i,
    /\bnon\s+faccio\s+(?:il|la)\s+([^,.!?\n]{2,70})/i,
    /\bnon\s+lavoro\s+pi[uù]\s+come\s+([^,.!?\n]{2,70})/i,
    /\bnon\s+lavoro\s+come\s+([^,.!?\n]{2,70})/i,
    /\bi(?:'m|\s+am)\s+no\s+longer\s+a(?:n)?\s+([^,.!?\n]{2,70})/i,
    /\bi\s+(?:don'?t|do\s+not)\s+work\s+as\s+(?:a(?:n)?\s+)?([^,.!?\n]{2,70}?)\s+(?:anymore|any\s+more)\b/i,
    /\bi\s+no\s+longer\s+work\s+as\s+(?:a(?:n)?\s+)?([^,.!?\n]{2,70})/i,
    /\bmy\s+job\s+is\s+no\s+longer\s+(?:a(?:n)?\s+)?([^,.!?\n]{2,70})/i,
  ]

  for (const pattern of patterns) {
    const match = user.match(pattern)
    const raw = match?.[1]?.trim()
    if (!raw) continue
    const value = normalizeLifecycleEntityValue(raw)
    if (!value || value.length < 2 || isLifecycleMalformedValue(value)) continue
    if (/^(?:persona|uomo|donna|guy|person|student|studente)$/i.test(value)) continue
    return {
      operation: 'revoke',
      category: 'skills',
      targetType: 'profession',
      factKey: 'skills.profession',
      value,
    }
  }
  return null
}

/**
 * @param {string} message
 * @returns {{ operation: 'revoke', category: 'preferences', targetType: 'interest', factKey: string, value: string } | null}
 */
export function extractInterestRevokeCandidate(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipLifecycleMutation(user)) return null

  /** @type {RegExp[]} */
  const patterns = [
    /\bnon\s+adoro\s+pi[uù]\s+([^,.!?\n]{2,60})/i,
    /\bnon\s+amo\s+pi[uù]\s+([^,.!?\n]{2,60})/i,
    /\bnon\s+mi\s+interessa\s+pi[uù]\s+([^,.!?\n]{2,60})/i,
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+non\s+mi\s+interessa\s+pi[uù](?=\s|$|[.!?…,;:])/i,
    /\bnon\s+sono\s+pi[uù]\s+interessat[oa]\s+(?:a|di)\s+([^,.!?\n]{2,60})/i,
    /\bi(?:'m|\s+am)\s+no\s+longer\s+interested\s+in\s+([^,.!?\n]{2,60})/i,
    /\bi(?:'m|\s+am)\s+not\s+interested\s+in\s+([^,.!?\n]{2,60}?)\s+(?:anymore|any\s+more)\b/i,
    /\bi(?:'m|\s+am)\s+no\s+longer\s+(?:really\s+)?into\s+([^,.!?\n]{2,60})/i,
  ]

  for (const pattern of patterns) {
    const match = user.match(pattern)
    const raw = match?.[1]?.trim()
    if (!raw) continue
    const value = normalizeLifecycleEntityValue(raw)
    if (!value || value.length < 2 || isLifecycleMalformedValue(value)) continue
    if (/^(?:quest[oa]|this|that|it)$/i.test(value)) continue
    const slug = lifecycleEntitySlug(value)
    if (!slug) continue
    return {
      operation: 'revoke',
      category: 'preferences',
      targetType: 'interest',
      factKey: `preferences.interest.${slug}`,
      value,
    }
  }
  return null
}

/**
 * True when message still contains a positive primary-project assert (successor).
 * Used to suppress revoke-first when assert-first successor is present.
 * @param {string} message
 * @returns {boolean}
 */
export function hasPositivePrimaryProjectAssert(message) {
  const raw = String(message || '').trim()
  if (!raw) return false
  // Strip known revoke clauses once, then test for a remaining positive assert.
  const user = raw
    .replace(/\bmy\s+(?:main|primary)\s+project\s+is\s+no\s+longer\s+[^,.!?\n]{2,90}/gi, ' ')
    .replace(
      /\bthe\s+main\s+project\s+i(?:'m|\s+am)\s+working\s+on\s+is\s+no\s+longer\s+[^,.!?\n]{2,90}/gi,
      ' ',
    )
    .replace(/\b[A-Za-z0-9][^,.!?\n]{0,80}?\s+is\s+no\s+longer\s+my\s+(?:main|primary)\s+project\b/gi, ' ')
    .replace(/\b(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\s+non\s+[eè]\s+pi[uù]\s+[^,.!?\n]{2,90}/gi, ' ')
    .replace(
      /\b[A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,80}?\s+non\s+[eè]\s+pi[uù]\s+(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (!user) return false
  // Optional temporal bridge (ora/adesso/now) between slot noun and copula —
  // e.g. "il mio progetto principale ora è LAIfe".
  return (
    /(?:(?:il|la)\s+mi[oa]\s+progetto\s+principale\s+(?:(?:ora|adesso|now)\s+)?(?:[eè]|si\s+chiama)\s+)(?!non\b)([^,.!?\n]{2,90})/i.test(
      user,
    ) ||
    /(?:il\s+progetto\s+principale(?:\s+su\s+cui\s+sto\s+lavorando)?\s+(?:(?:ora|adesso|now)\s+)?[eè]\s+)(?!non\b)([^,.!?\n]{2,90})/i.test(
      user,
    ) ||
    /(?:my\s+(?:main|primary)\s+project\s+(?:is(?:\s+called)?|is\s+now)\s+)(?!no\s+longer\b)([^,.!?\n]{2,90})/i.test(
      user,
    ) ||
    /(?:the\s+main\s+project\s+i(?:'m|\s+am)\s+working\s+on\s+(?:is(?:\s+now)?)\s+)(?!no\s+longer\b)([^,.!?\n]{2,90})/i.test(
      user,
    ) ||
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,80}?)\s+[eè]\s+(?:ora\s+|adesso\s+|now\s+)?(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\b/i.test(
      user,
    ) ||
    /\b([A-Za-z0-9][^,.!?\n]{0,80}?)\s+is\s+(?:now\s+)?my\s+(?:main|primary)\s+project\b/i.test(user)
  )
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
  if (hasMetaNegationCue(text)) return true
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
    // Reassertion / persistence cues — never entity text (#259).
    .replace(/^(?:di\s+nuovo|again|ancora|still|adesso|ora|now)\s+/i, '')
    .replace(/\s+(?:di\s+nuovo|again|ancora|still|adesso|ora|now)$/i, '')
    .trim()
  v = cleanCapture(v)
  if (isBarePreferenceFillerValue(v)) return ''
  return v
}

/**
 * True when a preference value collapsed to a discourse/filler token only.
 * @param {string} value
 * @returns {boolean}
 */
export function isBarePreferenceFillerValue(value) {
  const v = cleanCapture(value)
  if (!v) return true
  return /^(?:di\s+nuovo|again|ancora|still|adesso|ora|now|pi[uù]|piu|anymore)$/i.test(v)
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
/**
 * Multi-value like lists (IT "mi piacciono" / EN "I like A, B and C").
 * Returns 2–3 values only — singular likes stay on extractLikePreferenceValue.
 * Does not invent favorite/cofavorite subjects (no hardcoded color lexicon).
 *
 * @param {string} message
 * @returns {string[]}
 */
export function extractLikeListValues(message) {
  const user = String(message || '').trim()
  if (!user) return []
  if (shouldSkipPreferencePolarityExtraction(user)) return []
  if (extractDislikePreferenceValue(user)) return []
  // Favorite / preferiti framing owns the multi-value path.
  if (/\b(?:preferit\w*|favorite|favourite)\b/i.test(user)) return []

  /** @type {RegExp[]} */
  const patterns = [
    // IT plural: Mi piacciono [molto] …
    /(?:(?:adesso|ora)\s+)?(?<!non\s)mi\s+piacciono(?:\s+(?:molto|tant[oi]|parecchio))?\s+([^.!?\n]{3,140})/i,
    // EN: I really like / I like / I love A, B and C
    /\bi\s+really\s+(?:like|love)\s+([^.!?\n]{3,140})/i,
    /\bi\s+(?:like|love)\s+([^.!?\n]{3,140})/i,
  ]

  for (const pattern of patterns) {
    const m = user.match(pattern)
    if (!m?.[1]) continue
    const listRaw = cleanCapture(m[1])
      .replace(/,\s*(?:soprattutto|especially|in\s+particolare)\s+.+$/i, '')
      .trim()
    // Require list conjunction so "I like pizza a lot" stays singular.
    if (!/(?:,|\s+e\s+|\s+and\s+)/i.test(listRaw)) continue
    const parts = splitFavoriteList(listRaw, { maxItems: 3 })
      .map((part) => normalizePreferencePolarityValue(part))
      .filter((v) => v && v.length >= 2 && !isBarePreferenceFillerValue(v))
    if (parts.length >= 2) return [...new Set(parts)].slice(0, 3)
  }

  return []
}

export function extractLikePreferenceValue(message) {
  const user = String(message || '').trim()
  if (!user) return null
  // Every like/dislike path must refuse interrogatives before producing a candidate.
  if (shouldSkipPreferencePolarityExtraction(user)) return null
  // If a clear dislike shape is present, do not also treat as like.
  if (extractDislikePreferenceValue(user)) return null
  // Plural list likes are handled separately (atomic preferences.like.* rows).
  if (extractLikeListValues(user).length >= 2) return null

  // I still like X.
  let m = user.match(/\bi\s+still\s+(?:like|love)\s+([^,.!?\n]{2,90})/i)
  if (m?.[1]) {
    const value = normalizePreferencePolarityValue(m[1])
    return value || null
  }

  // I like X now / I like X again / I like X still.
  m = user.match(/\bi\s+like\s+([^,.!?\n]{2,90}?)\s+(?:now|again|still)\b/i)
  if (m?.[1]) {
    const value = normalizePreferencePolarityValue(m[1])
    return value || null
  }

  // Forward mi piace first (before reversed) so "Mi piace Naruto, …" keeps Naruto.
  m =
    user.match(/(?:preferisco)\s+([^,.!?\n]{3,90})/i) ||
    user.match(
      /(?:(?:adesso|ora)\s+)?(?<!non\s)mi\s+piace(?:\s+(?:molto|di\s+nuovo|ancora))?\s+([^,.!?\n]{3,90})/i,
    ) ||
    user.match(/\bi\s+changed\s+my\s+mind[,:]?\s*i\s+like\s+([^,.!?\n]{3,90})/i) ||
    user.match(/\bi\s+(?:prefer|like|love)\s+([^,.!?\n]{3,90})/i)
  if (m?.[1]) {
    const value = normalizePreferencePolarityValue(m[1])
    if (value) return value
  }

  // Reversed: X mi piace [di nuovo|ancora]. Reject discourse-leading leftovers.
  m = user.match(
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+mi\s+piace(?:\s+(?:di\s+nuovo|ancora|molto))?(?=\s|$|[.!?…,;:])/i,
  )
  if (m?.[1]) {
    let rawCapture = cleanCapture(m[1]).replace(/^(?:ma|but)\s+/i, '')
    if (
      rawCapture &&
      !/^(?:non|mi|anzi|actually|in\s+realt)/i.test(rawCapture)
    ) {
      const value = normalizePreferencePolarityValue(rawCapture)
      if (value && !isBarePreferenceFillerValue(value)) return value
    }
  }

  return null
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
    // Italian "ed" = "e" before vowels (rosso ed il viola)
    .replace(/\s*,\s*ed\s+/gi, ', ')
    .replace(/\s+ed\s+/gi, ', ')
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
    // Italian "ed" = "e" before vowels (rosso ed il viola)
    .replace(/\s*,\s*ed\s+/gi, ', ')
    .replace(/\s+ed\s+/gi, ', ')
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
 * Also strips additive / framing fillers so values stay canonical (viola, not "Anche il viola").
 * @param {string} value
 * @returns {string}
 */
export function cleanFavoritePreferenceValue(value) {
  let v = cleanCapture(value)
  v = v
    .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
    .replace(/^(?:anche|also|pure|too)\s+/i, '')
    .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
    .replace(/^(?:now|adesso|ora|anzi|actually)\s+/i, '')
    .replace(/^(?:besides|in\s+addition(?:\s+to)?)\s+/i, '')
    .replace(/^(?:oltre\s+(?:a|ad|al|all[oa]|ai|agli|alle)\s+)/i, '')
    .replace(/^(?:uno|una)\s+dei\s+mi(?:ei|e)\s+/i, '')
    .replace(/^(?:one\s+of\s+(?:my\s+)?)/i, '')
    .replace(/\s+(?:now|adesso|ora)$/i, '')
  return cleanCapture(v)
}

/**
 * High-confidence additive favorite / cofavorite candidates (IT + EN).
 * These assert a new set member without replacing the whole set.
 *
 * @param {string} message
 * @returns {Array<{ subject: string, value: string }>}
 */
export function extractAdditiveFavoriteCandidates(message) {
  const user = String(message || '').trim()
  if (!user || shouldSkipFavoriteRevocation(user)) return []
  if (isFavoritePreferenceQuestion(user)) return []
  if (shouldSkipFavoriteSetReplacement(user)) return []

  /** @type {Array<{ subject: string, value: string }>} */
  const out = []
  const push = (subjectRaw, valueRaw) => {
    const subject = normalizeFavoriteSubjectKey(subjectRaw)
    const value = cleanFavoritePreferenceValue(valueRaw)
    if (subject.length < 2 || value.length < 2) return
    if (isInterrogativeFavoriteValue(value)) return
    if (/^(tema|theme|item)$/i.test(subject)) return
    if (out.some((c) => c.subject === subject && slugifyFactKeyPart(c.value) === slugifyFactKeyPart(value))) {
      return
    }
    out.push({ subject, value })
  }

  /** @type {Array<[RegExp, number, number]>} subjectGroup, valueGroup */
  const patterns = [
    // IT: Il mio X preferito, oltre a…, è anche Y
    [
      /(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s*,?\s*oltre\s+(?:a|ad|al|all[oa]|ai|agli|alle)\s+[^,.!?\n]{2,80}?,\s*[eè]\s+(?:anche\s+)?([^,.!?\n]{2,60})/i,
      1,
      2,
    ],
    // IT: Il mio X preferito è anche Y
    [
      /(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s+[eè]\s+anche\s+([^,.!?\n]{2,60})/i,
      1,
      2,
    ],
    // IT: Tra i miei X preferiti c'è / ci sono anche Y
    [
      /\btra\s+i\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\s+(?:c['']?[eè]|ci\s+sono)\s+anche\s+([^,.!?\n]{2,60})/i,
      1,
      2,
    ],
    // IT: Anche Y è uno dei miei X preferiti
    [
      /\banche\s+([^,.!?\n]{2,60}?)\s+[eè]\s+un[oa]\s+dei\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\b/i,
      2,
      1,
    ],
    // IT: Anche Y è il mio X preferito (additive singular framing → cofavorite member)
    [
      /\banche\s+([^,.!?\n]{2,60}?)\s+[eè]\s+(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
      2,
      1,
    ],
    // IT: Aggiungi anche Y ai miei X preferiti
    [
      /\baggiungi\s+(?:anche\s+)?([^,.!?\n]{2,60}?)\s+ai\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ia]\b/i,
      2,
      1,
    ],
    // EN: Y is also one of my favorite X
    [
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+also\s+one\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
      2,
      1,
    ],
    // EN: Add Y to my favorite X
    [
      /\badd\s+([^,.!?\n]{2,60}?)\s+to\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
      2,
      1,
    ],
    // EN: Besides A and B, Y is also a/my favorite X
    [
      /\bbesides\s+[^,.!?\n]{2,80}?,\s*([^,.!?\n]{2,60}?)\s+is\s+also\s+(?:a\s+|my\s+)?favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
      2,
      1,
    ],
    // EN: Y is also my favorite X (additive singular framing → cofavorite)
    [
      /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+also\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
      2,
      1,
    ],
  ]

  for (const [pattern, subjectIdx, valueIdx] of patterns) {
    const m = user.match(pattern)
    if (m?.[subjectIdx] && m?.[valueIdx]) {
      push(m[subjectIdx], m[valueIdx])
      if (out.length > 0) return out
    }
  }

  return out
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
  // Conditioned / scoped reply-style slots are single-valued per key (#280/#282).
  if (/^settings\.reply_style\.when\.[a-z0-9_]+$/i.test(key)) return true
  if (/^projects\.[a-z0-9_]+\.reply_style(?:\.when\.[a-z0-9_]+)?$/i.test(key)) return true
  if (/^context\.[a-z0-9_]+\.reply_style(?:\.when\.[a-z0-9_]+)?$/i.test(key)) return true
  // Style-token reply keys (energetic, …) are single-valued per style token.
  if (/^projects\.[a-z0-9_]+\.reply_style\.[a-z0-9_]+$/i.test(key)) return true
  if (/^context\.[a-z0-9_]+\.reply_style\.[a-z0-9_]+$/i.test(key)) return true
  if (/^relationships\.pet\.[^.]+\.name$/.test(key)) return true
  if (key === 'projects.primary') return true
  if (key === 'skills.profession') return true
  // One active tool association per project+tool key (multi tools OK as distinct keys).
  // Not single-valued across tools — each projects.x.tools.y is its own multi row.
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
      const when = content.match(/\bwhen\s+([^.(]+)/i)
      if (when?.[1]) return `settings.reply_style.when.${slugifyFactKeyPart(when[1])}`
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
      const slug = lifecycleEntitySlug(value) || slugifyFactKeyPart(value)
      return `preferences.interest.${slug}`
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

  // #280: project rename / naming / scoped prefs are durable even with "adesso/now".
  if (extractProjectRenameCorrection(text)) return false
  if (extractProjectNamingCandidates(text).length > 0) return false
  if (extractLeadingEntityScope(text).scopeKind) return false

  // #325A: turn-local style ("Ora spiegalo dettagliatamente") is Conversation State, not Memory.
  if (isTransientResponseStyleInstruction(text)) return true

  // Standing reply-style preferences are durable; bare brevity tokens alone are not.
  if (
    hasDurableReplyStylePreferenceLanguage(text) &&
    (classifyReplyBrevity(text) ||
      /\b(?:keep\s+answers\s+brief|keep\s+replies\s+(?:brief|short|concise))\b/i.test(text))
  ) {
    return false
  }

  const durableCue =
    /\b(mi\s+chiamo|il\s+mio\s+nome|sono\s+(?:un|una)|preferisco|preferit\w*|favorite|mi\s+piace|non\s+mi\s+piace|odio|amo|adoro|mi\s+interessa|interessat\w*|appassionat\w*|hobby|lavoro|studio|imparando|imparare|obiettivo|progetto|sto\s+(?:sviluppando|creando|lavorando)|ricorda|sempre|mai|uso|utilizzo|abito|vivo|cane|gatto|my\s+name|i\s+am|i'm|i\s+prefer|i\s+like|i\s+love|i\s+hate|i\s+work|i\s+study|i\s+use|interested\s+in|really\s+into|learning|studying|my\s+goal|my\s+favorite|my\s+dog|my\s+cat|remember\s+that|always|never|developing|building|working\s+on|chiamarlo|si\s+chiama|don['\u2019]?t\s+call|shop|negozio|etsy|keep\s+answers|risposte\s+brevi)\b/i.test(
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
 * High-confidence same-turn correction markers (#259).
 * @param {string} text
 * @returns {{ index: number, length: number, marker: string, ellipticalOk: boolean } | null}
 */
export function findSameTurnCorrectionMarker(text) {
  const raw = String(text || '')
  /** @type {Array<{ re: RegExp, marker: string, ellipticalOk: boolean }>} */
  const markers = [
    { re: /\bmi\s+correggo\s*:\s*/i, marker: 'mi_correggo', ellipticalOk: true },
    { re: /\bcorrection\s*:\s*/i, marker: 'correction', ellipticalOk: true },
    { re: /,\s*anzi\s+/i, marker: 'anzi', ellipticalOk: true },
    { re: /\banzi\s+/i, marker: 'anzi', ellipticalOk: true },
    { re: /,\s*actually\s*,?\s+/i, marker: 'actually', ellipticalOk: true },
    { re: /\bactually\s*,?\s+/i, marker: 'actually', ellipticalOk: true },
    // in realtà / in realta — elliptical NOT ok (require full proposition after).
    { re: /,\s*in\s+realt[aà]\s+/i, marker: 'in_realta', ellipticalOk: false },
    { re: /\bin\s+realt[aà]\s+/i, marker: 'in_realta', ellipticalOk: false },
  ]
  /** @type {{ index: number, length: number, marker: string, ellipticalOk: boolean } | null} */
  let best = null
  for (const entry of markers) {
    const m = raw.match(entry.re)
    if (!m || m.index == null) continue
    if (best == null || m.index < best.index) {
      best = {
        index: m.index,
        length: m[0].length,
        marker: entry.marker,
        ellipticalOk: entry.ellipticalOk,
      }
    }
  }
  return best
}

/**
 * True when after-clause is object-less polarity (defer — no guessed mutation).
 * @param {string} after
 * @returns {boolean}
 */
export function isObjectEllipticalPolarityCorrection(after) {
  const t = cleanCapture(after)
  return /^(?:non\s+mi\s+piace|i\s+don'?t(?:\s+like)?|i\s+do\s+not(?:\s+like)?)\.?$/i.test(t)
}

/**
 * True when after already contains a full durable proposition (no elliptical expand).
 * @param {string} after
 * @returns {boolean}
 */
function afterHasFullDurableProposition(after) {
  const t = String(after || '').trim()
  return (
    /\b(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè]|my\s+name\s+is)\b/i.test(t) ||
    /\b(?:il|la)\s+mi[oa]\s+\w+\s+preferit[oa]\s+[eè]\b/i.test(t) ||
    /\bmy\s+favorite\s+\w+\s+is\b/i.test(t) ||
    /\b(?:progetto\s+principale|main\s+project|primary\s+project)\b/i.test(t) ||
    /\b(?:sono\s+(?:un|una)|faccio\s+(?:il|la)|lavoro\s+come|i(?:'m|\s+am)\s+a(?:n)?|i\s+work\s+as|my\s+job\s+is)\b/i.test(
      t,
    ) ||
    /\b(?:non\s+mi\s+piace|mi\s+piace|i\s+(?:don'?t\s+like|do\s+not\s+like|like|love|hate))\b/i.test(
      t,
    )
  )
}

/**
 * Expand elliptical correction using the preceding clause template.
 * @param {string} before
 * @param {string} after
 * @param {{ ellipticalOk?: boolean, marker?: string }} meta
 * @returns {string | null}
 */
export function expandSameTurnCorrectionEllipsis(before, after, meta = {}) {
  const left = cleanCapture(before)
  const right = cleanCapture(after)
  if (!left || !right) return null

  if (isObjectEllipticalPolarityCorrection(right)) return null
  if (afterHasFullDurableProposition(right)) return right

  if (meta.ellipticalOk === false) return null

  // Identity: Mi chiamo Marco → Luca
  if (
    /(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè])\s+[A-ZÀ-ÖØ-Ý]/i.test(left) ||
    /my\s+name\s+is\s+[A-Za-z]/i.test(left)
  ) {
    if (isRejectedIdentityNameToken(right)) return null
    if (!/^[A-ZÀ-ÖØ-Ýa-z][\wÀ-ÖØ-öø-ÿ'-]{0,40}$/u.test(right)) return null
    if (/\bmy\s+name\s+is\b/i.test(left)) return `My name is ${right}.`
    return `Mi chiamo ${right}.`
  }

  // Singular favorite: Il mio anime preferito è Naruto → Dragon Ball
  let fav =
    left.match(
      /(?:(?:il|la)\s+mi[oa]\s+)([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s+[eè]\s+/i,
    ) || left.match(/(?:my\s+favorite\s+)([A-Za-z][\w'-]{1,40})\s+is\s+/i)
  if (fav?.[1]) {
    const subject = cleanCapture(fav[1])
    if (subject.length < 2) return null
    if (/\bmy\s+favorite\b/i.test(left)) return `My favorite ${subject} is ${right}.`
    const art = /la\s+mia/i.test(left) ? 'La mia' : 'Il mio'
    return `${art} ${subject} preferito è ${right}.`
  }

  // Primary project
  if (
    /\b(?:progetto\s+principale|main\s+project|primary\s+project)\b/i.test(left) &&
    right.length >= 2 &&
    right.length <= 80
  ) {
    if (/\b(?:main|primary)\s+project\b/i.test(left)) {
      return `My main project is ${right}.`
    }
    return `Il mio progetto principale è ${right}.`
  }

  // Profession (narrow): Sono un programmatore → designer / un designer
  if (
    /(?:sono\s+(?:un|una)|faccio\s+(?:il|la)|lavoro\s+come)\s+/i.test(left) ||
    /(?:i(?:'m|\s+am)\s+a(?:n)?|i\s+work\s+as|my\s+job\s+is)\s+/i.test(left)
  ) {
    const role = normalizeLifecycleEntityValue(
      right.replace(/^(?:sono\s+(?:un|una)|faccio\s+(?:il|la)|lavoro\s+come|i(?:'m|\s+am)\s+a(?:n)?|i\s+work\s+as|my\s+job\s+is)\s+/i, ''),
    )
    if (
      role &&
      role.length >= 2 &&
      role.length <= 70 &&
      !isLifecycleMalformedValue(role) &&
      !/^(?:persona|uomo|donna|guy|person)$/i.test(role)
    ) {
      if (/\b(?:i(?:'m|\s+am)\s+a(?:n)?|i\s+work\s+as|my\s+job\s+is)\b/i.test(left)) {
        return `I am a ${role}.`
      }
      if (/\bfaccio\s+la\b/i.test(left) || /\bsono\s+una\b/i.test(left)) {
        return `Sono una ${role}.`
      }
      if (/\bfaccio\s+il\b/i.test(left)) {
        return `Faccio il ${role}.`
      }
      if (/\blavoro\s+come\b/i.test(left)) {
        return `Lavoro come ${role}.`
      }
      return `Sono un ${role}.`
    }
  }

  // No safe elliptical expansion (including polarity without object).
  return null
}

/**
 * True when `clause` is a positive singular favorite assert for `subject`
 * (not a revoke/negation). Avoid `\b` after `è` (JS word-boundary Unicode pitfall).
 * @param {string} clause
 * @param {string} subject
 * @returns {boolean}
 */
function clauseHasPositiveFavoriteAssert(clause, subject) {
  const right = String(clause || '').trim()
  const subj = String(subject || '').trim()
  if (!right || !subj) return false
  if (extractFavoriteRevokeCandidates(right).length > 0) return false
  const escaped = subj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    new RegExp(
      `(?:(?:il|la)\\s+mi[oa]\\s+${escaped}\\s+preferit[oa]\\s+[eè]\\s+|my\\s+favorite\\s+${escaped}\\s+is\\b)`,
      'i',
    ).test(right) ||
    /(?:(?:il|la)\s+mi[oa]\s+[A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40}\s+preferit[oa]\s+[eè]\s+|my\s+favorite\s+[A-Za-z][\w'-]{1,40}\s+is\b)/i.test(
      right,
    )
  )
}

/**
 * Try splitting `raw` with `splitter` into revoke-left + positive-successor-right.
 * @param {string} raw
 * @param {RegExp} splitter
 * @returns {string | null} successor clause text
 */
function tryFavoriteRevokeSuccessorSplit(raw, splitter) {
  const parts = String(raw || '')
    .split(splitter)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null

  for (let i = 0; i < parts.length - 1; i++) {
    const left = parts.slice(0, i + 1).join('. ').trim()
    const right = parts.slice(i + 1).join('. ').trim()
    const revokes = extractFavoriteRevokeCandidates(left)
    if (revokes.length !== 1) continue
    if (!clauseHasPositiveFavoriteAssert(right, revokes[0].subject)) continue
    return right.replace(/\s+/g, ' ').trim()
  }
  return null
}

/**
 * Punctuation-agnostic fallback: same-turn favorite revoke for subject S plus a
 * FULL explicit positive singular assert for S → return that assert clause only.
 * Does NOT expand elliptical "adesso è Y" (handled separately above).
 * @param {string} raw
 * @returns {string | null}
 */
function tryInlineFavoriteRevokeSuccessor(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const revokes = extractFavoriteRevokeCandidates(text)
  if (revokes.length !== 1) return null
  const subject = revokes[0].subject
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Positive assert must be `preferito è Y` / `favorite is Y` — never revoke phrasing
  // (`is no longer` / `is not` / `preferito non è`).
  const it = text.match(
    new RegExp(
      `((?:il|la)\\s+mi[oa]\\s+${escaped}\\s+preferit[oa]\\s+[eè]\\s+)(?!non\\b)([^,.!?;:\\n|—–]{2,80})`,
      'i',
    ),
  )
  if (it?.[1] && it?.[2]) {
    const value = cleanFavoritePreferenceValue(it[2])
    const clause = `${it[1]}${value}`.replace(/\s+/g, ' ').trim()
    // Matched span must itself be a positive assert, not a revoke clause.
    if (value.length >= 2 && clauseHasPositiveFavoriteAssert(clause, subject)) {
      return clause
    }
  }

  const en = text.match(
    new RegExp(
      `(my\\s+favorite\\s+${escaped}\\s+is\\s+)(?!no\\s+longer\\b|not\\b)([^,.!?;:\\n|—–]{2,80})`,
      'i',
    ),
  )
  if (en?.[1] && en?.[2]) {
    const value = cleanFavoritePreferenceValue(en[2])
    const clause = `${en[1]}${value}`.replace(/\s+/g, ' ').trim()
    if (value.length >= 2 && clauseHasPositiveFavoriteAssert(clause, subject)) {
      return clause
    }
  }

  return null
}

/**
 * Favorite revoke + explicit successor in same turn → rewrite to successor only.
 * Assert-first semantics: single-valued upsert supersedes old slot (no revoke-first).
 * @param {string} text
 * @returns {string | null}
 */
export function rewriteFavoriteRevokeSuccessor(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  // Pattern: "…non è più Naruto, adesso è Dragon Ball" / "now it's Dragon Ball"
  const commaAdesso = raw.match(
    /^([\s\S]+?)\s*,\s*(?:adesso|ora)\s+[eè]\s+([^,.!?\n]{2,80})\.?$/i,
  )
  if (commaAdesso?.[1] && commaAdesso?.[2]) {
    const leftRevokes = extractFavoriteRevokeCandidates(commaAdesso[1])
    if (leftRevokes.length === 1) {
      const subject = leftRevokes[0].subject
      const value = cleanFavoritePreferenceValue(commaAdesso[2])
      if (subject && value) {
        return `Il mio ${subject} preferito è ${value}.`
      }
    }
  }
  const commaNow = raw.match(
    /^([\s\S]+?)\s*,\s*now\s+it'?s\s+([^,.!?\n]{2,80})\.?$/i,
  )
  if (commaNow?.[1] && commaNow?.[2]) {
    const leftRevokes = extractFavoriteRevokeCandidates(commaNow[1])
    if (leftRevokes.length === 1) {
      const subject = leftRevokes[0].subject
      const value = cleanFavoritePreferenceValue(commaNow[2])
      if (subject && value) return `My favorite ${subject} is ${value}.`
    }
  }

  // Separators: ASCII ; .  and fullwidth ； ．
  // `\s*` (not `\s+`) so ";il mio…" still splits — Preview-fragile case.
  const byStop =
    tryFavoriteRevokeSuccessorSplit(raw, /\s*[;.；．]\s*/) ||
    // Full explicit successor after comma (not elliptical "adesso è"):
    // "…non è più …, il mio anime preferito è Dragon Ball."
    tryFavoriteRevokeSuccessorSplit(raw, /\s*,\s*/)
  if (byStop) return byStop

  // Preview Test C hardening: revoke + FULL successor assert even when the
  // separator is missing/odd (colon, dash, glued clauses). Never invent values.
  return tryInlineFavoriteRevokeSuccessor(raw)
}

/**
 * Resolve same-turn correction into an extraction plan.
 * Safety checks run on the ORIGINAL message; rewrite never bypasses them.
 *
 * @param {string} message
 * @returns {{
 *   mode: 'none' | 'rewrite' | 'skip_cofavorite_correction',
 *   text: string,
 *   kind?: string,
 *   safetyBlock?: boolean,
 * }}
 */
export function resolveSameTurnCorrection(message) {
  const text = String(message || '').trim()
  if (!text) return { mode: 'none', text: '' }

  // Whole-message safety — never rewrite past these.
  if (isTerminalInterrogativeUtterance(text)) {
    return { mode: 'none', text, safetyBlock: true }
  }
  if (hasMetaNegationCue(text) || /\bnon\s+ho\s+detto\b/i.test(text)) {
    return { mode: 'none', text, safetyBlock: true }
  }
  if (/^(?:forse|potrebbe|maybe|perhaps|possibly)\b/i.test(text)) {
    return { mode: 'none', text, safetyBlock: true }
  }
  if (
    /\b(?:amico|amica|fratello|sorella|madre|padre|marito|moglie|partner|figlio|figlia|friend|brother|sister|mom|dad|husband|wife|son|daughter)\b/i.test(
      text,
    ) &&
    /\b(?:si\s+chiama|non\s+si\s+chiama|go\s+by|is\s+called|name\s+is)\b/i.test(text) &&
    !/\b(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè]|my\s+name\s+is)\b/i.test(text)
  ) {
    return { mode: 'none', text, safetyBlock: true }
  }

  // Plural cofavorite + anzi/actually → safe no-write (behavior B). Avoid anzi_itachi.
  if (
    /\b(?:anzi|actually)\b/i.test(text) &&
    (/\bi\s+mi(?:ei|e)\s+[A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40}\s+preferit[ia]\b/i.test(text) ||
      /\bmy\s+favorite\s+[A-Za-z][\w'-]{1,40}\s+are\b/i.test(text))
  ) {
    return { mode: 'skip_cofavorite_correction', text }
  }

  // Explicit revoke + successor (no correction marker required).
  const successor = rewriteFavoriteRevokeSuccessor(text)
  if (successor) {
    return { mode: 'rewrite', text: successor, kind: 'favorite_successor' }
  }

  const hit = findSameTurnCorrectionMarker(text)
  if (!hit) return { mode: 'none', text }

  // Multiple markers → conservative skip.
  const rest = text.slice(hit.index + hit.length)
  if (findSameTurnCorrectionMarker(rest)) {
    return { mode: 'none', text }
  }

  const before = text.slice(0, hit.index).trim()
  const after = text.slice(hit.index + hit.length).trim()
  if (!before || !after) return { mode: 'none', text }

  const expanded = expandSameTurnCorrectionEllipsis(before, after, {
    ellipticalOk: hit.ellipticalOk,
    marker: hit.marker,
  })
  if (!expanded) return { mode: 'none', text }

  return {
    mode: 'rewrite',
    text: expanded,
    kind: `marker:${hit.marker}`,
  }
}


/**
 * Memory quality (#280) — deterministic helpers for naming, scope, reply-style,
 * temporary-vs-durable cues, and project rename. No LLM / no schema changes.
 */

/** Strip naming verbs so "called LAIfe" → "LAIfe". */
export function stripNamingVerbPrefix(value) {
  return cleanCapture(value)
    .replace(
      /^(?:called|named|known\s+as|si\s+chiama|e\s+chiamat[oa]|è\s+chiamat[oa]|chiamat[oa])\s+/i,
      '',
    )
    .replace(/^(?:the\s+)?(?:name\s+is|nome\s+[eè])\s+/i, '')
    .trim()
}

/**
 * True when the utterance is a temporary task instruction (belongs in #278, not Memory).
 * @param {string} message
 */
export function isTemporaryInstructionCue(message) {
  const t = String(message || '')
  return /\b(?:for\s+the\s+next\s+step|for\s+this\s+(?:step|test|turn|task)|just\s+for\s+now|for\s+now|temporarily|this\s+turn|in\s+this\s+message|per\s+il\s+prossimo\s+step|per\s+questo\s+(?:step|test|turno)|solo\s+per\s+ora|temporaneamente|per\s+questa\s+risposta|in\s+questa\s+risposta|questa\s+volta|for\s+this\s+(?:reply|answer|response)|this\s+time)\b/i.test(
    t,
  )
}

/**
 * Standing preference / memory language required before reply_style becomes durable Memory.
 * Turn-local delivery cues ("Ora spiegalo dettagliatamente") lack these markers and must
 * stay in Conversation State explicitOverrides only (#325A).
 * @param {string} message
 * @returns {boolean}
 */
export function hasDurableReplyStylePreferenceLanguage(message) {
  const t = String(message || '')
  if (!t.trim()) return false
  if (
    /\b(?:preferisco|i\s+prefer|i\s+like(?:\s+to)?|mi\s+piacciono|mi\s+piace)\b/i.test(t)
  ) {
    return true
  }
  if (
    /\b(?:ricorda(?:ti)?(?:\s+che)?|remember(?:\s+that)?|non\s+dimenticare|don['\u2019]?t\s+forget)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(?:da\s+ora\s+in\s+poi|d['\u2019]?ora\s+in\s+avanti|from\s+now\s+on|going\s+forward|in\s+generale|generally|usually|always|sempre)\b/i.test(
      t,
    )
  ) {
    return true
  }
  // Idiomatic standing brevity preference (existing Memory contract).
  if (
    /\b(?:keep\s+answers\s+brief|keep\s+replies\s+(?:brief|short|concise))\b/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * Turn-level response-style instruction → Conversation State, not durable Memory (#325A).
 * Returns false when standing preference language is present.
 * @param {string} message
 * @returns {boolean}
 */
export function isTransientResponseStyleInstruction(message) {
  const t = String(message || '').trim()
  if (!t) return false
  if (hasDurableReplyStylePreferenceLanguage(t)) return false
  if (isTemporaryInstructionCue(t)) return true

  // Imperative / local delivery style (IT + EN), including "Ora spiegalo dettagliatamente".
  if (
    /(?:^|[.!?]\s*)(?:(?:ora|adesso|now)\s+)?(?:spiega(?:melo|mela|lo|mi)?|rispondi|approfondisci|dammi|fammi|fai|usa|non\s+usare|sii|vai|explain|answer|reply|tell\s+me|give\s+me|make\s+it|be)\b/i.test(
      t,
    ) &&
    /\b(?:dettagliat\w*|brevemen|semplic|sintetic|cort[oa]|formal|informal|emoji|lista|elenco|punto|approfond|detailed|brief|short|concise|simple|thorough|list|bullet)\b/i.test(
      t,
    )
  ) {
    return true
  }

  if (
    /^(?:be\s+more\s+detailed|make\s+it\s+detailed|give\s+a\s+detailed\b|più\s+(?:corto|breve)|sii\s+(?:sintetic\w*|formal\w*|breve))\b/i.test(
      t,
    )
  ) {
    return true
  }

  return false
}

/**
 * Leading entity / project scope. Returns remainder without the scope prefix.
 * @param {string} message
 * @returns {{ scope: string | null, scopeKind: 'project' | 'this_project' | null, remainder: string }}
 */
export function extractLeadingEntityScope(message) {
  const raw = String(message || '').trim()
  if (!raw) return { scope: null, scopeKind: null, remainder: '' }

  // "Per i post di ChAIn …" / "For ChAIn content …"
  let m =
    raw.match(
      /^(?:for|per)\s+(?:(?:i|the|il|la)\s+)?(?:posts?|content|copy|stile|style)\s+(?:di|of|for)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s*[,:]?\s*(.+)$/i,
    ) ||
    raw.match(
      /^(?:for|per)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(?:content|posts?|copy)\s+(.+)$/i,
    )
  if (m?.[1] && m?.[2]) {
    return {
      scope: cleanCapture(m[1]),
      scopeKind: 'project',
      remainder: cleanCapture(m[2]),
    }
  }

  m =
    raw.match(
      /^(?:for|per)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s*[,:]\s*(.+)$/i,
    ) ||
    raw.match(
      /^(?:for|per)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(.+)$/i,
    )
  if (m?.[1] && m?.[2]) {
    const scope = cleanCapture(m[1])
    if (scope && !/^(?:this|that|it|questo|quello)$/i.test(scope)) {
      return { scope, scopeKind: 'project', remainder: cleanCapture(m[2]) }
    }
  }

  m =
    raw.match(
      /^(?:when\s+working\s+on|while\s+working\s+on|quando\s+(?:lavoro|lavoriamo)\s+su)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s*[,:]\s*(.+)$/i,
    ) ||
    raw.match(
      /^(?:when\s+working\s+on|while\s+working\s+on|quando\s+(?:lavoro|lavoriamo)\s+su)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(.+)$/i,
    )
  if (m?.[1] && m?.[2]) {
    return {
      scope: cleanCapture(m[1]),
      scopeKind: 'project',
      remainder: cleanCapture(m[2]),
    }
  }

  m = raw.match(
    /^(?:for\s+this\s+project|per\s+(?:questo|il)\s+progetto)\s*[,:]?\s*(.+)$/i,
  )
  if (m?.[1]) {
    return { scope: 'this_project', scopeKind: 'this_project', remainder: cleanCapture(m[1]) }
  }

  return { scope: null, scopeKind: null, remainder: raw }
}

/**
 * @param {string} text
 * @returns {'concise' | 'detailed' | null}
 */
export function classifyReplyBrevity(text) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return null
  if (
    /\b(detailed|dettagliat\w*|in[- ]?depth|lungh[ei]|verbose|thorough)\b/i.test(t)
  ) {
    return 'detailed'
  }
  // Italian "spiegazioni dettagliate" / EN "detailed explanations" without explicit "replies"
  if (
    /\b(spiegazioni?\s+dettagliat\w*|detailed\s+explanations?|explanations?\s+detailed)\b/i.test(
      t,
    )
  ) {
    return 'detailed'
  }
  if (
    /\b(concise|short|brief|brevi|concis|sintetic)\b/i.test(t) &&
    /\b(answer|answers|reply|replies|response|responses|rispost)\b/i.test(t)
  ) {
    return 'concise'
  }
  if (
    /\b(?:keep\s+answers\s+brief|keep\s+replies\s+(?:brief|short|concise)|risposte\s+brevi|risposte\s+concis)\b/i.test(
      t,
    )
  ) {
    return 'concise'
  }
  return null
}

/**
 * Map soft activity conditions to reply-style context scopes (#282).
 * @param {string} condition
 * @returns {string | null}
 */
export function mapReplyStyleContextScope(condition) {
  const c = cleanCapture(condition).toLowerCase()
  if (!c) return null
  // Studying/learning are soft context scopes (#282 collision fix vs project styles).
  // Bare "debugging" stays a when-condition on settings (see #280).
  if (/^(?:stud(?:y|ying|ies)|studio|studiando|learning|imparando)$/i.test(c)) {
    return 'studying'
  }
  if (/^(?:school|scuola)$/i.test(c)) return 'school'
  return null
}

/**
 * Parse "when debugging LAIfe" / "debugging LAIfe" → { condition, projectScope }.
 * @param {string} rawCondition
 * @returns {{ condition: string | null, projectScope: string | null, contextScope: string | null }}
 */
export function parseReplyStyleWhenCondition(rawCondition) {
  const raw = cleanCapture(rawCondition)
  if (!raw) return { condition: null, projectScope: null, contextScope: null }

  let m =
    raw.match(
      /^(?:debugging|debug|debuggando|coding|programming|working\s+on|lavorando\s+su)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})$/i,
    ) ||
    raw.match(
      /^(?:sviluppando|lavorando\s+(?:su|a))\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})$/i,
    )
  if (m?.[1]) {
    const activity = cleanCapture(raw.slice(0, raw.length - m[1].length))
      .replace(/\s+/g, ' ')
      .trim()
    const condSlug = /debug/i.test(activity)
      ? 'debugging'
      : /cod|programm|svilupp/i.test(activity)
        ? 'coding'
        : 'working'
    return {
      condition: condSlug,
      projectScope: cleanCapture(m[1]),
      contextScope: null,
    }
  }

  const contextScope = mapReplyStyleContextScope(raw)
  if (contextScope) {
    return { condition: null, projectScope: null, contextScope }
  }
  // Bare activity words (debugging, coding, …) → when-condition on settings
  if (/^(?:debugging|debug|debuggando|coding|programming|work(?:ing)?|lavoro)$/i.test(raw)) {
    const cond = /debug/i.test(raw) ? 'debugging' : /cod|programm/i.test(raw) ? 'coding' : 'work'
    return { condition: cond, projectScope: null, contextScope: null }
  }
  return { condition: raw, projectScope: null, contextScope: null }
}

/**
 * Content-style token (energetic / flashy / …) — not brevity.
 * @param {string} text
 * @returns {string | null}
 */
export function extractContentStyleToken(text) {
  const m = String(text || '').match(
    /\b(energetic|energico|energica|flashy|appariscent[ei]|minimal|minimale|smooth|fluide|fluido)\b/i,
  )
  if (!m?.[1]) return null
  const raw = cleanCapture(m[1]).toLowerCase()
  if (/^energic/i.test(raw)) return 'energetic'
  if (/^appariscent|^flashy/i.test(raw)) return 'flashy'
  if (/^minimal/i.test(raw)) return 'minimal'
  if (/^smooth|^fluid/i.test(raw)) return 'smooth'
  return slugifyFactKeyPart(raw) || null
}

/**
 * Extract trailing condition ("when debugging", "only when Y").
 * @param {string} text
 * @returns {{ body: string, condition: string | null }}
 */
export function splitPreferenceCondition(text) {
  const raw = cleanCapture(text)
  if (!raw) return { body: '', condition: null }

  let m = raw.match(
    /^(.+?)\s+(?:only\s+when|only\s+if|quando|when(?:\s+we(?:'re|\s+are))?|while)\s+(.+)$/i,
  )
  if (m?.[1] && m?.[2]) {
    return { body: cleanCapture(m[1]), condition: cleanCapture(m[2]) }
  }
  m = raw.match(/^(.+?)\s+solo\s+quando\s+(.+)$/i)
  if (m?.[1] && m?.[2]) {
    return { body: cleanCapture(m[1]), condition: cleanCapture(m[2]) }
  }
  return { body: raw, condition: null }
}

/**
 * @param {'concise' | 'detailed'} style
 * @param {string | null | undefined} condition
 * @param {string | null | undefined} scope
 */
export function formatReplyStyleContent(style, condition, scope) {
  const styleText = style === 'detailed' ? 'detailed replies' : 'concise replies'
  let content =
    style === 'detailed'
      ? 'User prefers detailed replies.'
      : 'User prefers concise replies.'
  if (condition) {
    content = `User prefers ${styleText} when ${cleanCapture(condition)}.`
  }
  if (scope && scope !== 'this_project') {
    content = `For ${cleanCapture(scope)}: ${content.replace(/^User\s+/i, 'user ')}`
  } else if (scope === 'this_project') {
    content = `For this project: ${content.replace(/^User\s+/i, 'user ')}`
  }
  return content
}

/**
 * High-confidence project / shop / AI naming extractions from a clause.
 * @param {string} message
 * @returns {Array<{ kind: 'project' | 'shop' | 'ai', name: string, shopKind?: string, content: string, factKey: string, title: string, importance: number }>}
 */
export function extractProjectNamingCandidates(message) {
  const user = String(message || '').trim()
  /** @type {Array<{ kind: 'project' | 'shop' | 'ai', name: string, shopKind?: string, content: string, factKey: string, title: string, importance: number }>} */
  const out = []
  if (!user) return out

  const pushNamed = (kind, nameRaw, title, contentPrefix, keyPrefix, shopKind) => {
    const name = stripNamingVerbPrefix(nameRaw)
    if (!name || name.length < 2) return
    if (/^(questo|quello|this|that|it|il|la|lo|un|una|a|an|the)$/i.test(name)) return
    if (isLifecycleMalformedValue(name)) return
    const slug = slugifyFactKeyPart(name)
    /** @type {{ kind: 'project' | 'shop' | 'ai', name: string, shopKind?: string, content: string, factKey: string, title: string, importance: number }} */
    const row = {
      kind,
      name,
      title,
      content: `${contentPrefix}: ${name}.`,
      factKey: `${keyPrefix}.${slug}`,
      importance: kind === 'shop' ? 7 : 7,
    }
    if (shopKind) row.shopKind = shopKind
    if (!out.some((x) => x.factKey === row.factKey)) out.push(row)
  }

  // Etsy / shop naming (EN + IT word orders)
  // EN: "My Etsy shop is called X" / "The Etsy shop is called X" / "My shop is called X"
  // IT: "Il mio negozio Etsy si chiama X" / "Il mio negozio si chiama X" /
  //     "Il mio shop Etsy si chiama X" / "Il negozio Etsy si chiama X"
  const normalizeShopKind = (raw) => {
    const k = cleanCapture(raw || '').toLowerCase()
    if (!k || /^(?:my|mio|mia|the|il|la|lo|un|una|a|an)$/i.test(k)) return 'shop'
    if (/^etsy$/i.test(k)) return 'etsy'
    return slugifyFactKeyPart(k) || 'shop'
  }

  const pushShop = (nameRaw, kindRaw) => {
    const shopKind = normalizeShopKind(kindRaw)
    const label = shopKind === 'shop' ? 'shop' : `${shopKind} shop`
    const keyPrefix = shopKind === 'shop' ? 'projects.shop' : `projects.shop.${shopKind}`
    pushNamed('shop', nameRaw, 'Shop', `User's ${label}`, keyPrefix, shopKind)
  }

  /** @type {RegExpMatchArray | null} */
  let m = null

  // IT: negozio/shop Etsy si chiama NAME
  m = user.match(
    /(?:(?:il|la)\s+)?(?:mi[oa]\s+)?(?:negozio|shop|store)\s+(etsy)\s+si\s+chiama\s+([^,.!?\n]{2,60})/i,
  )
  if (m?.[1] && m?.[2]) {
    pushShop(m[2], m[1])
  } else {
    // IT: negozio/shop si chiama NAME (generic shop)
    m = user.match(
      /(?:(?:il|la)\s+)?(?:mi[oa]\s+)?(?:negozio|shop|store)\s+si\s+chiama\s+([^,.!?\n]{2,60})/i,
    )
    if (m?.[1]) pushShop(m[1], 'shop')
  }

  // EN: Etsy shop is called NAME
  if (!out.some((x) => x.kind === 'shop')) {
    m = user.match(
      /(?:(?:the|my)\s+)?(etsy)\s+(?:shop|store|negozio)\s+(?:is\s+)?(?:called|named)\s+([^,.!?\n]{2,60})/i,
    )
    if (m?.[1] && m?.[2]) {
      pushShop(m[2], m[1])
    } else {
      m = user.match(
        /(?:(?:the|my)\s+)?(?:shop|store)\s+(?:is\s+)?(?:called|named)\s+([^,.!?\n]{2,60})/i,
      )
      if (m?.[1]) pushShop(m[1], 'shop')
    }
  }

  // Mixed EN/IT: shop Etsy is called / si chiama
  if (!out.some((x) => x.kind === 'shop')) {
    m = user.match(
      /(?:(?:the|my|il|la)\s+)?(?:mi[oa]\s+)?(?:shop|store|negozio)\s+(etsy)\s+(?:is\s+)?(?:called|named|si\s+chiama)\s+([^,.!?\n]{2,60})/i,
    )
    if (m?.[1] && m?.[2]) pushShop(m[2], m[1])
  }

  // My AI / assistant is called X
  m =
    user.match(
      /(?:my\s+(?:ai|assistant|bot)|il\s+mio\s+(?:ai|assistente))\s+(?:is\s+)?(?:called|named|si\s+chiama)\s+([^,.!?\n]{2,60})/i,
    ) ||
    user.match(
      /(?:my\s+(?:ai|assistant|bot)\s+project|il\s+mio\s+progetto\s+ai)\s+(?:is\s+)?(?:called|named|si\s+chiama)\s+([^,.!?\n]{2,60})/i,
    )
  if (m?.[1]) {
    pushNamed('ai', m[1], 'Project', "User's AI project", 'projects', null)
  }

  // My project is called X / My project is named X / Il mio progetto si chiama X
  m =
    user.match(
      /(?:my\s+(?:ai\s+)?project|il\s+mio\s+progetto(?:\s+ai)?)\s+(?:is\s+)?(?:called|named|si\s+chiama)\s+([^,.!?\n]{2,60})/i,
    ) ||
    user.match(
      /(?:my\s+(?:ai\s+)?project|il\s+mio\s+progetto(?:\s+ai)?)\s+is\s+([^,.!?\n]{2,60})/i,
    )
  if (m?.[1]) {
    pushNamed('project', m[1], 'Project', "User's project", 'projects', null)
  }

  return out
}

/**
 * Explicit project rename / alias correction.
 * @param {string} message
 * @returns {{ oldName: string, newName: string } | null}
 */
export function extractProjectRenameCorrection(message) {
  const user = String(message || '').trim()
  if (!user) return null

  let m = user.match(
    /(?:don['\u2019]?t|do\s+not|non)\s+call\s+(?:the\s+project\s+|it\s+|il\s+progetto\s+)?([^,.!?\n]{2,40}?)\s+(?:anymore|any\s+more|pi[uù])\s*[,;.]?\s*(?:it['\u2019]?s|adesso\s+[eè]|ora\s+[eè]|now\s+it['\u2019]?s|it\s+is)\s+([^,.!?\n]{2,40})/i,
  )
  if (m?.[1] && m?.[2]) {
    return {
      oldName: stripNamingVerbPrefix(m[1]),
      newName: stripNamingVerbPrefix(m[2]),
    }
  }

  m = user.match(
    /(?:non\s+(?:lo\s+)?chiam(?:are|arlo|at[ea])?\s+pi[uù]\s+)([^,.!?\n]{2,40}?)\s*[,;.]?\s*(?:adesso\s+si\s+chiama|adesso\s+[eè]|ora\s+[eè]|si\s+chiama)\s+([^,.!?\n]{2,40})/i,
  )
  if (m?.[1] && m?.[2]) {
    return {
      oldName: stripNamingVerbPrefix(m[1]),
      newName: stripNamingVerbPrefix(m[2]),
    }
  }

  // "Non chiamarlo più Nexus, adesso si chiama LAIfe."
  m = user.match(
    /non\s+chiamarlo\s+pi[uù]\s+([^,.!?\n]{2,40}?)\s*[,;.]?\s*adesso\s+si\s+chiama\s+([^,.!?\n]{2,40})/i,
  )
  if (m?.[1] && m?.[2]) {
    return {
      oldName: stripNamingVerbPrefix(m[1]),
      newName: stripNamingVerbPrefix(m[2]),
    }
  }

  m = user.match(
    /(?:the\s+old\s+name\s+was|si\s+chiamava)\s+([^,.!?\n]{2,40}?)\s*[.:,;]\s*(?:now\s+it['\u2019]?s|adesso\s+[eè]|ora\s+[eè]|it['\u2019]?s|is)\s+([^,.!?\n]{2,40})/i,
  )
  if (m?.[1] && m?.[2]) {
    return {
      oldName: stripNamingVerbPrefix(m[1]),
      newName: stripNamingVerbPrefix(m[2]),
    }
  }

  m = user.match(
    /(?:it['\u2019]?s\s+not|non\s+[eè]\s+pi[uù])\s+([^,.!?\n]{2,40}?)\s*(?:anymore|any\s+more)?\s*[,—\-–]+\s*(?:it['\u2019]?s|adesso\s+[eè]|ora\s+[eè]|is)\s+([^,.!?\n]{2,40})/i,
  )
  if (m?.[1] && m?.[2]) {
    return {
      oldName: stripNamingVerbPrefix(m[1]),
      newName: stripNamingVerbPrefix(m[2]),
    }
  }

  return null
}

// —— #282 project-scoped depth associations (deterministic; no migration) ——

/** Soft context scopes for reply-style (not product names). */
const REPLY_STYLE_CONTEXT_SCOPES = new Set([
  'studying',
  'studio',
  'study',
  'learning',
  'coding',
  'debugging',
  'work',
  'lavoro',
  'school',
  'scuola',
])

/** Narrow future-feature alias → canonical slug. */
const FUTURE_FEATURE_ALIASES = {
  domotica: 'smart_home',
  'smart home': 'smart_home',
  smarthome: 'smart_home',
  'home automation': 'smart_home',
  homeautomation: 'smart_home',
  'smart-home': 'smart_home',
  'controllo della smart home': 'smart_home',
  'smart-home control': 'smart_home',
  'smart home control': 'smart_home',
  'luci di casa': 'smart_home',
  'le luci di casa': 'smart_home',
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeFutureFeatureSlug(value) {
  const cleaned = cleanCapture(value)
    .replace(/^(?:la|il|lo|le|i|gli|the|a|an|anche|also)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  const lower = cleaned.toLowerCase()
  if (FUTURE_FEATURE_ALIASES[lower]) return FUTURE_FEATURE_ALIASES[lower]
  for (const [alias, slug] of Object.entries(FUTURE_FEATURE_ALIASES)) {
    if (lower.includes(alias)) return slug
  }
  return slugifyFactKeyPart(cleaned)
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeFutureFeatureLabel(value) {
  const slug = normalizeFutureFeatureSlug(value)
  if (slug === 'smart_home') return 'smart-home control'
  return cleanCapture(value).replace(/^(?:la|il|lo|le|i|gli|the|a|an|anche|also)\s+/i, '') || slug
}

/**
 * @param {string} project
 * @param {string} tool
 */
export function buildProjectToolFactKey(project, tool) {
  return `projects.${slugifyFactKeyPart(project)}.tools.${slugifyFactKeyPart(tool)}`
}

/**
 * @param {string} project
 * @param {string} feature
 */
export function buildProjectFutureFactKey(project, feature) {
  const feat = normalizeFutureFeatureSlug(feature)
  return `projects.${slugifyFactKeyPart(project)}.future.${feat || 'feature'}`
}

/**
 * @param {string} style
 * @param {string | null | undefined} condition
 * @param {string | null | undefined} scope
 */
export function buildReplyStyleFactKey(style, condition, scope) {
  const cond = cleanCapture(condition || '')
  const scopeRaw = cleanCapture(scope || '')
  if (!scopeRaw || scopeRaw === 'this_project') {
    const base =
      scopeRaw === 'this_project' ? 'projects.this_project.reply_style' : 'settings.reply_style'
    if (!cond) return base
    return `${base}.when.${slugifyFactKeyPart(cond)}`
  }
  const scopeSlug = slugifyFactKeyPart(scopeRaw)
  const isContext =
    REPLY_STYLE_CONTEXT_SCOPES.has(scopeSlug) ||
    REPLY_STYLE_CONTEXT_SCOPES.has(scopeRaw.toLowerCase())
  const prefix = isContext ? `context.${scopeSlug}` : `projects.${scopeSlug}`
  if (cond) return `${prefix}.reply_style.when.${slugifyFactKeyPart(cond)}`
  // Optional style token for non-brevity content styles (energetic, …)
  const styleSlug = slugifyFactKeyPart(style || '')
  if (styleSlug && styleSlug !== 'concise' && styleSlug !== 'detailed') {
    return `${prefix}.reply_style.${styleSlug}`
  }
  return `${prefix}.reply_style`
}

/**
 * High-confidence project ↔ development tool associations (IT/EN).
 * @param {string} message
 * @returns {Array<{ project: string, tool: string, factKey: string, content: string }>}
 */
export function extractProjectToolCandidates(message) {
  const user = String(message || '').trim()
  /** @type {Array<{ project: string, tool: string, factKey: string, content: string }>} */
  const out = []
  if (!user || isTemporaryInstructionCue(user)) return out
  // Corrections are handled separately — do not assert "più Cursor" etc.
  if (extractProjectToolCorrection(user)) return out
  if (
    /\b(?:non\s+uso\s+pi[uù]|don['\u2019]?t\s+use\b.{0,40}\banymore|do\s+not\s+use\b.{0,40}\banymore)\b/i.test(
      user,
    )
  ) {
    return out
  }
  // Temporary next-step tool instructions must not become durable.
  if (
    /\b(?:for\s+(?:this|the)\s+(?:next\s+)?(?:step|task|turn)|per\s+(?:questo|il)\s+(?:prossimo\s+)?(?:step|task|turno))\b/i.test(
      user,
    )
  ) {
    return out
  }

  const pushTool = (projectRaw, toolRaw) => {
    const project = cleanCapture(projectRaw).replace(/^(?:il|la|the|my|mio|mia)\s+/i, '')
    const tool = cleanCapture(toolRaw)
      .replace(/^(?:soprattutto|especially|mainly|principalmente)\s+/i, '')
      .replace(/\s+(?:soprattutto|especially|mainly|principalmente)$/i, '')
    if (!project || project.length < 2 || !tool || tool.length < 2) return
    if (/^(?:questo|quello|this|that|it|progetto|project)$/i.test(project)) return
    if (/^(?:questo|quello|this|that|it)$/i.test(tool)) return
    const factKey = buildProjectToolFactKey(project, tool)
    if (out.some((x) => x.factKey === factKey)) return
    out.push({
      project,
      tool,
      factKey,
      content: `${project} development tool: ${tool}`,
    })
  }

  /** @type {Array<[RegExp, number, number]>} */
  const patterns = [
    // Di solito sviluppo LAIfe con Cursor / sviluppo LAIfe con Cursor
    [
      /(?:di\s+solito\s+|normalmente\s+)?(?:sviluppo|sviluppo\s+principalmente|lavoro\s+su)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+con\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40})/i,
      1,
      2,
    ],
    // Di solito per LAIfe lavoro con Cursor / Per LAIfe uso Cursor
    [
      /(?:di\s+solito\s+|normalmente\s+|sempre\s+)?per\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(?:lavoro|sviluppo|programmo)\s+con\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40})/i,
      1,
      2,
    ],
    [
      /(?:di\s+solito\s+|normalmente\s+)?per\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+uso\s+(?:soprattutto\s+)?([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40})/i,
      1,
      2,
    ],
    // LAIfe la sviluppo / sto sviluppando con Cursor
    [
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(?:la\s+|lo\s+)?(?:sviluppo|sto\s+sviluppando|sviluppo\s+principalmente)\s+(?:principalmente\s+)?con\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40})/i,
      1,
      2,
    ],
    // Uso Cursor per (sviluppare) LAIfe
    [
      /\buso\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40}?)\s+per\s+(?:sviluppare\s+|costruire\s+)?([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})/i,
      2,
      1,
    ],
    // Cursor è lo strumento che uso per LAIfe
    [
      /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+[eè]\s+(?:(?:praticamente\s+)?(?:lo\s+|il\s+)?strumento\s+che\s+uso|the\s+tool\s+i\s+use)\s+per\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})/i,
      2,
      1,
    ],
    // EN: I usually use Cursor for LAIfe / I use Cursor for LAIfe
    [
      /\b(?:i\s+)?(?:usually\s+|normally\s+|always\s+)?(?:use|using)\s+([A-Za-z0-9][\w'’.& -]{1,40}?)\s+for\s+([A-Za-z0-9][\w'’.&-]{1,40})\b/i,
      2,
      1,
    ],
    // I develop/build LAIfe with Cursor
    [
      /\b(?:i\s+)?(?:develop|build|am\s+building|am\s+developing|developing|building)\s+([A-Za-z0-9][\w'’.&-]{1,40})\s+with\s+([A-Za-z0-9][\w'’.& -]{1,40})\b/i,
      1,
      2,
    ],
    // I use Cursor to build/develop LAIfe
    [
      /\b(?:i\s+)?use\s+([A-Za-z0-9][\w'’.& -]{1,40}?)\s+to\s+(?:build|develop|create)\s+([A-Za-z0-9][\w'’.&-]{1,40})\b/i,
      2,
      1,
    ],
    // Cursor is the tool I use for LAIfe
    [
      /\b([A-Za-z0-9][\w'’.&-]{1,40})\s+is\s+(?:the\s+)?tool\s+i\s+use\s+for\s+([A-Za-z0-9][\w'’.&-]{1,40})\b/i,
      2,
      1,
    ],
    // I normally use Cursor to develop LAIfe
    [
      /\b(?:i\s+)?(?:normally|usually)\s+use\s+([A-Za-z0-9][\w'’.& -]{1,40}?)\s+to\s+(?:develop|build)\s+([A-Za-z0-9][\w'’.&-]{1,40})\b/i,
      2,
      1,
    ],
  ]

  for (const [re, pIdx, tIdx] of patterns) {
    const m = user.match(re)
    if (m?.[pIdx] && m?.[tIdx]) pushTool(m[pIdx], m[tIdx])
  }

  // Same-message: "My AI project is LAIfe" + "with Cursor" / "building it with Cursor"
  if (out.length === 0) {
    const named = extractProjectNamingCandidates(user).find((n) => n.kind === 'project' || n.kind === 'ai')
    const withTool =
      user.match(
        /\b(?:build(?:ing)?|develop(?:ing)?)\s+it\s+with\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\b/i,
      ) ||
      user.match(
        /\b(?:with|using|con)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\b(?:\s+and\b|\s*,|\s*\.|$)/i,
      )
    if (named?.name && withTool?.[1]) {
      const tool = cleanCapture(withTool[1])
      if (!/^(?:a|an|the|un|una|il|la)\b/i.test(tool) && tool.length >= 2) {
        pushTool(named.name, tool)
      }
    }
  }

  return out
}

/**
 * Scoped tool correction: stop using A for project; now use B.
 * @param {string} message
 * @returns {{ project: string, oldTool: string, newTool: string, oldFactKey: string, newFactKey: string, newContent: string } | null}
 */
export function extractProjectToolCorrection(message) {
  const user = String(message || '').trim()
  if (!user || isTemporaryInstructionCue(user)) return null

  /** @type {RegExpMatchArray | null} */
  let m = user.match(
    /\b(?:i\s+)?(?:don['\u2019]?t|do\s+not)\s+use\s+([A-Za-z0-9][\w'’.& -]{1,40}?)\s+for\s+([A-Za-z0-9][\w'’.&-]{1,40})\s+anymore\s*[;,.]\s*(?:now\s+)?(?:i\s+)?use\s+([A-Za-z0-9][\w'’.& -]{1,40})/i,
  )
  if (m?.[1] && m?.[2] && m?.[3]) {
    const oldTool = cleanCapture(m[1])
    const project = cleanCapture(m[2])
    const newTool = cleanCapture(m[3])
    if (project && oldTool && newTool && slugifyFactKeyPart(oldTool) !== slugifyFactKeyPart(newTool)) {
      return {
        project,
        oldTool,
        newTool,
        oldFactKey: buildProjectToolFactKey(project, oldTool),
        newFactKey: buildProjectToolFactKey(project, newTool),
        newContent: `${project} development tool: ${newTool}`,
      }
    }
  }

  // IT: Per LAIfe non uso più Cursor, adesso uso VS Code
  m = user.match(
    /\bper\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+non\s+uso\s+pi[uù]\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40}?)\s*[,;.]?\s*(?:adesso|ora)\s+uso\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40})/i,
  )
  if (m?.[1] && m?.[2] && m?.[3]) {
    const project = cleanCapture(m[1])
    const oldTool = cleanCapture(m[2])
    const newTool = cleanCapture(m[3])
    if (project && oldTool && newTool && slugifyFactKeyPart(oldTool) !== slugifyFactKeyPart(newTool)) {
      return {
        project,
        oldTool,
        newTool,
        oldFactKey: buildProjectToolFactKey(project, oldTool),
        newFactKey: buildProjectToolFactKey(project, newTool),
        newContent: `${project} development tool: ${newTool}`,
      }
    }
  }

  // IT: Non uso più Cursor per LAIfe, adesso uso VS Code
  m = user.match(
    /\bnon\s+uso\s+pi[uù]\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40}?)\s+per\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s*[,;.]?\s*(?:adesso|ora)\s+uso\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&. -]{1,40})/i,
  )
  if (m?.[1] && m?.[2] && m?.[3]) {
    const oldTool = cleanCapture(m[1])
    const project = cleanCapture(m[2])
    const newTool = cleanCapture(m[3])
    if (project && oldTool && newTool && slugifyFactKeyPart(oldTool) !== slugifyFactKeyPart(newTool)) {
      return {
        project,
        oldTool,
        newTool,
        oldFactKey: buildProjectToolFactKey(project, oldTool),
        newFactKey: buildProjectToolFactKey(project, newTool),
        newContent: `${project} development tool: ${newTool}`,
      }
    }
  }

  m = user.match(
    /\bi\s+switched\s+to\s+([A-Za-z0-9][\w'’.& -]{1,40}?)\s+for\s+([A-Za-z0-9][\w'’.&-]{1,40})\b/i,
  )
  if (m?.[1] && m?.[2]) {
    // Switch without explicit old tool — assert new only (caller may not revoke).
    const project = cleanCapture(m[2])
    const newTool = cleanCapture(m[1])
    return {
      project,
      oldTool: '',
      newTool,
      oldFactKey: '',
      newFactKey: buildProjectToolFactKey(project, newTool),
      newContent: `${project} development tool: ${newTool}`,
    }
  }

  return null
}

/**
 * Explicit project-tied future features (IT/EN).
 * @param {string} message
 * @returns {Array<{ project: string, feature: string, featureLabel: string, factKey: string, content: string }>}
 */
export function extractProjectFutureFeatureCandidates(message) {
  const user = String(message || '').trim()
  /** @type {Array<{ project: string, feature: string, featureLabel: string, factKey: string, content: string }>} */
  const out = []
  if (!user || isTemporaryInstructionCue(user)) return out
  // Hedge / vague "maybe someday"
  if (/\b(?:maybe|perhaps|forse|potrei|might)\b/i.test(user) && !/\b(?:voglio|want|vorrei)\b/i.test(user)) {
    return out
  }
  // Ephemeral next-step "Add X next"
  if (/^(?:add|aggiungi)\b/i.test(user) && !/\b(?:in\s+futuro|eventually|later|pi[uù]\s+avanti)\b/i.test(user)) {
    return out
  }

  const pushFeat = (projectRaw, featureRaw) => {
    const project = cleanCapture(projectRaw).replace(/^(?:il|la|the|my|mio|mia)\s+/i, '')
    const featureLabel = normalizeFutureFeatureLabel(featureRaw)
    const featureSlug = normalizeFutureFeatureSlug(featureRaw)
    if (!project || project.length < 2 || !featureSlug || featureSlug.length < 2) return
    const factKey = buildProjectFutureFactKey(project, featureSlug)
    if (out.some((x) => x.factKey === factKey)) return
    out.push({
      project,
      feature: featureSlug,
      featureLabel,
      factKey,
      content: `${project} future feature: ${featureLabel}`,
    })
  }

  /** @type {Array<[RegExp, number, number]>} */
  const patterns = [
    [
      /\b(?:voglio|vorrei)\s+che\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+in\s+futuro\s+(?:controll(?:i|asse|are)|avess[ea]|includ(?:a|esse)|gestisse)\s+(?:anche\s+)?([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
    [
      /\bvorrei\s+che\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+in\s+futuro\s+(?:controllasse|avesse|includesse)\s+(?:anche\s+)?([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
    [
      /\buna\s+cosa\s+che\s+voglio\s+(?:assolutamente\s+)?(?:aggiungere\s+a|per)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(?:pi[uù]\s+avanti\s+)?[eè]\s+(?:la\s+)?([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
    [
      /\bper\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+voglio\s+in\s+futuro\s+(?:il\s+|la\s+)?([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
    [
      /\bi\s+want\s+([A-Za-z0-9][\w'’.&-]{1,40})\s+to\s+eventually\s+(?:control|have|include)\s+(?:my\s+)?([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
    [
      /\bone\s+(?:feature|thing)\s+i\s+want\s+to\s+add\s+to\s+([A-Za-z0-9][\w'’.&-]{1,40})\s+(?:later|eventually)\s+is\s+([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
    [
      /\bi\s+want\s+to\s+add\s+([^,.!?\n]{3,60}?)\s+to\s+([A-Za-z0-9][\w'’.&-]{1,40})\s+in\s+the\s+future\b/i,
      2,
      1,
    ],
    [
      /\bi\s+want\s+([A-Za-z0-9][\w'’.&-]{1,40})\s+to\s+have\s+([^,.!?\n]{3,60}?)\s+in\s+the\s+future\b/i,
      1,
      2,
    ],
    [
      /\bper\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+voglio\s+(?:aggiungere\s+)?in\s+futuro\s+(?:il\s+|la\s+)?([^,.!?\n]{3,80})/i,
      1,
      2,
    ],
  ]

  for (const [re, pIdx, fIdx] of patterns) {
    const m = user.match(re)
    if (m?.[pIdx] && m?.[fIdx]) pushFeat(m[pIdx], m[fIdx])
  }

  return out
}

/**
 * @param {string} message
 * @returns {{ project: string, feature: string, factKey: string } | null}
 */
export function extractProjectFutureFeatureRevoke(message) {
  const user = String(message || '').trim()
  if (!user) return null
  const m =
    user.match(
      /\bi\s+(?:no\s+longer\s+want|don['\u2019]?t\s+want)\s+([^,.!?\n]{3,60}?)\s+for\s+([A-Za-z0-9][\w'’.&-]{1,40})\b/i,
    ) ||
    user.match(
      /\b(?:non\s+voglio\s+pi[uù]|non\s+mi\s+interessa\s+pi[uù])\s+([^,.!?\n]{3,60}?)\s+per\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\b/i,
    )
  if (!m?.[1] || !m?.[2]) return null
  const feature = normalizeFutureFeatureSlug(m[1])
  const project = cleanCapture(m[2])
  if (!feature || !project) return null
  return {
    project,
    feature,
    factKey: buildProjectFutureFactKey(project, feature),
  }
}

/**
 * Soft-revoke a scoped UI preference (flashy animations, etc.).
 * @param {string} message
 * @returns {{ project: string, preference: string, factKey: string } | null}
 */
export function extractProjectPreferenceRevoke(message) {
  const user = String(message || '').trim()
  if (!user) return null

  let m =
    user.match(
      /\b(?:for|per)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(?:i\s+)?(?:don['\u2019]?t\s+want|do\s+not\s+want|non\s+voglio\s+pi[uù])\s+([^,.!?\n]{3,80}?)\s+(?:anymore|any\s+more|pi[uù])\b/i,
    ) ||
    user.match(
      /\b(?:for|per)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+(?:i\s+)?(?:don['\u2019]?t\s+want|do\s+not\s+want|non\s+voglio(?:\s+pi[uù])?)\s+([^,.!?\n]{3,80})/i,
    )
  if (!m?.[1] || !m?.[2]) return null
  const project = cleanCapture(m[1])
  let preference = cleanCapture(m[2])
    .replace(/\s+(?:anymore|any\s+more|pi[uù])$/i, '')
    .replace(/^(?:un['\u2019]?|una\s+|uno\s+|un\s+|the\s+|a\s+|an\s+|le\s+|gli\s+)/i, '')
    .trim()
  if (!project || preference.length < 3) return null
  // Normalize flashy animations aliases for key match
  if (/\b(?:flashy|appariscent)/i.test(preference)) {
    preference = /animazion|animation/i.test(preference)
      ? 'flashy animations'
      : 'flashy'
  }
  return {
    project,
    preference,
    factKey: `projects.${slugifyFactKeyPart(project)}.preferences.${slugifyFactKeyPart(preference)}`,
  }
}

/**
 * Shop name ↔ platform (Etsy) associations.
 * @param {string} message
 * @returns {Array<{ name: string, platform: string, factKey: string, content: string }>}
 */
export function extractShopPlatformCandidates(message) {
  const user = String(message || '').trim()
  /** @type {Array<{ name: string, platform: string, factKey: string, content: string }>} */
  const out = []
  if (!user) return out

  const pushShop = (nameRaw, platformRaw) => {
    const name = cleanCapture(nameRaw)
    const platform = cleanCapture(platformRaw)
    if (!name || name.length < 2 || !platform) return
    const platSlug = slugifyFactKeyPart(platform)
    const factKey = `projects.shop.${platSlug}.${slugifyFactKeyPart(name)}`
    if (out.some((x) => x.factKey === factKey)) return
    out.push({
      name,
      platform,
      factKey,
      content: `User's ${platform} shop: ${name}`,
    })
  }

  const patterns = [
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+[eè]\s+il\s+nome\s+che\s+uso\s+per\s+il\s+mio\s+negozio\s+(etsy)\b/i,
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+is\s+the\s+name\s+i\s+use\s+for\s+my\s+(etsy)\s+shop\b/i,
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+[eè]\s+il\s+nome\s+del\s+mio\s+negozio\s+(etsy)\b/i,
    /\b(?:il\s+mio\s+negozio|my\s+(?:shop|store))\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+[eè]\s+su\s+(etsy)\b/i,
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+[eè]\s+il\s+mio\s+negozio\s+su\s+(etsy)\b/i,
    /\b([A-Za-z0-9][\w'’.&-]{1,40})\s+is\s+my\s+(etsy)\s+shop\b/i,
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+[eè]\s+il\s+mio\s+negozio\s+(?:su\s+)?(etsy)\b/i,
  ]
  for (const re of patterns) {
    const m = user.match(re)
    if (m?.[1] && m?.[2]) {
      pushShop(m[1], m[2])
      return out
    }
  }

  if (/\btemplatenestkrys\b/i.test(user) && /\betsy\b/i.test(user)) {
    pushShop('TemplateNestKrys', 'Etsy')
  }

  return out
}

/**
 * Soft-obsolete an exact fact_key row (project tool / future / scoped prefs).
 * @param {any} supabase
 * @param {string} userId
 * @param {{ operation?: string, targetType?: string, factKey?: string | null, value?: string }} item
 */
export async function applyExactFactKeyRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  const factKey = typeof item?.factKey === 'string' ? item.factKey.trim() : ''
  if (!uid || !factKey) {
    return { action: 'skipped', obsoletedIds: [], factKey: factKey || null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const categoryGuess = factKey.startsWith('preferences.')
    ? 'preferences'
    : factKey.startsWith('settings.') || factKey.startsWith('context.')
      ? 'settings'
      : 'projects'
  const listed = await listActiveRowsForFactKey(supabase, uid, factKey, categoryGuess)
  if (listed.error) {
    console.warn(
      '[brain-memory] exact fact_key revoke lookup failed (fact_key_omitted)',
      String(listed.error).slice(0, 180),
    )
    return { action: 'skipped', obsoletedIds: [], factKey }
  }
  const matches = listed.rows || []
  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }
  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `exact_fact_key_revoke:${factKey}`,
  )
  return {
    action: (result.obsoletedIds || []).length > 0 ? 'revoked' : 'not_found',
    obsoletedIds: result.obsoletedIds || [],
    factKey,
  }
}

/**
 * Durable scoped constraint (never modify X) — not temporary next-step cues.
 * @param {string} message
 * @returns {{ scope: string | null, constraint: string } | null}
 */
export function extractScopedDurableConstraint(message) {
  if (isTemporaryInstructionCue(message)) return null
  const { scope, scopeKind, remainder } = extractLeadingEntityScope(message)
  const text = remainder || String(message || '').trim()

  const m =
    text.match(
      /^(?:never|do\s+not|don['\u2019]?t|non)\s+(?:modify|change|edit|touch|modificare|cambiare|toccare)\s+(.+)$/i,
    ) ||
    text.match(/^(?:never|do\s+not|don['\u2019]?t)\s+(?:modify|change|edit|touch)\s+(.+)$/i)

  // Require durability cue: scoped, or always/going forward/from now on/unless necessary
  const durableCue =
    Boolean(scope) ||
    /\b(?:always|usually|going\s+forward|from\s+now\s+on|unless\s+necessary|a\s+meno\s+che|sempre|di\s+solito)\b/i.test(
      String(message || ''),
    )

  if (!m?.[1] || !durableCue) return null
  // Reject bare temporary phrasing even if matched
  if (isTemporaryInstructionCue(text)) return null

  // Preserve file extensions (api/chat.ts) — do not truncate at '.'
  let constraint = cleanCapture(`${m[0]}`)
  if (/api\/chat/i.test(constraint) && /api\/chat\.ts/i.test(String(message || ''))) {
    constraint = constraint.replace(/api\/chat(?!\.ts)/i, 'api/chat.ts')
  }
  const unless = String(message || '').match(
    /\bunless\s+necessary\b|\ba\s+meno\s+che(?:\s+sia)?\s+necessari[oa]\b/i,
  )
  if (unless && !/unless\s+necessary|a\s+meno\s+che/i.test(constraint)) {
    constraint = `${constraint} ${cleanCapture(unless[0])}`
  }

  return {
    scope: scopeKind === 'this_project' ? 'this_project' : scope,
    constraint,
  }
}

/**
 * Split high-confidence multi-preference clauses (same scope).
 * @param {string} remainder
 * @returns {string[]}
 */
export function splitHighConfidencePreferenceClauses(remainder) {
  const raw = cleanCapture(remainder)
  if (!raw) return []
  const parts = raw.split(
    /\s*,\s*(?:but|ma|però|pero|while|e\s+però)\s+|\s+but\s+|\s+però\s+|\s+ma\s+/i,
  )
  return parts.map((p) => cleanCapture(p)).filter((p) => p.length >= 4)
}

/**
 * Prefer / like / want UI-feel clause → preference body or null.
 * @param {string} clause
 */
export function extractScopedPreferenceBody(clause) {
  const t = cleanCapture(clause)
  if (!t) return null

  let m =
    t.match(/^(?:i\s+)?(?:prefer|like|love)\s+(.+)$/i) ||
    t.match(/^(?:preferisco|mi\s+piace)\s+(.+)$/i) ||
    t.match(/^(?:i\s+want)\s+(.+)$/i) ||
    t.match(/^(?:voglio)\s+(.+)$/i)
  if (m?.[1]) return cleanCapture(m[1])

  // Already-normalized short UI fragments from splitter ("interfaccia minimale")
  if (
    /^(?:(?:interface|interfaccia|ui)\s+\S+|animazioni\s+\S+|animations?\s+\S+)$/i.test(t) &&
    /\b(?:minimal|minimale|smooth|fluide|fluido|flashy|semplice|simple|fluid)\b/i.test(t) &&
    !/\b(?:should|devono|deve|must|feel|essere|sentirsi)\b/i.test(t)
  ) {
    return t.replace(/^(?:un['\u2019]?|una\s+|un\s+|the\s+|a\s+|an\s+)/i, '').trim()
  }

  // "animations should feel smooth" / "le animazioni devono essere fluide"
  m =
    t.match(
      /^(?:(?:the\s+)?animations?|le\s+animazioni)\s+(?:should\s+feel|should\s+be|must\s+be|devono\s+(?:essere|sentirsi)|devono\s+essere)\s+(.+)$/i,
    ) ||
    t.match(
      /^(?:make\s+(?:the\s+)?interface|rendi\s+(?:l['']?interfaccia|l’interfaccia))\s+(.+)$/i,
    ) ||
    t.match(/^(?:keep\s+(?:the\s+)?(?:ui|interface)\s+)(.+)$/i) ||
    t.match(
      /^(?:l['']?interfaccia|l’interfaccia)\s+(?:deve\s+(?:essere|sentirsi)|should\s+be)\s+(.+)$/i,
    )
  if (m?.[1]) {
    const rest = cleanCapture(m[1])
    if (
      /^smooth\s+rather\s+than\s+flashy/i.test(rest) ||
      /\b(?:fluide|smooth|minimal|minimale|semplice|simple|flashy)\b/i.test(rest)
    ) {
      // Preserve subject for animation clauses
      if (/animazion|animation/i.test(t)) {
        return `smooth animations`.replace(
          /^smooth animations$/,
          /fluide/i.test(rest) || /smooth/i.test(rest)
            ? 'smooth animations'
            : `${rest} animations`,
        )
      }
      return rest
    }
    if (/\b(?:smooth|fluide|minimal|semplice|simple|flashy)\b/i.test(rest)) {
      if (/animazion|animation/i.test(t)) return 'smooth animations'
      return rest
    }
  }

  return null
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
  const userOriginal = String(inner || '').trim()
  if (!userOriginal) return []
  if (containsUnsafeMemoryMaterial(userOriginal)) return []
  if (isEphemeralNoise(userOriginal, { explicitIntent })) return []

  // Same-turn correction: safety on original; extraction may use rewritten clause.
  const correction = resolveSameTurnCorrection(userOriginal)
  const skipCofavoriteCorrection = correction.mode === 'skip_cofavorite_correction'
  const user =
    correction.mode === 'rewrite' && correction.text
      ? String(correction.text).trim()
      : userOriginal
  if (!user) return []

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
        { userMessage: userOriginal },
      )
    facts.push(
      decision(category, title, cleaned, importance, {
        ...factMeta,
        factKey,
      }),
    )
  }

  // —— Identità (first-person name only) ——
  // Order: skip guards → structured revoke → positive assert.
  // Never let "Non mi chiamo più X" fall through to positive capture of "più".
  // Guards always use the ORIGINAL utterance (#258).
  const skipIdentityName = shouldSkipIdentityNameMutation(userOriginal)
  let identityNameRevokeMatched = false
  if (!skipIdentityName && correction.mode !== 'rewrite') {
    const nameRevoke = extractIdentityNameRevokeCandidate(userOriginal)
    if (nameRevoke?.value) {
      const item = decision(
        'identity',
        'Revoke name',
        `Revoke identity name: ${nameRevoke.value}.`,
        9,
        {
          ...factMeta,
          factKey: 'identity.name',
        },
      )
      facts.push({
        ...item,
        operation: 'revoke',
        targetType: 'name',
        value: nameRevoke.value,
      })
      identityNameRevokeMatched = true
    }
  }

  if (!skipIdentityName && !identityNameRevokeMatched) {
    const namePatterns = [
      // Negative lookbehind: do not treat "non mi chiamo …" as a positive assert.
      /(?<!\bnon\s)(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè])\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'-]{1,40})/i,
      // Exclude "my name is no longer …" (handled by revoke).
      /(?:my\s+name\s+is(?!\s+no\s+longer)\s+|i(?:'m|\s+am)\s+called\s+)([A-Za-z][\w'-]{1,40})/i,
    ]
    for (const pattern of namePatterns) {
      const match = user.match(pattern)
      const name = match?.[1]?.trim()
      if (
        name &&
        !isRejectedIdentityNameToken(name) &&
        !/^(un|una|il|la|lo|gli|le|a|an|the|not|non|di|da)$/i.test(name)
      ) {
        push('identity', 'Name', `User's name is ${name}.`, 9, { factKey: 'identity.name' })
        break
      }
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
  // Guards on ORIGINAL; extraction on (possibly rewritten) user.
  const skipPolarity = shouldSkipPreferencePolarityExtraction(userOriginal)

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
  // —— #280 reply-style canonicalization + scoped preferences ——
  const leadingScope = extractLeadingEntityScope(user)
  let replyStyleMatched = false
  let scopedPreferenceMatched = false

  // Unconditional / conditioned reply-style (prefer / keep answers brief / risposte brevi)
  {
    const replySource = leadingScope.remainder || user
    // Leading "When/Quando … preferisco …"
    const leadingWhen = user.match(
      /^(?:quando|when)\s+(.+?)\s+(?:preferisco|i\s+prefer|i\s+like)\s+(.+)$/i,
    )
    let forcedCondition = null
    let forcedBody = null
    /** @type {string | null} */
    let whenProjectScope = null
    /** @type {string | null} */
    let whenContextScope = null
    if (leadingWhen?.[1] && leadingWhen?.[2]) {
      const parsedWhen = parseReplyStyleWhenCondition(
        cleanCapture(leadingWhen[1]).replace(/^facciamo\s+/i, ''),
      )
      forcedCondition = parsedWhen.condition
      whenProjectScope = parsedWhen.projectScope
      whenContextScope = parsedWhen.contextScope
      forcedBody = cleanCapture(leadingWhen[2])
    }
    const brevity =
      classifyReplyBrevity(forcedBody || '') ||
      classifyReplyBrevity(replySource) ||
      classifyReplyBrevity(user)
    const keepBrief =
      /\b(?:keep\s+answers\s+brief|keep\s+replies\s+(?:brief|short|concise)|risposte\s+brevi|risposte\s+concis)/i.test(
        user,
      ) ||
      /\b(?:keep\s+answers\s+brief|keep\s+replies\s+(?:brief|short|concise))\b/i.test(
        replySource,
      ) ||
      (forcedBody
        ? /\b(?:risposte\s+brevi|risposte\s+concis|short\s+answers|concise\s+replies)\b/i.test(
            forcedBody,
          )
        : false)
    // #325A: only persist reply_style when standing preference language is present.
    // Transient cues ("Ora spiegalo dettagliatamente") stay in Conversation State.
    const mayPersistReplyStyle =
      hasDurableReplyStylePreferenceLanguage(userOriginal) ||
      hasDurableReplyStylePreferenceLanguage(user) ||
      hasDurableReplyStylePreferenceLanguage(forcedBody || '') ||
      hasDurableReplyStylePreferenceLanguage(replySource)
    if ((brevity || keepBrief) && mayPersistReplyStyle) {
      const style = brevity || 'concise'
      const likeForCond = extractLikePreferenceValue(replySource) || extractLikePreferenceValue(user)
      const condFromLike = likeForCond ? splitPreferenceCondition(likeForCond).condition : null
      const condFromUtterance = splitPreferenceCondition(replySource).condition
      const condition = forcedCondition || condFromLike || condFromUtterance
      let scope =
        whenProjectScope ||
        whenContextScope ||
        (leadingScope.scopeKind === 'project'
          ? leadingScope.scope
          : leadingScope.scopeKind === 'this_project'
            ? 'this_project'
            : null)
      // Rich content-style under a named scope (energetic / flashy / …) must not
      // collapse into global settings.reply_style — keep scoped key + gloss.
      const styleTokenMatch =
        scope &&
        (replySource + ' ' + user).match(
          /\b(energetic|energico|energica|flashy|minimal|minimale|smooth|fluide|fluido)\b/i,
        )
      const styleToken = styleTokenMatch?.[1]
        ? extractContentStyleToken(styleTokenMatch[1])
        : null
      if (styleToken && scope) {
        const factKey = buildReplyStyleFactKey(styleToken, condition, scope)
        const glossExtra = cleanCapture(
          (replySource.match(
            new RegExp(`${styleTokenMatch[1]}(?:\\s+\\w+){0,3}`, 'i'),
          ) || [])[0] || styleToken,
        )
        const content = `For ${scope}: user prefers ${glossExtra}.`
        push('settings', 'Reply preference', content, 8, { factKey })
        replyStyleMatched = true
        preferenceMatched = true
      } else {
        const factKey = buildReplyStyleFactKey(style, condition, scope)
        const content = formatReplyStyleContent(style, condition, scope)
        push('settings', 'Reply preference', content, 8, { factKey })
        replyStyleMatched = true
        preferenceMatched = true
      }
    } else if (leadingScope.scopeKind === 'project' && leadingScope.scope) {
      // Scoped content style without brevity (energetic posts, …)
      // Never treat UI/interface wants or negated preferences as reply_style.
      const styleToken = extractContentStyleToken(replySource)
      if (
        styleToken &&
        !/\b(?:interfaccia|interface|ui|animazion|don['\u2019]?t\s+want|do\s+not\s+want|non\s+voglio|anymore|pi[uù])\b/i.test(
          replySource + ' ' + user,
        ) &&
        /\b(?:stile|style|tono|tone|content|posts?|copy|preferisco|prefer|like|want|voglio)\b/i.test(
          replySource + ' ' + user,
        )
      ) {
        const factKey = buildReplyStyleFactKey(styleToken, null, leadingScope.scope)
        const content = `For ${leadingScope.scope}: user prefers ${styleToken} style.`
        push('settings', 'Reply preference', content, 8, { factKey })
        replyStyleMatched = true
        preferenceMatched = true
      }
    }
  }

  // Scoped durable constraints: "For LAIfe, never change api/chat.ts unless necessary."
  const scopedConstraint = extractScopedDurableConstraint(userOriginal)
  if (scopedConstraint?.constraint) {
    const scopeLabel =
      scopedConstraint.scope && scopedConstraint.scope !== 'this_project'
        ? scopedConstraint.scope
        : scopedConstraint.scope === 'this_project'
          ? 'this project'
          : null
    const content = scopeLabel
      ? `For ${scopeLabel}: ${scopedConstraint.constraint}.`
      : `${scopedConstraint.constraint}.`
    const scopeSlug = scopedConstraint.scope
      ? slugifyFactKeyPart(scopedConstraint.scope)
      : 'general'
    push('settings', 'Project constraint', content, 8, {
      factKey: `projects.${scopeSlug}.constraint.${slugifyFactKeyPart(scopedConstraint.constraint)}`,
    })
  }

  // Scoped multi-clause UI preferences (high-confidence only)
  if (leadingScope.scopeKind === 'project' && leadingScope.scope) {
    const clauses = splitHighConfidencePreferenceClauses(leadingScope.remainder)
    const clauseList = clauses.length >= 2 ? clauses : [leadingScope.remainder]
    /** @type {string[]} */
    const expanded = []
    for (const clause of clauseList) {
      // "un'interfaccia minimale e animazioni fluide"
      const iface = clause.match(
        /interfaccia\s+([^,.!?\n]{3,60}?)(?:\s+(?:e|and)\s+(animazioni\s+[^,.!?\n]{3,40}))?$/i,
      )
      if (iface?.[1]) {
        expanded.push(`interfaccia ${iface[1]}`)
        if (iface[2]) expanded.push(iface[2])
        continue
      }
      expanded.push(clause)
    }
    for (const clause of expanded) {
      if (classifyReplyBrevity(clause)) continue
      // Already stored as scoped reply_style (energetic / …)
      if (
        replyStyleMatched &&
        extractContentStyleToken(clause) &&
        !/\b(?:interfaccia|interface|ui|animazion)/i.test(clause)
      ) {
        continue
      }
      const body = extractScopedPreferenceBody(clause)
      if (!body || body.length < 3 || isMomentaryInterestObject(body)) continue
      const { body: prefBody, condition } = splitPreferenceCondition(body)
      const value = condition ? `${prefBody} when ${condition}` : prefBody
      if (!value || value.length < 3) continue
      const brevity = classifyReplyBrevity(value)
      if (brevity) {
        const factKey = buildReplyStyleFactKey(brevity, condition, leadingScope.scope)
        push(
          'settings',
          'Reply preference',
          formatReplyStyleContent(brevity, condition, leadingScope.scope),
          8,
          { factKey },
        )
        replyStyleMatched = true
        continue
      }
      // Content style under project → reply_style key (never settings.reply_style)
      const contentStyle = extractContentStyleToken(value)
      if (
        contentStyle &&
        /\b(?:stile|style|tono|tone)\b/i.test(value) &&
        !/\b(?:interfaccia|interface|ui|animazion)/i.test(value)
      ) {
        const factKey = buildReplyStyleFactKey(contentStyle, condition, leadingScope.scope)
        push(
          'settings',
          'Reply preference',
          `For ${leadingScope.scope}: user prefers ${contentStyle} style.`,
          8,
          { factKey },
        )
        replyStyleMatched = true
        preferenceMatched = true
        continue
      }
      const cleanedValue = cleanCapture(value)
        .replace(/^(?:un['\u2019]?|una\s+|uno\s+|un\s+|the\s+|a\s+|an\s+)/i, '')
        .trim()
      const content = `For ${leadingScope.scope}: user prefers ${cleanedValue}.`
      const factKey = `projects.${slugifyFactKeyPart(leadingScope.scope)}.preferences.${slugifyFactKeyPart(cleanedValue)}`
      push('preferences', 'Preference', content, 7, { factKey })
      scopedPreferenceMatched = true
      preferenceMatched = true
    }
  } else if (leadingScope.scopeKind === 'this_project' && leadingScope.remainder) {
    const want =
      leadingScope.remainder.match(/^(?:i\s+want|voglio|preferisco)\s+(.+)$/i) ||
      leadingScope.remainder.match(/^(?:use|usa)\s+(.+)$/i)
    if (want?.[1]) {
      const value = cleanCapture(want[1])
      if (value.length >= 3) {
        push(
          'preferences',
          'Preference',
          `For this project: user prefers ${value}.`,
          7,
          { factKey: `projects.this_project.preferences.${slugifyFactKeyPart(value)}` },
        )
        scopedPreferenceMatched = true
        preferenceMatched = true
      }
    }
  }

  if (!skipPolarity && !dislikeMatched && !replyStyleMatched) {
    const likeList = extractLikeListValues(user)
    if (likeList.length >= 2 && !scopedPreferenceMatched) {
      preferenceMatched = true
      for (const likeValue of likeList) {
        push('preferences', 'Preference', `User likes / prefers: ${likeValue}.`, 6, {
          factKey: `preferences.like.${slugifyFactKeyPart(likeValue)}`,
        })
      }
    } else {
      const likeValue = extractLikePreferenceValue(user)
      if (likeValue && likeValue.length >= 2 && !isMomentaryInterestObject(likeValue)) {
        const { body: likeBody, condition } = splitPreferenceCondition(likeValue)
        const brevity = classifyReplyBrevity(likeValue) || classifyReplyBrevity(likeBody)
        if (brevity) {
          const factKey = buildReplyStyleFactKey(brevity, condition, null)
          push(
            'settings',
            'Reply preference',
            formatReplyStyleContent(brevity, condition, null),
            8,
            { factKey },
          )
          replyStyleMatched = true
          preferenceMatched = true
        } else if (
          /\b(rispost[ea]|dettagliat|concis|brevi|lungh|emoji|tono|stile|markdown)\b/i.test(
            likeValue,
          )
        ) {
          const scope =
            leadingScope.scopeKind === 'project'
              ? leadingScope.scope
              : leadingScope.scopeKind === 'this_project'
                ? 'this_project'
                : null
          const contentStyle = extractContentStyleToken(likeValue)
          if (contentStyle && scope) {
            const factKey = buildReplyStyleFactKey(contentStyle, condition, scope)
            push(
              'settings',
              'Reply preference',
              `For ${scope}: user prefers ${contentStyle} style.`,
              8,
              { factKey },
            )
          } else {
            const style = /\b(dettagliat\w*|detailed|lungh)\b/i.test(likeValue)
              ? 'detailed'
              : 'concise'
            const factKey = buildReplyStyleFactKey(style, condition, scope)
            push(
              'settings',
              'Reply preference',
              scope
                ? `For ${scope}: user prefers: ${likeValue}.`
                : `User prefers: ${likeValue}.`,
              8,
              { factKey },
            )
          }
          replyStyleMatched = true
          preferenceMatched = true
        } else if (!scopedPreferenceMatched) {
          preferenceMatched = true
          const content =
            leadingScope.scopeKind === 'project' && leadingScope.scope
              ? `For ${leadingScope.scope}: user likes / prefers: ${likeValue}.`
              : `User likes / prefers: ${likeValue}.`
          const factKey =
            leadingScope.scopeKind === 'project' && leadingScope.scope
              ? `projects.${slugifyFactKeyPart(leadingScope.scope)}.preferences.${slugifyFactKeyPart(likeValue)}`
              : `preferences.like.${slugifyFactKeyPart(likeValue)}`
          push('preferences', 'Preference', content, 6, { factKey })
        }
      }
    }
  }

  // Durable imperative UI preference without "I prefer"
  if (
    !replyStyleMatched &&
    !scopedPreferenceMatched &&
    !isTemporaryInstructionCue(userOriginal) &&
    /\b(?:make\s+the\s+interface|rendi\s+l['']?interfaccia)\b/i.test(user) &&
    /\b(?:smooth|fluide|flashy|minimal|semplice)\b/i.test(user)
  ) {
    const m = user.match(
      /(?:make\s+the\s+interface|rendi\s+l['']?interfaccia)\s+([^,.!?\n]{3,90})/i,
    )
    if (m?.[1]) {
      const value = cleanCapture(m[1])
      push('preferences', 'Preference', `User likes / prefers: interface ${value}.`, 6, {
        factKey: `preferences.like.${slugifyFactKeyPart(`interface ${value}`)}`,
      })
      preferenceMatched = true
    }
  }

  // —— Favorites / co-favorites (TYPE A singular + TYPE B multi) ——
  // Order: revoke extract → interrogative/negation gate → partitive → plural → singular.
  // Partitive must run before singular so "One of my favorite characters is X"
  // cannot become preferences.favorite.characters.
  // Note: do not use \b after "è" — JS \w excludes accented letters.
  // Safety/skip on ORIGINAL; family extraction on `user` (may be correction rewrite).
  const favoriteIsQuestion = isFavoritePreferenceQuestion(userOriginal)
  const skipFavoriteRevoke = shouldSkipFavoriteRevocation(userOriginal)
  // Successor rewrite: do NOT emit revoke (assert-first / slot supersession).
  const suppressFavoriteRevoke = correction.kind === 'favorite_successor'
  let favoriteRevokeMatched = false
  if (!skipFavoriteRevoke && !suppressFavoriteRevoke && correction.mode !== 'rewrite') {
    for (const rev of extractFavoriteRevokeCandidates(userOriginal)) {
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
  if (
    !skipCofavoriteCorrection &&
    !favoriteIsQuestion &&
    !shouldSkipFavoriteSetReplacement(userOriginal) &&
    correction.mode !== 'rewrite'
  ) {
    const rep = extractCofavoriteReplaceSetCandidate(userOriginal)
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

  // When correction rewrite removed negation cues, allow positive favorite assert.
  const favoriteLanguageNegated =
    correction.mode === 'rewrite'
      ? false
      : favoriteRevokeMatched ||
        (/\bnon\s+(?:è|e)\s+/i.test(user) && /\b(?:preferit|favorite)/i.test(user)) ||
        (/\bis\s+not\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
        (/\bare\s+not\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
        (/\bnon\s+sono\b/i.test(user) && /\bpreferit/i.test(user)) ||
        (/\bno\s+longer\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
        (/\bisn'?t\b/i.test(user) && /\bfavorite\b/i.test(user)) ||
        (/\baren'?t\b/i.test(user) && /\bfavorite\b/i.test(user))

  let favoriteMatched = false
  let cofavoriteMatched = replaceSetMatched

  const pushCofavorite = (subjectRaw, valueRaw) => {
    const subjectKey = normalizeFavoriteSubjectKey(subjectRaw)
    const glossSubject =
      FAVORITE_SUBJECT_GLOSS[subjectKey] ||
      cleanCapture(subjectRaw).toLowerCase() ||
      subjectKey
    // Tight open-set filler strip (anche/also/anzi/actually) — not exhaustive replacement cues.
    const value = cleanFavoritePreferenceValue(
      String(valueRaw || '')
        .replace(/^(?:anche|also|anzi|actually)\s+/i, '')
        .replace(/\s+(?:anzi|actually)$/i, ''),
    )
    if (subjectKey.length < 2 || value.length < 2) return false
    if (/^(?:anzi|actually|ancora|still|again)$/i.test(value)) return false
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
      `User's favorite ${glossSubject}: ${value}.`,
      6,
      { factKey },
    )
    return true
  }

  const pushSingularFavorite = (subjectRaw, valueRaw) => {
    const subjectKey = normalizeFavoriteSubjectKey(subjectRaw)
    const glossSubject =
      FAVORITE_SUBJECT_GLOSS[subjectKey] ||
      cleanCapture(subjectRaw).toLowerCase() ||
      subjectKey
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
      `User's favorite ${glossSubject}: ${value}.`,
      6,
      { factKey: `preferences.favorite.${subjectKey}` },
    )
    return true
  }

  // Additive path: skip when replace_set matched, overflow blocked, set-replacement
  // guards (hedge/meta/third-party/question), or same-turn mixed ops.
  if (
    !skipCofavoriteCorrection &&
    !favoriteLanguageNegated &&
    !favoriteIsQuestion &&
    !replaceSetMatched &&
    !replaceSetOverflowBlocked &&
    !shouldSkipFavoriteSetReplacement(userOriginal) &&
    !hasIncompatibleMixedFavoriteOps(userOriginal)
  ) {
    // —— Additive favorite members (oltre a / anche / also / besides / add) ——
    // Prefer cofavorite so "anche viola" extends an existing set instead of
    // overwriting preferences.favorite.<subject> with filler-polluted values.
    if (!cofavoriteMatched) {
      for (const add of extractAdditiveFavoriteCandidates(userOriginal)) {
        if (pushCofavorite(add.subject, add.value)) {
          cofavoriteMatched = true
          preferenceMatched = true
        }
      }
    }

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
    // Accept preferito/preferiti/preferita/preferite when the verb is plural
    // (sono/are/includono). Real users often mismatch agreement:
    // "I miei colore preferito sono …"
    if (!cofavoriteMatched) {
      const pluralForward =
        user.match(
          /\bi\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oaie]+\s+(?:sono|includono)\s+([^.!?\n]{3,120})/i,
        ) ||
        user.match(
          /\btra\s+i\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oaie]+\s+(?:ci\s+sono|ho)\s+([^.!?\n]{3,120})/i,
        ) ||
        user.match(
          /\bmy\s+favorite\s+([A-Za-z][\w'-]{1,40})\s+are\s+([^.!?\n]{3,120})/i,
        )
      const pluralReversed =
        !pluralForward &&
        (user.match(
          /\b([^.!?\n]{3,120}?)\s+sono\s+i\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oaie]+\b/i,
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
        const cleanedList = String(listRaw)
          .replace(/,\s*(?:soprattutto|especially|in\s+particolare)\s+.+$/i, '')
          .trim()
        const values = splitFavoriteList(cleanedList || listRaw, { maxItems: 3 })
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
    // Optional temporal bridge (ora/adesso/now) — same single-valued correction family
    // as primary project ("il mio colore preferito ora è blu").
    if (!cofavoriteMatched) {
      const favoriteForward =
        user.match(
          /(?:(?:il|la)\s+mi[oa]\s+)([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s+(?:(?:ora|adesso|now)\s+)?[eè]\s+([^,.!?\n]{2,60})/i,
        ) ||
        user.match(
          /(?:my\s+favorite\s+)([A-Za-z][\w'-]{1,40})\s+(?:is(?:\s+now)?)\s+([^,.!?\n]{2,60})/i,
        )

      const favoriteReversed =
        !favoriteForward &&
        (user.match(
          /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,60}?)\s+[eè]\s+(?:ora\s+|adesso\s+|now\s+)?(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
        ) ||
          user.match(
            /\b([A-Za-z0-9][^,.!?\n]{0,60}?)\s+is\s+(?:now\s+)?my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
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
  } else if (
    // Correction rewrite / successor: singular favorite assert even when original
    // message had revoke/negation cues (clause-aware).
    correction.mode === 'rewrite' &&
    !favoriteIsQuestion &&
    !skipCofavoriteCorrection
  ) {
    const favoriteForward =
      user.match(
        /(?:(?:il|la)\s+mi[oa]\s+)([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\s+[eè]\s+([^,.!?\n]{2,60})/i,
      ) ||
      user.match(
        /(?:my\s+favorite\s+)([A-Za-z][\w'-]{1,40})\s+is\s+([^,.!?\n]{2,60})/i,
      )
    if (favoriteForward?.[1] && favoriteForward?.[2]) {
      if (pushSingularFavorite(favoriteForward[1], favoriteForward[2])) {
        favoriteMatched = true
        preferenceMatched = true
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

  // —— Interest revoke (before positive interest assert) ——
  const skipLifecycle = shouldSkipLifecycleMutation(userOriginal)
  let interestRevokeMatched = false
  if (!skipLifecycle && correction.mode !== 'rewrite') {
    const interestRevoke = extractInterestRevokeCandidate(userOriginal)
    if (interestRevoke?.value) {
      const item = decision(
        'preferences',
        'Revoke interest',
        `Revoke interest: ${interestRevoke.value}.`,
        7,
        { ...factMeta, factKey: interestRevoke.factKey },
      )
      facts.push({
        ...item,
        operation: 'revoke',
        targetType: 'interest',
        value: interestRevoke.value,
      })
      interestRevokeMatched = true
    }
  }

  // Strong durable interests (Adoro / Amo / appassionato / really into / mi interessa).
  // Skip when a structured favorite, cofavorite, or like already covered the turn.
  // Never assert when revoke matched or lifecycle safety skip (hedge/meta/…).
  if (
    !skipLifecycle &&
    !interestRevokeMatched &&
    !favoriteMatched &&
    !cofavoriteMatched &&
    !dislikeMatched
  ) {
    const interest =
      user.match(/(?:^|[.!?]\s*)(?<!\bnon\s)(?:adoro|amo)\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:sono\s+appassionat[oa]\s+di)\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:^|[.!?]\s*)(?<!\bnon\s)mi\s+interessa\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:sono\s+interessat[oa]\s+(?:a|di))\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:i(?:'m|\s+am)\s+interested\s+in)\s+([^,.!?\n]{2,60})/i) ||
      user.match(/(?:i(?:'m|\s+am)\s+really\s+into)\s+([^,.!?\n]{2,60})/i)
    if (interest?.[1]) {
      const value = normalizeLifecycleEntityValue(interest[1])
      const slug = lifecycleEntitySlug(value)
      if (value.length >= 2 && slug && !isMomentaryInterestObject(value) && !isLifecycleMalformedValue(value)) {
        const already =
          preferenceMatched &&
          facts.some(
            (f) =>
              f.category === 'preferences' &&
              normalizeText(f.content).includes(normalizeText(value).slice(0, 24)),
          )
        if (!already) {
          preferenceMatched = true
          push('preferences', 'Interest', `User is interested in: ${value}.`, 6, {
            factKey: `preferences.interest.${slug}`,
          })
        }
      }
    }
  }

  // —— Primary project revoke (before positive assert; suppress when successor present) ——
  let primaryRevokeMatched = false
  const primarySuccessorInTurn =
    !skipLifecycle && hasPositivePrimaryProjectAssert(userOriginal)
  if (!skipLifecycle && !primarySuccessorInTurn && correction.mode !== 'rewrite') {
    const primaryRevoke = extractPrimaryProjectRevokeCandidate(userOriginal)
    if (primaryRevoke?.value) {
      const item = decision(
        'projects',
        'Revoke primary project',
        `Revoke primary project: ${primaryRevoke.value}.`,
        8,
        { ...factMeta, factKey: 'projects.primary' },
      )
      facts.push({
        ...item,
        operation: 'revoke',
        targetType: 'primary_project',
        value: primaryRevoke.value,
      })
      primaryRevokeMatched = true
    }
  }

  // —— Primary project (explicit main/primary only; before generic projects) ——
  // Requires explicit primary/main language — never inferred from "sto lavorando su X".
  // Temporal bridges (ora/adesso/now) between slot noun and copula are allowed so
  // corrections like "In realtà il mio progetto principale ora è LAIfe" update
  // the same single-valued projects.primary slot.
  let projectMatched = false
  const primaryProjectPatterns = [
    // IT: Il mio progetto principale [ora/adesso] è / si chiama X
    /(?:(?:il|la)\s+mi[oa]\s+progetto\s+principale\s+(?:(?:ora|adesso|now)\s+)?(?:[eè]|si\s+chiama)\s+)(?!non\b)([^,.!?\n]{2,90})/i,
    // IT: Il progetto principale (su cui sto lavorando) [ora/adesso] è X
    /(?:il\s+progetto\s+principale(?:\s+su\s+cui\s+sto\s+lavorando)?\s+(?:(?:ora|adesso|now)\s+)?[eè]\s+)(?!non\b)([^,.!?\n]{2,90})/i,
    // IT: X è [ora/adesso] il mio progetto principale / X è il progetto principale…
    /^([A-Za-zÀ-ÖØ-öø-ÿ0-9][^,.!?\n]{0,80}?)\s+[eè]\s+(?:ora\s+|adesso\s+|now\s+)?(?:il\s+)?(?:mi[oa]\s+)?progetto\s+principale\b/i,
    // EN: My main/primary project is / is called / is now X  (not "is no longer")
    /(?:my\s+(?:main|primary)\s+project\s+(?:is(?:\s+called)?|is\s+now)\s+)(?!no\s+longer\b)([^,.!?\n]{2,90})/i,
    // EN: The main project I'm working on is [now] X
    /(?:the\s+main\s+project\s+i(?:'m|\s+am)\s+working\s+on\s+(?:is(?:\s+now)?)\s+)(?!no\s+longer\b)([^,.!?\n]{2,90})/i,
    // EN: X is [now] my main/primary project
    /^([A-Za-z0-9][^,.!?\n]{0,80}?)\s+is\s+(?:now\s+)?my\s+(?:main|primary)\s+project\b/i,
  ]
  if (!primaryRevokeMatched) {
    for (const pattern of primaryProjectPatterns) {
      const match = user.match(pattern)
      if (!match?.[1]) continue
      const value = normalizeLifecycleEntityValue(stripNamingVerbPrefix(match[1]))
      // Reject only bare deixis/articles as the entire value — keep phrases like
      // "il mio nuovo sito" / "un'app per gestire il fotovoltaico".
      if (
        value.length < 2 ||
        /^(questo|quello|this|that|it|il|la|lo|un|una|a|an|the)$/i.test(value)
      ) {
        continue
      }
      // P0: never assert lifecycle / "no longer" captures as the project name.
      if (isLifecycleMalformedValue(value)) continue
      if (/\bno\s+longer\b/i.test(value) || /\bnon\s+pi[uù]\b/i.test(value)) continue
      // Reject bare activity verbs mistaken as project names
      if (/^(sto|stiamo|working|allen|studi|impar|perdere|cercando)\b/i.test(value)) continue
      // Whole-message revoke forms must not also positive-assert.
      if (
        extractPrimaryProjectRevokeCandidate(userOriginal) &&
        !hasPositivePrimaryProjectAssert(userOriginal)
      ) {
        continue
      }
      projectMatched = true
      push('projects', 'Primary project', `User's primary project: ${value}.`, 8, {
        factKey: 'projects.primary',
      })
      break
    }
  }

  // —— #280 project rename / alias correction (before generic naming) ——
  const renamePair = extractProjectRenameCorrection(userOriginal)
  if (renamePair?.oldName && renamePair?.newName) {
    const oldName = renamePair.oldName
    const newName = renamePair.newName
    if (
      oldName.length >= 2 &&
      newName.length >= 2 &&
      normalizeText(oldName) !== normalizeText(newName)
    ) {
      // Soft-obsolete old primary when it matches the named predecessor.
      const revokeItem = decision(
        'projects',
        'Revoke primary project',
        `Revoke primary project: ${oldName}.`,
        8,
        { ...factMeta, factKey: 'projects.primary' },
      )
      facts.push({
        ...revokeItem,
        operation: 'revoke',
        targetType: 'primary_project',
        value: oldName,
      })
      // Also obsolete value-scoped projects.<old> rows.
      const aliasRevoke = decision(
        'projects',
        'Revoke project name',
        `Revoke project name: ${oldName}.`,
        8,
        { ...factMeta, factKey: `projects.${slugifyFactKeyPart(oldName)}` },
      )
      facts.push({
        ...aliasRevoke,
        operation: 'revoke',
        targetType: 'project_name',
        value: oldName,
      })
      // Assert new name as primary — explicit rename of "the project".
      projectMatched = true
      push('projects', 'Primary project', `User's primary project: ${normalizeLifecycleEntityValue(newName)}.`, 8, {
        factKey: 'projects.primary',
      })
      push('projects', 'Project', `User's project: ${normalizeLifecycleEntityValue(newName)}.`, 7, {
        factKey: `projects.${slugifyFactKeyPart(normalizeLifecycleEntityValue(newName) || newName)}`,
      })
    }
  }

  // —— #280 clean project / shop / AI naming ——
  if (!projectMatched) {
    for (const named of extractProjectNamingCandidates(user)) {
      projectMatched = true
      push('projects', named.title, named.content, named.importance, {
        factKey: named.factKey,
      })
    }
  }

  // —— #282 shop ↔ platform associations ——
  for (const shop of extractShopPlatformCandidates(userOriginal)) {
    projectMatched = true
    push('projects', 'Shop', shop.content, 7, { factKey: shop.factKey })
  }

  // —— #282 project ↔ tool associations (+ corrections) ——
  let projectToolMatched = false
  const toolCorrection = extractProjectToolCorrection(userOriginal)
  if (toolCorrection?.newFactKey) {
    if (toolCorrection.oldFactKey) {
      const revokeItem = decision(
        'projects',
        'Revoke project tool',
        `Revoke ${toolCorrection.project} tool: ${toolCorrection.oldTool}.`,
        7,
        { ...factMeta, factKey: toolCorrection.oldFactKey },
      )
      facts.push({
        ...revokeItem,
        operation: 'revoke',
        targetType: 'project_scoped_key',
        value: toolCorrection.oldTool,
      })
    }
    push('projects', 'Project tool', toolCorrection.newContent, 7, {
      factKey: toolCorrection.newFactKey,
    })
    projectToolMatched = true
    projectMatched = true
  } else {
    for (const tool of extractProjectToolCandidates(userOriginal)) {
      push('projects', 'Project tool', tool.content, 7, { factKey: tool.factKey })
      projectToolMatched = true
      projectMatched = true
    }
  }

  // —— #282 project future features (+ revoke) ——
  const futureRevoke = extractProjectFutureFeatureRevoke(userOriginal)
  if (futureRevoke?.factKey) {
    const revokeItem = decision(
      'projects',
      'Revoke future feature',
      `Revoke ${futureRevoke.project} future feature: ${futureRevoke.feature}.`,
      7,
      { ...factMeta, factKey: futureRevoke.factKey },
    )
    facts.push({
      ...revokeItem,
      operation: 'revoke',
      targetType: 'project_scoped_key',
      value: futureRevoke.feature,
    })
  } else {
    for (const feat of extractProjectFutureFeatureCandidates(userOriginal)) {
      push('projects', 'Future feature', feat.content, 7, { factKey: feat.factKey })
      projectMatched = true
    }
  }

  // —— #282 scoped UI preference revoke (flashy animations, …) ——
  const prefRevoke = extractProjectPreferenceRevoke(userOriginal)
  if (prefRevoke?.factKey) {
    const revokeItem = decision(
      'preferences',
      'Revoke preference',
      `Revoke ${prefRevoke.project} preference: ${prefRevoke.preference}.`,
      7,
      { ...factMeta, factKey: prefRevoke.factKey },
    )
    facts.push({
      ...revokeItem,
      operation: 'revoke',
      targetType: 'project_scoped_key',
      value: prefRevoke.preference,
    })
    scopedPreferenceMatched = true
  }

  // —— #282 UI feel without leading "For X," but with project name in sentence ——
  // Prefer scoped preference path; never treat interface wants as future features.
  if (!scopedPreferenceMatched) {
    const uiProj =
      userOriginal.match(
        /\bper\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’&.-]{1,40})\s+voglio\s+(?:un['']?|una\s+|un\s+)?interfaccia\s+([^,.!?\n]{3,80})/i,
      ) ||
      userOriginal.match(
        /\b([A-Za-z0-9][\w'’.&-]{1,40})\s+should\s+feel\s+([^,.!?\n]{3,80})/i,
      ) ||
      userOriginal.match(
        /\b(?:i\s+want\s+the\s+interface\s+(?:to\s+feel\s+|)?|voglio\s+(?:un['']?interfaccia|l['']interfaccia)\s+)([^,.!?\n]{3,80})/i,
      )
    if (uiProj) {
      let project = ''
      let rawPref = ''
      if (uiProj.length >= 3 && uiProj[2]) {
        project = cleanCapture(uiProj[1])
        rawPref = cleanCapture(uiProj[2])
      } else if (uiProj[1]) {
        // Interface-only clause: try to recover project from same message.
        rawPref = cleanCapture(uiProj[1])
        const named = extractProjectNamingCandidates(userOriginal)[0]
        project = named?.name || ''
      }
      if (project && rawPref) {
        const parts = rawPref
          .split(/\s+(?:e|and|,)\s+/i)
          .map((p) => cleanCapture(p))
          .filter((p) => p.length >= 2)
        // Keep "smooth and minimal" as one UI feel when both are short adjectives.
        const list =
          parts.length === 2 &&
          parts.every((p) => /^(?:smooth|minimal|minimale|fluide|fluido|flashy)$/i.test(p))
            ? [`${parts[0]} and ${parts[1]}`]
            : parts.length >= 2
              ? parts
              : [rawPref]
        for (const part of list) {
          let value = part
            .replace(/^(?:un['']?|una\s+|un\s+|the\s+|a\s+|an\s+)/i, '')
            .replace(/\s*,\s*non\s+.+$/i, '')
            .replace(/\s+not\s+.+$/i, '')
            .trim()
          // "minimale e animazioni fluide" without regex split
          if (/\banimazioni\b|\banimations\b/i.test(value) && /\be\b|\band\b/i.test(value)) {
            const splitAnim = value.split(/\s+(?:e|and)\s+/i)
            for (const piece of splitAnim) {
              const v = cleanCapture(piece)
              if (v.length < 3) continue
              push(
                'preferences',
                'Preference',
                `For ${project}: user prefers ${v}.`,
                7,
                {
                  factKey: `projects.${slugifyFactKeyPart(project)}.preferences.${slugifyFactKeyPart(v)}`,
                },
              )
              scopedPreferenceMatched = true
              preferenceMatched = true
            }
            continue
          }
          if (value.length < 3) continue
          push(
            'preferences',
            'Preference',
            `For ${project}: user prefers ${value}.`,
            7,
            {
              factKey: `projects.${slugifyFactKeyPart(project)}.preferences.${slugifyFactKeyPart(value)}`,
            },
          )
          scopedPreferenceMatched = true
          preferenceMatched = true
        }
      }
    }
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
    const value = stripNamingVerbPrefix(project[1])
    // Guard: "principalmente con Cursor" is a tool phrase, not a project name.
    if (
      value.length >= 2 &&
      !/^(questo|quello|this|that|it)\b/i.test(value) &&
      !/\b(?:con|with)\s+/i.test(value) &&
      !/^(?:principalmente|mainly|especially)\b/i.test(value)
    ) {
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

  // —— Profession revoke (before positive assert) ——
  let professionRevokeMatched = false
  if (!skipLifecycle && correction.mode !== 'rewrite') {
    const professionRevoke = extractProfessionRevokeCandidate(userOriginal)
    if (professionRevoke?.value) {
      const item = decision(
        'skills',
        'Revoke profession',
        `Revoke profession: ${professionRevoke.value}.`,
        8,
        { ...factMeta, factKey: 'skills.profession' },
      )
      facts.push({
        ...item,
        operation: 'revoke',
        targetType: 'profession',
        value: professionRevoke.value,
      })
      professionRevokeMatched = true
    }
  }

  // —— Competenze (studio / lavoro / stack) ——
  // Positive profession: never after revoke / negation / "no longer" captures.
  if (!professionRevokeMatched && !skipLifecycle) {
    const profession =
      user.match(
        /(?<!\bnon\s)(?:lavoro\s+come|faccio\s+il|faccio\s+la|sono\s+(?:un|una)\s+)([^,.!?\n]{2,70})/i,
      ) ||
      user.match(
        /(?:(?<!don'?t\s)(?<!do\s+not\s)i\s+work\s+as|my\s+job\s+is(?!\s+no\s+longer)|i(?:'m|\s+am)\s+a(?:n)?\s+)(?!no\s+longer\b)([^,.!?\n]{2,70})/i,
      )
    if (profession?.[1]) {
      const value = normalizeLifecycleEntityValue(profession[1])
      if (
        value &&
        !isLifecycleMalformedValue(value) &&
        !/\bno\s+longer\b/i.test(value) &&
        (!/^(persona|uomo|donna|guy|person|student|studente)\b/i.test(value) || /stud/i.test(value))
      ) {
        // Belt: message-level negation of profession must not assert.
        if (
          !/\bnon\s+(?:sono|faccio|lavoro)\b/i.test(userOriginal) &&
          !/\b(?:no\s+longer|don'?t\s+work\s+as|do\s+not\s+work\s+as)\b/i.test(userOriginal)
        ) {
          push('skills', 'Profession', `User's profession / role: ${value}.`, 8, {
            factKey: 'skills.profession',
          })
        }
      }
    }
  }

  // Studies: positive only. P0 guard — never capture "Non studio più X" as studies.
  const studiesNegated =
    /\bnon\s+(?:studio|sto\s+studiando)\b/i.test(userOriginal) ||
    /\bi\s+(?:don'?t|do\s+not)\s+study\b/i.test(userOriginal) ||
    /\bi(?:'m|\s+am)\s+no\s+longer\s+studying\b/i.test(userOriginal) ||
    /\bi\s+no\s+longer\s+study\b/i.test(userOriginal)
  const study =
    !studiesNegated &&
    !replyStyleMatched &&
    (user.match(/(?<!\bnon\s)(?:studio|sto\s+studiando)\s+([^,.!?\n]{2,70})/i) ||
      user.match(/(?:i\s+study|i(?:'m|\s+am)\s+studying)\s+([^,.!?\n]{2,70})/i))
  if (study?.[1] && !learningMatched) {
    // "Quando studio preferisco…" is reply-style, not a study subject.
    if (!/^(?:preferisco|i\s+prefer|spiegazioni|detailed|concise)/i.test(cleanCapture(study[1]))) {
      const studyValue = cleanCapture(study[1])
      if (studyValue && !isLifecycleMalformedValue(studyValue) && !/^pi[uù]\b/i.test(studyValue)) {
        push('skills', 'Studies', `User studies: ${studyValue}.`, 7)
      }
    }
  }

  // —— Abitudini / strumenti ——
  // Note: "lavoro su" / "working on" intentionally omitted — those are projects.
  // #282: when an explicit project↔tool association matched, do not also write habits.tools.*.
  const uses =
    !projectToolMatched &&
    (user.match(/(?:uso|utilizzo|lavoro\s+con)\s+([^,.!?\n]{2,70})/i) ||
      user.match(/(?:i\s+use|i(?:'m|\s+am)\s+using|i\s+work\s+with)\s+([^,.!?\n]{2,70})/i))
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

  if (
    !replyStyleMatched &&
    hasDurableReplyStylePreferenceLanguage(userOriginal) &&
    /\b(risposte\s+dettagliat|risposte\s+concis|risposte\s+brevi|detailed\s+replies|concise\s+replies)\b/i.test(
      user,
    )
  ) {
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
        `[brain-memory] zero-row obsolete update for ${row.id} (fact_key_omitted)`,
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
 * Apply a structured identity.name revoke item.
 * Exact normalized value match against active owner-scoped identity.name rows only.
 * Wrong stated name → no-op (current name stays active). Never upserts a replacement.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {{ operation?: string, targetType?: string, category?: string, value?: string, factKey?: string | null }} item
 * @returns {Promise<{ action: 'revoked' | 'not_found' | 'skipped', obsoletedIds: string[], factKey: string | null }>}
 */
export async function applyIdentityNameRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  const targetType = String(item?.targetType || '').toLowerCase()
  const category = String(item?.category || '').toLowerCase()
  const factKey =
    typeof item?.factKey === 'string' && item.factKey.trim()
      ? item.factKey.trim()
      : 'identity.name'
  if (factKey !== 'identity.name') {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }
  if (targetType && targetType !== 'name') {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }
  if (category && category !== 'identity') {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const stated = cleanCapture(item?.value || '')
  const statedNorm = normalizeIdentityNameForMatch(stated)
  if (!stated || !statedNorm || isRejectedIdentityNameToken(stated)) {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const listed = await listActiveRowsForFactKey(supabase, uid, 'identity.name', 'identity')
  if (listed.error) {
    console.warn(
      `[brain-memory] identity name revoke lookup failed:`,
      String(listed.error).slice(0, 180),
    )
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const matches = (listed.rows || []).filter((row) => {
    const stored = identityNameValueFromContent(row.content || row.Content || '')
    if (!stored) return false
    return normalizeIdentityNameForMatch(stored) === statedNorm
  })

  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }

  matches.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (matches.length > 1) {
    console.warn(
      `[brain-memory] identity name revoke: ${matches.length} exact active matches; obsoleting all`,
    )
  }

  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `identity_name_revoke:${statedNorm}`,
  )
  return {
    action: (result.obsoletedIds || []).length > 0 ? 'revoked' : 'not_found',
    obsoletedIds: result.obsoletedIds || [],
    factKey,
  }
}

/**
 * Apply structured preferences.interest.* revoke (exact fact_key; obsolete all duplicates).
 * Legacy article-variant keys are NOT fuzzy-matched — leave active if slug differs.
 * @param {any} supabase
 * @param {string} userId
 * @param {any} item
 */
export async function applyInterestRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.targetType || '').toLowerCase() !== 'interest') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  const value = normalizeLifecycleEntityValue(item?.value || '')
  const slug = lifecycleEntitySlug(value)
  const factKey =
    typeof item?.factKey === 'string' && item.factKey.trim()
      ? item.factKey.trim()
      : slug
        ? `preferences.interest.${slug}`
        : null
  if (!factKey || !slug || !/^preferences\.interest\./i.test(factKey)) {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const listed = await listActiveRowsForFactKey(supabase, uid, factKey, 'preferences')
  if (listed.error) {
    console.warn(
      `[brain-memory] interest revoke lookup failed for ${factKey}:`,
      String(listed.error).slice(0, 180),
    )
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  // Exact key already value-scoped; belt-check content slug when recoverable.
  const matches = (listed.rows || []).filter((row) => {
    const stored = interestValueFromContent(row.content || row.Content || '')
    if (!stored) return true
    return lifecycleEntitySlug(stored) === slug
  })

  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }

  matches.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (matches.length > 1) {
    console.warn(
      `[brain-memory] interest revoke: ${matches.length} exact active matches for ${factKey}; obsoleting all`,
    )
  }

  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `interest_revoke:${factKey}`,
  )
  return {
    action: (result.obsoletedIds || []).length > 0 ? 'revoked' : 'not_found',
    obsoletedIds: result.obsoletedIds || [],
    factKey,
  }
}

/**
 * Apply value-gated skills.profession revoke.
 * @param {any} supabase
 * @param {string} userId
 * @param {any} item
 */
export async function applyProfessionRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.targetType || '').toLowerCase() !== 'profession') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  const factKey = 'skills.profession'
  const stated = normalizeLifecycleEntityValue(item?.value || '')
  const statedSlug = lifecycleEntitySlug(stated)
  if (!stated || !statedSlug) {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const listed = await listActiveRowsForFactKey(supabase, uid, factKey, 'skills')
  if (listed.error) {
    console.warn(
      `[brain-memory] profession revoke lookup failed:`,
      String(listed.error).slice(0, 180),
    )
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const matches = (listed.rows || []).filter((row) => {
    const stored = professionValueFromContent(row.content || row.Content || '')
    if (!stored) return false
    return lifecycleEntitySlug(stored) === statedSlug
  })

  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }

  matches.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (matches.length > 1) {
    console.warn(
      `[brain-memory] profession revoke: ${matches.length} exact active matches; obsoleting all`,
    )
  }

  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `profession_revoke:${statedSlug}`,
  )
  return {
    action: (result.obsoletedIds || []).length > 0 ? 'revoked' : 'not_found',
    obsoletedIds: result.obsoletedIds || [],
    factKey,
  }
}

/**
 * Apply value-gated projects.primary revoke.
 * @param {any} supabase
 * @param {string} userId
 * @param {any} item
 */
export async function applyPrimaryProjectRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.targetType || '').toLowerCase() !== 'primary_project') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  const factKey = 'projects.primary'
  const stated = normalizeLifecycleEntityValue(item?.value || '')
  const statedSlug = lifecycleEntitySlug(stated)
  if (!stated || !statedSlug) {
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const listed = await listActiveRowsForFactKey(supabase, uid, factKey, 'projects')
  if (listed.error) {
    console.warn(
      `[brain-memory] primary project revoke lookup failed:`,
      String(listed.error).slice(0, 180),
    )
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const matches = (listed.rows || []).filter((row) => {
    const stored = primaryProjectValueFromContent(row.content || row.Content || '')
    if (!stored) return false
    return lifecycleEntitySlug(stored) === statedSlug
  })

  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }

  matches.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (matches.length > 1) {
    console.warn(
      `[brain-memory] primary project revoke: ${matches.length} exact active matches; obsoleting all`,
    )
  }

  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `primary_project_revoke:${statedSlug}`,
  )
  return {
    action: (result.obsoletedIds || []).length > 0 ? 'revoked' : 'not_found',
    obsoletedIds: result.obsoletedIds || [],
    factKey,
  }
}

/**
 * Soft-obsolete a value-scoped projects.<slug> name row (rename alias cleanup).
 * Does not touch unrelated project preference/constraint facts.
 * @param {any} supabase
 * @param {string} userId
 * @param {any} item
 */
export async function applyProjectNameRevocation(supabase, userId, item) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.operation || '').toLowerCase() !== 'revoke') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }
  if (String(item?.targetType || '').toLowerCase() !== 'project_name') {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  const stated = normalizeLifecycleEntityValue(item?.value || '')
  const statedSlug = lifecycleEntitySlug(stated) || slugifyFactKeyPart(stated)
  if (!stated || !statedSlug) {
    return { action: 'skipped', obsoletedIds: [], factKey: null }
  }

  const factKey =
    typeof item?.factKey === 'string' && item.factKey.trim()
      ? item.factKey.trim()
      : `projects.${statedSlug}`

  const listed = await listActiveRowsForFactKey(supabase, uid, factKey, 'projects')
  if (listed.error) {
    console.warn(
      `[brain-memory] project name revoke lookup failed:`,
      String(listed.error).slice(0, 180),
    )
    return { action: 'skipped', obsoletedIds: [], factKey }
  }

  const matches = (listed.rows || []).filter((row) => {
    const key = readFactKeyFromTags(row.tags || row.Tags || [])
    if (key === factKey) return true
    const content = String(row.content || row.Content || '')
    const named = content.match(/project:\s*(.+?)\.?$/i)
    if (!named?.[1]) return false
    return lifecycleEntitySlug(named[1]) === statedSlug
  })

  if (matches.length === 0) {
    return { action: 'not_found', obsoletedIds: [], factKey }
  }

  const result = await markMemoriesObsolete(
    supabase,
    uid,
    matches,
    `project_name_revoke:${statedSlug}`,
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
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) {
    return { action: 'skipped', obsoletedIds: [], error: 'userId required' }
  }
  if (String(item?.operation || '').toLowerCase() !== 'replace_set') {
    return { action: 'skipped', obsoletedIds: [] }
  }
  if (shouldSkipFavoriteSetReplacement(item.userMessage || '')) {
    return { action: 'skipped', obsoletedIds: [] }
  }

  const subject = normalizeFavoriteSubjectKey(item.subject || '')
  const rawValues = Array.isArray(item.values) ? item.values : []
  if (!subject || rawValues.length === 0) {
    return { action: 'skipped', obsoletedIds: [] }
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
  if (values.length === 0) {
    return { action: 'skipped', obsoletedIds: [] }
  }

  const incomingSet = new Set(incomingKeys)

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
      if (action === 'created' || action === 'updated' || action === 'skipped') {
        if (action === 'skipped' && !upserted?.memory) {
          return {
            action: 'failed_upsert',
            obsoletedIds: [],
            error: `upsert skipped without memory for ${factKey}`,
            incomingKeys,
          }
        }
      } else {
        return {
          action: 'failed_upsert',
          obsoletedIds: [],
          error: `unexpected upsert action ${action || 'empty'} for ${factKey}`,
          incomingKeys,
        }
      }
    } catch (error) {
      return {
        action: 'failed_upsert',
        obsoletedIds: [],
        error: error instanceof Error ? error.message : String(error),
        incomingKeys,
      }
    }
  }

  // —— Phase 2: obsolete absent subject peers (only after successful upserts) ——
  const listed = await listActiveCofavoritesForSubject(supabase, uid, subject)
  if (listed.error) {
    return {
      action: 'failed_list',
      obsoletedIds: [],
      error: listed.error,
      incomingKeys,
    }
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
      if (Array.isArray(result.failedIds) && result.failedIds.length > 0) {
        return {
          action: 'partial_obsolete',
          obsoletedIds,
          failedIds: result.failedIds,
          error: result.error || 'obsolete_failed',
          incomingKeys,
        }
      }
    } catch (error) {
      return {
        action: 'partial_obsolete',
        obsoletedIds,
        error: error instanceof Error ? error.message : String(error),
        incomingKeys,
      }
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

  return {
    action: 'replaced',
    obsoletedIds,
    incomingKeys,
    error: null,
  }
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
  const skipIdentityName = shouldSkipIdentityNameMutation(input.userMessage || '')
  const skipLifecycle = shouldSkipLifecycleMutation(input.userMessage || '')
  let guardedItems = filteredItems
  if (skipIdentityName) {
    guardedItems = guardedItems.filter((item) => {
      const key = String(item?.factKey || '')
      const op = String(item?.operation || '').toLowerCase()
      const isIdentityNameUpsert = key === 'identity.name' && op !== 'revoke'
      const isIdentityNameRevoke =
        op === 'revoke' &&
        (String(item?.targetType || '').toLowerCase() === 'name' ||
          key === 'identity.name' ||
          String(item?.category || '').toLowerCase() === 'identity')
      return !isIdentityNameUpsert && !isIdentityNameRevoke
    })
  }
  if (skipLifecycle) {
    guardedItems = guardedItems.filter((item) => {
      if (String(item?.operation || '').toLowerCase() !== 'revoke') return true
      const tt = String(item?.targetType || '').toLowerCase()
      return tt !== 'interest' && tt !== 'profession' && tt !== 'primary_project'
    })
  }
  if (skipFavoriteRevoke) {
    guardedItems = guardedItems.filter((item) => {
      if (String(item?.operation || '').toLowerCase() !== 'revoke') return true
      const tt = String(item?.targetType || '').toLowerCase()
      // Keep identity + lifecycle revokes; drop favorite/cofavorite only.
      if (
        tt === 'name' ||
        tt === 'interest' ||
        tt === 'profession' ||
        tt === 'primary_project' ||
        tt === 'project_name' ||
        tt === 'project_scoped_key' ||
        String(item?.factKey || '') === 'identity.name' ||
        String(item?.category || '').toLowerCase() === 'identity'
      ) {
        return true
      }
      return false
    })
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
    const targetType = String(item?.targetType || '').toLowerCase()
    const isIdentityNameRevoke =
      targetType === 'name' ||
      String(item?.factKey || '') === 'identity.name' ||
      String(item?.category || '').toLowerCase() === 'identity'

    if (isIdentityNameRevoke) {
      if (shouldSkipIdentityNameMutation(input.userMessage || '')) {
        skipped += 1
        continue
      }
      const result = await applyIdentityNameRevocation(controlSupabase, controlUserId, item)
      revokeResults.push(result)
      if (result.action === 'revoked') revoked += 1
      else skipped += 1
      continue
    }

    if (targetType === 'interest') {
      if (shouldSkipLifecycleMutation(input.userMessage || '')) {
        skipped += 1
        continue
      }
      const result = await applyInterestRevocation(controlSupabase, controlUserId, item)
      revokeResults.push(result)
      if (result.action === 'revoked') revoked += 1
      else skipped += 1
      continue
    }

    if (targetType === 'profession') {
      if (shouldSkipLifecycleMutation(input.userMessage || '')) {
        skipped += 1
        continue
      }
      const result = await applyProfessionRevocation(controlSupabase, controlUserId, item)
      revokeResults.push(result)
      if (result.action === 'revoked') revoked += 1
      else skipped += 1
      continue
    }

    if (targetType === 'primary_project') {
      if (shouldSkipLifecycleMutation(input.userMessage || '')) {
        skipped += 1
        continue
      }
      const result = await applyPrimaryProjectRevocation(controlSupabase, controlUserId, item)
      revokeResults.push(result)
      if (result.action === 'revoked') revoked += 1
      else skipped += 1
      continue
    }

    if (targetType === 'project_name') {
      const result = await applyProjectNameRevocation(controlSupabase, controlUserId, item)
      revokeResults.push(result)
      if (result.action === 'revoked') revoked += 1
      else skipped += 1
      continue
    }

    if (targetType === 'project_scoped_key') {
      const result = await applyExactFactKeyRevocation(controlSupabase, controlUserId, item)
      revokeResults.push(result)
      if (result.action === 'revoked') revoked += 1
      else skipped += 1
      continue
    }

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
