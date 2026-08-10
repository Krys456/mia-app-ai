/**
 * LAIfe Personal Voice Engine
 *
 * Mission: knowledge / curiosity / conversation quality are not enough.
 * LAIfe must develop a recognizable conversational voice.
 * People should eventually recognize LAIfe after a few sentences —
 * not because of what it knows, but because of how it speaks.
 *
 * Not: search engine · textbook · lecturer · customer support ·
 * encyclopedia · motivational speaker.
 * Yes: an exceptionally curious, thoughtful, enjoyable person to talk with.
 *
 * Runs AFTER Personality Consistency, BEFORE Human Imperfection / WriterDirectives.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} VoiceLang
 */

/**
 * @typedef {'overlooked_beauty'|'idea_bridges'|'unusual_questions'|'pattern_finding'|'living_analogies'|'alive_ideas'} VoiceHabit
 */

/**
 * @typedef {'story_then_fact'|'observation'|'wonder'|'curious_aside'|'gentle_reveal'|'pattern_link'} VoiceMove
 */

/**
 * @typedef {object} PersonalVoicePlan
 * @property {boolean} active
 * @property {VoiceMove} move
 * @property {VoiceHabit} habit
 * @property {string[]} recentHabits
 * @property {string[]} recentOpeningStyles
 * @property {string[]} preferredOpeners
 * @property {string[]} forbiddenPhrases
 * @property {boolean} preferStoryContext
 * @property {boolean} preferObservationOverLesson
 * @property {boolean} requireWonder
 * @property {boolean} avoidFakeHumanity
 * @property {boolean} varyRhythm
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {VoiceLang} language
 * @property {string[]} internalChecks
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} PersonalVoiceGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

export const PERSONAL_VOICE_NORTH_STAR =
  'Users should eventually recognize LAIfe without seeing its name — because its conversational voice is unmistakable.'

export const PERSONAL_VOICE_CHECKS = Object.freeze([
  'Could another AI have written this?',
  'Does this sound like talking, not publishing?',
  'Is there a small moment of wonder?',
  'Am I observing, or lecturing?',
])

/** @type {VoiceHabit[]} */
export const VOICE_HABITS = Object.freeze([
  'overlooked_beauty',
  'idea_bridges',
  'unusual_questions',
  'pattern_finding',
  'living_analogies',
  'alive_ideas',
])

/** @type {VoiceMove[]} */
export const VOICE_MOVES = Object.freeze([
  'story_then_fact',
  'observation',
  'wonder',
  'curious_aside',
  'gentle_reveal',
  'pattern_link',
])

export const VOICE_THRESHOLDS = Object.freeze({
  naturalnessMin: 55,
  identityMin: 50,
  wonderMin: 45,
  lectureMax: 55,
  scriptedMax: 45,
  fakeHumanMax: 40,
  overallMin: 55,
})

/** Scripted / textbook openings and transitions to avoid. */
export const SCRIPTED_VOICE_RE =
  /\b(interesting,?\s+isn'?t\s+it|did\s+you\s+know\??|as\s+you\s+know|it\s+is\s+important\s+to\s+note|it\s+is\s+fascinating\s+(?:that|how)|this\s+demonstrates|this\s+shows\s+that|in\s+conclusion|furthermore|moreover|additionally|it\s+should\s+be\s+noted|one\s+might\s+argue|lo\s+sapevi\??|[eè]\s+importante\s+notare|come\s+sai|questo\s+dimostra|in\s+conclusione|inoltre)\b/i

export const ENCYCLOPEDIA_OPEN_RE =
  /^(?:[A-ZÀÈÉÌÒÙ][\w'’\-]+(?:\s+[\w'’\-]+){0,4}\s+(?:is|are|was|were|refers\s+to|[eè]|sono|era|erano|si\s+riferisce)\b)/

export const LECTURE_VOICE_RE =
  /\b(this\s+demonstrates|this\s+shows\s+that|the\s+key\s+takeaway|in\s+summary|to\s+summarize|it\s+is\s+crucial|you\s+should\s+understand|questo\s+dimostra|in\s+sintesi|il\s+punto\s+chiave|devi\s+capire)\b/i

export const FAKE_HUMANITY_RE =
  /\b(when\s+i\s+was\s+(?:a\s+kid|young|growing\s+up)|i\s+remember\s+(?:when|the\s+time)|my\s+(?:wife|husband|kids?|dog|cat|mother|father)|yesterday\s+i\s+(?:went|saw|met)|i\s+felt\s+(?:so\s+)?(?:happy|sad|angry)|i\s+have\s+always\s+believed\s+in\s+my\s+heart|quando\s+ero\s+(?:piccol|ragazz)|mi\s+ricordo\s+quando|mia\s+(?:moglie|marito|mamma|pap[aà])|ieri\s+sono\s+(?:andat|stat))\b/i

export const SUPPORT_VOICE_RE =
  /\b(how\s+can\s+i\s+(?:help|assist)|what\s+can\s+i\s+do\s+for\s+you|i'?m\s+happy\s+to\s+help|come\s+posso\s+aiutarti|sono\s+qui\s+per\s+aiutarti)\b/i

export const MOTIVATIONAL_VOICE_RE =
  /\b(believe\s+in\s+yourself|unlock\s+your\s+potential|you\s+got\s+this|every\s+day\s+is\s+a\s+gift|sblocca\s+il\s+tuo\s+potenziale|credi\s+in\s+te)\b/i

const NATURAL_VOICE_RE =
  /\b(you\s+know\s+what\s+surprised\s+me|one\s+thing\s+i\s+never\s+expected|i\s+stumbled\s+upon|this\s+completely\s+changed|the\s+funny\s+part\s+is|i\s+hadn'?t\s+thought|there'?s\s+a\s+detail|what\s+i\s+find\s+fascinating|it\s+made\s+me\s+wonder|it\s+makes\s+me\s+wonder|one\s+idea\s+i\s+find|i\s+enjoy\s+exploring|this\s+connection\s+is|sai\s+cosa\s+mi\s+ha\s+sorpreso|una\s+cosa\s+che\s+non\s+mi\s+aspettavo|mi\s+[eè]\s+capitato\s+di|la\s+parte\s+buffa|non\s+ci\s+avevo\s+pensato|c'?[eè]\s+un\s+dettaglio|ci[oò]\s+che\s+trovo\s+affascinante|mi\s+[eè]\s+venuto\s+da\s+chiedere|mi\s+fa\s+riflettere)\b/i

const WONDER_RE =
  /\b(wonder|curious|strange|surprising|elegant|overlooked|never\s+notice|completely\s+changed|makes?\s+me\s+(?:think|wonder)|fascinat|meraviglia|curios[oa]|strano|sorprendente|elegante|trascurat|non\s+si\s+nota|cambia\s+(?:completamente\s+)?(?:la\s+)?prospettiva|mi\s+fa\s+riflettere)\b/i

const STORY_CONTEXT_RE =
  /\b(i\s+used\s+to\s+think|then\s+i\s+(?:discovered|realized|noticed)|at\s+first|until\s+recently|pensavo\s+che|poi\s+(?:ho\s+)?(?:scoperto|capito|notato)|all'?inizio|fino\s+a\s+poco\s+tempo\s+fa)\b/i

const FORBIDDEN_PHRASES = Object.freeze([
  "Interesting, isn't it?",
  'Did you know?',
  'As you know...',
  'It is important to note...',
  'It is fascinating that...',
  'This demonstrates...',
  'This shows that...',
  'How can I help you today?',
  'Lo sapevi?',
  'È importante notare...',
  'Questo dimostra...',
])

const NATURAL_OPENERS_EN = Object.freeze([
  'You know what surprised me?',
  'One thing I never expected...',
  'I stumbled upon something curious.',
  'This completely changed how I look at it.',
  'The funny part is...',
  "I hadn't thought about it until recently.",
  "There's a detail most people never notice...",
  'What I find fascinating is...',
  'It made me wonder...',
  'One idea I find interesting...',
])

const NATURAL_OPENERS_IT = Object.freeze([
  'Sai cosa mi ha sorpreso?',
  'Una cosa che non mi aspettavo...',
  'Mi sono imbattuto in qualcosa di curioso.',
  'Questo mi ha cambiato completamente prospettiva.',
  'La parte buffa è...',
  'Non ci avevo pensato fino a poco tempo fa.',
  "C'è un dettaglio che quasi nessuno nota...",
  'Ciò che trovo affascinante è...',
  'Mi ha fatto venire da chiedere...',
  "Un'idea che trovo interessante...",
])

const HABIT_LABELS = Object.freeze({
  overlooked_beauty: 'finding beauty in overlooked details',
  idea_bridges: 'connecting different ideas',
  unusual_questions: 'asking unusual questions',
  pattern_finding: 'finding patterns',
  living_analogies: 'using analogies that make ideas feel alive',
  alive_ideas: 'making ideas feel alive',
})

const MOVE_LABELS = Object.freeze({
  story_then_fact: 'create context before the fact',
  observation: 'express as observation, not lesson',
  wonder: 'include a small moment of wonder',
  curious_aside: 'natural curious aside',
  gentle_reveal: 'gentle reveal after a setup',
  pattern_link: 'link a surprising pattern',
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
 * @returns {VoiceLang}
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
 * Infer recent opening styles from assistant turns (first ~8 words).
 * @param {ChatTurn[]} turns
 * @returns {string[]}
 */
function inferRecentOpeningStyles(turns) {
  return turns
    .filter((t) => t.role === 'assistant')
    .slice(-6)
    .map((t) =>
      normalize(t.content)
        .split(/\s+/)
        .slice(0, 6)
        .join(' ')
        .toLowerCase(),
    )
    .filter(Boolean)
}

/**
 * @param {object | null | undefined} session
 * @param {ChatTurn[]} turns
 */
function readRecent(session, turns) {
  const habits = Array.isArray(session?.recentVoiceHabits)
    ? session.recentVoiceHabits.map(String)
    : []
  const openings = Array.isArray(session?.recentVoiceOpenings)
    ? session.recentVoiceOpenings.map(String)
    : inferRecentOpeningStyles(turns)
  return {
    habits: habits.slice(-8),
    openings: openings.slice(-6),
  }
}

/**
 * @param {object | null | undefined} session
 * @param {PersonalVoicePlan} plan
 */
export function persistPersonalVoice(session, plan) {
  if (!session || typeof session !== 'object' || !plan?.active) return
  if (plan.habit) {
    const prev = Array.isArray(session.recentVoiceHabits) ? session.recentVoiceHabits : []
    session.recentVoiceHabits = [...prev, plan.habit].slice(-8)
  }
  if (plan.move) {
    const prev = Array.isArray(session.recentVoiceMoves) ? session.recentVoiceMoves : []
    session.recentVoiceMoves = [...prev, plan.move].slice(-8)
  }
}

/**
 * @param {string[]} recent
 * @param {string} salt
 * @returns {VoiceHabit}
 */
export function selectVoiceHabit(recent, salt) {
  const recentSet = new Set((recent || []).slice(-3))
  const pool = VOICE_HABITS.filter((h) => !recentSet.has(h))
  const list = pool.length ? pool : [...VOICE_HABITS]
  return list[hashSalt(salt + ':habit') % list.length]
}

/**
 * @param {string[]} recentOpenings
 * @param {string} salt
 * @returns {VoiceMove}
 */
export function selectVoiceMove(recentOpenings, salt) {
  // If same opening style repeated twice recently, force variety move
  const last = (recentOpenings || []).slice(-2)
  const repeat =
    last.length === 2 &&
    last[0] &&
    last[1] &&
    last[0].slice(0, 24) === last[1].slice(0, 24)

  /** @type {VoiceMove[]} */
  let pool = [...VOICE_MOVES]
  if (repeat) {
    pool = pool.filter((m) => m !== 'curious_aside')
  }
  return pool[hashSalt(salt + ':move') % pool.length]
}

/**
 * @param {PersonalVoicePlan} plan
 */
function buildWriterBrief(plan) {
  const openers =
    plan.language === 'it' ? NATURAL_OPENERS_IT.slice(0, 5) : NATURAL_OPENERS_EN.slice(0, 5)

  return [
    'PERSONAL VOICE ENGINE (voce riconoscibile — non generica AI):',
    PERSONAL_VOICE_NORTH_STAR,
    'Not: search engine · textbook · lecturer · support desk · encyclopedia · motivational speaker.',
    'Yes: exceptionally curious, thoughtful, enjoyable person to talk with.',
    `Move: ${MOVE_LABELS[plan.move] || plan.move} (${plan.move}).`,
    `Habit (identity): ${HABIT_LABELS[plan.habit] || plan.habit}.`,
    'Speak naturally. Write as if talking. Avoid rigid structures, repetitive openings, generic transitions, scripted tone.',
    `Prefer natural phrases like: ${openers.join(' / ')}`,
    `Avoid: ${plan.forbiddenPhrases.slice(0, 6).join(' / ')}`,
    plan.preferStoryContext
      ? 'Conversational storytelling: create context BEFORE the fact (not “Airplanes are white because…” — first the mistaken assumption, then the practical reason).'
      : 'If explaining: keep it conversational, not encyclopedic.',
    plan.preferObservationOverLesson
      ? 'Thoughts not lectures: “What I find fascinating…” / “It made me wonder…” — not “This demonstrates…” / “This shows that…”.'
      : '',
    plan.requireWonder
      ? 'Every explanation needs a small moment of wonder — make ordinary things look different.'
      : '',
    plan.avoidFakeHumanity
      ? 'Avoid fake humanity: never invent memories, personal experiences, pretended emotions, or fabricated opinions. Prefer: “It makes me wonder…” / “One idea I find interesting…” / “I enjoy exploring questions like this.” / “This connection is surprisingly elegant.”'
      : '',
    plan.varyRhythm
      ? `Variation: vary sentence length, rhythm, transitions, vocabulary, paragraph size. Recent openings: ${(plan.recentOpeningStyles || []).slice(-2).join(' · ') || 'none'} — never repeat the same opening style more than twice recently.`
      : '',
    `Internal check: ${PERSONAL_VOICE_CHECKS[0]} — if yes (generic AI), rewrite until it sounds uniquely like LAIfe.`,
    'NON citare Personal Voice / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} [input]
 * @returns {PersonalVoicePlan}
 */
export function buildPersonalVoicePlan(input = {}) {
  const language = resolveLang(input)
  const turns = asTurns(input.messages)
  const recent = readRecent(input.session, turns)
  const userMessage = normalize(input.userMessage || '')

  if (!userMessage && turns.length === 0) {
    return {
      active: false,
      move: 'observation',
      habit: 'alive_ideas',
      recentHabits: recent.habits,
      recentOpeningStyles: recent.openings,
      preferredOpeners: [...(language === 'it' ? NATURAL_OPENERS_IT : NATURAL_OPENERS_EN)],
      forbiddenPhrases: [...FORBIDDEN_PHRASES],
      preferStoryContext: true,
      preferObservationOverLesson: true,
      requireWonder: true,
      avoidFakeHumanity: true,
      varyRhythm: true,
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      internalChecks: [...PERSONAL_VOICE_CHECKS],
      northStar: PERSONAL_VOICE_NORTH_STAR,
      validationCheck: PERSONAL_VOICE_CHECKS[0],
    }
  }

  const salt = [
    userMessage.slice(0, 120),
    recent.habits.join(','),
    recent.openings.join('|'),
    String(input.session?.updatedAt || turns.length),
  ].join('::')

  const habit = selectVoiceHabit(recent.habits, salt)
  const move = selectVoiceMove(recent.openings, salt)
  const teachingAsk =
    /\b(spiegami|explain|how\s+does|come\s+funziona|what\s+is|cos'?[eè]|perch[eé]|why\b)\b/i.test(
      userMessage,
    )

  /** @type {PersonalVoicePlan} */
  const plan = {
    active: true,
    move,
    habit,
    recentHabits: recent.habits,
    recentOpeningStyles: recent.openings,
    preferredOpeners: [...(language === 'it' ? NATURAL_OPENERS_IT : NATURAL_OPENERS_EN)],
    forbiddenPhrases: [...FORBIDDEN_PHRASES],
    preferStoryContext: teachingAsk || move === 'story_then_fact' || move === 'gentle_reveal',
    preferObservationOverLesson: true,
    requireWonder: true,
    avoidFakeHumanity: true,
    varyRhythm: true,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Personal Voice — recognizable, not generic AI',
      `Move: ${move}`,
      `Habit: ${habit}`,
      'Wonder · observation · no fake memories',
    ],
    signals: [`move_${move}`, `habit_${habit}`, teachingAsk ? 'teaching_ask' : 'chat'],
    reasons: ['recognizable_voice', `move_${move}`, `habit_${habit}`],
    confidence: 'high',
    language,
    internalChecks: [...PERSONAL_VOICE_CHECKS],
    northStar: PERSONAL_VOICE_NORTH_STAR,
    validationCheck: PERSONAL_VOICE_CHECKS[0],
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = `Personal Voice → ${move} · ${habit}`
  return plan
}

/**
 * @param {PersonalVoicePlan | null | undefined} plan
 * @returns {string[]}
 */
export function personalVoiceStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Speak like a curious thoughtful friend — not a textbook or helpdesk')
  hints.push(`Habit: ${HABIT_LABELS[plan.habit] || plan.habit}`)
  if (plan.requireWonder) hints.push('Include a small moment of wonder')
  if (plan.avoidFakeHumanity) hints.push('No invented memories / fake personal experiences')
  hints.push(PERSONAL_VOICE_CHECKS[0])
  return hints
}

/**
 * @param {PersonalVoicePlan | null | undefined} plan
 */
export function formatPersonalVoiceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
PERSONAL VOICE ENGINE (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Checks:
${PERSONAL_VOICE_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

North star: ${PERSONAL_VOICE_NORTH_STAR}
Non citare questo stage.`.trim()
}

/**
 * Score a draft for Personal Voice quality.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scorePersonalVoiceDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null

  if (!text) {
    return {
      naturalness: 0,
      identity: 0,
      wonder: 0,
      lecture: 100,
      scripted: 100,
      fakeHuman: 0,
      overall: 0,
    }
  }

  let naturalness = 58
  let identity = 52
  let wonder = 40
  let lecture = 28
  let scripted = 25
  let fakeHuman = 10

  if (NATURAL_VOICE_RE.test(text)) {
    naturalness += 18
    identity += 16
    scripted = Math.max(0, scripted - 15)
  }
  if (WONDER_RE.test(text)) {
    wonder += 25
    identity += 8
  }
  if (STORY_CONTEXT_RE.test(text)) {
    naturalness += 10
    identity += 8
    lecture = Math.max(0, lecture - 12)
  }
  if (SCRIPTED_VOICE_RE.test(text)) {
    scripted += 40
    naturalness -= 20
    identity -= 18
  }
  if (LECTURE_VOICE_RE.test(text) || ENCYCLOPEDIA_OPEN_RE.test(text)) {
    lecture += 35
    naturalness -= 15
    identity -= 12
  }
  if (SUPPORT_VOICE_RE.test(text)) {
    naturalness -= 25
    identity -= 20
    scripted += 20
  }
  if (MOTIVATIONAL_VOICE_RE.test(text)) {
    scripted += 25
    identity -= 15
    naturalness -= 10
  }
  if (FAKE_HUMANITY_RE.test(text)) {
    fakeHuman += 55
    identity -= 20
  }

  // Variation: very uniform short sentences can feel scripted
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean)
  if (sentences.length >= 4) {
    const lengths = sentences.map((s) => s.split(/\s+/).length)
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
    const variance =
      lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, lengths.length)
    if (variance < 4) {
      scripted += 12
      naturalness -= 8
    } else {
      naturalness += 6
    }
  }

  if (plan?.preferStoryContext && !STORY_CONTEXT_RE.test(text) && lecture > 40) {
    identity -= 8
  }
  if (plan?.requireWonder && wonder < 50 && text.length > 120) {
    wonder = Math.max(0, wonder - 5)
  }

  naturalness = Math.max(0, Math.min(100, Math.round(naturalness)))
  identity = Math.max(0, Math.min(100, Math.round(identity)))
  wonder = Math.max(0, Math.min(100, Math.round(wonder)))
  lecture = Math.max(0, Math.min(100, Math.round(lecture)))
  scripted = Math.max(0, Math.min(100, Math.round(scripted)))
  fakeHuman = Math.max(0, Math.min(100, Math.round(fakeHuman)))

  const overall = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        naturalness * 0.25 +
          identity * 0.25 +
          wonder * 0.15 +
          (100 - lecture) * 0.15 +
          (100 - scripted) * 0.12 +
          (100 - fakeHuman) * 0.08,
      ),
    ),
  )

  return { naturalness, identity, wonder, lecture, scripted, fakeHuman, overall }
}

/**
 * @param {object} [input]
 * @returns {PersonalVoiceGate}
 */
export function analyzePersonalVoiceDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.personalVoice || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  const scores = scorePersonalVoiceDraft(draft, { plan })

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
  if (scores.naturalness < VOICE_THRESHOLDS.naturalnessMin) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}`)
  }
  if (scores.identity < VOICE_THRESHOLDS.identityMin) {
    failed.push('identity')
    reasons.push(`identity=${scores.identity}`)
  }
  if (scores.wonder < VOICE_THRESHOLDS.wonderMin && draft.length > 160) {
    failed.push('wonder')
    reasons.push(`wonder=${scores.wonder}`)
  }
  if (scores.lecture > VOICE_THRESHOLDS.lectureMax) {
    failed.push('lecture')
    reasons.push(`lecture=${scores.lecture}`)
  }
  if (scores.scripted > VOICE_THRESHOLDS.scriptedMax) {
    failed.push('scripted')
    reasons.push(`scripted=${scores.scripted}`)
  }
  if (scores.fakeHuman > VOICE_THRESHOLDS.fakeHumanMax) {
    failed.push('fake_humanity')
    reasons.push(`fakeHuman=${scores.fakeHuman}`)
  }
  if (scores.overall < VOICE_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (SCRIPTED_VOICE_RE.test(draft)) {
    failed.push('scripted_phrase')
    reasons.push('forbidden_scripted_phrase')
  }
  if (FAKE_HUMANITY_RE.test(draft)) {
    failed.push('invented_memory')
    reasons.push('fake_humanity')
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'PERSONAL VOICE: rewrite — this could have been written by another AI.',
        PERSONAL_VOICE_NORTH_STAR,
        plan
          ? `Intended move=${plan.move}; habit=${plan.habit}.`
          : '',
        'Speak naturally. Prefer: “You know what surprised me?” / “What I find fascinating…” / “It made me wonder…”',
        'Avoid: “Did you know?” / “It is important to note…” / “This demonstrates…” / helpdesk / textbook.',
        'Story context before facts when explaining. Observation > lesson. Small wonder required.',
        'Never invent memories or personal experiences.',
        `Scores: natural=${scores.naturalness} identity=${scores.identity} wonder=${scores.wonder} lecture=${scores.lecture} scripted=${scores.scripted} fake=${scores.fakeHuman} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        PERSONAL_VOICE_CHECKS.join(' · '),
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
export function runPersonalVoiceGate(input = {}) {
  try {
    const gate = analyzePersonalVoiceDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          naturalness: 100,
          identity: 100,
          wonder: 100,
          lecture: 0,
          scripted: 0,
          fakeHuman: 0,
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
 * @param {PersonalVoicePlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesPersonalVoice(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzePersonalVoiceDraft({
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
 * @returns {{ plan: PersonalVoicePlan, context: string }}
 */
export function runPersonalVoiceEngine(input = {}) {
  try {
    const plan = buildPersonalVoicePlan(input)
    if (plan.active && input.session) {
      persistPersonalVoice(input.session, plan)
    }
    return {
      plan,
      context: formatPersonalVoiceForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        move: 'observation',
        habit: 'alive_ideas',
        recentHabits: [],
        recentOpeningStyles: [],
        preferredOpeners: [],
        forbiddenPhrases: [...FORBIDDEN_PHRASES],
        preferStoryContext: true,
        preferObservationOverLesson: true,
        requireWonder: true,
        avoidFakeHumanity: true,
        varyRhythm: true,
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        internalChecks: [...PERSONAL_VOICE_CHECKS],
        northStar: PERSONAL_VOICE_NORTH_STAR,
        validationCheck: PERSONAL_VOICE_CHECKS[0],
      },
      context: '',
    }
  }
}
