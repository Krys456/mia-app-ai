/**
 * Client helper for #292 /api/tts — never calls OpenAI directly.
 */

import { resolveChatAuthForRequest } from './chatAuth'

export class TtsApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'TtsApiError'
    this.status = status
    this.code = code
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
    throw new TtsApiError(
      'Sessione non pronta. Ricarica la pagina e riprova.',
      401,
      'unauthorized',
    )
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
    throw new TtsApiError(raw || 'TTS request failed', 0)
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (!response.ok) {
    let message = `TTS failed (${response.status})`
    let code: string | undefined
    if (contentType.includes('application/json')) {
      try {
        const data = (await response.json()) as { error?: string; code?: string }
        if (typeof data.error === 'string' && data.error.trim()) message = data.error.trim()
        if (typeof data.code === 'string') code = data.code
      } catch {
        /* ignore */
      }
    }
    throw new TtsApiError(message, response.status, code)
  }

  const blob = await response.blob()
  if (!blob.size) {
    throw new TtsApiError('Empty audio response', response.status, 'empty_audio')
  }
  return blob
}
