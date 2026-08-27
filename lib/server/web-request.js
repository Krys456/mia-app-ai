/**
 * #388B.1 — Web Fetch Request/Response helpers for Hobby serverless routes.
 *
 * Used by api/subscription.ts so Stripe webhooks can call request.text()
 * for exact raw bytes. Mirrors CORS / JSON behavior from http.js without
 * depending on Node IncomingMessage / ServerResponse.
 */

import { ensureRequestContext, getRequestContext } from './request-id.js'
import { resolveAllowedOrigin, sanitizeJsonPayload } from './http.js'
import { logSendJson } from './safe-log.js'

/**
 * Build a Node/Vercel-like shim so existing auth/probe helpers keep working.
 * @param {Request} request
 */
export function createWebRequestShim(request) {
  /** @type {Record<string, string>} */
  const headers = {}
  // Prefer Web Headers iteration. Avoid assuming forEach (Node IncomingMessage
  // was incorrectly passed when a bare default function export was used).
  const hdrs = request?.headers
  if (hdrs && typeof hdrs.forEach === 'function') {
    hdrs.forEach((value, key) => {
      headers[key] = value
    })
  } else if (hdrs && typeof hdrs.entries === 'function') {
    for (const [key, value] of hdrs.entries()) {
      headers[key] = value
    }
  } else if (hdrs && typeof hdrs === 'object') {
    for (const [key, raw] of Object.entries(hdrs)) {
      if (typeof raw === 'string') headers[key] = raw
      else if (Array.isArray(raw) && typeof raw[0] === 'string') headers[key] = raw[0]
    }
  }

  /** @type {Record<string, string>} */
  const query = {}
  try {
    const url = new URL(request.url)
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })
  } catch {
    /* soft */
  }

  return {
    method: request.method,
    url: request.url,
    headers,
    query,
  }
}

/**
 * @param {Request} request
 * @returns {string | null}
 */
export function webRequestOrigin(request) {
  const origin = request.headers.get('origin')
  return origin && origin.trim() ? origin.trim() : null
}

/**
 * @param {Headers} headers
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 */
function applyCorsHeaders(headers, req) {
  const origin = resolveAllowedOrigin(req)
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
    headers.set('Access-Control-Allow-Credentials', 'true')
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-LAIfe-User-Id, X-LAIfe-Memory-Secret, X-Request-Id, X-Shinkaido-Vision-Search-Diag, X-Shinkaido-Document-Diag, Stripe-Signature, x-vercel-protection-bypass',
  )
  headers.set('Access-Control-Max-Age', '86400')
}

/**
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @returns {Response}
 */
export function webCorsPreflight(req) {
  const headers = new Headers()
  ensureRequestContext(req)
  const origin = resolveAllowedOrigin(req)
  applyCorsHeaders(headers, req)
  const ctx = getRequestContext(req)
  if (ctx) headers.set('X-Request-Id', ctx.requestId)
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  if (!origin && req?.headers && readHeader(req.headers, 'origin')) {
    return new Response('CORS origin not allowed', { status: 403, headers })
  }
  return new Response(null, { status: 204, headers })
}

/**
 * @param {Record<string, unknown> | undefined | null} headers
 * @param {string} name
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
 * @param {number} status
 * @param {Record<string, unknown>} payload
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Response}
 */
export function webJson(status, payload, req, extraHeaders = {}) {
  ensureRequestContext(req)
  const headers = new Headers()
  applyCorsHeaders(headers, req)
  const ctx = getRequestContext(req)
  if (ctx) headers.set('X-Request-Id', ctx.requestId)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (typeof v === 'string') headers.set(k, v)
  }
  const safe = sanitizeJsonPayload(payload && typeof payload === 'object' ? payload : {})
  if (ctx && status >= 400 && typeof safe.requestId !== 'string') {
    safe.requestId = ctx.requestId
  }
  logSendJson(req, status, safe)
  return new Response(JSON.stringify(safe), { status, headers })
}

/**
 * Exact raw request bytes for Stripe signature verification.
 * MUST be called before any other body consumer on the same Request.
 *
 * @param {Request} request
 * @returns {Promise<Buffer>}
 */
export async function rawBodyFromWebRequest(request) {
  // request.text() returns the exact UTF-8 payload Vercel received.
  // Never JSON.parse → stringify: that changes bytes and breaks signatures.
  const text = await request.text()
  return Buffer.from(text, 'utf8')
}
