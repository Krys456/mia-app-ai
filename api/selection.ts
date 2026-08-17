/**
 * #290 / #291 /api/selection — ephemeral Define / Explain / Search lookup.
 * Specialized GPT-5.6 call. No chat history, Memory, or sticky LANGUAGE mutation.
 * Define/Explain: no tools. Search: hosted web_search required.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import {
  buildSelectionInput,
  buildSelectionInstructions,
  sanitizeSelectionRequest,
  selectionMaxOutputTokens,
} from '../lib/server/selection-insight.js'
import {
  buildWebSearchTools,
  extractUrlCitations,
  modelSupportsWebSearchTool,
  responseUsedWebSearch,
} from '../lib/server/web-search.js'

export const config = {
  runtime: 'nodejs',
  // Live probe ~7–8s; bump from 30 → 60 for hosted web_search headroom on Search.
  maxDuration: 60,
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
  const isSearch = sanitized.operation === 'search'

  if (isSearch && !modelSupportsWebSearchTool(model)) {
    return sendJson(res, 503, {
      error: 'Live web search is not available for the current model.',
      code: 'web_search_unavailable',
    })
  }

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

  const webTools = isSearch ? buildWebSearchTools(model) : []

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: selectionMaxOutputTokens(sanitized.operation),
        input,
        ...(webTools.length
          ? {
              tools: webTools,
              // Explicit Cerca tap — search is required (no fake model-only "Cerca").
              toolChoice: { type: 'web_search' },
            }
          : {}),
      }),
    )

    const result = response.output_text?.trim() || ''
    const citations = isSearch ? extractUrlCitations(response) : []

    if (isSearch && !responseUsedWebSearch(response) && !result) {
      return sendJson(res, 502, {
        error: 'Non riesco a verificare questa informazione online in questo momento.',
        code: 'web_search_failed',
      })
    }

    if (!result) {
      return sendJson(res, 502, {
        error: isSearch
          ? 'Non riesco a verificare questa informazione online in questo momento.'
          : 'Empty response from OpenAI',
        code: isSearch ? 'web_search_empty' : 'empty_result',
      })
    }

    if (isSearch && !responseUsedWebSearch(response)) {
      // Honesty: never label a parametric answer as a successful Cerca.
      return sendJson(res, 502, {
        error: 'Non riesco a verificare questa informazione online in questo momento.',
        code: 'web_search_missing',
      })
    }

    return sendJson(res, 200, {
      result,
      operation: sanitized.operation,
      runtime: 'selection',
      model,
      ...(citations.length ? { citations } : {}),
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
          error: isSearch
            ? 'Non riesco a verificare questa informazione online in questo momento.'
            : error.message,
          code: isSearch ? 'web_search_error' : error.code,
          type: error.type,
        })
      }
    } catch {
      // fall through
    }
    return sendJson(res, 500, {
      error: isSearch
        ? 'Non riesco a verificare questa informazione online in questo momento.'
        : error instanceof Error
          ? error.message
          : String(error),
      ...(isSearch ? { code: 'web_search_error' } : {}),
    })
  }
}
