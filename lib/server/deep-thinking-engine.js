/**
 * LAIfe Deep Thinking Engine
 *
 * Runs AFTER Conversation Leadership (and Intent) and BEFORE the Writer.
 *
 * Mission: before the Writer generates any response, perform a short internal
 * reasoning phase. Do not generate the first correct response. Internally
 * explore multiple possible response directions and choose the one with the
 * highest conversational value.
 *
 * Evaluate directions on:
 *   usefulness · naturalness · originality · emotional intelligence ·
 *   conversational momentum · clarity · memorability
 *
 * Internal check: "Would a thoughtful human say this?" — if not, improve.
 *
 * Avoid: generic acknowledgements, encyclopedia summaries, repetitive
 * sentence structures, unnecessary questions, robotic transitions, filler.
 *
 * Prefer: observations, elegant explanations, meaningful comparisons,
 * memorable examples, concise storytelling, surprising but relevant insights.
 *
 * Never sacrifice factual accuracy. Never invent information.
 * Keep reasoning internal — the user only sees the final refined response.
 *
 * Invisible. Fail-soft. Soft advisor — Coordinator applies before Writer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'observation'|'elegant_explanation'|'meaningful_comparison'|'memorable_example'|'concise_story'|'surprising_insight'|'warm_presence'|'direct_useful'|'restraint'} ThinkingDirection
 */

/**
 * @typedef {object} DirectionScores
 * @property {number} usefulness
 * @property {number} naturalness
 * @property {number} originality
 * @property {number} emotionalIntelligence
 * @property {number} conversationalMomentum
 * @property {number} clarity
 * @property {number} memorability
 * @property {number} humanLikeness
 */

/**
 * @typedef {object} ThinkingCandidate
 * @property {ThinkingDirection} direction
 * @property {number} score
 * @property {DirectionScores} scores
 * @property {string} seed
 * @property {string} humanCheck
 * @property {string[]} reasons
 * @property {boolean} passesHumanCheck
 */

/**
 * @typedef {object} DeepThinkingPlan
 * @property {boolean} active
 * @property {ThinkingDirection} direction
 * @property {ThinkingCandidate | null} chosen
 * @property {ThinkingCandidate[]} explored
 * @property {string[]} avoid
 * @property {string[]} prefer
 * @property {boolean} passesHumanCheck
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const EXPLICIT_SUMMARY =
  /(riassum|summar|in\s+sintesi|elenco\s+completo|tutti\s+i\s+dettagli|full\s+overview|encicloped|tutto\s+quello\s+che\s+sai)/i

const HOW_TO =
  /(come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to)|passi|steps|fix|debug|implement|codice|code)/i

const WHY_EXPLAIN =
  /(perch[eé]|why|come\s+funziona|how\s+does|spieg|explain|cos['’]?è|what\s+is)/i

const COMPARE =
  /(differen|vs\.?|versus|confronto|compare|meglio|better|oppure|or\s+should)/i

const EMOTIONAL =
  /(mi\s+sento|i\s+feel|ansios|anxious|stanco|tired|triste|sad|frustrat|paura|afraid|stress)/i

const GOODBYE_CLOSE =
  /(a\s+presto|ci\s+vediamo|buona\s+sera|buonanotte|goodbye|bye\b|talk\s+later|ok\s+grazie|thanks[,!]?\s*$|grazie[,!]?\s*$)/i

const STORY_FRIENDLY =
  /(vita|people|persone|lavoro|team|abitud|habit|decision|scelta|paura|motiv)/i

const AVOID_LIST = [
  'acknowledgement generici (“Capisco.”, “Ottima domanda.”, “Certo!” da soli)',
  'sunto da enciclopedia (salvo richiesta esplicita)',
  'strutture di frase ripetitive',
  'domande inutili / da intervista',
  'transizioni robotiche (“Inoltre,”, “In conclusione,”, “Feel free to…”)',
  'filler ovvio',
]

const PREFER_LIST = [
  'osservazioni vive',
  'spiegazioni eleganti',
  'confronti significativi',
  'esempi memorabili',
  'storytelling conciso',
  'insight sorprendenti ma pertinenti',
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
 * @param {ThinkingDirection} direction
 */
function directionLabel(direction) {
  switch (direction) {
    case 'observation':
      return 'osservazione viva'
    case 'elegant_explanation':
      return 'spiegazione elegante'
    case 'meaningful_comparison':
      return 'confronto significativo'
    case 'memorable_example':
      return 'esempio memorabile'
    case 'concise_story':
      return 'storia concisa'
    case 'surprising_insight':
      return 'insight sorprendente pertinente'
    case 'warm_presence':
      return 'presenza calda'
    case 'direct_useful':
      return 'risposta diretta utile'
    case 'restraint':
      return 'trattenersi (sostanza secca)'
    default:
      return String(direction)
  }
}

/**
 * Map Leadership move → preferred thinking directions.
 * @param {string} [leadMove]
 * @returns {ThinkingDirection[]}
 */
function directionsForLeadership(leadMove) {
  switch (leadMove) {
    case 'valuable_insight':
      return ['surprising_insight', 'observation', 'elegant_explanation']
    case 'short_story':
      return ['concise_story', 'memorable_example', 'meaningful_comparison']
    case 'observation':
      return ['observation', 'surprising_insight', 'elegant_explanation']
    case 'connect_ideas':
      return ['meaningful_comparison', 'surprising_insight', 'elegant_explanation']
    case 'analogy':
      return ['meaningful_comparison', 'memorable_example', 'elegant_explanation']
    case 'unexpected_fact':
      return ['surprising_insight', 'memorable_example', 'observation']
    case 'continue_naturally':
      return ['observation', 'surprising_insight', 'concise_story']
    case 'choose_direction':
      return ['observation', 'surprising_insight', 'memorable_example']
    case 'remain_concise':
      return ['direct_useful', 'elegant_explanation', 'restraint']
    case 'close_warmly':
      return ['restraint', 'warm_presence', 'observation']
    default:
      return [
        'observation',
        'elegant_explanation',
        'meaningful_comparison',
        'memorable_example',
        'concise_story',
        'surprising_insight',
        'direct_useful',
      ]
  }
}

/**
 * Base score vectors per direction (0–5), then context adjusts.
 * @returns {Record<ThinkingDirection, DirectionScores>}
 */
function baseScoreTable() {
  return {
    observation: {
      usefulness: 3.6,
      naturalness: 4.4,
      originality: 3.8,
      emotionalIntelligence: 3.5,
      conversationalMomentum: 4.2,
      clarity: 4.0,
      memorability: 3.9,
      humanLikeness: 4.3,
    },
    elegant_explanation: {
      usefulness: 4.4,
      naturalness: 3.8,
      originality: 3.4,
      emotionalIntelligence: 2.8,
      conversationalMomentum: 3.5,
      clarity: 4.6,
      memorability: 4.0,
      humanLikeness: 3.9,
    },
    meaningful_comparison: {
      usefulness: 4.1,
      naturalness: 3.7,
      originality: 4.0,
      emotionalIntelligence: 2.9,
      conversationalMomentum: 3.8,
      clarity: 4.2,
      memorability: 4.3,
      humanLikeness: 3.8,
    },
    memorable_example: {
      usefulness: 4.0,
      naturalness: 4.0,
      originality: 3.9,
      emotionalIntelligence: 3.2,
      conversationalMomentum: 3.9,
      clarity: 4.1,
      memorability: 4.6,
      humanLikeness: 4.1,
    },
    concise_story: {
      usefulness: 3.5,
      naturalness: 4.5,
      originality: 4.2,
      emotionalIntelligence: 4.0,
      conversationalMomentum: 4.3,
      clarity: 3.6,
      memorability: 4.5,
      humanLikeness: 4.5,
    },
    surprising_insight: {
      usefulness: 4.0,
      naturalness: 3.6,
      originality: 4.7,
      emotionalIntelligence: 3.0,
      conversationalMomentum: 4.4,
      clarity: 3.7,
      memorability: 4.7,
      humanLikeness: 3.8,
    },
    warm_presence: {
      usefulness: 3.0,
      naturalness: 4.6,
      originality: 2.8,
      emotionalIntelligence: 4.8,
      conversationalMomentum: 3.4,
      clarity: 3.8,
      memorability: 3.2,
      humanLikeness: 4.6,
    },
    direct_useful: {
      usefulness: 4.6,
      naturalness: 3.5,
      originality: 2.4,
      emotionalIntelligence: 2.5,
      conversationalMomentum: 2.8,
      clarity: 4.7,
      memorability: 2.6,
      humanLikeness: 3.2,
    },
    restraint: {
      usefulness: 3.2,
      naturalness: 4.4,
      originality: 2.5,
      emotionalIntelligence: 4.2,
      conversationalMomentum: 2.5,
      clarity: 4.5,
      memorability: 2.4,
      humanLikeness: 4.4,
    },
  }
}

/**
 * @param {DirectionScores} scores
 */
function compositeScore(scores) {
  const w = {
    usefulness: 1.15,
    naturalness: 1.1,
    originality: 1.0,
    emotionalIntelligence: 1.05,
    conversationalMomentum: 1.1,
    clarity: 1.15,
    memorability: 1.05,
    humanLikeness: 1.25,
  }
  let sum = 0
  let weight = 0
  for (const [k, v] of Object.entries(scores)) {
    const ww = w[/** @type {keyof typeof w} */ (k)] ?? 1
    sum += Number(v) * ww
    weight += ww
  }
  return Math.round((sum / weight) * 100) / 100
}

/**
 * @param {ThinkingDirection} direction
 * @param {object} ctx
 * @returns {{ scores: DirectionScores, reasons: string[], seed: string, humanCheck: string }}
 */
function scoreDirection(direction, ctx) {
  const {
    userMessage,
    intent,
    leadership,
    topic,
  } = ctx
  const text = normalize(userMessage)
  const expects = intent?.expects || 'mixed'
  const emo = intent?.emotionalIntent || 'neutral'
  const curiosity = intent?.curiosityLevel || 'medium'
  const leadMove = leadership?.move || ''
  const preferred = new Set(directionsForLeadership(leadMove))
  const topicLabel = normalize(topic || intent?.topic || 'il filo corrente') || 'il filo corrente'

  const scores = { ...baseScoreTable()[direction] }
  /** @type {string[]} */
  const reasons = []

  if (preferred.has(direction)) {
    scores.conversationalMomentum = Math.min(5, scores.conversationalMomentum + 0.55)
    scores.humanLikeness = Math.min(5, scores.humanLikeness + 0.35)
    reasons.push(`align_lead_${leadMove || 'none'}`)
  }

  if (WHY_EXPLAIN.test(text) || HOW_TO.test(text)) {
    if (direction === 'elegant_explanation' || direction === 'memorable_example') {
      scores.usefulness = Math.min(5, scores.usefulness + 0.7)
      scores.clarity = Math.min(5, scores.clarity + 0.5)
      reasons.push('explain_fit')
    }
    if (direction === 'direct_useful') {
      scores.usefulness = Math.min(5, scores.usefulness + 0.3)
    }
  }

  if (COMPARE.test(text) && direction === 'meaningful_comparison') {
    scores.usefulness = Math.min(5, scores.usefulness + 0.9)
    scores.clarity = Math.min(5, scores.clarity + 0.4)
    reasons.push('compare_fit')
  }

  if ((curiosity === 'high' || expects === 'exploration') && direction === 'surprising_insight') {
    scores.originality = Math.min(5, scores.originality + 0.6)
    scores.conversationalMomentum = Math.min(5, scores.conversationalMomentum + 0.5)
    reasons.push('curiosity_boost')
  }

  if (
    (EMOTIONAL.test(text) || emo === 'venting' || emo === 'anxious_reassurance' || expects === 'presence') &&
    (direction === 'warm_presence' || direction === 'restraint')
  ) {
    scores.emotionalIntelligence = Math.min(5, scores.emotionalIntelligence + 0.8)
    scores.humanLikeness = Math.min(5, scores.humanLikeness + 0.5)
    reasons.push('care_first')
  }

  if (EMOTIONAL.test(text) || emo === 'venting' || emo === 'anxious_reassurance') {
    if (
      direction === 'surprising_insight' ||
      direction === 'concise_story' ||
      direction === 'meaningful_comparison'
    ) {
      scores.emotionalIntelligence = Math.max(1, scores.emotionalIntelligence - 1.2)
      scores.humanLikeness = Math.max(1, scores.humanLikeness - 0.8)
      reasons.push('emotion_penalty_ornate')
    }
  }

  if (STORY_FRIENDLY.test(text) && (direction === 'concise_story' || direction === 'memorable_example')) {
    scores.memorability = Math.min(5, scores.memorability + 0.5)
    scores.naturalness = Math.min(5, scores.naturalness + 0.3)
    reasons.push('story_fit')
  }

  if (GOODBYE_CLOSE.test(text) || leadMove === 'close_warmly') {
    if (direction === 'restraint' || direction === 'warm_presence') {
      scores.humanLikeness = Math.min(5, scores.humanLikeness + 0.9)
      scores.naturalness = Math.min(5, scores.naturalness + 0.7)
      scores.usefulness = Math.min(5, scores.usefulness + 0.6)
      scores.conversationalMomentum = Math.min(5, scores.conversationalMomentum + 0.4)
      reasons.push('close_fit')
    } else {
      scores.conversationalMomentum = Math.max(1, scores.conversationalMomentum - 1.8)
      scores.humanLikeness = Math.max(1, scores.humanLikeness - 1.2)
      scores.originality = Math.max(1, scores.originality - 0.8)
      reasons.push('close_penalty')
    }
  }

  if (EXPLICIT_SUMMARY.test(text)) {
    if (direction === 'direct_useful' || direction === 'elegant_explanation') {
      scores.usefulness = Math.min(5, scores.usefulness + 0.5)
      reasons.push('summary_ok')
    }
    if (
      direction === 'concise_story' ||
      direction === 'surprising_insight' ||
      direction === 'observation'
    ) {
      scores.usefulness = Math.max(1, scores.usefulness - 0.8)
      reasons.push('summary_skip_ornate')
    }
  }

  if (leadMove === 'remain_concise' && direction === 'concise_story') {
    scores.clarity = Math.max(1, scores.clarity - 1.0)
    scores.conversationalMomentum = Math.max(1, scores.conversationalMomentum - 0.5)
  }

  if (expects === 'information' && direction === 'direct_useful') {
    scores.usefulness = Math.min(5, scores.usefulness + 0.4)
  }

  // First-correct baseline is rarely the most valuable unless clarity/urgency dominate.
  if (direction === 'direct_useful' && curiosity === 'high' && !EXPLICIT_SUMMARY.test(text)) {
    scores.originality = Math.max(1, scores.originality - 0.4)
    scores.memorability = Math.max(1, scores.memorability - 0.3)
    reasons.push('avoid_first_correct')
  }

  const seedByDir = {
    observation: `Un’osservazione concreta su ${topicLabel} che un umano attento farebbe — non un acknowledgement.`,
    elegant_explanation: `Spiega ${topicLabel} in pochi pezzi chiari e memorabili — elegante, non enciclopedico.`,
    meaningful_comparison: `Un confronto che illumina ${topicLabel}: due idee a contatto, differenza che conta.`,
    memorable_example: `Un esempio piccolo e vivido su ${topicLabel} che resta in mente.`,
    concise_story: `Una mini-storia di 2–4 frasi pertinente a ${topicLabel} — non aneddoto a caso.`,
    surprising_insight: `Un insight inatteso ma onesto su ${topicLabel} — pertinente al filo, zero trivia.`,
    warm_presence: `Presenza calda su ${topicLabel}: riconosci prima di risolvere; niente filler empatico.`,
    direct_useful: `Risposta diretta e utile su ${topicLabel} — chiara, senza padding.`,
    restraint: `Trattieni ornamenti su ${topicLabel}: sostanza secca o chiusura calda — niente allungamenti.`,
  }

  const humanCheck =
    direction === 'restraint' || direction === 'warm_presence'
      ? 'Would a thoughtful human say this? Sì — presenza o chiusura secca, senza filler.'
      : direction === 'direct_useful'
        ? 'Would a thoughtful human say this? Solo se la chiarezza batte l’ornamento; altrimenti eleva.'
        : `Would a thoughtful human say this? Sì, se ${directionLabel(direction)} suona naturale e pertinente — altrimenti raffina.`

  return {
    scores,
    reasons: reasons.length ? reasons : [`dir_${direction}`],
    seed: seedByDir[direction],
    humanCheck,
  }
}

/**
 * @param {object} args
 * @returns {ThinkingCandidate[]}
 */
function exploreDirections(args) {
  const leadMove = args.leadership?.move || ''
  const preferred = directionsForLeadership(leadMove)
  /** @type {ThinkingDirection[]} */
  const pool = [
    ...preferred,
    'observation',
    'elegant_explanation',
    'meaningful_comparison',
    'memorable_example',
    'concise_story',
    'surprising_insight',
    'warm_presence',
    'direct_useful',
    'restraint',
  ]
  const seen = new Set()
  /** @type {ThinkingCandidate[]} */
  const out = []

  for (const direction of pool) {
    if (seen.has(direction)) continue
    seen.add(direction)
    const scored = scoreDirection(direction, args)
    const score = compositeScore(scored.scores)
    const passesHumanCheck = scored.scores.humanLikeness >= 3.2
    out.push({
      direction,
      score,
      scores: scored.scores,
      seed: scored.seed,
      humanCheck: scored.humanCheck,
      reasons: scored.reasons,
      passesHumanCheck,
    })
  }

  return out.sort((a, b) => b.score - a.score)
}

/**
 * @param {ThinkingCandidate} chosen
 * @param {object} ctx
 */
function buildBrief(chosen, ctx) {
  const { leadership, intent, avoidEncyclopedia } = ctx
  const label = directionLabel(chosen.direction)
  const s = chosen.scores

  if (chosen.direction === 'restraint') {
    return [
      'DEEP THINKING ENGINE (interno, prima del Writer): esplora più direzioni — poi tratteniti.',
      'La direzione a maggior valore è restraint: niente filler, acknowledgement generici, o ornamenti.',
      'Check umano: Would a thoughtful human say this? → sì solo se secca e onesta.',
      'Non inventare fatti. Non mostrare il ragionamento. Non citare lo stage.',
    ].join(' ')
  }

  return [
    'DEEP THINKING ENGINE (interno, dopo Intent/Leadership, prima del Writer): non generare la prima risposta corretta.',
    'Esplora più direzioni; scegli quella con maggior valore conversazionale.',
    `Direzione scelta: ${label} (${chosen.direction}).`,
    `Seed: ${chosen.seed}`,
    `Score≈${chosen.score} · useful=${s.usefulness} natural=${s.naturalness} original=${s.originality} EI=${s.emotionalIntelligence} momentum=${s.conversationalMomentum} clear=${s.clarity} memorable=${s.memorability} human=${s.humanLikeness}.`,
    chosen.humanCheck,
    leadership?.move ? `Allineata a Leadership move=${leadership.move}.` : '',
    intent?.inference?.whySummary
      ? `Rispetta Intent: ${intent.inference.whySummary}`
      : intent?.whySummary
        ? `Rispetta Intent: ${intent.whySummary}`
        : '',
    avoidEncyclopedia
      ? 'Evita sunti da enciclopedia — preferisci osservazioni / spiegazioni eleganti / esempi memorabili.'
      : 'Overview ok se richiesto; resta comunque memorabile e chiaro.',
    'Vietato: acknowledgement generici, domande inutili, transizioni robotiche, filler, fatti inventati.',
    'Preferisci: osservazioni, spiegazioni eleganti, confronti, esempi, storytelling conciso, insight pertinenti.',
    'Accuratezza fattuale non negoziabile. Ragionamento interno — l’utente vede solo la risposta raffinata. Non citare lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {DeepThinkingPlan | null | undefined} plan
 * @returns {string[]}
 */
export function deepThinkingStructureHints(plan) {
  if (!plan?.active || !plan.direction) return []
  if (plan.direction === 'restraint') {
    return [
      'Deep Thinking → restraint (valore = non sovraccaricare)',
      'Would a thoughtful human say this? → sostanza secca, zero filler',
      'Non inventare; non mostrare il ragionamento interno',
    ]
  }
  return [
    `Deep Thinking → ${directionLabel(plan.direction)} (non la prima risposta corretta)`,
    'Esplora direzioni; scegli valore conversazionale massimo',
    'Would a thoughtful human say this? — se no, raffina',
    'Osservazioni / spiegazioni eleganti / confronti / esempi / storie concise / insight',
    'Niente enciclopedia, filler, domande inutili, fatti inventati',
  ]
}

/**
 * @param {object} [input]
 * @returns {DeepThinkingPlan}
 */
export function buildDeepThinkingPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const intentPlan = input.conversationIntent?.plan || input.conversationIntent || null
  const intent = intentPlan?.inference
    ? { ...intentPlan.inference, whySummary: intentPlan.inference.whySummary, topic: intentPlan.inference.topic }
    : input.intent || null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || input.leadership || null

  if (!userMessage) {
    return {
      active: false,
      direction: 'restraint',
      chosen: null,
      explored: [],
      avoid: AVOID_LIST,
      prefer: PREFER_LIST,
      passesHumanCheck: true,
      confidence: 'low',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
    }
  }

  const topic =
    input.session?.currentTopic ||
    input.understanding?.topic ||
    intent?.topic ||
    ''

  const explored = exploreDirections({
    userMessage,
    intent,
    leadership,
    topic,
  })

  // Prefer a direction that passes the human check; fall back to top score.
  let chosen =
    explored.find((c) => c.passesHumanCheck) ||
    explored[0] ||
    null

  // If top fails human check but second is close and passes, prefer second.
  if (
    chosen &&
    !chosen.passesHumanCheck &&
    explored[1]?.passesHumanCheck &&
    explored[1].score >= chosen.score - 0.35
  ) {
    chosen = explored[1]
  }

  // If still weak on humanLikeness, nudge toward observation / warm_presence / restraint.
  if (chosen && chosen.scores.humanLikeness < 3.2) {
    const rescue = explored.find(
      (c) =>
        c.passesHumanCheck &&
        (c.direction === 'observation' ||
          c.direction === 'warm_presence' ||
          c.direction === 'restraint' ||
          c.direction === 'elegant_explanation'),
    )
    if (rescue) chosen = rescue
  }

  const direction = chosen?.direction || 'direct_useful'
  const avoidEncyclopedia = !EXPLICIT_SUMMARY.test(userMessage)

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (chosen && chosen.score >= 4.15 && chosen.passesHumanCheck) confidence = 'high'
  else if (!chosen || chosen.score < 3.4) confidence = 'low'

  const writerBrief = chosen
    ? buildBrief(chosen, {
        leadership,
        intent: intentPlan || { inference: intent },
        avoidEncyclopedia,
      })
    : ''

  return {
    active: true,
    direction,
    chosen,
    explored: explored.slice(0, 5),
    avoid: AVOID_LIST,
    prefer: PREFER_LIST,
    passesHumanCheck: Boolean(chosen?.passesHumanCheck),
    confidence,
    writerBrief,
    structureLine:
      direction === 'restraint'
        ? 'Deep Thinking → restraint (interno)'
        : `Deep Thinking → ${directionLabel(direction)}`,
    responseHints: [
      direction === 'restraint'
        ? 'Trattieni: presenza o sostanza secca.'
        : `Scrivi nella direzione ${directionLabel(direction)} — raffinata, non la prima bozza corretta.`,
      'Check: Would a thoughtful human say this? Se no, migliora prima di inviare.',
      'Accuratezza fattuale > ornamento. Zero invenzioni. Ragionamento interno nascosto.',
      avoidEncyclopedia ? 'Niente sunto enciclopedico.' : 'Overview ok se richiesto.',
    ],
    reasons: [
      `direction_${direction}`,
      `conf_${confidence}`,
      chosen?.passesHumanCheck ? 'human_check_pass' : 'human_check_refine',
      leadership?.move ? `lead_${leadership.move}` : 'lead_none',
      ...(chosen?.reasons || []).slice(0, 2),
      turns.length > 2 ? 'has_history' : 'fresh',
    ],
    signals: [
      direction,
      avoidEncyclopedia ? 'anti_encyclopedia' : 'summary_ok',
      chosen?.passesHumanCheck ? 'human_ok' : 'human_refine',
      ...(chosen?.reasons || []),
    ].slice(0, 6),
  }
}

/**
 * @param {DeepThinkingPlan | null | undefined} plan
 */
export function formatDeepThinkingForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const explored =
    plan.explored?.length > 0
      ? plan.explored
          .slice(0, 4)
          .map(
            (c) =>
              `- ${c.direction} (${c.score})${c.passesHumanCheck ? '' : ' · refine'}`,
          )
          .join('\n')
      : '- (n/a)'
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')

  return `══════════════════════════════════════
DEEP THINKING ENGINE (INTERNO, PRE-WRITER)
══════════════════════════════════════
Direction=${plan.direction} · Confidence=${plan.confidence} · HumanCheck=${plan.passesHumanCheck ? 'pass' : 'refine'}

${plan.writerBrief}

Direzioni esplorate (interne — non mostrare):
${explored}

Hints:
${hints}

Regole: valore conversazionale > prima risposta corretta · accuratezza non negoziabile · non inventare · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: DeepThinkingPlan, context: string }}
 */
export function runDeepThinkingEngine(input = {}) {
  try {
    const plan = buildDeepThinkingPlan(input)
    return {
      plan,
      context: formatDeepThinkingForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        direction: 'restraint',
        chosen: null,
        explored: [],
        avoid: AVOID_LIST,
        prefer: PREFER_LIST,
        passesHumanCheck: true,
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
