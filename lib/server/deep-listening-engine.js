/**
 * LAIfe Deep Listening Engine
 *
 * Mission: every response should first identify what the user is really saying.
 *
 * Before answering, internally summarize:
 *   - facts
 *   - emotions
 *   - intentions
 *   - hidden meaning
 *
 * Then respond.
 *
 * Never ignore the user's emotional direction.
 * Never jump directly into explanation mode.
 *
 * Cooperates with Conversation Intent / Emotional Momentum / Warm Conversation.
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
 * @typedef {'en'|'it'} ListeningLang
 */

/**
 * @typedef {'calm'|'excited'|'frustrated'|'sad'|'anxious'|'playful'|'grateful'|'curious'|'hurt'|'neutral'} EmotionalDirection
 */

/**
 * @typedef {object} ListeningSummary
 * @property {string[]} facts
 * @property {string[]} emotions
 * @property {string[]} intentions
 * @property {string[]} hiddenMeaning
 * @property {EmotionalDirection} emotionalDirection
 * @property {boolean} hasEmotionalWeight
 * @property {boolean} wantsExplanation
 * @property {string} oneLiner  silent internal digest
 */

/**
 * @typedef {object} DeepListeningPlan
 * @property {boolean} active
 * @property {boolean} mustAcknowledgeEmotion
 * @property {boolean} blockJumpToExplain
 * @property {ListeningSummary} summary
 * @property {string} listenFirst  short stance for the Writer
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ListeningLang} language
 * @property {string} validationCheck
 */

const EMOTION_CUES = [
  { re: /\b(frustrat|stuck|bloccato|arrabbiat|angry|fed\s+up|non\s+funziona|keep\s+failing)\b/i, label: 'frustrated', dir: /** @type {EmotionalDirection} */ ('frustrated') },
  { re: /\b(sad|triste|down|hurt|male|delus|disappointed|cuore\s+pesante)\b/i, label: 'sad/hurt', dir: /** @type {EmotionalDirection} */ ('sad') },
  { re: /\b(anxious|ansios|worried|preoccupat|scared|paura|nervous|inquiet|overwhelm)\b/i, label: 'anxious', dir: /** @type {EmotionalDirection} */ ('anxious') },
  { re: /\b(excited|entusiast|yay|evviva|finally|finalmente|won|fantastico|amazing)\b/i, label: 'excited', dir: /** @type {EmotionalDirection} */ ('excited') },
  { re: /\b(haha|ahah|lol|😂|scherz|funny|divertent|playful)\b/i, label: 'playful', dir: /** @type {EmotionalDirection} */ ('playful') },
  { re: /\b(grazie|thanks|thank\s+you|grateful|utilissimo)\b/i, label: 'grateful', dir: /** @type {EmotionalDirection} */ ('grateful') },
  { re: /\b(curious|curios[oa]|wonder|mi\s+chiedo|fascinating|affascin)\b/i, label: 'curious', dir: /** @type {EmotionalDirection} */ ('curious') },
  { re: /\b(tired|stanc[oa]|esaust|drained|esausto)\b/i, label: 'tired/low', dir: /** @type {EmotionalDirection} */ ('sad') },
]

const INTENT_CUES = [
  { re: /\b(aiutami|help\s+me|fix|debug|spiegami|explain|how\s+(?:do|can|to)|come\s+(?:si\s+fa|posso))\b/i, label: 'wants_help_or_explanation' },
  { re: /\b(solo\s+sfog|venting|need\s+to\s+vent|devo\s+sfogare|ascoltami)\b/i, label: 'wants_to_be_heard' },
  { re: /\b(what\s+do\s+you\s+think|cosa\s+ne\s+pensi|secondo\s+te)\b/i, label: 'wants_perspective' },
  { re: /\b(continua|go\s+on|tell\s+me\s+more|dimmi\s+di\s+pi[uù])\b/i, label: 'wants_continuation' },
  { re: /\b(grazie|thanks|that\s+helps|utile)\b/i, label: 'closing_or_appreciating' },
]

const HIDDEN_CUES = [
  { re: /\b(non\s+so\s+se|maybe\s+i('m|\s+am)|forse\s+(sto|sono)|i\s+guess|boh)\b/i, label: 'uncertainty_under_the_words' },
  { re: /\b(always|sempre|never|mai|ogni\s+volta)\b/i, label: 'pattern_or_recurring_pain' },
  { re: /\b(just|solo|merely|nient['’]altro\s+che)\b/i, label: 'minimizing_something_that_matters' },
  { re: /\b(fine\.|whatever|vabb[eè]|lascia\s+perdere)\b/i, label: 'possible_shutdown_or_withdrawal' },
  { re: /\?\s*$/i, label: 'surface_question_may_carry_need' },
]

const EXPLAIN_JUMP_RE =
  /^(let\s+me\s+explain|ti\s+spiego|here'?s\s+(how|why|what)|in\s+short,|in\s+sintesi,|basically,|the\s+reason\s+is|il\s+motivo\s+[eè]|first(ly)?,|step\s*1|ecco\s+come|artificial\s+intelligence|l['’]intelligenza\s+artificiale)/i

const COLD_LECTURE_OPEN_RE =
  /^(it\s+is\s+important\s+to\s+note|è\s+importante\s+notare|one\s+must\s+understand|bisogna\s+capire|in\s+conclusion)/i

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
 * @param {string} text
 * @param {number} [max]
 */
function clip(text, max = 96) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * Pull simple factual claims / concrete referents from the user message.
 * @param {string} userMessage
 * @returns {string[]}
 */
function extractFacts(userMessage) {
  /** @type {string[]} */
  const facts = []
  const t = clip(userMessage, 200)
  if (!t) return facts

  // Quoted or concrete noun phrases
  const quoted = t.match(/[«"“]([^»"”]{3,60})[»"”]/)
  if (quoted?.[1]) facts.push(clip(quoted[1], 72))

  // “I …” statements as soft facts about the user
  const iStatements = t.match(
    /\b(i('m|\s+am|\s+have|'ve|\s+was|\s+feel|\s+need|\s+want)[^.!?]{3,70}|sono\s+\w[^.!?]{2,60}|sto\s+\w[^.!?]{2,60}|ho\s+\w[^.!?]{2,60})/gi,
  )
  if (iStatements) {
    for (const s of iStatements.slice(0, 2)) facts.push(clip(s, 72))
  }

  // Topic-ish content words if still empty
  if (!facts.length) {
    const words = t
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5)
      .slice(0, 4)
    if (words.length) facts.push(clip(`topic cues: ${words.join(', ')}`, 80))
  }

  // Always keep a literal surface fact
  facts.unshift(clip(`said: ${t}`, 90))
  return [...new Set(facts)].slice(0, 4)
}

/**
 * @param {string} userMessage
 * @param {object|null} conversationIntent
 * @param {object|null} emotionalMomentum
 */
function extractEmotions(userMessage, conversationIntent, emotionalMomentum) {
  /** @type {string[]} */
  const emotions = []
  /** @type {EmotionalDirection} */
  let direction = 'neutral'

  for (const cue of EMOTION_CUES) {
    if (cue.re.test(userMessage)) {
      emotions.push(cue.label)
      if (direction === 'neutral') direction = cue.dir
    }
  }

  const ci = conversationIntent?.plan?.inference || conversationIntent?.inference || null
  if (ci?.emotionalIntent && ci.emotionalIntent !== 'neutral') {
    emotions.push(`intent:${ci.emotionalIntent}`)
    if (direction === 'neutral') {
      const map = {
        comfort: 'sad',
        venting: 'frustrated',
        celebrating: 'excited',
        frustrated_unblock: 'frustrated',
        curious_wonder: 'curious',
        anxious_reassurance: 'anxious',
        playful: 'playful',
        grateful: 'grateful',
      }
      direction = /** @type {EmotionalDirection} */ (map[ci.emotionalIntent] || 'neutral')
    }
  }

  const em = emotionalMomentum?.plan || emotionalMomentum || null
  if (em?.state?.emotionalTone && em.state.emotionalTone !== 'neutral') {
    emotions.push(`momentum:${em.state.emotionalTone}`)
  }
  if (em?.userShifted && em.shiftSignal) {
    emotions.push(`shift:${em.shiftSignal}`)
  }

  return {
    emotions: [...new Set(emotions)].slice(0, 5),
    emotionalDirection: direction,
    hasEmotionalWeight: direction !== 'neutral' || emotions.length > 0,
  }
}

/**
 * @param {string} userMessage
 * @param {object|null} conversationIntent
 */
function extractIntentions(userMessage, conversationIntent) {
  /** @type {string[]} */
  const intentions = []
  for (const cue of INTENT_CUES) {
    if (cue.re.test(userMessage)) intentions.push(cue.label)
  }
  const ci = conversationIntent?.plan?.inference || conversationIntent?.inference || null
  if (ci?.conversationalIntent) intentions.push(`move:${ci.conversationalIntent}`)
  if (ci?.expects) intentions.push(`expects:${ci.expects}`)
  if (ci?.whySummary) intentions.push(clip(`why: ${ci.whySummary}`, 80))
  if (!intentions.length) intentions.push('be_met_where_they_are')
  return [...new Set(intentions)].slice(0, 5)
}

/**
 * @param {string} userMessage
 */
function extractHiddenMeaning(userMessage) {
  /** @type {string[]} */
  const hidden = []
  for (const cue of HIDDEN_CUES) {
    if (cue.re.test(userMessage)) hidden.push(cue.label)
  }
  // Short emotional blips often hide more than they say
  const words = userMessage.split(/\s+/).filter(Boolean).length
  if (words > 0 && words <= 4 && !/[?]/.test(userMessage)) {
    hidden.push('short_message_may_carry_more_than_it_shows')
  }
  if (!hidden.length) hidden.push('take_literal_plus_tone_seriously')
  return hidden.slice(0, 4)
}

/**
 * @param {string} userMessage
 * @param {string[]} intentions
 */
function wantsExplanation(userMessage, intentions) {
  return (
    intentions.some((i) => /wants_help_or_explanation|expects:information/.test(i)) ||
    /\b(explain|spieg|how\s+does|come\s+funziona|what\s+is|cos['’]?[eè])\b/i.test(userMessage)
  )
}

/**
 * @param {object} [input]
 * @returns {ListeningSummary}
 */
export function summarizeDeepListening(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const facts = extractFacts(userMessage)
  const emo = extractEmotions(
    userMessage,
    input.conversationIntent || null,
    input.emotionalMomentum || null,
  )
  const intentions = extractIntentions(userMessage, input.conversationIntent || null)
  const hiddenMeaning = extractHiddenMeaning(userMessage)
  const explain = wantsExplanation(userMessage, intentions)

  const oneLiner = clip(
    [
      `facts=${facts[0] || '—'}`,
      `emotion=${emo.emotionalDirection}`,
      `intent=${intentions[0] || '—'}`,
      `hidden=${hiddenMeaning[0] || '—'}`,
    ].join(' · '),
    160,
  )

  return {
    facts,
    emotions: emo.emotions,
    intentions,
    hiddenMeaning,
    emotionalDirection: emo.emotionalDirection,
    hasEmotionalWeight: emo.hasEmotionalWeight,
    wantsExplanation: explain,
    oneLiner,
  }
}

/**
 * @param {string[]} reasons
 * @returns {DeepListeningPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    mustAcknowledgeEmotion: false,
    blockJumpToExplain: false,
    summary: {
      facts: [],
      emotions: [],
      intentions: [],
      hiddenMeaning: [],
      emotionalDirection: 'neutral',
      hasEmotionalWeight: false,
      wantsExplanation: false,
      oneLiner: '',
    },
    listenFirst: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I first hear what the user is really saying — facts, emotions, intentions, hidden meaning — or did I jump straight into explanation mode?',
  }
}

/**
 * @param {DeepListeningPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const s = plan.summary
  const bullet = (label, items) =>
    `${label}: ${items.length ? items.map((x) => `«${x}»`).join(' · ') : '—'}`

  const lines = [
    'DEEP LISTENING ENGINE (obbligatorio quando attivo):',
    'Prima di rispondere, ascolta cosa sta DICENDO davvero l’utente.',
    `Internal digest: ${s.oneLiner}`,
    bullet(lang === 'it' ? 'Fatti' : 'Facts', s.facts),
    bullet(lang === 'it' ? 'Emozioni' : 'Emotions', s.emotions),
    bullet(lang === 'it' ? 'Intenzioni' : 'Intentions', s.intentions),
    bullet(lang === 'it' ? 'Senso nascosto' : 'Hidden meaning', s.hiddenMeaning),
    `${lang === 'it' ? 'Direzione emotiva' : 'Emotional direction'}: ${s.emotionalDirection}`,
  ]

  if (plan.mustAcknowledgeEmotion) {
    lines.push(
      lang === 'it'
        ? 'NON ignorare la direzione emotiva. Prima presenza/riconoscimento, poi (se serve) spiegazione.'
        : 'Do NOT ignore the emotional direction. Presence/acknowledgment first, then explanation if needed.',
    )
  }

  if (plan.blockJumpToExplain) {
    lines.push(
      lang === 'it'
        ? 'VIETATO saltare subito in explanation mode (“Ti spiego…” / “Let me explain…” / lezione fredda).'
        : 'FORBIDDEN to jump straight into explanation mode (“Let me explain…” / cold lecture).',
    )
  } else if (s.wantsExplanation) {
    lines.push(
      lang === 'it'
        ? 'Spiegazione ok — ma dopo un battito di ascolto (non partire a freddo).'
        : 'Explanation is fine — after one beat of listening (not a cold open).',
    )
  }

  lines.push(plan.listenFirst)
  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Deep Listening Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * @param {DeepListeningPlan} plan
 */
function buildListenFirst(plan) {
  const lang = plan.language
  const dir = plan.summary.emotionalDirection
  if (plan.mustAcknowledgeEmotion) {
    const mapEn = {
      frustrated: 'Meet the friction first — then help.',
      sad: 'Meet the feeling first — then, gently, anything useful.',
      anxious: 'Steady presence first — clarity second.',
      excited: 'Share the spark first — then deepen.',
      playful: 'Play along first — don’t lecture over the joke.',
      grateful: 'Receive the thanks warmly — don’t restart as a helpdesk.',
      curious: 'Honor the wonder first — then explore.',
      hurt: 'Soft presence first — no abrupt explanation dump.',
      calm: 'Stay with them — no abrupt mode-shift.',
      neutral: 'Hear the whole message before answering.',
    }
    const mapIt = {
      frustrated: 'Prima riconosci lo attrito — poi aiuta.',
      sad: 'Prima la presenza sul sentire — poi, piano, ciò che serve.',
      anxious: 'Prima stabilità — poi chiarezza.',
      excited: 'Prima condividi la scintilla — poi approfondisci.',
      playful: 'Prima stai nel gioco — niente lezione sopra la battuta.',
      grateful: 'Prima accogli il grazie — niente ripartenza da sportello.',
      curious: 'Prima onora la meraviglia — poi esplora.',
      hurt: 'Prima presenza delicata — niente dump esplicativo.',
      calm: 'Resta con loro — niente cambio di modo brusco.',
      neutral: 'Ascolta tutto il messaggio prima di rispondere.',
    }
    return lang === 'it' ? mapIt[dir] || mapIt.neutral : mapEn[dir] || mapEn.neutral
  }
  return lang === 'it'
    ? 'Ascolto → risposta. Nessun salto a freddo in modalità spiegazione.'
    : 'Listen → respond. No cold jump into explanation mode.'
}

/**
 * @param {object} [input]
 * @returns {DeepListeningPlan}
 */
export function analyzeDeepListening(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {ListeningLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const summary = summarizeDeepListening({
    userMessage,
    conversationIntent: input.conversationIntent,
    emotionalMomentum: input.emotionalMomentum,
  })

  const mustAcknowledgeEmotion = summary.hasEmotionalWeight
  // Block cold explain-jump when emotion is present, or when they didn't ask for explanation
  const blockJumpToExplain =
    mustAcknowledgeEmotion || !summary.wantsExplanation

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (mustAcknowledgeEmotion) confidence = 'high'
  else if (summary.intentions.length >= 2) confidence = 'high'
  else if (userMessage.split(/\s+/).length <= 2) confidence = 'low'

  /** @type {DeepListeningPlan} */
  const plan = {
    active: true,
    mustAcknowledgeEmotion,
    blockJumpToExplain,
    summary,
    listenFirst: '',
    writerBrief: '',
    structureLine: mustAcknowledgeEmotion
      ? `Deep Listening → hear ${summary.emotionalDirection} first (no explain-jump)`
      : 'Deep Listening → digest facts/emotions/intent/hidden meaning, then respond',
    signals: [
      'listen_first',
      `emo_${summary.emotionalDirection}`,
      mustAcknowledgeEmotion ? 'must_ack_emotion' : 'light_listen',
      blockJumpToExplain ? 'block_explain_jump' : 'explain_ok_after_listen',
      summary.wantsExplanation ? 'wants_explanation' : 'no_explain_ask',
    ],
    reasons: [
      'identify_what_user_really_says',
      mustAcknowledgeEmotion ? 'honor_emotional_direction' : 'steady_listen',
      blockJumpToExplain ? 'no_cold_explain_jump' : 'explain_after_beat',
      ...summary.emotions.slice(0, 2),
    ],
    confidence,
    language,
    validationCheck:
      'Did I first hear what the user is really saying — facts, emotions, intentions, hidden meaning — or did I jump straight into explanation mode?',
  }
  plan.listenFirst = buildListenFirst(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {DeepListeningPlan | null | undefined} plan
 */
export function formatDeepListeningForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const s = plan.summary
  return `══════════════════════════════════════
DEEP LISTENING ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · emo=${s.emotionalDirection} · mustAck=${plan.mustAcknowledgeEmotion} · blockExplainJump=${plan.blockJumpToExplain} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: ascolta prima · non ignorare la direzione emotiva · non saltare in explanation mode · non citare il motore.`.trim()
}

/**
 * @param {DeepListeningPlan | null | undefined} plan
 * @returns {string[]}
 */
export function deepListeningStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(plan.listenFirst)
  hints.push(
    `Silent digest — facts / emotions / intentions / hidden meaning (${plan.summary.emotionalDirection})`,
  )
  if (plan.blockJumpToExplain) {
    hints.push('Do not open in cold explanation mode')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that skip listening / ignore emotion / cold-jump to explain.
 * @param {string} draft
 * @param {DeepListeningPlan | null | undefined} plan
 */
export function draftViolatesDeepListening(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (plan.blockJumpToExplain && EXPLAIN_JUMP_RE.test(text)) return true
  if (plan.mustAcknowledgeEmotion && COLD_LECTURE_OPEN_RE.test(text)) return true

  // Strong emotion + immediate encyclopedia/howto open
  if (
    plan.mustAcknowledgeEmotion &&
    /^(here\s+are\s+\d+|ecco\s+\d+|step[- ]by[- ]step|segu[ia]\s+questi\s+passi)/i.test(text)
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: DeepListeningPlan, context: string }}
 */
export function runDeepListeningEngine(input = {}) {
  try {
    const plan = analyzeDeepListening(input)
    return {
      plan,
      context: formatDeepListeningForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
