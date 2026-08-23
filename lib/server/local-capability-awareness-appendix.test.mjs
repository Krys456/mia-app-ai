/**
 * #364C/#366B — Local capability awareness appendix tests.
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

assert.equal(LOCAL_CAPABILITY_AWARENESS_BUILD, '366b-1')

const appendix = buildLocalCapabilityAwarenessAppendix()

// —— Truth / execution safety preserved ——
assert.ok(/NEVER say you cannot set timers/i.test(appendix))
assert.ok(/NEVER claim a timer started/i.test(appendix))
assert.ok(/NEVER triggers actions/i.test(appendix))
assert.ok(/reminders|timer/i.test(appendix))

// —— #366B register: forbid system-language guidance for user prose ——
assert.ok(/TRUTH ≠ INTERNAL JARGON|User-facing register/i.test(appendix))
assert.ok(/in questo turno/i.test(appendix), 'must name the forbidden phrase')
assert.ok(/non (?:è stato|sono stati) eseguit/i.test(appendix))
assert.ok(/FORBIDDEN in normal user-facing prose/i.test(appendix))
assert.ok(/Mandami timer e promemoria|mandami il timer da solo/i.test(appendix))
assert.ok(/answer the conversational substance/i.test(appendix))
// Must NOT instruct the model to narrate non-execution in status-report voice
assert.ok(!/state clearly it was not executed in this turn/i.test(appendix))
assert.ok(!/dedicated single-purpose request to run it/i.test(appendix))

// —— A/B mixed cases → inject ——
for (const q of [
  'Imposta un timer di 90 secondi e secondo te recuperare 90 secondi tra le serie è sufficiente?',
  'Ricordami domani alle 9 di allenarmi e dimmi se 3×6 va bene.',
  'Quanto fa 12×8 e secondo te 8 ripetizioni sono troppe?',
  "Allora sto rifacendo la scheda: meglio 6 o 8 ripetizioni? e 'the right spot' come si dice in inglese?",
]) {
  assert.equal(isLocalCapabilityRelevantText(q), true, q)
  const a = buildLocalCapabilityAwarenessAppendix({ userMessage: q })
  assert.ok(a.includes('LOCAL CAPABILITIES'))
  assert.ok(/FORBIDDEN in normal user-facing prose/i.test(a))
  assert.ok(/NEVER claim a timer started/i.test(a))
}

// —— C/D/E style cues: Base reinforces collaborator register ——
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const base = readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8')
assert.ok(
  /speak like a collaborator|internal status report/i.test(base),
  'Base should reinforce natural capability phrasing',
)

// Pure capability asks still inject (honesty if on Core)
assert.ok(shouldInjectLocalCapabilityAwareness({ userMessage: 'Imposta un timer di 90 secondi.' }))
assert.ok(shouldInjectLocalCapabilityAwareness({ userMessage: 'Ricordami domani alle 9 di allenarmi.' }))

// Unrelated chat → no inject
assert.equal(
  buildLocalCapabilityAwarenessAppendix({ userMessage: 'Secondo te meglio correre o camminare?' }),
  '',
)

// Wired into api/chat.ts
const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
assert.ok(chat.includes('buildLocalCapabilityAwarenessAppendix'))
assert.ok(chat.includes('local-capability-awareness-appendix'))

// #364B gate still present
assert.ok(
  readFileSync(join(root, 'src/lib/mixed-intent-gate.js'), 'utf8').includes(
    'shouldLocalRouterClaimWholeTurn',
  ),
)

console.log('local-capability-awareness-appendix.test.mjs: ok')
