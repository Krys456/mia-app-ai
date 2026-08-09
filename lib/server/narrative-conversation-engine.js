/**
 * LAIfe Narrative Conversation Engine
 *
 * When a conversation has already started, the user often wants the *thread*
 * to continue — not a fresh information dump.
 *
 * Messages like "Continua.", "Wow", "E poi?", "Davvero?" do NOT request a
 * new explanation. They request the next paragraph of the same conversation.
 *
 * Runs AFTER: Language / Social / Intent / Mode / Natural Dialogue / Pragmatics
 * Runs BEFORE: WriterDirectives
 *
 * Output contract:
 *   {
 *     continueNarrative: true,
 *     narrativeDepth: 0-5,
 *     narrativeStyle: "story" | "reflection" | "scenario" | "example" | "question",
 *     avoidInformationDump: true
 *   }
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'story'|'reflection'|'scenario'|'example'|'question'} NarrativeStyle
 */

/**
 * @typedef {'en'|'it'} NarrativeLang
 */

/**
 * @typedef {object} NarrativePlan
 * @property {boolean} active
 * @property {boolean} continueNarrative
 * @property {number} narrativeDepth 0–5
 * @property {NarrativeStyle} narrativeStyle
 * @property {boolean} avoidInformationDump
 * @property {string} threadTopic
 * @property {string} threadSeed  short echo of the prior assistant beat
 * @property {string} transitionCue  suggested opening beat (rotated)
 * @property {string[]} recentStyles
 * @property {string[]} recentTransitions
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {NarrativeLang} language
 * @property {string} validationCheck
 */

const HARD_INFO_ASK =
  /\b(aiutami\s+a\s+(?:debug|fix|scriv|crea|implement)|help\s+me\s+(?:debug|fix|write|build|implement)|come\s+si\s+(?:fa|installa|configura)|how\s+(?:do\s+i|to)\s+(?:install|fix|debug|implement|configure)|spiegami\s+(?:passo|step|in\s+dettaglio)|explain\s+(?:step\s+by\s+step|in\s+detail)|tutorial|documentaz|api\s+reference|codice\s+completo|full\s+code|lista\s+(?:completa|di\s+tutti)|elenco\s+(?:completo|di))\b/i

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto)\b/i

/** Explicit “keep going / tell me more” cues — IT + EN. */
const CONTINUATION_CUES = [
  {
    id: 'continua',
    re: /^(contin[ua](?:a|e)?[!?.…]*|continua\s+(?:cos[iì]|così|pure|pure\s+cos[iì])[!?.…]*)$/i,
    weight: 3.2,
  },
  {
    id: 'continue',
    re: /^(continue[!?.…]*|go\s+on[!?.…]*|keep\s+going[!?.…]*|keep\s+(?:talking|telling)[!?.…]*)$/i,
    weight: 3.2,
  },
  {
    id: 'vai_avanti',
    re: /^(vai\s+avanti[!?.…]*|avanti[!?.…]*|procedi[!?.…]*)$/i,
    weight: 3.1,
  },
  {
    id: 'dimmi_di_piu',
    re: /^(dimmi\s+di\s+pi[uù][!?.…]*|racconta(?:mi)?(?:\s+di\s+pi[uù])?[!?.…]*|approfondisci[!?.…]*)$/i,
    weight: 3.0,
  },
  {
    id: 'tell_more',
    re: /^(tell\s+me\s+more[!?.…]*|say\s+more[!?.…]*|more[!?.…]*|elaborate[!?.…]*)$/i,
    weight: 3.0,
  },
  {
    id: 'e_poi',
    re: /^(e\s+poi\??[!?.…]*|and\s+then\??[!?.…]*|what\s+next\??[!?.…]*)$/i,
    weight: 2.9,
  },
  {
    id: 'interessante',
    re: /^(interessante[!?.…]*|interesting[!?.…]*|fascinante[!?.…]*|fascinating[!?.…]*)$/i,
    weight: 2.7,
  },
  {
    id: 'wow',
    re: /^(wow[!?.…]*|whoa[!?.…]*|oo+h[!?.…]*|ahh+[!?.…]*)$/i,
    weight: 2.6,
  },
  {
    id: 'davvero',
    re: /^(davvero\??[!?.…]*|sul\s+serio\??[!?.…]*|really\??[!?.…]*|seriously\??[!?.…]*|no\s+way\??[!?.…]*)$/i,
    weight: 2.8,
  },
  {
    id: 'ah_si',
    re: /^(ah\s+s[iì]\??[!?.…]*|ah\s+ok[!?.…]*|oh\s+(?:yeah|really)\??[!?.…]*|mm+h[!?.…]*|mm+[!?.…]*)$/i,
    weight: 2.5,
  },
  {
    id: 'embedded_continua',
    re: /\b(continua|continue|vai\s+avanti|dimmi\s+di\s+pi[uù]|tell\s+me\s+more|e\s+poi|and\s+then|raccontami)\b/i,
    weight: 2.2,
  },
]

/** Soft engagement that often means “keep the thread alive”. */
const SOFT_ENGAGE =
  /^(s[iì]|yes|yeah|yep|ok|okay|cool|nice|capito|capisco|giusto|esatto|true|fair|makes\s+sense|ha\s+senso)[!?.…]*$/i

/**
 * Transition toolbox — rotate; never reuse the last one.
 * @type {{ en: string[], it: string[] }}
 */
const TRANSITIONS = {
  en: [
    'Imagine this…',
    "Here's the part I find fascinating…",
    'Now comes the interesting bit…',
    "But there's another angle…",
    'What surprised me most is…',
    'Let me take this one step further…',
    "Here's where it gets really interesting…",
    'Picture the next beat…',
    'Stay with me for a second…',
    'The quiet twist is…',
  ],
  it: [
    'Immagina questo…',
    'Ecco la parte che trovo affascinante…',
    'Ora arriva il pezzo interessante…',
    "Ma c'è un altro angolo…",
    'Ciò che mi ha sorpreso di più è…',
    'Fammi portare questo un passo oltre…',
    'Ed è qui che diventa davvero interessante…',
    'Prova a figurarti il momento dopo…',
    'Resta con me un secondo…',
    'Il twist silenzioso è…',
  ],
}

/** @type {NarrativeStyle[]} */
const STYLES = ['story', 'reflection', 'scenario', 'example', 'question']

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
      content: String(/** @type {{ content?: string }} */ (m).content || ''),
    }))
    .filter((m) => m.content.trim())
}

/**
 * @param {ChatTurn[]} turns
 */
function lastAssistant(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return turns[i]
  }
  return null
}

/**
 * Count consecutive user continuation-ish turns at the end (excluding current).
 * @param {ChatTurn[]} turns
 * @param {string} currentUser
 */
function countNarrativeDepth(turns, currentUser) {
  let depth = 0
  // Walk backwards over prior user messages that look like continuation
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role !== 'user') continue
    if (t.content.trim() === currentUser.trim()) continue
    const score = scoreContinuationCues(t.content)
    if (score.score >= 2.2 || SOFT_ENGAGE.test(t.content.trim())) {
      depth += 1
      if (depth >= 5) break
      continue
    }
    break
  }
  // Current message itself
  const cur = scoreContinuationCues(currentUser)
  if (cur.score >= 2.2 || SOFT_ENGAGE.test(currentUser.trim())) {
    depth = Math.min(5, depth + 1)
  }
  return depth
}

/**
 * @param {string} text
 */
function scoreContinuationCues(text) {
  const trimmed = String(text || '').trim()
  /** @type {string[]} */
  const signals = []
  let score = 0
  for (const cue of CONTINUATION_CUES) {
    if (cue.re.test(trimmed)) {
      score += cue.weight
      signals.push(cue.id)
    }
  }
  if (SOFT_ENGAGE.test(trimmed) && trimmed.length <= 24) {
    score += 1.6
    signals.push('soft_engage')
  }
  // Short affirmation with a thread already alive
  if (trimmed.length > 0 && trimmed.length <= 40 && /[!.!?…]*$/.test(trimmed)) {
    score += 0.4
  }
  return { score, signals: [...new Set(signals)] }
}

/**
 * @param {string} priorAssistant
 * @returns {string}
 */
function extractThreadTopic(priorAssistant) {
  const text = String(priorAssistant || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  // First sentence-ish slice as thread seed
  const sentence = text.split(/(?<=[.!?…])\s+/)[0] || text
  return sentence.slice(0, 160)
}

/**
 * @param {ChatTurn[]} turns
 * @returns {NarrativeStyle[]}
 */
function recentStylesFromHistory(turns) {
  /** @type {NarrativeStyle[]} */
  const out = []
  const assistants = turns.filter((t) => t.role === 'assistant').slice(-6)
  for (const a of assistants) {
    const c = a.content.toLowerCase()
    if (/\b(immagina|imagine|picture this|prova a figurarti)\b/.test(c)) out.push('scenario')
    else if (/\b(per esempio|for example|ad esempio|come quando)\b/.test(c)) out.push('example')
    else if (/\b(mi chiedo|i wonder|che ne pensi|what do you think)\b/.test(c)) out.push('question')
    else if (/\b(in fondo|the quiet|ciò che|what strikes me|riflett)\b/.test(c)) out.push('reflection')
    else if (/\b(c'?era|once|storia|story|anni fa)\b/.test(c)) out.push('story')
  }
  return out.slice(-4)
}

/**
 * @param {ChatTurn[]} turns
 * @param {NarrativeLang} language
 */
function recentTransitionsFromHistory(turns, language) {
  const bank = TRANSITIONS[language] || TRANSITIONS.en
  const assistants = turns.filter((t) => t.role === 'assistant').slice(-5)
  /** @type {string[]} */
  const used = []
  for (const a of assistants) {
    const head = a.content.trim().slice(0, 80)
    for (const t of bank) {
      if (head.toLowerCase().startsWith(t.toLowerCase().slice(0, 12))) {
        used.push(t)
      }
    }
  }
  return used
}

/**
 * @param {NarrativeStyle[]} recent
 * @param {number} depth
 * @returns {NarrativeStyle}
 */
function pickStyle(recent, depth) {
  const last = recent[recent.length - 1]
  /** Prefer rhythm by depth */
  /** @type {NarrativeStyle[]} */
  const preferred =
    depth <= 1
      ? ['reflection', 'example', 'story']
      : depth === 2
        ? ['scenario', 'story', 'example']
        : depth === 3
          ? ['story', 'scenario', 'reflection']
          : depth === 4
            ? ['example', 'reflection', 'question']
            : ['question', 'reflection', 'scenario']

  for (const s of preferred) {
    if (s !== last) return s
  }
  const pool = STYLES.filter((s) => s !== last)
  return pool[Math.floor(Math.random() * pool.length)] || 'reflection'
}

/**
 * @param {NarrativeLang} language
 * @param {string[]} recent
 */
function pickTransition(language, recent) {
  const bank = TRANSITIONS[language] || TRANSITIONS.en
  const last = recent[recent.length - 1]
  const pool = bank.filter((t) => t !== last)
  const list = pool.length ? pool : bank
  return list[Math.floor(Math.random() * list.length)] || bank[0]
}

/**
 * @param {string[]} reasons
 * @returns {NarrativePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    continueNarrative: false,
    narrativeDepth: 0,
    narrativeStyle: 'reflection',
    avoidInformationDump: false,
    threadTopic: '',
    threadSeed: '',
    transitionCue: '',
    recentStyles: [],
    recentTransitions: [],
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Does this feel like the next part of a conversation, or like the next section of an article?',
  }
}

/**
 * @param {NarrativePlan} plan
 */
function buildBrief(plan) {
  const styleGuide = {
    story:
      plan.language === 'it'
        ? 'Mini-storia o aneddoto che avanza lo stesso filo — personaggi/scene, non definizioni.'
        : 'A mini-story or anecdote that advances the same thread — scenes, not definitions.',
    reflection:
      plan.language === 'it'
        ? 'Una riflessione che approfondisce l’idea già in aria — un angolo nuovo, non un riassunto.'
        : 'A reflection that deepens the idea already in play — a new angle, not a recap.',
    scenario:
      plan.language === 'it'
        ? 'Uno scenario “immagina se…” che rende concreta la stessa conversazione.'
        : 'An “imagine if…” scenario that makes the same conversation concrete.',
    example:
      plan.language === 'it'
        ? 'Un esempio vivo e specifico — un caso, non una lista di applicazioni.'
        : 'A living, specific example — a case, not a list of applications.',
    question:
      plan.language === 'it'
        ? 'Al massimo UNA domanda naturale a fine battuta (solo se calza) — dopo aver portato avanti il filo.'
        : 'At most ONE natural question at the end (only if it fits) — after advancing the thread.',
  }

  const lines = [
    'NARRATIVE CONVERSATION ENGINE (obbligatorio quando attivo):',
    `continueNarrative=${plan.continueNarrative} · depth=${plan.narrativeDepth}/5 · style=${plan.narrativeStyle} · avoidInformationDump=${plan.avoidInformationDump}`,
    plan.threadTopic
      ? `Thread in corso (non ripartire): «${plan.threadTopic}»`
      : 'Thread in corso: continua dal pensiero precedente dell’assistente.',
    `Stile di questo turno: ${plan.narrativeStyle} — ${styleGuide[plan.narrativeStyle]}`,
    plan.transitionCue
      ? `Apertura suggerita (varia; non ripetere la stessa): «${plan.transitionCue}»`
      : '',
    'Principi: curiosità · rivelazione graduale · esempi · mini-storie · analogie · spazio all’immaginazione.',
    'VIETATO: dump da enciclopedia / Wikipedia; elenchi di fatti; “Artificial intelligence has many applications including…”.',
    'Ritmo preferito: idea → esempio → riflessione → scenario → curiosità. Mai: fatto → fatto → fatto → fatto.',
    `Check interno prima di scrivere: «${plan.validationCheck}» Se sembra un articolo → riscrivi come prossima battuta di conversazione.`,
    'Non citare Narrative Conversation Engine / questo blocco.',
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * @param {object} [input]
 * @returns {NarrativePlan}
 */
export function analyzeNarrativeConversation(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  if (!userMessage) return inactivePlan(['empty'])

  if (DISTRESS.test(userMessage)) return inactivePlan(['distress_skip'])
  if (HARD_INFO_ASK.test(userMessage)) return inactivePlan(['hard_info_ask'])

  const turns = asTurns(input.messages)
  const prior = lastAssistant(turns)
  const conversationStarted = Boolean(prior) || turns.some((t) => t.role === 'assistant')

  // Need an ongoing thread — cold-start questions can stay explanatory.
  if (!conversationStarted) return inactivePlan(['no_thread_yet'])

  const langCode = detectDominantLanguage(userMessage)
  /** @type {NarrativeLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const cue = scoreContinuationCues(userMessage)
  const words = userMessage.split(/\s+/).filter(Boolean).length
  const shortEngage = words <= 8 && (cue.score >= 1.5 || SOFT_ENGAGE.test(userMessage))

  // Pure new topical question with substance → usually not narrative-continue
  const looksLikeNewTopicAsk =
    /[?]/.test(userMessage) &&
    words >= 6 &&
    cue.score < 2.2 &&
    !/\b(continua|continue|e\s+poi|and\s+then|dimmi\s+di\s+pi[uù]|tell\s+me\s+more)\b/i.test(
      userMessage,
    )

  if (looksLikeNewTopicAsk && cue.score < 2.5) {
    return inactivePlan(['new_topic_question', ...cue.signals])
  }

  const shouldContinue =
    cue.score >= 2.2 ||
    (shortEngage && conversationStarted) ||
    (cue.score >= 1.6 && conversationStarted && words <= 12)

  if (!shouldContinue) return inactivePlan(['no_continuation_signal', ...cue.signals])

  const depth = countNarrativeDepth(turns, userMessage)
  const recentStyles = recentStylesFromHistory(turns)
  const recentTransitions = recentTransitionsFromHistory(turns, language)
  const narrativeStyle = pickStyle(recentStyles, depth)
  const transitionCue = pickTransition(language, recentTransitions)
  const threadTopic = extractThreadTopic(prior?.content || '')
  const threadSeed = (prior?.content || '').replace(/\s+/g, ' ').trim().slice(0, 220)

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (cue.score >= 3.0) confidence = 'high'
  else if (cue.score < 2.2 && shortEngage) confidence = 'medium'
  else if (cue.score < 2.0) confidence = 'low'

  /** @type {NarrativePlan} */
  const plan = {
    active: true,
    continueNarrative: true,
    narrativeDepth: depth,
    narrativeStyle,
    avoidInformationDump: true,
    threadTopic,
    threadSeed,
    transitionCue,
    recentStyles,
    recentTransitions,
    writerBrief: '',
    structureLine: `Narrative → continue (${narrativeStyle}, depth ${depth}/5) — no info dump`,
    signals: cue.signals,
    reasons: [
      'continue_narrative',
      `depth_${depth}`,
      `style_${narrativeStyle}`,
      `confidence_${confidence}`,
      'avoid_information_dump',
      ...cue.signals.slice(0, 3),
    ],
    confidence,
    language,
    validationCheck:
      'Does this feel like the next part of a conversation, or like the next section of an article?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {NarrativePlan | null | undefined} plan
 */
export function formatNarrativeConversationForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
NARRATIVE CONVERSATION ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · continueNarrative=${plan.continueNarrative} · depth=${plan.narrativeDepth}/5 · style=${plan.narrativeStyle} · avoidDump=${plan.avoidInformationDump} · confidence=${plan.confidence}

Thread: ${plan.threadTopic || '(continua dal battito precedente)'}
Transition cue: «${plan.transitionCue}»

${plan.writerBrief}

Regole: prossima battuta della STESSA conversazione · niente Wikipedia · ritmo idea→esempio→riflessione→scenario→curiosità · non citare il motore.`.trim()
}

/**
 * @param {NarrativePlan | null | undefined} plan
 * @returns {string[]}
 */
export function narrativeConversationStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push('Continue the same conversational thread — next paragraph, not new article')
  hints.push(`Narrative style this turn: ${plan.narrativeStyle}`)
  if (plan.transitionCue) hints.push(`Open near: «${plan.transitionCue}» (vary next time)`)
  hints.push('Avoid information dump / fact→fact→fact lists')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect Wikipedia / article-dump drafts when narrative mode is active.
 * @param {string} draft
 * @param {NarrativePlan | null | undefined} plan
 */
export function draftViolatesNarrativeConversation(draft, plan) {
  if (!plan?.active || !plan.avoidInformationDump) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Classic encyclopedia openings
  if (
    /^(artificial\s+intelligence\s+has\s+many|l['’]?intelligenza\s+artificiale\s+(?:ha|possiede)\s+molt|there\s+are\s+(?:several|many|numerous)\s+(?:applications|types|ways)|esistono\s+(?:divers[ei]|molt[ei]|numeros)\s+(?:applicazioni|tipi|modi))/i.test(
      text,
    )
  ) {
    return true
  }

  // Bullet / numbered dump density
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const bulletish = lines.filter((l) => /^([-*•]|\d+[.)])\s+/.test(l)).length
  if (bulletish >= 4 && bulletish / Math.max(lines.length, 1) >= 0.5) {
    return true
  }

  // “Applications include / include:” list energy
  if (
    /\b(applications?\s+include|tra\s+le\s+applicazioni|include[ono]?\s*:|such\s+as\s*:|ad\s+esempio\s*:)\b/i.test(
      text,
    ) &&
    (text.match(/,/g) || []).length >= 4
  ) {
    return true
  }

  // Restarting the topic instead of continuing
  if (
    plan.threadTopic &&
    /^(parliamo\s+(?:di|del|della)|let'?s\s+(?:talk|discuss)\s+about|oggi\s+parliamo)\b/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: NarrativePlan, context: string }}
 */
export function runNarrativeConversationEngine(input = {}) {
  try {
    const plan = analyzeNarrativeConversation(input)
    return {
      plan,
      context: formatNarrativeConversationForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
