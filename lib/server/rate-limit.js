/**
 * #298A — Durable rate limiting for paid API routes.
 *
 * Primary key: verified Supabase user id.
 * Backend: Upstash Redis (shared across Vercel isolates).
 *
 * Failure mode (fail-closed for production-like deploys):
 * - If Upstash is unavailable / misconfigured on Vercel production|preview → deny (503)
 * - Local/dev without Upstash may use ephemeral in-memory ONLY when
 *   RATE_LIMIT_DEV_INMEMORY=1 (never auto-enabled on Vercel).
 *
 * Limits (sliding windows) — closed beta, cost-aware:
 * - chat:     30 / 1 min  (multi-turn conversation + tools; still bounds image/search spam)
 * - selection: 40 / 1 min
 * - tts:      15 / 1 min  (speech synthesis cost)
 * - files:    10 / 1 min  (OpenAI Files upload)
 * - memories:  60 / 1 min  (CRUD amplification)
 * - reminders: 40 / 1 min  (#303A — no OpenAI; mutation amplification)
 * - push_subscriptions: 10 / 1 min  (#303C — subscription upsert/unsubscribe)
 * - weather:  30 / 1 min  (#317 — Open-Meteo; cache should keep real provider calls lower)
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/** @typedef {'chat' | 'selection' | 'tts' | 'files' | 'memories' | 'reminders' | 'push_subscriptions' | 'weather' | 'account_delete'} RateLimitBucket */

/** @type {Record<RateLimitBucket, { requests: number, window: `${number} ${'s' | 'm' | 'h' | 'd'}` }>} */
export const RATE_LIMIT_POLICY = {
  chat: { requests: 30, window: '1 m' },
  selection: { requests: 40, window: '1 m' },
  tts: { requests: 15, window: '1 m' },
  files: { requests: 10, window: '1 m' },
  memories: { requests: 60, window: '1 m' },
  reminders: { requests: 40, window: '1 m' },
  push_subscriptions: { requests: 10, window: '1 m' },
  weather: { requests: 30, window: '1 m' },
  // #386C — strict: deletion is rare; bound abuse / double-submit storms.
  account_delete: { requests: 5, window: '1 h' },
}

/**
 * @returns {boolean}
 */
export function isProductionLikeDeploy(env = process.env) {
  const vercelEnv = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (vercelEnv === 'production' || vercelEnv === 'preview') return true
  if (env.VERCEL === '1' && env.NODE_ENV === 'production') return true
  return false
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function hasUpstashConfig(env = process.env) {
  return Boolean(
    typeof env.UPSTASH_REDIS_REST_URL === 'string' &&
      env.UPSTASH_REDIS_REST_URL.trim() &&
      typeof env.UPSTASH_REDIS_REST_TOKEN === 'string' &&
      env.UPSTASH_REDIS_REST_TOKEN.trim(),
  )
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function allowDevInMemoryRateLimit(env = process.env) {
  if (isProductionLikeDeploy(env)) return false
  return env.RATE_LIMIT_DEV_INMEMORY === '1'
}

/** @type {Map<string, Ratelimit> | null} */
let upstashLimiters = null

/** @type {Map<string, { count: number, resetAt: number }> | null} */
let memoryBuckets = null

/**
 * @param {RateLimitBucket} bucket
 * @param {NodeJS.ProcessEnv} [env]
 */
function getUpstashLimiter(bucket, env = process.env) {
  if (!upstashLimiters) {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL.trim(),
      token: env.UPSTASH_REDIS_REST_TOKEN.trim(),
    })
    upstashLimiters = new Map()
    for (const [name, policy] of Object.entries(RATE_LIMIT_POLICY)) {
      upstashLimiters.set(
        name,
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(policy.requests, policy.window),
          prefix: `shinkaido:rl:${name}`,
          analytics: false,
        }),
      )
    }
  }
  const limiter = upstashLimiters.get(bucket)
  if (!limiter) throw new Error(`Unknown rate-limit bucket: ${bucket}`)
  return limiter
}

/**
 * Ephemeral local-only limiter (explicit opt-in). Not safe across serverless instances.
 * @param {string} key
 * @param {{ requests: number, windowMs: number }} policy
 */
function checkMemoryLimit(key, policy) {
  if (!memoryBuckets) memoryBuckets = new Map()
  const now = Date.now()
  const row = memoryBuckets.get(key)
  if (!row || now >= row.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + policy.windowMs })
    return {
      success: true,
      remaining: policy.requests - 1,
      reset: now + policy.windowMs,
      retryAfter: 0,
    }
  }
  if (row.count >= policy.requests) {
    const retryAfter = Math.max(1, Math.ceil((row.resetAt - now) / 1000))
    return {
      success: false,
      remaining: 0,
      reset: row.resetAt,
      retryAfter,
    }
  }
  row.count += 1
  return {
    success: true,
    remaining: Math.max(0, policy.requests - row.count),
    reset: row.resetAt,
    retryAfter: 0,
  }
}

/**
 * @param {RateLimitBucket} bucket
 * @returns {{ requests: number, windowMs: number }}
 */
function memoryPolicyFor(bucket) {
  const policy = RATE_LIMIT_POLICY[bucket]
  const windowMs = policy.window.endsWith(' h')
    ? Number.parseInt(policy.window, 10) * 60 * 60 * 1000
    : policy.window.endsWith(' m')
      ? Number.parseInt(policy.window, 10) * 60 * 1000
      : Number.parseInt(policy.window, 10) * 1000
  return { requests: policy.requests, windowMs }
}

/**
 * @param {{
 *   userId: string
 *   bucket: RateLimitBucket
 *   env?: NodeJS.ProcessEnv
 *   limitFn?: (key: string) => Promise<{ success: boolean, remaining: number, reset: number }>
 * }} options
 * @returns {Promise<{
 *   success: boolean
 *   remaining: number
 *   reset: number
 *   retryAfter: number
 *   backend: 'upstash' | 'dev-memory'
 * } | { success: false, unavailable: true, retryAfter: number, backend: 'unavailable' }>}
 */
export async function consumeRateLimit(options) {
  const env = options.env ?? process.env
  const userId = typeof options.userId === 'string' ? options.userId.trim() : ''
  const bucket = options.bucket
  if (!userId) {
    return { success: false, unavailable: true, retryAfter: 60, backend: 'unavailable' }
  }
  if (!RATE_LIMIT_POLICY[bucket]) {
    return { success: false, unavailable: true, retryAfter: 60, backend: 'unavailable' }
  }

  const key = `${bucket}:${userId}`

  if (typeof options.limitFn === 'function') {
    const result = await options.limitFn(key)
    const retryAfter = result.success
      ? 0
      : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
      retryAfter,
      backend: 'upstash',
    }
  }

  if (hasUpstashConfig(env)) {
    try {
      const limiter = getUpstashLimiter(bucket, env)
      const result = await limiter.limit(key)
      const retryAfter = result.success
        ? 0
        : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
      return {
        success: result.success,
        remaining: result.remaining,
        reset: result.reset,
        retryAfter,
        backend: 'upstash',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[rate-limit] upstash failed', message.slice(0, 180))
      // Fail closed — never fall through to unlimited OpenAI.
      return { success: false, unavailable: true, retryAfter: 30, backend: 'unavailable' }
    }
  }

  if (allowDevInMemoryRateLimit(env)) {
    const result = checkMemoryLimit(key, memoryPolicyFor(bucket))
    return { ...result, backend: 'dev-memory' }
  }

  // Production-like without Upstash, or local without explicit opt-in → deny.
  console.error(
    '[rate-limit] backend unavailable',
    JSON.stringify({
      productionLike: isProductionLikeDeploy(env),
      hasUpstash: false,
    }),
  )
  return { success: false, unavailable: true, retryAfter: 60, backend: 'unavailable' }
}

/** Test helper — clear module caches between tests. */
export function __resetRateLimitStateForTests() {
  upstashLimiters = null
  memoryBuckets = null
}
