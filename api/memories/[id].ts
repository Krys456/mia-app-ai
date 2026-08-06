import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ensureMemoriesTable,
  getSql,
  isMemoryCategory,
  mapMemoryRow,
  type MemoryCategory,
} from '../../../server/db'

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

function getId(req: VercelRequest): string {
  const raw = req.query.id
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  return ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  const id = getId(req)
  if (!id) {
    return sendJson(res, 400, { error: 'Memory id is required' })
  }

  try {
    const sql = getSql()
    await ensureMemoriesTable(sql)

    if (req.method === 'GET') {
      const rows = (await sql`
        SELECT id, category, title, content, created_at, updated_at
        FROM memories
        WHERE id = ${id}
        LIMIT 1
      `) as Record<string, unknown>[]

      if (!rows[0]) {
        return sendJson(res, 404, { error: 'Memory not found' })
      }
      return sendJson(res, 200, { memory: mapMemoryRow(rows[0]) })
    }

    if (req.method === 'PUT') {
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

      const rows = (await sql`
        UPDATE memories
        SET
          category = ${category as MemoryCategory},
          title = ${title},
          content = ${content},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, category, title, content, created_at, updated_at
      `) as Record<string, unknown>[]

      if (!rows[0]) {
        return sendJson(res, 404, { error: 'Memory not found' })
      }
      return sendJson(res, 200, { memory: mapMemoryRow(rows[0]) })
    }

    if (req.method === 'DELETE') {
      const rows = (await sql`
        DELETE FROM memories
        WHERE id = ${id}
        RETURNING id
      `) as Record<string, unknown>[]

      if (!rows[0]) {
        return sendJson(res, 404, { error: 'Memory not found' })
      }
      return sendJson(res, 200, { ok: true, id })
    }

    res.setHeader('Allow', 'GET, PUT, DELETE, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('[api/memories/[id]]', error)
    const message = error instanceof Error ? error.message : String(error)
    return sendJson(res, 500, { error: message })
  }
}
