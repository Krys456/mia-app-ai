/**
 * #328 — Continuity Intelligence MVP
 * Run: node lib/server/continuity-intelligence-328.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REFERENCE_CONTEXT_BUILD,
  bindLikelyReferent,
  buildReferenceContextAppendix,
  buildReferenceContextDiagPayload,
  deriveReferenceContext,
  deriveRecentAlternatives,
  extractUserBinaryAlternatives,
  looksLikeContinuityPivot,
  looksLikeDimensionContinuation,
  looksLikeMultiClauseStopPivot,
  parseOrdinalReference,
} from './core-reference-context.js'
import {
  CONTINUITY_INTELLIGENCE_BUILD,
  computeConversationState,
  looksLikeContinueCue,
  looksLikeOrdinalFollowUp,
  looksLikeStopDecline,
} from './conversation-state.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

assert.equal(REFERENCE_CONTEXT_BUILD, '328-1')
assert.equal(CONTINUITY_INTELLIGENCE_BUILD, '328-1')

const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('buildReferenceContextAppendix'))
assert.ok(chatSrc.includes('buildReferenceContextDiagPayload'))
assert.ok(!/runCognitiveEngine|emotional-continuity-engine|conversation-runtime\/v1/.test(chatSrc))
assert.ok(!/\bactiveSubject\b|\blastResolvedReference\b/.test(chatSrc))

// —— Ordinal binder ——
{
  const options = ['Aurora', 'Nova', 'Orbit']
  assert.equal(parseOrdinalReference('La terza mi piace.', 3)?.index, 2)
  assert.equal(parseOrdinalReference('L\'ultima?', 3)?.index, 2)
  assert.equal(parseOrdinalReference('E la seconda?', 3)?.index, 1)
  assert.equal(parseOrdinalReference('La quinta?', 3), null)

  const msgs = [
    { role: 'user', content: 'Dammi idee' },
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: 'La terza mi piace.' },
  ]
  const ctx = deriveReferenceContext(msgs)
  assert.equal(ctx?.likelyReferent?.value, 'Orbit')
  assert.equal(ctx?.likelyReferent?.type, 'ordinal')
  assert.equal(ctx?.likelyReferent?.ordinal, 3)

  const cont = deriveReferenceContext([
    ...msgs,
    { role: 'assistant', content: 'Orbit è…' },
    { role: 'user', content: 'Continua da quella.' },
  ])
  // "Continua da quella" without new ordinal — may not re-bind; continue cue still true
  assert.equal(looksLikeContinueCue('Continua da quella.'), true)

  const second = deriveReferenceContext([
    ...msgs,
    { role: 'assistant', content: 'Ok Orbit.' },
    { role: 'user', content: 'E la seconda?' },
  ])
  assert.equal(second?.likelyReferent?.value, 'Nova')

  const last = deriveReferenceContext([
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: "L'ultima?" },
  ])
  assert.equal(last?.likelyReferent?.value, 'Orbit')

  assert.equal(
    bindLikelyReferent('La quinta?', { orderedOptions: options }),
    null,
  )
}

// —— Previous ordinal ——
{
  const msgs = [
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: 'La terza.' },
    { role: 'assistant', content: 'Orbit…' },
    { role: 'user', content: 'Quello prima.' },
  ]
  const ctx = deriveReferenceContext(msgs)
  assert.equal(ctx?.likelyReferent?.value, 'Nova')
  assert.equal(ctx?.likelyReferent?.type, 'previous')
}

// —— User A-or-B + alternative binder ——
{
  assert.deepEqual(extractUserBinaryAlternatives('Aurora o Nova?'), ['Aurora', 'Nova'])
  const alts = deriveRecentAlternatives([
    { role: 'user', content: 'Aurora o Nova?' },
    { role: 'assistant', content: 'Nova. È più distintiva.' },
  ])
  assert.deepEqual(alts, ['Aurora', 'Nova'])

  const other = deriveReferenceContext([
    { role: 'user', content: 'Aurora o Nova?' },
    { role: 'assistant', content: 'Nova. È più distintiva.' },
    { role: 'user', content: "E l'altra?" },
  ])
  assert.equal(other?.likelyReferent?.value, 'Aurora')
  assert.equal(other?.likelyReferent?.type, 'alternative')

  const corr = deriveReferenceContext([
    { role: 'user', content: 'Aurora o Nova?' },
    { role: 'assistant', content: 'Nova.' },
    { role: 'user', content: "E l'altra?" },
    { role: 'assistant', content: 'Aurora…' },
    { role: 'user', content: 'No, intendevo Nova.' },
  ])
  assert.equal(corr?.likelyReferent?.value, 'Nova')
  assert.equal(corr?.likelyReferent?.correction, true)
}

// —— Pivot suppresses bind ——
{
  const ctx = deriveReferenceContext([
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: "Cos'è l'entropia?" },
  ])
  assert.equal(ctx?.likelyReferent, undefined)
  assert.equal(ctx?.pivotDetected, true)
  assert.equal(looksLikeContinuityPivot("Cos'è l'entropia?"), true)
}

// —— Multi-clause stop/pivot ——
for (const phrase of [
  'Lascia stare. Parliamo di altro.',
  "Lascia stare, parliamo d'altro.",
  'Basta con questo, cambiamo argomento.',
  "Forget it, let's talk about something else.",
]) {
  assert.equal(looksLikeStopDecline(phrase), true, phrase)
  assert.equal(looksLikeMultiClauseStopPivot(phrase), true, phrase)
  const s = computeConversationState({
    userMessage: phrase,
    recentMessages: [
      { role: 'user', content: 'Vorrei creare un app' },
      { role: 'assistant', content: '1. Aurora\n2. Nova' },
      { role: 'user', content: phrase },
    ],
  })
  assert.equal(s.initiativeLevel, 'low', phrase)
  assert.equal(s.questionNeeded, false, phrase)
}

// —— Continue-with-reference + ordinal state ——
assert.equal(looksLikeContinueCue('Continua dalla terza.'), true)
assert.equal(looksLikeContinueCue('Sviluppa la seconda.'), true)
assert.equal(looksLikeOrdinalFollowUp('La terza mi piace.'), true)

{
  const s = computeConversationState({
    userMessage: 'La terza mi piace.',
    recentMessages: [
      { role: 'user', content: 'Vorrei creare una nuova app.' },
      { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
      { role: 'user', content: 'La terza mi piace.' },
    ],
  })
  assert.equal(s.conversationMode, 'brainstorming')
  assert.equal(s.responsePurpose, 'continue')
  assert.equal(s.ordinalFollowUpDetected, true)
}

// —— Dimension continuation ——
assert.equal(looksLikeDimensionContinuation('E su iOS?'), true)
{
  const s = computeConversationState({
    userMessage: 'E su iOS?',
    recentMessages: [
      { role: 'user', content: "Quanto costa pubblicare un'app su Android?" },
      { role: 'assistant', content: 'Su Android circa…' },
      { role: 'user', content: 'E su iOS?' },
    ],
  })
  assert.equal(s.dimensionContinuationDetected, true)
  assert.ok(['continue', 'answer', 'explain'].includes(s.responsePurpose))
  assert.ok(
    ['problem_solving', 'informational', 'debugging', 'teaching'].includes(s.conversationMode),
    `unexpected mode ${s.conversationMode}`,
  )
}

// —— Ellipsis ——
{
  const s = computeConversationState({
    userMessage: 'Perché?',
    recentMessages: [
      { role: 'user', content: 'Aurora o Nova?' },
      { role: 'assistant', content: 'Nova.' },
      { role: 'user', content: 'Perché?' },
    ],
  })
  assert.equal(s.conversationMode, 'decision_support')
  assert.ok(['explain', 'continue'].includes(s.responsePurpose))
}

// —— Appendix: likely_referent tiny; omitted when low confidence ——
{
  const withBind = buildReferenceContextAppendix([
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: 'La terza.' },
  ])
  assert.match(withBind, /likely_referent:/)
  assert.match(withBind, /Orbit/)
  const bindBlock = withBind.slice(withBind.indexOf('likely_referent:'))
  assert.ok(bindBlock.length <= 220, `bind block too large: ${bindBlock.length}`)

  const noBind = buildReferenceContextAppendix([
    { role: 'assistant', content: 'Ciao, come stai?' },
    { role: 'user', content: 'Bene grazie' },
  ])
  assert.equal(noBind.includes('likely_referent'), false)
}

// —— Diag: no option text dumps required; counts only ——
{
  const ctx = deriveReferenceContext([
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: 'La terza.' },
  ])
  const diag = buildReferenceContextDiagPayload(ctx, { appendixChars: 100 })
  assert.equal(diag.likelyReferentPresent, true)
  assert.equal(diag.likelyReferentType, 'ordinal')
  assert.equal(diag.ordinalIndex, 3)
  assert.equal(diag.orderedOptionsCount, 3)
  assert.ok(!('Aurora' in diag))
  assert.ok(!('userMessage' in diag))
}

// —— Continuity contract ——
{
  const c = buildCoreContinuityAppendix()
  assert.ok(/likely_referent|TEMPORARY REFERENCE CONTEXT/i.test(c))
  assert.ok(/Dimension change/i.test(c))
  assert.ok(/CURRENT THREAD REFERENT > DURABLE MEMORY/i.test(c))
  assert.ok(c.length <= 2000)
}

// —— Memory cannot outrank thread (policy + binder ignores Memory) ——
{
  // Binder only sees thread options — Memory Aurora preference cannot appear here.
  const ctx = deriveReferenceContext([
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: 'La terza.' },
  ])
  assert.equal(ctx?.likelyReferent?.value, 'Orbit')
  assert.notEqual(ctx?.likelyReferent?.value, 'Aurora')
}

// —— Capability modules untouched ——
for (const rel of [
  'lib/server/phone-action-capability-appendix.js',
  'lib/server/translation-engine.js',
  'lib/server/brain-memory.js',
]) {
  const src = read(rel)
  assert.ok(!/likely_referent|bindLikelyReferent|CONTINUITY INTELLIGENCE/.test(src), rel)
}

console.log('continuity-intelligence-328.test.mjs: ok')
