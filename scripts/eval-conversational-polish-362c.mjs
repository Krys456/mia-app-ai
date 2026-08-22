/**
 * #362C focused model smoke — contextual decision / referent / continuity.
 * Run: OPENAI_SMOKE=1 node scripts/eval-conversational-polish-362c.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAIFE_BASE_SYSTEM_PROMPT, PERSONALITY_2_BUILD } from '../lib/server/laife-base-system-prompt.js'
import {
  CONVERSATION_STATE_BUILD,
  computeConversationState,
  buildConversationStateAppendix,
  buildStyleAvoidAppendix,
  createEmptySessionStyleState,
  collectSessionStyleFingerprints,
} from '../lib/server/conversation-state.js'
import {
  NATURAL_RESPONSE_POLICY_BUILD,
  buildNaturalResponsePolicyAppendix,
} from '../lib/server/natural-response-policy.js'
import { buildCoreLanguageAppendix } from '../lib/server/language-awareness.js'
import { buildCoreContinuityAppendix } from '../lib/server/conversation-continuity.js'
import { buildCoreConversationalUnderstandingAppendix } from '../lib/server/conversational-understanding.js'
import { buildCoreAdaptiveResponseReasoningAppendix } from '../lib/server/adaptive-response-reasoning.js'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'scripts/eval-conversational-polish-362c.report.json')
const artifactPath = '/opt/cursor/artifacts/362c_model_smoke_report.json'

const SERVICE =
  /Vuoi che|Se vuoi posso|Se vuoi,|Posso anche|Fammi sapere|Would you like|Want me to|Se hai bisogno|Sono qui se|Let me know/i
const FILLER_OPEN =
  /^(Certo[!.,]?|Assolutamente[!.,]?|Capisco[!.,]?|Ottima (domanda|idea)[!.,]?|Perfetto[!.,]?|Va bene[!.,]?)/i
const GENERIC_CHECKLIST =
  /\b(?:se\s+(?:oltre|anche)|if\s+(?:also|code\s+review|ci\s+obbligator)|code\s+review|ci\s+obbligator)/i
const EMOJI = /\p{Extended_Pictographic}/gu

function emojiCount(t) {
  return (String(t || '').match(EMOJI) || []).length
}

function buildInstructions(userMessage, recent, sessionStyle) {
  const state = computeConversationState({
    userMessage,
    recentMessages: recent,
    sessionStyle,
    settings: { replyLength: 'balanced', useEmojis: true },
  })
  const parts = [
    LAIFE_BASE_SYSTEM_PROMPT,
    buildConversationStateAppendix(state),
    buildStyleAvoidAppendix(sessionStyle, state),
    buildNaturalResponsePolicyAppendix(),
    buildCoreLanguageAppendix({ userMessage, messages: recent, browserLocale: 'it-IT' }),
    buildCoreContinuityAppendix(),
    buildCoreConversationalUnderstandingAppendix(),
    buildCoreAdaptiveResponseReasoningAppendix(),
  ].filter(Boolean)
  return { state, instructions: parts.join('\n\n') }
}

/** @type {Record<string, {role:string,content:string}[]>} */
const SEQUENCES = {
  A_DECISION_EVIDENCE: [
    {
      role: 'user',
      content: 'Tests PASS. CI green. Manual QA PASS. SAFE TO MERGE YES.',
    },
    { role: 'assistant', content: 'Perfetto, a questo punto sembra pronto.' },
    { role: 'user', content: 'Faccio merge?' },
  ],
  B_REFERENT_PUSHBACK: [
    { role: 'user', content: 'Secondo te questa idea fa schifo? 😂' },
    {
      role: 'assistant',
      content: "Fa schifo no 😂 Però così com'è ha un problema di scope.",
    },
    { role: 'user', content: 'No, non mi convince.' },
  ],
  C_KEFIR: [
    { role: 'user', content: 'Quali latticini possono farmi andare in bagno?' },
    {
      role: 'assistant',
      content: 'Dipende, ma spesso: latte, yogurt, gelato, formaggi freschi.',
    },
    { role: 'user', content: 'Il kefir invece?' },
  ],
  D_FRUSTRATION_WHY: [
    { role: 'user', content: 'Non funziona ancora, che palle' },
    { role: 'assistant', content: 'Eh sì, qui c\'è ancora qualcosa che non torna.' },
    { role: 'user', content: 'Perché?' },
  ],
  E_SEI_SICURO: [
    { role: 'user', content: 'La PR ha passato tutti i test. Faccio merge?' },
    { role: 'assistant', content: 'Sì, farei il merge. ✅' },
    { role: 'user', content: 'Sei sicuro?' },
  ],
}

const report = {
  build: {
    personality: PERSONALITY_2_BUILD,
    state: CONVERSATION_STATE_BUILD,
    nrp: NATURAL_RESPONSE_POLICY_BUILD,
  },
  timestamp: new Date().toISOString(),
  smoke: null,
}

if (process.env.OPENAI_SMOKE === '1' && process.env.OPENAI_API_KEY) {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  const sequences = []
  for (const [name, seed] of Object.entries(SEQUENCES)) {
    let recent = seed.slice(0, -1)
    let sessionStyle = createEmptySessionStyleState()
    for (const m of recent) {
      if (m.role === 'assistant') sessionStyle = collectSessionStyleFingerprints(m.content, sessionStyle)
    }
    const userMessage = seed[seed.length - 1].content
    recent = [...recent, { role: 'user', content: userMessage }]
    const { state, instructions } = buildInstructions(userMessage, recent, sessionStyle)
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: 280,
        input: recent.map((m) => ({ role: m.role, content: m.content })),
      }),
    )
    const content = (response.output_text || '').trim()
    const row = {
      name,
      userMessage,
      mode: state.conversationMode,
      purpose: state.responsePurpose,
      emojiLevel: state.emojiLevel,
      qNeeded: state.questionNeeded,
      endsQ: /\?\s*$/.test(content),
      service: SERVICE.test(content),
      filler: FILLER_OPEN.test(content),
      genericChecklist: GENERIC_CHECKLIST.test(content),
      emojiCount: emojiCount(content),
      preview: content.slice(0, 240).replace(/\n/g, ' / '),
      full: content,
    }
    sequences.push(row)
    console.log(
      'SMOKE',
      name,
      `mode=${row.mode}/${row.purpose}`,
      `e#=${row.emojiCount}`,
      `endsQ=${row.endsQ}`,
      `checklist=${row.genericChecklist}`,
      row.preview.slice(0, 120),
    )
  }

  const n = sequences.length || 1
  report.smoke = {
    model,
    n,
    trailingQRate: sequences.filter((t) => t.endsQ).length / n,
    endsQWhenQNeededFalse: sequences.filter((t) => t.endsQ && t.qNeeded === false).length / n,
    serviceOfferRate: sequences.filter((t) => t.service).length / n,
    fillerOpenRate: sequences.filter((t) => t.filler).length / n,
    unnecessaryConditionalDecisionRate:
      sequences.filter((t) => t.name === 'A_DECISION_EVIDENCE' && t.genericChecklist).length /
      Math.max(1, sequences.filter((t) => t.name === 'A_DECISION_EVIDENCE').length),
    meanEmoji: sequences.reduce((a, t) => a + t.emojiCount, 0) / n,
    sequences,
  }
} else {
  console.log('Set OPENAI_SMOKE=1 for model smoke.')
}

writeFileSync(outPath, JSON.stringify(report, null, 2))
try {
  mkdirSync('/opt/cursor/artifacts', { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(report, null, 2))
} catch {
  /* optional */
}
console.log('Wrote', outPath)
console.log(JSON.stringify({ build: report.build, smoke: report.smoke && {
  n: report.smoke.n,
  trailingQRate: report.smoke.trailingQRate,
  endsQWhenQNeededFalse: report.smoke.endsQWhenQNeededFalse,
  serviceOfferRate: report.smoke.serviceOfferRate,
  fillerOpenRate: report.smoke.fillerOpenRate,
  unnecessaryConditionalDecisionRate: report.smoke.unnecessaryConditionalDecisionRate,
  meanEmoji: report.smoke.meanEmoji,
} }, null, 2))
