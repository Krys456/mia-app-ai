/**
 * BrAIn Memory Service — architecture surface only.
 *
 * Method signatures are defined here with no implementation and no callers yet.
 * Do not import this into chat or API routes until a later step.
 */

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
  async saveMemory(_input: SaveMemoryInput): Promise<void> {
    throw new Error('MemoryService.saveMemory is not implemented')
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
}
