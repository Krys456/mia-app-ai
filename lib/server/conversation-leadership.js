/**
 * LAIfe Conversation Leadership
 *
 * Runs AFTER Conversation Intent and BEFORE response planning.
 *
 * Mission: actively guide enjoyable conversations instead of waiting
 * for instructions. Behave like an intelligent conversation partner —
 * not a chatbot that asks permission every few messages.
 *
 * Decides whether the assistant should:
 *   - continue naturally
 *   - introduce a valuable insight
 *   - tell a short story
 *   - make an observation
 *   - connect previous ideas
 *   - share an analogy
 *   - add an unexpected fact
 *   - or simply remain concise / close warmly
 *
 * Core principles:
 *   Continue interesting conversations confidently.
 *   Prefer observations over questions.
 *   Prefer ideas over interviews.
 *   Prefer dialogue over interrogation.
 *   Questions only when they genuinely improve the conversation.
 *   Never ask a question just to keep the chat alive.
 *
 * Detects momentum and preserves it.
 * Avoids generic prompts, repetitive closings, helpdesk endings.
 *
 * Invisible. Fail-soft. Soft advisor — Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'continue_naturally'|'valuable_insight'|'short_story'|'observation'|'connect_ideas'|'analogy'|'unexpected_fact'|'remain_concise'|'close_warmly'|'choose_direction'} LeadershipMove
 */

/**
 * @typedef {object} ConversationLeadershipPlan
 * @property {boolean} active
 * @property {LeadershipMove} move
 * @property {boolean} hasMomentum
 * @property {boolean} preserveMomentum
 * @property {boolean} allowQuestion
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} planningHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const SHORT_OK =
  /^(ok|okay|k|va\s+bene|d['’]?accordo|capito|capisco|i\s+see|makes\s+sense|ah|oh|mm+|uhm+|s[iì]|yes|yep|yeah|perfetto|bene|got\s+it)([\s!,.]*)$/i

const ENTHUSIASM =
  /(che\s+figata|figata|interesting|cool|wow|awesome|amazing|interessante|figo|forte|bell[oa]|ottimo|fantastico|love\s+(this|that|it)|that'?s\s+(awesome|cool|amazing|great|interesting)|incredibile)/i

const UNSURE_DELEGATE =
  /^(non\s+so|boh|mah|i\s+don'?t\s+know|no\s+idea|whatever|qualsiasi(\s+cosa)?|scegli\s+tu|you\s+choose|dimmi\s+tu|suggest\s+something|suggerisci)([\s!.?]*)$/i

const THANKS_CLOSE =
  /^(grazie|thanks|thank\s+you|thx|ty|grazie\s+mille|thanks\s+a\s+lot)([\s!,.🥰🙏]*)$/i

const STOP_SIGNAL =
  /^(basta|stop|fine|bye|arrivederci|buonanotte|done|that'?s\s+(all|enough)|chiudiamo)([\s!,.]|$)/i

const INFO_HEAVY =
  /(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|fix|debug|spiegami|explain|codice|code|implement|calcola|errore|error|bug)/i

const DEEPEN_ASK =
  /(dimmi\s+di\s+pi[uù]|tell\s+me\s+more|approfond|perch[eé]|why|come\s+mai|esempio|example)/i

const HELP_DESK_FORBIDDEN =
  'Vietato: “Let me know…”, “If you want…”, “Feel free to ask…”, “Hai altre domande?”, chiusure da chatbot, domande solo per tenere vivo il filo.'

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
  return [...turns].reverse().find((t) => t.role === 'assistant')?.content || ''
}

/**
 * Momentum: recent substantive exchange still open.
 * @param {object} args
 */
function detectMomentum(args) {
  const {
    turns,
    intent,
    userMessage,
  } = args
  const assistantTurns = turns.filter((t) => t.role === 'assistant').length
  if (assistantTurns === 0) return { hasMomentum: false, reasons: ['no_history'] }

  const lastA = lastAssistant(turns)
  const shortUser = userMessage.length <= 48
  const openness = intent?.opennessToContinue || 'open'
  const engagement = intent?.engagementLevel || 'medium'
  const expects = intent?.expects || 'mixed'
  const conv = intent?.conversationalIntent || 'continue_thread'

  /** @type {string[]} */
  const reasons = []
  let score = 0

  if (lastA.length > 120) {
    score += 1.2
    reasons.push('rich_prior')
  }
  if (openness === 'eager' || openness === 'open') {
    score += 1.4
    reasons.push(`open_${openness}`)
  }
  if (engagement === 'high' || ENTHUSIASM.test(userMessage)) {
    score += 1.3
    reasons.push('engaged')
  }
  if (
    conv === 'continue_thread' ||
    conv === 'deepen' ||
    conv === 'acknowledge' ||
    SHORT_OK.test(userMessage)
  ) {
    score += 1.1
    reasons.push('thread_alive')
  }
  if (expects === 'exploration' || expects === 'companionship') {
    score += 0.8
    reasons.push(`expects_${expects}`)
  }
  if (shortUser && !STOP_SIGNAL.test(userMessage) && !THANKS_CLOSE.test(userMessage)) {
    score += 0.6
    reasons.push('short_continue_cue')
  }
  if (openness === 'closed' || STOP_SIGNAL.test(userMessage)) {
    score -= 2
    reasons.push('closing')
  }
  if (intent?.emotionalIntent === 'venting' || intent?.emotionalIntent === 'anxious_reassurance') {
    score -= 0.5
    reasons.push('care_first')
  }

  const hasMomentum = score >= 2.2
  return { hasMomentum, score, reasons: reasons.slice(0, 6) }
}

/**
 * @param {LeadershipMove} move
 */
function moveLabel(move) {
  switch (move) {
    case 'continue_naturally':
      return 'continua naturalmente lo stesso filo'
    case 'valuable_insight':
      return 'porta UN insight di valore'
    case 'short_story':
      return 'racconta una mini-storia / scenario breve'
    case 'observation':
      return 'fai un’osservazione concreta'
    case 'connect_ideas':
      return 'collega idee già emerse'
    case 'analogy':
      return 'condividi un’analogia chiara'
    case 'unexpected_fact':
      return 'aggiungi un fatto inatteso utile'
    case 'remain_concise':
      return 'resta conciso e preciso'
    case 'close_warmly':
      return 'chiudi con calore; un pensiero memorabile se calza — zero domande'
    case 'choose_direction':
      return 'scegli UNA direzione interessante e sviluppala — non chiedere cosa vuole'
    default:
      return 'guida la conversazione con una mossa chiara'
  }
}

/**
 * Pick leadership move from Intent + momentum + surface cues.
 * @param {object} args
 * @returns {{ move: LeadershipMove, allowQuestion: boolean, preserveMomentum: boolean, confidence: 'high'|'medium'|'low', signals: string[] }}
 */
function pickMove(args) {
  const { userMessage, intent, hasMomentum, topicLeadership } = args
  /** @type {string[]} */
  const signals = []
  const emo = intent?.emotionalIntent || 'neutral'
  const conv = intent?.conversationalIntent || 'continue_thread'
  const expects = intent?.expects || 'mixed'
  const openness = intent?.opennessToContinue || 'open'
  const curiosity = intent?.curiosityLevel || 'medium'

  // Hard stops / thanks
  if (STOP_SIGNAL.test(userMessage) || (THANKS_CLOSE.test(userMessage) && openness === 'closed')) {
    signals.push('close')
    return {
      move: 'close_warmly',
      allowQuestion: false,
      preserveMomentum: false,
      confidence: 'high',
      signals,
    }
  }

  if (THANKS_CLOSE.test(userMessage)) {
    signals.push('thanks')
    // Soft open thanks: memorable thought, not a question
    return {
      move: hasMomentum ? 'valuable_insight' : 'close_warmly',
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: 'high',
      signals,
    }
  }

  // Care-first: concise presence, no clever leadership theater
  if (emo === 'venting' || emo === 'anxious_reassurance') {
    signals.push('care')
    return {
      move: 'observation',
      allowQuestion: false,
      preserveMomentum: false,
      confidence: 'high',
      signals,
    }
  }

  // Explicit / soft delegation
  if (
    UNSURE_DELEGATE.test(userMessage) ||
    topicLeadership?.shouldLead ||
    conv === 'invite_presence' && /non\s+so|scegli|suggest/i.test(userMessage)
  ) {
    signals.push('lead_direction')
    return {
      move: 'choose_direction',
      allowQuestion: false,
      preserveMomentum: true,
      confidence: 'high',
      signals,
    }
  }

  // Enthusiasm → expand the fascinating angle
  if (ENTHUSIASM.test(userMessage) || emo === 'curious_wonder' || emo === 'celebrating') {
    signals.push('expand_fascination')
    const expandMoves = /** @type {LeadershipMove[]} */ ([
      'valuable_insight',
      'unexpected_fact',
      'observation',
      'short_story',
    ])
    const idx = Math.abs(userMessage.length + (hasMomentum ? 1 : 0)) % expandMoves.length
    return {
      move: expandMoves[idx],
      allowQuestion: false,
      preserveMomentum: true,
      confidence: 'high',
      signals,
    }
  }

  // Short "Ok." with momentum → continue / deepen with value
  if (SHORT_OK.test(userMessage) || (conv === 'acknowledge' && hasMomentum)) {
    signals.push('ok_continue')
    return {
      move: hasMomentum ? (curiosity === 'high' ? 'valuable_insight' : 'continue_naturally') : 'remain_concise',
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: 'high',
      signals,
    }
  }

  // Deepen ask
  if (DEEPEN_ASK.test(userMessage) || conv === 'deepen') {
    signals.push('deepen')
    return {
      move: expects === 'exploration' ? 'connect_ideas' : 'valuable_insight',
      allowQuestion: false,
      preserveMomentum: true,
      confidence: 'high',
      signals,
    }
  }

  // Heavy info / how-to → concise substance first
  if (INFO_HEAVY.test(userMessage) || expects === 'information' || conv === 'request_help') {
    signals.push('substance')
    return {
      move: 'remain_concise',
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: 'medium',
      signals,
    }
  }

  // Companionship / presence
  if (expects === 'companionship' || expects === 'presence' || conv === 'invite_presence' || conv === 'share') {
    signals.push('companion')
    return {
      move: conv === 'share' ? 'observation' : hasMomentum ? 'short_story' : 'observation',
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: 'high',
      signals,
    }
  }

  // Exploration default
  if (expects === 'exploration' || hasMomentum) {
    signals.push('explore')
    const moves = /** @type {LeadershipMove[]} */ ([
      'continue_naturally',
      'valuable_insight',
      'analogy',
      'connect_ideas',
      'unexpected_fact',
    ])
    const idx = (userMessage.length + curiosity.length) % moves.length
    return {
      move: moves[idx],
      allowQuestion: false,
      preserveMomentum: true,
      confidence: 'medium',
      signals,
    }
  }

  // Greeting / start
  if (conv === 'start_thread') {
    signals.push('start')
    return {
      move: 'observation',
      allowQuestion: false,
      preserveMomentum: false,
      confidence: 'medium',
      signals,
    }
  }

  signals.push('default_continue')
  return {
    move: hasMomentum ? 'continue_naturally' : 'remain_concise',
    allowQuestion: false,
    preserveMomentum: hasMomentum,
    confidence: 'medium',
    signals,
  }
}

/**
 * @param {LeadershipMove} move
 * @param {object} ctx
 */
function buildBrief(move, ctx) {
  const { intent, hasMomentum, preserveMomentum, allowQuestion } = ctx
  const why = intent?.whySummary || ''
  return [
    'CONVERSATION LEADERSHIP (dopo Intent, prima del piano): guida attivamente la conversazione — non attendere istruzioni.',
    why ? `Intent upstream: ${why}` : 'Parti dall’intenzione già inferita.',
    `Mossa di leadership: ${moveLabel(move)} (${move}).`,
    hasMomentum
      ? preserveMomentum
        ? 'Momentum rilevato: preservalo. Non interrompere con prompt generici.'
        : 'C’era momentum, ma il turno chiede chiusura o cura — non forzare.'
      : 'Poco momentum: una mossa chiara e di valore, senza interrogare.',
    'Principi: osservazioni > domande · idee > interviste · dialogo > interrogatorio.',
    allowQuestion
      ? 'Una domanda solo se migliora davvero il dialogo.'
      : 'Nessuna domanda in questo turno (salvo chiarimento davvero bloccante).',
    'Mai chiedere permesso (“Vuoi che…?”, “Se vuoi posso…”). Mai domande solo per tenere vivo il chat.',
    HELP_DESK_FORBIDDEN,
    'Target: l’utente si sente guidato, ispirato, intellettualmente coinvolto.',
    'NON citare Conversation Leadership / lo stage.',
  ].join(' ')
}

/**
 * @param {LeadershipMove} move
 * @param {boolean} hasMomentum
 */
function structureLineFor(move, hasMomentum) {
  const base = `Conversation Leadership → ${moveLabel(move)}`
  return hasMomentum ? `${base} · preserva momentum` : base
}

/**
 * @param {ConversationLeadershipPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationLeadershipStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const lines = [
    plan.structureLine || 'Conversation Leadership → guida con una mossa chiara',
    'Partner intelligente: guida, non attendere ticket',
    'Osservazioni/idee prima di qualsiasi domanda',
  ]
  if (plan.preserveMomentum) {
    lines.push('Preserva il momentum — niente prompt generici che lo spezzano')
  }
  if (plan.move === 'choose_direction') {
    lines.push('Scegli UNA direzione e sviluppala — niente “di cosa vuoi parlare?”')
  }
  if (plan.move === 'close_warmly') {
    lines.push('Chiusura calda; eventuale pensiero memorabile; zero domande')
  }
  if (!plan.allowQuestion) {
    lines.push('Niente domande di routine / intervista')
  }
  lines.push(HELP_DESK_FORBIDDEN)
  return lines
}

/**
 * @param {object} [input]
 * @returns {ConversationLeadershipPlan}
 */
export function buildConversationLeadershipPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const intentPlan = input.conversationIntent?.plan || input.conversationIntent || null
  const intent = intentPlan?.inference || input.intent || null
  const topicLeadership = input.topicLeadership?.plan || input.topicLeadership || null

  if (!userMessage) {
    return {
      active: false,
      move: 'remain_concise',
      hasMomentum: false,
      preserveMomentum: false,
      allowQuestion: false,
      confidence: 'low',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      planningHints: [],
      reasons: ['empty'],
      signals: ['empty'],
    }
  }

  const momentum = detectMomentum({ turns, intent, userMessage })
  const picked = pickMove({
    userMessage,
    intent,
    hasMomentum: momentum.hasMomentum,
    topicLeadership,
  })

  const writerBrief = buildBrief(picked.move, {
    intent,
    hasMomentum: momentum.hasMomentum,
    preserveMomentum: picked.preserveMomentum,
    allowQuestion: picked.allowQuestion,
  })

  const planningHints = [
    `Conversation Leadership move=${picked.move}`,
    moveLabel(picked.move),
    momentum.hasMomentum ? 'Preserva momentum conversazionale.' : 'Mossa secca di valore.',
    picked.allowQuestion ? 'Domanda solo se necessaria.' : 'Niente domande di routine.',
    'Non chiedere permesso. Non fare intervista.',
  ]

  const responseHints = [
    `Esegui la mossa: ${moveLabel(picked.move)}.`,
    'Continua con fiducia se c’è valore — non chiedere se procedere.',
    'Osservazione o idea prima di qualsiasi domanda.',
    HELP_DESK_FORBIDDEN,
  ]

  return {
    active: true,
    move: picked.move,
    hasMomentum: momentum.hasMomentum,
    preserveMomentum: picked.preserveMomentum,
    allowQuestion: picked.allowQuestion,
    confidence: picked.confidence,
    writerBrief,
    structureLine: structureLineFor(picked.move, momentum.hasMomentum),
    responseHints,
    planningHints,
    reasons: [
      `move_${picked.move}`,
      momentum.hasMomentum ? 'momentum' : 'no_momentum',
      `conf_${picked.confidence}`,
      ...(momentum.reasons || []).slice(0, 3),
      ...picked.signals.slice(0, 3),
    ],
    signals: [...picked.signals, ...(momentum.reasons || [])].slice(0, 8),
  }
}

/**
 * @param {ConversationLeadershipPlan | null | undefined} plan
 */
export function formatConversationLeadershipForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')

  return `══════════════════════════════════════
CONVERSATION LEADERSHIP (PRE-PLAN, INVISIBILE)
══════════════════════════════════════
Move=${plan.move} · Momentum=${plan.hasMomentum ? 'yes' : 'no'} · Preserve=${plan.preserveMomentum ? 'yes' : 'no'}
AllowQuestion=${plan.allowQuestion ? 'yes' : 'no'} · Confidence=${plan.confidence}

${plan.writerBrief}

Hints:
${hints}

Regole: guida · osservazioni > domande · idee > interviste · niente helpdesk · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationLeadershipPlan, context: string }}
 */
export function runConversationLeadership(input = {}) {
  try {
    const plan = buildConversationLeadershipPlan(input)
    return {
      plan,
      context: formatConversationLeadershipForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        move: 'remain_concise',
        hasMomentum: false,
        preserveMomentum: false,
        allowQuestion: false,
        confidence: 'low',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        planningHints: [],
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
      },
      context: '',
    }
  }
}
