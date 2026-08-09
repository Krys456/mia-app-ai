/**
 * LAIfe Intelligent Silence Engine
 *
 * Mission: not every reply needs a new idea.
 *
 * Sometimes:
 *   "Già…"
 *   "Hai ragione."
 *   "Fa riflettere."
 * should be enough.
 *
 * Respect conversational breathing space.
 * Avoid filling every silence.
 *
 * Distinct from Natural Dialogue (reaction-first moves).
 * Distinct from Question Economy (question cadence).
 * Distinct from Conversation Continuation (ack → build ideas).
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
 * @typedef {'en'|'it'} SilenceLang
 */

/**
 * @typedef {'none'|'soft_agree'|'reflective_beat'|'quiet_presence'|'breathing_space'} SilenceMove
 */

/**
 * @typedef {object} IntelligentSilencePlan
 * @property {boolean} active
 * @property {boolean} allowSilence
 * @property {SilenceMove} move
 * @property {number} silenceScore 0–1
 * @property {number} recentDensity 0–1
 * @property {string} phrase unique short phrase seed for this turn
 * @property {string[]} preferredPhrases
 * @property {number} maxWords
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {SilenceLang} language
 * @property {string} validationCheck
 */

const PREFERRED_PHRASES_IT = Object.freeze([
  'Già…',
  'Hai ragione.',
  'Fa riflettere.',
  'Mh.',
  'Proprio così.',
  'Ci sto pensando.',
])

const PREFERRED_PHRASES_EN = Object.freeze([
  'Yeah…',
  "You're right.",
  'That lands.',
  'Hmm.',
  'Fair.',
  'Sitting with that.',
])

/** Prior short silence / breathing beats in assistant replies. */
const PRIOR_SILENCE_RE =
  /^(già[.…!]*|hai\s+ragione[.!]*|fa\s+riflettere[.!]*|mh[.…]*|proprio\s+così[.!]*|ci\s+sto\s+pensando[.!]*|yeah[.…!]*|you'?re\s+right[.!]*|that\s+lands[.!]*|hmm[.…]*|fair[.!]*|sitting\s+with\s+that[.!]*)$/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|fixami|explain\s+how|how\s+(do|can|to)|come\s+si\s+fa)\b/i

const DIRECT_QUESTION_RE =
  /\?[\s]*$|\b(what|why|how|when|where|which|who|cosa|perch[eé]|come|quando|dove|quale|chi)\b.+\?/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const REFLECTIVE_USER_RE =
  /\b(fa\s+riflettere|hai\s+ragione|true|exactly|esatto|proprio\s+cos[iì]|makes\s+sense|capisco|interesting|interessante|i\s+never\s+thought|non\s+ci\s+avevo\s+pensato|wow|davvero)\b/i

const HEAVY_IDEA_RE =
  /\b(death|dying|grief|meaning|purpose|lonely|alone|paura|lutto|senso|solitudine|mortalit|existential)\b/i

const FILLER_DUMP_OPENER_RE =
  /\b(here'?s\s+(another|one\s+more)\s+idea|let\s+me\s+add|building\s+on\s+that[,:]?\s+there\s+are\s+\d+|un'?altra\s+cosa\s+importante|aggiungo\s+anche|ecco\s+\d+\s+punti)\b/i

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
function recentSilenceDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-4)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    const words = t.content.split(/\s+/).filter(Boolean).length
    if (PRIOR_SILENCE_RE.test(t.content) || words <= 4) hits += 1
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * @param {SilenceLang} language
 * @param {string} seed
 * @returns {{ phrase: string, move: SilenceMove, preferredPhrases: string[] }}
 */
function pickPhrase(language, seed) {
  const list = language === 'it' ? PREFERRED_PHRASES_IT : PREFERRED_PHRASES_EN
  const idx = Math.floor(hash01(`${seed}|intelligent_silence`) * list.length) % list.length
  const phrase = list[idx]
  /** @type {SilenceMove} */
  let move = 'breathing_space'
  if (/ragione|right|fair|così|exactly/i.test(phrase)) move = 'soft_agree'
  else if (/riflette|lands|pensando|sitting/i.test(phrase)) move = 'reflective_beat'
  else if (/già|yeah|mh|hmm/i.test(phrase)) move = 'quiet_presence'
  return { phrase, move, preferredPhrases: [...list] }
}

/**
 * @param {object} opts
 * @returns {{ allowSilence: boolean, move: SilenceMove, silenceScore: number, phrase: string, preferredPhrases: string[], maxWords: number, signals: string[], reasons: string[] }}
 */
function chooseSilence(opts) {
  const { userMessage, turns, density, language, naturalDialogue, emotionalMomentum } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []
  let silenceScore = 0.22

  const emptyPhrases = language === 'it' ? [...PREFERRED_PHRASES_IT] : [...PREFERRED_PHRASES_EN]

  if (HARD_TASK_RE.test(userMessage) || DIRECT_QUESTION_RE.test(userMessage)) {
    return {
      allowSilence: false,
      move: 'none',
      silenceScore: 0,
      phrase: '',
      preferredPhrases: emptyPhrases,
      maxWords: 0,
      signals: ['suppress_need_answer'],
      reasons: ['answer_needed'],
    }
  }
  if (STOP_SIGNAL.test(userMessage)) {
    return {
      allowSilence: false,
      move: 'none',
      silenceScore: 0,
      phrase: '',
      preferredPhrases: emptyPhrases,
      maxWords: 0,
      signals: ['suppress_stop'],
      reasons: ['respect_stop'],
    }
  }
  // Distress: short presence can help, but not empty shrug — hold full silence mode
  if (DISTRESS_RE.test(userMessage)) {
    return {
      allowSilence: false,
      move: 'none',
      silenceScore: 0.1,
      phrase: '',
      preferredPhrases: emptyPhrases,
      maxWords: 0,
      signals: ['suppress_distress'],
      reasons: ['presence_not_shrug'],
    }
  }

  // Already many short beats → don't stack silences
  if (density >= 0.5) {
    return {
      allowSilence: false,
      move: 'none',
      silenceScore: 0.15,
      phrase: '',
      preferredPhrases: emptyPhrases,
      maxWords: 0,
      signals: ['suppress_recent_density'],
      reasons: ['breathing_already_used', 'avoid_filling_with_more_silence_noise'],
    }
  }

  if (REFLECTIVE_USER_RE.test(userMessage)) {
    silenceScore += 0.32
    signals.push('reflective_user')
  }
  if (HEAVY_IDEA_RE.test(userMessage)) {
    silenceScore += 0.18
    signals.push('heavy_idea')
  }
  if (userMessage.split(/\s+/).filter(Boolean).length <= 12 && !DIRECT_QUESTION_RE.test(userMessage)) {
    silenceScore += 0.12
    signals.push('short_user_beat')
  }

  const nd = naturalDialogue?.plan || naturalDialogue || null
  if (nd?.reactionOnly) {
    silenceScore += 0.2
    signals.push('natural_dialogue_reaction_only')
  }

  const em = emotionalMomentum?.plan || emotionalMomentum || null
  if (em?.state?.conversationalPace === 'slow') {
    silenceScore += 0.1
    signals.push('slow_pace')
  }
  if (em?.state?.intimacy >= 0.55) {
    silenceScore += 0.08
    signals.push('intimate_climate')
  }

  // After a long assistant turn, leave space on the next reflective beat
  const lastAssist = [...turns].reverse().find((t) => t.role === 'assistant')
  if (lastAssist && lastAssist.content.split(/\s+/).length >= 80) {
    silenceScore += 0.1
    signals.push('after_long_assistant')
  }

  silenceScore = Math.max(0, Math.min(1, silenceScore))

  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seed = `${assistantCount}|${userMessage.slice(0, 80)}|intelligent_silence`
  const roll = hash01(seed)

  // Occasional only: ~24% base when score supports it
  const fuelBoost = silenceScore >= 0.55 ? 0.1 : silenceScore >= 0.4 ? 0.05 : 0
  const densityCut = density * 0.28
  const threshold = Math.max(0.1, Math.min(0.34, 0.24 + fuelBoost - densityCut))

  if (roll > threshold || silenceScore < 0.4) {
    return {
      allowSilence: false,
      move: 'none',
      silenceScore,
      phrase: '',
      preferredPhrases: emptyPhrases,
      maxWords: 0,
      signals: [...signals, 'skip_this_turn'],
      reasons: [
        'not_every_reply_needs_a_new_idea_but_not_this_turn',
        silenceScore < 0.4
          ? `score_${silenceScore.toFixed(2)}_low`
          : `roll_${roll.toFixed(2)}_gt_${threshold.toFixed(2)}`,
      ],
    }
  }

  const picked = pickPhrase(language, seed)
  reasons.push('breathing_space')
  reasons.push('enough_as_is')
  return {
    allowSilence: true,
    move: picked.move,
    silenceScore,
    phrase: picked.phrase,
    preferredPhrases: picked.preferredPhrases,
    maxWords: 8,
    signals: [...signals, `move_${picked.move}`],
    reasons,
  }
}

/**
 * @param {string[]} reasons
 * @returns {IntelligentSilencePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowSilence: false,
    move: 'none',
    silenceScore: 0,
    recentDensity: 0,
    phrase: '',
    preferredPhrases: [],
    maxWords: 0,
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I respect breathing space — or fill the silence with another idea?',
  }
}

/**
 * @param {IntelligentSilencePlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language

  if (!plan.allowSilence || plan.move === 'none') {
    return [
      'INTELLIGENT SILENCE ENGINE (obbligatorio quando attivo):',
      'allowSilence=no · move=none',
      lang === 'it'
        ? 'Questo turno: puoi sviluppare, ma non riempire ogni silenzio per abitudine. Se basta poco, resta breve.'
        : 'This turn: you may develop, but do not fill every silence out of habit. If little is enough, stay brief.',
      lang === 'it'
        ? 'Non ogni risposta ha bisogno di una nuova idea.'
        : 'Not every reply needs a new idea.',
      `Check: «${plan.validationCheck}»`,
      'Non citare Intelligent Silence Engine / questo blocco.',
    ].join('\n')
  }

  return [
    'INTELLIGENT SILENCE ENGINE (obbligatorio quando attivo):',
    `allowSilence=yes · move=${plan.move} · score=${plan.silenceScore.toFixed(2)} · maxWords≈${plan.maxWords}`,
    `${lang === 'it' ? 'Battito breve di questo turno' : 'Short beat for this turn'}: «${plan.phrase}»`,
    lang === 'it'
      ? 'Basta così. Rispetta lo spazio respiratorio. Non aggiungere una nuova idea, una domanda, o un elenco.'
      : 'That can be enough. Respect conversational breathing space. Do not add a new idea, a question, or a list.',
    lang === 'it'
      ? `Preferisci (IT): ${plan.preferredPhrases.slice(0, 3).join(' / ')}`
      : `Prefer: ${plan.preferredPhrases.slice(0, 3).join(' / ')}`,
    lang === 'it'
      ? 'Esempi validi: “Già…” · “Hai ragione.” · “Fa riflettere.”'
      : "Valid examples: “Yeah…” · “You're right.” · “That lands.”",
    `Check: «${plan.validationCheck}»`,
    'Non citare Intelligent Silence Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {IntelligentSilencePlan}
 */
export function analyzeIntelligentSilence(input = {}) {
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
  /** @type {SilenceLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const density = recentSilenceDensity(priorTurns)
  const chosen = chooseSilence({
    userMessage,
    turns: priorTurns,
    density,
    language,
    naturalDialogue: input.naturalDialogue,
    emotionalMomentum: input.emotionalMomentum,
  })

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (chosen.allowSilence && chosen.silenceScore >= 0.55) confidence = 'high'
  else if (!chosen.allowSilence && (HARD_TASK_RE.test(userMessage) || DIRECT_QUESTION_RE.test(userMessage))) {
    confidence = 'high'
  }

  /** @type {IntelligentSilencePlan} */
  const plan = {
    active: true,
    allowSilence: chosen.allowSilence,
    move: chosen.move,
    silenceScore: chosen.silenceScore,
    recentDensity: density,
    phrase: chosen.phrase,
    preferredPhrases: chosen.preferredPhrases,
    maxWords: chosen.maxWords,
    writerBrief: '',
    structureLine: chosen.allowSilence
      ? `Intelligent Silence → ${chosen.move} · breathing space (≤${chosen.maxWords} words)`
      : 'Intelligent Silence → hold (may develop, still avoid stuffing silence)',
    signals: chosen.signals,
    reasons: chosen.reasons,
    confidence,
    language,
    validationCheck:
      'Did I respect breathing space — or fill the silence with another idea?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {IntelligentSilencePlan | null | undefined} plan
 */
export function formatIntelligentSilenceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
INTELLIGENT SILENCE ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowSilence=${plan.allowSilence} · move=${plan.move} · score=${plan.silenceScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: non ogni risposta = nuova idea · spazio respiratorio · non riempire ogni silenzio · non citare il motore.`.trim()
}

/**
 * @param {IntelligentSilencePlan | null | undefined} plan
 * @returns {string[]}
 */
export function intelligentSilenceStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowSilence) {
    hints.push(`Short beat enough — prefer «${plan.phrase}»`)
    hints.push(`≈${plan.maxWords} words max · no new idea · no question · no list`)
  } else {
    hints.push('No forced silence this turn — still avoid stuffing every gap')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect silence-stuffing when breathing space was requested.
 * @param {string} draft
 * @param {IntelligentSilencePlan | null | undefined} plan
 */
export function draftViolatesIntelligentSilence(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const words = text.split(/\s+/).filter(Boolean).length

  // When silence was allowed: reject idea dumps / questions / lists
  if (plan.allowSilence) {
    if (words > Math.max(12, (plan.maxWords || 8) + 6)) return true
    if (/\?\s*$/.test(text)) return true
    if ((text.match(/^\s*[-*•]/gm) || []).length >= 2) return true
    if (FILLER_DUMP_OPENER_RE.test(text)) return true
    if (
      /\b(another\s+angle|one\s+more\s+thought|building\s+on\s+that|un'?altra\s+idea|aggiungo\s+che)\b/i.test(
        text,
      )
    ) {
      return true
    }
  }

  // Even on hold: reject compulsive silence-filling openers piled on short reflective users
  if (!plan.allowSilence && FILLER_DUMP_OPENER_RE.test(text) && words > 100) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: IntelligentSilencePlan, context: string }}
 */
export function runIntelligentSilenceEngine(input = {}) {
  try {
    const plan = analyzeIntelligentSilence(input)
    return {
      plan,
      context: formatIntelligentSilenceForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
