/**
 * Phase 0 memory admin auth tests.
 * Run: node lib/server/memory-admin-auth.test.mjs
 */

import assert from 'node:assert/strict'
import {
  MEMORY_ADMIN_SECRET_ENV,
  MEMORY_ADMIN_SECRET_HEADER,
  assertMemoryAdminAccess,
} from './memory-admin-auth.js'

function mockRes() {
  /** @type {{ statusCode: number, body: any }} */
  const state = { statusCode: 0, body: null }
  return {
    state,
    setHeader() {},
    status(code) {
      state.statusCode = code
      return this
    },
    json(payload) {
      state.body = payload
      return this
    },
  }
}

function withSecret(value, fn) {
  const prev = process.env[MEMORY_ADMIN_SECRET_ENV]
  if (value == null) delete process.env[MEMORY_ADMIN_SECRET_ENV]
  else process.env[MEMORY_ADMIN_SECRET_ENV] = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env[MEMORY_ADMIN_SECRET_ENV]
    else process.env[MEMORY_ADMIN_SECRET_ENV] = prev
  }
}

// Missing server secret → fail closed
withSecret('', () => {
  const res = mockRes()
  const ok = assertMemoryAdminAccess({ headers: {} }, res)
  assert.equal(ok, false)
  assert.equal(res.state.statusCode, 503)
})

withSecret(undefined, () => {
  const res = mockRes()
  const ok = assertMemoryAdminAccess({ headers: {} }, res)
  assert.equal(ok, false)
  assert.equal(res.state.statusCode, 503)
})

// Secret configured, no header → 401
withSecret('phase0-test-secret', () => {
  const res = mockRes()
  const ok = assertMemoryAdminAccess({ headers: {} }, res)
  assert.equal(ok, false)
  assert.equal(res.state.statusCode, 401)
  assert.equal(res.state.body?.error, 'Unauthorized')
})

// Wrong header → 401
withSecret('phase0-test-secret', () => {
  const res = mockRes()
  const ok = assertMemoryAdminAccess(
    { headers: { [MEMORY_ADMIN_SECRET_HEADER]: 'nope' } },
    res,
  )
  assert.equal(ok, false)
  assert.equal(res.state.statusCode, 401)
})

// Matching header → allow
withSecret('phase0-test-secret', () => {
  const res = mockRes()
  const ok = assertMemoryAdminAccess(
    { headers: { [MEMORY_ADMIN_SECRET_HEADER]: 'phase0-test-secret' } },
    res,
  )
  assert.equal(ok, true)
  assert.equal(res.state.statusCode, 0)
})

console.log('ok: memory-admin-auth Phase 0 lockdown')
