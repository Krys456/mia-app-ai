#!/usr/bin/env node
/**
 * Tests for runtime-profile (Sprint 1).
 * Run: node lib/server/v2/brain/runtime-profile.test.mjs
 */

import {
  RuntimeProfiles,
  DEFAULT_RUNTIME_PROFILE,
  resolveRuntimeProfile,
  getPrincipleFlags,
} from './runtime-profile.js'

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

console.log('Runtime-profile tests\n')

test('production disables validated principles', () => {
  const p = RuntimeProfiles.production
  assertEqual(p.useExplorationPrinciples, false, 'exploration')
  assertEqual(p.useLearningPrinciples, false, 'learning')
  assertEqual(p.usePlanningPrinciples, false, 'planning')
})

test('experimental enables exploration + learning + planning only', () => {
  const p = RuntimeProfiles.experimental
  assertEqual(p.useExplorationPrinciples, true, 'exploration')
  assertEqual(p.useLearningPrinciples, true, 'learning')
  assertEqual(p.usePlanningPrinciples, true, 'planning')
})

test('default profile is production', () => {
  assertEqual(DEFAULT_RUNTIME_PROFILE, 'production', 'default')
  const resolved = resolveRuntimeProfile()
  assertEqual(resolved.name, 'production', 'name')
  assertEqual(resolved.useExplorationPrinciples, false, 'off')
})

test('resolveRuntimeProfile experimental', () => {
  const r = resolveRuntimeProfile('experimental')
  assertEqual(r.name, 'experimental', 'name')
  assertEqual(r.usePlanningPrinciples, true, 'planning on')
})

test('getPrincipleFlags mirrors resolve', () => {
  const f = getPrincipleFlags('experimental')
  assertEqual(f.useExplorationPrinciples, true, 'exp')
  assertEqual(f.useLearningPrinciples, true, 'learn')
  assertEqual(f.usePlanningPrinciples, true, 'plan')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
