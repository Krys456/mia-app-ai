#!/usr/bin/env node
/**
 * Tests for LAIFE_ENGINE feature flag.
 * Run: node lib/server/v2/runtime/laife-engine.test.mjs
 */

import {
  resolveLaifeEngine,
  resolveRequestEngine,
  isLaifeEngineV2,
  LAIFE_ENGINE_V1,
  LAIFE_ENGINE_V2,
} from './laife-engine.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL — ${name}`)
    console.error(`        ${error instanceof Error ? error.message : error}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
  }
}

console.log('\nLAIFE_ENGINE flag tests\n')

test('default / empty → v1', () => {
  assertEqual(resolveLaifeEngine(''), LAIFE_ENGINE_V1, 'empty')
  assertEqual(resolveLaifeEngine(undefined), LAIFE_ENGINE_V1, 'undefined')
  assertEqual(resolveLaifeEngine(null), LAIFE_ENGINE_V1, 'null')
  assertEqual(isLaifeEngineV2(''), false, 'isV2 empty')
})

test('explicit v1', () => {
  assertEqual(resolveLaifeEngine('v1'), LAIFE_ENGINE_V1, 'v1')
  assertEqual(resolveLaifeEngine('V1'), LAIFE_ENGINE_V1, 'V1')
  assertEqual(resolveLaifeEngine(' v1 '), LAIFE_ENGINE_V1, 'padded')
})

test('explicit v2', () => {
  assertEqual(resolveLaifeEngine('v2'), LAIFE_ENGINE_V2, 'v2')
  assertEqual(resolveLaifeEngine('V2'), LAIFE_ENGINE_V2, 'V2')
  assertEqual(isLaifeEngineV2('v2'), true, 'isV2')
})

test('unknown values safely fall back to v1', () => {
  assertEqual(resolveLaifeEngine('v3'), LAIFE_ENGINE_V1, 'v3')
  assertEqual(resolveLaifeEngine('legacy'), LAIFE_ENGINE_V1, 'legacy')
  assertEqual(resolveLaifeEngine('true'), LAIFE_ENGINE_V1, 'true')
  assertEqual(isLaifeEngineV2('nope'), false, 'isV2 unknown')
})

test('resolveRequestEngine: body.engine wins over env', () => {
  assertEqual(resolveRequestEngine('v2', 'v1'), LAIFE_ENGINE_V2, 'body v2 wins')
  assertEqual(resolveRequestEngine('v1', 'v2'), LAIFE_ENGINE_V1, 'body v1 wins')
  assertEqual(resolveRequestEngine('V2', 'v1'), LAIFE_ENGINE_V2, 'body V2 case')
})

test('resolveRequestEngine: missing/invalid body falls back to env', () => {
  assertEqual(resolveRequestEngine(undefined, 'v2'), LAIFE_ENGINE_V2, 'env v2')
  assertEqual(resolveRequestEngine('', 'v1'), LAIFE_ENGINE_V1, 'env v1')
  assertEqual(resolveRequestEngine('nope', 'v2'), LAIFE_ENGINE_V2, 'invalid body → env')
  assertEqual(resolveRequestEngine(null, ''), LAIFE_ENGINE_V1, 'empty env → v1')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
