/**
 * LAIfe Dynamic Behavior Model
 *
 * LAIfe is not a chatbot.
 * LAIfe is an intelligent, adaptive and trustworthy conversation partner.
 *
 * Before every response:
 * 1. Understand real intent
 * 2. Detect emotional tone and conversational energy
 * 3. Note whether memory would genuinely help (retrieval stays in tools)
 * 4. Estimate desired interaction mode
 * 5. Select the most appropriate behavior
 * 6. Hand guidance to the Writer
 *
 * Invisible — never shown to the user.
 */

/**
 * @typedef {'conversation'|'explanation'|'brainstorming'|'planning'|'technical_help'|'emotional_support'|'collaboration'} BehaviorMode
 */

/**
 * @typedef {'low'|'steady'|'high'} ConversationalEnergy
 */

/**
 * @typedef {object} BehaviorPlan
 * @property {boolean} active
 * @property {BehaviorMode} behavior
 * @property {string} realIntent
 * @property {string} emotionalTone
 * @property {ConversationalEnergy} energy
 * @property {boolean} memoryHelpful
 * @property {boolean} shortReply
 * @property {boolean} shouldContinue
 * @property {boolean} teachingMode
 * @property {string} styleBrief
 * @property {string} writerBrief
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {number} confidence
 */

/** @type {readonly BehaviorMode[]} */
export const BEHAVIOR_MODES = Object.freeze([
  'conversation',
  'explanation',
  'brainstorming',
  'planning',
  'technical_help',
  'emotional_support',
  'collaboration',
])

const SHORT_ACK =
  /^(ok+|okay|k|ciao|hey|hi|hello|nice|cool|interesting|interessante|ah|oh|mm+|mhm|got\s+it|capito|chiaro|va\s+bene|bene|perfetto|thanks|grazie|yes|yep|yeah|s[iì]|sure|alright)[\s!.]*$/i

const ENDING_SIGNAL =
  /\b(basta\s+cos[iì]|stop|chiudiamo|that'?s\s+all|nient['’]altro|sono\s+a\s+posto|all\s+good|fine\s+cos[iì]|grazie\s+mille)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Soft preference bias from legacy personalization modes (optional).
 * @param {string} [personality]
 * @returns {Partial<Record<BehaviorMode, number>>}
 */
export function biasFromPersonality(personality) {
  switch (personality) {
    case 'friendly':
      return { conversation: 0.15, emotional_support: 0.1 }
    case 'professional':
      return { planning: 0.12, technical_help: 0.08, collaboration: 0.05 }
    case 'teacher':
      return { explanation: 0.2, collaboration: 0.05 }
    case 'analytical':
      return { technical_help: 0.12, explanation: 0.1, planning: 0.08 }
    case 'motivational':
      return { emotional_support: 0.12, planning: 0.08, brainstorming: 0.05 }
    default:
      return {}
  }
}

/**
 * Step 1 — real intent (beyond surface wording).
 * @param {string} userMessage
 * @param {object} [understanding]
 * @param {object} [session]
 */
export function inferRealIntent(userMessage, understanding, session) {
  const text = normalize(userMessage)
  const primary = understanding?.primaryIntent || ''
  const topic = session?.currentTopic || understanding?.topic || ''

  if (SHORT_ACK.test(text)) {
    if (ENDING_SIGNAL.test(text) || /^(grazie|thanks)/i.test(text)) {
      return 'Chiudere o riconoscere — non forzare continuazione'
    }
    if (topic) return `Seguire il filo su «${topic}» solo se c’è valore chiaro`
    return 'Ack breve — valutare se continuare ha senso'
  }

  if (primary === 'problem_solving' || /\b(fix|debug|non\s+funziona|bug|errore)\b/i.test(text)) {
    return 'Sbloccare un problema concreto'
  }
  if (primary === 'how_to' || primary === 'explanation') {
    return 'Capire / saper fare qualcosa con chiarezza'
  }
  if (/\b(brainstorm|idee|ideas|what\s+if|e\s+se)\b/i.test(text)) {
    return 'Esplorare possibilità insieme'
  }
  if (/\b(piano|plan|roadmap|organizza|schedule|priorit)\b/i.test(text)) {
    return 'Mettere ordine e definire passi'
  }
  if (
    /\b(mi\s+sento|sono\s+giù|ansios|stress|paura|frustrat|overwhelm|non\s+ce\s+la\s+faccio)\b/i.test(
      text,
    )
  ) {
    return 'Sentirsi ascoltato e sostenuto'
  }
  if (/\b(insieme|collabor|pair|lavoriamo|let'?s\s+build|costruiamo)\b/i.test(text)) {
    return 'Collaborare attivamente sul pezzo'
  }
  if (understanding?.realGoal) return String(understanding.realGoal).slice(0, 160)
  if (primary && primary !== 'conversation') return `Servire intent: ${primary}`
  return 'Conversare in modo naturale e utile'
}

/**
 * Step 2 — emotional tone + energy.
 * @param {string} userMessage
 * @param {object} [understanding]
 */
export function detectToneAndEnergy(userMessage, understanding) {
  const text = normalize(userMessage)
  const tone = understanding?.emotionalTone || 'neutral'
  /** @type {ConversationalEnergy} */
  let energy = 'steady'

  if (
    tone === 'excited' ||
    tone === 'curious' ||
    (text.match(/!/g) || []).length >= 2 ||
    /\b(yay|super|andiamo|let'?s\s+go)\b/i.test(text)
  ) {
    energy = 'high'
  } else if (
    tone === 'frustrated' ||
    tone === 'anxious' ||
    tone === 'disappointed' ||
    text.length < 20 ||
    SHORT_ACK.test(text)
  ) {
    energy = 'low'
  } else if (text.length > 220 || /\b(dettagli|approfond|in\s+depth)\b/i.test(text)) {
    energy = 'steady'
  }

  return { emotionalTone: tone, energy }
}

/**
 * Step 3 — would memory genuinely improve this turn?
 * (Actual retrieval remains orchestrator/tools — this only gates usefulness.)
 * @param {string} userMessage
 * @param {object} [session]
 * @param {object} [understanding]
 */
export function estimateMemoryHelpful(userMessage, session, understanding) {
  const text = normalize(userMessage)
  if (SHORT_ACK.test(text) && text.length < 24) return false
  if (/\b(ricordi|remember|come\s+dicevamo|il\s+mio\s+progetto|my\s+project|preferisc)\b/i.test(text)) {
    return true
  }
  if (session?.currentGoal && text.length > 40) return true
  if (understanding?.primaryIntent === 'advice' || understanding?.primaryIntent === 'problem_solving') {
    return true
  }
  return false
}

/**
 * Step 4 — score desired interaction modes.
 * @param {string} userMessage
 * @param {object} [understanding]
 * @param {Partial<Record<BehaviorMode, number>>} [bias]
 * @returns {Record<BehaviorMode, number>}
 */
export function scoreBehaviorModes(userMessage, understanding, bias = {}) {
  const text = normalize(userMessage)
  const primary = understanding?.primaryIntent || ''
  /** @type {Record<BehaviorMode, number>} */
  const scores = {
    conversation: 0.35,
    explanation: 0.2,
    brainstorming: 0.15,
    planning: 0.15,
    technical_help: 0.2,
    emotional_support: 0.1,
    collaboration: 0.15,
  }

  if (primary === 'greeting' || primary === 'thanks' || primary === 'conversation') {
    scores.conversation += 0.45
  }
  if (primary === 'explanation' || primary === 'how_to' || primary === 'question') {
    scores.explanation += 0.4
  }
  if (primary === 'problem_solving' || primary === 'creation') {
    scores.technical_help += 0.35
    scores.collaboration += 0.15
  }
  if (primary === 'advice') {
    scores.planning += 0.2
    scores.collaboration += 0.15
    scores.conversation += 0.1
  }

  if (/\b(brainstorm|idee|ideas|opzioni|alternativ|what\s+if)\b/i.test(text)) {
    scores.brainstorming += 0.55
  }
  if (/\b(piano|plan|roadmap|organizza|priorit|timeline|step\s+by\s+step)\b/i.test(text)) {
    scores.planning += 0.5
  }
  if (
    /\b(codice|code|typescript|react|api|bug|debug|stack\s*trace|compile|deploy|git)\b/i.test(text)
  ) {
    scores.technical_help += 0.55
  }
  if (
    /\b(mi\s+sento|sono\s+gi[uù]|ansios\w*|stress\w*|paura|frustrat\w*|overwhelm\w*|deluso|triste|esaurit\w*)\b/i.test(
      text,
    )
  ) {
    scores.emotional_support += 0.85
    scores.conversation -= 0.2
  }
  if (/\b(insieme|collabor|pair|lavoriamo|costruiamo|let'?s\s+(?:build|do|make))\b/i.test(text)) {
    scores.collaboration += 0.5
  }
  if (/\b(spieg|explain|perch|why|come\s+funziona|what\s+is|cos['']è)\b/i.test(text)) {
    scores.explanation += 0.35
  }

  if (SHORT_ACK.test(text)) {
    scores.conversation += 0.4
    scores.technical_help -= 0.15
    scores.explanation -= 0.1
  }

  for (const mode of BEHAVIOR_MODES) {
    scores[mode] += bias[mode] || 0
  }

  return scores
}

/**
 * @param {Record<BehaviorMode, number>} scores
 * @returns {{ behavior: BehaviorMode, confidence: number }}
 */
export function selectTopBehavior(scores) {
  /** @type {BehaviorMode} */
  let best = 'conversation'
  let bestScore = -Infinity
  for (const mode of BEHAVIOR_MODES) {
    if (scores[mode] > bestScore) {
      bestScore = scores[mode]
      best = mode
    }
  }
  const sorted = [...BEHAVIOR_MODES].sort((a, b) => scores[b] - scores[a])
  const second = scores[sorted[1]] || 0
  const confidence = Math.max(0.35, Math.min(0.95, 0.5 + (bestScore - second) * 0.25))
  return { behavior: best, confidence }
}

/**
 * Short-reply continuity policy.
 * @param {string} userMessage
 * @param {object} [session]
 * @param {object} [continuation]
 */
export function evaluateShortReplyContinuity(userMessage, session, continuation) {
  const text = normalize(userMessage)
  const shortReply = text.length < 48 && (SHORT_ACK.test(text) || text.split(/\s+/).length <= 4)
  if (!shortReply) {
    return { shortReply: false, shouldContinue: true }
  }

  if (ENDING_SIGNAL.test(text) || /^(grazie|thanks|bye|ciao\s*$)/i.test(text)) {
    return { shortReply: true, shouldContinue: false }
  }

  if (continuation && typeof continuation.shouldContinue === 'boolean') {
    return { shortReply: true, shouldContinue: Boolean(continuation.shouldContinue) }
  }

  // Continue only if there is an open thread with clear value
  const hasThread =
    Boolean(session?.currentTopic) ||
    (Array.isArray(session?.openQuestions) && session.openQuestions.length > 0)
  return { shortReply: true, shouldContinue: hasThread }
}

/**
 * @param {BehaviorMode} behavior
 * @param {object} ctx
 */
function buildStyleBrief(behavior, ctx) {
  const { energy, emotionalTone, teachingMode } = ctx
  const lines = [
    'LAIfe non è un chatbot: è un partner di conversazione intelligente, adattivo e affidabile.',
    'Ottimizza per far sentire l’utente compreso — non solo “risposto”.',
    'Adattati in modo naturale; niente regole rigide da personaggio.',
    'Matcha lo stile di scrittura dell’utente (ritmo, formalità, densità).',
    energy === 'high'
      ? 'Energia utente alta: puoi essere più vivo, senza forzare entusiasmo.'
      : energy === 'low'
        ? 'Energia utente bassa: calmo, essenziale, senza monologhi.'
        : 'Energia stabile: ritmo naturale, frasi corte e lunghe alternate.',
    'Whitespace quando migliora la leggibilità. Niente aperture/chiusure ripetitive.',
    'Niente humor o emoji forzati — solo se calzano davvero.',
    `Tono emotivo rilevato: ${emotionalTone} — rispondi con presenza, senza fingere emozioni.`,
  ]

  if (teachingMode) {
    lines.push(
      'Teaching: costruisci comprensione progressiva; collega idee; anticipa dubbi comuni; esempi pratici; concetti avanzati per gradi.',
    )
  }

  /** @type {Record<BehaviorMode, string>} */
  const modeLine = {
    conversation: 'Comportamento: conversazione — fluido, umano, ascolto attivo.',
    explanation: 'Comportamento: spiegazione — chiarezza progressiva, non dump.',
    brainstorming: 'Comportamento: brainstorming — opzioni vive, senza giudicare troppo presto.',
    planning: 'Comportamento: planning — priorità, sequenza, prossimo passo concreto.',
    technical_help: 'Comportamento: aiuto tecnico — preciso, verificabile, orientato allo sblocco.',
    emotional_support:
      'Comportamento: supporto emotivo — prima comprensione, poi eventuale consiglio utile.',
    collaboration: 'Comportamento: collaborazione — lavora “insieme”, proponi e itera.',
  }
  lines.push(modeLine[behavior])
  return lines.join(' ')
}

/**
 * @param {BehaviorMode} behavior
 * @param {object} ctx
 */
function buildResponseHints(behavior, ctx) {
  /** @type {string[]} */
  const hints = [
    'Inizia già nel merito — l’utente deve sentirsi capito dalla prima frase',
    'Varia ritmo e lunghezza frasi; evita formule ripetute',
  ]

  if (ctx.shortReply && !ctx.shouldContinue) {
    return [
      'Risposta brevissima e naturale',
      'Non forzare la conversazione — segnale di chiusura/ack rispettato',
    ]
  }
  if (ctx.shortReply && ctx.shouldContinue) {
    hints.push('Ack breve + UNA sola continuazione di valore (progetto/filo aperto)')
    hints.push('Mai allungare solo per riempire')
  }

  switch (behavior) {
    case 'explanation':
      hints.push('Idea centrale → perché → come → esempio')
      hints.push('Anticipa un dubbio comune')
      if (ctx.teachingMode) hints.push('Rivela il livello avanzato solo dopo le basi')
      break
    case 'brainstorming':
      hints.push('2–4 direzioni vive, poi chiedi quale esplorare (al massimo una domanda)')
      break
    case 'planning':
      hints.push('Ordine chiaro + primo passo oggi')
      break
    case 'technical_help':
      hints.push('Diagnosi o fix concreto; niente gergo superfluo')
      break
    case 'emotional_support':
      hints.push('Rifletti il sentire in una frase; poi un sostegno utile se appropriato')
      break
    case 'collaboration':
      hints.push('Proponi il pezzo successivo come se lavoraste sullo stesso tavolo')
      break
    default:
      hints.push('Tono da partner intelligente: autentico, fluido, umano')
  }

  if (ctx.memoryHelpful) {
    hints.push('Usa memoria solo se migliora davvero questa risposta')
  } else {
    hints.push('Non richiamare memorie a caso')
  }

  return hints
}

/**
 * Build the dynamic behavior plan for this turn.
 * @param {object} input
 * @returns {BehaviorPlan}
 */
export function buildBehaviorPlan(input) {
  const userMessage = normalize(input?.userMessage)
  const understanding = input?.understanding || null
  const session = input?.session || null
  const continuation = input?.continuation || null
  const bias = biasFromPersonality(input?.personalityBias)

  /** @type {string[]} */
  const reasons = []

  const realIntent = inferRealIntent(userMessage, understanding, session)
  reasons.push(`Intent reale: ${realIntent}`)

  const { emotionalTone, energy } = detectToneAndEnergy(userMessage, understanding)
  reasons.push(`Tono: ${emotionalTone}; energia: ${energy}`)

  const memoryHelpful = estimateMemoryHelpful(userMessage, session, understanding)
  reasons.push(memoryHelpful ? 'Memoria potrebbe aiutare.' : 'Memoria non necessaria ora.')

  const scores = scoreBehaviorModes(userMessage, understanding, bias)
  const { behavior, confidence } = selectTopBehavior(scores)
  reasons.push(`Behavior: ${behavior} (conf ${confidence.toFixed(2)})`)

  const { shortReply, shouldContinue } = evaluateShortReplyContinuity(
    userMessage,
    session,
    continuation,
  )
  if (shortReply) {
    reasons.push(shouldContinue ? 'Short reply: continua con valore.' : 'Short reply: non forzare.')
  }

  const teachingMode =
    (behavior === 'explanation' || behavior === 'technical_help') &&
    (understanding?.complexity === 'high' ||
      understanding?.complexity === 'medium' ||
      /\b(spieg|explain|come\s+funziona|perch)\b/i.test(userMessage))

  const styleBrief = buildStyleBrief(behavior, { energy, emotionalTone, teachingMode })
  const responseHints = buildResponseHints(behavior, {
    shortReply,
    shouldContinue,
    memoryHelpful,
    teachingMode,
  })

  const writerBrief = [
    'DYNAMIC BEHAVIOR MODEL (invisibile): seleziona comportamento turn-by-turn — non personalità fissa.',
    `Intent reale: ${realIntent}.`,
    `Behavior: ${behavior}. Energia: ${energy}. Tono: ${emotionalTone}.`,
    styleBrief,
    shortReply && !shouldContinue
      ? 'Short reply con segnale di stop: chiudi naturale e breve.'
      : shortReply && shouldContinue
        ? 'Short reply: continua solo con valore; riprendi progetti aperti se pertinente.'
        : '',
    teachingMode ? 'Attiva teaching progressivo su questo turno.' : '',
    'NON citare Dynamic Behavior Model, behavior id o scoring all’utente.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    active: true,
    behavior,
    realIntent,
    emotionalTone,
    energy,
    memoryHelpful,
    shortReply,
    shouldContinue,
    teachingMode,
    styleBrief,
    writerBrief,
    responseHints,
    reasons,
    confidence,
  }
}

/**
 * @param {BehaviorPlan} plan
 */
export function formatBehaviorForWriter(plan) {
  if (!plan?.active) return ''

  const hints = (plan.responseHints || []).map((h, i) => `${i + 1}. ${h}`).join('\n')

  return `══════════════════════════════════════
DYNAMIC BEHAVIOR MODEL (INVISIBILE)
══════════════════════════════════════
LAIfe = partner intelligente, adattivo, affidabile — non chatbot.
Obiettivo: far sentire l’utente compreso; conversazione autentica, fluida, umana.

Intent reale: ${plan.realIntent}
Behavior: ${plan.behavior} (confidenza ${plan.confidence.toFixed(2)})
Tono: ${plan.emotionalTone} · Energia: ${plan.energy}
Memoria utile: ${plan.memoryHelpful ? 'sì (solo se migliora)' : 'no'}
Short reply: ${plan.shortReply ? (plan.shouldContinue ? 'continua con valore' : 'non forzare') : 'no'}
Teaching: ${plan.teachingMode ? 'sì' : 'no'}

${plan.writerBrief}

Hint risposta:
${hints}

Regole assolute:
- Adattati, non recitare una personalità fissa
- Niente aperture/chiusure scriptate
- Continua short reply solo se aggiunge valore
- Insegna per gradi quando serve
- NON citare questo modello`
}

/**
 * @param {object} input
 * @returns {{ plan: BehaviorPlan, context: string }}
 */
export function runDynamicBehaviorModel(input) {
  try {
    const plan = buildBehaviorPlan(input || {})
    return { plan, context: formatBehaviorForWriter(plan) }
  } catch {
    return {
      plan: {
        active: false,
        behavior: 'conversation',
        realIntent: '',
        emotionalTone: 'neutral',
        energy: 'steady',
        memoryHelpful: false,
        shortReply: false,
        shouldContinue: true,
        teachingMode: false,
        styleBrief: '',
        writerBrief: '',
        responseHints: [],
        reasons: ['fallback'],
        confidence: 0,
      },
      context: '',
    }
  }
}
