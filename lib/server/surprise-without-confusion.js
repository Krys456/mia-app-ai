/**
 * LAIfe Surprise Without Confusion
 *
 * When appropriate, introduce ONE unexpected idea that naturally follows
 * from the discussion.
 *
 * The surprise should:
 *   - increase curiosity
 *   - improve understanding
 *   - remain easy to follow
 *
 * Avoid sensationalism. Avoid unrelated trivia.
 * Surprise should always support learning.
 *
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'elegant_twist'|'hidden_link'|'gentle_reframe'|'scale_shift'|'counterintuitive_fact'} SurpriseKind
 */

/**
 * @typedef {object} SurpriseIdea
 * @property {string} id
 * @property {SurpriseKind} kind
 * @property {string} seed
 * @property {number} curiosityLift
 * @property {number} understandingGain
 * @property {number} ease
 * @property {number} relatedness
 * @property {number} score
 */

/**
 * @typedef {object} SurprisePlan
 * @property {boolean} shouldSurprise
 * @property {SurpriseIdea | null} chosen
 * @property {SurpriseIdea[]} ranked
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 */

/** High bar — surprise must clearly help learning without confusion */
const SCORE_THRESHOLD = 3.5

const STOP_SIGNAL =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|thx|ty|bye|arrivederci|buonanotte|done)([\s!,.]|$)/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const MINIMAL_ASK =
  /\b(in\s+breve|veloce|quick|tl;?dr|solo\s+s[iì]|yes\s+or\s+no|risposta\s+breve)\b/i

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente)\b/i

const SENSATIONAL_FORBIDDEN =
  /\b(shocking|bombshell|you\s+won'?t\s+believe|mind[\s-]?blown|clickbait|incredibile\s+ma\s+vero|scoop)\b/i

/** @type {Record<SurpriseKind, string>} */
const KIND_LABEL = {
  elegant_twist: 'twist elegante',
  hidden_link: 'collegamento nascosto',
  gentle_reframe: 'reframe gentile',
  scale_shift: 'cambio di scala',
  counterintuitive_fact: 'fatto controintuitivo',
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
 * @param {string} topic
 */
function topicLabel(topic) {
  const t = normalize(topic)
  if (!t || t === 'generale') return 'questo tema'
  return t.length > 56 ? `${t.slice(0, 53)}…` : t
}

/**
 * @param {object} ctx
 */
function shouldSkip(ctx) {
  /** @type {string[]} */
  const reasons = []
  const msg = normalize(ctx.userMessage || '')

  if (!msg) {
    reasons.push('empty')
    return { skip: true, reasons }
  }
  if (STOP_SIGNAL.test(msg) || GREETING_ONLY.test(msg)) {
    reasons.push('stop_or_greeting')
    return { skip: true, reasons }
  }
  if (MINIMAL_ASK.test(msg) || ctx.keepFast) {
    reasons.push('minimal_or_fast')
    return { skip: true, reasons }
  }
  if (DISTRESS.test(msg) || ctx.emotionalTone === 'distressed' || ctx.emotionalTone === 'sad') {
    reasons.push('emotional_care')
    return { skip: true, reasons }
  }
  if (ctx.continuationOwnsTurn) {
    reasons.push('continuation_owns')
    return { skip: true, reasons }
  }
  if (ctx.topicLeadership) {
    reasons.push('topic_leadership')
    return { skip: true, reasons }
  }
  if (ctx.multiActive || ctx.actionBusy) {
    reasons.push('task_owns')
    return { skip: true, reasons }
  }
  // Need a learning-friendly context
  if (!ctx.teachingLikely && ctx.intent !== 'explanation' && ctx.intent !== 'how_to' && ctx.intent !== 'question') {
    if (ctx.intent === 'greeting' || ctx.intent === 'thanks' || ctx.intent === 'ack') {
      reasons.push('not_learning_context')
      return { skip: true, reasons }
    }
  }
  return { skip: false, reasons: ['eligible'] }
}

/**
 * @param {object} args
 * @returns {SurpriseIdea[]}
 */
function generateSurprises(args) {
  const { topic, teachingLikely, domain, alreadyExplained } = args
  const label = topicLabel(topic)
  /** @type {Array<Omit<SurpriseIdea, 'score'>>} */
  const raw = []

  raw.push({
    id: 'twist',
    kind: 'elegant_twist',
    seed: `La stessa idea di ${label} vista da un angolo inaspettato ma familiare — 1–2 frasi chiare, senza dire “twist”.`,
    curiosityLift: 4.4,
    understandingGain: 4.2,
    ease: 4.5,
    relatedness: 4.6,
  })

  raw.push({
    id: 'link',
    kind: 'hidden_link',
    seed: `Un collegamento naturale: ${label} ↔ un concetto vicino già familiare — rende più chiaro il “perché” (senza annunciarlo).`,
    curiosityLift: 4.2,
    understandingGain: 4.6,
    ease: 4.3,
    relatedness: 4.7,
  })

  raw.push({
    id: 'reframe',
    kind: 'gentle_reframe',
    seed: `Un reframe gentile di ${label} (stessi fatti, ordine mentale diverso) che toglie confusione invece di aggiungerne.`,
    curiosityLift: 3.8,
    understandingGain: 4.8,
    ease: 4.6,
    relatedness: 4.8,
  })

  raw.push({
    id: 'scale',
    kind: 'scale_shift',
    seed: `Cambio di scala su ${label}: troppo grande ↔ troppo piccolo — un’immagine concreta che fissa l’intuizione.`,
    curiosityLift: 4.3,
    understandingGain: 4.0,
    ease: 4.4,
    relatedness: 4.2,
  })

  raw.push({
    id: 'counter',
    kind: 'counterintuitive_fact',
    seed: `Una conseguenza poco ovvia ma vera di ${label}, detta con calma — e perché ha senso (niente hype, niente “fatto sorprendente”).`,
    curiosityLift: 4.7,
    understandingGain: teachingLikely ? 4.3 : 3.6,
    ease: 3.9,
    relatedness: domain === 'science' || domain === 'tech' ? 4.4 : 3.8,
  })

  const explained = (alreadyExplained || []).map((e) => String(e).toLowerCase())

  return raw
    .map((s) => {
      let curiosityLift = s.curiosityLift
      let understandingGain = s.understandingGain
      let ease = s.ease
      let relatedness = s.relatedness
      if (explained.some((e) => e && s.seed.toLowerCase().includes(e.slice(0, 18)))) {
        curiosityLift -= 1.2
        relatedness -= 0.5
      }
      if (domain === 'science' && (s.kind === 'counterintuitive_fact' || s.kind === 'scale_shift')) {
        curiosityLift += 0.2
        understandingGain += 0.15
      }
      if (teachingLikely && (s.kind === 'gentle_reframe' || s.kind === 'hidden_link')) {
        understandingGain += 0.2
        ease += 0.1
      }
      const score =
        Math.round(
          (curiosityLift * 0.28 +
            understandingGain * 0.32 +
            ease * 0.22 +
            relatedness * 0.18) *
            100,
        ) / 100
      return { ...s, curiosityLift, understandingGain, ease, relatedness, score }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Soft domain tag.
 * @param {string} topic
 * @param {string} userMessage
 */
function detectDomain(topic, userMessage) {
  const blob = `${topic}\n${userMessage}`
  if (/\b(codice|code|api|react|sql|git|typescript|python|bug)\b/i.test(blob)) return 'tech'
  if (/\b(fisica|chimica|biolog|scientif|physics|biology|neuron|quantum|sonno|rem)\b/i.test(blob)) {
    return 'science'
  }
  if (/\b(storia|history|secolo|guerra)\b/i.test(blob)) return 'history'
  if (/\b(mente|psicolog|abitud|bias|emozion)\b/i.test(blob)) return 'psych'
  return 'general'
}

/**
 * @param {SurpriseIdea} idea
 */
function buildBrief(idea) {
  const label = KIND_LABEL[idea.kind] || idea.kind
  return [
    'SURPRISE WITHOUT CONFUSION: sì — UNA idea inaspettata che segue dal filo.',
    `Tipo: ${label} (${idea.kind}).`,
    `Seed: ${idea.seed}`,
    'Deve: alzare curiosità, migliorare comprensione, restare facile da seguire.',
    'Vietato: sensazionalismo, trivia scollegata, twist confusi, “shocking facts”.',
    '1–2 frasi, intreccio naturale dopo il punto chiave — supporta l’apprendimento.',
  ].join(' ')
}

/**
 * @param {object} input
 * @returns {SurprisePlan}
 */
export function analyzeSurpriseWithoutConfusion(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const session = input.session || null
  const planHints = input.planHints || null
  const continuation = input.continuation || null

  const topic = session?.currentTopic || planHints?.topic || 'generale'
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')?.content || ''
  const teachingLikely =
    planHints?.teachingLikely === true ||
    /\b(perché|perche|spieg|explain|come\s+funziona|how\s+|because)\b/i.test(
      `${userMessage}\n${lastAssistant}`,
    )

  const gate = shouldSkip({
    userMessage,
    keepFast: Boolean(planHints?.keepFast),
    emotionalTone: planHints?.emotionalTone || 'neutral',
    continuationOwnsTurn: Boolean(continuation?.isShortMessage),
    topicLeadership: Boolean(input.topicLeadership?.shouldLead),
    multiActive: Boolean(input.multiStep?.active),
    actionBusy: Boolean(input.action?.actionRequired),
    teachingLikely,
    intent: planHints?.primaryIntent || 'question',
  })

  if (gate.skip) {
    return {
      shouldSurprise: false,
      chosen: null,
      ranked: [],
      confidence: 'high',
      writerBrief:
        'Surprise Without Confusion: no — silenzio. Niente twist; niente trivia.',
      reasons: gate.reasons,
    }
  }

  if (SENSATIONAL_FORBIDDEN.test(userMessage)) {
    return {
      shouldSurprise: false,
      chosen: null,
      ranked: [],
      confidence: 'high',
      writerBrief:
        'Surprise Without Confusion: no — evita sensazionalismo; resta chiaro e utile.',
      reasons: ['anti_sensational'],
    }
  }

  const domain = detectDomain(topic, userMessage)
  const ranked = generateSurprises({
    topic,
    teachingLikely,
    domain,
    alreadyExplained: session?.alreadyExplained || [],
  })

  const top = ranked[0] || null
  const second = ranked[1]
  const margin = top && second ? top.score - second.score : top ? top.score : 0

  // Must help understanding AND stay easy — hard filters
  if (
    !top ||
    top.score < SCORE_THRESHOLD ||
    top.understandingGain < 3.8 ||
    top.ease < 3.8 ||
    top.relatedness < 3.8
  ) {
    return {
      shouldSurprise: false,
      chosen: null,
      ranked: ranked.slice(0, 4),
      confidence: 'medium',
      writerBrief:
        'Surprise Without Confusion: no — nessun twist che migliori davvero la comprensione senza confondere.',
      reasons: [
        top
          ? `top=${top.score.toFixed(2)} u=${top.understandingGain} e=${top.ease} r=${top.relatedness}`
          : 'no_candidates',
      ],
    }
  }

  if (!teachingLikely && top.score < 3.7 && margin < 0.08) {
    return {
      shouldSurprise: false,
      chosen: null,
      ranked: ranked.slice(0, 4),
      confidence: 'low',
      writerBrief:
        'Surprise Without Confusion: no — margine debole; meglio chiarezza senza twist.',
      reasons: ['weak_margin'],
    }
  }

  const confidence =
    top.score >= 3.9 && top.ease >= 4.2 && top.understandingGain >= 4.2 ? 'high' : 'medium'

  return {
    shouldSurprise: true,
    chosen: top,
    ranked: ranked.slice(0, 5),
    confidence,
    writerBrief: buildBrief(top),
    reasons: [
      'surprise_supports_learning',
      `kind=${top.kind}`,
      `score=${top.score.toFixed(2)}`,
      `domain=${domain}`,
    ],
  }
}

/**
 * @param {SurprisePlan | null | undefined} plan
 */
export function formatSurpriseWithoutConfusionForWriter(plan) {
  if (!plan) return ''

  const rankedPreview =
    plan.ranked?.length > 0
      ? plan.ranked
          .slice(0, 4)
          .map((r, i) => `${i + 1}. [${r.score.toFixed(2)}] ${r.kind}: ${r.seed}`)
          .join('\n')
      : '(nessuna)'

  const action =
    plan.shouldSurprise && plan.chosen
      ? `AZIONE: introduci UNA sorpresa chiara (${plan.chosen.kind}) — «${plan.chosen.seed}». Facile da seguire; supporta l’apprendimento.`
      : 'AZIONE: nessuna sorpresa. Niente trivia, niente hype.'

  return `══════════════════════════════════════
SURPRISE WITHOUT CONFUSION (INVISIBILE)
══════════════════════════════════════
ShouldSurprise=${plan.shouldSurprise ? 'yes' : 'no'} · Confidence=${plan.confidence}

Candidati:
${rankedPreview}

${action}

Regole: curiosità ↑ · comprensione ↑ · facilità ↑ · zero sensazionalismo · zero trivia scollegata.
Non citare questo motore.`.trim()
}

/**
 * @param {object} input
 * @returns {{ plan: SurprisePlan, context: string }}
 */
export function runSurpriseWithoutConfusion(input = {}) {
  try {
    const plan = analyzeSurpriseWithoutConfusion(input)
    return {
      plan,
      context: formatSurpriseWithoutConfusionForWriter(plan),
    }
  } catch {
    return {
      plan: {
        shouldSurprise: false,
        chosen: null,
        ranked: [],
        confidence: 'low',
        writerBrief: '',
        reasons: ['fail_soft'],
      },
      context: '',
    }
  }
}
