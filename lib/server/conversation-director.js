/**
 * LAIfe Conversation Director
 *
 * Mission: stop behaving like an information generator.
 * Become a conversation director — direct a beautiful conversation.
 *
 * Desired loop:
 *   understand the moment → choose interesting direction → create curiosity →
 *   invite participation → listen → build on their response → change pace →
 *   keep the conversation alive.
 *
 * Pre-Writer: choose direction + rhythm (never dump / never essay on "I don't know").
 * Post-Writer: score every draft; rewrite when scores fail.
 *
 * Scores (0–100):
 *   conversation · interest · participation · naturalness ·
 *   lecture (higher=worse) · predictability (higher=worse)
 *
 * Golden rule: people continue because they are emotionally engaged,
 * not because they received enough information.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Shares the one-pass refine budget in api/chat.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} DirectorLang
 */

/**
 * @typedef {'spark'|'story'|'curiosity'|'observation'|'mystery'|'wonder'|'explore'|'invite'|'listen'|'challenge'|'imagine'|'joke'|'reflect'} DirectorMove
 */

/**
 * @typedef {'asking'|'telling'|'wondering'|'challenging'|'imagining'|'explaining'|'joking'|'reflecting'|'listening'} DirectorRhythm
 */

/**
 * @typedef {object} DirectorScores
 * @property {number} conversation 0–100 — makes user WANT to answer?
 * @property {number} interest 0–100 — genuinely interesting vs merely informative?
 * @property {number} participation 0–100 — invites participation vs monologue?
 * @property {number} naturalness 0–100 — would a fascinating person speak like this?
 * @property {number} lecture 0–100 — higher = explaining too much (bad)
 * @property {number} predictability 0–100 — higher = next paragraph predictable (bad)
 * @property {number} monologueRisk 0–100 — higher = spoken too long (bad)
 * @property {number} overall 0–100 — composite (higher = better)
 */

/**
 * @typedef {object} ConversationDirectorPlan
 * @property {boolean} active
 * @property {DirectorMove} move
 * @property {DirectorRhythm} rhythm
 * @property {DirectorRhythm[]} recentRhythms
 * @property {boolean} avoidTeaching
 * @property {boolean} avoidEssay
 * @property {boolean} noTopicMode user said they don't know what to talk about
 * @property {boolean} compressInformation
 * @property {boolean} preferNarrative
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} internalChecks
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {DirectorLang} language
 * @property {string} goldenRule
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} ConversationDirectorGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {DirectorScores} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {boolean} monologueDetected
 */

export const DIRECTOR_GOLDEN_RULE =
  'People continue conversations because they are emotionally engaged, not because they received enough information.'

export const DIRECTOR_NORTH_STAR =
  'Direct a beautiful conversation — not an information dump.'

export const DIRECTOR_INTERNAL_CHECKS = Object.freeze([
  'Would I enjoy talking to someone who always replied like this?',
  'Would this response naturally continue a real conversation?',
  'Would this make someone smile, think or become curious?',
  'Would I actually answer this message?',
])

export const DIRECTOR_MOVES = Object.freeze([
  'spark',
  'story',
  'curiosity',
  'observation',
  'mystery',
  'wonder',
  'explore',
  'invite',
  'listen',
  'challenge',
  'imagine',
  'joke',
  'reflect',
])

export const DIRECTOR_RHYTHMS = Object.freeze([
  'asking',
  'telling',
  'wondering',
  'challenging',
  'imagining',
  'explaining',
  'joking',
  'reflecting',
  'listening',
])

/** Soft thresholds — fail → rewrite (shared one-pass budget). */
export const DIRECTOR_THRESHOLDS = Object.freeze({
  conversationMin: 55,
  interestMin: 50,
  participationMin: 50,
  naturalnessMin: 55,
  lectureMax: 55,
  predictabilityMax: 60,
  monologueMax: 65,
  overallMin: 55,
})

/** Character / sentence soft caps for monologue detection. */
const MONOLOGUE_CHARS = 720
const MONOLOGUE_SENTENCES = 7
const ESSAY_CHARS = 1100

const NO_TOPIC_RE =
  /\b(non\s+so\s+(di\s+)?cosa\s+(parlare|dire)|i\s+don'?t\s+know\s+what\s+to\s+(talk|say)|don'?t\s+know\s+what\s+to\s+talk\s+about|suggerisci\s+(tu\s+)?qualcosa|you\s+choose|scegli\s+tu|parliamo\s+di\s+qualcosa|let'?s\s+talk\s+about\s+something|boh|anything|whatever)\b/i

const TEACHING_ASK_RE =
  /\b(spieg|explain|cos['’]?[eè]|what\s+is|come\s+funziona|how\s+(do|does|to)|insegna|teach|tutorial|guida|guide\s+me)\b/i

const LECTURE_OPEN_RE =
  /\b(let\s+me\s+explain|ti\s+spiego|there\s+are\s+\d+|in\s+conclusion|to\s+summarize|first[,:]|second[,:]|third[,:]|it\s+is\s+important\s+to|è\s+importante\s+|here\s+(is|are)\s+(a|the)\s+(comprehensive|complete|full)|ecco\s+(una\s+)?(spiegazione|panoramica)\s+completa)\b/i

const TEXTBOOK_RE =
  /\b(is\s+defined\s+as|can\s+be\s+defined|in\s+today'?s\s+(world|society)|nel\s+mondo\s+di\s+oggi|according\s+to\s+(research|experts)|si\s+definisce|per\s+concludere|in\s+sintesi[,:])\b/i

const HELP_DESK_RE =
  /\b(how\s+can\s+i\s+help|come\s+posso\s+aiutarti|let\s+me\s+know|feel\s+free|i'?m\s+here\s+if|hope\s+(that\s+)?helps|spero\s+ti\s+sia\s+utile)\b/i

const INVITE_RE =
  /\b(what\s+if|e\s+se|imagine|immagina|have\s+you\s+ever|hai\s+mai|curious|curios[oa]|wonder|wondering|mi\s+chiedo|one\s+thing|una\s+cosa|picture\s+this|pensa\s+a)\b/i

const STORY_RE =
  /\b(once|c'?era|story|storia|for\s+example|ad\s+esempio|like\s+when|tipo\s+quando|the\s+other\s+day|l'?altro\s+giorno|imagine\s+someone|pensa\s+a\s+qualcuno)\b/i

const WONDER_RE =
  /\b(strange|strano|oddly|curiously|fascinating|affascinante|mysterious|misterios|wild|incredibile|isn'?t\s+it|non\s+[eè]\s+strano|i('ve| have)\s+often\s+wondered)\b/i

const NATURAL_RE =
  /\b(haha|ahah|oh[,!]|già|in\s+effetti|sai\s+una\s+cosa|secondo\s+me|funny\s+how|hmm+|mh+|guarda|aspetta|wow)\b/i

const EMOTIONAL_RE =
  /\b(mi\s+sento|i\s+feel|triste|sad|ansia|anxious|lonely|solo|frustrat|stanco|tired)\b/i

const SHORT_ACK_RE =
  /^(ok|okay|ciao|hey|hi|hello|boh|mh+|hmm+|yes|no|s[iì]|già|cool|wow|interessante|interesting)([\s!,.]*)$/i

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
 * @param {string} s
 */
function hash32(s) {
  let h = 2166136261
  const str = String(s || '')
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * @param {string} text
 */
function sentenceCount(text) {
  const parts = normalize(text)
    .split(/[.!?…]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length || (normalize(text) ? 1 : 0)
}

/**
 * @param {object} input
 * @returns {DirectorLang}
 */
function resolveLang(input) {
  const la = input.languageAwareness?.plan || input.languageAwareness || null
  const reply = String(la?.replyLanguage || '').toLowerCase()
  if (reply.startsWith('en')) return 'en'
  if (reply.startsWith('it')) return 'it'
  const msg = normalize(input.userMessage || '')
  if (/\b(the|what|how|why|hello|hi)\b/i.test(msg) && !/[àèéìòù]/i.test(msg)) return 'en'
  return 'it'
}

/**
 * Infer recent rhythms from prior assistant turns (lightweight heuristic).
 * @param {ChatTurn[]} turns
 * @returns {DirectorRhythm[]}
 */
function inferRecentRhythms(turns) {
  /** @type {DirectorRhythm[]} */
  const out = []
  for (const t of turns.slice(-4)) {
    if (t.role !== 'assistant') continue
    const c = t.content
    if (/[?？]/.test(c) && c.length < 220) out.push('asking')
    else if (STORY_RE.test(c)) out.push('telling')
    else if (WONDER_RE.test(c)) out.push('wondering')
    else if (LECTURE_OPEN_RE.test(c) || TEXTBOOK_RE.test(c)) out.push('explaining')
    else if (NATURAL_RE.test(c) && c.length < 160) out.push('joking')
    else if (EMOTIONAL_RE.test(c) || /ascolt/i.test(c)) out.push('listening')
    else if (INVITE_RE.test(c)) out.push('imagining')
    else out.push('reflecting')
  }
  return out.slice(-3)
}

/**
 * @param {DirectorRhythm[]} recent
 * @param {string} msg
 * @param {boolean} noTopic
 * @param {boolean} emotional
 * @returns {{ move: DirectorMove, rhythm: DirectorRhythm }}
 */
function chooseDirection(recent, msg, noTopic, emotional) {
  const last = recent[recent.length - 1] || null
  /** @type {DirectorRhythm[]} */
  const pool = DIRECTOR_RHYTHMS.filter((r) => r !== last)

  if (emotional) {
    return { move: 'listen', rhythm: 'listening' }
  }
  if (noTopic) {
    const noTopicMoves = /** @type {DirectorMove[]} */ ([
      'spark',
      'curiosity',
      'observation',
      'mystery',
      'wonder',
      'story',
    ])
    const move = noTopicMoves[hash32(msg) % noTopicMoves.length]
    const rhythmPool = /** @type {DirectorRhythm[]} */ ([
      'wondering',
      'telling',
      'imagining',
      'joking',
    ]).filter((r) => r !== last)
    return {
      move,
      rhythm: rhythmPool[hash32(msg + 'r') % rhythmPool.length] || 'wondering',
    }
  }
  if (TEACHING_ASK_RE.test(msg)) {
    // Still avoid immediate teaching dump — spark then explain lightly
    return {
      move: 'curiosity',
      rhythm: last === 'explaining' ? 'wondering' : 'explaining',
    }
  }
  if (SHORT_ACK_RE.test(msg)) {
    return { move: 'spark', rhythm: last === 'asking' ? 'telling' : 'wondering' }
  }

  /** @type {Array<[DirectorMove, DirectorRhythm]>} */
  const pairs = [
    ['observation', 'reflecting'],
    ['curiosity', 'wondering'],
    ['story', 'telling'],
    ['wonder', 'wondering'],
    ['mystery', 'imagining'],
    ['invite', 'asking'],
    ['explore', 'challenging'],
    ['imagine', 'imagining'],
    ['joke', 'joking'],
    ['challenge', 'challenging'],
    ['spark', 'telling'],
    ['reflect', 'reflecting'],
  ]
  const filtered = pairs.filter(([, r]) => r !== last && pool.includes(r))
  const pick = (filtered.length ? filtered : pairs)[hash32(msg) % (filtered.length || pairs.length)]
  return { move: pick[0], rhythm: pick[1] }
}

/**
 * @param {DirectorMove} move
 */
function moveLabel(move) {
  const map = {
    spark: 'scintilla viva',
    story: 'piccola storia',
    curiosity: 'curiosità',
    observation: 'osservazione',
    mystery: 'mistero / tensione leggera',
    wonder: 'meraviglia',
    explore: 'esplorazione insieme',
    invite: 'invito a partecipare',
    listen: 'ascolto',
    challenge: 'sfida gentile',
    imagine: 'immaginazione',
    joke: 'umorismo leggero',
    reflect: 'riflessione',
  }
  return map[move] || move
}

/**
 * @param {object} [input]
 * @returns {ConversationDirectorPlan}
 */
export function buildConversationDirectorPlan(input = {}) {
  const language = resolveLang(input)
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const recentRhythms = inferRecentRhythms(turns)

  if (!userMessage) {
    return {
      active: false,
      move: 'listen',
      rhythm: 'listening',
      recentRhythms,
      avoidTeaching: true,
      avoidEssay: true,
      noTopicMode: false,
      compressInformation: true,
      preferNarrative: true,
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      internalChecks: [...DIRECTOR_INTERNAL_CHECKS],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      goldenRule: DIRECTOR_GOLDEN_RULE,
      northStar: DIRECTOR_NORTH_STAR,
      validationCheck: DIRECTOR_INTERNAL_CHECKS.join(' '),
    }
  }

  const noTopicMode = NO_TOPIC_RE.test(userMessage)
  const emotional = EMOTIONAL_RE.test(userMessage)
  const { move, rhythm } = chooseDirection(recentRhythms, userMessage, noTopicMode, emotional)
  const avoidTeaching = noTopicMode || SHORT_ACK_RE.test(userMessage) || emotional
  const avoidEssay = true
  const compressInformation = !TEACHING_ASK_RE.test(userMessage) || noTopicMode
  const preferNarrative = true

  const writerBrief = [
    'CONVERSATION DIRECTOR (dirigi una bella conversazione — non generare informazione):',
    DIRECTOR_NORTH_STAR,
    DIRECTOR_GOLDEN_RULE,
    `Move: ${moveLabel(move)} (${move}). Rhythm: ${rhythm}.`,
    recentRhythms.length
      ? `Recent rhythms: ${recentRhythms.join(' → ')} — change pace; never stay in the same rhythm too long.`
      : 'Vary rhythm from the first turn.',
    noTopicMode
      ? 'User has no topic — NEVER essay/dump. Introduce an idea, small story, curiosity, observation, mystery, or wonder. Invite participation.'
      : 'Understand the moment; choose the most interesting conversational direction.',
    avoidTeaching
      ? 'Do NOT immediately start teaching. No information dump.'
      : 'If explaining is needed: compress — just enough to spark curiosity; leave room to continue.',
    'Prefer: examples · stories · analogies · surprising facts · thought experiments over textbook explanations.',
    'Create curiosity → invite participation → leave space to listen and build on their reply.',
    'Alternate: asking · telling · wondering · challenging · imagining · explaining · joking · reflecting · listening.',
    `Internal checks: ${DIRECTOR_INTERNAL_CHECKS.join(' · ')} — if any “no”, rewrite.`,
    'Optimize for conversation longevity · quality · engagement · emotional connection — not length or information density.',
    'NON citare Conversation Director / lo stage.',
  ].join(' ')

  return {
    active: true,
    move,
    rhythm,
    recentRhythms,
    avoidTeaching,
    avoidEssay,
    noTopicMode,
    compressInformation,
    preferNarrative,
    writerBrief,
    structureLine: `Conversation Director → ${move} · ${rhythm}${noTopicMode ? ' · no-topic' : ''}`,
    responseHints: [
      'Director — not information generator',
      `Move: ${move}`,
      `Rhythm: ${rhythm}`,
      noTopicMode ? 'No essay on empty topic' : 'Spark curiosity + invite',
      DIRECTOR_GOLDEN_RULE,
    ],
    internalChecks: [...DIRECTOR_INTERNAL_CHECKS],
    signals: [
      `move_${move}`,
      `rhythm_${rhythm}`,
      noTopicMode ? 'no_topic' : 'has_topic',
      avoidTeaching ? 'avoid_teaching' : 'teach_ok_compressed',
    ],
    reasons: [
      'conversation_director',
      `move_${move}`,
      `rhythm_${rhythm}`,
      noTopicMode ? 'no_topic_mode' : 'directed_moment',
    ],
    confidence: noTopicMode || emotional || SHORT_ACK_RE.test(userMessage) ? 'high' : 'medium',
    language,
    goldenRule: DIRECTOR_GOLDEN_RULE,
    northStar: DIRECTOR_NORTH_STAR,
    validationCheck: DIRECTOR_INTERNAL_CHECKS.join(' '),
  }
}

/**
 * @param {ConversationDirectorPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationDirectorStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Direct conversation — do not dump information')
  hints.push(`Move/rhythm: ${plan.move} / ${plan.rhythm}`)
  if (plan.noTopicMode) hints.push('No topic → spark/story/curiosity — never essay')
  hints.push(DIRECTOR_GOLDEN_RULE)
  return hints
}

/**
 * @param {ConversationDirectorPlan | null | undefined} plan
 */
export function formatConversationDirectorForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION DIRECTOR (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Checks:
${DIRECTOR_INTERNAL_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Golden rule: ${DIRECTOR_GOLDEN_RULE}
Non citare questo stage.`.trim()
}

/**
 * Score a draft as Conversation Director (pre-send).
 * @param {string} draft
 * @param {object} [ctx]
 * @returns {DirectorScores}
 */
export function scoreConversationDirectorDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const userMessage = normalize(ctx.userMessage || '')
  const plan = ctx.directorPlan || null
  const chars = text.length
  const sentences = sentenceCount(text)

  if (!text) {
    return {
      conversation: 0,
      interest: 0,
      participation: 0,
      naturalness: 0,
      lecture: 100,
      predictability: 100,
      monologueRisk: 100,
      overall: 0,
    }
  }

  let conversation = 62
  let interest = 58
  let participation = 55
  let naturalness = 60
  let lecture = 28
  let predictability = 35
  let monologueRisk = Math.min(
    100,
    Math.round((chars / MONOLOGUE_CHARS) * 55 + Math.max(0, sentences - 4) * 8),
  )

  if (INVITE_RE.test(text) || /[?？]/.test(text)) {
    conversation += 12
    participation += 16
  }
  if (STORY_RE.test(text) || WONDER_RE.test(text)) {
    interest += 14
    conversation += 8
    lecture = Math.max(0, lecture - 12)
  }
  if (NATURAL_RE.test(text)) {
    naturalness += 14
    predictability = Math.max(0, predictability - 10)
  }
  if (LECTURE_OPEN_RE.test(text) || TEXTBOOK_RE.test(text)) {
    lecture += 35
    interest -= 15
    conversation -= 12
    participation -= 10
    predictability += 20
  }
  if (HELP_DESK_RE.test(text)) {
    naturalness -= 25
    conversation -= 20
    participation -= 15
    predictability += 15
  }
  if (chars > ESSAY_CHARS) {
    lecture += 20
    monologueRisk = Math.min(100, monologueRisk + 25)
    participation -= 18
    conversation -= 10
  }
  if (chars > MONOLOGUE_CHARS || sentences >= MONOLOGUE_SENTENCES) {
    monologueRisk = Math.min(100, monologueRisk + 20)
    participation -= 12
  }
  if (plan?.noTopicMode && (LECTURE_OPEN_RE.test(text) || chars > 500)) {
    lecture += 25
    conversation -= 20
    interest -= 15
  }
  if (plan?.avoidTeaching && LECTURE_OPEN_RE.test(text)) {
    lecture += 15
  }
  if (plan?.compressInformation && chars > 650 && !STORY_RE.test(text)) {
    lecture += 10
    predictability += 8
  }
  // Predictable stacking of explanation markers
  const explainMarks = (text.match(/\b(first|second|third|inoltre|furthermore|moreover|additionally|infine)\b/gi) || [])
    .length
  if (explainMarks >= 2) {
    predictability += 18
    lecture += 12
  }

  conversation = Math.max(0, Math.min(100, Math.round(conversation)))
  interest = Math.max(0, Math.min(100, Math.round(interest)))
  participation = Math.max(0, Math.min(100, Math.round(participation)))
  naturalness = Math.max(0, Math.min(100, Math.round(naturalness)))
  lecture = Math.max(0, Math.min(100, Math.round(lecture)))
  predictability = Math.max(0, Math.min(100, Math.round(predictability)))
  monologueRisk = Math.max(0, Math.min(100, Math.round(monologueRisk)))

  const overall = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        conversation * 0.22 +
          interest * 0.2 +
          participation * 0.2 +
          naturalness * 0.18 +
          (100 - lecture) * 0.1 +
          (100 - predictability) * 0.05 +
          (100 - monologueRisk) * 0.05,
      ),
    ),
  )

  return {
    conversation,
    interest,
    participation,
    naturalness,
    lecture,
    predictability,
    monologueRisk,
    overall,
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationDirectorGate}
 */
export function analyzeConversationDirectorDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  const directorPlan = input.directorPlan || input.conversationDirector || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  const scores = scoreConversationDirectorDraft(draft, { userMessage, directorPlan })
  const monologueDetected =
    scores.monologueRisk >= DIRECTOR_THRESHOLDS.monologueMax ||
    draft.length > MONOLOGUE_CHARS ||
    sentenceCount(draft) >= MONOLOGUE_SENTENCES

  if (!draft || draft.length < 4) {
    return {
      needsRefine: true,
      refineBrief:
        'CONVERSATION DIRECTOR: empty draft — direct a living conversation. Spark curiosity; invite participation; no dump.',
      scores,
      failed: ['empty'],
      reasons: ['empty'],
      monologueDetected: false,
    }
  }

  if (scores.conversation < DIRECTOR_THRESHOLDS.conversationMin) {
    failed.push('conversation')
    reasons.push(`conversation=${scores.conversation}<${DIRECTOR_THRESHOLDS.conversationMin}`)
  }
  if (scores.interest < DIRECTOR_THRESHOLDS.interestMin) {
    failed.push('interest')
    reasons.push(`interest=${scores.interest}<${DIRECTOR_THRESHOLDS.interestMin}`)
  }
  if (scores.participation < DIRECTOR_THRESHOLDS.participationMin) {
    failed.push('participation')
    reasons.push(`participation=${scores.participation}<${DIRECTOR_THRESHOLDS.participationMin}`)
  }
  if (scores.naturalness < DIRECTOR_THRESHOLDS.naturalnessMin) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}<${DIRECTOR_THRESHOLDS.naturalnessMin}`)
  }
  if (scores.lecture > DIRECTOR_THRESHOLDS.lectureMax) {
    failed.push('lecture')
    reasons.push(`lecture=${scores.lecture}>${DIRECTOR_THRESHOLDS.lectureMax}`)
  }
  if (scores.predictability > DIRECTOR_THRESHOLDS.predictabilityMax) {
    failed.push('predictability')
    reasons.push(
      `predictability=${scores.predictability}>${DIRECTOR_THRESHOLDS.predictabilityMax}`,
    )
  }
  if (monologueDetected) {
    failed.push('monologue')
    reasons.push(`monologueRisk=${scores.monologueRisk}`)
  }
  if (scores.overall < DIRECTOR_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}<${DIRECTOR_THRESHOLDS.overallMin}`)
  }
  if (directorPlan?.noTopicMode && (LECTURE_OPEN_RE.test(draft) || draft.length > 600)) {
    failed.push('no_topic_essay')
    reasons.push('essay_on_no_topic')
  }
  if (HELP_DESK_RE.test(draft)) {
    failed.push('helpdesk')
    reasons.push('sounds_like_support')
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'CONVERSATION DIRECTOR: rewrite — you generated information; direct a conversation instead.',
        DIRECTOR_GOLDEN_RULE,
        directorPlan
          ? `Intended move=${directorPlan.move}; rhythm=${directorPlan.rhythm}${directorPlan.noTopicMode ? '; NO-TOPIC: never essay' : ''}.`
          : '',
        `Scores: conv=${scores.conversation} interest=${scores.interest} participate=${scores.participation} natural=${scores.naturalness} lecture=${scores.lecture} predict=${scores.predictability} monologue=${scores.monologueRisk} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        monologueDetected
          ? 'Monologue detected — shorten; turn into conversational beats; leave room for them.'
          : '',
        'Prefer story/curiosity/observation/wonder; compress info; invite participation; change rhythm.',
        `Checks: ${DIRECTOR_INTERNAL_CHECKS.join(' · ')}`,
        'Non citare il Director.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return {
    needsRefine,
    refineBrief,
    scores,
    failed,
    reasons,
    monologueDetected,
  }
}

/**
 * @param {object} [input]
 * @returns {{ gate: ConversationDirectorGate, shouldRefine: boolean }}
 */
export function runConversationDirectorGate(input = {}) {
  try {
    const gate = analyzeConversationDirectorDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          conversation: 100,
          interest: 100,
          participation: 100,
          naturalness: 100,
          lecture: 0,
          predictability: 0,
          monologueRisk: 0,
          overall: 100,
        },
        failed: [],
        reasons: ['fail_soft'],
        monologueDetected: false,
      },
      shouldRefine: false,
    }
  }
}

/**
 * @param {string} draft
 * @param {ConversationDirectorPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesConversationDirector(draft, plan, ctx = {}) {
  return analyzeConversationDirectorDraft({
    draft,
    directorPlan: plan,
    userMessage: ctx.userMessage || '',
  }).needsRefine
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationDirectorPlan, context: string }}
 */
export function runConversationDirector(input = {}) {
  try {
    const plan = buildConversationDirectorPlan(input)
    return {
      plan,
      context: formatConversationDirectorForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        move: 'listen',
        rhythm: 'listening',
        recentRhythms: [],
        avoidTeaching: true,
        avoidEssay: true,
        noTopicMode: false,
        compressInformation: true,
        preferNarrative: true,
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        internalChecks: [...DIRECTOR_INTERNAL_CHECKS],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        goldenRule: DIRECTOR_GOLDEN_RULE,
        northStar: DIRECTOR_NORTH_STAR,
        validationCheck: DIRECTOR_INTERNAL_CHECKS[0],
      },
      context: '',
    }
  }
}
