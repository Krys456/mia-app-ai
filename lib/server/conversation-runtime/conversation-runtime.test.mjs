#!/usr/bin/env node
/**
 * Tests for conversation runtime switch.
 * Run: node lib/server/conversation-runtime/conversation-runtime.test.mjs
 */

import {
  resolveConversationRuntime,
  resolveRequestConversationRuntime,
  normalizeEngine,
  isDeveloperModeEnabled,
  DEFAULT_CONVERSATION_RUNTIME,
  CONVERSATION_RUNTIME_ENV,
} from './resolve-runtime.js'
import {
  mapV2ResultToChatResponse,
  mapV2ErrorToChatResponse,
  sanitizeChatMessages,
  buildV2TurnInput,
  parseChatBody,
  buildV2DebugInfo,
} from './run-v2.js'
import { createWriterError } from '../v2/brain/writer.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`ok  - ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL - ${name}`)
    console.error(err?.message || err)
  }
}

/**
 * @param {boolean} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

/**
 * @param {any} a
 * @param {any} b
 * @param {string} msg
 */
function assertEqual(a, b, msg) {
  if (a !== b) {
    throw new Error(
      `${msg || 'equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    )
  }
}

console.log('Conversation runtime tests\n')

test('env unset → v1', () => {
  assertEqual(resolveConversationRuntime({}), 'v1', 'empty env')
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: undefined }),
    'v1',
    'undefined',
  )
  assertEqual(DEFAULT_CONVERSATION_RUNTIME, 'v1', 'default const')
})

test('env=v1 → v1', () => {
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: 'v1' }),
    'v1',
    'v1',
  )
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: ' V1 ' }),
    'v1',
    'trim/case',
  )
})

test('env=v2 → v2', () => {
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: 'v2' }),
    'v2',
    'v2',
  )
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: 'V2' }),
    'v2',
    'case',
  )
})

test('invalid env → v1', () => {
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: 'v3' }),
    'v1',
    'v3',
  )
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: 'experimental' }),
    'v1',
    'experimental',
  )
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: '' }),
    'v1',
    'empty string',
  )
  assertEqual(
    resolveConversationRuntime({ [CONVERSATION_RUNTIME_ENV]: '  ' }),
    'v1',
    'whitespace',
  )
})

test('env only (no body) → uses env', () => {
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v2' },
      body: {},
    }),
    'v2',
    'env v2',
  )
  assertEqual(
    resolveRequestConversationRuntime({
      env: {},
      body: undefined,
    }),
    'v1',
    'default',
  )
})

test('request.engine overrides env when Developer Mode ON', () => {
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v1' },
      body: { developerMode: true, engine: 'v2' },
    }),
    'v2',
    'engine v2 overrides env v1',
  )
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v2' },
      body: { developerMode: true, engine: 'v1' },
    }),
    'v1',
    'engine v1 overrides env v2',
  )
})

test('Developer Mode OFF ignores request.engine', () => {
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v1' },
      body: { engine: 'v2' },
    }),
    'v1',
    'no developerMode',
  )
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v1' },
      body: { developerMode: false, engine: 'v2' },
    }),
    'v1',
    'developerMode false',
  )
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v2' },
      body: { developerMode: 1, engine: 'v1' },
    }),
    'v2',
    'non-boolean developerMode ignored',
  )
  assertEqual(isDeveloperModeEnabled({ developerMode: true }), true, 'enabled')
  assertEqual(isDeveloperModeEnabled({}), false, 'missing')
})

test('invalid engine falls back correctly', () => {
  assertEqual(normalizeEngine('v3'), null, 'normalize v3')
  assertEqual(normalizeEngine(''), null, 'normalize empty')
  assertEqual(normalizeEngine('V2'), 'v2', 'normalize V2')
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v2' },
      body: { developerMode: true, engine: 'nope' },
    }),
    'v2',
    'invalid → env',
  )
  assertEqual(
    resolveRequestConversationRuntime({
      env: {},
      body: { developerMode: true, engine: 'experimental' },
    }),
    'v1',
    'invalid → default',
  )
})

test('old clients continue working (no engine / no developerMode)', () => {
  assertEqual(
    resolveRequestConversationRuntime({
      env: {},
      body: { messages: [{ role: 'user', content: 'hi' }] },
    }),
    'v1',
    'legacy body',
  )
  assertEqual(
    resolveRequestConversationRuntime({
      env: { [CONVERSATION_RUNTIME_ENV]: 'v2' },
      body: { messages: [] },
    }),
    'v2',
    'legacy + env v2',
  )
})

test('sanitizeChatMessages keeps user/assistant', () => {
  const msgs = sanitizeChatMessages([
    { role: 'system', content: 'x' },
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: 'Hey' },
    { role: 'tool', content: 'nope' },
    { role: 'user', content: '  ' },
  ])
  assertEqual(msgs.length, 3, 'count')
  assertEqual(msgs[1].content, 'Ciao', 'user')
})

test('buildV2TurnInput extracts last user', () => {
  const turn = buildV2TurnInput([
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'What is entropy?' },
  ])
  assertEqual(turn.userMessage, 'What is entropy?', 'last user')
  assertEqual(turn.messages.length, 3, 'history')
})

test('parseChatBody accepts object and JSON string', () => {
  assertEqual(parseChatBody({ a: 1 }).a, 1, 'object')
  assertEqual(parseChatBody('{"b":2}').b, 2, 'string')
  let threw = false
  try {
    parseChatBody('{')
  } catch {
    threw = true
  }
  assert(threw, 'invalid json throws')
})

test('mapV2ResultToChatResponse maps text → content + runtime', () => {
  const payload = mapV2ResultToChatResponse({
    pipelineResult: {
      response: { text: '  Hello world  ' },
      perception: { intent: 'chat' },
      decision: { strategy: 'continue' },
      plan: { objective: 'help' },
      nextConversationState: {
        activeTopic: 'entropy',
        conversationPhase: 'deepening',
        pendingProposal: null,
        shortReply: { intent: null, confidence: null },
        continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
        references: { unresolved: [] },
      },
    },
    requestBody: {
      learningSignals: { directive: 'keep' },
      welcomeSession: { n: 1 },
    },
    runtime: 'v2',
  })
  assertEqual(payload.content, 'Hello world', 'content')
  assertEqual(payload.runtime, 'v2', 'runtime')
  assertEqual(payload.memoryEvent, null, 'memory')
  assertEqual(payload.learningSignals.directive, 'keep', 'echo learning')
  assertEqual(payload.welcomeSession.n, 1, 'echo welcome')
  assertEqual(payload.v2Debug?.servedBy, 'v2', 'v2Debug')
  assertEqual(payload.conversationState?.activeTopic, 'entropy', 'persist state echo')
  assertEqual(payload.v2Debug?.conversationState?.activeTopic, 'entropy', 'debug state')
})

test('mapV2ResultToChatResponse rejects empty text', () => {
  let threw = false
  try {
    mapV2ResultToChatResponse({ pipelineResult: { response: { text: '  ' } } })
  } catch (err) {
    threw = true
    assertEqual(/** @type {any} */ (err).statusCode, 502, 'status')
  }
  assert(threw, 'throws')
})

test('buildV2DebugInfo returns servedBy v2', () => {
  const debug = buildV2DebugInfo({
    response: { text: 'hi', model: 'gpt' },
    perception: { a: 1 },
  })
  assertEqual(debug?.servedBy, 'v2', 'servedBy')
  assertEqual(debug?.writer?.model, 'gpt', 'model')
})

test('mapV2ErrorToChatResponse maps WriterError', () => {
  const mapped = mapV2ErrorToChatResponse(
    createWriterError({ code: 'timeout', message: 'took too long' }),
  )
  assertEqual(mapped.status, 504, 'timeout status')
  assertEqual(mapped.payload.error, 'took too long', 'message')
  assertEqual(mapped.payload.code, 'timeout', 'code')
})

test('mapV2ErrorToChatResponse maps generic Error', () => {
  const mapped = mapV2ErrorToChatResponse(new Error('boom'))
  assertEqual(mapped.status, 500, '500')
  assertEqual(mapped.payload.error, 'boom', 'msg')
})

test('mapV2ErrorToChatResponse maps statusCode on error', () => {
  const err = Object.assign(new Error('bad'), { statusCode: 400, code: 'bad_json' })
  const mapped = mapV2ErrorToChatResponse(err)
  assertEqual(mapped.status, 400, '400')
  assertEqual(mapped.payload.code, 'bad_json', 'code')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
