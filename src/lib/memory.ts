/**
 * Memory domain types / category labels for the UI.
 * Storage stays free-text on the existing `category` column (no schema change).
 */
export const MEMORY_CATEGORIES = [
  'identity',
  'preferences',
  'projects',
  'goals',
  'relationships',
  'skills',
  'habits',
  'events',
  'settings',
] as const

/** Older automatic categories that may still exist in stored rows. */
export const LEGACY_MEMORY_CATEGORIES = [
  'hobbies',
  'profession',
  'tastes',
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

/** Short Italian labels for intelligent categories (UI only). */
export function memoryCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    identity: 'Identità',
    preferences: 'Preferenze',
    projects: 'Progetti',
    goals: 'Obiettivi',
    relationships: 'Relazioni',
    skills: 'Competenze',
    habits: 'Abitudini',
    events: 'Eventi importanti',
    settings: 'Impostazioni personali',
    hobbies: 'Abitudini',
    profession: 'Competenze',
    tastes: 'Preferenze',
    important: 'Eventi importanti',
  }
  return map[category] || category
}
