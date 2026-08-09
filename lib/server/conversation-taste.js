/**
 * LAIfe Conversation Taste
 *
 * Runs AFTER Wisdom and BEFORE the Writer.
 *
 * Mission: teach the assistant to recognize beautiful conversations.
 * Before finalizing a response, evaluate:
 *   - Is this interesting?
 *   - Is it elegant?
 *   - Is it repetitive?
 *   - Is it memorable?
 *   - Does it sound alive?
 *   - Does it sound written by a thoughtful person?
 *
 * Avoid: repetitive sentence openings, acknowledgements, questions, endings.
 * Prefer: rhythm, variety, elegant transitions, natural pauses, memorable phrasing.
 *
 * Objective: reading the conversation feels enjoyable — not merely informative.
 *
 * Keep reasoning internal. Never invent facts.
 * Invisible. Fail-soft. Soft advisor — Coordinator applies before Writer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'alive_elegant'|'vary_hard'|'quiet_memorable'|'rhythmic_clear'|'refresh_voice'} TasteStance
 */

/**
 * @typedef {object} TasteChecks
 * @property {boolean} interesting
 * @property {boolean} elegant
 * @property {boolean} repetitive
 * @property {boolean} memorable
 * @property {boolean} alive
 * @property {boolean} thoughtful
 * @property {boolean} enjoyableToRead
 */

/**
 * @typedef {object} TasteRisks
 * @property {boolean} repetitiveOpenings
 * @property {boolean} repetitiveAcknowledgements
 * @property {boolean} repetitiveQuestions
 * @property {boolean} repetitiveEndings
 * @property {string[]} recentOpenings
 * @property {string[]} recentEndings
 */

/**
 * @typedef {object} ConversationTastePlan
 * @property {boolean} active
 * @property {TasteStance} stance
 * @property {TasteChecks} checks
 * @property {TasteRisks} risks
 * @property {string[]} avoid
 * @property {string[]} prefer
 * @property {string} tasteQuestion
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const ACK_OPEN =
  /^(certo|ecco|capisco|assolutamente|ottima\s+domanda|great\s+question|of\s+course|absolutely|sure[!.,]|i\s+understand|got\s+it|fair\s+enough|buona\s+domanda)[.!]?\s*/i

const GENERIC_END =
  /(fammi\s+sapere|let\s+me\s+know|se\s+vuoi|if\s+you\s+(want|like|need)|feel\s+free|sono\s+qui|i'?m\s+here|any\s+questions|hai\s+domande|what\s+do\s+you\s+think\??\s*$|cosa\s+ne\s+pensi\??\s*$)/i

const AVOID_LIST = [
  'aperture di frase ripetitive',
  'acknowledgement ripetitivi (“Certo.”, “Ottima domanda.”, “Capisco.”)',
  'domande ripetitive / da intervista',
  'chiusure ripetitive (“Fammi sapere…”, “Cosa ne pensi?”)',
]

const PREFER_LIST = [
  'ritmo (frasi corte e lunghe alternate)',
  'varietà di aperture e chiusure',
  'transizioni eleganti',
  'pause naturali',
  'phrasing memorabile',
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
 * First few words as opening fingerprint.
 * @param {string} content
 */
function openingFingerprint(content) {
  const c = normalize(content).replace(ACK_OPEN, '').trim()
  const words = c.split(/\s+/).slice(0, 4).join(' ').toLowerCase()
  return words.slice(0, 48)
}

/**
 * Last sentence / ending fingerprint.
 * @param {string} content
 */
function endingFingerprint(content) {
  const c = normalize(content)
  const parts = c.split(/(?<=[.!?])\s+/).filter(Boolean)
  const last = parts[parts.length - 1] || c
  return last.slice(0, 80).toLowerCase()
}

/**
 * @param {string[]} items
 */
function hasRepetition(items) {
  if (items.length < 2) return false
  const recent = items.slice(-4)
  const counts = new Map()
  for (const x of recent) {
    const key = x.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
    if (key.length < 6) continue
    counts.set(key, (counts.get(key) || 0) + 1)
    if ((counts.get(key) || 0) >= 2) return true
  }
  // Same first word twice in a row
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1].split(/\s+/)[0]
    const b = recent[i].split(/\s+/)[0]
    if (a && b && a === b && a.length > 2) return true
  }
  return false
}

/**
 * Analyze prior assistant turns for taste risks.
 * @param {ChatTurn[]} turns
 * @returns {TasteRisks}
 */
function analyzeRisks(turns) {
  const assistant = turns.filter((t) => t.role === 'assistant').slice(-5)
  const openings = assistant.map((t) => openingFingerprint(t.content))
  const endings = assistant.map((t) => endingFingerprint(t.content))
  const ackCount = assistant.filter((t) => ACK_OPEN.test(t.content)).length
  const qEnds = assistant.filter((t) => /\?\s*$/.test(t.content) || GENERIC_END.test(t.content)).length

  return {
    repetitiveOpenings: hasRepetition(openings),
    repetitiveAcknowledgements: ackCount >= 2,
    repetitiveQuestions: qEnds >= 3 || (assistant.length >= 2 && qEnds >= 2),
    repetitiveEndings: hasRepetition(endings) || (assistant.length >= 2 && endings.filter((e) => GENERIC_END.test(e)).length >= 2),
    recentOpenings: openings.slice(-3),
    recentEndings: endings.slice(-3),
  }
}

/**
 * @param {TasteStance} stance
 */
function stanceLabel(stance) {
  switch (stance) {
    case 'alive_elegant':
      return 'vivo ed elegante'
    case 'vary_hard':
      return 'rompi i pattern ripetuti'
    case 'quiet_memorable':
      return 'quieto ma memorabile'
    case 'rhythmic_clear':
      return 'ritmo chiaro, phrasing vivo'
    case 'refresh_voice':
      return 'rinnova la voce — niente template'
    default:
      return String(stance)
  }
}

/**
 * @param {object} args
 */
function evaluateTaste(args) {
  const { risks, presence, wisdom, deepThinking, userMessage } = args
  const text = normalize(userMessage)
  const anyRep =
    risks.repetitiveOpenings ||
    risks.repetitiveAcknowledgements ||
    risks.repetitiveQuestions ||
    risks.repetitiveEndings

  /** @type {string[]} */
  const reasons = []
  if (risks.repetitiveOpenings) reasons.push('rep_openings')
  if (risks.repetitiveAcknowledgements) reasons.push('rep_acks')
  if (risks.repetitiveQuestions) reasons.push('rep_questions')
  if (risks.repetitiveEndings) reasons.push('rep_endings')

  /** @type {TasteChecks} */
  const checks = {
    interesting: true,
    elegant: !anyRep,
    repetitive: anyRep,
    memorable: wisdom?.stance === 'practical_insight' || wisdom?.stance === 'calm_principle' || presence?.memorableClose,
    alive: presence?.need !== 'brevity' || Boolean(presence?.shareEnthusiasm),
    thoughtful: true,
    enjoyableToRead: !anyRep,
  }

  // Soft nudges from upstream
  if (presence?.preferBrevity || wisdom?.stance === 'hold_back') {
    checks.memorable = true
    checks.alive = true
    reasons.push('quiet_can_be_beautiful')
  }
  if (deepThinking?.direction === 'memorable_example' || deepThinking?.direction === 'concise_story') {
    checks.memorable = true
    reasons.push('dt_memorable')
  }

  /** @type {TasteStance} */
  let stance = 'alive_elegant'
  if (anyRep) {
    stance = risks.repetitiveOpenings && risks.repetitiveEndings ? 'refresh_voice' : 'vary_hard'
    reasons.push('break_patterns')
  } else if (presence?.preferBrevity || wisdom?.stance === 'hold_back' || /^(ok|grazie|thanks)/i.test(text)) {
    stance = 'quiet_memorable'
  } else if (wisdom?.checks?.preferSimpler || wisdom?.stance === 'mentor_simple') {
    stance = 'rhythmic_clear'
  } else {
    stance = 'alive_elegant'
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = anyRep ? 'high' : 'medium'
  if (presence?.need || wisdom?.stance) confidence = 'high'

  return { checks, stance, reasons, confidence }
}

/**
 * @param {object} bits
 */
function buildBrief(bits) {
  const { stance, checks, risks, presence, wisdom, deepThinking } = bits
  const bannedOpenings =
    risks.recentOpenings?.length > 0
      ? `Non riaprire come di recente: ${risks.recentOpenings.map((o) => `«${o}»`).join(' · ')}.`
      : 'Varia l’apertura — niente “Certo.” / “Ottima domanda.” / “Capisco.” di default.'
  const bannedEndings =
    risks.recentEndings?.length > 0
      ? `Non chiudere come di recente: evita echo di «${risks.recentEndings[risks.recentEndings.length - 1]}».`
      : 'Varia la chiusura — niente “Fammi sapere…” / “Cosa ne pensi?” di routine.'

  return [
    'CONVERSATION TASTE (dopo Wisdom, prima del Writer): riconosci le belle conversazioni.',
    'Obiettivo: leggere la chat deve essere piacevole — non solo informativo.',
    `Stance: ${stanceLabel(stance)} (${stance}).`,
    `Check: interesting=${checks.interesting ? 'yes' : 'refine'} · elegant=${checks.elegant ? 'yes' : 'refine'} · repetitive=${checks.repetitive ? 'YES—break' : 'no'} · memorable=${checks.memorable ? 'aim' : 'lift'} · alive=${checks.alive ? 'yes' : 'lift'} · thoughtful=${checks.thoughtful ? 'yes' : 'refine'}.`,
    checks.enjoyableToRead
      ? 'Taste OK se resti vivo ed elegante.'
      : 'Taste a rischio: spezza i pattern prima di finalizzare.',
    risks.repetitiveOpenings ? 'Rischio aperture ripetitive.' : '',
    risks.repetitiveAcknowledgements ? 'Rischio acknowledgement ripetitivi.' : '',
    risks.repetitiveQuestions ? 'Rischio domande ripetitive — preferisci osservazione/ritmo.' : '',
    risks.repetitiveEndings ? 'Rischio chiusure ripetitive.' : '',
    bannedOpenings,
    bannedEndings,
    'Preferisci: ritmo, varietà, transizioni eleganti, pause naturali, phrasing memorabile.',
    'Ask interno: Is this interesting? Elegant? Alive? Written by a thoughtful person? Enjoyable to read?',
    presence?.style ? `Cooperazione Presence style=${presence.style} ending=${presence.ending || ''}.` : '',
    wisdom?.stance ? `Cooperazione Wisdom stance=${wisdom.stance}.` : '',
    deepThinking?.direction ? `Cooperazione Deep Thinking=${deepThinking.direction}.` : '',
    'Non inventare fatti. Non citare lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {ConversationTastePlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationTasteStructureHints(plan) {
  if (!plan?.active) return []
  return [
    `Conversation Taste → ${stanceLabel(plan.stance)}`,
    plan.checks?.repetitive
      ? 'Spezza pattern: aperture / ack / domande / chiusure ripetitive'
      : 'Mantieni varietà di ritmo e phrasing',
    'Piacevole da leggere — non solo informativo',
    'Ritmo · varietà · transizioni eleganti · pause · frase memorabile',
    'Ask: interesting? elegant? alive? thoughtful?',
  ]
}

/**
 * @param {object} [input]
 * @returns {ConversationTastePlan}
 */
export function buildConversationTastePlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const presence = input.presence?.plan || input.presence || null
  const wisdom = input.wisdom?.plan || input.wisdom || null
  const deepThinking = input.deepThinking?.plan || input.deepThinking || null

  if (!userMessage) {
    return {
      active: false,
      stance: 'quiet_memorable',
      checks: {
        interesting: false,
        elegant: true,
        repetitive: false,
        memorable: false,
        alive: false,
        thoughtful: true,
        enjoyableToRead: true,
      },
      risks: {
        repetitiveOpenings: false,
        repetitiveAcknowledgements: false,
        repetitiveQuestions: false,
        repetitiveEndings: false,
        recentOpenings: [],
        recentEndings: [],
      },
      avoid: AVOID_LIST,
      prefer: PREFER_LIST,
      tasteQuestion: '',
      confidence: 'low',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
    }
  }

  const risks = analyzeRisks(turns)
  const evaluated = evaluateTaste({
    risks,
    presence,
    wisdom,
    deepThinking,
    userMessage,
  })

  const writerBrief = buildBrief({
    stance: evaluated.stance,
    checks: evaluated.checks,
    risks,
    presence,
    wisdom,
    deepThinking,
  })

  return {
    active: true,
    stance: evaluated.stance,
    checks: evaluated.checks,
    risks,
    avoid: AVOID_LIST,
    prefer: PREFER_LIST,
    tasteQuestion:
      'Is this interesting, elegant, alive, and enjoyable to read — written by a thoughtful person?',
    confidence: evaluated.confidence,
    writerBrief,
    structureLine: `Conversation Taste → ${stanceLabel(evaluated.stance)}`,
    responseHints: [
      `Stance: ${stanceLabel(evaluated.stance)}.`,
      evaluated.checks.repetitive
        ? 'Spezza aperture/ack/domande/chiusure ripetitive.'
        : 'Mantieni varietà e ritmo.',
      'Piacevole da leggere > solo informativo.',
      'Transizioni eleganti · pause naturali · phrasing memorabile.',
      'Check: interesting? elegant? alive? thoughtful?',
    ],
    reasons: [
      `stance_${evaluated.stance}`,
      evaluated.checks.repetitive ? 'repetitive' : 'fresh',
      ...evaluated.reasons.slice(0, 4),
      turns.filter((t) => t.role === 'assistant').length > 1 ? 'has_asst_history' : 'fresh_asst',
    ],
    signals: [
      evaluated.stance,
      evaluated.checks.repetitive ? 'rep_risk' : 'clean',
      risks.repetitiveOpenings ? 'open_rep' : 'open_ok',
      risks.repetitiveEndings ? 'end_rep' : 'end_ok',
      risks.repetitiveQuestions ? 'q_rep' : 'q_ok',
    ].slice(0, 8),
  }
}

/**
 * @param {ConversationTastePlan | null | undefined} plan
 */
export function formatConversationTasteForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const c = plan.checks || {}
  const r = plan.risks || {}
  return `══════════════════════════════════════
CONVERSATION TASTE (DOPO WISDOM, PRE-WRITER)
══════════════════════════════════════
Stance=${plan.stance} · Confidence=${plan.confidence}
Interesting=${c.interesting ? 'y' : 'n'} · Elegant=${c.elegant ? 'y' : 'n'} · Repetitive=${c.repetitive ? 'Y' : 'n'} · Memorable=${c.memorable ? 'y' : 'n'} · Alive=${c.alive ? 'y' : 'n'} · Thoughtful=${c.thoughtful ? 'y' : 'n'}
Risks: openings=${r.repetitiveOpenings ? 'yes' : 'no'} · acks=${r.repetitiveAcknowledgements ? 'yes' : 'no'} · questions=${r.repetitiveQuestions ? 'yes' : 'no'} · endings=${r.repetitiveEndings ? 'yes' : 'no'}

${plan.writerBrief}

Ask: ${plan.tasteQuestion}

Hints:
${hints}

Regole: piacevole da leggere > solo informativo · varietà · ritmo · non inventare · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationTastePlan, context: string }}
 */
export function runConversationTaste(input = {}) {
  try {
    const plan = buildConversationTastePlan(input)
    return {
      plan,
      context: formatConversationTasteForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        stance: 'alive_elegant',
        checks: {
          interesting: true,
          elegant: true,
          repetitive: false,
          memorable: true,
          alive: true,
          thoughtful: true,
          enjoyableToRead: true,
        },
        risks: {
          repetitiveOpenings: false,
          repetitiveAcknowledgements: false,
          repetitiveQuestions: false,
          repetitiveEndings: false,
          recentOpenings: [],
          recentEndings: [],
        },
        avoid: AVOID_LIST,
        prefer: PREFER_LIST,
        tasteQuestion: '',
        confidence: 'low',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
      },
      context: '',
    }
  }
}
