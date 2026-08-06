export const MEMORY_CATEGORIES = [
  'Profile',
  'Preferences',
  'Goals',
  'Projects',
  'Routine',
  'Reminders',
  'Important',
] as const

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export interface MemoryItem {
  id: string
  category: MemoryCategory
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface MemoryDraft {
  category: MemoryCategory
  title: string
  content: string
}

export function isMemoryCategory(value: string): value is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(value)
}
