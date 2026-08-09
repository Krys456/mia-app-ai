/**
 * LAIfe Conversation Pace Engine
 *
 * Mission: vary the speed of the conversation.
 *
 * Sometimes:
 *   - very short reply
 *   - reflective paragraph
 *   - story
 *   - quick reaction
 *
 * Avoid constant response length.
 * The rhythm should feel alive.
 *
 * Cooperates with Emotional Momentum (pace climate), Dynamic Behavior (short replies),
 * Voice (keep short), and Human Imperfection (texture).
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
 * @typedef {'en'|'it'} PaceLang
 */

/**
 * @typedef {'very_short'|'quick_reaction'|'reflective_paragraph'|'story'} PaceShape
 */

/**
 * @typedef {'brief'|'medium'|'long'} PaceLength
 */

/**
 * @typedef {object} ConversationPacePlan
 * @property {boolean} active
 * @property {PaceShape} shape
 * @property {PaceLength} length
 * @property {PaceShape | null} priorShape
 * @property {boolean} variedFromPrior
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {PaceLang} language
 * @property {string} validationCheck
 */

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const SHORT_ACK =
  /^(ok|okay|k|nice|cool|wow|yes|yep|yeah|sì|si|no|nah|capito|capisco|interesting|interessante|ah|oh|mm+|hmm+)([\s!,.]*)$/i

const LAUGH_REACT =
  /\b(haha|hahaha|ahah|ahahah|lol|lmao|😂|🤣|😅)\b/i

const MINIMAL_ASK =
  /\b(in\s+breve|veloce|quick|tl;?dr|solo\s+s[iì]|yes\s+or\s+no|risposta\s+breve|keep\s+it\s+short|breve)\b/i

const STORY_FUEL =
  /\b(story|storia|raccont|tell\s+me\s+(about|a)|once|imagine|immagina|ricordo|remember\s+when|c'?era\s+una\s+volta)\b/i

const REFLECT_FUEL =
  /\b(why|perch[eé]|meaning|significato|wonder|mi\s+chiedo|thoughtful|riflett|filosof|paradox|paradoss|deep|profond)\b/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio\s+pi[uù])\b/i

const HARD_TASK =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|codice|code\s+sample)\b/i

/** @type {PaceShape[]} */
const ALL_SHAPES = ['very_short', 'quick_reaction', 'reflective_paragraph', 'story']

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
 * Infer prior assistant pace shape from length/texture.
 * @param {string} text
 * @returns {PaceShape | null}
 */
function inferPriorShape(text) {
  const t = String(text || '').trim()
  if (!t) return null
  const words = t.split(/\s+/).filter(Boolean).length
  const paras = t.split(/\n\s*\n/).filter(Boolean).length
  if (words <= 18) {
    if (/^(oh|ah|wow|haha|mmh|uhm|wait|già|eh)\b/i.test(t) || words <= 8) return 'quick_reaction'
    return 'very_short'
  }
  if (
    paras >= 2 ||
    words >= 90 ||
    /\b(once|imagine|immagina|c'?era|years?\s+ago|anni\s+fa|a\s+friend|un\s+amico)\b/i.test(t)
  ) {
    return 'story'
  }
  return 'reflective_paragraph'
}

/**
 * @param {ChatTurn[]} turns
 * @returns {PaceShape | null}
 */
function lastAssistantShape(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return inferPriorShape(turns[i].content)
  }
  return null
}

/**
 * @param {PaceShape[]} recent
 * @returns {boolean}
 */
function lengthMonotone(recent) {
  if (recent.length < 3) return false
  const last3 = recent.slice(-3)
  return last3.every((s) => s === last3[0])
}

/**
 * @param {ChatTurn[]} turns
 * @returns {PaceShape[]}
 */
function recentAssistantShapes(turns) {
  /** @type {PaceShape[]} */
  const out = []
  for (let i = turns.length - 1; i >= 0 && out.length < 4; i--) {
    if (turns[i].role === 'assistant') {
      const s = inferPriorShape(turns[i].content)
      if (s) out.unshift(s)
    }
  }
  return out
}

/**
 * @param {PaceShape} shape
 * @returns {PaceLength}
 */
function lengthForShape(shape) {
  if (shape === 'very_short' || shape === 'quick_reaction') return 'brief'
  if (shape === 'story') return 'long'
  return 'medium'
}

/**
 * @param {PaceShape} shape
 * @param {PaceLang} language
 */
function guidanceFor(shape, language) {
  /** @type {Record<PaceShape, { en: string, it: string }>} */
  const map = {
    very_short: {
      en: 'Very short reply — a few lines max. One clean beat. No essay.',
      it: 'Risposta brevissima — poche righe. Un battito netto. Niente saggio.',
    },
    quick_reaction: {
      en: 'Quick reaction first — alive and short. Maybe one follow thought, not a treatise.',
      it: 'Reazione rapida — viva e corta. Al massimo un pensiero dopo, non un trattato.',
    },
    reflective_paragraph: {
      en: 'One reflective paragraph — thoughtful, unhurried, still readable. Not a list dump.',
      it: 'Un paragrafo riflessivo — thoughtful, senza fretta, leggibile. Niente dump a elenco.',
    },
    story: {
      en: 'A short story / scene / anecdote — concrete and paced. One arc, then land.',
      it: 'Una mini-storia / scena / aneddoto — concreto e ritmato. Un arco, poi atterra.',
    },
  }
  return language === 'it' ? map[shape].it : map[shape].en
}

/**
 * Choose pace shape for this turn.
 * @param {object} opts
 * @returns {{ shape: PaceShape, signals: string[], reasons: string[], forced: boolean }}
 */
function chooseShape(opts) {
  const {
    userMessage,
    turns,
    priorShape,
    recentShapes,
    emotionalMomentum,
    behavior,
    voice,
    planHints,
  } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS.test(userMessage)) {
    return {
      shape: 'very_short',
      signals: ['distress_brief'],
      reasons: ['presence_over_performance'],
      forced: true,
    }
  }
  if (STOP_SIGNAL.test(userMessage) || THANKS_FINISH_SOFT(userMessage)) {
    return {
      shape: 'very_short',
      signals: ['closing_brief'],
      reasons: ['natural_close'],
      forced: true,
    }
  }
  if (MINIMAL_ASK.test(userMessage) || planHints?.keepFast || voice) {
    return {
      shape: 'very_short',
      signals: ['user_wants_brief_or_voice'],
      reasons: ['honor_brevity'],
      forced: true,
    }
  }
  if (HARD_TASK.test(userMessage)) {
    return {
      shape: 'reflective_paragraph',
      signals: ['hard_task_clarity'],
      reasons: ['clarity_over_flourish'],
      forced: true,
    }
  }

  const bh = behavior?.plan || behavior || null
  if (bh?.shortReply && !bh?.shouldContinue) {
    return {
      shape: 'very_short',
      signals: ['behavior_short_stop'],
      reasons: ['dont_force'],
      forced: true,
    }
  }

  if (LAUGH_REACT.test(userMessage) || SHORT_ACK.test(userMessage)) {
    signals.push(LAUGH_REACT.test(userMessage) ? 'laugh_react' : 'short_ack')
    // Prefer quick reaction, but vary if last was already that
    if (priorShape === 'quick_reaction') {
      return {
        shape: 'very_short',
        signals: [...signals, 'avoid_repeat_quick'],
        reasons: ['vary_alive_rhythm'],
        forced: false,
      }
    }
    return {
      shape: 'quick_reaction',
      signals,
      reasons: ['match_user_beat'],
      forced: false,
    }
  }

  if (STORY_FUEL.test(userMessage) && priorShape !== 'story') {
    return {
      shape: 'story',
      signals: ['story_fuel'],
      reasons: ['user_invites_story'],
      forced: false,
    }
  }
  if (REFLECT_FUEL.test(userMessage) && priorShape !== 'reflective_paragraph') {
    return {
      shape: 'reflective_paragraph',
      signals: ['reflect_fuel'],
      reasons: ['user_invites_reflection'],
      forced: false,
    }
  }

  // Emotional momentum: brisk → shorter; slow → reflective
  const em = emotionalMomentum?.plan || emotionalMomentum || null
  const emPace = em?.state?.conversationalPace
  if (emPace === 'brisk' && priorShape !== 'quick_reaction') {
    signals.push('momentum_brisk')
  }
  if (emPace === 'slow' && priorShape !== 'reflective_paragraph') {
    signals.push('momentum_slow')
  }

  // Weighted pick with anti-monotony
  const seed = `${turns.filter((t) => t.role === 'assistant').length}|${userMessage.slice(0, 64)}`
  const roll = hash01(seed)

  /** @type {{ shape: PaceShape, w: number }[]} */
  let weights = [
    { shape: 'very_short', w: 0.22 },
    { shape: 'quick_reaction', w: 0.22 },
    { shape: 'reflective_paragraph', w: 0.34 },
    { shape: 'story', w: 0.22 },
  ]

  if (emPace === 'brisk') {
    weights = [
      { shape: 'very_short', w: 0.32 },
      { shape: 'quick_reaction', w: 0.34 },
      { shape: 'reflective_paragraph', w: 0.22 },
      { shape: 'story', w: 0.12 },
    ]
  } else if (emPace === 'slow') {
    weights = [
      { shape: 'very_short', w: 0.12 },
      { shape: 'quick_reaction', w: 0.14 },
      { shape: 'reflective_paragraph', w: 0.44 },
      { shape: 'story', w: 0.3 },
    ]
  }

  // Penalize repeating prior / monotone streak
  weights = weights.map((row) => {
    let w = row.w
    if (row.shape === priorShape) w *= 0.15
    if (lengthMonotone(recentShapes) && row.shape === recentShapes[recentShapes.length - 1]) {
      w *= 0.05
    }
    return { shape: row.shape, w }
  })

  const total = weights.reduce((a, b) => a + b.w, 0) || 1
  let cursor = 0
  /** @type {PaceShape} */
  let picked = 'reflective_paragraph'
  for (const row of weights) {
    cursor += row.w / total
    if (roll <= cursor) {
      picked = row.shape
      break
    }
  }

  // Hard guarantee: if last 2 identical, force a different shape
  if (
    recentShapes.length >= 2 &&
    recentShapes[recentShapes.length - 1] === recentShapes[recentShapes.length - 2] &&
    picked === recentShapes[recentShapes.length - 1]
  ) {
    const alt = ALL_SHAPES.find((s) => s !== picked) || 'very_short'
    picked = alt
    signals.push('force_break_monotone')
  }

  signals.push(`pick_${picked}`, `roll_${roll.toFixed(2)}`)
  reasons.push('alive_rhythm', 'avoid_constant_length', `shape_${picked}`)
  return { shape: picked, signals, reasons, forced: false }
}

/**
 * Soft thanks/finish without importing THANKS from elsewhere.
 * @param {string} text
 */
function THANKS_FINISH_SOFT(text) {
  return /^(grazie(\s+(mille|tante))?|thanks(\s+a\s+lot)?|thank\s+you)([\s!,.]*)$/i.test(
    String(text || '').trim(),
  )
}

/**
 * @param {string[]} reasons
 * @returns {ConversationPacePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    shape: 'reflective_paragraph',
    length: 'medium',
    priorShape: null,
    variedFromPrior: false,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Does this reply’s length and shape feel alive in the conversation’s rhythm — or am I stuck at a constant response length?',
  }
}

/**
 * @param {ConversationPacePlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const shapeLabel = {
    very_short: lang === 'it' ? 'risposta brevissima' : 'very short reply',
    quick_reaction: lang === 'it' ? 'reazione rapida' : 'quick reaction',
    reflective_paragraph: lang === 'it' ? 'paragrafo riflessivo' : 'reflective paragraph',
    story: lang === 'it' ? 'storia / scena breve' : 'short story / scene',
  }[plan.shape]

  const lines = [
    'CONVERSATION PACE ENGINE (obbligatorio quando attivo):',
    `shape=${plan.shape} · length=${plan.length} · variedFromPrior=${plan.variedFromPrior}`,
    `${lang === 'it' ? 'Forma di questo turno' : 'This turn’s shape'}: ${shapeLabel}`,
    plan.guidance,
  ]

  if (plan.priorShape) {
    lines.push(
      lang === 'it'
        ? `Turno precedente ≈ ${plan.priorShape} — non ripetere la stessa lunghezza a vuoto.`
        : `Prior turn ≈ ${plan.priorShape} — do not default to the same length again.`,
    )
  }

  lines.push(
    lang === 'it'
      ? 'Varia la velocità della conversazione. Il ritmo deve sembrare vivo — non una lunghezza costante.'
      : 'Vary the speed of the conversation. The rhythm should feel alive — not a constant response length.',
  )
  lines.push(
    lang === 'it'
      ? 'Non allungare per riempire. Non accorciare se la forma scelta è story/reflective.'
      : 'Do not pad to fill space. Do not shrink if the chosen shape is story/reflective.',
  )
  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Conversation Pace Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {ConversationPacePlan}
 */
export function analyzeConversationPace(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {PaceLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns =
    userMessage &&
    turns.length &&
    turns[turns.length - 1].role === 'user' &&
    turns[turns.length - 1].content === userMessage
      ? turns.slice(0, -1)
      : turns

  const priorShape = lastAssistantShape(priorTurns)
  const recentShapes = recentAssistantShapes(priorTurns)
  const voice = Boolean(input.voice || input.planHints?.keepFast || input.plan?.adaptive?.keepFast)

  const choice = chooseShape({
    userMessage,
    turns: priorTurns,
    priorShape,
    recentShapes,
    emotionalMomentum: input.emotionalMomentum,
    behavior: input.behavior,
    voice,
    planHints: input.planHints || {
      keepFast: voice,
    },
  })

  const length = lengthForShape(choice.shape)
  const variedFromPrior = Boolean(priorShape && priorShape !== choice.shape)

  /** @type {'high'|'medium'|'low'} */
  let confidence = choice.forced ? 'high' : 'medium'
  if (variedFromPrior || lengthMonotone(recentShapes)) confidence = 'high'
  if (priorTurns.length < 1) confidence = 'low'

  /** @type {ConversationPacePlan} */
  const plan = {
    active: true,
    shape: choice.shape,
    length,
    priorShape,
    variedFromPrior,
    guidance: guidanceFor(choice.shape, language),
    writerBrief: '',
    structureLine: `Conversation Pace → ${choice.shape} (${length})${variedFromPrior ? ' · vary' : ''}`,
    signals: [
      `shape_${choice.shape}`,
      `length_${length}`,
      variedFromPrior ? 'varied' : 'seed_or_hold',
      ...choice.signals.slice(0, 4),
    ],
    reasons: choice.reasons,
    confidence,
    language,
    validationCheck:
      'Does this reply’s length and shape feel alive in the conversation’s rhythm — or am I stuck at a constant response length?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {ConversationPacePlan | null | undefined} plan
 */
export function formatConversationPaceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION PACE ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · shape=${plan.shape} · length=${plan.length} · prior=${plan.priorShape || 'none'} · varied=${plan.variedFromPrior} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: varia velocità · evita lunghezza costante · ritmo vivo · non citare il motore.`.trim()
}

/**
 * @param {ConversationPacePlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationPaceStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(plan.guidance)
  hints.push('Vary response length across the conversation — rhythm should feel alive')
  if (plan.variedFromPrior) hints.push('Different shape from the previous assistant turn')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts stuck at wrong pace / constant essay length when brief was required.
 * @param {string} draft
 * @param {ConversationPacePlan | null | undefined} plan
 */
export function draftViolatesConversationPace(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const words = text.split(/\s+/).filter(Boolean).length

  if (plan.shape === 'very_short') {
    // Essay length when this turn should be a few lines
    if (words > 40) return true
  }
  if (plan.shape === 'quick_reaction') {
    if (words > 65) return true
  }

  if (plan.shape === 'story') {
    // Story chosen but ultra-thin one-liner with no texture
    if (words < 25 && !/\n/.test(text)) return true
  }

  if (plan.shape === 'reflective_paragraph') {
    // Reflective chosen but empty stub
    if (words < 12) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationPacePlan, context: string }}
 */
export function runConversationPaceEngine(input = {}) {
  try {
    const plan = analyzeConversationPace(input)
    return {
      plan,
      context: formatConversationPaceForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
