/**
 * Client helper for #290/#291 ephemeral selection Define / Explain / Search.
 * Calls /api/selection — never OpenAI directly. Never writes chat history.
 */

import type { WebCitation } from '../types'
import { resolveChatAuthForRequest } from './chatAuth'
import {
  parseApiErrorResponse,
  USER_NETWORK_ERROR,
  USER_SESSION_FAILED,
  withErrorReference,
} from './apiError'

export type SelectionOperation = 'define' | 'explain' | 'search'

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
  citations?: WebCitation[]
}

export class SelectionApiError extends Error {
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
    this.name = 'SelectionApiError'
    this.status = status
    this.code = opts?.code
    this.requestId = opts?.requestId
    this.retryAfter = opts?.retryAfter
  }
}

function resolveSelectionEndpoint(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  if (!base) return '/api/selection'
  return `${base.replace(/\/$/, '')}/api/selection`
}

function sanitizeCitations(raw: unknown): WebCitation[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const out: WebCitation[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const urlRaw = typeof row.url === 'string' ? row.url.trim() : ''
    if (!urlRaw) continue
    let url: string
    try {
      const parsed = new URL(urlRaw)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      url = parsed.toString()
    } catch {
      continue
    }
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const title =
      typeof row.title === 'string' && row.title.trim()
        ? row.title.replace(/\s+/g, ' ').trim().slice(0, 160)
        : (() => {
            try {
              return new URL(url).hostname
            } catch {
              return 'Fonte'
            }
          })()
    out.push({ title, url })
    if (out.length >= 5) break
  }
  return out
}

export async function requestSelectionInsight(
  payload: SelectionApiRequest,
  init?: { signal?: AbortSignal },
): Promise<SelectionApiSuccess> {
  const endpoint = resolveSelectionEndpoint()

  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    throw new SelectionApiError(USER_SESSION_FAILED, 401, { code: 'missing_token' })
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: auth.authorization,
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
    const network = /failed to fetch|networkerror|load failed/i.test(raw)
    throw new SelectionApiError(network ? USER_NETWORK_ERROR : raw || USER_NETWORK_ERROR, 0)
  }

  let data: Partial<SelectionApiSuccess> & {
    error?: string
    code?: string
    requestId?: string
    retryAfter?: number
  } = {}
  try {
    const rawText = await response.text()
    if (rawText.trim()) {
      data = JSON.parse(rawText) as typeof data
    }
  } catch {
    const headerId = response.headers.get('X-Request-Id')?.trim() || undefined
    throw new SelectionApiError(
      withErrorReference(
        `Selection API returned invalid JSON (${response.status})`,
        headerId,
      ),
      response.status,
      { requestId: headerId },
    )
  }

  if (!response.ok) {
    const parsed = parseApiErrorResponse(
      response,
      data,
      `Selection API failed (${response.status})`,
    )
    throw new SelectionApiError(withErrorReference(parsed.message, parsed.requestId), parsed.status, {
      code: parsed.code,
      requestId: parsed.requestId,
      retryAfter: parsed.retryAfter,
    })
  }

  const result = typeof data.result === 'string' ? data.result.trim() : ''
  if (!result) {
    throw new SelectionApiError('Selection API returned an empty result', response.status)
  }

  const citations = sanitizeCitations(data.citations)
  const operation =
    data.operation === 'define' || data.operation === 'explain' || data.operation === 'search'
      ? data.operation
      : payload.operation

  return {
    result,
    operation,
    runtime: data.runtime === 'selection' ? 'selection' : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    ...(citations.length ? { citations } : {}),
  }
}
