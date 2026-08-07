import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  deleteAllMemories,
  listMemories,
  saveMemory,
} from '../../lib/server/brain-memory.js'
import { errorMessage, parseJsonBody, sendJson } from '../../lib/server/http.js'

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
  }

  if (typeof body.title !== 'string') {
    errors.title = 'title must be a string'
  } else if (!title) {
    errors.title = 'title is required'
  }

  if (typeof body.content !== 'string') {
    errors.content = 'content must be a string'
  } else if (!content) {
    errors.content = 'content is required'
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LAIfe-User-Id')
      return sendJson(res, 200, { success: true })
    }

    if (req.method === 'GET') {
      const category =
        typeof req.query.category === 'string' ? req.query.category.trim() : undefined
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined
      const memories = await listMemories({
        category: category || undefined,
        q: q || undefined,
      })
      return sendJson(res, 200, { success: true, memories })
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
        })
      }
      const deleted = await deleteAllMemories()
      return sendJson(res, 200, { success: true, deleted })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS')
      return sendJson(res, 405, {
        success: false,
        error: 'Method not allowed. Only GET, POST, and DELETE are supported.',
      })
    }

    let body: Record<string, unknown>
    try {
      body = parseJsonBody(req)
    } catch (parseError) {
      console.error('[api/memories] invalid JSON body', parseError)
      return sendJson(res, 400, {
        success: false,
        error: 'Invalid JSON body',
      })
    }

    const validated = validateMemoryCreate(body)
    if (!validated.ok) {
      console.error('[api/memories] validation failed', validated.errors)
      return sendJson(res, 400, {
        success: false,
        error: 'Validation failed',
        errors: validated.errors,
      })
    }

    await saveMemory({
      ...validated.data,
      source: 'manual',
    })
    return sendJson(res, 201, { success: true })
  } catch (error) {
    console.error('[api/memories]', error)
    if (res.headersSent) return undefined
    return sendJson(res, 500, {
      success: false,
      error: errorMessage(error),
    })
  }
}
