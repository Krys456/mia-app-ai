import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  deleteMemory,
  getMemoryById,
  updateMemory,
} from '../../lib/server/brain-memory.js'
import { memoryOwnerScope, requireMemoryApiUser } from '../../lib/server/memory-api-auth.js'
import { applyCors, errorMessage, parseJsonBody, sendCorsPreflight, sendJson } from '../../lib/server/http.js'
import { MEMORY_FIELD_LIMITS } from '../../lib/server/memory-field-limits.js'
import { consumeRateLimit } from '../../lib/server/rate-limit.js'

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

async function enforceMemoryRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  userId: string,
): Promise<boolean> {
  const limited = await consumeRateLimit({ userId, bucket: 'memories' })
  if ('unavailable' in limited && limited.unavailable) {
    if (limited.retryAfter > 0) {
      res.setHeader('Retry-After', String(limited.retryAfter))
    }
    sendJson(
      res,
      503,
      {
        error: 'Rate limit service unavailable. Retry shortly.',
        code: 'rate_limit_unavailable',
        retryAfter: limited.retryAfter,
      },
      req,
    )
    return false
  }
  if (!limited.success) {
    if (limited.retryAfter > 0) {
      res.setHeader('Retry-After', String(limited.retryAfter))
    }
    sendJson(
      res,
      429,
      {
        error: 'rate_limit_exceeded',
        code: 'rate_limit_exceeded',
        retryAfter: limited.retryAfter,
      },
      req,
    )
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res, req)

    if (req.method === 'OPTIONS') {
      return sendCorsPreflight(res, req)
    }

    const owner = await requireMemoryApiUser(req, res)
    if (!owner) {
      return undefined
    }

    if (!(await enforceMemoryRateLimit(req, res, owner.userId))) {
      return undefined
    }

    const scope = memoryOwnerScope(owner.userId)

    const id = getId(req)
    if (!id) {
      return sendJson(res, 400, { error: 'Memory id is required' }, req)
    }
    if (id.length > 128) {
      return sendJson(res, 400, { error: 'Memory id is invalid' }, req)
    }

    if (req.method === 'GET') {
      const memory = await getMemoryById(id, scope)
      if (!memory) {
        return sendJson(res, 404, { error: 'Memory not found' }, req)
      }
      return sendJson(res, 200, { memory }, req)
    }

    if (req.method === 'PUT') {
      let body: Record<string, unknown>
      try {
        body = parseJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' }, req)
      }

      const category = typeof body.category === 'string' ? body.category.trim() : ''
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content.trim() : ''

      if (!category) {
        return sendJson(res, 400, { error: 'Invalid category' }, req)
      }
      if (category.length > MEMORY_FIELD_LIMITS.category) {
        return sendJson(
          res,
          400,
          {
            error: 'Validation failed',
            errors: {
              category: `category must be at most ${MEMORY_FIELD_LIMITS.category} characters`,
            },
          },
          req,
        )
      }
      if (!title) {
        return sendJson(res, 400, { error: 'Title is required' }, req)
      }
      if (title.length > MEMORY_FIELD_LIMITS.title) {
        return sendJson(
          res,
          400,
          {
            error: 'Validation failed',
            errors: {
              title: `title must be at most ${MEMORY_FIELD_LIMITS.title} characters`,
            },
          },
          req,
        )
      }
      if (content.length > MEMORY_FIELD_LIMITS.content) {
        return sendJson(
          res,
          400,
          {
            error: 'Validation failed',
            errors: {
              content: `content must be at most ${MEMORY_FIELD_LIMITS.content} characters`,
            },
          },
          req,
        )
      }

      // Ignore forged body.userId — scope is JWT-only.
      const memory = await updateMemory(id, { category, title, content }, scope)
      if (!memory) {
        return sendJson(res, 404, { error: 'Memory not found' }, req)
      }
      return sendJson(res, 200, { memory }, req)
    }

    if (req.method === 'DELETE') {
      const ok = await deleteMemory(id, scope)
      if (!ok) {
        return sendJson(res, 404, { error: 'Memory not found' }, req)
      }
      return sendJson(res, 200, { ok: true, id }, req)
    }

    res.setHeader('Allow', 'GET, PUT, DELETE, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' }, req)
  } catch (error) {
    console.error('[api/memories/[id]]', error)
    return sendJson(res, 500, { error: errorMessage(error) }, req)
  }
}
