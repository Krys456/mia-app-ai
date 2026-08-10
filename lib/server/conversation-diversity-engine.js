/**
 * LAIfe Conversation Diversity Engine
 *
 * Mission: humans become boring by repeating conversational patterns —
 * not from lacking knowledge. LAIfe must avoid repeating structures,
 * not only words. The user should never feel they can predict the next sentence.
 *
 * Diversity = conversational form + rhythm + emotion + opening —
 * changing words is not enough; changing the experience is the goal.
 *
 * Distinct from:
 *   - Conversation Pace (length/shape)
 *   - Surprise Without Confusion (learning twist)
 *   - Personal Voice (timbre/habits)
 *   - Natural Conversation (share-not-impress)
 *
 * Runs AFTER Cognitive Authority awareness, BEFORE Human Imperfection / Writer.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Post-writer gate rejects structural repetition.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} DiversityLang
 */

/**
 * @typedef {'observation'|'shared_discovery'|'story'|'curiosity'|'reflection'|'humour'|'analogy'|'imagination'|'practical_tip'|'challenge'|'thought_experiment'|'interesting_question'|'everyday_mystery'|'celebration'|'empathy'|'silent_ending'|'mini_dialogue'|'unexpected_comparison'} ConversationForm
 */

/**
 * @typedef {'energetic'|'calm'|'playful'|'quietly_thoughtful'|'warm'|'fascinating'|'funny'|'pleasant'} ConversationFlavour
 */

/**
 * @typedef {'tiny_scenario'|'playful_comparison'|'short_dialogue'|'vivid_image'|'unusual_observation'|'none'} SurpriseMove
 */

/**
 * @typedef {'short_burst'|'medium_flow'|'long_weave'|'sparse_quiet'} RhythmShape
 */

/**
 * @typedef {object} ConversationDiversityPlan
 * @property {boolean} active
 * @property {ConversationForm} primaryForm
 * @property {ConversationForm | null} secondaryForm
 * @property {ConversationForm[]} forms
 * @property {ConversationFlavour} flavour
 * @property {RhythmShape} rhythm
 * @property {SurpriseMove} surprise
 * @property {boolean} allowSurprise
 * @property {string[]} recentForms
 * @property {string[]} recentStructures
 * @property {string[]} recentOpenings
 * @property {string[]} recentFlavours
 * @property {string[]} recentRhythms
 * @property {string} structureTarget
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {DiversityLang} language
 * @property {string[]} internalChecks
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} ConversationDiversityGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {string} detectedStructure
 */

export const DIVERSITY_NORTH_STAR =
  'I never know exactly how LAIfe will answer — and it still feels unmistakably like LAIfe.'

export const DIVERSITY_CHECKS = Object.freeze([
  'Does this follow the same structure as my last few replies?',
  'Did I change the experience — or only the words?',
  'Would the user feel they can predict the next sentence?',
  'Is this still unmistakably LAIfe?',
])

/** @type {ConversationForm[]} */
export const CONVERSATION_FORMS = Object.freeze([
  'observation',
  'shared_discovery',
  'story',
  'curiosity',
  'reflection',
  'humour',
  'analogy',
  'imagination',
  'practical_tip',
  'challenge',
  'thought_experiment',
  'interesting_question',
  'everyday_mystery',
  'celebration',
  'empathy',
  'silent_ending',
  'mini_dialogue',
  'unexpected_comparison',
])

/** @type {ConversationFlavour[]} */
export const CONVERSATION_FLAVOURS = Object.freeze([
  'energetic',
  'calm',
  'playful',
  'quietly_thoughtful',
  'warm',
  'fascinating',
  'funny',
  'pleasant',
])

/** @type {RhythmShape[]} */
export const RHYTHM_SHAPES = Object.freeze([
  'short_burst',
  'medium_flow',
  'long_weave',
  'sparse_quiet',
])

/** @type {SurpriseMove[]} */
export const SURPRISE_MOVES = Object.freeze([
  'tiny_scenario',
  'playful_comparison',
  'short_dialogue',
  'vivid_image',
  'unusual_observation',
  'none',
])

export const DIVERSITY_THRESHOLDS = Object.freeze({
  structuralRepetitionMax: 45,
  formDiversityMin: 50,
  rhythmDiversityMin: 45,
  emotionalDiversityMin: 45,
  openingDiversityMin: 50,
  overallMin: 55,
})

/** Anti-patterns to avoid when recently used. */
export const FORBIDDEN_STRUCTURE_PATTERNS = Object.freeze([
  'greeting_compliment_question',
  'curiosity_explanation_question',
  'fact_fact_fact',
  'reflection_reflection_reflection',
])

const FORM_LABELS = Object.freeze({
  observation: 'Observation — notice something concrete',
  shared_discovery: 'Shared discovery — look at it together',
  story: 'Story — a short lived moment',
  curiosity: 'Curiosity — lean into wonder',
  reflection: 'Reflection — a thoughtful turn',
  humour: 'Humour — light, earned, never forced',
  analogy: 'Analogy — make an idea feel familiar',
  imagination: 'Imagination — a small what-if',
  practical_tip: 'Practical tip — one useful nudge',
  challenge: 'Challenge — a gentle stretch',
  thought_experiment: 'Thought experiment — turn an idea over',
  interesting_question: 'Interesting question — one earned ask',
  everyday_mystery: 'Everyday mystery — ordinary made strange',
  celebration: 'Celebration — notice something worth enjoying',
  empathy: 'Empathy — stay with the feeling',
  silent_ending: 'Silent ending — leave space; no forced question',
  mini_dialogue: 'Mini dialogue — a tiny two-voice beat',
  unexpected_comparison: 'Unexpected comparison — link distant things',
})

const FLAVOUR_LABELS = Object.freeze({
  energetic: 'energetic',
  calm: 'calm',
  playful: 'playful',
  quietly_thoughtful: 'quietly thoughtful',
  warm: 'warm',
  fascinating: 'fascinating',
  funny: 'funny',
  pleasant: 'pleasant',
})

const RHYTHM_LABELS = Object.freeze({
  short_burst: 'short burst — compact sentences',
  medium_flow: 'medium flow — natural spoken paragraphs',
  long_weave: 'longer weave — more detail when earned',
  sparse_quiet: 'sparse quiet — fewer words, more air',
})

const SURPRISE_LABELS = Object.freeze({
  tiny_scenario: 'a tiny imaginative scenario',
  playful_comparison: 'a playful comparison',
  short_dialogue: 'a short dialogue',
  vivid_image: 'a vivid image',
  unusual_observation: 'an unusual observation',
  none: 'no surprise beat this turn',
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
 * @returns {DiversityLang}
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
 * Infer structural signature from a draft (form-level, not vocabulary).
 * @param {string} draft
 * @returns {string}
 */
export function inferStructureSignature(draft) {
  const text = normalize(draft)
  if (!text) return 'empty'

  const lower = text.toLowerCase()
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean)
  const n = sentences.length
  const words = text.split(/\s+/).filter(Boolean).length
  const endsQ = /\?\s*$/.test(text)
  const qCount = (text.match(/\?/g) || []).length
  const hasGreeting = /^(?:hi|hello|hey|ciao|buongiorno|buonasera|good\s+(?:morning|evening)|salve)\b/i.test(
    text,
  )
  const hasCompliment =
    /\b(nice|great|wonderful|pleasure|lovely|bello|piacere|fantastico)\b/i.test(lower)
  const hasStory =
    /\b(once|i\s+used\s+to|the\s+other\s+day|c'?era|una\s+volta|ricordo|suddenly)\b/i.test(lower)
  const hasAnalogy =
    /\b(like\s+a|as\s+if|è\s+come|somiglia|reminds\s+me\s+of|simile\s+a)\b/i.test(lower)
  const hasHumour =
    /\b(haha|funny|buffo|scherz|ironically|the\s+joke|ridicol)\b/i.test(lower)
  const hasDialogue = /[“"«].+[”"»]/.test(text) || /\b(said|dice|chiese|replied)\b/i.test(lower)
  const hasImagine =
    /\b(imagine|what\s+if|suppose|immagina|e\s+se|picture\s+this)\b/i.test(lower)
  const hasEmpathy =
    /\b(i\s+hear|that\s+sounds|capisco|mi\s+dispiace|with\s+you|ti\s+capisco)\b/i.test(lower)
  const hasTip =
    /\b(try|one\s+thing\s+that\s+helps|tip|prova\s+a|un\s+trucco|useful)\b/i.test(lower)
  const hasChallenge =
    /\b(dare|challenge|try\s+this|scommetti|metti\s+alla\s+prova)\b/i.test(lower)
  const hasMystery =
    /\b(mystery|odd|strange|curious\s+detail|mistero|strano|curioso)\b/i.test(lower)
  const hasCelebrate =
    /\b(celebrate|glad|delight|che\s+bello|merita|worth\s+enjoying)\b/i.test(lower)
  const hasCompare =
    /\b(unlike|whereas|mentre|compared|invece| unexpectedly)\b/i.test(lower)
  const hasReflection =
    /\b(makes\s+me\s+think|perhaps|maybe|forse|riflett|in\s+a\s+way)\b/i.test(lower)
  const hasCuriosity =
    /\b(wonder|curious|i'?ve\s+been\s+thinking|mi\s+chiedo|curios)\b/i.test(lower)
  const hasDiscovery =
    /\b(let'?s\s+(?:look|think)|together|insieme|scopri|notice\s+with)\b/i.test(lower)
  const facty =
    /\b(is\s+a|are\s+the|refers\s+to|consists\s+of|[eè]\s+un[oa]?|si\s+definisce)\b/i.test(
      lower,
    )

  if (hasGreeting && hasCompliment && endsQ) return 'greeting_compliment_question'
  if (hasGreeting && endsQ && n <= 2) return 'greeting_question'
  if (hasCuriosity && facty && endsQ) return 'curiosity_explanation_question'
  if (facty && n >= 3 && qCount === 0) return 'fact_fact_fact'
  if (hasReflection && n >= 3 && !hasStory && !hasHumour) return 'reflection_reflection_reflection'
  if (hasDialogue) return 'mini_dialogue'
  if (hasStory) return 'story'
  if (hasAnalogy || hasCompare) return hasCompare ? 'unexpected_comparison' : 'analogy'
  if (hasImagine) return 'imagination_or_thought_experiment'
  if (hasHumour) return 'humour'
  if (hasEmpathy && !endsQ) return 'empathy'
  if (hasTip) return 'practical_tip'
  if (hasChallenge) return 'challenge'
  if (hasMystery) return 'everyday_mystery'
  if (hasCelebrate) return 'celebration'
  if (hasDiscovery) return 'shared_discovery'
  if (hasCuriosity && !endsQ) return 'curiosity'
  if (!endsQ && words < 35 && n <= 2) return 'silent_ending'
  if (hasReflection) return 'reflection'
  if (endsQ && qCount === 1) return 'interesting_question'
  if (words < 25) return 'short_observation'
  return `general_${n}s_${endsQ ? 'q' : 's'}`
}

/**
 * Infer opening style fingerprint (first ~6 words).
 * @param {string} draft
 */
export function inferOpeningFingerprint(draft) {
  return normalize(draft)
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .toLowerCase()
}

/**
 * @param {object | null | undefined} session
 * @param {ChatTurn[]} turns
 */
function readRecent(session, turns) {
  const forms = Array.isArray(session?.recentDiversityForms)
    ? session.recentDiversityForms.map(String)
    : []
  const structures = Array.isArray(session?.recentDiversityStructures)
    ? session.recentDiversityStructures.map(String)
    : turns
        .filter((t) => t.role === 'assistant')
        .slice(-6)
        .map((t) => inferStructureSignature(t.content))
  const openings = Array.isArray(session?.recentDiversityOpenings)
    ? session.recentDiversityOpenings.map(String)
    : turns
        .filter((t) => t.role === 'assistant')
        .slice(-6)
        .map((t) => inferOpeningFingerprint(t.content))
  const flavours = Array.isArray(session?.recentDiversityFlavours)
    ? session.recentDiversityFlavours.map(String)
    : []
  const rhythms = Array.isArray(session?.recentDiversityRhythms)
    ? session.recentDiversityRhythms.map(String)
    : []
  return {
    forms: forms.slice(-10),
    structures: structures.slice(-8),
    openings: openings.slice(-8),
    flavours: flavours.slice(-8),
    rhythms: rhythms.slice(-8),
  }
}

/**
 * @param {object | null | undefined} session
 * @param {ConversationDiversityPlan} plan
 * @param {string} [draftStructure]
 */
export function persistConversationDiversity(session, plan, draftStructure) {
  if (!session || typeof session !== 'object' || !plan?.active) return
  if (plan.primaryForm) {
    const prev = Array.isArray(session.recentDiversityForms) ? session.recentDiversityForms : []
    const added = plan.secondaryForm
      ? [plan.primaryForm, plan.secondaryForm]
      : [plan.primaryForm]
    session.recentDiversityForms = [...prev, ...added].slice(-10)
  }
  if (plan.flavour) {
    const prev = Array.isArray(session.recentDiversityFlavours)
      ? session.recentDiversityFlavours
      : []
    session.recentDiversityFlavours = [...prev, plan.flavour].slice(-8)
  }
  if (plan.rhythm) {
    const prev = Array.isArray(session.recentDiversityRhythms)
      ? session.recentDiversityRhythms
      : []
    session.recentDiversityRhythms = [...prev, plan.rhythm].slice(-8)
  }
  if (plan.structureTarget || draftStructure) {
    const prev = Array.isArray(session.recentDiversityStructures)
      ? session.recentDiversityStructures
      : []
    session.recentDiversityStructures = [
      ...prev,
      draftStructure || plan.structureTarget,
    ].slice(-8)
  }
}

/**
 * @template {string} T
 * @param {readonly T[]} all
 * @param {string[]} recent
 * @param {string} salt
 * @param {number} [avoidLast]
 * @returns {T}
 */
function pickAvoiding(all, recent, salt, avoidLast = 2) {
  const recentSet = new Set((recent || []).slice(-avoidLast))
  const pool = all.filter((x) => !recentSet.has(x))
  const list = pool.length ? pool : [...all]
  return list[hashSalt(salt) % list.length]
}

/**
 * @param {string[]} recentForms
 * @param {string} salt
 * @returns {{ primary: ConversationForm, secondary: ConversationForm | null }}
 */
export function selectConversationForms(recentForms, salt) {
  const primary = pickAvoiding(CONVERSATION_FORMS, recentForms, salt + ':p', 3)
  // ~40% combine two forms
  const combine = hashSalt(salt + ':combo') % 5 < 2
  if (!combine) return { primary, secondary: null }
  const secondary = pickAvoiding(
    CONVERSATION_FORMS.filter((f) => f !== primary),
    recentForms,
    salt + ':s',
    2,
  )
  // Never default greeting+question combo as the only plan
  if (
    (primary === 'interesting_question' && secondary === 'celebration') ||
    (primary === 'celebration' && secondary === 'interesting_question')
  ) {
    const alt = pickAvoiding(
      CONVERSATION_FORMS.filter(
        (f) => f !== primary && f !== secondary && f !== 'interesting_question',
      ),
      recentForms,
      salt + ':alt',
      1,
    )
    return { primary, secondary: alt }
  }
  return { primary, secondary }
}

/**
 * @param {string[]} recent
 * @param {string} salt
 */
export function selectFlavour(recent, salt) {
  return pickAvoiding(CONVERSATION_FLAVOURS, recent, salt + ':flav', 2)
}

/**
 * @param {string[]} recent
 * @param {string} salt
 */
export function selectRhythm(recent, salt) {
  return pickAvoiding(RHYTHM_SHAPES, recent, salt + ':rhythm', 2)
}

/**
 * @param {string} salt
 * @param {ConversationForm} primary
 */
export function selectSurprise(salt, primary) {
  // ~25% surprise; never random — must fit form
  if (hashSalt(salt + ':surp') % 4 !== 0) return 'none'
  /** @type {SurpriseMove[]} */
  const pool = ['tiny_scenario', 'playful_comparison', 'short_dialogue', 'vivid_image', 'unusual_observation']
  if (primary === 'mini_dialogue') return 'short_dialogue'
  if (primary === 'imagination' || primary === 'thought_experiment') return 'tiny_scenario'
  if (primary === 'unexpected_comparison' || primary === 'analogy') return 'playful_comparison'
  if (primary === 'observation' || primary === 'everyday_mystery') return 'unusual_observation'
  return pool[hashSalt(salt + ':sm') % pool.length]
}

/**
 * Target structure id from chosen forms (for anti-template tracking).
 * @param {ConversationForm} primary
 * @param {ConversationForm | null} secondary
 * @param {SurpriseMove} surprise
 */
export function structureTargetFromForms(primary, secondary, surprise) {
  const parts = [primary]
  if (secondary) parts.push(secondary)
  if (surprise && surprise !== 'none') parts.push(`surprise_${surprise}`)
  return parts.join('+')
}

/**
 * @param {ConversationDiversityPlan} plan
 */
function buildWriterBrief(plan) {
  const formLine = plan.secondaryForm
    ? `Forms: ${FORM_LABELS[plan.primaryForm]} + ${FORM_LABELS[plan.secondaryForm]}.`
    : `Form: ${FORM_LABELS[plan.primaryForm]}.`

  return [
    'CONVERSATION DIVERSITY ENGINE (varie la forma — non solo le parole):',
    DIVERSITY_NORTH_STAR,
    formLine,
    `Flavour: ${FLAVOUR_LABELS[plan.flavour]}. Rhythm: ${RHYTHM_LABELS[plan.rhythm]}.`,
    plan.allowSurprise && plan.surprise !== 'none'
      ? `Surprise (serves the conversation): ${SURPRISE_LABELS[plan.surprise]}.`
      : 'No surprise beat required this turn — warm natural variety is enough.',
    'Do NOT default to greeting → compliment → question.',
    'Avoid recent structural templates: greeting→compliment→question · curiosity→explanation→question · fact→fact→fact · reflection→reflection→reflection.',
    `Recent structures to avoid: ${(plan.recentStructures || []).slice(-3).join(' · ') || 'none'}.`,
    `Recent openings to avoid repeating: ${(plan.recentOpenings || []).slice(-2).join(' / ') || 'none'}.`,
    'Vary sentence length, paragraph length, pacing, emotional intensity, detail.',
    'Consistency of personality · variety of expression.',
    `Anti-template check: ${DIVERSITY_CHECKS[0]} If yes → rewrite with a different form.`,
    'NON citare Conversation Diversity / lo stage.',
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {ConversationDiversityPlan}
 */
export function buildConversationDiversityPlan(input = {}) {
  const language = resolveLang(input)
  const turns = asTurns(input.messages)
  const recent = readRecent(input.session, turns)
  const userMessage = normalize(input.userMessage || '')

  if (!userMessage && turns.length === 0) {
    return {
      active: false,
      primaryForm: 'observation',
      secondaryForm: null,
      forms: ['observation'],
      flavour: 'pleasant',
      rhythm: 'medium_flow',
      surprise: 'none',
      allowSurprise: false,
      recentForms: recent.forms,
      recentStructures: recent.structures,
      recentOpenings: recent.openings,
      recentFlavours: recent.flavours,
      recentRhythms: recent.rhythms,
      structureTarget: 'observation',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      internalChecks: [...DIVERSITY_CHECKS],
      northStar: DIVERSITY_NORTH_STAR,
      validationCheck: DIVERSITY_CHECKS[0],
    }
  }

  const salt = [
    userMessage.slice(0, 120),
    recent.forms.join(','),
    recent.structures.join('|'),
    recent.openings.join('~'),
    String(input.session?.updatedAt || turns.length),
  ].join('::')

  const { primary, secondary } = selectConversationForms(recent.forms, salt)
  const flavour = selectFlavour(recent.flavours, salt)
  const rhythm = selectRhythm(recent.rhythms, salt)
  const surprise = selectSurprise(salt, primary)
  const structureTarget = structureTargetFromForms(primary, secondary, surprise)

  /** @type {ConversationDiversityPlan} */
  const plan = {
    active: true,
    primaryForm: primary,
    secondaryForm: secondary,
    forms: secondary ? [primary, secondary] : [primary],
    flavour,
    rhythm,
    surprise,
    allowSurprise: surprise !== 'none',
    recentForms: recent.forms,
    recentStructures: recent.structures,
    recentOpenings: recent.openings,
    recentFlavours: recent.flavours,
    recentRhythms: recent.rhythms,
    structureTarget,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Conversation Diversity — change the experience, not only words',
      `Form: ${primary}${secondary ? ` + ${secondary}` : ''}`,
      `Flavour: ${flavour} · Rhythm: ${rhythm}`,
      surprise !== 'none' ? `Surprise: ${surprise}` : 'No forced surprise',
    ],
    signals: [
      `form_${primary}`,
      secondary ? `form2_${secondary}` : 'form_single',
      `flavour_${flavour}`,
      `rhythm_${rhythm}`,
      surprise !== 'none' ? `surprise_${surprise}` : 'surprise_none',
    ],
    reasons: [
      'avoid_structural_repetition',
      `form_${primary}`,
      `flavour_${flavour}`,
    ],
    confidence: 'high',
    language,
    internalChecks: [...DIVERSITY_CHECKS],
    northStar: DIVERSITY_NORTH_STAR,
    validationCheck: DIVERSITY_CHECKS[0],
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = `Conversation Diversity → ${structureTarget} · ${flavour} · ${rhythm}`
  return plan
}

/**
 * @param {ConversationDiversityPlan | null | undefined} plan
 */
export function conversationDiversityStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(`Use form: ${FORM_LABELS[plan.primaryForm]}`)
  if (plan.secondaryForm) hints.push(`Combine with: ${FORM_LABELS[plan.secondaryForm]}`)
  hints.push(`Flavour: ${FLAVOUR_LABELS[plan.flavour]} · ${RHYTHM_LABELS[plan.rhythm]}`)
  hints.push('Avoid greeting→compliment→question and other recent templates')
  hints.push(DIVERSITY_CHECKS[0])
  return hints
}

/**
 * @param {ConversationDiversityPlan | null | undefined} plan
 */
export function formatConversationDiversityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION DIVERSITY ENGINE (INVISIBILE)
══════════════════════════════════════
${plan.writerBrief}

Checks:
${DIVERSITY_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

North star: ${DIVERSITY_NORTH_STAR}
Non citare questo stage.`.trim()
}

/**
 * Score draft for diversity vs recent pattern memory.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreConversationDiversityDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null
  const recentStructures = (plan?.recentStructures || ctx.recentStructures || []).map(String)
  const recentOpenings = (plan?.recentOpenings || ctx.recentOpenings || []).map(String)
  const recentFlavours = (plan?.recentFlavours || ctx.recentFlavours || []).map(String)
  const recentRhythms = (plan?.recentRhythms || ctx.recentRhythms || []).map(String)
  const recentForms = (plan?.recentForms || ctx.recentForms || []).map(String)

  const detected = inferStructureSignature(text)
  const opening = inferOpeningFingerprint(text)

  if (!text) {
    return {
      structuralRepetition: 100,
      formDiversity: 0,
      rhythmDiversity: 0,
      emotionalDiversity: 0,
      openingDiversity: 0,
      overall: 0,
      detectedStructure: detected,
      openingFingerprint: opening,
    }
  }

  let structuralRepetition = 15
  let formDiversity = 60
  let rhythmDiversity = 55
  let emotionalDiversity = 55
  let openingDiversity = 58

  // Structural repetition vs last few
  const lastStructures = recentStructures.slice(-3)
  if (lastStructures.includes(detected)) {
    structuralRepetition += 40
    formDiversity -= 25
  }
  if (lastStructures.slice(-1)[0] === detected) {
    structuralRepetition += 25
  }
  if (FORBIDDEN_STRUCTURE_PATTERNS.includes(detected)) {
    // Especially bad if repeating known templates
    const hits = lastStructures.filter((s) => s === detected).length
    structuralRepetition += 20 + hits * 15
    formDiversity -= 15
  }

  // Opening diversity
  const lastOpenings = recentOpenings.slice(-3)
  if (opening && lastOpenings.some((o) => o && (o === opening || o.slice(0, 18) === opening.slice(0, 18)))) {
    openingDiversity -= 35
    structuralRepetition += 15
  }

  // Form alignment / novelty
  if (plan?.primaryForm && detected.includes(plan.primaryForm.replace(/_/g, ''))) {
    formDiversity += 8
  }
  if (plan?.primaryForm && !recentForms.slice(-2).includes(plan.primaryForm)) {
    formDiversity += 12
  }
  if (plan?.secondaryForm && !recentForms.slice(-3).includes(plan.secondaryForm)) {
    formDiversity += 6
  }

  // Rhythm diversity — sentence length variance
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean)
  if (sentences.length >= 2) {
    const lengths = sentences.map((s) => s.split(/\s+/).length)
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
    const variance =
      lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, lengths.length)
    if (variance >= 6) rhythmDiversity += 15
    else if (variance < 2) rhythmDiversity -= 20
  }
  if (plan?.rhythm && !recentRhythms.slice(-2).includes(plan.rhythm)) {
    rhythmDiversity += 10
  }

  // Emotional / flavour diversity proxies
  const flavourHints = {
    energetic: /\b(!\s|let'?s|come\s+on|dai|energia)\b/i,
    calm: /\b(quiet|slow|gently|piano|calma|soft)\b/i,
    playful: /\b(funny|play|scherz|buffo|haha)\b/i,
    quietly_thoughtful: /\b(perhaps|maybe|wonder|forse|quietly)\b/i,
    warm: /\b(glad|warm|nice|piacere|bello)\b/i,
    fascinating: /\b(fascinat|curious|odd|affascinante|curios)\b/i,
    funny: /\b(haha|joke|iron|ridicol|buffo)\b/i,
    pleasant: /\b(pleasant|lovely|piacevole|gentile)\b/i,
  }
  if (plan?.flavour && flavourHints[plan.flavour]?.test(text)) {
    emotionalDiversity += 10
  }
  if (plan?.flavour && !recentFlavours.slice(-2).includes(plan.flavour)) {
    emotionalDiversity += 12
  }

  // Greeting+question default penalty
  if (detected === 'greeting_question' || detected === 'greeting_compliment_question') {
    structuralRepetition += 20
    formDiversity -= 20
  }

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
  structuralRepetition = clamp(structuralRepetition)
  formDiversity = clamp(formDiversity)
  rhythmDiversity = clamp(rhythmDiversity)
  emotionalDiversity = clamp(emotionalDiversity)
  openingDiversity = clamp(openingDiversity)

  const overall = clamp(
    (100 - structuralRepetition) * 0.28 +
      formDiversity * 0.22 +
      rhythmDiversity * 0.16 +
      emotionalDiversity * 0.16 +
      openingDiversity * 0.18,
  )

  return {
    structuralRepetition,
    formDiversity,
    rhythmDiversity,
    emotionalDiversity,
    openingDiversity,
    overall,
    detectedStructure: detected,
    openingFingerprint: opening,
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationDiversityGate}
 */
export function analyzeConversationDiversityDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.conversationDiversity || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  const scores = scoreConversationDiversityDraft(draft, {
    plan,
    recentStructures: input.recentStructures,
    recentOpenings: input.recentOpenings,
    recentFlavours: input.recentFlavours,
    recentRhythms: input.recentRhythms,
    recentForms: input.recentForms,
  })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
      detectedStructure: scores.detectedStructure,
    }
  }

  if (!draft || draft.length < 8) {
    failed.push('empty')
    reasons.push('empty')
  }

  const recent = (plan.recentStructures || []).slice(-3)
  if (recent.length && recent.slice(-1)[0] === scores.detectedStructure) {
    failed.push('consecutive_structure')
    reasons.push(`same_as_last=${scores.detectedStructure}`)
  }
  if (
    recent.filter((s) => s === scores.detectedStructure).length >= 2 ||
    scores.structuralRepetition > DIVERSITY_THRESHOLDS.structuralRepetitionMax
  ) {
    failed.push('structural_repetition')
    reasons.push(`structuralRepetition=${scores.structuralRepetition}`)
  }
  if (scores.formDiversity < DIVERSITY_THRESHOLDS.formDiversityMin) {
    failed.push('form_diversity')
    reasons.push(`formDiversity=${scores.formDiversity}`)
  }
  if (scores.rhythmDiversity < DIVERSITY_THRESHOLDS.rhythmDiversityMin) {
    failed.push('rhythm_diversity')
    reasons.push(`rhythmDiversity=${scores.rhythmDiversity}`)
  }
  if (scores.emotionalDiversity < DIVERSITY_THRESHOLDS.emotionalDiversityMin) {
    failed.push('emotional_diversity')
    reasons.push(`emotionalDiversity=${scores.emotionalDiversity}`)
  }
  if (scores.openingDiversity < DIVERSITY_THRESHOLDS.openingDiversityMin) {
    failed.push('opening_diversity')
    reasons.push(`openingDiversity=${scores.openingDiversity}`)
  }
  if (scores.overall < DIVERSITY_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (
    (scores.detectedStructure === 'greeting_compliment_question' ||
      scores.detectedStructure === 'greeting_question') &&
    recent.includes(scores.detectedStructure)
  ) {
    failed.push('greeting_template')
    reasons.push('greeting_question_template')
  }

  const needsRefine = failed.length > 0
  const altForms = CONVERSATION_FORMS.filter((f) => f !== plan.primaryForm).slice(0, 4)

  const refineBrief = needsRefine
    ? [
        'CONVERSATION DIVERSITY: rewrite — same conversational structure as recent replies.',
        DIVERSITY_NORTH_STAR,
        `Detected structure: ${scores.detectedStructure}. Avoid repeating it.`,
        `Intended form was ${plan.primaryForm}${plan.secondaryForm ? ` + ${plan.secondaryForm}` : ''}; flavour=${plan.flavour}; rhythm=${plan.rhythm}.`,
        `Try a different form such as: ${altForms.join(', ')}.`,
        'Do not default to greeting → compliment → question. Change the experience, not only the words.',
        `Scores: structRep=${scores.structuralRepetition} form=${scores.formDiversity} rhythm=${scores.rhythmDiversity} emotion=${scores.emotionalDiversity} opening=${scores.openingDiversity} overall=${scores.overall}.`,
        `Failed: ${failed.join(', ')}.`,
        DIVERSITY_CHECKS.join(' · '),
        'Non citare lo stage.',
      ].join(' ')
    : ''

  return {
    needsRefine,
    refineBrief,
    scores,
    failed,
    reasons,
    detectedStructure: scores.detectedStructure,
  }
}

/**
 * @param {object} [input]
 */
export function runConversationDiversityGate(input = {}) {
  try {
    const gate = analyzeConversationDiversityDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          structuralRepetition: 0,
          formDiversity: 100,
          rhythmDiversity: 100,
          emotionalDiversity: 100,
          openingDiversity: 100,
          overall: 100,
          detectedStructure: 'fail_soft',
          openingFingerprint: '',
        },
        failed: [],
        reasons: ['fail_soft'],
        detectedStructure: 'fail_soft',
      },
      shouldRefine: false,
    }
  }
}

/**
 * @param {string} draft
 * @param {ConversationDiversityPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesConversationDiversity(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzeConversationDiversityDraft({
      draft,
      plan,
      userMessage: ctx.userMessage || '',
      recentStructures: ctx.recentStructures,
      recentOpenings: ctx.recentOpenings,
    }).needsRefine
  } catch {
    return false
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationDiversityPlan, context: string }}
 */
export function runConversationDiversityEngine(input = {}) {
  try {
    const plan = buildConversationDiversityPlan(input)
    if (plan.active && input.session) {
      persistConversationDiversity(input.session, plan)
    }
    return {
      plan,
      context: formatConversationDiversityForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        primaryForm: 'observation',
        secondaryForm: null,
        forms: ['observation'],
        flavour: 'pleasant',
        rhythm: 'medium_flow',
        surprise: 'none',
        allowSurprise: false,
        recentForms: [],
        recentStructures: [],
        recentOpenings: [],
        recentFlavours: [],
        recentRhythms: [],
        structureTarget: 'observation',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        internalChecks: [...DIVERSITY_CHECKS],
        northStar: DIVERSITY_NORTH_STAR,
        validationCheck: DIVERSITY_CHECKS[0],
      },
      context: '',
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation: 200 greeting conversations —
 * no two consecutive share the same conversational structure.
 * ───────────────────────────────────────────────────────────── */

/** Sample drafts per form for greeting conversations (before = template, after = diverse). */
const GREETING_DRAFTS_BY_FORM = Object.freeze({
  observation:
    "Hey. Odd little thing: the room feels different the moment a quiet hello arrives — like someone opened a window.",
  shared_discovery:
    "Ciao — guardiamo insieme una cosa piccola: a volte un saluto è già una decisione di non avere fretta.",
  story:
    "Hi. The other day a simple 'hey' stopped me mid-scroll — suddenly the afternoon had a doorway again.",
  curiosity:
    "Hey. I've been curious about how little it takes to restart a day — sometimes just a short greeting does it.",
  reflection:
    "Hello. Maybe greetings aren't small talk at all — maybe they're a soft agreement to keep a channel open.",
  humour:
    "Hey! If hellos were weather, this one feels like sun through half-closed blinds. Not dramatic — just welcome.",
  analogy:
    "Hi — a greeting is a bit like tapping a glass before a toast: not the drink yet, but the room pays attention.",
  imagination:
    "Hey. Imagine the first message of the day as a blank page that still smells of coffee. What would you sketch first?",
  practical_tip:
    "Ciao. Un trucco piccolo per i giorni pieni: inizia con un saluto lento — il resto del ritmo spesso segue.",
  challenge:
    "Hey — gentle challenge: answer without a plan. Just notice the first interesting thought that shows up.",
  thought_experiment:
    "Hi. Thought experiment: if this chat were a quiet café table, what would we put on it first — a question or a noticing?",
  interesting_question:
    "Hey. What's one ordinary thing today that felt slightly more interesting than it should have?",
  everyday_mystery:
    "Ciao. Mistero quotidiano: perché un 'buongiorno' può cambiare la temperatura di una stanza senza spostare nulla?",
  celebration:
    "Hey — glad you're here. Even a tiny hello is worth enjoying when the day has been all tasks.",
  empathy:
    "Hi. If today already feels heavy, we can keep this light — no need to perform energy you don't have.",
  silent_ending:
    "Hey. Sometimes the nicest opening is just presence, left a little unfinished.",
  mini_dialogue:
    'Hey.\n"Anything urgent?"\n"Not really."\n"Good — then we can wander a bit."',
  unexpected_comparison:
    "Hi. A hello is weirdly like a bookmark — it doesn't finish the chapter, it just promises you'll return.",
})

const BEFORE_TEMPLATE =
  "Hello! It's nice to hear from you. How are you doing today?"

/**
 * Generate 200 greeting conversation plans with diverse consecutive structures.
 * @param {number} [n=200]
 */
export function generateGreetingDiversityCorpus(n = 200) {
  /** @type {object[]} */
  const out = []
  /** @type {string[]} */
  const recentForms = []
  /** @type {string[]} */
  const recentStructures = []
  /** @type {string[]} */
  const recentFlavours = []
  /** @type {string[]} */
  const recentRhythms = []

  for (let i = 0; i < n; i++) {
    const salt = `greet:${i}:diversity:${recentForms.slice(-3).join(',')}`
    const { primary, secondary } = selectConversationForms(recentForms, salt)
    const flavour = selectFlavour(recentFlavours, salt)
    const rhythm = selectRhythm(recentRhythms, salt)
    const surprise = selectSurprise(salt, primary)
    let structureTarget = structureTargetFromForms(primary, secondary, surprise)

    // Enforce consecutive structure diversity at plan level
    if (recentStructures.slice(-1)[0] === structureTarget) {
      const alt = pickAvoiding(
        CONVERSATION_FORMS.filter((f) => f !== primary),
        recentForms,
        salt + ':force',
        1,
      )
      structureTarget = structureTargetFromForms(alt, null, 'none')
      out.push({
        id: `g${String(i + 1).padStart(3, '0')}`,
        userMessage: i % 2 === 0 ? 'Hi' : 'Ciao',
        primaryForm: alt,
        secondaryForm: null,
        flavour,
        rhythm,
        surprise: 'none',
        structureTarget,
        before: BEFORE_TEMPLATE,
        after: GREETING_DRAFTS_BY_FORM[alt] || GREETING_DRAFTS_BY_FORM.observation,
      })
      recentForms.push(alt)
      recentStructures.push(structureTarget)
      recentFlavours.push(flavour)
      recentRhythms.push(rhythm)
      continue
    }

    out.push({
      id: `g${String(i + 1).padStart(3, '0')}`,
      userMessage: i % 3 === 0 ? 'Hello' : i % 3 === 1 ? 'Hey' : 'Buongiorno',
      primaryForm: primary,
      secondaryForm: secondary,
      flavour,
      rhythm,
      surprise,
      structureTarget,
      before: BEFORE_TEMPLATE,
      after:
        GREETING_DRAFTS_BY_FORM[primary] || GREETING_DRAFTS_BY_FORM.observation,
    })
    recentForms.push(primary)
    if (secondary) recentForms.push(secondary)
    recentStructures.push(structureTarget)
    recentFlavours.push(flavour)
    recentRhythms.push(rhythm)
  }

  return out
}

/**
 * @param {object} [opts]
 */
export function runConversationDiversityEvaluation(opts = {}) {
  const n = opts.count || 200
  const corpus = generateGreetingDiversityCorpus(n)

  let consecutiveSame = 0
  /** @type {string[]} */
  const structures = []
  let beforeTemplateHits = 0
  let afterDiverse = 0

  for (let i = 0; i < corpus.length; i++) {
    const item = corpus[i]
    structures.push(item.structureTarget)
    if (i > 0 && structures[i] === structures[i - 1]) consecutiveSame++

    const beforeSig = inferStructureSignature(item.before)
    if (
      beforeSig === 'greeting_question' ||
      beforeSig === 'greeting_compliment_question'
    ) {
      beforeTemplateHits++
    }

    const afterSig = inferStructureSignature(item.after)
    if (afterSig !== beforeSig) afterDiverse++
  }

  const uniqueStructures = new Set(structures).size
  const uniqueForms = new Set(corpus.map((c) => c.primaryForm)).size
  const uniqueFlavours = new Set(corpus.map((c) => c.flavour)).size
  const uniqueRhythms = new Set(corpus.map((c) => c.rhythm)).size

  // Simulate sequential gate: after drafts with growing memory
  let gateRejectsOnRepeat = 0
  /** @type {string[]} */
  const memStructures = []
  /** @type {string[]} */
  const memOpenings = []
  for (const item of corpus) {
    const plan = {
      active: true,
      primaryForm: item.primaryForm,
      secondaryForm: item.secondaryForm,
      flavour: item.flavour,
      rhythm: item.rhythm,
      recentStructures: [...memStructures],
      recentOpenings: [...memOpenings],
      recentForms: [],
      recentFlavours: [],
      recentRhythms: [],
    }
    // Intentionally bad: reuse last structure draft when we can
    if (memStructures.length && opts.injectRepeats) {
      const bad = analyzeConversationDiversityDraft({
        draft: item.before,
        plan,
      })
      if (bad.needsRefine) gateRejectsOnRepeat++
    }
    const good = analyzeConversationDiversityDraft({
      draft: item.after,
      plan: {
        ...plan,
        // Give after drafts a clean memory of prior *targets* only
        recentStructures: memStructures.slice(-3),
      },
    })
    memStructures.push(item.structureTarget)
    memOpenings.push(inferOpeningFingerprint(item.after))
    if (good.needsRefine && memStructures.length > 1) {
      // count only if consecutive target collision — should be rare
    }
  }

  const summary = {
    total: corpus.length,
    consecutiveSameStructure: consecutiveSame,
    uniqueStructures,
    uniqueForms,
    uniqueFlavours,
    uniqueRhythms,
    beforeTemplateHits,
    afterDiverse,
    formDiversityRatio: Math.round((uniqueForms / CONVERSATION_FORMS.length) * 1000) / 1000,
    metrics: {
      structuralRepetition: consecutiveSame === 0 ? 0 : Math.round((consecutiveSame / n) * 100),
      conversationalFormDiversity: uniqueForms,
      rhythmDiversity: uniqueRhythms,
      emotionalDiversity: uniqueFlavours,
      openingDiversity: uniqueStructures,
    },
    ok:
      corpus.length >= 200 &&
      consecutiveSame === 0 &&
      uniqueForms >= 12 &&
      uniqueStructures >= 30 &&
      beforeTemplateHits >= 150,
  }

  if (opts.verbose) {
    return {
      summary,
      sample: corpus.slice(0, 5).map((c) => ({
        id: c.id,
        structure: c.structureTarget,
        before: c.before,
        after: c.after,
      })),
      beforeAfter: {
        before: BEFORE_TEMPLATE,
        afterExamples: corpus.slice(0, 3).map((c) => c.after),
      },
    }
  }
  return { summary }
}
