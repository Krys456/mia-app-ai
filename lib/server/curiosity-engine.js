/**
 * LAIfe Curiosity Engine
 *
 * After the main answer is planned, silently ask:
 * "What is the single most interesting thing the user would probably enjoy learning next?"
 *
 * 1. Generate a ranked list of possible follow-up ideas
 * 2. Choose only ONE (usefulness · surprise · educational value · continuity · relevance)
 * 3. Guide the Writer to extend the discussion naturally — never forced, never generic
 *
 * Invisible to the user. Does not write factual memory. Does not change model/API.
 * Coordinates with Conversation Continuation: on short acks, Continuation owns the turn.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'open_thread'|'surprising_angle'|'practical_pitfall'|'deeper_why'|'comparison'|'next_skill'|'adjacent_topic'|'scientific'|'historical'} CuriosityKind
 */

/**
 * @typedef {object} CuriosityIdea
 * @property {string} id
 * @property {CuriosityKind} kind
 * @property {string} idea
 * @property {number} usefulness
 * @property {number} surprise
 * @property {number} educationalValue
 * @property {number} continuity
 * @property {number} relevance
 * @property {number} score
 */

/**
 * @typedef {object} CuriosityPlan
 * @property {boolean} shouldExtend
 * @property {CuriosityIdea | null} chosen
 * @property {CuriosityIdea[]} ranked
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {string} silentQuestion
 */

const SILENT_QUESTION =
  'What is the single most interesting thing the user would probably enjoy learning next?'

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const THANKS_FINISH =
  /^(grazie(\s+(mille|tante|ancora))?|thanks(\s+a\s+lot)?|thank\s+you(\s+so\s+much)?|thx|ty)([\s!,.]*(ok|okay|bye|ciao)?)?[\s!.]*$/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const MINIMAL_ASK =
  /\b(in\s+breve|veloce|quick|tl;?dr|solo\s+s[iì]|yes\s+or\s+no|risposta\s+breve)\b/i

const GENERIC_FORBIDDEN =
  /anything else|what would you like to know|posso aiutarti con altro|altro\??\s*$|hai altre domande|let me know if/i

const RECENT_CURIOSITY_CUE =
  /(pu[oò]\s+esserti\s+utile|un\s+dettaglio\s+interessante|curiosit[aà]|related\s+insight|passo\s+in\s+pi[uù]|💡|📌)/i

/** Score threshold (weighted 0–5 scale) to emit an extension */
const SCORE_THRESHOLD = 3.15

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
 * @param {string} text
 */
function topicLabel(text) {
  const t = normalize(text)
  if (!t || t === 'generale') return 'questo tema'
  return t.length > 64 ? `${t.slice(0, 61)}…` : t
}

/**
 * Soft interest tokens from recent user turns.
 * @param {ChatTurn[]} turns
 * @param {string} userMessage
 */
function extractInterestHints(turns, userMessage) {
  const pool = [userMessage]
  for (let i = turns.length - 1; i >= 0 && pool.length < 4; i--) {
    if (turns[i].role === 'user') pool.push(turns[i].content)
  }
  const blob = pool.join(' ').toLowerCase()
  /** @type {string[]} */
  const hints = []
  if (/\b(perch[eé]|why|come\s+funziona|how\s+does)\b/i.test(blob)) hints.push('mechanisms')
  if (/\b(esempio|example|pratica|practical|apply)\b/i.test(blob)) hints.push('examples')
  if (/\b(errore|bug|sbagl|mistake|pitfall|risk)\b/i.test(blob)) hints.push('pitfalls')
  if (/\b(confront|vs|versus|differen|alternative)\b/i.test(blob)) hints.push('comparison')
  if (/\b(storia|history|origine|origin)\b/i.test(blob)) hints.push('history')
  if (/\b(scienz|physics|biolog|chemic|neuron|quantum)\b/i.test(blob)) hints.push('science')
  if (/\b(avanzat|advanced|profond|deep|dettagl)\b/i.test(blob)) hints.push('depth')
  if (/\b(impar|learn|capire|understand|spiega)\b/i.test(blob)) hints.push('learning')
  return hints
}

/**
 * Domain soft tags from topic + message.
 * @param {string} topic
 * @param {string} userMessage
 */
function detectDomain(topic, userMessage) {
  const blob = `${topic}\n${userMessage}`
  if (/\b(codice|code|api|react|sql|git|typescript|python|css|deploy|bug|function)\b/i.test(blob)) {
    return 'tech'
  }
  if (/\b(fisica|chimica|biolog|scientif|physics|biology|chemistry|neuron|quantum)\b/i.test(blob)) {
    return 'science'
  }
  if (/\b(storia|history|secolo|guerra|antico|epoca)\b/i.test(blob)) return 'history'
  if (/\b(soldi|invest|finanz|business|startup|marketing)\b/i.test(blob)) return 'business'
  return 'general'
}

/**
 * Build candidate ideas, then score + rank.
 * @param {object} args
 * @returns {CuriosityIdea[]}
 */
function generateCandidates(args) {
  const {
    topic,
    openQuestions,
    alreadyExplained,
    interestHints,
    domain,
    teachingLikely,
  } = args

  const label = topicLabel(topic)
  /** @type {Array<Omit<CuriosityIdea, 'score'>>} */
  const raw = []

  // Open threads from Conversation Intelligence — high continuity
  for (const q of (openQuestions || []).slice(0, 3)) {
    const idea = normalize(q)
    if (!idea || idea.length < 8) continue
    if ((alreadyExplained || []).some((e) => idea.toLowerCase().includes(String(e).toLowerCase().slice(0, 24)))) {
      continue
    }
    raw.push({
      id: `open:${idea.slice(0, 40)}`,
      kind: 'open_thread',
      idea: `Chiudi il filo aperto con un’affermazione concreta (non una domanda): ${idea}`,
      usefulness: 4.4,
      surprise: 2.6,
      educationalValue: 4.0,
      continuity: 4.8,
      relevance: 4.5,
    })
  }

  raw.push({
    id: 'surprising',
    kind: 'surprising_angle',
    idea: `Su ${label}: una conseguenza concreta che la maggior parte delle persone non nota — detta come fatto`,
    usefulness: 3.2,
    surprise: 4.7,
    educationalValue: 4.2,
    continuity: 3.6,
    relevance: interestHints.includes('mechanisms') || interestHints.includes('learning') ? 4.2 : 3.4,
  })

  raw.push({
    id: 'pitfall',
    kind: 'practical_pitfall',
    idea: `Su ${label}: l’errore pratico più comune e la mossa netta che lo evita (una frase + una mossa)`,
    usefulness: 4.6,
    surprise: 3.4,
    educationalValue: 4.0,
    continuity: 3.8,
    relevance: interestHints.includes('pitfalls') || interestHints.includes('examples') || domain === 'tech' ? 4.5 : 3.5,
  })

  raw.push({
    id: 'deeper',
    kind: 'deeper_why',
    idea: `Su ${label}: il perché un livello più sotto — un meccanismo, non una ricapitolazione`,
    usefulness: 3.8,
    surprise: 3.5,
    educationalValue: 4.6,
    continuity: 4.0,
    relevance: interestHints.includes('mechanisms') || interestHints.includes('depth') ? 4.6 : 3.6,
  })

  raw.push({
    id: 'compare',
    kind: 'comparison',
    idea: `Su ${label}: vs l’alternativa più vicina — UNA sola differenza che cambia la scelta`,
    usefulness: 4.0,
    surprise: 3.2,
    educationalValue: 4.1,
    continuity: 3.5,
    relevance: interestHints.includes('comparison') ? 4.7 : 3.3,
  })

  raw.push({
    id: 'next_skill',
    kind: 'next_skill',
    idea: `Dopo aver capito ${label}: il pezzo concreto da costruire subito (affermazione, non domanda)`,
    usefulness: 4.3,
    surprise: 2.8,
    educationalValue: 3.9,
    continuity: 4.2,
    relevance: teachingLikely ? 4.2 : 3.2,
  })

  raw.push({
    id: 'adjacent',
    kind: 'adjacent_topic',
    idea: `Un tema vicino che rende ${label} più chiaro — collegato al filo, non un reset`,
    usefulness: 3.5,
    surprise: 3.8,
    educationalValue: 3.8,
    continuity: 3.2,
    relevance: 3.3,
  })

  if (domain === 'science' || interestHints.includes('science')) {
    raw.push({
      id: 'scientific',
      kind: 'scientific',
      idea: `Il meccanismo scientifico di ${label} che cambia come lo immagini (senza lezione)`,
      usefulness: 3.6,
      surprise: 4.3,
      educationalValue: 4.5,
      continuity: 3.7,
      relevance: 4.4,
    })
  }

  if (domain === 'history' || interestHints.includes('history')) {
    raw.push({
      id: 'historical',
      kind: 'historical',
      idea: `Il precedente storico breve che spiega perché ${label} è fatto così oggi`,
      usefulness: 3.2,
      surprise: 4.0,
      educationalValue: 4.0,
      continuity: 3.4,
      relevance: 4.2,
    })
  }

  if (domain === 'tech') {
    // Boost pitfall / next_skill slightly already via relevance; add best-practice angle
    raw.push({
      id: 'tech_practice',
      kind: 'practical_pitfall',
      idea: `Una mossa concreta su ${label} che evita ore di debug (detta come consiglio, non “best practice”)`,
      usefulness: 4.7,
      surprise: 3.0,
      educationalValue: 3.8,
      continuity: 3.9,
      relevance: 4.6,
    })
  }

  return raw
    .map((idea) => {
      let score = scoreIdea(idea)
      // Prefer concrete open threads from the live conversation when close.
      if (idea.kind === 'open_thread') score += 0.2
      return { ...idea, score }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Weighted composite score (0–5).
 * @param {Omit<CuriosityIdea, 'score'>} idea
 */
function scoreIdea(idea) {
  return (
    idea.usefulness * 0.25 +
    idea.surprise * 0.2 +
    idea.educationalValue * 0.2 +
    idea.continuity * 0.2 +
    idea.relevance * 0.15
  )
}

/**
 * Decide whether curiosity should stay silent.
 * @param {object} args
 */
function shouldSuppress(args) {
  const {
    userMessage,
    followUpKind,
    continuationOwnsTurn,
    keepFast,
    emotionalTone,
    lastAssistant,
    teachingLikely,
    topic,
  } = args

  /** @type {string[]} */
  const reasons = []

  if (!normalize(userMessage)) {
    reasons.push('Messaggio vuoto.')
    return { suppress: true, reasons }
  }

  if (STOP_SIGNAL.test(userMessage) || THANKS_FINISH.test(userMessage)) {
    reasons.push('Chiusura / grazie: niente curiosità forzata.')
    return { suppress: true, reasons }
  }

  if (GREETING_ONLY.test(userMessage)) {
    reasons.push('Solo saluto.')
    return { suppress: true, reasons }
  }

  if (continuationOwnsTurn) {
    reasons.push('Conversation Continuation gestisce questo turno.')
    return { suppress: true, reasons }
  }

  if (followUpKind === 'ack') {
    reasons.push('Ack breve: non aggiungere una seconda coda curiosità.')
    return { suppress: true, reasons }
  }

  if (keepFast || MINIMAL_ASK.test(userMessage)) {
    reasons.push('Utente vuole velocità / sintesi.')
    return { suppress: true, reasons }
  }

  if (emotionalTone === 'frustrated' || emotionalTone === 'anxious' || emotionalTone === 'urgent') {
    reasons.push('Tono carico: priorità alla risposta, non all’estensione.')
    return { suppress: true, reasons }
  }

  if (RECENT_CURIOSITY_CUE.test(lastAssistant || '')) {
    reasons.push('L’ultimo assistente aveva già uno spunto curiosità: evita di ripetere il pattern.')
    return { suppress: true, reasons }
  }

  const thinTopic = !topic || topic === 'generale' || topic.length < 3
  if (thinTopic && !teachingLikely) {
    reasons.push('Tema troppo sottile per una continuazione interessante.')
    return { suppress: true, reasons }
  }

  // Occasional: if last assistant already ended with a question, don't stack another
  if (/\?\s*$/.test((lastAssistant || '').trim()) && (lastAssistant || '').length < 400) {
    reasons.push('Ultima risposta già aperta con domanda: non forzare.')
    return { suppress: true, reasons }
  }

  return { suppress: false, reasons }
}

/**
 * @param {CuriosityIdea} chosen
 */
function buildExtendBrief(chosen) {
  return [
    `Dopo la risposta principale, estendi naturalmente la discussione con UNA sola idea:`,
    `«${chosen.idea}»`,
    `(kind=${chosen.kind}, score=${chosen.score.toFixed(2)}).`,
    'Integra in modo fluido (intreccio breve o coda di 1–3 frasi) — affermazione, non coda Q&A.',
    'VIETATO: “Anything else?”, “What would you like to know?”, “Posso aiutarti con altro?”, domande generiche di chiusura.',
    'Non ripetere la risposta principale. Non trasformarlo in una seconda lezione.',
    'Deve sembrare curiosità genuina, non un upsell.',
  ].join(' ')
}

/**
 * Map a next-ask kind to preferred curiosity kinds for alignment.
 * @param {string | undefined} nextKind
 * @returns {Set<string>}
 */
function curiosityKindsForNextAsk(nextKind) {
  /** @type {Record<string, string[]>} */
  const map = {
    example: ['surprising_angle'], // fallback; example angle via practical/open
    how_to_apply: ['practical_pitfall', 'next_skill'],
    deeper_why: ['deeper_why', 'scientific'],
    common_mistake: ['practical_pitfall'],
    comparison: ['comparison'],
    edge_case: ['practical_pitfall'],
    next_step: ['next_skill', 'adjacent_topic'],
    tradeoff: ['comparison', 'deeper_why'],
    code_sample: ['practical_pitfall', 'next_skill'],
    clarification: ['open_thread', 'deeper_why'],
  }
  // Prefer open_thread when next-ask is clarification; for example prefer surprising + next_skill
  if (nextKind === 'example') return new Set(['next_skill', 'surprising_angle', 'adjacent_topic'])
  return new Set(map[nextKind || ''] || [])
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
 *   keepFast?: boolean,
 *   emotionalTone?: string,
 *   teachingLikely?: boolean,
 * } | null} [input.planHints]
 * @param {{ isShortMessage?: boolean, shouldContinue?: boolean } | null} [input.continuation]
 * @param {{ kind?: string, predictedAsk?: string } | null} [input.nextAskPrediction]
 * @returns {CuriosityPlan}
 */
export function analyzeCuriosity(input) {
  const userMessage = normalize(input?.userMessage)
  const turns = normalizeTurns(input?.messages)
  const session = input?.session || null
  const planHints = input?.planHints || null
  const continuation = input?.continuation || null
  const nextAskPrediction = input?.nextAskPrediction || null

  const topic = session?.currentTopic || 'generale'
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')?.content || ''
  const teachingLikely =
    planHints?.teachingLikely === true ||
    lastAssistant.length > 180 ||
    /\b(perché|perche|come\s+funziona|in\s+pratica|ad\s+esempio|for\s+example|because)\b/i.test(
      lastAssistant,
    )

  const suppress = shouldSuppress({
    userMessage,
    followUpKind: session?.followUpKind,
    continuationOwnsTurn: Boolean(continuation?.isShortMessage),
    keepFast: Boolean(planHints?.keepFast),
    emotionalTone: planHints?.emotionalTone || 'neutral',
    lastAssistant,
    teachingLikely,
    topic,
  })

  const silentQuestion = SILENT_QUESTION

  if (suppress.suppress) {
    return {
      shouldExtend: false,
      chosen: null,
      ranked: [],
      confidence: 'high',
      writerBrief:
        'Curiosity Engine: silenzio. Niente coda curiosità; niente domande generiche di chiusura.',
      reasons: suppress.reasons,
      silentQuestion,
    }
  }

  const interestHints = extractInterestHints(turns, userMessage)
  const domain = detectDomain(topic, userMessage)
  let ranked = generateCandidates({
    topic,
    openQuestions: session?.openQuestions || [],
    alreadyExplained: session?.alreadyExplained || [],
    interestHints,
    domain,
    teachingLikely,
  })

  // Align coda with next-ask prediction when present.
  const prefer = curiosityKindsForNextAsk(nextAskPrediction?.kind)
  if (prefer.size > 0) {
    ranked = ranked
      .map((idea) =>
        prefer.has(idea.kind)
          ? { ...idea, score: idea.score + 0.35, relevance: Math.min(5, idea.relevance + 0.4) }
          : idea,
      )
      .sort((a, b) => b.score - a.score)
  }

  const top = ranked[0] || null
  const second = ranked[1]
  const margin = top && second ? top.score - second.score : top ? top.score : 0

  if (!top || top.score < SCORE_THRESHOLD) {
    return {
      shouldExtend: false,
      chosen: null,
      ranked: ranked.slice(0, 5),
      confidence: 'medium',
      writerBrief:
        'Curiosity Engine: nessuna idea sopra soglia. Completa la risposta; non aggiungere filler né “Anything else?”.',
      reasons: [
        'Domanda silenziosa considerata.',
        top ? `Top score ${top.score.toFixed(2)} sotto soglia ${SCORE_THRESHOLD}.` : 'Nessun candidato.',
      ],
      silentQuestion,
    }
  }

  // Require teaching / learning context or strong open thread for medium confidence
  const strongOpen = top.kind === 'open_thread' && top.continuity >= 4.5
  const learningContext =
    teachingLikely ||
    interestHints.includes('learning') ||
    interestHints.includes('mechanisms') ||
    interestHints.includes('depth') ||
    strongOpen ||
    (planHints?.emotionalTone === 'curious' || planHints?.emotionalTone === 'excited')

  if (!learningContext && top.score < 3.55) {
    return {
      shouldExtend: false,
      chosen: null,
      ranked: ranked.slice(0, 5),
      confidence: 'low',
      writerBrief:
        'Curiosity Engine: contesto poco didattico — silenzio meglio di uno spunto forzato.',
      reasons: ['Contesto non abbastanza “learning” per un’estensione naturale.'],
      silentQuestion,
    }
  }

  const confidence = top.score >= 3.7 && (margin >= 0.12 || strongOpen) ? 'high' : 'medium'

  // If next-ask predicted a concrete ask, prefer that wording in the brief when kinds align.
  let brief = buildExtendBrief(top)
  if (nextAskPrediction?.predictedAsk && prefer.has(top.kind)) {
    brief = [
      brief,
      `Allinea l’estensione alla prossima curiosità stimata (senza citarla): «${nextAskPrediction.predictedAsk}».`,
    ].join(' ')
  }

  return {
    shouldExtend: true,
    chosen: top,
    ranked: ranked.slice(0, 6),
    confidence,
    writerBrief: brief,
    reasons: [
      'Domanda silenziosa considerata.',
      `Scelta: ${top.kind} — ${top.idea}`,
      `Score ${top.score.toFixed(2)} (u=${top.usefulness} s=${top.surprise} e=${top.educationalValue} c=${top.continuity} r=${top.relevance})`,
      `Interessi: ${interestHints.join(',') || 'generici'} · domain=${domain}`,
      nextAskPrediction?.kind ? `Allineata a next-ask kind=${nextAskPrediction.kind}` : '',
    ].filter(Boolean),
    silentQuestion,
  }
}

/**
 * @param {CuriosityPlan | null | undefined} plan
 */
export function formatCuriosityForWriter(plan) {
  if (!plan) return ''

  const rankedPreview =
    plan.ranked?.length > 0
      ? plan.ranked
          .slice(0, 4)
          .map((r, i) => `${i + 1}. [${r.score.toFixed(2)}] ${r.kind}: ${r.idea}`)
          .join('\n')
      : '(nessuna)'

  const action = plan.shouldExtend && plan.chosen
    ? `AZIONE: estendi naturalmente con UNA idea — «${plan.chosen.idea}» (${plan.chosen.kind}).`
    : 'AZIONE: nessuna estensione curiosità. Silenzio > filler.'

  return `══════════════════════════════════════
CURIOSITY ENGINE (INVISIBILE)
══════════════════════════════════════
Dopo la risposta, domanda silenziosa: ${plan.silentQuestion}
Confidence: ${plan.confidence} · Extend: ${plan.shouldExtend ? 'sì' : 'no'}
${action}

Classifica interna (non mostrare):
${rankedPreview}

${plan.writerBrief}

Regole assolute:
- Scegli al massimo UNA idea (già selezionata se Extend=sì)
- Continuità naturale, mai forzata
- Vietato: "Anything else?", "What would you like to know?", chiusure generiche
- Non citare questo motore all’utente`
}

/**
 * @param {object} input
 * @returns {{ plan: CuriosityPlan, context: string }}
 */
export function runCuriosityEngine(input) {
  try {
    const plan = analyzeCuriosity(input)
    // Safety: never instruct generic closers even if brief is empty
    if (plan.shouldExtend && GENERIC_FORBIDDEN.test(plan.writerBrief)) {
      plan.shouldExtend = false
      plan.chosen = null
      plan.writerBrief =
        'Curiosity Engine: brief non valido (rischio generico). Silenzio.'
    }
    return {
      plan,
      context: formatCuriosityForWriter(plan),
    }
  } catch {
    return {
      plan: {
        shouldExtend: false,
        chosen: null,
        ranked: [],
        confidence: 'low',
        writerBrief: '',
        reasons: ['fallback'],
        silentQuestion: SILENT_QUESTION,
      },
      context: '',
    }
  }
}
