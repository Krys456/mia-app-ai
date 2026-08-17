/**
 * #298C — Privacy-first structured server logging.
 *
 * Never log prompts, Memory content, tokens, or raw provider bodies.
 */

import { getRequestContext, resolveServerBuildId, shortRequestRef } from './request-id.js'

/**
 * @param {Record<string, unknown>} fields
 */
export function logApiEvent(fields) {
  try {
    const safe = {
      ...fields,
      buildId: typeof fields.buildId === 'string' ? fields.buildId : resolveServerBuildId(),
    }
    console.log('[api]', JSON.stringify(safe))
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @param {number} status
 * @param {Record<string, unknown>} payload
 * @param {{ route?: string }} [extra]
 */
export function logSendJson(req, status, payload, extra = {}) {
  const ctx = getRequestContext(req)
  const code = typeof payload.code === 'string' ? payload.code : undefined
  const durationMs = ctx ? Math.max(0, Date.now() - ctx.startedAt) : undefined
  logApiEvent({
    route: extra.route || guessRoute(req),
    status,
    ...(code ? { code } : {}),
    ...(ctx ? { requestId: ctx.requestId, ref: shortRequestRef(ctx.requestId) } : {}),
    ...(durationMs != null ? { durationMs } : {}),
    hasError: typeof payload.error === 'string',
    contentLen: typeof payload.content === 'string' ? payload.content.length : 0,
  })
}

/**
 * @param {{ url?: string } | null | undefined} req
 * @returns {string}
 */
function guessRoute(req) {
  const raw = typeof req?.url === 'string' ? req.url : ''
  if (!raw) return 'unknown'
  try {
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw.split('?')[0]
    return path || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Truncate provider error for server logs only (never return to clients).
 * @param {unknown} error
 * @param {number} [max=180]
 * @returns {string}
 */
export function safeErrorSnippet(error, max = 180) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/[\r\n\t]+/g, ' ').slice(0, max)
}
