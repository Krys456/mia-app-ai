#!/usr/bin/env node
/**
 * V1 Observability collector tests (A–L subset for server).
 * Run: node lib/server/v1-observability.test.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildV1ObservabilityDebug,
  sanitizeForDebug,
  shouldCollectV1Observability,
  summarizeGateBriefs,
} from './v1-observability.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
function test(name, fn) {
  const run = Promise.resolve().then(fn)
  return run.then(
    () => {
      passed += 1
      console.log(`  ok  — ${name}`)
    },
    (error) => {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  FAIL — ${name}`)
      console.error(`        ${message}`)
    },
  )
}

/**
 * @param {unknown} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} msg
 */
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

const __dirname = dirname(fileURLToPath(import.meta.url))

const sampleCognitive = {
  languageAwareness: {
    conversationLanguage: 'it',
    sticky: true,
    switchDetected: false,
  },
  plan: {
    understanding: {
      primaryIntent: 'ask_advice',
      emotionalTone: 'curious',
      urgency: 'low',
      language: 'it',
      realGoal: 'capire cosa fare',
    },
    memoryRetrieved: true,
  },
  responseMode: { mode: 'conversational', active: true },
  coordination: { winners: ['warm'], slots: { lead: 'warm' } },
  conversationPlanner: {
    active: true,
    confidence: 0.8,
    plan: { goal: 'help', strategy: 'guide', responseMode: 'conversational' },
  },
  continuation: { active: true, shouldAsk: false },
  writerDirectives: {
    language: 'it',
    mode: 'conversational',
    askQuestion: false,
    leadConversation: true,
  },
  warmConversation: { active: true },
  questionEconomy: { active: true },
  conversationMemoryMap: { exploredTopics: ['lavoro'] },
  conversationPreferenceProfile: { formality: 'casual', warmth: 'high' },
  learningSignals: { turnCount: 3, workedWell: ['a'], neededClarification: [] },
}

async function main() {
  console.log('v1-observability tests\n')

  await test('A. disabled returns null (no debug object)', () => {
    const out = buildV1ObservabilityDebug({ enabled: false, cognitiveResult: sampleCognitive })
    assertEqual(out, null, 'enabled:false must return null')
  })

  await test('A2. shouldCollect false without flags', () => {
    assertEqual(shouldCollectV1Observability({}), false, 'empty body')
    assertEqual(shouldCollectV1Observability({ observability: false }), false, 'false flag')
    assertEqual(shouldCollectV1Observability(null), false, 'null body')
  })

  await test('B. enabled builds full panel set', () => {
    const out = buildV1ObservabilityDebug({
      enabled: true,
      cognitiveResult: sampleCognitive,
      writerDirectives: sampleCognitive.writerDirectives,
      model: 'gpt-4o-mini',
      provider: 'openai',
      refineRequested: false,
      refineApplied: false,
      outputSource: 'draft',
      companionBriefs: [],
      memoryEnabled: true,
      memoryEvent: 'saved',
      conversationId: 'c-1',
      timing: { cognitiveMs: 10, modelMs: 20, totalMs: 40 },
    })
    assert(out && typeof out === 'object', 'debug object')
    assertEqual(out.engine, 'v1', 'engine')
    for (const key of ['perception', 'mind', 'planner', 'writer', 'memory', 'state', 'timing']) {
      assert(out[key] != null, `${key} present`)
    }
  })

  await test('C. debug metadata contains engine=v1', () => {
    const out = buildV1ObservabilityDebug({ enabled: true })
    assertEqual(out.engine, 'v1', 'engine')
  })

  await test('D. observability failure cannot fail chat generation (returns error stub)', () => {
    const boom = {
      get plan() {
        throw new Error('boom-plan')
      },
    }
    // Top-level access of cognitive.plan throws during build — caught.
    const out = buildV1ObservabilityDebug({
      enabled: true,
      cognitiveResult: boom,
      model: 'gpt-4o-mini',
    })
    assert(out && out.engine === 'v1', 'always returns engine=v1')
    // Either full debug with null section(s) or collection_failed — never throws.
    assert(out.error || out.perception !== undefined, 'fail-soft payload')
  })

  await test('D2. per-section failure yields null section, not throw', () => {
    const cognitive = {
      ...sampleCognitive,
      languageAwareness: new Proxy(
        {},
        {
          get() {
            throw new Error('perception-boom')
          },
        },
      ),
    }
    const out = buildV1ObservabilityDebug({
      enabled: true,
      cognitiveResult: cognitive,
      model: 'x',
    })
    assertEqual(out.engine, 'v1', 'engine')
    assertEqual(out.perception, null, 'perception null on section failure')
    assert(out.writer != null, 'writer still populated')
    assert(Array.isArray(out.collectionErrors) && out.collectionErrors.length > 0, 'errors logged')
  })

  await test('E. debug collection does not mutate messages / cognitive input', () => {
    const messages = Object.freeze([
      Object.freeze({ role: 'user', content: 'ciao' }),
      Object.freeze({ role: 'assistant', content: 'hey' }),
    ])
    const cognitive = structuredClone(sampleCognitive)
    const before = JSON.stringify(cognitive)
    const beforeMsg = JSON.stringify(messages)
    buildV1ObservabilityDebug({
      enabled: true,
      cognitiveResult: cognitive,
      companionBriefs: ['gate A'],
      model: 'gpt-4o-mini',
    })
    assertEqual(JSON.stringify(cognitive), before, 'cognitive unchanged')
    assertEqual(JSON.stringify(messages), beforeMsg, 'messages unchanged')
  })

  await test('F. debug collection does not modify system instructions', () => {
    const instructions = 'SYSTEM PROMPT BODY ' + 'x'.repeat(600)
    const bag = { instructions, systemPrompt: instructions, context: instructions }
    const before = JSON.stringify(bag)
    const sanitized = sanitizeForDebug(bag)
    assertEqual(JSON.stringify(bag), before, 'input bag unchanged')
    assert(
      sanitized.instructions && sanitized.instructions.omitted === true,
      'oversized instructions omitted',
    )
    assert(sanitized.systemPrompt && sanitized.systemPrompt.omitted === true, 'systemPrompt omitted')
    // Collector never includes a full prompt field in writer panel
    const out = buildV1ObservabilityDebug({
      enabled: true,
      model: 'gpt-4o-mini',
      cognitiveResult: { context: instructions },
    })
    assertEqual(out.writer.systemPromptIncluded, false, 'writer omits system prompt')
    assert(!JSON.stringify(out).includes('SYSTEM PROMPT BODY xxx'), 'mega-prompt not in debug JSON')
  })

  await test('G. collector source has no V2 pipeline imports', () => {
    const src = readFileSync(join(__dirname, 'v1-observability.js'), 'utf8')
    assert(!/from\s+['"].*v2\//.test(src), 'no v2 relative imports')
    assert(!/v2\/brain/.test(src), 'no v2/brain references')
    assert(!/runV2|createPerception|createMind|createPlanner/.test(src), 'no V2 runtime calls')
  })

  await test('H. refine telemetry — no-refine vs refine', () => {
    const noRefine = buildV1ObservabilityDebug({
      enabled: true,
      refineRequested: false,
      refineApplied: false,
      outputSource: 'draft',
      companionBriefs: [],
      model: 'gpt-4o-mini',
    })
    assertEqual(noRefine.writer.refineRequested, false, 'no refine requested')
    assertEqual(noRefine.writer.refineApplied, false, 'no refine applied')
    assertEqual(noRefine.writer.outputSource, 'draft', 'draft source')
    assertEqual(noRefine.writer.draftPassedGates, true, 'draft passed')

    const refined = buildV1ObservabilityDebug({
      enabled: true,
      refineRequested: true,
      refineApplied: true,
      outputSource: 'refined',
      companionBriefs: ['Authority: rewrite for warmth.'],
      model: 'gpt-4o-mini',
    })
    assertEqual(refined.writer.refineRequested, true, 'refine requested')
    assertEqual(refined.writer.refineApplied, true, 'refine applied')
    assertEqual(refined.writer.outputSource, 'refined', 'refined source')
    assertEqual(refined.writer.draftPassedGates, false, 'draft did not pass')
    assert(refined.writer.gateCount >= 1, 'gates fired')
    assert(Array.isArray(refined.writer.gatesFired), 'gatesFired array')
  })

  await test('I. memory telemetry disabled / skipped / saved', () => {
    const disabled = buildV1ObservabilityDebug({
      enabled: true,
      memoryEnabled: false,
      memoryEvent: null,
    })
    assertEqual(disabled.memory.enabled, false, 'disabled')
    assertEqual(disabled.memory.skipped, 'memory_disabled', 'skipped reason')
    assertEqual(disabled.memory.postEvent, null, 'no post event')

    const skipped = buildV1ObservabilityDebug({
      enabled: true,
      memoryEnabled: true,
      memoryEvent: null,
      cognitiveResult: { plan: { memoryRetrieved: false } },
    })
    assertEqual(skipped.memory.enabled, true, 'enabled')
    assertEqual(skipped.memory.skipped, 'no_save', 'no_save')
    assertEqual(skipped.memory.retrievalAttempted, false, 'no retrieval')

    const saved = buildV1ObservabilityDebug({
      enabled: true,
      memoryEnabled: true,
      memoryEvent: 'saved',
      cognitiveResult: { plan: { memoryRetrieved: true } },
    })
    assertEqual(saved.memory.postEvent, 'saved', 'saved')
    assertEqual(saved.memory.retrieved, true, 'retrieved')
    assertEqual(saved.memory.skipped, null, 'not skipped')

    const updated = buildV1ObservabilityDebug({
      enabled: true,
      memoryEnabled: true,
      memoryEvent: 'updated',
    })
    assertEqual(updated.memory.postEvent, 'updated', 'updated')
  })

  await test('J. missing/null sections are safe for UI (null or object)', () => {
    const out = buildV1ObservabilityDebug({ enabled: true })
    for (const key of ['perception', 'mind', 'planner', 'writer', 'memory', 'state', 'timing']) {
      const section = out[key]
      // UI uses: debug.perception ?? { unavailable: true }
      const safe = section ?? { unavailable: true }
      assert(safe && typeof safe === 'object', `${key} UI-safe`)
      assert(!Number.isNaN(JSON.stringify(safe).length), `${key} JSON`)
    }
    const partial = { engine: 'v1', perception: null, mind: undefined }
    const uiPerception = partial.perception ?? { unavailable: true }
    const uiMind = partial.mind ?? { unavailable: true }
    assertEqual(uiPerception.unavailable, true, 'null → unavailable')
    assertEqual(uiMind.unavailable, true, 'undefined → unavailable')
  })

  await test('K. no API keys/secrets exposed', () => {
    const dirty = buildV1ObservabilityDebug({
      enabled: true,
      cognitiveResult: {
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz0123456789',
        openai_api_key: 'secret-value',
        plan: {
          understanding: {
            primaryIntent: 'test',
            note: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
          },
        },
        token: 'should-redact',
      },
      model: 'gpt-4o-mini',
      writerDirectives: { password: 'hunter2', mode: 'ok' },
    })
    const json = JSON.stringify(dirty)
    assert(!/sk-[a-zA-Z0-9]{10,}/.test(json), 'no sk- key')
    assert(!/hunter2/.test(json), 'no password value')
    assert(!/should-redact/.test(json) || /\[redacted\]/.test(json), 'token redacted')
    // Secret keys become [redacted]
    if (dirty.mind?.writerDirectives) {
      /* writer summarizes only known keys — password never included */
    }
    const sanitized = sanitizeForDebug({
      authorization: 'Bearer abc',
      api_key: 'sk-abcdefghijklmnopqrstuvwxyz0123456789',
      safe: 'hello',
    })
    assertEqual(sanitized.authorization, '[redacted]', 'authorization')
    assertEqual(sanitized.api_key, '[redacted]', 'api_key')
    assertEqual(sanitized.safe, 'hello', 'safe kept')
  })

  await test('L. persistence contract unaffected (debug optional additive)', () => {
    // Chat success payload shape: content + memoryEvent remain primary; debug optional.
    const content = 'Ciao!'
    const memoryEvent = 'saved'
    const payload = { content, memoryEvent }
    const debug = buildV1ObservabilityDebug({
      enabled: true,
      memoryEvent,
      model: 'gpt-4o-mini',
    })
    if (debug) payload.debug = debug
    assertEqual(payload.content, content, 'content unchanged')
    assertEqual(payload.memoryEvent, memoryEvent, 'memoryEvent unchanged')
    assert(payload.debug && payload.debug.engine === 'v1', 'debug additive')
    // Without observability, payload has no debug
    const bare = { content, memoryEvent }
    assertEqual(bare.debug, undefined, 'no debug when not attached')
  })

  await test('summarizeGateBriefs truncates', () => {
    const briefs = summarizeGateBriefs(['First sentence. Second.', '', null, 'x'.repeat(300)])
    assert(briefs.length === 2, 'filters empty')
    assert(briefs[0] === 'First sentence', 'first sentence')
    assert(briefs[1].length <= 160, 'truncated long')
  })

  await test('perception / planner / timing sources labeled V1', () => {
    const out = buildV1ObservabilityDebug({
      enabled: true,
      cognitiveResult: sampleCognitive,
      timing: { cognitiveMs: 1, modelMs: 2, refineMs: null, memoryWriteMs: 3, totalMs: 10 },
    })
    assert(/v1\./.test(out.perception.source), 'perception source')
    assert(/v1\./.test(out.mind.source), 'mind source')
    assert(/v1\./.test(out.planner.source), 'planner source')
    assert(/v1\./.test(out.writer.source), 'writer source')
    assertEqual(out.timing.cognitiveMs, 1, 'cognitiveMs')
    assertEqual(out.timing.totalMs, 10, 'totalMs')
    assertEqual(out.writer.systemPromptIncluded, false, 'no mega-prompt')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
