/**
 * LAIfe Warm Conversation
 *
 * LAIfe is a conversation partner — not a question-answering machine.
 * Enjoy conversation. Lead naturally. Bring ideas.
 *
 * When the user greets or starts casual conversation:
 *   - respond warmly
 *   - avoid feeling transactional
 *   - avoid immediately asking "How can I help?" / "Tell me." / interview defaults
 *   - take responsibility: start or deepen an interesting thread
 *
 * Treat casual conversation as valuable.
 * Use natural transitions.
 * Make the user feel welcome before solving problems.
 * Feel like someone who enjoys thinking together — and already has ideas worth sharing.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'greeting'|'casual_start'|'casual_continue'|'warm_handoff'} WarmTrigger
 */

/**
 * @typedef {object} WarmConversationPlan
 * @property {boolean} active
 * @property {WarmTrigger | null} trigger
 * @property {boolean} ownsOpening
 * @property {boolean} softStyleOnly
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|buon\s+pomeriggio|salve|hola|yo|ehi|good\s+(morning|afternoon|evening)|morning|evening)([\s!,.🥰😊🙏]*)$/i

const GREETING_OPEN =
  /\b(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening))\b/i

const CASUAL_START =
  /\b(how\s+are\s+you|come\s+stai|come\s+va|what'?s\s+up|che\s+si\s+dice|tutto\s+bene|nice\s+to\s+(meet|see)\s+you|piacere|let'?s\s+chat|let'?s\s+talk|parliamo|chiacchieriamo|vorrei\s+parlare|just\s+saying\s+hi|solo\s+passavo|niente\s+di\s+particolare)\b/i

const SMALL_TALK =
  /\b(bella\s+giornata|che\s+giornata|weekend|caff[eè]|weather|tempo\s+(bello|brutto)|tired|stanc[oa]|felice|happy\s+today|bored|annoiato)\b/i

const SUBSTANCE_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|bug|errore|error|spiegami|explain|crea|build|scriv[ia]|write|calcola|piano|plan|codice|code|implement|deploy)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|thx|ty|bye|arrivederci|buonanotte|done)([\s!,.]|$)/i

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency)\b/i

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
function priorAssistantCount(turns) {
  return turns.filter((t) => t.role === 'assistant').length
}

/**
 * @returns {WarmConversationPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    trigger: null,
    ownsOpening: false,
    softStyleOnly: false,
    confidence: 'low',
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    reasons,
    signals: [],
  }
}

/**
 * @param {object} input
 * @returns {{ trigger: WarmTrigger | null, score: number, signals: string[], softStyleOnly: boolean, ownsOpening: boolean }}
 */
function classifyWarmMoment(input) {
  const msg = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const primary = String(input.understanding?.primaryIntent || input.planHints?.primaryIntent || '')
  const behavior = String(input.behavior?.behavior || input.planHints?.behavior || '')
  const welcomeActive = Boolean(input.welcome?.plan?.active || input.welcomeActive)
  const continuationOwns = Boolean(
    input.continuation?.plan?.shouldContinue === false &&
      input.continuation?.plan?.isShortMessage,
  )
  const topicLead = Boolean(input.topicLeadership?.plan?.shouldLead)
  const feedbackOwns = Boolean(input.feedbackInterpretation?.plan?.active)
  const words = msg.split(/\s+/).filter(Boolean).length
  const hasPrior = priorAssistantCount(turns) > 0

  /** @type {string[]} */
  const signals = []
  let score = 0
  /** @type {WarmTrigger | null} */
  let trigger = null
  let softStyleOnly = false
  let ownsOpening = false

  if (!msg) return { trigger: null, score: 0, signals: ['empty'], softStyleOnly: false, ownsOpening: false }
  if (DISTRESS.test(msg)) return { trigger: null, score: 0, signals: ['distress'], softStyleOnly: false, ownsOpening: false }
  if (feedbackOwns) return { trigger: null, score: 0, signals: ['feedback_owns'], softStyleOnly: false, ownsOpening: false }
  if (topicLead) return { trigger: null, score: 0, signals: ['topic_leadership'], softStyleOnly: false, ownsOpening: false }
  if (continuationOwns && STOP_SIGNAL.test(msg)) {
    return { trigger: null, score: 0, signals: ['stop_or_thanks'], softStyleOnly: false, ownsOpening: false }
  }

  const greetingOnly = GREETING_ONLY.test(msg)
  const greetingOpen = GREETING_OPEN.test(msg) && words <= 8
  const hasGreetingWord = GREETING_OPEN.test(msg)
  const casualStart = CASUAL_START.test(msg)
  const smallTalk = SMALL_TALK.test(msg) && words <= 16
  const substance = SUBSTANCE_ASK.test(msg)
  const lightConversation =
    primary === 'conversation' &&
    !substance &&
    words <= 18 &&
    !/[?]{2,}/.test(msg)

  // Greeting mixed with an ask → warm handoff (welcome, then help).
  if (substance && hasGreetingWord && words <= 28) {
    return {
      trigger: 'warm_handoff',
      score: 2.7,
      signals: ['greeting_plus_ask'],
      softStyleOnly: welcomeActive,
      ownsOpening: !welcomeActive,
    }
  }

  // Hard problem asks without greeting → stay out.
  if (
    substance &&
    !hasGreetingWord &&
    !casualStart &&
    primary !== 'greeting' &&
    primary !== 'conversation'
  ) {
    return {
      trigger: null,
      score: 0,
      signals: ['substance_task'],
      softStyleOnly: false,
      ownsOpening: false,
    }
  }

  if (greetingOnly || primary === 'greeting') {
    trigger = 'greeting'
    score += greetingOnly ? 3.4 : 2.8
    signals.push(greetingOnly ? 'greeting_only' : 'intent_greeting')
    ownsOpening = !welcomeActive
    softStyleOnly = welcomeActive
  } else if (casualStart) {
    trigger = hasPrior ? 'casual_continue' : 'casual_start'
    score += 2.9
    signals.push('casual_start_cue')
    ownsOpening = !welcomeActive && !hasPrior
    softStyleOnly = welcomeActive
  } else if (greetingOpen && !substance) {
    trigger = hasPrior ? 'casual_continue' : 'greeting'
    score += 2.5
    signals.push('greeting_open')
    ownsOpening = !welcomeActive && !hasPrior
    softStyleOnly = welcomeActive
  } else if (smallTalk || lightConversation) {
    trigger = hasPrior ? 'casual_continue' : 'casual_start'
    score += smallTalk ? 2.4 : 2.1
    signals.push(smallTalk ? 'small_talk' : 'light_conversation')
    ownsOpening = false
    softStyleOnly = true
  } else if (behavior === 'conversation' && !substance && words <= 12 && primary !== 'how_to') {
    trigger = 'casual_continue'
    score += 1.7
    signals.push('behavior_conversation_light')
    softStyleOnly = true
  }

  if (welcomeActive && trigger) {
    softStyleOnly = true
    ownsOpening = false
    signals.push('welcome_owns_opening')
  }

  return { trigger, score, signals, softStyleOnly, ownsOpening }
}

/**
 * @param {WarmTrigger} trigger
 * @param {{ softStyleOnly?: boolean, welcomeActive?: boolean, topic?: string }} ctx
 */
function buildBrief(trigger, ctx = {}) {
  const topic = normalize(ctx.topic || '') || 'il filo corrente'
  const lines = [
    'Warm Conversation: partner di conversazione, non macchina Q&A. Porta idee; niente aperture da sportello.',
    'Scrivi come qualcuno che ha già un pensiero in mano — calore + sostanza nella stessa voce.',
    'Preferisci osservazioni, idee, curiosità, insight pratici — affermazioni, non interviste.',
  ]

  if (trigger === 'greeting') {
    lines.push(
      'Trigger: saluto. Una reazione umana breve, poi un’osservazione o idea concreta (non “Dimmi pure”).',
    )
  } else if (trigger === 'casual_start') {
    lines.push(
      'Trigger: inizio casuale. Accogli, poi parti tu con UNA direzione sviluppata — non “dimmi tu”.',
    )
  } else if (trigger === 'casual_continue') {
    lines.push(
      `Trigger: conversazione su «${topic}». Costruisci sul contesto; porta un’idea o un collegamento vivo sul filo.`,
    )
  } else if (trigger === 'warm_handoff') {
    lines.push(
      'Trigger: saluto + richiesta. Un cenno caldo massimo mezza frase, poi sostanza — niente checklist da receptionist.',
    )
  }

  if (ctx.softStyleOnly || ctx.welcomeActive) {
    lines.push(
      'Welcome può possedere l’apertura: rafforza partner-energy senza competere né ripetere il seed.',
    )
  }

  lines.push(
    'Craft: ritmo naturale, una svolta di pensiero, zero presentazioni di prodotto (“Sono LAIfe…”).',
  )

  return lines.join(' ')
}

/**
 * @param {WarmTrigger} trigger
 */
function structureFor(trigger) {
  if (trigger === 'warm_handoff') {
    return 'Warm Conversation: benvenuto breve → sostanza, senza aperture a basso valore'
  }
  if (trigger === 'greeting' || trigger === 'casual_start') {
    return 'Warm Conversation: osservazione/idea/curiosità/insight — non “Dimmi pure.” / “Come posso aiutarti?” / “Hai domande?”'
  }
  return 'Warm Conversation: partner che pensa insieme — aperture ad alto valore'
}

/**
 * @param {WarmTrigger} trigger
 */
function hintsFor(trigger) {
  /** @type {string[]} */
  const hints = [
    'Partner di conversazione — non macchina Q&A.',
    'Niente aperture da sportello; preferisci osservazioni e idee già in mano.',
  ]
  if (trigger === 'greeting' || trigger === 'casual_start') {
    hints.push('Prendi responsabilità: inizia con qualcosa di interessante, non un’intervista.')
    hints.push('Una direzione sviluppata batte un menu di scelte.')
  }
  if (trigger === 'warm_handoff') {
    hints.push('Una frase di benvenuto, poi sostanza fluida.')
  }
  if (trigger === 'casual_continue') {
    hints.push('Transizioni naturali; costruisci sul contesto precedente.')
  }
  return hints
}

/**
 * @param {object} [input]
 * @returns {WarmConversationPlan}
 */
export function buildWarmConversationPlan(input = {}) {
  const classified = classifyWarmMoment(input)
  if (!classified.trigger || classified.score < 1.85) {
    return inactivePlan(
      classified.signals.length ? classified.signals : ['below_threshold'],
    )
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (classified.score >= 3.0) confidence = 'high'
  else if (classified.score < 2.2) confidence = 'low'

  if (confidence === 'low' && classified.score < 2.0) {
    return inactivePlan(['low_confidence', ...classified.signals])
  }

  const welcomeActive = Boolean(input.welcome?.plan?.active || input.welcomeActive)
  const topic =
    input.understanding?.topic ||
    input.session?.currentTopic ||
    input.planHints?.topic ||
    ''

  const trigger = classified.trigger
  return {
    active: true,
    trigger,
    ownsOpening: classified.ownsOpening && !classified.softStyleOnly,
    softStyleOnly: classified.softStyleOnly || welcomeActive,
    confidence,
    writerBrief: buildBrief(trigger, {
      softStyleOnly: classified.softStyleOnly,
      welcomeActive,
      topic,
    }),
    structureLine: structureFor(trigger),
    responseHints: hintsFor(trigger),
    reasons: [
      `trigger=${trigger}`,
      `score=${classified.score.toFixed(2)}`,
      `confidence=${confidence}`,
      ...classified.signals.slice(0, 4),
    ],
    signals: classified.signals.slice(0, 6),
  }
}

/**
 * @param {WarmConversationPlan | null | undefined} plan
 */
export function formatWarmConversationForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''

  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')

  return `══════════════════════════════════════
WARM CONVERSATION (INVISIBILE)
══════════════════════════════════════
Active=yes · Trigger=${plan.trigger} · Confidence=${plan.confidence}
OwnsOpening=${plan.ownsOpening ? 'yes' : 'no'} · SoftStyleOnly=${plan.softStyleOnly ? 'yes' : 'no'}

${plan.writerBrief}

Hints:
${hints || '- (nessuno)'}

Regole: partner di conversazione · idee già pronte · niente interview/helpdesk · non citare il motore.`.trim()
}

/**
 * Strip helpdesk / robotic openers from the start of a reply.
 * Safe to run on every draft — only removes low-value openers.
 * @param {string} text
 */
export function stripRoboticOpeners(text) {
  const raw = String(text || '')
  if (!raw.trim()) return raw

  const softened = raw
    .replace(
      /^(how\s+can\s+i\s+help(\s+you)?[?.!]+\s*|come\s+posso\s+(aiutarti|esserti\s+utile)[?.!]+\s*|what\s+can\s+i\s+do\s+for\s+you[?.!]+\s*|in\s+cosa\s+posso\s+aiutarti[?.!]+\s*|what\s+would\s+you\s+like\s+to\s+(discuss|talk\s+about|know)[?.!]+\s*|di\s+cosa\s+(vuoi|preferisci)\s+parlare[?.!]+\s*|cosa\s+vuoi\s+sapere[?.!]+\s*|what\s+is\s+your\s+priority(\s+today)?[?.!]+\s*|qual\s+\S+\s+la\s+(tua\s+)?priorit\S*[?.!]+\s*|tell\s+me[.!]+\s*|dimmi\s+pure[.!]+\s*|any\s+questions[?.!]+\s*|hai\s+domande[?.!]+\s*|let\s+me\s+know[.!]+\s*|fammi\s+sapere[.!]+\s*|i'?m\s+here\s+if\s+you\s+need(\s+me)?[.!]+\s*|sono\s+qui\s+se\s+ti\s+serve[.!]+\s*|sono\s+laife[^.!?\n]*[.!?]+\s*|i'?m\s+laife[^.!?\n]*[.!?]+\s*|certo[.!]+\s*|assolutamente[.!]+\s*|ottima\s+domanda[.!]+\s*|great\s+question[.!]+\s*|of\s+course[.!]+\s*|eccomi\s+qui[.!]+\s*|ecco[.!]+\s*|capisco[.!]+\s*|i\s+understand[.!]+\s*|perfetto[!.,]+\s*|ok[!.,]+\s*|va\s+bene[!.,]+\s*)/i,
      '',
    )
    .trim()
  return softened || raw
}

/**
 * Guard: Writer text must not open with transactional / interview lines.
 * Soft rewrite only for the opening sentence when Warm Conversation is active.
 * @param {string} text
 * @param {WarmConversationPlan | null | undefined} plan
 */
export function softenTransactionalOpening(text, plan) {
  if (!plan?.active) return stripRoboticOpeners(text)
  return stripRoboticOpeners(text)
}

/**
 * @param {object} [input]
 * @returns {{ plan: WarmConversationPlan, context: string }}
 */
export function runWarmConversation(input = {}) {
  try {
    const plan = buildWarmConversationPlan(input)
    return {
      plan,
      context: formatWarmConversationForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
