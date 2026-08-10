/**
 * LAIfe Cognitive Authority Engine
 *
 * Mission: advisors are not enough. Important conversational engines must have
 * authority to REJECT weak responses.
 *
 * Pipeline (post-writer):
 *   Writer → Authority Review → APPROVE | REJECT → auto-rewrite if rejected
 *
 * For greetings / small talk, these mandatory reviewers must ALL approve:
 *   Opening Intelligence · Small Talk Intelligence · Conversation Director · Natural Conversation
 * If one rejects → rewrite.
 *
 * Also rejects: empty politeness, dead-end greetings, chatbot clichés,
 * below-threshold quality, generic “any chatbot could write this” replies.
 *
 * Runs AFTER Writer (Authority Review). Soft pre-writer brief optional.
 * Invisible. Fail-soft on unexpected errors — but intentional REJECT is hard.
 */

import { detectDominantLanguage } from './language-awareness.js'
import { analyzeOpeningIntelligenceDraft } from './opening-intelligence-engine.js'
import {
  analyzeSmallTalkDraft,
  SMALL_TALK_RE,
  DEAD_END_SMALL_TALK_RE,
} from './small-talk-intelligence-engine.js'
import { analyzeConversationDirectorDraft } from './conversation-director.js'
import { analyzeNaturalConversationDraft } from './natural-conversation-engine.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} AuthorityLang
 */

/**
 * @typedef {'opening_intelligence'|'small_talk_intelligence'|'conversation_director'|'natural_conversation'} MandatoryReviewer
 */

/**
 * @typedef {'APPROVE'|'REJECT'} AuthorityDecision
 */

/**
 * @typedef {object} ReviewerVerdict
 * @property {MandatoryReviewer} reviewer
 * @property {'approve'|'reject'|'abstain'} verdict
 * @property {string[]} reasons
 * @property {object | null} scores
 */

/**
 * @typedef {object} CognitiveAuthorityPlan
 * @property {boolean} active
 * @property {boolean} greetingContext
 * @property {boolean} mandatoryPanel
 * @property {MandatoryReviewer[]} mandatoryReviewers
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {AuthorityLang} language
 * @property {string[]} forbiddenBare
 * @property {string[]} internalChecks
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} CognitiveAuthorityReview
 * @property {AuthorityDecision} decision
 * @property {boolean} needsRewrite
 * @property {string} refineBrief
 * @property {object} scores
 * @property {ReviewerVerdict[]} reviews
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {boolean} greetingContext
 * @property {boolean} identityFail
 * @property {boolean} humanTestFail
 * @property {string} humanTest
 */

export const COGNITIVE_AUTHORITY_NORTH_STAR =
  'Generic responses should become impossible. Weak greetings should never leave the system.'

export const COGNITIVE_AUTHORITY_CHECKS = Object.freeze([
  'Could this response come from any chatbot?',
  'Would a close friend answer enthusiastically — or ignore it?',
  'Does this feel pleasant and worth continuing?',
  'For greetings: did Opening · Small Talk · Director · Natural Conversation all approve?',
])

/** @type {MandatoryReviewer[]} */
export const GREETING_MANDATORY_REVIEWERS = Object.freeze([
  'opening_intelligence',
  'small_talk_intelligence',
  'conversation_director',
  'natural_conversation',
])

export const AUTHORITY_THRESHOLDS = Object.freeze({
  naturalnessMin: 55,
  conversationMin: 52,
  curiosityMin: 45,
  identityMin: 55,
  warmthMin: 48,
  continuationMin: 52,
  genericityMax: 48,
  overallMin: 58,
  /** Greeting contexts demand slightly higher identity / lower genericity. */
  greetingIdentityMin: 58,
  greetingGenericityMax: 40,
  greetingOverallMin: 60,
})

/** Bare / empty politeness that must not leave alone. */
export const EMPTY_POLITENESS_RE =
  /\b(it'?s\s+always\s+a\s+pleasure(?:\s+to\s+(?:hear\s+from|see)\s+you)?|it'?s\s+(?:nice|great|wonderful)\s+to\s+(?:hear\s+from|see)\s+you|how\s+are\s+you(?:\s+doing)?\??|and\s+you\??|i'?m\s+(?:fine|good|well|great|ok|okay)(?:,?\s*thanks?)?|pleasure(?:\s+is\s+mine)?|sempre\s+un\s+piacere|che\s+bello\s+(?:sentirti|rivederti)|come\s+stai\??|e\s+tu\??|tutto\s+bene(?:,?\s*grazie)?)\b/i

export const CHATBOT_CLICHE_RE =
  /\b(how\s+can\s+i\s+(?:help|assist)(?:\s+you)?(?:\s+today)?|what\s+can\s+i\s+do\s+for\s+you|i'?m\s+(?:here|happy)\s+to\s+help|as\s+an\s+ai\b|is\s+there\s+anything\s+(?:else\s+)?i\s+can\s+(?:help|assist)|feel\s+free\s+to\s+ask|come\s+posso\s+aiutarti|sono\s+qui\s+per\s+aiutarti|in\s+cosa\s+posso\s+esserti\s+utile)\b/i

export const GENERIC_GREETING_ONLY_RE =
  /^(?:hi|hello|hey|ciao|salve|buongiorno|buonasera|good\s+(?:morning|afternoon|evening)|nice\s+to\s+(?:meet|see|hear\s+from)\s+you|it'?s\s+(?:nice|great|always\s+a\s+pleasure)(?:\s+to\s+(?:hear\s+from|see)\s+you)?|how\s+are\s+you\??|and\s+you\??|i'?m\s+fine(?:,?\s*thanks?)?(?:\.?\s*and\s+you)?|tutto\s+bene(?:,?\s*grazie)?(?:\.?\s*e\s+tu)?|come\s+stai\??)(?:\s*[!?.]*)?$/i

export const VALUE_SIGNAL_RE =
  /\b(noticed|curious|funny|strange|surprising|wonder|idea|imagine|recently|detail|beauty|pattern|odd|fascinating|interesting|morning|light|quiet|thread|unfinished|notato|curios|buffo|strano|sorprendente|idea|immagina|di\s+recente|dettaglio|bellezza|affascinante|interessante|mattina|luce|filo)\b/i

const FORBIDDEN_BARE = Object.freeze([
  "It's always a pleasure...",
  'How are you?',
  'And you?',
  "I'm fine, thanks.",
  "It's nice to hear from you.",
  "I'm fine.",
  'Come stai?',
  'E tu?',
  'Tutto bene, grazie.',
])

/**
 * @param {string} s
 */
function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {object} input
 * @returns {AuthorityLang}
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
 * Detect greeting / small-talk authority panel context.
 * @param {object} input
 */
export function isGreetingAuthorityContext(input = {}) {
  const msg = normalize(input.userMessage || '')
  const st = input.smallTalkIntelligence?.plan || input.smallTalkIntelligence || null
  const oi = input.openingIntelligence?.plan || input.openingIntelligence || null
  if (st?.isSmallTalk) return true
  if (oi?.shouldOpen && !oi?.forceSkipUserQuestion) return true
  if (msg && SMALL_TALK_RE.test(msg)) return true
  if (msg && /^(hi|hello|hey|ciao|salve|buongiorno|buonasera|good\s+morning|how\s+are\s+you|come\s+stai)[!?.]*$/i.test(msg)) {
    return true
  }
  return false
}

/**
 * Score draft for Cognitive Authority quality dimensions.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreCognitiveAuthorityDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const greeting = Boolean(ctx.greetingContext)

  if (!text) {
    return {
      naturalness: 0,
      conversation: 0,
      curiosity: 0,
      identity: 0,
      emotionalWarmth: 0,
      continuation: 0,
      genericity: 100,
      overall: 0,
    }
  }

  let naturalness = 55
  let conversation = 52
  let curiosity = 42
  let identity = 50
  let emotionalWarmth = 48
  let continuation = 50
  let genericity = 35

  const words = text.split(/\s+/).filter(Boolean).length
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean).length

  if (VALUE_SIGNAL_RE.test(text)) {
    curiosity += 18
    identity += 12
    conversation += 10
    genericity = Math.max(0, genericity - 18)
  }
  if (words >= 18 && sentences >= 2) {
    conversation += 12
    continuation += 10
    genericity = Math.max(0, genericity - 10)
  }
  if (/\b(hey|hi|hello|ciao|buongiorno|glad|nice|warm|smile|quiet|hey\s+there)\b/i.test(text)) {
    emotionalWarmth += 10
    naturalness += 6
  }
  if (CONVERSATIONAL_VOICE_HINT.test(text)) {
    naturalness += 10
    identity += 8
  }

  if (GENERIC_GREETING_ONLY_RE.test(text) || words < 8) {
    genericity += 45
    conversation -= 25
    continuation -= 20
    identity -= 25
    curiosity -= 15
  }
  if (EMPTY_POLITENESS_RE.test(text) && !VALUE_SIGNAL_RE.test(text)) {
    genericity += 30
    identity -= 20
    conversation -= 15
    continuation -= 12
  }
  if (DEAD_END_SMALL_TALK_RE.test(text)) {
    continuation -= 30
    conversation -= 20
    genericity += 25
  }
  if (CHATBOT_CLICHE_RE.test(text)) {
    identity -= 35
    genericity += 40
    naturalness -= 20
  }
  if (/\b(and\s+you\??|how\s+are\s+you\??|e\s+tu\??|come\s+stai\??)\s*$/i.test(text) && !VALUE_SIGNAL_RE.test(text)) {
    continuation -= 15
    curiosity -= 10
    genericity += 15
  }

  if (greeting && VALUE_SIGNAL_RE.test(text) && words >= 20) {
    identity += 8
    emotionalWarmth += 6
  }

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
  naturalness = clamp(naturalness)
  conversation = clamp(conversation)
  curiosity = clamp(curiosity)
  identity = clamp(identity)
  emotionalWarmth = clamp(emotionalWarmth)
  continuation = clamp(continuation)
  genericity = clamp(genericity)

  const overall = clamp(
    naturalness * 0.18 +
      conversation * 0.18 +
      curiosity * 0.12 +
      identity * 0.18 +
      emotionalWarmth * 0.1 +
      continuation * 0.12 +
      (100 - genericity) * 0.12,
  )

  return {
    naturalness,
    conversation,
    curiosity,
    identity,
    emotionalWarmth,
    continuation,
    genericity,
    overall,
  }
}

const CONVERSATIONAL_VOICE_HINT =
  /\b(sometimes|oddly|quietly|funny|i'?ve\s+been|there'?s\s+a|one\s+thing|makes\s+me|feels?\s+like|a\s+little|stranamente|c'?[eè]\s+un|mi\s+fa|una\s+cosa)\b/i

/**
 * Human test — would a close friend engage?
 * @param {string} draft
 * @param {object} scores
 */
export function runHumanTest(draft, scores) {
  const text = normalize(draft)
  /** @type {string[]} */
  const fails = []

  if (!text || text.length < 12) fails.push('too_thin_to_engage')
  if (GENERIC_GREETING_ONLY_RE.test(text)) fails.push('friend_would_ignore_generic')
  if (DEAD_END_SMALL_TALK_RE.test(text)) fails.push('dead_end')
  if (scores.continuation < AUTHORITY_THRESHOLDS.continuationMin) {
    fails.push('low_continuation')
  }
  if (scores.emotionalWarmth < AUTHORITY_THRESHOLDS.warmthMin && scores.curiosity < 50) {
    fails.push('not_pleasant_enough')
  }
  if (scores.genericity > AUTHORITY_THRESHOLDS.genericityMax && !VALUE_SIGNAL_RE.test(text)) {
    fails.push('feels_scripted')
  }

  const enthusiastic =
    scores.curiosity >= 55 && scores.continuation >= 55 && scores.identity >= 55
  const ignoreLikely =
    fails.includes('friend_would_ignore_generic') || fails.includes('dead_end')
  const pleasant =
    scores.emotionalWarmth >= AUTHORITY_THRESHOLDS.warmthMin &&
    scores.naturalness >= AUTHORITY_THRESHOLDS.naturalnessMin

  return {
    fail: fails.length > 0 || ignoreLikely || (!enthusiastic && !pleasant),
    fails,
    enthusiastic,
    ignoreLikely,
    pleasant,
    summary: ignoreLikely
      ? 'A close friend would likely ignore this.'
      : !pleasant
        ? 'Would not feel pleasant to receive.'
        : enthusiastic
          ? 'A close friend might answer enthusiastically.'
          : 'Borderline — rewrite toward warmth and curiosity.',
  }
}

/**
 * Identity protection: could any chatbot write this?
 * @param {string} draft
 * @param {object} scores
 */
export function identityLooksGeneric(draft, scores) {
  const text = normalize(draft)
  if (CHATBOT_CLICHE_RE.test(text)) return true
  if (GENERIC_GREETING_ONLY_RE.test(text)) return true
  if (scores.identity < AUTHORITY_THRESHOLDS.identityMin) return true
  if (scores.genericity > AUTHORITY_THRESHOLDS.genericityMax && !VALUE_SIGNAL_RE.test(text)) {
    return true
  }
  if (EMPTY_POLITENESS_RE.test(text) && text.split(/\s+/).length < 22 && !VALUE_SIGNAL_RE.test(text)) {
    return true
  }
  return false
}

/**
 * @param {object} input
 * @returns {ReviewerVerdict[]}
 */
export function runMandatoryReviewers(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  /** @type {ReviewerVerdict[]} */
  const out = []

  const oiPlan = input.openingIntelligence?.plan || input.openingIntelligence || null
  const stPlan = input.smallTalkIntelligence?.plan || input.smallTalkIntelligence || null
  const cdPlan = input.conversationDirector?.plan || input.conversationDirector || null
  const ncPlan = input.naturalConversation?.plan || input.naturalConversation || null

  /** @type {{ reviewer: MandatoryReviewer, plan: object | null, analyze: (() => object) | null }[]} */
  const panel = [
    {
      reviewer: 'opening_intelligence',
      plan: oiPlan,
      analyze: oiPlan?.active
        ? () =>
            analyzeOpeningIntelligenceDraft({
              draft,
              plan: oiPlan,
              userMessage,
            })
        : null,
    },
    {
      reviewer: 'small_talk_intelligence',
      plan: stPlan,
      analyze: stPlan?.active
        ? () =>
            analyzeSmallTalkDraft({
              draft,
              plan: stPlan,
              userMessage,
            })
        : null,
    },
    {
      reviewer: 'conversation_director',
      plan: cdPlan,
      analyze: cdPlan?.active
        ? () =>
            analyzeConversationDirectorDraft({
              draft,
              plan: cdPlan,
              directorPlan: cdPlan,
              userMessage,
            })
        : null,
    },
    {
      reviewer: 'natural_conversation',
      plan: ncPlan,
      analyze: ncPlan?.active
        ? () =>
            analyzeNaturalConversationDraft({
              draft,
              plan: ncPlan,
              userMessage,
            })
        : null,
    },
  ]

  for (const item of panel) {
    if (!item.analyze) {
      // Greeting context without an active plan: Authority still applies local ban rules.
      // Use a lightweight local vote so the mandatory panel is not silently empty.
      const localReject =
        GENERIC_GREETING_ONLY_RE.test(draft) ||
        DEAD_END_SMALL_TALK_RE.test(draft) ||
        (CHATBOT_CLICHE_RE.test(draft) && !VALUE_SIGNAL_RE.test(draft)) ||
        (EMPTY_POLITENESS_RE.test(draft) &&
          !VALUE_SIGNAL_RE.test(draft) &&
          draft.split(/\s+/).length < 22)
      out.push({
        reviewer: item.reviewer,
        verdict: localReject ? 'reject' : 'approve',
        reasons: localReject ? ['authority_local_ban'] : ['authority_local_ok'],
        scores: null,
      })
      continue
    }
    try {
      const gate = item.analyze()
      const reject = Boolean(gate?.needsRefine)
      out.push({
        reviewer: item.reviewer,
        verdict: reject ? 'reject' : 'approve',
        reasons: reject
          ? gate.failed || gate.reasons || ['reviewer_reject']
          : gate.reasons || ['approve'],
        scores: gate.scores || null,
      })
    } catch {
      out.push({
        reviewer: item.reviewer,
        verdict: 'abstain',
        reasons: ['fail_soft'],
        scores: null,
      })
    }
  }

  return out
}

/**
 * Core Authority Review — APPROVE or REJECT.
 * @param {object} [input]
 * @returns {CognitiveAuthorityReview}
 */
export function runCognitiveAuthorityReview(input = {}) {
  try {
    const draft = normalize(input.draft || '')
    const greetingContext = isGreetingAuthorityContext(input)
    const scores = scoreCognitiveAuthorityDraft(draft, { greetingContext })
    /** @type {string[]} */
    const failed = []
    /** @type {string[]} */
    const reasons = []

    /** @type {ReviewerVerdict[]} */
    let reviews = []
    if (greetingContext) {
      reviews = runMandatoryReviewers(input)
      for (const r of reviews) {
        if (r.verdict === 'reject') {
          failed.push(`mandatory_${r.reviewer}`)
          reasons.push(`${r.reviewer}_reject`)
        }
      }
    }

    // Mandatory cliché / empty politeness bans
    if (GENERIC_GREETING_ONLY_RE.test(draft)) {
      failed.push('generic_greeting_only')
      reasons.push('generic_greeting')
    }
    if (DEAD_END_SMALL_TALK_RE.test(draft)) {
      failed.push('dead_end')
      reasons.push('dead_end_response')
    }
    if (CHATBOT_CLICHE_RE.test(draft)) {
      failed.push('chatbot_cliche')
      reasons.push('chatbot_cliche')
    }
    if (
      EMPTY_POLITENESS_RE.test(draft) &&
      !VALUE_SIGNAL_RE.test(draft) &&
      draft.split(/\s+/).length < 28
    ) {
      failed.push('empty_politeness')
      reasons.push('empty_politeness')
    }

    const identityMin = greetingContext
      ? AUTHORITY_THRESHOLDS.greetingIdentityMin
      : AUTHORITY_THRESHOLDS.identityMin
    const genericityMax = greetingContext
      ? AUTHORITY_THRESHOLDS.greetingGenericityMax
      : AUTHORITY_THRESHOLDS.genericityMax
    const overallMin = greetingContext
      ? AUTHORITY_THRESHOLDS.greetingOverallMin
      : AUTHORITY_THRESHOLDS.overallMin

    if (scores.naturalness < AUTHORITY_THRESHOLDS.naturalnessMin) {
      failed.push('naturalness')
      reasons.push(`naturalness=${scores.naturalness}`)
    }
    if (scores.conversation < AUTHORITY_THRESHOLDS.conversationMin) {
      failed.push('conversation')
      reasons.push(`conversation=${scores.conversation}`)
    }
    if (
      greetingContext &&
      scores.curiosity < AUTHORITY_THRESHOLDS.curiosityMin &&
      scores.overall < AUTHORITY_THRESHOLDS.greetingOverallMin + 5
    ) {
      failed.push('curiosity')
      reasons.push(`curiosity=${scores.curiosity}`)
    }
    if (scores.identity < identityMin) {
      failed.push('identity')
      reasons.push(`identity=${scores.identity}`)
    }
    if (scores.emotionalWarmth < AUTHORITY_THRESHOLDS.warmthMin && greetingContext) {
      failed.push('warmth')
      reasons.push(`warmth=${scores.emotionalWarmth}`)
    }
    if (scores.continuation < AUTHORITY_THRESHOLDS.continuationMin) {
      failed.push('continuation')
      reasons.push(`continuation=${scores.continuation}`)
    }
    if (scores.genericity > genericityMax) {
      failed.push('genericity')
      reasons.push(`genericity=${scores.genericity}`)
    }
    if (scores.overall < overallMin) {
      failed.push('overall')
      reasons.push(`overall=${scores.overall}`)
    }

    const identityFail = identityLooksGeneric(draft, scores)
    if (identityFail) {
      failed.push('any_chatbot')
      reasons.push('identity_any_chatbot')
    }

    const human = runHumanTest(draft, scores)
    if (human.fail) {
      failed.push('human_test')
      reasons.push(...human.fails.slice(0, 3))
    }

    const uniqueFailed = [...new Set(failed)]
    const needsRewrite = uniqueFailed.length > 0
    const decision = needsRewrite ? 'REJECT' : 'APPROVE'

    const rejectors = reviews
      .filter((r) => r.verdict === 'reject')
      .map((r) => r.reviewer)
      .join(', ')

    const refineBrief = needsRewrite
      ? [
          'COGNITIVE AUTHORITY: REJECT — rewrite automatically. Weak / generic response must not leave the system.',
          COGNITIVE_AUTHORITY_NORTH_STAR,
          greetingContext
            ? `Greeting panel mandatory: Opening Intelligence · Small Talk · Conversation Director · Natural Conversation must ALL approve.${rejectors ? ` Rejected by: ${rejectors}.` : ''}`
            : 'Quality / identity / human-test failed.',
          'Ban empty politeness alone: “It’s always a pleasure…” / “How are you?” / “And you?” / “I’m fine, thanks.” / “It’s nice to hear from you.”',
          'Reject generic greetings, dead-ends, chatbot clichés. Add conversational value: notice · curiosity · warmth · a thread worth continuing.',
          `Scores: natural=${scores.naturalness} conv=${scores.conversation} curiosity=${scores.curiosity} identity=${scores.identity} warmth=${scores.emotionalWarmth} cont=${scores.continuation} generic=${scores.genericity} overall=${scores.overall}.`,
          `Failed: ${uniqueFailed.join(', ')}.`,
          `Human test: ${human.summary}`,
          'Identity check: Could this come from any chatbot? If yes → rewrite until it could only be LAIfe.',
          'Non citare Cognitive Authority / lo stage.',
        ].join(' ')
      : ''

    return {
      decision,
      needsRewrite,
      refineBrief,
      scores,
      reviews,
      failed: uniqueFailed,
      reasons: [...new Set(reasons)],
      greetingContext,
      identityFail,
      humanTestFail: human.fail,
      humanTest: human.summary,
    }
  } catch {
    return {
      decision: 'APPROVE',
      needsRewrite: false,
      refineBrief: '',
      scores: {
        naturalness: 100,
        conversation: 100,
        curiosity: 100,
        identity: 100,
        emotionalWarmth: 100,
        continuation: 100,
        genericity: 0,
        overall: 100,
      },
      reviews: [],
      failed: [],
      reasons: ['fail_soft'],
      greetingContext: false,
      identityFail: false,
      humanTestFail: false,
      humanTest: 'fail_soft',
    }
  }
}

/**
 * @param {object} [input]
 */
export function runCognitiveAuthorityGate(input = {}) {
  const review = runCognitiveAuthorityReview(input)
  return {
    gate: {
      needsRefine: review.needsRewrite,
      refineBrief: review.refineBrief,
      scores: review.scores,
      failed: review.failed,
      reasons: review.reasons,
      decision: review.decision,
      reviews: review.reviews,
      greetingContext: review.greetingContext,
    },
    shouldRefine: review.needsRewrite,
    review,
  }
}

/**
 * @param {string} draft
 * @param {CognitiveAuthorityPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesCognitiveAuthority(draft, plan, ctx = {}) {
  try {
    return runCognitiveAuthorityReview({
      draft,
      plan,
      userMessage: ctx.userMessage || '',
      openingIntelligence: ctx.openingIntelligence,
      smallTalkIntelligence: ctx.smallTalkIntelligence,
      conversationDirector: ctx.conversationDirector,
      naturalConversation: ctx.naturalConversation || plan,
      languageAwareness: ctx.languageAwareness,
    }).needsRewrite
  } catch {
    return false
  }
}

/**
 * Pre-writer soft plan (awareness that Authority will review).
 * @param {object} [input]
 * @returns {CognitiveAuthorityPlan}
 */
export function buildCognitiveAuthorityPlan(input = {}) {
  const language = resolveLang(input)
  const greetingContext = isGreetingAuthorityContext(input)
  const userMessage = normalize(input.userMessage || '')

  if (!userMessage) {
    return {
      active: false,
      greetingContext: false,
      mandatoryPanel: false,
      mandatoryReviewers: [...GREETING_MANDATORY_REVIEWERS],
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      forbiddenBare: [...FORBIDDEN_BARE],
      internalChecks: [...COGNITIVE_AUTHORITY_CHECKS],
      northStar: COGNITIVE_AUTHORITY_NORTH_STAR,
      validationCheck: COGNITIVE_AUTHORITY_CHECKS[0],
    }
  }

  /** @type {CognitiveAuthorityPlan} */
  const plan = {
    active: true,
    greetingContext,
    mandatoryPanel: greetingContext,
    mandatoryReviewers: [...GREETING_MANDATORY_REVIEWERS],
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Cognitive Authority — weak responses will be REJECTED',
      greetingContext ? 'Greeting panel: OI · STI · Director · NC must all pass' : 'Quality gate active',
      'No empty politeness / chatbot clichés',
    ],
    signals: [
      greetingContext ? 'greeting_panel' : 'quality_gate',
      'authority_review',
    ],
    reasons: [
      'authority_not_advisor_only',
      greetingContext ? 'mandatory_greeting_panel' : 'quality_threshold',
    ],
    confidence: 'high',
    language,
    forbiddenBare: [...FORBIDDEN_BARE],
    internalChecks: [...COGNITIVE_AUTHORITY_CHECKS],
    northStar: COGNITIVE_AUTHORITY_NORTH_STAR,
    validationCheck: COGNITIVE_AUTHORITY_CHECKS[0],
  }

  plan.writerBrief = [
    'COGNITIVE AUTHORITY (revisione obbligatoria post-Writer — non un suggerimento):',
    COGNITIVE_AUTHORITY_NORTH_STAR,
    greetingContext
      ? 'Greeting/small-talk: Opening Intelligence · Small Talk Intelligence · Conversation Director · Natural Conversation must ALL approve. One reject → automatic rewrite.'
      : 'Every response is scored; below threshold → rewrite.',
    `Forbidden bare (without conversational value): ${FORBIDDEN_BARE.slice(0, 6).join(' / ')}`,
    'Reject: generic greetings · empty politeness · dead-ends · chatbot clichés.',
    'Identity: Could this come from any chatbot? If yes → rewrite.',
    'Human test: would a close friend answer enthusiastically and find it pleasant?',
    'Scores: naturalness · conversation · curiosity · identity · emotional warmth · continuation · genericity.',
    'NON citare Cognitive Authority / lo stage.',
  ].join(' ')

  plan.structureLine = greetingContext
    ? 'Cognitive Authority → greeting panel (OI·STI·Director·NC) · REJECT weak'
    : 'Cognitive Authority → quality gate · REJECT below threshold'

  return plan
}

/**
 * @param {CognitiveAuthorityPlan | null | undefined} plan
 */
export function cognitiveAuthorityStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Authority will REJECT weak / generic replies — not optional')
  if (plan.mandatoryPanel) {
    hints.push('Greeting: Opening · Small Talk · Director · Natural Conversation must all approve')
  }
  hints.push(COGNITIVE_AUTHORITY_CHECKS[0])
  return hints
}

/**
 * @param {CognitiveAuthorityPlan | null | undefined} plan
 */
export function formatCognitiveAuthorityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
COGNITIVE AUTHORITY (INVISIBILE — HARD GATE)
══════════════════════════════════════
${plan.writerBrief}

Checks:
${COGNITIVE_AUTHORITY_CHECKS.map((c, i) => `${i + 1}. ${c}`).join('\n')}

North star: ${COGNITIVE_AUTHORITY_NORTH_STAR}
Non citare questo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: CognitiveAuthorityPlan, context: string }}
 */
export function runCognitiveAuthorityEngine(input = {}) {
  try {
    const plan = buildCognitiveAuthorityPlan(input)
    return {
      plan,
      context: formatCognitiveAuthorityForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        greetingContext: false,
        mandatoryPanel: false,
        mandatoryReviewers: [...GREETING_MANDATORY_REVIEWERS],
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        forbiddenBare: [...FORBIDDEN_BARE],
        internalChecks: [...COGNITIVE_AUTHORITY_CHECKS],
        northStar: COGNITIVE_AUTHORITY_NORTH_STAR,
        validationCheck: COGNITIVE_AUTHORITY_CHECKS[0],
      },
      context: '',
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation: 500 greetings — weak must be rejected
 * ───────────────────────────────────────────────────────────── */

const WEAK_TEMPLATES = Object.freeze([
  "It's always a pleasure.",
  "It's always a pleasure to hear from you.",
  "It's nice to hear from you.",
  'How are you?',
  'How are you doing?',
  'And you?',
  "I'm fine, thanks.",
  "I'm fine.",
  "I'm fine, thanks. And you?",
  'Hello! How are you?',
  'Hi! How are you?',
  "Hi there. It's nice to hear from you.",
  "Hello. It's always a pleasure.",
  'Good morning. How are you?',
  "I'm good, thanks. And you?",
  'Ciao! Come stai?',
  'Tutto bene, grazie.',
  'Tutto bene, grazie. E tu?',
  'Sempre un piacere.',
  'Che bello sentirti. Come stai?',
  'Hello!',
  'Hi!',
  'Hey.',
  'Ciao.',
  'Buongiorno.',
  'How can I help you today?',
  "I'm here to help. How are you?",
  'What can I do for you?',
  "Nice to hear from you. I'm fine.",
  "It's wonderful to see you. And you?",
])

const STRONG_TEMPLATES = Object.freeze([
  "Hey — glad you're here. Odd little thought: mornings feel longer when the first message is just a quiet hello, like the day hasn't chosen its shape yet.",
  "Ciao. C'è una cosa curiosa che mi è tornata in mente stamattina: a volte le conversazioni migliori iniziano senza urgenza, solo con la voglia di notare qualcosa insieme.",
  "Hi. I've been turning over a curious detail — the way a simple greeting can open a whole afternoon if nobody rushes to fill it with tasks.",
  "Hey there. Funny how a quiet hello can feel like leaving the door ajar. Want to wander into whatever's been lingering at the edge of your mind?",
  "Buongiorno — la luce di questa mattina mi ha fatto pensare a quanto spesso iniziamo le giornate in automatico. Un saluto lento è già una piccola ribellione curiosa.",
  "Hey. Surprising how much room a short greeting can hold — like a blank page that still smells of coffee.",
  "Ciao — idea strana: i saluti migliori non chiudono una formalità, aprono un filo. Uno qualunque va bene, anche piccolo.",
  "Hi there. I noticed something quietly elegant: people often say hello when they actually mean “I’m glad this channel is still open.”",
  "Good morning. Curious thought for a slow start: the first message of the day sets the weather for everything that follows.",
  "Hey — glad you pinged. There's a pleasant unfinished feeling in simple hellos; they leave space instead of demanding a plan.",
])

/**
 * Deterministic weak greeting variants (500).
 * @param {number} [n=500]
 * @returns {{ id: string, kind: 'weak'|'strong', userMessage: string, draft: string }[]}
 */
export function generateGreetingAuthorityCorpus(n = 500) {
  /** @type {{ id: string, kind: 'weak'|'strong', userMessage: string, draft: string }[]} */
  const out = []
  const users = [
    'Hi',
    'Hello',
    'Hey',
    'Ciao',
    'Good morning',
    'How are you?',
    'Buongiorno',
    "What's up?",
    'Hey there',
    'Salve',
  ]

  const weakCount = Math.max(0, n - 50)
  for (let i = 0; i < weakCount; i++) {
    const base = WEAK_TEMPLATES[i % WEAK_TEMPLATES.length]
    const punct = i % 5 === 0 ? '!' : i % 5 === 1 ? '.' : ''
    const prefix = i % 7 === 0 ? '' : i % 7 === 1 ? 'Hello. ' : i % 7 === 2 ? 'Hi! ' : ''
    const draft = normalize(`${prefix}${base}${punct}`)
    out.push({
      id: `w${String(i + 1).padStart(3, '0')}`,
      kind: 'weak',
      userMessage: users[i % users.length],
      draft,
    })
  }

  for (let i = 0; i < Math.min(50, n); i++) {
    const base = STRONG_TEMPLATES[i % STRONG_TEMPLATES.length]
    out.push({
      id: `s${String(i + 1).padStart(3, '0')}`,
      kind: 'strong',
      userMessage: users[i % users.length],
      draft: base,
    })
  }

  return out
}

/**
 * Only empty politeness / banned bare replies (no value).
 * @param {string} draft
 */
export function isBannedBareGreeting(draft) {
  const text = normalize(draft)
  if (!text) return true
  if (GENERIC_GREETING_ONLY_RE.test(text)) return true
  if (DEAD_END_SMALL_TALK_RE.test(text)) return true
  if (
    /^(?:it'?s\s+(?:always\s+a\s+pleasure|nice\s+to\s+hear\s+from\s+you)|how\s+are\s+you\??|and\s+you\??|i'?m\s+fine(?:,?\s*thanks?)?)\s*[!.]*$/i.test(
      text,
    )
  ) {
    return true
  }
  return EMPTY_POLITENESS_RE.test(text) && !VALUE_SIGNAL_RE.test(text) && text.split(/\s+/).length < 18
}

/**
 * Run evaluation over greeting corpus.
 * @param {object} [opts]
 */
export function runCognitiveAuthorityEvaluation(opts = {}) {
  const n = opts.count || 500
  const corpus = generateGreetingAuthorityCorpus(n)

  let weakRejected = 0
  let weakTotal = 0
  let strongApproved = 0
  let strongTotal = 0
  let approvedBannedBare = 0
  /** @type {object[]} */
  const leaks = []

  for (const item of corpus) {
    const review = runCognitiveAuthorityReview({
      draft: item.draft,
      userMessage: item.userMessage,
      // Eval uses Authority-local panel (inactive reviewer plans → local ban votes)
      smallTalkIntelligence: { active: false, isSmallTalk: true },
      openingIntelligence: { active: false, shouldOpen: true },
      conversationDirector: { active: false },
      naturalConversation: { active: false },
    })

    if (item.kind === 'weak') {
      weakTotal++
      if (review.decision === 'REJECT') weakRejected++
      else {
        leaks.push({ id: item.id, draft: item.draft, scores: review.scores })
      }
    } else {
      strongTotal++
      if (review.decision === 'APPROVE') strongApproved++
    }

    if (review.decision === 'APPROVE' && isBannedBareGreeting(item.draft)) {
      approvedBannedBare++
      leaks.push({ id: item.id, draft: item.draft, reason: 'banned_bare_approved' })
    }
  }

  const rejectionRate = weakTotal ? weakRejected / weakTotal : 0
  const summary = {
    total: corpus.length,
    weakTotal,
    weakRejected,
    rejectionRate: Math.round(rejectionRate * 1000) / 1000,
    strongTotal,
    strongApproved,
    approvedBannedBare,
    leakCount: leaks.length,
    thresholds: { ...AUTHORITY_THRESHOLDS },
    ok:
      corpus.length >= 500 &&
      rejectionRate >= 0.98 &&
      approvedBannedBare === 0 &&
      strongApproved >= Math.floor(strongTotal * 0.7),
  }

  if (opts.verbose) return { summary, leaks, corpusSize: corpus.length }
  return { summary, leaks }
}
