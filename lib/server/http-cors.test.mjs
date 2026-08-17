/**
 * #298A — CORS allowlist tests.
 * Run: node lib/server/http-cors.test.mjs
 */

import assert from 'node:assert/strict'
import {
  applyCors,
  isOriginAllowed,
  parseCorsAllowlist,
  resolveAllowedOrigin,
  sendCorsPreflight,
} from './http.js'

assert.deepEqual(
  parseCorsAllowlist({ CORS_ALLOWED_ORIGINS: ' https://a.example ,https://b.example ' }),
  ['https://a.example', 'https://b.example'],
)

assert.equal(isOriginAllowed('http://localhost:5173'), true)
assert.equal(isOriginAllowed('http://127.0.0.1:3000'), true)
assert.equal(isOriginAllowed('https://mia-app-ai.vercel.app'), true)
assert.equal(
  isOriginAllowed('https://mia-app-ai-git-cursor-security-team.vercel.app'),
  true,
)
assert.equal(isOriginAllowed('https://evil.example'), false)
assert.equal(isOriginAllowed('https://evil-mia-app-ai.vercel.app.attacker.com'), false)

{
  const env = { CORS_ALLOWED_ORIGINS: 'https://www.shinkaido.app' }
  assert.equal(isOriginAllowed('https://www.shinkaido.app', env), true)
  assert.equal(isOriginAllowed('https://other.app', env), false)
}

{
  const origin = resolveAllowedOrigin({
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(origin, null)
}

{
  const origin = resolveAllowedOrigin({
    headers: { origin: 'http://localhost:5173' },
  })
  assert.equal(origin, 'http://localhost:5173')
}

function mockRes() {
  /** @type {Record<string, string>} */
  const headers = {}
  let statusCode = 0
  let body = null
  return {
    headers,
    setHeader(k, v) {
      headers[k.toLowerCase()] = String(v)
    },
    status(code) {
      statusCode = code
      return {
        end(payload) {
          body = payload
          return this
        },
        json(payload) {
          body = payload
          return this
        },
      }
    },
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
  }
}

// Approved origin → ACAO set; Authorization allowed
{
  const res = mockRes()
  applyCors(res, { headers: { origin: 'http://localhost:5173' } })
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173')
  assert.match(res.headers['access-control-allow-headers'], /Authorization/i)
  assert.notEqual(res.headers['access-control-allow-origin'], '*')
}

// Unapproved origin → no ACAO reflection
{
  const res = mockRes()
  applyCors(res, { headers: { origin: 'https://evil.example' } })
  assert.equal(res.headers['access-control-allow-origin'], undefined)
}

// OPTIONS preflight: allowed
{
  const res = mockRes()
  sendCorsPreflight(res, { headers: { origin: 'http://localhost:5173' } })
  assert.equal(res.statusCode, 204)
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173')
}

// OPTIONS preflight: disallowed
{
  const res = mockRes()
  sendCorsPreflight(res, { headers: { origin: 'https://evil.example' } })
  assert.equal(res.statusCode, 403)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
}

console.log('ok: CORS allowlist + preflight')
