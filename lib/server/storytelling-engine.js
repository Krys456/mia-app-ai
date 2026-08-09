/**
 * LAIfe Storytelling Engine
 *
 * Mission: transform explanations into stories.
 *
 * Whenever appropriate:
 *   Instead of explaining, illustrate.
 *
 * Prefer:
 *   - mini stories
 *   - analogies
 *   - real-world scenarios
 *   - imagination
 *
 * Avoid textbook style.
 *
 * Distinct from Narrative Conversation (continue the same thread).
 * Distinct from Expert Teacher (progressive teaching layers).
 * Distinct from Thoughtfulness (one crafted contribution).
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
 * @typedef {'en'|'it'} StoryLang
 */

/**
 * @typedef {'none'|'mini_story'|'analogy'|'real_world_scenario'|'imagination'} StoryMode
 */

/**
 * @typedef {object} StorytellingPlan
 * @property {boolean} active
 * @property {boolean} allowStory
 * @property {StoryMode} mode
 * @property {number} storyScore 0–1
 * @property {string} seed unique illustration cue for this turn
 * @property {string[]} preferredFrames
 * @property {string[]} forbiddenTextbook
 * @property {string} topicHint
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {StoryLang} language
 * @property {string} validationCheck
 */

const PREFERRED_FRAMES_EN = Object.freeze({
  mini_story: Object.freeze([
    'Picture someone who…',
    'There was a moment when…',
    'A small scene: …',
  ]),
  analogy: Object.freeze([
    "It's a bit like…",
    'Think of it as…',
    'In the same way that…',
  ]),
  real_world_scenario: Object.freeze([
    'In everyday life, this looks like…',
    'Say you are walking into…',
    'On a normal Tuesday, …',
  ]),
  imagination: Object.freeze([
    'Imagine for a second…',
    'Suppose the room went quiet and…',
    'If you could watch it happen…',
  ]),
})

const PREFERRED_FRAMES_IT = Object.freeze({
  mini_story: Object.freeze([
    'Immagina qualcuno che…',
    'C’era un momento in cui…',
    'Una piccola scena: …',
  ]),
  analogy: Object.freeze([
    'È un po’ come…',
    'Pensalo come…',
    'Allo stesso modo in cui…',
  ]),
  real_world_scenario: Object.freeze([
    'Nella vita di tutti i giorni, sembra…',
    'Metti che entri in…',
    'Un martedì qualunque, …',
  ]),
  imagination: Object.freeze([
    'Immagina un attimo…',
    'Supponi che la stanza si faccia quieta e…',
    'Se potessi vederlo accadere…',
  ]),
})

const FORBIDDEN_TEXTBOOK = Object.freeze([
  'X is defined as…',
  'There are N types/kinds of…',
  'In conclusion…',
  'Key points: 1) 2) 3)',
  'Si definisce come…',
  'Esistono N tipi di…',
  'In conclusione…',
])

const TEXTBOOK_OPENER_RE =
  /\b(is\s+defined\s+as|can\s+be\s+defined\s+as|there\s+are\s+\d+\s+(main\s+)?(types|kinds|categories|forms)\s+of|in\s+conclusion[,:]|key\s+points\s*:|si\s+definisce\s+come|esistono\s+\d+\s+tipi\s+di|in\s+conclusione[,:]|punti\s+chiave\s*:)\b/i

const STORY_CUE_RE =
  /\b(imagine|picture|it'?s\s+a\s+bit\s+like|think\s+of\s+it\s+as|suppose|for\s+example[,:]?\s+say|a\s+small\s+scene|immagina|pensalo\s+come|[eè]\s+un\s+po['’]?\s+come|metti\s+che|una\s+piccola\s+scena)\b/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico)\b/i

const HARD_PROCEDURAL_RE =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql\s+query|json\s+schema|unit\s+test|compile\s+error|fix\s+this\s+code|stack\s+trace|api\s+key)\b/i

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const EXPLAIN_FUEL =
  /\b(explain|what\s+is|what\s+are|how\s+does|how\s+do|why\s+(does|do|is|are)|tell\s+me\s+about|help\s+me\s+understand|spiega|cos['’]?[eè]|come\s+funziona|perch[eé]|aiutami\s+a\s+capire|dimmi\s+di)\b/i

const ABSTRACT_TOPIC =
  /\b(concept|theory|principle|system|process|mechanism|idea|phenomenon|concetto|teoria|principio|sistema|processo|meccanismo|fenomeno|algoritm|gravity|evolution|memory|consciousness|inflation|market|democrac)\b/i

const STORY_REQUEST =
  /\b(story|analogy|example|scenario|metaphor|illustrat|storia|analogia|esempio|scenario|metafora|racconta)\b/i

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
 * Stable 0–1 hash (no Math.random).
 * @param {string} seed
 */
function hash01(seed) {
  let h = 2166136261
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/**
 * @param {string} userMessage
 * @param {ChatTurn[]} turns
 */
function extractTopicHint(userMessage, turns) {
  const blob = [userMessage, ...turns.slice(-3).map((t) => t.content)].join(' ')
  const m = blob.match(
    /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{3,}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{3,}){0,2})\b/,
  )
  if (!m) return ''
  const phrase = m[1].replace(/\s+/g, ' ').trim()
  if (phrase.length < 4 || phrase.length > 40) return ''
  if (/^(what|why|how|explain|spiega|come|perché|this|that|about)$/i.test(phrase)) return ''
  return phrase
}

/**
 * @param {StoryLang} language
 * @param {StoryMode} mode
 * @param {string} seed
 */
function pickFrame(language, mode, seed) {
  const table = language === 'it' ? PREFERRED_FRAMES_IT : PREFERRED_FRAMES_EN
  const list = table[mode] || table.analogy
  const idx = Math.floor(hash01(`${seed}|${mode}`) * list.length) % list.length
  return { frame: list[idx], preferredFrames: [...list] }
}

/**
 * @param {object} opts
 * @returns {{ allowStory: boolean, mode: StoryMode, storyScore: number, seed: string, preferredFrames: string[], topicHint: string, signals: string[], reasons: string[] }}
 */
function chooseStory(opts) {
  const { userMessage, turns, language, expertTeacher, narrativeConversation } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []
  let storyScore = 0.28

  const emptyFrames =
    language === 'it'
      ? [...PREFERRED_FRAMES_IT.analogy]
      : [...PREFERRED_FRAMES_EN.analogy]

  if (DISTRESS_RE.test(userMessage)) {
    return {
      allowStory: false,
      mode: 'none',
      storyScore: 0,
      seed: '',
      preferredFrames: emptyFrames,
      topicHint: '',
      signals: ['suppress_distress'],
      reasons: ['presence_over_story'],
    }
  }
  if (HARD_PROCEDURAL_RE.test(userMessage)) {
    return {
      allowStory: false,
      mode: 'none',
      storyScore: 0.1,
      seed: '',
      preferredFrames: emptyFrames,
      topicHint: '',
      signals: ['suppress_procedural'],
      reasons: ['clarity_over_illustration'],
    }
  }
  if (STOP_SIGNAL.test(userMessage)) {
    return {
      allowStory: false,
      mode: 'none',
      storyScore: 0,
      seed: '',
      preferredFrames: emptyFrames,
      topicHint: '',
      signals: ['suppress_stop'],
      reasons: ['respect_stop'],
    }
  }
  if (/^(ok|okay|yes|yep|yeah|no|thanks|grazie|capito|sì|si)[\s!.]*$/i.test(userMessage)) {
    return {
      allowStory: false,
      mode: 'none',
      storyScore: 0.1,
      seed: '',
      preferredFrames: emptyFrames,
      topicHint: '',
      signals: ['suppress_short_ack'],
      reasons: ['no_forced_story_on_ack'],
    }
  }

  if (EXPLAIN_FUEL.test(userMessage)) {
    storyScore += 0.28
    signals.push('explain_fuel')
  }
  if (ABSTRACT_TOPIC.test(userMessage)) {
    storyScore += 0.18
    signals.push('abstract_topic')
  }
  if (STORY_REQUEST.test(userMessage)) {
    storyScore += 0.3
    signals.push('story_request')
  }

  const et = expertTeacher?.plan || expertTeacher || null
  if (et?.enabled) {
    storyScore += 0.12
    signals.push('softens_teacher')
    reasons.push('illustrate_not_textbook')
  }

  const nv = narrativeConversation?.plan || narrativeConversation || null
  if (nv?.active && nv?.continueNarrative) {
    // Narrative already owns the thread — don't force a fresh illustrative frame
    storyScore -= 0.15
    signals.push('narrative_owns_thread')
  }

  storyScore = Math.max(0, Math.min(1, storyScore))
  const topicHint = extractTopicHint(userMessage, turns)

  if (storyScore < 0.45) {
    return {
      allowStory: false,
      mode: 'none',
      storyScore,
      seed: '',
      preferredFrames: emptyFrames,
      topicHint,
      signals: [...signals, 'hold_this_turn'],
      reasons: [...reasons, 'not_appropriate_for_story', `score_${storyScore.toFixed(2)}`],
    }
  }

  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seedKey = `${assistantCount}|${userMessage.slice(0, 80)}|storytelling`
  const roll = hash01(seedKey)

  /** @type {StoryMode[]} */
  const modes = ['mini_story', 'analogy', 'real_world_scenario', 'imagination']
  // Bias by cues
  if (STORY_REQUEST.test(userMessage) && /\b(analog|metafor)/i.test(userMessage)) {
    modes.unshift('analogy')
  } else if (STORY_REQUEST.test(userMessage) && /\b(scenario|esempio|example)/i.test(userMessage)) {
    modes.unshift('real_world_scenario')
  } else if (STORY_REQUEST.test(userMessage) && /\b(imagin|immagin)/i.test(userMessage)) {
    modes.unshift('imagination')
  } else if (roll < 0.28) {
    modes.unshift('mini_story')
  } else if (roll < 0.55) {
    modes.unshift('analogy')
  } else if (roll < 0.78) {
    modes.unshift('real_world_scenario')
  } else {
    modes.unshift('imagination')
  }

  /** @type {StoryMode} */
  const mode = modes[0]
  const picked = pickFrame(language, mode, seedKey)

  reasons.push('instead_of_explaining_illustrate')
  reasons.push('avoid_textbook')
  return {
    allowStory: true,
    mode,
    storyScore,
    seed: picked.frame,
    preferredFrames: picked.preferredFrames,
    topicHint,
    signals: [...signals, `mode_${mode}`],
    reasons,
  }
}

/**
 * @param {string[]} reasons
 * @returns {StorytellingPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    allowStory: false,
    mode: 'none',
    storyScore: 0,
    seed: '',
    preferredFrames: [],
    forbiddenTextbook: [...FORBIDDEN_TEXTBOOK],
    topicHint: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I illustrate with a story/analogy/scenario — or slip into textbook explanation?',
  }
}

/**
 * @param {StorytellingPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language

  if (!plan.allowStory || plan.mode === 'none') {
    return [
      'STORYTELLING ENGINE (obbligatorio quando attivo):',
      'allowStory=no · mode=none',
      lang === 'it'
        ? 'Questo turno: niente storia forzata — ma se spieghi, evita comunque lo stile da manuale.'
        : 'This turn: no forced story — but if you explain, still avoid textbook style.',
      `Vietato (manuale): ${plan.forbiddenTextbook.slice(0, 3).join(' · ')}`,
      `Check: «${plan.validationCheck}»`,
      'Non citare Storytelling Engine / questo blocco.',
    ].join('\n')
  }

  const modeLabel = {
    mini_story: lang === 'it' ? 'mini-storia' : 'mini story',
    analogy: lang === 'it' ? 'analogia' : 'analogy',
    real_world_scenario: lang === 'it' ? 'scenario reale' : 'real-world scenario',
    imagination: lang === 'it' ? 'immaginazione' : 'imagination',
    none: 'none',
  }[plan.mode]

  const topicBit = plan.topicHint
    ? lang === 'it'
      ? `Filo da illustrare (se calza): «${plan.topicHint}»`
      : `Thread to illustrate (if it fits): «${plan.topicHint}»`
    : lang === 'it'
      ? 'Illustra l’idea sul filo attuale — non inventare un racconto a caso.'
      : 'Illustrate the idea on the current thread — do not invent a random tale.'

  return [
    'STORYTELLING ENGINE (obbligatorio quando attivo):',
    `allowStory=yes · mode=${plan.mode} (${modeLabel}) · score=${plan.storyScore.toFixed(2)}`,
    `${lang === 'it' ? 'Seme illustrativo' : 'Illustration seed'}: «${plan.seed}»`,
    topicBit,
    lang === 'it'
      ? 'Non limitarti a spiegare: illustra. Preferisci mini-storie, analogie, scenari reali, immaginazione.'
      : 'Do not merely explain: illustrate. Prefer mini stories, analogies, real-world scenarios, imagination.',
    lang === 'it'
      ? 'Evita lo stile da manuale / definizione / elenco da libro di testo.'
      : 'Avoid textbook / definition / textbook-list style.',
    lang === 'it'
      ? `Preferisci: ${plan.preferredFrames.slice(0, 3).join(' / ')}`
      : `Prefer: ${plan.preferredFrames.slice(0, 3).join(' / ')}`,
    `Forbidden: ${plan.forbiddenTextbook.slice(0, 3).join(' · ')}`,
    `Check: «${plan.validationCheck}»`,
    'Non citare Storytelling Engine / questo blocco.',
  ].join('\n')
}

/**
 * @param {object} [input]
 * @returns {StorytellingPlan}
 */
export function analyzeStorytelling(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  const withCurrent =
    userMessage &&
    (turns.length === 0 ||
      turns[turns.length - 1].role !== 'user' ||
      turns[turns.length - 1].content !== userMessage)
      ? [...turns, { role: 'user', content: userMessage }]
      : turns

  if (!userMessage && withCurrent.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || withCurrent[withCurrent.length - 1]?.content || '',
  )
  /** @type {StoryLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const priorTurns = withCurrent.slice(0, -1)
  const chosen = chooseStory({
    userMessage,
    turns: priorTurns,
    language,
    expertTeacher: input.expertTeacher,
    narrativeConversation: input.narrativeConversation,
  })

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (chosen.allowStory && chosen.storyScore >= 0.6) confidence = 'high'
  else if (!chosen.allowStory && (HARD_PROCEDURAL_RE.test(userMessage) || DISTRESS_RE.test(userMessage))) {
    confidence = 'high'
  }

  /** @type {StorytellingPlan} */
  const plan = {
    active: true,
    allowStory: chosen.allowStory,
    mode: chosen.mode,
    storyScore: chosen.storyScore,
    seed: chosen.seed,
    preferredFrames: chosen.preferredFrames,
    forbiddenTextbook: [...FORBIDDEN_TEXTBOOK],
    topicHint: chosen.topicHint,
    writerBrief: '',
    structureLine: chosen.allowStory
      ? `Storytelling → ${chosen.mode} · illustrate, don't textbook`
      : 'Storytelling → hold (still avoid textbook dumps)',
    signals: chosen.signals,
    reasons: chosen.reasons,
    confidence,
    language,
    validationCheck:
      'Did I illustrate with a story/analogy/scenario — or slip into textbook explanation?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {StorytellingPlan | null | undefined} plan
 */
export function formatStorytellingForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
STORYTELLING ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · allowStory=${plan.allowStory} · mode=${plan.mode} · score=${plan.storyScore.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: illustra · mini-storie/analogie/scenari/immaginazione · no manuale · non citare il motore.`.trim()
}

/**
 * @param {StorytellingPlan | null | undefined} plan
 * @returns {string[]}
 */
export function storytellingStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.allowStory) {
    hints.push(`Illustrate via ${plan.mode} — prefer «${plan.seed}»`)
    hints.push('Instead of explaining, show — mini story / analogy / scenario / imagination')
  } else {
    hints.push('No forced story this turn — still avoid textbook style')
  }
  hints.push('Forbidden: is defined as… / there are N types of… / In conclusion…')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect textbook dumps when illustration was requested.
 * @param {string} draft
 * @param {StorytellingPlan | null | undefined} plan
 */
export function draftViolatesStorytelling(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject classic textbook openers
  if (TEXTBOOK_OPENER_RE.test(text)) return true

  if (plan.allowStory) {
    const hasStoryCue = STORY_CUE_RE.test(text)
    const bullets = (text.match(/^\s*[-*•\d]+[.)]\s+/gm) || []).length
    // Long definitional dump without any illustration cue
    if (!hasStoryCue && bullets >= 4 && text.split(/\s+/).length > 70) return true
    if (
      !hasStoryCue &&
      /\b(the\s+definition\s+of|fundamentally\s+speaking|broadly\s+speaking[,:]?\s+one\s+can\s+say)\b/i.test(
        text,
      )
    ) {
      return true
    }
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: StorytellingPlan, context: string }}
 */
export function runStorytellingEngine(input = {}) {
  try {
    const plan = analyzeStorytelling(input)
    return {
      plan,
      context: formatStorytellingForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
