/**
 * #367B — Micro-rhythm / compression / callback polish.
 * Run: node lib/server/micro-rhythm-367b.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_STATE_BUILD,
  buildConversationStateAppendix,
  computeConversationState,
  looksLikeCompletionCue,
} from './conversation-state.js'
import {
  CONVERSATION_CONTINUITY_BUILD,
  CONVERSATION_CONTINUITY_CONTRACT,
} from './conversation-continuity.js'
import {
  NATURAL_RESPONSE_POLICY_BUILD,
  NATURAL_RESPONSE_POLICY_CONTRACT,
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
} from './natural-response-policy.js'
import { LOCAL_CAPABILITY_AWARENESS_BUILD } from './local-capability-awareness-appendix.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

assert.equal(CONVERSATION_STATE_BUILD, '367b-1')
assert.equal(NATURAL_RESPONSE_POLICY_BUILD, '367b-1')
assert.equal(CONVERSATION_CONTINUITY_BUILD, '367b-1')
assert.equal(LOCAL_CAPABILITY_AWARENESS_BUILD, '366b-1')

function stateFor(userMessage, recentMessages) {
  return computeConversationState({
    userMessage,
    recentMessages: recentMessages || [{ role: 'user', content: userMessage }],
  })
}

function assertMicro(label, userMessage, recentMessages) {
  const s = stateFor(userMessage, recentMessages)
  assert.equal(looksLikeCompletionCue(userMessage), true, `${label}: cue`)
  assert.equal(s.completionCueDetected, true, `${label}: completionCueDetected`)
  assert.equal(s.desiredDepth, 'short', `${label}: depth`)
  assert.equal(s.structurePreference, 'prose', `${label}: prose`)
  assert.equal(s.initiativeLevel, 'low', `${label}: initiative`)
  assert.equal(s.questionNeeded, false, `${label}: question`)
  assert.equal(s.responsePurpose, 'react', `${label}: purpose`)
  const app = buildConversationStateAppendix(s)
  assert.match(app, /completion_signal: true/)
  assert.match(app, /micro close OK/i)
}

// —— A understanding closure ——
{
  const hist = [
    { role: 'user', content: "Cos'è OAuth?" },
    { role: 'assistant', content: 'OAuth è…' },
    { role: 'user', content: 'Non ho capito' },
    { role: 'assistant', content: 'In pratica…' },
    { role: 'user', content: 'Fammi un esempio' },
    { role: 'assistant', content: 'Esempio…' },
  ]
  assertMicro('A', 'Ahhh, ora ho capito', [...hist, { role: 'user', content: 'Ahhh, ora ho capito' }])
}

// —— B simple Ok ——
assertMicro('B', 'Ok')

// —— C/D false completion ——
for (const u of [
  'Ok ma perché?',
  'Fatto, però ora non funziona.',
  'Fatto, ma non funziona',
  'Ho capito, ma perché?',
  'Capito. E il secondo?',
  'Perfetto, quindi faccio merge?',
  'Got it, but why?',
]) {
  assert.equal(looksLikeCompletionCue(u), false, `false completion: ${u}`)
  assert.equal(stateFor(u).completionCueDetected, false, `false completionDetected: ${u}`)
}

// —— E Done ——
assertMicro('E', 'Fatto')

// —— F decision prose-first ——
{
  const s = stateFor('La PR ha passato tutti i test. Faccio merge?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.structurePreference, 'prose')
  assert.ok(s.confidence === 'high' || s.confidence === 'medium')
}

// —— J informational prose ——
{
  const s = stateFor("Cos'è OAuth?")
  assert.equal(s.conversationMode, 'informational')
  assert.equal(s.structurePreference, 'prose')
}

// —— K explicit structure ——
{
  const s = stateFor('Fammi una lista dei passaggi OAuth')
  assert.equal(s.structurePreference, 'structured')
}

// —— L debugging structure ——
{
  const s = stateFor('Non funziona ancora, che palle. TypeError sulla login.')
  assert.equal(s.conversationMode, 'debugging')
  assert.equal(s.structurePreference, 'structured')
}

// —— H celebration (not forced micro completion) ——
{
  const s = stateFor('Finalmente funziona!!!')
  assert.equal(s.conversationMode, 'celebration')
  assert.equal(s.questionNeeded, false)
}

// —— NRP anti-restatement ——
assert.match(NATURAL_RESPONSE_POLICY_CONTRACT, /do not restate\/paraphrase the user's message/i)
assert.match(NATURAL_RESPONSE_POLICY_CONTRACT, /micro conversational beats/i)
assert.ok(NATURAL_RESPONSE_POLICY_CONTRACT.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS)

// —— Continuity earned callbacks ——
assert.match(CONVERSATION_CONTINUITY_CONTRACT, /Earned callbacks/i)
assert.match(CONVERSATION_CONTINUITY_CONTRACT, /never invent/i)
assert.match(CONVERSATION_CONTINUITY_CONTRACT, /serious\/safety/i)

// —— O #366B still present ——
const cap = readFileSync(join(root, 'lib/server/local-capability-awareness-appendix.js'), 'utf8')
assert.match(cap, /User-facing register/)
assert.doesNotMatch(cap, /state clearly it was not executed in this turn/i)
assert.match(cap, /FORBIDDEN in normal user-facing prose/)

console.log('micro-rhythm-367b.test.mjs: ok')
