/**
 * LAIfe Conversational Presence
 *
 * LAIfe should feel present in the conversation.
 * The goal is not to imitate a human —
 * the goal is conversations that feel naturally engaging.
 *
 * Before replying, ask internally:
 *   - Does this sound like someone genuinely engaged?
 *   - Am I reacting to what the user meant, not only to the words?
 *   - Am I continuing a shared thought instead of restarting?
 *   - Am I asking this question because it is useful, or because it is easy?
 *   - Would this response make the conversation feel warmer, more natural, or more interesting?
 *
 * Prefer: reactions, observations, shared reasoning, thoughtful transitions,
 *         occasional humor, emotional acknowledgment when appropriate.
 * Avoid: repetitive interview-style questions, generic assistant phrases,
 *        explaining obvious concepts, restarting the topic after every user message.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'engage'|'react'|'listen'|'shared_thread'|'substance'} PresenceMode
 */

/**
 * @typedef {object} ConversationalPresencePlan
 * @property {boolean} active
 * @property {PresenceMode} mode
 * @property {boolean} restartRisk
 * @property {boolean} interviewRisk
 * @property {boolean} preferReaction
 * @property {boolean} preferSharedThought
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} checklist
 * @property {string[]} prefer
 * @property {string[]} avoid
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const GENERIC_ASSISTANT =
  /(^(certo|ecco|capisco|i\s+understand|assolutamente|of\s+course)[.!]+\s*)|\b(come\s+posso\s+aiutarti|how\s+can\s+i\s+help|i'?m\s+here\s+to\s+help|sono\s+qui\s+per\s+aiutarti|dimmi\s+pure|tell\s+me\.?|any\s+questions|hai\s+domande|fammi\s+sapere|let\s+me\s+know|non\s+esitare|feel\s+free\s+to\s+ask|in\s+cosa\s+posso\s+aiutarti|ottima\s+domanda|great\s+question)\b/i

const SHORT_REACT =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|thanks|thank\s+you|grazie|capito|capisco|i\s+see|i\s+understand|makes\s+sense|ah|oh|mm+|uhm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto|esatto)([\s!,.🥰😊🙏💯🔥]*)$/i

const ENTHUSIASM =
  /\b(interesting|cool|wow|awesome|amazing|nice|love\s+(this|that|it)|i\s+like\s+(this|that|it)|interessante|figo|forte|bell[oa]|that'?s\s+(awesome|cool|amazing|great|interesting)|ottimo|fantastico)\b/i

const EMOTIONAL =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|angry|arrabbiat|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|hurt|male|depress|panic|worried|preoccupat|upset|dispiaciut)\b/i

const GREETING =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening))([\s!,.🥰😊🙏]*)$/i

const SUBSTANCE =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement)\b/i

const CHECKLIST = [
  'Sembra qualcuno genuinamente presente / impegnato nella conversazione?',
  'Sto reagendo a ciò che l’utente intendeva, non solo alle parole?',
  'Sto continuando un pensiero condiviso invece di ripartire da zero?',
  'Questa domanda è utile — o è solo facile?',
  'Questa risposta rende la conversazione più calda, naturale o interessante?',
]

const PREFER = [
  'reazioni genuine',
  'osservazioni',
  'ragionamento condiviso',
  'transizioni ponderate',
  'umorismo occasionale e leggero',
  'riconoscimento emotivo quando appropriato',
]

const AVOID = [
  'domande da intervista ripetitive',
  'frasi generiche da assistente',
  'spiegare concetti ovvi',
  'riavviare il tema a ogni messaggio utente',
]

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ChatTurn[]|undefined|null} messages
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
 * @param {ChatTurn[]} turns
 */
function lastAssistant(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return turns[i].content
  }
  return ''
}

/**
 * @param {ChatTurn[]} turns
 */
function assistantCount(turns) {
  return turns.filter((t) => t.role === 'assistant').length
}

/**
 * @returns {ConversationalPresencePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    mode: 'engage',
    restartRisk: false,
    interviewRisk: false,
    preferReaction: false,
    preferSharedThought: false,
    confidence: 'low',
    writerBrief: '',
    checklist: [...CHECKLIST],
    prefer: [...PREFER],
    avoid: [...AVOID],
    reasons,
    signals: [],
  }
}

/**
 * @param {object} input
 * @returns {{ mode: PresenceMode, signals: string[], restartRisk: boolean, interviewRisk: boolean, preferReaction: boolean, preferSharedThought: boolean, confidence: 'high'|'medium'|'low' }}
 */
function classifyPresence(input) {
  const msg = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const prior = lastAssistant(turns)
  const priorCount = assistantCount(turns)
  const tone = String(input.understanding?.emotionalTone || '')
  const primary = String(
    input.understanding?.primaryIntent || input.planHints?.primaryIntent || '',
  )
  const behavior = String(input.behavior?.behavior || input.planHints?.behavior || '')
  const continuationOwns = Boolean(
    input.continuation?.plan?.shouldContinue || input.continuation?.shouldContinue,
  )
  const complimentDeep =
    input.continuation?.plan?.intent === 'compliment_go_deeper' ||
    input.continuation?.intent === 'compliment_go_deeper'
  const warmActive = Boolean(input.warmConversation?.plan?.active)

  /** @type {string[]} */
  const signals = []
  let restartRisk = priorCount >= 1 && msg.length > 0 && msg.length < 80 && !SUBSTANCE.test(msg)
  let interviewRisk = primary === 'greeting' || primary === 'conversation' || warmActive
  let preferReaction = false
  let preferSharedThought = priorCount >= 1
  /** @type {PresenceMode} */
  let mode = priorCount >= 1 ? 'shared_thread' : 'engage'
  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'

  if (
    tone === 'frustrated' ||
    tone === 'anxious' ||
    tone === 'disappointed' ||
    EMOTIONAL.test(msg) ||
    behavior === 'emotional_support'
  ) {
    mode = 'listen'
    preferReaction = true
    preferSharedThought = true
    restartRisk = true
    interviewRisk = true
    confidence = 'high'
    signals.push('emotional_listen')
  } else if (
    complimentDeep ||
    ENTHUSIASM.test(msg) ||
    SHORT_REACT.test(msg) ||
    tone === 'excited' ||
    tone === 'grateful' ||
    tone === 'positive'
  ) {
    mode = 'react'
    preferReaction = true
    preferSharedThought = true
    restartRisk = true
    interviewRisk = true
    confidence = 'high'
    signals.push(complimentDeep ? 'compliment_react' : 'enthusiasm_react')
  } else if (continuationOwns) {
    mode = 'shared_thread'
    preferSharedThought = true
    preferReaction = true
    restartRisk = true
    confidence = 'high'
    signals.push('continuation_shared')
  } else if (GREETING.test(msg) || primary === 'greeting' || warmActive) {
    mode = 'engage'
    preferReaction = true
    interviewRisk = true
    confidence = warmActive ? 'high' : 'medium'
    signals.push('opening_engage')
  } else if (SUBSTANCE.test(msg) || primary === 'how_to' || primary === 'explanation' || primary === 'task') {
    mode = 'substance'
    preferSharedThought = priorCount >= 1
    restartRisk = priorCount >= 1 && !SUBSTANCE.test(msg)
    interviewRisk = false
    confidence = 'medium'
    signals.push('substance_present')
  } else if (priorCount >= 1) {
    mode = 'shared_thread'
    preferSharedThought = true
    restartRisk = msg.length < 120
    confidence = 'medium'
    signals.push('mid_thread')
  } else {
    mode = 'engage'
    signals.push('fresh_engage')
  }

  if (prior && /\?\s*$/.test(prior.slice(-80))) {
    interviewRisk = true
    signals.push('prior_ended_question')
  }

  return {
    mode,
    signals,
    restartRisk,
    interviewRisk,
    preferReaction,
    preferSharedThought,
    confidence,
  }
}

/**
 * @param {PresenceMode} mode
 * @param {{ restartRisk: boolean, interviewRisk: boolean, preferReaction: boolean, preferSharedThought: boolean }} opts
 */
function buildBrief(mode, opts) {
  const lines = [
    'Conversational Presence: sentiti presente — non imitare un umano; crea conversazioni naturalmente coinvolgenti.',
    'Obiettivo silenzioso: reazione al significato + pensiero condiviso + ritmo naturale. Niente “presenza teatrale”.',
  ]
  if (opts.restartRisk || opts.interviewRisk) {
    lines.push(
      'Attenzione: evita restart e interviste; preferisci osservazione/reazione/ragionamento condiviso.',
    )
  }

  if (mode === 'listen') {
    lines.push(
      'Mode listen: riconosci l’emozione con presenza calma; ascolta prima di risolvere; niente interviste.',
    )
  } else if (mode === 'react') {
    lines.push(
      'Mode react: reagisci a ciò che conta, poi sviluppa lo stesso filo (non ripartire, non interrogare).',
    )
  } else if (mode === 'shared_thread') {
    lines.push(
      'Mode shared_thread: continua il pensiero condiviso — osservazione o ragionamento che avanza il filo, non un reset.',
    )
  } else if (mode === 'substance') {
    lines.push(
      'Mode substance: servi la richiesta con presenza — chiarezza e sostanza, senza frasi da sportello né restart inutili.',
    )
  } else {
    lines.push(
      'Mode engage: presenza calda e viva; porta un’osservazione o un’idea — non un’intervista da helpdesk.',
    )
  }

  if (opts.preferReaction) {
    lines.push('Includi una reazione o un riconoscimento breve e genuino prima/durante la sostanza.')
  }
  if (opts.preferSharedThought) {
    lines.push('Collega esplicitamente al turno precedente: stesso filo, uno strato più avanti.')
  }
  if (opts.restartRisk) {
    lines.push('Rischio restart: non riassumere da capo né cambiare tema senza necessità.')
  }
  if (opts.interviewRisk) {
    lines.push(
      'Rischio intervista: evita domande facili di chiusura; chiedi solo se è davvero utile al filo.',
    )
  }

  return lines.join(' ')
}

/**
 * @param {object} [input]
 * @returns {ConversationalPresencePlan}
 */
export function analyzeConversationalPresence(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) return inactivePlan(['empty'])

  const classified = classifyPresence(input)
  const { mode, signals, restartRisk, interviewRisk, preferReaction, preferSharedThought, confidence } =
    classified

  return {
    active: true,
    mode,
    restartRisk,
    interviewRisk,
    preferReaction,
    preferSharedThought,
    confidence,
    writerBrief: buildBrief(mode, {
      restartRisk,
      interviewRisk,
      preferReaction,
      preferSharedThought,
    }),
    checklist: [...CHECKLIST],
    prefer: [...PREFER],
    avoid: [...AVOID],
    reasons: [
      `mode_${mode}`,
      confidence,
      restartRisk ? 'restart_risk' : 'restart_ok',
      interviewRisk ? 'interview_risk' : 'interview_ok',
      ...signals.slice(0, 3),
    ],
    signals: signals.slice(0, 8),
  }
}

/**
 * @param {ConversationalPresencePlan | null | undefined} plan
 */
export function formatConversationalPresenceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''

  return `══════════════════════════════════════
CONVERSATIONAL PRESENCE (INVISIBILE)
══════════════════════════════════════
Active=yes · Mode=${plan.mode} · Confidence=${plan.confidence}
RestartRisk=${plan.restartRisk ? 'yes' : 'no'} · InterviewRisk=${plan.interviewRisk ? 'yes' : 'no'}
PreferReaction=${plan.preferReaction ? 'yes' : 'no'} · PreferSharedThought=${plan.preferSharedThought ? 'yes' : 'no'}

${plan.writerBrief}

Obiettivo: presenza coinvolgente — non imitazione umana. Non citare il motore.`.trim()
}

/**
 * Soft smell check: generic assistant phrases or stacked interview closers.
 * @param {string} draft
 * @param {ConversationalPresencePlan | null | undefined} plan
 */
export function draftLacksConversationalPresence(draft, plan) {
  if (!plan?.active) return false
  const text = normalize(draft)
  if (!text) return false
  if (GENERIC_ASSISTANT.test(text.slice(0, 220))) return true
  if (plan.interviewRisk && (text.match(/\?/g) || []).length >= 2) return true
  if (plan.restartRisk && /\b(ripartiamo|let'?s\s+start\s+over|per\s+ricapitolare\s+da\s+zero|from\s+scratch)\b/i.test(text)) {
    return true
  }
  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationalPresencePlan, context: string }}
 */
export function runConversationalPresence(input = {}) {
  try {
    const plan = analyzeConversationalPresence(input)
    return {
      plan,
      context: formatConversationalPresenceForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
