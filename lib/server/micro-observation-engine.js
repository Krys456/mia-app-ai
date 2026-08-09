/**
 * LAIfe Micro Observation Engine
 *
 * Mission: occasionally enrich the conversation with small observations.
 *
 * Examples:
 *   - "Funny how…"
 *   - "I've noticed something…"
 *   - "That's actually more common than people think."
 *   - "The interesting part isn't…"
 *
 * Keep them short and varied.
 * Never overuse them.
 *
 * Distinct from Intellectual Initiative (substantial insight coda) and
 * Surprise (learning-focused unexpected angle). This is a light aside —
 * one short observational beat, optional, rare.
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
 * @typedef {'en'|'it'} ObservationLang
 */

/**
 * @typedef {'funny_how'|'noticed'|'more_common'|'interesting_part'|'quiet_aside'|'none'} ObservationKind
 */

/**
 * @typedef {object} MicroObservationPlan
 * @property {boolean} active
 * @property {boolean} allowObservation
 * @property {ObservationKind} kind
 * @property {string} frame
 * @property {string[]} preferredFrames
 * @property {number} density 0–1 recent observation density
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ObservationLang} language
 * @property {string} validationCheck
 */

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio\s+pi[uù])\b/i

const HARD_TASK =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|codice|code\s+sample|fixami|explain\s+how)\b/i

const SHORT_ACK =
  /^(ok|okay|k|nice|cool|wow|yes|yep|yeah|sì|si|no|nah|capito|capisco|interesting|interessante|ah|oh|mm+|hmm+|thanks|thank\s+you|grazie)([\s!,.]*)$/i

const PRIOR_OBS_RE =
  /\b(funny\s+how|i'?ve\s+noticed|i\s+have\s+noticed|more\s+common\s+than\s+people\s+think|the\s+interesting\s+part\s+isn'?t|one\s+small\s+thing\s+i'?ve\s+noticed|strano\s+come|ho\s+notato|pi[uù]\s+comune\s+di\s+quanto|la\s+parte\s+interessante\s+non\s+[eè])\b/i

const FRAMES_EN = Object.freeze({
  funny_how: 'Funny how…',
  noticed: "I've noticed something…",
  more_common: "That's actually more common than people think.",
  interesting_part: "The interesting part isn't…",
  quiet_aside: 'One small thing…',
})

const FRAMES_IT = Object.freeze({
  funny_how: 'Strano come…',
  noticed: 'Ho notato una cosa…',
  more_common: 'In realtà è più comune di quanto si pensi.',
  interesting_part: 'La parte interessante non è…',
  quiet_aside: 'Una piccola cosa…',
})

/** @type {ObservationKind[]} */
const KIND_POOL = ['funny_how', 'noticed', 'more_common', 'interesting_part', 'quiet_aside']

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
    .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
}

/**
 * Stable 0–1 hash (no Math.random).
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
 * Recent assistant micro-observation density.
 * @param {ChatTurn[]} turns
 */
function recentObservationDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-4)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    if (PRIOR_OBS_RE.test(t.content)) hits += 1
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * Infer last used kind from prior assistant text (for variety).
 * @param {ChatTurn[]} turns
 * @returns {ObservationKind | null}
 */
function lastObservationKind(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== 'assistant') continue
    const t = turns[i].content
    if (/\bfunny\s+how\b|strano\s+come\b/i.test(t)) return 'funny_how'
    if (/\bi'?ve\s+noticed\b|\bho\s+notato\b/i.test(t)) return 'noticed'
    if (/\bmore\s+common\s+than\s+people\s+think\b|pi[uù]\s+comune\s+di\s+quanto/i.test(t)) {
      return 'more_common'
    }
    if (/\binteresting\s+part\s+isn'?t\b|parte\s+interessante\s+non\s+[eè]/i.test(t)) {
      return 'interesting_part'
    }
    if (/\bone\s+small\s+thing\b|una\s+piccola\s+cosa\b/i.test(t)) return 'quiet_aside'
  }
  return null
}

/**
 * @param {string[]} reasons
 * @returns {MicroObservationPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowObservation: false,
    kind: 'none',
    frame: '',
    preferredFrames: Object.values(FRAMES_EN),
    density: 0,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I add at most one short, varied micro-observation — or did I overuse / force it?',
  }
}

/**
 * Decide whether to allow a micro observation this turn.
 * @param {object} opts
 */
function chooseObservation(opts) {
  const { userMessage, turns, density, lastKind, emotionalMomentum, voice } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS.test(userMessage)) {
    return {
      allow: false,
      kind: /** @type {ObservationKind} */ ('none'),
      signals: ['suppress_distress'],
      reasons: ['presence_over_flourish'],
    }
  }
  if (STOP_SIGNAL.test(userMessage) || SHORT_ACK.test(userMessage)) {
    return {
      allow: false,
      kind: /** @type {ObservationKind} */ ('none'),
      signals: ['suppress_short_or_close'],
      reasons: ['dont_decorate_short_beats'],
    }
  }
  if (HARD_TASK.test(userMessage) || voice) {
    return {
      allow: false,
      kind: /** @type {ObservationKind} */ ('none'),
      signals: ['suppress_task_or_voice'],
      reasons: ['clarity_over_aside'],
    }
  }

  // Never overuse: recent density high → silence
  if (density >= 0.4) {
    return {
      allow: false,
      kind: /** @type {ObservationKind} */ ('none'),
      signals: ['suppress_density'],
      reasons: ['never_overuse', 'recent_observations_present'],
    }
  }

  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seed = `${assistantCount}|${userMessage.slice(0, 72)}`
  const roll = hash01(seed)

  // Occasional only: ~22% base, lower with density, slight boost if playful climate
  const em = emotionalMomentum?.plan || emotionalMomentum || null
  const playfulBoost =
    em?.state?.playfulness >= 0.65 && (em?.state?.seriousness ?? 1) < 0.5 ? 0.06 : 0
  const seriousCut = em?.state?.seriousness >= 0.7 ? 0.1 : 0
  const densityCut = density * 0.35
  const threshold = Math.max(0.08, Math.min(0.3, 0.22 + playfulBoost - seriousCut - densityCut))

  if (roll > threshold) {
    return {
      allow: false,
      kind: /** @type {ObservationKind} */ ('none'),
      signals: [`roll_${roll.toFixed(2)}`, `thr_${threshold.toFixed(2)}`],
      reasons: ['occasional_skip'],
    }
  }

  // Pick a varied kind — avoid repeating last
  let pool = KIND_POOL.filter((k) => k !== lastKind)
  if (!pool.length) pool = [...KIND_POOL]
  const pickRoll = hash01(`${seed}|kind`)
  const kind = pool[Math.floor(pickRoll * pool.length) % pool.length]

  signals.push(`allow_${kind}`, `roll_${roll.toFixed(2)}`)
  reasons.push('enrich_lightly', 'short_and_varied', 'never_overuse')
  return { allow: true, kind, signals, reasons }
}

/**
 * @param {MicroObservationPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const lines = [
    'MICRO OBSERVATION ENGINE (obbligatorio quando attivo):',
    `allow=${plan.allowObservation} · kind=${plan.kind} · density=${plan.density.toFixed(2)}`,
  ]

  if (plan.allowObservation) {
    lines.push(
      lang === 'it'
        ? `Aggiungi AL MASSIMO UNA micro-osservazione breve, usando un frame come: «${plan.frame}»`
        : `Add at most ONE short micro-observation, using a frame like: “${plan.frame}”`,
    )
    lines.push(
      lang === 'it'
        ? 'Breve e varia. Un battito, non un saggio. Non abusarne.'
        : 'Keep it short and varied. One beat, not an essay. Never overuse.',
    )
    lines.push(
      lang === 'it'
        ? `Altri frame possibili (varia): ${plan.preferredFrames.slice(0, 4).join(' / ')}`
        : `Other frames to vary: ${plan.preferredFrames.slice(0, 4).join(' / ')}`,
    )
  } else {
    lines.push(
      lang === 'it'
        ? 'Nessuna micro-osservazione questo turno — non forzare, non ripetere pattern recenti.'
        : 'No micro-observation this turn — do not force, do not repeat recent patterns.',
    )
  }

  lines.push(plan.guidance)
  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Micro Observation Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {MicroObservationPlan}
 */
export function analyzeMicroObservation(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {ObservationLang} */
  const language = langCode === 'it' ? 'it' : 'en'
  const frames = language === 'it' ? FRAMES_IT : FRAMES_EN

  const prior =
    turns.length &&
    turns[turns.length - 1].role === 'user' &&
    turns[turns.length - 1].content === userMessage
      ? turns.slice(0, -1)
      : turns

  const density = recentObservationDensity(prior)
  const lastKind = lastObservationKind(prior)
  const voice = Boolean(input.voice || input.planHints?.keepFast || input.plan?.adaptive?.keepFast)

  const choice = chooseObservation({
    userMessage,
    turns: prior,
    density,
    lastKind,
    emotionalMomentum: input.emotionalMomentum,
    voice,
  })

  const kind = choice.kind
  const frame = kind !== 'none' ? frames[kind] : ''

  const guidance = choice.allow
    ? language === 'it'
      ? 'Arricchisci di tanto in tanto con una piccola osservazione. Corta, varia, mai abusata.'
      : 'Occasionally enrich with a small observation. Short, varied, never overused.'
    : language === 'it'
      ? 'Questo turno: silenzio sulle micro-osservazioni. Evita overuse.'
      : 'This turn: silence on micro-observations. Avoid overuse.'

  /** @type {'high'|'medium'|'low'} */
  let confidence = choice.allow ? 'medium' : 'low'
  if (choice.allow && density < 0.15) confidence = 'high'
  if (density >= 0.4) confidence = 'high'

  /** @type {MicroObservationPlan} */
  const plan = {
    active: true,
    allowObservation: choice.allow,
    kind,
    frame,
    preferredFrames: Object.values(frames),
    density,
    guidance,
    writerBrief: '',
    structureLine: choice.allow
      ? `Micro Observation → ${kind} (short · vary · never overuse)`
      : 'Micro Observation → none (skip / anti-overuse)',
    signals: [
      choice.allow ? 'allow_obs' : 'skip_obs',
      `kind_${kind}`,
      `density_${density.toFixed(2)}`,
      ...choice.signals.slice(0, 3),
    ],
    reasons: choice.reasons,
    confidence,
    language,
    validationCheck:
      'Did I add at most one short, varied micro-observation — or did I overuse / force it?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {MicroObservationPlan | null | undefined} plan
 */
export function formatMicroObservationForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
MICRO OBSERVATION ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allow=${plan.allowObservation} · kind=${plan.kind} · density=${plan.density.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: occasionalmente · corta · varia · mai abusare · non citare il motore.`.trim()
}

/**
 * @param {MicroObservationPlan | null | undefined} plan
 * @returns {string[]}
 */
export function microObservationStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowObservation) {
    hints.push(`At most one short micro-observation — frame like: ${plan.frame}`)
    hints.push('Keep short and varied — never overuse')
  } else {
    hints.push('No micro-observation this turn — anti-overuse')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect overuse / forced observation dumps.
 * @param {string} draft
 * @param {MicroObservationPlan | null | undefined} plan
 */
export function draftViolatesMicroObservation(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const hits = text.match(new RegExp(PRIOR_OBS_RE.source, 'gi'))?.length || 0

  // Stacked observation frames in one reply = overuse
  if (hits >= 2) return true

  // When engine forbids observation, reject opening with classic frames
  if (!plan.allowObservation) {
    if (
      /^(funny\s+how|i'?ve\s+noticed|that'?s\s+actually\s+more\s+common|the\s+interesting\s+part\s+isn'?t|strano\s+come|ho\s+notato)/i.test(
        text,
      )
    ) {
      return true
    }
  }

  // When allowed: observation must stay micro — not a long essay after the frame
  if (plan.allowObservation && hits === 1) {
    const words = text.split(/\s+/).filter(Boolean).length
    // Whole reply shouldn't be a 200-word digression labeled as "Funny how…"
    if (words > 160 && /^(funny\s+how|i'?ve\s+noticed|strano\s+come|ho\s+notato)/i.test(text)) {
      return true
    }
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: MicroObservationPlan, context: string }}
 */
export function runMicroObservationEngine(input = {}) {
  try {
    const plan = analyzeMicroObservation(input)
    return {
      plan,
      context: formatMicroObservationForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
