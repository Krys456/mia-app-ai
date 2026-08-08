/**
 * LAIfe Conversation Momentum
 *
 * Every response should preserve conversational flow.
 * Before finishing, evaluate:
 * 1. Is the discussion naturally complete?
 * 2. Is there an obvious valuable continuation?
 * 3. Would stopping here feel abrupt?
 * 4. Would continuing become repetitive?
 *
 * If a valuable continuation exists → add ONE concise, high-quality continuation.
 * If not → end naturally.
 * Never continue merely to increase response length.
 *
 * Invisible. No factual memory writes. Fail-soft.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'practical_next'|'open_thread'|'edge_caution'|'deeper_bridge'|'none'} MomentumContinuationKind
 */

/**
 * @typedef {object} MomentumEvaluation
 * @property {boolean} naturallyComplete
 * @property {boolean} valuableContinuation
 * @property {boolean} stoppingAbrupt
 * @property {boolean} continuingRepetitive
 */

/**
 * @typedef {object} MomentumPlan
 * @property {boolean} shouldContinue
 * @property {MomentumContinuationKind} continuationKind
 * @property {string} continuationHint
 * @property {MomentumEvaluation} evaluation
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 */

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const THANKS_FINISH =
  /^(grazie(\s+(mille|tante|ancora))?|thanks(\s+a\s+lot)?|thank\s+you(\s+so\s+much)?|thx|ty)([\s!,.]*(ok|okay|bye|ciao)?)?[\s!.]*$/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const MINIMAL_ASK =
  /\b(in\s+breve|veloce|quick|tl;?dr|solo\s+s[iì]|yes\s+or\s+no|risposta\s+breve)\b/i

const CLOSURE_CUE =
  /\b(in\s+sintesi|per\s+concludere|ricapitolando|to\s+sum\s+up|in\s+summary|that'?s\s+the\s+idea|ed\s+è\s+tutto|e\s+basta\s+così)\b/i

const TEACHING_CUE =
  /\b(perché|perche|come\s+funziona|in\s+pratica|ad\s+esempio|per\s+esempio|passo|step|differenza|significa|quindi|for\s+example|because|means)\b/i

const OPEN_LOOP =
  /\b(poi|successivamente|next|dopo\s+aver|una\s+volta|se\s+vuoi|potresti|you\s+(can|could|might)|opzionale)\b/i

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
 * Recent assistant beats that already look like momentum/curiosity codas.
 * @param {ChatTurn[]} turns
 */
function countRecentMomentumBeats(turns) {
  let beats = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role === 'user') {
      if (t.content.length < 40) continue
      break
    }
    if (t.role === 'assistant') {
      if (
        /(pu[oò]\s+esserti\s+utile|un\s+dettaglio|fai\s+attenzione|passo\s+in\s+pi[uù]|💡|📌|⚠️|🚀)/i.test(
          t.content,
        ) ||
        (t.content.length > 100 && t.content.length < 700)
      ) {
        beats += 1
      }
      if (beats >= 3) break
    }
  }
  return beats
}

/**
 * Pick a concrete continuation kind when momentum says continue.
 * @param {object} args
 * @returns {{ kind: MomentumContinuationKind, hint: string }}
 */
function pickContinuation(args) {
  const { openQuestions, teachingLikely, intent, topic, alreadyExplainedCount } = args
  const label = topic && topic !== 'generale' ? topic : 'il filo corrente'

  if (Array.isArray(openQuestions) && openQuestions[0]) {
    return {
      kind: 'open_thread',
      hint: `Chiudi o avanza di un passo sul filo aperto: ${normalize(openQuestions[0])}`,
    }
  }

  if (intent === 'how_to' || intent === 'problem_solving') {
    return {
      kind: 'practical_next',
      hint: `Un next step pratico conciso su ${label} (una sola mossa utile, non una checklist)`,
    }
  }

  if (intent === 'advice' || intent === 'comparison') {
    return {
      kind: 'edge_caution',
      hint: `Un rischio / trade-off concreto da non ignorare su ${label}`,
    }
  }

  if (teachingLikely || intent === 'explanation') {
    if (alreadyExplainedCount >= 4) {
      return {
        kind: 'edge_caution',
        hint: `Un errore comune ad alto segnale su ${label} (una frase)`,
      }
    }
    return {
      kind: 'deeper_bridge',
      hint: `Un ponte conciso verso il pezzo successivo naturale di ${label} — senza rifare la lezione`,
    }
  }

  return {
    kind: 'practical_next',
    hint: `Una sola continuazione di valore sul filo (${label})`,
  }
}

/**
 * Core momentum evaluation.
 * @param {object} input
 * @returns {MomentumPlan}
 */
export function analyzeMomentum(input) {
  const userMessage = normalize(input?.userMessage)
  const turns = normalizeTurns(input?.messages)
  const session = input?.session || null
  const planHints = input?.planHints || null
  const continuation = input?.continuation || null
  /** @type {string[]} */
  const reasons = []

  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')?.content || ''
  const openQuestions = Array.isArray(session?.openQuestions) ? session.openQuestions : []
  const alreadyExplainedCount = Array.isArray(session?.alreadyExplained)
    ? session.alreadyExplained.length
    : 0
  const momentumBeats = countRecentMomentumBeats(turns)
  const intent = planHints?.primaryIntent || 'question'
  const teachingLikely =
    planHints?.teachingLikely === true ||
    TEACHING_CUE.test(lastAssistant) ||
    intent === 'explanation'

  // Hard stops — end naturally
  if (!userMessage || STOP_SIGNAL.test(userMessage) || THANKS_FINISH.test(userMessage)) {
    return endNaturally('Chiusura / grazie: fermati naturalmente.', {
      naturallyComplete: true,
      valuableContinuation: false,
      stoppingAbrupt: false,
      continuingRepetitive: true,
    })
  }

  if (GREETING_ONLY.test(userMessage) || intent === 'greeting' || intent === 'thanks') {
    return endNaturally('Saluto / thanks: niente coda di lunghezza.', {
      naturallyComplete: true,
      valuableContinuation: false,
      stoppingAbrupt: false,
      continuingRepetitive: false,
    })
  }

  // Short-ack path owned by Conversation Continuation
  if (continuation?.isShortMessage) {
    return endNaturally('Ack breve: Conversation Continuation gestisce il momentum di questo turno.', {
      naturallyComplete: !continuation.shouldContinue,
      valuableContinuation: Boolean(continuation.shouldContinue),
      stoppingAbrupt: false,
      continuingRepetitive: false,
    })
  }

  if (planHints?.keepFast || MINIMAL_ASK.test(userMessage)) {
    return endNaturally('Richiesta di sintesi / velocità: non allungare.', {
      naturallyComplete: true,
      valuableContinuation: false,
      stoppingAbrupt: false,
      continuingRepetitive: true,
    })
  }

  if (
    planHints?.emotionalTone === 'frustrated' ||
    planHints?.emotionalTone === 'anxious' ||
    planHints?.emotionalTone === 'urgent'
  ) {
    return endNaturally('Tono carico: completa la risposta e chiudi pulito.', {
      naturallyComplete: true,
      valuableContinuation: false,
      stoppingAbrupt: false,
      continuingRepetitive: false,
    })
  }

  // --- Four questions ---
  const naturallyComplete =
    openQuestions.length === 0 &&
    (CLOSURE_CUE.test(lastAssistant) ||
      intent === 'calculation' ||
      intent === 'creation' ||
      (alreadyExplainedCount >= 5 && !teachingLikely) ||
      (planHints?.complexity === 'low' && userMessage.length < 80 && !teachingLikely))

  const continuingRepetitive =
    momentumBeats >= 2 ||
    alreadyExplainedCount >= 6 ||
    (CLOSURE_CUE.test(lastAssistant) && openQuestions.length === 0)

  const stoppingAbrupt =
    !naturallyComplete &&
    (openQuestions.length > 0 ||
      (teachingLikely && alreadyExplainedCount < 3) ||
      (OPEN_LOOP.test(lastAssistant) && openQuestions.length > 0) ||
      intent === 'how_to' ||
      intent === 'problem_solving' ||
      (intent === 'explanation' && planHints?.complexity !== 'low'))

  const valuableContinuation =
    !continuingRepetitive &&
    (openQuestions.length > 0 ||
      stoppingAbrupt ||
      (teachingLikely && alreadyExplainedCount > 0 && alreadyExplainedCount < 5) ||
      intent === 'how_to' ||
      intent === 'advice' ||
      intent === 'problem_solving')

  reasons.push(
    `complete=${naturallyComplete}`,
    `valuable=${valuableContinuation}`,
    `abrupt=${stoppingAbrupt}`,
    `repetitive=${continuingRepetitive}`,
  )

  // Decision: continue only if valuable AND (abrupt if we stop OR open thread) AND not repetitive
  const shouldContinue =
    valuableContinuation &&
    !continuingRepetitive &&
    (stoppingAbrupt || openQuestions.length > 0) &&
    !naturallyComplete

  if (!shouldContinue) {
    const why = continuingRepetitive
      ? 'Continuare sarebbe ripetitivo — chiudi naturalmente.'
      : naturallyComplete
        ? 'Discussione naturalmente completa — chiudi senza filler.'
        : 'Nessuna continuazione ad alto valore — non allungare solo per lunghezza.'
    return {
      shouldContinue: false,
      continuationKind: 'none',
      continuationHint: '',
      evaluation: {
        naturallyComplete,
        valuableContinuation,
        stoppingAbrupt,
        continuingRepetitive,
      },
      confidence: continuingRepetitive || naturallyComplete ? 'high' : 'medium',
      writerBrief: [
        'CONVERSATION MOMENTUM: termina in modo naturale.',
        why,
        'Non aggiungere coda solo per allungare. Niente “Anything else?”.',
      ].join(' '),
      reasons: [...reasons, why],
    }
  }

  const picked = pickContinuation({
    openQuestions,
    teachingLikely,
    intent,
    topic: session?.currentTopic || planHints?.topic || 'generale',
    alreadyExplainedCount,
  })

  const confidence =
    openQuestions.length > 0 || (stoppingAbrupt && teachingLikely) ? 'high' : 'medium'

  return {
    shouldContinue: true,
    continuationKind: picked.kind,
    continuationHint: picked.hint,
    evaluation: {
      naturallyComplete,
      valuableContinuation: true,
      stoppingAbrupt,
      continuingRepetitive: false,
    },
    confidence,
    writerBrief: [
      'CONVERSATION MOMENTUM: dopo la risposta principale, aggiungi UNA sola continuazione concisa e di alta qualità.',
      `Continuazione: ${picked.hint} (${picked.kind}).`,
      'Preserva il flusso conversazionale — non sembrare un appendice forzata.',
      'Vietato allungare solo per lunghezza. Vietato ripetere. Vietato domande generiche di chiusura.',
      'Se mentre scrivi ti accorgi che non aggiunge valore reale: omettila e chiudi naturalmente.',
    ].join(' '),
    reasons: [...reasons, `Continua con ${picked.kind}.`],
  }
}

/**
 * @param {string} reason
 * @param {MomentumEvaluation} evaluation
 * @returns {MomentumPlan}
 */
function endNaturally(reason, evaluation) {
  return {
    shouldContinue: false,
    continuationKind: 'none',
    continuationHint: '',
    evaluation,
    confidence: 'high',
    writerBrief: [
      'CONVERSATION MOMENTUM: termina in modo naturale.',
      reason,
      'Non aggiungere coda solo per allungare.',
    ].join(' '),
    reasons: [reason],
  }
}

/**
 * @param {MomentumPlan | null | undefined} plan
 */
export function formatMomentumForWriter(plan) {
  if (!plan?.writerBrief) return ''

  const e = plan.evaluation
  const action = plan.shouldContinue
    ? `AZIONE: una sola continuazione di qualità (${plan.continuationKind}) — «${plan.continuationHint}».`
    : 'AZIONE: chiudi naturalmente — nessuna coda di riempimento.'

  return `══════════════════════════════════════
CONVERSATION MOMENTUM (INVISIBILE)
══════════════════════════════════════
Prima di finire, valuta il flusso:
1. Discussione naturalmente completa? ${e.naturallyComplete ? 'sì' : 'no'}
2. Continuazione di valore ovvia? ${e.valuableContinuation ? 'sì' : 'no'}
3. Fermarsi qui sarebbe brusco? ${e.stoppingAbrupt ? 'sì' : 'no'}
4. Continuare diventerebbe ripetitivo? ${e.continuingRepetitive ? 'sì' : 'no'}
Confidence: ${plan.confidence} · Continue: ${plan.shouldContinue ? 'sì' : 'no'}
${action}

${plan.writerBrief}

Regole assolute:
- Mai continuare solo per aumentare la lunghezza
- Al massimo UNA continuazione concisa
- Se non c’è valore: chiudi naturalmente
- NON citare questo motore all’utente`
}

/**
 * @param {object} input
 * @returns {{ plan: MomentumPlan, context: string }}
 */
export function runConversationMomentum(input) {
  try {
    const plan = analyzeMomentum(input)
    return {
      plan,
      context: formatMomentumForWriter(plan),
    }
  } catch {
    return {
      plan: {
        shouldContinue: false,
        continuationKind: 'none',
        continuationHint: '',
        evaluation: {
          naturallyComplete: true,
          valuableContinuation: false,
          stoppingAbrupt: false,
          continuingRepetitive: false,
        },
        confidence: 'low',
        writerBrief: '',
        reasons: ['fallback'],
      },
      context: '',
    }
  }
}
