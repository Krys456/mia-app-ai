/**
 * #298A — Security wiring: production memory-test lock, OpenAI-after-auth order,
 * Memory field caps, Core invariants preserved.
 * Run: node lib/server/security-298a.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MEMORY_FIELD_LIMITS, isWithinLength } from './memory-field-limits.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

assert.equal(MEMORY_FIELD_LIMITS.category, 64)
assert.equal(MEMORY_FIELD_LIMITS.title, 200)
assert.equal(MEMORY_FIELD_LIMITS.content, 8000)
assert.equal(isWithinLength('ok', 2), true)
assert.equal(isWithinLength('toolong', 2), false)

const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
const selectionSrc = readFileSync(join(root, 'api/selection.ts'), 'utf8')
const ttsSrc = readFileSync(join(root, 'api/tts.ts'), 'utf8')
const filesSrc = readFileSync(join(root, 'api/files.ts'), 'utf8')
const memoryTestSrc = readFileSync(join(root, 'api/memory-test.ts'), 'utf8')
const memoriesIndexSrc = readFileSync(join(root, 'api/memories/index.ts'), 'utf8')
const memoriesIdSrc = readFileSync(join(root, 'api/memories/[id].ts'), 'utf8')
const httpSrc = readFileSync(join(root, 'lib/server/http.js'), 'utf8')

// CORS must not allow *
assert.ok(!httpSrc.includes("Access-Control-Allow-Origin', '*'"))
assert.ok(!httpSrc.includes('Access-Control-Allow-Origin", "*"'))
assert.ok(httpSrc.includes('isOriginAllowed'))

// Core chat invariants
assert.ok(chatSrc.includes('maxDuration: 120'))
assert.equal((chatSrc.match(/client\.responses\.create/g) || []).length, 1)
assert.ok(chatSrc.includes('requirePaidApiAccess'))
assert.ok(chatSrc.includes("bucket: 'chat'"))

// Auth/rate-limit before OpenAI dynamic import / speech.create / files upload
function assertGuardBeforeOpenAi(src, label) {
  const guardIdx = src.indexOf('requirePaidApiAccess')
  assert.ok(guardIdx > 0, `${label}: missing requirePaidApiAccess`)
  const openaiIdx = Math.min(
    ...[
      src.indexOf("import('openai')"),
      src.indexOf('import("openai")'),
      src.indexOf('uploadDocumentToOpenAiFiles'),
      src.indexOf('responses.create'),
      src.indexOf('audio.speech.create'),
    ].filter((i) => i >= 0),
  )
  assert.ok(openaiIdx > guardIdx, `${label}: OpenAI path must run after paid guard`)
}

assertGuardBeforeOpenAi(chatSrc, 'chat')
assertGuardBeforeOpenAi(selectionSrc, 'selection')
assertGuardBeforeOpenAi(ttsSrc, 'tts')
assertGuardBeforeOpenAi(filesSrc, 'files')

// memory-test production hard lock
assert.ok(memoryTestSrc.includes("VERCEL_ENV === 'production'"))
assert.ok(memoryTestSrc.includes('404'))

// Memory CRUD caps wired
assert.ok(memoriesIndexSrc.includes('MEMORY_FIELD_LIMITS'))
assert.ok(memoriesIdSrc.includes('MEMORY_FIELD_LIMITS'))
assert.ok(memoriesIndexSrc.includes('consumeRateLimit'))

// Client Bearer on paid callers
const selectionApi = readFileSync(join(root, 'src/lib/selectionApi.ts'), 'utf8')
const ttsApi = readFileSync(join(root, 'src/lib/ttsApi.ts'), 'utf8')
const chatApi = readFileSync(join(root, 'src/lib/chatApi.ts'), 'utf8')
const docUpload = readFileSync(join(root, 'src/lib/documentUpload.ts'), 'utf8')
assert.ok(selectionApi.includes('resolveChatAuthForRequest'))
assert.ok(selectionApi.includes('Authorization'))
assert.ok(ttsApi.includes('resolveChatAuthForRequest'))
assert.ok(chatApi.includes('Sessione non pronta'))
assert.ok(docUpload.includes('Authorization'))

console.log('ok: #298A security wiring + Core order invariants')
