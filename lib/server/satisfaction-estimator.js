/**
 * LAIfe Satisfaction Estimator (pre-send gate)
 *
 * Before sending the response, estimate user satisfaction:
 * - Did the response answer the question?
 * - Did it provide enough value?
 * - Is anything obviously missing?
 * - Is the response repetitive?
 * - Is the explanation appropriately deep?
 * - Is there an unnecessary question?
 *
 * If satisfaction is predicted low → improve once before sending.
 * Do not iterate indefinitely. Maximum one refinement.
 *
 * Invisible. Fail-soft.
 */

/**
 * @typedef {'answered'|'value'|'missing'|'repetitive'|'depth'|'unnecessary_question'} SatisfactionDimension
 */

/**
 * @typedef {object} SatisfactionIssue
 * @property {SatisfactionDimension} dimension
 * @property {string} detail
 * @property {number} severity 0–1
 */

/**
 * @typedef {object} SatisfactionEstimate
 * @property {number} score 0–1
 * @property {boolean} low
 * @property {SatisfactionIssue[]} issues
 * @property {string[]} reasons
 * @property {string} refineBrief
 */

/** Below this → one refinement allowed */
const LOW_THRESHOLD = 0.58

const GENERIC_CLOSER =
  /\b(anything else|what would you like|posso aiutarti( con altro)?|hai altre domande|let me know if|fammi sapere|c['’]?è altro)\b/i

const WANT_EXAMPLE =
  /\b(esempio|example|per\s+esempio|mostra|show\s+me)\b/i

const WANT_STEPS =
  /\b(passo|step|come\s+faccio|how\s+(do|can)\s+i|procedura|checklist)\b/i

const WANT_WHY =
  /\b(perch[eé]|why|come\s+mai|how\s+come)\b/i

const WANT_CODE =
  /\b(codice|code|snippet|funzione|function|typescript|python|react)\b/i

const QUESTION_ASK =
  /\b(cos['’]?è|what\s+is|spieg|explain|come\s+funziona|how\s+does|perch|why|quando|when|dove|where)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Distinctive content tokens (≥4 chars), lowercased.
 * @param {string} text
 */
function tokens(text) {
  return normalize(text)
    .toLowerCase()
    .split(/[^a-zàèéìòù0-9]+/i)
    .filter((w) => w.length >= 4)
}

/**
 * @param {string} text
 */
function sentenceCount(text) {
  const parts = normalize(text).split(/(?<=[.!?…])\s+/).filter(Boolean)
  return Math.max(1, parts.length)
}

/**
 * @param {string} text
 */
function questionCount(text) {
  const m = normalize(text).match(/[?？]/g)
  return m ? m.length : 0
}

/**
 * Crude repetition: repeated 4-grams or very high self-overlap.
 * @param {string} text
 */
function repetitionScore(text) {
  const t = normalize(text).toLowerCase()
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 24) return 0
  /** @type {Map<string, number>} */
  const grams = new Map()
  for (let i = 0; i < words.length - 3; i++) {
    const g = words.slice(i, i + 4).join(' ')
    grams.set(g, (grams.get(g) || 0) + 1)
  }
  let repeats = 0
  for (const n of grams.values()) {
    if (n >= 2) repeats += n - 1
  }
  return Math.min(1, repeats / Math.max(3, words.length / 12))
}

/**
 * Overlap with prior assistant message (near-duplicate).
 * @param {string} draft
 * @param {string} priorAssistant
 */
function priorOverlap(draft, priorAssistant) {
  const a = new Set(tokens(draft))
  const b = new Set(tokens(priorAssistant))
  if (a.size < 8 || b.size < 8) return 0
  let hit = 0
  for (const w of a) if (b.has(w)) hit += 1
  return hit / a.size
}

/**
 * Estimate satisfaction for a draft reply.
 * @param {object} input
 * @param {string} input.userMessage
 * @param {string} input.draft
 * @param {string} [input.priorAssistant]
 * @param {{ keepFast?: boolean, complexity?: string, primaryIntent?: string } | null} [input.planHints]
 * @returns {SatisfactionEstimate}
 */
export function estimateSatisfaction(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const draft = normalize(input.draft || '')
  const priorAssistant = normalize(input.priorAssistant || '')
  const hints = input.planHints || {}

  /** @type {SatisfactionIssue[]} */
  const issues = []
  /** @type {string[]} */
  const reasons = []

  if (!draft) {
    return {
      score: 0,
      low: true,
      issues: [{ dimension: 'answered', detail: 'Risposta vuota', severity: 1 }],
      reasons: ['empty_draft'],
      refineBrief: 'La bozza è vuota: scrivi una risposta completa e utile alla richiesta.',
    }
  }

  const userTok = tokens(userMessage)
  const draftTok = new Set(tokens(draft))
  const coverage =
    userTok.length === 0
      ? 1
      : userTok.filter((w) => draftTok.has(w)).length / Math.min(userTok.length, 12)

  const isQuestion =
    /[?？]/.test(userMessage) || QUESTION_ASK.test(userMessage) || hints.primaryIntent === 'question'
  const sentences = sentenceCount(draft)
  const qCount = questionCount(draft)
  const rep = repetitionScore(draft)
  const overlap = priorOverlap(draft, priorAssistant)
  const keepFast = Boolean(hints.keepFast)
  const complex = hints.complexity === 'high' || userMessage.length > 120 || WANT_WHY.test(userMessage)

  // --- answered ---
  if (isQuestion && coverage < 0.22 && draft.length < 280) {
    issues.push({
      dimension: 'answered',
      detail: 'Copertura bassa rispetto alla domanda',
      severity: 0.85,
    })
  }
  if (isQuestion && draft.length < 40) {
    issues.push({
      dimension: 'answered',
      detail: 'Risposta troppo corta per una domanda',
      severity: 0.9,
    })
  }

  // --- value ---
  if (!keepFast && userMessage.length > 40 && draft.length < 70 && sentences <= 2) {
    issues.push({
      dimension: 'value',
      detail: 'Poco valore / troppo breve per la richiesta',
      severity: 0.7,
    })
  }

  // --- missing ---
  if (WANT_EXAMPLE.test(userMessage) && !WANT_EXAMPLE.test(draft) && !/\b(ad\s+esempio|for\s+example|es\.)\b/i.test(draft)) {
    issues.push({
      dimension: 'missing',
      detail: 'Manca un esempio richiesto',
      severity: 0.75,
    })
  }
  if (WANT_STEPS.test(userMessage) && !/^\s*([-*]|\d+[\).])/m.test(draft) && !/\b(prima|poi|quindi|step|passo)\b/i.test(draft)) {
    issues.push({
      dimension: 'missing',
      detail: 'Mancano passi / procedura richiesti',
      severity: 0.7,
    })
  }
  if (WANT_CODE.test(userMessage) && !/```/.test(draft) && !/\b(function|const |def |=>)\b/.test(draft)) {
    issues.push({
      dimension: 'missing',
      detail: 'Manca codice richiesto',
      severity: 0.8,
    })
  }
  if (WANT_WHY.test(userMessage) && !/\b(perché|perche|because|motivo|causa|funziona\s+così)\b/i.test(draft)) {
    issues.push({
      dimension: 'missing',
      detail: 'Manca la spiegazione del perché',
      severity: 0.65,
    })
  }

  // --- repetitive ---
  if (rep >= 0.35) {
    issues.push({
      dimension: 'repetitive',
      detail: 'Ripetizioni interne evidenti',
      severity: Math.min(1, rep),
    })
  }
  if (overlap >= 0.72 && draft.length > 120) {
    issues.push({
      dimension: 'repetitive',
      detail: 'Troppo simile alla risposta precedente',
      severity: 0.8,
    })
  }

  // --- depth ---
  if (complex && !keepFast && draft.length < 160 && sentences <= 3) {
    issues.push({
      dimension: 'depth',
      detail: 'Profondità insufficiente per la complessità della richiesta',
      severity: 0.7,
    })
  }
  if (WANT_WHY.test(userMessage) && draft.length > 80 && sentences <= 2) {
    issues.push({
      dimension: 'depth',
      detail: 'Spiegazione troppo superficiale',
      severity: 0.6,
    })
  }

  // --- unnecessary question ---
  if (GENERIC_CLOSER.test(draft)) {
    issues.push({
      dimension: 'unnecessary_question',
      detail: 'Chiusura generica / domanda inutile',
      severity: 0.55,
    })
  }
  if (qCount >= 3) {
    issues.push({
      dimension: 'unnecessary_question',
      detail: 'Troppe domande nella risposta',
      severity: 0.65,
    })
  }
  if (
    qCount >= 1 &&
    isQuestion &&
    !/\b(preferisci|which|quale|dimmi\s+se)\b/i.test(draft) &&
    coverage < 0.35 &&
    draft.length < 200
  ) {
    // Answering a question with mostly a question back
    const lastIsQ = /[?？]\s*$/.test(draft)
    if (lastIsQ && sentences <= 3) {
      issues.push({
        dimension: 'unnecessary_question',
        detail: 'Risponde principalmente con una domanda',
        severity: 0.7,
      })
    }
  }

  // Score: start high, subtract severities (diminishing)
  let score = 0.92
  for (const issue of issues) {
    score -= issue.severity * 0.14
    reasons.push(`${issue.dimension}:${issue.detail}`)
  }
  // Small boosts
  if (coverage >= 0.4) score += 0.03
  if (draft.length > 120 && sentences >= 3) score += 0.02
  score = Math.max(0, Math.min(1, score))

  const low = score < LOW_THRESHOLD && issues.length > 0

  return {
    score,
    low,
    issues,
    reasons: reasons.length ? reasons : ['ok'],
    refineBrief: low ? buildRefineBrief(issues, userMessage) : '',
  }
}

/**
 * @param {SatisfactionIssue[]} issues
 * @param {string} userMessage
 */
function buildRefineBrief(issues, userMessage) {
  const byDim = [...new Set(issues.map((i) => i.dimension))]
  const fixes = byDim.map((d) => {
    switch (d) {
      case 'answered':
        return 'Rispondi chiaramente alla richiesta dell’utente (non eludere).'
      case 'value':
        return 'Aggiungi un pezzo di valore concreto (insight, esempio o next step).'
      case 'missing':
        return 'Integra ciò che manca (esempio / passi / perché / codice) senza dilungarti.'
      case 'repetitive':
        return 'Elimina ripetizioni e non rifare la risposta precedente.'
      case 'depth':
        return 'Approfondisci un livello (idea → perché → dettaglio utile), restando chiaro.'
      case 'unnecessary_question':
        return 'Togli domande generiche di chiusura; al massimo UNA domanda aperta se serve davvero.'
      default:
        return 'Migliora utilità e chiarezza.'
    }
  })

  return [
    'SATISFACTION GATE: la bozza rischia bassa soddisfazione — UNA sola rifinitura.',
    `Richiesta utente: «${normalize(userMessage).slice(0, 200)}»`,
    `Problemi: ${issues.map((i) => i.dimension).join(', ')}.`,
    ...fixes,
    'Riscrivi la risposta completa migliorata. Stesso idioma dell’utente. Niente meta-commenti, niente “ecco la versione migliorata”.',
  ].join('\n')
}

/**
 * Run estimate; expose whether one refinement should run.
 * @param {object} input
 * @returns {{ estimate: SatisfactionEstimate, shouldRefine: boolean }}
 */
export function runSatisfactionEstimator(input = {}) {
  try {
    const estimate = estimateSatisfaction(input)
    return {
      estimate,
      shouldRefine: Boolean(estimate.low && estimate.refineBrief),
    }
  } catch {
    return {
      estimate: {
        score: 1,
        low: false,
        issues: [],
        reasons: ['fail_soft'],
        refineBrief: '',
      },
      shouldRefine: false,
    }
  }
}

/**
 * Instructions for the single refinement call.
 * @param {string} draft
 * @param {SatisfactionEstimate} estimate
 */
export function buildRefinementInstructions(draft, estimate) {
  return [
    'Sei il Writer di LAIfe. Devi migliorare UNA volta una bozza già scritta.',
    'Massimo una rifinitura — non iterare oltre.',
    estimate.refineBrief || 'Migliora chiarezza e utilità.',
    'Vincoli: non inventare fatti; non allungare a vuoto; non citare satisfaction/gate/motori.',
    'Output: solo il testo finale da mostrare all’utente.',
    '',
    'BOZZA DA MIGLIORARE:',
    draft,
  ].join('\n')
}
