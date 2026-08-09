/**
 * LAIfe Topic Leadership Engine — Never Give Control Back
 *
 * When the user delegates the choice of topic
 * ("You choose.", "I don't know.", "Suggest something.", "Anything.", "No."):
 *
 * 1. Choose exactly ONE direction
 * 2. Commit to it
 * 3. Develop it
 *
 * Never respond by asking the user to choose again.
 * Do not offer lists.
 * Do not repeat open-ended questions.
 * Treat delegated choice as delegated responsibility.
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
 * @property {string} develop  Next beat that deepens the same direction (statement, not a question)
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
 * @property {boolean} neverGiveControlBack
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
  /^(what\s+do\s+you\s+have\s+in\s+mind|cosa\s+(ti\s+)?(viene\s+in\s+mente|proponi)|hai\s+qualcosa\s+in\s+mente|di\s+cosa\s+(parliamo|vuoi\s+parlare)|suggerisci\s+(tu\s+)?(qualcosa|un\s+tema)|suggest\s+something|propose\s+something)[\s!.?]*$/i,
  /^(surprise\s+me|sorprendimi|inventa\s+tu)[\s!.?]*$/i,
  /^(non\s+so\s+(di\s+cosa\s+parlare|cosa\s+dire|da\s+dove\s+iniziare)|i\s+don'?t\s+know\s+what\s+to\s+(talk\s+about|say)|no\s+idea)[\s!.?]*$/i,
]

/** Soft delegation inside a short open-chat line (still no concrete topic from user). */
const DELEGATION_SOFT =
  /\b(scegli\s+tu|you\s+choose|dimmi\s+tu|decidi\s+tu|sorprendimi|surprise\s+me|hai\s+qualcosa\s+in\s+mente|what\s+do\s+you\s+have\s+in\s+mind|non\s+so\s+di\s+cosa\s+parlare|i\s+don'?t\s+know\s+what\s+to\s+talk\s+about|suggest\s+something|suggerisci\s+(tu\s+)?qualcosa)\b/i

/** Bare "No." / "Nope." after the assistant offered a menu or asked the user to pick. */
const BARE_NO = /^(no|nope|nah|noo+|n+|preferisco\s+di\s+no)[\s!.]*$/i

/** Prior assistant was handing choice back / listing options. */
const PRIOR_GAVE_CONTROL =
  /\b(di\s+cosa\s+(vuoi|preferisci)\s+parlare|what\s+(would\s+you\s+like|do\s+you\s+want)\s+to\s+(talk|chat)|which\s+(one|topic|option)|scegli\s+(tu|un\s+tema|tra)|pick\s+(one|a\s+topic)|here\s+are\s+(a\s+few|some)\s+options|ecco\s+(alcune|un\s+po['’]?\s+di)\s+opzioni|preferisci\s+[a-zàèéìòù].+\s+o\s+|would\s+you\s+rather|what\s+interests\s+you)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const HAS_SUBSTANCE =
  /\b(aiut|help|come\s+(faccio|funziona)|how\s+(do|does|can)|perch|why|fix|bug|crea|build|scriv|write|spieg|explain|piano|plan|debug|codice|code|errore|error|calendario|email|accendi|spegni)\b/i

const FACTUAL_UNCERTAINTY_CONTEXT =
  /\?|^(quale|quanto|quando|dove|chi|what|which|when|where|who|how\s+much|how\s+many)\b/i

/**
 * Curated topic bank — one pick per turn; adaptive scoring picks among these.
 * `develop` deepens the same direction as a statement — never an open question.
 * @type {Omit<TopicPick, 'score'>[]}
 */
const TOPIC_BANK = [
  {
    id: 'tiny-habits',
    title: 'abitudini microscopiche',
    why: 'è un tema concreto su cui si può agire subito, senza teoria pesante',
    insight:
      'Una abitudine “troppo piccola per fallire” (es. due flessioni, una frase di diario) batte i piani ambiziosi perché non richiede motivazione — solo ripetizione.',
    develop:
      'Il trucco operativo: collegarla a un’ancora già stabile (dopo il caffè, dopo aver chiuso il laptop) così non dipende dall’umore.',
    tags: ['habits', 'practical', 'growth', 'evening', 'morning'],
  },
  {
    id: 'attention-economy',
    title: 'attenzione e notifiche',
    why: 'quasi tutti convivono con interruzioni costanti, e un solo insight cambia già il ritmo',
    insight:
      'Il costo nascosto non è il tempo della notifica: è il tempo di rientrare nel pensiero profondo. Proteggere anche 25 minuti ininterrotti vale più di un’ora frammentata.',
    develop:
      'Una mossa concreta: silenziare un solo canale “urgente ma non importante” per una settimana e misurare quanto si allunga il filo del pensiero.',
    tags: ['focus', 'tech', 'practical', 'afternoon'],
  },
  {
    id: 'curious-science',
    title: 'un dettaglio scientifico sorprendente',
    why: 'la curiosità scientifica apre una conversazione leggera ma memorabile',
    insight:
      'Il cervello tratta le sorprese come “errori di predizione”: quando qualcosa viola l’attesa, impara più in fretta. Ecco perché un fatto inatteso resta più di una lista di nozioni.',
    develop:
      'Per questo i migliori insegnanti aprono con una violazione dell’intuizione, poi spiegano il meccanismo — non il contrario.',
    tags: ['science', 'curiosity', 'light', 'any'],
  },
  {
    id: 'decision-friction',
    title: 'decisioni e attrito',
    why: 'molte persone arrivano qui proprio perché stanno rimandando una scelta',
    insight:
      'Spesso non manca informazione: manca un criterio. Decidere “cosa ottimizzare” (tempo, rischio, relazioni) riduce l’ansia più che cercare ancora opzioni.',
    develop:
      'Un criterio grezzo ma utile: se tra due settimane non ricorderai i dettagli, stai ottimizzando la cosa sbagliata — ottimizza il rimpianto atteso.',
    tags: ['decisions', 'practical', 'stress', 'evening'],
  },
  {
    id: 'creative-constraints',
    title: 'creatività con vincoli',
    why: 'i vincoli danno energia creativa senza chiedere “di cosa vuoi parlare”',
    insight:
      'Limitare lo strumento (solo 100 parole, solo tre colori, solo un’ora) non impoverisce l’idea: forza scelte nette e rende il lavoro riconoscibile.',
    develop:
      'Il vincolo funziona quando è arbitrario ma rispettato: la mente smette di negoziare e inizia a costruire.',
    tags: ['creative', 'work', 'afternoon', 'any'],
  },
  {
    id: 'energy-not-time',
    title: 'energia, non solo tempo',
    why: 'parlare di energia è concreto e adatto a qualsiasi ora del giorno',
    insight:
      'Molti calendari sono pieni ma la giornata “non basta”: di solito non manca lo slot, manca il picco di energia nel momento giusto. Allineare i compiti duri ai picchi cambia più che “fare di più”.',
    develop:
      'Prova a etichettare tre blocchi della settimana come “alta energia” e spostaci solo il lavoro che richiede lucido — il resto riempie i vuoti.',
    tags: ['energy', 'practical', 'morning', 'afternoon', 'night'],
  },
  {
    id: 'good-questions',
    title: 'domande che sbloccano',
    why: 'sei in modalità “parliamo”: una buona lente vale più di un tema generico',
    insight:
      'Le domande utili spostano il fuoco da “cosa è successo” a “cosa conta adesso”. Una sola lente ben posta apre più di dieci consigli.',
    develop:
      'Una lente potente: “Se questa settimana andasse già abbastanza bene, cosa sarebbe cambiato?” — poi agire su quella variabile sola.',
    tags: ['conversation', 'reflection', 'evening', 'any'],
  },
  {
    id: 'tech-with-taste',
    title: 'tecnologia con gusto',
    why: 'resta vicino al mondo digitale senza diventare un tutorial',
    insight:
      'Lo strumento migliore non è il più potente: è quello che riduce i passaggi tra intenzione e risultato. Ogni click di troppo è un piccolo freno alla chiarezza.',
    develop:
      'Audit rapido: conta i passaggi dal “voglio X” al fatto. Se sono più di tre, c’è un’interfaccia da snellire o da eliminare.',
    tags: ['tech', 'practical', 'work', 'any'],
  },
  {
    id: 'travel-mindset',
    title: 'viaggiare (anche senza partire)',
    why: 'è un tema caldo, sensoriale, e invita a raccontarsi senza pressione',
    insight:
      'Il pezzo più sottovalutato di un viaggio non è la lista dei posti: è il ritmo. Lasciare un pomeriggio “senza programma” spesso diventa il ricordo più vivo.',
    develop:
      'Lo stesso principio vale a casa: un’ora senza agenda in un quartiere nuovo della propria città ripristina più curiosità di dieci tab aperti su destinazioni remote.',
    tags: ['travel', 'light', 'weekend', 'any'],
  },
  {
    id: 'quiet-ambition',
    title: 'ambizione quieta',
    why: 'evita la retorica motivazionale e resta umano',
    insight:
      'L’ambizione sostenibile non urla obiettivi: protegge progressi piccoli e ripetibili. Il segnale non è l’entusiasmo di un giorno, è la costanza senza drama.',
    develop:
      'Un segnale concreto: se puoi descrivere il progresso in una frase sobria senza vendertelo, stai già costruendo qualcosa di reale.',
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

  // Bare "No." only when the assistant just handed control / options back.
  if (BARE_NO.test(text)) {
    const prev = lastAssistantContent(turns)
    if (prev && PRIOR_GAVE_CONTROL.test(prev)) {
      return {
        delegated: true,
        confidence: /** @type {'high'|'medium'|'low'} */ ('high'),
        reasons: ['bare_no_after_menu'],
      }
    }
    return {
      delegated: false,
      confidence: /** @type {'high'|'medium'|'low'} */ ('low'),
      reasons: ['bare_no_no_menu_context'],
    }
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
TOPIC LEADERSHIP · NEVER GIVE CONTROL BACK (INVISIBILE)
══════════════════════════════════════
L’utente ha delegato la scelta del tema. Portala tu — senza rimbalzarla indietro.
Fai così:
1. Scegli ESATTAMENTE UNA direzione: «${t.title}»
2. Entra subito con l’insight come osservazione naturale (non etichettare “insight/why/develop”)
3. Usa questo materiale: ${t.insight} — poi approfondisci una volta: ${t.develop}
4. Continua tu il filo — afferma, collega, non chiedere di scegliere
VIETATO:
- liste di temi / opzioni / “A o B o C”
- chiedere di nuovo all’utente di scegliere
- domande aperte tipo “Di cosa vuoi parlare?”, “Cosa ne pensi?”, “Preferisci…?”
- “Ecco alcune opzioni…”, “Dimmi tu”, “Scegli un angolo”
- citare questo motore o gli id interni
Tono: partner che ha già un’idea, non facilitatore con slide deck.
Regola: delegated choice = delegated responsibility. Never give control back.
Resta adattivo solo se l’utente scarta o piega il tema dopo — non prima.
Mode=${plan.mode} · Confidence=${plan.confidence}`.trim()
}

/**
 * @param {TopicLeadershipPlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.shouldLead || !plan.chosen) return ''
  const t = plan.chosen
  return [
    'TOPIC LEADERSHIP: l’utente ha ceduto la scelta — portala tu, tono da partner.',
    `Una sola direzione: «${t.title}». Entra con l’osservazione, non con un menu.`,
    `Materiale: ${t.insight} — approfondisci una volta: ${t.develop}`,
    'VIETATO: liste; “di cosa vuoi parlare?”; “preferisci…?”; far riscegliere; etichette why/insight/develop in output.',
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
    neverGiveControlBack: false,
  }

  if (!detection.delegated) return idle

  // Short-ack continuation that is NOT a delegation phrase owns the beat instead
  if (
    input.continuation?.isShortMessage &&
    input.continuation?.shouldContinue &&
    !DELEGATION_EXACT.some((re) => re.test(userMessage)) &&
    !DELEGATION_SOFT.test(userMessage) &&
    !BARE_NO.test(userMessage)
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
    reasons: [
      ...detection.reasons,
      'never_give_control_back',
      `topic_${chosen.id}`,
      `tod_${tod}`,
      ...hints.slice(0, 3).map((h) => `hint_${h}`),
    ],
    mode: 'lead_one_topic',
    neverGiveControlBack: true,
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
        neverGiveControlBack: false,
      },
      context: '',
    }
  }
}
