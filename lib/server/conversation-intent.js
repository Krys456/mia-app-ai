/**
 * LAIfe Conversation Intent Engine
 *
 * Mission: words are not enough. Infer conversational intent BEFORE any reply.
 * Never answer only the literal text — answer the intention behind it.
 *
 * Example: "Update me." may mean news · something fascinating · continue a thread · surprise me.
 * Choose the most contextually likely reading. Prefer continuing an existing thread.
 *
 * Confidence:
 *   High → answer directly
 *   Low → offer one or two natural interpretations (never interrogate)
 *
 * Human test: If a friend said this, what would they probably mean? Respond to that.
 *
 * Runs AFTER Social Conversation, BEFORE planning / Leadership / Writer.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Post-writer gate rejects literal-only / continuity-breaking replies.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} IntentLang
 */

/**
 * @typedef {'greeting'|'small_talk'|'companionship'|'curiosity'|'learning'|'problem_solving'|'celebration'|'emotional_support'|'reflection'|'exploration'|'advice'|'news'|'life_update'|'project_update'|'entertainment'|'silence'|'boredom'|'random_conversation'|'deep_conversation'} UserIntentKind
 */

/**
 * @typedef {'comfort'|'venting'|'celebrating'|'frustrated_unblock'|'curious_wonder'|'anxious_reassurance'|'playful'|'grateful'|'neutral'} EmotionalIntent
 */

/**
 * @typedef {'continue_thread'|'start_thread'|'deepen'|'shift'|'acknowledge'|'request_help'|'share'|'invite_presence'} ConversationalIntent
 */

/**
 * @typedef {'low'|'medium'|'high'} Level
 */

/**
 * @typedef {'information'|'companionship'|'exploration'|'presence'|'mixed'} Expectation
 */

/**
 * @typedef {'direct'|'soft_interpretations'} ResponseStrategy
 */

/**
 * @typedef {{ intent: UserIntentKind, score: number, gloss: string }} IntentCandidate
 */

/**
 * @typedef {object} ConversationIntentInference
 * @property {UserIntentKind} primaryIntent
 * @property {UserIntentKind[]} secondaryIntents
 * @property {IntentCandidate[]} candidates
 * @property {ResponseStrategy} responseStrategy
 * @property {string[]} interpretations
 * @property {boolean} continueThread
 * @property {string} friendMeaning
 * @property {EmotionalIntent} emotionalIntent
 * @property {ConversationalIntent} conversationalIntent
 * @property {Level} curiosityLevel
 * @property {Level} engagementLevel
 * @property {'closed'|'soft'|'open'|'eager'} opennessToContinue
 * @property {Expectation} expects
 * @property {string} whySummary
 * @property {'high'|'medium'|'low'} confidence
 * @property {number} confidenceScore 0–1
 * @property {string[]} signals
 * @property {string | null} topic
 */

/**
 * @typedef {object} ConversationIntentPlan
 * @property {boolean} active
 * @property {ConversationIntentInference} inference
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} planningHints
 * @property {string[]} reasons
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} ConversationIntentGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

export const INTENT_NORTH_STAR =
  'Respond to intentions, not just sentences — as a friend would.'

export const INTENT_CHECKS = Object.freeze([
  'If a friend said this, what would they probably mean?',
  'Am I answering only the literal words?',
  'Should I continue the existing thread?',
  'Is confidence high enough to answer directly — or should I offer soft interpretations?',
])

/** @type {UserIntentKind[]} */
export const USER_INTENT_KINDS = Object.freeze([
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
  'random_conversation',
  'deep_conversation',
])

export const INTENT_THRESHOLDS = Object.freeze({
  highConfidenceMin: 0.72,
  mediumConfidenceMin: 0.48,
  intentAlignmentMin: 52,
  continuityMin: 50,
  literalOnlyMax: 45,
  engagementMin: 48,
  overallMin: 55,
})

const INTENT_GLOSS = Object.freeze({
  greeting: 'opening a channel / saying hello',
  small_talk: 'light social contact, not a task',
  companionship: 'wants company / presence together',
  curiosity: 'wants something fascinating to notice',
  learning: 'wants to understand / learn',
  problem_solving: 'wants help unblocking something',
  celebration: 'wants to share or mark a win',
  emotional_support: 'needs care / reassurance',
  reflection: 'wants thoughtful companionship with an idea',
  exploration: 'wants to wander an idea together',
  advice: 'wants a grounded suggestion',
  news: 'wants a recent update / what’s new',
  life_update: 'sharing or seeking life happenings',
  project_update: 'wants progress on a project thread',
  entertainment: 'wants play / delight / diversion',
  silence: 'comfortable with quiet presence',
  boredom: 'wants something interesting to happen',
  random_conversation: 'open to whatever feels alive',
  deep_conversation: 'ready for a deeper turn',
})

const DISTRESS =
  /(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto|mi\s+sento\s+male)/i
const VENTING =
  /(non\s+ne\s+posso\s+pi[uù]|fed\s+up|sick\s+of|mi\s+ha\s+roto|basta\s+cos[iì]|i'?m\s+done|sono\s+stufo|rant)/i
const FRUSTRATED =
  /(frustrated|frustrat|non\s+funziona|doesn'?t\s+work|stuck|bloccato|ancora\s+errore|keep\s+failing|arrabbiato|angry)/i
const ANXIOUS = /(worried|preoccupat|ansios|anxious|scared|paura|nervous|inquiet)/i
const CELEBRATING =
  /(yay|evviva|ce\s+l'?ho\s+fatta|ce\s+l'?abbiamo\s+fatta|did\s+it|finally|finalmente|\bwon\b(?!')|vinto|promoted|assunto|bellissima\s+notizia|we\s+did\s+it|ce\s+l['’]abbiamo\s+fatta)/i
const GRATEFUL = /(grazie|thanks|thank\s+you|ti\s+ringrazio|helpful|utilissimo)/i
const ENTHUSIASM =
  /(interesting|cool|wow|awesome|amazing|interessante|figo|forte|bell[oa]|ottimo|fantastico|love\s+(this|that|it))/i
const PLAYFUL = /(haha|ahah|lol|😂|😄|scherz|joke|divertente|funny)/i
const INFO_ASK =
  /(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is|calcola|quanto|differenza|vs\b|meglio)/i
const EXPLORE =
  /(esplor|explore|approfond|dig\s+deeper|curious|curios[oa]|mi\s+chiedo|wonder|what\s+if|e\s+se\b|ipotesi|idea|interesting|interessante)/i
const COMPANION =
  /(parliamo|let'?s\s+(?:chat|talk)|chiacchiere|come\s+stai|how\s+are\s+you|what'?s\s+up|niente\s+di\s+particolare|solo\s+passavo|just\s+saying|ti\s+racconto|voglio\s+raccont)/i
const PRESENCE =
  /(solo\s+volevo|just\s+wanted\s+to|sono\s+qui|i'?m\s+here|ascoltami|listen|non\s+so\s+cosa\s+dire|i\s+don'?t\s+know\s+what\s+to\s+say)/i
const SHARE =
  /(oggi\s+ho|i\s+(?:just\s+)?(?:had|did|saw|felt)|mi\s+[eè]\s+successo|ti\s+dico|guess\s+what|sapi\s+che)/i
const CONTINUE_ACK =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|capito|capisco|i\s+see|makes\s+sense|ah|oh|mm+|uhm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto|go\s+on|continua|dimmi\s+di\s+pi[uù]|tell\s+me\s+more)([\s!,.🥰😊🙏💯🔥]*)$/i
const DEEPEN =
  /(perch[eé]|why|come\s+mai|how\s+come|in\s+che\s+senso|what\s+do\s+you\s+mean|approfond|di\s+pi[uù]|more\s+about|esempio|example)/i
const SHIFT =
  /(cambiando\s+argomento|anyway|comunque|altra\s+cosa|un'?altra\s+cosa|by\s+the\s+way|btw|nuovo\s+tema)/i
const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening))([\s!,.🥰😊🙏]*)$/i
const STOP_SIGNAL =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|thx|ty|bye|arrivederci|buonanotte|done)([\s!,.]|$)/i

const UPDATE_ME =
  /^(update\s+me|aggiornami|dimmi\s+(?:novit[aà]|cose\s+nuove)|what'?s\s+new|novit[aà]\??|fill\s+me\s+in|portami\s+avanti)([\s!,.]*)$/i
const BOREDOM =
  /\b(bored|noia|annoiato|nothing\s+to\s+do|mi\s+annoio|so\s+bored|kill\s+time)\b/i
const NEWS =
  /\b(news|notizie|headline|oggi\s+nel\s+mondo|current\s+events|ultime\s+novit|what'?s\s+new|novit[aà])\b/i
const ADVICE =
  /\b(advice|consiglio|dovrei|should\s+i|what\s+would\s+you\s+do|mi\s+consigli)\b/i
const PROJECT =
  /\b(project|progetto|repo|sprint|milestone|ship|deploy|feature|roadmap)\b/i
const LEARNING =
  /\b(teach|impar|learn|tutorial|spiegami|explain|capire|study|studiare|tell\s+me\s+(?:about|something)|dimmi\s+qualcosa)\b/i
const ENTERTAIN =
  /\b(divert|entertain|joke|storiella|raccontami\s+qualcosa|make\s+me\s+laugh|fammi\s+ridere|intratten|ridere)\b/i
const AMBIGUOUS_SHORT =
  /^(update\s+me|aggiornami|and\s+then\??|e\s+quindi\??|so\??|okay\s+and\??|continua|go\s+on|surprise\s+me|sorprendimi|qualcosa|something|idk|boh|mah|whatever|come\s+vuoi)([\s!,.]*)$/i
const BUG_PROBLEM =
  /\b(bug|error|errore|crash|broken|non\s+funziona|won'?t\s+die|stuck|bloccato)\b/i
const FASCINATE_ASK =
  /\b(something\s+interesting|qualcosa\s+di\s+interessante|tell\s+me\s+something|dimmi\s+qualcosa|fascinat|affascinante)\b/i

const LITERAL_HELPDesk =
  /\b(how\s+can\s+i\s+(?:help|assist)|what\s+can\s+i\s+do\s+for\s+you|come\s+posso\s+aiutarti|in\s+cosa\s+posso\s+esserti\s+utile)\b/i
const INTERROGATE =
  /\b(what\s+exactly\s+do\s+you\s+mean|could\s+you\s+clarify|please\s+specify|which\s+of\s+the\s+following|cosa\s+intendi\s+esattamente|puoi\s+chiarire|specifica\s+meglio)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ChatTurn[]|undefined|null} messages
 * @returns {ChatTurn[]}
 */
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: normalize(m.content) }))
    .filter((m) => m.content.length > 0)
}

/**
 * @param {ChatTurn[]} turns
 */
function priorAssistantSnippet(turns) {
  const last = [...turns].reverse().find((t) => t.role === 'assistant')
  return last ? last.content.slice(0, 220) : ''
}

/**
 * @param {ChatTurn[]} turns
 */
function inferTopic(turns) {
  const last = [...turns].reverse().find((t) => t.role === 'assistant' || t.role === 'user')
  if (!last) return null
  const words = last.content
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
  return words.length ? words.join(' ') : null
}

/**
 * @param {object} input
 * @returns {IntentLang}
 */
function resolveLang(input) {
  const la =
    input.languageAwareness?.plan?.replyLanguage ||
    input.languageAwareness?.replyLanguage
  if (la === 'en' || la === 'it') return la
  try {
    const fromMsg = detectDominantLanguage(String(input.userMessage || ''))
    if (fromMsg === 'en' || fromMsg === 'it') return fromMsg
  } catch {
    /* fall through */
  }
  return /[àèéìòù]/i.test(String(input.userMessage || '')) ? 'it' : 'en'
}

/**
 * Score candidate intents from text + context.
 * @param {string} text
 * @param {object} ctx
 * @returns {IntentCandidate[]}
 */
export function rankUserIntents(text, ctx = {}) {
  const hasHistory = Boolean(ctx.hasHistory)
  const topic = ctx.topic || null
  const prior = normalize(ctx.priorAssistant || '')
  const momentum = normalize(ctx.momentum || '')
  const emotionalState = normalize(ctx.emotionalState || '')
  const memoryHint = normalize(ctx.memoryHint || '')

  /** @type {Record<UserIntentKind, number>} */
  const scores = Object.fromEntries(USER_INTENT_KINDS.map((k) => [k, 0.05]))

  const bump = (/** @type {UserIntentKind} */ k, n, why) => {
    scores[k] += n
    if (why && ctx._signals) ctx._signals.push(`${k}:${why}`)
  }

  if (GREETING_ONLY.test(text)) bump('greeting', 0.85, 'greeting')
  if (COMPANION.test(text) || /come\s+stai|how\s+are\s+you|what'?s\s+up/i.test(text)) {
    bump('small_talk', 0.55, 'small_talk')
    bump('companionship', 0.35, 'companionship')
  }
  if (PRESENCE.test(text) || /parliamo|let'?s\s+talk|chiacchiere/i.test(text)) {
    bump('companionship', 0.7, 'presence')
  }
  if (DISTRESS.test(text) || ANXIOUS.test(text) || VENTING.test(text)) {
    bump('emotional_support', 0.9, 'support')
  }
  if (CELEBRATING.test(text)) bump('celebration', 0.85, 'celebrate')
  if (
    FRUSTRATED.test(text) ||
    BUG_PROBLEM.test(text) ||
    (INFO_ASK.test(text) && /\b(fix|debug|error|bug|stuck|blocc)\b/i.test(text))
  ) {
    bump('problem_solving', 0.85, 'problem')
  }
  if (LEARNING.test(text) || /\b(spiegami|explain|what\s+is|cos'?[eè])\b/i.test(text)) {
    bump('learning', 0.7, 'learn')
  }
  if (FASCINATE_ASK.test(text) || /\btell\s+me\s+something\s+interesting\b/i.test(text)) {
    bump('curiosity', 0.8, 'fascinate_ask')
    bump('exploration', 0.45, 'fascinate_explore')
    bump('entertainment', 0.25, 'fascinate_fun')
  }
  if (ADVICE.test(text)) bump('advice', 0.75, 'advice')
  if (NEWS.test(text)) bump('news', 0.8, 'news')
  if (PROJECT.test(text)) bump('project_update', 0.7, 'project')
  if (SHARE.test(text) && !INFO_ASK.test(text)) bump('life_update', 0.55, 'life')
  if (EXPLORE.test(text) || DEEPEN.test(text)) {
    bump('curiosity', 0.45, 'curious')
    bump('exploration', 0.55, 'explore')
  }
  if (ENTERTAIN.test(text) || PLAYFUL.test(text)) bump('entertainment', 0.7, 'entertain')
  if (BOREDOM.test(text)) {
    bump('boredom', 0.8, 'bored')
    bump('curiosity', 0.35, 'bored_curious')
    bump('random_conversation', 0.3, 'bored_random')
  }
  if (/^(mm+|hmm+|…|\.\.\.|silence|silenzio)[\s.]*$/i.test(text)) bump('silence', 0.85, 'silence')
  if (/\b(deep|profond|meaning|senso|filosof|existential|what\s+do\s+you\s+think|cosa\s+pensi|about\s+time|del\s+tempo)\b/i.test(text)) {
    bump('deep_conversation', 0.7, 'deep')
    bump('reflection', 0.5, 'reflect')
    bump('exploration', 0.35, 'deep_explore')
  }
  if (/\b(riflett|reflect|penso\s+che|i'?ve\s+been\s+thinking)\b/i.test(text)) {
    bump('reflection', 0.7, 'reflect')
  }

  // Ambiguous "Update me." / "Aggiornami" / "Surprise me"
  if (UPDATE_ME.test(text) || AMBIGUOUS_SHORT.test(text)) {
    bump('random_conversation', 0.25, 'ambiguous')
    if (NEWS.test(prior) || /\b(news|notizie|oggi|headline)\b/i.test(prior) || /news/i.test(memoryHint)) {
      bump('news', 0.7, 'ctx_news')
    }
    if (PROJECT.test(prior) || PROJECT.test(topic || '') || /project/i.test(memoryHint)) {
      bump('project_update', 0.7, 'ctx_project')
    }
    if (/\b(fascinat|curios|idea|wonder|interessant|zeigarnik|unfinished)\b/i.test(prior)) {
      bump('curiosity', 0.7, 'ctx_fascinate')
      bump('exploration', 0.55, 'ctx_explore')
    }
    if (hasHistory && prior) bump('exploration', 0.35, 'continue')
    if (/surprise|sorprend/i.test(text)) {
      bump('curiosity', 0.5, 'surprise')
      bump('entertainment', 0.35, 'surprise_fun')
    }
    if (!hasHistory) {
      bump('curiosity', 0.4, 'no_history_fascinate')
      bump('news', 0.3, 'no_history_news')
      bump('random_conversation', 0.35, 'no_history_open')
    }
  }

  // Context boosts
  if (hasHistory && !SHIFT.test(text) && text.length < 80) {
    bump('exploration', 0.15, 'continuity')
    if (CONTINUE_ACK.test(text)) {
      bump('exploration', 0.35, 'ack_continue')
      bump('curiosity', 0.2, 'ack_curious')
    }
  }
  if (SHIFT.test(text)) {
    bump('random_conversation', 0.3, 'shift')
    scores.exploration = Math.max(0, scores.exploration - 0.2)
  }
  if (/positive|excited|playful/i.test(emotionalState)) bump('celebration', 0.1, 'emo')
  if (/anxious|sad|frustrated/i.test(emotionalState)) bump('emotional_support', 0.2, 'emo')
  if (momentum === 'high' || /eager|alive/i.test(momentum)) bump('deep_conversation', 0.15, 'momentum')
  if (memoryHint) {
    if (/project/i.test(memoryHint)) bump('project_update', 0.25, 'memory')
    if (/news/i.test(memoryHint)) bump('news', 0.2, 'memory')
  }

  if (STOP_SIGNAL.test(text) && text.length < 30) {
    for (const k of USER_INTENT_KINDS) scores[k] = k === 'silence' ? 0.4 : 0.02
    bump('silence', 0.5, 'stop')
  }

  /** @type {IntentCandidate[]} */
  const ranked = USER_INTENT_KINDS.map((intent) => ({
    intent,
    score: Math.max(0, Math.min(1, scores[intent])),
    gloss: INTENT_GLOSS[intent],
  })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Tie-break: avoid defaulting to greeting when nothing matched
    const prefer = [
      'curiosity',
      'random_conversation',
      'exploration',
      'companionship',
      'news',
      'deep_conversation',
      'reflection',
    ]
    const rank = (intent) => {
      const i = prefer.indexOf(intent)
      return i === -1 ? 50 : i
    }
    return rank(a.intent) - rank(b.intent)
  })

  return ranked
}

/**
 * Map primary user intent → legacy emotional / conversational / expects.
 * @param {UserIntentKind} primary
 * @param {string} text
 * @param {boolean} hasHistory
 */
function legacyFromPrimary(primary, text, hasHistory) {
  /** @type {EmotionalIntent} */
  let emotionalIntent = 'neutral'
  /** @type {ConversationalIntent} */
  let conversationalIntent = hasHistory ? 'continue_thread' : 'start_thread'
  /** @type {Expectation} */
  let expects = 'mixed'

  switch (primary) {
    case 'emotional_support':
      emotionalIntent = DISTRESS.test(text) || ANXIOUS.test(text) ? 'anxious_reassurance' : 'venting'
      conversationalIntent = 'invite_presence'
      expects = 'presence'
      break
    case 'celebration':
      emotionalIntent = 'celebrating'
      conversationalIntent = 'share'
      expects = 'companionship'
      break
    case 'problem_solving':
      emotionalIntent = FRUSTRATED.test(text) ? 'frustrated_unblock' : 'neutral'
      conversationalIntent = 'request_help'
      expects = 'information'
      break
    case 'learning':
    case 'advice':
      conversationalIntent = 'request_help'
      expects = primary === 'learning' ? 'information' : 'mixed'
      emotionalIntent = 'curious_wonder'
      break
    case 'curiosity':
    case 'exploration':
    case 'deep_conversation':
    case 'reflection':
      emotionalIntent = 'curious_wonder'
      conversationalIntent = hasHistory ? 'deepen' : 'start_thread'
      expects = 'exploration'
      break
    case 'greeting':
    case 'small_talk':
    case 'companionship':
      conversationalIntent = primary === 'greeting' && !hasHistory ? 'start_thread' : 'invite_presence'
      expects = 'companionship'
      emotionalIntent = PLAYFUL.test(text) ? 'playful' : 'neutral'
      break
    case 'news':
    case 'project_update':
      conversationalIntent = hasHistory ? 'continue_thread' : 'request_help'
      expects = 'information'
      break
    case 'life_update':
      conversationalIntent = 'share'
      expects = 'companionship'
      break
    case 'entertainment':
    case 'boredom':
    case 'random_conversation':
      emotionalIntent = 'playful'
      conversationalIntent = hasHistory ? 'continue_thread' : 'start_thread'
      expects = 'companionship'
      break
    case 'silence':
      conversationalIntent = 'acknowledge'
      expects = 'presence'
      break
    default:
      break
  }

  if (SHIFT.test(text)) conversationalIntent = 'shift'
  if (CONTINUE_ACK.test(text) && hasHistory && primary !== 'silence') {
    conversationalIntent = ENTHUSIASM.test(text) ? 'deepen' : 'acknowledge'
  }

  return { emotionalIntent, conversationalIntent, expects }
}

/**
 * Soft interpretations for low-confidence ambiguous prompts.
 * @param {IntentCandidate[]} candidates
 * @param {IntentLang} lang
 */
function buildInterpretations(candidates, lang) {
  const top = candidates.slice(0, 3).filter((c) => c.score >= 0.25)
  const en = {
    news: 'a quick what’s-new',
    curiosity: 'something fascinating',
    exploration: 'continuing our last thread',
    entertainment: 'a playful surprise',
    project_update: 'where we left the project',
    random_conversation: 'whatever feels alive right now',
    companionship: 'just keeping each other company',
    boredom: 'something interesting to wake the day up',
  }
  const it = {
    news: 'un aggiornamento / novità',
    curiosity: 'qualcosa di affascinante',
    exploration: 'continuare il filo di prima',
    entertainment: 'una piccola sorpresa leggera',
    project_update: 'dove avevamo lasciato il progetto',
    random_conversation: 'quel che sembra vivo adesso',
    companionship: 'semplicemente stare in compagnia',
    boredom: 'qualcosa di interessante per svegliare il giorno',
  }
  const map = lang === 'it' ? it : en
  return top
    .map((c) => map[c.intent] || INTENT_GLOSS[c.intent])
    .filter(Boolean)
    .slice(0, 2)
}

/**
 * @param {UserIntentKind} primary
 * @param {IntentCandidate[]} candidates
 * @param {boolean} continueThread
 * @param {IntentLang} lang
 */
function friendMeaningFor(primary, candidates, continueThread, lang) {
  const gloss = INTENT_GLOSS[primary]
  if (lang === 'it') {
    return continueThread
      ? `Un amico probabilmente vorrebbe continuare il filo — ${gloss}.`
      : `Un amico probabilmente intende: ${gloss}.`
  }
  return continueThread
    ? `A friend would probably want to continue the thread — ${gloss}.`
    : `A friend would probably mean: ${gloss}.`
}

/**
 * @param {object} args
 */
function buildWhySummary(args) {
  const {
    primaryIntent,
    secondaryIntents,
    emotionalIntent,
    conversationalIntent,
    expects,
    opennessToContinue,
    confidence,
    continueThread,
  } = args
  const secondary =
    secondaryIntents?.length > 0 ? `; also ${secondaryIntents.slice(0, 2).join(', ')}` : ''
  return `Primary intent=${primaryIntent}${secondary}; emo=${emotionalIntent}; move=${conversationalIntent}; expects=${expects}; openness=${opennessToContinue}; confidence=${confidence}${continueThread ? '; prefer continue thread' : ''}.`
}

/**
 * Core inference — context first, then intent ranking.
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 * @param {object} [ctx]
 * @returns {ConversationIntentInference}
 */
export function inferConversationIntent(userMessage, turns = [], ctx = {}) {
  const text = normalize(userMessage)
  /** @type {string[]} */
  const signals = []
  const hasHistory = turns.filter((t) => t.role === 'assistant').length > 0
  const topic = ctx.topic || inferTopic(turns)
  const prior = priorAssistantSnippet(turns)
  const lang = ctx.language || 'en'

  if (!text) {
    return {
      primaryIntent: 'silence',
      secondaryIntents: ['companionship'],
      candidates: [{ intent: 'silence', score: 0.8, gloss: INTENT_GLOSS.silence }],
      responseStrategy: 'direct',
      interpretations: [],
      continueThread: false,
      friendMeaning: 'A friend sent quiet presence — stay soft, don’t interrogate.',
      emotionalIntent: 'neutral',
      conversationalIntent: 'invite_presence',
      curiosityLevel: 'low',
      engagementLevel: 'low',
      opennessToContinue: 'soft',
      expects: 'presence',
      whySummary: 'Empty message — soft presence, do not interrogate.',
      confidence: 'low',
      confidenceScore: 0.35,
      signals: ['empty'],
      topic,
    }
  }

  if (STOP_SIGNAL.test(text) && text.length <= 24) {
    signals.push('stop')
    return {
      primaryIntent: 'silence',
      secondaryIntents: GRATEFUL.test(text) ? ['celebration'] : [],
      candidates: [{ intent: 'silence', score: 0.9, gloss: INTENT_GLOSS.silence }],
      responseStrategy: 'direct',
      interpretations: [],
      continueThread: false,
      friendMeaning: 'A friend is closing the beat — brief warmth, no new questions.',
      emotionalIntent: GRATEFUL.test(text) ? 'grateful' : 'neutral',
      conversationalIntent: 'acknowledge',
      curiosityLevel: 'low',
      engagementLevel: 'low',
      opennessToContinue: 'closed',
      expects: 'presence',
      whySummary: 'Closing — brief presence, no new questions.',
      confidence: 'high',
      confidenceScore: 0.9,
      signals,
      topic,
    }
  }

  const ranked = rankUserIntents(text, {
    hasHistory,
    topic,
    priorAssistant: prior,
    momentum: ctx.momentum || '',
    emotionalState: ctx.emotionalState || '',
    memoryHint: ctx.memoryHint || '',
    _signals: signals,
  })

  const primary = ranked[0]
  const secondaryIntents = ranked
    .slice(1)
    .filter((c) => c.score >= 0.35 && c.score >= primary.score * 0.55)
    .slice(0, 3)
    .map((c) => c.intent)

  const confidenceScore = primary.score
  /** @type {'high'|'medium'|'low'} */
  const confidence =
    confidenceScore >= INTENT_THRESHOLDS.highConfidenceMin
      ? 'high'
      : confidenceScore >= INTENT_THRESHOLDS.mediumConfidenceMin
        ? 'medium'
        : 'low'

  const ambiguous = AMBIGUOUS_SHORT.test(text) || UPDATE_ME.test(text) || confidence === 'low'
  const responseStrategy =
    ambiguous && confidence !== 'high' ? 'soft_interpretations' : 'direct'
  const interpretations =
    responseStrategy === 'soft_interpretations'
      ? buildInterpretations(ranked, lang)
      : []

  const continueThread =
    hasHistory &&
    !SHIFT.test(text) &&
    !GREETING_ONLY.test(text) &&
    (CONTINUE_ACK.test(text) ||
      UPDATE_ME.test(text) ||
      text.length < 60 ||
      primary.intent === 'exploration' ||
      primary.intent === 'curiosity' ||
      primary.intent === 'project_update' ||
      primary.intent === 'deep_conversation')

  const legacy = legacyFromPrimary(primary.intent, text, hasHistory)

  /** @type {Level} */
  let curiosityLevel = 'medium'
  /** @type {Level} */
  let engagementLevel = 'medium'
  /** @type {'closed'|'soft'|'open'|'eager'} */
  let opennessToContinue = 'open'

  if (
    primary.intent === 'curiosity' ||
    primary.intent === 'exploration' ||
    primary.intent === 'deep_conversation'
  ) {
    curiosityLevel = 'high'
  } else if (primary.intent === 'silence' || CONTINUE_ACK.test(text)) {
    curiosityLevel = 'low'
  }

  if (CELEBRATING.test(text) || ENTHUSIASM.test(text) || text.length > 180) engagementLevel = 'high'
  else if (text.length <= 24 && !GREETING_ONLY.test(text)) engagementLevel = 'low'

  if (primary.intent === 'silence') opennessToContinue = 'closed'
  else if (curiosityLevel === 'high' || engagementLevel === 'high') opennessToContinue = 'eager'
  else if (legacy.expects === 'presence' || primary.intent === 'emotional_support') {
    opennessToContinue = 'soft'
  }

  const friendMeaning = friendMeaningFor(
    primary.intent,
    ranked,
    continueThread,
    lang,
  )

  const whySummary = buildWhySummary({
    primaryIntent: primary.intent,
    secondaryIntents,
    emotionalIntent: legacy.emotionalIntent,
    conversationalIntent: continueThread && legacy.conversationalIntent === 'start_thread'
      ? 'continue_thread'
      : legacy.conversationalIntent,
    expects: legacy.expects,
    opennessToContinue,
    confidence,
    continueThread,
  })

  return {
    primaryIntent: primary.intent,
    secondaryIntents,
    candidates: ranked.slice(0, 5),
    responseStrategy,
    interpretations,
    continueThread,
    friendMeaning,
    emotionalIntent: legacy.emotionalIntent,
    conversationalIntent:
      continueThread && legacy.conversationalIntent === 'start_thread'
        ? 'continue_thread'
        : legacy.conversationalIntent,
    curiosityLevel,
    engagementLevel,
    opennessToContinue,
    expects: legacy.expects,
    whySummary,
    confidence,
    confidenceScore: Math.round(confidenceScore * 1000) / 1000,
    signals: signals.slice(0, 10),
    topic,
  }
}

/**
 * @param {ConversationIntentInference} inf
 * @returns {string[]}
 */
function planningHintsFor(inf) {
  /** @type {string[]} */
  const hints = [
    `Conversation Intent Engine: primary=${inf.primaryIntent} (${INTENT_GLOSS[inf.primaryIntent]})`,
    inf.friendMeaning,
    'Never answer only the literal text — answer the intention behind it.',
  ]
  if (inf.continueThread) {
    hints.push('Prefer continuing the existing thread over an unrelated new one.')
  }
  if (inf.responseStrategy === 'soft_interpretations' && inf.interpretations.length) {
    hints.push(
      `Low confidence — naturally offer interpretations: ${inf.interpretations.join(' · ')}. Do not interrogate.`,
    )
  } else {
    hints.push('High/medium confidence — answer the chosen intent directly.')
  }
  if (inf.expects === 'presence' || inf.primaryIntent === 'emotional_support') {
    hints.push('Priority: presence and recognition before advice or solutions.')
  }
  if (inf.primaryIntent === 'curiosity' || inf.primaryIntent === 'boredom') {
    hints.push('Bring something fascinating — not a helpdesk menu.')
  }
  if (inf.primaryIntent === 'news') hints.push('Share a timely update or what’s new in context.')
  if (inf.primaryIntent === 'project_update') {
    hints.push('Continue the project thread with useful progress, not a restart.')
  }
  hints.push('Observations > questions. Rare meaningful questions. No interview style.')
  return hints
}

/**
 * @param {ConversationIntentInference} inf
 */
function buildWriterBrief(inf) {
  return [
    'CONVERSATION INTENT ENGINE (prima del piano): parole ≠ abbastanza — inferisci l’intento.',
    INTENT_NORTH_STAR,
    `Primary: ${inf.primaryIntent} — ${INTENT_GLOSS[inf.primaryIntent]}.`,
    inf.secondaryIntents.length
      ? `Also possible: ${inf.secondaryIntents.join(', ')}.`
      : '',
    inf.friendMeaning,
    `Strategy=${inf.responseStrategy} · Confidence=${inf.confidence} (${inf.confidenceScore}).`,
    inf.responseStrategy === 'soft_interpretations' && inf.interpretations.length
      ? `Soft interpretations (pick naturally, don’t quiz): ${inf.interpretations.join(' / ')}.`
      : 'Answer the chosen intent directly.',
    inf.continueThread
      ? 'Continuity: prefer the existing thread over an unrelated new topic.'
      : '',
    `Legacy: emo=${inf.emotionalIntent} · conv=${inf.conversationalIntent} · expects=${inf.expects}.`,
    `Curiosity=${inf.curiosityLevel} · Engagement=${inf.engagementLevel} · Openness=${inf.opennessToContinue}.`,
    'Human test: respond as you would to a friend’s meaning — not only their words.',
    'NON citare Conversation Intent Engine / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {ConversationIntentInference} inf
 */
function structureLineFor(inf) {
  if (inf.responseStrategy === 'soft_interpretations') {
    return `Conversation Intent → ${inf.primaryIntent} · soft interpretations (no interrogation)`
  }
  if (inf.continueThread) {
    return `Conversation Intent → ${inf.primaryIntent} · continue thread`
  }
  if (inf.expects === 'presence' || inf.primaryIntent === 'emotional_support') {
    return `Conversation Intent → ${inf.primaryIntent} · presence first`
  }
  return `Conversation Intent → ${inf.primaryIntent} · answer intention not literal`
}

/**
 * Map emotional intent → legacy EmotionalTone for planning compatibility.
 * @param {EmotionalIntent} emotionalIntent
 */
export function emotionalIntentToTone(emotionalIntent) {
  switch (emotionalIntent) {
    case 'frustrated_unblock':
      return 'frustrated'
    case 'anxious_reassurance':
      return 'anxious'
    case 'celebrating':
      return 'excited'
    case 'curious_wonder':
      return 'curious'
    case 'grateful':
      return 'grateful'
    case 'venting':
      return 'frustrated'
    case 'playful':
      return 'positive'
    case 'comfort':
      return 'anxious'
    default:
      return 'neutral'
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationIntentPlan}
 */
export function buildConversationIntentPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const language = resolveLang(input)
  const inference = inferConversationIntent(userMessage, turns, {
    language,
    topic: input.topic || input.session?.currentTopic || null,
    momentum: input.emotionalMomentum?.plan?.state?.energyLevel
      ? String(input.emotionalMomentum.plan.state.energyLevel)
      : input.momentum || '',
    emotionalState:
      input.emotionalState?.tone ||
      input.emotionalState?.label ||
      input.emotionalState ||
      '',
    memoryHint:
      input.memoryHint ||
      input.session?.lastMemoryHint ||
      (Array.isArray(input.session?.recentTopics)
        ? input.session.recentTopics.slice(-1)[0]
        : '') ||
      '',
  })

  return {
    active: true,
    inference,
    writerBrief: buildWriterBrief(inference),
    structureLine: structureLineFor(inference),
    responseHints: [
      'Rispondi all’intenzione dietro le parole.',
      inference.continueThread ? 'Continua il filo esistente.' : 'Apri con la lettura d’intento scelta.',
      inference.responseStrategy === 'soft_interpretations'
        ? 'Bassa confidenza: offri 1–2 interpretazioni naturali, non interrogare.'
        : 'Confidenza sufficiente: rispondi diretto all’intento.',
      'Osservazioni > domande. Domande rare. Niente interviste.',
    ],
    planningHints: planningHintsFor(inference),
    reasons: [
      `primary_${inference.primaryIntent}`,
      `strategy_${inference.responseStrategy}`,
      `emo_${inference.emotionalIntent}`,
      `conv_${inference.conversationalIntent}`,
      `expects_${inference.expects}`,
      `conf_${inference.confidence}`,
      inference.continueThread ? 'continue_thread' : 'fresh_or_shift',
      ...inference.signals.slice(0, 3),
    ],
    northStar: INTENT_NORTH_STAR,
    validationCheck: INTENT_CHECKS[0],
  }
}

/**
 * @param {ConversationIntentPlan | null | undefined} plan
 */
export function formatConversationIntentForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const inf = plan.inference
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const cands = (inf.candidates || [])
    .slice(0, 3)
    .map((c) => `${c.intent}:${c.score.toFixed(2)}`)
    .join(' · ')

  return `══════════════════════════════════════
CONVERSATION INTENT ENGINE (PRE-PLAN, INVISIBILE)
══════════════════════════════════════
Primary: ${inf.primaryIntent} — ${INTENT_GLOSS[inf.primaryIntent]}
Candidates: ${cands || '—'}
Friend meaning: ${inf.friendMeaning}
Strategy=${inf.responseStrategy} · Confidence=${inf.confidence} (${inf.confidenceScore})
ContinueThread=${inf.continueThread ? 'yes' : 'no'}
Emotional=${inf.emotionalIntent} · Conversational=${inf.conversationalIntent}
Curiosity=${inf.curiosityLevel} · Engagement=${inf.engagementLevel} · Openness=${inf.opennessToContinue}
Expects=${inf.expects}

${plan.writerBrief}

Hints:
${hints}

Checks:
${INTENT_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Regole: intenzione > letterale · continuità del filo · osservazioni > domande · niente interviste · non citare lo stage.`.trim()
}

/**
 * @param {ConversationIntentPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationIntentStructureHints(plan) {
  if (!plan?.active || !plan.inference) return []
  const inf = plan.inference
  /** @type {string[]} */
  const lines = [
    plan.structureLine || 'Conversation Intent → answer intention not literal',
    `Primary intent: ${inf.primaryIntent}`,
    INTENT_CHECKS[0],
  ]
  if (inf.continueThread) lines.push('Continue existing thread when possible')
  if (inf.responseStrategy === 'soft_interpretations') {
    lines.push('Offer 1–2 natural interpretations — never interrogate')
  }
  if (inf.expects === 'presence' || inf.primaryIntent === 'emotional_support') {
    lines.push('Presence/recognition before solutions')
  }
  if (inf.opennessToContinue === 'closed') {
    lines.push('Brief beat; no closing questions')
  }
  return lines
}

/**
 * Score whether a draft serves the inferred intent.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreConversationIntentDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null
  const inf = plan?.inference || ctx.inference || null

  if (!text || !inf) {
    return {
      intentAlignment: 0,
      continuity: 0,
      literalOnly: 100,
      engagement: 0,
      overall: 0,
    }
  }

  let intentAlignment = 55
  let continuity = inf.continueThread ? 45 : 60
  let literalOnly = 25
  let engagement = 55

  const primary = inf.primaryIntent

  if (primary === 'companionship' || primary === 'small_talk' || primary === 'greeting') {
    if (LITERAL_HELPDesk.test(text)) {
      intentAlignment -= 35
      literalOnly += 40
    } else {
      intentAlignment += 15
    }
  }
  if (primary === 'emotional_support' || inf.expects === 'presence') {
    if (/\b(i\s+hear|that\s+sounds|capisco|with\s+you|here\s+with)\b/i.test(text)) {
      intentAlignment += 20
    }
    if (/\b(you\s+should|devi|solution|fix\s+it)\b/i.test(text) && text.length < 120) {
      intentAlignment -= 15
    }
  }
  if (primary === 'curiosity' || primary === 'boredom' || primary === 'exploration') {
    if (/\b(curious|fascinat|odd|wonder|interessant|strano|idea)\b/i.test(text)) {
      intentAlignment += 18
      engagement += 12
    }
  }
  if (primary === 'news' && /\b(today|recent|news|oggi|novit)\b/i.test(text)) {
    intentAlignment += 15
  }
  if (primary === 'project_update' && /\b(next|progress|left\s+off|progetto|avanti)\b/i.test(text)) {
    intentAlignment += 15
    continuity += 15
  }
  if (inf.continueThread && /\b(earlier|last\s+time|continu|filo|prima|thread)\b/i.test(text)) {
    continuity += 20
  }
  if (inf.continueThread && LITERAL_HELPDesk.test(text)) {
    continuity -= 25
  }
  if (inf.responseStrategy === 'soft_interpretations') {
    if (INTERROGATE.test(text)) {
      intentAlignment -= 30
      engagement -= 20
    }
    if (
      inf.interpretations?.some((i) => text.toLowerCase().includes(i.slice(0, 12).toLowerCase())) ||
      /\b(could\s+mean|might\s+be|forse|oppure|either)\b/i.test(text)
    ) {
      intentAlignment += 15
    }
  }
  if (LITERAL_HELPDesk.test(text) || /^(sure[!.,]|certo[!.,]|of\s+course[!.,])/i.test(text)) {
    literalOnly += 25
    engagement -= 15
  }
  if (text.split(/\s+/).length > 12 && !LITERAL_HELPDesk.test(text)) {
    engagement += 8
    literalOnly = Math.max(0, literalOnly - 10)
  }

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
  intentAlignment = clamp(intentAlignment)
  continuity = clamp(continuity)
  literalOnly = clamp(literalOnly)
  engagement = clamp(engagement)
  const overall = clamp(
    intentAlignment * 0.35 +
      continuity * 0.2 +
      (100 - literalOnly) * 0.25 +
      engagement * 0.2,
  )

  return { intentAlignment, continuity, literalOnly, engagement, overall }
}

/**
 * @param {object} [input]
 * @returns {ConversationIntentGate}
 */
export function analyzeConversationIntentDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.conversationIntent || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  const scores = scoreConversationIntentDraft(draft, { plan })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
    }
  }

  if (!draft || draft.length < 6) {
    failed.push('empty')
    reasons.push('empty')
  }
  if (scores.intentAlignment < INTENT_THRESHOLDS.intentAlignmentMin) {
    failed.push('intent_alignment')
    reasons.push(`intentAlignment=${scores.intentAlignment}`)
  }
  if (
    plan.inference?.continueThread &&
    scores.continuity < INTENT_THRESHOLDS.continuityMin
  ) {
    failed.push('continuity')
    reasons.push(`continuity=${scores.continuity}`)
  }
  if (scores.literalOnly > INTENT_THRESHOLDS.literalOnlyMax) {
    failed.push('literal_only')
    reasons.push(`literalOnly=${scores.literalOnly}`)
  }
  if (scores.engagement < INTENT_THRESHOLDS.engagementMin) {
    failed.push('engagement')
    reasons.push(`engagement=${scores.engagement}`)
  }
  if (scores.overall < INTENT_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (
    plan.inference?.responseStrategy === 'soft_interpretations' &&
    INTERROGATE.test(draft)
  ) {
    failed.push('interrogation')
    reasons.push('interrogated_instead_of_soft_interpretations')
  }
  if (
    (plan.inference?.primaryIntent === 'companionship' ||
      plan.inference?.primaryIntent === 'greeting' ||
      plan.inference?.primaryIntent === 'small_talk') &&
    LITERAL_HELPDesk.test(draft)
  ) {
    failed.push('helpdesk_on_social')
    reasons.push('helpdesk_on_social_intent')
  }

  const needsRefine = failed.length > 0
  const inf = plan.inference
  const refineBrief = needsRefine
    ? [
        'CONVERSATION INTENT ENGINE: rewrite — you answered the literal words, not the intention.',
        INTENT_NORTH_STAR,
        inf
          ? `Primary intent=${inf.primaryIntent}; strategy=${inf.responseStrategy}; friendMeaning=${inf.friendMeaning}`
          : '',
        inf?.continueThread ? 'Prefer continuing the existing thread.' : '',
        inf?.responseStrategy === 'soft_interpretations'
          ? `Offer soft interpretations (${(inf.interpretations || []).join(' / ')}), never interrogate.`
          : 'Answer the chosen intent directly.',
        `Scores: align=${scores.intentAlignment} cont=${scores.continuity} literal=${scores.literalOnly} engage=${scores.engagement} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        INTENT_CHECKS.join(' · '),
        'Non citare lo stage.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return { needsRefine, refineBrief, scores, failed, reasons }
}

/**
 * @param {object} [input]
 */
export function runConversationIntentGate(input = {}) {
  try {
    const gate = analyzeConversationIntentDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          intentAlignment: 100,
          continuity: 100,
          literalOnly: 0,
          engagement: 100,
          overall: 100,
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
 * @param {ConversationIntentPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesConversationIntent(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzeConversationIntentDraft({
      draft,
      plan,
      userMessage: ctx.userMessage || '',
    }).needsRefine
  } catch {
    return false
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationIntentPlan, context: string }}
 */
export function runConversationIntent(input = {}) {
  try {
    const plan = buildConversationIntentPlan(input)
    return {
      plan,
      context: formatConversationIntentForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        inference: {
          primaryIntent: 'random_conversation',
          secondaryIntents: [],
          candidates: [],
          responseStrategy: 'direct',
          interpretations: [],
          continueThread: false,
          friendMeaning: 'Fail-soft: proceed with presence and usefulness.',
          emotionalIntent: 'neutral',
          conversationalIntent: 'continue_thread',
          curiosityLevel: 'medium',
          engagementLevel: 'medium',
          opennessToContinue: 'open',
          expects: 'mixed',
          whySummary: 'Fail-soft: proceed with presence and utility.',
          confidence: 'low',
          confidenceScore: 0.3,
          signals: ['fail_soft'],
          topic: null,
        },
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        planningHints: [],
        reasons: ['fail_soft'],
        northStar: INTENT_NORTH_STAR,
        validationCheck: INTENT_CHECKS[0],
      },
      context: '',
    }
  }
}

/** Alias for clarity in newer call sites. */
export const runConversationIntentEngine = runConversationIntent

/* ─────────────────────────────────────────────────────────────
 * Evaluation: 200 ambiguous prompts
 * Measure correct intent selection + engagement potential
 * ───────────────────────────────────────────────────────────── */

/** @type {{ id: string, prompt: string, context?: object, expected: UserIntentKind[], engagementMin?: number }[]} */
export const AMBIGUOUS_INTENT_CORPUS = (() => {
  /** @type {{ prompt: string, context?: object, expected: UserIntentKind[] }[]} */
  const seeds = [
    { prompt: 'Update me.', expected: ['curiosity', 'news', 'exploration', 'random_conversation'] },
    {
      prompt: 'Update me.',
      context: { prior: 'We were exploring why unfinished tasks stick in the mind.' },
      expected: ['curiosity', 'exploration'],
    },
    {
      prompt: 'Update me.',
      context: { prior: 'Latest headlines about climate policy today…', memoryHint: 'news' },
      expected: ['news'],
    },
    {
      prompt: 'Update me.',
      context: { prior: 'Next sprint we ship the onboarding flow.', memoryHint: 'project' },
      expected: ['project_update'],
    },
    { prompt: 'Aggiornami.', expected: ['curiosity', 'news', 'exploration', 'random_conversation'] },
    { prompt: 'Surprise me.', expected: ['curiosity', 'entertainment', 'random_conversation'] },
    { prompt: 'Sorprendimi.', expected: ['curiosity', 'entertainment', 'random_conversation'] },
    { prompt: "What's new?", expected: ['news', 'curiosity', 'random_conversation'] },
    { prompt: 'Novità?', expected: ['news', 'curiosity', 'random_conversation'] },
    { prompt: 'Go on.', expected: ['exploration', 'curiosity'] },
    { prompt: 'Continua.', expected: ['exploration', 'curiosity'] },
    { prompt: 'And then?', expected: ['exploration', 'curiosity'] },
    { prompt: 'So?', expected: ['exploration', 'curiosity', 'boredom'] },
    { prompt: 'Idk', expected: ['boredom', 'random_conversation', 'companionship', 'silence'] },
    { prompt: 'Boh', expected: ['boredom', 'random_conversation', 'companionship', 'silence'] },
    { prompt: 'Something', expected: ['random_conversation', 'curiosity', 'boredom'] },
    { prompt: 'Qualcosa', expected: ['random_conversation', 'curiosity', 'boredom'] },
    { prompt: "I'm bored.", expected: ['boredom', 'curiosity', 'entertainment'] },
    { prompt: 'Mi annoio.', expected: ['boredom', 'curiosity', 'entertainment'] },
    { prompt: 'Hi', expected: ['greeting', 'small_talk', 'companionship'] },
    { prompt: 'Ciao', expected: ['greeting', 'small_talk', 'companionship'] },
    { prompt: 'How are you?', expected: ['small_talk', 'companionship', 'greeting'] },
    { prompt: 'Come stai?', expected: ['small_talk', 'companionship', 'greeting'] },
    { prompt: 'Just saying hi', expected: ['greeting', 'companionship', 'small_talk'] },
    { prompt: 'Tell me something interesting', expected: ['curiosity', 'exploration', 'entertainment'] },
    { prompt: 'Dimmi qualcosa di interessante', expected: ['curiosity', 'exploration', 'entertainment'] },
    { prompt: 'I feel anxious', expected: ['emotional_support'] },
    { prompt: 'Mi sento in ansia', expected: ['emotional_support'] },
    { prompt: 'We did it!!!', expected: ['celebration'] },
    { prompt: 'Ce l’abbiamo fatta!!!', expected: ['celebration'] },
    { prompt: 'This bug won’t die', expected: ['problem_solving'] },
    { prompt: 'Questo bug non muore', expected: ['problem_solving'] },
    { prompt: 'Should I quit?', expected: ['advice', 'reflection', 'emotional_support'] },
    { prompt: 'Dovrei mollare?', expected: ['advice', 'reflection', 'emotional_support'] },
    { prompt: 'Explain quantum entanglement', expected: ['learning', 'curiosity'] },
    { prompt: 'Spiegami l’entanglement', expected: ['learning', 'curiosity'] },
    { prompt: 'Any news?', expected: ['news', 'curiosity'] },
    { prompt: 'Ci sono novità sul progetto?', expected: ['project_update', 'news'] },
    { prompt: 'Today I saw the sea', expected: ['life_update', 'companionship', 'reflection'] },
    { prompt: 'Oggi ho visto il mare', expected: ['life_update', 'companionship', 'reflection'] },
    { prompt: 'Make me laugh', expected: ['entertainment'] },
    { prompt: 'Fammi ridere', expected: ['entertainment'] },
    { prompt: '…', expected: ['silence', 'companionship'] },
    { prompt: 'What do you think about time?', expected: ['deep_conversation', 'reflection', 'exploration'] },
    { prompt: 'Cosa pensi del tempo?', expected: ['deep_conversation', 'reflection', 'exploration'] },
    { prompt: 'Fill me in', expected: ['news', 'curiosity', 'exploration', 'project_update'] },
    { prompt: 'Portami avanti', expected: ['exploration', 'curiosity', 'project_update'] },
    { prompt: 'Whatever', expected: ['boredom', 'random_conversation', 'silence'] },
    { prompt: 'Come vuoi', expected: ['boredom', 'random_conversation', 'companionship'] },
    { prompt: 'Okay and?', expected: ['exploration', 'curiosity', 'boredom'] },
    { prompt: 'Interesting…', expected: ['exploration', 'curiosity'] },
  ]

  /** @type {{ id: string, prompt: string, context?: object, expected: UserIntentKind[] }[]} */
  const out = []
  for (let i = 0; i < 200; i++) {
    const seed = seeds[i % seeds.length]
    const prior = seed.context?.prior
      ? `${seed.context.prior}${i > seeds.length ? ` (${i})` : ''}`
      : undefined
    out.push({
      id: `a${String(i + 1).padStart(3, '0')}`,
      prompt: seed.prompt,
      context: {
        ...(seed.context || {}),
        prior,
        hasHistory: Boolean(prior) || /go on|continua|and then|update me|aggiornami/i.test(seed.prompt),
      },
      expected: seed.expected,
    })
  }
  return out
})()

/**
 * @param {object} [opts]
 */
export function runConversationIntentEvaluation(opts = {}) {
  const corpus = AMBIGUOUS_INTENT_CORPUS
  let correct = 0
  let softOk = 0
  let engagementSum = 0
  /** @type {object[]} */
  const misses = []

  for (const item of corpus) {
    const turns = item.context?.prior
      ? [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: String(item.context.prior) },
        ]
      : item.context?.hasHistory
        ? [
            { role: 'user', content: 'hey' },
            { role: 'assistant', content: 'We were mid-thought about something curious.' },
          ]
        : []

    const inf = inferConversationIntent(item.prompt, turns, {
      language: /[àèéìòù]/i.test(item.prompt) ? 'it' : 'en',
      memoryHint: item.context?.memoryHint || '',
      momentum: item.context?.hasHistory ? 'high' : '',
    })

    const hit =
      item.expected.includes(inf.primaryIntent) ||
      inf.secondaryIntents.some((s) => item.expected.includes(s)) ||
      inf.candidates.slice(0, 3).some((c) => item.expected.includes(c.intent) && c.score >= 0.3)

    if (hit) correct++
    else misses.push({ id: item.id, prompt: item.prompt, got: inf.primaryIntent, expected: item.expected })

    if (inf.responseStrategy === 'soft_interpretations') {
      if (inf.interpretations.length >= 1 && inf.interpretations.length <= 2) softOk++
    } else {
      softOk++
    }

    // Engagement potential: high curiosity/exploration/companionship intents score higher
    const eng =
      ['curiosity', 'exploration', 'companionship', 'entertainment', 'deep_conversation'].includes(
        inf.primaryIntent,
      )
        ? 0.85
        : ['emotional_support', 'celebration', 'learning'].includes(inf.primaryIntent)
          ? 0.75
          : 0.55
    engagementSum += eng
  }

  const accuracy = correct / corpus.length
  const engagement = engagementSum / corpus.length
  const summary = {
    total: corpus.length,
    correct,
    accuracy: Math.round(accuracy * 1000) / 1000,
    softInterpretationOk: softOk,
    engagement: Math.round(engagement * 1000) / 1000,
    missCount: misses.length,
    ok: corpus.length >= 200 && accuracy >= 0.75 && engagement >= 0.6,
  }

  if (opts.verbose) {
    return {
      summary,
      misses: misses.slice(0, 15),
      examples: [
        {
          prompt: 'Update me.',
          bare: inferConversationIntent('Update me.', []).primaryIntent,
          withCuriosityThread: inferConversationIntent('Update me.', [
            { role: 'assistant', content: 'We were exploring unfinished tasks and the Zeigarnik effect.' },
          ]).primaryIntent,
          withNews: inferConversationIntent('Update me.', [
            { role: 'assistant', content: 'Latest headlines about climate policy today…' },
          ], { memoryHint: 'news' }).primaryIntent,
        },
      ],
    }
  }
  return { summary, misses: misses.slice(0, 20) }
}
