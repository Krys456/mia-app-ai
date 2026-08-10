/**
 * LAIfe Human Conversation Corpus
 *
 * Mission: when generating conversational replies, optimize for spoken
 * conversation — not written exposition.
 *
 * Prefer patterns commonly found in natural human dialogue.
 * Reduce patterns typical of:
 *   essays · articles · textbooks · motivational speeches · Wikipedia
 *
 * The assistant should sound like someone talking, not someone publishing.
 *
 * Also applies Anti-Essay discipline:
 *   - Detect essay-mode openers / abstractions
 *   - Replace exposition with interaction
 *   - On simple “Ciao” — greet / react / wait; do not lecture
 *   - Essay score 0–100; if > 25 while chatting → rewrite
 *
 * Distinct from Natural Dialogue (conversational moves) and
 * Human Conversation Score (multi-dimension quality gate).
 * This stage supplies a spoken-vs-published corpus bias.
 *
 * Runs AFTER: Response Mode (when present)
 * Runs BEFORE: Wisdom / Writer
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} CorpusLang
 */

/**
 * @typedef {'chat'|'teaching'|'task'|'distress'} CorpusContext
 */

/**
 * @typedef {object} SpokenPattern
 * @property {string} id
 * @property {string} en
 * @property {string} it
 * @property {string} kind
 */

/**
 * @typedef {object} HumanConversationCorpusPlan
 * @property {boolean} active
 * @property {boolean} preferSpoken
 * @property {boolean} allowExposition hard tasks / teaching may need more exposition
 * @property {boolean} greetingOnly
 * @property {CorpusContext} context
 * @property {number} essayThreshold rewrite if draft essayScore > this (default 25)
 * @property {string[]} preferPatterns sample spoken cues for Writer
 * @property {string[]} avoidPatterns sample anti-patterns
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {CorpusLang} language
 * @property {string} validationCheck
 * @property {string} qualityGoal
 */

/** Rewrite bar for essay-like drafts while chatting. */
export const ESSAY_REWRITE_THRESHOLD = 25

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const TEACHING_RE =
  /\b(spiegami|explain|tutorial|how\s+does|come\s+funziona|what\s+is|cos'?[eè]|perch[eé]\s+(?:è|e|is)|definizione|definition)\b/i

const GREETING_ONLY_RE =
  /^(ciao|hey|hi|hello|ehi|salve|buongiorno|buonasera|good\s+(morning|afternoon|evening)|yo)([\s!,.🥰😊🙏]*)$/i

/** Spoken / interactive openings (corpus of natural talk). */
/** @type {SpokenPattern[]} */
const SPOKEN_PATTERNS = Object.freeze([
  { id: 'haha_sai', en: 'You know what?', it: 'Haha, sai una cosa?', kind: 'aside' },
  { id: 'oh_pensando', en: 'Oh, now that I think about it…', it: 'Oh, adesso che ci penso…', kind: 'aside' },
  { id: 'in_effetti', en: 'Actually…', it: 'In effetti…', kind: 'soft_agree' },
  { id: 'gia', en: 'Yeah.', it: 'Già.', kind: 'soft_agree' },
  { id: 'curioso', en: 'That’s curious.', it: 'Questo è curioso.', kind: 'reaction' },
  { id: 'ti_diro', en: 'I’ll tell you…', it: 'Ti dirò…', kind: 'aside' },
  { id: 'secondo_me', en: 'I think…', it: 'Secondo me…', kind: 'opinion' },
  { id: 'guarda', en: 'Look—', it: 'Guarda—', kind: 'attention' },
  { id: 'boh', en: 'Huh.', it: 'Boh.', kind: 'reaction' },
  { id: 'mm', en: 'Mm.', it: 'Mm.', kind: 'listening' },
  { id: 'aspetta', en: 'Wait—', it: 'Aspetta—', kind: 'thinking' },
  { id: 'vero', en: 'True.', it: 'Vero.', kind: 'soft_agree' },
  { id: 'interesting_short', en: 'Interesting.', it: 'Interessante.', kind: 'reaction' },
  { id: 'no_joke', en: 'No joke—', it: 'Sul serio—', kind: 'emphasis' },
  { id: 'for_real', en: 'For real though…', it: 'Però davvero…', kind: 'emphasis' },
])

/**
 * Essay / article / TED / textbook / Wikipedia markers.
 * Each hit raises essayScore.
 */
const ESSAY_MARKERS = Object.freeze([
  {
    id: 'fascinating_how',
    re: /\b(it\s+is\s+fascinating\s+how|è\s+affascinante\s+come)\b/i,
    w: 22,
  },
  {
    id: 'surprising_that',
    re: /\b(it\s+is\s+surprising\s+that|è\s+sorprendente\s+che)\b/i,
    w: 20,
  },
  {
    id: 'interesting_reflect',
    re: /\b(it\s+is\s+interesting\s+to\s+reflect|è\s+interessante\s+riflettere)\b/i,
    w: 24,
  },
  {
    id: 'leads_us',
    re: /\b(this\s+leads\s+us\s+to\s+(think|consider)|questo\s+ci\s+porta\s+a\s+(pensare|riflettere))\b/i,
    w: 22,
  },
  {
    id: 'reminds_us',
    re: /\b(this\s+reminds\s+us\s+that|questo\s+ci\s+ricorda\s+che)\b/i,
    w: 20,
  },
  {
    id: 'human_communication',
    re: /\b(human\s+communication|la\s+comunicazione\s+umana)\b/i,
    w: 18,
  },
  {
    id: 'small_actions',
    re: /\b(small\s+actions|piccole\s+azioni|little\s+things\s+in\s+life)\b/i,
    w: 16,
  },
  {
    id: 'daily_lives',
    re: /\b(our\s+daily\s+lives|nelle\s+nostre\s+vite\s+quotidiane|nel\s+mondo\s+di\s+oggi)\b/i,
    w: 18,
  },
  {
    id: 'in_todays_world',
    re: /\b(in\s+today'?s\s+(fast[- ]paced\s+)?world|in\s+un\s+mondo\s+(sempre\s+pi[uù]\s+)?(frenetico|complesso))\b/i,
    w: 20,
  },
  {
    id: 'it_is_important',
    re: /\b(it\s+is\s+important\s+to\s+(note|remember|understand)|è\s+importante\s+(ricordare|notare|comprendere))\b/i,
    w: 18,
  },
  {
    id: 'one_might_say',
    re: /\b(one\s+might\s+say|si\s+potrebbe\s+dire|broadly\s+speaking|in\s+essence)\b/i,
    w: 14,
  },
  {
    id: 'throughout_history',
    re: /\b(throughout\s+history|nel\s+corso\s+della\s+storia|since\s+the\s+dawn\s+of)\b/i,
    w: 18,
  },
  {
    id: 'wikipedia_tone',
    re: /\b(is\s+a\s+(type|form|concept|phenomenon)\s+of|si\s+tratta\s+di\s+un\s+(tipo|fenomeno|concetto)|commonly\s+defined\s+as)\b/i,
    w: 16,
  },
  {
    id: 'motivational',
    re: /\b(believe\s+in\s+yourself|credi\s+in\s+te|you\s+got\s+this|ogni\s+giorno\s+[eè]\s+una\s+nuova\s+opportunit)\b/i,
    w: 20,
  },
  {
    id: 'ted_arc',
    re: /\b(let\s+me\s+take\s+you\s+on\s+a\s+journey|vorrei\s+portarvi|the\s+key\s+takeaway|il\s+messaggio\s+chiave)\b/i,
    w: 22,
  },
  {
    id: 'article_lede',
    re: /\b(in\s+this\s+(article|piece|essay)|in\s+questo\s+(articolo|pezzo)|as\s+we\s+(shall|will)\s+see)\b/i,
    w: 24,
  },
])

/** Positive spoken markers that lower essay score. */
const SPOKEN_MARKERS = Object.freeze([
  /\b(haha|ahah|lol|😂)\b/i,
  /\b(sai\s+una\s+cosa|you\s+know\s+what|ti\s+dir[oò]|i'?ll\s+tell\s+you)\b/i,
  /\b(secondo\s+me|i\s+think|i\s+feel\s+like|a\s+me\s+pare)\b/i,
  /\b(in\s+effetti|actually|wait[,—-]|aspetta)\b/i,
  /\b(già|gia|yeah|yep|mm+|uhm+|boh|mah)\b/i,
  /\b(questo\s+[eè]\s+curioso|that'?s\s+curious|interessante)\b/i,
  /\b(guarda|look[,—-]|no\s+joke|sul\s+serio)\b/i,
])

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
      content: String(/** @type {{ content?: string }} */ (m).content || '').trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @param {object} input
 * @returns {CorpusLang}
 */
function resolveLang(input) {
  const la = input.languageAwareness?.plan || input.languageAwareness || null
  const reply = String(la?.replyLanguage || la?.detected || '').toLowerCase()
  if (reply.startsWith('en')) return 'en'
  if (reply.startsWith('it')) return 'it'
  const fromMsg = detectDominantLanguage(String(input.userMessage || ''))
  return fromMsg === 'en' ? 'en' : 'it'
}

/**
 * Deterministic pick without Math.random.
 * @param {string} seed
 * @param {number} mod
 */
function hashPick(seed, mod) {
  let h = 2166136261
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return mod > 0 ? (h >>> 0) % mod : 0
}

/**
 * @param {object} input
 * @returns {{ context: CorpusContext, preferSpoken: boolean, allowExposition: boolean, greetingOnly: boolean, signals: string[], reasons: string[] }}
 */
function assessContext(input = {}) {
  const msg = String(input.userMessage || '').trim()
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const responseMode = input.responseMode?.plan || input.responseMode || null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || null

  if (!msg || DISTRESS_RE.test(msg)) {
    return {
      context: /** @type {const} */ ('distress'),
      preferSpoken: true,
      allowExposition: false,
      greetingOnly: false,
      signals: ['distress_or_empty'],
      reasons: ['spoken_presence'],
    }
  }

  if (GREETING_ONLY_RE.test(msg)) {
    signals.push('greeting_only')
    reasons.push('no_concept_dump_on_ciao')
    return {
      context: /** @type {const} */ ('chat'),
      preferSpoken: true,
      allowExposition: false,
      greetingOnly: true,
      signals,
      reasons,
    }
  }

  if (HARD_TASK_RE.test(msg) || leadership?.move === 'remain_concise') {
    signals.push('hard_task')
    return {
      context: /** @type {const} */ ('task'),
      preferSpoken: false,
      allowExposition: true,
      greetingOnly: false,
      signals,
      reasons: ['clarity_over_chat_texture'],
    }
  }

  if (TEACHING_RE.test(msg) || String(intent?.expects || '') === 'information') {
    signals.push('teaching_or_info')
    return {
      context: /** @type {const} */ ('teaching'),
      preferSpoken: true,
      allowExposition: true,
      greetingOnly: false,
      signals,
      reasons: ['teach_but_still_human'],
    }
  }

  const briefMode =
    responseMode?.preferBrevity ||
    /^(celebration|reaction|listening|presence|agreement|curiosity|reflection|observation)$/.test(
      String(responseMode?.mode || ''),
    )
  if (briefMode) {
    signals.push('brief_response_mode')
    reasons.push(`mode_${responseMode?.mode || 'brief'}`)
  }

  const expects = String(intent?.expects || '')
  if (expects === 'companionship' || expects === 'presence' || expects === 'exploration') {
    signals.push(`expects_${expects}`)
  }

  reasons.push('optimize_spoken_dialogue')
  return {
    context: /** @type {const} */ ('chat'),
    preferSpoken: true,
    allowExposition: false,
    greetingOnly: false,
    signals: signals.length ? signals : ['chat_default'],
    reasons,
  }
}

/**
 * @param {CorpusLang} lang
 * @param {string} seed
 * @param {number} n
 * @returns {string[]}
 */
function pickSpokenSamples(lang, seed, n = 5) {
  const pool = [...SPOKEN_PATTERNS]
  /** @type {string[]} */
  const out = []
  let s = seed
  for (let i = 0; i < n && pool.length; i++) {
    const idx = hashPick(s + '|' + i, pool.length)
    const p = pool.splice(idx, 1)[0]
    out.push(lang === 'en' ? p.en : p.it)
    s += p.id
  }
  return out
}

/**
 * Score how essay/published a draft sounds (0 = natural talk, 100 = essay).
 * @param {string} text
 * @returns {{ score: number, hits: string[], spokenHits: number }}
 */
export function scoreEssayLikeness(text) {
  const t = String(text || '').trim()
  if (!t) return { score: 0, hits: [], spokenHits: 0 }

  let score = 0
  /** @type {string[]} */
  const hits = []
  for (const m of ESSAY_MARKERS) {
    if (m.re.test(t)) {
      score += m.w
      hits.push(m.id)
    }
  }

  // Structural published cues
  const sentences = t.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 8)
  const paras = t.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  if (sentences.length >= 6 && paras.length <= 1) {
    score += 12
    hits.push('long_monologue_block')
  }
  if (t.length > 500 && !/\n/.test(t)) {
    score += 10
    hits.push('wall_of_text')
  }
  if (/\b(first[,:]|second[,:]|third[,:]|in\s+conclusion|in\s+summary|per\s+concludere)\b/i.test(t)) {
    score += 14
    hits.push('enumerated_essay_arc')
  }

  let spokenHits = 0
  for (const re of SPOKEN_MARKERS) {
    if (re.test(t)) spokenHits++
  }
  score -= Math.min(28, spokenHits * 7)

  // Short natural replies are almost never essays
  if (t.length < 90 && sentences.length <= 2) score = Math.min(score, 8)

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    hits,
    spokenHits,
  }
}

/**
 * @param {HumanConversationCorpusPlan} plan
 * @param {CorpusLang} lang
 */
function buildGuidance(plan, lang) {
  if (plan.greetingOnly) {
    return lang === 'en'
      ? 'User only greeted you. Greet naturally, react, share one spontaneous thought, or wait — do NOT start explaining a concept.'
      : 'L’utente ha solo salutato. Saluta naturale, reagisci, condividi un pensiero spontaneo, o aspetta — NON iniziare a spiegare un concetto.'
  }
  if (!plan.preferSpoken && plan.allowExposition) {
    return 'Task/clarity mode: be clear and useful; still avoid TED/motivational filler and Wikipedia voice.'
  }
  return [
    'Optimize for spoken conversation, not written exposition.',
    'Sound like someone talking — not publishing an article, blog, TED talk, textbook, or Wikipedia page.',
    'Replace exposition with interaction.',
    `Essay score threshold: rewrite if draft > ${plan.essayThreshold}.`,
  ].join(' ')
}

/**
 * @param {HumanConversationCorpusPlan} plan
 */
function buildBrief(plan) {
  if (!plan.active) return ''
  const prefer = plan.preferPatterns.slice(0, 6).join(' · ')
  const avoid = plan.avoidPatterns.slice(0, 6).join(' · ')

  if (plan.greetingOnly) {
    return [
      'HUMAN CONVERSATION CORPUS: greeting only.',
      'DO NOT immediately explain a concept after “Ciao/Hi”.',
      'Prefer: greet naturally · react · ask something meaningful if appropriate · share a spontaneous thought · wait for their direction.',
      `Spoken cues: ${prefer}`,
      'NON citare Human Conversation Corpus.',
    ].join(' ')
  }

  return [
    'HUMAN CONVERSATION CORPUS: parla come una persona — non pubblicare.',
    plan.preferSpoken
      ? 'Optimize for SPOKEN dialogue patterns; reduce essay/article/textbook/TED/Wikipedia voice.'
      : 'Clarity allowed, but still kill essay/TED/Wikipedia filler.',
    `Prefer openings/turns like: ${prefer}`,
    `Avoid / reduce: ${avoid}`,
    'Instead of “It is fascinating how…” prefer “Haha, sai una cosa?” / “Oh, adesso che ci penso…” / “In effetti…” / “Già.” / “Questo è curioso.” / “Ti dirò…” / “Secondo me…”',
    `Essay detector: 0=natural · 100=essay · rewrite if > ${plan.essayThreshold} while chatting.`,
    plan.qualityGoal,
    `Check: ${plan.validationCheck}`,
    'NON citare Human Conversation Corpus / lo stage.',
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {HumanConversationCorpusPlan}
 */
export function buildHumanConversationCorpusPlan(input = {}) {
  const language = resolveLang(input)
  const need = assessContext(input)
  const seed = `${input.userMessage || ''}|${need.context}|${asTurns(input.messages).length}`
  const preferPatterns = pickSpokenSamples(language, seed, 6)
  const avoidPatterns =
    language === 'en'
      ? [
          'It is fascinating how…',
          'It is surprising that…',
          'It is interesting to reflect on…',
          'This leads us to think…',
          'This reminds us that…',
          'Human communication… / Our daily lives…',
        ]
      : [
          'È affascinante come…',
          'È sorprendente che…',
          'È interessante riflettere…',
          'Questo ci porta a pensare…',
          'Questo ci ricorda che…',
          'La comunicazione umana… / Nelle nostre vite quotidiane…',
        ]

  /** @type {HumanConversationCorpusPlan} */
  const plan = {
    active: true,
    preferSpoken: need.preferSpoken,
    allowExposition: need.allowExposition,
    greetingOnly: need.greetingOnly,
    context: need.context,
    essayThreshold: ESSAY_REWRITE_THRESHOLD,
    preferPatterns,
    avoidPatterns,
    guidance: '',
    writerBrief: '',
    structureLine: need.greetingOnly
      ? 'Human Conversation Corpus → greeting: talk, don’t lecture'
      : need.preferSpoken
        ? `Human Conversation Corpus → spoken dialogue · essay≤${ESSAY_REWRITE_THRESHOLD}`
        : `Human Conversation Corpus → clarity ok · still anti-essay/TED/Wiki`,
    signals: need.signals,
    reasons: [
      ...need.reasons,
      need.preferSpoken ? 'spoken_over_published' : 'task_clarity',
      `ctx_${need.context}`,
    ],
    confidence:
      need.greetingOnly || need.context === 'chat' ? 'high' : need.context === 'task' ? 'medium' : 'high',
    language,
    validationCheck:
      'Does this sound like someone talking in a chat — or like an article/TED/textbook/Wikipedia entry?',
    qualityGoal:
      'Sound like someone talking, not someone publishing.',
  }
  plan.guidance = buildGuidance(plan, language)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {HumanConversationCorpusPlan | null | undefined} plan
 */
export function formatHumanConversationCorpusForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
HUMAN CONVERSATION CORPUS (INVISIBILE)
══════════════════════════════════════
Active=yes · spoken=${plan.preferSpoken} · ctx=${plan.context} · greetingOnly=${plan.greetingOnly} · essayMax=${plan.essayThreshold} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: parlato > saggio · interazione > esposizione · niente TED/Wiki/motivazionale · su Ciao non spiegare · non citare il motore.`.trim()
}

/**
 * @param {HumanConversationCorpusPlan | null | undefined} plan
 * @returns {string[]}
 */
export function humanConversationCorpusStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.greetingOnly) {
    hints.push('Greeting only — no concept dump')
  } else if (plan.preferSpoken) {
    hints.push('Prefer spoken dialogue patterns over exposition')
    hints.push(`Rewrite if essay likeness > ${plan.essayThreshold}`)
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * @param {string} draft
 * @param {HumanConversationCorpusPlan | null | undefined} plan
 */
export function draftViolatesHumanConversationCorpus(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  const { score, hits } = scoreEssayLikeness(text)

  if (plan.greetingOnly) {
    // After “Ciao”, reject concept lectures / essay openers
    if (score > 15) return true
    if (text.length > 280 && hits.length >= 1) return true
    if (
      /\b(it\s+is\s+fascinating|è\s+affascinante|human\s+communication|la\s+comunicazione\s+umana|let\s+me\s+explain|ti\s+spiego\s+un\s+concetto)\b/i.test(
        text,
      )
    ) {
      return true
    }
  }

  if (!plan.preferSpoken && plan.allowExposition) {
    // Still block hard TED / motivational / article voice
    if (hits.some((h) => /ted_arc|motivational|article_lede|interesting_reflect/.test(h))) {
      return true
    }
    return false
  }

  // Chatting: essay score > 25 → rewrite
  if (score > (plan.essayThreshold ?? ESSAY_REWRITE_THRESHOLD)) return true

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: HumanConversationCorpusPlan, context: string }}
 */
export function runHumanConversationCorpus(input = {}) {
  try {
    const plan = buildHumanConversationCorpusPlan(input)
    return {
      plan,
      context: formatHumanConversationCorpusForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        preferSpoken: true,
        allowExposition: false,
        greetingOnly: false,
        context: 'chat',
        essayThreshold: ESSAY_REWRITE_THRESHOLD,
        preferPatterns: [],
        avoidPatterns: [],
        guidance: '',
        writerBrief: '',
        structureLine: null,
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        validationCheck: '',
        qualityGoal: '',
      },
      context: '',
    }
  }
}
