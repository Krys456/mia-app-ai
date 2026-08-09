/**
 * LAIfe Conversation Chemistry Engine
 *
 * Mission: measure conversational chemistry.
 *
 * Estimate:
 *   - comfort
 *   - trust
 *   - rhythm
 *   - engagement
 *
 * Adapt naturally.
 *   High chemistry  → more spontaneous
 *   Low chemistry   → focus on listening
 *
 * Distinct from Emotional Momentum (emotional trajectory / climate).
 * This engine estimates the *bond* between speakers and adapts stance.
 *
 * Runs AFTER: Genuine Curiosity (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} ChemistryLang
 */

/**
 * @typedef {'listening'|'balanced'|'spontaneous'} ChemistryStance
 */

/**
 * @typedef {'low'|'medium'|'high'} ChemistryBand
 */

/**
 * @typedef {object} ChemistryMetrics
 * @property {number} comfort 0–1
 * @property {number} trust 0–1
 * @property {number} rhythm 0–1
 * @property {number} engagement 0–1
 */

/**
 * @typedef {object} ConversationChemistryPlan
 * @property {boolean} active
 * @property {ChemistryMetrics} metrics
 * @property {number} chemistryScore 0–1 overall
 * @property {ChemistryBand} band
 * @property {ChemistryStance} stance
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ChemistryLang} language
 * @property {string} validationCheck
 */

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|fixami\s+il\s+codice|stack\s+trace)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const LAUGH_RE = /\b(haha|hahaha|ahah|lol|lmao|😂|🤣|scherz)\b/i
const WARM_ACK_RE =
  /\b(love\s+this|this\s+helps|that\s+makes\s+sense|exactly|yes[!]+|perfetto|esatto|mi\s+piace|grazie\s+davvero|that'?s\s+awesome|cool[!]?)\b/i
const PERSONAL_RE =
  /\b(i\s+feel|i'?m\s+(scared|worried|excited|happy|sad|lonely)|my\s+(job|partner|family|friend|mom|dad)|mi\s+sento|ho\s+paura|sono\s+(triste|felice|ansios)|il\s+mio\s+(lavoro|ragazzo|ragazza|amico))\b/i
const FLAT_ACK_RE =
  /^(ok|okay|k|yes|yep|yeah|no|nope|sure|fine|mh+|mm+|capito|sì|si|va\s+bene)[\s!.]*$/i
const COLD_ROBOTIC_RE =
  /\b(how\s+can\s+i\s+help\s+you(\s+today)?|as\s+an\s+ai\b|i'?m\s+just\s+an\s+ai|come\s+posso\s+aiutarti|in\s+conclusione[,:]|let\s+me\s+know\s+if\s+you\s+(need|have)\s+any)\b/i
const OVER_SPONTANEOUS_RE =
  /\b(hahaha|lol|random\s+thought|side\s+note|anyway[,!]?\s+completely\s+unrelated|ahahah)\b/i

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
 * Clamp 0–1.
 * @param {number} n
 */
function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

/**
 * @param {number} score
 * @returns {ChemistryBand}
 */
function bandFromScore(score) {
  if (score >= 0.6) return 'high'
  if (score > 0.38) return 'medium'
  return 'low'
}

/**
 * @param {ChemistryBand} band
 * @returns {ChemistryStance}
 */
function stanceFromBand(band) {
  if (band === 'high') return 'spontaneous'
  if (band === 'low') return 'listening'
  return 'balanced'
}

/**
 * Estimate chemistry metrics from the conversation so far.
 * @param {object} opts
 * @returns {{ metrics: ChemistryMetrics, chemistryScore: number, signals: string[], reasons: string[], confidence: 'high'|'medium'|'low' }}
 */
function estimateChemistry(opts) {
  const { userMessage, turns, emotionalMomentum, conversationIntent } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []

  const userTurns = turns.filter((t) => t.role === 'user')
  const assistantTurns = turns.filter((t) => t.role === 'assistant')
  const recentUsers = userTurns.slice(-4)
  const recentAssist = assistantTurns.slice(-4)

  let comfort = 0.42
  let trust = 0.4
  let rhythm = 0.45
  let engagement = 0.42

  // —— Comfort ——
  if (LAUGH_RE.test(userMessage)) {
    comfort += 0.22
    signals.push('laugh')
  }
  if (WARM_ACK_RE.test(userMessage)) {
    comfort += 0.16
    signals.push('warm_ack')
  }
  const casualHits = recentUsers.filter((t) =>
    /\b(haha|lol|yeah|like|kinda|sorta|boh|mah|cio[eè])\b/i.test(t.content),
  ).length
  comfort += Math.min(0.18, casualHits * 0.06)
  if (DISTRESS_RE.test(userMessage)) {
    comfort -= 0.2
    signals.push('distress_low_comfort')
  }
  if (FLAT_ACK_RE.test(userMessage) && recentUsers.length >= 2) {
    comfort -= 0.08
  }

  // —— Trust ——
  if (PERSONAL_RE.test(userMessage)) {
    trust += 0.22
    signals.push('personal_share')
  }
  const personalRecent = recentUsers.filter((t) => PERSONAL_RE.test(t.content)).length
  trust += Math.min(0.2, personalRecent * 0.07)
  // Include current turn in depth (prior + this message)
  const depthUsers = recentUsers.length + (userMessage ? 1 : 0)
  const depthAssist = assistantTurns.length
  if (depthAssist >= 2 && depthUsers >= 3) {
    trust += 0.1
    signals.push('session_depth')
  }
  if (/\b(never\s+mind|whatever|forget\s+it|lascia\s+perdere|non\s+importa)\b/i.test(userMessage)) {
    trust -= 0.12
    signals.push('withdraw')
  }
  if (STOP_SIGNAL.test(userMessage)) {
    trust -= 0.1
  }

  // —— Rhythm ——
  const avgUserLen =
    recentUsers.reduce((s, t) => s + t.content.split(/\s+/).length, 0) /
      Math.max(1, recentUsers.length) || 8
  const avgAssistLen =
    recentAssist.reduce((s, t) => s + t.content.split(/\s+/).length, 0) /
      Math.max(1, recentAssist.length) || 20
  const curLen = userMessage.split(/\s+/).filter(Boolean).length || avgUserLen
  const blendedUserLen = (avgUserLen * recentUsers.length + curLen) / Math.max(1, recentUsers.length + 1)
  const lenRatio =
    blendedUserLen > 0 && avgAssistLen > 0
      ? Math.min(blendedUserLen, avgAssistLen) / Math.max(blendedUserLen, avgAssistLen)
      : 0.5
  rhythm += (lenRatio - 0.35) * 0.4

  const flatStreak = (() => {
    let n = FLAT_ACK_RE.test(userMessage) ? 1 : 0
    for (let i = recentUsers.length - 1; i >= 0; i--) {
      if (FLAT_ACK_RE.test(recentUsers[i].content)) n += 1
      else break
    }
    return n
  })()
  if (flatStreak >= 2) {
    rhythm -= 0.2
    signals.push('flat_ack_streak')
  } else if (flatStreak === 1 && FLAT_ACK_RE.test(userMessage)) {
    rhythm -= 0.08
  }

  const em = emotionalMomentum?.plan || emotionalMomentum || null
  if (em?.state?.conversationalPace === 'brisk' && userMessage.length < 80) {
    rhythm += 0.08
    signals.push('pace_match_brisk')
  }
  if (em?.state?.conversationalPace === 'slow' && PERSONAL_RE.test(userMessage)) {
    rhythm += 0.08
    signals.push('pace_match_slow')
  }
  if (em?.userShifted) {
    rhythm -= 0.05
    signals.push('pace_shift')
  }

  // —— Engagement ——
  if (/\?\s*$/.test(userMessage) || /\b(why|how|what\s+if|perch[eé]|come\s+mai)\b/i.test(userMessage)) {
    engagement += 0.16
    signals.push('curious_ask')
  }
  if (userMessage.split(/\s+/).length >= 14) {
    engagement += 0.14
    signals.push('elaborated')
  }
  if (WARM_ACK_RE.test(userMessage) || LAUGH_RE.test(userMessage)) {
    engagement += 0.12
  }
  if (FLAT_ACK_RE.test(userMessage)) {
    engagement -= 0.18
    signals.push('low_engagement_ack')
  }
  if (HARD_TASK_RE.test(userMessage)) {
    engagement += 0.05
    signals.push('task_focus')
  }

  const intent = conversationIntent?.plan?.inference || conversationIntent?.inference || null
  if (intent?.engagementLevel === 'high') {
    engagement += 0.12
    signals.push('intent_high_engagement')
  } else if (intent?.engagementLevel === 'low') {
    engagement -= 0.12
    signals.push('intent_low_engagement')
  }
  if (intent?.opennessToContinue === 'open') {
    engagement += 0.06
  } else if (intent?.opennessToContinue === 'closed') {
    engagement -= 0.1
  }

  comfort = clamp01(comfort)
  trust = clamp01(trust)
  rhythm = clamp01(rhythm)
  engagement = clamp01(engagement)

  let chemistryScore = clamp01(
    comfort * 0.25 + trust * 0.25 + rhythm * 0.2 + engagement * 0.3,
  )
  // Synergy: warm + curious turns feel like real chemistry
  if (signals.includes('warm_ack') && signals.includes('curious_ask')) {
    chemistryScore = clamp01(chemistryScore + 0.06)
  }
  if (signals.includes('laugh') && signals.includes('personal_share')) {
    chemistryScore = clamp01(chemistryScore + 0.05)
  }
  if (signals.includes('flat_ack_streak') && signals.includes('low_engagement_ack')) {
    chemistryScore = clamp01(chemistryScore - 0.05)
  }

  reasons.push(`comfort_${comfort.toFixed(2)}`)
  reasons.push(`trust_${trust.toFixed(2)}`)
  reasons.push(`rhythm_${rhythm.toFixed(2)}`)
  reasons.push(`engagement_${engagement.toFixed(2)}`)

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (userTurns.length + assistantTurns.length >= 4) confidence = 'high'
  else if (userTurns.length <= 1) confidence = 'low'

  return {
    metrics: { comfort, trust, rhythm, engagement },
    chemistryScore,
    signals,
    reasons,
    confidence,
  }
}

/**
 * @param {ConversationChemistryPlan} plan
 */
function buildGuidance(plan) {
  const lang = plan.language
  if (plan.stance === 'spontaneous') {
    return lang === 'it'
      ? 'Chimica alta → più spontaneità: reazioni vive, leggeri salti di pensiero, calore naturale. Non forzare il “divertente”.'
      : 'High chemistry → more spontaneous: living reactions, light leaps of thought, natural warmth. Do not force “fun.”'
  }
  if (plan.stance === 'listening') {
    return lang === 'it'
      ? 'Chimica bassa → ascolto prima di tutto: ritmo più lento, meno initiative, riflessioni corte, zero battute forzate.'
      : 'Low chemistry → focus on listening: slower pace, less initiative, short reflections, zero forced jokes.'
  }
  return lang === 'it'
    ? 'Chimica media → equilibrio: presente e naturale, né troppo spinto né troppo cauto.'
    : 'Medium chemistry → balanced: present and natural, neither pushy nor overly cautious.'
}

/**
 * @param {string[]} reasons
 * @returns {ConversationChemistryPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    metrics: { comfort: 0, trust: 0, rhythm: 0, engagement: 0 },
    chemistryScore: 0,
    band: 'low',
    stance: 'listening',
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I adapt to conversational chemistry — spontaneous when high, listening when low?',
  }
}

/**
 * @param {ConversationChemistryPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const m = plan.metrics
  return [
    'CONVERSATION CHEMISTRY ENGINE (obbligatorio quando attivo):',
    `chemistry=${plan.chemistryScore.toFixed(2)} (${plan.band}) · stance=${plan.stance}`,
    `metrics: comfort=${m.comfort.toFixed(2)} · trust=${m.trust.toFixed(2)} · rhythm=${m.rhythm.toFixed(2)} · engagement=${m.engagement.toFixed(2)}`,
    plan.guidance,
    lang === 'it'
      ? 'Adatta in modo naturale. Non annunciare i punteggi. Non sembrare un termometro sociale.'
      : 'Adapt naturally. Do not announce scores. Do not sound like a social thermometer.',
    plan.stance === 'spontaneous'
      ? lang === 'it'
        ? 'Consentito: reazioni spontanee, leggero play, collegamenti vivi — se calzano.'
        : 'Allowed: spontaneous reactions, light play, living links — when they fit.'
      : plan.stance === 'listening'
        ? lang === 'it'
          ? 'Priorità: ascoltare, rispecchiare, lasciare spazio. Evita spontaneità forzata e initiative pesanti.'
          : 'Priority: listen, reflect, leave space. Avoid forced spontaneity and heavy initiative.'
        : lang === 'it'
          ? 'Tieni un ritmo naturale da partner — né lezione né cabaret.'
          : 'Keep a natural partner rhythm — neither lecture nor cabaret.',
    `Check: «${plan.validationCheck}»`,
    'Non citare Conversation Chemistry Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {ConversationChemistryPlan}
 */
export function analyzeConversationChemistry(input = {}) {
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
  /** @type {ChemistryLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const estimated = estimateChemistry({
    userMessage,
    turns: priorTurns,
    emotionalMomentum: input.emotionalMomentum,
    conversationIntent: input.conversationIntent,
  })

  const band = bandFromScore(estimated.chemistryScore)
  const stance = stanceFromBand(band)

  // Distress → force listening even if other metrics high
  /** @type {ChemistryStance} */
  let finalStance = stance
  /** @type {ChemistryBand} */
  let finalBand = band
  const signals = [...estimated.signals]
  const reasons = [...estimated.reasons]
  if (DISTRESS_RE.test(userMessage)) {
    finalStance = 'listening'
    finalBand = 'low'
    signals.push('force_listening_distress')
    reasons.push('distress_overrides_spontaneity')
  }

  /** @type {ConversationChemistryPlan} */
  const plan = {
    active: true,
    metrics: estimated.metrics,
    chemistryScore: estimated.chemistryScore,
    band: finalBand,
    stance: finalStance,
    guidance: '',
    writerBrief: '',
    structureLine: `Conversation Chemistry → ${finalStance} · ${finalBand} (${estimated.chemistryScore.toFixed(2)})`,
    signals,
    reasons,
    confidence: estimated.confidence,
    language,
    validationCheck:
      'Did I adapt to conversational chemistry — spontaneous when high, listening when low?',
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {ConversationChemistryPlan | null | undefined} plan
 */
export function formatConversationChemistryForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION CHEMISTRY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · score=${plan.chemistryScore.toFixed(2)} · band=${plan.band} · stance=${plan.stance} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: adatta · high→spontaneo · low→ascolto · non citare metri/punteggi · non citare il motore.`.trim()
}

/**
 * @param {ConversationChemistryPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationChemistryStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.stance === 'spontaneous') {
    hints.push('High chemistry — more spontaneous (natural, not forced)')
  } else if (plan.stance === 'listening') {
    hints.push('Low chemistry — focus on listening first')
  } else {
    hints.push('Medium chemistry — balanced partner rhythm')
  }
  hints.push(
    `comfort ${plan.metrics.comfort.toFixed(2)} · trust ${plan.metrics.trust.toFixed(2)} · rhythm ${plan.metrics.rhythm.toFixed(2)} · engagement ${plan.metrics.engagement.toFixed(2)}`,
  )
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect stance mismatches (spontaneous when should listen, or cold when chemistry is high).
 * @param {string} draft
 * @param {ConversationChemistryPlan | null | undefined} plan
 */
export function draftViolatesConversationChemistry(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // High / spontaneous: reject cold helpdesk / robotic openers
  if (plan.stance === 'spontaneous' && plan.band === 'high') {
    if (COLD_ROBOTIC_RE.test(text)) return true
    if (/^(certainly|absolutely|of course)[,.]?\s+(i\s+can|here\s+is)/i.test(text)) return true
  }

  // Low / listening: reject heavy spontaneous / jokey initiative
  if (plan.stance === 'listening') {
    if (OVER_SPONTANEOUS_RE.test(text) && (text.match(/!/g) || []).length >= 2) return true
    if (
      /\b(random\s+thought|completely\s+unrelated|speaking\s+of\s+which[,!]?\s+have\s+you\s+ever)\b/i.test(
        text,
      )
    ) {
      return true
    }
    // Don't dump long lectures when chemistry is low — prefer listening length
    if (text.split(/\s+/).length > 220 && (text.match(/^\s*[-*•]/gm) || []).length >= 4) {
      return true
    }
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationChemistryPlan, context: string }}
 */
export function runConversationChemistryEngine(input = {}) {
  try {
    const plan = analyzeConversationChemistry(input)
    return {
      plan,
      context: formatConversationChemistryForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
