/**
 * LAIfe Conversation Recovery Engine
 *
 * Mission: when the dialogue becomes flat or awkward, recover naturally.
 *
 * Avoid:
 *   - "So, what do you want to talk about?"
 *   - Putting the burden on the user to carry the conversation
 *
 * Instead:
 *   - introduce a fresh observation
 *   - tell a short anecdote
 *   - shift the energy
 *   - reconnect naturally
 *
 * The user should never feel responsible for carrying the conversation alone.
 *
 * Cooperates with Conversation Ownership (lead on passive turns) and
 * Conversation Spark (initiative openings). Distinct focus: mid-dialogue
 * flatness / awkwardness recovery — not first-open spark.
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
 * @typedef {'en'|'it'} RecoveryLang
 */

/**
 * @typedef {'hold'|'fresh_observation'|'short_anecdote'|'shift_energy'|'natural_reconnect'} RecoveryMove
 */

/**
 * @typedef {object} ConversationRecoveryPlan
 * @property {boolean} active
 * @property {boolean} needsRecovery
 * @property {RecoveryMove} move
 * @property {number} flatnessScore 0–1
 * @property {string[]} preferredMoves
 * @property {string[]} forbiddenHandoffs
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {RecoveryLang} language
 * @property {string} validationCheck
 */

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio\s+pi[uù])\b/i

const HARD_TASK =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|codice|code\s+sample|fixami|explain\s+how|aiutami\s+a)\b/i

const FLAT_USER =
  /^(ok|okay|k|sure|fine|whatever|idk|dunno|mh+|mhm+|uhm+|boh|mah|yeah|yep|yup|nah|sì|si|no|capito|capisco|i\s+see|i\s+guess|va\s+bene|bo+)([\s!,.]*)$/i

const AWKWARD_META =
  /\b(this\s+(is|feels)\s+(awkward|weird|flat|forced)|conversazione\s+(strana|imbarazzante|piatta)|non\s+so\s+(cosa|che)\s+(dire|direti)|i\s+don'?t\s+know\s+what\s+to\s+say|we'?re\s+(stuck|out\s+of\s+things)|silenzio\s+imbarazzante|awkward\s+silence)\b/i

const DEAD_AIR =
  /^(so+\.?|anyway\.?|ehm+\.?|uhm+\.?|…+|\.+)$/i

const ENERGY_DIP =
  /\b(bored|boring|meh|tired\s+of\s+this|non\s+so|nothing\s+really|niente\s+di\s+che|bah|bleh)\b/i

const FORBIDDEN_HANDOFF_RE =
  /\b(so[,.]?\s+what\s+do\s+you\s+want\s+to\s+talk\s+about|what\s+(would\s+you\s+like|do\s+you\s+want)\s+to\s+(talk|discuss|chat)\s+about|what\s+should\s+we\s+talk\s+about|is\s+there\s+anything\s+(else\s+)?(on\s+your\s+mind|you'?d\s+like)|di\s+cosa\s+(vuoi|preferisci|vorresti)\s+parlare|di\s+cosa\s+parliamo\??|scegli\s+(tu\s+)?(un\s+)?(tema|argomento)|what\s+interests\s+you(\s+today)?|your\s+turn\s+to\s+pick)\b/i

const FORBIDDEN_HANDOFFS = Object.freeze([
  'So, what do you want to talk about?',
  'What would you like to discuss?',
  'What should we talk about?',
  'Di cosa vuoi parlare?',
  'Di cosa parliamo?',
  'Is there anything else on your mind?',
])

const PREFERRED_MOVES_EN = Object.freeze([
  'fresh observation',
  'short anecdote',
  'energy shift',
  'natural reconnect',
])

const PREFERRED_MOVES_IT = Object.freeze([
  'osservazione fresca',
  'aneddoto breve',
  'cambio di energia',
  'ricollegamento naturale',
])

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
 * Stable 0–1 hash (no Math.random).
 * @param {string} seed
 */
function hash01(seed) {
  let h = 2166136261
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/**
 * Recent user turns excluding current message when duplicated at end.
 * @param {ChatTurn[]} turns
 * @param {string} userMessage
 */
function priorTurns(turns, userMessage) {
  if (
    turns.length &&
    turns[turns.length - 1].role === 'user' &&
    turns[turns.length - 1].content === userMessage
  ) {
    return turns.slice(0, -1)
  }
  return turns
}

/**
 * Count consecutive short/flat user turns at the end of history (+ current).
 * @param {ChatTurn[]} prior
 * @param {string} userMessage
 */
function flatStreak(prior, userMessage) {
  let streak = 0
  if (FLAT_USER.test(userMessage) || DEAD_AIR.test(userMessage) || ENERGY_DIP.test(userMessage)) {
    streak = 1
  } else {
    return 0
  }
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].role !== 'user') continue
    if (FLAT_USER.test(prior[i].content) || DEAD_AIR.test(prior[i].content)) streak++
    else break
  }
  return streak
}

/**
 * @param {string[]} reasons
 * @returns {ConversationRecoveryPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    needsRecovery: false,
    move: 'hold',
    flatnessScore: 0,
    preferredMoves: [...PREFERRED_MOVES_EN],
    forbiddenHandoffs: [...FORBIDDEN_HANDOFFS],
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I recovering the conversation myself — or dumping the burden back on the user?',
  }
}

/**
 * Score how flat / awkward the dialogue feels.
 * @param {object} opts
 */
function scoreFlatness(opts) {
  const {
    userMessage,
    prior,
    emotionalMomentum,
    conversationOwnership,
    conversationSpark,
    feedbackInterpretation,
  } = opts
  /** @type {string[]} */
  const signals = []
  let score = 0

  if (AWKWARD_META.test(userMessage)) {
    score += 0.55
    signals.push('awkward_meta')
  }
  if (DEAD_AIR.test(userMessage)) {
    score += 0.4
    signals.push('dead_air')
  }
  if (ENERGY_DIP.test(userMessage)) {
    score += 0.35
    signals.push('energy_dip')
  }

  const streak = flatStreak(prior, userMessage)
  if (streak >= 1) {
    score += Math.min(0.45, 0.18 * streak)
    signals.push(`flat_streak_${streak}`)
  }

  // Long assistant turn followed by tiny user reply → risk of dumped burden
  const lastAsst = [...prior].reverse().find((t) => t.role === 'assistant')
  if (lastAsst) {
    const asstWords = lastAsst.content.split(/\s+/).filter(Boolean).length
    const userWords = userMessage.split(/\s+/).filter(Boolean).length
    if (asstWords >= 60 && userWords <= 6) {
      score += 0.28
      signals.push('long_reply_tiny_ack')
    }
    if (/\?\s*$/.test(lastAsst.content) && userWords <= 5 && FLAT_USER.test(userMessage)) {
      score += 0.22
      signals.push('question_then_flat')
    }
  }

  const em = emotionalMomentum?.plan || emotionalMomentum || null
  const emPace = em?.state?.conversationalPace
  const emEnergy = em?.state?.energy
  if (emPace === 'slow' && (emEnergy === 'low' || emEnergy === 'flat')) {
    score += 0.15
    signals.push('momentum_low')
  }

  const own = conversationOwnership?.plan || conversationOwnership || null
  if (own?.takeLead) {
    score += 0.12
    signals.push('ownership_take_lead')
  }

  const spark = conversationSpark?.plan || conversationSpark || null
  if (spark?.shouldSpark) {
    score += 0.08
    signals.push('spark_also_active')
  }

  const fb = feedbackInterpretation?.plan || feedbackInterpretation || null
  if (fb?.signals?.some?.((s) => /awkward|weird|flat/i.test(String(s)))) {
    score += 0.2
    signals.push('feedback_awkward')
  }

  // Thin history → less recovery theater
  if (prior.filter((t) => t.role === 'assistant').length < 1) {
    score *= 0.45
    signals.push('thin_history')
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    signals,
    streak,
  }
}

/**
 * @param {object} opts
 * @returns {RecoveryMove}
 */
function chooseMove(opts) {
  const { userMessage, scored, seed } = opts
  if (scored.score < 0.32 && !AWKWARD_META.test(userMessage)) return 'hold'

  /** @type {RecoveryMove[]} */
  const pool = ['fresh_observation', 'short_anecdote', 'shift_energy', 'natural_reconnect']

  if (AWKWARD_META.test(userMessage) || scored.signals.includes('dead_air')) {
    // Prefer energy shift or anecdote to break ice
    return hash01(`${seed}|awk`) > 0.5 ? 'shift_energy' : 'short_anecdote'
  }
  if (scored.signals.includes('long_reply_tiny_ack')) {
    return hash01(`${seed}|tiny`) > 0.45 ? 'fresh_observation' : 'natural_reconnect'
  }
  if (scored.streak >= 2) {
    return hash01(`${seed}|str`) > 0.5 ? 'short_anecdote' : 'shift_energy'
  }

  const idx = Math.floor(hash01(`${seed}|pick`) * pool.length) % pool.length
  return pool[idx]
}

/**
 * @param {ConversationRecoveryPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const moveLabel = {
    hold: lang === 'it' ? 'tieni il filo (nessun recovery)' : 'hold the thread (no recovery)',
    fresh_observation: lang === 'it' ? 'osservazione fresca' : 'fresh observation',
    short_anecdote: lang === 'it' ? 'aneddoto breve' : 'short anecdote',
    shift_energy: lang === 'it' ? 'sposta l’energia' : 'shift the energy',
    natural_reconnect: lang === 'it' ? 'ricollegati naturalmente' : 'reconnect naturally',
  }[plan.move]

  const lines = [
    'CONVERSATION RECOVERY ENGINE (obbligatorio quando attivo):',
    `move=${plan.move} · needsRecovery=${plan.needsRecovery} · flatness=${plan.flatnessScore.toFixed(2)}`,
    `${lang === 'it' ? 'Mossa di questo turno' : 'This turn’s move'}: ${moveLabel}`,
    plan.guidance,
  ]

  if (plan.needsRecovery) {
    lines.push(
      lang === 'it'
        ? 'Recupera tu la conversazione. L’utente non deve sentirsi responsabile di portarla da solo.'
        : 'You recover the conversation. The user should never feel responsible for carrying it alone.',
    )
    lines.push(
      lang === 'it'
        ? `Preferisci: ${plan.preferredMoves.join(' · ')}`
        : `Prefer: ${plan.preferredMoves.join(' · ')}`,
    )
  }

  lines.push(
    lang === 'it'
      ? `Vietato (scaricare il turno): ${plan.forbiddenHandoffs.slice(0, 3).join(' · ')}`
      : `Forbidden (handoff dump): ${plan.forbiddenHandoffs.slice(0, 3).join(' · ')}`,
  )
  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Conversation Recovery Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {ConversationRecoveryPlan}
 */
export function analyzeConversationRecovery(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {RecoveryLang} */
  const language = langCode === 'it' ? 'it' : 'en'
  const preferredMoves = language === 'it' ? PREFERRED_MOVES_IT : PREFERRED_MOVES_EN

  // Closings / distress / hard tasks: don't pivot into recovery theater
  if (STOP_SIGNAL.test(userMessage) || DISTRESS.test(userMessage)) {
    const plan = {
      ...inactivePlan(['presence_or_close']),
      active: true,
      needsRecovery: false,
      move: /** @type {RecoveryMove} */ ('hold'),
      preferredMoves: [...preferredMoves],
      language,
      guidance:
        language === 'it'
          ? 'Presenza / chiusura — non forzare un recovery brillante.'
          : 'Presence / closing — do not force a bright recovery.',
      structureLine: 'Conversation Recovery → hold (presence)',
      signals: ['hold_presence'],
      reasons: ['no_recovery_under_distress_or_close'],
      confidence: /** @type {'high'|'medium'|'low'} */ ('high'),
    }
    plan.writerBrief = buildBrief(plan)
    return plan
  }

  if (HARD_TASK.test(userMessage) && userMessage.length > 40) {
    const plan = {
      ...inactivePlan(['hard_task']),
      active: true,
      needsRecovery: false,
      move: /** @type {RecoveryMove} */ ('hold'),
      preferredMoves: [...preferredMoves],
      language,
      guidance:
        language === 'it'
          ? 'Compito concreto — servi la richiesta; recovery non necessario.'
          : 'Concrete task — serve the request; recovery not needed.',
      structureLine: 'Conversation Recovery → hold (task)',
      signals: ['hold_task'],
      reasons: ['clarity_over_recovery'],
      confidence: /** @type {'high'|'medium'|'low'} */ ('high'),
    }
    plan.writerBrief = buildBrief(plan)
    return plan
  }

  const prior = priorTurns(turns, userMessage)
  const scored = scoreFlatness({
    userMessage,
    prior,
    emotionalMomentum: input.emotionalMomentum,
    conversationOwnership: input.conversationOwnership,
    conversationSpark: input.conversationSpark,
    feedbackInterpretation: input.feedbackInterpretation,
  })

  const seed = `${prior.filter((t) => t.role === 'assistant').length}|${userMessage.slice(0, 48)}`
  const move = chooseMove({ userMessage, scored, seed })
  const needsRecovery = move !== 'hold'

  /** @type {string[]} */
  const reasons = needsRecovery
    ? ['flat_or_awkward', 'recover_without_handoff', `move_${move}`]
    : ['thread_ok']

  const guidance = needsRecovery
    ? language === 'it'
      ? 'Il dialogo è piatto o imbarazzante: recupera con un’osservazione fresca, un aneddoto breve, uno shift di energia o un ricollegamento naturale. Mai “Di cosa vuoi parlare?”.'
      : 'Dialogue is flat or awkward: recover with a fresh observation, short anecdote, energy shift, or natural reconnect. Never “So, what do you want to talk about?”.'
    : language === 'it'
      ? 'Filo vivo — continua normalmente; niente recovery forzato.'
      : 'Thread is alive — continue normally; no forced recovery.'

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (needsRecovery && (scored.score >= 0.55 || AWKWARD_META.test(userMessage))) {
    confidence = 'high'
  }
  if (prior.length < 2) confidence = 'low'

  /** @type {ConversationRecoveryPlan} */
  const plan = {
    active: true,
    needsRecovery,
    move,
    flatnessScore: scored.score,
    preferredMoves: [...preferredMoves],
    forbiddenHandoffs: [...FORBIDDEN_HANDOFFS],
    guidance,
    writerBrief: '',
    structureLine: `Conversation Recovery → ${move}${needsRecovery ? ' · recover' : ''}`,
    signals: [
      `move_${move}`,
      needsRecovery ? 'needs_recovery' : 'no_recovery',
      `flat_${scored.score.toFixed(2)}`,
      ...scored.signals.slice(0, 4),
    ],
    reasons,
    confidence,
    language,
    validationCheck:
      'Am I recovering the conversation myself — or dumping the burden back on the user?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {ConversationRecoveryPlan | null | undefined} plan
 */
export function formatConversationRecoveryForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATION RECOVERY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · move=${plan.move} · needsRecovery=${plan.needsRecovery} · flatness=${plan.flatnessScore.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: recupera tu · osservazione/aneddoto/energia/ricollegamento · mai “what do you want to talk about?” · non citare il motore.`.trim()
}

/**
 * @param {ConversationRecoveryPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationRecoveryStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.needsRecovery) {
    hints.push('Recover naturally: observation / anecdote / energy shift / reconnect')
    hints.push('User must not carry the conversation alone')
  } else {
    hints.push('Thread ok — no forced recovery')
  }
  hints.push('Forbidden: So, what do you want to talk about? / Di cosa vuoi parlare?')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect handoff dumps / fake recovery when recovery was required.
 * @param {string} draft
 * @param {ConversationRecoveryPlan | null | undefined} plan
 */
export function draftViolatesConversationRecovery(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject classic handoff dumps
  if (FORBIDDEN_HANDOFF_RE.test(text)) return true

  if (!plan.needsRecovery) return false

  // Recovery required but reply is only a generic question dumping burden
  const words = text.split(/\s+/).filter(Boolean).length
  if (words <= 20 && /\?\s*$/.test(text) && FORBIDDEN_HANDOFF_RE.test(text)) return true

  // Empty ack-only when recovery needed
  if (/^(ok|okay|sure|got\s+it|capito|va\s+bene)[.!]?\s*$/i.test(text)) return true

  // Long-ish recovery turn that is only an interview closer
  if (
    plan.flatnessScore >= 0.45 &&
    words > 12 &&
    /\?\s*$/.test(text) &&
    /\b(what\s+(about|do)\s+you|how\s+about\s+you|e\s+tu\??|tu\s+che\s+ne\s+pensi)\b/i.test(text) &&
    !/\b(noticed|observation|other\s+day|reminds\s+me|aneddot|osserv|l'?altra\s+volta)\b/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationRecoveryPlan, context: string }}
 */
export function runConversationRecoveryEngine(input = {}) {
  try {
    const plan = analyzeConversationRecovery(input)
    return {
      plan,
      context: formatConversationRecoveryForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
