/**
 * LAIfe V2 — Conversation Signals (Phase 6)
 *
 * First-class stage: WHAT SIGNALS ARE PRESENT IN THIS TURN.
 *
 * Observational only — does NOT decide:
 *   - what LAIfe should do (Planner)
 *   - how LAIfe should respond (Writer / Adaptive Profile)
 *   - authoritative topic (Conversation State)
 *   - short-reply contextual intent (short-reply.js)
 *   - whether to rewrite (Contract Evaluator)
 *
 * Deterministic. No LLM. No Memory V2. No personality learning.
 *
 * Pipeline: Perception → Conversation Signals → Conversation State → …
 */

export const CONVERSATION_SIGNALS_VERSION = '1.0.0-conversation-signals'

/**
 * @typedef {object} AffectSignals
 * @property {number} boredom 0..1
 * @property {number} excitement 0..1
 * @property {number} frustration 0..1
 * @property {number} seriousness 0..1
 * @property {number} playfulness 0..1
 */

/**
 * @typedef {object} InteractionSignals
 * @property {boolean} continuationCue
 * @property {boolean} stopCue
 * @property {boolean} topicChangeCue
 * @property {boolean} correctionCue
 * @property {boolean} explicitQuestion
 * @property {boolean} explicitRequest
 */

/**
 * @typedef {object} StyleSignals
 * @property {boolean} wantsBrief
 * @property {boolean} wantsDetailed
 * @property {boolean} wantsSimple
 * @property {boolean} wantsTechnical
 * @property {boolean} wantsCasual
 * @property {boolean} wantsProfessional
 * @property {boolean|null} allowsEmojis
 * @property {boolean} wantsCalm
 */

/**
 * @typedef {object} EngagementSignals
 * @property {boolean} lowEffortReply
 * @property {boolean} activeFollowUp
 * @property {boolean} repeatedContinuation
 * @property {boolean} apparentDisengagement
 */

/**
 * @typedef {object} LanguageSignal
 * @property {string} code
 * @property {number} confidence
 */

/**
 * @typedef {object} ConversationSignals
 * @property {AffectSignals} affect
 * @property {InteractionSignals} interaction
 * @property {StyleSignals} style
 * @property {EngagementSignals} engagement
 * @property {LanguageSignal} language
 * @property {string[]} diagnostics compact codes only
 * @property {string} version
 */

// ——— Shared cue patterns (single source of detection) ———

export const BOREDOM_RE =
  /\b(mi\s+annoio|che\s+noia|annoiato|sono\s+annoiato|bored|i'?m\s+bored|non\s+so\s+(di\s+)?cosa\s+(fare|parlare)|nothing\s+to\s+(do|talk\s+about)|don'?t\s+know\s+what\s+to\s+(do|talk))\b/i

export const EXCITEMENT_RE =
  /\b(ahah+|haha+|lol+|lmao|assurdo|pazzesco|oddio|dai{2,}|wow+|incredibile|wtf)\b|😂|🤣|🔥/i

export const PLAYFUL_RE =
  /\b(bro+|raga+|ahah+|haha+|lol|scherz|playful|dai{2,})\b|😂|🤣/i

export const FRUSTRATION_RE =
  /\b(non\s+funziona|che\s+palle|ancora\??|perch[eé]\s+continua|this\s+is\s+annoying|frustrat|stuck|non\s+ce\s+la\s+faccio|annoyed|di\s+nuovo\s+lo\s+stesso)\b/i

export const SERIOUS_RE =
  /\b(serio|seriamente|grave|importante|urgente|lutto|malattia|diagnosi|licenziament|separazione|serious(ly)?|urgent|grief|funeral)\b/i

export const SHORT_CUE_RE =
  /\b(risposta\s+breve|breve\.?|in\s+breve|in\s+poche\s+parole|solo\s+la\s+risposta|concis[oa]|short\s+answer|be\s+brief|keep\s+it\s+short|tl;?dr|in\s+una\s+riga)\b/i

export const DETAILED_CUE_RE =
  /\b(approfondisci(\s+(molto|tantissimo))?|in\s+dettaglio|dettagliat[oa]|molto\s+dettagliato|spiegami\s+(bene|tutto|a\s+fondo)|detailed|go\s+deep|elaborate|più\s+dettagli)\b/i

export const SIMPLE_CUE_RE =
  /\b(spiegamelo\s+(facile|semplice)|in\s+parole\s+semplici|come\s+se\s+fossi|eli5|simple\s+terms|senza\s+tecnichismi|non\s+troppo\s+tecnico|in\s+modo\s+facile|principiante)\b/i

export const TECHNICAL_CUE_RE =
  /\b(tecnicamente|a\s+livello\s+esperto|in\s+profondità\s+tecnica|livello\s+esperto|expert\s+level|technical(ly)?|pwm|spwm|dead-?time|switching\s+loss|trifase|ponte\s+h|algoritmo|implementazione|architettura)\b/i

export const PROFESSIONAL_CUE_RE =
  /\b(professionale|formale|per\s+il\s+lavoro|business|corporate|email\s+formale|tono\s+serioso|in\s+modo\s+professionale)\b/i

export const CASUAL_CUE_RE =
  /\b(parlami\s+come\s+un\s+amico|più\s+naturale|informale|casual|come\s+un\s+amico|relax)\b/i

export const CALM_CUE_RE =
  /\b(con\s+calma|piano|tranquill[oa]|calmly|take\s+your\s+time)\b/i

export const EMOJI_OFF_RE =
  /\b(niente\s+emoji|senza\s+emoji|no\s+emojis?|without\s+emojis?|don'?t\s+use\s+emojis?)\b/i

export const EMOJI_ON_RE =
  /\b(usa\s+emoji|con\s+emoji|use\s+emojis?|with\s+emojis?)\b/i

export const TOPIC_CHANGE_RE =
  /\b(cambiamo\s+argomento|cambiando\s+argomento|parliamo\s+invece\s+(di|dell[aeo'’]?|degli|delle)?|parliamo\s+d['’]?altro|un['’]?altra\s+cosa|comunque,?\s+altra\s+cosa|switch\s+topic|instead,?\s+let'?s\s+talk\s+about|let'?s\s+talk\s+about)\b/i

export const CORRECTION_RE =
  /\b(no,?\s+intendevo|no,?\s+parlavo\s+(dell['’]?altro|di\s+altro)|non\s+quello|l['’]?altro|mi\s+sono\s+spiegato\s+male|i\s+meant|not\s+that\s+one|actually\s+i\s+meant)\b/i

export const STOP_CUE_RE =
  /\b(basta(\s+cos[iì])?|grazie[,.]?\s*(basta|a\s+presto)?|stop(\s+here)?|chiudiamo|nient['’]?altro|ho\s+finito|enough|that'?s\s+all)\b/i

export const CONTINUATION_CUE_RE =
  /\b(continua|continuiamo|vai(\s+avanti)?|dimmi\s+di\s+più|go\s+on|tell\s+me\s+more|ancora|prosegui|riprendiamo)\b/i

export const ACTIVE_FOLLOWUP_RE =
  /^(e\s+)?(perch[eé]|why|come\s+mai|e\s+quindi|and\s+then|how\s+come)\b/i

export const LOW_EFFORT_RE =
  /^(ok|okay|k|mh+|mhm+|s[iì]|yep|yeah|va\s+bene|certo|perfetto|capisco|thanks|grazie)[.!…]*$/i

export const EXPLICIT_REQUEST_RE =
  /\b(spiegami|descrivi|scrivimi|fammi|dammi|tell\s+me|explain|describe|write\s+me|give\s+me|show\s+me)\b/i

export const WHAT_IS_RE =
  /^(cos['’]?è|che\s+cos['’]?è|what\s+is|what'?s)\b/i

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, Math.round(x * 100) / 100))
}

/**
 * @param {unknown} messages
 * @returns {Array<{ role: string, content: string }>}
 */
function listMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.map((m) => ({
    role: asString(m?.role).toLowerCase(),
    content: asString(m?.content).trim(),
  }))
}

/**
 * Count recent user turns matching a predicate (surface only).
 * @param {Array<{ role: string, content: string }>} messages
 * @param {(text: string) => boolean} pred
 * @param {number} [window]
 * @returns {number}
 */
function countRecentUserMatches(messages, pred, window = 4) {
  const users = messages.filter((m) => m.role === 'user').slice(-window)
  return users.filter((m) => pred(m.content)).length
}

/**
 * Empty / fail-soft signals object.
 * @returns {ConversationSignals}
 */
export function emptyConversationSignals() {
  return freezeConversationSignals({
    affect: {
      boredom: 0,
      excitement: 0,
      frustration: 0,
      seriousness: 0,
      playfulness: 0,
    },
    interaction: {
      continuationCue: false,
      stopCue: false,
      topicChangeCue: false,
      correctionCue: false,
      explicitQuestion: false,
      explicitRequest: false,
    },
    style: {
      wantsBrief: false,
      wantsDetailed: false,
      wantsSimple: false,
      wantsTechnical: false,
      wantsCasual: false,
      wantsProfessional: false,
      allowsEmojis: null,
      wantsCalm: false,
    },
    engagement: {
      lowEffortReply: false,
      activeFollowUp: false,
      repeatedContinuation: false,
      apparentDisengagement: false,
    },
    language: {
      code: 'it',
      confidence: 0.5,
    },
    diagnostics: [],
    version: CONVERSATION_SIGNALS_VERSION,
  })
}

/**
 * Freeze signals (immutability for downstream stages).
 * @param {ConversationSignals} signals
 * @returns {ConversationSignals}
 */
export function freezeConversationSignals(signals) {
  if (!signals || typeof signals !== 'object') return emptyConversationSignals()
  try {
    Object.freeze(signals.affect)
    Object.freeze(signals.interaction)
    Object.freeze(signals.style)
    Object.freeze(signals.engagement)
    Object.freeze(signals.language)
    Object.freeze(signals.diagnostics)
    return Object.freeze(signals)
  } catch {
    return signals
  }
}

/**
 * @param {unknown} value
 * @returns {value is ConversationSignals}
 */
export function isConversationSignals(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return (
    v.affect &&
    typeof v.affect === 'object' &&
    typeof v.affect.boredom === 'number' &&
    v.interaction &&
    typeof v.interaction === 'object' &&
    v.style &&
    typeof v.style === 'object' &&
    v.engagement &&
    typeof v.engagement === 'object'
  )
}

/**
 * Compact sanitized diagnostics for V2 Experimental.
 * @param {ConversationSignals|null|undefined} signals
 * @returns {object|null}
 */
export function serializeConversationSignalsDebug(signals) {
  if (!isConversationSignals(signals)) return null
  return {
    boredom: signals.affect.boredom >= 0.55,
    excitement: signals.affect.excitement >= 0.45,
    frustration: signals.affect.frustration >= 0.45,
    seriousness: signals.affect.seriousness >= 0.45,
    playfulness: signals.affect.playfulness >= 0.45,
    wantsBrief: Boolean(signals.style.wantsBrief),
    wantsDetailed: Boolean(signals.style.wantsDetailed),
    wantsSimple: Boolean(signals.style.wantsSimple),
    wantsTechnical: Boolean(signals.style.wantsTechnical),
    wantsProfessional: Boolean(signals.style.wantsProfessional),
    allowsEmojis: signals.style.allowsEmojis,
    topicChangeCue: Boolean(signals.interaction.topicChangeCue),
    correctionCue: Boolean(signals.interaction.correctionCue),
    stopCue: Boolean(signals.interaction.stopCue),
    continuationCue: Boolean(signals.interaction.continuationCue),
    activeFollowUp: Boolean(signals.engagement.activeFollowUp),
    lowEffortReply: Boolean(signals.engagement.lowEffortReply),
    language: signals.language?.code || null,
  }
}

/**
 * Derive turn-level Conversation Signals (pure, deterministic).
 *
 * @param {{
 *   userMessage?: string,
 *   messages?: Array<{ role?: string, content?: string }>,
 *   perception?: object|null,
 *   previousConversationState?: object|null,
 *   preferences?: object|null,
 *   freeze?: boolean,
 * }} [input]
 * @returns {ConversationSignals}
 */
export function deriveConversationSignals(input = {}) {
  const userText = asString(input.userMessage).replace(/\s+/g, ' ').trim()
  const messages = listMessages(input.messages)
  const perception =
    input.perception && typeof input.perception === 'object' ? input.perception : {}
  const previous =
    input.previousConversationState && typeof input.previousConversationState === 'object'
      ? input.previousConversationState
      : null

  /** @type {string[]} */
  const diagnostics = []

  // ——— Affect ———
  let boredom = 0
  let excitement = 0
  let frustration = 0
  let seriousness = 0
  let playfulness = 0

  if (BOREDOM_RE.test(userText) || asString(perception.intent) === 'boredom') {
    boredom = BOREDOM_RE.test(userText) ? 0.85 : 0.7
    diagnostics.push('affect:boredom')
  }

  if (EXCITEMENT_RE.test(userText)) {
    // Require laugh/emoji/strong token — single ! alone does not elevate.
    excitement = /😂|🤣|🔥|ahah+|haha+|lol/.test(userText) ? 0.8 : 0.55
    diagnostics.push('affect:excitement')
  } else if (
    asString(perception.emotionalState) === 'excited' ||
    asString(perception.socialIntent) === 'laughter'
  ) {
    excitement = Math.max(excitement, 0.55)
    diagnostics.push('affect:excitement_perception')
  }

  if (PLAYFUL_RE.test(userText) || asString(perception.emotionalState) === 'playful') {
    playfulness = Math.max(playfulness, EXCITEMENT_RE.test(userText) ? 0.75 : 0.5)
    diagnostics.push('affect:playfulness')
  }

  if (FRUSTRATION_RE.test(userText) || asString(perception.emotionalState) === 'frustrated') {
    frustration = FRUSTRATION_RE.test(userText) ? 0.75 : 0.55
    seriousness = Math.max(seriousness, 0.45)
    diagnostics.push('affect:frustration')
  }

  if (
    SERIOUS_RE.test(userText) ||
    asString(perception.emotionalState) === 'sad' ||
    asString(perception.emotionalState) === 'anxious' ||
    asString(perception.intent) === 'emotional_support'
  ) {
    seriousness = Math.max(seriousness, SERIOUS_RE.test(userText) ? 0.8 : 0.65)
    playfulness = Math.min(playfulness, 0.15)
    excitement = Math.min(excitement, 0.2)
    diagnostics.push('affect:seriousness')
  }

  // ——— Interaction (surface cues only) ———
  const continuationCue = CONTINUATION_CUE_RE.test(userText)
  const stopCue = STOP_CUE_RE.test(userText)
  const topicChangeCue = TOPIC_CHANGE_RE.test(userText)
  const correctionCue = CORRECTION_RE.test(userText)
  const explicitQuestion = /\?\s*$/.test(userText) || WHAT_IS_RE.test(userText)
  const explicitRequest = EXPLICIT_REQUEST_RE.test(userText) || DETAILED_CUE_RE.test(userText)

  if (continuationCue) diagnostics.push('interaction:continuation')
  if (stopCue) diagnostics.push('interaction:stop')
  if (topicChangeCue) diagnostics.push('interaction:topic_change')
  if (correctionCue) diagnostics.push('interaction:correction')
  if (explicitQuestion) diagnostics.push('interaction:question')
  if (explicitRequest) diagnostics.push('interaction:request')

  // ——— Style ———
  const wantsBrief = SHORT_CUE_RE.test(userText)
  const wantsDetailed = DETAILED_CUE_RE.test(userText)
  const wantsSimple = SIMPLE_CUE_RE.test(userText)
  const wantsTechnical = TECHNICAL_CUE_RE.test(userText)
  const wantsCasual = CASUAL_CUE_RE.test(userText)
  const wantsProfessional = PROFESSIONAL_CUE_RE.test(userText)
  const wantsCalm = CALM_CUE_RE.test(userText)

  /** @type {boolean|null} */
  let allowsEmojis = null
  if (EMOJI_OFF_RE.test(userText)) {
    allowsEmojis = false
    diagnostics.push('style:emoji_off')
  } else if (EMOJI_ON_RE.test(userText)) {
    allowsEmojis = true
    diagnostics.push('style:emoji_on')
  }

  if (wantsBrief) diagnostics.push('style:brief')
  if (wantsDetailed) diagnostics.push('style:detailed')
  if (wantsSimple) diagnostics.push('style:simple')
  if (wantsTechnical) diagnostics.push('style:technical')
  if (wantsCasual) diagnostics.push('style:casual')
  if (wantsProfessional) diagnostics.push('style:professional')
  if (wantsCalm) diagnostics.push('style:calm')

  // ——— Engagement ———
  const lowEffortReply = Boolean(userText) && LOW_EFFORT_RE.test(userText)
  const activeFollowUp =
    ACTIVE_FOLLOWUP_RE.test(userText) ||
    (explicitQuestion && userText.length < 80 && Boolean(previous?.activeTopic))

  const continueCount = countRecentUserMatches(
    messages,
    (t) => /^(vai|continua|ancora)[.!…]*$/i.test(t.trim()) || CONTINUATION_CUE_RE.test(t),
    5,
  )
  const repeatedContinuation = continueCount >= 2 && continuationCue

  // Never label disengagement from a single short message.
  const apparentDisengagement =
    lowEffortReply &&
    asString(previous?.engagement) === 'low' &&
    countRecentUserMatches(messages, (t) => LOW_EFFORT_RE.test(t.trim()), 3) >= 3

  if (lowEffortReply) diagnostics.push('engagement:low_effort')
  if (activeFollowUp) diagnostics.push('engagement:follow_up')
  if (repeatedContinuation) diagnostics.push('engagement:repeated_continuation')
  if (apparentDisengagement) diagnostics.push('engagement:disengagement')

  // ——— Language (reuse Perception; no competing detector) ———
  const langCode = asString(perception.language || perception.lang || 'it') || 'it'
  const langConfidence =
    typeof perception.languageConfidence === 'number'
      ? clamp01(perception.languageConfidence)
      : langCode
        ? 0.9
        : 0.5

  /** @type {ConversationSignals} */
  const signals = {
    affect: {
      boredom: clamp01(boredom),
      excitement: clamp01(excitement),
      frustration: clamp01(frustration),
      seriousness: clamp01(seriousness),
      playfulness: clamp01(playfulness),
    },
    interaction: {
      continuationCue: Boolean(continuationCue),
      stopCue: Boolean(stopCue),
      topicChangeCue: Boolean(topicChangeCue),
      correctionCue: Boolean(correctionCue),
      explicitQuestion: Boolean(explicitQuestion),
      explicitRequest: Boolean(explicitRequest),
    },
    style: {
      wantsBrief: Boolean(wantsBrief),
      wantsDetailed: Boolean(wantsDetailed),
      wantsSimple: Boolean(wantsSimple),
      wantsTechnical: Boolean(wantsTechnical),
      wantsCasual: Boolean(wantsCasual),
      wantsProfessional: Boolean(wantsProfessional),
      allowsEmojis,
      wantsCalm: Boolean(wantsCalm),
    },
    engagement: {
      lowEffortReply: Boolean(lowEffortReply),
      activeFollowUp: Boolean(activeFollowUp),
      repeatedContinuation: Boolean(repeatedContinuation),
      apparentDisengagement: Boolean(apparentDisengagement),
    },
    language: {
      code: langCode.slice(0, 8),
      confidence: langConfidence,
    },
    diagnostics: diagnostics.slice(0, 24),
    version: CONVERSATION_SIGNALS_VERSION,
  }

  // Invariant: no decision fields.
  if ('objective' in signals || 'strategy' in signals || 'conversationalMove' in signals) {
    throw new Error('Conversation Signals must not contain decision fields')
  }

  const shouldFreeze = input.freeze !== false
  return shouldFreeze ? freezeConversationSignals(signals) : signals
}
