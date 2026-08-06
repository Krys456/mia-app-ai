import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  createMemoryId,
  ensureMemoriesTable,
  getSql,
  isMemoryCategory,
  mapMemoryRow,
  type MemoryCategory,
} from '../../server/db'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

function sendJson(res: VercelResponse, status: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(payload)
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as Record<string, unknown>
  }
  if (typeof req.body === 'object') return req.body as Record<string, unknown>
  throw new Error('Unsupported request body')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  try {
    const sql = getSql()
    await ensureMemoriesTable(sql)

    if (req.method === 'GET') {
      const category =
        typeof req.query.category === 'string' ? req.query.category.trim() : ''
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const like = q ? `%${q}%` : null

      let rows: Record<string, unknown>[]

      if (category && isMemoryCategory(category) && like) {
        rows = (await sql`
          SELECT id, category, title, content, created_at, updated_at
          FROM memories
          WHERE category = ${category}
            AND (title ILIKE ${like} OR content ILIKE ${like})
          ORDER BY updated_at DESC
        `) as Record<string, unknown>[]
      } else if (category && isMemoryCategory(category)) {
        rows = (await sql`
          SELECT id, category, title, content, created_at, updated_at
          FROM memories
          WHERE category = ${category}
          ORDER BY updated_at DESC
        `) as Record<string, unknown>[]
      } else if (like) {
        rows = (await sql`
          SELECT id, category, title, content, created_at, updated_at
          FROM memories
          WHERE title ILIKE ${like} OR content ILIKE ${like}
          ORDER BY updated_at DESC
        `) as Record<string, unknown>[]
      } else {
        rows = (await sql`
          SELECT id, category, title, content, created_at, updated_at
          FROM memories
          ORDER BY updated_at DESC
        `) as Record<string, unknown>[]
      }

      return sendJson(res, 200, { memories: rows.map(mapMemoryRow) })
    }

    if (req.method === 'POST') {
      let body: Record<string, unknown>
      try {
        body = parseBody(req)
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' })
      }

      const category = body.category
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content.trim() : ''

      if (!isMemoryCategory(category)) {
        return sendJson(res, 400, { error: 'Invalid category' })
      }
      if (!title) {
        return sendJson(res, 400, { error: 'Title is required' })
      }

      const id = createMemoryId()
      const rows = (await sql`
        INSERT INTO memories (id, category, title, content)
        VALUES (${id}, ${category as MemoryCategory}, ${title}, ${content})
        RETURNING id, category, title, content, created_at, updated_at
      `) as Record<string, unknown>[]

      return sendJson(res, 201, { memory: mapMemoryRow(rows[0]) })
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('[api/memories]', error)
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('DATABASE_URL') ? 500 : 500
    return sendJson(res, status, { error: message })
  }
}
