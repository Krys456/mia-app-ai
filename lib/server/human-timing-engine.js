/**
 * LAIfe Human Timing Engine
 *
 * Mission: humans don't always answer immediately with the most complete response.
 * Sometimes they:
 *   - react
 *   - then think
 *   - then continue
 *
 * Example beats:
 *   "Hm..."
 *   "Actually..."
 *   "Now that I think about it..."
 *
 * Vary conversational timing naturally — not every turn, never as performance.
 *
 * Distinct from:
 *   - Human Imperfection (micro-texture: fillers / pauses / quirks)
 *   - Natural Dialogue (reaction-first social move)
 *   - Emotional Momentum (energy / pace climate)
 *
 * Runs AFTER: Genuine Curiosity (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} TimingLang
 */

/**
 * Timing shapes — how thought arrives in the reply.
 * @typedef {'immediate'|'react_then_continue'|'revise_midstream'|'delayed_insight'|'think_aloud'} TimingShape
 */

/**
 * @typedef {object} HumanTimingPlan
 * @property {boolean} active
 * @property {boolean} varyTiming
 * @property {TimingShape} shape
 * @property {string} opener suggested timing beat (empty when immediate)
 * @property {string[]} exampleBeats
 * @property {number} timingScore 0–1 how strongly to vary
 * @property {number} recentDensity 0–1 how often recent replies used timing beats
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {TimingLang} language
 * @property {string} validationCheck
 */

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const SHORT_ACK_RE =
  /^(ok+|okay|k|yes|yep|yeah|si+|sì|no|nope|nice|cool|thanks|thank\s+you|grazie|capito|got\s+it|sure|fine|bene)[\s!.]*$/i

/** Detect prior human-timing beats in assistant text. */
const PRIOR_TIMING_RE =
  /(?:^|\n)\s*(?:hm+|hmm+|mmh+|uhm+)\.{0,3}\s*$|(?:^|\n)\s*(?:actually|aspetta|wait)[,….]|(?:^|\n)\s*(?:now\s+that\s+i\s+think\s+about\s+it|a\s+pensarci\s+bene|thinking\s+about\s+it)[,….]|(?:^|\n)\s*(?:let\s+me\s+think|fammi\s+pensare)\b/im

const OVERUSE_TIMING_RE =
  /\b(hm+|hmm+|actually|now\s+that\s+i\s+think|a\s+pensarci\s+bene|let\s+me\s+think|fammi\s+pensare|aspetta)\b/gi

const INSTANT_ESSAY_RE =
  /^(here\s+are\s+(the\s+)?\d+|in\s+this\s+(article|guide|overview)|the\s+following\s+(points|sections)|ecco\s+(una\s+)?(lista|panoramica)\s+completa)\b/i

const BEATS_EN = Object.freeze({
  react_then_continue: Object.freeze(['Hm...', 'Hmm.', 'Oh—']),
  revise_midstream: Object.freeze(['Actually...', 'Wait—', 'Or rather...']),
  delayed_insight: Object.freeze([
    'Now that I think about it...',
    'Thinking about it...',
    'Sitting with that for a second...',
  ]),
  think_aloud: Object.freeze(['Let me think...', 'Okay, so...', 'One beat—']),
})

const BEATS_IT = Object.freeze({
  react_then_continue: Object.freeze(['Hm...', 'Mmh.', 'Oh—']),
  revise_midstream: Object.freeze(['Aspetta...', 'Anzi...', 'O meglio...']),
  delayed_insight: Object.freeze([
    'A pensarci bene...',
    'Ora che ci penso...',
    'Ci rifletto un attimo...',
  ]),
  think_aloud: Object.freeze(['Fammi pensare...', 'Ok, quindi...', 'Un attimo—']),
})

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
 * Stable 0–1 hash (no Math.random — reproducible across retries).
 * @param {string} seed
 */
function hash01(seed) {
  let h = 2166136261
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/**
 * @param {ChatTurn[]} turns
 */
function recentTimingDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-3)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    if (PRIOR_TIMING_RE.test(t.content)) hits += 1
    const marks = (t.content.match(OVERUSE_TIMING_RE) || []).length
    if (marks >= 2) hits += 1
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * @param {TimingLang} language
 * @param {TimingShape} shape
 */
function beatsFor(language, shape) {
  if (shape === 'immediate') return []
  const table = language === 'it' ? BEATS_IT : BEATS_EN
  return [...(table[shape] || [])]
}

/**
 * @param {string[]} beats
 * @param {string} seed
 */
function pickBeat(beats, seed) {
  if (!beats.length) return ''
  const i = Math.floor(hash01(`beat|${seed}`) * beats.length) % beats.length
  return beats[i]
}

/**
 * @param {string[]} reasons
 * @returns {HumanTimingPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    varyTiming: false,
    shape: 'immediate',
    opener: '',
    exampleBeats: [],
    timingScore: 0,
    recentDensity: 0,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I varying conversational timing naturally — or dumping a complete essay every time?',
  }
}

/**
 * Choose whether / how to vary timing this turn.
 * @param {object} opts
 * @param {string} opts.userMessage
 * @param {ChatTurn[]} opts.turns
 * @param {number} opts.density
 * @param {TimingLang} opts.language
 * @param {object|null|undefined} opts.humanImperfection
 * @param {object|null|undefined} opts.naturalDialogue
 * @param {object|null|undefined} opts.emotionalMomentum
 * @returns {{ varyTiming: boolean, shape: TimingShape, opener: string, exampleBeats: string[], timingScore: number, signals: string[], reasons: string[], confidence: 'high'|'medium'|'low' }}
 */
function chooseTiming(opts) {
  const {
    userMessage,
    turns,
    density,
    language,
    humanImperfection,
    naturalDialogue,
    emotionalMomentum,
  } = opts

  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS_RE.test(userMessage)) {
    return {
      varyTiming: false,
      shape: 'immediate',
      opener: '',
      exampleBeats: [],
      timingScore: 0,
      signals: ['distress'],
      reasons: ['suppress_distress'],
      confidence: 'high',
    }
  }
  if (HARD_TASK_RE.test(userMessage)) {
    return {
      varyTiming: false,
      shape: 'immediate',
      opener: '',
      exampleBeats: [],
      timingScore: 0,
      signals: ['hard_task'],
      reasons: ['suppress_task_clarity'],
      confidence: 'high',
    }
  }
  if (SHORT_ACK_RE.test(userMessage.trim())) {
    return {
      varyTiming: false,
      shape: 'immediate',
      opener: '',
      exampleBeats: [],
      timingScore: 0,
      signals: ['short_ack'],
      reasons: ['suppress_short_ack'],
      confidence: 'medium',
    }
  }

  // Avoid stacking with heavy imperfection texture or reaction-only turns
  const hiPlan = humanImperfection?.plan || humanImperfection || null
  if (hiPlan?.allowTouch && hiPlan.touch && hiPlan.touch !== 'none') {
    signals.push('imperfection_active')
    if (density > 0.2 || hash01(`stack|${userMessage}`) < 0.55) {
      return {
        varyTiming: false,
        shape: 'immediate',
        opener: '',
        exampleBeats: [],
        timingScore: 0.15,
        signals,
        reasons: ['avoid_stack_with_imperfection'],
        confidence: 'medium',
      }
    }
  }
  const ndPlan = naturalDialogue?.plan || naturalDialogue || null
  if (ndPlan?.reactionOnly) {
    return {
      varyTiming: false,
      shape: 'immediate',
      opener: '',
      exampleBeats: [],
      timingScore: 0,
      signals: ['reaction_only'],
      reasons: ['defer_to_natural_dialogue'],
      confidence: 'high',
    }
  }

  if (density >= 0.66) {
    return {
      varyTiming: false,
      shape: 'immediate',
      opener: '',
      exampleBeats: [],
      timingScore: 0.1,
      signals: ['recent_dense'],
      reasons: ['cooldown_after_recent_timing'],
      confidence: 'high',
    }
  }

  const seed = `${userMessage}|${turns.length}|${density.toFixed(2)}`
  let chance = 0.28
  if (density > 0.33) chance -= 0.12
  if (userMessage.length > 180) chance += 0.08 // room to think mid-reply
  if (userMessage.length < 40) chance -= 0.06
  const emo = emotionalMomentum?.plan?.state || emotionalMomentum?.state || null
  if (emo?.conversationalPace === 'slow') {
    chance += 0.1
    signals.push('slow_pace')
  }
  if (emo?.seriousness != null && emo.seriousness > 0.65) {
    chance += 0.06
    signals.push('serious')
  }
  if (/[?]/.test(userMessage) && userMessage.length > 60) {
    chance += 0.05
    signals.push('reflective_q')
  }
  chance = Math.max(0.08, Math.min(0.48, chance))

  const roll = hash01(`vary|${seed}`)
  if (roll > chance) {
    return {
      varyTiming: false,
      shape: 'immediate',
      opener: '',
      exampleBeats: [],
      timingScore: chance,
      signals: [...signals, 'roll_immediate'],
      reasons: ['most_turns_immediate'],
      confidence: 'medium',
    }
  }

  /** @type {TimingShape[]} */
  const shapes = ['react_then_continue', 'revise_midstream', 'delayed_insight', 'think_aloud']
  // Bias: react_then_continue is the core mission example
  const shapeRoll = hash01(`shape|${seed}`)
  /** @type {TimingShape} */
  let shape = 'react_then_continue'
  if (shapeRoll < 0.38) shape = 'react_then_continue'
  else if (shapeRoll < 0.58) shape = 'revise_midstream'
  else if (shapeRoll < 0.8) shape = 'delayed_insight'
  else shape = 'think_aloud'

  // Prefer delayed_insight / revise when message invites reconsideration
  if (
    /\b(actually|wait|on\s+second\s+thought|anzi|aspetta|maybe|forse|i\s+mean)\b/i.test(
      userMessage,
    )
  ) {
    shape = hash01(`rev|${seed}`) < 0.5 ? 'revise_midstream' : 'delayed_insight'
    signals.push('user_reconsider')
  }

  const exampleBeats = beatsFor(language, shape)
  const opener = pickBeat(exampleBeats, seed)
  reasons.push('vary_timing', `shape_${shape}`)
  signals.push(`shape_${shape}`)

  return {
    varyTiming: true,
    shape,
    opener,
    exampleBeats,
    timingScore: 0.55 + hash01(`score|${seed}`) * 0.35,
    signals,
    reasons,
    confidence: density < 0.2 ? 'high' : 'medium',
  }
}

/**
 * @param {HumanTimingPlan} plan
 */
function buildGuidance(plan) {
  const lang = plan.language
  if (!plan.varyTiming || plan.shape === 'immediate') {
    return lang === 'it'
      ? 'Timing immediato: una risposta chiara e completa va bene. Non forzare “Hm…” / “Anzi…”.'
      : 'Immediate timing: a clear complete reply is fine. Do not force “Hm…” / “Actually…”.'
  }
  if (plan.shape === 'react_then_continue') {
    return lang === 'it'
      ? `Reagisci prima (es. «${plan.opener || 'Hm...'}»), poi pensa, poi continua — non scaricare subito l’essay completo.`
      : `React first (e.g. “${plan.opener || 'Hm...'}”), then think, then continue — don’t dump the complete essay immediately.`
  }
  if (plan.shape === 'revise_midstream') {
    return lang === 'it'
      ? `Parti, poi rivedi a metà (es. «${plan.opener || 'Anzi...'}») come fa una persona che raffina il pensiero.`
      : `Start, then revise midstream (e.g. “${plan.opener || 'Actually...'}”) like someone refining a thought.`
  }
  if (plan.shape === 'delayed_insight') {
    return lang === 'it'
      ? `Lascia arrivare l’insight dopo un beat (es. «${plan.opener || 'A pensarci bene...'}»).`
      : `Let the insight arrive after a beat (e.g. “${plan.opener || 'Now that I think about it...'}”).`
  }
  return lang === 'it'
    ? `Pensa ad alta voce un attimo (es. «${plan.opener || 'Fammi pensare...'}»), poi continua — timing umano, non teatro.`
    : `Think aloud for a beat (e.g. “${plan.opener || 'Let me think...'}”), then continue — human timing, not theater.`
}

/**
 * @param {HumanTimingPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const beatLine =
    plan.exampleBeats.length > 0
      ? `exampleBeats=${plan.exampleBeats.slice(0, 3).join(' · ')}`
      : null
  return [
    'HUMAN TIMING ENGINE (obbligatorio quando attivo):',
    `vary=${plan.varyTiming} · shape=${plan.shape} · timing=${plan.timingScore.toFixed(2)} · recentDensity=${plan.recentDensity.toFixed(2)}`,
    plan.opener ? `suggestedBeat=${plan.opener}` : null,
    beatLine,
    plan.guidance,
    lang === 'it'
      ? 'Gli umani non rispondono sempre subito con la risposta più completa. A volte: reagiscono → pensano → continuano. Varia il timing in modo naturale.'
      : 'Humans don’t always answer immediately with the most complete response. Sometimes they: react → think → continue. Vary conversational timing naturally.',
    lang === 'it'
      ? 'Mai a ogni messaggio. Mai accumulare più beat timing. Distinto da Human Imperfection (texture) e Natural Dialogue (reazione sociale).'
      : 'Not every message. Never stack multiple timing beats. Distinct from Human Imperfection (texture) and Natural Dialogue (social reaction).',
    `Check: «${plan.validationCheck}»`,
    'Non citare Human Timing Engine / questo blocco.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {object} [input]
 * @returns {HumanTimingPlan}
 */
export function analyzeHumanTiming(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  const withCurrent =
    userMessage &&
    (turns.length === 0 ||
      turns[turns.length - 1].role !== 'user' ||
      turns[turns.length - 1].content !== userMessage)
      ? [...turns, { role: 'user', content: userMessage }]
      : turns

  if (!userMessage && withCurrent.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || withCurrent[withCurrent.length - 1]?.content || '',
  )
  /** @type {TimingLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const density = recentTimingDensity(withCurrent)
  const choice = chooseTiming({
    userMessage,
    turns: withCurrent,
    density,
    language,
    humanImperfection: input.humanImperfection,
    naturalDialogue: input.naturalDialogue,
    emotionalMomentum: input.emotionalMomentum,
  })

  /** @type {HumanTimingPlan} */
  const plan = {
    active: true,
    varyTiming: choice.varyTiming,
    shape: choice.shape,
    opener: choice.opener,
    exampleBeats: choice.exampleBeats,
    timingScore: choice.timingScore,
    recentDensity: density,
    guidance: '',
    writerBrief: '',
    structureLine: choice.varyTiming
      ? `Human Timing → ${choice.shape}${choice.opener ? ` («${choice.opener}»)` : ''}`
      : 'Human Timing → immediate (complete is fine)',
    signals: choice.signals,
    reasons: choice.reasons,
    confidence: choice.confidence,
    language,
    validationCheck:
      'Am I varying conversational timing naturally — or dumping a complete essay every time?',
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {HumanTimingPlan | null | undefined} plan
 */
export function formatHumanTimingForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
HUMAN TIMING ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · vary=${plan.varyTiming} · shape=${plan.shape} · timing=${plan.timingScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: react→think→continue a volte · non sempre · un solo beat · non citare il motore.`.trim()
}

/**
 * @param {HumanTimingPlan | null | undefined} plan
 * @returns {string[]}
 */
export function humanTimingStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.varyTiming) {
    hints.push('Vary timing: react → think → continue (not an instant complete dump)')
    if (plan.opener) hints.push(`Optional timing beat near: «${plan.opener}»`)
  } else {
    hints.push('Immediate complete reply is fine this turn')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect instant-essay dumps when timing should vary, or overused timing theater.
 * @param {string} draft
 * @param {HumanTimingPlan | null | undefined} plan
 */
export function draftViolatesHumanTiming(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const marks = (text.match(OVERUSE_TIMING_RE) || []).length
  // Theater / stacking always bad
  if (marks >= 3) return true
  if (
    /^(hm+\.{0,3}\s+){2,}|(actually[,…]?\s+){2,}|(now\s+that\s+i\s+think[^.]*\.\s*){2,}/i.test(
      text,
    )
  ) {
    return true
  }
  if (/as a human (would|might) (pause|think|time)|let me sound more human|simulo il timing/i.test(text)) {
    return true
  }

  // When vary was requested, reject cold instant essay openers with no timing breath
  if (plan.varyTiming && plan.shape !== 'immediate') {
    if (INSTANT_ESSAY_RE.test(text)) return true
    // Long complete dump with zero timing markers and no mid-reply breath
    if (
      text.length > 420 &&
      marks === 0 &&
      !/[—–…]|\.\.\./.test(text) &&
      !/\b(actually|wait|hm+|thinking|pensarci|anzi|aspetta)\b/i.test(text)
    ) {
      return true
    }
  }

  // When engine said immediate / no vary, reject sprayed timing theater
  if (!plan.varyTiming || plan.shape === 'immediate') {
    if (marks >= 2) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: HumanTimingPlan, context: string }}
 */
export function runHumanTimingEngine(input = {}) {
  try {
    const plan = analyzeHumanTiming(input)
    return {
      plan,
      context: formatHumanTimingForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
