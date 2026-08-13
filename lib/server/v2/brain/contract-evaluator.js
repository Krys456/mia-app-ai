/**
 * LAIfe V2 — Contract Evaluator (Phase 5 + Phase 7 grounding)
 *
 * Post-Writer fidelity gate:
 *   A. Hard contract fidelity (Planner WHAT + resolved referent grounding)
 *   B. Adaptive delivery fidelity (HOW — clear violations only)
 *
 * Does NOT invent a new conversational move / strategy.
 * Does NOT score beauty, personality, curiosity, or satisfaction.
 * Does NOT re-resolve references (uses Conversation State only).
 * At most ONE constrained rewrite (HOW only).
 */

import { responseContradictsReferent } from './reference-resolution.js'

export const CONTRACT_EVALUATOR_VERSION = '2.1.0-contract-evaluator'

/**
 * @typedef {object} ContractViolation
 * @property {string} code
 * @property {string} message
 * @property {'hard'|'soft'} severity
 * @property {boolean} [significant] soft violations that count toward rewrite threshold
 */

/**
 * @typedef {object} ContractEvaluation
 * @property {boolean} ok
 * @property {boolean} pass alias of ok (hard-clean)
 * @property {ContractViolation[]} violations
 * @property {ContractViolation[]} hardViolations
 * @property {ContractViolation[]} softViolations
 * @property {boolean} needsRewrite
 * @property {boolean} rewriteRequired alias of needsRewrite
 * @property {string|null} rewriteBrief
 * @property {boolean} [rewritten]
 * @property {object} [diagnostics]
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

const DEAD_ACK_RE =
  /^(va bene\.?|ok\.?|okay\.?|capisco\.?|perfetto\.?|d['’]accordo\.?|certo\.?)$/i

const TRAILING_QUESTION_RE = /\?\s*$/

/** Generic engagement / follow-up questions (illegal when shouldAskQuestion=false). */
const ILLEGAL_FOLLOWUP_RE =
  /\b(vuoi\s+(che\s+)?(approfondisca|sappia|sapere|continui|che\s+ti\s+|che\s+te\s+)|vuoi\s+sapere\s+altro|posso\s+(spiegarti|aiutarti|fare)|ti\s+interessa(\s+anche)?|shall\s+i\s+|would\s+you\s+like\s+(me\s+to|to\s+know)|want\s+me\s+to|do\s+you\s+want\s+(me\s+to|to\s+know)|can\s+i\s+(explain|help|tell)|interested\s+in\s+hearing)\b/i

const STOCK_OPENER_RE =
  /^(capisco(\s+perfettamente)?|certamente|assolutamente|perfetto|va bene|ottima\s+domanda|great\s+question|of\s+course|absolutely|certainly|sure|certo)[.!,…:\s-]*/i

const EMPATHY_CONTEXT_RE =
  /\b(triste|trist[aeo]|male|ansia|ansioso|depress|piango|lacrim|morit|lutto|paura|spaventat|lonely|alone|sad|anxious|depressed|grief|scared|hurt|heartbroken|non\s+ce\s+la\s+faccio)\b/i

const CASUAL_SLANG_RE =
  /\b(bro+|brooo|lol+|lmao|wtf|omgg+|ahah+|raga+|figata|assurdooo)\b/i

const HYPE_RE = /(!{2,}|\b(wow+|yess+|let'?s\s+go+|super\s+figo)\b)/i

const BUREAUCRATIC_RE =
  /\b(your\s+request\s+has\s+been\s+processed|according\s+to\s+the\s+specified\s+parameters|la\s+richiesta\s+[eè]\s+stata\s+evasa|conformemente\s+ai\s+parametri)\b/i

const TECH_TERM_RE =
  /\b(pwm|spwm|inverter|algoritmo|protocollo|latency|throughput|derivata|integrale|architettura|dead-?time|switching|trifase|ponte\s+h|modulo|api|json|async|mutex|bandwidth|impedenza|frequenza|armonic)\b/i

const BEGINNER_PAD_RE =
  /\b(in\s+parole\s+semplici|per\s+capirlo\s+meglio|immagina\s+che|come\s+se\s+fosse|basically|simply\s+put|in\s+simple\s+terms)\b/i

const HEADING_RE = /^#{1,3}\s+\S+/m
const NUMBERED_SECTION_RE = /^\s*\d+[.)]\s+\S+/gm

/** Approximate decorative emoji (not digits/keycaps). */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu

const SOFT_REWRITE_THRESHOLD = 2

/**
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  const t = asString(text).trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

/**
 * Normalize first phrase / sentence for opener history.
 * @param {string} text
 * @returns {string}
 */
export function normalizeOpener(text) {
  const raw = asString(text).trim()
  if (!raw) return ''
  const first = raw.split(/(?<=[.!?…])\s+/)[0] || raw
  const clipped = first.slice(0, 80)
  return clipped
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract stock-opener key if present, else empty.
 * @param {string} text
 * @returns {string}
 */
export function extractStockOpenerKey(text) {
  const opener = normalizeOpener(text)
  if (!opener) return ''
  const m = opener.match(
    /^(capisco( perfettamente)?|certamente|assolutamente|perfetto|va bene|ottima domanda|great question|of course|absolutely|certainly|sure|certo)\b/,
  )
  return m ? m[1].replace(/\s+/g, ' ') : ''
}

/**
 * @param {string} text
 * @returns {number}
 */
export function countEmojis(text) {
  const matches = asString(text).match(EMOJI_RE)
  return matches ? matches.length : 0
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasEmojiChain(text) {
  return /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]){2,}/u.test(asString(text))
}

/**
 * @param {unknown} recent
 * @returns {string[]}
 */
function listRecentOpeners(recent) {
  if (!Array.isArray(recent)) return []
  return recent.map((x) => asString(x).toLowerCase().trim()).filter(Boolean).slice(0, 8)
}

/**
 * Verbosity band check — broad ranges only.
 * @param {string} verbosity
 * @param {number} words
 * @param {{ depth?: string, forceMinimalAck?: boolean, move?: string }} ctx
 * @returns {ContractViolation|null}
 */
export function checkVerbosityCompliance(verbosity, words, ctx = {}) {
  const v = asString(verbosity) || 'medium'
  const depth = asString(ctx.depth)
  const move = asString(ctx.move)

  if (ctx.forceMinimalAck || move === 'passive_acknowledgement' || move === 'stop') {
    if (v === 'minimal' && words > 60) {
      return {
        code: 'verbosity_too_long',
        message: `verbosity=minimal but ~${words} words`,
        severity: 'soft',
        significant: true,
      }
    }
    return null
  }

  if (v === 'minimal' && words > 45) {
    return {
      code: 'verbosity_too_long',
      message: `verbosity=minimal but ~${words} words`,
      severity: 'soft',
      significant: words > 80,
    }
  }
  if (v === 'short' && words > 140) {
    return {
      code: 'verbosity_too_long',
      message: `verbosity=short but ~${words} words`,
      severity: 'soft',
      significant: words > 220,
    }
  }
  if (
    (v === 'long' || (v === 'medium' && (depth === 'detailed' || depth === 'expert'))) &&
    words > 0 &&
    words < 18 &&
    move !== 'passive_acknowledgement'
  ) {
    return {
      code: 'verbosity_under_delivery',
      message: `verbosity=${v}/depth=${depth || 'n/a'} but only ~${words} words`,
      severity: 'soft',
      significant: v === 'long' || depth === 'expert',
    }
  }
  return null
}

/**
 * Depth mismatch — only clear cases.
 * @param {string} depth
 * @param {string} text
 * @param {{ verbosity?: string, technicality?: number, move?: string }} ctx
 * @returns {ContractViolation|null}
 */
export function checkDepthCompliance(depth, text, ctx = {}) {
  const d = asString(depth) || 'normal'
  const words = countWords(text)
  const move = asString(ctx.move)
  if (move === 'passive_acknowledgement' || move === 'stop') return null

  if (d === 'short' && words > 160) {
    return {
      code: 'depth_too_deep',
      message: 'depth=short but response is a long lecture',
      severity: 'soft',
      significant: words > 240,
    }
  }

  if ((d === 'expert' || d === 'detailed') && words > 0 && words < 20) {
    const hasTech = TECH_TERM_RE.test(text)
    if (!hasTech) {
      return {
        code: 'depth_under_delivery',
        message: `depth=${d} but reply is thin/vague`,
        severity: 'soft',
        significant: d === 'expert',
      }
    }
  }

  if (d === 'expert' && words >= 40 && !TECH_TERM_RE.test(text) && BEGINNER_PAD_RE.test(text)) {
    return {
      code: 'depth_under_delivery',
      message: 'depth=expert but reply stays beginner-padded without substance',
      severity: 'soft',
      significant: true,
    }
  }

  return null
}

/**
 * @param {string} text
 * @param {boolean} shouldAsk
 * @param {string} move
 * @param {string} phase
 * @returns {ContractViolation[]}
 */
export function checkQuestionPolicy(text, shouldAsk, move, phase) {
  /** @type {ContractViolation[]} */
  const out = []
  if (!text) return out

  const illegalFollowup = ILLEGAL_FOLLOWUP_RE.test(text) && TRAILING_QUESTION_RE.test(text)
  const trailingQ = TRAILING_QUESTION_RE.test(text)

  if (!shouldAsk && illegalFollowup) {
    out.push({
      code: 'illegal_followup_question',
      message: 'Generic engagement question while shouldAskQuestion=false',
      severity: 'hard',
    })
  } else if (!shouldAsk && trailingQ) {
    const severity =
      move === 'execute_pending_proposal' || move === 'continue_topic' || move === 'stop'
        ? 'hard'
        : 'soft'
    out.push({
      code: 'unexpected_question',
      message: 'Reply asks a question while shouldAskQuestion=false',
      severity,
      significant: severity === 'soft',
    })
  }

  if ((move === 'stop' || phase === 'closing') && trailingQ && text.length > 40) {
    out.push({
      code: 'reopened_closing',
      message: 'Closing/stop reply reopened with a question',
      severity: 'hard',
    })
  }

  return out
}

/**
 * @param {string} text
 * @param {{
 *   userMessage?: string,
 *   conversationMode?: string,
 *   emotionalContext?: boolean,
 *   recentOpeners?: string[],
 * }} ctx
 * @returns {ContractViolation|null}
 */
export function checkStockOpener(text, ctx = {}) {
  const key = extractStockOpenerKey(text)
  if (!key) return null

  const userMessage = asString(ctx.userMessage)
  const mode = asString(ctx.conversationMode)
  const signals =
    ctx.conversationSignals && typeof ctx.conversationSignals === 'object'
      ? ctx.conversationSignals
      : null
  const empathy =
    Boolean(ctx.emotionalContext) ||
    (signals && signals.affect?.seriousness >= 0.45) ||
    EMPATHY_CONTEXT_RE.test(userMessage) ||
    mode === 'emotional_support'

  // Brief natural ack in serious/empathy context is allowed.
  if (empathy && (key === 'capisco' || key.startsWith('capisco'))) {
    return null
  }

  const recent = listRecentOpeners(ctx.recentOpeners)
  const repeats = recent.filter((o) => o === key || o.startsWith(key) || key.startsWith(o)).length
  const bodyAfter = asString(text)
    .replace(STOCK_OPENER_RE, '')
    .trim()

  // Factual/definitional ask + stock padding (prefer Signals when present).
  const factualAsk = signals
    ? Boolean(signals.interaction?.explicitRequest || signals.interaction?.explicitQuestion) &&
      signals.affect?.seriousness < 0.45
    : /^(cos['’]?è|che\s+cos['’]?è|what\s+is|spiegami|descrivi|come\s+funziona)\b/i.test(
        userMessage,
      )

  if (repeats >= 1) {
    return {
      code: 'repeated_stock_opener',
      message: `Stock opener "${key}" repeated across recent turns`,
      severity: 'soft',
      significant: repeats >= 2 || factualAsk,
    }
  }

  if (factualAsk && bodyAfter.length > 10) {
    return {
      code: 'generic_opener',
      message: `Generic stock opener "${key}" before a direct answer`,
      severity: 'soft',
      significant: false,
    }
  }

  if (!empathy && factualAsk) {
    return {
      code: 'generic_opener',
      message: `Generic stock opener "${key}" without contextual need`,
      severity: 'soft',
      significant: false,
    }
  }

  return null
}

/**
 * @param {string} emojiPolicy
 * @param {string} text
 * @returns {ContractViolation|null}
 */
export function checkEmojiPolicy(emojiPolicy, text) {
  const policy = asString(emojiPolicy) || 'rare'
  const n = countEmojis(text)
  if (n === 0) return null

  if (policy === 'none') {
    return {
      code: 'emoji_forbidden',
      message: 'emojiPolicy=none but decorative emoji present',
      severity: 'soft',
      significant: true,
    }
  }
  if (policy === 'rare' && (n > 1 || hasEmojiChain(text))) {
    return {
      code: 'emoji_excess',
      message: `emojiPolicy=rare but found ${n} emoji(s)`,
      severity: 'soft',
      significant: n > 2 || hasEmojiChain(text),
    }
  }
  if (policy === 'occasional' && (n > 3 || hasEmojiChain(text))) {
    return {
      code: 'emoji_excess',
      message: `emojiPolicy=occasional but found ${n} emoji(s)/chain`,
      severity: 'soft',
      significant: n > 5,
    }
  }
  return null
}

/**
 * Severe tone / energy / technicality mismatches only.
 * @param {object|null} profile
 * @param {string} text
 * @param {{ userMessage?: string }} [ctx]
 * @returns {ContractViolation[]}
 */
export function checkToneEnergyTechnicality(profile, text, ctx = {}) {
  /** @type {ContractViolation[]} */
  const out = []
  if (!profile || typeof profile !== 'object' || !profile.tone) return out
  const tone = profile.tone
  const warmth = Number(tone.warmth)
  const formality = Number(tone.formality)
  const humor = Number(tone.humor)
  const technicality = Number(tone.technicality)
  const energy = asString(profile.energy)
  const depth = asString(profile.depth)

  if (
    (formality >= 0.55 || humor <= 0.25) &&
    (CASUAL_SLANG_RE.test(text) || (HYPE_RE.test(text) && humor <= 0.2))
  ) {
    out.push({
      code: 'tone_mismatch_formal',
      message: 'Jokey/slang tone vs formal/low-humor profile',
      severity: 'soft',
      significant: true,
    })
  }

  if (warmth >= 0.55 && formality <= 0.35 && BUREAUCRATIC_RE.test(text)) {
    out.push({
      code: 'tone_mismatch_warm',
      message: 'Bureaucratic phrasing vs warm/casual profile',
      severity: 'soft',
      significant: true,
    })
  }

  if (energy === 'low' && (HYPE_RE.test(text) || CASUAL_SLANG_RE.test(text))) {
    out.push({
      code: 'energy_mismatch_high',
      message: 'Hyped/jokey delivery vs low energy',
      severity: 'soft',
      significant: true,
    })
  }

  if (
    energy === 'high' &&
    countWords(text) <= 12 &&
    BUREAUCRATIC_RE.test(text) &&
    !/[!]/.test(text)
  ) {
    out.push({
      code: 'energy_mismatch_low',
      message: 'Dry bureaucratic line vs high energy',
      severity: 'soft',
      significant: false,
    })
  }

  if (
    technicality >= 0.65 &&
    (depth === 'expert' || depth === 'detailed') &&
    countWords(text) >= 25 &&
    !TECH_TERM_RE.test(text)
  ) {
    const userMsg = asString(ctx.userMessage)
    const technicalAsk = TECH_TERM_RE.test(userMsg) || EXPERT_ASK_RE.test(userMsg)
    if (technicalAsk) {
      out.push({
        code: 'technicality_under_delivery',
        message: 'High technicality profile but vague non-technical reply',
        severity: 'soft',
        significant: true,
      })
    }
  }

  if (technicality <= 0.3 && countWords(text) >= 40) {
    const techHits = (text.match(TECH_TERM_RE) || []).length
    if (techHits >= 5 && !BEGINNER_PAD_RE.test(text)) {
      out.push({
        code: 'technicality_over_delivery',
        message: 'Low technicality profile but jargon-heavy without scaffolding',
        severity: 'soft',
        significant: false,
      })
    }
  }

  return out
}

const EXPERT_ASK_RE =
  /\b(tecnicamente|spwm|dead-?time|switching|trifase|algoritmo|implementazione|architettura)\b/i

/**
 * Structure compliance — only when profile/structure cue is clear.
 * @param {object|null} profile
 * @param {string} text
 * @param {{ conversationMode?: string }} [ctx]
 * @returns {ContractViolation|null}
 */
export function checkStructureCompliance(profile, text, ctx = {}) {
  const structure = asString(
    profile && typeof profile === 'object' ? /** @type {any} */ (profile).structure : '',
  )
  const mode = asString(ctx.conversationMode)
  const depth = asString(profile?.depth)
  const formality = Number(profile?.tone?.formality)

  const plain =
    structure === 'plain' ||
    (structure !== 'structured' &&
      (mode === 'social' || formality <= 0.3) &&
      (depth === 'short' || depth === 'normal'))

  if (!plain) {
    // Structured expectation: dense wall with no breaks on detailed/expert may soft-flag.
    if (
      (structure === 'structured' || depth === 'expert') &&
      countWords(text) > 180 &&
      !HEADING_RE.test(text) &&
      (text.match(NUMBERED_SECTION_RE) || []).length === 0 &&
      !/\n\s*[-*•]/.test(text)
    ) {
      // Natural prose is acceptable — do not flag.
      return null
    }
    return null
  }

  const headings = (text.match(/^#{1,3}\s+\S+/gm) || []).length
  const numbered = (text.match(NUMBERED_SECTION_RE) || []).length
  if (headings >= 2 || (headings >= 1 && numbered >= 3)) {
    return {
      code: 'structure_over_formatted',
      message: 'Plain/conversational profile but heavy heading/section formatting',
      severity: 'soft',
      significant: headings >= 3,
    }
  }
  return null
}

/**
 * Build rewrite brief — HOW only; immutable WHAT fields listed.
 * @param {{
 *   move: string,
 *   objective: string,
 *   topic: string,
 *   shouldAsk: boolean,
 *   forceMinimalAck: boolean,
 *   shouldContinue: boolean,
 *   phase: string,
 *   profile: object|null,
 *   hard: ContractViolation[],
 *   softSignificant: ContractViolation[],
 * }} args
 * @returns {string}
 */
function buildRewriteBrief(args) {
  const profile = args.profile
  const profileLines = []
  if (profile && typeof profile === 'object' && profile.tone) {
    const t = profile.tone
    profileLines.push(
      `responseProfile: depth=${profile.depth}; verbosity=${profile.verbosity}; energy=${profile.energy}; emojiPolicy=${profile.emojiPolicy}`,
      `tone: warmth=${t.warmth}; formality=${t.formality}; humor=${t.humor}; directness=${t.directness}; technicality=${t.technicality}`,
    )
  }

  const hard = args.hard
  const soft = args.softSignificant
  const codes = [...hard, ...soft].map((v) => v.code)

  /** @type {string[]} */
  const targeted = []
  if (codes.includes('illegal_followup_question') || codes.includes('unexpected_question')) {
    targeted.push('Remove the trailing engagement question. Do not ask anything.')
  }
  if (codes.includes('generic_opener') || codes.includes('repeated_stock_opener')) {
    targeted.push(
      'Drop the stock opener (Capisco/Certamente/Perfetto/…). Start with the substance.',
    )
  }
  if (codes.includes('emoji_forbidden') || codes.includes('emoji_excess')) {
    targeted.push('Remove decorative emoji. Do not add new ones.')
  }
  if (codes.includes('verbosity_too_long')) {
    targeted.push('Compress sharply to match verbosity; keep the core answer.')
  }
  if (
    codes.includes('verbosity_under_delivery') ||
    codes.includes('depth_under_delivery') ||
    codes.includes('technicality_under_delivery')
  ) {
    targeted.push('Expand with the missing substance for the profile — keep the same topic/move.')
  }
  if (codes.includes('collapsed_execute_continue')) {
    targeted.push('Deliver the pending content now — never reply with only "Va bene." / "Ok."')
  }
  if (codes.includes('referent_contradiction')) {
    targeted.push(
      'Stay on the corrected/resolved referent from the Planner contract; do not revert to the rejected interpretation.',
    )
  }
  if (codes.includes('reopened_closing')) {
    targeted.push('Close warmly and briefly. Do not reopen the prior subject.')
  }
  if (codes.includes('tone_mismatch_formal') || codes.includes('energy_mismatch_high')) {
    targeted.push('Tone down slang/hype; match formality and energy.')
  }
  if (codes.includes('tone_mismatch_warm')) {
    targeted.push('Rewrite in natural warm conversational phrasing — not bureaucratic.')
  }
  if (codes.includes('structure_over_formatted')) {
    targeted.push('Use natural prose; remove unnecessary headings/numbered sections.')
  }

  return [
    'CONTRACT REWRITE (HOW only — do not change WHAT):',
    `conversationalMove=${args.move}`,
    `objective=${args.objective || args.move}`,
    `activeTopic=${args.topic || '(none)'}`,
    `shouldAskQuestion=${args.shouldAsk}`,
    `shouldContinue=${args.shouldContinue}`,
    `forceMinimalAck=${args.forceMinimalAck}`,
    `conversationPhase=${args.phase || '(none)'}`,
    ...profileLines,
    'Violations:',
    ...hard.map((v) => `- HARD ${v.code}: ${v.message}`),
    ...soft.map((v) => `- SOFT ${v.code}: ${v.message}`),
    'Preserve topic, objective, and conversationalMove. Do not invent a new strategy.',
    'Do not ask a question unless shouldAskQuestion=true.',
    'Preserve correct substantive content; fix only the listed delivery issues when possible.',
    ...targeted,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Evaluate Writer output against Planner WHAT + Adaptive HOW profile.
 * Pure. No LLM. Never invents a new move.
 *
 * @param {{
 *   responseText?: string,
 *   plan?: object|null,
 *   conversationState?: object|null,
 *   conversationSignals?: object|null,
 *   userMessage?: string,
 *   recentOpeners?: string[],
 *   isFinalCheck?: boolean,
 * }} [input]
 * @returns {ContractEvaluation}
 */
export function evaluateContractFidelity(input = {}) {
  const textRaw = asString(input.responseText)
  const text = textRaw.replace(/\s+/g, ' ').trim()
  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {}
  const brief =
    plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : {}
  const state =
    input.conversationState && typeof input.conversationState === 'object'
      ? input.conversationState
      : null
  const conversationSignals =
    input.conversationSignals && typeof input.conversationSignals === 'object'
      ? input.conversationSignals
      : null

  /** @type {ContractViolation[]} */
  const violations = []

  const move = asString(brief.conversationalMove || 'default')
  const shouldAsk = Boolean(brief.shouldAskQuestion)
  const forceMinimalAck = Boolean(brief.forceMinimalAck)
  const topic = asString(brief.activeTopic || state?.activeTopic || '')
  const phase = asString(state?.conversationPhase || '')
  const objective = asString(plan.objective || '')
  const userMessage = asString(input.userMessage || '')
  const recentOpeners = listRecentOpeners(
    input.recentOpeners || state?.recentOpeners || state?.diagnostics?.recentOpeners,
  )

  const profile =
    (brief.responseProfile && typeof brief.responseProfile === 'object'
      ? brief.responseProfile
      : null) ||
    (plan.responseProfile && typeof plan.responseProfile === 'object'
      ? plan.responseProfile
      : null) ||
    (state?.responseProfile && typeof state.responseProfile === 'object'
      ? state.responseProfile
      : null)

  // ——— A. Hard contract fidelity ———

  if (!text) {
    violations.push({
      code: 'empty_response',
      message: 'Writer returned empty text',
      severity: 'hard',
    })
  }

  if (
    (move === 'execute_pending_proposal' || move === 'continue_topic') &&
    text &&
    DEAD_ACK_RE.test(text)
  ) {
    violations.push({
      code: 'collapsed_execute_continue',
      message: `Move ${move} collapsed to acknowledgement`,
      severity: 'hard',
    })
  }

  // Phase 7: Writer must not contradict a resolved / explicit corrected referent.
  if (text && state) {
    const ref = state.referenceResolution
    const repair = state.repair
    const referent =
      asString(repair?.correctedReferent) ||
      asString(ref?.referent) ||
      asString(brief.activeTopic) ||
      ''
    const status = asString(ref?.status || (repair?.active ? 'explicit' : ''))
    if (
      responseContradictsReferent(textRaw, {
        referent,
        rejectedInterpretation: repair?.rejectedInterpretation || null,
        status:
          status ||
          (repair?.correctedReferent ? 'explicit' : ''),
      })
    ) {
      violations.push({
        code: 'referent_contradiction',
        message: `Reply contradicts resolved referent "${referent}"`,
        severity: 'hard',
      })
    }
  }

  violations.push(...checkQuestionPolicy(text, shouldAsk, move, phase))

  // Deduplicate reopened_closing if question policy also added it.
  {
    const seen = new Set()
    for (let i = violations.length - 1; i >= 0; i -= 1) {
      const key = `${violations[i].code}:${violations[i].severity}`
      if (seen.has(key)) violations.splice(i, 1)
      else seen.add(key)
    }
  }

  if (topic && (move === 'continue_topic' || move === 'execute_pending_proposal') && text) {
    if (forceMinimalAck) {
      violations.push({
        code: 'force_minimal_ack_conflict',
        message: 'forceMinimalAck set on execute/continue move',
        severity: 'hard',
      })
    }
  }

  if (move === 'passive_acknowledgement' && text && text.length > 120 && !forceMinimalAck) {
    violations.push({
      code: 'passive_too_long',
      message: 'Passive acknowledgement grew beyond a short ack',
      severity: 'soft',
      significant: false,
    })
  }

  // ——— B. Adaptive delivery fidelity ———

  if (profile && text) {
    const verbosityHit = checkVerbosityCompliance(profile.verbosity, countWords(textRaw), {
      depth: profile.depth,
      forceMinimalAck,
      move,
    })
    if (verbosityHit) violations.push(verbosityHit)

    const depthHit = checkDepthCompliance(profile.depth, textRaw, {
      verbosity: profile.verbosity,
      technicality: Number(profile.tone?.technicality),
      move,
    })
    if (depthHit) violations.push(depthHit)

    let emojiPolicy = profile.emojiPolicy
    if (conversationSignals?.style?.allowsEmojis === false) emojiPolicy = 'none'
    const emojiHit = checkEmojiPolicy(emojiPolicy, textRaw)
    if (emojiHit) violations.push(emojiHit)

    violations.push(
      ...checkToneEnergyTechnicality(profile, textRaw, { userMessage }),
    )

    const structureHit = checkStructureCompliance(profile, textRaw, {
      conversationMode: asString(state?.conversationMode || ''),
    })
    if (structureHit) violations.push(structureHit)
  }

  const openerHit = checkStockOpener(textRaw, {
    userMessage,
    conversationMode: asString(state?.conversationMode || ''),
    conversationSignals,
    recentOpeners,
  })
  if (openerHit) violations.push(openerHit)

  const hardViolations = violations.filter((v) => v.severity === 'hard')
  const softViolations = violations.filter((v) => v.severity === 'soft')
  const softSignificant = softViolations.filter((v) => v.significant)

  // Rewrite: any hard OR enough significant soft (skip aggressive rewrite on final check).
  const needsRewrite =
    !input.isFinalCheck &&
    (hardViolations.length > 0 || softSignificant.length >= SOFT_REWRITE_THRESHOLD)

  /** @type {string|null} */
  let rewriteBrief = null
  if (needsRewrite) {
    rewriteBrief = buildRewriteBrief({
      move,
      objective,
      topic,
      shouldAsk,
      forceMinimalAck,
      shouldContinue: Boolean(brief.shouldContinue),
      phase,
      profile,
      hard: hardViolations,
      softSignificant:
        hardViolations.length > 0
          ? softSignificant
          : softSignificant.slice(0, SOFT_REWRITE_THRESHOLD + 2),
    })
  }

  const ok = hardViolations.length === 0

  return {
    ok,
    pass: ok,
    violations,
    hardViolations,
    softViolations,
    needsRewrite,
    rewriteRequired: needsRewrite,
    rewriteBrief,
    diagnostics: {
      version: CONTRACT_EVALUATOR_VERSION,
      wordCount: countWords(textRaw),
      openerKey: extractStockOpenerKey(textRaw) || null,
      emojiCount: countEmojis(textRaw),
      softSignificantCount: softSignificant.length,
    },
  }
}

/**
 * Sanitize evaluation for debug metadata (no hidden reasoning).
 * @param {ContractEvaluation|object|null|undefined} evaluation
 * @returns {object|null}
 */
export function serializeContractEvaluationDebug(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null
  const ce = /** @type {any} */ (evaluation)
  return {
    pass: Boolean(ce.ok ?? ce.pass),
    rewritten: Boolean(ce.rewritten),
    hardViolations: Array.isArray(ce.hardViolations)
      ? ce.hardViolations.map((v) => v.code)
      : Array.isArray(ce.violations)
        ? ce.violations.filter((v) => v.severity === 'hard').map((v) => v.code)
        : [],
    softViolations: Array.isArray(ce.softViolations)
      ? ce.softViolations.map((v) => v.code)
      : Array.isArray(ce.violations)
        ? ce.violations.filter((v) => v.severity === 'soft').map((v) => v.code)
        : [],
  }
}

/**
 * @param {unknown} value
 * @returns {value is ContractEvaluation}
 */
export function isContractEvaluation(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return typeof v.ok === 'boolean' && Array.isArray(v.violations)
}
