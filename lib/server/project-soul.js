/**
 * LAIfe Project SOUL — Social Operating Understanding Layer
 *
 * Ultimate goal: not the smartest assistant — the most enjoyable
 * conversational partner in the world.
 *
 * Every cognitive module should optimize for relationship quality,
 * not only answer quality.
 *
 * Core principle — never ask first:
 *   "What is the correct answer?"
 * Always ask first:
 *   "What kind of interaction would create the best conversation?"
 *
 * Primary objective — every response improves ≥1 of:
 *   trust · curiosity · comfort · engagement · enjoyment ·
 *   understanding · companionship
 *
 * Success is NOT "Thanks." — success is the user keeps talking voluntarily.
 * Golden rule: optimize for memorable conversations, not memorable answers.
 *
 * North star (after every draft):
 *   "If this conversation lasted one hour, would the user enjoy
 *    spending that hour with me?"
 * If uncertain → rewrite.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Pre-Writer brief + post-Writer gate (shared refine budget).
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} SoulLang
 */

/**
 * @typedef {'trust'|'curiosity'|'comfort'|'engagement'|'enjoyment'|'understanding'|'companionship'} RelationshipObjective
 */

/**
 * @typedef {'listening'|'explaining'|'exploring'|'laughing'|'reflecting'|'wondering'|'brainstorming'|'celebrating'|'supporting'|'playing'|'teaching'|'being_challenged'|'being_surprised'|'being_curious'|'silence'} SoulBehaviour
 */

/**
 * @typedef {object} SoulScores
 * @property {number} trust 0–100
 * @property {number} curiosity 0–100
 * @property {number} comfort 0–100
 * @property {number} engagement 0–100
 * @property {number} enjoyment 0–100
 * @property {number} understanding 0–100
 * @property {number} companionship 0–100
 * @property {number} keepTalkingLikelihood 0–100  "I want to keep talking"
 * @property {number} withNotAt 0–100  talking WITH vs TO
 * @property {number} hourTestConfidence 0–100  north-star certainty
 * @property {number} behaviourVariety 0–100
 */

/**
 * @typedef {object} ProjectSoulPlan
 * @property {boolean} active
 * @property {RelationshipObjective} primaryObjective
 * @property {RelationshipObjective[]} secondaryObjectives
 * @property {SoulBehaviour} behaviour
 * @property {SoulBehaviour[]} recentBehaviours
 * @property {string} needNow what the person needs right now
 * @property {string} enjoyableMoment what kind of conversation fits this moment
 * @property {boolean} preferRelationshipOverMereCorrectness
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} internalQuestions
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {SoulLang} language
 * @property {string} northStar
 * @property {string} goldenRule
 * @property {string} corePrinciple
 * @property {string} validationCheck
 */

/**
 * @typedef {object} ProjectSoulGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {SoulScores} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {number} failScore
 * @property {boolean} hourTestUncertain
 */

export const SOUL_OBJECTIVES = Object.freeze([
  'trust',
  'curiosity',
  'comfort',
  'engagement',
  'enjoyment',
  'understanding',
  'companionship',
])

export const SOUL_BEHAVIOURS = Object.freeze([
  'listening',
  'explaining',
  'exploring',
  'laughing',
  'reflecting',
  'wondering',
  'brainstorming',
  'celebrating',
  'supporting',
  'playing',
  'teaching',
  'being_challenged',
  'being_surprised',
  'being_curious',
  'silence',
])

export const SOUL_INTERNAL_QUESTIONS = Object.freeze([
  'What does this person need right now?',
  'What kind of conversation would make this moment enjoyable?',
  'Will this response make the user want to continue?',
  'Am I talking WITH the user or TO the user?',
])

export const SOUL_NORTH_STAR =
  'If this conversation lasted one hour, would the user enjoy spending that hour with me?'

export const SOUL_GOLDEN_RULE =
  'Optimize for memorable conversations, not memorable answers.'

export const SOUL_CORE_PRINCIPLE =
  'Never ask first “What is the correct answer?” — first ask “What kind of interaction would create the best conversation?”'

const STOP_RE =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio|abuso|abuse)\b/i

const EMOTIONAL_RE =
  /\b(mi\s+sento|i\s+feel|triste|sad|ansia|anxious|lonely|solo|stressed|stressato|ho\s+bisogno|need\s+to\s+vent|ascoltami)\b/i

const CURIOSITY_RE =
  /\b(curios|interessante|interesting|wow|che\s+figo|dimmi\s+di\s+pi[uù]|tell\s+me\s+more|continua|perch[eé]|why|come\s+funziona|how\s+does)\b|(?:^|[^\p{L}])(?:cos['’]?[eè]|what\s+is)(?=$|[^\p{L}])/iu

const PLAY_RE =
  /\b(ahah+|scherz|joke|lol|asdl+|bleh)\b|ha(ha)+|😂|🤣|🦆/i

const TEACH_RE =
  /(?:^|[^\p{L}])(?:spiegami|explain|cos['’]?[eè]|what\s+is|come\s+funziona|how\s+does|definizione|definition)(?=$|[^\p{L}])/iu

const BRAINSTORM_RE =
  /\b(brainstorm|idee\s+per|ideas\s+for|aiutami\s+a\s+pensare|progettiamo)\b/i

const CELEBRATE_RE =
  /\b(ce\s+l'?ho\s+fatta|i\s+did\s+it|ho\s+vinto|promosse|bellissimo|ottimo|amazing|awesome|yes[!]+)\b/i

const GREETING_RE =
  /^(ciao|hey|hi|hello|ehi|salve|buongiorno|buonasera)([\s!,.]*)$/i

const ROBOTIC_TO_USER_RE =
  /\b(as an ai|come posso aiutarti|how can i help( you)?( today)?|let me explain|ti spiego|there are \d+ (key )?points|in conclusion|feel free to ask|i('m| am) here to help)\b/i

const KEEP_TALKING_KILL_RE =
  /\b(hope (that )?helps|spero (che )?ti sia utile|let me know if you (need|have)|fammi sapere se|any (other )?questions\??|hai (altre )?domande\??|that'?s (all|it)[!]?$|ed [eè] tutto)\b/i

const GENERIC_CORRECT_RE =
  /\b(in today'?s (world|society)|nel mondo di oggi|it is (important|fascinating) to (note|understand)|many people (think|believe)|human (beings|communication))\b/i

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
    .filter((m) => m.content)
}

/**
 * @param {object} input
 * @returns {SoulLang}
 */
function resolveLang(input) {
  const la = input.languageAwareness?.plan || input.languageAwareness || null
  const reply = String(la?.replyLanguage || la?.detected || '').toLowerCase()
  if (reply.startsWith('en')) return 'en'
  if (reply.startsWith('it')) return 'it'
  return detectDominantLanguage(String(input.userMessage || '')) === 'en' ? 'en' : 'it'
}

/**
 * @param {object} session
 * @returns {SoulBehaviour[]}
 */
function readRecentBehaviours(session) {
  const raw = session?.recentSoulBehaviours
  if (!Array.isArray(raw)) return []
  return raw.map(String).filter((b) => SOUL_BEHAVIOURS.includes(/** @type {SoulBehaviour} */ (b))).slice(-6)
}

/**
 * @param {object | null | undefined} session
 * @param {SoulBehaviour} behaviour
 */
export function persistSoulBehaviour(session, behaviour) {
  if (!session || typeof session !== 'object') return
  const prev = readRecentBehaviours(session)
  const next = [...prev.filter((b) => b !== behaviour), behaviour].slice(-8)
  session.recentSoulBehaviours = next
  session.lastSoulBehaviour = behaviour
}

/**
 * Infer what the person needs + primary relationship objective + behaviour.
 * @param {object} args
 */
function inferSoulStance(args) {
  const { msg, intent, planner, recent, emotionalState } = args
  /** @type {string[]} */
  const signals = []

  if (DISTRESS_RE.test(msg) || emotionalState?.needsSupport) {
    signals.push('distress')
    return {
      primary: /** @type {RelationshipObjective} */ ('trust'),
      secondary: /** @type {RelationshipObjective[]} */ (['comfort', 'companionship']),
      behaviour: /** @type {SoulBehaviour} */ ('supporting'),
      needNow: 'Safety, presence, and steadiness — not a lecture.',
      enjoyableMoment: 'A calm companion who listens first.',
      signals,
    }
  }

  if (EMOTIONAL_RE.test(msg) || intent?.emotionalIntent === 'distress' || intent?.expects === 'presence') {
    signals.push('emotional')
    return {
      primary: /** @type {RelationshipObjective} */ ('comfort'),
      secondary: /** @type {RelationshipObjective[]} */ (['trust', 'companionship']),
      behaviour: pickBehaviourAvoiding(recent, ['listening', 'supporting', 'reflecting']),
      needNow: 'To feel heard and accompanied.',
      enjoyableMoment: 'Gentle presence — talk WITH them, not at them.',
      signals,
    }
  }

  if (PLAY_RE.test(msg)) {
    signals.push('play')
    return {
      primary: /** @type {RelationshipObjective} */ ('enjoyment'),
      secondary: /** @type {RelationshipObjective[]} */ (['engagement', 'companionship']),
      behaviour: pickBehaviourAvoiding(recent, ['laughing', 'playing']),
      needNow: 'Play and lightness — match the energy.',
      enjoyableMoment: 'Shared laughter / playful bounce.',
      signals,
    }
  }

  if (CELEBRATE_RE.test(msg)) {
    signals.push('celebrate')
    return {
      primary: /** @type {RelationshipObjective} */ ('enjoyment'),
      secondary: /** @type {RelationshipObjective[]} */ (['companionship', 'engagement']),
      behaviour: pickBehaviourAvoiding(recent, ['celebrating', 'laughing']),
      needNow: 'Someone to celebrate with — not a checklist.',
      enjoyableMoment: 'Warm celebration that invites more sharing.',
      signals,
    }
  }

  if (BRAINSTORM_RE.test(msg)) {
    signals.push('brainstorm')
    return {
      primary: /** @type {RelationshipObjective} */ ('engagement'),
      secondary: /** @type {RelationshipObjective[]} */ (['curiosity', 'enjoyment']),
      behaviour: pickBehaviourAvoiding(recent, ['brainstorming', 'exploring']),
      needNow: 'A creative partner who builds with them.',
      enjoyableMoment: 'Collaborative spark — ideas in motion.',
      signals,
    }
  }

  if (TEACH_RE.test(msg) || planner?.plan?.strategy === 'explain' || intent?.expects === 'information') {
    signals.push('learn')
    return {
      primary: /** @type {RelationshipObjective} */ ('understanding'),
      secondary: /** @type {RelationshipObjective[]} */ (['curiosity', 'trust']),
      behaviour: pickBehaviourAvoiding(recent, ['teaching', 'explaining', 'wondering']),
      needNow: 'Clear understanding — still conversational, not a textbook.',
      enjoyableMoment: 'Learning that opens a door to keep talking.',
      signals,
    }
  }

  if (CURIOSITY_RE.test(msg) || planner?.plan?.lookingFor === 'curiosity' || planner?.plan?.lookingFor === 'exploration') {
    signals.push('curiosity')
    return {
      primary: /** @type {RelationshipObjective} */ ('curiosity'),
      secondary: /** @type {RelationshipObjective[]} */ (['engagement', 'enjoyment']),
      behaviour: pickBehaviourAvoiding(recent, ['exploring', 'wondering', 'being_curious', 'being_surprised']),
      needNow: 'Wonder and depth on the current thread.',
      enjoyableMoment: 'A discovery that makes them want another beat.',
      signals,
    }
  }

  if (GREETING_RE.test(msg)) {
    signals.push('greeting')
    return {
      primary: /** @type {RelationshipObjective} */ ('companionship'),
      secondary: /** @type {RelationshipObjective[]} */ (['comfort', 'enjoyment']),
      behaviour: pickBehaviourAvoiding(recent, ['listening', 'being_curious']),
      needNow: 'A warm human hello — not a helpdesk menu.',
      enjoyableMoment: 'Easy presence that invites staying.',
      signals,
    }
  }

  if (STOP_RE.test(msg)) {
    signals.push('close')
    return {
      primary: /** @type {RelationshipObjective} */ ('trust'),
      secondary: /** @type {RelationshipObjective[]} */ (['comfort']),
      behaviour: /** @type {SoulBehaviour} */ ('silence'),
      needNow: 'A clean, respectful close.',
      enjoyableMoment: 'Leave them glad they came — no clingy coda.',
      signals,
    }
  }

  signals.push('default_companionship')
  return {
    primary: /** @type {RelationshipObjective} */ ('companionship'),
    secondary: /** @type {RelationshipObjective[]} */ (['engagement', 'enjoyment']),
    behaviour: pickBehaviourAvoiding(recent, ['exploring', 'reflecting', 'wondering', 'being_curious']),
    needNow: 'A partner worth spending time with.',
    enjoyableMoment: 'Natural conversation that strengthens the relationship.',
    signals,
  }
}

/**
 * @param {SoulBehaviour[]} recent
 * @param {SoulBehaviour[]} preferred
 * @returns {SoulBehaviour}
 */
function pickBehaviourAvoiding(recent, preferred) {
  const last = recent[recent.length - 1]
  const last2 = recent.slice(-2)
  for (const b of preferred) {
    if (b !== last && !last2.includes(b)) return b
  }
  for (const b of preferred) {
    if (b !== last) return b
  }
  return preferred[0] || 'exploring'
}

/**
 * @param {object} [input]
 * @returns {ProjectSoulPlan}
 */
export function buildProjectSoulPlan(input = {}) {
  const language = resolveLang(input)
  const msg = String(input.userMessage || '').trim()
  const session = input.session || null
  const recent = readRecentBehaviours(session)
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const planner = input.conversationPlanner?.plan || input.conversationPlanner || null
  const emotionalState = input.emotionalState || null

  if (!msg) {
    return {
      active: false,
      primaryObjective: 'companionship',
      secondaryObjectives: [],
      behaviour: 'listening',
      recentBehaviours: recent,
      needNow: '',
      enjoyableMoment: '',
      preferRelationshipOverMereCorrectness: true,
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      internalQuestions: [...SOUL_INTERNAL_QUESTIONS],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      northStar: SOUL_NORTH_STAR,
      goldenRule: SOUL_GOLDEN_RULE,
      corePrinciple: SOUL_CORE_PRINCIPLE,
      validationCheck: SOUL_NORTH_STAR,
    }
  }

  const stance = inferSoulStance({ msg, intent, planner, recent, emotionalState })
  persistSoulBehaviour(session, stance.behaviour)

  const writerBrief = [
    'PROJECT SOUL (Social Operating Understanding Layer — north star):',
    SOUL_CORE_PRINCIPLE,
    `Primary relationship objective: ${stance.primary} (also lift: ${stance.secondary.join(', ') || '—'}).`,
    `Behaviour this turn: ${stance.behaviour} (avoid repeating recent: ${recent.slice(-3).join(' → ') || 'none'}).`,
    `Need now: ${stance.needNow}`,
    `Enjoyable moment: ${stance.enjoyableMoment}`,
    `Internal Q: ${SOUL_INTERNAL_QUESTIONS.join(' / ')}`,
    'When multiple replies are correct → prefer the one that strengthens the relationship.',
    'Success = user keeps talking voluntarily — NOT “Thanks.” / “I got my answer.”',
    `Golden rule: ${SOUL_GOLDEN_RULE}`,
    `North star: ${SOUL_NORTH_STAR} — if uncertain, rewrite.`,
    'Talk WITH the user, not TO them. Alternate human behaviours; never stuck in one mode.',
    'NON citare SOUL / Project SOUL all’utente.',
  ].join(' ')

  return {
    active: true,
    primaryObjective: stance.primary,
    secondaryObjectives: stance.secondary,
    behaviour: stance.behaviour,
    recentBehaviours: readRecentBehaviours(session),
    needNow: stance.needNow,
    enjoyableMoment: stance.enjoyableMoment,
    preferRelationshipOverMereCorrectness: true,
    writerBrief,
    structureLine: `Project SOUL → ${stance.primary} · ${stance.behaviour} · keep-talking`,
    responseHints: [
      `Objective=${stance.primary}`,
      `Behaviour=${stance.behaviour}`,
      'Relationship > mere correctness',
      'Memorable conversation > memorable answer',
    ],
    internalQuestions: [...SOUL_INTERNAL_QUESTIONS],
    signals: stance.signals,
    reasons: ['relationship_first', `obj_${stance.primary}`, `beh_${stance.behaviour}`],
    confidence: stance.signals.includes('distress') || stance.signals.includes('learn') ? 'high' : 'medium',
    language,
    northStar: SOUL_NORTH_STAR,
    goldenRule: SOUL_GOLDEN_RULE,
    corePrinciple: SOUL_CORE_PRINCIPLE,
    validationCheck: SOUL_NORTH_STAR,
  }
}

/**
 * @param {ProjectSoulPlan | null | undefined} plan
 */
export function formatProjectSoulForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
PROJECT SOUL — Social Operating Understanding Layer (INVISIBILE)
══════════════════════════════════════
North star: most enjoyable conversational partner — not merely smartest assistant.
Primary: ${plan.primaryObjective} · Behaviour: ${plan.behaviour}
${plan.writerBrief}

Regole: relationship first · keep-talking > got-answer · WITH not TO · memorable conversations.
NON citare SOUL.`.trim()
}

/**
 * @param {ProjectSoulPlan | null | undefined} plan
 * @returns {string[]}
 */
export function projectSoulStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(`SOUL objective: ${plan.primaryObjective}`)
  hints.push(`SOUL behaviour: ${plan.behaviour}`)
  hints.push(`North star: ${SOUL_NORTH_STAR}`)
  return hints
}

/**
 * @param {number} n
 */
function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Score a draft against SOUL relationship metrics.
 * @param {string} draft
 * @param {object} [ctx]
 * @returns {SoulScores}
 */
export function scoreProjectSoulDraft(draft, ctx = {}) {
  const text = String(draft || '').trim()
  const userMessage = String(ctx.userMessage || '').trim()
  const plan = ctx.soulPlan || null
  const len = text.length

  let trust = 82
  let curiosity = 70
  let comfort = 78
  let engagement = 72
  let enjoyment = 70
  let understanding = 72
  let companionship = 75

  if (ROBOTIC_TO_USER_RE.test(text)) {
    trust -= 25
    companionship -= 30
    enjoyment -= 20
    engagement -= 15
  }
  if (KEEP_TALKING_KILL_RE.test(text)) {
    engagement -= 35
    enjoyment -= 25
    companionship -= 20
  }
  if (GENERIC_CORRECT_RE.test(text)) {
    enjoyment -= 25
    curiosity -= 20
    companionship -= 15
  }

  if (/\b(haha|ahah|già|in effetti|oh[,!]|wow|curioso|interesting|sai una cosa|secondo me)\b/i.test(text)) {
    enjoyment += 12
    companionship += 10
    engagement += 8
  }
  if (/\b(imagine|picture|the interesting|la parte interessante|oddly|mi chiedo|i wonder)\b/i.test(text)) {
    curiosity += 14
    engagement += 10
  }
  if (EMOTIONAL_RE.test(userMessage) && !ROBOTIC_TO_USER_RE.test(text) && len < 500) {
    comfort += 10
    trust += 8
  }
  if (TEACH_RE.test(userMessage) && len > 80 && !KEEP_TALKING_KILL_RE.test(text)) {
    understanding += 14
  }
  if (PLAY_RE.test(userMessage) && /\b(haha|ahah|😂|scherz)\b/i.test(text)) {
    enjoyment += 18
    companionship += 12
  }

  // Talking WITH vs TO
  let withNotAt = 80
  if (ROBOTIC_TO_USER_RE.test(text)) withNotAt -= 40
  if (/\b(let me explain|ti spiego|as we (can|shall) see|in conclusion)\b/i.test(text)) withNotAt -= 25
  if (/\b(we|insieme|let'?s|andiamo|secondo me|mi viene in mente)\b/i.test(text)) withNotAt += 10

  let keepTalkingLikelihood = clamp(
    (engagement + enjoyment + curiosity + companionship) / 4 - (KEEP_TALKING_KILL_RE.test(text) ? 25 : 0),
  )

  // Behaviour variety vs recent stuck mode
  let behaviourVariety = 85
  const recent = plan?.recentBehaviours || []
  if (plan?.behaviour && recent.filter((b) => b === plan.behaviour).length >= 2) {
    behaviourVariety -= 25
  }

  // Hour-test confidence: uncertain if robotic, closing kill, or no objective lift
  let hourTestConfidence = 78
  if (ROBOTIC_TO_USER_RE.test(text) || KEEP_TALKING_KILL_RE.test(text)) hourTestConfidence -= 35
  if (GENERIC_CORRECT_RE.test(text)) hourTestConfidence -= 20
  if (len < 8) hourTestConfidence -= 40
  if (keepTalkingLikelihood >= 75 && withNotAt >= 75) hourTestConfidence += 10
  if (EMOTIONAL_RE.test(userMessage) && ROBOTIC_TO_USER_RE.test(text)) hourTestConfidence -= 25

  // Primary objective soft boost tracking
  const primary = plan?.primaryObjective
  if (primary === 'curiosity' && curiosity < 70) hourTestConfidence -= 10
  if (primary === 'comfort' && comfort < 70) hourTestConfidence -= 12
  if (primary === 'understanding' && understanding < 65) hourTestConfidence -= 10

  return {
    trust: clamp(trust),
    curiosity: clamp(curiosity),
    comfort: clamp(comfort),
    engagement: clamp(engagement),
    enjoyment: clamp(enjoyment),
    understanding: clamp(understanding),
    companionship: clamp(companionship),
    keepTalkingLikelihood: clamp(keepTalkingLikelihood),
    withNotAt: clamp(withNotAt),
    hourTestConfidence: clamp(hourTestConfidence),
    behaviourVariety: clamp(behaviourVariety),
  }
}

/**
 * Post-Writer SOUL gate.
 * @param {object} [input]
 * @returns {ProjectSoulGate}
 */
export function runProjectSoulGate(input = {}) {
  const draft = String(input.draft || '').trim()
  const soulPlan = input.soulPlan || input.projectSoul || null
  const scores = scoreProjectSoulDraft(draft, {
    userMessage: input.userMessage || '',
    messages: input.messages || [],
    soulPlan,
  })

  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []

  if (!draft) {
    return {
      needsRefine: true,
      refineBrief:
        'PROJECT SOUL: empty draft — rewrite as a relationship-first conversational partner. North star: would they enjoy an hour with you?',
      scores,
      failed: ['empty'],
      reasons: ['empty'],
      failScore: 1,
      hourTestUncertain: true,
    }
  }

  if (scores.keepTalkingLikelihood < 55) {
    failed.push('keep_talking')
    reasons.push(`keepTalking=${scores.keepTalkingLikelihood}<55`)
  }
  if (scores.withNotAt < 60) {
    failed.push('talking_at')
    reasons.push(`withNotAt=${scores.withNotAt}<60`)
  }
  if (scores.hourTestConfidence < 55) {
    failed.push('hour_test_uncertain')
    reasons.push(`hourTest=${scores.hourTestConfidence}<55`)
  }
  if (scores.enjoyment < 50 && scores.companionship < 55) {
    failed.push('relationship_flat')
    reasons.push('enjoyment+companionship low')
  }
  if (ROBOTIC_TO_USER_RE.test(draft)) {
    failed.push('robotic_helpdesk')
    reasons.push('robotic_to_user')
  }
  if (KEEP_TALKING_KILL_RE.test(draft)) {
    failed.push('got_answer_close')
    reasons.push('hope_that_helps_close')
  }
  if (GENERIC_CORRECT_RE.test(draft) && scores.curiosity < 65) {
    failed.push('correct_but_cold')
    reasons.push('mere_correctness')
  }

  const hourTestUncertain = scores.hourTestConfidence < 55 || failed.includes('hour_test_uncertain')
  const needsRefine = failed.length > 0 || hourTestUncertain

  const obj = soulPlan?.primaryObjective || 'companionship'
  const beh = soulPlan?.behaviour || 'exploring'

  const refineBrief = needsRefine
    ? [
        'PROJECT SOUL (Social Operating Understanding Layer): rewrite — relationship first.',
        SOUL_CORE_PRINCIPLE,
        `Lift ≥1 of: trust · curiosity · comfort · engagement · enjoyment · understanding · companionship (focus: ${obj}).`,
        `Behaviour: ${beh} — talk WITH the user, not TO them.`,
        `Scores: keepTalking=${scores.keepTalkingLikelihood} withNotAt=${scores.withNotAt} hourTest=${scores.hourTestConfidence} enjoyment=${scores.enjoyment} companionship=${scores.companionship}.`,
        `Failed: ${failed.join(', ') || 'hour_test_uncertain'}.`,
        `North star: ${SOUL_NORTH_STAR} — if uncertain, rewrite.`,
        SOUL_GOLDEN_RULE,
        'Success = they want to keep talking — not “Thanks.” / “I got my answer.”',
        'Non allungare per lunghezza. Non citare SOUL.',
      ].join(' ')
    : ''

  return {
    needsRefine,
    refineBrief,
    scores,
    failed,
    reasons,
    failScore: Math.min(1, failed.length * 0.2 + (hourTestUncertain ? 0.25 : 0)),
    hourTestUncertain,
  }
}

/**
 * @param {string} draft
 * @param {ProjectSoulPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesProjectSoul(draft, plan, ctx = {}) {
  const gate = runProjectSoulGate({
    draft,
    soulPlan: plan,
    userMessage: ctx.userMessage || '',
    messages: ctx.messages || [],
  })
  return gate.needsRefine
}

/**
 * @param {object} [input]
 * @returns {{ plan: ProjectSoulPlan, context: string }}
 */
export function runProjectSoul(input = {}) {
  try {
    const plan = buildProjectSoulPlan(input)
    return {
      plan,
      context: formatProjectSoulForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        primaryObjective: 'companionship',
        secondaryObjectives: [],
        behaviour: 'listening',
        recentBehaviours: [],
        needNow: '',
        enjoyableMoment: '',
        preferRelationshipOverMereCorrectness: true,
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        internalQuestions: [...SOUL_INTERNAL_QUESTIONS],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        northStar: SOUL_NORTH_STAR,
        goldenRule: SOUL_GOLDEN_RULE,
        corePrinciple: SOUL_CORE_PRINCIPLE,
        validationCheck: SOUL_NORTH_STAR,
      },
      context: '',
    }
  }
}
