import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runMemoryPipeline } from '../lib/server/brain-memory.js'
import {
  applyCors,
  errorMessage,
  parseJsonBody,
  sendCorsPreflight,
  sendJson,
} from '../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res)

    if (req.method === 'OPTIONS') {
      return sendCorsPreflight(res)
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
      body = parseJsonBody(req)
    } catch (parseError) {
      console.error('[api/memory-test] invalid JSON body', parseError)
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

    const result = await runMemoryPipeline({
      userMessage,
      assistantMessage,
      memoryEnabled: body.memoryEnabled !== false,
    })
    return sendJson(res, 200, {
      saved: result.saved,
      updated: result.updated === true,
      skipped: result.skipped === true,
      decision: result.decision,
    })
  } catch (error) {
    console.error('[api/memory-test]', error)
    if (res.headersSent) return undefined
    return sendJson(res, 500, {
      success: false,
      error: errorMessage(error),
    })
  }
}
