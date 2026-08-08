/**
 * LAIfe Feedback Interpretation
 *
 * Detect when the user is giving feedback about the assistant itself
 * (style, length, tone, quality, format) — not asking a factual question.
 *
 * Feedback updates a temporary Conversation Preference Profile for the
 * current conversation. Preferences persist until the user changes them.
 * Never mention that the profile was updated.
 *
 * Examples:
 *   "Too short."     → richer responses
 *   "Too long."      → more concise
 *   "More emojis."   → slightly more expressive
 *   "Less emojis."   → more neutral
 *   "Too technical." → simpler explanations
 *   "Go deeper."     → increase analytical depth
 *
 * When appropriate:
 *   - acknowledge naturally (brief / woven — never theatrical)
 *   - adapt the current conversation immediately
 *   - avoid explaining obvious concepts
 *   - avoid unnecessary follow-up questions
 *
 * Improve behavior in the same reply whenever possible.
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'no_emojis'|'fewer_emojis'|'more_emojis'|'raise_quality'|'too_short'|'too_long'|'praise'|'too_formal'|'too_casual'|'simpler'|'more_technical'|'go_deeper'|'fewer_questions'|'no_lists'|'more_structure'|'more_examples'} FeedbackKind
 */

/**
 * @typedef {object} FeedbackAdaptation
 * @property {boolean} [noEmojis]
 * @property {boolean} [fewerEmojis]
 * @property {boolean} [moreEmojis]
 * @property {boolean} [raiseQuality]
 * @property {boolean} [expand]
 * @property {boolean} [compress]
 * @property {boolean} [lessFormal]
 * @property {boolean} [moreFormal]
 * @property {boolean} [simpler]
 * @property {boolean} [moreTechnical]
 * @property {boolean} [fewerQuestions]
 * @property {boolean} [avoidLists]
 * @property {boolean} [moreStructure]
 * @property {boolean} [moreExamples]
 * @property {boolean} [goDeeper]
 */

/**
 * @typedef {object} ConversationPreferenceProfile
 * @property {'richer'|'concise'|null} length
 * @property {'more_expressive'|'less_emoji'|'no_emoji'|null} emoji
 * @property {'simpler'|'technical'|null} technicality
 * @property {'warmer'|'more_formal'|null} formality
 * @property {'deeper'|null} depth
 * @property {'fewer'|null} questions
 * @property {'prose'|'lists'|'clearer'|null} structure
 * @property {number|null} updatedAt
 * @property {1} version
 */

/**
 * @typedef {object} FeedbackPlan
 * @property {boolean} active
 * @property {boolean} isMetaFeedback
 * @property {FeedbackKind | null} kind
 * @property {FeedbackAdaptation} adaptations
 * @property {boolean} continueTopic
 * @property {'weave'|'brief'|'none'} acknowledge
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {boolean} [profileActive]
 * @property {boolean} [profileJustUpdated]
 */

/** Soft cues — never sole evidence without meta/context fit */
const CUE_NO_EMOJI =
  /\b(no\s+emojis?|senza\s+emoji|stop\s+(the\s+)?emojis?|niente\s+emoji|togli\s+(le\s+)?emoji|emoji\s+off)\b/i

const CUE_FEWER_EMOJI =
  /\b(meno\s+emoji|fewer\s+emojis?|less\s+emojis?|riduci\s+(le\s+)?emoji)\b/i

const CUE_MORE_EMOJI =
  /\b(more\s+emojis?|più\s+emoji|usa\s+(più\s+)?emoji|add\s+emojis?|with\s+emojis?|usa\s+le\s+faccine)\b/i

const CUE_RAISE =
  /\b(you\s+can\s+do\s+better|puoi\s+fare\s+di\s+meglio|fai\s+di\s+meglio|try\s+harder|be\s+more\s+specific|troppo\s+(generico|vago|superficiale)|that'?s\s+(weak|thin|vague|generic)|non\s+mi\s+convince)\b/i

const CUE_GO_DEEPER =
  /\b(go\s+deeper|più\s+in\s+profondità|more\s+(depth|analytical|analysis)|approfondisci|dig\s+deeper|analizza\s+di\s+più|more\s+rigor|più\s+a\s+fondo)\b/i

const CUE_TOO_SHORT =
  /\b(too\s+short|troppo\s+corto|troppo\s+breve|più\s+lungo|more\s+detail|più\s+dettagli|expand|dimmi\s+di\s+più|tell\s+me\s+more)\b/i

const CUE_TOO_LONG =
  /\b(too\s+long|troppo\s+lungo|più\s+breve|shorter|in\s+breve|tl;?dr|sintetizza|meno\s+testo|too\s+verbose|troppo\s+verboso|more\s+concise|più\s+concis[oa])\b/i

const CUE_PRAISE =
  /\b(that\s+was\s+nice|nice\s+(one|answer|reply)|great\s+answer|good\s+(one|answer|point)|bella\s+risposta|ottima\s+risposta|ben\s+detto|mi\s+è\s+piaciut[oa]|loved\s+(it|that)|that\s+helped|utile,??\s+grazie)\b/i

const CUE_TOO_FORMAL =
  /\b(too\s+formal|troppo\s+formal[e]|meno\s+formal[e]|più\s+casual|more\s+casual|parla\s+normale|less\s+stiff|troppo\s+rigido|relax\s+the\s+tone)\b/i

const CUE_TOO_CASUAL =
  /\b(too\s+casual|troppo\s+informal[e]|più\s+formal[e]|more\s+formal|troppo\s+slang|less\s+slang|più\s+professionale)\b/i

const CUE_SIMPLER =
  /\b(too\s+technical|troppo\s+tecnic[oa]|più\s+semplice|simpler|eli5|in\s+parole\s+semplici|less\s+jargon|meno\s+gergo|meno\s+tecnic[oa])\b/i

const CUE_MORE_TECH =
  /\b(more\s+technical|più\s+tecnic[oa]|go\s+deeper\s+technically|più\s+preciso|more\s+precise|salta\s+le\s+basi)\b/i

const CUE_FEWER_Q =
  /\b(stop\s+asking|meno\s+domande|no\s+questions|non\s+chiedere|fewer\s+questions|basta\s+domande)\b/i

const CUE_NO_LISTS =
  /\b(no\s+lists?|niente\s+(liste|elenchi)|senza\s+bullet|no\s+bullets?|prose\s+please|in\s+prosa)\b/i

const CUE_MORE_STRUCTURE =
  /\b(use\s+(a\s+)?list|in\s+lista|step\s+by\s+step|più\s+strutturat[oa]|usa\s+(i\s+)?bullet)\b/i

const CUE_MORE_EXAMPLES =
  /\b(more\s+examples?|più\s+esempi|un\s+esempio|give\s+(me\s+)?an?\s+example|fammi\s+un\s+esempio)\b/i

/** Looks like a real topical question, not meta-feedback */
const FACTUAL_QUESTION =
  /\b(cos['’]?[eè]\s+\w{3,}|what\s+is\s+(an?\s+)?\w{3,}|come\s+funziona|how\s+does|perch[eé]\s+\w|when\s+was|quanto\s+(costa|vale)|who\s+(is|was)|dove\s+[eè])\b/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const LENGTH_VALUES = new Set(['richer', 'concise'])
const EMOJI_VALUES = new Set(['more_expressive', 'less_emoji', 'no_emoji'])
const TECH_VALUES = new Set(['simpler', 'technical'])
const FORMALITY_VALUES = new Set(['warmer', 'more_formal'])
const DEPTH_VALUES = new Set(['deeper'])
const QUESTIONS_VALUES = new Set(['fewer'])
const STRUCTURE_VALUES = new Set(['prose', 'lists', 'clearer'])

/** @type {Record<FeedbackKind, { label: string, adaptations: FeedbackAdaptation, continueTopic: boolean, acknowledge: 'weave'|'brief'|'none' }>} */
const KIND_META = {
  no_emojis: {
    label: 'niente emoji',
    adaptations: { noEmojis: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  fewer_emojis: {
    label: 'meno emoji',
    adaptations: { fewerEmojis: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  more_emojis: {
    label: 'più emoji',
    adaptations: { moreEmojis: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  raise_quality: {
    label: 'alza la qualità',
    adaptations: { raiseQuality: true, goDeeper: true },
    continueTopic: true,
    acknowledge: 'none',
  },
  too_short: {
    label: 'troppo corto',
    adaptations: { expand: true },
    continueTopic: true,
    acknowledge: 'none',
  },
  too_long: {
    label: 'troppo lungo',
    adaptations: { compress: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  praise: {
    label: 'feedback positivo',
    adaptations: { goDeeper: true },
    continueTopic: true,
    acknowledge: 'brief',
  },
  too_formal: {
    label: 'troppo formale',
    adaptations: { lessFormal: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  too_casual: {
    label: 'troppo casual',
    adaptations: { moreFormal: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  simpler: {
    label: 'più semplice',
    adaptations: { simpler: true },
    continueTopic: true,
    acknowledge: 'none',
  },
  more_technical: {
    label: 'più tecnico',
    adaptations: { moreTechnical: true, goDeeper: true },
    continueTopic: true,
    acknowledge: 'none',
  },
  go_deeper: {
    label: 'più profondità',
    adaptations: { goDeeper: true },
    continueTopic: true,
    acknowledge: 'none',
  },
  fewer_questions: {
    label: 'meno domande',
    adaptations: { fewerQuestions: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  no_lists: {
    label: 'niente liste',
    adaptations: { avoidLists: true },
    continueTopic: true,
    acknowledge: 'weave',
  },
  more_structure: {
    label: 'più struttura',
    adaptations: { moreStructure: true },
    continueTopic: true,
    acknowledge: 'none',
  },
  more_examples: {
    label: 'più esempi',
    adaptations: { moreExamples: true },
    continueTopic: true,
    acknowledge: 'none',
  },
}

/**
 * @returns {ConversationPreferenceProfile}
 */
export function emptyPreferenceProfile() {
  return {
    length: null,
    emoji: null,
    technicality: null,
    formality: null,
    depth: null,
    questions: null,
    structure: null,
    updatedAt: null,
    version: 1,
  }
}

/**
 * @param {unknown} raw
 * @returns {ConversationPreferenceProfile}
 */
export function sanitizePreferenceProfile(raw) {
  const base = emptyPreferenceProfile()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const o = /** @type {Record<string, unknown>} */ (raw)
  return {
    length: LENGTH_VALUES.has(/** @type {string} */ (o.length))
      ? /** @type {ConversationPreferenceProfile['length']} */ (o.length)
      : null,
    emoji: EMOJI_VALUES.has(/** @type {string} */ (o.emoji))
      ? /** @type {ConversationPreferenceProfile['emoji']} */ (o.emoji)
      : null,
    technicality: TECH_VALUES.has(/** @type {string} */ (o.technicality))
      ? /** @type {ConversationPreferenceProfile['technicality']} */ (o.technicality)
      : null,
    formality: FORMALITY_VALUES.has(/** @type {string} */ (o.formality))
      ? /** @type {ConversationPreferenceProfile['formality']} */ (o.formality)
      : null,
    depth: DEPTH_VALUES.has(/** @type {string} */ (o.depth))
      ? /** @type {ConversationPreferenceProfile['depth']} */ (o.depth)
      : null,
    questions: QUESTIONS_VALUES.has(/** @type {string} */ (o.questions))
      ? /** @type {ConversationPreferenceProfile['questions']} */ (o.questions)
      : null,
    structure: STRUCTURE_VALUES.has(/** @type {string} */ (o.structure))
      ? /** @type {ConversationPreferenceProfile['structure']} */ (o.structure)
      : null,
    updatedAt:
      typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : typeof o.updatedAt === 'string' && o.updatedAt
          ? Date.parse(o.updatedAt) || null
          : null,
    version: 1,
  }
}

/**
 * @param {ConversationPreferenceProfile} profile
 */
export function isDefaultPreferenceProfile(profile) {
  const p = sanitizePreferenceProfile(profile)
  return (
    !p.length &&
    !p.emoji &&
    !p.technicality &&
    !p.formality &&
    !p.depth &&
    !p.questions &&
    !p.structure
  )
}

/**
 * Apply feedback to the conversation preference profile.
 * @param {unknown} prior
 * @param {FeedbackKind | null} kind
 * @returns {ConversationPreferenceProfile}
 */
export function applyFeedbackToProfile(prior, kind) {
  const next = sanitizePreferenceProfile(prior)
  if (!kind) return next
  const now = Date.now()

  switch (kind) {
    case 'too_short':
      next.length = 'richer'
      break
    case 'too_long':
      next.length = 'concise'
      break
    case 'more_emojis':
      next.emoji = 'more_expressive'
      break
    case 'fewer_emojis':
      next.emoji = 'less_emoji'
      break
    case 'no_emojis':
      next.emoji = 'no_emoji'
      break
    case 'simpler':
      next.technicality = 'simpler'
      break
    case 'more_technical':
      next.technicality = 'technical'
      break
    case 'go_deeper':
      next.depth = 'deeper'
      if (next.length === 'concise') next.length = 'richer'
      break
    case 'too_formal':
      next.formality = 'warmer'
      break
    case 'too_casual':
      next.formality = 'more_formal'
      break
    case 'fewer_questions':
      next.questions = 'fewer'
      break
    case 'no_lists':
      next.structure = 'prose'
      break
    case 'more_structure':
      next.structure = 'lists'
      break
    case 'raise_quality':
      next.structure = 'clearer'
      next.depth = 'deeper'
      if (next.length === 'concise') next.length = 'richer'
      break
    case 'more_examples':
      if (!next.length) next.length = 'richer'
      break
    case 'praise':
      // Reinforce current preferences — no flip.
      break
    default:
      break
  }

  next.updatedAt = now
  next.version = 1
  return next
}

/**
 * Soft Writer lines from the active Conversation Preference Profile.
 * @param {ConversationPreferenceProfile} profile
 * @returns {string[]}
 */
function preferenceProfileLines(profile) {
  const p = sanitizePreferenceProfile(profile)
  /** @type {string[]} */
  const lines = []
  if (p.length === 'richer') {
    lines.push('Length: richer responses — more substance, examples, and useful texture without fluff.')
  } else if (p.length === 'concise') {
    lines.push('Length: more concise — fewer words, denser value, no padding.')
  }
  if (p.emoji === 'more_expressive') {
    lines.push('Expressiveness: slightly more expressive — light emoji only when they fit naturally.')
  } else if (p.emoji === 'less_emoji') {
    lines.push('Expressiveness: more neutral — keep emoji rare or absent.')
  } else if (p.emoji === 'no_emoji') {
    lines.push('Expressiveness: more neutral — zero emoji.')
  }
  if (p.technicality === 'simpler') {
    lines.push('Clarity: simpler explanations — plain language first; jargon only if essential and explained.')
  } else if (p.technicality === 'technical') {
    lines.push('Clarity: more technical depth is welcome when accurate.')
  }
  if (p.formality === 'warmer') {
    lines.push('Tone: warmer and more conversational — still precise, not chatty filler.')
  } else if (p.formality === 'more_formal') {
    lines.push('Tone: a bit more formal and composed — still human, not stiff.')
  }
  if (p.depth === 'deeper') {
    lines.push('Depth: increase analytical depth — mechanisms, trade-offs, sharper distinctions.')
  }
  if (p.questions === 'fewer') {
    lines.push('Questions: fewer or none — prefer a complete answer over a closing question.')
  }
  if (p.structure === 'prose') {
    lines.push('Structure: continuous prose — avoid bullet lists unless truly necessary.')
  } else if (p.structure === 'lists') {
    lines.push('Structure: clearer shape with steps/lists when they help.')
  } else if (p.structure === 'clearer') {
    lines.push('Structure: clearer shape — lead with the point, then support; reduce ambiguity.')
  }
  return lines
}

/**
 * @param {ConversationPreferenceProfile} profile
 * @param {{ justUpdated?: boolean }} [options]
 */
export function buildPreferenceProfileBrief(profile, options = {}) {
  const lines = preferenceProfileLines(profile)
  if (!lines.length) return ''
  const header =
    'Conversation Preference Profile (active for this conversation — apply silently; never mention the profile or that preferences changed):'
  return [header, ...lines.map((l) => `- ${l}`)].join('\n')
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
 * @param {ChatTurn[]} turns
 */
function lastAssistant(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') return turns[i].content
  }
  return ''
}

/**
 * Meta-feedback is usually short and about the prior reply, not a new topic.
 * @param {string} msg
 * @param {string} priorAssistant
 */
function metaContextFit(msg, priorAssistant) {
  const words = msg.split(/\s+/).filter(Boolean).length
  const brief = words <= 10 && msg.length <= 80
  const hasPrior = priorAssistant.length > 40
  let score = 0
  if (brief) score += 1.2
  if (hasPrior) score += 1.4
  if (/[?？]/.test(msg) && brief) score += 0.4 // "No emojis?" stil feedback
  if (FACTUAL_QUESTION.test(msg) && words >= 5) score -= 2.5
  if (GREETING_ONLY.test(msg)) score -= 3
  return score
}

/**
 * @param {string} msg
 * @param {number} contextFit
 * @returns {{ kind: FeedbackKind, score: number, signals: string[] }[]}
 */
function scoreKinds(msg, contextFit) {
  /** @type {{ kind: FeedbackKind, score: number, signals: string[] }[]} */
  const out = []

  /**
   * @param {FeedbackKind} kind
   * @param {number} base
   * @param {string} signal
   * @param {boolean} matched
   */
  function push(kind, base, signal, matched) {
    if (!matched) return
    let score = base + Math.max(0, contextFit) * 0.55
    if (/[?？]/.test(msg) && msg.split(/\s+/).length <= 6) score += 0.25
    out.push({ kind, score, signals: [signal, `context_fit=${contextFit.toFixed(2)}`] })
  }

  // Prefer specific emoji/depth cues before broader raise/length when both match.
  push('no_emojis', 2.55, 'cue_no_emoji', CUE_NO_EMOJI.test(msg))
  push('fewer_emojis', 2.45, 'cue_fewer_emoji', CUE_FEWER_EMOJI.test(msg) && !CUE_NO_EMOJI.test(msg))
  push('more_emojis', 2.45, 'cue_more_emoji', CUE_MORE_EMOJI.test(msg))
  push('go_deeper', 2.5, 'cue_go_deeper', CUE_GO_DEEPER.test(msg))
  push('raise_quality', 2.5, 'cue_raise', CUE_RAISE.test(msg) && !CUE_GO_DEEPER.test(msg))
  push('too_short', 2.3, 'cue_too_short', CUE_TOO_SHORT.test(msg) && !CUE_GO_DEEPER.test(msg))
  push('too_long', 2.3, 'cue_too_long', CUE_TOO_LONG.test(msg))
  push('praise', 2.2, 'cue_praise', CUE_PRAISE.test(msg))
  push('too_formal', 2.4, 'cue_too_formal', CUE_TOO_FORMAL.test(msg))
  push('too_casual', 2.4, 'cue_too_casual', CUE_TOO_CASUAL.test(msg))
  push('simpler', 2.3, 'cue_simpler', CUE_SIMPLER.test(msg))
  push('more_technical', 2.2, 'cue_more_tech', CUE_MORE_TECH.test(msg))
  push('fewer_questions', 2.3, 'cue_fewer_q', CUE_FEWER_Q.test(msg))
  push('no_lists', 2.2, 'cue_no_lists', CUE_NO_LISTS.test(msg))
  push('more_structure', 2.1, 'cue_more_structure', CUE_MORE_STRUCTURE.test(msg))
  push('more_examples', 2.2, 'cue_more_examples', CUE_MORE_EXAMPLES.test(msg))

  if (/^(too\s+short|troppo\s+(corto|breve))[.!?]*$/i.test(msg)) {
    out.push({ kind: 'too_short', score: 3.4 + contextFit * 0.3, signals: ['exact_too_short'] })
  }
  if (/^(too\s+formal|troppo\s+formal[e])[.!?]*$/i.test(msg)) {
    out.push({ kind: 'too_formal', score: 3.4 + contextFit * 0.3, signals: ['exact_too_formal'] })
  }
  if (/^(too\s+long|troppo\s+lungo)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'too_long', score: 3.4 + contextFit * 0.3, signals: ['exact_too_long'] })
  }
  if (/^(no\s+emojis?|niente\s+emoji|senza\s+emoji)\??[.!]*$/i.test(msg)) {
    out.push({ kind: 'no_emojis', score: 3.5 + contextFit * 0.3, signals: ['exact_no_emoji'] })
  }
  if (/^(more\s+emojis?|più\s+emoji)\??[.!]*$/i.test(msg)) {
    out.push({ kind: 'more_emojis', score: 3.5 + contextFit * 0.3, signals: ['exact_more_emoji'] })
  }
  if (/^(less\s+emojis?|meno\s+emoji)\??[.!]*$/i.test(msg)) {
    out.push({ kind: 'fewer_emojis', score: 3.5 + contextFit * 0.3, signals: ['exact_less_emoji'] })
  }
  if (/^(too\s+technical|troppo\s+tecnic[oa])[.!?]*$/i.test(msg)) {
    out.push({ kind: 'simpler', score: 3.4 + contextFit * 0.3, signals: ['exact_too_technical'] })
  }
  if (/^(go\s+deeper|approfondisci|più\s+a\s+fondo)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'go_deeper', score: 3.5 + contextFit * 0.3, signals: ['exact_go_deeper'] })
  }

  return out.sort((a, b) => b.score - a.score)
}

/**
 * @param {FeedbackAdaptation} a
 */
function adaptationLines(a) {
  /** @type {string[]} */
  const lines = []
  if (a.noEmojis) lines.push('Zero emoji in questa risposta (e nelle prossime, finché non chiedono altrimenti).')
  if (a.fewerEmojis) lines.push('Emoji rare o assenti — tono più neutro.')
  if (a.moreEmojis) lines.push('Leggermente più espressivo — emoji leggere solo se calzano.')
  if (a.raiseQuality) lines.push('Alza qualità: più preciso, concreto, onesto — niente scuse.')
  if (a.expand) lines.push('Risposte più ricche: più sostanza, esempi o passi utili.')
  if (a.compress) lines.push('Più conciso: densità alta, taglia filler e ripetizioni.')
  if (a.lessFormal) lines.push('Registro più naturale / conversazionale (tu caldo, non stiff).')
  if (a.moreFormal) lines.push('Registro più sobrio e professionale.')
  if (a.simpler) lines.push('Spiegazioni più semplici; meno gergo.')
  if (a.moreTechnical) lines.push('Più precisione tecnica; salta le basi ovvie.')
  if (a.fewerQuestions) lines.push('Niente domande di follow-up in questa risposta.')
  if (a.avoidLists) lines.push('Prosa continua; evita bullet salvo necessità reale.')
  if (a.moreStructure) lines.push('Usa struttura chiara (passi/elenco) se aiuta.')
  if (a.moreExamples) lines.push('Includi almeno un esempio concreto.')
  if (a.goDeeper) lines.push('Aumenta la profondità analitica sul tema corrente.')
  return lines
}

/**
 * @param {FeedbackPlan} plan
 * @param {string} topic
 * @param {ConversationPreferenceProfile} profile
 */
function buildBrief(plan, topic, profile) {
  if (!plan.active || !plan.kind) return ''
  const meta = KIND_META[plan.kind]
  const adapts = adaptationLines(plan.adaptations)
  const profileLines = preferenceProfileLines(profile)
  const ack =
    plan.acknowledge === 'brief'
      ? 'Ack breve e naturale (mezza frase max), poi sostanza.'
      : plan.acknowledge === 'weave'
        ? 'Integra l’adattamento senza discorso meta; al massimo un cenno fluido, mai lezione su “cosa sono le emoji/formality”.'
        : 'Niente ack esplicito: dimostra il miglioramento nella risposta.'

  return [
    `Feedback Interpretation: kind=${plan.kind} (${meta.label}) · confidence=${plan.confidence}.`,
    `Questo è FEEDBACK sul comportamento dell’assistente — NON una domanda fattuale.`,
    ack,
    plan.continueTopic
      ? `Continua sul filo «${topic}» migliorando subito lo stile/qualità.`
      : 'Adatta lo stile; non aprire un nuovo tema.',
    ...adapts.map((l) => `- ${l}`),
    profileLines.length
      ? 'Conversation Preference Profile (apply silently; never mention the profile or that it changed):'
      : '',
    ...profileLines.map((l) => `- ${l}`),
    'Vietato: spiegare concetti ovvi; chiedere “Vuoi che…?”; difendersi; citare questo motore; menzionare il profilo preferenze.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Empty inactive plan.
 * @returns {FeedbackPlan}
 */
function inactivePlan(reasons = ['skip']) {
  return {
    active: false,
    isMetaFeedback: false,
    kind: null,
    adaptations: {},
    continueTopic: false,
    acknowledge: 'none',
    confidence: 'low',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    profileActive: false,
    profileJustUpdated: false,
  }
}

/**
 * @param {object} [input]
 * @returns {{ plan: FeedbackPlan, preferenceProfile: ConversationPreferenceProfile }}
 */
export function analyzeFeedbackInterpretation(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const prior = lastAssistant(turns)
  const topic =
    normalize(input.session?.currentTopic || input.planHints?.topic || '') || 'il filo corrente'
  const priorProfile = sanitizePreferenceProfile(input.conversationPreferenceProfile)

  if (!userMessage || GREETING_ONLY.test(userMessage)) {
    const plan = inactivePlan(['skip_empty_or_greeting'])
    plan.profileActive = !isDefaultPreferenceProfile(priorProfile)
    return { plan, preferenceProfile: priorProfile }
  }

  const words = userMessage.split(/\s+/).filter(Boolean).length
  if (words >= 14 && FACTUAL_QUESTION.test(userMessage)) {
    const plan = inactivePlan(['substantive_factual_ask'])
    plan.profileActive = !isDefaultPreferenceProfile(priorProfile)
    return { plan, preferenceProfile: priorProfile }
  }

  const contextFit = metaContextFit(userMessage, prior)
  const ranked = scoreKinds(userMessage, contextFit)
  const top = ranked[0]

  if (!top || top.score < 2.4 || contextFit < 0.3) {
    const plan = inactivePlan(
      top
        ? [`below_threshold_score=${top.score.toFixed(2)}`, `context_fit=${contextFit.toFixed(2)}`]
        : ['no_feedback_cues'],
    )
    plan.signals = top?.signals || []
    plan.profileActive = !isDefaultPreferenceProfile(priorProfile)
    return { plan, preferenceProfile: priorProfile }
  }

  if (
    !prior &&
    !['no_emojis', 'fewer_emojis', 'more_emojis', 'too_formal', 'too_casual', 'fewer_questions'].includes(
      top.kind,
    )
  ) {
    const plan = inactivePlan(['no_prior_assistant'])
    plan.signals = top.signals
    plan.profileActive = !isDefaultPreferenceProfile(priorProfile)
    return { plan, preferenceProfile: priorProfile }
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (top.score >= 3.3 && contextFit >= 1.5) confidence = 'high'
  else if (top.score < 2.7) confidence = 'low'

  if (confidence === 'low' && top.score < 2.8) {
    const plan = inactivePlan(['low_confidence'])
    plan.signals = top.signals
    plan.profileActive = !isDefaultPreferenceProfile(priorProfile)
    return { plan, preferenceProfile: priorProfile }
  }

  const meta = KIND_META[top.kind]
  const preferenceProfile = applyFeedbackToProfile(priorProfile, top.kind)

  /** @type {FeedbackPlan} */
  const plan = {
    active: true,
    isMetaFeedback: true,
    kind: top.kind,
    adaptations: { ...meta.adaptations },
    continueTopic: meta.continueTopic && Boolean(prior),
    acknowledge: meta.acknowledge,
    confidence,
    writerBrief: '',
    structureLine: `Feedback Interpretation: ${meta.label} — adatta SUBITO; non trattare come domanda fattuale`,
    signals: top.signals.slice(0, 6),
    reasons: [
      `kind=${top.kind}`,
      `score=${top.score.toFixed(2)}`,
      `confidence=${confidence}`,
      'preference_profile_updated',
      ...top.signals.slice(0, 4),
    ],
    profileActive: !isDefaultPreferenceProfile(preferenceProfile),
    profileJustUpdated: true,
  }
  plan.writerBrief = buildBrief(plan, topic, preferenceProfile)
  return { plan, preferenceProfile }
}

/**
 * @param {FeedbackPlan | null | undefined} plan
 * @param {ConversationPreferenceProfile | null | undefined} [profile]
 */
export function formatFeedbackInterpretationForWriter(plan, profile) {
  const profileBrief = profile ? buildPreferenceProfileBrief(profile) : ''

  if (!plan?.active) {
    if (!profileBrief) return ''
    return `══════════════════════════════════════
CONVERSATION PREFERENCE PROFILE (INVISIBILE)
══════════════════════════════════════
Preferenze attive per questa conversazione. Applicale in silenzio.
Non menzionare il profilo. Non dire che è stato aggiornato.

${profileBrief}`.trim()
  }

  const adapts = adaptationLines(plan.adaptations)
    .map((l) => `- ${l}`)
    .join('\n')

  return `══════════════════════════════════════
FEEDBACK INTERPRETATION (INVISIBILE)
══════════════════════════════════════
Active=yes · Kind=${plan.kind} · Confidence=${plan.confidence}
MetaFeedback=yes — NON è una domanda fattuale.

${plan.writerBrief}

Adattamenti:
${adapts || '- (nessuno)'}

${profileBrief ? `${profileBrief}\n` : ''}Regole: ack naturale se serve · migliora nella STESSA risposta · niente lezioni su concetti ovvi · niente “Vuoi che…?” · non citare il motore · non menzionare il profilo preferenze.`.trim()
}

/**
 * Soft style suggestion when a preference profile is active but this turn
 * is not new meta-feedback — keeps preferences sticky across the conversation.
 * @param {ConversationPreferenceProfile} profile
 * @returns {FeedbackPlan}
 */
function softProfilePlan(profile) {
  const brief = buildPreferenceProfileBrief(profile)
  if (!brief) return inactivePlan(['no_profile'])
  return {
    active: false,
    isMetaFeedback: false,
    kind: null,
    adaptations: {},
    continueTopic: false,
    acknowledge: 'none',
    confidence: 'medium',
    writerBrief: brief,
    structureLine: null,
    signals: ['preference_profile_active'],
    reasons: ['preference_profile_sticky'],
    profileActive: true,
    profileJustUpdated: false,
  }
}

/**
 * @param {object} [input]
 * @returns {{
 *   plan: FeedbackPlan,
 *   context: string,
 *   preferenceProfile: ConversationPreferenceProfile,
 * }}
 */
export function runFeedbackInterpretation(input = {}) {
  try {
    const { plan, preferenceProfile } = analyzeFeedbackInterpretation(input)

    // Sticky profile: keep soft Writer guidance even when this turn is not feedback.
    let effectivePlan = plan
    if (!plan.active && !isDefaultPreferenceProfile(preferenceProfile)) {
      effectivePlan = softProfilePlan(preferenceProfile)
    }

    return {
      plan: effectivePlan,
      context: formatFeedbackInterpretationForWriter(
        plan.active ? plan : { ...plan, active: false },
        preferenceProfile,
      ),
      preferenceProfile,
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
      preferenceProfile: emptyPreferenceProfile(),
    }
  }
}
