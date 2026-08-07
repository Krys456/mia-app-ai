/**
 * BrAIn memory runtime — single Supabase-backed implementation for all memory APIs.
 * Automatic background memory: analyze → upsert (dedupe) → never block chat.
 */

import { getServiceSupabase } from './supabase.js'

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'

const NO_SAVE = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at'

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

function tokenize(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
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
  }
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

function isEphemeralNoise(user) {
  const text = user.trim()
  if (text.length < 8) return true

  // Pure questions / greetings / thanks without durable facts
  if (
    /^(ciao|hey|hi|hello|salve|buongiorno|buonasera|ok|okay|grazie|thanks|thank you)[\s!.?]*$/i.test(
      text,
    )
  ) {
    return true
  }

  // Clearly momentary / same-day chatter without preference language
  const momentary =
    /\b(oggi|stasera|domani|ieri|adesso|tra poco|tra un'?ora|this morning|tonight|tomorrow|yesterday|right now)\b/i.test(
      text,
    )
  const durableCue =
    /\b(mi chiamo|sono|preferisco|mi piace|non mi piace|odio|amo|hobby|lavoro|obiettivo|progetto|ricorda|sempre|mai|my name|i am|i'm|i prefer|i like|i love|i hate|i work|my goal|remember|always|never)\b/i.test(
      text,
    )

  if (momentary && !durableCue) return true

  // Short question-only messages
  if (text.endsWith('?') && text.length < 48 && !durableCue) return true

  return false
}

/**
 * Rule-based extractor for durable user facts (IT + EN).
 * Saves only long-term useful signals; ignores casual chatter.
 */
export function analyzeConversation(userMessage, assistantMessage) {
  const user = String(userMessage || '').trim()
  void assistantMessage

  if (!user || isEphemeralNoise(user)) return { ...NO_SAVE }

  // Name / identity
  const namePatterns = [
    /(?:mi\s+chiamo|il\s+mio\s+nome\s+[eè]|sono)\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ'-]{1,40})/i,
    /(?:my\s+name\s+is|i(?:'m|\s+am)\s+called)\s+([A-Za-z][\w'-]{1,40})/i,
    /\bi(?:'m|\s+am)\s+([A-Z][a-z]{1,40})\b/,
  ]
  for (const pattern of namePatterns) {
    const match = user.match(pattern)
    const name = match?.[1]?.trim()
    if (name && !/^(un|una|il|la|lo|gli|le|a|an|the|not|non)$/i.test(name)) {
      return decision('identity', 'Name', `User's name is ${name}.`, 9)
    }
  }

  // Profession
  const profession =
    user.match(
      /(?:lavoro\s+come|faccio\s+il|faccio\s+la|sono\s+(?:un|una)\s+)([^,.!?\n]{2,60})/i,
    ) ||
    user.match(
      /(?:i\s+work\s+as|my\s+job\s+is|i(?:'m|\s+am)\s+a(?:n)?\s+)([^,.!?\n]{2,60})/i,
    )
  if (profession?.[1]) {
    const value = profession[1].trim()
    return decision('profession', 'Profession', `User's profession: ${value}.`, 8)
  }

  // Goals
  const goal =
    user.match(
      /(?:il\s+mio\s+obiettivo\s+[eè]|il\s+mio\s+scopo\s+[eè]|voglio\s+(?:riuscire\s+a\s+|raggiungere\s+)?)([^,.!?\n]{3,80})/i,
    ) ||
    user.match(
      /(?:my\s+goal\s+is|i(?:'m|\s+am)\s+trying\s+to|i\s+want\s+to)\s+([^,.!?\n]{3,80})/i,
    )
  if (goal?.[1]) {
    const value = goal[1].trim()
    return decision('goals', 'Goal', `User's goal: ${value}.`, 7)
  }

  // Projects
  const project =
    user.match(
      /(?:sto\s+lavorando\s+(?:su|a)\s+|il\s+mio\s+progetto\s+[eè]\s+)([^,.!?\n]{3,80})/i,
    ) ||
    user.match(/(?:i(?:'m|\s+am)\s+working\s+on|my\s+project\s+is)\s+([^,.!?\n]{3,80})/i)
  if (project?.[1]) {
    const value = project[1].trim()
    return decision('projects', 'Project', `User's project: ${value}.`, 7)
  }

  // Relationships
  const relationship =
    user.match(
      /(?:mio|mia|il\s+mio|la\s+mia)\s+(marito|moglie|fidanzat[oa]|partner|fratello|sorella|madre|padre|figlio|figlia|amico|amica)\s+(?:si\s+chiama\s+|è\s+|e\s+)?([^,.!?\n]{2,60})?/i,
    ) ||
    user.match(
      /my\s+(husband|wife|boyfriend|girlfriend|partner|brother|sister|mom|dad|son|daughter|friend)\s+(?:is\s+|called\s+)?([^,.!?\n]{2,60})?/i,
    )
  if (relationship) {
    const role = String(relationship[1] || '').trim()
    const detail = String(relationship[2] || '').trim()
    const content = detail
      ? `Important relationship: ${role} — ${detail}.`
      : `User mentioned an important relationship: ${role}.`
    return decision('relationships', 'Relationship', content, 7)
  }

  // Hobbies
  const hobby =
    user.match(
      /(?:il\s+mio\s+hobby\s+[eè]|nei?\s+tempo\s+libero\s+(?:mi\s+piace\s+|faccio\s+)?|mi\s+diverto\s+(?:a\s+)?)([^,.!?\n]{3,80})/i,
    ) ||
    user.match(
      /(?:my\s+hobby\s+is|in\s+my\s+free\s+time\s+i\s+(?:like\s+to\s+|enjoy\s+)?|i\s+enjoy)\s+([^,.!?\n]{3,80})/i,
    )
  if (hobby?.[1]) {
    const value = hobby[1].trim()
    return decision('hobbies', 'Hobby', `User's hobby: ${value}.`, 6)
  }

  // Preferences / tastes (likes)
  const like =
    user.match(/(?:preferisco|mi\s+piace(?:\s+molto)?)\s+([^,.!?\n]{3,80})/i) ||
    user.match(/(?:i\s+prefer|i\s+like|i\s+love)\s+([^,.!?\n]{3,80})/i)
  if (like?.[1]) {
    const value = like[1].trim()
    return decision('preferences', 'Preference', `User likes / prefers: ${value}.`, 6)
  }

  // Dislikes
  const dislike =
    user.match(/(?:non\s+mi\s+piace|odio|detesto)\s+([^,.!?\n]{3,80})/i) ||
    user.match(/(?:i\s+don'?t\s+like|i\s+hate|i\s+dislike)\s+([^,.!?\n]{3,80})/i)
  if (dislike?.[1]) {
    const value = dislike[1].trim()
    return decision('preferences', 'Dislike', `User dislikes: ${value}.`, 6)
  }

  // Favorite / taste
  const taste =
    user.match(
      /(?:il\s+mio\s+(?:cibo|colore|film|libro|artista|musica)\s+preferit[oa]\s+[eè]\s+)([^,.!?\n]{2,60})/i,
    ) ||
    user.match(
      /(?:my\s+favorite\s+(?:food|color|colour|movie|book|artist|music)\s+is\s+)([^,.!?\n]{2,60})/i,
    )
  if (taste?.[1]) {
    const value = taste[1].trim()
    return decision('tastes', 'Favorite', `User's favorite: ${value}.`, 6)
  }

  // Preferred assistant / settings style
  const setting =
    user.match(
      /(?:ricorda\s+che|preferisco\s+che\s+tu|voglio\s+che\s+tu)\s+([^,.!?\n]{5,100})/i,
    ) ||
    user.match(/(?:remember\s+that|please\s+always|i\s+want\s+you\s+to)\s+([^,.!?\n]{5,100})/i)
  if (setting?.[1]) {
    const value = setting[1].trim()
    return decision('settings', 'Preferred setting', `User prefers: ${value}.`, 7)
  }

  return { ...NO_SAVE }
}

export async function saveMemory(input) {
  const supabase = await getServiceSupabase()
  const userId = input.userId || (await ensureDefaultUserId(supabase))

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

async function findUpsertTarget(supabase, userId, category, title, content) {
  const { data, error } = await supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .eq('category', category)
    .order('updated_at', { ascending: false })
    .limit(40)

  if (error) {
    throw new Error(`Failed to look up memories for dedupe: ${error.message}`)
  }

  const rows = data ?? []
  const titleNorm = normalizeText(title)
  const contentNorm = normalizeText(content)

  const sameTitle = rows.find((row) => normalizeText(row.title) === titleNorm)
  if (sameTitle) return sameTitle

  // Same category + highly overlapping content → treat as update candidate
  const contentTokens = new Set(tokenize(contentNorm))
  if (contentTokens.size === 0) return null

  let best = null
  let bestScore = 0
  for (const row of rows) {
    const rowTokens = tokenize(row.content)
    if (rowTokens.length === 0) continue
    let overlap = 0
    for (const token of rowTokens) {
      if (contentTokens.has(token)) overlap += 1
    }
    const score = overlap / Math.max(rowTokens.length, contentTokens.size)
    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }

  return bestScore >= 0.55 ? best : null
}

/**
 * Insert or update an existing memory to avoid duplicates.
 * Returns { action: 'created' | 'updated' | 'skipped', memory? }
 */
export async function upsertMemory(input) {
  const supabase = await getServiceSupabase()
  const userId = input.userId || (await ensureDefaultUserId(supabase))
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

  const memory = await saveMemory({ ...input, userId })
  return { action: 'created', memory }
}

export async function listMemories(options = {}) {
  const supabase = await getServiceSupabase()
  const userId = options.userId || (await ensureDefaultUserId(supabase))

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
  const userId = options.userId || (await ensureDefaultUserId(supabase))

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
  const userId = options.userId || (await ensureDefaultUserId(supabase))

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
  const userId = options.userId || (await ensureDefaultUserId(supabase))

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
  const userId = options.userId || (await ensureDefaultUserId(supabase))

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

export async function searchMemories(query, options = {}) {
  const supabase = await getServiceSupabase()
  const userId = options.userId || (await ensureDefaultUserId(supabase))
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20)

  let request = supabase
    .from('memories')
    .select(MEMORY_SELECT)
    .eq('user_id', userId)
    .order('importance', { ascending: false })
    .limit(100)

  if (options.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []).map(mapMemoryRow)
  if (rows.length === 0) return []

  const tokens = tokenize(query)
  const scored = rows.map((row) => {
    const haystack = `${row.title} ${row.content} ${row.category}`.toLowerCase()
    let score = row.importance
    let matched = tokens.length === 0

    for (const token of tokens) {
      if (haystack.includes(token)) {
        matched = true
        score += 4
        if (row.title.toLowerCase().includes(token)) score += 3
      }
    }

    return { row, score, matched }
  })

  const relevant = tokens.length > 0 ? scored.filter((item) => item.matched) : scored
  const pool = relevant.length > 0 ? relevant : scored

  const results = pool
    .sort((a, b) => b.score - a.score || b.row.importance - a.row.importance)
    .slice(0, limit)
    .map((item) => item.row)

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

  const decisionResult = analyzeConversation(input.userMessage, input.assistantMessage)

  if (!decisionResult.save) {
    return { saved: false, updated: false, skipped: false, decision: decisionResult }
  }

  const result = await upsertMemory({
    category: decisionResult.category,
    title: decisionResult.title,
    content: decisionResult.content,
    importance: decisionResult.importance,
    source: 'automatic',
  })

  return {
    saved: result.action === 'created' || result.action === 'updated',
    updated: result.action === 'updated',
    skipped: result.action === 'skipped',
    decision: decisionResult,
    memory: result.memory,
  }
}
