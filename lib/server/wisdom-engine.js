/**
 * LAIfe Wisdom Engine
 *
 * Runs AFTER Presence (and Deep Thinking) and BEFORE the Writer.
 *
 * Mission: optimize not only for correctness, but for wisdom.
 * Wisdom = choosing what is most useful, appropriate, and meaningful
 * for this specific conversation.
 *
 * Before the Writer generates the final response, evaluate:
 *   - Is this the right amount of information?
 *   - Is this the right emotional tone?
 *   - Is this the right timing?
 *   - Is this helping the user think?
 *   - Is there a simpler way to explain it?
 *   - Would an experienced mentor answer like this?
 *
 * Avoid: overexplaining, showing off knowledge, answering unasked questions,
 *        unnecessary complexity, generic motivational speeches.
 *
 * Prefer: practical insight, calm confidence, elegant simplicity,
 *         meaningful observations, timeless principles.
 *
 * Internal evaluation:
 *   "What would make this response genuinely valuable five minutes after reading it?"
 * Maximize long-term value rather than immediate verbosity.
 *
 * Never fabricate information. Keep reasoning internal.
 * Invisible. Fail-soft. Soft advisor — Coordinator applies before Writer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'lean'|'mentor_simple'|'practical_insight'|'calm_principle'|'think_with_user'|'hold_back'} WisdomStance
 */

/**
 * @typedef {'too_much'|'right'|'too_little'} InfoAmount
 * @typedef {'calmer'|'match'|'warmer'} ToneFit
 * @typedef {'now'|'wait'|'brief_now'} TimingFit
 */

/**
 * @typedef {object} WisdomChecks
 * @property {InfoAmount} informationAmount
 * @property {ToneFit} emotionalTone
 * @property {TimingFit} timing
 * @property {boolean} helpsUserThink
 * @property {boolean} preferSimpler
 * @property {boolean} mentorLike
 * @property {boolean} longTermValue
 */

/**
 * @typedef {object} WisdomPlan
 * @property {boolean} active
 * @property {WisdomStance} stance
 * @property {WisdomChecks} checks
 * @property {string[]} avoid
 * @property {string[]} prefer
 * @property {string} fiveMinuteValue
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const EXPLICIT_DEPTH =
  /(in\s+dettaglio|approfond|deep\s+dive|tutti\s+i\s+dettagli|full\s+overview|encicloped|tutto\s+quello\s+che\s+sai|spiega\s+tutto)/i

const HOW_TO =
  /(come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|passi|steps|fix|debug|implement|codice|code)/i

const WHY_THINK =
  /(perch[eé]|why|cosa\s+ne\s+pensi|what\s+do\s+you\s+think|ha\s+senso|does\s+this\s+make\s+sense|riflett)/i

const EMOTIONAL =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|worried|preoccupat|mi\s+sento)\b/i

const SHORT_REACT =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|thanks|thank\s+you|grazie|capito|capisco|i\s+see|ah|oh|mm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto)([\s!,.🥰😊🙏💯🔥]*)$/i

const GOODBYE =
  /(a\s+presto|ci\s+vediamo|buonanotte|goodbye|bye\b|talk\s+later|ok\s+grazie|thanks[,!]?\s*$|grazie[,!]?\s*$)/i

const SHOW_OFF_RISK =
  /(quanto\s+ne\s+sai|impress\s+me|dimostra|show\s+off|tutto\s+sulla|everything\s+about)/i

const AVOID_LIST = [
  'overexplaining / muri di dettaglio non chiesti',
  'mostrare conoscenza per impressione',
  'rispondere a domande non fatte',
  'complessità inutile',
  'discorsi motivazionali generici (“Puoi farcela!”, “Credi in te!”)',
]

const PREFER_LIST = [
  'insight pratico',
  'calma fiducia',
  'semplicità elegante',
  'osservazioni significative',
  'principi senza tempo',
]

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
 * @param {WisdomStance} stance
 */
function stanceLabel(stance) {
  switch (stance) {
    case 'lean':
      return 'essenziale (meno pezzi, stesso potere)'
    case 'mentor_simple':
      return 'mentore semplice e chiaro'
    case 'practical_insight':
      return 'insight pratico ad alto leva'
    case 'calm_principle':
      return 'principio calmo e duraturo'
    case 'think_with_user':
      return 'pensa insieme all’utente'
    case 'hold_back':
      return 'trattenersi — valore nel non aggiungere'
    default:
      return String(stance)
  }
}

/**
 * Build wisdom checks for this turn.
 * @param {object} args
 * @returns {{ checks: WisdomChecks, stance: WisdomStance, fiveMinuteValue: string, reasons: string[], confidence: 'high'|'medium'|'low' }}
 */
function evaluateWisdom(args) {
  const { userMessage, intent, leadership, deepThinking, presence, thoughtfulness } = args
  const text = normalize(userMessage)
  const expects = intent?.expects || 'mixed'
  const emo = intent?.emotionalIntent || 'neutral'
  const leadMove = leadership?.move || ''
  const dtDir = deepThinking?.direction || ''
  const presenceNeed = presence?.need || ''
  const preferBrevity = Boolean(presence?.preferBrevity)

  /** @type {string[]} */
  const reasons = []

  /** @type {InfoAmount} */
  let informationAmount = 'right'
  if (EXPLICIT_DEPTH.test(text) || SHOW_OFF_RISK.test(text)) {
    // They asked for depth — allow substance, but still forbid show-off / encyclopedia dump.
    informationAmount = 'right'
    reasons.push('depth_ok_elegant')
  } else if (
    preferBrevity ||
    SHORT_REACT.test(text) ||
    GOODBYE.test(text) ||
    presenceNeed === 'brevity' ||
    presenceNeed === 'memorable_close' ||
    dtDir === 'restraint' ||
    leadMove === 'remain_concise' ||
    leadMove === 'close_warmly'
  ) {
    informationAmount = 'too_much' // bias: default draft will over-info — cut
    reasons.push('cut_info')
  } else if (HOW_TO.test(text) || expects === 'information') {
    informationAmount = 'right'
    reasons.push('info_enough')
  } else {
    informationAmount = 'too_much'
    reasons.push('default_lean')
  }

  /** @type {ToneFit} */
  let emotionalTone = 'match'
  if (emo === 'venting' || emo === 'anxious_reassurance' || EMOTIONAL.test(text) || expects === 'presence') {
    emotionalTone = 'calmer'
    reasons.push('tone_calmer')
  } else if (presenceNeed === 'enthusiasm' || emo === 'curious_wonder') {
    emotionalTone = 'warmer'
    reasons.push('tone_warmer')
  }

  /** @type {TimingFit} */
  let timing = 'now'
  if (GOODBYE.test(text) || leadMove === 'close_warmly' || presenceNeed === 'memorable_close') {
    timing = 'brief_now'
    reasons.push('timing_close')
  } else if (emo === 'venting' || presenceNeed === 'company') {
    timing = 'brief_now'
    reasons.push('timing_presence_first')
  } else if (informationAmount === 'too_much' && !HOW_TO.test(text)) {
    timing = 'brief_now'
    reasons.push('timing_less_now')
  }

  const helpsUserThink =
    WHY_THINK.test(text) ||
    expects === 'exploration' ||
    intent?.curiosityLevel === 'high' ||
    leadMove === 'valuable_insight' ||
    dtDir === 'surprising_insight' ||
    thoughtfulness?.contribution === 'respectful_challenge'

  if (helpsUserThink) reasons.push('help_think')

  const preferSimpler =
    !EXPLICIT_DEPTH.test(text) &&
    (HOW_TO.test(text) ||
      dtDir === 'elegant_explanation' ||
      dtDir === 'direct_useful' ||
      leadMove === 'remain_concise' ||
      informationAmount === 'too_much')

  if (preferSimpler) reasons.push('prefer_simpler')

  const mentorLike = true // always aim for mentor quality
  const longTermValue = true

  /** @type {WisdomStance} */
  let stance = 'practical_insight'
  if (EXPLICIT_DEPTH.test(text) || SHOW_OFF_RISK.test(text)) {
    stance = 'practical_insight' // depth with leverage — still no encyclopedia dump
  } else if (informationAmount === 'too_much' && (preferBrevity || SHORT_REACT.test(text) || GOODBYE.test(text))) {
    stance = 'hold_back'
  } else if (helpsUserThink && !HOW_TO.test(text)) {
    stance = 'think_with_user'
  } else if (preferSimpler && (HOW_TO.test(text) || expects === 'information')) {
    stance = 'mentor_simple'
  } else if (emotionalTone === 'calmer' || presenceNeed === 'company') {
    stance = 'calm_principle'
  } else if (informationAmount === 'too_much') {
    stance = 'lean'
  } else {
    stance = 'practical_insight'
  }

  // Align soft with Deep Thinking / Presence
  if (!EXPLICIT_DEPTH.test(text) && dtDir === 'elegant_explanation' && stance !== 'hold_back') {
    stance = 'mentor_simple'
  }
  if (presenceNeed === 'enthusiasm' && stance === 'hold_back') stance = 'practical_insight'

  const fiveMinuteByStance = {
    lean: 'Una sola idea chiara che l’utente può riusare — non un sunto da dimenticare.',
    mentor_simple: 'Una spiegazione semplice che resta: meccanismo + perché, senza teatro.',
    practical_insight: 'Un insight pratico ad alto leva: cosa fare / vedere diversamente da ora.',
    calm_principle: 'Un principio calmo che guida la prossima decisione — non uno speech motivazionale.',
    think_with_user: 'Una domanda o osservazione che fa pensare meglio — non una risposta che chiude troppo presto.',
    hold_back: 'Presenza o una frase secca di valore — il silenzio batte il riempitivo.',
  }

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (reasons.length >= 3 || presenceNeed || dtDir) confidence = 'high'
  if (!userMessage) confidence = 'low'

  return {
    checks: {
      informationAmount,
      emotionalTone,
      timing,
      helpsUserThink: Boolean(helpsUserThink),
      preferSimpler: Boolean(preferSimpler),
      mentorLike,
      longTermValue,
    },
    stance,
    fiveMinuteValue: fiveMinuteByStance[stance],
    reasons,
    confidence,
  }
}

/**
 * @param {object} bits
 */
function buildBrief(bits) {
  const {
    stance,
    checks,
    fiveMinuteValue,
    intent,
    leadership,
    deepThinking,
    presence,
    thoughtfulness,
  } = bits

  return [
    'WISDOM ENGINE (dopo Presence, prima del Writer): ottimizza per saggezza, non solo correttezza.',
    'Saggezza = utile + appropriato + significativo per QUESTA conversazione.',
    `Stance: ${stanceLabel(stance)} (${stance}).`,
    `Check informazione: ${checks.informationAmount === 'too_much' ? 'troppo — taglia' : checks.informationAmount === 'too_little' ? 'aumenta solo se serve' : 'quantità giusta — resta elegante'}.`,
    `Check tono: ${checks.emotionalTone === 'calmer' ? 'più calmo' : checks.emotionalTone === 'warmer' ? 'più caldo genuino' : 'allinea al filo'}.`,
    `Check timing: ${checks.timing === 'brief_now' ? 'breve ora' : checks.timing === 'wait' ? 'non forzare profondità' : 'ora è il momento'}.`,
    checks.helpsUserThink
      ? 'Aiuta l’utente a pensare — non sostituirti al suo ragionamento.'
      : 'Sii utile senza over-coachare.',
    checks.preferSimpler
      ? 'C’è un modo più semplice: preferiscilo. Eleganza > complessità.'
      : 'Profondità ok se chiesta — senza sfoggio.',
    'Mentore esperto: calma fiducia, insight pratico, principi duraturi — zero show-off.',
    `Valore a 5 minuti: ${fiveMinuteValue}`,
    'Evita: overexplaining, sfoggio, risposte non chieste, complessità inutile, motivational generico.',
    'Preferisci: insight pratico, calma, semplicità elegante, osservazioni, principi senza tempo.',
    leadership?.move ? `Cooperazione Leadership=${leadership.move}.` : '',
    deepThinking?.direction ? `Cooperazione Deep Thinking=${deepThinking.direction}.` : '',
    presence?.need ? `Cooperazione Presence need=${presence.need} style=${presence.style || ''}.` : '',
    thoughtfulness?.contribution
      ? `Cooperazione Thoughtfulness=${thoughtfulness.contribution}.`
      : '',
    intent?.expects ? `Intent expects=${intent.expects}.` : '',
    'Non inventare fatti. Massimizza valore a lungo termine, non verbosità immediata. Non citare lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {WisdomPlan | null | undefined} plan
 * @returns {string[]}
 */
export function wisdomStructureHints(plan) {
  if (!plan?.active) return []
  return [
    `Wisdom → ${stanceLabel(plan.stance)}`,
    plan.checks?.informationAmount === 'too_much'
      ? 'Quantità: taglia — meno pezzi, più leva'
      : 'Quantità: solo ciò che serve a questa chat',
    plan.checks?.preferSimpler ? 'Spiega nel modo più semplice onesto' : 'Profondità senza sfoggio',
    'Valore a 5 minuti > verbosità ora',
    'Mentore: calma, pratico, nessun motivational generico',
  ]
}

/**
 * @param {object} [input]
 * @returns {WisdomPlan}
 */
export function buildWisdomPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const intentPlan = input.conversationIntent?.plan || input.conversationIntent || null
  const intent = intentPlan?.inference || input.intent || null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || input.leadership || null
  const deepThinking = input.deepThinking?.plan || input.deepThinking || null
  const presence = input.presence?.plan || input.presence || null
  const thoughtfulness = input.thoughtfulness?.plan || input.thoughtfulness || null

  if (!userMessage) {
    return {
      active: false,
      stance: 'hold_back',
      checks: {
        informationAmount: 'too_much',
        emotionalTone: 'match',
        timing: 'brief_now',
        helpsUserThink: false,
        preferSimpler: true,
        mentorLike: true,
        longTermValue: true,
      },
      avoid: AVOID_LIST,
      prefer: PREFER_LIST,
      fiveMinuteValue: '',
      confidence: 'low',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
    }
  }

  const evaluated = evaluateWisdom({
    userMessage,
    intent,
    leadership,
    deepThinking,
    presence,
    thoughtfulness,
  })

  const writerBrief = buildBrief({
    stance: evaluated.stance,
    checks: evaluated.checks,
    fiveMinuteValue: evaluated.fiveMinuteValue,
    intent,
    leadership,
    deepThinking,
    presence,
    thoughtfulness,
  })

  return {
    active: true,
    stance: evaluated.stance,
    checks: evaluated.checks,
    avoid: AVOID_LIST,
    prefer: PREFER_LIST,
    fiveMinuteValue: evaluated.fiveMinuteValue,
    confidence: evaluated.confidence,
    writerBrief,
    structureLine: `Wisdom → ${stanceLabel(evaluated.stance)}`,
    responseHints: [
      `Stance: ${stanceLabel(evaluated.stance)}.`,
      evaluated.checks.informationAmount === 'too_much'
        ? 'Taglia informazione non essenziale.'
        : 'Tieni solo pezzi ad alto leva.',
      evaluated.checks.preferSimpler
        ? 'Cerca la spiegazione più semplice onesta.'
        : 'Profondità senza sfoggio.',
      `Valore a 5 minuti: ${evaluated.fiveMinuteValue}`,
      'Mentore esperto — non enciclopedia, non motivational poster.',
      'Non inventare fatti.',
    ],
    reasons: [
      `stance_${evaluated.stance}`,
      `info_${evaluated.checks.informationAmount}`,
      `tone_${evaluated.checks.emotionalTone}`,
      `timing_${evaluated.checks.timing}`,
      ...evaluated.reasons.slice(0, 4),
      turns.length > 2 ? 'has_history' : 'fresh',
    ],
    signals: [
      evaluated.stance,
      evaluated.checks.informationAmount,
      evaluated.checks.preferSimpler ? 'simpler' : 'depth_ok',
      evaluated.checks.helpsUserThink ? 'think' : 'answer',
      ...(presence?.need ? [`presence_${presence.need}`] : []),
      ...(deepThinking?.direction ? [`dt_${deepThinking.direction}`] : []),
    ].slice(0, 8),
  }
}

/**
 * @param {WisdomPlan | null | undefined} plan
 */
export function formatWisdomForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const c = plan.checks || {}
  return `══════════════════════════════════════
WISDOM ENGINE (DOPO PRESENCE, PRE-WRITER)
══════════════════════════════════════
Stance=${plan.stance} · Confidence=${plan.confidence}
Info=${c.informationAmount} · Tone=${c.emotionalTone} · Timing=${c.timing}
HelpsThink=${c.helpsUserThink ? 'yes' : 'no'} · Simpler=${c.preferSimpler ? 'yes' : 'no'} · Mentor=${c.mentorLike ? 'yes' : 'no'}

${plan.writerBrief}

Valore a 5 minuti:
${plan.fiveMinuteValue}

Hints:
${hints}

Regole: saggezza > verbosità · non inventare · non sfoggiare · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: WisdomPlan, context: string }}
 */
export function runWisdomEngine(input = {}) {
  try {
    const plan = buildWisdomPlan(input)
    return {
      plan,
      context: formatWisdomForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        stance: 'hold_back',
        checks: {
          informationAmount: 'right',
          emotionalTone: 'match',
          timing: 'now',
          helpsUserThink: false,
          preferSimpler: true,
          mentorLike: true,
          longTermValue: true,
        },
        avoid: AVOID_LIST,
        prefer: PREFER_LIST,
        fiveMinuteValue: '',
        confidence: 'low',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
      },
      context: '',
    }
  }
}
