/**
 * Client helper for #290/#291 ephemeral selection Define / Explain / Search.
 * Calls /api/selection — never OpenAI directly. Never writes chat history.
 */

import type { WebCitation } from '../types'
import { resolveChatAuthForRequest } from './chatAuth'

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
    throw new SelectionApiError(
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
