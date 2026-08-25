/**
 * #386C — Client account deletion API (Bearer JWT; never sends target user_id).
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'

function apiBase(): string {
  const raw =
    typeof import.meta !== 'undefined' &&
    typeof (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env
      ?.VITE_API_BASE_URL === 'string'
      ? (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env!
          .VITE_API_BASE_URL!.trim()
      : ''
  return raw.replace(/\/+$/, '')
}

export type AccountDeletionResult =
  | { ok: true; code: string; alreadyCompleted: boolean; jobId?: string; requestId?: string }
  | {
      ok: false
      code: string
      message: string
      retryable: boolean
      status: number
      requestId?: string
    }

/**
 * Typed confirmation must be ELIMINA (IT) or DELETE (EN).
 */
export function isValidDeletionConfirmation(raw: string): boolean {
  const t = typeof raw === 'string' ? raw.trim() : ''
  return t === 'ELIMINA' || t === 'DELETE'
}

export async function requestAccountDeletion(
  confirmation: string,
): Promise<AccountDeletionResult> {
  if (!isValidDeletionConfirmation(confirmation)) {
    return {
      ok: false,
      code: 'confirmation_invalid',
      message: 'Digita ELIMINA o DELETE per confermare.',
      retryable: false,
      status: 400,
    }
  }

  const { authorization } = await resolveChatAuthForRequest()
  if (!authorization) {
    return {
      ok: false,
      code: 'unauthorized',
      message: 'Sessione non pronta. Riprova tra poco.',
      retryable: true,
      status: 401,
    }
  }

  const base = apiBase()
  const url = `${base}/api/account/delete`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: confirmation.trim() }),
    })
  } catch {
    return {
      ok: false,
      code: 'network_error',
      message: 'Impossibile contattare il server. Riprova.',
      retryable: true,
      status: 0,
    }
  }

  const requestId = res.headers.get('x-request-id') || undefined
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    /* soft */
  }

  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : 'deletion_failed'
    const message =
      typeof body.error === 'string'
        ? body.error
        : 'Eliminazione non completata. Puoi riprovare.'
    return {
      ok: false,
      code,
      message,
      retryable: body.retryable === true || res.status >= 500 || res.status === 429,
      status: res.status,
      requestId,
    }
  }

  return {
    ok: true,
    code: typeof body.code === 'string' ? body.code : 'deleted',
    alreadyCompleted: Boolean(body.alreadyCompleted),
    jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
    requestId,
  }
}

/**
 * Client UI kill switch. Default ON.
 */
export function isAccountDeletionUiEnabled(
  env: { VITE_ACCOUNT_DELETION_ENABLED?: unknown } | undefined = typeof import.meta !==
  'undefined'
    ? (import.meta as ImportMeta & { env?: { VITE_ACCOUNT_DELETION_ENABLED?: unknown } }).env
    : undefined,
): boolean {
  const raw =
    typeof env?.VITE_ACCOUNT_DELETION_ENABLED === 'string'
      ? env.VITE_ACCOUNT_DELETION_ENABLED.trim().toLowerCase()
      : ''
  if (!raw) return true
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no')
}
