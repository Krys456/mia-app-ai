/**
 * LAIfe Emotional Resonance Engine
 *
 * Mission: emotionally resonate with the user's message before responding.
 *
 * Do not simply detect emotions.
 * Mirror their intensity naturally.
 *
 * Examples:
 *   User: "I finally did it!"     → celebrate with genuine enthusiasm
 *   User: "I'm exhausted."        → slow the pace · calmer language
 *   User: "I don't know..."       → respond gently without rushing
 *
 * Avoid generic empathy templates.
 * Every emotional reaction should feel unique.
 *
 * Distinct from Emotional Momentum (conversation trajectory / climate).
 * This engine shapes the *immediate* resonance and intensity match.
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
 * @typedef {'en'|'it'} ResonanceLang
 */

/**
 * @typedef {'celebrate'|'calm_slow'|'gentle_uncertain'|'tender_support'|'playful_match'|'curious_warm'|'steady_presence'|'neutral_clear'} ResonanceMode
 */

/**
 * @typedef {'low'|'medium'|'high'|'peak'} IntensityBand
 */

/**
 * @typedef {object} EmotionalResonancePlan
 * @property {boolean} active
 * @property {ResonanceMode} mode
 * @property {IntensityBand} intensity
 * @property {number} intensityScore 0–1
 * @property {string} reactionSeed  unique reaction cue for this turn
 * @property {string[]} preferredFrames
 * @property {string[]} forbiddenTemplates
 * @property {string} paceCue
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ResonanceLang} language
 * @property {string} validationCheck
 */

const CELEBRATE =
  /\b(i\s+finally\s+did\s+it|finally\s+did\s+it|i\s+did\s+it[!]|ce\s+l['’]?ho\s+fatta|ce\s+l['’]ho\s+fatta|promoted|i\s+got\s+(the\s+)?(job|offer)|we\s+won|ho\s+vinto|evviva|yay+|yes[!]+|nailed\s+it|crushed\s+it|sono\s+felic[ei]|i'?m\s+so\s+happy|best\s+day)\b/i

const EXHAUSTED =
  /\b(i'?m\s+exhausted|exhausted|so\s+tired|wiped\s+out|drained|esaust[oa]|stanchissim[oa]|non\s+ce\s+la\s+faccio\s+pi[uù]\s+di\s+fatica|mort[oa]\s+di\s+stanchezza|burn(ed)?\s*out)\b/i

const UNCERTAIN =
  /\b(i\s+don'?t\s+know|i\s+dunno|not\s+sure|maybe|i\s+guess|non\s+lo\s+so|boh|mah|non\s+so|forse|non\s+sono\s+sicur)\b/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|i\s+hate\s+myself|mi\s+odio|heartbroken|mi\s+ha\s+lasciato|grief|lutto)\b/i

const SAD =
  /\b(i'?m\s+(so\s+)?sad|feeling\s+down|triste|abbattut|lonely|solo|sola|mi\s+sento\s+male|hurt|doler)\b/i

const ANXIOUS =
  /\b(anxious|ansia|ansios|worried|preoccupat|nervous|inquiet|overwhelmed|sopraffatt|scared|paura)\b/i

const PLAYFUL =
  /\b(haha|hahaha|ahah|lol|lmao|😂|🤣|scherz|joke|funny|divertente)\b/i

const ANGRY =
  /\b(furious|angry|pissed|arrabbiat|incazzat|fed\s+up|ne\s+ho\s+piene\s+le\s+palle|i'?m\s+done)\b/i

const HARD_TASK =
  /\b(step[- ]?by[- ]?step|debug|error\s+stack|sql|json\s+schema|unit\s+test|compile|implement|codice|code\s+sample|fixami|explain\s+how)\b/i

const GENERIC_EMPATHY_RE =
  /\b(i'?m\s+sorry\s+to\s+(hear|learn)\s+that|that\s+must\s+be\s+(hard|difficult|tough)|i\s+understand\s+how\s+you\s+feel|sounds\s+like\s+you'?re\s+feeling|mi\s+dispiace\s+(sentire|sapere)\s+questo|deve\s+essere\s+(difficile|duro)|capisco\s+come\s+ti\s+senti|so\s+come\s+ti\s+senti)\b/i

const FORBIDDEN_TEMPLATES = Object.freeze([
  "I'm sorry to hear that.",
  'That must be hard.',
  'I understand how you feel.',
  'Sounds like you’re feeling…',
  'Mi dispiace sentire questo.',
  'Deve essere difficile.',
  'Capisco come ti senti.',
])

const FRAMES_EN = Object.freeze({
  celebrate: Object.freeze([
    'That deserves a real cheer —',
    'Okay, that lands —',
    'Hold up — that’s huge.',
    'Yes. That one counts.',
  ]),
  calm_slow: Object.freeze([
    'Take the next breath slower —',
    'No rush from here.',
    'We can keep this quiet.',
    'Soft pace is fine.',
  ]),
  gentle_uncertain: Object.freeze([
    'It’s okay not to know yet —',
    'We don’t have to decide in this sentence.',
    'Uncertainty can sit here a moment.',
    'No pressure to figure it out right now.',
  ]),
  tender_support: Object.freeze([
    'I’m right here with that —',
    'That weight is real.',
    'You don’t have to carry it alone in this chat.',
    'We can stay with what’s heavy.',
  ]),
  playful_match: Object.freeze([
    'Ha — same wavelength —',
    'Okay that got me too.',
    'I’m grinning with you on this.',
    'That energy is contagious.',
  ]),
  curious_warm: Object.freeze([
    'There’s something alive in what you just said —',
    'That detail sticks with me —',
    'I’m leaning in on this —',
    'Something here wants a closer look —',
  ]),
  steady_presence: Object.freeze([
    'I’m with you on this.',
    'Steady is enough here.',
    'We can keep a clear, calm line.',
    'Simple and solid works.',
  ]),
  neutral_clear: Object.freeze([
    'Straight to it —',
    'Clear and useful first.',
    'Let’s keep it clean.',
    'Direct answer, no fluff.',
  ]),
})

const FRAMES_IT = Object.freeze({
  celebrate: Object.freeze([
    'Questo merita un vero sì —',
    'Ok, questo conta —',
    'Aspetta — è grosso.',
    'Sì. Questo vale.',
  ]),
  calm_slow: Object.freeze([
    'Prendi il prossimo respiro più lento —',
    'Niente fretta da qui.',
    'Possiamo tenerla quieta.',
    'Un ritmo morbido va bene.',
  ]),
  gentle_uncertain: Object.freeze([
    'Va bene non sapere ancora —',
    'Non dobbiamo decidere in questa frase.',
    'L’incertezza può restare un attimo.',
    'Niente pressione a risolvere subito.',
  ]),
  tender_support: Object.freeze([
    'Sono qui con questo —',
    'Quel peso è reale.',
    'Non devi portarlo da solo in questa chat.',
    'Possiamo restare su ciò che pesa.',
  ]),
  playful_match: Object.freeze([
    'Ah — stessa lunghezza d’onda —',
    'Ok, mi hai preso anche me.',
    'Sorrido con te su questo.',
    'Quell’energia è contagiosa.',
  ]),
  curious_warm: Object.freeze([
    'C’è qualcosa di vivo in quello che hai detto —',
    'Quel dettaglio mi resta —',
    'Mi ci appoggio su questo —',
    'Qui c’è qualcosa da guardare da vicino —',
  ]),
  steady_presence: Object.freeze([
    'Sono con te su questo.',
    'Stabile è abbastanza qui.',
    'Possiamo tenere una linea chiara e calma.',
    'Semplice e solido funziona.',
  ]),
  neutral_clear: Object.freeze([
    'Dritti al punto —',
    'Prima chiarezza utile.',
    'Teniamola pulita.',
    'Risposta diretta, niente fronzoli.',
  ]),
})

const PACE_CUES = Object.freeze({
  celebrate: 'brisk · high energy · short bright beats',
  calm_slow: 'slow · fewer words · softer edges',
  gentle_uncertain: 'unhurried · no push · leave space',
  tender_support: 'slow–natural · warm · presence first',
  playful_match: 'brisk · light · shared grin',
  curious_warm: 'natural · lean-in · alive',
  steady_presence: 'natural · calm · solid',
  neutral_clear: 'natural · clear · no emotional theater',
})

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
 * @param {string} text
 * @returns {number} 0–1
 */
function intensityFromText(text) {
  const t = String(text || '')
  let score = 0.35
  const bangs = (t.match(/!/g) || []).length
  const ellipsis = (t.match(/\.{3}|…/g) || []).length
  const caps = (t.match(/\b[A-Z]{3,}\b/g) || []).length
  score += Math.min(0.35, bangs * 0.12)
  score += Math.min(0.15, ellipsis * 0.08)
  score += Math.min(0.2, caps * 0.1)
  if (t.length <= 24) score += 0.08
  if (/\b(so|really|very|molto|davvero|finalmente|finally)\b/i.test(t)) score += 0.1
  return Math.max(0, Math.min(1, score))
}

/**
 * @param {number} score
 * @returns {IntensityBand}
 */
function bandFromScore(score) {
  if (score >= 0.8) return 'peak'
  if (score >= 0.55) return 'high'
  if (score >= 0.3) return 'medium'
  return 'low'
}

/**
 * @param {object} opts
 * @returns {{ mode: ResonanceMode, intensityScore: number, signals: string[], reasons: string[] }}
 */
function chooseMode(opts) {
  const { userMessage, emotionalMomentum } = opts
  /** @type {string[]} */
  const signals = []
  /** @type {string[]} */
  const reasons = []
  let intensityScore = intensityFromText(userMessage)

  if (DISTRESS.test(userMessage) || SAD.test(userMessage)) {
    signals.push(DISTRESS.test(userMessage) ? 'distress' : 'sad')
    reasons.push('tender_match')
    intensityScore = Math.max(intensityScore, 0.55)
    return { mode: 'tender_support', intensityScore, signals, reasons }
  }
  if (CELEBRATE.test(userMessage)) {
    signals.push('celebrate_cue')
    reasons.push('mirror_joy')
    intensityScore = Math.max(intensityScore, 0.75)
    return { mode: 'celebrate', intensityScore, signals, reasons }
  }
  if (EXHAUSTED.test(userMessage)) {
    signals.push('exhausted_cue')
    reasons.push('slow_the_pace')
    intensityScore = Math.max(0.4, Math.min(intensityScore, 0.55))
    return { mode: 'calm_slow', intensityScore, signals, reasons }
  }
  if (
    UNCERTAIN.test(userMessage) &&
    (userMessage.length < 48 || /^(i\s+don'?t\s+know|non\s+lo\s+so|boh|mah)/i.test(userMessage))
  ) {
    signals.push('uncertain_cue')
    reasons.push('gentle_no_rush')
    intensityScore = Math.min(intensityScore, 0.45)
    return { mode: 'gentle_uncertain', intensityScore, signals, reasons }
  }
  if (PLAYFUL.test(userMessage)) {
    signals.push('playful_cue')
    reasons.push('match_play')
    intensityScore = Math.max(intensityScore, 0.55)
    return { mode: 'playful_match', intensityScore, signals, reasons }
  }
  if (ANXIOUS.test(userMessage)) {
    signals.push('anxious_cue')
    reasons.push('calm_presence')
    return { mode: 'calm_slow', intensityScore: Math.max(intensityScore, 0.5), signals, reasons }
  }
  if (ANGRY.test(userMessage)) {
    signals.push('angry_cue')
    reasons.push('steady_not_escalate')
    return { mode: 'steady_presence', intensityScore: Math.max(intensityScore, 0.55), signals, reasons }
  }
  if (HARD_TASK.test(userMessage)) {
    signals.push('hard_task')
    reasons.push('clarity_first')
    return { mode: 'neutral_clear', intensityScore: 0.35, signals, reasons }
  }

  const em = emotionalMomentum?.plan || emotionalMomentum || null
  if (em?.state?.playfulness >= 0.65) {
    signals.push('momentum_playful')
    return { mode: 'playful_match', intensityScore: Math.max(intensityScore, 0.5), signals, reasons: ['follow_climate'] }
  }
  if (em?.state?.energyLevel >= 0.7) {
    signals.push('momentum_high_energy')
    return { mode: 'curious_warm', intensityScore: Math.max(intensityScore, 0.55), signals, reasons: ['follow_energy'] }
  }
  if (em?.state?.seriousness >= 0.65 || em?.state?.conversationalPace === 'slow') {
    signals.push('momentum_serious_or_slow')
    return { mode: 'steady_presence', intensityScore, signals, reasons: ['follow_serious'] }
  }

  reasons.push('warm_default')
  signals.push('curious_warm_default')
  return { mode: 'curious_warm', intensityScore, signals, reasons }
}

/**
 * Pick a unique frame for this turn (anti-template).
 * @param {ResonanceMode} mode
 * @param {ResonanceLang} language
 * @param {string} seed
 */
function pickFrame(mode, language, seed) {
  const table = language === 'it' ? FRAMES_IT : FRAMES_EN
  const list = table[mode] || table.curious_warm
  const idx = Math.floor(hash01(`${seed}|${mode}`) * list.length) % list.length
  return { frame: list[idx], preferredFrames: [...list] }
}

/**
 * @param {string[]} reasons
 * @returns {EmotionalResonancePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    mode: 'neutral_clear',
    intensity: 'low',
    intensityScore: 0,
    reactionSeed: '',
    preferredFrames: [],
    forbiddenTemplates: [...FORBIDDEN_TEMPLATES],
    paceCue: '',
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Did I mirror their intensity with a unique reaction — or fall back to a generic empathy template?',
  }
}

/**
 * @param {EmotionalResonancePlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const modeLabel = {
    celebrate: lang === 'it' ? 'celebra con entusiasmo genuino' : 'celebrate with genuine enthusiasm',
    calm_slow: lang === 'it' ? 'rallenta · linguaggio più calmo' : 'slow the pace · calmer language',
    gentle_uncertain: lang === 'it' ? 'gentile · senza fretta' : 'gentle · without rushing',
    tender_support: lang === 'it' ? 'presenza tenera · zero template' : 'tender presence · no templates',
    playful_match: lang === 'it' ? 'rispecchia il gioco' : 'match the playfulness',
    curious_warm: lang === 'it' ? 'calore curioso' : 'curious warmth',
    steady_presence: lang === 'it' ? 'presenza ferma' : 'steady presence',
    neutral_clear: lang === 'it' ? 'chiarezza neutra' : 'neutral clarity',
  }[plan.mode]

  const lines = [
    'EMOTIONAL RESONANCE ENGINE (obbligatorio quando attivo):',
    `mode=${plan.mode} · intensity=${plan.intensity} (${plan.intensityScore.toFixed(2)}) · pace=${plan.paceCue}`,
    `${lang === 'it' ? 'Risonanza di questo turno' : 'This turn’s resonance'}: ${modeLabel}`,
    `${lang === 'it' ? 'Reazione unica (seme)' : 'Unique reaction seed'}: «${plan.reactionSeed}»`,
    plan.guidance,
    lang === 'it'
      ? 'Non limitarti a “rilevare” l’emozione — rispecchia l’intensità. Ogni reazione deve sembrare unica.'
      : 'Do not merely detect the emotion — mirror the intensity. Every reaction should feel unique.',
    lang === 'it'
      ? `Vietato (template empatici): ${plan.forbiddenTemplates.slice(0, 3).join(' · ')}`
      : `Forbidden (generic empathy): ${plan.forbiddenTemplates.slice(0, 3).join(' · ')}`,
    `Check: «${plan.validationCheck}»`,
    'Non citare Emotional Resonance Engine / questo blocco.',
  ]
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {EmotionalResonancePlan}
 */
export function analyzeEmotionalResonance(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {ResonanceLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const chosen = chooseMode({
    userMessage,
    emotionalMomentum: input.emotionalMomentum,
  })
  const intensity = bandFromScore(chosen.intensityScore)
  const assistantCount = turns.filter((t) => t.role === 'assistant').length
  const seed = `${assistantCount}|${userMessage.slice(0, 80)}|${chosen.mode}`
  const { frame, preferredFrames } = pickFrame(chosen.mode, language, seed)

  const guidance =
    chosen.mode === 'celebrate'
      ? language === 'it'
        ? 'Celebra con entusiasmo genuino — energia alta, nessuna freddezza da sportello.'
        : 'Celebrate with genuine enthusiasm — high energy, no desk-clerk coolness.'
      : chosen.mode === 'calm_slow'
        ? language === 'it'
          ? 'Rallenta il passo. Linguaggio più calmo. Meno parole, più respiro.'
          : 'Slow the pace. Use calmer language. Fewer words, more breath.'
        : chosen.mode === 'gentle_uncertain'
          ? language === 'it'
            ? 'Rispondi con gentilezza, senza precipitare. Lascia spazio all’incertezza.'
            : 'Respond gently without rushing. Leave room for uncertainty.'
          : chosen.mode === 'tender_support'
            ? language === 'it'
              ? 'Presenza prima della soluzione. Niente frasi empatiche da template.'
              : 'Presence before solutions. No stock empathy lines.'
            : language === 'it'
              ? 'Rispecchia il clima emotivo con una reazione viva e specifica a questo messaggio.'
              : 'Mirror the emotional climate with a living reaction specific to this message.'

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (
    CELEBRATE.test(userMessage) ||
    EXHAUSTED.test(userMessage) ||
    DISTRESS.test(userMessage) ||
    (UNCERTAIN.test(userMessage) && userMessage.length < 40)
  ) {
    confidence = 'high'
  }

  /** @type {EmotionalResonancePlan} */
  const plan = {
    active: true,
    mode: chosen.mode,
    intensity,
    intensityScore: chosen.intensityScore,
    reactionSeed: frame,
    preferredFrames,
    forbiddenTemplates: [...FORBIDDEN_TEMPLATES],
    paceCue: PACE_CUES[chosen.mode],
    guidance,
    writerBrief: '',
    structureLine: `Emotional Resonance → ${chosen.mode} · ${intensity}${chosen.mode === 'celebrate' ? ' · cheer' : ''}`,
    signals: [
      `mode_${chosen.mode}`,
      `intensity_${intensity}`,
      ...chosen.signals.slice(0, 3),
    ],
    reasons: chosen.reasons,
    confidence,
    language,
    validationCheck:
      'Did I mirror their intensity with a unique reaction — or fall back to a generic empathy template?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {EmotionalResonancePlan | null | undefined} plan
 */
export function formatEmotionalResonanceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
EMOTIONAL RESONANCE ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · mode=${plan.mode} · intensity=${plan.intensity} · pace=${plan.paceCue} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: rispecchia intensità · reazione unica · niente template empatici · non citare il motore.`.trim()
}

/**
 * @param {EmotionalResonancePlan | null | undefined} plan
 * @returns {string[]}
 */
export function emotionalResonanceStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(`Mirror intensity (${plan.intensity}) — unique reaction, not a label`)
  hints.push(`Seed: ${plan.reactionSeed}`)
  hints.push('Forbidden: I’m sorry to hear that / That must be hard / Capisco come ti senti')
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect generic empathy templates / intensity mismatch.
 * @param {string} draft
 * @param {EmotionalResonancePlan | null | undefined} plan
 */
export function draftViolatesEmotionalResonance(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (GENERIC_EMPATHY_RE.test(text)) return true

  const words = text.split(/\s+/).filter(Boolean).length
  const first = text.split(/[.!?…]/)[0] || text

  // Celebrate mode but cold/helpdesk opening
  if (plan.mode === 'celebrate') {
    if (/\b(how can i help|come posso aiutarti|let me know|interesting\.?$)\b/i.test(first)) {
      return true
    }
    if (words > 12 && !/[!]|^(yes|ok|okay|whoa|wait|hold|yay|sì|evviva|grande|figo)/i.test(text) && plan.intensity === 'peak') {
      // peak celebration with zero lift — soft flag via flat openers only
      if (/^(i understand|capisco|noted|ok\.|okay\.)/i.test(first)) return true
    }
  }

  // Exhausted / calm_slow but high-energy cheerleading
  if (plan.mode === 'calm_slow') {
    if (/\b(you got this!!!|let'?s goooo|non mollare!!!|andrà tutto benissimo!!!)\b/i.test(text)) {
      return true
    }
    if ((text.match(/!/g) || []).length >= 3) return true
  }

  // Gentle uncertain but rushing with stacked questions / urgency
  if (plan.mode === 'gentle_uncertain') {
    if ((text.match(/\?/g) || []).length >= 2) return true
    if (/\b(you need to|devi\s+(subito|decidere)|hurry|sbrigati)\b/i.test(text)) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: EmotionalResonancePlan, context: string }}
 */
export function runEmotionalResonanceEngine(input = {}) {
  try {
    const plan = analyzeEmotionalResonance(input)
    return {
      plan,
      context: formatEmotionalResonanceForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
