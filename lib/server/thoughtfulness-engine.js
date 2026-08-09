/**
 * LAIfe Thoughtfulness Engine
 *
 * Runs AFTER Conversation Leadership and BEFORE the Writer.
 *
 * Mission: before generating any response, search for the most interesting
 * contribution the assistant can make.
 *
 * Goal is NOT to maximize information.
 * Goal is to maximize conversational value.
 *
 * Evaluate opportunities to:
 *   - make an insightful observation
 *   - reveal a hidden connection
 *   - explain something in a memorable way
 *   - share a useful analogy
 *   - tell a short relevant story
 *   - challenge an assumption respectfully
 *   - highlight an unexpected implication
 *   - simplify a complex idea elegantly
 *
 * Avoid the first correct answer. Choose the most thoughtful answer.
 *
 * Rules:
 *   Prefer memorable over generic.
 *   Prefer meaningful over exhaustive.
 *   Prefer elegant explanations over long explanations.
 *   Avoid encyclopedia-style summaries unless explicitly requested.
 *   Do not invent facts.
 *   Do not become philosophical without purpose.
 *   Stay relevant to the current conversation.
 *
 * Invisible. Fail-soft. Soft advisor — Coordinator applies before Writer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'insightful_observation'|'hidden_connection'|'memorable_explanation'|'useful_analogy'|'short_relevant_story'|'respectful_challenge'|'unexpected_implication'|'elegant_simplification'|'none'} ThoughtfulContribution
 */

/**
 * @typedef {object} ThoughtfulnessCandidate
 * @property {ThoughtfulContribution} kind
 * @property {number} score
 * @property {string} seed
 * @property {string[]} reasons
 */

/**
 * @typedef {object} ThoughtfulnessPlan
 * @property {boolean} active
 * @property {ThoughtfulContribution} contribution
 * @property {ThoughtfulnessCandidate | null} chosen
 * @property {ThoughtfulnessCandidate[]} ranked
 * @property {boolean} avoidEncyclopedia
 * @property {boolean} keepElegant
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

const COMPLEX =
  /(compless|complex|difficile|advanced|architett|distributed|quantum|algoritm|concurrency)/i

const ASSUMPTION_CUE =
  /(sempre|never|tutti|everyone|ovvio|obviously|bast[ae]\s+fare|just\s+do|the\s+only\s+way|l['’]unica\s+via)/i

const STORY_FRIENDLY =
  /(vita|people|persone|lavoro|team|abitud|habit|decision|scelta|paura|motiv)/i

const GOODBYE_CLOSE =
  /(a\s+presto|ci\s+vediamo|buona\s+sera|buonanotte|goodbye|bye\b|talk\s+later|ok\s+grazie|thanks[,!]?\s*$|grazie[,!]?\s*$)/i

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
 * @param {ThoughtfulContribution} kind
 */
function kindLabel(kind) {
  switch (kind) {
    case 'insightful_observation':
      return 'osservazione acuta'
    case 'hidden_connection':
      return 'collegamento nascosto'
    case 'memorable_explanation':
      return 'spiegazione memorabile'
    case 'useful_analogy':
      return 'analogia utile'
    case 'short_relevant_story':
      return 'storia breve pertinente'
    case 'respectful_challenge':
      return 'sfida rispettosa a un’assunzione'
    case 'unexpected_implication':
      return 'implicazione inattesa'
    case 'elegant_simplification':
      return 'semplificazione elegante'
    default:
      return 'nessun ornamento — sostanza secca'
  }
}

/**
 * Align contribution with Leadership move when present.
 * @param {string} [leadMove]
 * @returns {ThoughtfulContribution[]}
 */
function contributionsForLeadership(leadMove) {
  switch (leadMove) {
    case 'valuable_insight':
      return ['insightful_observation', 'unexpected_implication', 'hidden_connection']
    case 'short_story':
      return ['short_relevant_story', 'useful_analogy', 'memorable_explanation']
    case 'observation':
      return ['insightful_observation', 'elegant_simplification']
    case 'connect_ideas':
      return ['hidden_connection', 'useful_analogy', 'unexpected_implication']
    case 'analogy':
      return ['useful_analogy', 'memorable_explanation', 'elegant_simplification']
    case 'unexpected_fact':
      return ['unexpected_implication', 'insightful_observation', 'hidden_connection']
    case 'continue_naturally':
      return ['insightful_observation', 'hidden_connection', 'memorable_explanation']
    case 'choose_direction':
      return ['insightful_observation', 'unexpected_implication', 'useful_analogy']
    case 'remain_concise':
      return ['elegant_simplification', 'memorable_explanation', 'none']
    case 'close_warmly':
      return ['none', 'insightful_observation']
    default:
      return [
        'insightful_observation',
        'hidden_connection',
        'memorable_explanation',
        'useful_analogy',
        'short_relevant_story',
        'respectful_challenge',
        'unexpected_implication',
        'elegant_simplification',
      ]
  }
}

/**
 * Score contribution candidates for this turn.
 * @param {object} args
 * @returns {ThoughtfulnessCandidate[]}
 */
function rankContributions(args) {
  const {
    userMessage,
    intent,
    leadership,
    topic,
  } = args
  const text = normalize(userMessage)
  const expects = intent?.expects || 'mixed'
  const emo = intent?.emotionalIntent || 'neutral'
  const curiosity = intent?.curiosityLevel || 'medium'
  const leadMove = leadership?.move || ''
  const preferred = new Set(contributionsForLeadership(leadMove))
  const topicLabel = normalize(topic || intent?.topic || 'il filo corrente') || 'il filo corrente'

  /** @type {Array<Omit<ThoughtfulnessCandidate, 'score'> & { score: number }>} */
  const raw = []

  const push = (kind, base, seed, reasons) => {
    let score = base
    if (preferred.has(kind)) score += 1.6
    raw.push({ kind, score, seed, reasons })
  }

  push(
    'insightful_observation',
    3.4,
    `Un’osservazione concreta su ${topicLabel} che la maggior parte delle risposte salta — detta semplice.`,
    ['observation'],
  )
  push(
    'hidden_connection',
    expects === 'exploration' || curiosity === 'high' ? 3.8 : 2.8,
    `Un collegamento poco ovvio tra ${topicLabel} e qualcosa già nel filo — pertinente, non forzato.`,
    ['connection'],
  )
  push(
    'memorable_explanation',
    WHY_EXPLAIN.test(text) || expects === 'information' ? 4.0 : 2.6,
    `Spiega ${topicLabel} in modo che resti in mente — un’immagine o un meccanismo chiaro, non un sunto enciclopedico.`,
    ['memorable'],
  )
  push(
    'useful_analogy',
    WHY_EXPLAIN.test(text) || COMPLEX.test(text) ? 3.9 : 2.7,
    `Un’analogia utile per ${topicLabel}: un dominio familiare che illumina il punto, senza stiracchiamenti.`,
    ['analogy'],
  )
  push(
    'short_relevant_story',
    STORY_FRIENDLY.test(text) || expects === 'companionship' || leadMove === 'short_story' ? 3.7 : 2.2,
    `Una mini-storia o scenario di 2–4 frasi su ${topicLabel} — pertinente, non aneddoto a caso.`,
    ['story'],
  )
  push(
    'respectful_challenge',
    ASSUMPTION_CUE.test(text) ? 4.2 : 2.0,
    `Se c’è un’assunzione fragile in ${topicLabel}, sfidala con rispetto in una frase — poi offri un’alternativa migliore.`,
    ['challenge'],
  )
  push(
    'unexpected_implication',
    curiosity === 'high' || leadMove === 'unexpected_fact' || leadMove === 'valuable_insight' ? 3.8 : 2.5,
    `Un’implicazione inattesa ma onesta di ${topicLabel} — utile al filo, non trivia.`,
    ['implication'],
  )
  push(
    'elegant_simplification',
    COMPLEX.test(text) || HOW_TO.test(text) || leadMove === 'remain_concise' ? 4.1 : 2.4,
    `La versione elegante di ${topicLabel}: meno pezzi, stesso potere — niente muro di dettagli.`,
    ['simplify'],
  )
  push(
    'none',
    emo === 'venting' ||
      emo === 'anxious_reassurance' ||
      leadMove === 'close_warmly' ||
      GOODBYE_CLOSE.test(text)
      ? 4.5
      : 1.5,
    'Nessun ornamento: presenza o sostanza secca — la thoughtfulness qui è trattenersi.',
    ['restraint'],
  )

  // Penalties / boosts
  for (const c of raw) {
    if (EXPLICIT_SUMMARY.test(text) && c.kind === 'elegant_simplification') c.score -= 1.5
    if (EXPLICIT_SUMMARY.test(text) && c.kind === 'memorable_explanation') c.score -= 0.8
    if (EXPLICIT_SUMMARY.test(text) && c.kind !== 'none' && c.kind !== 'elegant_simplification') {
      // Explicit overview request: don't force ornate contributions
      if (c.kind === 'short_relevant_story' || c.kind === 'useful_analogy') c.score -= 1.2
    }
    if (emo === 'venting' || emo === 'anxious_reassurance' || GOODBYE_CLOSE.test(text)) {
      if (c.kind !== 'none' && c.kind !== 'insightful_observation') c.score -= 2
    }
    if (GOODBYE_CLOSE.test(text) && c.kind === 'insightful_observation') c.score -= 1.5
    if (leadMove === 'remain_concise' && c.kind === 'short_relevant_story') c.score -= 1.5
    if (expects === 'information' && c.kind === 'short_relevant_story') c.score -= 0.8
    if (expects === 'exploration' && (c.kind === 'hidden_connection' || c.kind === 'unexpected_implication')) {
      c.score += 0.6
    }
  }

  return raw
    .map((c) => ({
      kind: c.kind,
      score: Math.round(c.score * 100) / 100,
      seed: c.seed,
      reasons: c.reasons,
    }))
    .sort((a, b) => b.score - a.score)
}

/**
 * @param {ThoughtfulnessCandidate} chosen
 * @param {object} ctx
 */
function buildBrief(chosen, ctx) {
  const { leadership, avoidEncyclopedia, keepElegant } = ctx
  const label = kindLabel(chosen.kind)
  if (chosen.kind === 'none') {
    return [
      'THOUGHTFULNESS ENGINE (prima del Writer): la mossa più thoughtful è trattenersi.',
      'Niente analogie/storie/filosofia. Presenza o sostanza secca, onesta.',
      'Non inventare fatti. Non citare lo stage.',
    ].join(' ')
  }

  return [
    'THOUGHTFULNESS ENGINE (dopo Leadership, prima del Writer): non mandare la prima risposta corretta — cerca il contributo a maggior valore conversazionale.',
    `Contributo scelto: ${label} (${chosen.kind}).`,
    `Seed: ${chosen.seed}`,
    leadership?.move ? `Allineato a Leadership move=${leadership.move}.` : '',
    'Preferisci memorabile > generico · significativo > esaustivo · elegante > lungo.',
    avoidEncyclopedia
      ? 'Evita sunti da enciclopedia — l’utente non ha chiesto un overview completo.'
      : keepElegant
        ? 'Se serve profondità, resta elegante: pochi pezzi forti.'
        : 'Resta rilevante al filo; niente filosofia gratuita.',
    'Non inventare fatti. Non allungare a vuoto. Non citare lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {ThoughtfulnessPlan | null | undefined} plan
 * @returns {string[]}
 */
export function thoughtfulnessStructureHints(plan) {
  if (!plan?.active || !plan.contribution || plan.contribution === 'none') {
    if (plan?.active && plan.contribution === 'none') {
      return [
        'Thoughtfulness → trattenersi: sostanza/presenza secca, niente ornamenti',
        'Memorabile ≠ lungo; non inventare fatti',
      ]
    }
    return []
  }
  return [
    `Thoughtfulness → ${kindLabel(plan.contribution)} (non la prima risposta corretta)`,
    'Massimizza valore conversazionale, non volume di informazione',
    'Memorabile > generico · elegante > enciclopedico',
    'Rilevante al filo; niente fatti inventati; niente filosofia gratuita',
  ]
}

/**
 * @param {object} [input]
 * @returns {ThoughtfulnessPlan}
 */
export function buildThoughtfulnessPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const intentPlan = input.conversationIntent?.plan || input.conversationIntent || null
  const intent = intentPlan?.inference || input.intent || null
  const leadership =
    input.conversationLeadership?.plan || input.conversationLeadership || input.leadership || null

  if (!userMessage) {
    return {
      active: false,
      contribution: 'none',
      chosen: null,
      ranked: [],
      avoidEncyclopedia: true,
      keepElegant: true,
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

  const ranked = rankContributions({
    userMessage,
    intent,
    leadership,
    topic,
  })
  const chosen = ranked[0] || null
  const contribution = chosen?.kind || 'none'
  const avoidEncyclopedia = !EXPLICIT_SUMMARY.test(userMessage)
  const keepElegant = true

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (chosen && chosen.score >= 5) confidence = 'high'
  else if (chosen && chosen.score < 3.2) confidence = 'low'

  const writerBrief = chosen
    ? buildBrief(chosen, { leadership, avoidEncyclopedia, keepElegant })
    : ''

  return {
    active: true,
    contribution,
    chosen,
    ranked: ranked.slice(0, 5),
    avoidEncyclopedia,
    keepElegant,
    confidence,
    writerBrief,
    structureLine:
      contribution === 'none'
        ? 'Thoughtfulness → trattenersi (valore = non sovraccaricare)'
        : `Thoughtfulness → ${kindLabel(contribution)}`,
    responseHints: [
      contribution === 'none'
        ? 'Trattieni ornamenti; punta a chiarezza e presenza.'
        : `Porta ${kindLabel(contribution)} come cuore del contributo — non un add-on in coda.`,
      'Memorabile e rilevante; mai inventare.',
      avoidEncyclopedia ? 'Niente sunto enciclopedico.' : 'Overview ok se richiesto.',
    ],
    reasons: [
      `contribution_${contribution}`,
      `conf_${confidence}`,
      leadership?.move ? `lead_${leadership.move}` : 'lead_none',
      ...(chosen?.reasons || []).slice(0, 2),
      turns.length > 2 ? 'has_history' : 'fresh',
    ],
    signals: [
      contribution,
      avoidEncyclopedia ? 'anti_encyclopedia' : 'summary_ok',
      ...(chosen?.reasons || []),
    ].slice(0, 6),
  }
}

/**
 * @param {ThoughtfulnessPlan | null | undefined} plan
 */
export function formatThoughtfulnessForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const ranked =
    plan.ranked?.length > 0
      ? plan.ranked
          .slice(0, 3)
          .map((c) => `- ${c.kind} (${c.score})`)
          .join('\n')
      : '- (n/a)'

  return `══════════════════════════════════════
THOUGHTFULNESS ENGINE (PRE-WRITER, INVISIBILE)
══════════════════════════════════════
Contribution=${plan.contribution} · Confidence=${plan.confidence}
AvoidEncyclopedia=${plan.avoidEncyclopedia ? 'yes' : 'no'} · Elegant=${plan.keepElegant ? 'yes' : 'no'}

${plan.writerBrief}

Top candidates:
${ranked}

Hints:
${hints}

Regole: valore conversazionale > volume · memorabile > generico · non inventare · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: ThoughtfulnessPlan, context: string }}
 */
export function runThoughtfulnessEngine(input = {}) {
  try {
    const plan = buildThoughtfulnessPlan(input)
    return {
      plan,
      context: formatThoughtfulnessForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        contribution: 'none',
        chosen: null,
        ranked: [],
        avoidEncyclopedia: true,
        keepElegant: true,
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
