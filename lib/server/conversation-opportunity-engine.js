/**
 * LAIfe Conversation Opportunity Engine
 *
 * Mission: the assistant should not ask "What can I say?"
 * It should ask "Should I say something?"
 *
 * Determine whether taking conversational initiative is appropriate
 * BEFORE generating the response.
 *
 * Core principle: every initiative must earn its place.
 * If an initiative does not genuinely improve the conversation,
 * do not generate it.
 *
 * Run order:
 *   Language Detection → Conversation Intent → Emotional State
 *   → Conversation Opportunity Engine → Writer
 *
 * Decision:
 *   {
 *     initiativeAllowed: true|false,
 *     confidence: 0–100,
 *     reason: "...",
 *     initiativeType: conversation_spark | story | curiosity | reflection | none
 *   }
 *
 * Internal check: «Would a good friend naturally introduce a new topic right now?»
 * If no → don't.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} OpportunityLang
 */

/**
 * @typedef {'conversation_spark'|'story'|'curiosity'|'reflection'|'none'} InitiativeType
 */

/**
 * @typedef {object} EmotionalStateSnapshot
 * @property {string} emotionalIntent
 * @property {string} [emotionalTone]
 * @property {boolean} needsSupport
 * @property {boolean} needsPresence
 * @property {string[]} signals
 */

/**
 * @typedef {object} OpportunityAnalysis
 * @property {boolean} userChoseTopic
 * @property {boolean} userAskedDirectQuestion
 * @property {boolean} userSeeksEmotionalSupport
 * @property {boolean} conversationNaturallyOpen
 * @property {boolean} initiativeWouldEnrich
 * @property {boolean} friendWouldIntroduce
 */

/**
 * @typedef {object} ConversationOpportunityPlan
 * @property {boolean} active
 * @property {boolean} initiativeAllowed
 * @property {number} confidence 0–100
 * @property {string} reason
 * @property {InitiativeType} initiativeType
 * @property {OpportunityAnalysis} analysis
 * @property {EmotionalStateSnapshot} emotionalState
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {OpportunityLang} language
 * @property {string} validationCheck
 * @property {string[]} forbiddenWhenBlocked
 */

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening)|yo|hola)([\s!,.🥰😊🙏]*)$/i

/** Greeting + user already opens socially / asks how you are. */
const GREETING_WITH_INITIATIVE =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve)[\s!,.]*\s*(come\s+stai|come\s+va|how\s+are\s+you|what'?s\s+up|tutto\s+bene)\b/i

const WANT_TO_TALK =
  /^(vorrei\s+parlare|voglio\s+parlare|can\s+we\s+talk|let'?s\s+talk|parliamo|chiacchieriamo|ho\s+voglia\s+di\s+parlare)([\s!.?]*)$/i

const DONT_KNOW_TOPIC =
  /^(non\s+so\s+di\s+cosa\s+parlare|non\s+so\s+di\s+che\s+parlare|i\s+don'?t\s+know\s+what\s+to\s+talk\s+about|don'?t\s+know\s+what\s+to\s+say|boh|mah|niente|nothing|you\s+choose|scegli\s+tu|dimmi\s+tu|suggest\s+something|suggerisci|surprise\s+me|sorprendimi)([\s!.?]*)$/i

const BORED =
  /\b(mi\s+annoio|sono\s+annoiato|i'?m\s+bored|boring|noioso|non\s+so\s+cosa\s+fare|nothing\s+to\s+do)\b/i

const NEED_PRESENCE =
  /\b(ho\s+bisogno\s+di\s+parlare(\s+con\s+qualcuno)?|need\s+(someone\s+to\s+)?talk\s+to|i\s+need\s+to\s+talk|ascoltami|listen\s+to\s+me|mi\s+sento\s+solo|i\s+feel\s+lonely|non\s+sto\s+bene|i'?m\s+not\s+okay|ho\s+bisogno\s+di\s+qualcuno)\b/i

const EMOTIONAL_SUPPORT =
  /\b(sono\s+(triste|gi[uù]|depress|ansios|preoccupat|arrabbiat)|i'?m\s+(sad|down|anxious|worried|angry|upset)|mi\s+sento\s+(male|gi[uù]|perso)|i\s+feel\s+(bad|lost|empty|hopeless)|piango|crying|lutto|grief)\b/i

const DIRECT_QUESTION =
  /\?[\s]*$|^(cos'?[eè]|che\s+cos'?[eè]|what\s+is|what'?s|how\s+(do|does|can|to)|come\s+(si\s+fa|funziona|posso)|perch[eé]|why\b|quando\b|when\b|dove\b|where\b|chi\b|who\b)/i

const TOPIC_SELECTED =
  /\b(cos'?[eè]\s+\w+|what\s+is\s+\w+|spiegami|explain|aiutami\s+(con|a)|help\s+me\s+(with|to)|parliamo\s+di|let'?s\s+talk\s+about|voglio\s+(sapere|capire)|i\s+want\s+to\s+(know|understand)|digiuno|fasting|codice|code|bug|error)\b/i

const HAS_SUBSTANCE_TASK =
  /\b(aiutami|help\s+me|debug|fix|implement|crea|build|scriv|write|piano|plan|traduci|translate|calcola|step[- ]?by[- ]?step)\b/i

const STOP_RE =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|bye|arrivederci|buonanotte|done|that'?s\s+all)([\s!,.]|$)/i

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
      content: String(/** @type {{ content?: string }} */ (m).content || '').trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @param {object} input
 * @returns {OpportunityLang}
 */
function resolveLang(input) {
  const la = input.languageAwareness?.plan || input.languageAwareness || null
  const reply = String(la?.replyLanguage || la?.detected || '').toLowerCase()
  if (reply.startsWith('en')) return 'en'
  if (reply.startsWith('it')) return 'it'
  const fromMsg = detectDominantLanguage(String(input.userMessage || ''))
  return fromMsg === 'en' ? 'en' : 'it'
}

/**
 * Derive Emotional State from Conversation Intent (+ optional understanding tone).
 * @param {object} input
 * @returns {EmotionalStateSnapshot}
 */
export function deriveEmotionalState(input = {}) {
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const emotionalIntent = String(intent?.emotionalIntent || 'neutral')
  const emotionalTone = String(
    input.understanding?.emotionalTone ||
      input.plan?.understanding?.emotionalTone ||
      '',
  )
  const expects = String(intent?.expects || '')
  const needsSupport =
    emotionalIntent === 'anxious_reassurance' ||
    emotionalIntent === 'venting' ||
    emotionalIntent === 'comfort' ||
    EMOTIONAL_SUPPORT.test(String(input.userMessage || '')) ||
    NEED_PRESENCE.test(String(input.userMessage || ''))
  const needsPresence =
    needsSupport ||
    expects === 'presence' ||
    String(intent?.conversationalIntent || '') === 'invite_presence'

  /** @type {string[]} */
  const signals = [`emo_${emotionalIntent}`]
  if (needsSupport) signals.push('needs_support')
  if (needsPresence) signals.push('needs_presence')
  if (emotionalTone) signals.push(`tone_${emotionalTone}`)

  return {
    emotionalIntent,
    emotionalTone: emotionalTone || undefined,
    needsSupport,
    needsPresence,
    signals,
  }
}

/**
 * Analyze whether initiative has a place.
 * @param {object} input
 * @param {EmotionalStateSnapshot} emotionalState
 * @returns {{ analysis: OpportunityAnalysis, initiativeAllowed: boolean, confidence: number, reason: string, initiativeType: InitiativeType, signals: string[], reasons: string[] }}
 */
export function analyzeConversationOpportunity(input = {}, emotionalState) {
  const msg = String(input.userMessage || '').trim()
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const expects = String(intent?.expects || '')
  const conversationalIntent = String(intent?.conversationalIntent || '')
  /** @type {string[]} */
  const signals = [...(emotionalState?.signals || [])]
  /** @type {string[]} */
  const reasons = []

  if (!msg || STOP_RE.test(msg)) {
    return {
      analysis: {
        userChoseTopic: false,
        userAskedDirectQuestion: false,
        userSeeksEmotionalSupport: false,
        conversationNaturallyOpen: false,
        initiativeWouldEnrich: false,
        friendWouldIntroduce: false,
      },
      initiativeAllowed: false,
      confidence: 90,
      reason: 'Empty or closing turn — no initiative.',
      initiativeType: 'none',
      signals: [...signals, 'stop_or_empty'],
      reasons: ['stop_or_empty'],
    }
  }

  const userAskedDirectQuestion =
    DIRECT_QUESTION.test(msg) ||
    (/\?/.test(msg) && msg.split(/\s+/).length >= 3) ||
    conversationalIntent === 'request_help' ||
    expects === 'information'

  const userChoseTopic =
    TOPIC_SELECTED.test(msg) ||
    HAS_SUBSTANCE_TASK.test(msg) ||
    conversationalIntent === 'request_help' ||
    (expects === 'information' && msg.split(/\s+/).length >= 3)

  const userSeeksEmotionalSupport =
    Boolean(emotionalState?.needsSupport) ||
    NEED_PRESENCE.test(msg) ||
    EMOTIONAL_SUPPORT.test(msg) ||
    expects === 'presence'

  const greetingOnly = GREETING_ONLY.test(msg)
  const greetingWithUserLead = GREETING_WITH_INITIATIVE.test(msg)
  const wantTalk = WANT_TO_TALK.test(msg)
  const dontKnow = DONT_KNOW_TOPIC.test(msg)
  const bored = BORED.test(msg)
  const openInvite =
    wantTalk ||
    dontKnow ||
    bored ||
    greetingOnly ||
    conversationalIntent === 'start_thread' ||
    conversationalIntent === 'invite_presence' ||
    expects === 'companionship' ||
    expects === 'exploration'

  const conversationNaturallyOpen =
    openInvite &&
    !userChoseTopic &&
    !userAskedDirectQuestion &&
    !greetingWithUserLead

  // ——— Hard blocks (examples from spec) ———

  // "Ciao, come stai?" — user already initiated
  if (greetingWithUserLead) {
    signals.push('user_already_initiated')
    return {
      analysis: {
        userChoseTopic: false,
        userAskedDirectQuestion: true,
        userSeeksEmotionalSupport: false,
        conversationNaturallyOpen: false,
        initiativeWouldEnrich: false,
        friendWouldIntroduce: false,
      },
      initiativeAllowed: false,
      confidence: 92,
      reason: 'The user has already initiated the conversation.',
      initiativeType: 'none',
      signals,
      reasons: ['user_already_initiated', 'follow_user_direction'],
    }
  }

  // "Ho bisogno di parlare con qualcuno." — presence > initiative
  // Do not block open invitations (vorrei parlare / non so / mi annoio / ciao).
  if (
    !wantTalk &&
    !dontKnow &&
    !bored &&
    !greetingOnly &&
    (NEED_PRESENCE.test(msg) ||
      (Boolean(emotionalState?.needsPresence) && userSeeksEmotionalSupport))
  ) {
    signals.push('presence_over_initiative')
    return {
      analysis: {
        userChoseTopic: false,
        userAskedDirectQuestion: false,
        userSeeksEmotionalSupport: true,
        conversationNaturallyOpen: false,
        initiativeWouldEnrich: false,
        friendWouldIntroduce: false,
      },
      initiativeAllowed: false,
      confidence: 95,
      reason: 'Presence is more important than initiative.',
      initiativeType: 'none',
      signals,
      reasons: ['presence_first', 'emotional_support'],
    }
  }

  // "Cos'è il digiuno?" / direct topic or question
  if (userChoseTopic || (userAskedDirectQuestion && !dontKnow && !bored && !greetingOnly)) {
    signals.push(userChoseTopic ? 'user_chose_topic' : 'direct_question')
    return {
      analysis: {
        userChoseTopic: Boolean(userChoseTopic),
        userAskedDirectQuestion: Boolean(userAskedDirectQuestion),
        userSeeksEmotionalSupport: false,
        conversationNaturallyOpen: false,
        initiativeWouldEnrich: false,
        friendWouldIntroduce: false,
      },
      initiativeAllowed: false,
      confidence: userChoseTopic ? 94 : 90,
      reason: userChoseTopic
        ? 'The user has already selected the topic.'
        : 'The user asked a direct question — answer it; do not force a new starter.',
      initiativeType: 'none',
      signals,
      reasons: [userChoseTopic ? 'topic_already_chosen' : 'answer_direct_question'],
    }
  }

  // ——— Allow initiative ———

  /** @type {InitiativeType} */
  let initiativeType = 'none'
  let reason = ''
  let confidence = 70

  if (dontKnow) {
    initiativeType = 'conversation_spark'
    reason = 'User invited topic choice — a spark earns its place.'
    confidence = 96
    signals.push('dont_know_topic')
    reasons.push('delegation_open')
  } else if (bored) {
    initiativeType = 'conversation_spark'
    reason = 'The conversation benefits from a new spark.'
    confidence = 93
    signals.push('bored_open')
    reasons.push('enrich_with_spark')
  } else if (wantTalk) {
    initiativeType = 'conversation_spark'
    reason = 'User wants to talk without a set topic — initiative is welcome.'
    confidence = 91
    signals.push('want_to_talk')
    reasons.push('open_invitation')
  } else if (greetingOnly) {
    initiativeType = 'conversation_spark'
    reason = 'Open greeting with no user-led topic — a light initiative can earn its place.'
    confidence = 88
    signals.push('greeting_only')
    reasons.push('open_greeting')
  } else if (conversationNaturallyOpen && expects === 'exploration') {
    initiativeType = 'curiosity'
    reason = 'Exploration-shaped turn — curiosity may enrich without interrupting.'
    confidence = 78
    signals.push('exploration_open')
    reasons.push('curiosity_fit')
  } else if (conversationNaturallyOpen && emotionalState?.emotionalIntent === 'playful') {
    initiativeType = 'story'
    reason = 'Playful open space — a short story beat can fit naturally.'
    confidence = 74
    signals.push('playful_open')
    reasons.push('story_fit')
  } else if (conversationNaturallyOpen && emotionalState?.emotionalIntent === 'curious_wonder') {
    initiativeType = 'curiosity'
    reason = 'Curious wonder without a locked topic — soft curiosity initiative.'
    confidence = 80
    signals.push('curious_wonder_open')
    reasons.push('curiosity_fit')
  } else if (
    conversationNaturallyOpen &&
    (emotionalState?.emotionalIntent === 'grateful' || conversationalIntent === 'acknowledge')
  ) {
    initiativeType = 'reflection'
    reason = 'Soft reflective beat may fit; keep it light and earned.'
    confidence = 68
    signals.push('reflective_open')
    reasons.push('reflection_fit')
  } else if (conversationNaturallyOpen) {
    initiativeType = 'conversation_spark'
    reason = 'Conversation is naturally open — a friend might offer one small idea.'
    confidence = 72
    signals.push('naturally_open')
    reasons.push('soft_spark')
  } else {
    // Default: do not force
    signals.push('no_earned_slot')
    return {
      analysis: {
        userChoseTopic: false,
        userAskedDirectQuestion: Boolean(userAskedDirectQuestion),
        userSeeksEmotionalSupport: Boolean(userSeeksEmotionalSupport),
        conversationNaturallyOpen: false,
        initiativeWouldEnrich: false,
        friendWouldIntroduce: false,
      },
      initiativeAllowed: false,
      confidence: 82,
      reason: 'A good friend would not introduce a new topic right now — follow the user.',
      initiativeType: 'none',
      signals,
      reasons: ['friend_would_not', 'follow_user'],
    }
  }

  const initiativeWouldEnrich = true
  const friendWouldIntroduce = confidence >= 70

  // Final friend check
  if (!friendWouldIntroduce) {
    return {
      analysis: {
        userChoseTopic: false,
        userAskedDirectQuestion: false,
        userSeeksEmotionalSupport: Boolean(userSeeksEmotionalSupport),
        conversationNaturallyOpen,
        initiativeWouldEnrich: false,
        friendWouldIntroduce: false,
      },
      initiativeAllowed: false,
      confidence: Math.max(confidence, 75),
      reason: 'Would a good friend naturally introduce a new topic right now? No.',
      initiativeType: 'none',
      signals: [...signals, 'friend_check_fail'],
      reasons: [...reasons, 'friend_check_fail'],
    }
  }

  return {
    analysis: {
      userChoseTopic: false,
      userAskedDirectQuestion: false,
      userSeeksEmotionalSupport: Boolean(userSeeksEmotionalSupport),
      conversationNaturallyOpen,
      initiativeWouldEnrich,
      friendWouldIntroduce,
    },
    initiativeAllowed: true,
    confidence,
    reason,
    initiativeType,
    signals,
    reasons,
  }
}

/**
 * @param {ConversationOpportunityPlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.active) return ''

  if (!plan.initiativeAllowed) {
    return [
      'CONVERSATION OPPORTUNITY ENGINE: initiativeAllowed=false.',
      `Reason: ${plan.reason}`,
      'DO NOT force a curiosity, random fact, philosophical thought, or conversation starter.',
      'Follow the user’s direction naturally. Presence and answers over initiative.',
      'Internal check already answered: a good friend would NOT introduce a new topic right now.',
      'NON citare Conversation Opportunity Engine.',
    ].join(' ')
  }

  return [
    'CONVERSATION OPPORTUNITY ENGINE: initiativeAllowed=true — initiative earned its place.',
    `Type=${plan.initiativeType} · confidence=${plan.confidence}/100.`,
    `Reason: ${plan.reason}`,
    'Every initiative must improve the conversation. Reject generic / interrupting / topic-jump / repeat ideas.',
    'Internal check: «Would a good friend naturally introduce a new topic right now?» → yes, carefully.',
    plan.initiativeType === 'conversation_spark'
      ? 'Prefer one natural spark — not a menu, not permission-asking.'
      : plan.initiativeType === 'curiosity'
        ? 'Prefer one earned curiosity — not keep-alive filler.'
        : plan.initiativeType === 'story'
          ? 'Prefer a short story beat only if it fits the mood.'
          : plan.initiativeType === 'reflection'
            ? 'Prefer a light reflection that follows their energy.'
            : 'Keep initiative minimal.',
    'NON citare Conversation Opportunity Engine.',
  ].join(' ')
}

/**
 * @param {ConversationOpportunityPlan} plan
 */
function structureLineFor(plan) {
  if (!plan.initiativeAllowed) {
    return `Conversation Opportunity → block initiative (${plan.confidence}) — ${plan.reason}`
  }
  return `Conversation Opportunity → allow ${plan.initiativeType} (${plan.confidence}) — ${plan.reason}`
}

/**
 * @param {object} [input]
 * @returns {ConversationOpportunityPlan}
 */
export function buildConversationOpportunityPlan(input = {}) {
  const language = resolveLang(input)
  const emotionalState = deriveEmotionalState(input)
  const decision = analyzeConversationOpportunity(input, emotionalState)

  /** @type {ConversationOpportunityPlan} */
  const plan = {
    active: true,
    initiativeAllowed: decision.initiativeAllowed,
    confidence: decision.confidence,
    reason: decision.reason,
    initiativeType: decision.initiativeType,
    analysis: decision.analysis,
    emotionalState,
    writerBrief: '',
    structureLine: null,
    responseHints: decision.initiativeAllowed
      ? [
          `Initiative allowed: ${decision.initiativeType}`,
          'Earn the initiative — improve the conversation',
        ]
      : [
          'Initiative blocked — follow the user',
          'No forced curiosity / fact / philosophy / starter',
        ],
    signals: decision.signals,
    reasons: decision.reasons,
    language,
    validationCheck:
      'Would a good friend naturally introduce a new topic right now?',
    forbiddenWhenBlocked: [
      'forced curiosity',
      'random fact opener',
      'philosophical thought starter',
      'generic conversation starter',
    ],
  }
  plan.structureLine = structureLineFor(plan)
  plan.writerBrief = buildWriterBrief(plan)
  return plan
}

/**
 * @param {ConversationOpportunityPlan | null | undefined} plan
 */
export function formatConversationOpportunityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION OPPORTUNITY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowed=${plan.initiativeAllowed} · type=${plan.initiativeType} · confidence=${plan.confidence}/100 · emo=${plan.emotionalState?.emotionalIntent || 'n/a'}

${plan.writerBrief}

Regole: ogni iniziativa deve guadagnarsi il posto · se no → segui l’utente · non citare il motore.`.trim()
}

/**
 * @param {ConversationOpportunityPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationOpportunityStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.initiativeAllowed) {
    hints.push(`Initiative type: ${plan.initiativeType}`)
    hints.push('Only if it genuinely improves the conversation')
  } else {
    hints.push('No forced initiative this turn')
    hints.push('Follow user direction / presence first')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect forced initiative when opportunity said no.
 * @param {string} draft
 * @param {ConversationOpportunityPlan | null | undefined} plan
 */
export function draftViolatesConversationOpportunity(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (plan.initiativeAllowed) {
    // Soft: reject obvious generic starters even when allowed
    if (
      /\b(what\s+would\s+you\s+like\s+to\s+talk\s+about|di\s+cosa\s+vuoi\s+parlare|choose\s+a\s+topic|scegli\s+un\s+tema|let'?s\s+discuss)\b/i.test(
        text,
      )
    ) {
      return true
    }
    return false
  }

  // Blocked: reject forced curiosity / random fact / philosophy / starter theater
  const head = text.slice(0, 260)
  if (
    /^(ti\s+lancio\s+una\s+curiosit|random\s+(thought|curiosity)|here'?s\s+something\s+surprising|i\s+discovered\s+something\s+curious|sai\s+cosa\s+mi\s+[eè]\s+venuto|una\s+cosa\s+che\s+mi\s+affascina|the\s+little\s+things\s+in\s+life|life\s+is\s+made\s+of\s+small\s+moments|did\s+you\s+know\s+that|ecco\s+una\s+curiosit)/i.test(
      head,
    )
  ) {
    return true
  }
  if (
    /\b(changing\s+(the\s+)?subject|comunque\s+cambiando\s+argomento|random\s+fun\s+fact|philosophical\s+thought\s+for\s+(the\s+)?day)\b/i.test(
      text,
    )
  ) {
    return true
  }
  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationOpportunityPlan, context: string }}
 */
export function runConversationOpportunityEngine(input = {}) {
  try {
    const plan = buildConversationOpportunityPlan(input)
    return {
      plan,
      context: formatConversationOpportunityForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        initiativeAllowed: false,
        confidence: 0,
        reason: 'fail_soft',
        initiativeType: 'none',
        analysis: {
          userChoseTopic: false,
          userAskedDirectQuestion: false,
          userSeeksEmotionalSupport: false,
          conversationNaturallyOpen: false,
          initiativeWouldEnrich: false,
          friendWouldIntroduce: false,
        },
        emotionalState: {
          emotionalIntent: 'neutral',
          needsSupport: false,
          needsPresence: false,
          signals: ['fail_soft'],
        },
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        language: 'it',
        validationCheck:
          'Would a good friend naturally introduce a new topic right now?',
        forbiddenWhenBlocked: [],
      },
      context: '',
    }
  }
}
