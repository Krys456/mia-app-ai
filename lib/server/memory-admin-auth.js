/**
 * Phase 0 — temporary server-only gate for memory CRUD / admin routes.
 *
 * Requires env LAIFE_MEMORY_ADMIN_SECRET and matching request header
 * X-LAIfe-Memory-Secret. Never expose the secret via VITE_* or the client.
 *
 * @see .env.example for curl examples
 */

import { timingSafeEqual } from 'node:crypto'
import { sendJson } from './http.js'

export const MEMORY_ADMIN_SECRET_ENV = 'LAIFE_MEMORY_ADMIN_SECRET'
export const MEMORY_ADMIN_SECRET_HEADER = 'x-laife-memory-secret'

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function secretsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {string}
 */
function readProvidedSecret(req) {
  const raw = req.headers?.[MEMORY_ADMIN_SECRET_HEADER]
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
  return ''
}

/**
 * Enforce Phase 0 memory admin lock. Call after CORS / OPTIONS handling.
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @returns {boolean} true when the request may proceed
 */
export function assertMemoryAdminAccess(req, res) {
  const expected = process.env[MEMORY_ADMIN_SECRET_ENV]?.trim() ?? ''

  if (!expected) {
    sendJson(res, 503, {
      success: false,
      error:
        'Memory admin API is locked. Set LAIFE_MEMORY_ADMIN_SECRET on the server (Phase 0).',
    })
    return false
  }

  const provided = readProvidedSecret(req)
  if (!secretsEqual(provided, expected)) {
    sendJson(res, 401, {
      success: false,
      error: 'Unauthorized',
    })
    return false
  }

  return true
}
