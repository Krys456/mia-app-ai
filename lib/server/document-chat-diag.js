/**
 * #313 — Safe document-chat diagnostics (Preview / opt-in).
 */

export const DOCUMENT_CHAT_DIAG_BUILD = '313-1'

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isDocumentChatDiagEnvAllowed(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (v === 'preview' || v === 'development') return true
  if (env.DOCUMENT_CHAT_DIAG === '1' || env.DOCUMENT_CHAT_DIAG === 'true') return true
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any }} req
 * @param {Record<string, unknown>} [body]
 */
export function isDocumentChatDiagRequested(req, body) {
  try {
    const h = req?.headers || {}
    const header = h['x-shinkaido-document-diag'] || h['X-Shinkaido-Document-Diag']
    if (header === '1' || header === 'true') return true
  } catch {
    /* soft */
  }
  if (
    body &&
    (body.documentDiag === true || body.documentDiag === 1 || body.documentDiag === '1')
  ) {
    return true
  }
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any }} req
 * @param {Record<string, unknown>} [body]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isDocumentChatDiagEnabled(req, body, env = process.env) {
  return isDocumentChatDiagEnvAllowed(env) && isDocumentChatDiagRequested(req, body)
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
 *   requestId?: string | null
 *   documentAttachedThisTurn?: boolean
 *   activeDocumentFound?: boolean
 *   activeDocumentReused?: boolean
 *   activeFilename?: string | null
 *   activeFileExpired?: boolean
 *   documentReferenceDetected?: boolean
 *   fileIncludedInModelInput?: boolean
 *   modelRequestReached?: boolean
 *   modelResponseReceived?: boolean
 *   failureCode?: string | null
 * }} input
 */
export function buildDocumentChatDiagPayload(input) {
  const env = input.env || process.env
  const name = typeof input.activeFilename === 'string' ? input.activeFilename : ''
  return {
    diagBuild: DOCUMENT_CHAT_DIAG_BUILD,
    route: 'document-chat',
    phase: 'document-chat',
    timestamp: new Date().toISOString(),
    requestId: input.requestId || null,
    buildId: resolveServerBuildId(env),
    documentAttachedThisTurn: Boolean(input.documentAttachedThisTurn),
    activeDocumentFound: Boolean(input.activeDocumentFound),
    activeDocumentReused: Boolean(input.activeDocumentReused),
    activeFilename: name ? name.slice(0, 80) : null,
    activeFileExpired: Boolean(input.activeFileExpired),
    documentReferenceDetected: Boolean(input.documentReferenceDetected),
    fileIncludedInModelInput: Boolean(input.fileIncludedInModelInput),
    modelRequestReached: Boolean(input.modelRequestReached),
    modelResponseReceived: Boolean(input.modelResponseReceived),
    failureCode: typeof input.failureCode === 'string' ? input.failureCode.slice(0, 64) : null,
  }
}
