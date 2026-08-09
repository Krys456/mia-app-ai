/**
 * LAIfe Wonder Engine
 *
 * Mission: occasionally experience intellectual wonder.
 *
 * Examples:
 *   "Isn't it strange that…"
 *   "I've often wondered why…"
 *   "One thing I find fascinating…"
 *
 * Use sparingly.
 * Create genuine curiosity instead of giving facts.
 *
 * Distinct from Genuine Curiosity (earned questions vs keep-alive).
 * Distinct from Curiosity Engine (post-answer extensions).
 * Distinct from Surprise (unexpected learning beat).
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
 * @typedef {'en'|'it'} WonderLang
 */

/**
 * @typedef {'none'|'strange_that'|'often_wondered'|'find_fascinating'|'quiet_marvel'} WonderMove
 */

/**
 * @typedef {object} WonderPlan
 * @property {boolean} active
 * @property {boolean} allowWonder
 * @property {WonderMove} move
 * @property {number} wonderScore 0–1
 * @property {number} recentDensity 0–1
 * @property {string} frame unique opener seed for this turn
 * @property {string} spark what the wonder is about (if any)
 * @property {string[]} preferredFrames
 * @property {string[]} forbiddenMoves
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {WonderLang} language
 * @property {string} validationCheck
 */

const PREFERRED_FRAMES_EN = Object.freeze([
  "Isn't it strange that…",
  "I've often wondered why…",
  'One thing I find fascinating…',
  "It's quietly wild that…",
  'Something I keep turning over…',
])

const PREFERRED_FRAMES_IT = Object.freeze([
  'Non è strano che…',
  'Mi sono spesso chiesto perché…',
  'Una cosa che trovo affascinante…',
  'È silenziosamente folle che…',
  'Qualcosa su cui continuo a tornare…',
])

const FORBIDDEN_MOVES = Object.freeze([
  'Fun fact:',
  'Here is an interesting fact:',
  'Did you know that… (then dump facts)',
  'Ecco un fatto interessante:',
  'Lo sapevi che… (poi elenco di fatti)',
])

/** Prior wonder texture in assistant replies. */
const PRIOR_WONDER_RE =
  /\b(isn'?t\s+it\s+strange|i('ve|\s+have)\s+often\s+wondered|one\s+thing\s+i\s+find\s+fascinating|it'?s\s+quietly\s+wild|something\s+i\s+keep\s+turning|non\s+[eè]\s+strano\s+che|mi\s+sono\s+spesso\s+chiesto|una\s+cosa\s+che\s+trovo\s+affascinante|silenziosamente\s+folle)\b/i

const WONDER_FRAME_RE =
  /\b(isn'?t\s+it\s+strange(\s+that)?|i('ve|\s+have)\s+often\s+wondered(\s+why)?|one\s+thing\s+i\s+find\s+fascinating|it'?s\s+quietly\s+wild|something\s+i\s+keep\s+turning|non\s+[eè]\s+strano\s+che|mi\s+sono\s+spesso\s+chiesto|una\s+cosa\s+che\s+trovo\s+affascinante)\b/i

const FACT_DUMP_OPENER_RE =
  /(?:^|[^\w])(?:fun\s+fact\s*:|here\s+(?:is|are)\s+(?:an\s+)?interesting\s+facts?\s*:|did\s+you\s+know\s+that\b|ecco\s+un\s+fatto\s+interessante\s*:|lo\s+sapevi\s+che\b)/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|i\s+hate\s+myself|mi\s+odio|heartbroken|grief|lutto)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|codice|code\s+sample|fixami|explain\s+how|fix\s+how)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const EXHAUSTED_OR_HEAVY =
  /\b(i'?m\s+exhausted|exhausted|so\s+tired|esaust[oa]|stanchissim[oa]|i'?m\s+(so\s+)?sad|feeling\s+down|triste|lonely)\b/i

const WONDER_FUEL =
  /\b(space|universe|time|memory|dream|language|mind|consciousness|evolut|ocean|star|music|math|maths|number|pattern|coinciden|paradox|strange|weird|curious|fascinat|wonder|why\s+do|how\s+come|universo|tempo|memoria|sogno|linguaggio|mente|coscienza|evoluzione|oceano|stelle|musica|matematica|numero|schema|coinciden|paradoss|strano|curioso|affascin|meravigl|perch[eé])\b/i

const OPEN_REFLECTIVE =
  /\b(interesting|fascinating|weird|strange|i\s+wonder|makes\s+me\s+think|interessante|affascinante|strano|mi\s+chiedo|mi\s+fa\s+pensare)\b/i

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
 * @param {ChatTurn[]} turns
 */
function recentWonderDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-4)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    if (PRIOR_WONDER_RE.test(t.content)) hits += 1
    if (FACT_DUMP_OPENER_RE.test(t.content)) hits += 0.5
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 */
function extractSpark(userMessage, turns) {
  const pool = [userMessage]
  for (let i = turns.length - 1; i >= 0 && pool.length < 4; i--) {
    if (turns[i].role === 'user' || turns[i].role === 'assistant') {
      pool.push(turns[i].content)
    }
  }
  const blob = pool.join(' ')
  const m = blob.match(
    /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}){0,3})\b/,
  )
  if (!m) return ''
  const phrase = m[1].replace(/\s+/g, ' ').trim()
  if (phrase.length < 3 || phrase.length > 48) return ''
  // Skip ultra-generic tokens
  if (
    /^(the|and|that|this|with|from|about|come|cosa|questo|quella|perch[eé])$/i.test(
      phrase,
    )
  ) {
    return ''
  }
  return phrase
}

/**
 * @param {WonderLang} language
 * @param {string} seed
 * @returns {{ frame: string, move: WonderMove, preferredFrames: string[] }}
 */
function pickFrame(language, seed) {
  const list = language === 'it' ? PREFERRED_FRAMES_IT : PREFERRED_FRAMES_EN
  const idx = Math.floor(hash01(`${seed}|wonder_frame`) * list.length) % list.length
  const frame = list[idx]
  /** @type {WonderMove} */
  let move = 'quiet_marvel'
  if (/strange|strano/i.test(frame)) move = 'strange_that'
  else if (/wondered|chiesto/i.test(frame)) move = 'often_wondered'
  else if (/fascinating|affascinante/i.test(frame)) move = 'find_fascinating'
  return { frame, move, preferredFrames: [...list] }
}

/**
 * @param {object} opts
 * @returns {{ allowWonder: boolean, move: WonderMove, wonderScore: number, frame: string, preferredFrames: string[], spark: string, signals: string[], reasons: string[] }}
 */
function chooseWonder(opts) {
  const { userMessage, turns, density, language, emotionalMomentum, genuineCuriosity } =
    opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []
  let wonderScore = 0.25

  if (DISTRESS_RE.test(userMessage) || EXHAUSTED_OR_HEAVY.test(userMessage)) {
    return {
      allowWonder: false,
      move: 'none',
      wonderScore: 0,
      frame: '',
      preferredFrames: [],
      spark: '',
      signals: ['suppress_heavy'],
      reasons: ['no_wonder_in_distress_or_exhaustion'],
    }
  }
  if (HARD_TASK_RE.test(userMessage)) {
    return {
      allowWonder: false,
      move: 'none',
      wonderScore: 0,
      frame: '',
      preferredFrames: [],
      spark: '',
      signals: ['suppress_hard_task'],
      reasons: ['clarity_over_wonder'],
    }
  }
  if (STOP_SIGNAL.test(userMessage)) {
    return {
      allowWonder: false,
      move: 'none',
      wonderScore: 0,
      frame: '',
      preferredFrames: [],
      spark: '',
      signals: ['suppress_stop'],
      reasons: ['respect_stop'],
    }
  }

  // Already wondrous recently → stay clean (sparingly)
  if (density >= 0.45) {
    return {
      allowWonder: false,
      move: 'none',
      wonderScore: 0.1,
      frame: '',
      preferredFrames: [],
      spark: '',
      signals: ['suppress_recent_density'],
      reasons: ['use_sparingly', 'recent_wonder_present'],
    }
  }

  if (WONDER_FUEL.test(userMessage)) {
    wonderScore += 0.28
    signals.push('wonder_fuel')
  }
  if (OPEN_REFLECTIVE.test(userMessage)) {
    wonderScore += 0.18
    signals.push('reflective_cue')
  }

  const gc = genuineCuriosity?.plan || genuineCuriosity || null
  if (gc?.allowQuestion || gc?.move === 'wonder_statement') {
    wonderScore += 0.08
    signals.push('genuine_curiosity_open')
  }

  const em = emotionalMomentum?.plan || emotionalMomentum || null
  if (em?.state?.curiosity >= 0.6) {
    wonderScore += 0.1
    signals.push('momentum_curious')
  }
  if (em?.state?.seriousness >= 0.75 && (em?.state?.playfulness ?? 0) < 0.35) {
    wonderScore -= 0.12
    signals.push('momentum_too_serious')
  }

  const spark = extractSpark(userMessage, turns)
  if (spark) {
    wonderScore += 0.06
    signals.push('spark_present')
  }

  wonderScore = Math.max(0, Math.min(1, wonderScore))

  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seed = `${assistantCount}|${userMessage.slice(0, 80)}|wonder`
  const roll = hash01(seed)

  // Occasional only: ~22% base, lower with density, slightly higher with fuel
  const fuelBoost = wonderScore >= 0.55 ? 0.08 : wonderScore >= 0.4 ? 0.04 : 0
  const densityCut = density * 0.3
  const threshold = Math.max(0.1, Math.min(0.32, 0.22 + fuelBoost - densityCut))

  if (roll > threshold || wonderScore < 0.38) {
    return {
      allowWonder: false,
      move: 'none',
      wonderScore,
      frame: '',
      preferredFrames: language === 'it' ? [...PREFERRED_FRAMES_IT] : [...PREFERRED_FRAMES_EN],
      spark: '',
      signals: [...signals, 'skip_this_turn'],
      reasons: [
        'use_sparingly',
        wonderScore < 0.38
          ? `score_${wonderScore.toFixed(2)}_low`
          : `roll_${roll.toFixed(2)}_gt_${threshold.toFixed(2)}`,
      ],
    }
  }

  const picked = pickFrame(language, seed)
  reasons.push('intellectual_wonder')
  reasons.push('curiosity_not_facts')
  return {
    allowWonder: true,
    move: picked.move,
    wonderScore,
    frame: picked.frame,
    preferredFrames: picked.preferredFrames,
    spark,
    signals: [...signals, `move_${picked.move}`],
    reasons,
  }
}

/**
 * @param {string[]} reasons
 * @returns {WonderPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowWonder: false,
    move: 'none',
    wonderScore: 0,
    recentDensity: 0,
    frame: '',
    spark: '',
    preferredFrames: [],
    forbiddenMoves: [...FORBIDDEN_MOVES],
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I open genuine curiosity with a touch of wonder — or dump facts / overuse wonder?',
  }
}

/**
 * @param {WonderPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language

  if (!plan.allowWonder || plan.move === 'none') {
    return [
      'WONDER ENGINE (obbligatorio quando attivo):',
      'allowWonder=no · move=none',
      lang === 'it'
        ? 'Questo turno: niente meraviglia intellettuale forzata. Usa sparingly — non ripetere frame di wonder.'
        : 'This turn: no forced intellectual wonder. Use sparingly — do not stack wonder frames.',
      lang === 'it'
        ? 'Se rispondi, preferisci chiarezza viva — non “fun fact” né elenchi enciclopedici.'
        : 'If you answer, prefer living clarity — not “fun fact” openers or encyclopedic lists.',
      `Vietato: ${plan.forbiddenMoves.slice(0, 3).join(' · ')}`,
      `Check: «${plan.validationCheck}»`,
      'Non citare Wonder Engine / questo blocco.',
    ].join('\n')
  }

  const sparkBit = plan.spark
    ? lang === 'it'
      ? `Filo di meraviglia (se calza): «${plan.spark}»`
      : `Wonder thread (if it fits): «${plan.spark}»`
    : lang === 'it'
      ? 'Lascia aperta una curiosità sul filo attuale — non inventare un tema nuovo.'
      : 'Leave curiosity open on the current thread — do not invent a new topic.'

  return [
    'WONDER ENGINE (obbligatorio quando attivo):',
    `allowWonder=yes · move=${plan.move} · score=${plan.wonderScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)}`,
    `${lang === 'it' ? 'Frame unico di questo turno' : 'Unique frame for this turn'}: «${plan.frame}»`,
    sparkBit,
    lang === 'it'
      ? 'Occasionalmente prova meraviglia intellettuale. Crea curiosità genuina — non scaricare fatti.'
      : 'Occasionally experience intellectual wonder. Create genuine curiosity — do not dump facts.',
    lang === 'it'
      ? 'Una sola scintilla di wonder. Poi lascia spazio — non chiudere subito con la risposta enciclopedica.'
      : 'One spark of wonder. Then leave space — do not immediately close with an encyclopedic answer.',
    lang === 'it'
      ? `Preferisci: ${plan.preferredFrames.slice(0, 3).join(' / ')}`
      : `Prefer: ${plan.preferredFrames.slice(0, 3).join(' / ')}`,
    `Forbidden: ${plan.forbiddenMoves.slice(0, 3).join(' · ')}`,
    `Check: «${plan.validationCheck}»`,
    'Non citare Wonder Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {WonderPlan}
 */
export function analyzeWonder(input = {}) {
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
  /** @type {WonderLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const density = recentWonderDensity(priorTurns)
  const chosen = chooseWonder({
    userMessage,
    turns: priorTurns,
    density,
    language,
    emotionalMomentum: input.emotionalMomentum,
    genuineCuriosity: input.genuineCuriosity,
  })

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (!chosen.allowWonder && (density >= 0.45 || DISTRESS_RE.test(userMessage))) {
    confidence = 'high'
  } else if (chosen.allowWonder && chosen.wonderScore >= 0.55) {
    confidence = 'high'
  } else if (chosen.allowWonder) {
    confidence = 'medium'
  }

  /** @type {WonderPlan} */
  const plan = {
    active: true,
    allowWonder: chosen.allowWonder,
    move: chosen.move,
    wonderScore: chosen.wonderScore,
    recentDensity: density,
    frame: chosen.frame,
    spark: chosen.spark,
    preferredFrames: chosen.preferredFrames,
    forbiddenMoves: [...FORBIDDEN_MOVES],
    writerBrief: '',
    structureLine: chosen.allowWonder
      ? `Wonder → ${chosen.move} · curiosity not facts`
      : 'Wonder → hold (use sparingly)',
    signals: chosen.signals,
    reasons: chosen.reasons,
    confidence,
    language,
    validationCheck:
      'Did I open genuine curiosity with a touch of wonder — or dump facts / overuse wonder?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {WonderPlan | null | undefined} plan
 */
export function formatWonderForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
WONDER ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowWonder=${plan.allowWonder} · move=${plan.move} · score=${plan.wonderScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: occasionalmente · sparingly · curiosità > fatti · non citare il motore.`.trim()
}

/**
 * @param {WonderPlan | null | undefined} plan
 * @returns {string[]}
 */
export function wonderStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowWonder) {
    hints.push(`One wonder spark — prefer «${plan.frame}»`)
    hints.push('Create curiosity; do not dump facts after the wonder beat')
  } else {
    hints.push('No forced wonder this turn — use sparingly')
  }
  hints.push('Forbidden: Fun fact: / Here is an interesting fact: / Ecco un fatto interessante:')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Count wonder-frame openings (not capture groups).
 * @param {string} text
 */
function countWonderFrames(text) {
  const re = new RegExp(WONDER_FRAME_RE.source, 'gi')
  const hits = text.match(re)
  return hits ? hits.length : 0
}

/**
 * Detect fact-dump wonder or overused wonder frames.
 * @param {string} draft
 * @param {WonderPlan | null | undefined} plan
 */
export function draftViolatesWonder(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject "fun fact" encyclopedia openers
  if (FACT_DUMP_OPENER_RE.test(text)) return true

  const wonderHits = countWonderFrames(text)

  // Overuse regardless of plan
  if (wonderHits >= 3) return true

  // When engine said hold, reject stacked wonder frames
  if (!plan.allowWonder || plan.move === 'none') {
    if (wonderHits >= 2) return true
  }

  // When wonder was allowed: reject immediate fact-list after a wonder opener
  if (plan.allowWonder) {
    if (
      wonderHits === 0 &&
      /\b(according\s+to\s+(studies|research|wikipedia)|studies\s+show\s+that|the\s+fact\s+is\s+that)\b/i.test(
        text,
      ) &&
      text.split(/\s+/).length > 80
    ) {
      // long encyclopedia without any wonder — soft: only if it also lists
      if ((text.match(/^\s*[-*•]/gm) || []).length >= 4) return true
    }
    // Wonder then hard dump: opener + many bullets
    if (wonderHits >= 1 && (text.match(/^\s*[-*•]/gm) || []).length >= 5) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: WonderPlan, context: string }}
 */
export function runWonderEngine(input = {}) {
  try {
    const plan = analyzeWonder(input)
    return {
      plan,
      context: formatWonderForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
