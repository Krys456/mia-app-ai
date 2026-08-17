/**
 * #298C — Server-controlled request correlation.
 *
 * Always generates a canonical UUID. Incoming X-Request-Id is ignored as
 * authoritative (may be logged as clientHint only if needed later).
 */

import { randomUUID } from 'node:crypto'

/** @typedef {{ requestId: string, startedAt: number }} RequestObsContext */

const OBS_KEY = '__shinkaidoObs'

/**
 * @returns {string}
 */
export function createRequestId() {
  return randomUUID()
}

/**
 * Short user-facing reference (first 8 hex chars of UUID without dashes).
 * @param {string} requestId
 * @returns {string}
 */
export function shortRequestRef(requestId) {
  const compact = String(requestId || '')
    .replace(/-/g, '')
    .toLowerCase()
  if (compact.length >= 8) return compact.slice(0, 8)
  return compact || 'unknown'
}

/**
 * Ensure req has a server-owned obs context; set X-Request-Id on res.
 * @param {{ [key: string]: unknown } | null | undefined} req
 * @param {{ setHeader?: (k: string, v: string) => void } | null | undefined} [res]
 * @returns {RequestObsContext}
 */
export function ensureRequestContext(req, res) {
  const target = req && typeof req === 'object' ? req : {}
  /** @type {RequestObsContext | undefined} */
  let ctx = /** @type {Record<string, unknown>} */ (target)[OBS_KEY]
  if (!ctx || typeof ctx.requestId !== 'string' || !ctx.requestId) {
    ctx = {
      requestId: createRequestId(),
      startedAt: Date.now(),
    }
    Object.defineProperty(target, OBS_KEY, {
      value: ctx,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }
  if (res && typeof res.setHeader === 'function') {
    try {
      res.setHeader('X-Request-Id', ctx.requestId)
    } catch {
      /* header may already be sent */
    }
  }
  return ctx
}

/**
 * @param {{ [key: string]: unknown } | null | undefined} req
 * @returns {RequestObsContext | null}
 */
export function getRequestContext(req) {
  if (!req || typeof req !== 'object') return null
  const ctx = /** @type {Record<string, unknown>} */ (req)[OBS_KEY]
  if (!ctx || typeof ctx !== 'object') return null
  if (typeof /** @type {RequestObsContext} */ (ctx).requestId !== 'string') return null
  return /** @type {RequestObsContext} */ (ctx)
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveServerBuildId(env = process.env) {
  const sha =
    (typeof env.VERCEL_GIT_COMMIT_SHA === 'string' && env.VERCEL_GIT_COMMIT_SHA.trim()) ||
    (typeof env.VITE_BUILD_ID === 'string' && env.VITE_BUILD_ID.trim()) ||
    ''
  if (sha) return sha.replace(/[^a-fA-F0-9]/g, '').slice(0, 7) || 'dev'
  return 'dev'
}
