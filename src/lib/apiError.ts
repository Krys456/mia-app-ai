/**
 * #298C#298D — Small reusable client API error shape + Italian recovery copy.
 * #332B — entitlement_required mapping (non-authoritative UX only).
 */

import { userFacingEntitlementMessage } from './entitlementsUi'

export type ParsedApiErrorBody = {
  error?: string
  code?: string
  requestId?: string
  retryAfter?: number
  entitlement?: string
  requiredPlan?: string
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

export const USER_NETWORK_ERROR =
  'Connessione non disponibile. Controlla la rete e riprova.'

export const USER_SESSION_PREPARING =
  'ShinkAIdo sta preparando la sessione. Attendi un momento e riprova.'

export const USER_SESSION_FAILED =
  "Non è stato possibile preparare la sessione. Ricarica l'app e riprova."

/**
 * Map known machine codes / English server strings to Italian user copy.
 * Preserves unknown safe messages. Never invents a requestId.
 */
export function userFacingApiMessage(input: {
  code?: string | null
  message?: string | null
  retryAfter?: number | null
  entitlement?: string | null
  requiredPlan?: string | null
}): string {
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  const raw = typeof input.message === 'string' ? input.message.trim() : ''
  const retryAfter =
    typeof input.retryAfter === 'number' && Number.isFinite(input.retryAfter)
      ? Math.max(0, Math.ceil(input.retryAfter))
      : 0

  if (code === 'entitlement_required' || raw === 'entitlement_required') {
    return userFacingEntitlementMessage({
      entitlement: input.entitlement,
      requiredPlan: input.requiredPlan,
    })
  }

  if (code === 'rate_limit_exceeded' || raw === 'rate_limit_exceeded') {
    if (retryAfter > 0 && retryAfter <= 3600) {
      return `Hai effettuato molte richieste in poco tempo. Riprova tra circa ${retryAfter} secondi.`
    }
    return 'Hai effettuato molte richieste in poco tempo. Riprova tra poco.'
  }

  if (
    code === 'rate_limit_unavailable' ||
    /rate limit service unavailable/i.test(raw)
  ) {
    return 'Il servizio è temporaneamente occupato. Riprova tra poco.'
  }

  return raw || 'Richiesta non riuscita.'
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
  entitlement?: string
  requiredPlan?: string
} {
  const headerId = response.headers.get('X-Request-Id')?.trim() || ''
  const bodyId =
    data && typeof data.requestId === 'string' ? data.requestId.trim() : ''
  const requestId = bodyId || headerId || undefined

  const code =
    data && typeof data.code === 'string' && data.code.trim() ? data.code.trim() : undefined

  const entitlement =
    data && typeof data.entitlement === 'string' && data.entitlement.trim()
      ? data.entitlement.trim()
      : undefined
  const requiredPlan =
    data && typeof data.requiredPlan === 'string' && data.requiredPlan.trim()
      ? data.requiredPlan.trim()
      : undefined

  let retryAfter: number | undefined
  if (data && typeof data.retryAfter === 'number' && Number.isFinite(data.retryAfter)) {
    retryAfter = data.retryAfter
  } else {
    const ra = response.headers.get('Retry-After')
    if (ra && /^\d+$/.test(ra.trim())) retryAfter = Number(ra.trim())
  }

  const rawMessage =
    (data && typeof data.error === 'string' && data.error.trim()) || fallbackMessage

  const message = userFacingApiMessage({
    code,
    message: rawMessage,
    retryAfter,
    entitlement,
    requiredPlan,
  })

  return {
    message,
    status: response.status,
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
    ...(retryAfter != null ? { retryAfter } : {}),
    ...(entitlement ? { entitlement } : {}),
    ...(requiredPlan ? { requiredPlan } : {}),
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
