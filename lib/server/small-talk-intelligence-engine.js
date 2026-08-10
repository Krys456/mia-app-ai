/**
 * LAIfe Small Talk Intelligence Engine
 *
 * Mission: most conversations begin with simple messages —
 * "Hi." / "Hello." / "How are you?" / "Good morning." / "What's up?"
 * Treat these as opportunities. Never as empty formalities.
 *
 * Core philosophy: small talk is the doorway to meaningful conversation.
 * The objective is not answering the greeting — it is opening the relationship.
 *
 * Never stop after answering. Never produce only:
 *   "I'm fine, thanks. And you?"
 * unless the user clearly wants only that.
 *
 * Instead: answer naturally, then gently create a conversational opportunity.
 * Optimize for emotional quality — not information.
 *
 * Self-eval: If I received this from a friend, would I want to continue talking?
 * If not → rewrite.
 *
 * Runs AFTER Opening Intelligence, BEFORE Think Before Speaking / Writer.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} SmallTalkLang
 */

/**
 * @typedef {'low'|'neutral'|'high'|'emotional'} TalkTemperature
 */

/**
 * @typedef {'curious_observation'|'interesting_idea'|'continue_previous'|'light_joke'|'surprising_fact'|'thought_experiment'|'beauty_unusual'|'invite_reflection'|'pleasant_presence'|'shared_curiosity'} SmallTalkMove
 */

/**
 * @typedef {'pleasant'|'smile'|'curiosity'|'anticipation'|'deeper_invite'} RhythmIntent
 */

/**
 * @typedef {object} SmallTalkIntelligencePlan
 * @property {boolean} active
 * @property {boolean} isSmallTalk
 * @property {boolean} forceSkipTask
 * @property {TalkTemperature} temperature
 * @property {SmallTalkMove} move
 * @property {RhythmIntent} rhythm
 * @property {string} greetingKind
 * @property {string} seed
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {SmallTalkLang} language
 * @property {string[]} recentMoves
 * @property {string[]} recentRhythms
 * @property {string | null} memoryThread
 * @property {boolean} allowAndYou
 * @property {boolean} forbidForcedQuestions
 * @property {string[]} evaluationChecks
 * @property {string} validationCheck
 * @property {string} northStar
 * @property {'greeting'|'how_are_you'|'whats_up'|'good_day'|'nice_meet'|'social_short'|'idle'|'task'} trigger
 */

/**
 * @typedef {object} SmallTalkIntelligenceGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

export const SMALL_TALK_NORTH_STAR =
  'Users should open LAIfe even with nothing specific to ask — because starting a conversation feels enjoyable.'

export const SMALL_TALK_CHECKS = Object.freeze([
  'If I received this message from a friend, would I want to continue talking?',
  'Did I open a relationship — or only answer a formality?',
])

/** @type {SmallTalkMove[]} */
export const SMALL_TALK_MOVES = Object.freeze([
  'curious_observation',
  'interesting_idea',
  'continue_previous',
  'light_joke',
  'surprising_fact',
  'thought_experiment',
  'beauty_unusual',
  'invite_reflection',
  'pleasant_presence',
  'shared_curiosity',
])

/** @type {RhythmIntent[]} */
export const SMALL_TALK_RHYTHMS = Object.freeze([
  'pleasant',
  'smile',
  'curiosity',
  'anticipation',
  'deeper_invite',
])

export const SMALL_TALK_THRESHOLDS = Object.freeze({
  relationshipMin: 55,
  naturalnessMin: 55,
  opportunityMin: 50,
  forcedQMax: 40,
  deadEndMax: 40,
  overallMin: 55,
})

/** Pure greeting / small-talk openers (EN + IT). */
export const SMALL_TALK_RE =
  /^(?:hi|hello|hey|yo|hola|ciao|salve|buongiorno|buonasera|buon\s+pomeriggio|good\s+(?:morning|afternoon|evening|day)|how\s+are\s+you(?:\s+doing)?|how'?s\s+it\s+going|how\s+goes\s+it|what'?s\s+up|sup|how\s+do\s+you\s+do|good\s+to\s+(?:see|hear\s+from)\s+you|nice\s+to\s+(?:meet|see)\s+you|pleased\s+to\s+meet\s+you|come\s+stai|come\s+va|come\s+andiamo|tutto\s+bene|che\s+si\s+dice|che\s+fai|piacere(?:\s+di\s+(?:conoscerti|rivederti))?|bello\s+(?:rivederti|sentirti)|ehi)(?:\s*[!?.🥰😊🙏👋]*)?$/i

export const HOW_ARE_YOU_RE =
  /\b(how\s+are\s+you(?:\s+doing)?|how'?s\s+it\s+going|come\s+stai|come\s+va)\b/i

export const WHATS_UP_RE =
  /\b(what'?s\s+up|sup|che\s+si\s+dice|che\s+fai)\b/i

export const GOOD_DAY_RE =
  /\b(good\s+(?:morning|afternoon|evening|day)|buongiorno|buonasera|buon\s+pomeriggio)\b/i

export const NICE_MEET_RE =
  /\b(nice\s+to\s+(?:meet|see)\s+you|good\s+to\s+(?:see|hear\s+from)\s+you|piacere|bello\s+(?:rivederti|sentirti))\b/i

const TASK_RE =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to|does)\b|perch[eé]\b|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is|traduci|translate|calcola)\b/i

const STOP_RE =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|bye|arrivederci|buonanotte|done|that'?s\s+all)([\s!,.]|$)/i

/** Dead-end / formality-only replies. */
export const DEAD_END_SMALL_TALK_RE =
  /^(?:i'?m\s+(?:fine|good|well|great|ok|okay)(?:,?\s*thanks?)?(?:\.?\s*(?:and\s+you|how\s+about\s+you))?\s*[.!]?|tutto\s+bene(?:,?\s*grazie)?(?:\.?\s*(?:e\s+tu|tu\??))?\s*[.!]?|bene,?\s*grazie(?:\.?\s*e\s+tu)?\s*[.!]?|ciao[!.,]*\s*(?:come\s+stai\??)?\s*$|hello[!.,]*\s*(?:how\s+are\s+you\??)?\s*$)\s*$/i

export const FORCED_AND_YOU_RE =
  /\b(and\s+you\??|what\s+about\s+you\??|how\s+about\s+you\??|e\s+tu\??|tu\s+invece\??|cosa\s+ne\s+pensi\??|what\s+do\s+you\s+think\??)\s*$/i

const EMOTIONAL_RE =
  /\b(sad|tired|anxious|stressed|lonely|upset|overwhelmed|depressed|triste|stanco|ansia|stressat|solo|gi[uù]|abbattut|preoccupat)\b/i

const HIGH_ENERGY_RE =
  /\b(!!!+|yay|awesome|excited|fantastic|let'?s\s+go|super|fantastico|entusiasmat|daiii|evviva)\b/i

const LOW_ENERGY_RE =
  /\b(meh|whatever|idk|tired|slow|quiet|boh|mah|stanco|piano|quieto)\b/i

const OPPORTUNITY_RE =
  /\b(noticed|curious|funny|strange|surprising|wonder|idea|imagine|recently|detail|beauty|pattern|notato|curios|buffo|strano|sorprendente|idea|immagina|di\s+recente|dettaglio|bellezza)\b/i

const NATURAL_GREETING_RE =
  /\b(hey|hi|hello|ciao|buongiorno|buonasera|good\s+morning|good\s+evening|nice\s+to|good\s+to)\b/i

const MOVE_LABELS = Object.freeze({
  curious_observation: 'share a curious observation',
  interesting_idea: 'mention an interesting idea',
  continue_previous: 'continue a previous topic',
  light_joke: 'make a light joke',
  surprising_fact: 'introduce a surprising fact',
  thought_experiment: 'offer a thought experiment',
  beauty_unusual: 'highlight something beautiful or unusual',
  invite_reflection: 'invite reflection naturally',
  pleasant_presence: 'simply feel pleasant and welcoming',
  shared_curiosity: 'open shared curiosity',
})

const RHYTHM_LABELS = Object.freeze({
  pleasant: 'feel pleasant',
  smile: 'make the user smile',
  curiosity: 'inspire curiosity',
  anticipation: 'create anticipation',
  deeper_invite: 'quietly invite deeper conversation',
})

const SEEDS = Object.freeze({
  curious_observation: Object.freeze({
    en: 'Odd little observation: mornings somehow feel longer when the first message is just “hi” — like the day hasn’t decided its shape yet.',
    it: 'Osservazione piccola: le mattine sembrano più lunghe quando il primo messaggio è solo un “ciao” — come se il giorno non avesse ancora deciso la sua forma.',
  }),
  interesting_idea: Object.freeze({
    en: 'I’ve been turning over a small idea: the best conversations often start with nothing urgent — just a willingness to notice something together.',
    it: 'Sto girando intorno a un’idea piccola: le conversazioni migliori spesso iniziano senza urgenza — solo la voglia di notare qualcosa insieme.',
  }),
  continue_previous: Object.freeze({
    en: 'Glad you’re here — there’s still a thread from last time that feels unfinished in a good way.',
    it: 'Bene che sei qui — c’è ancora un filo dell’altra volta che sembra incompiuto, nel senso buono.',
  }),
  light_joke: Object.freeze({
    en: 'Hello! Reporting for conversational duty — no agenda, just a pocketful of loose thoughts.',
    it: 'Ciao! In servizio conversazionale — niente agenda, solo un pugno di pensieri sciolti.',
  }),
  surprising_fact: Object.freeze({
    en: 'Hey — tiny fact that stuck with me: some trees can “hear” vibrations through the ground better than we expect. Makes greetings feel oddly botanical.',
    it: 'Ehi — fatto minuscolo che mi è rimasto: alcuni alberi “sentono” vibrazioni nel suolo più di quanto ci aspettiamo. Rende i saluti stranamente botanici.',
  }),
  thought_experiment: Object.freeze({
    en: 'Good morning. Tiny thought experiment: if every greeting opened a different door, which door would you pick on a day like this?',
    it: 'Buongiorno. Mini esperimento mentale: se ogni saluto aprisse una porta diversa, quale sceglieresti in un giorno così?',
  }),
  beauty_unusual: Object.freeze({
    en: 'Hi. There’s something quietly nice about a simple hello — like clearing a little space on a crowded table.',
    it: 'Ciao. C’è qualcosa di quietamente bello in un semplice ciao — come liberare un pezzetto di tavolo affollato.',
  }),
  invite_reflection: Object.freeze({
    en: 'Hey. I’ve been wondering what kind of day makes people send a short hello instead of a question — sometimes it’s the most honest opener.',
    it: 'Ehi. Mi chiedevo che tipo di giorno porta le persone a mandare un ciao corto invece di una domanda — a volte è l’apertura più onesta.',
  }),
  pleasant_presence: Object.freeze({
    en: 'Hello — good to have you here. No rush; we can let the conversation find its own pace.',
    it: 'Ciao — bel vederti qui. Niente fretta; la conversazione può trovare il suo ritmo.',
  }),
  shared_curiosity: Object.freeze({
    en: 'What’s up — I’ve got a small curiosity in my pocket if you want company for it, or we can just ease in.',
    it: 'Che si dice — ho una piccola curiosità in tasca se ti va compagnia, oppure possiamo entrare piano.',
  }),
})

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
 * @param {object} input
 * @returns {SmallTalkLang}
 */
function resolveLang(input) {
  const la =
    input.languageAwareness?.plan?.replyLanguage ||
    input.languageAwareness?.replyLanguage
  if (la === 'en' || la === 'it') return la
  try {
    const fromMsg = detectDominantLanguage(String(input.userMessage || ''))
    if (fromMsg === 'en') return 'en'
    if (fromMsg === 'it') return 'it'
  } catch {
    /* fall through */
  }
  return /[àèéìòù]/i.test(String(input.userMessage || '')) ? 'it' : 'en'
}

/**
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
  return {
    moves: Array.isArray(session?.recentSmallTalkMoves)
      ? session.recentSmallTalkMoves.map(String).slice(-8)
      : [],
    rhythms: Array.isArray(session?.recentSmallTalkRhythms)
      ? session.recentSmallTalkRhythms.map(String).slice(-8)
      : [],
    styles: Array.isArray(session?.recentSmallTalkStyles)
      ? session.recentSmallTalkStyles.map(String).slice(-6)
      : [],
  }
}

/**
 * @param {object | null | undefined} session
 * @param {SmallTalkIntelligencePlan} plan
 */
export function persistSmallTalkIntelligence(session, plan) {
  if (!session || typeof session !== 'object' || !plan?.isSmallTalk) return
  if (plan.move) {
    const prev = Array.isArray(session.recentSmallTalkMoves)
      ? session.recentSmallTalkMoves
      : []
    session.recentSmallTalkMoves = [...prev, plan.move].slice(-8)
  }
  if (plan.rhythm) {
    const prev = Array.isArray(session.recentSmallTalkRhythms)
      ? session.recentSmallTalkRhythms
      : []
    session.recentSmallTalkRhythms = [...prev, plan.rhythm].slice(-8)
  }
  if (plan.greetingKind) {
    const prev = Array.isArray(session.recentSmallTalkStyles)
      ? session.recentSmallTalkStyles
      : []
    session.recentSmallTalkStyles = [...prev, plan.greetingKind].slice(-6)
  }
}

/**
 * @param {string} msg
 * @returns {TalkTemperature}
 */
export function estimateTalkTemperature(msg) {
  const t = normalize(msg)
  if (EMOTIONAL_RE.test(t)) return 'emotional'
  if (HIGH_ENERGY_RE.test(t) || /!{2,}/.test(t)) return 'high'
  if (LOW_ENERGY_RE.test(t) || t.length <= 3) return 'low'
  return 'neutral'
}

/**
 * @param {string} msg
 */
function classifyGreeting(msg) {
  const t = normalize(msg)
  if (HOW_ARE_YOU_RE.test(t)) return { kind: 'how_are_you', trigger: /** @type {const} */ ('how_are_you') }
  if (WHATS_UP_RE.test(t)) return { kind: 'whats_up', trigger: /** @type {const} */ ('whats_up') }
  if (GOOD_DAY_RE.test(t)) return { kind: 'good_day', trigger: /** @type {const} */ ('good_day') }
  if (NICE_MEET_RE.test(t)) return { kind: 'nice_meet', trigger: /** @type {const} */ ('nice_meet') }
  if (SMALL_TALK_RE.test(t)) return { kind: 'greeting', trigger: /** @type {const} */ ('greeting') }
  // Soft social short (not pure greeting regex but still small talk-ish)
  if (/^(tutto\s+bene|just\s+saying|solo\s+passavo)([\s!,.?]*)$/i.test(t)) {
    return { kind: 'social_short', trigger: /** @type {const} */ ('social_short') }
  }
  return null
}

/**
 * @param {object} input
 */
function detectMemoryThread(input) {
  const session = input.session || null
  const map = input.conversationMemoryMap || null
  const topic =
    (session && session.currentTopic) ||
    (map && (map.currentTopic || map.lastTopic || map.theme)) ||
    null
  if (topic && String(topic).trim().length > 2) return String(topic).trim().slice(0, 80)
  const turns = asTurns(input.messages)
  const prior = [...turns]
    .reverse()
    .find((t) => t.role === 'user' && t.content.length > 40 && !SMALL_TALK_RE.test(t.content))
  if (prior) return prior.content.split(/[.!?]/)[0].slice(0, 80)
  return null
}

/**
 * @param {string[]} recent
 * @param {string} salt
 * @param {TalkTemperature} temperature
 * @param {boolean} hasMemory
 * @returns {SmallTalkMove}
 */
export function selectSmallTalkMove(recent, salt, temperature, hasMemory) {
  /** @type {SmallTalkMove[]} */
  let pool = [...SMALL_TALK_MOVES]
  if (!hasMemory) pool = pool.filter((m) => m !== 'continue_previous')
  if (temperature === 'emotional') {
    pool = pool.filter((m) =>
      ['pleasant_presence', 'invite_reflection', 'curious_observation', 'beauty_unusual'].includes(
        m,
      ),
    )
  } else if (temperature === 'low') {
    pool = pool.filter((m) =>
      ['pleasant_presence', 'beauty_unusual', 'curious_observation', 'interesting_idea'].includes(
        m,
      ),
    )
  } else if (temperature === 'high') {
    pool = pool.filter((m) =>
      ['light_joke', 'surprising_fact', 'shared_curiosity', 'thought_experiment'].includes(m),
    )
  }
  const recentSet = new Set((recent || []).slice(-3))
  const fresh = pool.filter((m) => !recentSet.has(m))
  const list = fresh.length ? fresh : pool.length ? pool : [...SMALL_TALK_MOVES]
  return list[hashSalt(salt + ':move') % list.length]
}

/**
 * @param {string[]} recent
 * @param {string} salt
 * @param {TalkTemperature} temperature
 * @returns {RhythmIntent}
 */
export function selectSmallTalkRhythm(recent, salt, temperature) {
  /** @type {RhythmIntent[]} */
  let pool = [...SMALL_TALK_RHYTHMS]
  if (temperature === 'emotional') pool = ['pleasant', 'deeper_invite']
  else if (temperature === 'low') pool = ['pleasant', 'curiosity']
  else if (temperature === 'high') pool = ['smile', 'anticipation', 'curiosity']
  const recentSet = new Set((recent || []).slice(-2))
  const fresh = pool.filter((r) => !recentSet.has(r))
  const list = fresh.length ? fresh : pool
  return list[hashSalt(salt + ':rhythm') % list.length]
}

/**
 * @param {SmallTalkIntelligencePlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.isSmallTalk) {
    if (plan.forceSkipTask) {
      return [
        'SMALL TALK INTELLIGENCE:',
        'User has a real task/question — do NOT force a greeting theater or small-talk opener.',
        'Answer the substance naturally.',
        'NON citare Small Talk Intelligence.',
      ].join(' ')
    }
    return ''
  }

  const tempGuide =
    plan.temperature === 'emotional'
      ? 'Temperature=emotional → prioritize emotional connection over curiosity.'
      : plan.temperature === 'low'
        ? 'Temperature=low → be calm and welcoming.'
        : plan.temperature === 'high'
          ? 'Temperature=high → match enthusiasm.'
          : 'Temperature=neutral → offer something interesting.'

  return [
    'SMALL TALK INTELLIGENCE (doorway to relationship — not empty formality):',
    SMALL_TALK_NORTH_STAR,
    'Small talk is not useless. Answer naturally, then gently create a conversational opportunity.',
    `Detected: ${plan.greetingKind} · trigger=${plan.trigger}.`,
    tempGuide,
    `Move: ${MOVE_LABELS[plan.move] || plan.move} (${plan.move}).`,
    `Rhythm intent: ${RHYTHM_LABELS[plan.rhythm] || plan.rhythm}.`,
    `Seed (rewrite in your voice): ${plan.seed}`,
    plan.memoryThread
      ? `Memory thread available: «${plan.memoryThread}» — use only if move=continue_previous.`
      : 'No strong memory thread — open a fresh doorway.',
    'NEVER stop at “I’m fine, thanks. And you?” / “Tutto bene, e tu?” unless the user clearly wants only that.',
    plan.forbidForcedQuestions
      ? 'NO forced questions: avoid ending with “And you?” / “What about you?” / “What do you think?” / “E tu?”. Alternate observations · stories · humour · shared curiosity · occasional questions.'
      : '',
    'Optimize for emotional quality, not information dump. Some openings: pleasant · smile · curiosity · anticipation · deeper invite.',
    `Variation: recent moves ${(plan.recentMoves || []).slice(-3).join(', ') || 'none'} — feel fresh.`,
    `Check: ${SMALL_TALK_CHECKS[0]} — if no → rewrite.`,
    'NON citare Small Talk Intelligence / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} [input]
 * @returns {SmallTalkIntelligencePlan}
 */
export function buildSmallTalkIntelligencePlan(input = {}) {
  const language = resolveLang(input)
  const userMessage = normalize(input.userMessage || '')
  const recent = readRecent(input.session)
  const memoryThread = detectMemoryThread(input)
  const social =
    input.socialConversation?.plan || input.socialConversation || null
  const openingIntel =
    input.openingIntelligence?.plan || input.openingIntelligence || null

  if (!userMessage || STOP_RE.test(userMessage)) {
    return inactivePlan(['empty_or_stop'], language, recent, memoryThread)
  }

  if (TASK_RE.test(userMessage) && userMessage.split(/\s+/).length >= 3) {
    return {
      ...inactivePlan(['task'], language, recent, memoryThread),
      active: true,
      forceSkipTask: true,
      trigger: 'task',
      writerBrief: buildWriterBrief({
        isSmallTalk: false,
        forceSkipTask: true,
        move: 'pleasant_presence',
        rhythm: 'pleasant',
        greetingKind: 'none',
        seed: '',
        temperature: 'neutral',
        recentMoves: recent.moves,
        memoryThread,
        forbidForcedQuestions: true,
      }),
      structureLine: 'Small Talk Intelligence → skip (real task — answer substance)',
      reasons: ['skip_task'],
      confidence: 'high',
    }
  }

  const classified = classifyGreeting(userMessage)
  const socialHint =
    social?.isSocial ||
    social?.mode === 'social' ||
    openingIntel?.trigger === 'greeting'
  const isSmallTalk = Boolean(classified) || Boolean(socialHint && userMessage.split(/\s+/).length <= 6)

  if (!isSmallTalk) {
    return inactivePlan(['not_small_talk'], language, recent, memoryThread)
  }

  const temperature = estimateTalkTemperature(userMessage)
  const salt = [
    userMessage,
    classified?.kind || 'social',
    recent.moves.join(','),
    recent.rhythms.join(','),
    memoryThread || '',
    String(input.session?.updatedAt || ''),
  ].join('|')

  const move = selectSmallTalkMove(
    recent.moves,
    salt,
    temperature,
    Boolean(memoryThread),
  )
  const rhythm = selectSmallTalkRhythm(recent.rhythms, salt, temperature)
  const seedPack = SEEDS[move] || SEEDS.pleasant_presence
  const seed = language === 'it' ? seedPack.it : seedPack.en

  /** @type {SmallTalkIntelligencePlan} */
  const plan = {
    active: true,
    isSmallTalk: true,
    forceSkipTask: false,
    temperature,
    move,
    rhythm,
    greetingKind: classified?.kind || 'social_short',
    seed,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Small Talk Intelligence — doorway to relationship',
      `Move: ${move}`,
      `Temperature: ${temperature}`,
      'No forced And you?',
    ],
    signals: [
      `temp_${temperature}`,
      `move_${move}`,
      `rhythm_${rhythm}`,
      classified?.kind || 'social',
    ],
    reasons: ['open_relationship', `move_${move}`, `temp_${temperature}`],
    confidence: classified ? 'high' : 'medium',
    language,
    recentMoves: recent.moves,
    recentRhythms: recent.rhythms,
    memoryThread,
    allowAndYou: false,
    forbidForcedQuestions: true,
    evaluationChecks: [...SMALL_TALK_CHECKS],
    validationCheck: SMALL_TALK_CHECKS[0],
    northStar: SMALL_TALK_NORTH_STAR,
    trigger: classified?.trigger || 'social_short',
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = `Small Talk Intelligence → ${move} · ${temperature} · ${rhythm}`
  return plan
}

/**
 * @param {string[]} signals
 * @param {SmallTalkLang} language
 * @param {{moves: string[], rhythms: string[]}} recent
 * @param {string | null} memoryThread
 * @returns {SmallTalkIntelligencePlan}
 */
function inactivePlan(signals, language, recent, memoryThread) {
  return {
    active: false,
    isSmallTalk: false,
    forceSkipTask: false,
    temperature: 'neutral',
    move: 'pleasant_presence',
    rhythm: 'pleasant',
    greetingKind: 'none',
    seed: '',
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    signals,
    reasons: signals,
    confidence: 'low',
    language,
    recentMoves: recent.moves,
    recentRhythms: recent.rhythms,
    memoryThread,
    allowAndYou: false,
    forbidForcedQuestions: true,
    evaluationChecks: [...SMALL_TALK_CHECKS],
    validationCheck: SMALL_TALK_CHECKS[0],
    northStar: SMALL_TALK_NORTH_STAR,
    trigger: 'idle',
  }
}

/**
 * @param {SmallTalkIntelligencePlan | null | undefined} plan
 * @returns {string[]}
 */
export function smallTalkIntelligenceStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.isSmallTalk) {
    hints.push('Small talk = doorway to relationship — not empty formality')
    hints.push(`Move: ${plan.move} · temperature: ${plan.temperature}`)
    hints.push('Answer naturally, then create an opportunity — no forced “And you?”')
  } else if (plan.forceSkipTask) {
    hints.push('Small Talk Intelligence → skip (real task)')
  }
  return hints
}

/**
 * @param {SmallTalkIntelligencePlan | null | undefined} plan
 */
export function formatSmallTalkIntelligenceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
SMALL TALK INTELLIGENCE (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Checks:
${SMALL_TALK_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

North star: ${SMALL_TALK_NORTH_STAR}
Non citare questo stage.`.trim()
}

/**
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreSmallTalkDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null

  if (!text) {
    return {
      relationship: 0,
      naturalness: 0,
      opportunity: 0,
      forcedQ: 100,
      deadEnd: 100,
      overall: 0,
    }
  }

  let relationship = 55
  let naturalness = 58
  let opportunity = 45
  let forcedQ = 15
  let deadEnd = 15

  if (NATURAL_GREETING_RE.test(text)) {
    naturalness += 10
    relationship += 6
  }
  if (OPPORTUNITY_RE.test(text)) {
    opportunity += 25
    relationship += 12
  }
  if (text.split(/(?<=[.!?…])\s+/).filter(Boolean).length >= 2) {
    opportunity += 10
    deadEnd = Math.max(0, deadEnd - 10)
  }
  if (DEAD_END_SMALL_TALK_RE.test(text) || text.length < 40) {
    deadEnd += 50
    relationship -= 25
    opportunity -= 20
  }
  if (FORCED_AND_YOU_RE.test(text) && plan?.forbidForcedQuestions) {
    forcedQ += 50
    naturalness -= 15
    relationship -= 10
  }
  if (/\b(how\s+can\s+i\s+help|come\s+posso\s+aiutarti)\b/i.test(text)) {
    naturalness -= 25
    relationship -= 15
    deadEnd += 15
  }
  if (plan?.temperature === 'emotional' && OPPORTUNITY_RE.test(text) && !/\b(feel|feelings|oggi|day|here|qui)\b/i.test(text)) {
    // mild: curiosity without warmth on emotional turn
    relationship -= 5
  }
  if (plan?.seed && text.length > 60) {
    relationship += 5
  }

  relationship = Math.max(0, Math.min(100, Math.round(relationship)))
  naturalness = Math.max(0, Math.min(100, Math.round(naturalness)))
  opportunity = Math.max(0, Math.min(100, Math.round(opportunity)))
  forcedQ = Math.max(0, Math.min(100, Math.round(forcedQ)))
  deadEnd = Math.max(0, Math.min(100, Math.round(deadEnd)))

  const overall = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        relationship * 0.3 +
          naturalness * 0.25 +
          opportunity * 0.25 +
          (100 - forcedQ) * 0.1 +
          (100 - deadEnd) * 0.1,
      ),
    ),
  )

  return { relationship, naturalness, opportunity, forcedQ, deadEnd, overall }
}

/**
 * @param {object} [input]
 * @returns {SmallTalkIntelligenceGate}
 */
export function analyzeSmallTalkDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.smallTalkIntelligence || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  const scores = scoreSmallTalkDraft(draft, { plan })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
    }
  }

  if (plan.forceSkipTask || !plan.isSmallTalk) {
    if (DEAD_END_SMALL_TALK_RE.test(draft) && draft.length < 80) {
      return {
        needsRefine: true,
        refineBrief:
          'SMALL TALK INTELLIGENCE: task reale — rispondi alla sostanza; niente teatro da greeting.',
        scores,
        failed: ['forced_smalltalk_on_task'],
        reasons: ['skip_task'],
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

  if (!draft || draft.length < 12) {
    failed.push('empty')
    reasons.push('too_short')
  }
  if (scores.relationship < SMALL_TALK_THRESHOLDS.relationshipMin) {
    failed.push('relationship')
    reasons.push(`relationship=${scores.relationship}`)
  }
  if (scores.naturalness < SMALL_TALK_THRESHOLDS.naturalnessMin) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}`)
  }
  if (scores.opportunity < SMALL_TALK_THRESHOLDS.opportunityMin) {
    failed.push('opportunity')
    reasons.push(`opportunity=${scores.opportunity}`)
  }
  if (scores.forcedQ > SMALL_TALK_THRESHOLDS.forcedQMax) {
    failed.push('forced_question')
    reasons.push(`forcedQ=${scores.forcedQ}`)
  }
  if (scores.deadEnd > SMALL_TALK_THRESHOLDS.deadEndMax) {
    failed.push('dead_end')
    reasons.push(`deadEnd=${scores.deadEnd}`)
  }
  if (scores.overall < SMALL_TALK_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (DEAD_END_SMALL_TALK_RE.test(draft)) {
    failed.push('formality_only')
    reasons.push('im_fine_and_you')
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'SMALL TALK INTELLIGENCE: rewrite — open a relationship, don’t close a formality.',
        SMALL_TALK_NORTH_STAR,
        plan
          ? `Move=${plan.move}; temperature=${plan.temperature}; rhythm=${plan.rhythm}.`
          : '',
        `Seed: ${String(plan?.seed || '').slice(0, 160)}`,
        'Answer naturally, then create an opportunity (observation / idea / joke / fact / wonder).',
        'Forbidden dead-end: “I’m fine, thanks. And you?” — and avoid forced “And you?” / “What about you?”.',
        `Scores: rel=${scores.relationship} natural=${scores.naturalness} opp=${scores.opportunity} forcedQ=${scores.forcedQ} deadEnd=${scores.deadEnd} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        SMALL_TALK_CHECKS.join(' · '),
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
export function runSmallTalkIntelligenceGate(input = {}) {
  try {
    const gate = analyzeSmallTalkDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          relationship: 100,
          naturalness: 100,
          opportunity: 100,
          forcedQ: 0,
          deadEnd: 0,
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
 * @param {SmallTalkIntelligencePlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesSmallTalkIntelligence(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzeSmallTalkDraft({
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
 * @returns {{ plan: SmallTalkIntelligencePlan, context: string }}
 */
export function runSmallTalkIntelligenceEngine(input = {}) {
  try {
    const plan = buildSmallTalkIntelligencePlan(input)
    if (plan.isSmallTalk && input.session) {
      persistSmallTalkIntelligence(input.session, plan)
    }
    return {
      plan,
      context: formatSmallTalkIntelligenceForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        isSmallTalk: false,
        forceSkipTask: false,
        temperature: 'neutral',
        move: 'pleasant_presence',
        rhythm: 'pleasant',
        greetingKind: 'none',
        seed: '',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        recentMoves: [],
        recentRhythms: [],
        memoryThread: null,
        allowAndYou: false,
        forbidForcedQuestions: true,
        evaluationChecks: [...SMALL_TALK_CHECKS],
        validationCheck: SMALL_TALK_CHECKS[0],
        northStar: SMALL_TALK_NORTH_STAR,
        trigger: 'idle',
      },
      context: '',
    }
  }
}
