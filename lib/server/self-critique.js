/**
 * LAIfe Self-Critique stage (pre-send)
 *
 * Before sending the final response, ask internally:
 *   - Is this generic?
 *   - Am I repeating myself?
 *   - Could this surprise the user?
 *   - Could I explain it more clearly?
 *   - Is there one sentence that adds little value?
 *
 * Perform one refinement if necessary.
 * Maximum one refinement. Avoid endless iterations.
 *
 * Invisible. Fail-soft. Complements Satisfaction Estimator
 * (same single refine budget in api/chat).
 */

/**
 * @typedef {'generic'|'repeating'|'surprise_gap'|'clarity'|'low_value_sentence'} CritiqueQuestion
 */

/**
 * @typedef {object} CritiqueFinding
 * @property {CritiqueQuestion} question
 * @property {boolean} flag  true = problem found (needs attention)
 * @property {string} detail
 * @property {number} severity 0–1
 */

/**
 * @typedef {object} SelfCritiquePlan
 * @property {CritiqueFinding[]} findings
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} reasons
 * @property {number} issueScore 0–1 aggregate
 */

/** Aggregate severity above this → one refinement */
const REFINE_THRESHOLD = 0.42

const GENERIC_OPENERS =
  /\b(in\s+(today'?s|questo)\s+world|it'?s\s+important\s+to\s+note|è\s+importante\s+(notare|sapere)|as\s+an\s+ai|come\s+intelligenza\s+artificiale|sono\s+laife\b|i'?m\s+laife\b|there\s+are\s+(many|several)\s+(ways|factors)|ci\s+sono\s+(molti|diversi)\s+(modi|fattori)|in\s+conclusione,?\s+possiamo\s+dire|come\s+posso\s+aiutarti|how\s+can\s+i\s+help|dimmi\s+pure|hai\s+domande)\b/i

const TEMPLATE_FILLER =
  /\b(i'?m\s+here\s+to\s+help|sono\s+qui\s+per\s+aiutarti|non\s+esitare\s+a|feel\s+free\s+to|let\s+me\s+know\s+if|fammi\s+sapere\s+se|posso\s+aiutarti\s+con\s+altro|hope\s+this\s+helps|spero\s+ti\s+sia\s+utile|ottima\s+domanda|great\s+question)\b/i

const HEDGE_STACK =
  /\b((in\s+generale|generally\s+speaking|basically|essentially|in\s+altre\s+parole|cioè|vale\s+a\s+dire).*){2,}/i

const OBVIOUS_PADDING =
  /\b(come\s+sai|as\s+you\s+(know|may\s+know)|needless\s+to\s+say|ovviamente\s+è\s+chiaro|it\s+goes\s+without\s+saying)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function sentences(text) {
  return normalize(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * @param {string} text
 */
function tokens(text) {
  return normalize(text)
    .toLowerCase()
    .split(/[^a-zàèéìòù0-9]+/i)
    .filter((w) => w.length >= 4)
}

/**
 * Internal n-gram repetition.
 * @param {string} text
 */
function selfRepetition(text) {
  const words = normalize(text).toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length < 20) return 0
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
  return Math.min(1, repeats / Math.max(3, words.length / 14))
}

/**
 * Overlap with prior assistant turn.
 * @param {string} draft
 * @param {string} prior
 */
function priorOverlap(draft, prior) {
  const a = new Set(tokens(draft))
  const b = new Set(tokens(prior))
  if (a.size < 8 || b.size < 8) return 0
  let hit = 0
  for (const w of a) if (b.has(w)) hit += 1
  return hit / a.size
}

/**
 * Heuristic: draft feels generic / interchangeable.
 * @param {string} draft
 * @param {string} userMessage
 */
function genericScore(draft, userMessage) {
  let score = 0
  if (GENERIC_OPENERS.test(draft)) score += 0.35
  if (TEMPLATE_FILLER.test(draft)) score += 0.4
  if (OBVIOUS_PADDING.test(draft)) score += 0.25
  const userTok = tokens(userMessage)
  const draftTok = new Set(tokens(draft))
  const coverage =
    userTok.length === 0
      ? 0.5
      : userTok.filter((w) => draftTok.has(w)).length / Math.min(userTok.length, 10)
  if (userMessage.length > 30 && coverage < 0.18 && draft.length > 200) score += 0.35
  // Very uniform sentence lengths → template-ish
  const sents = sentences(draft)
  if (sents.length >= 4) {
    const lens = sents.map((s) => s.split(/\s+/).length)
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length
    const varSum = lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length
    if (varSum < 6 && avg > 12) score += 0.2
  }
  return Math.min(1, score)
}

/**
 * Clarity: long sentences, hedge stacks, no concrete anchor.
 * @param {string} draft
 * @param {string} userMessage
 */
function clarityGap(draft, userMessage) {
  let score = 0
  const sents = sentences(draft)
  const long = sents.filter((s) => s.split(/\s+/).length > 38).length
  if (long >= 2) score += 0.35
  if (long >= 4) score += 0.2
  if (HEDGE_STACK.test(draft)) score += 0.3
  // User asked how/why but draft has few causal markers
  if (
    /\b(come\s+funziona|how\s+does|perch[eé]|why|spieg)\b/i.test(userMessage) &&
    !/\b(perché|perche|because|così|in\s+pratica|ad\s+esempio|for\s+example)\b/i.test(draft)
  ) {
    score += 0.4
  }
  return Math.min(1, score)
}

/**
 * Surprise opportunity: teaching turn with no twist / concrete image.
 * @param {string} draft
 * @param {string} userMessage
 * @param {boolean} teachingLikely
 */
function surpriseGap(draft, userMessage, teachingLikely) {
  if (!teachingLikely && !/\b(spieg|explain|cos['’]?è|what\s+is|come\s+funziona)\b/i.test(userMessage)) {
    return 0
  }
  let score = 0.15 // baseline: explanations can often use one sharper angle
  const hasConcrete =
    /\b(ad\s+esempio|for\s+example|immagina|picture|tipo|come\s+se|in\s+pratica|es\.)\b/i.test(
      draft,
    ) || /```/.test(draft)
  const hasTwist =
    /\b(in\s+realtà|unexpected|controintuitiv|il\s+punto\s+poco\s+ovvio|what\s+most\s+people|pochi\s+notano)\b/i.test(
      draft,
    )
  if (!hasConcrete) score += 0.35
  if (!hasTwist && draft.length > 280) score += 0.25
  if (TEMPLATE_FILLER.test(draft)) score += 0.15
  return Math.min(1, score)
}

/**
 * Find a sentence that likely adds little value.
 * @param {string} draft
 * @returns {{ found: boolean, sentence: string, severity: number }}
 */
function lowValueSentence(draft) {
  const sents = sentences(draft)
  if (sents.length < 3) return { found: false, sentence: '', severity: 0 }

  let best = { found: false, sentence: '', severity: 0 }
  for (const s of sents) {
    let sev = 0
    const words = s.split(/\s+/).length
    if (TEMPLATE_FILLER.test(s)) sev += 0.7
    if (GENERIC_OPENERS.test(s)) sev += 0.55
    if (OBVIOUS_PADDING.test(s)) sev += 0.5
    if (words <= 4 && !/[?？]/.test(s) && !/`/.test(s)) sev += 0.25
    // Restates without adding: "This is important." / "È fondamentale."
    if (/^(this\s+is\s+important|è\s+(fondamentale|importante|utile)|vale\s+la\s+pena)[.!]?$/i.test(s)) {
      sev += 0.65
    }
    if (sev > best.severity) {
      best = { found: sev >= 0.45, sentence: s, severity: Math.min(1, sev) }
    }
  }
  return best
}

/**
 * @param {CritiqueFinding[]} findings
 */
function buildRefineBrief(findings) {
  const flagged = findings.filter((f) => f.flag)
  if (flagged.length === 0) return ''

  const lines = flagged.map((f) => {
    switch (f.question) {
      case 'generic':
        return `- Meno generico: ${f.detail} → ancora al caso concreto dell’utente; taglia aperture/chiusure da template.`
      case 'repeating':
        return `- Meno ripetizioni: ${f.detail} → una sola formulazione chiara per idea.`
      case 'surprise_gap':
        return `- Un angolo più vivo: ${f.detail} → un esempio concreto o un dettaglio poco ovvio (senza cliffhanger).`
      case 'clarity':
        return `- Più chiaro: ${f.detail} → frasi più corte; idea → perché → dettaglio.`
      case 'low_value_sentence':
        return `- Taglia o sostituisci la frase a basso valore: «${f.detail}».`
      default:
        return `- ${f.detail}`
    }
  })

  return [
    'Self-Critique: una sola rifinitura della bozza.',
    ...lines,
    'Vincoli: non inventare; non allungare; mantieni le idee forti; testo finale solo; non citare self-critique/motori.',
  ].join('\n')
}

/**
 * Run self-critique on a draft reply.
 * @param {object} [input]
 * @returns {SelfCritiquePlan}
 */
export function analyzeSelfCritique(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const draft = normalize(input.draft || '')
  const priorAssistant = normalize(input.priorAssistant || '')
  const teachingLikely = Boolean(
    input.planHints?.teachingLikely ||
      /\b(spieg|explain|cos['’]?è|what\s+is|come\s+funziona|how\s+does|perch)\b/i.test(userMessage),
  )

  /** @type {CritiqueFinding[]} */
  const findings = []
  /** @type {string[]} */
  const reasons = []

  if (!draft) {
    return {
      findings: [
        {
          question: 'clarity',
          flag: true,
          detail: 'Bozza vuota',
          severity: 1,
        },
      ],
      needsRefine: true,
      refineBrief: 'Self-Critique: la bozza è vuota — scrivi una risposta chiara e utile (una sola passata).',
      reasons: ['empty_draft'],
      issueScore: 1,
    }
  }

  // 1) Is this generic?
  const g = genericScore(draft, userMessage)
  findings.push({
    question: 'generic',
    flag: g >= 0.4,
    detail: g >= 0.4 ? 'Tono/template troppo generico' : 'Specificità ok',
    severity: g,
  })
  if (g >= 0.4) reasons.push(`generic=${g.toFixed(2)}`)

  // 2) Am I repeating myself?
  const rep = selfRepetition(draft)
  const overlap = priorOverlap(draft, priorAssistant)
  const repSev = Math.max(rep, overlap >= 0.7 ? overlap : 0)
  findings.push({
    question: 'repeating',
    flag: repSev >= 0.35,
    detail:
      overlap >= 0.7
        ? 'Troppa sovrapposizione col turno precedente'
        : rep >= 0.35
          ? 'Ripetizioni interne'
          : 'Poche ripetizioni',
    severity: repSev,
  })
  if (repSev >= 0.35) reasons.push(`repeating=${repSev.toFixed(2)}`)

  // 3) Could this surprise the user?
  const sur = surpriseGap(draft, userMessage, teachingLikely)
  findings.push({
    question: 'surprise_gap',
    flag: sur >= 0.45,
    detail: sur >= 0.45 ? 'Manca un angolo concreto / poco ovvio' : 'Abbastanza vivo',
    severity: sur,
  })
  if (sur >= 0.45) reasons.push(`surprise_gap=${sur.toFixed(2)}`)

  // 4) Could I explain it more clearly?
  const clar = clarityGap(draft, userMessage)
  findings.push({
    question: 'clarity',
    flag: clar >= 0.4,
    detail: clar >= 0.4 ? 'Chiarezza migliorabile' : 'Chiarezza ok',
    severity: clar,
  })
  if (clar >= 0.4) reasons.push(`clarity=${clar.toFixed(2)}`)

  // 5) Is there one sentence that adds little value?
  const low = lowValueSentence(draft)
  findings.push({
    question: 'low_value_sentence',
    flag: low.found,
    detail: low.found ? low.sentence.slice(0, 120) : 'Nessuna frase filler evidente',
    severity: low.severity,
  })
  if (low.found) reasons.push('low_value_sentence')

  const issueScore =
    findings.reduce((a, f) => a + (f.flag ? f.severity : 0), 0) /
    Math.max(1, findings.filter((f) => f.flag).length || 1)

  const weighted =
    findings.reduce((a, f) => a + f.severity * (f.flag ? 1 : 0.15), 0) / findings.length

  const needsRefine = weighted >= REFINE_THRESHOLD && findings.some((f) => f.flag)
  const refineBrief = needsRefine ? buildRefineBrief(findings) : ''

  return {
    findings,
    needsRefine,
    refineBrief,
    reasons: reasons.length ? reasons : ['critique_clean'],
    issueScore: Math.round(Math.max(issueScore, weighted) * 100) / 100,
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: SelfCritiquePlan, shouldRefine: boolean }}
 */
export function runSelfCritique(input = {}) {
  try {
    const plan = analyzeSelfCritique(input)
    return {
      plan,
      shouldRefine: Boolean(plan.needsRefine && plan.refineBrief),
    }
  } catch {
    return {
      plan: {
        findings: [],
        needsRefine: false,
        refineBrief: '',
        reasons: ['fail_soft'],
        issueScore: 0,
      },
      shouldRefine: false,
    }
  }
}

/**
 * Build instructions for the single refinement call (Self-Critique).
 * @param {string} draft
 * @param {SelfCritiquePlan} plan
 */
export function buildSelfCritiqueRefinementInstructions(draft, plan) {
  return [
    'Sei il Writer di LAIfe. Esegui UNA sola rifinitura (Self-Critique). Mai un secondo loop.',
    'Domande già valutate: generico? ripetitivo? sorpresa possibile? chiarezza? frase a basso valore?',
    plan.refineBrief || 'Migliora chiarezza e densità senza allungare.',
    'Restituisci solo il testo finale migliorato.',
    'Bozza da rifinire:',
    '---',
    normalize(draft),
    '---',
  ].join('\n')
}

/**
 * Merge Self-Critique + Satisfaction into one refine budget.
 * @param {object} opts
 * @param {boolean} opts.satisfactionShouldRefine
 * @param {string} [opts.satisfactionBrief]
 * @param {boolean} opts.critiqueShouldRefine
 * @param {string} [opts.critiqueBrief]
 * @param {string[]} [opts.companionBriefs]
 * @param {string} opts.draft
 * @returns {{ shouldRefine: boolean, instructions: string, sources: string[] }}
 */
export function mergePreSendRefineBudget(opts) {
  const sources = []
  /** @type {string[]} */
  const briefs = []

  if (opts.critiqueShouldRefine && opts.critiqueBrief) {
    sources.push('self_critique')
    briefs.push(opts.critiqueBrief)
  }
  if (opts.satisfactionShouldRefine && opts.satisfactionBrief) {
    sources.push('satisfaction')
    briefs.push(opts.satisfactionBrief)
  }
  if (Array.isArray(opts.companionBriefs)) {
    for (const b of opts.companionBriefs) {
      const t = String(b || '').trim()
      if (!t) continue
      sources.push('companion_guard')
      briefs.push(t)
    }
  }

  if (briefs.length === 0) {
    return { shouldRefine: false, instructions: '', sources: [] }
  }

  const instructions = [
    'Sei il Writer di LAIfe. Esegui UNA sola rifinitura pre-invio (budget unico: Self-Critique + Satisfaction + Conversation Delight + companion guards).',
    'Mai un secondo loop. Non inventare. Non allungare a vuoto. Non citare motori/gate.',
    'Priorità: togli generico/ripetizioni/filler/helpdesk; alza piacevolezza e vita; un dettaglio vivo se manca; mantieni le idee forti; suona come un interlocutore a cui piace parlare, non un chatbot.',
    ...briefs,
    'Restituisci solo il testo finale migliorato.',
    'Bozza:',
    '---',
    normalize(opts.draft),
    '---',
  ].join('\n')

  return { shouldRefine: true, instructions, sources }
}
