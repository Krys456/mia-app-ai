/**
 * LAIfe Human Conversation Score
 *
 * Mission: every generated response receives an internal score from 0 to 100.
 *
 * Evaluate:
 *   - Naturalness
 *   - Emotional coherence
 *   - Curiosity
 *   - Conversation continuity
 *   - Topic diversity
 *   - Reaction quality
 *   - Language consistency
 *   - Repetition
 *   - Human rhythm
 *   - Engagement
 *
 * If score < 85 → automatically rewrite.
 * Return only the final version.
 * Never expose the score or the rubric to the user.
 *
 * Soft advisor (pre-Writer) + pre-send gate (shared one-pass refine budget).
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
 * @typedef {'en'|'it'} ScoreLang
 */

/**
 * @typedef {'naturalness'|'emotional_coherence'|'curiosity'|'conversation_continuity'|'topic_diversity'|'reaction_quality'|'language_consistency'|'repetition'|'human_rhythm'|'engagement'} ScoreDimensionId
 */

/**
 * @typedef {object} DimensionScore
 * @property {ScoreDimensionId} id
 * @property {string} label
 * @property {number} score 0–10
 * @property {string} note
 */

/**
 * @typedef {object} HumanConversationScoreResult
 * @property {number} total 0–100
 * @property {DimensionScore[]} dimensions
 * @property {boolean} pass  total >= PASS_THRESHOLD
 * @property {string[]} weak  dimension ids below 7
 * @property {string[]} reasons
 * @property {string[]} signals
 */

/**
 * @typedef {object} HumanConversationScorePlan
 * @property {boolean} active
 * @property {number} passThreshold
 * @property {string[]} dimensions
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ScoreLang} language
 * @property {string} validationCheck
 */

/**
 * @typedef {object} HumanConversationScoreGate
 * @property {HumanConversationScoreResult} result
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} reasons
 */

/** Hard rewrite bar — below this, rewrite once. */
export const HUMAN_CONVERSATION_PASS_THRESHOLD = 85

const DIMENSION_LABELS = Object.freeze({
  naturalness: 'Naturalness',
  emotional_coherence: 'Emotional coherence',
  curiosity: 'Curiosity',
  conversation_continuity: 'Conversation continuity',
  topic_diversity: 'Topic diversity',
  reaction_quality: 'Reaction quality',
  language_consistency: 'Language consistency',
  repetition: 'Repetition',
  human_rhythm: 'Human rhythm',
  engagement: 'Engagement',
})

/** @type {ScoreDimensionId[]} */
const DIMENSION_IDS = Object.keys(DIMENSION_LABELS)

const ROBOTIC =
  /\b(as an ai|come intelligenza artificiale|i'?m (just )?an? (ai|language model)|come posso aiutarti|how can i help you today|let me know if you (need|have)|feel free to ask|sono qui se (ti serve|hai)|anything else i can help)\b/i

const HELP_DESK =
  /\b(how can i help|come posso aiutarti|let me know\.?$|fammi sapere\.?$|if you need anything|se ti serve qualcosa|i'?m here if you|sono qui se)\b/i

const KEEP_ALIVE_Q =
  /\b(what do you think\??|would you like to (discuss|talk|explore)|what would you like to talk about|anything else\??|di cosa (vuoi|vorresti) parlare|cosa ne pensi\??|vuoi parlarne\??)\b/i

const EMOTIONAL_USER =
  /\b(anxious|ansia|stressed|stressat|sad|triste|frustrated|frustrat|scared|paura|overwhelmed|lonely|worried|preoccupat|mi sento|i feel|hurt|excited|entusias|happy|felice|angry|arrabbiat)\b/i

const EMPATHY =
  /\b(i hear you|that sounds|makes sense|ti sento|capisco|ha senso|that's heavy|è tanto|i'm with you|ci sono)\b/i

const CURIOSITY_SPARK =
  /\b(curious|wonder|interesting|fascinating|noticed|reminds me|makes me think|curios[oa]|mi chiedo|interessante|ho notato|mi fa pensare|strano come)\b/i

const REACTION =
  /\b(haha|ahah|wow|oh|mm+|huh|nice|cool|già|eh+|oh wow|ah sì|davvero)\b/i

const FILLER =
  /\b(in today's world|it is important to note|as previously mentioned|in conclusione|detto questo|per quanto riguarda)\b/i

const SCORE_EXPOSE =
  /\b(human conversation score|score\s*[:=]\s*\d{1,3}\s*\/\s*100|punteggio\s*(umano|conversazione)|internal score\s*[:=]|rubric\s*[:=]|dimension scores?)\b/i

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
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 */
function sentences(text) {
  return normalize(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * @param {string} text
 */
function tokens(text) {
  return normalize(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
}

/**
 * @param {string} a
 * @param {string} b
 */
function overlapRatio(a, b) {
  const ta = new Set(tokens(a))
  const tb = tokens(b)
  if (!ta.size || !tb.length) return 0
  let hit = 0
  for (const w of tb) if (ta.has(w)) hit++
  return hit / Math.max(3, Math.min(ta.size, 14))
}

/**
 * Clamp 0–10.
 * @param {number} n
 */
function c10(n) {
  if (!Number.isFinite(n)) return 5
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10))
}

/**
 * Score one draft across all dimensions.
 * @param {object} [input]
 * @returns {HumanConversationScoreResult}
 */
export function scoreHumanConversation(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  const priorAssistant = normalize(input.priorAssistant || '')
  const turns = asTurns(input.messages)
  /** @type {string[]} */
  const reasons = []
  /** @type {string[]} */
  const signals = []

  if (!draft) {
    return {
      total: 0,
      dimensions: DIMENSION_IDS.map((id) => ({
        id,
        label: DIMENSION_LABELS[id],
        score: 0,
        note: 'empty',
      })),
      pass: false,
      weak: [...DIMENSION_IDS],
      reasons: ['empty_draft'],
      signals: ['empty'],
    }
  }

  const words = tokens(draft).length
  const sents = sentences(draft)
  const qCount = (draft.match(/\?/g) || []).length
  const userLang = detectDominantLanguage(userMessage || draft)
  const draftLang = detectDominantLanguage(draft)
  const emoUser = EMOTIONAL_USER.test(userMessage)
  const priorOverlap = priorAssistant ? overlapRatio(priorAssistant, draft) : 0
  const userOverlap = userMessage ? overlapRatio(userMessage, draft) : 0

  // Self-repetition: repeated 4-grams
  let selfRep = 0
  const grams = []
  const toks = tokens(draft)
  for (let i = 0; i < toks.length - 3; i++) {
    grams.push(toks.slice(i, i + 4).join(' '))
  }
  if (grams.length > 4) {
    const seen = new Set()
    let dup = 0
    for (const g of grams) {
      if (seen.has(g)) dup++
      seen.add(g)
    }
    selfRep = dup / grams.length
  }

  /** @type {DimensionScore[]} */
  const dimensions = []

  // 1. Naturalness
  {
    let s = 8.5
    if (ROBOTIC.test(draft)) {
      s -= 4
      reasons.push('robotic')
      signals.push('nat_robotic')
    }
    if (HELP_DESK.test(draft)) {
      s -= 3
      reasons.push('helpdesk')
      signals.push('nat_helpdesk')
    }
    if (FILLER.test(draft)) {
      s -= 2
      signals.push('nat_filler')
    }
    if (words >= 4 && words <= 90) s += 0.5
    if (words > 180) s -= 1
    dimensions.push({
      id: 'naturalness',
      label: DIMENSION_LABELS.naturalness,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'sounds machine-like / helpdesk',
    })
  }

  // 2. Emotional coherence
  {
    let s = 8
    if (emoUser) {
      if (EMPATHY.test(draft) || REACTION.test(draft)) {
        s += 1.5
        signals.push('emo_matched')
      } else {
        s -= 3
        reasons.push('emotion_miss')
        signals.push('emo_miss')
      }
      if (words > 120 && !EMPATHY.test(draft.slice(0, 200))) s -= 1.5
    } else if (EMPATHY.test(draft) && !emoUser && words < 40) {
      // Over-empathizing on dry info ask
      s -= 0.8
    }
    dimensions.push({
      id: 'emotional_coherence',
      label: DIMENSION_LABELS.emotional_coherence,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'emotion mismatch',
    })
  }

  // 3. Curiosity
  {
    let s = 7.5
    if (CURIOSITY_SPARK.test(draft)) {
      s += 1.5
      signals.push('cur_spark')
    }
    if (KEEP_ALIVE_Q.test(draft)) {
      s -= 3.5
      reasons.push('keepalive_curiosity')
      signals.push('cur_keepalive')
    } else if (qCount === 1 && CURIOSITY_SPARK.test(draft)) {
      s += 0.5
    } else if (qCount >= 3) {
      s -= 2
      signals.push('cur_interview')
    }
    dimensions.push({
      id: 'curiosity',
      label: DIMENSION_LABELS.curiosity,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'flat or keepalive curiosity',
    })
  }

  // 4. Conversation continuity
  {
    let s = 8
    if (priorAssistant && priorOverlap < 0.05 && words > 40 && userOverlap < 0.08) {
      s -= 2.5
      reasons.push('continuity_break')
      signals.push('cont_break')
    }
    if (userOverlap >= 0.12 || (priorAssistant && priorOverlap >= 0.08 && priorOverlap < 0.45)) {
      s += 1
      signals.push('cont_thread')
    }
    if (KEEP_ALIVE_Q.test(draft) && !userMessage.includes('?')) {
      s -= 1.5
    }
    dimensions.push({
      id: 'conversation_continuity',
      label: DIMENSION_LABELS.conversation_continuity,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'drops the thread',
    })
  }

  // 5. Topic diversity (vary within thread — not stuck repeating same structure)
  {
    let s = 8
    if (priorAssistant) {
      // Nearly identical to prior → low diversity
      if (priorOverlap >= 0.55) {
        s -= 4
        reasons.push('topic_stuck')
        signals.push('div_clone')
      } else if (priorOverlap >= 0.35) {
        s -= 1.5
        signals.push('div_similar')
      } else if (priorOverlap >= 0.08 && priorOverlap < 0.3) {
        s += 1
        signals.push('div_fresh_angle')
      }
    }
    // Template-y openers repeated
    if (/^(sure[!.,]|absolutely[!.,]|of course[!.,]|certo[!.,]|assolutamente)/i.test(draft)) {
      s -= 1
    }
    dimensions.push({
      id: 'topic_diversity',
      label: DIMENSION_LABELS.topic_diversity,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'too similar / stuck',
    })
  }

  // 6. Reaction quality
  {
    let s = 7.5
    const first = sents[0] || draft.slice(0, 80)
    if (REACTION.test(first) || EMPATHY.test(first) || CURIOSITY_SPARK.test(first)) {
      s += 1.5
      signals.push('react_alive')
    }
    if (ROBOTIC.test(first) || HELP_DESK.test(first)) {
      s -= 3
      signals.push('react_dead')
    }
    if (SHORT_ACK_ONLY(userMessage) && words > 80 && !REACTION.test(first)) {
      s -= 2
      reasons.push('no_reaction_to_ack')
    }
    dimensions.push({
      id: 'reaction_quality',
      label: DIMENSION_LABELS.reaction_quality,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'weak reaction',
    })
  }

  // 7. Language consistency
  {
    let s = 9
    if (userMessage && userLang && draftLang && userLang !== draftLang) {
      // Allow some code/english terms; still penalize full language switch
      const itHeavy = (draft.match(/\b(il|la|che|non|per|una|sono|questo|quello)\b/gi) || [])
        .length
      const enHeavy = (draft.match(/\b(the|and|that|with|this|you|are|have)\b/gi) || []).length
      if ((userLang === 'it' && enHeavy > itHeavy * 2) || (userLang === 'en' && itHeavy > enHeavy * 2)) {
        s -= 4
        reasons.push('language_switch')
        signals.push('lang_mismatch')
      } else {
        s -= 1
      }
    }
    dimensions.push({
      id: 'language_consistency',
      label: DIMENSION_LABELS.language_consistency,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'language drift',
    })
  }

  // 8. Repetition (high score = low repetition)
  {
    let s = 9 - selfRep * 12 - priorOverlap * 6
    if (selfRep >= 0.12) {
      reasons.push('self_repetition')
      signals.push('rep_self')
    }
    if (priorOverlap >= 0.4) {
      reasons.push('prior_repetition')
      signals.push('rep_prior')
    }
    dimensions.push({
      id: 'repetition',
      label: DIMENSION_LABELS.repetition,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'repetitive',
    })
  }

  // 9. Human rhythm
  {
    let s = 8
    const lengths = sents.map((x) => x.split(/\s+/).length)
    if (lengths.length >= 2) {
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
      const variance =
        lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length
      if (variance < 2 && lengths.length >= 3) {
        s -= 2
        signals.push('rhythm_monotone')
      } else if (variance >= 6) {
        s += 1
        signals.push('rhythm_varied')
      }
    }
    if (words < 3) s -= 2
    if (FILLER.test(draft)) s -= 1.5
    if (/[—–…]/.test(draft) || /,\s+\w+,\s+/.test(draft)) s += 0.5
    dimensions.push({
      id: 'human_rhythm',
      label: DIMENSION_LABELS.human_rhythm,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'flat rhythm',
    })
  }

  // 10. Engagement
  {
    let s = 7.5
    if (CURIOSITY_SPARK.test(draft) || REACTION.test(draft) || /[!—]/.test(draft)) {
      s += 1.5
      signals.push('eng_alive')
    }
    if (HELP_DESK.test(draft) || KEEP_ALIVE_Q.test(draft)) {
      s -= 3
      signals.push('eng_dead')
    }
    if (words >= 8 && !qCount && CURIOSITY_SPARK.test(draft)) s += 0.5
    if (SHORT_ONLY_ACK(draft)) {
      s -= 2.5
      reasons.push('empty_ack')
    }
    dimensions.push({
      id: 'engagement',
      label: DIMENSION_LABELS.engagement,
      score: c10(s),
      note: s >= 7 ? 'ok' : 'low engagement',
    })
  }

  const totalRaw = dimensions.reduce((a, d) => a + d.score, 0)
  const total = Math.max(0, Math.min(100, Math.round(totalRaw)))
  const weak = dimensions.filter((d) => d.score < 7).map((d) => d.id)
  const pass = total >= HUMAN_CONVERSATION_PASS_THRESHOLD

  if (!pass) reasons.push(`score_${total}_below_${HUMAN_CONVERSATION_PASS_THRESHOLD}`)
  signals.push(`total_${total}`, pass ? 'pass' : 'rewrite')

  return { total, dimensions, pass, weak, reasons, signals }
}

/**
 * @param {string} text
 */
function SHORT_ACK_ONLY(text) {
  return /^(ok|okay|k|sure|fine|yes|yep|yeah|sì|si|no|nah|capito|capisco|thanks|grazie|i see)([\s!,.]*)$/i.test(
    normalize(text),
  )
}

/**
 * @param {string} text
 */
function SHORT_ONLY_ACK(text) {
  return SHORT_ACK_ONLY(text)
}

/**
 * @param {string[]} reasons
 * @returns {HumanConversationScorePlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    passThreshold: HUMAN_CONVERSATION_PASS_THRESHOLD,
    dimensions: Object.values(DIMENSION_LABELS),
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Would this reply score ≥85 as a human conversation — natural, coherent, engaging, unrehearsed?',
  }
}

/**
 * @param {HumanConversationScorePlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  return [
    'HUMAN CONVERSATION SCORE (interno — obbligatorio quando attivo):',
    `Ogni risposta sarà valutata 0–100. Soglia: ${plan.passThreshold}. Sotto soglia → riscrittura automatica.`,
    lang === 'it'
      ? 'Dimensioni: naturalezza · coerenza emotiva · curiosità · continuità · diversità di tema · qualità della reazione · coerenza di lingua · ripetizione · ritmo umano · engagement.'
      : 'Dimensions: naturalness · emotional coherence · curiosity · continuity · topic diversity · reaction quality · language consistency · repetition · human rhythm · engagement.',
    plan.guidance,
    lang === 'it'
      ? 'Punta a ≥85. Restituisci solo il testo finale. Mai citare il punteggio o la rubrica.'
      : 'Aim for ≥85. Return only the final text. Never cite the score or the rubric.',
    `Check: «${plan.validationCheck}»`,
    'Non citare Human Conversation Score / questo blocco.',
  ].join('\n')
}

/**
 * Pre-Writer plan.
 * @param {object} [input]
 * @returns {HumanConversationScorePlan}
 */
export function analyzeHumanConversationScore(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {ScoreLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const guidance =
    language === 'it'
      ? 'Scrivi come un interlocutore umano vivo: naturale, coerente emotivamente, curioso senza intervistare, continuo sul filo, ritmo vario, zero ripetizioni e zero helpdesk.'
      : 'Write like a living human interlocutor: natural, emotionally coherent, curious without interviewing, continuous on the thread, varied rhythm, zero repetition and zero helpdesk.'

  /** @type {HumanConversationScorePlan} */
  const plan = {
    active: true,
    passThreshold: HUMAN_CONVERSATION_PASS_THRESHOLD,
    dimensions: Object.values(DIMENSION_LABELS),
    guidance,
    writerBrief: '',
    structureLine: `Human Conversation Score → aim ≥${HUMAN_CONVERSATION_PASS_THRESHOLD} (silent · rewrite if below)`,
    signals: ['score_active', `threshold_${HUMAN_CONVERSATION_PASS_THRESHOLD}`],
    reasons: ['pre_write_quality_bar', 'auto_rewrite_below_threshold'],
    confidence: 'high',
    language,
    validationCheck:
      'Would this reply score ≥85 as a human conversation — natural, coherent, engaging, unrehearsed?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {HumanConversationScorePlan | null | undefined} plan
 */
export function formatHumanConversationScoreForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
HUMAN CONVERSATION SCORE (INVISIBILE)
══════════════════════════════════════
Active=yes · threshold=${plan.passThreshold} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: mira ≥${plan.passThreshold} · sotto soglia riscrivi · solo testo finale · non citare punteggio/motore.`.trim()
}

/**
 * @param {HumanConversationScorePlan | null | undefined} plan
 * @returns {string[]}
 */
export function humanConversationScoreStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(
    'Score bar: naturalness · emotion · curiosity · continuity · diversity · reaction · language · repetition · rhythm · engagement',
  )
  hints.push(`If internal score < ${plan.passThreshold} → rewrite; return only final text`)
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that expose the score / rubric.
 * @param {string} draft
 * @param {HumanConversationScorePlan | null | undefined} plan
 */
export function draftViolatesHumanConversationScore(draft, plan) {
  if (!plan?.active) return false
  const text = normalize(draft)
  if (!text) return true
  if (SCORE_EXPOSE.test(text)) return true
  if (/\b(naturalness\s*:\s*\d|emotional coherence\s*:\s*\d|engagement\s*:\s*\d\/10)\b/i.test(text)) {
    return true
  }
  return false
}

/**
 * Build refine brief from a failing score.
 * @param {HumanConversationScoreResult} result
 * @param {ScoreLang} [language]
 */
export function buildHumanConversationScoreRefineBrief(result, language = 'en') {
  const weakLabels = result.dimensions
    .filter((d) => d.score < 7.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((d) => `${d.label} (${d.score}/10)`)

  const lines = [
    language === 'it'
      ? `Human Conversation Score: ${result.total}/100 (< ${HUMAN_CONVERSATION_PASS_THRESHOLD}) — RISCRIVI automaticamente.`
      : `Human Conversation Score: ${result.total}/100 (< ${HUMAN_CONVERSATION_PASS_THRESHOLD}) — rewrite automatically.`,
    weakLabels.length
      ? language === 'it'
        ? `Punti deboli: ${weakLabels.join(' · ')}.`
        : `Weak areas: ${weakLabels.join(' · ')}.`
      : '',
    language === 'it'
      ? 'Alza naturalezza, coerenza emotiva, curiosità viva (non keep-alive), continuità del filo, reazione umana, ritmo vario; togli ripetizioni e helpdesk. Restituisci SOLO il testo finale. Non citare il punteggio.'
      : 'Raise naturalness, emotional coherence, living curiosity (not keepalive), thread continuity, human reaction, varied rhythm; cut repetition and helpdesk. Return ONLY the final text. Do not cite the score.',
  ]
  return lines.filter(Boolean).join(' ')
}

/**
 * Analyze draft and decide rewrite.
 * @param {object} [input]
 * @returns {HumanConversationScoreGate}
 */
export function analyzeHumanConversationScoreDraft(input = {}) {
  const result = scoreHumanConversation(input)
  const langCode = detectDominantLanguage(String(input.userMessage || input.draft || ''))
  /** @type {ScoreLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  if (result.pass && !SCORE_EXPOSE.test(String(input.draft || ''))) {
    return {
      result,
      needsRefine: false,
      refineBrief: '',
      reasons: ['pass', `score_${result.total}`],
    }
  }

  return {
    result,
    needsRefine: true,
    refineBrief: buildHumanConversationScoreRefineBrief(result, language),
    reasons: result.pass
      ? ['expose_score']
      : ['below_threshold', `score_${result.total}`, ...result.weak.slice(0, 3)],
  }
}

/**
 * Pre-send gate.
 * @param {object} [input]
 * @returns {{ gate: HumanConversationScoreGate, shouldRefine: boolean }}
 */
export function runHumanConversationScoreGate(input = {}) {
  try {
    const gate = analyzeHumanConversationScoreDraft(input)
    return {
      gate,
      shouldRefine: Boolean(gate.needsRefine && gate.refineBrief),
    }
  } catch {
    return {
      gate: {
        result: {
          total: 100,
          dimensions: [],
          pass: true,
          weak: [],
          reasons: ['fail_soft'],
          signals: ['fail_soft'],
        },
        needsRefine: false,
        refineBrief: '',
        reasons: ['fail_soft'],
      },
      shouldRefine: false,
    }
  }
}

/**
 * Soft advisor entry.
 * @param {object} [input]
 * @returns {{ plan: HumanConversationScorePlan, context: string }}
 */
export function runHumanConversationScoreEngine(input = {}) {
  try {
    const plan = analyzeHumanConversationScore(input)
    return {
      plan,
      context: formatHumanConversationScoreForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
