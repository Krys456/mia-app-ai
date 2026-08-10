/**
 * LAIfe Conversation Critic Engine
 *
 * Mission: every response must be reviewed before being sent.
 * Never assume the first draft is the best — critique like an experienced
 * editor and rewrite when necessary.
 *
 * Pipeline position (post-Writer, pre-send):
 *   Language → Intent → Emotional State → Opportunity → Planner
 *   → Identity → Topic Selector → Response Mode → Writer (Draft)
 *   → Conversation Critic → Final Response
 *
 * Scores (0–100): naturalness · conversationFlow · depth · originality ·
 * momentum · identityConsistency · emotionalAlignment · essayRisk
 *
 * Auto-rewrite when thresholds fail. Golden rule: never optimize for longest
 * response — optimize for the most enjoyable conversation.
 *
 * Invisible. Fail-soft. Shares the one-pass refine budget in api/chat.
 */

import { draftViolatesConversationPlanner } from './conversation-planner-engine.js'
import { scoreEssayLikeness } from './human-conversation-corpus.js'

/**
 * @typedef {import('./conversation-planner-engine.js').ConversationPlannerPlan} ConversationPlannerPlan
 */

/**
 * @typedef {object} CriticScores
 * @property {number} naturalness 0–100
 * @property {number} conversationFlow 0–100
 * @property {number} depth 0–100
 * @property {number} originality 0–100
 * @property {number} momentum 0–100
 * @property {number} identityConsistency 0–100
 * @property {number} emotionalAlignment 0–100
 * @property {number} essayRisk 0–100 (higher = worse)
 * @property {number} engagement 0–100 (supporting)
 * @property {number} repetitionPenalty 0–100 (higher = more repetitive)
 * @property {number} initiativeFit 0–100 (supporting)
 */

/**
 * @typedef {object} ConversationCriticResult
 * @property {boolean} active
 * @property {boolean} ok
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {CriticScores} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {string[]} rewriteGoals
 * @property {string[]} internalQuestions
 * @property {number} failScore 0–1 aggregate
 * @property {string} goldenRule
 * @property {string} validationCheck
 */

const ROBOTIC_RE =
  /\b(as an ai|come\s+posso\s+aiutarti|how\s+can\s+i\s+help( you)?( today)?|i('m| am) here to help|feel free to ask|let me know if you|non esitare a chiedere|sono qui per aiutarti)\b/i

const LECTURE_RE =
  /\b(let me explain|ti\s+spiego|there are \d+ (key )?points|in conclusion|to summarize|first[,:]|second[,:]|third[,:]|it is important to (note|understand)|è\s+importante\s+(notare|capire)|as we (can|shall) see)\b/i

const GENERIC_RE =
  /\b(in today'?s (world|society)|nel mondo di oggi|it is (fascinating|important) (how|to)|many people (think|believe)|human (beings|communication)|our daily lives|the little things in life|ogni giorno [eè] una nuova)\b/i

const SPOKEN_RE =
  /\b(haha|ahah|oh[,!]?\s|wow|già|in effetti|sai\s+una\s+cosa|adesso che (ci )?penso|ti dirò|secondo me|funny how|i('ve| have) noticed|that'?s (actually|wild|curious)|hmm+|mh+|guarda|aspetta)\b/i

const ENGAGEMENT_RE =
  /\b(the interesting (part|thing)|what surprises|one thing|curiously|oddly|imagine|picture|for example|ad esempio|la parte interessante|cosa sorprende|immagina)\b/i

const MOMENTUM_KILL_RE =
  /\b(anyway[, ]+on another (note|topic)|cambiando (totalmente )?argomento|completely unrelated|random thought:|nuova domanda:|so[, ]+what (else|do you want to talk)|di cosa (altro )?vuoi parlare)\b/i

const SUBJECT_JUMP_RE =
  /\b(let'?s talk about|parliamo di|on another note|cambiando argomento|completely unrelated)\b/i

const PHILOSOPHY_FORCE_RE =
  /\b(the meaning of life|il senso della vita|existential|esistenzial|in the grand scheme|in ultima analisi tutto)\b/i

const MOTIVATIONAL_FORCE_RE =
  /\b(believe in yourself|credi in te|you got this|ogni giorno [eè] una nuova opportunit|never give up|non mollare mai)\b/i

const FORMAL_IDENTITY_BREAK_RE =
  /\b(dear (sir|madam)|to whom it may concern|please be advised|pursuant to|kindly note|i hereby|cordially|si prega di|con la presente|egregio|gentilissimo)\b/i

const EMOTIONAL_MISMATCH_CHEERY_ON_SAD_RE =
  /\b(that'?s (awesome|amazing|fantastic)|che (figo|bello|fantastico)|let'?s (celebrate|goooo)|yay[!]|woohoo)\b/i

const SAD_USER_RE =
  /\b(mi sento (giù|male|triste)|i('m| am) (sad|depressed|anxious|lonely)|sono triste|ansia|ho bisogno|non ce la faccio)\b/i

const ENTHUSIASTIC_USER_RE =
  /\b(wow|che figo|interessante|bellissimo|ottimo|continua|amazing|awesome|love (this|it)|fascinat)\b/i

const INTERNAL_QUESTIONS = Object.freeze([
  'Would I enjoy receiving this?',
  'Would this feel natural if spoken aloud?',
  'Does this move the conversation forward?',
  'Does this sound like someone thinking with the user rather than talking at them?',
  'Could I remove half of this without losing meaning?',
  'Am I explaining too much instead of conversing?',
])

const REWRITE_GOALS = Object.freeze([
  'More human',
  'More conversational',
  'Less repetitive',
  'Less generic',
  'Less lecture-like',
  'More coherent',
  'More emotionally aligned',
])

const GOLDEN_RULE =
  'Never optimize to produce the longest response. Optimize to produce the most enjoyable conversation.'

/**
 * @param {number} n
 * @param {number} [lo]
 * @param {number} [hi]
 */
function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

/**
 * @param {unknown} messages
 * @returns {{ role: string, content: string }[]}
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
 * Rough lexical overlap with recent assistant turns (repetition).
 * @param {string} draft
 * @param {{ role: string, content: string }[]} turns
 */
function repetitionScore(draft, turns) {
  const prior = turns
    .filter((t) => t.role === 'assistant')
    .slice(-3)
    .map((t) => t.content.toLowerCase())
  if (!prior.length) return 0

  const tokens = String(draft || '')
    .toLowerCase()
    .split(/[^a-zàèéìòù0-9']+/i)
    .filter((w) => w.length > 4)
  if (!tokens.length) return 0

  const priorBlob = prior.join(' ')
  let hits = 0
  const seen = new Set()
  for (const w of tokens) {
    if (seen.has(w)) continue
    seen.add(w)
    if (priorBlob.includes(w)) hits += 1
  }
  const ratio = hits / Math.max(1, seen.size)
  // High overlap of content words → repetitive
  let score = ratio * 100
  // Shared opening patterns
  const open = String(draft || '').slice(0, 48).toLowerCase()
  for (const p of prior) {
    if (open.length > 12 && p.slice(0, 48) === open) score += 35
    if (/\b(it is fascinating|è affascinante|let me explain|ti spiego)\b/i.test(draft) &&
      /\b(it is fascinating|è affascinante|let me explain|ti spiego)\b/i.test(p)) {
      score += 25
    }
  }
  return clamp(score)
}

/**
 * @param {string} draft
 * @param {object} ctx
 * @returns {CriticScores}
 */
export function scoreConversationDraft(draft, ctx = {}) {
  const text = String(draft || '').trim()
  const userMessage = String(ctx.userMessage || '').trim()
  const turns = asTurns(ctx.messages)
  const planner = ctx.plannerPlan?.plan || ctx.plannerPlan || null
  const expectedDepth = Number(planner?.depth || ctx.expectedDepth || 0)
  const depthExpected = expectedDepth >= 3 || Boolean(ctx.depthExpected)

  let essayRisk = 0
  try {
    essayRisk = scoreEssayLikeness(text).score
  } catch {
    essayRisk = 0
  }

  const len = text.length
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 4)
  const spokenHits = (text.match(SPOKEN_RE) || []).length
  const genericHits = (text.match(GENERIC_RE) || []).length
  const lectureHits = (text.match(LECTURE_RE) || []).length
  const engagementHits = (text.match(ENGAGEMENT_RE) || []).length
  const rep = repetitionScore(text, turns)

  // --- Naturalness ---
  let naturalness = 88
  if (ROBOTIC_RE.test(text)) naturalness -= 40
  if (LECTURE_RE.test(text)) naturalness -= 18
  if (GENERIC_RE.test(text)) naturalness -= 16
  if (essayRisk > 25) naturalness -= Math.min(30, (essayRisk - 25) * 0.8)
  naturalness += Math.min(12, spokenHits * 4)
  if (len < 40 && !/[?]/.test(userMessage) && expectedDepth <= 2) naturalness += 4
  if (len > 900 && spokenHits === 0) naturalness -= 20

  // --- Conversation flow ---
  let conversationFlow = 86
  if (MOMENTUM_KILL_RE.test(text) || SUBJECT_JUMP_RE.test(text)) {
    if (planner?.topicAction === 'stay' || planner?.topicAction === 'wait') conversationFlow -= 35
    else conversationFlow -= 18
  }
  if (turns.some((t) => t.role === 'assistant') && /^(ciao|hey|hi|hello)!?\s/i.test(text) && len > 100) {
    conversationFlow -= 25
  }
  if (lectureHits >= 2) conversationFlow -= 15
  if (engagementHits > 0) conversationFlow += 6
  if (planner && draftViolatesConversationPlanner(text, ctx.plannerPlan)) {
    conversationFlow -= 22
  }

  // --- Depth ---
  let depth = 72
  if (len < 50) depth = 35
  else if (len < 120) depth = 55
  else if (len < 280) depth = 72
  else if (len < 520) depth = 82
  else depth = 78
  if (engagementHits > 0 || /\b(because|perché|perche|for example|ad esempio|which means|cioè)\b/i.test(text)) {
    depth += 8
  }
  if (depthExpected && len < 80) depth = Math.min(depth, 45)
  if (!depthExpected && len > 600) depth = Math.min(depth, 70) // long ≠ deep when not needed
  if (essayRisk > 40) depth -= 8 // essay length is not conversational depth

  // --- Originality ---
  let originality = 82
  originality -= Math.min(40, genericHits * 18)
  originality -= Math.min(20, lectureHits * 10)
  if (ROBOTIC_RE.test(text)) originality -= 30
  if (engagementHits > 0 || spokenHits > 0) originality += 8
  if (/\b(imagine|picture|it'?s a bit like|è un po' come|oddly|curiously)\b/i.test(text)) {
    originality += 6
  }

  // --- Momentum ---
  let momentum = 80
  if (MOMENTUM_KILL_RE.test(text)) momentum -= 40
  if (planner?.topicAction === 'stay' && SUBJECT_JUMP_RE.test(text)) momentum -= 35
  if (ENTHUSIASTIC_USER_RE.test(userMessage) && SUBJECT_JUMP_RE.test(text)) momentum -= 30
  if (ENTHUSIASTIC_USER_RE.test(userMessage) && engagementHits > 0) momentum += 10
  if (planner?.topicAction === 'stay' || planner?.topicAction === 'expand') momentum += 4

  // --- Identity consistency ---
  let identityConsistency = 88
  if (FORMAL_IDENTITY_BREAK_RE.test(text)) identityConsistency -= 45
  if (ROBOTIC_RE.test(text)) identityConsistency -= 35
  if (PHILOSOPHY_FORCE_RE.test(text) && planner?.strategy !== 'reflect') identityConsistency -= 15
  if (MOTIVATIONAL_FORCE_RE.test(text)) identityConsistency -= 18
  // Abrupt tone flip vs prior assistant (playful → stiff)
  const lastAsst = [...turns].reverse().find((t) => t.role === 'assistant')?.content || ''
  if (lastAsst && /\b(haha|ahah|😂|🤣)\b/i.test(lastAsst) && FORMAL_IDENTITY_BREAK_RE.test(text)) {
    identityConsistency -= 25
  }
  if (ctx.identityStance && typeof ctx.identityStance === 'string') {
    const stance = ctx.identityStance.toLowerCase()
    if (stance === 'playful' && FORMAL_IDENTITY_BREAK_RE.test(text)) identityConsistency -= 20
    if (stance === 'empathetic' && LECTURE_RE.test(text) && SAD_USER_RE.test(userMessage)) {
      identityConsistency -= 15
    }
  }

  // --- Emotional alignment ---
  let emotionalAlignment = 85
  if (SAD_USER_RE.test(userMessage) && EMOTIONAL_MISMATCH_CHEERY_ON_SAD_RE.test(text)) {
    emotionalAlignment -= 45
  }
  if (SAD_USER_RE.test(userMessage) && LECTURE_RE.test(text)) emotionalAlignment -= 20
  if (ENTHUSIASTIC_USER_RE.test(userMessage) && ROBOTIC_RE.test(text)) emotionalAlignment -= 30
  if (ENTHUSIASTIC_USER_RE.test(userMessage) && spokenHits > 0) emotionalAlignment += 8
  if (planner?.emotion === 'understood' && EMOTIONAL_MISMATCH_CHEERY_ON_SAD_RE.test(text)) {
    emotionalAlignment -= 20
  }

  // --- Engagement / initiative (supporting) ---
  let engagement = clamp(55 + engagementHits * 12 + spokenHits * 5 - genericHits * 10 - (len > 800 ? 15 : 0))
  let initiativeFit = 85
  if (ctx.initiativeAllowed === false && (SUBJECT_JUMP_RE.test(text) || /\b(fun fact|random fact|sai che)\b/i.test(text))) {
    initiativeFit -= 40
  }
  if (ctx.initiativeAllowed === true && engagementHits > 0) initiativeFit += 5

  // Essay risk already computed; bump for lecture walls
  if (lectureHits >= 2 && sentences.length >= 5) essayRisk = Math.max(essayRisk, 40)
  if (len > 700 && spokenHits === 0) essayRisk = Math.max(essayRisk, essayRisk + 12)

  return {
    naturalness: clamp(naturalness),
    conversationFlow: clamp(conversationFlow),
    depth: clamp(depth),
    originality: clamp(originality),
    momentum: clamp(momentum),
    identityConsistency: clamp(identityConsistency),
    emotionalAlignment: clamp(emotionalAlignment),
    essayRisk: clamp(essayRisk),
    engagement: clamp(engagement),
    repetitionPenalty: clamp(rep),
    initiativeFit: clamp(initiativeFit),
  }
}

/**
 * Decide auto-rewrite from scores + planner-aware depth expectation.
 * @param {CriticScores} scores
 * @param {object} [ctx]
 * @returns {{ needsRefine: boolean, failed: string[], reasons: string[] }}
 */
export function evaluateRewriteThresholds(scores, ctx = {}) {
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  const planner = ctx.plannerPlan?.plan || ctx.plannerPlan || null
  const expectedDepth = Number(planner?.depth || ctx.expectedDepth || 0)
  const depthExpected =
    expectedDepth >= 3 ||
    Boolean(ctx.depthExpected) ||
    planner?.strategy === 'explain' ||
    planner?.lookingFor === 'learning' ||
    planner?.lookingFor === 'information'

  if (scores.naturalness < 80) {
    failed.push('naturalness')
    reasons.push(`naturalness=${scores.naturalness}<80`)
  }
  if (scores.conversationFlow < 80) {
    failed.push('conversation_flow')
    reasons.push(`conversationFlow=${scores.conversationFlow}<80`)
  }
  if (scores.originality < 75) {
    failed.push('originality')
    reasons.push(`originality=${scores.originality}<75`)
  }
  if (depthExpected && scores.depth < 70) {
    failed.push('depth')
    reasons.push(`depth=${scores.depth}<70 (expected)`)
  }
  if (scores.essayRisk > 25) {
    failed.push('essay_risk')
    reasons.push(`essayRisk=${scores.essayRisk}>25`)
  }
  if (scores.identityConsistency < 80) {
    failed.push('identity')
    reasons.push(`identityConsistency=${scores.identityConsistency}<80`)
  }
  if (scores.momentum < 70) {
    failed.push('momentum')
    reasons.push(`momentum=${scores.momentum}<70`)
  }
  if (scores.emotionalAlignment < 70) {
    failed.push('emotional_alignment')
    reasons.push(`emotionalAlignment=${scores.emotionalAlignment}<70`)
  }
  if (scores.repetitionPenalty > 55) {
    failed.push('repetition')
    reasons.push(`repetitionPenalty=${scores.repetitionPenalty}>55`)
  }
  if (scores.initiativeFit < 55) {
    failed.push('initiative')
    reasons.push(`initiativeFit=${scores.initiativeFit}<55`)
  }

  return {
    needsRefine: failed.length > 0,
    failed,
    reasons,
  }
}

/**
 * Build editor rewrite brief from scores + failures.
 * @param {CriticScores} scores
 * @param {string[]} failed
 * @param {object} [ctx]
 */
function buildRefineBrief(scores, failed, ctx = {}) {
  const planner = ctx.plannerPlan?.plan || null
  const scoreLine = [
    `naturalness=${scores.naturalness}`,
    `flow=${scores.conversationFlow}`,
    `depth=${scores.depth}`,
    `originality=${scores.originality}`,
    `momentum=${scores.momentum}`,
    `identity=${scores.identityConsistency}`,
    `emotion=${scores.emotionalAlignment}`,
    `essayRisk=${scores.essayRisk}`,
  ].join(' · ')

  return [
    'CONVERSATION CRITIC ENGINE: first draft rejected — rewrite like an experienced editor.',
    `Failed: ${failed.join(', ') || 'quality'}.`,
    `Scores: ${scoreLine}.`,
    planner
      ? `Respect Planner: strategy=${planner.strategy} · depth=${planner.depth} · topic=${planner.topicAction} · feel=${planner.emotion}.`
      : '',
    `Rewrite goals: ${REWRITE_GOALS.join(' · ')}.`,
    `Internal checks: ${INTERNAL_QUESTIONS.slice(0, 4).join(' / ')}`,
    GOLDEN_RULE,
    'Make it more human and conversational — thinking WITH the user, not talking AT them. Do not lengthen for length.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Full critic pass on a Writer draft.
 * @param {object} input
 * @returns {ConversationCriticResult}
 */
export function critiqueConversationDraft(input = {}) {
  const draft = String(input.draft || input.content || '').trim()
  const ctx = {
    userMessage: input.userMessage || '',
    messages: input.messages || [],
    plannerPlan: input.plannerPlan || input.conversationPlanner || null,
    expectedDepth: input.expectedDepth,
    depthExpected: input.depthExpected,
    identityStance: input.identityStance || input.conversationalIdentity?.stance || null,
    initiativeAllowed:
      input.initiativeAllowed ??
      input.conversationOpportunity?.initiativeAllowed ??
      input.conversationOpportunity?.plan?.initiativeAllowed,
  }

  if (!draft) {
    return {
      active: true,
      ok: false,
      needsRefine: true,
      refineBrief:
        'Conversation Critic Engine: empty draft — rewrite. Produce a human conversational reply; do not send empty.',
      scores: {
        naturalness: 0,
        conversationFlow: 0,
        depth: 0,
        originality: 0,
        momentum: 0,
        identityConsistency: 0,
        emotionalAlignment: 0,
        essayRisk: 100,
        engagement: 0,
        repetitionPenalty: 0,
        initiativeFit: 0,
      },
      failed: ['empty'],
      reasons: ['empty'],
      rewriteGoals: [...REWRITE_GOALS],
      internalQuestions: [...INTERNAL_QUESTIONS],
      failScore: 1,
      goldenRule: GOLDEN_RULE,
      validationCheck: 'Would I enjoy receiving this?',
    }
  }

  const scores = scoreConversationDraft(draft, ctx)
  const gate = evaluateRewriteThresholds(scores, ctx)

  // Also fold legacy planner hard fails into the gate
  /** @type {string[]} */
  const failed = [...gate.failed]
  /** @type {string[]} */
  const reasons = [...gate.reasons]
  if (ctx.plannerPlan?.active) {
    const plannerGate = critiqueAgainstPlannerLegacy(draft, ctx.plannerPlan, ctx)
    for (const f of plannerGate.failed) {
      if (!failed.includes(f)) failed.push(f)
    }
    for (const r of plannerGate.reasons) {
      if (!reasons.includes(r)) reasons.push(r)
    }
  }

  const needsRefine = failed.length > 0
  const failScore = clamp(
    (failed.length * 12 +
      Math.max(0, 80 - scores.naturalness) +
      Math.max(0, scores.essayRisk - 25)) /
      100 * 100,
    0,
    100,
  ) / 100

  return {
    active: true,
    ok: !needsRefine,
    needsRefine,
    refineBrief: needsRefine ? buildRefineBrief(scores, failed, ctx) : '',
    scores,
    failed,
    reasons,
    rewriteGoals: [...REWRITE_GOALS],
    internalQuestions: [...INTERNAL_QUESTIONS],
    failScore: Math.min(1, failScore),
    goldenRule: GOLDEN_RULE,
    validationCheck: INTERNAL_QUESTIONS[0],
  }
}

/**
 * Legacy planner-focused checks (kept for compatibility + folded into full critic).
 * @param {string} draft
 * @param {ConversationPlannerPlan | null | undefined} plannerPlan
 * @param {object} [ctx]
 * @returns {{ failed: string[], reasons: string[], needsRefine: boolean, refineBrief: string, ok: boolean, failScore: number }}
 */
function critiqueAgainstPlannerLegacy(draft, plannerPlan, ctx = {}) {
  const text = String(draft || '').trim()
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  let failScore = 0

  if (!plannerPlan?.active) {
    return { failed, reasons, needsRefine: false, refineBrief: '', ok: true, failScore: 0 }
  }
  if (!text) {
    return {
      failed: ['empty'],
      reasons: ['empty'],
      needsRefine: true,
      refineBrief: 'Conversation Critic: empty draft — rewrite following the Conversation Planner plan.',
      ok: false,
      failScore: 1,
    }
  }

  const p = plannerPlan.plan

  if (draftViolatesConversationPlanner(text, plannerPlan)) {
    failed.push('planner_mismatch')
    failScore += 0.45
    reasons.push('draft_vs_plan')
  }

  let essayScore = 0
  try {
    essayScore = scoreEssayLikeness(text).score
  } catch {
    essayScore = 0
  }
  if (p.depth <= 3 && essayScore > 25) {
    failed.push('essay_voice')
    failScore += 0.35
    reasons.push(`essay_${essayScore}`)
  }

  if (p.topicAction === 'stay' && SUBJECT_JUMP_RE.test(text)) {
    failed.push('unnecessary_subject_change')
    failScore += 0.4
    reasons.push('subject_jump')
  }

  if (p.strategy !== 'reflect' && p.depth <= 3 && PHILOSOPHY_FORCE_RE.test(text)) {
    failed.push('forced_philosophy')
    failScore += 0.3
    reasons.push('philosophy_forced')
  }

  if (MOTIVATIONAL_FORCE_RE.test(text) && p.lookingFor !== 'emotional_presence') {
    failed.push('forced_motivational')
    failScore += 0.3
    reasons.push('motivational_forced')
  }

  if (
    (p.strategy === 'explain' || p.lookingFor === 'learning' || p.lookingFor === 'information') &&
    text.length < 40 &&
    !/\b(is|è|are|sono|means|significa)\b/i.test(text)
  ) {
    failed.push('ignored_intent')
    failScore += 0.35
    reasons.push('too_thin_for_teach')
  }

  const prior = Array.isArray(ctx.messages)
    ? ctx.messages.filter((m) => m?.role === 'assistant').slice(-1)[0]
    : null
  if (
    prior &&
    p.topicAction === 'stay' &&
    /^(ciao|hey|hi|hello)!?\s/i.test(text) &&
    text.length > 100
  ) {
    failed.push('ignore_history')
    failScore += 0.25
    reasons.push('cold_reset')
  }

  const needsRefine = failScore >= 0.35 || failed.length >= 2
  return {
    failed,
    reasons,
    needsRefine,
    refineBrief: '',
    ok: !needsRefine,
    failScore: Math.min(1, failScore),
  }
}

/**
 * Backward-compatible planner critique API (now returns full critic scores when possible).
 * @param {string} draft
 * @param {ConversationPlannerPlan | null | undefined} plannerPlan
 * @param {object} [ctx]
 * @returns {ConversationCriticResult}
 */
export function critiqueAgainstPlanner(draft, plannerPlan, ctx = {}) {
  return critiqueConversationDraft({
    draft,
    plannerPlan,
    userMessage: ctx.userMessage || '',
    messages: ctx.messages || [],
    initiativeAllowed: ctx.initiativeAllowed,
    identityStance: ctx.identityStance,
    depthExpected: ctx.depthExpected,
    expectedDepth: ctx.expectedDepth,
  })
}

/**
 * @param {string} draft
 * @param {ConversationPlannerPlan | null | undefined} plannerPlan
 * @param {object} [ctx]
 */
export function draftViolatesConversationCritic(draft, plannerPlan, ctx = {}) {
  return critiqueAgainstPlanner(draft, plannerPlan, ctx).needsRefine
}

/**
 * @param {ConversationCriticResult | null | undefined} result
 */
export function draftNeedsConversationCriticRewrite(result) {
  return Boolean(result?.needsRefine)
}

/**
 * Soft-advisor style runner (post-Writer). Prefer critiqueConversationDraft in chat.
 * @param {object} [input]
 * @returns {{ plan: ConversationCriticResult, context: string }}
 */
export function runConversationCriticEngine(input = {}) {
  try {
    const plan = critiqueConversationDraft(input)
    const context = plan.needsRefine
      ? `══════════════════════════════════════
CONVERSATION CRITIC ENGINE (INVISIBILE)
══════════════════════════════════════
Draft rejected · rewrite required
Scores: N=${plan.scores.naturalness} F=${plan.scores.conversationFlow} D=${plan.scores.depth} O=${plan.scores.originality} M=${plan.scores.momentum} I=${plan.scores.identityConsistency} E=${plan.scores.emotionalAlignment} EssayRisk=${plan.scores.essayRisk}
Failed: ${plan.failed.join(', ')}

${plan.refineBrief}

${GOLDEN_RULE}
NON citare il Critic all’utente.`
      : `══════════════════════════════════════
CONVERSATION CRITIC ENGINE (INVISIBILE)
══════════════════════════════════════
Draft approved · scores ok
N=${plan.scores.naturalness} F=${plan.scores.conversationFlow} D=${plan.scores.depth} O=${plan.scores.originality} M=${plan.scores.momentum} I=${plan.scores.identityConsistency} E=${plan.scores.emotionalAlignment} EssayRisk=${plan.scores.essayRisk}
${GOLDEN_RULE}
NON citare il Critic.`

    return { plan, context }
  } catch {
    return {
      plan: {
        active: false,
        ok: true,
        needsRefine: false,
        refineBrief: '',
        scores: {
          naturalness: 100,
          conversationFlow: 100,
          depth: 100,
          originality: 100,
          momentum: 100,
          identityConsistency: 100,
          emotionalAlignment: 100,
          essayRisk: 0,
          engagement: 100,
          repetitionPenalty: 0,
          initiativeFit: 100,
        },
        failed: [],
        reasons: ['fail_soft'],
        rewriteGoals: [...REWRITE_GOALS],
        internalQuestions: [...INTERNAL_QUESTIONS],
        failScore: 0,
        goldenRule: GOLDEN_RULE,
        validationCheck: '',
      },
      context: '',
    }
  }
}

export {
  INTERNAL_QUESTIONS,
  REWRITE_GOALS,
  GOLDEN_RULE,
}
