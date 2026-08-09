/**
 * LAIfe Self Reflection Engine
 *
 * Mission: before sending the final response, perform one silent self-review.
 * Purpose is not grammar — it is conversational quality.
 *
 * Internally ask:
 *   1. Is this response natural?
 *   2. Would I enjoy receiving this reply?
 *   3. Does it sound repetitive?
 *   4. Am I asking an unnecessary question?
 *   5. Is there a more interesting observation?
 *   6. Am I adding value or just filling space?
 *   7. Does this response move the conversation forward naturally?
 *   8. Does it respect the user's emotional state?
 *   9. Is the ending memorable?
 *  10. Would a thoughtful human be satisfied with this reply?
 *
 * If any answer is "no", refine once before returning.
 * At most one refinement pass. Never loop. Never expose the process.
 * Goal: higher quality — not longer responses.
 *
 * Runs AFTER Conversation Memory Flow and BEFORE the Writer (pre-brief),
 * plus a pre-send gate in api/chat (shared refine budget).
 * Distinct from Self-Critique (generic/clarity heuristics).
 * Invisible. Fail-soft.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'natural'|'enjoyable'|'repetitive'|'unnecessary_question'|'interesting_observation'|'value_vs_filler'|'moves_forward'|'emotional_respect'|'memorable_ending'|'thoughtful_satisfaction'} ReflectionQuestionId
 */

/**
 * @typedef {object} ReflectionAnswer
 * @property {ReflectionQuestionId} id
 * @property {string} question
 * @property {boolean} ok  true = pass ("yes"); false = needs attention ("no")
 * @property {string} detail
 * @property {number} severity 0–1
 */

/**
 * @typedef {object} SelfReflectionPlan
 * @property {boolean} active
 * @property {string[]} checklist
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 */

/**
 * @typedef {object} SelfReflectionGate
 * @property {ReflectionAnswer[]} answers
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {number} failScore
 */

const CHECKLIST = [
  'Is this response natural?',
  'Would I enjoy receiving this reply?',
  'Does it sound repetitive?',
  'Am I asking an unnecessary question?',
  'Is there a more interesting observation?',
  'Am I adding value or just filling space?',
  'Does this response move the conversation forward naturally?',
  'Does it respect the user\'s emotional state?',
  'Is the ending memorable?',
  'Would a thoughtful human be satisfied with this reply?',
]

const GENERIC_ACK =
  /^(certo|ecco|capisco|assolutamente|ottima\s+domanda|great\s+question|of\s+course|absolutely|sure[!.,]|i\s+understand|got\s+it)[.!]?\s+/i

const HELP_DESK_END =
  /(fammi\s+sapere|let\s+me\s+know|se\s+vuoi|if\s+you\s+(want|like|need)|feel\s+free|sono\s+qui|i'?m\s+here|any\s+questions|hai\s+domande|what\s+do\s+you\s+think\??\s*$|cosa\s+ne\s+pensi\??\s*$)/i

const FILLER =
  /\b(i'?m\s+here\s+to\s+help|sono\s+qui\s+per\s+aiutarti|hope\s+this\s+helps|spero\s+ti\s+sia\s+utile|in\s+oggi'?s\s+world|it'?s\s+important\s+to\s+note|è\s+importante\s+notare)\b/i

const EMOTIONAL_USER =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|worried|preoccupat|mi\s+sento)\b/i

const MOTIVATIONAL_GENERIC =
  /\b(you\s+got\s+this|puoi\s+farcela|credi\s+in\s+te|believe\s+in\s+yourself|everything\s+will\s+be\s+ok|andrà\s+tutto\s+bene[!]*\s*$)\b/i

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
 * @param {string} text
 */
function selfRepetition(text) {
  const words = normalize(text).toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length < 18) return 0
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
 * Count trailing / interrogative questions.
 * @param {string} draft
 */
function questionStats(draft) {
  const sents = sentences(draft)
  const qCount = (draft.match(/\?/g) || []).length
  const endsWithQ = /\?\s*$/.test(normalize(draft))
  const last = sents[sents.length - 1] || ''
  const interviewish = HELP_DESK_END.test(last) || /^(what|how|do\s+you|vuoi|preferisci)\b/i.test(last)
  return { qCount, endsWithQ, interviewish, sentCount: sents.length }
}

/**
 * Pre-Writer plan: silent checklist for the Writer.
 * @param {object} [input]
 * @returns {SelfReflectionPlan}
 */
export function buildSelfReflectionPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) {
    return {
      active: false,
      checklist: CHECKLIST,
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
      confidence: 'low',
    }
  }

  const presence = input.presence?.plan || input.presence || null
  const wisdom = input.wisdom?.plan || input.wisdom || null
  const taste = input.conversationTaste?.plan || input.conversationTaste || null
  const memoryFlow = input.conversationMemoryFlow?.plan || input.conversationMemoryFlow || null

  const writerBrief = [
    'SELF REFLECTION ENGINE (silenzioso, prima dell’invio): non grammatica — qualità conversazionale.',
    'Prima di finalizzare, chiediti internamente:',
    '1) naturale? 2) mi piacerebbe riceverla? 3) ripetitiva? 4) domanda inutile?',
    '5) osservazione più interessante? 6) valore o filler? 7) fa avanzire il dialogo?',
    '8) rispetta lo stato emotivo? 9) chiusura memorabile? 10) un umano attento sarebbe soddisfatto?',
    'Se qualcosa è “no”: una sola rifinitura — mai loop. Qualità > lunghezza.',
    'Non esporre il processo. Non citare lo stage.',
    presence?.need ? `Presence need=${presence.need}.` : '',
    wisdom?.stance ? `Wisdom stance=${wisdom.stance}.` : '',
    taste?.stance ? `Taste stance=${taste.stance}.` : '',
    memoryFlow?.shouldWeave ? `Memory Flow: tessitura soft attiva.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    active: true,
    checklist: CHECKLIST,
    writerBrief,
    structureLine: 'Self Reflection → checklist silenziosa (max 1 refine pre-invio)',
    responseHints: [
      'Checklist interna: natural · enjoyable · non ripetitiva · no domanda inutile · osservazione viva · valore · avanti · rispetto emotivo · chiusura memorabile · soddisfazione umana.',
      'Una sola rifinitura se serve — mai allungare a vuoto.',
      'Non esporre la riflessione.',
    ],
    reasons: ['pre_writer_checklist', presence?.need ? `presence_${presence.need}` : 'presence_none'],
    signals: ['self_reflection', 'max_one_refine'],
    confidence: 'high',
  }
}

/**
 * @param {SelfReflectionPlan | null | undefined} plan
 * @returns {string[]}
 */
export function selfReflectionStructureHints(plan) {
  if (!plan?.active) return []
  return [
    'Self Reflection → 10 check silenziosi (qualità, non grammatica)',
    'Max 1 refine se qualcosa è “no” — mai loop',
    'Qualità > lunghezza · non esporre il processo',
  ]
}

/**
 * @param {SelfReflectionPlan | null | undefined} plan
 */
export function formatSelfReflectionForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
SELF REFLECTION ENGINE (SILENZIOSO, PRE-INVIO)
══════════════════════════════════════
${plan.writerBrief}

Hints:
${hints}

Regole: qualità conversazionale > lunghezza · max 1 refine · non citare lo stage.`.trim()
}

/**
 * Analyze a draft against the 10 reflection questions.
 * @param {object} [input]
 * @returns {SelfReflectionGate}
 */
export function analyzeSelfReflectionDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  const priorAssistant = normalize(input.priorAssistant || '')
  /** @type {ReflectionAnswer[]} */
  const answers = []
  /** @type {string[]} */
  const reasons = []

  if (!draft || draft.length < 8) {
    return {
      answers: [],
      needsRefine: false,
      refineBrief: '',
      failed: [],
      reasons: ['empty_draft'],
      failScore: 0,
    }
  }

  const q = questionStats(draft)
  const rep = Math.max(selfRepetition(draft), priorOverlap(draft, priorAssistant))
  const sents = sentences(draft)
  const last = sents[sents.length - 1] || ''
  const emoUser = EMOTIONAL_USER.test(userMessage)

  // 1. Natural?
  const unnatural =
    GENERIC_ACK.test(draft) || FILLER.test(draft) || /as an ai|come intelligenza artificiale/i.test(draft)
  answers.push({
    id: 'natural',
    question: CHECKLIST[0],
    ok: !unnatural,
    detail: unnatural ? 'Apertura/filler da macchina — riscrivi più umano.' : 'ok',
    severity: unnatural ? 0.7 : 0,
  })
  if (unnatural) reasons.push('unnatural')

  // 2. Enjoy receiving?
  const dull =
    HELP_DESK_END.test(draft) ||
    (q.endsWithQ && q.interviewish) ||
    (sents.length >= 4 && !/[—–…]/.test(draft) && GENERIC_ACK.test(draft))
  answers.push({
    id: 'enjoyable',
    question: CHECKLIST[1],
    ok: !dull,
    detail: dull ? 'Poco piacevole da ricevere — togli helpdesk, aggiungi vita.' : 'ok',
    severity: dull ? 0.65 : 0,
  })
  if (dull) reasons.push('not_enjoyable')

  // 3. Repetitive? (ok=true means NOT repetitive — question is "Does it sound repetitive?" so no = good)
  // For checklist "Does it sound repetitive?" — answer "no" means ok. We store ok=true when NOT repetitive.
  const isRepetitive = rep >= 0.28
  answers.push({
    id: 'repetitive',
    question: CHECKLIST[2],
    ok: !isRepetitive,
    detail: isRepetitive ? 'Suona ripetitivo — spezza pattern / overlap col turno prima.' : 'ok',
    severity: isRepetitive ? Math.min(1, rep) : 0,
  })
  if (isRepetitive) reasons.push('repetitive')

  // 4. Unnecessary question? (ok=true when NOT asking unnecessary Q)
  const unnecessaryQ =
    (q.endsWithQ && q.interviewish) ||
    (q.qCount >= 2 && q.sentCount <= 5) ||
    (q.endsWithQ && HELP_DESK_END.test(last))
  answers.push({
    id: 'unnecessary_question',
    question: CHECKLIST[3],
    ok: !unnecessaryQ,
    detail: unnecessaryQ
      ? 'Domanda inutile in coda — chiudi con osservazione/insight, non intervista.'
      : 'ok',
    severity: unnecessaryQ ? 0.75 : 0,
  })
  if (unnecessaryQ) reasons.push('unnecessary_question')

  // 5. More interesting observation? (ok=true when already interesting enough)
  const flatObservation =
    sents.length >= 3 &&
    !/\b(però|instead|rather|invece|nota|notice|curious|curioso|ironically|il punto)\b/i.test(draft) &&
    (GENERIC_ACK.test(draft) || FILLER.test(draft) || q.endsWithQ)
  answers.push({
    id: 'interesting_observation',
    question: CHECKLIST[4],
    ok: !flatObservation,
    detail: flatObservation
      ? 'Manca un’osservazione viva — sostituisci una frase piatta con un insight concreto.'
      : 'ok',
    severity: flatObservation ? 0.55 : 0,
  })
  if (flatObservation) reasons.push('need_observation')

  // 6. Value vs filler?
  const fillerHeavy =
    FILLER.test(draft) ||
    MOTIVATIONAL_GENERIC.test(draft) ||
    (sents.length >= 5 && draft.length > 900 && rep > 0.15)
  answers.push({
    id: 'value_vs_filler',
    question: CHECKLIST[5],
    ok: !fillerHeavy,
    detail: fillerHeavy ? 'Filler / spazio vuoto — taglia e tieni solo valore.' : 'ok',
    severity: fillerHeavy ? 0.7 : 0,
  })
  if (fillerHeavy) reasons.push('filler')

  // 7. Moves conversation forward?
  const stuck = HELP_DESK_END.test(last) || SHORT_ONLY_ACK(draft)
  answers.push({
    id: 'moves_forward',
    question: CHECKLIST[6],
    ok: !stuck,
    detail: stuck ? 'Non fa avanzare il dialogo — aggiungi un passo di pensiero o chiusura secca di valore.' : 'ok',
    severity: stuck ? 0.6 : 0,
  })
  if (stuck) reasons.push('not_forward')

  // 8. Emotional respect?
  const emoFail =
    emoUser &&
    (MOTIVATIONAL_GENERIC.test(draft) ||
      /\b(just\s+relax|calmati|non\s+è\s+niente|you'?re\s+overthinking)\b/i.test(draft) ||
      (draft.length > 600 && !/\b(capisco|sent|feel|peso|difficult|difficile)\b/i.test(draft)))
  answers.push({
    id: 'emotional_respect',
    question: CHECKLIST[7],
    ok: !emoFail,
    detail: emoFail
      ? 'Poco rispetto dello stato emotivo — riconosci prima, evita motivational poster.'
      : 'ok',
    severity: emoFail ? 0.8 : 0,
  })
  if (emoFail) reasons.push('emotional_miss')

  // 9. Memorable ending?
  const weakEnding =
    HELP_DESK_END.test(last) ||
    q.endsWithQ ||
    /^(ok|okay|certo|va bene)[.!]*$/i.test(last) ||
    (last.length < 12 && sents.length > 1)
  answers.push({
    id: 'memorable_ending',
    question: CHECKLIST[8],
    ok: !weakEnding,
    detail: weakEnding
      ? 'Chiusura debole — preferisci osservazione, immagine o frase memorabile (niente domanda di routine).'
      : 'ok',
    severity: weakEnding ? 0.5 : 0,
  })
  if (weakEnding) reasons.push('weak_ending')

  // 10. Thoughtful human satisfied?
  const unsatisfied =
    answers.filter((a) => !a.ok).length >= 2 ||
    (unnatural && dull) ||
    (unnecessaryQ && fillerHeavy)
  answers.push({
    id: 'thoughtful_satisfaction',
    question: CHECKLIST[9],
    ok: !unsatisfied,
    detail: unsatisfied
      ? 'Un umano attento non sarebbe soddisfatto — una rifinitura mirata, non più lunga.'
      : 'ok',
    severity: unsatisfied ? 0.65 : 0,
  })
  if (unsatisfied) reasons.push('not_satisfying')

  const failed = answers.filter((a) => !a.ok)
  const failScore =
    failed.length === 0
      ? 0
      : failed.reduce((s, a) => s + a.severity, 0) / Math.max(1, failed.length)

  const needsRefine = failed.length >= 1
  const refineBrief = needsRefine ? buildRefineBrief(failed) : ''

  return {
    answers,
    needsRefine,
    refineBrief,
    failed: failed.map((f) => f.id),
    reasons: reasons.length ? reasons : ['reflection_clean'],
    failScore: Math.round(failScore * 100) / 100,
  }
}

/**
 * @param {string} draft
 */
function SHORT_ONLY_ACK(draft) {
  return /^(ok|okay|certo|capisco|capito|got\s+it|i\s+see)[.!]*$/i.test(normalize(draft))
}

/**
 * @param {ReflectionAnswer[]} failed
 */
function buildRefineBrief(failed) {
  const lines = failed.slice(0, 5).map((f) => `- ${f.question} → ${f.detail}`)
  return [
    'SELF REFLECTION (UNA sola rifinitura, invisibile): migliora la qualità conversazionale — non allungare.',
    'Fallimenti:',
    ...lines,
    'Preferisci: naturalezza, osservazione viva, valore, avanzamento del filo, rispetto emotivo, chiusura memorabile.',
    'Togli: filler, domande inutili, ripetizioni, helpdesk, motivational generico.',
    'Restituisci solo il testo finale. Non menzionare la riflessione.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {{ plan: SelfReflectionPlan, context: string }}
 */
export function runSelfReflectionEngine(input = {}) {
  try {
    const plan = buildSelfReflectionPlan(input)
    return {
      plan,
      context: formatSelfReflectionForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        checklist: CHECKLIST,
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
        confidence: 'low',
      },
      context: '',
    }
  }
}

/**
 * Pre-send gate: at most one refine if any checklist answer is "no".
 * @param {object} [input]
 * @returns {{ gate: SelfReflectionGate, shouldRefine: boolean }}
 */
export function runSelfReflectionGate(input = {}) {
  try {
    const gate = analyzeSelfReflectionDraft(input)
    return {
      gate,
      shouldRefine: Boolean(gate.needsRefine && gate.refineBrief),
    }
  } catch {
    return {
      gate: {
        answers: [],
        needsRefine: false,
        refineBrief: '',
        failed: [],
        reasons: ['fail_soft'],
        failScore: 0,
      },
      shouldRefine: false,
    }
  }
}
