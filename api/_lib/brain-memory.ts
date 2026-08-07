/**
 * BrAIn memory runtime — uses getServiceSupabase() as the only Supabase client source.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabase } from './supabase'

export type SaveMemoryInput = {
  category: string
  title: string
  content: string
  importance?: number
  tags?: string[]
  source?: string
  status?: string
  confidence?: number
}

export type MemoryRecord = {
  id: string
  category: string
  title: string
  content: string
  importance: number
}

export type MemoryDecision = {
  save: boolean
  category: string
  title: string
  content: string
  importance: number
}

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'
const NAME_PATTERN = /my\s+name\s+is\s+([^\n.!?,;:]+)/i

const NO_SAVE: MemoryDecision = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

async function ensureDefaultUserId(supabase: SupabaseClient): Promise<string> {
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

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

export async function saveMemory(input: SaveMemoryInput): Promise<void> {
  const supabase = await getServiceSupabase()
  const userId = await ensureDefaultUserId(supabase)

  const { error: insertError } = await supabase.from('memories').insert({
    user_id: userId,
    category: input.category,
    title: input.title,
    content: input.content,
    importance: input.importance ?? 1,
    tags: input.tags ?? [],
    source: input.source?.trim() || 'automatic',
    status: input.status?.trim() || 'active',
    confidence:
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? input.confidence
        : 1.0,
  })

  if (insertError) {
    throw new Error(`Failed to insert into public.memories: ${insertError.message}`)
  }
}

export async function listMemories(options?: {
  category?: string
}): Promise<MemoryRecord[]> {
  const supabase = await getServiceSupabase()
  const userId = await ensureDefaultUserId(supabase)

  let request = supabase
    .from('memories')
    .select('id, category, title, content, importance')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (options?.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(`Failed to list public.memories: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    category: String(row.category ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    importance:
      typeof row.importance === 'number' && Number.isFinite(row.importance)
        ? row.importance
        : 0,
  }))
}

async function recordMemoryUsage(
  supabase: SupabaseClient,
  memoryIds: string[],
): Promise<void> {
  if (memoryIds.length === 0) return

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

export async function searchMemories(
  query: string,
  options?: { limit?: number; category?: string },
): Promise<MemoryRecord[]> {
  const supabase = await getServiceSupabase()
  const userId = await ensureDefaultUserId(supabase)
  const limit = Math.min(Math.max(options?.limit ?? 5, 1), 20)

  let request = supabase
    .from('memories')
    .select('id, category, title, content, importance')
    .eq('user_id', userId)
    .order('importance', { ascending: false })
    .limit(100)

  if (options?.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(error.message)
  }

  const rows: MemoryRecord[] = (data ?? []).map((row) => ({
    id: String(row.id),
    category: String(row.category ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    importance:
      typeof row.importance === 'number' && Number.isFinite(row.importance)
        ? row.importance
        : 0,
  }))

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

/** Rule-based analyze — no DB, no OpenAI. */
export function analyzeConversation(
  userMessage: string,
  assistantMessage: string,
): MemoryDecision {
  const user = userMessage.trim()
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

export async function runMemoryPipeline(input: {
  userMessage: string
  assistantMessage: string
}): Promise<{ saved: boolean; decision: MemoryDecision }> {
  const decision = analyzeConversation(input.userMessage, input.assistantMessage)

  if (!decision.save) {
    return { saved: false, decision }
  }

  await saveMemory({
    category: decision.category,
    title: decision.title,
    content: decision.content,
    importance: decision.importance,
  })

  return { saved: true, decision }
}
