import type { VercelRequest, VercelResponse } from '@vercel/node'

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

function sendJson(res: VercelResponse, status: number, payload: Record<string, unknown>) {
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
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(200).json({ success: true })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      return sendJson(res, 500, {
        success: false,
        error: 'Method not allowed. Only POST is supported.',
      })
    }

    let body: Record<string, unknown>
    try {
      body = parseBody(req)
    } catch (parseError) {
      console.error('[api/memories] invalid JSON body', parseError)
      return sendJson(res, 500, {
        success: false,
        error: 'Invalid JSON body',
      })
    }

    const validated = validateMemoryCreate(body)
    if (!validated.ok) {
      console.error('[api/memories] validation failed', validated.errors)
      return sendJson(res, 500, {
        success: false,
        error: 'Validation failed',
        errors: validated.errors,
      })
    }

    const { MemoryService } = await import('../../server/memory/MemoryService')
    const memoryService = new MemoryService()
    await memoryService.saveMemory(validated.data)

    return sendJson(res, 201, { success: true })
  } catch (error) {
    console.error('[api/memories]', error)
    const message = error instanceof Error ? error.message : String(error)

    if (res.headersSent) {
      return undefined
    }

    return sendJson(res, 500, {
      success: false,
      error: message,
    })
  }
}
