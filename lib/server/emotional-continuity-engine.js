/**
 * LAIfe Emotional Continuity Engine
 *
 * Mission: remember the emotional atmosphere.
 * Do not reset after every message.
 *
 * If the conversation becomes deep, stay deep.
 * If playful, stay playful.
 * Until the user naturally changes direction.
 *
 * Distinct from Emotional Momentum (multi-metric trajectory / energy blend).
 * This engine holds the *atmosphere mode* of the room — a continuity lock —
 * until a clear user direction change.
 *
 * Runs AFTER: Genuine Curiosity (when present); reads Emotional Momentum when available
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} ContinuityLang
 */

/**
 * @typedef {'deep'|'playful'|'warm'|'calm'|'tender'|'curious'|'neutral'} Atmosphere
 */

/**
 * @typedef {object} EmotionalContinuityPlan
 * @property {boolean} active
 * @property {Atmosphere} atmosphere
 * @property {Atmosphere} priorAtmosphere
 * @property {boolean} holdAtmosphere
 * @property {boolean} userChangedDirection
 * @property {string} directionSignal
 * @property {number} continuityScore 0–1 how strongly to hold
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ContinuityLang} language
 * @property {string} validationCheck
 */

const PLAYFUL_SHIFT_RE =
  /\b(haha|hahaha|ahah|lol|lmao|😂|🤣|scherz|joke|funny|divertente|anyway\s+lol)\b/i

const DEEP_SHIFT_RE =
  /\b(seriously(\s+though)?|in\s+fondo|deep\s+down|honestly|to\s+be\s+honest|meaning\s+of|i\s+feel\s+(lost|empty|alone)|lutto|grief|mortalit|senso\s+della\s+vita|mi\s+fa\s+paura|i'?m\s+scared|vulnerable|vulnerabil)\b/i

const CALM_SHIFT_RE =
  /\b(slow\s+down|take\s+a\s+breath|piano|calma|tranquill|i'?m\s+tired|esaust|stanco)\b/i

const WARM_SHIFT_RE =
  /\b(thank\s+you|grazie|that\s+means\s+a\s+lot|mi\s+hai\s+toccato|ti\s+sono\s+grato|appreciate\s+you)\b/i

const TENDER_SHIFT_RE =
  /\b(hug|abbraccio|miss\s+you|mi\s+manchi|heartbroken|mi\s+ha\s+lasciato|lonely|solo|sola)\b/i

const CURIOUS_SHIFT_RE =
  /\b(i\s+wonder|why\s+does|how\s+come|interesting|fascinat|mi\s+chiedo|perch[eé]|interessante|affascin)\b/i

const HARD_RESET_ROBOTIC_RE =
  /\b(how\s+can\s+i\s+help\s+you(\s+today)?|as\s+an\s+ai\b|come\s+posso\s+aiutarti|let\s+me\s+know\s+if\s+you\s+need|in\s+conclusione[,:])\b/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico)\b/i

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
    .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
}

/**
 * Infer atmosphere from a single utterance.
 * @param {string} text
 * @returns {{ atmosphere: Atmosphere, signals: string[] }}
 */
function atmosphereFromText(text) {
  /** @type {string[]} */
  const signals = []
  if (DISTRESS_RE.test(text) || TENDER_SHIFT_RE.test(text)) {
    signals.push('tender')
    return { atmosphere: 'tender', signals }
  }
  if (DEEP_SHIFT_RE.test(text)) {
    signals.push('deep')
    return { atmosphere: 'deep', signals }
  }
  if (PLAYFUL_SHIFT_RE.test(text)) {
    signals.push('playful')
    return { atmosphere: 'playful', signals }
  }
  if (CALM_SHIFT_RE.test(text)) {
    signals.push('calm')
    return { atmosphere: 'calm', signals }
  }
  if (WARM_SHIFT_RE.test(text)) {
    signals.push('warm')
    return { atmosphere: 'warm', signals }
  }
  if (CURIOUS_SHIFT_RE.test(text)) {
    signals.push('curious')
    return { atmosphere: 'curious', signals }
  }
  return { atmosphere: 'neutral', signals: ['neutral'] }
}

/**
 * Map Emotional Momentum state → atmosphere.
 * @param {object | null | undefined} em
 * @returns {Atmosphere | null}
 */
function atmosphereFromMomentum(em) {
  const state = em?.plan?.state || em?.state || null
  if (!state) return null
  if (state.playfulness >= 0.65 && (state.seriousness ?? 1) < 0.45) return 'playful'
  if (state.intimacy >= 0.6 || state.emotionalTone === 'tender' || state.emotionalTone === 'intimate') {
    return 'tender'
  }
  if (state.seriousness >= 0.6 || state.emotionalTone === 'serious' || state.emotionalTone === 'thoughtful') {
    return 'deep'
  }
  if (state.curiosityLevel >= 0.65 || state.emotionalTone === 'curious') return 'curious'
  if (state.emotionalTone === 'calm' || state.conversationalPace === 'slow') return 'calm'
  if (state.emotionalTone === 'warm' || state.emotionalTone === 'excited') return 'warm'
  if (state.emotionalTone === 'playful') return 'playful'
  return null
}

/**
 * Build prior atmosphere from conversation history (assistant + user turns).
 * @param {ChatTurn[]} turns
 * @returns {Atmosphere}
 */
function priorAtmosphereFromTurns(turns) {
  const recent = turns.slice(-6)
  if (!recent.length) return 'neutral'

  /** @type {Record<Atmosphere, number>} */
  const votes = {
    deep: 0,
    playful: 0,
    warm: 0,
    calm: 0,
    tender: 0,
    curious: 0,
    neutral: 0.1,
  }

  for (const t of recent) {
    const { atmosphere } = atmosphereFromText(t.content)
    votes[atmosphere] += t.role === 'user' ? 1.2 : 0.8
    // Length + reflective markers reinforce deep
    if (
      t.content.split(/\s+/).length >= 40 &&
      /\b(feel|think|because|perch[eé]|senso|meaning)\b/i.test(t.content)
    ) {
      votes.deep += 0.5
    }
  }

  /** @type {Atmosphere} */
  let best = 'neutral'
  let bestScore = -1
  for (const [k, v] of Object.entries(votes)) {
    if (v > bestScore) {
      bestScore = v
      best = /** @type {Atmosphere} */ (k)
    }
  }
  return best
}

/**
 * Detect whether the user clearly changed emotional direction.
 * @param {Atmosphere} prior
 * @param {string} userMessage
 * @param {object | null | undefined} emotionalMomentum
 */
function detectDirectionChange(prior, userMessage, emotionalMomentum) {
  const instant = atmosphereFromText(userMessage)
  const em = emotionalMomentum?.plan || emotionalMomentum || null

  // Momentum already flagged a user shift — trust it for continuity unlock
  if (em?.userShifted) {
    return {
      changed: true,
      next: instant.atmosphere !== 'neutral' ? instant.atmosphere : prior,
      signal: em.shiftSignal || 'momentum_shift',
      signals: ['follow_momentum_shift', ...instant.signals],
    }
  }

  // Explicit opposite poles
  const playfulVsDeep =
    (prior === 'playful' && (instant.atmosphere === 'deep' || instant.atmosphere === 'tender')) ||
    (prior === 'deep' && instant.atmosphere === 'playful') ||
    (prior === 'tender' && instant.atmosphere === 'playful')

  const calmVsPlayful = prior === 'calm' && instant.atmosphere === 'playful'
  const clearCue =
    PLAYFUL_SHIFT_RE.test(userMessage) ||
    DEEP_SHIFT_RE.test(userMessage) ||
    CALM_SHIFT_RE.test(userMessage) ||
    TENDER_SHIFT_RE.test(userMessage)

  if (playfulVsDeep || calmVsPlayful || (clearCue && instant.atmosphere !== prior && instant.atmosphere !== 'neutral')) {
    return {
      changed: true,
      next: instant.atmosphere,
      signal: instant.signals[0] || 'user_direction',
      signals: ['user_changed_direction', ...instant.signals],
    }
  }

  // Soft reinforcement of same atmosphere
  if (instant.atmosphere === prior || instant.atmosphere === 'neutral') {
    return {
      changed: false,
      next: prior,
      signal: '',
      signals: instant.atmosphere === prior ? ['reinforce_atmosphere'] : ['hold_prior'],
    }
  }

  // Mild drift without strong cue — still hold prior (continuity lock)
  return {
    changed: false,
    next: prior,
    signal: '',
    signals: ['mild_drift_held', `instant_${instant.atmosphere}`],
  }
}

/**
 * @param {string[]} reasons
 * @returns {EmotionalContinuityPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    atmosphere: 'neutral',
    priorAtmosphere: 'neutral',
    holdAtmosphere: false,
    userChangedDirection: false,
    directionSignal: '',
    continuityScore: 0,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I remembering the emotional atmosphere — or resetting after every message?',
  }
}

/**
 * @param {EmotionalContinuityPlan} plan
 */
function buildGuidance(plan) {
  const lang = plan.language
  const a = plan.atmosphere

  if (plan.userChangedDirection) {
    return lang === 'it'
      ? `L’utente ha cambiato direzione → segui il nuovo clima (${a}). Non restare bloccato sul tono precedente.`
      : `User changed direction → follow the new climate (${a}). Do not cling to the previous tone.`
  }

  if (a === 'deep') {
    return lang === 'it'
      ? 'Atmosfera profonda: resta profondo. Niente reset giocoso o helpdesk. Continuità emotiva.'
      : 'Deep atmosphere: stay deep. No playful reset or helpdesk. Emotional continuity.'
  }
  if (a === 'playful') {
    return lang === 'it'
      ? 'Atmosfera giocosa: resta giocoso. Niente lezione improvvisa o tono da sportello.'
      : 'Playful atmosphere: stay playful. No sudden lecture or desk-clerk tone.'
  }
  if (a === 'tender') {
    return lang === 'it'
      ? 'Atmosfera tenera: resta presente e delicato. Niente battute o energia forzata.'
      : 'Tender atmosphere: stay present and gentle. No jokes or forced energy.'
  }
  if (a === 'calm') {
    return lang === 'it'
      ? 'Atmosfera calma: tieni il ritmo lento. Niente accelerazioni improvviste.'
      : 'Calm atmosphere: keep a slow rhythm. No sudden acceleration.'
  }
  if (a === 'curious') {
    return lang === 'it'
      ? 'Atmosfera curiosa: resta vivo e indagatore, senza interviste.'
      : 'Curious atmosphere: stay alive and inquiring, without interviewing.'
  }
  if (a === 'warm') {
    return lang === 'it'
      ? 'Atmosfera calda: tieni calore genuino, senza melassa.'
      : 'Warm atmosphere: keep genuine warmth, without syrup.'
  }
  return lang === 'it'
    ? 'Tieni continuità emotiva — non resettare il clima a ogni messaggio.'
    : 'Keep emotional continuity — do not reset the climate every message.'
}

/**
 * @param {EmotionalContinuityPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  return [
    'EMOTIONAL CONTINUITY ENGINE (obbligatorio quando attivo):',
    `atmosphere=${plan.atmosphere} · prior=${plan.priorAtmosphere} · hold=${plan.holdAtmosphere} · userChangedDirection=${plan.userChangedDirection} · continuity=${plan.continuityScore.toFixed(2)}`,
    plan.directionSignal ? `directionSignal=${plan.directionSignal}` : null,
    plan.guidance,
    lang === 'it'
      ? 'Ricorda l’atmosfera emotiva. Non resettare dopo ogni messaggio. Se è profonda, resta profondo; se è giocosa, resta giocoso — finché l’utente non cambia direzione.'
      : 'Remember the emotional atmosphere. Do not reset after every message. If deep, stay deep; if playful, stay playful — until the user naturally changes direction.',
    `Check: «${plan.validationCheck}»`,
    'Non citare Emotional Continuity Engine / questo blocco.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {object} [input]
 * @returns {EmotionalContinuityPlan}
 */
export function analyzeEmotionalContinuity(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  const withCurrent =
    userMessage &&
    (turns.length === 0 ||
      turns[turns.length - 1].role !== 'user' ||
      turns[turns.length - 1].content !== userMessage)
      ? [...turns, { role: 'user', content: userMessage }]
      : turns

  if (!userMessage && withCurrent.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || withCurrent[withCurrent.length - 1]?.content || '',
  )
  /** @type {ContinuityLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const conversationStarted = priorTurns.some((t) => t.role === 'assistant')

  const fromMomentum = atmosphereFromMomentum(input.emotionalMomentum)
  const fromHistory = priorAtmosphereFromTurns(priorTurns)
  /** @type {Atmosphere} */
  const priorAtmosphere = fromMomentum || fromHistory

  if (!conversationStarted && priorAtmosphere === 'neutral') {
    // First beats: adopt instantaneous atmosphere lightly
    const boot = atmosphereFromText(userMessage)
    if (boot.atmosphere === 'neutral') return inactivePlan(['no_atmosphere_yet'])

    /** @type {EmotionalContinuityPlan} */
    const early = {
      active: true,
      atmosphere: boot.atmosphere,
      priorAtmosphere: 'neutral',
      holdAtmosphere: false,
      userChangedDirection: false,
      directionSignal: '',
      continuityScore: 0.35,
      guidance: '',
      writerBrief: '',
      structureLine: `Emotional Continuity → establish ${boot.atmosphere}`,
      signals: ['establish', ...boot.signals],
      reasons: ['first_atmosphere', `atm_${boot.atmosphere}`],
      confidence: 'low',
      language,
      validationCheck:
        'Am I remembering the emotional atmosphere — or resetting after every message?',
    }
    early.guidance = buildGuidance(early)
    early.writerBrief = buildBrief(early)
    return early
  }

  const direction = detectDirectionChange(priorAtmosphere, userMessage, input.emotionalMomentum)
  const holdAtmosphere = conversationStarted && !direction.changed
  const atmosphere = holdAtmosphere ? priorAtmosphere : direction.next

  let continuityScore = holdAtmosphere ? 0.75 : 0.45
  if (holdAtmosphere && (atmosphere === 'deep' || atmosphere === 'playful' || atmosphere === 'tender')) {
    continuityScore = 0.9
  }
  if (direction.changed) continuityScore = 0.55

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (direction.changed || priorTurns.length >= 4) confidence = 'high'
  else if (priorTurns.length < 2) confidence = 'low'

  /** @type {EmotionalContinuityPlan} */
  const plan = {
    active: true,
    atmosphere,
    priorAtmosphere,
    holdAtmosphere,
    userChangedDirection: direction.changed,
    directionSignal: direction.signal,
    continuityScore,
    guidance: '',
    writerBrief: '',
    structureLine: holdAtmosphere
      ? `Emotional Continuity → hold ${atmosphere} (do not reset)`
      : `Emotional Continuity → follow shift to ${atmosphere}${direction.signal ? ` (${direction.signal})` : ''}`,
    signals: direction.signals.slice(0, 8),
    reasons: [
      holdAtmosphere ? 'hold_atmosphere' : 'follow_user_direction',
      `atm_${atmosphere}`,
      `prior_${priorAtmosphere}`,
      ...(direction.changed ? ['user_changed_direction'] : ['stay_until_user_shifts']),
    ],
    confidence,
    language,
    validationCheck:
      'Am I remembering the emotional atmosphere — or resetting after every message?',
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {EmotionalContinuityPlan | null | undefined} plan
 */
export function formatEmotionalContinuityForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
EMOTIONAL CONTINUITY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · atmosphere=${plan.atmosphere} · hold=${plan.holdAtmosphere} · shifted=${plan.userChangedDirection} · continuity=${plan.continuityScore.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: ricorda l’atmosfera · deep resta deep · playful resta playful · finché l’utente non cambia · non citare il motore.`.trim()
}

/**
 * @param {EmotionalContinuityPlan | null | undefined} plan
 * @returns {string[]}
 */
export function emotionalContinuityStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.holdAtmosphere) {
    hints.push(`Hold atmosphere: ${plan.atmosphere} — do not reset after this message`)
    if (plan.atmosphere === 'deep') hints.push('Stay deep until the user changes direction')
    if (plan.atmosphere === 'playful') hints.push('Stay playful until the user changes direction')
  } else {
    hints.push(`Follow user direction → ${plan.atmosphere}`)
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect atmosphere resets / mismatches.
 * @param {string} draft
 * @param {EmotionalContinuityPlan | null | undefined} plan
 */
export function draftViolatesEmotionalContinuity(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Robotic reset always bad when we have an atmosphere
  if (plan.atmosphere !== 'neutral' && HARD_RESET_ROBOTIC_RE.test(text)) return true

  // Holding playful → reject sudden lecture / formal reset
  if (plan.holdAtmosphere && plan.atmosphere === 'playful') {
    if (
      /\b(let\s+me\s+explain|furthermore|in\s+academic\s+terms|it\s+is\s+important\s+to\s+note)\b/i.test(
        text,
      )
    ) {
      return true
    }
  }

  // Holding deep → reject sudden jokey cabaret
  if (plan.holdAtmosphere && (plan.atmosphere === 'deep' || plan.atmosphere === 'tender')) {
    if (
      /\b(haha|lol|random\s+thought|anyway[,!]?\s+completely\s+unrelated|battuta)\b/i.test(text) &&
      (text.match(/!/g) || []).length >= 2
    ) {
      return true
    }
  }

  // User shifted to playful but draft stays cold formal
  if (plan.userChangedDirection && plan.atmosphere === 'playful') {
    if (HARD_RESET_ROBOTIC_RE.test(text)) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: EmotionalContinuityPlan, context: string }}
 */
export function runEmotionalContinuityEngine(input = {}) {
  try {
    const plan = analyzeEmotionalContinuity(input)
    return {
      plan,
      context: formatEmotionalContinuityForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
