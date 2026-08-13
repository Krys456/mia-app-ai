/**
 * LAIfe V2 — Reference Resolution + Conversation Repair (Phase 7)
 *
 * Short-range conversational grounding only.
 * Produces structured referent candidates and repair facts.
 *
 * Does NOT:
 *   - decide Planner objective / conversationalMove
 *   - invent referents when evidence is weak
 *   - scan long-term Memory
 *   - run an LLM
 *
 * Pipeline: Perception → Signals → Reference Resolution → Conversation State → …
 */

export const REFERENCE_RESOLUTION_VERSION = '1.0.0-reference-resolution'

/**
 * @typedef {'resolved'|'ambiguous'|'unresolved'|'explicit'} ReferenceStatus
 */

/**
 * @typedef {'topic_entity'|'ordinal'|'alternate'|'previous'|'explicit_topic'|null} ReferentType
 */

/**
 * @typedef {'explicit_correction'|'alternate_referent'|'ordinal_correction'|'topic_correction'|'misunderstanding'|null} RepairType
 */

/**
 * @typedef {'high'|'medium'|'low'} ConfidenceBand
 */

/**
 * @typedef {object} RepairState
 * @property {boolean} active
 * @property {RepairType} type
 * @property {string|null} rejectedInterpretation
 * @property {string|null} correctedReferent
 * @property {number|null} confidence
 * @property {boolean} requiresClarification
 */

/**
 * @typedef {object} ReferenceRecord
 * @property {ReferenceStatus} status
 * @property {string|null} expression
 * @property {ReferentType} referentType
 * @property {string|null} referent
 * @property {number} confidence
 * @property {ConfidenceBand} confidenceBand
 * @property {number|null} sourceTurn
 */

/**
 * @typedef {object} ReferenceResolutionResult
 * @property {ReferenceStatus} status
 * @property {string|null} expression
 * @property {ReferentType} referentType
 * @property {string|null} referent
 * @property {number} confidence
 * @property {ConfidenceBand} confidenceBand
 * @property {number|null} sourceTurn
 * @property {string[]} recentAlternatives
 * @property {string[]} orderedOptions
 * @property {RepairState} repair
 * @property {{ resolved: ReferenceRecord[], unresolved: string[], ambiguous: ReferenceRecord[] }} references
 * @property {string[]} diagnostics
 * @property {string} version
 */

const DEMONSTRATIVE_RE =
  /\b(quello|quella|quelli|quelle|questo|questa|questi|queste|l['’]altro|l['’]altra|gli\s+altri|the\s+other\s+one|that\s+one|this\s+one|those|these)\b/i

const ORDINAL_RE =
  /\b(il\s+primo|il\s+secondo|il\s+terzo|la\s+prima|la\s+seconda|la\s+terza|the\s+first(\s+one)?|the\s+second(\s+one)?|the\s+third(\s+one)?)\b/i

const PREVIOUS_REF_RE =
  /\b(quello\s+di\s+prima|quella\s+di\s+prima|come\s+prima|quello\s+che\s+dicevi\s+prima|the\s+one\s+from\s+before|what\s+you\s+(said|mentioned)\s+earlier)\b/i

const EXPLICIT_TOPIC_CORRECTION_RE =
  /\b(?:no,?\s+)?(?:intendevo|parlavo\s+(?:di|dell['’]?|degli|delle)?|mi\s+riferivo\s+(?:a|all['’]?|allo|alla)|i\s+meant|i\s+was\s+(?:talking|referring)\s+to)\s+(.+?)(?:[.!?]|$)/i

const ALTERNATE_RE =
  /\b(l['’]altro|l['’]altra|the\s+other(\s+one)?|non\s+quello|not\s+that(\s+one)?)\b/i

const MISUNDERSTAND_RE =
  /\b(hai\s+capito\s+male|non\s+[eè]\s+quello|you\s+(got|have)\s+(it|that)\s+wrong|that'?s\s+not\s+(what|it))\b/i

const ORDERED_LINE_RE = /^\s*(?:\d+[.)]|[-*•])\s+(.+?)\s*$/gm

const ALT_PAIR_RE =
  /\b(?:oppure|o\s+invece|either|or(?:\s+else)?)\b/i

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
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, Math.round(x * 100) / 100))
}

/**
 * @param {number} confidence
 * @returns {ConfidenceBand}
 */
export function confidenceBand(confidence) {
  const c = clamp01(confidence)
  if (c >= 0.75) return 'high'
  if (c >= 0.5) return 'medium'
  return 'low'
}

/**
 * @param {unknown} messages
 * @returns {Array<{ role: string, content: string }>}
 */
function listMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.map((m) => ({
    role: asString(m?.role).toLowerCase(),
    content: asString(m?.content).trim(),
  }))
}

/**
 * Empty repair state.
 * @returns {RepairState}
 */
export function emptyRepairState() {
  return {
    active: false,
    type: null,
    rejectedInterpretation: null,
    correctedReferent: null,
    confidence: null,
    requiresClarification: false,
  }
}

/**
 * Empty resolution result.
 * @returns {ReferenceResolutionResult}
 */
export function emptyReferenceResolution() {
  return freezeReferenceResolution({
    status: 'unresolved',
    expression: null,
    referentType: null,
    referent: null,
    confidence: 0,
    confidenceBand: 'low',
    sourceTurn: null,
    recentAlternatives: [],
    orderedOptions: [],
    repair: emptyRepairState(),
    references: { resolved: [], unresolved: [], ambiguous: [] },
    diagnostics: [],
    version: REFERENCE_RESOLUTION_VERSION,
  })
}

/**
 * @param {ReferenceResolutionResult} result
 * @returns {ReferenceResolutionResult}
 */
export function freezeReferenceResolution(result) {
  if (!result || typeof result !== 'object') return emptyReferenceResolution()
  try {
    Object.freeze(result.repair)
    Object.freeze(result.references?.resolved)
    Object.freeze(result.references?.unresolved)
    Object.freeze(result.references?.ambiguous)
    Object.freeze(result.references)
    Object.freeze(result.recentAlternatives)
    Object.freeze(result.orderedOptions)
    Object.freeze(result.diagnostics)
    return Object.freeze(result)
  } catch {
    return result
  }
}

/**
 * Compact debug diagnostics (no candidate scoring traces).
 * @param {ReferenceResolutionResult|null|undefined} result
 * @returns {object|null}
 */
export function serializeReferenceResolutionDebug(result) {
  if (!result || typeof result !== 'object') return null
  return {
    status: result.status || 'unresolved',
    type: result.referentType || null,
    confidence: result.confidenceBand || confidenceBand(Number(result.confidence) || 0),
    repair: result.repair?.active
      ? { active: true, type: result.repair.type || null }
      : { active: false, type: null },
  }
}

/**
 * Extract ordered options from recent assistant text.
 * @param {string} text
 * @returns {string[]}
 */
export function extractOrderedOptions(text) {
  const t = asString(text)
  /** @type {string[]} */
  const options = []
  let m
  const re = new RegExp(ORDERED_LINE_RE.source, 'gm')
  while ((m = re.exec(t)) !== null) {
    const item = asString(m[1])
      .replace(/[.!?].*$/, '')
      .trim()
      .slice(0, 80)
    if (item && !options.includes(item.toLowerCase())) {
      options.push(item)
    }
  }
  // Inline "1) x 2) y"
  if (options.length < 2) {
    const inline = [...t.matchAll(/\b(\d+)[.)]\s*([^.;,\n]{2,60})/g)]
    for (const hit of inline) {
      const item = asString(hit[2]).trim().slice(0, 80)
      if (item && !options.map((o) => o.toLowerCase()).includes(item.toLowerCase())) {
        options.push(item)
      }
    }
  }
  return options.slice(0, 6)
}

/**
 * Extract contrasted alternatives from recent assistant text / prior state.
 * @param {string} text
 * @param {string[]} [prior]
 * @returns {string[]}
 */
export function extractRecentAlternatives(text, prior = []) {
  const t = asString(text)
  /** @type {string[]} */
  const alts = []
  const FILLER_LEAD =
    /^(puoi|può|pui|usa|usare|scegli|scegliere|trai|tra|between|either|consider|considerare|hai|hai\s+due|due)\s+/i
  const push = (s) => {
    let v = asString(s).replace(/[.!?].*$/, '').trim().slice(0, 60)
    if (!v) return
    // Drop leading verbs / filler (repeat until stable).
    for (let i = 0; i < 4; i += 1) {
      const next = v.replace(FILLER_LEAD, '').trim()
      if (next === v) break
      v = next
    }
    // Keep short entity-like phrases only (1–3 tokens).
    if (!v || v.split(/\s+/).length > 3) return
    if (!alts.map((a) => a.toLowerCase()).includes(v.toLowerCase())) alts.push(v)
  }

  for (const p of prior || []) push(p)

  // Single-token / short-phrase pairs: "monofase oppure trifase"
  // Limit to at most one optional second word (e.g. "trifase bifase").
  const TOKEN = String.raw`[A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{1,39}(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{1,24})?`
  const pair = t.match(
    new RegExp(`\\b(${TOKEN})\\s+(?:oppure|o\\s+invece|or(?:\\s+else)?)\\s+(${TOKEN})\\b`, 'i'),
  )
  if (pair) {
    push(pair[1])
    push(pair[2])
  }

  // "usa X oppure Y" / "tra X e Y"
  const usePair = t.match(
    new RegExp(
      `\\b(?:usa|usare|scegli|scegliere|tra|between)\\s+(${TOKEN})\\s+(?:e|ed|and|oppure|or)\\s+(${TOKEN})\\b`,
      'i',
    ),
  )
  if (usePair) {
    push(usePair[1])
    push(usePair[2])
  }

  const ordered = extractOrderedOptions(t)
  for (const o of ordered) push(o)

  return alts.slice(0, 6)
}

/**
 * Map ordinal phrase → 0-based index.
 * @param {string} text
 * @returns {number} -1 if none
 */
export function ordinalIndex(text) {
  const t = asString(text).toLowerCase()
  if (/\b(il\s+primo|la\s+prima|the\s+first)\b/.test(t)) return 0
  if (/\b(il\s+secondo|la\s+seconda|the\s+second)\b/.test(t)) return 1
  if (/\b(il\s+terzo|la\s+terza|the\s+third)\b/.test(t)) return 2
  return -1
}

/**
 * Strip correction lead-in to get explicit topic candidate.
 * @param {string} userText
 * @returns {string|null}
 */
export function extractExplicitCorrectedTopic(userText) {
  const t = asString(userText).replace(/\s+/g, ' ').trim()
  const m = t.match(EXPLICIT_TOPIC_CORRECTION_RE)
  if (!m || !m[1]) return null
  let topic = asString(m[1])
    .replace(/^(il|lo|la|l['’]|i|gli|le|un|una|the|a|an)\s+/i, '')
    .replace(/^dell['’]\s*/i, '')
    .replace(/[.!?].*$/, '')
    .trim()
  // Drop trailing filler
  topic = topic.replace(/\b(per[oò]|invece|okay|ok)\b.*$/i, '').trim()
  if (topic.length < 2 || topic.length > 80) return null
  // "intendevo l'altro" is an alternate cue, not a named topic.
  if (ALTERNATE_RE.test(topic) || /^(l['’]altro|l['’]altra|the other(?:\s+one)?)$/i.test(topic)) {
    return null
  }
  // Reject pure demonstratives
  if (DEMONSTRATIVE_RE.test(topic) && topic.split(/\s+/).length <= 2) return null
  return topic
}

/**
 * Build a ReferenceRecord.
 * @param {Partial<ReferenceRecord>} partial
 * @returns {ReferenceRecord}
 */
function record(partial) {
  const confidence = clamp01(partial.confidence ?? 0)
  return {
    status: /** @type {ReferenceStatus} */ (partial.status || 'unresolved'),
    expression: partial.expression ?? null,
    referentType: partial.referentType ?? null,
    referent: partial.referent ?? null,
    confidence,
    confidenceBand: confidenceBand(confidence),
    sourceTurn: typeof partial.sourceTurn === 'number' ? partial.sourceTurn : null,
  }
}

/**
 * Resolve short-range conversational references.
 *
 * @param {{
 *   userMessage?: string,
 *   messages?: Array<{ role?: string, content?: string }>,
 *   conversationSignals?: object|null,
 *   previousConversationState?: object|null,
 *   perception?: object|null,
 *   freeze?: boolean,
 * }} [input]
 * @returns {ReferenceResolutionResult}
 */
export function resolveReferences(input = {}) {
  const userText = asString(input.userMessage).replace(/\s+/g, ' ').trim()
  const messages = listMessages(input.messages)
  const signals =
    input.conversationSignals && typeof input.conversationSignals === 'object'
      ? input.conversationSignals
      : null
  const previous =
    input.previousConversationState && typeof input.previousConversationState === 'object'
      ? input.previousConversationState
      : null

  /** @type {string[]} */
  const diagnostics = []

  const recentAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const assistantText = recentAssistant?.content || ''
  const priorAlts = Array.isArray(previous?.recentAlternatives)
    ? previous.recentAlternatives.map((x) => asString(x)).filter(Boolean)
    : []
  const orderedOptions = extractOrderedOptions(assistantText)
  const extractedAlts = extractRecentAlternatives(assistantText, priorAlts)
  // Prefer a clean prior binary contrast when present (short-range State).
  const recentAlternatives =
    orderedOptions.length >= 2
      ? orderedOptions.slice()
      : priorAlts.length === 2
        ? priorAlts.slice()
        : extractedAlts

  const activeTopic = asString(previous?.activeTopic || '').trim() || null
  const pendingTopic = asString(previous?.pendingProposal?.topic || '').trim() || null
  const prevMoveTopic =
    previous?.previousAssistantMove && typeof previous.previousAssistantMove === 'object'
      ? asString(previous.previousAssistantMove.topic).trim() || null
      : null
  const rejectedPrior = asString(previous?.repair?.rejectedInterpretation || '').trim() || null

  const correctionCue = Boolean(signals?.interaction?.correctionCue) || MISUNDERSTAND_RE.test(userText)
  const hasDemonstrative = DEMONSTRATIVE_RE.test(userText)
  const hasOrdinal = ORDINAL_RE.test(userText)
  const hasPreviousRef = PREVIOUS_REF_RE.test(userText)
  const hasAlternate = ALTERNATE_RE.test(userText)

  /** @type {ReferenceResolutionResult} */
  let result = {
    status: 'unresolved',
    expression: null,
    referentType: null,
    referent: null,
    confidence: 0,
    confidenceBand: 'low',
    sourceTurn: null,
    recentAlternatives,
    orderedOptions,
    repair: emptyRepairState(),
    references: { resolved: [], unresolved: [], ambiguous: [] },
    diagnostics,
    version: REFERENCE_RESOLUTION_VERSION,
  }

  // ——— 1. Explicit topic correction ———
  const explicitTopic = extractExplicitCorrectedTopic(userText)
  if (correctionCue && explicitTopic) {
    const rejected =
      activeTopic && activeTopic.toLowerCase() !== explicitTopic.toLowerCase()
        ? activeTopic
        : pendingTopic && pendingTopic.toLowerCase() !== explicitTopic.toLowerCase()
          ? pendingTopic
          : null
    result = {
      ...result,
      status: 'explicit',
      expression: userText.slice(0, 80),
      referentType: 'explicit_topic',
      referent: explicitTopic,
      confidence: 0.92,
      confidenceBand: 'high',
      sourceTurn: 0,
      repair: {
        active: true,
        type: 'explicit_correction',
        rejectedInterpretation: rejected,
        correctedReferent: explicitTopic,
        confidence: 0.92,
        requiresClarification: false,
      },
      diagnostics: [...diagnostics, 'explicit_topic_correction'],
    }
    result.references.resolved.push(
      record({
        status: 'explicit',
        expression: userText.slice(0, 80),
        referentType: 'explicit_topic',
        referent: explicitTopic,
        confidence: 0.92,
        sourceTurn: 0,
      }),
    )
    const shouldFreeze = input.freeze !== false
    return shouldFreeze ? freezeReferenceResolution(result) : result
  }

  // ——— 2. Ordinal resolution ———
  if (hasOrdinal) {
    const idx = ordinalIndex(userText)
    const pool = orderedOptions.length >= 2 ? orderedOptions : recentAlternatives
    result.expression = userText.match(ORDINAL_RE)?.[0] || 'ordinal'
    if (idx >= 0 && pool.length > idx) {
      const referent = pool[idx]
      result = {
        ...result,
        status: 'resolved',
        referentType: 'ordinal',
        referent,
        confidence: 0.9,
        confidenceBand: 'high',
        sourceTurn: -1,
        diagnostics: [...diagnostics, 'ordinal_resolved'],
        repair: correctionCue
          ? {
              active: true,
              type: 'ordinal_correction',
              rejectedInterpretation: rejectedPrior || (activeTopic !== referent ? activeTopic : null),
              correctedReferent: referent,
              confidence: 0.9,
              requiresClarification: false,
            }
          : emptyRepairState(),
      }
      result.references.resolved.push(
        record({
          status: 'resolved',
          expression: result.expression,
          referentType: 'ordinal',
          referent,
          confidence: 0.9,
          sourceTurn: -1,
        }),
      )
      const shouldFreeze = input.freeze !== false
      return shouldFreeze ? freezeReferenceResolution(result) : result
    }
    // No ordered set → unresolved
    result.status = 'unresolved'
    result.referentType = 'ordinal'
    result.diagnostics.push('ordinal_no_set')
    result.references.unresolved.push(asString(result.expression))
    const shouldFreeze = input.freeze !== false
    return shouldFreeze ? freezeReferenceResolution(result) : result
  }

  // ——— 3. Alternate ("l'altro") ———
  if (hasAlternate || (correctionCue && hasDemonstrative && /altro|other|non\s+quello|not\s+that/i.test(userText))) {
    result.expression = userText.match(ALTERNATE_RE)?.[0] || "l'altro"
    const pool = recentAlternatives.filter((a) => {
      if (!rejectedPrior) return true
      return a.toLowerCase() !== rejectedPrior.toLowerCase()
    })
    // If activeTopic is one of two alternatives, pick the other.
    let candidates = pool.slice()
    if (activeTopic && pool.length >= 2) {
      const others = pool.filter((a) => a.toLowerCase() !== activeTopic.toLowerCase())
      if (others.length === 1) candidates = others
      else if (others.length > 1) candidates = others
    }

    if (candidates.length === 1) {
      const referent = candidates[0]
      result = {
        ...result,
        status: 'resolved',
        referentType: 'alternate',
        referent,
        confidence: 0.86,
        confidenceBand: 'high',
        sourceTurn: -1,
        diagnostics: [...diagnostics, 'alternate_resolved'],
        repair: {
          active: true,
          type: 'alternate_referent',
          rejectedInterpretation: activeTopic || rejectedPrior,
          correctedReferent: referent,
          confidence: 0.86,
          requiresClarification: false,
        },
      }
      result.references.resolved.push(
        record({
          status: 'resolved',
          expression: result.expression,
          referentType: 'alternate',
          referent,
          confidence: 0.86,
          sourceTurn: -1,
        }),
      )
      const shouldFreeze = input.freeze !== false
      return shouldFreeze ? freezeReferenceResolution(result) : result
    }

    if (candidates.length >= 2) {
      result = {
        ...result,
        status: 'ambiguous',
        referentType: 'alternate',
        referent: null,
        confidence: 0.4,
        confidenceBand: 'low',
        diagnostics: [...diagnostics, 'alternate_ambiguous'],
        repair: {
          active: Boolean(correctionCue),
          type: correctionCue ? 'alternate_referent' : null,
          rejectedInterpretation: activeTopic || rejectedPrior,
          correctedReferent: null,
          confidence: 0.4,
          requiresClarification: true,
        },
      }
      for (const c of candidates.slice(0, 3)) {
        result.references.ambiguous.push(
          record({
            status: 'ambiguous',
            expression: result.expression,
            referentType: 'alternate',
            referent: c,
            confidence: 0.4,
            sourceTurn: -1,
          }),
        )
      }
      const shouldFreeze = input.freeze !== false
      return shouldFreeze ? freezeReferenceResolution(result) : result
    }

    result.status = 'unresolved'
    result.diagnostics.push('alternate_unresolved')
    result.references.unresolved.push(asString(result.expression))
    if (correctionCue) {
      result.repair = {
        active: true,
        type: 'misunderstanding',
        rejectedInterpretation: activeTopic || rejectedPrior,
        correctedReferent: null,
        confidence: 0.3,
        requiresClarification: true,
      }
    }
    const shouldFreeze = input.freeze !== false
    return shouldFreeze ? freezeReferenceResolution(result) : result
  }

  // ——— 4. "quello di prima" ———
  if (hasPreviousRef) {
    result.expression = userText.match(PREVIOUS_REF_RE)?.[0] || 'quello di prima'
    const candidates = [activeTopic, prevMoveTopic, pendingTopic, ...priorAlts]
      .filter(Boolean)
      .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
      .filter((v) => !rejectedPrior || v.toLowerCase() !== rejectedPrior.toLowerCase())

    if (candidates.length === 1) {
      const referent = candidates[0]
      result = {
        ...result,
        status: 'resolved',
        referentType: 'previous',
        referent,
        confidence: 0.8,
        confidenceBand: 'high',
        sourceTurn: -1,
        diagnostics: [...diagnostics, 'previous_resolved'],
      }
      result.references.resolved.push(
        record({
          status: 'resolved',
          expression: result.expression,
          referentType: 'previous',
          referent,
          confidence: 0.8,
          sourceTurn: -1,
        }),
      )
    } else if (candidates.length >= 2) {
      result = {
        ...result,
        status: 'ambiguous',
        referentType: 'previous',
        confidence: 0.35,
        confidenceBand: 'low',
        diagnostics: [...diagnostics, 'previous_ambiguous'],
        repair: {
          active: false,
          type: null,
          rejectedInterpretation: null,
          correctedReferent: null,
          confidence: 0.35,
          requiresClarification: true,
        },
      }
      for (const c of candidates.slice(0, 3)) {
        result.references.ambiguous.push(
          record({
            status: 'ambiguous',
            expression: result.expression,
            referentType: 'previous',
            referent: c,
            confidence: 0.35,
            sourceTurn: -1,
          }),
        )
      }
    } else {
      result.status = 'unresolved'
      result.diagnostics.push('previous_unresolved')
      result.references.unresolved.push(asString(result.expression))
    }
    const shouldFreeze = input.freeze !== false
    return shouldFreeze ? freezeReferenceResolution(result) : result
  }

  // ——— 5. Demonstrative continuity ("E quello più grande?") ———
  if (hasDemonstrative || CONTINUATION_TOPIC_RE.test(userText)) {
    result.expression = userText.match(DEMONSTRATIVE_RE)?.[0] || userText.slice(0, 40)
    // Prefer activeTopic if present and not rejected.
    if (activeTopic && (!rejectedPrior || activeTopic.toLowerCase() !== rejectedPrior.toLowerCase())) {
      result = {
        ...result,
        status: 'resolved',
        referentType: 'topic_entity',
        referent: activeTopic,
        confidence: 0.84,
        confidenceBand: 'high',
        sourceTurn: -1,
        diagnostics: [...diagnostics, 'demonstrative_active_topic'],
      }
      result.references.resolved.push(
        record({
          status: 'resolved',
          expression: result.expression,
          referentType: 'topic_entity',
          referent: activeTopic,
          confidence: 0.84,
          sourceTurn: -1,
        }),
      )
      const shouldFreeze = input.freeze !== false
      return shouldFreeze ? freezeReferenceResolution(result) : result
    }

    if (prevMoveTopic) {
      result = {
        ...result,
        status: 'resolved',
        referentType: 'topic_entity',
        referent: prevMoveTopic,
        confidence: 0.7,
        confidenceBand: 'medium',
        sourceTurn: -1,
        diagnostics: [...diagnostics, 'demonstrative_prev_move'],
      }
      result.references.resolved.push(
        record({
          status: 'resolved',
          expression: result.expression,
          referentType: 'topic_entity',
          referent: prevMoveTopic,
          confidence: 0.7,
          sourceTurn: -1,
        }),
      )
      const shouldFreeze = input.freeze !== false
      return shouldFreeze ? freezeReferenceResolution(result) : result
    }

    result.status = 'unresolved'
    result.diagnostics.push('demonstrative_unresolved')
    result.references.unresolved.push(asString(result.expression))
  }

  // ——— 6. Bare correction cue without recoverable referent ———
  if (correctionCue && result.status === 'unresolved') {
    result.repair = {
      active: true,
      type: 'misunderstanding',
      rejectedInterpretation: activeTopic || pendingTopic || rejectedPrior,
      correctedReferent: null,
      confidence: 0.35,
      requiresClarification: true,
    }
    result.diagnostics.push('correction_needs_clarification')
  }

  const shouldFreeze = input.freeze !== false
  return shouldFreeze ? freezeReferenceResolution(result) : result
}

const CONTINUATION_TOPIC_RE =
  /^(e\s+quello|e\s+quella|e\s+questo|e\s+questa|and\s+that|and\s+the)\b/i

/**
 * Whether Writer text appears to contradict a resolved repair/referent.
 * Conservative lexical check for Contract Evaluator.
 *
 * @param {string} responseText
 * @param {{
 *   referent?: string|null,
 *   rejectedInterpretation?: string|null,
 *   status?: string,
 * }} grounding
 * @returns {boolean} true if contradiction detected
 */
export function responseContradictsReferent(responseText, grounding = {}) {
  const text = asString(responseText).toLowerCase()
  if (!text) return false
  const referent = asString(grounding.referent).toLowerCase().trim()
  const rejected = asString(grounding.rejectedInterpretation).toLowerCase().trim()
  const status = asString(grounding.status)

  if (!referent || (status !== 'resolved' && status !== 'explicit')) return false

  const referentToken = referent.split(/\s+/)[0]
  const rejectedToken = rejected.split(/\s+/)[0]

  const mentionsReferent = referentToken.length >= 3 && text.includes(referentToken)
  const mentionsRejected =
    rejectedToken.length >= 3 &&
    rejectedToken !== referentToken &&
    text.includes(rejectedToken)

  // Contradiction: talks about rejected topic and never mentions corrected referent.
  if (mentionsRejected && !mentionsReferent) return true
  return false
}

/**
 * @param {unknown} value
 * @returns {value is ReferenceResolutionResult}
 */
export function isReferenceResolution(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return typeof v.status === 'string' && v.repair && typeof v.repair === 'object'
}
