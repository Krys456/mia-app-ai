/**
 * Shared JSON + CORS helpers for Vercel Node handlers.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-LAIfe-User-Id, X-LAIfe-Memory-Secret',
  'Access-Control-Max-Age': '86400',
}

/**
 * Apply CORS headers so browser clients never see opaque "Failed to fetch"
 * when calling /api/* cross-origin (or after Vercel auth preflights).
 * @param {import('@vercel/node').VercelResponse} res
 */
export function applyCors(res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value)
  }
}

/**
 * @param {import('@vercel/node').VercelResponse} res
 */
export function sendCorsPreflight(res) {
  applyCors(res)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  return res.status(204).end()
}

/**
 * Deep-clone via JSON so res.json never throws on circular / non-JSON values.
 * Falls back to a minimal safe object if serialization fails.
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
export function sanitizeJsonPayload(payload) {
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch (error) {
    console.error('[http] JSON serialize failed', error)
    const content =
      payload && typeof payload === 'object' && typeof payload.content === 'string'
        ? payload.content
        : ''
    if (content) {
      return {
        content,
        memoryEvent: null,
        warning: 'Non-serializable fields stripped from response',
      }
    }
    return {
      error:
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : 'Response serialization failed',
    }
  }
}

/**
 * Always JSON, always CORS, always serializable.
 * @param {import('@vercel/node').VercelResponse} res
 * @param {number} status
 * @param {Record<string, unknown>} payload
 */
export function sendJson(res, status, payload) {
  applyCors(res)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  const safe = sanitizeJsonPayload(payload && typeof payload === 'object' ? payload : {})
  try {
    // Temporary pipeline logging — confirm final body shape before send.
    const keys = Object.keys(safe)
    const contentLen =
      typeof safe.content === 'string' ? safe.content.length : 0
    console.log(
      '[api:sendJson]',
      JSON.stringify({
        status,
        keys,
        contentLen,
        hasError: typeof safe.error === 'string',
      }),
    )
  } catch {
    /* ignore log failures */
  }
  return res.status(status).json(safe)
}

export function parseJsonBody(req) {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed)
  }
  if (typeof req.body === 'object') return req.body
  throw new Error('Unsupported request body')
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
