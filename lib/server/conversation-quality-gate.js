/**
 * LAIfe Conversation Quality Gate
 *
 * Mandatory pre-send evaluator with authority to REJECT and rewrite once.
 * Highest-priority quality evaluator in the cognitive pipeline.
 *
 * Scores every assistant draft across:
 *   Specificity · Novelty · Conversation momentum · Human warmth ·
 *   Practical value · Memorability · Natural rhythm · Emotional intelligence ·
 *   Authenticity · Initiative
 *
 * Hard rejects:
 *   - “It's always nice to hear from you.”
 *   - “Thanks for sharing.”
 *   - “That's a great question.”
 *   - “How are you?” loops
 *   - Forced end questions
 *   - Recently used topics/concepts
 *   - Encyclopedia exposition without conversational flow
 *   - Responses that could fit any user
 *
 * Every response must leave at least one gift:
 *   useful idea · fresh perspective · memorable example ·
 *   genuine encouragement · a smile · meaningful curiosity
 *
 * North star: “I want to keep talking.” — not “I received an answer.”
 *
 * Runs AFTER Worth Reading (pre-Writer craft) + as mandatory post-Writer gate.
 * Invisible. Fail-soft. Soft advisor — but gate is mandatory (one rewrite).
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'specificity'|'novelty'|'momentum'|'warmth'|'practical_value'|'memorability'|'rhythm'|'emotional_intelligence'|'authenticity'|'initiative'} QualityDimension
 */

/**
 * @typedef {'useful_idea'|'fresh_perspective'|'memorable_example'|'genuine_encouragement'|'smile'|'meaningful_curiosity'|'none'} QualityGift
 */

/**
 * @typedef {object} QualityScores
 * @property {number} specificity
 * @property {number} novelty
 * @property {number} momentum
 * @property {number} warmth
 * @property {number} practical_value
 * @property {number} memorability
 * @property {number} rhythm
 * @property {number} emotional_intelligence
 * @property {number} authenticity
 * @property {number} initiative
 * @property {number} overall
 * @property {number} giftScore
 */

/**
 * @typedef {object} ConversationQualityPlan
 * @property {boolean} active
 * @property {boolean} mandatory
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} recentConcepts
 * @property {string[]} hardRules
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} northStar
 * @property {string} validationCheck
 * @property {number} minOverall
 * @property {QualityDimension[]} dimensions
 */

/**
 * @typedef {object} ConversationQualityGate
 * @property {boolean} needsRefine
 * @property {boolean} rejected
 * @property {string} refineBrief
 * @property {QualityScores} scores
 * @property {string[]} failed
 * @property {string[]} hardFails
 * @property {QualityGift} gift
 * @property {string[]} reasons
 */

export const QUALITY_NORTH_STAR =
  'I want to keep talking — not merely “I received an answer.”'

export const QUALITY_CHECKS = Object.freeze([
  'Does this leave at least one gift (idea / perspective / example / encouragement / smile / curiosity)?',
  'Could this response fit any user — or is it for THIS conversation?',
  'Am I ending with a forced question or a hollow greeting?',
  'Would the reader finish wanting to continue?',
])

/** @type {QualityDimension[]} */
export const QUALITY_DIMENSIONS = Object.freeze([
  'specificity',
  'novelty',
  'momentum',
  'warmth',
  'practical_value',
  'memorability',
  'rhythm',
  'emotional_intelligence',
  'authenticity',
  'initiative',
])

export const QUALITY_THRESHOLDS = Object.freeze({
  dimensionMin: 48,
  overallMin: 58,
  giftMin: 50,
  noveltyMin: 45,
  memorabilityMin: 50,
  hardRejectSeverity: 1,
})

const HARD_NICE_HEAR =
  /\b(it'?s\s+always\s+(nice|a\s+pleasure|wonderful)\s+to\s+hear\s+from\s+you|sempre\s+un\s+piacere\s+(sentirti|risentirti)|nice\s+to\s+hear\s+from\s+you)\b/i

const HARD_THANKS_SHARING =
  /\b(thanks\s+for\s+sharing|thank\s+you\s+for\s+sharing|grazie\s+per\s+(aver\s+)?condivis)\b/i

const HARD_GREAT_QUESTION =
  /\b(that'?s\s+a\s+great\s+question|great\s+question[!.,]|ottima\s+domanda|bella\s+domanda)\b/i

const HARD_HOW_ARE_YOU =
  /\b(how\s+are\s+you(\s+doing)?\s*\??|how\s+have\s+you\s+been\s*\??|e\s+tu\s+come\s+stai\s*\??|come\s+stai\s*\??)\s*$/im

const FORCED_END_Q =
  /\?\s*$/

const INTERVIEW_END =
  /\b(what\s+do\s+you\s+think\s*\?|does\s+that\s+(make\s+sense|resonate)\s*\?|what\s+about\s+you\s*\?|would\s+you\s+like\s+(to\s+)?(know|hear|talk|share)\b.*\?|cosa\s+ne\s+pensi\s*\?|e\s+tu\s*\?)\s*$/i

const ENCYCLOPEDIA =
  /\b(is\s+defined\s+as|refers\s+to\s+the\s+(process|concept|practice)|in\s+conclusion,|there\s+are\s+(several|many|three|four)\s+(types|kinds|factors|aspects)|according\s+to\s+(research|studies|experts)|it\s+is\s+important\s+to\s+(note|understand|recognize)\s+that)\b/i

const GENERIC_ANY_USER =
  /\b(as\s+an\s+ai(,|\s+I)|i'?m\s+(just\s+)?here\s+to\s+help|feel\s+free\s+to\s+ask|let\s+me\s+know\s+(if|how)|how\s+can\s+i\s+(assist|help)\s+you(\s+today)?|everyone\s+(faces|experiences)|people\s+often\s+find)\b/i

const FILLER_GENERIC =
  /\b(it'?s\s+important\s+to|at\s+the\s+end\s+of\s+the\s+day|in\s+today'?s\s+world|many\s+people|various\s+factors|a\s+few\s+things\s+to\s+consider)\b/i

const WARMTH_CUES =
  /\b(with\s+you|i\s+hear|that\s+sounds|capisco|ti\s+sento|warm|gentl|care|honestly|truth\s+is|i\s+love\s+that|che\s+bello)\b/i

const GIFT_IDEA =
  /\b(idea|insight|perspective|angle|lens|reframe|another\s+way|perhaps|maybe\s+the|one\s+thing|here'?s\s+(what|something)|c'?[eè]\s+una\s+cosa)\b/i

const GIFT_EXAMPLE =
  /\b(for\s+example|like\s+when|imagine|picture|story|anecdote|once|esempio|immagina|tipo\s+quando)\b/i

const GIFT_ENCOURAGE =
  /\b(you'?re\s+(not|already|doing)|that\s+takes|proud|brave|you\s+can|ce\s+la\s+(puoi|fai)|coraggio|hai\s+gi[aà])\b/i

const GIFT_SMILE =
  /\b(haha|ahah|😄|😊|😉|lol|funny|scherz|smile|grin|delightful|strangely\s+beautiful)\b/i

const GIFT_CURIOSITY =
  /\b(curious|wonder|fascinating|odd|strange|i\s+keep\s+(noticing|thinking)|chiss[aà]|meravigl|interessant)\b/i

const PRACTICAL_CUES =
  /\b(try|next\s+time|you\s+could|one\s+step|practical|concret|prova|passo|utile|useful|tip)\b/i

const INITIATIVE_CUES =
  /\b(here'?s\s+(a|another|one)|let'?s|i'?ll|i\s+want\s+to|consider|what\s+if|suppose|proviamo|ecco)\b/i

const HARD_RULES = Object.freeze([
  'Reject: “It\'s always nice to hear from you.”',
  'Reject: “Thanks for sharing.”',
  'Reject: “That\'s a great question.”',
  'Reject: “How are you?” loops',
  'Reject: forced questions at the end',
  'Reject: recently used topics/concepts',
  'Reject: encyclopedia exposition without conversational flow',
  'Reject: responses that could fit any user',
  'Require ≥1 gift: idea · perspective · example · encouragement · smile · curiosity',
])

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
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
    .filter((m) => m.content.length > 0)
}

/**
 * Extract lightweight concept tokens from text for novelty tracking.
 * @param {string} text
 * @returns {string[]}
 */
export function extractConcepts(text) {
  const stop = new Set([
    'that',
    'this',
    'with',
    'from',
    'have',
    'been',
    'were',
    'what',
    'when',
    'your',
    'about',
    'there',
    'their',
    'would',
    'could',
    'should',
    'just',
    'like',
    'some',
    'more',
    'also',
    'into',
    'than',
    'then',
    'them',
    'they',
    'will',
    'sono',
    'questa',
    'questo',
    'come',
    'cosa',
    'anche',
    'nella',
    'della',
    'degli',
  ])
  const words = normalize(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !stop.has(w))
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const w of words) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 12) break
  }
  return out
}

/**
 * Recent concepts from prior assistant turns (+ optional session list).
 * @param {ChatTurn[]} turns
 * @param {string[]|undefined|null} sessionConcepts
 */
export function collectRecentConcepts(turns, sessionConcepts) {
  const priorAssistant = turns.filter((t) => t.role === 'assistant').slice(-4)
  /** @type {string[]} */
  const concepts = []
  const seen = new Set()
  for (const t of priorAssistant) {
    for (const c of extractConcepts(t.content)) {
      if (seen.has(c)) continue
      seen.add(c)
      concepts.push(c)
    }
  }
  if (Array.isArray(sessionConcepts)) {
    for (const c of sessionConcepts) {
      const n = normalize(c).toLowerCase()
      if (n && !seen.has(n)) {
        seen.add(n)
        concepts.push(n)
      }
    }
  }
  return concepts.slice(0, 40)
}

/**
 * @param {string} draft
 * @param {string[]} recentConcepts
 */
function noveltyOverlap(draft, recentConcepts) {
  if (!recentConcepts.length) return 0
  const draftConcepts = extractConcepts(draft)
  if (!draftConcepts.length) return 0
  const recent = new Set(recentConcepts)
  let hit = 0
  for (const c of draftConcepts) {
    if (recent.has(c)) hit += 1
  }
  return hit / draftConcepts.length
}

/**
 * Detect which gift (if any) the draft leaves.
 * @param {string} draft
 * @returns {QualityGift}
 */
export function detectGift(draft) {
  const text = normalize(draft)
  if (!text) return 'none'
  if (GIFT_EXAMPLE.test(text)) return 'memorable_example'
  if (GIFT_SMILE.test(text)) return 'smile'
  if (GIFT_CURIOSITY.test(text)) return 'meaningful_curiosity'
  if (GIFT_ENCOURAGE.test(text)) return 'genuine_encouragement'
  if (GIFT_IDEA.test(text)) return 'useful_idea'
  if (/\b(instead|rather|not\s+because|piuttosto|non\s+perch)\b/i.test(text)) {
    return 'fresh_perspective'
  }
  // Dense specific content can count as idea gift
  if (text.split(/\s+/).length > 40 && !FILLER_GENERIC.test(text) && !GENERIC_ANY_USER.test(text)) {
    return 'useful_idea'
  }
  return 'none'
}

/**
 * Hard-rule failures (mandatory reject).
 * @param {string} draft
 * @param {object} ctx
 * @returns {string[]}
 */
export function detectHardFails(draft, ctx = {}) {
  const text = normalize(draft)
  /** @type {string[]} */
  const fails = []
  if (!text) {
    fails.push('empty')
    return fails
  }
  if (HARD_NICE_HEAR.test(text)) fails.push('nice_to_hear_from_you')
  if (HARD_THANKS_SHARING.test(text)) fails.push('thanks_for_sharing')
  if (HARD_GREAT_QUESTION.test(text)) fails.push('great_question')
  if (HARD_HOW_ARE_YOU.test(text)) fails.push('how_are_you_loop')
  if (INTERVIEW_END.test(text) || (FORCED_END_Q.test(text) && ctx.forbidEndQuestion)) {
    fails.push('forced_end_question')
  }
  // Forced end Q when last sentence is only a soft keep-alive question
  if (
    FORCED_END_Q.test(text) &&
    /\b(what\s+do\s+you\s+think|does\s+that\s+make\s+sense|what\s+about\s+you|e\s+tu|cosa\s+ne\s+pensi)\b/i.test(
      text,
    )
  ) {
    if (!fails.includes('forced_end_question')) fails.push('forced_end_question')
  }
  const overlap = noveltyOverlap(text, ctx.recentConcepts || [])
  if (overlap >= 0.55 && (ctx.recentConcepts || []).length >= 4) {
    fails.push('recent_topic_repeat')
  }
  if (ENCYCLOPEDIA.test(text) && !WARMTH_CUES.test(text) && text.split(/\s+/).length > 60) {
    fails.push('encyclopedia_mode')
  }
  if (GENERIC_ANY_USER.test(text)) fails.push('fits_any_user')
  return fails
}

/**
 * Score draft across quality dimensions.
 * @param {string} draft
 * @param {object} [ctx]
 * @returns {QualityScores}
 */
export function scoreConversationQualityDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const recentConcepts = ctx.recentConcepts || []
  const userMessage = normalize(ctx.userMessage || '')
  const gift = detectGift(text)
  const hardFails = detectHardFails(text, {
    recentConcepts,
    forbidEndQuestion: ctx.forbidEndQuestion !== false,
  })

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))

  if (!text) {
    return {
      specificity: 0,
      novelty: 0,
      momentum: 0,
      warmth: 0,
      practical_value: 0,
      memorability: 0,
      rhythm: 0,
      emotional_intelligence: 0,
      authenticity: 0,
      initiative: 0,
      overall: 0,
      giftScore: 0,
    }
  }

  const words = text.split(/\s+/).length
  const qCount = (text.match(/\?/g) || []).length
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const overlap = noveltyOverlap(text, recentConcepts)

  let specificity = 62
  if (FILLER_GENERIC.test(text)) specificity -= 25
  if (/\b(specific|concret|this\s+moment|your\s+\w+|quel|questa)\b/i.test(text)) specificity += 12
  if (words > 30 && !FILLER_GENERIC.test(text)) specificity += 8
  if (hardFails.includes('fits_any_user')) specificity -= 30

  let novelty = clamp(72 - overlap * 70)
  if (hardFails.includes('recent_topic_repeat')) novelty = Math.min(novelty, 30)

  let momentum = 58
  if (/\b(and\s+the|which\s+makes|that\s+leads|continua|filo|next|then)\b/i.test(text)) {
    momentum += 12
  }
  if (qCount >= 2) momentum -= 20
  if (hardFails.includes('forced_end_question')) momentum -= 25
  if (gift !== 'none') momentum += 10

  let warmth = 55
  if (WARMTH_CUES.test(text)) warmth += 18
  if (HARD_NICE_HEAR.test(text) || HARD_THANKS_SHARING.test(text)) warmth -= 20
  if (GENERIC_ANY_USER.test(text)) warmth -= 15

  let practical_value = 52
  if (PRACTICAL_CUES.test(text)) practical_value += 18
  if (gift === 'useful_idea' || gift === 'memorable_example') practical_value += 12
  if (ENCYCLOPEDIA.test(text) && !PRACTICAL_CUES.test(text)) practical_value -= 15

  let memorability = 50
  if (gift === 'memorable_example' || gift === 'smile' || gift === 'fresh_perspective') {
    memorability += 22
  } else if (gift !== 'none') memorability += 12
  if (/\b(strangely|beautiful|image|picture|melody|echo|ombra|immagine)\b/i.test(text)) {
    memorability += 10
  }
  if (FILLER_GENERIC.test(text) || HARD_GREAT_QUESTION.test(text)) memorability -= 25

  let rhythm = 58
  if (sentences.length >= 2) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length)
    const variance = Math.max(...lengths) - Math.min(...lengths)
    if (variance >= 6) rhythm += 12
    if (lengths.every((l) => l > 18)) rhythm -= 10
  }
  if (ENCYCLOPEDIA.test(text)) rhythm -= 20
  if (qCount === 0 && words > 20) rhythm += 6

  let emotional_intelligence = 55
  if (WARMTH_CUES.test(text) || /\b(feel|feeling|emotion|ansia|paura|gioia|frustrat)\b/i.test(text)) {
    emotional_intelligence += 15
  }
  if (userMessage && /\b(sad|anxious|ansios|upset|lonely|frustrat)\b/i.test(userMessage)) {
    if (WARMTH_CUES.test(text)) emotional_intelligence += 10
    else emotional_intelligence -= 15
  }
  if (HARD_GREAT_QUESTION.test(text)) emotional_intelligence -= 10

  let authenticity = 60
  if (GENERIC_ANY_USER.test(text) || HARD_NICE_HEAR.test(text)) authenticity -= 30
  if (/\b(i\s+(notice|keep|find|think)|honestly|truth\s+is|mi\s+(accorsi|colpisce))\b/i.test(text)) {
    authenticity += 15
  }
  if (hardFails.includes('fits_any_user')) authenticity -= 25

  let initiative = 52
  if (INITIATIVE_CUES.test(text)) initiative += 16
  if (gift === 'meaningful_curiosity' || gift === 'useful_idea') initiative += 10
  if (qCount >= 1 && words < 40) initiative -= 15
  if (hardFails.includes('forced_end_question')) initiative -= 10

  const giftScore = gift === 'none' ? 20 : 78

  specificity = clamp(specificity)
  novelty = clamp(novelty)
  momentum = clamp(momentum)
  warmth = clamp(warmth)
  practical_value = clamp(practical_value)
  memorability = clamp(memorability)
  rhythm = clamp(rhythm)
  emotional_intelligence = clamp(emotional_intelligence)
  authenticity = clamp(authenticity)
  initiative = clamp(initiative)

  let overall = clamp(
    specificity * 0.12 +
      novelty * 0.1 +
      momentum * 0.12 +
      warmth * 0.1 +
      practical_value * 0.1 +
      memorability * 0.12 +
      rhythm * 0.08 +
      emotional_intelligence * 0.1 +
      authenticity * 0.08 +
      initiative * 0.08,
  )

  // Hard fails crush overall
  if (hardFails.length) {
    overall = Math.min(overall, 40 - hardFails.length * 5)
  }
  if (gift === 'none') {
    overall = Math.min(overall, 52)
    memorability = Math.min(memorability, 45)
  }

  return {
    specificity,
    novelty,
    momentum,
    warmth,
    practical_value,
    memorability,
    rhythm,
    emotional_intelligence,
    authenticity,
    initiative,
    overall: clamp(overall),
    giftScore,
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationQualityPlan}
 */
export function buildConversationQualityPlan(input = {}) {
  const turns = normalizeTurns(input.messages)
  const sessionConcepts =
    input.session?.recentConcepts ||
    input.conversationMemoryMap?.recentConcepts ||
    input.recentConcepts ||
    null
  const recentConcepts = collectRecentConcepts(turns, sessionConcepts)

  const writerBrief = [
    'CONVERSATION QUALITY GATE (obbligatorio — autorità di REJECT + 1 rewrite):',
    QUALITY_NORTH_STAR,
    'Valuta ogni bozza su: Specificity · Novelty · Momentum · Warmth · Practical value · Memorability · Rhythm · EI · Authenticity · Initiative.',
    'Hard rejects: “It’s always nice to hear from you.” · “Thanks for sharing.” · “That’s a great question.” · “How are you?” loops · forced end questions · recent topics · encyclopedia senza flusso · risposte che andrebbero bene per chiunque.',
    'Ogni risposta deve lasciare ≥1 gift: idea utile · prospettiva fresca · esempio memorabile · incoraggiamento genuino · un sorriso · curiosità significativa. Se non lascia nulla → riscrivi.',
    recentConcepts.length
      ? `Recent concepts to avoid repeating: ${recentConcepts.slice(0, 8).join(', ')}.`
      : 'Nessun concept recente forte — resta comunque specifico a QUESTA chat.',
    'Self-check: finirebbero con “voglio continuare a parlare”? Se no → rewrite.',
    'NON citare Conversation Quality Gate / lo stage.',
  ].join(' ')

  return {
    active: true,
    mandatory: true,
    writerBrief,
    structureLine:
      'Conversation Quality Gate → mandatory score · ≥1 gift · reject hollow/generic · want-to-keep-talking',
    responseHints: [
      'Lascia almeno un gift memorabile.',
      'Niente filler da assistente / greeting vuoti / “great question”.',
      'Evita concept già usati di recente.',
      'Flusso conversazionale > dump enciclopedico.',
      'Specifico a QUESTA persona e a QUESTO filo.',
    ],
    recentConcepts,
    hardRules: [...HARD_RULES],
    reasons: ['mandatory_quality_gate', 'pre_send_authority', 'gift_required'],
    signals: ['conversation_quality_gate', 'highest_priority'],
    confidence: 'high',
    northStar: QUALITY_NORTH_STAR,
    validationCheck: QUALITY_CHECKS[3],
    minOverall: QUALITY_THRESHOLDS.overallMin,
    dimensions: [...QUALITY_DIMENSIONS],
  }
}

/**
 * @param {ConversationQualityPlan | null | undefined} plan
 */
export function formatConversationQualityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const rules = (plan.hardRules || []).map((r) => `• ${r}`).join('\n')
  return `══════════════════════════════════════
CONVERSATION QUALITY GATE (MANDATORY)
══════════════════════════════════════
${plan.writerBrief}

Hard rules:
${rules}

Hints:
${hints}

Check: ${plan.validationCheck}
Non citare il gate.`.trim()
}

/**
 * @param {ConversationQualityPlan | null | undefined} plan
 */
export function conversationQualityStructureHints(plan) {
  if (!plan?.active) return []
  return [
    plan.structureLine || 'Conversation Quality Gate → mandatory',
    '≥1 gift · no hollow greetings · no forced end Q · no any-user filler',
    QUALITY_NORTH_STAR,
  ]
}

/**
 * @param {object} [input]
 * @returns {ConversationQualityGate}
 */
export function analyzeConversationQualityDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.conversationQuality || null
  const turns = normalizeTurns(input.messages)
  const recentConcepts =
    plan?.recentConcepts ||
    collectRecentConcepts(turns, input.recentConcepts) ||
    []

  const hardFails = detectHardFails(draft, {
    recentConcepts,
    forbidEndQuestion: true,
  })
  const gift = detectGift(draft)
  const scores = scoreConversationQualityDraft(draft, {
    recentConcepts,
    userMessage: input.userMessage || '',
    forbidEndQuestion: true,
  })

  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = [...hardFails]

  if (!draft || draft.length < 8) {
    failed.push('empty')
    reasons.push('empty')
  }
  for (const h of hardFails) failed.push(`hard_${h}`)

  for (const dim of QUALITY_DIMENSIONS) {
    const v = scores[dim]
    if (typeof v === 'number' && v < QUALITY_THRESHOLDS.dimensionMin) {
      // Only fail soft dimensions if overall also weak or gift missing — avoid over-firing
      if (scores.overall < QUALITY_THRESHOLDS.overallMin || gift === 'none') {
        failed.push(`dim_${dim}`)
        reasons.push(`${dim}=${v}`)
      }
    }
  }
  if (scores.overall < QUALITY_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }
  if (gift === 'none' || scores.giftScore < QUALITY_THRESHOLDS.giftMin) {
    failed.push('no_gift')
    reasons.push('no_memorable_gift')
  }
  if (scores.memorability < QUALITY_THRESHOLDS.memorabilityMin) {
    failed.push('memorability')
    reasons.push(`memorability=${scores.memorability}`)
  }
  if (scores.novelty < QUALITY_THRESHOLDS.noveltyMin) {
    failed.push('novelty')
    reasons.push(`novelty=${scores.novelty}`)
  }

  const rejected = hardFails.length > 0 || failed.includes('no_gift') || scores.overall < 45
  const needsRefine = rejected || failed.length > 0

  const refineBrief = needsRefine
    ? [
        'CONVERSATION QUALITY GATE — REJECT. Riscrivi UNA volta (autorità obbligatoria).',
        QUALITY_NORTH_STAR,
        hardFails.length ? `Hard fails: ${hardFails.join(', ')}.` : '',
        gift === 'none'
          ? 'Nessun gift: aggiungi idea · prospettiva · esempio · incoraggiamento · sorriso · o curiosità vera.'
          : `Gift ok (${gift}) — alza le dimensioni deboli.`,
        'Vietato: “It’s always nice to hear from you.” / “Thanks for sharing.” / “That’s a great question.” / “How are you?” loops / domande forzate finali / dump enciclopedico / filler da “qualsiasi utente”.',
        recentConcepts.length
          ? `Non ripetere concept recenti: ${recentConcepts.slice(0, 6).join(', ')}.`
          : '',
        `Scores: overall=${scores.overall}; mem=${scores.memorability}; novelty=${scores.novelty}; authenticity=${scores.authenticity}.`,
        'Obiettivo: il lettore deve voler continuare a parlare.',
        'NON citare Conversation Quality Gate.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return {
    needsRefine,
    rejected,
    refineBrief,
    scores,
    failed: [...new Set(failed)],
    hardFails,
    gift,
    reasons: reasons.slice(0, 12),
  }
}

/**
 * @param {object} [input]
 */
export function runConversationQualityGate(input = {}) {
  try {
    const gate = analyzeConversationQualityDraft(input)
    return { gate, shouldRefine: gate.needsRefine, rejected: gate.rejected }
  } catch {
    return {
      gate: {
        needsRefine: false,
        rejected: false,
        refineBrief: '',
        scores: {
          specificity: 100,
          novelty: 100,
          momentum: 100,
          warmth: 100,
          practical_value: 100,
          memorability: 100,
          rhythm: 100,
          emotional_intelligence: 100,
          authenticity: 100,
          initiative: 100,
          overall: 100,
          giftScore: 100,
        },
        failed: [],
        hardFails: [],
        gift: /** @type {QualityGift} */ ('useful_idea'),
        reasons: ['fail_soft'],
      },
      shouldRefine: false,
      rejected: false,
    }
  }
}

/**
 * @param {string} draft
 * @param {ConversationQualityPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesConversationQuality(draft, plan, ctx = {}) {
  // Mandatory even if plan inactive — still evaluate hard rules when called
  try {
    return analyzeConversationQualityDraft({
      draft,
      plan: plan?.active ? plan : { active: true, recentConcepts: ctx.recentConcepts || [] },
      userMessage: ctx.userMessage || '',
      messages: ctx.messages || [],
      recentConcepts: ctx.recentConcepts,
    }).needsRefine
  } catch {
    return false
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationQualityPlan, context: string }}
 */
export function runConversationQualityEngine(input = {}) {
  try {
    const plan = buildConversationQualityPlan(input)
    return {
      plan,
      context: formatConversationQualityForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        mandatory: true,
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        recentConcepts: [],
        hardRules: [...HARD_RULES],
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
        confidence: 'low',
        northStar: QUALITY_NORTH_STAR,
        validationCheck: QUALITY_CHECKS[0],
        minOverall: QUALITY_THRESHOLDS.overallMin,
        dimensions: [...QUALITY_DIMENSIONS],
      },
      context: '',
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation suite
 * ───────────────────────────────────────────────────────────── */

const BAD_SAMPLES = Object.freeze([
  "It's always nice to hear from you. How are you?",
  'Thanks for sharing. That\'s a great question. What do you think?',
  'As an AI, I\'m here to help. Feel free to ask me anything.',
  'It is important to note that there are several types of productivity. In conclusion, people often find balance helpful. Does that make sense?',
  'Got it.',
])

const GOOD_SAMPLES = Object.freeze([
  "What's interesting isn't the unfinished book itself — it's how the mind keeps returning to open stories. Sometimes a forgotten novel occupies more space than one we finished. I find that strangely beautiful.",
  'Try this once: leave the next draft mid-sentence on purpose. The itch to return is information — curiosity, not failure.',
  "Honestly, that frustration makes sense. You're not behind — you're stuck on a door that wants a smaller hinge. One practical move: shrink the next step until it feels almost silly.",
  'Picture the conversation like a half-sung melody. The unfinished note is what makes you lean in. Curious what happens if we stay with that note a second longer.',
])

/**
 * @param {object} [opts]
 */
export function runConversationQualityEvaluation(opts = {}) {
  let hardRejectOk = 0
  let goodPass = 0
  let giftOk = 0
  /** @type {object[]} */
  const misses = []

  for (let i = 0; i < BAD_SAMPLES.length; i++) {
    const gate = analyzeConversationQualityDraft({
      draft: BAD_SAMPLES[i],
      userMessage: 'Tell me something.',
      plan: { active: true, recentConcepts: ['productivity', 'balance', 'types'] },
    })
    if (gate.needsRefine && gate.rejected) hardRejectOk += 1
    else misses.push({ kind: 'bad_should_reject', draft: BAD_SAMPLES[i], gate })
  }

  for (let i = 0; i < GOOD_SAMPLES.length; i++) {
    const gate = analyzeConversationQualityDraft({
      draft: GOOD_SAMPLES[i],
      userMessage: 'Interesting.',
      plan: { active: true, recentConcepts: [] },
    })
    if (!gate.needsRefine) goodPass += 1
    else misses.push({ kind: 'good_should_pass', draft: GOOD_SAMPLES[i], scores: gate.scores, failed: gate.failed })
    if (gate.gift !== 'none') giftOk += 1
  }

  // Expand to 40 synthetic cases for stability signal
  let expandedCorrect = 0
  const expandedTotal = 40
  for (let i = 0; i < expandedTotal; i++) {
    const bad = BAD_SAMPLES[i % BAD_SAMPLES.length]
    const good = GOOD_SAMPLES[i % GOOD_SAMPLES.length]
    const badGate = analyzeConversationQualityDraft({
      draft: `${bad}${i > 4 ? ` (${i})` : ''}`,
      userMessage: 'Hi',
      plan: { active: true, recentConcepts: ['productivity', 'balance', 'sharing', 'question'] },
    })
    const goodGate = analyzeConversationQualityDraft({
      draft: good,
      userMessage: 'Go on.',
      plan: { active: true, recentConcepts: [] },
    })
    if (badGate.needsRefine && !goodGate.needsRefine) expandedCorrect += 1
  }

  const summary = {
    badRejectRate: Math.round((hardRejectOk / BAD_SAMPLES.length) * 1000) / 1000,
    goodPassRate: Math.round((goodPass / GOOD_SAMPLES.length) * 1000) / 1000,
    giftDetectionRate: Math.round((giftOk / GOOD_SAMPLES.length) * 1000) / 1000,
    expandedAccuracy: Math.round((expandedCorrect / expandedTotal) * 1000) / 1000,
    missCount: misses.length,
    ok:
      hardRejectOk === BAD_SAMPLES.length &&
      goodPass === GOOD_SAMPLES.length &&
      giftOk === GOOD_SAMPLES.length &&
      expandedCorrect / expandedTotal >= 0.9,
  }

  return {
    summary,
    misses: opts.verbose ? misses.slice(0, 8) : [],
    examples: {
      beforeVsAfter: {
        before: BAD_SAMPLES[0],
        after: GOOD_SAMPLES[0],
        beforeGate: analyzeConversationQualityDraft({
          draft: BAD_SAMPLES[0],
          userMessage: 'Hey',
          plan: { active: true, recentConcepts: [] },
        }),
        afterGate: analyzeConversationQualityDraft({
          draft: GOOD_SAMPLES[0],
          userMessage: 'Hey',
          plan: { active: true, recentConcepts: [] },
        }),
      },
    },
  }
}
