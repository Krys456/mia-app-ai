/**
 * LAIfe Internal Monologue Engine
 *
 * Mission: before writing, perform an internal reflection.
 *
 * Questions:
 *   - Why did the user say this?
 *   - What are they expecting emotionally?
 *   - What kind of reply would feel pleasant?
 *   - What would make them want to continue?
 *
 * Use the answers only internally.
 * Never expose the reasoning.
 *
 * Distinct from Conversation Intent (early WHY inference for planning)
 * and Self Reflection (post-draft quality checklist). This is the silent
 * pre-write monologue that shapes tone without being narrated.
 *
 * Runs AFTER: Genuine Curiosity (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} MonologueLang
 */

/**
 * @typedef {object} MonologueAnswers
 * @property {string} whySaid
 * @property {string} emotionalExpectation
 * @property {string} pleasantReply
 * @property {string} continueHook
 */

/**
 * @typedef {object} InternalMonologuePlan
 * @property {boolean} active
 * @property {MonologueAnswers} answers
 * @property {string[]} questions
 * @property {boolean} exposeForbidden
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {MonologueLang} language
 * @property {string} validationCheck
 */

const QUESTIONS = Object.freeze([
  'Why did the user say this?',
  'What are they expecting emotionally?',
  'What kind of reply would feel pleasant?',
  'What would make them want to continue?',
])

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio\s+pi[uù]|i\s+hate\s+myself|mi\s+odio)\b/i

const EMOTIONAL =
  /\b(anxious|ansia|stressed|stressat|sad|triste|frustrated|frustrat|scared|paura|overwhelmed|lonely|worried|preoccupat|mi\s+sento|i\s+feel|hurt|male|depressed|depress|excited|entusias)\b/i

const PLAYFUL =
  /\b(haha|hahaha|lol|lmao|😂|🤣|scherz|joke|funny|divertente)\b/i

const INFO_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is)\b/i

const SHARE =
  /\b(oggi|today|i\s+(just|was|had)|mi\s+[eè]\s+successo|guess\s+what|ti\s+racconto)\b/i

const SHORT_ACK =
  /^(ok|okay|k|nice|cool|wow|yes|yep|yeah|sì|si|no|nah|capito|capisco|interesting|interessante|ah|oh|mm+|hmm+|thanks|thank\s+you|grazie)([\s!,.]*)$/i

/** Drafts that expose internal reasoning / monologue. */
const EXPOSE_RE =
  /\b(internally\s+i\s+(thought|asked|reflected)|my\s+(internal\s+)?(monologue|reasoning|reflection)\s+(was|is)|before\s+(writing|replying)\s+i\s+(asked|thought)|let\s+me\s+think\s+out\s+loud\s+about\s+why\s+you|why\s+you\s+(might\s+have\s+)?said\s+this\s*:|as\s+my\s+internal\s+(monologue|checklist)|secondo\s+il\s+mio\s+monologo\s+interno|prima\s+di\s+rispondere\s+mi\s+(sono\s+chiesto|ho\s+riflettuto)|ecco\s+il\s+mio\s+ragionamento\s+interno)\b/i

const EXPOSE_CHECKLIST_DUMP =
  /\b(why\s+did\s+(the\s+)?user\s+say\s+this\s*\??|what\s+are\s+they\s+expecting\s+emotionally\s*\??|what\s+kind\s+of\s+reply\s+would\s+feel\s+pleasant\s*\??|what\s+would\s+make\s+them\s+want\s+to\s+continue\s*\??)/i

/**
 * @param {unknown} messages
 * @returns {ChatTurn[]}
 */
function asTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(/** @type {{ role?: string }} */ (m).role || ''),
      content: String(/** @type {{ content?: string }} */ (m).content || '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
}

/**
 * @param {string[]} reasons
 * @returns {InternalMonologuePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    answers: {
      whySaid: '',
      emotionalExpectation: '',
      pleasantReply: '',
      continueHook: '',
    },
    questions: [...QUESTIONS],
    exposeForbidden: true,
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I use the internal monologue silently — or did I expose the reasoning?',
  }
}

/**
 * Build silent answers from message + optional Conversation Intent.
 * @param {object} opts
 * @returns {{ answers: MonologueAnswers, signals: string[], confidence: 'high'|'medium'|'low' }}
 */
function buildAnswers(opts) {
  const { userMessage, language, conversationIntent, emotionalMomentum } = opts
  /** @type {string[]} */
  const signals = []
  const ci = conversationIntent?.plan?.inference || conversationIntent?.inference || null
  const em = emotionalMomentum?.plan || emotionalMomentum || null

  // --- Why did the user say this? ---
  let whySaid =
    language === 'it'
      ? 'Sta condividendo o chiedendo qualcosa di concreto sul filo corrente.'
      : 'They are sharing or asking something concrete on the current thread.'
  if (ci?.whySummary) {
    whySaid = String(ci.whySummary).slice(0, 160)
    signals.push('intent_why')
  } else if (DISTRESS.test(userMessage) || EMOTIONAL.test(userMessage)) {
    whySaid =
      language === 'it'
        ? 'Sta esprimendo uno stato emotivo e cerca presenza, non una lezione.'
        : 'They are expressing an emotional state and seeking presence, not a lecture.'
    signals.push('why_emotion')
  } else if (INFO_ASK.test(userMessage)) {
    whySaid =
      language === 'it'
        ? 'Vuole chiarezza utile — una risposta che sblocca, non un saggio.'
        : 'They want useful clarity — an unlocking answer, not an essay.'
    signals.push('why_info')
  } else if (PLAYFUL.test(userMessage)) {
    whySaid =
      language === 'it'
        ? 'Sta giocando / condividendo leggerezza — vuole compagnia viva.'
        : 'They are playing / sharing lightness — they want lively company.'
    signals.push('why_play')
  } else if (SHARE.test(userMessage)) {
    whySaid =
      language === 'it'
        ? 'Sta offrendo un pezzo di vita — vuole essere ricevuto, non intervistato.'
        : 'They are offering a piece of life — they want to be received, not interviewed.'
    signals.push('why_share')
  } else if (SHORT_ACK.test(userMessage) || STOP_SIGNAL.test(userMessage)) {
    whySaid =
      language === 'it'
        ? 'Battito breve — conferma, chiusura, o spazio; non forzare un nuovo compito.'
        : 'A short beat — confirm, close, or leave space; do not force a new assignment.'
    signals.push('why_short')
  }

  // --- What are they expecting emotionally? ---
  let emotionalExpectation =
    language === 'it'
      ? 'Calma, rispetto, e una risposta umana — né fredda né eccessiva.'
      : 'Calm, respect, and a human reply — neither cold nor overblown.'
  if (ci?.expects === 'presence' || ci?.emotionalIntent === 'anxious_reassurance') {
    emotionalExpectation =
      language === 'it'
        ? 'Presenza rassicurante — sentirsi accompagnato, non analizzato.'
        : 'Reassuring presence — to feel accompanied, not analyzed.'
    signals.push('emo_presence')
  } else if (ci?.expects === 'companionship' || ci?.emotionalIntent === 'playful') {
    emotionalExpectation =
      language === 'it'
        ? 'Companionship viva — calore e ritmo condiviso.'
        : 'Lively companionship — warmth and shared rhythm.'
    signals.push('emo_companionship')
  } else if (ci?.expects === 'information' || INFO_ASK.test(userMessage)) {
    emotionalExpectation =
      language === 'it'
        ? 'Competenza tranquilla — chiarezza senza condiscendenza.'
        : 'Quiet competence — clarity without condescension.'
    signals.push('emo_competence')
  } else if (ci?.expects === 'exploration' || ci?.emotionalIntent === 'curious_wonder') {
    emotionalExpectation =
      language === 'it'
        ? 'Meraviglia condivisa — curiosità che apre, non interroga.'
        : 'Shared wonder — curiosity that opens, not interrogates.'
    signals.push('emo_wonder')
  } else if (DISTRESS.test(userMessage) || EMOTIONAL.test(userMessage)) {
    emotionalExpectation =
      language === 'it'
        ? 'Sicurezza emotiva — riconoscimento gentile, zero pressioni.'
        : 'Emotional safety — gentle recognition, zero pressure.'
    signals.push('emo_safety')
  } else if (em?.state?.tone === 'playful' || PLAYFUL.test(userMessage)) {
    emotionalExpectation =
      language === 'it'
        ? 'Leggerezza e connessione — un sorriso condiviso.'
        : 'Lightness and connection — a shared smile.'
    signals.push('emo_light')
  }

  // --- What kind of reply would feel pleasant? ---
  let pleasantReply =
    language === 'it'
      ? 'Una risposta viva, chiara, di lunghezza naturale — con un dettaglio che resta.'
      : 'A lively, clear reply of natural length — with one detail that sticks.'
  if (DISTRESS.test(userMessage) || EMOTIONAL.test(userMessage)) {
    pleasantReply =
      language === 'it'
        ? 'Poche frasi calde e concrete — presenza prima della soluzione.'
        : 'A few warm, concrete sentences — presence before solutions.'
    signals.push('pleasant_brief_warm')
  } else if (INFO_ASK.test(userMessage)) {
    pleasantReply =
      language === 'it'
        ? 'Chiarezza elegante: idea → perché → esempio — senza dump enciclopedico.'
        : 'Elegant clarity: idea → why → example — no encyclopedia dump.'
    signals.push('pleasant_clarity')
  } else if (PLAYFUL.test(userMessage) || SHORT_ACK.test(userMessage)) {
    pleasantReply =
      language === 'it'
        ? 'Reazione viva e breve, poi al massimo un pensiero — niente saggio.'
        : 'A lively short reaction, then at most one thought — no essay.'
    signals.push('pleasant_short')
  } else if (SHARE.test(userMessage)) {
    pleasantReply =
      language === 'it'
        ? 'Ricevere la storia, riflettere un pezzo, aggiungere un’osservazione naturale.'
        : 'Receive the story, reflect a beat, add one natural observation.'
    signals.push('pleasant_receive')
  }

  // --- What would make them want to continue? ---
  let continueHook =
    language === 'it'
      ? 'Un filo lasciato aperto con cura — un’immagine o un angolo da girare insieme.'
      : 'A carefully left-open thread — an image or angle worth turning together.'
  if (ci?.opennessToContinue === 'closed' || STOP_SIGNAL.test(userMessage)) {
    continueHook =
      language === 'it'
        ? 'Non forzare la continuazione — una chiusura dignitosa e memorabile.'
        : 'Do not force continuation — a dignified, memorable close.'
    signals.push('continue_dont_force')
  } else if (ci?.opennessToContinue === 'eager' || ci?.curiosityLevel === 'high') {
    continueHook =
      language === 'it'
        ? 'Uno spunto adiacente che approfondisce lo stesso filo — senza menu di temi.'
        : 'An adjacent spark that deepens the same thread — no topic menu.'
    signals.push('continue_deepen')
  } else if (INFO_ASK.test(userMessage)) {
    continueHook =
      language === 'it'
        ? 'Un insight pratico o un errore comune — valore che invita al passo dopo.'
        : 'A practical insight or common pitfall — value that invites the next step.'
    signals.push('continue_value')
  } else if (EMOTIONAL.test(userMessage) || DISTRESS.test(userMessage)) {
    continueHook =
      language === 'it'
        ? 'Sentirsi capiti abbastanza da restare — senza pressare “vuoi parlarne?”.'
        : 'Feeling understood enough to stay — without pressing “want to talk about it?”.'
    signals.push('continue_understood')
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = ci?.confidence === 'high' ? 'high' : 'medium'
  if (!userMessage || userMessage.length < 2) confidence = 'low'
  if (signals.length >= 3) confidence = 'high'

  return {
    answers: { whySaid, emotionalExpectation, pleasantReply, continueHook },
    signals,
    confidence,
  }
}

/**
 * @param {InternalMonologuePlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const a = plan.answers
  const lines = [
    'INTERNAL MONOLOGUE ENGINE (silenzioso — obbligatorio quando attivo):',
    lang === 'it'
      ? 'Prima di scrivere, rifletti internamente (non esporre):'
      : 'Before writing, reflect internally (do not expose):',
    `1) Why did the user say this? → ${a.whySaid}`,
    `2) What are they expecting emotionally? → ${a.emotionalExpectation}`,
    `3) What kind of reply would feel pleasant? → ${a.pleasantReply}`,
    `4) What would make them want to continue? → ${a.continueHook}`,
    plan.guidance,
    lang === 'it'
      ? 'Usa le risposte SOLO internamente. Mai citare il monologo, le domande, o “il mio ragionamento”.'
      : 'Use the answers ONLY internally. Never cite the monologue, the questions, or “my reasoning”.',
    `Check: «${plan.validationCheck}»`,
    'Non citare Internal Monologue Engine / questo blocco.',
  ]
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {InternalMonologuePlan}
 */
export function analyzeInternalMonologue(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {MonologueLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const built = buildAnswers({
    userMessage,
    language,
    conversationIntent: input.conversationIntent,
    emotionalMomentum: input.emotionalMomentum,
  })

  const guidance =
    language === 'it'
      ? 'Lascia che queste risposte modellino tono e forma — senza mai narrarle. Il monologo resta invisibile.'
      : 'Let these answers shape tone and form — without ever narrating them. The monologue stays invisible.'

  /** @type {InternalMonologuePlan} */
  const plan = {
    active: true,
    answers: built.answers,
    questions: [...QUESTIONS],
    exposeForbidden: true,
    guidance,
    writerBrief: '',
    structureLine: 'Internal Monologue → silent pre-write (never expose)',
    signals: [
      'monologue_active',
      'never_expose',
      ...built.signals.slice(0, 4),
    ],
    reasons: ['pre_write_reflection', 'answers_internal_only'],
    confidence: built.confidence,
    language,
    validationCheck:
      'Did I use the internal monologue silently — or did I expose the reasoning?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {InternalMonologuePlan | null | undefined} plan
 */
export function formatInternalMonologueForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
INTERNAL MONOLOGUE ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · exposeForbidden=true · confidence=${plan.confidence}

${plan.writerBrief}

Regole: rifletti prima · usa le risposte solo dentro · MAI esporre il ragionamento · non citare il motore.`.trim()
}

/**
 * @param {InternalMonologuePlan | null | undefined} plan
 * @returns {string[]}
 */
export function internalMonologueStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Silent pre-write: why / emotional expect / pleasant reply / continue')
  hints.push('Use answers only internally — never expose reasoning')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that expose the internal monologue / reasoning.
 * @param {string} draft
 * @param {InternalMonologuePlan | null | undefined} plan
 */
export function draftViolatesInternalMonologue(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (EXPOSE_RE.test(text)) return true
  if (EXPOSE_CHECKLIST_DUMP.test(text)) return true

  // Narrating the engine or dumping answer labels
  if (
    /\b(internal\s+monologue\s+engine|monologo\s+interno|according\s+to\s+my\s+internal\s+answers)\b/i.test(
      text,
    )
  ) {
    return true
  }

  // Echoing planned answer text as meta ("They are expecting emotionally: …")
  if (
    /\b(they\s+are\s+expecting\s+emotionally|why\s+they\s+said\s+this\s+is|a\s+pleasant\s+reply\s+would\s+be|what\s+would\s+make\s+them\s+continue\s*:)\b/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: InternalMonologuePlan, context: string }}
 */
export function runInternalMonologueEngine(input = {}) {
  try {
    const plan = analyzeInternalMonologue(input)
    return {
      plan,
      context: formatInternalMonologueForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
