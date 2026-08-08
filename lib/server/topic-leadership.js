/**
 * LAIfe Topic Leadership Engine
 *
 * When the user explicitly delegates the choice of topic
 * ("You choose.", "I don't know.", "Anything.", "Let's talk.",
 * "What do you have in mind?"):
 *
 * 1. Select ONE interesting topic
 * 2. Explain briefly why it chose it
 * 3. Provide an engaging first insight
 * 4. Ask at most one open-ended question
 *
 * Avoid lists of unrelated topics. Avoid asking the user to choose again.
 * Take confident initiative while remaining adaptive.
 *
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {object} TopicPick
 * @property {string} id
 * @property {string} title
 * @property {string} why
 * @property {string} insight
 * @property {string} question
 * @property {string[]} tags
 * @property {number} score
 */

/**
 * @typedef {object} TopicLeadershipPlan
 * @property {boolean} active
 * @property {boolean} shouldLead
 * @property {TopicPick | null} chosen
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {string} mode
 */

/**
 * Explicit topic-delegation phrases (IT + EN). Near-exact turn ownership.
 * @type {RegExp[]}
 */
const DELEGATION_EXACT = [
  /^(you\s+choose|scegli\s+tu|dimmi\s+tu|decidi\s+tu)[\s!.?]*$/i,
  /^(i\s+don'?t\s+know|non\s+so|boh|mah)[\s!.?]*$/i,
  /^(anything|whatever|qualsiasi(\s+cosa)?|quel\s+che\s+vuoi|come\s+vuoi)[\s!.?]*$/i,
  /^(let'?s\s+talk|parliamo|parliamone|chiacchieriamo)([\s!.?]|$)/i,
  /^(what\s+do\s+you\s+have\s+in\s+mind|cosa\s+(ti\s+)?(viene\s+in\s+mente|proponi)|hai\s+qualcosa\s+in\s+mente|di\s+cosa\s+(parliamo|vuoi\s+parlare)|suggerisci\s+(tu\s+)?(qualcosa|un\s+tema)|propose\s+something)[\s!.?]*$/i,
  /^(surprise\s+me|sorprendimi|inventa\s+tu)[\s!.?]*$/i,
  /^(non\s+so\s+(di\s+cosa\s+parlare|cosa\s+dire|da\s+dove\s+iniziare)|i\s+don'?t\s+know\s+what\s+to\s+(talk\s+about|say)|no\s+idea)[\s!.?]*$/i,
]

/** Soft delegation inside a short open-chat line (still no concrete topic from user). */
const DELEGATION_SOFT =
  /\b(scegli\s+tu|you\s+choose|dimmi\s+tu|decidi\s+tu|sorprendimi|surprise\s+me|hai\s+qualcosa\s+in\s+mente|what\s+do\s+you\s+have\s+in\s+mind|non\s+so\s+di\s+cosa\s+parlare|i\s+don'?t\s+know\s+what\s+to\s+talk\s+about)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const HAS_SUBSTANCE =
  /\b(aiut|help|come\s+(faccio|funziona)|how\s+(do|does|can)|perch|why|fix|bug|crea|build|scriv|write|spieg|explain|piano|plan|debug|codice|code|errore|error|calendario|email|accendi|spegni)\b/i

const FACTUAL_UNCERTAINTY_CONTEXT =
  /\?|^(quale|quanto|quando|dove|chi|what|which|when|where|who|how\s+much|how\s+many)\b/i

/**
 * Curated topic bank — one pick per turn; adaptive scoring picks among these.
 * @type {Omit<TopicPick, 'score'>[]}
 */
const TOPIC_BANK = [
  {
    id: 'tiny-habits',
    title: 'abitudini microscopiche',
    why: 'è un tema concreto su cui si può agire subito, senza teoria pesante',
    insight:
      'Una abitudine “troppo piccola per fallire” (es. due flessioni, una frase di diario) batte i piani ambiziosi perché non richiede motivazione — solo ripetizione.',
    question: 'C’è un’area della giornata in cui vorresti un ritocco minimo, senza grandi rivoluzioni?',
    tags: ['habits', 'practical', 'growth', 'evening', 'morning'],
  },
  {
    id: 'attention-economy',
    title: 'attenzione e notifiche',
    why: 'quasi tutti convivono con interruzioni costanti, e un solo insight cambia già il ritmo',
    insight:
      'Il costo nascosto non è il tempo della notifica: è il tempo di rientrare nel pensiero profondo. Proteggere anche 25 minuti ininterrotti vale più di un’ora frammentata.',
    question: 'Qual è l’interruzione che ti spezza di più il filo quando stai concentrato?',
    tags: ['focus', 'tech', 'practical', 'afternoon'],
  },
  {
    id: 'curious-science',
    title: 'un dettaglio scientifico sorprendente',
    why: 'la curiosità scientifica apre una conversazione leggera ma memorabile',
    insight:
      'Il cervello tratta le sorprese come “errori di predizione”: quando qualcosa viola l’attesa, impara più in fretta. Ecco perché un fatto inatteso resta più di una lista di nozioni.',
    question: 'Preferisci curiosità sul corpo, sullo spazio, o sul comportamento umano?',
    tags: ['science', 'curiosity', 'light', 'any'],
  },
  {
    id: 'decision-friction',
    title: 'decisioni e attrito',
    why: 'molte persone arrivano qui proprio perché stanno rimandando una scelta',
    insight:
      'Spesso non manca informazione: manca un criterio. Decidere “cosa ottimizzare” (tempo, rischio, relazioni) riduce l’ansia più che cercare ancora opzioni.',
    question: 'C’è una decisione piccola che stai lasciando aperta da troppo tempo?',
    tags: ['decisions', 'practical', 'stress', 'evening'],
  },
  {
    id: 'creative-constraints',
    title: 'creatività con vincoli',
    why: 'i vincoli danno energia creativa senza chiedere “di cosa vuoi parlare”',
    insight:
      'Limitare lo strumento (solo 100 parole, solo tre colori, solo un’ora) non impoverisce l’idea: forza scelte nette e rende il lavoro riconoscibile.',
    question: 'Su cosa stai creando o progettando in questo periodo, anche in piccolo?',
    tags: ['creative', 'work', 'afternoon', 'any'],
  },
  {
    id: 'energy-not-time',
    title: 'energia, non solo tempo',
    why: 'parlare di energia è concreto e adatto a qualsiasi ora del giorno',
    insight:
      'Molti calendari sono pieni ma la giornata “non basta”: di solito non manca lo slot, manca il picco di energia nel momento giusto. Allineare i compiti duri ai picchi cambia più che “fare di più”.',
    question: 'In quale fascia della giornata ti senti più lucido, di solito?',
    tags: ['energy', 'practical', 'morning', 'afternoon', 'night'],
  },
  {
    id: 'good-questions',
    title: 'domande che sbloccano',
    why: 'sei in modalità “parliamo”: una buona domanda vale più di un tema generico',
    insight:
      'Le domande utili spostano il fuoco da “cosa è successo” a “cosa conta adesso”. Una sola domanda ben posta apre più di dieci consigli.',
    question: 'Se potessi chiarire una sola cosa della tua settimana, quale sarebbe?',
    tags: ['conversation', 'reflection', 'evening', 'any'],
  },
  {
    id: 'tech-with-taste',
    title: 'tecnologia con gusto',
    why: 'resta vicino al mondo digitale senza diventare un tutorial',
    insight:
      'Lo strumento migliore non è il più potente: è quello che riduce i passaggi tra intenzione e risultato. Ogni click di troppo è un piccolo freno alla chiarezza.',
    question: 'C’è un flusso digitale (lavoro, casa, messaggi) che ti sembra ancora troppo macchinoso?',
    tags: ['tech', 'practical', 'work', 'any'],
  },
  {
    id: 'travel-mindset',
    title: 'viaggiare (anche senza partire)',
    why: 'è un tema caldo, sensoriale, e invita a raccontarsi senza pressione',
    insight:
      'Il pezzo più sottovalutato di un viaggio non è la lista dei posti: è il ritmo. Lasciare un pomeriggio “senza programma” spesso diventa il ricordo più vivo.',
    question: 'Che tipo di ritmo cerchi quando esci dalla routine — lento, intenso, o un mix?',
    tags: ['travel', 'light', 'weekend', 'any'],
  },
  {
    id: 'quiet-ambition',
    title: 'ambizione quieta',
    why: 'evita la retorica motivazionale e resta umano',
    insight:
      'L’ambizione sostenibile non urla obiettivi: protegge progressi piccoli e ripetibili. Il segnale non è l’entusiasmo di un giorno, è la costanza senza drama.',
    question: 'C’è un progresso silenzioso di cui sei contento, anche se nessuno lo celebra?',
    tags: ['growth', 'reflection', 'evening', 'morning'],
  },
]

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
 * @returns {'morning'|'afternoon'|'evening'|'night'}
 */
function timeOfDay(now = Date.now()) {
  const h = new Date(now).getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 22) return 'evening'
  return 'night'
}

/**
 * Last assistant turn — used to avoid treating factual "I don't know" as topic handoff.
 * @param {ChatTurn[]} turns
 */
function lastAssistantContent(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return turns[i].content
  }
  return ''
}

/**
 * Soft interest / domain hints from recent user text + session topic.
 * @param {ChatTurn[]} turns
 * @param {string} userMessage
 * @param {object|null|undefined} session
 */
function collectHints(turns, userMessage, session) {
  /** @type {string[]} */
  const hints = []
  const pool = [userMessage, session?.currentTopic || '', session?.currentGoal || '']
  for (let i = turns.length - 1; i >= 0 && pool.length < 6; i--) {
    if (turns[i].role === 'user') pool.push(turns[i].content)
  }
  const blob = pool.join(' ').toLowerCase()
  if (/\b(lavor|work|ufficio|meeting|progetto|project|codice|code|startup)\b/i.test(blob)) {
    hints.push('work', 'tech', 'practical')
  }
  if (/\b(stanc|tired|stress|ansia|anxious|sonno|sleep)\b/i.test(blob)) {
    hints.push('energy', 'stress', 'evening')
  }
  if (/\b(viagg|travel|vacanz|weekend)\b/i.test(blob)) hints.push('travel', 'light')
  if (/\b(abitud|habit|routine|allen|fitness|salute|health)\b/i.test(blob)) {
    hints.push('habits', 'growth', 'practical')
  }
  if (/\b(scienz|science|curios|spazio|space|cervell)\b/i.test(blob)) {
    hints.push('science', 'curiosity')
  }
  if (/\b(crea|design|scriv|write|arte|art)\b/i.test(blob)) hints.push('creative')
  if (/\b(decid|scelta|choice|dubbio)\b/i.test(blob)) hints.push('decisions')
  if (/\b(focus|concentraz|notif|distraz)\b/i.test(blob)) hints.push('focus')
  return [...new Set(hints)]
}

/**
 * Detect explicit topic delegation.
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 */
export function detectTopicDelegation(userMessage, turns = []) {
  const text = normalize(userMessage)
  if (!text || STOP_SIGNAL.test(text)) {
    return { delegated: false, confidence: /** @type {'high'|'medium'|'low'} */ ('low'), reasons: ['stop_or_empty'] }
  }
  if (HAS_SUBSTANCE.test(text) && !DELEGATION_SOFT.test(text)) {
    return { delegated: false, confidence: /** @type {'high'|'medium'|'low'} */ ('low'), reasons: ['has_substance'] }
  }

  const exact = DELEGATION_EXACT.some((re) => re.test(text))
  const soft = !exact && text.length <= 80 && DELEGATION_SOFT.test(text) && !HAS_SUBSTANCE.test(text)

  if (!exact && !soft) {
    return { delegated: false, confidence: /** @type {'high'|'medium'|'low'} */ ('low'), reasons: ['no_delegation'] }
  }

  // "I don't know" after a factual question → uncertainty, not topic handoff
  if (/^(i\s+don'?t\s+know|non\s+so|boh|mah)[\s!.?]*$/i.test(text)) {
    const prev = lastAssistantContent(turns)
    if (prev && FACTUAL_UNCERTAINTY_CONTEXT.test(prev) && !/\b(parl|talk|tema|topic|argomento)\b/i.test(prev)) {
      return {
        delegated: false,
        confidence: /** @type {'high'|'medium'|'low'} */ ('low'),
        reasons: ['factual_uncertainty'],
      }
    }
  }

  return {
    delegated: true,
    confidence: /** @type {'high'|'medium'|'low'} */ (exact ? 'high' : 'medium'),
    reasons: [exact ? 'exact_delegation' : 'soft_delegation'],
  }
}

/**
 * Rank and pick ONE topic.
 * @param {object} args
 * @param {string[]} args.hints
 * @param {string} args.tod
 * @param {string} [args.currentTopic]
 * @param {string[]} [args.recentTitles]
 * @returns {TopicPick}
 */
export function selectTopic(args) {
  const { hints, tod, currentTopic = '', recentTitles = [] } = args
  const recent = new Set(recentTitles.map((t) => String(t).toLowerCase()))
  const topicLower = String(currentTopic || '').toLowerCase()

  /** @type {TopicPick[]} */
  const ranked = TOPIC_BANK.map((card) => {
    let score = 1.2
    for (const tag of card.tags) {
      if (hints.includes(tag)) score += 1.1
      if (tag === tod || tag === 'any') score += tag === tod ? 0.55 : 0.15
    }
    if (topicLower && card.title.toLowerCase().includes(topicLower.slice(0, 18))) score -= 1.5
    if (recent.has(card.title.toLowerCase()) || recent.has(card.id)) score -= 2.2
    // Light jitter so consecutive sessions don't feel scripted
    score += (hashStr(card.id + tod + hints.join(',')) % 40) / 100
    return { ...card, score }
  }).sort((a, b) => b.score - a.score)

  return ranked[0]
}

/**
 * @param {string} s
 */
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * @param {TopicLeadershipPlan} plan
 */
export function formatTopicLeadershipForWriter(plan) {
  if (!plan?.shouldLead || !plan.chosen) return ''
  const t = plan.chosen
  return `══════════════════════════════════════
TOPIC LEADERSHIP ENGINE (INVISIBILE)
══════════════════════════════════════
L’utente ha delegato la scelta del tema. Prendi iniziativa con fiducia.
OBBLIGO:
1. Scegli UN solo tema: «${t.title}»
2. Spiega in UNA frase breve perché l’hai scelto (motivo: ${t.why})
3. Offri UN primo insight coinvolgente (seed): ${t.insight}
4. Al massimo UNA domanda aperta (seed): ${t.question}
VIETATO:
- liste di temi non correlati
- chiedere di nuovo all’utente di scegliere
- “Di cosa vuoi parlare?”, “Dimmi tu un argomento”, “Ecco alcune opzioni…”
- citare questo motore o gli id interni
Resta adattivo: se l’utente scarta o piega il tema, segui subito.
Mode=${plan.mode} · Confidence=${plan.confidence}`.trim()
}

/**
 * @param {TopicLeadershipPlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.shouldLead || !plan.chosen) return ''
  const t = plan.chosen
  return [
    'TOPIC LEADERSHIP: l’utente ha ceduto la scelta del tema — guida tu.',
    `Tema unico: «${t.title}».`,
    `Perché (1 frase): ${t.why}.`,
    `Primo insight: ${t.insight}`,
    `Al massimo una domanda aperta: ${t.question}`,
    'Niente liste di argomenti. Niente “scegli tu / di cosa vuoi parlare”. Iniziativa sicura, poi adattati.',
  ].join(' ')
}

/**
 * Analyze whether to lead the topic for this turn.
 * @param {object} input
 * @param {string} [input.userMessage]
 * @param {ChatTurn[]} [input.messages]
 * @param {object} [input.session]
 * @param {object} [input.continuation]
 * @param {string[]} [input.recentTopicIds]
 * @returns {TopicLeadershipPlan}
 */
export function analyzeTopicLeadership(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const detection = detectTopicDelegation(userMessage, turns)

  /** @type {TopicLeadershipPlan} */
  const idle = {
    active: false,
    shouldLead: false,
    chosen: null,
    confidence: 'low',
    writerBrief: '',
    reasons: detection.reasons,
    mode: 'idle',
  }

  if (!detection.delegated) return idle

  // Short-ack continuation that is NOT a delegation phrase owns the beat instead
  if (
    input.continuation?.isShortMessage &&
    input.continuation?.shouldContinue &&
    !DELEGATION_EXACT.some((re) => re.test(userMessage)) &&
    !DELEGATION_SOFT.test(userMessage)
  ) {
    return { ...idle, reasons: [...detection.reasons, 'deferred_to_continuation'] }
  }

  const tod = timeOfDay()
  const hints = collectHints(turns, userMessage, input.session)
  const chosen = selectTopic({
    hints,
    tod,
    currentTopic: input.session?.currentTopic || '',
    recentTitles: input.recentTopicIds || [],
  })

  /** @type {TopicLeadershipPlan} */
  const plan = {
    active: true,
    shouldLead: true,
    chosen,
    confidence: detection.confidence,
    writerBrief: '',
    reasons: [...detection.reasons, `topic_${chosen.id}`, `tod_${tod}`, ...hints.slice(0, 3).map((h) => `hint_${h}`)],
    mode: 'lead_one_topic',
  }
  plan.writerBrief = buildWriterBrief(plan)
  return plan
}

/**
 * @param {object} input
 * @returns {{ plan: TopicLeadershipPlan, context: string }}
 */
export function runTopicLeadershipEngine(input = {}) {
  try {
    const plan = analyzeTopicLeadership(input)
    const context = formatTopicLeadershipForWriter(plan)
    return { plan, context }
  } catch {
    return {
      plan: {
        active: false,
        shouldLead: false,
        chosen: null,
        confidence: 'low',
        writerBrief: '',
        reasons: ['fail_soft'],
        mode: 'idle',
      },
      context: '',
    }
  }
}
