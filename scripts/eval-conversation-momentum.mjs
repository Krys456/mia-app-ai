/**
 * #327 — Conversation Momentum eval (deterministic + optional model smoke).
 * Run: node scripts/eval-conversation-momentum.mjs
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeConversationState } from '../lib/server/conversation-state.js'
import {
  buildConversationMomentumPolicySection,
  buildNaturalResponsePolicyAppendix,
} from '../lib/server/natural-response-policy.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function turn(userMessage, recentMessages = [], workingState = null) {
  const recent = [...recentMessages, { role: 'user', content: userMessage }]
  const state = computeConversationState({
    userMessage,
    recentMessages: recent,
    workingState,
  })
  return { userMessage, state, recent }
}

function scoreSequence(name, steps) {
  const issues = []
  let recent = []
  const rows = []
  for (const step of steps) {
    const { userMessage, expect, assistantStub } = step
    const { state } = turn(userMessage, recent)
    rows.push({
      userMessage,
      mode: state.conversationMode,
      purpose: state.responsePurpose,
      initiative: state.initiativeLevel,
      questionNeeded: state.questionNeeded,
      stop: state.stopSignalDetected,
      continue: state.continueCueDetected,
      priorInherited: state.priorModeInherited,
    })
    if (expect?.mode && state.conversationMode !== expect.mode) {
      issues.push(`${name}: mode ${state.conversationMode} ≠ ${expect.mode} for "${userMessage}"`)
    }
    if (expect?.purpose && state.responsePurpose !== expect.purpose) {
      issues.push(
        `${name}: purpose ${state.responsePurpose} ≠ ${expect.purpose} for "${userMessage}"`,
      )
    }
    if (expect?.initiative && state.initiativeLevel !== expect.initiative) {
      issues.push(
        `${name}: initiative ${state.initiativeLevel} ≠ ${expect.initiative} for "${userMessage}"`,
      )
    }
    if (expect?.questionNeeded === false && state.questionNeeded) {
      issues.push(`${name}: unexpected question for "${userMessage}"`)
    }
    if (expect?.stop === true && !state.stopSignalDetected) {
      issues.push(`${name}: missing stop for "${userMessage}"`)
    }
    recent = [
      ...recent,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantStub || '…' },
    ]
  }
  return { name, ok: issues.length === 0, issues, rows }
}

const sequences = [
  scoreSequence('DECISION', [
    {
      userMessage: 'Aurora o Nova?',
      expect: { mode: 'decision_support', purpose: 'recommend', questionNeeded: false },
      assistantStub: 'Nova. È più distintiva.',
    },
    {
      userMessage: 'Nova.',
      expect: { mode: 'decision_support', purpose: 'continue' },
      assistantStub: 'Punti di forza di Nova…',
    },
    {
      userMessage: 'Continua.',
      expect: { mode: 'decision_support', purpose: 'continue' },
      assistantStub: 'Prossimo layer…',
    },
    {
      userMessage: 'E poi?',
      expect: { mode: 'decision_support', purpose: 'continue' },
    },
  ]),
  scoreSequence('BRAINSTORM', [
    {
      userMessage: 'Vorrei creare una nuova app.',
      expect: { mode: 'brainstorming' },
      assistantStub: 'Idee: Aurora, Nova…',
    },
    {
      userMessage: 'Nova mi piace.',
      expect: { mode: 'brainstorming', purpose: 'continue' },
      assistantStub: 'Sviluppiamo Nova…',
    },
    {
      userMessage: 'Continua.',
      expect: { mode: 'brainstorming', purpose: 'continue' },
      assistantStub: 'Identità…',
    },
    {
      userMessage: 'E poi?',
      expect: { mode: 'brainstorming', purpose: 'continue' },
    },
  ]),
  scoreSequence('TEACHING', [
    {
      userMessage: "Cos'è l'entropia?",
      expect: { mode: 'informational' },
      assistantStub: 'Definizione…',
    },
    {
      userMessage: 'Spiegalo semplice.',
      expect: { mode: 'teaching' },
      assistantStub: 'Versione semplice…',
    },
    {
      userMessage: 'Ora dettagliatamente.',
      expect: { mode: 'teaching' },
      assistantStub: 'Dettaglio…',
    },
    {
      userMessage: 'E poi?',
      expect: { mode: 'teaching', purpose: 'continue' },
    },
  ]),
  scoreSequence('DEBUG', [
    {
      userMessage: 'Questa API restituisce 401.',
      expect: { mode: 'debugging' },
      assistantStub: 'Prova X.',
    },
    {
      userMessage: 'Ho provato a fare X. Stesso errore.',
      expect: { mode: 'debugging' },
      assistantStub: 'Allora Y.',
    },
    {
      userMessage: 'Ancora niente, che palle.',
      expect: { mode: 'debugging', questionNeeded: false },
    },
  ]),
  scoreSequence('STOP', [
    {
      userMessage: 'Vorrei creare una nuova app.',
      expect: { mode: 'brainstorming' },
      assistantStub: 'Idee…',
    },
    {
      userMessage: 'Basta.',
      expect: { initiative: 'low', questionNeeded: false, stop: true },
    },
  ]),
  scoreSequence('PIVOT', [
    {
      userMessage: 'Vorrei creare una nuova app.',
      expect: { mode: 'brainstorming' },
      assistantStub: 'Nova…',
    },
    {
      userMessage: 'Nova mi piace.',
      expect: { mode: 'brainstorming' },
      assistantStub: 'Concept Nova…',
    },
    {
      userMessage: "Cos'è l'entropia?",
      expect: { mode: 'informational' },
    },
  ]),
  scoreSequence('PLAYFUL', [
    {
      userMessage: 'Mi annoio.',
      expect: { initiative: 'high', questionNeeded: false },
      assistantStub: 'Ok, sfida rapida…',
    },
    {
      userMessage: 'Ahahah',
      expect: { purpose: 'react' },
      assistantStub: 'Continuo il bit…',
    },
    {
      userMessage: 'Ancora 😂',
      expect: { purpose: 'continue' },
      assistantStub: '…',
    },
    {
      userMessage: 'Vai avanti',
      expect: { purpose: 'continue' },
    },
  ]),
  scoreSequence('CELEBRATION', [
    {
      userMessage: 'Finalmente funziona!!!',
      expect: { mode: 'celebration', questionNeeded: false },
    },
  ]),
]

const failed = sequences.filter((s) => !s.ok)
const nrp = buildNaturalResponsePolicyAppendix()
const momentum = buildConversationMomentumPolicySection()

const report = {
  build: '327-1',
  timestamp: new Date().toISOString(),
  sequences: sequences.map((s) => ({
    name: s.name,
    ok: s.ok,
    issues: s.issues,
    turns: s.rows.length,
  })),
  allOk: failed.length === 0,
  policy: {
    nrpChars: nrp.length,
    momentumChars: momentum.length,
    estimatedMomentumTokens: Math.ceil(momentum.length / 4),
  },
  proxies: {
    note: 'Deterministic state proxies only; model smoke optional via OPENAI_API_KEY.',
    shortFollowUpContinuationSuccess: sequences
      .filter((s) => ['DECISION', 'BRAINSTORM', 'TEACHING', 'PLAYFUL'].includes(s.name))
      .every((s) => s.ok),
    explicitStopCompliance: sequences.find((s) => s.name === 'STOP')?.ok ?? false,
    topicPivotSuccess: sequences.find((s) => s.name === 'PIVOT')?.ok ?? false,
    decisionNoReset: sequences.find((s) => s.name === 'DECISION')?.ok ?? false,
  },
  modelSmoke: null,
}

const outPath = join(root, 'tmp-eval-conversation-momentum.json')
writeFileSync(outPath, JSON.stringify(report, null, 2))

console.log(JSON.stringify(report, null, 2))
if (!report.allOk) {
  console.error('eval-conversation-momentum: FAIL')
  process.exit(1)
}

if (process.env.OPENAI_SMOKE === '1' && process.env.OPENAI_API_KEY) {
  const OpenAI = (await import('openai')).default
  const { LAIFE_BASE_SYSTEM_PROMPT } = await import('../lib/server/laife-base-system-prompt.js')
  const { buildConversationStateAppendix } = await import('../lib/server/conversation-state.js')
  const { buildCoreContinuityAppendix } = await import('../lib/server/conversation-continuity.js')
  const { buildCoreResponsesCreateParams } = await import('../lib/server/core-responses-params.js')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  function buildInstructions(userMessage, recentMessages) {
    const state = computeConversationState({ userMessage, recentMessages })
    const parts = [
      LAIFE_BASE_SYSTEM_PROMPT,
      buildConversationStateAppendix(state),
      buildNaturalResponsePolicyAppendix(),
      buildCoreContinuityAppendix(),
    ]
    return { state, instructions: parts.join('\n\n') }
  }

  const multiTurn = [
    {
      name: 'DECISION',
      turns: ['Aurora o Nova?', 'Continua.', 'E poi?'],
    },
    {
      name: 'BRAINSTORM',
      turns: ['Vorrei creare una nuova app.', 'Nova mi piace.', 'Continua.', 'E poi?'],
    },
    {
      name: 'STOP',
      turns: ['Vorrei creare una nuova app.', 'Basta.'],
    },
    {
      name: 'PIVOT',
      turns: ['Vorrei creare una nuova app.', "Cos'è l'entropia?"],
    },
  ]

  const smokeMetrics = {
    n: 0,
    serviceOffer: 0,
    trailingQ: 0,
    helpDeskReset: 0,
    sequences: [],
  }

  for (const seq of multiTurn) {
    /** @type {{role:string,content:string}[]} */
    let recent = []
    const previews = []
    for (const userMessage of seq.turns) {
      recent = [...recent, { role: 'user', content: userMessage }]
      const { state, instructions } = buildInstructions(userMessage, recent)
      const response = await client.responses.create(
        buildCoreResponsesCreateParams({
          model,
          instructions,
          maxOutputTokens: 280,
          input: recent.map((m) => ({ role: m.role, content: m.content })),
        }),
      )
      const content = (response.output_text || '').trim()
      const serviceOffer = /Vuoi che|Se vuoi posso|Posso anche|Would you like|Want me to/i.test(
        content,
      )
      const trailingQ = /\?\s*$/.test(content)
      const helpDeskReset = /Come posso aiutarti|How can I help/i.test(content)
      smokeMetrics.n += 1
      if (serviceOffer) smokeMetrics.serviceOffer += 1
      if (trailingQ) smokeMetrics.trailingQ += 1
      if (helpDeskReset) smokeMetrics.helpDeskReset += 1
      previews.push({
        userMessage,
        mode: state.conversationMode,
        purpose: state.responsePurpose,
        initiative: state.initiativeLevel,
        q: state.questionNeeded,
        serviceOffer,
        trailingQ,
        helpDeskReset,
        preview: content.slice(0, 140).replace(/\n/g, ' / '),
      })
      recent = [...recent, { role: 'assistant', content: content || '…' }]
    }
    smokeMetrics.sequences.push({ name: seq.name, turns: previews })
    console.log('SMOKE_SEQ', seq.name, previews)
  }

  report.modelSmoke = {
    model,
    serviceOfferRate: smokeMetrics.serviceOffer / smokeMetrics.n,
    unnecessaryQuestionRate: smokeMetrics.trailingQ / smokeMetrics.n,
    helpDeskResetRate: smokeMetrics.helpDeskReset / smokeMetrics.n,
    sequences: smokeMetrics.sequences,
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log('SMOKE_METRICS', {
    serviceOfferRate: report.modelSmoke.serviceOfferRate,
    unnecessaryQuestionRate: report.modelSmoke.unnecessaryQuestionRate,
    helpDeskResetRate: report.modelSmoke.helpDeskResetRate,
  })
}

console.log('eval-conversation-momentum: ok')
