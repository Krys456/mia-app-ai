import type { VercelRequest, VercelResponse } from '@vercel/node'
import { MemoryPipeline } from '../server/memory/MemoryPipeline'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

const pipeline = new MemoryPipeline()

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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, {
      success: false,
      error: 'Method not allowed. Only POST is supported.',
    })
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, {
      success: false,
      error: 'Invalid JSON body',
    })
  }

  const errors: Record<string, string> = {}
  const userMessage =
    typeof body.userMessage === 'string' ? body.userMessage.trim() : ''
  const assistantMessage =
    typeof body.assistantMessage === 'string' ? body.assistantMessage.trim() : ''

  if (typeof body.userMessage !== 'string') {
    errors.userMessage = 'userMessage must be a string'
  } else if (!userMessage) {
    errors.userMessage = 'userMessage is required'
  }

  if (typeof body.assistantMessage !== 'string') {
    errors.assistantMessage = 'assistantMessage must be a string'
  } else if (!assistantMessage) {
    errors.assistantMessage = 'assistantMessage is required'
  }

  if (Object.keys(errors).length > 0) {
    return sendJson(res, 400, {
      success: false,
      error: 'Validation failed',
      errors,
    })
  }

  try {
    const result = await pipeline.run({
      userMessage,
      assistantMessage,
    })

    return sendJson(res, 200, {
      saved: result.saved,
      decision: result.decision,
    })
  } catch (error) {
    console.error('[api/memory-test]', error)
    const message = error instanceof Error ? error.message : String(error)
    return sendJson(res, 500, {
      success: false,
      error: message,
    })
  }
}
