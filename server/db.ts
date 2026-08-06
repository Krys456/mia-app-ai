import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

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

export interface MemoryRecord {
  id: string
  category: MemoryCategory
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && (MEMORY_CATEGORIES as readonly string[]).includes(value)
}

let ensureTablePromise: Promise<void> | null = null

export function getSql(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }
  return neon(databaseUrl)
}

export async function ensureMemoriesTable(sql: NeonQueryFunction<false, false>) {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      await sql`
        CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category)
      `
      await sql`
        CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories (updated_at DESC)
      `
    })().catch((error) => {
      ensureTablePromise = null
      throw error
    })
  }
  await ensureTablePromise
}

export function mapMemoryRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    category: row.category as MemoryCategory,
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export function createMemoryId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}
