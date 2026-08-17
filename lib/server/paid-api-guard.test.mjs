/**
 * #298A — Paid API guard: auth → rate limit → never OpenAI on deny.
 * Run: node lib/server/paid-api-guard.test.mjs
 */

import assert from 'node:assert/strict'
import { AuthError } from './auth.js'
import { requirePaidApiAccess } from './paid-api-guard.js'

function mockRes() {
  /** @type {Record<string, string>} */
  const headers = {}
  let statusCode = 0
  /** @type {unknown} */
  let body = null
  return {
    headers,
    setHeader(k, v) {
      headers[k.toLowerCase()] = String(v)
    },
    status(code) {
      statusCode = code
      return this
    },
    json(payload) {
      body = payload
      return this
    },
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
  }
}

// Missing Authorization → 401; rate limit not consulted
{
  const res = mockRes()
  let rateCalls = 0
  const access = await requirePaidApiAccess(
    { headers: {}, method: 'POST' },
    res,
    {
      bucket: 'chat',
      requireAuthenticatedUser: async () => {
        throw new AuthError('missing_token', 'Missing Authorization Bearer token')
      },
      consumeRateLimit: async () => {
        rateCalls += 1
        return { success: true, remaining: 1, reset: Date.now(), retryAfter: 0, backend: 'upstash' }
      },
    },
  )
  assert.equal(access, null)
  assert.equal(res.statusCode, 401)
  assert.equal(rateCalls, 0)
  assert.equal(/** @type {{ code?: string }} */ (res.body).code, 'missing_token')
}

// Malformed Authorization → 401
{
  const res = mockRes()
  const access = await requirePaidApiAccess(
    { headers: { authorization: 'Basic x' }, method: 'POST' },
    res,
    {
      bucket: 'selection',
      requireAuthenticatedUser: async () => {
        throw new AuthError('malformed_authorization', 'Malformed Authorization header')
      },
      consumeRateLimit: async () => {
        assert.fail('rate limit must not run after auth fail')
      },
    },
  )
  assert.equal(access, null)
  assert.equal(res.statusCode, 401)
}

// Invalid token → 401
{
  const res = mockRes()
  const access = await requirePaidApiAccess(
    { headers: { authorization: 'Bearer bad' }, method: 'POST' },
    res,
    {
      bucket: 'tts',
      requireAuthenticatedUser: async () => {
        throw new AuthError('invalid_token', 'Invalid or expired access token')
      },
      consumeRateLimit: async () => {
        assert.fail('rate limit must not run after auth fail')
      },
    },
  )
  assert.equal(access, null)
  assert.equal(res.statusCode, 401)
  assert.equal(/** @type {{ code?: string }} */ (res.body).code, 'invalid_token')
}

// Valid token + rate ok → proceeds with canonical userId (spoof ignored upstream)
{
  const res = mockRes()
  const access = await requirePaidApiAccess(
    {
      headers: {
        authorization: 'Bearer good',
        'x-laife-user-id': 'forged-header',
      },
      body: { userId: 'forged-body' },
      method: 'POST',
    },
    res,
    {
      bucket: 'files',
      requireAuthenticatedUser: async (req) => {
        assert.equal(req.headers.authorization, 'Bearer good')
        return {
          userId: 'canonical-user-uuid',
          isAnonymous: true,
          user: { id: 'canonical-user-uuid' },
          accessToken: 'good',
        }
      },
      consumeRateLimit: async ({ userId, bucket }) => {
        assert.equal(userId, 'canonical-user-uuid')
        assert.equal(bucket, 'files')
        return { success: true, remaining: 9, reset: Date.now() + 60_000, retryAfter: 0, backend: 'upstash' }
      },
    },
  )
  assert.ok(access)
  assert.equal(access.userId, 'canonical-user-uuid')
  assert.notEqual(access.userId, 'forged-body')
  assert.notEqual(access.userId, 'forged-header')
}

// Above limit → 429 + Retry-After
{
  const res = mockRes()
  const access = await requirePaidApiAccess(
    { headers: { authorization: 'Bearer good' }, method: 'POST' },
    res,
    {
      bucket: 'chat',
      requireAuthenticatedUser: async () => ({
        userId: 'u1',
        isAnonymous: true,
        user: { id: 'u1' },
        accessToken: 'good',
      }),
      consumeRateLimit: async () => ({
        success: false,
        remaining: 0,
        reset: Date.now() + 12_000,
        retryAfter: 12,
        backend: 'upstash',
      }),
    },
  )
  assert.equal(access, null)
  assert.equal(res.statusCode, 429)
  assert.equal(res.headers['retry-after'], '12')
  assert.equal(/** @type {{ error?: string }} */ (res.body).error, 'rate_limit_exceeded')
  assert.equal(/** @type {{ code?: string }} */ (res.body).code, 'rate_limit_exceeded')
  assert.equal(/** @type {{ retryAfter?: number }} */ (res.body).retryAfter, 12)
}

// Limiter unavailable → 503 fail-closed (not unlimited)
{
  const res = mockRes()
  const access = await requirePaidApiAccess(
    { headers: { authorization: 'Bearer good' }, method: 'POST' },
    res,
    {
      bucket: 'chat',
      requireAuthenticatedUser: async () => ({
        userId: 'u1',
        isAnonymous: true,
        user: { id: 'u1' },
        accessToken: 'good',
      }),
      consumeRateLimit: async () => ({
        success: false,
        unavailable: true,
        retryAfter: 30,
        backend: 'unavailable',
      }),
    },
  )
  assert.equal(access, null)
  assert.equal(res.statusCode, 503)
  assert.equal(/** @type {{ code?: string }} */ (res.body).code, 'rate_limit_unavailable')
}

console.log('ok: paid-api-guard auth + rate-limit contracts')
