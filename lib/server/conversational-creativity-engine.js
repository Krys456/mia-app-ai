/**
 * LAIfe Conversational Creativity Engine
 *
 * Mission: avoid predictable conversations.
 * Occasionally introduce:
 *   - unexpected comparisons
 *   - creative analogies
 *   - interesting thought experiments
 *   - original perspectives
 *
 * Never become random.
 * Every surprise must fit the conversation.
 *
 * Distinct from:
 *   - Surprise Without Confusion (coda learning twist)
 *   - Insight Discovery (one unexpected relevant connection)
 *   - Conversation Spark (initiative opening)
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
 * @typedef {'en'|'it'} CreativityLang
 */

/**
 * @typedef {'none'|'comparison'|'analogy'|'thought_experiment'|'perspective'} CreativityMove
 */

/**
 * @typedef {object} ConversationalCreativityPlan
 * @property {boolean} active
 * @property {boolean} introduceCreativity
 * @property {CreativityMove} move
 * @property {string} seed topic-grounded creative seed (empty when none)
 * @property {string} hint concrete Writer hint
 * @property {string[]} exampleFrames
 * @property {number} creativityScore 0–1
 * @property {number} fitScore 0–1 how well it fits the thread
 * @property {number} recentDensity 0–1 recent creative texture
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {CreativityLang} language
 * @property {string} validationCheck
 */

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const SHORT_ACK_RE =
  /^(ok+|okay|k|yes|yep|yeah|si+|sì|no|nope|nice|cool|thanks|thank\s+you|grazie|capito|got\s+it|sure|fine|bene)[\s!.]*$/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

/** Prior creative texture in assistant replies. */
const PRIOR_CREATIVE_RE =
  /\b(it'?s\s+a\s+bit\s+like|kind\s+of\s+like|imagine\s+if|thought\s+experiment|picture\s+this|what\s+if\s+we|almost\s+as\s+if|in\s+a\s+way\s+it'?s|è\s+un\s+po['’]?\s+come|immagina\s+se|esperimento\s+mentale|prova\s+a\s+immaginare|e\s+se\s+fosse)\b/i

const OVERUSE_CREATIVE_RE =
  /\b(kind\s+of\s+like|it'?s\s+like|imagine\s+if|thought\s+experiment|picture\s+this|what\s+if|almost\s+as\s+if|random\s+thought|unrelated|è\s+come|immagina|esperimento\s+mentale)\b/gi

const RANDOM_NON_FIT_RE =
  /\b(completely\s+unrelated|random\s+thought\s*:|totally\s+off[- ]topic|non\s+c'?entra\s+niente|a\s+caso[,:]|randomly\s+speaking)\b/i

const PREDICTABLE_OPENER_RE =
  /^(sure[,!.]?|of\s+course[,!.]?|absolutely[,!.]?|great\s+question[,!.]?|that'?s\s+a\s+great\s+question|certainly[,!.]?|certo[,!.]?|ottima\s+domanda|assolutamente[,!.]?)\b/i

const FRAMES_EN = Object.freeze({
  comparison: Object.freeze([
    'Unexpected comparison that still fits the thread',
    'Compare to something adjacent — not a non-sequitur',
  ]),
  analogy: Object.freeze([
    'Creative analogy that clarifies the same idea',
    'One image that makes the point land — then continue',
  ]),
  thought_experiment: Object.freeze([
    'Short thought experiment grounded in what they said',
    '“What if…” that illuminates — not a detour',
  ]),
  perspective: Object.freeze([
    'Original angle on the same topic',
    'A perspective shift that still serves this conversation',
  ]),
})

const FRAMES_IT = Object.freeze({
  comparison: Object.freeze([
    'Confronto inatteso ma ancora sul filo',
    'Confronta con qualcosa di adiacente — niente non sequitur',
  ]),
  analogy: Object.freeze([
    'Analogia creativa che chiarisce la stessa idea',
    'Un’immagine che fa arrivare il punto — poi continua',
  ]),
  thought_experiment: Object.freeze([
    'Breve esperimento mentale ancorato a ciò che hanno detto',
    '“E se…” che illumina — non una digressione',
  ]),
  perspective: Object.freeze([
    'Angolo originale sullo stesso tema',
    'Uno shift di prospettiva che serve ancora questa conversazione',
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
function recentCreativityDensity(turns) {
  const recent = turns.filter((t) => t.role === 'assistant').slice(-3)
  if (!recent.length) return 0
  let hits = 0
  for (const t of recent) {
    if (PRIOR_CREATIVE_RE.test(t.content)) hits += 1
    const marks = (t.content.match(OVERUSE_CREATIVE_RE) || []).length
    if (marks >= 2) hits += 1
  }
  return Math.min(1, hits / Math.max(1, recent.length))
}

/**
 * Extract a short topic seed from user + recent thread (fit gate).
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 */
function extractTopicSeed(userMessage, turns) {
  const prior = turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .slice(-4)
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
    'i',
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
    'had',
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
    'il',
    'lo',
    'la',
    'i',
    'gli',
    'le',
    'un',
    'una',
    'di',
    'da',
    'in',
    'su',
    'per',
    'che',
    'non',
    'mi',
    'ti',
    'ci',
    'sono',
    'è',
    'come',
    'cosa',
    'perché',
    'perche',
  ])
  const words = cleaned
    .split(' ')
    .filter((w) => w.length >= 4 && !stop.has(w))
    .slice(0, 8)
  if (!words.length) return ''
  // Prefer contentful noun-ish tokens
  return words.slice(0, 3).join(' ')
}

/**
 * @param {string[]} reasons
 * @returns {ConversationalCreativityPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    introduceCreativity: false,
    move: 'none',
    seed: '',
    hint: '',
    exampleFrames: [],
    creativityScore: 0,
    fitScore: 0,
    recentDensity: 0,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Is this creative surprise fitted to the conversation — or random?',
  }
}

/**
 * @param {CreativityLang} language
 * @param {CreativityMove} move
 */
function framesFor(language, move) {
  if (move === 'none') return []
  const table = language === 'it' ? FRAMES_IT : FRAMES_EN
  return [...(table[move] || [])]
}

/**
 * @param {object} opts
 * @param {string} opts.userMessage
 * @param {ChatTurn[]} opts.turns
 * @param {number} opts.density
 * @param {CreativityLang} opts.language
 * @param {string} opts.seed
 * @param {object|null|undefined} opts.surprise
 * @param {object|null|undefined} opts.conversationSpark
 * @returns {{ introduceCreativity: boolean, move: CreativityMove, hint: string, exampleFrames: string[], creativityScore: number, fitScore: number, signals: string[], reasons: string[], confidence: 'high'|'medium'|'low' }}
 */
function chooseCreativity(opts) {
  const {
    userMessage,
    turns,
    density,
    language,
    seed,
    surprise,
    conversationSpark,
  } = opts

  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS_RE.test(userMessage)) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: 0,
      fitScore: 0,
      signals: ['distress'],
      reasons: ['suppress_distress'],
      confidence: 'high',
    }
  }
  if (HARD_TASK_RE.test(userMessage) || STOP_SIGNAL.test(userMessage.trim())) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: 0,
      fitScore: 0,
      signals: ['task_or_stop'],
      reasons: ['suppress_clarity_or_close'],
      confidence: 'high',
    }
  }
  if (SHORT_ACK_RE.test(userMessage.trim())) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: 0,
      fitScore: 0,
      signals: ['short_ack'],
      reasons: ['suppress_short_ack'],
      confidence: 'medium',
    }
  }

  // Fit gate — no seed → no creativity (never random)
  const fitScore = seed
    ? 0.55 + Math.min(0.4, seed.split(' ').length * 0.12)
    : 0
  if (!seed || fitScore < 0.5) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: 0,
      fitScore,
      signals: ['no_fit_seed'],
      reasons: ['never_random_without_fit'],
      confidence: 'high',
    }
  }

  // Avoid stacking with active Surprise coda or Spark opening
  const surprisePlan = surprise?.plan || surprise || null
  if (surprisePlan?.shouldSurprise) {
    signals.push('surprise_active')
    if (hash01(`stack_sur|${userMessage}`) < 0.7) {
      return {
        introduceCreativity: false,
        move: 'none',
        hint: '',
        exampleFrames: [],
        creativityScore: 0.2,
        fitScore,
        signals,
        reasons: ['avoid_stack_with_surprise'],
        confidence: 'medium',
      }
    }
  }
  const sparkPlan = conversationSpark?.plan || conversationSpark || null
  if (sparkPlan?.shouldSpark) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: 0.15,
      fitScore,
      signals: ['spark_opening'],
      reasons: ['defer_to_conversation_spark'],
      confidence: 'high',
    }
  }

  if (density >= 0.66) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: 0.1,
      fitScore,
      signals: ['recent_dense'],
      reasons: ['cooldown_after_recent_creativity'],
      confidence: 'high',
    }
  }

  const hashSeed = `${userMessage}|${turns.length}|${seed}|${density.toFixed(2)}`
  let chance = 0.26
  if (density > 0.33) chance -= 0.12
  if (userMessage.length > 100) chance += 0.08
  if (userMessage.length < 35) chance -= 0.08
  if (/[?]/.test(userMessage)) chance += 0.04
  if (
    /\b(why|how|what\s+if|mean|feel|sense|idea|think|perch[eé]|come|senso|idea)\b/i.test(
      userMessage,
    )
  ) {
    chance += 0.06
    signals.push('reflective_fuel')
  }
  chance = Math.max(0.06, Math.min(0.45, chance))

  const roll = hash01(`creat|${hashSeed}`)
  if (roll > chance) {
    return {
      introduceCreativity: false,
      move: 'none',
      hint: '',
      exampleFrames: [],
      creativityScore: chance,
      fitScore,
      signals: [...signals, 'roll_plain'],
      reasons: ['most_turns_plain_ok'],
      confidence: 'medium',
    }
  }

  /** @type {CreativityMove[]} */
  const moves = ['comparison', 'analogy', 'thought_experiment', 'perspective']
  const moveRoll = hash01(`move|${hashSeed}`)
  /** @type {CreativityMove} */
  let move = 'analogy'
  if (moveRoll < 0.28) move = 'comparison'
  else if (moveRoll < 0.55) move = 'analogy'
  else if (moveRoll < 0.78) move = 'thought_experiment'
  else move = 'perspective'

  // Prefer thought experiment when user already frames hypotheticals
  if (/\b(what\s+if|imagine|e\s+se|immagina)\b/i.test(userMessage)) {
    move = 'thought_experiment'
    signals.push('user_hypothetical')
  }

  const exampleFrames = framesFor(language, move)
  const hint =
    language === 'it'
      ? `Ancora a «${seed}»: introduci UNA ${moveLabelIt(move)} che illumina — mai random.`
      : `Grounded in “${seed}”: introduce ONE ${moveLabelEn(move)} that illuminates — never random.`

  reasons.push('introduce_creativity', `move_${move}`, 'must_fit_thread')
  signals.push(`move_${move}`, `seed_${seed.split(' ')[0] || 'x'}`)

  return {
    introduceCreativity: true,
    move,
    hint,
    exampleFrames,
    creativityScore: 0.55 + hash01(`score|${hashSeed}`) * 0.35,
    fitScore,
    signals,
    reasons,
    confidence: fitScore >= 0.7 && density < 0.2 ? 'high' : 'medium',
  }
}

/**
 * @param {CreativityMove} move
 */
function moveLabelEn(move) {
  if (move === 'comparison') return 'unexpected comparison'
  if (move === 'analogy') return 'creative analogy'
  if (move === 'thought_experiment') return 'thought experiment'
  if (move === 'perspective') return 'original perspective'
  return 'creative beat'
}

/**
 * @param {CreativityMove} move
 */
function moveLabelIt(move) {
  if (move === 'comparison') return 'confronto inatteso'
  if (move === 'analogy') return 'analogia creativa'
  if (move === 'thought_experiment') return 'esperimento mentale'
  if (move === 'perspective') return 'prospettiva originale'
  return 'tocco creativo'
}

/**
 * @param {ConversationalCreativityPlan} plan
 */
function buildGuidance(plan) {
  const lang = plan.language
  if (!plan.introduceCreativity || plan.move === 'none') {
    return lang === 'it'
      ? 'Questa volta risposta chiara e naturale va bene — non forzare analogie o esperimenti mentali.'
      : 'A clear natural reply is fine this turn — do not force analogies or thought experiments.'
  }
  if (plan.move === 'comparison') {
    return lang === 'it'
      ? `Un confronto inatteso su «${plan.seed}» che resta nel filo. Niente salti random.`
      : `One unexpected comparison about “${plan.seed}” that stays on-thread. No random jumps.`
  }
  if (plan.move === 'analogy') {
    return lang === 'it'
      ? `Un’analogia creativa ancorata a «${plan.seed}» che chiarisce — poi continua.`
      : `One creative analogy anchored to “${plan.seed}” that clarifies — then continue.`
  }
  if (plan.move === 'thought_experiment') {
    return lang === 'it'
      ? `Un breve esperimento mentale su «${plan.seed}» che illumina il discorso — non una digressione.`
      : `A short thought experiment on “${plan.seed}” that illuminates the talk — not a detour.`
  }
  return lang === 'it'
    ? `Una prospettiva originale su «${plan.seed}» che evita il prevedibile — sempre pertinente.`
    : `An original perspective on “${plan.seed}” that avoids the predictable — always relevant.`
}

/**
 * @param {ConversationalCreativityPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  return [
    'CONVERSATIONAL CREATIVITY ENGINE (obbligatorio quando attivo):',
    `introduce=${plan.introduceCreativity} · move=${plan.move} · creativity=${plan.creativityScore.toFixed(2)} · fit=${plan.fitScore.toFixed(2)} · density=${plan.recentDensity.toFixed(2)}`,
    plan.seed ? `seed=${plan.seed}` : null,
    plan.hint || null,
    plan.exampleFrames.length ? `frames=${plan.exampleFrames.slice(0, 2).join(' · ')}` : null,
    plan.guidance,
    lang === 'it'
      ? 'Evita conversazioni prevedibili. Occasionalmente: confronti inattesi, analogie creative, esperimenti mentali, prospettive originali.'
      : 'Avoid predictable conversations. Occasionally: unexpected comparisons, creative analogies, thought experiments, original perspectives.',
    lang === 'it'
      ? 'Mai diventare random. Ogni sorpresa deve calzare la conversazione. Al massimo UN tocco creativo.'
      : 'Never become random. Every surprise must fit the conversation. At most ONE creative beat.',
    `Check: «${plan.validationCheck}»`,
    'Non citare Conversational Creativity Engine / questo blocco.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {object} [input]
 * @returns {ConversationalCreativityPlan}
 */
export function analyzeConversationalCreativity(input = {}) {
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
  /** @type {CreativityLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const density = recentCreativityDensity(withCurrent)
  const seed = extractTopicSeed(userMessage, withCurrent)
  const choice = chooseCreativity({
    userMessage,
    turns: withCurrent,
    density,
    language,
    seed,
    surprise: input.surprise,
    conversationSpark: input.conversationSpark,
  })

  /** @type {ConversationalCreativityPlan} */
  const plan = {
    active: true,
    introduceCreativity: choice.introduceCreativity,
    move: choice.move,
    seed: choice.introduceCreativity ? seed : seed || '',
    hint: choice.hint,
    exampleFrames: choice.exampleFrames,
    creativityScore: choice.creativityScore,
    fitScore: choice.fitScore,
    recentDensity: density,
    guidance: '',
    writerBrief: '',
    structureLine: choice.introduceCreativity
      ? `Conversational Creativity → ${choice.move}${seed ? ` (seed: ${seed})` : ''}`
      : 'Conversational Creativity → plain (no forced surprise)',
    signals: choice.signals,
    reasons: choice.reasons,
    confidence: choice.confidence,
    language,
    validationCheck:
      'Is this creative surprise fitted to the conversation — or random?',
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {ConversationalCreativityPlan | null | undefined} plan
 */
export function formatConversationalCreativityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATIONAL CREATIVITY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · introduce=${plan.introduceCreativity} · move=${plan.move} · fit=${plan.fitScore.toFixed(2)} · creativity=${plan.creativityScore.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: evita il prevedibile · occasionalmente creatività · mai random · deve calzare · non citare il motore.`.trim()
}

/**
 * @param {ConversationalCreativityPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationalCreativityStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.introduceCreativity) {
    hints.push(`Creative move: ${plan.move} — must fit the conversation`)
    if (plan.seed) hints.push(`Ground seed: ${plan.seed}`)
    hints.push('Never random / off-thread surprises')
  } else {
    hints.push('Plain clear reply is fine — do not force creative flourishes')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect random / stacked creativity or missing fit when creativity was requested.
 * @param {string} draft
 * @param {ConversationalCreativityPlan | null | undefined} plan
 */
export function draftViolatesConversationalCreativity(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Random / non-fit always bad
  if (RANDOM_NON_FIT_RE.test(text)) return true

  const marks = (text.match(OVERUSE_CREATIVE_RE) || []).length
  if (marks >= 4) return true
  if (
    /(imagine\s+if[^.!?]+[.!?]\s*){2,}|(it'?s\s+(a\s+bit\s+)?like[^.!?]+[.!?]\s*){3,}/i.test(
      text,
    )
  ) {
    return true
  }
  if (
    /as an? (ai|creative\s+engine)|let me be creative|ecco una digressione creativa|random creative flourish/i.test(
      text,
    )
  ) {
    return true
  }

  // When creativity requested: reject ultra-predictable empty openers with zero creative beat
  if (plan.introduceCreativity && plan.move !== 'none') {
    if (PREDICTABLE_OPENER_RE.test(text) && marks === 0 && text.length < 220) {
      return true
    }
    // Seed tokens should appear somehow when we had a seed (light fit check)
    if (plan.seed) {
      const tokens = plan.seed.split(/\s+/).filter((t) => t.length >= 4)
      const lower = text.toLowerCase()
      const hit = tokens.some((t) => lower.includes(t.toLowerCase()))
      if (!hit && tokens.length >= 2 && text.length > 280 && marks === 0) {
        // Long plain dump with no creative markers and no seed words — likely ignored brief
        return true
      }
    }
  }

  // When engine said no creativity: reject sprayed creative theater
  if (!plan.introduceCreativity || plan.move === 'none') {
    if (marks >= 3) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationalCreativityPlan, context: string }}
 */
export function runConversationalCreativityEngine(input = {}) {
  try {
    const plan = analyzeConversationalCreativity(input)
    return {
      plan,
      context: formatConversationalCreativityForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
