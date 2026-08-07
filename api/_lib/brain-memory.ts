/**
 * Compatibility re-export — runtime source of truth is lib/server/brain-memory.js
 */

export {
  saveMemory,
  listMemories,
  searchMemories,
  analyzeConversation,
  runMemoryPipeline,
} from '../../lib/server/brain-memory.js'

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
