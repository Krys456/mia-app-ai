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
    ],
    related: ['prefer', 'preference', 'likes', 'theme', 'settings', 'style'],
  },
  {
    id: 'projects',
    categories: ['projects'],
    cues: [
      'progetto',
      'project',
      'app',
      'svilupp',
      'build',
      'laife',
      'mvp',
      'repo',
      'feature',
      'deploy',
    ],
    related: ['project', 'progetto', 'app', 'mvp', 'build', 'develop'],
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
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
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

function decision(category, title, content, importance) {
  return {
    save: true,
    category,
    title,
    content,
    importance,
  }
}

function cleanCapture(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s.!?]+$/g, '')
    .trim()
}

/**
 * Reject chatter and temporary queries — memory must stay useful, not huge.
 */
export function isEphemeralNoise(userMessage) {
  const text = String(userMessage || '').trim()
  if (!text) return true
  if (text.length < 6) return true

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

  const durableCue =
    /\b(mi\s+chiamo|il\s+mio\s+nome|sono\s+(?:un|una)|preferisco|mi\s+piace|non\s+mi\s+piace|odio|amo|hobby|lavoro|studio|obiettivo|progetto|sto\s+(?:sviluppando|creando|lavorando)|ricorda|sempre|mai|uso|utilizzo|abito|vivo|my\s+name|i\s+am|i'm|i\s+prefer|i\s+like|i\s+love|i\s+hate|i\s+work|i\s+study|i\s+use|my\s+goal|remember\s+that|always|never|developing|building)\b/i.test(
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
 * @returns {Array<{category:string,title:string,content:string,importance:number}>}
 */
export function extractDurableFacts(userMessage) {
  const user = String(userMessage || '').trim()
  if (!user || isEphemeralNoise(user)) return []

  /** @type {Array<{category:string,title:string,content:string,importance:number}>} */
  const facts = []

  const push = (category, title, content, importance) => {
    const cleaned = cleanCapture(content)
    if (!cleaned || cleaned.length < 4) return
    facts.push(decision(category, title, cleaned, importance))
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
      push('identity', 'Name', `User's name is ${name}.`, 9)
      break
    }
  }

  const location =
    user.match(
      /(?:abito\s+(?:a|in)|vivo\s+(?:a|in)|sono\s+di)\s+([A-ZÀ-ÖØ-Ý][^,.!?\n]{1,40})/i,
    ) ||
    user.match(/(?:i\s+live\s+in|i(?:'m|\s+am)\s+from)\s+([A-Z][^,.!?\n]{1,40})/i)
  if (location?.[1]) {
    push('identity', 'Location', `User lives in / is from: ${cleanCapture(location[1])}.`, 7)
  }

  // —— Preferenze ——
  const like =
    user.match(/(?:preferisco|mi\s+piace(?:\s+molto)?)\s+([^,.!?\n]{3,90})/i) ||
    user.match(/(?:i\s+prefer|i\s+like|i\s+love)\s+([^,.!?\n]{3,90})/i)
  if (like?.[1]) {
    const value = cleanCapture(like[1])
    // Assistant-style prefs go to settings
    if (
      /\b(rispost[ea]|dettagliat|concis|brevi|lungh|emoji|tono|stile|markdown)\b/i.test(
        value,
      )
    ) {
      push('settings', 'Reply preference', `User prefers: ${value}.`, 8)
    } else {
      push('preferences', 'Preference', `User likes / prefers: ${value}.`, 6)
    }
  }

  const dislike =
    user.match(/(?:non\s+mi\s+piace|odio|detesto)\s+([^,.!?\n]{3,90})/i) ||
    user.match(/(?:i\s+don'?t\s+like|i\s+hate|i\s+dislike)\s+([^,.!?\n]{3,90})/i)
  if (dislike?.[1]) {
    push('preferences', 'Dislike', `User dislikes: ${cleanCapture(dislike[1])}.`, 6)
  }

  const taste =
    user.match(
      /(?:il\s+mio\s+(?:cibo|colore|film|libro|artista|musica|tema)\s+preferit[oa]\s+[eè]\s+)([^,.!?\n]{2,60})/i,
    ) ||
    user.match(
      /(?:my\s+favorite\s+(?:food|color|colour|movie|book|artist|music|theme)\s+is\s+)([^,.!?\n]{2,60})/i,
    )
  if (taste?.[1]) {
    const value = cleanCapture(taste[1])
    if (/\b(tema|theme|scuro|chiaro|dark|light)\b/i.test(user)) {
      push('settings', 'Theme preference', `User prefers theme / UI: ${value}.`, 7)
    } else {
      push('preferences', 'Favorite', `User's favorite: ${value}.`, 6)
    }
  }

  if (/\b(tema\s+scuro|dark\s+mode|dark\s+theme|tema\s+chiaro|light\s+mode)\b/i.test(user)) {
    const dark = /\b(scuro|dark)\b/i.test(user)
    push(
      'settings',
      'Theme preference',
      dark ? 'User prefers dark theme.' : 'User prefers light theme.',
      7,
    )
  }

  // —— Progetti ——
  const project =
    user.match(
      /(?:sto\s+(?:sviluppando|creando|costruendo|lavorando\s+(?:su|a))\s+|il\s+mio\s+progetto\s+[eè]\s+)([^,.!?\n]{3,90})/i,
    ) ||
    user.match(
      /(?:i(?:'m|\s+am)\s+(?:developing|building|creating|working\s+on)|my\s+project\s+is)\s+([^,.!?\n]{3,90})/i,
    )
  if (project?.[1]) {
    push('projects', 'Project', `User's project: ${cleanCapture(project[1])}.`, 7)
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
    if (value.length >= 5) {
      push('goals', 'Goal', `User's goal: ${value}.`, 7)
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
  if (study?.[1]) {
    push('skills', 'Studies', `User studies: ${cleanCapture(study[1])}.`, 7)
  }

  // —— Abitudini / strumenti ——
  const uses =
    user.match(
      /(?:uso|utilizzo|lavoro\s+con|lavoro\s+su)\s+([^,.!?\n]{2,70})/i,
    ) ||
    user.match(/(?:i\s+use|i(?:'m|\s+am)\s+using|i\s+work\s+(?:with|on))\s+([^,.!?\n]{2,70})/i)
  if (uses?.[1]) {
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
  const setting =
    user.match(
      /(?:ricorda\s+che|preferisco\s+che\s+tu|voglio\s+che\s+tu)\s+([^,.!?\n]{5,120})/i,
    ) ||
    user.match(
      /(?:remember\s+that|please\s+always|i\s+want\s+you\s+to)\s+([^,.!?\n]{5,120})/i,
    )
  if (setting?.[1]) {
    push('settings', 'Preferred setting', `User prefers: ${cleanCapture(setting[1])}.`, 7)
  }

  if (/\b(risposte\s+dettagliat|risposte\s+concis|risposte\s+brevi|detailed\s+replies|concise\s+replies)\b/i.test(user)) {
    if (/\b(dettagliat|detailed)\b/i.test(user)) {
      push('settings', 'Reply preference', 'User prefers detailed replies.', 8)
    } else {
      push('settings', 'Reply preference', 'User prefers concise replies.', 8)
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

  // Keep memory lean: at most 3 facts per turn, highest importance first
  return unique.sort((a, b) => b.importance - a.importance).slice(0, 3)
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
    items,
  }
}

export async function saveMemory(input) {
  const supabase = await getServiceSupabase()
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
      tags: input.tags ?? [],
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

async function findUpsertTarget(supabase, userId, category, title, content) {
  const aliases = categoryMatchers(category)

  const { data, error } = await supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .in('category', aliases)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(`Failed to look up memories for dedupe: ${error.message}`)
  }

  const rows = data ?? []
  const titleNorm = normalizeText(title)
  const contentNorm = normalizeText(content)

  // Same stable title within category family (e.g. always update "Name")
  const sameTitle = rows.find((row) => normalizeText(row.title) === titleNorm)
  if (sameTitle) return sameTitle

  // Same category family + overlapping content → update instead of duplicate
  let best = null
  let bestScore = 0
  for (const row of rows) {
    const score = tokenOverlapScore(contentNorm, normalizeText(row.content))
    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }

  return bestScore >= DEDUPE_OVERLAP ? best : null
}

/**
 * Insert or update an existing memory to avoid duplicates.
 * Returns { action: 'created' | 'updated' | 'skipped', memory? }
 */
export async function upsertMemory(input) {
  const supabase = await getServiceSupabase()
  const userId = await resolveMemoryUserId(
    {
      userId: input.userId,
      requireExplicitUserId: input.requireExplicitUserId === true,
    },
    supabase,
  )
  const existing = await findUpsertTarget(
    supabase,
    userId,
    input.category,
    input.title,
    input.content,
  )

  if (existing) {
    if (normalizeText(existing.content) === normalizeText(input.content)) {
      return { action: 'skipped', memory: mapMemoryRow(existing) }
    }

    const { data, error } = await supabase
      .from('memories')
      .update({
        category: input.category,
        title: input.title,
        content: input.content,
        importance: input.importance ?? existing.importance ?? 1,
        source: (input.source && String(input.source).trim()) || existing.source || 'automatic',
        status: (input.status && String(input.status).trim()) || existing.status || 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select(MEMORY_SELECT)
      .single()

    if (error) {
      throw new Error(`Failed to update public.memories: ${error.message}`)
    }

    return { action: 'updated', memory: mapMemoryRow(data) }
  }

  const memory = await saveMemory({
    ...input,
    userId,
    requireExplicitUserId: input.requireExplicitUserId === true,
  })
  return { action: 'created', memory }
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
  const supabase = await getServiceSupabase()
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
 * @param {Array<{ row: any, score: number }>} scored
 * @param {number} limit
 */
function selectTopMemories(scored, limit) {
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
    if (count >= MAX_PER_CATEGORY) continue
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
 */
export async function searchMemories(query, options = {}) {
  const supabase = await getServiceSupabase()
  const userId = options.userId || (await ensureDefaultUserId(supabase))
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

  const results = selectTopMemories(scored, limit)

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

  const items =
    Array.isArray(decisionResult.items) && decisionResult.items.length > 0
      ? decisionResult.items
      : [
          {
            category: decisionResult.category,
            title: decisionResult.title,
            content: decisionResult.content,
            importance: decisionResult.importance,
          },
        ]

  let created = 0
  let updated = 0
  let skipped = 0
  let lastMemory = null

  for (const item of items) {
    const result = await upsertMemory({
      category: item.category,
      title: item.title,
      content: item.content,
      importance: item.importance,
      source: 'automatic',
      ...(explicitUserId ? { userId: explicitUserId } : {}),
      ...(requireExplicitUserId ? { requireExplicitUserId: true } : {}),
    })
    if (result.action === 'created') created += 1
    else if (result.action === 'updated') updated += 1
    else skipped += 1
    lastMemory = result.memory || lastMemory
  }

  return {
    saved: created + updated > 0,
    updated: updated > 0,
    skipped: created + updated === 0 && skipped > 0,
    decision: decisionResult,
    memory: lastMemory,
    stats: { created, updated, skipped },
  }
}
