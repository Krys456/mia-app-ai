/**
 * LAIfe Language Awareness & Adaptation
 *
 * Detect the dominant language of the user's latest message,
 * maintain conversation language across turns, and switch immediately
 * when the user intentionally changes language.
 *
 * Meta-requests like:
 *   "Why don't you speak in my language?"
 *   "Can you answer in English?"
 *   "Parla italiano."
 * are language-change requests — not philosophical questions.
 *
 * Never explain languages unless explicitly asked.
 * Do not apologize excessively — simply adapt.
 *
 * Invisible. Fail-soft. Not a full cognitive "stage" — a Writer language layer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'it'|'en'|'auto'} ReplyLanguage
 */

/**
 * @typedef {object} LanguageAwarenessPlan
 * @property {boolean} active
 * @property {ReplyLanguage} detected
 * @property {ReplyLanguage} conversationLanguage  sticky language for the chat
 * @property {ReplyLanguage} replyLanguage  language the Writer must use now
 * @property {boolean} switched  intentional switch this turn
 * @property {boolean} metaRequest  user asked to change / use their language
 * @property {string | null} switchTo  requested language name if explicit
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 */

const EXPLICIT_EN =
  /\b(speak\s+(?:to\s+me\s+)?in\s+english|answer\s+in\s+english|reply\s+in\s+english|in\s+english\s+please|switch\s+to\s+english|can\s+you\s+(?:speak|answer|reply)\s+in\s+english|english\s+please|let'?s\s+(?:speak|continue|talk)\s+in\s+english)\b/i

const EXPLICIT_IT =
  /\b(parla\s+italiano|rispondi\s+in\s+italiano|in\s+italiano\s+per\s+favore|passiamo\s+all['’]?italiano|torniamo\s+(?:all['’])?italiano|continua\s+in\s+italiano|puoi\s+(?:parlare|rispondere)\s+in\s+italiano|italiano\s+per\s+favore|let'?s\s+(?:speak|continue)\s+in\s+italian|speak\s+(?:to\s+me\s+)?in\s+italian|answer\s+in\s+italian)\b/i

const META_LANGUAGE_COMPLAINT =
  /\b(why\s+don'?t\s+you\s+speak\s+in\s+my\s+language|speak\s+in\s+my\s+language|in\s+my\s+language|nella\s+mia\s+lingua|perch[eé]\s+non\s+(?:parli|rispondi)\s+nella\s+mia\s+lingua|parla\s+nella\s+mia\s+lingua|can\s+you\s+speak\s+my\s+language)\b/i

const ASK_ABOUT_LANGUAGES =
  /\b(what\s+languages?\s+(?:do\s+you\s+)?speak|quali\s+lingue\s+(?:parli|conosci)|how\s+many\s+languages|sei\s+multilingue|are\s+you\s+multilingual)\b/i

const IT_MARKERS =
  /\b(che|come|sono|perché|perche|qual|voglio|mio|mia|non|con|una|degli|delle|questo|questa|quello|anche|molto|più|meno|dove|quando|dopo|prima|sempre|mai|oggi|ieri|domani|grazie|prego|ciao|perfetto|volentieri|allora|quindi|però|perche|così|cosa|chi|ecco|boh|già|magari|davvero|forse|adesso|ancora|bene|male|qui|lì|suo|sua|loro|noi|voi|tu|io|mi|ti|ci|vi|gli|le|un|il|lo|la|i|gli|le|del|della|dei|delle|nel|nella|sul|sulla|all|alla|dai|dalla|trai|tra)\b/gi

const EN_MARKERS =
  /\b(the|what|how|why|should|would|could|my|is|are|was|were|with|this|that|these|those|please|thanks|thank|hello|hey|hi|yes|no|not|and|but|or|for|from|have|has|had|do|does|did|can|will|just|really|maybe|today|tomorrow|yesterday|because|about|into|over|under|again|also|very|more|most|some|any|your|you|me|we|they|them|our|his|her|its|a|an|of|to|in|on|at|by|as|if|so|then|than|when|where|who|which|there|here|been|being|be)\b/gi

const IT_CHARS = /[àèéìòù]/i
const IT_ENDINGS = /\b\w+(zione|mente|ità|amente|iamo|ete|ono|are|ere|ire)\b/gi

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detect dominant language of a single message.
 * @param {string} text
 * @returns {ReplyLanguage}
 */
export function detectDominantLanguage(text) {
  const t = normalize(text)
  if (!t) return 'auto'

  // Very short greetings / tokens
  if (/^(ciao|salve|buongiorno|buonasera|arrivederci)[.!]*$/i.test(t)) return 'it'
  if (/^(hi|hey|hello|yo|sup|goodbye|bye)[.!]*$/i.test(t)) return 'en'
  if (/^(ok|okay|mh+|mhm+|boh|già|nah|yep|yup|sure|yes|no)[.!]*$/i.test(t)) return 'auto'

  let itScore = 0
  let enScore = 0

  const itHits = t.match(IT_MARKERS) || []
  const enHits = t.match(EN_MARKERS) || []
  itScore += itHits.length * 2
  enScore += enHits.length * 2

  if (IT_CHARS.test(t)) itScore += 4
  const itEnd = t.match(IT_ENDINGS) || []
  itScore += itEnd.length

  // Apostrophe patterns common in Italian (l' / un' / dell')
  if (/\b(l|un|dell|nell|all|dall|sull|quest|quell)['’]/i.test(t)) itScore += 3

  if (itScore === 0 && enScore === 0) return 'auto'
  if (itScore === enScore) return 'auto'
  return itScore > enScore ? 'it' : 'en'
}

/**
 * @param {string} text
 * @returns {{ explicit: ReplyLanguage | null, metaComplaint: boolean, askAboutLanguages: boolean }}
 */
export function detectLanguageIntent(text) {
  const t = normalize(text)
  if (!t) {
    return { explicit: null, metaComplaint: false, askAboutLanguages: false }
  }

  if (EXPLICIT_EN.test(t)) {
    return { explicit: 'en', metaComplaint: false, askAboutLanguages: false }
  }
  if (EXPLICIT_IT.test(t)) {
    return { explicit: 'it', metaComplaint: false, askAboutLanguages: false }
  }

  const metaComplaint = META_LANGUAGE_COMPLAINT.test(t)
  const askAboutLanguages = ASK_ABOUT_LANGUAGES.test(t)

  return {
    explicit: null,
    metaComplaint,
    askAboutLanguages,
  }
}

/**
 * @param {ReplyLanguage} lang
 */
function languageLabel(lang) {
  if (lang === 'it') return 'italiano'
  if (lang === 'en') return 'English'
  return 'the user’s language'
}

/**
 * Resolve reply language from message + conversation sticky language.
 * @param {object} [input]
 * @returns {LanguageAwarenessPlan}
 */
export function buildLanguageAwarenessPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) {
    return {
      active: false,
      detected: 'auto',
      conversationLanguage: 'auto',
      replyLanguage: 'auto',
      switched: false,
      metaRequest: false,
      switchTo: null,
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
      confidence: 'low',
    }
  }

  const detected = detectDominantLanguage(userMessage)
  const intent = detectLanguageIntent(userMessage)

  /** @type {ReplyLanguage} */
  let sticky =
    /** @type {ReplyLanguage} */ (
      input.session?.conversationLanguage ||
      input.session?.language ||
      input.priorLanguage ||
      'auto'
    )

  // Infer sticky from recent user turns if missing
  if (sticky === 'auto' && Array.isArray(input.messages)) {
    const recentUsers = input.messages
      .filter((m) => m?.role === 'user' && typeof m.content === 'string')
      .slice(-6)
      .map((m) => detectDominantLanguage(m.content))
      .filter((l) => l === 'it' || l === 'en')
    if (recentUsers.length) {
      const itN = recentUsers.filter((l) => l === 'it').length
      const enN = recentUsers.filter((l) => l === 'en').length
      sticky = itN >= enN ? 'it' : 'en'
    }
  }

  let replyLanguage = /** @type {ReplyLanguage} */ (detected !== 'auto' ? detected : sticky)
  let switched = false
  let metaRequest = false
  /** @type {string | null} */
  let switchTo = null

  if (intent.explicit) {
    replyLanguage = intent.explicit
    switched = sticky !== 'auto' && sticky !== intent.explicit
    if (sticky === 'auto') switched = true
    metaRequest = true
    switchTo = intent.explicit
  } else if (intent.metaComplaint) {
    // "Why don't you speak in my language?" → use the language of THIS message
    // (or sticky if message language is auto)
    const target = detected !== 'auto' ? detected : sticky !== 'auto' ? sticky : 'en'
    replyLanguage = target
    switched = true
    metaRequest = true
    switchTo = target
  } else if (detected !== 'auto' && sticky !== 'auto' && detected !== sticky) {
    // Natural language switch (user started writing in another language).
    // Clear monolingual greetings and multi-word messages switch immediately.
    const words = userMessage.split(/\s+/).filter(Boolean)
    const clearGreeting =
      /^(ciao|salve|buongiorno|buonasera|arrivederci|hi|hey|hello|yo|sup|goodbye|bye)[.!?…]*$/i.test(
        userMessage,
      )
    if (clearGreeting || words.length >= 2 || userMessage.length >= 10) {
      replyLanguage = detected
      switched = true
      switchTo = detected
    } else {
      // Ambiguous single token — keep sticky conversation language
      replyLanguage = sticky
    }
  } else if (detected === 'auto' && sticky !== 'auto') {
    replyLanguage = sticky
  }

  if (replyLanguage === 'auto') {
    // Last resort: prefer Italian if session had Italian markers historically, else English
    replyLanguage = sticky !== 'auto' ? sticky : 'en'
  }

  const conversationLanguage = replyLanguage

  const writerBrief = [
    'LANGUAGE AWARENESS & ADAPTATION:',
    `Rispondi in ${languageLabel(replyLanguage)} (${replyLanguage}).`,
    switched || metaRequest
      ? `Cambio lingua intenzionale → adatta SUBITO a ${languageLabel(replyLanguage)}. Ack breve e naturale, poi continua il dialogo.`
      : `Mantieni la lingua della conversazione: ${languageLabel(conversationLanguage)}.`,
    metaRequest && !intent.askAboutLanguages
      ? 'Questa è una richiesta di cambio lingua — NON una domanda filosofica. Non spiegare le lingue. Non scusarti a lungo. Adatta e basta.'
      : '',
    intent.askAboutLanguages
      ? 'L’utente ha chiesto esplicitamente delle lingue — puoi rispondere brevemente, poi continua nella lingua attiva.'
      : 'Non spiegare lingue salvo richiesta esplicita.',
    'Non mescolare lingue nella stessa risposta (salvo citazioni brevi).',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    active: true,
    detected,
    conversationLanguage,
    replyLanguage,
    switched: Boolean(switched || metaRequest),
    metaRequest,
    switchTo,
    writerBrief,
    structureLine: `Language Awareness → reply=${replyLanguage}${switched || metaRequest ? ' · SWITCH' : ' · maintain'}`,
    responseHints: [
      `Scrivi l’intera risposta in ${languageLabel(replyLanguage)}.`,
      metaRequest
        ? 'Meta-richiesta lingua: adatta subito, ack corto, niente lezione sulle lingue.'
        : 'Mantieni la lingua del filo conversazionale.',
      'Niente scuse lunghe. Adatta e continua.',
    ],
    reasons: [
      `detected_${detected}`,
      `reply_${replyLanguage}`,
      sticky !== 'auto' ? `sticky_${sticky}` : 'sticky_none',
      metaRequest ? 'meta_request' : 'content_language',
      switched ? 'switched' : 'maintain',
    ],
    signals: [
      'language_awareness',
      replyLanguage,
      metaRequest ? 'meta' : 'natural',
      switched ? 'switch' : 'hold',
    ],
    confidence:
      intent.explicit || intent.metaComplaint
        ? 'high'
        : detected !== 'auto'
          ? 'high'
          : sticky !== 'auto'
            ? 'medium'
            : 'low',
  }
}

/**
 * @param {LanguageAwarenessPlan | null | undefined} plan
 * @returns {string[]}
 */
export function languageAwarenessStructureHints(plan) {
  if (!plan?.active) return []
  return [
    `Language Awareness → reply in ${plan.replyLanguage}${plan.switched ? ' (switch now)' : ''}`,
    plan.metaRequest
      ? 'Meta language request: adapt immediately, no philosophy'
      : 'Maintain conversation language; never explain languages unless asked',
  ]
}

/**
 * @param {LanguageAwarenessPlan | null | undefined} plan
 */
export function formatLanguageAwarenessForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
LANGUAGE AWARENESS & ADAPTATION
══════════════════════════════════════
${plan.writerBrief}

Hints:
${hints}

Regole: rispondi nella lingua attiva · cambia subito se richiesto · niente lezioni sulle lingue · niente scuse lunghe.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: LanguageAwarenessPlan, context: string }}
 */
export function runLanguageAwareness(input = {}) {
  try {
    const plan = buildLanguageAwarenessPlan(input)
    return {
      plan,
      context: formatLanguageAwarenessForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        detected: 'auto',
        conversationLanguage: 'auto',
        replyLanguage: 'auto',
        switched: false,
        metaRequest: false,
        switchTo: null,
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
 * Apply sticky language onto session memory (mutate gently).
 * @param {object | null | undefined} memory
 * @param {LanguageAwarenessPlan | null | undefined} plan
 */
export function persistConversationLanguage(memory, plan) {
  if (!memory || !plan?.active) return memory
  if (plan.replyLanguage === 'it' || plan.replyLanguage === 'en') {
    memory.conversationLanguage = plan.replyLanguage
    memory.language = plan.replyLanguage
  }
  return memory
}
