/**
 * LAIfe V2 — Conversation Behavior Harness (experimental)
 *
 * Pure offline evaluation of conversational *decisions* (not text quality).
 * Compares which behaviours LAIfe vs ChatGPT chose on the same input.
 *
 * - No LLM
 * - No Writer / Planner / Runtime / Pipeline / API wiring
 * - Manual ratings only
 */

export const CONVERSATION_BEHAVIOR_HARNESS_VERSION = '0.1.0-conversation-behavior-harness'

/** @typedef {'conversation'|'answer'|'learning'|'brainstorming'|'debugging'|'planning'|'resume'|'support'|'decision'|'exploration'} TurnType */
/** @typedef {'expand'|'surprise'|'example'|'analogy'|'contrast'|'simplify'|'challenge'|'diagnose'|'summarize'|'resume'} Strategy */
/** @typedef {'unexpected_fact'|'scientific_explanation'|'real_world_example'|'thought_experiment'|'practical_step'|'historical_story'|'next_step'|'question'|'reflection'|'definition'} Move */
/** @typedef {'none'|'low'|'medium'|'high'} Initiative */
/** @typedef {'minimal'|'short'|'medium'|'deep'} Depth */
/** @typedef {'low'|'medium'|'high'} Energy */
/** @typedef {'warm'|'direct'|'friendly'|'technical'|'none'} Opening */
/** @typedef {'question'|'statement'|'proposal'|'none'} Closing */
/** @typedef {'LAIfe'|'ChatGPT'|'Tie'} Winner */

/** @type {readonly TurnType[]} */
export const TURN_TYPES = Object.freeze([
  'conversation',
  'answer',
  'learning',
  'brainstorming',
  'debugging',
  'planning',
  'resume',
  'support',
  'decision',
  'exploration',
])

/** @type {readonly Strategy[]} */
export const STRATEGIES = Object.freeze([
  'expand',
  'surprise',
  'example',
  'analogy',
  'contrast',
  'simplify',
  'challenge',
  'diagnose',
  'summarize',
  'resume',
])

/** @type {readonly Move[]} */
export const MOVES = Object.freeze([
  'unexpected_fact',
  'scientific_explanation',
  'real_world_example',
  'thought_experiment',
  'practical_step',
  'historical_story',
  'next_step',
  'question',
  'reflection',
  'definition',
])

/** @type {readonly Initiative[]} */
export const INITIATIVES = Object.freeze(['none', 'low', 'medium', 'high'])

/** @type {readonly Depth[]} */
export const DEPTHS = Object.freeze(['minimal', 'short', 'medium', 'deep'])

/** @type {readonly Energy[]} */
export const ENERGIES = Object.freeze(['low', 'medium', 'high'])

/** @type {readonly Opening[]} */
export const OPENINGS = Object.freeze(['warm', 'direct', 'friendly', 'technical', 'none'])

/** @type {readonly Closing[]} */
export const CLOSINGS = Object.freeze(['question', 'statement', 'proposal', 'none'])

/** @type {readonly Winner[]} */
export const WINNERS = Object.freeze(['LAIfe', 'ChatGPT', 'Tie'])

/** Dimensions used for pairwise behaviour match. */
const MATCH_DIMENSIONS = /** @type {const} */ ([
  'turnType',
  'strategy',
  'move',
  'initiative',
  'question',
  'opening',
  'closing',
  'depth',
  'energy',
])

/**
 * @typedef {object} BehaviorLabels
 * @property {TurnType} [turnType]
 * @property {Strategy} [strategy]
 * @property {Move} [move]
 * @property {Initiative} [initiative]
 * @property {boolean} [question]
 * @property {Opening} [opening]
 * @property {Closing} [closing]
 * @property {Depth} [depth]
 * @property {Energy} [energy]
 */

/**
 * @typedef {object} BehaviorRating
 * @property {TurnType} [turnType]
 * @property {Strategy} [strategy]
 * @property {Move} [move]
 * @property {Initiative} [initiative]
 * @property {boolean} [question]
 * @property {Opening} [opening]
 * @property {Closing} [closing]
 * @property {Depth} [depth]
 * @property {Energy} [energy]
 * @property {Winner} winner
 * @property {BehaviorLabels} [chatgpt] ChatGPT-side labels for Match metrics
 * @property {string} [notes]
 */

/**
 * @typedef {object} BehaviorCaseInput
 * @property {string} [id]
 * @property {string} input
 * @property {string} laifeResponse
 * @property {string} chatgptResponse
 * @property {string} [notes]
 */

/**
 * @typedef {object} BehaviorCase
 * @property {string} id
 * @property {string} input
 * @property {string} laifeResponse
 * @property {string} chatgptResponse
 * @property {string} [notes]
 * @property {boolean} rated
 * @property {BehaviorLabels|null} laife
 * @property {BehaviorLabels|null} chatgpt
 * @property {Winner|null} winner
 * @property {number|null} similarity 0..1 when both sides labeled
 */

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
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} field
 * @returns {string}
 */
function requireEnum(value, allowed, field) {
  const v = asString(value).trim()
  if (!allowed.includes(v)) {
    throw new Error(`Invalid ${field}: ${JSON.stringify(value)}`)
  }
  return v
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 */
function requireBool(value, field) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${field}: expected boolean`)
  }
  return value
}

/**
 * @param {object} raw
 * @param {boolean} [strict]
 * @returns {BehaviorLabels}
 */
function normalizeLabels(raw, strict = true) {
  const src = raw && typeof raw === 'object' ? raw : {}
  /** @type {BehaviorLabels} */
  const out = {}

  const maybe = (field, allowed, required = false) => {
    if (src[field] == null || src[field] === '') {
      if (strict && required) throw new Error(`Missing ${field}`)
      return
    }
    out[field] = /** @type {any} */ (requireEnum(src[field], allowed, field))
  }

  maybe('turnType', TURN_TYPES, strict)
  maybe('strategy', STRATEGIES, strict)
  maybe('move', MOVES, strict)
  maybe('initiative', INITIATIVES, strict)
  maybe('opening', OPENINGS, strict)
  maybe('closing', CLOSINGS, strict)
  maybe('depth', DEPTHS, strict)
  maybe('energy', ENERGIES, strict)

  if (src.question != null) {
    out.question = requireBool(src.question, 'question')
  } else if (strict) {
    throw new Error('Missing question')
  }

  return out
}

/**
 * @param {BehaviorLabels|null|undefined} a
 * @param {BehaviorLabels|null|undefined} b
 * @returns {{ matches: Record<string, boolean|null>, similarity: number|null }}
 */
export function compareBehaviorLabels(a, b) {
  /** @type {Record<string, boolean|null>} */
  const matches = {}
  if (!a || !b) {
    for (const dim of MATCH_DIMENSIONS) matches[dim] = null
    return { matches, similarity: null }
  }

  let compared = 0
  let hit = 0
  for (const dim of MATCH_DIMENSIONS) {
    const av = /** @type {any} */ (a)[dim]
    const bv = /** @type {any} */ (b)[dim]
    if (av === undefined || bv === undefined) {
      matches[dim] = null
      continue
    }
    const ok = av === bv
    matches[dim] = ok
    compared += 1
    if (ok) hit += 1
  }
  return {
    matches,
    similarity: compared > 0 ? Number((hit / compared).toFixed(4)) : null,
  }
}

/**
 * @param {(boolean|null|undefined)[]} values
 * @returns {number|null}
 */
function meanBool(values) {
  const nums = values.filter((v) => typeof v === 'boolean')
  if (!nums.length) return null
  const sum = nums.reduce((s, v) => s + (v ? 1 : 0), 0)
  return Number((sum / nums.length).toFixed(4))
}

/**
 * Create an isolated Conversation Behavior Harness.
 * @returns {{
 *   addCase: (input: BehaviorCaseInput) => string,
 *   rate: (id: string, rating: BehaviorRating) => BehaviorCase,
 *   getCase: (id: string) => BehaviorCase|null,
 *   listCases: () => BehaviorCase[],
 *   summary: () => object,
 *   printTable: () => string,
 *   toJSON: () => string,
 *   exportJSON: () => object,
 *   version: string,
 * }}
 */
export function createConversationBehaviorHarness() {
  /** @type {Map<string, BehaviorCase>} */
  const cases = new Map()
  let seq = 0

  /**
   * @param {BehaviorCaseInput} input
   * @returns {string}
   */
  function addCase(input) {
    const raw = input && typeof input === 'object' ? input : {}
    const userInput = asString(raw.input).trim()
    const laifeResponse = asString(raw.laifeResponse)
    const chatgptResponse = asString(raw.chatgptResponse)
    if (!userInput) throw new Error('addCase requires input')
    if (!laifeResponse.trim()) throw new Error('addCase requires laifeResponse')
    if (!chatgptResponse.trim()) throw new Error('addCase requires chatgptResponse')

    seq += 1
    const id = asString(raw.id).trim() || `case-${seq}`
    if (cases.has(id)) throw new Error(`Duplicate case id: ${id}`)

    /** @type {BehaviorCase} */
    const entry = {
      id,
      input: userInput,
      laifeResponse,
      chatgptResponse,
      notes: asString(raw.notes) || undefined,
      rated: false,
      laife: null,
      chatgpt: null,
      winner: null,
      similarity: null,
    }
    cases.set(id, entry)
    return id
  }

  /**
   * Rate LAIfe behaviour (top-level fields). Optional `chatgpt` labels enable Match metrics.
   * @param {string} id
   * @param {BehaviorRating} rating
   * @returns {BehaviorCase}
   */
  function rate(id, rating) {
    const entry = cases.get(asString(id))
    if (!entry) throw new Error(`Unknown case id: ${id}`)
    const raw = rating && typeof rating === 'object' ? rating : {}

    const winner = /** @type {Winner} */ (requireEnum(raw.winner, WINNERS, 'winner'))
    const laife = normalizeLabels(raw, true)
    const chatgpt =
      raw.chatgpt && typeof raw.chatgpt === 'object'
        ? normalizeLabels(raw.chatgpt, true)
        : null

    const { similarity } = compareBehaviorLabels(laife, chatgpt)

    entry.rated = true
    entry.laife = laife
    entry.chatgpt = chatgpt
    entry.winner = winner
    entry.similarity = similarity
    if (raw.notes != null) entry.notes = asString(raw.notes)
    cases.set(entry.id, entry)
    return { ...entry }
  }

  /**
   * @param {string} id
   * @returns {BehaviorCase|null}
   */
  function getCase(id) {
    const entry = cases.get(asString(id))
    return entry ? { ...entry } : null
  }

  /**
   * @returns {BehaviorCase[]}
   */
  function listCases() {
    return [...cases.values()].map((c) => ({ ...c }))
  }

  /**
   * @returns {object}
   */
  function summary() {
    const all = listCases()
    const rated = all.filter((c) => c.rated)
    const withPair = rated.filter((c) => c.laife && c.chatgpt)

    /** @type {{ LAIfe: number, ChatGPT: number, Tie: number }} */
    const wins = { LAIfe: 0, ChatGPT: 0, Tie: 0 }
    for (const c of rated) {
      if (c.winner === 'LAIfe') wins.LAIfe += 1
      else if (c.winner === 'ChatGPT') wins.ChatGPT += 1
      else if (c.winner === 'Tie') wins.Tie += 1
    }

    const pairComps = withPair.map((c) => compareBehaviorLabels(c.laife, c.chatgpt))

    const strategyMatch = meanBool(pairComps.map((p) => p.matches.strategy))
    const initiativeMatch = meanBool(pairComps.map((p) => p.matches.initiative))
    const depthMatch = meanBool(pairComps.map((p) => p.matches.depth))
    const openingMatch = meanBool(pairComps.map((p) => p.matches.opening))
    const closingMatch = meanBool(pairComps.map((p) => p.matches.closing))
    const turnTypeMatch = meanBool(pairComps.map((p) => p.matches.turnType))
    const moveMatch = meanBool(pairComps.map((p) => p.matches.move))
    const questionMatch = meanBool(pairComps.map((p) => p.matches.question))
    const energyMatch = meanBool(pairComps.map((p) => p.matches.energy))

    const sims = withPair
      .map((c) => c.similarity)
      .filter((n) => typeof n === 'number')
    const overallSimilarity =
      sims.length > 0
        ? Number((sims.reduce((a, b) => a + /** @type {number} */ (b), 0) / sims.length).toFixed(4))
        : null

    const averageScores = {
      strategyMatch,
      initiativeMatch,
      depthMatch,
      openingMatch,
      closingMatch,
      turnTypeMatch,
      moveMatch,
      questionMatch,
      energyMatch,
      overallSimilarity,
    }

    return {
      version: CONVERSATION_BEHAVIOR_HARNESS_VERSION,
      cases: all.length,
      rated: rated.length,
      paired: withPair.length,
      averageScores,
      strategyMatch,
      initiativeMatch,
      depthMatch,
      openingMatch,
      closingMatch,
      overallSimilarity,
      wins,
      rows: rated.map((c) => {
        const comp = compareBehaviorLabels(c.laife, c.chatgpt)
        return {
          id: c.id,
          input: c.input,
          winner: c.winner,
          strategyMatch: comp.matches.strategy,
          depthMatch: comp.matches.depth,
          initiativeMatch: comp.matches.initiative,
          overall: c.similarity,
          laife: c.laife,
          chatgpt: c.chatgpt,
        }
      }),
    }
  }

  /**
   * Console-friendly table string.
   * @returns {string}
   */
  function printTable() {
    const s = summary()
    const header = [
      'Case'.padEnd(22),
      'Winner'.padEnd(10),
      'Strategy Match'.padEnd(15),
      'Depth Match'.padEnd(12),
      'Initiative Match'.padEnd(17),
      'Overall'.padEnd(8),
    ].join(' ')

    const lines = [header, '-'.repeat(header.length)]
    for (const row of s.rows) {
      const yn = (v) => (v === null || v === undefined ? '—' : v ? 'yes' : 'no')
      const overall =
        typeof row.overall === 'number' ? row.overall.toFixed(2) : '—'
      lines.push(
        [
          asString(row.id).slice(0, 22).padEnd(22),
          asString(row.winner).padEnd(10),
          yn(row.strategyMatch).padEnd(15),
          yn(row.depthMatch).padEnd(12),
          yn(row.initiativeMatch).padEnd(17),
          overall.padEnd(8),
        ].join(' '),
      )
    }

    lines.push('')
    lines.push(
      `Wins  LAIfe=${s.wins.LAIfe}  ChatGPT=${s.wins.ChatGPT}  Tie=${s.wins.Tie}`,
    )
    lines.push(
      `Match strategy=${s.strategyMatch ?? '—'} depth=${s.depthMatch ?? '—'} initiative=${s.initiativeMatch ?? '—'} overall=${s.overallSimilarity ?? '—'}`,
    )
    return lines.join('\n')
  }

  /**
   * @returns {object}
   */
  function exportJSON() {
    return {
      version: CONVERSATION_BEHAVIOR_HARNESS_VERSION,
      generatedAt: new Date().toISOString(),
      summary: summary(),
      cases: listCases(),
    }
  }

  /**
   * @returns {string}
   */
  function toJSON() {
    return JSON.stringify(exportJSON(), null, 2)
  }

  return {
    addCase,
    rate,
    getCase,
    listCases,
    summary,
    printTable,
    toJSON,
    exportJSON,
    version: CONVERSATION_BEHAVIOR_HARNESS_VERSION,
  }
}
