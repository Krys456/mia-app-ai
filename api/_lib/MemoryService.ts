/**
 * BrAIn Memory Service — thin wrapper over brain-memory runtime.
 */

import {
  listMemories,
  saveMemory as saveMemoryRuntime,
  searchMemories,
  type MemoryRecord,
  type SaveMemoryInput as RuntimeSaveInput,
} from './brain-memory'

export type SaveMemoryInput = RuntimeSaveInput & {
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

export type MemorySearchResult = MemoryRecord

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
