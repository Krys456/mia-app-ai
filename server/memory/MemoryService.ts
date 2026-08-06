/**
 * BrAIn Memory Service
 *
 * Persists and retrieves long-term memories.
 */

import { getServiceSupabase } from '../../api/_lib/supabase'

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'

export type SaveMemoryInput = {
  category: string
  title: string
  content: string
  importance?: number
  userId?: string
}

export type UpdateMemoryInput = {
  category?: string
  title?: string
  content?: string
  importance?: number
}

export type GetMemoriesOptions = {
  userId?: string
  category?: string
}

export type SearchMemoryOptions = {
  userId?: string
  category?: string
  limit?: number
}

export type MemorySearchResult = {
  id: string
  category: string
  title: string
  content: string
  importance: number
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

export class MemoryService {
  async saveMemory(input: SaveMemoryInput): Promise<void> {
    const supabase = getServiceSupabase()
    const userId = input.userId ?? (await this.ensureDefaultUserId())

    const { error: insertError } = await supabase.from('memories').insert({
      user_id: userId,
      category: input.category,
      title: input.title,
      content: input.content,
      importance: input.importance,
    })

    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  async getMemories(_options?: GetMemoriesOptions): Promise<unknown[]> {
    throw new Error('MemoryService.getMemories is not implemented')
  }

  async updateMemory(_id: string, _input: UpdateMemoryInput): Promise<void> {
    throw new Error('MemoryService.updateMemory is not implemented')
  }

  async deleteMemory(_id: string): Promise<void> {
    throw new Error('MemoryService.deleteMemory is not implemented')
  }

  /**
   * Returns the most relevant memories for a query (keyword + importance ranking).
   */
  async searchMemory(
    query: string,
    options?: SearchMemoryOptions,
  ): Promise<MemorySearchResult[]> {
    const supabase = getServiceSupabase()
    const userId = options?.userId ?? (await this.ensureDefaultUserId())
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

    const rows = (data ?? []).map((row) => ({
      id: String(row.id),
      category: String(row.category ?? ''),
      title: String(row.title ?? ''),
      content: String(row.content ?? ''),
      importance:
        typeof row.importance === 'number' && Number.isFinite(row.importance)
          ? row.importance
          : 0,
    }))

    if (rows.length === 0) {
      return []
    }

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

    // No keyword hits — fall back to highest-importance memories as general context.
    const pool = relevant.length > 0 ? relevant : scored

    const results = pool
      .sort((a, b) => b.score - a.score || b.row.importance - a.row.importance)
      .slice(0, limit)
      .map((item) => item.row)

    if (results.length > 0) {
      await this.recordMemoryUsage(results.map((item) => item.id))
    }

    return results
  }

  /**
   * Increment usage_count and set last_used_at for memories returned by search.
   * Failures are swallowed so search results are unchanged for callers.
   */
  private async recordMemoryUsage(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return

    try {
      const supabase = getServiceSupabase()
      const { error } = await supabase.rpc('mark_memories_used', {
        memory_ids: memoryIds,
      })

      if (error) {
        // Fallback without RPC: bump each row independently.
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

  private async ensureDefaultUserId(): Promise<string> {
    const supabase = getServiceSupabase()

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
}
