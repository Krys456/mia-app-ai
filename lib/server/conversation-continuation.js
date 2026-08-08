/**
 * LAIfe Conversation Continuation Engine
 *
 * When the user sends an extremely short message ("ok", "yes", "nice", "thanks"…):
 * 1. Infer likely intent from recent context
 * 2. If confidence is high that they want to keep learning → continue with ONE valuable addition
 * 3. If confidence is low → brief reply, do not force the conversation
 * 4. Never continue indefinitely; never ignore explicit stop signals
 *
 * Invisible to the user. Does not write factual memory. Does not change the model or API contract.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'continue_learning'|'acknowledge'|'want_advice'|'finish'|'want_example'|'want_depth'|'unknown'} ContinuationIntent
 */

/**
 * @typedef {'practical'|'mistakes'|'fact'|'advanced'|'comparison'|'example'|'related'|null} AdditionKind
 */

/**
 * @typedef {object} ContinuationPlan
 * @property {boolean} isShortMessage
 * @property {ContinuationIntent} intent
 * @property {'high'|'medium'|'low'} confidence
 * @property {boolean} shouldContinue
 * @property {AdditionKind} additionKind
 * @property {string} writerBrief
 * @property {string[]} reasons
 */

const SHORT_MAX_LEN = 32

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte)[\s!.]*$/i

const THANKS_FINISH =
  /^(grazie(\s+(mille|tante|ancora))?|thanks(\s+a\s+lot)?|thank\s+you(\s+so\s+much)?|thx|ty)([\s!,.]*(ok|okay|bye|ciao)?)?[\s!.]*$/i

const PURE_ACK =
  /^(ok|okay|k|va\s+bene|bene|perfetto|capito|capisco|ho\s+capito|yes|yep|yeah|yup|si|sì|alright|nice|cool|great|awesome|interessante|i\s+see|vedo|ah|oh|mm+|uhm+|got\s+it|makes\s+sense|chiaro|esatto|giusto|fair|sure)[\s!.]*$/i

const CONTINUE_LEARN =
  /^(continua|continua\s+pure|vai\s+avanti|prosegui|avanti|go\s+on|continue|keep\s+going|dimmi\s+di\s+più|altro\??|and\s+then)[\s!.]*$/i

const WANT_EXAMPLE =
  /\b(esempio|example|per\s+esempio|show\s+me)\b/i

const WANT_DEPTH =
  /\b(approfond|più\s+(dettagli|fondo|in\s+profondità)|more\s+(detail|depth)|in\s+depth|spiegami\s+meglio)\b/i

const WANT_ADVICE =
  /\b(consigli[oa]?|in\s+pratica|cosa\s+dovrei|should\s+i|how\s+do\s+i\s+apply|practical)\b/i

const TEACHING_CUE =
  /\b(perché|perche|come\s+funziona|in\s+pratica|ad\s+esempio|per\s+esempio|passo|step|differenza|significa|consiste|quindi|in\s+sintesi)\b/i

const ADDITION_CYCLE = /** @type {const} */ ([
  'practical',
  'mistakes',
  'example',
  'fact',
  'advanced',
  'comparison',
  'related',
])

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
 * Count consecutive trailing short acks from the user (including current).
 * @param {ChatTurn[]} turns
 * @param {string} current
 */
function countRecentAckStreak(turns, current) {
  let streak = PURE_ACK.test(current) || THANKS_FINISH.test(current) ? 1 : 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role !== 'user') continue
    // skip the current message if already present in the transcript
    if (streak >= 1 && normalize(t.content) === current) {
      // already counted as the current ack
      continue
    }
    // Only real acks / thanks count toward the streak — not prior real questions
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
 * Pick a rotating addition kind so consecutive continuations don't feel identical.
 * @param {number} streak
 * @param {string} topic
 * @returns {AdditionKind}
 */
function pickAdditionKind(streak, topic) {
  const idx = Math.max(0, streak - 1) % ADDITION_CYCLE.length
  const kind = ADDITION_CYCLE[idx]
  // Prefer examples when the topic looks practical
  if (/\b(codice|code|api|deploy|sql|react|css|git)\b/i.test(topic) && kind === 'fact') {
    return 'example'
  }
  return kind
}

/**
 * @param {AdditionKind} kind
 */
function describeAddition(kind) {
  switch (kind) {
    case 'practical':
      return 'un’applicazione pratica concreta di quanto detto'
    case 'mistakes':
      return 'un errore comune da evitare su questo tema'
    case 'fact':
      return 'un dettaglio interessante / curiosità utile (breve)'
    case 'advanced':
      return 'un livello appena più avanzato, ancora digeribile'
    case 'comparison':
      return 'un confronto breve con un’alternativa correlata'
    case 'example':
      return 'un esempio reale / mini-scenario'
    case 'related':
      return 'un argomento correlato naturale (una sola porta, non un tour)'
    default:
      return 'un’unica aggiunta di valore'
  }
}

/**
 * Infer continuation intent for a short user message.
 *
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
  const assistantLen = lastAssistant?.content?.length || 0
  const teachingLikely =
    assistantLen > 180 || TEACHING_CUE.test(lastAssistant?.content || '')

  const isShort =
    userMessage.length > 0 &&
    userMessage.length <= SHORT_MAX_LEN &&
    !userMessage.includes('?') &&
    userMessage.split(/\s+/).length <= 5

  if (!isShort) {
    return {
      isShortMessage: false,
      intent: 'unknown',
      confidence: 'low',
      shouldContinue: false,
      additionKind: null,
      writerBrief: '',
      reasons: ['Messaggio non breve: nessuna continuazione forzata.'],
    }
  }

  reasons.push('Messaggio estremamente breve rilevato.')

  // Explicit stop / thanks-as-closure → never force continuation
  if (STOP_SIGNAL.test(userMessage) || THANKS_FINISH.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'finish',
      confidence: 'high',
      shouldContinue: false,
      additionKind: null,
      writerBrief:
        'L’utente segnala chiusura (grazie / stop). Rispondi in modo breve e caldo; NON aggiungere una lezione, NON forzare la conversazione.',
      reasons: [...reasons, 'Segnale esplicito di chiusura.'],
    }
  }

  if (CONTINUE_LEARN.test(userMessage)) {
    const kind = pickAdditionKind(1, topic)
    return {
      isShortMessage: true,
      intent: 'continue_learning',
      confidence: 'high',
      shouldContinue: true,
      additionKind: kind,
      writerBrief: [
        `L’utente vuole continuare su “${topic}”.`,
        `Aggiungi UNA sola cosa di valore: ${describeAddition(kind)}.`,
        'Non ripetere quanto già detto. Non chiudere con una domanda obbligata. Non allungare indefinitamente.',
      ].join(' '),
      reasons: [...reasons, 'Richiesta esplicita di continuare.'],
    }
  }

  if (WANT_EXAMPLE.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'want_example',
      confidence: 'high',
      shouldContinue: true,
      additionKind: 'example',
      writerBrief: `L’utente chiede un esempio su “${topic}”. Dai UN esempio concreto; niente ripasso della teoria.`,
      reasons: [...reasons, 'Richiesta di esempio.'],
    }
  }

  if (WANT_DEPTH.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'want_depth',
      confidence: 'high',
      shouldContinue: true,
      additionKind: 'advanced',
      writerBrief: `L’utente vuole più profondità su “${topic}”. Approfondisci UN aspetto; non rifare tutta la lezione.`,
      reasons: [...reasons, 'Richiesta di profondità.'],
    }
  }

  if (WANT_ADVICE.test(userMessage)) {
    return {
      isShortMessage: true,
      intent: 'want_advice',
      confidence: 'high',
      shouldContinue: true,
      additionKind: 'practical',
      writerBrief: `L’utente vuole consiglio pratico su “${topic}”. Dai UN next step concreto.`,
      reasons: [...reasons, 'Richiesta di consiglio pratico.'],
    }
  }

  const streak = countRecentAckStreak(turns, userMessage)
  const openQs = Array.isArray(session?.openQuestions) ? session.openQuestions.length : 0

  // Pure ack: ok / nice / cool / I see / capito
  if (PURE_ACK.test(userMessage) || (userMessage.length < 16 && !/[?!]/.test(userMessage))) {
    // Never continue indefinitely: after 2 continuations on acks, ease off
    if (streak >= 3) {
      return {
        isShortMessage: true,
        intent: 'acknowledge',
        confidence: 'high',
        shouldContinue: false,
        additionKind: null,
        writerBrief:
          'Serie di ack brevi: l’utente sta assorbendo. Rispondi in modo brevissimo (una frase); NON aggiungere un altro pezzo di lezione.',
        reasons: [...reasons, `Streak di ack=${streak}: stop continuation.`],
      }
    }

    // First/second ack after a teaching reply → likely still learning
    if (teachingLikely && streak <= 2) {
      const kind = pickAdditionKind(streak, topic)
      // First ack after substance → high confidence to continue learning
      const confidence =
        streak === 1 && (assistantLen > 120 || openQs > 0 || TEACHING_CUE.test(lastAssistant?.content || ''))
          ? 'high'
          : streak === 1
            ? 'medium'
            : 'medium'

      const shouldContinue =
        confidence === 'high' || streak === 1 || (streak === 2 && teachingLikely)

      if (shouldContinue) {
        return {
          isShortMessage: true,
          intent: 'continue_learning',
          confidence: shouldContinue && streak === 1 ? 'high' : confidence,
          shouldContinue: true,
          additionKind: kind,
          writerBrief: [
            `Ack breve dopo una spiegazione su “${topic}” — probabilmente vuole continuare ad imparare (confidence ${streak === 1 ? 'high' : confidence}).`,
            `Continua in modo naturale con UNA sola aggiunta: ${describeAddition(kind)}.`,
            'Apri senza “Perfetto!” ripetitivo. Non sembrare un corso automatico. Non forzare una domanda finale.',
            'Se l’utente ha già ricevuto molte continuazioni, stai corto.',
          ].join(' '),
          reasons: [
            ...reasons,
            'Ack dopo contenuto didattico.',
            `streak=${streak}`,
            `openQuestions=${openQs}`,
            `assistantLen=${assistantLen}`,
          ],
        }
      }
    }

    return {
      isShortMessage: true,
      intent: 'acknowledge',
      confidence: teachingLikely ? 'medium' : 'low',
      shouldContinue: false,
      additionKind: null,
      writerBrief:
        'Ack breve con confidenza insufficiente per continuare. Rispondi in modo breve e naturale; non forzare la conversazione e non aggiungere una mini-lezione.',
      reasons: [...reasons, 'Confidenza bassa/media: niente forzatura.'],
    }
  }

  return {
    isShortMessage: true,
    intent: 'unknown',
    confidence: 'low',
    shouldContinue: false,
    additionKind: null,
    writerBrief:
      'Messaggio breve ambiguo. Rispondi in modo breve; non forzare approfondimenti.',
    reasons: [...reasons, 'Intent ambiguo.'],
  }
}

/**
 * Format continuation plan for the Writer (invisible).
 * @param {ContinuationPlan | null | undefined} plan
 */
export function formatContinuationForWriter(plan) {
  if (!plan?.isShortMessage || !plan.writerBrief) return ''

  const action = plan.shouldContinue
    ? `AZIONE: continua con una sola aggiunta (${plan.additionKind || 'valore'}).`
    : 'AZIONE: rispondi breve — non forzare la conversazione.'

  return `══════════════════════════════════════
CONVERSATION CONTINUATION ENGINE (INVISIBILE)
══════════════════════════════════════
Messaggio utente molto breve. Inferisci l’intento; non chiudere a vuoto e non allungare indefinitamente.
Intent: ${plan.intent} · Confidence: ${plan.confidence} · Continue: ${plan.shouldContinue ? 'sì' : 'no'}
${action}

${plan.writerBrief}

Regole assolute:
- Mai ignorare segnali di stop / grazie di chiusura
- Mai continuare indefinitamente (max una aggiunta per turno)
- Mai ripetere ciò che è già stato spiegato
- NON citare questo motore all’utente`
}

/**
 * Fail-soft entry point.
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
        shouldContinue: false,
        additionKind: null,
        writerBrief: '',
        reasons: ['fallback'],
      },
      context: '',
    }
  }
}
