/**
 * #324 — Conversation State MVP (Core only).
 *
 * Cheap deterministic turn-level signals injected as a compact appendix into the
 * SAME OpenAI request. No second LLM, no Cognitive/V1/V2, no Memory persistence.
 *
 * Soft presentation guidance — never overrides safety, truth, or capabilities.
 */

export const CONVERSATION_STATE_BUILD = '324-1'

/** Soft cap for appendix size (chars). Target ~200–400 tokens ≈ ≤1600 chars. */
export const CONVERSATION_STATE_APPENDIX_MAX_CHARS = 1600

/** Bounded recent history for heuristics (user+assistant turns). */
export const CONVERSATION_STATE_RECENT_TURNS = 8

/** @typedef {'casual'|'informational'|'teaching'|'problem_solving'|'debugging'|'brainstorming'|'decision_support'|'celebration'|'emotional_support'|'quick_answer'} ConversationMode */
/** @typedef {'answer'|'explain'|'react'|'clarify'|'recommend'|'brainstorm'|'comfort'|'continue'} ResponsePurpose */
/** @typedef {'short'|'medium'|'detailed'} DesiredDepth */
/** @typedef {'neutral'|'excited'|'frustrated'|'playful'|'serious'|'curious'|'celebratory'} EmotionalTone */
/** @typedef {'none'|'light'|'moderate'|'expressive'} EmojiLevel */
/** @typedef {'low'|'normal'|'high'} InitiativeLevel */
/** @typedef {'prose'|'light_structure'|'structured'} StructurePreference */
/** @typedef {'low'|'medium'|'high'} ConfidenceLevel */

/**
 * @typedef {{
 *   conversationMode: ConversationMode
 *   responsePurpose: ResponsePurpose
 *   desiredDepth: DesiredDepth
 *   emotionalTone: EmotionalTone
 *   emojiLevel: EmojiLevel
 *   initiativeLevel: InitiativeLevel
 *   questionNeeded: boolean
 *   acknowledgementNeeded: boolean
 *   structurePreference: StructurePreference
 *   confidence: ConfidenceLevel
 *   explicitOverrides: string[]
 *   recentTurnCount: number
 * }} ConversationState
 */

/**
 * Session-only style fingerprints — foundation for #326 (no active steering here).
 * Never persisted to Memory / Supabase.
 *
 * @typedef {{
 *   lastResponseLengthBucket: 'short'|'medium'|'long'|null
 *   lastEndingWasQuestion: boolean|null
 *   recentOpeningTypes: string[]
 *   recentAcknowledgementTypes: string[]
 *   recentEmojis: string[]
 * }} SessionStyleState
 */

/**
 * @typedef {{
 *   role?: string
 *   content?: string
 * }} ConversationStateMessage
 */

/**
 * @typedef {{
 *   userMessage?: string
 *   recentMessages?: ConversationStateMessage[]
 *   settings?: {
 *     replyLength?: string|null
 *     useEmojis?: boolean|null
 *   }
 *   workingState?: { activeTask?: string, decisions?: string[], constraints?: string[] } | null
 *   sessionStyle?: SessionStyleState | null
 * }} ComputeConversationStateInput
 */

export function createEmptySessionStyleState() {
  return {
    lastResponseLengthBucket: null,
    lastEndingWasQuestion: null,
    recentOpeningTypes: [],
    recentAcknowledgementTypes: [],
    recentEmojis: [],
  }
}

/**
 * Collect fingerprints from an assistant reply (schema foundation for #326).
 * Not used for steering in #324.
 *
 * @param {string} assistantText
 * @param {SessionStyleState | null | undefined} [prev]
 * @returns {SessionStyleState}
 */
export function collectSessionStyleFingerprints(assistantText, prev) {
  const base = prev && typeof prev === 'object' ? prev : createEmptySessionStyleState()
  const text = String(assistantText || '').trim()
  if (!text) return { ...base }

  const len = text.length
  const lastResponseLengthBucket = len < 120 ? 'short' : len < 600 ? 'medium' : 'long'
  const lastEndingWasQuestion = /\?\s*$/.test(text)

  const firstLine = text.split(/\n/)[0] || text
  const opening = classifyOpeningType(firstLine)
  const ack = classifyAcknowledgementType(firstLine)
  const emojis = extractEmojis(text).slice(0, 8)

  return {
    lastResponseLengthBucket,
    lastEndingWasQuestion,
    recentOpeningTypes: pushCap(base.recentOpeningTypes, opening, 6),
    recentAcknowledgementTypes: ack
      ? pushCap(base.recentAcknowledgementTypes, ack, 6)
      : [...(base.recentAcknowledgementTypes || [])].slice(0, 6),
    recentEmojis: mergeRecentEmojis(base.recentEmojis, emojis, 12),
  }
}

/**
 * @param {ComputeConversationStateInput} input
 * @returns {ConversationState}
 */
export function computeConversationState(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {}
  const recent = selectRecentMessages(input.recentMessages || [], CONVERSATION_STATE_RECENT_TURNS)
  const latestFromRecent = [...recent].reverse().find((m) => m.role === 'user')
  const rawUser =
    typeof input.userMessage === 'string' && input.userMessage.trim()
      ? input.userMessage
      : typeof latestFromRecent?.content === 'string'
        ? latestFromRecent.content
        : ''
  const userMessage = normalizeText(rawUser)
  const overrides = detectExplicitOverrides(userMessage)

  const shortFollowUp = isShortFollowUp(userMessage)
  const priorMode = inferPriorModeFromHistory(recent)
  const isCorrection = looksLikeCorrection(userMessage)
  const isTechnicalContext = looksTechnicalContext(recent, input.workingState)

  let conversationMode = inferConversationMode(userMessage, {
    shortFollowUp,
    priorMode,
    isCorrection,
    isTechnicalContext,
    workingState: input.workingState || null,
  })

  let responsePurpose = inferResponsePurpose(userMessage, conversationMode, {
    isCorrection,
    shortFollowUp,
  })

  let emotionalTone = inferEmotionalTone(userMessage, conversationMode)
  let desiredDepth = inferDesiredDepth(userMessage, conversationMode, settings, overrides)
  let emojiLevel = inferEmojiLevel(conversationMode, emotionalTone, settings, overrides)
  let initiativeLevel = inferInitiativeLevel(conversationMode, responsePurpose)
  let structurePreference = inferStructurePreference(
    userMessage,
    conversationMode,
    overrides,
  )
  let questionNeeded = inferQuestionNeeded(userMessage, conversationMode, responsePurpose, {
    isCorrection,
    overrides,
  })
  let acknowledgementNeeded = inferAcknowledgementNeeded(
    userMessage,
    conversationMode,
    responsePurpose,
    { isCorrection, emotionalTone },
  )
  let confidence = inferConfidence(conversationMode, responsePurpose, userMessage)

  // Explicit overrides always win for style axes.
  if (overrides.desiredDepth) desiredDepth = overrides.desiredDepth
  if (overrides.emojiLevel) emojiLevel = overrides.emojiLevel
  if (overrides.structurePreference) structurePreference = overrides.structurePreference
  if (overrides.forceTeaching) {
    conversationMode = 'teaching'
    if (responsePurpose === 'answer' || responsePurpose === 'react') {
      responsePurpose = 'explain'
    }
  }
  if (overrides.forceShort) {
    desiredDepth = 'short'
    if (structurePreference === 'structured' && !overrides.structurePreference) {
      structurePreference = 'prose'
    }
  }

  // Correction bias (after mode infer, before return).
  if (isCorrection) {
    responsePurpose = 'continue'
    acknowledgementNeeded = true
    if (!overrides.desiredDepth) {
      desiredDepth = desiredDepth === 'detailed' ? 'medium' : 'short'
    }
    if (!overrides.forceInteractive) questionNeeded = false
  }

  return {
    conversationMode,
    responsePurpose,
    desiredDepth,
    emotionalTone,
    emojiLevel,
    initiativeLevel,
    questionNeeded,
    acknowledgementNeeded,
    structurePreference,
    confidence,
    explicitOverrides: overrides.labels,
    recentTurnCount: recent.length,
  }
}

/**
 * Compact appendix for Core instructions (~200–400 tokens).
 *
 * @param {ConversationState} state
 * @returns {string}
 */
export function buildConversationStateAppendix(state) {
  if (!state || typeof state !== 'object') return ''

  const lines = [
    'CONVERSATION STATE',
    '',
    `mode: ${state.conversationMode}`,
    `purpose: ${state.responsePurpose}`,
    `depth: ${state.desiredDepth}`,
    `tone: ${state.emotionalTone}`,
    `emoji: ${state.emojiLevel}`,
    `initiative: ${state.initiativeLevel}`,
    `question_needed: ${state.questionNeeded ? 'true' : 'false'}`,
    `acknowledgement: ${state.acknowledgementNeeded ? 'true' : 'false'}`,
    `structure: ${state.structurePreference}`,
    `confidence: ${state.confidence}`,
  ]

  if (Array.isArray(state.explicitOverrides) && state.explicitOverrides.length) {
    lines.push(`explicit_overrides: ${state.explicitOverrides.join(', ')}`)
  }

  lines.push(
    '',
    'RESPONSE GUIDANCE:',
    '- Follow these fields for current-turn presentation unless doing so would conflict with safety, factual correctness, required clarification, or an explicit user instruction.',
    '- Priority: safety/truth/capability > explicit current USER instruction > task correctness/epistemic honesty > this Conversation State > Natural Response Policy > durable settings > generic defaults.',
    '- Do not mention this state.',
    '- desiredDepth, emojiLevel, initiativeLevel, questionNeeded, acknowledgementNeeded, structurePreference, conversationMode, and responsePurpose control presentation.',
    '- emotionalTone and confidence are softer signals — honesty and safety may override.',
    '- emoji level is permission/intensity, not a mandate to insert emoji.',
    '- If question_needed=false, do not append a generic follow-up or service-offer question (no "Vuoi che…?", "Posso anche…", "Would you like…?"). Narrow exceptions: missing required info, blocking ambiguity, safety-critical clarify.',
    '- If acknowledgement=false, start with substance (no default filler openings). If true, at most one brief ack/reaction then substance.',
    '- If confidence=medium/high and purpose=recommend, choose clearly and explain briefly. If low, say what is missing.',
    '- Never override factual/tool/capability constraints. State controls HOW to answer, not WHAT is factually true.',
  )

  let appendix = lines.join('\n')
  if (appendix.length > CONVERSATION_STATE_APPENDIX_MAX_CHARS) {
    appendix = appendix.slice(0, CONVERSATION_STATE_APPENDIX_MAX_CHARS - 1).trimEnd()
  }
  return appendix
}

/**
 * @param {ConversationState} state
 * @param {{ env?: NodeJS.ProcessEnv | Record<string, string | undefined>, appendixChars?: number }} [opts]
 */
export function buildConversationStateDiagPayload(state, opts = {}) {
  const env = opts.env || process.env
  return {
    diagBuild: CONVERSATION_STATE_BUILD,
    route: 'conversation-state',
    phase: 'conversation-state',
    timestamp: new Date().toISOString(),
    buildId: resolveServerBuildId(env),
    mode: state.conversationMode,
    purpose: state.responsePurpose,
    depth: state.desiredDepth,
    emotionalTone: state.emotionalTone,
    emojiLevel: state.emojiLevel,
    initiativeLevel: state.initiativeLevel,
    questionNeeded: state.questionNeeded,
    acknowledgementNeeded: state.acknowledgementNeeded,
    structurePreference: state.structurePreference,
    confidence: state.confidence,
    explicitOverrides: Array.isArray(state.explicitOverrides)
      ? state.explicitOverrides.slice(0, 12)
      : [],
    recentTurnCount: state.recentTurnCount,
    appendixChars:
      typeof opts.appendixChars === 'number' ? opts.appendixChars : null,
  }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isConversationStateDiagEnvAllowed(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (v === 'preview' || v === 'development') return true
  if (
    env.CONVERSATION_STATE_DIAG === '1' ||
    env.CONVERSATION_STATE_DIAG === 'true'
  ) {
    return true
  }
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any, url?: string }} req
 * @param {Record<string, unknown>} [body]
 */
export function isConversationStateDiagRequested(req, body) {
  try {
    const h = req?.headers || {}
    const header =
      h['x-shinkaido-conversation-state-diag'] ||
      h['X-Shinkaido-Conversation-State-Diag']
    if (header === '1' || header === 'true') return true
  } catch {
    /* soft */
  }
  try {
    const url = typeof req?.url === 'string' ? req.url : ''
    if (
      /[?&]conversation_state_diag=1(?:&|$)/i.test(url) ||
      /[?&]conversation_state_diag=true(?:&|$)/i.test(url)
    ) {
      return true
    }
  } catch {
    /* soft */
  }
  if (
    body &&
    (body.conversationStateDiag === true ||
      body.conversationStateDiag === 1 ||
      body.conversationStateDiag === '1')
  ) {
    return true
  }
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any, url?: string }} req
 * @param {Record<string, unknown>} [body]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isConversationStateDiagEnabled(req, body, env = process.env) {
  return (
    isConversationStateDiagEnvAllowed(env) &&
    isConversationStateDiagRequested(req, body)
  )
}

// —— internals ——

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
function resolveServerBuildId(env) {
  const sha =
    typeof env.VERCEL_GIT_COMMIT_SHA === 'string'
      ? env.VERCEL_GIT_COMMIT_SHA.trim()
      : ''
  if (sha) return sha.slice(0, 7)
  if (typeof env.VITE_BUILD_ID === 'string' && env.VITE_BUILD_ID.trim()) {
    return env.VITE_BUILD_ID.trim()
  }
  return 'dev'
}

/** @param {string} text */
function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ConversationStateMessage[]} messages
 * @param {number} maxTurns
 */
function selectRecentMessages(messages, maxTurns) {
  const list = Array.isArray(messages) ? messages : []
  const cleaned = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    }))
  if (cleaned.length <= maxTurns) return cleaned
  return cleaned.slice(-maxTurns)
}

/** @param {string} text */
function isShortFollowUp(text) {
  const t = normalizeText(text)
  if (!t || t.length > 40) return false
  return /^(ok|okay|ok\.|va\s*bene|s[iì]|si+|no|nope|vai|continua|continuiamo|avanti|esatto|certo|perfetto|grazie|thanks|thank\s*you|perch[eé]\??|come\??|e\s*poi\??|quello|quella|l['']altro|l['']altra|il\s*primo|il\s*secondo|la\s*prima|la\s*seconda|mm+|ahm+|ah+|ahah+|lol|haha+|yep|yeah|yes|go|continue|next|that\s*one|the\s*other)[.!?…]*$/i.test(
    t,
  )
}

/** @param {string} text */
function looksLikeCorrection(text) {
  const t = normalizeText(text)
  if (!t) return false
  return /\b(?:no[,:]?\s+intendevo|non\s+hai\s+capito|non\s+[eè]\s+quello|dicevo\s+l['']altro|[eè]\s+sbagliato|hai\s+sbagliato|non\s+era\s+quello|I\s+meant\s+the\s+other|that'?s\s+not\s+what\s+I\s+meant|you\s+misunderstood|wrong(?:\s+one)?)\b/i.test(
    t,
  )
}

/**
 * @param {ConversationStateMessage[]} recent
 * @param {{ activeTask?: string } | null | undefined} workingState
 */
function looksTechnicalContext(recent, workingState) {
  if (workingState && workingState.activeTask) return true
  const blob = recent
    .slice(-6)
    .map((m) => m.content || '')
    .join('\n')
    .toLowerCase()
  return /\b(api|http|401|403|500|error|errore|bug|stack\s*trace|exception|undefined|null\s*pointer|typescript|javascript|python|docker|sql|oauth|endpoint|server|client|compile|runtime|log[s]?|debug|deploy|jwt|cors)\b/i.test(
    blob,
  )
}

/**
 * @param {ConversationStateMessage[]} recent
 * @returns {ConversationMode | null}
 */
function inferPriorModeFromHistory(recent) {
  const blob = recent
    .slice(-6)
    .map((m) => m.content || '')
    .join('\n')
  if (
    /\b(api|401|errore|error|bug|stack|exception|non\s+funziona|debug)\b/i.test(blob)
  ) {
    return 'debugging'
  }
  if (/\b(idea|brainstorm|creare\s+un['']?app|dammi\s+qualche\s+idea)\b/i.test(blob)) {
    return 'brainstorming'
  }
  if (/\b(spiega|spiegami|come\s+funziona|lesson|insegn)\b/i.test(blob)) {
    return 'teaching'
  }
  if (/\b(quale\s+scegl|meglio\s+tra|a\s+o\s+b)\b/i.test(blob)) {
    return 'decision_support'
  }
  return null
}

/**
 * @param {string} userMessage
 * @param {{
 *   shortFollowUp: boolean
 *   priorMode: ConversationMode | null
 *   isCorrection: boolean
 *   isTechnicalContext: boolean
 *   workingState: { activeTask?: string } | null
 * }} ctx
 * @returns {ConversationMode}
 */
function inferConversationMode(userMessage, ctx) {
  const t = userMessage
  if (!t) return 'casual'

  if (ctx.isCorrection) {
    if (ctx.isTechnicalContext || ctx.priorMode === 'debugging') return 'debugging'
    if (ctx.priorMode) return ctx.priorMode
    return 'casual'
  }

  if (ctx.shortFollowUp) {
    if (ctx.priorMode) return ctx.priorMode
    if (ctx.isTechnicalContext) return 'debugging'
    if (/^(ahah+|haha+|lol|ahm+)/i.test(t)) return 'casual'
    if (/^(continua|continuiamo|vai|avanti|e\s*poi)/i.test(t)) {
      return ctx.priorMode || (ctx.isTechnicalContext ? 'debugging' : 'casual')
    }
    return 'casual'
  }

  // Celebration before frustration when success language dominates.
  if (
    /\b(finalmente\s+funziona|ce\s+l['']abbiamo\s+fatta|we\s+did\s+it|it\s+works|madonna\s+che\s+figata|che\s+figata|yay+|woo+t?)\b/i.test(
      t,
    ) ||
    (/!{2,}/.test(t) &&
      /\b(funziona|works|fatto|done|riuscit|succeeded|figata|grande)\b/i.test(t))
  ) {
    return 'celebration'
  }

  // Debugging beats emotional_support for technical frustration.
  if (
    /\b(401|403|500|stack\s*trace|exception|typescript\s+error|compile\s+error|this\s+code|questo\s+codice|api\s+restituisce|endpoint|bug)\b/i.test(
      t,
    ) ||
    (ctx.isTechnicalContext &&
      /\b(non\s+funziona|still\s+broken|che\s+palle|di\s+nuovo|ancora)\b/i.test(t))
  ) {
    return 'debugging'
  }

  if (
    /\b(non\s+funziona(?:\s+ancora)?|still\s+doesn'?t\s+work|errore|error|bug|debug|fixi|logs)\b/i.test(
      t,
    ) &&
    (ctx.isTechnicalContext ||
      /\b(api|codice|code|app|server|client|build|deploy)\b/i.test(t))
  ) {
    return 'debugging'
  }

  // Emotional support — conservative.
  if (
    /\b(mi\s+sento\s+(?:gi[uù]|male|solo|sola|perso|persa)|sono\s+gi[uù]|non\s+ce\s+la\s+faccio|ho\s+bisogno\s+di\s+parlare|i\s+feel\s+(?:sad|alone|lost|overwhelmed)|i'?m\s+(?:sad|depressed|lonely))\b/i.test(
      t,
    )
  ) {
    return 'emotional_support'
  }

  if (
    /\b(quale\s+(?:dei\s+due|scegl|prefer)|qual\s+[eè]\s+meglio|a\s+o\s+b|which\s+(?:one|should)|what\s+would\s+you\s+(?:choose|pick)|sceglieresti)\b/i.test(
      t,
    )
  ) {
    return 'decision_support'
  }

  if (
    /\b(dammi\s+(?:qualche\s+)?idee?|che\s+idee\s+hai|brainstorm|vorrei\s+creare|let'?s\s+brainstorm|give\s+me\s+(?:some\s+)?ideas|idee\s+per)\b/i.test(
      t,
    )
  ) {
    return 'brainstorming'
  }

  if (
    /\b(spiegamelo\s+come\s+se|come\s+se\s+non\s+sapessi|fammi\s+capire\s+bene|teach\s+me|explain\s+(?:it\s+)?(?:like|as\s+if)|eli5|passo\s+passo\s+da\s+zero)\b/i.test(
      t,
    )
  ) {
    return 'teaching'
  }

  if (
    /\b(come\s+(?:posso|possiamo)\s+risolv|how\s+(?:can|do)\s+i\s+(?:fix|solve|resolve)|risolvere\s+questo\s+problema)\b/i.test(
      t,
    )
  ) {
    return 'problem_solving'
  }

  if (
    /\b(cos[''][eè]\s+|che\s+cos[''][eè]\s+|what\s+is\s+|what'?s\s+|define\s+|definizione\s+di)\b/i.test(
      t,
    )
  ) {
    return 'informational'
  }

  if (/\b(perch[eé]\s+(?:questa|questo|l['']|la\s+|il\s+)|why\s+(?:does|is|do)\b)/i.test(t)) {
    if (/\b(api|401|403|500|error|errore|bug|codice|code)\b/i.test(t) || ctx.isTechnicalContext) {
      return 'debugging'
    }
    return 'informational'
  }

  // Casual greetings / boredom / banter
  if (
    /^(ciao|hey|hi|hello|salve|yo|come\s+va\??|che\s+fai\??|come\s+stai\??|what'?s\s+up\??|how\s+are\s+you\??)[.!]*$/i.test(
      t,
    ) ||
    /\b(mi\s+annoio|i'?m\s+bored|che\s+noia)\b/i.test(t) ||
    /^(ahah+|haha+|lol|eheh+)[.!]*$/i.test(t)
  ) {
    return 'casual'
  }

  if (t.length <= 24 && !/[?]/.test(t) && !/\b(spiega|explain|come|how|why|perch)/i.test(t)) {
    return 'casual'
  }

  if (t.length <= 60 && /\?$/.test(t) && !/\b(spiega|explain|dettagl|confronta|compare)\b/i.test(t)) {
    return 'quick_answer'
  }

  if (ctx.workingState?.activeTask) return 'problem_solving'

  return 'informational'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{ isCorrection: boolean, shortFollowUp: boolean }} ctx
 * @returns {ResponsePurpose}
 */
function inferResponsePurpose(userMessage, mode, ctx) {
  if (ctx.isCorrection) return 'continue'
  if (ctx.shortFollowUp) {
    if (/^(continua|continuiamo|vai|avanti|e\s*poi|go|continue|next)/i.test(userMessage)) {
      return 'continue'
    }
    if (/^(perch|why|come\??|how\??)/i.test(userMessage)) return 'explain'
    if (/^(ahah|haha|lol|ok|s[iì]|esatto|yep|yeah)/i.test(userMessage)) return 'react'
    return 'continue'
  }

  if (mode === 'celebration' || mode === 'casual') {
    if (/^(ciao|hey|hi|hello|come\s+va)/i.test(userMessage)) return 'react'
    if (/\bmi\s+annoio\b/i.test(userMessage)) return 'brainstorm'
    return 'react'
  }
  if (mode === 'emotional_support') return 'comfort'
  if (mode === 'brainstorming') return 'brainstorm'
  if (mode === 'decision_support') return 'recommend'
  if (mode === 'teaching' || mode === 'informational') return 'explain'
  if (mode === 'debugging' || mode === 'problem_solving') return 'continue'
  if (mode === 'quick_answer') return 'answer'
  if (/\b(chiaris|clarify|intendi|you\s+mean)\b/i.test(userMessage)) return 'clarify'
  return 'answer'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @returns {EmotionalTone}
 */
function inferEmotionalTone(userMessage, mode) {
  const t = userMessage
  if (mode === 'celebration') return 'celebratory'
  if (
    /!{2,}/.test(t) ||
    /\b(wow+|finalmente|figata|fantastico|amazing|awesome|yay+)\b/i.test(t)
  ) {
    return mode === 'celebration' ? 'celebratory' : 'excited'
  }
  if (
    /\b(che\s+palle|non\s+funziona|still\s+broken|frustrat|odio|damn|shit|cavolo)\b/i.test(t)
  ) {
    return 'frustrated'
  }
  if (/^(ahah+|haha+|lol|eheh+)/i.test(t) || /\b(ahah+|haha+|lol)\b/i.test(t)) {
    return 'playful'
  }
  if (
    /\b(seria(?:mente)?|serious(?:ly)?|importante|urgent|grave)\b/i.test(t) ||
    mode === 'emotional_support'
  ) {
    return mode === 'emotional_support' ? 'serious' : 'serious'
  }
  if (
    /\b(chiss[aà]|mi\s+chiedo|i\s+wonder|curious|curios[oa]?)\b/i.test(t) ||
    mode === 'brainstorming' ||
    mode === 'teaching'
  ) {
    if (mode === 'brainstorming' || mode === 'teaching') return 'curious'
  }
  return 'neutral'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{ replyLength?: string|null }} settings
 * @param {{ desiredDepth?: DesiredDepth|null, forceShort?: boolean }} overrides
 * @returns {DesiredDepth}
 */
function inferDesiredDepth(userMessage, mode, settings, overrides) {
  if (overrides.desiredDepth) return overrides.desiredDepth
  if (overrides.forceShort) return 'short'

  /** @type {DesiredDepth} */
  let depth = 'medium'
  switch (mode) {
    case 'casual':
    case 'celebration':
    case 'quick_answer':
      depth = 'short'
      break
    case 'teaching':
      depth = 'detailed'
      break
    case 'debugging':
    case 'problem_solving':
    case 'brainstorming':
    case 'decision_support':
    case 'informational':
      depth = 'medium'
      break
    case 'emotional_support':
      depth = 'medium'
      break
    default:
      depth = 'medium'
  }

  if (userMessage.length > 280 && depth === 'short') depth = 'medium'
  if (userMessage.length > 500 && (mode === 'debugging' || mode === 'teaching')) {
    depth = 'detailed'
  }

  // Soft preference from settings — never beats explicit override (already applied).
  const pref =
    typeof settings.replyLength === 'string'
      ? settings.replyLength.trim().toLowerCase()
      : ''
  if (pref === 'concise' && depth === 'detailed') depth = 'medium'
  if (pref === 'concise' && mode === 'casual') depth = 'short'
  if (pref === 'detailed' && depth === 'short' && mode !== 'casual' && mode !== 'celebration') {
    depth = 'medium'
  }
  if (pref === 'detailed' && (mode === 'teaching' || mode === 'informational')) {
    depth = 'detailed'
  }

  return depth
}

/**
 * @param {ConversationMode} mode
 * @param {EmotionalTone} tone
 * @param {{ useEmojis?: boolean|null }} settings
 * @param {{ emojiLevel?: EmojiLevel|null }} overrides
 * @returns {EmojiLevel}
 */
function inferEmojiLevel(mode, tone, settings, overrides) {
  if (overrides.emojiLevel) return overrides.emojiLevel
  if (settings.useEmojis === false) return 'none'

  if (mode === 'debugging' || mode === 'emotional_support') return 'light'
  if (mode === 'informational' || mode === 'quick_answer' || mode === 'teaching') return 'light'
  if (tone === 'serious') return 'none'
  if (tone === 'frustrated') return 'none'
  if (mode === 'celebration' || tone === 'celebratory' || tone === 'excited') {
    return 'expressive'
  }
  if (mode === 'casual' || mode === 'brainstorming') return 'moderate'
  if (settings.useEmojis === true && (mode === 'casual' || mode === 'celebration')) {
    return mode === 'celebration' ? 'expressive' : 'moderate'
  }
  return 'light'
}

/**
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @returns {InitiativeLevel}
 */
function inferInitiativeLevel(mode, purpose) {
  if (mode === 'quick_answer' || mode === 'informational') return 'low'
  if (mode === 'brainstorming' || purpose === 'brainstorm') return 'high'
  if (mode === 'decision_support') return 'normal'
  if (mode === 'celebration') return 'low'
  if (mode === 'debugging' || mode === 'teaching' || mode === 'problem_solving') return 'normal'
  if (mode === 'casual' && purpose === 'brainstorm') return 'high'
  return 'normal'
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {{ isCorrection: boolean, overrides: { forceInteractive?: boolean } }} ctx
 */
function inferQuestionNeeded(userMessage, mode, purpose, ctx) {
  if (ctx.overrides.forceInteractive) return true
  if (ctx.isCorrection) return false
  if (purpose === 'react') return false
  if (mode === 'celebration' || mode === 'quick_answer') return false
  if (mode === 'informational' || mode === 'teaching') return false
  if (mode === 'debugging' && !/\b(non\s+so|manca|missing|which|quale\s+file)\b/i.test(userMessage)) {
    return false
  }
  if (mode === 'brainstorming') return false
  // Decision with named options present → answer; without options → ask.
  if (mode === 'decision_support' || purpose === 'recommend') {
    const hasOptions =
      /\b(o|or|vs\.?|versus|tra|between)\b/i.test(userMessage) &&
      (/\b\w+\s+(?:o|or|vs\.?)\s+\w+\b/i.test(userMessage) ||
        /\b(?:opzione|option|nome|name)s?\b/i.test(userMessage))
    // "Quale dei due nomi" without listing them → need input
    if (/\b(?:dei\s+due|two|questi|these)\b/i.test(userMessage) && userMessage.length < 80) {
      return true
    }
    return !hasOptions
  }
  if (
    /\b(aiutami\s+a\s+scegliere\s+ma\s+non\s+so|non\s+so\s+ancora|dipende|opzioni\??\s*$)/i.test(
      userMessage,
    )
  ) {
    return true
  }
  return false
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {{ isCorrection: boolean, emotionalTone: EmotionalTone }} ctx
 */
function inferAcknowledgementNeeded(userMessage, mode, purpose, ctx) {
  if (ctx.isCorrection) return true
  if (mode === 'celebration') return true
  if (ctx.emotionalTone === 'frustrated' || ctx.emotionalTone === 'excited') return true
  if (mode === 'emotional_support' || purpose === 'comfort') return true
  if (mode === 'informational' || mode === 'quick_answer' || mode === 'teaching') return false
  if (purpose === 'explain' || purpose === 'answer') return false
  if (mode === 'casual' && purpose === 'react') return false
  return false
}

/**
 * @param {string} userMessage
 * @param {ConversationMode} mode
 * @param {{ structurePreference?: StructurePreference|null }} overrides
 * @returns {StructurePreference}
 */
function inferStructurePreference(userMessage, mode, overrides) {
  if (overrides.structurePreference) return overrides.structurePreference
  if (
    /\b(lista|elenca|elenco|table|tabella|confronta|compare|bullet|punti\s+elenco|fammi\s+una\s+lista)\b/i.test(
      userMessage,
    )
  ) {
    return 'structured'
  }
  if (mode === 'debugging') return 'structured'
  if (
    mode === 'brainstorming' ||
    mode === 'decision_support' ||
    mode === 'problem_solving' ||
    mode === 'teaching'
  ) {
    return 'light_structure'
  }
  if (mode === 'informational') return 'light_structure'
  return 'prose'
}

/**
 * @param {ConversationMode} mode
 * @param {ResponsePurpose} purpose
 * @param {string} userMessage
 * @returns {ConfidenceLevel}
 */
function inferConfidence(mode, purpose, userMessage) {
  if (purpose === 'recommend' || mode === 'decision_support') {
    if (
      /\b(due|two|a\s+o\s+b|questi\s+due|these\s+two|nome[s]?)\b/i.test(userMessage) ||
      userMessage.length > 40
    ) {
      return 'high'
    }
    return 'medium'
  }
  if (mode === 'quick_answer' || mode === 'informational') return 'high'
  if (mode === 'debugging' && /\b(forse|maybe|non\s+so)\b/i.test(userMessage)) return 'low'
  if (mode === 'brainstorming') return 'medium'
  return 'medium'
}

/**
 * @param {string} userMessage
 */
function detectExplicitOverrides(userMessage) {
  const t = userMessage
  /** @type {{
   *   labels: string[]
   *   desiredDepth: DesiredDepth | null
   *   emojiLevel: EmojiLevel | null
   *   structurePreference: StructurePreference | null
   *   forceTeaching: boolean
   *   forceShort: boolean
   *   forceInteractive: boolean
   * }} */
  const out = {
    labels: [],
    desiredDepth: null,
    emojiLevel: null,
    structurePreference: null,
    forceTeaching: false,
    forceShort: false,
    forceInteractive: false,
  }

  if (
    /\b(rispondi\s+brevemente|in\s+una\s+frase|solo\s+la\s+risposta|vai\s+dritto\s+al\s+punto|be\s+brief|in\s+one\s+sentence|short\s+answer)\b/i.test(
      t,
    )
  ) {
    out.desiredDepth = 'short'
    out.forceShort = true
    out.labels.push('depth:short')
  }
  if (
    /\b(nel\s+dettaglio|in\s+modo\s+molto\s+approfondito|approfondisci|spiega(?:melo|lo|mi)?\s+(?:bene|dettagliat\w*)|dettagliatamente|in\s+detail|very\s+detailed|thorough(?:ly)?)\b/i.test(
      t,
    )
  ) {
    out.desiredDepth = 'detailed'
    out.labels.push('depth:detailed')
  }
  if (
    /\b(fammi\s+una\s+risposta\s+semplice|in\s+modo\s+semplice|keep\s+it\s+simple|spiegamelo\s+semplice)\b/i.test(
      t,
    )
  ) {
    if (!out.desiredDepth) out.desiredDepth = 'medium'
    out.forceTeaching = true
    out.labels.push('simple_explain')
  }
  if (
    /\b(spiegamelo\s+come\s+se\s+non\s+sapessi|come\s+se\s+non\s+sapessi\s+nulla|explain\s+like\s+i(?:'?m|\s+am)\s+five|eli5)\b/i.test(
      t,
    )
  ) {
    out.forceTeaching = true
    if (!out.desiredDepth) out.desiredDepth = 'detailed'
    out.labels.push('teaching')
  }
  if (
    /\b(non\s+usare\s+emoji|senza\s+emoji|no\s+emoji|without\s+emoji)\b/i.test(t)
  ) {
    out.emojiLevel = 'none'
    out.labels.push('emoji:none')
  }
  if (
    /\b(usa\s+qualche\s+emoji|con\s+emoji|use\s+(?:some\s+)?emoji)\b/i.test(t)
  ) {
    out.emojiLevel = 'moderate'
    out.labels.push('emoji:moderate')
  }
  if (
    /\b(fammi\s+una\s+lista|in\s+lista|elenco\s+puntato|as\s+a\s+list|bullet\s+points|tabella|table)\b/i.test(
      t,
    )
  ) {
    out.structurePreference = 'structured'
    out.labels.push('structure:structured')
  }
  if (
    /\b(fammi\s+domande|chiedimi|ask\s+me\s+questions|interview\s+me)\b/i.test(t)
  ) {
    out.forceInteractive = true
    out.labels.push('interactive')
  }

  return out
}

/** @param {string} firstLine */
function classifyOpeningType(firstLine) {
  const t = normalizeText(firstLine).slice(0, 80).toLowerCase()
  if (/^(certo|assolutamente|esatto|perfetto|ok|okay)\b/.test(t)) return 'filler_ack'
  if (/^(capisco|capito|ah,?\s*s[iì])\b/.test(t)) return 'understanding'
  if (/^(ottima\s+domanda|great\s+question)\b/.test(t)) return 'praise'
  if (/^\p{Extended_Pictographic}/u.test(firstLine)) return 'emoji_lead'
  if (t.length < 40) return 'short_direct'
  return 'substantive'
}

/** @param {string} firstLine */
function classifyAcknowledgementType(firstLine) {
  const t = normalizeText(firstLine).slice(0, 60).toLowerCase()
  if (/^(certo|assolutamente)\b/.test(t)) return 'certo'
  if (/^(esatto|exactly)\b/.test(t)) return 'esatto'
  if (/^(capisco|capito|i\s+see)\b/.test(t)) return 'capisco'
  if (/^(perfetto|ok|okay|va\s*bene)\b/.test(t)) return 'ok'
  if (/^(interessante|interesting)\b/.test(t)) return 'interessante'
  if (/^(ahah|haha|lol)/.test(t)) return 'laugh'
  return null
}

/** @param {string} text */
function extractEmojis(text) {
  const matches = String(text || '').match(/\p{Extended_Pictographic}/gu)
  return matches ? [...new Set(matches)] : []
}

/**
 * @param {string[]} list
 * @param {string} item
 * @param {number} max
 */
function pushCap(list, item, max) {
  const next = [...(Array.isArray(list) ? list : []), item].filter(Boolean)
  return next.slice(-max)
}

/**
 * @param {string[]} prev
 * @param {string[]} next
 * @param {number} max
 */
function mergeRecentEmojis(prev, next, max) {
  return [...(Array.isArray(prev) ? prev : []), ...(Array.isArray(next) ? next : [])].slice(
    -max,
  )
}
