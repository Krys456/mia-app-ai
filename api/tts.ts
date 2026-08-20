/**
 * #292 /api/tts — server-mediated OpenAI text-to-speech.
 * Specialized audio capability. Not a conversational brain. No Memory/history.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, finalizeBinaryResponse, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'
import {
  TTS_CONTENT_TYPE,
  TTS_MODEL,
  TTS_RESPONSE_FORMAT,
  sanitizeTtsRequest,
} from '../lib/server/tts-speech.js'

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
  // #332C — voice entitlement between auth and rate-limit (OFF by default).
  const access = await requirePaidApiAccess(req, res, { bucket: 'tts', entitlement: 'voice' })
  if (!access) return

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Riproduzione vocale non riuscita.',
      code: 'misconfigured',
    }, req)
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' }, req)
  }

  const sanitized = sanitizeTtsRequest(body)
  // Explicit discriminant: Vercel backends typecheck does not narrow after `!sanitized.ok`.
  if (sanitized.ok === false) {
    return sendJson(res, 400, { error: sanitized.error, code: sanitized.code }, req)
  }

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const speech = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: sanitized.voice,
      input: sanitized.text,
      response_format: TTS_RESPONSE_FORMAT,
    })
    const bytes = Buffer.from(await speech.arrayBuffer())
    if (!bytes.length) {
      return sendJson(res, 502, { error: 'Empty audio response', code: 'empty_audio' }, req)
    }

    res.statusCode = 200
    res.setHeader('Content-Type', TTS_CONTENT_TYPE)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    finalizeBinaryResponse(res, req, { status: 200, code: 'tts_ok', route: '/api/tts' })
    res.end(bytes)
  } catch (error) {
    console.error('[api/tts] failed:', safeErrorSnippet(error))
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
            error: 'Riproduzione vocale non riuscita.',
            code: 'tts_failed',
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
        error: 'Riproduzione vocale non riuscita.',
        code: 'tts_failed',
      },
      req)
  }
}
