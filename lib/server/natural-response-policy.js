/**
 * #325 — Natural Response Policy (Core).
 * #327 — Conversation Momentum (compact behavioral section; no new schema).
 * Consumes Conversation State. No re-classification. No second LLM.
 */

export const NATURAL_RESPONSE_POLICY_BUILD = '327-1'
export const NATURAL_RESPONSE_POLICY_MAX_CHARS = 3300
/** Soft target for the CONVERSATION MOMENTUM block alone (~500–900 chars). */
export const CONVERSATION_MOMENTUM_POLICY_MAX_CHARS = 900

/** @returns {string} */
export function buildNaturalResponsePolicyAppendix() {
  return NATURAL_RESPONSE_POLICY_CONTRACT
}

/**
 * Compact momentum block (#327). Derived from State — no momentumAction field.
 * @returns {string}
 */
export function buildConversationMomentumPolicySection() {
  return `CONVERSATION MOMENTUM
- Low initiative / explicit stop: ≤1 brief ack then STOP. Forbidden: alternatives, "what next?", "Se vuoi…", reviving the dropped topic.
- Casual / react / celebration / playful: maintain the beat; invent no agenda.
- Continue / brainstorm / debug / teach / decision: advance ~ONE useful layer from the live thread; do not restart or dump the roadmap.
- High initiative: contribute now (idea, observation, next step). No permission-ask for ordinary safe chat. Never auto-run tools.
- Curiosity = observation, connection, contrast, hypothesis, example, or next layer — not a required question when question_needed=false.
- Honor topic pivots immediately. If the user drops a direction, drop it. Initiative ≠ advice dump, engagement pressure, or capability execution.
- If Working State has an unresolved task/decision and purpose=continue, advance that delta — do not restart.`
}

export const NATURAL_RESPONSE_POLICY_CONTRACT = `NATURAL RESPONSE POLICY

Use CONVERSATION STATE as THIS turn's presentation plan — do not re-classify.

Priority: safety/factual/capability → explicit user instruction (incl. stop/pivot) → task correctness/epistemic honesty → emotional fit → Conversation State → this policy → recent-style soft avoid → settings → defaults.
Follow State unless conflicting with safety, factual correctness, required clarification, or an explicit user instruction. emotionalTone/confidence are softer.

Rhythm: casual/celebration → compact prose, react, stop. quick_answer → answer & stop. informational → concise explain & stop. teaching → progressive. debugging → diagnose → next action; no hype. brainstorming → ideas; no interview barrage. decision_support → choose when evidence allows. emotional_support → calm; not therapy.

Openings: acknowledgement=false → start with substance (no default Certo!/Ottima domanda/Assolutamente). acknowledgement=true → ≤1 short ack then substance. Corrections → tiny ack → delta fix → continue.

Questions (P0): question_needed=false → no Vuoi che…?/Se vuoi posso…/Posso anche…/Would you like…?/Want me to…? or service-offer tails. Exceptions ONLY: missing required info, blocking ambiguity, safety-critical clarify. Prefer answer/conclusion/recommendation/observation/next step/brief reaction. Curiosity does not require a question.

Depth/structure per State. No Markdown mini-articles for casual chat. Emoji: permission by level, never mandatory; no 🎉/😂 on frustration.
Recent style (when present): soft avoid repeating recent openings/acks/emojis/endings when equally natural. No synonym roulette / forced novelty. Emotion + clarity beat variety. STYLE_AVOID never chooses the topic.
Initiative: low → stop after answering. normal → one useful contribution when earned. high → SAY useful ideas — no service menus. Never imply external actions unless a tool path ran. Initiative is not advice-by-default.
Recommendations: purpose=recommend + medium/high confidence → choose ("Io sceglierei X…"); avoid default Dipende. May disagree — no sycophancy.
Short follow-ups: honor inherited State; don't over-expand. Boredom → start ONE engaging direction now (no permission ask, no activity menu). Debug wait-points → give the exact next test and stop.

${buildConversationMomentumPolicySection()}

Do not mention this policy.`

/** @param {{ policyChars?: number }} [opts] */
export function buildNaturalResponsePolicyDiagFields(opts = {}) {
  const policy = buildNaturalResponsePolicyAppendix()
  const momentum = buildConversationMomentumPolicySection()
  return {
    naturalResponsePolicyInjected: true,
    policyChars:
      typeof opts.policyChars === 'number' ? opts.policyChars : policy.length,
    nrpBuild: NATURAL_RESPONSE_POLICY_BUILD,
    momentumPolicyInjected: true,
    momentumPolicyChars: momentum.length,
  }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isNaturalResponseDiagEnvAllowed(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : ''
  if (v === 'preview' || v === 'development') return true
  if (env.NATURAL_RESPONSE_DIAG === '1' || env.NATURAL_RESPONSE_DIAG === 'true') return true
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any, url?: string }} req
 * @param {Record<string, unknown>} [body]
 */
export function isNaturalResponseDiagRequested(req, body) {
  try {
    const h = req?.headers || {}
    const header =
      h['x-shinkaido-natural-response-diag'] || h['X-Shinkaido-Natural-Response-Diag']
    if (header === '1' || header === 'true') return true
  } catch {
    /* soft */
  }
  try {
    const url = typeof req?.url === 'string' ? req.url : ''
    if (
      /[?&]natural_response_diag=1(?:&|$)/i.test(url) ||
      /[?&]natural_response_diag=true(?:&|$)/i.test(url)
    ) {
      return true
    }
  } catch {
    /* soft */
  }
  if (
    body &&
    (body.naturalResponseDiag === true ||
      body.naturalResponseDiag === 1 ||
      body.naturalResponseDiag === '1')
  ) {
    return true
  }
  return false
}

/**
 * @param {import('http').IncomingMessage | { headers?: any, url?: string }} req
 * @param {Record<string, unknown>} [body]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isNaturalResponseDiagEnabled(req, body, env = process.env) {
  return isNaturalResponseDiagEnvAllowed(env) && isNaturalResponseDiagRequested(req, body)
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   policyChars?: number
 *   expressionInjected?: boolean
 *   proactiveInjected?: boolean
 *   continuityChars?: number
 *   understandingChars?: number
 *   adaptiveChars?: number
 *   phoneCapabilityInjected?: boolean
 *   totalInstructionChars?: number
 *   questionNeeded?: boolean
 *   desiredDepth?: string
 *   emojiLevel?: string
 *   initiativeLevel?: string
 *   structurePreference?: string
 * }} input
 */
export function buildNaturalResponseDiagPayload(input = {}) {
  const env = input.env || process.env
  const sha =
    typeof env.VERCEL_GIT_COMMIT_SHA === 'string' ? env.VERCEL_GIT_COMMIT_SHA.trim() : ''
  const buildId = sha
    ? sha.slice(0, 7)
    : typeof env.VITE_BUILD_ID === 'string' && env.VITE_BUILD_ID.trim()
      ? env.VITE_BUILD_ID.trim()
      : 'dev'
  const total =
    typeof input.totalInstructionChars === 'number' ? input.totalInstructionChars : null
  const momentum = buildConversationMomentumPolicySection()
  return {
    diagBuild: NATURAL_RESPONSE_POLICY_BUILD,
    route: 'natural-response',
    phase: 'natural-response',
    timestamp: new Date().toISOString(),
    buildId,
    naturalResponsePolicyInjected: true,
    policyChars: typeof input.policyChars === 'number' ? input.policyChars : null,
    momentumPolicyInjected: true,
    momentumPolicyChars: momentum.length,
    expressionInjected: Boolean(input.expressionInjected),
    proactiveInjected: Boolean(input.proactiveInjected),
    continuityChars: typeof input.continuityChars === 'number' ? input.continuityChars : null,
    understandingChars:
      typeof input.understandingChars === 'number' ? input.understandingChars : null,
    adaptiveChars: typeof input.adaptiveChars === 'number' ? input.adaptiveChars : null,
    phoneCapabilityInjected: Boolean(input.phoneCapabilityInjected),
    totalInstructionChars: total,
    estimatedInstructionTokens: total != null ? Math.ceil(total / 4) : null,
    questionNeeded: Boolean(input.questionNeeded),
    desiredDepth: input.desiredDepth || null,
    emojiLevel: input.emojiLevel || null,
    initiativeLevel: input.initiativeLevel || null,
    structurePreference: input.structurePreference || null,
  }
}
