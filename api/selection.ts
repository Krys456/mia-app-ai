/**
 * #290 / #291 /api/selection — ephemeral Define / Explain / Search lookup.
 * #322 — also serves /api/translation (rewrite) as constrained translation.
 * Specialized GPT call. No chat history, Memory, or sticky LANGUAGE mutation.
 * Define/Explain/Translate: no tools. Search: hosted web_search required.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'
import { applyCors, sendCorsPreflight, sendJson, SAFE_UPSTREAM_ERROR } from '../lib/server/http.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import {
  decideRouteEntitlementAsync,
  loadUserEntitlementsAsync,
} from '../lib/server/entitlement-gates.js'
import { resolveEntitledChatModel } from '../lib/server/chat-model.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'
import { getRequestContext } from '../lib/server/request-id.js'
import {
  buildSelectionInput,
  buildSelectionInstructions,
  sanitizeSelectionRequest,
  selectionMaxOutputTokens,
} from '../lib/server/selection-insight.js'
import {
  buildTranslationInput,
  buildTranslationInstructions,
  cleanTranslationOutput,
  sanitizeTranslationRequest,
  TRANSLATION_MAX_OUTPUT_TOKENS,
} from '../lib/server/translation-engine.js'
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

function isTranslationBody(body: Record<string, unknown>): boolean {
  if (body.operation === 'translate' || body.runtime === 'translation') return true
  // /api/translation rewrite: has targetLanguage + text, no selection operation
  if (typeof body.targetLanguage === 'string' && typeof body.text === 'string') {
    if (body.operation == null || body.operation === 'translate') return true
  }
  return false
}

async function handleTranslation(
  req: VercelRequest,
  res: VercelResponse,
  body: Record<string, unknown>,
  apiKey: string,
  model: string,
) {
  const sanitized = sanitizeTranslationRequest(body)
  if (sanitized.ok === false) {
    return sendJson(
      res,
      400,
      {
        status: sanitized.code,
        failureCode: sanitized.code,
        error: sanitized.error,
      },
      req,
    )
  }

  const text = sanitized.text
  const targetLanguage = sanitized.targetLanguage
  const sourceLanguage = sanitized.sourceLanguage
  const mode = sanitized.mode

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions: buildTranslationInstructions({
          targetLanguage,
          sourceLanguage,
          mode,
        }),
        maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        input: buildTranslationInput({ text }),
        temperature: 0.2,
      }),
    )

    const translatedText = cleanTranslationOutput(response.output_text || '')
    if (!translatedText) {
      return sendJson(
        res,
        502,
        { status: 'provider_error', failureCode: 'empty_result', model },
        req,
      )
    }

    console.info(
      '[translation-action]',
      JSON.stringify({
        route: 'translation-action',
        status: 'ok',
        targetLanguage: targetLanguage.slice(0, 32),
        mode,
        inputLengthBucket:
          text.length <= 40
            ? 'xs'
            : text.length <= 200
              ? 's'
              : text.length <= 800
                ? 'm'
                : text.length <= 2000
                  ? 'l'
                  : 'xl',
        model,
        provider: 'openai',
      }),
    )

    return sendJson(
      res,
      200,
      {
        status: 'ok',
        translatedText,
        detectedSourceLanguage: sourceLanguage === 'auto' ? 'auto' : sourceLanguage,
        targetLanguage,
        mode,
        model,
        runtime: 'translation',
      },
      req,
    )
  } catch (error) {
    console.error('[api/translation] failed:', safeErrorSnippet(error))
    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502
        return sendJson(
          res,
          status,
          { status: 'provider_error', failureCode: 'upstream_ai_error', model },
          req,
        )
      }
    } catch {
      /* fall through */
    }
    return sendJson(
      res,
      500,
      { status: 'provider_error', failureCode: 'provider_error', model },
      req,
    )
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' }, req)
  }

  // #298A — auth + durable rate limit before OpenAI.
  const access = await requirePaidApiAccess(req, res, { bucket: 'selection' })
  if (!access) return

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: SAFE_UPSTREAM_ERROR,
      code: 'misconfigured',
    }, req)
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' }, req)
  }

  // #388G — authoritative advancedModel resolution (never trust body.model / plan claims).
  const entitlementRequestId = getRequestContext(req as any)?.requestId ?? null
  const entitlementLoad = await loadUserEntitlementsAsync(access.userId)
  const modelResolution = resolveEntitledChatModel({
    entitlements: entitlementLoad.entitlements,
    planId: entitlementLoad.planId,
    resolution: entitlementLoad.reason,
    requestId: entitlementRequestId,
    route: '/api/selection',
    claimedModel: body.model,
  })
  const model = modelResolution.model

  // #322 — /api/translation rewrite lands here.
  if (isTranslationBody(body)) {
    return handleTranslation(req, res, body, apiKey, model)
  }

  const sanitized = sanitizeSelectionRequest(body)
  // Explicit discriminant: Vercel backends typecheck does not narrow after `!sanitized.ok`.
  if (sanitized.ok === false) {
    return sendJson(res, 400, { error: sanitized.error, code: sanitized.code }, req)
  }

  const isSearch = sanitized.operation === 'search'

  // #332C — Search uses hosted web_search; gate before OpenAI (rollout OFF by default).
  // Define/Explain/Translate remain ungated here.
  if (isSearch) {
    const decision = await decideRouteEntitlementAsync({
      userId: access.userId,
      entitlement: 'webSearch',
      entitlements: entitlementLoad.entitlements,
      planId: entitlementLoad.planId as 'free' | 'base' | 'pro',
      requestId: entitlementRequestId,
      route: '/api/selection',
    })
    if (decision.allowed === false && 'body' in decision) {
      const status = decision.reason === 'lookup_unavailable' ? 503 : 403
      return sendJson(res, status, decision.body, req)
    }
  }

  if (isSearch && !modelSupportsWebSearchTool(model)) {
    return sendJson(res, 503, {
      error: 'Live web search is not available for the current model.',
      code: 'web_search_unavailable',
    }, req)
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
      }, req)
    }

    if (!result) {
      return sendJson(res, 502, {
        error: isSearch
          ? 'Non riesco a verificare questa informazione online in questo momento.'
          : 'Empty response from OpenAI',
        code: isSearch ? 'web_search_empty' : 'empty_result',
      }, req)
    }

    if (isSearch && !responseUsedWebSearch(response)) {
      // Honesty: never label a parametric answer as a successful Cerca.
      return sendJson(res, 502, {
        error: 'Non riesco a verificare questa informazione online in questo momento.',
        code: 'web_search_missing',
      }, req)
    }

    return sendJson(res, 200, {
      result,
      operation: sanitized.operation,
      runtime: 'selection',
      model,
      ...(citations.length ? { citations } : {}),
    }, req)
  } catch (error) {
    console.error('[api/selection] failed:', safeErrorSnippet(error))
    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502
        return sendJson(
          res,
          status,
          {
            error: isSearch
              ? 'Non riesco a verificare questa informazione online in questo momento.'
              : SAFE_UPSTREAM_ERROR,
            code: isSearch
              ? 'web_search_error'
              : 'upstream_ai_error',
          },
          req)
      }
    } catch {
      // fall through
    }
    return sendJson(
      res,
      500,
      {
        error: isSearch
          ? 'Non riesco a verificare questa informazione online in questo momento.'
          : SAFE_UPSTREAM_ERROR,
        code: isSearch ? 'web_search_error' : 'upstream_ai_error',
      },
      req)
  }
}
