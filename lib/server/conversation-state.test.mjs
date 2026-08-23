/**
 * #324 Conversation State MVP
 * Run: node lib/server/conversation-state.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_STATE_APPENDIX_MAX_CHARS,
  CONVERSATION_STATE_BUILD,
  buildConversationStateAppendix,
  buildConversationStateDiagPayload,
  collectSessionStyleFingerprints,
  computeConversationState,
  createEmptySessionStyleState,
  isConversationStateDiagEnabled,
  isConversationStateDiagEnvAllowed,
  isConversationStateDiagRequested,
} from './conversation-state.js'

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

// —— Wiring: Core only, no Cognitive / second LLM ——
const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('computeConversationState'))
assert.ok(chatSrc.includes('buildConversationStateAppendix'))
assert.ok(chatSrc.includes('CONVERSATION STATE') || chatSrc.includes('conversationStateAppendix'))
assert.ok(!/runCognitiveEngine|cognitive-coordinator|conversation-runtime\/v1/.test(chatSrc))
assert.ok(!/openai\.chat\.completions\.create/.test(chatSrc))

const stateCall = chatSrc.indexOf('const conversationStateAppendix = buildConversationStateAppendix')
const nrpCall = chatSrc.indexOf('const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
assert.ok(stateCall > 0 && nrpCall > stateCall, 'Conversation State before NRP')
assert.ok(langCall > nrpCall, 'NRP before LANGUAGE')

// —— Appendix size ——
const sample = stateFor('Ciao')
const appendix = buildConversationStateAppendix(sample)
assert.ok(appendix.startsWith('CONVERSATION STATE'))
assert.ok(appendix.length <= CONVERSATION_STATE_APPENDIX_MAX_CHARS)
assert.ok(appendix.length >= 200, `appendix too small: ${appendix.length}`)
assert.ok(/question_needed: true/.test(appendix), 'Ciao earns narrow social reciprocal')
assert.ok(/Do not mention this state/i.test(appendix))
assert.ok(/Obey NRP|emoji = permission ceiling|permission ceiling/i.test(appendix))
assert.ok(!/cognitive|classifier|second LLM/i.test(appendix))

// —— Session style foundation (no Memory) ——
const emptyStyle = createEmptySessionStyleState()
assert.equal(emptyStyle.recentOpeningTypes.length, 0)
const styled = collectSessionStyleFingerprints('Certo! Ecco il piano.\n\n1. A\n2. B', emptyStyle)
assert.equal(styled.recentOpeningTypes.at(-1), 'filler_ack')
assert.equal(styled.lastEndingWasQuestion, false)
assert.ok(Array.isArray(styled.recentEmojis))
assert.ok(Array.isArray(styled.recentFirstPhrases))
assert.ok(styled.recentFirstPhrases.length >= 1)
assert.equal(styled.recentStructureTypes.at(-1), 'list')

// —— Diagnostics ——
assert.ok(
  CONVERSATION_STATE_BUILD === '328-1' ||
    CONVERSATION_STATE_BUILD === '362b-1' ||
    CONVERSATION_STATE_BUILD === '362c-1' ||
    CONVERSATION_STATE_BUILD === '367b-1' ||
    CONVERSATION_STATE_BUILD === '369b-1' ||
    CONVERSATION_STATE_BUILD === '370b-1',
  `unexpected state build: ${CONVERSATION_STATE_BUILD}`,
)
assert.equal(isConversationStateDiagEnvAllowed({ VERCEL_ENV: 'preview' }), true)
assert.equal(isConversationStateDiagEnvAllowed({ VERCEL_ENV: 'production' }), false)
assert.equal(
  isConversationStateDiagRequested(
    { url: '/api/chat?conversation_state_diag=1' },
    {},
  ),
  true,
)
assert.equal(
  isConversationStateDiagEnabled(
    { url: '/api/chat?conversation_state_diag=1' },
    {},
    { VERCEL_ENV: 'preview' },
  ),
  true,
)
const diag = buildConversationStateDiagPayload(sample, { appendixChars: appendix.length })
assert.equal(diag.route, 'conversation-state')
assert.equal(diag.mode, sample.conversationMode)
assert.ok(!('userMessage' in diag))
assert.ok(!('memory' in diag))

// —— Fixtures: CASUAL ——
{
  const s = stateFor('Ciao')
  assert.equal(s.conversationMode, 'casual')
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.desiredDepth, 'short')
  assert.equal(s.structurePreference, 'prose')
  assert.equal(s.questionNeeded, true, '#330 social reciprocal for greeting')
}

{
  const s = stateFor('Come va?')
  assert.equal(s.conversationMode, 'casual')
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.desiredDepth, 'short')
  assert.equal(s.questionNeeded, true, '#330 social reciprocal for greeting')
}

{
  const s = stateFor('Mi annoio')
  // #362B — boredom/exploration → brainstorming (one strong direction)
  assert.equal(s.conversationMode, 'brainstorming')
  assert.equal(s.responsePurpose, 'brainstorm')
  assert.ok(['short', 'medium'].includes(s.desiredDepth))
  assert.notEqual(s.structurePreference, 'structured')
}

{
  const s = stateFor('Ahahah')
  assert.equal(s.conversationMode, 'casual')
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.emotionalTone, 'playful')
}

// —— EXCITED / CELEBRATION ——
{
  const s = stateFor('Finalmente funziona!!!')
  assert.equal(s.conversationMode, 'celebration')
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.desiredDepth, 'short')
  assert.ok(['celebratory', 'excited'].includes(s.emotionalTone))
  assert.ok(['moderate', 'expressive'].includes(s.emojiLevel))
  assert.equal(s.acknowledgementNeeded, true)
  assert.equal(s.questionNeeded, false)
  assert.equal(s.structurePreference, 'prose')
}

{
  const s = stateFor('Madonna che figata!')
  assert.ok(['celebration', 'casual'].includes(s.conversationMode))
  assert.ok(['celebratory', 'excited', 'playful'].includes(s.emotionalTone))
  assert.equal(s.questionNeeded, false)
}

// —— FRUSTRATED DEBUGGING ——
{
  const s = stateFor('Non funziona ancora, che palle.', {
    recentMessages: [
      { role: 'user', content: 'Questa API restituisce 401' },
      { role: 'assistant', content: 'Controlla l’Authorization header.' },
      { role: 'user', content: 'Non funziona ancora, che palle.' },
    ],
  })
  assert.equal(s.conversationMode, 'debugging')
  assert.notEqual(s.conversationMode, 'emotional_support')
  assert.equal(s.emotionalTone, 'frustrated')
  assert.ok(['none', 'light'].includes(s.emojiLevel))
  assert.equal(s.acknowledgementNeeded, true)
  assert.equal(s.questionNeeded, false)
  assert.ok(['light_structure', 'structured'].includes(s.structurePreference))
}

{
  const s = stateFor('Che palle.', {
    recentMessages: [
      { role: 'user', content: 'Il build TypeScript fallisce' },
      { role: 'assistant', content: 'Prova a sistemare i tipi.' },
      { role: 'user', content: 'Che palle.' },
    ],
  })
  assert.ok(['debugging', 'casual'].includes(s.conversationMode))
  assert.notEqual(s.conversationMode, 'emotional_support')
}

// —— FACTUAL ——
{
  const s = stateFor("Cos'è l'entropia?")
  assert.equal(s.conversationMode, 'informational')
  assert.equal(s.responsePurpose, 'explain')
  assert.equal(s.desiredDepth, 'medium')
  assert.equal(s.emotionalTone, 'neutral')
  assert.ok(['none', 'light'].includes(s.emojiLevel))
  assert.equal(s.initiativeLevel, 'low')
  assert.equal(s.questionNeeded, false)
  assert.ok(['prose', 'light_structure'].includes(s.structurePreference))
}

// —— TEACHING ——
{
  const s = stateFor('Spiegamelo come se non sapessi nulla.')
  assert.equal(s.conversationMode, 'teaching')
  assert.equal(s.responsePurpose, 'explain')
  assert.ok(['medium', 'detailed'].includes(s.desiredDepth))
  assert.ok(['none', 'light'].includes(s.emojiLevel))
  assert.equal(s.questionNeeded, false)
}

// —— TECHNICAL ——
{
  const s = stateFor('Perché questa API restituisce 401?')
  assert.equal(s.conversationMode, 'debugging')
  assert.ok(['continue', 'explain', 'answer'].includes(s.responsePurpose))
  assert.ok(['light_structure', 'structured'].includes(s.structurePreference))
  assert.ok(['none', 'light'].includes(s.emojiLevel))
}

// —— BRAINSTORM ——
{
  const s = stateFor('Vorrei creare una nuova app. Dammi qualche idea.')
  assert.equal(s.conversationMode, 'brainstorming')
  assert.equal(s.responsePurpose, 'brainstorm')
  assert.equal(s.desiredDepth, 'medium')
  assert.equal(s.initiativeLevel, 'high')
  assert.equal(s.questionNeeded, false)
  assert.equal(s.structurePreference, 'prose')
  assert.ok(['light', 'moderate'].includes(s.emojiLevel))
}

// —— DECISION ——
{
  const s = stateFor('Quale dei due nomi sceglieresti?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.desiredDepth, 'medium')
  assert.ok(['medium', 'high', 'low'].includes(s.confidence))
  assert.equal(s.questionNeeded, true)
}

{
  const s = stateFor('Quale sceglieresti: Aurora o Nova?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.questionNeeded, false)
}

// —— CORRECTION ——
{
  const s = stateFor("No, intendevo l'altro.", {
    recentMessages: [
      { role: 'user', content: 'Parliamo di Dragon Ball o Naruto?' },
      { role: 'assistant', content: 'Parliamo di Naruto.' },
      { role: 'user', content: "No, intendevo l'altro." },
    ],
  })
  assert.equal(s.responsePurpose, 'continue')
  assert.equal(s.acknowledgementNeeded, true)
  assert.ok(['short', 'medium'].includes(s.desiredDepth))
  assert.equal(s.questionNeeded, false)
}

// —— CONTINUITY short follow-ups ——
{
  const s = stateFor('Continuiamo.', {
    recentMessages: [
      { role: 'user', content: 'Questa API restituisce 401' },
      { role: 'assistant', content: 'Controlliamo i token.' },
      { role: 'user', content: 'Continuiamo.' },
    ],
  })
  assert.equal(s.conversationMode, 'debugging')
  assert.equal(s.responsePurpose, 'continue')
}

{
  const s = stateFor('E poi?', {
    recentMessages: [
      { role: 'user', content: 'Dammi qualche idea per un’app' },
      { role: 'assistant', content: 'Idea 1: habit tracker.' },
      { role: 'user', content: 'E poi?' },
    ],
  })
  assert.equal(s.conversationMode, 'brainstorming')
  assert.ok(['continue', 'brainstorm'].includes(s.responsePurpose))
}

{
  const s = stateFor('Quello di prima.', {
    recentMessages: [
      { role: 'user', content: 'Preferisco il primo piano' },
      { role: 'assistant', content: 'Ok, il primo.' },
      { role: 'user', content: 'Quello di prima.' },
    ],
  })
  assert.ok(['continue', 'react', 'answer'].includes(s.responsePurpose))
}

// —— Explicit overrides ——
{
  const s = stateFor("Rispondi in una frase: cos'è l'entropia?")
  assert.equal(s.desiredDepth, 'short')
  assert.ok(s.explicitOverrides.includes('depth:short'))
}

{
  const s = stateFor('Spiegamelo in modo molto approfondito')
  assert.equal(s.desiredDepth, 'detailed')
}

{
  const s = stateFor('Ciao. Non usare emoji.')
  assert.equal(s.emojiLevel, 'none')
}

{
  const s = stateFor('Ciao. Usa qualche emoji.', { settings: { useEmojis: true } })
  assert.ok(['moderate', 'expressive'].includes(s.emojiLevel))
}

{
  const s = stateFor('Ciao', { settings: { useEmojis: false } })
  assert.equal(s.emojiLevel, 'none')
}

{
  const s = stateFor('Fammi una lista dei pro e contro')
  assert.equal(s.structurePreference, 'structured')
}

// —— LENGTH_BIAS must not beat explicit short when wired ——
assert.ok(!/LENGTH_BIAS/.test(chatSrc), 'LENGTH_BIAS prose removed; settings feed State')
assert.ok(/explicitOverrides|computeConversationState/.test(chatSrc))

// —— questionNeeded false for completed answer classes ——
for (const msg of [
  "Cos'è l'entropia?",
  'Finalmente funziona!!!',
  "No, intendevo l'altro.",
  'Quale sceglieresti: Aurora o Nova?',
  'Spiegamelo come se non sapessi nulla.',
]) {
  const s = stateFor(msg)
  assert.equal(s.questionNeeded, false, `expected questionNeeded=false for: ${msg}`)
}

console.log('conversation-state.test.mjs: ok')
