/**
 * LAIfe Intellectual Honesty Engine
 *
 * Before presenting any statement, determine whether it is:
 *   - established fact
 *   - strong evidence
 *   - reasonable inference
 *   - speculation
 *   - opinion
 *
 * Communicate the appropriate level of certainty.
 * Never present speculation as fact.
 * Be transparent about uncertainty.
 * Confidence should match evidence.
 *
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'established_fact'|'strong_evidence'|'reasonable_inference'|'speculation'|'opinion'} EpistemicStatus
 */

/**
 * @typedef {object} ClaimBand
 * @property {EpistemicStatus} status
 * @property {number} weight 0–1 expected share of claims
 * @property {string} guidance
 */

/**
 * @typedef {object} IntellectualHonestyPlan
 * @property {boolean} active
 * @property {EpistemicStatus} ceiling  highest justified certainty for this turn
 * @property {EpistemicStatus} dominantStance  most likely claim type
 * @property {ClaimBand[]} claimBands
 * @property {'none'|'weak'|'moderate'|'strong'} toolEvidence
 * @property {string[]} riskFlags
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} framingHints
 * @property {string[]} reasons
 */

/** @type {Record<EpistemicStatus, { rank: number, labelIt: string, frame: string }>} */
export const EPISTEMIC_LADDER = {
  established_fact: {
    rank: 5,
    labelIt: 'fatto stabilito',
    frame: 'Puoi affermare con certezza solo ciò che è consolidato / verificato qui.',
  },
  strong_evidence: {
    rank: 4,
    labelIt: 'evidenza forte',
    frame: 'Segnala come ben supportato (dati, fonti, strumenti) — non come verità assoluta.',
  },
  reasonable_inference: {
    rank: 3,
    labelIt: 'inferenza ragionevole',
    frame: 'Usa “ne segue che…”, “è plausibile che…” — collegamento chiaro alle premesse.',
  },
  speculation: {
    rank: 2,
    labelIt: 'speculazione',
    frame: 'Etichetta esplicitamente: “è una ipotesi”, “non è certo”, “potrebbe”. Mai come fatto.',
  },
  opinion: {
    rank: 1,
    labelIt: 'opinione',
    frame: 'Presenta come giudizio di valore / preferenza: “a mio avviso”, “ha senso se…”.',
  },
}

const STATUS_ORDER = /** @type {EpistemicStatus[]} */ ([
  'established_fact',
  'strong_evidence',
  'reasonable_inference',
  'speculation',
  'opinion',
])

const STOP_OR_SOCIAL =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo|basta|stop|fine|grazie|thanks|thank\s+you|thx|ty|bye|arrivederci|buonanotte|ok|okay|capito|yes|no|sì)([\s!,.]|$)/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)[\s!.]*$/i

const PREDICTION_FUTURE =
  /\b(predici|prevedi|will\s+it|in\s+futuro|tra\s+\d+\s+anni|by\s+20\d{2}|what\s+will|quanto\s+valeva|price\s+target|bull\s+case|scenario\s+futur)\b/i

const OPINION_ASK =
  /\b(secondo\s+te|what\s+do\s+you\s+think|opinione|preferisc|dovrei|should\s+i|meglio\s+[a-z]|which\s+is\s+better|consigliami|ti\s+piace)\b/i

const ESTIMATE_ASK =
  /\b(stim[ae]|estimate|approssim|roughly|circa\s+quanto|ballpark|ordine\s+di\s+grandezza|guess)\b/i

const DEFINITION_FACT =
  /(^|[\s(?¿])(cos['’]?[eè]|what\s+is|definizione|definition|quando\s+[eè]\s+nato|in\s+che\s+anno|capitale\s+di|formula\s+di)(?=$|[\s?!.:,])/i

const HOW_TO =
  /\b(come\s+(faccio|fare|si)|how\s+(do|to|can)|passo\s+passo|step\s+by\s+step|tutorial)\b/i

const VOLATILE_DOMAIN =
  /\b(oggi|stamattina|breaking|ultime\s+notizie|latest\s+news|prezzo\s+attual|current\s+price|corso\s+azion|bitcoin|crypto|elezioni|covid|vaccine|farmaco|diagnos|legal\s+advice|consulenza\s+legal|avvocato|sentenza)\b/i

const MEDICAL_LEGAL =
  /\b(diagnos|sintom[oi]|farmaco|medicinal|cancro|cancer|infart|avvocato|tribunale|reato|pena|contratto\s+legal)\b/i

const NUMBER_CLAIM_RISK =
  /\b(\d+\s*%|milioni|miliardi|billion|million|exactly|esattamente|sempre|never|sempre|100\s*%|garantito)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {EpistemicStatus} a
 * @param {EpistemicStatus} b
 * @returns {EpistemicStatus}
 */
function minStatus(a, b) {
  return EPISTEMIC_LADDER[a].rank <= EPISTEMIC_LADDER[b].rank ? a : b
}

/**
 * @param {EpistemicStatus} status
 */
function statusesAtOrBelow(status) {
  const rank = EPISTEMIC_LADDER[status].rank
  return STATUS_ORDER.filter((s) => EPISTEMIC_LADDER[s].rank <= rank)
}

/**
 * Assess tool evidence strength from orchestrator results.
 * @param {Array<{ tool?: string, ok?: boolean, summary?: string, data?: unknown }>|undefined|null} toolResults
 * @returns {'none'|'weak'|'moderate'|'strong'}
 */
export function assessToolEvidence(toolResults) {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return 'none'

  let best = /** @type {'none'|'weak'|'moderate'|'strong'} */ ('none')
  for (const r of toolResults) {
    if (!r || r.ok === false) continue
    const tool = String(r.tool || '')
    if (tool === 'calculator') {
      best = 'strong'
      continue
    }
    if (tool === 'web' || tool === 'weather' || tool === 'calendar') {
      if (best !== 'strong') best = 'moderate'
      continue
    }
    if (tool === 'memory' || tool === 'vision' || tool === 'document') {
      if (best === 'none') best = 'weak'
      else if (best === 'weak') best = 'moderate'
    }
  }
  return best
}

/**
 * @param {object} ctx
 */
function detectRiskFlags(ctx) {
  const msg = normalize(ctx.userMessage || '')
  /** @type {string[]} */
  const flags = []

  if (PREDICTION_FUTURE.test(msg)) flags.push('future_prediction')
  if (ESTIMATE_ASK.test(msg)) flags.push('estimate_request')
  if (OPINION_ASK.test(msg)) flags.push('opinion_request')
  if (VOLATILE_DOMAIN.test(msg)) flags.push('volatile_domain')
  if (MEDICAL_LEGAL.test(msg)) flags.push('high_stakes_domain')
  if (NUMBER_CLAIM_RISK.test(msg)) flags.push('numeric_certainty_risk')
  if (ctx.toolEvidence === 'none' && (VOLATILE_DOMAIN.test(msg) || PREDICTION_FUTURE.test(msg))) {
    flags.push('no_fresh_sources')
  }
  if (ctx.keepFast) flags.push('keep_fast_brevity')
  return flags
}

/**
 * Pick epistemic ceiling from intent, risks, and tool evidence.
 * @param {object} ctx
 * @returns {{ ceiling: EpistemicStatus, dominant: EpistemicStatus, reasons: string[] }}
 */
function chooseCeiling(ctx) {
  const msg = normalize(ctx.userMessage || '')
  const intent = ctx.intent || ''
  const flags = ctx.riskFlags || []
  /** @type {string[]} */
  const reasons = []

  /** @type {EpistemicStatus} */
  let ceiling = 'reasonable_inference'
  /** @type {EpistemicStatus} */
  let dominant = 'reasonable_inference'

  if (flags.includes('opinion_request') || intent === 'opinion') {
    ceiling = 'opinion'
    dominant = 'opinion'
    reasons.push('opinion_ask')
  } else if (flags.includes('future_prediction')) {
    ceiling = 'speculation'
    dominant = 'speculation'
    reasons.push('future_uncertain')
  } else if (flags.includes('estimate_request')) {
    ceiling = 'speculation'
    dominant = 'reasonable_inference'
    reasons.push('estimate_as_inference_plus_speculation')
  } else if (DEFINITION_FACT.test(msg) || intent === 'definition') {
    ceiling = 'established_fact'
    dominant = 'established_fact'
    reasons.push('definitional_or_established')
  } else if (HOW_TO.test(msg) || intent === 'how_to') {
    ceiling = 'strong_evidence'
    dominant = 'reasonable_inference'
    reasons.push('howto_practice')
  } else if (intent === 'explanation' || intent === 'question') {
    ceiling = 'strong_evidence'
    dominant = 'reasonable_inference'
    reasons.push('explanatory_question')
  } else if (intent === 'calculation') {
    ceiling = 'established_fact'
    dominant = 'established_fact'
    reasons.push('calculation')
  } else if (intent === 'creative' || intent === 'brainstorm') {
    ceiling = 'opinion'
    dominant = 'speculation'
    reasons.push('creative_mode')
  }

  // Tool evidence can raise justified certainty — never invent it without support
  if (ctx.toolEvidence === 'strong') {
    if (intent === 'calculation') {
      ceiling = 'established_fact'
      dominant = 'established_fact'
    } else if (DEFINITION_FACT.test(msg) || intent === 'definition') {
      ceiling = 'established_fact'
      dominant = 'established_fact'
    } else {
      // Calculator / strong tools → at least strong_evidence; do not overclaim
      if (EPISTEMIC_LADDER[ceiling].rank < EPISTEMIC_LADDER.strong_evidence.rank) {
        ceiling = 'strong_evidence'
      }
      if (EPISTEMIC_LADDER[dominant].rank < EPISTEMIC_LADDER.strong_evidence.rank) {
        dominant = 'strong_evidence'
      }
    }
    reasons.push('tool_evidence_strong')
  } else if (ctx.toolEvidence === 'moderate') {
    if (
      EPISTEMIC_LADDER[ceiling].rank > EPISTEMIC_LADDER.strong_evidence.rank &&
      !DEFINITION_FACT.test(msg) &&
      intent !== 'definition' &&
      intent !== 'calculation'
    ) {
      ceiling = 'strong_evidence'
    }
    if (EPISTEMIC_LADDER[dominant].rank < EPISTEMIC_LADDER.strong_evidence.rank) {
      dominant = 'strong_evidence'
    }
    reasons.push('tool_evidence_moderate')
  } else if (ctx.toolEvidence === 'weak') {
    reasons.push('tool_evidence_weak')
  } else {
    reasons.push('no_tool_evidence')
  }

  // High-stakes / volatile without fresh sources → lower ceiling
  if (flags.includes('high_stakes_domain')) {
    ceiling = minStatus(ceiling, 'reasonable_inference')
    if (ctx.toolEvidence === 'none' || ctx.toolEvidence === 'weak') {
      ceiling = minStatus(ceiling, 'speculation')
      dominant = 'speculation'
      reasons.push('high_stakes_without_strong_evidence')
    } else {
      reasons.push('high_stakes_caution')
    }
  }

  if (flags.includes('volatile_domain') && (ctx.toolEvidence === 'none' || ctx.toolEvidence === 'weak')) {
    ceiling = minStatus(ceiling, 'speculation')
    dominant = minStatus(dominant, 'speculation')
    reasons.push('volatile_without_fresh_data')
  }

  if (flags.includes('no_fresh_sources')) {
    ceiling = minStatus(ceiling, 'speculation')
    reasons.push('missing_fresh_sources')
  }

  // Dominant never exceeds ceiling
  if (EPISTEMIC_LADDER[dominant].rank > EPISTEMIC_LADDER[ceiling].rank) {
    dominant = ceiling
  }

  return { ceiling, dominant, reasons }
}

/**
 * @param {EpistemicStatus} ceiling
 * @param {EpistemicStatus} dominant
 * @returns {ClaimBand[]}
 */
function buildClaimBands(ceiling, dominant) {
  const allowed = statusesAtOrBelow(ceiling)
  /** @type {ClaimBand[]} */
  const bands = []

  for (const status of allowed) {
    let weight = 0.12
    if (status === dominant) weight = 0.45
    else if (status === ceiling) weight = 0.25
    else if (status === 'reasonable_inference') weight = 0.2
    else if (status === 'speculation' && ceiling === 'speculation') weight = 0.35

    bands.push({
      status,
      weight: Math.round(weight * 100) / 100,
      guidance: EPISTEMIC_LADDER[status].frame,
    })
  }

  // Normalize weights
  const sum = bands.reduce((a, b) => a + b.weight, 0) || 1
  return bands.map((b) => ({
    ...b,
    weight: Math.round((b.weight / sum) * 100) / 100,
  }))
}

/**
 * @param {IntellectualHonestyPlan} plan
 */
function buildBrief(plan) {
  if (!plan.active) {
    return 'Intellectual Honesty: silenzio sociale — nessun claim fattuale richiesto.'
  }

  const ladder = STATUS_ORDER.map(
    (s) =>
      `${EPISTEMIC_LADDER[s].rank}. ${EPISTEMIC_LADDER[s].labelIt}${
        s === plan.ceiling ? ' ← ceiling' : ''
      }${s === plan.dominantStance ? ' ← dominante' : ''}`,
  ).join(' · ')

  const risks =
    plan.riskFlags.length > 0 ? `Rischi: ${plan.riskFlags.join(', ')}.` : 'Rischi: nessuno rilevante.'

  const frames = plan.framingHints.slice(0, 4).join(' ')

  return [
    `Intellectual Honesty: ceiling=${plan.ceiling} · stance=${plan.dominantStance} · toolEvidence=${plan.toolEvidence}.`,
    `Scala: ${ladder}.`,
    risks,
    'Prima di ogni affermazione: classifica (fatto / evidenza forte / inferenza / speculazione / opinione) e allinea il tono.',
    'Mai presentare speculazione come fatto. Incertezza trasparente. Confidenza = evidenza.',
    frames,
  ].join(' ')
}

/**
 * @param {object} [input]
 * @returns {IntellectualHonestyPlan}
 */
export function analyzeIntellectualHonesty(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const intent = input.planHints?.primaryIntent || input.understanding?.primaryIntent || ''
  const keepFast = Boolean(input.planHints?.keepFast)
  const toolEvidence = assessToolEvidence(input.toolResults)

  if (!userMessage || GREETING_ONLY.test(userMessage) || (STOP_OR_SOCIAL.test(userMessage) && userMessage.length < 24)) {
    return {
      active: false,
      ceiling: 'opinion',
      dominantStance: 'opinion',
      claimBands: [],
      toolEvidence,
      riskFlags: ['social_or_minimal'],
      confidence: 'high',
      writerBrief: 'Intellectual Honesty: silenzio sociale — nessun claim fattuale richiesto.',
      framingHints: [],
      reasons: ['skip_social'],
    }
  }

  const riskFlags = detectRiskFlags({
    userMessage,
    toolEvidence,
    keepFast,
  })

  const { ceiling, dominant, reasons } = chooseCeiling({
    userMessage,
    intent,
    riskFlags,
    toolEvidence,
    keepFast,
  })

  const claimBands = buildClaimBands(ceiling, dominant)
  const framingHints = statusesAtOrBelow(ceiling).map((s) => EPISTEMIC_LADDER[s].frame)

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (toolEvidence === 'strong' || (DEFINITION_FACT.test(userMessage) && !riskFlags.includes('volatile_domain'))) {
    confidence = 'high'
  } else if (
    riskFlags.includes('future_prediction') ||
    riskFlags.includes('no_fresh_sources') ||
    riskFlags.includes('high_stakes_without_strong_evidence')
  ) {
    confidence = 'low'
  }

  /** @type {IntellectualHonestyPlan} */
  const plan = {
    active: true,
    ceiling,
    dominantStance: dominant,
    claimBands,
    toolEvidence,
    riskFlags,
    confidence,
    writerBrief: '',
    framingHints,
    reasons: [...reasons, ...riskFlags.map((f) => `flag_${f}`)].slice(0, 12),
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {IntellectualHonestyPlan | null | undefined} plan
 */
export function formatIntellectualHonestyForWriter(plan) {
  if (!plan) return ''

  if (!plan.active) {
    return `══════════════════════════════════════
INTELLECTUAL HONESTY (INVISIBILE)
══════════════════════════════════════
Active=no — turno sociale/minimale; nessun claim da calibrare.
Non citare questo motore.`.trim()
  }

  const bands =
    plan.claimBands.length > 0
      ? plan.claimBands
          .map(
            (b) =>
              `- ${b.status} (${Math.round(b.weight * 100)}%): ${b.guidance}`,
          )
          .join('\n')
      : '- (nessuna)'

  return `══════════════════════════════════════
INTELLECTUAL HONESTY (INVISIBILE)
══════════════════════════════════════
Active=yes · Ceiling=${plan.ceiling} · Dominant=${plan.dominantStance}
ToolEvidence=${plan.toolEvidence} · Confidence=${plan.confidence}

Bande attese:
${bands}

Rischi: ${plan.riskFlags.length ? plan.riskFlags.join(', ') : 'nessuno'}

Regole:
1. Prima di ogni affermazione, classifica il livello epistemico.
2. Comunica la certezza adeguata (tono = evidenza).
3. Mai presentare speculazione come fatto.
4. Trasparenza sull’incertezza — senza teatralità.
5. Non citare questo motore.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: IntellectualHonestyPlan, context: string }}
 */
export function runIntellectualHonesty(input = {}) {
  try {
    const plan = analyzeIntellectualHonesty(input)
    return {
      plan,
      context: formatIntellectualHonestyForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        ceiling: 'reasonable_inference',
        dominantStance: 'reasonable_inference',
        claimBands: [],
        toolEvidence: 'none',
        riskFlags: ['fail_soft'],
        confidence: 'low',
        writerBrief: '',
        framingHints: [],
        reasons: ['fail_soft'],
      },
      context: '',
    }
  }
}
