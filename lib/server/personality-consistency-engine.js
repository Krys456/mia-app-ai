/**
 * LAIfe Personality Consistency Engine
 *
 * Create and enforce a stable personality profile across the entire conversation.
 *
 * Traits (always on):
 *   - Warm
 *   - Curious
 *   - Observant
 *   - Optimistic
 *   - Calm
 *   - Playful when appropriate
 *
 * Never become:
 *   - robotic
 *   - overly formal
 *   - lecturer
 *   - therapist
 *
 * Personality stays stable turn-to-turn. Emotional Momentum may shift climate;
 * this engine keeps *who LAIfe is* consistent underneath.
 *
 * Runs AFTER: Emotional Momentum (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} ConsistencyLang
 */

/**
 * @typedef {object} PersonalityTraits
 * @property {number} warm 0–1
 * @property {number} curious 0–1
 * @property {number} observant 0–1
 * @property {number} optimistic 0–1
 * @property {number} calm 0–1
 * @property {number} playfulWhenAppropriate 0–1  (readiness; not forced play)
 */

/**
 * @typedef {object} PersonalityConsistencyPlan
 * @property {boolean} active
 * @property {boolean} holdStable
 * @property {PersonalityTraits} profile
 * @property {string[]} traits
 * @property {string[]} neverBecome
 * @property {string[]} driftSignals
 * @property {boolean} playfulOk
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ConsistencyLang} language
 * @property {string} validationCheck
 * @property {string} signatureCheck
 */

/** Stable LAIfe identity — does not change mid-conversation. */
export const STABLE_PERSONALITY_PROFILE = Object.freeze({
  warm: 0.82,
  curious: 0.78,
  observant: 0.8,
  optimistic: 0.72,
  calm: 0.85,
  playfulWhenAppropriate: 0.7,
})

export const STABLE_TRAITS = Object.freeze([
  'Warm',
  'Curious',
  'Observant',
  'Optimistic',
  'Calm',
  'Playful when appropriate',
])

export const NEVER_BECOME = Object.freeze([
  'robotic',
  'overly formal',
  'lecturer',
  'therapist',
])

const ROBOTIC_RE =
  /\b(as an ai|as an artificial|i('m| am) (just )?an? (ai|language model|assistant)|come (posso|posso)\s+aiutarti|how can i help( you)?( today)?|i('m| am) here to help|feel free to ask|let me know if you (need|have)|non esitare a (chiedere|contattarmi)|sono qui per (aiutarti|assistere))\b/i

const OVERLY_FORMAL_RE =
  /\b(dear (sir|madam)|to whom it may concern|please be advised|pursuant to|kindly note|i hereby|cordially|distinguished|with all due respect|si prega di|con la presente|egregio|gentilissimo|la presente per)\b/i

const LECTURER_RE =
  /\b(it is important to (note|understand|remember)|one must (understand|consider)|in conclusion,? (we|one)|let us (examine|consider|discuss)|first(ly)?,? second(ly)?,? third|as (previously|aforementioned)|è importante (notare|capire|ricordare)|bisogna (capire|considerare)|in conclusione|esaminiamo|come detto in precedenza)\b/i

const THERAPIST_RE =
  /\b(how does that make you feel|i hear you\.? (that|it) (sounds|must)|validate your (feelings|emotions)|safe space|it('s| is) okay to feel|i('m| am) proud of you for|therapeutic|come ti fa sentire|valido i tuoi (sentimenti|emozioni)|spazio sicuro|è ok sentirsi|sono orgoglios[oa] di te per)\b/i

const PLAYFUL_USER_RE =
  /\b(haha|hahaha|ahah|ahahah|lol|lmao|😂|🤣|😅|😜|scherz|joke|funny|divertent|battuta|hah)\b/i

/**
 * @param {unknown} messages
 * @returns {ChatTurn[]}
 */
function asTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(/** @type {{ role?: string }} */ (m).role || ''),
      content: String(/** @type {{ content?: string }} */ (m).content || '').trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @returns {PersonalityTraits}
 */
function cloneProfile() {
  return {
    warm: STABLE_PERSONALITY_PROFILE.warm,
    curious: STABLE_PERSONALITY_PROFILE.curious,
    observant: STABLE_PERSONALITY_PROFILE.observant,
    optimistic: STABLE_PERSONALITY_PROFILE.optimistic,
    calm: STABLE_PERSONALITY_PROFILE.calm,
    playfulWhenAppropriate: STABLE_PERSONALITY_PROFILE.playfulWhenAppropriate,
  }
}

/**
 * Scan prior assistant turns for anti-personality drift (diagnostic only).
 * @param {ChatTurn[]} turns
 * @returns {string[]}
 */
function detectPriorDrift(turns) {
  /** @type {string[]} */
  const drift = []
  const assistant = turns.filter((t) => t.role === 'assistant').slice(-4)
  for (const turn of assistant) {
    if (ROBOTIC_RE.test(turn.content)) drift.push('prior_robotic')
    if (OVERLY_FORMAL_RE.test(turn.content)) drift.push('prior_formal')
    if (LECTURER_RE.test(turn.content)) drift.push('prior_lecturer')
    if (THERAPIST_RE.test(turn.content)) drift.push('prior_therapist')
  }
  return [...new Set(drift)]
}

/**
 * @param {string} userMessage
 * @param {object} [emotionalMomentum]
 */
function playfulIsAppropriate(userMessage, emotionalMomentum) {
  const em = emotionalMomentum?.plan || emotionalMomentum || null
  if (em?.state?.playfulness >= 0.6 && (em?.state?.seriousness ?? 1) < 0.55) return true
  if (em?.instantaneous?.playfulness >= 0.65) return true
  if (PLAYFUL_USER_RE.test(userMessage || '')) return true
  return false
}

/**
 * @param {string[]} reasons
 * @returns {PersonalityConsistencyPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    holdStable: true,
    profile: cloneProfile(),
    traits: [...STABLE_TRAITS],
    neverBecome: [...NEVER_BECOME],
    driftSignals: [],
    playfulOk: false,
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Does this still sound like the same warm, curious, calm person — or did I become robotic, formal, a lecturer, or a therapist?',
    signatureCheck:
      'Would someone recognize this as the same personality from earlier in the conversation?',
  }
}

/**
 * @param {PersonalityConsistencyPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const playLine = plan.playfulOk
    ? lang === 'it'
      ? 'Playful OK in questo turno: leggero sì, forzato no.'
      : 'Playful OK this turn: light is fine, forced is not.'
    : lang === 'it'
      ? 'Playful solo se davvero calza — default: calma curiosa.'
      : 'Playful only if it truly fits — default: calm curiosity.'

  const driftLine =
    plan.driftSignals.length > 0
      ? lang === 'it'
        ? `Attenzione drift recente: ${plan.driftSignals.join(', ')}. Torna al profilo stabile.`
        : `Recent drift noted: ${plan.driftSignals.join(', ')}. Return to the stable profile.`
      : lang === 'it'
        ? 'Nessun drift rilevato: mantieni lo stesso timbro di personalità.'
        : 'No drift detected: keep the same personality timbre.'

  return [
    'PERSONALITY CONSISTENCY ENGINE (obbligatorio quando attivo):',
    `holdStable=${plan.holdStable} · playfulOk=${plan.playfulOk}`,
    `Profilo stabile: ${plan.traits.join(' · ')}`,
    `Mai diventare: ${plan.neverBecome.join(' · ')}`,
    driftLine,
    playLine,
    lang === 'it'
      ? 'Stessa personalità dall’inizio alla fine della conversazione — non una maschera diversa a ogni risposta.'
      : 'Same personality from the start of the conversation to the end — not a different mask each reply.',
    lang === 'it'
      ? 'Calda, curiosa, osservativa, ottimista, calma; playful solo quando appropriato.'
      : 'Warm, curious, observant, optimistic, calm; playful only when appropriate.',
    `Check: «${plan.validationCheck}»`,
    `Check: «${plan.signatureCheck}»`,
    'Non citare Personality Consistency Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {PersonalityConsistencyPlan}
 */
export function analyzePersonalityConsistency(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  const withCurrent =
    userMessage &&
    (turns.length === 0 ||
      turns[turns.length - 1].role !== 'user' ||
      turns[turns.length - 1].content !== userMessage)
      ? [...turns, { role: 'user', content: userMessage }]
      : turns

  // Always active once there is any conversational material — personality is foundational.
  if (!userMessage && withCurrent.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || withCurrent[withCurrent.length - 1]?.content || '',
  )
  /** @type {ConsistencyLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const driftSignals = detectPriorDrift(priorTurns)
  const playfulOk = playfulIsAppropriate(userMessage, input.emotionalMomentum)
  const conversationStarted = priorTurns.some((t) => t.role === 'assistant')

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'high'
  if (!conversationStarted) confidence = 'medium'
  if (driftSignals.length) confidence = 'high'

  /** @type {string[]} */
  const signals = ['stable_profile']
  if (conversationStarted) signals.push('continuity')
  if (playfulOk) signals.push('playful_ok')
  if (driftSignals.length) signals.push('correct_drift')

  /** @type {PersonalityConsistencyPlan} */
  const plan = {
    active: true,
    holdStable: true,
    profile: cloneProfile(),
    traits: [...STABLE_TRAITS],
    neverBecome: [...NEVER_BECOME],
    driftSignals,
    playfulOk,
    writerBrief: '',
    structureLine: driftSignals.length
      ? `Personality Consistency → restore stable profile (drift: ${driftSignals.join(',')})`
      : 'Personality Consistency → hold stable (warm · curious · observant · optimistic · calm · playful-when-fit)',
    signals,
    reasons: [
      'hold_stable_personality',
      conversationStarted ? 'same_voice_across_turns' : 'seed_stable_voice',
      playfulOk ? 'playful_appropriate' : 'playful_hold',
      ...driftSignals.slice(0, 3),
    ],
    confidence,
    language,
    validationCheck:
      'Does this still sound like the same warm, curious, calm person — or did I become robotic, formal, a lecturer, or a therapist?',
    signatureCheck:
      'Would someone recognize this as the same personality from earlier in the conversation?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {PersonalityConsistencyPlan | null | undefined} plan
 */
export function formatPersonalityConsistencyForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const p = plan.profile
  return `══════════════════════════════════════
PERSONALITY CONSISTENCY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · holdStable=${plan.holdStable} · playfulOk=${plan.playfulOk} · confidence=${plan.confidence}
Traits: Warm=${p.warm.toFixed(2)} · Curious=${p.curious.toFixed(2)} · Observant=${p.observant.toFixed(2)} · Optimistic=${p.optimistic.toFixed(2)} · Calm=${p.calm.toFixed(2)} · PlayfulWhenFit=${p.playfulWhenAppropriate.toFixed(2)}
Never: ${plan.neverBecome.join(' · ')}

${plan.writerBrief}

Regole: stessa personalità per tutta la conversazione · non diventare robotic/formal/lecturer/therapist · non citare il motore.`.trim()
}

/**
 * @param {PersonalityConsistencyPlan | null | undefined} plan
 * @returns {string[]}
 */
export function personalityConsistencyStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Same personality across the whole conversation')
  hints.push(
    plan.playfulOk
      ? 'Playful ok this turn — still warm, calm, never forced'
      : 'Default: warm · curious · observant · optimistic · calm',
  )
  hints.push(`Never: ${plan.neverBecome.join(' · ')}`)
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that break the stable personality.
 * @param {string} draft
 * @param {PersonalityConsistencyPlan | null | undefined} plan
 */
export function draftViolatesPersonalityConsistency(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (ROBOTIC_RE.test(text)) return true
  if (OVERLY_FORMAL_RE.test(text)) return true
  if (LECTURER_RE.test(text)) return true
  if (THERAPIST_RE.test(text)) return true

  // Cold support opening while profile demands warmth
  if (
    /^(come\s+posso\s+aiutarti|how\s+can\s+i\s+help|dimmi\s+pure\s+come|what\s+can\s+i\s+(do|help)\s+for\s+you)/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: PersonalityConsistencyPlan, context: string }}
 */
export function runPersonalityConsistencyEngine(input = {}) {
  try {
    const plan = analyzePersonalityConsistency(input)
    return {
      plan,
      context: formatPersonalityConsistencyForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
