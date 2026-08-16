/**
 * LAIfe Language Awareness & Adaptation
 *
 * Lightweight deterministic language signal for Core (and legacy Writer).
 * No second LLM call. No DB persistence. Fail-soft.
 *
 * Supported high-confidence markers: it | en | es | fr | de
 * Unsupported / uncertain → Core may infer; sticky conversation language held.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'it'|'en'|'es'|'fr'|'de'|'auto'} ReplyLanguage
 */

/**
 * @typedef {object} LanguageSignal
 * @property {ReplyLanguage} language
 * @property {boolean} confident
 * @property {'high'|'medium'|'low'} confidence
 * @property {boolean} ambiguousShort
 * @property {string} strippedText
 * @property {Record<string, number>} scores
 */

/**
 * @typedef {object} LanguageAwarenessPlan
 * @property {boolean} active
 * @property {ReplyLanguage} detected
 * @property {ReplyLanguage} conversationLanguage  sticky language for the chat
 * @property {ReplyLanguage} replyLanguage  language the Writer/Core must use now
 * @property {boolean} switched  intentional switch this turn
 * @property {boolean} metaRequest  user asked to change / use their language
 * @property {string | null} switchTo  requested language name if explicit
 * @property {boolean} currentTurnConfident
 * @property {boolean} [noLinguisticSignal]  empty caption / image-only — no language evidence
 * @property {string} writerBrief
 * @property {string} coreBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 */

const SUPPORTED = new Set(['it', 'en', 'es', 'fr', 'de'])

const EXPLICIT_EN =
  /\b(speak\s+(?:to\s+me\s+)?in\s+english|answer\s+in\s+english|reply\s+in\s+english|in\s+english\s+please|switch\s+to\s+english|can\s+you\s+(?:speak|answer|reply)\s+in\s+english|english\s+please|let'?s\s+(?:speak|continue|talk)\s+in\s+english|now\s+let'?s\s+continue\s+in\s+english|rispondi(?:mi)?\s+in\s+inglese)\b/i

const EXPLICIT_IT =
  /\b(parla\s+italiano|rispondi(?:mi)?\s+in\s+italiano|in\s+italiano\s+per\s+favore|passiamo\s+all['’]?italiano|torniamo\s+(?:all['’])?italiano|continua\s+in\s+italiano|puoi\s+(?:parlare|rispondere)\s+in\s+italiano|italiano\s+per\s+favore|let'?s\s+(?:speak|continue)\s+in\s+italian|speak\s+(?:to\s+me\s+)?in\s+italian|answer\s+in\s+italian)\b/i

const EXPLICIT_ES =
  /\b(habla\s+espa[nñ]ol|responde\s+en\s+espa[nñ]ol|en\s+espa[nñ]ol\s+por\s+favor|switch\s+to\s+spanish|speak\s+(?:to\s+me\s+)?in\s+spanish|answer\s+in\s+spanish|espa[nñ]ol\s+por\s+favor)\b/i

const EXPLICIT_FR =
  /\b(parle\s+fran[cç]ais|r[eé]ponds\s+en\s+fran[cç]ais|en\s+fran[cç]ais\s+s['’]?il\s+te\s+pla[iî]t|speak\s+(?:to\s+me\s+)?in\s+french|answer\s+in\s+french|switch\s+to\s+french)\b/i

const EXPLICIT_DE =
  /\b(sprich\s+deutsch|antworte\s+auf\s+deutsch|auf\s+deutsch\s+bitte|speak\s+(?:to\s+me\s+)?in\s+german|answer\s+in\s+german|switch\s+to\s+german)\b/i

const META_LANGUAGE_COMPLAINT =
  /\b(why\s+don'?t\s+you\s+speak\s+in\s+my\s+language|speak\s+in\s+my\s+language|in\s+my\s+language|nella\s+mia\s+lingua|perch[eé]\s+non\s+(?:parli|rispondi)\s+nella\s+mia\s+lingua|parla\s+nella\s+mia\s+lingua|can\s+you\s+speak\s+my\s+language|en\s+mi\s+idioma|pourquoi\s+tu\s+ne\s+parles\s+pas|warum\s+sprichst\s+du\s+nicht)\b/i

const ASK_ABOUT_LANGUAGES =
  /\b(what\s+languages?\s+(?:do\s+you\s+)?speak|quali\s+lingue\s+(?:parli|conosci)|how\s+many\s+languages|sei\s+multilingue|are\s+you\s+multilingual|qu[eé]\s+idiomas|quelles\s+langues|welche\s+sprachen)\b/i

/** Single-token / short social borrowings — never alone force a sticky switch. */
const CONSERVATIVE_SOCIAL =
  /^(ok|okay|k|kk|yes|yep|yup|yeah|no|nah|si|sì|sí|oui|non|ja|nein|thanks|thank\s*you|thx|ty|grazie|gracias|merci|danke|prego|please|per\s+favore|por\s+favor|s'?il\s+te\s+pla[iî]t|bitte|sure|fine|cool|nice|wow|mh+|mhm+|hmm+|boh|già|capito|vale|d'?accord|genau)[.!…]*$/i

const AMBIGUOUS_SHORT =
  /^(ok|okay|k|yes|yep|yup|yeah|no|nah|si|sì|sí|oui|non|ja|nein|👍|😂|❤️|🙏|😊|🙂|😄|😅|✨|🔥|💯|\d+|naruto|laife|dragon\s*ball|itachi|goku)[.!…]*$/i

const IT_MARKERS =
  /\b(che|come|sono|perché|perche|qual|quale|quali|voglio|vorrei|volevo|voleva|aggiungere|aggiungo|futuro|strumento|strumenti|piattaforma|interfaccia|sviluppo|sviluppare|negozio|preferisco|preferisci|mio|mia|miei|mie|non|con|una|degli|delle|questo|questa|questi|queste|quello|quella|anche|molto|più|piu|meno|dove|quando|dopo|prima|sempre|mai|oggi|ieri|domani|prego|ciao|salve|buongiorno|buonasera|perfetto|volentieri|allora|quindi|però|pero|così|cosi|cosa|chi|ecco|boh|già|gia|magari|davvero|forse|adesso|ancora|bene|male|qui|lì|li|suo|sua|loro|noi|voi|tu|io|mi|ti|ci|vi|gli|del|della|dei|nel|nella|sul|sulla|dai|dalla|tra|sono|sei|siamo|avete|hanno|vorrei|posso|puoi|dobbiamo|dimmi|parliamo|significa|errore|progetto|preferito|preferita|preferiti|preferite|piace|piacciono|imparare|riuscendo|vita|fratello|pensi|facciamo|ricordi|dimentica|dimenticare)\b/gi

// Strong English markers only. Ultra-short shared function words (a/in/to/of/…)
// are scored separately at near-zero weight so Romance prepositions cannot tie EN.
const EN_MARKERS =
  /\b(the|what|how|why|should|would|could|my|is|are|was|were|with|this|that|these|those|please|hello|hey|hi|not|and|but|for|from|have|has|had|do|does|did|can|will|just|really|maybe|today|tomorrow|yesterday|because|about|into|over|under|again|also|very|more|most|some|any|your|you|me|we|they|them|our|his|her|its|then|than|when|where|who|which|there|here|been|being|be|remember|project|favorite|favourite|main|continue|let'?s|mean|error|forget|overview|later|feature|editor|tool)\b/gi

/** Cross-language tiny function words — never dominate EN scoring (#283). */
const EN_SHARED_STOPWORDS =
  /\b(a|an|of|to|in|on|at|by|as|if|so|or)\b/gi

const ES_MARKERS =
  /\b(qué|que|cuál|cual|cuáles|cuales|cómo|como|estás|estas|estoy|está|esta|están|estan|soy|eres|somos|tienen|tiene|tengo|quiero|quieres|porque|porqué|también|tambien|mucho|más|mas|menos|dónde|donde|cuando|después|despues|antes|siempre|nunca|hoy|ayer|mañana|manana|hola|perfecto|entonces|pero|así|asi|quién|quien|aquí|aqui|allí|alli|nosotros|vosotros|ellos|ellas|los|las|del|por|para|sin|sobre|una|unos|unas|mi|tu|su|me|te|se|le|les|lo|el|al|con|es|son|hay|significa|error|proyecto|preferido|preferida|recuerdas|olvida|olvidar|anime|cuál)\b/gi

// Avoid Romance-shared tokens that collide hard with Italian (il/la/me/sa/tu).
const FR_MARKERS =
  /\b(que|qui|quoi|comment|pourquoi|suis|es|est|sommes|êtes|etes|sont|veux|voulez|voudrais|parce|aussi|beaucoup|très|tres|plus|moins|où|ou|quand|après|apres|avant|toujours|jamais|aujourd'?hui|hier|demain|bonjour|bonsoir|salut|parfait|merci|alors|donc|mais|ainsi|ici|là|mon|ma|mes|ton|ta|tes|son|ses|notre|votre|leur|nous|vous|ils|elles|les|des|du|au|aux|une|quel|quelle|quels|quelles|je|elle|lui|y|en|avec|dans|pour|sur|pas|c'?est|ça|ca|projet|préféré|prefere|préférés|preferes|souvenir|oublie|oublier|signifie|erreur|aime|aimé)\b/gi

const DE_MARKERS =
  /\b(was|wie|warum|weshalb|bin|bist|ist|sind|seid|will|willst|wollen|weil|auch|sehr|mehr|weniger|wo|wann|nach|vor|immer|nie|heute|gestern|morgen|hallo|guten\s+tag|perfekt|also|aber|oder|nicht|und|mit|von|zu|für|fur|auf|aus|bei|nach|mein|meine|dein|deine|sein|seine|ihr|ihre|unser|euer|ich|du|er|sie|es|wir|ihr|mich|dich|ihm|uns|euch|der|die|das|dem|den|ein|eine|einem|einen|einer|projekt|lieblings|erinnerst|vergiss|vergessen|bedeutet|fehler|bitte|danke)\b/gi

const IT_CHARS = /[àèéìòù]/i
const ES_CHARS = /[áéíóúñ¿¡]/i
const FR_CHARS = /[àâæçéèêëïîôùûüÿœ]/i
const DE_CHARS = /[äöüß]/i

const IT_ENDINGS = /\b\w+(zione|mente|ità|amente|iamo|ete|ono)\b/gi
const ES_ENDINGS = /\b\w+(ción|mente|idad|amos|áis|éis|ión)\b/gi
const FR_ENDINGS = /\b\w+(tion|ment|ique|eaux|eurs|euse)\b/gi
const DE_ENDINGS = /\b\w+(ung|heit|keit|isch|lich|ieren)\b/gi

const LANGUAGE_CONTRACT = `LANGUAGE
Respond in the language of the user's latest substantive natural-language message.

If the latest message does not provide enough linguistic evidence
(e.g. 'ok', emoji, names, URLs, code, logs),
preserve the most recent confidently established conversational language.

Do not let:
- memory-pack language
- system-prompt language
- code
- logs
- JSON
- quoted text
- filenames
determine the response language.

A deliberate language switch by the user should take effect immediately.

This LANGUAGE block overrides base-prompt language inertia for reply language only.
It does not change personality, safety, memory, or system boundaries.`

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Downweight / remove technical text before deterministic detection.
 * @param {string} text
 */
export function stripTechnicalText(text) {
  let t = String(text || '')

  // Fenced code blocks
  t = t.replace(/```[\s\S]*?```/g, ' ')
  // Inline code
  t = t.replace(/`[^`\n]{1,200}`/g, ' ')
  // URLs
  t = t.replace(/\bhttps?:\/\/\S+/gi, ' ')
  t = t.replace(/\bwww\.\S+/gi, ' ')
  // Email-ish
  t = t.replace(/\b\S+@\S+\.\S+\b/g, ' ')
  // JSON-like blocks (balanced-ish braces / brackets of moderate size)
  t = t.replace(/\{[^{}]{0,2000}\}/g, ' ')
  t = t.replace(/\[[^\[\]]{0,2000}\]/g, ' ')
  // Stack-trace / log lines
  t = t.replace(/^\s*at\s+\S+.*$/gim, ' ')
  t = t.replace(/^\s*Error:\s.*$/gim, ' ')
  t = t.replace(/^\s*(?:WARN|ERROR|INFO|DEBUG|TRACE|FATAL)[:\s].*$/gim, ' ')
  t = t.replace(/\b(?:vercel|nodejs|typescript|webpack|eslint)[^\n]{0,120}/gi, ' ')
  // Filenames / paths
  t = t.replace(/\b[\w./-]+\.(?:js|ts|tsx|jsx|mjs|cjs|py|go|rs|java|json|ya?ml|toml|md|log|txt|lock)\b/gi, ' ')
  t = t.replace(/\b(?:src|lib|api|dist|node_modules)\/[\w./-]+/gi, ' ')
  // fact_keys / dotted machine keys
  t = t.replace(/\b(?:preferences|identity|projects|skills|profession|interest)\.[a-z0-9_.-]{2,80}\b/gi, ' ')
  // Long quoted blocks (double / guillemets are unambiguous quotation marks).
  t = t.replace(/"[^"]{80,}"/g, ' ')
  t = t.replace(/«[^»]{80,}»/g, ' ')
  // Single-quoted long blocks ONLY when delimiters are quotation punctuation,
  // never mid-word Romance elisions (l'anime … un'altra, c'est, j'aime, …).
  // Opening ' must not follow a letter; closing ' must not precede a letter.
  t = t.replace(/(?<![A-Za-zÀ-ÖØ-öø-ÿ])'[^']{80,}'(?![A-Za-zÀ-ÖØ-öø-ÿ])/g, ' ')

  return normalize(t)
}

/**
 * @param {string} text
 */
function countMatches(text, re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const copy = new RegExp(re.source, flags)
  return (text.match(copy) || []).length
}

/**
 * @param {string} text
 * @returns {LanguageSignal}
 */
export function detectLanguageSignal(text) {
  const original = normalize(text)
  const stripped = stripTechnicalText(original)
  const t = stripped || original

  /** @type {Record<string, number>} */
  const scores = { it: 0, en: 0, es: 0, fr: 0, de: 0 }

  if (!t) {
    return {
      language: 'auto',
      confident: false,
      confidence: 'low',
      ambiguousShort: true,
      strippedText: '',
      scores,
    }
  }

  if (CONSERVATIVE_SOCIAL.test(t) || AMBIGUOUS_SHORT.test(t) || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t)) {
    return {
      language: 'auto',
      confident: false,
      confidence: 'low',
      ambiguousShort: true,
      strippedText: t,
      scores,
    }
  }

  // Clear monolingual greetings / questions
  if (/^(ciao|salve|buongiorno|buonasera|arrivederci)[.!?…]*$/i.test(t)) {
    return signalOf('it', 'high', t, scores, false)
  }
  if (/^(hi|hey|hello|yo|sup|goodbye|bye)[.!?…]*$/i.test(t)) {
    return signalOf('en', 'high', t, scores, false)
  }
  if (/^(hola|buenas|buenos\s+días|buenos\s+dias)[.!?…]*$/i.test(t)) {
    return signalOf('es', 'high', t, scores, false)
  }
  if (/^(bonjour|bonsoir|salut)[.!?…]*$/i.test(t)) {
    return signalOf('fr', 'high', t, scores, false)
  }
  if (/^(hallo|guten\s+tag|guten\s+morgen|guten\s+abend)[.!?…]*$/i.test(t)) {
    return signalOf('de', 'high', t, scores, false)
  }

  scores.it += countMatches(t, IT_MARKERS) * 2
  scores.en += countMatches(t, EN_MARKERS) * 2
  // Shared stopwords (a/in/to/…) contribute almost nothing — Romance prepositions
  // must not create EN ties against Italian recall probes (#283).
  scores.en += countMatches(t, EN_SHARED_STOPWORDS) * 0.25
  scores.es += countMatches(t, ES_MARKERS) * 2
  scores.fr += countMatches(t, FR_MARKERS) * 2
  scores.de += countMatches(t, DE_MARKERS) * 2

  if (IT_CHARS.test(t)) scores.it += 4
  if (ES_CHARS.test(t)) scores.es += 5
  if (FR_CHARS.test(t)) scores.fr += 4
  if (DE_CHARS.test(t)) scores.de += 5
  if (/[¿¡]/.test(t)) scores.es += 6

  scores.it += countMatches(t, IT_ENDINGS)
  scores.es += countMatches(t, ES_ENDINGS)
  scores.fr += countMatches(t, FR_ENDINGS)
  scores.de += countMatches(t, DE_ENDINGS)

  // Italian apostrophe clitics
  if (/\b(l|un|dell|nell|all|dall|sull|quest|quell|cos|com|dov)['’]/i.test(t)) scores.it += 3
  // French elisions
  if (/\b(l|d|c|j|n|m|t|s|qu)['’]/i.test(t)) scores.fr += 2

  // Strong Spanish interrogatives / verbs that IT scoring often steals
  if (/\b(cuál|cual|cómo\s+estás|como\s+estas|qué\s+tal|que\s+tal|me\s+gusta|mi\s+anime\s+preferid|olvid[ae]|recuerdas|significa\s+este)\b/i.test(t)) {
    scores.es += 6
  }
  // Strong Italian phrases (include "a me piace" / plurals — not only "mi piace")
  // Short clear conversational IT must outrank sticky FR/EN (e.g. "Come va la vita fratello?").
  if (
    /\b(come\s+stai|come\s+va|che\s+ne\s+pensi|cosa\s+ne\s+pensi|che\s+fai|cosa\s+facciamo|tutto\s+bene|cosa\s+significa|qual\s+['’]?è|qual\s+e|mi\s+piace|a\s+me\s+piace|mi\s+piacciono|i\s+miei|le\s+mie|voglio\s+imparare|progetto\s+principale|parliamo\s+di|preferit[oi]|preferit[ae]|personaggi\s+preferit)/i.test(
      t,
    )
  ) {
    scores.it += 6
  }
  // Strong English
  if (/\b(what\s+is\s+my|how\s+are\s+you|main\s+project|do\s+you\s+remember|let'?s\s+continue|what\s+do\s+you\s+remember)\b/i.test(t)) {
    scores.en += 6
  }
  // Strong French (elisions + clear FR lexicon — not shared Romance articles)
  if (
    /\b(comment\s+ça\s+va|comment\s+ca\s+va|qu['’]?est[- ]ce|mon\s+projet|je\s+suis|je\s+voudrais|j['’]aime|je\s+t['’]?aime|quels?\s+sont|très\s+content)\b/i.test(
      t,
    )
  ) {
    scores.fr += 6
  }
  // Strong German
  if (/\b(wie\s+geht\s+es|was\s+ist\s+mein|mein\s+projekt|ich\s+bin)\b/i.test(t)) {
    scores.de += 6
  }

  // Disambiguate Romance overlap: Spanish inverted punctuation / accents beat shared tokens
  if (scores.es > 0 && scores.it > 0 && scores.es >= scores.it - 2) {
    if (/[¿¡ñ]/.test(t) || /\b(está|estas|estás|cuál|cual|quién|quien|también|tambien|después|despues|mañana|manana|hola)\b/i.test(t)) {
      scores.es += 4
      scores.it = Math.max(0, scores.it - 3)
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [bestLang, bestScore] = ranked[0]
  const secondScore = ranked[1]?.[1] || 0

  if (bestScore <= 0) {
    return {
      language: 'auto',
      confident: false,
      confidence: 'low',
      ambiguousShort: false,
      strippedText: t,
      scores,
    }
  }

  const margin = bestScore - secondScore
  const words = t.split(/\s+/).filter(Boolean).length
  let confidence = 'low'
  let confident = false

  if (bestScore >= 6 && margin >= 3) {
    confidence = 'high'
    confident = true
  } else if (bestScore >= 4 && margin >= 2) {
    confidence = 'medium'
    confident = words >= 3 || bestScore >= 8
  } else if (margin >= 4 && bestScore >= 4) {
    confidence = 'medium'
    confident = true
  }

  // Single clear greeting-like multiword already handled; require confidence for short strings
  if (words <= 2 && !confident && bestScore < 8) {
    return {
      language: 'auto',
      confident: false,
      confidence: 'low',
      ambiguousShort: true,
      strippedText: t,
      scores,
    }
  }

  if (!confident) {
    return {
      language: /** @type {ReplyLanguage} */ (bestLang),
      confident: false,
      confidence: 'low',
      ambiguousShort: false,
      strippedText: t,
      scores,
    }
  }

  return signalOf(/** @type {ReplyLanguage} */ (bestLang), confidence, t, scores, false)
}

/**
 * @param {ReplyLanguage} language
 * @param {'high'|'medium'|'low'} confidence
 * @param {string} strippedText
 * @param {Record<string, number>} scores
 * @param {boolean} ambiguousShort
 * @returns {LanguageSignal}
 */
function signalOf(language, confidence, strippedText, scores, ambiguousShort) {
  return {
    language,
    confident: confidence === 'high' || confidence === 'medium',
    confidence,
    ambiguousShort,
    strippedText,
    scores: { ...scores },
  }
}

/**
 * Detect dominant language of a single message.
 * @param {string} text
 * @returns {ReplyLanguage}
 */
export function detectDominantLanguage(text) {
  const signal = detectLanguageSignal(text)
  if (signal.confident && signal.language !== 'auto') return signal.language
  if (signal.language !== 'auto' && signal.confidence !== 'low') return signal.language
  // Soft best-guess when clearly scored but below confidence bar — only for
  // multi-word substantive text (legacy callers expect it|en more often).
  if (signal.language !== 'auto' && !signal.ambiguousShort) {
    const words = signal.strippedText.split(/\s+/).filter(Boolean).length
    if (words >= 3) return signal.language
  }
  return 'auto'
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
  if (EXPLICIT_ES.test(t)) {
    return { explicit: 'es', metaComplaint: false, askAboutLanguages: false }
  }
  if (EXPLICIT_FR.test(t)) {
    return { explicit: 'fr', metaComplaint: false, askAboutLanguages: false }
  }
  if (EXPLICIT_DE.test(t)) {
    return { explicit: 'de', metaComplaint: false, askAboutLanguages: false }
  }

  return {
    explicit: null,
    metaComplaint: META_LANGUAGE_COMPLAINT.test(t),
    askAboutLanguages: ASK_ABOUT_LANGUAGES.test(t),
  }
}

/**
 * Most recent confidently established language from recent user turns.
 * @param {ChatTurn[] | null | undefined} messages
 * @param {string} [excludeLatest]
 * @returns {ReplyLanguage}
 */
export function deriveStickyConversationLanguage(messages, excludeLatest) {
  const list = Array.isArray(messages) ? messages : []
  const exclude = normalize(excludeLatest || '')
  const recentUsers = list
    .filter((m) => m?.role === 'user' && typeof m.content === 'string')
    .map((m) => normalize(m.content))
    .filter(Boolean)

  // Walk newest → oldest; skip the current turn if it matches excludeLatest
  for (let i = recentUsers.length - 1; i >= 0; i -= 1) {
    const content = recentUsers[i]
    if (exclude && content === exclude) continue
    const signal = detectLanguageSignal(content)
    if (signal.confident && SUPPORTED.has(signal.language)) {
      return /** @type {ReplyLanguage} */ (signal.language)
    }
  }
  return 'auto'
}

/**
 * @param {ReplyLanguage} lang
 */
function languageLabel(lang) {
  if (lang === 'it') return 'italiano'
  if (lang === 'en') return 'English'
  if (lang === 'es') return 'español'
  if (lang === 'fr') return 'français'
  if (lang === 'de') return 'Deutsch'
  return "the user's language"
}

/**
 * Map browser locale → supported reply language (final fallback only).
 * @param {unknown} locale
 * @returns {ReplyLanguage}
 */
export function localeToReplyLanguage(locale) {
  const raw = String(locale || '')
    .trim()
    .toLowerCase()
  if (!raw) return 'auto'
  const primary = raw.split(/[-_]/)[0]
  if (SUPPORTED.has(primary)) return /** @type {ReplyLanguage} */ (primary)
  return 'auto'
}

/**
 * Compact Core language brief (never shown to the user).
 * @param {LanguageAwarenessPlan} plan
 */
export function formatCoreLanguageBrief(plan) {
  if (!plan?.active) return ''
  const currentConfident = Boolean(plan.currentTurnConfident)
  const detected = plan.detected
  const sticky = plan.conversationLanguage
  const reply = plan.replyLanguage
  const noLinguisticSignal = Boolean(
    plan.noLinguisticSignal ||
      (Array.isArray(plan.reasons) && plan.reasons.includes('no_linguistic_signal')),
  )

  if (!currentConfident || detected === 'auto') {
    const lines = [
      'LANGUAGE:',
      `- current turn language: uncertain`,
      `- keep conversation language: ${sticky !== 'auto' ? sticky : reply}`,
      `- response language: ${reply}`,
    ]
    // Image-only / empty caption: sticky is authoritative over any synthetic model nudge.
    if (noLinguisticSignal && reply !== 'auto') {
      lines.push('Current user turn contains no linguistic signal.')
      lines.push(`Respond in the established conversation language: ${reply}.`)
    }
    return lines.join('\n')
  }

  return [
    'LANGUAGE:',
    `- detected current turn language: ${detected}`,
    `- most recent confident conversation language: ${sticky !== 'auto' ? sticky : detected}`,
    `- current turn is confident: yes`,
    `- response language: ${reply}`,
  ].join('\n')
}

/**
 * Full Core appendix: contract + brief.
 * @param {LanguageAwarenessPlan} plan
 */
export function formatCoreLanguageAppendix(plan) {
  const brief = formatCoreLanguageBrief(plan)
  if (!brief) return LANGUAGE_CONTRACT
  return `${LANGUAGE_CONTRACT}\n\n${brief}`
}

/**
 * Resolve reply language from message + conversation sticky language.
 * @param {object} [input]
 * @returns {LanguageAwarenessPlan}
 */
export function buildLanguageAwarenessPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')

  // Empty current turn = NO NEW LANGUAGE SIGNAL (e.g. image-only caption).
  // Preserve sticky from history when available; do not invent a default language.
  if (!userMessage) {
    /** @type {ReplyLanguage} */
    let sticky =
      /** @type {ReplyLanguage} */ (
        input.session?.conversationLanguage ||
          input.session?.language ||
          input.priorLanguage ||
          'auto'
      )
    if (!SUPPORTED.has(sticky)) sticky = 'auto'
    if (sticky === 'auto') {
      sticky = deriveStickyConversationLanguage(input.messages, '')
    }

    if (sticky === 'auto' || !SUPPORTED.has(sticky)) {
      // Fresh thread / no established language — keep prior safe inactive fallback.
      return {
        active: false,
        detected: 'auto',
        conversationLanguage: 'auto',
        replyLanguage: 'auto',
        switched: false,
        metaRequest: false,
        switchTo: null,
        currentTurnConfident: false,
        noLinguisticSignal: true,
        writerBrief: '',
        coreBrief: '',
        structureLine: null,
        responseHints: [],
        reasons: ['empty', 'no_linguistic_signal', 'sticky_none'],
        signals: ['empty', 'no_linguistic_signal'],
        confidence: 'low',
      }
    }

    const plan = {
      active: true,
      detected: 'auto',
      conversationLanguage: sticky,
      replyLanguage: sticky,
      switched: false,
      metaRequest: false,
      switchTo: null,
      currentTurnConfident: false,
      noLinguisticSignal: true,
      writerBrief: [
        'LANGUAGE AWARENESS & ADAPTATION:',
        `Rispondi in ${languageLabel(sticky)} (${sticky}).`,
        `Mantieni la lingua della conversazione: ${languageLabel(sticky)}.`,
        'Current user turn contains no linguistic signal — do not switch language.',
        'Non spiegare lingue salvo richiesta esplicita.',
        'Ignora la lingua del memory pack / system prompt per la scelta della lingua di risposta.',
      ].join(' '),
      coreBrief: '',
      structureLine: `Language Awareness → reply=${sticky} · maintain · no_linguistic_signal`,
      responseHints: [
        `Scrivi l’intera risposta in ${languageLabel(sticky)}.`,
        'Current user turn contains no linguistic signal — preserve established conversation language.',
        'Memory-pack / system-prompt language must not dictate reply language.',
      ],
      reasons: [
        'detected_uncertain',
        `reply_${sticky}`,
        `sticky_${sticky}`,
        'content_language',
        'maintain',
        'empty',
        'no_linguistic_signal',
      ],
      signals: ['language_awareness', sticky, 'natural', 'hold', 'no_linguistic_signal'],
      confidence: 'medium',
    }
    plan.coreBrief = formatCoreLanguageBrief(plan)
    return plan
  }

  const turnSignal = detectLanguageSignal(userMessage)
  const detected = turnSignal.confident ? turnSignal.language : turnSignal.ambiguousShort ? 'auto' : turnSignal.language
  const intent = detectLanguageIntent(userMessage)

  /** @type {ReplyLanguage} */
  let sticky =
    /** @type {ReplyLanguage} */ (
      input.session?.conversationLanguage ||
      input.session?.language ||
      input.priorLanguage ||
      'auto'
    )

  if (!SUPPORTED.has(sticky)) sticky = 'auto'

  if (sticky === 'auto') {
    sticky = deriveStickyConversationLanguage(input.messages, userMessage)
  }

  // Optional browser locale — FINAL fallback only (never overrides confident turn/sticky).
  const localeLang = localeToReplyLanguage(input.browserLocale || input.locale)

  let replyLanguage = /** @type {ReplyLanguage} */ (
    turnSignal.confident && detected !== 'auto' ? detected : sticky
  )
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
    const target =
      turnSignal.confident && detected !== 'auto'
        ? detected
        : sticky !== 'auto'
          ? sticky
          : localeLang !== 'auto'
            ? localeLang
            : 'en'
    replyLanguage = target
    switched = true
    metaRequest = true
    switchTo = target
  } else if (turnSignal.confident && detected !== 'auto' && sticky !== 'auto' && detected !== sticky) {
    // Natural language switch — confident current turn always wins.
    replyLanguage = detected
    switched = true
    switchTo = detected
  } else if (turnSignal.confident && detected !== 'auto') {
    replyLanguage = detected
  } else if ((!turnSignal.confident || detected === 'auto') && sticky !== 'auto') {
    // Ambiguous / short / social borrowing → keep sticky
    replyLanguage = sticky
  } else if (
    sticky === 'auto' &&
    !turnSignal.ambiguousShort &&
    !intent.explicit &&
    detected !== 'auto' &&
    SUPPORTED.has(detected)
  ) {
    // Soft best-guess (#283): substantive multi-word turn with a ranked language
    // but below the confidence bar — do NOT fall through to hard default English.
    // Never overrides an established sticky language (handled above).
    replyLanguage = /** @type {ReplyLanguage} */ (detected)
  }

  if (replyLanguage === 'auto') {
    // Soft guess from dominant language when scores exist but confidence was low.
    const soft = detectDominantLanguage(userMessage)
    if (
      sticky === 'auto' &&
      !turnSignal.ambiguousShort &&
      soft !== 'auto' &&
      SUPPORTED.has(soft)
    ) {
      replyLanguage = soft
    } else {
      replyLanguage = sticky !== 'auto' ? sticky : localeLang !== 'auto' ? localeLang : 'en'
    }
  }

  // conversationLanguage tracks the sticky established language *before* this
  // turn's switch for the brief; after a confident switch, sticky becomes reply.
  const conversationLanguageForBrief = sticky !== 'auto' ? sticky : replyLanguage
  const conversationLanguage = turnSignal.confident || intent.explicit ? replyLanguage : conversationLanguageForBrief

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
      ? "L’utente ha chiesto esplicitamente delle lingue — puoi rispondere brevemente, poi continua nella lingua attiva."
      : 'Non spiegare lingue salvo richiesta esplicita.',
    'Non mescolare lingue nella stessa risposta (salvo citazioni brevi).',
    'Ignora la lingua del memory pack / system prompt per la scelta della lingua di risposta.',
  ]
    .filter(Boolean)
    .join(' ')

  const plan = {
    active: true,
    detected: turnSignal.ambiguousShort || !turnSignal.confident ? 'auto' : detected,
    conversationLanguage: conversationLanguageForBrief,
    replyLanguage,
    switched: Boolean(switched || metaRequest),
    metaRequest,
    switchTo,
    currentTurnConfident: Boolean(turnSignal.confident || intent.explicit),
    writerBrief,
    coreBrief: '',
    structureLine: `Language Awareness → reply=${replyLanguage}${switched || metaRequest ? ' · SWITCH' : ' · maintain'}`,
    responseHints: [
      `Scrivi l’intera risposta in ${languageLabel(replyLanguage)}.`,
      metaRequest
        ? 'Meta-richiesta lingua: adatta subito, ack corto, niente lezione sulle lingue.'
        : 'Mantieni la lingua del filo conversazionale quando il turno è ambiguo.',
      'Niente scuse lunghe. Adatta e continua.',
      'Memory-pack / system-prompt language must not dictate reply language.',
    ],
    reasons: [
      `detected_${turnSignal.confident ? detected : 'uncertain'}`,
      `reply_${replyLanguage}`,
      sticky !== 'auto' ? `sticky_${sticky}` : 'sticky_none',
      metaRequest ? 'meta_request' : 'content_language',
      switched ? 'switched' : 'maintain',
      turnSignal.ambiguousShort ? 'ambiguous_short' : 'substantive',
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
        : turnSignal.confident
          ? turnSignal.confidence
          : sticky !== 'auto'
            ? 'medium'
            : 'low',
  }

  plan.coreBrief = formatCoreLanguageBrief(plan)
  return plan
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
 * Build Core-ready appendix from request context.
 * @param {object} [input]
 */
export function buildCoreLanguageAppendix(input = {}) {
  const { plan } = runLanguageAwareness(input)
  if (!plan?.active) return LANGUAGE_CONTRACT
  return formatCoreLanguageAppendix(plan)
}

/**
 * Control-path reply language: supported langs when confident; never force
 * Italian for clearly non-Italian text.
 * @param {string} message
 * @param {{ messages?: ChatTurn[], browserLocale?: string }} [opts]
 * @returns {ReplyLanguage}
 */
export function resolveControlReplyLanguage(message, opts = {}) {
  const plan = buildLanguageAwarenessPlan({
    userMessage: message,
    messages: opts.messages,
    browserLocale: opts.browserLocale,
  })
  const lang = plan.replyLanguage
  if (SUPPORTED.has(lang)) return lang
  return 'en'
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
        currentTurnConfident: false,
        writerBrief: '',
        coreBrief: '',
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
 * Apply sticky language onto session memory (mutate gently). Ephemeral only.
 * @param {object | null | undefined} memory
 * @param {LanguageAwarenessPlan | null | undefined} plan
 */
export function persistConversationLanguage(memory, plan) {
  if (!memory || !plan?.active) return memory
  if (SUPPORTED.has(plan.replyLanguage) && plan.replyLanguage !== 'auto') {
    memory.conversationLanguage = plan.replyLanguage
    memory.language = plan.replyLanguage
  }
  return memory
}

export { LANGUAGE_CONTRACT, SUPPORTED as SUPPORTED_REPLY_LANGUAGES }
