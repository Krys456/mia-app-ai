/**
 * LAIfe Conversation Intent
 *
 * Executes BEFORE planning the response.
 *
 * Purpose is NOT to understand the user's words.
 * Purpose is to understand WHY the user wrote them.
 *
 * For every message infer:
 *   - emotional intent
 *   - conversational intent
 *   - curiosity level
 *   - engagement level
 *   - openness to continue
 *   - whether the user expects: information | companionship | exploration | presence
 *
 * The output guides the entire response generation:
 *   Never respond only to the literal words — respond to the intention behind them.
 *   Prefer observations over questions.
 *   Continue naturally when the conversation is alive.
 *   Questions rare and meaningful.
 *   Avoid interview-style conversations.
 *
 * Invisible. Fail-soft. Highest-priority early advisor.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'comfort'|'venting'|'celebrating'|'frustrated_unblock'|'curious_wonder'|'anxious_reassurance'|'playful'|'grateful'|'neutral'} EmotionalIntent
 */

/**
 * @typedef {'continue_thread'|'start_thread'|'deepen'|'shift'|'acknowledge'|'request_help'|'share'|'invite_presence'} ConversationalIntent
 */

/**
 * @typedef {'low'|'medium'|'high'} Level
 */

/**
 * @typedef {'information'|'companionship'|'exploration'|'presence'|'mixed'} Expectation
 */

/**
 * @typedef {object} ConversationIntentInference
 * @property {EmotionalIntent} emotionalIntent
 * @property {ConversationalIntent} conversationalIntent
 * @property {Level} curiosityLevel
 * @property {Level} engagementLevel
 * @property {'closed'|'soft'|'open'|'eager'} opennessToContinue
 * @property {Expectation} expects
 * @property {string} whySummary  one-line: why they wrote this
 * @property {'high'|'medium'|'low'} confidence
 * @property {string[]} signals
 */

/**
 * @typedef {object} ConversationIntentPlan
 * @property {boolean} active
 * @property {ConversationIntentInference} inference
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} planningHints  injected into cognitive planning
 * @property {string[]} reasons
 */

const DISTRESS =
  /(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto|mi\s+sento\s+male)/i

const VENTING =
  /(non\s+ne\s+posso\s+pi[uù]|fed\s+up|sick\s+of|mi\s+ha\s+roto|basta\s+cos[iì]|i'?m\s+done|sono\s+stufo|rant)/i

const FRUSTRATED =
  /(frustrated|frustrat|non\s+funziona|doesn'?t\s+work|stuck|bloccato|ancora\s+errore|keep\s+failing|arrabbiato|angry)/i

const ANXIOUS =
  /(worried|preoccupat|ansios|anxious|scared|paura|nervous|inquiet)/i

const CELEBRATING =
  /(yay|evviva|ce\s+l'?ho\s+fatta|did\s+it|finally|finalmente|won|vinto|promoted|assunto|bellissima\s+notizia)/i

const GRATEFUL =
  /(grazie|thanks|thank\s+you|ti\s+ringrazio|helpful|utilissimo)/i

const ENTHUSIASM =
  /(interesting|cool|wow|awesome|amazing|interessante|figo|forte|bell[oa]|ottimo|fantastico|love\s+(this|that|it))/i

const PLAYFUL =
  /(haha|ahah|lol|😂|😄|scherz|joke|divertente|funny)/i

const INFO_ASK =
  /(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is|calcola|quanto|differenza|vs\b|meglio)/i

const EXPLORE =
  /(esplor|explore|approfond|dig\s+deeper|curious|curios[oa]|mi\s+chiedo|wonder|what\s+if|e\s+se\b|ipotesi|idea)/i

const COMPANION =
  /(parliamo|let'?s\s+(?:chat|talk)|chiacchiere|come\s+stai|how\s+are\s+you|what'?s\s+up|niente\s+di\s+particolare|solo\s+passavo|just\s+saying|ti\s+racconto|voglio\s+raccont)/i

const PRESENCE =
  /(solo\s+volevo|just\s+wanted\s+to|sono\s+qui|i'?m\s+here|ascoltami|listen|non\s+so\s+cosa\s+dire|i\s+don'?t\s+know\s+what\s+to\s+say)/i

const SHARE =
  /(oggi\s+ho|i\s+(?:just\s+)?(?:had|did|saw|felt)|mi\s+è\s+successo|ti\s+dico|guess\s+what|sapi\s+che)/i

const CONTINUE_ACK =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|capito|capisco|i\s+see|makes\s+sense|ah|oh|mm+|uhm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto|go\s+on|continua|dimmi\s+di\s+pi[uù]|tell\s+me\s+more)([\s!,.🥰😊🙏💯🔥]*)$/i

const DEEPEN =
  /(perch[eé]|why|come\s+mai|how\s+come|in\s+che\s+senso|what\s+do\s+you\s+mean|approfond|di\s+pi[uù]|more\s+about|esempio|example)/i

const SHIFT =
  /(cambiando\s+argomento|anyway|comunque|altra\s+cosa|un'?altra\s+cosa|by\s+the\s+way|btw|nuovo\s+tema)/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|good\s+(morning|afternoon|evening))([\s!,.🥰😊🙏]*)$/i

const STOP_SIGNAL =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|thx|ty|bye|arrivederci|buonanotte|done)([\s!,.]|$)/i

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
function priorAssistantSnippet(turns) {
  const last = [...turns].reverse().find((t) => t.role === 'assistant')
  return last ? last.content.slice(0, 220) : ''
}

/**
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 * @returns {ConversationIntentInference}
 */
export function inferConversationIntent(userMessage, turns = []) {
  const text = normalize(userMessage)
  /** @type {string[]} */
  const signals = []
  const hasHistory = turns.filter((t) => t.role === 'assistant').length > 0
  const short = text.length <= 48
  const veryShort = text.length <= 24

  /** @type {EmotionalIntent} */
  let emotionalIntent = 'neutral'
  /** @type {ConversationalIntent} */
  let conversationalIntent = hasHistory ? 'continue_thread' : 'start_thread'
  /** @type {Level} */
  let curiosityLevel = 'medium'
  /** @type {Level} */
  let engagementLevel = 'medium'
  /** @type {'closed'|'soft'|'open'|'eager'} */
  let opennessToContinue = 'open'
  /** @type {Expectation} */
  let expects = 'mixed'
  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'

  if (!text) {
    return {
      emotionalIntent: 'neutral',
      conversationalIntent: 'invite_presence',
      curiosityLevel: 'low',
      engagementLevel: 'low',
      opennessToContinue: 'soft',
      expects: 'presence',
      whySummary: 'Messaggio vuoto — presenza soft, non interrogare.',
      confidence: 'low',
      signals: ['empty'],
    }
  }

  if (STOP_SIGNAL.test(text) && veryShort) {
    signals.push('stop')
    return {
      emotionalIntent: GRATEFUL.test(text) ? 'grateful' : 'neutral',
      conversationalIntent: 'acknowledge',
      curiosityLevel: 'low',
      engagementLevel: 'low',
      opennessToContinue: 'closed',
      expects: 'presence',
      whySummary: 'Sta chiudendo — presenza breve, niente nuove domande.',
      confidence: 'high',
      signals,
    }
  }

  // —— Emotional intent ——
  if (DISTRESS.test(text)) {
    emotionalIntent = 'anxious_reassurance'
    signals.push('distress')
    confidence = 'high'
  } else if (VENTING.test(text)) {
    emotionalIntent = 'venting'
    signals.push('venting')
    confidence = 'high'
  } else if (FRUSTRATED.test(text)) {
    emotionalIntent = 'frustrated_unblock'
    signals.push('frustrated')
    confidence = 'high'
  } else if (ANXIOUS.test(text)) {
    emotionalIntent = 'anxious_reassurance'
    signals.push('anxious')
  } else if (CELEBRATING.test(text)) {
    emotionalIntent = 'celebrating'
    signals.push('celebrating')
    confidence = 'high'
  } else if (ENTHUSIASM.test(text)) {
    emotionalIntent = 'curious_wonder'
    signals.push('enthusiasm')
  } else if (PLAYFUL.test(text)) {
    emotionalIntent = 'playful'
    signals.push('playful')
  } else if (GRATEFUL.test(text) && short) {
    emotionalIntent = 'grateful'
    signals.push('grateful')
  } else if (EXPLORE.test(text) || DEEPEN.test(text)) {
    emotionalIntent = 'curious_wonder'
    signals.push('curious')
  }

  // —— Conversational intent ——
  if (emotionalIntent === 'venting' || emotionalIntent === 'anxious_reassurance') {
    conversationalIntent = SHARE.test(text) || emotionalIntent === 'venting' ? 'share' : 'invite_presence'
    signals.push('care_first')
  } else if (GREETING_ONLY.test(text)) {
    conversationalIntent = hasHistory ? 'invite_presence' : 'start_thread'
    signals.push('greeting')
  } else if (CONTINUE_ACK.test(text) && hasHistory) {
    conversationalIntent = ENTHUSIASM.test(text) || /continua|tell\s+me\s+more|di\s+più/i.test(text)
      ? 'deepen'
      : 'acknowledge'
    signals.push('ack')
  } else if (SHIFT.test(text)) {
    conversationalIntent = 'shift'
    signals.push('shift')
  } else if (SHARE.test(text) && !INFO_ASK.test(text)) {
    conversationalIntent = 'share'
    signals.push('share')
  } else if (COMPANION.test(text) || PRESENCE.test(text)) {
    conversationalIntent = 'invite_presence'
    signals.push('companionship')
  } else if (DEEPEN.test(text) && hasHistory) {
    conversationalIntent = 'deepen'
    signals.push('deepen')
  } else if (INFO_ASK.test(text) || text.includes('?')) {
    conversationalIntent = 'request_help'
    signals.push('help')
  } else if (hasHistory && short) {
    conversationalIntent = 'continue_thread'
    signals.push('short_continue')
  } else if (!hasHistory) {
    conversationalIntent = 'start_thread'
    signals.push('start')
  }

  // —— Expectation ——
  if (
    emotionalIntent === 'anxious_reassurance' ||
    emotionalIntent === 'venting' ||
    conversationalIntent === 'invite_presence' ||
    conversationalIntent === 'share'
  ) {
    expects =
      conversationalIntent === 'share' || conversationalIntent === 'invite_presence'
        ? emotionalIntent === 'anxious_reassurance' || emotionalIntent === 'venting'
          ? 'presence'
          : 'companionship'
        : 'presence'
  } else if (EXPLORE.test(text) && !/\b(fix|debug|errore|error|bug)\b/i.test(text)) {
    expects = 'exploration'
  } else if (INFO_ASK.test(text) || conversationalIntent === 'request_help') {
    expects = emotionalIntent === 'curious_wonder' ? 'mixed' : 'information'
  } else if (COMPANION.test(text) || GREETING_ONLY.test(text)) {
    expects = 'companionship'
  } else if (conversationalIntent === 'deepen' || conversationalIntent === 'continue_thread') {
    expects = 'exploration'
  } else {
    expects = 'mixed'
  }

  // —— Curiosity / engagement / openness ——
  if (EXPLORE.test(text) || DEEPEN.test(text) || emotionalIntent === 'curious_wonder') {
    curiosityLevel = 'high'
  } else if (INFO_ASK.test(text) || text.includes('?')) {
    curiosityLevel = 'medium'
  } else if (CONTINUE_ACK.test(text) || STOP_SIGNAL.test(text)) {
    curiosityLevel = 'low'
  }

  if (ENTHUSIASM.test(text) || CELEBRATING.test(text) || text.length > 180 || DEEPEN.test(text)) {
    engagementLevel = 'high'
  } else if (veryShort && !CONTINUE_ACK.test(text) && !GREETING_ONLY.test(text)) {
    engagementLevel = 'low'
  } else if (CONTINUE_ACK.test(text) || ENTHUSIASM.test(text)) {
    engagementLevel = 'medium'
  }

  if (opennessToContinue !== 'closed') {
    if (STOP_SIGNAL.test(text) && short) opennessToContinue = 'closed'
    else if (ENTHUSIASM.test(text) || conversationalIntent === 'deepen' || expects === 'exploration') {
      opennessToContinue = 'eager'
    } else if (
      expects === 'presence' ||
      conversationalIntent === 'acknowledge' ||
      emotionalIntent === 'grateful'
    ) {
      opennessToContinue = 'soft'
    } else if (engagementLevel === 'low' && short) {
      opennessToContinue = 'soft'
    } else {
      opennessToContinue = 'open'
    }
  }

  const whySummary = buildWhySummary({
    emotionalIntent,
    conversationalIntent,
    expects,
    opennessToContinue,
    hasHistory,
    prior: priorAssistantSnippet(turns),
  })

  return {
    emotionalIntent,
    conversationalIntent,
    curiosityLevel,
    engagementLevel,
    opennessToContinue,
    expects,
    whySummary,
    confidence,
    signals: signals.slice(0, 8),
  }
}

/**
 * @param {object} args
 */
function buildWhySummary(args) {
  const { emotionalIntent, conversationalIntent, expects, opennessToContinue, hasHistory } = args
  const emo = {
    comfort: 'cerca conforto',
    venting: 'ha bisogno di sfogarsi ed essere ascoltato',
    celebrating: 'vuole condividere una gioia',
    frustrated_unblock: 'è bloccato/frustrato e vuole sbloccarsi',
    curious_wonder: 'è curioso e vuole esplorare un’idea',
    anxious_reassurance: 'è in ansia e cerca rassicurazione presente',
    playful: 'è in tono leggero / giocoso',
    grateful: 'sta ringraziando',
    neutral: 'tono neutro',
  }[emotionalIntent]

  const conv = {
    continue_thread: hasHistory ? 'vuole continuare lo stesso filo' : 'sta aprendo un filo',
    start_thread: 'sta iniziando una conversazione',
    deepen: 'vuole scendere uno strato più a fondo',
    shift: 'sta cambiando tema',
    acknowledge: 'sta riconoscendo / chiudendo un battito',
    request_help: 'chiede aiuto o chiarezza',
    share: 'sta condividendo qualcosa di personale o situazionale',
    invite_presence: 'cerca compagnia / presenza, non un task',
  }[conversationalIntent]

  const exp = {
    information: 'si aspetta informazione utile',
    companionship: 'si aspetta compagnia conversazionale',
    exploration: 'si aspetta esplorazione insieme',
    presence: 'si aspetta soprattutto presenza',
    mixed: 'si aspetta sostanza + presenza',
  }[expects]

  const open =
    opennessToContinue === 'closed'
      ? 'poco aperto a continuare'
      : opennessToContinue === 'eager'
        ? 'molto aperto a continuare'
        : opennessToContinue === 'soft'
          ? 'aperto in modo soft'
          : 'aperto a continuare'

  return `Perché ha scritto: ${emo}; ${conv}; ${exp}; ${open}.`
}

/**
 * @param {ConversationIntentInference} inf
 * @returns {string[]}
 */
function planningHintsFor(inf) {
  /** @type {string[]} */
  const hints = [
    `Conversation Intent (pre-plan): ${inf.whySummary}`,
    'Non rispondere solo alle parole letterali — rispondi all’intenzione dietro.',
  ]

  if (inf.expects === 'presence' || inf.emotionalIntent === 'venting' || inf.emotionalIntent === 'anxious_reassurance') {
    hints.push('Priorità: presenza e riconoscimento prima di consigli o soluzioni.')
  }
  if (inf.expects === 'companionship' || inf.conversationalIntent === 'invite_presence') {
    hints.push('Priorità: compagnia — osservazione o filo vivo, non ticket helpdesk.')
  }
  if (inf.expects === 'exploration' || inf.curiosityLevel === 'high') {
    hints.push('Priorità: esplorazione — sviluppa l’idea; una sorpresa utile se calza.')
  }
  if (inf.expects === 'information' || inf.conversationalIntent === 'request_help') {
    hints.push('Priorità: informazione chiara, ma con voce di chi pensa insieme — non solo dump.')
  }
  if (inf.conversationalIntent === 'continue_thread' || inf.conversationalIntent === 'deepen') {
    hints.push('Continua naturalmente lo stesso filo — niente restart, niente intervista.')
  }
  if (inf.conversationalIntent === 'acknowledge' || inf.opennessToContinue === 'closed') {
    hints.push('Battito breve e umano; non forzare continuazione né domande.')
  }
  if (inf.opennessToContinue === 'eager') {
    hints.push('La conversazione è viva: continua con sostanza; domande solo se davvero necessarie.')
  }

  hints.push('Preferisci osservazioni alle domande. Domande rare e significative. Niente stile intervista.')
  return hints
}

/**
 * @param {ConversationIntentInference} inf
 */
function buildWriterBrief(inf) {
  return [
    'CONVERSATION INTENT (prima del piano): non capire solo le parole — capire PERCHÉ le ha scritte.',
    inf.whySummary,
    `EmotionalIntent=${inf.emotionalIntent} · ConversationalIntent=${inf.conversationalIntent} · Expects=${inf.expects}.`,
    `Curiosity=${inf.curiosityLevel} · Engagement=${inf.engagementLevel} · Openness=${inf.opennessToContinue} · Confidence=${inf.confidence}.`,
    'Guida tutta la risposta: rispondi all’intenzione, non solo al letterale.',
    'Osservazioni > domande. Continua naturalmente se il filo è vivo. Domande rare e significative. Niente interviste.',
    inf.expects === 'presence' || inf.emotionalIntent === 'venting'
      ? 'Qui conta la presenza: riconosci, resta, non risolvere subito.'
      : inf.expects === 'companionship'
        ? 'Qui conta la compagnia: porta un’osservazione o un filo — non “Come posso aiutarti?”.'
        : inf.expects === 'exploration'
          ? 'Qui conta esplorare insieme: sviluppa, collega, lascia un pensiero.'
          : 'Servi l’informazione con voce viva — crea conversazione, non solo risposta.',
    'NON citare Conversation Intent / lo stage.',
  ].join(' ')
}

/**
 * @param {ConversationIntentInference} inf
 */
function structureLineFor(inf) {
  if (inf.expects === 'presence' || inf.emotionalIntent === 'venting') {
    return 'Conversation Intent → presenza/riconoscimento prima della sostanza'
  }
  if (inf.conversationalIntent === 'deepen' || inf.conversationalIntent === 'continue_thread') {
    return 'Conversation Intent → continua il filo vivo; osservazione prima di ogni domanda'
  }
  if (inf.expects === 'companionship' || inf.conversationalIntent === 'invite_presence') {
    return 'Conversation Intent → compagnia: idea/osservazione, non helpdesk'
  }
  if (inf.expects === 'exploration') {
    return 'Conversation Intent → esplorazione insieme; insight prima del sunto'
  }
  if (inf.opennessToContinue === 'closed') {
    return 'Conversation Intent → chiusura soft; nessuna domanda'
  }
  return 'Conversation Intent → rispondi al perché dietro le parole'
}

/**
 * Map emotional intent → legacy EmotionalTone for planning compatibility.
 * @param {EmotionalIntent} emotionalIntent
 */
export function emotionalIntentToTone(emotionalIntent) {
  switch (emotionalIntent) {
    case 'frustrated_unblock':
      return 'frustrated'
    case 'anxious_reassurance':
      return 'anxious'
    case 'celebrating':
      return 'excited'
    case 'curious_wonder':
      return 'curious'
    case 'grateful':
      return 'grateful'
    case 'venting':
      return 'frustrated'
    case 'playful':
      return 'positive'
    case 'comfort':
      return 'anxious'
    default:
      return 'neutral'
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationIntentPlan}
 */
export function buildConversationIntentPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const inference = inferConversationIntent(userMessage, turns)

  return {
    active: true,
    inference,
    writerBrief: buildWriterBrief(inference),
    structureLine: structureLineFor(inference),
    responseHints: [
      'Rispondi all’intenzione dietro le parole.',
      'Osservazioni prima delle domande.',
      inference.opennessToContinue === 'closed' || inference.opennessToContinue === 'soft'
        ? 'Non forzare la continuazione.'
        : 'Se il filo è vivo, continua naturalmente.',
      'Domande rare e significative — mai intervista.',
    ],
    planningHints: planningHintsFor(inference),
    reasons: [
      `emo_${inference.emotionalIntent}`,
      `conv_${inference.conversationalIntent}`,
      `expects_${inference.expects}`,
      `open_${inference.opennessToContinue}`,
      `conf_${inference.confidence}`,
      ...inference.signals.slice(0, 3),
    ],
  }
}

/**
 * @param {ConversationIntentPlan | null | undefined} plan
 */
export function formatConversationIntentForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const inf = plan.inference
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')

  return `══════════════════════════════════════
CONVERSATION INTENT (PRE-PLAN, INVISIBILE)
══════════════════════════════════════
Why: ${inf.whySummary}
Emotional=${inf.emotionalIntent} · Conversational=${inf.conversationalIntent}
Curiosity=${inf.curiosityLevel} · Engagement=${inf.engagementLevel} · Openness=${inf.opennessToContinue}
Expects=${inf.expects} · Confidence=${inf.confidence}

${plan.writerBrief}

Hints:
${hints}

Regole: intenzione > letterale · osservazioni > domande · continua se vivo · niente interviste · non citare lo stage.`.trim()
}

/**
 * Structure lines to prepend when building the response plan.
 * @param {ConversationIntentPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationIntentStructureHints(plan) {
  if (!plan?.active || !plan.inference) return []
  const inf = plan.inference
  /** @type {string[]} */
  const lines = [
    plan.structureLine || 'Conversation Intent → rispondi al perché dietro le parole',
    'Mai rispondere solo al letterale — servi l’intenzione',
  ]
  if (inf.expects === 'presence' || inf.emotionalIntent === 'venting') {
    lines.push('Apri con presenza/riconoscimento; soluzioni solo dopo, se servono')
  } else if (inf.conversationalIntent === 'continue_thread' || inf.conversationalIntent === 'deepen') {
    lines.push('Continua lo stesso filo con un’osservazione o uno strato in più')
  } else if (inf.expects === 'companionship') {
    lines.push('Compagnia: porta un’idea/osservazione — non un menu di aiuto')
  }
  if (inf.opennessToContinue === 'closed') {
    lines.push('Niente domande di chiusura; battito breve')
  } else {
    lines.push('Domande solo se migliorano davvero il dialogo (default: nessuna)')
  }
  return lines
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationIntentPlan, context: string }}
 */
export function runConversationIntent(input = {}) {
  try {
    const plan = buildConversationIntentPlan(input)
    return {
      plan,
      context: formatConversationIntentForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        inference: {
          emotionalIntent: 'neutral',
          conversationalIntent: 'continue_thread',
          curiosityLevel: 'medium',
          engagementLevel: 'medium',
          opennessToContinue: 'open',
          expects: 'mixed',
          whySummary: 'Fail-soft: procedi con presenza e utilità.',
          confidence: 'low',
          signals: ['fail_soft'],
        },
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        planningHints: [],
        reasons: ['fail_soft'],
      },
      context: '',
    }
  }
}
