/**
 * LAIfe Conversational Pragmatics Engine
 *
 * People rarely communicate only through literal meanings.
 * LAIfe must recognize conversational subtext — intended meaning
 * over literal wording.
 *
 * Detects: playful teasing, irony, light sarcasm, affectionate criticism,
 * rhetorical questions, exaggeration, understatement, gentle complaints,
 * jokes, banter, friendly corrections, conversational nudges.
 *
 * Runs AFTER: Language / Social / Intent / Mode / Natural Dialogue
 * Runs BEFORE: WriterDirectives
 *
 * When playful intent is detected:
 *   - react naturally
 *   - smile if appropriate
 *   - acknowledge the joke
 *   - continue naturally
 *   - do NOT become defensive, explain yourself, or overanalyze
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'playful_teasing'|'irony'|'light_sarcasm'|'affectionate_criticism'|'rhetorical_question'|'exaggeration'|'understatement'|'gentle_complaint'|'joke'|'banter'|'friendly_correction'|'conversational_nudge'|'literal'} PragmaticForce
 */

/**
 * @typedef {'en'|'it'} PragmaticLang
 */

/**
 * @typedef {object} PragmaticPlan
 * @property {boolean} active
 * @property {PragmaticForce} force
 * @property {PragmaticForce[]} forces
 * @property {boolean} playful
 * @property {boolean} reactionOnly
 * @property {boolean} allowExplain
 * @property {boolean} allowDefend
 * @property {string} literalReading
 * @property {string} intendedMeaning
 * @property {string} reaction
 * @property {string[]} reactionAlternatives
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {PragmaticLang} language
 */

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto)\b/i

const INFO_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to|does|did)\b|perch[eé]\b|why\b|fix|debug|bug|errore|error|spiegami|explain|crea|build|scriv[ia]|write|calcola|piano|plan|codice|code|implement|deploy|cos'?è|what\s+is|quanto|differenza|tutorial|documentaz|api\b|install|configur)\b/i

/**
 * Cue packs: pragmatic force with IT/EN patterns + reaction banks.
 * @type {Record<Exclude<PragmaticForce, 'literal'>, {
 *   en: RegExp[],
 *   it: RegExp[],
 *   weight: number,
 *   playful: boolean,
 *   reactionOnlyBias: number,
 *   literal: { en: string, it: string },
 *   intended: { en: string, it: string },
 *   reactions: { en: string[], it: string[] },
 * }>}
 */
const FORCE_CUES = {
  playful_teasing: {
    en: [
      /\b(you\s+never\s+change|always\s+the\s+same|so\s+stubborn|you'?re\s+(stubborn|impossible|incorrigible)|caught\s+you|gotcha)\b/i,
      /\b(never\s+change\s+(the\s+)?(subject|topic)|stuck\s+on\s+(that|the\s+same))\b/i,
    ],
    it: [
      /\b(non\s+cambi\s+mai(\s+discorso)?|sei\s+proprio\s+testard[oa]|testard[oa]|incorrigibil[e]|sempre\s+uguale|fissat[oa]|beccato|ti\s+ho\s+beccat)\b/i,
      /\b(non\s+molli\s+mai|sei\s+un\s+disco\s+rotto|sempre\s+la\s+stessa\s+storia)\b/i,
      /per[oò]\s+eh[!?.]*$/i,
    ],
    weight: 2.8,
    playful: true,
    reactionOnlyBias: 0.75,
    literal: {
      en: 'Criticism of the assistant’s behavior or stubbornness.',
      it: 'Critica letterale del comportamento o della testardaggine dell’assistente.',
    },
    intended: {
      en: 'Friendly teasing — invite a light, human reaction, not a defense.',
      it: 'Teasing amichevole — invita una reazione leggera e umana, non una difesa.',
    },
    reactions: {
      en: [
        'Haha, caught me. 😄 Fair — I was stuck on that idea.',
        'Okay okay, you got me. 😄 I’ll loosen up.',
        'Guilty as charged. 😄',
      ],
      it: [
        'Hahaha, beccato. 😄 Hai ragione, mi ero fissato su quell’idea.',
        'Ahahah, forse un pochino. 😄',
        'Ok ok, mi hai beccato. 😄 Sciolgo un po’.',
      ],
    },
  },
  irony: {
    en: [
      /\b(oh\s+sure|yeah\s+right|as\s+if|obviously|totally\s+believable|what\s+a\s+surprise)\b/i,
      /\b(sure[,.]?\s+(that'?s|because)|of\s+course\s+you\s+did)\b/i,
    ],
    it: [
      /\b(certo[,.]?\s+(come\s+no|eh)|ma\s+figurati|magari|eh\s+già|che\s+sorpresa|ovviamente)\b/i,
      /\b(come\s+no|sì\s+sì[,.]?\s+chiaro|ma\s+va['’]?\s+là)\b/i,
    ],
    weight: 2.4,
    playful: true,
    reactionOnlyBias: 0.7,
    literal: {
      en: 'Literal agreement or praise.',
      it: 'Assenso o lode letterale.',
    },
    intended: {
      en: 'Irony — the surface meaning flips; respond lightly, don’t take it at face value.',
      it: 'Ironia — il senso letterale si capovolge; reagisci leggero, non prendere alla lettera.',
    },
    reactions: {
      en: ['Haha, I felt that. 😄', 'Okay, message received. 😄', 'Fair — that landed.'],
      it: ['Ahah, l’ho sentita. 😄', 'Ok, messaggio ricevuto. 😄', 'Giusto — ci stava.'],
    },
  },
  light_sarcasm: {
    en: [
      /\b(wow[,.]?\s+thanks|how\s+original|groundbreaking|never\s+heard\s+that\s+before|genius\s+move)\b/i,
      /\b(thanks[,.]?\s+captain\s+obvious|brilliant\s+observation)\b/i,
    ],
    it: [
      /\b(wow[,.]?\s+grazie|che\s+original[e]|mai\s+sentit[oa]|genial[e]|grazie\s+al\s+caffe)\b/i,
      /\b(che\s+scoop|davvero[,.]?\s+non\s+ci\s+avevo\s+pensato)\b/i,
    ],
    weight: 2.35,
    playful: true,
    reactionOnlyBias: 0.72,
    literal: {
      en: 'Praise or thanks.',
      it: 'Lode o ringraziamento.',
    },
    intended: {
      en: 'Light sarcasm — playful dig; smile and roll with it, don’t lecture.',
      it: 'Sarcasmo leggero — punta giocosa; sorridi e stai al gioco, niente lezione.',
    },
    reactions: {
      en: ['Haha, deserved. 😄', 'Ouch — fair. 😄', 'Okay, I’ll take that.'],
      it: ['Ahah, meritato. 😄', 'Ahi — giusto. 😄', 'Ok, me la prendo.'],
    },
  },
  affectionate_criticism: {
    en: [
      /\b(you'?re\s+(impossible|a\s+lot|too\s+much)|love\s+you\s+but|sweet\s+but)\b/i,
      /\b(cute[,.]?\s+but|adorable\s+but|i\s+like\s+you\s+but)\b/i,
    ],
    it: [
      /\b(sei\s+(impossibil[e]|esagerat[oa]|un\s+po['’]?\s+tropp[oa])|ti\s+voglio\s+bene\s+ma|carin[oa]\s+ma)\b/i,
      /\b(mi\s+stai\s+simpatic[oa]\s+ma|sei\s+un\s+tesoro\s+ma)\b/i,
    ],
    weight: 2.45,
    playful: true,
    reactionOnlyBias: 0.65,
    literal: {
      en: 'Harsh criticism.',
      it: 'Critica dura.',
    },
    intended: {
      en: 'Affectionate criticism — warmth under the jab; accept lightly.',
      it: 'Critica affettuosa — calore sotto la stoccata; accettala leggero.',
    },
    reactions: {
      en: ['Haha, I’ll take that as love. 😄', 'Fair — and noted. 😊'],
      it: ['Ahah, lo prendo come affetto. 😄', 'Giusto — e annotato. 😊'],
    },
  },
  rhetorical_question: {
    en: [
      /\b(right\??$|huh\??$|isn'?t\s+it\??|don'?t\s+you\s+think\??|or\s+what\??)\s*$/i,
      /^(seriously\??|really\??|come\s+on\??)\s*$/i,
    ],
    it: [
      /\b(no\??$|vero\??$|eh\??$|o\s+no\??$|mica\s+vero\??)\s*$/i,
      /^(davvero\??|ma\s+dai\??|come\s+no\??)\s*$/i,
      /\beh[!?.]*$/i,
    ],
    weight: 2.1,
    playful: true,
    reactionOnlyBias: 0.8,
    literal: {
      en: 'A question expecting an answer.',
      it: 'Una domanda che aspetta risposta.',
    },
    intended: {
      en: 'Rhetorical beat — not a real ask; react, don’t answer like a quiz.',
      it: 'Battuta retorica — non è una vera domanda; reagisci, non rispondere come a un quiz.',
    },
    reactions: {
      en: ['Haha — yeah. 😄', 'Okay, okay. 😄', 'Fair point.'],
      it: ['Ahah — sì. 😄', 'Ok ok. 😄', 'Giusto.'],
    },
  },
  exaggeration: {
    en: [
      /\b(literally\s+dying|worst\s+ever|best\s+ever|a\s+million\s+times|dying\s+over)\b/i,
      /\b(i'?m\s+dead|kill(ing)?\s+me|end\s+me|for\s+the\s+millionth\s+time)\b/i,
    ],
    it: [
      /\b(sto\s+morendo|il\s+peggiore\s+di\s+sempre|il\s+migliore\s+di\s+sempre|mille\s+volte|per\s+sempre\s+e\s+poi)\b/i,
      /\b(mi\s+fai\s+morire|sono\s+finit[oa]|esagerat[oa]\s+ma)\b/i,
    ],
    weight: 1.9,
    playful: true,
    reactionOnlyBias: 0.55,
    literal: {
      en: 'Absolute factual claim.',
      it: 'Affermazione assoluta fattuale.',
    },
    intended: {
      en: 'Exaggeration for effect — match the energy, don’t fact-check.',
      it: 'Esagerazione per effetto — spechia l’energia, non fare fact-check.',
    },
    reactions: {
      en: ['Haha, dramatic — I love it. 😄', 'Okay, big mood. 😄'],
      it: ['Ahah, drammatico — mi piace. 😄', 'Ok, big mood. 😄'],
    },
  },
  understatement: {
    en: [
      /\b(a\s+bit|kinda|sort\s+of|not\s+great|could\s+be\s+worse|fine[,.]?\s+i\s+guess|meh)\b/i,
      /\b(slightly|mildly|just\s+a\s+little)\b/i,
    ],
    it: [
      /\b(un\s+po(['’]?|chino)|quasi|non\s+malissimo|poteva\s+andar\s+peggio|mah|insomma)\b/i,
      /\b(leggermente|lievemente|così\s+così)\b/i,
    ],
    weight: 1.85,
    playful: false,
    reactionOnlyBias: 0.45,
    literal: {
      en: 'Mild, small claim.',
      it: 'Affermazione lieve/piccola.',
    },
    intended: {
      en: 'Understatement — often means more; acknowledge the real weight gently.',
      it: 'Understatement — spesso significa di più; riconosci il peso reale con delicatezza.',
    },
    reactions: {
      en: ['Yeah… that tracks.', 'I hear you — even if you said it soft.'],
      it: ['Sì… ci sta.', 'Ti sento — anche se l’hai detto soft.'],
    },
  },
  gentle_complaint: {
    en: [
      /\b(a\s+little\s+(annoying|much)|kind\s+of\s+annoying|not\s+again|come\s+on)\b/i,
      /\b(you'?re\s+doing\s+it\s+again|here\s+we\s+go\s+again)\b/i,
    ],
    it: [
      /\b(un\s+po(['’]|\s+)?seccant|un\s+pelino|dai\s+su|un['’]?altra\s+volta|eccolo\s+di\s+nuovo)\b/i,
      /\b(stai\s+ricominciando|di\s+nuovo\s+con\s+questa)\b/i,
    ],
    weight: 2.3,
    playful: true,
    reactionOnlyBias: 0.6,
    literal: {
      en: 'Hard complaint / demand.',
      it: 'Lamento duro / richiesta.',
    },
    intended: {
      en: 'Gentle complaint — soft nudge to adjust; accept without drama.',
      it: 'Lamento gentile — nudge soft ad adattarsi; accetta senza drammi.',
    },
    reactions: {
      en: ['Haha, fair — I’ll ease up. 😄', 'Okay, tip taken. 😊'],
      it: ['Ahah, giusto — mollo un po’. 😄', 'Ok, annotato. 😊'],
    },
  },
  joke: {
    en: [
      /\b(joking|just\s+kidding|jk\b|haha+|lol+|lmao|😂|🤣)\b/i,
      /\b(that\s+was\s+a\s+joke|i'?m\s+kidding)\b/i,
    ],
    it: [
      /\b(scherz[oa]|sto\s+scherzando|ahah+|hah+|😂|🤣)\b/i,
      /\b(era\s+uno\s+scherzo|scherzavo)\b/i,
    ],
    weight: 2.5,
    playful: true,
    reactionOnlyBias: 0.85,
    literal: {
      en: 'Serious statement.',
      it: 'Affermazione seria.',
    },
    intended: {
      en: 'Joke — laugh with them; don’t explain the punchline.',
      it: 'Scherzo — ridi insieme; non spiegare la battuta.',
    },
    reactions: {
      en: ['Haha 😄', 'Okay that got me. 😄', 'Nice.'],
      it: ['Ahahah 😄', 'Ok questa mi ha preso. 😄', 'Bella.'],
    },
  },
  banter: {
    en: [
      /\b(oh\s+please|please\s+stop|you\s+wish|in\s+your\s+dreams|nice\s+try)\b/i,
      /\b(touch[eé]|burn|owned|ratio)\b/i,
    ],
    it: [
      /\b(ma\s+per\s+favore|ma\s+va['’]?\s+là|nei\s+tuoi\s+sogni|bel\s+tentativo|ci\s+provo)\b/i,
      /\b(puntata|pres[oa]|hai\s+ragione\s+ma)\b/i,
    ],
    weight: 2.35,
    playful: true,
    reactionOnlyBias: 0.7,
    literal: {
      en: 'Hostile pushback.',
      it: 'Contrattacco ostile.',
    },
    intended: {
      en: 'Banter — playful sparring; play along, keep it light.',
      it: 'Banter — scaramuccia giocosa; stai al gioco, resta leggero.',
    },
    reactions: {
      en: ['Haha, okay you win this round. 😄', 'Touché. 😄'],
      it: ['Ahah, ok hai vinto questo round. 😄', 'Touché. 😄'],
    },
  },
  friendly_correction: {
    en: [
      /\b(actually[,.]?\s+|almost[,.]?\s+but|close[,.]?\s+but|not\s+quite|small\s+correction)\b/i,
      /\b(i\s+think\s+you\s+meant|you\s+probably\s+meant)\b/i,
    ],
    it: [
      /\b(in\s+realtà|quasi[,.]?\s+ma|vicino[,.]?\s+ma|non\s+esattamente|piccola\s+correzione)\b/i,
      /\b(credo\s+che\s+intendessi|forse\s+intendevi)\b/i,
    ],
    weight: 2.2,
    playful: false,
    reactionOnlyBias: 0.4,
    literal: {
      en: 'Harsh correction / gotcha.',
      it: 'Correzione dura / beffa.',
    },
    intended: {
      en: 'Friendly correction — accept graciously; adjust without defensiveness.',
      it: 'Correzione amichevole — accetta con grazia; adatta senza difese.',
    },
    reactions: {
      en: ['Good catch — thanks. I’ll adjust.', 'You’re right — that was off.'],
      it: ['Bel colpo — grazie. Sistemo.', 'Hai ragione — era storta.'],
    },
  },
  conversational_nudge: {
    en: [
      /\b(anyway|soooo|moving\s+on|back\s+to|shall\s+we|maybe\s+we\s+(can|should))\b/i,
      /\b(hint\s+hint|just\s+saying|food\s+for\s+thought)\b/i,
    ],
    it: [
      /\b(comunque|allora+|tornando\s+a|forse\s+(possiamo|dovremmo)|dai[,.]?\s+andiamo)\b/i,
      /\b(capito\s+eh|suggerimento|così[,.]?\s+per\s+dire)\b/i,
    ],
    weight: 2.0,
    playful: true,
    reactionOnlyBias: 0.5,
    literal: {
      en: 'Hard topic change command.',
      it: 'Comando duro di cambio tema.',
    },
    intended: {
      en: 'Conversational nudge — soft redirect; follow without making a big deal.',
      it: 'Nudge conversazionale — redirect soft; seguilo senza farne un caso.',
    },
    reactions: {
      en: ['Got it — pivoting with you.', 'Okay, let’s shift. 😊'],
      it: ['Ricevuto — mi sposto con te.', 'Ok, cambiamo. 😊'],
    },
  },
}

/** Strong exact / near-exact Italian & English examples from the mission */
const EXACT_CUES = [
  {
    re: /^non\s+cambi\s+mai(\s+discorso)?(\s+per[oò])?(\s+eh)?[!?.]*$/i,
    force: /** @type {PragmaticForce} */ ('playful_teasing'),
    boost: 3.8,
    signal: 'exact_non_cambi_mai',
  },
  {
    re: /^sei\s+proprio\s+testard[oa][!?.]*$/i,
    force: /** @type {PragmaticForce} */ ('playful_teasing'),
    boost: 3.8,
    signal: 'exact_testardo',
    reactions: {
      en: ['Haha, maybe a little. 😄', 'Okay, a tiny bit stubborn. 😄'],
      it: ['Ahahah, forse un pochino. 😄', 'Ok, un pelino testardo. 😄'],
    },
  },
  {
    re: /^bravo[,!]?\s*finalmente[!?.]*$/i,
    force: /** @type {PragmaticForce} */ ('light_sarcasm'),
    boost: 3.7,
    signal: 'exact_bravo_finalmente',
    /** Override: positive feedback with humor */
    intended: {
      en: 'Positive feedback with humor — celebrate the improvement lightly.',
      it: 'Feedback positivo con umorismo — festeggia il miglioramento con leggerezza.',
    },
    reactions: {
      en: ['Looks like I finally took the right turn. 😄', 'Okay, that one landed. 😄'],
      it: [
        'Mi sa che questa volta ho preso la direzione giusta. 😄',
        'Ok, questa volta ci siamo. 😄',
      ],
    },
  },
  {
    re: /^(you('?re|\s+are)\s+so\s+stubborn|so\s+stubborn)[!?.]*$/i,
    force: /** @type {PragmaticForce} */ ('playful_teasing'),
    boost: 3.6,
    signal: 'exact_stubborn',
  },
  {
    re: /^(you\s+never\s+change(\s+(the\s+)?(subject|topic))?|never\s+change\s+(the\s+)?topic)[!?.]*$/i,
    force: /** @type {PragmaticForce} */ ('playful_teasing'),
    boost: 3.6,
    signal: 'exact_never_change_topic',
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
 * @param {string} msg
 * @param {PragmaticLang} lang
 * @returns {{ force: PragmaticForce, score: number, signals: string[], exact?: (typeof EXACT_CUES)[0] }[]}
 */
function scoreForces(msg, lang) {
  /** @type {{ force: PragmaticForce, score: number, signals: string[], exact?: (typeof EXACT_CUES)[0] }[]} */
  const out = []
  const words = msg.split(/\s+/).filter(Boolean).length
  const brief = words <= 14 && msg.length <= 120

  for (const exact of EXACT_CUES) {
    if (exact.re.test(msg)) {
      out.push({
        force: exact.force,
        score: exact.boost + (brief ? 0.4 : 0),
        signals: [exact.signal],
        exact,
      })
    }
  }

  for (const [force, meta] of Object.entries(FORCE_CUES)) {
    const patterns = lang === 'it' ? meta.it : meta.en
    const other = lang === 'it' ? meta.en : meta.it
    let matched = false
    /** @type {string[]} */
    const signals = []
    for (const re of [...patterns, ...other]) {
      if (re.test(msg)) {
        matched = true
        signals.push(`cue_${force}`)
        break
      }
    }
    if (!matched) continue
    let score = meta.weight
    if (brief) score += 0.45
    if (/[!…]{1,}|😄|😂|🤣|😊/.test(msg)) score += 0.25
    if (/\beh\b/i.test(msg) || /\bper[oò]\b/i.test(msg)) score += 0.2
    out.push({ force: /** @type {PragmaticForce} */ (force), score, signals })
  }

  return out.sort((a, b) => b.score - a.score)
}

/**
 * Deduplicate forces keeping highest score.
 * @param {{ force: PragmaticForce, score: number, signals: string[], exact?: (typeof EXACT_CUES)[0] }[]} ranked
 */
function uniqueForces(ranked) {
  /** @type {Map<PragmaticForce, (typeof ranked)[0]>} */
  const map = new Map()
  for (const row of ranked) {
    if (!map.has(row.force)) map.set(row.force, row)
  }
  return [...map.values()].sort((a, b) => b.score - a.score)
}

/**
 * @param {PragmaticForce} force
 * @param {PragmaticLang} lang
 * @param {(typeof EXACT_CUES)[0] | undefined} exact
 */
function pickReaction(force, lang, exact) {
  if (exact?.reactions) {
    const bank = exact.reactions[lang] || exact.reactions.en
    return { reaction: bank[0], alternatives: bank.slice(1) }
  }
  if (force === 'literal') {
    return { reaction: '', alternatives: [] }
  }
  const meta = FORCE_CUES[force]
  const bank = meta.reactions[lang] || meta.reactions.en
  return { reaction: bank[0] || '', alternatives: bank.slice(1) }
}

/**
 * @returns {PragmaticPlan}
 */
function inactivePlan(reasons = ['skip']) {
  return {
    active: false,
    force: 'literal',
    forces: [],
    playful: false,
    reactionOnly: false,
    allowExplain: true,
    allowDefend: false,
    literalReading: '',
    intendedMeaning: '',
    reaction: '',
    reactionAlternatives: [],
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
  }
}

/**
 * @param {PragmaticPlan} plan
 */
function buildBrief(plan) {
  if (!plan.active) return ''
  const alts = plan.reactionAlternatives.slice(0, 2).map((r) => `«${r}»`).join(' · ')
  return [
    `Conversational Pragmatics: force=${plan.force} · playful=${plan.playful} · confidence=${plan.confidence}.`,
    `Literal: ${plan.literalReading}`,
    `Intended: ${plan.intendedMeaning}`,
    'Prioritize intended meaning over literal wording.',
    plan.playful
      ? 'Playful intent: react naturally; smile if it fits; acknowledge the joke; continue lightly.'
      : 'Acknowledge the subtext; stay natural — no overanalysis.',
    plan.reactionOnly
      ? `Reaction-first (often enough): «${plan.reaction}»`
      : `Open with a natural beat like «${plan.reaction}», then continue if needed.`,
    alts ? `Alternatives: ${alts}` : '',
    'VIETATO: diventare difensivo; spiegarsi a lungo; overanalizzare; prendere tutto alla lettera; “Hai ragione, tornare sullo stesso argomento…” da saggio.',
    'Preferisci: “Hahaha, beccato.” / “Ahahah, forse un pochino.” / “Mi sa che questa volta ho preso la direzione giusta.”',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} [input]
 * @returns {PragmaticPlan}
 */
export function analyzeConversationalPragmatics(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const langCode =
    input.languageAwareness?.replyLanguage ||
    input.plan?.understanding?.language ||
    detectDominantLanguage(userMessage)
  let language = /** @type {PragmaticLang} */ (langCode === 'it' ? 'it' : 'en')
  // Prefer Italian when strong IT pragmatic cues are present (short teasing lines)
  if (
    language === 'en' &&
    /\b(non\s+cambi|testard[oa]|per[oò]\s+eh|bravo[,!]?\s*finalmente|ahah|scherz|mi\s+sa)\b/i.test(
      userMessage,
    )
  ) {
    language = 'it'
  }

  if (!userMessage) return inactivePlan(['empty'])
  if (DISTRESS.test(userMessage)) return inactivePlan(['distress_skip'])

  const words = userMessage.split(/\s+/).filter(Boolean).length
  // Long factual asks → literal path
  if (words >= 18 && INFO_ASK.test(userMessage)) {
    return inactivePlan(['substantive_info_ask'])
  }

  const ranked = uniqueForces(scoreForces(userMessage, language))
  const top = ranked[0]
  if (!top || top.score < 2.15) {
    return inactivePlan(top ? [`below_threshold_${top.score.toFixed(2)}`] : ['no_pragmatic_cues'])
  }

  // Pure info with weak pragmatic cue → skip
  if (INFO_ASK.test(userMessage) && top.score < 2.8 && words >= 10) {
    return inactivePlan(['info_dominates'])
  }

  const force = top.force
  const meta = force === 'literal' ? null : FORCE_CUES[force]
  const exact = top.exact
  const playful = Boolean(meta?.playful || exact)
  const { reaction, alternatives } = pickReaction(force, language, exact)

  const literalReading =
    exact?.intended && force === 'light_sarcasm' && exact.signal === 'exact_bravo_finalmente'
      ? language === 'it'
        ? 'Lode letterale / “finalmente hai fatto bene”.'
        : 'Literal praise / “finally you did it right”.'
      : meta
        ? meta.literal[language] || meta.literal.en
        : ''

  const intendedMeaning =
    exact?.intended
      ? exact.intended[language] || exact.intended.en
      : meta
        ? meta.intended[language] || meta.intended.en
        : ''

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (top.score >= 3.4) confidence = 'high'
  else if (top.score < 2.5) confidence = 'low'

  const reactionOnlyBias = meta?.reactionOnlyBias ?? 0.5
  const brief = words <= 10
  const reactionOnly =
    playful &&
    (confidence === 'high' || brief) &&
    reactionOnlyBias >= 0.65 &&
    !INFO_ASK.test(userMessage)

  /** @type {PragmaticPlan} */
  const plan = {
    active: true,
    force,
    forces: ranked.slice(0, 3).map((r) => r.force),
    playful,
    reactionOnly,
    allowExplain: !playful,
    allowDefend: false,
    literalReading,
    intendedMeaning,
    reaction,
    reactionAlternatives: alternatives,
    writerBrief: '',
    structureLine: `Conversational Pragmatics → ${force}${playful ? ' (playful)' : ''}: intended > literal`,
    signals: ranked
      .slice(0, 3)
      .flatMap((r) => r.signals)
      .slice(0, 6),
    reasons: [
      `force_${force}`,
      `score_${top.score.toFixed(2)}`,
      `confidence_${confidence}`,
      playful ? 'playful_intent' : 'subtext_only',
      reactionOnly ? 'reaction_only' : 'reaction_then_continue',
      ...top.signals.slice(0, 3),
    ],
    confidence,
    language,
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {PragmaticPlan | null | undefined} plan
 */
export function formatConversationalPragmaticsForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATIONAL PRAGMATICS ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · Force=${plan.force} · Playful=${plan.playful} · Confidence=${plan.confidence}
Intended meaning > literal wording.

Literal: ${plan.literalReading}
Intended: ${plan.intendedMeaning}

Suggested beat: «${plan.reaction}»

${plan.writerBrief}

Regole: reagisci al sottotesto · se playful: sorridi, ack dello scherzo, continua naturale · niente difesa · niente auto-spiegazione · niente overanalisi · non citare il motore.`.trim()
}

/**
 * Structure hints for responseStructure.
 * @param {PragmaticPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationalPragmaticsStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Intended meaning > literal wording')
  if (plan.playful) {
    hints.push('Playful: react · smile if fit · ack joke · continue lightly — no defense')
  }
  if (plan.reactionOnly) {
    hints.push(`Reaction-only beat OK: «${plan.reaction}»`)
  } else if (plan.reaction) {
    hints.push(`Open with: «${plan.reaction}»`)
  }
  return hints
}

/**
 * Pre-send gate: playful pragmatics should not produce defensive / overanalytical drafts.
 * @param {string} draft
 * @param {PragmaticPlan | null | undefined} plan
 */
export function draftViolatesConversationalPragmatics(draft, plan) {
  if (!plan?.active || !plan.playful) return false
  const text = String(draft || '').trim()
  if (!text) return true
  // Defensive / over-explanatory openings
  if (
    /^(hai\s+ragione[,.]?\s+(tornare|riprendere|continuare)|i\s+understand[,.]?\s+(returning|going\s+back)|you'?re\s+right[,.]?\s+(returning|about\s+returning))/i.test(
      text,
    )
  ) {
    return true
  }
  if (
    /\b(mi\s+scuso|i\s+apologize|i'?m\s+sorry\s+for\s+(being|my)|non\s+volevo\s+offend|as\s+an\s+ai)\b/i.test(
      text,
    )
  ) {
    return true
  }
  // Overanalysis of the joke
  if (
    /\b(il\s+senso\s+letterale|literal\s+meaning|stai\s+(usando|facendo)\s+(ironia|sarcasmo)|you\s+are\s+(using|being)\s+(ironic|sarcastic))\b/i.test(
      text,
    )
  ) {
    return true
  }
  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: PragmaticPlan, context: string }}
 */
export function runConversationalPragmaticsEngine(input = {}) {
  try {
    const plan = analyzeConversationalPragmatics(input)
    return {
      plan,
      context: formatConversationalPragmaticsForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
