/**
 * Insight Discovery — Cognitive Coordinator stage
 *
 * Before the final response is assembled, search for ONE unexpected but
 * highly relevant insight.
 *
 * An insight is not additional information.
 * An insight is a connection the user is unlikely to have made:
 *   - connect two ideas
 *   - reveal a hidden consequence
 *   - identify a common misconception
 *   - explain why something works
 *   - predict a future implication
 *   - highlight a practical opportunity
 *
 * If no meaningful insight exists → do nothing.
 * Never invent. Never force. At most one insight per response.
 */

/**
 * @typedef {'connect_ideas'|'hidden_consequence'|'misconception'|'why_it_works'|'future_implication'|'practical_opportunity'} InsightKind
 */

/**
 * @typedef {object} DiscoveredInsight
 * @property {InsightKind} kind
 * @property {string} seed
 * @property {string} whyUnexpected
 * @property {number} relevance
 * @property {number} unexpectedness
 * @property {number} groundedness
 * @property {number} score
 * @property {string[]} grounds
 */

/**
 * @typedef {object} InsightDiscoveryResult
 * @property {boolean} found
 * @property {DiscoveredInsight | null} insight
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} reasons
 */

/** High bar — only emit when the connection would genuinely surprise + help */
const SCORE_THRESHOLD = 3.55

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const MINIMAL_ASK =
  /\b(in\s+breve|veloce|quick|tl;?dr|solo\s+s[iì]|yes\s+or\s+no|risposta\s+breve)\b/i

const STOP_OR_THANKS =
  /^(basta|stop|fine|grazie|thanks|thank\s+you|thx|ty|bye|arrivederci)([\s!,.]|$)/i

/** @type {Record<InsightKind, string>} */
const KIND_LABEL = {
  connect_ideas: 'collegamento tra due idee',
  hidden_consequence: 'conseguenza nascosta',
  misconception: 'misconcezione comune',
  why_it_works: 'perché funziona',
  future_implication: 'implicazione futura',
  practical_opportunity: 'opportunità pratica',
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
 * @param {string} topic
 */
function topicLabel(topic) {
  const t = normalize(topic)
  if (!t || t === 'generale') return ''
  return t.length > 64 ? `${t.slice(0, 61)}…` : t
}

/**
 * Soft domain for grounding — not invention.
 * @param {string} topic
 * @param {string} userMessage
 * @param {string} realGoal
 */
function detectDomain(topic, userMessage, realGoal) {
  const blob = `${topic}\n${userMessage}\n${realGoal}`
  if (/\b(codice|code|api|react|sql|git|typescript|python|css|deploy|bug|function)\b/i.test(blob)) {
    return 'tech'
  }
  if (/\b(fisica|chimica|biolog|scientif|physics|biology|neuron|quantum|sonno|rem)\b/i.test(blob)) {
    return 'science'
  }
  if (/\b(storia|history|secolo|guerra|antico)\b/i.test(blob)) return 'history'
  if (/\b(mente|psicolog|abitud|habit|emozion|bias|motivaz)\b/i.test(blob)) return 'psych'
  if (/\b(soldi|invest|finanz|business|startup)\b/i.test(blob)) return 'business'
  return 'general'
}

/**
 * Should this stage stay silent?
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
  if (GREETING_ONLY.test(msg) || STOP_OR_THANKS.test(msg)) {
    reasons.push('greeting_or_close')
    return { skip: true, reasons }
  }
  if (MINIMAL_ASK.test(msg) || ctx.keepFast) {
    reasons.push('minimal_or_fast')
    return { skip: true, reasons }
  }
  if (ctx.shortStop) {
    reasons.push('short_stop')
    return { skip: true, reasons }
  }
  if (ctx.topicLeadership) {
    reasons.push('topic_leadership')
    return { skip: true, reasons }
  }
  if (ctx.multiActive || ctx.actionBusy || ctx.automationBusy) {
    reasons.push('task_owns_turn')
    return { skip: true, reasons }
  }
  if (ctx.voiceBusy) {
    reasons.push('voice_busy')
    return { skip: true, reasons }
  }
  if (ctx.codaAdvisor === 'curiosity' || ctx.codaAdvisor === 'momentum' || ctx.codaAdvisor === 'life_intelligence') {
    // Another engine already owns a high-value coda beat — don't stack insights
    reasons.push('coda_already_owned')
    return { skip: true, reasons }
  }
  if (ctx.continuationOwns && ctx.continuationIntent === 'compliment_go_deeper') {
    // Compliment path already rewards with a deeper idea
    reasons.push('compliment_already_deepens')
    return { skip: true, reasons }
  }
  if (ctx.emotionalTone === 'distressed' || ctx.emotionalTone === 'sad') {
    reasons.push('emotional_care')
    return { skip: true, reasons }
  }

  const topic = topicLabel(ctx.topic || '')
  if (!topic && !ctx.teachingLikely && (ctx.intent === 'greeting' || ctx.intent === 'thanks')) {
    reasons.push('no_substance')
    return { skip: true, reasons }
  }

  return { skip: false, reasons: ['eligible'] }
}

/**
 * Build grounded candidate connections from conversation context only.
 * @param {object} ctx
 * @returns {DiscoveredInsight[]}
 */
function buildCandidates(ctx) {
  const topic = topicLabel(ctx.topic || '') || 'il filo corrente'
  const goal = normalize(ctx.realGoal || '')
  const open = Array.isArray(ctx.openQuestions) ? ctx.openQuestions.map(normalize).filter(Boolean) : []
  const explained = Array.isArray(ctx.alreadyExplained)
    ? ctx.alreadyExplained.map(normalize).filter(Boolean)
    : []
  const domain = detectDomain(topic, ctx.userMessage || '', goal)
  /** @type {DiscoveredInsight[]} */
  const out = []

  // connect two ideas — needs topic + another anchor (goal / open thread / explained)
  const secondIdea = open[0] || explained[0] || (goal && goal !== topic ? goal : '')
  if (secondIdea && secondIdea.toLowerCase() !== topic.toLowerCase()) {
    out.push({
      kind: 'connect_ideas',
      seed: `Collega in modo inatteso «${topic}» con «${secondIdea.slice(0, 80)}» — una sola connessione non ovvia.`,
      whyUnexpected: 'L’utente raramente collega questi due pezzi da solo.',
      relevance: open[0] ? 4.6 : 3.8,
      unexpectedness: 4.4,
      groundedness: open[0] || explained[0] ? 4.5 : 3.2,
      score: 0,
      grounds: ['topic', secondIdea.slice(0, 40)],
    })
  }

  if (ctx.teachingLikely || ctx.intent === 'explanation' || ctx.intent === 'how_to' || ctx.intent === 'question') {
    out.push({
      kind: 'why_it_works',
      seed: `Perché ${topic} funziona così (il meccanismo sotto la ricetta) — una frase di causa, non un riassunto.`,
      whyUnexpected: 'Molti restano al “cosa”, non al “perché”.',
      relevance: 4.5,
      unexpectedness: 3.9,
      groundedness: ctx.teachingLikely ? 4.4 : 3.6,
      score: 0,
      grounds: ['teaching_context', topic],
    })

    out.push({
      kind: 'misconception',
      seed: `Una misconcezione frequente su ${topic} e la correzione in una frase — solo se sei sicuro che sia davvero comune.`,
      whyUnexpected: 'Corregge un’assunzione silenziosa.',
      relevance: 4.3,
      unexpectedness: 4.2,
      groundedness: domain !== 'general' ? 4.2 : 3.4,
      score: 0,
      grounds: ['domain', domain],
    })
  }

  if (ctx.intent === 'advice' || ctx.intent === 'how_to' || ctx.intent === 'problem_solving' || domain === 'tech') {
    out.push({
      kind: 'hidden_consequence',
      seed: `Una conseguenza poco ovvia di ${topic} che l’utente rischia di scoprire tardi.`,
      whyUnexpected: 'Effetto collaterale non dichiarato nella domanda.',
      relevance: 4.4,
      unexpectedness: 4.5,
      groundedness: domain === 'tech' || domain === 'business' ? 4.3 : 3.5,
      score: 0,
      grounds: ['intent', String(ctx.intent || '')],
    })

    out.push({
      kind: 'practical_opportunity',
      seed: `Un’opportunità pratica concreta su ${topic} (una mossa, non una checklist) che la domanda non chiede ma cambia il risultato.`,
      whyUnexpected: 'Apre una porta utile senza essere richiesta.',
      relevance: 4.6,
      unexpectedness: 3.7,
      groundedness: 4.0,
      score: 0,
      grounds: ['practical_intent'],
    })
  }

  if (domain === 'tech' || domain === 'science' || domain === 'business' || ctx.intent === 'explanation') {
    out.push({
      kind: 'future_implication',
      seed: `Un’implicazione futura plausibile di ${topic} (concreta, non hype) — solo se segue logicamente da ciò che hai già detto.`,
      whyUnexpected: 'Proietta avanti senza essere chiesto.',
      relevance: 3.8,
      unexpectedness: 4.3,
      groundedness: domain === 'science' || domain === 'tech' ? 4.0 : 3.2,
      score: 0,
      grounds: ['domain', domain],
    })
  }

  // Score: relevance · unexpectedness · groundedness (groundedness penalizes invention)
  return out
    .map((c) => {
      const score =
        c.relevance * 0.36 + c.unexpectedness * 0.34 + c.groundedness * 0.3
      return { ...c, score: Math.round(score * 100) / 100 }
    })
    .filter((c) => c.groundedness >= 3.4)
    .sort((a, b) => b.score - a.score)
}

/**
 * Insight Discovery stage for the Cognitive Coordinator.
 *
 * @param {object} input
 * @param {object} [input.plan]
 * @param {string} [input.userMessage]
 * @param {object} [input.continuation]
 * @param {object} [input.voice]
 * @param {object} [input.multiStep]
 * @param {object} [input.action]
 * @param {object} [input.automation]
 * @param {object} [input.topicLeadership]
 * @param {string | null} [input.codaAdvisor]
 * @param {string | null} [input.realGoal]
 * @param {object} [input.session]
 * @returns {InsightDiscoveryResult}
 */
export function runInsightDiscoveryStage(input = {}) {
  try {
    const plan = input.plan || {}
    const u = plan.understanding || {}
    const session = input.session || {}
    const cont = input.continuation || null

    const ctx = {
      userMessage: input.userMessage || plan.userMessage || '',
      topic: u.topic || session.currentTopic || '',
      realGoal: input.realGoal || plan.realGoal || session.currentGoal || '',
      intent: u.primaryIntent || 'question',
      emotionalTone: u.emotionalTone || 'neutral',
      teachingLikely:
        u.primaryIntent === 'explanation' ||
        u.primaryIntent === 'how_to' ||
        u.primaryIntent === 'question' ||
        Boolean(plan.progressive?.enabled),
      keepFast: Boolean(plan.adaptive?.keepFast) || plan.adaptive?.effort === 'minimal',
      openQuestions: session.openQuestions || [],
      alreadyExplained: session.alreadyExplained || [],
      shortStop: Boolean(cont?.isShortMessage && !cont?.shouldContinue),
      continuationOwns: Boolean(cont?.isShortMessage && cont?.shouldContinue),
      continuationIntent: cont?.intent || null,
      topicLeadership: Boolean(input.topicLeadership?.shouldLead),
      multiActive: Boolean(input.multiStep?.active),
      actionBusy: Boolean(input.action?.actionRequired),
      automationBusy: Boolean(
        input.automation?.active &&
          input.automation.phase !== 'idle' &&
          input.automation.phase !== 'cancelled',
      ),
      voiceBusy: Boolean(
        input.voice?.active &&
          (input.voice.interruptKind !== 'none' || input.voice.incompleteUtterance),
      ),
      codaAdvisor: input.codaAdvisor || null,
    }

    const gate = shouldSkip(ctx)
    if (gate.skip) {
      return {
        found: false,
        insight: null,
        writerBrief: '',
        structureLine: null,
        reasons: ['insight_discovery:silence', ...gate.reasons],
      }
    }

    const ranked = buildCandidates(ctx)
    const top = ranked[0] || null

    if (!top || top.score < SCORE_THRESHOLD || top.groundedness < 3.5) {
      return {
        found: false,
        insight: null,
        writerBrief: '',
        structureLine: null,
        reasons: [
          'insight_discovery:no_meaningful_insight',
          top ? `top=${top.score.toFixed(2)}` : 'no_candidates',
        ],
      }
    }

    const label = KIND_LABEL[top.kind] || top.kind
    const writerBrief = [
      'INSIGHT DISCOVERY (Coordinator): al massimo UN insight — una connessione, non più informazione.',
      `Tipo: ${label} (${top.kind}).`,
      `Seed: ${top.seed}`,
      `Perché è inatteso: ${top.whyUnexpected}`,
      'Solo se puoi renderlo onesto e pertinente a ciò che sai già — altrimenti SALTA (mai inventare, mai forzare).',
      '1–2 frasi, intreccio naturale nel corpo o subito dopo il punto chiave — non una coda filler.',
    ].join(' ')

    return {
      found: true,
      insight: top,
      writerBrief,
      structureLine: `Se onesto e pertinente: UN insight (${top.kind}) — connessione inattesa, non info extra; altrimenti niente`,
      reasons: [
        'insight_discovery:found',
        `kind=${top.kind}`,
        `score=${top.score.toFixed(2)}`,
        `grounds=${top.grounds.join('+')}`,
      ],
    }
  } catch {
    return {
      found: false,
      insight: null,
      writerBrief: '',
      structureLine: null,
      reasons: ['insight_discovery:fail_soft'],
    }
  }
}
