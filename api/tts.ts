/**
 * #292 /api/tts — server-mediated OpenAI text-to-speech.
 * Specialized audio capability. Not a conversational brain. No Memory/history.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
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
      code: 'misconfigured',
    })
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' })
  }

  const sanitized = sanitizeTtsRequest(body)
  if (!sanitized.ok) {
    return sendJson(res, 400, { error: sanitized.error, code: sanitized.code })
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
      return sendJson(res, 502, { error: 'Empty audio response', code: 'empty_audio' })
    }

    res.statusCode = 200
    res.setHeader('Content-Type', TTS_CONTENT_TYPE)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(bytes)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[api/tts] failed:', errMsg.slice(0, 240))
    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502
        return sendJson(res, status, {
          error: 'Riproduzione vocale non riuscita.',
          code: 'tts_failed',
          type: error.type,
        })
      }
    } catch {
      // fall through
    }
    return sendJson(res, 500, {
      error: 'Riproduzione vocale non riuscita.',
      code: 'tts_failed',
    })
  }
}
