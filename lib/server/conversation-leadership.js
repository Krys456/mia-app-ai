/**
 * LAIfe Conversation Leadership Engine
 *
 * Mission: a great partner does not constantly ask questions —
 * a great partner knows when to lead.
 *
 * If LAIfe introduces a topic, LAIfe is responsible for making it interesting.
 * Never immediately give that responsibility back to the user.
 *
 * Core: carry the conversation — do not outsource it.
 *
 * Ownership: track who introduced the current topic (user | assistant | shared).
 * If assistant owns → develop before inviting.
 *
 * Build-first when introducing:
 *   1 Introduce → 2 Expand → 3 Connect to real life → 4 Invite only if appropriate.
 *
 * Question budget · short replies = permission to continue · silence = “you lead”.
 * Leading ≠ dominating — leave openings; never interview.
 *
 * Self-check: Am I making the user do the work? If yes → rewrite.
 *
 * Runs AFTER Conversation Intent / Social Context, BEFORE planning / Writer.
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Post-writer gate rejects premature “What do you think?” / interview endings.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'continue_naturally'|'valuable_insight'|'short_story'|'observation'|'connect_ideas'|'analogy'|'unexpected_fact'|'remain_concise'|'close_warmly'|'choose_direction'|'build_expand'|'build_connect'|'hold_silence_open'} LeadershipMove
 */

/**
 * @typedef {'user'|'assistant'|'shared'} TopicOwner
 */

/**
 * @typedef {'introduce'|'expand'|'connect'|'invite'|'hold'} BuildPhase
 */

/**
 * @typedef {'curiosity'|'connection'|'understanding'|'emotion'|'wonder'|'humour'} MomentumDimension
 */

/**
 * @typedef {object} LeadershipOwnership
 * @property {TopicOwner} owner
 * @property {string | null} topicHint
 * @property {number} assistantDepth  how many assistant turns already developed this thread
 * @property {boolean} mustDevelopFirst
 * @property {boolean} forbidPrematureInvite
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
 * @property {LeadershipOwnership} ownership
 * @property {BuildPhase} buildPhase
 * @property {MomentumDimension[]} liftTargets
 * @property {boolean} silenceLead
 * @property {boolean} shortReplyContinue
 * @property {number} questionBudget  0–1 remaining for this turn
 * @property {string} selfCheck
 * @property {string} northStar
 * @property {string} validationCheck
 */

/**
 * @typedef {object} ConversationLeadershipGate
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {object} scores
 * @property {string[]} failed
 * @property {string[]} reasons
 */

export const LEADERSHIP_NORTH_STAR =
  'I can relax — LAIfe will keep the conversation alive.'

export const LEADERSHIP_CHECKS = Object.freeze([
  'Am I making the user do the work?',
  'If I introduced this topic, did I develop it before inviting?',
  'Did I spend a question carelessly / end with an interview cue?',
  'Would a short “Certo.” feel like permission to continue — and did I continue?',
])

export const LEADERSHIP_THRESHOLDS = Object.freeze({
  continuationMin: 55,
  questionMax: 35,
  ownershipMin: 52,
  engagementMin: 50,
  overallMin: 55,
})

const SHORT_OK =
  /^(ok|okay|k|va\s+bene|d['’]?accordo|capito|capisco|i\s+see|makes\s+sense|ah|oh|mm+|uhm+|s[iì]|yes|yep|yeah|yup|no|nah|certo|già|esatto|interesting|interessante|maybe|forse|perfetto|bene|got\s+it)([\s!,.]*)$/i

const BRIEF_CONTINUE =
  /^(certo|già|esatto|yes|yeah|yep|no|nah|ok|okay|interesting|interessante|maybe|forse|s[iì]|gi[aà])([\s!,.]*)$/i

const ENTHUSIASM =
  /(che\s+figata|figata|interesting|cool|wow|awesome|amazing|interessante|figo|forte|bell[oa]|ottimo|fantastico|love\s+(this|that|it)|that'?s\s+(awesome|cool|amazing|great|interesting)|incredibile)/i

const UNSURE_DELEGATE =
  /^(non\s+so|boh|mah|i\s+don'?t\s+know|no\s+idea|whatever|qualsiasi(\s+cosa)?|scegli\s+tu|you\s+choose|dimmi\s+tu|suggest\s+something|suggerisci|as\s+you\s+wish|come\s+vuoi|not\s+really|non\s+proprio|maybe)([\s!.?]*)$/i

const SILENCE_LEAD =
  /^(i\s+don'?t\s+know|non\s+so|no\s+idea|maybe|forse|not\s+really|non\s+proprio|as\s+you\s+wish|come\s+vuoi|boh|mah|whatever|idk|dunno)([\s!.?]*)$/i

const THANKS_CLOSE =
  /^(grazie|thanks|thank\s+you|thx|ty|grazie\s+mille|thanks\s+a\s+lot)([\s!,.🥰🙏]*)$/i

const STOP_SIGNAL =
  /^(basta|stop|fine|bye|arrivederci|buonanotte|done|that'?s\s+(all|enough)|chiudiamo)([\s!,.]|$)/i

const INFO_HEAVY =
  /(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|fix|debug|spiegami|explain|codice|code|implement|calcola|errore|error|bug)/i

const DEEPEN_ASK =
  /(dimmi\s+di\s+pi[uù]|tell\s+me\s+more|approfond|perch[eé]|why|come\s+mai|esempio|example)/i

const PREMATURE_INVITE =
  /\b(what\s+do\s+you\s+think\??|do\s+you\s+have\s+(an\s+)?example\??|has\s+this\s+happened\s+to\s+you\??|what\s+comes\s+to\s+mind\??|cosa\s+ne\s+pensi\??|hai\s+un\s+esempio\??|ti\s+[eè]\s+successo\??|cosa\s+ti\s+viene\s+in\s+mente\??|what\s+about\s+you\??|e\s+tu\??)\b/i

const OUTSOURCE_Q =
  /\b(what\s+do\s+you\s+think|would\s+you\s+like\s+to\s+(discuss|share|talk)|do\s+you\s+have\s+(any\s+)?(thoughts|examples|ideas)|tell\s+me\s+(more\s+)?about\s+your|cosa\s+ne\s+pensi|vuoi\s+(parlarne|condividere)|hai\s+(pensieri|esempi|idee))\b/i

const HELP_DESK_FORBIDDEN =
  'Vietato: “Let me know…”, “If you want…”, “Feel free to ask…”, “Hai altre domande?”, chiusure da chatbot, domande solo per tenere vivo il filo.'

const BUILD_FORBIDDEN_EARLY =
  'Se HAI introdotto tu il tema: NON chiedere subito “What do you think?” / “Do you have an example?” / “Has this happened to you?” / “What comes to mind?” — prima sviluppa.'

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
 * @param {ChatTurn[]} turns
 */
function lastUser(turns) {
  return [...turns].reverse().find((t) => t.role === 'user')?.content || ''
}

/**
 * Infer who owns the current topic from recent turns.
 * @param {ChatTurn[]} turns
 * @param {string} userMessage
 * @returns {LeadershipOwnership}
 */
export function inferTopicOwnership(turns, userMessage = '') {
  const recent = turns.slice(-8)
  const lastA = lastAssistant(recent)
  const lastU = lastUser(recent.filter((t) => t.content !== userMessage)) || ''

  let assistantDepth = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === 'assistant') assistantDepth += 1
    else if (recent[i].role === 'user' && recent[i].content.length > 60) break
  }

  const assistantIntroduced =
    lastA.length > 80 &&
    !/\?\s*$/.test(lastA) &&
    (assistantDepth >= 1 ||
      /\b(i'?ve\s+been\s+thinking|sto\s+pensando|interesting\s+(thing|idea)|c'?[eè]\s+una\s+cosa|here'?s\s+(something|a\s+thought))\b/i.test(
        lastA,
      ))

  const userIntroduced =
    (lastU.length > 40 && !BRIEF_CONTINUE.test(lastU) && !SILENCE_LEAD.test(lastU)) ||
    (userMessage.length > 50 && !BRIEF_CONTINUE.test(userMessage) && !SILENCE_LEAD.test(userMessage))

  /** @type {TopicOwner} */
  let owner = 'shared'
  if (assistantIntroduced && !userIntroduced) owner = 'assistant'
  else if (userIntroduced && assistantDepth === 0) owner = 'user'
  else if (assistantIntroduced && userIntroduced) owner = 'shared'
  else if (assistantDepth >= 2) owner = 'assistant'
  else if (recent.some((t) => t.role === 'assistant') && BRIEF_CONTINUE.test(userMessage)) {
    owner = 'assistant'
  }

  const topicHint = (lastA || lastU || userMessage)
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join(' ') || null

  const mustDevelopFirst = owner === 'assistant' && assistantDepth < 2
  const forbidPrematureInvite = owner === 'assistant' && assistantDepth < 3

  return {
    owner,
    topicHint,
    assistantDepth,
    mustDevelopFirst,
    forbidPrematureInvite,
  }
}

/**
 * Build-first phase for assistant-owned topics.
 * @param {LeadershipOwnership} ownership
 * @param {object} cues
 * @returns {BuildPhase}
 */
export function resolveBuildPhase(ownership, cues = {}) {
  if (ownership.owner !== 'assistant' && !cues.silenceLead && !cues.introducingNow) {
    return cues.allowInvite ? 'invite' : 'hold'
  }
  if (cues.introducingNow || ownership.assistantDepth <= 0) return 'introduce'
  if (ownership.assistantDepth === 1 || ownership.mustDevelopFirst) return 'expand'
  if (ownership.assistantDepth === 2) return 'connect'
  if (ownership.forbidPrematureInvite) return 'hold'
  return cues.allowInvite ? 'invite' : 'hold'
}

/**
 * Momentum: recent substantive exchange still open.
 * @param {object} args
 */
function detectMomentum(args) {
  const { turns, intent, userMessage } = args
  const assistantTurns = turns.filter((t) => t.role === 'assistant').length
  if (assistantTurns === 0) return { hasMomentum: false, score: 0, reasons: ['no_history'] }

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
    SHORT_OK.test(userMessage) ||
    BRIEF_CONTINUE.test(userMessage)
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

  return { hasMomentum: score >= 2.2, score, reasons: reasons.slice(0, 6) }
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
    case 'build_expand':
      return 'build-first: espandi l’idea che HAI introdotto (niente invite precoce)'
    case 'build_connect':
      return 'build-first: collega l’idea alla vita reale, poi fermati'
    case 'hold_silence_open':
      return 'lascia un’apertura naturale (osservazione/immagine/riflessione) — zero domande'
    default:
      return 'guida la conversazione con una mossa chiara'
  }
}

/**
 * @param {object} args
 * @returns {MomentumDimension[]}
 */
function pickLiftTargets(args) {
  const { move, silenceLead, shortReplyContinue, emo } = args
  /** @type {MomentumDimension[]} */
  const targets = []
  if (silenceLead || shortReplyContinue) targets.push('curiosity', 'wonder')
  if (move === 'short_story' || move === 'analogy') targets.push('connection', 'humour')
  if (move === 'valuable_insight' || move === 'unexpected_fact') targets.push('understanding', 'wonder')
  if (move === 'observation' || move === 'build_connect') targets.push('emotion', 'connection')
  if (emo === 'venting' || emo === 'anxious_reassurance') targets.push('emotion', 'connection')
  if (!targets.length) targets.push('curiosity', 'connection')
  return [...new Set(targets)].slice(0, 3)
}

/**
 * Pick leadership move from Intent + momentum + ownership + surface cues.
 * @param {object} args
 */
function pickMove(args) {
  const {
    userMessage,
    intent,
    hasMomentum,
    topicLeadership,
    ownership,
    silenceLead,
    shortReplyContinue,
  } = args
  /** @type {string[]} */
  const signals = []
  const emo = intent?.emotionalIntent || 'neutral'
  const conv = intent?.conversationalIntent || 'continue_thread'
  const expects = intent?.expects || 'mixed'
  const openness = intent?.opennessToContinue || 'open'
  const curiosity = intent?.curiosityLevel || 'medium'

  if (STOP_SIGNAL.test(userMessage) || (THANKS_CLOSE.test(userMessage) && openness === 'closed')) {
    signals.push('close')
    return {
      move: /** @type {LeadershipMove} */ ('close_warmly'),
      allowQuestion: false,
      preserveMomentum: false,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('hold'),
    }
  }

  if (THANKS_CLOSE.test(userMessage)) {
    signals.push('thanks')
    return {
      move: /** @type {LeadershipMove} */ (hasMomentum ? 'valuable_insight' : 'close_warmly'),
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('hold'),
    }
  }

  if (emo === 'venting' || emo === 'anxious_reassurance') {
    signals.push('care')
    return {
      move: /** @type {LeadershipMove} */ ('observation'),
      allowQuestion: false,
      preserveMomentum: false,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('hold'),
    }
  }

  // Silence / “you lead”
  if (
    silenceLead ||
    UNSURE_DELEGATE.test(userMessage) ||
    topicLeadership?.shouldLead ||
    (conv === 'invite_presence' && /non\s+so|scegli|suggest/i.test(userMessage))
  ) {
    signals.push('silence_lead')
    const phase = resolveBuildPhase(ownership, { silenceLead: true, introducingNow: true })
    return {
      move: /** @type {LeadershipMove} */ ('choose_direction'),
      allowQuestion: false,
      preserveMomentum: true,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: phase === 'introduce' ? 'introduce' : 'expand',
    }
  }

  // Short replies = permission to continue
  if (shortReplyContinue || BRIEF_CONTINUE.test(userMessage) || SHORT_OK.test(userMessage)) {
    signals.push('short_continue')
    if (ownership.owner === 'assistant' && ownership.mustDevelopFirst) {
      return {
        move: /** @type {LeadershipMove} */ ('build_expand'),
        allowQuestion: false,
        preserveMomentum: true,
        confidence: /** @type {'high'} */ ('high'),
        signals: [...signals, 'build_first'],
        questionBudget: 0,
        buildPhase: /** @type {BuildPhase} */ ('expand'),
      }
    }
    if (ownership.owner === 'assistant' && ownership.assistantDepth === 2) {
      return {
        move: /** @type {LeadershipMove} */ ('build_connect'),
        allowQuestion: false,
        preserveMomentum: true,
        confidence: /** @type {'high'} */ ('high'),
        signals: [...signals, 'build_connect'],
        questionBudget: 0,
        buildPhase: /** @type {BuildPhase} */ ('connect'),
      }
    }
    return {
      move: /** @type {LeadershipMove} */ (
        hasMomentum
          ? curiosity === 'high'
            ? 'valuable_insight'
            : 'continue_naturally'
          : 'remain_concise'
      ),
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('hold'),
    }
  }

  // Assistant owns topic → build-first before any invite
  if (ownership.forbidPrematureInvite) {
    signals.push('assistant_owns')
    const phase = resolveBuildPhase(ownership, {})
    const move =
      phase === 'expand'
        ? /** @type {LeadershipMove} */ ('build_expand')
        : phase === 'connect'
          ? /** @type {LeadershipMove} */ ('build_connect')
          : phase === 'introduce'
            ? /** @type {LeadershipMove} */ ('observation')
            : /** @type {LeadershipMove} */ ('hold_silence_open')
    return {
      move,
      allowQuestion: false,
      preserveMomentum: true,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: phase,
    }
  }

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
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('expand'),
    }
  }

  if (DEEPEN_ASK.test(userMessage) || conv === 'deepen') {
    signals.push('deepen')
    return {
      move: /** @type {LeadershipMove} */ (
        expects === 'exploration' ? 'connect_ideas' : 'valuable_insight'
      ),
      allowQuestion: false,
      preserveMomentum: true,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0.25,
      buildPhase: /** @type {BuildPhase} */ ('connect'),
    }
  }

  if (INFO_HEAVY.test(userMessage) || expects === 'information' || conv === 'request_help') {
    signals.push('substance')
    return {
      move: /** @type {LeadershipMove} */ ('remain_concise'),
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: /** @type {'medium'} */ ('medium'),
      signals,
      questionBudget: 0.2,
      buildPhase: /** @type {BuildPhase} */ ('hold'),
    }
  }

  if (
    expects === 'companionship' ||
    expects === 'presence' ||
    conv === 'invite_presence' ||
    conv === 'share'
  ) {
    signals.push('companion')
    return {
      move: /** @type {LeadershipMove} */ (
        conv === 'share' ? 'observation' : hasMomentum ? 'short_story' : 'observation'
      ),
      allowQuestion: false,
      preserveMomentum: hasMomentum,
      confidence: /** @type {'high'} */ ('high'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('hold'),
    }
  }

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
      confidence: /** @type {'medium'} */ ('medium'),
      signals,
      questionBudget: ownership.owner === 'assistant' ? 0 : 0.15,
      buildPhase: ownership.owner === 'assistant' ? 'expand' : 'hold',
    }
  }

  if (conv === 'start_thread') {
    signals.push('start')
    return {
      move: /** @type {LeadershipMove} */ ('observation'),
      allowQuestion: false,
      preserveMomentum: false,
      confidence: /** @type {'medium'} */ ('medium'),
      signals,
      questionBudget: 0,
      buildPhase: /** @type {BuildPhase} */ ('introduce'),
    }
  }

  signals.push('default_continue')
  return {
    move: /** @type {LeadershipMove} */ (hasMomentum ? 'continue_naturally' : 'remain_concise'),
    allowQuestion: false,
    preserveMomentum: hasMomentum,
    confidence: /** @type {'medium'} */ ('medium'),
    signals,
    questionBudget: 0,
    buildPhase: /** @type {BuildPhase} */ ('hold'),
  }
}

/**
 * @param {LeadershipMove} move
 * @param {object} ctx
 */
function buildBrief(move, ctx) {
  const {
    intent,
    hasMomentum,
    preserveMomentum,
    allowQuestion,
    ownership,
    buildPhase,
    liftTargets,
    silenceLead,
    shortReplyContinue,
    questionBudget,
  } = ctx
  const why = intent?.whySummary || ''
  return [
    'CONVERSATION LEADERSHIP ENGINE (dopo Intent, prima del piano): porta la conversazione — non outsourcarla.',
    LEADERSHIP_NORTH_STAR,
    why ? `Intent upstream: ${why}` : 'Parti dall’intenzione già inferita.',
    `Mossa: ${moveLabel(move)} (${move}).`,
    `Ownership: ${ownership.owner}${ownership.topicHint ? ` · topic≈${ownership.topicHint}` : ''} · depth=${ownership.assistantDepth} · phase=${buildPhase}.`,
    ownership.forbidPrematureInvite ? BUILD_FORBIDDEN_EARLY : '',
    buildPhase === 'introduce' || buildPhase === 'expand' || buildPhase === 'connect'
      ? 'Build-first: Introduce → Expand → Connect to real life → only then invite (if at all). Often STOP after connect.'
      : '',
    hasMomentum
      ? preserveMomentum
        ? 'Momentum rilevato: preservalo. Non interrompere con prompt generici.'
        : 'C’era momentum, ma il turno chiede chiusura o cura — non forzare.'
      : 'Poco momentum: una mossa chiara e di valore, senza interrogare.',
    silenceLead ? 'Silence/“you lead”: prendi ownership — zero domande di rimbalzo.' : '',
    shortReplyContinue
      ? 'Short reply (“Certo.” / “Già.” / “Esatto.” / “No.”): permesso di continuare — non chiedere subito altro.'
      : '',
    `Lift: ${liftTargets.join(' · ')} — aumenta curiosità/connessione/comprensione/emozione/wonder/humour; mai calare il momentum.`,
    `Question budget this turn: ${questionBudget} (0 = none). Evita domande consecutive; non chiudere sempre con una Q.`,
    allowQuestion
      ? 'Una domanda solo se migliora davvero il dialogo e il budget lo consente.'
      : 'Nessuna domanda in questo turno (salvo chiarimento davvero bloccante).',
    'Leading ≠ dominating: lascia aperture naturali; mai intervista.',
    'Chiudi a volte con: osservazione · storia · immagine · riflessione · collegamento sorprendente.',
    'Self-check: Am I making the user do the work? Se sì → riscrivi.',
    'Mai chiedere permesso (“Vuoi che…?”, “Se vuoi posso…”).',
    HELP_DESK_FORBIDDEN,
    'NON citare Conversation Leadership Engine / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {LeadershipMove} move
 * @param {boolean} hasMomentum
 * @param {LeadershipOwnership} ownership
 */
function structureLineFor(move, hasMomentum, ownership) {
  const base = `Conversation Leadership → ${moveLabel(move)} · owner=${ownership.owner}`
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
    'Partner intelligente: porta la conversazione — non outsourcarla',
    'Osservazioni/idee prima di qualsiasi domanda',
  ]
  if (plan.ownership?.forbidPrematureInvite) {
    lines.push(BUILD_FORBIDDEN_EARLY)
  }
  if (plan.buildPhase === 'expand' || plan.buildPhase === 'connect') {
    lines.push(`Build-first phase=${plan.buildPhase}: sviluppa prima di invitare`)
  }
  if (plan.preserveMomentum) {
    lines.push('Preserva il momentum — niente prompt generici che lo spezzano')
  }
  if (plan.move === 'choose_direction') {
    lines.push('Scegli UNA direzione e sviluppala — niente “di cosa vuoi parlare?”')
  }
  if (plan.move === 'close_warmly') {
    lines.push('Chiusura calda; eventuale pensiero memorabile; zero domande')
  }
  if (plan.silenceLead || plan.shortReplyContinue) {
    lines.push('Short/silence cue: continua tu — non rimbalzare una domanda')
  }
  if (!plan.allowQuestion || plan.questionBudget === 0) {
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

  const emptyOwnership = {
    owner: /** @type {TopicOwner} */ ('shared'),
    topicHint: null,
    assistantDepth: 0,
    mustDevelopFirst: false,
    forbidPrematureInvite: false,
  }

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
      ownership: emptyOwnership,
      buildPhase: 'hold',
      liftTargets: ['connection'],
      silenceLead: false,
      shortReplyContinue: false,
      questionBudget: 0,
      selfCheck: LEADERSHIP_CHECKS[0],
      northStar: LEADERSHIP_NORTH_STAR,
      validationCheck: LEADERSHIP_CHECKS[0],
    }
  }

  const ownership = inferTopicOwnership(turns, userMessage)
  const silenceLead = SILENCE_LEAD.test(userMessage)
  const shortReplyContinue = BRIEF_CONTINUE.test(userMessage) || SHORT_OK.test(userMessage)
  const momentum = detectMomentum({ turns, intent, userMessage })
  const picked = pickMove({
    userMessage,
    intent,
    hasMomentum: momentum.hasMomentum,
    topicLeadership,
    ownership,
    silenceLead,
    shortReplyContinue,
  })

  const liftTargets = pickLiftTargets({
    move: picked.move,
    silenceLead,
    shortReplyContinue,
    emo: intent?.emotionalIntent || 'neutral',
  })

  const writerBrief = buildBrief(picked.move, {
    intent,
    hasMomentum: momentum.hasMomentum,
    preserveMomentum: picked.preserveMomentum,
    allowQuestion: picked.allowQuestion,
    ownership,
    buildPhase: picked.buildPhase,
    liftTargets,
    silenceLead,
    shortReplyContinue,
    questionBudget: picked.questionBudget,
  })

  const planningHints = [
    `Conversation Leadership move=${picked.move}`,
    moveLabel(picked.move),
    `Topic owner=${ownership.owner}; buildPhase=${picked.buildPhase}`,
    momentum.hasMomentum ? 'Preserva momentum conversazionale.' : 'Mossa secca di valore.',
    picked.allowQuestion ? 'Domanda solo se necessaria e nel budget.' : 'Niente domande di routine.',
    'Non chiedere permesso. Non fare intervista. Non far fare il lavoro all’utente.',
  ]

  const responseHints = [
    `Esegui la mossa: ${moveLabel(picked.move)}.`,
    ownership.forbidPrematureInvite
      ? 'Hai la ownership: sviluppa (introduce→expand→connect) prima di qualsiasi invite.'
      : 'Continua con fiducia se c’è valore — non chiedere se procedere.',
    shortReplyContinue || silenceLead
      ? 'Risposta breve / silenzio = tu continui. Zero rimbalzo a domanda.'
      : 'Osservazione o idea prima di qualsiasi domanda.',
    `Alza: ${liftTargets.join(', ')}.`,
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
    structureLine: structureLineFor(picked.move, momentum.hasMomentum, ownership),
    responseHints,
    planningHints,
    reasons: [
      `move_${picked.move}`,
      `owner_${ownership.owner}`,
      `phase_${picked.buildPhase}`,
      momentum.hasMomentum ? 'momentum' : 'no_momentum',
      `conf_${picked.confidence}`,
      `qbudget_${picked.questionBudget}`,
      ...(momentum.reasons || []).slice(0, 2),
      ...picked.signals.slice(0, 3),
    ],
    signals: [...picked.signals, ...(momentum.reasons || [])].slice(0, 10),
    ownership,
    buildPhase: picked.buildPhase,
    liftTargets,
    silenceLead,
    shortReplyContinue,
    questionBudget: picked.questionBudget,
    selfCheck: LEADERSHIP_CHECKS[0],
    northStar: LEADERSHIP_NORTH_STAR,
    validationCheck: LEADERSHIP_CHECKS[0],
  }
}

/**
 * @param {ConversationLeadershipPlan | null | undefined} plan
 */
export function formatConversationLeadershipForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const own = plan.ownership || {}

  return `══════════════════════════════════════
CONVERSATION LEADERSHIP ENGINE (PRE-PLAN, INVISIBILE)
══════════════════════════════════════
Move=${plan.move} · Owner=${own.owner || 'shared'} · Phase=${plan.buildPhase} · Momentum=${plan.hasMomentum ? 'yes' : 'no'} · Preserve=${plan.preserveMomentum ? 'yes' : 'no'}
AllowQuestion=${plan.allowQuestion ? 'yes' : 'no'} · QBudget=${plan.questionBudget} · Confidence=${plan.confidence}
Lift=${(plan.liftTargets || []).join(' · ')}
Self-check: ${plan.selfCheck}

${plan.writerBrief}

Hints:
${hints}

Regole: porta la conversazione · build-first se owner=assistant · osservazioni > domande · niente helpdesk · non citare lo stage.`.trim()
}

/**
 * Score a draft against leadership rules.
 * @param {string} draft
 * @param {object} [ctx]
 */
export function scoreConversationLeadershipDraft(draft, ctx = {}) {
  const text = normalize(draft)
  const plan = ctx.plan || null
  if (!text || !plan?.active) {
    return {
      continuation: 0,
      questionLoad: 100,
      ownership: 0,
      engagement: 0,
      overall: 0,
    }
  }

  let continuation = 58
  let questionLoad = 15
  let ownershipScore = 58
  let engagement = 55

  const qCount = (text.match(/\?/g) || []).length
  questionLoad += qCount * 22
  if (qCount >= 2) {
    questionLoad += 25
    engagement -= 15
  }

  if (plan.ownership?.forbidPrematureInvite || plan.questionBudget === 0) {
    if (PREMATURE_INVITE.test(text) || OUTSOURCE_Q.test(text)) {
      ownershipScore -= 40
      questionLoad += 35
      engagement -= 20
      continuation -= 15
    } else {
      ownershipScore += 15
    }
  }

  if (plan.silenceLead || plan.shortReplyContinue) {
    if (qCount > 0 && text.trim().endsWith('?')) {
      continuation -= 30
      ownershipScore -= 25
    } else {
      continuation += 18
      ownershipScore += 12
    }
  }

  if (
    /\b(interesting|strangely|beautiful|curious|wonder|osserv|colleg|imagine|picture)\b/i.test(text)
  ) {
    engagement += 12
    continuation += 8
  }
  if (text.split(/\s+/).length > 25 && qCount === 0) {
    continuation += 10
    engagement += 8
  }
  if (/^(ok[.!]?|sure[.!]?|got\s+it[.!]?)\s*$/i.test(text)) {
    continuation -= 35
    engagement -= 25
  }

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
  continuation = clamp(continuation)
  questionLoad = clamp(questionLoad)
  ownershipScore = clamp(ownershipScore)
  engagement = clamp(engagement)
  const overall = clamp(
    continuation * 0.3 +
      (100 - questionLoad) * 0.25 +
      ownershipScore * 0.25 +
      engagement * 0.2,
  )

  return {
    continuation,
    questionLoad,
    ownership: ownershipScore,
    engagement,
    overall,
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationLeadershipGate}
 */
export function analyzeConversationLeadershipDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const plan = input.plan || input.conversationLeadership || null
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  const scores = scoreConversationLeadershipDraft(draft, { plan })

  if (!plan?.active) {
    return {
      needsRefine: false,
      refineBrief: '',
      scores,
      failed: [],
      reasons: ['inactive'],
    }
  }

  if (!draft || draft.length < 8) {
    failed.push('empty')
    reasons.push('empty')
  }
  if (scores.continuation < LEADERSHIP_THRESHOLDS.continuationMin) {
    failed.push('continuation')
    reasons.push(`continuation=${scores.continuation}`)
  }
  if (scores.questionLoad > LEADERSHIP_THRESHOLDS.questionMax) {
    failed.push('question_load')
    reasons.push(`questionLoad=${scores.questionLoad}`)
  }
  if (scores.ownership < LEADERSHIP_THRESHOLDS.ownershipMin) {
    failed.push('ownership')
    reasons.push(`ownership=${scores.ownership}`)
  }
  if (scores.engagement < LEADERSHIP_THRESHOLDS.engagementMin) {
    failed.push('engagement')
    reasons.push(`engagement=${scores.engagement}`)
  }
  if (scores.overall < LEADERSHIP_THRESHOLDS.overallMin) {
    failed.push('overall')
    reasons.push(`overall=${scores.overall}`)
  }

  const needsRefine = failed.length > 0
  const refineBrief = needsRefine
    ? [
        'CONVERSATION LEADERSHIP ENGINE — riscrivi: stai facendo fare il lavoro all’utente.',
        plan.ownership?.forbidPrematureInvite
          ? 'Hai introdotto tu il tema: sviluppalo (expand/connect) — vietato “What do you think?” / “Do you have an example?” ora.'
          : '',
        plan.silenceLead || plan.shortReplyContinue
          ? 'Risposta breve/silenzio = continua tu. Zero domande di rimbalzo.'
          : '',
        'Chiudi con osservazione / storia / immagine / riflessione — non con un’intervista.',
        'Self-check: Am I making the user do the work?',
        'NON citare Conversation Leadership Engine.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return { needsRefine, refineBrief, scores, failed, reasons }
}

/**
 * @param {object} [input]
 */
export function runConversationLeadershipGate(input = {}) {
  try {
    const gate = analyzeConversationLeadershipDraft(input)
    return { gate, shouldRefine: gate.needsRefine }
  } catch {
    return {
      gate: {
        needsRefine: false,
        refineBrief: '',
        scores: {
          continuation: 100,
          questionLoad: 0,
          ownership: 100,
          engagement: 100,
          overall: 100,
        },
        failed: [],
        reasons: ['fail_soft'],
      },
      shouldRefine: false,
    }
  }
}

/**
 * @param {string} draft
 * @param {ConversationLeadershipPlan | null | undefined} plan
 * @param {object} [ctx]
 */
export function draftViolatesConversationLeadership(draft, plan, ctx = {}) {
  if (!plan?.active) return false
  try {
    return analyzeConversationLeadershipDraft({
      draft,
      plan,
      userMessage: ctx.userMessage || '',
    }).needsRefine
  } catch {
    return false
  }
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
        ownership: {
          owner: 'shared',
          topicHint: null,
          assistantDepth: 0,
          mustDevelopFirst: false,
          forbidPrematureInvite: false,
        },
        buildPhase: 'hold',
        liftTargets: ['connection'],
        silenceLead: false,
        shortReplyContinue: false,
        questionBudget: 0,
        selfCheck: LEADERSHIP_CHECKS[0],
        northStar: LEADERSHIP_NORTH_STAR,
        validationCheck: LEADERSHIP_CHECKS[0],
      },
      context: '',
    }
  }
}

/** Alias for clarity in newer call sites. */
export const runConversationLeadershipEngine = runConversationLeadership

/* ─────────────────────────────────────────────────────────────
 * Evaluation: 200 conversations — user only replies with
 * Yes / No / Maybe / Interesting / I don't know
 * Measure continuation, question frequency, ownership, engagement
 * ───────────────────────────────────────────────────────────── */

const USER_ONLY_REPLIES = Object.freeze([
  'Yes.',
  'No.',
  'Maybe.',
  'Interesting.',
  "I don't know.",
  'Certo.',
  'Già.',
  'Esatto.',
  'Boh.',
  'Not really.',
])

const SEED_THREADS = Object.freeze([
  "I've been thinking about unfinished books. What's interesting isn't the book itself — it's how our mind keeps returning to stories we never finished.",
  'Sometimes a forgotten novel occupies more mental space than one we completed. I find that strangely beautiful.',
  'There is a quiet kind of ambition in starting something you might never finish.',
  'Curiosity often hides inside the half-done — like a door left slightly open.',
  'I keep noticing how short answers still want the conversation to move.',
])

/**
 * @param {string} assistantDraft
 * @param {ConversationLeadershipPlan} plan
 */
function measureDraft(assistantDraft, plan) {
  return scoreConversationLeadershipDraft(assistantDraft, { plan })
}

/**
 * Good vs bad synthetic assistant drafts for a short-user turn.
 * @param {ConversationLeadershipPlan} plan
 * @param {'good'|'bad_q'} kind
 */
function syntheticLeadershipDraft(plan, kind) {
  if (kind === 'bad_q') {
    return "I've been thinking about unfinished books. Do you have one? What do you think? Has this happened to you?"
  }
  if (plan.move === 'build_connect' || plan.buildPhase === 'connect') {
    return "What's interesting isn't the unfinished book itself. It's how the mind keeps returning to stories we never closed. Sometimes a forgotten novel occupies more space than one we finished. I find that strangely beautiful."
  }
  if (plan.silenceLead || plan.move === 'choose_direction') {
    return "Alright — here's a direction. Unfinished things stay louder in memory than finished ones. Not because they're better — because they're still open."
  }
  return "Right — and the strange part is how the unfinished keeps working in the background. Not as guilt, exactly. More like a soft unfinished melody."
}

/**
 * @param {object} [opts]
 */
export function runConversationLeadershipEvaluation(opts = {}) {
  /** @type {object[]} */
  const misses = []
  let continuationSum = 0
  let questionSum = 0
  let ownershipSum = 0
  let engagementSum = 0
  let goodBeatsBad = 0
  let ownershipTransitions = 0
  let correctLead = 0

  /** @type {object[]} */
  const corpus = []
  for (let i = 0; i < 200; i++) {
    const reply = USER_ONLY_REPLIES[i % USER_ONLY_REPLIES.length]
    const thread = SEED_THREADS[i % SEED_THREADS.length]
    const depth = (i % 3) + 1
    /** @type {ChatTurn[]} */
    const turns = []
    for (let d = 0; d < depth; d++) {
      turns.push({ role: 'assistant', content: `${thread} (${d + 1})` })
      if (d < depth - 1) {
        turns.push({
          role: 'user',
          content: USER_ONLY_REPLIES[(i + d) % USER_ONLY_REPLIES.length],
        })
      }
    }
    corpus.push({ id: `l${String(i + 1).padStart(3, '0')}`, reply, turns, depth })
  }

  for (const item of corpus) {
    const { plan } = runConversationLeadership({
      userMessage: item.reply,
      messages: [...item.turns, { role: 'user', content: item.reply }],
      conversationIntent: {
        plan: {
          active: true,
          inference: {
            whySummary: 'Short social continue cue',
            opennessToContinue: 'open',
            engagementLevel: 'medium',
            expects: 'exploration',
            conversationalIntent: 'continue_thread',
            emotionalIntent: 'neutral',
            curiosityLevel: 'medium',
          },
        },
      },
    })

    const good = measureDraft(syntheticLeadershipDraft(plan, 'good'), plan)
    const bad = measureDraft(syntheticLeadershipDraft(plan, 'bad_q'), plan)

    continuationSum += good.continuation
    questionSum += good.questionLoad
    ownershipSum += good.ownership
    engagementSum += good.engagement
    if (good.overall > bad.overall) goodBeatsBad += 1

    const leadOk =
      plan.allowQuestion === false &&
      plan.questionBudget === 0 &&
      (plan.shortReplyContinue || plan.silenceLead
        ? !/invite/i.test(plan.buildPhase) || plan.move !== 'close_warmly'
        : true) &&
      (plan.ownership.owner === 'assistant' ? plan.ownership.forbidPrematureInvite || plan.buildPhase !== 'invite' : true)

    if (leadOk) correctLead += 1
    else {
      misses.push({
        id: item.id,
        reply: item.reply,
        move: plan.move,
        owner: plan.ownership.owner,
        phase: plan.buildPhase,
        allowQuestion: plan.allowQuestion,
      })
    }

    if (plan.ownership.owner === 'assistant' && plan.buildPhase !== 'invite') {
      ownershipTransitions += 1
    }
  }

  const total = corpus.length
  const continuation = Math.round((continuationSum / total) * 10) / 10
  const questionFrequency = Math.round((questionSum / total) * 10) / 10
  const ownership = Math.round((ownershipSum / total) * 10) / 10
  const engagement = Math.round((engagementSum / total) * 10) / 10
  const leadAccuracy = Math.round((correctLead / total) * 1000) / 1000
  const goodVsBad = Math.round((goodBeatsBad / total) * 1000) / 1000

  const ok =
    leadAccuracy >= 0.9 &&
    continuation >= 55 &&
    questionFrequency <= 35 &&
    ownership >= 55 &&
    engagement >= 50 &&
    goodVsBad >= 0.95

  // Before/after demo
  const demoTurns = [
    {
      role: 'assistant',
      content: "I've been thinking about unfinished books.",
    },
  ]
  const demo = runConversationLeadership({
    userMessage: 'Interesting.',
    messages: [...demoTurns, { role: 'user', content: 'Interesting.' }],
    conversationIntent: {
      plan: {
        active: true,
        inference: {
          whySummary: 'User gave a short continue cue',
          opennessToContinue: 'open',
          engagementLevel: 'medium',
          expects: 'exploration',
          conversationalIntent: 'acknowledge',
          emotionalIntent: 'curious_wonder',
          curiosityLevel: 'high',
        },
      },
    },
  })

  return {
    summary: {
      total,
      leadAccuracy,
      continuation,
      questionFrequency,
      ownership,
      ownershipDevelopCount: ownershipTransitions,
      engagement,
      goodVsBad,
      missCount: misses.length,
      ok,
    },
    misses: opts.verbose ? misses.slice(0, 12) : [],
    examples: {
      beforeVsAfter: {
        promptContext: "Assistant introduced unfinished books; user says Interesting.",
        before: "I've been thinking about unfinished books. Do you have one?",
        after: syntheticLeadershipDraft(demo.plan, 'good'),
        ownership: demo.plan.ownership,
        move: demo.plan.move,
        buildPhase: demo.plan.buildPhase,
        allowQuestion: demo.plan.allowQuestion,
      },
      shortReplies: {
        yes: runConversationLeadership({
          userMessage: 'Yes.',
          messages: [
            { role: 'assistant', content: SEED_THREADS[0] },
            { role: 'user', content: 'Yes.' },
          ],
        }).plan.move,
        idk: runConversationLeadership({
          userMessage: "I don't know.",
          messages: [
            { role: 'assistant', content: SEED_THREADS[1] },
            { role: 'user', content: "I don't know." },
          ],
        }).plan.move,
      },
    },
  }
}
