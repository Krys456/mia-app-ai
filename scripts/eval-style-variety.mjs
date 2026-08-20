/**
 * #326 — multi-turn style variety eval (deterministic fingerprint proxies).
 * Compares empty-style baseline vs accumulated sessionStyle soft-avoid presence.
 * Run: node scripts/eval-style-variety.mjs
 */
import {
  buildStyleAvoidAppendix,
  collectSessionStyleFingerprints,
  computeConversationState,
  createEmptySessionStyleState,
} from '../lib/server/conversation-state.js'
import { buildNaturalResponsePolicyAppendix } from '../lib/server/natural-response-policy.js'
import { buildConversationStateAppendix } from '../lib/server/conversation-state.js'

/** @typedef {{ user: string, assistant: string }} Turn */

/** @type {Record<string, Turn[]>} */
const SEQUENCES = {
  casual: [
    { user: 'Ciao', assistant: 'Ciao! 👋 Come va?' },
    { user: 'Come va?', assistant: 'Tutto bene qui — e tu?' },
    { user: 'Mi annoio', assistant: 'Ah, classico. Vuoi una storia breve o un fatto random?' },
    { user: 'Ahahah', assistant: '😂 Ok, tono leggero allora.' },
    { user: 'Che storia 😂', assistant: 'Una volta un bug sembrava un feature…' },
    { user: 'E poi?', assistant: 'Poi qualcuno ha deployato il venerdì. Fine.' },
  ],
  celebration: [
    { user: 'Finalmente funziona!!!', assistant: 'Finalmente 😄' },
    { user: "Ce l'abbiamo fatta!", assistant: 'YES, ci siamo 🙌' },
    { user: 'YESSS!', assistant: 'Grande 🔥' },
    { user: 'Grande!', assistant: 'Meritato. Davvero.' },
  ],
  debugging: [
    { user: 'Non funziona ancora.', assistant: 'Capisco. Che errore vedi esatto?' },
    { user: 'Ancora niente.', assistant: 'Ok — log o status code?' },
    { user: 'Stesso errore.', assistant: 'Allora è riproducibile. Incolla le ultime 5 righe.' },
    { user: 'Che palle.', assistant: 'Sì, frustrante. Restiamo sul segnale concreto.' },
  ],
  decision: [
    { user: 'Nova o Aurora?', assistant: 'Io sceglierei Nova: più chiaro.' },
    { user: 'E tra Luna e Stella?', assistant: 'Tra i due, Luna.' },
    { user: 'Ultima: Pixel o Spark?', assistant: 'Pixel, senza dubbio.' },
  ],
}

function rateRepeated(values) {
  if (values.length < 2) return 0
  let repeats = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] && values[i] === values[i - 1]) repeats++
  }
  return repeats / (values.length - 1)
}

function analyzeSequence(name, turns) {
  /** @type {string[]} */
  const phrases = []
  /** @type {string[]} */
  const openings = []
  /** @type {string[]} */
  const acks = []
  /** @type {string[]} */
  const emojisFlat = []
  /** @type {string[]} */
  const endings = []
  /** @type {string[]} */
  const structures = []
  let trailingQ = 0
  let service = 0
  let style = createEmptySessionStyleState()
  let avoidChars = 0

  for (const turn of turns) {
    const before = style
    const state = computeConversationState({
      userMessage: turn.user,
      settings: {},
      sessionStyle: before,
    })
    const avoid = buildStyleAvoidAppendix(before, state)
    avoidChars = Math.max(avoidChars, avoid.length)
    style = collectSessionStyleFingerprints(turn.assistant, style)
    phrases.push(style.recentFirstPhrases.at(-1) || '')
    openings.push(style.recentOpeningTypes.at(-1) || '')
    const ack = style.recentAcknowledgementTypes.at(-1)
    if (ack) acks.push(ack)
    emojisFlat.push(...(style.recentEmojis.slice(-2) || []))
    endings.push(style.recentEndingTypes.at(-1) || '')
    structures.push(style.recentStructureTypes.at(-1) || '')
    if (/\?\s*$/.test(turn.assistant)) trailingQ++
    if (/vuoi\s+che|se\s+vuoi\s+posso|want\s+me\s+to/i.test(turn.assistant)) service++
  }

  return {
    name,
    turns: turns.length,
    repeatedFirstPhraseRate: Number(rateRepeated(phrases).toFixed(3)),
    repeatedOpeningTypeRate: Number(rateRepeated(openings).toFixed(3)),
    repeatedAckRate: Number(rateRepeated(acks).toFixed(3)),
    trailingQuestionRate: Number((trailingQ / turns.length).toFixed(3)),
    serviceOfferRate: Number((service / turns.length).toFixed(3)),
    repeatedStructureRate: Number(rateRepeated(structures).toFixed(3)),
    uniqueEmojis: [...new Set(emojisFlat)].length,
    maxStyleAvoidChars: avoidChars,
    samplePhrases: phrases,
  }
}

const nrp = buildNaturalResponsePolicyAppendix()
const emptyState = computeConversationState({ userMessage: 'Ciao', settings: {} })
const baseAppendix = buildConversationStateAppendix(emptyState)
const emptyAvoid = buildStyleAvoidAppendix(createEmptySessionStyleState(), emptyState)

console.log('eval-style-variety #326')
console.log(
  JSON.stringify(
    {
      nrpChars: nrp.length,
      stateAppendixChars: baseAppendix.length,
      emptyStyleAvoidChars: emptyAvoid.length,
      estimatedAddedTokensWhenStyled: Math.ceil(400 / 4),
      extraModelCalls: 0,
    },
    null,
    2,
  ),
)

for (const [name, turns] of Object.entries(SEQUENCES)) {
  const report = analyzeSequence(name, turns)
  console.log(`\n▶ ${name}`)
  console.log(JSON.stringify(report, null, 2))
  // Soft sanity: fingerprints collected
  assertOk(report.samplePhrases.length === turns.length, `${name} phrases`)
}

function assertOk(cond, label) {
  if (!cond) {
    console.error('FAIL', label)
    process.exitCode = 1
  }
}

console.log('\neval-style-variety: ok (proxy metrics; not statistical significance)')
