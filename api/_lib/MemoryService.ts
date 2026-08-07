/**
 * BrAIn Memory Service — thin wrapper over lib/server/brain-memory.js
 */

import {
  listMemories,
  saveMemory as saveMemoryRuntime,
  searchMemories,
} from '../../lib/server/brain-memory.js'

export type SaveMemoryInput = {
  category: string
  title: string
  content: string
  importance?: number
  userId?: string
  tags?: string[]
  source?: string
  status?: string
  confidence?: number
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

export class MemoryService {
  async saveMemory(input: SaveMemoryInput): Promise<void> {
    await saveMemoryRuntime(input)
  }

  async getMemories(options?: GetMemoriesOptions): Promise<MemorySearchResult[]> {
    return listMemories({ category: options?.category })
  }

  async updateMemory(_id: string, _input: UpdateMemoryInput): Promise<void> {
    throw new Error('MemoryService.updateMemory is not implemented')
  }

  async deleteMemory(_id: string): Promise<void> {
    throw new Error('MemoryService.deleteMemory is not implemented')
  }

  async searchMemory(
    query: string,
    options?: SearchMemoryOptions,
  ): Promise<MemorySearchResult[]> {
    return searchMemories(query, {
      category: options?.category,
      limit: options?.limit,
    })
  }
}
