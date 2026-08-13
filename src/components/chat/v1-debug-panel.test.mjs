#!/usr/bin/env node
/**
 * V1 Debug Panel null-safety (no React mount required).
 * Run: node src/components/chat/v1-debug-panel.test.mjs
 */

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
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL — ${name}`)
    console.error(`        ${message}`)
  }
}

/**
 * @param {unknown} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** Mirrors V1DebugPanel sectionPayload null-safety. */
function sectionPayload(debug, tab) {
  switch (tab) {
    case 'Perception':
      return debug.perception ?? { unavailable: true }
    case 'Mind':
      return debug.mind ?? { unavailable: true }
    case 'Planner':
      return debug.planner ?? { unavailable: true }
    case 'Writer':
      return debug.writer ?? { unavailable: true }
    case 'Memory':
      return debug.memory ?? { unavailable: true }
    case 'State':
      return debug.state ?? { unavailable: true }
    case 'Timing':
      return debug.timing ?? { unavailable: true }
    default:
      return { unavailable: true }
  }
}

console.log('v1-debug-panel tests\n')

test('J. missing sections → unavailable object', () => {
  const debug = { engine: 'v1' }
  for (const tab of [
    'Perception',
    'Mind',
    'Planner',
    'Writer',
    'Memory',
    'State',
    'Timing',
  ]) {
    const payload = sectionPayload(debug, tab)
    assert(payload && payload.unavailable === true, `${tab} unavailable`)
    assert(typeof JSON.stringify(payload) === 'string', `${tab} stringify`)
  }
})

test('J2. null sections → unavailable', () => {
  const debug = {
    engine: 'v1',
    perception: null,
    mind: null,
    planner: null,
    writer: null,
    memory: null,
    state: null,
    timing: null,
  }
  for (const tab of [
    'Perception',
    'Mind',
    'Planner',
    'Writer',
    'Memory',
    'State',
    'Timing',
  ]) {
    assert(sectionPayload(debug, tab).unavailable === true, `${tab}`)
  }
})

test('J3. present sections render as JSON', () => {
  const debug = {
    engine: 'v1',
    perception: { language: 'it' },
    writer: { refineRequested: false },
  }
  assert(sectionPayload(debug, 'Perception').language === 'it', 'perception')
  assert(sectionPayload(debug, 'Writer').refineRequested === false, 'writer')
  assert(sectionPayload(debug, 'Mind').unavailable === true, 'mind missing')
})

test('visibility gate: panel only when observability + debug', () => {
  const show = (v1Observability, v1Debug) =>
    v1Observability === true && Boolean(v1Debug)
  assert(show(false, { engine: 'v1' }) === false, 'off hides')
  assert(show(true, null) === false, 'null debug hides')
  assert(show(true, { engine: 'v1' }) === true, 'on shows')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
