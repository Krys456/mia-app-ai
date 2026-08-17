/**
 * Client helper for #292 /api/tts — never calls OpenAI directly.
 */

import { resolveChatAuthForRequest } from './chatAuth'
import {
  parseApiErrorResponse,
  USER_NETWORK_ERROR,
  USER_SESSION_FAILED,
  withErrorReference,
} from './apiError'

export class TtsApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string
  readonly retryAfter?: number

  constructor(
    message: string,
    status: number,
    opts?: { code?: string; requestId?: string; retryAfter?: number },
  ) {
    super(message)
    this.name = 'TtsApiError'
    this.status = status
    this.code = opts?.code
    this.requestId = opts?.requestId
    this.retryAfter = opts?.retryAfter
  }
}

function resolveTtsEndpoint(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  if (!base) return '/api/tts'
  return `${base.replace(/\/$/, '')}/api/tts`
}

/**
 * Request spoken audio for assistant text. Returns a Blob (audio/mpeg).
 */
export async function requestSpeechAudio(
  text: string,
  init?: { signal?: AbortSignal; voice?: string },
): Promise<Blob> {
  const endpoint = resolveTtsEndpoint()

  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    throw new TtsApiError(USER_SESSION_FAILED, 401, { code: 'missing_token' })
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg, application/json',
        Authorization: auth.authorization,
      },
      credentials: 'include',
      body: JSON.stringify({
        text,
        ...(init?.voice ? { voice: init.voice } : {}),
      }),
      signal: init?.signal,
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const network = /failed to fetch|networkerror|load failed/i.test(raw)
    throw new TtsApiError(network ? USER_NETWORK_ERROR : raw || USER_NETWORK_ERROR, 0)
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (!response.ok) {
    let data: { error?: string; code?: string; requestId?: string; retryAfter?: number } = {}
    if (contentType.includes('application/json')) {
      try {
        data = (await response.json()) as typeof data
      } catch {
        /* ignore */
      }
    }
    const parsed = parseApiErrorResponse(
      response,
      data,
      `TTS failed (${response.status})`,
    )
    throw new TtsApiError(withErrorReference(parsed.message, parsed.requestId), parsed.status, {
      code: parsed.code,
      requestId: parsed.requestId,
      retryAfter: parsed.retryAfter,
    })
  }

  const blob = await response.blob()
  if (!blob.size) {
    const headerId = response.headers.get('X-Request-Id')?.trim() || undefined
    throw new TtsApiError(
      withErrorReference('Empty audio response', headerId),
      response.status,
      { code: 'empty_audio', requestId: headerId },
    )
  }
  return blob
}
