import { neon } from '@neondatabase/serverless'

export const MEMORY_CATEGORIES = [
  'Profile',
  'Preferences',
  'Goals',
  'Projects',
  'Routine',
  'Reminders',
  'Important',
]

export function isMemoryCategory(value) {
  return typeof value === 'string' && MEMORY_CATEGORIES.includes(value)
}

let ensureTablePromise = null

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }
  return neon(databaseUrl)
}

export function tryGetSql() {
  try {
    return getSql()
  } catch {
    return null
  }
}

export async function ensureMemoriesTable(sql) {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'legacy',
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      await sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`
      await sql`CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category)`
      await sql`CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories (updated_at DESC)`
      await sql`CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id)`
    })().catch((error) => {
      ensureTablePromise = null
      throw error
    })
  }
  await ensureTablePromise
}

export function mapMemoryRow(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? 'legacy'),
    category: row.category,
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export function createMemoryId() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function sanitizeUserId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 80) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null
  return trimmed
}

export async function listMemoriesForUser(sql, userId, options = {}) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200)
  const category = options.category
  const like = options.q?.trim() ? `%${options.q.trim()}%` : null

  let rows

  if (category && like) {
    rows = await sql`
      SELECT id, user_id, category, title, content, created_at, updated_at
      FROM memories
      WHERE user_id = ${userId}
        AND category = ${category}
        AND (title ILIKE ${like} OR content ILIKE ${like})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  } else if (category) {
    rows = await sql`
      SELECT id, user_id, category, title, content, created_at, updated_at
      FROM memories
      WHERE user_id = ${userId}
        AND category = ${category}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  } else if (like) {
    rows = await sql`
      SELECT id, user_id, category, title, content, created_at, updated_at
      FROM memories
      WHERE user_id = ${userId}
        AND (title ILIKE ${like} OR content ILIKE ${like})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  } else {
    rows = await sql`
      SELECT id, user_id, category, title, content, created_at, updated_at
      FROM memories
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  }

  return rows.map(mapMemoryRow)
}

export async function insertMemory(sql, input) {
  const id = createMemoryId()
  const rows = await sql`
    INSERT INTO memories (id, user_id, category, title, content)
    VALUES (${id}, ${input.userId}, ${input.category}, ${input.title}, ${input.content})
    RETURNING id, user_id, category, title, content, created_at, updated_at
  `
  return mapMemoryRow(rows[0])
}

export async function updateMemoryForUser(sql, input) {
  const rows = await sql`
    UPDATE memories
    SET
      category = ${input.category},
      title = ${input.title},
      content = ${input.content},
      updated_at = NOW()
    WHERE id = ${input.id} AND user_id = ${input.userId}
    RETURNING id, user_id, category, title, content, created_at, updated_at
  `
  return rows[0] ? mapMemoryRow(rows[0]) : null
}

export async function deleteMemoryForUser(sql, id, userId) {
  const rows = await sql`
    DELETE FROM memories
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `
  return rows.length > 0
}

export async function upsertMemoryByTitle(sql, input) {
  const existing = await sql`
    SELECT id, user_id, category, title, content, created_at, updated_at
    FROM memories
    WHERE user_id = ${input.userId}
      AND lower(title) = lower(${input.title})
    LIMIT 1
  `

  if (existing[0]) {
    const updated = await updateMemoryForUser(sql, {
      id: String(existing[0].id),
      userId: input.userId,
      category: input.category,
      title: input.title,
      content: input.content,
    })
    return updated ?? mapMemoryRow(existing[0])
  }

  return insertMemory(sql, input)
}

export function formatMemoriesForPrompt(memories) {
  if (memories.length === 0) return ''
  const lines = memories.map(
    (m) => `- [${m.category}] ${m.title}: ${m.content || '(no details)'}`,
  )
  return [
    '## Long-term user memory (authoritative across sessions)',
    'Use these facts naturally in future replies when relevant. Do not invent contradictions.',
    'If the user updates a goal/interest/preference, prefer the newest information.',
    ...lines,
  ].join('\n')
}
