/**
 * BrAIn Memory Service
 *
 * Persists and retrieves long-term memories.
 * Only saveMemory is implemented so far; other methods stay unimplemented.
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

  async searchMemory(
    _query: string,
    _options?: SearchMemoryOptions,
  ): Promise<unknown[]> {
    throw new Error('MemoryService.searchMemory is not implemented')
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
