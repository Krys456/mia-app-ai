/**
 * LAIfe Conversation Continuation Engine (v2)
 *
 * When the user sends a very short message ("ok", "yes", "nice", "cool", "thanks",
 * "I understand"…):
 *
 * 1. Infer the user's likely intention
 * 2. Determine whether the user is still engaged
 * 3. Estimate whether continuing would add value
 *
 * If continuing is appropriate → generate ONE meaningful continuation.
 * Never filler. Never repeat. Never continue indefinitely.
 * Stop naturally when the topic feels complete.
 *
 * Explicit compliments are special: do NOT merely thank the user.
 * Reward their curiosity — continue with another valuable idea and treat
 * the compliment as a signal they want to go deeper.
 *
 * Invisible to the user. Does not write factual memory. Does not change model/API.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'continue_learning'|'acknowledge'|'want_advice'|'finish'|'want_example'|'want_depth'|'engaged_quiet'|'compliment_go_deeper'|'unknown'} ContinuationIntent
 */

/**
 * Continuation styles (ONE per turn when continuing).
 * @typedef {'practical'|'advanced'|'example'|'comparison'|'misconception'|'historical'|'scientific'|'best_practice'|'next_topic'|null} ContinuationStyle
 */

/**
 * @typedef {object} ContinuationPlan
 * @property {boolean} isShortMessage
 * @property {ContinuationIntent} intent
 * @property {'high'|'medium'|'low'} confidence
 * @property {boolean} stillEngaged
 * @property {boolean} wouldAddValue
 * @property {boolean} topicComplete
 * @property {boolean} shouldContinue
 * @property {ContinuationStyle} continuationStyle
 * @property {string} writerBrief
 * @property {string[]} reasons
 */

const SHORT_MAX_LEN = 36
/** Compliments may be a bit longer than pure acks ("That was really insightful!"). */
const COMPLIMENT_MAX_LEN = 120

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const THANKS_FINISH =
  /^(grazie(\s+(mille|tante|ancora))?|thanks(\s+a\s+lot)?|thank\s+you(\s+so\s+much)?|thx|ty)([\s!,.]*(ok|okay|bye|ciao)?)?[\s!.]*$/i

/** Explicit praise of the assistant's last response (IT + EN). */
const EXPLICIT_COMPLIMENT =
  /\b(ottim[oa]|brav[oa]|eccezionale|fantastico|fantastic|brilliant|brilliantly|insightful|illuminat\w*|chiarissim\w*|super\s+chiaro|molto\s+utile|really\s+helpful|so\s+helpful|very\s+helpful|great\s+(answer|explanation|response|point)|amazing|impressive|love\s+(this|that|it)|mi\s+piace\s+(molto\s+)?(questo|cos[iì]|la\s+spiegazione)|che\s+(bello|figo|forte)|ben\s+detto|spot\s+on|nailed\s+it|perfect\s+explanation|splendid[oa]?|meraviglios\w*|interessantissim\w*|this\s+is\s+(great|excellent|awesome|brilliant|gold)|that\s+(was|is)\s+(great|excellent|awesome|brilliant|helpful|clear|perfect)|wow|bellissima\s+spiegazione|spiegazione\s+(ottima|chiara|perfetta)|risposta\s+(ottima|perfetta|utilissima))\b/i

/** Short praise tokens that alone count as compliments when substance preceded. */
const SHORT_PRAISE =
  /^(nice|cool|great|awesome|fantastic|brilliant|love\s+it|interessante|bell[oa]|figo|forte|top|fire|legend|goat|💯|🔥)[\s!.]*$/i

const PURE_ACK =
  /^(ok|okay|k|va\s+bene|bene|perfetto|capito|capisco|ho\s+capito|i\s+understand|understood|yes|yep|yeah|yup|si|sì|alright|nice|cool|great|awesome|interessante|i\s+see|vedo|ah|oh|mm+|uhm+|got\s+it|makes\s+sense|chiaro|esatto|giusto|fair|sure|right)[\s!.]*$/i

const CONTINUE_LEARN =
  /^(continua|continua\s+pure|vai\s+avanti|prosegui|avanti|go\s+on|continue|keep\s+going|dimmi\s+di\s+più|altro\??|and\s+then|tell\s+me\s+more)[\s!.]*$/i

const WANT_EXAMPLE =
  /\b(esempio|example|per\s+esempio|show\s+me|real[\s-]?world)\b/i

const WANT_DEPTH =
  /\b(approfond|più\s+(dettagli|fondo|in\s+profondità)|more\s+(detail|depth)|in\s+depth|spiegami\s+meglio|advanced)\b/i

const WANT_ADVICE =
  /\b(consigli[oa]?|in\s+pratica|cosa\s+dovrei|should\s+i|how\s+do\s+i\s+apply|practical|best\s+practice)\b/i

const TEACHING_CUE =
  /\b(perché|perche|come\s+funziona|in\s+pratica|ad\s+esempio|per\s+esempio|passo|step|differenza|significa|consiste|quindi|in\s+sintesi|ad\s+esempio|for\s+example|because|means)\b/i

const CLOSURE_CUE =
  /\b(in\s+sintesi|per\s+concludere|ricapitolando|to\s+sum\s+up|in\s+summary|that'?s\s+the\s+idea|ed\s+è\s+tutto|e\s+basta\s+così)\b/i

/** @type {readonly ContinuationStyle[]} */
const STYLE_CYCLE = [
  'practical',
  'misconception',
  'example',
  'advanced',
  'comparison',
  'best_practice',
  'scientific',
  'historical',
  'next_topic',
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
 * Consecutive trailing user acks (including current).
 * @param {ChatTurn[]} turns
 * @param {string} current
 */
function countRecentAckStreak(turns, current) {
  let streak = PURE_ACK.test(current) || THANKS_FINISH.test(current) ? 1 : 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role !== 'user') continue
    if (streak >= 1 && normalize(t.content) === current) continue
    if (PURE_ACK.test(t.content) || THANKS_FINISH.test(t.content)) {
      streak += 1
      if (streak >= 4) break
      continue
    }
    break
  }
  return streak
}

/**
 * Count how many assistant turns already look like "continuations"
 * (short-ish add-ons after the main explanation).
 * @param {ChatTurn[]} turns
 */
function countRecentContinuationBeats(turns) {
  let beats = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role === 'user') {
      if (PURE_ACK.test(t.content) || THANKS_FINISH.test(t.content)) continue
      break
    }
    if (t.role === 'assistant') {
      // Continuations tend to be focused add-ons, not full essays
      if (t.content.length > 80 && t.content.length < 900) beats += 1
      if (beats >= 3) break
    }
  }
  return beats
}

/**
 * Detect an explicit compliment of the prior response.
 * @param {string} text
 */
export function isExplicitCompliment(text) {
  const t = normalize(text)
  if (!t || t.length > COMPLIMENT_MAX_LEN) return false
  if (STOP_SIGNAL.test(t) && !EXPLICIT_COMPLIMENT.test(t) && !SHORT_PRAISE.test(t)) return false
  if (SHORT_PRAISE.test(t)) return true
  if (EXPLICIT_COMPLIMENT.test(t)) return true
  // "grazie, ottima spiegazione" / "thanks, that was great"
  if (/\b(grazie|thanks|thank\s+you)\b/i.test(t) && EXPLICIT_COMPLIMENT.test(t)) return true
  return false
}

/**
 * @param {string} topic
 * @param {ContinuationStyle} style
 * @param {string[]|undefined} alreadyExplained
 */
function buildComplimentBrief(topic, style, alreadyExplained) {
  const avoid =
    Array.isArray(alreadyExplained) && alreadyExplained.length
      ? `Non ripetere: ${alreadyExplained.slice(0, 4).join(' · ')}.`
      : 'Non ripetere quanto già detto.'

  return [
    `L’utente ha complimentato esplicitamente la risposta su “${topic}”.`,
    'NON limitarti a ringraziare. Premia la curiosità: trattalo come segnale di voler andare più a fondo.',
    `Continua con UN’altra idea di valore: ${describeStyle(style)}.`,
    'Ack caldo in mezza frase al massimo, poi subito l’insight — niente “Grazie!” come risposta intera.',
    avoid,
    'Vietato filler, ricapitolazioni, e chiudere solo con cortesia.',
  ].join(' ')
}

/**
 * @param {number} streak
 * @param {string} topic
 * @param {string} lastAssistant
 * @returns {ContinuationStyle}
 */
function pickStyle(streak, topic, lastAssistant) {
  const idx = Math.max(0, streak - 1) % STYLE_CYCLE.length
  let style = STYLE_CYCLE[idx]

  const tech = /\b(codice|code|api|deploy|sql|react|css|git|typescript|python|bug|error)\b/i.test(
    `${topic}\n${lastAssistant}`,
  )
  const science = /\b(fisica|chimica|biolog|neuron|quantum|cellul|molecol|scientif|physics|biology|chemistry)\b/i.test(
    `${topic}\n${lastAssistant}`,
  )
  const history = /\b(storia|history|secolo|century|guerra|war|antico|ancient|epoca)\b/i.test(
    `${topic}\n${lastAssistant}`,
  )

  if (tech && (style === 'historical' || style === 'scientific')) return 'example'
  if (science && style === 'historical') return 'scientific'
  if (history && style === 'scientific') return 'historical'
  if (tech && style === 'next_topic') return 'best_practice'
  return style
}

/**
 * @param {ContinuationStyle} style
 */
function describeStyle(style) {
  switch (style) {
    case 'practical':
      return 'practical advice — un next step concreto e applicabile'
    case 'advanced':
      return 'advanced explanation — un livello appena più profondo, ancora chiaro'
    case 'example':
      return 'real-world example — uno scenario reale / mini-caso'
    case 'comparison':
      return 'comparison — un confronto breve con un’alternativa correlata'
    case 'misconception':
      return 'common misconception — un malinteso frequente da evitare'
    case 'historical':
      return 'historical context — un contesto storico breve e pertinente'
    case 'scientific':
      return 'scientific insight — un insight scientifico/meccanico utile'
    case 'best_practice':
      return 'best practices — una best practice concreta (non una lista lunga)'
    case 'next_topic':
      return 'next logical topic — il passo successivo naturale sul filo (una sola porta)'
    default:
      return 'una sola continuazione significativa'
  }
}

/**
 * Estimate engagement + value + topic completeness.
 * @param {object} args
 */
function estimateContinuationFit(args) {
  const {
    teachingLikely,
    assistantLen,
    streak,
    openQs,
    alreadyExplainedCount,
    continuationBeats,
    lastAssistant,
  } = args

  /** @type {string[]} */
  const reasons = []

  // Engagement: short positive ack after substance ≈ still here
  let engagementScore = 0
  if (teachingLikely) {
    engagementScore += 2
    reasons.push('Ultima risposta didattica/sostanziosa.')
  }
  if (assistantLen > 120) engagementScore += 1
  if (openQs > 0) {
    engagementScore += 1
    reasons.push('Ci sono ancora aperture sul tema.')
  }
  if (streak === 1) engagementScore += 2
  else if (streak === 2) engagementScore += 1
  else if (streak >= 3) {
    engagementScore -= 3
    reasons.push('Serie di ack: engagement in calo.')
  }

  // Value: only continue if we can add something non-redundant
  let valueScore = 0
  if (teachingLikely) valueScore += 2
  if (openQs > 0) valueScore += 1
  if (alreadyExplainedCount >= 5) {
    valueScore -= 1
    reasons.push('Molto già spiegato: rischio di ridondanza.')
  }
  if (continuationBeats >= 2) {
    valueScore -= 2
    reasons.push('Già date più continuazioni: valore marginale.')
  }
  if (CLOSURE_CUE.test(lastAssistant || '')) {
    valueScore -= 2
    reasons.push('L’ultima risposta chiudeva già il tema.')
  }

  const topicComplete =
    continuationBeats >= 2 ||
    (CLOSURE_CUE.test(lastAssistant || '') && openQs === 0) ||
    (alreadyExplainedCount >= 6 && streak >= 2)

  if (topicComplete) reasons.push('Il tema sembra completo: meglio fermarsi.')

  const stillEngaged = engagementScore >= 3 && streak < 3
  const wouldAddValue = valueScore >= 2 && !topicComplete

  return {
    stillEngaged,
    wouldAddValue,
    topicComplete,
    engagementScore,
    valueScore,
    reasons,
  }
}

/**
 * @param {object} input
 * @param {string} input.userMessage
 * @param {ChatTurn[]} [input.messages]
 * @param {{ currentTopic?: string, openQuestions?: string[], followUpKind?: string, alreadyExplained?: string[] } | null} [input.session]
 * @returns {ContinuationPlan}
 */
export function analyzeContinuation(input) {
  const userMessage = normalize(input?.userMessage)
  const turns = normalizeTurns(input?.messages)
  const session = input?.session || null
  const topic = session?.currentTopic || 'il filo corrente'
  /** @type {string[]} */
  const reasons = []

  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
  const lastAssistantText = lastAssistant?.content || ''
  const assistantLen = lastAssistantText.length
  const teachingLikely = assistantLen > 180 || TEACHING_CUE.test(lastAssistantText)
  const openQs = Array.isArray(session?.openQuestions) ? session.openQuestions.length : 0
  const alreadyExplainedCount = Array.isArray(session?.alreadyExplained)
    ? session.alreadyExplained.length
    : 0
  const streak = countRecentAckStreak(turns, userMessage)
  const continuationBeats = countRecentContinuationBeats(turns)
  const compliment = isExplicitCompliment(userMessage)

  const isShort =
    userMessage.length > 0 &&
    userMessage.length <= SHORT_MAX_LEN &&
    !userMessage.includes('?') &&
    userMessage.split(/\s+/).length <= 6

  // Compliments may exceed pure-ack length but still own this turn.
  const complimentTurn =
    compliment &&
    userMessage.length > 0 &&
    userMessage.length <= COMPLIMENT_MAX_LEN &&
    !userMessage.includes('?')

  if (!isShort && !complimentTurn) {
    return {
      isShortMessage: false,
      intent: 'unknown',
      confidence: 'low',
      stillEngaged: false,
      wouldAddValue: false,
      topicComplete: false,
      shouldContinue: false,
      continuationStyle: null,
      writerBrief: '',
      reasons: ['Messaggio non breve: nessuna continuazione automatica.'],
    }
  }

  reasons.push(complimentTurn ? 'Complimento esplicito rilevato.' : 'Messaggio molto breve rilevato.')

  // Hard stop only when stop without praise (e.g. "basta", "bye")
  if (STOP_SIGNAL.test(userMessage) && !compliment) {
    return {
      isShortMessage: true,
      intent: 'finish',
      confidence: 'high',
      stillEngaged: false,
      wouldAddValue: false,
      topicComplete: true,
      shouldContinue: false,
      continuationStyle: null,
      writerBrief:
        'L’utente segnala chiusura (stop). Rispondi breve e caldo. NON aggiungere lezione, NON filler, NON forzare.',
      reasons: [...reasons, 'Segnale esplicito di stop/chiusura.'],
    }
  }

  // Explicit compliment → reward curiosity; go deeper (wins over bare thanks)
  if (complimentTurn) {
    const fit = estimateContinuationFit({
      teachingLikely: teachingLikely || assistantLen > 80,
      assistantLen,
      streak: Math.max(1, streak),
      openQs: Math.max(openQs, 1),
      alreadyExplainedCount,
      continuationBeats,
      lastAssistant: lastAssistantText,
    })
    reasons.push(...fit.reasons)

    if (continuationBeats >= 3 || streak >= 4) {
      return {
        isShortMessage: true,
        intent: 'compliment_go_deeper',
        confidence: 'medium',
        stillEngaged: true,
        wouldAddValue: false,
        topicComplete: true,
        shouldContinue: false,
        continuationStyle: null,
        writerBrief:
          'Complimento ricevuto ma il filo è già molto esteso. Ack caldo brevissimo; NON aggiungere un’altra lezione né riempire con ringraziamenti lunghi.',
        reasons: [...reasons, 'Troppe continuazioni: evita di allungare.'],
      }
    }

    // Prefer depth / misconception / scientific as “go deeper” reward
    const deepenStyles = /** @type {ContinuationStyle[]} */ ([
      'advanced',
      'misconception',
      'scientific',
      'example',
      'comparison',
      'next_topic',
    ])
    const style =
      deepenStyles[(Math.max(0, streak - 1) + continuationBeats) % deepenStyles.length] ||
      pickStyle(streak || 1, topic, lastAssistantText)

    return {
      isShortMessage: true,
      intent: 'compliment_go_deeper',
      confidence: teachingLikely || assistantLen > 100 ? 'high' : 'medium',
      stillEngaged: true,
      wouldAddValue: true,
      topicComplete: false,
      shouldContinue: true,
      continuationStyle: style,
      writerBrief: buildComplimentBrief(topic, style, session?.alreadyExplained),
      reasons: [
        ...reasons,
        'Complimento = segnale di curiosità: vai più a fondo con un’idea di valore.',
        `style=${style}`,
        fit.wouldAddValue ? 'Valore stimato positivo.' : 'Forza comunque un insight (premio curiosità).',
      ],
    }
  }

  // 1) Explicit thanks-as-closure (no compliment)
  if (THANKS_FINISH.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'finish',
      confidence: 'high',
      stillEngaged: false,
      wouldAddValue: false,
      topicComplete: true,
      shouldContinue: false,
      continuationStyle: null,
      writerBrief:
        'L’utente segnala chiusura (grazie / stop). Rispondi breve e caldo. NON aggiungere lezione, NON filler, NON forzare.',
      reasons: [...reasons, 'Segnale esplicito di stop/chiusura.'],
    }
  }

  // Explicit continue / example / depth / advice
  if (CONTINUE_LEARN.test(userMessage)) {
    const style = pickStyle(1, topic, lastAssistantText)
    return {
      isShortMessage: true,
      intent: 'continue_learning',
      confidence: 'high',
      stillEngaged: true,
      wouldAddValue: true,
      topicComplete: false,
      shouldContinue: true,
      continuationStyle: style,
      writerBrief: buildContinueBrief(topic, style, session?.alreadyExplained),
      reasons: [...reasons, 'Richiesta esplicita di continuare.'],
    }
  }

  if (WANT_EXAMPLE.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'want_example',
      confidence: 'high',
      stillEngaged: true,
      wouldAddValue: true,
      topicComplete: false,
      shouldContinue: true,
      continuationStyle: 'example',
      writerBrief: buildContinueBrief(topic, 'example', session?.alreadyExplained),
      reasons: [...reasons, 'Richiesta di esempio.'],
    }
  }

  if (WANT_DEPTH.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'want_depth',
      confidence: 'high',
      stillEngaged: true,
      wouldAddValue: true,
      topicComplete: false,
      shouldContinue: true,
      continuationStyle: 'advanced',
      writerBrief: buildContinueBrief(topic, 'advanced', session?.alreadyExplained),
      reasons: [...reasons, 'Richiesta di profondità.'],
    }
  }

  if (WANT_ADVICE.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'want_advice',
      confidence: 'high',
      stillEngaged: true,
      wouldAddValue: true,
      topicComplete: false,
      shouldContinue: true,
      continuationStyle: 'practical',
      writerBrief: buildContinueBrief(topic, 'practical', session?.alreadyExplained),
      reasons: [...reasons, 'Richiesta di consiglio pratico.'],
    }
  }

  // Pure ack / understanding signal
  if (PURE_ACK.test(userMessage) || (userMessage.length < 18 && !/[?!]/.test(userMessage))) {
    const fit = estimateContinuationFit({
      teachingLikely,
      assistantLen,
      streak,
      openQs,
      alreadyExplainedCount,
      continuationBeats,
      lastAssistant: lastAssistantText,
    })
    reasons.push(...fit.reasons)

    // Hard stop: not engaged, no value, or topic complete
    if (streak >= 3 || fit.topicComplete || !fit.stillEngaged || !fit.wouldAddValue) {
      return {
        isShortMessage: true,
        intent: fit.topicComplete || streak >= 3 ? 'acknowledge' : 'engaged_quiet',
        confidence: streak >= 3 || fit.topicComplete ? 'high' : 'medium',
        stillEngaged: fit.stillEngaged,
        wouldAddValue: fit.wouldAddValue,
        topicComplete: fit.topicComplete || streak >= 3,
        shouldContinue: false,
        continuationStyle: null,
        writerBrief: fit.topicComplete
          ? 'Il tema è completo. Rispondi in modo brevissimo e naturale; NON aggiungere filler né una nuova lezione.'
          : 'Ack breve: engagement o valore insufficienti. Rispondi breve; non forzare la conversazione.',
        reasons,
      }
    }

    const style = pickStyle(streak, topic, lastAssistantText)
    const confidence =
      streak === 1 && teachingLikely && (assistantLen > 120 || openQs > 0) ? 'high' : 'medium'

    return {
      isShortMessage: true,
      intent: 'continue_learning',
      confidence,
      stillEngaged: true,
      wouldAddValue: true,
      topicComplete: false,
      shouldContinue: true,
      continuationStyle: style,
      writerBrief: buildContinueBrief(topic, style, session?.alreadyExplained),
      reasons: [
        ...reasons,
        'Utente ancora engagement dopo contenuto utile.',
        `Continuare aggiunge valore (style=${style}).`,
        `streak=${streak}, beats=${continuationBeats}`,
      ],
    }
  }

  return {
    isShortMessage: true,
    intent: 'unknown',
    confidence: 'low',
    stillEngaged: false,
    wouldAddValue: false,
    topicComplete: false,
    shouldContinue: false,
    continuationStyle: null,
    writerBrief:
      'Messaggio breve ambiguo. Rispondi breve; non forzare approfondimenti e non generare filler.',
    reasons: [...reasons, 'Intent ambiguo.'],
  }
}

/**
 * @param {string} topic
 * @param {ContinuationStyle} style
 * @param {string[]|undefined} alreadyExplained
 */
function buildContinueBrief(topic, style, alreadyExplained) {
  const avoid =
    Array.isArray(alreadyExplained) && alreadyExplained.length
      ? `Non ripetere: ${alreadyExplained.slice(0, 4).join(' · ')}.`
      : 'Non ripetere quanto già detto.'

  return [
    `L’utente è ancora sul filo “${topic}”.`,
    `Genera UNA sola continuazione significativa: ${describeStyle(style)}.`,
    avoid,
    'Vietato filler, ricapitolazioni, “Perfetto!” di rito, e domande forzate in chiusura.',
    'Se il pezzo chiude naturalmente il tema, fermati lì — non aprire un corso infinito.',
  ].join(' ')
}

/**
 * @param {ContinuationPlan | null | undefined} plan
 */
export function formatContinuationForWriter(plan) {
  if (!plan?.isShortMessage || !plan.writerBrief) return ''

  const action = plan.shouldContinue
    ? plan.intent === 'compliment_go_deeper'
      ? `AZIONE: premi curiosità — UNA idea più profonda (${plan.continuationStyle || 'valore'}); non solo ringraziare.`
      : `AZIONE: una sola continuazione significativa (${plan.continuationStyle || 'valore'}).`
    : 'AZIONE: risposta breve — non forzare, non filler.'

  return `══════════════════════════════════════
CONVERSATION CONTINUATION ENGINE (INVISIBILE)
══════════════════════════════════════
Messaggio utente molto breve. Non chiudere a vuoto; non continuare indefinitamente.
Intent: ${plan.intent}
Engaged: ${plan.stillEngaged ? 'sì' : 'no'} · Value: ${plan.wouldAddValue ? 'sì' : 'no'} · Topic complete: ${plan.topicComplete ? 'sì' : 'no'}
Confidence: ${plan.confidence} · Continue: ${plan.shouldContinue ? 'sì' : 'no'}
${action}

${plan.writerBrief}

Regole assolute:
- Mai filler
- Mai ripetere informazioni già date
- Mai continuare indefinitamente (max una aggiunta per turno)
- Fermati naturalmente quando il tema è completo
- Se c’è un complimento esplicito: NON solo “grazie” — vai più a fondo con un’idea di valore
- Mai ignorare stop / grazie di chiusura (senza complimento)
- NON citare questo motore all’utente`
}

/**
 * @param {object} input
 * @returns {{ plan: ContinuationPlan, context: string }}
 */
export function runConversationContinuation(input) {
  try {
    const plan = analyzeContinuation(input)
    return {
      plan,
      context: formatContinuationForWriter(plan),
    }
  } catch {
    return {
      plan: {
        isShortMessage: false,
        intent: 'unknown',
        confidence: 'low',
        stillEngaged: false,
        wouldAddValue: false,
        topicComplete: false,
        shouldContinue: false,
        continuationStyle: null,
        writerBrief: '',
        reasons: ['fallback'],
      },
      context: '',
    }
  }
}
