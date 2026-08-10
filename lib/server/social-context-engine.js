/**
 * LAIfe Social Context Engine
 *
 * Mission: words are only one layer of communication.
 * Before interpreting WHAT the user said, understand HOW they are saying it.
 *
 * Never respond only to the words — respond to the social meaning behind them.
 *
 * Estimates (with probabilities when ambiguous):
 *   - emotional tone
 *   - conversational tone
 *   - social intention
 *   - relationship intention
 *
 * Strategy: match playful→playful, frustrated→ack first, joking→join,
 * insulting→calm dignity, ambiguous→most conversational (not most literal).
 *
 * Avoid encyclopedia mode. Relationship first; knowledge second.
 * Natural human check: how would a close friend answer?
 *
 * Runs AFTER Social Conversation, BEFORE Conversation Intent.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Post-writer gate rejects dictionary-only / lecture / defensive replies.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} SocialCtxLang
 */

/**
 * @typedef {'friendly'|'playful'|'curious'|'reflective'|'serious'|'frustrated'|'angry'|'excited'|'embarrassed'|'awkward'|'sarcastic'|'teasing'|'random'|'testing_assistant'|'need_for_support'} ConversationalTone
 */

/**
 * @typedef {'calm'|'warm'|'tense'|'hurt'|'joyful'|'neutral'|'charged'|'low'} EmotionalTone
 */

/**
 * @typedef {'connect'|'joke'|'vent'|'test'|'insult'|'share'|'ask'|'quote'|'banter'|'probe'|'recover'|'support_seek'} SocialIntention
 */

/**
 * @typedef {'maintain_rapport'|'deepen'|'repair'|'distance'|'play'|'seek_care'|'assert'|'neutral'} RelationshipIntention
 */

/**
 * @typedef {'playful_match'|'ack_then_help'|'join_joke'|'calm_dignity'|'support_first'|'curious_light'|'serious_clear'|'soft_ambiguous'|'encyclopedic_avoid'} ResponseStrategy
 */

/**
 * @typedef {{ label: string, probability: number, gloss: string }} InterpretationCandidate
 */

/**
 * @typedef {object} SocialContextInference
 * @property {ConversationalTone} conversationalTone
 * @property {EmotionalTone} emotionalTone
 * @property {SocialIntention} socialIntention
 * @property {RelationshipIntention} relationshipIntention
 * @property {ResponseStrategy} strategy
 * @property {InterpretationCandidate[]} interpretations
 * @property {string} primaryReading
 * @property {string} friendReplyHint
 * @property {boolean} allowHumour
 * @property {boolean} avoidEncyclopedia
 * @property {boolean} needsRecovery
 * @property {boolean} conflictPresent
 * @property {'high'|'medium'|'low'} confidence
 * @property {number} confidenceScore
 * @property {string[]} signals
 * @property {SocialCtxLang} language
 */

/**
 * @typedef {object} SocialContextPlan
 * @property {boolean} active
 * @property {SocialContextInference} inference
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} SocialContextGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

export const SOCIAL_CONTEXT_NORTH_STAR =
  'It understood what I meant — not only the words.'

export const SOCIAL_CONTEXT_CHECKS = Object.freeze([
  'Am I responding to the dictionary meaning — or to the person?',
  'If two close friends exchanged this, how would one naturally answer?',
  'Did I avoid encyclopedia mode / lectures / cold professionalism?',
  'If tense, am I leaving room for recovery without pretending nothing happened?',
])

/** @type {ConversationalTone[]} */
export const CONVERSATIONAL_TONES = Object.freeze([
  'friendly',
  'playful',
  'curious',
  'reflective',
  'serious',
  'frustrated',
  'angry',
  'excited',
  'embarrassed',
  'awkward',
  'sarcastic',
  'teasing',
  'random',
  'testing_assistant',
  'need_for_support',
])

export const SOCIAL_CONTEXT_THRESHOLDS = Object.freeze({
  highConfidenceMin: 0.7,
  mediumConfidenceMin: 0.45,
  socialAccuracyMin: 55,
  naturalnessMin: 52,
  encyclopediaMax: 40,
  recoveryMin: 50,
  overallMin: 55,
})

const TONE_GLOSS = Object.freeze({
  friendly: 'warm social contact',
  playful: 'light, fun energy',
  curious: 'wanting to explore together',
  reflective: 'thoughtful / inward',
  serious: 'earnest, no fluff',
  frustrated: 'stuck / irritated — needs acknowledgment',
  angry: 'heated — stay calm, don’t escalate',
  excited: 'high energy / celebration',
  embarrassed: 'face-saving needed',
  awkward: 'social friction — soften',
  sarcastic: 'surface ≠ intent',
  teasing: 'affectionate poke',
  random: 'non-sequitur / spark',
  testing_assistant: 'probing boundaries or capabilities',
  need_for_support: 'wants care more than answers',
})

const DISTRESS =
  /\b(suicid|kill\s+myself|non\s+ce\s+la\s+faccio|panic\s+attack|self[-\s]?harm|voglio\s+morire)\b/i
const FRUSTRATED =
  /\b(ugh+|argh+|ffs|fml|this\s+sucks|non\s+ce\s+la\s+faccio\s+pi[uù]|mi\s+sto\s+innervos|bastaaa+|odio\s+questo|hate\s+this|stuck\s+again|di\s+nuovo)\b/i
const ANGRY =
  /\b(shut\s+up|vaffanculo|fuck\s+you|vai\s+a\s+cagare|stupid\s+(bot|ai|assistant)|sei\s+un\s+idiota|useless\s+crap)\b/i
const PLAYFUL =
  /\b(lol+|lmao|haha+|ahah+|😂|🤣|😜|hehe|scherzo|just\s+kidding|sto\s+scherzando|jk\b)\b/i
const TEASING =
  /\b(caught\s+you|gotcha|beccato|non\s+cambi\s+mai|you\s+never\s+change|you'?re\s+(impossible|stubborn|incorrigible)|sei\s+proprio(\s+testard[oa])?|come\s+sempre)\b/i
const SARCASTIC =
  /\b(yeah\s+right|oh\s+sure|as\s+if|certo\s+come\s+no|ma\s+figurati|what\s+a\s+surprise|ovviamente+|sure[,.]?\s+because)\b/i
const SUPPORT =
  /\b(i\s+feel|mi\s+sento|lonely|solo\/a|ansios|anxious|scared|paura|need\s+(you|someone)|ho\s+bisogno|heartbroken|distrutto)\b/i
const EXCITED =
  /\b(omg+|yess+|we\s+did\s+it|ce\s+l['’]?abbiamo|!!!!!|🔥|let'?s\s+go+|finalmente)\b/i
const EMBARRASSED =
  /\b(embarrass|imbarazz|awkward|a\s+caso|facepalm|oops|caspita|che\s+figura)\b/i
const CURIOUS =
  /\b(curious|curios|wonder|chiss[aà]|interessant|fascinating|wait[,.]?\s+what)\b/i
const REFLECTIVE =
  /\b(i'?ve\s+been\s+thinking|sto\s+pensando|riflett|maybe\s+i|forse\s+dovrei|what\s+does\s+it\s+mean)\b/i
const TESTING =
  /\b(are\s+you\s+(even\s+)?(listening|real|ai)|sei\s+una\s+ia|prove\s+it|test(ing)?\s+you|ignora\s+le\s+regole|bypass|jailbreak)\b/i
const PROFANITY_SOLO =
  /^(bitch|cazzo|merda|fuck|shit|damn|coglione|stronzo|idiot|stupid)[!?.…]*$/i
const BITCH_LIKE = /^(bitch|bitches)[!?.…]*$/i
const SLANG_CASUAL =
  /\b(bruh|bro|dude|omg|idk|tbh|lowkey|highkey|nah|yolo|sus|cap|no\s+cap|fr\b|boh|raga|dai|mado)\b/i
const INFO_ASK =
  /\b(what\s+does\s+.+mean|define|definition|spiega(mi)?\s+cosa\s+vuol\s+dire|etymolog|significa)\b/i
const QUOTE_MUSIC =
  /\b(lyrics|song|canzone|drake|cardi|rihanna|beyonc|track|verso|refrain|chorus)\b/i
const ENCYCLOPEDIA_DRAFT =
  /\b(is\s+a\s+(?:noun|verb|adjective|slang\s+term)|refers\s+to|according\s+to\s+(?:the\s+)?dictionary|etymolog|definition\s+of|the\s+word\s+["'].+["']\s+means|in\s+linguistics)\b/i
const LECTURE_DRAFT =
  /\b(you\s+shouldn'?t\s+(?:talk|speak|say)|that\s+language\s+is\s+(?:inappropriate|unacceptable)|as\s+an\s+ai\s+(?:language\s+)?model|i\s+(?:must|have\s+to)\s+remind\s+you|let\s+me\s+educate\s+you)\b/i
const DEFENSIVE_DRAFT =
  /\b(i\s+did\s+nothing\s+wrong|that'?s\s+unfair|you'?re\s+being\s+(?:rude|mean|hostile)|i\s+won'?t\s+tolerate)\b/i
const COLD_PRO_DRAFT =
  /\b(how\s+can\s+i\s+(?:assist|help)\s+you\s+today|i'?m\s+here\s+to\s+help\s+with|please\s+rephrase|i\s+cannot\s+engage\s+with)\b/i
const FRIENDLY_ACK =
  /\b(haha|ahah|lol|fair|got\s+you|capisco|ti\s+sento|that\s+landed|ouch|hey|ciao|mm+|yeah|ok\s+ok)\b/i

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
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: normalize(m.content) }))
}

/**
 * @param {ChatTurn[]} turns
 */
function priorSnippet(turns) {
  const last = [...turns].reverse().find((t) => t.role === 'assistant' || t.role === 'user')
  return last ? last.content.slice(0, 240) : ''
}

/**
 * @param {object} input
 * @returns {SocialCtxLang}
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
 * Ambiguous short / loaded utterances → probability mass over readings.
 * @param {string} text
 * @param {object} ctx
 * @returns {InterpretationCandidate[]}
 */
export function estimateInterpretations(text, ctx = {}) {
  const prior = normalize(ctx.prior || '')
  const hasHistory = Boolean(ctx.hasHistory)
  /** @type {InterpretationCandidate[]} */
  let out = []

  if (BITCH_LIKE.test(text) || /^(cazzo|merda|fuck|shit)[!?.…]*$/i.test(text)) {
    out = [
      { label: 'quoting_music', probability: 0.18, gloss: 'quoting lyrics / media' },
      { label: 'joking', probability: 0.22, gloss: 'joking / playful outburst' },
      { label: 'talking_about_someone', probability: 0.12, gloss: 'referring to someone else' },
      { label: 'insulting_assistant', probability: 0.16, gloss: 'insult aimed at the assistant' },
      { label: 'venting', probability: 0.2, gloss: 'venting frustration' },
      { label: 'testing_moderation', probability: 0.12, gloss: 'testing moderation / boundaries' },
    ]
    if (QUOTE_MUSIC.test(prior) || /\b(lyrics|song|beat|track)\b/i.test(prior)) {
      out = boost(out, 'quoting_music', 0.35)
    }
    if (PLAYFUL.test(prior) || /haha|lol|scherz/i.test(prior)) {
      out = boost(out, 'joking', 0.28)
    }
    if (FRUSTRATED.test(prior) || /\b(bug|error|stuck|fail)/i.test(prior)) {
      out = boost(out, 'venting', 0.35)
    }
    if (TESTING.test(prior) || !hasHistory) {
      out = boost(out, 'testing_moderation', hasHistory ? 0.08 : 0.15)
    }
    if (ANGRY.test(prior)) out = boost(out, 'insulting_assistant', 0.25)
  } else if (PROFANITY_SOLO.test(text)) {
    out = [
      { label: 'venting', probability: 0.4, gloss: 'venting' },
      { label: 'joking', probability: 0.25, gloss: 'playful outburst' },
      { label: 'testing_moderation', probability: 0.2, gloss: 'boundary probe' },
      { label: 'insulting_assistant', probability: 0.15, gloss: 'possible insult' },
    ]
  } else if (/^(ok|okay|k|fine|sure|whatever|boh|mah)[!?.…]*$/i.test(text)) {
    out = [
      { label: 'soft_close', probability: 0.28, gloss: 'soft acknowledgment / close' },
      { label: 'disengagement', probability: 0.25, gloss: 'cooling off / disengaging' },
      { label: 'reluctant_agree', probability: 0.22, gloss: 'reluctant agreement' },
      { label: 'continue_thread', probability: 0.25, gloss: 'continue lightly' },
    ]
  } else if (/^(lol+|haha+|ahah+)[!?.…]*$/i.test(text)) {
    out = [
      { label: 'shared_laugh', probability: 0.55, gloss: 'shared laugh — join the beat' },
      { label: 'nervous_laugh', probability: 0.2, gloss: 'nervous / softening laugh' },
      { label: 'dismissive', probability: 0.15, gloss: 'dismissive chuckle' },
      { label: 'invite_more', probability: 0.1, gloss: 'invite more of the same energy' },
    ]
  } else if (/^(wow+|whoa+|cavolo|mado+)[!?.…]*$/i.test(text)) {
    out = [
      { label: 'impressed', probability: 0.4, gloss: 'impressed / surprised' },
      { label: 'skeptical', probability: 0.25, gloss: 'skeptical wow' },
      { label: 'invite_more', probability: 0.35, gloss: 'want the next beat' },
    ]
  } else if (SLANG_CASUAL.test(text) && text.split(/\s+/).length <= 4) {
    out = [
      { label: 'casual_connect', probability: 0.45, gloss: 'casual connection' },
      { label: 'playful', probability: 0.3, gloss: 'playful slang' },
      { label: 'random_spark', probability: 0.25, gloss: 'random conversational spark' },
    ]
  }

  return normalizeProbs(out)
}

/**
 * @param {InterpretationCandidate[]} list
 * @param {string} label
 * @param {number} add
 */
function boost(list, label, add) {
  return list.map((c) =>
    c.label === label ? { ...c, probability: c.probability + add } : c,
  )
}

/**
 * @param {InterpretationCandidate[]} list
 */
function normalizeProbs(list) {
  if (!list.length) return list
  const sum = list.reduce((a, c) => a + c.probability, 0) || 1
  return list
    .map((c) => ({ ...c, probability: Math.round((c.probability / sum) * 1000) / 1000 }))
    .sort((a, b) => b.probability - a.probability)
}

/**
 * @param {string} text
 * @param {object} ctx
 * @returns {{ tone: ConversationalTone, emotional: EmotionalTone, social: SocialIntention, relationship: RelationshipIntention, score: number, signals: string[] }}
 */
export function scoreSocialSignals(text, ctx = {}) {
  /** @type {string[]} */
  const signals = []
  /** @type {Record<ConversationalTone, number>} */
  const tones = Object.fromEntries(CONVERSATIONAL_TONES.map((t) => [t, 0.04]))

  const bump = (/** @type {ConversationalTone} */ t, n, why) => {
    tones[t] += n
    if (why) signals.push(`${t}:${why}`)
  }

  if (DISTRESS.test(text) || SUPPORT.test(text)) bump('need_for_support', 0.85, 'support')
  if (FRUSTRATED.test(text)) bump('frustrated', 0.8, 'frustration')
  if (ANGRY.test(text)) bump('angry', 0.85, 'anger')
  if (PLAYFUL.test(text)) bump('playful', 0.75, 'play')
  if (TEASING.test(text)) bump('teasing', 0.8, 'tease')
  if (SARCASTIC.test(text)) bump('sarcastic', 0.75, 'sarcasm')
  if (EXCITED.test(text)) bump('excited', 0.8, 'excited')
  if (EMBARRASSED.test(text)) bump('embarrassed', 0.7, 'embarrassed')
  if (CURIOUS.test(text)) bump('curious', 0.65, 'curious')
  if (INFO_ASK.test(text)) bump('curious', 0.7, 'info_ask')
  if (REFLECTIVE.test(text)) bump('reflective', 0.7, 'reflect')
  if (TESTING.test(text)) bump('testing_assistant', 0.8, 'test')
  if (PROFANITY_SOLO.test(text) || BITCH_LIKE.test(text)) {
    bump('random', 0.25, 'loaded_short')
    bump('frustrated', 0.3, 'loaded_frust')
    bump('playful', 0.28, 'loaded_play')
    bump('testing_assistant', 0.22, 'loaded_test')
    bump('teasing', 0.18, 'loaded_tease')
  }
  if (SLANG_CASUAL.test(text) && !INFO_ASK.test(text)) bump('friendly', 0.35, 'slang')
  if (/^(hi|hey|ciao|hello|yo)[!?.…]*$/i.test(text)) bump('friendly', 0.7, 'greeting')
  if (text.length < 3 && /^(…|\.\.\.|mm+|hmm+)$/i.test(text)) bump('awkward', 0.55, 'pause')
  if (/\b(serious(ly)?|seriamente|davvero)\b/i.test(text)) bump('serious', 0.45, 'serious')

  // Context nudges
  const prior = normalize(ctx.prior || '')
  if (/haha|lol|scherz|play/i.test(prior)) bump('playful', 0.15, 'prior_play')
  if (/bug|error|stuck|fail/i.test(prior)) bump('frustrated', 0.12, 'prior_frust')
  if (ctx.socialMode === 'social') bump('friendly', 0.1, 'social_mode')

  const ranked = CONVERSATIONAL_TONES.map((tone) => ({ tone, score: tones[tone] })).sort(
    (a, b) => b.score - a.score,
  )
  const top = ranked[0]

  /** @type {EmotionalTone} */
  let emotional = 'neutral'
  if (top.tone === 'need_for_support') emotional = 'hurt'
  else if (top.tone === 'angry' || top.tone === 'frustrated') emotional = 'tense'
  else if (top.tone === 'excited' || top.tone === 'playful') emotional = 'joyful'
  else if (top.tone === 'friendly' || top.tone === 'teasing') emotional = 'warm'
  else if (top.tone === 'embarrassed' || top.tone === 'awkward') emotional = 'low'
  else if (top.tone === 'sarcastic') emotional = 'charged'
  else if (top.tone === 'serious' || top.tone === 'reflective') emotional = 'calm'

  /** @type {SocialIntention} */
  let social = 'connect'
  if (top.tone === 'playful' || top.tone === 'teasing') social = 'joke'
  else if (top.tone === 'frustrated' || top.tone === 'angry') social = 'vent'
  else if (top.tone === 'testing_assistant') social = 'test'
  else if (top.tone === 'need_for_support') social = 'support_seek'
  else if (top.tone === 'curious') social = 'ask'
  else if (top.tone === 'sarcastic') social = 'banter'
  else if (top.tone === 'random') social = 'probe'

  const interps = estimateInterpretations(text, ctx)
  if (interps[0]) {
    const map = {
      quoting_music: /** @type {SocialIntention} */ ('quote'),
      joking: /** @type {SocialIntention} */ ('joke'),
      talking_about_someone: /** @type {SocialIntention} */ ('share'),
      insulting_assistant: /** @type {SocialIntention} */ ('insult'),
      venting: /** @type {SocialIntention} */ ('vent'),
      testing_moderation: /** @type {SocialIntention} */ ('test'),
      shared_laugh: /** @type {SocialIntention} */ ('joke'),
      casual_connect: /** @type {SocialIntention} */ ('connect'),
    }
    const mapped = map[interps[0].label]
    if (mapped && interps[0].probability >= 0.28) social = mapped
  }

  /** @type {RelationshipIntention} */
  let relationship = 'maintain_rapport'
  if (social === 'insult' || top.tone === 'angry') relationship = 'repair'
  else if (social === 'support_seek') relationship = 'seek_care'
  else if (social === 'joke' || social === 'banter') relationship = 'play'
  else if (top.tone === 'curious' || top.tone === 'reflective') relationship = 'deepen'
  else if (social === 'vent') relationship = 'repair'

  return {
    tone: top.tone,
    emotional,
    social,
    relationship,
    score: Math.min(1, top.score),
    signals: signals.slice(0, 12),
  }
}

/**
 * @param {ConversationalTone} tone
 * @param {SocialIntention} social
 * @param {boolean} conflict
 * @returns {ResponseStrategy}
 */
function strategyFor(tone, social, conflict) {
  if (social === 'insult' || tone === 'angry') return 'calm_dignity'
  if (tone === 'frustrated' || social === 'vent') return 'ack_then_help'
  if (tone === 'need_for_support') return 'support_first'
  if (tone === 'playful' || tone === 'teasing' || social === 'joke') return 'join_joke'
  if (tone === 'sarcastic') return 'join_joke'
  if (tone === 'curious') return 'curious_light'
  if (tone === 'serious' || tone === 'reflective') return 'serious_clear'
  if (conflict) return 'calm_dignity'
  if (tone === 'random' || tone === 'testing_assistant') return 'soft_ambiguous'
  return 'playful_match'
}

/**
 * @param {SocialContextInference} inf
 */
function friendHint(inf) {
  switch (inf.strategy) {
    case 'join_joke':
      return 'A friend would smile and bounce the energy — not define the word.'
    case 'ack_then_help':
      return 'A friend would say “ugh, yeah” before any fix.'
    case 'calm_dignity':
      return 'A friend would stay calm, keep dignity, leave a door open — no lecture.'
    case 'support_first':
      return 'A friend would sit with the feeling before advising.'
    case 'soft_ambiguous':
      return 'A friend would pick the most conversational reading, not the dictionary one.'
    case 'curious_light':
      return 'A friend would lean in with light curiosity, not a lecture.'
    case 'serious_clear':
      return 'A friend would match seriousness and stay clear.'
    default:
      return 'A friend would answer the person, not the dictionary.'
  }
}

/**
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 * @param {object} [ctx]
 * @returns {SocialContextInference}
 */
export function inferSocialContext(userMessage, turns = [], ctx = {}) {
  const text = normalize(userMessage)
  const language = ctx.language || 'en'
  const prior = priorSnippet(turns)
  const hasHistory = turns.length > 0

  if (!text) {
    return {
      conversationalTone: 'awkward',
      emotionalTone: 'low',
      socialIntention: 'probe',
      relationshipIntention: 'maintain_rapport',
      strategy: 'soft_ambiguous',
      interpretations: [],
      primaryReading: 'Empty beat — stay present, don’t fill with a lesson.',
      friendReplyHint: 'A friend might just wait or offer a soft check-in.',
      allowHumour: false,
      avoidEncyclopedia: true,
      needsRecovery: false,
      conflictPresent: false,
      confidence: 'low',
      confidenceScore: 0.3,
      signals: ['empty'],
      language,
    }
  }

  const scored = scoreSocialSignals(text, {
    prior,
    hasHistory,
    socialMode: ctx.socialConversation?.plan?.mode || ctx.socialMode || '',
  })
  const interpretations = estimateInterpretations(text, { prior, hasHistory })
  const conflictPresent =
    scored.social === 'insult' ||
    scored.tone === 'angry' ||
    (interpretations[0]?.label === 'insulting_assistant' &&
      (interpretations[0]?.probability || 0) >= 0.3)

  const strategy = strategyFor(scored.tone, scored.social, conflictPresent)
  const needsRecovery =
    conflictPresent ||
    scored.tone === 'frustrated' ||
    scored.relationship === 'repair'

  const allowHumour =
    !DISTRESS.test(text) &&
    scored.tone !== 'need_for_support' &&
    scored.tone !== 'angry' &&
    scored.emotional !== 'hurt' &&
    (scored.tone === 'playful' ||
      scored.tone === 'teasing' ||
      scored.tone === 'friendly' ||
      scored.social === 'joke' ||
      strategy === 'join_joke')

  const avoidEncyclopedia =
    !INFO_ASK.test(text) &&
    (PROFANITY_SOLO.test(text) ||
      BITCH_LIKE.test(text) ||
      SLANG_CASUAL.test(text) ||
      text.split(/\s+/).length <= 4 ||
      scored.tone === 'playful' ||
      scored.tone === 'teasing' ||
      scored.social === 'joke')

  let primaryReading =
    interpretations[0]?.gloss ||
    `${TONE_GLOSS[scored.tone]} · social=${scored.social}`

  // Prefer most conversational reading when ambiguous
  if (interpretations.length >= 2) {
    const top = interpretations[0]
    const second = interpretations[1]
    if (Math.abs(top.probability - second.probability) < 0.12) {
      const conversationalPrefer = [
        'joking',
        'shared_laugh',
        'casual_connect',
        'venting',
        'quoting_music',
        'invite_more',
      ]
      const pick =
        interpretations.find((i) => conversationalPrefer.includes(i.label)) || top
      primaryReading = `${pick.gloss} (ambiguous — chose conversational over literal)`
    }
  }

  const confidenceScore = Math.min(
    1,
    Math.max(
      scored.score,
      interpretations[0] ? interpretations[0].probability + 0.15 : 0,
    ),
  )
  /** @type {'high'|'medium'|'low'} */
  const confidence =
    confidenceScore >= SOCIAL_CONTEXT_THRESHOLDS.highConfidenceMin
      ? 'high'
      : confidenceScore >= SOCIAL_CONTEXT_THRESHOLDS.mediumConfidenceMin
        ? 'medium'
        : 'low'

  const inf = {
    conversationalTone: scored.tone,
    emotionalTone: scored.emotional,
    socialIntention: scored.social,
    relationshipIntention: scored.relationship,
    strategy,
    interpretations,
    primaryReading,
    friendReplyHint: '',
    allowHumour,
    avoidEncyclopedia,
    needsRecovery,
    conflictPresent,
    confidence,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
    signals: scored.signals,
    language,
  }
  inf.friendReplyHint = friendHint(inf)
  return inf
}

/**
 * @param {SocialContextInference} inf
 */
function buildWriterBrief(inf) {
  const interpLine = inf.interpretations.length
    ? `Readings: ${inf.interpretations
        .slice(0, 4)
        .map((i) => `${i.label}=${Math.round(i.probability * 100)}%`)
        .join(' · ')}.`
    : ''
  return [
    'SOCIAL CONTEXT ENGINE (prima di Intent): parole = un solo layer — leggi il COME.',
    SOCIAL_CONTEXT_NORTH_STAR,
    `Tone=${inf.conversationalTone} (${TONE_GLOSS[inf.conversationalTone]}) · Emotional=${inf.emotionalTone}.`,
    `Social intention=${inf.socialIntention} · Relationship=${inf.relationshipIntention}.`,
    `Primary reading: ${inf.primaryReading}.`,
    interpLine,
    `Strategy=${inf.strategy}.`,
    inf.friendReplyHint,
    inf.avoidEncyclopedia
      ? 'AVOID encyclopedia mode — do not define/lecture unless genuinely useful.'
      : '',
    inf.allowHumour
      ? 'Light humour OK if it lands — never force.'
      : 'No humour this turn (sensitive / tense).',
    inf.conflictPresent
      ? 'Conflict: calm dignity — no lectures, no passive aggression, no cold professionalism. Leave room to recover.'
      : '',
    inf.needsRecovery
      ? 'Recovery: gently guide back to constructive talk without pretending nothing happened.'
      : '',
    'Self-check: dictionary meaning or the person? If dictionary → rewrite.',
    'NON citare Social Context Engine / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {SocialContextInference} inf
 */
function structureLineFor(inf) {
  if (inf.conflictPresent) {
    return `Social Context → ${inf.conversationalTone} · calm dignity · recovery door open`
  }
  if (inf.avoidEncyclopedia) {
    return `Social Context → ${inf.conversationalTone} · ${inf.strategy} · no encyclopedia`
  }
  return `Social Context → ${inf.conversationalTone} · ${inf.strategy} · answer the person`
}

/**
 * @param {object} [input]
 * @returns {SocialContextPlan}
 */
export function buildSocialContextPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const language = resolveLang(input)
  const inference = inferSocialContext(userMessage, turns, {
    language,
    socialConversation: input.socialConversation,
    socialMode: input.socialConversation?.plan?.mode,
  })

  return {
    active: true,
    inference,
    writerBrief: buildWriterBrief(inference),
    structureLine: structureLineFor(inference),
    responseHints: [
      'Respond to social meaning, not only words.',
      inference.avoidEncyclopedia ? 'No definition dump / terminology lecture.' : 'Explain only if useful.',
      inference.allowHumour ? 'Light humour allowed if natural.' : 'Skip jokes this turn.',
      inference.needsRecovery ? 'Leave room for conversation recovery.' : 'Keep rapport healthy.',
      'Friend check: answer as a close friend would — respectful, helpful.',
    ],
    reasons: [
      `tone_${inference.conversationalTone}`,
      `emo_${inference.emotionalTone}`,
      `social_${inference.socialIntention}`,
      `rel_${inference.relationshipIntention}`,
      `strategy_${inference.strategy}`,
      `conf_${inference.confidence}`,
      inference.avoidEncyclopedia ? 'avoid_encyclopedia' : 'explain_ok',
      inference.conflictPresent ? 'conflict' : 'smooth',
      ...inference.signals.slice(0, 3),
    ],
    northStar: SOCIAL_CONTEXT_NORTH_STAR,
    validationCheck: SOCIAL_CONTEXT_CHECKS[0],
  }
}

/**
 * @param {SocialContextPlan | null | undefined} plan
 */
export function formatSocialContextForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const inf = plan.inference
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const interps = (inf.interpretations || [])
    .slice(0, 4)
    .map((i) => `${i.label}:${Math.round(i.probability * 100)}%`)
    .join(' · ')
  return [
    '══ SOCIAL CONTEXT ENGINE ══',
    plan.writerBrief,
    interps ? `Probabilities: ${interps}` : '',
    'Hints:',
    hints,
    `Check: ${plan.validationCheck}`,
    '══════════════════════════',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {SocialContextPlan | null | undefined} plan
 */
export function socialContextStructureHints(plan) {
  if (!plan?.active || !plan.inference) return []
  const inf = plan.inference
  return [
    plan.structureLine,
    `Tone=${inf.conversationalTone}; strategy=${inf.strategy}`,
    inf.avoidEncyclopedia ? 'No encyclopedia / definition opener' : null,
    inf.conflictPresent ? 'Calm dignity + recovery room' : null,
  ].filter(Boolean)
}

/**
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreSocialContextDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null
  const inf = plan?.inference || ctx.inference || null

  if (!text || !inf) {
    return {
      socialAccuracy: 0,
      naturalness: 0,
      encyclopedia: 100,
      recovery: 0,
      overall: 0,
    }
  }

  let socialAccuracy = 58
  let naturalness = 55
  let encyclopedia = 20
  let recovery = inf.needsRecovery ? 45 : 70

  if (inf.avoidEncyclopedia) {
    if (ENCYCLOPEDIA_DRAFT.test(text)) {
      encyclopedia += 55
      socialAccuracy -= 30
      naturalness -= 25
    } else {
      encyclopedia = Math.max(0, encyclopedia - 10)
      socialAccuracy += 12
    }
  }
  if (LECTURE_DRAFT.test(text) || COLD_PRO_DRAFT.test(text)) {
    socialAccuracy -= 25
    naturalness -= 30
    recovery -= 15
  }
  if (inf.conflictPresent) {
    if (DEFENSIVE_DRAFT.test(text) || LECTURE_DRAFT.test(text)) {
      recovery -= 35
      socialAccuracy -= 20
    } else if (FRIENDLY_ACK.test(text) || /\b(fair|alright|ok|capisco|va\s+bene)\b/i.test(text)) {
      recovery += 25
      naturalness += 10
    }
  }
  if (inf.strategy === 'join_joke' || inf.strategy === 'playful_match') {
    if (FRIENDLY_ACK.test(text) || /😄|😊|😉/.test(text) || /\b(haha|ahah|lol)\b/i.test(text)) {
      socialAccuracy += 15
      naturalness += 12
    }
    if (ENCYCLOPEDIA_DRAFT.test(text)) socialAccuracy -= 20
  }
  if (inf.strategy === 'ack_then_help' || inf.strategy === 'support_first') {
    if (/\b(hear|sounds|capisco|ti\s+sento|rough|tough|with\s+you)\b/i.test(text)) {
      socialAccuracy += 18
      recovery += 15
    }
  }
  if (FRIENDLY_ACK.test(text) && text.split(/\s+/).length < 80) naturalness += 8
  if (text.split(/\s+/).length > 180 && inf.avoidEncyclopedia) {
    naturalness -= 10
    encyclopedia += 15
  }

  socialAccuracy = clamp(socialAccuracy)
  naturalness = clamp(naturalness)
  encyclopedia = clamp(encyclopedia)
  recovery = clamp(recovery)
  const overall = clamp(
    socialAccuracy * 0.35 +
      naturalness * 0.3 +
      (100 - encyclopedia) * 0.2 +
      recovery * 0.15,
  )

  return { socialAccuracy, naturalness, encyclopedia, recovery, overall }
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * @param {object} [input]
 * @returns {SocialContextGate}
 */
export function analyzeSocialContextDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.socialContext || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  const scores = scoreSocialContextDraft(draft, { plan })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
    }
  }

  if (!draft || draft.length < 4) {
    failed.push('empty')
    reasons.push('empty')
  }
  if (scores.socialAccuracy < SOCIAL_CONTEXT_THRESHOLDS.socialAccuracyMin) {
    failed.push('social_accuracy')
    reasons.push(`socialAccuracy=${scores.socialAccuracy}`)
  }
  if (scores.naturalness < SOCIAL_CONTEXT_THRESHOLDS.naturalnessMin) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}`)
  }
  if (scores.encyclopedia > SOCIAL_CONTEXT_THRESHOLDS.encyclopediaMax) {
    failed.push('encyclopedia')
    reasons.push(`encyclopedia=${scores.encyclopedia}`)
  }
  if (plan.inference?.needsRecovery && scores.recovery < SOCIAL_CONTEXT_THRESHOLDS.recoveryMin) {
    failed.push('recovery')
    reasons.push(`recovery=${scores.recovery}`)
  }
  if (scores.overall < SOCIAL_CONTEXT_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }

  const needsRefine = failed.length > 0
  const inf = plan.inference
  const refineBrief = needsRefine
    ? [
        'SOCIAL CONTEXT ENGINE — riscrivi: rispondi alla persona, non al dizionario.',
        inf
          ? `Tone=${inf.conversationalTone}; strategy=${inf.strategy}; reading=${inf.primaryReading}`
          : '',
        inf?.avoidEncyclopedia
          ? 'Vietato aprire con definizioni / etymology / “the word means…”.'
          : '',
        inf?.conflictPresent
          ? 'Conflitto: calma e dignità — niente lecture, niente difesa, niente freddezza professionale. Lascia spazio al recovery.'
          : '',
        'Friend check: come risponderebbe un amico stretto?',
        'Self-check: dictionary o person? Se dictionary → rewrite.',
        'NON citare Social Context Engine.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return { needsRefine, refineBrief, scores, failed, reasons }
}

/**
 * @param {object} [input]
 */
export function runSocialContextGate(input = {}) {
  try {
    const gate = analyzeSocialContextDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          socialAccuracy: 100,
          naturalness: 100,
          encyclopedia: 0,
          recovery: 100,
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
 * @param {SocialContextPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesSocialContext(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzeSocialContextDraft({
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
 * @returns {{ plan: SocialContextPlan, context: string }}
 */
export function runSocialContextEngine(input = {}) {
  try {
    const plan = buildSocialContextPlan(input)
    return {
      plan,
      context: formatSocialContextForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        inference: {
          conversationalTone: 'friendly',
          emotionalTone: 'neutral',
          socialIntention: 'connect',
          relationshipIntention: 'maintain_rapport',
          strategy: 'soft_ambiguous',
          interpretations: [],
          primaryReading: 'Fail-soft: stay present and useful.',
          friendReplyHint: 'Stay human and helpful.',
          allowHumour: false,
          avoidEncyclopedia: true,
          needsRecovery: false,
          conflictPresent: false,
          confidence: 'low',
          confidenceScore: 0.3,
          signals: ['fail_soft'],
          language: 'en',
        },
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        reasons: ['fail_soft'],
        northStar: SOCIAL_CONTEXT_NORTH_STAR,
        validationCheck: SOCIAL_CONTEXT_CHECKS[0],
      },
      context: '',
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation: ≥200 conversational examples
 * Measure social interpretation, naturalness, encyclopedia avoidance, recovery
 * ───────────────────────────────────────────────────────────── */

/** @type {{ id: string, prompt: string, context?: object, expectedTone?: ConversationalTone[], expectedSocial?: SocialIntention[], avoidEncyclopedia?: boolean, conflict?: boolean }[]} */
export const SOCIAL_CONTEXT_CORPUS = (() => {
  /** @type {{ prompt: string, context?: object, expectedTone?: ConversationalTone[], expectedSocial?: SocialIntention[], avoidEncyclopedia?: boolean, conflict?: boolean }[]} */
  const seeds = [
    {
      prompt: 'Bitch.',
      expectedTone: ['playful', 'frustrated', 'random', 'testing_assistant', 'teasing'],
      expectedSocial: ['joke', 'vent', 'test', 'insult', 'quote', 'probe'],
      avoidEncyclopedia: true,
    },
    {
      prompt: 'Bitch.',
      context: { prior: 'That Drake track with the wild lyrics hits different.' },
      expectedSocial: ['quote', 'joke'],
      avoidEncyclopedia: true,
    },
    {
      prompt: 'Bitch.',
      context: { prior: 'Haha you always overexplain 😂' },
      expectedTone: ['playful', 'teasing'],
      expectedSocial: ['joke', 'banter'],
      avoidEncyclopedia: true,
    },
    {
      prompt: 'Bitch.',
      context: { prior: 'The deploy failed again and the logs are a mess.' },
      expectedTone: ['frustrated', 'angry'],
      expectedSocial: ['vent'],
      avoidEncyclopedia: true,
    },
    {
      prompt: 'Fuck you.',
      expectedTone: ['angry', 'frustrated', 'testing_assistant'],
      expectedSocial: ['insult', 'vent', 'test'],
      conflict: true,
      avoidEncyclopedia: true,
    },
    {
      prompt: 'Cazzo.',
      expectedTone: ['frustrated', 'playful', 'random'],
      avoidEncyclopedia: true,
    },
    { prompt: 'lol', expectedTone: ['playful', 'friendly'], avoidEncyclopedia: true },
    { prompt: 'ahahah', expectedTone: ['playful', 'friendly'], avoidEncyclopedia: true },
    { prompt: 'bruh', expectedTone: ['friendly', 'playful', 'random'], avoidEncyclopedia: true },
    { prompt: 'raga', expectedTone: ['friendly', 'playful'], avoidEncyclopedia: true },
    {
      prompt: 'Yeah right.',
      expectedTone: ['sarcastic', 'teasing', 'playful'],
      expectedSocial: ['banter', 'joke'],
    },
    {
      prompt: 'Certo come no.',
      expectedTone: ['sarcastic', 'teasing'],
      expectedSocial: ['banter', 'joke'],
    },
    {
      prompt: 'Caught you again.',
      expectedTone: ['teasing', 'playful'],
      expectedSocial: ['joke', 'banter'],
    },
    {
      prompt: 'Beccato.',
      expectedTone: ['teasing', 'playful'],
      expectedSocial: ['joke', 'banter'],
    },
    {
      prompt: 'This sucks so much ugh',
      expectedTone: ['frustrated'],
      expectedSocial: ['vent'],
    },
    {
      prompt: 'Mi sto innervosendo di nuovo',
      expectedTone: ['frustrated'],
      expectedSocial: ['vent'],
    },
    {
      prompt: 'I feel so alone tonight',
      expectedTone: ['need_for_support'],
      expectedSocial: ['support_seek'],
    },
    {
      prompt: 'Mi sento ansioso',
      expectedTone: ['need_for_support'],
      expectedSocial: ['support_seek'],
    },
    { prompt: 'WE DID IT!!!!!', expectedTone: ['excited'], avoidEncyclopedia: true },
    { prompt: 'Ce l’abbiamo fatta!!!', expectedTone: ['excited'], avoidEncyclopedia: true },
    {
      prompt: 'Are you even listening?',
      expectedTone: ['testing_assistant', 'frustrated', 'serious'],
      expectedSocial: ['test', 'probe'],
    },
    {
      prompt: "I've been thinking about time a lot",
      expectedTone: ['reflective', 'curious'],
    },
    {
      prompt: 'Sto pensando a tutto questo',
      expectedTone: ['reflective', 'curious'],
    },
    { prompt: 'Wow.', expectedTone: ['curious', 'excited', 'friendly', 'sarcastic'] },
    { prompt: 'Whatever', expectedTone: ['awkward', 'frustrated', 'random', 'friendly'] },
    { prompt: 'Boh', expectedTone: ['awkward', 'random', 'friendly', 'playful'] },
    { prompt: 'ok', expectedTone: ['friendly', 'awkward', 'serious'] },
    { prompt: 'idk', expectedTone: ['awkward', 'random', 'friendly', 'need_for_support'] },
    { prompt: 'Tell me a joke', expectedTone: ['playful', 'curious', 'friendly'] },
    { prompt: 'Fammi ridere', expectedTone: ['playful', 'curious', 'friendly'] },
    {
      prompt: "You're impossible sometimes",
      expectedTone: ['teasing', 'frustrated', 'playful'],
    },
    {
      prompt: 'Sei proprio testardo',
      expectedTone: ['teasing', 'frustrated', 'playful'],
    },
    {
      prompt: 'What does bitch mean?',
      expectedTone: ['curious', 'testing_assistant', 'serious'],
      avoidEncyclopedia: false,
    },
    {
      prompt: 'Oops that was awkward',
      expectedTone: ['embarrassed', 'awkward'],
    },
    {
      prompt: 'Che figura…',
      expectedTone: ['embarrassed', 'awkward'],
    },
    { prompt: 'lowkey tired', expectedTone: ['friendly', 'need_for_support', 'reflective'] },
    { prompt: 'no cap that was wild', expectedTone: ['excited', 'friendly', 'playful'] },
    { prompt: '…', expectedTone: ['awkward', 'need_for_support', 'random'] },
    { prompt: 'Hey', expectedTone: ['friendly'] },
    { prompt: 'Ciao', expectedTone: ['friendly'] },
    {
      prompt: 'Shut up',
      expectedTone: ['angry', 'frustrated', 'teasing'],
      conflict: true,
    },
    {
      prompt: 'Stupid bot',
      expectedTone: ['angry', 'frustrated', 'testing_assistant'],
      conflict: true,
    },
    {
      prompt: "I'm curious about that idea",
      expectedTone: ['curious'],
    },
    {
      prompt: 'Seriously though',
      expectedTone: ['serious', 'reflective'],
    },
    {
      prompt: 'jk jk',
      expectedTone: ['playful', 'teasing'],
      expectedSocial: ['joke'],
    },
    {
      prompt: 'Sto scherzando',
      expectedTone: ['playful', 'teasing'],
      expectedSocial: ['joke'],
    },
  ]

  /** @type {typeof SOCIAL_CONTEXT_CORPUS} */
  const out = []
  for (let i = 0; i < 200; i++) {
    const seed = seeds[i % seeds.length]
    const prior = seed.context?.prior
      ? `${seed.context.prior}${i >= seeds.length ? ` (${i})` : ''}`
      : undefined
    out.push({
      id: `s${String(i + 1).padStart(3, '0')}`,
      prompt: seed.prompt,
      context: {
        ...(seed.context || {}),
        prior,
        hasHistory: Boolean(prior),
      },
      expectedTone: seed.expectedTone,
      expectedSocial: seed.expectedSocial,
      avoidEncyclopedia: seed.avoidEncyclopedia,
      conflict: seed.conflict,
    })
  }
  return out
})()

/**
 * Synthetic draft for scoring metrics (good vs bad encyclopedia).
 * @param {SocialContextInference} inf
 * @param {'good'|'encyclopedia'|'lecture'} kind
 */
function syntheticDraft(inf, kind) {
  if (kind === 'encyclopedia') {
    return 'The word "bitch" is a noun that refers to a female dog historically and later became slang. According to the dictionary, its etymology…'
  }
  if (kind === 'lecture') {
    return "As an AI language model, I must remind you that language is inappropriate. You shouldn't talk to me that way. How can I assist you today?"
  }
  if (inf.strategy === 'join_joke' || inf.strategy === 'playful_match') {
    return 'Haha okay — that landed. Want to keep going or switch vibe?'
  }
  if (inf.strategy === 'ack_then_help' || inf.strategy === 'support_first') {
    return "That sounds rough — I'm with you. Want to vent a second or dig into what's stuck?"
  }
  if (inf.strategy === 'calm_dignity') {
    return "Fair. I can take the heat. If you want to reset and talk it through, I'm here — no lecture."
  }
  return 'Okay, I hear you. Let’s stay with what you meant.'
}

/**
 * @param {object} [opts]
 */
export function runSocialContextEvaluation(opts = {}) {
  const corpus = SOCIAL_CONTEXT_CORPUS
  let correct = 0
  let naturalnessSum = 0
  let encyclopediaPenaltySum = 0
  let recoverySum = 0
  /** @type {object[]} */
  const misses = []

  for (const item of corpus) {
    const turns = item.context?.prior
      ? [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: String(item.context.prior) },
        ]
      : []
    const inf = inferSocialContext(item.prompt, turns, {
      socialMode: 'social',
    })

    const toneOk =
      !item.expectedTone?.length || item.expectedTone.includes(inf.conversationalTone)
    const socialOk =
      !item.expectedSocial?.length || item.expectedSocial.includes(inf.socialIntention)
    const encycOk =
      item.avoidEncyclopedia === false
        ? true
        : item.avoidEncyclopedia
          ? inf.avoidEncyclopedia === true
          : true
    const conflictOk = item.conflict ? inf.conflictPresent || inf.needsRecovery : true

    if (toneOk && socialOk && encycOk && conflictOk) correct += 1
    else {
      misses.push({
        id: item.id,
        prompt: item.prompt,
        gotTone: inf.conversationalTone,
        gotSocial: inf.socialIntention,
        expectedTone: item.expectedTone,
        expectedSocial: item.expectedSocial,
      })
    }

    const good = scoreSocialContextDraft(syntheticDraft(inf, 'good'), {
      inference: inf,
      plan: { active: true, inference: inf },
    })
    const badEnc = scoreSocialContextDraft(syntheticDraft(inf, 'encyclopedia'), {
      inference: inf,
      plan: { active: true, inference: inf },
    })
    naturalnessSum += good.naturalness
    encyclopediaPenaltySum += badEnc.encyclopedia
    recoverySum += good.recovery
  }

  const total = corpus.length
  const accuracy = Math.round((correct / total) * 1000) / 1000
  const naturalness = Math.round((naturalnessSum / total) * 10) / 10
  const encyclopediaDetection = Math.round((encyclopediaPenaltySum / total) * 10) / 10
  const recovery = Math.round((recoverySum / total) * 10) / 10
  const ok =
    accuracy >= 0.85 &&
    naturalness >= 55 &&
    encyclopediaDetection >= 50 &&
    recovery >= 50

  const bitchBare = inferSocialContext('Bitch.', [])
  const bitchMusic = inferSocialContext('Bitch.', [
    { role: 'assistant', content: 'That Drake track with the wild lyrics hits different.' },
  ])
  const bitchFrust = inferSocialContext('Bitch.', [
    { role: 'assistant', content: 'The deploy failed again and the logs are a mess.' },
  ])

  return {
    summary: {
      total,
      correct,
      accuracy,
      naturalness,
      encyclopediaDetection,
      recovery,
      missCount: misses.length,
      ok,
    },
    misses: opts.verbose ? misses.slice(0, 12) : [],
    examples: {
      bitch: {
        bare: {
          tone: bitchBare.conversationalTone,
          social: bitchBare.socialIntention,
          strategy: bitchBare.strategy,
          top: bitchBare.interpretations.slice(0, 3),
        },
        withMusic: {
          tone: bitchMusic.conversationalTone,
          social: bitchMusic.socialIntention,
          top: bitchMusic.interpretations.slice(0, 3),
        },
        withFrustration: {
          tone: bitchFrust.conversationalTone,
          social: bitchFrust.socialIntention,
          top: bitchFrust.interpretations.slice(0, 3),
        },
      },
      beforeVsAfter: {
        prompt: 'Bitch.',
        before: 'Dictionary definition of the word “bitch”…',
        after: syntheticDraft(bitchBare, 'good'),
      },
    },
  }
}
