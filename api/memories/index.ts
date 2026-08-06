import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ensureMemoriesTable,
  getSql,
  insertMemory,
  isMemoryCategory,
  listMemoriesForUser,
  sanitizeUserId,
  type MemoryCategory,
} from '../_lib/db'

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

function readUserId(req: VercelRequest): string | null {
  const header = req.headers['x-laife-user-id']
  if (typeof header === 'string') return sanitizeUserId(header)
  if (Array.isArray(header)) return sanitizeUserId(header[0])
  if (typeof req.query.userId === 'string') return sanitizeUserId(req.query.userId)
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LAIfe-User-Id')
    return res.status(204).end()
  }

  const userId = readUserId(req)
  if (!userId) {
    return sendJson(res, 400, { error: 'Missing or invalid X-LAIfe-User-Id' })
  }

  try {
    const sql = getSql()
    await ensureMemoriesTable(sql)

    if (req.method === 'GET') {
      const categoryRaw =
        typeof req.query.category === 'string' ? req.query.category.trim() : ''
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const category = isMemoryCategory(categoryRaw) ? categoryRaw : undefined

      const memories = await listMemoriesForUser(sql, userId, {
        category,
        q: q || undefined,
      })

      return sendJson(res, 200, { memories })
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

      const memory = await insertMemory(sql, {
        userId,
        category: category as MemoryCategory,
        title,
        content,
      })

      return sendJson(res, 201, { memory })
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('[api/memories]', error)
    const message = error instanceof Error ? error.message : String(error)
    return sendJson(res, 500, { error: message })
  }
}
