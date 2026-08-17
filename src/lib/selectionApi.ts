/**
 * Client helper for #290 ephemeral selection Define / Explain.
 * Calls /api/selection — never OpenAI directly. Never writes chat history.
 */

export type SelectionOperation = 'define' | 'explain'

export interface SelectionApiRequest {
  operation: SelectionOperation
  selectedText: string
  sourceText?: string
  replyLanguage?: string
  browserLocale?: string
  conversationLanguage?: string
}

export interface SelectionApiSuccess {
  result: string
  operation?: SelectionOperation
  runtime?: 'selection'
  model?: string
}

export class SelectionApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'SelectionApiError'
    this.status = status
    this.code = code
  }
}

function resolveSelectionEndpoint(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  if (!base) return '/api/selection'
  return `${base.replace(/\/$/, '')}/api/selection`
}

export async function requestSelectionInsight(
  payload: SelectionApiRequest,
  init?: { signal?: AbortSignal },
): Promise<SelectionApiSuccess> {
  const endpoint = resolveSelectionEndpoint()
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        operation: payload.operation,
        selectedText: payload.selectedText,
        ...(payload.sourceText ? { sourceText: payload.sourceText } : {}),
        ...(payload.replyLanguage ? { replyLanguage: payload.replyLanguage } : {}),
        ...(payload.conversationLanguage
          ? { conversationLanguage: payload.conversationLanguage }
          : {}),
        ...(payload.browserLocale ? { browserLocale: payload.browserLocale } : {}),
      }),
      signal: init?.signal,
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    throw new SelectionApiError(raw || 'Selection request failed', 0)
  }

  let data: Partial<SelectionApiSuccess> & { error?: string; code?: string } = {}
  try {
    const rawText = await response.text()
    if (rawText.trim()) {
      data = JSON.parse(rawText) as typeof data
    }
  } catch {
    throw new SelectionApiError(
      `Selection API returned invalid JSON (${response.status})`,
      response.status,
    )
  }

  if (!response.ok) {
    throw new SelectionApiError(
      (typeof data.error === 'string' && data.error.trim()) ||
        `Selection API failed (${response.status})`,
      response.status,
      typeof data.code === 'string' ? data.code : undefined,
    )
  }

  const result = typeof data.result === 'string' ? data.result.trim() : ''
  if (!result) {
    throw new SelectionApiError('Selection API returned an empty result', response.status)
  }

  return {
    result,
    operation:
      data.operation === 'define' || data.operation === 'explain' ? data.operation : payload.operation,
    runtime: data.runtime === 'selection' ? 'selection' : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
  }
}
