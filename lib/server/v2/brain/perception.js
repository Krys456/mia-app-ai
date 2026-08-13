/**
 * LAIfe V2 — Perception
 *
 * Pure observation module. Sees the turn; never decides, writes, or prompts.
 * Not wired into the chat pipeline yet.
 *
 * @see PERCEPTION_SPEC.md
 * @see LAIFE_V2_ARCHITECTURE.md §2.2.1
 */

import { observeShortReplySurface } from './short-reply.js'

export const PERCEPTION_VERSION = '2.0.3-perception'

/** @typedef {'it'|'en'|'es'|'fr'|'de'|'pt'|'unknown'} PerceptionLanguage */

/**
 * @typedef {'greeting'|'small_talk'|'companionship'|'curiosity'|'learning'|'problem_solving'|'celebration'|'emotional_support'|'reflection'|'exploration'|'advice'|'news'|'life_update'|'project_update'|'entertainment'|'silence'|'boredom'|'continuation'|'feedback_on_assistant'|'meta_language'|'unclear'} PerceptionIntent
 */

/**
 * @typedef {'none'|'greeting'|'farewell'|'thanks'|'how_are_you'|'compliment'|'agreement'|'laughter'|'teasing'|'presence'} PerceptionSocialIntent
 */

/**
 * @typedef {'neutral'|'calm'|'curious'|'excited'|'playful'|'happy'|'frustrated'|'angry'|'anxious'|'tired'|'confused'|'urgent'} PerceptionEmotionalState
 */

/**
 * @typedef {'opening'|'early'|'developing'|'deepening'|'closing'|'repair'} PerceptionConversationStage
 */

/**
 * @typedef {'unknown'|'beginner'|'intermediate'|'advanced'|'expert'} PerceptionKnowledgeLevel
 */

/**
 * @typedef {'connection'|'information'|'explanation'|'help_unblocking'|'emotional_care'|'celebration_share'|'direction'|'continuation'|'feedback_ack'|'unclear'} PerceptionUserNeed
 */

/**
 * @typedef {object} PerceptionReasoning
 * @property {string[]} signals
 * @property {Array<{ intent: string, score: number }>} alternatives
 * @property {string[]} notes
 */

/**
 * @typedef {object} PerceptionSnapshot
 * @property {PerceptionLanguage} language
 * @property {PerceptionIntent} intent
 * @property {PerceptionSocialIntent} socialIntent
 * @property {PerceptionEmotionalState} emotionalState
 * @property {PerceptionConversationStage} conversationStage
 * @property {PerceptionKnowledgeLevel} knowledgeLevel
 * @property {PerceptionUserNeed} userNeed
 * @property {number} confidence
 * @property {PerceptionReasoning} reasoning
 */

/**
 * @typedef {object} PerceptionMessage
 * @property {string} [role]
 * @property {string} [content]
 */

/**
 * @typedef {object} PerceptionMemoryItem
 * @property {string} [text]
 * @property {string} [content]
 * @property {string} [type]
 */

/**
 * @typedef {object} PerceptionInput
 * @property {string} [userMessage]
 * @property {PerceptionMessage[]} [messages]
 * @property {PerceptionMemoryItem[]|null} [memory]
 */

const MAX_MESSAGE_CHARS = 4000
const MAX_HISTORY = 40
const MAX_MEMORY_ITEMS = 8

/** @type {PerceptionIntent[]} */
const INTENT_ORDER = [
  'greeting',
  'small_talk',
  'companionship',
  'curiosity',
  'learning',
  'problem_solving',
  'celebration',
  'emotional_support',
  'reflection',
  'exploration',
  'advice',
  'news',
  'life_update',
  'project_update',
  'entertainment',
  'silence',
  'boredom',
  'continuation',
  'feedback_on_assistant',
  'meta_language',
  'unclear',
]

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * @param {string} text
 * @returns {string}
 */
function clip(text) {
  const t = asString(text).trim()
  if (t.length <= MAX_MESSAGE_CHARS) return t
  return t.slice(0, MAX_MESSAGE_CHARS)
}

/**
 * @param {PerceptionInput} input
 * @returns {{ userMessage: string, messages: PerceptionMessage[], memoryTexts: string[] }}
 */
function normalizeInput(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const userMessage = clip(raw.userMessage)

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .filter((m) => m && typeof m === 'object')
        .slice(-MAX_HISTORY)
        .map((m) => ({
          role: asString(m.role).toLowerCase(),
          content: clip(m.content),
        }))
        .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
    : []

  const memoryTexts = Array.isArray(raw.memory)
    ? raw.memory
        .filter((m) => m && typeof m === 'object')
        .slice(0, MAX_MEMORY_ITEMS)
        .map((m) => clip(m.text || m.content || ''))
        .filter(Boolean)
    : []

  return { userMessage, messages, memoryTexts }
}

/**
 * @param {string} text
 * @returns {PerceptionLanguage}
 */
export function detectLanguage(text, options = {}) {
  const t = asString(text).trim()
  if (!t) return 'unknown'

  const lower = t.toLowerCase()
  const sticky =
    typeof options.stickyLanguage === 'string' && options.stickyLanguage !== 'unknown'
      ? /** @type {PerceptionLanguage} */ (options.stickyLanguage)
      : null

  const scores = {
    it: 0,
    en: 0,
    es: 0,
    fr: 0,
    de: 0,
    pt: 0,
  }

  // Strong short Italian social / boredom phrases (must not fall through to ASCII→en).
  if (
    /^(mi\s+annoio|non\s+so(\s+di(\s+cosa)?)?|come\s+stai|come\s+va|va\s+bene|continua|dai|che\s+noia|tutto\s+bene|dimmi|raccontami|e\s+poi|ok\s+dai|andiamo)[\s!.?…]*$/i.test(
      lower,
    ) ||
    /\b(mi\s+annoio|che\s+noia|non\s+so\s+di\s+cosa|va\s+bene)\b/i.test(lower)
  ) {
    scores.it += 5
  }

  // Accent / article cues
  if (/[àèéìòù]/.test(lower)) scores.it += 2
  if (/[áéíóúñ¿¡]/.test(lower)) scores.es += 2
  if (/[àâçéèêëîïôùûü]/.test(lower)) scores.fr += 1.5
  if (/[äöüß]/.test(lower)) scores.de += 2
  if (/[áàâãçéêíóôõú]/.test(lower)) scores.pt += 1.5

  const lex = [
    [
      'it',
      /\b(ciao|salve|buongiorno|buonasera|grazie|perch[eé]|cos['']è|come|non|sono|voglio|posso|aiuto|spiegami|continua|davvero|anche|però|oggi|domani|annoio|annoiato|noia|cosa|parlare|stai|dai|allora|quindi|bene|prego|ancora|forse|niente|qualcosa)\b/gi,
    ],
    [
      'en',
      /\b(hello|hi|hey|thanks|please|what|why|how|the|and|you|i'm|i\s+am|help|explain|continue|really|today|tomorrow|because|bored|boring)\b/gi,
    ],
    [
      'es',
      /\b(hola|gracias|por\s+qué|qué|cómo|ayuda|explicame|continúa|también|hoy|mañana)\b/gi,
    ],
    [
      'fr',
      /\b(bonjour|salut|merci|pourquoi|qu['']est|comment|aide|explique|continue|aujourd['']hui)\b/gi,
    ],
    [
      'de',
      /\b(hallo|danke|warum|was|wie|hilfe|erkl[äa]r|weiter|heute|morgen|ich|nicht)\b/gi,
    ],
    [
      'pt',
      /\b(olá|oi|obrigad[oa]|por\s+quê|como|ajuda|explica|continua|hoje|amanhã)\b/gi,
    ],
  ]

  for (const [lang, re] of lex) {
    const hits = lower.match(re)
    if (hits) scores[lang] += hits.length
  }

  /** @type {PerceptionLanguage} */
  let best = 'unknown'
  let bestScore = 0
  for (const lang of /** @type {PerceptionLanguage[]} */ ([
    'it',
    'en',
    'es',
    'fr',
    'de',
    'pt',
  ])) {
    if (scores[lang] > bestScore) {
      bestScore = scores[lang]
      best = lang
    }
  }

  const wordCount = t.split(/\s+/).filter(Boolean).length
  const shortUtterance = wordCount <= 4 && t.length <= 40

  if (bestScore <= 0) {
    // Italian sticky / Italian-looking short phrases must not default to English.
    if (sticky === 'it' && shortUtterance) return 'it'
    if (
      /\b(mi|annoio|noia|dai|bene|cosa|parlare|stai|non|so|come|va|che)\b/i.test(lower) &&
      shortUtterance
    ) {
      return 'it'
    }
    // Latin default: if mostly ASCII letters, prefer en lightly; else unknown
    if (/^[a-z0-9\s?',.!_-]+$/i.test(t) && /[a-z]{3,}/i.test(t)) {
      if (sticky && sticky !== 'en' && shortUtterance) return sticky
      return 'en'
    }
    return sticky || 'unknown'
  }

  // Conversation language stickiness: do not flip an established Italian thread to English
  // on a very short / weakly scored utterance without strong English evidence.
  if (sticky && sticky !== best && shortUtterance) {
    const stickyScore = scores[sticky] || 0
    if (sticky === 'it' && best === 'en' && bestScore < 3) {
      return 'it'
    }
    if (stickyScore > 0 && bestScore - stickyScore < 2) {
      return sticky
    }
    if (bestScore <= 1) return sticky
  }

  return best
}

/**
 * Infer sticky conversation language from recent turns (secondary signal).
 * @param {Array<{ role?: string, content?: string }>} messages
 * @returns {PerceptionLanguage|null}
 */
export function inferStickyLanguage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null
  /** @type {Record<string, number>} */
  const tallies = { it: 0, en: 0, es: 0, fr: 0, de: 0, pt: 0 }
  const recent = messages.slice(-8)
  for (const m of recent) {
    const content = asString(m?.content).trim()
    if (!content) continue
    // Avoid recursion through sticky: detect from lexical evidence only.
    const lang = detectLanguage(content)
    if (lang !== 'unknown' && tallies[lang] != null) {
      tallies[lang] += m?.role === 'assistant' ? 1.2 : 1
    }
  }
  let best = null
  let bestScore = 0
  for (const [lang, score] of Object.entries(tallies)) {
    if (score > bestScore) {
      bestScore = score
      best = lang
    }
  }
  return bestScore > 0 ? /** @type {PerceptionLanguage} */ (best) : null
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isMostlyNonVerbal(text) {
  const t = text.trim()
  if (!t) return true
  if (/^[\s.…·•\-–—_]+$/.test(t)) return true
  if (/^(\p{Extended_Pictographic}|\s)+$/u.test(t)) return true
  return t.length <= 1
}

/**
 * @param {string} text
 * @param {string[]} signals
 * @returns {PerceptionSocialIntent}
 */
function observeSocialIntent(text, signals) {
  const t = text.toLowerCase().trim()

  if (
    /^(ciao|hey|hi|hello|hola|salut|hallo|salve|buongiorno|buonasera)[\s!.?]*$/i.test(
      t,
    )
  ) {
    signals.push('social:greeting_only')
    return 'greeting'
  }

  if (
    /\b(ciao|hey|hi|hello|hola|salve|buongiorno|buonasera)\b/i.test(t) &&
    t.length < 40
  ) {
    signals.push('social:greeting')
    return 'greeting'
  }

  if (
    /\b(bye|goodbye|a\s+presto|ci\s+vediamo|buonanotte|good\s+night|arrivederci|addio)\b/i.test(
      t,
    )
  ) {
    signals.push('social:farewell')
    return 'farewell'
  }

  if (
    /^(grazie|thanks|thank\s+you|ty|merci|gracias)[\s!.?]*$/i.test(t) ||
    (/^\b(grazie|thanks|thank\s+you)\b/i.test(t) && t.length < 48)
  ) {
    signals.push('social:thanks')
    return 'thanks'
  }

  if (
    /\b(come\s+stai|come\s+va|how\s+are\s+you|how's\s+it\s+going|che\s+fai)\b/i.test(
      t,
    )
  ) {
    signals.push('social:how_are_you')
    return 'how_are_you'
  }

  if (
    /\b(sei\s+(grande|forte|brav[oa])|you're\s+(great|awesome|amazing)|ti\s+adoro|love\s+this)\b/i.test(
      t,
    )
  ) {
    signals.push('social:compliment')
    return 'compliment'
  }

  if (
    /^(sì|si|yes|yep|yeah|ok|okay|va\s+bene|certo|exactly|esatto|già)[\s!.]*$/i.test(
      t,
    )
  ) {
    signals.push('social:agreement')
    return 'agreement'
  }

  if (/\b(haha|hahaha|ahah|lol|lmao|😂|🤣)\b/i.test(t)) {
    signals.push('social:laughter')
    return 'laughter'
  }

  if (
    /\b(ehila'|ehi\s+te|beccato|as\s+if|yeah\s+right|ma\s+va)\b/i.test(t)
  ) {
    signals.push('social:teasing')
    return 'teasing'
  }

  if (
    /^(mh+|mm+|uhm+|eh+|ok|okay|k|👍)[\s!.]*$/i.test(t) ||
    t.length <= 3
  ) {
    signals.push('social:presence')
    return 'presence'
  }

  return 'none'
}

/**
 * @returns {Record<PerceptionIntent, number>}
 */
function emptyIntentScores() {
  /** @type {Record<string, number>} */
  const scores = {}
  for (const intent of INTENT_ORDER) scores[intent] = 0
  return /** @type {Record<PerceptionIntent, number>} */ (scores)
}

/**
 * @param {string} text
 * @param {{ hasHistory: boolean, lastAssistant: string, memoryTexts: string[] }} ctx
 * @param {string[]} signals
 * @returns {{ scores: Record<PerceptionIntent, number>, primary: PerceptionIntent, alternatives: Array<{ intent: string, score: number }> }}
 */
function scoreIntents(text, ctx, signals) {
  const scores = emptyIntentScores()
  const t = text.toLowerCase().trim()
  const { hasHistory, lastAssistant, memoryTexts } = ctx

  /** @param {PerceptionIntent} intent @param {number} amount @param {string} [signal] */
  const bump = (intent, amount, signal) => {
    scores[intent] += amount
    if (signal) signals.push(signal)
  }

  if (!t || isMostlyNonVerbal(t)) {
    bump('silence', 0.85, 'intent:nonverbal_or_empty')
  }

  if (
    /^(ciao|hey|hi|hello|hola|salut|hallo|salve|buongiorno|buonasera)[\s!.?]*$/i.test(
      t,
    )
  ) {
    bump('greeting', 0.95, 'intent:greeting_only')
  } else if (
    /\b(ciao|hey|hi|hello|hola|salve|buongiorno)\b/i.test(t) &&
    t.length < 60
  ) {
    bump('greeting', 0.55, 'intent:greeting_embedded')
  }

  if (
    /\b(come\s+stai|how\s+are\s+you|che\s+fai|what's\s+up|tutto\s+bene)\b/i.test(
      t,
    )
  ) {
    bump('small_talk', 0.55, 'intent:small_talk')
    bump('companionship', 0.25)
  }

  if (
    /\b(parliamo|teniamoci\s+compagnia|keep\s+me\s+company|just\s+chatting|chiacchiere)\b/i.test(
      t,
    )
  ) {
    bump('companionship', 0.7, 'intent:companionship')
  }

  if (
    /\b(mi\s+sento|sono\s+(triste|giù|ansios[oa]|depress)|non\s+ce\s+la\s+faccio|i\s+feel\s+(sad|anxious|down|overwhelmed)|i'm\s+(sad|anxious|scared)|ho\s+paura|mi\s+fa\s+male)\b/i.test(
      t,
    )
  ) {
    bump('emotional_support', 0.92, 'intent:emotional_support')
  }

  if (
    /\b(evviva|yay|fantastic[oa]!|incredible|i'm\s+so\s+happy|ce\s+l'ho\s+fatta|ho\s+fatto\s+cela|won|promoted)\b/i.test(
      t,
    ) ||
    /🎉|🥳|🙌/.test(text)
  ) {
    bump('celebration', 0.8, 'intent:celebration')
  }

  if (
    /\b(noios[oa]|bored|annoiato|annoio|annoi|mi\s+annoio|non\s+so\s+(di\s+)?cosa\s+(fare|parlare)|non\s+so\s+di\s+che|nothing\s+to\s+do|don['’]?t\s+know\s+what\s+to\s+(say|talk|do))\b/i.test(
      t,
    )
  ) {
    bump('boredom', 0.82, 'intent:boredom')
  }

  if (
    /\b(continua|vai\s+avanti|dimmi\s+di\s+più|raccontami|e\s+poi\??|go\s+on|tell\s+me\s+more|keep\s+going|interessante|interesting|davvero\??|wow)\b/i.test(
      t,
    ) ||
    (/^(ok|okay|sì|si|yes|cool|nice|bene)[\s!.]*$/i.test(t) && hasHistory)
  ) {
    bump('continuation', 0.78, 'intent:continuation')
  }

  if (
    /\b(sei\s+(?:\w+\s+){0,3}(ripetit\w*|robotic\w*|robot\w*|formal\w*|fredd\w*)|too\s+(?:\w+\s+){0,2}(robotic|formal|repetitive)|pi[ùu]\s+natural\w*|more\s+natural\w*|troppe\s+domande|too\s+many\s+questions|mi\s+piace\s+cos[iì]|much\s+better)\b/i.test(
      t,
    )
  ) {
    bump('feedback_on_assistant', 0.9, 'intent:feedback_on_assistant')
  }

  if (
    /\b(parla\s+(in\s+)?(italiano|inglese|english|spanish)|speak\s+(in\s+)?(english|italian)|answer\s+in\s+|in\s+english\s+please|passa\s+all['']inglese)\b/i.test(
      t,
    )
  ) {
    bump('meta_language', 0.95, 'intent:meta_language')
  }

  if (
    /\b(spiegami|explain|cos['']è|what\s+is|how\s+does|come\s+funziona|perch[eé]|why\s+does|differenza\s+tra|teach\s+me|imparare|learn)\b/i.test(
      t,
    )
  ) {
    bump('learning', 0.72, 'intent:learning')
  }

  if (
    /\b(aiutami|help\s+me|non\s+riesco|stuck|errore|bug|fixare|debug|non\s+va|broken|solve|risolvere)\b/i.test(
      t,
    )
  ) {
    bump('problem_solving', 0.8, 'intent:problem_solving')
  }

  if (
    /\b(consigliami|advice|dovrei|should\s+i|che\s+mi\s+consigli|what\s+would\s+you\s+do)\b/i.test(
      t,
    )
  ) {
    bump('advice', 0.7, 'intent:advice')
  }

  if (
    /\b(curios[oa]|mi\s+chiedo|i\s+wonder|interessante\s+sapere|ever\s+noticed)\b/i.test(
      t,
    )
  ) {
    bump('curiosity', 0.65, 'intent:curiosity')
  }

  if (
    /\b(esploriamo|explore|idee\s+su|brainstorm|what\s+if|e\s+se)\b/i.test(t)
  ) {
    bump('exploration', 0.65, 'intent:exploration')
  }

  if (
    /\b(rifletto|sto\s+pensando|i've\s+been\s+thinking|in\s+hindsight|guardando\s+indietro)\b/i.test(
      t,
    )
  ) {
    bump('reflection', 0.6, 'intent:reflection')
  }

  if (
    /\b(notizie|news|ultime|breaking|oggi\s+è\s+successo|current\s+events)\b/i.test(
      t,
    )
  ) {
    bump('news', 0.7, 'intent:news')
  }

  if (
    /\b(il\s+mio\s+progetto|my\s+project|sto\s+lavorando\s+a|shipping|roadmap|milestone)\b/i.test(
      t,
    )
  ) {
    bump('project_update', 0.68, 'intent:project_update')
  }

  if (
    /\b(oggi\s+ho|i\s+just|mi\s+è\s+successo|life\s+update|nel\s+weekend)\b/i.test(
      t,
    )
  ) {
    bump('life_update', 0.55, 'intent:life_update')
  }

  if (
    /\b(barzelletta|joke|divertiamoci|fun\s+fact|intratten|story\s+time)\b/i.test(
      t,
    )
  ) {
    bump('entertainment', 0.6, 'intent:entertainment')
  }

  // Short social presence without clear task
  if (
    scores.greeting < 0.4 &&
    scores.continuation < 0.4 &&
    t.length > 0 &&
    t.length < 24 &&
    !/[?]/.test(t) &&
    !scores.problem_solving &&
    !scores.learning
  ) {
    bump('small_talk', 0.25, 'intent:short_utterance')
  }

  // History soft prior: continuation when acknowledging prior assistant content
  if (
    hasHistory &&
    lastAssistant &&
    /^(ok|okay|sì|si|yes|capito|got\s+it|capisco|mh+|mm+)[\s!.]*$/i.test(t)
  ) {
    bump('continuation', 0.35, 'intent:ack_after_assistant')
  }

  if (memoryTexts.length > 0) {
    signals.push(`context:memory_items:${memoryTexts.length}`)
    // Soft continuity prior only — not a decision to use memory
    if (scores.continuation > 0 || scores.project_update > 0 || scores.life_update > 0) {
      bump('continuation', 0.05, 'intent:memory_continuity_hint')
    }
  }

  if (!hasHistory && scores.greeting <= 0 && scores.silence <= 0 && t.length > 0) {
    // Opening informational default soft prior when nothing else matched strongly
    if (Object.values(scores).every((v) => v < 0.2)) {
      bump('unclear', 0.4, 'intent:no_strong_signal')
    }
  }

  const ranked = INTENT_ORDER.map((intent) => ({
    intent,
    score: Math.max(0, Math.min(1, Number(scores[intent].toFixed(4)))),
  })).sort((a, b) => b.score - a.score || INTENT_ORDER.indexOf(/** @type {PerceptionIntent} */ (a.intent)) - INTENT_ORDER.indexOf(/** @type {PerceptionIntent} */ (b.intent)))

  const primary =
    ranked[0].score > 0
      ? /** @type {PerceptionIntent} */ (ranked[0].intent)
      : 'unclear'

  if (primary === 'unclear' && ranked[0].score <= 0) {
    signals.push('intent:fallback_unclear')
  }

  const alternatives = ranked
    .filter((r) => r.intent !== primary && r.score >= 0.15)
    .slice(0, 4)

  return { scores, primary, alternatives }
}

/**
 * @param {string} text
 * @param {PerceptionIntent} intent
 * @param {PerceptionSocialIntent} socialIntent
 * @param {string[]} signals
 * @returns {PerceptionEmotionalState}
 */
function observeEmotionalState(text, intent, socialIntent, signals) {
  const t = text.toLowerCase()

  if (
    /\b(furios[oa]|arrabbiat|angry|pissed|odio\s+quando)\b/i.test(t)
  ) {
    signals.push('emotion:angry')
    return 'angry'
  }
  if (
    /\b(frustrat|stuck|non\s+ce\s+la\s+faccio|annoyed|irtat)\b/i.test(t)
  ) {
    signals.push('emotion:frustrated')
    return 'frustrated'
  }
  if (
    /\b(ansios|anxious|preoccupat|worried|ho\s+paura|scared|panic)\b/i.test(t)
  ) {
    signals.push('emotion:anxious')
    return 'anxious'
  }
  if (
    /\b(triste|sad|giù|down|depressed|piango|lonely|sol[oa])\b/i.test(t)
  ) {
    signals.push('emotion:sad')
    return 'sad'
  }
  if (/\b(stanc[oa]|tired|esaust|exhausted|non\s+dormo)\b/i.test(t)) {
    signals.push('emotion:tired')
    return 'tired'
  }
  if (
    /\b(confus|non\s+capisco|confused|non\s+mi\s+è\s+chiaro|unclear)\b/i.test(
      t,
    )
  ) {
    signals.push('emotion:confused')
    return 'confused'
  }
  if (
    /\b(urgent|subito|asap|immediately|emergenza|right\s+now)\b/i.test(t)
  ) {
    signals.push('emotion:urgent')
    return 'urgent'
  }
  if (
    /\b(haha|lol|😂|scherz|teasing|playful)\b/i.test(t) ||
    socialIntent === 'laughter' ||
    socialIntent === 'teasing'
  ) {
    signals.push('emotion:playful')
    return 'playful'
  }
  if (
    /\b(evviva|yay|excited|entusiast|non\s+vedo\s+l['']ora|so\s+happy|fantastico!)\b/i.test(
      t,
    ) ||
    intent === 'celebration'
  ) {
    signals.push('emotion:excited')
    return 'excited'
  }
  if (
    /\b(curios[oa]|mi\s+chiedo|i\s+wonder|interessant)\b/i.test(t) ||
    intent === 'curiosity' ||
    intent === 'exploration'
  ) {
    signals.push('emotion:curious')
    return 'curious'
  }
  if (
    /\b(felice|happy|contento|glad|bene\s+così)\b/i.test(t) ||
    socialIntent === 'compliment'
  ) {
    signals.push('emotion:happy')
    return 'happy'
  }
  if (intent === 'emotional_support') {
    signals.push('emotion:sad_from_support_intent')
    return 'sad'
  }
  if (intent === 'greeting' || intent === 'small_talk') {
    signals.push('emotion:calm_social')
    return 'calm'
  }

  signals.push('emotion:neutral_default')
  return 'neutral'
}

/**
 * @param {{ messageCount: boolean extends never ? never : number, hasHistory: boolean, intent: PerceptionIntent, socialIntent: PerceptionSocialIntent, text: string }} ctx
 * @param {string[]} signals
 * @returns {PerceptionConversationStage}
 */
function observeConversationStage(ctx, signals) {
  const { hasHistory, messageCount, intent, socialIntent, text } = ctx

  if (
    socialIntent === 'farewell' ||
    /\b(basta\s+così|stop\s+here|chiudiamo|that's\s+all|nient['']altro)\b/i.test(
      text,
    )
  ) {
    signals.push('stage:closing')
    return 'closing'
  }

  if (
    intent === 'feedback_on_assistant' ||
    /\b(non\s+è\s+quello|riprova|that's\s+not\s+what|hai\s+capito\s+male)\b/i.test(
      text,
    )
  ) {
    signals.push('stage:repair')
    return 'repair'
  }

  if (!hasHistory || messageCount <= 1) {
    signals.push('stage:opening')
    return 'opening'
  }

  if (messageCount <= 4) {
    signals.push('stage:early')
    return 'early'
  }

  if (
    intent === 'continuation' ||
    intent === 'reflection' ||
    intent === 'exploration' ||
    messageCount >= 12
  ) {
    signals.push('stage:deepening')
    return 'deepening'
  }

  signals.push('stage:developing')
  return 'developing'
}

/**
 * @param {string} text
 * @param {PerceptionIntent} intent
 * @param {string[]} signals
 * @returns {PerceptionKnowledgeLevel}
 */
function observeKnowledgeLevel(text, intent, signals) {
  const t = text.toLowerCase()

  if (
    /\b(sono\s+(un['']?\s*)?(esperto|expert|senior)|advanced\s+topic|in\s+profondità|deep\s+dive|implementazione\s+interna)\b/i.test(
      t,
    )
  ) {
    signals.push('knowledge:expert_cue')
    return 'expert'
  }
  if (
    /\b(già\s+so|i\s+already\s+know|oltre\s+le\s+basi|non\s+da\s+zero|advanced)\b/i.test(
      t,
    )
  ) {
    signals.push('knowledge:advanced_cue')
    return 'advanced'
  }
  if (
    /\b(ho\s+già\s+letto|qualche\s+base|intermediate|non\s+sono\s+principiante)\b/i.test(
      t,
    )
  ) {
    signals.push('knowledge:intermediate_cue')
    return 'intermediate'
  }
  if (
    /\b(sono\s+(un['']?\s*)?(principiante|beginner)|da\s+zero|eli5|spiega\s+semplice|mai\s+sentito|absolute\s+beginner)\b/i.test(
      t,
    )
  ) {
    signals.push('knowledge:beginner_cue')
    return 'beginner'
  }

  // Soft defaults only for clear learning asks without level markers
  if (intent === 'learning' || intent === 'problem_solving') {
    signals.push('knowledge:unknown_despite_task')
  } else {
    signals.push('knowledge:unknown')
  }
  return 'unknown'
}

/**
 * userNeed = perceived human need (observation), not a response strategy.
 *
 * @param {PerceptionIntent} intent
 * @param {PerceptionSocialIntent} socialIntent
 * @param {PerceptionEmotionalState} emotionalState
 * @param {string[]} signals
 * @returns {PerceptionUserNeed}
 */
function observeUserNeed(intent, socialIntent, emotionalState, signals) {
  if (intent === 'feedback_on_assistant') {
    signals.push('need:feedback_ack')
    return 'feedback_ack'
  }
  if (intent === 'continuation') {
    signals.push('need:continuation')
    return 'continuation'
  }
  if (
    intent === 'emotional_support' ||
    emotionalState === 'sad' ||
    emotionalState === 'anxious'
  ) {
    signals.push('need:emotional_care')
    return 'emotional_care'
  }
  if (intent === 'celebration' || socialIntent === 'compliment') {
    signals.push('need:celebration_share')
    return 'celebration_share'
  }
  if (intent === 'problem_solving') {
    signals.push('need:help_unblocking')
    return 'help_unblocking'
  }
  if (intent === 'learning') {
    signals.push('need:explanation')
    return 'explanation'
  }
  if (
    intent === 'advice' ||
    intent === 'exploration' ||
    intent === 'boredom'
  ) {
    signals.push('need:direction')
    return 'direction'
  }
  if (
    intent === 'news' ||
    intent === 'curiosity' ||
    intent === 'meta_language'
  ) {
    signals.push('need:information')
    return 'information'
  }
  if (
    intent === 'greeting' ||
    intent === 'small_talk' ||
    intent === 'companionship' ||
    socialIntent === 'how_are_you' ||
    socialIntent === 'presence'
  ) {
    signals.push('need:connection')
    return 'connection'
  }
  if (intent === 'unclear' || intent === 'silence') {
    signals.push('need:unclear')
    return 'unclear'
  }

  signals.push('need:information_default')
  return 'information'
}

/**
 * @param {{ primaryScore: number, secondScore: number, signals: string[], intent: PerceptionIntent }} args
 * @returns {number}
 */
function computeConfidence(args) {
  const { primaryScore, secondScore, signals, intent } = args
  const margin = primaryScore - secondScore
  let confidence = 0.35 + primaryScore * 0.45 + Math.max(0, margin) * 0.35

  if (intent === 'unclear' || intent === 'silence') {
    confidence = Math.min(confidence, 0.45)
  }
  if (signals.some((s) => s.startsWith('intent:greeting_only'))) {
    confidence = Math.max(confidence, 0.85)
  }
  if (signals.some((s) => s.startsWith('intent:emotional_support'))) {
    confidence = Math.max(confidence, 0.8)
  }
  if (signals.some((s) => s === 'intent:no_strong_signal')) {
    confidence = Math.min(confidence, 0.4)
  }

  return Number(Math.max(0, Math.min(1, confidence)).toFixed(3))
}

/**
 * Observe the current turn. Pure. No I/O. No decisions.
 *
 * @param {PerceptionInput} [input]
 * @returns {PerceptionSnapshot}
 */
export function perceive(input = {}) {
  const { userMessage, messages, memoryTexts } = normalizeInput(input)
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const notes = []

  const userTurns = messages.filter((m) => m.role === 'user')
  const assistantTurns = messages.filter((m) => m.role === 'assistant')
  const lastAssistant =
    [...messages].reverse().find((m) => m.role === 'assistant')?.content || ''
  const hasHistory = messages.length > 0
  const messageCount = messages.length

  if (!userMessage) {
    notes.push('empty_user_message')
  }
  if (memoryTexts.length) {
    notes.push('memory_context_present')
  }
  if (hasHistory) {
    notes.push(`history_turns:${messageCount}`)
  } else {
    notes.push('no_history')
  }

  const stickyLanguage = inferStickyLanguage(messages)
  const language = detectLanguage(userMessage || lastAssistant, {
    stickyLanguage,
  })
  signals.push(`language:${language}`)
  if (stickyLanguage && stickyLanguage !== language) {
    notes.push(`language_sticky:${stickyLanguage}`)
  } else if (stickyLanguage) {
    notes.push(`language_sticky:${stickyLanguage}`)
  }

  const socialIntent = observeSocialIntent(userMessage, signals)
  const { primary, alternatives, scores } = scoreIntents(
    userMessage,
    { hasHistory, lastAssistant, memoryTexts },
    signals,
  )

  // If social greeting-only dominates a weak informational score, keep greeting intent
  let intent = primary
  if (
    socialIntent === 'greeting' &&
    scores.greeting >= 0.5 &&
    primary !== 'meta_language' &&
    primary !== 'feedback_on_assistant'
  ) {
    intent = 'greeting'
  }

  const emotionalState = observeEmotionalState(
    userMessage,
    intent,
    socialIntent,
    signals,
  )
  const conversationStage = observeConversationStage(
    {
      hasHistory,
      messageCount: Math.max(messageCount, userTurns.length + assistantTurns.length),
      intent,
      socialIntent,
      text: userMessage,
    },
    signals,
  )
  const knowledgeLevel = observeKnowledgeLevel(userMessage, intent, signals)
  const userNeed = observeUserNeed(
    intent,
    socialIntent,
    emotionalState,
    signals,
  )

  const rankedScores = Object.entries(scores)
    .map(([k, v]) => ({ intent: k, score: v }))
    .sort((a, b) => b.score - a.score)
  const primaryScore = rankedScores[0]?.score || 0
  const secondScore = rankedScores[1]?.score || 0

  const confidence = computeConfidence({
    primaryScore,
    secondScore,
    signals,
    intent,
  })

  // Observational notes only — never directives
  notes.push(`observed_intent:${intent}`)
  notes.push(`observed_need:${userNeed}`)
  if (alternatives[0]) {
    notes.push(
      `next_best_intent:${alternatives[0].intent}@${alternatives[0].score}`,
    )
  }

  // Surface short-reply cues only (authoritative interpretation lives in short-reply.js / Planner).
  const surface = observeShortReplySurface(userMessage)
  if (surface.isShortReply) signals.push('surface:short_reply')
  if (surface.surfaceAgreement) signals.push('surface:agreement')
  if (surface.surfaceContinuation) signals.push('surface:continuation')
  if (surface.surfaceStop) signals.push('surface:stop')
  if (surface.surfaceUncertain) signals.push('surface:uncertain')
  notes.push('short_reply_surface_observational_only')

  /** @type {PerceptionSnapshot} */
  const snapshot = {
    language,
    intent,
    socialIntent,
    emotionalState,
    conversationStage,
    knowledgeLevel,
    userNeed,
    confidence,
    reasoning: {
      signals: signals.slice(0, 40),
      alternatives,
      notes: notes.slice(0, 20),
    },
  }

  return snapshot
}

/**
 * Structural guard for tests / future Director adapters.
 * @param {unknown} value
 * @returns {value is PerceptionSnapshot}
 */
export function isPerceptionSnapshot(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {Record<string, unknown>} */ (value)
  return (
    typeof v.language === 'string' &&
    typeof v.intent === 'string' &&
    typeof v.socialIntent === 'string' &&
    typeof v.emotionalState === 'string' &&
    typeof v.conversationStage === 'string' &&
    typeof v.knowledgeLevel === 'string' &&
    typeof v.userNeed === 'string' &&
    typeof v.confidence === 'number' &&
    v.reasoning != null &&
    typeof v.reasoning === 'object'
  )
}
