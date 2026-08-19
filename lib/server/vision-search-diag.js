/**
 * #312 — Safe Vision × Search diagnostics (Preview / opt-in only).
 */

export const VISION_SEARCH_DIAG_BUILD = '312-1'

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isVisionSearchDiagEnvAllowed(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (v === 'preview' || v === 'development') return true
  if (env.VISION_SEARCH_DIAG === '1' || env.VISION_SEARCH_DIAG === 'true') return true
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any }} req
 * @param {Record<string, unknown>} [body]
 */
export function isVisionSearchDiagRequested(req, body) {
  try {
    const h = req?.headers || {}
    const header = h['x-shinkaido-vision-search-diag'] || h['X-Shinkaido-Vision-Search-Diag']
    if (header === '1' || header === 'true') return true
  } catch {
    /* soft */
  }
  if (
    body &&
    (body.visionSearchDiag === true || body.visionSearchDiag === 1 || body.visionSearchDiag === '1')
  ) {
    return true
  }
  return false
}

/**
 * Opt-in Preview/dev diagnostics: env gate + client request (?vision_search_diag=1).
 * @param {import('http').IncomingMessage | { headers?: any }} req
 * @param {Record<string, unknown>} [body]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isVisionSearchDiagEnabled(req, body, env = process.env) {
  return isVisionSearchDiagEnvAllowed(env) && isVisionSearchDiagRequested(req, body)
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
 * Safe query preview (≤80).
 * @param {string} q
 */
function previewQuery(q) {
  const s = String(q || '')
  if (s.length <= 80) return s
  return `${s.slice(0, 79)}…`
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   requestId?: string | null
 *   visionContextFound?: boolean
 *   sourceVisionTurnId?: string | null
 *   visualEntityAvailable?: boolean
 *   visualSearchIntent?: string | null
 *   generatedSearchQuery?: string | null
 *   existingSearchInvoked?: boolean
 *   searchResultCount?: number | null
 *   searchContextSentToModel?: boolean
 *   finalResponseReceived?: boolean
 *   failureCode?: string | null
 *   webSearchUsed?: boolean | null
 * }} input
 */
export function buildVisionSearchDiagPayload(input) {
  const env = input.env || process.env
  return {
    diagBuild: VISION_SEARCH_DIAG_BUILD,
    route: 'vision-search',
    phase: 'vision-search',
    timestamp: new Date().toISOString(),
    requestId: input.requestId || null,
    buildId: resolveServerBuildId(env),
    visionContextFound: Boolean(input.visionContextFound),
    sourceVisionTurnId:
      typeof input.sourceVisionTurnId === 'string'
        ? input.sourceVisionTurnId.slice(0, 64)
        : null,
    visualEntityAvailable: Boolean(input.visualEntityAvailable),
    visualSearchIntent:
      typeof input.visualSearchIntent === 'string' ? input.visualSearchIntent.slice(0, 40) : null,
    generatedSearchQueryPreview: previewQuery(input.generatedSearchQuery || ''),
    existingSearchInvoked: Boolean(input.existingSearchInvoked),
    searchResultCount:
      typeof input.searchResultCount === 'number' ? input.searchResultCount : null,
    searchContextSentToModel: Boolean(input.searchContextSentToModel),
    finalResponseReceived: Boolean(input.finalResponseReceived),
    webSearchUsed: input.webSearchUsed == null ? null : Boolean(input.webSearchUsed),
    failureCode: typeof input.failureCode === 'string' ? input.failureCode.slice(0, 64) : null,
  }
}
