import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  deleteAllMemories,
  listMemories,
  upsertMemory,
} from '../../lib/server/brain-memory.js'
import { memoryOwnerScope, requireMemoryApiUser } from '../../lib/server/memory-api-auth.js'
import { parseJsonBody, sendCorsPreflight, sendJson, applyCors, SAFE_MEMORY_ERROR } from '../../lib/server/http.js'
import { MEMORY_FIELD_LIMITS } from '../../lib/server/memory-field-limits.js'
import { consumeRateLimit } from '../../lib/server/rate-limit.js'
import { safeErrorSnippet } from '../../lib/server/safe-log.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

type MemoryCreateInput = {
  category: string
  title: string
  content: string
  importance: number
}

type ValidationResult =
  | { ok: true; data: MemoryCreateInput }
  | { ok: false; errors: Record<string, string> }

function validateMemoryCreate(body: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {}

  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''

  if (typeof body.category !== 'string') {
    errors.category = 'category must be a string'
  } else if (!category) {
    errors.category = 'category is required'
  } else if (category.length > MEMORY_FIELD_LIMITS.category) {
    errors.category = `category must be at most ${MEMORY_FIELD_LIMITS.category} characters`
  }

  if (typeof body.title !== 'string') {
    errors.title = 'title must be a string'
  } else if (!title) {
    errors.title = 'title is required'
  } else if (title.length > MEMORY_FIELD_LIMITS.title) {
    errors.title = `title must be at most ${MEMORY_FIELD_LIMITS.title} characters`
  }

  if (typeof body.content !== 'string') {
    errors.content = 'content must be a string'
  } else if (!content) {
    errors.content = 'content is required'
  } else if (content.length > MEMORY_FIELD_LIMITS.content) {
    errors.content = `content must be at most ${MEMORY_FIELD_LIMITS.content} characters`
  }

  let importance: number | null = null
  if (typeof body.importance === 'number' && Number.isFinite(body.importance)) {
    importance = body.importance
  } else if (typeof body.importance === 'string' && body.importance.trim()) {
    const parsed = Number(body.importance)
    if (Number.isFinite(parsed)) importance = parsed
  }

  if (importance === null) {
    errors.importance = 'importance must be a number between 1 and 10'
  } else if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    errors.importance = 'importance must be an integer between 1 and 10'
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      category,
      title,
      content,
      importance: importance as number,
    },
  }
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
        success: false,
        error: 'Rate limit service unavailable. Retry shortly.',
        code: 'rate_limit_unavailable',
        retryAfter: limited.retryAfter,
      },
      req)
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
        success: false,
        error: 'rate_limit_exceeded',
        code: 'rate_limit_exceeded',
        retryAfter: limited.retryAfter,
      },
      req)
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

    if (req.method === 'GET') {
      const category =
        typeof req.query.category === 'string' ? req.query.category.trim() : undefined
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined
      if (category && category.length > MEMORY_FIELD_LIMITS.category) {
        return sendJson(res, 400, {
          success: false,
          error: 'Validation failed',
          errors: {
            category: `category must be at most ${MEMORY_FIELD_LIMITS.category} characters`,
          },
        }, req)
      }
      if (q && q.length > MEMORY_FIELD_LIMITS.content) {
        return sendJson(res, 400, {
          success: false,
          error: 'Validation failed',
          errors: { q: `q must be at most ${MEMORY_FIELD_LIMITS.content} characters` },
        }, req)
      }
      const memories = await listMemories({
        ...scope,
        category: category || undefined,
        q: q || undefined,
      })
      return sendJson(res, 200, { success: true, memories }, req)
    }

    if (req.method === 'DELETE') {
      const clear =
        req.query.clear === '1' ||
        req.query.clear === 'true' ||
        req.query.all === '1' ||
        req.query.all === 'true'
      if (!clear) {
        return sendJson(res, 400, {
          success: false,
          error: 'Pass ?clear=1 to delete all memories',
        }, req)
      }
      const deleted = await deleteAllMemories(scope)
      return sendJson(res, 200, { success: true, deleted }, req)
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS')
      return sendJson(res, 405, {
        success: false,
        error: 'Method not allowed. Only GET, POST, and DELETE are supported.',
      }, req)
    }

    let body: Record<string, unknown>
    try {
      body = parseJsonBody(req)
    } catch (parseError) {
      console.error('[api/memories] invalid JSON body', parseError)
      return sendJson(res, 400, {
        success: false,
        error: 'Invalid JSON body',
      }, req)
    }

    const validated = validateMemoryCreate(body)
    if (!validated.ok) {
      console.error('[api/memories] validation failed', validated.errors)
      return sendJson(res, 400, {
        success: false,
        error: 'Validation failed',
        errors: validated.errors,
      }, req)
    }

    // Ignore forged body.userId — ownership comes only from verified JWT.
    // Use upsertMemory so single-valued fact_key writes cannot create duplicate actives.
    await upsertMemory({
      ...validated.data,
      source: 'manual',
      userId: owner.userId,
      requireExplicitUserId: true,
    })
    return sendJson(res, 201, { success: true }, req)
  } catch (error) {
    console.error('[api/memories]', safeErrorSnippet(error))
    if (res.headersSent) return undefined
    return sendJson(res, 500, {
      success: false,
      error: SAFE_MEMORY_ERROR,
      code: 'memory_error',
    }, req)
  }
}
