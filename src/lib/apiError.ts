/**
 * #298C — Small reusable client API error shape (status / code / requestId / retryAfter).
 */

export type ParsedApiErrorBody = {
  error?: string
  code?: string
  requestId?: string
  retryAfter?: number
}

export class ApiClientError extends Error {
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
    this.name = 'ApiClientError'
    this.status = status
    this.code = opts?.code
    this.requestId = opts?.requestId
    this.retryAfter = opts?.retryAfter
  }
}

/** Short user-facing reference from a full request UUID. */
export function shortRequestRef(requestId: string | null | undefined): string | null {
  const compact = String(requestId || '')
    .replace(/-/g, '')
    .toLowerCase()
  if (compact.length >= 8) return compact.slice(0, 8)
  return compact || null
}

/**
 * Parse JSON error body + X-Request-Id header.
 * Never trusts client-spoofed IDs from the request — only response values.
 */
export function parseApiErrorResponse(
  response: Response,
  data: ParsedApiErrorBody | null | undefined,
  fallbackMessage: string,
): {
  message: string
  status: number
  code?: string
  requestId?: string
  retryAfter?: number
} {
  const headerId = response.headers.get('X-Request-Id')?.trim() || ''
  const bodyId =
    data && typeof data.requestId === 'string' ? data.requestId.trim() : ''
  const requestId = bodyId || headerId || undefined

  const code = data && typeof data.code === 'string' && data.code.trim() ? data.code.trim() : undefined
  const message =
    (data && typeof data.error === 'string' && data.error.trim()) || fallbackMessage

  let retryAfter: number | undefined
  if (data && typeof data.retryAfter === 'number' && Number.isFinite(data.retryAfter)) {
    retryAfter = data.retryAfter
  } else {
    const ra = response.headers.get('Retry-After')
    if (ra && /^\d+$/.test(ra.trim())) retryAfter = Number(ra.trim())
  }

  return {
    message,
    status: response.status,
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
    ...(retryAfter != null ? { retryAfter } : {}),
  }
}

/** Append "Riferimento: …" when a requestId is available. */
export function withErrorReference(
  message: string,
  requestId: string | null | undefined,
): string {
  const base = String(message || '').trim() || 'Richiesta non riuscita.'
  const ref = shortRequestRef(requestId)
  if (!ref) return base
  if (base.includes(`Riferimento: ${ref}`)) return base
  return `${base}\nRiferimento: ${ref}`
}

/** Pick requestId from any Error-like object. */
export function readErrorRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const id = (error as { requestId?: unknown }).requestId
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}
