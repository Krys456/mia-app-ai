/**
 * LAIfe Reasoning Expansion Engine
 *
 * Mission: expand ideas — do not merely answer questions.
 *
 * Before writing, internally build a reasoning tree. Every substantial
 * response should include:
 *   1. Direct reaction to the user's message
 *   2. Core idea
 *   3. Why that idea matters
 *   4. One concrete example, analogy, or scenario
 *   5. A broader implication or reflection
 *
 * Avoid changing subject just to create length.
 * Depth must come from developing the CURRENT topic.
 *
 * Internal check before send:
 *   "Have I explored this idea, or have I merely mentioned it?"
 *   If merely mentioned → expand the reasoning.
 *
 * Quality goal: the reader finishes with
 *   "I've learned something, but it also made me think."
 * Not: "That was a longer version of the same answer."
 *
 * Distinct from Deep Thinking Writer (layered conversational craft).
 * This stage expands the reasoning tree on the active topic.
 *
 * Runs AFTER: Deep Thinking Writer (when present)
 * Runs BEFORE: Presence / Writer
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} ExpansionLang
 */

/**
 * @typedef {'reaction'|'core_idea'|'why_matters'|'concrete_example'|'broader_implication'} TreeNode
 */

/**
 * @typedef {object} ReasoningNode
 * @property {TreeNode} id
 * @property {string} label
 * @property {boolean} required
 * @property {string} cue
 */

/**
 * @typedef {object} ReasoningExpansionPlan
 * @property {boolean} active
 * @property {boolean} requireExpansion
 * @property {boolean} allowShallow
 * @property {string} topicAnchor current topic to develop (never abandon for length)
 * @property {ReasoningNode[]} tree
 * @property {string[]} treeOrder
 * @property {string} internalQuestion
 * @property {string} qualityGoal
 * @property {string} antiSubjectChange
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {ExpansionLang} language
 * @property {string} validationCheck
 */

/** @type {TreeNode[]} */
const ALL_NODES = Object.freeze([
  'reaction',
  'core_idea',
  'why_matters',
  'concrete_example',
  'broader_implication',
])

const NODE_LABELS = Object.freeze({
  reaction: 'Direct reaction',
  core_idea: 'Core idea',
  why_matters: 'Why it matters',
  concrete_example: 'Concrete example / analogy / scenario',
  broader_implication: 'Broader implication / reflection',
})

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|abuse|violenza)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|error\s+stack|sql|api\s+key|json\s+schema|unit\s+test|compila|compile|formattato|bullet\s+list|elenco\s+numerato|traduci|translate\s+this)\b/i

const SHORT_ACK_RE =
  /^(ok+|okay|k|yes|yep|yeah|si+|sì|no|nope|nice|cool|thanks|thank\s+you|grazie|capito|got\s+it|sure|fine|bene|certo|boh|mah|maybe|forse)([\s!.]*)$/i

const STOP_RE =
  /^(basta|stop|fine|bye|arrivederci|buonanotte|done|that'?s\s+all|a\s+dopo)([\s!,.]|$)/i

const SHALLOW_OK_RE =
  /\b(che\s+ora\s+[eè]|what\s+time|weather|meteo|traduci|translate|calcola|quanto\s+[eè]|yes\s+or\s+no)\b/i

const WANTS_DETAIL_RE =
  /\b(more\s+detail|pi[uù]\s+dettagl|approfond|go\s+deeper|expand|spiega\s+meglio|pi[uù]\s+profondo|too\s+shallow|troppo\s+superficiale|wish\s+.{0,40}detailed|vorrei\s+.{0,40}dettagl)\b/i

const EXPANDABLE_TOPIC_RE =
  /\b(ai|intelligenza\s+artificiale|filosof|philosoph|scienz|science|psico|psycholog|storia|history|societ|culture|cultura|futur|economia|econom|tecnolog|technology|relazion|relationship|creativ|meaning|senso|perch[eé]|why\b|come\s+funziona|how\s+(does|do)\b|explain|spieg|conversaz|conversation|idea|pensiero|thought)\b/i

/** Topic-jump / length-padding openers to reject when expansion required. */
const SUBJECT_CHANGE_RE =
  /\b(let'?s\s+talk\s+about|parliamo\s+di|changing\s+(the\s+)?subject|cambiando\s+argomento|on\s+another\s+note|a\s+proposito\s+di\s+altro|completely\s+unrelated|del\s+tutto\s+non\s+correlato)\b/i

const MERE_MENTION_FLAT_RE =
  /^[^\n]{20,220}$/

const NODE_MARKERS = Object.freeze({
  reaction:
    /\b(that\s+(lands|hits|reads)|capisco|sento\s+che|fair\s+point|punto\s+giusto|i\s+hear|ti\s+ascolto|yeah[,.]?\s+that|s[iì][,.]?\s+quel)\b/i,
  core_idea:
    /\b(the\s+(core|real|main)\s+(idea|point|shift)|il\s+punto\s+(centrale|vero)|l'?idea\s+(centrale|vera)|essentially|in\s+fondo)\b/i,
  why_matters:
    /\b(matters\s+because|perch[eé]\s+(conta|importa)|why\s+(it\s+)?matters|il\s+motivo\s+[eè]|this\s+matters|questo\s+conta)\b/i,
  concrete_example:
    /\b(for\s+example|ad\s+esempio|per\s+esempio|like\s+a\s+|come\s+un[oa]?\s+|imagine|immagina|scenario|analog)\b/i,
  broader_implication:
    /\b(what\s+(this|that)\s+(implies|suggests)|implicazione|pi[uù]\s+in\s+generale|broader|in\s+the\s+end|alla\s+fine|makes\s+(us|me)\s+think|fa\s+(riflettere|pensare))\b/i,
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
 * @returns {ExpansionLang}
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
 * @param {object} input
 */
function resolveTopicAnchor(input = {}) {
  const fromSession = String(input.session?.currentTopic || '').trim()
  const fromUnderstanding = String(input.understanding?.topic || '').trim()
  const fromIntent = String(
    input.conversationIntent?.plan?.inference?.topic ||
      input.conversationIntent?.inference?.topic ||
      '',
  ).trim()
  const msg = String(input.userMessage || '').trim()
  const anchor = fromSession || fromUnderstanding || fromIntent || msg.slice(0, 90)
  return anchor.replace(/\s+/g, ' ').slice(0, 100) || 'the current topic'
}

/**
 * @param {TreeNode} id
 * @param {ExpansionLang} lang
 * @param {{ topic: string }} ctx
 */
function nodeCue(id, lang, ctx) {
  const topic = String(ctx.topic || 'this').slice(0, 80)
  if (lang === 'en') {
    const map = {
      reaction: `React directly to what they said about «${topic}» — not a generic opener.`,
      core_idea: `State ONE core idea that develops «${topic}» — do not hop subjects.`,
      why_matters: `Explain why that idea matters for THIS conversation — cause → consequence, not padding.`,
      concrete_example: `Give ONE concrete example, analogy, or scenario still anchored to «${topic}».`,
      broader_implication: `Close with a broader implication or reflection that grows from the same idea — invite thought, don’t change topic.`,
    }
    return map[id]
  }
  const map = {
    reaction: `Reagisci direttamente a ciò che hanno detto su «${topic}» — niente opener generico.`,
    core_idea: `Enuncia UNA idea centrale che sviluppa «${topic}» — non cambiare argomento.`,
    why_matters: `Spiega perché quell’idea conta in QUESTA conversazione — causa → conseguenza, non riempitivo.`,
    concrete_example: `Dai UN esempio concreto, analogia o scenario ancora ancorato a «${topic}».`,
    broader_implication: `Chiudi con implicazione o riflessione più ampia nata dalla stessa idea — invita il pensiero, non cambiare tema.`,
  }
  return map[id]
}

/**
 * Decide whether reasoning expansion is appropriate.
 * @param {object} input
 */
function assessExpansionNeed(input = {}) {
  const msg = String(input.userMessage || '').trim()
  /** @type {string[]} */
  const signals = []
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || null
  const deepThinking = input.deepThinking?.plan || input.deepThinking || null
  const deepThinkingWriter =
    input.deepThinkingWriter?.plan || input.deepThinkingWriter || null

  if (!msg || STOP_RE.test(msg) || DISTRESS_RE.test(msg)) {
    return {
      requireExpansion: false,
      allowShallow: true,
      confidence: /** @type {const} */ ('high'),
      signals: ['stop_or_distress'],
      reasons: ['presence_or_close'],
    }
  }

  if (HARD_TASK_RE.test(msg) || leadership?.move === 'remain_concise') {
    signals.push('hard_task_or_concise')
    return {
      requireExpansion: false,
      allowShallow: true,
      confidence: /** @type {const} */ ('high'),
      signals,
      reasons: ['clarity_over_expansion'],
    }
  }

  if (SHORT_ACK_RE.test(msg) && asTurns(input.messages).length > 1) {
    return {
      requireExpansion: false,
      allowShallow: true,
      confidence: /** @type {const} */ ('high'),
      signals: ['short_ack'],
      reasons: ['short_ack_proportionate'],
    }
  }

  if (SHALLOW_OK_RE.test(msg)) {
    return {
      requireExpansion: false,
      allowShallow: true,
      confidence: /** @type {const} */ ('high'),
      signals: ['factual_micro'],
      reasons: ['micro_answer_ok'],
    }
  }

  /** @type {string[]} */
  const reasons = []
  const expects = String(intent?.expects || '')
  const curiosity = String(intent?.curiosityLevel || '')
  const wantsDetail = WANTS_DETAIL_RE.test(msg)
  const expandable =
    EXPANDABLE_TOPIC_RE.test(msg) ||
    expects === 'exploration' ||
    curiosity === 'high' ||
    wantsDetail
  const teaching =
    /\b(spieg|explain|cos'?[eè]|what\s+is|come\s+funziona|how\s+does|perch|why\b)\b/i.test(msg)
  const richDirection = /elegant_explanation|meaningful_comparison|memorable_example|concise_story|surprising_insight|observation/.test(
    String(deepThinking?.direction || ''),
  )
  const writerLayers = Boolean(deepThinkingWriter?.requireLayers)

  if (wantsDetail) {
    reasons.push('user_wants_detail')
    signals.push('wants_detail')
  }
  if (expandable) {
    reasons.push('expandable_topic')
    signals.push('expandable_topic')
  }
  if (teaching) {
    reasons.push('teaching')
    signals.push('teaching')
  }
  if (richDirection) {
    reasons.push('rich_deep_direction')
    signals.push('rich_direction')
  }
  if (writerLayers) {
    reasons.push('cooperates_deep_thinking_writer')
    signals.push('dtw_layers')
  }
  if (msg.split(/\s+/).length >= 8) {
    reasons.push('substantive_user_turn')
    signals.push('substantive')
  }

  const requireExpansion =
    wantsDetail || expandable || teaching || richDirection || writerLayers || msg.split(/\s+/).length >= 10

  return {
    requireExpansion,
    allowShallow: !requireExpansion,
    confidence: requireExpansion
      ? /** @type {const} */ ('high')
      : /** @type {const} */ ('medium'),
    signals: signals.length ? signals : ['default_expansion'],
    reasons: reasons.length ? reasons : ['baseline'],
  }
}

/**
 * @param {object} need
 * @param {ExpansionLang} lang
 * @param {{ topic: string }} ctx
 * @returns {ReasoningNode[]}
 */
function buildTree(need, lang, ctx) {
  /** @type {ReasoningNode[]} */
  const tree = []
  for (const id of ALL_NODES) {
    let required = need.requireExpansion
    if (!need.requireExpansion) {
      required = id === 'reaction' || id === 'core_idea'
      if (need.allowShallow && need.signals?.includes('factual_micro')) {
        required = id === 'core_idea'
      }
    }
    tree.push({
      id,
      label: NODE_LABELS[id],
      required,
      cue: nodeCue(id, lang, ctx),
    })
  }
  return tree
}

/**
 * @param {ReasoningExpansionPlan} plan
 */
function buildGuidance(plan) {
  if (!plan.requireExpansion) {
    return plan.allowShallow
      ? 'Stay clear and proportionate — full reasoning tree not forced this turn. Still avoid empty subject changes.'
      : 'Develop the idea past a mere mention when natural.'
  }
  return [
    'Expand ideas — do not merely answer.',
    'Build an internal reasoning tree on the CURRENT topic only.',
    'Include: Reaction → Core idea → Why it matters → Example/analogy/scenario → Broader implication.',
    `Topic anchor: «${plan.topicAnchor}» — never change subject just to create length.`,
    plan.internalQuestion,
    `Quality: ${plan.qualityGoal}`,
  ].join(' ')
}

/**
 * @param {ReasoningExpansionPlan} plan
 */
function buildBrief(plan) {
  if (!plan.active) return ''
  const nodeLines = plan.tree
    .filter((n) => n.required)
    .map((n, i) => `${i + 1}. ${n.label}: ${n.cue}`)
    .join(' ')

  if (!plan.requireExpansion) {
    return [
      'REASONING EXPANSION: tree not forced this turn — stay clear and on-topic.',
      `Topic anchor: «${plan.topicAnchor}».`,
      plan.guidance,
      'Never pad with a new subject (“Let’s talk about music…”).',
      'NON citare Reasoning Expansion Engine.',
    ].join(' ')
  }

  return [
    'REASONING EXPANSION ENGINE: espandi idee — non limitarti a rispondere.',
    'Prima di scrivere: costruisci un albero di ragionamento INTERNO sul tema corrente.',
    `Topic anchor (NON abbandonare): «${plan.topicAnchor}».`,
    `Tree: ${plan.treeOrder.join(' → ')}.`,
    nodeLines,
    `Internal check: ${plan.internalQuestion}`,
    'If merely mentioned → expand. Depth from developing THIS idea, not length or subject change.',
    'BAD: “Let’s talk about music…” when they asked for more detail.',
    'GOOD: explain why answers feel shallow, how humans develop ideas, how you intend to improve — still on their request.',
    `Quality goal: ${plan.qualityGoal}`,
    `Anti-subject-change: ${plan.antiSubjectChange}`,
    `Check: ${plan.validationCheck}`,
    'NON citare Reasoning Expansion / lo stage.',
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {ReasoningExpansionPlan}
 */
export function buildReasoningExpansionPlan(input = {}) {
  const language = resolveLang(input)
  const need = assessExpansionNeed(input)
  const topicAnchor = resolveTopicAnchor(input)
  const ctx = { topic: topicAnchor }
  const tree = buildTree(need, language, ctx)
  const treeOrder = tree.filter((n) => n.required).map((n) => n.label)

  /** @type {ReasoningExpansionPlan} */
  const plan = {
    active: true,
    requireExpansion: need.requireExpansion,
    allowShallow: need.allowShallow,
    topicAnchor,
    tree,
    treeOrder,
    internalQuestion:
      'Have I explored this idea, or have I merely mentioned it?',
    qualityGoal:
      'Reader feels: “I\'ve learned something, but it also made me think.” — not a longer version of the same answer.',
    antiSubjectChange:
      'Never change subject just to create length. Depth = develop the current topic.',
    guidance: '',
    writerBrief: '',
    structureLine: need.requireExpansion
      ? `Reasoning Expansion → expand «${topicAnchor.slice(0, 48)}» · tree ${treeOrder.length} nodes · explore ≠ mention`
      : `Reasoning Expansion → proportionate on «${topicAnchor.slice(0, 48)}» (tree not forced)`,
    signals: need.signals,
    reasons: [
      ...need.reasons,
      need.requireExpansion ? 'expand_current_topic' : 'proportionate_expansion',
      `anchor_${topicAnchor.slice(0, 24).replace(/\s+/g, '_')}`,
    ],
    confidence: need.confidence,
    language,
    validationCheck:
      'Did I explore the idea on the current topic (reaction → core → why → example → implication), or only mention it / jump subjects?',
  }
  plan.guidance = buildGuidance(plan)
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {ReasoningExpansionPlan | null | undefined} plan
 */
export function formatReasoningExpansionForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
REASONING EXPANSION ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · expand=${plan.requireExpansion} · topic«${plan.topicAnchor}» · confidence=${plan.confidence}

${plan.writerBrief}

Regole: espandi idee · albero sul tema corrente · no cambio argomento per lunghezza · explored ≠ mentioned · non citare il motore.`.trim()
}

/**
 * @param {ReasoningExpansionPlan | null | undefined} plan
 * @returns {string[]}
 */
export function reasoningExpansionStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.requireExpansion) {
    hints.push(`Reasoning tree: ${plan.treeOrder.join(' → ')}`)
    hints.push(`Stay on topic: «${plan.topicAnchor}»`)
    hints.push(plan.internalQuestion)
  } else {
    hints.push('Proportionate expansion — do not force the full tree')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect which tree nodes appear present in a draft.
 * @param {string} text
 * @returns {TreeNode[]}
 */
export function detectExpandedNodes(text) {
  /** @type {TreeNode[]} */
  const found = []
  for (const [key, re] of Object.entries(NODE_MARKERS)) {
    if (re.test(text)) found.push(/** @type {TreeNode} */ (key))
  }
  return found
}

/**
 * Heuristic: draft only mentions vs explores.
 * @param {string} text
 * @returns {'explored'|'merely_mentioned'|'empty'}
 */
export function assessExplorationDepth(text) {
  const t = String(text || '').trim()
  if (!t) return 'empty'
  const sentences = t
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
  const paras = t.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const nodes = detectExpandedNodes(t)
  if (nodes.length >= 3 && (sentences.length >= 4 || paras.length >= 2)) return 'explored'
  if (nodes.length >= 2 && sentences.length >= 5) return 'explored'
  return 'merely_mentioned'
}

/**
 * @param {string} draft
 * @param {ReasoningExpansionPlan | null | undefined} plan
 */
export function draftViolatesReasoningExpansion(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject subject-change padding when we had a real topic
  if (plan.requireExpansion && SUBJECT_CHANGE_RE.test(text)) return true

  if (!plan.requireExpansion || plan.allowShallow) {
    return false
  }

  if (assessExplorationDepth(text) === 'merely_mentioned') return true

  const nodes = detectExpandedNodes(text)
  // Need signal of why/example/implication — not just a longer restatement
  const depthSignals = nodes.filter((n) =>
    n === 'why_matters' || n === 'concrete_example' || n === 'broader_implication',
  )
  if (depthSignals.length < 1 && text.length > 120) {
    // Flat restatement without expansion markers
    if (MERE_MENTION_FLAT_RE.test(text) && !/\n/.test(text)) return true
    if (nodes.length < 2) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ReasoningExpansionPlan, context: string }}
 */
export function runReasoningExpansionEngine(input = {}) {
  try {
    const plan = buildReasoningExpansionPlan(input)
    return {
      plan,
      context: formatReasoningExpansionForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        requireExpansion: false,
        allowShallow: true,
        topicAnchor: '',
        tree: [],
        treeOrder: [],
        internalQuestion: '',
        qualityGoal: '',
        antiSubjectChange: '',
        guidance: '',
        writerBrief: '',
        structureLine: null,
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        validationCheck: '',
      },
      context: '',
    }
  }
}
