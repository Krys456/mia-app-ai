import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  deleteMemory,
  getMemoryById,
  updateMemory,
} from '../../lib/server/brain-memory.js'
import { memoryOwnerScope, requireMemoryApiUser } from '../../lib/server/memory-api-auth.js'
import { applyCors, errorMessage, parseJsonBody, sendCorsPreflight, sendJson } from '../../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

function getId(req: VercelRequest): string {
  const raw = req.query.id
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  return ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res)

    if (req.method === 'OPTIONS') {
      return sendCorsPreflight(res)
    }

    const owner = await requireMemoryApiUser(req, res)
    if (!owner) {
      return undefined
    }
    const scope = memoryOwnerScope(owner.userId)

    const id = getId(req)
    if (!id) {
      return sendJson(res, 400, { error: 'Memory id is required' })
    }

    if (req.method === 'GET') {
      const memory = await getMemoryById(id, scope)
      if (!memory) {
        return sendJson(res, 404, { error: 'Memory not found' })
      }
      return sendJson(res, 200, { memory })
    }

    if (req.method === 'PUT') {
      let body: Record<string, unknown>
      try {
        body = parseJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' })
      }

      const category = typeof body.category === 'string' ? body.category.trim() : ''
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content.trim() : ''

      if (!category) {
        return sendJson(res, 400, { error: 'Invalid category' })
      }
      if (!title) {
        return sendJson(res, 400, { error: 'Title is required' })
      }

      // Ignore forged body.userId — scope is JWT-only.
      const memory = await updateMemory(id, { category, title, content }, scope)
      if (!memory) {
        return sendJson(res, 404, { error: 'Memory not found' })
      }
      return sendJson(res, 200, { memory })
    }

    if (req.method === 'DELETE') {
      const ok = await deleteMemory(id, scope)
      if (!ok) {
        return sendJson(res, 404, { error: 'Memory not found' })
      }
      return sendJson(res, 200, { ok: true, id })
    }

    res.setHeader('Allow', 'GET, PUT, DELETE, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('[api/memories/[id]]', error)
    return sendJson(res, 500, { error: errorMessage(error) })
  }
}
