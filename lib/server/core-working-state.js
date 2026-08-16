/**
 * Deterministic Conversation Working State (#278).
 *
 * Reconstructs a tiny TEMPORARY state from explicit USER statements in the
 * already-selected Core history (#277). No network, DB, localStorage, OpenAI,
 * summarization, or second model call.
 *
 * IMPORTANT LIMITATION:
 * State only exists while its source user turns remain inside the #277 window.
 * Once those turns are dropped by history selection, this module cannot revive
 * them — no hidden persistence. Future checkpoint/delta work is out of scope.
 */

export const WORKING_STATE_VERSION = 1
export const MAX_ACTIVE_TASK_CHARS = 160
export const MAX_DECISION_CHARS = 120
export const MAX_CONSTRAINT_CHARS = 120
export const MAX_DECISIONS = 3
export const MAX_CONSTRAINTS = 3
export const MAX_APPENDIX_CHARS = 1500

/**
 * @typedef {{
 *   version: 1
 *   activeTask?: string
 *   decisions?: string[]
 *   constraints?: string[]
 * }} ConversationWorkingState
 */

/**
 * @typedef {{ role?: string, content?: string, attachments?: unknown }} ChatLike
 */

/**
 * @param {string} text
 * @param {number} max
 */
function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  if (sp >= Math.floor(max * 0.6)) return cut.slice(0, sp).trim()
  return cut.trim()
}

/**
 * @param {string} raw
 */
function normalizeUserText(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 */
function looksLikeSupersede(text) {
  return /\b(actually|instead|switch\s+to|rather|no[,:]?\s+use|cambi(?:a|amo)|invece|meglio|passiamo\s+a|ora\s+usa|usa\s+invece)\b/i.test(
    text,
  )
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function extractDecision(text) {
  const t = normalizeUserText(text)
  if (!t || t.length > 280) return null

  /** @type {RegExp[]} */
  const patterns = [
    /^(?:we\s+)?(?:choose|chose|picking|pick|select(?:ed)?|go(?:ing)?\s+with)\s+(.+?)(?:[.!?]|$)/i,
    /^(?:let'?s\s+)?(?:use|go\s+with)\s+(?:option\s+)?(.+?)(?:[.!?]|$)/i,
    /^use\s+(?:architecture\s+|option\s+)?(.+?)(?:[.!?]|$)/i,
    /^(?:actually|instead)[,:]?\s+(?:switch\s+to|use|go\s+with)\s+(.+?)(?:[.!?]|$)/i,
    /^switch\s+to\s+(.+?)(?:[.!?]|$)/i,
    /^scegliamo\s+(.+?)(?:[.!?]|$)/i,
    /^usiamo\s+(?:l['’]?opzione\s+)?(.+?)(?:[.!?]|$)/i,
    /^andiamo\s+con\s+(.+?)(?:[.!?]|$)/i,
    /^(?:invece|meglio|passiamo\s+a|ora)\s+(?:usiamo\s+|usa\s+|con\s+)?(.+?)(?:[.!?]|$)/i,
  ]

  for (const re of patterns) {
    const m = t.match(re)
    if (!m || !m[1]) continue
    const choice = clip(m[1].replace(/^(?:architecture|option|l['’]?approccio|approccio)\s+/i, ''), MAX_DECISION_CHARS)
    if (!choice || choice.length < 1) continue
    // Reject vague leftovers
    if (/^(this|that|it|così|cosi|quello|questa)$/i.test(choice)) continue
    return choice
  }
  return null
}

/**
 * @param {string} text
 * @returns {{ action: 'add' | 'remove', text: string } | null}
 */
function extractConstraint(text) {
  const t = normalizeUserText(text)
  if (!t || t.length > 280) return null

  // Cancellation first
  const cancel =
    t.match(
      /^(?:(?:you\s+)?can\s+(?:now\s+)?(?:modify|touch|change|edit)|(?:now\s+)?(?:feel\s+free\s+to\s+)?(?:modify|touch|change))\s+(.+?)(?:\s+now)?\.?$/i,
    ) ||
    t.match(
      /^(?:(?:ora\s+)?(?:puoi|potete)\s+(?:modificare|toccare|cambiare)|puoi\s+modificare)\s+(.+?)\.?$/i,
    )
  if (cancel?.[1]) {
    const target = clip(cancel[1], MAX_CONSTRAINT_CHARS)
    if (target) return { action: 'remove', text: target }
  }

  const add =
    t.match(
      /^(?:do\s+not|don't|dont|never)\s+(?:modify|touch|change|edit|alter|update)\s+(.+?)\.?$/i,
    ) ||
    t.match(/^keep\s+(.+?)\s+(?:at|to|as)\s+(.+?)\.?$/i) ||
    t.match(/^(?:non\s+(?:modificare|toccare|cambiare|alterare))\s+(.+?)\.?$/i) ||
    t.match(/^lascia\s+(.+?)\s+(?:a|come)\s+(.+?)\.?$/i)

  if (!add) return null

  if (add.length >= 3 && add[2] != null) {
    // keep X at Y / lascia X a Y
    const full = clip(`${add[1]} = ${add[2]}`, MAX_CONSTRAINT_CHARS)
    return full ? { action: 'add', text: full } : null
  }

  const target = clip(add[1], MAX_CONSTRAINT_CHARS)
  if (!target) return null
  return { action: 'add', text: `do not modify ${target}` }
}

/**
 * @param {string} text
 * @returns {{ task: string, completedHint?: string } | null}
 */
function extractTask(text) {
  const t = normalizeUserText(text)
  if (!t || t.length > 320) return null

  // "X is done. Next implement Y" / "Vision is done. Next implement documents."
  const doneNext =
    t.match(
      /^(.+?)\s+(?:is\s+done|done)\.?\s+(?:next[,:]?\s+)?(?:implement|do|build|fix)\s+(.+?)(?:[.!?]|$)/i,
    ) ||
    t.match(
      /^(.+?)\s+(?:è\s+fatto|fatto|completato)\.?\s+(?:(?:il\s+)?prossimo\s+passo\s+(?:è|e)\s+|adesso\s+|poi\s+)?(?:implementiamo|implementa|facciamo)\s+(.+?)(?:[.!?]|$)/i,
    )
  if (doneNext?.[2]) {
    const task = clip(doneNext[2], MAX_ACTIVE_TASK_CHARS)
    if (task) return { task, completedHint: clip(doneNext[1], 80) }
  }

  /** @type {RegExp[]} */
  const patterns = [
    /^(?:next[,:]?\s+)?(?:implement|build|add|fix|create)\s+(.+?)(?:[.!?]|$)/i,
    /^(?:now\s+we\s+need\s+to|now\s+(?:implement|fix|build)|next\s+we\s+(?:need\s+to\s+)?(?:implement|do|build))\s+(.+?)(?:[.!?]|$)/i,
    /^(?:the\s+)?(?:next\s+step\s+is\s+to|next\s+step:\s*)(.+?)(?:[.!?]|$)/i,
    /^(?:adesso\s+)?(?:implementiamo|implementa|facciamo)\s+(.+?)(?:[.!?]|$)/i,
    /^(?:il\s+)?prossimo\s+passo\s+(?:è|e)\s+(.+?)(?:[.!?]|$)/i,
    /^ora\s+(?:dobbiamo\s+)?(?:implementare|sistemare|fixare)\s+(.+?)(?:[.!?]|$)/i,
  ]

  for (const re of patterns) {
    const m = t.match(re)
    if (!m?.[1]) continue
    const task = clip(m[1], MAX_ACTIVE_TASK_CHARS)
    if (!task || task.length < 2) continue
    if (/^(this|that|it|così|cosi)$/i.test(task)) continue
    return { task }
  }
  return null
}

/**
 * Loose target match for constraint cancellation.
 * @param {string} existing
 * @param {string} target
 */
function constraintMatches(existing, target) {
  const a = existing.toLowerCase()
  const b = target.toLowerCase()
  if (!a || !b) return false
  if (a.includes(b) || b.includes(a)) return true
  // compare core path-like tokens
  const tok = (s) =>
    s
      .replace(/^do not modify\s+/i, '')
      .split(/[\s,/]+/)
      .filter((x) => x.length > 2)
  const ta = new Set(tok(a))
  const tb = tok(b)
  return tb.some((x) => ta.has(x))
}

/**
 * Derive temporary Working State from conversation messages.
 * Only USER visible text participates. Assistant text never establishes state.
 *
 * @param {ChatLike[] | null | undefined} messages
 * @returns {ConversationWorkingState | null}
 */
export function deriveConversationWorkingState(messages) {
  const list = Array.isArray(messages) ? messages : []
  /** @type {string | undefined} */
  let activeTask
  /** @type {string[]} */
  let decisions = []
  /** @type {string[]} */
  let constraints = []

  for (const msg of list) {
    if (!msg || msg.role !== 'user') continue
    const content = typeof msg.content === 'string' ? msg.content.trim() : ''
    if (!content) continue
    // Never treat attachment payloads as state evidence.
    if (/^data:[^;]+;base64,/i.test(content)) continue

    const decision = extractDecision(content)
    if (decision) {
      if (looksLikeSupersede(content) || decisions.length > 0) {
        // Conservative same-slot replace: newer explicit choice replaces prior decisions.
        if (looksLikeSupersede(content)) {
          decisions = [decision]
        } else {
          decisions = [...decisions.filter((d) => d.toLowerCase() !== decision.toLowerCase()), decision].slice(
            -MAX_DECISIONS,
          )
        }
      } else {
        decisions = [decision]
      }
    }

    const constraint = extractConstraint(content)
    if (constraint) {
      if (constraint.action === 'remove') {
        constraints = constraints.filter((c) => !constraintMatches(c, constraint.text))
      } else {
        constraints = [
          ...constraints.filter((c) => !constraintMatches(c, constraint.text)),
          constraint.text,
        ].slice(-MAX_CONSTRAINTS)
      }
    }

    const task = extractTask(content)
    if (task?.task) {
      activeTask = task.task
    }
  }

  /** @type {ConversationWorkingState} */
  const state = { version: WORKING_STATE_VERSION }
  if (activeTask) state.activeTask = activeTask
  if (decisions.length) state.decisions = decisions.slice(-MAX_DECISIONS)
  if (constraints.length) state.constraints = constraints.slice(-MAX_CONSTRAINTS)

  if (!state.activeTask && !state.decisions && !state.constraints) return null
  return state
}

/**
 * @param {ConversationWorkingState | null | undefined} state
 */
export function workingStateHasContent(state) {
  if (!state || state.version !== WORKING_STATE_VERSION) return false
  return Boolean(
    (state.activeTask && state.activeTask.trim()) ||
      (state.decisions && state.decisions.length) ||
      (state.constraints && state.constraints.length),
  )
}

/**
 * Build ephemeral Core appendix. Returns '' when empty.
 * @param {ChatLike[] | null | undefined} messages
 */
export function buildConversationWorkingStateAppendix(messages) {
  const state = deriveConversationWorkingState(messages)
  if (!workingStateHasContent(state) || !state) return ''

  const lines = [
    'CONVERSATION WORKING STATE',
    'Temporary state reconstructed from explicit user statements in the supplied conversation.',
    'Incomplete by design. Not durable Memory. Not an exact quotation.',
    'Latest explicit user message and newer raw conversation evidence override this state.',
    'If this state conflicts with newer evidence, follow the newer evidence.',
  ]

  if (state.activeTask) {
    lines.push('', `Current task: ${state.activeTask}`)
  }
  if (state.decisions?.length) {
    lines.push('', 'Recent explicit decisions:')
    for (const d of state.decisions) lines.push(`- ${d}`)
  }
  if (state.constraints?.length) {
    lines.push('', 'Active explicit constraints:')
    for (const c of state.constraints) lines.push(`- ${c}`)
  }

  let appendix = lines.join('\n').trim()
  if (appendix.length > MAX_APPENDIX_CHARS) {
    appendix = `${appendix.slice(0, MAX_APPENDIX_CHARS - 1).trim()}…`
  }
  return appendix
}
