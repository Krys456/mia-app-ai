/**
 * LAIfe Directive Authority System
 *
 * The cognitive pipeline produces high-level decisions.
 * The Writer must STOP treating them as suggestions.
 * From now on they are mandatory directives.
 *
 * After all cognitive stages (+ Coordinator), this module builds an immutable
 * WriterDirectives object. That object is the Writer’s sole authority surface:
 * every field MUST be obeyed. Supporting cognitive context cannot override it.
 *
 * Conflict resolution (deterministic, highest wins):
 *   1. Safety
 *   2. Language
 *   3. Conversation Mode
 *   4. Social Intent
 *   5. Conversation Intent
 *   6. Emotional Tone
 *   7. Writer Style
 *
 * Invisible. Fail-soft. Optional debug logging.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {'english'|'italian'|'auto'} DirectiveLanguage
 */

/**
 * @typedef {'companionship'|'information'|'exploration'|'presence'|'social'|'mixed'|'teaching'|'problem_solving'} ConversationMode
 */

/**
 * @typedef {'short'|'medium'|'long'} ResponseLength
 */

/**
 * @typedef {'low'|'medium'|'high'} InitiativeLevel
 */

/**
 * @typedef {'normal'|'careful'|'strict'} SafetyLevel
 */

/**
 * @typedef {'warm'|'calm'|'playful'|'serious'|'supportive'|'neutral'|'excited'|'grateful'} DirectiveEmotionalTone
 */

/**
 * Immutable WriterDirectives — mandatory for the Writer.
 * @typedef {object} WriterDirectives
 * @property {true} immutable
 * @property {DirectiveLanguage} language
 * @property {ConversationMode} mode
 * @property {boolean} social
 * @property {boolean} leadConversation
 * @property {boolean} askQuestion
 * @property {boolean} continueCurrentTopic
 * @property {DirectiveEmotionalTone} emotionalTone
 * @property {ResponseLength} responseLength
 * @property {InitiativeLevel} initiative
 * @property {SafetyLevel} safety
 * @property {string | null} topic
 * @property {string[]} priorityOrder
 * @property {string[]} hardRules
 * @property {string[]} validationChecklist
 * @property {string[]} reasons
 * @property {Record<string, string>} sources
 * @property {string} writerBrief
 */

/** Deterministic conflict priority (highest first). */
export const DIRECTIVE_PRIORITY_ORDER = Object.freeze([
  'safety',
  'language',
  'conversation_mode',
  'social_intent',
  'conversation_intent',
  'emotional_tone',
  'writer_style',
])

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto)\b/i

/**
 * Map language-awareness codes → directive language labels.
 * @param {string | null | undefined} code
 * @returns {DirectiveLanguage}
 */
export function mapReplyLanguage(code) {
  const c = String(code || '').toLowerCase()
  if (c === 'en' || c === 'english') return 'english'
  if (c === 'it' || c === 'italian' || c === 'italiano') return 'italian'
  return 'auto'
}

/**
 * @param {DirectiveLanguage} lang
 */
export function languageLabel(lang) {
  if (lang === 'english') return 'English'
  if (lang === 'italian') return 'italiano'
  return 'the user’s language'
}

/**
 * @param {string} tone
 * @returns {DirectiveEmotionalTone}
 */
function mapEmotionalTone(tone) {
  const t = String(tone || 'neutral').toLowerCase()
  if (t === 'excited' || t === 'celebrating' || t === 'positive') return 'excited'
  if (t === 'grateful') return 'grateful'
  if (t === 'anxious' || t === 'comfort' || t === 'frustrated' || t === 'venting') {
    return 'supportive'
  }
  if (t === 'curious') return 'warm'
  if (t === 'playful') return 'playful'
  if (t === 'warm') return 'warm'
  if (t === 'calm') return 'calm'
  if (t === 'serious') return 'serious'
  return 'neutral'
}

/**
 * Resolve conversation mode with priority: mode sources vs social.
 * Conversation Mode (priority 3) is the resolved field; Social Intent (4) and
 * Conversation Intent (5) feed candidates; higher source wins when they conflict
 * via the deterministic rules below.
 *
 * @param {object} input
 * @returns {{ mode: ConversationMode, source: string, reasons: string[] }}
 */
function resolveMode(input) {
  /** @type {string[]} */
  const reasons = []
  const social = input.socialConversation || null
  const intent = input.conversationIntent?.inference || input.conversationIntent || null
  const behavior = String(input.behavior?.behavior || input.plan?.behavior?.behavior || '')
  const expects = String(intent?.expects || '')

  // Safety / distress handled by caller → presence mode
  if (input.safetyForcedPresence) {
    reasons.push('safety_forces_presence')
    return { mode: 'presence', source: 'safety', reasons }
  }

  // Strong social contact → companionship / social (Conversation Mode from social signal)
  if (social?.isSocial || social?.mode === 'social') {
    reasons.push('social_is_true')
    return { mode: 'companionship', source: 'social_intent', reasons }
  }

  if (social?.mode === 'mixed' || social?.socialIntent === 'mixed_social') {
    reasons.push('social_mixed')
    return { mode: 'mixed', source: 'social_intent', reasons }
  }

  // Conversation Intent expects → mode
  if (expects === 'companionship') {
    reasons.push('intent_companionship')
    return { mode: 'companionship', source: 'conversation_intent', reasons }
  }
  if (expects === 'presence') {
    reasons.push('intent_presence')
    return { mode: 'presence', source: 'conversation_intent', reasons }
  }
  if (expects === 'exploration') {
    reasons.push('intent_exploration')
    return { mode: 'exploration', source: 'conversation_intent', reasons }
  }
  if (expects === 'information') {
    reasons.push('intent_information')
    // Behavior may refine teaching vs problem_solving (writer style — lower priority)
    if (/teach|explain|teacher/i.test(behavior)) {
      reasons.push('behavior_teaching')
      return { mode: 'teaching', source: 'conversation_intent', reasons }
    }
    if (/technical|planning|problem/i.test(behavior)) {
      reasons.push('behavior_problem_solving')
      return { mode: 'problem_solving', source: 'conversation_intent', reasons }
    }
    return { mode: 'information', source: 'conversation_intent', reasons }
  }

  if (expects === 'mixed') {
    reasons.push('intent_mixed')
    return { mode: 'mixed', source: 'conversation_intent', reasons }
  }

  // Behavior fallback (writer-style tier)
  if (/emotional|support/i.test(behavior)) {
    return { mode: 'presence', source: 'writer_style', reasons: ['behavior_support'] }
  }
  if (/conversation/i.test(behavior)) {
    return { mode: 'companionship', source: 'writer_style', reasons: ['behavior_conversation'] }
  }
  if (/brainstorm/i.test(behavior)) {
    return { mode: 'exploration', source: 'writer_style', reasons: ['behavior_brainstorm'] }
  }

  reasons.push('default_mixed')
  return { mode: 'mixed', source: 'writer_style', reasons }
}

/**
 * @param {object} input
 * @param {ConversationMode} mode
 * @param {boolean} social
 */
function resolveAskQuestion(input, mode, social) {
  const socialPlan = input.socialConversation || null
  const presence = input.presence || null
  const leadership = input.conversationLeadership || null
  const qe = input.questionEconomy || null
  const ownership = input.conversationOwnership || null
  const worth = input.worthReading || null
  const intent = input.conversationIntent?.inference || input.conversationIntent || null

  // Social / presence / ownership / worth — hard no
  if (socialPlan?.forceNoQuestion) {
    return { askQuestion: false, source: 'social_intent', reason: 'social_force_no_question' }
  }
  if (social && (mode === 'companionship' || mode === 'social' || mode === 'presence')) {
    return { askQuestion: false, source: 'social_intent', reason: 'social_mode_no_default_question' }
  }
  if (presence?.avoidQuestionEnding) {
    return { askQuestion: false, source: 'conversation_mode', reason: 'presence_avoid_q' }
  }
  if (ownership?.forbidGenericQuestion) {
    return { askQuestion: false, source: 'conversation_mode', reason: 'ownership_forbid_q' }
  }
  if (worth?.suppressQuestions) {
    return { askQuestion: false, source: 'conversation_mode', reason: 'worth_reading_suppress_q' }
  }
  if (qe?.active && qe.preferContinue && !qe.allowQuestion) {
    return { askQuestion: false, source: 'conversation_intent', reason: 'question_economy' }
  }
  if (intent?.opennessToContinue === 'closed') {
    return { askQuestion: false, source: 'conversation_intent', reason: 'openness_closed' }
  }
  if (leadership?.active && leadership.allowQuestion === false) {
    return { askQuestion: false, source: 'conversation_mode', reason: 'leadership_no_q' }
  }
  // Explicit allow only when leadership says so and nothing higher forbids
  if (leadership?.active && leadership.allowQuestion === true) {
    return { askQuestion: true, source: 'conversation_mode', reason: 'leadership_allow_q' }
  }
  // Default: no question (initiative over interview)
  return { askQuestion: false, source: 'writer_style', reason: 'default_no_question' }
}

/**
 * @param {object} input
 * @param {ConversationMode} mode
 * @param {boolean} social
 */
function resolveLeadConversation(input, mode, social) {
  const ownership = input.conversationOwnership || null
  const leadership = input.conversationLeadership || null
  const welcome = input.welcome || null
  const warm = input.warmConversation || null
  const topicLead = input.topicLeadership || null

  if (ownership?.takeLead) {
    return { leadConversation: true, source: 'conversation_mode', reason: 'ownership_lead' }
  }
  if (topicLead?.shouldLead) {
    return { leadConversation: true, source: 'conversation_mode', reason: 'topic_leadership' }
  }
  if (
    leadership?.active &&
    /choose_direction|insight|story|observation|continue|analogy/i.test(String(leadership.move || ''))
  ) {
    return { leadConversation: true, source: 'conversation_mode', reason: `lead_move_${leadership.move}` }
  }
  if (warm?.ownsOpening) {
    return { leadConversation: true, source: 'social_intent', reason: 'warm_owns_opening' }
  }
  if (welcome?.active) {
    return { leadConversation: true, source: 'social_intent', reason: 'welcome_active' }
  }
  if (social && (mode === 'companionship' || mode === 'social')) {
    return { leadConversation: true, source: 'social_intent', reason: 'social_lead' }
  }
  if (mode === 'presence' || mode === 'companionship') {
    return { leadConversation: true, source: 'conversation_mode', reason: 'mode_expects_lead' }
  }
  return { leadConversation: false, source: 'writer_style', reason: 'no_lead_signal' }
}

/**
 * @param {object} input
 */
function resolveContinueTopic(input) {
  const intent = input.conversationIntent?.inference || input.conversationIntent || null
  const session = input.session || input.plan?.session || null
  const topicLead = input.topicLeadership || null
  const social = input.socialConversation || null

  if (topicLead?.shouldLead) {
    // Leadership chose a theme — stay on that theme once set
    return { continueCurrentTopic: true, source: 'conversation_mode', reason: 'topic_lead_hold' }
  }
  if (session?.topicShift) {
    return { continueCurrentTopic: false, source: 'conversation_intent', reason: 'topic_shift' }
  }
  if (intent?.conversationalIntent === 'shift') {
    return { continueCurrentTopic: false, source: 'conversation_intent', reason: 'intent_shift' }
  }
  if (social?.avoidTopicChange || social?.isSocial) {
    return { continueCurrentTopic: true, source: 'social_intent', reason: 'social_hold_topic' }
  }
  if (
    intent?.conversationalIntent === 'continue_thread' ||
    intent?.conversationalIntent === 'deepen'
  ) {
    return { continueCurrentTopic: true, source: 'conversation_intent', reason: 'continue_thread' }
  }
  return { continueCurrentTopic: true, source: 'writer_style', reason: 'default_continue' }
}

/**
 * @param {object} input
 * @param {ConversationMode} mode
 * @param {boolean} social
 * @param {boolean} leadConversation
 */
function resolveLength(input, mode, social, leadConversation) {
  if (input.modality === 'voice' || input.voice === true) {
    return { responseLength: /** @type {ResponseLength} */ ('short'), source: 'writer_style', reason: 'voice' }
  }
  if (input.presence?.preferBrevity) {
    return { responseLength: /** @type {ResponseLength} */ ('short'), source: 'conversation_mode', reason: 'presence_brief' }
  }
  if (social && input.socialConversation?.forceNoQuestion) {
    return { responseLength: /** @type {ResponseLength} */ ('short'), source: 'social_intent', reason: 'social_short' }
  }
  if (mode === 'information' || mode === 'teaching' || mode === 'problem_solving') {
    const complexity = String(input.plan?.understanding?.complexity || '')
    if (complexity === 'high') {
      return { responseLength: /** @type {ResponseLength} */ ('long'), source: 'conversation_intent', reason: 'complex_info' }
    }
    return { responseLength: /** @type {ResponseLength} */ ('medium'), source: 'conversation_intent', reason: 'info_medium' }
  }
  if (mode === 'companionship' || mode === 'presence' || mode === 'social') {
    return {
      responseLength: /** @type {ResponseLength} */ (leadConversation ? 'medium' : 'short'),
      source: 'conversation_mode',
      reason: 'companion_length',
    }
  }
  return { responseLength: /** @type {ResponseLength} */ ('medium'), source: 'writer_style', reason: 'default_medium' }
}

/**
 * @param {boolean} leadConversation
 * @param {ConversationMode} mode
 * @param {boolean} social
 */
function resolveInitiative(leadConversation, mode, social) {
  if (leadConversation) {
    return { initiative: /** @type {InitiativeLevel} */ ('high'), source: 'conversation_mode', reason: 'lead_high' }
  }
  if (social || mode === 'companionship' || mode === 'exploration') {
    return { initiative: /** @type {InitiativeLevel} */ ('medium'), source: 'social_intent', reason: 'social_medium' }
  }
  if (mode === 'information' || mode === 'teaching' || mode === 'problem_solving') {
    return { initiative: /** @type {InitiativeLevel} */ ('medium'), source: 'conversation_intent', reason: 'info_medium' }
  }
  return { initiative: /** @type {InitiativeLevel} */ ('low'), source: 'writer_style', reason: 'default_low' }
}

/**
 * Build hard rules text from directives.
 * @param {Omit<WriterDirectives, 'hardRules'|'validationChecklist'|'writerBrief'|'immutable'|'priorityOrder'|'reasons'|'sources'> & { language: DirectiveLanguage, mode: ConversationMode }} d
 * @returns {string[]}
 */
function buildHardRules(d) {
  /** @type {string[]} */
  const rules = [
    'WRITER DIRECTIVES ARE MANDATORY — not suggestions, not optional hints.',
    `language=${d.language} → respond ENTIRELY in ${languageLabel(d.language)}. Never switch casually.`,
  ]

  if (d.mode === 'companionship' || d.mode === 'social') {
    rules.push(
      'mode=companionship → priority: connection, presence, natural conversation. NOT teaching. NOT explaining. NOT problem solving.',
    )
  } else if (d.mode === 'presence') {
    rules.push('mode=presence → recognize emotion/presence first; solutions only if needed.')
  } else if (d.mode === 'exploration') {
    rules.push('mode=exploration → explore together; insight over dump.')
  } else if (d.mode === 'information' || d.mode === 'teaching' || d.mode === 'problem_solving') {
    rules.push(`mode=${d.mode} → serve the real goal clearly, still human — never helpdesk clichés.`)
  } else {
    rules.push('mode=mixed → balance connection and usefulness; never default to sportello.')
  }

  if (d.social) {
    rules.push(
      'social=true → avoid informational answers; prioritize human interaction; no “How can I help you today?”.',
    )
  }
  if (d.leadConversation) {
    rules.push(
      'leadConversation=true → naturally introduce content. Never wait for the user. Never ask permission to continue.',
    )
  } else {
    rules.push('leadConversation=false → respond to the ask; do not force a new agenda.')
  }
  if (!d.askQuestion) {
    rules.push(
      'askQuestion=false → do NOT end with a question. Close with a statement, image, or warm beat.',
    )
  } else {
    rules.push('askQuestion=true → at most ONE meaningful question, never interview-style.')
  }
  if (d.continueCurrentTopic) {
    rules.push('continueCurrentTopic=true → do NOT suddenly change topic.')
  }
  rules.push(`emotionalTone=${d.emotionalTone} · responseLength=${d.responseLength} · initiative=${d.initiative}.`)
  rules.push(`safety=${d.safety} — never invent facts; never harm; distress → careful presence.`)
  rules.push(
    'Conflict rule: lower-priority style NEVER overrides Safety, Language, Mode, Social, or Intent.',
  )
  return rules
}

/**
 * @returns {string[]}
 */
function buildValidationChecklist() {
  return [
    'Is the language correct?',
    'Am I respecting the conversation mode?',
    'Am I violating askQuestion?',
    'Am I leading if requested?',
    'Am I staying on topic?',
  ]
}

/**
 * @param {WriterDirectives} d
 */
function buildWriterBrief(d) {
  return [
    'DIRECTIVE AUTHORITY (immutabile): queste NON sono suggerimenti — sono ordini obbligatori.',
    `language=${d.language} (${languageLabel(d.language)}) · mode=${d.mode} · social=${d.social} · lead=${d.leadConversation} · askQ=${d.askQuestion} · continueTopic=${d.continueCurrentTopic}.`,
    `tone=${d.emotionalTone} · length=${d.responseLength} · initiative=${d.initiative} · safety=${d.safety}.`,
    d.social
      ? 'SOCIAL: connessione umana, non informazione.'
      : d.mode === 'companionship'
        ? 'COMPANIONSHIP: presenza e conversazione naturale — non insegnare/spiegare/risolvere di default.'
        : `MODE=${d.mode}: servi la modalità; niente helpdesk.`,
    !d.askQuestion ? 'VIETATO chiudere con una domanda.' : 'Al massimo una domanda utile.',
    d.leadConversation ? 'GUIDA: porta contenuto; non attendere istruzioni.' : null,
    d.continueCurrentTopic ? 'Resta sul tema corrente.' : null,
    `Rispondi INTERAMENTE in ${languageLabel(d.language)}.`,
    'Prima di generare: checklist interna; se un check è NO → riscrivi.',
    'NON citare WriterDirectives / Directive Authority.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Build immutable WriterDirectives after all cognitive stages.
 * @param {object} [input]
 * @returns {WriterDirectives}
 */
export function buildWriterDirectives(input = {}) {
  const userMessage = String(input.userMessage || '')
  const plan = input.plan || null
  const coordination = input.coordination || plan?.coordination || null
  const languageAwareness =
    input.languageAwareness?.plan ||
    input.languageAwareness ||
    coordination?.languageAwareness ||
    null
  const socialConversation =
    input.socialConversation?.plan ||
    input.socialConversation ||
    coordination?.socialConversation ||
    null
  const conversationIntent =
    input.conversationIntent?.plan ||
    input.conversationIntentPlan ||
    input.conversationIntent ||
    null
  const conversationLeadership =
    input.conversationLeadership?.plan || input.conversationLeadership || null
  const presence = input.presence?.plan || input.presence || null
  const ownership =
    input.conversationOwnership?.plan ||
    input.conversationOwnership ||
    coordination?.conversationOwnership ||
    null
  const worthReading =
    input.worthReading?.plan || input.worthReading || coordination?.worthReading || null
  const questionEconomy = input.questionEconomy?.plan || input.questionEconomy || null
  const warmConversation = input.warmConversation?.plan || input.warmConversation || null
  const welcome = input.welcome?.plan || input.welcome || null
  const topicLeadership = input.topicLeadership?.plan || input.topicLeadership || null
  const behavior = input.behavior?.plan || input.behavior || plan?.behavior || null

  const packed = {
    ...input,
    plan,
    coordination,
    languageAwareness,
    socialConversation,
    conversationIntent,
    conversationLeadership,
    presence,
    conversationOwnership: ownership,
    worthReading,
    questionEconomy,
    warmConversation,
    welcome,
    topicLeadership,
    behavior,
  }

  /** @type {Record<string, string>} */
  const sources = {}
  /** @type {string[]} */
  const reasons = []

  // 1. Safety (highest)
  /** @type {SafetyLevel} */
  let safety = 'normal'
  let safetyForcedPresence = false
  if (DISTRESS.test(userMessage)) {
    safety = 'strict'
    safetyForcedPresence = true
    sources.safety = 'distress_signal'
    reasons.push('safety_strict')
  } else if (
    conversationIntent?.inference?.emotionalIntent === 'anxious_reassurance' ||
    conversationIntent?.inference?.emotionalIntent === 'venting' ||
    conversationIntent?.inference?.emotionalIntent === 'comfort'
  ) {
    safety = 'careful'
    sources.safety = 'emotional_care'
    reasons.push('safety_careful')
  } else {
    sources.safety = 'default_normal'
  }

  // 2. Language
  const langCode =
    languageAwareness?.replyLanguage ||
    plan?.understanding?.language ||
    detectDominantLanguage(userMessage)
  const language = mapReplyLanguage(langCode)
  sources.language = languageAwareness?.active
    ? `language_awareness:${langCode}`
    : `detect:${langCode}`
  reasons.push(`language_${language}`)

  // 3–5. Mode / Social / Intent
  const social = Boolean(socialConversation?.isSocial || socialConversation?.mode === 'social')
  sources.social = social
    ? `social:${socialConversation?.socialIntent || 'true'}`
    : socialConversation?.mode === 'mixed'
      ? 'social:mixed'
      : 'social:false'
  reasons.push(social ? 'social_true' : 'social_false')

  const modeResolved = resolveMode({ ...packed, safetyForcedPresence })
  const mode = modeResolved.mode
  sources.mode = `${modeResolved.source}:${mode}`
  reasons.push(...modeResolved.reasons)

  // askQuestion / lead / topic
  const ask = resolveAskQuestion(packed, mode, social)
  sources.askQuestion = `${ask.source}:${ask.reason}`
  reasons.push(ask.reason)

  const lead = resolveLeadConversation(packed, mode, social)
  sources.leadConversation = `${lead.source}:${lead.reason}`
  reasons.push(lead.reason)

  const topicHold = resolveContinueTopic(packed)
  sources.continueCurrentTopic = `${topicHold.source}:${topicHold.reason}`
  reasons.push(topicHold.reason)

  // 6. Emotional tone
  const rawTone =
    plan?.understanding?.emotionalTone ||
    (conversationIntent?.inference
      ? conversationIntent.inference.emotionalIntent
      : null) ||
    (social ? 'warm' : 'neutral')
  let emotionalTone = mapEmotionalTone(rawTone)
  if (social && emotionalTone === 'neutral') emotionalTone = 'warm'
  if (mode === 'companionship' && emotionalTone === 'neutral') emotionalTone = 'warm'
  sources.emotionalTone = `tone:${emotionalTone}`
  reasons.push(`tone_${emotionalTone}`)

  // 7. Writer style (length / initiative)
  const length = resolveLength(packed, mode, social, lead.leadConversation)
  sources.responseLength = `${length.source}:${length.reason}`
  const initiative = resolveInitiative(lead.leadConversation, mode, social)
  sources.initiative = `${initiative.source}:${initiative.reason}`

  const topic =
    plan?.understanding?.topic ||
    input.session?.currentTopic ||
    conversationLeadership?.theme ||
    null

  /** @type {WriterDirectives} */
  const directives = {
    immutable: true,
    language,
    mode,
    social,
    leadConversation: lead.leadConversation,
    askQuestion: ask.askQuestion,
    continueCurrentTopic: topicHold.continueCurrentTopic,
    emotionalTone,
    responseLength: length.responseLength,
    initiative: initiative.initiative,
    safety,
    topic: topic ? String(topic).slice(0, 80) : null,
    priorityOrder: [...DIRECTIVE_PRIORITY_ORDER],
    hardRules: [],
    validationChecklist: buildValidationChecklist(),
    reasons: reasons.slice(0, 16),
    sources,
    writerBrief: '',
  }

  directives.hardRules = buildHardRules(directives)
  directives.writerBrief = buildWriterBrief(directives)

  // Freeze — immutable authority object
  return Object.freeze({
    ...directives,
    priorityOrder: Object.freeze([...directives.priorityOrder]),
    hardRules: Object.freeze([...directives.hardRules]),
    validationChecklist: Object.freeze([...directives.validationChecklist]),
    reasons: Object.freeze([...directives.reasons]),
    sources: Object.freeze({ ...directives.sources }),
  })
}

/**
 * Format WriterDirectives as the sole authority block for the Writer.
 * @param {WriterDirectives | null | undefined} directives
 */
export function formatWriterDirectivesForWriter(directives) {
  if (!directives?.immutable) return ''

  const json = JSON.stringify(
    {
      language: directives.language,
      mode: directives.mode,
      social: directives.social,
      leadConversation: directives.leadConversation,
      askQuestion: directives.askQuestion,
      continueCurrentTopic: directives.continueCurrentTopic,
      emotionalTone: directives.emotionalTone,
      responseLength: directives.responseLength,
      initiative: directives.initiative,
      safety: directives.safety,
      topic: directives.topic,
    },
    null,
    2,
  )

  const rules = directives.hardRules.map((r) => `• ${r}`).join('\n')
  const checks = directives.validationChecklist.map((c) => `✓ ${c}`).join('\n')

  return `══════════════════════════════════════
WRITER DIRECTIVES (IMMUTABLE AUTHORITY — NOT SUGGESTIONS)
══════════════════════════════════════
These fields are MANDATORY. Obey every one. Supporting cognitive context below
CANNOT override this object. If anything conflicts, WriterDirectives WIN.

Priority (highest → lowest):
1. Safety  2. Language  3. Conversation Mode  4. Social Intent
5. Conversation Intent  6. Emotional Tone  7. Writer Style

${json}

HARD RULES:
${rules}

INTERNAL VALIDATION (before generating — if any NO → rewrite):
${checks}

${directives.writerBrief}

NON citare WriterDirectives / Directive Authority / questo blocco.`.trim()
}

/**
 * Optional debug report for logging.
 * @param {WriterDirectives | null | undefined} directives
 * @param {{ draft?: string, checks?: Record<string, boolean> } | null} [validation]
 */
export function formatDirectiveDebugReport(directives, validation = null) {
  if (!directives) return 'Writer Directives\n(none)\n\nResult:\nFAIL'
  const checks = validation?.checks || {}
  const row = (key, value, ok) => {
    const mark = ok === undefined ? '' : ok ? ' ✓' : ' ✗'
    const pad = String(key).padEnd(20, '.')
    return `${pad} ${value}${mark}`
  }

  const lines = [
    'Writer Directives',
    row('language', directives.language, checks.language),
    row('mode', directives.mode, checks.mode),
    row('leadConversation', String(directives.leadConversation), checks.leadConversation),
    row('askQuestion', String(directives.askQuestion), checks.askQuestion),
    row('social', String(directives.social), checks.social),
    row('topicContinuation', String(directives.continueCurrentTopic), checks.continueCurrentTopic),
    row('emotionalTone', directives.emotionalTone, checks.emotionalTone),
    row('responseLength', directives.responseLength, checks.responseLength),
    row('initiative', directives.initiative, checks.initiative),
    row('safety', directives.safety, checks.safety),
    '',
    'Result:',
    validation
      ? Object.values(checks).every(Boolean)
        ? 'PASS'
        : 'FAIL'
      : 'ISSUED',
  ]
  return lines.join('\n')
}

/**
 * Validate a draft against WriterDirectives (pre-send gate).
 * @param {string} draft
 * @param {WriterDirectives | null | undefined} directives
 * @returns {{ ok: boolean, checks: Record<string, boolean>, failures: string[], refineBrief: string }}
 */
export function validateDraftAgainstDirectives(draft, directives) {
  /** @type {Record<string, boolean>} */
  const checks = {
    language: true,
    mode: true,
    askQuestion: true,
    leadConversation: true,
    continueCurrentTopic: true,
    social: true,
    emotionalTone: true,
    responseLength: true,
    initiative: true,
    safety: true,
  }
  /** @type {string[]} */
  const failures = []

  if (!directives?.immutable) {
    return { ok: true, checks, failures, refineBrief: '' }
  }

  const text = String(draft || '').trim()
  if (!text) {
    return {
      ok: false,
      checks: { ...checks, language: false },
      failures: ['empty_draft'],
      refineBrief: 'Directive Authority: draft vuoto — riscrivi rispettando WriterDirectives.',
    }
  }

  // Language
  if (directives.language === 'english' || directives.language === 'italian') {
    const detected = detectDominantLanguage(text)
    const expected = directives.language === 'english' ? 'en' : 'it'
    // Short social replies may be auto; still enforce when clearly wrong language
    if (detected !== 'auto' && detected !== expected) {
      checks.language = false
      failures.push(`language_expected_${directives.language}_got_${detected}`)
    }
    // Heuristic: Italian greeting when English required
    if (
      directives.language === 'english' &&
      /^(ciao|buongiorno|buonasera|salve|come stai)\b/i.test(text)
    ) {
      checks.language = false
      failures.push('language_italian_opener_in_english_mode')
    }
    if (
      directives.language === 'italian' &&
      /^(hi|hey|hello|how are you|good (morning|night))\b/i.test(text) &&
      !/\b(ciao|come|sono|perché|grazie)\b/i.test(text)
    ) {
      checks.language = false
      failures.push('language_english_opener_in_italian_mode')
    }
  }

  // askQuestion
  if (!directives.askQuestion) {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (/[?？]\s*$/.test(trimmed) || /\?\s*[😊🙂😉🔥✨]*\s*$/.test(trimmed)) {
      checks.askQuestion = false
      failures.push('ends_with_question')
    }
  }

  // Social / companionship — helpdesk openers
  if (directives.social || directives.mode === 'companionship') {
    if (
      /how can i help|what would you like to (discuss|talk)|is there anything else|feel free to ask|come posso aiutarti|dimmi pure\.|sono qui se ti serve/i.test(
        text,
      )
    ) {
      checks.social = false
      checks.mode = false
      failures.push('helpdesk_wording')
    }
  }

  // leadConversation — pure ack / waiting
  if (directives.leadConversation) {
    if (
      /^(ok\.?|okay\.?|sure\.?|got it\.?|capito\.?|va bene\.?)\s*$/i.test(text) ||
      /let me know what you want|tell me what you.?d like|what do you want (to|me) to/i.test(text)
    ) {
      checks.leadConversation = false
      failures.push('not_leading')
    }
  }

  const ok = failures.length === 0
  /** @type {string[]} */
  const briefParts = []
  if (!checks.language) {
    briefParts.push(
      `LANGUAGE MANDATORY: rewrite ENTIRELY in ${languageLabel(directives.language)}. Do not use another language.`,
    )
  }
  if (!checks.askQuestion) {
    briefParts.push(
      'askQuestion=false: remove the closing question; end with a statement or warm beat.',
    )
  }
  if (!checks.social || !checks.mode) {
    briefParts.push(
      `mode=${directives.mode}${directives.social ? ' · social=true' : ''}: connection/presence first — no helpdesk, no teaching dump.`,
    )
  }
  if (!checks.leadConversation) {
    briefParts.push(
      'leadConversation=true: introduce content naturally; do not wait for the user.',
    )
  }
  if (directives.continueCurrentTopic && failures.includes('topic_change')) {
    briefParts.push('continueCurrentTopic=true: stay on the current topic.')
  }

  return {
    ok,
    checks,
    failures,
    refineBrief: ok
      ? ''
      : [
          'DIRECTIVE AUTHORITY REWRITE (mandatory): the draft violated WriterDirectives.',
          ...briefParts,
          `Keep: language=${directives.language}, mode=${directives.mode}, social=${directives.social}, lead=${directives.leadConversation}, askQ=${directives.askQuestion}, continueTopic=${directives.continueCurrentTopic}.`,
          'Do not mention directives. Output only the corrected reply.',
        ].join(' '),
  }
}

/**
 * Soft local enforcements when safe (no LLM). Fail-soft.
 * @param {string} draft
 * @param {WriterDirectives | null | undefined} directives
 */
export function softEnforceDirectives(draft, directives) {
  let text = String(draft || '')
  if (!directives?.immutable || !text.trim()) return text

  // askQuestion=false: strip a trailing question sentence when the rest is solid
  if (!directives.askQuestion) {
    const parts = text.trim().split(/(?<=[.!…])\s+/)
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]
      if (/[?？]/.test(last) && last.length < 120) {
        text = parts.slice(0, -1).join(' ').trim()
      }
    }
  }

  return text
}

/**
 * Log debug report when enabled.
 * @param {WriterDirectives} directives
 * @param {object} [opts]
 */
export function maybeLogDirectiveDebug(directives, opts = {}) {
  const enabled =
    opts.debug === true ||
    opts.debugDirectives === true ||
    String(process.env.LAIFE_DEBUG_DIRECTIVES || '') === '1'
  if (!enabled || !directives) return
  try {
    console.info(
      formatDirectiveDebugReport(directives, opts.validation || null),
    )
  } catch {
    /* fail-soft */
  }
}

/**
 * Run Directive Authority: build + format + optional debug.
 * @param {object} [input]
 * @returns {{ directives: WriterDirectives, context: string, debugReport: string }}
 */
export function runDirectiveAuthority(input = {}) {
  try {
    const directives = buildWriterDirectives(input)
    maybeLogDirectiveDebug(directives, input)
    return {
      directives,
      context: formatWriterDirectivesForWriter(directives),
      debugReport: formatDirectiveDebugReport(directives),
    }
  } catch {
    const fallback = Object.freeze({
      immutable: /** @type {true} */ (true),
      language: /** @type {DirectiveLanguage} */ ('auto'),
      mode: /** @type {ConversationMode} */ ('mixed'),
      social: false,
      leadConversation: false,
      askQuestion: false,
      continueCurrentTopic: true,
      emotionalTone: /** @type {DirectiveEmotionalTone} */ ('neutral'),
      responseLength: /** @type {ResponseLength} */ ('medium'),
      initiative: /** @type {InitiativeLevel} */ ('medium'),
      safety: /** @type {SafetyLevel} */ ('normal'),
      topic: null,
      priorityOrder: Object.freeze([...DIRECTIVE_PRIORITY_ORDER]),
      hardRules: Object.freeze([
        'WRITER DIRECTIVES ARE MANDATORY — fail-soft defaults active.',
        'askQuestion=false by default.',
      ]),
      validationChecklist: Object.freeze(buildValidationChecklist()),
      reasons: Object.freeze(['fail_soft']),
      sources: Object.freeze({ fail: 'soft' }),
      writerBrief:
        'DIRECTIVE AUTHORITY fail-soft: language=auto · mode=mixed · askQ=false — resta umano; non citare.',
    })
    return {
      directives: fallback,
      context: formatWriterDirectivesForWriter(fallback),
      debugReport: formatDirectiveDebugReport(fallback),
    }
  }
}
