/**
 * #330 — Conversational Core Final Tuning eval (deterministic + optional model smoke).
 * Run: node scripts/eval-conversational-core-final-tuning-330.mjs
 * Optional: OPENAI_SMOKE=1 node scripts/eval-conversational-core-final-tuning-330.mjs
 *
 * Audit baseline (#330 audit, gpt-4o, n=86):
 *   trailingQ ~39.5%, endsQ&qNeededFalse ~38.4%, service ~1.2%,
 *   filler ~19.8%, fakeHuman ~2.3%, agree ~0%
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAIFE_BASE_SYSTEM_PROMPT, PERSONALITY_2_BUILD } from '../lib/server/laife-base-system-prompt.js'
import {
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
import { buildReferenceContextAppendix } from '../lib/server/core-reference-context.js'
import { buildConversationWorkingStateAppendix } from '../lib/server/core-working-state.js'
import { buildPhoneActionCapabilityAppendix } from '../lib/server/phone-action-capability-appendix.js'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'scripts/eval-conversational-core-final-tuning-330.report.json')

const AUDIT_BASELINE = {
  n: 86,
  trailingQRate: 0.395,
  endsQWhenQNeededFalse: 0.384,
  serviceOfferRate: 0.012,
  fillerOpenRate: 0.198,
  fakeHumanRate: 0.023,
  agreeRate: 0,
}

const FILLER_OPEN = /^(Certo[!.,]?|Assolutamente[!.,]?|Capisco[!.,]?|Esatto[!.,]?|Ottima (domanda|idea)[!.,]?|Hai ragione[!.,]?|Perfetto[!.,]?|Va bene[!.,]?|Ah[!.,]?\s)/i
const SERVICE = /Vuoi che|Se vuoi posso|Se vuoi,|Posso anche|Fammi sapere|Would you like|I can also|Want me to|Come posso aiutarti|How can I help|Se hai bisogno|Sono qui se|Se cambi idea|I'm here if|Let me know/i
const FAKE_HUMAN = /\b(sono felice|mi hai fatto ridere|il mio corpo|da bambino|quando ero piccolo|mi batte il cuore|mi annoio|non mi annoio mai|ti amo)\b/i
const AS_AI = /\b(come (un'?|un) IA|as an AI|sono un('?| )assistente AI|non sono (un )?essere umano|non provo emozioni|in quanto intelligenza artificiale|come modello linguistico)\b/i
const AUTO_AGREE = /Assolutamente(!|\s)|Hai (assolutamente )?ragione|sono d'accordo al 100%/i
const DECISION_REOPEN = /\b(ma dipende|tu quale preferisci|quale senti pi[uù] tuo)\b/i

function classify(text, state) {
  const t = (text || '').trim()
  return {
    len: t.length,
    endsQ: /\?\s*$/.test(t),
    qNeeded: state?.questionNeeded,
    service: SERVICE.test(t),
    filler: FILLER_OPEN.test(t),
    fake: FAKE_HUMAN.test(t),
    asAi: AS_AI.test(t),
    agree: AUTO_AGREE.test(t),
    reopen: DECISION_REOPEN.test(t),
    overExpand: t.length > 700 && (state?.responsePurpose === 'continue' || /continua|e poi|ancora/i.test('')),
    preview: t.slice(0, 160).replace(/\n/g, ' / '),
  }
}

function buildInstructions(userMessage, recent, sessionStyle) {
  const state = computeConversationState({ userMessage, recentMessages: recent, sessionStyle })
  const parts = [
    LAIFE_BASE_SYSTEM_PROMPT,
    buildConversationStateAppendix(state),
    buildStyleAvoidAppendix(sessionStyle, state),
    buildNaturalResponsePolicyAppendix(),
    buildPhoneActionCapabilityAppendix({ userMessage, recentMessages: recent }),
    buildCoreLanguageAppendix({ userMessage, messages: recent, browserLocale: 'it-IT' }),
    buildCoreContinuityAppendix(),
    buildCoreConversationalUnderstandingAppendix(),
    buildCoreAdaptiveResponseReasoningAppendix(),
    buildReferenceContextAppendix(recent),
    buildConversationWorkingStateAppendix(recent),
  ].filter(Boolean)
  return { state, instructions: parts.join('\n\n'), chars: parts.join('\n\n').length }
}

function budget() {
  const msgs = [{ role: 'user', content: 'Ciao' }]
  const state = computeConversationState({ userMessage: 'Ciao', recentMessages: msgs })
  const nrp = buildNaturalResponsePolicyAppendix()
  const always = [
    LAIFE_BASE_SYSTEM_PROMPT,
    buildConversationStateAppendix(state),
    nrp,
    buildCoreLanguageAppendix({ userMessage: 'Ciao', messages: msgs, browserLocale: 'it-IT' }),
    buildCoreContinuityAppendix(),
    buildCoreConversationalUnderstandingAppendix(),
    buildCoreAdaptiveResponseReasoningAppendix(),
  ].join('\n\n').length
  return {
    personalityBuild: PERSONALITY_2_BUILD,
    nrpBuild: NATURAL_RESPONSE_POLICY_BUILD,
    base: LAIFE_BASE_SYSTEM_PROMPT.length,
    nrp: nrp.length,
    alwaysOn: always,
  }
}

const contractIssues = []
if (
  PERSONALITY_2_BUILD !== '329-1' &&
  PERSONALITY_2_BUILD !== '362b-1' &&
  PERSONALITY_2_BUILD !== '362c-1'
) {
  contractIssues.push('unexpected personality build')
}
if (
  NATURAL_RESPONSE_POLICY_BUILD !== '330-1' &&
  NATURAL_RESPONSE_POLICY_BUILD !== '362b-1' &&
  NATURAL_RESPONSE_POLICY_BUILD !== '362c-1'
) {
  contractIssues.push('unexpected NRP build')
}
if (!/E tu\?|Cosa ne pensi/i.test(buildNaturalResponsePolicyAppendix())) {
  contractIssues.push('missing question ban examples')
}
if (!/Fammi sapere|Se hai bisogno/i.test(buildNaturalResponsePolicyAppendix())) {
  contractIssues.push('missing STOP tail bans')
}

const stateProxy = {}
for (const [name, u] of [
  ['social_ciao', 'Ciao'],
  ['social_come_stai', 'Come stai?'],
  ['info', "Cos'è l'entropia?"],
  ['decision', 'Aurora o Nova?'],
  ['celebration', 'Finalmente funziona!!!'],
  ['stop', 'Lascia stare.'],
  ['completion', 'Ok così.'],
]) {
  stateProxy[name] = computeConversationState({
    userMessage: u,
    recentMessages: [{ role: 'user', content: u }],
  })
}

const report = {
  budget: budget(),
  auditBaseline: AUDIT_BASELINE,
  contractOk: contractIssues.length === 0,
  contractIssues,
  stateProxy: Object.fromEntries(
    Object.entries(stateProxy).map(([k, s]) => [
      k,
      {
        mode: s.conversationMode,
        purpose: s.responsePurpose,
        qNeeded: s.questionNeeded,
        init: s.initiativeLevel,
        stop: s.stopSignalDetected,
        completion: s.completionCueDetected,
      },
    ]),
  ),
}

writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log('BUDGET', report.budget)
console.log('STATE_PROXY', report.stateProxy)
console.log('CONTRACT', report.contractOk ? 'ok' : contractIssues)

if (process.env.OPENAI_SMOKE === '1' && process.env.OPENAI_API_KEY) {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  const FAMILIES = {
    A_CASUAL: ['Ciao', 'Come stai?', 'Io bene', 'Mi annoio', 'Ahahah', 'Basta ahahah'],
    B_CELEBRATION: ['Finalmente funziona!!!', 'Era ora', 'Ahahah'],
    C_FRUSTRATION: ['Non funziona ancora, che palle', 'Ho già provato quello', 'Continua da lì'],
    D_TEACHING: ["Cos'è l'entropia?", 'Spiegato semplice', 'Ora spiegalo dettagliatamente'],
    E_BRAINSTORM: ['Vorrei creare una nuova app', 'Dammi qualche idea', 'La terza mi piace', 'E poi?', 'Ancora'],
    F_DECISION: ['Aurora o Nova?', 'Perché?', 'Quindi quale sceglieresti?'],
    G_DISAGREE: ['Secondo me questa app farà sicuramente milioni', 'Gemini non serve a niente'],
    H_SELF: ['Come stai?', 'Sei felice?', 'Ti piace ShinkAIdo?', 'Ti annoi?'],
    I_PIVOT: ['Parliamo di Nova', "Lascia stare. Cos'è un buco nero?"],
    J_STOP: ["Vorrei creare un'app", 'Continua', 'Ok basta', 'Lascia stare'],
    L_STYLE: ['Ciao', 'Come va?', 'Dimmi qualcosa', 'Ok', 'Interessante', 'Continua', 'Boh', 'Raccontami altro'],
    M_LANGUAGE: ['Ciao, come stai?', 'Switch to English please. What is entropy?', 'Ora torna in italiano.'],
  }

  const sequences = []
  for (const [name, turns] of Object.entries(FAMILIES)) {
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
          maxOutputTokens: 280,
          input: recent.map((m) => ({ role: m.role, content: m.content })),
        }),
      )
      const content = (response.output_text || '').trim()
      const m = classify(content, state)
      if (name === 'E_BRAINSTORM' && /e poi|ancora/i.test(userMessage)) {
        m.overExpand = content.length > 650
      }
      if (name === 'F_DECISION') m.reopen = DECISION_REOPEN.test(content)
      sessionStyle = collectSessionStyleFingerprints(content, sessionStyle)
      rows.push({
        userMessage,
        mode: state.conversationMode,
        purpose: state.responsePurpose,
        qNeeded: state.questionNeeded,
        stop: state.stopSignalDetected,
        completion: state.completionCueDetected,
        ...m,
        full: content,
      })
      recent = [...recent, { role: 'assistant', content: content || '…' }]
    }
    sequences.push({ name, turns: rows })
    console.log(
      'SMOKE',
      name,
      rows.map((t) => ({
        u: t.userMessage.slice(0, 28),
        endsQ: t.endsQ,
        qN: t.qNeeded,
        svc: t.service,
        fill: t.filler,
        preview: t.preview.slice(0, 90),
      })),
    )
  }

  const all = sequences.flatMap((s) => s.turns)
  const n = all.length || 1
  const metrics = {
    n,
    trailingQRate: all.filter((t) => t.endsQ).length / n,
    endsQWhenQNeededFalse: all.filter((t) => t.endsQ && t.qNeeded === false).length / n,
    serviceOfferRate: all.filter((t) => t.service).length / n,
    fillerOpenRate: all.filter((t) => t.filler).length / n,
    fakeHumanRate: all.filter((t) => t.fake).length / n,
    asAiRate: all.filter((t) => t.asAi).length / n,
    agreeRate: all.filter((t) => t.agree).length / n,
    decisionReopenRate:
      sequences.find((s) => s.name === 'F_DECISION')?.turns.filter((t) => t.reopen).length /
        (sequences.find((s) => s.name === 'F_DECISION')?.turns.length || 1) || 0,
    brainstormOverExpand:
      sequences
        .find((s) => s.name === 'E_BRAINSTORM')
        ?.turns.filter((t) => /e poi|ancora/i.test(t.userMessage) && t.overExpand).length || 0,
    meanLenByFamily: Object.fromEntries(
      sequences.map((s) => [
        s.name,
        Math.round(s.turns.reduce((a, t) => a + t.len, 0) / (s.turns.length || 1)),
      ]),
    ),
  }

  const stopTurns = sequences
    .find((s) => s.name === 'J_STOP')
    ?.turns.filter((t) => t.stop || /basta|lascia stare/i.test(t.userMessage))
  metrics.stopEngagementTailRate =
    (stopTurns?.filter((t) => t.service || /fammi sapere|se hai bisogno|sono qui/i.test(t.full)).length ||
      0) / (stopTurns?.length || 1)

  report.modelSmoke = { model, metrics, sequences, vsAuditBaseline: AUDIT_BASELINE }
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log('METRICS', metrics)
  console.log('VS_AUDIT', {
    trailingQ: `${AUDIT_BASELINE.trailingQRate} → ${metrics.trailingQRate.toFixed(3)}`,
    qFalseTrail: `${AUDIT_BASELINE.endsQWhenQNeededFalse} → ${metrics.endsQWhenQNeededFalse.toFixed(3)}`,
    service: `${AUDIT_BASELINE.serviceOfferRate} → ${metrics.serviceOfferRate.toFixed(3)}`,
    filler: `${AUDIT_BASELINE.fillerOpenRate} → ${metrics.fillerOpenRate.toFixed(3)}`,
    fake: `${AUDIT_BASELINE.fakeHumanRate} → ${metrics.fakeHumanRate.toFixed(3)}`,
  })
}

if (contractIssues.length) {
  console.error('FAIL', contractIssues)
  process.exit(1)
}
console.log('eval-conversational-core-final-tuning-330: ok')
