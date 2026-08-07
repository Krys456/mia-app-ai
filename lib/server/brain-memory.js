/**
 * BrAIn memory runtime — single Supabase-backed implementation for all memory APIs.
 */

import { getServiceSupabase } from './supabase.js'

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'
const NAME_PATTERN = /my\s+name\s+is\s+([^\n.!?,;:]+)/i

const NO_SAVE = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

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
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined,
  }
}

export async function saveMemory(input) {
  const supabase = await getServiceSupabase()
  const userId = input.userId || (await ensureDefaultUserId(supabase))

  const { error: insertError } = await supabase.from('memories').insert({
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

  if (insertError) {
    throw new Error(`Failed to insert into public.memories: ${insertError.message}`)
  }
}

export async function listMemories(options = {}) {
  const supabase = await getServiceSupabase()
  const userId = options.userId || (await ensureDefaultUserId(supabase))

  let request = supabase
    .from('memories')
    .select('id, category, title, content, importance, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (options.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(`Failed to list public.memories: ${error.message}`)
  }

  return (data ?? []).map(mapMemoryRow)
}

export async function getMemoryById(id, options = {}) {
  const supabase = await getServiceSupabase()
  const userId = options.userId || (await ensureDefaultUserId(supabase))

  const { data, error } = await supabase
    .from('memories')
    .select('id, category, title, content, importance, created_at, updated_at')
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
    .select('id, category, title, content, importance, created_at, updated_at')
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
    .select('id, category, title, content, importance, created_at, updated_at')
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

export function analyzeConversation(userMessage, assistantMessage) {
  const user = String(userMessage || '').trim()
  void assistantMessage

  if (!user) return { ...NO_SAVE }

  const nameMatch = user.match(NAME_PATTERN)
  if (nameMatch?.[1]) {
    const name = nameMatch[1].trim()
    if (name) {
      return {
        save: true,
        category: 'identity',
        title: 'Name',
        content: `User's name is ${name}.`,
        importance: 8,
      }
    }
  }

  return { ...NO_SAVE }
}

export async function runMemoryPipeline(input) {
  const decision = analyzeConversation(input.userMessage, input.assistantMessage)

  if (!decision.save) {
    return { saved: false, decision }
  }

  await saveMemory({
    category: decision.category,
    title: decision.title,
    content: decision.content,
    importance: decision.importance,
    source: 'automatic',
  })

  return { saved: true, decision }
}
