/**
 * #364C — Local capability awareness appendix tests.
 * Run: node lib/server/local-capability-awareness-appendix.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LOCAL_CAPABILITY_AWARENESS_BUILD,
  buildLocalCapabilityAwarenessAppendix,
  isLocalCapabilityRelevantText,
  shouldInjectLocalCapabilityAwareness,
} from './local-capability-awareness-appendix.js'

assert.equal(LOCAL_CAPABILITY_AWARENESS_BUILD, '364c-1')

// A/B/C mixed cases → inject
for (const q of [
  'Quanto fa 12×8 e secondo te 8 ripetizioni sono troppe?',
  'Imposta un timer di 90 secondi e secondo te recuperare 90 secondi tra le serie è sufficiente?',
  'Ricordami domani alle 9 di allenarmi e dimmi se 3×6 va bene.',
  "Allora sto rifacendo la scheda: meglio 6 o 8 ripetizioni? e 'the right spot' come si dice in inglese?",
]) {
  assert.equal(isLocalCapabilityRelevantText(q), true, q)
  const a = buildLocalCapabilityAwarenessAppendix({ userMessage: q })
  assert.ok(a.includes('LOCAL CAPABILITIES'))
  assert.ok(/NEVER say you cannot set timers/i.test(a))
  assert.ok(/NEVER claim a timer started/i.test(a))
  assert.ok(/mixed message/i.test(a))
}

// E/F pure capability asks also inject (honesty if somehow on Core; cheap)
assert.ok(shouldInjectLocalCapabilityAwareness({ userMessage: 'Imposta un timer di 90 secondi.' }))
assert.ok(shouldInjectLocalCapabilityAwareness({ userMessage: 'Ricordami domani alle 9 di allenarmi.' }))

// Unrelated chat → no inject
assert.equal(
  buildLocalCapabilityAwarenessAppendix({ userMessage: 'Secondo te meglio correre o camminare?' }),
  '',
)

// Contract: no action authorization language
const appendix = buildLocalCapabilityAwarenessAppendix()
assert.ok(/NEVER triggers actions/i.test(appendix))
assert.ok(!/execute now|call the api|invoke router/i.test(appendix))

// Wired into api/chat.ts
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
assert.ok(chat.includes('buildLocalCapabilityAwarenessAppendix'))
assert.ok(chat.includes('local-capability-awareness-appendix'))

// #364B gate still present (stacked)
assert.ok(
  readFileSync(join(root, 'src/lib/mixed-intent-gate.js'), 'utf8').includes(
    'shouldLocalRouterClaimWholeTurn',
  ),
)

console.log('local-capability-awareness-appendix.test.mjs: ok')
