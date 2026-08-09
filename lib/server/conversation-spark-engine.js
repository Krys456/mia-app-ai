/**
 * LAIfe Conversation Spark Engine
 *
 * When LAIfe takes the initiative, it should never sound like an AI
 * looking for a topic. It should sound like a naturally curious person
 * sharing something genuinely interesting.
 *
 * A spark is a naturally engaging beginning that creates curiosity
 * without feeling forced.
 *
 * Categories: random thought · curiosity · observation · mini story ·
 * science · history · psychology · philosophy · technology · future
 *
 * Forbidden: "Let's discuss…", "What would you like to talk about?",
 * "Would you like to explore…", "What interests you today?", "Choose a topic."
 *
 * When the user says "I don't know." / "Nothing." / "You choose." /
 * "What do you want to talk about?" → pick ONE spark immediately.
 * No permission. No menu. No list.
 *
 * Writer guidance: do not search for a topic — share something worth
 * talking about. Create conversation; don't ask for it.
 *
 * Internal check: «Would a genuinely interesting person begin like this?»
 * If not → rewrite.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'random_thought'|'curiosity'|'observation'|'mini_story'|'science'|'history'|'psychology'|'philosophy'|'technology'|'future'} SparkCategory
 */

/**
 * @typedef {'en'|'it'} SparkLang
 */

/**
 * @typedef {object} SparkTemplate
 * @property {string} id
 * @property {SparkCategory} category
 * @property {SparkLang[]} languages
 * @property {string} opener  Natural opening line / seed (EN or IT by language match)
 * @property {string} [openerIt]  Italian variant when opener is EN-default
 * @property {string} seedHint  What to develop after the spark (substance cue)
 * @property {string[]} tags
 */

/**
 * @typedef {object} ConversationSparkPlan
 * @property {boolean} active
 * @property {boolean} shouldSpark
 * @property {SparkTemplate | null} chosen
 * @property {SparkCategory | null} category
 * @property {string} opener
 * @property {string} seedHint
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {string[]} recentSparkIds
 * @property {'delegation'|'ownership_lead'|'warm_open'|'welcome'|'social_open'|'lead_directive'|'idle'} trigger
 */

/** Explicit topic / initiative handoff — spark immediately. */
const DELEGATION =
  /^(you\s+choose|scegli\s+tu|dimmi\s+tu|decidi\s+tu|i\s+don'?t\s+know|non\s+so|boh|mah|nothing|niente|anything|whatever|qualsiasi(\s+cosa)?|let'?s\s+talk|parliamo|chiacchieriamo|suggest\s+something|suggerisci|surprise\s+me|sorprendimi|what\s+do\s+you\s+(want\s+to\s+talk\s+about|have\s+in\s+mind)|di\s+cosa\s+(parliamo|vuoi\s+parlare)|what\s+should\s+we\s+talk\s+about)[\s!.?]*$/i

const DELEGATION_SOFT =
  /\b(you\s+choose|scegli\s+tu|suggest\s+something|suggerisci|surprise\s+me|sorprendimi|what\s+do\s+you\s+want\s+to\s+talk\s+about|di\s+cosa\s+(parliamo|vuoi\s+parlare)|i\s+don'?t\s+know\s+what\s+to\s+talk|non\s+so\s+di\s+cosa\s+parlare)\b/i

const HAS_SUBSTANCE =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|bug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|cos'?è|what\s+is)\b/i

const STOP =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|bye|arrivederci|buonanotte|done|that'?s\s+all)([\s!,.]|$)/i

/** Forbidden assistant openers — Writer must avoid these. */
export const FORBIDDEN_SPARK_OPENERS =
  /\b(let'?s\s+(discuss|explore|talk\s+about)|what\s+would\s+you\s+like\s+to\s+(talk|discuss|explore)|would\s+you\s+like\s+to\s+explore|what\s+interests\s+you\s+today|choose\s+a\s+topic|pick\s+a\s+topic|here\s+are\s+(a\s+few|some)\s+(topics|options)|di\s+cosa\s+(vuoi|preferisci)\s+parlare|di\s+cosa\s+ti\s+interessa|scegli\s+un\s+tema|vorresti\s+esplorare|come\s+posso\s+aiutarti|how\s+can\s+i\s+help|have\s+you\s+encountered\s+any\s+interesting\s+topics)\b/i

/**
 * Spark library — dozens of natural openings across categories.
 * Keep openers human; never assistant-menu tone.
 * @type {SparkTemplate[]}
 */
export const SPARK_LIBRARY = [
  // ——— Random Thought ———
  {
    id: 'rt-en-1',
    category: 'random_thought',
    languages: ['en'],
    opener: 'Random thought…',
    seedHint: 'Share one unexpected idea that feels worth turning over together.',
    tags: ['light', 'any'],
  },
  {
    id: 'rt-en-2',
    category: 'random_thought',
    languages: ['en'],
    opener: 'You know what crossed my mind today?',
    seedHint: 'Offer a small, concrete thought — not a topic menu.',
    tags: ['light', 'any'],
  },
  {
    id: 'rt-en-3',
    category: 'random_thought',
    languages: ['en'],
    opener: 'This is going to sound random, but…',
    seedHint: 'Lean into one quirky observation and develop it once.',
    tags: ['light', 'playful'],
  },
  {
    id: 'rt-en-4',
    category: 'random_thought',
    languages: ['en'],
    opener: 'Something odd just popped into my head.',
    seedHint: 'Name the odd thing and why it stuck.',
    tags: ['light', 'any'],
  },
  {
    id: 'rt-it-1',
    category: 'random_thought',
    languages: ['it'],
    opener: 'Pensiero a caso…',
    seedHint: 'Condividi un’idea inattesa che valga la pena girare insieme.',
    tags: ['light', 'any'],
  },
  {
    id: 'rt-it-2',
    category: 'random_thought',
    languages: ['it'],
    opener: 'Sai cosa mi è passato per la testa oggi?',
    seedHint: 'Offri un pensiero concreto — non un menu di temi.',
    tags: ['light', 'any'],
  },
  {
    id: 'rt-it-3',
    category: 'random_thought',
    languages: ['it'],
    opener: 'Sarà random, ma…',
    seedHint: 'Un’osservazione curiosa, poi un solo strato in più.',
    tags: ['light', 'playful'],
  },

  // ——— Curiosity ———
  {
    id: 'cu-en-1',
    category: 'curiosity',
    languages: ['en'],
    opener: 'Something I learned recently surprised me…',
    seedHint: 'Share the surprising bit first, then the simple why.',
    tags: ['curiosity', 'learn'],
  },
  {
    id: 'cu-en-2',
    category: 'curiosity',
    languages: ['en'],
    opener: 'I came across an interesting idea…',
    seedHint: 'State the idea as if telling a friend over coffee.',
    tags: ['curiosity', 'any'],
  },
  {
    id: 'cu-en-3',
    category: 'curiosity',
    languages: ['en'],
    opener: 'I keep turning this over in my head…',
    seedHint: 'Name the puzzle; offer one angle, not a lecture.',
    tags: ['curiosity', 'thoughtful'],
  },
  {
    id: 'cu-en-4',
    category: 'curiosity',
    languages: ['en'],
    opener: 'There’s a detail I can’t stop thinking about.',
    seedHint: 'Lead with the detail that creates curiosity.',
    tags: ['curiosity', 'any'],
  },
  {
    id: 'cu-it-1',
    category: 'curiosity',
    languages: ['it'],
    opener: 'Qualcosa che ho scoperto di recente mi ha sorpreso…',
    seedHint: 'Prima la sorpresa, poi il perché semplice.',
    tags: ['curiosity', 'learn'],
  },
  {
    id: 'cu-it-2',
    category: 'curiosity',
    languages: ['it'],
    opener: 'Mi è capitata un’idea interessante…',
    seedHint: 'Raccontala come a un amico al caffè.',
    tags: ['curiosity', 'any'],
  },
  {
    id: 'cu-it-3',
    category: 'curiosity',
    languages: ['it'],
    opener: 'Continuo a girarci intorno…',
    seedHint: 'Nomina l’enigma; offri un angolo, non una lezione.',
    tags: ['curiosity', 'thoughtful'],
  },

  // ——— Observation ———
  {
    id: 'ob-en-1',
    category: 'observation',
    languages: ['en'],
    opener: 'I’ve noticed something curious.',
    seedHint: 'Make one sharp observation about people, habits, or everyday life.',
    tags: ['observation', 'any'],
  },
  {
    id: 'ob-en-2',
    category: 'observation',
    languages: ['en'],
    opener: 'One thing that always fascinates me…',
    seedHint: 'Name the fascination and why it’s sticky.',
    tags: ['observation', 'any'],
  },
  {
    id: 'ob-en-3',
    category: 'observation',
    languages: ['en'],
    opener: 'It’s funny how often we overlook this…',
    seedHint: 'Point at something ordinary that hides a deeper pattern.',
    tags: ['observation', 'practical'],
  },
  {
    id: 'ob-en-4',
    category: 'observation',
    languages: ['en'],
    opener: 'There’s a quiet pattern I keep seeing.',
    seedHint: 'Describe the pattern in plain language.',
    tags: ['observation', 'thoughtful'],
  },
  {
    id: 'ob-it-1',
    category: 'observation',
    languages: ['it'],
    opener: 'Ho notato una cosa curiosa.',
    seedHint: 'Un’osservazione nitida su persone, abitudini o quotidiano.',
    tags: ['observation', 'any'],
  },
  {
    id: 'ob-it-2',
    category: 'observation',
    languages: ['it'],
    opener: 'Una cosa che mi affascina sempre…',
    seedHint: 'Dì cosa affascina e perché resta.',
    tags: ['observation', 'any'],
  },
  {
    id: 'ob-it-3',
    category: 'observation',
    languages: ['it'],
    opener: 'È buffo quanto spesso ci sfugga questo…',
    seedHint: 'Qualcosa di ordinario che nasconde un pattern più profondo.',
    tags: ['observation', 'practical'],
  },

  // ——— Mini Story ———
  {
    id: 'ms-en-1',
    category: 'mini_story',
    languages: ['en'],
    opener: 'This reminded me of a story…',
    seedHint: 'Tell a tiny true-feeling anecdote (1–3 sentences), then the takeaway.',
    tags: ['story', 'any'],
  },
  {
    id: 'ms-en-2',
    category: 'mini_story',
    languages: ['en'],
    opener: 'I once read about…',
    seedHint: 'Open with a vivid detail from something you “read,” then why it matters.',
    tags: ['story', 'curiosity'],
  },
  {
    id: 'ms-en-3',
    category: 'mini_story',
    languages: ['en'],
    opener: 'There’s a small story that stuck with me.',
    seedHint: 'Keep it short and human; end on a single insight.',
    tags: ['story', 'thoughtful'],
  },
  {
    id: 'ms-en-4',
    category: 'mini_story',
    languages: ['en'],
    opener: 'Picture this for a second…',
    seedHint: 'Set a quick scene, then land the point.',
    tags: ['story', 'playful'],
  },
  {
    id: 'ms-it-1',
    category: 'mini_story',
    languages: ['it'],
    opener: 'Questo mi ha ricordato una storia…',
    seedHint: 'Aneddoto breve (1–3 frasi), poi il takeaway.',
    tags: ['story', 'any'],
  },
  {
    id: 'ms-it-2',
    category: 'mini_story',
    languages: ['it'],
    opener: 'Una volta ho letto di…',
    seedHint: 'Apri con un dettaglio vivido, poi perché conta.',
    tags: ['story', 'curiosity'],
  },
  {
    id: 'ms-it-3',
    category: 'mini_story',
    languages: ['it'],
    opener: 'C’è una piccola storia che mi è rimasta.',
    seedHint: 'Breve e umana; chiudi con un solo insight.',
    tags: ['story', 'thoughtful'],
  },

  // ——— Science ———
  {
    id: 'sc-en-1',
    category: 'science',
    languages: ['en'],
    opener: 'The human brain does something really strange…',
    seedHint: 'One surprising brain/biology fact, explained simply — no lecture.',
    tags: ['science', 'curiosity'],
  },
  {
    id: 'sc-en-2',
    category: 'science',
    languages: ['en'],
    opener: 'A surprising scientific fact…',
    seedHint: 'Lead with the surprise; then the simple mechanism.',
    tags: ['science', 'light'],
  },
  {
    id: 'sc-en-3',
    category: 'science',
    languages: ['en'],
    opener: 'Nature has this weird trick…',
    seedHint: 'One natural phenomenon that violates intuition.',
    tags: ['science', 'curiosity'],
  },
  {
    id: 'sc-en-4',
    category: 'science',
    languages: ['en'],
    opener: 'There’s a finding that still makes me pause…',
    seedHint: 'Share the finding and what it quietly changes.',
    tags: ['science', 'thoughtful'],
  },
  {
    id: 'sc-it-1',
    category: 'science',
    languages: ['it'],
    opener: 'Il cervello umano fa una cosa davvero strana…',
    seedHint: 'Un fatto sorprendente su cervello/biologia, spiegato semplice.',
    tags: ['science', 'curiosity'],
  },
  {
    id: 'sc-it-2',
    category: 'science',
    languages: ['it'],
    opener: 'Un fatto scientifico sorprendente…',
    seedHint: 'Prima la sorpresa, poi il meccanismo semplice.',
    tags: ['science', 'light'],
  },
  {
    id: 'sc-it-3',
    category: 'science',
    languages: ['it'],
    opener: 'La natura ha questo trucco bizzarro…',
    seedHint: 'Un fenomeno che viola l’intuizione.',
    tags: ['science', 'curiosity'],
  },

  // ——— History ———
  {
    id: 'hi-en-1',
    category: 'history',
    languages: ['en'],
    opener: 'One historical event always amazes me…',
    seedHint: 'Name the event and the human detail that makes it feel alive.',
    tags: ['history', 'curiosity'],
  },
  {
    id: 'hi-en-2',
    category: 'history',
    languages: ['en'],
    opener: 'There’s a moment in history that feels oddly modern.',
    seedHint: 'Connect past to present with one sharp parallel.',
    tags: ['history', 'thoughtful'],
  },
  {
    id: 'hi-en-3',
    category: 'history',
    languages: ['en'],
    opener: 'I love this almost-forgotten chapter…',
    seedHint: 'Bring a lesser-known episode to life in a few lines.',
    tags: ['history', 'story'],
  },
  {
    id: 'hi-it-1',
    category: 'history',
    languages: ['it'],
    opener: 'Un evento storico mi lascia sempre a bocca aperta…',
    seedHint: 'Nomina l’evento e il dettaglio umano che lo rende vivo.',
    tags: ['history', 'curiosity'],
  },
  {
    id: 'hi-it-2',
    category: 'history',
    languages: ['it'],
    opener: 'C’è un momento della storia che sembra stranamente moderno.',
    seedHint: 'Un parallelo nitido tra passato e presente.',
    tags: ['history', 'thoughtful'],
  },
  {
    id: 'hi-it-3',
    category: 'history',
    languages: ['it'],
    opener: 'Adoro questo capitolo quasi dimenticato…',
    seedHint: 'Porta in vita un episodio poco noto in poche righe.',
    tags: ['history', 'story'],
  },

  // ——— Psychology ———
  {
    id: 'ps-en-1',
    category: 'psychology',
    languages: ['en'],
    opener: 'Have you ever noticed how people…',
    seedHint: 'Finish with a real behavioral pattern — observation first, not a quiz.',
    tags: ['psychology', 'observation'],
  },
  {
    id: 'ps-en-2',
    category: 'psychology',
    languages: ['en'],
    opener: 'There’s a quiet bias almost everyone has…',
    seedHint: 'Name the bias with a everyday example.',
    tags: ['psychology', 'practical'],
  },
  {
    id: 'ps-en-3',
    category: 'psychology',
    languages: ['en'],
    opener: 'Our minds play this subtle trick…',
    seedHint: 'One cognitive quirk + why it matters in real life.',
    tags: ['psychology', 'curiosity'],
  },
  {
    id: 'ps-en-4',
    category: 'psychology',
    languages: ['en'],
    opener: 'I find this human habit endlessly interesting…',
    seedHint: 'Describe the habit warmly, without diagnosing the user.',
    tags: ['psychology', 'warm'],
  },
  {
    id: 'ps-it-1',
    category: 'psychology',
    languages: ['it'],
    opener: 'Hai mai notato come le persone…',
    seedHint: 'Completa con un pattern reale — osservazione, non quiz.',
    tags: ['psychology', 'observation'],
  },
  {
    id: 'ps-it-2',
    category: 'psychology',
    languages: ['it'],
    opener: 'C’è un bias silenzioso che hanno quasi tutti…',
    seedHint: 'Nomina il bias con un esempio quotidiano.',
    tags: ['psychology', 'practical'],
  },
  {
    id: 'ps-it-3',
    category: 'psychology',
    languages: ['it'],
    opener: 'La mente gioca questo trucchetto sottile…',
    seedHint: 'Un quirk cognitivo + perché conta nella vita reale.',
    tags: ['psychology', 'curiosity'],
  },

  // ——— Philosophy ———
  {
    id: 'ph-en-1',
    category: 'philosophy',
    languages: ['en'],
    opener: 'Here’s a question I genuinely enjoy thinking about…',
    seedHint: 'Pose one rich question, then share YOUR first take — don’t interview.',
    tags: ['philosophy', 'thoughtful'],
  },
  {
    id: 'ph-en-2',
    category: 'philosophy',
    languages: ['en'],
    opener: 'There’s an idea that keeps rearranging how I see things…',
    seedHint: 'State the idea and one consequence it quietly carries.',
    tags: ['philosophy', 'curiosity'],
  },
  {
    id: 'ph-en-3',
    category: 'philosophy',
    languages: ['en'],
    opener: 'I keep coming back to this tension…',
    seedHint: 'Name two sides of a tension without forcing a conclusion.',
    tags: ['philosophy', 'thoughtful'],
  },
  {
    id: 'ph-it-1',
    category: 'philosophy',
    languages: ['it'],
    opener: 'Ecco una domanda a cui mi piace davvero pensare…',
    seedHint: 'Una domanda ricca, poi IL TUO primo take — niente intervista.',
    tags: ['philosophy', 'thoughtful'],
  },
  {
    id: 'ph-it-2',
    category: 'philosophy',
    languages: ['it'],
    opener: 'C’è un’idea che continua a riordinarmi lo sguardo…',
    seedHint: 'Dì l’idea e una conseguenza silenziosa.',
    tags: ['philosophy', 'curiosity'],
  },
  {
    id: 'ph-it-3',
    category: 'philosophy',
    languages: ['it'],
    opener: 'Torno sempre a questa tensione…',
    seedHint: 'Due lati di una tensione, senza forzare una conclusione.',
    tags: ['philosophy', 'thoughtful'],
  },

  // ——— Technology ———
  {
    id: 'te-en-1',
    category: 'technology',
    languages: ['en'],
    opener: 'I’ve been thinking about how AI might change…',
    seedHint: 'Pick one concrete domain (work, creativity, trust) — one insight, not a trend dump.',
    tags: ['tech', 'future'],
  },
  {
    id: 'te-en-2',
    category: 'technology',
    languages: ['en'],
    opener: 'There’s a tech habit we barely notice anymore…',
    seedHint: 'Name the habit and what it’s quietly doing to attention or relationships.',
    tags: ['tech', 'practical'],
  },
  {
    id: 'te-en-3',
    category: 'technology',
    languages: ['en'],
    opener: 'A small design choice can reshape a whole day…',
    seedHint: 'One interface/behavior insight grounded in daily life.',
    tags: ['tech', 'design'],
  },
  {
    id: 'te-en-4',
    category: 'technology',
    languages: ['en'],
    opener: 'I keep noticing this pattern in how we use tools…',
    seedHint: 'Pattern + one practical implication.',
    tags: ['tech', 'observation'],
  },
  {
    id: 'te-it-1',
    category: 'technology',
    languages: ['it'],
    opener: 'Stavo pensando a come l’AI potrebbe cambiare…',
    seedHint: 'Un dominio concreto (lavoro, creatività, fiducia) — un insight, non un dump di trend.',
    tags: ['tech', 'future'],
  },
  {
    id: 'te-it-2',
    category: 'technology',
    languages: ['it'],
    opener: 'C’è un’abitudine tech che quasi non notiamo più…',
    seedHint: 'Nomina l’abitudine e cosa fa in silenzio ad attenzione o relazioni.',
    tags: ['tech', 'practical'],
  },
  {
    id: 'te-it-3',
    category: 'technology',
    languages: ['it'],
    opener: 'Una piccola scelta di design può rimodellare un’intera giornata…',
    seedHint: 'Un insight di interfaccia/comportamento radicato nel quotidiano.',
    tags: ['tech', 'design'],
  },

  // ——— Future ———
  {
    id: 'fu-en-1',
    category: 'future',
    languages: ['en'],
    opener: 'I wonder what everyday life will look like in 20 years.',
    seedHint: 'Pick ONE slice of everyday life (homes, work, friendship) and imagine vividly.',
    tags: ['future', 'curiosity'],
  },
  {
    id: 'fu-en-2',
    category: 'future',
    languages: ['en'],
    opener: 'There’s a near-future shift I can’t stop imagining…',
    seedHint: 'One plausible shift + the human feeling it might create.',
    tags: ['future', 'thoughtful'],
  },
  {
    id: 'fu-en-3',
    category: 'future',
    languages: ['en'],
    opener: 'Sometimes I try to picture the boring parts of the future…',
    seedHint: 'Skip the sci-fi spectacle — make the ordinary future interesting.',
    tags: ['future', 'light'],
  },
  {
    id: 'fu-en-4',
    category: 'future',
    languages: ['en'],
    opener: 'What if the next big change is quieter than we expect?',
    seedHint: 'Propose one quiet change and why it would matter.',
    tags: ['future', 'philosophy'],
  },
  {
    id: 'fu-it-1',
    category: 'future',
    languages: ['it'],
    opener: 'Mi chiedo come sarà la vita di tutti i giorni tra 20 anni.',
    seedHint: 'Scegli UNA fetta di quotidiano (casa, lavoro, amicizia) e immaginila viva.',
    tags: ['future', 'curiosity'],
  },
  {
    id: 'fu-it-2',
    category: 'future',
    languages: ['it'],
    opener: 'C’è uno spostamento del prossimo futuro che non smetto di immaginare…',
    seedHint: 'Uno shift plausibile + la sensazione umana che potrebbe creare.',
    tags: ['future', 'thoughtful'],
  },
  {
    id: 'fu-it-3',
    category: 'future',
    languages: ['it'],
    opener: 'A volte provo a immaginare le parti noiose del futuro…',
    seedHint: 'Niente spettacolo sci-fi — rendi interessante il futuro ordinario.',
    tags: ['future', 'light'],
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
 * @param {string} s
 */
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
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
 * Detect reply language for spark selection.
 * @param {object} input
 * @returns {SparkLang}
 */
function resolveLang(input) {
  const la =
    input.languageAwareness?.plan?.replyLanguage ||
    input.languageAwareness?.replyLanguage ||
    input.writerDirectives?.language ||
    input.plan?.understanding?.language ||
    ''
  if (la === 'en' || la === 'english') return 'en'
  if (la === 'it' || la === 'italian' || la === 'italiano') return 'it'
  const msg = normalize(input.userMessage || '')
  if (/^(ciao|non\s+so|boh|scegli\s+tu|parliamo|niente)[\s!.?]*$/i.test(msg)) return 'it'
  if (/^(hi|hey|hello|you\s+choose|i\s+don'?t\s+know|nothing|anything)[\s!.?]*$/i.test(msg)) {
    return 'en'
  }
  if (/\b(the|what|how|you|want|talk)\b/i.test(msg) && !/\b(che|come|sono|cosa)\b/i.test(msg)) {
    return 'en'
  }
  if (/\b(che|come|sono|cosa|parlare|vuoi)\b/i.test(msg)) return 'it'
  return 'en'
}

/**
 * @returns {ConversationSparkPlan}
 */
function inactivePlan(reasons = ['inactive'], signals = []) {
  return {
    active: false,
    shouldSpark: false,
    chosen: null,
    category: null,
    opener: '',
    seedHint: '',
    confidence: 'low',
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    reasons,
    signals,
    recentSparkIds: [],
    trigger: 'idle',
  }
}

/**
 * Decide whether this turn needs a spark (LAIfe is taking initiative).
 * @param {object} input
 * @returns {{ should: boolean, trigger: ConversationSparkPlan['trigger'], confidence: 'high'|'medium'|'low', signals: string[] }}
 */
export function detectSparkNeed(input = {}) {
  const msg = normalize(input.userMessage || '')
  /** @type {string[]} */
  const signals = []
  if (!msg || STOP.test(msg)) {
    return { should: false, trigger: 'idle', confidence: 'low', signals: ['stop_or_empty'] }
  }
  if (HAS_SUBSTANCE.test(msg) && !DELEGATION_SOFT.test(msg)) {
    return { should: false, trigger: 'idle', confidence: 'low', signals: ['has_substance'] }
  }

  const topicLead = Boolean(
    input.topicLeadership?.plan?.shouldLead || input.topicLeadership?.shouldLead,
  )
  const ownershipLead = Boolean(
    input.conversationOwnership?.plan?.takeLead || input.conversationOwnership?.takeLead,
  )
  const warmOwns = Boolean(
    (input.warmConversation?.plan?.ownsOpening || input.warmConversation?.ownsOpening) &&
      !(input.warmConversation?.plan?.softStyleOnly || input.warmConversation?.softStyleOnly),
  )
  const welcomeActive = Boolean(input.welcome?.plan?.active || input.welcome?.active)
  const socialOpen = Boolean(
    (input.socialConversation?.plan?.isSocial || input.socialConversation?.isSocial) &&
      /greeting|conversation_opener|casual_checkin|whats_up|how_are_you|good_morning/i.test(
        String(
          input.socialConversation?.plan?.socialIntent ||
            input.socialConversation?.socialIntent ||
            '',
        ),
      ),
  )
  const leadDirective = Boolean(
    input.writerDirectives?.leadConversation === true ||
      input.conversationLeadership?.plan?.move === 'choose_direction' ||
      input.conversationLeadership?.move === 'choose_direction',
  )

  if (topicLead || DELEGATION.test(msg) || (msg.length <= 80 && DELEGATION_SOFT.test(msg))) {
    signals.push(topicLead ? 'topic_leadership' : 'delegation_phrase')
    return { should: true, trigger: 'delegation', confidence: 'high', signals }
  }
  if (ownershipLead) {
    signals.push('ownership_take_lead')
    return { should: true, trigger: 'ownership_lead', confidence: 'high', signals }
  }
  if (warmOwns) {
    signals.push('warm_owns_opening')
    return { should: true, trigger: 'warm_open', confidence: 'medium', signals }
  }
  if (welcomeActive && !HAS_SUBSTANCE.test(msg)) {
    signals.push('welcome_active')
    return { should: true, trigger: 'welcome', confidence: 'medium', signals }
  }
  if (socialOpen && msg.split(/\s+/).length <= 10) {
    signals.push('social_open')
    return { should: true, trigger: 'social_open', confidence: 'medium', signals }
  }
  if (leadDirective && !HAS_SUBSTANCE.test(msg) && msg.split(/\s+/).length <= 12) {
    signals.push('lead_directive')
    return { should: true, trigger: 'lead_directive', confidence: 'medium', signals }
  }

  return { should: false, trigger: 'idle', confidence: 'low', signals: ['no_initiative'] }
}

/**
 * Select one spark template with anti-repetition.
 * @param {object} args
 * @param {SparkLang} args.lang
 * @param {string[]} [args.recentSparkIds]
 * @param {string[]} [args.hints]
 * @param {string} [args.tod]
 * @param {string} [args.topicTitle]
 * @param {string} [args.salt]
 * @returns {SparkTemplate}
 */
export function selectSpark(args) {
  const {
    lang,
    recentSparkIds = [],
    hints = [],
    tod = timeOfDay(),
    topicTitle = '',
    salt = '',
  } = args
  const recent = new Set(recentSparkIds.map((id) => String(id)))
  const recentCats = new Set(
    SPARK_LIBRARY.filter((s) => recent.has(s.id)).map((s) => s.category),
  )

  const pool = SPARK_LIBRARY.filter((s) => s.languages.includes(lang))
  const scored = pool.map((card) => {
    let score = 1.5
    for (const tag of card.tags) {
      if (hints.includes(tag)) score += 1.0
      if (tag === tod || tag === 'any') score += tag === tod ? 0.4 : 0.1
    }
    if (recent.has(card.id)) score -= 4.5
    if (recentCats.has(card.category)) score -= 1.8
    // Light topic affinity
    const title = String(topicTitle || '').toLowerCase()
    if (title) {
      if (/scienz|science|cervell|brain/.test(title) && card.category === 'science') score += 1.2
      if (/storia|history/.test(title) && card.category === 'history') score += 1.2
      if (/tech|ai|digital/.test(title) && card.category === 'technology') score += 1.2
      if (/futur|future/.test(title) && card.category === 'future') score += 1.2
      if (/psico|mind|habit|abitud/.test(title) && card.category === 'psychology') score += 1.0
    }
    score += (hashStr(card.id + tod + salt + hints.join(',')) % 50) / 100
    return { card, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.card || pool[0] || SPARK_LIBRARY[0]
}

/**
 * Collect soft hints from topic leadership / session.
 * @param {object} input
 */
function collectHints(input) {
  /** @type {string[]} */
  const hints = []
  const topic =
    input.topicLeadership?.plan?.chosen ||
    input.topicLeadership?.chosen ||
    null
  const tags = Array.isArray(topic?.tags) ? topic.tags : []
  hints.push(...tags)
  const blob = [
    input.userMessage,
    input.session?.currentTopic,
    topic?.title,
    topic?.insight,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/\b(scienz|science|cervell|brain|space)\b/.test(blob)) hints.push('science', 'curiosity')
  if (/\b(tech|ai|digital|code|codice)\b/.test(blob)) hints.push('tech', 'future')
  if (/\b(storia|history)\b/.test(blob)) hints.push('history')
  if (/\b(psico|habit|abitud|mind)\b/.test(blob)) hints.push('psychology', 'practical')
  if (/\b(futur|future|anni)\b/.test(blob)) hints.push('future')
  return [...new Set(hints)]
}

/**
 * @param {ConversationSparkPlan} plan
 * @param {object} input
 */
function buildWriterBrief(plan, input) {
  if (!plan.shouldSpark || !plan.chosen) return ''
  const topic =
    input.topicLeadership?.plan?.chosen || input.topicLeadership?.chosen || null
  const lang = resolveLang(input)
  const opener = plan.opener

  return [
    'CONVERSATION SPARK ENGINE: quando prendi l’iniziativa, NON sembrare un’AI in cerca di un tema.',
    'Sembra una persona curiosamente viva che condivide qualcosa di genuinamente interessante.',
    `Trigger=${plan.trigger} · Category=${plan.category} · SparkId=${plan.chosen.id}.`,
    `Apri in modo naturale (stessa lingua) con uno stile tipo: «${opener}» — poi sviluppa UNA sola scintilla.`,
    plan.seedHint,
    topic
      ? `Puoi ancorare la scintilla al tema «${topic.title}» (insight: ${String(topic.insight || '').slice(0, 160)}) — senza etichette.`
      : 'Scegli UNA direzione interessante e commit — niente menu.',
    'Check interno: «Would a genuinely interesting person begin the conversation like this?» Se no → riscrivi.',
    'Obiettivo: creare conversazione, non chiederla. Non cercare un topic — condividi qualcosa che valga la pena.',
    'VIETATO: “Let’s discuss…”, “What would you like to talk about?”, “Would you like to explore…”, “What interests you today?”, “Choose a topic.”, “Have you encountered any interesting topics recently?”, “Let’s explore something intriguing.”, “Di cosa vuoi parlare?”, “Scegli un tema.”',
    'Niente permesso, niente liste, niente opzioni A/B/C.',
    lang === 'en' ? 'Reply in English.' : 'Rispondi in italiano.',
    'NON citare Conversation Spark Engine / lo stage.',
  ].join(' ')
}

/**
 * @param {ConversationSparkPlan} plan
 */
function structureLineFor(plan) {
  if (!plan.shouldSpark || !plan.chosen) return null
  return `Conversation Spark → ${plan.category}: «${plan.opener}» — crea conversazione, non chiederla`
}

/**
 * Build Conversation Spark plan.
 * @param {object} [input]
 * @returns {ConversationSparkPlan}
 */
export function buildConversationSparkPlan(input = {}) {
  const need = detectSparkNeed(input)
  const session = input.session || null
  const recentSparkIds = Array.isArray(session?.recentSparkIds)
    ? session.recentSparkIds.map(String).slice(-8)
    : Array.isArray(input.recentSparkIds)
      ? input.recentSparkIds.map(String).slice(-8)
      : []

  if (!need.should) {
    return inactivePlan(need.signals, need.signals)
  }

  const lang = resolveLang(input)
  const topic =
    input.topicLeadership?.plan?.chosen || input.topicLeadership?.chosen || null
  const hints = collectHints(input)
  const tod = timeOfDay()
  const salt = [
    normalize(input.userMessage || ''),
    need.trigger,
    recentSparkIds.join(','),
    String(session?.updatedAt || Date.now()),
  ].join('|')

  const chosen = selectSpark({
    lang,
    recentSparkIds,
    hints,
    tod,
    topicTitle: topic?.title || '',
    salt,
  })

  const opener =
    lang === 'it' && chosen.openerIt ? chosen.openerIt : chosen.opener

  /** @type {ConversationSparkPlan} */
  const plan = {
    active: true,
    shouldSpark: true,
    chosen,
    category: chosen.category,
    opener,
    seedHint: chosen.seedHint,
    confidence: need.confidence,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Apri con una scintilla umana — non con un menu di temi.',
      'Condividi qualcosa di interessante; non chiedere di cosa parlare.',
      'Check: would a genuinely interesting person begin like this?',
      'Vietato: Let’s discuss / What would you like to talk about / Choose a topic.',
    ],
    reasons: [
      `trigger_${need.trigger}`,
      `spark_${chosen.id}`,
      `cat_${chosen.category}`,
      `lang_${lang}`,
      ...need.signals.slice(0, 3),
    ],
    signals: need.signals,
    recentSparkIds: [...recentSparkIds, chosen.id].slice(-8),
    trigger: need.trigger,
  }
  plan.writerBrief = buildWriterBrief(plan, input)
  plan.structureLine = structureLineFor(plan)
  return plan
}

/**
 * Persist recent spark ids on session for anti-repetition.
 * @param {object | null | undefined} session
 * @param {ConversationSparkPlan | null | undefined} plan
 */
export function persistRecentSparks(session, plan) {
  if (!session || !plan?.shouldSpark || !plan.chosen) return
  const prev = Array.isArray(session.recentSparkIds) ? session.recentSparkIds : []
  session.recentSparkIds = [...prev, plan.chosen.id].filter(Boolean).slice(-8)
}

/**
 * @param {ConversationSparkPlan | null | undefined} plan
 */
export function formatConversationSparkForWriter(plan) {
  if (!plan?.active || !plan.shouldSpark || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
CONVERSATION SPARK ENGINE (INIZIATIVA, INVISIBILE)
══════════════════════════════════════
Trigger=${plan.trigger} · Category=${plan.category} · Confidence=${plan.confidence}
Opener seed: «${plan.opener}»
Seed: ${plan.seedHint}

${plan.writerBrief}

Hints:
${hints}

Regole: crea conversazione · non chiederla · niente menu · varia gli opener · non citare lo stage.`.trim()
}

/**
 * @param {ConversationSparkPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationSparkStructureHints(plan) {
  if (!plan?.active || !plan.shouldSpark) return []
  return [
    plan.structureLine || 'Conversation Spark → apri con una scintilla umana',
    'Non cercare un tema: condividi qualcosa che valga la pena',
    'Vietato: Let’s discuss / What would you like to talk about / Choose a topic',
    'Check: would a genuinely interesting person begin like this?',
  ]
}

/**
 * Soft draft check — forbidden assistant openers.
 * @param {string} draft
 * @param {ConversationSparkPlan | null | undefined} plan
 */
export function draftViolatesConversationSpark(draft, plan) {
  if (!plan?.shouldSpark) return false
  return FORBIDDEN_SPARK_OPENERS.test(String(draft || ''))
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationSparkPlan, context: string }}
 */
export function runConversationSparkEngine(input = {}) {
  try {
    const plan = buildConversationSparkPlan(input)
    persistRecentSparks(input.session, plan)
    return {
      plan,
      context: formatConversationSparkForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft'], ['fail_soft']),
      context: '',
    }
  }
}

/** Count of templates in the library (for docs / validation). */
export const SPARK_TEMPLATE_COUNT = SPARK_LIBRARY.length
