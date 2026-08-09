/**
 * LAIfe Emotional Momentum Engine
 *
 * Track the emotional *trajectory* of the conversation — not only the last message.
 *
 * Maintains (0–1 unless noted):
 *   - energyLevel
 *   - emotionalTone   (label + continuity)
 *   - curiosityLevel
 *   - playfulness
 *   - seriousness
 *   - intimacy
 *   - conversationalPace  ('slow'|'natural'|'brisk')
 *
 * Do NOT reset emotional state every reply.
 * Preserve momentum until the user clearly changes it.
 *
 * Examples:
 *   "Hahaha"            → stay playful / laugh naturally
 *   "Seriously though…" → shift toward thoughtful / serious
 *
 * Runs AFTER: Narrative Conversation (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'warm'|'playful'|'thoughtful'|'serious'|'excited'|'calm'|'intimate'|'neutral'|'tender'|'curious'} EmotionalToneLabel
 */

/**
 * @typedef {'slow'|'natural'|'brisk'} ConversationalPace
 */

/**
 * @typedef {'en'|'it'} MomentumLang
 */

/**
 * @typedef {object} EmotionalSnapshot
 * @property {number} energyLevel 0–1
 * @property {EmotionalToneLabel} emotionalTone
 * @property {number} curiosityLevel 0–1
 * @property {number} playfulness 0–1
 * @property {number} seriousness 0–1
 * @property {number} intimacy 0–1
 * @property {ConversationalPace} conversationalPace
 */

/**
 * @typedef {object} EmotionalMomentumPlan
 * @property {boolean} active
 * @property {boolean} preserveMomentum
 * @property {boolean} userShifted
 * @property {EmotionalSnapshot} state
 * @property {EmotionalSnapshot} priorState
 * @property {EmotionalSnapshot} instantaneous
 * @property {string} shiftSignal
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {MomentumLang} language
 * @property {string} validationCheck
 */

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
      content: String(/** @type {{ content?: string }} */ (m).content || '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @returns {EmotionalSnapshot}
 */
function neutralSnapshot() {
  return {
    energyLevel: 0.45,
    emotionalTone: 'neutral',
    curiosityLevel: 0.45,
    playfulness: 0.25,
    seriousness: 0.35,
    intimacy: 0.25,
    conversationalPace: 'natural',
  }
}

/**
 * Clamp 0–1.
 * @param {number} n
 */
function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/**
 * Exponential blend: keep prior momentum, admit new signal gradually.
 * @param {number} prior
 * @param {number} next
 * @param {number} alpha  how much of `next` to take (0–1)
 */
function blend(prior, next, alpha) {
  return clamp01(prior * (1 - alpha) + next * alpha)
}

/**
 * Score a single utterance into an emotional snapshot.
 * @param {string} text
 * @param {'user'|'assistant'|string} role
 * @returns {EmotionalSnapshot & { signals: string[], shiftHints: string[] }}
 */
export function scoreUtteranceEmotion(text, role = 'user') {
  const t = String(text || '').trim()
  const signals = /** @type {string[]} */ ([])
  const shiftHints = /** @type {string[]} */ ([])

  let energy = 0.45
  let curiosity = 0.4
  let playfulness = 0.22
  let seriousness = 0.35
  let intimacy = 0.22
  /** @type {EmotionalToneLabel} */
  let tone = 'neutral'
  /** @type {ConversationalPace} */
  let pace = 'natural'

  if (!t) {
    return {
      energyLevel: energy,
      emotionalTone: tone,
      curiosityLevel: curiosity,
      playfulness,
      seriousness,
      intimacy,
      conversationalPace: pace,
      signals,
      shiftHints,
    }
  }

  const words = t.split(/\s+/).filter(Boolean).length
  const hasLaugh =
    /\b(ahah|haha|hehe|lol|lmao|😂|😄|🤣|hahaha+|ahahah+)\b/i.test(t) ||
    /([aA][hH]){2,}|\bha(ha)+\b/i.test(t)
  const playfulCue =
    hasLaugh ||
    /\b(scherz|joke|kidding|😜|😉|heh|eheh|lol)\b/i.test(t) ||
    /\b(divertent|funny|hilarious|comico)\b/i.test(t)
  const seriousShift =
    /\b(seriously\s+though|but\s+seriously|no\s+but\s+really|scherzi\s+a\s+parte|a\s+parte\s+gli\s+scherzi|per[oò]\s+sul\s+serio|comunque\s+seriamente|tornando\s+seri|jokes\s+aside|all\s+joking\s+aside)\b/i.test(
      t,
    ) || /^(seriously|sul\s+serio|davvero\s+per[oò])\b/i.test(t)
  const curiousCue =
    /\b(interessante|interesting|curios[oa]|curious|wonder|mi\s+chiedo|fascinating|affascinante|e\s+poi|tell\s+me\s+more|dimmi\s+di\s+pi[uù]|how\s+come|perch[eé])\b/i.test(
      t,
    ) || /\?$/.test(t)
  const intimateCue =
    /\b(ti\s+confesso|tra\s+noi|between\s+us|honestly|a\s+dire\s+il\s+vero|mi\s+sento|i\s+feel|lonely|solo|vulnerabil|personal(e|ly)?)\b/i.test(
      t,
    )
  const warmCue =
    /\b(grazie|thanks|thank\s+you|sweet|carin[oa]|adoro|love\s+that|mi\s+piace|❤️|🥰|😊)\b/i.test(t)
  const excitedCue =
    /\b(wow|omg|incredibil|amazing|fantastic|assurdo|pazzesc|yess+|let'?s\s+go|🔥|✨)\b/i.test(t) ||
    /!{2,}/.test(t)
  const calmCue =
    /\b(piano|calma|slowly|take\s+your\s+time|tranquill[oa]|peace|rilass)\b/i.test(t)
  const tenderCue =
    /\b(delicat|gentle|soft|tender|premura|cura|mi\s+dispiace|i'?m\s+sorry\s+you)\b/i.test(t)
  const thoughtfulCue =
    /\b(penso|i\s+think|riflett|reflect|in\s+fondo|deep\s+down|maybe|forse|interesting\s+point)\b/i.test(
      t,
    )

  if (hasLaugh) {
    energy = Math.max(energy, 0.72)
    playfulness = Math.max(playfulness, 0.85)
    seriousness = Math.min(seriousness, 0.18)
    tone = 'playful'
    pace = 'brisk'
    signals.push('laughter')
  }
  if (playfulCue && !seriousShift) {
    playfulness = Math.max(playfulness, 0.7)
    energy = Math.max(energy, 0.6)
    tone = 'playful'
    signals.push('playful')
  }
  if (seriousShift) {
    seriousness = Math.max(seriousness, 0.78)
    playfulness = Math.min(playfulness, 0.25)
    tone = 'serious'
    pace = 'slow'
    shiftHints.push('serious_shift')
    signals.push('serious_shift')
  }
  if (curiousCue) {
    curiosity = Math.max(curiosity, 0.72)
    if (tone === 'neutral') tone = 'curious'
    signals.push('curiosity')
  }
  if (intimateCue) {
    intimacy = Math.max(intimacy, 0.7)
    seriousness = Math.max(seriousness, 0.45)
    pace = pace === 'brisk' ? 'natural' : 'slow'
    tone = tone === 'playful' ? 'tender' : 'intimate'
    signals.push('intimacy')
  }
  if (warmCue) {
    intimacy = Math.max(intimacy, 0.4)
    if (tone === 'neutral') tone = 'warm'
    signals.push('warmth')
  }
  if (excitedCue) {
    energy = Math.max(energy, 0.82)
    pace = 'brisk'
    if (!seriousShift) tone = tone === 'playful' ? 'playful' : 'excited'
    signals.push('excitement')
  }
  if (calmCue) {
    energy = Math.min(energy, 0.4)
    pace = 'slow'
    tone = 'calm'
    signals.push('calm')
  }
  if (tenderCue) {
    intimacy = Math.max(intimacy, 0.55)
    tone = 'tender'
    pace = 'slow'
    signals.push('tender')
  }
  if (thoughtfulCue && !hasLaugh) {
    seriousness = Math.max(seriousness, 0.5)
    if (tone === 'neutral' || tone === 'curious') tone = 'thoughtful'
    signals.push('thoughtful')
  }

  // Short ack / emoji-only → inherit lightly (low instantaneous force)
  if (words <= 2 && !hasLaugh && !seriousShift) {
    energy = 0.4
    curiosity = 0.35
    signals.push('short_ack')
  }

  // Assistant turns: slightly softer instantaneous pull (user leads emotional steering)
  if (role === 'assistant') {
    energy = blend(0.45, energy, 0.55)
    playfulness = blend(0.25, playfulness, 0.55)
    seriousness = blend(0.35, seriousness, 0.55)
    intimacy = blend(0.25, intimacy, 0.5)
    curiosity = blend(0.4, curiosity, 0.55)
  }

  return {
    energyLevel: clamp01(energy),
    emotionalTone: tone,
    curiosityLevel: clamp01(curiosity),
    playfulness: clamp01(playfulness),
    seriousness: clamp01(seriousness),
    intimacy: clamp01(intimacy),
    conversationalPace: pace,
    signals,
    shiftHints,
  }
}

/**
 * Build rolling emotional state from conversation history.
 * Recent turns weigh more; user turns steer harder than assistant turns.
 * @param {ChatTurn[]} turns
 * @returns {{ state: EmotionalSnapshot, trajectory: EmotionalSnapshot[], signals: string[] }}
 */
export function buildEmotionalTrajectory(turns) {
  let state = neutralSnapshot()
  /** @type {EmotionalSnapshot[]} */
  const trajectory = []
  /** @type {string[]} */
  const signals = []

  const window = turns.slice(-12)
  for (let i = 0; i < window.length; i++) {
    const turn = window[i]
    const scored = scoreUtteranceEmotion(turn.content, turn.role)
    const recency = (i + 1) / window.length
    // User steers more; assistant confirms/holds
    const baseAlpha = turn.role === 'user' ? 0.35 + recency * 0.4 : 0.18 + recency * 0.22
    const alpha = scored.shiftHints.length ? Math.min(0.92, baseAlpha + 0.35) : baseAlpha

    state = {
      energyLevel: blend(state.energyLevel, scored.energyLevel, alpha),
      emotionalTone:
        alpha >= 0.45 || scored.shiftHints.length
          ? scored.emotionalTone
          : state.emotionalTone === 'neutral'
            ? scored.emotionalTone
            : state.emotionalTone,
      curiosityLevel: blend(state.curiosityLevel, scored.curiosityLevel, alpha),
      playfulness: blend(state.playfulness, scored.playfulness, alpha),
      seriousness: blend(state.seriousness, scored.seriousness, alpha),
      intimacy: blend(state.intimacy, scored.intimacy, alpha),
      conversationalPace:
        alpha >= 0.5 ? scored.conversationalPace : state.conversationalPace,
    }
    trajectory.push({ ...state })
    signals.push(...scored.signals.slice(0, 2))
  }

  return { state, trajectory, signals: [...new Set(signals)].slice(0, 10) }
}

/**
 * @param {EmotionalSnapshot} prior
 * @param {ReturnType<typeof scoreUtteranceEmotion>} instant
 */
function applyUserSteer(prior, instant) {
  const shift = instant.shiftHints.length > 0
  const strongPlay = instant.playfulness >= 0.7 && instant.signals.includes('laughter')
  const alpha = shift ? 0.85 : strongPlay ? 0.75 : 0.4

  /** @type {EmotionalToneLabel} */
  let tone = prior.emotionalTone
  if (shift || strongPlay || instant.emotionalTone !== 'neutral') {
    tone = instant.emotionalTone
  }

  return {
    state: /** @type {EmotionalSnapshot} */ ({
      energyLevel: blend(prior.energyLevel, instant.energyLevel, alpha),
      emotionalTone: tone,
      curiosityLevel: blend(prior.curiosityLevel, instant.curiosityLevel, alpha * 0.9),
      playfulness: blend(prior.playfulness, instant.playfulness, alpha),
      seriousness: blend(prior.seriousness, instant.seriousness, alpha),
      intimacy: blend(prior.intimacy, instant.intimacy, alpha * 0.85),
      conversationalPace:
        shift || strongPlay ? instant.conversationalPace : prior.conversationalPace,
    }),
    userShifted: shift || strongPlay,
    shiftSignal: instant.shiftHints[0] || (strongPlay ? 'laughter_boost' : ''),
  }
}

/**
 * @param {string[]} reasons
 * @returns {EmotionalMomentumPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  const state = neutralSnapshot()
  return {
    active: false,
    preserveMomentum: false,
    userShifted: false,
    state,
    priorState: state,
    instantaneous: state,
    shiftSignal: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I preserving the emotional momentum of this conversation, or resetting to a default tone?',
  }
}

/**
 * @param {EmotionalMomentumPlan} plan
 */
function buildBrief(plan) {
  const s = plan.state
  const pct = (n) => `${Math.round(n * 100)}%`
  const lang = plan.language

  const hold =
    lang === 'it'
      ? 'Preserva questo clima finché l’utente non lo cambia chiaramente.'
      : 'Preserve this climate until the user clearly changes it.'

  const shiftLine = plan.userShifted
    ? lang === 'it'
      ? `L’utente ha spostato il clima (${plan.shiftSignal || 'shift'}). Adatta con naturalezza — niente strappi teatrali.`
      : `The user shifted the climate (${plan.shiftSignal || 'shift'}). Follow naturally — no theatrical snap.`
    : lang === 'it'
      ? 'Nessuno shift netto: NON resettare il tono a “assistente neutro”.'
      : 'No sharp shift: do NOT reset to a neutral assistant voice.'

  const guidance = []
  if (s.playfulness >= 0.6 && s.seriousness < 0.45) {
    guidance.push(
      lang === 'it'
        ? 'Playful alto: puoi ridere / restare leggero se calza — niente lezione improvvisa.'
        : 'High playfulness: laugh / stay light if it fits — no sudden lecture.',
    )
  }
  if (s.seriousness >= 0.6) {
    guidance.push(
      lang === 'it'
        ? 'Serietà alta: più thoughtful, meno battute; profondità senza freddezza.'
        : 'High seriousness: more thoughtful, fewer jokes; depth without coldness.',
    )
  }
  if (s.intimacy >= 0.55) {
    guidance.push(
      lang === 'it'
        ? 'Intimità alta: tono vicino e rispettoso — niente invadenza.'
        : 'High intimacy: close and respectful — never invasive.',
    )
  }
  if (s.curiosityLevel >= 0.6) {
    guidance.push(
      lang === 'it'
        ? 'Curiosità alta: porta avanti il filo con interesse genuino.'
        : 'High curiosity: advance the thread with genuine interest.',
    )
  }
  if (s.conversationalPace === 'brisk') {
    guidance.push(
      lang === 'it' ? 'Ritmo sostenuto: frasi vive, non lunghi trattati.' : 'Brisk pace: lively lines, not treatises.',
    )
  } else if (s.conversationalPace === 'slow') {
    guidance.push(
      lang === 'it' ? 'Ritmo lento: spazio, calma, niente fretta.' : 'Slow pace: space, calm, no rush.',
    )
  }

  return [
    'EMOTIONAL MOMENTUM ENGINE (obbligatorio quando attivo):',
    `preserveMomentum=${plan.preserveMomentum} · userShifted=${plan.userShifted} · tone=${s.emotionalTone} · pace=${s.conversationalPace}`,
    `energy=${pct(s.energyLevel)} · curiosity=${pct(s.curiosityLevel)} · playfulness=${pct(s.playfulness)} · seriousness=${pct(s.seriousness)} · intimacy=${pct(s.intimacy)}`,
    shiftLine,
    hold,
    ...guidance,
    `Check interno: «${plan.validationCheck}» Se stai resettando il tono senza motivo → riscrivi.`,
    'Non citare Emotional Momentum Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {EmotionalMomentumPlan}
 */
export function analyzeEmotionalMomentum(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  // Include current user message if not already last in messages
  const withCurrent =
    userMessage &&
    (turns.length === 0 ||
      turns[turns.length - 1].role !== 'user' ||
      turns[turns.length - 1].content !== userMessage)
      ? [...turns, { role: 'user', content: userMessage }]
      : turns

  if (withCurrent.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(userMessage || withCurrent[withCurrent.length - 1]?.content || '')
  /** @type {MomentumLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  // Trajectory from history BEFORE current user message
  const priorTurns = withCurrent.slice(0, -1)
  const { state: priorState, signals: trajSignals } = buildEmotionalTrajectory(priorTurns)
  const instant = scoreUtteranceEmotion(userMessage, 'user')
  const steered = applyUserSteer(
    priorTurns.length ? priorState : neutralSnapshot(),
    instant,
  )

  const conversationStarted = priorTurns.some((t) => t.role === 'assistant')
  const active = conversationStarted || instant.signals.length > 0 || steered.userShifted

  if (!active) return inactivePlan(['no_signal'])

  const preserveMomentum = conversationStarted && !steered.userShifted

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (steered.userShifted || instant.signals.includes('laughter')) confidence = 'high'
  else if (priorTurns.length >= 4) confidence = 'high'
  else if (priorTurns.length < 2) confidence = 'low'

  /** @type {EmotionalMomentumPlan} */
  const plan = {
    active: true,
    preserveMomentum,
    userShifted: steered.userShifted,
    state: steered.state,
    priorState: priorTurns.length ? priorState : neutralSnapshot(),
    instantaneous: {
      energyLevel: instant.energyLevel,
      emotionalTone: instant.emotionalTone,
      curiosityLevel: instant.curiosityLevel,
      playfulness: instant.playfulness,
      seriousness: instant.seriousness,
      intimacy: instant.intimacy,
      conversationalPace: instant.conversationalPace,
    },
    shiftSignal: steered.shiftSignal,
    writerBrief: '',
    structureLine: preserveMomentum
      ? `Emotional Momentum → preserve (${steered.state.emotionalTone}, pace ${steered.state.conversationalPace})`
      : `Emotional Momentum → shift to ${steered.state.emotionalTone}${steered.shiftSignal ? ` via ${steered.shiftSignal}` : ''}`,
    signals: [...new Set([...trajSignals, ...instant.signals])].slice(0, 10),
    reasons: [
      preserveMomentum ? 'preserve_momentum' : 'follow_user_shift',
      `tone_${steered.state.emotionalTone}`,
      `pace_${steered.state.conversationalPace}`,
      `energy_${steered.state.energyLevel.toFixed(2)}`,
      steered.userShifted ? `shift_${steered.shiftSignal || 'user'}` : 'hold_climate',
      ...instant.signals.slice(0, 3),
    ],
    confidence,
    language,
    validationCheck:
      'Am I preserving the emotional momentum of this conversation, or resetting to a default tone?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {EmotionalMomentumPlan | null | undefined} plan
 */
export function formatEmotionalMomentumForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const s = plan.state
  return `══════════════════════════════════════
EMOTIONAL MOMENTUM ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · preserve=${plan.preserveMomentum} · shifted=${plan.userShifted} · confidence=${plan.confidence}
Tone=${s.emotionalTone} · Pace=${s.conversationalPace}
Energy=${s.energyLevel.toFixed(2)} · Curiosity=${s.curiosityLevel.toFixed(2)} · Playfulness=${s.playfulness.toFixed(2)} · Seriousness=${s.seriousness.toFixed(2)} · Intimacy=${s.intimacy.toFixed(2)}

${plan.writerBrief}

Regole: non resettare il clima a ogni risposta · segui gli shift dell’utente (“Hahaha”→playful, “Seriously though…”→thoughtful) · non citare il motore.`.trim()
}

/**
 * @param {EmotionalMomentumPlan | null | undefined} plan
 * @returns {string[]}
 */
export function emotionalMomentumStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(
    plan.preserveMomentum
      ? 'Preserve emotional momentum from prior turns'
      : `Follow user emotional shift → ${plan.state.emotionalTone}`,
  )
  hints.push(
    `Climate: energy ${plan.state.energyLevel.toFixed(2)} · play ${plan.state.playfulness.toFixed(2)} · serious ${plan.state.seriousness.toFixed(2)} · intimacy ${plan.state.intimacy.toFixed(2)} · pace ${plan.state.conversationalPace}`,
  )
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that ignore momentum (flat reset / mismatched climate).
 * @param {string} draft
 * @param {EmotionalMomentumPlan | null | undefined} plan
 */
export function draftViolatesEmotionalMomentum(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Hard reset to support-speak while playful momentum is high
  if (
    plan.state.playfulness >= 0.65 &&
    /^(come\s+posso\s+aiutarti|how\s+can\s+i\s+help|dimmi\s+pure|tell\s+me\s+how\s+i\s+can\s+help)/i.test(
      text,
    )
  ) {
    return true
  }

  // Laughing user → cold lecture opening
  if (
    plan.instantaneous.playfulness >= 0.7 &&
    plan.signals.includes('laughter') &&
    /^(artificial\s+intelligence|l['’]?intelligenza\s+artificiale|in\s+conclusion|in\s+sintesi|it\s+is\s+important\s+to\s+note)/i.test(
      text,
    )
  ) {
    return true
  }

  // Serious shift → still joking hard in the opening
  if (
    plan.userShifted &&
    plan.shiftSignal === 'serious_shift' &&
    /^(ahah|haha|😂|lol\b)/i.test(text)
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: EmotionalMomentumPlan, context: string }}
 */
export function runEmotionalMomentumEngine(input = {}) {
  try {
    const plan = analyzeEmotionalMomentum(input)
    return {
      plan,
      context: formatEmotionalMomentumForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
