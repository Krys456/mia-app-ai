/**
 * #298A — Durable rate limit unit tests.
 * Run: node lib/server/rate-limit.test.mjs
 */

import assert from 'node:assert/strict'
import {
  RATE_LIMIT_POLICY,
  __resetRateLimitStateForTests,
  allowDevInMemoryRateLimit,
  consumeRateLimit,
  hasUpstashConfig,
  isProductionLikeDeploy,
} from './rate-limit.js'

__resetRateLimitStateForTests()

assert.equal(RATE_LIMIT_POLICY.chat.requests, 30)
assert.equal(RATE_LIMIT_POLICY.selection.requests, 40)
assert.equal(RATE_LIMIT_POLICY.tts.requests, 15)
assert.equal(RATE_LIMIT_POLICY.files.requests, 10)
assert.equal(RATE_LIMIT_POLICY.memories.requests, 60)
assert.equal(RATE_LIMIT_POLICY.reminders.requests, 40)

assert.equal(isProductionLikeDeploy({ VERCEL_ENV: 'production' }), true)
assert.equal(isProductionLikeDeploy({ VERCEL_ENV: 'preview' }), true)
assert.equal(isProductionLikeDeploy({ VERCEL_ENV: 'development' }), false)
assert.equal(isProductionLikeDeploy({}), false)

assert.equal(
  hasUpstashConfig({
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'token',
  }),
  true,
)
assert.equal(hasUpstashConfig({}), false)

assert.equal(
  allowDevInMemoryRateLimit({ RATE_LIMIT_DEV_INMEMORY: '1', VERCEL_ENV: 'production' }),
  false,
)
assert.equal(allowDevInMemoryRateLimit({ RATE_LIMIT_DEV_INMEMORY: '1' }), true)
assert.equal(allowDevInMemoryRateLimit({}), false)

// Production-like without Upstash → fail closed (unavailable)
{
  const result = await consumeRateLimit({
    userId: 'u1',
    bucket: 'chat',
    env: { VERCEL_ENV: 'production' },
  })
  assert.equal(result.success, false)
  assert.equal(result.unavailable, true)
  assert.equal(result.backend, 'unavailable')
  assert.ok(result.retryAfter >= 1)
}

// Dev in-memory: below limit succeeds, above → 429-style failure
{
  __resetRateLimitStateForTests()
  const env = { RATE_LIMIT_DEV_INMEMORY: '1' }
  const policy = RATE_LIMIT_POLICY.tts
  for (let i = 0; i < policy.requests; i++) {
    const ok = await consumeRateLimit({ userId: 'user-a', bucket: 'tts', env })
    assert.equal(ok.success, true, `request ${i + 1} should succeed`)
    assert.equal(ok.backend, 'dev-memory')
  }
  const blocked = await consumeRateLimit({ userId: 'user-a', bucket: 'tts', env })
  assert.equal(blocked.success, false)
  assert.ok(!('unavailable' in blocked && blocked.unavailable))
  assert.ok(blocked.retryAfter >= 1)

  // Separate users do not share quota
  const other = await consumeRateLimit({ userId: 'user-b', bucket: 'tts', env })
  assert.equal(other.success, true)

  // Endpoint buckets are separate
  const chatOk = await consumeRateLimit({ userId: 'user-a', bucket: 'chat', env })
  assert.equal(chatOk.success, true)
}

// Injected limitFn path (Upstash-shaped)
{
  let calls = 0
  const result = await consumeRateLimit({
    userId: 'u',
    bucket: 'chat',
    limitFn: async (key) => {
      calls += 1
      assert.equal(key, 'chat:u')
      return { success: false, remaining: 0, reset: Date.now() + 5000 }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.success, false)
  assert.ok(result.retryAfter >= 1)
}

console.log('ok: rate-limit durable policy + fail-closed + buckets')
