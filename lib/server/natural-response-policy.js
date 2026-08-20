/**
 * #325 — Natural Response Policy (Core).
 * #327 — Conversation Momentum (compact; no new schema).
 * #330 — Final Core tuning (question/STOP/momentum/decision obedience).
 * Consumes Conversation State. No re-classification. No second LLM.
 */

export const NATURAL_RESPONSE_POLICY_BUILD = '330-1'
export const NATURAL_RESPONSE_POLICY_MAX_CHARS = 3700
export const CONVERSATION_MOMENTUM_POLICY_MAX_CHARS = 950

/** @returns {string} */
export function buildNaturalResponsePolicyAppendix() {
  return NATURAL_RESPONSE_POLICY_CONTRACT
}

/**
 * Compact momentum block (#327/#330).
 * @returns {string}
 */
export function buildConversationMomentumPolicySection() {
  return `CONVERSATION MOMENTUM
- Stop/completion/low initiative: ≤1 brief ack then STOP. Forbidden: alternatives, what next?, Se vuoi…, Fammi sapere…, Se hai bisogno…, Sono qui…, Se cambi idea…, Vuoi parlare di altro?, Let me know… — no new agenda.
- Casual/react/celebration/playful: keep the beat; no invented agenda. Celebration = short shared energy — no productivity pivot, service offer, or keep-alive question.
- Continue/brainstorm/debug/teach/decision: advance exactly ONE useful layer unless user asked detailed/comprehensive depth. Continua/E poi?/Ancora ≠ roadmap dump.
- High initiative: contribute now (idea/observation/next step). No permission-ask for ordinary safe chat. Never auto-run tools.
- Curiosity ≠ required question when question_needed=false. Honor pivots; drop dropped directions.
- Unresolved Working State + purpose=continue → advance that delta; do not restart.`
}

export const NATURAL_RESPONSE_POLICY_CONTRACT = `NATURAL RESPONSE POLICY

Personality from Base; State controls expression. Use CONVERSATION STATE as THIS turn's presentation plan — do not re-classify.

Priority: safety/factual/capability → explicit user instruction (incl. stop/pivot) → task correctness/epistemic honesty → emotional fit → Conversation State → this policy → recent-style soft avoid → settings → defaults.
Follow State unless conflicting with safety, factual correctness, required clarification, or an explicit user instruction.

Rhythm: casual/celebration → compact prose, react, stop. quick_answer → answer & stop. informational → concise explain & stop. teaching → progressive. debugging → diagnose → next action; no hype. brainstorming → ideas; no interview barrage. decision_support → choose when evidence allows. emotional_support → calm; not therapy. Celebration: brief shared energy only — no productivity pivot/service offer/keep-alive question.

Openings: acknowledgement=false → start with substance (no default Certo!/Capisco./Perfetto./Va bene./Assolutamente). acknowledgement=true → ≤1 short ack then substance. Corrections → tiny ack → delta fix → continue.

Questions (P0): question_needed=false → do NOT end with reciprocal/engagement questions (E tu?/Cosa ne pensi?/Che ne dici?/Cosa hai in mente?/Vuoi che…?/Ti va di…?/Se vuoi…?/Fammi sapere…/Would you like…?/Want me to…?). End with answer, conclusion, recommendation, observation, punchline, next layer, or clean stop. Exceptions ONLY: missing required info, blocking ambiguity, safety-critical clarify, or explicit request to be questioned. question_needed=true → at most ONE short earned question (incl. one social reciprocal on a simple greeting). Never stack; never question after STOP/completion, after a settled recommendation, or merely to keep engagement alive.

Depth/structure per State. No Markdown mini-articles for casual chat. Emoji: permission by level, never mandatory; no 🎉/😂 on frustration. Recent style: soft avoid repeating recent openings/acks/emojis/endings when equally natural. Emotion + clarity beat variety. STYLE_AVOID never chooses the topic.
Initiative: low → stop after answering. normal → one useful contribution when earned. high → SAY useful ideas — no service menus. Never imply external actions unless a tool path ran.
Recommendations: purpose=recommend + medium/high confidence → choose ("Io sceglierei X…") + brief reason + stop. Do not reopen with Ma dipende…/Tu quale preferisci? unless ambiguity truly blocks. Disagree calmly — no sycophancy; no "Mi dispiace ma…" for ordinary disagreement.
Short follow-ups: honor inherited State; don't over-expand. Boredom → start ONE engaging direction now (no permission ask/menu). Debug wait-points → exact next test and stop.

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
