/**
 * #322 /api/translation — dedicated constrained OpenAI translation.
 * No tools. SOURCE_TEXT is untrusted data.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'
import { applyCors, sendCorsPreflight, sendJson, SAFE_UPSTREAM_ERROR } from '../lib/server/http.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import {
  buildTranslationInput,
  buildTranslationInstructions,
  cleanTranslationOutput,
  sanitizeTranslationRequest,
  TRANSLATION_MAX_OUTPUT_TOKENS,
} from '../lib/server/translation-engine.js'

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
  applyCors(res, req)
  const obs = ensureRequestContext(req as any, res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method_not_allowed' }, req)
  }

  const access = await requirePaidApiAccess(req, res, { bucket: 'translation' })
  if (!access) return

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(
      res,
      500,
      { status: 'provider_error', failureCode: 'misconfigured', error: SAFE_UPSTREAM_ERROR },
      req,
    )
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { status: 'invalid_request', failureCode: 'invalid_body', error: 'Invalid JSON body' }, req)
  }

  const sanitized = sanitizeTranslationRequest(body)
  if (sanitized.ok === false) {
    return sendJson(
      res,
      400,
      {
        status: sanitized.code,
        failureCode: sanitized.code,
        error: sanitized.error,
        requestId: obs.requestId,
      },
      req,
    )
  }

  const text = sanitized.text
  const targetLanguage = sanitized.targetLanguage
  const sourceLanguage = sanitized.sourceLanguage
  const mode = sanitized.mode

  const model = resolveChatModel(process.env)
  const instructions = buildTranslationInstructions({
    targetLanguage,
    sourceLanguage,
    mode,
  })
  const input = buildTranslationInput({ text })

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        input,
        // Low variance for translation consistency (omitted on GPT-5.6 family).
        temperature: 0.2,
      }),
    )

    const translatedText = cleanTranslationOutput(response.output_text || '')
    if (!translatedText) {
      return sendJson(
        res,
        502,
        {
          status: 'provider_error',
          failureCode: 'empty_result',
          requestId: obs.requestId,
          model,
        },
        req,
      )
    }

    console.info(
      '[translation-action]',
      JSON.stringify({
        route: 'translation-action',
        requestId: obs.requestId,
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
        requestId: obs.requestId,
      },
      req,
    )
  } catch (error) {
    console.warn(
      '[translation-action]',
      JSON.stringify({
        route: 'translation-action',
        requestId: obs.requestId,
        status: 'provider_error',
        error: safeErrorSnippet(error),
      }),
    )
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
            status: 'provider_error',
            failureCode: 'upstream_ai_error',
            requestId: obs.requestId,
            model,
          },
          req,
        )
      }
    } catch {
      /* fall through */
    }
    return sendJson(
      res,
      500,
      {
        status: 'provider_error',
        failureCode: 'provider_error',
        requestId: obs.requestId,
        model,
      },
      req,
    )
  }
}
