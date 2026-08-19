/**
 * #311 — Safe Email chat diagnostics payload (Preview / debug only).
 * Never includes tokens, JWT, encryption keys, or full email bodies.
 */

import { isEmailEnabled } from './email-enabled.js'

export const EMAIL_DIAG_BUILD = '311-1'

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isEmailDiagEnvAllowed(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (v === 'preview' || v === 'development') return true
  if (env.EMAIL_DIAG === '1' || env.EMAIL_DIAG === 'true') return true
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any }} req
 * @param {Record<string, unknown>} body
 */
export function isEmailDiagRequested(req, body) {
  try {
    const h = req?.headers || {}
    const header =
      h['x-shinkaido-email-diag'] || h['X-Shinkaido-Email-Diag'] || h['x-shinkaido-calendar-diag']
    if (header === '1' || header === 'true') return true
  } catch {
    /* soft */
  }
  if (body && (body.emailDiag === true || body.emailDiag === 1 || body.emailDiag === '1')) {
    return true
  }
  return false
}

/**
 * @param {string | null | undefined} uid
 */
function maskUid(uid) {
  if (typeof uid !== 'string' || uid.length < 8) return null
  return `${uid.slice(0, 4)}…${uid.slice(-4)}`
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
function resolveServerBuildId(env) {
  const sha = typeof env.VERCEL_GIT_COMMIT_SHA === 'string' ? env.VERCEL_GIT_COMMIT_SHA.trim() : ''
  if (sha) return sha.slice(0, 7)
  if (typeof env.VITE_BUILD_ID === 'string' && env.VITE_BUILD_ID.trim()) return env.VITE_BUILD_ID.trim()
  return 'dev'
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   correlationId?: string | null
 *   authUserId?: string | null
 *   enrichment: Record<string, unknown>
 * }} input
 */
export function buildChatEmailDiagPayload(input) {
  const env = input.env || process.env
  const e = input.enrichment || {}
  const requestId = input.correlationId || null
  return {
    diagBuild: EMAIL_DIAG_BUILD,
    phase: 'email-chat',
    timestamp: new Date().toISOString(),
    correlationId: requestId,
    requestId,
    buildId: resolveServerBuildId(env),
    vercelEnv: typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : null,
    runtimeEmailEnabled: isEmailEnabled(env),
    authUid: maskUid(input.authUserId),
    intent: typeof e.intent === 'string' ? e.intent : null,
    operation: typeof e.operation === 'string' ? e.operation : e.emailOperation || null,
    used: Boolean(e.used),
    rowFound: e.rowFound == null ? null : Boolean(e.rowFound),
    tokenDecrypt: typeof e.tokenDecrypt === 'string' ? e.tokenDecrypt : null,
    tokenRefreshAttempted:
      e.tokenRefreshAttempted == null ? null : Boolean(e.tokenRefreshAttempted),
    googleRequestReached: e.googleRequestReached == null ? null : Boolean(e.googleRequestReached),
    googleHttpStatus: typeof e.googleHttpStatus === 'number' ? e.googleHttpStatus : null,
    resultCount: typeof e.resultCount === 'number' ? e.resultCount : null,
    packStatus: typeof e.packStatus === 'string' ? e.packStatus : e.status || null,
    emailContextSent: e.emailContextSent == null ? null : Boolean(e.emailContextSent),
    preGoogleFailureCode:
      typeof e.preGoogleFailureCode === 'string' ? e.preGoogleFailureCode : null,
    durationMs: typeof e.durationMs === 'number' ? e.durationMs : null,
  }
}
