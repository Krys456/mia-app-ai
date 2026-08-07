/**
 * Shared JSON helpers for Vercel Node handlers.
 */

export function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(payload)
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
