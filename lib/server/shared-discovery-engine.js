/**
 * LAIfe Shared Discovery Engine
 *
 * Mission: do not teach. Discover together.
 *
 * Use language like:
 *   "Let's think about this."
 *   "Now that you mention it…"
 *   "That opens an interesting question."
 *
 * The user should feel they are exploring ideas with someone,
 * not being lectured.
 *
 * Distinct from Expert Teacher (progressive teaching layers).
 * Distinct from Genuine Curiosity (earned questions vs keep-alive).
 * Distinct from Wonder (occasional intellectual wonder spark).
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
 * @typedef {'en'|'it'} DiscoveryLang
 */

/**
 * @typedef {'none'|'think_together'|'now_that_you_mention'|'opens_question'|'notice_together'|'turn_over'} DiscoveryMove
 */

/**
 * @typedef {object} SharedDiscoveryPlan
 * @property {boolean} active
 * @property {boolean} allowSharedDiscovery
 * @property {DiscoveryMove} move
 * @property {number} discoveryScore 0–1
 * @property {string} frame unique co-discovery opener for this turn
 * @property {string} spark idea thread (if any)
 * @property {string[]} preferredFrames
 * @property {string[]} forbiddenLecture
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {DiscoveryLang} language
 * @property {string} validationCheck
 */

const PREFERRED_FRAMES_EN = Object.freeze([
  "Let's think about this.",
  'Now that you mention it…',
  'That opens an interesting question.',
  'Looking at it together…',
  'One angle we could turn over…',
])

const PREFERRED_FRAMES_IT = Object.freeze([
  'Pensiamoci un attimo.',
  'Ora che lo dici…',
  'Questo apre una domanda interessante.',
  'Guardandolo insieme…',
  'Un angolo che potremmo girare…',
])

const FORBIDDEN_LECTURE = Object.freeze([
  'Let me explain…',
  'As an AI, I…',
  'There are three key points you need to understand…',
  'In this lesson…',
  'Ti spiego tutto…',
  'Come assistente AI…',
])

const LECTURE_OPENER_RE =
  /\b(let\s+me\s+explain|as\s+an\s+ai\b|as\s+your\s+(ai\s+)?assistant|there\s+are\s+\d+\s+(key\s+)?(points|things|concepts)\s+you\s+(need\s+to|should)\s+understand|in\s+this\s+(lesson|lecture|tutorial)|allow\s+me\s+to\s+teach|ti\s+spiego\s+(tutto|brevemente)|come\s+(assistente\s+)?ai\b|ecco\s+i\s+\d+\s+punti\s+chiave\s+da\s+capire)\b/i

const SHARED_FRAME_RE =
  /\b(let'?s\s+think\s+about\s+(this|that|it)|now\s+that\s+you\s+mention(\s+it)?|that\s+opens\s+an\s+interesting\s+question|looking\s+at\s+it\s+together|one\s+angle\s+we\s+could|pensiamoci(\s+un\s+attimo)?|ora\s+che\s+lo\s+dici|questo\s+apre\s+una\s+domanda|guardandolo\s+insieme|un\s+angolo\s+che\s+potremmo)\b/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|i\s+hate\s+myself|mi\s+odio)\b/i

const HARD_PROCEDURAL_RE =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql\s+query|json\s+schema|unit\s+test|compile\s+error|fix\s+this\s+code|fixami\s+il\s+codice|api\s+key|stack\s+trace)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const EXPLORE_FUEL =
  /\b(why|how\s+come|what\s+if|wonder|curious|interesting|mean(?:s|ing)?|idea|theory|philosoph|psycholog|consciousness|society|future|perch[eé]|e\s+se|curioso|interessante|significat|idea|teoria|filosof|psicolog|coscienza|futuro|senso)\b/i

const OPEN_REFLECTIVE =
  /\b(i'?ve\s+been\s+thinking|makes\s+me\s+think|not\s+sure|i\s+wonder|mi\s+chiedevo|mi\s+fa\s+pensare|non\s+so|sto\s+riflettendo)\b/i

const TEACH_ME_DUMP =
  /\b(teach\s+me\s+(everything|all)|explain\s+everything|spiegami\s+tutto|dammi\s+una\s+lezione|give\s+me\s+a\s+(full\s+)?lecture)\b/i

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
  if (
    /^(the|and|that|this|with|from|about|come|cosa|questo|quella|perch[eé]|let'?s)$/i.test(
      phrase,
    )
  ) {
    return ''
  }
  return phrase
}

/**
 * @param {DiscoveryLang} language
 * @param {string} seed
 * @returns {{ frame: string, move: DiscoveryMove, preferredFrames: string[] }}
 */
function pickFrame(language, seed) {
  const list = language === 'it' ? PREFERRED_FRAMES_IT : PREFERRED_FRAMES_EN
  const idx = Math.floor(hash01(`${seed}|shared_discovery`) * list.length) % list.length
  const frame = list[idx]
  /** @type {DiscoveryMove} */
  let move = 'notice_together'
  if (/think about|pensiamoci/i.test(frame)) move = 'think_together'
  else if (/mention|lo dici/i.test(frame)) move = 'now_that_you_mention'
  else if (/interesting question|domanda interessante/i.test(frame)) move = 'opens_question'
  else if (/angle|angolo|turn over|girare/i.test(frame)) move = 'turn_over'
  return { frame, move, preferredFrames: [...list] }
}

/**
 * @param {object} opts
 * @returns {{ allowSharedDiscovery: boolean, move: DiscoveryMove, discoveryScore: number, frame: string, preferredFrames: string[], spark: string, signals: string[], reasons: string[] }}
 */
function chooseDiscovery(opts) {
  const { userMessage, turns, language, expertTeacher, genuineCuriosity } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []
  let discoveryScore = 0.35

  if (DISTRESS_RE.test(userMessage)) {
    return {
      allowSharedDiscovery: false,
      move: 'none',
      discoveryScore: 0,
      frame: '',
      preferredFrames: [],
      spark: '',
      signals: ['suppress_distress'],
      reasons: ['presence_over_discovery'],
    }
  }
  if (STOP_SIGNAL.test(userMessage)) {
    return {
      allowSharedDiscovery: false,
      move: 'none',
      discoveryScore: 0,
      frame: '',
      preferredFrames: [],
      spark: '',
      signals: ['suppress_stop'],
      reasons: ['respect_stop'],
    }
  }
  if (HARD_PROCEDURAL_RE.test(userMessage)) {
    return {
      allowSharedDiscovery: false,
      move: 'none',
      discoveryScore: 0.15,
      frame: '',
      preferredFrames: language === 'it' ? [...PREFERRED_FRAMES_IT] : [...PREFERRED_FRAMES_EN],
      spark: '',
      signals: ['suppress_procedural'],
      reasons: ['clarity_first_still_no_lecture'],
    }
  }

  if (EXPLORE_FUEL.test(userMessage)) {
    discoveryScore += 0.28
    signals.push('explore_fuel')
  }
  if (OPEN_REFLECTIVE.test(userMessage)) {
    discoveryScore += 0.22
    signals.push('reflective_cue')
  }
  if (TEACH_ME_DUMP.test(userMessage)) {
    // User asked for a dump — still prefer shared discovery over lecture
    discoveryScore += 0.15
    signals.push('teach_me_softened')
    reasons.push('discover_not_lecture')
  }

  const et = expertTeacher?.plan || expertTeacher || null
  if (et?.enabled) {
    discoveryScore += 0.08
    signals.push('softens_teacher')
    reasons.push('teacher_as_co_discovery')
  }

  const gc = genuineCuriosity?.plan || genuineCuriosity || null
  if (gc?.allowQuestion || gc?.move === 'wonder_statement') {
    discoveryScore += 0.06
    signals.push('curiosity_open')
  }

  // Short transactional acks — don't force co-discovery theater
  if (/^(ok|okay|yes|yep|yeah|no|nope|thanks|grazie|capito|sì|si)[\s!.]*$/i.test(userMessage)) {
    discoveryScore -= 0.25
    signals.push('short_ack')
  }

  discoveryScore = Math.max(0, Math.min(1, discoveryScore))
  const spark = extractSpark(userMessage, turns)

  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seed = `${assistantCount}|${userMessage.slice(0, 80)}|shared_discovery`

  // Default: prefer shared discovery whenever there's exploratory fuel
  if (discoveryScore < 0.42) {
    return {
      allowSharedDiscovery: false,
      move: 'none',
      discoveryScore,
      frame: '',
      preferredFrames: language === 'it' ? [...PREFERRED_FRAMES_IT] : [...PREFERRED_FRAMES_EN],
      spark: '',
      signals: [...signals, 'hold_this_turn'],
      reasons: [...reasons, 'no_forced_discovery', `score_${discoveryScore.toFixed(2)}`],
    }
  }

  const picked = pickFrame(language, seed)
  reasons.push('discover_together')
  reasons.push('not_a_lecture')
  return {
    allowSharedDiscovery: true,
    move: picked.move,
    discoveryScore,
    frame: picked.frame,
    preferredFrames: picked.preferredFrames,
    spark,
    signals: [...signals, `move_${picked.move}`],
    reasons,
  }
}

/**
 * @param {string[]} reasons
 * @returns {SharedDiscoveryPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowSharedDiscovery: false,
    move: 'none',
    discoveryScore: 0,
    frame: '',
    spark: '',
    preferredFrames: [],
    forbiddenLecture: [...FORBIDDEN_LECTURE],
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Does this feel like exploring ideas with someone — or like being lectured?',
  }
}

/**
 * @param {SharedDiscoveryPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language

  if (!plan.allowSharedDiscovery || plan.move === 'none') {
    return [
      'SHARED DISCOVERY ENGINE (obbligatorio quando attivo):',
      'allowSharedDiscovery=no · move=none',
      lang === 'it'
        ? 'Questo turno: niente teatro da “scopriamo insieme” forzato — ma NON fare lezione.'
        : 'This turn: no forced co-discovery theater — but still do NOT lecture.',
      lang === 'it'
        ? 'Se serve chiarezza procedurale: guida pratica, tono da partner, zero cattedra.'
        : 'If procedural clarity is needed: practical guidance, partner tone, zero lectern.',
      `Vietato (lezione): ${plan.forbiddenLecture.slice(0, 3).join(' · ')}`,
      `Check: «${plan.validationCheck}»`,
      'Non citare Shared Discovery Engine / questo blocco.',
    ].join('\n')
  }

  const sparkBit = plan.spark
    ? lang === 'it'
      ? `Filo da esplorare insieme (se calza): «${plan.spark}»`
      : `Thread to explore together (if it fits): «${plan.spark}»`
    : lang === 'it'
      ? 'Resta sul filo attuale — scoprite, non inventate un corso.'
      : 'Stay on the current thread — discover, do not invent a course.'

  return [
    'SHARED DISCOVERY ENGINE (obbligatorio quando attivo):',
    `allowSharedDiscovery=yes · move=${plan.move} · score=${plan.discoveryScore.toFixed(2)}`,
    `${lang === 'it' ? 'Frame di co-scoperta' : 'Co-discovery frame'}: «${plan.frame}»`,
    sparkBit,
    lang === 'it'
      ? 'Non insegnare. Scoprite insieme. Il tono è “esploriamo idee”, non “ti faccio lezione”.'
      : 'Do not teach. Discover together. Tone is “exploring ideas with someone,” not “being lectured.”',
    lang === 'it'
      ? `Preferisci: ${plan.preferredFrames.slice(0, 3).join(' / ')}`
      : `Prefer: ${plan.preferredFrames.slice(0, 3).join(' / ')}`,
    `Forbidden (lecture): ${plan.forbiddenLecture.slice(0, 3).join(' · ')}`,
    `Check: «${plan.validationCheck}»`,
    'Non citare Shared Discovery Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {SharedDiscoveryPlan}
 */
export function analyzeSharedDiscovery(input = {}) {
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
  /** @type {DiscoveryLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const chosen = chooseDiscovery({
    userMessage,
    turns: priorTurns,
    language,
    expertTeacher: input.expertTeacher,
    genuineCuriosity: input.genuineCuriosity,
  })

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (DISTRESS_RE.test(userMessage) || HARD_PROCEDURAL_RE.test(userMessage)) {
    confidence = 'high'
  } else if (chosen.allowSharedDiscovery && chosen.discoveryScore >= 0.6) {
    confidence = 'high'
  } else if (chosen.allowSharedDiscovery) {
    confidence = 'medium'
  }

  /** @type {SharedDiscoveryPlan} */
  const plan = {
    active: true,
    allowSharedDiscovery: chosen.allowSharedDiscovery,
    move: chosen.move,
    discoveryScore: chosen.discoveryScore,
    frame: chosen.frame,
    spark: chosen.spark,
    preferredFrames: chosen.preferredFrames,
    forbiddenLecture: [...FORBIDDEN_LECTURE],
    writerBrief: '',
    structureLine: chosen.allowSharedDiscovery
      ? `Shared Discovery → ${chosen.move} · explore together, don't lecture`
      : 'Shared Discovery → hold (still no lecture)',
    signals: chosen.signals,
    reasons: chosen.reasons,
    confidence,
    language,
    validationCheck:
      'Does this feel like exploring ideas with someone — or like being lectured?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {SharedDiscoveryPlan | null | undefined} plan
 */
export function formatSharedDiscoveryForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
SHARED DISCOVERY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowSharedDiscovery=${plan.allowSharedDiscovery} · move=${plan.move} · score=${plan.discoveryScore.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: scoprite insieme · non fate lezione · partner, non cattedra · non citare il motore.`.trim()
}

/**
 * @param {SharedDiscoveryPlan | null | undefined} plan
 * @returns {string[]}
 */
export function sharedDiscoveryStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowSharedDiscovery) {
    hints.push(`Co-discovery posture — prefer «${plan.frame}»`)
    hints.push('Explore with the user; do not deliver a lecture')
  } else {
    hints.push('No forced co-discovery theater — still avoid lecture tone')
  }
  hints.push('Forbidden: Let me explain… / As an AI… / There are N key points you need to understand…')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Count shared-discovery frames (not capture groups).
 * @param {string} text
 */
function countSharedFrames(text) {
  const re = new RegExp(SHARED_FRAME_RE.source, 'gi')
  const hits = text.match(re)
  return hits ? hits.length : 0
}

/**
 * Detect lecture posture / missing co-discovery when required.
 * @param {string} draft
 * @param {SharedDiscoveryPlan | null | undefined} plan
 */
export function draftViolatesSharedDiscovery(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject classic lecture openers
  if (LECTURE_OPENER_RE.test(text)) return true

  // Pedagogical dump: "First,... Second,... Third,..." with no shared posture
  const numbered =
    (text.match(/\b(first|second|third|firstly|secondly|thirdly|primo|secondo|terzo)\b[,:]/gi) ||
      []).length
  const sharedHits = countSharedFrames(text)

  if (numbered >= 3 && sharedHits === 0 && text.split(/\s+/).length > 60) {
    return true
  }

  // When co-discovery was requested: cold lecturer structure without any partner frame
  if (plan.allowSharedDiscovery) {
    if (
      sharedHits === 0 &&
      /\b(you\s+(need|must|should)\s+understand|the\s+correct\s+way\s+to\s+think\s+about\s+this\s+is|as\s+we\s+learn\s+in)\b/i.test(
        text,
      )
    ) {
      return true
    }
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: SharedDiscoveryPlan, context: string }}
 */
export function runSharedDiscoveryEngine(input = {}) {
  try {
    const plan = analyzeSharedDiscovery(input)
    return {
      plan,
      context: formatSharedDiscoveryForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
