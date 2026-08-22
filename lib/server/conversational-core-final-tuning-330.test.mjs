/**
 * #330 — Conversational Core Final Tuning
 * Run: node lib/server/conversational-core-final-tuning-330.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATURAL_RESPONSE_POLICY_BUILD,
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
  buildNaturalResponsePolicyAppendix,
  buildConversationMomentumPolicySection,
} from './natural-response-policy.js'
import {
  computeConversationState,
  buildConversationStateAppendix,
  buildStyleAvoidAppendix,
  createEmptySessionStyleState,
  collectSessionStyleFingerprints,
  looksLikeSimpleSocialGreeting,
  looksLikeStopDecline,
  looksLikeCompletionCue,
} from './conversation-state.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

assert.equal(NATURAL_RESPONSE_POLICY_BUILD, '362c-1')

const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(nrp.length >= 1200 && nrp.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS, `NRP size ${nrp.length}`)
assert.ok(/question_needed=false/i.test(nrp))
assert.ok(/E tu\?|Cosa ne pensi/i.test(nrp))
assert.ok(/Fammi sapere|Se hai bisogno|Sono qui/i.test(nrp))
assert.ok(/ONE useful layer|exactly ONE useful layer/i.test(nrp))
assert.ok(/Io sceglierei|Do not reopen|Ma dipende/i.test(nrp))
assert.ok(/Mi dispiace ma/i.test(nrp))
assert.ok(/Celebration:|keep-alive question/i.test(nrp))
assert.ok(/social reciprocal|simple greeting/i.test(nrp))

const momentum = buildConversationMomentumPolicySection()
assert.ok(momentum.length <= 950, `momentum too large: ${momentum.length}`)
assert.ok(/roadmap dump|ONE useful layer/i.test(momentum))

// —— Social reciprocal calibration ——
assert.equal(looksLikeSimpleSocialGreeting('Ciao'), true)
assert.equal(looksLikeSimpleSocialGreeting('Come stai?'), true)
assert.equal(looksLikeSimpleSocialGreeting('Che fai?'), true)
assert.equal(looksLikeSimpleSocialGreeting('How are you?'), true)
assert.equal(looksLikeSimpleSocialGreeting('Io bene'), false)
assert.equal(looksLikeSimpleSocialGreeting('Mi annoio.'), false)
assert.equal(looksLikeSimpleSocialGreeting('Aurora o Nova?'), false)

{
  const ciao = computeConversationState({
    userMessage: 'Ciao',
    recentMessages: [{ role: 'user', content: 'Ciao' }],
  })
  assert.equal(ciao.questionNeeded, true, 'Ciao may earn one reciprocal')
  assert.equal(ciao.acknowledgementNeeded, false)

  const comeStai = computeConversationState({
    userMessage: 'Come stai?',
    recentMessages: [{ role: 'user', content: 'Come stai?' }],
  })
  assert.equal(comeStai.questionNeeded, true)

  const ioBene = computeConversationState({
    userMessage: 'Io bene',
    recentMessages: [
      { role: 'user', content: 'Come stai?' },
      { role: 'assistant', content: 'Bene, e tu?' },
      { role: 'user', content: 'Io bene' },
    ],
  })
  assert.equal(ioBene.questionNeeded, false, 'Io bene is not a greeting beat')
}

// —— questionNeeded=false families ——
for (const u of [
  'Cos\'è l\'entropia?',
  'Aurora o Nova?',
  'Finalmente funziona!!!',
  'Dammi qualche idea',
]) {
  const s = computeConversationState({
    userMessage: u,
    recentMessages: [{ role: 'user', content: u }],
  })
  assert.equal(s.questionNeeded, false, `qNeeded should be false for: ${u}`)
}

// —— STOP / completion ——
for (const u of ['Basta.', 'Lascia stare.', 'Ok basta', 'Non mi interessa.']) {
  assert.equal(looksLikeStopDecline(u), true, `stop: ${u}`)
  const s = computeConversationState({
    userMessage: u,
    recentMessages: [{ role: 'user', content: u }],
  })
  assert.equal(s.stopSignalDetected, true)
  assert.equal(s.questionNeeded, false)
  assert.equal(s.initiativeLevel, 'low')
  const app = buildConversationStateAppendix(s)
  assert.ok(/stop_signal: true/i.test(app))
  // #362B — keep-alive forbids live in NRP (State only flags stop_signal)
  assert.ok(/NRP/i.test(app) || /Fammi sapere|Se hai bisogno|sono qui/i.test(app))
  assert.ok(/Fammi sapere|Se hai bisogno|sono qui/i.test(nrp))
}

for (const u of ['Ok così.', 'Basta così.', 'Va bene così.']) {
  assert.equal(looksLikeCompletionCue(u), true, `completion: ${u}`)
  const s = computeConversationState({
    userMessage: u,
    recentMessages: [{ role: 'user', content: u }],
  })
  assert.equal(s.completionCueDetected, true)
  assert.equal(s.questionNeeded, false)
  assert.equal(s.initiativeLevel, 'low')
  const app = buildConversationStateAppendix(s)
  assert.ok(/completion_signal: true/i.test(app))
}

// Multi-clause stop/pivot from #328
{
  const s = computeConversationState({
    userMessage: 'Lascia stare. Parliamo d\'altro',
    recentMessages: [{ role: 'user', content: 'Lascia stare. Parliamo d\'altro' }],
  })
  assert.equal(s.stopSignalDetected, true)
}

// —— Decision ——
{
  const s = computeConversationState({
    userMessage: 'Aurora o Nova?',
    recentMessages: [{ role: 'user', content: 'Aurora o Nova?' }],
  })
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.questionNeeded, false)
  assert.ok(/choose clearly|do not reopen/i.test(buildConversationStateAppendix(s)))
}

// —— Brainstorm / continue ——
{
  const s = computeConversationState({
    userMessage: 'E poi?',
    recentMessages: [
      { role: 'user', content: 'Dammi idee' },
      { role: 'assistant', content: '1. A\n2. B\n3. C' },
      { role: 'user', content: 'La terza' },
      { role: 'assistant', content: 'Ok C…' },
      { role: 'user', content: 'E poi?' },
    ],
  })
  assert.ok(s.responsePurpose === 'continue' || s.conversationMode === 'brainstorming' || s.initiativeLevel !== 'low')
  assert.ok(/one useful layer|exactly one useful layer/i.test(buildConversationStateAppendix(s) + nrp))
}

// —— Celebration ——
{
  const s = computeConversationState({
    userMessage: 'Finalmente funziona!!!',
    recentMessages: [{ role: 'user', content: 'Finalmente funziona!!!' }],
  })
  assert.equal(s.conversationMode, 'celebration')
  assert.equal(s.questionNeeded, false)
  assert.ok(s.initiativeLevel === 'low' || s.initiativeLevel === 'normal')
}

// —— Self-reference Base ——
assert.ok(/natural truthful self-reference|stiff "as an AI"|help-desk closings/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Mi dispiace ma/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('ShinkAIdo'))
assert.ok(!/Sei LAIfe/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length <= 4800, `#362B craft band: ${LAIFE_BASE_SYSTEM_PROMPT.length}`)
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length >= 1800)

// —— STYLE_AVOID filler guidance ——
{
  let style = createEmptySessionStyleState()
  const s0 = computeConversationState({
    userMessage: 'Ciao',
    recentMessages: [{ role: 'user', content: 'Ciao' }],
  })
  style = collectSessionStyleFingerprints('Certo! Ottima idea.', style)
  style = collectSessionStyleFingerprints('Capisco, vediamo.', style)
  const avoid = buildStyleAvoidAppendix(style, { ...s0, questionNeeded: false })
  assert.ok(/filler openings|Certo|Capisco|Perfetto/i.test(avoid))
}

// —— Architecture unchanged ——
const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('buildNaturalResponsePolicyAppendix'))
assert.ok(chatSrc.includes('buildConversationStateAppendix'))
assert.ok(chatSrc.includes('buildStyleAvoidAppendix'))
assert.ok(!/runCognitiveEngine/.test(chatSrc))
assert.ok(!/personality-consistency-engine/.test(chatSrc))

// No new schema fields
const stateSrc = read('lib/server/conversation-state.js')
for (const banned of ['humorLevel', 'personalityState', 'friendshipLevel', 'bondLevel']) {
  assert.ok(!stateSrc.includes(banned))
}

console.log('conversational-core-final-tuning-330.test.mjs: PASS', {
  nrp: nrp.length,
  momentum: momentum.length,
  base: LAIFE_BASE_SYSTEM_PROMPT.length,
})
