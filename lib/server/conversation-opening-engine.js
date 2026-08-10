/**
 * LAIfe Conversation Opening Engine (Useful Conversation Openings)
 *
 * Mission: when the assistant starts a conversation, the opening should create
 * immediate value. The user should think: "Interesting." / "I didn't know that."
 * / "That's useful." / "Tell me more."
 *
 * Never generate empty philosophical statements or generic motivational thoughts.
 *
 * Priority order — every opening must satisfy at least one:
 *   1. Useful  2. Interesting  3. Surprising  4. Thought-provoking  5. Practical
 * If none apply → do not generate the opening.
 *
 * Preferred types: science · psychology · AI · space · health/nutrition ·
 * technology · history · economics · productivity (occasionally) · human
 * behaviour · language · engineering · philosophy (only when original) ·
 * future · strange-but-true · common misconceptions.
 *
 * Runs immediately AFTER Language Detection + Conversation Intent, BEFORE Writer.
 *
 * Novelty: previous opening topics / facts / themes — prefer novelty.
 * Personalization: recurring interests from prior conversation → prioritize;
 * otherwise maximize diversity.
 *
 * Conversation goal: invite further talk — end with curiosity, not a conclusion.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'
import {
  OPENING_SPARK_LIBRARY,
  OPENING_SPARK_COUNT,
  OPENING_SPARK_CATEGORIES,
  OPENING_VALUE_KINDS,
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
 * @property {string[]} recentFacts
 * @property {string[]} recentThemes
 * @property {string | null} valueKind
 * @property {string[]} valueKinds
 * @property {string} fact
 * @property {string} curiosityHook
 * @property {string | null} theme
 * @property {boolean} personalized
 * @property {string[]} interestHints
 * @property {number} assistantTurnIndex
 * @property {'early_initiative'|'social_open'|'greeting'|'delegation'|'idle'|'user_question'|'no_value'} trigger
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

/** Empty philosophy / generic motivational — never ship as an opening. */
export const EMPTY_PHILOSOPHY_RE =
  /\b(the\s+little\s+things\s+in\s+life\s+matter|it'?s\s+fascinating\s+how\s+our\s+daily\s+choices|sometimes\s+routines\s+can\s+change\s+everything|life\s+is\s+made\s+of\s+small\s+moments|le\s+piccole\s+cose\s+(della\s+vita\s+)?contano|le\s+nostre\s+scelte\s+quotidiane|a\s+volte\s+le\s+routine\s+possono\s+cambiare|la\s+vita\s+[eè]\s+fatta\s+di\s+piccoli\s+momenti|ogni\s+giorno\s+[eè]\s+un\s+regalo|be\s+present\s+in\s+the\s+moment|vivi\s+il\s+momento|everything\s+happens\s+for\s+a\s+reason)\b/i

/** Priority order for opening value. */
export const OPENING_VALUE_PRIORITY = Object.freeze([
  'useful',
  'interesting',
  'surprising',
  'thought_provoking',
  'practical',
])

/** Preferred opening type → spark categories (productivity occasional). */
const PREFERRED_TYPE_CATEGORIES = Object.freeze({
  science: Object.freeze(['science', 'space', 'animals', 'nature']),
  psychology: Object.freeze(['psychology', 'human_behavior']),
  ai: Object.freeze(['ai']),
  space: Object.freeze(['space']),
  health_nutrition: Object.freeze(['food', 'science']),
  technology: Object.freeze(['technology', 'ai']),
  history: Object.freeze(['history']),
  economics: Object.freeze(['economics']),
  productivity: Object.freeze(['creativity', 'human_behavior', 'psychology']),
  human_behaviour: Object.freeze(['human_behavior', 'psychology', 'relationships']),
  language: Object.freeze(['language']),
  engineering: Object.freeze(['technology', 'architecture', 'mathematics']),
  philosophy_original: Object.freeze(['thought_experiments', 'paradoxes']),
  future: Object.freeze(['future', 'ai', 'space']),
  strange_true: Object.freeze(['random_curiosities', 'animals', 'science', 'paradoxes']),
  misconceptions: Object.freeze(['psychology', 'science', 'history', 'economics']),
})

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
 * @returns {{ styles: string[], topics: string[], metaphors: string[], examples: string[], categories: string[], sparkIds: string[], facts: string[], themes: string[] }}
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
    facts: take('recentOpeningFacts'),
    themes: take('recentOpeningThemes'),
  }
}

/**
 * Infer recurring interests from session / memory map / messages / preference profile.
 * @param {object} input
 * @returns {string[]} category affinity list
 */
export function inferOpeningInterests(input = {}) {
  /** @type {Map<string, number>} */
  const scores = new Map()
  const bump = (cat, w = 1) => {
    if (!cat) return
    scores.set(cat, (scores.get(cat) || 0) + w)
  }

  const map = input.conversationMemoryMap?.map || input.conversationMemoryMap || null
  const explored = [
    ...(Array.isArray(map?.exploredTopics) ? map.exploredTopics : []),
    map?.activeTopic,
    input.session?.currentTopic,
    input.session?.knowledgeTopic,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const pref = input.conversationPreferenceProfile || input.preferenceProfile || null
  const prefBlob = [
    pref?.topics,
    pref?.likedTopics,
    pref?.interests,
    Array.isArray(pref?.topicBias) ? pref.topicBias.join(' ') : '',
  ]
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const turns = asTurns(input.messages)
  const historyBlob = turns
    .filter((t) => t.role === 'user')
    .slice(-12)
    .map((t) => t.content)
    .join(' ')
    .toLowerCase()

  const blob = `${explored} ${prefBlob} ${historyBlob} ${String(input.userMessage || '').toLowerCase()}`

  if (/\b(space|spazio|luna|moon|mars|cosmo|nasa|astronaut)\b/.test(blob)) bump('space', 2)
  if (/\b(ai|llm|intelligenza\s+artificiale|machine\s+learning|gpt|model(?:li)?)\b/.test(blob)) bump('ai', 2.2)
  if (/\b(storia|history|ancient|antico|guerra|empire)\b/.test(blob)) bump('history', 1.8)
  if (/\b(psico|psychology|cervell|brain|habit|abitud|emozion|anxiety|ansia)\b/.test(blob)) {
    bump('psychology', 2)
    bump('human_behavior', 1.2)
  }
  if (/\b(tech|codice|code|software|engineering|ingegner|hardware)\b/.test(blob)) {
    bump('technology', 2)
    bump('architecture', 0.6)
  }
  if (/\b(animal|animale|octopus|polpo|dog|cat|wildlife)\b/.test(blob)) bump('animals', 1.8)
  if (/\b(natura|nature|climate|clima|forest|bosco)\b/.test(blob)) bump('nature', 1.4)
  if (/\b(music|musica|song|canzone)\b/.test(blob)) bump('music', 1.4)
  if (/\b(film|cinema|movie)\b/.test(blob)) bump('cinema', 1.2)
  if (/\b(book|libro|novel|romanzo|leggere)\b/.test(blob)) bump('books', 1.2)
  if (/\b(econom|market|inflazione|inflation|soldi|money|finanza)\b/.test(blob)) bump('economics', 1.8)
  if (/\b(scienz|science|fisica|physics|biolog|chimic)\b/.test(blob)) bump('science', 2)
  if (/\b(food|cibo|nutriz|nutrition|health|salute|dieta)\b/.test(blob)) {
    bump('food', 1.8)
    bump('science', 0.8)
  }
  if (/\b(travel|viaggi|trip|city|citt[aà])\b/.test(blob)) bump('travel', 1.2)
  if (/\b(math|matemat|geometr)\b/.test(blob)) bump('mathematics', 1.5)
  if (/\b(lingu|language|etimolog|grammar|grammatic)\b/.test(blob)) bump('language', 1.8)
  if (/\b(futur|future|2030|prediction|prevision)\b/.test(blob)) bump('future', 1.6)
  if (/\b(relazion|relationship|amicizia|friendship|coppia)\b/.test(blob)) bump('relationships', 1.4)
  if (/\b(creativ|design|arte|art\b|scrittura|writing)\b/.test(blob)) bump('creativity', 1.3)
  if (/\b(paradox|paradosso|thought\s+experiment|esperimento\s+mentale)\b/.test(blob)) {
    bump('paradoxes', 1.5)
    bump('thought_experiments', 1.5)
  }
  if (/\b(produttiv|productivity|focus|deep\s+work)\b/.test(blob)) {
    bump('psychology', 1.0)
    bump('human_behavior', 1.0)
    bump('creativity', 0.6)
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat)
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
  push('recentOpeningFacts', plan.fact)
  push('recentOpeningThemes', plan.theme || plan.spark.theme)
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
 * Pick the highest-priority value kind present on a spark.
 * @param {string[]} kinds
 * @returns {string | null}
 */
export function pickPrimaryValueKind(kinds) {
  const set = new Set((kinds || []).map(String))
  for (const k of OPENING_VALUE_PRIORITY) {
    if (set.has(k)) return k
  }
  return null
}

/**
 * Select one useful spark: must carry value; novelty + personalization weighted.
 * Returns null when no spark satisfies the value priority order.
 * @param {object} args
 * @param {ReturnType<typeof readNovelty>} args.novelty
 * @param {OpeningStyle} args.style
 * @param {string} args.salt
 * @param {string} [args.hintBlob]
 * @param {string[]} [args.interestCategories]
 * @returns {{ spark: (typeof OPENING_SPARK_LIBRARY)[number], valueKind: string, personalized: boolean } | null}
 */
export function selectOpeningSpark(args) {
  const {
    novelty,
    style,
    salt,
    hintBlob = '',
    interestCategories = [],
  } = args
  const recentIds = new Set(novelty.sparkIds)
  const recentTopics = new Set(novelty.topics.map((t) => t.toLowerCase()))
  const recentMetaphors = new Set(novelty.metaphors.map((t) => t.toLowerCase()))
  const recentExamples = new Set(novelty.examples.map((t) => t.toLowerCase()))
  const recentFacts = new Set((novelty.facts || []).map((t) => t.toLowerCase()))
  const recentThemes = new Set((novelty.themes || []).map((t) => t.toLowerCase()))
  const recentCats = new Set(novelty.categories)
  const lastCat = novelty.categories[novelty.categories.length - 1] || ''
  const interestSet = new Set(interestCategories)
  const personalized = interestSet.size > 0

  const blob = String(hintBlob || '').toLowerCase()
  /** @type {string[]} */
  const affinity = [...interestCategories]
  if (/\b(space|spazio|luna|moon|cosmo)\b/.test(blob)) affinity.push('space')
  if (/\b(ai|intelligenza\s+artificiale|model)\b/.test(blob)) affinity.push('ai')
  if (/\b(storia|history)\b/.test(blob)) affinity.push('history')
  if (/\b(psico|mind|brain|cervell)\b/.test(blob)) affinity.push('psychology')
  if (/\b(tech|codice|code|software|engineering)\b/.test(blob)) affinity.push('technology')
  if (/\b(animal|animale|dog|cat|cane|octopus|polpo)\b/.test(blob)) affinity.push('animals')
  if (/\b(scienz|science|health|salute|nutriz)\b/.test(blob)) affinity.push('science', 'food')
  if (/\b(econom|market|soldi|money)\b/.test(blob)) affinity.push('economics')
  if (/\b(lingu|language)\b/.test(blob)) affinity.push('language')
  if (/\b(futur|future)\b/.test(blob)) affinity.push('future')
  if (/\b(misconception|falso\s+mito|myth)\b/.test(blob)) {
    affinity.push('psychology', 'science', 'history')
  }
  if (style === 'thought_experiment') affinity.push('thought_experiments', 'paradoxes')
  if (style === 'humor' || style === 'playful') affinity.push('random_curiosities', 'animals')
  if (style === 'story') affinity.push('history', 'science')
  if (style === 'current_event') affinity.push('future', 'technology', 'ai', 'economics')

  // Preferred-type soft boosts (productivity only occasionally)
  const allowProductivity = hash01(`${salt}|productivity`) > 0.78
  /** @type {Set<string>} */
  const preferredCats = new Set()
  for (const [type, cats] of Object.entries(PREFERRED_TYPE_CATEGORIES)) {
    if (type === 'productivity' && !allowProductivity) continue
    for (const c of cats) preferredCats.add(c)
  }

  /** @type {{ spark: (typeof OPENING_SPARK_LIBRARY)[number], score: number, valueKind: string }[]} */
  const scored = []
  for (const spark of OPENING_SPARK_LIBRARY) {
    const valueKind = pickPrimaryValueKind(spark.valueKinds || [])
    if (!valueKind) continue // Priority rule: no value → ineligible

    // Philosophy only when original
    if (
      (spark.category === 'thought_experiments' || spark.category === 'paradoxes') &&
      spark.originalOnly === false
    ) {
      continue
    }

    let score = 1.0 + hash01(`${salt}|spark|${spark.id}`) * 0.45
    score += Number(spark.valueScore || 0.7) * 0.8

    // Value priority weighting
    const vIdx = OPENING_VALUE_PRIORITY.indexOf(valueKind)
    score += (OPENING_VALUE_PRIORITY.length - Math.max(0, vIdx)) * 0.22

    if (recentIds.has(spark.id)) score -= 6.5
    if (recentCats.has(spark.category)) score -= 2.6
    if (spark.category === lastCat) score -= 2.0
    if (recentTopics.has(String(spark.topic || '').toLowerCase())) score -= 4.2
    if (recentMetaphors.has(String(spark.metaphor || '').toLowerCase())) score -= 3.2
    if (recentExamples.has(String(spark.example || '').toLowerCase())) score -= 3.2
    if (recentFacts.has(String(spark.factEn || '').toLowerCase())) score -= 5.0
    if (recentFacts.has(String(spark.factIt || '').toLowerCase())) score -= 5.0
    if (recentThemes.has(String(spark.theme || '').toLowerCase())) score -= 3.5

    if (affinity.includes(spark.category)) score += personalized ? 2.1 : 1.25
    if (interestSet.has(spark.category)) score += 1.6
    if (preferredCats.has(spark.category)) score += 0.55

    // Occasional productivity: soft penalty unless explicitly interested
    if (
      (spark.preferredTypes || []).includes('productivity') &&
      !allowProductivity &&
      !interestSet.has('psychology') &&
      !interestSet.has('human_behavior')
    ) {
      score -= 1.2
    }

    // Prefer concrete high-value handcrafted facts
    if (Number(spark.valueScore || 0) >= 0.95) score += 0.9

    scored.push({ spark, score, valueKind })
  }

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score < 0.35) return null
  return {
    spark: best.spark,
    valueKind: best.valueKind,
    personalized,
  }
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
    structureLine: 'Conversation Opening → skip (no empty philosophy; answer naturally)',
    responseHints: [
      'Do not force an opener — either the user asked something real, or no useful/interesting/surprising/thought-provoking/practical value was available.',
    ],
    signals,
    reasons,
    confidence: extra.confidence || 'low',
    language: extra.language || 'it',
    validationCheck:
      'Does this opening create immediate value (useful / interesting / surprising / thought-provoking / practical) — not empty philosophy?',
    forbiddenOpeners: [
      'Ciao! 😊',
      'È sempre bello sentirti.',
      'Una cosa che mi affascina…',
      'Le piccole cose…',
      'Sai cosa mi è venuto in mente oggi?',
      'The little things in life matter.',
      "It's fascinating how our daily choices affect us.",
      'Sometimes routines can change everything.',
      'Life is made of small moments.',
    ],
    recentStyles: extra.recentStyles || [],
    recentTopics: extra.recentTopics || [],
    recentCategories: extra.recentCategories || [],
    recentFacts: extra.recentFacts || [],
    recentThemes: extra.recentThemes || [],
    valueKind: null,
    valueKinds: [],
    fact: '',
    curiosityHook: '',
    theme: null,
    personalized: false,
    interestHints: extra.interestHints || [],
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
        'CONVERSATION OPENING ENGINE (USEFUL): l’utente ha una domanda / richiesta reale.',
        'NON forzare un’apertura. Rispondi in modo naturale e diretto.',
        'Niente filosofia vuota, niente “Le piccole cose…”, niente motivazionale generico.',
        'NON citare Conversation Opening Engine.',
      ].join(' ')
    }
    if (plan.trigger === 'no_value') {
      return [
        'CONVERSATION OPENING ENGINE (USEFUL): nessun opening con valore utile/interessante/sorprendente/stimolante/pratico disponibile.',
        'NON generare un’apertura vuota. Continua naturalmente senza filler filosofico.',
        'NON citare Conversation Opening Engine.',
      ].join(' ')
    }
    return ''
  }

  const langLine = plan.language === 'en' ? 'Reply in English.' : 'Rispondi in italiano.'
  return [
    'CONVERSATION OPENING ENGINE (USEFUL): l’apertura deve creare valore immediato.',
    'L’utente dovrebbe pensare: “Interesting.” / “I didn’t know that.” / “That’s useful.” / “Tell me more.”',
    `ValueKind=${plan.valueKind} · Style=${plan.styleLabel || plan.style} · Category=${plan.category} · SparkId=${plan.spark.id}${plan.personalized ? ' · PERSONALIZED' : ''}.`,
    `Apri con il FATTO concreto (stessa lingua): «${plan.fact}»`,
    `Poi invita la conversazione con curiosità (non concludere): «${plan.curiosityHook}»`,
    'Struttura: fatto concreto → un dettaglio utile → gancio di curiosità. NON un lecture. NON una conclusione.',
    plan.seedHint,
    'Check OBBLIGATORIO: «Does this create immediate value (useful/interesting/surprising/thought-provoking/practical)?» Se no → non aprire / riscrivi.',
    'VIETATO: “The little things in life matter.” / “It’s fascinating how our daily choices affect us.” / “Sometimes routines can change everything.” / “Life is made of small moments.” / “Ciao! 😊” / “È sempre bello sentirti.” / “Una cosa che mi affascina…” / “Le piccole cose…” / “Sai cosa mi è venuto in mente…” / filosofia vuota / motivazionale generico.',
    'Priorità valore: Useful > Interesting > Surprising > Thought-provoking > Practical.',
    langLine,
    'NON citare Conversation Opening Engine / Useful Opening / lo stage.',
  ].join(' ')
}

/**
 * @param {ConversationOpeningPlan} plan
 */
function structureLineFor(plan) {
  if (!plan.shouldOpen || !plan.spark) {
    if (plan.forceSkipUserQuestion) {
      return 'Conversation Opening → skip (user question — answer naturally)'
    }
    if (plan.trigger === 'no_value') {
      return 'Conversation Opening → skip (no useful/interesting/surprising/practical value)'
    }
    return 'Conversation Opening → idle'
  }
  return `Conversation Opening → ${plan.valueKind}: «${String(plan.fact || '').slice(0, 72)}…» · ${plan.category}/${plan.spark.id}`
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
  const interestHints = inferOpeningInterests(input)

  if (!need.should) {
    const plan = inactivePlan(need.signals, need.signals, {
      forceSkipUserQuestion: need.forceSkipUserQuestion,
      confidence: need.confidence,
      language,
      recentStyles: novelty.styles,
      recentTopics: novelty.topics,
      recentCategories: novelty.categories,
      recentFacts: novelty.facts,
      recentThemes: novelty.themes,
      interestHints,
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
    novelty.facts.join(','),
    interestHints.join(','),
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
  const picked = selectOpeningSpark({
    novelty,
    style,
    salt,
    interestCategories: interestHints,
    hintBlob: [
      input.userMessage,
      session?.currentTopic,
      input.conversationIntent?.plan?.inference?.whySummary,
      interestHints.join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  })

  // Priority rule: if no useful/interesting/surprising/thought-provoking/practical value → do not open
  if (!picked?.spark || !picked.valueKind) {
    const plan = inactivePlan(
      [...need.signals, 'no_value_kind'],
      ['no_value_opening', 'priority_gate'],
      {
        forceSkipUserQuestion: false,
        confidence: 'high',
        language,
        recentStyles: novelty.styles,
        recentTopics: novelty.topics,
        recentCategories: novelty.categories,
        recentFacts: novelty.facts,
        recentThemes: novelty.themes,
        interestHints,
        assistantTurnIndex: need.assistantTurnIndex,
        trigger: 'no_value',
      },
    )
    plan.active = true
    plan.writerBrief = buildWriterBrief(plan)
    plan.structureLine = structureLineFor(plan)
    return plan
  }

  const spark = picked.spark
  const fact = language === 'en' ? spark.factEn : spark.factIt
  const curiosityHook = language === 'en' ? spark.curiosityEn : spark.curiosityIt
  const opener = pickOpener(style, language, salt)

  // Quality gate: never ship banned / empty-philosophy opener text
  let safeOpener = opener
  if (
    FORBIDDEN_OPENING_PATTERNS.test(opener) ||
    EMPTY_PHILOSOPHY_RE.test(opener) ||
    MOTIVATIONAL_TROPE_RE.test(opener)
  ) {
    safeOpener = pickOpener('observation', language, `${salt}|safe`)
  }
  // Prefer leading with the concrete fact as the true opening signal
  if (fact && !EMPTY_PHILOSOPHY_RE.test(fact)) {
    safeOpener = fact
  }

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
      `Value: ${picked.valueKind}`,
      `Concrete fact first`,
      `End with curiosity — not a conclusion`,
      `Topic: ${spark.topic}`,
    ],
    signals: [
      ...need.signals,
      `value_${picked.valueKind}`,
      picked.personalized ? 'personalized' : 'diversity_max',
    ],
    reasons: [
      `value_${picked.valueKind}`,
      `style_${style}`,
      `cat_${spark.category}`,
      `spark_${spark.id}`,
      `trigger_${need.trigger}`,
      picked.personalized ? 'personalized_interests' : 'maximize_diversity',
      'novelty_weighted',
    ],
    confidence: need.confidence,
    language,
    validationCheck:
      'Does this opening create immediate value (useful / interesting / surprising / thought-provoking / practical) — not empty philosophy?',
    forbiddenOpeners: [
      'Ciao! 😊',
      'È sempre bello sentirti.',
      'Una cosa che mi affascina…',
      'Le piccole cose…',
      'Sai cosa mi è venuto in mente oggi?',
      'The little things in life matter.',
      "It's fascinating how our daily choices affect us.",
      'Sometimes routines can change everything.',
      'Life is made of small moments.',
    ],
    recentStyles: novelty.styles,
    recentTopics: novelty.topics,
    recentCategories: novelty.categories,
    recentFacts: novelty.facts,
    recentThemes: novelty.themes,
    valueKind: picked.valueKind,
    valueKinds: Array.isArray(spark.valueKinds) ? spark.valueKinds : [picked.valueKind],
    fact: fact || '',
    curiosityHook: curiosityHook || '',
    theme: spark.theme || null,
    personalized: Boolean(picked.personalized),
    interestHints,
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
CONVERSATION OPENING ENGINE — USEFUL (INVISIBILE)
══════════════════════════════════════
Active=yes · open=${plan.shouldOpen} · value=${plan.valueKind || 'none'} · style=${plan.style || 'none'} · cat=${plan.category || 'none'} · trigger=${plan.trigger} · personalized=${plan.personalized ? 'yes' : 'no'} · turn=${plan.assistantTurnIndex} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: valore immediato (useful/interesting/surprising/thought-provoking/practical) · fatto concreto · chiudi con curiosità · novità su topic/fatti/temi · personalizza se ci sono interessi · niente filosofia vuota · se domanda reale → naturale · non citare il motore.`.trim()
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
    hints.push(`Value kind: ${plan.valueKind}`)
    hints.push(`Concrete fact: «${String(plan.fact || '').slice(0, 100)}»`)
    hints.push(`Curiosity hook (end): «${plan.curiosityHook}»`)
    hints.push('Invite conversation — do not lecture or conclude')
  } else if (plan.forceSkipUserQuestion) {
    hints.push('User question — no forced curiosity opener')
  } else if (plan.trigger === 'no_value') {
    hints.push('No value-qualified opening — stay natural')
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

  const head = text.slice(0, 280)

  if (FORBIDDEN_OPENING_PATTERNS.test(head) || FORBIDDEN_OPENING_PATTERNS.test(text)) {
    return true
  }
  if (MOTIVATIONAL_TROPE_RE.test(head)) return true
  if (EMPTY_PHILOSOPHY_RE.test(head) || EMPTY_PHILOSOPHY_RE.test(text)) return true

  // When we should NOT open: reject forced curiosity theater / empty openers
  if (!plan.shouldOpen || plan.forceSkipUserQuestion || plan.trigger === 'no_value') {
    if (
      /^(ti\s+lancio\s+una\s+curiosit|mi\s+[eè]\s+venuta\s+in\s+mente\s+una\s+domanda|hai\s+due\s+minuti\?|random\s+curiosity|got\s+two\s+minutes|the\s+little\s+things|le\s+piccole\s+cose)/i.test(
        head,
      )
    ) {
      return true
    }
    return false
  }

  // When we should open: reject menu tone + empty philosophy + pure conclusion with no invite
  if (
    /\b(let'?s\s+discuss|what\s+would\s+you\s+like\s+to\s+talk|choose\s+a\s+topic|di\s+cosa\s+vuoi\s+parlare|scegli\s+un\s+tema)\b/i.test(
      text,
    )
  ) {
    return true
  }

  if (
    /(sai\s+cosa\s+mi\s+[eè]\s+venuto[^.!?]*[.!?]\s*){1,}|(è\s+sempre\s+bello\s+sentirti[^.!?]*[.!?]\s*){1,}/i.test(
      text,
    )
  ) {
    return true
  }

  // Require some concrete texture (number, named effect, specific noun phrase) when opening
  const hasConcrete =
    /\d/.test(text) ||
    /\b(effect|effetto|because|perch[eé]|called|chiamat|hearts?|cuori|energy|energia|white|bianch|practical|pratic)\b/i.test(
      text,
    ) ||
    (plan.fact && text.toLowerCase().includes(String(plan.topic || '').toLowerCase().split(' ')[0] || '___never___'))
  if (!hasConcrete && text.length > 40) {
    // Soft: only flag if it also looks like empty vibe-speak
    if (/\b(fascinating|affascinante|beautiful|bellissimo|mindful|consapevol)\b/i.test(head)) {
      return true
    }
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
  OPENING_VALUE_KINDS,
}
