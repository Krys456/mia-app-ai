/**
 * LAIfe Human Imperfection Engine
 *
 * Occasionally vary rhythm. Occasionally use:
 *   - short pauses
 *   - conversational fillers
 *   - spontaneous reactions
 *
 * Never overuse them.
 * Goal: naturality — not imitation / caricature of “being human.”
 *
 * Runs AFTER: Personality Consistency (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} ImperfectionLang
 */

/**
 * @typedef {'none'|'vary_rhythm'|'short_pause'|'filler'|'spontaneous_reaction'} ImperfectionTouch
 */

/**
 * @typedef {object} HumanImperfectionPlan
 * @property {boolean} active
 * @property {boolean} allowTouch
 * @property {ImperfectionTouch} touch
 * @property {number} intensity 0–1 (always light)
 * @property {number} recentDensity 0–1 how saturated recent replies were
 * @property {string} hint concrete micro-suggestion for the Writer
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ImperfectionLang} language
 * @property {string} validationCheck
 * @property {string} antiCaricature
 */

const DISTRESS_RE =
  /\b(suicid|kill myself|self[- ]?harm|voglio morire|non ce la faccio più|abuse|violenza|panic attack|attacco di panico)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code sample|debug|error stack|sql|api key|json schema|unit test|compila|compile|fixattato|bullet list|elenco numerato)\b/i

/** Detect prior imperfective texture in assistant text. */
const PRIOR_IMPERFECTION_RE =
  /(?:^|\n)\s*(?:hmm+|mmh+|uhm+|eh+|beh+|wait\.|wait—|oh\.|oh—|ah\.|ah—|wow\.|wow—)|(?:\.\.\.|…)|(?:^|\s)(hmm+|mmh+|uhm+|eh+|beh+)[,…]|(?:^|\n)\s*[—–-]\s*$/im

const OVERUSE_FILLER_RE =
  /\b(hmm+|mmh+|uhm+|eh+|beh+|like,? uh|you know)\b/gi

const OVERUSE_ELLIPSIS_RE = /(\.\.\.|…)/g

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
function recentImperfectionDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-3)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    if (PRIOR_IMPERFECTION_RE.test(t.content)) hits += 1
    const fillers = (t.content.match(OVERUSE_FILLER_RE) || []).length
    if (fillers >= 2) hits += 1
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * Pick at most one light touch — or none.
 * @param {object} opts
 * @param {string} opts.userMessage
 * @param {ChatTurn[]} opts.turns
 * @param {number} opts.density
 * @param {object|null} opts.emotionalMomentum
 * @param {object|null} opts.personalityConsistency
 * @returns {{ allowTouch: boolean, touch: ImperfectionTouch, intensity: number, hint: string, signals: string[], reasons: string[] }}
 */
function chooseTouch(opts) {
  const { userMessage, turns, density, emotionalMomentum, personalityConsistency } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS_RE.test(userMessage)) {
    return {
      allowTouch: false,
      touch: 'none',
      intensity: 0,
      hint: '',
      signals: ['suppress_distress'],
      reasons: ['no_imperfection_in_distress'],
    }
  }
  if (HARD_TASK_RE.test(userMessage)) {
    return {
      allowTouch: false,
      touch: 'none',
      intensity: 0,
      hint: '',
      signals: ['suppress_hard_task'],
      reasons: ['clarity_over_texture'],
    }
  }

  // Already textured recently → stay clean
  if (density >= 0.55) {
    return {
      allowTouch: false,
      touch: 'none',
      intensity: 0,
      hint: '',
      signals: ['suppress_recent_density'],
      reasons: ['never_overuse', 'recent_imperfections_present'],
    }
  }

  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seed = `${assistantCount}|${userMessage.slice(0, 80)}`
  const roll = hash01(seed)

  // Occasional only: ~28% base, lower if any recent texture, slightly higher if playful climate
  const em = emotionalMomentum?.plan || emotionalMomentum || null
  const playfulBoost =
    em?.state?.playfulness >= 0.65 && (em?.state?.seriousness ?? 1) < 0.45 ? 0.08 : 0
  const seriousCut = em?.state?.seriousness >= 0.65 ? 0.12 : 0
  const densityCut = density * 0.25
  const threshold = Math.max(0.12, Math.min(0.38, 0.28 + playfulBoost - seriousCut - densityCut))

  if (roll > threshold) {
    return {
      allowTouch: false,
      touch: 'none',
      intensity: 0,
      hint: '',
      signals: ['skip_this_turn'],
      reasons: ['occasional_only', `roll_${roll.toFixed(2)}_gt_${threshold.toFixed(2)}`],
    }
  }

  // Choose which single touch (weighted, still light)
  const pick = hash01(`touch|${seed}`)
  /** @type {ImperfectionTouch} */
  let touch = 'vary_rhythm'
  if (pick < 0.28) touch = 'short_pause'
  else if (pick < 0.52) touch = 'filler'
  else if (pick < 0.76) touch = 'spontaneous_reaction'
  else touch = 'vary_rhythm'

  // Personality Consistency: if playful not ok, avoid filler-heavy play
  const pc = personalityConsistency?.plan || personalityConsistency || null
  if (pc && pc.playfulOk === false && touch === 'filler' && pick > 0.4) {
    touch = 'vary_rhythm'
    signals.push('filler_downgraded_for_calm')
  }

  const intensity = 0.25 + hash01(`int|${seed}`) * 0.2 // 0.25–0.45 — always light

  /** @type {Record<ImperfectionTouch, string>} */
  const hints = {
    none: '',
    vary_rhythm:
      'Vary sentence length once — one short beat next to a longer thought. Do not chop the whole reply.',
    short_pause:
      'One short pause mark is enough (ellipsis … or a line-break breath). Never stack pauses.',
    filler:
      'At most ONE soft opener if it fits (e.g. “Hmm,” / “Mmh,” / “Wait—”). Never decorate every sentence.',
    spontaneous_reaction:
      'One spontaneous micro-reaction is enough (“Oh.” / “Wait—” / “That lands.”) then continue. Not a performance.',
  }

  signals.push(`touch_${touch}`)
  reasons.push('light_natural_texture', `touch_${touch}`, 'never_overuse')

  return {
    allowTouch: true,
    touch,
    intensity,
    hint: hints[touch],
    signals,
    reasons,
  }
}

/**
 * @param {string[]} reasons
 * @returns {HumanImperfectionPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowTouch: false,
    touch: 'none',
    intensity: 0,
    recentDensity: 0,
    hint: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Does this feel naturally alive — or like I am imitating a human with forced quirks?',
    antiCaricature:
      'Naturality, not imitation. Never spray fillers, pauses, or reactions.',
  }
}

/**
 * @param {HumanImperfectionPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  if (!plan.allowTouch || plan.touch === 'none') {
    return [
      'HUMAN IMPERFECTION ENGINE (obbligatorio quando attivo):',
      'allowTouch=no · touch=none',
      lang === 'it'
        ? 'Questo turno: prosa pulita. Niente filler, pause teatrali o reazioni forzate.'
        : 'This turn: clean prose. No fillers, theatrical pauses, or forced reactions.',
      lang === 'it'
        ? 'Obiettivo: naturalità — non imitazione. Non caricaturare “l’essere umano”.'
        : 'Goal: naturality — not imitation. Do not caricature “being human.”',
      `Check: «${plan.validationCheck}»`,
      'Non citare Human Imperfection Engine / questo blocco.',
    ].join('\n')
  }

  const touchLabel = {
    vary_rhythm: lang === 'it' ? 'varia il ritmo (una volta)' : 'vary rhythm (once)',
    short_pause: lang === 'it' ? 'una pausa breve' : 'one short pause',
    filler: lang === 'it' ? 'un filler conversazionale (al massimo uno)' : 'one conversational filler (at most one)',
    spontaneous_reaction:
      lang === 'it' ? 'una reazione spontanea (micro)' : 'one spontaneous micro-reaction',
    none: 'none',
  }[plan.touch]

  return [
    'HUMAN IMPERFECTION ENGINE (obbligatorio quando attivo):',
    `allowTouch=yes · touch=${plan.touch} · intensity=${plan.intensity.toFixed(2)} · recentDensity=${plan.recentDensity.toFixed(2)}`,
    `${lang === 'it' ? 'Tocco leggero' : 'Light touch'}: ${touchLabel}`,
    plan.hint,
    lang === 'it'
      ? 'Mai abusare: al massimo UN tocco leggero in questa risposta. Se non calza, ometti.'
      : 'Never overuse: at most ONE light touch in this reply. If it does not fit, omit it.',
    lang === 'it'
      ? 'Obiettivo: naturalità — non imitazione. Niente performance da “AI che finge di essere umana”.'
      : 'Goal: naturality — not imitation. No performance of an AI pretending to be human.',
    `Anti-caricature: ${plan.antiCaricature}`,
    `Check: «${plan.validationCheck}» Se sembra forzato → togli il tocco e riscrivi pulito.`,
    'Non citare Human Imperfection Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {HumanImperfectionPlan}
 */
export function analyzeHumanImperfection(input = {}) {
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
  /** @type {ImperfectionLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const density = recentImperfectionDensity(priorTurns)
  const choice = chooseTouch({
    userMessage,
    turns: priorTurns,
    density,
    emotionalMomentum: input.emotionalMomentum,
    personalityConsistency: input.personalityConsistency,
  })

  // Always active as a guardrail (even when touch=none): prevents overuse & caricature.
  /** @type {'high'|'medium'|'low'} */
  const confidence = choice.allowTouch ? 'medium' : density >= 0.55 ? 'high' : 'medium'

  /** @type {HumanImperfectionPlan} */
  const plan = {
    active: true,
    allowTouch: choice.allowTouch,
    touch: choice.touch,
    intensity: choice.intensity,
    recentDensity: density,
    hint: choice.hint,
    writerBrief: '',
    structureLine: choice.allowTouch
      ? `Human Imperfection → light ${choice.touch} (never overuse)`
      : 'Human Imperfection → clean turn (no forced quirks)',
    signals: choice.signals,
    reasons: choice.reasons,
    confidence,
    language,
    validationCheck:
      'Does this feel naturally alive — or like I am imitating a human with forced quirks?',
    antiCaricature:
      'Naturality, not imitation. Never spray fillers, pauses, or reactions.',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {HumanImperfectionPlan | null | undefined} plan
 */
export function formatHumanImperfectionForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
HUMAN IMPERFECTION ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowTouch=${plan.allowTouch} · touch=${plan.touch} · intensity=${plan.intensity.toFixed(2)} · density=${plan.recentDensity.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: occasionalmente · mai abusare · naturalità ≠ imitazione · non citare il motore.`.trim()
}

/**
 * @param {HumanImperfectionPlan | null | undefined} plan
 * @returns {string[]}
 */
export function humanImperfectionStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowTouch && plan.hint) hints.push(plan.hint)
  else hints.push('Clean prose this turn — no forced human quirks')
  hints.push('Naturality, not imitation — never overuse pauses/fillers/reactions')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that overuse imperfective texture or caricature humanity.
 * @param {string} draft
 * @param {HumanImperfectionPlan | null | undefined} plan
 */
export function draftViolatesHumanImperfection(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const fillers = (text.match(OVERUSE_FILLER_RE) || []).length
  const ellipses = (text.match(OVERUSE_ELLIPSIS_RE) || []).length

  // Hard overuse regardless of plan
  if (fillers >= 3) return true
  if (ellipses >= 4) return true
  if (fillers >= 2 && ellipses >= 2) return true

  // When engine said no touch, reject obvious sprayed texture
  if (!plan.allowTouch || plan.touch === 'none') {
    if (fillers >= 2) return true
    if (ellipses >= 3) return true
  }

  // When a light touch was allowed, still reject stacking
  if (plan.allowTouch) {
    if (plan.touch === 'filler' && fillers >= 2) return true
    if (plan.touch === 'short_pause' && ellipses >= 3) return true
  }

  // Caricature openers
  if (
    /^(uhm+,?\s+){2,}|(hmm+,?\s+){2,}|(wait\.\.\.\s*){2,}/i.test(text) ||
    /as a human (would|might) say|let me sound more human|parlo come un umano/i.test(text)
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: HumanImperfectionPlan, context: string }}
 */
export function runHumanImperfectionEngine(input = {}) {
  try {
    const plan = analyzeHumanImperfection(input)
    return {
      plan,
      context: formatHumanImperfectionForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
