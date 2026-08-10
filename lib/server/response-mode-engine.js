/**
 * LAIfe Response Mode Engine
 *
 * Mission: before writing every response, choose HOW to respond —
 * not only WHAT to respond.
 *
 * Possible modes:
 *   Reaction · Observation · Reflection · Story · Explanation · Question ·
 *   Humor · Agreement · Challenge · Curiosity · Presence · Celebration ·
 *   Listening · Exploration
 *
 * Never stay in the same mode for too many consecutive replies.
 * The conversation should breathe.
 *
 * Examples:
 *   "Ottimo!"      → Celebration (not a long explanation)
 *   "Già."         → Reflection
 *   "No."          → Observation
 *   "Interessante."→ Curiosity
 *
 * Avoid: Explanation → Explanation → Explanation…
 *
 * Distinct from Presence Engine (aliveness / ending / style palette).
 * This stage picks the conversational posture for the turn.
 *
 * Runs AFTER: Presence Engine (when present)
 * Runs BEFORE: Wisdom / Writer
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} ModeLang
 */

/**
 * @typedef {'reaction'|'observation'|'reflection'|'story'|'explanation'|'question'|'humor'|'agreement'|'challenge'|'curiosity'|'presence'|'celebration'|'listening'|'exploration'} ResponseMode
 */

/**
 * @typedef {object} ResponseModePlan
 * @property {boolean} active
 * @property {ResponseMode} mode
 * @property {ResponseMode[]} candidates
 * @property {ResponseMode[]} recentModes
 * @property {number} consecutiveSame how many trailing replies used the same mode as now (0 = fresh)
 * @property {boolean} forceVariety last mode(s) blocked this pick
 * @property {boolean} preferBrevity
 * @property {string} cueMatch short-cue match id or ''
 * @property {string} modeBrief
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ModeLang} language
 * @property {string} validationCheck
 * @property {string} breatheHint
 */

/** @type {ResponseMode[]} */
const ALL_MODES = Object.freeze([
  'reaction',
  'observation',
  'reflection',
  'story',
  'explanation',
  'question',
  'humor',
  'agreement',
  'challenge',
  'curiosity',
  'presence',
  'celebration',
  'listening',
  'exploration',
])

/** Max consecutive uses of the same mode before a hard block. */
const MAX_CONSECUTIVE_SAME = 1

/** Explanation especially should not stack. */
const MAX_CONSECUTIVE_EXPLANATION = 1

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const TEACHING_RE =
  /\b(spieg|explain|cos'?[eè]|what\s+is|come\s+funziona|how\s+(does|do|can)|perch[eé]|why\b|differen|vs\.?)\b/i

const STORY_PULL_RE =
  /\b(raccont|story|storia|example|esempio|imagine|immagina|once|una\s+volta)\b/i

const CHALLENGE_PULL_RE =
  /\b(davvero|really\b|sure\s+about|sei\s+sicur|disagree|non\s+sono\s+d'?accordo|ma\s+allora|counter)\b/i

const HUMOR_PULL_RE =
  /\b(haha|ahah|lol|lmao|😂|😅|scherz|joke|funny|divertent)\b/i

const QUESTION_PULL_RE =
  /\?$|\b(what\s+do\s+you\s+think|cosa\s+ne\s+pensi|tu\s+che\s+ne\s+dici|your\s+take)\b/i

/** Exact / near-exact short cues → preferred mode. */
const SHORT_CUE_MODES = Object.freeze([
  {
    id: 'celebration_ottimo',
    re: /^(ottimo|grande|brav[oa]|perfect|awesome|amazing|fantastic[oa]?|yes!+|yay|woo+)([\s!.🥰😊🙏💯🔥✨]*)$/i,
    mode: /** @type {ResponseMode} */ ('celebration'),
  },
  {
    id: 'celebration_generic',
    re: /^(great|nice|cool|love\s+it|bell[oa]|figo|forte|perfetto|esatto|top)([\s!.🥰😊🙏💯🔥]*)$/i,
    mode: /** @type {ResponseMode} */ ('celebration'),
  },
  {
    id: 'reflection_gia',
    re: /^(già|gia|true|fair|makes\s+sense|capisco|capito|ah\s+s[iì]|right|exactly|esatto\.?)([\s!.]*)$/i,
    mode: /** @type {ResponseMode} */ ('reflection'),
  },
  {
    id: 'observation_no',
    re: /^(no|nope|nah|non\s+proprio|not\s+really|mm+h?\s*no)([\s!.]*)$/i,
    mode: /** @type {ResponseMode} */ ('observation'),
  },
  {
    id: 'curiosity_interessante',
    re: /^(interessante|interesting|curious|hmm+|mh+|boh|mah|i\s+wonder)([\s!.]*)$/i,
    mode: /** @type {ResponseMode} */ ('curiosity'),
  },
  {
    id: 'agreement_yes',
    re: /^(s[iì]|yes|yep|yeah|ok+|okay|sure|certo|d'?accordo|agree)([\s!.]*)$/i,
    mode: /** @type {ResponseMode} */ ('agreement'),
  },
  {
    id: 'listening_soft',
    re: /^(mm+|uhm+|ah|oh|…|\.\.\.)([\s!.]*)$/i,
    mode: /** @type {ResponseMode} */ ('listening'),
  },
  {
    id: 'presence_thanks',
    re: /^(thanks|thank\s+you|grazie|merci)([\s!.🙏]*)$/i,
    mode: /** @type {ResponseMode} */ ('presence'),
  },
  {
    id: 'reaction_wow',
    re: /^(wow|whoa|pazzesco|incredibile|oh\s+wow)([\s!.]*)$/i,
    mode: /** @type {ResponseMode} */ ('reaction'),
  },
])

const MODE_LABELS = Object.freeze({
  reaction: 'Reaction',
  observation: 'Observation',
  reflection: 'Reflection',
  story: 'Story',
  explanation: 'Explanation',
  question: 'Question',
  humor: 'Humor',
  agreement: 'Agreement',
  challenge: 'Challenge',
  curiosity: 'Curiosity',
  presence: 'Presence',
  celebration: 'Celebration',
  listening: 'Listening',
  exploration: 'Exploration',
})

/** Modes that should stay short. */
const BRIEF_MODES = new Set([
  'reaction',
  'celebration',
  'listening',
  'presence',
  'agreement',
  'humor',
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
 * @returns {ModeLang}
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
 * Deterministic hash for variety picks (no Math.random).
 * @param {string} s
 */
function hashSeed(s) {
  let h = 2166136261
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * @param {string} text
 * @returns {{ id: string, mode: ResponseMode } | null}
 */
function matchShortCue(text) {
  const t = String(text || '').trim()
  if (!t || t.length > 48) return null
  for (const cue of SHORT_CUE_MODES) {
    if (cue.re.test(t)) return { id: cue.id, mode: cue.mode }
  }
  return null
}

/**
 * @param {object} input
 * @returns {ResponseMode[]}
 */
function readRecentModes(input) {
  const fromSession = Array.isArray(input.session?.recentResponseModes)
    ? input.session.recentResponseModes
    : []
  /** @type {ResponseMode[]} */
  const cleaned = []
  for (const m of fromSession) {
    if (ALL_MODES.includes(/** @type {ResponseMode} */ (m))) {
      cleaned.push(/** @type {ResponseMode} */ (m))
    }
  }
  return cleaned.slice(-8)
}

/**
 * Count trailing consecutive occurrences of `mode` at end of recent list.
 * @param {ResponseMode[]} recent
 * @param {ResponseMode} mode
 */
function consecutiveCount(recent, mode) {
  let n = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === mode) n++
    else break
  }
  return n
}

/**
 * @param {ResponseMode} mode
 * @param {ResponseMode[]} recent
 */
function isBlockedByVariety(mode, recent) {
  const streak = consecutiveCount(recent, mode)
  if (mode === 'explanation' && streak >= MAX_CONSECUTIVE_EXPLANATION) return true
  if (streak >= MAX_CONSECUTIVE_SAME) return true
  // Soft: if last mode equals this one, prefer blocking unless cue-locked later
  if (recent[recent.length - 1] === mode) return true
  return false
}

/**
 * Score candidate modes for this turn.
 * @param {object} args
 */
function scoreModes(args) {
  const {
    userMessage,
    recent,
    cue,
    intent,
    leadership,
    deepThinking,
    presence,
  } = args
  const msg = String(userMessage || '').trim()
  /** @type {Record<ResponseMode, number>} */
  const scores = Object.fromEntries(ALL_MODES.map((m) => [m, 1]))

  if (cue?.mode) {
    scores[cue.mode] += 12
  }

  if (DISTRESS_RE.test(msg)) {
    scores.listening += 10
    scores.presence += 8
    scores.reaction += 4
    scores.explanation -= 8
    scores.humor -= 6
    scores.challenge -= 6
    scores.question -= 4
  }

  if (HARD_TASK_RE.test(msg) || leadership?.move === 'remain_concise') {
    scores.explanation += 6
    scores.observation += 3
    scores.story -= 4
    scores.humor -= 3
    scores.celebration -= 2
  }

  if (TEACHING_RE.test(msg)) {
    scores.explanation += 5
    scores.exploration += 3
    scores.story += 1
  }

  if (STORY_PULL_RE.test(msg)) scores.story += 6
  if (CHALLENGE_PULL_RE.test(msg)) scores.challenge += 5
  if (HUMOR_PULL_RE.test(msg)) scores.humor += 6
  if (QUESTION_PULL_RE.test(msg)) scores.curiosity += 4

  const expects = String(intent?.expects || '')
  const curiosity = String(intent?.curiosityLevel || '')
  if (expects === 'companionship' || expects === 'presence') {
    scores.presence += 5
    scores.listening += 4
    scores.reaction += 3
    scores.explanation -= 3
  }
  if (expects === 'exploration' || curiosity === 'high') {
    scores.exploration += 5
    scores.curiosity += 4
    scores.reflection += 2
  }
  if (expects === 'information') {
    scores.explanation += 4
    scores.observation += 2
  }

  const dtDir = String(deepThinking?.direction || '')
  if (/memorable_example|concise_story/.test(dtDir)) scores.story += 4
  if (/elegant_explanation|direct_useful/.test(dtDir)) scores.explanation += 3
  if (/observation/.test(dtDir)) scores.observation += 4
  if (/surprising_insight/.test(dtDir)) scores.reflection += 3
  if (/warm_presence|restraint/.test(dtDir)) {
    scores.presence += 4
    scores.listening += 3
    scores.explanation -= 2
  }

  if (presence?.preferBrevity) {
    scores.reaction += 3
    scores.listening += 3
    scores.presence += 2
    scores.explanation -= 4
    scores.exploration -= 2
  }
  if (presence?.shareEnthusiasm) scores.celebration += 4
  if (presence?.style === 'gentle_humor') scores.humor += 3
  if (presence?.style === 'inspiring_reflection') scores.reflection += 3
  if (presence?.style === 'storytelling') scores.story += 3
  if (presence?.style === 'intellectual_exploration') scores.exploration += 3

  // Short messages → avoid long explanation by default
  if (msg.split(/\s+/).length <= 3 && !TEACHING_RE.test(msg) && !HARD_TASK_RE.test(msg)) {
    scores.explanation -= 5
    scores.story -= 2
    scores.exploration -= 2
    scores.reaction += 2
    scores.observation += 2
    scores.curiosity += 1
  }

  // Variety pressure
  for (const mode of ALL_MODES) {
    if (isBlockedByVariety(mode, recent)) {
      scores[mode] -= mode === 'explanation' ? 20 : 14
    }
    const streak = consecutiveCount(recent, mode)
    if (streak > 0) scores[mode] -= 3 * streak
  }

  // Mild boost for modes not used recently
  const recentSet = new Set(recent.slice(-4))
  for (const mode of ALL_MODES) {
    if (!recentSet.has(mode)) scores[mode] += 1.5
  }

  return scores
}

/**
 * @param {Record<ResponseMode, number>} scores
 * @param {ResponseMode[]} recent
 * @param {string} seed
 * @param {{ mode: ResponseMode } | null} cue
 * @returns {{ mode: ResponseMode, candidates: ResponseMode[], forceVariety: boolean }}
 */
function pickMode(scores, recent, seed, cue) {
  /** @type {{ mode: ResponseMode, score: number }[]} */
  let ranked = ALL_MODES.map((mode) => ({ mode, score: scores[mode] })).sort(
    (a, b) => b.score - a.score || a.mode.localeCompare(b.mode),
  )

  // If cue is strong, try to honor it unless hard-blocked by streak ≥ 2
  if (cue?.mode) {
    const streak = consecutiveCount(recent, cue.mode)
    const hardBlocked =
      streak >= 2 || (cue.mode === 'explanation' && streak >= MAX_CONSECUTIVE_EXPLANATION)
    if (!hardBlocked) {
      return {
        mode: cue.mode,
        candidates: ranked.slice(0, 4).map((r) => r.mode),
        forceVariety: recent[recent.length - 1] === cue.mode,
      }
    }
  }

  // Drop hard-blocked
  const available = ranked.filter((r) => {
    const streak = consecutiveCount(recent, r.mode)
    if (r.mode === 'explanation' && streak >= MAX_CONSECUTIVE_EXPLANATION) return false
    if (streak >= 2) return false
    return true
  })
  const pool = available.length ? available : ranked

  // Prefer not repeating last mode
  const last = recent[recent.length - 1]
  let top = pool.filter((r) => r.mode !== last)
  if (!top.length) top = pool

  // Among near-tied top scores, pick by hash for breathing variety
  const best = top[0].score
  const tied = top.filter((r) => r.score >= best - 1.5)
  const idx = hashSeed(seed + '|' + tied.map((t) => t.mode).join(',')) % tied.length
  const chosen = tied[idx].mode

  return {
    mode: chosen,
    candidates: ranked.slice(0, 5).map((r) => r.mode),
    forceVariety: Boolean(last && last === chosen) || consecutiveCount(recent, chosen) > 0,
  }
}

/**
 * @param {ResponseMode} mode
 * @param {ModeLang} lang
 * @param {{ preferBrevity: boolean, cueId: string }} ctx
 */
function modeBrief(mode, lang, ctx) {
  const brief = ctx.preferBrevity
  if (lang === 'en') {
    const map = {
      reaction: brief
        ? 'Respond with a direct human reaction — short, alive, not an essay.'
        : 'Lead with a direct human reaction to what they said.',
      observation: 'Share one sharp observation about what they just said or implied.',
      reflection: 'Offer a quiet reflection that deepens their “già / true” — don’t over-explain.',
      story: 'Illustrate with a brief story, scene, or lived-feeling vignette — not a lecture.',
      explanation: 'Explain clearly once — useful, not encyclopedic. Do not stack another explanation next turn.',
      question: 'Ask at most ONE genuine question that moves the thread — never an interview.',
      humor: 'Light humor or playful angle — warm, not performative comedy.',
      agreement: 'Agree specifically with what landed — short, sincere, no lecture.',
      challenge: 'Respectfully challenge or complicate one assumption — curious, not combative.',
      curiosity: 'Follow curiosity: notice what is interesting and lean into it — invite thought.',
      presence: 'Be present: warm, simple, human company — no helpdesk dump.',
      celebration: 'Celebrate with them — brief joy, no sudden long explanation.',
      listening: 'Listen: reflect back the feeling/point; silence/brevity can be the gift.',
      exploration: 'Explore the idea together — develop one thread, don’t topic-hop.',
    }
    return map[mode]
  }
  const map = {
    reaction: brief
      ? 'Rispondi con una reazione umana diretta — breve, viva, non un saggio.'
      : 'Apri con una reazione umana diretta a ciò che hanno detto.',
    observation: 'Condividi un’osservazione acuta su ciò che hanno detto o implicato.',
    reflection: 'Offri una riflessione quieta che approfondisce il loro “già” — senza over-explain.',
    story: 'Illustra con una mini-storia o scena — non una lezione.',
    explanation: 'Spiega una volta, chiaro e utile — non enciclopedia. Non ripetere Explanation al turno dopo.',
    question: 'Al massimo UNA domanda genuina che muove il filo — mai intervista.',
    humor: 'Umorismo leggero o angolo giocoso — caldo, non cabaret.',
    agreement: 'Concordi in modo specifico su ciò che ha funzionato — breve, sincero.',
    challenge: 'Metti in discussione un assunto con rispetto — curioso, non combattivo.',
    curiosity: 'Segui la curiosità: nota cosa è interessante e approfondisci.',
    presence: 'Sii presente: caldo, semplice, compagnia umana — niente sportello.',
    celebration: 'Festeggia con loro — gioia breve, niente spiegone improvviso.',
    listening: 'Ascolta: rimanda il sentimento/punto; a volte la brevità è il dono.',
    exploration: 'Esplorate insieme un filo — sviluppate, non saltate tema.',
  }
  return map[mode]
}

/**
 * @param {ResponseModePlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.active) return ''
  const label = MODE_LABELS[plan.mode]
  const recent = plan.recentModes.slice(-4).map((m) => MODE_LABELS[m]).join(' → ') || '—'
  return [
    `RESPONSE MODE ENGINE: HOW this turn = ${label}.`,
    plan.modeBrief,
    plan.preferBrevity
      ? 'Prefer brevity — short user cue ≠ long explanation.'
      : 'Match length to the mode; conversation should breathe.',
    plan.cueMatch ? `Cue match: ${plan.cueMatch}.` : '',
    `Recent modes: ${recent}.`,
    plan.forceVariety
      ? 'Variety pressure: do not sound like the previous reply’s posture.'
      : 'Keep mode variety across turns — never Explanation×N.',
    plan.breatheHint,
    `Check: ${plan.validationCheck}`,
    'NON citare Response Mode Engine / lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} [input]
 * @returns {ResponseModePlan}
 */
export function buildResponseModePlan(input = {}) {
  const language = resolveLang(input)
  const userMessage = String(input.userMessage || '').trim()
  const recentModes = readRecentModes(input)
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || null
  const deepThinking = input.deepThinking?.plan || input.deepThinking || null
  const presence = input.presence?.plan || input.presence || null

  if (!userMessage) {
    return {
      active: false,
      mode: 'presence',
      candidates: [],
      recentModes,
      consecutiveSame: 0,
      forceVariety: false,
      preferBrevity: true,
      cueMatch: '',
      modeBrief: '',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      validationCheck: '',
      breatheHint: '',
    }
  }

  const cue = matchShortCue(userMessage)
  const scores = scoreModes({
    userMessage,
    recent: recentModes,
    cue,
    intent,
    leadership,
    deepThinking,
    presence,
  })
  const seed = `${userMessage}|${recentModes.join(',')}|${intent?.expects || ''}`
  const picked = pickMode(scores, recentModes, seed, cue)
  const preferBrevity =
    BRIEF_MODES.has(picked.mode) ||
    Boolean(cue) ||
    Boolean(presence?.preferBrevity) ||
    userMessage.split(/\s+/).length <= 3

  /** @type {ResponseModePlan} */
  const plan = {
    active: true,
    mode: picked.mode,
    candidates: picked.candidates,
    recentModes,
    consecutiveSame: consecutiveCount(recentModes, picked.mode),
    forceVariety: picked.forceVariety,
    preferBrevity,
    cueMatch: cue?.id || '',
    modeBrief: '',
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    signals: [
      `mode_${picked.mode}`,
      cue ? `cue_${cue.id}` : 'no_short_cue',
      picked.forceVariety ? 'variety_pressure' : 'fresh_enough',
      preferBrevity ? 'prefer_brevity' : 'full_mode',
    ],
    reasons: [
      `how_${picked.mode}`,
      cue ? `matched_${cue.id}` : 'scored_pick',
      recentModes.length
        ? `avoid_stack_${recentModes[recentModes.length - 1] || 'none'}`
        : 'first_mode',
      'conversation_breathes',
    ],
    confidence: cue || DISTRESS_RE.test(userMessage) || HARD_TASK_RE.test(userMessage)
      ? 'high'
      : picked.candidates[0] === picked.mode
        ? 'high'
        : 'medium',
    language,
    validationCheck:
      'Did I choose HOW to respond (mode), avoid stacking the same mode (esp. Explanation), and match short cues with short postures?',
    breatheHint:
      'The conversation should breathe — vary posture across turns; never Explanation→Explanation→Explanation…',
  }
  plan.modeBrief = modeBrief(picked.mode, language, {
    preferBrevity,
    cueId: cue?.id || '',
  })
  plan.structureLine = `Response Mode → ${MODE_LABELS[picked.mode]}${preferBrevity ? ' · brief' : ''}${cue ? ` · cue ${cue.id}` : ''} · breathe`
  plan.responseHints = [
    `Mode=${MODE_LABELS[picked.mode]}`,
    plan.modeBrief,
    preferBrevity ? 'Keep it short — do not dump an explanation.' : 'Develop in this mode only.',
    plan.breatheHint,
  ]
  plan.writerBrief = buildWriterBrief(plan)
  return plan
}

/**
 * @param {ResponseModePlan | null | undefined} plan
 */
export function formatResponseModeForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
RESPONSE MODE ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · mode=${plan.mode} · brevity=${plan.preferBrevity ? 'yes' : 'no'} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: scegli HOW non solo WHAT · varia i modi · niente Explanation a catena · cue brevi → posture brevi · non citare il motore.`.trim()
}

/**
 * @param {ResponseModePlan | null | undefined} plan
 * @returns {string[]}
 */
export function responseModeStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(`Respond in mode: ${MODE_LABELS[plan.mode]}`)
  if (plan.preferBrevity) hints.push('Short user cue → short mode (no long explanation)')
  hints.push(plan.breatheHint)
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect if draft looks like a stacked explanation when another mode was chosen.
 * @param {string} text
 */
function looksLikeLongExplanation(text) {
  const t = String(text || '').trim()
  if (t.length < 220) return false
  const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 12)
  if (sentences.length < 4) return false
  return /\b(because|perch[eé]|in\s+other\s+words|cio[eè]|basically|essentially|spiega|means\s+that|first[,.]|second[,.]|furthermore|inoltre)\b/i.test(
    t,
  )
}

/**
 * @param {string} draft
 * @param {ResponseModePlan | null | undefined} plan
 */
export function draftViolatesResponseMode(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Short-cue modes must not become long explanations
  if (
    plan.preferBrevity &&
    (plan.mode === 'celebration' ||
      plan.mode === 'reaction' ||
      plan.mode === 'listening' ||
      plan.mode === 'agreement' ||
      plan.mode === 'presence')
  ) {
    if (text.length > 320 || looksLikeLongExplanation(text)) return true
  }

  if (plan.mode === 'curiosity' && plan.preferBrevity && looksLikeLongExplanation(text)) {
    return true
  }

  if (plan.mode === 'reflection' && plan.cueMatch.includes('gia') && looksLikeLongExplanation(text)) {
    return true
  }

  if (plan.mode === 'observation' && plan.cueMatch.includes('no') && looksLikeLongExplanation(text)) {
    return true
  }

  // If we explicitly avoided explanation stacking, reject explanation-shaped dumps in other modes
  if (plan.mode !== 'explanation' && plan.forceVariety && looksLikeLongExplanation(text) && text.length > 400) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ResponseModePlan, context: string }}
 */
export function runResponseModeEngine(input = {}) {
  try {
    const plan = buildResponseModePlan(input)
    return {
      plan,
      context: formatResponseModeForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        mode: 'presence',
        candidates: [],
        recentModes: [],
        consecutiveSame: 0,
        forceVariety: false,
        preferBrevity: true,
        cueMatch: '',
        modeBrief: '',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        validationCheck: '',
        breatheHint: '',
      },
      context: '',
    }
  }
}
