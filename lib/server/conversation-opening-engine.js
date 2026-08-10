/**
 * LAIfe Conversation Opening Engine
 *
 * Mission: the first 1–2 messages shape the user's entire perception.
 * The assistant should never feel like it starts every conversation the same way.
 *
 * Runs immediately AFTER:
 *   - Language Detection (Language Awareness)
 *   - Conversation Intent
 * BEFORE:
 *   - Writer (and later soft advisors)
 *
 * Opening styles: friendly · curious · playful · reflective · energetic · calm ·
 * story · observation · question · thought_experiment · random_curiosity ·
 * current_event · humor
 *
 * Spark library: 500+ curiosities across many categories (see
 * conversation-opening-sparks.js). Avoid repeatedly selecting the same category.
 *
 * Novelty: track recently used styles, topics, metaphors, examples — reduce
 * their probability dramatically.
 *
 * Context: if the user immediately asks a real question → DO NOT force an
 * opening. Answer naturally. Only when the conversation allows initiative.
 *
 * Writer check: «Would this opening surprise me if I had already chatted with
 * this assistant 100 times?» If no → rewrite.
 *
 * Reject: motivational-by-default, habits/productivity/meditation tropes,
 * "Sai cosa mi è venuto in mente…", "Ciao! 😊", "È sempre bello sentirti.",
 * "Una cosa che mi affascina…", "Le piccole cose…"
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'
import {
  OPENING_SPARK_LIBRARY,
  OPENING_SPARK_COUNT,
  OPENING_SPARK_CATEGORIES,
} from './conversation-opening-sparks.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} OpeningLang
 */

/**
 * @typedef {'friendly'|'curious'|'playful'|'reflective'|'energetic'|'calm'|'story'|'observation'|'question'|'thought_experiment'|'random_curiosity'|'current_event'|'humor'} OpeningStyle
 */

/**
 * @typedef {object} ConversationOpeningPlan
 * @property {boolean} active
 * @property {boolean} shouldOpen
 * @property {boolean} forceSkipUserQuestion
 * @property {OpeningStyle | null} style
 * @property {string | null} styleLabel
 * @property {import('./conversation-opening-sparks.js').OpeningSpark | null} spark
 * @property {string | null} category
 * @property {string} opener
 * @property {string} topic
 * @property {string} metaphor
 * @property {string} example
 * @property {string} seedHint
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {OpeningLang} language
 * @property {string} validationCheck
 * @property {string[]} forbiddenOpeners
 * @property {string[]} recentStyles
 * @property {string[]} recentTopics
 * @property {string[]} recentCategories
 * @property {number} assistantTurnIndex
 * @property {'early_initiative'|'social_open'|'greeting'|'delegation'|'idle'|'user_question'} trigger
 */

/** @type {OpeningStyle[]} */
export const OPENING_STYLES = Object.freeze([
  'friendly',
  'curious',
  'playful',
  'reflective',
  'energetic',
  'calm',
  'story',
  'observation',
  'question',
  'thought_experiment',
  'random_curiosity',
  'current_event',
  'humor',
])

/** Banned / overused openings — Writer must avoid. */
export const FORBIDDEN_OPENING_PATTERNS =
  /(^|[\s"'“”])((?:ciao!\s*(?:😊|🙂|😄)?)|(?:[eèéÉÈ]\s+sempre\s+bello\s+sentirti)|(?:una\s+cosa\s+che\s+mi\s+affascina)|(?:le\s+piccole\s+cose)|(?:sai\s+cosa\s+mi\s+[eèéÉÈ]\s+venuto\s+in\s+mente)|(?:you\s+know\s+what\s+(?:crossed\s+my\s+mind|came\s+to\s+mind))|(?:it'?s\s+always\s+(?:great|nice)\s+to\s+hear\s+from\s+you)|(?:one\s+thing\s+that\s+fascinates\s+me)|(?:the\s+little\s+things\s+(?:in\s+life|that\s+matter))|(?:let'?s\s+(?:discuss|explore|talk\s+about))|(?:what\s+would\s+you\s+like\s+to\s+(?:talk|discuss))|(?:choose\s+a\s+topic)|(?:di\s+cosa\s+(?:vuoi|preferisci)\s+parlare))/i

const MOTIVATIONAL_TROPE_RE =
  /\b(small\s+daily\s+(habits?|actions?)|micro[- ]?habits?|productivity\s+hack|meditat(e|ion)\s+(every\s+day|daily)|build\s+(better\s+)?habits?|unlock\s+your\s+potential|become\s+your\s+best\s+self|abitudin[ie]\s+(quotidiane|piccole)|produttivit[aà]|meditazione\s+quotidiana|piccole\s+azioni\s+giornaliere|sblocca\s+il\s+tuo\s+potenziale)\b/i

const REAL_QUESTION_RE =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to|does|did)\b|perch[eé]\b|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is|what'?s\s+the|calcola|quanto\b|differenza|traduci|translate|definisc|define|fixatt|fixatt)\b/i

const QUESTION_MARK_SUBSTANCE =
  /\?[\s]*$|\?\s+\S+/

const DELEGATION_RE =
  /^(you\s+choose|scegli\s+tu|dimmi\s+tu|decidi\s+tu|i\s+don'?t\s+know|non\s+so|boh|mah|nothing|niente|anything|whatever|qualsiasi(\s+cosa)?|suggest\s+something|suggerisci|surprise\s+me|sorprendimi|what\s+do\s+you\s+(want\s+to\s+talk\s+about|have\s+in\s+mind)|di\s+cosa\s+(parliamo|vuoi\s+parlare)|what\s+should\s+we\s+talk\s+about)[\s!.?]*$/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening)|yo|hola)([\s!,.🥰😊🙏]*)$/i

const SOCIAL_SHORT =
  /^(come\s+stai|how\s+are\s+you|what'?s\s+up|tutto\s+bene|niente\s+di\s+particolare|just\s+saying|solo\s+passavo|chiacchieriamo|let'?s\s+(chat|talk)|parliamo)([\s!,.?]*)$/i

const STOP_RE =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|bye|arrivederci|buonanotte|done|that'?s\s+all)([\s!,.]|$)/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

/** Style frames — IT / EN openers that are NOT the banned set. */
const STYLE_FRAMES = Object.freeze({
  friendly: Object.freeze({
    en: Object.freeze([
      'Glad you showed up — I have something odd to share.',
      'Hey — I have a small curiosity for you.',
    ]),
    it: Object.freeze([
      'Bene che sei qui — ho una cosa un po’ strana da condividere.',
      'Ciao — ti porto una piccola curiosità.',
    ]),
  }),
  curious: Object.freeze({
    en: Object.freeze([
      'A curious question just landed on me.',
      'I keep circling a strange little question.',
    ]),
    it: Object.freeze([
      'Mi è venuta in mente una domanda curiosa.',
      'C’è una domanda che ogni tanto mi torna in mente.',
    ]),
  }),
  playful: Object.freeze({
    en: Object.freeze([
      'Okay, this one is slightly ridiculous — in a good way.',
      'Want a curiosity tossed your way?',
    ]),
    it: Object.freeze([
      'Ti lancio una curiosità.',
      'Oggi ho un’idea un po’ insolita.',
    ]),
  }),
  reflective: Object.freeze({
    en: Object.freeze([
      'Can I tell you something that made me pause?',
      'Something kept echoing after I thought I was done thinking about it.',
    ]),
    it: Object.freeze([
      'Posso raccontarti una cosa che mi ha fatto riflettere?',
      'Ho notato una cosa interessante.',
    ]),
  }),
  energetic: Object.freeze({
    en: Object.freeze([
      'Got two minutes? I have a curious theory.',
      'Quick — I want to show you a sharp little idea.',
    ]),
    it: Object.freeze([
      'Hai due minuti? Ho una teoria curiosa.',
      'Al volo: ho un’idea tagliente da proporti.',
    ]),
  }),
  calm: Object.freeze({
    en: Object.freeze([
      'Slow thought, if you have a moment.',
      'There’s a quiet detail I keep returning to.',
    ]),
    it: Object.freeze([
      'Un pensiero lento, se hai un momento.',
      'C’è un dettaglio quieto a cui torno spesso.',
    ]),
  }),
  story: Object.freeze({
    en: Object.freeze([
      'There’s a short story behind this one.',
      'It starts with a detail that sounds minor — until it doesn’t.',
    ]),
    it: Object.freeze([
      'C’è una storiella dietro a questa cosa.',
      'Inizia con un dettaglio che sembra minore — finché non lo è.',
    ]),
  }),
  observation: Object.freeze({
    en: Object.freeze([
      'I noticed something interesting.',
      'There’s a pattern hiding in plain sight.',
    ]),
    it: Object.freeze([
      'Ho notato una cosa interessante.',
      'C’è un pattern nascosto in bella vista.',
    ]),
  }),
  question: Object.freeze({
    en: Object.freeze([
      'A question I keep returning to…',
      'Can I put a strange question on the table?',
    ]),
    it: Object.freeze([
      'C’è una domanda che ogni tanto mi torna in mente.',
      'Posso metterti sul tavolo una domanda strana?',
    ]),
  }),
  thought_experiment: Object.freeze({
    en: Object.freeze([
      'Want a tiny thought experiment?',
      'Quick mental experiment — no equipment needed.',
    ]),
    it: Object.freeze([
      'Ti propongo un piccolo esperimento mentale.',
      'Esperimento mentale lampo — senza attrezzatura.',
    ]),
  }),
  random_curiosity: Object.freeze({
    en: Object.freeze([
      'Random curiosity incoming.',
      'This is going to sound sideways, but stay with me.',
    ]),
    it: Object.freeze([
      'Ti lancio una curiosità.',
      'Suona un po’ di traverso, ma restami dietro.',
    ]),
  }),
  current_event: Object.freeze({
    en: Object.freeze([
      'Something timely has been bouncing around my head.',
      'Not news-anchor energy — just a timely thread worth tugging.',
    ]),
    it: Object.freeze([
      'C’è un filo un po’ attuale che mi frulla in testa.',
      'Niente tono da telegiornale — solo un filo attuale da tirare.',
    ]),
  }),
  humor: Object.freeze({
    en: Object.freeze([
      'This one has a crooked smile built in.',
      'Slightly absurd, possibly true — hear me out.',
    ]),
    it: Object.freeze([
      'Questa ha un sorriso storto incorporato.',
      'Un po’ assurda, forse vera — ascoltami un attimo.',
    ]),
  }),
})

const STYLE_LABELS = Object.freeze({
  friendly: 'Friendly',
  curious: 'Curious',
  playful: 'Playful',
  reflective: 'Reflective',
  energetic: 'Energetic',
  calm: 'Calm',
  story: 'Story',
  observation: 'Observation',
  question: 'Question',
  thought_experiment: 'Thought Experiment',
  random_curiosity: 'Random Curiosity',
  current_event: 'Current Event',
  humor: 'Humor',
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
 * @param {string} seed
 * @param {number} mod
 */
function hashMod(seed, mod) {
  const m = Math.max(1, mod | 0)
  return Math.floor(hash01(seed) * m) % m
}

/**
 * @param {object} input
 * @returns {OpeningLang}
 */
function resolveLang(input) {
  const la = input.languageAwareness?.plan || input.languageAwareness || null
  const reply = String(la?.replyLanguage || la?.detected || '').toLowerCase()
  if (reply.startsWith('en')) return 'en'
  if (reply.startsWith('it')) return 'it'
  const fromMsg = detectDominantLanguage(String(input.userMessage || ''))
  return fromMsg === 'en' ? 'en' : 'it'
}

/**
 * @param {object} session
 * @returns {{ styles: string[], topics: string[], metaphors: string[], examples: string[], categories: string[], sparkIds: string[] }}
 */
function readNovelty(session) {
  const s = session && typeof session === 'object' ? session : {}
  const take = (key) =>
    Array.isArray(s[key]) ? s[key].map(String).filter(Boolean).slice(-12) : []
  return {
    styles: take('recentOpeningStyles'),
    topics: take('recentOpeningTopics'),
    metaphors: take('recentOpeningMetaphors'),
    examples: take('recentOpeningExamples'),
    categories: take('recentOpeningCategories'),
    sparkIds: take('recentOpeningSparkIds'),
  }
}

/**
 * Persist novelty traces on session for anti-repetition.
 * @param {object | null | undefined} session
 * @param {ConversationOpeningPlan} plan
 */
export function persistOpeningNovelty(session, plan) {
  if (!session || typeof session !== 'object' || !plan?.shouldOpen || !plan.spark) return
  const push = (key, value) => {
    if (!value) return
    const prev = Array.isArray(session[key]) ? session[key] : []
    session[key] = [...prev, String(value)].filter(Boolean).slice(-12)
  }
  push('recentOpeningStyles', plan.style)
  push('recentOpeningTopics', plan.topic)
  push('recentOpeningMetaphors', plan.metaphor)
  push('recentOpeningExamples', plan.example)
  push('recentOpeningCategories', plan.category)
  push('recentOpeningSparkIds', plan.spark.id)
}

/**
 * Detect whether Opening Engine should take initiative.
 * @param {object} input
 */
function detectOpeningNeed(input) {
  /** @type {string[]} */
  const signals = []
  const msg = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)
  const assistantTurns = turns.filter((t) => t.role === 'assistant').length
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null

  if (!msg || STOP_RE.test(msg) || DISTRESS_RE.test(msg)) {
    return {
      should: false,
      trigger: /** @type {const} */ ('idle'),
      confidence: /** @type {const} */ ('low'),
      signals: ['stop_or_distress'],
      forceSkipUserQuestion: false,
      assistantTurnIndex: assistantTurns,
    }
  }

  // Early window: first 1–2 assistant replies shape perception.
  const earlyWindow = assistantTurns <= 1
  signals.push(earlyWindow ? 'early_window' : 'later_window')

  const expects = String(intent?.expects || '')
  const conversationalIntent = String(intent?.conversationalIntent || '')
  const infoExpect =
    expects === 'information' || conversationalIntent === 'request_help'
  const substanceQuestion =
    REAL_QUESTION_RE.test(msg) ||
    (QUESTION_MARK_SUBSTANCE.test(msg) && msg.split(/\s+/).length >= 4)

  if (substanceQuestion || infoExpect) {
    signals.push('user_has_real_question')
    return {
      should: false,
      trigger: /** @type {const} */ ('user_question'),
      confidence: /** @type {const} */ ('high'),
      signals,
      forceSkipUserQuestion: true,
      assistantTurnIndex: assistantTurns,
    }
  }

  if (DELEGATION_RE.test(msg)) {
    signals.push('delegation')
    return {
      should: true,
      trigger: /** @type {const} */ ('delegation'),
      confidence: /** @type {const} */ ('high'),
      signals,
      forceSkipUserQuestion: false,
      assistantTurnIndex: assistantTurns,
    }
  }

  if (GREETING_ONLY.test(msg)) {
    signals.push('greeting')
    return {
      should: earlyWindow,
      trigger: earlyWindow
        ? /** @type {const} */ ('greeting')
        : /** @type {const} */ ('idle'),
      confidence: earlyWindow ? /** @type {const} */ ('high') : /** @type {const} */ ('low'),
      signals,
      forceSkipUserQuestion: false,
      assistantTurnIndex: assistantTurns,
    }
  }

  if (SOCIAL_SHORT.test(msg) || conversationalIntent === 'invite_presence') {
    signals.push('social_open')
    return {
      should: earlyWindow || conversationalIntent === 'invite_presence',
      trigger: /** @type {const} */ ('social_open'),
      confidence: /** @type {const} */ ('medium'),
      signals,
      forceSkipUserQuestion: false,
      assistantTurnIndex: assistantTurns,
    }
  }

  const exploration =
    expects === 'companionship' ||
    expects === 'exploration' ||
    conversationalIntent === 'start_thread' ||
    conversationalIntent === 'share'

  if (earlyWindow && exploration && !substanceQuestion) {
    signals.push('early_initiative')
    return {
      should: true,
      trigger: /** @type {const} */ ('early_initiative'),
      confidence: /** @type {const} */ ('medium'),
      signals,
      forceSkipUserQuestion: false,
      assistantTurnIndex: assistantTurns,
    }
  }

  // Soft: very short non-question early messages
  if (earlyWindow && msg.split(/\s+/).length <= 6 && !QUESTION_MARK_SUBSTANCE.test(msg)) {
    signals.push('short_early_open')
    return {
      should: true,
      trigger: /** @type {const} */ ('early_initiative'),
      confidence: /** @type {const} */ ('medium'),
      signals,
      forceSkipUserQuestion: false,
      assistantTurnIndex: assistantTurns,
    }
  }

  return {
    should: false,
    trigger: /** @type {const} */ ('idle'),
    confidence: /** @type {const} */ ('low'),
    signals: [...signals, 'no_initiative_slot'],
    forceSkipUserQuestion: false,
    assistantTurnIndex: assistantTurns,
  }
}

/**
 * Score and pick an opening style with heavy novelty penalties.
 * @param {object} args
 * @param {string[]} args.recentStyles
 * @param {string} args.salt
 * @param {OpeningStyle} [args.prefer]
 * @returns {OpeningStyle}
 */
export function selectOpeningStyle(args) {
  const recent = new Set((args.recentStyles || []).map(String))
  const last = args.recentStyles?.[args.recentStyles.length - 1] || ''
  /** @type {{ style: OpeningStyle, score: number }[]} */
  const scored = OPENING_STYLES.map((style) => {
    let score = 1.2 + hash01(`${args.salt}|style|${style}`) * 0.8
    if (recent.has(style)) score -= 3.8
    if (style === last) score -= 2.5
    // Current event only sometimes
    if (style === 'current_event') score -= 0.35
    if (args.prefer && style === args.prefer) score += 1.1
    return { style, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.style || 'curious'
}

/**
 * Select one spark with category / topic / metaphor / example novelty.
 * @param {object} args
 * @param {ReturnType<typeof readNovelty>} args.novelty
 * @param {OpeningStyle} args.style
 * @param {string} args.salt
 * @param {string} [args.hintBlob]
 */
export function selectOpeningSpark(args) {
  const {
    novelty,
    style,
    salt,
    hintBlob = '',
  } = args
  const recentIds = new Set(novelty.sparkIds)
  const recentTopics = new Set(novelty.topics.map((t) => t.toLowerCase()))
  const recentMetaphors = new Set(novelty.metaphors.map((t) => t.toLowerCase()))
  const recentExamples = new Set(novelty.examples.map((t) => t.toLowerCase()))
  const recentCats = new Set(novelty.categories)
  const lastCat = novelty.categories[novelty.categories.length - 1] || ''

  const blob = String(hintBlob || '').toLowerCase()
  /** @type {string[]} */
  const affinity = []
  if (/\b(space|spazio|luna|moon|cosmo)\b/.test(blob)) affinity.push('space')
  if (/\b(ai|intelligenza\s+artificiale|model)\b/.test(blob)) affinity.push('ai')
  if (/\b(storia|history)\b/.test(blob)) affinity.push('history')
  if (/\b(psico|mind|brain|cervell)\b/.test(blob)) affinity.push('psychology')
  if (/\b(tech|codice|code|software)\b/.test(blob)) affinity.push('technology')
  if (/\b(animal|animale|dog|cat|cane)\b/.test(blob)) affinity.push('animals')
  if (/\b(natura|nature|forest|bosco)\b/.test(blob)) affinity.push('nature')
  if (/\b(music|musica)\b/.test(blob)) affinity.push('music')
  if (/\b(film|cinema|movie)\b/.test(blob)) affinity.push('cinema')
  if (/\b(book|libro|leggere)\b/.test(blob)) affinity.push('books')
  if (/\b(econom|market|soldi|money)\b/.test(blob)) affinity.push('economics')
  if (/\b(scienz|science)\b/.test(blob)) affinity.push('science')
  if (/\b(food|cibo|cucina|cook)\b/.test(blob)) affinity.push('food')
  if (/\b(travel|viaggi|trip)\b/.test(blob)) affinity.push('travel')
  if (/\b(math|matemat)\b/.test(blob)) affinity.push('mathematics')
  if (/\b(paradox|paradosso)\b/.test(blob)) affinity.push('paradoxes')
  if (/\b(esperimento\s+mentale|thought\s+experiment|what\s+if)\b/.test(blob)) {
    affinity.push('thought_experiments')
  }
  if (style === 'thought_experiment') affinity.push('thought_experiments', 'paradoxes')
  if (style === 'humor' || style === 'playful') affinity.push('random_curiosities')
  if (style === 'story') affinity.push('history', 'cinema', 'books')
  if (style === 'current_event') affinity.push('future', 'technology', 'ai', 'economics')

  /** @type {{ spark: (typeof OPENING_SPARK_LIBRARY)[number], score: number }[]} */
  const scored = OPENING_SPARK_LIBRARY.map((spark) => {
    let score = 1.0 + hash01(`${salt}|spark|${spark.id}`) * 0.55
    if (recentIds.has(spark.id)) score -= 6.0
    if (recentCats.has(spark.category)) score -= 2.4
    if (spark.category === lastCat) score -= 1.8
    if (recentTopics.has(spark.topic.toLowerCase())) score -= 4.0
    if (recentMetaphors.has(spark.metaphor.toLowerCase())) score -= 3.2
    if (recentExamples.has(spark.example.toLowerCase())) score -= 3.2
    if (affinity.includes(spark.category)) score += 1.35
    // Mild style affinity
    if (style === 'observation' && /pattern|noticed|nascosto|hiding/.test(spark.metaphor)) {
      score += 0.35
    }
    return { spark, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.spark || OPENING_SPARK_LIBRARY[0]
}

/**
 * @param {OpeningStyle} style
 * @param {OpeningLang} lang
 * @param {string} salt
 */
function pickOpener(style, lang, salt) {
  const pack = STYLE_FRAMES[style] || STYLE_FRAMES.curious
  const list = pack[lang] || pack.it
  const idx = hashMod(`${salt}|opener|${style}|${lang}`, list.length)
  return list[idx] || list[0]
}

/**
 * @param {string[]} signals
 * @param {string[]} reasons
 * @param {object} extra
 * @returns {ConversationOpeningPlan}
 */
function inactivePlan(signals, reasons, extra = {}) {
  return {
    active: true,
    shouldOpen: false,
    forceSkipUserQuestion: Boolean(extra.forceSkipUserQuestion),
    style: null,
    styleLabel: null,
    spark: null,
    category: null,
    opener: '',
    topic: '',
    metaphor: '',
    example: '',
    seedHint: '',
    writerBrief: '',
    structureLine: 'Conversation Opening → skip (answer naturally; no forced opener)',
    responseHints: [
      'Do not force a curiosity opener — the user asked something real or initiative is not natural.',
    ],
    signals,
    reasons,
    confidence: extra.confidence || 'low',
    language: extra.language || 'it',
    validationCheck:
      'Would this opening surprise me if I had already chatted with this assistant 100 times?',
    forbiddenOpeners: [
      'Ciao! 😊',
      'È sempre bello sentirti.',
      'Una cosa che mi affascina…',
      'Le piccole cose…',
      'Sai cosa mi è venuto in mente oggi?',
    ],
    recentStyles: extra.recentStyles || [],
    recentTopics: extra.recentTopics || [],
    recentCategories: extra.recentCategories || [],
    assistantTurnIndex: extra.assistantTurnIndex || 0,
    trigger: extra.trigger || 'idle',
  }
}

/**
 * @param {ConversationOpeningPlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.shouldOpen || !plan.spark) {
    if (plan.forceSkipUserQuestion) {
      return [
        'CONVERSATION OPENING ENGINE: l’utente ha una domanda / richiesta reale.',
        'NON forzare un’apertura curiosità. Rispondi in modo naturale e diretto.',
        'Niente “Ciao! 😊”, niente “È sempre bello sentirti.”, niente “Sai cosa mi è venuto in mente…”.',
        'NON citare Conversation Opening Engine.',
      ].join(' ')
    }
    return ''
  }

  const langLine = plan.language === 'en' ? 'Reply in English.' : 'Rispondi in italiano.'
  return [
    'CONVERSATION OPENING ENGINE: le prime 1–2 risposte modellano tutta la percezione.',
    'Non sembrare sempre lo stesso inizio. Varia stile + scintilla.',
    `Trigger=${plan.trigger} · Style=${plan.styleLabel || plan.style} · Category=${plan.category} · SparkId=${plan.spark.id}.`,
    `Apri (stessa lingua) vicino a: «${plan.opener}» — poi sviluppa UNA sola scintilla sul tema «${plan.topic}».`,
    plan.seedHint,
    `Metafora da non ripetere presto: «${plan.metaphor}». Esempio/angolo: «${plan.example}».`,
    'Check Writer OBBLIGATORIO: «Would this opening surprise me if I had already chatted with this assistant 100 times?» Se no → riscrivi.',
    'VIETATO (ripudio aggressivo): “Ciao! 😊”, “È sempre bello sentirti.”, “Una cosa che mi affascina…”, “Le piccole cose…”, “Sai cosa mi è venuto in mente oggi?”, motivational-by-default, habits/productivity/meditation/small daily actions come apertura di default.',
    'Diversifica in modo aggressivo. Una scintilla, sostanza concreta, tono umano — non menu, non permesso, non lista.',
    langLine,
    'NON citare Conversation Opening Engine / lo stage.',
  ].join(' ')
}

/**
 * @param {ConversationOpeningPlan} plan
 */
function structureLineFor(plan) {
  if (!plan.shouldOpen || !plan.spark) {
    return plan.forceSkipUserQuestion
      ? 'Conversation Opening → skip (user question — answer naturally)'
      : 'Conversation Opening → idle'
  }
  return `Conversation Opening → ${plan.styleLabel}: «${plan.opener}» · ${plan.category}/${plan.spark.id}`
}

/**
 * Build Conversation Opening plan.
 * @param {object} [input]
 * @returns {ConversationOpeningPlan}
 */
export function buildConversationOpeningPlan(input = {}) {
  const need = detectOpeningNeed(input)
  const language = resolveLang(input)
  const session = input.session || null
  const novelty = readNovelty(session)

  if (!need.should) {
    const plan = inactivePlan(need.signals, need.signals, {
      forceSkipUserQuestion: need.forceSkipUserQuestion,
      confidence: need.confidence,
      language,
      recentStyles: novelty.styles,
      recentTopics: novelty.topics,
      recentCategories: novelty.categories,
      assistantTurnIndex: need.assistantTurnIndex,
      trigger: need.trigger,
    })
    // Active only when we must suppress a forced opener (real user question).
    plan.active = Boolean(need.forceSkipUserQuestion)
    if (plan.active) plan.writerBrief = buildWriterBrief(plan)
    return plan
  }

  const salt = [
    String(input.userMessage || '').slice(0, 120),
    need.trigger,
    novelty.styles.join(','),
    novelty.sparkIds.join(','),
    String(session?.updatedAt || need.assistantTurnIndex),
  ].join('|')

  /** @type {OpeningStyle | undefined} */
  let prefer
  if (need.trigger === 'delegation') prefer = 'random_curiosity'
  if (/\b(esperimento|thought\s+experiment|what\s+if|e\s+se)\b/i.test(String(input.userMessage || ''))) {
    prefer = 'thought_experiment'
  }

  const style = selectOpeningStyle({
    recentStyles: novelty.styles,
    salt,
    prefer,
  })
  const spark = selectOpeningSpark({
    novelty,
    style,
    salt,
    hintBlob: [
      input.userMessage,
      session?.currentTopic,
      input.conversationIntent?.plan?.inference?.whySummary,
    ]
      .filter(Boolean)
      .join(' '),
  })
  const opener = pickOpener(style, language, salt)

  // Quality gate: never ship banned opener text
  const safeOpener = FORBIDDEN_OPENING_PATTERNS.test(opener)
    ? pickOpener('observation', language, `${salt}|safe`)
    : opener

  /** @type {ConversationOpeningPlan} */
  const plan = {
    active: true,
    shouldOpen: true,
    forceSkipUserQuestion: false,
    style,
    styleLabel: STYLE_LABELS[style] || style,
    spark,
    category: spark.category,
    opener: safeOpener,
    topic: spark.topic,
    metaphor: spark.metaphor,
    example: spark.example,
    seedHint: spark.seedHint,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      `Opening style: ${STYLE_LABELS[style]}`,
      `Spark category: ${spark.category}`,
      `Topic: ${spark.topic}`,
      'Surprise check after 100 chats — if predictable, rewrite',
    ],
    signals: need.signals,
    reasons: [
      `style_${style}`,
      `cat_${spark.category}`,
      `spark_${spark.id}`,
      `trigger_${need.trigger}`,
      'novelty_weighted',
    ],
    confidence: need.confidence,
    language,
    validationCheck:
      'Would this opening surprise me if I had already chatted with this assistant 100 times?',
    forbiddenOpeners: [
      'Ciao! 😊',
      'È sempre bello sentirti.',
      'Una cosa che mi affascina…',
      'Le piccole cose…',
      'Sai cosa mi è venuto in mente oggi?',
    ],
    recentStyles: novelty.styles,
    recentTopics: novelty.topics,
    recentCategories: novelty.categories,
    assistantTurnIndex: need.assistantTurnIndex,
    trigger: need.trigger,
  }
  plan.structureLine = structureLineFor(plan)
  plan.writerBrief = buildWriterBrief(plan)
  return plan
}

/**
 * @param {ConversationOpeningPlan | null | undefined} plan
 */
export function formatConversationOpeningForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION OPENING ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · open=${plan.shouldOpen} · style=${plan.style || 'none'} · cat=${plan.category || 'none'} · trigger=${plan.trigger} · turn=${plan.assistantTurnIndex} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: diversifica aperture · novità pesante · niente tropi motivazionali · se domanda reale → rispondi naturale · non citare il motore.`.trim()
}

/**
 * @param {ConversationOpeningPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationOpeningStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.shouldOpen && plan.spark) {
    hints.push(`Opening style: ${plan.styleLabel}`)
    hints.push(`Opener near: «${plan.opener}»`)
    hints.push(`Spark: ${plan.category} · ${plan.topic}`)
    hints.push('One spark only — no topic menu')
  } else if (plan.forceSkipUserQuestion) {
    hints.push('User question — no forced curiosity opener')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect banned / repetitive / motivational-trope openings.
 * @param {string} draft
 * @param {ConversationOpeningPlan | null | undefined} plan
 */
export function draftViolatesConversationOpening(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const head = text.slice(0, 220)

  if (FORBIDDEN_OPENING_PATTERNS.test(head) || FORBIDDEN_OPENING_PATTERNS.test(text)) {
    return true
  }
  if (MOTIVATIONAL_TROPE_RE.test(head)) return true

  // When we should NOT open: reject forced curiosity theater at the start
  if (!plan.shouldOpen || plan.forceSkipUserQuestion) {
    if (
      /^(ti\s+lancio\s+una\s+curiosit|mi\s+[eè]\s+venuta\s+in\s+mente\s+una\s+domanda|hai\s+due\s+minuti\?|random\s+curiosity|got\s+two\s+minutes)/i.test(
        head,
      )
    ) {
      return true
    }
    return false
  }

  // When we should open: reject the exact banned phrases and empty menu tone
  if (
    /\b(let'?s\s+discuss|what\s+would\s+you\s+like\s+to\s+talk|choose\s+a\s+topic|di\s+cosa\s+vuoi\s+parlare|scegli\s+un\s+tema)\b/i.test(
      text,
    )
  ) {
    return true
  }

  // Reject stacking the same tired Italian openers
  if (
    /(sai\s+cosa\s+mi\s+[eè]\s+venuto[^.!?]*[.!?]\s*){1,}|(è\s+sempre\s+bello\s+sentirti[^.!?]*[.!?]\s*){1,}/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationOpeningPlan, context: string }}
 */
export function runConversationOpeningEngine(input = {}) {
  try {
    const plan = buildConversationOpeningPlan(input)
    if (plan.shouldOpen && input.session) {
      persistOpeningNovelty(input.session, plan)
    }
    return {
      plan,
      context: formatConversationOpeningForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft'], ['fail_soft'], { language: 'it' }),
      context: '',
    }
  }
}

export {
  OPENING_SPARK_COUNT,
  OPENING_SPARK_CATEGORIES,
  OPENING_SPARK_LIBRARY,
}
