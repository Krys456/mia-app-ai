/**
 * V1 Observability collector — side-channel telemetry only.
 *
 * MUST NOT:
 *   - mutate messages, instructions, cognitive results, or refine inputs
 *   - call V2 pipeline modules
 *   - feed debug data back into generation
 *
 * Fail-soft: any error returns null / partial sections.
 */

export const V1_OBSERVABILITY_VERSION = '1.0.0-v1-observability'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * Deep-clone via JSON; strip non-JSON and secrets. Never throws.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function sanitizeForDebug(value, depth = 0) {
  if (depth > 8) return '[truncated]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (looksLikeSecret(value)) return '[redacted]'
    if (value.length > 4000) return `${value.slice(0, 4000)}…[truncated]`
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeForDebug(item, depth + 1))
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, raw] of Object.entries(value)) {
      if (isSecretKey(key)) {
        out[key] = '[redacted]'
        continue
      }
      // Never dump full mega-prompts / cognitive context blobs into the UI.
      if (isOversizedPromptKey(key) && typeof raw === 'string' && raw.length > 500) {
        out[key] = {
          omitted: true,
          reason: 'prompt_or_context_too_large',
          length: raw.length,
        }
        continue
      }
      try {
        out[key] = sanitizeForDebug(raw, depth + 1)
      } catch {
        out[key] = '[unserializable]'
      }
    }
    return out
  }
  return asString(value)
}

/**
 * @param {string} key
 */
function isSecretKey(key) {
  return /api[_-]?key|secret|password|token|authorization|bearer|credential|private[_-]?key/i.test(
    key,
  )
}

/**
 * @param {string} value
 */
function looksLikeSecret(value) {
  if (/sk-[a-zA-Z0-9]{10,}/.test(value)) return true
  if (/Bearer\s+[A-Za-z0-9._\-]+/i.test(value)) return true
  return false
}

/**
 * @param {string} key
 */
function isOversizedPromptKey(key) {
  return /^(context|systemPrompt|instructions|writerBlock|.*Context|prompt|constitution)$/i.test(
    key,
  )
}

/**
 * Summarize companion refine briefs into compact gate labels (observational).
 * @param {string[]} briefs
 * @returns {string[]}
 */
export function summarizeGateBriefs(briefs) {
  if (!Array.isArray(briefs)) return []
  return briefs
    .map((b) => {
      const text = asString(b).trim()
      if (!text) return null
      const first = text.split(/[.\n]/)[0] || text
      return first.slice(0, 160)
    })
    .filter(Boolean)
    .slice(0, 40)
}

/**
 * Build V1 debug payload from already-computed execution snapshots.
 * Pure. Does not call OpenAI or V2. Does not mutate inputs.
 *
 * @param {{
 *   enabled?: boolean,
 *   cognitiveResult?: object|null,
 *   writerDirectives?: object|null,
 *   model?: string,
 *   provider?: string,
 *   draftPassed?: boolean,
 *   refineRequested?: boolean,
 *   refineApplied?: boolean,
 *   outputSource?: 'draft'|'refined',
 *   companionBriefs?: string[],
 *   memoryEnabled?: boolean,
 *   memoryEvent?: 'saved'|'updated'|null,
 *   conversationId?: string|null,
 *   learningSignals?: object|null,
 *   conversationMemoryMap?: object|null,
 *   conversationPreferenceProfile?: object|null,
 *   pendingAutomation?: object|null,
 *   timing?: object|null,
 *   gateApplicability?: object|null,
 *   authorityResolution?: object|null,
 *   errors?: string[],
 * }} input
 */
/**
 * Fail-soft section builder — never throws outward.
 * @param {string} name
 * @param {() => unknown} fn
 * @param {string[]} errors
 */
function safeSection(name, fn, errors) {
  try {
    return fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[v1-observability] section ${name} failed`, error)
    errors.push(`${name}: ${message}`)
    return null
  }
}

export function buildV1ObservabilityDebug(input = {}) {
  try {
    if (input.enabled === false) return null

    /** @type {string[]} */
    const errors = Array.isArray(input.errors) ? [...input.errors] : []

    const cognitive = input.cognitiveResult && typeof input.cognitiveResult === 'object'
      ? input.cognitiveResult
      : null
    const plan = cognitive?.plan && typeof cognitive.plan === 'object' ? cognitive.plan : null
    const understanding = plan?.understanding || null
    const languageAwareness = cognitive?.languageAwareness || null
    const responseMode = cognitive?.responseMode || null
    const coordination = cognitive?.coordination || plan?.coordination || null
    const conversationPlanner = cognitive?.conversationPlanner || null
    const continuation = cognitive?.continuation || null
    const directives =
      (input.writerDirectives && typeof input.writerDirectives === 'object'
        ? input.writerDirectives
        : null) ||
      cognitive?.writerDirectives ||
      plan?.writerDirectives ||
      null

    const companionBriefs = Array.isArray(input.companionBriefs) ? input.companionBriefs : []
    const gatesFired = summarizeGateBriefs(companionBriefs)
    const refineRequested = Boolean(input.refineRequested)
    const refineApplied = Boolean(input.refineApplied)
    const outputSource = input.outputSource === 'refined' ? 'refined' : 'draft'

    const memoryRetrieved = Boolean(plan?.memoryRetrieved)
    const memoryEnabled = input.memoryEnabled !== false

    const debug = {
      engine: 'v1',
      version: V1_OBSERVABILITY_VERSION,
      note: 'Observational only — does not influence V1 generation.',
      perception: safeSection(
        'perception',
        () =>
          sanitizeForDebug({
            source: 'v1.cognitive-engine.understanding + languageAwareness',
            language:
              languageAwareness?.conversationLanguage ||
              languageAwareness?.dominantLanguage ||
              understanding?.language ||
              null,
            languageSticky: languageAwareness?.sticky ?? null,
            languageSwitch:
              languageAwareness?.switchDetected ?? languageAwareness?.switched ?? null,
            primaryIntent: understanding?.primaryIntent || null,
            emotionalTone: understanding?.emotionalTone || null,
            urgency: understanding?.urgency || null,
            realGoal: understanding?.realGoal || plan?.realGoal || null,
            ambiguities: understanding?.ambiguities || plan?.ambiguities || null,
            knowledgeLevel: cognitive?.knowledgeLevel || cognitive?.knowledge?.level || null,
            socialConversation: summarizeActivePlan(cognitive?.socialConversation),
            socialContext: summarizeActivePlan(cognitive?.socialContext),
            conversationIntent: summarizeActivePlan(cognitive?.conversationIntent),
          }),
        errors,
      ),
      mind: safeSection(
        'mind',
        () =>
          sanitizeForDebug({
            source: 'v1.cognitive-coordinator + directive-authority + leadership',
            coordination: summarizeCoordination(coordination),
            writerDirectives: summarizeDirectives(directives),
            leadership: summarizeActivePlan(cognitive?.conversationLeadership),
            director: summarizeActivePlan(cognitive?.conversationDirector),
            intellectualInitiative: summarizeActivePlan(cognitive?.intellectualInitiative),
            topicLeadership: summarizeActivePlan(cognitive?.topicLeadership),
            warmConversationActive: Boolean(cognitive?.warmConversation?.active),
            questionEconomyActive: Boolean(cognitive?.questionEconomy?.active),
          }),
        errors,
      ),
      planner: safeSection(
        'planner',
        () =>
          sanitizeForDebug({
            source: 'v1.conversation-planner-engine + response-mode-engine + writerDirectives',
            conversationPlanner: summarizeConversationPlanner(conversationPlanner),
            responseMode: summarizeResponseMode(responseMode),
            continuation: summarizeActivePlan(continuation),
            askQuestion: directives?.askQuestion ?? null,
            leadConversation: directives?.leadConversation ?? null,
            mode: directives?.mode ?? null,
            social: directives?.social ?? null,
            language: directives?.language ?? null,
            initiative: directives?.initiative ?? conversationPlanner?.plan?.initiative ?? null,
          }),
        errors,
      ),
      writer: safeSection(
        'writer',
        () =>
          sanitizeForDebug({
            source: 'v1.api/chat OpenAI Responses path + post-gates',
            provider: input.provider || 'openai',
            model: input.model || null,
            responseMode:
              responseMode?.mode ||
              responseMode?.selected ||
              conversationPlanner?.plan?.responseMode ||
              null,
            writerDirectives: summarizeDirectives(directives),
            draftPassedGates: !refineRequested && gatesFired.length === 0,
            gatesFired,
            gateCount: gatesFired.length,
            refineRequested,
            refineApplied,
            outputSource,
            // Explicitly omit full system prompt / instructions
            systemPromptIncluded: false,
          }),
        errors,
      ),
      memory: safeSection(
        'memory',
        () =>
          sanitizeForDebug({
            source: 'v1.orchestrator memory tool + brain-memory pipeline',
            enabled: memoryEnabled,
            retrievalAttempted: memoryRetrieved,
            retrieved: memoryRetrieved,
            used: memoryRetrieved,
            postEvent: input.memoryEvent ?? null,
            skipped: !memoryEnabled
              ? 'memory_disabled'
              : input.memoryEvent == null
                ? 'no_save'
                : null,
          }),
        errors,
      ),
      state: safeSection(
        'state',
        () =>
          sanitizeForDebug({
            source: 'v1.request echoes + cognitive session artifacts (not V2 Conversation State)',
            conversationId: input.conversationId || null,
            conversationMemoryMap: summarizeMap(
              input.conversationMemoryMap || cognitive?.conversationMemoryMap,
            ),
            preferenceProfile: summarizeProfile(
              input.conversationPreferenceProfile || cognitive?.conversationPreferenceProfile,
            ),
            learningSignals: summarizeLearningSignals(
              input.learningSignals || cognitive?.learningSignals,
            ),
            pendingAutomation:
              input.pendingAutomation === undefined
                ? undefined
                : input.pendingAutomation
                  ? { present: true, keys: Object.keys(input.pendingAutomation).slice(0, 12) }
                  : null,
          }),
        errors,
      ),
      timing: safeSection(
        'timing',
        () =>
          sanitizeForDebug({
            source: 'v1.api/chat wall-clock marks',
            ...(input.timing && typeof input.timing === 'object' ? input.timing : {}),
          }),
        errors,
      ),
      authorityResolution: safeSection(
        'authorityResolution',
        () =>
          sanitizeForDebug(
            input.authorityResolution ||
              input.writerDirectives?.authorityResolution ||
              {
                plannerInitiative: conversationPlanner?.plan?.initiative ?? null,
                finalInitiative: directives?.initiative ?? null,
                plannerAskQuestion: null,
                finalAskQuestion: directives?.askQuestion ?? null,
                overridesApplied: [],
              },
          ),
        errors,
      ),
      gateApplicability: safeSection(
        'gateApplicability',
        () =>
          sanitizeForDebug(
            input.gateApplicability || {
              skipped: [],
              active: [],
              note: 'not_collected',
            },
          ),
        errors,
      ),
      ...(errors.length ? { collectionErrors: errors.slice(0, 10) } : {}),
    }

    // Final secret sweep on serialized form
    const json = JSON.stringify(debug)
    if (/sk-[a-zA-Z0-9]{10,}/.test(json) || /OPENAI_API_KEY/i.test(json)) {
      console.error('[v1-observability] secret pattern detected — dropping debug payload')
      return {
        engine: 'v1',
        version: V1_OBSERVABILITY_VERSION,
        error: 'debug_redacted_secret_pattern',
      }
    }

    return debug
  } catch (error) {
    console.error('[v1-observability] build failed', error)
    return {
      engine: 'v1',
      version: V1_OBSERVABILITY_VERSION,
      error: 'debug_collection_failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * @param {unknown} plan
 */
function summarizeActivePlan(plan) {
  if (!plan || typeof plan !== 'object') return null
  const p = /** @type {Record<string, unknown>} */ (plan)
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of [
    'active',
    'mode',
    'selected',
    'strategy',
    'move',
    'ownership',
    'initiative',
    'shouldAsk',
    'askQuestion',
    'lead',
    'forceSkipUserQuestion',
    'confidence',
    'category',
    'confidence',
    'shouldSpark',
    'isSmallTalk',
  ]) {
    if (p[key] !== undefined) out[key] = p[key]
  }
  return Object.keys(out).length ? out : { present: true }
}

/**
 * @param {unknown} coordination
 */
function summarizeCoordination(coordination) {
  if (!coordination || typeof coordination !== 'object') return null
  const c = /** @type {Record<string, unknown>} */ (coordination)
  return {
    winners: c.winners || null,
    slots: c.slots || null,
    notes: c.notes || c.summary || null,
  }
}

/**
 * @param {unknown} directives
 */
function summarizeDirectives(directives) {
  if (!directives || typeof directives !== 'object') return null
  const d = /** @type {Record<string, unknown>} */ (directives)
  return {
    language: d.language ?? null,
    mode: d.mode ?? null,
    social: d.social ?? null,
    leadConversation: d.leadConversation ?? null,
    askQuestion: d.askQuestion ?? null,
    continueCurrentTopic: d.continueCurrentTopic ?? null,
    emotionalTone: d.emotionalTone ?? null,
    responseLength: d.responseLength ?? null,
    initiative: d.initiative ?? null,
  }
}

/**
 * @param {unknown} conversationPlanner
 */
function summarizeConversationPlanner(conversationPlanner) {
  if (!conversationPlanner || typeof conversationPlanner !== 'object') return null
  const cp = /** @type {Record<string, unknown>} */ (conversationPlanner)
  const plan = cp.plan && typeof cp.plan === 'object' ? /** @type {Record<string, unknown>} */ (cp.plan) : null
  return {
    active: cp.active ?? null,
    confidence: cp.confidence ?? null,
    plan: plan
      ? {
          goal: plan.goal ?? null,
          strategy: plan.strategy ?? null,
          emotion: plan.emotion ?? null,
          depth: plan.depth ?? null,
          topicAction: plan.topicAction ?? null,
          initiative: plan.initiative ?? null,
          responseMode: plan.responseMode ?? null,
        }
      : null,
  }
}

/**
 * @param {unknown} responseMode
 */
function summarizeResponseMode(responseMode) {
  if (!responseMode || typeof responseMode !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (responseMode)
  return {
    mode: r.mode || r.selected || r.responseMode || null,
    active: r.active ?? null,
    reason: r.reason || r.why || null,
  }
}

/**
 * @param {unknown} map
 */
function summarizeMap(map) {
  if (!map || typeof map !== 'object') return null
  const m = /** @type {Record<string, unknown>} */ (map)
  const keys = Object.keys(m)
  return {
    keyCount: keys.length,
    keys: keys.slice(0, 24),
    exploredTopics: Array.isArray(m.exploredTopics)
      ? m.exploredTopics.slice(0, 8)
      : m.topics
        ? sanitizeForDebug(m.topics)
        : undefined,
  }
}

/**
 * @param {unknown} profile
 */
function summarizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null
  const p = /** @type {Record<string, unknown>} */ (profile)
  return {
    keys: Object.keys(p).slice(0, 20),
    formality: p.formality ?? null,
    warmth: p.warmth ?? null,
    humor: p.humor ?? null,
    questionPreference: p.questionPreference ?? null,
  }
}

/**
 * @param {unknown} signals
 */
function summarizeLearningSignals(signals) {
  if (!signals || typeof signals !== 'object') return null
  const s = /** @type {Record<string, unknown>} */ (signals)
  return {
    turnCount: s.turnCount ?? null,
    workedWellCount: Array.isArray(s.workedWell) ? s.workedWell.length : 0,
    neededClarificationCount: Array.isArray(s.neededClarification)
      ? s.neededClarification.length
      : 0,
    apparentPreferencesCount: Array.isArray(s.apparentPreferences)
      ? s.apparentPreferences.length
      : 0,
    mistakesToAvoidCount: Array.isArray(s.mistakesToAvoid) ? s.mistakesToAvoid.length : 0,
    hasDirective: Boolean(asString(s.directive).trim()),
  }
}

/**
 * @param {unknown} body
 * @returns {boolean}
 */
export function shouldCollectV1Observability(body) {
  if (!body || typeof body !== 'object') return false
  const b = /** @type {Record<string, unknown>} */ (body)
  return b.observability === true || b.debug === true || b.includeV1Debug === true
}
