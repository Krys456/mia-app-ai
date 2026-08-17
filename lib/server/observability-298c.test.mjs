/**
 * #298C — Observability & beta support contracts.
 * Run: node --experimental-strip-types lib/server/observability-298c.test.mjs
 *   or: node lib/server/observability-298c.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRequestId,
  ensureRequestContext,
  getRequestContext,
  resolveServerBuildId,
  shortRequestRef,
} from './request-id.js'
import { sendJson, SAFE_UPSTREAM_ERROR, SAFE_INTERNAL_ERROR, SAFE_MEMORY_ERROR } from './http.js'
import { logApiEvent, safeErrorSnippet } from './safe-log.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

// --- Request ID core ---
const a = createRequestId()
const b = createRequestId()
assert.notEqual(a, b)
assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
assert.equal(shortRequestRef(a).length, 8)
assert.ok(!a.includes('Bearer'))
assert.ok(!a.includes('sk-'))

{
  const req = {
    headers: { 'x-request-id': 'client-spoofed-should-not-win' },
    url: '/api/chat',
  }
  /** @type {Record<string, string>} */
  const headers = {}
  const res = {
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = String(v)
    },
  }
  const ctx1 = ensureRequestContext(req, res)
  const ctx2 = ensureRequestContext(req, res)
  assert.equal(ctx1.requestId, ctx2.requestId)
  assert.notEqual(ctx1.requestId, 'client-spoofed-should-not-win')
  assert.equal(headers['x-request-id'], ctx1.requestId)
  assert.equal(getRequestContext(req)?.requestId, ctx1.requestId)
}

assert.equal(resolveServerBuildId({ VERCEL_GIT_COMMIT_SHA: 'abcdef0123456789' }), 'abcdef0')
assert.equal(resolveServerBuildId({}), 'dev')

// --- sendJson injects requestId + X-Request-Id ---
{
  const req = { url: '/api/chat', headers: {} }
  /** @type {Record<string, string>} */
  const headers = {}
  let statusCode = 0
  /** @type {Record<string, unknown> | null} */
  let body = null
  const res = {
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = String(v)
    },
    status(code) {
      statusCode = code
      return {
        json(payload) {
          body = payload
          return this
        },
      }
    },
  }
  sendJson(res, 502, { error: SAFE_UPSTREAM_ERROR, code: 'upstream_ai_error' }, req)
  assert.equal(statusCode, 502)
  assert.ok(typeof body?.requestId === 'string' && String(body.requestId).length > 10)
  assert.equal(headers['x-request-id'], body.requestId)
  assert.equal(body.error, SAFE_UPSTREAM_ERROR)
  assert.equal(body.code, 'upstream_ai_error')
  // Spoofed client header must not replace server id
  assert.notEqual(body.requestId, 'client-spoofed-should-not-win')
}

{
  const req = { url: '/api/memories', headers: { 'x-request-id': 'spoof-me' } }
  /** @type {Record<string, string>} */
  const headers = {}
  /** @type {Record<string, unknown> | null} */
  let body = null
  const res = {
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = String(v)
    },
    status() {
      return {
        json(payload) {
          body = payload
          return this
        },
      }
    },
  }
  sendJson(res, 500, { error: SAFE_MEMORY_ERROR, code: 'memory_error' }, req)
  assert.ok(body?.requestId)
  assert.notEqual(body.requestId, 'spoof-me')
  assert.equal(headers['x-request-id'], body.requestId)
}

// --- Safe log fields: no prompt / Memory / bearer ---
{
  const lines = []
  const orig = console.log
  console.log = (...args) => {
    lines.push(args.map(String).join(' '))
  }
  try {
    logApiEvent({
      route: '/api/chat',
      status: 500,
      code: 'internal_error',
      requestId: '11111111-2222-3333-4444-555555555555',
      durationMs: 12,
    })
  } finally {
    console.log = orig
  }
  const joined = lines.join('\n')
  assert.match(joined, /\[api\]/)
  assert.match(joined, /internal_error/)
  assert.doesNotMatch(joined, /Bearer |sk-|OPENAI_API_KEY|Authorization/i)
  assert.doesNotMatch(joined, /prompt|memory content|selected text/i)
}

assert.equal(safeErrorSnippet('line1\nline2').includes('\n'), false)
assert.ok(safeErrorSnippet('x'.repeat(500)).length <= 180)

// --- Source contracts: routes + sanitization ---
const chatSrc = read('api/chat.ts')
const selectionSrc = read('api/selection.ts')
const ttsSrc = read('api/tts.ts')
const filesSrc = read('api/files.ts')
const memoriesIndex = read('api/memories/index.ts')
const memoriesId = read('api/memories/[id].ts')
const httpSrc = read('lib/server/http.js')
const safeLogSrc = read('lib/server/safe-log.js')
const paidGuard = read('lib/server/paid-api-guard.js')
const brain = read('lib/server/brain-memory.js')

assert.match(httpSrc, /X-Request-Id/)
assert.match(httpSrc, /ensureRequestContext/)
assert.match(httpSrc, /SAFE_UPSTREAM_ERROR/)
assert.match(safeLogSrc, /durationMs/)
assert.match(safeLogSrc, /buildId/)
assert.match(safeLogSrc, /contentLen/)
assert.doesNotMatch(safeLogSrc, /content:\s*payload\.content/)
assert.doesNotMatch(safeLogSrc, /JSON\.stringify\(payload\)/)

for (const [label, src] of [
  ['chat', chatSrc],
  ['selection', selectionSrc],
  ['tts', ttsSrc],
  ['files', filesSrc],
  ['memories', memoriesIndex],
  ['memories/[id]', memoriesId],
]) {
  assert.match(src, /sendJson\(/, label)
  // Catch paths should not return raw OpenAI message fields to clients
  assert.doesNotMatch(src, /error\.message\s*,\s*req/, `${label}: raw error.message to client`)
}

assert.match(chatSrc, /SAFE_UPSTREAM_ERROR|SAFE_INTERNAL_ERROR/)
assert.match(chatSrc, /upstream_ai_error|internal_error/)
assert.match(selectionSrc, /SAFE_UPSTREAM_ERROR/)
assert.match(memoriesIndex, /SAFE_MEMORY_ERROR/)
assert.match(memoriesId, /SAFE_MEMORY_ERROR/)
assert.match(paidGuard, /requestId/)
assert.match(brain, /fact_key_omitted/)
assert.doesNotMatch(
  brain,
  /exact fact_key revoke lookup failed for \$\{factKey\}/,
)

// Core invariants preserved
assert.match(chatSrc, /maxDuration:\s*120/)
assert.equal((chatSrc.match(/client\.responses\.create/g) || []).length, 1)
assert.match(chatSrc, /requirePaidApiAccess/)
assert.match(read('lib/server/core-responses-params.js'), /effort:\s*['"]none['"]/)
assert.match(read('lib/server/core-responses-params.js'), /stream:\s*false/)

// Client pieces
const apiError = read('src/lib/apiError.ts')
const betaSupport = read('src/lib/betaSupport.ts')
const buildInfo = read('src/lib/buildInfo.ts')
const boundary = read('src/components/AppErrorBoundary.tsx')
const main = read('src/main.tsx')
const privacy = read('src/pages/PrivacyData.tsx')
const chatApi = read('src/lib/chatApi.ts')
const selectionApi = read('src/lib/selectionApi.ts')
const ttsApi = read('src/lib/ttsApi.ts')
const memoryApi = read('src/lib/memoryApi.ts')
const docUpload = read('src/lib/documentUpload.ts')
const chatCtx = read('src/context/ChatContext.tsx')
const vite = read('vite.config.ts')

assert.match(apiError, /withErrorReference/)
assert.match(apiError, /parseApiErrorResponse/)
assert.match(apiError, /Riferimento:/)
assert.match(betaSupport, /buildBetaSupportMailto/)
assert.match(betaSupport, /mailto:/)
assert.match(betaSupport, /isPrivacyContactConfigured/)
assert.doesNotMatch(betaSupport, /messages\.|selectedText|dataUrl|Authorization/)
assert.match(betaSupport, /Never auto-attaches/)
assert.match(buildInfo, /getClientBuildId/)
assert.match(vite, /__SHINKAIDO_BUILD_ID__/)
assert.match(vite, /VERCEL_GIT_COMMIT_SHA/)
assert.match(boundary, /Qualcosa è andato storto/)
assert.match(boundary, /Ricarica/)
assert.match(boundary, /getClientBuildId/)
assert.doesNotMatch(boundary, /componentStack|error\.stack|JWT|Authorization/)
assert.doesNotMatch(boundary, /\{error\.message\}|error\.message/)
assert.match(main, /AppErrorBoundary/)
assert.match(privacy, /Beta build/)
assert.match(privacy, /Segnala un problema/)
assert.match(privacy, /buildBetaSupportMailto/)
assert.match(chatApi, /requestId/)
assert.match(selectionApi, /requestId/)
assert.match(ttsApi, /requestId/)
assert.match(memoryApi, /requestId/)
assert.match(docUpload, /requestId/)
assert.match(chatCtx, /import\.meta\.env\.DEV/)

// No new monitoring SDKs
const pkg = JSON.parse(read('package.json'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const banned of ['@sentry/react', '@sentry/node', 'posthog-js', 'logrocket', 'datadog-rum']) {
  assert.ok(!(banned in deps), `must not depend on ${banned}`)
}
assert.doesNotMatch(read('src/App.tsx') + main, /Sentry|PostHog|LogRocket/)

// Mailto helper behavior (inline mirror — Node cannot resolve Vite TS imports here)
{
  function isConfigured(email) {
    const value = String(email || '').trim()
    if (!value || value.startsWith('[') || value === '[OPERATOR EMAIL]') return false
    return value.includes('@')
  }
  function buildMailto({ contactEmail, surface, requestId, buildId, timestamp }) {
    if (!isConfigured(contactEmail)) return null
    const ref = String(requestId || '').replace(/-/g, '').slice(0, 8)
    const subject = `ShinkAIdo beta — segnalazione (${surface})`
    const body = [
      'Descrivi il problema qui sotto:',
      '',
      '',
      '---',
      'Metadati diagnostici (non includono chat, Memoria o file):',
      'Prodotto: ShinkAIdo beta',
      `Build: ${buildId}`,
      `Superficie: ${surface}`,
      `Timestamp: ${timestamp}`,
      `Riferimento: ${ref}`,
    ].join('\n')
    return `mailto:${encodeURIComponent(contactEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  assert.equal(buildMailto({ contactEmail: '[OPERATOR EMAIL]' }), null)
  const href = buildMailto({
    contactEmail: 'beta@example.com',
    surface: 'chat',
    requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    buildId: 'abc1234',
    timestamp: '2026-08-17T00:00:00.000Z',
  })
  assert.ok(href && href.startsWith('mailto:'))
  const decoded = decodeURIComponent(href)
  assert.match(decoded, /ShinkAIdo beta/)
  assert.match(decoded, /Build: abc1234/)
  assert.match(decoded, /Riferimento: a1b2c3d4/)
  assert.doesNotMatch(decoded, /user prompt|assistant reply|selected text/i)
  // Source helper must match this privacy contract
  assert.match(betaSupport, /isPrivacyContactConfigured/)
  assert.match(betaSupport, /PRIVACY_CONTACT_PLACEHOLDER/)
}

assert.equal(SAFE_INTERNAL_ERROR.includes('OpenAI'), false)
assert.equal(SAFE_UPSTREAM_ERROR.includes('OpenAI'), false)
assert.equal(SAFE_MEMORY_ERROR.includes('Supabase'), false)

console.log('ok: #298C observability + beta support contracts')
