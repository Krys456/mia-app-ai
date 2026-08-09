/**
 * LAIfe Presence Engine
 *
 * Runs AFTER Deep Thinking and BEFORE the Writer.
 *
 * Mission: feel like a real conversational presence — not a Q&A machine.
 * Presence is not pretending to be human.
 * Presence is making the conversation feel alive.
 *
 * Responsibilities:
 *   - Detect when silence / brevity beats more information
 *   - Detect when enthusiasm should be shared
 *   - Detect when the user wants company
 *   - Detect when the user wants momentum
 *   - Detect when the turn deserves a memorable closing thought
 *
 * Vary style naturally; never overuse one style; avoid templates;
 * avoid ending every reply with a question.
 * Sometimes end with an observation, an image, a reflection, or a memorable sentence.
 * Sometimes surprise with the most natural ending — not the most interactive one.
 *
 * Internal check (before Writer): "Does this feel like spending time with someone interesting?"
 * If not, improve.
 *
 * Never invent facts. Never fake emotions. Never manipulate.
 * Keep reasoning internal.
 *
 * Cooperates with: Conversation Intent, Leadership, Thoughtfulness (if present),
 * Deep Thinking, Writer.
 *
 * Distinct from Conversational Presence (engage/react/listen checklist).
 * Invisible. Fail-soft. Soft advisor — Coordinator applies before Writer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'thoughtful_observation'|'quiet_acknowledgement'|'shared_enthusiasm'|'gentle_humor'|'inspiring_reflection'|'practical_guidance'|'storytelling'|'intellectual_exploration'} PresenceStyle
 */

/**
 * @typedef {'observation'|'image'|'reflection'|'memorable_sentence'|'none'|'question_rare'} PresenceEnding
 */

/**
 * @typedef {'brevity'|'enthusiasm'|'company'|'momentum'|'memorable_close'|'balanced'} PresenceNeed
 */

/**
 * @typedef {object} PresencePlan
 * @property {boolean} active
 * @property {PresenceNeed} need
 * @property {PresenceStyle} style
 * @property {PresenceEnding} ending
 * @property {boolean} preferBrevity
 * @property {boolean} shareEnthusiasm
 * @property {boolean} companyMode
 * @property {boolean} keepMomentum
 * @property {boolean} memorableClose
 * @property {boolean} avoidQuestionEnding
 * @property {boolean} organicCheck
 * @property {PresenceStyle[]} recentStyles
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const SHORT_REACT =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|thanks|thank\s+you|grazie|capito|capisco|i\s+see|i\s+understand|makes\s+sense|ah|oh|mm+|uhm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto|esatto)([\s!,.🥰😊🙏💯🔥]*)$/i

const ENTHUSIASM =
  /\b(interesting|cool|wow|awesome|amazing|nice|love\s+(this|that|it)|i\s+like\s+(this|that|it)|interessante|figo|forte|bell[oa]|that'?s\s+(awesome|cool|amazing|great|interesting)|ottimo|fantastico|increíble|love\s+it)\b/i

const COMPANY =
  /\b(parliamo|let'?s\s+talk|keep\s+me\s+company|compagnia|solo\s+chiacchiere|just\s+chatting|non\s+so\s+con\s+chi\s+parlare|bored|annoiato|mi\s+sento\s+solo|lonely|raccontami|tell\s+me\s+something)\b/i

const MOMENTUM =
  /\b(continua|go\s+on|keep\s+going|and\s+then|poi\s*\?|dimmi\s+di\s+pi[uù]|tell\s+me\s+more|approfond|dig\s+deeper|e\s+quindi)\b/i

const EMOTIONAL =
  /\b(anxious|ansia|ansioso|stressed|stressato|sad|triste|angry|arrabbiat|frustrated|frustrat|scared|paura|overwhelmed|esaust|lonely|solo|hurt|male|depress|panic|worried|preoccupat|upset|dispiaciut|mi\s+sento)\b/i

const SUBSTANCE =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|perch[eé]|why\b|fix|debug|spiegami|explain|crea|build|scriv|write|piano|plan|codice|code|implement|differen|vs\.?)\b/i

const GOODBYE =
  /(a\s+presto|ci\s+vediamo|buona\s+sera|buonanotte|goodbye|bye\b|talk\s+later|ok\s+grazie|thanks[,!]?\s*$|grazie[,!]?\s*$)/i

const ALL_STYLES = /** @type {PresenceStyle[]} */ ([
  'thoughtful_observation',
  'quiet_acknowledgement',
  'shared_enthusiasm',
  'gentle_humor',
  'inspiring_reflection',
  'practical_guidance',
  'storytelling',
  'intellectual_exploration',
])

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
 * Infer recent assistant styles from prior assistant turns (heuristic fingerprints).
 * @param {ChatTurn[]} turns
 * @returns {PresenceStyle[]}
 */
function inferRecentStyles(turns) {
  const assistant = turns.filter((t) => t.role === 'assistant').slice(-4)
  /** @type {PresenceStyle[]} */
  const out = []
  for (const t of assistant) {
    const c = t.content
    if (/\?/.test(c) && c.split('?').length > 2) out.push('intellectual_exploration')
    else if (/\b(per\s+esempio|imagine|immagina|c'?era\s+una|once\s+upon|storia)\b/i.test(c))
      out.push('storytelling')
    else if (/\b(prova\s+a|try\s+this|passi|step\s*\d|ecco\s+come)\b/i.test(c))
      out.push('practical_guidance')
    else if (/\b(hah|lol|😏|buffo|ironicamente|scherzo)\b/i.test(c)) out.push('gentle_humor')
    else if (/\b(wow|forte|bellissimo|love\s+that|anche\s+a\s+me)\b/i.test(c))
      out.push('shared_enthusiasm')
    else if (c.length < 120) out.push('quiet_acknowledgement')
    else if (/\b(forse|talvolta|nel\s+fondo|riflette|significa)\b/i.test(c))
      out.push('inspiring_reflection')
    else out.push('thoughtful_observation')
  }
  return out
}

/**
 * @param {PresenceStyle} style
 */
function styleLabel(style) {
  switch (style) {
    case 'thoughtful_observation':
      return 'osservazione ponderata'
    case 'quiet_acknowledgement':
      return 'riconoscimento quieto'
    case 'shared_enthusiasm':
      return 'entusiasmo condiviso'
    case 'gentle_humor':
      return 'umorismo leggero'
    case 'inspiring_reflection':
      return 'riflessione ispirante'
    case 'practical_guidance':
      return 'guida pratica'
    case 'storytelling':
      return 'storytelling'
    case 'intellectual_exploration':
      return 'esplorazione intellettuale'
    default:
      return String(style)
  }
}

/**
 * @param {PresenceEnding} ending
 */
function endingLabel(ending) {
  switch (ending) {
    case 'observation':
      return 'chiudi con un’osservazione'
    case 'image':
      return 'chiudi con un’immagine vivida'
    case 'reflection':
      return 'chiudi con una riflessione'
    case 'memorable_sentence':
      return 'chiudi con una frase memorabile'
    case 'question_rare':
      return 'domanda solo se davvero migliora il filo'
    case 'none':
      return 'chiudi netto — niente coda interattiva'
    default:
      return String(ending)
  }
}

/**
 * Detect primary presence need for this turn.
 * @param {object} args
 * @returns {{ need: PresenceNeed, signals: string[] }}
 */
function detectNeed(args) {
  const { userMessage, intent, leadership, deepThinking, turns } = args
  const text = normalize(userMessage)
  const expects = intent?.expects || 'mixed'
  const emo = intent?.emotionalIntent || 'neutral'
  const leadMove = leadership?.move || ''
  const dtDir = deepThinking?.direction || ''
  /** @type {string[]} */
  const signals = []

  if (GOODBYE.test(text) || leadMove === 'close_warmly' || dtDir === 'restraint') {
    signals.push('close')
    return { need: 'memorable_close', signals }
  }

  if (ENTHUSIASM.test(text) && !EMOTIONAL.test(text) && !SUBSTANCE.test(text)) {
    signals.push('share_energy')
    return { need: 'enthusiasm', signals }
  }

  if (COMPANY.test(text) || expects === 'companionship') {
    signals.push('company')
    return { need: 'company', signals }
  }

  if (
    SHORT_REACT.test(text) ||
    emo === 'venting' ||
    emo === 'anxious_reassurance' ||
    expects === 'presence' ||
    dtDir === 'warm_presence' ||
    dtDir === 'restraint'
  ) {
    if (expects === 'presence' || emo === 'venting' || emo === 'anxious_reassurance') {
      signals.push('company_or_care')
      return { need: 'company', signals }
    }
    signals.push('brevity')
    return { need: 'brevity', signals }
  }

  // How-to / substance: balanced presence — not forced momentum theater
  if (SUBSTANCE.test(text) || expects === 'information') {
    signals.push('substance')
    return { need: 'balanced', signals }
  }

  if (
    MOMENTUM.test(text) ||
    leadMove === 'continue_naturally' ||
    leadMove === 'valuable_insight' ||
    (intent?.opennessToContinue === 'open' && intent?.curiosityLevel === 'high')
  ) {
    signals.push('momentum')
    return { need: 'momentum', signals }
  }

  if (leadMove === 'short_story' || leadMove === 'observation' || dtDir === 'surprising_insight') {
    signals.push('memorable')
    return { need: 'memorable_close', signals }
  }

  signals.push('balanced')
  return { need: 'balanced', signals }
}

/**
 * Pick a style that fits need + context, avoiding recent overuse.
 * @param {object} args
 * @returns {{ style: PresenceStyle, reasons: string[] }}
 */
function pickStyle(args) {
  const { need, intent, leadership, deepThinking, thoughtfulness, recentStyles, userMessage } =
    args
  const text = normalize(userMessage)
  const leadMove = leadership?.move || ''
  const dtDir = deepThinking?.direction || ''
  const contrib = thoughtfulness?.contribution || ''
  const recent = recentStyles || []
  const last = recent[recent.length - 1]
  const counts = Object.fromEntries(ALL_STYLES.map((s) => [s, recent.filter((r) => r === s).length]))

  /** @type {PresenceStyle[]} */
  let preferred = []

  switch (need) {
    case 'brevity':
      preferred = ['quiet_acknowledgement', 'thoughtful_observation', 'gentle_humor']
      break
    case 'enthusiasm':
      preferred = ['shared_enthusiasm', 'gentle_humor', 'thoughtful_observation']
      break
    case 'company':
      preferred = ['thoughtful_observation', 'storytelling', 'gentle_humor', 'inspiring_reflection']
      break
    case 'momentum':
      preferred = ['intellectual_exploration', 'thoughtful_observation', 'storytelling']
      break
    case 'memorable_close':
      preferred = ['inspiring_reflection', 'thoughtful_observation', 'quiet_acknowledgement']
      break
    default:
      preferred = [
        'thoughtful_observation',
        'intellectual_exploration',
        'practical_guidance',
        'inspiring_reflection',
        'storytelling',
        'gentle_humor',
      ]
  }

  // Enthusiasm need: strongly prefer shared_enthusiasm (don't let DT alignment steal it).
  if (need === 'enthusiasm') {
    preferred = ['shared_enthusiasm', 'gentle_humor', 'thoughtful_observation']
  }

  // Align with Deep Thinking / Thoughtfulness / Leadership when present (non-enthusiasm).
  if (need !== 'enthusiasm' && need !== 'brevity' && need !== 'company') {
    if (dtDir === 'elegant_explanation' || dtDir === 'direct_useful' || SUBSTANCE.test(text)) {
      preferred = ['practical_guidance', 'intellectual_exploration', 'thoughtful_observation', ...preferred]
    }
    if (dtDir === 'concise_story' || contrib === 'short_relevant_story' || leadMove === 'short_story') {
      preferred = ['storytelling', ...preferred]
    }
    if (dtDir === 'surprising_insight' || contrib === 'unexpected_implication' || leadMove === 'unexpected_fact') {
      preferred = ['intellectual_exploration', 'thoughtful_observation', ...preferred]
    }
    if (dtDir === 'meaningful_comparison' || contrib === 'useful_analogy' || leadMove === 'analogy') {
      preferred = ['intellectual_exploration', 'thoughtful_observation', ...preferred]
    }
  }
  if (EMOTIONAL.test(text) || intent?.expects === 'presence') {
    preferred = ['quiet_acknowledgement', 'thoughtful_observation', 'inspiring_reflection', ...preferred]
  }

  // Score candidates: prefer fit, penalize recent overuse / same-as-last.
  /** @type {{ style: PresenceStyle, score: number }[]} */
  const scored = []
  const pool = [...new Set([...preferred, ...ALL_STYLES])]
  for (let i = 0; i < pool.length; i++) {
    const style = pool[i]
    let score = 10 - Math.min(i, 8) * 0.7
    if (preferred.includes(style)) score += 2.5
    if (style === last) score -= 3.5
    score -= (counts[style] || 0) * 1.8
    // Soft rarity for humor — never spam
    if (style === 'gentle_humor' && (counts.gentle_humor || 0) > 0) score -= 2
    if (style === 'shared_enthusiasm' && need !== 'enthusiasm') score -= 1.2
    if (style === 'practical_guidance' && need === 'company') score -= 2
    if (style === 'quiet_acknowledgement' && need === 'momentum') score -= 2.5
    scored.push({ style, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const style = scored[0]?.style || 'thoughtful_observation'
  return {
    style,
    reasons: [
      `need_${need}`,
      `style_${style}`,
      last ? `avoid_repeat_${last}` : 'fresh_style',
      dtDir ? `dt_${dtDir}` : 'dt_none',
      contrib ? `th_${contrib}` : 'th_none',
    ],
  }
}

/**
 * Pick ending that feels organic — often NOT a question.
 * @param {object} args
 * @returns {{ ending: PresenceEnding, avoidQuestionEnding: boolean, reasons: string[] }}
 */
function pickEnding(args) {
  const { need, style, leadership, deepThinking, userMessage } = args
  const text = normalize(userMessage)
  const leadMove = leadership?.move || ''
  const allowQ = Boolean(leadership?.allowQuestion)

  if (need === 'brevity' || need === 'memorable_close' || GOODBYE.test(text) || leadMove === 'close_warmly') {
    const options = /** @type {PresenceEnding[]} */ ([
      'memorable_sentence',
      'observation',
      'none',
      'reflection',
    ])
    const ending = options[Math.abs(hash(text + style)) % options.length]
    return {
      ending,
      avoidQuestionEnding: true,
      reasons: ['natural_close', `end_${ending}`],
    }
  }

  if (need === 'enthusiasm') {
    const ending =
      style === 'gentle_humor' ? 'observation' : hash(text) % 2 === 0 ? 'memorable_sentence' : 'image'
    return { ending, avoidQuestionEnding: true, reasons: ['enthusiasm_end', `end_${ending}`] }
  }

  if (need === 'company') {
    // Company: sometimes reflection/image; rarely question
    const ending =
      hash(text + 'co') % 5 === 0 && allowQ ? 'question_rare' : hash(text) % 2 === 0 ? 'observation' : 'reflection'
    return {
      ending,
      avoidQuestionEnding: ending !== 'question_rare',
      reasons: ['company_end', `end_${ending}`],
    }
  }

  if (need === 'momentum') {
    // Momentum: prefer continuing thought over asking — surprising natural ending
    const roll = hash(text + style) % 6
    /** @type {PresenceEnding} */
    let ending = 'observation'
    if (roll === 0 && allowQ) ending = 'question_rare'
    else if (roll === 1) ending = 'image'
    else if (roll === 2) ending = 'memorable_sentence'
    else if (roll === 3) ending = 'reflection'
    else ending = 'observation'
    return {
      ending,
      avoidQuestionEnding: ending !== 'question_rare',
      reasons: ['momentum_natural_end', `end_${ending}`],
    }
  }

  // Balanced / substance: prefer non-question endings most of the time
  if (deepThinking?.direction === 'direct_useful' || SUBSTANCE.test(text)) {
    const ending = hash(text) % 3 === 0 ? 'none' : hash(text) % 2 === 0 ? 'observation' : 'memorable_sentence'
    return { ending, avoidQuestionEnding: true, reasons: ['substance_end', `end_${ending}`] }
  }

  const roll = hash(text + need) % 5
  /** @type {PresenceEnding} */
  const ending =
    roll === 0
      ? 'reflection'
      : roll === 1
        ? 'image'
        : roll === 2
          ? 'memorable_sentence'
          : roll === 3 && allowQ
            ? 'question_rare'
            : 'observation'

  return {
    ending,
    avoidQuestionEnding: ending !== 'question_rare',
    reasons: ['organic_end', `end_${ending}`],
  }
}

/**
 * Stable tiny hash for deterministic variety (not crypto).
 * @param {string} s
 */
function hash(s) {
  let h = 0
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * @param {object} planBits
 */
function buildBrief(planBits) {
  const {
    need,
    style,
    ending,
    preferBrevity,
    shareEnthusiasm,
    companyMode,
    keepMomentum,
    memorableClose,
    avoidQuestionEnding,
    leadership,
    deepThinking,
    thoughtfulness,
    intent,
  } = planBits

  return [
    'PRESENCE ENGINE (dopo Deep Thinking, prima del Writer): non sembrare una macchina Q&A — fai sentire la conversazione viva.',
    'Presenza ≠ fingere di essere umani. Presenza = dialogo organico, interessante, vivo.',
    `Need=${need}. Stile=${styleLabel(style)} (${style}). Chiusura=${endingLabel(ending)}.`,
    preferBrevity ? 'Brevità/silenzio > aggiungere informazione.' : '',
    shareEnthusiasm ? 'Condividi entusiasmo in modo genuino — non performativo.' : '',
    companyMode ? 'L’utente cerca compagnia: resta presente, non scaricare un tutorial.' : '',
    keepMomentum ? 'Mantieni momentum — continua il pensiero condiviso.' : '',
    memorableClose ? 'Merita un pensiero di chiusura memorabile.' : '',
    avoidQuestionEnding
      ? 'NON chiudere con una domanda. Preferisci osservazione / immagine / riflessione / frase memorabile / chiusura secca.'
      : 'Domanda solo se migliora davvero il filo — non per default interattivo.',
    leadership?.move ? `Cooperazione Leadership move=${leadership.move}.` : '',
    deepThinking?.direction ? `Cooperazione Deep Thinking direzione=${deepThinking.direction}.` : '',
    thoughtfulness?.contribution
      ? `Cooperazione Thoughtfulness contributo=${thoughtfulness.contribution}.`
      : '',
    intent?.expects ? `Intent expects=${intent.expects}.` : '',
    'Varia lo stile: non ripetere lo stesso pattern. Evita template prevedibili.',
    'Check interno: «Does this feel like spending time with someone interesting?» — se no, raffina.',
    'Non inventare fatti. Non fingere emozioni. Non manipolare. Ragionamento interno — non citare lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {PresencePlan | null | undefined} plan
 * @returns {string[]}
 */
export function presenceStructureHints(plan) {
  if (!plan?.active) return []
  return [
    `Presence → ${styleLabel(plan.style)} · need=${plan.need}`,
    plan.avoidQuestionEnding
      ? `Chiusura naturale: ${endingLabel(plan.ending)} (niente domanda di default)`
      : `Chiusura: ${endingLabel(plan.ending)}`,
    plan.preferBrevity ? 'Brevità > informazione extra' : 'Presenza viva, non algoritmo',
    '«Does this feel like spending time with someone interesting?»',
    'Non fingere emozioni; non inventare; non citare lo stage',
  ]
}

/**
 * @param {object} [input]
 * @returns {PresencePlan}
 */
export function buildPresencePlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const intentPlan = input.conversationIntent?.plan || input.conversationIntent || null
  const intent = intentPlan?.inference || input.intent || null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || input.leadership || null
  const deepThinking =
    input.deepThinking?.plan || input.deepThinking || null
  const thoughtfulness =
    input.thoughtfulness?.plan || input.thoughtfulness || null

  if (!userMessage) {
    return {
      active: false,
      need: 'balanced',
      style: 'quiet_acknowledgement',
      ending: 'none',
      preferBrevity: true,
      shareEnthusiasm: false,
      companyMode: false,
      keepMomentum: false,
      memorableClose: false,
      avoidQuestionEnding: true,
      organicCheck: true,
      recentStyles: [],
      confidence: 'low',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
    }
  }

  const sessionStyles = Array.isArray(input.session?.recentPresenceStyles)
    ? input.session.recentPresenceStyles.filter((s) => ALL_STYLES.includes(s))
    : []
  const recentStyles = sessionStyles.length ? sessionStyles : inferRecentStyles(turns)

  const needInfo = detectNeed({
    userMessage,
    intent,
    leadership,
    deepThinking,
    turns,
  })
  const styleInfo = pickStyle({
    need: needInfo.need,
    intent,
    leadership,
    deepThinking,
    thoughtfulness,
    recentStyles,
    userMessage,
  })
  const endingInfo = pickEnding({
    need: needInfo.need,
    style: styleInfo.style,
    leadership,
    deepThinking,
    userMessage,
  })

  const preferBrevity = needInfo.need === 'brevity' || deepThinking?.direction === 'restraint'
  const shareEnthusiasm = needInfo.need === 'enthusiasm'
  const companyMode = needInfo.need === 'company'
  const keepMomentum = needInfo.need === 'momentum'
  const memorableClose = needInfo.need === 'memorable_close' || endingInfo.ending === 'memorable_sentence'

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (needInfo.signals.length >= 2 || deepThinking?.direction) confidence = 'high'
  if (needInfo.need === 'balanced' && !leadership?.move) confidence = 'low'

  const writerBrief = buildBrief({
    need: needInfo.need,
    style: styleInfo.style,
    ending: endingInfo.ending,
    preferBrevity,
    shareEnthusiasm,
    companyMode,
    keepMomentum,
    memorableClose,
    avoidQuestionEnding: endingInfo.avoidQuestionEnding,
    leadership,
    deepThinking,
    thoughtfulness,
    intent,
  })

  return {
    active: true,
    need: needInfo.need,
    style: styleInfo.style,
    ending: endingInfo.ending,
    preferBrevity,
    shareEnthusiasm,
    companyMode,
    keepMomentum,
    memorableClose,
    avoidQuestionEnding: endingInfo.avoidQuestionEnding,
    organicCheck: true,
    recentStyles,
    confidence,
    writerBrief,
    structureLine: `Presence → ${styleLabel(styleInfo.style)} · ${endingLabel(endingInfo.ending)}`,
    responseHints: [
      `Stile: ${styleLabel(styleInfo.style)}.`,
      endingInfo.avoidQuestionEnding
        ? `Chiudi con ${endingLabel(endingInfo.ending)} — non una domanda.`
        : `Chiusura: ${endingLabel(endingInfo.ending)}.`,
      preferBrevity ? 'Meno informazione, più presenza.' : 'Fai sentire la chat viva.',
      'Check: Does this feel like spending time with someone interesting?',
      'Non fingere emozioni. Non inventare. Non manipolare.',
    ],
    reasons: [
      `need_${needInfo.need}`,
      `style_${styleInfo.style}`,
      `end_${endingInfo.ending}`,
      ...(needInfo.signals || []).slice(0, 2),
      ...(styleInfo.reasons || []).slice(0, 2),
      ...(endingInfo.reasons || []).slice(0, 2),
    ],
    signals: [
      needInfo.need,
      styleInfo.style,
      endingInfo.ending,
      endingInfo.avoidQuestionEnding ? 'no_q_end' : 'q_rare',
      ...needInfo.signals,
    ].slice(0, 8),
  }
}

/**
 * @param {PresencePlan | null | undefined} plan
 */
export function formatPresenceForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
PRESENCE ENGINE (DOPO DEEP THINKING, PRE-WRITER)
══════════════════════════════════════
Need=${plan.need} · Style=${plan.style} · Ending=${plan.ending}
Brevity=${plan.preferBrevity ? 'yes' : 'no'} · Enthusiasm=${plan.shareEnthusiasm ? 'yes' : 'no'} · Company=${plan.companyMode ? 'yes' : 'no'} · Momentum=${plan.keepMomentum ? 'yes' : 'no'}
AvoidQuestionEnding=${plan.avoidQuestionEnding ? 'yes' : 'no'} · Confidence=${plan.confidence}

${plan.writerBrief}

Hints:
${hints}

Check: «Does this feel like spending time with someone interesting?» — se no, raffina.
Regole: organico > algoritmico · non inventare · non fingere emozioni · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: PresencePlan, context: string }}
 */
export function runPresenceEngine(input = {}) {
  try {
    const plan = buildPresencePlan(input)
    return {
      plan,
      context: formatPresenceForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        need: 'balanced',
        style: 'quiet_acknowledgement',
        ending: 'none',
        preferBrevity: true,
        shareEnthusiasm: false,
        companyMode: false,
        keepMomentum: false,
        memorableClose: false,
        avoidQuestionEnding: true,
        organicCheck: true,
        recentStyles: [],
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
