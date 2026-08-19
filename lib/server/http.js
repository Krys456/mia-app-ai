/**
 * Shared JSON + CORS helpers for Vercel Node handlers
 * (#298A CORS allowlist + #298C request correlation).
 *
 * CORS is not authentication — paid routes still require Bearer JWT.
 */

import { ensureRequestContext, getRequestContext } from './request-id.js'
import { logSendJson, safeErrorSnippet } from './safe-log.js'

/**
 * @param {Record<string, unknown> | undefined | null} headers
 * @param {string} name
 * @returns {string}
 */
function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const target = name.toLowerCase()
  for (const [key, raw] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
    return ''
  }
  return ''
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function parseCorsAllowlist(env = process.env) {
  const raw = typeof env.CORS_ALLOWED_ORIGINS === 'string' ? env.CORS_ALLOWED_ORIGINS : ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @param {string} origin
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isOriginAllowed(origin, env = process.env) {
  if (!origin || typeof origin !== 'string') return false
  const value = origin.trim()
  if (!value) return false

  const allowlist = parseCorsAllowlist(env)
  if (allowlist.includes(value)) return true

  // Local development
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(value)) return true
  if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(value)) return true

  // This project's Vercel deployment hostnames (no arbitrary Origin reflection)
  if (/^https:\/\/mia-app-ai(?:[\w.-]*)?\.vercel\.app$/i.test(value)) return true

  // Deployment URL for this project when set
  const vercelUrl = typeof env.VERCEL_URL === 'string' ? env.VERCEL_URL.trim() : ''
  if (vercelUrl) {
    const normalized = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`
    if (value === normalized.replace(/\/$/, '')) return true
  }

  return false
}

/**
 * Resolve Access-Control-Allow-Origin for a request. Never reflects arbitrary Origin.
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function resolveAllowedOrigin(req, env = process.env) {
  const origin = readHeader(req?.headers, 'origin').trim()
  if (!origin) return null
  return isOriginAllowed(origin, env) ? origin : null
}

/**
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{ headers?: Record<string, unknown> } | null | undefined} [req]
 */
export function applyCors(res, req) {
  if (req) ensureRequestContext(req, res)
  const origin = resolveAllowedOrigin(req)
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  // When Origin is missing (curl / same-origin navigation) omit ACAO — browsers
  // only enforce CORS with a cross-origin Origin header.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-LAIfe-User-Id, X-LAIfe-Memory-Secret, X-Request-Id, X-Shinkaido-Vision-Search-Diag',
  )
  res.setHeader('Access-Control-Max-Age', '86400')
}

/**
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{ headers?: Record<string, unknown> } | null | undefined} [req]
 */
export function sendCorsPreflight(res, req) {
  const origin = resolveAllowedOrigin(req)
  applyCors(res, req)
  if (!origin && readHeader(req?.headers, 'origin')) {
    // Explicitly reject disallowed browser origins on preflight.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(403).end('CORS origin not allowed')
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  return res.status(204).end()
}

/**
 * Deep-clone via JSON so res.json never throws on circular / non-JSON values.
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
export function sanitizeJsonPayload(payload) {
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch (error) {
    console.error('[http] JSON serialize failed', safeErrorSnippet(error))
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
      code: 'internal_error',
    }
  }
}

/**
 * Always JSON, always serializable. Re-applies CORS when req is provided.
 * Injects requestId on error payloads. Sets X-Request-Id.
 * @param {import('@vercel/node').VercelResponse} res
 * @param {number} status
 * @param {Record<string, unknown>} payload
 * @param {{ headers?: Record<string, unknown> } | null | undefined} [req]
 */
export function sendJson(res, status, payload, req) {
  if (req) {
    ensureRequestContext(req, res)
    applyCors(res, req)
  }
  const ctx = getRequestContext(req)
  if (ctx) {
    try {
      res.setHeader('X-Request-Id', ctx.requestId)
    } catch {
      /* ignore */
    }
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  const safe = sanitizeJsonPayload(payload && typeof payload === 'object' ? payload : {})
  if (ctx && status >= 400 && typeof safe.requestId !== 'string') {
    safe.requestId = ctx.requestId
  }
  logSendJson(req, status, safe)
  return res.status(status).json(safe)
}

/**
 * Attach request id + timing for non-JSON responses (e.g. TTS audio).
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @param {{ status: number, code?: string, route?: string }} meta
 */
export function finalizeBinaryResponse(res, req, meta) {
  const ctx = ensureRequestContext(req, res)
  try {
    res.setHeader('X-Request-Id', ctx.requestId)
  } catch {
    /* ignore */
  }
  logSendJson(req, meta.status, { code: meta.code || 'ok' }, { route: meta.route })
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

/** Safe user-facing 5xx copy (#298C). */
export const SAFE_UPSTREAM_ERROR =
  "ShinkAIdo non è riuscito a completare questa richiesta. Riprova tra poco."

export const SAFE_INTERNAL_ERROR =
  "ShinkAIdo ha riscontrato un problema interno. Riprova tra poco."

export const SAFE_MEMORY_ERROR =
  "Impossibile completare l'operazione sulla Memoria. Riprova tra poco."
