/**
 * #362B — Conversational Intelligence 3.0 model smoke (optional).
 * Run: OPENAI_SMOKE=1 node scripts/eval-conversational-intelligence-362b.mjs
 *
 * Does NOT assert exact wording. Scores proxies: trailing Q, service offers,
 * filler opens, emoji density, decision clarity cues.
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
const outPath = join(root, 'scripts/eval-conversational-intelligence-362b.report.json')
const artifactPath = '/opt/cursor/artifacts/362b_model_smoke_report.json'

const SERVICE =
  /Vuoi che|Se vuoi posso|Se vuoi,|Posso anche|Fammi sapere|Would you like|Want me to|Se hai bisogno|Sono qui se|Let me know/i
const FILLER_OPEN =
  /^(Certo[!.,]?|Assolutamente[!.,]?|Capisco[!.,]?|Ottima (domanda|idea)[!.,]?|Perfetto[!.,]?|Va bene[!.,]?)/i
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

const BLOCKS = {
  A_CASUAL: ['Ciao', 'Come va?', 'Mi annoio'],
  B_CELEBRATION: ['Finalmente funziona!!!', 'Era ora 😂'],
  C_FRUSTRATION: ['Non funziona ancora, che palle', 'Perché?'],
  D_REPAIR: ["Cos'è OAuth?", 'Non ho capito', 'Fammi un esempio'],
  E_DECISION: ['La PR ha passato tutti i test. Faccio merge?', 'Sei sicuro?'],
  F_PLAYFUL: ['Secondo te questa idea fa schifo? 😂', 'No, non mi convince.'],
  G_EXAMPLES: ['Quali latticini possono farmi andare in bagno?'],
}

const stateProxy = {}
for (const [name, turns] of Object.entries(BLOCKS)) {
  stateProxy[name] = turns.map((userMessage) => {
    const s = computeConversationState({
      userMessage,
      recentMessages: [{ role: 'user', content: userMessage }],
      settings: { replyLength: 'balanced', useEmojis: true },
    })
    return {
      userMessage,
      mode: s.conversationMode,
      purpose: s.responsePurpose,
      tone: s.emotionalTone,
      emoji: s.emojiLevel,
      depth: s.desiredDepth,
      qNeeded: s.questionNeeded,
    }
  })
}

const report = {
  build: {
    personality: PERSONALITY_2_BUILD,
    state: CONVERSATION_STATE_BUILD,
    nrp: NATURAL_RESPONSE_POLICY_BUILD,
  },
  timestamp: new Date().toISOString(),
  stateProxy,
  smoke: null,
}

if (process.env.OPENAI_SMOKE === '1' && process.env.OPENAI_API_KEY) {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  const sequences = []
  for (const [name, turns] of Object.entries(BLOCKS)) {
    /** @type {{role:string,content:string}[]} */
    let recent = []
    let sessionStyle = createEmptySessionStyleState()
    const rows = []
    for (const userMessage of turns) {
      recent = [...recent, { role: 'user', content: userMessage }]
      const { state, instructions } = buildInstructions(userMessage, recent, sessionStyle)
      const response = await client.responses.create(
        buildCoreResponsesCreateParams({
          model,
          instructions,
          maxOutputTokens: 320,
          input: recent.map((m) => ({ role: m.role, content: m.content })),
        }),
      )
      const content = (response.output_text || '').trim()
      const row = {
        userMessage,
        mode: state.conversationMode,
        purpose: state.responsePurpose,
        tone: state.emotionalTone,
        emojiLevel: state.emojiLevel,
        qNeeded: state.questionNeeded,
        len: content.length,
        endsQ: /\?\s*$/.test(content),
        service: SERVICE.test(content),
        filler: FILLER_OPEN.test(content),
        emojiCount: emojiCount(content),
        preview: content.slice(0, 220).replace(/\n/g, ' / '),
        full: content,
      }
      sessionStyle = collectSessionStyleFingerprints(content, sessionStyle)
      rows.push(row)
      recent = [...recent, { role: 'assistant', content: content || '…' }]
      console.log(
        'SMOKE',
        name,
        userMessage.slice(0, 36),
        `mode=${row.mode}`,
        `emojiL=${row.emojiLevel}`,
        `e#=${row.emojiCount}`,
        `endsQ=${row.endsQ}`,
        `svc=${row.service}`,
        row.preview.slice(0, 100),
      )
    }
    sequences.push({ name, turns: rows })
  }

  const all = sequences.flatMap((s) => s.turns)
  const n = all.length || 1
  report.smoke = {
    model,
    n,
    trailingQRate: all.filter((t) => t.endsQ).length / n,
    endsQWhenQNeededFalse: all.filter((t) => t.endsQ && t.qNeeded === false).length / n,
    serviceOfferRate: all.filter((t) => t.service).length / n,
    fillerOpenRate: all.filter((t) => t.filler).length / n,
    meanEmoji: all.reduce((a, t) => a + t.emojiCount, 0) / n,
    frustrationEmojiMax: Math.max(
      0,
      ...all.filter((t) => t.tone === 'frustrated').map((t) => t.emojiCount),
    ),
    sequences,
  }
} else {
  console.log('Deterministic stateProxy only (set OPENAI_SMOKE=1 for model smoke).')
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
  meanEmoji: report.smoke.meanEmoji,
  frustrationEmojiMax: report.smoke.frustrationEmojiMax,
} }, null, 2))
