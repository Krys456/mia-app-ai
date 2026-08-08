/**
 * LAIfe Information Value Estimator
 *
 * Estimate the value of every possible piece of information before including it.
 *
 * Score each candidate on:
 *   usefulness · novelty · relevance · actionability · clarity · educational value
 *
 * Discard low-value information.
 * Prefer fewer high-value ideas over many average ones.
 * Never add information only to make the response longer.
 *
 * Invisible. Fail-soft. Complements hierarchical source prioritization
 * (info-prioritization.js) which ranks *sources*; this ranks *content pieces*.
 */

/**
 * @typedef {object} InfoCandidate
 * @property {string} id
 * @property {string} kind
 * @property {string} text
 * @property {number} usefulness
 * @property {number} novelty
 * @property {number} relevance
 * @property {number} actionability
 * @property {number} clarity
 * @property {number} educationalValue
 * @property {number} score
 * @property {boolean} keep
 */

/**
 * @typedef {object} InformationValuePlan
 * @property {InfoCandidate[]} candidates
 * @property {InfoCandidate[]} kept
 * @property {InfoCandidate[]} discarded
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {number} threshold
 */

/** Minimum composite score to keep (0–5 scale) */
const KEEP_THRESHOLD = 3.35

/** Prefer few high-value ideas */
const MAX_KEEP = 3

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {InfoCandidate} c
 */
function compositeScore(c) {
  return (
    c.usefulness * 0.22 +
    c.novelty * 0.14 +
    c.relevance * 0.24 +
    c.actionability * 0.16 +
    c.clarity * 0.1 +
    c.educationalValue * 0.14
  )
}

/**
 * Build candidate information pieces for this turn (not filler).
 * @param {object} args
 * @returns {Omit<InfoCandidate, 'score' | 'keep'>[]}
 */
function buildCandidates(args) {
  const {
    userMessage,
    topic,
    realGoal,
    primaryIntent,
    secondaryRequests,
    alreadyExplained,
    openQuestions,
    keepFast,
    complexity,
  } = args

  const label = topic && topic !== 'generale' ? topic : 'la richiesta'
  const explained = new Set((alreadyExplained || []).map((x) => String(x).toLowerCase().slice(0, 40)))
  /** @type {Omit<InfoCandidate, 'score' | 'keep'>[]} */
  const raw = []

  // Core answer — always a candidate, high relevance
  raw.push({
    id: 'core_answer',
    kind: 'direct_answer',
    text: `Risposta diretta e chiara a: ${normalize(userMessage).slice(0, 120) || realGoal || label}`,
    usefulness: 5,
    novelty: 2.5,
    relevance: 5,
    actionability: primaryIntent === 'how_to' || primaryIntent === 'problem_solving' ? 4.5 : 3.5,
    clarity: 4.8,
    educationalValue: primaryIntent === 'explanation' ? 4.2 : 3.2,
  })

  // Why / mechanism
  if (
    /\b(perch|why|come\s+funziona|how\s+does)\b/i.test(userMessage) ||
    primaryIntent === 'explanation'
  ) {
    raw.push({
      id: 'why_mechanism',
      kind: 'mechanism',
      text: `Il perché / meccanismo sotto ${label} (una causa chiara, non un riassunto).`,
      usefulness: 4.4,
      novelty: 3.6,
      relevance: 4.6,
      actionability: 2.8,
      clarity: 4.2,
      educationalValue: 4.8,
    })
  }

  // Practical next step
  if (
    primaryIntent === 'how_to' ||
    primaryIntent === 'advice' ||
    primaryIntent === 'problem_solving' ||
    /\b(come\s+faccio|how\s+do\s+i|consigli|next\s+step)\b/i.test(userMessage)
  ) {
    raw.push({
      id: 'action_step',
      kind: 'action',
      text: `Una mossa pratica concreta su ${label} (eseguibile subito).`,
      usefulness: 4.8,
      novelty: 3.0,
      relevance: 4.7,
      actionability: 5,
      clarity: 4.5,
      educationalValue: 3.4,
    })
  }

  // Example
  if (/\b(esempio|example|per\s+esempio|mostra)\b/i.test(userMessage) || secondaryRequests?.includes?.('example')) {
    raw.push({
      id: 'example',
      kind: 'example',
      text: `Un esempio concreto legato a ${label}.`,
      usefulness: 4.5,
      novelty: 3.2,
      relevance: 4.5,
      actionability: 3.8,
      clarity: 4.6,
      educationalValue: 4.3,
    })
  }

  // Common pitfall / misconception
  if (!keepFast && (complexity === 'high' || primaryIntent === 'explanation' || primaryIntent === 'how_to')) {
    raw.push({
      id: 'pitfall',
      kind: 'pitfall',
      text: `Un errore comune / misconcezione su ${label} da evitare (una frase).`,
      usefulness: 4.2,
      novelty: 4.0,
      relevance: 4.0,
      actionability: 3.6,
      clarity: 4.0,
      educationalValue: 4.4,
    })
  }

  // Comparison
  if (/\b(vs|versus|differen|meglio|oppure|alternative|confront)\b/i.test(userMessage)) {
    raw.push({
      id: 'comparison',
      kind: 'comparison',
      text: `Confronto netto: ${label} vs alternativa più vicina — una differenza che conta.`,
      usefulness: 4.3,
      novelty: 3.5,
      relevance: 4.6,
      actionability: 3.5,
      clarity: 4.2,
      educationalValue: 4.0,
    })
  }

  // Open thread closure
  for (const q of (openQuestions || []).slice(0, 2)) {
    const qn = normalize(q)
    if (qn.length < 8) continue
    raw.push({
      id: `open_${qn.slice(0, 24)}`,
      kind: 'open_thread',
      text: `Chiudi il filo aperto solo se ancora rilevante: ${qn}`,
      usefulness: 3.8,
      novelty: 2.8,
      relevance: 4.2,
      actionability: 3.0,
      clarity: 3.8,
      educationalValue: 3.5,
    })
  }

  // Secondary requests from plan
  for (const sec of (secondaryRequests || []).slice(0, 3)) {
    const s = normalize(String(sec))
    if (!s) continue
    raw.push({
      id: `sec_${s.slice(0, 20)}`,
      kind: 'secondary',
      text: `Copri la richiesta secondaria: ${s}`,
      usefulness: 4.0,
      novelty: 2.5,
      relevance: 4.4,
      actionability: 3.2,
      clarity: 4.0,
      educationalValue: 3.2,
    })
  }

  // Low-value padding candidates (should usually be discarded) — for scoring contrast
  raw.push({
    id: 'padding_history',
    kind: 'padding',
    text: `Digressione storica generica su ${label} non chiesta.`,
    usefulness: 1.5,
    novelty: 3.5,
    relevance: 1.8,
    actionability: 1.0,
    clarity: 3.0,
    educationalValue: 2.5,
  })
  raw.push({
    id: 'padding_closer',
    kind: 'padding',
    text: 'Chiusura generica tipo “Posso aiutarti con altro?”',
    usefulness: 1.0,
    novelty: 1.0,
    relevance: 1.2,
    actionability: 1.0,
    clarity: 4.0,
    educationalValue: 1.0,
  })
  raw.push({
    id: 'padding_repeat',
    kind: 'padding',
    text: `Riformulazione di quanto già spiegato su ${label}.`,
    usefulness: 1.8,
    novelty: 1.2,
    relevance: 3.0,
    actionability: 1.5,
    clarity: 3.5,
    educationalValue: 1.5,
  })

  // Novelty penalty if already explained
  return raw.map((c) => {
    const hit = [...explained].some((e) => e && c.text.toLowerCase().includes(e.slice(0, 20)))
    if (hit) {
      return {
        ...c,
        novelty: Math.max(1, c.novelty - 1.5),
        usefulness: Math.max(1, c.usefulness - 0.8),
      }
    }
    if (keepFast && c.kind !== 'direct_answer' && c.kind !== 'action') {
      return { ...c, usefulness: Math.max(1, c.usefulness - 0.6), relevance: Math.max(1, c.relevance - 0.4) }
    }
    return c
  })
}

/**
 * Score, filter, and rank candidates.
 * @param {object} input
 * @returns {InformationValuePlan}
 */
export function estimateInformationValue(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const plan = input.plan || {}
  const u = plan.understanding || {}
  const session = input.session || {}

  const candidates = buildCandidates({
    userMessage,
    topic: u.topic || session.currentTopic || 'generale',
    realGoal: plan.realGoal || session.currentGoal || '',
    primaryIntent: u.primaryIntent || 'question',
    secondaryRequests: u.secondaryRequests || [],
    alreadyExplained: session.alreadyExplained || [],
    openQuestions: session.openQuestions || [],
    keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
    complexity: u.complexity || 'medium',
  }).map((c) => {
    const score = Math.round(compositeScore(c) * 100) / 100
    return { ...c, score, keep: score >= KEEP_THRESHOLD && c.kind !== 'padding' }
  })

  // Force-keep core answer if somehow below threshold
  const core = candidates.find((c) => c.id === 'core_answer')
  if (core) core.keep = true

  const ranked = [...candidates].sort((a, b) => b.score - a.score)
  let kept = ranked.filter((c) => c.keep)

  // Prefer fewer high-value: if many pass, keep top MAX_KEEP by score (always keep core)
  if (kept.length > MAX_KEEP) {
    const coreKept = kept.filter((c) => c.id === 'core_answer')
    const rest = kept.filter((c) => c.id !== 'core_answer').slice(0, MAX_KEEP - coreKept.length)
    const keepIds = new Set([...coreKept, ...rest].map((c) => c.id))
    for (const c of candidates) {
      if (!keepIds.has(c.id)) c.keep = false
    }
    kept = candidates.filter((c) => c.keep).sort((a, b) => b.score - a.score)
  }

  const discarded = candidates.filter((c) => !c.keep).sort((a, b) => b.score - a.score)

  const writerBrief = [
    'INFORMATION VALUE ESTIMATOR: valuta ogni pezzo prima di includerlo.',
    `Tieni SOLO idee ad alto valore (≤${MAX_KEEP}): ${kept.map((c) => `${c.kind}[${c.score}]`).join(', ') || '—'}.`,
    kept.length
      ? `Includi: ${kept.map((c) => c.text).join(' · ')}`
      : 'Nessun pezzo oltre la risposta minima.',
    discarded.length
      ? `Scarta (basso valore / padding): ${discarded
          .slice(0, 4)
          .map((c) => c.kind)
          .join(', ')}.`
      : '',
    'Preferisci poche idee forti a tante medie. Mai aggiungere info solo per allungare.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    candidates: ranked,
    kept,
    discarded,
    writerBrief,
    reasons: [
      `threshold=${KEEP_THRESHOLD}`,
      `kept=${kept.length}`,
      `discarded=${discarded.length}`,
      ...kept.slice(0, 3).map((c) => `keep_${c.id}:${c.score}`),
    ],
    threshold: KEEP_THRESHOLD,
  }
}

/**
 * @param {InformationValuePlan | null | undefined} plan
 */
export function formatInformationValueForWriter(plan) {
  if (!plan?.writerBrief) return ''

  const keptLines =
    plan.kept.length > 0
      ? plan.kept
          .map(
            (c) =>
              `- [${c.score.toFixed(2)}] ${c.kind}: ${c.text} (u=${c.usefulness} n=${c.novelty} r=${c.relevance} a=${c.actionability} c=${c.clarity} e=${c.educationalValue})`,
          )
          .join('\n')
      : '- (solo risposta minima)'

  const discardLines =
    plan.discarded.length > 0
      ? plan.discarded
          .slice(0, 5)
          .map((c) => `- [${c.score.toFixed(2)}] ${c.kind}: scartato`)
          .join('\n')
      : '- (nessuno)'

  return `══════════════════════════════════════
INFORMATION VALUE ESTIMATOR (INVISIBILE)
══════════════════════════════════════
Stima il valore di ogni pezzo di informazione PRIMA di includerlo.
Fattori: usefulness · novelty · relevance · actionability · clarity · educational value.
Soglia: ${plan.threshold} · Max idee tenute: ${MAX_KEEP}

TENERE (alto valore):
${keptLines}

SCARTARE (basso valore — non allungare):
${discardLines}

${plan.writerBrief}
Preferisci poche idee forti. Mai info “per riempire”. Non citare lo score.`.trim()
}

/**
 * @param {object} input
 * @returns {{ plan: InformationValuePlan, context: string }}
 */
export function runInformationValueEstimator(input = {}) {
  try {
    const plan = estimateInformationValue(input)
    return {
      plan,
      context: formatInformationValueForWriter(plan),
    }
  } catch {
    return {
      plan: {
        candidates: [],
        kept: [],
        discarded: [],
        writerBrief: '',
        reasons: ['fail_soft'],
        threshold: KEEP_THRESHOLD,
      },
      context: '',
    }
  }
}
