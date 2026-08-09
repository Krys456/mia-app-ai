/**
 * LAIfe Conversation Delight
 *
 * Goal is no longer merely to answer correctly —
 * the goal is to make the conversation enjoyable.
 *
 * Before every response, internally evaluate:
 *   1. Is this response pleasant to read?
 *   2. Does it feel like it was written by someone who enjoys talking?
 *   3. Is there an opportunity to surprise the user?
 *   4. Is there an opportunity to make the user smile?
 *   5. Can this response leave the user with an interesting thought?
 *   6. Am I only answering, or am I creating a conversation?
 *
 * If technically correct but emotionally flat → rewrite (one pass).
 *
 * Principles: observations before questions · stories before questionnaires ·
 * curiosity before interrogation · insights before summaries ·
 * natural transitions · occasional humor · confidence without arrogance ·
 * warmth without exaggeration.
 *
 * Questions only when they genuinely improve the conversation.
 * Silence beats unnecessary questions.
 *
 * Invisible. Fail-soft. Soft advisor + pre-send gate.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'pleasant'|'enjoys_talking'|'surprise'|'smile'|'lingering_thought'|'creating_conversation'} DelightQuestion
 */

/**
 * @typedef {object} DelightFinding
 * @property {DelightQuestion} question
 * @property {boolean} flag  true = gap / flatness found
 * @property {string} detail
 * @property {number} severity 0–1
 */

/**
 * @typedef {object} ConversationDelightPlan
 * @property {boolean} active
 * @property {'high'|'medium'|'low'} confidence
 * @property {boolean} favorSurprise
 * @property {boolean} favorSmile
 * @property {boolean} favorLingeringThought
 * @property {boolean} softToneOnly  distress / emotional care — warmth, no forced wit
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

/**
 * @typedef {object} ConversationDelightGate
 * @property {DelightFinding[]} findings
 * @property {boolean} needsRewrite
 * @property {string} refineBrief
 * @property {string[]} reasons
 * @property {number} flatnessScore 0–1
 */

/** Flatness above this → one rewrite in the shared refine budget */
const REWRITE_THRESHOLD = 0.4

const HELP_DESK_CLOSER =
  /\b(let\s+me\s+know(\s+if)?|feel\s+free\s+to(\s+ask)?|if\s+you\s+have\s+any\s+questions|i'?m\s+here\s+if\s+you\s+need|happy\s+to\s+help|hope\s+(this|that)\s+helps|fammi\s+sapere(\s+se)?|non\s+esitare|se\s+hai\s+(altre\s+)?domande|sono\s+qui\s+se\s+ti\s+serve|posso\s+aiutarti\s+con\s+altro|spero\s+ti\s+sia\s+utile|c['’]?è\s+altro\s+che\s+posso|hai\s+altre\s+domande)\b/i

const THANK_YOU_LOOP =
  /\b(grazie\s+(a\s+te|ancora)|thank\s+you(\s+too)?|thanks\s+for\s+(asking|sharing)|prego[!.,]*\s*$)/i

const GENERIC_SUMMARY_OPEN =
  /\b(in\s+sintesi|in\s+summary|to\s+summarize|ricapitolando|in\s+breve,?\s+possiamo\s+dire|basically,?\s+what\s+this\s+means)\b/i

const FLAT_TECHNICAL =
  /\b(here\s+(is|are)\s+the\s+(steps|answer)|ecco\s+(i\s+passi|la\s+risposta)|as\s+requested|come\s+richiesto)\b/i

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto|abuso)\b/i

const ENTHUSIASM =
  /\b(interesting|cool|wow|awesome|amazing|love\s+(this|that|it)|interessante|figo|forte|bell[oa]|ottimo|fantastico|that'?s\s+(awesome|cool|amazing))\b/i

const CASUAL =
  /\b(ciao|hey|hi|hello|come\s+stai|how\s+are\s+you|parliamo|chiacchieriamo|let'?s\s+talk|just\s+saying)\b/i

const TEACHING =
  /\b(spieg|explain|cos['’]?[eè]|what\s+is|come\s+funziona|how\s+does|perch|why\b|insegna|teach)\b/i

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
function questionCount(text) {
  const m = normalize(text).match(/[?？]/g)
  return m ? m.length : 0
}

/**
 * @param {string} text
 */
function endsWithQuestion(text) {
  return /[?？]\s*$/.test(normalize(text))
}

/**
 * @param {string} text
 */
function sentenceCount(text) {
  return Math.max(1, normalize(text).split(/(?<=[.!?…])\s+/).filter(Boolean).length)
}

/**
 * Rhythm variety: mix of short and longer sentences.
 * @param {string} text
 */
function rhythmFlatness(text) {
  const parts = normalize(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 3) return 0.15
  const lens = parts.map((s) => s.split(/\s+/).length)
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length
  const variance =
    lens.reduce((a, n) => a + (n - avg) ** 2, 0) / lens.length
  // Very uniform sentence lengths → flat
  if (variance < 4 && parts.length >= 4) return 0.55
  if (variance < 8 && avg > 18) return 0.35
  return 0.1
}

/**
 * @returns {ConversationDelightPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    confidence: 'low',
    favorSurprise: false,
    favorSmile: false,
    favorLingeringThought: false,
    softToneOnly: false,
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    reasons,
    signals: reasons,
  }
}

/**
 * @param {object} [input]
 * @returns {ConversationDelightPlan}
 */
export function buildConversationDelightPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) return inactivePlan(['empty'])

  const turns = normalizeTurns(input.messages)
  const keepFast = Boolean(input.planHints?.keepFast)
  const emotionalTone = String(input.planHints?.emotionalTone || '')
  const softToneOnly =
    DISTRESS.test(userMessage) ||
    emotionalTone === 'distressed' ||
    emotionalTone === 'sad'

  /** @type {string[]} */
  const signals = []
  let favorSurprise = false
  let favorSmile = false
  let favorLingeringThought = true

  if (softToneOnly) {
    signals.push('soft_tone_care')
    favorSurprise = false
    favorSmile = false
    favorLingeringThought = false
  } else if (ENTHUSIASM.test(userMessage)) {
    signals.push('enthusiasm')
    favorSurprise = true
    favorSmile = true
  } else if (CASUAL.test(userMessage) && userMessage.length < 80) {
    signals.push('casual')
    favorSmile = true
    favorSurprise = true
  } else if (TEACHING.test(userMessage)) {
    signals.push('teaching')
    favorSurprise = true
    favorLingeringThought = true
  } else {
    signals.push('default_delight')
    favorSurprise = turns.filter((t) => t.role === 'assistant').length % 3 === 1
    favorSmile = userMessage.length < 120
  }

  if (keepFast) {
    signals.push('keep_fast')
    favorSurprise = false
    favorSmile = false
  }

  /** @type {'high'|'medium'|'low'} */
  const confidence = softToneOnly ? 'medium' : favorSurprise || favorSmile ? 'high' : 'medium'

  const writerBrief = [
    'CONVERSATION DELIGHT: lo scopo non è solo rispondere correttamente — è rendere la conversazione piacevole.',
    'Valuta in silenzio prima di scrivere: (1) piacevole da leggere? (2) scritto da qualcuno a cui piace parlare? (3) sorpresa possibile? (4) un sorriso possibile? (5) un pensiero che resta? (6) sto solo rispondendo, o sto creando conversazione?',
    'Se è tecnicamente corretto ma emotivamente piatto: riscrivi con più vita (senza allungare a vuoto).',
    'Principi: osservazioni prima delle domande · storie prima dei questionari · curiosità prima dell’interrogatorio · insight prima dei sunti · transizioni naturali · humor occasionale · confidenza senza arroganza · calore senza esagerazione.',
    'Domande solo se migliorano davvero il dialogo. Il silenzio batte le domande inutili.',
    softToneOnly
      ? 'Tono soft: presenza calda e rispetto — niente wit forzato, niente sorprese leggere.'
      : [
          favorSurprise ? 'Cerca UNA piccola sorpresa utile (fatto, angolo, collegamento) — senza annunciarla.' : '',
          favorSmile ? 'Se calza, una mezza frase di wit o calore genuino — mai battuta forzata.' : '',
          favorLingeringThought
            ? 'Lascia un pensiero interessante che resti dopo la lettura.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
    'Vietato: “Let me know…”, “If you have any questions…”, “Feel free to ask…”, “I’m here if you need anything.”, loop di grazie, chiusure generiche da chatbot.',
    'Obiettivo: l’utente pensi «era davvero piacevole da leggere».',
  ]
    .filter(Boolean)
    .join(' ')

  const hints = [
    'Crea conversazione — non attendere la prossima istruzione.',
    'Osservazione / insight prima di qualsiasi domanda.',
    softToneOnly
      ? 'Calore quieto; niente theater.'
      : 'Una svolta viva batte tre frasi corrette ma piatte.',
  ]

  return {
    active: true,
    confidence,
    favorSurprise,
    favorSmile,
    favorLingeringThought,
    softToneOnly,
    writerBrief,
    structureLine: softToneOnly
      ? 'Conversation Delight · soft: piacevole + presente, senza forzare wit'
      : 'Conversation Delight: piacevole da leggere · crea conversazione · insight vivo',
    responseHints: hints,
    reasons: [`confidence_${confidence}`, ...signals.slice(0, 4)],
    signals: signals.slice(0, 6),
  }
}

/**
 * @param {ConversationDelightPlan | null | undefined} plan
 */
export function formatConversationDelightForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''

  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')

  return `══════════════════════════════════════
CONVERSATION DELIGHT (INVISIBILE)
══════════════════════════════════════
Active=yes · Confidence=${plan.confidence}
Surprise=${plan.favorSurprise ? 'seek' : 'no'} · Smile=${plan.favorSmile ? 'seek' : 'no'} · LingeringThought=${plan.favorLingeringThought ? 'yes' : 'soft'} · SoftTone=${plan.softToneOnly ? 'yes' : 'no'}

${plan.writerBrief}

Hints:
${hints || '- (nessuno)'}

Regole: piacevolezza > correttezza piatta · crea conversazione · niente chiusure da chatbot · non citare lo stage.`.trim()
}

/**
 * Strip default chatbot closers / thank-you loops from the tail (and common mid closers).
 * @param {string} text
 */
export function stripDelightKillers(text) {
  let raw = String(text || '')
  if (!raw.trim()) return raw

  // Trailing chatbot closers (last 1–2 sentences)
  const parts = raw.split(/(?<=[.!?…])\s+/)
  while (parts.length > 1) {
    const last = parts[parts.length - 1]
    if (HELP_DESK_CLOSER.test(last) || THANK_YOU_LOOP.test(last)) {
      parts.pop()
      continue
    }
    break
  }
  raw = parts.join(' ').trim()

  // Leading empty courtesy loops
  raw = raw
    .replace(
      /^(thank\s+you\s+for\s+(your\s+)?(question|message)[.!]+\s*|grazie\s+per\s+la\s+(domanda|condivisione)[.!]+\s*|prego[.!]+\s*)/i,
      '',
    )
    .trim()

  return raw || String(text || '').trim()
}

/**
 * Post-draft gate: detect emotionally flat / chatbot drafts.
 * @param {object} [input]
 * @returns {ConversationDelightGate}
 */
export function analyzeConversationDelightDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  const plan = input.plan || null
  /** @type {DelightFinding[]} */
  const findings = []
  /** @type {string[]} */
  const reasons = []

  if (!draft) {
    return {
      findings: [],
      needsRewrite: false,
      refineBrief: '',
      reasons: ['empty_draft'],
      flatnessScore: 0,
    }
  }

  const soft = Boolean(plan?.softToneOnly) || DISTRESS.test(userMessage)
  const q = questionCount(draft)
  const rhythm = rhythmFlatness(draft)
  const hasCloser = HELP_DESK_CLOSER.test(draft)
  const hasThankLoop = THANK_YOU_LOOP.test(draft)
  const hasSummaryOnly = GENERIC_SUMMARY_OPEN.test(draft.slice(0, 120)) && sentenceCount(draft) <= 4
  const flatTech = FLAT_TECHNICAL.test(draft.slice(0, 160))
  const onlyAnswering =
    !soft &&
    flatTech &&
    !/\b(per\s+esempio|imagine|immagina|curios[oa]|in\s+pratica|il\s+punto\s+sottile|what\s+most\s+people|la\s+maggior\s+parte)\b/i.test(
      draft,
    )

  // 1) Pleasant to read?
  const pleasantSev = Math.max(
    hasCloser ? 0.7 : 0,
    hasThankLoop ? 0.55 : 0,
    rhythm,
    hasSummaryOnly ? 0.5 : 0,
  )
  findings.push({
    question: 'pleasant',
    flag: pleasantSev >= 0.4,
    detail: pleasantSev >= 0.4 ? 'Chiusure/ritmo da chatbot o testo monotono' : 'Abbastanza piacevole',
    severity: pleasantSev,
  })
  if (pleasantSev >= 0.4) reasons.push(`pleasant=${pleasantSev.toFixed(2)}`)

  // 2) Enjoys talking?
  const enjoysSev = Math.max(flatTech ? 0.55 : 0, onlyAnswering ? 0.6 : 0, hasCloser ? 0.35 : 0)
  findings.push({
    question: 'enjoys_talking',
    flag: enjoysSev >= 0.4,
    detail: enjoysSev >= 0.4 ? 'Suona come chi attende istruzioni, non come chi pensa insieme' : 'Voce viva',
    severity: enjoysSev,
  })
  if (enjoysSev >= 0.4) reasons.push(`enjoys_talking=${enjoysSev.toFixed(2)}`)

  // 3) Surprise opportunity?
  const surpriseWanted = Boolean(plan?.favorSurprise) && !soft
  const hasSpark =
    /\b(invece|curiosamente|il\s+dettaglio|la\s+maggior\s+parte|poco\s+ovvio|counterintuitive|inaspettato|surprisingly)\b/i.test(
      draft,
    )
  const surpriseSev = surpriseWanted && !hasSpark ? 0.5 : 0
  findings.push({
    question: 'surprise',
    flag: surpriseSev >= 0.4,
    detail: surpriseSev >= 0.4 ? 'Manca un angolo vivo / sorpresa utile' : 'Ok',
    severity: surpriseSev,
  })
  if (surpriseSev >= 0.4) reasons.push('surprise_gap')

  // 4) Smile opportunity?
  const smileWanted = Boolean(plan?.favorSmile) && !soft
  const hasWarmth =
    /\b(bello|carino|ironico|tra\s+noi|honestly|frankly|mi\s+piace|delizioso)\b/i.test(draft) ||
    /[!]/.test(draft.slice(0, 200))
  const smileSev = smileWanted && !hasWarmth && draft.length > 80 ? 0.35 : 0
  findings.push({
    question: 'smile',
    flag: smileSev >= 0.35,
    detail: smileSev >= 0.35 ? 'Calore/wit assente dove calzerebbe' : 'Ok',
    severity: smileSev,
  })
  if (smileSev >= 0.35) reasons.push('smile_gap')

  // 5) Lingering thought?
  const lingerWanted = plan?.favorLingeringThought !== false && !soft
  const hasThought =
    sentenceCount(draft) >= 2 &&
    /\b(il\s+punto|in\s+fondo|ciò\s+che\s+conta|the\s+real|what\s+matters|resta|porta\s+con\s+te)\b/i.test(
      draft,
    )
  const lingerSev =
    lingerWanted && !hasThought && onlyAnswering ? 0.45 : lingerWanted && hasCloser ? 0.4 : 0
  findings.push({
    question: 'lingering_thought',
    flag: lingerSev >= 0.4,
    detail: lingerSev >= 0.4 ? 'Chiude da sportello invece di lasciare un pensiero' : 'Ok',
    severity: lingerSev,
  })
  if (lingerSev >= 0.4) reasons.push('lingering_gap')

  // 6) Creating conversation vs only answering?
  const creatingSev = Math.max(
    onlyAnswering ? 0.55 : 0,
    q >= 2 ? 0.5 : endsWithQuestion(draft) && hasCloser ? 0.45 : 0,
    hasCloser ? 0.4 : 0,
  )
  findings.push({
    question: 'creating_conversation',
    flag: creatingSev >= 0.4,
    detail:
      creatingSev >= 0.4
        ? 'Solo risposta/intervista — non sta creando conversazione'
        : 'Crea conversazione',
    severity: creatingSev,
  })
  if (creatingSev >= 0.4) reasons.push(`creating=${creatingSev.toFixed(2)}`)

  const flagged = findings.filter((f) => f.flag)
  const flatnessScore =
    flagged.length === 0
      ? 0
      : flagged.reduce((a, f) => a + f.severity, 0) / Math.max(1, findings.length)

  const needsRewrite =
    !soft &&
    flatnessScore >= REWRITE_THRESHOLD &&
    flagged.some((f) => f.severity >= 0.4)

  const refineBrief = needsRewrite
    ? [
        'CONVERSATION DELIGHT rewrite: la bozza è corretta ma piatta / da chatbot.',
        'Riscrivi per essere piacevole da leggere — voce di qualcuno a cui piace parlare.',
        hasCloser || hasThankLoop
          ? 'Togli chiusure helpdesk (“Let me know…”, “Fammi sapere…”, “Sono qui se…”) e loop di grazie.'
          : '',
        surpriseWanted && !hasSpark
          ? 'Aggiungi UNA piccola sorpresa o angolo utile (senza etichettarla).'
          : '',
        lingerWanted
          ? 'Lascia un pensiero interessante; continua naturalmente se serve — non interrogare.'
          : '',
        'Osservazioni/insight prima delle domande. Silenzio > domande inutili. Non allungare a vuoto.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return {
    findings,
    needsRewrite,
    refineBrief,
    reasons: reasons.length ? reasons : ['delight_ok'],
    flatnessScore: Math.round(flatnessScore * 100) / 100,
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationDelightPlan, context: string }}
 */
export function runConversationDelight(input = {}) {
  try {
    const plan = buildConversationDelightPlan(input)
    return {
      plan,
      context: formatConversationDelightForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}

/**
 * Pre-send gate entry.
 * @param {object} [input]
 * @returns {{ gate: ConversationDelightGate, shouldRewrite: boolean }}
 */
export function runConversationDelightGate(input = {}) {
  try {
    const gate = analyzeConversationDelightDraft(input)
    return {
      gate,
      shouldRewrite: Boolean(gate.needsRewrite && gate.refineBrief),
    }
  } catch {
    return {
      gate: {
        findings: [],
        needsRewrite: false,
        refineBrief: '',
        reasons: ['fail_soft'],
        flatnessScore: 0,
      },
      shouldRewrite: false,
    }
  }
}
