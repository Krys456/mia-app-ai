/**
 * LAIfe Intellectual Initiative Engine
 *
 * Before finishing every response, silently ask:
 * "Is there one additional insight that would genuinely make this conversation more valuable?"
 *
 * If YES → add exactly ONE high-value addition:
 *   surprising fact · practical example · common misconception · historical connection ·
 *   psychological insight · comparison · real-world application · future implication
 *
 * Feel: "Here's something interesting…" — never filler, never unnecessarily longer.
 * Only continue when the insight significantly improves the conversation.
 *
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'surprising_fact'|'practical_example'|'common_misconception'|'historical_connection'|'psychological_insight'|'comparison'|'real_world_application'|'future_implication'} InitiativeKind
 */

/**
 * @typedef {object} InitiativeInsight
 * @property {string} id
 * @property {InitiativeKind} kind
 * @property {string} seed
 * @property {number} valueLift
 * @property {number} surprise
 * @property {number} relevance
 * @property {number} novelty
 * @property {number} brevityFit
 * @property {number} score
 */

/**
 * @typedef {object} IntellectualInitiativePlan
 * @property {boolean} shouldAdd
 * @property {InitiativeInsight | null} chosen
 * @property {InitiativeInsight[]} ranked
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {string} silentQuestion
 */

const SILENT_QUESTION =
  'Is there one additional insight that would genuinely make this conversation more valuable?'

/** High bar — only when the addition significantly improves the turn */
const SCORE_THRESHOLD = 3.45

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const THANKS_FINISH =
  /^(grazie(\s+(mille|tante|ancora))?|thanks(\s+a\s+lot)?|thank\s+you(\s+so\s+much)?|thx|ty)([\s!,.]*(ok|okay|bye|ciao)?)?[\s!.]*$/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const MINIMAL_ASK =
  /\b(in\s+breve|veloce|quick|tl;?dr|solo\s+s[iì]|yes\s+or\s+no|risposta\s+breve)\b/i

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|autoles|non\s+ce\s+la\s+faccio|aiuto\s+urgente|crisis)\b/i

const RECENT_INITIATIVE_CUE =
  /(ecco\s+una\s+cosa\s+interessante|un\s+dettaglio\s+interessante|curiosit[aà]\s*:|here's\s+something\s+interesting|interesting\s+aside|a\s+proposito|💡)/i

/** @type {Record<InitiativeKind, string>} */
const KIND_LABEL = {
  surprising_fact: 'fatto sorprendente',
  practical_example: 'esempio pratico',
  common_misconception: 'misconcezione comune',
  historical_connection: 'collegamento storico',
  psychological_insight: 'insight psicologico',
  comparison: 'confronto',
  real_world_application: 'applicazione reale',
  future_implication: 'implicazione futura',
}

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
  return t.length > 56 ? `${t.slice(0, 53)}…` : t
}

/**
 * @param {ChatTurn[]} turns
 */
function countRecentInitiativeBeats(turns) {
  let n = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role === 'user' && t.content.length >= 40) break
    if (t.role === 'assistant' && RECENT_INITIATIVE_CUE.test(t.content)) n += 1
    if (n >= 2) break
  }
  return n
}

/**
 * Soft domain from topic + message.
 * @param {string} topic
 * @param {string} userMessage
 */
function detectDomain(topic, userMessage) {
  const blob = `${topic}\n${userMessage}`
  if (/\b(codice|code|api|react|sql|git|typescript|python|css|deploy|bug|function)\b/i.test(blob)) {
    return 'tech'
  }
  if (/\b(fisica|chimica|biolog|scientif|physics|biology|neuron|quantum)\b/i.test(blob)) {
    return 'science'
  }
  if (/\b(storia|history|secolo|guerra|antico|epoca)\b/i.test(blob)) return 'history'
  if (/\b(mente|psicolog|abitud|habit|emozion|motivaz|bias)\b/i.test(blob)) return 'psych'
  if (/\b(soldi|invest|finanz|business|startup|marketing)\b/i.test(blob)) return 'business'
  return 'general'
}

/**
 * @param {object} args
 * @returns {InitiativeInsight[]}
 */
function generateCandidates(args) {
  const { topic, domain, teachingLikely, openQuestions, alreadyExplained } = args
  const label = topicLabel(topic)
  /** @type {Array<Omit<InitiativeInsight, 'score'>>} */
  const raw = []

  raw.push({
    id: 'fact',
    kind: 'surprising_fact',
    seed: `Un fatto poco ovvio su ${label} che ribalta un’intuizione comune (1–2 frasi).`,
    valueLift: teachingLikely ? 4.2 : 3.6,
    surprise: 4.6,
    relevance: 3.8,
    novelty: 4.4,
    brevityFit: 4.5,
  })

  raw.push({
    id: 'example',
    kind: 'practical_example',
    seed: `Un esempio concreto e breve di ${label} nella vita reale (niente checklist).`,
    valueLift: 4.5,
    surprise: 3.0,
    relevance: 4.6,
    novelty: 3.2,
    brevityFit: 4.4,
  })

  raw.push({
    id: 'myth',
    kind: 'common_misconception',
    seed: `Una misconcezione frequente su ${label} e la correzione in una frase.`,
    valueLift: 4.4,
    surprise: 4.0,
    relevance: 4.2,
    novelty: 3.8,
    brevityFit: 4.6,
  })

  raw.push({
    id: 'history',
    kind: 'historical_connection',
    seed: `Un collegamento storico breve che dà prospettiva a ${label}.`,
    valueLift: domain === 'history' || domain === 'science' ? 4.3 : 3.2,
    surprise: 4.2,
    relevance: domain === 'history' ? 4.5 : 3.0,
    novelty: 4.1,
    brevityFit: 4.2,
  })

  raw.push({
    id: 'psych',
    kind: 'psychological_insight',
    seed: `Un insight psicologico su perché ${label} “funziona” (o fallisce) nelle persone.`,
    valueLift: domain === 'psych' || teachingLikely ? 4.3 : 3.5,
    surprise: 3.8,
    relevance: 4.0,
    novelty: 3.7,
    brevityFit: 4.3,
  })

  raw.push({
    id: 'compare',
    kind: 'comparison',
    seed: `Un confronto netto: ${label} vs l’alternativa più vicina — una sola differenza che conta.`,
    valueLift: 4.1,
    surprise: 3.4,
    relevance: 4.3,
    novelty: 3.5,
    brevityFit: 4.5,
  })

  raw.push({
    id: 'apply',
    kind: 'real_world_application',
    seed: `Dove ${label} appare nel mondo reale oggi — un’applicazione concreta, non astratta.`,
    valueLift: 4.4,
    surprise: 3.2,
    relevance: 4.5,
    novelty: 3.3,
    brevityFit: 4.4,
  })

  raw.push({
    id: 'future',
    kind: 'future_implication',
    seed: `Una implicazione futura plausibile di ${label} (non hype — una conseguenza concreta).`,
    valueLift: domain === 'tech' || domain === 'science' ? 4.2 : 3.3,
    surprise: 4.0,
    relevance: 3.6,
    novelty: 4.3,
    brevityFit: 4.2,
  })

  // Open thread can boost a practical_example / misconception if unanswered
  if (Array.isArray(openQuestions) && openQuestions[0]) {
    const q = normalize(openQuestions[0])
    if (q.length >= 8) {
      raw.push({
        id: 'open-apply',
        kind: 'real_world_application',
        seed: `Chiudi il filo aperto con un’applicazione concreta: ${q}`,
        valueLift: 4.7,
        surprise: 2.8,
        relevance: 4.8,
        novelty: 3.0,
        brevityFit: 4.2,
      })
    }
  }

  // Downrank seeds that look already covered
  const explained = (alreadyExplained || []).map((e) => String(e).toLowerCase())

  return raw
    .map((c) => {
      let score =
        c.valueLift * 0.34 +
        c.surprise * 0.18 +
        c.relevance * 0.22 +
        c.novelty * 0.14 +
        c.brevityFit * 0.12
      if (explained.some((e) => e && c.seed.toLowerCase().includes(e.slice(0, 20)))) {
        score -= 0.8
      }
      if (domain === 'tech' && (c.kind === 'practical_example' || c.kind === 'common_misconception')) {
        score += 0.2
      }
      if (domain === 'science' && (c.kind === 'surprising_fact' || c.kind === 'historical_connection')) {
        score += 0.2
      }
      if (teachingLikely && (c.kind === 'common_misconception' || c.kind === 'practical_example')) {
        score += 0.15
      }
      return { ...c, score: Math.round(score * 100) / 100 }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * @param {object} args
 * @returns {{ suppress: boolean, reasons: string[] }}
 */
function shouldSuppress(args) {
  const {
    userMessage,
    keepFast,
    emotionalTone,
    continuationOwnsTurn,
    lastAssistant,
    recentBeats,
    topicLeadership,
  } = args
  /** @type {string[]} */
  const reasons = []

  if (!userMessage) {
    reasons.push('empty')
    return { suppress: true, reasons }
  }
  if (STOP_SIGNAL.test(userMessage) || THANKS_FINISH.test(userMessage)) {
    reasons.push('stop_or_thanks')
    return { suppress: true, reasons }
  }
  if (GREETING_ONLY.test(userMessage)) {
    reasons.push('greeting')
    return { suppress: true, reasons }
  }
  if (MINIMAL_ASK.test(userMessage) || keepFast) {
    reasons.push('minimal_or_fast')
    return { suppress: true, reasons }
  }
  if (continuationOwnsTurn) {
    reasons.push('continuation_owns')
    return { suppress: true, reasons }
  }
  if (topicLeadership) {
    reasons.push('topic_leadership')
    return { suppress: true, reasons }
  }
  if (DISTRESS.test(userMessage) || emotionalTone === 'distressed' || emotionalTone === 'sad') {
    reasons.push('emotional_care')
    return { suppress: true, reasons }
  }
  if (recentBeats >= 2) {
    reasons.push('recent_initiative_beats')
    return { suppress: true, reasons }
  }
  if (RECENT_INITIATIVE_CUE.test(lastAssistant) && lastAssistant.length < 900) {
    reasons.push('last_turn_already_had_aside')
    return { suppress: true, reasons }
  }
  return { suppress: false, reasons: ['eligible'] }
}

/**
 * @param {InitiativeInsight} insight
 */
function buildAddBrief(insight) {
  const label = KIND_LABEL[insight.kind] || insight.kind
  return [
    'INTELLECTUAL INITIATIVE: sì — un solo insight ad alto valore.',
    `Tipo: ${label} (${insight.kind}).`,
    `Seed: ${insight.seed}`,
    'Tono: “Ecco una cosa interessante…” — naturale, non filler.',
    'Lunghezza: 1–3 frasi max; non allungare il resto della risposta.',
    'Vietato: liste di extras, “Another thing…”, ripetere il corpo, domande generiche di chiusura.',
  ].join(' ')
}

/**
 * @param {object} input
 * @returns {IntellectualInitiativePlan}
 */
export function analyzeIntellectualInitiative(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const session = input.session || null
  const planHints = input.planHints || null
  const continuation = input.continuation || null

  const topic = session?.currentTopic || planHints?.topic || 'generale'
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')?.content || ''
  const teachingLikely =
    planHints?.teachingLikely === true ||
    /\b(perché|perche|come\s+funziona|in\s+pratica|spieg|explain|how\s+|because)\b/i.test(
      `${userMessage}\n${lastAssistant}`,
    )

  const suppress = shouldSuppress({
    userMessage,
    keepFast: Boolean(planHints?.keepFast),
    emotionalTone: planHints?.emotionalTone || 'neutral',
    continuationOwnsTurn: Boolean(continuation?.isShortMessage),
    lastAssistant,
    recentBeats: countRecentInitiativeBeats(turns),
    topicLeadership: Boolean(input.topicLeadership?.shouldLead),
  })

  if (suppress.suppress) {
    return {
      shouldAdd: false,
      chosen: null,
      ranked: [],
      confidence: 'high',
      writerBrief:
        'Intellectual Initiative: NO — nessuna aggiunta. Completa e chiudi; niente filler.',
      reasons: [SILENT_QUESTION, ...suppress.reasons],
      silentQuestion: SILENT_QUESTION,
    }
  }

  const domain = detectDomain(topic, userMessage)
  const ranked = generateCandidates({
    topic,
    domain,
    teachingLikely,
    openQuestions: session?.openQuestions || [],
    alreadyExplained: session?.alreadyExplained || [],
  })

  const top = ranked[0] || null
  const second = ranked[1]
  const margin = top && second ? top.score - second.score : top ? top.score : 0

  // Silent question answer: only YES above threshold with meaningful lift
  if (!top || top.score < SCORE_THRESHOLD || top.valueLift < 3.8) {
    return {
      shouldAdd: false,
      chosen: null,
      ranked: ranked.slice(0, 5),
      confidence: 'medium',
      writerBrief:
        'Intellectual Initiative: NO — l’insight non migliorerebbe abbastanza la conversazione. Non allungare.',
      reasons: [
        SILENT_QUESTION,
        top ? `Top score ${top.score.toFixed(2)} / valueLift ${top.valueLift} sotto bar.` : 'Nessun candidato.',
      ],
      silentQuestion: SILENT_QUESTION,
    }
  }

  // Require clear improvement signal for medium-context turns
  if (!teachingLikely && top.score < 3.65 && margin < 0.08) {
    return {
      shouldAdd: false,
      chosen: null,
      ranked: ranked.slice(0, 5),
      confidence: 'low',
      writerBrief:
        'Intellectual Initiative: NO — margine insufficiente; meglio silenzio che filler.',
      reasons: [SILENT_QUESTION, 'weak_margin'],
      silentQuestion: SILENT_QUESTION,
    }
  }

  const confidence = top.score >= 3.85 && (margin >= 0.1 || top.valueLift >= 4.4) ? 'high' : 'medium'

  return {
    shouldAdd: true,
    chosen: top,
    ranked: ranked.slice(0, 6),
    confidence,
    writerBrief: buildAddBrief(top),
    reasons: [
      SILENT_QUESTION,
      'YES — un insight migliorerebbe davvero la conversazione.',
      `Scelta: ${top.kind} — ${top.seed}`,
      `Score ${top.score.toFixed(2)} (v=${top.valueLift} s=${top.surprise} r=${top.relevance} n=${top.novelty} b=${top.brevityFit})`,
      `domain=${domain}`,
    ],
    silentQuestion: SILENT_QUESTION,
  }
}

/**
 * @param {IntellectualInitiativePlan | null | undefined} plan
 */
export function formatIntellectualInitiativeForWriter(plan) {
  if (!plan) return ''

  const rankedPreview =
    plan.ranked?.length > 0
      ? plan.ranked
          .slice(0, 4)
          .map((r, i) => `${i + 1}. [${r.score.toFixed(2)}] ${r.kind}: ${r.seed}`)
          .join('\n')
      : '(nessuna)'

  const action =
    plan.shouldAdd && plan.chosen
      ? `AZIONE: aggiungi ESATTAMENTE UN insight (${plan.chosen.kind}) — «${plan.chosen.seed}». Tono “Ecco una cosa interessante…”. 1–3 frasi.`
      : 'AZIONE: nessuna aggiunta. Non allungare. Silenzio > filler.'

  return `══════════════════════════════════════
INTELLECTUAL INITIATIVE ENGINE (INVISIBILE)
══════════════════════════════════════
Domanda silenziosa: ${plan.silentQuestion}
ShouldAdd=${plan.shouldAdd ? 'yes' : 'no'} · Confidence=${plan.confidence}

Candidati:
${rankedPreview}

${action}

Mai filler. Mai liste di extras. Mai allungare senza valore.
Non citare questo motore.`.trim()
}

/**
 * @param {object} input
 * @returns {{ plan: IntellectualInitiativePlan, context: string }}
 */
export function runIntellectualInitiativeEngine(input = {}) {
  try {
    const plan = analyzeIntellectualInitiative(input)
    return {
      plan,
      context: formatIntellectualInitiativeForWriter(plan),
    }
  } catch {
    return {
      plan: {
        shouldAdd: false,
        chosen: null,
        ranked: [],
        confidence: 'low',
        writerBrief: '',
        reasons: ['fail_soft'],
        silentQuestion: SILENT_QUESTION,
      },
      context: '',
    }
  }
}
