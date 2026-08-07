export const MEMORY_CATEGORIES = [
  'identity',
  'preferences',
  'hobbies',
  'profession',
  'goals',
  'projects',
  'relationships',
  'tastes',
  'settings',
  'important',
] as const

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number] | string

export interface MemoryItem {
  id: string
  userId?: string
  category: MemoryCategory
  title: string
  content: string
  importance?: number
  usageCount?: number
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryDraft {
  category: MemoryCategory
  title: string
  content: string
}

export function isMemoryCategory(value: string): boolean {
  return value.trim().length > 0
}
