/**
 * #328 — Continuity Intelligence eval (deterministic + optional model smoke).
 * Run: node scripts/eval-continuity-intelligence.mjs
 * Optional: OPENAI_SMOKE=1 node scripts/eval-continuity-intelligence.mjs
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeConversationState } from '../lib/server/conversation-state.js'
import {
  deriveReferenceContext,
  bindLikelyReferent,
} from '../lib/server/core-reference-context.js'
import { buildCoreContinuityAppendix } from '../lib/server/conversation-continuity.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function score(name, steps) {
  const issues = []
  /** @type {{role:string,content:string}[]} */
  let recent = []
  const rows = []
  for (const step of steps) {
    const { userMessage, assistantStub, expect } = step
    if (assistantStub && recent.length) {
      /* prior assistant already in recent from previous step */
    }
    recent = [...recent, { role: 'user', content: userMessage }]
    const ctx = deriveReferenceContext(recent)
    const state = computeConversationState({ userMessage, recentMessages: recent })
    rows.push({
      userMessage,
      referent: ctx?.likelyReferent?.value || null,
      type: ctx?.likelyReferent?.type || null,
      mode: state.conversationMode,
      purpose: state.responsePurpose,
      pivot: ctx?.pivotDetected || state.stopSignalDetected,
    })
    if (expect?.referent != null && ctx?.likelyReferent?.value !== expect.referent) {
      issues.push(
        `${name}: referent ${ctx?.likelyReferent?.value} ≠ ${expect.referent} for "${userMessage}"`,
      )
    }
    if (expect?.noReferent && ctx?.likelyReferent?.value) {
      issues.push(`${name}: unexpected referent ${ctx.likelyReferent.value} for "${userMessage}"`)
    }
    if (expect?.mode && state.conversationMode !== expect.mode) {
      issues.push(`${name}: mode ${state.conversationMode} ≠ ${expect.mode}`)
    }
    if (expect?.stop && !state.stopSignalDetected) {
      issues.push(`${name}: missing stop for "${userMessage}"`)
    }
    recent = [...recent, { role: 'assistant', content: assistantStub || '…' }]
  }
  return { name, ok: issues.length === 0, issues, rows }
}

const sequences = [
  score('ORDINAL', [
    {
      userMessage: 'Dammi tre idee di nome.',
      assistantStub: '1. Aurora\n2. Nova\n3. Orbit',
    },
    {
      userMessage: 'La terza mi piace.',
      expect: { referent: 'Orbit' },
      assistantStub: 'Orbit ha…',
    },
    {
      userMessage: 'E la seconda?',
      expect: { referent: 'Nova' },
      assistantStub: 'Nova…',
    },
    {
      userMessage: "L'ultima?",
      expect: { referent: 'Orbit' },
    },
  ]),
  score('ALTERNATIVE', [
    {
      userMessage: 'Aurora o Nova?',
      assistantStub: 'Nova. È più distintiva.',
    },
    {
      userMessage: "E l'altra?",
      expect: { referent: 'Aurora' },
      assistantStub: 'Aurora…',
    },
    {
      userMessage: 'No, intendevo Nova.',
      expect: { referent: 'Nova' },
    },
  ]),
  score('CORRECTION', [
    {
      userMessage: 'Aurora o Nova?',
      assistantStub: 'Io sceglierei Aurora.',
    },
    {
      userMessage: "No, intendevo l'altra.",
      expect: { referent: 'Nova' },
    },
  ]),
  score('PIVOT', [
    {
      userMessage: 'Vorrei creare una nuova app.',
      assistantStub: '1. Aurora\n2. Nova\n3. Orbit',
    },
    {
      userMessage: 'La terza mi piace.',
      expect: { referent: 'Orbit' },
      assistantStub: 'Orbit…',
    },
    {
      userMessage: "Cos'è l'entropia?",
      expect: { noReferent: true, mode: 'informational' },
    },
  ]),
  score('STOP', [
    {
      userMessage: 'Vorrei creare una nuova app.',
      assistantStub: '1. Aurora\n2. Nova',
    },
    {
      userMessage: 'Lascia stare. Parliamo di altro.',
      expect: { stop: true, noReferent: true },
    },
  ]),
  score('DIMENSION', [
    {
      userMessage: "Quanto costa pubblicare un'app su Android?",
      assistantStub: 'Su Android tipicamente…',
    },
    {
      userMessage: 'E su iOS?',
      expect: {},
    },
  ]),
  score('DECISION', [
    {
      userMessage: 'Aurora o Nova?',
      assistantStub: 'Nova.',
    },
    {
      userMessage: 'Perché?',
      expect: { mode: 'decision_support' },
      assistantStub: 'Perché…',
    },
    {
      userMessage: "E l'altra?",
      expect: { referent: 'Aurora' },
    },
  ]),
  score('MEMORY_VS_THREAD', [
    {
      // Durable Memory preferring Aurora is irrelevant — binder only sees thread list.
      userMessage: 'Dammi opzioni',
      assistantStub: '1. Aurora\n2. Nova\n3. Orbit',
    },
    {
      userMessage: 'La terza.',
      expect: { referent: 'Orbit' },
    },
  ]),
]

const failed = sequences.filter((s) => !s.ok)
const continuity = buildCoreContinuityAppendix()

const report = {
  build: '328-1',
  timestamp: new Date().toISOString(),
  sequences: sequences.map((s) => ({
    name: s.name,
    ok: s.ok,
    issues: s.issues,
    turns: s.rows.length,
  })),
  allOk: failed.length === 0,
  continuityChars: continuity.length,
  proxies: {
    ordinalResolutionSuccess: sequences.find((s) => s.name === 'ORDINAL')?.ok ?? false,
    alternativeResolutionSuccess: sequences.find((s) => s.name === 'ALTERNATIVE')?.ok ?? false,
    correctionRecoverySuccess: sequences.find((s) => s.name === 'CORRECTION')?.ok ?? false,
    topicPivotSuccess: sequences.find((s) => s.name === 'PIVOT')?.ok ?? false,
    explicitStopCompliance: sequences.find((s) => s.name === 'STOP')?.ok ?? false,
    memoryOverThreadErrorRate: sequences.find((s) => s.name === 'MEMORY_VS_THREAD')?.ok
      ? 0
      : 1,
  },
  modelSmoke: null,
}

const outPath = join(root, 'tmp-eval-continuity-intelligence.json')
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

if (!report.allOk) {
  console.error('eval-continuity-intelligence: FAIL')
  process.exit(1)
}

if (process.env.OPENAI_SMOKE === '1' && process.env.OPENAI_API_KEY) {
  const OpenAI = (await import('openai')).default
  const { LAIFE_BASE_SYSTEM_PROMPT } = await import('../lib/server/laife-base-system-prompt.js')
  const { buildConversationStateAppendix } = await import('../lib/server/conversation-state.js')
  const { buildNaturalResponsePolicyAppendix } = await import(
    '../lib/server/natural-response-policy.js'
  )
  const { buildReferenceContextAppendix } = await import('../lib/server/core-reference-context.js')
  const { buildCoreResponsesCreateParams } = await import('../lib/server/core-responses-params.js')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  const smokeSeq = [
    { role: 'user', content: 'Dammi tre idee di nome app.' },
    { role: 'assistant', content: '1. Aurora\n2. Nova\n3. Orbit' },
    { role: 'user', content: 'La terza mi piace.' },
  ]
  const instructions = [
    LAIFE_BASE_SYSTEM_PROMPT,
    buildConversationStateAppendix(
      computeConversationState({
        userMessage: 'La terza mi piace.',
        recentMessages: smokeSeq,
      }),
    ),
    buildNaturalResponsePolicyAppendix(),
    buildCoreContinuityAppendix(),
    buildReferenceContextAppendix(smokeSeq),
  ].join('\n\n')

  const response = await client.responses.create(
    buildCoreResponsesCreateParams({
      model,
      instructions,
      maxOutputTokens: 220,
      input: smokeSeq.map((m) => ({ role: m.role, content: m.content })),
    }),
  )
  const text = (response.output_text || '').trim()
  const mentionsOrbit = /orbit/i.test(text)
  const mentionsWrongReset = /come posso aiutarti|how can i help/i.test(text)
  report.modelSmoke = {
    model,
    mentionsOrbit,
    helpDeskReset: mentionsWrongReset,
    preview: text.slice(0, 220).replace(/\n/g, ' / '),
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log('SMOKE', report.modelSmoke)
}

console.log('eval-continuity-intelligence: ok')
