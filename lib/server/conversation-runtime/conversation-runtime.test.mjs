#!/usr/bin/env node
/**
 * Tests for conversation runtime switch.
 * Run: node lib/server/conversation-runtime/conversation-runtime.test.mjs
 */

import {
  resolveConversationRuntime,
  DEFAULT_CONVERSATION_RUNTIME,
  CONVERSATION_RUNTIME_ENV,
} from './resolve-runtime.js'
import {
  mapV2ResultToChatResponse,
  mapV2ErrorToChatResponse,
  sanitizeChatMessages,
  buildV2TurnInput,
  parseChatBody,
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

test('mapV2ResultToChatResponse maps text → content', () => {
  const payload = mapV2ResultToChatResponse({
    pipelineResult: { response: { text: '  Hello world  ' } },
    requestBody: {
      learningSignals: { directive: 'keep' },
      welcomeSession: { n: 1 },
    },
  })
  assertEqual(payload.content, 'Hello world', 'content')
  assertEqual(payload.memoryEvent, null, 'memory')
  assertEqual(payload.learningSignals.directive, 'keep', 'echo learning')
  assertEqual(payload.welcomeSession.n, 1, 'echo welcome')
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
