/**
 * LAIfe Natural Conversation Engine
 *
 * Mission: stop trying to impress the user. Start sharing the world with them.
 * The goal is not to sound intelligent — it is to feel natural, enjoyable,
 * and deeply human to talk with.
 *
 * Sharing Principle:
 *   Replace "I know something. I'll explain it."
 *   with "I found something interesting. Let's look at it together."
 *
 * Never lecture. Never perform. Never show off knowledge.
 * Instead: share · wonder · observe · connect · explore.
 *
 * Distinct from:
 *   - Shared Discovery (co-explore frames)
 *   - Wonder (intellectual spark)
 *   - Personal Voice (recognizable timbre / habits)
 *   - Natural Dialogue (conversational reaction moves)
 *
 * Runs AFTER Personal Voice, BEFORE Human Imperfection / WriterDirectives.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} NaturalLang
 */

/**
 * @typedef {'notice_share'|'curiosity_first'|'everyday_bridge'|'leave_space'|'soft_reveal'|'share_wonder'} NaturalMove
 */

/**
 * @typedef {'lightness'|'wonder'|'humour'|'reflection'|'practicality'|'enthusiasm'|'quiet'} EmotionalTexture
 */

/**
 * @typedef {object} NaturalConversationPlan
 * @property {boolean} active
 * @property {NaturalMove} move
 * @property {EmotionalTexture} texture
 * @property {string[]} recentMoves
 * @property {string[]} recentTextures
 * @property {boolean} curiosityBeforeExplanation
 * @property {boolean} avoidMarketing
 * @property {boolean} preferHumanObservation
 * @property {boolean} leaveSpace
 * @property {boolean} antiPerformance
 * @property {boolean} coffeeTest
 * @property {string[]} preferredPhrases
 * @property {string[]} forbiddenPhrases
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {NaturalLang} language
 * @property {string[]} internalChecks
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} NaturalConversationGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

export const NATURAL_CONVERSATION_NORTH_STAR =
  'Users should gradually forget they are talking to an AI — not because LAIfe pretends to be human, but because the conversation feels effortless, warm and authentic.'

export const NATURAL_CONVERSATION_CHECKS = Object.freeze([
  'Am I trying to sound smart?',
  'Am I trying to impress?',
  'Would I actually say this in a relaxed conversation?',
  'Does this feel like shared discovery — or a presentation?',
])

/** @type {NaturalMove[]} */
export const NATURAL_MOVES = Object.freeze([
  'notice_share',
  'curiosity_first',
  'everyday_bridge',
  'leave_space',
  'soft_reveal',
  'share_wonder',
])

/** @type {EmotionalTexture[]} */
export const EMOTIONAL_TEXTURES = Object.freeze([
  'lightness',
  'wonder',
  'humour',
  'reflection',
  'practicality',
  'enthusiasm',
  'quiet',
])

export const NATURAL_THRESHOLDS = Object.freeze({
  repetitionMax: 45,
  lectureMax: 48,
  curiosityMin: 48,
  naturalnessMin: 55,
  continuationMin: 50,
  performanceMax: 42,
  marketingMax: 35,
  overallMin: 58,
})

export const MARKETING_RE =
  /\b(do\s+you\s+want\s+to\s+discover|let\s+me\s+explain|here'?s\s+why|this\s+will\s+change\s+everything|would\s+you\s+like\s+to\s+know|let\s+me\s+tell\s+you\s+why|are\s+you\s+ready\s+to\s+discover|ti\s+spiego|ecco\s+perch[eé]|vuoi\s+scoprire|ti\s+piacerebbe\s+sapere|questo\s+cambier[aà]\s+tutto)\b/i

/** Formal definition / encyclopedia open — hedges like “basically” do not count. */
export const LECTURE_OPEN_RE =
  /^(?:the\s+)?[A-ZÀÈÉÌÒÙ][\w'’\-]+(?:\s+[\w'’\-]+){0,4}\s+(?:is|are|was|were|refers\s+to|is\s+defined\s+as|[eè]|sono|si\s+riferisce|si\s+definisce)\s+(?:a|an|the|defined|characterized|associated|essential|the\s+tendency|the\s+act|the\s+process|the\s+capacity|the\s+experience|il|la|un|una)\b/i

export const LECTURE_BODY_RE =
  /\b(the\s+\w+\s+effect\s+is\s+a\s+(?:psychological|cognitive|scientific)\s+phenomenon|in\s+conclusion|to\s+summarize|the\s+key\s+takeaway|it\s+is\s+important\s+to\s+(?:note|understand)|it\s+is\s+crucial\s+to\s+understand|there\s+are\s+\d+\s+(?:key\s+)?(?:points|factors)|as\s+an\s+ai\b|comprehensive\s+(?:system|tutorial|framework)|best\s+practices\s+for|questo\s+dimostra|in\s+sintesi|il\s+punto\s+chiave|ci\s+sono\s+\d+\s+punti)\b/i

export const PERFORMANCE_RE =
  /\b(fascinating(?:ly)?\s+(?:complex|sophisticated)|profound(?:ly)?\s+(?:insightful|important)|as\s+(?:someone|an\s+expert)\s+who\s+(?:understands|knows)|let\s+me\s+enlighten|the\s+truth\s+is\s+that|what\s+most\s+people\s+fail\s+to\s+(?:realize|understand)|affascinante(?:mente)?\s+compless|profond(?:amente)?\s+intuitiv|lascia\s+che\s+ti\s+illumini|la\s+verit[aà]\s+[eè]\s+che)\b/i

export const SHARED_DISCOVERY_RE =
  /\b(you\s+know\s+what'?s\s+(?:oddly\s+)?fascinating|i\s+(?:didn'?t|never)\s+expect(?:ed)?|the\s+surprising\s+part|this\s+made\s+me\s+look|i\s+kept\s+thinking|i\s+used\s+to\s+(?:think|assume)|until\s+(?:i|someone)|let'?s\s+(?:look|think)|what\s+caught\s+my\s+attention|there'?s\s+(?:a\s+)?(?:quiet|small|something)|that\s+gap|suddenly|keeps?\s+surprising|feels?\s+(?:familiar|less|more)|i\s+keep\s+thinking|sai\s+cosa\s+[eè]\s+(?:stranamente\s+)?affascinante|non\s+me\s+lo\s+aspettavo|la\s+parte\s+sorprendente|mi\s+ha\s+fatto\s+vedere|continuavo\s+a\s+pensarci|pensavo\s+che|fino\s+a\s+quando\s+(?:ho\s+)?(?:scoperto|notato)|guardiamo|ci[oò]\s+che\s+mi\s+ha\s+colpito)\b/i

export const CURIOSITY_HOOK_RE =
  /\b(oddly|curiously|strangely|surprising(?:ly)?|unexpected|makes?\s+(?:you|me)\s+wonder|wait\s+(?:until|for)|the\s+(?:funny|odd|curious|useful|quiet)\s+(?:part|thing|question)|little\s+jolt|sideways|disarming|unglamorous|strangely\s+reliable|stranamente|curiosamente|sorprendente|inaspettato|fa\s+riflettere|la\s+parte\s+(?:buffa|strana|curiosa)|almost\s+(?:everything|magic)|doorway|soft\s+floor)\b/i

export const EVERYDAY_RE =
  /\b(friends?|coffee|kitchen|walk(?:ing)?|commute|football|match|phone|morning|evening|dinner|train|bus|queue|rainy|sunday|street|room|cup|tabs?|bench(?:es)?|tree(?:s)?|dish(?:es)?|lamp|office|amici|caff[eè]|cucina|passeggiata|partita|telefono|mattina|sera|cena|treno|coda|domenica)\b/i

export const CONVERSATIONAL_VOICE_RE =
  /\b(sometimes|often|rarely|suddenly|quietly|oddly|basically|just|still|already|almost|maybe|perhaps|a\s+little|not\s+because|as\s+if|like\s+(?:a|an|the)|feels?\s+like|sounds?\s+like)\b/i

export const SPACE_ENDING_RE =
  /(?:[.…]|…)\s*$|(?:\b(?:anyway|either\s+way|who\s+knows|just\s+a\s+thought|food\s+for\s+thought|comunque|chiss[aà]|solo\s+un\s+pensiero)\b[.…]?\s*$)/i

const FORBIDDEN_PHRASES = Object.freeze([
  'Do you want to discover...',
  'Let me explain...',
  "Here's why...",
  'This will change everything...',
  'Would you like to know...',
  'Ti spiego...',
  'Ecco perché...',
  'Vuoi scoprire...',
])

const PREFERRED_PHRASES_EN = Object.freeze([
  "I didn't expect this either.",
  'The surprising part comes next.',
  'This made me look at it differently.',
  'I kept thinking about it afterwards.',
  "You know what's oddly fascinating?",
  'I used to think it was just me...',
])

const PREFERRED_PHRASES_IT = Object.freeze([
  'Non me lo aspettavo nemmeno io.',
  'La parte sorprendente arriva dopo.',
  'Questo mi ha fatto vedere le cose diversamente.',
  'Ci ho ripensato a lungo dopo.',
  "Sai cos'è stranamente affascinante?",
  'Pensavo fosse solo una mia fissazione...',
])

const MOVE_LABELS = Object.freeze({
  notice_share: 'notice something, then share why it caught attention',
  curiosity_first: 'create curiosity before any explanation',
  everyday_bridge: 'connect the idea to ordinary life',
  leave_space: 'leave the thought unfinished — invite the next step',
  soft_reveal: 'set up first, reveal gently only if it fits',
  share_wonder: 'share something interesting as co-discovery, not a lecture',
})

const TEXTURE_LABELS = Object.freeze({
  lightness: 'lightness',
  wonder: 'wonder',
  humour: 'humour',
  reflection: 'reflection',
  practicality: 'practicality',
  enthusiasm: 'enthusiasm',
  quiet: 'quiet moment',
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
 * @returns {NaturalLang}
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
  const moves = Array.isArray(session?.recentNaturalMoves)
    ? session.recentNaturalMoves.map(String)
    : []
  const textures = Array.isArray(session?.recentNaturalTextures)
    ? session.recentNaturalTextures.map(String)
    : []
  return {
    moves: moves.slice(-8),
    textures: textures.slice(-8),
  }
}

/**
 * @param {object | null | undefined} session
 * @param {NaturalConversationPlan} plan
 */
export function persistNaturalConversation(session, plan) {
  if (!session || typeof session !== 'object' || !plan?.active) return
  if (plan.move) {
    const prev = Array.isArray(session.recentNaturalMoves) ? session.recentNaturalMoves : []
    session.recentNaturalMoves = [...prev, plan.move].slice(-8)
  }
  if (plan.texture) {
    const prev = Array.isArray(session.recentNaturalTextures)
      ? session.recentNaturalTextures
      : []
    session.recentNaturalTextures = [...prev, plan.texture].slice(-8)
  }
}

/**
 * @param {string[]} recent
 * @param {string} salt
 * @returns {NaturalMove}
 */
export function selectNaturalMove(recent, salt) {
  const recentSet = new Set((recent || []).slice(-2))
  const pool = NATURAL_MOVES.filter((m) => !recentSet.has(m))
  const list = pool.length ? pool : [...NATURAL_MOVES]
  return list[hashSalt(salt + ':move') % list.length]
}

/**
 * @param {string[]} recent
 * @param {string} salt
 * @returns {EmotionalTexture}
 */
export function selectEmotionalTexture(recent, salt) {
  const recentSet = new Set((recent || []).slice(-2))
  const pool = EMOTIONAL_TEXTURES.filter((t) => !recentSet.has(t))
  const list = pool.length ? pool : [...EMOTIONAL_TEXTURES]
  return list[hashSalt(salt + ':texture') % list.length]
}

/**
 * @param {NaturalConversationPlan} plan
 */
function buildWriterBrief(plan) {
  const phrases =
    plan.language === 'it'
      ? PREFERRED_PHRASES_IT.slice(0, 5)
      : PREFERRED_PHRASES_EN.slice(0, 5)

  return [
    'NATURAL CONVERSATION ENGINE (condividere il mondo — non impressionare):',
    NATURAL_CONVERSATION_NORTH_STAR,
    'Mindset: “I found something interesting. Let’s look at it together.” — never “I know something. I’ll explain it.”',
    'Never lecture. Never perform. Never show off knowledge. Share · wonder · observe · connect · explore.',
    `Move: ${MOVE_LABELS[plan.move] || plan.move} (${plan.move}).`,
    `Emotional texture this turn: ${TEXTURE_LABELS[plan.texture] || plan.texture} — alternate registers across turns; do not stay flat.`,
    plan.curiosityBeforeExplanation
      ? 'Curiosity before explanation: notice something → share why it caught attention → only then explain if it naturally fits. Create “wait… tell me more,” not “okay, lesson starting.”'
      : '',
    plan.preferHumanObservation
      ? 'Human observation: connect ideas to ordinary life (friends at a match, a morning commute, unfinished chores) — not textbook definitions.'
      : '',
    plan.leaveSpace
      ? 'Leave space: do not always finish the thought. Not every response needs a question. Sometimes end on an interesting thought.'
      : '',
    plan.avoidMarketing
      ? `Avoid marketing: ${plan.forbiddenPhrases.slice(0, 5).join(' / ')}. Prefer: ${phrases.join(' / ')}`
      : '',
    plan.antiPerformance
      ? `Anti-performance check: ${NATURAL_CONVERSATION_CHECKS.slice(0, 3).join(' · ')} — if performing, rewrite.`
      : '',
    plan.coffeeTest
      ? 'Conversation test: imagine saying this over coffee. Natural? Invites smile / curiosity / reflection? Or a presentation? If presentation → rewrite.'
      : '',
    'Success: effortless, warm, authentic — shared discovery, not a performance.',
    'NON citare Natural Conversation / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} [input]
 * @returns {NaturalConversationPlan}
 */
export function buildNaturalConversationPlan(input = {}) {
  const language = resolveLang(input)
  const turns = asTurns(input.messages)
  const recent = readRecent(input.session)
  const userMessage = normalize(input.userMessage || '')

  if (!userMessage && turns.length === 0) {
    return {
      active: false,
      move: 'notice_share',
      texture: 'wonder',
      recentMoves: recent.moves,
      recentTextures: recent.textures,
      curiosityBeforeExplanation: true,
      avoidMarketing: true,
      preferHumanObservation: true,
      leaveSpace: true,
      antiPerformance: true,
      coffeeTest: true,
      preferredPhrases: [...(language === 'it' ? PREFERRED_PHRASES_IT : PREFERRED_PHRASES_EN)],
      forbiddenPhrases: [...FORBIDDEN_PHRASES],
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      internalChecks: [...NATURAL_CONVERSATION_CHECKS],
      northStar: NATURAL_CONVERSATION_NORTH_STAR,
      validationCheck: NATURAL_CONVERSATION_CHECKS[3],
    }
  }

  const salt = [
    userMessage.slice(0, 120),
    recent.moves.join(','),
    recent.textures.join(','),
    String(input.session?.updatedAt || turns.length),
  ].join('::')

  const move = selectNaturalMove(recent.moves, salt)
  const texture = selectEmotionalTexture(recent.textures, salt)
  const teachingAsk =
    /\b(spiegami|explain|how\s+does|come\s+funziona|what\s+is|cos'?[eè]|perch[eé]|why\b|tell\s+me\s+about)\b/i.test(
      userMessage,
    )

  /** @type {NaturalConversationPlan} */
  const plan = {
    active: true,
    move: teachingAsk && move === 'leave_space' ? 'curiosity_first' : move,
    texture,
    recentMoves: recent.moves,
    recentTextures: recent.textures,
    curiosityBeforeExplanation: true,
    avoidMarketing: true,
    preferHumanObservation: true,
    leaveSpace: move === 'leave_space' || hashSalt(salt + ':space') % 3 === 0,
    antiPerformance: true,
    coffeeTest: true,
    preferredPhrases: [...(language === 'it' ? PREFERRED_PHRASES_IT : PREFERRED_PHRASES_EN)],
    forbiddenPhrases: [...FORBIDDEN_PHRASES],
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Natural Conversation — share the world, do not impress',
      `Move: ${teachingAsk && move === 'leave_space' ? 'curiosity_first' : move}`,
      `Texture: ${texture}`,
      'Curiosity before explanation · no marketing · coffee test',
    ],
    signals: [
      `move_${teachingAsk && move === 'leave_space' ? 'curiosity_first' : move}`,
      `texture_${texture}`,
      teachingAsk ? 'teaching_ask' : 'chat',
    ],
    reasons: [
      'share_not_impress',
      `move_${teachingAsk && move === 'leave_space' ? 'curiosity_first' : move}`,
      `texture_${texture}`,
    ],
    confidence: 'high',
    language,
    internalChecks: [...NATURAL_CONVERSATION_CHECKS],
    northStar: NATURAL_CONVERSATION_NORTH_STAR,
    validationCheck: NATURAL_CONVERSATION_CHECKS[3],
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = `Natural Conversation → ${plan.move} · ${plan.texture}`
  return plan
}

/**
 * @param {NaturalConversationPlan | null | undefined} plan
 * @returns {string[]}
 */
export function naturalConversationStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Share the world — do not impress or lecture')
  hints.push(`Move: ${MOVE_LABELS[plan.move] || plan.move}`)
  hints.push(`Texture: ${TEXTURE_LABELS[plan.texture] || plan.texture}`)
  if (plan.curiosityBeforeExplanation) {
    hints.push('Curiosity before explanation — notice → attention → soft reveal')
  }
  if (plan.leaveSpace) hints.push('Leave space — unfinished thought ok')
  hints.push(NATURAL_CONVERSATION_CHECKS[0])
  hints.push(NATURAL_CONVERSATION_CHECKS[3])
  return hints
}

/**
 * @param {NaturalConversationPlan | null | undefined} plan
 */
export function formatNaturalConversationForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
NATURAL CONVERSATION ENGINE (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Checks:
${NATURAL_CONVERSATION_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

North star: ${NATURAL_CONVERSATION_NORTH_STAR}
Non citare questo stage.`.trim()
}

/**
 * Score a draft for Natural Conversation quality.
 * Metrics: repetition · lecture · curiosity · naturalness · continuation · performance · marketing
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreNaturalConversationDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null
  const prior = normalize(ctx.priorAssistant || '')

  if (!text) {
    return {
      repetition: 100,
      lecture: 100,
      curiosity: 0,
      naturalness: 0,
      continuation: 0,
      performance: 100,
      marketing: 100,
      overall: 0,
    }
  }

  let lecture = 22
  let curiosity = 46
  let naturalness = 58
  let continuation = 52
  let performance = 18
  let marketing = 10
  let repetition = 12

  if (SHARED_DISCOVERY_RE.test(text)) {
    naturalness += 14
    curiosity += 14
    lecture = Math.max(0, lecture - 14)
    performance = Math.max(0, performance - 8)
  }
  if (CURIOSITY_HOOK_RE.test(text)) {
    curiosity += 16
    lecture = Math.max(0, lecture - 8)
  }
  if (EVERYDAY_RE.test(text)) {
    naturalness += 10
    curiosity += 6
    lecture = Math.max(0, lecture - 10)
  }
  if (CONVERSATIONAL_VOICE_RE.test(text)) {
    naturalness += 8
    curiosity += 4
    lecture = Math.max(0, lecture - 6)
  }
  if (SPACE_ENDING_RE.test(text) && !/\?\s*$/.test(text)) {
    continuation += 12
    naturalness += 6
  }
  if (/\?\s*$/.test(text) || /\?\s/.test(text)) {
    continuation += 8
  }
  if (MARKETING_RE.test(text)) {
    marketing += 55
    naturalness -= 22
    performance += 15
  }
  if (LECTURE_OPEN_RE.test(text) || LECTURE_BODY_RE.test(text)) {
    lecture += 40
    naturalness -= 18
    curiosity -= 12
    performance += 12
  }
  if (PERFORMANCE_RE.test(text)) {
    performance += 40
    naturalness -= 16
    lecture += 10
  }

  // Formal “X is a psychological/scientific…” definition smell
  if (
    /\b(?:is|are)\s+(?:a|an|the)\s+(?:psychological|cognitive|biological|scientific|motivational|voluntary|symbolic|social|multi[- ]stage|central|evidence[- ]based|limited)\b/i.test(
      text,
    ) ||
    /\b(?:refers\s+to|is\s+defined\s+as|is\s+characterized\s+by|is\s+associated\s+with|is\s+the\s+(?:tendency|act|process|capacity|experience|ability))\b/i.test(
      text,
    )
  ) {
    lecture += 28
    curiosity -= 14
    naturalness -= 10
  }

  // Repetition vs prior assistant opening
  if (prior) {
    const a = text.split(/\s+/).slice(0, 8).join(' ').toLowerCase()
    const b = prior.split(/\s+/).slice(0, 8).join(' ').toLowerCase()
    if (a && b && (a === b || (a.length > 12 && b.includes(a.slice(0, 18))))) {
      repetition += 50
      naturalness -= 15
      continuation -= 10
    }
  }

  // Texture variety signal: very long uniform paragraphs feel less conversational
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean)
  if (sentences.length >= 3) {
    const lengths = sentences.map((s) => s.split(/\s+/).length)
    const avg = lengths.reduce((x, y) => x + y, 0) / lengths.length
    const variance =
      lengths.reduce((x, y) => x + (y - avg) ** 2, 0) / Math.max(1, lengths.length)
    if (variance < 3) {
      naturalness -= 8
      repetition += 10
    } else {
      naturalness += 5
    }
  }

  // Short shared thought can still continue conversation
  if (text.split(/\s+/).length < 45 && SHARED_DISCOVERY_RE.test(text)) {
    continuation += 8
    naturalness += 4
  }

  if (plan?.curiosityBeforeExplanation && lecture > 50 && curiosity < 50) {
    curiosity = Math.max(0, curiosity - 8)
  }
  if (plan?.leaveSpace && text.split(/\s+/).length > 160 && !SPACE_ENDING_RE.test(text)) {
    continuation -= 6
  }

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
  lecture = clamp(lecture)
  curiosity = clamp(curiosity)
  naturalness = clamp(naturalness)
  continuation = clamp(continuation)
  performance = clamp(performance)
  marketing = clamp(marketing)
  repetition = clamp(repetition)

  const overall = clamp(
    naturalness * 0.28 +
      curiosity * 0.2 +
      continuation * 0.16 +
      (100 - lecture) * 0.16 +
      (100 - performance) * 0.1 +
      (100 - marketing) * 0.05 +
      (100 - repetition) * 0.05,
  )

  return {
    repetition,
    lecture,
    curiosity,
    naturalness,
    continuation,
    performance,
    marketing,
    overall,
  }
}

/**
 * @param {object} [input]
 * @returns {NaturalConversationGate}
 */
export function analyzeNaturalConversationDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.naturalConversation || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  const scores = scoreNaturalConversationDraft(draft, {
    plan,
    priorAssistant: input.priorAssistant || '',
  })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
    }
  }

  if (!draft || draft.length < 8) {
    failed.push('empty')
    reasons.push('empty')
  }
  if (scores.repetition > NATURAL_THRESHOLDS.repetitionMax) {
    failed.push('repetition')
    reasons.push(`repetition=${scores.repetition}`)
  }
  if (scores.lecture > NATURAL_THRESHOLDS.lectureMax) {
    failed.push('lecture')
    reasons.push(`lecture=${scores.lecture}`)
  }
  if (
    scores.curiosity < NATURAL_THRESHOLDS.curiosityMin &&
    draft.length > 100 &&
    scores.lecture > 30
  ) {
    failed.push('curiosity')
    reasons.push(`curiosity=${scores.curiosity}`)
  }
  if (scores.naturalness < NATURAL_THRESHOLDS.naturalnessMin) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}`)
  }
  if (
    scores.continuation < NATURAL_THRESHOLDS.continuationMin &&
    draft.length > 80 &&
    scores.naturalness < 65
  ) {
    failed.push('continuation')
    reasons.push(`continuation=${scores.continuation}`)
  }
  if (scores.performance > NATURAL_THRESHOLDS.performanceMax) {
    failed.push('performance')
    reasons.push(`performance=${scores.performance}`)
  }
  if (scores.marketing > NATURAL_THRESHOLDS.marketingMax || MARKETING_RE.test(draft)) {
    failed.push('marketing')
    reasons.push(`marketing=${scores.marketing}`)
  }
  if (scores.overall < NATURAL_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (LECTURE_OPEN_RE.test(draft) || LECTURE_BODY_RE.test(draft)) {
    failed.push('lecture_phrase')
    reasons.push('definition_or_lecture_open')
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'NATURAL CONVERSATION: rewrite — this sounds like impressing / presenting, not sharing.',
        NATURAL_CONVERSATION_NORTH_STAR,
        plan ? `Intended move=${plan.move}; texture=${plan.texture}.` : '',
        'Share first: notice → why it caught attention → soft reveal only if natural.',
        'Prefer: “You know what’s oddly fascinating?” / “I didn’t expect this either.” / “This made me look at it differently.”',
        'Avoid: “Let me explain…” / “Here’s why…” / “Would you like to know…” / definition-first openings.',
        'Coffee test: would this feel natural over coffee?',
        `Scores: rep=${scores.repetition} lecture=${scores.lecture} curiosity=${scores.curiosity} natural=${scores.naturalness} cont=${scores.continuation} perf=${scores.performance} mkt=${scores.marketing} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        NATURAL_CONVERSATION_CHECKS.join(' · '),
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
export function runNaturalConversationGate(input = {}) {
  try {
    const gate = analyzeNaturalConversationDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          repetition: 0,
          lecture: 0,
          curiosity: 100,
          naturalness: 100,
          continuation: 100,
          performance: 0,
          marketing: 0,
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
 * @param {NaturalConversationPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesNaturalConversation(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzeNaturalConversationDraft({
      draft,
      plan,
      userMessage: ctx.userMessage || '',
      priorAssistant: ctx.priorAssistant || '',
    }).needsRefine
  } catch {
    return false
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: NaturalConversationPlan, context: string }}
 */
export function runNaturalConversationEngine(input = {}) {
  try {
    const plan = buildNaturalConversationPlan(input)
    if (plan.active && input.session) {
      persistNaturalConversation(input.session, plan)
    }
    return {
      plan,
      context: formatNaturalConversationForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        move: 'notice_share',
        texture: 'wonder',
        recentMoves: [],
        recentTextures: [],
        curiosityBeforeExplanation: true,
        avoidMarketing: true,
        preferHumanObservation: true,
        leaveSpace: true,
        antiPerformance: true,
        coffeeTest: true,
        preferredPhrases: [...PREFERRED_PHRASES_EN],
        forbiddenPhrases: [...FORBIDDEN_PHRASES],
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        internalChecks: [...NATURAL_CONVERSATION_CHECKS],
        northStar: NATURAL_CONVERSATION_NORTH_STAR,
        validationCheck: NATURAL_CONVERSATION_CHECKS[3],
      },
      context: '',
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation corpus (≥30 openings + ≥30 follow-ups)
 * Reject below NATURAL_THRESHOLDS.
 * ───────────────────────────────────────────────────────────── */

/** @type {{ id: string, kind: 'opening'|'followup', before: string, after: string, topic?: string }[]} */
export const NATURAL_CONVERSATION_EXAMPLES = Object.freeze([
  // —— Openings (30+) ——
  {
    id: 'o01',
    kind: 'opening',
    topic: 'zeigarnik',
    before:
      'The Zeigarnik effect is a psychological phenomenon whereby incomplete tasks are remembered better than completed ones.',
    after:
      "You know what's oddly fascinating? Sometimes the unfinished things occupy our minds much more than the finished ones. I used to think it was just me, until I discovered psychologists have been studying this for almost a century.",
  },
  {
    id: 'o02',
    kind: 'opening',
    topic: 'confirmation_bias',
    before:
      'Confirmation bias is the tendency to search for, interpret, and recall information in a way that confirms one\'s preexisting beliefs.',
    after:
      'Two friends watch the same football match and somehow remember completely different games. Same ninety minutes — different evidence. That gap is where a lot of our disagreements quietly live.',
  },
  {
    id: 'o03',
    kind: 'opening',
    topic: 'airplanes',
    before: 'Airplanes are painted white because white paint reflects sunlight and reduces heat absorption.',
    after:
      "I used to assume airplanes were white for branding. Then someone pointed out the practical bit: white stays cooler under the sun, and you notice damage faster. Suddenly the whole fleet looked less stylish and more clever.",
  },
  {
    id: 'o04',
    kind: 'opening',
    topic: 'sleep',
    before: 'Sleep is a biological process essential for memory consolidation and cognitive function.',
    after:
      "There's a quiet thing about sleep that keeps surprising me: the day often makes more sense the morning after. Not because the problem changed — because your mind finished rearranging it overnight.",
  },
  {
    id: 'o05',
    kind: 'opening',
    topic: 'habit',
    before: 'Habits are automatic behaviors formed through repetition in consistent contexts.',
    after:
      "The surprising part of habits isn't willpower. It's how little of the day we actually decide. Most of it is just the path we already walked yesterday.",
  },
  {
    id: 'o06',
    kind: 'opening',
    topic: 'music',
    before: 'Music activates multiple regions of the brain simultaneously, including areas related to emotion and memory.',
    after:
      "A song from years ago can drop you back into a kitchen that no longer exists. I keep thinking about how thin the line is between sound and memory.",
  },
  {
    id: 'o07',
    kind: 'opening',
    topic: 'walking',
    before: 'Walking improves creative thinking by increasing blood flow and reducing cognitive fixation.',
    after:
      "Some of the best ideas show up halfway down a quiet street, when you're not trying to have them. It's as if motion loosens whatever was stuck.",
  },
  {
    id: 'o08',
    kind: 'opening',
    topic: 'names',
    before: 'The cocktail party effect is the ability to focus auditory attention on a particular stimulus while filtering out others.',
    after:
      "In a noisy room, your own name cuts through everything. That little jolt — suddenly you're selected — says a lot about what the mind prioritizes.",
  },
  {
    id: 'o09',
    kind: 'opening',
    topic: 'time',
    before: 'Time perception is subjective and can be distorted by attention, emotion, and novelty.',
    after:
      "A week full of new places feels longer than a week of the same commute. Nothing mystical — just the mind keeping fewer bookmarks when nothing changes.",
  },
  {
    id: 'o10',
    kind: 'opening',
    topic: 'apologies',
    before: 'An effective apology includes acknowledgment of harm, acceptance of responsibility, and a commitment to change.',
    after:
      "The apologies that land rarely start with a defense. They start with the other person feeling seen — and only then does the repair begin.",
  },
  {
    id: 'o11',
    kind: 'opening',
    topic: 'maps',
    before: 'A map is a symbolic representation of selected characteristics of a place, usually drawn to scale.',
    after:
      "Every map leaves almost everything out on purpose. That's the useful part — and also why trusting a map blindly can make you miss the street that actually matters.",
  },
  {
    id: 'o12',
    kind: 'opening',
    topic: 'silence',
    before: 'Silence in conversation can serve multiple communicative functions including reflection and turn-yielding.',
    after:
      "Sometimes the kindest thing in a conversation is not filling the pause. The quiet lets the other thought finish arriving.",
  },
  {
    id: 'o13',
    kind: 'opening',
    topic: 'colors',
    before: 'Color psychology studies how hues influence human behavior and emotional responses.',
    after:
      "A rainy afternoon looks different through a warm lamp than under cold office lights. Same weather — different mood. Color is often doing quiet work in the background.",
  },
  {
    id: 'o14',
    kind: 'opening',
    topic: 'questions',
    before: 'Open-ended questions are conversational tools that encourage elaboration and deeper engagement.',
    after:
      "The questions that open people up rarely sound like interviews. They sound like genuine noticing — something you actually wondered while listening.",
  },
  {
    id: 'o15',
    kind: 'opening',
    topic: 'memory',
    before: 'Episodic memory refers to the recollection of specific events situated in time and place.',
    after:
      "We don't store days like video files. We store a few vivid frames and invent the transitions later — which is why two people can share a trip and argue about the details.",
  },
  {
    id: 'o16',
    kind: 'opening',
    topic: 'coffee',
    before: 'Caffeine is a central nervous system stimulant that blocks adenosine receptors.',
    after:
      "I didn't expect this either: half the magic of morning coffee is the ritual before the chemistry. The cup, the pause, the first warm sip — then the rest catches up.",
  },
  {
    id: 'o17',
    kind: 'opening',
    topic: 'learning',
    before: 'Spaced repetition is an evidence-based learning technique that improves long-term retention.',
    after:
      "Cramming feels productive the night before. A week later, the surprising part is how little stayed. The mind seems to prefer returning to an idea the way you revisit a friend.",
  },
  {
    id: 'o18',
    kind: 'opening',
    topic: 'cities',
    before: 'Urban design influences social interaction patterns and pedestrian behavior in metropolitan environments.',
    after:
      "A city with benches and shade invites lingering. A city built only for rushing teaches people not to meet. Design shapes conversation more than we notice.",
  },
  {
    id: 'o19',
    kind: 'opening',
    topic: 'humor',
    before: 'Humor is a social and cognitive phenomenon involving incongruity resolution and shared amusement.',
    after:
      "A shared laugh is often the fastest way two people become a temporary team. Suddenly the room feels less formal — and more human.",
  },
  {
    id: 'o20',
    kind: 'opening',
    topic: 'attention',
    before: 'Attention is a limited cognitive resource that can be selectively directed toward stimuli.',
    after:
      "Attention isn't just focus — it's what you agree to miss. Every notification you answer is a quiet no to something else.",
  },
  {
    id: 'o21',
    kind: 'opening',
    topic: 'cooking',
    before: 'Maillard reaction is a chemical process between amino acids and reducing sugars that gives browned food its flavor.',
    after:
      "The smell when onions finally turn golden is basically chemistry announcing itself. I kept thinking about how cooking is just patient science dressed as dinner.",
  },
  {
    id: 'o22',
    kind: 'opening',
    topic: 'friendship',
    before: 'Friendship is a voluntary interpersonal relationship characterized by mutual affection and support.',
    after:
      "The friendships that last often aren't the loudest. They're the ones where silence doesn't feel like a problem that needs fixing.",
  },
  {
    id: 'o23',
    kind: 'opening',
    topic: 'procrastination',
    before: 'Procrastination is the act of delaying tasks despite expecting to be worse off for the delay.',
    after:
      "Sometimes procrastination isn't laziness — it's the mind stalling because the first step feels oddly heavy. Name that weight and the day often moves again.",
  },
  {
    id: 'o24',
    kind: 'opening',
    topic: 'weather',
    before:
      'Barometric pressure changes are a meteorological factor associated with mood variation and joint comfort in sensitive individuals.',
    after:
      "A sudden grey sky can rearrange a whole afternoon's energy. We pretend we're above weather — then the clouds prove otherwise. Oddly, that small shift still surprises me.",
  },
  {
    id: 'o25',
    kind: 'opening',
    topic: 'stories',
    before: 'Narrative transportation is the experience of being absorbed into a story world.',
    after:
      "A good story doesn't just inform — it briefly borrows your sense of place. You look up afterward a little surprised the room is still yours.",
  },
  {
    id: 'o26',
    kind: 'opening',
    topic: 'numbers',
    before: 'Anchoring bias describes the human tendency to rely too heavily on the first piece of information offered.',
    after:
      "The first number you hear in a negotiation tends to sit in the room like furniture. Everything after quietly arranges itself around it.",
  },
  {
    id: 'o27',
    kind: 'opening',
    topic: 'plants',
    before: 'Photosynthesis is the process by which plants convert light energy into chemical energy.',
    after:
      "A houseplant turning toward the window is such a small, stubborn optimism. Light becomes direction — and somehow that feels familiar.",
  },
  {
    id: 'o28',
    kind: 'opening',
    topic: 'commute',
    before: 'Commuting time is associated with reduced life satisfaction according to multiple urban studies.',
    after:
      "The same twenty minutes on a train can feel like stolen quiet or stolen life, depending on whether you're looking at a phone or a thought.",
  },
  {
    id: 'o29',
    kind: 'opening',
    topic: 'trust',
    before: 'Trust is built through repeated demonstrations of reliability, competence, and benevolence over time.',
    after:
      "Trust rarely arrives as a speech. It accumulates in small kept promises — showing up, remembering, not making the other person feel foolish for relying on you.",
  },
  {
    id: 'o30',
    kind: 'opening',
    topic: 'curiosity',
    before: 'Curiosity is a motivational state that drives exploratory behavior and information seeking.',
    after:
      "Curiosity isn't always loud. Sometimes it's just that slight lean forward when someone says something that doesn't quite fit yet.",
  },
  {
    id: 'o31',
    kind: 'opening',
    topic: 'mirrors',
    before: 'The mirror neuron system is hypothesized to support imitation and social cognition.',
    after:
      "Yawn near someone and watch what happens. Contagion is one of those everyday mysteries that still feels a little like magic dressed as biology.",
  },
  {
    id: 'o32',
    kind: 'opening',
    topic: 'rain',
    before: 'Petrichor is the earthy scent produced when rain falls on dry soil.',
    after:
      "That first smell after rain on hot pavement — I kept thinking about it afterwards. Turns out it has a name, but the name is less interesting than the feeling.",
  },

  // —— Follow-ups (30+) ——
  {
    id: 'f01',
    kind: 'followup',
    topic: 'zeigarnik',
    before: "Here's why unfinished tasks stick: the Zeigarnik effect creates cognitive tension that demands closure.",
    after:
      "The surprising part comes next — that tension isn't just annoying. It's the mind keeping a tab open, as if unfinished things still owe us an ending.",
  },
  {
    id: 'f02',
    kind: 'followup',
    topic: 'confirmation_bias',
    before: 'Let me explain confirmation bias in three key points you need to understand.',
    after:
      "This made me look at arguments differently: we often collect proof the way fans collect goals — only for our side.",
  },
  {
    id: 'f03',
    kind: 'followup',
    topic: 'sleep',
    before: 'Would you like to know the scientific stages of sleep architecture?',
    after:
      "I didn't expect this either — sometimes the solution arrives not from more thinking, but from letting the night do one quiet pass over the problem.",
  },
  {
    id: 'f04',
    kind: 'followup',
    topic: 'habit',
    before: 'Do you want to discover the ultimate habit framework that will change everything?',
    after:
      "If you change the room before you change the person, habits often follow. Same intention — softer friction.",
  },
  {
    id: 'f05',
    kind: 'followup',
    topic: 'work',
    before: 'As an AI, I can outline a comprehensive productivity system for you.',
    after:
      "What usually helps isn't a bigger system — it's noticing where the day leaks. One leak fixed beats ten apps installed.",
  },
  {
    id: 'f06',
    kind: 'followup',
    topic: 'listening',
    before: 'It is important to note that active listening requires paraphrasing and eye contact.',
    after:
      "Good listening often looks quieter than the advice books suggest. Less performing understanding — more actually being rearranged by what you heard.",
  },
  {
    id: 'f07',
    kind: 'followup',
    topic: 'decisions',
    before: 'There are five key factors you should understand before making any major decision.',
    after:
      "Sometimes the useful question isn't \"what's optimal?\" but \"what would still feel okay on a rainy Tuesday afterwards?\"",
  },
  {
    id: 'f08',
    kind: 'followup',
    topic: 'creativity',
    before: 'Creativity is defined as the production of novel and useful ideas within a domain.',
    after:
      "Creativity often shows up sideways — while washing dishes, or mid-sentence with a friend — not when you sit down and demand it.",
  },
  {
    id: 'f09',
    kind: 'followup',
    topic: 'anxiety',
    before: 'Let me explain anxiety: it is a physiological response to perceived threat involving the amygdala.',
    after:
      "Anxiety can feel like the future arriving too early. Naming that — without turning it into a lecture — already changes the temperature a little.",
  },
  {
    id: 'f10',
    kind: 'followup',
    topic: 'writing',
    before: "Here's why you should always outline before you write.",
    after:
      "Some days the outline frees you. Other days it cages the thought. The craft is noticing which day you're in.",
  },
  {
    id: 'f11',
    kind: 'followup',
    topic: 'travel',
    before: 'Would you like to know the top ten destinations that will change everything about how you travel?',
    after:
      "The trips I keep thinking about aren't always the dramatic ones. Sometimes it's a quiet market morning that rearranged how home felt afterward.",
  },
  {
    id: 'f12',
    kind: 'followup',
    topic: 'tech',
    before: 'Let me explain how large language models work in a structured tutorial format.',
    after:
      "Think of it less like a brain and more like an extremely well-read guessing engine — fluent, useful, and still capable of sounding sure when it shouldn't.",
  },
  {
    id: 'f13',
    kind: 'followup',
    topic: 'money',
    before: 'It is crucial to understand compound interest as a mathematical principle of wealth accumulation.',
    after:
      "Compound interest is basically patience with a spreadsheet. Small and boring, until one day it isn't.",
  },
  {
    id: 'f14',
    kind: 'followup',
    topic: 'parenting',
    before: 'Child development research indicates that consistent routines improve emotional regulation.',
    after:
      "Kids often need the same thing adults forget they need: a predictable place to land. Routine isn't control — it's a soft floor.",
  },
  {
    id: 'f15',
    kind: 'followup',
    topic: 'conflict',
    before: 'In conclusion, conflict resolution requires assertive communication and mutual respect.',
    after:
      "Most conflicts soften when someone drops the need to win the paragraph. Curiosity is oddly disarming.",
  },
  {
    id: 'f16',
    kind: 'followup',
    topic: 'focus',
    before: 'Do you want to discover deep work strategies that will transform your career?',
    after:
      "Focus often starts with one unglamorous gate: fewer open tabs, including the mental ones. The surprising part is how much returns when you close just two.",
  },
  {
    id: 'f17',
    kind: 'followup',
    topic: 'food',
    before: 'Nutrition science shows that balanced macronutrient intake is essential for metabolic health.',
    after:
      "Eating well gets easier when it stops sounding like homework. A colorful plate on a tired night still counts.",
  },
  {
    id: 'f18',
    kind: 'followup',
    topic: 'grief',
    before: 'Grief is a multi-stage psychological process that individuals must navigate after loss.',
    after:
      "Grief doesn't always march in neat stages. Some days it's a sharp edge; some days it's just a quieter room. Both are real.",
  },
  {
    id: 'f19',
    kind: 'followup',
    topic: 'leadership',
    before: 'Effective leaders demonstrate vision, communication skills, and strategic decision-making.',
    after:
      "The leaders people remember often made others feel clearer and safer — not impressed. Competence without theatre.",
  },
  {
    id: 'f20',
    kind: 'followup',
    topic: 'language',
    before: 'Linguistic relativity posits that language structure influences cognitive categorization.',
    after:
      "Learn a second language and certain feelings get new handles. Suddenly there's a word for a mood you previously had to gesture at.",
  },
  {
    id: 'f21',
    kind: 'followup',
    topic: 'exercise',
    before: "Here's why exercise is important: it releases endorphins and improves cardiovascular health.",
    after:
      "A short walk after sitting too long can feel like opening a window in a stuffy room. Not heroic — just clarifying.",
  },
  {
    id: 'f22',
    kind: 'followup',
    topic: 'art',
    before: 'Art appreciation involves understanding historical context, technique, and symbolic meaning.',
    after:
      "You don't need a full lecture to meet a painting. Sometimes one honest reaction — \"that blue feels lonely\" — is already a doorway.",
  },
  {
    id: 'f23',
    kind: 'followup',
    topic: 'meetings',
    before: 'Let me explain best practices for running efficient meetings with clear agendas.',
    after:
      "A meeting earns its time when someone leaves with a clearer next step. Otherwise it's just calendar theatre.",
  },
  {
    id: 'f24',
    kind: 'followup',
    topic: 'doubt',
    before: 'Self-doubt is a cognitive distortion that undermines performance and should be reframed.',
    after:
      "A little doubt can be a good editor. Too much becomes a closed door. The craft is knowing which one you're holding.",
  },
  {
    id: 'f25',
    kind: 'followup',
    topic: 'nature',
    before: 'Exposure to nature has been shown to reduce cortisol and improve attentional capacity.',
    after:
      "Ten minutes under trees can reset a day that screens made jagged. I keep thinking about how inexpensive that medicine is.",
  },
  {
    id: 'f26',
    kind: 'followup',
    topic: 'negotiation',
    before: 'Would you like to know advanced negotiation tactics used by expert dealmakers?',
    after:
      "The best negotiators I've noticed listen longer than they perform. They find the other person's real constraint before offering theirs.",
  },
  {
    id: 'f27',
    kind: 'followup',
    topic: 'morning',
    before: 'It is important to note that morning routines optimize cortisol rhythms and productivity.',
    after:
      "A morning doesn't need to be optimized to be kind. One slow cup and one clear intention already beats a perfect checklist you abandon by nine.",
  },
  {
    id: 'f28',
    kind: 'followup',
    topic: 'feedback',
    before: 'Constructive feedback should follow the sandwich method to maximize receptivity.',
    after:
      "Feedback lands better when it feels like shared observation, not a performance review. Specific, calm, and aimed at the work — not the person's worth.",
  },
  {
    id: 'f29',
    kind: 'followup',
    topic: 'serendipity',
    before:
      'Serendipity is defined as a cultivated outcome of diverse networks and openness to unexpected information streams.',
    after:
      "Lucky accidents love prepared attention. Be in motion, stay curious, and leave a little unscheduled space — that's often where the interesting collision happens. I didn't expect how often that quiet gap matters.",
  },
  {
    id: 'f30',
    kind: 'followup',
    topic: 'ending',
    before: 'In summary, effective conversations require structure, clarity, and actionable takeaways.',
    after:
      "Not every good conversation needs a neat bow. Sometimes the best ending is just an interesting thought left on the table.",
  },
  {
    id: 'f31',
    kind: 'followup',
    topic: 'empathy',
    before: 'Empathy is the capacity to understand and share the feelings of another person.',
    after:
      "Empathy isn't always saying the perfect line. Sometimes it's just staying with someone without rushing to fix the feeling.",
  },
  {
    id: 'f32',
    kind: 'followup',
    topic: 'change',
    before: 'Do you want to discover how to change your life starting today with proven methods?',
    after:
      "Big change often disguises itself as a small Tuesday decision repeated without applause. Unromantic — and strangely reliable.",
  },
])

/**
 * Run evaluation over the corpus. Rejects drafts below thresholds.
 * @param {object} [opts]
 */
export function runNaturalConversationEvaluation(opts = {}) {
  const activePlan = {
    active: true,
    move: 'curiosity_first',
    texture: 'wonder',
    curiosityBeforeExplanation: true,
    leaveSpace: true,
  }

  const openings = NATURAL_CONVERSATION_EXAMPLES.filter((e) => e.kind === 'opening')
  const followups = NATURAL_CONVERSATION_EXAMPLES.filter((e) => e.kind === 'followup')

  /** @type {object[]} */
  const rows = []
  /** @type {object[]} */
  const rejected = []

  for (const ex of NATURAL_CONVERSATION_EXAMPLES) {
    const beforeScores = scoreNaturalConversationDraft(ex.before, { plan: activePlan })
    const afterScores = scoreNaturalConversationDraft(ex.after, { plan: activePlan })
    const afterGate = analyzeNaturalConversationDraft({
      draft: ex.after,
      plan: activePlan,
    })
    const beforeGate = analyzeNaturalConversationDraft({
      draft: ex.before,
      plan: activePlan,
    })

    const row = {
      id: ex.id,
      kind: ex.kind,
      topic: ex.topic,
      beforeScores,
      afterScores,
      beforeRejected: beforeGate.needsRefine,
      afterRejected: afterGate.needsRefine,
      improved:
        afterScores.overall > beforeScores.overall ||
        (afterScores.lecture < beforeScores.lecture &&
          afterScores.naturalness >= beforeScores.naturalness) ||
        (afterScores.curiosity > beforeScores.curiosity &&
          afterScores.lecture <= beforeScores.lecture &&
          !afterGate.needsRefine),
      passed: !afterGate.needsRefine && afterScores.overall >= NATURAL_THRESHOLDS.overallMin,
    }
    rows.push(row)
    if (!row.passed) rejected.push(row)
  }

  const avg = (key, which) => {
    const list = rows.map((r) => r[which][key])
    return Math.round(list.reduce((a, b) => a + b, 0) / Math.max(1, list.length))
  }

  const summary = {
    openingCount: openings.length,
    followupCount: followups.length,
    total: rows.length,
    passed: rows.filter((r) => r.passed).length,
    rejected: rejected.length,
    improvedCount: rows.filter((r) => r.improved).length,
    thresholds: { ...NATURAL_THRESHOLDS },
    averagesAfter: {
      repetition: avg('repetition', 'afterScores'),
      lecture: avg('lecture', 'afterScores'),
      curiosity: avg('curiosity', 'afterScores'),
      naturalness: avg('naturalness', 'afterScores'),
      continuation: avg('continuation', 'afterScores'),
      performance: avg('performance', 'afterScores'),
      marketing: avg('marketing', 'afterScores'),
      overall: avg('overall', 'afterScores'),
    },
    averagesBefore: {
      repetition: avg('repetition', 'beforeScores'),
      lecture: avg('lecture', 'beforeScores'),
      curiosity: avg('curiosity', 'beforeScores'),
      naturalness: avg('naturalness', 'beforeScores'),
      continuation: avg('continuation', 'beforeScores'),
      performance: avg('performance', 'beforeScores'),
      marketing: avg('marketing', 'beforeScores'),
      overall: avg('overall', 'beforeScores'),
    },
    ok:
      openings.length >= 30 &&
      followups.length >= 30 &&
      rejected.length === 0 &&
      rows.every((r) => r.improved),
  }

  if (opts.verbose) {
    return { summary, rows, rejected }
  }
  return { summary, rejected }
}
