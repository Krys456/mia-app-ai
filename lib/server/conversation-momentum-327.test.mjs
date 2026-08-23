/**
 * #327 — Conversation Momentum MVP (deterministic state + policy).
 * Run: node lib/server/conversation-momentum-327.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_MOMENTUM_BUILD,
  CONVERSATION_STATE_BUILD,
  buildConversationStateAppendix,
  buildConversationStateDiagPayload,
  computeConversationState,
  looksLikeBinaryChoice,
  looksLikeCompletionCue,
  looksLikeContinueCue,
  looksLikeStopDecline,
} from './conversation-state.js'
import {
  CONVERSATION_MOMENTUM_POLICY_MAX_CHARS,
  NATURAL_RESPONSE_POLICY_BUILD,
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
  buildConversationMomentumPolicySection,
  buildNaturalResponsePolicyAppendix,
  buildNaturalResponseDiagPayload,
} from './natural-response-policy.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function stateFor(userMessage, opts = {}) {
  return computeConversationState({
    userMessage,
    recentMessages: opts.recentMessages || [{ role: 'user', content: userMessage }],
    settings: opts.settings || {},
    workingState: opts.workingState || null,
  })
}

assert.ok(
  CONVERSATION_STATE_BUILD === '328-1' ||
    CONVERSATION_STATE_BUILD === '362b-1' ||
    CONVERSATION_STATE_BUILD === '362c-1' ||
    CONVERSATION_STATE_BUILD === '367b-1' ||
    CONVERSATION_STATE_BUILD === '369b-1' ||
    CONVERSATION_STATE_BUILD === '370b-1' ||
    CONVERSATION_STATE_BUILD === '371b-1',
  `unexpected state build: ${CONVERSATION_STATE_BUILD}`,
)
assert.equal(CONVERSATION_MOMENTUM_BUILD, '327-1')
assert.ok(
  NATURAL_RESPONSE_POLICY_BUILD === '327-1' ||
    NATURAL_RESPONSE_POLICY_BUILD === '330-1' ||
    NATURAL_RESPONSE_POLICY_BUILD === '362b-1' ||
    NATURAL_RESPONSE_POLICY_BUILD === '362c-1' ||
    NATURAL_RESPONSE_POLICY_BUILD === '367b-1',
  `unexpected NRP build: ${NATURAL_RESPONSE_POLICY_BUILD}`,
)

// —— No new schema / no second LLM / no legacy engines ——
const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('buildNaturalResponsePolicyAppendix'))
assert.ok(!/momentumAction|contributionType|engagementScore|conversationArc/.test(chatSrc))
assert.ok(!/runCognitiveEngine|conversation-momentum|proactive-conversation|natural-conversation-engine/.test(chatSrc))
assert.ok(!/openai\.chat\.completions\.create/.test(chatSrc))

const csSrc = read('lib/server/conversation-state.js')
assert.ok(!/\bmomentumAction\b/.test(csSrc))
assert.ok(csSrc.includes('looksLikeBinaryChoice'))
assert.ok(csSrc.includes('looksLikeStopDecline'))
assert.ok(csSrc.includes('looksLikeContinueCue'))

const memSrc = read('lib/server/brain-memory.js')
assert.ok(!/momentumAction|conversationMomentum|stopSignalDetected/.test(memSrc))

// —— Decision detection (A-or-B) ——
  for (const msg of [
  'Aurora o Nova?',
  'Rosso o blu?',
  'Web app o app nativa?',
  'Web o native?',
  'Meglio X o Y?',
  'Which would you choose, X or Y?',
  'X or Y?',
]) {
  assert.equal(looksLikeBinaryChoice(msg), true, `binary expected: ${msg}`)
  const s = stateFor(msg)
  assert.equal(s.conversationMode, 'decision_support', msg)
  assert.equal(s.responsePurpose, 'recommend', msg)
  assert.equal(s.questionNeeded, false, msg)
  assert.ok(['normal', 'high'].includes(s.initiativeLevel), msg)
  assert.ok(['medium', 'high'].includes(s.confidence), msg)
  assert.equal(s.decisionSignalDetected, true, msg)
}

{
  const s = stateFor('Quale dei due sceglieresti?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'recommend')
  // Options not named in-utterance → may ask; named A-or-B must not.
  assert.equal(typeof s.questionNeeded, 'boolean')
}

// Do not steal boolean/logic noise
assert.equal(looksLikeBinaryChoice('true or false'), false)
assert.equal(looksLikeBinaryChoice('0 or 1'), false)

// —— Short follow-up lexicon + prior-mode inheritance ——
const continuePhrases = [
  'Continua',
  'Continua pure',
  'Vai',
  'Vai avanti',
  'Avanti',
  'E poi?',
  'Poi?',
  'Ancora',
  'Ancora?',
  'Ancora 😂',
  'Dimmi altro',
  'Approfondisci',
  'Prosegui',
  'Continue',
  'Go on',
  'Keep going',
  'And then?',
  'More',
  'Tell me more',
]

const modeFixtures = {
  casual: [
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: 'Ciao! Come va?' },
  ],
  brainstorming: [
    { role: 'user', content: 'Vorrei creare una nuova app.' },
    { role: 'assistant', content: 'Ecco alcune idee…' },
  ],
  debugging: [
    { role: 'user', content: 'Questa API restituisce 401' },
    { role: 'assistant', content: 'Controlla l’header Authorization.' },
  ],
  teaching: [
    { role: 'user', content: "Cos'è l'entropia?" },
    { role: 'assistant', content: 'L’entropia misura il disordine…' },
  ],
  decision_support: [
    { role: 'user', content: 'Aurora o Nova?' },
    { role: 'assistant', content: 'Nova. È più…' },
  ],
}

for (const [mode, base] of Object.entries(modeFixtures)) {
  for (const phrase of continuePhrases) {
    assert.equal(looksLikeContinueCue(phrase), true, `continue cue: ${phrase}`)
    const s = stateFor(phrase, {
      recentMessages: [...base, { role: 'user', content: phrase }],
    })
    assert.equal(s.conversationMode, mode, `${mode} + ${phrase}`)
    assert.equal(s.responsePurpose, 'continue', `${mode} + ${phrase} purpose`)
    assert.equal(s.continueCueDetected, true, phrase)
    assert.equal(s.shortFollowUpDetected, true, phrase)
    if (mode !== 'casual') {
      assert.equal(s.priorModeInherited, true, `${mode} inherit ${phrase}`)
    }
  }
}

// Decision thread: Nova. → Continua. (no reset)
{
  const s = stateFor('Continua.', {
    recentMessages: [
      { role: 'user', content: 'Aurora o Nova?' },
      { role: 'assistant', content: 'Nova. È più distintiva.' },
      { role: 'user', content: 'Nova.' },
      { role: 'assistant', content: 'Ok, punti di forza di Nova…' },
      { role: 'user', content: 'Continua.' },
    ],
  })
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'continue')
}

{
  const s = stateFor('Nova.', {
    recentMessages: [
      { role: 'user', content: 'Aurora o Nova?' },
      { role: 'assistant', content: 'Io sceglierei Nova.' },
      { role: 'user', content: 'Nova.' },
    ],
  })
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'continue')
}

// Brainstorm preference stays on thread
{
  const s = stateFor('Nova mi piace.', {
    recentMessages: [
      { role: 'user', content: 'Vorrei creare una nuova app.' },
      { role: 'assistant', content: 'Idee: Aurora, Nova, Orbit…' },
      { role: 'user', content: 'Nova mi piace.' },
    ],
  })
  assert.equal(s.conversationMode, 'brainstorming')
  assert.equal(s.responsePurpose, 'continue')
}

// Teaching depth overrides keep teaching
{
  const hist = [
    { role: 'user', content: "Cos'è l'entropia?" },
    { role: 'assistant', content: 'Definizione…' },
  ]
  const simple = stateFor('Spiegalo semplice.', {
    recentMessages: [...hist, { role: 'user', content: 'Spiegalo semplice.' }],
  })
  assert.equal(simple.conversationMode, 'teaching')
  const deep = stateFor('Ora dettagliatamente.', {
    recentMessages: [
      ...hist,
      { role: 'user', content: 'Spiegalo semplice.' },
      { role: 'assistant', content: 'Versione semplice…' },
      { role: 'user', content: 'Ora dettagliatamente.' },
    ],
  })
  assert.equal(deep.conversationMode, 'teaching')
  assert.equal(deep.desiredDepth, 'detailed')
}

// Debugging continuation
{
  const s = stateFor('Ancora niente, che palle.', {
    recentMessages: [
      { role: 'user', content: 'Non funziona.' },
      { role: 'assistant', content: 'Prova a fare X.' },
      { role: 'user', content: 'Ho provato a fare X.' },
      { role: 'assistant', content: 'Ok, allora controlla Y.' },
      { role: 'user', content: 'Stesso errore.' },
      { role: 'assistant', content: 'Allora Z.' },
      { role: 'user', content: 'Ancora niente, che palle.' },
    ],
  })
  assert.equal(s.conversationMode, 'debugging')
  assert.equal(s.emotionalTone, 'frustrated')
  assert.equal(s.questionNeeded, false)
  assert.notEqual(s.conversationMode, 'emotional_support')
}

// —— Stop / decline ——
const stopPhrases = [
  'Basta.',
  'Lascia stare.',
  'Lasciamo stare.',
  'Non mi interessa.',
  'Cambiamo argomento.',
  "Parliamo d'altro.",
  'Stop.',
  'Never mind.',
  "Let's move on.",
  'Enough.',
  'Drop it.',
]
for (const phrase of stopPhrases) {
  assert.equal(looksLikeStopDecline(phrase), true, phrase)
  const s = stateFor(phrase, {
    recentMessages: [
      { role: 'user', content: 'Vorrei creare una nuova app.' },
      { role: 'assistant', content: 'Ecco idee…' },
      { role: 'user', content: phrase },
    ],
  })
  assert.equal(s.initiativeLevel, 'low', phrase)
  assert.equal(s.questionNeeded, false, phrase)
  assert.equal(s.desiredDepth, 'short', phrase)
  assert.equal(s.structurePreference, 'prose', phrase)
  assert.equal(s.stopSignalDetected, true, phrase)
  assert.ok(['react', 'continue'].includes(s.responsePurpose), phrase)
}

assert.equal(looksLikeCompletionCue('Basta così.'), true)
assert.equal(looksLikeStopDecline('Basta così.'), false)

// —— Topic pivot overrides inheritance ——
{
  const s = stateFor("Cos'è l'entropia?", {
    recentMessages: [
      { role: 'user', content: 'Vorrei creare una nuova app.' },
      { role: 'assistant', content: 'Idee su Nova…' },
      { role: 'user', content: 'Nova mi piace.' },
      { role: 'assistant', content: 'Sviluppiamo Nova…' },
      { role: 'user', content: "Cos'è l'entropia?" },
    ],
  })
  assert.equal(s.conversationMode, 'informational')
  assert.equal(s.priorModeInherited, false)
  assert.notEqual(s.conversationMode, 'brainstorming')
}

// —— Boredom initiative ——
{
  const s = stateFor('Mi annoio.')
  assert.equal(s.conversationMode, 'brainstorming')
  assert.equal(s.initiativeLevel, 'high')
  assert.equal(s.questionNeeded, false)
}

// —— Celebration ——
{
  const s = stateFor('Finalmente funziona!!!')
  assert.equal(s.conversationMode, 'celebration')
  assert.ok(['low', 'normal'].includes(s.initiativeLevel))
  assert.equal(s.questionNeeded, false)
}

// —— Diagnostics (no user text) ——
{
  const s = stateFor('Aurora o Nova?')
  const appendix = buildConversationStateAppendix(s)
  assert.ok(!/userMessage|Aurora o Nova/i.test(appendix))
  assert.ok(!/shortFollowUpDetected|stopSignalDetected/.test(appendix))
  const diag = buildConversationStateDiagPayload(s, { appendixChars: appendix.length })
  assert.equal(diag.decisionSignalDetected, true)
  assert.equal(diag.momentumBuild, '327-1')
  assert.ok(!('userMessage' in diag))
  assert.ok(!('memory' in diag))
}

// —— Momentum policy ——
const momentum = buildConversationMomentumPolicySection()
assert.ok(momentum.startsWith('CONVERSATION MOMENTUM'))
assert.ok(momentum.length <= CONVERSATION_MOMENTUM_POLICY_MAX_CHARS)
assert.ok(momentum.length >= 400, `momentum too small: ${momentum.length}`)

const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(nrp.includes('CONVERSATION MOMENTUM'))
assert.ok(nrp.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS)
const nrpDiag = buildNaturalResponseDiagPayload({ policyChars: nrp.length })
assert.equal(nrpDiag.momentumPolicyInjected, true)
assert.ok(nrpDiag.momentumPolicyChars > 0)

// —— Capability boundary: momentum must not live in capability modules ——
for (const rel of [
  'lib/server/phone-action-capability-appendix.js',
  'lib/server/translation-engine.js',
  'lib/server/brain-memory.js',
]) {
  const src = read(rel)
  assert.ok(!/conversation-momentum|momentumAction|CONVERSATION MOMENTUM/.test(src), rel)
}

// api/chat still uses a single responses path for Core (no second classifier call)
assert.ok(/responses\.create|openai\.responses/.test(chatSrc) || /client\.responses/.test(chatSrc))
assert.ok(!/momentumAction/.test(chatSrc))

console.log('conversation-momentum-327.test.mjs: ok')
