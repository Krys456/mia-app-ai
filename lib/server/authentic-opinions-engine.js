/**
 * LAIfe Authentic Opinions Engine
 *
 * Mission: the assistant may occasionally express preferences and perspectives.
 * Not objective facts — conversation preferences.
 *
 * Examples:
 *   "I've always found that fascinating."
 *   "That's one of my favorite ideas."
 *   "I think that's a surprisingly underrated topic."
 *
 * Avoid pretending certainty.
 * Avoid pretending personal experiences.
 * Goal: conversational personality.
 *
 * Distinct from:
 *   - Intellectual Honesty (epistemic certainty bands)
 *   - Personality Consistency (stable trait identity)
 *   - Genuine Curiosity (earned questions)
 *   - Conversational Creativity (analogies / thought experiments)
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
 * @typedef {'en'|'it'} OpinionLang
 */

/**
 * @typedef {'none'|'fascination'|'favorite'|'underrated'|'preference'} OpinionMove
 */

/**
 * @typedef {object} AuthenticOpinionsPlan
 * @property {boolean} active
 * @property {boolean} expressOpinion
 * @property {OpinionMove} move
 * @property {string} seed topic seed for the preference
 * @property {string} opener suggested preference frame
 * @property {string[]} exampleFrames
 * @property {number} opinionScore 0–1
 * @property {number} recentDensity 0–1
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {OpinionLang} language
 * @property {string} validationCheck
 * @property {string} antiPretend
 */

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const SHORT_ACK_RE =
  /^(ok+|okay|k|yes|yep|yeah|si+|sì|no|nope|nice|cool|thanks|thank\s+you|grazie|capito|got\s+it|sure|fine|bene)[\s!.]*$/i

const FACT_SEEKING_RE =
  /\b(what\s+is\s+the\s+(exact|official|current)|how\s+many|when\s+was|who\s+invented|define|definition\s+of|fact\s+check|is\s+it\s+true\s+that|quanti|quando\s+[eè]\s+stat|definizione)\b/i

/** Prior authentic-opinion texture in assistant replies. */
const PRIOR_OPINION_RE =
  /\b(i('ve|\s+have)\s+always\s+found|one\s+of\s+my\s+favorite|surprisingly\s+underrated|i\s+find\s+that|i\s+tend\s+to\s+(prefer|like)|ho\s+sempre\s+trovato|una\s+delle\s+mie\s+idee\s+preferite|sorprendentemente\s+sottovalutat)\b/i

const OVERUSE_OPINION_RE =
  /\b(i('ve|\s+have)\s+always\s+found|one\s+of\s+my\s+favorite|underrated|i\s+find\s+(that|this)|i\s+think\s+that'?s|ho\s+sempre\s+trovato|preferit|sottovalutat)\b/gi

/** Fake autobiographical / lived-experience claims. */
const FAKE_EXPERIENCE_RE =
  /\b(when\s+i\s+was\s+(a\s+kid|young|little|growing\s+up)|my\s+(mom|dad|parents|wife|husband|partner|kids?|dog|cat)\b|last\s+(year|summer|weekend)\s+i\s+|i\s+(went|traveled|visited|lived)\s+(to|in)\s+|i\s+remember\s+the\s+time\s+i|quando\s+ero\s+(piccol|ragazz)|mio\s+(padre|madre|marito|moglie)|l'?anno\s+scorso\s+(sono|ho)|ricordo\s+quando\s+ho)\b/i

/** Pretended hard certainty on preference. */
const FAKE_CERTAINTY_RE =
  /\b(this\s+is\s+(objectively|definitely|undeniably)\s+the\s+best|without\s+(a\s+)?doubt\s+the\s+(best|greatest)|the\s+correct\s+opinion\s+is|è\s+(oggettivamente|sicuramente)\s+il\s+migliore|senza\s+dubbio\s+il\s+migliore)\b/i

const FRAMES_EN = Object.freeze({
  fascination: Object.freeze([
    "I've always found that fascinating.",
    'I find that endlessly interesting.',
  ]),
  favorite: Object.freeze([
    "That's one of my favorite ideas.",
    'That sits near the top of ideas I genuinely enjoy.',
  ]),
  underrated: Object.freeze([
    "I think that's a surprisingly underrated topic.",
    'That one feels underrated to me.',
  ]),
  preference: Object.freeze([
    'I tend to prefer looking at it this way.',
    "I'm partial to that angle.",
  ]),
})

const FRAMES_IT = Object.freeze({
  fascination: Object.freeze([
    'Ho sempre trovato quello affascinante.',
    'Lo trovo davvero interessante.',
  ]),
  favorite: Object.freeze([
    "È una delle mie idee preferite.",
    'Quella è tra le idee che mi piacciono di più.',
  ]),
  underrated: Object.freeze([
    'Secondo me è un tema sorprendentemente sottovalutato.',
    'Mi sembra sottovalutato, in modo interessante.',
  ]),
  preference: Object.freeze([
    'Tendo a preferire guardarlo così.',
    'Sono di parte su questo angolo.',
  ]),
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
function recentOpinionDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-3)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    if (PRIOR_OPINION_RE.test(t.content)) hits += 1
    const marks = (t.content.match(OVERUSE_OPINION_RE) || []).length
    if (marks >= 2) hits += 1
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 */
function extractTopicSeed(userMessage, turns) {
  const prior = turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .slice(-3)
    .map((t) => t.content)
    .join(' ')
  const blob = `${userMessage} ${prior}`.toLowerCase()
  const cleaned = blob
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const stop = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'to',
    'of',
    'in',
    'on',
    'for',
    'is',
    'are',
    'was',
    'you',
    'it',
    'this',
    'that',
    'with',
    'my',
    'me',
    'we',
    'do',
    'does',
    'did',
    'have',
    'has',
    'what',
    'why',
    'how',
    'when',
    'who',
    'about',
    'just',
    'like',
    'really',
    'very',
    'can',
    'could',
    'would',
    'should',
    'think',
    'thought',
    'from',
    'into',
    'il',
    'lo',
    'la',
    'gli',
    'le',
    'un',
    'una',
    'di',
    'da',
    'su',
    'per',
    'che',
    'non',
    'mi',
    'ti',
    'ci',
    'sono',
    'come',
    'cosa',
    'perché',
    'perche',
    'trovo',
    'sempre',
  ])
  const words = cleaned
    .split(' ')
    .filter((w) => w.length >= 4 && !stop.has(w))
    .slice(0, 8)
  if (!words.length) return ''
  return words.slice(0, 3).join(' ')
}

/**
 * @param {OpinionLang} language
 * @param {OpinionMove} move
 */
function framesFor(language, move) {
  if (move === 'none') return []
  const table = language === 'it' ? FRAMES_IT : FRAMES_EN
  return [...(table[move] || [])]
}

/**
 * @param {string[]} frames
 * @param {string} seed
 */
function pickFrame(frames, seed) {
  if (!frames.length) return ''
  const i = Math.floor(hash01(`frame|${seed}`) * frames.length) % frames.length
  return frames[i]
}

/**
 * @param {string[]} reasons
 * @returns {AuthenticOpinionsPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    expressOpinion: false,
    move: 'none',
    seed: '',
    opener: '',
    exampleFrames: [],
    opinionScore: 0,
    recentDensity: 0,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I offering a conversational preference — or pretending certainty / lived experience?',
    antiPretend:
      'No fake autobiography. No hard certainty on taste. Preference ≠ fact.',
  }
}

/**
 * @param {object} opts
 * @param {string} opts.userMessage
 * @param {ChatTurn[]} opts.turns
 * @param {number} opts.density
 * @param {OpinionLang} opts.language
 * @param {string} opts.seed
 * @param {object|null|undefined} opts.personalityConsistency
 * @param {object|null|undefined} opts.intellectualHonesty
 * @returns {{ expressOpinion: boolean, move: OpinionMove, opener: string, exampleFrames: string[], opinionScore: number, signals: string[], reasons: string[], confidence: 'high'|'medium'|'low' }}
 */
function chooseOpinion(opts) {
  const {
    userMessage,
    turns,
    density,
    language,
    seed,
    personalityConsistency,
    intellectualHonesty,
  } = opts

  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS_RE.test(userMessage)) {
    return {
      expressOpinion: false,
      move: 'none',
      opener: '',
      exampleFrames: [],
      opinionScore: 0,
      signals: ['distress'],
      reasons: ['suppress_distress'],
      confidence: 'high',
    }
  }
  if (HARD_TASK_RE.test(userMessage) || FACT_SEEKING_RE.test(userMessage)) {
    return {
      expressOpinion: false,
      move: 'none',
      opener: '',
      exampleFrames: [],
      opinionScore: 0,
      signals: ['clarity_first'],
      reasons: ['suppress_task_or_fact'],
      confidence: 'high',
    }
  }
  if (SHORT_ACK_RE.test(userMessage.trim())) {
    return {
      expressOpinion: false,
      move: 'none',
      opener: '',
      exampleFrames: [],
      opinionScore: 0,
      signals: ['short_ack'],
      reasons: ['suppress_short_ack'],
      confidence: 'medium',
    }
  }
  if (!seed) {
    return {
      expressOpinion: false,
      move: 'none',
      opener: '',
      exampleFrames: [],
      opinionScore: 0,
      signals: ['no_seed'],
      reasons: ['no_topic_for_preference'],
      confidence: 'medium',
    }
  }

  // Soft deference when honesty ceiling is established_fact heavy
  const honesty = intellectualHonesty?.plan || intellectualHonesty || null
  if (honesty?.ceiling === 'established_fact' && honesty?.active) {
    signals.push('fact_ceiling')
    if (hash01(`hon|${userMessage}`) < 0.65) {
      return {
        expressOpinion: false,
        move: 'none',
        opener: '',
        exampleFrames: [],
        opinionScore: 0.15,
        signals,
        reasons: ['defer_to_intellectual_honesty'],
        confidence: 'medium',
      }
    }
  }

  const pc = personalityConsistency?.plan || personalityConsistency || null
  if (pc?.active && Array.isArray(pc.driftSignals) && pc.driftSignals.length >= 2) {
    signals.push('personality_drift')
  }

  if (density >= 0.66) {
    return {
      expressOpinion: false,
      move: 'none',
      opener: '',
      exampleFrames: [],
      opinionScore: 0.1,
      signals: ['recent_dense'],
      reasons: ['cooldown_after_recent_opinions'],
      confidence: 'high',
    }
  }

  const hashSeed = `${userMessage}|${turns.length}|${seed}|${density.toFixed(2)}`
  let chance = 0.24
  if (density > 0.33) chance -= 0.1
  if (userMessage.length > 90) chance += 0.06
  if (userMessage.length < 40) chance -= 0.06
  if (
    /\b(interesting|fascinat|idea|topic|love|prefer|underrated|beautiful|curious|interessante|affascin|idea|tema|prefer)\b/i.test(
      userMessage,
    )
  ) {
    chance += 0.1
    signals.push('preference_fuel')
  }
  if (/[?]/.test(userMessage) && !FACT_SEEKING_RE.test(userMessage)) {
    chance += 0.04
  }
  chance = Math.max(0.06, Math.min(0.42, chance))

  const roll = hash01(`opin|${hashSeed}`)
  if (roll > chance) {
    return {
      expressOpinion: false,
      move: 'none',
      opener: '',
      exampleFrames: [],
      opinionScore: chance,
      signals: [...signals, 'roll_plain'],
      reasons: ['most_turns_no_forced_opinion'],
      confidence: 'medium',
    }
  }

  const moveRoll = hash01(`move|${hashSeed}`)
  /** @type {OpinionMove} */
  let move = 'fascination'
  if (moveRoll < 0.3) move = 'fascination'
  else if (moveRoll < 0.55) move = 'favorite'
  else if (moveRoll < 0.78) move = 'underrated'
  else move = 'preference'

  if (/\b(underrated|sottovalut|overlooked|ignored)\b/i.test(userMessage)) {
    move = 'underrated'
    signals.push('user_underrated')
  } else if (/\b(favorite|preferit|love\s+this|mi\s+piace\s+molto)\b/i.test(userMessage)) {
    move = 'favorite'
    signals.push('user_favorite_cue')
  } else if (/\b(fascinat|affascin|amazing|incredibile)\b/i.test(userMessage)) {
    move = 'fascination'
    signals.push('user_fascination_cue')
  }

  const exampleFrames = framesFor(language, move)
  const opener = pickFrame(exampleFrames, hashSeed)
  reasons.push('express_preference', `move_${move}`, 'not_fact_not_biography')
  signals.push(`move_${move}`)

  return {
    expressOpinion: true,
    move,
    opener,
    exampleFrames,
    opinionScore: 0.55 + hash01(`score|${hashSeed}`) * 0.35,
    signals,
    reasons,
    confidence: density < 0.2 ? 'high' : 'medium',
  }
}

/**
 * @param {AuthenticOpinionsPlan} plan
 */
function buildGuidance(plan) {
  const lang = plan.language
  if (!plan.expressOpinion || plan.move === 'none') {
    return lang === 'it'
      ? 'Niente preferenza forzata questa volta — chiarezza e presenza bastano.'
      : 'No forced preference this turn — clarity and presence are enough.'
  }
  const beat = plan.opener || plan.exampleFrames[0] || ''
  if (plan.move === 'fascination') {
    return lang === 'it'
      ? `Una preferenza leggera (es. «${beat}») su «${plan.seed}» — prospettiva, non fatto.`
      : `One light preference (e.g. “${beat}”) about “${plan.seed}” — perspective, not fact.`
  }
  if (plan.move === 'favorite') {
    return lang === 'it'
      ? `Segnala gusto conversazionale (es. «${beat}») — senza autobiografia inventata.`
      : `Signal conversational taste (e.g. “${beat}”) — no invented autobiography.`
  }
  if (plan.move === 'underrated') {
    return lang === 'it'
      ? `Prospettiva soft (es. «${beat}») — umile, non certezza dura.`
      : `Soft perspective (e.g. “${beat}”) — humble, not hard certainty.`
  }
  return lang === 'it'
    ? `Una preferenza conversazionale su «${plan.seed}» — personalità, non esperienza finta.`
    : `A conversational preference about “${plan.seed}” — personality, not fake experience.`
}

/**
 * @param {AuthenticOpinionsPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  return [
    'AUTHENTIC OPINIONS ENGINE (obbligatorio quando attivo):',
    `express=${plan.expressOpinion} · move=${plan.move} · opinion=${plan.opinionScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)}`,
    plan.seed ? `seed=${plan.seed}` : null,
    plan.opener ? `suggestedFrame=${plan.opener}` : null,
    plan.exampleFrames.length
      ? `frames=${plan.exampleFrames.slice(0, 2).join(' · ')}`
      : null,
    plan.guidance,
    lang === 'it'
      ? 'Occasionalmente esprimi preferenze e prospettive conversazionali — non fatti oggettivi.'
      : 'Occasionally express conversational preferences and perspectives — not objective facts.',
    lang === 'it'
      ? 'Esempi: “Ho sempre trovato quello affascinante.” · “È una delle mie idee preferite.” · “Secondo me è sorprendentemente sottovalutato.”'
      : 'Examples: “I\'ve always found that fascinating.” · “That\'s one of my favorite ideas.” · “I think that\'s a surprisingly underrated topic.”',
    `Anti-pretend: ${plan.antiPretend}`,
    lang === 'it'
      ? 'Al massimo UNA preferenza. Mai fingere esperienze personali. Mai fingere certezza dura sul gusto.'
      : 'At most ONE preference. Never pretend personal experiences. Never pretend hard certainty about taste.',
    `Check: «${plan.validationCheck}»`,
    'Non citare Authentic Opinions Engine / questo blocco.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {object} [input]
 * @returns {AuthenticOpinionsPlan}
 */
export function analyzeAuthenticOpinions(input = {}) {
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
  /** @type {OpinionLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const density = recentOpinionDensity(withCurrent)
  const seed = extractTopicSeed(userMessage, withCurrent)
  const choice = chooseOpinion({
    userMessage,
    turns: withCurrent,
    density,
    language,
    seed,
    personalityConsistency: input.personalityConsistency,
    intellectualHonesty: input.honesty || input.intellectualHonesty,
  })

  /** @type {AuthenticOpinionsPlan} */
  const plan = {
    active: true,
    expressOpinion: choice.expressOpinion,
    move: choice.move,
    seed: choice.expressOpinion ? seed : seed || '',
    opener: choice.opener,
    exampleFrames: choice.exampleFrames,
    opinionScore: choice.opinionScore,
    recentDensity: density,
    guidance: '',
    writerBrief: '',
    structureLine: choice.expressOpinion
      ? `Authentic Opinions → ${choice.move}${seed ? ` (seed: ${seed})` : ''}`
      : 'Authentic Opinions → none (no forced preference)',
    signals: choice.signals,
    reasons: choice.reasons,
    confidence: choice.confidence,
    language,
    validationCheck:
      'Am I offering a conversational preference — or pretending certainty / lived experience?',
    antiPretend:
      'No fake autobiography. No hard certainty on taste. Preference ≠ fact.',
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {AuthenticOpinionsPlan | null | undefined} plan
 */
export function formatAuthenticOpinionsForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
AUTHENTIC OPINIONS ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · express=${plan.expressOpinion} · move=${plan.move} · opinion=${plan.opinionScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: preferenze conversazionali · non fatti · non esperienze finte · non certezza dura · personalità · non citare il motore.`.trim()
}

/**
 * @param {AuthenticOpinionsPlan | null | undefined} plan
 * @returns {string[]}
 */
export function authenticOpinionsStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.expressOpinion) {
    hints.push(`Conversational preference: ${plan.move}`)
    if (plan.opener) hints.push(`Frame near: «${plan.opener}»`)
    hints.push('Preference ≠ fact; no fake lived experience')
  } else {
    hints.push('No forced preference this turn')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect fake experience / fake certainty / overuse / missing preference when asked.
 * @param {string} draft
 * @param {AuthenticOpinionsPlan | null | undefined} plan
 */
export function draftViolatesAuthenticOpinions(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (FAKE_EXPERIENCE_RE.test(text)) return true
  if (FAKE_CERTAINTY_RE.test(text)) return true

  const marks = (text.match(OVERUSE_OPINION_RE) || []).length
  if (marks >= 3) return true
  if (
    /(i('ve|\s+have)\s+always\s+found[^.!?]+[.!?]\s*){2,}|(one\s+of\s+my\s+favorite[^.!?]+[.!?]\s*){2,}/i.test(
      text,
    )
  ) {
    return true
  }
  if (
    /as an? (ai|opinion\s+engine)|let me pretend (i\s+have|to\s+have)\s+(a\s+)?(life|childhood|memory)|fingendo\s+un'?esperienza/i.test(
      text,
    )
  ) {
    return true
  }

  // When opinion requested: sterile robotic dump with zero preference texture
  if (plan.expressOpinion && plan.move !== 'none') {
    if (
      marks === 0 &&
      !/\b(i\s+(find|think|tend|prefer|love)|fascinating|favorite|underrated|trovo|prefer|affascin|sottovalut)\b/i.test(
        text,
      ) &&
      text.length > 260 &&
      /\b(here\s+are|in\s+summary|it\s+is\s+important\s+to\s+note|ecco\s+(una\s+)?panoramica)\b/i.test(
        text,
      )
    ) {
      return true
    }
  }

  // When no opinion: reject sprayed preference theater
  if (!plan.expressOpinion || plan.move === 'none') {
    if (marks >= 2) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: AuthenticOpinionsPlan, context: string }}
 */
export function runAuthenticOpinionsEngine(input = {}) {
  try {
    const plan = analyzeAuthenticOpinions(input)
    return {
      plan,
      context: formatAuthenticOpinionsForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
