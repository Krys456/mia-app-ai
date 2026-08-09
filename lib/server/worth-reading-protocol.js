/**
 * LAIfe Worth Reading Protocol
 *
 * Final Writer craft stage — immediately before response generation.
 * Mission: every assistant response must deserve the user's attention.
 *
 * Internally evaluate / improve until principles hold:
 *   1. Never waste a turn
 *   2. Never abandon the conversation
 *   3. Prefer contribution over interrogation
 *   4. Respect conversational momentum
 *   5. Avoid assistant clichés
 *   6. Natural emotional rhythm
 *   7. Delight Principle (one subtle enriching element when appropriate)
 *   8. Human Conversation Test
 *   9. Worth Reading Test
 *  10. Final Quality Gate
 *
 * Refines wording, pacing, emotional tone, conversational value and flow
 * without changing factual correctness.
 *
 * Runs AFTER all cognitive stages (incl. Constitution / HCS cues) and
 * BEFORE the Writer; plus a pre-send gate (shared one-pass refine budget).
 * Invisible. Fail-soft. Never cite the protocol to the user.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'never_waste_turn'|'never_abandon'|'contribution_over_interrogation'|'respect_momentum'|'avoid_cliches'|'natural_rhythm'|'delight'|'human_conversation_test'|'worth_reading_test'|'final_quality_gate'} WorthReadingPrincipleId
 */

/**
 * @typedef {object} WorthReadingPrinciple
 * @property {WorthReadingPrincipleId} id
 * @property {string} title
 * @property {string} rule
 */

/**
 * @typedef {object} WorthReadingPlan
 * @property {boolean} active
 * @property {WorthReadingPrinciple[]} principles
 * @property {boolean} mustCarry  user gave a short/minimal turn — take responsibility
 * @property {boolean} preferContribution
 * @property {boolean} allowDelight
 * @property {boolean} suppressQuestions
 * @property {string} stance  carry | enrich | continue | tighten
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 */

/**
 * @typedef {object} WorthReadingIssue
 * @property {WorthReadingPrincipleId} id
 * @property {string} detail
 * @property {number} severity 0–1
 */

/**
 * @typedef {object} WorthReadingGate
 * @property {WorthReadingIssue[]} issues
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {number} failScore
 */

/** @type {WorthReadingPrinciple[]} */
export const WORTH_READING_PRINCIPLES = [
  {
    id: 'never_waste_turn',
    title: 'Never waste a turn',
    rule:
      'If the response adds no value, rewrite it. Contribute at least one: idea, useful explanation, fresh perspective, memorable sentence, concrete example, meaningful observation, natural continuation, or thoughtful reflection. Empty turns are forbidden.',
  },
  {
    id: 'never_abandon',
    title: 'Never abandon the conversation',
    rule:
      'On “No.” / “Ok.” / “Boh.” / “Già.” / “Mh.” / “Non lo so.” — do not stop and do not say “I’m here if you need anything.” Take conversational responsibility: observation, story, analogy, curiosity, insight, or reflection.',
  },
  {
    id: 'contribution_over_interrogation',
    title: 'Prefer contribution over interrogation',
    rule:
      'Questions are useful but must not be the primary way to keep the chat alive. Carry conversations without constant asking. Target: at most one meaningful question every several turns unless the user is actively seeking help.',
  },
  {
    id: 'respect_momentum',
    title: 'Respect conversational momentum',
    rule:
      'When a topic is emotionally or intellectually interesting, stay with it. Do not switch subjects just because a response ended.',
  },
  {
    id: 'avoid_cliches',
    title: 'Avoid assistant clichés',
    rule:
      'Suppress: “How can I help?”, “Let me know.”, “Feel free to ask.”, “I’m here if you need anything.”, “Anything else?”, “What would you like to discuss?” Prefer natural endings.',
  },
  {
    id: 'natural_rhythm',
    title: 'Natural emotional rhythm',
    rule:
      'Alternate naturally among explanation, storytelling, reflection, humor, curiosity, enthusiasm, calm. Avoid repetitive response structures.',
  },
  {
    id: 'delight',
    title: 'Delight Principle',
    rule:
      'When appropriate, enrich with ONE subtle element: unexpected fact, metaphor, analogy, vivid example, historical anecdote, or elegant observation. Do not force it.',
  },
  {
    id: 'human_conversation_test',
    title: 'Human Conversation Test',
    rule:
      'Ask: “If a thoughtful, intelligent friend said this, would it sound natural?” If not — rewrite.',
  },
  {
    id: 'worth_reading_test',
    title: 'Worth Reading Test',
    rule:
      'Ask: “Will the user finish reading this feeling that it was worth their time?” If uncertain — improve it.',
  },
  {
    id: 'final_quality_gate',
    title: 'Final Quality Gate',
    rule:
      'Reject: generic, repetitive, empty, overly formal, interview-like, customer-support style, mechanically enthusiastic. Prefer: intelligent, warm, effortless, engaging, memorable, human.',
  },
]

const MINIMAL_USER =
  /^(no|ok|okay|boh|già|mh+|mhm+|uhm+|non\s+lo\s+so|i\s+don'?t\s+know|sure|yeah|yep|yup|nah|va\s+bene|ok\.|no\.|già\.|boh\.)[.!?…]*$/i

const ASSISTANT_CLICHE =
  /\b(how\s+can\s+i\s+help|come\s+posso\s+(aiutarti|aiutare)|let\s+me\s+know|fammi\s+sapere|feel\s+free\s+to\s+(ask|reach)|non\s+esitare|i'?m\s+here\s+if\s+you|sono\s+qui\s+se\s+(ti\s+serve|hai)|anything\s+else\??|cos'?altro\??|what\s+would\s+you\s+like\s+to\s+(discuss|talk|know)|di\s+cosa\s+vuoi\s+parlare|if\s+you\s+need\s+anything|se\s+ti\s+serve\s+qualcosa)\b/i

const HELP_SEEKING =
  /\b(aiut|help|come\s+(si|posso|fare)|how\s+(do|can|to)|fix|debug|spieg|explain|perch[eé]|why|non\s+capisco|i\s+don'?t\s+understand)\b/i

const GENERIC_ACK =
  /^(certo|ecco|capisco|assolutamente|ottima\s+domanda|great\s+question|of\s+course|absolutely|sure[!.,]|i\s+understand|got\s+it|va\s+bene)[.!]?\s+/i

const MECHANICAL_ENTHUSIASM =
  /\b(amazing[!]+|fantastic[!]+|awesome[!]+|incredibile[!]+|fantastico[!]+|you'?re\s+going\s+to\s+love|ti\s+piacerà\s+davvero)\b/i

const OVERLY_FORMAL =
  /\b(dear\s+user|gentile\s+utente|as\s+per\s+your\s+request|ai\s+sensi\s+della\s+sua\s+richiesta|kindly\s+note|si\s+prega\s+di)\b/i

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
 * @param {ChatTurn[]|undefined|null} messages
 */
function recentAssistantQuestions(messages) {
  if (!Array.isArray(messages)) return 0
  const recent = messages.filter((m) => m?.role === 'assistant').slice(-4)
  let withQ = 0
  for (const m of recent) {
    if (/\?/.test(String(m.content || ''))) withQ += 1
  }
  return withQ
}

/**
 * Pre-Writer plan: Worth Reading Protocol for every final response.
 * @param {object} [input]
 * @returns {WorthReadingPlan}
 */
export function buildWorthReadingPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) {
    return {
      active: false,
      principles: WORTH_READING_PRINCIPLES,
      mustCarry: false,
      preferContribution: true,
      allowDelight: false,
      suppressQuestions: false,
      stance: 'tighten',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
      confidence: 'low',
    }
  }

  const mustCarry = MINIMAL_USER.test(userMessage) || userMessage.length <= 4
  const seekingHelp = HELP_SEEKING.test(userMessage)
  const recentQs = recentAssistantQuestions(input.messages)
  const suppressQuestions = !seekingHelp && (mustCarry || recentQs >= 2)
  const allowDelight = !mustCarry && userMessage.length > 20 && !seekingHelp
  const preferContribution = true

  /** @type {string} */
  let stance = 'enrich'
  if (mustCarry) stance = 'carry'
  else if (seekingHelp) stance = 'continue'
  else if (userMessage.length < 40) stance = 'carry'
  else stance = 'enrich'

  const writerBrief = [
    'WORTH READING PROTOCOL (immediatamente prima del Writer — craft finale):',
    'Ogni risposta deve meritare l’attenzione dell’utente. Valuta e migliora finché i principi reggono — senza cambiare i fatti.',
    '1) Never waste a turn — almeno un contributo: idea · spiegazione utile · prospettiva · frase memorabile · esempio · osservazione · continuazione · riflessione. Turni vuoti vietati.',
    '2) Never abandon — su “No./Ok./Boh./Già./Mh./Non lo so.” non fermarti e non dire “I’m here if you need anything.” Prendi responsabilità: osservazione, storia, analogia, curiosità, insight.',
    '3) Contribution > interrogation — domande utili ma non il motore primario; max ~1 domanda significativa ogni alcuni turni salvo richiesta di aiuto.',
    '4) Respect momentum — resta sul filo interessante; non cambiare tema solo perché la risposta è finita.',
    '5) Avoid clichés — niente “How can I help? / Let me know / Feel free / I’m here if… / Anything else? / What would you like to discuss?”; chiusure naturali.',
    '6) Natural rhythm — alterna spiegazione / storytelling / riflessione / umorismo / curiosità / entusiasmo / calma; evita strutture ripetitive.',
    '7) Delight — quando appropriato, UN solo elemento sottile (fatto inatteso, metafora, analogia, esempio vivo, aneddoto, osservazione elegante); non forzare.',
    '8) Human Conversation Test — «Se un amico intelligente dicesse questo, suonerebbe naturale?» Se no → riscrivi.',
    '9) Worth Reading Test — «L’utente finirà pensando che valeva il tempo?» Se incerto → migliora.',
    '10) Final Quality Gate — rifiuta: generico, ripetitivo, vuoto, troppo formale, da intervista, da support, entusiasmo meccanico. Preferisci: intelligente, caldo, effortless, coinvolgente, memorabile, umano.',
    mustCarry
      ? 'Stance=CARRY: l’utente ha dato un turno minimo — continua tu con sostanza, senza helpdesk.'
      : '',
    suppressQuestions ? 'Sopprimi domande di routine in questa risposta.' : '',
    allowDelight ? 'Delight ammesso (uno, sottile).' : 'Delight opzionale — non forzare.',
    `Stance operativa: ${stance}.`,
    'Non citare il protocollo. Non inventare fatti.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    active: true,
    principles: WORTH_READING_PRINCIPLES,
    mustCarry,
    preferContribution,
    allowDelight,
    suppressQuestions,
    stance,
    writerBrief,
    structureLine: `Worth Reading Protocol → stance=${stance}${mustCarry ? ' · CARRY' : ''}${suppressQuestions ? ' · no-Q' : ''}`,
    responseHints: [
      'Merita attenzione: almeno un contributo reale per turno.',
      mustCarry
        ? 'Turno minimo dell’utente → prendi responsabilità, non abbandonare.'
        : 'Continua il filo; chiudi in modo naturale.',
      suppressQuestions
        ? 'Preferisci contributo a domande.'
        : 'Domanda solo se davvero muove il dialogo.',
      allowDelight
        ? 'Un tocco di delight sottile se calza — mai forzato.'
        : 'Priorità a chiarezza e continuità.',
      'Test amici: naturale? Vale il tempo? Se no → riscrivi (una volta).',
    ],
    reasons: [
      'pre_writer_protocol',
      `stance_${stance}`,
      mustCarry ? 'must_carry' : 'normal_turn',
      suppressQuestions ? 'suppress_q' : 'q_ok',
    ],
    signals: ['worth_reading_protocol', 'final_writer_craft', stance],
    confidence: 'high',
  }
}

/**
 * @param {WorthReadingPlan | null | undefined} plan
 * @returns {string[]}
 */
export function worthReadingStructureHints(plan) {
  if (!plan?.active) return []
  return [
    'Worth Reading Protocol → ogni risposta merita attenzione (pre-Writer)',
    'Never waste / never abandon · contribution > interrogation · no clichés',
    'Human test + Worth Reading test · qualità > lunghezza · fatti intatti',
  ]
}

/**
 * @param {WorthReadingPlan | null | undefined} plan
 */
export function formatWorthReadingForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const list = (plan.principles || WORTH_READING_PRINCIPLES)
    .map((p, i) => `${i + 1}. ${p.title} — ${p.rule}`)
    .join('\n')
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
WORTH READING PROTOCOL (PRE-WRITER)
══════════════════════════════════════
${plan.writerBrief}

Principi:
${list}

Hints:
${hints}

Stance: ${plan.stance}${plan.mustCarry ? ' · CARRY' : ''}${plan.suppressQuestions ? ' · preferisci contributo a domande' : ''}
Non citare il protocollo. Scrivi solo la risposta. Fatti invariati.`.trim()
}

/**
 * Analyze a draft against Worth Reading principles.
 * @param {object} [input]
 * @returns {WorthReadingGate}
 */
export function analyzeWorthReadingDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  /** @type {WorthReadingIssue[]} */
  const issues = []
  /** @type {string[]} */
  const reasons = []

  if (!draft || draft.length < 8) {
    return {
      issues: [],
      needsRefine: false,
      refineBrief: '',
      failed: [],
      reasons: ['empty_draft'],
      failScore: 0,
    }
  }

  const sents = sentences(draft)
  const qCount = (draft.match(/\?/g) || []).length
  const mustCarry = MINIMAL_USER.test(userMessage) || userMessage.length <= 4
  const seekingHelp = HELP_SEEKING.test(userMessage)
  const plan = input.plan || null

  // 1. Never waste a turn
  const empty =
    draft.length < 40 ||
    (/^(ok|okay|certo|capisco|got\s+it|i\s+see|va\s+bene)[.!]*$/i.test(draft) &&
      draft.length < 60)
  if (empty) {
    issues.push({
      id: 'never_waste_turn',
      detail: 'Turno vuoto / senza contributo — aggiungi idea, osservazione, esempio o riflessione.',
      severity: 0.9,
    })
    reasons.push('waste_turn')
  }

  // 2. Never abandon
  if (mustCarry && (ASSISTANT_CLICHE.test(draft) || draft.length < 50)) {
    issues.push({
      id: 'never_abandon',
      detail:
        'Turno minimo dell’utente: non abbandonare. Continua con osservazione/storia/analogia/insight — niente helpdesk.',
      severity: 0.95,
    })
    reasons.push('abandon')
  }

  // 3. Contribution over interrogation
  if (!seekingHelp && (qCount >= 2 || (qCount >= 1 && sents.length <= 2 && draft.length < 160))) {
    issues.push({
      id: 'contribution_over_interrogation',
      detail: 'Troppe / sola domanda — preferisci un contributo (idea/osservazione) alla domanda.',
      severity: 0.75,
    })
    reasons.push('interrogation')
  }

  // 5. Avoid clichés
  if (ASSISTANT_CLICHE.test(draft)) {
    issues.push({
      id: 'avoid_cliches',
      detail: 'Cliché da assistente — riscrivi la chiusura in modo naturale.',
      severity: 0.95,
    })
    reasons.push('cliche')
  }

  // 6. Natural rhythm / 10 quality gate pieces
  if (GENERIC_ACK.test(draft) && sents.length <= 3) {
    issues.push({
      id: 'final_quality_gate',
      detail: 'Apertura generica / piatta — parti con un pensiero vivo.',
      severity: 0.7,
    })
    reasons.push('generic')
  }

  if (MECHANICAL_ENTHUSIASM.test(draft)) {
    issues.push({
      id: 'final_quality_gate',
      detail: 'Entusiasmo meccanico — abbassa il volume, alza la sostanza.',
      severity: 0.65,
    })
    reasons.push('mechanical')
  }

  if (OVERLY_FORMAL.test(draft)) {
    issues.push({
      id: 'final_quality_gate',
      detail: 'Troppo formale / da sportello — tono più umano e effortless.',
      severity: 0.7,
    })
    reasons.push('formal')
  }

  // 8. Human conversation test (heuristic: cliché + interview + ack)
  const unnatural =
    ASSISTANT_CLICHE.test(draft) ||
    (qCount >= 2 && !seekingHelp) ||
    /as an ai|come intelligenza artificiale/i.test(draft)
  if (unnatural) {
    issues.push({
      id: 'human_conversation_test',
      detail: 'Non suona come un amico intelligente — riscrivi più naturale.',
      severity: 0.8,
    })
    reasons.push('not_human')
  }

  // 9. Worth reading test
  const notWorth =
    empty ||
    (ASSISTANT_CLICHE.test(draft) && draft.length < 200) ||
    (mustCarry && draft.length < 80)
  if (notWorth) {
    issues.push({
      id: 'worth_reading_test',
      detail: 'Probabilmente non vale il tempo — arricchisci con un contributo concreto.',
      severity: 0.85,
    })
    reasons.push('not_worth')
  }

  // 4. Momentum — soft: topic switch with generic prompt
  if (
    /\b(changing\s+subject|cambiando\s+argomento|anyway[,.]?\s+what\s+else|comunque[,.]?\s+di\s+cosa)\b/i.test(
      draft,
    )
  ) {
    issues.push({
      id: 'respect_momentum',
      detail: 'Cambio tema forzato — resta sul filo se è vivo.',
      severity: 0.6,
    })
    reasons.push('momentum_break')
  }

  // 7. Delight — only flag as miss when plan wants delight and draft is dry+long
  if (
    plan?.allowDelight &&
    draft.length > 280 &&
    sents.length >= 4 &&
    !/\b(like|come|metafor|analog|imagine|immagina|for\s+example|ad\s+esempio|unexpected|curiosamente)\b/i.test(
      draft,
    ) &&
    ASSISTANT_CLICHE.test(draft)
  ) {
    issues.push({
      id: 'delight',
      detail: 'Manca un tocco di delight sottile — una metafora/esempio/osservazione, non forzata.',
      severity: 0.45,
    })
    reasons.push('delight_miss')
  }

  // Dedupe by id (keep highest severity)
  /** @type {Map<string, WorthReadingIssue>} */
  const byId = new Map()
  for (const issue of issues) {
    const prev = byId.get(issue.id)
    if (!prev || issue.severity > prev.severity) byId.set(issue.id, issue)
  }
  const unique = [...byId.values()]
  const failScore =
    unique.length === 0
      ? 0
      : unique.reduce((s, i) => s + i.severity, 0) / Math.max(1, unique.length)

  const needsRefine = unique.length >= 1
  const refineBrief = needsRefine ? buildRefineBrief(unique, { mustCarry, suppressQuestions: plan?.suppressQuestions }) : ''

  return {
    issues: unique,
    needsRefine,
    refineBrief,
    failed: unique.map((i) => i.id),
    reasons: reasons.length ? reasons : ['worth_reading_clean'],
    failScore: Math.round(failScore * 100) / 100,
  }
}

/**
 * @param {WorthReadingIssue[]} issues
 * @param {{ mustCarry?: boolean, suppressQuestions?: boolean }} [opts]
 */
function buildRefineBrief(issues, opts = {}) {
  const lines = issues.slice(0, 6).map((i) => `- ${i.id}: ${i.detail}`)
  return [
    'WORTH READING PROTOCOL (UNA sola rifinitura, invisibile): migliora valore conversazionale — non allungare; fatti invariati.',
    'Problemi:',
    ...lines,
    opts.mustCarry
      ? 'CARRY: l’utente ha scritto poco — continua tu con osservazione/storia/insight, senza helpdesk.'
      : '',
    opts.suppressQuestions ? 'Evita domande di routine; preferisci un contributo.' : '',
    'Preferisci: intelligente, caldo, effortless, coinvolgente, memorabile, umano.',
    'Togli: cliché da assistente, turni vuoti, interviste, entusiasmo meccanico, chiusure da support.',
    'Test: suonerebbe naturale da un amico intelligente? Vale il tempo? Se no, riscrivi.',
    'Restituisci solo il testo finale. Non menzionare il protocollo.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {object} [input]
 * @returns {{ plan: WorthReadingPlan, context: string }}
 */
export function runWorthReadingProtocol(input = {}) {
  try {
    const plan = buildWorthReadingPlan(input)
    return {
      plan,
      context: formatWorthReadingForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        principles: WORTH_READING_PRINCIPLES,
        mustCarry: false,
        preferContribution: true,
        allowDelight: false,
        suppressQuestions: false,
        stance: 'tighten',
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
 * Pre-send gate: refine once if Worth Reading principles fail.
 * @param {object} [input]
 * @returns {{ gate: WorthReadingGate, shouldRefine: boolean }}
 */
export function runWorthReadingGate(input = {}) {
  try {
    const gate = analyzeWorthReadingDraft(input)
    return {
      gate,
      shouldRefine: Boolean(gate.needsRefine && gate.refineBrief),
    }
  } catch {
    return {
      gate: {
        issues: [],
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
