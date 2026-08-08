/**
 * LAIfe Next-Ask Prediction
 *
 * Predict what the user is most likely to ask next, based on:
 * - current topic
 * - conversation history
 * - user preferences (reflection signals)
 * - previous discussions (already explained / open threads)
 * - complexity / technical level
 *
 * Use the prediction to shape the CURRENT answer so it naturally leads
 * toward that likely curiosity — never mention the prediction explicitly.
 *
 * Invisible. No factual memory writes. Fail-soft.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'example'|'edge_case'|'how_to_apply'|'comparison'|'deeper_why'|'common_mistake'|'next_step'|'tradeoff'|'code_sample'|'clarification'} NextAskKind
 */

/**
 * @typedef {object} NextAskCandidate
 * @property {string} id
 * @property {NextAskKind} kind
 * @property {string} predictedAsk
 * @property {number} probability
 * @property {string[]} basedOn
 */

/**
 * @typedef {object} NextAskPlan
 * @property {boolean} active
 * @property {NextAskCandidate | null} prediction
 * @property {NextAskCandidate[]} ranked
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} shapeBrief
 * @property {string} writerBrief
 * @property {string[]} reasons
 */

const STOP_OR_THANKS =
  /^(basta|stop|fine|grazie(\s+\w+)?|thanks(\s+a\s+lot)?|thank\s+you|thx|ty|bye|ciao|ok\s+grazie)[\s!.]*$/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve)[\s!.]*$/i

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
 * @param {string} topic
 */
function topicLabel(topic) {
  const t = normalize(topic)
  if (!t || t === 'generale') return 'questo tema'
  return t.length > 72 ? `${t.slice(0, 69)}…` : t
}

/**
 * Patterns of what the user has asked before in this chat.
 * @param {ChatTurn[]} turns
 */
function historyAskProfile(turns) {
  const userTurns = turns.filter((t) => t.role === 'user').map((t) => t.content)
  const blob = userTurns.join('\n')
  return {
    askedExample: /\b(esempio|example|per\s+esempio|show\s+me)\b/i.test(blob),
    askedWhy: /\b(perch[eé]|why|come\s+mai)\b/i.test(blob),
    askedHow: /\b(come\s+(faccio|si|posso)|how\s+(do|can|to)|passo)\b/i.test(blob),
    askedCompare: /\b(differen|vs\b|versus|oppure|alternativa|confront)\b/i.test(blob),
    askedCode: /\b(codice|code|snippet|typescript|python|react)\b/i.test(blob),
    askedEdge: /\b(edge|limite|eccezion|quando\s+fall|pitfall|attenzione)\b/i.test(blob),
    askedNext: /\b(e\s+poi|next|dopo|successivo|continua)\b/i.test(blob),
    turnCount: userTurns.length,
  }
}

/**
 * @param {string[]|undefined} prefs
 */
function preferenceBoosts(prefs) {
  const p = (prefs || []).join(' ').toLowerCase()
  return {
    wantsBrief: /\b(brev|concis|short|sintet)\b/i.test(p),
    wantsDetail: /\b(dettagl|profond|depth|approfond)\b/i.test(p),
    wantsLists: /\b(lista|elenco|bullet|step)\b/i.test(p),
    wantsCode: /\b(codice|code|snippet)\b/i.test(p),
    casual: /\b(casual|informal)\b/i.test(p),
  }
}

/**
 * @param {object} args
 * @returns {NextAskCandidate[]}
 */
function buildCandidates(args) {
  const {
    topic,
    openQuestions,
    alreadyExplained,
    technicalLevel,
    complexity,
    history,
    prefs,
    domainTech,
  } = args

  const label = topicLabel(topic)
  /** @type {NextAskCandidate[]} */
  const out = []

  const explained = (alreadyExplained || []).map((x) => String(x).toLowerCase())
  const skipIfExplained = (hint) =>
    explained.some((e) => e.includes(hint) || hint.includes(e.slice(0, 18)))

  // Open threads ≈ what they may ask next
  for (const q of (openQuestions || []).slice(0, 4)) {
    const ask = normalize(q)
    if (!ask || ask.length < 6) continue
    out.push({
      id: `open:${ask.slice(0, 48)}`,
      kind: 'clarification',
      predictedAsk: ask.endsWith('?') ? ask : `${ask}?`,
      probability: 0.72,
      basedOn: ['open_thread', 'conversation_history'],
    })
  }

  if (!skipIfExplained('esempio')) {
    out.push({
      id: 'example',
      kind: 'example',
      predictedAsk: `Puoi farmi un esempio concreto di ${label}?`,
      probability: 0.55 + (history.askedExample ? 0.12 : 0) + (technicalLevel === 'beginner' ? 0.1 : 0),
      basedOn: ['current_topic', 'complexity_level'],
    })
  }

  out.push({
    id: 'apply',
    kind: 'how_to_apply',
    predictedAsk: `Come lo applico in pratica a ${label}?`,
    probability:
      0.5 +
      (history.askedHow ? 0.14 : 0) +
      (complexity === 'medium' || complexity === 'high' ? 0.08 : 0) +
      (prefs.wantsLists ? 0.06 : 0),
    basedOn: ['current_topic', 'conversation_history'],
  })

  out.push({
    id: 'why',
    kind: 'deeper_why',
    predictedAsk: `Perché ${label} funziona così / qual è il meccanismo sotto?`,
    probability:
      0.48 +
      (history.askedWhy ? 0.16 : 0) +
      (prefs.wantsDetail ? 0.1 : 0) +
      (technicalLevel === 'expert' ? 0.08 : technicalLevel === 'beginner' ? -0.05 : 0),
    basedOn: ['user_preferences', 'complexity_level'],
  })

  out.push({
    id: 'mistake',
    kind: 'common_mistake',
    predictedAsk: `Quali errori comuni si fanno con ${label}?`,
    probability:
      0.5 +
      (history.askedEdge ? 0.12 : 0) +
      (domainTech ? 0.1 : 0) +
      (technicalLevel === 'intermediate' ? 0.08 : 0),
    basedOn: ['current_topic', 'previous_discussions'],
  })

  out.push({
    id: 'compare',
    kind: 'comparison',
    predictedAsk: `In cosa ${label} differisce dall’alternativa più vicina?`,
    probability:
      0.46 +
      (history.askedCompare ? 0.18 : 0) +
      (technicalLevel !== 'beginner' ? 0.06 : 0),
    basedOn: ['conversation_history', 'complexity_level'],
  })

  out.push({
    id: 'edge',
    kind: 'edge_case',
    predictedAsk: `Cosa succede nei casi limite / quando ${label} fallisce?`,
    probability:
      0.44 +
      (technicalLevel === 'expert' ? 0.14 : 0) +
      (complexity === 'high' ? 0.1 : 0) +
      (history.askedEdge ? 0.1 : 0),
    basedOn: ['complexity_level', 'previous_discussions'],
  })

  out.push({
    id: 'next',
    kind: 'next_step',
    predictedAsk: `Qual è il passo successivo dopo aver capito ${label}?`,
    probability: 0.47 + (history.askedNext ? 0.15 : 0) + (history.turnCount >= 3 ? 0.06 : 0),
    basedOn: ['conversation_history', 'current_topic'],
  })

  if (domainTech || prefs.wantsCode || history.askedCode) {
    out.push({
      id: 'code',
      kind: 'code_sample',
      predictedAsk: `Mi mostri un piccolo snippet / esempio di codice per ${label}?`,
      probability:
        0.52 +
        (prefs.wantsCode || history.askedCode ? 0.16 : 0) +
        (domainTech ? 0.08 : 0),
      basedOn: ['user_preferences', 'previous_discussions'],
    })
  }

  if (technicalLevel === 'expert' || complexity === 'high') {
    out.push({
      id: 'tradeoff',
      kind: 'tradeoff',
      predictedAsk: `Quali trade-off ci sono scegliendo ${label}?`,
      probability: 0.5 + (technicalLevel === 'expert' ? 0.12 : 0.05),
      basedOn: ['complexity_level', 'current_topic'],
    })
  }

  // Soft preference: if user wants brief, downrank heavy “deeper/tradeoff”
  if (prefs.wantsBrief) {
    for (const c of out) {
      if (c.kind === 'deeper_why' || c.kind === 'tradeoff' || c.kind === 'edge_case') {
        c.probability -= 0.12
      }
      if (c.kind === 'example' || c.kind === 'how_to_apply' || c.kind === 'next_step') {
        c.probability += 0.05
      }
    }
  }

  return out
    .map((c) => ({
      ...c,
      probability: Math.max(0.05, Math.min(0.95, c.probability)),
    }))
    .sort((a, b) => b.probability - a.probability)
}

/**
 * Writer guidance: shape the current answer toward the predicted ask — invisibly.
 * @param {NextAskCandidate} prediction
 * @param {{ wantsBrief?: boolean }} prefs
 */
function buildShapeBrief(prediction, prefs) {
  const leadHints = {
    example: 'includi già un mini-ancoraggio concreto (senza anticipare “ti farò un esempio dopo”)',
    how_to_apply: 'chiudi il ragionamento con un ponte pratico di una frase',
    deeper_why: 'lascia trasparire il meccanismo sotto, così il “perché” successivo è naturale',
    common_mistake: 'accenna di sfuggita a un rischio/errore tipico, senza fare la lista completa',
    comparison: 'posa un contrasto implicito con l’alternativa vicina',
    edge_case: 'menziona un limite reale in mezza frase',
    next_step: 'orienta la chiusura verso il passo successivo ovvio',
    tradeoff: 'nomina un costo/beneficio in modo sobrio',
    code_sample: 'se serve, lascia lo scheletro pronto per uno snippet (senza dire “vuoi il codice?”)',
    clarification: 'tocca di sfuggita il filo ancora aperto, senza trasformarlo nella risposta principale',
  }

  const hint = leadHints[prediction.kind] || 'prepara un ponte naturale verso quella curiosità'

  return [
    `Previsione interna (NON menzionare): la prossima domanda più probabile è «${prediction.predictedAsk}» (${prediction.kind}, p≈${prediction.probability.toFixed(2)}).`,
    `Modella la risposta ATTUALE così che conduca naturalmente verso quella curiosità: ${hint}.`,
    'Rispondi prima e bene alla richiesta di ora — la previsione orienta, non dirotta.',
    prefs.wantsBrief
      ? 'Utente preferisce sintesi: il ponte deve essere minimo (mezza frase).'
      : 'Il ponte può essere una frase fluida dentro la risposta, non una coda da prodotto.',
    'VIETATO dire: “probabilmente mi chiederai…”, “la prossima domanda…”, “ti anticipo che…”, “vuoi che approfondisca X?” come formula vuota.',
    'Non citare alcuna previsione all’utente.',
  ].join(' ')
}

/**
 * @param {object} input
 * @param {string} input.userMessage
 * @param {ChatTurn[]} [input.messages]
 * @param {{
 *   currentTopic?: string,
 *   openQuestions?: string[],
 *   alreadyExplained?: string[],
 *   followUpKind?: string,
 * } | null} [input.session]
 * @param {{
 *   technicalLevel?: 'beginner'|'intermediate'|'expert',
 *   complexity?: 'low'|'medium'|'high',
 *   keepFast?: boolean,
 *   emotionalTone?: string,
 * } | null} [input.planHints]
 * @param {{ apparentPreferences?: string[] } | null} [input.learningSignals]
 * @param {{ isShortMessage?: boolean } | null} [input.continuation]
 * @returns {NextAskPlan}
 */
export function analyzeNextAsk(input) {
  const userMessage = normalize(input?.userMessage)
  const turns = normalizeTurns(input?.messages)
  const session = input?.session || null
  const planHints = input?.planHints || null
  const prefs = preferenceBoosts(input?.learningSignals?.apparentPreferences)
  /** @type {string[]} */
  const reasons = []

  if (!userMessage || STOP_OR_THANKS.test(userMessage) || GREETING_ONLY.test(userMessage)) {
    return {
      active: false,
      prediction: null,
      ranked: [],
      confidence: 'high',
      shapeBrief: '',
      writerBrief: '',
      reasons: ['Messaggio di chiusura/saluto: nessuna previsione operativa.'],
    }
  }

  if (input?.continuation?.isShortMessage) {
    return {
      active: false,
      prediction: null,
      ranked: [],
      confidence: 'high',
      shapeBrief: '',
      writerBrief: '',
      reasons: ['Ack breve: Conversation Continuation / Curiosity gestiscono il turno.'],
    }
  }

  if (planHints?.keepFast || planHints?.emotionalTone === 'urgent' || planHints?.emotionalTone === 'frustrated') {
    return {
      active: false,
      prediction: null,
      ranked: [],
      confidence: 'medium',
      shapeBrief: '',
      writerBrief: '',
      reasons: ['Turno veloce o tono carico: non modellare verso una curiosità futura.'],
    }
  }

  const topic = session?.currentTopic || 'generale'
  if (!topic || topic === 'generale') {
    reasons.push('Tema generico: previsione debole.')
  }

  const history = historyAskProfile(turns)
  const domainTech = /\b(codice|code|api|react|sql|git|typescript|python|css|hook|deploy|bug)\b/i.test(
    `${topic}\n${userMessage}`,
  )

  const ranked = buildCandidates({
    topic,
    openQuestions: session?.openQuestions || [],
    alreadyExplained: session?.alreadyExplained || [],
    technicalLevel: planHints?.technicalLevel || 'intermediate',
    complexity: planHints?.complexity || 'medium',
    history,
    prefs,
    domainTech,
  })

  const top = ranked[0] || null
  if (!top || top.probability < 0.5) {
    return {
      active: false,
      prediction: null,
      ranked: ranked.slice(0, 5),
      confidence: 'low',
      shapeBrief: '',
      writerBrief:
        'Next-ask: confidenza bassa — rispondi alla domanda attuale senza forzare ponti verso curiosità future.',
      reasons: [...reasons, 'Probabilità sotto soglia.'],
    }
  }

  const second = ranked[1]
  const margin = second ? top.probability - second.probability : top.probability
  const confidence =
    top.probability >= 0.68 && margin >= 0.04
      ? 'high'
      : top.probability >= 0.55
        ? 'medium'
        : 'low'

  if (confidence === 'low') {
    return {
      active: false,
      prediction: top,
      ranked: ranked.slice(0, 5),
      confidence,
      shapeBrief: '',
      writerBrief: 'Next-ask: confidenza bassa — non modellare la risposta su una previsione debole.',
      reasons: [...reasons, `Top p=${top.probability.toFixed(2)} ma confidenza bassa.`],
    }
  }

  const shapeBrief = buildShapeBrief(top, prefs)

  return {
    active: true,
    prediction: top,
    ranked: ranked.slice(0, 6),
    confidence,
    shapeBrief,
    writerBrief: shapeBrief,
    reasons: [
      ...reasons,
      `Predizione: ${top.kind} — ${top.predictedAsk}`,
      `p=${top.probability.toFixed(2)} · basedOn=${top.basedOn.join(',')}`,
      `level=${planHints?.technicalLevel || 'intermediate'} · complexity=${planHints?.complexity || 'medium'}`,
    ],
  }
}

/**
 * @param {NextAskPlan | null | undefined} plan
 */
export function formatNextAskForWriter(plan) {
  if (!plan) return ''
  if (!plan.active && !plan.writerBrief) return ''

  const ranked =
    plan.ranked?.length > 0
      ? plan.ranked
          .slice(0, 4)
          .map((r, i) => `${i + 1}. p≈${r.probability.toFixed(2)} [${r.kind}] ${r.predictedAsk}`)
          .join('\n')
      : '(nessuna)'

  const action = plan.active && plan.prediction
    ? `AZIONE: modella la risposta attuale verso la curiosità probabile (invisibile) — «${plan.prediction.predictedAsk}».`
    : 'AZIONE: nessuna modellazione predittiva.'

  return `══════════════════════════════════════
NEXT-ASK PREDICTION (INVISIBILE)
══════════════════════════════════════
Stima la prossima domanda più probabile; usala per modellare la risposta ATTUALE.
Confidence: ${plan.confidence} · Active: ${plan.active ? 'sì' : 'no'}
${action}

Classifica interna (non mostrare):
${ranked}

${plan.writerBrief || ''}

Regole assolute:
- Non menzionare mai la previsione
- Non dire “probabilmente mi chiederai…” / “vuoi che…?” come filler
- La richiesta attuale resta prioritaria
- Il ponte verso la curiosità deve sembrare naturale, non forzato
- NON citare questo motore all’utente`
}

/**
 * @param {object} input
 * @returns {{ plan: NextAskPlan, context: string }}
 */
export function runNextAskPrediction(input) {
  try {
    const plan = analyzeNextAsk(input)
    return {
      plan,
      context: formatNextAskForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        prediction: null,
        ranked: [],
        confidence: 'low',
        shapeBrief: '',
        writerBrief: '',
        reasons: ['fallback'],
      },
      context: '',
    }
  }
}
