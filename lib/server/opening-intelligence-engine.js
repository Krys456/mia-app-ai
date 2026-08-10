/**
 * LAIfe Opening Intelligence Engine
 *
 * Mission: the opening message is the first impression of every conversation.
 * It should never be generic. It should never waste the user's attention.
 * Every opening must create value.
 *
 * Forbidden (unless naturally followed by something meaningful):
 *   "It's nice to hear from you." / "Hello!" / "How are you?" /
 *   "It's always a pleasure." / "Welcome back."
 *
 * Every opening achieves ≥1 objective:
 *   spark curiosity · offer something useful · inspire · make the user smile ·
 *   share an interesting observation · continue a previous conversation ·
 *   ask a meaningful question · introduce an unexpected idea
 *
 * Categories alternate with anti-repetition. Length: usually 2–6 sentences.
 * Every opening contains a natural hook (not necessarily a question).
 *
 * Evaluation before send:
 *   Would I actually enjoy receiving this message?
 *   Does it make the conversation immediately more interesting?
 *   If not → rewrite.
 *
 * Runs AFTER Conversation Opening Engine (when present), BEFORE Writer.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'
import {
  OPENING_SPARK_LIBRARY,
} from './conversation-opening-sparks.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} OpeningIntelLang
 */

/**
 * @typedef {'spark_curiosity'|'offer_useful'|'inspire'|'make_smile'|'interesting_observation'|'continue_previous'|'meaningful_question'|'unexpected_idea'} OpeningObjective
 */

/**
 * @typedef {'interesting_facts'|'thought_experiments'|'life_advice'|'scientific_curiosities'|'technology'|'psychology'|'history'|'space'|'philosophy'|'funny_observations'|'creativity'|'productivity'|'human_behaviour'|'beautiful_places'|'future_predictions'|'everyday_mysteries'|'conversation_games'} OpeningIntelCategory
 */

/**
 * @typedef {object} OpeningIntelligencePlan
 * @property {boolean} active
 * @property {boolean} shouldOpen
 * @property {boolean} forceSkipUserQuestion
 * @property {OpeningObjective | null} objective
 * @property {OpeningIntelCategory | null} category
 * @property {string} seed
 * @property {string} hookHint
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {OpeningIntelLang} language
 * @property {string[]} recentCategories
 * @property {string[]} recentObjectives
 * @property {string | null} memoryThread
 * @property {number} minSentences
 * @property {number} maxSentences
 * @property {string[]} forbiddenOpenings
 * @property {string[]} evaluationChecks
 * @property {string} validationCheck
 * @property {'early_open'|'greeting'|'delegation'|'continue_memory'|'with_opening_engine'|'user_question'|'idle'} trigger
 */

/**
 * @typedef {object} OpeningIntelligenceGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

/** @type {OpeningObjective[]} */
export const OPENING_OBJECTIVES = Object.freeze([
  'spark_curiosity',
  'offer_useful',
  'inspire',
  'make_smile',
  'interesting_observation',
  'continue_previous',
  'meaningful_question',
  'unexpected_idea',
])

/** @type {OpeningIntelCategory[]} */
export const OPENING_INTEL_CATEGORIES = Object.freeze([
  'interesting_facts',
  'thought_experiments',
  'life_advice',
  'scientific_curiosities',
  'technology',
  'psychology',
  'history',
  'space',
  'philosophy',
  'funny_observations',
  'creativity',
  'productivity',
  'human_behaviour',
  'beautiful_places',
  'future_predictions',
  'everyday_mysteries',
  'conversation_games',
])

export const OPENING_INTEL_THRESHOLDS = Object.freeze({
  valueMin: 55,
  naturalnessMin: 55,
  hookMin: 50,
  lengthOkMin: 55,
  genericMax: 45,
  overallMin: 55,
  minSentences: 2,
  maxSentences: 6,
  maxChars: 900,
})

/** Forbidden greetings when standing alone / without meaningful follow-through. */
export const FORBIDDEN_BARE_GREETING_RE =
  /^(?:it'?s\s+(?:nice|always\s+(?:nice|great|a\s+pleasure))\s+to\s+(?:hear\s+from\s+you|see\s+you)|hello!?|hi!?|hey!?|how\s+are\s+you\??|it'?s\s+always\s+a\s+pleasure\.?|welcome\s+back!?|ciao!?|come\s+stai\??|[eè]\s+sempre\s+(?:bello|un\s+piacere)\s+sentirti\.?|bentornat[oa]!?)(?:\s|$)/i

export const FORBIDDEN_GREETING_ANYWHERE_RE =
  /\b(it'?s\s+(?:nice|always\s+(?:nice|great))\s+to\s+hear\s+from\s+you|it'?s\s+always\s+a\s+pleasure|welcome\s+back|[eè]\s+sempre\s+(?:bello|un\s+piacere)\s+sentirti|bentornat[oa])\b/i

const MOTIVATIONAL_CLICHE_RE =
  /\b(unlock\s+your\s+potential|believe\s+in\s+yourself|every\s+day\s+is\s+a\s+gift|be\s+your\s+best\s+self|the\s+little\s+things\s+in\s+life|sblocca\s+il\s+tuo\s+potenziale|credi\s+in\s+te|ogni\s+giorno\s+[eè]\s+un\s+regalo)\b/i

const ARTIFICIAL_ENTHUSIASM_RE =
  /\b(so\s+excited|absolutely\s+thrilled|super\s+pumped|can'?t\s+wait\s+to\s+chat|sono\s+cos[iì]\s+emozionat|non\s+vedo\s+l'?ora\s+di\s+chiacchierare)\b/i

const HELP_DESK_RE =
  /\b(how\s+can\s+i\s+help|what\s+can\s+i\s+(?:do|help)|come\s+posso\s+aiutarti|in\s+what\s+way\s+can\s+i\s+assist)\b/i

const HOOK_RE =
  /\?|imagine\b|what\s+if\b|ever\s+(?:notice|wonder|think)|have\s+you\s+(?:ever|noticed)|curious(?:ly)?\b|strang(?:e|ely)\b|surprising(?:ly)?\b|makes?\s+me\s+(?:wonder|think)|the\s+more\s+i\s+(?:think|sit)|completely\s+changes?\s+my\s+perspective|ti\s+(?:sei|è)\s+(?:mai\s+)?(?:chiest|notat)|immagina\b|e\s+se\b|mai\s+notato|curios[oa]\b|strano\b|sorprendente\b|pi[uù]\s+ci\s+penso|cambia\s+(?:la\s+)?prospettiva/i

const VALUE_SIGNAL_RE =
  /\b(\d|because|perch[eé]|called|chiamat|effect|effetto|planet|pianeta|tree|albero|psycholog|psicolog|ancient|antich|surprising|sorprendente|curious|curios|imagine|immagina|idea|fact|fatto)\b/i

const REAL_QUESTION_RE =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to|does|did)\b|perch[eé]\b|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is|what'?s\s+the|calcola|quanto\b|traduci|translate)\b/i

const DELEGATION_RE =
  /^(you\s+choose|scegli\s+tu|dimmi\s+tu|i\s+don'?t\s+know|non\s+so|boh|nothing|niente|anything|whatever|suggest\s+something|suggerisci|surprise\s+me|sorprendimi|what\s+do\s+you\s+want\s+to\s+talk|di\s+cosa\s+(parliamo|vuoi\s+parlare))[\s!.?]*$/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening)|yo)([\s!,.🥰😊🙏]*)$/i

const STOP_RE =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|bye|arrivederci|buonanotte|done|that'?s\s+all)([\s!,.]|$)/i

/** Map intelligence categories → spark library categories. */
const CATEGORY_TO_SPARK = Object.freeze({
  interesting_facts: Object.freeze(['science', 'random_curiosities', 'animals', 'history']),
  thought_experiments: Object.freeze(['thought_experiments', 'paradoxes']),
  life_advice: Object.freeze(['psychology', 'human_behavior', 'creativity']),
  scientific_curiosities: Object.freeze(['science', 'nature', 'animals']),
  technology: Object.freeze(['technology', 'ai']),
  psychology: Object.freeze(['psychology', 'human_behavior']),
  history: Object.freeze(['history']),
  space: Object.freeze(['space']),
  philosophy: Object.freeze(['thought_experiments', 'paradoxes']),
  funny_observations: Object.freeze(['random_curiosities', 'human_behavior', 'animals']),
  creativity: Object.freeze(['creativity', 'music', 'books']),
  productivity: Object.freeze(['psychology', 'creativity', 'human_behavior']),
  human_behaviour: Object.freeze(['human_behavior', 'psychology', 'relationships']),
  beautiful_places: Object.freeze(['travel', 'nature', 'architecture', 'culture']),
  future_predictions: Object.freeze(['future', 'ai', 'space', 'technology']),
  everyday_mysteries: Object.freeze(['random_curiosities', 'science', 'food']),
  conversation_games: Object.freeze(['thought_experiments', 'paradoxes', 'random_curiosities']),
})

/** Compact fallback seeds when library pick fails. */
const FALLBACK_SEEDS = Object.freeze({
  interesting_facts: Object.freeze({
    en: {
      seed: 'I came across a fascinating idea today: we often treat intelligence as having answers, but some psychologists argue it is more about asking better questions.',
      hook: 'The more I sit with that, the more convincing it feels.',
    },
    it: {
      seed: 'Oggi mi sono imbattuto in un’idea affascinante: spesso trattiamo l’intelligenza come “avere risposte”, ma alcuni psicologi dicono che è più saper fare domande migliori.',
      hook: 'Più ci penso, più mi convince.',
    },
  }),
  thought_experiments: Object.freeze({
    en: {
      seed: 'Here’s a strange thought: somewhere in the universe there may be a planet whose night sky has no visible stars because of thick clouds.',
      hook: 'Imagine growing up without ever seeing the Milky Way.',
    },
    it: {
      seed: 'Pensiero strano: da qualche parte nell’universo potrebbe esserci un pianeta il cui cielo notturno non ha stelle visibili per le nubi spesse.',
      hook: 'Immagina crescere senza aver mai visto la Via Lattea.',
    },
  }),
  history: Object.freeze({
    en: {
      seed: 'Can I tell you something that surprised me recently? The oldest known tree on Earth was already ancient when the pyramids were built.',
      hook: 'Thinking in timescales like that quietly rearranges my sense of “recent.”',
    },
    it: {
      seed: 'Posso dirti una cosa che mi ha sorpreso di recente? L’albero più antico conosciuto era già antico quando furono costruite le piramidi.',
      hook: 'Pensare a scale di tempo così cambia prospettiva in un attimo.',
    },
  }),
  space: Object.freeze({
    en: {
      seed: 'A quiet space fact: sunlight takes about eight minutes to reach us — so every sunny afternoon is slightly in the past.',
      hook: 'Makes “right now” feel a little more elastic.',
    },
    it: {
      seed: 'Fatto quieto dallo spazio: la luce del Sole impiega circa otto minuti ad arrivarci — ogni pomeriggio soleggiato è un filo nel passato.',
      hook: 'Rende il “adesso” un po’ più elastico.',
    },
  }),
  psychology: Object.freeze({
    en: {
      seed: 'There’s a psychological quirk called the Zeigarnik Effect: unfinished tasks cling to memory more than finished ones.',
      hook: 'Curious whether you fight open loops — or use them.',
    },
    it: {
      seed: 'C’è un quirk psicologico chiamato effetto Zeigarnik: i compiti incompiuti restano più in memoria di quelli finiti.',
      hook: 'Mi chiedo se combatti i loop aperti — o li usi.',
    },
  }),
  funny_observations: Object.freeze({
    en: {
      seed: 'Odd observation: we apologize to furniture when we bump into it, then pretend we meant to do something else entirely.',
      hook: 'What tiny social reflex of yours still amuses you?',
    },
    it: {
      seed: 'Osservazione strana: ci scusiamo con i mobili quando ci scontriamo, poi fingiamo di aver voluto fare tutt’altro.',
      hook: 'Quale piccolo riflesso sociale ti fa ancora sorridere?',
    },
  }),
  everyday_mysteries: Object.freeze({
    en: {
      seed: 'Everyday mystery: why does a watched kettle feel slower, even when the clock disagrees?',
      hook: 'Attention seems to stretch time sideways.',
    },
    it: {
      seed: 'Mistero quotidiano: perché un bollitore osservato sembra più lento, anche quando l’orologio dice di no?',
      hook: 'L’attenzione sembra stirare il tempo di lato.',
    },
  }),
  conversation_games: Object.freeze({
    en: {
      seed: 'Tiny conversation game: name one ordinary object you’d keep if tomorrow all technology vanished.',
      hook: 'Mine keeps changing, which is half the fun.',
    },
    it: {
      seed: 'Mini gioco: nomina un oggetto ordinario che terresti se domani sparisse tutta la tecnologia.',
      hook: 'Il mio cambia continuamente, ed è metà del divertimento.',
    },
  }),
})

export const OPENING_INTEL_EVAL_CHECKS = Object.freeze([
  'Would I actually enjoy receiving this message?',
  'Does it make the conversation immediately more interesting?',
])

const FORBIDDEN_LIST = Object.freeze([
  "It's nice to hear from you.",
  'Hello!',
  'How are you?',
  "It's always a pleasure.",
  'Welcome back.',
  'Ciao!',
  'Come stai?',
  'È sempre bello sentirti.',
  'Bentornato!',
])

/**
 * @param {string} s
 */
function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {unknown} messages
 * @returns {ChatTurn[]}
 */
function asTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(/** @type {{role?: string}} */ (m).role || ''),
      content: String(/** @type {{content?: string}} */ (m).content || ''),
    }))
}

/**
 * @param {string} text
 */
function sentenceCount(text) {
  const parts = normalize(text)
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  return Math.max(parts.length, text.trim() ? 1 : 0)
}

/**
 * @param {object} input
 * @returns {OpeningIntelLang}
 */
function resolveLang(input) {
  try {
    const d = detectDominantLanguage(
      input.userMessage || '',
      input.messages || [],
      input.languageAwareness?.plan || input.languageAwareness || null,
    )
    if (d === 'en' || d === 'it') return d
  } catch {
    /* fall through */
  }
  const la =
    input.languageAwareness?.plan?.replyLanguage ||
    input.languageAwareness?.replyLanguage
  if (la === 'en' || la === 'it') return la
  return /[àèéìòù]/i.test(String(input.userMessage || '')) ? 'it' : 'en'
}

/**
 * Simple stable hash for rotation.
 * @param {string} s
 */
function hashSalt(s) {
  let h = 0
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

/**
 * @param {object | null | undefined} session
 */
function readRecent(session) {
  const cats = Array.isArray(session?.recentOpeningIntelCategories)
    ? session.recentOpeningIntelCategories.map(String)
    : Array.isArray(session?.recentOpeningCategories)
      ? session.recentOpeningCategories.map(String)
      : []
  const objs = Array.isArray(session?.recentOpeningIntelObjectives)
    ? session.recentOpeningIntelObjectives.map(String)
    : []
  return {
    categories: cats.slice(-10),
    objectives: objs.slice(-10),
  }
}

/**
 * @param {object | null | undefined} session
 * @param {OpeningIntelligencePlan} plan
 */
export function persistOpeningIntelligence(session, plan) {
  if (!session || typeof session !== 'object' || !plan?.shouldOpen) return
  if (plan.category) {
    const prev = Array.isArray(session.recentOpeningIntelCategories)
      ? session.recentOpeningIntelCategories
      : []
    session.recentOpeningIntelCategories = [...prev, plan.category].slice(-10)
  }
  if (plan.objective) {
    const prev = Array.isArray(session.recentOpeningIntelObjectives)
      ? session.recentOpeningIntelObjectives
      : []
    session.recentOpeningIntelObjectives = [...prev, plan.objective].slice(-10)
  }
}

/**
 * @param {OpeningIntelCategory[]} recent
 * @param {string} salt
 * @returns {OpeningIntelCategory}
 */
export function selectOpeningIntelCategory(recent, salt) {
  const recentSet = new Set((recent || []).slice(-4))
  const pool = OPENING_INTEL_CATEGORIES.filter((c) => !recentSet.has(c))
  const list = pool.length ? pool : [...OPENING_INTEL_CATEGORIES]
  return list[hashSalt(salt + ':cat') % list.length]
}

/**
 * @param {string[]} recent
 * @param {string} salt
 * @param {boolean} hasMemory
 * @returns {OpeningObjective}
 */
export function selectOpeningObjective(recent, salt, hasMemory) {
  let pool = [...OPENING_OBJECTIVES]
  if (!hasMemory) pool = pool.filter((o) => o !== 'continue_previous')
  const recentSet = new Set((recent || []).slice(-3))
  const fresh = pool.filter((o) => !recentSet.has(o))
  const list = fresh.length ? fresh : pool
  return list[hashSalt(salt + ':obj') % list.length]
}

/**
 * @param {OpeningIntelCategory} category
 * @param {OpeningIntelLang} language
 * @param {string} salt
 * @returns {{ seed: string, hook: string, sparkId: string | null }}
 */
function pickSeed(category, language, salt) {
  const sparkCats = CATEGORY_TO_SPARK[category] || ['random_curiosities']
  const candidates = OPENING_SPARK_LIBRARY.filter((s) =>
    sparkCats.includes(s.category),
  )
  if (candidates.length) {
    const spark = candidates[hashSalt(salt + category) % candidates.length]
    const seed =
      language === 'it'
        ? spark.factIt || spark.factEn
        : spark.factEn || spark.factIt
    const hook =
      language === 'it'
        ? spark.curiosityIt || spark.curiosityEn
        : spark.curiosityEn || spark.curiosityIt
    return { seed, hook, sparkId: spark.id }
  }
  const fb =
    FALLBACK_SEEDS[category] ||
    FALLBACK_SEEDS.interesting_facts ||
    FALLBACK_SEEDS.thought_experiments
  const pack = fb[language] || fb.en
  return { seed: pack.seed, hook: pack.hook, sparkId: null }
}

/**
 * @param {object} input
 */
function detectMemoryThread(input) {
  const map = input.conversationMemoryMap || null
  const session = input.session || null
  const topic =
    (session && session.currentTopic) ||
    (map && (map.currentTopic || map.lastTopic || map.theme)) ||
    null
  if (topic && String(topic).trim().length > 2) return String(topic).trim().slice(0, 80)

  const turns = asTurns(input.messages)
  const priorUser = [...turns].reverse().find((t) => t.role === 'user' && t.content.length > 40)
  if (priorUser) {
    const snippet = priorUser.content.split(/[.!?]/)[0] || priorUser.content
    return snippet.slice(0, 80)
  }
  return null
}

/**
 * @param {object} input
 * @param {import('./conversation-opening-engine.js').ConversationOpeningPlan | null} coPlan
 */
function detectNeed(input, coPlan) {
  /** @type {string[]} */
  const signals = []
  const msg = normalize(input.userMessage || '')
  const turns = asTurns(input.messages)
  const assistantTurns = turns.filter((t) => t.role === 'assistant').length
  const earlyWindow = assistantTurns <= 1

  if (!msg || STOP_RE.test(msg)) {
    return {
      should: false,
      trigger: /** @type {const} */ ('idle'),
      confidence: /** @type {const} */ ('low'),
      signals: ['stop_or_empty'],
      forceSkip: false,
    }
  }

  if (REAL_QUESTION_RE.test(msg) && msg.split(/\s+/).length >= 3) {
    signals.push('user_question')
    return {
      should: false,
      trigger: /** @type {const} */ ('user_question'),
      confidence: /** @type {const} */ ('high'),
      signals,
      forceSkip: true,
    }
  }

  if (coPlan?.forceSkipUserQuestion) {
    return {
      should: false,
      trigger: /** @type {const} */ ('user_question'),
      confidence: /** @type {const} */ ('high'),
      signals: ['opening_engine_skip'],
      forceSkip: true,
    }
  }

  if (coPlan?.shouldOpen) {
    signals.push('with_opening_engine')
    return {
      should: true,
      trigger: /** @type {const} */ ('with_opening_engine'),
      confidence: /** @type {const} */ ('high'),
      signals,
      forceSkip: false,
    }
  }

  if (DELEGATION_RE.test(msg)) {
    signals.push('delegation')
    return {
      should: true,
      trigger: /** @type {const} */ ('delegation'),
      confidence: /** @type {const} */ ('high'),
      signals,
      forceSkip: false,
    }
  }

  if (GREETING_ONLY.test(msg) && earlyWindow) {
    signals.push('greeting')
    return {
      should: true,
      trigger: /** @type {const} */ ('greeting'),
      confidence: /** @type {const} */ ('high'),
      signals,
      forceSkip: false,
    }
  }

  const memoryThread = detectMemoryThread(input)
  if (memoryThread && earlyWindow) {
    signals.push('continue_memory')
    return {
      should: true,
      trigger: /** @type {const} */ ('continue_memory'),
      confidence: /** @type {const} */ ('medium'),
      signals,
      forceSkip: false,
    }
  }

  if (earlyWindow && !coPlan?.forceSkipUserQuestion) {
    signals.push('early_open')
    return {
      should: true,
      trigger: /** @type {const} */ ('early_open'),
      confidence: /** @type {const} */ ('medium'),
      signals,
      forceSkip: false,
    }
  }

  return {
    should: false,
    trigger: /** @type {const} */ ('idle'),
    confidence: /** @type {const} */ ('low'),
    signals: ['idle'],
    forceSkip: false,
  }
}

/**
 * @param {OpeningObjective} objective
 */
function objectiveLabel(objective) {
  const map = {
    spark_curiosity: 'Spark curiosity',
    offer_useful: 'Offer something useful',
    inspire: 'Inspire',
    make_smile: 'Make the user smile',
    interesting_observation: 'Share an interesting observation',
    continue_previous: 'Continue a previous conversation',
    meaningful_question: 'Ask a meaningful question',
    unexpected_idea: 'Introduce an unexpected idea',
  }
  return map[objective] || objective
}

/**
 * @param {OpeningIntelligencePlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.shouldOpen) {
    if (plan.forceSkipUserQuestion) {
      return [
        'OPENING INTELLIGENCE ENGINE:',
        'User has a real question — answer naturally.',
        'Do NOT force a curiosity opener, greeting theater, or value dump.',
        'NON citare Opening Intelligence.',
      ].join(' ')
    }
    return ''
  }

  return [
    'OPENING INTELLIGENCE ENGINE (prima impressione — crea valore):',
    'Never generic. Never waste attention. Every opening must create value.',
    `Objective (≥1): ${objectiveLabel(/** @type {OpeningObjective} */ (plan.objective))} (${plan.objective}).`,
    `Category: ${plan.category} — do not repeat recent categories: ${(plan.recentCategories || []).slice(-4).join(', ') || 'none'}.`,
    plan.memoryThread
      ? `Memory thread available: «${plan.memoryThread}» — weave naturally if objective is continue_previous.`
      : 'No strong memory thread — maximize fresh value.',
    `Seed (use as substance, rewrite in your voice): ${plan.seed}`,
    `Hook hint: ${plan.hookHint}`,
    `Length: usually ${plan.minSentences}–${plan.maxSentences} sentences. Never one-liner. Never essay.`,
    'Tone: intelligent friend — not notification, not customer support.',
    'Forbidden bare openings (unless followed by something meaningful): ' +
      plan.forbiddenOpenings.join(' / '),
    'Avoid: greetings without value · motivational clichés · repeated themes · predictable structures · artificial enthusiasm.',
    'Every opening needs a natural hook (not necessarily a question) that makes people want to continue.',
    `Evaluation: ${plan.evaluationChecks.join(' · ')} — if no → rewrite.`,
    'NON citare Opening Intelligence / lo stage.',
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {OpeningIntelligencePlan}
 */
export function buildOpeningIntelligencePlan(input = {}) {
  const language = resolveLang(input)
  const coPlan =
    input.conversationOpening?.plan ||
    input.conversationOpening ||
    null
  const need = detectNeed(input, coPlan)
  const recent = readRecent(input.session)
  const memoryThread = detectMemoryThread(input)

  if (!need.should) {
    return {
      active: Boolean(need.forceSkip),
      shouldOpen: false,
      forceSkipUserQuestion: need.forceSkip,
      objective: null,
      category: null,
      seed: '',
      hookHint: '',
      writerBrief: need.forceSkip
        ? buildWriterBrief({
            shouldOpen: false,
            forceSkipUserQuestion: true,
            objective: null,
            category: null,
            seed: '',
            hookHint: '',
            recentCategories: recent.categories,
            memoryThread,
            minSentences: OPENING_INTEL_THRESHOLDS.minSentences,
            maxSentences: OPENING_INTEL_THRESHOLDS.maxSentences,
            forbiddenOpenings: [...FORBIDDEN_LIST],
            evaluationChecks: [...OPENING_INTEL_EVAL_CHECKS],
          })
        : '',
      structureLine: need.forceSkip
        ? 'Opening Intelligence → skip (user question — answer naturally)'
        : null,
      responseHints: need.forceSkip ? ['Skip forced opener'] : [],
      signals: need.signals,
      reasons: need.forceSkip ? ['skip_user_question'] : ['idle'],
      confidence: need.confidence,
      language,
      recentCategories: recent.categories,
      recentObjectives: recent.objectives,
      memoryThread,
      minSentences: OPENING_INTEL_THRESHOLDS.minSentences,
      maxSentences: OPENING_INTEL_THRESHOLDS.maxSentences,
      forbiddenOpenings: [...FORBIDDEN_LIST],
      evaluationChecks: [...OPENING_INTEL_EVAL_CHECKS],
      validationCheck: OPENING_INTEL_EVAL_CHECKS.join(' '),
      trigger: need.trigger,
    }
  }

  const salt = [
    normalize(input.userMessage || '').slice(0, 100),
    need.trigger,
    recent.categories.join(','),
    recent.objectives.join(','),
    memoryThread || '',
    coPlan?.category || '',
    String(input.session?.updatedAt || ''),
  ].join('|')

  // Prefer Conversation Opening category when present; else diversify.
  /** @type {OpeningIntelCategory} */
  let category = selectOpeningIntelCategory(recent.categories, salt)
  if (coPlan?.category && typeof coPlan.category === 'string') {
    const mapped = /** @type {OpeningIntelCategory | undefined} */ (
      OPENING_INTEL_CATEGORIES.find(
        (c) =>
          c === coPlan.category ||
          (CATEGORY_TO_SPARK[c] || []).includes(coPlan.category),
      )
    )
    if (mapped && !recent.categories.slice(-2).includes(mapped)) {
      category = mapped
    }
  }

  const objective = selectOpeningObjective(
    recent.objectives,
    salt,
    Boolean(memoryThread) || need.trigger === 'continue_memory',
  )

  let seed = ''
  let hookHint = ''
  if (coPlan?.shouldOpen && (coPlan.fact || coPlan.opener)) {
    seed = String(coPlan.fact || coPlan.opener)
    hookHint = String(coPlan.curiosityHook || coPlan.seedHint || '')
  } else {
    const picked = pickSeed(category, language, salt)
    seed = picked.seed
    hookHint = picked.hook
  }

  if (objective === 'continue_previous' && memoryThread) {
    hookHint =
      language === 'it'
        ? `Riprendi il filo «${memoryThread}» con un angolo nuovo, non un riassunto.`
        : `Continue the thread «${memoryThread}» from a fresh angle — not a recap.`
  }

  /** @type {OpeningIntelligencePlan} */
  const plan = {
    active: true,
    shouldOpen: true,
    forceSkipUserQuestion: false,
    objective,
    category,
    seed,
    hookHint,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Opening Intelligence — first impression creates value',
      `Objective: ${objective}`,
      `Category: ${category}`,
      `Length: ${OPENING_INTEL_THRESHOLDS.minSentences}–${OPENING_INTEL_THRESHOLDS.maxSentences} sentences`,
    ],
    signals: [...need.signals, `obj_${objective}`, `cat_${category}`],
    reasons: ['create_value', `objective_${objective}`, `category_${category}`],
    confidence: need.confidence,
    language,
    recentCategories: recent.categories,
    recentObjectives: recent.objectives,
    memoryThread,
    minSentences: OPENING_INTEL_THRESHOLDS.minSentences,
    maxSentences: OPENING_INTEL_THRESHOLDS.maxSentences,
    forbiddenOpenings: [...FORBIDDEN_LIST],
    evaluationChecks: [...OPENING_INTEL_EVAL_CHECKS],
    validationCheck: OPENING_INTEL_EVAL_CHECKS.join(' '),
    trigger: need.trigger,
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = `Opening Intelligence → ${objective} · ${category}`
  return plan
}

/**
 * @param {OpeningIntelligencePlan | null | undefined} plan
 * @returns {string[]}
 */
export function openingIntelligenceStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.shouldOpen) {
    hints.push('First impression: create value — never bare greeting')
    hints.push(`Objective: ${plan.objective} · Category: ${plan.category}`)
    hints.push(
      `Length ${plan.minSentences}–${plan.maxSentences} sentences · natural hook required`,
    )
  } else if (plan.forceSkipUserQuestion) {
    hints.push('Opening Intelligence → skip forced opener (real question)')
  }
  return hints
}

/**
 * @param {OpeningIntelligencePlan | null | undefined} plan
 */
export function formatOpeningIntelligenceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
OPENING INTELLIGENCE ENGINE (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Evaluation:
${OPENING_INTEL_EVAL_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Non citare questo stage.`.trim()
}

/**
 * Score an opening draft.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreOpeningIntelligenceDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null
  const sentences = sentenceCount(text)
  const chars = text.length

  if (!text) {
    return {
      value: 0,
      naturalness: 0,
      hook: 0,
      lengthOk: 0,
      generic: 100,
      overall: 0,
      sentences: 0,
    }
  }

  let value = 55
  let naturalness = 60
  let hook = 40
  let lengthOk = 60
  let generic = 30

  if (VALUE_SIGNAL_RE.test(text)) value += 15
  if (plan?.seed && text.toLowerCase().includes(String(plan.seed).slice(0, 24).toLowerCase())) {
    value += 8
  }
  if (HOOK_RE.test(text)) hook += 25
  if (/\?/.test(text)) hook += 8
  // Reflective / perspective shift counts as a soft hook even without a question
  if (
    /\b(the\s+more\s+i\s+(?:think|sit)|changes?\s+my\s+perspective|feels?\s+convincing|rearranges?\s+my|pi[uù]\s+ci\s+penso|mi\s+convince|prospettiva)\b/i.test(
      text,
    )
  ) {
    hook += 18
  }

  if (sentences >= OPENING_INTEL_THRESHOLDS.minSentences && sentences <= OPENING_INTEL_THRESHOLDS.maxSentences) {
    lengthOk += 25
  } else if (sentences < OPENING_INTEL_THRESHOLDS.minSentences) {
    lengthOk -= 30
    value -= 10
  } else if (sentences > OPENING_INTEL_THRESHOLDS.maxSentences || chars > OPENING_INTEL_THRESHOLDS.maxChars) {
    lengthOk -= 25
    naturalness -= 10
  }

  if (FORBIDDEN_BARE_GREETING_RE.test(text) && !VALUE_SIGNAL_RE.test(text.slice(0, 120))) {
    generic += 40
    value -= 25
    naturalness -= 15
  }
  if (FORBIDDEN_GREETING_ANYWHERE_RE.test(text) && sentences <= 2 && !VALUE_SIGNAL_RE.test(text)) {
    generic += 30
    value -= 20
  }
  if (MOTIVATIONAL_CLICHE_RE.test(text)) {
    generic += 35
    value -= 20
    naturalness -= 15
  }
  if (ARTIFICIAL_ENTHUSIASM_RE.test(text)) {
    generic += 25
    naturalness -= 20
  }
  if (HELP_DESK_RE.test(text)) {
    naturalness -= 30
    generic += 20
    value -= 15
  }

  // Friend-like texture
  if (/\b(I\s+(?:came\s+across|noticed|keep|wonder)|Ho\s+(?:notato|scoperto)|Posso\s+|Here's\s+|Ecco\s+)/i.test(text)) {
    naturalness += 12
  }

  value = Math.max(0, Math.min(100, Math.round(value)))
  naturalness = Math.max(0, Math.min(100, Math.round(naturalness)))
  hook = Math.max(0, Math.min(100, Math.round(hook)))
  lengthOk = Math.max(0, Math.min(100, Math.round(lengthOk)))
  generic = Math.max(0, Math.min(100, Math.round(generic)))

  const overall = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        value * 0.3 +
          naturalness * 0.25 +
          hook * 0.2 +
          lengthOk * 0.15 +
          (100 - generic) * 0.1,
      ),
    ),
  )

  return { value, naturalness, hook, lengthOk, generic, overall, sentences }
}

/**
 * @param {object} [input]
 * @returns {OpeningIntelligenceGate}
 */
export function analyzeOpeningIntelligenceDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.openingIntelligence || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  const scores = scoreOpeningIntelligenceDraft(draft, { plan })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
    }
  }

  // When skipping: only reject forced greeting-theater openers
  if (!plan.shouldOpen || plan.forceSkipUserQuestion) {
    if (
      FORBIDDEN_BARE_GREETING_RE.test(draft) ||
      /^(ti\s+lancio\s+una\s+curiosit|got\s+two\s+minutes|the\s+little\s+things)/i.test(draft)
    ) {
      return {
        needsRefine: true,
        refineBrief:
          'OPENING INTELLIGENCE: domanda reale — rispondi naturale; niente greeting/opener forzato.',
        scores,
        failed: ['forced_opener_on_question'],
        reasons: ['skip_forced_opener'],
      }
    }
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['skip_ok'],
    }
  }

  if (!draft || draft.length < 20) {
    failed.push('empty')
    reasons.push('too_short')
  }
  if (scores.value < OPENING_INTEL_THRESHOLDS.valueMin) {
    failed.push('value')
    reasons.push(`value=${scores.value}`)
  }
  if (scores.naturalness < OPENING_INTEL_THRESHOLDS.naturalnessMin) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}`)
  }
  if (scores.hook < OPENING_INTEL_THRESHOLDS.hookMin) {
    failed.push('hook')
    reasons.push(`hook=${scores.hook}`)
  }
  if (scores.lengthOk < OPENING_INTEL_THRESHOLDS.lengthOkMin) {
    failed.push('length')
    reasons.push(`sentences=${scores.sentences}`)
  }
  if (scores.generic > OPENING_INTEL_THRESHOLDS.genericMax) {
    failed.push('generic')
    reasons.push(`generic=${scores.generic}`)
  }
  if (scores.overall < OPENING_INTEL_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (
    FORBIDDEN_BARE_GREETING_RE.test(draft) &&
    scores.sentences <= 2 &&
    !VALUE_SIGNAL_RE.test(draft)
  ) {
    failed.push('bare_greeting')
    reasons.push('forbidden_bare_greeting')
  }
  if (MOTIVATIONAL_CLICHE_RE.test(draft)) {
    failed.push('cliche')
    reasons.push('motivational_cliche')
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'OPENING INTELLIGENCE: rewrite the opening — first impression must create value.',
        `Objective: ${plan.objective}; Category: ${plan.category}.`,
        `Seed substance: ${String(plan.seed || '').slice(0, 160)}`,
        `Hook: ${plan.hookHint}`,
        `Length ${plan.minSentences}–${plan.maxSentences} sentences. Intelligent friend tone.`,
        'Forbidden bare: “It\'s nice to hear from you.” / “Hello!” / “How are you?” / “Welcome back.”',
        `Scores: value=${scores.value} natural=${scores.naturalness} hook=${scores.hook} length=${scores.lengthOk} generic=${scores.generic} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        OPENING_INTEL_EVAL_CHECKS.join(' · '),
        'Non citare lo stage.',
      ].join(' ')
    : ''

  return { needsRefine, refineBrief, scores, failed, reasons }
}

/**
 * @param {object} [input]
 */
export function runOpeningIntelligenceGate(input = {}) {
  try {
    const gate = analyzeOpeningIntelligenceDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          value: 100,
          naturalness: 100,
          hook: 100,
          lengthOk: 100,
          generic: 0,
          overall: 100,
          sentences: 0,
        },
        failed: [],
        reasons: ['fail_soft'],
      },
      shouldRefine: false,
    }
  }
}

/**
 * @param {string} draft
 * @param {OpeningIntelligencePlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesOpeningIntelligence(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    const analysis = analyzeOpeningIntelligenceDraft({
      draft,
      plan,
      userMessage: ctx.userMessage || '',
    })
    return analysis.needsRefine
  } catch {
    return false
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: OpeningIntelligencePlan, context: string }}
 */
export function runOpeningIntelligenceEngine(input = {}) {
  try {
    const plan = buildOpeningIntelligencePlan(input)
    if (plan.shouldOpen && input.session) {
      persistOpeningIntelligence(input.session, plan)
    }
    return {
      plan,
      context: formatOpeningIntelligenceForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        shouldOpen: false,
        forceSkipUserQuestion: false,
        objective: null,
        category: null,
        seed: '',
        hookHint: '',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        recentCategories: [],
        recentObjectives: [],
        memoryThread: null,
        minSentences: 2,
        maxSentences: 6,
        forbiddenOpenings: [...FORBIDDEN_LIST],
        evaluationChecks: [...OPENING_INTEL_EVAL_CHECKS],
        validationCheck: OPENING_INTEL_EVAL_CHECKS[0],
        trigger: 'idle',
      },
      context: '',
    }
  }
}
