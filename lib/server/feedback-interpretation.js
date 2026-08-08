/**
 * LAIfe Feedback Interpretation
 *
 * Detect when the user is giving feedback about the assistant itself
 * (style, length, tone, quality, format) — not asking a factual question.
 *
 * Examples:
 *   "No emojis?"     → stop using emojis; adapt now
 *   "You can do better." → raise quality on the same thread
 *   "Too short."     → expand with more substance
 *   "That was nice." → positive feedback; go deeper
 *   "Too formal."    → shift to a more natural register
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
 * @typedef {'no_emojis'|'fewer_emojis'|'raise_quality'|'too_short'|'too_long'|'praise'|'too_formal'|'too_casual'|'simpler'|'more_technical'|'fewer_questions'|'no_lists'|'more_structure'|'more_examples'} FeedbackKind
 */

/**
 * @typedef {object} FeedbackAdaptation
 * @property {boolean} [noEmojis]
 * @property {boolean} [fewerEmojis]
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
 */

/** Soft cues — never sole evidence without meta/context fit */
const CUE_NO_EMOJI =
  /\b(no\s+emojis?|senza\s+emoji|stop\s+(the\s+)?emojis?|niente\s+emoji|togli\s+(le\s+)?emoji|meno\s+emoji|fewer\s+emojis?|emoji\s+off)\b/i

const CUE_RAISE =
  /\b(you\s+can\s+do\s+better|puoi\s+fare\s+di\s+meglio|fai\s+di\s+meglio|try\s+harder|più\s+a\s+fondo|go\s+deeper|be\s+more\s+specific|troppo\s+(generico|vago|superficiale)|that'?s\s+(weak|thin|vague|generic)|non\s+mi\s+convince)\b/i

const CUE_TOO_SHORT =
  /\b(too\s+short|troppo\s+corto|troppo\s+breve|più\s+lungo|more\s+detail|più\s+dettagli|expand|approfondisci|dimmi\s+di\s+più|tell\s+me\s+more)\b/i

const CUE_TOO_LONG =
  /\b(too\s+long|troppo\s+lungo|più\s+breve|shorter|in\s+breve|tl;?dr|sintetizza|meno\s+testo|too\s+verbose|troppo\s+verboso)\b/i

const CUE_PRAISE =
  /\b(that\s+was\s+nice|nice\s+(one|answer|reply)|great\s+answer|good\s+(one|answer|point)|bella\s+risposta|ottima\s+risposta|ben\s+detto|mi\s+è\s+piaciut[oa]|loved\s+(it|that)|that\s+helped|utile,??\s+grazie)\b/i

const CUE_TOO_FORMAL =
  /\b(too\s+formal|troppo\s+formal[e]|meno\s+formal[e]|più\s+casual|more\s+casual|parla\s+normale|less\s+stiff|troppo\s+rigido|relax\s+the\s+tone)\b/i

const CUE_TOO_CASUAL =
  /\b(too\s+casual|troppo\s+informal[e]|più\s+formal[e]|more\s+formal|troppo\s+slang|less\s+slang|più\s+professionale)\b/i

const CUE_SIMPLER =
  /\b(too\s+technical|troppo\s+tecnic[oa]|più\s+semplice|simpler|eli5|in\s+parole\s+semplici|less\s+jargon|meno\s+gergo)\b/i

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
    // Question mark on short style cue is still feedback
    if (/[?？]/.test(msg) && msg.split(/\s+/).length <= 6) score += 0.25
    out.push({ kind, score, signals: [signal, `context_fit=${contextFit.toFixed(2)}`] })
  }

  push('no_emojis', 2.4, 'cue_no_emoji', CUE_NO_EMOJI.test(msg))
  push('raise_quality', 2.5, 'cue_raise', CUE_RAISE.test(msg))
  push('too_short', 2.3, 'cue_too_short', CUE_TOO_SHORT.test(msg))
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

  // Bare "Too short." / "Too formal." without verb — boost if exact-ish
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

  return out.sort((a, b) => b.score - a.score)
}

/**
 * @param {FeedbackAdaptation} a
 */
function adaptationLines(a) {
  /** @type {string[]} */
  const lines = []
  if (a.noEmojis) lines.push('Zero emoji in questa risposta (e nelle prossime, finché non chiedono altrimenti).')
  if (a.fewerEmojis) lines.push('Emoji rare o assenti.')
  if (a.raiseQuality) lines.push('Alza qualità: più preciso, concreto, onesto — niente scuse.')
  if (a.expand) lines.push('Espandi sul filo corrente: più sostanza, esempi o passi utili.')
  if (a.compress) lines.push('Comprimi: densità alta, taglia filler e ripetizioni.')
  if (a.lessFormal) lines.push('Registro più naturale / conversazionale (tu caldo, non stiff).')
  if (a.moreFormal) lines.push('Registro più sobrio e professionale.')
  if (a.simpler) lines.push('Linguaggio più semplice; meno gergo.')
  if (a.moreTechnical) lines.push('Più precisione tecnica; salta le basi ovvie.')
  if (a.fewerQuestions) lines.push('Niente domande di follow-up in questa risposta.')
  if (a.avoidLists) lines.push('Prosa continua; evita bullet salvo necessità reale.')
  if (a.moreStructure) lines.push('Usa struttura chiara (passi/elenco) se aiuta.')
  if (a.moreExamples) lines.push('Includi almeno un esempio concreto.')
  if (a.goDeeper) lines.push('Vai un passo più a fondo sul tema corrente.')
  return lines
}

/**
 * @param {FeedbackPlan} plan
 * @param {string} topic
 */
function buildBrief(plan, topic) {
  if (!plan.active || !plan.kind) return ''
  const meta = KIND_META[plan.kind]
  const adapts = adaptationLines(plan.adaptations)
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
    'Vietato: spiegare concetti ovvi; chiedere “Vuoi che…?”; difendersi; citare questo motore.',
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {FeedbackPlan}
 */
export function analyzeFeedbackInterpretation(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const prior = lastAssistant(turns)
  const topic =
    normalize(input.session?.currentTopic || input.planHints?.topic || '') || 'il filo corrente'

  if (!userMessage || GREETING_ONLY.test(userMessage)) {
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
      reasons: ['skip_empty_or_greeting'],
    }
  }

  // Long substantive asks with topical content → not meta feedback
  const words = userMessage.split(/\s+/).filter(Boolean).length
  if (words >= 14 && FACTUAL_QUESTION.test(userMessage)) {
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
      reasons: ['substantive_factual_ask'],
    }
  }

  const contextFit = metaContextFit(userMessage, prior)
  const ranked = scoreKinds(userMessage, contextFit)
  const top = ranked[0]

  if (!top || top.score < 2.4 || contextFit < 0.3) {
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
      signals: top?.signals || [],
      reasons: top
        ? [`below_threshold_score=${top.score.toFixed(2)}`, `context_fit=${contextFit.toFixed(2)}`]
        : ['no_feedback_cues'],
    }
  }

  // Require prior assistant for most feedback (praise/raise/length about "the answer")
  if (!prior && !['no_emojis', 'fewer_emojis', 'too_formal', 'too_casual', 'fewer_questions'].includes(top.kind)) {
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
      signals: top.signals,
      reasons: ['no_prior_assistant'],
    }
  }

  const meta = KIND_META[top.kind]
  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (top.score >= 3.3 && contextFit >= 1.5) confidence = 'high'
  else if (top.score < 2.7) confidence = 'low'

  if (confidence === 'low' && top.score < 2.8) {
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
      signals: top.signals,
      reasons: ['low_confidence'],
    }
  }

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
      ...top.signals.slice(0, 4),
    ],
  }
  plan.writerBrief = buildBrief(plan, topic)
  return plan
}

/**
 * @param {FeedbackPlan | null | undefined} plan
 */
export function formatFeedbackInterpretationForWriter(plan) {
  if (!plan?.active) return ''

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

Regole: ack naturale se serve · migliora nella STESSA risposta · niente lezioni su concetti ovvi · niente “Vuoi che…?” · non citare il motore.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: FeedbackPlan, context: string }}
 */
export function runFeedbackInterpretation(input = {}) {
  try {
    const plan = analyzeFeedbackInterpretation(input)
    return {
      plan,
      context: formatFeedbackInterpretationForWriter(plan),
    }
  } catch {
    return {
      plan: {
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
        reasons: ['fail_soft'],
      },
      context: '',
    }
  }
}
