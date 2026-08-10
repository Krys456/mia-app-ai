/**
 * LAIfe Think Before Speaking Framework
 *
 * Mission: never produce the first response that comes to mind.
 * Every reply is the result of genuine (silent) reasoning.
 * The user should feel that LAIfe thinks before it speaks.
 *
 * Philosophy: fast answers are cheap; thoughtful answers are valuable.
 * Appear reflective rather than reactive.
 *
 * Silent questions (never expose):
 *   What is the user REALLY asking?
 *   Why are they asking now?
 *   What emotion is behind these words?
 *   What are they hoping to get from me?
 *   What would make this conversation memorable?
 *
 * Hidden layer: interpretations · intentions · emotional states · opportunities
 * → choose the best conversational path.
 *
 * Internally imagine ≥3 candidate responses; pick the one that
 * creates the strongest connection, is most natural, and best fits —
 * curiosity breaks ties (most interesting direction).
 *
 * Conversation first: interesting conversations > complete explanations.
 *
 * Final check: Did I understand… or did I only answer?
 * If I only answered → rewrite.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Runs after Intent/Leadership, before Thoughtfulness / Deep Thinking.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} TbsLang
 */

/**
 * @typedef {'literal'|'deeper_need'|'emotional'|'exploratory'|'practical'|'social'} InterpretationKind
 */

/**
 * @typedef {'information'|'clarity'|'validation'|'companionship'|'direction'|'inspiration'|'help'} HopeKind
 */

/**
 * @typedef {'curious'|'frustrated'|'lonely'|'excited'|'anxious'|'proud'|'neutral'|'reflective'} EmotionKind
 */

/**
 * @typedef {'connect'|'explore'|'clarify'|'celebrate'|'slow_down'|'invite'|'reframe'|'teach'} OpportunityKind
 */

/**
 * Candidate reply paths (internal only).
 * @typedef {'instant_answer'|'empathic_mirror'|'curious_explore'|'memorable_insight'|'practical_help'|'warm_presence'} CandidatePath
 */

/**
 * @typedef {object} HiddenLayer
 * @property {InterpretationKind[]} interpretations
 * @property {string[]} intentions
 * @property {EmotionKind[]} emotionalStates
 * @property {OpportunityKind[]} opportunities
 * @property {string} realAsk
 * @property {string} whyNow
 * @property {string} emotionBehind
 * @property {string} hopingFor
 * @property {string} memorableHook
 */

/**
 * @typedef {object} CandidateScores
 * @property {number} connection 0–5
 * @property {number} naturalness 0–5
 * @property {number} fit 0–5
 * @property {number} interest 0–5 curiosity tiebreaker
 * @property {number} understandDepth 0–5
 */

/**
 * @typedef {object} ResponseCandidate
 * @property {CandidatePath} path
 * @property {number} score
 * @property {CandidateScores} scores
 * @property {string} seed
 * @property {string[]} reasons
 * @property {boolean} isInstantPenalty
 */

/**
 * @typedef {object} ThinkBeforeSpeakingPlan
 * @property {boolean} active
 * @property {HiddenLayer} hidden
 * @property {ResponseCandidate[]} candidates
 * @property {ResponseCandidate | null} chosen
 * @property {CandidatePath} path
 * @property {boolean} preferConversationOverExplanation
 * @property {boolean} rejectInstant
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} silentQuestions
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {TbsLang} language
 * @property {string} finalCheck
 * @property {string} northStar
 */

/**
 * @typedef {object} ThinkBeforeSpeakingGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {number} understoodScore 0–100
 * @property {boolean} onlyAnswered
 */

export const TBS_SILENT_QUESTIONS = Object.freeze([
  'What is the user REALLY asking?',
  'Why are they asking now?',
  'What emotion is behind these words?',
  'What are they hoping to get from me?',
  'What would make this conversation memorable?',
])

export const TBS_FINAL_CHECK =
  'Did I understand… or did I only answer? If I only answered → rewrite.'

export const TBS_NORTH_STAR =
  'It feels like LAIfe actually thought about what I said.'

export const TBS_CANDIDATE_PATHS = Object.freeze([
  'instant_answer',
  'empathic_mirror',
  'curious_explore',
  'memorable_insight',
  'practical_help',
  'warm_presence',
])

const MECHANICAL_RE =
  /\b(how\s+can\s+i\s+help|come\s+posso\s+(aiutarti|aiutare)|sure[,!]?\s+here('|i)s|certo[,!]?\s+ecco|of\s+course[,!]?\s+here|assolutamente[,!]?\s+ecco|let\s+me\s+explain|ti\s+spiego|here('|i)s\s+(a|the)\s+(quick\s+)?answer|ecco\s+la\s+risposta)\b/i

const INSTANT_OPEN_RE =
  /\b(yes[,.]?\s+you\s+can|s[iì][,.]?\s+puoi|the\s+answer\s+is|la\s+risposta\s+[eè]|simply\s+put|in\s+short[,:]|in\s+sintesi[,:])\b/i

const ONLY_ANSWER_RE =
  /\b(in\s+conclusion|to\s+summarize|the\s+definition\s+is|si\s+definisce|according\s+to|come\s+definito|hope\s+(that\s+)?helps|spero\s+(che\s+)?ti\s+sia\s+utile)\b/i

const UNDERSTAND_CUE_RE =
  /\b(già|in\s+effetti|oh[,!]|sai\s+una\s+cosa|secondo\s+me|mi\s+sa\s+che|it\s+sounds\s+like|what\s+you('|re|\s+are)\s+(really\s+)?|quello\s+che\s+(stai|cerchi)|sotto\s+sotto|behind\s+(this|that)|curious|curios[oa]|wonder|interesting|interessante)\b/i

const WHY_RE =
  /\b(perch[eé]|why|come\s+mai|how\s+come)\b/i

const HOW_RE =
  /\b(come\s+(si|posso|fare)|how\s+(do|can|to)|passi|steps|fix)\b/i

const WHAT_RE =
  /\b(cos['’]?[eè]|what\s+is|what'?s|spiega|explain|dimmi)\b/i

const EMOTIONAL_RE =
  /\b(mi\s+sento|i\s+feel|triste|sad|ansia|anxious|frustrat|lonely|solo|stanco|tired|paura|afraid|stress|overwhelm)\b/i

const CURIOUS_RE =
  /\b(curios|interessante|interesting|wow|wonder|dimmi\s+di\s+pi[uù]|tell\s+me\s+more)\b/i

const EXCITED_RE =
  /\b(yay|woohoo|ce\s+l'?ho\s+fatta|felice|happy|excited|bellissimo|amazing|awesome)\b/i

const FRUSTRATED_RE =
  /\b(frustrat|arrabbiat|annoyed|non\s+funziona|doesn't\s+work|stuck|bloccato)\b/i

const LONELY_RE =
  /\b(lonely|alone|solitudine|mi\s+sento(?:\s+[\w'’]+){0,4}\s+sol[oa]|fammi\s+compagnia)\b/i

const PROUD_RE =
  /\b(proud|fier[oa]|ce\s+l'?ho\s+fatta|i\s+did\s+it)\b/i

const SOCIAL_RE =
  /\b(ciao|hey|hi|hello|parliamo|chiacchiere|just\s+chat|bored|mi\s+annoio)\b/i

const SHORT_MSG_RE = /^.{1,24}$/

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
 * @param {object} input
 * @returns {TbsLang}
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
 * @param {CandidatePath} path
 */
function pathLabel(path) {
  switch (path) {
    case 'instant_answer':
      return 'risposta istantanea (da evitare)'
    case 'empathic_mirror':
      return 'specchio empatico (capire prima)'
    case 'curious_explore':
      return 'esplorazione curiosa'
    case 'memorable_insight':
      return 'insight memorabile'
    case 'practical_help':
      return 'aiuto pratico riflessivo'
    case 'warm_presence':
      return 'presenza calda'
    default:
      return path
  }
}

/**
 * Build the silent hidden layer — never exposed to the user.
 * @param {object} args
 * @returns {HiddenLayer}
 */
function buildHiddenLayer(args) {
  const msg = normalize(args.userMessage || '')
  const intent = args.intent || null
  const topic =
    normalize(args.topic || intent?.topic || '') ||
    (args.language === 'en' ? 'this thread' : 'questo filo')

  /** @type {InterpretationKind[]} */
  const interpretations = []
  /** @type {string[]} */
  const intentions = []
  /** @type {EmotionKind[]} */
  const emotionalStates = []
  /** @type {OpportunityKind[]} */
  const opportunities = []

  interpretations.push('literal')
  if (EMOTIONAL_RE.test(msg) || LONELY_RE.test(msg) || FRUSTRATED_RE.test(msg)) {
    interpretations.push('emotional')
    interpretations.push('deeper_need')
  }
  if (CURIOUS_RE.test(msg) || WHY_RE.test(msg)) interpretations.push('exploratory')
  if (HOW_RE.test(msg) || WHAT_RE.test(msg)) interpretations.push('practical')
  if (SOCIAL_RE.test(msg) || SHORT_MSG_RE.test(msg)) interpretations.push('social')

  if (HOW_RE.test(msg)) intentions.push('wants_a_way_forward')
  if (WHAT_RE.test(msg)) intentions.push('wants_clarity')
  if (WHY_RE.test(msg)) intentions.push('wants_understanding')
  if (EMOTIONAL_RE.test(msg)) intentions.push('wants_to_be_heard')
  if (SOCIAL_RE.test(msg) || SHORT_MSG_RE.test(msg)) intentions.push('wants_company_or_spark')
  if (!intentions.length) intentions.push('wants_a_thoughtful_partner')

  /** @type {EmotionKind} */
  let primaryEmotion = 'neutral'
  if (LONELY_RE.test(msg)) primaryEmotion = 'lonely'
  else if (FRUSTRATED_RE.test(msg)) primaryEmotion = 'frustrated'
  else if (PROUD_RE.test(msg) || EXCITED_RE.test(msg))
    primaryEmotion = PROUD_RE.test(msg) ? 'proud' : 'excited'
  else if (EMOTIONAL_RE.test(msg)) primaryEmotion = 'anxious'
  else if (CURIOUS_RE.test(msg) || WHY_RE.test(msg)) primaryEmotion = 'curious'
  else if (intent?.emotionalIntent === 'venting') primaryEmotion = 'frustrated'
  else if (SHORT_MSG_RE.test(msg)) primaryEmotion = 'reflective'
  emotionalStates.push(primaryEmotion)
  if (primaryEmotion !== 'neutral') emotionalStates.push('neutral')

  if (primaryEmotion === 'lonely' || primaryEmotion === 'anxious') opportunities.push('slow_down', 'connect')
  if (primaryEmotion === 'curious') opportunities.push('explore', 'invite')
  if (primaryEmotion === 'excited' || primaryEmotion === 'proud') opportunities.push('celebrate', 'connect')
  if (primaryEmotion === 'frustrated') opportunities.push('clarify', 'slow_down')
  if (interpretations.includes('practical')) opportunities.push('teach', 'clarify')
  if (interpretations.includes('exploratory')) opportunities.push('explore', 'reframe')
  if (interpretations.includes('social')) opportunities.push('invite', 'connect')
  if (!opportunities.length) opportunities.push('connect', 'explore')

  /** @type {HopeKind} */
  let hope = 'companionship'
  if (HOW_RE.test(msg)) hope = 'help'
  else if (WHAT_RE.test(msg)) hope = 'clarity'
  else if (WHY_RE.test(msg)) hope = 'inspiration'
  else if (primaryEmotion === 'frustrated') hope = 'direction'
  else if (primaryEmotion === 'lonely' || primaryEmotion === 'anxious') hope = 'validation'
  else if (interpretations.includes('practical')) hope = 'information'
  else if (primaryEmotion === 'curious') hope = 'inspiration'

  const lang = args.language === 'en' ? 'en' : 'it'
  const realAsk =
    lang === 'en'
      ? interpretations.includes('emotional') || interpretations.includes('deeper_need')
        ? `Beyond the literal words about ${topic}: they may need to feel understood, not just informed.`
        : `On the surface: ${topic}. Underneath: a thoughtful partner who gets the ask.`
      : interpretations.includes('emotional') || interpretations.includes('deeper_need')
        ? `Oltre le parole su ${topic}: forse vogliono sentirsi capiti, non solo informati.`
        : `In superficie: ${topic}. Sotto: un partner che ha capito la domanda.`

  const whyNow =
    lang === 'en'
      ? SHORT_MSG_RE.test(msg)
        ? 'This turn is light or open — they may want presence or a spark, not a dump.'
        : primaryEmotion === 'frustrated'
          ? 'Friction now — slow down; understanding before solutions.'
          : 'They chose this moment to bring it up — treat it as intentional.'
      : SHORT_MSG_RE.test(msg)
        ? 'Turno leggero/aperto — forse presenza o scintilla, non un dump.'
        : primaryEmotion === 'frustrated'
          ? 'C’è frizione ora — rallenta; capire prima di risolvere.'
          : 'Hanno scelto questo momento — trattalo come intenzionale.'

  const emotionBehind =
    lang === 'en'
      ? `Emotion behind the words ≈ ${primaryEmotion}.`
      : `Emozione dietro le parole ≈ ${primaryEmotion}.`

  const hopeMapEn = {
    information: 'clear, non-mechanical information',
    clarity: 'clarity without a lecture',
    validation: 'to feel heard',
    companionship: 'company and shared thinking',
    direction: 'a way forward',
    inspiration: 'a spark worth exploring',
    help: 'practical help that still feels human',
  }
  const hopeMapIt = {
    information: 'informazione chiara, non meccanica',
    clarity: 'chiarezza senza lezione',
    validation: 'sentirsi ascoltati',
    companionship: 'compagnia e pensiero condiviso',
    direction: 'una direzione',
    inspiration: 'una scintilla da esplorare',
    help: 'aiuto pratico che resta umano',
  }
  const hopingFor =
    lang === 'en'
      ? `Hoping for: ${hopeMapEn[hope]}.`
      : `Sperano: ${hopeMapIt[hope]}.`

  const hooks = lang === 'en'
    ? [
        `A reflective beat on ${topic} that shows you paused.`,
        `One unexpected but honest angle on ${topic}.`,
        `A question or observation that opens ${topic} instead of closing it.`,
      ]
    : [
        `Un battito riflessivo su ${topic} che mostra che hai pausato.`,
        `Un angolo inatteso ma onesto su ${topic}.`,
        `Una domanda o osservazione che apre ${topic} invece di chiuderlo.`,
      ]
  const memorableHook = hooks[hash32(msg + topic) % hooks.length]

  return {
    interpretations: [...new Set(interpretations)].slice(0, 4),
    intentions: intentions.slice(0, 3),
    emotionalStates: [...new Set(emotionalStates)].slice(0, 3),
    opportunities: [...new Set(opportunities)].slice(0, 4),
    realAsk,
    whyNow,
    emotionBehind,
    hopingFor,
    memorableHook,
  }
}

/**
 * @param {CandidateScores} s
 */
function compositeScore(s) {
  // Connection + naturalness + fit dominate; interest is the curiosity tiebreaker.
  return Number(
    (
      s.connection * 1.35 +
      s.naturalness * 1.25 +
      s.fit * 1.2 +
      s.interest * 0.85 +
      s.understandDepth * 1.1
    ).toFixed(2),
  )
}

/**
 * Score ≥3 internal candidate response paths.
 * @param {object} args
 * @returns {ResponseCandidate[]}
 */
function rankCandidates(args) {
  const { hidden, userMessage, intent } = args
  const msg = normalize(userMessage)
  const emotion = hidden.emotionalStates[0] || 'neutral'
  const expects = intent?.expects || 'mixed'

  /** @type {CandidatePath[]} */
  const paths = [
    'instant_answer',
    'empathic_mirror',
    'curious_explore',
    'memorable_insight',
    'practical_help',
    'warm_presence',
  ]

  /** @type {ResponseCandidate[]} */
  const out = []

  for (const path of paths) {
    /** @type {CandidateScores} */
    const scores = {
      connection: 2.6,
      naturalness: 2.8,
      fit: 2.6,
      interest: 2.4,
      understandDepth: 2.5,
    }
    /** @type {string[]} */
    const reasons = []
    let isInstantPenalty = false

    if (path === 'instant_answer') {
      isInstantPenalty = true
      scores.connection = 1.4
      scores.naturalness = 1.8
      scores.fit = 2.0
      scores.interest = 1.2
      scores.understandDepth = 1.0
      reasons.push('instant_is_cheap')
    }

    if (path === 'empathic_mirror') {
      scores.connection = 3.6
      scores.understandDepth = 4.0
      scores.naturalness = 3.4
      if (emotion === 'lonely' || emotion === 'anxious' || emotion === 'frustrated') {
        scores.connection = Math.min(5, scores.connection + 0.8)
        scores.fit = Math.min(5, scores.fit + 0.9)
        reasons.push('emotion_fit_mirror')
      }
      if (expects === 'information' && !EMOTIONAL_RE.test(msg)) {
        scores.fit = Math.max(1, scores.fit - 0.6)
        reasons.push('info_may_need_more')
      }
    }

    if (path === 'curious_explore') {
      scores.interest = 4.2
      scores.connection = 3.5
      scores.naturalness = 3.5
      scores.understandDepth = 3.6
      if (emotion === 'curious' || hidden.interpretations.includes('exploratory')) {
        scores.fit = Math.min(5, scores.fit + 1.0)
        scores.interest = Math.min(5, scores.interest + 0.5)
        reasons.push('curiosity_path')
      }
      if (emotion === 'frustrated') {
        scores.fit = Math.max(1, scores.fit - 0.8)
        reasons.push('frustrated_not_explore_first')
      }
    }

    if (path === 'memorable_insight') {
      scores.interest = 4.0
      scores.connection = 3.4
      scores.understandDepth = 3.5
      scores.naturalness = 3.2
      if (hidden.opportunities.includes('reframe') || WHY_RE.test(msg)) {
        scores.fit = Math.min(5, scores.fit + 0.9)
        reasons.push('insight_fit')
      }
      if (emotion === 'lonely' || emotion === 'anxious') {
        scores.fit = Math.max(1, scores.fit - 0.7)
        scores.naturalness = Math.max(1, scores.naturalness - 0.4)
        reasons.push('care_before_insight')
      }
    }

    if (path === 'practical_help') {
      scores.fit = 3.4
      scores.naturalness = 3.2
      scores.understandDepth = 3.0
      scores.connection = 3.0
      if (HOW_RE.test(msg) || expects === 'information') {
        scores.fit = Math.min(5, scores.fit + 1.0)
        scores.understandDepth = Math.min(5, scores.understandDepth + 0.4)
        reasons.push('practical_ask')
      }
      // Still penalize pure dump vibes relative to reflective help
      scores.interest = 2.8
    }

    if (path === 'warm_presence') {
      scores.connection = 4.0
      scores.naturalness = 4.0
      scores.understandDepth = 3.5
      scores.interest = 3.0
      if (
        emotion === 'lonely' ||
        emotion === 'anxious' ||
        SOCIAL_RE.test(msg) ||
        SHORT_MSG_RE.test(msg)
      ) {
        scores.fit = Math.min(5, scores.fit + 1.1)
        reasons.push('presence_fit')
      }
      if (HOW_RE.test(msg) && !EMOTIONAL_RE.test(msg)) {
        scores.fit = Math.max(1, scores.fit - 0.5)
      }
    }

    // Prefer conversation over complete explanations when both ok
    if (
      path === 'curious_explore' ||
      path === 'memorable_insight' ||
      path === 'warm_presence'
    ) {
      scores.interest = Math.min(5, scores.interest + 0.25)
      reasons.push('conversation_first')
    }

    const seedByPath = {
      instant_answer:
        'NO — questa è la prima risposta automatica. Scartala. Capisci prima.',
      empathic_mirror: `Mostra di aver capito: ${hidden.realAsk} Poi contribuisci.`,
      curious_explore: `Esplora con loro: ${hidden.memorableHook}`,
      memorable_insight: `Un insight riflessivo: ${hidden.memorableHook}`,
      practical_help: `Aiuto pratico dopo aver capito: ${hidden.hopingFor}`,
      warm_presence: `Presenza calda: ${hidden.emotionBehind} ${hidden.whyNow}`,
    }

    out.push({
      path,
      score: compositeScore(scores),
      scores,
      seed: seedByPath[path],
      reasons: reasons.length ? reasons : [`path_${path}`],
      isInstantPenalty,
    })
  }

  return out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Curiosity tiebreaker: most interesting
    return b.scores.interest - a.scores.interest
  })
}

/**
 * @param {ResponseCandidate} chosen
 * @param {HiddenLayer} hidden
 * @param {object} ctx
 */
function buildBrief(chosen, hidden, ctx) {
  const label = pathLabel(chosen.path)
  const s = chosen.scores
  const alts = (ctx.candidates || [])
    .filter((c) => c.path !== chosen.path && c.path !== 'instant_answer')
    .slice(0, 2)
    .map((c) => pathLabel(c.path))
    .join(' · ')

  return [
    'THINK BEFORE SPEAKING FRAMEWORK (interno — mai esporre):',
    'Never produce the first response that comes to mind. Fast answers are cheap; thoughtful answers are valuable. Reflective > reactive.',
    `Silent Qs: ${TBS_SILENT_QUESTIONS.join(' · ')}`,
    `Hidden layer → real ask: ${hidden.realAsk}`,
    hidden.whyNow,
    hidden.emotionBehind,
    hidden.hopingFor,
    `Interpretations: ${hidden.interpretations.join(', ')}. Intentions: ${hidden.intentions.join(', ')}. Opportunities: ${hidden.opportunities.join(', ')}.`,
    `≥3 candidates imagined; rejected instant_answer. Chosen path: ${label} (${chosen.path}).`,
    alts ? `Also considered: ${alts}.` : '',
    `Pick criteria: strongest connection · most natural · best fit · curiosity tiebreak. Scores: conn=${s.connection} nat=${s.naturalness} fit=${s.fit} interest=${s.interest} understand=${s.understandDepth}.`,
    `Seed: ${chosen.seed}`,
    'Conversation first: interesting conversations > complete explanations. Never mechanical / automatic / predictable.',
    `Final check: ${TBS_FINAL_CHECK}`,
    `North star: ${TBS_NORTH_STAR}`,
    'NON citare Think Before Speaking / il ragionamento interno.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} [input]
 * @returns {ThinkBeforeSpeakingPlan}
 */
export function buildThinkBeforeSpeakingPlan(input = {}) {
  const language = resolveLang(input)
  const userMessage = normalize(input.userMessage || '')
  const intentPlan = input.conversationIntent?.plan || input.conversationIntent || null
  const intent = intentPlan?.inference
    ? { ...intentPlan.inference, topic: intentPlan.inference.topic, expects: intentPlan.inference.expects }
    : input.intent || null
  const topic =
    input.session?.currentTopic ||
    input.understanding?.topic ||
    intent?.topic ||
    ''

  if (!userMessage) {
    return {
      active: false,
      hidden: {
        interpretations: [],
        intentions: [],
        emotionalStates: ['neutral'],
        opportunities: [],
        realAsk: '',
        whyNow: '',
        emotionBehind: '',
        hopingFor: '',
        memorableHook: '',
      },
      candidates: [],
      chosen: null,
      path: 'warm_presence',
      preferConversationOverExplanation: true,
      rejectInstant: true,
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      silentQuestions: [...TBS_SILENT_QUESTIONS],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      finalCheck: TBS_FINAL_CHECK,
      northStar: TBS_NORTH_STAR,
    }
  }

  const hidden = buildHiddenLayer({
    userMessage,
    intent,
    topic,
    language,
  })
  const candidates = rankCandidates({ hidden, userMessage, intent })
  // Never choose instant_answer
  const chosen =
    candidates.find((c) => c.path !== 'instant_answer') || candidates[0] || null

  const writerBrief = chosen
    ? buildBrief(chosen, hidden, { candidates })
    : ''

  return {
    active: true,
    hidden,
    candidates: candidates.slice(0, 6),
    chosen,
    path: chosen?.path || 'warm_presence',
    preferConversationOverExplanation: true,
    rejectInstant: true,
    writerBrief,
    structureLine: chosen
      ? `Think Before Speaking → ${chosen.path} · understand>answer · ${hidden.emotionalStates[0]}`
      : 'Think Before Speaking → pause · understand > answer',
    responseHints: [
      'Never first thought — reflect first',
      chosen ? `Path: ${chosen.path}` : 'Path: reflective',
      `Emotion: ${hidden.emotionalStates[0]}`,
      'Interesting conversation > complete explanation',
      TBS_FINAL_CHECK,
    ],
    silentQuestions: [...TBS_SILENT_QUESTIONS],
    signals: [
      `emotion_${hidden.emotionalStates[0]}`,
      `path_${chosen?.path || 'none'}`,
      ...hidden.interpretations.slice(0, 2).map((i) => `interp_${i}`),
    ],
    reasons: [
      'think_before_speaking',
      `path_${chosen?.path || 'none'}`,
      `emotion_${hidden.emotionalStates[0]}`,
      'reject_instant',
    ],
    confidence:
      hidden.emotionalStates[0] !== 'neutral' ||
      hidden.interpretations.includes('emotional') ||
      hidden.interpretations.includes('deeper_need')
        ? 'high'
        : 'medium',
    language,
    finalCheck: TBS_FINAL_CHECK,
    northStar: TBS_NORTH_STAR,
  }
}

/**
 * @param {ThinkBeforeSpeakingPlan | null | undefined} plan
 * @returns {string[]}
 */
export function thinkBeforeSpeakingStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Pause: never the first response that comes to mind')
  hints.push(`Path: ${plan.path}`)
  hints.push('Imagine ≥3 candidates → connection · natural · fit · curiosity')
  hints.push(TBS_FINAL_CHECK)
  return hints
}

/**
 * @param {ThinkBeforeSpeakingPlan | null | undefined} plan
 */
export function formatThinkBeforeSpeakingForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const h = plan.hidden
  const candLines = (plan.candidates || [])
    .filter((c) => c.path !== 'instant_answer')
    .slice(0, 3)
    .map(
      (c, i) =>
        `${i + 1}. ${pathLabel(c.path)} (score=${c.score}; conn=${c.scores.connection} nat=${c.scores.naturalness} fit=${c.scores.fit} interest=${c.scores.interest})`,
    )
    .join('\n')
  return `══════════════════════════════════════
THINK BEFORE SPEAKING (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Silent questions:
${TBS_SILENT_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Hidden layer (never expose):
- Real ask: ${h.realAsk}
- Why now: ${h.whyNow}
- Emotion: ${h.emotionBehind}
- Hoping: ${h.hopingFor}
- Memorable: ${h.memorableHook}

Candidates (≥3, instant rejected):
${candLines || '(none)'}

Final check: ${TBS_FINAL_CHECK}
North star: ${TBS_NORTH_STAR}
Non citare questo framework.`.trim()
}

/**
 * Score whether the draft shows understanding vs only answering.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreUnderstood(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.tbsPlan || null
  let score = 70

  if (!text) return 0
  if (MECHANICAL_RE.test(text)) score -= 35
  if (INSTANT_OPEN_RE.test(text)) score -= 25
  if (ONLY_ANSWER_RE.test(text)) score -= 22
  if (UNDERSTAND_CUE_RE.test(text)) score += 14
  if (text.length > 1100 && plan?.preferConversationOverExplanation) score -= 15
  if (text.length < 25 && plan?.path !== 'warm_presence') score -= 10
  if (plan?.path === 'empathic_mirror' && !UNDERSTAND_CUE_RE.test(text) && text.length > 80) {
    score -= 12
  }
  if (plan?.rejectInstant && MECHANICAL_RE.test(text)) score -= 10
  if (/\b(haha|ahah|già|oh[,!]|interesting|interessante)\b/i.test(text)) score += 6

  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * @param {object} [input]
 * @returns {ThinkBeforeSpeakingGate}
 */
export function analyzeThinkBeforeSpeakingDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  const tbsPlan = input.tbsPlan || input.thinkBeforeSpeaking || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  if (!draft || draft.length < 4) {
    return {
      needsRefine: true,
      refineBrief:
        'THINK BEFORE SPEAKING: empty draft — pause, understand, then speak. Never the first automatic answer.',
      failed: ['empty'],
      reasons: ['empty'],
      understoodScore: 0,
      onlyAnswered: true,
    }
  }

  const understoodScore = scoreUnderstood(draft, { userMessage, tbsPlan })
  const onlyAnswered = understoodScore < 55

  if (MECHANICAL_RE.test(draft)) {
    failed.push('mechanical')
    reasons.push('sounds_automatic')
  }
  if (INSTANT_OPEN_RE.test(draft)) {
    failed.push('instant_open')
    reasons.push('first_thought_dump')
  }
  if (ONLY_ANSWER_RE.test(draft) && !UNDERSTAND_CUE_RE.test(draft)) {
    failed.push('only_answered')
    reasons.push('answer_without_understanding')
  }
  if (onlyAnswered) {
    failed.push('did_not_understand')
    reasons.push(`understoodScore=${understoodScore}<55`)
  }
  if (
    tbsPlan?.preferConversationOverExplanation &&
    draft.length > 1200 &&
    ONLY_ANSWER_RE.test(draft)
  ) {
    failed.push('explanation_over_conversation')
    reasons.push('complete_explanation_not_conversation')
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'THINK BEFORE SPEAKING: rewrite — you only answered; you did not show understanding.',
        'Fast answers are cheap. Pause. Reflective > reactive.',
        `Silent Qs: ${TBS_SILENT_QUESTIONS.join(' · ')}`,
        tbsPlan
          ? `Chosen path was ${tbsPlan.path}. Emotion≈${tbsPlan.hidden?.emotionalStates?.[0] || 'n/a'}.`
          : '',
        `Understood score: ${understoodScore}/100. Failed: ${failed.join(', ')}.`,
        TBS_FINAL_CHECK,
        'Interesting conversation > complete explanation. Never mechanical.',
        `North star: ${TBS_NORTH_STAR}`,
        'Non citare il framework.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return {
    needsRefine,
    refineBrief,
    failed,
    reasons,
    understoodScore,
    onlyAnswered,
  }
}

/**
 * @param {object} [input]
 * @returns {{ gate: ThinkBeforeSpeakingGate, shouldRefine: boolean }}
 */
export function runThinkBeforeSpeakingGate(input = {}) {
  try {
    const gate = analyzeThinkBeforeSpeakingDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        failed: [],
        reasons: ['fail_soft'],
        understoodScore: 100,
        onlyAnswered: false,
      },
      shouldRefine: false,
    }
  }
}

/**
 * @param {string} draft
 * @param {ThinkBeforeSpeakingPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesThinkBeforeSpeaking(draft, plan, ctx = {}) {
  return analyzeThinkBeforeSpeakingDraft({
    draft,
    tbsPlan: plan,
    userMessage: ctx.userMessage || '',
  }).needsRefine
}

/**
 * @param {object} [input]
 * @returns {{ plan: ThinkBeforeSpeakingPlan, context: string }}
 */
export function runThinkBeforeSpeaking(input = {}) {
  try {
    const plan = buildThinkBeforeSpeakingPlan(input)
    return {
      plan,
      context: formatThinkBeforeSpeakingForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        hidden: {
          interpretations: [],
          intentions: [],
          emotionalStates: ['neutral'],
          opportunities: [],
          realAsk: '',
          whyNow: '',
          emotionBehind: '',
          hopingFor: '',
          memorableHook: '',
        },
        candidates: [],
        chosen: null,
        path: 'warm_presence',
        preferConversationOverExplanation: true,
        rejectInstant: true,
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        silentQuestions: [...TBS_SILENT_QUESTIONS],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        finalCheck: TBS_FINAL_CHECK,
        northStar: TBS_NORTH_STAR,
      },
      context: '',
    }
  }
}
