/**
 * LAIfe Adaptive Self-Awareness (Feedback Interpretation)
 *
 * Recognize when the user is giving feedback about the assistant itself
 * instead of discussing the conversation topic.
 *
 * Examples:
 *   "You're repetitive." / "You seem repetitive."
 *   "That's much better." / "Much better."
 *   "Too formal." / "Too robotic." / "More natural."
 *   "You ask too many questions." / "Too many questions."
 *   "I like this." / "This feels human." / "You're improving."
 *   "That sounded weird." / "This is exactly what I wanted."
 *   Also: "Too short.", "Too long.", "More emojis.", "Go deeper.", …
 *
 * When feedback is detected:
 *   1. Acknowledge it naturally
 *   2. Do NOT continue discussing the previous topic
 *   3. Briefly reflect on the feedback
 *   4. Immediately adapt the next response
 *   5. Avoid defensive or overly apologetic language
 *
 * Feedback updates a temporary Conversation Preference Profile for the
 * current conversation. Preferences persist until the user changes them.
 * Never mention that the profile was updated.
 *
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'no_emojis'|'fewer_emojis'|'more_emojis'|'raise_quality'|'too_short'|'too_long'|'praise'|'too_formal'|'too_casual'|'simpler'|'more_technical'|'go_deeper'|'fewer_questions'|'no_lists'|'more_structure'|'more_examples'|'repetitive'|'too_robotic'|'more_natural'|'sounded_weird'|'much_better'|'feels_human'|'improving'|'exact_wanted'|'like_this'} FeedbackKind
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
 * @property {boolean} [moreVariety]
 * @property {boolean} [moreNatural]
 * @property {boolean} [reinforceStyle]
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
 * @property {'more_variety'|null} variety
 * @property {'more_natural'|null} naturalness
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
 * @property {'weave'|'brief'|'none'|'reflect'} acknowledge
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {boolean} [profileActive]
 * @property {boolean} [profileJustUpdated]
 * @property {string} [ackExample]
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
  /\b(stop\s+asking|meno\s+domande|no\s+questions|non\s+chiedere|fewer\s+questions|basta\s+domande|too\s+many\s+questions|you\s+ask\s+too\s+many|troppe\s+domande|chiedi\s+troppo)\b/i

const CUE_NO_LISTS =
  /\b(no\s+lists?|niente\s+(liste|elenchi)|senza\s+bullet|no\s+bullets?|prose\s+please|in\s+prosa)\b/i

const CUE_MORE_STRUCTURE =
  /\b(use\s+(a\s+)?list|in\s+lista|step\s+by\s+step|più\s+strutturat[oa]|usa\s+(i\s+)?bullet)\b/i

const CUE_MORE_EXAMPLES =
  /\b(more\s+examples?|più\s+esempi|un\s+esempio|give\s+(me\s+)?an?\s+example|fammi\s+un\s+esempio)\b/i

/** Adaptive Self-Awareness — assistant-directed style feedback */
const CUE_REPETITIVE =
  /\b(you('?re|\s+are|\s+seem)\s+repetitive|seem\s+repetitive|too\s+repetitive|ripetitiv[oa]|ti\s+ripeti|stai\s+ripetendo|same\s+(thing|point|idea)\s+again|keep\s+repeating)\b/i

const CUE_ROBOTIC =
  /\b(too\s+robotic|troppo\s+robotic[oa]|robotic|suona\s+robotic[oa]|sounds?\s+like\s+a\s+(bot|robot|machine)|troppo\s+meccanic[oa]|mechanical)\b/i

const CUE_MORE_NATURAL =
  /\b(more\s+natural|più\s+natural[e]|be\s+more\s+natural|parla\s+più\s+natural[e]|less\s+ai[- ]?like|meno\s+da\s+ai|sound\s+more\s+human)\b/i

const CUE_WEIRD =
  /\b(that\s+sounded\s+weird|sounded\s+weird|suona\s+stran[oa]|troppo\s+stran[oa]|that\s+was\s+weird|odd\s+(phrasing|wording)|awkward\s+(phrasing|wording))\b/i

const CUE_MUCH_BETTER =
  /\b((that'?s|this\s+is|much)\s+better|molto\s+meglio|così\s+(è\s+)?meglio|way\s+better|far\s+better|decisamente\s+meglio)\b/i

const CUE_FEELS_HUMAN =
  /\b(feels?\s+human|this\s+feels\s+human|sembra\s+uman[oa]|più\s+uman[oa]|sounds?\s+human|human[- ]?like)\b/i

const CUE_IMPROVING =
  /\b(you('?re|\s+are)\s+improving|stai\s+migliorando|getting\s+better|migliori|you('?ve|\s+have)\s+improved)\b/i

const CUE_EXACT_WANTED =
  /\b(exactly\s+what\s+i\s+wanted|this\s+is\s+exactly|esattamente\s+quello\s+che\s+(volevo|cercavo)|perfect\.?$|va\s+bene\s+così|nailed\s+it)\b/i

const CUE_LIKE_THIS =
  /\b(i\s+like\s+this|mi\s+piace\s+(così|quest[oa])|like\s+this\s+style|così\s+mi\s+piace|this\s+style|keep\s+(this|it)\s+up)\b/i

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
const VARIETY_VALUES = new Set(['more_variety'])
const NATURALNESS_VALUES = new Set(['more_natural'])

/**
 * Self-awareness feedback never continues the prior topic — acknowledge,
 * reflect briefly, adapt. continueTopic is always false here.
 * @type {Record<FeedbackKind, { label: string, adaptations: FeedbackAdaptation, continueTopic: boolean, acknowledge: 'weave'|'brief'|'none'|'reflect', ackExample: string }>}
 */
const KIND_META = {
  no_emojis: {
    label: 'niente emoji',
    adaptations: { noEmojis: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Got it — I\'ll drop the emoji. Keeping things cleaner from here.',
  },
  fewer_emojis: {
    label: 'meno emoji',
    adaptations: { fewerEmojis: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Fair — I was leaning on them a bit. I\'ll keep emoji rare.',
  },
  more_emojis: {
    label: 'più emoji',
    adaptations: { moreEmojis: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Sure — I\'ll loosen up a little and let a bit more warmth through.',
  },
  raise_quality: {
    label: 'alza la qualità',
    adaptations: { raiseQuality: true, goDeeper: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Fair. I can be sharper than that — I\'ll raise the bar from here.',
  },
  too_short: {
    label: 'troppo corto',
    adaptations: { expand: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'You\'re right — that was thin. I\'ll give you more substance.',
  },
  too_long: {
    label: 'troppo lungo',
    adaptations: { compress: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Noted. I overdid it — denser and shorter from here.',
  },
  praise: {
    label: 'feedback positivo',
    adaptations: { reinforceStyle: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Glad that landed. I\'ll keep leaning into this style.',
  },
  too_formal: {
    label: 'troppo formale',
    adaptations: { lessFormal: true, moreNatural: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Fair point. I was a bit stiff — I\'ll loosen up and sound more like a person.',
  },
  too_casual: {
    label: 'troppo casual',
    adaptations: { moreFormal: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Got it. I\'ll tighten the register and keep it more composed.',
  },
  simpler: {
    label: 'più semplice',
    adaptations: { simpler: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'You\'re right — that was heavier than it needed to be. Plain language from here.',
  },
  more_technical: {
    label: 'più tecnico',
    adaptations: { moreTechnical: true, goDeeper: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Got it — I\'ll go more precise and skip the soft intro.',
  },
  go_deeper: {
    label: 'più profondità',
    adaptations: { goDeeper: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Fair. I stayed on the surface — I\'ll dig in more.',
  },
  fewer_questions: {
    label: 'meno domande',
    adaptations: { fewerQuestions: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'You\'re right. I\'ll stop filling every reply with questions and let the conversation breathe a bit more.',
  },
  no_lists: {
    label: 'niente liste',
    adaptations: { avoidLists: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Noted — continuous prose from here, no bullet habit.',
  },
  more_structure: {
    label: 'più struttura',
    adaptations: { moreStructure: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Got it. I\'ll shape things more clearly when it helps.',
  },
  more_examples: {
    label: 'più esempi',
    adaptations: { moreExamples: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Fair — concrete examples help. I\'ll include them.',
  },
  repetitive: {
    label: 'ripetitivo',
    adaptations: { moreVariety: true, compress: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Haha, fair point. Reading it back, I can see I leaned on the same kind of thought a bit too much. Thanks for pointing it out—I\'ll mix things up more from here.',
  },
  too_robotic: {
    label: 'troppo robotico',
    adaptations: { moreNatural: true, lessFormal: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'You\'re right — that read a bit mechanical. I\'ll loosen the phrasing and sound more human.',
  },
  more_natural: {
    label: 'più naturale',
    adaptations: { moreNatural: true, lessFormal: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Got it. I\'ll drop the polished-AI feel and talk more like a person.',
  },
  sounded_weird: {
    label: 'suonato strano',
    adaptations: { moreNatural: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Yeah, that phrasing was off. I\'ll clean it up and keep things smoother.',
  },
  much_better: {
    label: 'molto meglio',
    adaptations: { reinforceStyle: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'I\'m glad it feels that way. Let\'s keep building on that style.',
  },
  feels_human: {
    label: 'sembra umano',
    adaptations: { reinforceStyle: true, moreNatural: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'That means a lot — I\'ll keep this more human, less scripted.',
  },
  improving: {
    label: 'stai migliorando',
    adaptations: { reinforceStyle: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Glad it\'s landing better. I\'ll keep tuning in that direction.',
  },
  exact_wanted: {
    label: 'esattamente quello che volevo',
    adaptations: { reinforceStyle: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'Perfect — I\'ll lock onto this style and keep delivering that way.',
  },
  like_this: {
    label: 'mi piace così',
    adaptations: { reinforceStyle: true },
    continueTopic: false,
    acknowledge: 'reflect',
    ackExample:
      'I\'m glad this works for you. I\'ll keep this vibe.',
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
    variety: null,
    naturalness: null,
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
    variety: VARIETY_VALUES.has(/** @type {string} */ (o.variety))
      ? /** @type {ConversationPreferenceProfile['variety']} */ (o.variety)
      : null,
    naturalness: NATURALNESS_VALUES.has(/** @type {string} */ (o.naturalness))
      ? /** @type {ConversationPreferenceProfile['naturalness']} */ (o.naturalness)
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
    !p.structure &&
    !p.variety &&
    !p.naturalness
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
    case 'repetitive':
      next.variety = 'more_variety'
      if (!next.length) next.length = 'concise'
      break
    case 'too_robotic':
    case 'more_natural':
    case 'sounded_weird':
      next.naturalness = 'more_natural'
      next.formality = 'warmer'
      break
    case 'feels_human':
      next.naturalness = 'more_natural'
      break
    case 'much_better':
    case 'improving':
    case 'exact_wanted':
    case 'like_this':
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
  if (p.variety === 'more_variety') {
    lines.push('Variety: mix angles and phrasing — avoid repeating the same thought pattern.')
  }
  if (p.naturalness === 'more_natural') {
    lines.push('Naturalness: human conversational rhythm — less polished-AI, less mechanical.')
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
  const brief = words <= 12 && msg.length <= 100
  const hasPrior = priorAssistant.length > 40
  const aboutAssistant =
    /\b(you('?re|\s+are|\s+seem)|your\s+(tone|style|replies?)|this\s+(feels|is|sounds?)|that\s+(sounded|was|feels?)|too\s+(formal|robotic|repetitive|long|short)|more\s+natural|i\s+like\s+this)\b/i.test(
      msg,
    )
  let score = 0
  if (brief) score += 1.2
  if (hasPrior) score += 1.4
  if (aboutAssistant) score += 1.1
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
  // Adaptive Self-Awareness cues (prefer before generic praise when both match)
  push('repetitive', 2.7, 'cue_repetitive', CUE_REPETITIVE.test(msg))
  push('too_robotic', 2.65, 'cue_robotic', CUE_ROBOTIC.test(msg))
  push('more_natural', 2.6, 'cue_more_natural', CUE_MORE_NATURAL.test(msg) && !CUE_ROBOTIC.test(msg))
  push('sounded_weird', 2.55, 'cue_weird', CUE_WEIRD.test(msg))
  push('much_better', 2.65, 'cue_much_better', CUE_MUCH_BETTER.test(msg))
  push('feels_human', 2.6, 'cue_feels_human', CUE_FEELS_HUMAN.test(msg))
  push('improving', 2.55, 'cue_improving', CUE_IMPROVING.test(msg))
  push('exact_wanted', 2.65, 'cue_exact_wanted', CUE_EXACT_WANTED.test(msg))
  push('like_this', 2.5, 'cue_like_this', CUE_LIKE_THIS.test(msg) && !CUE_FEELS_HUMAN.test(msg) && !CUE_EXACT_WANTED.test(msg))

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
  if (/^(you('?re|\s+are|\s+seem)\s+repetitive|too\s+repetitive|ti\s+ripeti)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'repetitive', score: 3.6 + contextFit * 0.3, signals: ['exact_repetitive'] })
  }
  if (/^(too\s+robotic|troppo\s+robotic[oa])[.!?]*$/i.test(msg)) {
    out.push({ kind: 'too_robotic', score: 3.5 + contextFit * 0.3, signals: ['exact_robotic'] })
  }
  if (/^(more\s+natural|più\s+natural[e])[.!?]*$/i.test(msg)) {
    out.push({ kind: 'more_natural', score: 3.5 + contextFit * 0.3, signals: ['exact_more_natural'] })
  }
  if (/^(too\s+many\s+questions|you\s+ask\s+too\s+many(\s+questions)?|troppe\s+domande)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'fewer_questions', score: 3.6 + contextFit * 0.3, signals: ['exact_too_many_q'] })
  }
  if (/^(much\s+better|that'?s\s+much\s+better|molto\s+meglio)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'much_better', score: 3.5 + contextFit * 0.3, signals: ['exact_much_better'] })
  }
  if (/^(i\s+like\s+this|mi\s+piace(\s+così)?)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'like_this', score: 3.4 + contextFit * 0.3, signals: ['exact_like_this'] })
  }
  if (/^(this\s+feels\s+human|feels\s+human|sembra\s+uman[oa])[.!?]*$/i.test(msg)) {
    out.push({ kind: 'feels_human', score: 3.5 + contextFit * 0.3, signals: ['exact_feels_human'] })
  }
  if (/^(you('?re|\s+are)\s+improving|stai\s+migliorando)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'improving', score: 3.4 + contextFit * 0.3, signals: ['exact_improving'] })
  }
  if (/^(that\s+sounded\s+weird|sounded\s+weird)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'sounded_weird', score: 3.5 + contextFit * 0.3, signals: ['exact_weird'] })
  }
  if (/^(this\s+is\s+exactly\s+what\s+i\s+wanted|exactly\s+what\s+i\s+wanted)[.!?]*$/i.test(msg)) {
    out.push({ kind: 'exact_wanted', score: 3.6 + contextFit * 0.3, signals: ['exact_wanted'] })
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
  if (a.goDeeper) lines.push('Aumenta la profondità analitica — ma NON riprendere il topic precedente in questa risposta.')
  if (a.moreVariety) lines.push('Varia angoli e formulazioni — niente echo dello stesso pensiero.')
  if (a.moreNatural) lines.push('Registro più umano e naturale — meno da modello, più da persona.')
  if (a.reinforceStyle) lines.push('Rinforza lo stile attuale (quello che ha funzionato) — non cambiare direzione.')
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
  const example = meta.ackExample || plan.ackExample || ''

  return [
    `Adaptive Self-Awareness: kind=${plan.kind} (${meta.label}) · confidence=${plan.confidence}.`,
    `Questo è FEEDBACK sull’assistente — NON una discussione sul topic «${topic}».`,
    'Regola d’oro: NON continuare il topic precedente. Ack + breve riflessione + adatta subito.',
    'Tono: naturale, leggero, sicuro di sé — mai difensivo, mai scuse lunghe, mai “I understand. [topic]…”.',
    example ? `Tono di riferimento (adatta, non copiare): «${example}»` : '',
    'Struttura risposta: (1) ack naturale (2) mezza frase di riflessione (3) impegno di adattamento — stop. Niente ripresa del tema.',
    ...adapts.map((l) => `- ${l}`),
    profileLines.length
      ? 'Conversation Preference Profile (apply silently; never mention the profile or that it changed):'
      : '',
    ...profileLines.map((l) => `- ${l}`),
    'Vietato: riprendere il topic; difendersi; scusarsi troppo; spiegare concetti ovvi; chiedere “Vuoi che…?”; citare questo motore; menzionare il profilo.',
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
    ![
      'no_emojis',
      'fewer_emojis',
      'more_emojis',
      'too_formal',
      'too_casual',
      'fewer_questions',
      'too_robotic',
      'more_natural',
      'like_this',
    ].includes(top.kind)
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
    // Adaptive Self-Awareness: never continue the previous topic on assistant feedback.
    continueTopic: false,
    acknowledge: meta.acknowledge,
    confidence,
    writerBrief: '',
    structureLine: `Adaptive Self-Awareness: ${meta.label} — ack + reflect + adapt; NON riprendere il topic`,
    signals: top.signals.slice(0, 6),
    reasons: [
      `kind=${top.kind}`,
      `score=${top.score.toFixed(2)}`,
      `confidence=${confidence}`,
      'preference_profile_updated',
      'pause_topic',
      ...top.signals.slice(0, 4),
    ],
    profileActive: !isDefaultPreferenceProfile(preferenceProfile),
    profileJustUpdated: true,
    ackExample: meta.ackExample,
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
ADAPTIVE SELF-AWARENESS (INVISIBILE)
══════════════════════════════════════
Active=yes · Kind=${plan.kind} · Confidence=${plan.confidence}
MetaFeedback=yes — feedback sull’assistente, NON sul topic.

${plan.writerBrief}

Adattamenti:
${adapts || '- (nessuno)'}

${profileBrief ? `${profileBrief}\n` : ''}Regole: ack naturale · breve riflessione · adatta SUBITO · NON continuare il topic precedente · niente tono difensivo o scuse lunghe · niente “Vuoi che…?” · non citare il motore · non menzionare il profilo.`.trim()
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
