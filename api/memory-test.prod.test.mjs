/**
 * #298A — /api/memory-test production lock behavior.
 * Run: node --experimental-strip-types api/memory-test.prod.test.mjs
 */

import assert from 'node:assert/strict'
import handler from './memory-test.ts'

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
    end(payload) {
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

const prev = process.env.VERCEL_ENV
process.env.VERCEL_ENV = 'production'

try {
  const res = mockRes()
  await handler(
    {
      method: 'POST',
      headers: {
        'x-laife-memory-secret': 'anything',
        origin: 'http://localhost:5173',
      },
      body: { userMessage: 'x', assistantMessage: 'y' },
    },
    res,
  )
  assert.equal(res.statusCode, 404)
  assert.equal(/** @type {{ code?: string }} */ (res.body).code, 'not_found')
} finally {
  if (prev === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = prev
}

console.log('ok: memory-test disabled in production')
