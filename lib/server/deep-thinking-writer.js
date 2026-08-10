/**
 * LAIfe Deep Thinking Writer
 *
 * Mission: the assistant should never produce the first acceptable answer.
 * Before writing, expand internal reasoning into a structured conversational
 * response built from multiple layers.
 *
 * Layers:
 *   1. Direct reaction
 *   2. Main idea
 *   3. Interesting explanation
 *   4. Example or analogy
 *   5. Reflection or continuation
 *
 * Conversation Depth Score (0–5):
 *   0 one sentence · 1 simple · 2 developed · 3 rich · 4 layered · 5 memorable
 * Target: Depth ≥ 3 whenever appropriate.
 *
 * Quality: every answer should contain at least two of
 *   explanation · observation · analogy · example · reflection · curiosity
 * Avoid empty filler. Avoid one-paragraph replies when depth is natural.
 *
 * Distinct from Deep Thinking Engine (chooses direction).
 * This stage shapes how that direction is written.
 *
 * Runs AFTER: Deep Thinking Engine (when present)
 * Runs BEFORE: Writer / WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} WriterLang
 */

/**
 * @typedef {'reaction'|'main_idea'|'explanation'|'example_or_analogy'|'reflection_or_continuation'} WriterLayer
 */

/**
 * @typedef {'explanation'|'observation'|'analogy'|'example'|'reflection'|'curiosity'} QualityElement
 */

/**
 * @typedef {object} LayerPlan
 * @property {WriterLayer} id
 * @property {string} label
 * @property {boolean} required
 * @property {string} cue
 */

/**
 * @typedef {object} DeepThinkingWriterPlan
 * @property {boolean} active
 * @property {boolean} requireLayers
 * @property {number} depthScore 0–5 estimated target
 * @property {number} minDepth target floor (usually 3 when appropriate)
 * @property {LayerPlan[]} layers
 * @property {QualityElement[]} requiredElements
 * @property {string[]} structureOrder
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {WriterLang} language
 * @property {string} validationCheck
 * @property {string} antiFiller
 * @property {boolean} allowShallow
 */

/** @type {WriterLayer[]} */
const ALL_LAYERS = Object.freeze([
  'reaction',
  'main_idea',
  'explanation',
  'example_or_analogy',
  'reflection_or_continuation',
])

const LAYER_LABELS = Object.freeze({
  reaction: 'Direct reaction',
  main_idea: 'Main idea',
  explanation: 'Interesting explanation',
  example_or_analogy: 'Example or analogy',
  reflection_or_continuation: 'Reflection or continuation',
})

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const SHORT_ACK_RE =
  /^(ok+|okay|k|yes|yep|yeah|si+|sì|no|nope|nice|cool|thanks|thank\s+you|grazie|capito|got\s+it|sure|fine|bene|certo|boh|mah|maybe|forse)([\s!.]*)$/i

const STOP_RE =
  /^(basta|stop|fine|bye|arrivederci|buonanotte|done|that'?s\s+all|a\s+dopo)([\s!,.]|$)/i

const DEPTH_TOPIC_RE =
  /\b(ai|intelligenza\s+artificiale|filosof|philosoph|scienz|science|psico|psycholog|storia|history|societ|culture|cultura|futur|economia|econom|tecnolog|technology|relazion|relationship|creativ|meaning|senso|perch[eé]|why\b|come\s+funziona|how\s+(does|do)\b|explain|spieg)\b/i

const SHALLOW_OK_RE =
  /\b(che\s+ora\s+[eè]|what\s+time|weather|meteo|traduci|translate|calcola|quanto\s+[eè]|yes\s+or\s+no)\b/i

/** Detect thin one-liner / single-paragraph flat dumps. */
const FLAT_ONE_PARAGRAPH_RE =
  /^[^\n]{12,280}$/

const EMPTY_FILLER_RE =
  /\b(ai\s+is\s+changing\s+the\s+world|l'?ia\s+(sta\s+)?cambiando\s+il\s+mondo|in\s+oggi'?s\s+fast[- ]paced\s+world|nel\s+mondo\s+di\s+oggi|it\s+is\s+important\s+to\s+note|è\s+importante\s+ricordare|as\s+an\s+ai\s+language\s+model)\b/i

const ELEMENT_MARKERS = Object.freeze({
  explanation:
    /\b(because|perch[eé]|in\s+other\s+words|cio[eè]|which\s+means|il\s+punto\s+[eè]|the\s+idea\s+is|spiega|means\s+that)\b/i,
  observation:
    /\b(i\s+notice|ho\s+notato|what'?s\s+striking|ciò\s+che\s+colpisce|interestingly|curiosamente|one\s+thing\s+(that|stands))\b/i,
  analogy:
    /\b(like\s+a\s+|come\s+un[oa]?\s+|analog|simile\s+a|it'?s\s+as\s+if|è\s+come\s+se|think\s+of\s+it\s+as)\b/i,
  example:
    /\b(for\s+example|ad\s+esempio|per\s+esempio|e\.g\.|say\s+|prendi|take\s+|instance|caso)\b/i,
  reflection:
    /\b(makes\s+me\s+(think|wonder)|mi\s+fa\s+pensare|in\s+the\s+end|alla\s+fine|maybe\s+the\s+deeper|forse\s+il\s+punto\s+pi[uù]|what\s+stays\s+with\s+me)\b/i,
  curiosity:
    /\b(i'?m\s+curious|mi\s+incuriosisce|wonder|chiedo|what\s+if|e\s+se\b|have\s+you\s+noticed|ti\s+[eè]\s+mai\s+capitato)\b/i,
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
      content: String(/** @type {{ content?: string }} */ (m).content || '').trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @param {object} input
 * @returns {WriterLang}
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
 * @param {WriterLayer} id
 * @param {WriterLang} lang
 * @param {object} ctx
 */
function layerCue(id, lang, ctx) {
  const dir = String(ctx.direction || '')
  const topic = String(ctx.topic || 'this').slice(0, 80)
  if (lang === 'en') {
    const map = {
      reaction: `Open with a direct human reaction to what they said — not “Great!” filler.`,
      main_idea: `State the main idea clearly once (direction cue: ${dir || 'natural'}).`,
      explanation: `Add one interesting explanation — why it matters / how it works — without encyclopedia tone.`,
      example_or_analogy: `Give one concrete example or analogy tied to «${topic}».`,
      reflection_or_continuation: `Close with a reflection or natural continuation — invite thought, don’t interview.`,
    }
    return map[id]
  }
  const map = {
    reaction: `Apri con una reazione umana diretta a ciò che hanno detto — niente filler tipo “Ottimo!”.`,
    main_idea: `Enuncia UNA idea principale chiara (direzione: ${dir || 'naturale'}).`,
    explanation: `Aggiungi una spiegazione interessante — perché conta / come funziona — senza tono enciclopedico.`,
    example_or_analogy: `Dai UN esempio concreto o un’analogia legata a «${topic}».`,
    reflection_or_continuation: `Chiudi con riflessione o continuazione naturale — invita il pensiero, non intervistare.`,
  }
  return map[id]
}

/**
 * Decide whether layered depth is appropriate.
 * @param {object} input
 */
function assessDepthNeed(input = {}) {
  const msg = String(input.userMessage || '').trim()
  /** @type {string[]} */
  const signals = []
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || null
  const deepThinking =
    input.deepThinking?.plan || input.deepThinking || null
  const opportunity =
    input.conversationOpportunity?.plan || input.conversationOpportunity || null

  if (!msg || STOP_RE.test(msg) || DISTRESS_RE.test(msg)) {
    return {
      requireLayers: false,
      allowShallow: true,
      minDepth: 1,
      depthScore: 1,
      confidence: /** @type {const} */ ('high'),
      signals: ['stop_or_distress'],
      reasons: ['presence_or_close'],
    }
  }

  if (HARD_TASK_RE.test(msg) || leadership?.move === 'remain_concise') {
    signals.push('hard_task_or_concise')
    return {
      requireLayers: false,
      allowShallow: true,
      minDepth: 2,
      depthScore: 2,
      confidence: /** @type {const} */ ('high'),
      signals,
      reasons: ['clarity_over_layers'],
    }
  }

  if (SHORT_ACK_RE.test(msg) && asTurns(input.messages).length > 1) {
    // Short acks ("ok", "thanks") — do not force five-layer depth
    signals.push('short_ack')
    return {
      requireLayers: false,
      allowShallow: true,
      minDepth: 1,
      depthScore: 1,
      confidence: /** @type {const} */ ('high'),
      signals,
      reasons: ['short_ack_proportionate'],
    }
  }

  if (SHALLOW_OK_RE.test(msg)) {
    return {
      requireLayers: false,
      allowShallow: true,
      minDepth: 1,
      depthScore: 1,
      confidence: /** @type {const} */ ('high'),
      signals: ['factual_micro'],
      reasons: ['micro_answer_ok'],
    }
  }

  const expects = String(intent?.expects || '')
  const curiosity = String(intent?.curiosityLevel || '')
  const openTopic = DEPTH_TOPIC_RE.test(msg) || expects === 'exploration' || curiosity === 'high'
  const teaching =
    /\b(spieg|explain|cos'?[eè]|what\s+is|come\s+funziona|how\s+does|perch)\b/i.test(msg)
  const deepDir = String(deepThinking?.direction || '')
  const richDirection =
    /elegant_explanation|meaningful_comparison|memorable_example|concise_story|surprising_insight|observation/.test(
      deepDir,
    )

  let depthScore = 2
  /** @type {string[]} */
  const reasons = []

  if (openTopic) {
    depthScore += 1
    reasons.push('open_topic')
    signals.push('open_topic')
  }
  if (teaching) {
    depthScore += 1
    reasons.push('teaching')
    signals.push('teaching')
  }
  if (richDirection) {
    depthScore += 1
    reasons.push(`deep_dir_${deepDir}`)
    signals.push('rich_direction')
  }
  if (expects === 'companionship' || opportunity?.initiativeAllowed) {
    depthScore += 0.5
    reasons.push('conversational_space')
  }
  if (msg.split(/\s+/).length >= 12) {
    depthScore += 0.5
    reasons.push('substantive_user_turn')
  }

  depthScore = Math.max(0, Math.min(5, Math.round(depthScore)))
  // Target ≥ 3 whenever appropriate
  const requireLayers = depthScore >= 3 || openTopic || teaching || richDirection
  const minDepth = requireLayers ? Math.max(3, depthScore) : Math.max(1, depthScore)
  const finalDepth = requireLayers ? Math.max(3, depthScore) : depthScore

  return {
    requireLayers,
    allowShallow: !requireLayers,
    minDepth,
    depthScore: finalDepth,
    confidence: requireLayers ? /** @type {const} */ ('high') : /** @type {const} */ ('medium'),
    signals: signals.length ? signals : ['default_depth'],
    reasons: reasons.length ? reasons : ['baseline'],
  }
}

/**
 * Pick which quality elements to require (≥2).
 * @param {object} need
 * @param {object} input
 * @returns {QualityElement[]}
 */
function pickRequiredElements(need, input) {
  /** @type {QualityElement[]} */
  const pool = ['explanation', 'observation', 'analogy', 'example', 'reflection', 'curiosity']
  const deepThinking = input.deepThinking?.plan || input.deepThinking || null
  const dir = String(deepThinking?.direction || '')
  /** @type {QualityElement[]} */
  const preferred = []
  if (/elegant_explanation|direct_useful/.test(dir)) preferred.push('explanation')
  if (/observation/.test(dir)) preferred.push('observation')
  if (/meaningful_comparison/.test(dir)) preferred.push('analogy')
  if (/memorable_example|concise_story/.test(dir)) preferred.push('example')
  if (/surprising_insight|warm_presence/.test(dir)) preferred.push('reflection')
  if (/curiosity|exploration/i.test(String(input.conversationIntent?.plan?.inference?.expects || ''))) {
    preferred.push('curiosity')
  }
  if (need.requireLayers) {
    preferred.push('explanation', 'example', 'reflection')
  }
  const uniq = [...new Set([...preferred, ...pool])]
  return uniq.slice(0, Math.max(2, need.requireLayers ? 3 : 2))
}

/**
 * @param {object} need
 * @param {WriterLang} lang
 * @param {object} ctx
 * @returns {LayerPlan[]}
 */
function buildLayers(need, lang, ctx) {
  /** @type {LayerPlan[]} */
  const layers = []
  for (const id of ALL_LAYERS) {
    let required = need.requireLayers
    if (!need.requireLayers) {
      // Shallow mode: still keep reaction + main idea when not micro
      required = id === 'reaction' || id === 'main_idea'
      if (need.depthScore <= 1) required = id === 'main_idea'
    } else {
      // Full stack required for depth ≥ 3
      required = true
    }
    layers.push({
      id,
      label: LAYER_LABELS[id],
      required,
      cue: layerCue(id, lang, ctx),
    })
  }
  return layers
}

/**
 * @param {DeepThinkingWriterPlan} plan
 */
function buildGuidance(plan) {
  if (!plan.requireLayers) {
    return plan.allowShallow
      ? 'Keep it clear and proportionate — depth not forced this turn.'
      : 'Develop the answer past the first acceptable line.'
  }
  return [
    'Never ship the first acceptable answer.',
    'Build: Reaction → Main idea → Explanation → Example/Analogy → Reflection/Continuation.',
    `Target Conversation Depth Score ≥ ${plan.minDepth} (planned ${plan.depthScore}).`,
    `Include at least two of: ${plan.requiredElements.join(', ')}.`,
    'Avoid empty filler and flat one-paragraph dumps when depth is natural.',
  ].join(' ')
}

/**
 * @param {DeepThinkingWriterPlan} plan
 */
function buildBrief(plan) {
  if (!plan.active) return ''
  const layerLines = plan.layers
    .filter((l) => l.required)
    .map((l, i) => `${i + 1}. ${l.label}: ${l.cue}`)
    .join(' ')

  if (!plan.requireLayers) {
    return [
      'DEEP THINKING WRITER: depth not forced this turn — stay clear and human.',
      `Planned depth≈${plan.depthScore}/5.`,
      plan.guidance,
      'Still avoid empty filler (“AI is changing the world”).',
      'NON citare Deep Thinking Writer.',
    ].join(' ')
  }

  return [
    'DEEP THINKING WRITER: non produrre la prima risposta accettabile.',
    'Espandi il ragionamento in una risposta conversazionale a strati.',
    `Depth target=${plan.depthScore}/5 (min ${plan.minDepth}).`,
    `Layers (in order): ${plan.structureOrder.join(' → ')}.`,
    layerLines,
    `Quality elements (≥2): ${plan.requiredElements.join(', ')}.`,
    'Avoid one-paragraph replies when the topic allows depth.',
    'Instead of “AI is changing the world.” → Reaction ↓ Idea ↓ Explanation ↓ Example ↓ Reflection.',
    'No empty filler. No encyclopedia dump. Keep factual accuracy.',
    `Check: ${plan.validationCheck}`,
    'NON citare Deep Thinking Writer / lo stage.',
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {DeepThinkingWriterPlan}
 */
export function buildDeepThinkingWriterPlan(input = {}) {
  const language = resolveLang(input)
  const need = assessDepthNeed(input)
  const deepThinking = input.deepThinking?.plan || input.deepThinking || null
  const topic =
    input.session?.currentTopic ||
    input.understanding?.topic ||
    input.conversationIntent?.plan?.inference?.topic ||
    String(input.userMessage || '').slice(0, 60)

  const ctx = {
    direction: deepThinking?.direction || '',
    topic,
  }
  const layers = buildLayers(need, language, ctx)
  const requiredElements = pickRequiredElements(need, input)
  const structureOrder = layers.filter((l) => l.required).map((l) => l.label)

  /** @type {DeepThinkingWriterPlan} */
  const plan = {
    active: true,
    requireLayers: need.requireLayers,
    depthScore: need.depthScore,
    minDepth: need.minDepth,
    layers,
    requiredElements,
    structureOrder,
    guidance: '',
    writerBrief: '',
    structureLine: need.requireLayers
      ? `Deep Thinking Writer → depth ${need.depthScore}/5 · layers ${structureOrder.length} · ≥2 of [${requiredElements.join(', ')}]`
      : `Deep Thinking Writer → depth ${need.depthScore}/5 · proportionate (layers not forced)`,
    signals: need.signals,
    reasons: [
      ...need.reasons,
      need.requireLayers ? 'layered_response' : 'proportionate_depth',
      deepThinking?.direction ? `from_${deepThinking.direction}` : 'no_deep_dir',
    ],
    confidence: need.confidence,
    language,
    validationCheck:
      'Did I avoid the first acceptable answer and build Reaction → Idea → Explanation → Example → Reflection when depth was appropriate?',
    antiFiller: 'No empty claims like “AI is changing the world.” without layers.',
    allowShallow: need.allowShallow,
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {DeepThinkingWriterPlan | null | undefined} plan
 */
export function formatDeepThinkingWriterForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
DEEP THINKING WRITER (INVISIBILE)
══════════════════════════════════════
Active=yes · layers=${plan.requireLayers} · depth=${plan.depthScore}/5 · min=${plan.minDepth} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: mai la prima risposta accettabile · strati quando appropriato · ≥2 elementi di qualità · niente filler · non citare il motore.`.trim()
}

/**
 * @param {DeepThinkingWriterPlan | null | undefined} plan
 * @returns {string[]}
 */
export function deepThinkingWriterStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.requireLayers) {
    hints.push(`Build layers: ${plan.structureOrder.join(' → ')}`)
    hints.push(`Depth target ≥ ${plan.minDepth}`)
    hints.push(`Include ≥2 of: ${plan.requiredElements.join(', ')}`)
  } else {
    hints.push('Proportionate depth — do not force five layers')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Count quality elements present in draft.
 * @param {string} text
 * @returns {QualityElement[]}
 */
export function detectQualityElements(text) {
  /** @type {QualityElement[]} */
  const found = []
  for (const [key, re] of Object.entries(ELEMENT_MARKERS)) {
    if (re.test(text)) found.push(/** @type {QualityElement} */ (key))
  }
  return found
}

/**
 * Estimate depth of a draft (0–5).
 * @param {string} text
 */
export function estimateDraftDepth(text) {
  const t = String(text || '').trim()
  if (!t) return 0
  const sentences = t.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 8)
  const paras = t.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const elements = detectQualityElements(t)
  let score = 0
  if (sentences.length <= 1 && t.length < 120) score = 0
  else if (sentences.length <= 2 && paras.length <= 1) score = 1
  else if (sentences.length <= 4 && elements.length < 2) score = 2
  else if (elements.length >= 2 && sentences.length >= 4) score = 3
  else score = 2

  if (elements.length >= 3 && (paras.length >= 2 || sentences.length >= 5)) score = Math.max(score, 4)
  if (elements.length >= 4 && sentences.length >= 6 && paras.length >= 2) score = 5
  // Layer-ish structure cues
  if (paras.length >= 3 && elements.length >= 2) score = Math.max(score, 4)
  return Math.max(0, Math.min(5, score))
}

/**
 * @param {string} draft
 * @param {DeepThinkingWriterPlan | null | undefined} plan
 */
export function draftViolatesDeepThinkingWriter(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (EMPTY_FILLER_RE.test(text) && text.length < 220) return true

  if (!plan.requireLayers || plan.allowShallow) {
    // Soft: only reject empty filler slogans
    return false
  }

  const depth = estimateDraftDepth(text)
  if (depth < plan.minDepth) return true

  const found = detectQualityElements(text)
  if (found.length < 2) return true

  // One flat paragraph when layers were required and text is medium-long
  if (FLAT_ONE_PARAGRAPH_RE.test(text) && !/\n/.test(text) && text.length > 160) {
    // Allow if rich elements somehow packed in — still prefer multi-beat
    if (found.length < 3) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: DeepThinkingWriterPlan, context: string }}
 */
export function runDeepThinkingWriter(input = {}) {
  try {
    const plan = buildDeepThinkingWriterPlan(input)
    return {
      plan,
      context: formatDeepThinkingWriterForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        requireLayers: false,
        depthScore: 0,
        minDepth: 0,
        layers: [],
        requiredElements: [],
        structureOrder: [],
        guidance: '',
        writerBrief: '',
        structureLine: null,
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        validationCheck: '',
        antiFiller: '',
        allowShallow: true,
      },
      context: '',
    }
  }
}
