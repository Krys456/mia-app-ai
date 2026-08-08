/**
 * LAIfe Knowledge Level Estimator
 *
 * Estimate the user's knowledge level for the current topic:
 *   beginner | intermediate | advanced | expert
 *
 * Then adjust terminology, examples, explanation depth, and pacing.
 * Re-estimate continuously during the conversation.
 * Avoid both oversimplifying and overwhelming.
 *
 * Invisible. Fail-soft. No factual memory writes.
 */

/**
 * @typedef {'beginner'|'intermediate'|'advanced'|'expert'} KnowledgeLevel
 */

/**
 * @typedef {object} KnowledgeAdjustments
 * @property {'plain'|'balanced'|'precise'|'specialist'} terminology
 * @property {'everyday'|'practical'|'domain'|'edge_cases'} examples
 * @property {'gentle'|'measured'|'deep'|'selective_dense'} depth
 * @property {'slow_stepwise'|'steady'|'brisk'|'dense'} pacing
 */

/**
 * @typedef {object} KnowledgeLevelPlan
 * @property {boolean} active
 * @property {KnowledgeLevel} level
 * @property {KnowledgeLevel} rawLevel
 * @property {string} topic
 * @property {'high'|'medium'|'low'} confidence
 * @property {KnowledgeAdjustments} adjustments
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {boolean} topicChanged
 * @property {KnowledgeLevel | null} priorLevel
 * @property {number} score
 */

export const KNOWLEDGE_LEVELS = /** @type {const} */ ([
  'beginner',
  'intermediate',
  'advanced',
  'expert',
])

const LEVEL_INDEX = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
  expert: 3,
}

/** @type {Record<KnowledgeLevel, KnowledgeAdjustments>} */
const ADJUSTMENTS = {
  beginner: {
    terminology: 'plain',
    examples: 'everyday',
    depth: 'gentle',
    pacing: 'slow_stepwise',
  },
  intermediate: {
    terminology: 'balanced',
    examples: 'practical',
    depth: 'measured',
    pacing: 'steady',
  },
  advanced: {
    terminology: 'precise',
    examples: 'domain',
    depth: 'deep',
    pacing: 'brisk',
  },
  expert: {
    terminology: 'specialist',
    examples: 'edge_cases',
    depth: 'selective_dense',
    pacing: 'dense',
  },
}

const EXPLICIT_BEGINNER =
  /\b(principiante|beginner|newbie|noob|sono\s+nuov[oa]|i'?m\s+new\s+to|new\s+to\s+this|from\s+scratch|parti\s+da\s+zero|non\s+so\s+niente|don'?t\s+know\s+anything|eli5|in\s+parole\s+semplici|come\s+se\s+avessi\s+5\s+anni|explain\s+like\s+i'?m\s+5|spiega\s+semplice|spiegami\s+facile)\b/i

const EXPLICIT_INTERMEDIATE =
  /\b(ho\s+le\s+basi|conosco\s+le\s+basi|i\s+know\s+the\s+basics|qualche\s+esperienza|some\s+experience|non\s+sono\s+principiante|not\s+a\s+beginner|intermediate)\b/i

const EXPLICIT_ADVANCED =
  /\b(sono\s+abbastanza\s+esperto|pretty\s+advanced|advanced\s+user|lavoro\s+(con|su)\s+quest|i\s+work\s+with|uso\s+già|already\s+use|oltre\s+le\s+basi|beyond\s+the\s+basics|salt[ae]\s+le\s+basi|skip\s+(the\s+)?basics|no\s+intro|senza\s+introduzione)\b/i

const EXPLICIT_EXPERT =
  /\b(sono\s+esper[dt][oa]|i'?m\s+an?\s+expert|esperto\s+di|expert\s+in|senior|architect|phd|ricercatore|researcher|production[\s-]grade|a\s+livello\s+produzione|deep\s+dive|under\s+the\s+hood|trade[\s-]?offs?\s+di|latency|throughput|complexity\s+analysis)\b/i

const CONFUSION =
  /\b(non\s+ho\s+capito|non\s+capisco|confused|confus[oa]|troppo\s+complicato|too\s+complicated|too\s+fast|più\s+piano|more\s+slowly|rallenta|in\s+semplice|too\s+dense|overwhelm)\b/i

const PUSH_UP =
  /\b(lo\s+so\s+già|already\s+know|ovvio|obvious|banale|troppo\s+basico|too\s+basic|oversimplif|salta\s+avanti|go\s+deeper|più\s+in\s+profond|more\s+depth|dettaglio\s+tecnico|technical\s+detail)\b/i

// Note: avoid trailing \b after accented letters — JS \b is ASCII-only, so "è" is non-word.
const SIMPLE_WHAT =
  /(?:^|[^\p{L}\p{N}_])(cos['’]?è|cos['’]?e|che\s+cos['’]?è|what\s+is|what\s+are|spiegami\s+cos|in\s+due\s+parole|in\s+breve)(?=$|[^\p{L}\p{N}_])/iu

const HOW_WHY =
  /(?:^|[^\p{L}\p{N}_])(come\s+funziona|how\s+does|how\s+do|perch[eé]|why\s+(is|do|does)|differenza\s+tra|difference\s+between)(?=$|[^\p{L}\p{N}_])/iu

const EXPERT_LEXICON =
  /\b(api|sdk|oauth|jwt|kubernetes|k8s|docker|typescript|postgres|graphql|latency|throughput|idempoten|eventual\s+consistency|cap\s+theorem|big[\s-]?o|amortized|mutex|race\s+condition|backpressure|sharding|replication|saga\s+pattern|cqrs|vector\s+clock|consensus|paxos|raft|zero[\s-]?copy|simd|wasm|llvm)\b/i

const ADVANCED_LEXICON =
  /\b(async|await|middleware|orm|index(?:ing)?|transaction|schema|deploy|ci\/cd|pipeline|cache|redis|queue|websocket|rest|endpoint|refactor|polymorphism|closure|prototype|concurrency|deadlock|normalization|migration)\b/i

const INTERMEDIATE_LEXICON =
  /\b(codice|code|funzione|function|database|server|framework|git|bug|errore|error|class|oggetto|object|variabile|variable|array|json|http|html|css|script|modulo|module|package|libreria|library)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {KnowledgeLevel} level
 */
function levelIndex(level) {
  return LEVEL_INDEX[level] ?? 1
}

/**
 * @param {number} idx
 * @returns {KnowledgeLevel}
 */
function levelFromIndex(idx) {
  const clamped = Math.max(0, Math.min(3, Math.round(idx)))
  return KNOWLEDGE_LEVELS[clamped]
}

/**
 * @param {KnowledgeLevel} from
 * @param {KnowledgeLevel} to
 * @param {boolean} allowJump
 */
function smoothLevel(from, to, allowJump) {
  if (!from) return to
  const a = levelIndex(from)
  const b = levelIndex(to)
  if (allowJump || Math.abs(b - a) <= 1) return to
  return levelFromIndex(a + Math.sign(b - a))
}

/**
 * Score a single utterance toward a continuous knowledge score (0–3).
 * @param {string} text
 * @returns {{ score: number, reasons: string[], strong: boolean, explicit: boolean }}
 */
export function scoreUtterance(text) {
  const t = normalize(text)
  if (!t) return { score: 1, reasons: [], strong: false, explicit: false }

  let score = 1 // default intermediate-ish baseline before evidence
  /** @type {string[]} */
  const reasons = []
  let strong = false
  let explicit = false

  if (EXPLICIT_EXPERT.test(t)) {
    score = 3
    reasons.push('explicit_expert')
    strong = true
    explicit = true
  } else if (EXPLICIT_ADVANCED.test(t)) {
    score = 2.2
    reasons.push('explicit_advanced')
    strong = true
    explicit = true
  } else if (EXPLICIT_INTERMEDIATE.test(t)) {
    score = 1.1
    reasons.push('explicit_intermediate')
    strong = true
    explicit = true
  } else if (EXPLICIT_BEGINNER.test(t)) {
    score = 0.15
    reasons.push('explicit_beginner')
    strong = true
    explicit = true
  }

  if (CONFUSION.test(t)) {
    score -= 0.85
    reasons.push('confusion_signal')
    strong = true
  }
  if (PUSH_UP.test(t)) {
    score += 0.75
    reasons.push('push_deeper')
    strong = true
  }

  const expertHits = (t.match(EXPERT_LEXICON) || []).length
  const advancedHits = (t.match(ADVANCED_LEXICON) || []).length
  const intermediateHits = (t.match(INTERMEDIATE_LEXICON) || []).length

  if (expertHits >= 2) {
    score += 1.2
    reasons.push('expert_lexicon')
  } else if (expertHits === 1) {
    score += 0.55
    reasons.push('expert_term')
  }
  if (advancedHits >= 2) {
    score += 0.7
    reasons.push('advanced_lexicon')
  } else if (advancedHits === 1) {
    score += 0.35
    reasons.push('advanced_term')
  }
  if (intermediateHits >= 2 && expertHits === 0) {
    score += 0.25
    reasons.push('intermediate_lexicon')
  }

  if (SIMPLE_WHAT.test(t) && expertHits === 0 && advancedHits === 0) {
    score -= 0.55
    reasons.push('simple_what_is')
  } else if (HOW_WHY.test(t)) {
    score += 0.15
    reasons.push('how_why')
  }

  // Very short naive questions → lean beginner
  if (t.length < 40 && SIMPLE_WHAT.test(t) && intermediateHits === 0) {
    score -= 0.25
    reasons.push('short_naive_ask')
  }

  // Long precise multi-clause technical asks → lean up
  if (t.length > 180 && (advancedHits + expertHits) >= 2) {
    score += 0.35
    reasons.push('long_technical_ask')
  }

  score = Math.max(0, Math.min(3, score))
  return { score, reasons, strong, explicit }
}

/**
 * Map continuous score to discrete level.
 * @param {number} score
 * @returns {KnowledgeLevel}
 */
export function levelFromScore(score) {
  if (score < 0.75) return 'beginner'
  if (score < 1.55) return 'intermediate'
  if (score < 2.35) return 'advanced'
  return 'expert'
}

/**
 * Confidence from evidence strength.
 * @param {string[]} reasons
 * @param {boolean} strong
 * @param {number} evidenceCount
 */
function confidenceFromEvidence(reasons, strong, evidenceCount) {
  if (strong && evidenceCount >= 1) return /** @type {const} */ ('high')
  if (reasons.length >= 3 || evidenceCount >= 3) return /** @type {const} */ ('medium')
  if (reasons.length >= 1) return /** @type {const} */ ('medium')
  return /** @type {const} */ ('low')
}

/**
 * Build Writer guidance for the estimated level.
 * @param {KnowledgeLevel} level
 * @param {KnowledgeAdjustments} adj
 * @param {string} topic
 */
function buildWriterBrief(level, adj, topic) {
  const topicBit = topic && topic !== 'generale' ? ` su «${topic}»` : ''

  /** @type {Record<KnowledgeLevel, string>} */
  const levelLines = {
    beginner: `Livello stimato: principiante${topicBit}. Termini semplici (spiega jargon al primo uso). Esempi quotidiani concreti. Profondità gentile: un’idea alla volta. Ritmo lento e progressivo. Non dare per scontato nulla — ma non essere condiscendente.`,
    intermediate: `Livello stimato: intermedio${topicBit}. Lessico bilanciato (termini tecnici ok se chiari dal contesto). Esempi pratici di lavoro reale. Profondità misurata: meccanismo + un esempio. Ritmo costante. Non oversimplificare le basi già implicite.`,
    advanced: `Livello stimato: avanzato${topicBit}. Terminologia precisa del dominio. Esempi di dominio (casi reali, non analogie infantili). Profondità alta: trade-off e dettagli utili. Ritmo spedito. Salta le introduzioni ovvie; non sommergere con tutorial da zero.`,
    expert: `Livello stimato: esperto${topicBit}. Lessico specialistico senza diluizione. Esempi su edge case, limiti e design choices. Profondità selettiva e densa: vai al punto ad alto segnale. Ritmo denso. Mai oversimplificare; evita anche il dump enciclopedico — densità ≠ volume.`,
  }

  return [
    'KNOWLEDGE LEVEL ESTIMATOR (invisibile):',
    levelLines[level],
    `Calibrazione: terminology=${adj.terminology}; examples=${adj.examples}; depth=${adj.depth}; pacing=${adj.pacing}.`,
    'Ri-stima a ogni turno; adatta se l’utente mostra confusione o chiede più profondità.',
    'Evita sia di semplificare troppo sia di sopraffare.',
    'Non dichiarare il livello all’utente (“visto che sei principiante…”).',
  ].join(' ')
}

/**
 * Collect recent user texts relevant to the topic.
 * @param {Array<{ role?: string, content?: string }>|undefined} messages
 * @param {string} userMessage
 * @param {string} topic
 */
function collectUserEvidence(messages, userMessage, topic) {
  /** @type {string[]} */
  const texts = []
  if (Array.isArray(messages)) {
    const topicTokens = new Set(
      normalize(topic)
        .toLowerCase()
        .split(/[^a-z0-9àèéìòù]+/i)
        .filter((w) => w.length > 3),
    )
    for (const m of messages) {
      if (m?.role !== 'user' || typeof m.content !== 'string') continue
      const c = normalize(m.content)
      if (!c) continue
      if (topicTokens.size === 0) {
        texts.push(c)
        continue
      }
      const lower = c.toLowerCase()
      const overlap = [...topicTokens].some((tok) => lower.includes(tok))
      // Keep recent short acks too — they often carry confusion/push signals
      if (overlap || c.length < 48) texts.push(c)
    }
  }
  const current = normalize(userMessage)
  if (current && texts[texts.length - 1] !== current) texts.push(current)
  return texts.slice(-8)
}

/**
 * Estimate knowledge level for the current topic and build calibration plan.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {Array<{ role?: string, content?: string }>} [input.messages]
 * @param {{ currentTopic?: string, topicShift?: boolean, alreadyExplained?: string[], knowledgeLevel?: string, knowledgeTopic?: string } | null} [input.session]
 * @param {KnowledgeLevel | null} [input.priorLevel]
 * @param {{ primaryIntent?: string, complexity?: string } | null} [input.understanding]
 * @returns {{ plan: KnowledgeLevelPlan, context: string }}
 */
export function runKnowledgeLevelEstimator(input) {
  try {
    const userMessage = normalize(input.userMessage)
    const session = input.session || {}
    const topic = normalize(session.currentTopic || '') || 'generale'
    const topicChanged = Boolean(session.topicShift)

    /** @type {KnowledgeLevel | null} */
    let priorLevel = null
    if (input.priorLevel && LEVEL_INDEX[input.priorLevel] != null) {
      priorLevel = input.priorLevel
    } else if (
      session.knowledgeLevel &&
      LEVEL_INDEX[/** @type {KnowledgeLevel} */ (session.knowledgeLevel)] != null &&
      (!session.knowledgeTopic || session.knowledgeTopic === topic || !topicChanged)
    ) {
      priorLevel = /** @type {KnowledgeLevel} */ (session.knowledgeLevel)
    }

    // On hard topic shift without prior for new topic, start fresh (light intermediate bias)
    if (topicChanged && session.knowledgeTopic && session.knowledgeTopic !== topic) {
      priorLevel = null
    }

    const evidence = collectUserEvidence(input.messages, userMessage, topic)
    let weighted = 0
    let weightSum = 0
    /** @type {string[]} */
    const reasons = []
    let anyStrong = false
    let anyExplicit = false

    /** @type {{ score: number, reasons: string[], strong: boolean, explicit?: boolean } | null} */
    let latest = null

    evidence.forEach((text, i) => {
      const { score, reasons: r, strong, explicit } = scoreUtterance(text)
      // Recency bias: later utterances weigh more
      const w = 0.4 + (i / Math.max(1, evidence.length - 1)) * 1.4
      weighted += score * w
      weightSum += w
      if (i >= evidence.length - 2) reasons.push(...r)
      if (strong && i >= evidence.length - 2) anyStrong = true
      if (explicit && i >= evidence.length - 2) anyExplicit = true
      if (i === evidence.length - 1) latest = { score, reasons: r, strong, explicit }
    })

    let continuous = weightSum > 0 ? weighted / weightSum : 1

    // Strong latest signal dominates — continuous re-estimate should react this turn
    if (latest?.strong) {
      continuous = continuous * 0.35 + latest.score * 0.65
      reasons.push('latest_strong_override')
    }

    // alreadyExplained volume on topic → slight upward drift (they've absorbed material)
    const explained = Array.isArray(session.alreadyExplained)
      ? session.alreadyExplained.length
      : 0
    if (explained >= 4) {
      continuous += 0.25
      reasons.push('absorbed_prior_explanations')
    } else if (explained >= 2) {
      continuous += 0.1
      reasons.push('some_prior_explanations')
    }

    // Intent hints
    const intent = input.understanding?.primaryIntent
    if (intent === 'explanation' || intent === 'how_to') {
      // Asking for explanation ≠ beginner by itself; slight downward only if score already low
      if (continuous < 1) {
        continuous -= 0.05
        reasons.push('learning_intent')
      }
    }

    continuous = Math.max(0, Math.min(3, continuous))
    const rawLevel = levelFromScore(continuous)
    // Only explicit self-labels may jump more than one band in a single turn
    const level = smoothLevel(priorLevel, rawLevel, anyExplicit)
    const adjustments = ADJUSTMENTS[level]
    const confidence = confidenceFromEvidence(reasons, anyStrong, evidence.length)
    const writerBrief = buildWriterBrief(level, adjustments, topic)

    if (priorLevel && priorLevel !== level) {
      reasons.push(`smoothed_${priorLevel}_to_${level}`)
    } else if (!priorLevel) {
      reasons.push('fresh_estimate')
    } else {
      reasons.push('level_stable')
    }

    /** @type {KnowledgeLevelPlan} */
    const plan = {
      active: true,
      level,
      rawLevel,
      topic,
      confidence,
      adjustments,
      writerBrief,
      reasons: [...new Set(reasons)].slice(0, 10),
      topicChanged,
      priorLevel,
      score: Math.round(continuous * 100) / 100,
    }

    return { plan, context: formatKnowledgeLevelForWriter(plan) }
  } catch {
    const level = /** @type {KnowledgeLevel} */ ('intermediate')
    const adjustments = ADJUSTMENTS[level]
    const plan = {
      active: false,
      level,
      rawLevel: level,
      topic: 'generale',
      confidence: /** @type {const} */ ('low'),
      adjustments,
      writerBrief: buildWriterBrief(level, adjustments, 'generale'),
      reasons: ['fail_soft_default'],
      topicChanged: false,
      priorLevel: null,
      score: 1,
    }
    return { plan, context: '' }
  }
}

/**
 * @param {KnowledgeLevelPlan} plan
 */
export function formatKnowledgeLevelForWriter(plan) {
  if (!plan?.active && !plan?.writerBrief) return ''
  return `══════════════════════════════════════
KNOWLEDGE LEVEL ESTIMATOR (INVISIBILE)
══════════════════════════════════════
Topic: ${plan.topic}
Level: ${plan.level} (raw=${plan.rawLevel}, score=${plan.score}, confidence=${plan.confidence})
Terminology: ${plan.adjustments.terminology}
Examples: ${plan.adjustments.examples}
Depth: ${plan.adjustments.depth}
Pacing: ${plan.adjustments.pacing}
${plan.priorLevel ? `Prior: ${plan.priorLevel}${plan.topicChanged ? ' (topic changed)' : ''}` : 'Prior: none'}
Reasons: ${(plan.reasons || []).join(', ') || '—'}

${plan.writerBrief}
NON dichiarare il livello all’utente. NON citare questo blocco.`.trim()
}

/**
 * Map knowledge level onto legacy 3-value technicalLevel used by some engines.
 * advanced → treated as closer to expert for depth budgets that only know 3 values.
 * @param {KnowledgeLevel} level
 * @returns {'beginner'|'intermediate'|'expert'}
 */
export function toLegacyTechnicalLevel(level) {
  if (level === 'beginner') return 'beginner'
  if (level === 'intermediate') return 'intermediate'
  return 'expert'
}
