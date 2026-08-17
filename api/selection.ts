/**
 * #290 /api/selection — ephemeral Define / Explain lookup.
 * Specialized GPT-5.6 call. No chat history, Memory, tools, or sticky LANGUAGE mutation.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import {
  SELECTION_MAX_OUTPUT_TOKENS,
  buildSelectionInput,
  buildSelectionInstructions,
  sanitizeSelectionRequest,
} from '../lib/server/selection-insight.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as Record<string, unknown>
  }
  if (typeof req.body === 'object') return req.body as Record<string, unknown>
  return {}
}

function resolveChatModel(env: NodeJS.ProcessEnv = process.env): string {
  const raw = typeof env.OPENAI_MODEL === 'string' ? env.OPENAI_MODEL.trim() : ''
  const normalized = raw.replace(/\bgpt-40\b/gi, 'gpt-4o')
  return normalized || 'gpt-4o'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
    })
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' })
  }

  const sanitized = sanitizeSelectionRequest(body)
  if (!sanitized.ok) {
    return sendJson(res, 400, { error: sanitized.error, code: sanitized.code })
  }

  const model = resolveChatModel(process.env)
  const instructions = buildSelectionInstructions({
    operation: sanitized.operation,
    selectedText: sanitized.selectedText,
    sourceText: sanitized.sourceText,
    replyLanguage: sanitized.replyLanguage,
  })
  const input = buildSelectionInput({
    operation: sanitized.operation,
    selectedText: sanitized.selectedText,
    sourceText: sanitized.sourceText,
  })

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: SELECTION_MAX_OUTPUT_TOKENS,
        input,
        // No tools — especially no image_generation / web_search on this path.
      }),
    )

    const result = response.output_text?.trim() || ''
    if (!result) {
      return sendJson(res, 502, {
        error: 'Empty response from OpenAI',
        code: 'empty_result',
      })
    }

    return sendJson(res, 200, {
      result,
      operation: sanitized.operation,
      runtime: 'selection',
      model,
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[api/selection] failed:', errMsg.slice(0, 240))
    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502
        return sendJson(res, status, {
          error: error.message,
          code: error.code,
          type: error.type,
        })
      }
    } catch {
      // fall through
    }
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
